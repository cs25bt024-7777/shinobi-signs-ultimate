/**
 * Phase 8: two-player room-code transport using PeerJS/WebRTC data channels.
 * No game state is trusted from the joining peer; the room creator is authority.
 */
export const PROTOCOL_VERSION = 1;
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
let peerScriptPromise = null;
const PEERJS_URL = 'https://cdn.jsdelivr.net/npm/peerjs@1.5.5/dist/peerjs.min.js';

export function normalizeRoomCode(value) {
  return String(value ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
}
export function isValidRoomCode(value) { return /^[A-HJ-NP-Z2-9]{6}$/.test(normalizeRoomCode(value)); }
export function roomPeerId(code) { return `shinobi-${normalizeRoomCode(code)}`; }
export function createRoomCode(random = Math.random) {
  let out = '';
  for (let i = 0; i < 6; i++) out += CODE_ALPHABET[Math.floor(random() * CODE_ALPHABET.length)];
  return out;
}

export class MultiplayerClient {
  constructor({ PeerClass = null, onStatus = () => {}, onMessage = () => {}, onRemoteStream = () => {} } = {}) {
    this.PeerClass = PeerClass;
    this.onStatus = onStatus;
    this.onMessage = onMessage;
    this.onRemoteStream = onRemoteStream;
    this.localStream = null;
    this.remoteStream = null;
    this._mediaTargets = new Set();
    this._pendingIncomingCalls = new Set();
    this._mediaRetryTimer = null;
    this.peer = null;
    this.connection = null;
    this.role = 'offline';
    this.roomCode = null;
    this.status = 'idle';
    this._closed = false;
  }

  _setStatus(status, detail = '') {
    this.status = status;
    this.onStatus({ status, detail, role: this.role, roomCode: this.roomCode });
  }

  async _peerConstructor() {
    const current = this.PeerClass || globalThis.Peer;
    if (typeof current === 'function') return current;
    if (typeof document === 'undefined') throw new Error('PeerJS is only available in a browser.');
    if (!peerScriptPromise) {
      peerScriptPromise = new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = PEERJS_URL;
        script.async = true;
        script.onload = () => typeof globalThis.Peer === 'function'
          ? resolve(globalThis.Peer)
          : reject(new Error('PeerJS loaded but its browser API was not found.'));
        script.onerror = () => reject(new Error('Could not load PeerJS. Check your internet connection and try again.'));
        document.head.appendChild(script);
      }).catch((error) => { peerScriptPromise = null; throw error; });
    }
    return peerScriptPromise;
  }

  async _waitForOpen(peer, timeoutMs = 15000) {
    return new Promise((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(() => finish(new Error('Could not reach the room service. Check your internet connection.')), timeoutMs);
      const finish = (error, id) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        error ? reject(error) : resolve(id);
      };
      peer.on('open', (id) => finish(null, id));
      peer.on('error', (error) => finish(error));
    });
  }

  async createRoom() {
    this.leave();
    this._closed = false;
    this.role = 'host';
    this._setStatus('creating');
    let PeerCtor;
    try { PeerCtor = await this._peerConstructor(); }
    catch (error) { this.role = 'offline'; this._setStatus('error', error.message); throw error; }
    let lastError;
    for (let attempt = 0; attempt < 4; attempt++) {
      const code = createRoomCode();
      const peer = new PeerCtor(roomPeerId(code), { debug: 1, config: this._rtcConfig() });
      this.peer = peer;
      try {
        await this._waitForOpen(peer);
        this.roomCode = code;
        this._bindPeer(peer);
        this._setStatus('waiting', 'Share this six-character code with your opponent.');
        return code;
      } catch (error) {
        lastError = error;
        peer.destroy?.();
        this.peer = null;
        if (error?.type !== 'unavailable-id') break;
      }
    }
    this.role = 'offline';
    this._setStatus('error', lastError?.message || 'Could not create a room.');
    throw lastError || new Error('Could not create a room.');
  }

  async joinRoom(rawCode) {
    this.leave();
    this._closed = false;
    const code = normalizeRoomCode(rawCode);
    if (!isValidRoomCode(code)) throw new Error('Enter a valid six-character room code.');
    this.role = 'guest';
    this.roomCode = code;
    this._setStatus('connecting', 'Connecting to the room creator…');
    let PeerCtor;
    try { PeerCtor = await this._peerConstructor(); }
    catch (error) { this.role = 'offline'; this.roomCode = null; this._setStatus('error', error.message); throw error; }
    const peer = new PeerCtor(undefined, { debug: 1, config: this._rtcConfig() });
    this.peer = peer;
    try {
      await this._waitForOpen(peer);
      this._bindPeer(peer);
      const connection = peer.connect(roomPeerId(code), { reliable: true, serialization: 'json', metadata: { protocol: PROTOCOL_VERSION } });
      this._attachConnection(connection, true);
      return code;
    } catch (error) {
      peer.destroy?.();
      this.peer = null;
      this.role = 'offline';
      this.roomCode = null;
      this._setStatus('error', error?.message || 'Could not join that room.');
      throw error;
    }
  }

  _rtcConfig() {
    // Public STUN servers help peers discover direct network paths. A TURN relay
    // may still be required on restrictive school/work/mobile networks.
    return {
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        // Public test relay fallback for peers behind restrictive NAT/firewalls.
        // For production deployment, replace with credentials from your own TURN provider.
        { urls: 'turn:openrelay.metered.ca:80', username: 'openrelayproject', credential: 'openrelayproject' },
        { urls: 'turn:openrelay.metered.ca:443', username: 'openrelayproject', credential: 'openrelayproject' },
        { urls: 'turns:openrelay.metered.ca:443?transport=tcp', username: 'openrelayproject', credential: 'openrelayproject' },
      ],
      sdpSemantics: 'unified-plan',
    };
  }

  _bindPeer(peer) {
    // The joining player initiates one media call. The host answers with its
    // own stream, making the same WebRTC call bidirectional and avoiding glare
    // from two simultaneous calls to the same peer.
    peer.on('call', (call) => {
      const pending = { call, timer: null, answered: false };
      this._pendingIncomingCalls.add(pending);
      const answer = (stream) => {
        if (pending.answered) return;
        pending.answered = true;
        clearTimeout(pending.timer);
        this._pendingIncomingCalls.delete(pending);
        try {
          call.answer(stream || undefined);
          call.on('stream', (remote) => this._setRemoteStream(remote));
          call.on('close', () => this._setRemoteStream(null));
          call.on('error', () => this._setRemoteStream(null));
        } catch {
          this._setStatus('media-error', 'Could not answer the video connection. Check camera permissions and network settings.');
        }
      };
      pending.answer = answer;
      if (this.localStream) answer(this.localStream);
      else {
        // Wait briefly for camera permission to resolve so the first answer can
        // carry video in both directions. Fall back to receive-only if needed.
        pending.timer = setTimeout(() => answer(null), 10000);
      }
    });
    peer.on('connection', (connection) => {
      if (this.role !== 'host' || this.connection) {
        connection.close?.();
        return;
      }
      this._attachConnection(connection, false);
    });
    peer.on('disconnected', () => {
      if (!this._closed && this.status === 'connected') this._setStatus('degraded', 'Room service disconnected; an existing direct link may still work.');
    });
    peer.on('error', (error) => {
      if (!this._closed) this._setStatus('error', error?.message || error?.type || 'Peer connection error.');
    });
  }

  _attachConnection(connection, outgoing) {
    this.connection = connection;
    connection.on('open', () => {
      if (outgoing) {
        this._setStatus('connecting', 'Link established; waiting for host confirmation…');
        this.send('HELLO', { protocol: PROTOCOL_VERSION, player: 'Player 2' });
      }
      this._startMediaCall();
    });
    connection.on('data', (message) => this._handleMessage(message));
    connection.on('close', () => {
      if (!this._closed) this._setStatus('disconnected', 'Your opponent left the match.');
    });
    connection.on('error', (error) => {
      if (!this._closed) this._setStatus('error', error?.message || 'Data connection failed.');
    });
  }

  _handleMessage(message) {
    if (!message || message.version !== PROTOCOL_VERSION || typeof message.type !== 'string') return;
    if (message.type === 'HELLO' && this.role === 'host') {
      this._setStatus('connected', 'Opponent connected. You are Player 1.');
      this._startMediaCall();
      this.send('WELCOME', { role: 'guest', roomCode: this.roomCode });
      this.onMessage({ type: 'PLAYER_JOINED', payload: message.payload || {} });
      return;
    }
    if (message.type === 'WELCOME' && this.role === 'guest') {
      this._setStatus('connected', 'Connected. You are Player 2.');
      this._startMediaCall();
      this.onMessage({ type: 'WELCOME', payload: message.payload || {} });
      return;
    }
    this.onMessage({ type: message.type, payload: message.payload || {}, id: message.id || null });
  }

  setLocalStream(stream) {
    this.localStream = stream || null;
    if (!stream) {
      this._mediaTargets.clear();
      return;
    }
    for (const pending of [...this._pendingIncomingCalls]) pending.answer?.(stream);
    this._startMediaCall();
  }

  _scheduleMediaRetry(target) {
    this._mediaTargets.delete(target);
    clearTimeout(this._mediaRetryTimer);
    this._mediaRetryTimer = setTimeout(() => {
      if (!this._closed && this.status === 'connected' && this.localStream && this.role === 'guest') this._startMediaCall();
    }, 1800);
  }

  _startMediaCall() {
    if (!this.peer || !this.localStream || this.status !== 'connected' || this.role !== 'guest') return;
    const target = roomPeerId(this.roomCode);
    if (!target || target === this.peer.id || this._mediaTargets.has(target)) return;
    this._mediaTargets.add(target);
    try {
      const call = this.peer.call(target, this.localStream, { metadata: { purpose: 'shinobi-video' } });
      if (!call) { this._mediaTargets.delete(target); return; }
      call.on('stream', (stream) => this._setRemoteStream(stream));
      // Watchdog: if no video arrived after 6 s, drop this call and try again.
      setTimeout(() => {
        if (!this._closed && !this.remoteStream && this.status === 'connected' && this.role === 'guest') {
          try { call.close(); } catch {}
          this._scheduleMediaRetry(target);
        }
      }, 6000);
      call.on('close', () => { this._scheduleMediaRetry(target); this._setRemoteStream(null); });
      call.on('error', () => { this._scheduleMediaRetry(target); this._setRemoteStream(null); });
    } catch {
      this._mediaTargets.delete(target);
    }
  }

  _setRemoteStream(stream) {
    this.remoteStream = stream || null;
    this.onRemoteStream(this.remoteStream);
  }

  send(type, payload = {}) {
    if (!this.connection?.open || this.status === 'disconnected') return false;
    this.connection.send({ version: PROTOCOL_VERSION, type, payload, id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}` });
    return true;
  }

  leave() {
    this._closed = true;
    try { this.connection?.close?.(); } catch {}
    try { this.peer?.destroy?.(); } catch {}
    this.connection = null;
    this.peer = null;
    // NOTE: keep this.localStream. The webcam was started before the room was
    // created/joined, and createRoom()/joinRoom() call leave() first. Clearing it
    // here meant no video was ever sent. Only setLocalStream(null) clears it.
    this._mediaTargets.clear();
    clearTimeout(this._mediaRetryTimer);
    this._mediaRetryTimer = null;
    for (const pending of this._pendingIncomingCalls) clearTimeout(pending.timer);
    this._pendingIncomingCalls.clear();
    this._setRemoteStream(null);
    this.roomCode = null;
    this.role = 'offline';
    this._setStatus('idle');
  }
}

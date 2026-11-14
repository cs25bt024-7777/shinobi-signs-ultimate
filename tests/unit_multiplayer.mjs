import assert from 'node:assert/strict';
import { MultiplayerClient, createRoomCode, isValidRoomCode, normalizeRoomCode, roomPeerId } from '../src/network/multiplayer.js';
let checks = 0;
const eq = (a, b, m) => { checks++; assert.equal(a, b, m); };
const ok = (v, m) => { checks++; assert.ok(v, m); };
eq(normalizeRoomCode(' ab-cd 2 '), 'ABCD2', 'room code normalizes');
ok(isValidRoomCode('ABC234'), 'valid code accepted');
ok(!isValidRoomCode('AB'), 'short code rejected');
eq(roomPeerId('abc234'), 'shinobi-ABC234', 'stable peer id created');
ok(isValidRoomCode(createRoomCode(() => 0.12)), 'deterministic room code generator returns valid code');

class Emitter {
  constructor() { this.events = new Map(); }
  on(name, fn) { const a = this.events.get(name) || []; a.push(fn); this.events.set(name, a); return this; }
  emit(name, value) { for (const fn of this.events.get(name) || []) fn(value); }
}
class FakeConnection extends Emitter {
  constructor() { super(); this.open = false; this.remote = null; }
  send(data) { if (this.open && this.remote?.open) this.remote.emit('data', data); }
  close() { this.open = false; if (this.remote) { this.remote.open = false; this.remote.emit('close'); } this.emit('close'); }
}
class FakePeer extends Emitter {
  static peers = new Map();
  static serial = 0;
  constructor(id) {
    super(); this.id = id || `guest-${++FakePeer.serial}`; this.destroyed = false;
    if (id && FakePeer.peers.has(id)) { queueMicrotask(() => this.emit('error', Object.assign(new Error('unavailable'), { type: 'unavailable-id' }))); }
    else FakePeer.peers.set(this.id, this);
    queueMicrotask(() => this.emit('open', this.id));
  }
  connect(id) {
    const host = FakePeer.peers.get(id);
    const outgoing = new FakeConnection(); const incoming = new FakeConnection();
    outgoing.remote = incoming; incoming.remote = outgoing;
    if (!host) { queueMicrotask(() => outgoing.emit('error', new Error('peer unavailable'))); return outgoing; }
    queueMicrotask(() => {
      outgoing.open = incoming.open = true;
      host.emit('connection', incoming);
      incoming.emit('open'); outgoing.emit('open');
    });
    return outgoing;
  }
  destroy() { this.destroyed = true; FakePeer.peers.delete(this.id); this.emit('close'); }
}
const wait = (ms = 5) => new Promise(r => setTimeout(r, ms));
const hostMessages = []; const guestMessages = [];
const host = new MultiplayerClient({ PeerClass: FakePeer, onMessage: m => hostMessages.push(m) });
const code = await host.createRoom();
ok(isValidRoomCode(code), 'host creates a six-character room code');
const guest = new MultiplayerClient({ PeerClass: FakePeer, onMessage: m => guestMessages.push(m) });
await guest.joinRoom(code);
await wait(10);
eq(host.status, 'connected', 'host handshake completes');
eq(guest.status, 'connected', 'guest handshake completes');
ok(guestMessages.some(m => m.type === 'WELCOME'), 'guest receives welcome message');
ok(hostMessages.some(m => m.type === 'PLAYER_JOINED'), 'host receives player joined event');
const sent = guest.send('ACTION_REQUEST', { actionId: 'fire-burst' });
ok(sent, 'guest sends reliable game action');
await wait();
ok(hostMessages.some(m => m.type === 'ACTION_REQUEST'), 'host receives game action');
guest.leave(); host.leave();
eq(host.status, 'idle', 'host leaves cleanly');
console.log(`Phase 8 multiplayer transport: ${checks}/${checks} passed`);

// Hand tracking (Phase 3).
//
//   Webcam <video>  ──►  HandTracker  ──►  stable "frames" of hand landmarks
//                                          └─► Gesture recognition (Phase 4)
//
// HandTracker is deliberately independent of MediaPipe: it drives a *backend*
// (see mediapipeBackend.js) that turns one video frame into raw detections.
// HandTracker then adds everything the rest of the game needs:
//
//   • a frame loop (requestVideoFrameCallback, or requestAnimationFrame as a
//     fallback) that never processes the same video frame twice
//   • a frame-rate cap and strictly increasing timestamps (MediaPipe requires them)
//   • normalisation of the raw result into a small, plain data shape
//   • a short "hold" so a hand that drops out for a moment doesn't flicker
//   • status reporting (loading / ready / error) so the UI can explain itself
//
// ── Data you get (one "frame" per processed video frame) ────────────────────
//   {
//     frameId, timestamp,           // timestamp = performance.now() in ms
//     hasHand,                      // true if any hand is present (debounced)
//     hands: [                      // sorted Left, Right, Unknown
//       {
//         handedness: 'Left' | 'Right' | 'Unknown',   // MediaPipe's label (see note below)
//         score,                    // handedness confidence 0..1
//         landmarks:      [{x,y,z} × 21],  // normalised image coords (see below)
//         worldLandmarks: [{x,y,z} × 21],  // metres, origin = hand centre
//         stale: false,             // true = held over from an earlier frame
//       }
//     ],
//     left, right,                  // shortcuts: the Left / Right hand or null
//     rawHandCount,                 // hands actually detected in THIS frame
//     videoWidth, videoHeight,
//   }
//
// ── Coordinate system ───────────────────────────────────────────────────────
// landmarks are in CAMERA space: x,y are 0..1 across the raw, un-mirrored video
// frame (x=0 is the left edge of the raw image, y=0 the top); z is depth
// relative to the wrist (smaller = closer to the camera), at roughly the same
// scale as x.  The on-screen preview is mirrored, so draw with x → 1 - x
// (see toDisplaySpace) — the preview panel does this with a CSS flip.
//
// Handedness note: per MediaPipe's docs the label refers to the subject's own
// hand when it is given the raw, un-mirrored frame (which is what we feed it),
// and a mirrored input would invert it. This has NOT been verified on a physical
// webcam in this project yet. If LEFT/RIGHT look reversed, set
// CONFIG.handTracking.swapHandedness = true.
//
// Index meaning is fixed by MediaPipe: see HandLandmark below.

export const TrackerStatus = Object.freeze({
  IDLE: 'idle',       // nothing loaded yet
  LOADING: 'loading', // downloading the model / starting the backend
  READY: 'ready',     // backend loaded (frames flow while running)
  ERROR: 'error',     // could not load or kept failing; see statusDetail
});

export const LANDMARK_COUNT = 21;

/** Index of each landmark in `hand.landmarks`. */
export const HandLandmark = Object.freeze({
  WRIST: 0,
  THUMB_CMC: 1, THUMB_MCP: 2, THUMB_IP: 3, THUMB_TIP: 4,
  INDEX_FINGER_MCP: 5, INDEX_FINGER_PIP: 6, INDEX_FINGER_DIP: 7, INDEX_FINGER_TIP: 8,
  MIDDLE_FINGER_MCP: 9, MIDDLE_FINGER_PIP: 10, MIDDLE_FINGER_DIP: 11, MIDDLE_FINGER_TIP: 12,
  RING_FINGER_MCP: 13, RING_FINGER_PIP: 14, RING_FINGER_DIP: 15, RING_FINGER_TIP: 16,
  PINKY_MCP: 17, PINKY_PIP: 18, PINKY_DIP: 19, PINKY_TIP: 20,
});

/** Pairs of landmark indices that form the hand skeleton (for drawing). */
export const HAND_CONNECTIONS = Object.freeze([
  [0, 1], [1, 2], [2, 3], [3, 4],            // thumb
  [0, 5], [5, 6], [6, 7], [7, 8],            // index
  [9, 10], [10, 11], [11, 12],               // middle
  [13, 14], [14, 15], [15, 16],              // ring
  [17, 18], [18, 19], [19, 20],              // pinky
  [5, 9], [9, 13], [13, 17], [0, 17],        // palm
]);

/** Mirror landmarks horizontally (camera space → what the player sees). */
export function toDisplaySpace(landmarks) {
  return landmarks.map((p) => ({ x: 1 - p.x, y: p.y, z: p.z }));
}

const HAND_ORDER = { Left: 0, Right: 1, Unknown: 2 };
const MAX_CONSECUTIVE_ERRORS = 5;
const STALE_SUPPRESS_DIST = 0.1; // normalised; see _applyHold

function copyPoints(points) {
  if (!Array.isArray(points) || points.length !== LANDMARK_COUNT) return null;
  const out = new Array(LANDMARK_COUNT);
  for (let i = 0; i < LANDMARK_COUNT; i++) {
    const p = points[i];
    if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) return null;
    out[i] = { x: p.x, y: p.y, z: Number.isFinite(p.z) ? p.z : 0 };
  }
  return out;
}

/**
 * Raw backend result → array of plain hand objects.
 * Accepts MediaPipe's HandLandmarkerResult shape (`landmarks`, `worldLandmarks`,
 * `handedness`, or the older name `handednesses`). Malformed hands are dropped.
 */
export function normalizeHands(raw, swapHandedness = false) {
  if (!raw || !Array.isArray(raw.landmarks)) return [];
  const labels = raw.handedness || raw.handednesses || [];
  const hands = [];
  raw.landmarks.forEach((pts, i) => {
    const landmarks = copyPoints(pts);
    if (!landmarks) return;
    const world = copyPoints(raw.worldLandmarks && raw.worldLandmarks[i]);
    const cat = labels[i] && labels[i][0];
    let handedness = cat && (cat.categoryName || cat.displayName);
    if (handedness !== 'Left' && handedness !== 'Right') handedness = 'Unknown';
    if (swapHandedness && handedness !== 'Unknown') {
      handedness = handedness === 'Left' ? 'Right' : 'Left';
    }
    hands.push({
      handedness,
      score: cat && Number.isFinite(cat.score) ? cat.score : 0,
      landmarks,
      worldLandmarks: world || [],
      stale: false,
    });
  });
  return hands;
}

export class HandTracker {
  /**
   * @param {object} opts
   * @param {HTMLVideoElement} opts.video   e.g. webcam.video
   * @param {{init?:()=>Promise<void>, detect:(video,ts:number)=>object, close?:()=>void}} opts.backend
   * @param {number} [opts.numHands=2]      maximum hands reported
   * @param {number} [opts.holdMs=250]      keep a vanished hand (flagged stale) this long
   * @param {number} [opts.maxFps=30]       cap on detections per second
   * @param {boolean} [opts.swapHandedness=false]  flip Left/Right if the labels come out reversed
   * @param {() => number} [opts.clock]     time source in ms (injectable for tests)
   */
  constructor({ video, backend, numHands = 2, holdMs = 250, maxFps = 30, swapHandedness = false, clock = () => performance.now() }) {
    if (!video) throw new Error('HandTracker needs a video element');
    if (!backend || typeof backend.detect !== 'function') throw new Error('HandTracker needs a backend with detect()');
    this.video = video;
    this.backend = backend;
    this.numHands = numHands;
    this.holdMs = holdMs;
    this.swapHandedness = swapHandedness;
    this._clock = clock;
    this._minInterval = (1000 / maxFps) * 0.9; // 0.9 so a 30 fps camera isn't throttled by timer jitter

    this._status = TrackerStatus.IDLE;
    this._statusDetail = '';
    this._running = false;
    this._token = 0;             // invalidates start() calls that were overtaken by stop()
    this._loadPromise = null;
    this._ready = false;

    this._handle = null;         // pending frame callback id
    this._cancel = null;         // how to cancel it
    this._lastMediaTime = -1;
    this._lastProcessed = -Infinity;
    this._lastTs = 0;
    this._consecutiveErrors = 0;

    this._slots = new Map();     // key → { hand, t } for the hold logic
    this._frameId = 0;
    this._latest = this._buildFrame([], 0);

    this._resultListeners = new Set();
    this._statusListeners = new Set();

    this._stats = { fps: 0, detectMs: 0, processed: 0, skippedDuplicate: 0, skippedThrottle: 0 };
    this._fpsStart = 0;
    this._fpsCount = 0;
  }

  // ---------- read-only info ----------

  get status() { return this._status; }
  get statusDetail() { return this._statusDetail; }
  get isRunning() { return this._running; }

  /** The most recent frame (always defined; empty before the first detection). */
  get latest() { return this._latest; }

  /** Shortcut: is at least one hand present (debounced)? */
  get hasHand() { return this._latest.hasHand; }

  /** { fps, detectMs, processed, skippedDuplicate, skippedThrottle } */
  get stats() { return { ...this._stats }; }

  /**
   * Called after every processed frame (also immediately, with the latest frame).
   * @returns {() => void} unsubscribe
   */
  onResult(listener) {
    this._resultListeners.add(listener);
    try { listener(this._latest); } catch (err) { console.error('HandTracker result listener failed:', err); }
    return () => this._resultListeners.delete(listener);
  }

  /** Called when status changes (also immediately). @returns {() => void} unsubscribe */
  onStatusChange(listener) {
    this._statusListeners.add(listener);
    try { listener({ status: this._status, detail: this._statusDetail }); } catch (err) { console.error('HandTracker status listener failed:', err); }
    return () => this._statusListeners.delete(listener);
  }

  // ---------- control ----------

  /**
   * Load the backend (first time only) and start processing video frames.
   * Never throws: failures become status ERROR. Safe to call again to retry.
   */
  async start() {
    if (this._running) return;
    this._running = true;
    const token = ++this._token;

    if (!this._ready) {
      this._setStatus(TrackerStatus.LOADING);
      try {
        if (!this._loadPromise) {
          this._loadPromise = Promise.resolve(this.backend.init ? this.backend.init() : undefined);
        }
        await this._loadPromise;
      } catch (err) {
        this._loadPromise = null; // allow a retry on the next start()
        if (token === this._token) this._running = false;
        this._setStatus(TrackerStatus.ERROR, (err && err.message) || String(err));
        return;
      }
      this._ready = true;
      this._setStatus(TrackerStatus.READY);
      if (token !== this._token) return; // stop() was called while loading
    }

    this._lastMediaTime = -1;
    this._lastProcessed = -Infinity;
    this._consecutiveErrors = 0;
    this._fpsStart = this._clock();
    this._fpsCount = 0;
    this._scheduleNext();
  }

  /** Stop processing frames (the backend stays loaded so start() is instant). */
  stop() {
    const wasRunning = this._running;
    this._running = false;
    this._token++;
    this._cancelScheduled();
    this._slots.clear();
    if (wasRunning) this._emit(this._buildFrame([], 0)); // clears overlays / indicators
  }

  /** Stop and release the backend's resources. */
  dispose() {
    this.stop();
    if (this.backend.close) this.backend.close();
    this._ready = false;
    this._loadPromise = null;
    this._setStatus(TrackerStatus.IDLE);
  }

  // ---------- frame loop ----------

  _scheduleNext() {
    const v = this.video;
    if (typeof v.requestVideoFrameCallback === 'function') {
      // Fires exactly once per new video frame, so no duplicate work.
      const id = v.requestVideoFrameCallback((now, meta) => this._onFrame(meta));
      this._cancel = () => v.cancelVideoFrameCallback(id);
    } else {
      const id = requestAnimationFrame(() => this._onFrame(null));
      this._cancel = () => cancelAnimationFrame(id);
    }
  }

  _cancelScheduled() {
    if (this._cancel) this._cancel();
    this._cancel = null;
  }

  _onFrame(meta) {
    this._cancel = null;
    if (!this._running) return;
    try {
      this._process(meta);
    } finally {
      if (this._running) this._scheduleNext();
    }
  }

  _process(meta) {
    const v = this.video;
    if (v.readyState < 2 || !v.videoWidth) return; // no frame data yet

    // rAF fallback can fire several times per video frame; skip repeats.
    const mediaTime = meta && typeof meta.mediaTime === 'number' ? meta.mediaTime : v.currentTime;
    if (mediaTime === this._lastMediaTime) {
      this._stats.skippedDuplicate++;
      return;
    }

    const t = this._clock();
    if (t - this._lastProcessed < this._minInterval) {
      this._stats.skippedThrottle++;
      return;
    }
    this._lastMediaTime = mediaTime;

    // MediaPipe needs strictly increasing timestamps.
    const ts = Math.max(Math.round(t), this._lastTs + 1);
    this._lastTs = ts;

    let raw;
    try {
      raw = this.backend.detect(v, ts);
      this._consecutiveErrors = 0;
    } catch (err) {
      if (++this._consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
        this._running = false;
        this._token++;
        this._slots.clear();
        this._emit(this._buildFrame([], 0));
        this._setStatus(TrackerStatus.ERROR, `Detection kept failing: ${(err && err.message) || err}`);
      }
      return;
    }
    this._lastProcessed = t;

    // stats
    const ms = this._clock() - t;
    this._stats.detectMs = this._stats.processed === 0 ? ms : this._stats.detectMs * 0.9 + ms * 0.1;
    this._stats.processed++;
    this._fpsCount++;
    const win = t - this._fpsStart;
    if (win >= 1000) {
      this._stats.fps = Math.round((this._fpsCount * 1000) / win);
      this._fpsStart = t;
      this._fpsCount = 0;
    }

    const detected = normalizeHands(raw, this.swapHandedness).slice(0, this.numHands);
    this._emit(this._buildFrame(this._applyHold(detected, t), detected.length));
  }

  /**
   * Debounce: a hand that was seen within the last `holdMs` is kept in the
   * output (flagged `stale`) even if this frame missed it. Slots are keyed by
   * handedness label so each physical hand is held separately.
   */
  _applyHold(detected, t) {
    const seen = new Set();
    const counts = {};
    for (const hand of detected) {
      const n = (counts[hand.handedness] = (counts[hand.handedness] || 0) + 1);
      const key = n === 1 ? hand.handedness : `${hand.handedness}#${n}`;
      seen.add(key);
      this._slots.set(key, { hand, t });
    }

    const out = [];
    const sinceSeen = new Map(); // hand → time last seen (to pick which held hands to keep)
    for (const [key, slot] of this._slots) {
      if (seen.has(key)) {
        out.push(slot.hand);
      } else if (t - slot.t <= this.holdMs) {
        // If the label flickered (Left→Right) the same physical hand would
        // appear twice: drop the stale copy when a fresh hand is right on top of it.
        const w = slot.hand.landmarks[HandLandmark.WRIST];
        const duplicate = detected.some((d) => {
          const p = d.landmarks[HandLandmark.WRIST];
          return Math.hypot(p.x - w.x, p.y - w.y) < STALE_SUPPRESS_DIST;
        });
        if (!duplicate) {
          const held = { ...slot.hand, stale: true };
          sinceSeen.set(held, slot.t);
          out.push(held);
        }
      } else {
        this._slots.delete(key);
      }
    }

    // Never report more than numHands: fresh hands win, then the most recently seen held ones.
    if (out.length > this.numHands) {
      out.sort((a, b) => (a.stale - b.stale) || ((sinceSeen.get(b) || 0) - (sinceSeen.get(a) || 0)));
      out.length = this.numHands;
    }
    out.sort((a, b) => HAND_ORDER[a.handedness] - HAND_ORDER[b.handedness]);
    return out;
  }

  _buildFrame(hands, rawHandCount) {
    return {
      frameId: ++this._frameId,
      timestamp: this._clock(),
      hasHand: hands.length > 0,
      hands,
      left: hands.find((h) => h.handedness === 'Left') || null,
      right: hands.find((h) => h.handedness === 'Right') || null,
      rawHandCount,
      videoWidth: this.video.videoWidth || 0,
      videoHeight: this.video.videoHeight || 0,
    };
  }

  // ---------- internals ----------

  _emit(frame) {
    this._latest = frame;
    for (const listener of this._resultListeners) {
      try { listener(frame); } catch (err) { console.error('HandTracker result listener failed:', err); }
    }
  }

  _setStatus(status, detail = '') {
    this._status = status;
    this._statusDetail = detail;
    for (const listener of this._statusListeners) {
      try { listener({ status, detail }); } catch (err) { console.error('HandTracker status listener failed:', err); }
    }
  }
}

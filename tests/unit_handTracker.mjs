// Unit tests for src/input/handTracker.js (pure logic, no browser, no MediaPipe).
// Run:  node tests/unit_handTracker.mjs
//
// The tracker is driven by a fake <video> and a fake clock, so every timing
// rule (debounce, throttle, dedup, timestamps) is tested deterministically.

import {
  HandTracker, normalizeHands, toDisplaySpace,
  TrackerStatus, LANDMARK_COUNT, HandLandmark, HAND_CONNECTIONS,
} from '../src/input/handTracker.js';

let passed = 0;
const failed = [];
function check(name, cond, extra = '') {
  if (cond) passed++; else failed.push(name);
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? `   [${extra}]` : ''}`);
}

// ---------- helpers ----------
const pts = (x, y) => Array.from({ length: 21 }, (_, i) => ({ x: x + i * 0.001, y, z: 0.01 * i })); // wrist = (x, y)
const handRaw = (label, x, y) => ({ points: pts(x, y), label });
const raw = (hands, key = 'handedness') => ({
  landmarks: hands.map((h) => h.points),
  worldLandmarks: hands.map(() => pts(0, 0)),
  [key]: hands.map((h) => [{ categoryName: h.label, score: 0.9 }]),
});

function rig(opts = {}) {
  let now = 1000;
  const video = {
    readyState: 4, videoWidth: 640, videoHeight: 480, currentTime: 0, _cb: null,
    requestVideoFrameCallback(cb) { this._cb = cb; return 1; },
    cancelVideoFrameCallback() { this._cb = null; },
  };
  const backend = {
    initCalls: 0, initImpl: async () => {}, result: raw([]), fail: false, tsList: [],
    init() { this.initCalls++; return this.initImpl(); },
    detect(_v, ts) { this.tsList.push(ts); if (this.fail) throw new Error('boom'); return this.result; },
  };
  const tracker = new HandTracker({ video, backend, maxFps: 1000, clock: () => now, ...opts });
  return {
    video, backend, tracker,
    setNow(t) { now = t; },
    /** Advance the clock by dt ms and deliver one video frame. Returns false if nothing was scheduled. */
    frame(dt = 33, mediaTime) {
      now += dt;
      video.currentTime = mediaTime ?? video.currentTime + 0.033;
      const cb = video._cb;
      video._cb = null;
      if (!cb) return false;
      cb(now, { mediaTime: video.currentTime });
      return true;
    },
  };
}

// =====================================================================
console.log('\n== normalizeHands ==');
{
  const r = normalizeHands(raw([handRaw('Left', 0.2, 0.3), handRaw('Right', 0.7, 0.6)]));
  check('two hands in, two hands out', r.length === 2);
  check('each hand has exactly 21 landmarks', r.every((h) => h.landmarks.length === LANDMARK_COUNT && h.landmarks.length === 21));
  check('landmarks are plain {x,y,z} copies', Object.keys(r[0].landmarks[0]).sort().join() === 'x,y,z' && r[0].landmarks[0] !== raw);
  check('handedness label + score preserved', r[0].handedness === 'Left' && r[1].handedness === 'Right' && r[0].score === 0.9);
  check('worldLandmarks (21) preserved', r[0].worldLandmarks.length === 21);
  check('wrist is landmark 0 at the given position', r[0].landmarks[HandLandmark.WRIST].x === 0.2 && r[0].landmarks[0].y === 0.3);

  const legacy = normalizeHands(raw([handRaw('Right', 0.5, 0.5)], 'handednesses'));
  check("older result key 'handednesses' is understood", legacy[0].handedness === 'Right');

  const swapped = normalizeHands(raw([handRaw('Left', 0.5, 0.5), handRaw('Right', 0.6, 0.5)]), true);
  check('swapHandedness flips Left/Right', swapped[0].handedness === 'Right' && swapped[1].handedness === 'Left');

  const bad = normalizeHands({
    landmarks: [pts(0.5, 0.5).slice(0, 20), pts(0.5, 0.5).map((p, i) => (i === 3 ? { x: NaN, y: 0.5, z: 0 } : p)), pts(0.4, 0.4)],
    handedness: [[{ categoryName: 'Left', score: 1 }], [{ categoryName: 'Left', score: 1 }], [{ categoryName: 'Right', score: 1 }]],
  });
  check('hands with 20 landmarks or NaN coordinates are dropped', bad.length === 1 && bad[0].handedness === 'Right');

  const unk = normalizeHands({ landmarks: [pts(0.5, 0.5)], handedness: [] });
  check("missing handedness → 'Unknown', worldLandmarks → []", unk[0].handedness === 'Unknown' && unk[0].worldLandmarks.length === 0);

  const noZ = normalizeHands({ landmarks: [pts(0.5, 0.5).map(({ x, y }) => ({ x, y }))], handedness: [[{ categoryName: 'Left' }]] });
  check('missing z defaults to 0, missing score to 0', noZ[0].landmarks[5].z === 0 && noZ[0].score === 0);

  check('garbage input → []', normalizeHands(null).length === 0 && normalizeHands({}).length === 0 && normalizeHands({ landmarks: 'x' }).length === 0);
}

console.log('\n== constants & helpers ==');
{
  const idx = Object.values(HandLandmark);
  check('HandLandmark has 21 unique indices 0..20', idx.length === 21 && new Set(idx).size === 21 && Math.min(...idx) === 0 && Math.max(...idx) === 20);
  check('HAND_CONNECTIONS only reference valid landmarks', HAND_CONNECTIONS.every(([a, b]) => a >= 0 && a < 21 && b >= 0 && b < 21 && a !== b));
  const m = toDisplaySpace([{ x: 0.25, y: 0.4, z: 0.1 }]);
  check('toDisplaySpace mirrors x only', m[0].x === 0.75 && m[0].y === 0.4 && m[0].z === 0.1);
}

// =====================================================================
console.log('\n== presence: none / one / two hands ==');
{
  const r = rig();
  await r.tracker.start();
  check('status READY after start', r.tracker.status === TrackerStatus.READY && r.tracker.isRunning);
  r.frame();
  check('no hand → hasHand=false, hands=[]', !r.tracker.hasHand && r.tracker.latest.hands.length === 0 && r.tracker.latest.left === null && r.tracker.latest.right === null);

  r.backend.result = raw([handRaw('Right', 0.3, 0.4)]);
  r.frame();
  let f = r.tracker.latest;
  check('one hand → hasHand=true, 1 hand, 21 landmarks', f.hasHand && f.hands.length === 1 && f.hands[0].landmarks.length === 21);
  check('one right hand → .right set, .left null', f.right && f.right.handedness === 'Right' && f.left === null);
  check('hand not stale, rawHandCount=1', f.hands[0].stale === false && f.rawHandCount === 1);
  check('frame carries video size', f.videoWidth === 640 && f.videoHeight === 480);

  r.backend.result = raw([handRaw('Right', 0.7, 0.5), handRaw('Left', 0.2, 0.5)]); // backend order is arbitrary
  r.frame();
  f = r.tracker.latest;
  check('two hands → sorted [Left, Right]', f.hands.length === 2 && f.hands[0].handedness === 'Left' && f.hands[1].handedness === 'Right');
  check('.left and .right shortcuts both populated', f.left === f.hands[0] && f.right === f.hands[1]);

  r.backend.result = raw([handRaw('Left', 0.1, 0.5), handRaw('Right', 0.5, 0.5), handRaw('Left', 0.9, 0.5)]);
  r.frame();
  check('numHands (2) caps the output', r.tracker.latest.hands.length === 2);

  r.backend.result = raw([handRaw('Left', 0.2, 0.5), handRaw('Left', 0.7, 0.5)]);
  r.frame();
  f = r.tracker.latest;
  check('two hands with the SAME label are both kept', f.hands.length === 2 && f.hands.every((h) => h.handedness === 'Left'));
  r.backend.result = raw([handRaw('Left', 0.2, 0.5)]);
  r.frame(100);
  f = r.tracker.latest;
  check('…and the vanished one is held separately (stale)', f.hands.length === 2 && f.hands.filter((h) => h.stale).length === 1);
}

console.log('\n== debounce / hold (holdMs = 250) ==');
{
  const r = rig({ holdMs: 250 });
  await r.tracker.start();
  r.backend.result = raw([handRaw('Right', 0.3, 0.4)]);
  r.frame();
  const seen = [];
  r.backend.result = raw([]);
  for (const dt of [100, 100]) { r.frame(dt); seen.push(r.tracker.latest); }
  check('hand gone 100 ms → still present, flagged stale', seen[0].hasHand && seen[0].hands[0].stale === true);
  check('hand gone 200 ms → still present (held)', seen[1].hasHand && seen[1].rawHandCount === 0);
  check('held hand keeps its landmarks', seen[1].hands[0].landmarks.length === 21 && seen[1].hands[0].landmarks[0].x === 0.3);
  r.frame(100); // 300 ms since last seen
  check('hand gone 300 ms (> holdMs) → hasHand=false', !r.tracker.hasHand && r.tracker.latest.hands.length === 0);

  // exactly at the boundary
  r.backend.result = raw([handRaw('Right', 0.3, 0.4)]); r.frame();
  r.backend.result = raw([]); r.frame(250);
  check('exactly holdMs after last sighting → still held', r.tracker.hasHand);
  r.frame(1);
  check('1 ms later → released', !r.tracker.hasHand);
}
{
  const r = rig();
  await r.tracker.start();
  const flags = [];
  const h = raw([handRaw('Left', 0.4, 0.4)]);
  r.backend.result = h; r.frame(); flags.push(r.tracker.hasHand);
  r.backend.result = raw([]); r.frame(100); flags.push(r.tracker.hasHand);   // brief dropout
  r.backend.result = h; r.frame(100); flags.push(r.tracker.hasHand);
  check('brief dropout (100 ms) never makes hasHand false', flags.every(Boolean), flags.join());
  check('…and the hand is fresh again afterwards', r.tracker.latest.hands[0].stale === false);
}
{
  const r = rig();
  await r.tracker.start();
  r.backend.result = raw([handRaw('Left', 0.2, 0.5), handRaw('Right', 0.7, 0.5)]); r.frame();
  r.backend.result = raw([handRaw('Right', 0.7, 0.5)]);
  r.frame(100);
  let f = r.tracker.latest;
  check('one of two hands leaves → it is held, the other stays fresh', f.hands.length === 2 && f.left.stale && !f.right.stale);
  r.frame(100); r.frame(100);
  f = r.tracker.latest;
  check('after holdMs only the remaining hand is reported', f.hands.length === 1 && f.right && !f.left && f.hasHand);
}
{
  const r = rig();
  await r.tracker.start();
  r.backend.result = raw([handRaw('Left', 0.5, 0.5)]); r.frame();
  r.backend.result = raw([handRaw('Right', 0.52, 0.5)]); r.frame(); // same physical hand, label flickered
  let f = r.tracker.latest;
  check('label flicker Left→Right on the same hand → reported once (no ghost)', f.hands.length === 1 && f.hands[0].handedness === 'Right');
  r.backend.result = raw([handRaw('Left', 0.52, 0.5)]); r.frame();
  f = r.tracker.latest;
  check('…and flickering back is also reported once', f.hands.length === 1 && f.hands[0].handedness === 'Left');
}

console.log('\n== frame loop: dedup, throttle, timestamps ==');
{
  const r = rig();
  await r.tracker.start();
  r.frame(33, 1.0);
  r.frame(1, 1.0); // same media time → same video frame
  check('same video frame is processed only once', r.backend.tsList.length === 1 && r.tracker.stats.skippedDuplicate === 1);
  r.frame(33, 1.033);
  check('a new video frame is processed', r.backend.tsList.length === 2);
}
{
  const r = rig({ maxFps: 30 });
  await r.tracker.start();
  for (let i = 0; i < 12; i++) r.frame(10);           // frames arriving every 10 ms
  const s = r.tracker.stats;
  check('maxFps=30 throttles a 100 fps source (≈ every 3rd frame)', s.processed >= 3 && s.processed <= 5 && s.skippedThrottle >= 7, `processed=${s.processed} skipped=${s.skippedThrottle}`);
  const r2 = rig({ maxFps: 30 });
  await r2.tracker.start();
  for (let i = 0; i < 30; i++) r2.frame(33.3);
  check('a 30 fps camera is NOT throttled', r2.tracker.stats.processed === 30, `processed=${r2.tracker.stats.processed}`);
}
{
  const r = rig({ maxFps: 100000 });
  await r.tracker.start();
  for (let i = 0; i < 6; i++) r.frame(0.1);            // clock barely moves → rounded timestamps collide
  const ts = r.backend.tsList;
  check('timestamps are strictly increasing even when the clock stalls', ts.length === 6 && ts.every((t, i) => i === 0 || t > ts[i - 1]), ts.join());
}
{
  const r = rig();
  await r.tracker.start();
  r.video.readyState = 1;
  r.frame();
  check('video without frame data (readyState<2) is skipped', r.backend.tsList.length === 0);
  r.video.readyState = 4;
  r.frame();
  check('…and processed once data is available', r.backend.tsList.length === 1);
}
{
  // requestAnimationFrame fallback (no requestVideoFrameCallback)
  let rafCb = null;
  globalThis.requestAnimationFrame = (cb) => { rafCb = cb; return 7; };
  globalThis.cancelAnimationFrame = () => { rafCb = null; };
  let now = 5000;
  const video = { readyState: 4, videoWidth: 640, videoHeight: 480, currentTime: 0.5 };
  const backend = { n: 0, detect() { this.n++; return raw([]); } };
  const tracker = new HandTracker({ video, backend, clock: () => now, maxFps: 1000 });
  await tracker.start();
  const fire = (dt) => { now += dt; const cb = rafCb; rafCb = null; if (cb) cb(now); return !!cb; };
  fire(16); fire(16); fire(16);                       // three rAFs, same video frame
  check('rAF fallback: loop runs and skips repeats of the same video frame', backend.n === 1 && tracker.stats.skippedDuplicate === 2);
  video.currentTime = 0.533; fire(16);
  check('rAF fallback: processes the next new frame', backend.n === 2);
  tracker.stop();
  check('rAF fallback: stop() cancels the pending callback', rafCb === null);
  delete globalThis.requestAnimationFrame; delete globalThis.cancelAnimationFrame;
}

console.log('\n== errors & lifecycle ==');
{
  const r = rig();
  await r.tracker.start();
  r.backend.fail = true;
  let alive = true;
  for (let i = 0; i < 4; i++) alive = r.frame() && alive;
  check('4 consecutive detect() errors → loop keeps going', alive && r.tracker.status === TrackerStatus.READY && r.tracker.isRunning);
  r.backend.fail = false; r.frame();
  r.backend.fail = true;
  for (let i = 0; i < 4; i++) r.frame();
  check('a success resets the error counter', r.tracker.status === TrackerStatus.READY);
  r.frame(); // 5th consecutive
  check('5 consecutive errors → status ERROR, loop stops', r.tracker.status === TrackerStatus.ERROR && !r.tracker.isRunning && r.video._cb === null);
  check('error detail mentions the cause', r.tracker.statusDetail.includes('boom'), r.tracker.statusDetail);
  check('latest frame is empty after the error', !r.tracker.hasHand);
}
{
  const r = rig();
  r.backend.initImpl = async () => { throw new Error('network down'); };
  const statuses = [];
  r.tracker.onStatusChange((s) => statuses.push(s.status));
  await r.tracker.start();
  check('load failure → LOADING then ERROR with message', statuses.join() === 'idle,loading,error' && r.tracker.statusDetail === 'network down', statuses.join());
  check('load failure → not running, start() did not throw', !r.tracker.isRunning);
  r.backend.initImpl = async () => {};
  await r.tracker.start();
  check('start() retries the load after a failure', r.tracker.status === TrackerStatus.READY && r.tracker.isRunning && r.backend.initCalls === 2);
}
{
  const r = rig();
  let release;
  r.backend.initImpl = () => new Promise((res) => { release = res; });
  const p = r.tracker.start();
  check('status is LOADING while the model loads', r.tracker.status === TrackerStatus.LOADING);
  r.tracker.stop();
  release(); await p;
  check('stop() during loading → READY but not running, nothing scheduled', r.tracker.status === TrackerStatus.READY && !r.tracker.isRunning && r.video._cb === null);
}
{
  const r = rig();
  await r.tracker.start();
  r.backend.result = raw([handRaw('Right', 0.5, 0.5)]); r.frame();
  const frames = [];
  r.tracker.onResult((f) => frames.push(f));
  const before = frames.length;
  r.tracker.stop();
  check('stop() emits an empty frame (clears overlay/indicator)', frames.length === before + 1 && !frames.at(-1).hasHand && !r.tracker.hasHand);
  check('stop() cancels the pending frame callback', r.video._cb === null);
  await r.tracker.start();
  check('start() after stop() does NOT reload the model', r.backend.initCalls === 1 && r.tracker.isRunning);
  r.frame();
  check('frames flow again after restart', r.tracker.hasHand);
  r.tracker.stop(); r.tracker.stop();
  check('calling stop() twice is harmless', !r.tracker.isRunning);
}
{
  const r = rig();
  let calls = 0;
  const unsub = r.tracker.onResult(() => { calls++; });
  check('onResult() calls the listener immediately with the latest frame', calls === 1);
  await r.tracker.start();
  r.frame();
  check('onResult() fires per processed frame', calls === 2);
  unsub(); r.frame();
  check('unsubscribe works', calls === 2);

  const origErr = console.error; console.error = () => {};
  r.tracker.onResult(() => { throw new Error('listener bug'); });
  r.frame();
  console.error = origErr;
  check('a throwing listener does not stop the loop', r.tracker.isRunning && r.video._cb !== null);
}

console.log(`\n${passed}/${passed + failed.length} checks passed`);
if (failed.length) { console.log('FAILED:\n  - ' + failed.join('\n  - ')); process.exit(1); }

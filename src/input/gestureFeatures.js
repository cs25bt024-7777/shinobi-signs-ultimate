// Gesture features (Phase 4): MediaPipe landmarks → normalised numbers.
//
//   handTracker frame ─► extractFrameFeatures() ─► { hands:[{features}], twoHand }
//
// Pure functions: no DOM, no canvas, no MediaPipe import. Input is the plain frame
// shape documented in handTracker.js.
//
// Which landmarks: finger geometry (curl, spread, distances) uses `worldLandmarks`
// (metres, origin at the hand centre) because they are already in a real-world scale
// and don't depend on how close the player stands. If a hand has no world landmarks
// the normalised image landmarks are used instead, rescaled by the video's width/height
// so x and y have the same unit. Palm *tilt* and everything two-hand uses the image
// landmarks (the image plane is what "up" means to a player).
//
// Invariance: every feature is an angle, a 0..1 curl, or a distance divided by the
// hand's own palm size (wrist → middle-finger knuckle), so hand size, distance from
// the camera, small movements and in-plane rotation barely change them. Only
// `palm.tiltDeg` deliberately depends on rotation.
//
// Features of one hand (all numbers):
//   palmSize                          wrist→middle MCP length in the source space (debug only)
//   curl.{thumb,index,middle,ring,pinky}   0 = straight … 1 = fully curled
//   reach.{index,middle,ring,pinky}        0..1 fraction of full stretch (see config)
//   pipAngle.{index,middle,ring,pinky}     PIP joint angle, degrees (180 = straight)
//   spread.{indexMiddle,middleRing,ringPinky,mean}   degrees between neighbouring fingers, measured
//                                     in the palm plane (only meaningful for straight fingers)
//   tipDist.{thumbIndex,thumbMiddle,indexMiddle,indexPinky}   fingertip gaps, in palm sizes
//   tipToPalm.{thumb,index,middle,ring,pinky}   fingertip → palm centre, in palm sizes
//   palm.facing   0..1: 1 = palm (or back) square to the camera, 0 = edge-on. Doesn't say which.
//   palm.tiltDeg  0..180: angle between wrist→knuckles and "up" in the image (0 = fingers up)
//   extendedCount / curledCount       fingers (not thumb) with curl < 0.35 / > 0.65
//
// Features across two hands (`twoHand`, or null):
//   wristDistance      distance between the wrists, in (average) palm sizes
//   indexTipDistance   distance between the index fingertips, in palm sizes
//   relativeAngleDeg   0..180 angle between the two hands' wrist→knuckle axes

import { HandLandmark as L, LANDMARK_COUNT } from './handTracker.js';
import { GESTURE_CONFIG } from './gestureConfig.js';

const FINGERS = ['index', 'middle', 'ring', 'pinky'];
const JOINTS = {
  index:  [L.INDEX_FINGER_MCP,  L.INDEX_FINGER_PIP,  L.INDEX_FINGER_DIP,  L.INDEX_FINGER_TIP],
  middle: [L.MIDDLE_FINGER_MCP, L.MIDDLE_FINGER_PIP, L.MIDDLE_FINGER_DIP, L.MIDDLE_FINGER_TIP],
  ring:   [L.RING_FINGER_MCP,   L.RING_FINGER_PIP,   L.RING_FINGER_DIP,   L.RING_FINGER_TIP],
  pinky:  [L.PINKY_MCP,         L.PINKY_PIP,         L.PINKY_DIP,         L.PINKY_TIP],
};
const TIPS = {
  thumb: L.THUMB_TIP, index: L.INDEX_FINGER_TIP, middle: L.MIDDLE_FINGER_TIP,
  ring: L.RING_FINGER_TIP, pinky: L.PINKY_TIP,
};
const MIN_PALM = 1e-6;

// ---------- vector helpers ----------
const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const len = (v) => Math.hypot(v.x, v.y, v.z);
const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
const cross = (a, b) => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x });
const dist = (a, b) => len(sub(a, b));
const clamp01 = (v) => Math.min(1, Math.max(0, v));
const deg = (rad) => (rad * 180) / Math.PI;

/** Angle in degrees at `b` between the segments b→a and b→c (180 = straight line). */
export function jointAngle(a, b, c) {
  const u = sub(a, b);
  const v = sub(c, b);
  const d = len(u) * len(v);
  if (d < 1e-12) return 180;
  return deg(Math.acos(Math.min(1, Math.max(-1, dot(u, v) / d))));
}

/** Angle in degrees between two direction vectors. */
function vecAngle(u, v) {
  const d = len(u) * len(v);
  if (d < 1e-12) return 0;
  return deg(Math.acos(Math.min(1, Math.max(-1, dot(u, v) / d))));
}

const curlFromAngle = (angle, straight, curled) => clamp01((straight - angle) / (straight - curled));

/** Dotted-path lookup, e.g. getFeature(f, 'curl.index'). Returns undefined if missing. */
export function getFeature(features, path) {
  let cur = features;
  for (const key of path.split('.')) {
    if (cur == null) return undefined;
    cur = cur[key];
  }
  return typeof cur === 'number' && Number.isFinite(cur) ? cur : undefined;
}

/** Landmarks in a consistent unit (world metres, or image coords rescaled to equal x/y units). */
function metricPoints(hand, frame) {
  if (hand.worldLandmarks && hand.worldLandmarks.length === LANDMARK_COUNT) return hand.worldLandmarks;
  const w = (frame && frame.videoWidth) || 1;
  const h = (frame && frame.videoHeight) || 1;
  return hand.landmarks.map((p) => ({ x: p.x * w, y: p.y * h, z: p.z * w })); // z has ~x scale
}

/** Image-plane points (x,y in pixels-ish, z kept); used for tilt and two-hand geometry. */
function imagePoints(hand, frame) {
  const w = (frame && frame.videoWidth) || 1;
  const h = (frame && frame.videoHeight) || 1;
  return hand.landmarks.map((p) => ({ x: p.x * w, y: p.y * h, z: p.z * w }));
}

const palmSizeOf = (pts) => dist(pts[L.WRIST], pts[L.MIDDLE_FINGER_MCP]);

/**
 * Features of ONE hand, or null if the hand data is unusable (missing points, zero-size palm).
 * @param {{landmarks:object[], worldLandmarks?:object[]}} hand
 * @param {object} [frame]  only used for videoWidth/videoHeight
 */
export function extractHandFeatures(hand, frame = null, config = GESTURE_CONFIG.features) {
  if (!hand || !Array.isArray(hand.landmarks) || hand.landmarks.length !== LANDMARK_COUNT) return null;
  const P = metricPoints(hand, frame);
  const palm = palmSizeOf(P);
  if (!(palm > MIN_PALM)) return null;

  const { straightAngle, curledAngle, jointWeights: jw, angleCurlWeight, reachStraight, reachCurled } = config;
  const f = { palmSize: palm, curl: {}, reach: {}, pipAngle: {}, spread: {}, tipDist: {}, tipToPalm: {}, palm: {} };

  // --- finger curl / reach / PIP angle ---
  for (const name of FINGERS) {
    const [mcp, pip, dip, tip] = JOINTS[name];
    const aMcp = jointAngle(P[L.WRIST], P[mcp], P[pip]);
    const aPip = jointAngle(P[mcp], P[pip], P[dip]);
    const aDip = jointAngle(P[pip], P[dip], P[tip]);
    const angleCurl =
      (jw.mcp * curlFromAngle(aMcp, straightAngle, curledAngle) +
        jw.pip * curlFromAngle(aPip, straightAngle, curledAngle) +
        jw.dip * curlFromAngle(aDip, straightAngle, curledAngle)) /
      (jw.mcp + jw.pip + jw.dip);

    const stretched =
      dist(P[L.WRIST], P[mcp]) + dist(P[mcp], P[pip]) + dist(P[pip], P[dip]) + dist(P[dip], P[tip]);
    const reach = stretched > MIN_PALM ? dist(P[L.WRIST], P[tip]) / stretched : 1;
    const reachCurl = clamp01((reachStraight - reach) / (reachStraight - reachCurled));

    f.curl[name] = angleCurlWeight * angleCurl + (1 - angleCurlWeight) * reachCurl;
    f.reach[name] = reach;
    f.pipAngle[name] = aPip;
  }

  // --- thumb curl (its own angle range) ---
  const tMcp = jointAngle(P[L.THUMB_CMC], P[L.THUMB_MCP], P[L.THUMB_IP]);
  const tIp = jointAngle(P[L.THUMB_MCP], P[L.THUMB_IP], P[L.THUMB_TIP]);
  f.curl.thumb = 0.5 * (
    curlFromAngle(tMcp, config.thumbStraightAngle, config.thumbCurledAngle) +
    curlFromAngle(tIp, config.thumbStraightAngle, config.thumbCurledAngle));

  // --- palm plane (needed for spread and orientation) ---
  const normal = cross(sub(P[L.INDEX_FINGER_MCP], P[L.WRIST]), sub(P[L.PINKY_MCP], P[L.WRIST]));
  const nLen = len(normal);
  const unitN = nLen > 1e-12 ? { x: normal.x / nLen, y: normal.y / nLen, z: normal.z / nLen } : { x: 0, y: 0, z: 1 };

  // --- spread between neighbouring fingers ---
  // MCP→tip directions projected INTO the palm plane, so bending a finger toward the palm
  // (curl) doesn't register as spreading it sideways. Only meaningful for extended fingers.
  const dir = (name) => {
    const d = sub(P[TIPS[name]], P[JOINTS[name][0]]);
    const k = dot(d, unitN);
    return { x: d.x - k * unitN.x, y: d.y - k * unitN.y, z: d.z - k * unitN.z };
  };
  f.spread.indexMiddle = vecAngle(dir('index'), dir('middle'));
  f.spread.middleRing = vecAngle(dir('middle'), dir('ring'));
  f.spread.ringPinky = vecAngle(dir('ring'), dir('pinky'));
  f.spread.mean = (f.spread.indexMiddle + f.spread.middleRing + f.spread.ringPinky) / 3;

  // --- fingertip distances and tip-to-palm distances, in palm sizes ---
  const tip = (n) => P[TIPS[n]];
  f.tipDist.thumbIndex = dist(tip('thumb'), tip('index')) / palm;
  f.tipDist.thumbMiddle = dist(tip('thumb'), tip('middle')) / palm;
  f.tipDist.indexMiddle = dist(tip('index'), tip('middle')) / palm;
  f.tipDist.indexPinky = dist(tip('index'), tip('pinky')) / palm;

  const center = { x: 0, y: 0, z: 0 };
  for (const i of [L.WRIST, L.INDEX_FINGER_MCP, L.MIDDLE_FINGER_MCP, L.RING_FINGER_MCP, L.PINKY_MCP]) {
    center.x += P[i].x / 5; center.y += P[i].y / 5; center.z += P[i].z / 5;
  }
  for (const n of Object.keys(TIPS)) f.tipToPalm[n] = dist(tip(n), center) / palm;

  // --- palm orientation ---
  f.palm.facing = nLen > 1e-12 ? Math.abs(normal.z) / nLen : 0;

  const I = imagePoints(hand, frame);
  const axis = sub(I[L.MIDDLE_FINGER_MCP], I[L.WRIST]);
  const axis2d = Math.hypot(axis.x, axis.y);
  f.palm.tiltDeg = axis2d > 1e-9 ? deg(Math.acos(Math.min(1, Math.max(-1, -axis.y / axis2d)))) : 0;

  f.extendedCount = FINGERS.filter((n) => f.curl[n] < 0.35).length;
  f.curledCount = FINGERS.filter((n) => f.curl[n] > 0.65).length;
  return f;
}

/** Features describing the relation between two hands (image plane), or null. */
export function extractTwoHandFeatures(handA, handB, frame = null) {
  if (!handA || !handB) return null;
  const A = imagePoints(handA, frame);
  const B = imagePoints(handB, frame);
  const pa = palmSizeOf(A);
  const pb = palmSizeOf(B);
  if (!(pa > MIN_PALM) || !(pb > MIN_PALM)) return null;
  const avg = (pa + pb) / 2;
  const axisA = sub(A[L.MIDDLE_FINGER_MCP], A[L.WRIST]);
  const axisB = sub(B[L.MIDDLE_FINGER_MCP], B[L.WRIST]);
  axisA.z = 0; axisB.z = 0;
  return {
    wristDistance: dist(A[L.WRIST], B[L.WRIST]) / avg,
    indexTipDistance: dist(A[L.INDEX_FINGER_TIP], B[L.INDEX_FINGER_TIP]) / avg,
    relativeAngleDeg: vecAngle(axisA, axisB),
  };
}

/**
 * Features for a whole tracker frame.
 * @returns {{ hands: {handedness:string, stale:boolean, features:object}[], twoHand: object|null }}
 *   `hands` only lists usable hands (unusable ones are dropped).
 */
export function extractFrameFeatures(frame, config = GESTURE_CONFIG.features) {
  const out = { hands: [], twoHand: null };
  if (!frame || !Array.isArray(frame.hands)) return out;
  const usable = [];
  for (const hand of frame.hands) {
    const features = extractHandFeatures(hand, frame, config);
    if (!features) continue;
    usable.push(hand);
    out.hands.push({ handedness: hand.handedness || 'Unknown', stale: !!hand.stale, features });
  }
  if (usable.length >= 2) out.twoHand = extractTwoHandFeatures(usable[0], usable[1], frame);
  return out;
}

// SYNTHETIC hand-landmark generator for tests. NOT real data.
//
// Builds a 21-point hand from a simple kinematic model (palm + 3-segment fingers that bend
// toward the palm), then projects it like a pinhole camera into the same frame shape that
// HandTracker produces:  landmarks (normalised image coords), worldLandmarks (metres).
//
// What this proves: our feature/classifier/stabilizer code behaves correctly on hands whose
// geometry we control, including scale / distance / rotation / noise changes.
// What this does NOT prove: that a real person's hand, as reported by real MediaPipe, produces
// the same numbers. The model's proportions are our own approximation, and the thresholds in
// gestureConfig.js were checked against THIS model — so passing these tests is not evidence of
// real-world accuracy. Only a physical webcam test is.

// Palm-unit geometry (1 palm unit = wrist → middle-finger knuckle). Hand upright, palm to camera,
// +X right, +Y down, +Z toward the camera in this model (converted to MediaPipe's sign below).
const MCP = { index: [-0.38, -0.92], middle: [0.0, -1.0], ring: [0.22, -0.9], pinky: [0.42, -0.72] };
const SEG = { index: [0.45, 0.25, 0.22], middle: [0.5, 0.3, 0.24], ring: [0.45, 0.28, 0.23], pinky: [0.35, 0.2, 0.2] };
const FLEX_DEG = [85, 100, 65]; // MCP, PIP, DIP flexion at curl = 1
const FINGER_ORDER = ['index', 'middle', 'ring', 'pinky'];
const D2R = Math.PI / 180;

// Tiny seeded PRNG (mulberry32) + Box–Muller, so noisy tests are reproducible.
export function rng(seed) {
  let a = seed >>> 0;
  const uniform = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return () => Math.sqrt(-2 * Math.log(uniform() || 1e-12)) * Math.cos(2 * Math.PI * uniform());
}

/** Local hand model in palm units. curl 0..1 per finger, phi = in-plane finger angle (deg, 0 = straight up). */
function localHand(curl, phi) {
  const pts = new Array(21);
  pts[0] = [0, 0, 0];
  // thumb: leans outward, curls toward the palm centre
  {
    const t = curl.thumb;
    let p = [-0.25, -0.2, 0];
    pts[1] = p;
    let ang = -55; // degrees from up, negative = toward -x
    const lens = [0.35, 0.3, 0.25];
    for (let j = 0; j < 3; j++) {
      ang += t * [20, 40, 45][j];
      const a = ang * D2R;
      p = [p[0] + Math.sin(a) * lens[j], p[1] - Math.cos(a) * lens[j], p[2] + t * 0.12 * lens[j]];
      pts[2 + j] = p;
    }
  }
  FINGER_ORDER.forEach((name, fi) => {
    const base = 5 + fi * 4;
    const [mx, my] = MCP[name];
    let p = [mx, my, 0];
    pts[base] = p;
    const ph = (phi[name] || 0) * D2R;
    const u = [Math.sin(ph), -Math.cos(ph), 0];
    let theta = 0;
    for (let j = 0; j < 3; j++) {
      theta += curl[name] * FLEX_DEG[j] * D2R;
      const d = [u[0] * Math.cos(theta), u[1] * Math.cos(theta), Math.sin(theta)];
      p = [p[0] + d[0] * SEG[name][j], p[1] + d[1] * SEG[name][j], p[2] + d[2] * SEG[name][j]];
      pts[base + 1 + j] = p;
    }
  });
  return pts;
}

const rotZ = ([x, y, z], a) => [x * Math.cos(a) - y * Math.sin(a), x * Math.sin(a) + y * Math.cos(a), z];
const rotY = ([x, y, z], a) => [x * Math.cos(a) + z * Math.sin(a), y, -x * Math.sin(a) + z * Math.cos(a)];
const rotX = ([x, y, z], a) => [x, y * Math.cos(a) - z * Math.sin(a), y * Math.sin(a) + z * Math.cos(a)];

/**
 * One synthetic hand in tracker shape: { handedness, score, landmarks, worldLandmarks, stale }.
 * opts: curl{}, phi{}, handedness, palm (metres, default 0.09), cx/cy (image centre 0..1),
 *       depth (m, default 0.5), roll/yaw/pitch (deg), noise (metres σ), seed, aspect (W/H),
 *       mirror (build a left-hand mirror image), stale, noWorld
 */
export function makeHand(opts = {}) {
  const {
    curl = {}, phi = {}, handedness = 'Right', palm = 0.09, cx = 0.5, cy = 0.5, depth = 0.5,
    roll = 0, yaw = 0, pitch = 0, noise = 0, seed = 1, aspect = 640 / 480, mirror = false,
    stale = false, noWorld = false,
  } = opts;
  const c = { thumb: 0.3, index: 0, middle: 0, ring: 0, pinky: 0, ...curl };
  const local = localHand(c, phi).map(([x, y, z]) => [(mirror ? -x : x) * palm, y * palm, z * palm]);
  const n = rng(seed);
  const posed = local.map((p) => rotZ(rotX(rotY(p, yaw * D2R), pitch * D2R), roll * D2R));
  const cen = posed.reduce((s, p) => [s[0] + p[0] / 21, s[1] + p[1] / 21, s[2] + p[2] / 21], [0, 0, 0]);
  const wrist = posed[0];

  const world = posed.map((p) => [p[0] - cen[0] + n() * noise, p[1] - cen[1] + n() * noise, -(p[2] - cen[2]) + n() * noise]);
  const landmarks = posed.map((p) => {
    const dz = depth - p[2]; // +Z is toward the camera in the model
    return {
      x: cx + (p[0] - wrist[0] + n() * noise) / dz,
      y: cy + ((p[1] - wrist[1] + n() * noise) * aspect) / dz,
      z: -(p[2] - wrist[2]) / dz,
    };
  });
  return {
    handedness, score: 0.95, landmarks, stale,
    worldLandmarks: noWorld ? [] : world.map(([x, y, z]) => ({ x, y, z })),
  };
}

/** Finger curls / spreads for each supported sign (our own definitions, see gestureConfig.js). */
export const SIGN_POSES = {
  SNAKE: { curl: { thumb: 0.5, index: 0, middle: 0, ring: 0, pinky: 0 }, phi: { index: -4, middle: 0, ring: 4, pinky: 8 } },
  TIGER: { curl: { thumb: 0.8, index: 0, middle: 0, ring: 0.95, pinky: 0.95 }, phi: { index: -3, middle: 3 } },
  HORSE: { curl: { thumb: 0.8, index: 0, middle: 0.95, ring: 0.95, pinky: 0.95 }, phi: {} },
  RAM:   { curl: { thumb: 0.8, index: 0, middle: 0.95, ring: 0.95, pinky: 0 }, phi: { index: -15, pinky: 18 } },
};

/** Poses that should NOT be any of the four signs. */
export const OTHER_POSES = {
  OPEN_SPREAD: { curl: { thumb: 0, index: 0, middle: 0, ring: 0, pinky: 0 }, phi: { index: -35, middle: -12, ring: 12, pinky: 35 } },
  FIST: { curl: { thumb: 0.8, index: 0.95, middle: 0.95, ring: 0.95, pinky: 0.95 }, phi: {} },
  HALF_CURL: { curl: { thumb: 0.4, index: 0.5, middle: 0.5, ring: 0.5, pinky: 0.5 }, phi: {} },
};

/** Convenience: a hand making one of the SIGN_POSES / OTHER_POSES (extra opts override). */
export function signHand(name, opts = {}) {
  const pose = SIGN_POSES[name] || OTHER_POSES[name];
  if (!pose) throw new Error(`unknown pose ${name}`);
  return makeHand({ ...pose, ...opts, curl: { ...pose.curl, ...(opts.curl || {}) }, phi: { ...pose.phi, ...(opts.phi || {}) } });
}

/** Wrap hands in the frame shape HandTracker emits. */
export function makeFrame(hands, { t = 0, frameId = 1, videoWidth = 640, videoHeight = 480 } = {}) {
  const sorted = hands.slice();
  return {
    frameId, timestamp: t, hasHand: sorted.length > 0, hands: sorted,
    left: sorted.find((h) => h.handedness === 'Left') || null,
    right: sorted.find((h) => h.handedness === 'Right') || null,
    rawHandCount: sorted.filter((h) => !h.stale).length, videoWidth, videoHeight,
  };
}

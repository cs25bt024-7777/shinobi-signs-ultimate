// TEST DOUBLE for @mediapipe/tasks-vision (NOT shipped with the game).
//
// The browser tests intercept the CDN URL for vision_bundle.mjs and serve this
// file instead, because the test machine has no internet access. It mimics the
// small part of the real API that src/input/mediapipeBackend.js uses:
//
//   FilesetResolver.forVisionTasks(wasmBase)
//   HandLandmarker.createFromOptions(fileset, options) → { detectForVideo, close }
//
// IMPORTANT: this is a stand-in, so tests using it prove our code (backend,
// tracker, panel, mirroring) works against the documented API shape – they do
// NOT prove MediaPipe's own accuracy. Real inference needs a real browser.
//
// What the fake detector does: it looks at the actual pixels of the video frame
// it is handed and finds the magenta marker square from tests/fixtures/marker.y4m.
// The reported hand is placed on that marker, so the landmarks are tied to what
// the camera really shows. Test controls live on window.__fake:
//   mode: 'marker' (one Right hand on the marker) | 'two' (+ a Left hand) | 'none'
//   busyMs: busy-wait per detection, to emulate slow inference
//   failGpu: make createFromOptions throw for delegate 'GPU'
//   raw: if set, detectForVideo returns this object as-is (Phase 4 injects synthetic sign hands)

const state = (window.__stub = {
  created: [],          // options passed to createFromOptions
  forVisionTasks: [],   // wasm base URLs
  calls: 0,
  timestamps: [],
  badArgs: 0,           // detectForVideo called with something that isn't a ready <video>
  decreasing: 0,        // timestamps that did not strictly increase
});
window.__fake = window.__fake || { mode: 'marker', busyMs: 0, failGpu: false };

// A hand-like shape in camera space: offsets (fractions of the frame) from its own centroid.
function handShape() {
  const pts = [[0, 0.16]]; // 0 wrist
  const fingers = [ // [base angle°, length] – thumb first, then index..pinky
    [-130, 0.16], [-100, 0.22], [-88, 0.25], [-76, 0.23], [-62, 0.18],
  ];
  fingers.forEach(([deg, len], i) => {
    const a = (deg * Math.PI) / 180;
    const baseR = i === 0 ? 0.05 : 0.11;
    for (let j = 0; j < 4; j++) {
      const r = baseR + ((len - baseR) * j) / 3;
      pts.push([Math.cos(a) * r * 0.9, 0.16 + Math.sin(a) * r]);
    }
  });
  const cx = pts.reduce((s, p) => s + p[0], 0) / pts.length;
  const cy = pts.reduce((s, p) => s + p[1], 0) / pts.length;
  return pts.map(([x, y]) => [x - cx, y - cy]);
}
const SHAPE = handShape();
const place = (cx, cy) => SHAPE.map(([dx, dy], i) => ({ x: cx + dx * 0.75, y: cy + dy, z: -0.01 * i }));

const probe = document.createElement('canvas');
probe.width = 64; probe.height = 48;
const pctx = probe.getContext('2d', { willReadFrequently: true });

/** Centroid (0..1) of magenta pixels in the current video frame, or null. */
function findMarker(video) {
  pctx.drawImage(video, 0, 0, 64, 48);
  const d = pctx.getImageData(0, 0, 64, 48).data;
  let sx = 0, sy = 0, n = 0;
  for (let y = 0; y < 48; y++) {
    for (let x = 0; x < 64; x++) {
      const i = (y * 64 + x) * 4;
      if (d[i] > 180 && d[i + 2] > 180 && d[i + 1] < 100) { sx += x + 0.5; sy += y + 0.5; n++; }
    }
  }
  return n >= 6 ? { x: sx / n / 64, y: sy / n / 48 } : null;
}

export class FilesetResolver {
  static async forVisionTasks(base) {
    state.forVisionTasks.push(base);
    return { base };
  }
}

export class HandLandmarker {
  static async createFromOptions(fileset, options) {
    state.created.push(JSON.parse(JSON.stringify(options)));
    if (window.__fake.failGpu && options.baseOptions.delegate === 'GPU') {
      throw new Error('GPU delegate not supported (test)');
    }
    await new Promise((r) => setTimeout(r, window.__fake.loadMs || 0));
    return new HandLandmarker(options);
  }

  constructor(options) { this.options = options; }

  detectForVideo(video, timestampMs) {
    state.calls++;
    if (!(video instanceof HTMLVideoElement) || video.readyState < 2 || !video.videoWidth) state.badArgs++;
    const prev = state.timestamps[state.timestamps.length - 1];
    if (prev !== undefined && !(timestampMs > prev)) state.decreasing++;
    state.timestamps.push(timestampMs);
    if (state.timestamps.length > 2000) state.timestamps.shift();

    const busy = window.__fake.busyMs;
    if (busy) { const end = performance.now() + busy; while (performance.now() < end); }

    // Phase 4: a test can inject a complete raw detection result (synthetic hands making signs).
    if (window.__fake.raw) return window.__fake.raw;

    const mode = window.__fake.mode;
    const result = { landmarks: [], worldLandmarks: [], handedness: [] };
    if (mode === 'none') return result;

    const m = findMarker(video);
    if (m) {
      result.landmarks.push(place(m.x, m.y));
      result.worldLandmarks.push(SHAPE.map(([x, y]) => ({ x: x * 0.2, y: y * 0.2, z: 0 })));
      // Label convention: MediaPipe's docs say Left/Right refer to the subject's own
      // hands when given the raw (un-mirrored) frame, so the marker hand is "Right".
      // (Not verified against real hardware – see README "Known limitations".)
      result.handedness.push([{ categoryName: 'Right', score: 0.97, index: 0 }]);
    }
    if (mode === 'two') {
      result.landmarks.push(place(0.7, 0.5));
      result.worldLandmarks.push(SHAPE.map(([x, y]) => ({ x: x * 0.2, y: y * 0.2, z: 0 })));
      result.handedness.push([{ categoryName: 'Left', score: 0.95, index: 1 }]);
    }
    return result;
  }

  close() { state.closed = (state.closed || 0) + 1; }
}

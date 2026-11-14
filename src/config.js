// Central place for tunable numbers. Later phases (combat, signs, network)
// add their own sections here instead of scattering magic numbers.

export const CONFIG = {
  // Logical canvas size. CSS scales it to fit the window (16:9).
  width: 1280,
  height: 720,

  // Y of the horizon / top edge of the fighting ground.
  horizonY: 540,
  // Y where the characters' feet stand (inside the ground band).
  feetY: 630,

  maxHp: 100,

  // Hand tracking (Phase 3). The MediaPipe library is loaded from a CDN, pinned to
  // an exact version so its behaviour doesn't change under us. The model URL is the
  // one in Google's HandLandmarker docs ("latest"); to pin it too, replace `latest`
  // with `1`. To go offline, download the three files and use local paths (see README).
  handTracking: {
    moduleUrl: 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.32/vision_bundle.mjs',
    wasmBaseUrl: 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.32/wasm',
    modelUrl:
      'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/latest/hand_landmarker.task',

    numHands: 2,                       // track up to two hands (some signs use both)
    minHandDetectionConfidence: 0.5,
    minHandPresenceConfidence: 0.5,
    minTrackingConfidence: 0.5,

    maxFps: 30,                        // cap on detections per second
    holdMs: 250,                       // a vanished hand stays "present" this long (anti-flicker)
    swapHandedness: false,             // set true if LEFT/RIGHT come out reversed on your setup
  },

  // Sign recognition (Phase 4). Thresholds live in src/input/gestureConfig.js.
  signs: {
    // Developer overlay with confidence, per-sign scores and feature values. Keep false for the
    // final game. Also switchable at runtime: add ?debug=signs to the URL, or press [D].
    debug: false,
  },

  // Per-player layout + look. Index 0 = Player 1 (left), 1 = Player 2 (right).
  players: [
    {
      label: 'P1',
      spriteWidth: 280,
      spriteHeight: 280,
      x: 340,
      facing: 1, // 1 = faces right
      palette: { suit: '#1e3a5f', suitLight: '#2d5a8c', accent: '#4cc9f0', skin: '#f2c9a0' },
    },
    {
      label: 'P2',
      spriteWidth: 280,
      spriteHeight: 280,
      x: 940,
      facing: -1, // -1 = faces left
      palette: { suit: '#5a1e24', suitLight: '#8c2d38', accent: '#ff5d5d', skin: '#f2c9a0' },
    },
  ],
};

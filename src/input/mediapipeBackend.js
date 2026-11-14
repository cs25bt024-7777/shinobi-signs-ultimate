// MediaPipe backend for HandTracker (Phase 3).
//
// Uses MediaPipe "Tasks Vision" → HandLandmarker, loaded from a CDN at runtime
// (no npm install, no build step). Everything MediaPipe-specific lives here, so
// the rest of the game never imports MediaPipe and the library version can be
// changed in config.js alone.
//
// What gets downloaded when the camera first connects:
//   1. vision_bundle.mjs  – the JS API                (small)
//   2. wasm/…             – the WebAssembly runtime   (a few MB)
//   3. hand_landmarker.task – the hand model          (several MB, float16)
// Browsers cache all three, so later loads are fast.
//
// To run fully offline, download those files into the project and point the
// three URLs in config.js (handTracking.*) at the local copies.

export class MediaPipeHandBackend {
  /**
   * @param {object} opts  see CONFIG.handTracking in config.js
   */
  constructor(opts) {
    this.opts = opts;
    this.landmarker = null;
    this.delegate = null; // 'GPU' or 'CPU' – whichever actually started
    this._attempts = 0;
  }

  async init() {
    const o = this.opts;

    // Dynamic import of an absolute URL: works in any modern browser, no bundler.
    // Browsers remember a FAILED import of a URL for the rest of the page's life,
    // so a retry after a network error uses a throw-away query string to get a
    // fresh fetch (CDNs ignore it).
    const attempt = this._attempts++;
    let lib;
    try {
      lib = await import(attempt ? `${o.moduleUrl}?retry=${attempt}` : o.moduleUrl);
    } catch (err) {
      console.error('Could not load the MediaPipe library:', err);
      throw new Error('Could not download the hand-tracking library. Check your internet connection, then retry.');
    }
    const { FilesetResolver, HandLandmarker } = lib;
    const fileset = await FilesetResolver.forVisionTasks(o.wasmBaseUrl);

    const create = (delegate) =>
      HandLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: o.modelUrl, delegate },
        runningMode: 'VIDEO',
        numHands: o.numHands,
        minHandDetectionConfidence: o.minHandDetectionConfidence,
        minHandPresenceConfidence: o.minHandPresenceConfidence,
        minTrackingConfidence: o.minTrackingConfidence,
      });

    // GPU is much faster but not available everywhere; fall back to CPU.
    try {
      this.landmarker = await create('GPU');
      this.delegate = 'GPU';
    } catch (gpuError) {
      console.warn('MediaPipe GPU delegate unavailable, using CPU:', gpuError);
      try {
        this.landmarker = await create('CPU');
        this.delegate = 'CPU';
      } catch (cpuError) {
        console.error('Could not create the hand landmarker:', cpuError);
        throw new Error(`Could not load the hand model (${(cpuError && cpuError.message) || cpuError}).`);
      }
    }
  }

  /**
   * Run detection on the current video frame (synchronous – a few ms).
   * `timestampMs` must increase on every call; HandTracker guarantees that.
   * @returns the raw HandLandmarkerResult { landmarks, worldLandmarks, handedness }
   */
  detect(video, timestampMs) {
    return this.landmarker.detectForVideo(video, timestampMs);
  }

  close() {
    if (this.landmarker) this.landmarker.close();
    this.landmarker = null;
  }
}

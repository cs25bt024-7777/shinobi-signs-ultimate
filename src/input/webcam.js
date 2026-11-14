// Webcam capture (Phase 2).
//
// Pipeline (future phases plug in to the right of this module):
//
//   Webcam  ──►  <video> element / MediaStream  ──►  HandTracker (Phase 3)
//                                                   ──►  Gesture recognition (4)
//                                                   ──►  Sequence recognition (5)
//                                                   ──►  Combat
//
// This module only owns camera access. It knows nothing about the HUD, hand
// tracking or the game. Other modules consume it like this:
//
//   const cam = new Webcam();
//   cam.onStateChange(({ state }) => { ... });
//   await cam.start();
//   if (cam.isConnected) tracker.processFrame(cam.video);   // Phase 3
//
// IMPORTANT for Phase 3: the stream itself is NOT mirrored. The mirrored look
// of the preview is done purely in CSS on the <video> element. Landmark x
// coordinates from a tracker will therefore be in "camera space"; flip them
// (x → 1 - x) when drawing them over the mirrored preview.

/** Every state the camera can be in. UI code switches on these. */
export const CameraState = Object.freeze({
  IDLE: 'idle',               // start() not called yet (or stop() was called)
  REQUESTING: 'requesting',   // waiting for the browser permission prompt / camera
  CONNECTED: 'connected',     // video is playing
  DENIED: 'denied',           // user (or policy) refused permission
  NO_DEVICE: 'no-device',     // no camera hardware found
  UNAVAILABLE: 'unavailable', // anything else: in use, unplugged, insecure page, ...
});

/**
 * Turn a getUserMedia error into { state, detail }.
 * Exported separately so it can be tested without a camera.
 */
export function classifyCameraError(err) {
  const name = err && err.name;
  switch (name) {
    case 'NotAllowedError':
    case 'PermissionDeniedError':
    case 'SecurityError':
      return { state: CameraState.DENIED, detail: 'Camera permission was denied.' };
    case 'NotFoundError':
    case 'DevicesNotFoundError':
      return { state: CameraState.NO_DEVICE, detail: 'No camera was found on this device.' };
    case 'NotReadableError':
    case 'TrackStartError':
    case 'AbortError':
      return {
        state: CameraState.UNAVAILABLE,
        detail: 'The camera could not be started. It may be in use by another app or tab.',
      };
    case 'OverconstrainedError':
    case 'ConstraintNotSatisfiedError':
      return {
        state: CameraState.UNAVAILABLE,
        detail: 'The camera does not support the requested video settings.',
      };
    default:
      return {
        state: CameraState.UNAVAILABLE,
        detail: `Camera error${name ? ` (${name})` : ''}.`,
      };
  }
}

export class Webcam {
  /**
   * @param {object} [opts]
   * @param {number} [opts.width=640]      ideal capture width
   * @param {number} [opts.height=480]     ideal capture height
   * @param {number} [opts.frameRate=30]   ideal frame rate
   */
  constructor({ width = 640, height = 480, frameRate = 30 } = {}) {
    this.constraints = {
      video: {
        width: { ideal: width },
        height: { ideal: height },
        frameRate: { ideal: frameRate },
        facingMode: 'user', // front camera on phones/tablets
      },
      audio: false, // voice chat is a future feature; never ask for the mic now
    };

    // One <video> element for the whole app. The preview panel mounts it in the
    // DOM and a hand tracker can read frames from the very same element.
    this.video = document.createElement('video');
    this.video.autoplay = true;
    this.video.muted = true;       // required for autoplay in most browsers
    this.video.playsInline = true; // iOS Safari: don't force fullscreen

    this._state = CameraState.IDLE;
    this._detail = '';
    this._stream = null;
    this._listeners = new Set();
    this._startToken = 0; // lets stop() cancel a start() that is still pending
  }

  // ---------- read-only info ----------

  /** One of CameraState.* */
  get state() { return this._state; }

  /** Human-readable explanation for error states ('' otherwise). */
  get detail() { return this._detail; }

  get isConnected() { return this._state === CameraState.CONNECTED; }

  /** The live MediaStream, or null when not connected. */
  get stream() { return this._stream; }

  /** Actual capture size in pixels (0×0 until connected). */
  get videoWidth() { return this.video.videoWidth; }
  get videoHeight() { return this.video.videoHeight; }

  /**
   * Subscribe to state changes. The listener is also called once immediately
   * with the current state so late subscribers don't miss it.
   * @returns {() => void} unsubscribe function
   */
  onStateChange(listener) {
    this._listeners.add(listener);
    listener({ state: this._state, detail: this._detail });
    return () => this._listeners.delete(listener);
  }

  // ---------- control ----------

  /**
   * Ask for camera permission and start streaming.
   * Never throws: failures are reported through the state (DENIED, NO_DEVICE, ...).
   * Safe to call again to retry after a failure.
   */
  async start() {
    if (this._state === CameraState.REQUESTING || this._state === CameraState.CONNECTED) return;

    // navigator.mediaDevices is undefined on insecure origins (plain http on a
    // non-localhost host) and in very old browsers.
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      this._setState(
        CameraState.UNAVAILABLE,
        'Camera access needs a secure page. Open the game via http://localhost or https://.'
      );
      return;
    }

    const token = ++this._startToken;
    this._setState(CameraState.REQUESTING);

    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia(this.constraints);
    } catch (err) {
      if (token !== this._startToken) return; // cancelled by stop()
      const { state, detail } = classifyCameraError(err);
      this._setState(state, detail);
      return;
    }

    if (token !== this._startToken) {
      // stop() was called while the permission prompt was open – release the camera.
      stream.getTracks().forEach((t) => t.stop());
      return;
    }

    this._stream = stream;
    this.video.srcObject = stream;

    // If the camera is unplugged or taken by another app, report it.
    const track = stream.getVideoTracks()[0];
    if (track) {
      track.addEventListener('ended', () => {
        if (this._stream === stream) {
          this._releaseStream();
          this._setState(CameraState.UNAVAILABLE, 'The camera was disconnected.');
        }
      });
    }

    try {
      await this.video.play();
    } catch (err) {
      if (token !== this._startToken) return;
      this._releaseStream();
      this._setState(CameraState.UNAVAILABLE, 'The video could not be played.');
      return;
    }

    if (token !== this._startToken) return;
    this._setState(CameraState.CONNECTED);
  }

  /** Stop the camera and release the device (the camera light turns off). */
  stop() {
    this._startToken++; // invalidate any pending start()
    this._releaseStream();
    this._setState(CameraState.IDLE);
  }

  // ---------- internals ----------

  _releaseStream() {
    if (this._stream) {
      this._stream.getTracks().forEach((t) => t.stop());
      this._stream = null;
    }
    this.video.srcObject = null;
  }

  _setState(state, detail = '') {
    this._state = state;
    this._detail = detail;
    for (const listener of this._listeners) listener({ state, detail });
  }
}

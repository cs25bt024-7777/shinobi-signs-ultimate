// Webcam preview panel: shows the mirrored camera feed, a camera status line,
// the hand-tracking status ("HAND DETECTED ✓" / "NO HAND DETECTED") and the
// hand-landmark overlay. It only *displays* things: camera logic lives in
// input/webcam.js and hand tracking in input/handTracker.js.

import { CameraState } from '../input/webcam.js';
import { TrackerStatus, HAND_CONNECTIONS } from '../input/handTracker.js';
import { GESTURE_CONFIG } from '../input/gestureConfig.js';

// Text shown over the feed for each camera state (title + optional hint line).
const OVERLAY = {
  [CameraState.IDLE]:        { title: 'CAMERA OFF', hint: '' },
  [CameraState.CONNECTED]:   { title: '', hint: '' }, // overlay is hidden by CSS when connected
  [CameraState.REQUESTING]:  { title: 'WAITING FOR PERMISSION…', hint: 'Choose "Allow" in your browser prompt.' },
  [CameraState.DENIED]:      { title: 'PERMISSION DENIED', hint: 'Allow the camera via the lock/camera icon in the address bar, then retry.' },
  [CameraState.NO_DEVICE]:   { title: 'NO CAMERA DETECTED', hint: 'Connect a webcam, then retry.' },
  [CameraState.UNAVAILABLE]: { title: 'CAMERA UNAVAILABLE', hint: '' }, // hint comes from webcam.detail
};

// Short status line under the feed.
const STATUS_TEXT = {
  [CameraState.IDLE]:        'CAMERA: OFF',
  [CameraState.REQUESTING]:  'CAMERA: REQUESTING…',
  [CameraState.CONNECTED]:   'CAMERA: CONNECTED',
  [CameraState.DENIED]:      'CAMERA: NOT AVAILABLE',
  [CameraState.NO_DEVICE]:   'CAMERA: NOT AVAILABLE',
  [CameraState.UNAVAILABLE]: 'CAMERA: NOT AVAILABLE',
};

const HAND_COLORS = { Left: '#4cc9f0', Right: '#ffb347', Unknown: '#c8a2ff' };
const CANVAS_W = 480; // internal overlay resolution; CSS scales it to the panel

export class WebcamPanel {
  /**
   * @param {import('../input/webcam.js').Webcam} webcam
   * @param {HTMLElement} root  the #webcam-panel element from index.html
   * @param {import('../input/handTracker.js').HandTracker} [handTracker]
   */
  constructor(webcam, root, handTracker = null) {
    this.webcam = webcam;
    this.root = root;
    this.tracker = handTracker;
    this.feed = root.querySelector('.cam-feed');
    this.title = root.querySelector('.cam-overlay-title');
    this.hint = root.querySelector('.cam-overlay-hint');
    this.retry = root.querySelector('.cam-retry');
    this.statusText = root.querySelector('.cam-status-text');
    this.handText = root.querySelector('.cam-hand-text');
    this.handDetail = root.querySelector('.cam-hand-detail');
    this.statsEl = root.querySelector('.cam-stats');
    this.handRetry = root.querySelector('.cam-hand-retry');
    this.signBox = root.querySelector('.cam-sign');
    this.signValue = root.querySelector('.cam-sign-value');
    this.signConf = root.querySelector('.cam-sign-conf');

    // Mount the shared <video> element. It is mirrored with CSS (see style.css),
    // so the stream itself stays un-mirrored for the hand tracker.
    this.feed.prepend(webcam.video);

    this.retry.addEventListener('click', () => webcam.start());
    webcam.onStateChange((s) => this._render(s));

    if (handTracker) this._initHandOverlay(handTracker);
  }

  // ---------- camera ----------

  _render({ state, detail }) {
    this.root.dataset.state = state;
    this.statusText.textContent = STATUS_TEXT[state];

    const o = OVERLAY[state];
    this.title.textContent = o.title;
    this.hint.textContent = state === CameraState.UNAVAILABLE ? detail : o.hint;

    // A retry button is useful for every failed state.
    this.retry.hidden = !(
      state === CameraState.DENIED ||
      state === CameraState.NO_DEVICE ||
      state === CameraState.UNAVAILABLE
    );
  }

  // ---------- sign recognition (Phase 4) ----------

  /**
   * Show the stabilised sign from SignPipeline. With no hand the whole block is hidden
   * (the hand row already says NO HAND DETECTED); with a hand but no sign it says UNKNOWN.
   * @param {{hasHand:boolean, currentSign:string|null, confidence:number}} state
   */
  renderSign(state) {
    if (!this.signBox) return;
    const show = !!(state && state.hasHand);
    this.signBox.hidden = !show;
    if (!show) { this.signBox.dataset.sign = 'none'; return; }
    if (state.currentSign) {
      const def = GESTURE_CONFIG.signs[state.currentSign];
      this.signValue.textContent = `${def && def.icon ? def.icon + ' ' : ''}${state.currentSign}`;
      this.signConf.textContent = `${Math.round(state.confidence * 100)}%`;
      this.signBox.dataset.sign = 'active';
    } else {
      this.signValue.textContent = 'UNKNOWN';
      this.signConf.textContent = '—';
      this.signBox.dataset.sign = 'unknown';
    }
  }

  // ---------- hand tracking ----------

  _initHandOverlay(tracker) {
    // Landmark canvas: stacked exactly on the video and flipped with the SAME CSS
    // transform (scaleX(-1)). Landmarks are in camera space, so the overlay
    // stays aligned with the mirrored picture without any per-point math.
    // If the hand model failed to load (e.g. offline), let the player try again.
    this.handRetry.addEventListener('click', () => tracker.start());

    this.canvas = document.createElement('canvas');
    this.canvas.className = 'cam-landmarks';
    this.canvas.width = CANVAS_W;
    this.canvas.height = Math.round((CANVAS_W * 3) / 4);
    this.ctx = this.canvas.getContext('2d');
    this.webcam.video.after(this.canvas);

    // Keep the preview box and overlay at the camera's true aspect ratio
    // (webcams may deliver 4:3 or 16:9), so nothing is cropped or misaligned.
    const sync = () => this._syncAspect();
    this.webcam.video.addEventListener('loadedmetadata', sync);
    this.webcam.video.addEventListener('resize', sync);

    this._frame = tracker.latest;
    this._statsShownAt = 0;
    tracker.onStatusChange(() => {
      this._renderHand();
      this._renderStats(Infinity); // loading / error text must not wait for a hand frame
    });
    tracker.onResult((frame) => {
      this._frame = frame;
      this._drawHands(frame);
      this._renderHand();
      this._renderStats(frame.timestamp);
    });
  }

  _syncAspect() {
    const { videoWidth: w, videoHeight: h } = this.webcam.video;
    if (!w || !h) return;
    this.feed.style.aspectRatio = `${w} / ${h}`;
    this.canvas.height = Math.round((CANVAS_W * h) / w);
  }

  /** Draw every hand: coloured skeleton + white joints (camera space; CSS mirrors it). */
  _drawHands(frame) {
    const { ctx, canvas } = this;
    const W = canvas.width;
    const H = canvas.height;
    ctx.clearRect(0, 0, W, H);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    for (const hand of frame.hands) {
      const color = HAND_COLORS[hand.handedness] || HAND_COLORS.Unknown;
      const pts = hand.landmarks;
      ctx.globalAlpha = hand.stale ? 0.35 : 1; // held-over hands are drawn faded

      ctx.strokeStyle = color;
      ctx.lineWidth = 3;
      ctx.beginPath();
      for (const [a, b] of HAND_CONNECTIONS) {
        ctx.moveTo(pts[a].x * W, pts[a].y * H);
        ctx.lineTo(pts[b].x * W, pts[b].y * H);
      }
      ctx.stroke();

      ctx.fillStyle = '#ffffff';
      ctx.lineWidth = 2;
      for (let i = 0; i < pts.length; i++) {
        ctx.beginPath();
        ctx.arc(pts[i].x * W, pts[i].y * H, i === 0 ? 6 : 4, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;
  }

  /** "HAND DETECTED ✓" / "NO HAND DETECTED", or the tracker's loading/error state. */
  _renderHand() {
    const tracker = this.tracker;
    const frame = this._frame;
    let hand;
    let text;
    let detail = '';

    if (tracker.status === TrackerStatus.LOADING) {
      hand = 'loading';
      text = 'TRACKER: LOADING…';
    } else if (tracker.status === TrackerStatus.ERROR) {
      hand = 'error';
      text = 'TRACKER: UNAVAILABLE';
    } else if (frame && frame.hasHand) {
      hand = 'detected';
      text = 'HAND DETECTED ✓';
      detail = frame.hands.length > 1 ? 'L + R' : frame.hands[0].handedness.toUpperCase();
      if (detail === 'UNKNOWN') detail = '';
    } else {
      hand = 'none';
      text = 'NO HAND DETECTED';
    }

    this.handRetry.hidden = tracker.status !== TrackerStatus.ERROR;
    this.root.dataset.hand = hand;
    this.root.dataset.handCount = String(frame ? frame.hands.length : 0);
    this.handText.textContent = text;
    this.handDetail.textContent = detail;
  }

  /** Small performance / diagnostics line, refreshed about 4 times a second. */
  _renderStats(now) {
    const tracker = this.tracker;
    if (tracker.status === TrackerStatus.ERROR) {
      this.statsEl.textContent = tracker.statusDetail;
    } else if (tracker.status === TrackerStatus.LOADING) {
      this.statsEl.textContent = 'Downloading hand model…';
    } else if (now - this._statsShownAt > 250) {
      const s = tracker.stats;
      // `now` is Infinity when forced by a status change; storing that would freeze the line forever.
      if (Number.isFinite(now)) this._statsShownAt = now;
      this.statsEl.textContent = s.processed ? `TRACKING ${s.fps} FPS · ${s.detectMs.toFixed(1)} MS` : '';
    }
  }
}

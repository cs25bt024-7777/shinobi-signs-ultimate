// Developer overlay for sign recognition (Phase 4). Display only: it renders whatever
// SignPipeline.process() returned. Keep it off in the final game (CONFIG.signs.debug = false).

const pct = (v) => `${Math.round(v * 100)}%`;
const f2 = (v) => (Number.isFinite(v) ? v.toFixed(2) : '—');

export class SignDebugOverlay {
  /** @param {HTMLElement} el  a <pre> element */
  constructor(el, { enabled = false } = {}) {
    this.el = el;
    this.enabled = false;
    this.last = null;
    this.setEnabled(enabled);
  }

  setEnabled(on) {
    this.enabled = !!on;
    this.el.hidden = !this.enabled;
    if (this.enabled && this.last) this.update(this.last);
  }

  toggle() { this.setEnabled(!this.enabled); }

  /** @param {object} state  SignPipeline output (see signPipeline.js) */
  update(state) {
    this.last = state;
    if (!this.enabled) return;
    this.el.textContent = formatDebug(state);
  }
}

/** Pure text builder (exported so tests can check the content without a DOM). */
export function formatDebug(state) {
  if (!state) return 'no data';
  const lines = [];
  lines.push(`CURRENT SIGN: ${state.currentSign || 'UNKNOWN'}`);
  lines.push(`CONFIDENCE:   ${state.currentSign ? pct(state.confidence) : '—'}`);
  const raw = state.raw || {};
  lines.push(`RAW (this frame): ${raw.sign || 'UNKNOWN'} ${raw.sign ? pct(raw.confidence) : ''}`.trimEnd());
  if (state.candidate) lines.push(`CONFIRMING: ${state.candidate}`);
  lines.push('');
  if (raw.scores) {
    lines.push('Scores: ' + Object.entries(raw.scores).map(([k, v]) => `${k} ${f2(v)}`).join('  '));
  }
  const hands = raw.features && raw.features.hands;
  if (!hands || hands.length === 0) {
    lines.push('No hand features');
  } else {
    hands.forEach((h, i) => {
      const x = h.features;
      lines.push('');
      lines.push(`Hand ${i + 1} (${h.handedness}${h.stale ? ', held' : ''})`);
      lines.push(`Thumb curl:  ${f2(x.curl.thumb)}`);
      lines.push(`Index curl:  ${f2(x.curl.index)}`);
      lines.push(`Middle curl: ${f2(x.curl.middle)}`);
      lines.push(`Ring curl:   ${f2(x.curl.ring)}`);
      lines.push(`Pinky curl:  ${f2(x.curl.pinky)}`);
      lines.push(`Spread mean: ${x.spread.mean.toFixed(0)}°  idx-mid ${x.spread.indexMiddle.toFixed(0)}°`);
      lines.push(`Tip gap idx-pinky: ${f2(x.tipDist.indexPinky)}`);
      lines.push(`Palm tilt:   ${x.palm.tiltDeg.toFixed(0)}°   facing ${f2(x.palm.facing)}`);
    });
    const th = raw.features.twoHand;
    if (th) lines.push('', `Two hands: wrists ${f2(th.wristDistance)}  angle ${th.relativeAngleDeg.toFixed(0)}°`);
  }
  return lines.join('\n');
}

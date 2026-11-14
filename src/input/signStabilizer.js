// Temporal smoothing for sign recognition (Phase 4).
//
//   per-frame classifier output ─► SignStabilizer.update() ─► stable sign + change events
//
// Pure logic driven by the timestamps you pass in (no timers, no DOM), so it is fully
// deterministic and testable with a fake clock.
//
// Rules:
//   • ENTER: a sign different from the active one must be observed with confidence ≥
//     enterConfidence for holdMs in a row (candidateGraceMs of gaps are forgiven) before it
//     becomes active. The classifier's own minConfidence is the lower EXIT threshold, so the
//     active sign survives small confidence dips (hysteresis).
//   • HOLD: seeing the active sign again resets everything. Holding a sign for any length of
//     time never produces another event.
//   • RELEASE: when the active sign is not observed (UNKNOWN, another sign that hasn't become
//     active yet, or no hand) for releaseMs, the state falls back to UNKNOWN.
//   • A direct switch SNAKE → TIGER happens as soon as TIGER has been stable for holdMs,
//     without passing through UNKNOWN.
//
// Output of update():
//   {
//     currentSign,    // active sign name, or null (= UNKNOWN)
//     confidence,     // latest confidence for the active sign (0 if none)
//     signChanged,    // true ONLY on the frame where currentSign changed (including → UNKNOWN)
//     previousSign,   // the sign before the change (meaningful when signChanged)
//     newSign,        // currentSign on a change TO a real sign, else null. Phase 5 should use
//                     // this as its one-event-per-sign input.
//     candidate,      // sign currently being confirmed, or null
//     hasHand,
//   }

import { GESTURE_CONFIG } from './gestureConfig.js';

export class SignStabilizer {
  constructor(config = GESTURE_CONFIG.stabilizer) {
    this.config = config;
    this.reset();
  }

  reset() {
    this.active = null;
    this.activeConfidence = 0;
    this.candidate = null;       // { sign, since, lastSeen }
    this.missingSince = null;    // when the active sign stopped being observed
  }

  /**
   * @param {{sign:string|null, confidence:number}} observation  raw classifier output for one frame
   * @param {number} t          timestamp in ms (must not go backwards)
   * @param {boolean} hasHand   whether any hand was present this frame
   */
  update(observation, t, hasHand = true) {
    const cfg = this.config;
    const sign = observation && observation.sign ? observation.sign : null;
    const conf = sign ? observation.confidence : 0;
    let changed = false;
    const previous = this.active;

    if (sign && sign === this.active) {
      // Still holding the active sign.
      this.activeConfidence = conf;
      this.candidate = null;
      this.missingSince = null;
    } else {
      // The active sign (if any) is not being observed this frame.
      if (this.active !== null && this.missingSince === null) this.missingSince = t;

      // Track a candidate for a different sign (needs the higher ENTER confidence).
      if (sign && conf >= cfg.enterConfidence) {
        if (!this.candidate || this.candidate.sign !== sign || t - this.candidate.lastSeen > cfg.candidateGraceMs) {
          this.candidate = { sign, since: t, lastSeen: t };
        } else {
          this.candidate.lastSeen = t;
        }
        if (t - this.candidate.since >= cfg.holdMs) {
          this.active = sign;
          this.activeConfidence = conf;
          this.candidate = null;
          this.missingSince = null;
          changed = true;
        }
      } else if (this.candidate && t - this.candidate.lastSeen > cfg.candidateGraceMs) {
        this.candidate = null;
      }

      // Release the active sign after it has been missing long enough.
      if (!changed && this.active !== null && this.missingSince !== null && t - this.missingSince >= cfg.releaseMs) {
        this.active = null;
        this.activeConfidence = 0;
        this.missingSince = null;
        changed = true;
      }
    }

    return {
      currentSign: this.active,
      confidence: this.active ? this.activeConfidence : 0,
      signChanged: changed,
      previousSign: previous,
      newSign: changed ? this.active : null,
      candidate: this.candidate ? this.candidate.sign : null,
      hasHand: !!hasHand,
    };
  }
}

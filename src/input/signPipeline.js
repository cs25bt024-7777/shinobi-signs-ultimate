// Wires gestureFeatures → gestureClassifier → signStabilizer (Phase 4) and publishes results.
// Knows nothing about the DOM or MediaPipe: feed it tracker frames, subscribe to results.
//
//   handTracker.onResult(frame => pipeline.process(frame))
//   pipeline.onUpdate(state => …)   every frame (UI)
//   pipeline.onSign(state => …)     only when a NEW real sign becomes active (Phase 5 input)
//
// `state` = the stabilizer output (currentSign, confidence, signChanged, newSign, …) plus
//   raw        the classifier's unsmoothed answer for this frame { sign, confidence, scores, … }
//   timestamp  frame.timestamp

import { GestureClassifier } from './gestureClassifier.js';
import { SignStabilizer } from './signStabilizer.js';
import { GESTURE_CONFIG } from './gestureConfig.js';

export class SignPipeline {
  /**
   * @param {object} [opts]
   * @param {{classify:(frame:object)=>object}} [opts.classifier]  swap in another classifier
   * @param {SignStabilizer} [opts.stabilizer]
   * @param {object} [opts.config]  gesture config used for the defaults
   */
  constructor({ classifier, stabilizer, config = GESTURE_CONFIG } = {}) {
    this.classifier = classifier || new GestureClassifier(config);
    this.stabilizer = stabilizer || new SignStabilizer(config.stabilizer);
    this._updateListeners = new Set();
    this._signListeners = new Set();
    this.latest = null;
  }

  /** Run one tracker frame through the pipeline. Returns the state. */
  process(frame) {
    const raw = this.classifier.classify(frame);
    const hasHand = !!(frame && frame.hasHand);
    const t = frame && Number.isFinite(frame.timestamp) ? frame.timestamp : 0;
    const state = { ...this.stabilizer.update(raw, t, hasHand), raw, timestamp: t };
    this.latest = state;
    for (const fn of this._updateListeners) this._call(fn, state);
    if (state.newSign) for (const fn of this._signListeners) this._call(fn, state);
    return state;
  }

  /** Every processed frame (also immediately if a state exists). @returns unsubscribe */
  onUpdate(fn) {
    this._updateListeners.add(fn);
    if (this.latest) this._call(fn, this.latest);
    return () => this._updateListeners.delete(fn);
  }

  /** Once per newly activated sign. @returns unsubscribe */
  onSign(fn) {
    this._signListeners.add(fn);
    return () => this._signListeners.delete(fn);
  }

  _call(fn, state) {
    try { fn(state); } catch (err) { console.error('SignPipeline listener failed:', err); }
  }
}

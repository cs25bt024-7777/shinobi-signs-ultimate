// Rule-based gesture classifier (Phase 4).
//
//   frame ─► classify(frame) ─► { sign: 'SNAKE' | null, confidence: 0..1, ... }
//
// No DOM, no canvas, no timing: one frame in, one answer out. Smoothing over time lives in
// signStabilizer.js, so this class can be swapped for a machine-learning classifier later
// as long as the replacement keeps the same interface:
//
//   classify(frame) → { sign, confidence, scores, handCount, features }
//     sign         name of the best sign, or null for UNKNOWN
//     confidence   0..1 for that sign (0 when sign is null)
//     scores       { SNAKE: 0.93, TIGER: 0.12, … }  best score per sign (for debugging)
//     handCount    usable hands in the frame
//     features     extractFrameFeatures() output (for the debug overlay); may be null
//
// See gestureConfig.js for how rules turn into a score.

import { GESTURE_CONFIG } from './gestureConfig.js';
import { extractFrameFeatures, getFeature } from './gestureFeatures.js';

/** Membership (0..1) of `value` in a rule's trapezoid: 1 inside [min,max], linear falloff over `soft` outside. */
export function membership(value, rule) {
  const soft = rule.soft > 0 ? rule.soft : 1e-9;
  let outside = 0;
  if (rule.min !== undefined && value < rule.min) outside = rule.min - value;
  else if (rule.max !== undefined && value > rule.max) outside = value - rule.max;
  return Math.max(0, 1 - outside / soft);
}

/**
 * Score one sign against one hand's features.
 * @returns {{score:number, rules:{feature:string, value:number|undefined, membership:number, weight:number}[]}}
 */
export function scoreSign(features, signDef, floor = GESTURE_CONFIG.classifier.ruleFloor, gate = GESTURE_CONFIG.classifier.ruleGate) {
  let sumW = 0;
  let sumLog = 0;
  let worst = 1;
  const rules = [];
  for (const rule of signDef.rules) {
    const weight = rule.weight === undefined ? 1 : rule.weight;
    const value = getFeature(features, rule.feature);
    // A feature that can't be computed counts as a total miss rather than being ignored.
    const m = value === undefined ? 0 : membership(value, rule);
    rules.push({ feature: rule.feature, value, membership: m, weight });
    if (weight > 0) worst = Math.min(worst, m);
    sumW += weight;
    sumLog += weight * Math.log(Math.max(m, floor));
  }
  let score = sumW > 0 ? Math.exp(sumLog / sumW) : 0;
  if (gate > 0 && worst < gate) score *= worst / gate;
  return { score, rules };
}

export class GestureClassifier {
  /** @param {object} [config]  defaults to GESTURE_CONFIG (pass a modified copy to tune/test) */
  constructor(config = GESTURE_CONFIG) {
    this.config = config;
  }

  /** Names of the signs this classifier knows. */
  get signNames() { return Object.keys(this.config.signs); }

  classify(frame) {
    const features = extractFrameFeatures(frame, this.config.features);
    return this.classifyFeatures(features);
  }

  /** Same as classify() but starts from already-extracted features. */
  classifyFeatures(features) {
    const c = this.config.classifier;
    const scores = Object.fromEntries(this.signNames.map((n) => [n, 0]));
    const empty = { sign: null, confidence: 0, scores, handCount: 0, features };
    if (!features || features.hands.length === 0) return empty;

    // 1) score every sign on every hand
    const perHand = features.hands.map((h) => {
      const handScores = {};
      for (const name of this.signNames) {
        handScores[name] = scoreSign(h.features, this.config.signs[name], c.ruleFloor, c.ruleGate).score;
        scores[name] = Math.max(scores[name], handScores[name]);
      }
      return this._decide(handScores);
    });

    // 2) combine hands
    const confident = perHand.filter((r) => r.sign);
    let sign = null;
    let confidence = 0;
    if (confident.length === 1) {
      ({ sign, confidence } = confident[0]);
    } else if (confident.length === 2) {
      const [a, b] = confident;
      if (a.sign === b.sign) {
        sign = a.sign;
        confidence = Math.min(1, (a.confidence + b.confidence) / 2 + c.agreementBonus);
      } else {
        const best = a.confidence >= b.confidence ? a : b;
        const other = best === a ? b : a;
        // Conflicting hands only matter if the weaker one is itself confident.
        const conflict = other.confidence >= c.conflictMinConfidence;
        sign = best.sign;
        confidence = conflict ? best.confidence * (1 - c.conflictPenalty) : best.confidence;
      }
    }
    if (sign && confidence < c.minConfidence) { sign = null; confidence = 0; }
    return { sign, confidence, scores, handCount: features.hands.length, features };
  }

  /** Best sign for one hand's score table, or null if too weak / too close to the runner-up. */
  _decide(handScores) {
    const c = this.config.classifier;
    const ranked = Object.entries(handScores).sort((a, b) => b[1] - a[1]);
    const [bestName, best] = ranked[0] || [null, 0];
    const second = ranked[1] ? ranked[1][1] : 0;
    if (!bestName || best < c.minConfidence || best - second < c.minMargin) return { sign: null, confidence: 0 };
    return { sign: bestName, confidence: best };
  }
}

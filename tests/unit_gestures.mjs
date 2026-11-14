// Unit tests for Phase 4: gestureFeatures, gestureClassifier, signStabilizer, signPipeline.
// Run:  node tests/unit_gestures.mjs
//
// ALL hands here are SYNTHETIC (tests/fixtures/syntheticHands.mjs): landmarks generated from a
// kinematic model, not captured from a person. They prove the code is correct and consistent;
// they say NOTHING about how reliably real hands are recognised. Real-webcam testing is separate.

import { jointAngle, getFeature, extractHandFeatures, extractFrameFeatures } from '../src/input/gestureFeatures.js';
import { GestureClassifier, membership, scoreSign } from '../src/input/gestureClassifier.js';
import { SignStabilizer } from '../src/input/signStabilizer.js';
import { SignPipeline } from '../src/input/signPipeline.js';
import { GESTURE_CONFIG } from '../src/input/gestureConfig.js';
import { signHand, makeHand, makeFrame, SIGN_POSES, OTHER_POSES } from './fixtures/syntheticHands.mjs';
import { formatDebug } from '../src/ui/debugOverlay.js';

let passed = 0;
const failed = [];
function check(name, cond, extra = '') {
  if (cond) passed++; else failed.push(name);
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? `   [${extra}]` : ''}`);
}
const SIGNS = ['SNAKE', 'TIGER', 'HORSE', 'RAM'];
const FRAME_MS = 33;
const clone = (o) => JSON.parse(JSON.stringify(o));

/**
 * Drive a fresh pipeline with a script of segments { hands: () => Hand[] | hand-array, ms }.
 * Frames arrive every 33 ms. Returns { states, events (newSign), changes (every signChanged), t0 }.
 */
function drive(segments, { pipeline = new SignPipeline(), start = 1000 } = {}) {
  const states = [];
  const events = [];
  const changes = [];
  let t = start;
  pipeline.onSign((s) => events.push({ sign: s.newSign, t: s.timestamp }));
  for (const seg of segments) {
    const end = t + seg.ms;
    for (; t < end; t += FRAME_MS) {
      const hands = typeof seg.hands === 'function' ? seg.hands(t - (end - seg.ms)) : seg.hands || [];
      const s = pipeline.process(makeFrame(hands, { t }));
      states.push(s);
      if (s.signChanged) changes.push({ from: s.previousSign, to: s.currentSign, t });
    }
  }
  return { states, events, changes, t0: start, pipeline };
}
const hold = (name, ms, opts = {}) => ({ ms, hands: (dt) => [signHand(name, { seed: 1 + Math.round(dt), ...opts })] });
const none = (ms) => ({ ms, hands: [] });
const last = (a) => a[a.length - 1];

// =====================================================================
console.log('\n== feature helpers ==');
{
  check('jointAngle: straight line = 180°', Math.abs(jointAngle({ x: -1, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }) - 180) < 1e-9);
  check('jointAngle: right angle = 90°', Math.abs(jointAngle({ x: 1, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }) - 90) < 1e-9);
  check('jointAngle: zero-length segment does not produce NaN', Number.isFinite(jointAngle({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 })));
  check('getFeature: dotted path', getFeature({ curl: { index: 0.3 } }, 'curl.index') === 0.3);
  check('getFeature: missing path → undefined (no throw)', getFeature({ curl: {} }, 'curl.index.x') === undefined && getFeature({}, 'a.b') === undefined);
  check('membership: inside range = 1', membership(0.2, { max: 0.25, soft: 0.3 }) === 1);
  check('membership: linear falloff', Math.abs(membership(0.4, { max: 0.25, soft: 0.3 }) - 0.5) < 1e-9);
  check('membership: beyond soft = 0', membership(1, { max: 0.25, soft: 0.3 }) === 0);
  check('membership: one-sided min rule', membership(0.9, { min: 0.6, soft: 0.3 }) === 1 && Math.abs(membership(0.45, { min: 0.6, soft: 0.3 }) - 0.5) < 1e-9);
}

console.log('\n== feature extraction ==');
{
  const fx = (name, o) => extractHandFeatures(signHand(name, o), makeFrame([]));
  const flat = fx('SNAKE');
  const fist = fx('FIST');
  check('flat hand: all four finger curls near 0', ['index', 'middle', 'ring', 'pinky'].every((n) => flat.curl[n] < 0.1), JSON.stringify(flat.curl));
  check('fist: all four finger curls high', ['index', 'middle', 'ring', 'pinky'].every((n) => fist.curl[n] > 0.8));
  check('curls stay in 0..1', [flat, fist].every((f) => Object.values(f.curl).every((v) => v >= 0 && v <= 1)));
  check('extendedCount / curledCount', flat.extendedCount === 4 && flat.curledCount === 0 && fist.extendedCount === 0 && fist.curledCount === 4);
  check('fingers together → small spread; fanned fingers → larger spread', flat.spread.mean < 8 && fx('OPEN_SPREAD').spread.mean > 18, `${flat.spread.mean.toFixed(1)} vs ${fx('OPEN_SPREAD').spread.mean.toFixed(1)}`);
  check('upright hand → tilt ≈ 0°', flat.palm.tiltDeg < 5, flat.palm.tiltDeg.toFixed(1));
  check('hand rotated 90° → tilt ≈ 90°', Math.abs(fx('SNAKE', { roll: 90 }).palm.tiltDeg - 90) < 6);
  check('palm facing camera → facing ≈ 1', flat.palm.facing > 0.95, flat.palm.facing.toFixed(2));
  check('palm turned edge-on (yaw 80°) → facing small', fx('SNAKE', { yaw: 80 }).palm.facing < 0.3, fx('SNAKE', { yaw: 80 }).palm.facing.toFixed(2));

  // invariance to size / distance / position / small rotation / small noise
  const ref = fx('TIGER');
  const variants = {
    'hand size ×0.7': fx('TIGER', { palm: 0.063 }),
    'hand size ×1.3': fx('TIGER', { palm: 0.117 }),
    'distance 1 m': fx('TIGER', { depth: 1.0 }),
    'moved in frame': fx('TIGER', { cx: 0.25, cy: 0.7 }),
    'roll +12°': fx('TIGER', { roll: 12 }),
    'noise σ=2 mm': fx('TIGER', { noise: 0.002, seed: 5 }),
  };
  for (const [label, f] of Object.entries(variants)) {
    const dMax = Math.max(...['index', 'middle', 'ring', 'pinky'].map((n) => Math.abs(f.curl[n] - ref.curl[n])));
    check(`curl invariant to ${label}`, dMax < 0.12, `max Δcurl ${dMax.toFixed(3)}`);
  }
  check('tipDist is in palm sizes (size-invariant)', Math.abs(fx('RAM', { palm: 0.06 }).tipDist.indexPinky - fx('RAM', { palm: 0.12 }).tipDist.indexPinky) < 0.02);

  // fallbacks / bad input
  check('no world landmarks → falls back to image landmarks', fx('HORSE', { noWorld: true }).curl.middle > 0.7);
  check('degenerate hand (all points equal) → null', extractHandFeatures({ landmarks: Array.from({ length: 21 }, () => ({ x: 0.5, y: 0.5, z: 0 })), worldLandmarks: [] }, null) === null);
  check('wrong landmark count → null', extractHandFeatures({ landmarks: [{ x: 0, y: 0, z: 0 }] }, null) === null);
  check('extractFrameFeatures: no hands / null frame', extractFrameFeatures(makeFrame([])).hands.length === 0 && extractFrameFeatures(null).hands.length === 0);
  check('extractFrameFeatures: twoHand only with 2 hands', extractFrameFeatures(makeFrame([signHand('SNAKE')])).twoHand === null && extractFrameFeatures(makeFrame([signHand('SNAKE'), signHand('TIGER', { handedness: 'Left', cx: 0.3 })])).twoHand !== null);
}

// =====================================================================
console.log('\n== classifier: single frames ==');
const classifier = new GestureClassifier();
{
  const none1 = classifier.classify(makeFrame([]));
  check('1. no hand → { sign: null, confidence: 0 }', none1.sign === null && none1.confidence === 0 && none1.handCount === 0);
  check('1. null frame does not throw', classifier.classify(null).sign === null);

  for (const name of SIGNS) {
    const r = classifier.classify(makeFrame([signHand(name)]));
    check(`${name}: classified as ${name} with high confidence`, r.sign === name && r.confidence > 0.9, `${r.sign} ${r.confidence.toFixed(2)}`);
  }
  for (const [name, pose] of Object.entries(OTHER_POSES)) {
    const r = classifier.classify(makeFrame([signHand(name)]));
    check(`2. unknown gesture ${name} → UNKNOWN`, r.sign === null && r.confidence === 0, JSON.stringify(Object.fromEntries(Object.entries(r.scores).map(([k, v]) => [k, +v.toFixed(2)]))));
  }
  const r = classifier.classify(makeFrame([signHand('SNAKE')]));
  check('result carries all scores + features for debugging', SIGNS.every((n) => n in r.scores) && r.features.hands.length === 1);
  check('classifier output has no DOM/timing fields', !('signChanged' in r) && !('timestamp' in r));
  check('confidence is deterministic (same input → same output)', classifier.classify(makeFrame([signHand('RAM', { noise: 0.002, seed: 9 })])).confidence === classifier.classify(makeFrame([signHand('RAM', { noise: 0.002, seed: 9 })])).confidence);
}

console.log('\n== classifier: confidence behaviour ==');
{
  // morph HORSE → FIST by raising the middle finger curl: confidence must fall smoothly, never jump to another sign
  const seq = [0.9, 0.7, 0.5, 0.35, 0.2, 0.0].map((m) => {
    const r = classifier.classify(makeFrame([signHand('HORSE', { curl: { middle: m } })]));
    return { m, sign: r.sign, c: r.confidence };
  });
  console.log('      middle curl → ', seq.map((s) => `${s.m}:${s.sign || '-'}/${s.c.toFixed(2)}`).join('  '));
  const horse = seq.filter((x) => x.sign === 'HORSE');
  check('10. confidence falls monotonically while the pose drifts away from HORSE', horse.length >= 2 && horse.every((x, i) => i === 0 || x.c <= horse[i - 1].c + 1e-9), horse.map((x) => x.c.toFixed(2)).join(' > '));
  const order = seq.map((x) => x.sign || 'UNKNOWN');
  const flips = order.filter((n, i) => i > 0 && n !== order[i - 1]).length;
  check('10. the morph passes through UNKNOWN or flips once; no erratic back-and-forth', flips <= 2 && order[0] === 'HORSE' && order.at(-1) === 'TIGER', order.join('>'));
  check('10. the end of the morph is a different sign (TIGER), confidently', seq.at(-1).sign === 'TIGER' && seq.at(-1).c > 0.9);
  const lowOnly = classifier.classify(makeFrame([signHand('HALF_CURL')]));
  check('10. low-confidence gesture → sign null, confidence 0 (never a weak guess)', lowOnly.sign === null && lowOnly.confidence === 0);
}

console.log('\n== classifier: configurable thresholds ==');
{
  const strict = clone(GESTURE_CONFIG);
  strict.classifier.minConfidence = 0.999;
  strict.classifier.minMargin = 0;
  const c2 = new GestureClassifier(strict);
  const imperfect = makeFrame([signHand('TIGER', { curl: { index: 0.4 } })]); // index finger noticeably bent
  const base = classifier.classify(imperfect);
  check('raising minConfidence turns an imperfect TIGER into UNKNOWN', base.sign === 'TIGER' && base.confidence < 0.99 && c2.classify(imperfect).sign === null, `default conf ${base.confidence.toFixed(2)}`);
  const noTiger = clone(GESTURE_CONFIG);
  delete noTiger.signs.TIGER;
  check('removing a sign from config removes it', new GestureClassifier(noTiger).classify(makeFrame([signHand('TIGER')])).sign !== 'TIGER');
  const extra = clone(GESTURE_CONFIG);
  extra.signs.FIST = { icon: '✊', rules: [{ feature: 'curl.index', min: 0.7, soft: 0.2 }, { feature: 'curl.middle', min: 0.7, soft: 0.2 }, { feature: 'curl.ring', min: 0.7, soft: 0.2 }, { feature: 'curl.pinky', min: 0.7, soft: 0.2 }] };
  check('adding a sign needs only a config entry', new GestureClassifier(extra).classify(makeFrame([signHand('FIST')])).sign === 'FIST');
  const tweak = scoreSign(extractHandFeatures(signHand('SNAKE'), makeFrame([])), GESTURE_CONFIG.signs.SNAKE);
  check('scoreSign explains itself (per-rule membership)', tweak.rules.length === GESTURE_CONFIG.signs.SNAKE.rules.length && tweak.rules.every((r) => r.membership >= 0 && r.membership <= 1));
}

console.log('\n== classifier: two hands ==');
{
  const L = (name, o = {}) => signHand(name, { handedness: 'Left', cx: 0.3, mirror: true, ...o });
  const R = (name, o = {}) => signHand(name, { handedness: 'Right', cx: 0.7, ...o });
  const one = classifier.classify(makeFrame([R('SNAKE')]));
  const same = classifier.classify(makeFrame([L('SNAKE'), R('SNAKE')]));
  check('11. both hands SNAKE → SNAKE', same.sign === 'SNAKE' && same.handCount === 2);
  check('11. agreement never lowers confidence', same.confidence >= one.confidence - 1e-9, `${same.confidence.toFixed(3)} vs ${one.confidence.toFixed(3)}`);
  const idle = classifier.classify(makeFrame([L('FIST'), R('TIGER')]));
  check('11. one hand signs, other hand idle (fist) → the sign wins at full confidence', idle.sign === 'TIGER' && idle.confidence > 0.9);
  const conflict = classifier.classify(makeFrame([L('SNAKE'), R('RAM')]));
  check('11. two different confident signs → penalised confidence', conflict.sign !== null && conflict.confidence < 0.9 * 1 && conflict.confidence > 0.5, `${conflict.sign} ${conflict.confidence.toFixed(2)}`);
  const th = extractFrameFeatures(makeFrame([L('SNAKE', { cx: 0.3 }), R('SNAKE', { cx: 0.7 })])).twoHand;
  check('11. two-hand features: wrist distance & relative angle', th.wristDistance > 2 && th.wristDistance < 12 && th.relativeAngleDeg < 5, `d=${th.wristDistance.toFixed(2)} a=${th.relativeAngleDeg.toFixed(1)}`);
  const th2 = extractFrameFeatures(makeFrame([L('SNAKE', { roll: -90 }), R('SNAKE', { roll: 90 })])).twoHand;
  check('11. two-hand relative angle sees opposite rotations', th2.relativeAngleDeg > 150, th2.relativeAngleDeg.toFixed(0));
  const near = extractFrameFeatures(makeFrame([L('SNAKE', { cx: 0.46 }), R('SNAKE', { cx: 0.54 })])).twoHand;
  check('11. closer hands → smaller wrist distance', near.wristDistance < th.wristDistance);
}

// =====================================================================
console.log('\n== stabilizer: raw observation sequences ==');
{
  const obs = (sign, confidence = 0.9) => ({ sign, confidence });
  const run = (list, stab = new SignStabilizer()) => {
    const out = [];
    let t = 0;
    for (const o of list) { out.push(stab.update(o, t, true)); t += 33; }
    return out;
  };
  const S = obs('SNAKE'), U = obs(null, 0), T = obs('TIGER');

  // the example from the spec
  let out = run([S, U, S, T, U, S, U, T]);
  check('flicker SNAKE,UNKNOWN,SNAKE,TIGER,UNKNOWN… never activates anything', out.every((s) => !s.signChanged && s.currentSign === null));

  out = run(Array(4).fill(S));
  check('4 frames (99 ms) of SNAKE is NOT yet enough', out.every((s) => s.currentSign === null));
  out = run(Array(12).fill(S));
  const act = out.findIndex((s) => s.signChanged);
  check('SNAKE becomes active after ≥ holdMs (200 ms)', act >= 0 && act * 33 >= 200 && act * 33 <= 260, `frame ${act} = ${act * 33} ms`);
  check('…and is reported exactly once while it is held', out.filter((s) => s.signChanged).length === 1 && out.slice(act).every((s) => s.currentSign === 'SNAKE'));
  check('newSign set only on the activation frame', out.filter((s) => s.newSign === 'SNAKE').length === 1);

  // hysteresis
  const lowS = obs('SNAKE', 0.6);   // above exit (0.55), below enter (0.7)
  out = run(Array(15).fill(lowS));
  check('hysteresis: confidence between exit and enter thresholds can NOT start a sign', out.every((s) => s.currentSign === null));
  out = run([...Array(10).fill(S), ...Array(30).fill(lowS)]);
  check('hysteresis: …but an active sign survives such a dip', last(out).currentSign === 'SNAKE' && out.filter((s) => s.signChanged).length === 1);
  out = run([...Array(10).fill(S), ...Array(30).fill(obs('TIGER', 0.6))]);
  check('hysteresis: a weaker different sign never becomes active (SNAKE just times out to UNKNOWN)', out.every((x) => x.currentSign !== 'TIGER') && last(out).currentSign === null);

  // candidate grace
  out = run([S, S, S, U, S, S, S, S]);
  check('a single missed frame does not restart the confirmation timer', out.some((s) => s.currentSign === 'SNAKE'));
  out = run([S, S, U, U, U, U, S, S, S]);
  check('a longer gap restarts the timer', out.every((s) => s.currentSign === null));

  // release
  out = run([...Array(12).fill(S), ...Array(3).fill(U)]);
  check('release: 3 UNKNOWN frames (99 ms) keep the sign', last(out).currentSign === 'SNAKE');
  out = run([...Array(12).fill(S), ...Array(12).fill(U)]);
  const rel = out.findIndex((s, i) => i > 10 && s.signChanged);
  check('release: ≥ releaseMs of UNKNOWN → UNKNOWN, signChanged true, newSign null', rel >= 0 && out[rel].currentSign === null && out[rel].newSign === null && out[rel].previousSign === 'SNAKE');

  // transitions
  out = run([...Array(12).fill(S), ...Array(12).fill(T)]);
  const sw = out.filter((s) => s.signChanged);
  check('direct switch SNAKE → TIGER: one event each, no UNKNOWN in between', sw.map((s) => s.currentSign).join() === 'SNAKE,TIGER' && sw[1].previousSign === 'SNAKE');
  out = run([...Array(60).fill(S)]);
  check('8. holding for ~2 s: 1 event only (not hundreds)', out.filter((s) => s.signChanged).length === 1);
  check('reset() clears state', (() => { const st = new SignStabilizer(); run(Array(12).fill(S), st); st.reset(); return st.update(U, 0, true).currentSign === null; })());
}

// =====================================================================
console.log('\n== pipeline: full path with synthetic hands ==');
{
  // 3. stable signs
  for (const name of SIGNS) {
    const r = drive([hold(name, 1000, { noise: 0.0015 })]);
    const first = r.states.findIndex((s) => s.currentSign === name);
    check(`3. stable ${name}: becomes active, once`, r.events.length === 1 && r.events[0].sign === name && last(r.states).currentSign === name);
    check(`3. ${name}: activation delay within 150–300 ms`, first >= 0 && first * FRAME_MS >= 150 && first * FRAME_MS <= 300, `${first * FRAME_MS} ms`);
    check(`3. ${name}: confidence reported`, last(r.states).confidence > 0.85, last(r.states).confidence.toFixed(2));
  }

  // 1. no hand
  let r = drive([none(1000)]);
  check('1. no hand: UNKNOWN, no events, hasHand=false', r.events.length === 0 && r.states.every((s) => s.currentSign === null && s.hasHand === false && s.confidence === 0));

  // 2. unknown gestures held
  for (const name of Object.keys(OTHER_POSES)) {
    r = drive([hold(name, 1500)]);
    check(`2. ${name} held 1.5 s: never becomes a sign`, r.events.length === 0 && r.states.every((s) => s.currentSign === null && s.hasHand));
  }

  // 7. holding a long time
  r = drive([hold('HORSE', 3000, { noise: 0.0015 })]);
  check('7. HORSE held 3 s (~90 frames): exactly ONE event', r.events.length === 1 && r.changes.length === 1, `${r.states.length} frames`);

  // 8. switching
  r = drive([hold('SNAKE', 600), hold('TIGER', 600), hold('HORSE', 600), hold('RAM', 600)]);
  check('8. SNAKE→TIGER→HORSE→RAM: events are exactly that sequence, once each', r.events.map((e) => e.sign).join('>') === 'SNAKE>TIGER>HORSE>RAM', r.events.map((e) => e.sign).join('>'));
  r = drive([hold('SNAKE', 600), hold('FIST', 600), hold('SNAKE', 600)]);
  const toList = r.changes.map((c) => c.to || 'UNKNOWN').join('>');
  check('8. SNAKE→UNKNOWN→SNAKE: 3 changes (SNAKE, UNKNOWN, SNAKE) but only 2 sign events', toList === 'SNAKE>UNKNOWN>SNAKE' && r.events.length === 2, toList);
  r = drive([hold('SNAKE', 600), { ms: 33 * 3, hands: [signHand('FIST')] }, hold('SNAKE', 400)]);
  check('8. a 100 ms glitch to another pose does not re-trigger or drop the sign', r.events.length === 1 && last(r.states).currentSign === 'SNAKE');
  // single-frame flicker through the whole pipeline
  const flick = ['SNAKE', 'FIST', 'SNAKE', 'TIGER', 'FIST', 'HORSE', 'FIST', 'RAM'];
  r = drive(flick.map((n) => ({ ms: FRAME_MS, hands: [signHand(n)] })));
  check('8. one-frame-per-pose flicker produces no events', r.events.length === 0);

  // 9. dropouts
  r = drive([hold('TIGER', 600), none(100), hold('TIGER', 600)]);
  check('9. brief dropout (100 ms) while holding: sign stays, no new event', r.events.length === 1 && r.states.every((s, i) => i < 8 || s.currentSign === 'TIGER'));
  r = drive([hold('TIGER', 600), { ms: 200, hands: [signHand('TIGER', { stale: true })] }, hold('TIGER', 400)]);
  check('9. tracker "stale" (held-over) hands keep the sign alive', r.events.length === 1 && r.changes.length === 1);
  r = drive([hold('TIGER', 600), none(800), hold('TIGER', 600)]);
  const toList2 = r.changes.map((c) => c.to || 'UNKNOWN').join('>');
  check('9. long dropout (800 ms): TIGER → UNKNOWN → TIGER (second event after re-confirming)', toList2 === 'TIGER>UNKNOWN>TIGER' && r.events.length === 2, toList2);
  r = drive([none(400), hold('RAM', 600)]);
  check('9. sign made right after a dropout still registers once', r.events.length === 1 && r.events[0].sign === 'RAM');

  // 12. invariance end-to-end
  const variants = [
    { label: 'small hand, far', o: { palm: 0.07, depth: 0.9 } },
    { label: 'large hand, close', o: { palm: 0.11, depth: 0.35 } },
    { label: 'moved to the corner', o: { cx: 0.2, cy: 0.75 } },
    { label: 'rotated +12°', o: { roll: 12 } },
    { label: 'rotated −12°', o: { roll: -12 } },
    { label: 'noise σ=2.5 mm', o: { noise: 0.0025 } },
  ];
  for (const v of variants) {
    const okAll = SIGNS.every((name) => {
      const rr = drive([hold(name, 700, v.o)]);
      return rr.events.length === 1 && rr.events[0].sign === name;
    });
    check(`12. invariance — all four signs still recognised (${v.label})`, okAll);
  }
  // sensitivity: documents where it stops working
  const rot = SIGNS.map((n) => { const f = (a) => classifier.classify(makeFrame([signHand(n, { roll: a })])).sign === n; return [n, [20, 35, 50, 70, 90].filter(f).length]; });
  console.log(`      (info) rotation tolerance, of 5 angles [20,35,50,70,90]° recognised: ${rot.map(([n, k]) => `${n}:${k}`).join(' ')}`);
}

console.log('\n== pipeline: interface and robustness ==');
{
  const p = new SignPipeline();
  const upd = []; const sig = [];
  p.onUpdate((s) => upd.push(s)); p.onSign((s) => sig.push(s));
  drive([hold('SNAKE', 500)], { pipeline: p });
  check('onUpdate fires every frame, onSign only once', upd.length > 10 && sig.length === 1 && sig[0].newSign === 'SNAKE');
  check('state exposes currentSign / confidence / signChanged', ['currentSign', 'confidence', 'signChanged', 'newSign', 'raw'].every((k) => k in p.latest));
  const unsub = p.onUpdate(() => {}); unsub();
  const origErr = console.error; console.error = () => {};
  p.onUpdate(() => { throw new Error('bug'); });
  let threw = false; try { p.process(makeFrame([signHand('SNAKE')], { t: 99999 })); } catch { threw = true; }
  console.error = origErr;
  check('a throwing listener does not break the pipeline', !threw);

  const fake = { classify: () => ({ sign: 'SNAKE', confidence: 0.99, scores: {}, handCount: 1, features: null }) };
  const r = drive([{ ms: 600, hands: [signHand('SNAKE')] }], { pipeline: new SignPipeline({ classifier: fake }) });
  check('classifier is replaceable (any object with classify(frame))', r.events.length === 1);
  check('pipeline copes with malformed frames', (() => { const q = new SignPipeline(); try { q.process(null); q.process({}); q.process({ hasHand: true, hands: [{ landmarks: [] }] }); return true; } catch { return false; } })());
  const txt = formatDebug(drive([hold('TIGER', 600)]).states.at(-1));
  check('debug text shows CURRENT SIGN, CONFIDENCE and curls', /CURRENT SIGN: TIGER/.test(txt) && /CONFIDENCE:\s+\d+%/.test(txt) && /Index curl/.test(txt) && /Palm tilt/.test(txt));
  check('debug text for no hand', /CURRENT SIGN: UNKNOWN/.test(formatDebug(drive([none(100)]).states.at(-1))));
  check('default config has debug OFF (CONFIG.signs.debug)', (await import('../src/config.js')).CONFIG.signs.debug === false);
}


// Regression: real webcam inference can be slow (~5-6 FPS). The app runtime
// uses a shorter confirmation hold so a strong stable sign is not left stuck
// at UNKNOWN between widely spaced inference frames.
console.log('\n== low-FPS runtime stabilizer regression ==');
{
  const runtimeConfig = clone(GESTURE_CONFIG);
  runtimeConfig.stabilizer = { ...runtimeConfig.stabilizer, holdMs: 100, candidateGraceMs: 650, releaseMs: 650 };
  const slow = new SignPipeline({ config: runtimeConfig });
  const states = [];
  slow.onUpdate((state) => states.push(state));
  const start = 1000;
  for (let i = 0; i < 5; i++) {
    const frame = makeFrame([signHand('TIGER')], { t: start + i * 190 });
    slow.process(frame);
  }
  check('stable TIGER at ~5 FPS activates instead of remaining UNKNOWN', states.some((state) => state.currentSign === 'TIGER'));
  check('low-FPS stable sign emits exactly one sign event', states.filter((state) => state.newSign === 'TIGER').length === 1);
}

console.log(`\n${passed}/${passed + failed.length} checks passed`);
if (failed.length) { console.log('FAILED:\n  - ' + failed.join('\n  - ')); process.exit(1); }

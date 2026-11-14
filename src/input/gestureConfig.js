// Tunable numbers for sign recognition (Phase 4). No DOM, no MediaPipe.
//
// EVERYTHING here is an UNTUNED FIRST GUESS. It has only been exercised with synthetic
// landmark fixtures (tests/fixtures/syntheticHands.mjs), never with a real hand and a real
// webcam. Turn on debug mode (CONFIG.signs.debug or ?debug=signs) and tune with real hands.
//
// ── How a rule works ────────────────────────────────────────────────────────
// A rule looks at ONE feature (a dotted path into the features object, e.g. 'curl.index')
// and gives a membership score between 0 and 1:
//     min ≤ value ≤ max          → 1.0   (perfect)
//     outside by d               → max(0, 1 − d / soft)   (linear falloff; `soft` = tolerance)
// Leave out `min` or `max` for a one-sided rule.
//
// A sign's score is the WEIGHTED GEOMETRIC MEAN of its rule memberships:
//     score = exp( Σ w·ln(max(m, floor)) / Σ w )
// so one badly failing rule drags the whole score down (it can't be averaged away). On top of
// that, if the worst rule is below `classifier.ruleGate`, the score is multiplied by
// (worst / ruleGate): a sign with one clearly-violated rule can't win on its other rules.
// The result is deterministic and explainable: "index curl was out of range".

export const GESTURE_CONFIG = {
  // ---- feature extraction (gestureFeatures.js) ----
  features: {
    // Joint angle (degrees) at which a finger joint counts as fully straight / fully curled.
    straightAngle: 175,
    curledAngle: 85,
    // Weights for combining the MCP / PIP / DIP joint curls into one finger curl.
    jointWeights: { mcp: 0.25, pip: 0.5, dip: 0.25 },
    // Blend of angle-based curl vs. reach-based curl. "Reach" = wrist→fingertip distance divided
    // by the finger's fully-stretched length (wrist→MCP + the three bone lengths), so it is
    // self-normalising per finger and per hand.
    angleCurlWeight: 0.7,
    reachStraight: 0.95, // reach of a straight finger (< 1 because wrist→MCP isn't in line with it)
    reachCurled: 0.5,    // reach of a fully curled finger
    // Thumb uses its own angle range (the thumb never bends as far as the other fingers).
    thumbStraightAngle: 170,
    thumbCurledAngle: 120,
  },

  // ---- classifier (gestureClassifier.js) ----
  classifier: {
    minConfidence: 0.55, // below this the answer is UNKNOWN (also the EXIT threshold used by the stabilizer)
    minMargin: 0.08,     // best score must beat the runner-up by this much, else UNKNOWN (ambiguous)
    ruleFloor: 0.02,     // membership is never lower than this inside the geometric mean (avoids ln 0)
    ruleGate: 0.3,       // if the WORST rule of a sign is below this, the score is also scaled by (worst / ruleGate)
    // Two hands: if each hand shows a different confident sign, the answer is the stronger one,
    // multiplied by (1 − conflictPenalty). If both agree, confidence gets a small bonus.
    conflictPenalty: 0.25,
    agreementBonus: 0.03,
    conflictMinConfidence: 0.55, // a hand must reach this for its sign to count as "conflicting"
  },

  // ---- temporal stabilizer (signStabilizer.js) ----
  stabilizer: {
    enterConfidence: 0.7, // confidence needed for a NEW sign to start becoming active (> minConfidence = hysteresis)
    holdMs: 200,          // a new sign must be seen this long (in 150–250 ms range) before it becomes active
    candidateGraceMs: 80, // a candidate may disappear this long without restarting its timer
    releaseMs: 200,       // the active sign must be missing this long before the state falls back to UNKNOWN
  },

  // ---- the signs (gesture rules) ----
  // Own definitions, no copied artwork. Add a sign = add an entry here (and an icon).
  signs: {
    SNAKE: {
      icon: '🐍',
      description: 'Flat blade: four fingers straight and held together.',
      rules: [
        { feature: 'curl.index',  max: 0.25, soft: 0.30 },
        { feature: 'curl.middle', max: 0.25, soft: 0.30 },
        { feature: 'curl.ring',   max: 0.25, soft: 0.30 },
        { feature: 'curl.pinky',  max: 0.30, soft: 0.30 },
        { feature: 'spread.mean', max: 12,   soft: 10, weight: 1.5 }, // degrees between neighbouring fingers
      ],
    },
    TIGER: {
      icon: '🐯',
      description: 'Two fingers: index + middle up and together, ring + pinky curled.',
      rules: [
        { feature: 'curl.index',  max: 0.25, soft: 0.30 },
        { feature: 'curl.middle', max: 0.25, soft: 0.30 },
        { feature: 'curl.ring',   min: 0.60, soft: 0.30 },
        { feature: 'curl.pinky',  min: 0.60, soft: 0.30 },
        { feature: 'spread.indexMiddle', max: 22, soft: 15 },
        { feature: 'palm.tiltDeg', max: 55, soft: 40, weight: 0.5 }, // fingers roughly upward
      ],
    },
    HORSE: {
      icon: '🐴',
      description: 'Point: only the index finger up, other fingers curled.',
      rules: [
        { feature: 'curl.index',  max: 0.25, soft: 0.30, weight: 1.5 },
        { feature: 'curl.middle', min: 0.60, soft: 0.30 },
        { feature: 'curl.ring',   min: 0.60, soft: 0.30 },
        { feature: 'curl.pinky',  min: 0.60, soft: 0.30 },
        { feature: 'palm.tiltDeg', max: 55, soft: 40, weight: 0.5 },
      ],
    },
    RAM: {
      icon: '🐏',
      description: 'Horns: index + pinky up, middle + ring curled.',
      rules: [
        { feature: 'curl.index',  max: 0.25, soft: 0.30 },
        { feature: 'curl.pinky',  max: 0.30, soft: 0.30 },
        { feature: 'curl.middle', min: 0.60, soft: 0.30 },
        { feature: 'curl.ring',   min: 0.60, soft: 0.30 },
        { feature: 'tipDist.indexPinky', min: 0.9, soft: 0.5 }, // fingertip gap, in palm sizes
        { feature: 'palm.tiltDeg', max: 55, soft: 40, weight: 0.5 },
      ],
    },
  },
};

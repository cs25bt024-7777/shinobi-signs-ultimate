// Prints raw MediaPipe-shaped detection results (JSON) for synthetic hands, for the browser test.
//   node tests/make_sign_fixtures.mjs   →  { SNAKE: {landmarks,worldLandmarks,handedness}, …, NONE: …, TWO: … }
import { signHand } from './fixtures/syntheticHands.mjs';

const raw = (hands) => ({
  landmarks: hands.map((h) => h.landmarks),
  worldLandmarks: hands.map((h) => h.worldLandmarks),
  handedness: hands.map((h) => [{ categoryName: h.handedness, score: h.score }]),
});
const out = { NONE: raw([]) };
for (const n of ['SNAKE', 'TIGER', 'HORSE', 'RAM', 'FIST', 'HALF_CURL']) out[n] = raw([signHand(n)]);
out.TWO = raw([signHand('TIGER', { handedness: 'Left', mirror: true, cx: 0.3 }), signHand('TIGER', { cx: 0.7 })]);
process.stdout.write(JSON.stringify(out));

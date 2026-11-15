# Shinobi Signs — Ultimate Edition

## Current status: Ultimate Edition — five upgrade phases integrated

See [`ULTIMATE_EDITION_GUIDE.md`](ULTIMATE_EDITION_GUIDE.md) for the fighter select, best-of-three match flow, local run instructions and tests.

The original Phase 1–8 webcam, gesture, combat, defense and multiplayer foundations remain in place.

The local webcam controls the fighter assigned to that browser. The host is Player 1 and the player who joins with a room code is Player 2. Stable webcam-recognized signs feed the multi-action combo router. Completed attack combos are passed through the Phase 5C Jutsu bridge into the existing Jutsu/combat system. The room host authoritatively resolves HP, guard, counter, defeat and reset state.

Supported signs remain **SNAKE, TIGER, HORSE, RAM** only. Current moves:

- **ECHO CLONE TECHNIQUE** — `SNAKE → TIGER → HORSE → RAM` (25 damage)
- **SPIRAL ENERGY ORB** — `TIGER → RAM → SNAKE` (30 damage)
- **ANCIENT TOAD GUARDIAN** — `HORSE → SNAKE → TIGER` (34 damage)
- **GUARD STANCE** — `RAM → TIGER` (1.5 seconds; reduces incoming damage by 75%)
- **COUNTER STANCE** — `TIGER → SNAKE → RAM` (1.8 seconds; cancels the next hit and reflects 40% damage, minimum 8)

Two-player, webcam-controlled, anime-inspired hand-sign combat game with original names and effects. Both players use their own local webcam; raw webcam video and hand landmarks are not sent over the network.

| Phase | What | Status |
|-------|------|--------|
| 1 | Arena, characters, HUD and health bars | preserved |
| 2 | Webcam permission, preview and camera status | preserved |
| 3 | MediaPipe hand tracking | preserved; synthetic/browser fixtures |
| 4 | SNAKE / TIGER / HORSE / RAM recognition and stabilisation | preserved; synthetic-tested |
| 5 | Sequence recognizer, sequence HUD and Jutsu bridge | preserved; unit-tested |
| 6 | Jutsu selection, Canvas attacks, damage, hit/defeat and reset | implemented; unit-tested |
| 7 | Guard, counter, timed defense windows and attack resolution | implemented; unit-tested |
| 8 | Six-character room-code online 1v1 using WebRTC data channels | implemented; fake-transport unit-tested; real two-device network test pending |

## Ultimate Edition visual and gameplay upgrade

The battle presentation now uses the supplied artwork in `assets/`: two fighter cutouts,
the scenic arena image, an energy-orb sprite and a cyan impact overlay. The Canvas renderer
keeps the existing combat/sign-recognition architecture, while fighter sprites gain idle bob,
attack lunge, hit flash, guard/counter auras and floating portrait/name markers. The DOM HUD
has mirrored fighter portraits and a spaced health/status layout. The arena image is darkened
slightly so the combatants and UI remain readable.

All art is local to the project; no new runtime image CDN dependency was added.

## Run it (localhost)

ES modules need an HTTP server, and browsers only allow camera access on `http://localhost` (or `https://`).

```bash
cd shinobi-signs
python3 -m http.server 8000
# open http://localhost:8000
```

**Internet is required on first load**: the MediaPipe library, its WebAssembly runtime and the hand
model are downloaded from CDNs (jsDelivr and storage.googleapis.com) and then cached by the browser.
The panel shows `Downloading hand model…` while this happens. No npm install, no build step.

## How hand tracking works

```
Webcam (<video>) ─► HandTracker ─► MediaPipeHandBackend ─► MediaPipe HandLandmarker
                        │                                      (21 landmarks / hand)
                        ├─► frame: { hasHand, hands:[{handedness, landmarks, worldLandmarks, stale}], left, right, … }
                        └─► WebcamPanel (indicator + mirrored overlay)      Phase 4: gesture recognition
```

- **Frame loop:** `requestVideoFrameCallback` (one callback per *new* video frame); falls back to
  `requestAnimationFrame` and skips repeats of the same video frame. Capped at 30 detections/s
  (`CONFIG.handTracking.maxFps`). Timestamps passed to MediaPipe are strictly increasing.
- **Debounce:** a hand that disappears is kept in the data for 250 ms (`holdMs`), flagged
  `stale: true` and drawn faded, so the indicator doesn't flicker. After that it is dropped.
- **GPU → CPU:** the GPU delegate is tried first; if it can't start, the CPU delegate is used.
- **Failure handling:** if MediaPipe can't be downloaded the panel shows `TRACKER: UNAVAILABLE` with a
  RETRY button; the camera preview and the game keep working.
- **Mirroring:** only the *display* is mirrored. The landmark overlay `<canvas>` sits exactly on top
  of the `<video>` and gets the same CSS `scaleX(-1)`, so landmarks drawn in camera space line up with
  the mirrored picture.

### Using the data (for Phase 4)

```js
import { HandTracker, HandLandmark, toDisplaySpace } from './input/handTracker.js';

handTracker.latest            // newest frame (always defined)
handTracker.onResult(frame => { /* called for every processed frame */ });
handTracker.hasHand           // debounced "is any hand present"

frame.hands[i].handedness     // 'Left' | 'Right' | 'Unknown'  (hands are sorted Left, Right)
frame.hands[i].landmarks      // 21 × {x, y, z}  – normalised camera coordinates (x,y in 0..1; z = depth vs. wrist)
frame.hands[i].worldLandmarks // 21 × {x, y, z}  – metres, origin at the hand's centre (scale-independent: good for classifiers)
frame.hands[i].stale          // true while a vanished hand is being held
frame.left / frame.right      // shortcuts (or null)
HandLandmark.INDEX_FINGER_TIP // names for the 21 indices
```

Landmarks are in **camera space** (un-mirrored). Mirror with `toDisplaySpace(landmarks)` (x → 1 − x)
only when drawing in the mirrored view.


## How sign recognition works (Phase 4)

```
HandTracker frame ─► gestureFeatures ─► gestureClassifier ─► signStabilizer ─► { currentSign, confidence, signChanged, newSign }
   (landmarks)        curls, spreads,      rule scores →        200 ms hold,         └─► WebcamPanel / HUD / debug overlay
                      distances, tilt      sign or UNKNOWN      hysteresis           └─► Phase 5: signPipeline.onSign(...)
```
`src/input/signPipeline.js` wires the three stages; each stage is independent and DOM-free.

**The four signs** (our own definitions, tuned for being easy to tell apart — not copied from anywhere):

| Sign | Hand shape (gestureConfig.js) |
|------|-------------------------------|
| 🐍 SNAKE | flat blade: four fingers straight and held together |
| 🐯 TIGER | index + middle straight and together, ring + pinky curled |
| 🐴 HORSE | only the index finger straight, the other three curled |
| 🐏 RAM | "horns": index + pinky straight and apart, middle + ring curled |

All four are one-hand shapes with the fingers pointing roughly up (a soft tilt rule; SNAKE has none).
With two hands each hand is classified; the answer is the confident one (agreement adds a small bonus,
two *different* confident signs are penalised).

**Features** (`gestureFeatures.js`): finger curl 0–1 (joint angles at MCP/PIP/DIP blended with wrist→tip
reach), joint angles, finger spread measured in the palm plane, fingertip distances and tip-to-palm
distances in palm sizes, palm facing, palm tilt from "up", extended/curled counts; and for two hands:
wrist distance, index-tip distance and relative orientation. Distances are divided by palm size and the
finger geometry uses `worldLandmarks`, so hand size and camera distance mostly cancel out.

**Scoring**: each rule is a trapezoid (`min`/`max` with a `soft` falloff). A sign's score is the weighted
geometric mean of its rules (one clearly violated rule can't be averaged away; if the worst rule is below
`ruleGate` the score is scaled down further). The best sign wins if its score ≥ `minConfidence` (0.55) and
it beats the runner-up by `minMargin` (0.08); otherwise UNKNOWN.

**Stability** (`signStabilizer.js`): a new sign must be seen at ≥ `enterConfidence` (0.70) for `holdMs`
(200 ms) (gaps ≤ 80 ms forgiven). The active sign survives dips down to 0.55 (hysteresis) and is released
after 200 ms of not being seen. Output per frame: `currentSign`, `confidence`, `signChanged` (true only on the
frame it changes, including → UNKNOWN), `previousSign`, and `newSign` (set only when a real sign is newly
activated — **use this for Phase 5**; holding a sign 5 s gives one event).

**Tuning**: everything is in `src/input/gestureConfig.js`. Turn on the debug overlay (set
`CONFIG.signs.debug = true`, open `/?debug=signs`, or press **D**) to see confidence, per-sign scores and the
feature values while you make the sign. To add a sign, add an entry under `signs` in that file.

## Test Phase 4 with a physical webcam (not done yet — please do this)

1. Open `http://localhost:8000/?debug=signs`. Hold one hand ~40–60 cm away, fingers up, palm to the camera, good light.
2. For each sign, hold it ~1 s. Expect `CURRENT SIGN` to show the icon + name once, confidence > ~80 %.
3. Relax the hand: it should go to `UNKNOWN` (not another sign). Remove the hand: `NO HAND DETECTED`.
4. Watch the debug curls. If a finger you're holding straight reads curl > 0.25 (or a curled one < 0.6), adjust
   `straightAngle`/`curledAngle` or the rule ranges in `gestureConfig.js`.
5. Try different distances, slightly rotated hands, both hands, and left vs right hand. Note what flickers or never triggers.

## Project structure

```
shinobi-signs/
├── index.html
├── css/style.css
├── src/
│   ├── main.js                 # entry point / game loop; wires webcam → tracker → panel
│   ├── config.js               # constants incl. CONFIG.handTracking (URLs, thresholds, hold time)
│   ├── game/playerState.js
│   ├── input/
│   │   ├── webcam.js           # camera access
│   │   ├── handTracker.js      # frame loop + stable landmark data (no MediaPipe inside)
│   │   ├── mediapipeBackend.js # the only file that touches MediaPipe
│   │   ├── gestureConfig.js    # ALL recognition thresholds + sign rules (Phase 4)
│   │   ├── gestureFeatures.js  # landmarks → normalised features
│   │   ├── gestureClassifier.js# features → { sign, confidence } (replaceable)
│   │   ├── signStabilizer.js   # smoothing, hysteresis, one event per sign
│   │   └── signPipeline.js     # wires the three above
│   ├── render/{arena,character}.js
│   └── ui/{hud,webcamPanel,debugOverlay}.js
└── tests/                      # see "Tests"
```

## Test it with a physical webcam (please do this — it has not been done yet)

1. Open `http://localhost:8000`, click **Allow**. Wait for `NO HAND DETECTED` (model downloaded).
2. Hold one hand ~40–60 cm from the camera, palm toward it, with decent lighting. Expect
   `HAND DETECTED ✓` and a skeleton (21 dots) on your hand in the preview.
3. **Mirror check:** move your hand to *your* right — the skeleton in the preview must move to the right with it.
4. **Handedness check:** raise your *right* hand. The label under the preview should say `RIGHT`. If it says
   `LEFT`, set `swapHandedness: true` in `src/config.js`.
5. Show both hands: expect `L + R` and two skeletons (cyan = Left, orange = Right).
6. Drop your hand out of view for a moment (< ¼ s): the indicator should not flicker. Longer: `NO HAND DETECTED`.
7. Check the speed line (`TRACKING nn FPS · nn MS`). Watch the arena: it should stay smooth.
8. Console: `__shinobi.handTracker.latest` shows the live data.
9. Combat damage and match resets are controlled by the game flow, not keyboard shortcuts.

## Tests

```bash
node tests/unit_handTracker.mjs                 # 67 checks: tracker logic with a fake clock/video (no browser)
node tests/unit_gestures.mjs                    # 111 checks: Phase 4 features/classifier/stabilizer on SYNTHETIC hands
python3 tests/make_marker_video.py              # (re)creates the fake-camera video, only if the .y4m is missing
python3 -m http.server 8124 &                   # tests expect the game on :8124
python3 tests/browser_phase3.py                 # 56 checks in real Chrome (Playwright)
python3 tests/browser_phase2.py                 # 31 checks: camera permission/failure states still work
python3 tests/browser_phase4.py                 # 26 checks: sign UI in real Chrome (synthetic hands injected into the MediaPipe stub)
bash tests/run_all.sh                           # everything above (starts its own server)
```

The browser tests use Chrome's fake camera playing `tests/fixtures/marker.y4m` and replace MediaPipe
with `tests/fixtures/mediapipe_stub.mjs` (same API shape; finds the magenta marker in the real video
pixels and reports a hand there). They verify our code, mirroring and UI — **not MediaPipe's accuracy or speed.**
Set `CHROME=/path/to/chrome` and `SHOT_DIR=/some/dir` if needed.

## Known limitations

- **Phase 4 has never seen a real hand.** Rule thresholds were chosen against our own synthetic hand model, which
  is also what the tests use, so passing tests is *not* evidence the signs work for people. Expect to tune.
- Likely weak spots to check on hardware: curl values for the thumb-tucked/loose-fist poses, finger *spread*
  (SNAKE requires fingers together; RAM requires index/pinky apart), fingers overlapping the palm when the hand
  turns edge-on, and left/right-hand differences. `palm.tiltDeg` makes TIGER/HORSE/RAM prefer upright hands.

- **Real MediaPipe has not been run** in this project's tests (no internet in the build sandbox) and no
  physical webcam has been used. Expect to adjust after step "Test it with a physical webcam".
- **Handedness** follows MediaPipe's docs (label = the subject's real hand for un-mirrored input) but is unverified on
  hardware; `swapHandedness` is the switch if it's reversed.
- **Inference runs on the browser's main thread** (`detectForVideo` is synchronous). On slow machines it can
  cost game frames; lower `maxFps` or move tracking to a Web Worker if that happens.
- Needs internet on first load (CDN). To go offline, download the three files listed in `config.js` into the project and point the URLs at them.
- MediaPipe is pinned to `@mediapipe/tasks-vision@0.10.32` (1.x exists; a third-party report claims it sends
  usage metrics to Google by default, so 0.10.x was kept — not verified here).
- Hand model is fed the raw camera frame; very dark rooms, motion blur and fingers overlapping each other reduce accuracy.
- The camera picker and automatic reconnect remain future work. Phase 8 room-code multiplayer is implemented using PeerJS/WebRTC; see `PHASE_7_8_GUIDE.md` for setup and network limitations.


## Phase 5B / 5C checkpoint

Phase 5B adds a framework-agnostic sequence HUD view-model in `src/ui/sequenceHudState.js`.
Phase 5C adds `src/game/jutsuBridge.js`, which converts a sequence completion into a `JUTSU_READY` event.
These layers intentionally do not implement combat, HP damage, attack animation, or networking.


## Phase 6 — combat

- `src/game/combatEngine.js` owns match damage, healing, defeat and reset rules while reusing the existing `PlayerState` objects (there is only one HP source).
- `src/game/jutsuSystem.js` maps exact supported sign sequences to the Echo Clone Technique, Spiral Energy Orb and Ancient Toad Guardian, consuming each bridge event once.
- `src/render/effects.js` draws original clone afterimages, a spinning energy orb and an original giant guardian effect on the existing arena canvas. Damage is applied once when the effect reaches its impact point.
- `src/render/character.js` supports attack, hit and defeated presentation states.
- Stabilised webcam sign events trigger attacks, guard and counter. Keyboard shortcuts do not trigger combat damage or match resets.
- Real physical webcam testing was not possible in this build environment. Browser automation and synthetic landmark fixtures validate the integrated code path, not real-world hand recognition accuracy.

Run with:

```bash
cd shinobi-signs
python3 -m http.server 8000
# open http://localhost:8000
```

Use the in-game rematch flow to restart. Only the four Phase 4 signs are implemented; DRAGON/BIRD/RAT are intentionally not referenced.


### Phase 6 test coverage

Run `node tests/unit_combatEngine.mjs` and `node tests/unit_jutsuSystem.mjs` for the new combat tests. The unit suite across Phases 3–8 currently passes **275 assertions**, plus **41 project-integrity checks**. Browser automation could not be completed in this container because browser navigation to its local test server is blocked. Run it on your own machine with Playwright Chromium available and permission to navigate to the local test server.


## Webcam sign-recognition troubleshooting (Phase 6.1)

The stabilizer now tolerates slower MediaPipe inference (up to 450 ms between candidate observations). If the preview says HAND DETECTED but CURRENT SIGN remains UNKNOWN, open `http://localhost:8000/?debug=signs` or press **D**. The debug panel shows raw per-sign scores and each finger's curl. A pose is only accepted when the raw classifier score clears the configured confidence and margin thresholds; a stable sign is then emitted once. Keep the full hand in frame, palm facing the camera, fingers separated enough to be visible, and use bright even lighting. If all raw scores are low, share a screenshot of the debug panel so the actual landmark-derived values can be tuned instead of guessing.


## Webcam sign-recognition troubleshooting (Phase 6.1)

The runtime stabilizer now tolerates slower MediaPipe inference (up to 450 ms between candidate observations) while preserving the original Phase 4 classifier thresholds and default unit-test behavior. If the preview says HAND DETECTED but CURRENT SIGN remains UNKNOWN, open `http://localhost:8000/?debug=signs` or press **D**. The debug panel shows raw per-sign scores and each finger's curl. If RAW is UNKNOWN and all scores are low, the problem is the actual hand pose/landmark geometry rather than sequence recognition. Keep the full hand in frame, palm facing the camera, fingers clearly visible, and use bright even lighting. Share a screenshot of the debug panel to tune the exact feature values rather than guessing.

### Slow webcam recognition tuning (Phase 6 recognition fix)

The runtime sign stabilizer uses a 100 ms confirmation hold, 650 ms candidate grace,
and 650 ms release window. This is intentionally more tolerant than the generic Phase 4
defaults because MediaPipe may only complete inference at about 5–6 FPS on slower CPUs.
The classifier's sign rules and confidence thresholds are unchanged. If a sign still remains
UNKNOWN while the debug overlay shows a high raw score, capture the debug overlay and inspect
the raw sign/candidate timing rather than lowering classifier confidence thresholds.


## Phase 7 & 8 — defense and online multiplayer

Phase 7 adds `src/game/combatActionRouter.js` and `src/game/defenseSystem.js`. In addition to the three existing attack combinations, players can use RAM → TIGER for a timed guard and TIGER → SNAKE → RAM for a one-hit counter. The defensive state resolves incoming damage through the existing `CombatEngine`.

Phase 8 adds `src/network/multiplayer.js` with a six-character room-code flow. The room creator is Player 1 and the joiner is Player 2. The host is authoritative for damage, HP, defense resolution and reset. Peers exchange combat events and state only; webcam video and raw landmarks stay local. PeerJS 1.5.5 is loaded from jsDelivr and uses the public PeerJS broker plus WebRTC data channels. Online play requires internet and may require TURN configuration on restrictive networks.

See `PHASE_7_8_GUIDE.md` for the full move table, room setup, limitations and demo checklist.


## In-game hand-sign help and victory presentation

- Open **? SIGN GUIDE** during a match to see a visual finger-position guide for SNAKE, TIGER, HORSE and RAM.
- The guide explains which fingers should be raised or curled and includes webcam tips: keep the palm facing the camera, hand fully in frame and lighting clear.
- The existing **COMBAT COMBINATIONS** panel remains visible during play so players can quickly reference attack, guard and counter sequences.
- When a player wins a round, a short cinematic finisher plays with a rising fighter reveal, darkened arena, energy slash and victory title.

### Hand-sign quick reference

| Sign | Finger position |
|---|---|
| SNAKE | Index, middle, ring and pinky straight and close together; thumb relaxed |
| TIGER | Index and middle raised together; ring and pinky curled |
| HORSE | Only index raised; middle, ring and pinky curled |
| RAM | Index and pinky raised apart; middle and ring curled |

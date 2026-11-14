# Shinobi Signs — Ultimate Edition

This build integrates the five requested upgrade phases while retaining the existing webcam, MediaPipe, hand-sign, combat, defense and room-code multiplayer systems.

## What's included

### 1. Battle presentation
- Blue Shadow and Crimson Knight use the supplied fighter artwork.
- Emerald Valley uses the supplied landscape image.
- Fighter portraits and names update from the character-selection panel.
- Health bars, round score and chakra meters remain visible in the battle HUD.
- Crimson Knight uses a locally processed transparent cutout to reduce the original white/architectural background.

### 2. Combat animation
- Existing combo attacks make the attacking fighter dash toward the opponent and recover to their starting position.
- Attack lean, squash/stretch, energy streaks, hit flash, recoil, impact ring, screen shake and floating damage numbers.
- The three original sign-combo jutsu remain intact.

### 3. Signature and ultimate attacks
- Blue Shadow signature: lightning strike (`Q` in local practice).
- Crimson Knight signature: flame slash (`P` in local practice).
- Blue Shadow ultimate: Azure Storm (`Space`).
- Crimson Knight ultimate: Crimson Inferno (`Enter`).
- Ultimates require a full 100% chakra meter. Successful hits charge chakra; ultimate attacks consume it.
- Sounds are synthesized locally with Web Audio; no sound CDN is needed. Audio starts after a user interaction due to browser autoplay rules.

### 4. Match experience
- Use **FIGHTER SELECT** to choose either supplied fighter for either player.
- Select Emerald Valley or the original Moonlit Forest canvas arena.
- Match is best-of-three: first fighter to win two rounds takes the match; round three is played if the score is 1–1.
- Intro sting, round transition, victory/defeat overlay, rematch and fighter-select actions.

### 5. Existing systems and quality checks
- Existing four-sign recognition (SNAKE, TIGER, HORSE, RAM), webcam preview, MediaPipe hand tracking, guard/counter, and room-code multiplayer are retained.
- No build step or npm install is required. Assets and application code are local; MediaPipe still loads its existing runtime/model from the configured CDNs.

## Run

From the extracted `shinobi-signs` directory:

```powershell
python -m http.server 8000
```

Open `http://localhost:8000`. Do not open `index.html` as a `file://` URL. If port 8000 is occupied, use another port such as 8001 and open the matching localhost URL.

Allow camera access in the browser. The webcam is used locally for sign recognition; raw video and landmarks are not transmitted to the multiplayer peer.


## Tests

Run the unit/integrity checks from the project directory:

```bash
node tests/unit_handTracker.mjs
node tests/unit_gestures.mjs
node tests/unit_sequence.mjs
node tests/unit_sequenceHud.mjs
node tests/unit_jutsuBridge.mjs
node tests/unit_combatEngine.mjs
node tests/unit_jutsuSystem.mjs
node tests/unit_combatActionRouter.mjs
node tests/unit_defenseSystem.mjs
node tests/unit_multiplayer.mjs
node tests/unit_ultimateEdition.mjs
node tests/project_integrity.mjs
```

Browser regression scripts are in `tests/browser_phase2.py`, `tests/browser_phase3.py`, and `tests/browser_phase4.py`. They require a local Chromium installation and browser access to the local test server.

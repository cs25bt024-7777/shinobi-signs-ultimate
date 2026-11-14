# Visual upgrade handoff

## What changed
- Replaced the placeholder fighter drawings with the two supplied character artworks.
- Added small floating face portraits and player labels above both fighters.
- Added the supplied scenic landscape as the arena background.
- Converted the supplied energy sphere into a local transparent attack sprite.
- Converted the supplied anime clash artwork into a cyan/white impact overlay.
- Added fighter idle bob, attack lunge/squash, hit flash, guard/counter aura, impact shockwave and screen shake.
- Reworked HUD spacing, player portrait/health cards, multiplayer panel, webcam panel, combo guide and bottom input panels.
- Kept the existing webcam hand tracking, four-sign classifier, combo routing, combat rules and multiplayer architecture intact.
- All new artwork is local; no new image CDN dependency.

## Run
From this folder:
```bash
python3 -m http.server 8000
```
Open `http://localhost:8000` in Chrome.

## Verification
- All 11 Node unit/integrity suites pass (total checks reported by the suites: 317).
- All JavaScript modules pass `node --check`.
- Browser regression tests could not be completed in this execution environment because the browser sandbox blocks navigation to the local test server (`ERR_BLOCKED_BY_ADMINISTRATOR`). Run `bash tests/run_all.sh` on your own machine for the full browser checks and verify webcam recognition with a real camera.

## Battle presentation pass — 14 Nov 2026

- Wired the supplied Shadow and Crimson fighter artwork into the canvas character renderer (the earlier visual assets were present in the project but were not connected to the live `Character` instances).
- Wired the supplied green fantasy landscape into the arena renderer.
- Added a centered three-round indicator and round-win score between the player health panels. Each round resets HP; the match result is decided after round three.
- Removed the persistent `HIT! -25 HP` status banner. Damage now appears as a short-lived floating `-N HP` number near the character that was hit, alongside the health-bar update.
- Added a smooth approach / strike / retreat movement to the attacking fighter, character recoil, and impact screen shake.

Run locally with `python3 -m http.server 8000` from this folder, then visit `http://localhost:8000`.

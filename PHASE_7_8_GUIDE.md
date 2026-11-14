# Shinobi Signs — Phase 7 & Phase 8 Guide

This build is based on the uploaded `shinobi-signs-phase6-recognition-fix-v2.zip` and preserves its webcam, MediaPipe, four-sign classifier, sequence/Jutsu bridge, combat engine, Canvas arena and character rendering.

## What Phase 7 adds: defense and counter combat

The four existing hand signs are unchanged: **SNAKE, TIGER, HORSE, RAM**.

| Action | Sign sequence | Effect |
|---|---|---|
| Echo Clone Technique | SNAKE → TIGER → HORSE → RAM | Afterimage clones rush the opponent; 25 damage |
| Spiral Energy Orb | TIGER → RAM → SNAKE | A spinning energy orb travels across the arena; 30 damage |
| Ancient Toad Guardian | HORSE → SNAKE → TIGER | An original giant toad-like guardian appears and strikes; 34 damage |
| Guard Stance | RAM → TIGER | For 1.5 seconds, incoming damage is reduced by 75% |
| Counter Stance | TIGER → SNAKE → RAM | For 1.8 seconds, the next incoming hit is cancelled and 40% of its damage is reflected (minimum 8) |

The action router supports all five combos and recovers from an invalid sequence by retaining a possible valid suffix. Guard and counter are one-use windows, not permanent invulnerability.

## What Phase 8 adds: online two-player room codes

The room creator is **Player 1** and the joiner is **Player 2**.

1. Both players open the game from a local web server or a hosted HTTPS URL.
2. Player 1 selects **CREATE ROOM** and shares the six-character code.
3. Player 2 enters the code and selects **JOIN**.
4. Both players allow camera access in their own browser.
5. Each player's local webcam controls their own character: host = P1, joiner = P2.
6. Each player enters the attack, guard or counter combo using the four hand signs.
7. The host is authoritative for HP, damage, defense resolution and match reset. Both screens receive action events and state snapshots.

Only recognized sign names, actions, health/defense snapshots and room-control messages are sent over the data channel. **Webcam video and raw hand landmarks are not transmitted.**

### Multiplayer requirements and limitations

- PeerJS 1.5.5 is loaded from jsDelivr. Internet is required for the PeerJS client, the PeerJS cloud signalling service and the MediaPipe assets.
- The peer connection is WebRTC data-channel based. The app uses the default public PeerJS broker and default STUN configuration; it does not include a TURN server. Some campus networks, firewalls or restrictive NATs may prevent peers from connecting. For a dependable public deployment, configure a managed TURN service or host an appropriate PeerServer/TURN setup.
- The browser must allow camera access. `http://localhost` is a secure context for local testing; a remote deployment should use HTTPS.
- This is a two-player prototype with the room creator as the authority, not a production anti-cheat server. A refreshed host tab ends the room.
- Both peers should use the same project version. The public room code is a short rendezvous identifier, not an account or password.

## Run it

```bash
cd shinobi-signs
python3 -m http.server 8000
```

Open `http://localhost:8000` in Chrome. For a two-machine demo, both players run/open the same build, create/join the room using the shared code, and allow the webcam.

## Testing

Run the complete automated suite from this folder:

```bash
bash tests/run_all.sh
```

The new Phase 7 and Phase 8 unit tests can also be run separately:

```bash
node tests/unit_combatActionRouter.mjs
node tests/unit_defenseSystem.mjs
node tests/unit_multiplayer.mjs
```

The unit tests validate combo routing, guard/counter timing and reflection, room-code normalization, host/join handshake and action message delivery using a fake PeerJS transport. They do **not** prove real internet connectivity between two physical devices. The existing browser tests require Playwright Chromium and permission to navigate to a local HTTP test server. Physical hand-recognition accuracy must be tested with real webcams.

## Compatibility note

The source ZIP provided for this task is the original Canvas-based Phase 6 project, not the separate standalone 3D experiment discussed earlier. Phase 7 and 8 have been added to this source project without replacing its renderer. The original product concept is restored here: two real players, a room code, webcam hand-sign combat, attack sequences, defense/counter sequences, health bars and a winner state.


## Visual presentation update

The supplied character, landscape, energy-orb and anime clash images are stored locally in
`assets/`. The 2D Canvas fighter renderer uses the two character sprites, with a drawn fallback
if an image cannot load. The arena uses the supplied landscape while retaining animated
atmospheric particles. Attack presentation adds a short lunge, hit flash, glowing guard/counter
aura, supplied energy orb and a brief impact overlay. The HTML HUD now places each fighter
portrait beside their own health bar and keeps the online room controls, camera panel, combo
guide and sign/sequence panels in separate visual zones.

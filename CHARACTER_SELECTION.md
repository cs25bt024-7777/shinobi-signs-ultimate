# Fighter artwork assignment

The two player character slots now use the exact two character images supplied by the user on 2026-11-14:

- Player 1 — Shadow Warrior: `assets/fighter-shadow.png` (blue/black armored fighter)
- Player 2 — Crimson Knight: `assets/fighter-crimson.png` (black armored fighter with red cape and sword)

Both are configured as square 320 x 320 canvas sprites to preserve the source artwork's square aspect ratio. The existing renderer continues to mirror Player 2 toward Player 1, animate idle/attack/hit/guard states, and draw the circular face portrait and player marker above each fighter. Combat, hand-sign recognition, webcam tracking, and multiplayer logic are unchanged.

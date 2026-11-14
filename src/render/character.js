// Animated 2D fighter renderer. Supplied character artwork is drawn as the sprite;
// Canvas primitives remain as a graceful fallback if an image fails to load.

export class Character {
  /**
   * @param {object} opts
   * @param {number} opts.x        horizontal centre of the character
   * @param {number} opts.feetY    y of the ground contact point
   * @param {number} opts.facing   1 = faces right, -1 = faces left
   * @param {object} opts.palette  { suit, suitLight, accent, skin }
   * @param {string} opts.label    "P1" / "P2" marker above the head
   * @param {number} [opts.scale]  overall size multiplier
   */
  constructor({ x, feetY, facing, palette, label, scale = 1.3, sprite = null, spriteWidth = 230, spriteHeight = 330 }) {
    this.x = x;
    this.homeX = x;
    this.attackTargetX = x;
    this.feetY = feetY;
    this.facing = facing;
    this.palette = palette;
    this.label = label;
    this.scale = scale;
    this.sprite = sprite;
    this.spriteWidth = spriteWidth;
    this.spriteHeight = spriteHeight;

    this.time = Math.random() * 10; // desync idle animation
    this.hitTimer = 0;
    this.attackTimer = 0;
    this.attackDuration = 1.08;
    this.defeated = false;
    this.pose = 'idle';              // sign pose / guard / counter presentation
    this.defenseTimer = 0;
    this.attackFlash = 0;
  }

  /** Change the displayed hand-sign pose (only 'idle' exists in Phase 1). */
  setPose(pose) {
    this.pose = pose;
  }

  /** Presentation state transitions used by the combat loop. */
  attack(targetX = this.x + this.facing * 180, duration = 1.08) {
    if (this.defeated) return;
    this.attackDuration = Math.max(.6, duration);
    this.attackTimer = this.attackDuration;
    this.attackFlash = 0.34;
    const stopGap = this.facing * 260;
    this.attackTargetX = targetX - stopGap;
  }
  defeat() { this.defeated = true; this.attackTimer = 0; this.hitTimer = 0; }
  flashHit() { if (!this.defeated) this.hitTimer = 0.4; }
  setDefense(type, duration = 1.5) { if (!this.defeated) { this.pose = type; this.defenseTimer = duration; } }

  update(dt) {
    this.time += dt;
    if (this.hitTimer > 0) this.hitTimer = Math.max(0, this.hitTimer - dt);
    if (this.attackFlash > 0) this.attackFlash = Math.max(0, this.attackFlash - dt);
    if (this.attackTimer > 0) {
      this.attackTimer = Math.max(0, this.attackTimer - dt);
      const progress = 1 - this.attackTimer / this.attackDuration;
      let travel;
      if (progress < 0.56) { const t = progress / 0.56; travel = 1 - Math.pow(1 - t, 3); }
      else if (progress < 0.76) travel = 1;
      else { const t = (progress - 0.76) / 0.24; travel = 1 - (t * t * (3 - 2 * t)); }
      this.x = this.homeX + (this.attackTargetX - this.homeX) * travel;
    } else { this.x = this.homeX; }
    if (this.defenseTimer > 0) {
      this.defenseTimer = Math.max(0, this.defenseTimer - dt);
      if (this.defenseTimer === 0 && (this.pose === 'guard' || this.pose === 'counter')) this.pose = 'idle';
    }
  }

  draw(ctx) {
    const p = this.palette;
    const bob = Math.sin(this.time * 2.4) * 3 + (this.attackTimer > 0 ? -Math.sin((1 - this.attackTimer / this.attackDuration) * Math.PI) * 8 : 0);
    const hitting = this.hitTimer > 0;
    const attacking = this.attackTimer > 0;
    const guarding = this.pose === 'guard' && this.defenseTimer > 0;
    const countering = this.pose === 'counter' && this.defenseTimer > 0;
    const recoil = hitting ? -Math.sin((this.hitTimer / 0.4) * Math.PI) * 14 : 0;

    // Ground shadow (not flipped / not bobbing)
    ctx.save();
    ctx.fillStyle = 'rgba(0, 0, 0, 0.4)';
    ctx.beginPath();
    ctx.ellipse(this.x, this.feetY, 62 * this.scale / 1.3, 13, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    ctx.save();
    ctx.translate(this.x, this.feetY);
    ctx.scale(this.facing * this.scale, this.scale);
    const attackProgress = attacking ? 1 - this.attackTimer / this.attackDuration : 0;
    const squash = attacking ? 1 + 0.09 * Math.sin(Math.min(1, attackProgress / 0.56) * Math.PI) : 1;
    const attackLift = attacking ? -Math.sin(Math.min(1, attackProgress / 0.56) * Math.PI) * 13 : 0;
    ctx.translate(recoil + (this.defeated ? -8 : 0), (this.defeated ? 14 : 0) + attackLift);
    if (attacking) ctx.rotate(-0.12 * Math.sin(Math.min(1, attackProgress / .72) * Math.PI) * this.facing);
    if (this.defeated) ctx.rotate(this.facing * .42);
    ctx.scale(squash, attacking ? 2 - squash : 1);
    if (this.defeated) ctx.globalAlpha = 0.62;
    if (hitting) ctx.globalAlpha = Math.floor(this.hitTimer * 30) % 2 ? 0.45 : 1;

    // Supplied character artwork is the primary fighter sprite; Canvas fallback remains available.
    if (this.sprite?.complete && this.sprite.naturalWidth > 0) {
      const pulse = 0.5 + 0.5 * Math.sin(this.time * 8);
      if (attacking || guarding || countering) {
        ctx.save();
        ctx.globalAlpha = attacking ? 0.28 + pulse * 0.2 : 0.18 + pulse * 0.12;
        ctx.globalCompositeOperation = 'lighter';
        ctx.shadowColor = this.palette.accent;
        ctx.shadowBlur = attacking ? 34 : 24;
        ctx.strokeStyle = ctx.shadowColor;
        ctx.lineWidth = 5;
        ctx.beginPath();
        ctx.ellipse(0, -this.spriteHeight * 0.48, this.spriteWidth * 0.48, this.spriteHeight * 0.47, 0, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }
      if (hitting) {
        ctx.save();
        ctx.globalCompositeOperation = 'screen';
        ctx.globalAlpha = 0.55 + 0.25 * Math.sin(this.time * 70);
        ctx.fillStyle = '#d8f8ff';
        ctx.fillRect(-this.spriteWidth * 0.55, -this.spriteHeight, this.spriteWidth * 1.1, this.spriteHeight);
        ctx.restore();
      }
      if (attacking) {
        const streak = Math.max(0, 1 - attackProgress / .7);
        ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = streak * .55;
        const glow = ctx.createLinearGradient(-this.facing * 190, -this.spriteHeight * .58, 0, -this.spriteHeight * .58);
        glow.addColorStop(0, 'rgba(90,210,255,0)'); glow.addColorStop(1, this.palette.accent);
        ctx.fillStyle = glow; ctx.beginPath(); ctx.ellipse(-this.facing * 85, -this.spriteHeight * .55, 115, 12, -this.facing * .12, 0, Math.PI * 2); ctx.fill(); ctx.restore();
      }
      ctx.drawImage(this.sprite, -this.spriteWidth / 2, -this.spriteHeight + bob, this.spriteWidth, this.spriteHeight);
      ctx.restore();
      this._drawMarker(ctx, bob);
      return;
    }

    // --- defensive aura / stance cue ---
    if (guarding || countering) {
      ctx.save();
      ctx.globalAlpha = 0.35 + 0.18 * Math.sin(this.time * 18);
      ctx.strokeStyle = guarding ? '#8deaff' : '#ffd46b';
      ctx.lineWidth = guarding ? 7 : 5;
      ctx.shadowColor = ctx.strokeStyle; ctx.shadowBlur = 22;
      ctx.beginPath();
      ctx.ellipse(48, -122, guarding ? 48 : 42, guarding ? 69 : 58, -0.2, -Math.PI * 0.65, Math.PI * 0.65);
      ctx.stroke();
      ctx.restore();
    }

    // --- scarf tail (behind the body, flutters) ---
    ctx.fillStyle = p.accent;
    ctx.beginPath();
    ctx.moveTo(-20, -170 + bob);
    for (let t = 0; t <= 1.001; t += 0.1) {
      ctx.lineTo(-20 - t * 78, -170 + bob + Math.sin(this.time * 5 + t * 5) * 9 * t + t * 8);
    }
    for (let t = 1; t >= -0.001; t -= 0.1) {
      ctx.lineTo(-20 - t * 78, -156 + bob + Math.sin(this.time * 5 + t * 5) * 9 * t + t * 8);
    }
    ctx.closePath();
    ctx.fill();

    // --- back arm ---
    this._arm(ctx, -20, -156 + bob, -4, -124 + bob, 32, -134 + bob, p.suit, p.skin);

    // --- legs ---
    ctx.fillStyle = p.suit;
    ctx.beginPath(); ctx.roundRect(-28, -92, 24, 92, 6); ctx.fill();
    ctx.beginPath(); ctx.roundRect(6, -92, 24, 92, 6); ctx.fill();
    // wraps + sandals
    ctx.fillStyle = p.accent;
    ctx.fillRect(-28, -22, 24, 6);
    ctx.fillRect(6, -22, 24, 6);
    ctx.fillStyle = '#10141f';
    ctx.beginPath(); ctx.roundRect(-32, -10, 32, 10, 4); ctx.fill();
    ctx.beginPath(); ctx.roundRect(2, -10, 34, 10, 4); ctx.fill();

    // --- torso ---
    const tg = ctx.createLinearGradient(0, -176, 0, -84);
    tg.addColorStop(0, p.suitLight);
    tg.addColorStop(1, p.suit);
    ctx.fillStyle = tg;
    ctx.beginPath(); ctx.roundRect(-34, -176 + bob, 68, 92, 14); ctx.fill();
    // belt + knot
    ctx.fillStyle = p.accent;
    ctx.fillRect(-34, -112 + bob, 68, 9);
    ctx.beginPath(); ctx.arc(8, -108 + bob, 7, 0, Math.PI * 2); ctx.fill();

    // --- head ---
    const hy = -206 + bob;
    ctx.fillStyle = p.suit;
    ctx.beginPath(); ctx.arc(0, hy, 30, 0, Math.PI * 2); ctx.fill();   // hood
    ctx.fillStyle = p.skin;
    ctx.beginPath(); ctx.roundRect(-22, hy - 9, 44, 20, 8); ctx.fill(); // face opening
    // eyes (look toward the opponent)
    ctx.fillStyle = '#10141f';
    ctx.fillRect(2, hy - 3, 6, 6);
    ctx.fillRect(13, hy - 3, 6, 6);
    // headband + plate
    ctx.fillStyle = p.accent;
    ctx.fillRect(-31, hy - 20, 62, 9);
    ctx.fillStyle = '#d8dff0';
    ctx.beginPath(); ctx.roundRect(-11, hy - 21, 22, 11, 2); ctx.fill();
    ctx.fillStyle = '#5b6479';
    ctx.fillRect(-4, hy - 17, 8, 3);

    // --- front arm (hands raised, ready to sign) ---
    this._arm(ctx, 22, -156 + bob, attacking ? 62 : 46, attacking ? -174 : -126 + bob,
      attacking ? 96 : 42, attacking ? -178 : -150 + bob + Math.sin(this.time * 3) * 2, p.suit, p.skin);

    ctx.restore();

    this._drawMarker(ctx, bob);
  }

  _drawMarker(ctx, bob) {
    const accent = this.palette.accent;
    ctx.save();
    const my = this.feetY - (this.sprite ? this.spriteHeight : 262) * this.scale + bob * this.scale - 18;
    ctx.textAlign = 'center';
    if (this.sprite?.complete && this.sprite.naturalWidth > 0) {
      ctx.save();
      ctx.beginPath(); ctx.arc(this.x, my - 42, 25, 0, Math.PI * 2); ctx.clip();
      ctx.fillStyle = 'rgba(4,10,22,.95)'; ctx.fill();
      const cropH = this.sprite.naturalHeight * 0.42;
      ctx.drawImage(this.sprite, 0, 0, this.sprite.naturalWidth, cropH, this.x - 24, my - 66, 48, 48);
      ctx.restore();
      ctx.strokeStyle = accent; ctx.lineWidth = 3;
      ctx.shadowColor = accent; ctx.shadowBlur = 12;
      ctx.beginPath(); ctx.arc(this.x, my - 42, 25, 0, Math.PI * 2); ctx.stroke();
      ctx.shadowBlur = 0;
    }
    ctx.font = '900 15px "Trebuchet MS", sans-serif';
    ctx.fillStyle = 'rgba(4,10,22,.88)';
    ctx.strokeStyle = accent;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(this.x - 31, my - 12, 62, 24, 9);
    ctx.fill(); ctx.stroke();
    ctx.fillStyle = accent;
    ctx.fillText(this.label, this.x, my + 5);
    ctx.restore();
  }

  /** Two-segment arm with a round hand. */
  _arm(ctx, sx, sy, ex, ey, hx, hy, sleeve, skin) {
    ctx.strokeStyle = sleeve;
    ctx.lineWidth = 16;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(sx, sy); ctx.lineTo(ex, ey); ctx.lineTo(hx, hy);
    ctx.stroke();
    ctx.fillStyle = skin;
    ctx.beginPath(); ctx.arc(hx, hy, 9, 0, Math.PI * 2); ctx.fill();
  }
}

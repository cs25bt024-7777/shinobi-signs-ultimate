/** Original Canvas combat effects shared by offline and online matches. */
export class Effects {
  constructor() { this.items = []; this.assets = {}; this.damageNumbers = []; }
  setAssets(assets) { this.assets = assets || {}; }
  addDamageNumber(x, y, amount, color = '#fff') { this.damageNumbers.push({ x, y, amount, color, age: 0, life: 1.05 }); }
  launch({ id, type, from, to, y, duration, attacker = 0, target = 1, damage = 0 }) {
    this.items.push({ id, type, from, to, y, duration, attacker, target, damage, age: 0, hit: false });
  }
  update(dt, onHit) {
    for (const effect of this.items) {
      effect.age += dt;
      if (effect.impactAge !== undefined) effect.impactAge += dt;
      const t = Math.min(1, effect.age / effect.duration);
      if (!effect.hit && t >= 0.82) {
        effect.hit = true;
        onHit?.(effect);
      }
    }
    this.items = this.items.filter((effect) => effect.age < effect.duration + 0.28);
    this.damageNumbers.forEach((n) => { n.age += dt; });
    this.damageNumbers = this.damageNumbers.filter((n) => n.age < n.life);
  }
  draw(ctx) {
    for (const effect of this.items) {
      const t = Math.min(1, effect.age / effect.duration);
      const x = effect.from + (effect.to - effect.from) * t;
      if (effect.impactAge >= 0 && effect.impactAge < 0.24) this._drawImpact(ctx, effect, x);
      if (effect.type === 'clone') this._drawClones(ctx, effect, x, t);
      else if (effect.type === 'orb') this._drawOrb(ctx, effect, x, t);
      else if (effect.type === 'summon') this._drawGuardian(ctx, effect, x, t);
      else if (effect.type === 'lightning') this._drawLightning(ctx, effect, x);
      else if (effect.type === 'wind') this._drawWind(ctx, effect, x);
      else if (effect.type === 'ultimate-blue' || effect.type === 'ultimate-red') this._drawUltimate(ctx, effect, x, t);
      else this._drawFire(ctx, effect, x);
    }
    for (const n of this.damageNumbers) {
      const t = n.age / n.life;
      ctx.save(); ctx.globalAlpha = Math.max(0, 1 - t);
      ctx.font = '900 30px Trebuchet MS, sans-serif'; ctx.textAlign = 'center';
      ctx.lineWidth = 5; ctx.strokeStyle = 'rgba(2,8,20,.9)'; ctx.shadowColor = n.color; ctx.shadowBlur = 18;
      const label = `-${n.amount} HP`; const y = n.y - t * 68;
      ctx.strokeText(label, n.x, y); ctx.fillStyle = n.color; ctx.fillText(label, n.x, y);
      ctx.restore();
    }
  }

  _drawUltimate(ctx, e, x, t) {
    const blue = e.type === 'ultimate-blue';
    const color = blue ? '#62eaff' : '#ff536c';
    const pale = blue ? '#e9fdff' : '#fff0dc';
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    const pulse = .5 + .5 * Math.sin(e.age * 24);
    const radius = 28 + 76 * Math.sin(Math.min(1, t) * Math.PI * .72) + pulse * 12;
    const gradient = ctx.createRadialGradient(x, e.y, 2, x, e.y, radius * 2.1);
    gradient.addColorStop(0, pale); gradient.addColorStop(.22, color); gradient.addColorStop(1, 'rgba(20,100,255,0)');
    ctx.fillStyle = gradient; ctx.beginPath(); ctx.arc(x, e.y, radius * 2.1, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = pale; ctx.shadowColor = color; ctx.shadowBlur = 32; ctx.lineWidth = 5 + pulse * 3;
    for (let i = 0; i < 4; i++) {
      ctx.save(); ctx.translate(x, e.y); ctx.rotate(e.age * (i % 2 ? -2.5 : 2.5) + i * 1.4);
      ctx.beginPath(); ctx.ellipse(0, 0, radius * (1.1 + i * .16), radius * (.32 + i * .07), 0, 0, Math.PI * 2); ctx.stroke(); ctx.restore();
    }
    const beam = Math.max(0, Math.sin(Math.min(1, t) * Math.PI));
    ctx.globalAlpha = beam * .6; ctx.fillStyle = color;
    ctx.fillRect(Math.min(e.from, x) - 40, e.y - 3, Math.abs(x - e.from) + 80, 6);
    // fast streaks radiating from the core
    for (let i = 0; i < 12; i++) {
      const a = i * Math.PI / 6 + e.age * 1.7;
      const inner = radius * .8, outer = radius * (1.5 + .4 * pulse);
      ctx.beginPath(); ctx.moveTo(x + Math.cos(a) * inner, e.y + Math.sin(a) * inner);
      ctx.lineTo(x + Math.cos(a) * outer, e.y + Math.sin(a) * outer); ctx.stroke();
    }
    ctx.restore();
  }
  _drawFire(ctx, e, x) {
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    const r = 17 + 9 * Math.sin(e.age * 28);
    const g = ctx.createRadialGradient(x, e.y, 2, x, e.y, r * 2.5);
    g.addColorStop(0, '#fff7bd'); g.addColorStop(.35, '#ffb02e'); g.addColorStop(1, 'rgba(255,55,12,0)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, e.y, r * 2.5, 0, Math.PI * 2); ctx.fill(); ctx.restore();
  }
  _drawLightning(ctx, e, x) {
    ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.strokeStyle = '#a8f5ff'; ctx.lineWidth = 5; ctx.shadowColor = '#49dfff'; ctx.shadowBlur = 24;
    ctx.beginPath(); ctx.moveTo(e.from, e.y);
    for (let i = 1; i <= 7; i++) ctx.lineTo(e.from + (x - e.from) * i / 7, e.y + Math.sin(i * 12 + e.age * 40) * 13);
    ctx.stroke(); ctx.restore();
  }
  _drawWind(ctx, e, x) {
    ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.translate(x, e.y); ctx.rotate(-0.22);
    ctx.strokeStyle = '#b8f4ff'; ctx.lineWidth = 8; ctx.shadowColor = '#70dfff'; ctx.shadowBlur = 22;
    ctx.beginPath(); ctx.moveTo(-34, 12); ctx.quadraticCurveTo(0, -25, 42, -2); ctx.stroke(); ctx.restore();
  }
  _drawClones(ctx, e, x, t) {
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    const pulse = 0.5 + 0.5 * Math.sin(e.age * 18);
    const offsets = [-72, 0, 72];
    offsets.forEach((offset, i) => {
      const drift = Math.sin(e.age * 12 + i * 2) * 11;
      const cx = x + offset * (0.35 + t * 0.65) + drift;
      const cy = e.y + Math.cos(e.age * 10 + i) * 9;
      ctx.save(); ctx.translate(cx, cy); ctx.globalAlpha = 0.48 + pulse * 0.22;
      ctx.fillStyle = '#a7dfff'; ctx.shadowColor = '#55caff'; ctx.shadowBlur = 18;
      ctx.beginPath(); ctx.ellipse(0, -24, 12, 14, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillRect(-9, -12, 18, 34);
      ctx.strokeStyle = '#bcecff'; ctx.lineWidth = 6; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(-6, -4); ctx.lineTo(-20, 9); ctx.moveTo(6, -4); ctx.lineTo(20, 8); ctx.moveTo(-5, 21); ctx.lineTo(-13, 39); ctx.moveTo(5, 21); ctx.lineTo(13, 39); ctx.stroke();
      ctx.restore();
    });
    ctx.restore();
  }
  _drawImpact(ctx, e, x) {
    const image = this.assets.clash;
    if (!image?.complete || !image.naturalWidth) return;
    const fade = 1 - e.impactAge / 0.24;
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    ctx.globalAlpha = fade * 0.72;
    ctx.drawImage(image, x - 230, e.y - 155, 460, 260);
    ctx.globalAlpha = fade * 0.78;
    ctx.strokeStyle = '#c8f8ff';
    ctx.shadowColor = '#52dfff';
    ctx.shadowBlur = 26;
    ctx.lineWidth = 5 * fade + 1;
    const radius = 28 + (e.impactAge / 0.24) * 118;
    ctx.beginPath(); ctx.ellipse(x, e.y, radius * 1.35, radius * .62, 0, 0, Math.PI * 2); ctx.stroke();
    ctx.restore();
  }
  _drawOrb(ctx, e, x, t) {
    ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.translate(x, e.y);
    const radius = 16 + 16 * Math.sin(Math.PI * t) + 5 * Math.sin(e.age * 22);
    const suppliedOrb = this.assets.orb;
    if (suppliedOrb?.complete && suppliedOrb.naturalWidth) {
      ctx.globalAlpha = 0.72;
      ctx.drawImage(suppliedOrb, -radius * 2.35, -radius * 1.7, radius * 4.7, radius * 3.4);
      ctx.globalAlpha = 1;
    }
    const g = ctx.createRadialGradient(-radius * .25, -radius * .25, 2, 0, 0, radius * 1.5);
    g.addColorStop(0, '#ffffff'); g.addColorStop(.22, '#d8faff'); g.addColorStop(.55, '#58d8ff'); g.addColorStop(1, 'rgba(24,99,255,0)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, radius * 1.5, 0, Math.PI * 2); ctx.fill();
    for (let i = 0; i < 3; i++) {
      ctx.save(); ctx.rotate(e.age * (5 + i * 1.4) * (i % 2 ? -1 : 1));
      ctx.strokeStyle = i === 0 ? '#fff' : '#70dfff'; ctx.lineWidth = 3 - i * .45; ctx.shadowColor = '#36bfff'; ctx.shadowBlur = 15;
      ctx.beginPath(); ctx.ellipse(0, 0, radius * (1.25 + i * .18), radius * (.48 + i * .09), i * .7, -.6, 2.3); ctx.stroke(); ctx.restore();
    }
    ctx.restore();
  }
  _drawGuardian(ctx, e, x, t) {
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    const rise = Math.sin(Math.min(1, t * 1.6) * Math.PI / 2) * 1;
    const scale = 0.45 + rise * 0.75;
    ctx.translate(x, e.y + 30 * (1 - rise)); ctx.scale(scale, scale);
    const bob = Math.sin(e.age * 7) * 4;
    ctx.fillStyle = 'rgba(94,255,180,.22)'; ctx.shadowColor = '#70ffbb'; ctx.shadowBlur = 28;
    ctx.beginPath(); ctx.ellipse(0, 8 + bob, 83, 54, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#256d62'; ctx.strokeStyle = '#a3ffdb'; ctx.lineWidth = 5;
    ctx.beginPath(); ctx.ellipse(0, 0 + bob, 76, 48, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    // Broad head, raised eyes and a wide mouth create an original toad-like guardian silhouette.
    ctx.fillStyle = '#3e9c7e';
    ctx.beginPath(); ctx.ellipse(0, -31 + bob, 58, 37, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    for (const side of [-1, 1]) {
      ctx.fillStyle = '#a9ffdc'; ctx.beginPath(); ctx.ellipse(side * 30, -57 + bob, 17, 20, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#102b2a'; ctx.beginPath(); ctx.arc(side * 30, -57 + bob, 7, 0, Math.PI * 2); ctx.fill();
    }
    ctx.strokeStyle = '#0d3430'; ctx.lineWidth = 7; ctx.beginPath(); ctx.moveTo(-38, -15 + bob); ctx.quadraticCurveTo(0, 5 + bob, 38, -15 + bob); ctx.stroke();
    ctx.strokeStyle = '#a4ffe0'; ctx.lineWidth = 12; ctx.beginPath(); ctx.moveTo(-42, 31 + bob); ctx.lineTo(-65, 54 + bob); ctx.moveTo(42, 31 + bob); ctx.lineTo(65, 54 + bob); ctx.stroke();
    ctx.restore();
  }
  clear() { this.items = []; this.damageNumbers = []; }
}

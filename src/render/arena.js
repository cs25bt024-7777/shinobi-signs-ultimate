// Battle arena: a moonlit forest with layered mountains, pine silhouettes,
// drifting mist and fireflies. All static layers are pre-rendered once to
// offscreen canvases; only stars, mist and fireflies animate each frame.

/** Small seeded RNG so the scenery looks the same on every load. */
function mulberry32(seed) {
  let a = seed;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeLayer(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

export class Arena {
  constructor(width, height, horizonY) {
    this.w = width;
    this.h = height;
    this.horizonY = horizonY;
    this.time = 0;
    this.backgroundImage = null;

    const rnd = mulberry32(7);

    this.stars = Array.from({ length: 100 }, () => ({
      x: rnd() * width,
      y: rnd() * horizonY * 0.6,
      r: rnd() * 1.3 + 0.3,
      phase: rnd() * 6.28,
    }));

    this.fireflies = Array.from({ length: 24 }, () => ({
      x: rnd() * width,
      y: horizonY - rnd() * 230 + 60,
      phase: rnd() * 6.28,
      speed: 0.3 + rnd() * 0.5,
    }));

    this.sky = makeLayer(width, height);
    this.scenery = makeLayer(width, height);
    this._paintSky(this.sky.getContext('2d'));
    this._paintScenery(this.scenery.getContext('2d'), rnd);
  }

  setBackground(image) { this.backgroundImage = image; }

  // ---------- static layers ----------

  _paintSky(ctx) {
    const g = ctx.createLinearGradient(0, 0, 0, this.horizonY);
    g.addColorStop(0, '#05081a');
    g.addColorStop(0.6, '#142048');
    g.addColorStop(1, '#2b3a6b');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, this.w, this.h);

    // Moon with soft glow
    const mx = 980, my = 130;
    const glow = ctx.createRadialGradient(mx, my, 10, mx, my, 220);
    glow.addColorStop(0, 'rgba(255, 240, 200, 0.45)');
    glow.addColorStop(1, 'rgba(255, 240, 200, 0)');
    ctx.fillStyle = glow;
    ctx.fillRect(mx - 240, my - 240, 480, 480);
    ctx.fillStyle = '#fff4d6';
    ctx.beginPath(); ctx.arc(mx, my, 56, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = 'rgba(210, 190, 150, 0.35)';
    ctx.beginPath(); ctx.arc(mx - 16, my - 10, 12, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(mx + 18, my + 14, 8, 0, Math.PI * 2); ctx.fill();
  }

  _paintScenery(ctx, rnd) {
    const { w, h, horizonY } = this;

    // Two mountain ranges (far = lighter, near = darker)
    const ranges = [
      { color: '#1c2750', base: horizonY - 150, amp: 120, freq: 0.0045, seed: 1.3 },
      { color: '#121a38', base: horizonY - 80,  amp: 90,  freq: 0.0065, seed: 4.1 },
    ];
    for (const r of ranges) {
      ctx.fillStyle = r.color;
      ctx.beginPath();
      ctx.moveTo(0, horizonY + 5);
      for (let x = 0; x <= w; x += 8) {
        const n = Math.sin(x * r.freq + r.seed) + 0.5 * Math.sin(x * r.freq * 2.3 + r.seed * 3)
                + 0.25 * Math.sin(x * r.freq * 5.1 + r.seed * 7);
        const y = r.base - r.amp * (0.5 + 0.5 * (n / 1.75));
        ctx.lineTo(x, y);
      }
      ctx.lineTo(w, horizonY + 5);
      ctx.closePath();
      ctx.fill();
    }

    // Pine tree silhouettes – kept low in the middle so the fighters stay clear
    ctx.fillStyle = '#0a0f1e';
    for (let x = -20; x < w + 20; x += 34 + rnd() * 26) {
      const centre = x > 380 && x < 900;
      if (centre && rnd() < 0.75) continue;
      const th = (centre ? 70 : 130) + rnd() * 130;
      this._pine(ctx, x, horizonY + 8, th);
    }

    // Ground
    const gg = ctx.createLinearGradient(0, horizonY, 0, h);
    gg.addColorStop(0, '#222c44');
    gg.addColorStop(1, '#0a0e1a');
    ctx.fillStyle = gg;
    ctx.fillRect(0, horizonY, w, h - horizonY);

    // Bright rim along the horizon
    ctx.fillStyle = 'rgba(160, 190, 255, 0.25)';
    ctx.fillRect(0, horizonY, w, 2);

    // Training-ground ring (perspective ellipse) and centre line
    ctx.strokeStyle = 'rgba(200, 215, 255, 0.18)';
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.ellipse(w / 2, 640, 520, 62, 0, 0, Math.PI * 2); ctx.stroke();
    ctx.setLineDash([14, 12]);
    ctx.beginPath(); ctx.moveTo(w / 2, 585); ctx.lineTo(w / 2, 695); ctx.stroke();
    ctx.setLineDash([]);

    // A few stones for texture
    ctx.fillStyle = 'rgba(255, 255, 255, 0.05)';
    for (let i = 0; i < 40; i++) {
      const sx = rnd() * w, sy = horizonY + 20 + rnd() * (h - horizonY - 30);
      ctx.beginPath(); ctx.ellipse(sx, sy, 6 + rnd() * 10, 2 + rnd() * 3, 0, 0, Math.PI * 2); ctx.fill();
    }
  }

  _pine(ctx, x, baseY, height) {
    const tiers = 4;
    const halfW = height * 0.22;
    ctx.beginPath();
    for (let i = 0; i < tiers; i++) {
      const top = baseY - height + (i * height) / tiers * 0.85;
      const bot = baseY - height * 0.15 - (tiers - 1 - i) * (height / tiers) * 0.55;
      const hw = halfW * (0.5 + i / tiers);
      ctx.moveTo(x, top);
      ctx.lineTo(x + hw, bot);
      ctx.lineTo(x - hw, bot);
      ctx.closePath();
    }
    ctx.fill();
    ctx.fillRect(x - 3, baseY - height * 0.2, 6, height * 0.2);
  }

  // ---------- per-frame ----------

  update(dt) {
    this.time += dt;
  }

  draw(ctx) {
    if (this.backgroundImage?.complete && this.backgroundImage.naturalWidth > 0) {
      const iw = this.backgroundImage.naturalWidth, ih = this.backgroundImage.naturalHeight;
      const scale = Math.max(this.w / iw, this.h / ih);
      const dw = iw * scale, dh = ih * scale;
      ctx.drawImage(this.backgroundImage, (this.w - dw) / 2, (this.h - dh) / 2, dw, dh);
      const shade = ctx.createLinearGradient(0, 0, 0, this.h);
      shade.addColorStop(0, 'rgba(3,10,25,.30)');
      shade.addColorStop(.62, 'rgba(3,10,25,.12)');
      shade.addColorStop(1, 'rgba(2,8,18,.48)');
      ctx.fillStyle = shade; ctx.fillRect(0, 0, this.w, this.h);
    } else {
      ctx.drawImage(this.sky, 0, 0);
    }

    // Twinkling stars
    for (const s of this.stars) {
      const a = 0.45 + 0.55 * Math.abs(Math.sin(this.time * 1.2 + s.phase));
      ctx.fillStyle = `rgba(255, 255, 255, ${a.toFixed(2)})`;
      ctx.beginPath(); ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2); ctx.fill();
    }

    if (!(this.backgroundImage?.complete && this.backgroundImage.naturalWidth > 0)) ctx.drawImage(this.scenery, 0, 0);

    // Drifting mist banks
    for (let i = 0; i < 4; i++) {
      const x = ((this.time * (8 + i * 5) + i * 420) % (this.w + 700)) - 350;
      const y = this.horizonY - 10 + i * 18;
      const g = ctx.createRadialGradient(x, y, 10, x, y, 320);
      g.addColorStop(0, 'rgba(150, 170, 220, 0.12)');
      g.addColorStop(1, 'rgba(150, 170, 220, 0)');
      ctx.fillStyle = g;
      ctx.fillRect(x - 330, y - 120, 660, 240);
    }

    // Fireflies
    for (const f of this.fireflies) {
      const fx = f.x + Math.sin(this.time * f.speed + f.phase) * 30;
      const fy = f.y + Math.cos(this.time * f.speed * 0.8 + f.phase) * 18;
      const a = 0.3 + 0.7 * Math.abs(Math.sin(this.time * 1.5 + f.phase));
      const g = ctx.createRadialGradient(fx, fy, 0, fx, fy, 9);
      g.addColorStop(0, `rgba(255, 240, 150, ${a.toFixed(2)})`);
      g.addColorStop(1, 'rgba(255, 240, 150, 0)');
      ctx.fillStyle = g;
      ctx.fillRect(fx - 9, fy - 9, 18, 18);
    }
  }
}

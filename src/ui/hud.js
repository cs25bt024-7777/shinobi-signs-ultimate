// Thin wrapper around the DOM HUD defined in index.html.
// Game code calls these methods and never touches the DOM directly.

export class Hud {
  constructor() {
    const q = (id) => document.getElementById(id);
    this.hp = [q('hp-0'), q('hp-1')].map((root) => ({
      fill: root.querySelector('.fill'),
      ghost: root.querySelector('.ghost'),
      bar: root.querySelector('.bar'),
      text: root.querySelector('.hp-text'),
      meter: root.querySelector('.chakra-track i'),
      meterText: root.querySelector('.chakra b'),
    }));
    this.status = q('status');
    this.round = q('round-indicator');
    this.playerNames = [q('hp-0')?.querySelector('.hp-name'), q('hp-1')?.querySelector('.hp-name')];
    this.sign = [q('sign-0'), q('sign-1')].map((root) => root.querySelector('.sign-value'));
    this.seqSlots = q('sequence').querySelector('.seq-slots');
    this.result = q('match-result');
  }

  /** Update one player's health bar (index 0 or 1). */
  setHp(index, hp, maxHp) {
    const pct = (hp / maxHp) * 100;
    const el = this.hp[index];
    el.fill.style.width = `${pct}%`;
    el.ghost.style.width = `${pct}%`; // CSS delays this so the damage "trail" is visible
    el.bar.classList.toggle('low', pct <= 30);
    el.text.textContent = `${hp} HP`;
  }

  setMeter(index, value) {
    const amount = Math.max(0, Math.min(100, value));
    const el = this.hp[index];
    if (el?.meter) el.meter.style.width = `${amount}%`;
    if (el?.meterText) el.meterText.textContent = `${Math.round(amount)}%`;
    this.hp[index]?.bar?.classList.toggle('ultimate-ready', amount >= 100);
  }

  showMatchResult(winner, wins) {
    if (!this.result) return;
    const title = document.getElementById('result-title');
    const detail = document.getElementById('result-detail');
    const score = document.getElementById('result-score');
    title.textContent = winner === null ? 'DRAW' : `PLAYER ${winner + 1} WINS`;
    title.style.color = winner === 0 ? '#75eaff' : winner === 1 ? '#ff7184' : '#ffe08a';
    detail.textContent = winner === null ? 'THE RIVALS ARE EVENLY MATCHED' : 'THE ARENA HAS A NEW CHAMPION';
    score.textContent = `${wins[0]} — ${wins[1]}`;
    this.result.hidden = false;
  }
  hideMatchResult() { if (this.result) this.result.hidden = true; }

  setStatus(text) {
    this.status.textContent = text || '';
    this.status.classList.toggle('visible', !!text);
  }

  setRound(round, total, wins = [0, 0]) {
    if (!this.round) return;
    this.round.querySelector('.round-number').textContent = `ROUND ${round} / ${total}`;
    this.round.querySelector('.round-wins').textContent = `${wins[0]}  —  ${wins[1]}`;
  }

  setPlayerLabel(index, text) {
    if (this.playerNames[index]) this.playerNames[index].textContent = text;
  }

  /** Show the currently detected sign for a player (Phase 4+). */
  setSign(index, text) {
    this.sign[index].textContent = text || '—';
  }

  /**
   * Show the required sequence (Phase 5+).
   * @param {{label:string, done:boolean}[]} slots
   */
  setSequence(slots) {
    this.seqSlots.replaceChildren(
      ...slots.map((s) => {
        const d = document.createElement('div');
        d.className = 'seq-slot' + (s.done ? ' done' : '');
        d.textContent = s.done ? '✓' : s.label;
        return d;
      })
    );
  }
}

/** Phase 7: short, readable defensive windows used by the single combat engine. */
export class DefenseSystem {
  constructor({ onEvent = () => {} } = {}) {
    this.onEvent = onEvent;
    this.players = [this._empty(), this._empty()];
  }
  _empty() { return { guardUntil: 0, counterUntil: 0 }; }
  activate(playerIndex, type, now = Date.now(), durationMs = null) {
    if (![0, 1].includes(playerIndex) || !['guard', 'counter'].includes(type)) {
      return { type: 'ignored', reason: 'invalid-defense' };
    }
    const duration = durationMs ?? (type === 'guard' ? 1500 : 1800);
    const state = this.players[playerIndex];
    state.guardUntil = 0;
    state.counterUntil = 0;
    state[type === 'guard' ? 'guardUntil' : 'counterUntil'] = now + duration;
    const event = { type: 'defense-start', playerIndex, defenseType: type, expiresAt: now + duration, durationMs: duration };
    this.onEvent(event);
    return event;
  }
  resolveIncomingAttack(defenderIndex, attackerIndex, damage, now = Date.now()) {
    const state = this.players[defenderIndex];
    if (!state || !Number.isFinite(damage) || damage < 0) {
      return { applied: 0, blocked: false, counterDamage: 0, reason: 'invalid' };
    }
    if (state.counterUntil > now) {
      state.counterUntil = 0; // one successful counter per stance
      const counterDamage = Math.max(8, Math.round(damage * 0.4));
      const result = { applied: 0, blocked: true, countered: true, counterDamage, reason: 'counter' };
      this.onEvent({ type: 'counter-success', defenderIndex, attackerIndex, ...result });
      return result;
    }
    if (state.guardUntil > now) {
      const applied = Math.ceil(damage * 0.25); // guard absorbs 75%
      const result = { applied, blocked: true, countered: false, counterDamage: 0, reason: 'guard' };
      this.onEvent({ type: 'guard-block', defenderIndex, attackerIndex, ...result });
      return result;
    }
    return { applied: damage, blocked: false, countered: false, counterDamage: 0, reason: 'open' };
  }
  getSnapshot(now = Date.now()) {
    return this.players.map((p) => ({
      guardRemaining: Math.max(0, p.guardUntil - now),
      counterRemaining: Math.max(0, p.counterUntil - now),
    }));
  }
  applySnapshot(snapshot, now = Date.now()) {
    if (!Array.isArray(snapshot) || snapshot.length !== 2) return;
    this.players = snapshot.map((p) => ({
      guardUntil: now + Math.max(0, Number(p.guardRemaining) || 0),
      counterUntil: now + Math.max(0, Number(p.counterRemaining) || 0),
    }));
  }
  reset() { this.players = [this._empty(), this._empty()]; }
}

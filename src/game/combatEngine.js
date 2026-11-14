/**
 * Phase 6A: deterministic combat rules. Reuses the existing PlayerState instances;
 * this module owns no rendering or DOM concerns.
 */
export class CombatEngine {
  constructor({ players, onEvent = () => {} } = {}) {
    if (!Array.isArray(players) || players.length !== 2) throw new Error("CombatEngine needs two PlayerState instances");
    this.players = players;
    this.onEvent = onEvent;
    this.events = [];
  }
  _emit(type, detail = {}) {
    const event = { type, ...detail };
    this.events.push(event);
    this.onEvent(event);
    return event;
  }
  damagePlayer(index, amount, source = null) {
    const player = this.players[index];
    if (!player || !Number.isFinite(amount) || amount < 0) return this._emit("damage-ignored", { index, reason: "invalid-damage" });
    if (player.isDead) return this._emit("damage-ignored", { index, reason: "defeated" });
    const applied = player.takeDamage(amount);
    const event = this._emit("damage", { index, amount: applied, hp: player.hp, source });
    if (player.isDead) this._emit("defeated", { index, winner: 1 - index });
    return event;
  }
  healPlayer(index, amount) {
    const player = this.players[index];
    if (!player || !Number.isFinite(amount) || amount < 0 || player.isDead) return 0;
    const before = player.hp;
    player.hp = Math.min(player.maxHp, player.hp + amount);
    this._emit("heal", { index, amount: player.hp - before, hp: player.hp });
    return player.hp - before;
  }
  isAlive(index) { return !!this.players[index] && !this.players[index].isDead; }
  getState() {
    return this.players.map((p, index) => ({ index, hp: p.hp, maxHp: p.maxHp, alive: !p.isDead }));
  }
  reset() {
    this.players.forEach((p) => p.reset());
    this.events = [];
    return this._emit("reset");
  }
}

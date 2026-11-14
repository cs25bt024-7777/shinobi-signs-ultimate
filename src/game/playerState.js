// Pure game-state for one player. No drawing, no DOM, no networking –
// so the same class can later be driven by local input or by network messages.

export class PlayerState {
  constructor(maxHp) {
    this.maxHp = maxHp;
    this.hp = maxHp;
  }

  get isDead() {
    return this.hp <= 0;
  }

  /** Reduce HP (never below 0). Returns the damage actually applied. */
  takeDamage(amount) {
    const before = this.hp;
    this.hp = Math.max(0, this.hp - amount);
    return before - this.hp;
  }

  reset() {
    this.hp = this.maxHp;
  }
}

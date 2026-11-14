/**
 * Phase 7: routes stable hand-sign events into attacks or defensive stances.
 * Patterns use only the four signs supported by the Phase 4 classifier.
 */
import { JUTSUS } from './jutsuSystem.js';

export const COMBAT_ACTIONS = Object.freeze([
  ...JUTSUS.map((jutsu) => ({
    id: jutsu.id,
    kind: 'attack',
    name: jutsu.name,
    sequence: [...jutsu.sequence],
    damage: jutsu.damage,
    effectType: jutsu.effectType,
    duration: jutsu.duration,
  })),
  {
    id: 'guard', kind: 'defense', defenseType: 'guard', name: 'GUARD STANCE',
    sequence: ['RAM', 'TIGER'], durationMs: 1500,
  },
  {
    id: 'counter', kind: 'defense', defenseType: 'counter', name: 'COUNTER STANCE',
    sequence: ['TIGER', 'SNAKE', 'RAM'], durationMs: 1800,
  },
]);

const normalize = (value) => typeof value === 'string' ? value.trim().toUpperCase() : '';
const same = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);
const startsWith = (value, prefix) => prefix.length <= value.length && prefix.every((v, i) => value[i] === v);

export class CombatActionRouter {
  constructor({ actions = COMBAT_ACTIONS, timeoutMs = 3600, onEvent = () => {} } = {}) {
    if (!Array.isArray(actions) || !actions.length) throw new Error('At least one combat action is required');
    this.actions = actions.map((a) => ({ ...a, sequence: a.sequence.map(normalize) }));
    this.timeoutMs = timeoutMs;
    this.onEvent = onEvent;
    this.buffer = [];
    this.startedAt = null;
    this.lastTimestamp = null;
    this.lastAction = null;
  }

  _emit(type, detail = {}) {
    const event = { type, ...detail, buffer: [...this.buffer] };
    this.onEvent(event);
    return event;
  }

  handleSignEvent(event) {
    const sign = normalize(event?.sign);
    if (!['SNAKE', 'TIGER', 'HORSE', 'RAM'].includes(sign)) {
      if (this.buffer.length) this.reset('unsupported-sign');
      return { type: 'ignored', reason: 'unsupported-sign' };
    }
    const rawTime = Number.isFinite(event?.timestamp) ? event.timestamp : Date.now();
    const timestamp = this.lastTimestamp === null ? rawTime : Math.max(this.lastTimestamp, rawTime);
    if (this.startedAt !== null && timestamp - this.lastTimestamp > this.timeoutMs) this.reset('timeout');
    this.lastTimestamp = timestamp;
    if (this.startedAt === null) this.startedAt = timestamp;
    this.buffer.push(sign);

    const exact = this.actions.find((action) => same(action.sequence, this.buffer));
    if (exact) {
      this.lastAction = exact;
      const completed = { ...exact, sequence: [...exact.sequence] };
      this.buffer = [];
      this.startedAt = null;
      this._emit('complete', { action: completed, timestamp });
      return { type: 'complete', action: completed, timestamp };
    }

    const candidates = this.actions.filter((action) => startsWith(action.sequence, this.buffer));
    if (candidates.length) {
      const eventOut = this._emit('progress', {
        timestamp,
        candidates: candidates.map((a) => a.id),
        expected: [...new Set(candidates.map((a) => a.sequence[this.buffer.length]).filter(Boolean))],
      });
      return eventOut;
    }

    // Recover gracefully: retain the longest suffix that could begin a known action.
    let suffix = [];
    for (let i = 1; i < this.buffer.length; i++) {
      const candidate = this.buffer.slice(i);
      if (this.actions.some((action) => startsWith(action.sequence, candidate))) suffix = candidate;
    }
    this.buffer = suffix;
    this.startedAt = suffix.length ? timestamp : null;
    const out = this._emit('invalid', { timestamp, received: sign });
    return out;
  }

  tick(timestamp = Date.now()) {
    if (this.startedAt === null || timestamp - this.startedAt < this.timeoutMs) return { type: 'ignored' };
    return this.reset('timeout');
  }

  reset(reason = 'manual') {
    this.buffer = [];
    this.startedAt = null;
    this.lastTimestamp = null;
    return this._emit('reset', { reason });
  }

  getState() {
    return {
      buffer: [...this.buffer],
      startedAt: this.startedAt,
      lastAction: this.lastAction ? { ...this.lastAction, sequence: [...this.lastAction.sequence] } : null,
      candidates: this.actions.filter((a) => startsWith(a.sequence, this.buffer)).map((a) => a.id),
    };
  }
}

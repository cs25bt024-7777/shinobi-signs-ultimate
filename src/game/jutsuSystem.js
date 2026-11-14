/** Phase 6B: original attacks built only from Phase 5's supported signs. */
export const JUTSUS = Object.freeze([
  { id: "fire-burst", name: "ECHO CLONE TECHNIQUE", sequence: ["SNAKE","TIGER","HORSE","RAM"], damage: 25, effectType: "clone", duration: 0.95, description: "Afterimage clones rush the opponent in a synchronized strike." },
  { id: "lightning-arc", name: "SPIRAL ENERGY ORB", sequence: ["TIGER","RAM","SNAKE"], damage: 30, effectType: "orb", duration: 0.85, description: "A spinning energy sphere surges into the rival." },
  { id: "wind-blade", name: "ANCIENT TOAD GUARDIAN", sequence: ["HORSE","SNAKE","TIGER"], damage: 34, effectType: "summon", duration: 1.2, description: "A colossal original guardian erupts into the arena and strikes." },
]);
const key = (sequence) => Array.isArray(sequence) ? sequence.map(s => String(s).toUpperCase()).join(">") : "";
export function findJutsu(sequence) { return JUTSUS.find(j => key(j.sequence) === key(sequence)) || null; }
export function createJutsuSystem({ combat, effects, characters, onStatus = () => {} } = {}) {
  const consumed = new Set();
  let serial = 0;
  function execute(event, attacker = 0) {
    if (!event || event.type !== "JUTSU_READY") return { type: "ignored", reason: "not-ready" };
    const jutsu = findJutsu(event.sequence);
    if (!jutsu) { onStatus("UNKNOWN SEQUENCE"); return { type: "ignored", reason: "unknown-sequence" }; }
    const token = event.eventId ?? `${event.timestamp ?? "na"}:${key(event.sequence)}`;
    if (consumed.has(token)) return { type: "ignored", reason: "duplicate" };
    consumed.add(token);
    if (!combat.isAlive(attacker) || !combat.isAlive(1-attacker)) return { type: "ignored", reason: "match-over" };
    const id = ++serial;
    characters[attacker]?.attack(characters[1 - attacker]?.x);
    effects?.launch({ id, type: jutsu.effectType, from: characters[attacker].x, to: characters[1-attacker].x, y: characters[attacker].feetY - 145, duration: jutsu.duration, attacker, target: 1 - attacker, damage: jutsu.damage });
    onStatus(`${jutsu.name}!`);
    return { type: "executed", id, jutsu, attacker, target: 1-attacker };
  }
  return { execute, reset() { consumed.clear(); serial = 0; } };
}

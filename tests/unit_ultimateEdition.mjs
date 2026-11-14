import assert from 'node:assert/strict';
import { Character } from '../src/render/character.js';
import { Effects } from '../src/render/effects.js';

const fighter = new Character({
  x: 300, feetY: 620, facing: 1, label: 'P1', scale: 1,
  palette: { suit: '#111', suitLight: '#222', accent: '#5df', skin: '#fff' },
});
fighter.attack(900);
fighter.update(.45);
assert.ok(fighter.x > 300, 'fighter should dash forward during an attack');
fighter.update(.9);
assert.equal(fighter.x, fighter.homeX, 'fighter should recover to its home position');

const effects = new Effects();
let hit = null;
effects.launch({ id: 'ultimate-test', type: 'ultimate-blue', from: 300, to: 900, y: 400, duration: 1, attacker: 0, target: 1, damage: 48 });
effects.update(.84, (event) => { hit = event; });
assert.equal(hit?.type, 'ultimate-blue', 'ultimate should resolve an impact event');
assert.equal(hit?.damage, 48, 'ultimate should carry its configured damage');
assert.equal(hit?.target, 1, 'ultimate should target the opposing fighter');
console.log('Ultimate Edition animation/effect tests: 6/6 passed');

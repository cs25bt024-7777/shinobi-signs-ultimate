import assert from "node:assert/strict";
import { buildSequenceHudState } from "../src/ui/sequenceHudState.js";

let checks = 0;
const check = (x, m) => { checks++; assert.ok(x, m); };

const state = {
  requiredSequence: ["SNAKE", "TIGER", "HORSE", "RAM"],
  enteredSigns: ["SNAKE", "TIGER"],
  expectedSign: "HORSE",
  isComplete: false,
  isFailed: false,
  failure: null,
  progress: { text: "2 / 4" }
};

const hud = buildSequenceHudState(state);
check(hud.status === "ACTIVE", "active status");
check(hud.progressText === "2 / 4", "progress");
check(hud.signs[0].state === "completed", "first completed");
check(hud.signs[1].state === "completed", "second completed");
check(hud.signs[2].state === "current", "expected is current");
check(hud.signs[3].state === "pending", "last pending");

const complete = buildSequenceHudState({
  ...state,
  enteredSigns: ["SNAKE", "TIGER", "HORSE", "RAM"],
  expectedSign: null,
  isComplete: true,
  progress: { text: "4 / 4" }
});
check(complete.status === "COMPLETE", "complete status");
check(complete.message === "JUTSU COMPLETE", "complete message");

const failed = buildSequenceHudState({
  ...state,
  isFailed: true,
  failure: { reason: "wrong-sign", expected: "HORSE", received: "RAM" }
});
check(failed.status === "FAILED", "failed status");
check(failed.message.includes("HORSE"), "failure expected shown");

console.log(`Phase 5B HUD adapter tests: ${checks}/${checks} passed`);

import assert from "node:assert/strict";
import { createSequenceRecognizer, signEventFromPipelineState } from "../src/game/sequenceRecognizer.js";

let checks = 0;
function check(condition, message) {
  checks += 1;
  assert.ok(condition, message);
}
function equal(actual, expected, message) {
  checks += 1;
  assert.deepEqual(actual, expected, message);
}

const sequence = ["SNAKE", "TIGER", "HORSE", "RAM"];
let rec = createSequenceRecognizer({ sequenceTimeoutMs: 5000, now: () => 0 });
rec.setSequence(sequence);

equal(rec.getState().progress.text, "0 / 4", "initial progress");
equal(rec.getState().expectedSign, "SNAKE", "initial expected sign");

let events = [];
rec.subscribe((event) => events.push(event));

rec.handleSignEvent({ sign: "SNAKE", confidence: 0.9, timestamp: 100 });
rec.handleSignEvent({ sign: "TIGER", confidence: 0.9, timestamp: 200 });
rec.handleSignEvent({ sign: "HORSE", confidence: 0.9, timestamp: 300 });
rec.handleSignEvent({ sign: "RAM", confidence: 0.9, timestamp: 400 });

equal(rec.getState().enteredSigns, sequence, "correct sequence");
check(rec.getState().isComplete, "sequence completes");
check(events.filter((e) => e.type === "complete").length === 1, "completion emitted once");
check(rec.handleSignEvent({ sign: "RAM", timestamp: 500 }).reason === "terminal-state", "terminal state ignores later sign");

rec.reset();
equal(rec.getState().progress.text, "0 / 4", "reset progress");
check(!rec.getState().isComplete && !rec.getState().isFailed, "reset clears terminal state");

rec.handleSignEvent({ sign: "SNAKE", timestamp: 1000 });
const wrong = rec.handleSignEvent({ sign: "RAM", timestamp: 1100 });
check(wrong.type === "fail" && wrong.reason === "wrong-sign", "wrong sign fails");
check(rec.getState().failure.expected === "TIGER", "failure expected sign");
check(rec.handleSignEvent({ sign: "TIGER", timestamp: 1200 }).reason === "terminal-state", "failed sequence stays terminal");

rec.reset();
const ignoredUnknown = rec.handleSignEvent({ sign: "UNKNOWN", timestamp: 2000 });
check(ignoredUnknown.type === "ignored", "unknown ignored");
equal(rec.getState().progress.text, "0 / 4", "unknown does not advance");

rec.reset();
rec.handleSignEvent({ sign: "SNAKE", timestamp: 3000 });
const timeout = rec.tick(8001);
check(timeout.type === "fail" && timeout.reason === "timeout", "timeout fires");
check(rec.getState().isFailed, "timeout marks failure");

rec.reset();
rec.setSequence(["TIGER"]);
const single = rec.handleSignEvent({ sign: "tiger", timestamp: 9000 });
check(single.type === "complete", "single sign completes");
equal(rec.getState().enteredSigns, ["TIGER"], "normalizes case");

const invalidInputs = [[], ["SNAKE", ""], ["SNAKE", null]];
for (const input of invalidInputs) {
  checks += 1;
  assert.throws(() => rec.setSequence(input), "invalid sequence rejected");
}

rec.reset();
rec.setSequence(["SNAKE", "SNAKE"]);
rec.handleSignEvent({ sign: "SNAKE", timestamp: 10000 });
equal(rec.getState().progress.current, 1, "first repeated sign advances once");
rec.handleSignEvent({ sign: "SNAKE", timestamp: 10100 });
equal(rec.getState().progress.current, 2, "second event advances second repeated sign");

const converted = signEventFromPipelineState({
  sign: " horse ",
  confidence: 0.88,
  timestamp: 1234,
});
equal(converted.sign, "HORSE", "pipeline event normalization");
equal(converted.confidence, 0.88, "pipeline confidence retained");

console.log(`Phase 5A sequence tests: ${checks}/${checks} passed`);

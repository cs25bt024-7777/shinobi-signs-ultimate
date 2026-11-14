import assert from "node:assert/strict";
import { createJutsuBridge } from "../src/game/jutsuBridge.js";

let checks = 0;
const check = (x, m) => { checks++; assert.ok(x, m); };
const equal = (a, b, m) => { checks++; assert.deepEqual(a, b, m); };

const received = [];
const bridge = createJutsuBridge({ onJutsuReady: (e) => received.push(e) });

const unsub = bridge.subscribe((e) => received.push({ ...e, via: "subscription" }));

let result = bridge.handleSequenceEvent({
  type: "progress",
  state: { isComplete: false }
});
check(result.type === "ignored", "non-complete events ignored");

result = bridge.handleSequenceEvent({
  type: "complete",
  timestamp: 1234,
  state: {
    isComplete: true,
    requiredSequence: ["SNAKE", "TIGER", "HORSE", "RAM"]
  }
});

check(result.type === "JUTSU_READY", "completion becomes JUTSU_READY");
equal(result.sequence, ["SNAKE", "TIGER", "HORSE", "RAM"], "sequence forwarded");
equal(result.timestamp, 1234, "timestamp forwarded");
check(received.length === 2, "both subscribers receive event");

unsub();
bridge.handleSequenceEvent({
  type: "complete",
  state: { isComplete: true, requiredSequence: ["SNAKE"] }
});
check(received.length === 3, "unsubscribe works");

console.log(`Phase 5C bridge tests: ${checks}/${checks} passed`);

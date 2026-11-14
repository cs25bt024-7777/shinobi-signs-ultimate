/**
 * Phase 5C - Jutsu event bridge.
 *
 * Converts a SequenceRecognizer "complete" result into a clean,
 * framework-agnostic JUTSU_READY event. No combat, HP, animation,
 * or networking logic belongs here.
 */

export function createJutsuBridge({ onJutsuReady } = {}) {
  const listeners = new Set();
  let eventCounter = 0;
  const handledCompletions = new WeakSet();
  if (typeof onJutsuReady === "function") listeners.add(onJutsuReady);

  function subscribe(listener) {
    if (typeof listener !== "function") {
      throw new TypeError("listener must be a function");
    }
    listeners.add(listener);
    return () => listeners.delete(listener);
  }

  function emit(event) {
    listeners.forEach((listener) => {
      try { listener(event); } catch { /* listener isolation */ }
    });
    return event;
  }

  function handleSequenceEvent(event) {
    if (!event || event.type !== "complete" || !event.state?.isComplete) {
      return { type: "ignored", reason: "not-complete" };
    }

    if (handledCompletions.has(event)) return { type: "ignored", reason: "duplicate-completion" };
    handledCompletions.add(event);
    const sequence = [...(event.state.requiredSequence ?? [])];
    const payload = {
      type: "JUTSU_READY",
      eventId: ++eventCounter,
      sequence,
      timestamp: event.timestamp ?? null,
    };

    return emit(payload);
  }

  return { subscribe, handleSequenceEvent };
}

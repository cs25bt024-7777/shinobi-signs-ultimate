/**
 * Phase 5A - Sequence recognition core.
 * Independent of DOM, canvas, webcam and MediaPipe.
 */

const TERMINAL_STATES = new Set(["complete", "failed"]);

function normalizeSign(value) {
  if (typeof value !== "string") return "";
  return value.trim().toUpperCase();
}

function normalizeSequence(sequence) {
  if (!Array.isArray(sequence) || sequence.length === 0) {
    throw new Error("Sequence must be a non-empty array");
  }

  const normalized = sequence.map(normalizeSign);
  if (normalized.some((sign) => !sign)) {
    throw new Error("Sequence contains an invalid sign");
  }

  return normalized;
}

function createInitialState(sequence) {
  const total = sequence.length;
  return {
    requiredSequence: [...sequence],
    currentIndex: 0,
    enteredSigns: [],
    progress: {
      current: 0,
      total,
      fraction: 0,
      text: `0 / ${total}`,
    },
    expectedSign: sequence[0] ?? null,
    isComplete: false,
    isFailed: false,
    failure: null,
  };
}

function cloneState(state) {
  return {
    ...state,
    requiredSequence: [...state.requiredSequence],
    enteredSigns: [...state.enteredSigns],
    progress: { ...state.progress },
    failure: state.failure ? { ...state.failure } : null,
  };
}

export function signEventFromPipelineState(state) {
  if (!state || typeof state !== "object") return null;

  const sign = normalizeSign(state.sign ?? state.currentSign);
  if (!sign || sign === "UNKNOWN") return null;

  return {
    sign,
    confidence: state.confidence,
    timestamp: state.timestamp,
  };
}

export function createSequenceRecognizer(options = {}) {
  const {
    sequenceTimeoutMs = 5000,
    now = () => (typeof performance !== "undefined" ? performance.now() : Date.now()),
  } = options;

  if (!Number.isFinite(sequenceTimeoutMs) || sequenceTimeoutMs <= 0) {
    throw new Error("sequenceTimeoutMs must be a positive finite number");
  }

  let sequence = [];
  let state = createInitialState(sequence);
  let startedAt = null;
  let lastTimestamp = null;
  const subscribers = new Set();

  function emit(event) {
    const payload = { ...event, state: cloneState(state) };
    subscribers.forEach((listener) => {
      try {
        listener(payload);
      } catch {
        // Subscribers must not break recognition.
      }
    });
    return payload;
  }

  function reset() {
    state = createInitialState(sequence);
    startedAt = null;
    lastTimestamp = null;
    return emit({ type: "reset" });
  }

  function setSequence(nextSequence) {
    const normalized = normalizeSequence(nextSequence);
    sequence = normalized;
    state = createInitialState(sequence);
    startedAt = null;
    lastTimestamp = null;
    return emit({ type: "sequence-set" });
  }

  function getState() {
    return cloneState(state);
  }

  function handleSignEvent(event) {
    if (!event || typeof event !== "object") {
      return { type: "ignored", reason: "invalid-event" };
    }

    const sign = normalizeSign(event.sign);
    if (!sign || sign === "UNKNOWN") {
      return { type: "ignored", reason: "unknown-sign" };
    }

    if (TERMINAL_STATES.has(state.isComplete ? "complete" : state.isFailed ? "failed" : "")) {
      return { type: "ignored", reason: "terminal-state" };
    }

    if (!sequence.length) {
      return { type: "ignored", reason: "no-sequence" };
    }

    const rawTimestamp = Number.isFinite(event.timestamp) ? event.timestamp : now();
    const timestamp =
      lastTimestamp === null ? rawTimestamp : Math.max(lastTimestamp, rawTimestamp);
    lastTimestamp = timestamp;

    if (startedAt !== null && timestamp - startedAt >= sequenceTimeoutMs) {
      state.isFailed = true;
      state.failure = {
        reason: "timeout",
        expected: state.expectedSign,
        received: sign,
        index: state.currentIndex,
        elapsedMs: timestamp - startedAt,
      };
      return emit({
        type: "fail",
        reason: "timeout",
        expected: state.expectedSign,
        received: sign,
      });
    }

    const expected = state.requiredSequence[state.currentIndex];

    if (sign !== expected) {
      state.isFailed = true;
      state.failure = {
        reason: "wrong-sign",
        expected,
        received: sign,
        index: state.currentIndex,
        elapsedMs: startedAt === null ? 0 : timestamp - startedAt,
      };
      return emit({
        type: "fail",
        reason: "wrong-sign",
        expected,
        received: sign,
      });
    }

    if (startedAt === null) startedAt = timestamp;

    state.enteredSigns.push(sign);
    state.currentIndex += 1;

    const total = state.requiredSequence.length;
    state.progress = {
      current: state.currentIndex,
      total,
      fraction: state.currentIndex / total,
      text: `${state.currentIndex} / ${total}`,
    };
    state.expectedSign = state.requiredSequence[state.currentIndex] ?? null;

    if (state.currentIndex >= total) {
      state.isComplete = true;
      return emit({ type: "complete" });
    }

    return emit({
      type: "progress",
      sign,
      confidence: event.confidence,
    });
  }

  function tick(timestamp = now()) {
    if (state.isComplete || state.isFailed || startedAt === null) {
      return { type: "ignored", reason: "inactive" };
    }

    const numericTimestamp = Number.isFinite(timestamp) ? timestamp : now();
    const safeTimestamp =
      lastTimestamp === null ? numericTimestamp : Math.max(lastTimestamp, numericTimestamp);
    lastTimestamp = safeTimestamp;

    const elapsedMs = safeTimestamp - startedAt;
    if (elapsedMs < sequenceTimeoutMs) {
      return { type: "ignored", reason: "not-timed-out" };
    }

    state.isFailed = true;
    state.failure = {
      reason: "timeout",
      expected: state.expectedSign,
      received: null,
      index: state.currentIndex,
      elapsedMs,
    };

    return emit({
      type: "fail",
      reason: "timeout",
      expected: state.expectedSign,
      received: null,
    });
  }

  function subscribe(listener) {
    if (typeof listener !== "function") {
      throw new TypeError("listener must be a function");
    }
    subscribers.add(listener);
    return () => subscribers.delete(listener);
  }

  return {
    setSequence,
    reset,
    handleSignEvent,
    tick,
    subscribe,
    getState,
  };
}

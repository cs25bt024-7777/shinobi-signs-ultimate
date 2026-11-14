/**
 * Phase 5B - Sequence HUD view model.
 * Produces display data without owning DOM/game logic.
 */

export function buildSequenceHudState(sequenceState) {
  if (!sequenceState) {
    return {
      status: "READY",
      progressText: "0 / 0",
      signs: [],
      expectedSign: null,
      message: "Perform the required signs",
    };
  }

  const {
    requiredSequence = [],
    enteredSigns = [],
    expectedSign = null,
    isComplete = false,
    isFailed = false,
    failure = null,
    progress = {},
  } = sequenceState;

  let status = "ACTIVE";
  let message = "Perform the required signs";

  if (isComplete) {
    status = "COMPLETE";
    message = "JUTSU COMPLETE";
  } else if (isFailed) {
    status = "FAILED";
    if (failure?.reason === "timeout") {
      message = "SEQUENCE FAILED — TIMEOUT";
    } else if (failure?.expected || failure?.received) {
      message = `SEQUENCE FAILED — Expected: ${failure.expected ?? "?"}, Received: ${failure.received ?? "?"}`;
    } else {
      message = "SEQUENCE FAILED";
    }
  }

  return {
    status,
    progressText: progress.text ?? `${enteredSigns.length} / ${requiredSequence.length}`,
    signs: requiredSequence.map((sign, index) => ({
      sign,
      state:
        index < enteredSigns.length
          ? "completed"
          : index === enteredSigns.length && !isComplete && !isFailed
            ? "current"
            : "pending",
    })),
    expectedSign,
    message,
  };
}

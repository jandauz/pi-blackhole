/**
 * Cross-generation turn cap for the OM agent loops.
 *
 * Pi <= 0.86 caps a run with `shouldStopAfterTurn`, a boolean predicate called
 * after each completed turn; returning truthy ends the run. Pi 0.87 removed that
 * option in favour of `finishTurn`, which ends the run by returning
 * `{ action: "end" }`. A host ignores the option it does not know, so the cap
 * emits both and lets the loaded Pi generation pick its own: emitting only
 * `shouldStopAfterTurn` silently dropped the `agentMaxTurns` budget on 0.87,
 * where workers ran until they stopped naturally, errored, or were aborted.
 *
 * Each hook counts separately, so a host that calls both still ends the run after
 * `maxTurns` turns instead of half of them. A turn that already hard-exited
 * (`error` or `aborted`) is never a decision and never spends budget: the loop
 * aborts those runs itself, and the cap only governs completed turns.
 *
 * See https://github.com/elpapi42/pi-observational-memory/pull/83.
 */
import type { AgentTurnDecision } from "@earendil-works/pi-agent-core";

/** Completed-turn payload shared by Pi 0.86 `ShouldStopAfterTurnContext` and 0.87 `AgentTurnContext`. */
export interface TurnCapContext {
  message?: { stopReason?: string };
}

/** Pi <= 0.86 turn hook. Absent from the 0.87 `AgentLoopConfig` type, like the loop's `fetch` option. */
export type LegacyTurnCapOption = {
  shouldStopAfterTurn?: (context: TurnCapContext) => boolean;
};

export interface TurnCap {
  /** Pi <= 0.86 hook: truthy ends the run. */
  shouldStopAfterTurn: (context: TurnCapContext) => boolean;
  /** Pi 0.87 hook: `{ action: "end" }` ends the run, `undefined` keeps normal scheduling. */
  finishTurn: (context: TurnCapContext) => AgentTurnDecision | undefined;
}

/** Turn cap a loop spreads into its `AgentLoopConfig` when `maxTurns` is configured. */
export function createTurnCap(maxTurns: number): TurnCap {
  let legacyTurns = 0;
  let finishTurns = 0;

  const hardExited = (context: TurnCapContext): boolean => {
    const stopReason = context.message?.stopReason;
    return stopReason === "error" || stopReason === "aborted";
  };

  return {
    shouldStopAfterTurn: (context) => {
      if (hardExited(context)) return false;
      legacyTurns++;
      return legacyTurns >= maxTurns;
    },
    finishTurn: (context) => {
      if (hardExited(context)) return undefined;
      finishTurns++;
      return finishTurns >= maxTurns ? { action: "end" } : undefined;
    },
  };
}

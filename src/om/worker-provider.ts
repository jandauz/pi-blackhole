import { randomUUID } from "node:crypto";

/**
 * Provider-neutral metadata contract for isolated background agent runs.
 *
 * Providers that do not understand these fields ignore them. Compatible
 * providers use the run id to keep every request and tool continuation in one
 * run-owned conversation without borrowing the foreground session.
 */
export const WORKER_METADATA = {
  protocol: "pi.worker.protocol",
  runId: "pi.worker.runId",
  kind: "pi.worker.kind",
  stage: "pi.worker.stage",
  parentSessionId: "pi.worker.parentSessionId",
  parentBranchId: "pi.worker.parentBranchId",
  idleTimeoutMs: "pi.worker.idleTimeoutMs",
} as const;

export const WORKER_PROTOCOL_VERSION = "1";
export const BLACKHOLE_WORKER_KIND = "pi-blackhole-memory";
export const CLAUDE_BRIDGE_PROVIDER = "claude-bridge";
export const WORKER_LIFECYCLE_SYMBOL = Symbol.for("pi-provider-worker-lifecycle-v1");

export type BlackholeWorkerStage = "observer" | "reflector" | "dropper";

export interface WorkerLineage {
  parentSessionId?: string;
  parentBranchId?: string;
}

interface WorkerLifecycleController {
  finishRun?: (runId: string, reason?: string) => void;
}

export interface WorkerProviderRun {
  readonly runId: string;
  readonly streamFn: (model: any, context: any, options?: any) => any;
  finish(reason?: string): void;
}

/**
 * Wrap one agent-loop stream boundary with a stable, unique run identity.
 * The same wrapper is reused for every provider call made by that loop, so
 * tool-result continuations carry exactly the same identity as the first call.
 */
export function createWorkerProviderRun(
  stage: BlackholeWorkerStage,
  baseStreamFn: (model: any, context: any, options?: any) => any,
  lineage: WorkerLineage = {},
  runId: string = randomUUID(),
  idleTimeoutMs?: number,
): WorkerProviderRun {
  let finished = false;
  const workerMetadata: Record<string, unknown> = {
    [WORKER_METADATA.protocol]: WORKER_PROTOCOL_VERSION,
    [WORKER_METADATA.runId]: runId,
    [WORKER_METADATA.kind]: BLACKHOLE_WORKER_KIND,
    [WORKER_METADATA.stage]: stage,
    ...(lineage.parentSessionId
      ? { [WORKER_METADATA.parentSessionId]: lineage.parentSessionId }
      : {}),
    ...(lineage.parentBranchId ? { [WORKER_METADATA.parentBranchId]: lineage.parentBranchId } : {}),
    ...(typeof idleTimeoutMs === "number" && Number.isInteger(idleTimeoutMs) && idleTimeoutMs >= 0
      ? { [WORKER_METADATA.idleTimeoutMs]: idleTimeoutMs }
      : {}),
  };

  return {
    runId,
    streamFn(model, context, options = {}) {
      // Keep every other provider's option surface byte-for-byte compatible.
      // This contract is deliberately narrow rather than a new general-purpose
      // background-provider API.
      if (model?.provider !== CLAUDE_BRIDGE_PROVIDER) {
        return baseStreamFn(model, context, options);
      }
      return baseStreamFn(model, context, {
        ...options,
        // A UUID is accepted by providers that use sessionId for cache/session
        // affinity. Compatible bridges additionally require the metadata marker
        // below before treating it as an isolated worker identity.
        sessionId: runId,
        metadata: {
          ...options?.metadata,
          ...workerMetadata,
        },
      });
    },
    finish(reason = "completed") {
      if (finished) return;
      finished = true;
      const controller = (globalThis as Record<symbol, unknown>)[WORKER_LIFECYCLE_SYMBOL] as
        | WorkerLifecycleController
        | undefined;
      controller?.finishRun?.(runId, reason);
    },
  };
}

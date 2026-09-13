import { afterEach, describe, expect, it, vi } from "vitest";

import {
  BLACKHOLE_WORKER_KIND,
  WORKER_LIFECYCLE_SYMBOL,
  WORKER_METADATA,
  WORKER_PROTOCOL_VERSION,
  createWorkerProviderRun,
} from "../src/om/worker-provider.js";

const RUN_ID = "123e4567-e89b-42d3-a456-426614174000";

describe("background worker provider contract", () => {
  afterEach(() => {
    delete (globalThis as Record<symbol, unknown>)[WORKER_LIFECYCLE_SYMBOL];
  });

  it("keeps one identity across every provider call in a run", () => {
    const calls: any[] = [];
    const base = vi.fn((_model, _context, options) => {
      calls.push(options);
      return "stream";
    });
    const run = createWorkerProviderRun(
      "observer",
      base,
      { parentSessionId: "session-a", parentBranchId: "entry-z" },
      RUN_ID,
      120_000,
    );

    const model = { provider: "claude-bridge" };
    expect(run.streamFn(model, "first", { metadata: { existing: "kept" } })).toBe("stream");
    expect(run.streamFn(model, "continuation", {})).toBe("stream");

    expect(calls).toHaveLength(2);
    for (const options of calls) {
      expect(options.sessionId).toBe(RUN_ID);
      expect(options.metadata).toMatchObject({
        [WORKER_METADATA.protocol]: WORKER_PROTOCOL_VERSION,
        [WORKER_METADATA.runId]: RUN_ID,
        [WORKER_METADATA.kind]: BLACKHOLE_WORKER_KIND,
        [WORKER_METADATA.stage]: "observer",
        [WORKER_METADATA.parentSessionId]: "session-a",
        [WORKER_METADATA.parentBranchId]: "entry-z",
        [WORKER_METADATA.idleTimeoutMs]: 120_000,
      });
    }
    expect(calls[0].metadata.existing).toBe("kept");
  });

  it("leaves non-bridge provider options unchanged", () => {
    const options = { sessionId: "native-session", metadata: { existing: "kept" } };
    const base = vi.fn(() => "native-stream");
    const run = createWorkerProviderRun("observer", base, {}, RUN_ID);

    expect(run.streamFn({ provider: "openai" }, "context", options)).toBe("native-stream");
    expect(base).toHaveBeenCalledWith({ provider: "openai" }, "context", options);
  });

  it("assigns different identities to independent runs", () => {
    const first = createWorkerProviderRun("observer", vi.fn());
    const second = createWorkerProviderRun("observer", vi.fn());

    expect(first.runId).not.toBe(second.runId);
  });

  it("notifies a compatible provider exactly once when the logical run ends", () => {
    const finishRun = vi.fn();
    (globalThis as Record<symbol, unknown>)[WORKER_LIFECYCLE_SYMBOL] = { finishRun };
    const run = createWorkerProviderRun("reflector", vi.fn(), {}, RUN_ID);

    run.finish("completed");
    run.finish("duplicate");

    expect(finishRun).toHaveBeenCalledOnce();
    expect(finishRun).toHaveBeenCalledWith(RUN_ID, "completed");
  });
});

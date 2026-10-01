import { Worker } from "node:worker_threads";
import type { Replay, RunState } from "../src/core/types";
import { ApiError } from "./errors";
interface Job {
  id: number;
  replay: Replay;
  resolve: (state: RunState) => void;
  reject: (reason: Error) => void;
}
interface Slot {
  worker: Worker;
  job?: Job;
  timer?: ReturnType<typeof setTimeout>;
}
/** A bounded queue keeps hostile or expensive packages off the HTTP event loop. */
export class VerificationPool {
  private slots: Slot[] = [];
  private queue: Job[] = [];
  private sequence = 0;
  private closed = false;
  constructor(
    private size = 2,
    private timeout = 5000,
  ) {}
  verify(replay: Replay): Promise<RunState> {
    if (this.closed || this.queue.length >= 32)
      return Promise.reject(
        new ApiError(
          503,
          "verification_busy",
          "Verification is busy. Your recording can be retried.",
        ),
      );
    return new Promise((resolve, reject) => {
      this.queue.push({ id: ++this.sequence, replay, resolve, reject });
      this.pump();
    });
  }
  private create(): Slot {
    const slot: Slot = {
      worker: new Worker(
        new URL("./verification-worker.mjs", import.meta.url),
        {
          execArgv: [],
          resourceLimits: {
            maxOldGenerationSizeMb: 128,
            maxYoungGenerationSizeMb: 32,
          },
        },
      ),
    };
    slot.worker.on(
      "message",
      (result: { id: number; state?: RunState; error?: string }) => {
        const job = slot.job;
        if (!job || job.id !== result.id) return;
        clearTimeout(slot.timer);
        slot.job = undefined;
        if (result.error || !result.state)
          job.reject(
            new ApiError(
              400,
              "invalid_recording",
              result.error ?? "Invalid recording.",
            ),
          );
        else job.resolve(result.state);
        this.pump();
      },
    );
    slot.worker.on("error", () =>
      this.fail(
        slot,
        new ApiError(
          503,
          "verification_unavailable",
          "Verification could not finish. Retry this recording.",
        ),
      ),
    );
    slot.worker.on("exit", (code) => {
      if (code !== 0 && slot.job)
        this.fail(
          slot,
          new ApiError(
            503,
            "verification_unavailable",
            "Verification was interrupted. Retry this recording.",
          ),
        );
    });
    this.slots.push(slot);
    return slot;
  }
  private fail(slot: Slot, error: ApiError): void {
    clearTimeout(slot.timer);
    slot.job?.reject(error);
    slot.job = undefined;
    this.slots = this.slots.filter((s) => s !== slot);
    void slot.worker.terminate();
    this.pump();
  }
  private pump(): void {
    if (this.closed) return;
    while (this.queue.length) {
      const slot =
        this.slots.find((s) => !s.job) ??
        (this.slots.length < this.size ? this.create() : undefined);
      if (!slot) return;
      slot.job = this.queue.shift()!;
      slot.timer = setTimeout(
        () =>
          this.fail(
            slot,
            new ApiError(
              422,
              "verification_budget",
              "This recording exceeds the simulation work budget. Simplify its logic or retry a shorter run.",
            ),
          ),
        this.timeout,
      );
      slot.worker.postMessage({ id: slot.job.id, replay: slot.job.replay });
    }
  }
  async close(): Promise<void> {
    this.closed = true;
    for (const j of this.queue.splice(0))
      j.reject(
        new ApiError(
          503,
          "server_stopping",
          "Server is stopping. Retry later.",
        ),
      );
    await Promise.all(
      this.slots.map(async (slot) => {
        clearTimeout(slot.timer);
        slot.job?.reject(
          new ApiError(
            503,
            "server_stopping",
            "Server is stopping. Retry later.",
          ),
        );
        slot.job = undefined;
        await slot.worker.terminate();
      }),
    );
    this.slots = [];
  }
}

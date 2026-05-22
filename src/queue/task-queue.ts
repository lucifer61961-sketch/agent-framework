import { EventEmitter } from "events";
import { logger } from "../utils/logger";

export interface Task<T = unknown> {
  id: string;
  sessionId: string;
  payload: T;
  createdAt: number;
  attempts: number;
}

export interface TaskResult<T = unknown> {
  taskId: string;
  success: boolean;
  result?: T;
  error?: string;
  durationMs: number;
}

export type TaskHandler<TPayload, TResult> = (
  task: Task<TPayload>
) => Promise<TResult>;

export interface QueueConfig {
  /** Max concurrent tasks running globally. Default: 4 */
  concurrency?: number;
  /** Max tasks per unique sessionId running at once. Default: 1 */
  perSessionConcurrency?: number;
  /** Max tasks allowed in the pending queue. Default: 100 */
  maxQueueSize?: number;
  /** Max retry attempts on failure. Default: 0 (no retries) */
  maxRetries?: number;
  /** Delay between retries in ms. Default: 2000 */
  retryDelayMs?: number;
}

/**
 * TaskQueue
 *
 * A lightweight in-process queue that:
 *  - Limits global concurrency (avoids hammering the LLM API)
 *  - Limits per-session concurrency (one active agent run per user)
 *  - Retries failed tasks with a delay
 *  - Emits events for monitoring (task:start, task:done, task:error)
 *
 * Usage:
 *   const queue = new TaskQueue({ concurrency: 4, perSessionConcurrency: 1 });
 *   queue.setHandler(async (task) => await agent.run(task.payload.prompt));
 *   const result = await queue.enqueue("telegram:123", { prompt: "hello" });
 */
export class TaskQueue<TPayload = unknown, TResult = unknown> extends EventEmitter {
  private handler?: TaskHandler<TPayload, TResult>;
  private pending: Task<TPayload>[] = [];
  private running = new Map<string, Task<TPayload>>(); // taskId → task
  private sessionRunning = new Map<string, number>();  // sessionId → count

  private concurrency: number;
  private perSessionConcurrency: number;
  private maxQueueSize: number;
  private maxRetries: number;
  private retryDelayMs: number;

  private taskCounter = 0;

  constructor(config: QueueConfig = {}) {
    super();
    this.concurrency = config.concurrency ?? 4;
    this.perSessionConcurrency = config.perSessionConcurrency ?? 1;
    this.maxQueueSize = config.maxQueueSize ?? 100;
    this.maxRetries = config.maxRetries ?? 0;
    this.retryDelayMs = config.retryDelayMs ?? 2000;
  }

  setHandler(handler: TaskHandler<TPayload, TResult>): this {
    this.handler = handler;
    return this;
  }

  /**
   * Add a task to the queue.
   * Returns a Promise that resolves when the task completes.
   * Throws if the queue is full.
   */
  enqueue(sessionId: string, payload: TPayload): Promise<TResult> {
    if (this.pending.length >= this.maxQueueSize) {
      throw new Error(
        `Queue is full (${this.maxQueueSize} pending tasks). Try again later.`
      );
    }

    const taskId = `task_${++this.taskCounter}_${Date.now()}`;
    const task: Task<TPayload> = {
      id: taskId,
      sessionId,
      payload,
      createdAt: Date.now(),
      attempts: 0,
    };

    return new Promise<TResult>((resolve, reject) => {
      // Attach resolve/reject to the task so _execute can call them
      (task as Task<TPayload> & { resolve: (v: TResult) => void; reject: (e: unknown) => void })
        .resolve = resolve;
      (task as Task<TPayload> & { resolve: (v: TResult) => void; reject: (e: unknown) => void })
        .reject = reject;

      this.pending.push(task);
      logger.debug(`[Queue] Enqueued task ${taskId} for session ${sessionId} (queue depth: ${this.pending.length})`);
      this.emit("task:queued", { taskId, sessionId });
      this._drain();
    });
  }

  /** Current queue statistics */
  stats() {
    return {
      pending: this.pending.length,
      running: this.running.size,
      sessions: [...this.sessionRunning.entries()].filter(([, c]) => c > 0).length,
    };
  }

  private _drain() {
    while (this._canDequeue()) {
      const idx = this._findEligible();
      if (idx === -1) break;

      const [task] = this.pending.splice(idx, 1);
      this._execute(task);
    }
  }

  private _canDequeue(): boolean {
    return this.running.size < this.concurrency && this.pending.length > 0;
  }

  private _findEligible(): number {
    for (let i = 0; i < this.pending.length; i++) {
      const task = this.pending[i];
      const sessionCount = this.sessionRunning.get(task.sessionId) ?? 0;
      if (sessionCount < this.perSessionConcurrency) return i;
    }
    return -1;
  }

  private async _execute(task: Task<TPayload>) {
    const t = task as Task<TPayload> & {
      resolve: (v: TResult) => void;
      reject: (e: unknown) => void;
    };

    if (!this.handler) {
      t.reject(new Error("No handler registered on TaskQueue"));
      return;
    }

    this.running.set(task.id, task);
    this.sessionRunning.set(task.sessionId, (this.sessionRunning.get(task.sessionId) ?? 0) + 1);

    const startTime = Date.now();
    task.attempts++;

    logger.info(`[Queue] Starting task ${task.id} (attempt ${task.attempts}, session ${task.sessionId})`);
    this.emit("task:start", { taskId: task.id, sessionId: task.sessionId, attempt: task.attempts });

    try {
      const result = await this.handler(task);
      const durationMs = Date.now() - startTime;

      logger.info(`[Queue] Task ${task.id} completed in ${durationMs}ms`);
      this.emit("task:done", { taskId: task.id, sessionId: task.sessionId, durationMs });

      t.resolve(result);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      const durationMs = Date.now() - startTime;

      logger.warn(`[Queue] Task ${task.id} failed (attempt ${task.attempts}): ${msg}`);
      this.emit("task:error", { taskId: task.id, sessionId: task.sessionId, error: msg, attempt: task.attempts });

      if (task.attempts < this.maxRetries + 1) {
        // Re-queue for retry
        logger.info(`[Queue] Retrying task ${task.id} in ${this.retryDelayMs}ms`);
        setTimeout(() => {
          this.pending.unshift(task); // retry goes to front
          this._drain();
        }, this.retryDelayMs);
      } else {
        t.reject(err);
      }
    } finally {
      this.running.delete(task.id);
      const prev = this.sessionRunning.get(task.sessionId) ?? 1;
      if (prev <= 1) this.sessionRunning.delete(task.sessionId);
      else this.sessionRunning.set(task.sessionId, prev - 1);

      // Drain again after freeing a slot
      this._drain();
    }
  }
}

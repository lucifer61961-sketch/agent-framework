/**
 * Lightweight in-process metrics collector.
 *
 * Tracks counters, gauges, and histograms. Exposes a JSON snapshot
 * endpoint-friendly object. No external dependencies.
 *
 * For production, the snapshot can be forwarded to Prometheus,
 * Datadog, or any OTLP-compatible collector.
 */

interface CounterState {
  value: number;
}

interface HistogramState {
  count: number;
  sum: number;
  min: number;
  max: number;
  buckets: number[]; // sorted sample values (capped at MAX_SAMPLES)
}

const MAX_SAMPLES = 1000;

export class MetricsCollector {
  private counters = new Map<string, CounterState>();
  private histograms = new Map<string, HistogramState>();
  private startTime = Date.now();

  // ── Counters ──────────────────────────────────────────────────────────────

  increment(name: string, by = 1) {
    const c = this.counters.get(name) ?? { value: 0 };
    c.value += by;
    this.counters.set(name, c);
  }

  counter(name: string): number {
    return this.counters.get(name)?.value ?? 0;
  }

  // ── Histograms ────────────────────────────────────────────────────────────

  record(name: string, value: number) {
    let h = this.histograms.get(name);
    if (!h) {
      h = { count: 0, sum: 0, min: Infinity, max: -Infinity, buckets: [] };
      this.histograms.set(name, h);
    }
    h.count++;
    h.sum += value;
    h.min = Math.min(h.min, value);
    h.max = Math.max(h.max, value);
    if (h.buckets.length < MAX_SAMPLES) {
      h.buckets.push(value);
      h.buckets.sort((a, b) => a - b);
    }
  }

  percentile(name: string, p: number): number | null {
    const h = this.histograms.get(name);
    if (!h || h.buckets.length === 0) return null;
    const idx = Math.ceil((p / 100) * h.buckets.length) - 1;
    return h.buckets[Math.max(0, idx)];
  }

  // ── Agent-specific helpers ─────────────────────────────────────────────────

  recordAgentRun(opts: {
    sessionId: string;
    success: boolean;
    durationMs: number;
    iterations: number;
    inputTokens: number;
    outputTokens: number;
  }) {
    this.increment("agent.runs.total");
    this.increment(opts.success ? "agent.runs.success" : "agent.runs.failure");
    this.record("agent.duration_ms", opts.durationMs);
    this.record("agent.iterations", opts.iterations);
    this.increment("agent.tokens.input", opts.inputTokens);
    this.increment("agent.tokens.output", opts.outputTokens);
  }

  recordToolCall(toolName: string, success: boolean, durationMs: number) {
    this.increment(`tool.calls.${toolName}`);
    this.increment(success ? `tool.success.${toolName}` : `tool.error.${toolName}`);
    this.record(`tool.duration_ms.${toolName}`, durationMs);
  }

  recordTelegramMessage(userId: number) {
    this.increment("telegram.messages.received");
    this.increment(`telegram.user.${userId}`);
  }

  recordRateLimitHit(key: string) {
    this.increment("ratelimit.hits.total");
    this.increment(`ratelimit.hits.${key}`);
  }

  // ── Snapshot ──────────────────────────────────────────────────────────────

  snapshot(): Record<string, unknown> {
    const counters: Record<string, number> = {};
    for (const [k, v] of this.counters) counters[k] = v.value;

    const histograms: Record<string, unknown> = {};
    for (const [k, h] of this.histograms) {
      histograms[k] = {
        count: h.count,
        sum: h.sum,
        mean: h.count ? Math.round(h.sum / h.count) : 0,
        min: h.min === Infinity ? 0 : h.min,
        max: h.max === -Infinity ? 0 : h.max,
        p50: this.percentile(k, 50),
        p90: this.percentile(k, 90),
        p99: this.percentile(k, 99),
      };
    }

    return {
      uptimeSeconds: Math.round((Date.now() - this.startTime) / 1000),
      counters,
      histograms,
    };
  }

  reset() {
    this.counters.clear();
    this.histograms.clear();
  }
}

/** Singleton metrics instance shared across the process */
export const metrics = new MetricsCollector();

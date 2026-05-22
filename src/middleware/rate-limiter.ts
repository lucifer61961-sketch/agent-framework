import { logger } from "../utils/logger";

export interface RateLimitConfig {
  /**
   * Maximum requests allowed in the window.
   * Default: 20
   */
  maxRequests?: number;
  /**
   * Window duration in milliseconds.
   * Default: 60_000 (1 minute)
   */
  windowMs?: number;
  /**
   * If true, block the caller and return an error message instead of throwing.
   * Default: true
   */
  softBlock?: boolean;
}

interface BucketEntry {
  count: number;
  windowStart: number;
}

/**
 * RateLimiter
 *
 * A simple in-memory sliding-window rate limiter.
 * Keyed by an arbitrary string (e.g. Telegram user ID, session ID).
 *
 * Usage:
 *   const limiter = new RateLimiter({ maxRequests: 10, windowMs: 60_000 });
 *   const allowed = limiter.check("telegram:123");
 *   if (!allowed) { ... }
 */
export class RateLimiter {
  private buckets = new Map<string, BucketEntry>();
  private maxRequests: number;
  private windowMs: number;
  private softBlock: boolean;

  // Cleanup interval — prevents memory leak for long-running servers
  private cleanupInterval: NodeJS.Timeout;

  constructor(config: RateLimitConfig = {}) {
    this.maxRequests = config.maxRequests ?? 20;
    this.windowMs = config.windowMs ?? 60_000;
    this.softBlock = config.softBlock ?? true;

    // Purge stale buckets every 5 minutes
    this.cleanupInterval = setInterval(() => this._cleanup(), 5 * 60_000);
    this.cleanupInterval.unref(); // don't keep the process alive
  }

  /**
   * Check whether `key` is within the rate limit.
   * Returns { allowed: true } or { allowed: false, retryAfterMs: number }.
   */
  check(key: string): { allowed: boolean; retryAfterMs?: number; remaining: number } {
    const now = Date.now();
    let entry = this.buckets.get(key);

    if (!entry || now - entry.windowStart >= this.windowMs) {
      entry = { count: 0, windowStart: now };
    }

    if (entry.count >= this.maxRequests) {
      const retryAfterMs = this.windowMs - (now - entry.windowStart);
      logger.warn(`[RateLimiter] Key "${key}" exceeded ${this.maxRequests} req/${this.windowMs}ms — retry in ${retryAfterMs}ms`);
      return { allowed: false, retryAfterMs, remaining: 0 };
    }

    entry.count++;
    this.buckets.set(key, entry);
    return { allowed: true, remaining: this.maxRequests - entry.count };
  }

  /** Manually reset the bucket for a key */
  reset(key: string) {
    this.buckets.delete(key);
  }

  /** Retrieve current usage for a key */
  usage(key: string): { count: number; remaining: number; resetsInMs: number } | null {
    const entry = this.buckets.get(key);
    if (!entry) return null;
    const resetsInMs = Math.max(0, this.windowMs - (Date.now() - entry.windowStart));
    return { count: entry.count, remaining: Math.max(0, this.maxRequests - entry.count), resetsInMs };
  }

  private _cleanup() {
    const now = Date.now();
    let removed = 0;
    for (const [key, entry] of this.buckets) {
      if (now - entry.windowStart >= this.windowMs) {
        this.buckets.delete(key);
        removed++;
      }
    }
    if (removed > 0) logger.debug(`[RateLimiter] Purged ${removed} stale buckets`);
  }

  destroy() {
    clearInterval(this.cleanupInterval);
  }
}

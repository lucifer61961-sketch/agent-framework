import { Router, Request, Response } from "express";
import { SessionStore } from "../session/store";
import { SkillRouter } from "../skills/router";
import { TaskQueue } from "../queue/task-queue";
import { metrics } from "../metrics/collector";
import { RateLimiter } from "../middleware/rate-limiter";
import { logger } from "../utils/logger";

export interface AdminRouterConfig {
  store: SessionStore;
  router: SkillRouter;
  queue: TaskQueue;
  rateLimiter: RateLimiter;
  /**
   * Simple bearer token to protect the admin endpoints.
   * Set via ADMIN_TOKEN env var. If unset, admin routes are disabled.
   */
  adminToken?: string;
}

/**
 * Mounts an /admin Express sub-router with:
 *
 *   GET  /admin/health        — server health + queue stats
 *   GET  /admin/metrics       — full metrics snapshot
 *   GET  /admin/skills        — registered skill manifest
 *   GET  /admin/sessions      — list all session IDs
 *   GET  /admin/sessions/:id  — session detail (message count, created/updated)
 *   DELETE /admin/sessions/:id — clear a session's history
 *   POST /admin/metrics/reset  — reset all metrics counters
 *
 * All routes require:  Authorization: Bearer <ADMIN_TOKEN>
 */
export function createAdminRouter(config: AdminRouterConfig): Router {
  const adminRouter = Router();
  const { store, router, queue, rateLimiter, adminToken } = config;

  // ── Auth middleware ────────────────────────────────────────────────────────
  if (!adminToken) {
    logger.warn("[AdminRouter] ADMIN_TOKEN not set — admin endpoints are DISABLED");
    adminRouter.use((_req: Request, res: Response) => {
      res.status(503).json({ error: "Admin API is disabled (ADMIN_TOKEN not configured)" });
    });
    return adminRouter;
  }

  adminRouter.use((req: Request, res: Response, next) => {
    const auth = req.headers.authorization;
    if (!auth || auth !== `Bearer ${adminToken}`) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    next();
  });

  // ── GET /admin/health ──────────────────────────────────────────────────────
  adminRouter.get("/health", (_req: Request, res: Response) => {
    res.json({
      status: "ok",
      uptime: process.uptime(),
      queue: queue.stats(),
      memory: process.memoryUsage(),
      node: process.version,
    });
  });

  // ── GET /admin/metrics ─────────────────────────────────────────────────────
  adminRouter.get("/metrics", (_req: Request, res: Response) => {
    res.json(metrics.snapshot());
  });

  // ── POST /admin/metrics/reset ──────────────────────────────────────────────
  adminRouter.post("/metrics/reset", (_req: Request, res: Response) => {
    metrics.reset();
    logger.info("[AdminRouter] Metrics reset");
    res.json({ ok: true, message: "Metrics reset" });
  });

  // ── GET /admin/skills ──────────────────────────────────────────────────────
  adminRouter.get("/skills", (_req: Request, res: Response) => {
    res.json(router.inspect());
  });

  // ── GET /admin/sessions ────────────────────────────────────────────────────
  adminRouter.get("/sessions", (_req: Request, res: Response) => {
    const sessions = store.listSessions();
    res.json({ count: sessions.length, sessions });
  });

  // ── GET /admin/sessions/:id ────────────────────────────────────────────────
  adminRouter.get("/sessions/:id", (req: Request, res: Response) => {
    const sessionId = decodeURIComponent(req.params.id);
    const session = store.getSession(sessionId);
    if (!session) {
      res.status(404).json({ error: `Session "${sessionId}" not found` });
      return;
    }
    const history = store.getHistory(sessionId);
    res.json({
      ...session,
      messageCount: history.length,
      // Return last 10 messages for inspection
      recentMessages: history.slice(-10).map((m) => ({
        role: m.role,
        contentPreview:
          typeof m.content === "string"
            ? m.content.slice(0, 200)
            : JSON.stringify(m.content).slice(0, 200),
      })),
    });
  });

  // ── DELETE /admin/sessions/:id ─────────────────────────────────────────────
  adminRouter.delete("/sessions/:id", (req: Request, res: Response) => {
    const sessionId = decodeURIComponent(req.params.id);
    const session = store.getSession(sessionId);
    if (!session) {
      res.status(404).json({ error: `Session "${sessionId}" not found` });
      return;
    }
    store.clearSession(sessionId);
    logger.info(`[AdminRouter] Cleared session ${sessionId}`);
    res.json({ ok: true, sessionId });
  });

  // ── DELETE /admin/sessions (bulk clear all) ────────────────────────────────
  adminRouter.delete("/sessions", (_req: Request, res: Response) => {
    const sessions = store.listSessions();
    for (const id of sessions) store.clearSession(id);
    logger.info(`[AdminRouter] Cleared ${sessions.length} sessions`);
    res.json({ ok: true, cleared: sessions.length });
  });

  // ── GET /admin/ratelimit/:key ──────────────────────────────────────────────
  adminRouter.get("/ratelimit/:key", (req: Request, res: Response) => {
    const key = decodeURIComponent(req.params.key);
    const usage = rateLimiter.usage(key);
    if (!usage) {
      res.json({ key, status: "no data" });
      return;
    }
    res.json({ key, ...usage });
  });

  // ── DELETE /admin/ratelimit/:key (reset bucket) ────────────────────────────
  adminRouter.delete("/ratelimit/:key", (req: Request, res: Response) => {
    const key = decodeURIComponent(req.params.key);
    rateLimiter.reset(key);
    res.json({ ok: true, key, message: "Rate limit bucket reset" });
  });

  return adminRouter;
}

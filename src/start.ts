#!/usr/bin/env tsx
import { config as loadEnv } from "./utils/env";
loadEnv();

import { createGateway } from "./gateway/server";

const token = process.env.TELEGRAM_BOT_TOKEN;
if (!token) {
  console.error("TELEGRAM_BOT_TOKEN is not set. Run: npx tsx setup.ts");
  process.exit(1);
}

const llmKey = process.env.ANTHROPIC_API_KEY || process.env.OPENAI_API_KEY || process.env.GEMINI_API_KEY || process.env.GROQ_API_KEY;
if (!llmKey) {
  console.error("No LLM API key found. Set ANTHROPIC_API_KEY, OPENAI_API_KEY, or GEMINI_API_KEY");
  process.exit(1);
}

const allowedIds = process.env.ALLOWED_USER_IDS
  ? process.env.ALLOWED_USER_IDS.split(",").map(s => Number(s.trim())).filter(Boolean)
  : [];

createGateway({
  telegramToken: token,
  port: Number(process.env.PORT ?? 3000),
  provider: (process.env.PROVIDER as "anthropic" | "openai" | "gemini" | undefined) ?? "anthropic",
  dbPath: process.env.DB_PATH,
  workspace: process.env.WORKSPACE ?? "./workspace",
  webhookSecret: process.env.WEBHOOK_SECRET,
  adminToken: process.env.ADMIN_TOKEN,
  publicUrl: process.env.PUBLIC_URL,
  allowedUserIds: allowedIds,
  queueConcurrency: Number(process.env.QUEUE_CONCURRENCY ?? 4),
  rateLimitPerMinute: Number(process.env.RATE_LIMIT_PER_MIN ?? 20),
  autoloadPlugins: process.env.AUTOLOAD_PLUGINS !== "false",
}).catch(e => {
  console.error("Fatal startup error:", e);
  process.exit(1);
});
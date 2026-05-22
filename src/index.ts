// ── Core ──────────────────────────────────────────────────────────────────────
export { Agent } from "./agent";
export { ToolRegistry } from "./tools/registry";
export { AnthropicProvider } from "./providers/anthropic";
export { OpenAIProvider } from "./providers/openai";

// ── Skills ────────────────────────────────────────────────────────────────────
export { SkillRouter, GoogleSearchSkill, FileWriterSkill } from "./skills/index";
export type {
  Skill, SkillTool, SkillCategory, SkillManifest,
  GoogleSearchSkillConfig, FileWriterSkillConfig,
} from "./skills/index";

// ── Session ───────────────────────────────────────────────────────────────────
export { createSessionStore } from "./session/store";
export { SessionAgent } from "./session/session-agent";
export type { SessionStore } from "./session/store";

// ── Directives ────────────────────────────────────────────────────────────────
export { loadDirectives } from "./directives/loader";
export type { Directives } from "./directives/loader";

// ── Sandbox ───────────────────────────────────────────────────────────────────
export { DockerSandbox, createSandboxedBashHandler } from "./sandbox/docker";
export type { SandboxConfig } from "./sandbox/docker";

// ── Queue ─────────────────────────────────────────────────────────────────────
export { TaskQueue } from "./queue/task-queue";
export type { Task, TaskResult, QueueConfig } from "./queue/task-queue";

// ── Rate Limiter ──────────────────────────────────────────────────────────────
export { RateLimiter } from "./middleware/rate-limiter";
export type { RateLimitConfig } from "./middleware/rate-limiter";

// ── Metrics ───────────────────────────────────────────────────────────────────
export { MetricsCollector, metrics } from "./metrics/collector";

// ── Admin ─────────────────────────────────────────────────────────────────────
export { createAdminRouter } from "./admin/router";
export type { AdminRouterConfig } from "./admin/router";

// ── Plugins ───────────────────────────────────────────────────────────────────
export { PluginLoader } from "./plugins/loader";
export type { PluginManifest, LoadedPlugin } from "./plugins/loader";

// ── Gateway ───────────────────────────────────────────────────────────────────
export { createGateway } from "./gateway/server";
export { TelegramClient, escapeMarkdownV2, splitMessage } from "./gateway/telegram-client";
export type { GatewayConfig } from "./gateway/server";
export type { TelegramConfig, TelegramUpdate, TelegramMessage } from "./gateway/telegram-client";

// ── Built-in tools ────────────────────────────────────────────────────────────
export { bashToolDefinition, bashToolHandler } from "./tools/bash";
export {
  readFileToolDefinition, readFileToolHandler,
  writeFileToolDefinition, writeFileToolHandler,
  listDirToolDefinition, listDirToolHandler,
} from "./tools/files";

// ── Types ─────────────────────────────────────────────────────────────────────
export type {
  AgentConfig, AgentRunOptions, AgentRunResult,
  LLMProvider, ToolDefinition, Message, ContentBlock,
} from "./types";

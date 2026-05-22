import express, { Request, Response, NextFunction } from "express";
import crypto from "crypto";
import { AnthropicProvider } from "../providers/anthropic";
import { OpenAIProvider } from "../providers/openai";
import { GeminiProvider } from "../providers/gemini";
import { GroqProvider } from "../providers/groq";
import { SkillRouter, GoogleSearchSkill, FileWriterSkill } from "../skills/index";
import { bashToolDefinition } from "../tools/bash";
import { createSandboxedBashHandler, DockerSandbox } from "../sandbox/docker";
import { createSessionStore } from "../session/store";
import { SessionAgent } from "../session/session-agent";
import { loadDirectives } from "../directives/loader";
import { TelegramClient, TelegramUpdate, TelegramMessage } from "./telegram-client";
import { TaskQueue } from "../queue/task-queue";
import { RateLimiter } from "../middleware/rate-limiter";
import { metrics } from "../metrics/collector";
import { createAdminRouter } from "../admin/router";
import { PluginLoader } from "../plugins/loader";
import { transcribeVoice, getVoiceFileId } from "./handlers/voice";
import { downloadImage, downloadDocument, buildEnrichedPrompt } from "./handlers/media";
import { ProgressUpdater } from "./handlers/progress";
import { logger } from "../utils/logger";

export interface GatewayConfig {
  port?: number;
  telegramToken: string;
  webhookSecret?: string;
  provider?: "anthropic" | "openai" | "gemini" | "groq";
  dbPath?: string;
  workspace?: string;
  useSandbox?: boolean;
  allowedUserIds?: number[];
  adminToken?: string;
  queueConcurrency?: number;
  rateLimitPerMinute?: number;
  maxHistoryMessages?: number;
  autoloadPlugins?: boolean;
  publicUrl?: string;
}

interface AgentTask {
  prompt: string;
  sessionId: string;
  chatId: number;
  messageId: number;
}

export async function createGateway(config: GatewayConfig) {
  const port = config.port ?? Number(process.env.PORT ?? 3000);
  const webhookSecret =
    config.webhookSecret ??
    crypto.createHash("sha256").update(config.telegramToken).digest("hex").slice(0, 24);

  logger.info("[Gateway] Loading directives…");
  const directives = await loadDirectives();

  const provider = config.provider ?? process.env.PROVIDER ?? "anthropic";
  const llmProvider =
    provider === "openai"
      ? new OpenAIProvider()
      : provider === "gemini"
      ? new GeminiProvider()
      : provider === "groq"
      ? new GroqProvider()
      : new AnthropicProvider();

  const skillRouter = new SkillRouter();

  const serpKey  = process.env.SERPAPI_KEY;
  const braveKey = process.env.BRAVE_SEARCH_API_KEY;
  if (serpKey || braveKey) {
    await skillRouter.register(new GoogleSearchSkill({
      provider: braveKey ? "brave" : "serpapi",
      apiKey: braveKey ?? serpKey,
    }));
  } else {
    logger.warn("[Gateway] No search API key — web_search disabled");
  }

  await skillRouter.register(new FileWriterSkill({
    workspace: config.workspace ?? "./workspace",
  }));

  const sandbox = new DockerSandbox({ image: process.env.SANDBOX_IMAGE ?? "alpine:latest" });
  const sandboxAvailable = config.useSandbox !== false && (await sandbox.isAvailable());

  if (sandboxAvailable) {
    logger.info("[Gateway] Docker sandbox enabled");
    skillRouter.registry.register(bashToolDefinition, createSandboxedBashHandler(sandbox));
  } else {
    logger.warn("[Gateway] No Docker — bash on HOST (dev mode only)");
    const { bashToolHandler } = await import("../tools/bash");
    skillRouter.registry.register(bashToolDefinition, bashToolHandler);
  }

  if (config.autoloadPlugins !== false) {
    const pluginLoader = new PluginLoader(skillRouter);
    const loaded = await pluginLoader.autoload();
    if (loaded.length) logger.info(`[Gateway] Plugins loaded: ${loaded.map(p => p.skillName).join(", ")}`);
  }

  skillRouter.printManifest();

  const store = createSessionStore(config.dbPath);

  const sessionAgent = new SessionAgent(
    llmProvider, skillRouter.registry,
    { systemPrompt: directives.systemPrompt, maxIterations: 25 },
    store,
    { maxHistoryMessages: config.maxHistoryMessages ?? 60 }
  );

  const queue = new TaskQueue<AgentTask, string>({
    concurrency: config.queueConcurrency ?? 4,
    perSessionConcurrency: 1,
    maxQueueSize: 200,
    maxRetries: 1,
    retryDelayMs: 3000,
  });

  queue.setHandler(async (task) => {
    const result = await sessionAgent.run(task.payload.sessionId, task.payload.prompt);
    metrics.recordAgentRun({
      sessionId: task.payload.sessionId,
      success: result.success,
      durationMs: result.durationMs,
      iterations: result.iterations,
      inputTokens: result.usage.inputTokens,
      outputTokens: result.usage.outputTokens,
    });
    if (!result.success) throw new Error(result.error ?? "Agent failed");
    return result.output;
  });

  const rateLimiter = new RateLimiter({
    maxRequests: config.rateLimitPerMinute ?? 20,
    windowMs: 60_000,
  });

  const telegram = new TelegramClient({ botToken: config.telegramToken });

  const app = express();
  app.use(express.json({ limit: "2mb" }));

  app.get("/health", (_req: Request, res: Response) => {
    res.json({
      status: "ok",
      uptime: process.uptime(),
      sandbox: sandboxAvailable,
      queue: queue.stats(),
      skills: skillRouter.inspect().map(s => s.name),
    });
  });

  const adminRouter = createAdminRouter({
    store, router: skillRouter,
    queue: queue as unknown as TaskQueue,
    rateLimiter,
    adminToken: config.adminToken ?? process.env.ADMIN_TOKEN,
  });
  app.use("/admin", adminRouter);

  const webhookPath = `/webhook/${webhookSecret}`;

  app.post(webhookPath, asyncHandler(async (req: Request, res: Response) => {
    res.sendStatus(200);

    const update = req.body as TelegramUpdate;

    if (update.callback_query) {
      const cq = update.callback_query;
      await telegram.answerCallbackQuery(cq.id);
      if (cq.data && cq.message) {
        await handleCommand(cq.data, cq.message.chat.id,
          (cq.from.id), sessionAgent, telegram, store);
      }
      return;
    }

    const message = update.message;
    if (!message) return;

    const userId = message.from?.id;
    const chatId = message.chat.id;

    if (config.allowedUserIds?.length && userId && !config.allowedUserIds.includes(userId)) {
      logger.warn(`[Gateway] Blocked user ${userId}`);
      return;
    }

    if (userId) {
      const rl = rateLimiter.check(`tg:${userId}`);
      if (!rl.allowed) {
        metrics.recordRateLimitHit(`tg:${userId}`);
        const wait = Math.ceil((rl.retryAfterMs ?? 60000) / 1000);
        await telegram.sendMessage(chatId, `⏳ Slow down! Try again in ${wait}s.`);
        return;
      }
    }

    metrics.recordTelegramMessage(userId ?? 0);
    await handleUpdate(message, queue, telegram, sessionAgent, store, config);
  }));

  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    logger.error("[Gateway] Unhandled error", { message: err.message });
    res.status(500).json({ error: "Internal server error" });
  });

  const server = app.listen(port, async () => {
    logger.info(`[Gateway] Listening on :${port}`);
    logger.info(`[Gateway] Webhook path: ${webhookPath}`);

    try {
      await telegram.setMyCommands([
        { command: "start",   description: "Introduction & welcome" },
        { command: "help",    description: "Show available commands" },
        { command: "clear",   description: "Reset conversation history" },
        { command: "status",  description: "Queue and session info" },
        { command: "skills",  description: "List available agent skills" },
        { command: "memory",  description: "Show recent conversation summary" },
      ]);
      logger.info("[Gateway] Bot commands registered");
    } catch (e) {
      logger.warn("[Gateway] Could not register commands: " + (e as Error).message);
    }

    const publicUrl = config.publicUrl ?? process.env.PUBLIC_URL;
    if (publicUrl) {
      try {
        const fullUrl = `${publicUrl.replace(/\/$/, "")}${webhookPath}`;
        await telegram.setWebhook(fullUrl);
        logger.info(`[Gateway] Webhook registered: ${fullUrl}`);
      } catch (e) {
        logger.warn(`[Gateway] Webhook auto-register failed: ${(e as Error).message}`);
      }
    } else {
      logger.info(`[Gateway] To register webhook:\n  curl -X POST https://api.telegram.org/bot${config.telegramToken}/setWebhook -H 'Content-Type: application/json' -d '{"url":"https://YOUR_DOMAIN${webhookPath}"}'`);
    }
  });

  const shutdown = async () => {
    logger.info("[Gateway] Shutting down…");
    server.close();
    await skillRouter.teardownAll();
    store.close();
    rateLimiter.destroy();
    process.exit(0);
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);

  return { app, server, skillRouter, store, telegram, queue, rateLimiter, webhookPath };
}

async function handleUpdate(
  message: TelegramMessage,
  queue: TaskQueue<AgentTask, string>,
  telegram: TelegramClient,
  sessionAgent: SessionAgent,
  store: ReturnType<typeof createSessionStore>,
  config: GatewayConfig
): Promise<void> {
  const chatId    = message.chat.id;
  const userId    = message.from?.id ?? chatId;
  const sessionId = `telegram:${userId}`;

  const text = message.text ?? message.caption ?? "";
  if (text.startsWith("/")) {
    await handleCommand(text, chatId, userId, sessionAgent, telegram, store);
    return;
  }

  let userPrompt = text;

  const voiceFileId = getVoiceFileId(message.voice, message.audio);
  if (voiceFileId) {
    await telegram.sendTyping(chatId);
    const transcript = await transcribeVoice(voiceFileId, telegram);
    if (transcript) {
      userPrompt = transcript;
    } else {
      await telegram.sendMessage(chatId, "Could not transcribe audio. Please send a text message.");
      return;
    }
  }

  if (message.photo?.length) {
    await telegram.sendTyping(chatId);
    const img = await downloadImage(message.photo, telegram);
    if (img) {
      const caption = message.caption?.trim() || "Describe this image in detail.";
      userPrompt = caption + `\n[Image received. Size: ${img.base64.length} chars, type: ${img.mimeType}]`;
    }
  }

  if (message.document) {
    await telegram.sendTyping(chatId);
    const doc = await downloadDocument(message.document, telegram);
    if (doc) {
      const base = message.caption?.trim() || `Analyze the attached file "${doc.filename}"`;
      userPrompt = buildEnrichedPrompt(base, doc);
    } else {
      await telegram.sendMessage(chatId, "Could not read that file type.");
      return;
    }
  }

  if (message.sticker) {
    await telegram.sendMessage(chatId, "Nice sticker! How can I help you today?");
    return;
  }

  if (!userPrompt.trim()) {
    await telegram.sendMessage(chatId, "Send me a text message, voice note, or document!");
    return;
  }

  const progress = new ProgressUpdater(chatId, telegram);
  await progress.start();

  try {
    const output = await queue.enqueue(sessionId, {
      prompt: userPrompt,
      sessionId,
      chatId,
      messageId: message.message_id,
    });

    await progress.stop(true);

    const reply = output?.trim() || "Done.";
    await telegram.sendMessage(chatId, reply, {
      parseMode: "Markdown",
      replyToMessageId: message.message_id,
    });
  } catch (err: unknown) {
    await progress.stop(true);
    const msg = err instanceof Error ? err.message : String(err);
    logger.error(`[Gateway] Agent error for ${sessionId}: ${msg}`);
    if (msg.includes("Queue is full")) {
      await telegram.sendMessage(chatId, "Server is busy, please try again in a moment.");
    } else {
      await telegram.sendMessage(chatId, `Something went wrong: \`${msg.slice(0, 300)}\``);
    }
  }
}

async function handleCommand(
  text: string,
  chatId: number,
  userId: number,
  sessionAgent: SessionAgent,
  telegram: TelegramClient,
  store: ReturnType<typeof createSessionStore>
): Promise<void> {
  const cmd = text.split(" ")[0].toLowerCase().replace(/^\//, "");
  const sessionId = `telegram:${userId}`;

  switch (cmd) {
    case "start":
      await telegram.sendMessage(chatId,
        `👋 *Welcome! I'm your AI agent.*\n\nJust send me a message or use /help to see commands.`,
        { parseMode: "Markdown" }
      );
      break;
    case "help":
      await telegram.sendMessage(chatId,
        `*Commands*\n/start — Welcome\n/clear — Reset conversation\n/status — Session info\n/skills — List skills\n/memory — Recent history\n/help — This message`,
        { parseMode: "Markdown" }
      );
      break;
    case "clear":
      sessionAgent.clearHistory(sessionId);
      await telegram.sendMessage(chatId, "🧹 Conversation cleared. Fresh start!");
      break;
    case "status": {
      const session = store.getSession(sessionId);
      const history = store.getHistory(sessionId);
      await telegram.sendMessage(chatId,
        `*Your Session*\nMessages: ${history.length}\nStarted: ${session ? new Date(session.createdAt).toLocaleString() : "new session"}`,
        { parseMode: "Markdown" }
      );
      break;
    }
    case "skills":
      await telegram.sendMessage(chatId,
        `*Available Skills*\n🔍 web\\_search\n📝 write\\_file\n📖 read\\_file\n💻 bash`,
        { parseMode: "Markdown" }
      );
      break;
    case "memory": {
      const history = store.getHistory(sessionId);
      if (!history.length) {
        await telegram.sendMessage(chatId, "No conversation history yet.");
        break;
      }
      const last = history.slice(-6);
      const summary = last.map(m =>
        `*${m.role === "user" ? "You" : "Agent"}:* ${
          (typeof m.content === "string" ? m.content : "[tool call]").slice(0, 120)
        }`
      ).join("\n\n");
      await telegram.sendMessage(chatId, `*Last ${last.length} turns:*\n\n${summary}`, { parseMode: "Markdown" });
      break;
    }
    default:
      await telegram.sendMessage(chatId, `Unknown command: /${cmd}\nType /help for available commands.`);
  }
}

function asyncHandler(fn: (req: Request, res: Response, next: NextFunction) => Promise<void>) {
  return (req: Request, res: Response, next: NextFunction) => {
    fn(req, res, next).catch(next);
  };
}
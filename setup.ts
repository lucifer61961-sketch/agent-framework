#!/usr/bin/env tsx
/**
 * ╔══════════════════════════════════════╗
 * ║   AGENT FRAMEWORK — SETUP WIZARD    ║
 * ╚══════════════════════════════════════╝
 *
 * Run:  npx tsx setup.ts
 *
 * Guides you through configuration, validates your API keys,
 * creates the .env file, and optionally registers your webhook.
 */

import fs from "fs";
import path from "path";
import readline from "readline";

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = (q: string): Promise<string> => new Promise(r => rl.question(q, r));
const askSecret = (q: string): Promise<string> => {
  process.stdout.write(q);
  process.stdin.setRawMode?.(true);
  return new Promise(resolve => {
    let val = "";
    process.stdin.once("data", function handler(chunk: Buffer) {
      val += chunk.toString();
      process.stdin.setRawMode?.(false);
      process.stdout.write("\n");
      resolve(val.trim().replace(/\r?\n/g, ""));
    });
  });
};

const GREEN  = "\x1b[32m";
const YELLOW = "\x1b[33m";
const CYAN   = "\x1b[36m";
const RED    = "\x1b[31m";
const BOLD   = "\x1b[1m";
const RESET  = "\x1b[0m";

function ok(msg: string)   { console.log(`${GREEN}✅ ${msg}${RESET}`); }
function warn(msg: string) { console.log(`${YELLOW}⚠️  ${msg}${RESET}`); }
function info(msg: string) { console.log(`${CYAN}ℹ️  ${msg}${RESET}`); }
function err(msg: string)  { console.log(`${RED}❌ ${msg}${RESET}`); }
function bold(msg: string) { return `${BOLD}${msg}${RESET}`; }

async function validateTelegramToken(token: string): Promise<string | null> {
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/getMe`);
    const data = await res.json() as { ok: boolean; result?: { username: string; first_name: string } };
    if (data.ok && data.result) return data.result.username;
    return null;
  } catch { return null; }
}

async function validateAnthropicKey(key: string): Promise<boolean> {
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model: "claude-haiku-4-5-20251001", max_tokens: 10, messages: [{ role: "user", content: "hi" }] }),
    });
    return res.status !== 401;
  } catch { return false; }
}

async function validateOpenAIKey(key: string): Promise<boolean> {
  try {
    const res = await fetch("https://api.openai.com/v1/models", {
      headers: { Authorization: `Bearer ${key}` },
    });
    return res.status !== 401;
  } catch { return false; }
}

async function main() {
  console.clear();
  console.log(`
${CYAN}${BOLD}╔═══════════════════════════════════════════════════════╗
║          AGENT FRAMEWORK  —  SETUP WIZARD            ║
╚═══════════════════════════════════════════════════════╝${RESET}

This wizard will configure your AI agent and create a ${bold(".env")} file.
Press ${bold("Ctrl+C")} at any time to cancel.
`);

  const config: Record<string, string> = {};

  // ── Telegram ──────────────────────────────────────────────────────────────
  console.log(`\n${bold("── Step 1: Telegram Bot ──────────────────────────────────")}`);
  info("Get a token from @BotFather on Telegram: https://t.me/BotFather");
  info("Send /newbot to BotFather and follow the instructions.\n");

  while (true) {
    const token = await ask("Telegram Bot Token: ");
    if (!token.includes(":")) { err("Invalid token format. It should look like: 123456:ABCdef..."); continue; }
    process.stdout.write("  Validating token… ");
    const username = await validateTelegramToken(token);
    if (username) {
      ok(`@${username} is ready!`);
      config.TELEGRAM_BOT_TOKEN = token;
      break;
    } else {
      err("Token validation failed. Double-check and try again.");
    }
  }

  // ── LLM Provider ─────────────────────────────────────────────────────────
  console.log(`\n${bold("── Step 2: LLM Provider ──────────────────────────────────")}`);
  const providerChoice = await ask("Provider (1=Anthropic Claude, 2=OpenAI GPT-4o) [1]: ");
  const useOpenAI = providerChoice.trim() === "2";

  if (useOpenAI) {
    config.PROVIDER = "openai";
    info("Get your key from: https://platform.openai.com/api-keys\n");
    while (true) {
      const key = await ask("OpenAI API Key: ");
      if (!key.startsWith("sk-")) { err("Key should start with 'sk-'"); continue; }
      process.stdout.write("  Validating key… ");
      const valid = await validateOpenAIKey(key);
      if (valid) { ok("OpenAI key valid!"); config.OPENAI_API_KEY = key; break; }
      else { err("Key validation failed."); }
    }
  } else {
    config.PROVIDER = "anthropic";
    info("Get your key from: https://console.anthropic.com/settings/api-keys\n");
    while (true) {
      const key = await ask("Anthropic API Key: ");
      if (!key.startsWith("sk-ant-")) { err("Key should start with 'sk-ant-'"); continue; }
      process.stdout.write("  Validating key… ");
      const valid = await validateAnthropicKey(key);
      if (valid) { ok("Anthropic key valid!"); config.ANTHROPIC_API_KEY = key; break; }
      else { err("Key validation failed. Check your key."); }
    }
  }

  // ── Web Search (optional) ─────────────────────────────────────────────────
  console.log(`\n${bold("── Step 3: Web Search (optional but recommended) ────────")}`);
  info("Gives the agent the ability to search the internet.");
  info("Free tier: SerpAPI (100/month) → https://serpapi.com");
  info("          Brave   (2000/month) → https://api.search.brave.com\n");
  const addSearch = await ask("Add web search? (y/N): ");
  if (addSearch.toLowerCase() === "y") {
    const searchProvider = await ask("Provider (1=SerpAPI, 2=Brave) [1]: ");
    if (searchProvider.trim() === "2") {
      const key = await ask("Brave Search API Key: ");
      config.BRAVE_SEARCH_API_KEY = key;
      ok("Brave Search configured");
    } else {
      const key = await ask("SerpAPI Key: ");
      config.SERPAPI_KEY = key;
      ok("SerpAPI configured");
    }
  } else {
    warn("Skipping web search — agent won't be able to look up current information");
  }

  // ── Voice transcription (optional) ───────────────────────────────────────
  if (!useOpenAI) {
    console.log(`\n${bold("── Step 4: Voice Messages (optional) ────────────────────")}`);
    info("Transcribes voice notes via OpenAI Whisper.");
    info("Requires a separate OpenAI key even when using Anthropic.\n");
    const addVoice = await ask("Enable voice transcription? (y/N): ");
    if (addVoice.toLowerCase() === "y") {
      const key = await ask("OpenAI API Key (for Whisper): ");
      config.OPENAI_API_KEY = key;
      ok("Voice transcription enabled");
    }
  }

  // ── Server config ─────────────────────────────────────────────────────────
  console.log(`\n${bold("── Step 5: Server Configuration ─────────────────────────")}`);
  const portStr = await ask("Port [3000]: ");
  config.PORT = portStr.trim() || "3000";

  const publicUrl = await ask("Public HTTPS URL (for auto-webhook, leave blank to skip):\n  e.g. https://abc123.ngrok.io\n> ");
  if (publicUrl.trim()) {
    config.PUBLIC_URL = publicUrl.trim();
    ok(`Public URL set to: ${config.PUBLIC_URL}`);
  } else {
    warn("No public URL — you'll need to register the webhook manually");
  }

  // Admin token
  const adminToken = Math.random().toString(36).slice(2, 18);
  config.ADMIN_TOKEN = adminToken;
  ok(`Admin token generated (save this!): ${bold(adminToken)}`);

  // ── Write .env ────────────────────────────────────────────────────────────
  console.log(`\n${bold("── Writing .env file ────────────────────────────────────")}`);

  const envLines = [
    "# Generated by setup.ts — " + new Date().toISOString(),
    "",
    "# ── Telegram ─────────────────────────────────────────────",
    `TELEGRAM_BOT_TOKEN=${config.TELEGRAM_BOT_TOKEN}`,
    "",
    "# ── LLM Provider ─────────────────────────────────────────",
    `PROVIDER=${config.PROVIDER}`,
    config.ANTHROPIC_API_KEY ? `ANTHROPIC_API_KEY=${config.ANTHROPIC_API_KEY}` : "# ANTHROPIC_API_KEY=",
    config.OPENAI_API_KEY    ? `OPENAI_API_KEY=${config.OPENAI_API_KEY}`       : "# OPENAI_API_KEY=",
    "",
    "# ── Web Search ────────────────────────────────────────────",
    config.SERPAPI_KEY          ? `SERPAPI_KEY=${config.SERPAPI_KEY}` : "# SERPAPI_KEY=",
    config.BRAVE_SEARCH_API_KEY ? `BRAVE_SEARCH_API_KEY=${config.BRAVE_SEARCH_API_KEY}` : "# BRAVE_SEARCH_API_KEY=",
    "",
    "# ── Server ────────────────────────────────────────────────",
    `PORT=${config.PORT}`,
    config.PUBLIC_URL ? `PUBLIC_URL=${config.PUBLIC_URL}` : "# PUBLIC_URL=https://your-domain.com",
    `ADMIN_TOKEN=${config.ADMIN_TOKEN}`,
    "",
    "# ── Storage ───────────────────────────────────────────────",
    "DB_PATH=./data/sessions.db",
    "WORKSPACE=./workspace",
    "",
    "# ── Options ───────────────────────────────────────────────",
    "SANDBOX_IMAGE=alpine:latest",
    "QUEUE_CONCURRENCY=4",
    "RATE_LIMIT_PER_MIN=20",
    "LOG_LEVEL=info",
  ];

  fs.writeFileSync(path.resolve(".env"), envLines.filter(l => l !== undefined).join("\n"));
  ok(".env file created successfully!");

  // ── Create directories ────────────────────────────────────────────────────
  fs.mkdirSync("data",      { recursive: true });
  fs.mkdirSync("workspace", { recursive: true });
  ok("data/ and workspace/ directories created");

  // ── Final instructions ────────────────────────────────────────────────────
  console.log(`
${CYAN}${BOLD}╔═══════════════════════════════════════════════════════╗
║                  SETUP COMPLETE! 🎉                   ║
╚═══════════════════════════════════════════════════════╝${RESET}

${bold("Start your agent:")}
  npm install
  npm start

${config.PUBLIC_URL
  ? `${bold("Webhook:")} Will be auto-registered on startup at:\n  ${config.PUBLIC_URL}/webhook/...`
  : `${bold("Webhook:")} After starting the server, the log will show the\n  exact curl command to register your webhook with Telegram.`}

${bold("Admin API:")}  http://localhost:${config.PORT}/admin/*
${bold("Token:")}      ${config.ADMIN_TOKEN}
${bold("Health:")}     http://localhost:${config.PORT}/health

${YELLOW}${bold("For local development with Telegram, use ngrok:")}${RESET}
  npx ngrok http ${config.PORT}
  Then re-run setup or manually set PUBLIC_URL and restart.
`);

  rl.close();
}

main().catch(e => { console.error(e); process.exit(1); });

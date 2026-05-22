#!/usr/bin/env tsx
/**
 * ╔═══════════════════════════════╗
 * ║   AGENT SELF-TEST SCRIPT     ║
 * ╚═══════════════════════════════╝
 *
 * Run:  npx tsx test-agent.ts
 *
 * Tests the full agentic loop WITHOUT Telegram.
 * Validates: API key, skills, session memory, tool execution.
 */

import { config as loadEnv } from "./src/utils/env";
loadEnv();

import { Agent } from "./src/agent";
import { AnthropicProvider } from "./src/providers/anthropic";
import { OpenAIProvider } from "./src/providers/openai";
import { SkillRouter, GoogleSearchSkill, FileWriterSkill } from "./src/skills/index";
import { loadDirectives } from "./src/directives/loader";
import { createSessionStore } from "./src/session/store";
import { SessionAgent } from "./src/session/session-agent";
import path from "path";
import fs from "fs";

const GREEN  = "\x1b[32m";
const RED    = "\x1b[31m";
const YELLOW = "\x1b[33m";
const CYAN   = "\x1b[36m";
const BOLD   = "\x1b[1m";
const RESET  = "\x1b[0m";

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => Promise<void>) {
  process.stdout.write(`  ${CYAN}▶${RESET} ${name}… `);
  try {
    await fn();
    console.log(`${GREEN}PASS${RESET}`);
    passed++;
  } catch (e) {
    console.log(`${RED}FAIL${RESET}`);
    console.log(`    ${RED}${(e as Error).message}${RESET}`);
    failed++;
  }
}

function assert(condition: boolean, msg: string) {
  if (!condition) throw new Error(msg);
}

async function main() {
  console.log(`\n${BOLD}${CYAN}Agent Framework — Self-Test${RESET}\n`);

  // ── 0. Env check ─────────────────────────────────────────────────────────
  console.log(`${BOLD}[0] Environment${RESET}`);
  await test("ANTHROPIC_API_KEY or OPENAI_API_KEY present", async () => {
    assert(
      !!(process.env.ANTHROPIC_API_KEY || process.env.OPENAI_API_KEY),
      "Set ANTHROPIC_API_KEY or OPENAI_API_KEY in .env"
    );
  });

  // ── 1. Directives ─────────────────────────────────────────────────────────
  console.log(`\n${BOLD}[1] Directives${RESET}`);
  let directives: Awaited<ReturnType<typeof loadDirectives>>;
  await test("Load SOUL.md / USER.md / AGENTS.md", async () => {
    directives = await loadDirectives();
    assert(directives.systemPrompt.length > 50, "System prompt is too short");
  });

  // ── 2. Skills ─────────────────────────────────────────────────────────────
  console.log(`\n${BOLD}[2] Skills${RESET}`);
  const skillRouter = new SkillRouter();

  await test("FileWriterSkill registers and creates workspace", async () => {
    await skillRouter.register(new FileWriterSkill({ workspace: "./test-workspace" }));
    assert(fs.existsSync("./test-workspace"), "Workspace dir not created");
  });

  await test("GoogleSearchSkill skips gracefully if no API key", async () => {
    if (!process.env.SERPAPI_KEY && !process.env.BRAVE_SEARCH_API_KEY) return; // skip
    await skillRouter.register(new GoogleSearchSkill());
  });

  await test("SkillRouter has at least 1 skill", async () => {
    assert(skillRouter.inspect().length >= 1, "No skills registered");
  });

  // ── 3. Agent basic run ────────────────────────────────────────────────────
  console.log(`\n${BOLD}[3] Agent Loop${RESET}`);
  const provider = process.env.PROVIDER === "openai"
    ? new OpenAIProvider()
    : new AnthropicProvider();

  const agent = new Agent(provider, skillRouter.registry, {
    systemPrompt: "You are a test assistant. Answer concisely.",
  });

  await test("Agent completes a simple text task", async () => {
    const result = await agent.run("Say exactly: AGENT_OK");
    assert(result.success, `Agent failed: ${result.error}`);
    assert(result.output.includes("AGENT_OK"), `Expected AGENT_OK, got: "${result.output}"`);
  });

  // ── 4. File tool ──────────────────────────────────────────────────────────
  console.log(`\n${BOLD}[4] File Tool${RESET}`);
  await test("Agent can write a file using write_file tool", async () => {
    const result = await agent.run(
      'Write the text "hello from agent" to a file called test-output.txt'
    );
    assert(result.success, `Failed: ${result.error}`);
    // Give it a moment
    await new Promise(r => setTimeout(r, 500));
    const exists = fs.existsSync("./test-workspace/test-output.txt");
    assert(exists, "test-output.txt was not created in workspace");
    const content = fs.readFileSync("./test-workspace/test-output.txt", "utf-8");
    assert(content.includes("hello from agent"), `File content wrong: "${content}"`);
  });

  // ── 5. Session memory ─────────────────────────────────────────────────────
  console.log(`\n${BOLD}[5] Session Memory${RESET}`);
  const store = createSessionStore("./data/test-sessions.db");
  const sessionAgent = new SessionAgent(
    provider, skillRouter.registry,
    { systemPrompt: "You are a test assistant. Be concise." },
    store
  );

  const testSession = `test:${Date.now()}`;
  await test("Session agent remembers across turns", async () => {
    await sessionAgent.run(testSession, "Remember the number 42. Reply OK.");
    const result2 = await sessionAgent.run(testSession, "What number did I just ask you to remember?");
    assert(result2.success, `Turn 2 failed: ${result2.error}`);
    assert(result2.output.includes("42"), `Expected 42 in reply, got: "${result2.output}"`);
  });

  await test("Session history persists in SQLite", async () => {
    const history = store.getHistory(testSession);
    assert(history.length >= 2, `Expected ≥2 messages, got ${history.length}`);
  });

  // ── 6. Cleanup ────────────────────────────────────────────────────────────
  console.log(`\n${BOLD}[6] Cleanup${RESET}`);
  await test("Cleanup test workspace and session", async () => {
    store.deleteSession(testSession);
    store.close();
    fs.rmSync("./test-workspace", { recursive: true, force: true });
    fs.rmSync("./data/test-sessions.db", { force: true });
  });

  // ── Summary ────────────────────────────────────────────────────────────────
  const total = passed + failed;
  console.log(`\n${"─".repeat(45)}`);
  if (failed === 0) {
    console.log(`${GREEN}${BOLD}✅ All ${total} tests passed!${RESET}`);
    console.log(`\n${BOLD}Your agent is ready. Run:${RESET}  npm start\n`);
  } else {
    console.log(`${RED}${BOLD}❌ ${failed}/${total} tests failed${RESET}`);
    console.log(`${YELLOW}Fix the issues above, then run: npx tsx test-agent.ts${RESET}\n`);
    process.exit(1);
  }
}

main().catch(e => { console.error(e); process.exit(1); });

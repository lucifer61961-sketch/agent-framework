#!/usr/bin/env tsx
/**
 * Skills-powered CLI runner
 *
 * Usage:
 *   npx tsx src/run-skills.ts "Search for the latest AI news and write a summary to notes/ai-news.md"
 *
 * Environment variables:
 *   ANTHROPIC_API_KEY   – Anthropic key (default provider)
 *   OPENAI_API_KEY      – OpenAI key   (set PROVIDER=openai)
 *   SERPAPI_KEY         – SerpAPI key  (for web_search via SerpAPI)
 *   BRAVE_SEARCH_API_KEY– Brave key    (set SEARCH_PROVIDER=brave)
 *   PROVIDER            – "anthropic" | "openai"   (default: anthropic)
 *   SEARCH_PROVIDER     – "serpapi"   | "brave"    (default: serpapi)
 *   WORKSPACE           – path to workspace folder  (default: ./workspace)
 *   LOG_LEVEL           – "debug" | "info" | "warn" | "error"
 */

import {
  Agent,
  AnthropicProvider,
  OpenAIProvider,
} from "./index";

import {
  SkillRouter,
  GoogleSearchSkill,
  FileWriterSkill,
} from "./skills/index";

// ─── System prompt ────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are an autonomous research and writing agent.

You have two core skills:
1. web_search — search the internet for current information
2. write_file / read_file / patch_file / list_files / delete_file — manage files in your workspace

How to work:
- Break the task into steps and use your skills to complete each step.
- When writing files, prefer Markdown (.md) for structured notes and plain text (.txt) for simple data.
- After writing, confirm the file was created by reading it back.
- When finished, summarise what you did and list every file you created or modified.
- Never ask for clarification — make reasonable assumptions and proceed.`;

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const userPrompt = process.argv.slice(2).join(" ");
  if (!userPrompt) {
    console.error("Usage: npx tsx src/run-skills.ts <prompt>");
    process.exit(1);
  }

  // ── Provider ──────────────────────────────────────────────────────────────
  const providerName = (process.env.PROVIDER ?? "anthropic").toLowerCase();
  const provider =
    providerName === "openai" ? new OpenAIProvider() : new AnthropicProvider();

  console.log(`Provider : ${providerName}`);

  // ── Skill router ──────────────────────────────────────────────────────────
  const router = new SkillRouter();

  await router.register(
    new GoogleSearchSkill({
      provider: (process.env.SEARCH_PROVIDER as "serpapi" | "brave") ?? "serpapi",
    })
  );

  await router.register(
    new FileWriterSkill({
      workspace: process.env.WORKSPACE ?? "./workspace",
    })
  );

  router.printManifest();

  // ── Agent ─────────────────────────────────────────────────────────────────
  const agent = new Agent(provider, router.registry, {
    systemPrompt: SYSTEM_PROMPT,
    maxIterations: 25,
  });

  console.log(`Prompt   : ${userPrompt}\n${"─".repeat(64)}\n`);

  try {
    const result = await agent.run(userPrompt);

    console.log(`\n${"─".repeat(64)}`);
    if (result.success) {
      console.log("✅  Task complete\n");
      console.log(result.output);
    } else {
      console.error(`❌  Task failed: ${result.error}`);
    }

    console.log(
      `\n[Iterations: ${result.iterations} | Tokens in: ${result.usage.inputTokens} out: ${result.usage.outputTokens} | ${result.durationMs}ms]`
    );
  } finally {
    await router.teardownAll();
  }
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});

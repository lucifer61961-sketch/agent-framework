#!/usr/bin/env tsx
/**
 * CLI runner
 *
 * Usage:
 *   npx tsx src/run.ts "List all .ts files in this directory"
 *   PROVIDER=openai npx tsx src/run.ts "What node version is installed?"
 */

import {
  Agent,
  AnthropicProvider,
  OpenAIProvider,
  ToolRegistry,
  bashToolDefinition, bashToolHandler,
  readFileToolDefinition, readFileToolHandler,
  writeFileToolDefinition, writeFileToolHandler,
  listDirToolDefinition, listDirToolHandler,
} from "./index";

const SYSTEM_PROMPT = `You are an autonomous AI agent running on a local Linux machine.
You can execute bash commands, read files, and write files to complete tasks.

Guidelines:
- Think step by step before acting.
- Prefer small, targeted commands over large destructive ones.
- After each tool result, decide whether the task is complete or more steps are needed.
- When the task is done, summarise what you did and the outcome clearly.
- If something fails, diagnose and retry with a corrected approach.
- Never ask the user for clarification mid-task; make reasonable assumptions and proceed.`;

async function main() {
  const userPrompt = process.argv.slice(2).join(" ");

  if (!userPrompt) {
    console.error("Usage: npx tsx src/run.ts <prompt>");
    process.exit(1);
  }

  // ── Provider selection ──────────────────────────────────────────────────────
  const providerName = (process.env.PROVIDER ?? "anthropic").toLowerCase();
  let provider;

  if (providerName === "openai") {
    provider = new OpenAIProvider();
    console.log("Using provider: OpenAI");
  } else {
    provider = new AnthropicProvider();
    console.log("Using provider: Anthropic");
  }

  // ── Tool registry ───────────────────────────────────────────────────────────
  const tools = new ToolRegistry()
    .register(bashToolDefinition, bashToolHandler)
    .register(readFileToolDefinition, readFileToolHandler)
    .register(writeFileToolDefinition, writeFileToolHandler)
    .register(listDirToolDefinition, listDirToolHandler);

  // ── Agent ───────────────────────────────────────────────────────────────────
  const agent = new Agent(provider, tools, {
    systemPrompt: SYSTEM_PROMPT,
    maxIterations: 20,
  });

  console.log(`\nPrompt: ${userPrompt}\n${"─".repeat(60)}\n`);

  const result = await agent.run(userPrompt);

  console.log(`\n${"─".repeat(60)}`);
  if (result.success) {
    console.log("✅  Task complete\n");
    console.log(result.output);
  } else {
    console.error(`❌  Task failed: ${result.error}`);
  }

  console.log(
    `\n[Iterations: ${result.iterations} | Tokens: ${result.usage.inputTokens}↑ ${result.usage.outputTokens}↓ | ${result.durationMs}ms]`
  );
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});

import { LLMProvider, Message, ToolCall, ToolResult } from "./types";
import { ToolRegistry } from "./tools/registry";
import { logger } from "./utils/logger";
import { AgentConfig, AgentRunOptions, AgentRunResult } from "./types";

const DEFAULT_MAX_ITERATIONS = 20;

export class Agent {
  private provider: LLMProvider;
  private tools: ToolRegistry;
  private config: AgentConfig;

  constructor(provider: LLMProvider, tools: ToolRegistry, config: AgentConfig) {
    this.provider = provider;
    this.tools = tools;
    this.config = config;
  }

  /**
   * Run with an injected prior history (session persistence).
   * History is prepended so the LLM sees full conversation context.
   */
  async runWithHistory(
    userPrompt: string,
    priorHistory: Message[],
    options: AgentRunOptions = {}
  ): Promise<AgentRunResult> {
    return this._runLoop(userPrompt, priorHistory, options);
  }

  /** Standard single-turn run with no prior history */
  async run(userPrompt: string, options: AgentRunOptions = {}): Promise<AgentRunResult> {
    return this._runLoop(userPrompt, [], options);
  }

  /**
   * The core agentic loop.
   *
   * Flow:
   *   1. Build messages = priorHistory + current user message
   *   2. Call LLM
   *   3. If the response contains tool calls → execute them, append results, goto 2
   *   4. If no tool calls → task is complete, return final text
   */
  private async _runLoop(
    userPrompt: string,
    priorHistory: Message[],
    options: AgentRunOptions
  ): Promise<AgentRunResult> {
    const maxIterations = options.maxIterations ?? this.config.maxIterations ?? DEFAULT_MAX_ITERATIONS;
    const startTime = Date.now();

    // Build conversation history — prior turns first, then current user prompt
    const messages: Message[] = [
      ...priorHistory,
      { role: "user", content: userPrompt },
    ];

    logger.info("Agent starting", { prompt: userPrompt.slice(0, 120) });

    let iteration = 0;
    let totalInputTokens = 0;
    let totalOutputTokens = 0;

    while (iteration < maxIterations) {
      iteration++;
      logger.info(`Iteration ${iteration}/${maxIterations}`);

      // ── LLM call ───────────────────────────────────────────────────────────
      const response = await this.provider.complete({
        systemPrompt: this.config.systemPrompt,
        messages,
        tools: this.tools.getToolDefinitions(),
        temperature: options.temperature ?? this.config.temperature ?? 0,
      });

      totalInputTokens += response.usage?.inputTokens ?? 0;
      totalOutputTokens += response.usage?.outputTokens ?? 0;

      logger.debug("LLM response", {
        stopReason: response.stopReason,
        contentBlocks: response.content.length,
      });

      // Append the assistant turn to the conversation history
      messages.push({ role: "assistant", content: response.content });

      // ── Check stop reason ──────────────────────────────────────────────────
      if (response.stopReason === "end_turn" || response.stopReason === "stop") {
        const finalText = response.content
          .filter((b) => b.type === "text")
          .map((b) => b.text ?? "")
          .join("\n")
          .trim();

        logger.info("Agent finished", {
          iterations: iteration,
          durationMs: Date.now() - startTime,
          totalInputTokens,
          totalOutputTokens,
        });

        return {
          success: true,
          output: finalText,
          iterations: iteration,
          durationMs: Date.now() - startTime,
          usage: { inputTokens: totalInputTokens, outputTokens: totalOutputTokens },
        };
      }

      if (response.stopReason !== "tool_use") {
        throw new Error(`Unexpected stop reason: ${response.stopReason}`);
      }

      // ── Execute tool calls ─────────────────────────────────────────────────
      const toolCallBlocks = response.content.filter((b) => b.type === "tool_use") as ToolCall[];

      if (toolCallBlocks.length === 0) {
        throw new Error("Stop reason is tool_use but no tool calls found in response");
      }

      const toolResults: ToolResult[] = [];

      for (const toolCall of toolCallBlocks) {
        logger.info(`Executing tool: ${toolCall.name}`, { id: toolCall.id, input: toolCall.input });

        let result: ToolResult;

        try {
          const output = await this.tools.execute(toolCall.name, toolCall.input);
          result = {
            type: "tool_result",
            tool_use_id: toolCall.id,
            content: output,
          };
          logger.debug(`Tool "${toolCall.name}" succeeded`, { outputLength: output.length });
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : String(err);
          logger.warn(`Tool "${toolCall.name}" failed`, { error: message });
          result = {
            type: "tool_result",
            tool_use_id: toolCall.id,
            content: `ERROR: ${message}`,
            is_error: true,
          };
        }

        toolResults.push(result);
      }

      // Feed tool results back as a "user" message (Anthropic convention)
      messages.push({ role: "user", content: toolResults });
    }

    // ── Max iterations reached ─────────────────────────────────────────────
    logger.warn("Agent hit max iterations limit", { maxIterations });
    return {
      success: false,
      output: "",
      error: `Agent stopped after ${maxIterations} iterations without completing the task`,
      iterations: maxIterations,
      durationMs: Date.now() - startTime,
      usage: { inputTokens: totalInputTokens, outputTokens: totalOutputTokens },
    };
  }
}

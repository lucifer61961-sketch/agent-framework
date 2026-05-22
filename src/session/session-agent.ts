import { Agent } from "../agent";
import { LLMProvider, Message, AgentConfig, AgentRunResult } from "../types";
import { ToolRegistry } from "../tools/registry";
import { SessionStore } from "./store";
import { logger } from "../utils/logger";

/**
 * SessionAgent wraps the core Agent loop with SQLite-backed session persistence.
 *
 * On each `run()` call it:
 *  1. Loads the full conversation history from the database
 *  2. Appends the new user message
 *  3. Runs the agentic loop (which returns the final assistant text)
 *  4. Persists both the user message and the assistant reply to the database
 *
 * This means the LLM always receives the full conversation context,
 * giving it memory across separate Telegram messages.
 */
export class SessionAgent {
  private agent: Agent;
  private store: SessionStore;
  private maxHistoryMessages: number;

  constructor(
    provider: LLMProvider,
    tools: ToolRegistry,
    config: AgentConfig,
    store: SessionStore,
    options: { maxHistoryMessages?: number } = {}
  ) {
    this.agent = new Agent(provider, tools, config);
    this.store = store;
    this.maxHistoryMessages = options.maxHistoryMessages ?? 50;
  }

  async run(sessionId: string, userPrompt: string): Promise<AgentRunResult> {
    // 1. Load history
    let history = this.store.getHistory(sessionId);

    // Trim history to prevent context window overflow while keeping the most recent turns
    if (history.length > this.maxHistoryMessages) {
      history = history.slice(history.length - this.maxHistoryMessages);
      logger.debug(`[SessionAgent] Trimmed history to ${this.maxHistoryMessages} messages for session ${sessionId}`);
    }

    logger.info(`[SessionAgent] Session ${sessionId} — ${history.length} prior message(s)`);

    // 2. Persist the incoming user message immediately
    const userMessage: Message = { role: "user", content: userPrompt };
    this.store.appendMessages(sessionId, [userMessage]);

    // 3. Run the agent loop, injecting history as prior context
    const result = await this.agent.runWithHistory(userPrompt, history);

    // 4. Persist the assistant's final reply
    if (result.output) {
      const assistantMessage: Message = { role: "assistant", content: result.output };
      this.store.appendMessages(sessionId, [assistantMessage]);
    }

    return result;
  }

  clearHistory(sessionId: string) {
    this.store.clearSession(sessionId);
  }
}

// ─── Message shapes ──────────────────────────────────────────────────────────

export type ContentBlock =
  | TextBlock
  | ToolUseBlock
  | ToolResultBlock;

export interface TextBlock {
  type: "text";
  text: string;
}

export interface ToolUseBlock {
  type: "tool_use";
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface ToolResultBlock {
  type: "tool_result";
  tool_use_id: string;
  content: string;
  is_error?: boolean;
}

export interface Message {
  role: "user" | "assistant";
  content: string | ContentBlock[];
}

// ─── Tool shapes ─────────────────────────────────────────────────────────────

export type ToolCall = ToolUseBlock;
export type ToolResult = ToolResultBlock;

export interface ToolDefinition {
  name: string;
  description: string;
  input_schema: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
  };
}

// ─── Provider contract ────────────────────────────────────────────────────────

export interface CompleteOptions {
  systemPrompt: string;
  messages: Message[];
  tools: ToolDefinition[];
  temperature?: number;
}

export interface LLMResponse {
  content: ContentBlock[];
  stopReason: "end_turn" | "tool_use" | "stop" | string;
  usage?: {
    inputTokens: number;
    outputTokens: number;
  };
}

export interface LLMProvider {
  complete(options: CompleteOptions): Promise<LLMResponse>;
}

// ─── Agent config ─────────────────────────────────────────────────────────────

export interface AgentConfig {
  systemPrompt: string;
  maxIterations?: number;
  temperature?: number;
}

export interface AgentRunOptions {
  maxIterations?: number;
  temperature?: number;
}

export interface AgentRunResult {
  success: boolean;
  output: string;
  error?: string;
  iterations: number;
  durationMs: number;
  usage: {
    inputTokens: number;
    outputTokens: number;
  };
}

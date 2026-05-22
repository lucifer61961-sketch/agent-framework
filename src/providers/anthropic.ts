import Anthropic from "@anthropic-ai/sdk";
import { CompleteOptions, LLMProvider, LLMResponse, ContentBlock } from "../types";

export class AnthropicProvider implements LLMProvider {
  private client: Anthropic;
  private model: string;

  constructor(apiKey?: string, model = "claude-opus-4-5") {
    this.client = new Anthropic({ apiKey: apiKey ?? process.env.ANTHROPIC_API_KEY });
    this.model = model;
  }

  async complete(options: CompleteOptions): Promise<LLMResponse> {
    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: 8096,
      system: options.systemPrompt,
      temperature: options.temperature ?? 0,
      tools: options.tools.map((t) => ({
        name: t.name,
        description: t.description,
        input_schema: t.input_schema,
      })),
      // Anthropic requires alternating user/assistant roles and specific
      // content shapes.  We cast here because the SDK types are strict about
      // the union and our generic Message type covers both sides.
      messages: options.messages as Parameters<typeof this.client.messages.create>[0]["messages"],
    });

    const content: ContentBlock[] = response.content.map((block) => {
      if (block.type === "text") return { type: "text", text: block.text };
      if (block.type === "tool_use") {
        return {
          type: "tool_use",
          id: block.id,
          name: block.name,
          input: block.input as Record<string, unknown>,
        };
      }
      throw new Error(`Unknown Anthropic content block type: ${(block as { type: string }).type}`);
    });

    return {
      content,
      stopReason: response.stop_reason ?? "end_turn",
      usage: {
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
      },
    };
  }
}

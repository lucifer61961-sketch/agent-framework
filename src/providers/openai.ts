import OpenAI from "openai";
import { CompleteOptions, LLMProvider, LLMResponse, ContentBlock } from "../types";

export class OpenAIProvider implements LLMProvider {
  private client: OpenAI;
  private model: string;

  constructor(apiKey?: string, model = "gpt-4o") {
    this.client = new OpenAI({ apiKey: apiKey ?? process.env.OPENAI_API_KEY });
    this.model = model;
  }

  async complete(options: CompleteOptions): Promise<LLMResponse> {
    // Convert our generic tool schema to OpenAI function format
    const tools: OpenAI.Chat.ChatCompletionTool[] = options.tools.map((t) => ({
      type: "function",
      function: {
        name: t.name,
        description: t.description,
        parameters: t.input_schema,
      },
    }));

    // Flatten our message history for OpenAI (it uses a flat array with role strings)
    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
      { role: "system", content: options.systemPrompt },
      ...options.messages.flatMap((m): OpenAI.Chat.ChatCompletionMessageParam[] => {
        if (m.role === "assistant") {
          if (typeof m.content === "string") {
            return [{ role: "assistant", content: m.content }];
          }
          // Split assistant turn into text part + tool call part
          const textBlocks = m.content.filter((b) => b.type === "text");
          const toolBlocks = m.content.filter((b) => b.type === "tool_use");

          const assistantMsg: OpenAI.Chat.ChatCompletionAssistantMessageParam = {
            role: "assistant",
            content: textBlocks.map((b) => b.text ?? "").join("\n") || null,
            tool_calls: toolBlocks.map((b) => ({
              id: b.id!,
              type: "function" as const,
              function: {
                name: b.name!,
                arguments: JSON.stringify(b.input ?? {}),
              },
            })),
          };
          return [assistantMsg];
        }

        // user turn – may contain tool results
        if (typeof m.content === "string") {
          return [{ role: "user", content: m.content }];
        }

        // Split into text messages and individual tool result messages
        const results: OpenAI.Chat.ChatCompletionMessageParam[] = [];
        for (const block of m.content) {
          if (block.type === "tool_result") {
            results.push({
              role: "tool",
              tool_call_id: block.tool_use_id!,
              content: block.content ?? "",
            });
          } else if (block.type === "text") {
            results.push({ role: "user", content: block.text ?? "" });
          }
        }
        return results;
      }),
    ];

    const response = await this.client.chat.completions.create({
      model: this.model,
      temperature: options.temperature ?? 0,
      messages,
      tools: tools.length > 0 ? tools : undefined,
      tool_choice: tools.length > 0 ? "auto" : undefined,
    });

    const choice = response.choices[0];
    const content: ContentBlock[] = [];

    if (choice.message.content) {
      content.push({ type: "text", text: choice.message.content });
    }

    for (const call of choice.message.tool_calls ?? []) {
      content.push({
        type: "tool_use",
        id: call.id,
        name: call.function.name,
        input: JSON.parse(call.function.arguments || "{}"),
      });
    }

    const stopReason =
      choice.finish_reason === "tool_calls"
        ? "tool_use"
        : choice.finish_reason === "stop"
        ? "end_turn"
        : choice.finish_reason ?? "end_turn";

    return {
      content,
      stopReason,
      usage: {
        inputTokens: response.usage?.prompt_tokens ?? 0,
        outputTokens: response.usage?.completion_tokens ?? 0,
      },
    };
  }
}

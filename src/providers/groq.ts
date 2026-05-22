import { LLMProvider, LLMResponse, CompleteOptions } from "../types";
import Groq from "groq-sdk";

export class GroqProvider implements LLMProvider {
  private client: Groq;
  private model: string;

  constructor() {
    this.client = new Groq({ apiKey: process.env.GROQ_API_KEY });
    this.model = process.env.GROQ_MODEL ?? "llama-3.3-70b-versatile";
  }

  async complete(options: CompleteOptions): Promise<LLMResponse> {
    const messages = [
      { role: "system" as const, content: options.systemPrompt },
      ...options.messages.map(m => ({
        role: m.role as "user" | "assistant",
        content: typeof m.content === "string"
          ? m.content
          : m.content.map((b: any) =>
              b.type === "text" ? b.text :
              b.type === "tool_result" ? String(b.content) : ""
            ).filter(Boolean).join("\n")
      }))
    ];

    const response = await this.client.chat.completions.create({
      model: this.model,
      messages,
      max_tokens: 8096,
      temperature: options.temperature ?? 0,
    });

    const text = response.choices[0]?.message?.content ?? "";

    return {
      content: [{ type: "text", text }],
      usage: {
        inputTokens: response.usage?.prompt_tokens ?? 0,
        outputTokens: response.usage?.completion_tokens ?? 0,
      },
      stopReason: "end_turn",
    };
  }
}
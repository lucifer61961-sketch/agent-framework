import { LLMProvider, LLMResponse, CompleteOptions } from "../types";
import { GoogleGenerativeAI } from "@google/generative-ai";

export class GeminiProvider implements LLMProvider {
  private client: GoogleGenerativeAI;
  private model: string;

  constructor() {
    this.client = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);
    this.model = process.env.GEMINI_MODEL ?? "gemini-2.0-flash";
  }

  async complete(options: CompleteOptions): Promise<LLMResponse> {
    const model = this.client.getGenerativeModel({
      model: this.model,
      systemInstruction: options.systemPrompt,
    });

    const contents = options.messages
      .map(m => ({
        role: m.role === "assistant" ? "model" : "user",
        parts: [{
          text: typeof m.content === "string"
            ? m.content
            : m.content.map((b: any) =>
                b.type === "text" ? b.text :
                b.type === "tool_result" ? String(b.content) : ""
              ).filter(Boolean).join("\n")
        }],
      }))
      .filter(m => m.parts[0].text.trim().length > 0);

    const result = await model.generateContent({ contents });
    const text = result.response.text();

    return {
      content: [{ type: "text", text }],
      usage: { inputTokens: 0, outputTokens: 0 },
      stopReason: "end_turn",
    };
  }
}
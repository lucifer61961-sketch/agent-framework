/**
 * Example: adding a custom HTTP fetch tool
 * Run: npx tsx examples/custom_tool.ts "What is the current BTC price in USD?"
 */

import {
  Agent,
  AnthropicProvider,
  ToolRegistry,
  ToolDefinition,
  bashToolDefinition, bashToolHandler,
} from "../src/index";

const fetchToolDef: ToolDefinition = {
  name: "http_get",
  description: "Perform an HTTP GET request and return the response body as text.",
  input_schema: {
    type: "object",
    properties: {
      url: { type: "string", description: "URL to fetch." },
    },
    required: ["url"],
  },
};

const tools = new ToolRegistry()
  .register(bashToolDefinition, bashToolHandler)
  .register(fetchToolDef, async (input) => {
    const res = await fetch(input.url as string);
    const text = await res.text();
    return text.slice(0, 5000);
  });

const agent = new Agent(new AnthropicProvider(), tools, {
  systemPrompt: "You are a helpful assistant with access to bash and HTTP tools.",
});

const prompt = process.argv.slice(2).join(" ") || "What is the current BTC price in USD?";

agent.run(prompt).then((r) => {
  console.log(r.success ? r.output : `Failed: ${r.error}`);
});

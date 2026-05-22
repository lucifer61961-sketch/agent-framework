import { ToolDefinition } from "../types";

export type ToolHandler = (input: Record<string, unknown>) => Promise<string>;

interface RegisteredTool {
  definition: ToolDefinition;
  handler: ToolHandler;
}

export class ToolRegistry {
  private tools = new Map<string, RegisteredTool>();

  register(definition: ToolDefinition, handler: ToolHandler): this {
    this.tools.set(definition.name, { definition, handler });
    return this;
  }

  getToolDefinitions(): ToolDefinition[] {
    return [...this.tools.values()].map((t) => t.definition);
  }

  async execute(name: string, input: Record<string, unknown>): Promise<string> {
    const tool = this.tools.get(name);
    if (!tool) throw new Error(`Tool "${name}" is not registered`);
    return tool.handler(input);
  }

  list(): string[] {
    return [...this.tools.keys()];
  }
}

/**
 * Example: Building a custom Calculator skill
 *
 * This shows the minimal boilerplate to create your own skill
 * and plug it into the router alongside the built-in skills.
 *
 * Run: npx tsx examples/custom_skill.ts "What is 1337 * 42? Save the result to math.txt"
 */

import { Agent, AnthropicProvider } from "../src/index";
import { Skill, SkillTool, SkillRouter, FileWriterSkill } from "../src/skills/index";
import { ToolDefinition } from "../src/types";

// ── 1. Implement the Skill interface ──────────────────────────────────────────

class CalculatorSkill implements Skill {
  readonly name = "calculator";
  readonly description = "Evaluate safe mathematical expressions";
  readonly category = "data" as const;
  readonly version = "1.0.0";

  getTools(): SkillTool[] {
    const definition: ToolDefinition = {
      name: "calculate",
      description:
        "Evaluate a mathematical expression and return the numeric result. " +
        "Supports: +, -, *, /, **, %, Math.* functions.",
      input_schema: {
        type: "object",
        properties: {
          expression: {
            type: "string",
            description: 'A JavaScript math expression, e.g. "2 ** 10" or "Math.sqrt(144)".',
          },
        },
        required: ["expression"],
      },
    };

    const handler = async (input: Record<string, unknown>): Promise<string> => {
      const expr = input.expression as string;

      // Very basic allow-list to prevent arbitrary code execution
      if (/[a-zA-Z]/.test(expr.replace(/Math\.\w+/g, ""))) {
        return "ERROR: Expression contains disallowed identifiers.";
      }

      try {
        // eslint-disable-next-line no-new-func
        const result = new Function(`"use strict"; return (${expr})`)();
        return String(result);
      } catch (err: unknown) {
        return `ERROR: ${(err as Error).message}`;
      }
    };

    return [{ definition, handler }];
  }
}

// ── 2. Wire it into a SkillRouter ─────────────────────────────────────────────

async function main() {
  const router = new SkillRouter();
  await router.register(new CalculatorSkill());
  await router.register(new FileWriterSkill({ workspace: "./workspace" }));

  router.printManifest();

  const agent = new Agent(new AnthropicProvider(), router.registry, {
    systemPrompt:
      "You are a helpful agent with calculator and file-writing skills. " +
      "Use them to complete tasks.",
  });

  const prompt =
    process.argv.slice(2).join(" ") ||
    "What is 1337 * 42? Save the result to math.txt with a short explanation.";

  const result = await agent.run(prompt);
  console.log(result.success ? result.output : `Failed: ${result.error}`);
  await router.teardownAll();
}

main().catch(console.error);

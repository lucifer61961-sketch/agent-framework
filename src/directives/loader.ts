import fs from "fs/promises";
import path from "path";
import { logger } from "../utils/logger";

export interface Directives {
  soul: string;
  user: string;
  agents: string;
  /** Pre-assembled system prompt combining all three directives */
  systemPrompt: string;
}

/**
 * Reads the three markdown directive files at startup.
 *
 * Search order for each file:
 *  1. The explicit `directivesDir` argument
 *  2. ./directives  (project root)
 *  3. ../directives (one level up, for when running from src/)
 *
 * If a file is missing a warning is logged and an empty string is used
 * so the agent still starts — the operator can fill in directives later.
 */
export async function loadDirectives(directivesDir?: string): Promise<Directives> {
  const candidates = [
    directivesDir,
    path.resolve(process.cwd(), "directives"),
    path.resolve(__dirname, "../../directives"),
    path.resolve(__dirname, "../../../directives"),
  ].filter(Boolean) as string[];

  async function readFile(filename: string): Promise<string> {
    for (const dir of candidates) {
      const fullPath = path.join(dir, filename);
      try {
        const content = await fs.readFile(fullPath, "utf-8");
        logger.info(`[Directives] Loaded ${filename} from ${fullPath}`);
        return content.trim();
      } catch {
        // try next candidate
      }
    }
    logger.warn(`[Directives] ${filename} not found in any search path — using empty string`);
    return "";
  }

  const [soul, user, agents] = await Promise.all([
    readFile("SOUL.md"),
    readFile("USER.md"),
    readFile("AGENTS.md"),
  ]);

  const systemPrompt = assembleSystemPrompt(soul, user, agents);

  return { soul, user, agents, systemPrompt };
}

function assembleSystemPrompt(soul: string, user: string, agents: string): string {
  const sections: string[] = [];

  if (soul)   sections.push(`## IDENTITY & PERSONA\n\n${soul}`);
  if (user)   sections.push(`## USER CONTEXT & PREFERENCES\n\n${user}`);
  if (agents) sections.push(`## OPERATIONAL RULES\n\n${agents}`);

  if (sections.length === 0) {
    return "You are a helpful autonomous AI agent.";
  }

  return sections.join("\n\n---\n\n");
}

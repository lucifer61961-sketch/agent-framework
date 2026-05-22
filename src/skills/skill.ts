import { ToolDefinition } from "../types";
import { ToolHandler } from "../tools/registry";

/**
 * A Skill is a self-contained, named capability that the agent can invoke.
 *
 * Each skill exposes:
 *  - metadata (name, description, category, version)
 *  - one or more tool definitions (what the LLM sees)
 *  - corresponding handlers (what actually runs on the machine)
 *  - an optional lifecycle: initialize() / teardown()
 *
 * The SkillRouter collects all registered skills and flattens their tools
 * into the ToolRegistry so the agent loop needs no changes.
 */
export interface Skill {
  /** Unique machine-readable identifier, e.g. "google_search" */
  readonly name: string;

  /** Human-readable summary shown in the router's skill manifest */
  readonly description: string;

  /** Logical grouping, e.g. "web", "filesystem", "code", "data" */
  readonly category: SkillCategory;

  /** Semver string for the skill */
  readonly version: string;

  /**
   * Returns all tool definitions this skill contributes.
   * A skill may expose more than one tool (e.g. a filesystem skill
   * might expose read_file AND write_file AND delete_file).
   */
  getTools(): SkillTool[];

  /**
   * Called once when the skill is registered with the router.
   * Use for async setup: validating API keys, creating directories, etc.
   */
  initialize?(): Promise<void>;

  /**
   * Called when the agent session ends or the router is torn down.
   * Use for cleanup: closing connections, flushing buffers, etc.
   */
  teardown?(): Promise<void>;
}

export interface SkillTool {
  definition: ToolDefinition;
  handler: ToolHandler;
}

export type SkillCategory =
  | "web"
  | "filesystem"
  | "code"
  | "data"
  | "communication"
  | "system"
  | "custom";

/** Snapshot returned by SkillRouter.inspect() */
export interface SkillManifest {
  name: string;
  description: string;
  category: SkillCategory;
  version: string;
  tools: string[];
}

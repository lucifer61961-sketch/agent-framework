import { Skill, SkillManifest } from "./skill";
import { ToolRegistry } from "../tools/registry";
import { ToolDefinition } from "../types";
import { logger } from "../utils/logger";

/**
 * SkillRouter
 *
 * The single point of truth for which capabilities the agent has.
 * It owns a ToolRegistry and populates it by iterating over every
 * registered Skill's tools.
 *
 * Usage:
 *   const router = new SkillRouter();
 *   await router.register(new GoogleSearchSkill({ apiKey, cx }));
 *   await router.register(new FileWriterSkill({ workspace: "./workspace" }));
 *
 *   // Pass the underlying registry to the Agent
 *   const agent = new Agent(provider, router.registry, config);
 */
export class SkillRouter {
  /** Exposed so the Agent can read tool definitions & execute tools */
  public readonly registry: ToolRegistry;

  private skills = new Map<string, Skill>();

  constructor() {
    this.registry = new ToolRegistry();
  }

  /**
   * Register a skill.
   * Calls initialize() if defined, then wires all tools into the registry.
   * Throws if two skills try to register the same tool name.
   */
  async register(skill: Skill): Promise<this> {
    if (this.skills.has(skill.name)) {
      throw new Error(`Skill "${skill.name}" is already registered`);
    }

    // Lifecycle hook
    if (skill.initialize) {
      logger.info(`[SkillRouter] Initializing skill: ${skill.name}`);
      await skill.initialize();
    }

    // Wire every tool the skill exposes
    for (const { definition, handler } of skill.getTools()) {
      logger.debug(`[SkillRouter] Registering tool "${definition.name}" from skill "${skill.name}"`);
      this.registry.register(definition, handler);
    }

    this.skills.set(skill.name, skill);
    logger.info(`[SkillRouter] Skill registered: ${skill.name} v${skill.version}`);
    return this;
  }

  /**
   * Unregister a skill and call its teardown() if defined.
   * Note: tools already wired into the registry are NOT removed (registry
   * doesn't support removal). Rebuild a new SkillRouter if you need a clean slate.
   */
  async unregister(skillName: string): Promise<void> {
    const skill = this.skills.get(skillName);
    if (!skill) throw new Error(`Skill "${skillName}" is not registered`);
    if (skill.teardown) await skill.teardown();
    this.skills.delete(skillName);
    logger.info(`[SkillRouter] Skill unregistered: ${skillName}`);
  }

  /** Tear down all skills in reverse-registration order */
  async teardownAll(): Promise<void> {
    const names = [...this.skills.keys()].reverse();
    for (const name of names) await this.unregister(name);
  }

  /** Returns a summary of every registered skill and its tools */
  inspect(): SkillManifest[] {
    return [...this.skills.values()].map((s) => ({
      name: s.name,
      description: s.description,
      category: s.category,
      version: s.version,
      tools: s.getTools().map((t) => t.definition.name),
    }));
  }

  /** Pretty-print the skill manifest to stdout */
  printManifest(): void {
    const manifests = this.inspect();
    console.log("\n╔══════════════════════════════════════════╗");
    console.log("║          SKILL ROUTER  MANIFEST          ║");
    console.log("╠══════════════════════════════════════════╣");
    for (const m of manifests) {
      console.log(`║  📦 ${m.name.padEnd(36)}║`);
      console.log(`║     ${m.description.slice(0, 36).padEnd(36)}║`);
      console.log(`║     category: ${m.category.padEnd(27)}║`);
      console.log(`║     tools:    ${m.tools.join(", ").slice(0, 27).padEnd(27)}║`);
      console.log("║                                          ║");
    }
    console.log("╚══════════════════════════════════════════╝\n");
  }

  /** Returns all tool definitions across every registered skill */
  getAllToolDefinitions(): ToolDefinition[] {
    return this.registry.getToolDefinitions();
  }

  hasSkill(name: string): boolean {
    return this.skills.has(name);
  }
}

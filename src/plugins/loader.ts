import path from "path";
import fs from "fs/promises";
import { Skill } from "../skills/skill";
import { SkillRouter } from "../skills/router";
import { logger } from "../utils/logger";

/**
 * Plugin manifest shape expected in a plugin's package.json.
 *
 * Example package.json for a community plugin:
 * {
 *   "name": "agent-plugin-calculator",
 *   "version": "1.0.0",
 *   "agentPlugin": {
 *     "entry": "./dist/index.js",
 *     "skillExport": "CalculatorSkill"
 *   }
 * }
 */
export interface PluginManifest {
  name: string;
  version: string;
  agentPlugin?: {
    entry: string;
    skillExport: string;
    config?: Record<string, unknown>;
  };
}

export interface LoadedPlugin {
  packageName: string;
  version: string;
  skillName: string;
}

/**
 * PluginLoader
 *
 * Scans node_modules for packages with an "agentPlugin" field in their
 * package.json, dynamically imports the entry file, instantiates the
 * exported Skill class, and registers it with the SkillRouter.
 *
 * Plugin packages should follow the naming convention:
 *   agent-plugin-<name>
 *
 * But any package with an "agentPlugin" manifest field will be loaded.
 */
export class PluginLoader {
  private router: SkillRouter;
  private nodeModulesPath: string;
  private loaded: LoadedPlugin[] = [];

  constructor(router: SkillRouter, nodeModulesPath?: string) {
    this.router = router;
    this.nodeModulesPath =
      nodeModulesPath ?? path.resolve(process.cwd(), "node_modules");
  }

  /**
   * Scan node_modules and auto-load all agent plugins.
   * Returns a list of successfully loaded plugins.
   */
  async autoload(): Promise<LoadedPlugin[]> {
    logger.info("[PluginLoader] Scanning node_modules for agent plugins…");

    let entries: string[];
    try {
      entries = await fs.readdir(this.nodeModulesPath);
    } catch {
      logger.warn(`[PluginLoader] node_modules not found at ${this.nodeModulesPath}`);
      return [];
    }

    // Also check scoped packages (@scope/agent-plugin-*)
    const allCandidates: string[] = [];
    for (const entry of entries) {
      if (entry.startsWith("agent-plugin-")) {
        allCandidates.push(entry);
      }
      if (entry.startsWith("@")) {
        try {
          const scoped = await fs.readdir(path.join(this.nodeModulesPath, entry));
          for (const sub of scoped) {
            if (sub.startsWith("agent-plugin-")) {
              allCandidates.push(`${entry}/${sub}`);
            }
          }
        } catch { /* not a directory */ }
      }
    }

    logger.info(`[PluginLoader] Found ${allCandidates.length} plugin candidate(s): ${allCandidates.join(", ") || "none"}`);

    for (const pkg of allCandidates) {
      await this._tryLoad(pkg);
    }

    return this.loaded;
  }

  /**
   * Manually load a specific plugin by package name.
   * Useful when you want explicit control over which plugins are loaded.
   */
  async load(packageName: string, config?: Record<string, unknown>): Promise<void> {
    await this._tryLoad(packageName, config);
  }

  private async _tryLoad(packageName: string, overrideConfig?: Record<string, unknown>) {
    const pkgJsonPath = path.join(this.nodeModulesPath, packageName, "package.json");

    let manifest: PluginManifest;
    try {
      const raw = await fs.readFile(pkgJsonPath, "utf-8");
      manifest = JSON.parse(raw) as PluginManifest;
    } catch {
      return; // not a valid package
    }

    if (!manifest.agentPlugin) return; // not a plugin

    const { entry, skillExport, config: defaultConfig } = manifest.agentPlugin;
    const config = overrideConfig ?? defaultConfig ?? {};

    try {
      const entryPath = path.join(this.nodeModulesPath, packageName, entry);
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const mod = require(entryPath) as Record<string, unknown>;

      const SkillClass = mod[skillExport] as new (config: Record<string, unknown>) => Skill;
      if (typeof SkillClass !== "function") {
        throw new Error(`Export "${skillExport}" is not a constructor`);
      }

      const instance = new SkillClass(config);
      await this.router.register(instance);

      const loaded: LoadedPlugin = {
        packageName,
        version: manifest.version,
        skillName: instance.name,
      };
      this.loaded.push(loaded);
      logger.info(`[PluginLoader] ✅ Loaded plugin "${packageName}" → skill "${instance.name}"`);
    } catch (err: unknown) {
      logger.warn(
        `[PluginLoader] ❌ Failed to load plugin "${packageName}": ${(err as Error).message}`
      );
    }
  }

  /** Returns all successfully loaded plugins this session */
  getLoaded(): LoadedPlugin[] {
    return [...this.loaded];
  }
}

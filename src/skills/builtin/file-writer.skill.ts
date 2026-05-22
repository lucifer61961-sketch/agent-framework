import fs from "fs/promises";
import path from "path";
import { Skill, SkillTool } from "../skill";
import { ToolDefinition } from "../../types";
import { logger } from "../../utils/logger";

// ─── Config ───────────────────────────────────────────────────────────────────

export interface FileWriterSkillConfig {
  /**
   * Absolute or relative path to the workspace directory.
   * All file operations are sandboxed inside this folder.
   * Default: "./workspace"
   */
  workspace?: string;

  /**
   * Allowed file extensions (without the dot).
   * Default: ["txt", "md"]
   */
  allowedExtensions?: string[];

  /**
   * Maximum file size the skill will write, in bytes.
   * Default: 1 MB
   */
  maxFileSizeBytes?: number;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function sanitizePath(workspace: string, userPath: string): string {
  // Strip leading slashes / drive letters so the user can't escape the workspace
  const relative = userPath.replace(/^[/\\]+/, "").replace(/^[a-zA-Z]:/, "");
  const resolved = path.resolve(workspace, relative);

  // Prevent path traversal
  if (!resolved.startsWith(path.resolve(workspace))) {
    throw new Error(
      `Path traversal detected: "${userPath}" resolves outside workspace`
    );
  }
  return resolved;
}

function checkExtension(filePath: string, allowed: string[]): void {
  const ext = path.extname(filePath).replace(".", "").toLowerCase();
  if (!allowed.includes(ext)) {
    throw new Error(
      `File type ".${ext}" is not allowed. Permitted: ${allowed.map((e) => `.${e}`).join(", ")}`
    );
  }
}

// ─── Skill ────────────────────────────────────────────────────────────────────

export class FileWriterSkill implements Skill {
  readonly name = "file_writer";
  readonly description =
    "Create, read, overwrite, and patch .txt / .md files inside a sandboxed workspace folder";
  readonly category = "filesystem" as const;
  readonly version = "1.0.0";

  private workspace: string;
  private allowedExtensions: string[];
  private maxFileSizeBytes: number;

  constructor(config: FileWriterSkillConfig = {}) {
    this.workspace = path.resolve(config.workspace ?? "./workspace");
    this.allowedExtensions = config.allowedExtensions ?? ["txt", "md"];
    this.maxFileSizeBytes = config.maxFileSizeBytes ?? 1024 * 1024; // 1 MB
  }

  async initialize(): Promise<void> {
    await fs.mkdir(this.workspace, { recursive: true });
    logger.info(`[FileWriterSkill] Workspace ready: ${this.workspace}`);
  }

  getTools(): SkillTool[] {
    return [
      this._writeFileTool(),
      this._readFileTool(),
      this._patchFileTool(),
      this._listFilesTool(),
      this._deleteFileTool(),
    ];
  }

  // ── write_file ─────────────────────────────────────────────────────────────

  private _writeFileTool(): SkillTool {
    const definition: ToolDefinition = {
      name: "write_file",
      description: `Create a new file or completely overwrite an existing file in the workspace.
Allowed extensions: ${this.allowedExtensions.map((e) => `.${e}`).join(", ")}.
The file path is relative to the workspace root.
Use patch_file to make targeted edits to an existing file.`,
      input_schema: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: 'Relative path inside the workspace, e.g. "notes/summary.md".',
          },
          content: {
            type: "string",
            description: "Full content to write. Existing content will be replaced.",
          },
        },
        required: ["path", "content"],
      },
    };

    const handler = async (input: Record<string, unknown>): Promise<string> => {
      const filePath = sanitizePath(this.workspace, input.path as string);
      checkExtension(filePath, this.allowedExtensions);

      const content = input.content as string;
      if (Buffer.byteLength(content, "utf-8") > this.maxFileSizeBytes) {
        return `ERROR: Content exceeds max file size (${this.maxFileSizeBytes} bytes)`;
      }

      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.writeFile(filePath, content, "utf-8");

      const relativePath = path.relative(this.workspace, filePath);
      logger.info(`[FileWriterSkill] Wrote: ${relativePath}`);
      return `OK: Wrote ${Buffer.byteLength(content, "utf-8")} bytes to "${relativePath}"`;
    };

    return { definition, handler };
  }

  // ── read_file ──────────────────────────────────────────────────────────────

  private _readFileTool(): SkillTool {
    const definition: ToolDefinition = {
      name: "read_file",
      description: "Read the full content of a file from the workspace.",
      input_schema: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "Relative path inside the workspace.",
          },
        },
        required: ["path"],
      },
    };

    const handler = async (input: Record<string, unknown>): Promise<string> => {
      const filePath = sanitizePath(this.workspace, input.path as string);
      checkExtension(filePath, this.allowedExtensions);

      try {
        const content = await fs.readFile(filePath, "utf-8");
        const relativePath = path.relative(this.workspace, filePath);
        return `──── ${relativePath} ────\n${content}`;
      } catch (err: unknown) {
        if ((err as NodeJS.ErrnoException).code === "ENOENT") {
          return `ERROR: File not found: "${path.relative(this.workspace, filePath)}"`;
        }
        throw err;
      }
    };

    return { definition, handler };
  }

  // ── patch_file ─────────────────────────────────────────────────────────────

  private _patchFileTool(): SkillTool {
    const definition: ToolDefinition = {
      name: "patch_file",
      description: `Make targeted text replacements in an existing file without rewriting the whole thing.
Finds the first occurrence of 'old_text' and replaces it with 'new_text'.
Fails if 'old_text' is not found — use read_file first to confirm the exact text.`,
      input_schema: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "Relative path inside the workspace.",
          },
          old_text: {
            type: "string",
            description: "The exact text to find and replace.",
          },
          new_text: {
            type: "string",
            description: "The text to insert in place of old_text.",
          },
        },
        required: ["path", "old_text", "new_text"],
      },
    };

    const handler = async (input: Record<string, unknown>): Promise<string> => {
      const filePath = sanitizePath(this.workspace, input.path as string);
      checkExtension(filePath, this.allowedExtensions);

      const oldText = input.old_text as string;
      const newText = input.new_text as string;

      let content: string;
      try {
        content = await fs.readFile(filePath, "utf-8");
      } catch {
        return `ERROR: File not found: "${path.relative(this.workspace, filePath)}"`;
      }

      if (!content.includes(oldText)) {
        return `ERROR: old_text not found in file. Use read_file to check the current content.`;
      }

      const patched = content.replace(oldText, newText);
      await fs.writeFile(filePath, patched, "utf-8");

      const relativePath = path.relative(this.workspace, filePath);
      logger.info(`[FileWriterSkill] Patched: ${relativePath}`);
      return `OK: Patch applied to "${relativePath}"`;
    };

    return { definition, handler };
  }

  // ── list_files ─────────────────────────────────────────────────────────────

  private _listFilesTool(): SkillTool {
    const definition: ToolDefinition = {
      name: "list_files",
      description: "List all files currently in the workspace (or a subdirectory of it).",
      input_schema: {
        type: "object",
        properties: {
          subdirectory: {
            type: "string",
            description: 'Optional subdirectory to list, e.g. "notes". Defaults to workspace root.',
          },
        },
      },
    };

    const handler = async (input: Record<string, unknown>): Promise<string> => {
      const sub = input.subdirectory as string | undefined;
      const dirPath = sub
        ? sanitizePath(this.workspace, sub)
        : this.workspace;

      const lines: string[] = [];
      await walk(dirPath, this.workspace, lines, this.allowedExtensions);

      if (lines.length === 0) return "Workspace is empty.";
      return lines.join("\n");
    };

    return { definition, handler };
  }

  // ── delete_file ────────────────────────────────────────────────────────────

  private _deleteFileTool(): SkillTool {
    const definition: ToolDefinition = {
      name: "delete_file",
      description: "Permanently delete a file from the workspace.",
      input_schema: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "Relative path inside the workspace.",
          },
        },
        required: ["path"],
      },
    };

    const handler = async (input: Record<string, unknown>): Promise<string> => {
      const filePath = sanitizePath(this.workspace, input.path as string);
      checkExtension(filePath, this.allowedExtensions);

      try {
        await fs.unlink(filePath);
        const relativePath = path.relative(this.workspace, filePath);
        logger.info(`[FileWriterSkill] Deleted: ${relativePath}`);
        return `OK: Deleted "${relativePath}"`;
      } catch (err: unknown) {
        if ((err as NodeJS.ErrnoException).code === "ENOENT") {
          return `ERROR: File not found.`;
        }
        throw err;
      }
    };

    return { definition, handler };
  }
}

// ─── Directory walker ─────────────────────────────────────────────────────────

async function walk(
  dir: string,
  workspace: string,
  lines: string[],
  allowed: string[]
): Promise<void> {
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await walk(full, workspace, lines, allowed);
    } else {
      const ext = path.extname(entry.name).replace(".", "").toLowerCase();
      if (allowed.includes(ext)) {
        lines.push(path.relative(workspace, full));
      }
    }
  }
}

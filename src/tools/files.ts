import fs from "fs/promises";
import path from "path";
import { ToolDefinition } from "../types";
import { ToolHandler } from "./registry";

const MAX_READ_CHARS = 20_000;

// ─── read_file ────────────────────────────────────────────────────────────────

export const readFileToolDefinition: ToolDefinition = {
  name: "read_file",
  description: "Read the contents of a file on the local filesystem. Returns the file contents as a string.",
  input_schema: {
    type: "object",
    properties: {
      path: { type: "string", description: "Absolute or relative path to the file." },
      encoding: {
        type: "string",
        description: "File encoding (default: utf-8). Use 'base64' for binary files.",
      },
    },
    required: ["path"],
  },
};

export const readFileToolHandler: ToolHandler = async (input) => {
  const filePath = path.resolve(input.path as string);
  const encoding = (input.encoding as BufferEncoding | undefined) ?? "utf-8";
  try {
    const content = await fs.readFile(filePath, encoding);
    if (typeof content === "string" && content.length > MAX_READ_CHARS) {
      return content.slice(0, MAX_READ_CHARS) + "\n…[file truncated]";
    }
    return typeof content === "string" ? content : content.toString();
  } catch (err: unknown) {
    return `ERROR reading file: ${(err as Error).message}`;
  }
};

// ─── write_file ───────────────────────────────────────────────────────────────

export const writeFileToolDefinition: ToolDefinition = {
  name: "write_file",
  description: "Write content to a file on the local filesystem. Creates the file (and any missing parent directories) if it does not exist.",
  input_schema: {
    type: "object",
    properties: {
      path: { type: "string", description: "Absolute or relative path where the file should be written." },
      content: { type: "string", description: "The content to write into the file." },
      append: {
        type: "boolean",
        description: "If true, append to the file instead of overwriting it (default: false).",
      },
    },
    required: ["path", "content"],
  },
};

export const writeFileToolHandler: ToolHandler = async (input) => {
  const filePath = path.resolve(input.path as string);
  const content = input.content as string;
  const append = Boolean(input.append);
  try {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    if (append) {
      await fs.appendFile(filePath, content, "utf-8");
    } else {
      await fs.writeFile(filePath, content, "utf-8");
    }
    return `OK: ${append ? "Appended" : "Wrote"} ${content.length} characters to ${filePath}`;
  } catch (err: unknown) {
    return `ERROR writing file: ${(err as Error).message}`;
  }
};

// ─── list_directory ───────────────────────────────────────────────────────────

export const listDirToolDefinition: ToolDefinition = {
  name: "list_directory",
  description: "List the contents of a directory.",
  input_schema: {
    type: "object",
    properties: {
      path: { type: "string", description: "Directory to list (default: current working directory)." },
    },
  },
};

export const listDirToolHandler: ToolHandler = async (input) => {
  const dirPath = path.resolve((input.path as string | undefined) ?? process.cwd());
  try {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    const lines = entries.map((e) => `${e.isDirectory() ? "d" : "f"} ${e.name}`);
    return lines.join("\n") || "(empty directory)";
  } catch (err: unknown) {
    return `ERROR listing directory: ${(err as Error).message}`;
  }
};

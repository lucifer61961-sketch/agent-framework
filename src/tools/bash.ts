import { exec } from "child_process";
import { promisify } from "util";
import path from "path";
import { ToolDefinition } from "../types";
import { ToolHandler } from "./registry";

const execAsync = promisify(exec);

// Maximum characters captured from stdout/stderr to keep context windows sane
const MAX_OUTPUT_CHARS = 10_000;

/** Blocks commands that are irreversibly destructive. */
const BLOCKED_PATTERNS = [
  /rm\s+-rf\s+\//,            // rm -rf /
  /mkfs/,                     // format filesystem
  /dd\s+if=\/dev\/zero/,      // wipe device
  />\s*\/dev\/sd[a-z]/,       // write to disk device
  /shutdown|reboot|halt/,     // system shutdown
  /:(){ :|:& };:/,            // fork bomb
];

function isSafeCommand(cmd: string): { safe: boolean; reason?: string } {
  for (const pattern of BLOCKED_PATTERNS) {
    if (pattern.test(cmd)) {
      return { safe: false, reason: `Command matches blocked pattern: ${pattern}` };
    }
  }
  return { safe: true };
}

export const bashToolDefinition: ToolDefinition = {
  name: "bash",
  description: `Execute a bash command or short shell script on the local machine.
Use this to: run programs, read/write files, install packages, query APIs via curl, compile code, etc.
- Working directory defaults to the process cwd unless you specify otherwise.
- stdout and stderr are both captured and returned.
- Commands time out after 30 seconds.
- Avoid interactive commands (they will hang).`,
  input_schema: {
    type: "object",
    properties: {
      command: {
        type: "string",
        description: "The bash command or script to run.",
      },
      cwd: {
        type: "string",
        description: "Working directory for the command (optional).",
      },
      timeout: {
        type: "number",
        description: "Timeout in seconds (default: 30, max: 120).",
      },
    },
    required: ["command"],
  },
};

export const bashToolHandler: ToolHandler = async (input) => {
  const command = input.command as string;
  const cwd = (input.cwd as string | undefined) ?? process.cwd();
  const timeoutSec = Math.min(Number(input.timeout ?? 30), 120);

  // Safety gate
  const safety = isSafeCommand(command);
  if (!safety.safe) {
    return `BLOCKED: ${safety.reason}`;
  }

  // Resolve and validate working directory
  const resolvedCwd = path.resolve(cwd);

  try {
    const { stdout, stderr } = await execAsync(command, {
      cwd: resolvedCwd,
      timeout: timeoutSec * 1000,
      maxBuffer: 1024 * 1024 * 10, // 10 MB raw buffer
      shell: "/bin/bash",
    });

    const parts: string[] = [];
    if (stdout) parts.push(`STDOUT:\n${stdout.slice(0, MAX_OUTPUT_CHARS)}`);
    if (stderr) parts.push(`STDERR:\n${stderr.slice(0, MAX_OUTPUT_CHARS)}`);

    const combined = parts.join("\n\n") || "(no output)";
    const truncated = combined.length > MAX_OUTPUT_CHARS;
    return truncated ? combined.slice(0, MAX_OUTPUT_CHARS) + "\n…[output truncated]" : combined;
  } catch (err: unknown) {
    if (err && typeof err === "object" && "killed" in err && (err as NodeJS.ErrnoException & { killed?: boolean }).killed) {
      return `ERROR: Command timed out after ${timeoutSec}s`;
    }
    const e = err as { stdout?: string; stderr?: string; message?: string };
    const out = e.stdout ? `\nSTDOUT:\n${e.stdout}` : "";
    const errOut = e.stderr ? `\nSTDERR:\n${e.stderr}` : "";
    return `ERROR: ${e.message ?? String(err)}${out}${errOut}`;
  }
};

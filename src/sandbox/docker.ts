import { exec } from "child_process";
import { promisify } from "util";
import { logger } from "../utils/logger";

const execAsync = promisify(exec);

export interface SandboxConfig {
  /**
   * Docker image to use for the sandbox container.
   * Must have bash. A minimal image like "alpine" or "ubuntu:22.04" works.
   * Default: "alpine:latest"
   */
  image?: string;

  /**
   * Memory limit for the container (Docker --memory flag).
   * Default: "256m"
   */
  memory?: string;

  /**
   * CPU share weight (Docker --cpus flag).
   * Default: "0.5" (half a core)
   */
  cpus?: string;

  /**
   * Maximum wall-clock seconds the container is allowed to run.
   * Default: 30
   */
  timeoutSeconds?: number;

  /**
   * Maximum characters of combined stdout+stderr to return.
   * Default: 10000
   */
  maxOutputChars?: number;

  /**
   * If true, the container has no network access (--network none).
   * Default: true (network disabled)
   */
  noNetwork?: boolean;
}

const BLOCKED_PATTERNS = [
  /rm\s+-rf\s+\//,
  /mkfs/,
  /dd\s+if=\/dev\/zero/,
  /shutdown|reboot|halt/,
  /:(){ :|:& };:/,
];

export class DockerSandbox {
  private image: string;
  private memory: string;
  private cpus: string;
  private timeoutSeconds: number;
  private maxOutputChars: number;
  private noNetwork: boolean;

  constructor(config: SandboxConfig = {}) {
    this.image = config.image ?? "alpine:latest";
    this.memory = config.memory ?? "256m";
    this.cpus = config.cpus ?? "0.5";
    this.timeoutSeconds = config.timeoutSeconds ?? 30;
    this.maxOutputChars = config.maxOutputChars ?? 10_000;
    this.noNetwork = config.noNetwork ?? true;
  }

  /** Verify Docker is available on the host */
  async isAvailable(): Promise<boolean> {
    try {
      await execAsync("docker info --format '{{.ServerVersion}}'");
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Execute a bash command inside an isolated Docker container.
   *
   * Security properties:
   *  - Ephemeral container (--rm): destroyed immediately after execution
   *  - Read-only root filesystem (--read-only): no persistent writes
   *  - No new privileges (--security-opt no-new-privileges)
   *  - Dropped all Linux capabilities (--cap-drop ALL)
   *  - Optional network isolation (--network none)
   *  - Memory + CPU limits
   *  - Non-root user (--user nobody)
   */
  async execute(command: string, cwd?: string): Promise<string> {
    // Pre-flight safety check
    for (const pattern of BLOCKED_PATTERNS) {
      if (pattern.test(command)) {
        return `BLOCKED: Command matches safety blocklist pattern: ${pattern}`;
      }
    }

    // Escape the command for shell injection safety when passing to docker run
    const escapedCommand = command.replace(/'/g, `'\\''`);

    const networkFlag = this.noNetwork ? "--network none" : "";
    const cwdFlag = cwd ? `--workdir /sandbox` : "";

    const dockerCmd = [
      "docker run --rm",
      "--read-only",
      "--tmpfs /tmp:rw,noexec,nosuid,size=64m",
      "--security-opt no-new-privileges",
      "--cap-drop ALL",
      `--memory ${this.memory}`,
      `--cpus ${this.cpus}`,
      "--user nobody",
      networkFlag,
      cwdFlag,
      this.image,
      `sh -c '${escapedCommand}'`,
    ]
      .filter(Boolean)
      .join(" ");

    logger.info(`[DockerSandbox] Executing in container (image: ${this.image})`);
    logger.debug(`[DockerSandbox] Command: ${command.slice(0, 200)}`);

    try {
      const { stdout, stderr } = await execAsync(dockerCmd, {
        timeout: this.timeoutSeconds * 1000,
        maxBuffer: 1024 * 1024 * 10,
      });

      const parts: string[] = [];
      if (stdout) parts.push(`STDOUT:\n${stdout}`);
      if (stderr) parts.push(`STDERR:\n${stderr}`);
      const combined = parts.join("\n\n") || "(no output)";

      return combined.length > this.maxOutputChars
        ? combined.slice(0, this.maxOutputChars) + "\n…[truncated]"
        : combined;
    } catch (err: unknown) {
      const e = err as { killed?: boolean; stdout?: string; stderr?: string; message?: string };

      if (e.killed) {
        return `ERROR: Container timed out after ${this.timeoutSeconds}s`;
      }

      const out = e.stdout ? `\nSTDOUT:\n${e.stdout}` : "";
      const errOut = e.stderr ? `\nSTDERR:\n${e.stderr}` : "";
      return `ERROR: ${e.message ?? String(err)}${out}${errOut}`;
    }
  }
}

/**
 * Build a sandboxed bash tool handler that wraps DockerSandbox.
 * Drop-in replacement for the host bash tool handler.
 */
export function createSandboxedBashHandler(sandbox: DockerSandbox) {
  return async (input: Record<string, unknown>): Promise<string> => {
    const command = input.command as string;
    const cwd = input.cwd as string | undefined;
    return sandbox.execute(command, cwd);
  };
}

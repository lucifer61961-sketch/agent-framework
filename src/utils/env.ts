/**
 * Minimal .env loader — no dotenv dependency required.
 * Reads .env from the current working directory and populates process.env.
 */
import fs from "fs";
import path from "path";

export function config(envPath?: string): void {
  const filePath = envPath ?? path.resolve(process.cwd(), ".env");
  if (!fs.existsSync(filePath)) return;

  const lines = fs.readFileSync(filePath, "utf-8").split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const val = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, "");
    if (key && !(key in process.env)) {
      process.env[key] = val;
    }
  }
}

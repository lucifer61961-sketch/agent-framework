/**
 * Image & Document handler
 *
 * Images   → downloaded and sent to the LLM as base64 vision content
 * Documents → downloaded, text extracted (for .txt/.md/.csv/code), and
 *             injected as context into the user's prompt
 */
import { TelegramClient, TelegramPhotoSize, TelegramDocument } from "../telegram-client";
import { logger } from "../../utils/logger";

const MAX_DOC_BYTES = 500_000; // 500 KB text extraction limit
const SUPPORTED_TEXT_TYPES = new Set([
  "text/plain", "text/markdown", "text/csv", "text/html",
  "application/json", "application/javascript",
  "text/x-python", "text/x-typescript",
  "application/x-sh",
]);

// ─── Image handling ───────────────────────────────────────────────────────────

export interface ImageContext {
  base64: string;
  mimeType: "image/jpeg" | "image/png" | "image/webp" | "image/gif";
}

export async function downloadImage(
  photos: TelegramPhotoSize[],
  telegram: TelegramClient
): Promise<ImageContext | null> {
  if (!photos.length) return null;

  // Pick highest resolution
  const best = photos.reduce((a, b) => (a.file_size ?? 0) > (b.file_size ?? 0) ? a : b);

  try {
    const { buffer, filePath } = await telegram.getFileBuffer(best.file_id);
    const ext = filePath.split(".").pop()?.toLowerCase() ?? "jpg";
    const mimeType = ext === "png" ? "image/png"
      : ext === "webp" ? "image/webp"
      : ext === "gif"  ? "image/gif"
      : "image/jpeg";

    logger.info(`[MediaHandler] Downloaded image ${buffer.byteLength} bytes`);
    return { base64: buffer.toString("base64"), mimeType };
  } catch (err) {
    logger.warn(`[MediaHandler] Image download failed: ${(err as Error).message}`);
    return null;
  }
}

// ─── Document handling ────────────────────────────────────────────────────────

export interface DocumentContext {
  filename: string;
  content: string;  // extracted text
  mimeType: string;
}

export async function downloadDocument(
  doc: TelegramDocument,
  telegram: TelegramClient
): Promise<DocumentContext | null> {
  if (!doc.file_size || doc.file_size > MAX_DOC_BYTES) {
    logger.warn(`[MediaHandler] Document too large (${doc.file_size} bytes)`);
    return null;
  }

  const mimeType = doc.mime_type ?? "application/octet-stream";
  const filename = doc.file_name ?? "document";

  if (!SUPPORTED_TEXT_TYPES.has(mimeType) && !isTextByExtension(filename)) {
    logger.info(`[MediaHandler] Unsupported document type: ${mimeType}`);
    return null;
  }

  try {
    const { buffer } = await telegram.getFileBuffer(doc.file_id);
    const content = buffer.toString("utf-8");
    logger.info(`[MediaHandler] Extracted ${content.length} chars from ${filename}`);
    return { filename, content, mimeType };
  } catch (err) {
    logger.warn(`[MediaHandler] Document download failed: ${(err as Error).message}`);
    return null;
  }
}

function isTextByExtension(filename: string): boolean {
  const ext = filename.split(".").pop()?.toLowerCase();
  return ["txt", "md", "csv", "json", "js", "ts", "py", "sh", "yaml", "yml", "toml", "env", "log", "html", "css"].includes(ext ?? "");
}

// ─── Build enriched prompt ────────────────────────────────────────────────────

export function buildEnrichedPrompt(
  originalText: string,
  doc?: DocumentContext | null
): string {
  if (!doc) return originalText;

  const MAX_CONTENT = 8000;
  const truncated = doc.content.length > MAX_CONTENT
    ? doc.content.slice(0, MAX_CONTENT) + "\n…[truncated]"
    : doc.content;

  return `${originalText}\n\n--- Attached file: ${doc.filename} ---\n${truncated}`;
}

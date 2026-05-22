/**
 * Voice message handler
 * Downloads the OGG audio from Telegram, sends it to OpenAI Whisper for
 * transcription, then returns the text so it can be fed into the agent.
 *
 * Falls back gracefully if no OpenAI key is configured.
 */
import { TelegramClient, TelegramVoice, TelegramAudio } from "../telegram-client";
import { logger } from "../../utils/logger";

const WHISPER_API = "https://api.openai.com/v1/audio/transcriptions";

export async function transcribeVoice(
  fileId: string,
  telegram: TelegramClient,
  openAiKey?: string
): Promise<string | null> {
  const key = openAiKey ?? process.env.OPENAI_API_KEY;
  if (!key) {
    logger.warn("[VoiceHandler] No OPENAI_API_KEY — cannot transcribe voice");
    return null;
  }

  try {
    logger.info(`[VoiceHandler] Downloading voice file ${fileId}`);
    const { buffer, filePath } = await telegram.getFileBuffer(fileId);

    // Build multipart form — Whisper accepts ogg/oga files directly
    const ext = filePath.split(".").pop() ?? "ogg";
    const formData = new FormData();
    const blob = new Blob([buffer], { type: `audio/${ext}` });
    formData.append("file", blob, `voice.${ext}`);
    formData.append("model", "whisper-1");
    formData.append("language", "en");

    logger.info(`[VoiceHandler] Transcribing ${buffer.byteLength} bytes via Whisper`);

    const res = await fetch(WHISPER_API, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}` },
      body: formData,
    });

    if (!res.ok) {
      const err = await res.text();
      logger.warn(`[VoiceHandler] Whisper error ${res.status}: ${err}`);
      return null;
    }

    const data = await res.json() as { text: string };
    const transcript = data.text?.trim();
    logger.info(`[VoiceHandler] Transcript: "${transcript?.slice(0, 100)}"`);
    return transcript ?? null;
  } catch (err) {
    logger.warn(`[VoiceHandler] Transcription failed: ${(err as Error).message}`);
    return null;
  }
}

export function getVoiceFileId(
  voice?: TelegramVoice,
  audio?: TelegramAudio
): string | null {
  return voice?.file_id ?? audio?.file_id ?? null;
}

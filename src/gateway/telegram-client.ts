import { logger } from "../utils/logger";

export interface TelegramConfig {
  botToken: string;
}

// ─── Update types ─────────────────────────────────────────────────────────────

export interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
  callback_query?: TelegramCallbackQuery;
}

export interface TelegramCallbackQuery {
  id: string;
  from: { id: number; first_name: string; username?: string };
  message?: TelegramMessage;
  data?: string;
}

export interface TelegramMessage {
  message_id: number;
  from?: {
    id: number;
    is_bot: boolean;
    first_name: string;
    username?: string;
    language_code?: string;
  };
  chat: {
    id: number;
    type: "private" | "group" | "supergroup" | "channel";
    first_name?: string;
    username?: string;
    title?: string;
  };
  date: number;
  text?: string;
  caption?: string;
  voice?: TelegramVoice;
  audio?: TelegramAudio;
  photo?: TelegramPhotoSize[];
  document?: TelegramDocument;
  sticker?: { emoji?: string };
  reply_to_message?: TelegramMessage;
}

export interface TelegramVoice {
  file_id: string;
  file_unique_id: string;
  duration: number;
  mime_type?: string;
  file_size?: number;
}

export interface TelegramAudio {
  file_id: string;
  file_unique_id: string;
  duration: number;
  title?: string;
  mime_type?: string;
  file_size?: number;
}

export interface TelegramPhotoSize {
  file_id: string;
  file_unique_id: string;
  width: number;
  height: number;
  file_size?: number;
}

export interface TelegramDocument {
  file_id: string;
  file_unique_id: string;
  file_name?: string;
  mime_type?: string;
  file_size?: number;
}

export interface TelegramFile {
  file_id: string;
  file_unique_id: string;
  file_size?: number;
  file_path?: string;
}

export interface InlineKeyboardButton {
  text: string;
  callback_data?: string;
  url?: string;
}

// ─── Markdown helpers ─────────────────────────────────────────────────────────

const MDV2_SPECIAL = /([_*\[\]()~`>#+\-=|{}.!\\])/g;
export function escapeMarkdownV2(text: string): string {
  return text.replace(MDV2_SPECIAL, "\\$1");
}

export function splitMessage(text: string, limit = 4000): string[] {
  if (text.length <= limit) return [text];
  const chunks: string[] = [];
  let current = "";
  for (const line of text.split("\n")) {
    const candidate = current ? current + "\n" + line : line;
    if (candidate.length > limit) {
      if (current) chunks.push(current);
      current = line.slice(0, limit);
    } else {
      current = candidate;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

// ─── Client ───────────────────────────────────────────────────────────────────

export class TelegramClient {
  readonly baseUrl: string;
  private botToken: string;

  constructor(config: TelegramConfig) {
    this.botToken = config.botToken;
    this.baseUrl = `https://api.telegram.org/bot${config.botToken}`;
  }

  private async call<T>(method: string, body: Record<string, unknown>): Promise<T> {
    const res = await fetch(`${this.baseUrl}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json() as { ok: boolean; result?: T; description?: string };
    if (!data.ok) throw new Error(`Telegram ${method} failed: ${data.description}`);
    return data.result as T;
  }

  // ── Messaging ──────────────────────────────────────────────────────────────

  async sendMessage(
    chatId: number,
    text: string,
    options: {
      parseMode?: "Markdown" | "MarkdownV2" | "HTML";
      replyToMessageId?: number;
      replyMarkup?: { inline_keyboard: InlineKeyboardButton[][] };
    } = {}
  ): Promise<{ message_id: number }> {
    const chunks = splitMessage(text);
    let lastMsg = { message_id: 0 };

    for (let i = 0; i < chunks.length; i++) {
      const body: Record<string, unknown> = { chat_id: chatId, text: chunks[i] };
      if (options.parseMode) body.parse_mode = options.parseMode;
      if (options.replyToMessageId && i === 0) body.reply_to_message_id = options.replyToMessageId;
      if (options.replyMarkup && i === chunks.length - 1) body.reply_markup = options.replyMarkup;

      try {
        lastMsg = await this.call<{ message_id: number }>("sendMessage", body);
      } catch (err) {
        // Markdown parse error → retry as plain text
        if (options.parseMode) {
          logger.warn("[TelegramClient] Markdown failed, retrying as plain text");
          const plainBody = { chat_id: chatId, text: chunks[i] };
          if (options.replyToMessageId && i === 0) Object.assign(plainBody, { reply_to_message_id: options.replyToMessageId });
          lastMsg = await this.call<{ message_id: number }>("sendMessage", plainBody);
        } else {
          throw err;
        }
      }
    }
    return lastMsg;
  }

  async editMessage(chatId: number, messageId: number, text: string): Promise<void> {
    try {
      await this.call("editMessageText", {
        chat_id: chatId,
        message_id: messageId,
        text: text.slice(0, 4000),
      });
    } catch {
      // Message not modified is fine
    }
  }

  async sendTyping(chatId: number): Promise<void> {
    try {
      await this.call("sendChatAction", { chat_id: chatId, action: "typing" });
    } catch { /* non-critical */ }
  }

  async answerCallbackQuery(callbackQueryId: string, text?: string): Promise<void> {
    await this.call("answerCallbackQuery", { callback_query_id: callbackQueryId, text });
  }

  // ── Files ──────────────────────────────────────────────────────────────────

  async getFile(fileId: string): Promise<TelegramFile> {
    return this.call<TelegramFile>("getFile", { file_id: fileId });
  }

  async downloadFile(filePath: string): Promise<Buffer> {
    const url = `https://api.telegram.org/file/bot${this.botToken}/${filePath}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`File download failed: ${res.status}`);
    return Buffer.from(await res.arrayBuffer());
  }

  async getFileBuffer(fileId: string): Promise<{ buffer: Buffer; filePath: string }> {
    const file = await this.getFile(fileId);
    if (!file.file_path) throw new Error("File has no path (too large?)");
    const buffer = await this.downloadFile(file.file_path);
    return { buffer, filePath: file.file_path };
  }

  // ── Bot info ───────────────────────────────────────────────────────────────

  async getMe(): Promise<{ id: number; username: string; first_name: string }> {
    return this.call("getMe", {});
  }

  async setWebhook(url: string): Promise<void> {
    await this.call("setWebhook", {
      url,
      allowed_updates: ["message", "callback_query"],
      drop_pending_updates: true,
    });
    logger.info(`[TelegramClient] Webhook set → ${url}`);
  }

  async deleteWebhook(): Promise<void> {
    await this.call("deleteWebhook", { drop_pending_updates: true });
    logger.info("[TelegramClient] Webhook deleted");
  }

  async getWebhookInfo(): Promise<{
    url: string;
    has_custom_certificate: boolean;
    pending_update_count: number;
    last_error_message?: string;
  }> {
    return this.call("getWebhookInfo", {});
  }

  async setMyCommands(commands: { command: string; description: string }[]): Promise<void> {
    await this.call("setMyCommands", { commands });
  }
}

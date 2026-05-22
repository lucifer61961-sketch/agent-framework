/**
 * Streaming progress updater
 *
 * Sends a "thinking..." message immediately, then edits it with live
 * status updates as the agent works through iterations. This gives
 * users real-time feedback instead of a blank wait.
 */
import { TelegramClient } from "../telegram-client";
import { logger } from "../../utils/logger";

const PROGRESS_MESSAGES = [
  "🤔 Thinking…",
  "🔍 Researching…",
  "⚙️ Working on it…",
  "🛠️ Running tools…",
  "📝 Drafting response…",
  "🔄 Refining…",
];

export class ProgressUpdater {
  private chatId: number;
  private telegram: TelegramClient;
  private messageId: number | null = null;
  private iteration = 0;
  private updateInterval: NodeJS.Timeout | null = null;
  private stopped = false;

  constructor(chatId: number, telegram: TelegramClient) {
    this.chatId = chatId;
    this.telegram = telegram;
  }

  /** Send the initial "thinking" message and start rotating status */
  async start(): Promise<void> {
    try {
      const msg = await this.telegram.sendMessage(this.chatId, PROGRESS_MESSAGES[0]);
      this.messageId = msg.message_id;

      // Rotate the status message every 4 seconds
      this.updateInterval = setInterval(async () => {
        if (this.stopped || !this.messageId) return;
        this.iteration++;
        const text = PROGRESS_MESSAGES[this.iteration % PROGRESS_MESSAGES.length];
        await this.telegram.editMessage(this.chatId, this.messageId, text);
      }, 4000);
    } catch (err) {
      logger.warn(`[Progress] Failed to send progress message: ${(err as Error).message}`);
    }
  }

  /** Update with a specific status message (e.g. tool name) */
  async update(text: string): Promise<void> {
    if (this.stopped || !this.messageId) return;
    try {
      await this.telegram.editMessage(this.chatId, this.messageId, text.slice(0, 200));
    } catch { /* ignore */ }
  }

  /**
   * Stop the updater. If a final reply messageId is given, delete
   * the progress message to keep the chat clean.
   */
  async stop(deleteMessage = true): Promise<void> {
    this.stopped = true;
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
      this.updateInterval = null;
    }
    if (deleteMessage && this.messageId) {
      try {
        await fetch(`${this.telegram.baseUrl}/deleteMessage`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ chat_id: this.chatId, message_id: this.messageId }),
        });
      } catch { /* non-critical */ }
    }
  }

  get progressMessageId(): number | null {
    return this.messageId;
  }
}

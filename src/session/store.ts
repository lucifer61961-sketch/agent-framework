import Database from "better-sqlite3";
import path from "path";
import fs from "fs";
import { Message } from "../types";
import { logger } from "../utils/logger";

// ─── Schema ───────────────────────────────────────────────────────────────────
//
//  sessions
//    id          TEXT  PRIMARY KEY   (e.g. "telegram:123456789")
//    created_at  INTEGER             (unix ms)
//    updated_at  INTEGER
//
//  messages
//    id          INTEGER PRIMARY KEY AUTOINCREMENT
//    session_id  TEXT    REFERENCES sessions(id)
//    role        TEXT    "user" | "assistant"
//    content     TEXT    JSON-encoded ContentBlock[] or plain string
//    created_at  INTEGER
//
// ─────────────────────────────────────────────────────────────────────────────

const SCHEMA = `
PRAGMA journal_mode = WAL;

CREATE TABLE IF NOT EXISTS sessions (
  id         TEXT    PRIMARY KEY,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS messages (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT    NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  role       TEXT    NOT NULL CHECK(role IN ('user','assistant')),
  content    TEXT    NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id, id);
`;

export interface SessionStore {
  /** Load conversation history for a session (oldest first) */
  getHistory(sessionId: string): Message[];
  /** Append one or more messages to a session */
  appendMessages(sessionId: string, messages: Message[]): void;
  /** Wipe all messages for a session (fresh start) */
  clearSession(sessionId: string): void;
  /** Delete a session and all its messages */
  deleteSession(sessionId: string): void;
  /** Return session metadata or null if it doesn't exist */
  getSession(sessionId: string): { id: string; createdAt: number; updatedAt: number } | null;
  /** List all known session ids */
  listSessions(): string[];
  /** Close the database connection */
  close(): void;
}

export function createSessionStore(dbPath?: string): SessionStore {
  const resolvedPath = dbPath ?? path.resolve(process.cwd(), "data", "sessions.db");
  const dir = path.dirname(resolvedPath);

  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const db = new Database(resolvedPath);
  db.exec(SCHEMA);
  logger.info(`[SessionStore] Database ready at ${resolvedPath}`);

  // ── Prepared statements ──────────────────────────────────────────────────

  const stmtUpsertSession = db.prepare<[string, number, number]>(`
    INSERT INTO sessions (id, created_at, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET updated_at = excluded.updated_at
  `);

  const stmtInsertMessage = db.prepare<[string, string, string, number]>(`
    INSERT INTO messages (session_id, role, content, created_at)
    VALUES (?, ?, ?, ?)
  `);

  const stmtGetMessages = db.prepare<[string]>(`
    SELECT role, content FROM messages WHERE session_id = ? ORDER BY id ASC
  `);

  const stmtDeleteMessages = db.prepare<[string]>(`
    DELETE FROM messages WHERE session_id = ?
  `);

  const stmtDeleteSession = db.prepare<[string]>(`
    DELETE FROM sessions WHERE id = ?
  `);

  const stmtGetSession = db.prepare<[string]>(`
    SELECT id, created_at, updated_at FROM sessions WHERE id = ?
  `);

  const stmtListSessions = db.prepare(`
    SELECT id FROM sessions ORDER BY updated_at DESC
  `);

  // ── Helpers ───────────────────────────────────────────────────────────────

  function ensureSession(sessionId: string) {
    const now = Date.now();
    stmtUpsertSession.run(sessionId, now, now);
  }

  function touchSession(sessionId: string) {
    db.prepare<[number, string]>(
      `UPDATE sessions SET updated_at = ? WHERE id = ?`
    ).run(Date.now(), sessionId);
  }

  function encodeContent(content: Message["content"]): string {
    return typeof content === "string" ? content : JSON.stringify(content);
  }

  function decodeContent(raw: string): Message["content"] {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed;
      return raw;
    } catch {
      return raw;
    }
  }

  // ── Public API ────────────────────────────────────────────────────────────

  const appendMessages = db.transaction((sessionId: string, messages: Message[]) => {
    ensureSession(sessionId);
    const now = Date.now();
    for (const msg of messages) {
      stmtInsertMessage.run(sessionId, msg.role, encodeContent(msg.content), now);
    }
    touchSession(sessionId);
  });

  return {
    getHistory(sessionId: string): Message[] {
      const rows = stmtGetMessages.all(sessionId) as { role: string; content: string }[];
      return rows.map((r) => ({
        role: r.role as "user" | "assistant",
        content: decodeContent(r.content),
      }));
    },

    appendMessages(sessionId: string, messages: Message[]) {
      if (messages.length === 0) return;
      appendMessages(sessionId, messages);
      logger.debug(`[SessionStore] Appended ${messages.length} message(s) to session ${sessionId}`);
    },

    clearSession(sessionId: string) {
      stmtDeleteMessages.run(sessionId);
      touchSession(sessionId);
      logger.info(`[SessionStore] Cleared messages for session ${sessionId}`);
    },

    deleteSession(sessionId: string) {
      stmtDeleteSession.run(sessionId);
      logger.info(`[SessionStore] Deleted session ${sessionId}`);
    },

    getSession(sessionId: string) {
      const row = stmtGetSession.get(sessionId) as
        | { id: string; created_at: number; updated_at: number }
        | undefined;
      if (!row) return null;
      return { id: row.id, createdAt: row.created_at, updatedAt: row.updated_at };
    },

    listSessions() {
      return (stmtListSessions.all() as { id: string }[]).map((r) => r.id);
    },

    close() {
      db.close();
      logger.info("[SessionStore] Database closed");
    },
  };
}

type LogLevel = "debug" | "info" | "warn" | "error";

const LEVELS: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };

const COLORS: Record<LogLevel, string> = {
  debug: "\x1b[90m",   // gray
  info:  "\x1b[36m",   // cyan
  warn:  "\x1b[33m",   // yellow
  error: "\x1b[31m",   // red
};
const RESET = "\x1b[0m";

class Logger {
  private level: LogLevel;

  constructor(level: LogLevel = "info") {
    this.level = (process.env.LOG_LEVEL as LogLevel | undefined) ?? level;
  }

  private log(level: LogLevel, message: string, meta?: unknown) {
    if (LEVELS[level] < LEVELS[this.level]) return;
    const ts = new Date().toISOString();
    const color = COLORS[level];
    const prefix = `${color}[${level.toUpperCase()}]${RESET}`;
    const metaStr = meta ? ` ${JSON.stringify(meta, null, 0)}` : "";
    process.stdout.write(`${ts} ${prefix} ${message}${metaStr}\n`);
  }

  debug(msg: string, meta?: unknown) { this.log("debug", msg, meta); }
  info(msg: string, meta?: unknown)  { this.log("info",  msg, meta); }
  warn(msg: string, meta?: unknown)  { this.log("warn",  msg, meta); }
  error(msg: string, meta?: unknown) { this.log("error", msg, meta); }
}

export const logger = new Logger();

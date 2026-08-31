export type LogLevel = "info" | "warn" | "error";
export interface LogRecord { readonly level: LogLevel; readonly event: string; readonly [key: string]: unknown; }

const SECRET_KEY = /(token|secret|password|authorization|api[-_]?key|prompt)/i;
const SECRET_TEXT = /(token|secret|password|authorization|api[-_ ]?key|prompt)/i;
export class PrivacySafeLogger {
  constructor(private readonly write: (line: string) => void = (line) => process.stdout.write(`${line}\n`)) {}
  log(level: LogLevel, event: string, fields: Record<string, unknown> = {}): void {
    const safe = Object.fromEntries(Object.entries(fields).filter(([key]) => !SECRET_KEY.test(key)).map(([key, value]) => [key, redact(value)]));
    this.write(JSON.stringify({ timestamp: new Date().toISOString(), level, event, ...safe }));
  }
  info(event: string, fields?: Record<string, unknown>): void { this.log("info", event, fields); }
  warn(event: string, fields?: Record<string, unknown>): void { this.log("warn", event, fields); }
  error(event: string, fields?: Record<string, unknown>): void { this.log("error", event, fields); }
}

function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redact);
  if (typeof value === "string") return SECRET_TEXT.test(value) ? "[REDACTED]" : value;
  if (typeof value === "object" && value !== null) return Object.fromEntries(Object.entries(value).filter(([key]) => !SECRET_KEY.test(key)).map(([key, child]) => [key, redact(child)]));
  return value;
}

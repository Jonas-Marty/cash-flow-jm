/**
 * Structured JSON logger for stdout.
 *
 * Emits one JSON line per event. Designed to be picked up by Promtail /
 * Filebeat / Vector running alongside the Coolify container, and shipped to
 * Loki / Elasticsearch / etc.
 *
 * Keep this dependency-free so it works in the Worker SSR runtime as well.
 */

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogFields {
  event: string;
  userId?: string | null;
  requestId?: string;
  durationMs?: number;
  status?: number;
  method?: string;
  path?: string;
  ip?: string;
  ua?: string;
  err?: unknown;
  [k: string]: unknown;
}

const SERVICE = process.env.LOG_SERVICE_NAME ?? "cash-flow";
const ENVNAME = process.env.NODE_ENV ?? "development";

function serializeError(e: unknown) {
  if (e instanceof Error) {
    return { name: e.name, message: e.message, stack: e.stack };
  }
  return e;
}

function emit(level: LogLevel, fields: LogFields) {
  const { err, ...rest } = fields;
  const line = {
    ts: new Date().toISOString(),
    level,
    service: SERVICE,
    env: ENVNAME,
    ...rest,
    ...(err !== undefined ? { err: serializeError(err) } : {}),
  };
  // Stringify defensively — never throw from a logger.
  let json: string;
  try {
    json = JSON.stringify(line);
  } catch {
    json = JSON.stringify({ ts: line.ts, level, service: SERVICE, event: fields.event, _stringify_error: true });
  }
  // stdout for info/debug, stderr for warn/error so log shippers can split if desired.
  if (level === "warn" || level === "error") {
    // eslint-disable-next-line no-console
    console.error(json);
  } else {
    // eslint-disable-next-line no-console
    console.log(json);
  }
}

export const log = {
  debug: (fields: LogFields) => emit("debug", fields),
  info: (fields: LogFields) => emit("info", fields),
  warn: (fields: LogFields) => emit("warn", fields),
  error: (fields: LogFields) => emit("error", fields),
};

/** Generate a short request id (no external deps). */
export function newRequestId(): string {
  // 12 hex chars is enough to correlate within a request lifetime
  const a = Math.floor(Math.random() * 0xffffffff).toString(16).padStart(8, "0");
  const b = Math.floor(Math.random() * 0xffff).toString(16).padStart(4, "0");
  return `${a}${b}`;
}
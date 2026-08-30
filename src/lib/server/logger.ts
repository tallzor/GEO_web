import "server-only";

type LogLevel = "info" | "warn" | "error";
type LogContext = Record<string, unknown>;

function emit(level: LogLevel, scope: string, message: string, context?: LogContext) {
  const record = {
    timestamp: new Date().toISOString(),
    level,
    scope,
    message,
    ...(context && Object.keys(context).length ? context : {}),
  };
  if (level === "error") console.error(JSON.stringify(record));
  else if (level === "warn") console.warn(JSON.stringify(record));
  else console.log(JSON.stringify(record));
}

export type Logger = {
  info: (message: string, context?: LogContext) => void;
  warn: (message: string, context?: LogContext) => void;
  error: (message: string, context?: LogContext) => void;
};

export function createLogger(scope: string): Logger {
  return {
    info: (message, context) => emit("info", scope, message, context),
    warn: (message, context) => emit("warn", scope, message, context),
    error: (message, context) => emit("error", scope, message, context),
  };
}

import { redact } from '@ccn/security';

/**
 * Structured JSON logging.
 *
 * One line per event, machine-parseable, and every payload passes through
 * `redact` on the way out — the plan's rule is "request id / actor / route, no
 * secrets or PII", and enforcing it at the sink is the only version of that rule
 * that survives contact with a hundred call sites.
 *
 * The sink is injected so tests capture instead of printing.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export type LogFields = Record<string, unknown>;

export type Logger = {
  debug(message: string, fields?: LogFields): void;
  info(message: string, fields?: LogFields): void;
  warn(message: string, fields?: LogFields): void;
  error(message: string, fields?: LogFields): void;
  /** Derive a logger that stamps `fields` onto every subsequent line. */
  child(fields: LogFields): Logger;
};

export type LogRecord = {
  level: LogLevel;
  message: string;
  time: string;
} & LogFields;

export type LoggerOptions = {
  /** Minimum level to emit. Default 'info'. */
  level?: LogLevel;
  /** Where records go. Default: one JSON line on stdout. */
  sink?: (record: LogRecord) => void;
  /** Injected clock, for deterministic tests. */
  now?: () => Date;
  /** Fields stamped on every record. */
  base?: LogFields;
};

const ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

export function createLogger(options: LoggerOptions = {}): Logger {
  const threshold = ORDER[options.level ?? 'info'];
  const now = options.now ?? (() => new Date());
  const sink = options.sink ?? ((record: LogRecord) => console.log(JSON.stringify(record)));
  const base = options.base ?? {};

  const emit = (level: LogLevel, message: string, fields: LogFields = {}) => {
    if (ORDER[level] < threshold) return;
    const merged = redact({ ...base, ...fields }) as LogFields;
    sink({ level, message: String(redact(message)), time: now().toISOString(), ...merged });
  };

  return {
    debug: (message, fields) => emit('debug', message, fields),
    info: (message, fields) => emit('info', message, fields),
    warn: (message, fields) => emit('warn', message, fields),
    error: (message, fields) => emit('error', message, fields),
    child: (fields) => createLogger({ ...options, base: { ...base, ...fields } }),
  };
}

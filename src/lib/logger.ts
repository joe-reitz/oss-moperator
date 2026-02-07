/**
 * Structured Logger for mOperator
 *
 * Production (NODE_ENV=production): single-line JSON for Vercel log drains
 * Dev: human-readable [service] message { ctx } format
 *
 * Usage:
 *   const log = createLogger("Slack")
 *   log.info("Processing message", { userId: "U123", channel: "C456" })
 *   const reqLog = log.child({ requestId: "abc" })
 *   reqLog.error("Failed", { reason: "timeout" })
 */

type LogLevel = "debug" | "info" | "warn" | "error"

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
}

export interface Logger {
  debug(message: string, ctx?: Record<string, unknown>): void
  info(message: string, ctx?: Record<string, unknown>): void
  warn(message: string, ctx?: Record<string, unknown>): void
  error(message: string, ctx?: Record<string, unknown>): void
  child(ctx: Record<string, unknown>): Logger
}

function getMinLevel(): LogLevel {
  const env = process.env.LOG_LEVEL?.toLowerCase()
  if (env && env in LEVEL_ORDER) return env as LogLevel
  return "info"
}

function isProduction(): boolean {
  return process.env.NODE_ENV === "production"
}

function emit(
  level: LogLevel,
  service: string,
  message: string,
  ctx: Record<string, unknown>
) {
  if (LEVEL_ORDER[level] < LEVEL_ORDER[getMinLevel()]) return

  if (isProduction()) {
    const entry = JSON.stringify({
      level,
      service,
      message,
      timestamp: new Date().toISOString(),
      ...ctx,
    })
    if (level === "error") {
      console.error(entry)
    } else if (level === "warn") {
      console.warn(entry)
    } else {
      console.log(entry)
    }
  } else {
    const prefix = `[${service}]`
    const hasCtx = Object.keys(ctx).length > 0
    const suffix = hasCtx ? ` ${JSON.stringify(ctx)}` : ""
    const line = `${prefix} ${message}${suffix}`

    if (level === "error") {
      console.error(line)
    } else if (level === "warn") {
      console.warn(line)
    } else if (level === "debug") {
      console.debug(line)
    } else {
      console.log(line)
    }
  }
}

function makeLogger(service: string, baseCtx: Record<string, unknown>): Logger {
  return {
    debug(message, ctx) {
      emit("debug", service, message, { ...baseCtx, ...ctx })
    },
    info(message, ctx) {
      emit("info", service, message, { ...baseCtx, ...ctx })
    },
    warn(message, ctx) {
      emit("warn", service, message, { ...baseCtx, ...ctx })
    },
    error(message, ctx) {
      emit("error", service, message, { ...baseCtx, ...ctx })
    },
    child(ctx) {
      return makeLogger(service, { ...baseCtx, ...ctx })
    },
  }
}

export function createLogger(service: string): Logger {
  return makeLogger(service, {})
}

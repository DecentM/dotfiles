import type { PluginInput } from "@opencode-ai/plugin";

export const LogLevel = [
  'debug',
  'info',
  'warn',
  'error',
] as const

export type LogLevel = (typeof LogLevel)[number]

type LogExtra = Record<string, unknown>

export class Logger {
  constructor(private level: LogLevel, private client: PluginInput['client'], private service: string) { }

  private shouldLog(level: LogLevel) {
    return LogLevel.indexOf(level) >= LogLevel.indexOf(this.level);
  }

  private async log(level: LogLevel, message: string, extra: LogExtra = {}) {
    if (!this.shouldLog(level)) return

    try {
      this.client.app.log({
        body: {
          level,
          service: this.service,
          message,
          extra,
        }
      })
    } catch { }
  }

  public debug(message: string, extra?: LogExtra) {
    return this.log('debug', message, extra)
  }

  public info(message: string, extra?: LogExtra) {
    return this.log('info', message, extra)
  }

  public warn(message: string, extra?: LogExtra) {
    return this.log('warn', message, extra)
  }

  public error(message: string, extra?: LogExtra) {
    return this.log('error', message, extra)
  }
}

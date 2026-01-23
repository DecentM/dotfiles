/**
 * Sensitive data sanitization utilities.
 */

const SENSITIVE_KEY_PATTERN =
  /^(password|secret|token|key|apikey|api_key|auth|credential|private)$/i

/**
 * Recursively sanitize sensitive keys in an object.
 */
export const sanitizeArgs = (value: unknown): unknown => {
  if (value === null || value === undefined) {
    return value
  }

  if (Array.isArray(value)) {
    return value.map(sanitizeArgs)
  }

  if (typeof value === 'object') {
    const sanitized: Record<string, unknown> = {}
    for (const [key, val] of Object.entries(value)) {
      if (SENSITIVE_KEY_PATTERN.test(key)) {
        sanitized[key] = '[REDACTED]'
      } else {
        sanitized[key] = sanitizeArgs(val)
      }
    }
    return sanitized
  }

  return value
}

/**
 * Safely stringify args, handling circular references and sanitizing sensitive data.
 */
export const safeStringify = (args: unknown): string => {
  try {
    const sanitized = sanitizeArgs(args)
    return JSON.stringify(sanitized)
  } catch {
    return '[Unable to serialize args]'
  }
}

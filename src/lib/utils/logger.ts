/**
 * Thin tagged logger for production-safe logging.
 *
 * - `logger.info` only logs in non-production environments (dev/test)
 * - `logger.warn` and `logger.error` always log
 *
 * Usage: logger.info("auth", "Magic link for", email, url);
 */

/* eslint-disable no-console */

export const logger = {
  info: (tag: string, ...args: unknown[]) => {
    if (process.env.NODE_ENV !== "production") console.log(`[${tag}]`, ...args);
  },
  warn: (tag: string, ...args: unknown[]) => {
    console.warn(`[${tag}]`, ...args);
  },
  error: (tag: string, ...args: unknown[]) => {
    console.error(`[${tag}]`, ...args);
  },
};

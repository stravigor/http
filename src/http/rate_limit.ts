import type { Middleware } from './middleware.ts'
import type Context from './context.ts'

// ---------------------------------------------------------------------------
// Store interface
// ---------------------------------------------------------------------------

export interface RateLimitInfo {
  /** Total allowed requests in the window. */
  limit: number
  /** Remaining requests in the current window. */
  remaining: number
  /** Unix timestamp (ms) when the window resets. */
  resetTime: number
  /** Whether the current request exceeds the limit. */
  exceeded: boolean
}

/**
 * Pluggable storage backend for rate limit counters.
 * Implement this interface to use Redis, database, or distributed stores.
 */
export interface RateLimitStore {
  increment(key: string, window: number, max: number): RateLimitInfo | Promise<RateLimitInfo>
  reset(key: string): void | Promise<void>
}

// ---------------------------------------------------------------------------
// In-memory store (fixed window)
// ---------------------------------------------------------------------------

interface WindowEntry {
  count: number
  resetTime: number
}

/**
 * In-memory rate limit store using fixed time windows.
 * Entries are lazily cleaned up on access. Suitable for single-process deployments.
 */
export class MemoryStore implements RateLimitStore {
  private windows = new Map<string, WindowEntry>()

  increment(key: string, window: number, max: number): RateLimitInfo {
    const now = Date.now()
    const entry = this.windows.get(key)

    if (entry && now < entry.resetTime) {
      entry.count++
      return {
        limit: max,
        remaining: Math.max(0, max - entry.count),
        resetTime: entry.resetTime,
        exceeded: entry.count > max,
      }
    }

    const resetTime = now + window
    this.windows.set(key, { count: 1, resetTime })

    if (this.windows.size > 10_000) this.cleanup(now)

    return { limit: max, remaining: max - 1, resetTime, exceeded: false }
  }

  reset(key: string): void {
    this.windows.delete(key)
  }

  private cleanup(now: number): void {
    for (const [key, entry] of this.windows) {
      if (now >= entry.resetTime) this.windows.delete(key)
    }
  }
}

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export interface RateLimitOptions {
  /** Time window in milliseconds. @default 60_000 */
  window?: number

  /** Maximum requests allowed in the window. @default 60 */
  max?: number

  /**
   * Extract the rate limit key from the request context.
   * Defaults to client IP via X-Forwarded-For / X-Real-IP.
   */
  keyExtractor?: (ctx: Context) => string

  /** Return `true` to bypass the rate limit check. */
  skip?: (ctx: Context) => boolean

  /** Custom storage backend. Defaults to an in-memory fixed-window store. */
  store?: RateLimitStore

  /** Custom response when rate limit is exceeded. */
  onLimitReached?: (ctx: Context, info: RateLimitInfo) => Response

  /** Whether to add X-RateLimit-* headers to successful responses. @default true */
  headers?: boolean
}

// ---------------------------------------------------------------------------
// Default key extractor
// ---------------------------------------------------------------------------

function defaultKeyExtractor(ctx: Context): string {
  const forwarded = ctx.header('x-forwarded-for')
  if (forwarded) return forwarded.split(',')[0]!.trim()

  const realIp = ctx.header('x-real-ip')
  if (realIp) return realIp

  return 'unknown'
}

// ---------------------------------------------------------------------------
// Middleware factory
// ---------------------------------------------------------------------------

export function rateLimit(options: RateLimitOptions = {}): Middleware {
  const {
    window = 60_000,
    max = 60,
    keyExtractor = defaultKeyExtractor,
    skip,
    store = new MemoryStore(),
    onLimitReached,
    headers: addHeaders = true,
  } = options

  return async (ctx, next) => {
    if (skip?.(ctx)) return next()

    const key = keyExtractor(ctx)
    const info = await store.increment(key, window, max)

    if (info.exceeded) {
      if (onLimitReached) return onLimitReached(ctx, info)

      const retryAfter = Math.ceil((info.resetTime - Date.now()) / 1000)
      return new Response(JSON.stringify({ error: 'Too Many Requests' }), {
        status: 429,
        headers: {
          'Content-Type': 'application/json',
          'X-RateLimit-Limit': String(info.limit),
          'X-RateLimit-Remaining': '0',
          'X-RateLimit-Reset': String(Math.ceil(info.resetTime / 1000)),
          'Retry-After': String(Math.max(0, retryAfter)),
        },
      })
    }

    const response = await next()

    if (!addHeaders) return response

    const headers = new Headers(response.headers)
    headers.set('X-RateLimit-Limit', String(info.limit))
    headers.set('X-RateLimit-Remaining', String(info.remaining))
    headers.set('X-RateLimit-Reset', String(Math.ceil(info.resetTime / 1000)))

    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    })
  }
}

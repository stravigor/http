import type Context from '../http/context.ts'
import type { Middleware } from '../http/middleware.ts'
// Moved from @stravigor/kernel/cache — depends on http types

export interface HttpCacheOptions {
  /** Cache-Control max-age in seconds. @default 0 */
  maxAge?: number

  /** Cache-Control s-maxage for shared caches (CDN). */
  sMaxAge?: number

  /** Cache-Control directives. @default ['public'] */
  directives?: CacheDirective[]

  /** Add weak ETag header based on response body hash. @default false */
  etag?: boolean

  /** Vary header values. @default ['Accept-Encoding'] */
  vary?: string[]

  /** Skip cache headers for certain requests. */
  skip?: (ctx: Context) => boolean
}

export type CacheDirective =
  | 'public'
  | 'private'
  | 'no-cache'
  | 'no-store'
  | 'must-revalidate'
  | 'immutable'

/**
 * HTTP cache middleware — sets Cache-Control, ETag, and Vary headers.
 *
 * Only applies to GET and HEAD requests. Browser/CDN does the actual caching.
 * When `etag` is enabled and the request includes a matching `If-None-Match`
 * header, responds with 304 Not Modified.
 *
 * @example
 * router.group({ middleware: [httpCache({ maxAge: 300, etag: true })] }, r => {
 *   r.get('/api/categories', listCategories)
 * })
 */
export function httpCache(options: HttpCacheOptions = {}): Middleware {
  const {
    maxAge = 0,
    sMaxAge,
    directives = ['public'],
    etag: enableEtag = false,
    vary = ['Accept-Encoding'],
    skip,
  } = options

  const cacheControl = buildCacheControl(directives, maxAge, sMaxAge)

  return async (ctx, next) => {
    // Only cache GET and HEAD responses
    if (ctx.method !== 'GET' && ctx.method !== 'HEAD') return next()

    if (skip?.(ctx)) return next()

    const response = await next()

    const headers = new Headers(response.headers)
    headers.set('Cache-Control', cacheControl)

    if (vary.length > 0) {
      const existing = headers.get('Vary')
      const merged = existing ? `${existing}, ${vary.join(', ')}` : vary.join(', ')
      headers.set('Vary', merged)
    }

    if (enableEtag) {
      const body = await response.clone().arrayBuffer()
      const hash = new Bun.CryptoHasher('md5').update(body).digest('hex')
      const tag = `W/"${hash}"`

      headers.set('ETag', tag)

      const ifNoneMatch = ctx.header('if-none-match')
      if (ifNoneMatch === tag) {
        return new Response(null, { status: 304, headers })
      }

      return new Response(body, {
        status: response.status,
        statusText: response.statusText,
        headers,
      })
    }

    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    })
  }
}

function buildCacheControl(directives: CacheDirective[], maxAge: number, sMaxAge?: number): string {
  const parts = [...directives]
  if (maxAge > 0) parts.push(`max-age=${maxAge}` as CacheDirective)
  if (sMaxAge != null) parts.push(`s-maxage=${sMaxAge}` as CacheDirective)
  return parts.join(', ')
}

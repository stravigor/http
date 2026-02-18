/** Options for serializing a Set-Cookie header. */
export interface CookieOptions {
  httpOnly?: boolean
  secure?: boolean
  sameSite?: 'strict' | 'lax' | 'none'
  maxAge?: number // seconds
  path?: string
  domain?: string
}

/** Serialize a cookie name/value pair into a Set-Cookie header string. */
export function serializeCookie(name: string, value: string, options: CookieOptions = {}): string {
  let cookie = `${name}=${encodeURIComponent(value)}`

  if (options.httpOnly) cookie += '; HttpOnly'
  if (options.secure) cookie += '; Secure'
  if (options.sameSite) cookie += `; SameSite=${options.sameSite}`
  if (options.maxAge !== undefined) cookie += `; Max-Age=${options.maxAge}`
  cookie += `; Path=${options.path ?? '/'}`
  if (options.domain) cookie += `; Domain=${options.domain}`

  return cookie
}

/** Parse a Cookie header string into a map of name → value. */
export function parseCookies(header: string): Map<string, string> {
  const cookies = new Map<string, string>()

  for (const pair of header.split(';')) {
    const eq = pair.indexOf('=')
    if (eq === -1) continue
    const key = pair.slice(0, eq).trim()
    const value = decodeURIComponent(pair.slice(eq + 1).trim())
    cookies.set(key, value)
  }

  return cookies
}

/** Return a new Response with a Set-Cookie header appended. */
export function withCookie(
  response: Response,
  name: string,
  value: string,
  options?: CookieOptions
): Response {
  const headers = new Headers(response.headers)
  headers.append('Set-Cookie', serializeCookie(name, value, options))
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  })
}

/** Return a new Response with a cookie-clearing Set-Cookie header (Max-Age=0). */
export function clearCookie(response: Response, name: string, options?: CookieOptions): Response {
  return withCookie(response, name, '', { ...options, maxAge: 0 })
}

import { app } from '@stravigor/kernel/core/application'
import Router from './router.ts'

export { default as Context } from './context.ts'
export { default as Router } from './router.ts'
export { default as Server } from './server.ts'
export { compose } from './middleware.ts'
export { serializeCookie, parseCookies, withCookie, clearCookie } from './cookie.ts'
export { rateLimit, MemoryStore } from './rate_limit.ts'
export { Resource } from './resource.ts'
export type { Handler, Middleware, Next } from './middleware.ts'
export type { GroupOptions, WebSocketHandlers, WebSocketData } from './router.ts'
export type { CookieOptions } from './cookie.ts'
export type { CorsOptions } from './cors.ts'
export type { RateLimitOptions, RateLimitStore, RateLimitInfo } from './rate_limit.ts'

if (!app.has(Router)) app.singleton(Router)
export const router = app.resolve(Router)

export { staticFiles } from './static_files.ts'

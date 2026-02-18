# @stravigor/http

HTTP layer for the Strav framework — router, server, middleware, authentication, sessions, validation, views, and authorization policies.

## Dependencies
- @stravigor/kernel (peer)

## Commands
- bun test
- bun run typecheck

## Architecture
- src/http/ — Router, Server, Context, CORS, rate limiting, cookies
- src/view/ — Template engine, compiler, Vue SFC islands
- src/session/ — Session manager and middleware
- src/validation/ — Validation engine and rules
- src/policy/ — Authorization policies
- src/auth/ — Authentication guards, access tokens, middleware (authenticate, guest, csrf)
- src/middleware/ — Middleware from other packages that depend on HTTP types:
  - http_cache.ts — Cache-Control/ETag middleware (from kernel/cache)
  - i18n.ts — Locale detection middleware (from kernel/i18n)
  - request_logger.ts — Request logging middleware (from kernel/logger)
- src/providers/ — HttpProvider, AuthProvider, SessionProvider, ViewProvider

## Conventions
- Context implements kernel's RequestContext interface
- Middleware files for cache/i18n/logger live here because they depend on HTTP types
- Auth middleware is in src/auth/middleware/ (authenticate, guest, csrf)

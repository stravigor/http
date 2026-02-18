import type { Middleware } from '../../http/middleware.ts'
import Auth from '../auth.ts'
import type Session from '../../session/session.ts'
import AccessToken from '../access_token.ts'

/**
 * Require the request to be authenticated.
 *
 * For the session guard, requires the `session()` middleware to run first
 * so that `ctx.get('session')` is available. Checks that the session has
 * a user associated with it.
 *
 * Sets:
 * - `ctx.get('user')` — the resolved user object
 * - `ctx.get('accessToken')` — the AccessTokenData (token guard only)
 *
 * @param guard  'session' | 'token' (defaults to config `auth.default`)
 *
 * @example
 * router.group({ middleware: [session(), auth()] }, (r) => { ... })
 * router.group({ middleware: [auth('token')] }, (r) => { ... })
 */
export function auth(guard?: string): Middleware {
  return async (ctx, next) => {
    const guardName = guard ?? Auth.config.default

    if (guardName === 'session') {
      const session = ctx.get<Session>('session')

      if (!session || !session.isAuthenticated || session.isExpired()) {
        return ctx.json({ error: 'Unauthenticated' }, 401)
      }

      const user = await Auth.resolveUser(session.userId!)
      if (!user) return ctx.json({ error: 'Unauthenticated' }, 401)

      ctx.set('user', user)

      const response = await next()
      await session.touch()
      return response
    }

    if (guardName === 'token') {
      const header = ctx.header('authorization')
      if (!header?.startsWith('Bearer ')) {
        return ctx.json({ error: 'Unauthenticated' }, 401)
      }

      const accessToken = await AccessToken.validate(header.slice(7))
      if (!accessToken) return ctx.json({ error: 'Unauthenticated' }, 401)

      const user = await Auth.resolveUser(accessToken.userId)
      if (!user) return ctx.json({ error: 'Unauthenticated' }, 401)

      ctx.set('user', user)
      ctx.set('accessToken', accessToken)

      return next()
    }

    return ctx.json({ error: `Unknown auth guard: ${guardName}` }, 500)
  }
}

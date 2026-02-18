import type { Middleware } from '../http/middleware.ts'
import type { PolicyResult } from './policy_result.ts'

type PolicyReturn = PolicyResult | Promise<PolicyResult>

export function authorize(
  policy: Record<string, (...args: any[]) => PolicyReturn>,
  method: string,
  loadResource?: (ctx: import('../http/context.ts').default) => Promise<unknown>
): Middleware {
  return async (ctx, next) => {
    const user = ctx.get('user')
    if (!user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    let resource: unknown
    if (loadResource) {
      resource = await loadResource(ctx)
      ctx.set('resource', resource)
    }

    const policyMethod = policy[method]
    if (!policyMethod) {
      return new Response(JSON.stringify({ error: 'Forbidden' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    const access = await policyMethod(user, resource)
    if (!access.allowed) {
      return new Response(JSON.stringify({ error: access.reason }), {
        status: access.status,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    return next()
  }
}

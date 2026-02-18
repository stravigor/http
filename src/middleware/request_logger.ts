import type { Middleware } from '../http/middleware.ts'
import type Logger from '@stravigor/kernel/logger/logger'

export function requestLogger(logger: Logger): Middleware {
  return async (ctx, next) => {
    const start = performance.now()
    const response = await next()
    const duration = Math.round(performance.now() - start)

    logger.info(`${ctx.method} ${ctx.path} ${response.status} ${duration}ms`, {
      method: ctx.method,
      path: ctx.path,
      status: response.status,
      duration,
    })

    return response
  }
}

import type Context from './context.ts'

/** A route handler — receives a Context and returns a Response. */
export type Handler = (ctx: Context) => Response | Promise<Response>

/** Invokes the next middleware (or the final handler) in the pipeline. */
export type Next = () => Promise<Response>

/** A middleware function — wraps a handler with before/after logic. */
export type Middleware = (ctx: Context, next: Next) => Response | Promise<Response>

/**
 * Compose an array of middleware and a final handler into a single handler.
 *
 * Implements the onion model: each middleware wraps the next, and can
 * inspect or modify the response on the way back.
 *
 * @example
 * const handler = compose([logger, auth], finalHandler)
 * const response = await handler(ctx)
 */
export function compose(middleware: Middleware[], handler: Handler): Handler {
  return (ctx: Context) => {
    let index = -1

    function dispatch(i: number): Promise<Response> {
      if (i <= index) throw new Error('next() called multiple times')
      index = i

      if (i === middleware.length) {
        return Promise.resolve(handler(ctx))
      }

      return Promise.resolve(middleware[i]!(ctx, () => dispatch(i + 1)))
    }

    return dispatch(0)
  }
}

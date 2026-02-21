import type Router from '../http/router.ts'
import type { HandlerInput } from '../http/router.ts'
import type { SpaRouteDefinition } from './route_types.ts'

/**
 * Register SPA route definitions as GET handlers on the server router.
 *
 * Each route path gets the same handler (typically the controller that
 * renders the SPA shell template). This eliminates the need to manually
 * list every client-side route on the server.
 *
 * @example
 * ```ts
 * spaRoutes(r, routeDefs, [AppController, 'index'])
 * ```
 */
export function spaRoutes(
  router: Router,
  routes: readonly SpaRouteDefinition[],
  handler: HandlerInput,
): void {
  for (const route of routes) {
    router.get(route.path, handler)
  }
}

/**
 * Shared SPA route definition types.
 *
 * Zero dependencies — safe to import in both server and client bundles.
 */

/**
 * A single SPA route definition.
 *
 * Shared between server (to register catch-all GET handlers)
 * and client (to match paths and render components).
 */
export interface SpaRouteDefinition {
  /** URL pattern with named params, e.g. '/projects/:id/chat' */
  path: string
  /** Unique route name for programmatic navigation */
  name: string
  /** View component key — maps to a component in the views registry */
  view: string
  /**
   * Map raw URL params (all strings) to component props.
   * When omitted, no props are passed to the view.
   */
  props?: (params: Record<string, string>) => Record<string, unknown>
}

/**
 * Identity function that provides type inference for route definitions.
 * Zero dependencies — safe to import in any environment.
 */
export function defineRoutes(routes: SpaRouteDefinition[]): SpaRouteDefinition[] {
  return routes
}

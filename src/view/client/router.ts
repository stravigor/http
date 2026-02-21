// @ts-nocheck — Client-side script; requires DOM types provided by the app's bundler config.

/**
 * Stravigor Client Router
 *
 * A lightweight Vue 3 router for SPA navigation within the islands architecture.
 * Uses shared route definitions (from defineRoutes) so server and client stay in sync.
 *
 * Usage:
 *   import { createRouter, useRouter, useRoute } from '@stravigor/http/view/client/router'
 */

import {
  ref,
  computed,
  inject,
  defineComponent,
  h,
  type App,
  type Plugin,
  type Ref,
  type ComputedRef,
  type InjectionKey,
  type Component,
  type PropType,
} from 'vue'
import type { SpaRouteDefinition } from '../route_types.ts'
export { defineRoutes } from '../route_types.ts'
export type { SpaRouteDefinition } from '../route_types.ts'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Resolved route — the current matched state. */
export interface RouteLocation {
  /** The full URL path */
  path: string
  /** Route name, or null if no match */
  name: string | null
  /** Extracted URL params (all strings) */
  params: Record<string, string>
  /** Resolved component props (from route.props function) */
  resolvedProps: Record<string, unknown>
  /** The matched view key, or null if 404 */
  view: string | null
}

/** Navigation target — string path or named route. */
export type RouteTarget = string | { name: string; params?: Record<string, string | number> }

/** Router instance exposed via useRouter(). */
export interface RouterInstance {
  push(to: RouteTarget): void
  replace(to: RouteTarget): void
  back(): void
  forward(): void
  readonly route: ComputedRef<RouteLocation>
}

export interface RouterOptions {
  /** Route definitions (from defineRoutes) */
  routes: readonly SpaRouteDefinition[]
  /** Map of view name → Vue component */
  views: Record<string, Component>
  /** Fallback component when no route matches */
  fallback?: Component
}

// ---------------------------------------------------------------------------
// Injection Keys
// ---------------------------------------------------------------------------

const ROUTER_KEY: InjectionKey<RouterInstance> = Symbol('strav-router')
const ROUTE_KEY: InjectionKey<ComputedRef<RouteLocation>> = Symbol('strav-route')

// ---------------------------------------------------------------------------
// Route Matching
// ---------------------------------------------------------------------------

interface CompiledRoute {
  definition: SpaRouteDefinition
  regex: RegExp
  paramNames: string[]
}

/** Compile a route pattern into a RegExp, extracting param names. */
function compilePattern(pattern: string): { regex: RegExp; paramNames: string[] } {
  const paramNames: string[] = []
  const regexStr = pattern.replace(/:(\w+)/g, (_, name) => {
    paramNames.push(name)
    return '([^/]+)'
  })
  return { regex: new RegExp(`^${regexStr}$`), paramNames }
}

/** Build the path for a named route with param substitution. */
function buildPath(
  route: CompiledRoute,
  params: Record<string, string | number>,
): string {
  return route.definition.path.replace(/:(\w+)/g, (_, name) => String(params[name]))
}

/** Match a path against compiled routes. Returns the first match. */
function matchRoute(path: string, compiled: CompiledRoute[]): RouteLocation {
  for (const route of compiled) {
    const match = route.regex.exec(path)
    if (match) {
      const params: Record<string, string> = {}
      for (let i = 0; i < route.paramNames.length; i++) {
        params[route.paramNames[i]] = match[i + 1]
      }
      const resolvedProps = route.definition.props
        ? route.definition.props(params)
        : {}
      return {
        path,
        name: route.definition.name,
        params,
        resolvedProps,
        view: route.definition.view,
      }
    }
  }
  // No match — 404
  return { path, name: null, params: {}, resolvedProps: {}, view: null }
}

// ---------------------------------------------------------------------------
// createRouter — Vue Plugin Factory
// ---------------------------------------------------------------------------

export function createRouter(options: RouterOptions): Plugin {
  const compiled: CompiledRoute[] = options.routes.map(def => ({
    definition: def,
    ...compilePattern(def.path),
  }))

  const currentPath = ref(window.location.pathname)

  const currentRoute = computed(() => matchRoute(currentPath.value, compiled))

  function resolvePath(to: RouteTarget): string {
    if (typeof to === 'string') return to
    const match = compiled.find(r => r.definition.name === to.name)
    if (!match) {
      console.warn(`[strav-router] Unknown route name: ${to.name}`)
      return '/'
    }
    return buildPath(match, to.params ?? {})
  }

  function push(to: RouteTarget): void {
    const path = resolvePath(to)
    history.pushState(null, '', path)
    currentPath.value = path
  }

  function replace(to: RouteTarget): void {
    const path = resolvePath(to)
    history.replaceState(null, '', path)
    currentPath.value = path
  }

  const router: RouterInstance = {
    push,
    replace,
    back: () => history.back(),
    forward: () => history.forward(),
    route: currentRoute,
  }

  // ---- RouterView --------------------------------------------------------

  const RouterView = defineComponent({
    name: 'RouterView',
    setup() {
      return () => {
        const r = currentRoute.value
        if (r.view && options.views[r.view]) {
          return h(options.views[r.view], r.resolvedProps)
        }
        if (options.fallback) {
          return h(options.fallback)
        }
        return null
      }
    },
  })

  // ---- RouterLink --------------------------------------------------------

  const RouterLink = defineComponent({
    name: 'RouterLink',
    props: {
      to: { type: [String, Object] as PropType<RouteTarget>, required: true },
      replace: { type: Boolean, default: false },
    },
    setup(props, { slots, attrs }) {
      const href = computed(() => resolvePath(props.to))

      const isActive = computed(() => {
        const h = href.value
        const p = currentRoute.value.path
        return p === h || p.startsWith(h + '/')
      })

      const isExactActive = computed(() => currentRoute.value.path === href.value)

      function onClick(e: MouseEvent) {
        if (e.metaKey || e.altKey || e.ctrlKey || e.shiftKey) return
        e.preventDefault()
        if (props.replace) {
          replace(href.value)
        } else {
          push(href.value)
        }
      }

      return () => h(
        'a',
        { href: href.value, onClick, ...attrs },
        slots.default?.({
          href: href.value,
          isActive: isActive.value,
          isExactActive: isExactActive.value,
          navigate: onClick,
        }),
      )
    },
  })

  // ---- Plugin install ----------------------------------------------------

  return {
    install(app: App) {
      window.addEventListener('popstate', () => {
        currentPath.value = window.location.pathname
      })

      app.provide(ROUTER_KEY, router)
      app.provide(ROUTE_KEY, currentRoute)

      app.component('RouterView', RouterView)
      app.component('RouterLink', RouterLink)

      // Backward compat: components that inject('navigate') still work
      app.provide('navigate', (to: string) => push(to))
    },
  }
}

// ---------------------------------------------------------------------------
// Composables
// ---------------------------------------------------------------------------

/** Access the router instance for programmatic navigation. */
export function useRouter(): RouterInstance {
  const router = inject(ROUTER_KEY)
  if (!router) throw new Error('[strav-router] useRouter() called outside of router context')
  return router
}

/** Access the current reactive route location. */
export function useRoute(): ComputedRef<RouteLocation> {
  const route = inject(ROUTE_KEY)
  if (!route) throw new Error('[strav-router] useRoute() called outside of router context')
  return route
}

export type { SpaRouteDefinition }

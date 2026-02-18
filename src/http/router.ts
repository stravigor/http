import type { ServerWebSocket } from 'bun'
import { app } from '@stravigor/kernel/core/application'
import Context from './context.ts'
import { resolveCorsConfig, preflightResponse, withCorsHeaders } from './cors.ts'
import type { CorsOptions, ResolvedCorsConfig } from './cors.ts'
import { compose } from './middleware.ts'
import type { Handler, Middleware } from './middleware.ts'
import type { ExceptionHandler } from '@stravigor/kernel/exceptions/exception_handler'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Constructor<T = any> = new (...args: any[]) => T

/** A controller–method pair: `[ControllerClass, 'methodName']`. */
export type ControllerAction = [Constructor, string]

/** Accepted as a route handler: a function or a `[Controller, 'method']` tuple. */
export type HandlerInput = Handler | ControllerAction

interface RouteDefinition {
  method: string
  pattern: string
  regex: RegExp
  paramNames: string[]
  handler: Handler
  middleware: Middleware[]
  name?: string
  subdomain?: string
  subdomainParamName?: string
}

export interface WebSocketHandlers {
  open?: (ws: ServerWebSocket<WebSocketData>) => void
  message?: (ws: ServerWebSocket<WebSocketData>, data: string | Buffer) => void
  close?: (ws: ServerWebSocket<WebSocketData>) => void
  drain?: (ws: ServerWebSocket<WebSocketData>) => void
}

export interface WebSocketData {
  handlers: WebSocketHandlers
  params: Record<string, string>
  request?: Request
}

interface WebSocketRoute {
  pattern: string
  regex: RegExp
  paramNames: string[]
  handlers: WebSocketHandlers
  subdomain?: string
  subdomainParamName?: string
}

export interface GroupOptions {
  prefix?: string
  middleware?: Middleware[]
  subdomain?: string
}

interface GroupState {
  prefix: string
  middleware: Middleware[]
  subdomain?: string
  subdomainParamName?: string
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Convert a route pattern to a RegExp and extract parameter names. */
function parsePattern(pattern: string): { regex: RegExp; paramNames: string[] } {
  const paramNames: string[] = []

  const regexStr = pattern
    // wildcard catch-all: *path → (.+)
    .replace(/\/\*(\w+)/, (_, name) => {
      paramNames.push(name)
      return '/(.+)'
    })
    // named params: :id → ([^/]+)
    .replace(/:(\w+)/g, (_, name) => {
      paramNames.push(name)
      return '([^/]+)'
    })

  return { regex: new RegExp(`^${regexStr}$`), paramNames }
}

/** Parse a subdomain pattern, extracting any dynamic parameter name. */
function parseSubdomain(pattern: string): { value: string; paramName?: string } {
  if (pattern.startsWith(':')) {
    return { value: pattern, paramName: pattern.slice(1) }
  }
  return { value: pattern }
}

// ---------------------------------------------------------------------------
// RouteRef — returned by route methods for chaining (.as)
// ---------------------------------------------------------------------------

class RouteRef {
  constructor(private route: RouteDefinition) {}

  /** Assign a name to this route (for future URL generation). */
  as(name: string): this {
    this.route.name = name
    return this
  }
}

// ---------------------------------------------------------------------------
// ResourceRegistrar — fluent builder returned by router.resource()
// ---------------------------------------------------------------------------

class ResourceRegistrar {
  private actions: Set<string> | null = null
  private isSingleton = false

  constructor(
    private router: Router,
    private path: string,
    private controller: Record<string, Handler>,
    private mw: Middleware[] | undefined,
    private groupSnapshot: GroupState | undefined
  ) {
    // Defer registration so .only() / .singleton() can be chained first.
    queueMicrotask(() => this.register())
  }

  /** Restrict to a subset of resource actions. */
  only(actions: string[]): this {
    this.actions = new Set(actions)
    return this
  }

  /** Register as a singleton resource (show, update, destroy — no `:id` param). */
  singleton(): this {
    this.isSingleton = true
    this.actions = new Set(['show', 'update', 'destroy'])
    return this
  }

  private register(): void {
    const has = (action: string) =>
      this.controller[action] && (!this.actions || this.actions.has(action))

    const bind = (method: Handler) => method.bind(this.controller)
    const p = this.path
    const suffix = this.isSingleton ? '' : '/:id'

    // Restore group state that was active at construction time
    if (this.groupSnapshot) this.router.groupStack.push(this.groupSnapshot)

    const routes = () => {
      if (has('index')) this.router.get(p, bind(this.controller.index!))
      if (has('store')) this.router.post(p, bind(this.controller.store!))
      if (has('show')) this.router.get(`${p}${suffix}`, bind(this.controller.show!))
      if (has('update')) {
        this.router.put(`${p}${suffix}`, bind(this.controller.update!))
        this.router.patch(`${p}${suffix}`, bind(this.controller.update!))
      }
      if (has('destroy')) this.router.delete(`${p}${suffix}`, bind(this.controller.destroy!))
    }

    if (this.mw?.length) {
      this.router.group({ prefix: '', middleware: this.mw }, routes)
    } else {
      routes()
    }

    if (this.groupSnapshot) this.router.groupStack.pop()
  }
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export default class Router {
  private routes: RouteDefinition[] = []
  private wsRoutes: WebSocketRoute[] = []
  private globalMiddleware: Middleware[] = []
  /** @internal Exposed for ResourceRegistrar deferred registration. */
  groupStack: GroupState[] = []
  private domain = 'localhost'
  private corsConfig: ResolvedCorsConfig | null = null
  private exceptionHandler: ExceptionHandler | null = null

  /** Set the base domain used for subdomain extraction. */
  setDomain(domain: string): void {
    this.domain = domain
  }

  /**
   * Enable CORS handling for the router.
   *
   * When configured, the router automatically responds to OPTIONS preflight
   * requests and adds CORS headers to all matched route responses.
   *
   * @example
   * router.cors({ origin: 'https://app.example.com', credentials: true })
   * router.cors({ origin: ['https://app.example.com', 'https://admin.example.com'] })
   * router.cors() // allow all origins
   */
  cors(options?: CorsOptions): void {
    this.corsConfig = resolveCorsConfig(options)
  }

  /**
   * Register an exception handler to catch thrown errors and convert them
   * to HTTP responses.
   *
   * @example
   * const handler = new ExceptionHandler(isDev)
   * router.useExceptionHandler(handler)
   */
  useExceptionHandler(handler: ExceptionHandler): void {
    this.exceptionHandler = handler
  }

  // ---- Global middleware ---------------------------------------------------

  /** Register middleware that runs on every request. */
  use(...middleware: Middleware[]): void {
    this.globalMiddleware.push(...middleware)
  }

  // ---- HTTP route methods --------------------------------------------------

  get(path: string, handler: HandlerInput): RouteRef {
    return this.addRoute('GET', path, handler)
  }

  post(path: string, handler: HandlerInput): RouteRef {
    return this.addRoute('POST', path, handler)
  }

  put(path: string, handler: HandlerInput): RouteRef {
    return this.addRoute('PUT', path, handler)
  }

  patch(path: string, handler: HandlerInput): RouteRef {
    return this.addRoute('PATCH', path, handler)
  }

  delete(path: string, handler: HandlerInput): RouteRef {
    return this.addRoute('DELETE', path, handler)
  }

  head(path: string, handler: HandlerInput): RouteRef {
    return this.addRoute('HEAD', path, handler)
  }

  options(path: string, handler: HandlerInput): RouteRef {
    return this.addRoute('OPTIONS', path, handler)
  }

  // ---- Resource routes ------------------------------------------------------

  /**
   * Register RESTful resource routes for a controller.
   *
   * Accepts either a controller instance or a class constructor.
   * When a class is passed, it is instantiated via {@link Container.make}
   * with automatic dependency injection.
   *
   * Only registers routes for methods that exist on the controller.
   * Returns a {@link ResourceRegistrar} for chaining `.only()` or `.singleton()`.
   *
   * @example
   * router.resource('/users', UserController)
   * router.resource('/posts', PostController).only(['index', 'show'])
   * router.resource('/settings', SettingController).singleton()
   */
  resource(
    path: string,
    controller: Record<string, Handler> | Constructor,
    middleware?: Middleware[]
  ): ResourceRegistrar {
    if (typeof controller === 'function') {
      controller = app.make(controller) as Record<string, Handler>
    }

    const group = this.currentGroup()
    return new ResourceRegistrar(
      this,
      path,
      controller,
      middleware,
      group ? { ...group } : undefined
    )
  }

  // ---- WebSocket routes ----------------------------------------------------

  /** Register a WebSocket route. */
  ws(path: string, handlers: WebSocketHandlers): void {
    const fullPath = this.currentPrefix() + path
    const { regex, paramNames } = parsePattern(fullPath)
    const group = this.currentGroup()

    this.wsRoutes.push({
      pattern: fullPath,
      regex,
      paramNames,
      handlers,
      subdomain: group?.subdomain,
      subdomainParamName: group?.subdomainParamName,
    })
  }

  // ---- Groups & subdomains -------------------------------------------------

  /**
   * Define a route group with shared prefix, middleware, or subdomain.
   *
   * @example
   * router.group({ prefix: '/api', middleware: [auth] }, (r) => {
   *   r.get('/users', listUsers)
   * })
   */
  group(options: GroupOptions, callback: (router: Router) => void): void {
    const parent = this.currentGroup()
    const prefix = (parent?.prefix ?? '') + (options.prefix ?? '')
    const middleware = [...(parent?.middleware ?? []), ...(options.middleware ?? [])]

    let subdomain = parent?.subdomain
    let subdomainParamName = parent?.subdomainParamName

    if (options.subdomain) {
      const parsed = parseSubdomain(options.subdomain)
      subdomain = parsed.value
      subdomainParamName = parsed.paramName
    }

    this.groupStack.push({ prefix, middleware, subdomain, subdomainParamName })
    callback(this)
    this.groupStack.pop()
  }

  /**
   * Define a subdomain-scoped group.
   *
   * @example
   * router.subdomain('api', (r) => {
   *   r.get('/data', apiData)       // api.example.com/data
   * })
   *
   * router.subdomain(':tenant', (r) => {
   *   r.get('/home', home)          // acme.example.com/home
   *                                 // ctx.params.tenant === 'acme'
   * })
   */
  subdomain(pattern: string, callback: (router: Router) => void): void {
    this.group({ subdomain: pattern }, callback)
  }

  // ---- Dispatch ------------------------------------------------------------

  /**
   * Match the incoming request and run the middleware pipeline + handler.
   * Returns `undefined` when a WebSocket upgrade succeeds.
   */
  handle(
    request: Request,
    server?: { upgrade(req: Request, opts?: unknown): boolean }
  ): Response | Promise<Response> | undefined {
    const url = new URL(request.url)
    const path = url.pathname
    const method = request.method
    const subdomain = this.extractSubdomain(request)

    // WebSocket routes (checked first)
    for (const wsRoute of this.wsRoutes) {
      if (!this.matchSubdomain(wsRoute, subdomain)) continue
      const match = wsRoute.regex.exec(path)
      if (!match) continue

      const params = this.extractParams(wsRoute.paramNames, match)
      if (wsRoute.subdomainParamName) params[wsRoute.subdomainParamName] = subdomain

      if (server?.upgrade(request, { data: { handlers: wsRoute.handlers, params, request } })) {
        return undefined
      }
    }

    // CORS preflight — auto-respond to OPTIONS when no explicit route handles it
    if (method === 'OPTIONS' && this.corsConfig) {
      const hasExplicit = this.routes.some(
        r => r.method === 'OPTIONS' && this.matchSubdomain(r, subdomain) && r.regex.test(path)
      )

      if (!hasExplicit) {
        const hasRoute = this.routes.some(
          r => this.matchSubdomain(r, subdomain) && r.regex.test(path)
        )

        if (hasRoute) {
          return preflightResponse(
            this.corsConfig,
            request.headers.get('origin'),
            request.headers.get('access-control-request-headers')
          )
        }
      }
    }

    // HTTP routes
    for (const route of this.routes) {
      if (route.method !== method) continue
      if (!this.matchSubdomain(route, subdomain)) continue

      const match = route.regex.exec(path)
      if (!match) continue

      const params = this.extractParams(route.paramNames, match)
      if (route.subdomainParamName) params[route.subdomainParamName] = subdomain

      const ctx = new Context(request, params, this.domain)
      const allMiddleware = [...this.globalMiddleware, ...route.middleware]

      let result: Response | Promise<Response>
      try {
        if (allMiddleware.length === 0) {
          result = route.handler(ctx)
        } else {
          result = compose(allMiddleware, route.handler)(ctx)
        }

        if (result instanceof Promise) {
          result = result.catch(err => this.handleError(err, ctx))
        }
      } catch (err) {
        result = this.handleError(err, ctx)
      }

      if (this.corsConfig) {
        const corsConfig = this.corsConfig
        const requestOrigin = request.headers.get('origin')
        if (result instanceof Promise) {
          return result.then(res => withCorsHeaders(res, corsConfig, requestOrigin))
        }
        return withCorsHeaders(result, corsConfig, requestOrigin)
      }

      return result
    }

    return new Response('Not Found', { status: 404 })
  }

  /**
   * Returns a generic WebSocket handler object for Bun.serve().
   * Dispatches events to the route-specific handlers stored in `ws.data`.
   */
  websocketHandler(): {
    open: (ws: ServerWebSocket<WebSocketData>) => void
    message: (ws: ServerWebSocket<WebSocketData>, data: string | Buffer) => void
    close: (ws: ServerWebSocket<WebSocketData>) => void
    drain: (ws: ServerWebSocket<WebSocketData>) => void
  } {
    return {
      open(ws) {
        ws.data?.handlers?.open?.(ws)
      },
      message(ws, message) {
        ws.data?.handlers?.message?.(ws, message)
      },
      close(ws) {
        ws.data?.handlers?.close?.(ws)
      },
      drain(ws) {
        ws.data?.handlers?.drain?.(ws)
      },
    }
  }

  // ---- Error handling ------------------------------------------------------

  private handleError(err: unknown, ctx: Context): Response {
    if (this.exceptionHandler) return this.exceptionHandler.handle(err, ctx)
    console.error('Unhandled error:', err)
    return new Response('Internal Server Error', { status: 500 })
  }

  // ---- Internal helpers ----------------------------------------------------

  private currentGroup(): GroupState | undefined {
    return this.groupStack[this.groupStack.length - 1]
  }

  private currentPrefix(): string {
    return this.currentGroup()?.prefix ?? ''
  }

  /** Resolve a `[Controller, 'method']` tuple into a Handler. */
  private toHandler(input: HandlerInput): Handler {
    if (Array.isArray(input)) {
      const [Ctor, method] = input
      const instance = app.has(Ctor) ? app.resolve(Ctor) : app.make(Ctor)
      return ctx => instance[method](ctx)
    }
    return input
  }

  private addRoute(method: string, path: string, handler: HandlerInput): RouteRef {
    const fullPath = this.currentPrefix() + path
    const { regex, paramNames } = parsePattern(fullPath)
    const group = this.currentGroup()

    const route: RouteDefinition = {
      method,
      pattern: fullPath,
      regex,
      paramNames,
      handler: this.toHandler(handler),
      middleware: group?.middleware ? [...group.middleware] : [],
      subdomain: group?.subdomain,
      subdomainParamName: group?.subdomainParamName,
    }

    this.routes.push(route)
    return new RouteRef(route)
  }

  private extractSubdomain(request: Request): string {
    const host = request.headers.get('host') ?? ''
    const hostname = host.split(':')[0] ?? ''

    if (hostname.endsWith(this.domain) && hostname.length > this.domain.length) {
      return hostname.slice(0, -(this.domain.length + 1))
    }

    return ''
  }

  private matchSubdomain(
    route: { subdomain?: string; subdomainParamName?: string },
    subdomain: string
  ): boolean {
    if (!route.subdomain) return true
    if (route.subdomainParamName) return subdomain.length > 0
    return route.subdomain === subdomain
  }

  private extractParams(names: string[], match: RegExpExecArray): Record<string, string> {
    const params: Record<string, string> = {}
    for (let i = 0; i < names.length; i++) {
      params[names[i]!] = match[i + 1]!
    }
    return params
  }
}

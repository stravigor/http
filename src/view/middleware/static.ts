import { resolve, normalize } from 'node:path'
import type { Middleware } from '../../http/middleware.ts'

export function staticFiles(root = 'public'): Middleware {
  const resolvedRoot = resolve(root)

  return async (ctx, next) => {
    // Only serve GET/HEAD requests
    if (ctx.method !== 'GET' && ctx.method !== 'HEAD') {
      return next()
    }

    // Skip hidden files (segments starting with .)
    const segments = ctx.path.split('/')
    if (segments.some(s => s.startsWith('.') && s.length > 1)) {
      return next()
    }

    // Skip pre-compressed files (served via content negotiation only)
    if (ctx.path.endsWith('.gz') || ctx.path.endsWith('.br')) {
      return next()
    }

    const filePath = normalize(resolve(resolvedRoot + ctx.path))

    // Directory traversal protection
    if (!filePath.startsWith(resolvedRoot)) {
      return next()
    }

    const file = Bun.file(filePath)
    const exists = await file.exists()

    if (!exists) {
      return next()
    }

    // Content negotiation for pre-compressed files
    const acceptEncoding = ctx.request.headers.get('accept-encoding') ?? ''

    if (acceptEncoding.includes('br')) {
      const brFile = Bun.file(filePath + '.br')
      if (await brFile.exists()) {
        return new Response(brFile, {
          headers: {
            'Content-Encoding': 'br',
            'Content-Type': file.type,
            Vary: 'Accept-Encoding',
          },
        })
      }
    }

    if (acceptEncoding.includes('gzip')) {
      const gzFile = Bun.file(filePath + '.gz')
      if (await gzFile.exists()) {
        return new Response(gzFile, {
          headers: {
            'Content-Encoding': 'gzip',
            'Content-Type': file.type,
            Vary: 'Accept-Encoding',
          },
        })
      }
    }

    return new Response(file)
  }
}

import type Context from '../http/context.ts'
import type { Next } from '../http/middleware.ts'
import type { Middleware } from '../http/middleware.ts'
import I18nManager from '@stravigor/kernel/i18n/i18n_manager'
import { localeStorage } from '@stravigor/kernel/i18n/helpers'

/**
 * i18n middleware — detects the request locale and sets it for the
 * duration of the request via `AsyncLocalStorage`.
 *
 * Detection strategies are tried in the order configured in `config/i18n.ts`.
 *
 * @example
 * import { i18n } from '@stravigor/http/middleware/i18n'
 * router.use(i18n())
 */
export function i18n(): Middleware {
  return (ctx: Context, next: Next) => {
    const detected = detectLocale(ctx)
    return localeStorage.run(detected, () => next())
  }
}

/**
 * Detect locale from the request using configured strategies.
 * Falls back to the default locale if no strategy matches.
 */
function detectLocale(ctx: Context): string {
  const config = I18nManager.config
  const supported = config.supported

  for (const strategy of config.detect) {
    switch (strategy) {
      case 'query': {
        const lang = ctx.query.get('lang') ?? ctx.query.get('locale')
        if (lang && supported.includes(lang)) return lang
        break
      }
      case 'cookie': {
        const cookie = ctx.cookie('locale')
        if (cookie && supported.includes(cookie)) return cookie
        break
      }
      case 'header': {
        const match = parseAcceptLanguage(ctx.headers.get('accept-language'), supported)
        if (match) return match
        break
      }
    }
  }

  return config.default
}

/**
 * Parse the Accept-Language header and return the best match
 * against supported locales.
 *
 * @example
 * parseAcceptLanguage('fr-FR,fr;q=0.9,en;q=0.8', ['en', 'fr'])  // 'fr'
 */
export function parseAcceptLanguage(header: string | null, supported: string[]): string | null {
  if (!header) return null

  // Parse entries like "fr-FR,fr;q=0.9,en-US;q=0.8,en;q=0.7"
  const entries = header
    .split(',')
    .map(part => {
      const [tag = '', ...rest] = part.trim().split(';')
      const qPart = rest.find(r => r.trim().startsWith('q='))
      const q = qPart ? parseFloat(qPart.trim().slice(2)) : 1.0
      return { tag: tag.trim().toLowerCase(), q: Number.isNaN(q) ? 0 : q }
    })
    .sort((a, b) => b.q - a.q)

  // Try exact match first, then base language (e.g. 'fr-FR' → 'fr')
  for (const { tag } of entries) {
    if (supported.includes(tag)) return tag
    const base = tag.split('-')[0]!
    if (supported.includes(base)) return base
  }

  return null
}

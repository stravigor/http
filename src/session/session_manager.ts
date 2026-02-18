import { inject } from '@stravigor/kernel/core/inject'
import { ConfigurationError } from '@stravigor/kernel/exceptions/errors'
import Configuration from '@stravigor/kernel/config/configuration'
import Database from '@stravigor/database/database/database'

export interface SessionConfig {
  cookie: string
  lifetime: number
  httpOnly: boolean
  secure: boolean
  sameSite: 'strict' | 'lax' | 'none'
}

/**
 * Central session configuration hub.
 *
 * Resolved once via the DI container — stores the database reference
 * and parsed config for Session and the session middleware.
 *
 * @example
 * app.singleton(SessionManager)
 * app.resolve(SessionManager)
 * await SessionManager.ensureTable()
 */
@inject
export default class SessionManager {
  private static _db: Database
  private static _config: SessionConfig

  constructor(db: Database, config: Configuration) {
    SessionManager._db = db
    SessionManager._config = {
      cookie: 'strav_session',
      lifetime: 120,
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      ...(config.get('session', {}) as object),
    }
  }

  static get db(): Database {
    if (!SessionManager._db) {
      throw new ConfigurationError(
        'SessionManager not configured. Resolve it through the container first.'
      )
    }
    return SessionManager._db
  }

  static get config(): SessionConfig {
    return SessionManager._config
  }

  /** Create the sessions table if it does not exist. */
  static async ensureTable(): Promise<void> {
    await SessionManager.db.sql`
      CREATE TABLE IF NOT EXISTS "_strav_sessions" (
        "id"            UUID PRIMARY KEY,
        "user_id"       VARCHAR(255),
        "csrf_token"    VARCHAR(64) NOT NULL,
        "data"          JSONB NOT NULL DEFAULT '{}',
        "ip_address"    VARCHAR(45),
        "user_agent"    TEXT,
        "last_activity" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        "created_at"    TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `
  }

  /** Delete all expired sessions. Call periodically for housekeeping. */
  static async gc(): Promise<number> {
    const lifetimeMs = SessionManager.config.lifetime * 60_000
    const cutoff = new Date(Date.now() - lifetimeMs)

    const rows = await SessionManager.db.sql`
      DELETE FROM "_strav_sessions"
      WHERE "last_activity" < ${cutoff}
      RETURNING "id"
    `
    return rows.length
  }
}

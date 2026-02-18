import Auth, { extractUserId, randomHex } from './auth.ts'

/** The DB record for an access token (never contains the plain token). */
export interface AccessTokenData {
  id: number
  userId: string
  name: string
  lastUsedAt: Date | null
  expiresAt: Date | null
  createdAt: Date
}

function hashToken(plain: string): string {
  return new Bun.CryptoHasher('sha256').update(plain).digest('hex')
}

/**
 * Opaque, SHA-256-hashed access tokens stored in the database.
 *
 * The plain-text token is returned exactly once at creation time and
 * is never stored. Even if the database leaks, tokens cannot be recovered.
 *
 * @example
 * // Create
 * const { token, accessToken } = await AccessToken.create(user, 'mobile-app')
 * // token = 'a1b2c3...' (give to the client, shown once)
 *
 * // Validate (used internally by the auth middleware)
 * const record = await AccessToken.validate(plainToken)
 *
 * // Revoke
 * await AccessToken.revoke(accessToken.id)
 */
export default class AccessToken {
  /**
   * Generate a new access token for the given user.
   * Returns the plain-text token (shown once) and the database record.
   */
  static async create(
    user: unknown,
    name: string
  ): Promise<{ token: string; accessToken: AccessTokenData }> {
    const userId = extractUserId(user)
    const plain = randomHex(32) // 64-char hex string
    const hash = hashToken(plain)

    const expCfg = Auth.config.token.expiration
    const expiresAt = expCfg ? new Date(Date.now() + expCfg * 60_000) : null

    const rows = await Auth.db.sql`
      INSERT INTO "_strav_access_tokens" ("user_id", "name", "token", "expires_at")
      VALUES (${userId}, ${name}, ${hash}, ${expiresAt})
      RETURNING *
    `

    return {
      token: plain,
      accessToken: AccessToken.hydrate(rows[0] as Record<string, unknown>),
    }
  }

  /**
   * Validate a plain-text token. Returns the token record if valid, null otherwise.
   * Automatically rejects expired tokens and updates last_used_at.
   */
  static async validate(plainToken: string): Promise<AccessTokenData | null> {
    const hash = hashToken(plainToken)

    const rows = await Auth.db.sql`
      SELECT * FROM "_strav_access_tokens" WHERE "token" = ${hash} LIMIT 1
    `
    if (rows.length === 0) return null

    const record = AccessToken.hydrate(rows[0] as Record<string, unknown>)

    if (record.expiresAt && record.expiresAt.getTime() < Date.now()) {
      return null
    }

    // Update last_used_at (fire-and-forget)
    Auth.db.sql`
      UPDATE "_strav_access_tokens"
      SET "last_used_at" = NOW()
      WHERE "id" = ${record.id}
    `.then(
      () => {},
      () => {}
    )

    return record
  }

  /** Revoke (delete) a single token by its database ID. */
  static async revoke(id: number): Promise<void> {
    await Auth.db.sql`
      DELETE FROM "_strav_access_tokens" WHERE "id" = ${id}
    `
  }

  /** Revoke all tokens belonging to a user. */
  static async revokeAllFor(user: unknown): Promise<void> {
    const userId = extractUserId(user)
    await Auth.db.sql`
      DELETE FROM "_strav_access_tokens" WHERE "user_id" = ${userId}
    `
  }

  // ---------------------------------------------------------------------------
  // Internal
  // ---------------------------------------------------------------------------

  private static hydrate(row: Record<string, unknown>): AccessTokenData {
    return {
      id: row.id as number,
      userId: row.user_id as string,
      name: row.name as string,
      lastUsedAt: (row.last_used_at as Date) ?? null,
      expiresAt: (row.expires_at as Date) ?? null,
      createdAt: row.created_at as Date,
    }
  }
}

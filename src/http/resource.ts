import { DateTime } from 'luxon'
import type { PaginationResult, PaginationMeta } from '@stravigor/database/database/query_builder'

// ---------------------------------------------------------------------------
// Resource base class
// ---------------------------------------------------------------------------

/**
 * Base class for API resources (serializers).
 *
 * Subclass and implement `define()` to control the shape of JSON output
 * for a model. Use the static helpers to transform model instances into
 * plain objects ready for `ctx.json()`.
 *
 * @example
 * class UserResource extends Resource<User> {
 *   define(user: User) {
 *     return {
 *       id: user.id,
 *       name: user.name,
 *       email: user.email,
 *       createdAt: user.createdAt,
 *     }
 *   }
 * }
 *
 * return ctx.json(UserResource.make(user))
 * return ctx.json(UserResource.collection(users))
 * return ctx.json(UserResource.paginate(paginatedResult))
 */
export abstract class Resource<T> {
  /**
   * Define the serialized shape for a single model instance.
   * Return a plain object with the desired keys and values.
   * DateTime values are automatically converted to ISO 8601 strings.
   */
  abstract define(model: T): Record<string, unknown>

  /**
   * Transform a single model instance into a plain serializable object.
   * Returns `null` if the input is `null` or `undefined`.
   */
  static make<T>(
    this: new () => Resource<T>,
    model: T | null | undefined
  ): Record<string, unknown> | null {
    if (model === null || model === undefined) return null
    const instance = new this()
    return serialize(instance.define(model))
  }

  /**
   * Transform an array of model instances into an array of plain objects.
   */
  static collection<T>(this: new () => Resource<T>, models: T[]): Record<string, unknown>[] {
    const instance = new this()
    return models.map(model => serialize(instance.define(model)))
  }

  /**
   * Transform a PaginationResult into a serialized pagination envelope.
   * Preserves the `meta` object and serializes each item in `data`.
   */
  static paginate<T>(
    this: new () => Resource<T>,
    result: PaginationResult<T>
  ): { data: Record<string, unknown>[]; meta: PaginationMeta } {
    const instance = new this()
    return {
      data: result.data.map(model => serialize(instance.define(model))),
      meta: result.meta,
    }
  }
}

// ---------------------------------------------------------------------------
// Serialization helpers
// ---------------------------------------------------------------------------

/** Recursively serialize a plain object, converting DateTime → ISO string. */
function serialize(obj: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(obj)) {
    result[key] = serializeValue(value)
  }
  return result
}

function serializeValue(value: unknown): unknown {
  if (value === null || value === undefined) return value
  if (value instanceof DateTime) return value.toISO()
  if (typeof value === 'bigint') {
    return value <= Number.MAX_SAFE_INTEGER && value >= Number.MIN_SAFE_INTEGER
      ? Number(value)
      : String(value)
  }
  if (Array.isArray(value)) return value.map(serializeValue)
  if (typeof value === 'object' && value !== null && value.constructor === Object) {
    return serialize(value as Record<string, unknown>)
  }
  return value
}

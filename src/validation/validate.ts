import type { Rule } from './rules.ts'

export type RuleSet = Record<string, Rule[]>

export interface ValidationResult<T = Record<string, unknown>> {
  data: T
  errors: Record<string, string[]> | null
}

export function validate<T = Record<string, unknown>>(
  input: unknown,
  rules: RuleSet
): ValidationResult<T> {
  const record = (typeof input === 'object' && input !== null ? input : {}) as Record<
    string,
    unknown
  >
  const data: Record<string, unknown> = {}
  const errors: Record<string, string[]> = {}
  let hasErrors = false

  for (const [field, fieldRules] of Object.entries(rules)) {
    const value = record[field]
    if (value !== undefined) data[field] = value

    for (const rule of fieldRules) {
      const error = rule.validate(value)
      if (error) {
        if (!errors[field]) errors[field] = []
        errors[field]!.push(error)
        hasErrors = true
        break // stop at first error per field
      }
    }
  }

  return {
    data: data as T,
    errors: hasErrors ? errors : null,
  }
}

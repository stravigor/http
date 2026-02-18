export type PolicyResult = {
  allowed: boolean
  status: number
  reason: string
}

export function allow(): PolicyResult {
  return { allowed: true, status: 200, reason: '' }
}

export function deny(status = 403, reason = 'Action forbidden'): PolicyResult {
  return { allowed: false, status, reason }
}

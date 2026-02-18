const replacements: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
}

const pattern = /[&<>"']/g

export function escapeHtml(value: unknown): string {
  const str = String(value ?? '')
  return str.replace(pattern, ch => replacements[ch]!)
}

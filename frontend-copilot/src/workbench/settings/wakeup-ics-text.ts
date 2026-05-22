const UTF8_BOM_PREFIX = /^\uFEFF/u

export function normalizeWakeupIcsText(value: string): string {
  return value.replace(UTF8_BOM_PREFIX, '').trim()
}

export function isWakeupIcsText(value: string): boolean {
  return normalizeWakeupIcsText(value).startsWith('BEGIN:VCALENDAR')
}

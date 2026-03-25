export function collectSensitiveValues(...values: Array<string | null | undefined>): string[] {
  const normalizedValues = values
    .map((value) => typeof value === 'string' ? value.trim() : '')
    .filter((value) => value !== '')

  return Array.from(new Set(normalizedValues)).sort((left, right) => right.length - left.length)
}

export function redactSensitiveText(text: string, sensitiveValues: string[]): string {
  return sensitiveValues.reduce((currentText, sensitiveValue) => {
    return sensitiveValue === '' ? currentText : currentText.split(sensitiveValue).join('[REDACTED]')
  }, text)
}

export function redactSensitiveValue<T>(value: T, sensitiveValues: string[]): T {
  if (typeof value === 'string') {
    return redactSensitiveText(value, sensitiveValues) as T
  }

  if (Array.isArray(value)) {
    return value.map((item) => redactSensitiveValue(item, sensitiveValues)) as T
  }

  if (value instanceof Error) {
    return {
      name: value.name,
      message: redactSensitiveText(value.message, sensitiveValues),
      stack: typeof value.stack === 'string' ? redactSensitiveText(value.stack, sensitiveValues) : undefined,
    } as T
  }

  if (isPlainObject(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, redactSensitiveValue(item, sensitiveValues)]),
    ) as T
  }

  return value
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && Object.getPrototypeOf(value) === Object.prototype
}

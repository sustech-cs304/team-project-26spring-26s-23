export function normalizeStringGroup<TGroup extends Record<string, string>>(input: unknown, defaults: TGroup): TGroup {
  const record = asRecord(input)

  return Object.fromEntries(
    Object.entries(defaults).map(([key, defaultValue]) => [key, normalizeNonEmptyString(record[key], defaultValue)]),
  ) as TGroup
}

export function normalizeBooleanStringGroup<TGroup extends Record<string, boolean | string>>(
  input: unknown,
  defaults: TGroup,
): TGroup {
  const record = asRecord(input)

  return Object.fromEntries(
    Object.entries(defaults).map(([key, defaultValue]) => {
      return [
        key,
        typeof defaultValue === 'boolean'
          ? normalizeBoolean(record[key], defaultValue)
          : normalizeNonEmptyString(record[key], defaultValue),
      ]
    }),
  ) as TGroup
}

export function normalizeNonEmptyString(input: unknown, fallback: string): string {
  const normalized = normalizeString(input, fallback)
  return normalized === '' ? fallback : normalized
}

export function normalizeString(input: unknown, fallback: string): string {
  return typeof input === 'string' ? input.trim() : fallback
}

export function normalizeBoolean(input: unknown, fallback: boolean): boolean {
  return typeof input === 'boolean' ? input : fallback
}

export function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? value as Record<string, unknown> : {}
}

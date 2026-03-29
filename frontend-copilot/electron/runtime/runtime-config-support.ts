export function normalizeOptionalString(value: string | null | undefined): string | undefined {
  if (typeof value !== 'string') {
    return undefined
  }

  const normalizedValue = value.trim()
  return normalizedValue === '' ? undefined : normalizedValue
}

export function splitCommandLineFlagValue(token: string): [string, string | undefined] {
  const equalsIndex = token.indexOf('=')
  if (equalsIndex === -1) {
    return [token, undefined]
  }

  return [token.slice(0, equalsIndex), token.slice(equalsIndex + 1)]
}

export function appendCommandLineArgument(
  args: string[],
  flag: string,
  value: string | number | { toString(): string } | null | undefined,
): void {
  const normalizedValue = value === null || value === undefined
    ? undefined
    : normalizeOptionalString(String(value))

  if (normalizedValue === undefined) {
    return
  }

  args.push(flag, normalizedValue)
}

export function stripEnvironmentKeys(
  baseEnv: NodeJS.ProcessEnv,
  keysToStrip: readonly string[],
): NodeJS.ProcessEnv {
  const nextEnv: NodeJS.ProcessEnv = { ...baseEnv }

  for (const key of keysToStrip) {
    delete nextEnv[key]
  }

  return nextEnv
}

export function parseIntegerOverride(value: string | undefined): number | undefined {
  const normalizedValue = normalizeOptionalString(value)
  if (normalizedValue === undefined) {
    return undefined
  }

  const parsedValue = Number.parseInt(normalizedValue, 10)
  return Number.isFinite(parsedValue) ? parsedValue : undefined
}

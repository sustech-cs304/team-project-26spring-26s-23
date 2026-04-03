import {
  HOSTED_RUNTIME_MAIN_PROCESS_ARGUMENT_FLAGS,
  HOSTED_RUNTIME_MAIN_PROCESS_ARGUMENT_NAMES,
} from './runtime-config-flags'
import {
  normalizeOptionalString,
  splitCommandLineFlagValue,
} from './runtime-config-support'

export interface HostedRuntimeCommandLineOptions {
  host?: string
  appMode?: string
  environment?: string
  localToken?: string
}

export interface HostedRuntimeCommandLineParseWarning {
  code: 'invalid-hosted-runtime-command-line-arguments'
  detail: string
  flag?: string
}

class HostedRuntimeCommandLineArgumentError extends Error {
  constructor(readonly flag: string) {
    super(`Missing value for hosted runtime option ${flag}.`)
    this.name = 'HostedRuntimeCommandLineArgumentError'
  }
}

export function collectForwardedElectronMainProcessArguments(
  argv: readonly string[],
): string[] {
  const separatorIndex = argv.indexOf('--')
  const candidateArgs = separatorIndex === -1
    ? argv
    : argv.slice(separatorIndex + 1)

  const forwardedArgs: string[] = []

  for (let index = 0; index < candidateArgs.length; index += 1) {
    const token = candidateArgs[index]
    if (typeof token !== 'string') {
      continue
    }

    const [flag, inlineValue] = splitCommandLineFlagValue(token)
    if (!HOSTED_RUNTIME_MAIN_PROCESS_ARGUMENT_FLAGS.has(flag)) {
      continue
    }

    forwardedArgs.push(token)

    if (inlineValue !== undefined) {
      continue
    }

    const nextValue = candidateArgs[index + 1]
    if (typeof nextValue === 'string' && nextValue.trim() !== '' && !nextValue.startsWith('--')) {
      forwardedArgs.push(nextValue)
      index += 1
    }
  }

  return forwardedArgs
}

export function parseHostedRuntimeCommandLineArguments(
  argv: readonly string[],
): HostedRuntimeCommandLineOptions {
  const options: HostedRuntimeCommandLineOptions = {}

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]
    if (typeof token !== 'string') {
      continue
    }

    const [flag, inlineValue] = splitCommandLineFlagValue(token)

    switch (flag) {
      case HOSTED_RUNTIME_MAIN_PROCESS_ARGUMENT_NAMES.HOST: {
        const { nextIndex, value } = readCommandLineFlagValue(argv, index, flag, inlineValue)
        options.host = value
        index = nextIndex
        break
      }
      case HOSTED_RUNTIME_MAIN_PROCESS_ARGUMENT_NAMES.APP_MODE: {
        const { nextIndex, value } = readCommandLineFlagValue(argv, index, flag, inlineValue)
        options.appMode = value
        index = nextIndex
        break
      }
      case HOSTED_RUNTIME_MAIN_PROCESS_ARGUMENT_NAMES.ENVIRONMENT: {
        const { nextIndex, value } = readCommandLineFlagValue(argv, index, flag, inlineValue)
        options.environment = value
        index = nextIndex
        break
      }
      case HOSTED_RUNTIME_MAIN_PROCESS_ARGUMENT_NAMES.LOCAL_TOKEN: {
        const { nextIndex, value } = readCommandLineFlagValue(argv, index, flag, inlineValue)
        options.localToken = value
        index = nextIndex
        break
      }
      default:
        break
    }
  }

  return options
}

export function parseHostedRuntimeCommandLineArgumentsSafely(
  argv: readonly string[],
): { options: HostedRuntimeCommandLineOptions, warning: HostedRuntimeCommandLineParseWarning | null } {
  try {
    return {
      options: parseHostedRuntimeCommandLineArguments(argv),
      warning: null,
    }
  } catch (error) {
    return {
      options: {},
      warning: buildHostedRuntimeCommandLineParseWarning(error),
    }
  }
}

function readCommandLineFlagValue(
  argv: readonly string[],
  index: number,
  flag: string,
  inlineValue?: string,
): { value: string | undefined, nextIndex: number } {
  if (inlineValue !== undefined) {
    return {
      value: normalizeOptionalString(inlineValue),
      nextIndex: index,
    }
  }

  const nextValue = argv[index + 1]
  if (
    typeof nextValue !== 'string'
    || nextValue.trim() === ''
    || nextValue.startsWith('--')
    || HOSTED_RUNTIME_MAIN_PROCESS_ARGUMENT_FLAGS.has(nextValue)
  ) {
    throw new HostedRuntimeCommandLineArgumentError(flag)
  }

  return {
    value: normalizeOptionalString(nextValue),
    nextIndex: index + 1,
  }
}

function buildHostedRuntimeCommandLineParseWarning(error: unknown): HostedRuntimeCommandLineParseWarning {
  const warning: HostedRuntimeCommandLineParseWarning = {
    code: 'invalid-hosted-runtime-command-line-arguments',
    detail: error instanceof Error ? error.message : String(error),
  }

  if (error instanceof HostedRuntimeCommandLineArgumentError) {
    warning.flag = error.flag
  }

  return warning
}

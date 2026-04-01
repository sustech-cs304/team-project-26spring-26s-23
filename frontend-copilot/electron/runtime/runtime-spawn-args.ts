import type { HostedRuntimePaths } from './runtime-paths'
import { DESKTOP_RUNTIME_ARGUMENT_NAMES } from './runtime-config-flags'
import { appendCommandLineArgument } from './runtime-config-support'

export interface DesktopRuntimeArgumentInput {
  host: string
  port: number
  localToken: string
  hostModelRouteBridgeUrl: string | null
  hostModelRouteBridgeToken: string | null
  appMode: string
  environment: string
  paths: HostedRuntimePaths
}

export function buildDesktopRuntimeArguments(input: DesktopRuntimeArgumentInput): string[] {
  const args: string[] = []

  appendCommandLineArgument(args, DESKTOP_RUNTIME_ARGUMENT_NAMES.HOST, input.host)
  appendCommandLineArgument(args, DESKTOP_RUNTIME_ARGUMENT_NAMES.PORT, input.port)
  appendCommandLineArgument(args, DESKTOP_RUNTIME_ARGUMENT_NAMES.APP_MODE, input.appMode)
  appendCommandLineArgument(args, DESKTOP_RUNTIME_ARGUMENT_NAMES.ENVIRONMENT, input.environment)
  appendCommandLineArgument(args, DESKTOP_RUNTIME_ARGUMENT_NAMES.ROOT_DIR, input.paths.runtimeRootDir)
  appendCommandLineArgument(args, DESKTOP_RUNTIME_ARGUMENT_NAMES.USER_DATA_DIR, input.paths.userDataDir)
  appendCommandLineArgument(args, DESKTOP_RUNTIME_ARGUMENT_NAMES.CONFIG_DIR, input.paths.configDir)
  appendCommandLineArgument(args, DESKTOP_RUNTIME_ARGUMENT_NAMES.LOGS_DIR, input.paths.logsDir)
  appendCommandLineArgument(args, DESKTOP_RUNTIME_ARGUMENT_NAMES.DATABASE_DIR, input.paths.databaseDir)
  appendCommandLineArgument(args, DESKTOP_RUNTIME_ARGUMENT_NAMES.STATE_DIR, input.paths.stateDir)
  appendCommandLineArgument(args, DESKTOP_RUNTIME_ARGUMENT_NAMES.SETTINGS_FILE, input.paths.copilotSettingsFile)
  appendCommandLineArgument(args, DESKTOP_RUNTIME_ARGUMENT_NAMES.HOST_LOG_FILE, input.paths.hostLogFile)
  appendCommandLineArgument(args, DESKTOP_RUNTIME_ARGUMENT_NAMES.BACKEND_STDOUT_LOG_FILE, input.paths.backendStdoutLogFile)
  appendCommandLineArgument(args, DESKTOP_RUNTIME_ARGUMENT_NAMES.BACKEND_STDERR_LOG_FILE, input.paths.backendStderrLogFile)
  appendCommandLineArgument(args, DESKTOP_RUNTIME_ARGUMENT_NAMES.RUNTIME_SNAPSHOT_FILE, input.paths.runtimeSnapshotFile)
  appendCommandLineArgument(args, DESKTOP_RUNTIME_ARGUMENT_NAMES.LAST_FAILURE_FILE, input.paths.lastFailureFile)
  appendCommandLineArgument(
    args,
    DESKTOP_RUNTIME_ARGUMENT_NAMES.HOST_MODEL_ROUTE_BRIDGE_URL,
    input.hostModelRouteBridgeUrl,
  )
  appendCommandLineArgument(
    args,
    DESKTOP_RUNTIME_ARGUMENT_NAMES.HOST_MODEL_ROUTE_BRIDGE_TOKEN,
    input.hostModelRouteBridgeToken,
  )
  appendCommandLineArgument(args, DESKTOP_RUNTIME_ARGUMENT_NAMES.LOCAL_TOKEN, input.localToken)

  return args
}

export function buildPythonRuntimeSpawnArguments(
  launchSpecArgs: readonly string[],
  runtimeArgs: readonly string[],
): string[] {
  return [...launchSpecArgs, ...runtimeArgs]
}

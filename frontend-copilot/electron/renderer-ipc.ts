export {
  MAIN_PROCESS_RUNTIME_CONSOLE_CHANNEL,
  type ConsoleLike,
  type IpcRendererLike,
  type RuntimeConsoleEntry,
  type RuntimeConsoleLevel,
} from './renderer-ipc-contract'
export { registerRendererIpcHandlers, type RendererIpcHandlers } from './renderer-ipc-registration'
export { registerRuntimeConsoleForwarding, writeRuntimeConsoleEntryToBrowserConsole } from './runtime-console-forwarding'
export { shouldWriteRuntimeConsoleEntryToTerminal, writeRuntimeConsoleEntryToTerminal } from './runtime-console-terminal'

/* eslint-disable react-refresh/only-export-components */

export type {
  AssistantWorkspaceShellProps as AssistantWorkspaceProps,
} from './shell/AssistantWorkspaceShell'
export {
  AssistantWorkspaceShell as AssistantWorkspace,
} from './shell/AssistantWorkspaceShell'
export type {
  AssistantAgentDirectoryState,
  AssistantSessionListState,
} from './assistant-workspace-controller'
export {
  createAssistantAgentDirectoryState,
  createAssistantSessionCapabilities,
  createAssistantSessionShell,
} from './assistant-workspace-controller'
export { createAssistantSessionShellForAgent } from './assistant-workspace-session-controller'
export {
  appendAssistantSessionShell,
  createAssistantSessionListState,
  moveAssistantSessionShellToIndex,
  reorderAssistantSessionShells,
  resolveActiveAssistantSessionShell,
} from './assistant-session-helpers'

import type { AssistantAgentDirectoryState } from '../../../workbench/assistant/assistant-workspace-controller'
import type { AgentType, AssistantSessionShell } from '../../../workbench/types'
import type { CopilotBootstrapState, CopilotDiagnosticsSummary } from '../types'

// Duplicate-string constants extracted for sonarjs/no-duplicate-string
const LABEL_TOOL_READ = 'tool.fs.read'


interface SessionShellOverrides {
  sessionId?: string
  boundAgent?: Partial<AgentType>
  createdAt?: string
  updatedAt?: string
  capabilities?: Partial<AssistantSessionShell['capabilities']>
}

export function createDiagnosticsSummary(
  overrides: Partial<CopilotDiagnosticsSummary> = {},
): CopilotDiagnosticsSummary {
  return {
    hostedStatus: 'ready',
    failure: null,
    mode: 'development',
    modeSource: 'resolved',
    runtimeSource: 'hosted',
    ...overrides,
  }
}

function createBaseResolvedState(): Omit<Extract<CopilotBootstrapState, { status: 'ready' }>, 'status'> {
  return {
    bootstrapFields: {
      runtimeUrl: 'http://127.0.0.1:8765',
      agentName: null,
      debugModeEnabled: false,
    },
    storageState: 'stored',
    runtime: {
      status: 'ready',
      expectedMode: 'development',
      resolvedMode: 'development',
      runtimeUrl: 'http://127.0.0.1:8765',
      isPackaged: false,
      failure: null,
    },
    runtimeUrl: 'http://127.0.0.1:8765',
    runtimeSource: 'hosted',
    agentName: null,
    agentNameSource: 'missing',
    diagnostics: createDiagnosticsSummary(),
    devOverrideAllowed: true,
    devOverrideConfigured: false,
  }
}

export function createReadyState(
  overrides: Partial<Omit<Extract<CopilotBootstrapState, { status: 'ready' }>, 'status'>> = {},
): CopilotBootstrapState {
  return {
    status: 'ready',
    ...createBaseResolvedState(),
    ...overrides,
  }
}

export function createEmptyState(): CopilotBootstrapState {
  return {
    ...createBaseResolvedState(),
    status: 'empty',
    runtime: {
      status: 'stopped',
      expectedMode: 'development',
      resolvedMode: null,
      runtimeUrl: null,
      isPackaged: false,
      failure: null,
    },
    runtimeUrl: null,
    runtimeSource: 'none',
    diagnostics: createDiagnosticsSummary({
      hostedStatus: 'stopped',
      modeSource: 'expected',
      runtimeSource: 'none',
    }),
    missingFields: ['runtimeUrl'],
  }
}

export function createDisconnectedState(): CopilotBootstrapState {
  return createEmptyState()
}

export function createFailedState(): CopilotBootstrapState {
  return {
    ...createBaseResolvedState(),
    status: 'failed',
    runtime: {
      status: 'failed',
      expectedMode: 'bundled',
      resolvedMode: 'bundled',
      runtimeUrl: null,
      isPackaged: true,
      failure: {
        code: 'spawn_failed',
        phase: 'spawn',
        message: 'Bundled backend process failed to boot.',
        retryable: true,
        exitCode: 1,
        signal: null,
        timestamp: '2026-03-24T00:00:00.000Z',
      },
    },
    runtimeUrl: null,
    runtimeSource: 'none',
    diagnostics: createDiagnosticsSummary({
      hostedStatus: 'failed',
      mode: 'bundled',
      failure: {
        code: 'spawn_failed',
        phase: 'spawn',
        message: 'Bundled backend process failed to boot.',
        retryable: true,
        exitCode: 1,
        signal: null,
        timestamp: '2026-03-24T00:00:00.000Z',
      },
      runtimeSource: 'none',
    }),
  }
}

export function createSelectedAgent(): AgentType {
  return {
    id: 'general',
    label: '通用智能体',
    shortLabel: '通用智能体',
    description: '默认通用智能体',
    hint: '默认使用所有工具',
    status: 'active',
    icon: ((() => null) as unknown) as AgentType['icon'],
    recommendedTools: [LABEL_TOOL_READ],
  }
}

function createSelectedAgentWithOverrides(overrides: Partial<AgentType> = {}): AgentType {
  return {
    ...createSelectedAgent(),
    ...overrides,
  }
}

export function createDirectoryState(): AssistantAgentDirectoryState {
  return {
    status: 'ready',
    directoryVersion: 'agents-v1',
    defaultAgentId: 'general',
    agents: [createSelectedAgent()],
    error: null,
  }
}

export function createIdleDirectoryState(): AssistantAgentDirectoryState {
  return {
    status: 'idle',
    directoryVersion: null,
    defaultAgentId: null,
    agents: [],
    error: null,
  }
}

export function createSessionShell(overrides: SessionShellOverrides = {}): AssistantSessionShell {
  const boundAgent = createSelectedAgentWithOverrides(overrides.boundAgent)

  return {
    sessionId: overrides.sessionId ?? 'session-1',
    boundAgent,
    createdAt: overrides.createdAt ?? '2026-03-27T10:00:00Z',
    updatedAt: overrides.updatedAt ?? '2026-03-27T10:00:00Z',
    capabilities: {
      capabilitiesVersion: 'cap-v12',
      allAvailableTools: [
        {
          toolId: LABEL_TOOL_READ,
          kind: 'builtin',
          availability: 'available',
          displayName: '读取文件',
          description: '读取项目内文件内容。',
        },
        {
          toolId: 'tool.remote-search',
          kind: 'external',
          availability: 'disabled-by-global-setting',
          displayName: '远程搜索',
          description: '访问外部搜索服务',
        },
      ],
      recommendedToolsForAgent: [LABEL_TOOL_READ],
      defaultEnabledTools: [LABEL_TOOL_READ],
      toolSelectionMode: 'recommendation-only',
      ...overrides.capabilities,
    },
  }
}

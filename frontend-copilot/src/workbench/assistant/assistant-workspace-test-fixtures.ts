import { vi } from 'vitest'

const TOOL_ID_FS_READ = 'tool.fs.read'

import type {
  RuntimeAgentsListResponse,
  RuntimeCapabilitiesGetResponse,
  RuntimeThreadCreateResponse,
} from '../../features/copilot/chat-contract'
import type { CopilotBootstrapController } from '../../features/copilot/types'

export function createDirectoryResponse(): RuntimeAgentsListResponse {
  return {
    ok: true,
    directoryVersion: 'agents-v1',
    defaultAgentId: 'general',
    agents: [
      {
        agentId: 'general',
        status: 'active',
        recommendedTools: [TOOL_ID_FS_READ],
        displayName: 'Default',
        description: '默认通用智能体',
        iconKey: 'sparkles',
      },
      {
        agentId: 'blackboard',
        status: 'active',
        recommendedTools: [],
        displayName: 'Blackboard',
        description: '课程数据助手',
        iconKey: 'database',
      },
    ],
  }
}

export function createSessionResponse(
  overrides: Partial<RuntimeThreadCreateResponse> = {},
): RuntimeThreadCreateResponse {
  return {
    ok: true,
    threadId: 'session-1',
    boundAgent: {
      agentId: 'general',
      status: 'active',
      displayName: 'Default',
      description: '默认通用智能体',
      iconKey: 'sparkles',
    },
    createdAt: '2026-03-27T10:00:00Z',
    updatedAt: '2026-03-27T10:00:00Z',
    recommendedTools: [TOOL_ID_FS_READ],
    capabilities: {
      tools: {
        selectionMode: 'recommendation-only',
      },
    },
    ...overrides,
  }
}

export function createCapabilitiesResponse(
  overrides: Partial<RuntimeCapabilitiesGetResponse> = {},
): RuntimeCapabilitiesGetResponse {
  return {
    ok: true,
    sessionId: 'session-1',
    boundAgent: {
      agentId: 'general',
      status: 'active',
      displayName: 'Default',
      description: '默认通用智能体',
      iconKey: 'sparkles',
    },
    capabilitiesVersion: 'cap-v12',
    tools: [
      {
        toolId: TOOL_ID_FS_READ,
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
    recommendedTools: [TOOL_ID_FS_READ],
    toolSelectionMode: 'recommendation-only',
    ...overrides,
  }
}

export function createBootstrapController(): CopilotBootstrapController {
  return {
    retrying: false,
    retry: vi.fn(),
    state: {
      status: 'ready',
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
      diagnostics: {
        hostedStatus: 'ready',
        failure: null,
        mode: 'development',
        modeSource: 'resolved',
        runtimeSource: 'hosted',
      },
      devOverrideAllowed: true,
      devOverrideConfigured: false,
    },
  }
}

/** @vitest-environment jsdom */

import type { ReactElement } from 'react'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterAll, afterEach, beforeAll, vi } from 'vitest'

import type {
  RuntimeAgentsListResponse,
  RuntimeCapabilitiesGetResponse,
  RuntimeSessionCreateResponse,
} from '../../features/copilot/chat-contract'
import type { CopilotBootstrapController } from '../../features/copilot/types'

declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined
}

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
})

afterAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = undefined
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

export function createDirectoryResponse(): RuntimeAgentsListResponse {
  return {
    ok: true,
    directoryVersion: 'agents-v1',
    defaultAgentId: 'general',
    agents: [
      {
        agentId: 'general',
        status: 'active',
        recommendedTools: ['tool.file-convert'],
        defaultModelPreference: 'openai/gpt-4.1',
        displayName: 'Default',
        description: '默认通用智能体',
        iconKey: 'sparkles',
      },
      {
        agentId: 'blackboard',
        status: 'active',
        recommendedTools: [],
        defaultModelPreference: null,
        displayName: 'Blackboard',
        description: '课程数据助手',
        iconKey: 'database',
      },
    ],
  }
}

export function createSessionResponse(
  overrides: Partial<RuntimeSessionCreateResponse> = {},
): RuntimeSessionCreateResponse {
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
    createdAt: '2026-03-27T10:00:00Z',
    updatedAt: '2026-03-27T10:00:00Z',
    recommendedTools: ['tool.file-convert'],
    defaultModelPreference: 'openai/gpt-4.1',
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
        toolId: 'tool.file-convert',
        kind: 'builtin',
        availability: 'available',
        displayName: '文件转换',
        description: 'DOCX/PDF/PPTX 转换工具',
      },
      {
        toolId: 'tool.remote-search',
        kind: 'external',
        availability: 'disabled-by-global-setting',
        displayName: '远程搜索',
        description: '访问外部搜索服务',
      },
    ],
    recommendedTools: ['tool.file-convert'],
    toolSelectionMode: 'recommendation-only',
    defaultModelPreference: 'openai/gpt-4.1',
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

export function renderWithRoot(element: ReactElement) {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)

  act(() => {
    root.render(element)
  })

  return {
    container,
    getByTestId(testId: string) {
      const target = container.querySelector(`[data-testid="${testId}"]`)
      if (target === null) {
        throw new Error(`Missing element for data-testid=${testId}`)
      }

      return target
    },
    queryByTestId(testId: string) {
      return container.querySelector(`[data-testid="${testId}"]`)
    },
    unmount() {
      act(() => {
        root.unmount()
      })
      container.remove()
    },
  }
}

export async function clickElement(element: Element) {
  await act(async () => {
    element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
  })
}

export async function openContextMenu(element: Element, clientX: number, clientY: number) {
  await act(async () => {
    element.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX, clientY }))
  })
}

export async function hoverElement(element: Element) {
  await act(async () => {
    element.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, cancelable: true }))
  })
}

export function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void

  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve
    reject = nextReject
  })

  return { promise, resolve, reject }
}

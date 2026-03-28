import type { ReactElement } from 'react'
import { act } from 'react'
import { createRoot } from 'react-dom/client'

import type { AssistantAgentDirectoryState } from '../../workbench/assistant/AssistantWorkspace'
import type { AgentType, AssistantSessionShell } from '../../workbench/types'
import type { CopilotBootstrapState, CopilotDiagnosticsSummary } from './types'

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

export function createReadyState(): CopilotBootstrapState {
  return {
    status: 'ready',
    ...createBaseResolvedState(),
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
    recommendedTools: ['tool.file-convert'],
    defaultModelPreference: 'openai/gpt-4.1',
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

export function createSessionShell(): AssistantSessionShell {
  return {
    sessionId: 'session-1',
    boundAgent: createSelectedAgent(),
    createdAt: '2026-03-27T10:00:00Z',
    updatedAt: '2026-03-27T10:00:00Z',
    capabilities: {
      capabilitiesVersion: 'cap-v12',
      allAvailableTools: [
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
      recommendedToolsForAgent: ['tool.file-convert'],
      defaultEnabledTools: ['tool.file-convert'],
      toolSelectionMode: 'recommendation-only',
      defaultModelPreference: 'openai/gpt-4.1',
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

export function getTriggerIconText(trigger: HTMLButtonElement): string {
  const icon = trigger.querySelector('.copilot-model-picker__icon')
  return icon?.textContent ?? ''
}

export async function clickElement(element: Element) {
  await act(async () => {
    element.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
}

export async function setFormControlValue(element: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
  const valueSetter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set

  if (valueSetter === undefined) {
    throw new Error('Unable to resolve native value setter')
  }

  await act(async () => {
    const previousValue = element.value
    valueSetter.call(element, value)
    const tracker = (element as HTMLInputElement & { _valueTracker?: { setValue: (nextValue: string) => void } })._valueTracker
    tracker?.setValue(previousValue)
    element.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

export async function submitForm(form: HTMLFormElement) {
  await act(async () => {
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
  })
}

export async function pressTextareaKey(
  element: HTMLTextAreaElement,
  key: string,
  options: Partial<KeyboardEventInit> = {},
) {
  await act(async () => {
    element.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key, ...options }))
  })
}

export async function dragComposerResizeHandle(element: HTMLDivElement, startY: number, endY: number) {
  await act(async () => {
    element.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0, clientY: startY }))
    window.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, cancelable: true, button: 0, clientY: endY }))
    window.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, button: 0, clientY: endY }))
  })
}

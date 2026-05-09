/** @vitest-environment jsdom */

import { act, createRef, useMemo, useState, type FormEvent, type ReactElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { CopilotComposer } from './CopilotComposer'
import { createEmptyComposerAttachmentsState } from './attachments/state'
import { createEmptyComposerDraft, type CopilotChatComposerDraft } from './copilot-chat-helpers'
import type { CopilotModelGroup, CopilotModelOption } from './model-picker'
import type { RuntimeThinkingCapability, RuntimeThinkingValue } from './thread-run-contract'
import { THINKING_LEVEL_LABELS } from '../../workbench/thinking-capabilities'
import type { AssistantSessionCapabilities } from '../../workbench/types'
import type { AttachmentManagerApi } from '../../../electron/attachment-service/ipc'

vi.mock('./components/ModelPicker', () => ({
  ModelPicker: (props: {
    groups: CopilotModelGroup[]
    onSelectModel: (model: CopilotModelOption) => void
  }) => (
    <div data-testid="mock-model-picker">
      {props.groups.flatMap((group) => group.models).map((model) => (
        <button
          key={model.id}
          type="button"
          data-testid={`mock-model-select-${model.modelId}`}
          onClick={() => {
            props.onSelectModel(model)
          }}
        >
          {model.name}
        </button>
      ))}
    </div>
  ),
}))

vi.mock('./components/ToolPicker', () => ({
  ToolPicker: () => <div data-testid="mock-tool-picker" />,
}))

declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('CopilotComposer thinking controls', () => {
  it('renders the thinking trigger as a labeled toolbar control', async () => {
    const rendered = renderWithRoot(<ComposerHarness />)

    try {
      const thinkingTrigger = rendered.getByTestId('chat-thinking-trigger') as HTMLButtonElement
      const composerSurface = rendered.getByTestId('chat-composer-surface') as HTMLDivElement
      expect(thinkingTrigger.className).toContain('copilot-model-picker__trigger')
      expect(composerSurface.className).toContain('copilot-chat__composer-surface--height-160')
      expect(composerSurface.getAttribute('style')).toBeNull()
      expect(rendered.getByTestId('chat-thinking-trigger-label').textContent).toBe('低')
      expect(thinkingTrigger.getAttribute('aria-label')).toContain('低')
    } finally {
      rendered.unmount()
    }
  })

  it('uses the latest selected model route inside the thinking updater during batched interactions', async () => {
    const rendered = renderWithRoot(<ComposerHarness />)

    try {
      const thinkingTrigger = rendered.getByTestId('chat-thinking-trigger') as HTMLButtonElement
      expect(thinkingTrigger.getAttribute('aria-label')).toContain('低')
      expect(rendered.getByTestId('chat-thinking-trigger-label').textContent).toBe('低')

      await clickElement(thinkingTrigger)

      await act(async () => {
        rendered.getByTestId('mock-model-select-model-b').dispatchEvent(new MouseEvent('click', { bubbles: true }))
        rendered.getByTestId('chat-thinking-option-medium').dispatchEvent(new MouseEvent('click', { bubbles: true }))
      })

      expect(rendered.getByTestId('composer-selected-model').textContent).toBe('model-b')
      expect(thinkingTrigger.getAttribute('aria-label')).toContain('中')
      expect(rendered.getByTestId('chat-thinking-trigger-label').textContent).toBe('中')

      await clickElement(rendered.getByTestId('mock-model-select-model-a'))
      expect(thinkingTrigger.getAttribute('aria-label')).toContain('低')
      expect(rendered.getByTestId('chat-thinking-trigger-label').textContent).toBe('低')

      await clickElement(rendered.getByTestId('mock-model-select-model-b'))
      expect(thinkingTrigger.getAttribute('aria-label')).toContain('中')
      expect(rendered.getByTestId('chat-thinking-trigger-label').textContent).toBe('中')
    } finally {
      rendered.unmount()
    }
  })

  it('keeps thinking options product-facing without showing internal codes', async () => {
    const originalMediumLabel = THINKING_LEVEL_LABELS.medium
    THINKING_LEVEL_LABELS.medium = ''
    const rendered = renderWithRoot(<ComposerHarness />)

    try {
      await clickElement(rendered.getByTestId('chat-thinking-trigger'))
      expect(rendered.getByTestId('chat-thinking-option-medium').textContent).toContain('中')
      expect(rendered.getByTestId('chat-thinking-option-medium').textContent).not.toContain('medium')
    } finally {
      THINKING_LEVEL_LABELS.medium = originalMediumLabel
      rendered.unmount()
    }
  })

  it('exposes radiogroup semantics and supports arrow-key selection inside the same thinking group', async () => {
    const rendered = renderWithRoot(<ComposerHarness />)

    try {
      await clickElement(rendered.getByTestId('chat-thinking-trigger'))

      const group = rendered.container.querySelector('[role="radiogroup"][aria-label="推理可选项"]')
      const low = rendered.getByTestId('chat-thinking-option-low') as HTMLDivElement
      const medium = rendered.getByTestId('chat-thinking-option-medium') as HTMLDivElement
      const thinkingTrigger = rendered.getByTestId('chat-thinking-trigger') as HTMLButtonElement

      expect(group).not.toBeNull()
      expect(low.getAttribute('role')).toBe('radio')
      expect(low.getAttribute('aria-checked')).toBe('true')
      expect(medium.getAttribute('aria-checked')).toBe('false')

      await pressKey(low, 'ArrowRight')

      expect(rendered.container.querySelector('[data-testid="chat-thinking-panel"]')).toBeNull()
      expect(thinkingTrigger.getAttribute('aria-label')).toContain('中')
      expect(rendered.getByTestId('chat-thinking-trigger-label').textContent).toBe('中')

      await clickElement(thinkingTrigger)
      expect((rendered.getByTestId('chat-thinking-option-medium') as HTMLDivElement).getAttribute('aria-checked')).toBe('true')
      expect((rendered.getByTestId('chat-thinking-option-low') as HTMLDivElement).getAttribute('aria-checked')).toBe('false')
    } finally {
      rendered.unmount()
    }
  })

  it('supports Home, End, Space, and Enter selection inside the same thinking group', async () => {
    const rendered = renderWithRoot(<ComposerHarness />)

    try {
      const thinkingTrigger = rendered.getByTestId('chat-thinking-trigger') as HTMLButtonElement

      await clickElement(thinkingTrigger)
      await pressKey(rendered.getByTestId('chat-thinking-option-low') as HTMLDivElement, 'End')
      expect(rendered.container.querySelector('[data-testid="chat-thinking-panel"]')).toBeNull()

      await clickElement(thinkingTrigger)
      expect((rendered.getByTestId('chat-thinking-option-medium') as HTMLDivElement).getAttribute('aria-checked')).toBe('true')
      await pressKey(rendered.getByTestId('chat-thinking-option-medium') as HTMLDivElement, 'Home')
      expect(rendered.container.querySelector('[data-testid="chat-thinking-panel"]')).toBeNull()

      await clickElement(thinkingTrigger)
      expect((rendered.getByTestId('chat-thinking-option-off') as HTMLDivElement).getAttribute('aria-checked')).toBe('true')
      await pressKey(rendered.getByTestId('chat-thinking-option-medium') as HTMLDivElement, ' ')
      expect(rendered.container.querySelector('[data-testid="chat-thinking-panel"]')).toBeNull()

      await clickElement(thinkingTrigger)
      expect((rendered.getByTestId('chat-thinking-option-medium') as HTMLDivElement).getAttribute('aria-checked')).toBe('true')
      await pressKey(rendered.getByTestId('chat-thinking-option-low') as HTMLDivElement, 'Enter')
      expect(rendered.container.querySelector('[data-testid="chat-thinking-panel"]')).toBeNull()

      await clickElement(thinkingTrigger)
      expect((rendered.getByTestId('chat-thinking-option-low') as HTMLDivElement).getAttribute('aria-checked')).toBe('true')
    } finally {
      rendered.unmount()
    }
  })
})

describe('CopilotComposer attachments', () => {
  it('does not intercept pure text paste', async () => {
    const rendered = renderWithRoot(<ComposerHarness />)

    try {
      const textarea = rendered.container.querySelector('textarea[name="messageText"]') as HTMLTextAreaElement
      const pasteEvent = createPasteEvent({
        types: ['text/plain'],
        items: [],
        files: [],
      })

      await act(async () => {
        textarea.dispatchEvent(pasteEvent)
      })

      expect(pasteEvent.defaultPrevented).toBe(false)
      expect(rendered.container.querySelector('[data-testid="chat-composer-attachment-trigger"]')).toBeNull()
    } finally {
      rendered.unmount()
    }
  })

  it('queues pasted files and shows the attachment count badge', async () => {
    const file = new File(['hello'], 'note.txt', { type: 'text/plain' })
    const resolveFilePath = vi.fn((candidate: File) => (candidate === file ? 'attachment-note.txt' : null))
    installMockAttachmentManager({ resolveFilePath })

    const rendered = renderWithRoot(<ComposerHarness />)

    try {
      const textarea = rendered.container.querySelector('textarea[name="messageText"]') as HTMLTextAreaElement
      const pasteEvent = createPasteEvent({
        types: ['Files'],
        items: [{ kind: 'file', type: 'text/plain' }],
        files: [file],
      })

      await act(async () => {
        textarea.dispatchEvent(pasteEvent)
      })

      expect(pasteEvent.defaultPrevented).toBe(true)
      expect(resolveFilePath).toHaveBeenCalledWith(file)
      expect(rendered.getByTestId('chat-composer-attachment-trigger-count').textContent).toBe('1')
      expect(rendered.container.textContent).toContain('note.txt')
    } finally {
      rendered.unmount()
    }
  })

  it('writes pasted clipboard image data to a temporary attachment when the clipboard file has no local path', async () => {
    const imageFile = new File(['png-data'], 'pasted-image.png', { type: 'image/png' })
    const readClipboardData = vi.fn(async () => ({
      ok: true as const,
      status: 'image' as const,
      availableFormats: ['image/png'],
      data: {
        mimeType: 'image/png' as const,
        base64Data: 'cG5nLWRhdGE=',
        byteLength: 8,
        width: 320,
        height: 180,
        suggestedName: 'pasted-image.png',
      },
    }))
    const writeTempFile = vi.fn(async () => ({
      ok: true as const,
      file: {
        path: 'temp-image.png',
        name: 'temp-image.png',
        mimeType: 'image/png',
        size: 8,
        createdAt: '2026-05-09T00:00:00.000Z',
        isTemporary: true as const,
      },
    }))
    installMockAttachmentManager({
      resolveFilePath: vi.fn(() => null),
      readClipboardData,
      writeTempFile,
    })

    const rendered = renderWithRoot(<ComposerHarness />)

    try {
      const textarea = rendered.container.querySelector('textarea[name="messageText"]') as HTMLTextAreaElement
      const pasteEvent = createPasteEvent({
        types: ['Files', 'image/png'],
        items: [{ kind: 'file', type: 'image/png' }],
        files: [imageFile],
      })

      await act(async () => {
        textarea.dispatchEvent(pasteEvent)
      })
      await flushMicrotasks()

      expect(pasteEvent.defaultPrevented).toBe(true)
      expect(readClipboardData).toHaveBeenCalledTimes(1)
      expect(writeTempFile).toHaveBeenCalledTimes(1)
      expect(rendered.getByTestId('chat-composer-attachment-trigger-count').textContent).toBe('1')
      expect(rendered.container.textContent).toContain('temp-image.png')
      expect(rendered.container.querySelector('[data-testid="chat-composer-attachment-notice"]')).toBeNull()
    } finally {
      rendered.unmount()
    }
  })

  it('supports multi-file drag and drop with drag highlight', async () => {
    const rendered = renderWithRoot(<ComposerHarness />)

    try {
      const composerSurface = rendered.getByTestId('chat-composer-surface') as HTMLDivElement
      const files = [
        createFileWithPath({ name: 'a.txt', type: 'text/plain', path: 'drag-a.txt', content: 'A' }),
        createFileWithPath({ name: 'b.txt', type: 'text/plain', path: 'drag-b.txt', content: 'B' }),
      ]

      await act(async () => {
        composerSurface.dispatchEvent(createDragEvent('dragenter', files))
      })
      expect(composerSurface.className).toContain('copilot-chat__composer-surface--drag-active')

      await act(async () => {
        composerSurface.dispatchEvent(createDragEvent('drop', files))
      })

      expect(composerSurface.className).not.toContain('copilot-chat__composer-surface--drag-active')
      expect(rendered.getByTestId('chat-composer-attachment-trigger-count').textContent).toBe('2')
    } finally {
      rendered.unmount()
    }
  })

  it('removes attachments from the panel list', async () => {
    const rendered = renderWithRoot(<ComposerHarness />)

    try {
      const textarea = rendered.container.querySelector('textarea[name="messageText"]') as HTMLTextAreaElement
      const file = createFileWithPath({
        name: 'remove.txt',
        type: 'text/plain',
        path: 'remove-target.txt',
        content: 'remove me',
      })

      await act(async () => {
        textarea.dispatchEvent(createPasteEvent({
          types: ['Files'],
          items: [],
          files: [file],
        }))
      })

      await clickElement(rendered.getByTestId('chat-composer-attachment-remove-remove-target.txt'))
      expect(rendered.container.querySelector('[data-testid="chat-composer-attachment-trigger"]')).toBeNull()
    } finally {
      rendered.unmount()
    }
  })

  it('opens image and text previews for supported attachments', async () => {
    const createObjectUrl = vi.fn(() => 'blob:image-preview')
    const originalCreateObjectURL = Object.getOwnPropertyDescriptor(URL, 'createObjectURL')
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      value: createObjectUrl,
    })

    installMockAttachmentManager({
      readPreview: vi.fn(async () => ({
        ok: true as const,
        kind: 'text' as const,
        path: 'preview-note.txt',
        name: 'preview-note.txt',
        size: 12,
        mimeType: 'text/plain' as const,
        text: 'preview body',
        truncated: false,
        maxBytes: 262144,
        encoding: 'utf-8' as const,
      })),
    })

    const rendered = renderWithRoot(<ComposerHarness />)

    try {
      const textarea = rendered.container.querySelector('textarea[name="messageText"]') as HTMLTextAreaElement
      const imageFile = createFileWithPath({
        name: 'preview.png',
        type: 'image/png',
        path: 'preview-image.png',
        content: 'img',
      })
      const textFile = createFileWithPath({
        name: 'preview-note.txt',
        type: 'text/plain',
        path: 'preview-note.txt',
        content: 'text',
      })

      await act(async () => {
        textarea.dispatchEvent(createPasteEvent({
          types: ['Files'],
          items: [],
          files: [imageFile, textFile],
        }))
      })

      await clickElement(rendered.getByTestId('chat-composer-attachment-open-preview-image.png'))
      expect((rendered.getByTestId('chat-composer-attachment-preview-image') as HTMLImageElement).src).toContain('blob:image-preview')
      await clickElement(rendered.getByTestId('chat-composer-attachment-preview-close'))

      await clickElement(rendered.getByTestId('chat-composer-attachment-open-preview-note.txt'))
      await flushMicrotasks()
      expect(rendered.getByTestId('chat-composer-attachment-preview-text').textContent).toBe('preview body')
    } finally {
      rendered.unmount()
      if (originalCreateObjectURL === undefined) {
        Reflect.deleteProperty(URL, 'createObjectURL')
      } else {
        Object.defineProperty(URL, 'createObjectURL', originalCreateObjectURL)
      }
    }
  })

  it('shows a lightweight notice for unsupported clipboard binary data', async () => {
    installMockAttachmentManager({
      readClipboardData: vi.fn(async () => ({
        ok: true as const,
        status: 'unsupported' as const,
        availableFormats: ['image/png'],
        reason: 'non_image_data' as const,
      })),
    })

    const rendered = renderWithRoot(<ComposerHarness />)

    try {
      const textarea = rendered.container.querySelector('textarea[name="messageText"]') as HTMLTextAreaElement
      await act(async () => {
        textarea.dispatchEvent(createPasteEvent({
          types: ['image/png'],
          items: [{ kind: 'file', type: 'image/png' }],
          files: [],
        }))
      })
      await flushMicrotasks()

      expect(rendered.getByTestId('chat-composer-attachment-notice').textContent).toContain('暂不支持')
    } finally {
      rendered.unmount()
    }
  })

  it('shows a lightweight notice for pathless non-image clipboard file data', async () => {
    installMockAttachmentManager({
      resolveFilePath: vi.fn(() => null),
    })

    const rendered = renderWithRoot(<ComposerHarness />)

    try {
      const textarea = rendered.container.querySelector('textarea[name="messageText"]') as HTMLTextAreaElement
      const pasteEvent = createPasteEvent({
        types: ['Files'],
        items: [{ kind: 'file', type: 'application/octet-stream' }],
        files: [new File(['binary-data'], 'archive.bin', { type: 'application/octet-stream' })],
      })

      await act(async () => {
        textarea.dispatchEvent(pasteEvent)
      })

      expect(pasteEvent.defaultPrevented).toBe(true)
      expect(rendered.getByTestId('chat-composer-attachment-notice').textContent).toContain('暂不支持')
      expect(rendered.container.querySelector('[data-testid="chat-composer-attachment-trigger"]')).toBeNull()
    } finally {
      rendered.unmount()
    }
  })
})

function ComposerHarness() {
  const modelGroups = useMemo<CopilotModelGroup[]>(() => [
    {
      key: 'provider-thinking',
      title: 'Thinking Provider',
      models: [createModelOption('model-a'), createModelOption('model-b')],
    },
  ], [])
  const [draft, setDraft] = useState<CopilotChatComposerDraft>(() => ({
    ...createEmptyComposerDraft(),
    selectedModelId: modelGroups[0].models[0]?.selectionValue ?? '',
    selectedModelRoute: cloneRoute(modelGroups[0].models[0]?.route ?? null),
  }))
  const [attachments, setAttachments] = useState(() => createEmptyComposerAttachmentsState())
  const selectedModelId = draft.selectedModelRoute?.routeRef?.modelId ?? 'none'
  const thinkingCapability = createThinkingCapability(selectedModelId)

  return (
    <>
      <div data-testid="composer-selected-model">{selectedModelId}</div>
      <CopilotComposer
        capabilities={createCapabilities()}
        modelGroups={modelGroups}
        thinkingCapability={thinkingCapability}
        draft={draft}
        attachments={attachments}
        onDraftChange={setDraft}
        onAttachmentsChange={setAttachments}
        onSubmit={(event: FormEvent<HTMLFormElement>) => {
          event.preventDefault()
        }}
        onCancel={() => undefined}
        sendStatus="idle"
        canCancel
        sendDisabledReason={null}
        controlsLockedReason={null}
        composerInputRef={createRef<HTMLTextAreaElement>()}
        composerHeight={160}
        onResizeStart={() => undefined}
      />
    </>
  )
}

function createCapabilities(): AssistantSessionCapabilities {
  return {
    capabilitiesVersion: 'cap-v12',
    allAvailableTools: [],
    recommendedToolsForAgent: [],
    defaultEnabledTools: [],
    toolSelectionMode: 'recommendation-only',
  }
}

function createThinkingCapability(modelId: string): RuntimeThinkingCapability {
  const allowedValues: RuntimeThinkingValue[] = [
    {
      valueType: 'code',
      code: 'off',
      labelZh: '关',
    },
    {
      valueType: 'code',
      code: 'low',
      labelZh: '低',
    },
    {
      valueType: 'code',
      code: 'medium',
      labelZh: '中',
    },
  ]

  return {
    status: 'verified-supported',
    source: 'verified',
    supported: true,
    series: 'compat-discrete-levels-v1',
    seriesLabelZh: '离散推理档位',
    editorType: 'discrete',
    allowedValues,
    defaultValue: allowedValues[1] ?? null,
    controlSpec: {
      kind: 'discrete',
      selectionKind: 'preset',
      presetOptions: [
        { kind: 'preset', value: 'off' },
        { kind: 'preset', value: 'low' },
        { kind: 'preset', value: 'medium' },
      ],
      fixedSelection: null,
      budget: null,
    },
    defaultSelection: {
      kind: 'preset',
      value: 'low',
    },
    supportedLevels: ['off', 'low', 'medium'],
    defaultLevel: 'low',
    providerBuilderKey: null,
    reasonCode: `${modelId}:supported`,
    providerHint: 'provider-thinking',
    routeFingerprint: {
      providerProfileId: 'provider-thinking',
      provider: 'provider-thinking',
      endpointType: 'openai-compatible',
      baseUrl: 'https://example.com/v1',
      modelId,
    },
    provenance: {
      routeStatus: 'verified',
      override: {
        present: false,
        applied: false,
        source: null,
        format: null,
      },
    },
    visibility: {
      reasoning: 'visible',
      supportsSuppression: true,
    },
    overrideLevels: [],
  }
}

function createModelOption(modelId: 'model-a' | 'model-b'): CopilotModelOption {
  return {
    id: `provider-thinking:${modelId}`,
    selectionValue: `provider-model|provider-thinking|${modelId}`,
    modelId,
    name: modelId,
    provider: 'Thinking Provider',
    group: 'Thinking Provider',
    tags: [],
    icon: {
      label: modelId === 'model-a' ? 'A' : 'B',
      accent: '#6366f1',
    },
    routeRef: {
      routeKind: 'provider-model',
      profileId: 'provider-thinking',
      modelId,
    },
    route: {
      routeRef: {
        routeKind: 'provider-model',
        profileId: 'provider-thinking',
        modelId,
      },
    },
    available: true,
    unavailableReason: null,
    thinkingCapabilityOverride: null,
  }
}

function cloneRoute(route: CopilotModelOption['route'] | null) {
  if (route === null || route.routeRef === undefined || route.routeRef === null) {
    return route
  }

  return {
    ...route,
    routeRef: {
      ...route.routeRef,
    },
  }
}

function renderWithRoot(element: ReactElement) {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)

  act(() => {
    root.render(element)
  })

  return {
    container,
    root,
    getByTestId(testId: string) {
      const target = container.querySelector(`[data-testid="${testId}"]`)
      if (target === null) {
        throw new Error(`Missing element for data-testid=${testId}`)
      }

      return target as HTMLElement
    },
    unmount() {
      act(() => {
        root.unmount()
      })
      container.remove()
    },
  }
}

async function clickElement(element: Element) {
  await act(async () => {
    element.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
}

async function pressKey(element: HTMLElement, key: string) {
  await act(async () => {
    element.focus()
    element.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key }))
  })
}

function createFileWithPath(input: {
  name: string
  type: string
  path: string
  content: string
}) {
  const file = new File([input.content], input.name, { type: input.type })
  Object.defineProperty(file, 'path', {
    configurable: true,
    value: input.path,
  })
  return file
}

function createPasteEvent(input: {
  types: string[]
  items: Array<{ kind: string; type: string }>
  files: File[]
}) {
  const event = new Event('paste', { bubbles: true, cancelable: true }) as Event & {
    clipboardData: {
      types: string[]
      items: Array<{ kind: string; type: string }>
      files: File[]
    }
  }
  Object.defineProperty(event, 'clipboardData', {
    configurable: true,
    value: {
      types: input.types,
      items: input.items,
      files: input.files,
    },
  })
  return event
}

function createDragEvent(type: string, files: File[]) {
  const event = new Event(type, { bubbles: true, cancelable: true }) as Event & {
    dataTransfer: {
      files: File[]
      dropEffect: string
    }
  }
  Object.defineProperty(event, 'dataTransfer', {
    configurable: true,
    value: {
      files,
      dropEffect: 'none',
    },
  })
  return event
}

function installMockAttachmentManager(overrides: Partial<AttachmentManagerApi>) {
  const value: AttachmentManagerApi = {
    resolveFilePath: overrides.resolveFilePath ?? vi.fn(() => null),
    readClipboardData: overrides.readClipboardData ?? vi.fn(async () => ({
      ok: true as const,
      status: 'empty' as const,
      availableFormats: [],
    })),
    writeTempFile: overrides.writeTempFile ?? vi.fn(async () => ({
      ok: true as const,
      file: {
        path: 'temp-image.png',
        name: 'temp-image.png',
        mimeType: 'image/png',
        size: 3,
        createdAt: '2026-05-09T00:00:00.000Z',
        isTemporary: true as const,
      },
    })),
    readPreview: overrides.readPreview ?? vi.fn(async () => ({
      ok: true as const,
      kind: 'unsupported' as const,
      path: 'unknown.bin',
      name: 'unknown.bin',
      size: 0,
      reason: 'unsupported_type' as const,
    })),
    cleanupTempFiles: overrides.cleanupTempFiles ?? vi.fn(async () => ({
      ok: true as const,
      deletedPaths: [],
      missingPaths: [],
      skippedPaths: [],
    })),
  }

  Object.defineProperty(window, 'attachmentManager', {
    configurable: true,
    value,
  })

  return value
}

async function flushMicrotasks() {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}

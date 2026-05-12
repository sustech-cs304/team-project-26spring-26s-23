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

// Duplicate-string constants extracted for sonarjs/no-duplicate-string
const LABEL_PASTED_IMAGE_PNG = 'pasted-image.png'
const LABEL_PREVIEW_NOTE_TXT = 'preview-note.txt'
const LABEL_PROVIDER_THINKING = 'provider-thinking'
const LABEL_TEMP_IMAGE_PNG = 'temp-image.png'
const LABEL_TEXTAREA_NAME_MESSAGETEXT = 'textarea[name="messageText"]'
const LABEL_TEXT_PLAIN = 'text/plain'
const SELECTOR_ARIA_CHECKED = 'aria-checked'
const SELECTOR_ARIA_LABEL = 'aria-label'
const SELECTOR_CHAT_COMPOSER_ATTACHMENT = 'chat-composer-attachment-trigger-count'
const SELECTOR_CHAT_THINKING_OPTION = 'chat-thinking-option-medium'
const SELECTOR_CHAT_THINKING_OPTION_2 = 'chat-thinking-option-low'
const SELECTOR_CHAT_THINKING_TRIGGER = 'chat-thinking-trigger'
const SELECTOR_CHAT_THINKING_TRIGGER_2 = 'chat-thinking-trigger-label'
const SELECTOR_DATA_TESTID_CHAT = '[data-testid="chat-thinking-panel"]'


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
      const thinkingTrigger = rendered.getByTestId(SELECTOR_CHAT_THINKING_TRIGGER) as HTMLButtonElement
      const composerSurface = rendered.getByTestId('chat-composer-surface') as HTMLDivElement
      expect(thinkingTrigger.className).toContain('copilot-model-picker__trigger')
      expect(composerSurface.className).toContain('copilot-chat__composer-surface--height-160')
      expect(composerSurface.getAttribute('style')).toBeNull()
      expect(rendered.getByTestId(SELECTOR_CHAT_THINKING_TRIGGER_2).textContent).toBe('低')
      expect(thinkingTrigger.getAttribute(SELECTOR_ARIA_LABEL)).toContain('低')
    } finally {
      rendered.unmount()
    }
  })

  it('uses the latest selected model route inside the thinking updater during batched interactions', async () => {
    const rendered = renderWithRoot(<ComposerHarness />)

    try {
      const thinkingTrigger = rendered.getByTestId(SELECTOR_CHAT_THINKING_TRIGGER) as HTMLButtonElement
      expect(thinkingTrigger.getAttribute(SELECTOR_ARIA_LABEL)).toContain('低')
      expect(rendered.getByTestId(SELECTOR_CHAT_THINKING_TRIGGER_2).textContent).toBe('低')

      await clickElement(thinkingTrigger)

      await act(async () => {
        rendered.getByTestId('mock-model-select-model-b').dispatchEvent(new MouseEvent('click', { bubbles: true }))
        rendered.getByTestId(SELECTOR_CHAT_THINKING_OPTION).dispatchEvent(new MouseEvent('click', { bubbles: true }))
      })

      expect(rendered.getByTestId('composer-selected-model').textContent).toBe('model-b')
      expect(thinkingTrigger.getAttribute(SELECTOR_ARIA_LABEL)).toContain('中')
      expect(rendered.getByTestId(SELECTOR_CHAT_THINKING_TRIGGER_2).textContent).toBe('中')

      await clickElement(rendered.getByTestId('mock-model-select-model-a'))
      expect(thinkingTrigger.getAttribute(SELECTOR_ARIA_LABEL)).toContain('低')
      expect(rendered.getByTestId(SELECTOR_CHAT_THINKING_TRIGGER_2).textContent).toBe('低')

      await clickElement(rendered.getByTestId('mock-model-select-model-b'))
      expect(thinkingTrigger.getAttribute(SELECTOR_ARIA_LABEL)).toContain('中')
      expect(rendered.getByTestId(SELECTOR_CHAT_THINKING_TRIGGER_2).textContent).toBe('中')
    } finally {
      rendered.unmount()
    }
  })

  it('keeps thinking options product-facing without showing internal codes', async () => {
    const originalMediumLabel = THINKING_LEVEL_LABELS.medium
    THINKING_LEVEL_LABELS.medium = ''
    const rendered = renderWithRoot(<ComposerHarness />)

    try {
      await clickElement(rendered.getByTestId(SELECTOR_CHAT_THINKING_TRIGGER))
      expect(rendered.getByTestId(SELECTOR_CHAT_THINKING_OPTION).textContent).toContain('中')
      expect(rendered.getByTestId(SELECTOR_CHAT_THINKING_OPTION).textContent).not.toContain('medium')
    } finally {
      THINKING_LEVEL_LABELS.medium = originalMediumLabel
      rendered.unmount()
    }
  })

  it('exposes radiogroup semantics and supports arrow-key selection inside the same thinking group', async () => {
    const rendered = renderWithRoot(<ComposerHarness />)

    try {
      await clickElement(rendered.getByTestId(SELECTOR_CHAT_THINKING_TRIGGER))

      const group = rendered.container.querySelector('[role="radiogroup"][aria-label="推理可选项"]')
      const low = rendered.getByTestId(SELECTOR_CHAT_THINKING_OPTION_2) as HTMLDivElement
      const medium = rendered.getByTestId(SELECTOR_CHAT_THINKING_OPTION) as HTMLDivElement
      const thinkingTrigger = rendered.getByTestId(SELECTOR_CHAT_THINKING_TRIGGER) as HTMLButtonElement

      expect(group).not.toBeNull()
      expect(low.getAttribute('role')).toBe('radio')
      expect(low.getAttribute(SELECTOR_ARIA_CHECKED)).toBe('true')
      expect(medium.getAttribute(SELECTOR_ARIA_CHECKED)).toBe('false')

      await pressKey(low, 'ArrowRight')

      expect(rendered.container.querySelector(SELECTOR_DATA_TESTID_CHAT)).toBeNull()
      expect(thinkingTrigger.getAttribute(SELECTOR_ARIA_LABEL)).toContain('中')
      expect(rendered.getByTestId(SELECTOR_CHAT_THINKING_TRIGGER_2).textContent).toBe('中')

      await clickElement(thinkingTrigger)
      expect((rendered.getByTestId(SELECTOR_CHAT_THINKING_OPTION) as HTMLDivElement).getAttribute(SELECTOR_ARIA_CHECKED)).toBe('true')
      expect((rendered.getByTestId(SELECTOR_CHAT_THINKING_OPTION_2) as HTMLDivElement).getAttribute(SELECTOR_ARIA_CHECKED)).toBe('false')
    } finally {
      rendered.unmount()
    }
  })

  it('supports Home, End, Space, and Enter selection inside the same thinking group', async () => {
    const rendered = renderWithRoot(<ComposerHarness />)

    try {
      const thinkingTrigger = rendered.getByTestId(SELECTOR_CHAT_THINKING_TRIGGER) as HTMLButtonElement

      await clickElement(thinkingTrigger)
      await pressKey(rendered.getByTestId(SELECTOR_CHAT_THINKING_OPTION_2) as HTMLDivElement, 'End')
      expect(rendered.container.querySelector(SELECTOR_DATA_TESTID_CHAT)).toBeNull()

      await clickElement(thinkingTrigger)
      expect((rendered.getByTestId(SELECTOR_CHAT_THINKING_OPTION) as HTMLDivElement).getAttribute(SELECTOR_ARIA_CHECKED)).toBe('true')
      await pressKey(rendered.getByTestId(SELECTOR_CHAT_THINKING_OPTION) as HTMLDivElement, 'Home')
      expect(rendered.container.querySelector(SELECTOR_DATA_TESTID_CHAT)).toBeNull()

      await clickElement(thinkingTrigger)
      expect((rendered.getByTestId('chat-thinking-option-off') as HTMLDivElement).getAttribute(SELECTOR_ARIA_CHECKED)).toBe('true')
      await pressKey(rendered.getByTestId(SELECTOR_CHAT_THINKING_OPTION) as HTMLDivElement, ' ')
      expect(rendered.container.querySelector(SELECTOR_DATA_TESTID_CHAT)).toBeNull()

      await clickElement(thinkingTrigger)
      expect((rendered.getByTestId(SELECTOR_CHAT_THINKING_OPTION) as HTMLDivElement).getAttribute(SELECTOR_ARIA_CHECKED)).toBe('true')
      await pressKey(rendered.getByTestId(SELECTOR_CHAT_THINKING_OPTION_2) as HTMLDivElement, 'Enter')
      expect(rendered.container.querySelector(SELECTOR_DATA_TESTID_CHAT)).toBeNull()

      await clickElement(thinkingTrigger)
      expect((rendered.getByTestId(SELECTOR_CHAT_THINKING_OPTION_2) as HTMLDivElement).getAttribute(SELECTOR_ARIA_CHECKED)).toBe('true')
    } finally {
      rendered.unmount()
    }
  })
})

/* eslint-disable-next-line max-lines-per-function -- integration test group for CopilotComposer attachment handling (paste, file display, removal), each test requires independent render setup */
describe('CopilotComposer attachments', () => {
  describe('paste handling', () => {
    it('does not intercept pure text paste', async () => {
      const rendered = renderWithRoot(<ComposerHarness />)

      try {
        const textarea = rendered.container.querySelector(LABEL_TEXTAREA_NAME_MESSAGETEXT) as HTMLTextAreaElement
        const pasteEvent = createPasteEvent({
          types: [LABEL_TEXT_PLAIN],
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
      const file = new File(['hello'], 'note.txt', { type: LABEL_TEXT_PLAIN })
      const resolveFilePath = vi.fn((candidate: File) => (candidate === file ? 'attachment-note.txt' : null))
      installMockAttachmentManager({ resolveFilePath })

      const rendered = renderWithRoot(<ComposerHarness />)

      try {
        const textarea = rendered.container.querySelector(LABEL_TEXTAREA_NAME_MESSAGETEXT) as HTMLTextAreaElement
        const pasteEvent = createPasteEvent({
          types: ['Files'],
          items: [{ kind: 'file', type: LABEL_TEXT_PLAIN }],
          files: [file],
        })

        await act(async () => {
          textarea.dispatchEvent(pasteEvent)
        })

        expect(pasteEvent.defaultPrevented).toBe(true)
        expect(resolveFilePath).toHaveBeenCalledWith(file)
        expect(rendered.getByTestId(SELECTOR_CHAT_COMPOSER_ATTACHMENT).textContent).toBe('1')
        expect(rendered.container.textContent).toContain('note.txt')
      } finally {
        rendered.unmount()
      }
    })
  })

  describe('clipboard image handling', () => {
    it('writes pasted clipboard image data to a temporary attachment when the clipboard file has no local path', async () => {
      const imageFile = new File(['png-data'], LABEL_PASTED_IMAGE_PNG, { type: 'image/png' })
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
          suggestedName: LABEL_PASTED_IMAGE_PNG,
        },
      }))
      const writeTempFile = vi.fn(async () => ({
        ok: true as const,
        file: {
          path: LABEL_TEMP_IMAGE_PNG,
          name: LABEL_TEMP_IMAGE_PNG,
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
        const textarea = rendered.container.querySelector(LABEL_TEXTAREA_NAME_MESSAGETEXT) as HTMLTextAreaElement
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
        expect(rendered.getByTestId(SELECTOR_CHAT_COMPOSER_ATTACHMENT).textContent).toBe('1')
        expect(rendered.container.textContent).toContain(LABEL_TEMP_IMAGE_PNG)
        expect(rendered.container.querySelector('[data-testid="chat-composer-attachment-notice"]')).toBeNull()
      } finally {
        rendered.unmount()
      }
    })

    it('keeps both local files and pathless clipboard images when a single paste contains both', async () => {
      const localFile = createFileWithPath({
        name: 'note.txt',
        type: LABEL_TEXT_PLAIN,
        path: 'attachment-note.txt',
        content: 'hello',
      })
      const imageFile = new File(['png-data'], LABEL_PASTED_IMAGE_PNG, { type: 'image/png' })
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
          suggestedName: LABEL_PASTED_IMAGE_PNG,
        },
      }))
      const writeTempFile = vi.fn(async () => ({
        ok: true as const,
        file: {
          path: LABEL_TEMP_IMAGE_PNG,
          name: LABEL_TEMP_IMAGE_PNG,
          mimeType: 'image/png',
          size: 8,
          createdAt: '2026-05-09T00:00:00.000Z',
          isTemporary: true as const,
        },
      }))
      installMockAttachmentManager({
        resolveFilePath: vi.fn((candidate: File) => (candidate === localFile ? 'attachment-note.txt' : null)),
        readClipboardData,
        writeTempFile,
      })

      const rendered = renderWithRoot(<ComposerHarness />)

      try {
        const textarea = rendered.container.querySelector(LABEL_TEXTAREA_NAME_MESSAGETEXT) as HTMLTextAreaElement
        const pasteEvent = createPasteEvent({
          types: ['Files', 'image/png'],
          items: [{ kind: 'file', type: LABEL_TEXT_PLAIN }, { kind: 'file', type: 'image/png' }],
          files: [localFile, imageFile],
        })

        await act(async () => {
          textarea.dispatchEvent(pasteEvent)
        })
        await flushMicrotasks()

        expect(pasteEvent.defaultPrevented).toBe(true)
        expect(readClipboardData).toHaveBeenCalledTimes(1)
        expect(writeTempFile).toHaveBeenCalledTimes(1)
        expect(rendered.getByTestId(SELECTOR_CHAT_COMPOSER_ATTACHMENT).textContent).toBe('2')
        expect(rendered.container.textContent).toContain('note.txt')
        expect(rendered.container.textContent).toContain(LABEL_TEMP_IMAGE_PNG)
      } finally {
        rendered.unmount()
      }
    })
  })

  describe('drag and remove', () => {
    it('supports multi-file drag and drop with drag highlight', async () => {
      const rendered = renderWithRoot(<ComposerHarness />)

      try {
        const composerSurface = rendered.getByTestId('chat-composer-surface') as HTMLDivElement
        const files = [
          createFileWithPath({ name: 'a.txt', type: LABEL_TEXT_PLAIN, path: 'drag-a.txt', content: 'A' }),
          createFileWithPath({ name: 'b.txt', type: LABEL_TEXT_PLAIN, path: 'drag-b.txt', content: 'B' }),
        ]

        await act(async () => {
          composerSurface.dispatchEvent(createDragEvent('dragenter', files))
        })
        expect(composerSurface.className).toContain('copilot-chat__composer-surface--drag-active')

        await act(async () => {
          composerSurface.dispatchEvent(createDragEvent('drop', files))
        })

        expect(composerSurface.className).not.toContain('copilot-chat__composer-surface--drag-active')
        expect(rendered.getByTestId(SELECTOR_CHAT_COMPOSER_ATTACHMENT).textContent).toBe('2')
      } finally {
        rendered.unmount()
      }
    })

    it('removes attachments from the panel list', async () => {
      const rendered = renderWithRoot(<ComposerHarness />)

      try {
        const textarea = rendered.container.querySelector(LABEL_TEXTAREA_NAME_MESSAGETEXT) as HTMLTextAreaElement
        const file = createFileWithPath({
          name: 'remove.txt',
          type: LABEL_TEXT_PLAIN,
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
  })

  describe('previews and notices', () => {
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
          path: LABEL_PREVIEW_NOTE_TXT,
          name: LABEL_PREVIEW_NOTE_TXT,
          size: 12,
          mimeType: LABEL_TEXT_PLAIN as 'text/plain',
          text: 'preview body',
          truncated: false,
          maxBytes: 262144,
          encoding: 'utf-8' as const,
        })),
      })

      const rendered = renderWithRoot(<ComposerHarness />)

      try {
        const textarea = rendered.container.querySelector(LABEL_TEXTAREA_NAME_MESSAGETEXT) as HTMLTextAreaElement
        const imageFile = createFileWithPath({
          name: 'preview.png',
          type: 'image/png',
          path: 'preview-image.png',
          content: 'img',
        })
        const textFile = createFileWithPath({
          name: LABEL_PREVIEW_NOTE_TXT,
          type: LABEL_TEXT_PLAIN,
          path: LABEL_PREVIEW_NOTE_TXT,
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
        const textarea = rendered.container.querySelector(LABEL_TEXTAREA_NAME_MESSAGETEXT) as HTMLTextAreaElement
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
        const textarea = rendered.container.querySelector(LABEL_TEXTAREA_NAME_MESSAGETEXT) as HTMLTextAreaElement
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
})

function ComposerHarness() {
  const modelGroups = useMemo<CopilotModelGroup[]>(() => [
    {
      key: LABEL_PROVIDER_THINKING,
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
    providerHint: LABEL_PROVIDER_THINKING,
    routeFingerprint: {
      providerProfileId: LABEL_PROVIDER_THINKING,
      provider: LABEL_PROVIDER_THINKING,
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
      profileId: LABEL_PROVIDER_THINKING,
      modelId,
    },
    route: {
      routeRef: {
        routeKind: 'provider-model',
        profileId: LABEL_PROVIDER_THINKING,
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
        path: LABEL_TEMP_IMAGE_PNG,
        name: LABEL_TEMP_IMAGE_PNG,
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

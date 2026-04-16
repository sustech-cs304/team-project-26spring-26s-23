import { useEffect, useId, useMemo, useRef, useState } from 'react'

import type { RuntimeToolDirectoryEntry } from '../chat-contract'
import { resolveCopilotToolPresentation } from '../tool-presentation'
import {
  filterCopilotTools,
  groupCopilotTools,
  invertToolSelection,
  pickRecommendedToolIds,
  selectAllToolIds,
  toggleToolIdInSelection,
} from '../tool-picker'

interface ToolPickerProps {
  tools: RuntimeToolDirectoryEntry[]
  selectedToolIds: string[]
  recommendedToolIds: string[]
  onChangeToolIds: (toolIds: string[]) => void
  disabled?: boolean
}

export function ToolPicker({
  tools,
  selectedToolIds,
  recommendedToolIds,
  onChangeToolIds,
  disabled = false,
}: ToolPickerProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const pickerRef = useRef<HTMLDivElement | null>(null)
  const panelId = useId()

  const filteredTools = useMemo(() => filterCopilotTools({ tools, query: searchQuery }), [searchQuery, tools])
  const groupedTools = useMemo(() => groupCopilotTools(filteredTools), [filteredTools])
  const selectedToolSet = useMemo(() => new Set(selectedToolIds), [selectedToolIds])
  const selectedToolSummary = useMemo(() => buildSelectedToolSummary(tools, selectedToolIds), [selectedToolIds, tools])
  const selectedToolTriggerLabel = useMemo(
    () => buildToolPickerTriggerLabel(selectedToolSummary),
    [selectedToolSummary],
  )

  useEffect(() => {
    if (!isOpen) {
      return undefined
    }

    const handlePointerDown = (event: MouseEvent) => {
      if (pickerRef.current?.contains(event.target as Node)) {
        return
      }

      setIsOpen(false)
    }

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsOpen(false)
      }
    }

    document.addEventListener('mousedown', handlePointerDown)
    document.addEventListener('keydown', handleEscape)

    return () => {
      document.removeEventListener('mousedown', handlePointerDown)
      document.removeEventListener('keydown', handleEscape)
    }
  }, [isOpen])

  return (
    <div className="copilot-tool-picker" ref={pickerRef}>
      {isOpen
        ? (
            <button
              type="button"
              className="copilot-model-picker__trigger copilot-tool-picker__trigger"
              aria-haspopup="dialog"
              aria-expanded="true"
              aria-controls={panelId}
              aria-label={selectedToolTriggerLabel}
              title={selectedToolTriggerLabel}
              disabled={disabled}
              onClick={() => {
                setIsOpen((current) => !current)
              }}
              data-testid="chat-tool-picker-trigger"
            >
              <span className="copilot-tool-picker__trigger-copy">
                <span className="copilot-model-picker__trigger-label copilot-tool-picker__summary">{selectedToolSummary}</span>
              </span>
              <span className="copilot-tool-picker__trigger-side">
                <span className="copilot-model-picker__trigger-caret" aria-hidden="true">
                  ▴
                </span>
              </span>
            </button>
          )
        : (
            <button
              type="button"
              className="copilot-model-picker__trigger copilot-tool-picker__trigger"
              aria-haspopup="dialog"
              aria-expanded="false"
              aria-controls={panelId}
              aria-label={selectedToolTriggerLabel}
              title={selectedToolTriggerLabel}
              disabled={disabled}
              onClick={() => {
                setIsOpen((current) => !current)
              }}
              data-testid="chat-tool-picker-trigger"
            >
              <span className="copilot-tool-picker__trigger-copy">
                <span className="copilot-model-picker__trigger-label copilot-tool-picker__summary">{selectedToolSummary}</span>
              </span>
              <span className="copilot-tool-picker__trigger-side">
                <span className="copilot-model-picker__trigger-caret" aria-hidden="true">
                  ▾
                </span>
              </span>
            </button>
          )}

      {isOpen && (
        <section
          id={panelId}
          className="copilot-model-picker__panel copilot-tool-picker__panel"
          role="dialog"
          aria-label="选择工具"
          data-testid="chat-tool-picker-panel"
        >
          <div className="copilot-model-picker__search-shell">
            <input
              type="search"
              className="copilot-model-picker__search"
              placeholder="搜索工具…"
              value={searchQuery}
              onChange={(event) => {
                setSearchQuery(event.currentTarget.value)
              }}
              data-testid="chat-tool-picker-search"
            />
          </div>

          <div className="copilot-tool-picker__quick-actions" aria-label="工具快捷操作">
            <button
              type="button"
              className="copilot-model-picker__tag copilot-model-picker__tag--all"
              onClick={() => {
                onChangeToolIds(selectAllToolIds(tools))
              }}
              data-testid="chat-tool-picker-select-all"
            >
              全选
            </button>
            <button
              type="button"
              className="copilot-model-picker__tag copilot-model-picker__tag--neutral"
              onClick={() => {
                onChangeToolIds(invertToolSelection(tools, selectedToolIds))
              }}
              data-testid="chat-tool-picker-invert"
            >
              反选
            </button>
            <button
              type="button"
              className="copilot-model-picker__tag copilot-model-picker__tag--tools"
              onClick={() => {
                onChangeToolIds(pickRecommendedToolIds({ tools, recommendedToolIds }))
              }}
              data-testid="chat-tool-picker-select-recommended"
            >
              推荐工具集
            </button>
          </div>

          <div className="copilot-model-picker__groups">
            {groupedTools.length === 0
              ? (
                  <p className="copilot-model-picker__empty">未找到匹配的工具。</p>
                )
              : groupedTools.map((group) => (
                  <section key={group.key} className="copilot-model-picker__group">
                    <p className="copilot-model-picker__group-title">{group.title}</p>
                    <div className="copilot-model-picker__list">
                      {group.tools.map((tool) => {
                        const isSelected = selectedToolSet.has(tool.toolId)
                        const presentation = resolveCopilotToolPresentation(tool)

                        return isSelected
                          ? (
                              <button
                                key={tool.toolId}
                                type="button"
                                className="copilot-model-picker__option copilot-tool-picker__option copilot-model-picker__option--selected copilot-tool-picker__option--selected"
                                aria-pressed="true"
                                onClick={() => {
                                  onChangeToolIds(toggleToolIdInSelection(selectedToolIds, tool.toolId))
                                }}
                                data-testid={`chat-tool-option-${tool.toolId}`}
                              >
                                <span className="copilot-tool-picker__option-check" aria-hidden="true">
                                  ✓
                                </span>
                                <span className="copilot-model-picker__option-body">
                                  <span className="copilot-model-picker__option-name copilot-tool-picker__option-name">{presentation.name}</span>
                                  <span className="copilot-tool-picker__option-description">{presentation.description}</span>
                                </span>
                                <span className="copilot-model-picker__option-tags" aria-hidden="true">
                                  <span className={`copilot-model-picker__option-tag ${buildToolTagClassName(tool.kind, 'kind')}`}>
                                    {tool.kind}
                                  </span>
                                  <span className={`copilot-model-picker__option-tag ${buildToolTagClassName(tool.availability, 'availability')}`}>
                                    {formatToolAvailability(tool.availability)}
                                  </span>
                                </span>
                              </button>
                            )
                          : (
                              <button
                                key={tool.toolId}
                                type="button"
                                className="copilot-model-picker__option copilot-tool-picker__option"
                                aria-pressed="false"
                                onClick={() => {
                                  onChangeToolIds(toggleToolIdInSelection(selectedToolIds, tool.toolId))
                                }}
                                data-testid={`chat-tool-option-${tool.toolId}`}
                              >
                                <span className="copilot-tool-picker__option-check" aria-hidden="true">
                                  +
                                </span>
                                <span className="copilot-model-picker__option-body">
                                  <span className="copilot-model-picker__option-name copilot-tool-picker__option-name">{presentation.name}</span>
                                  <span className="copilot-tool-picker__option-description">{presentation.description}</span>
                                </span>
                                <span className="copilot-model-picker__option-tags" aria-hidden="true">
                                  <span className={`copilot-model-picker__option-tag ${buildToolTagClassName(tool.kind, 'kind')}`}>
                                    {tool.kind}
                                  </span>
                                  <span className={`copilot-model-picker__option-tag ${buildToolTagClassName(tool.availability, 'availability')}`}>
                                    {formatToolAvailability(tool.availability)}
                                  </span>
                                </span>
                              </button>
                            )
                      })}
                    </div>
                  </section>
                ))}
          </div>
        </section>
      )}
    </div>
  )
}

function buildSelectedToolSummary(tools: RuntimeToolDirectoryEntry[], selectedToolIds: string[]): string {
  const selectedCount = tools.filter((tool) => selectedToolIds.includes(tool.toolId)).length
  return selectedCount === 0 ? '未启用工具' : `启用 ${selectedCount} 项工具`
}

function buildToolPickerTriggerLabel(summary: string): string {
  return `工具：${summary}`
}

function buildToolTagClassName(value: string, role: 'kind' | 'availability'): string {
  if (role === 'kind') {
    return value === 'external'
      ? 'copilot-tool-picker__option-tag--external'
      : 'copilot-tool-picker__option-tag--builtin'
  }

  switch (value) {
    case 'available':
      return 'copilot-tool-picker__option-tag--available'
    case 'disabled-by-global-setting':
    case 'unavailable':
      return 'copilot-tool-picker__option-tag--warning'
    default:
      return 'copilot-tool-picker__option-tag--neutral'
  }
}

function formatToolAvailability(availability: string): string {
  switch (availability) {
    case 'available':
      return '可用'
    case 'disabled-by-global-setting':
      return '全局关闭'
    case 'unavailable':
      return '不可用'
    default:
      return availability
  }
}

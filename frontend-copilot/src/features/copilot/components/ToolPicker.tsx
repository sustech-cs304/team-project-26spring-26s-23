import { useEffect, useId, useMemo, useRef, useState } from 'react'

import { getCopilotChatCopy } from '../../../workbench/locale'
import type { RuntimeToolDirectoryEntry } from '../chat-contract'
import {
  filterCopilotTools,
  groupCopilotTools,
  invertToolSelection,
  pickRecommendedToolIds,
  selectAllToolIds,
  toggleToolIdInSelection,
} from '../tool-picker'

interface ToolPickerProps {
  language?: string
  tools: RuntimeToolDirectoryEntry[]
  selectedToolIds: string[]
  recommendedToolIds: string[]
  onChangeToolIds: (toolIds: string[]) => void
  disabled?: boolean
}

export function ToolPicker({
  language = 'zh-CN',
  tools,
  selectedToolIds,
  recommendedToolIds,
  onChangeToolIds,
  disabled = false,
}: ToolPickerProps) {
  const copy = getCopilotChatCopy(language)
  const [isOpen, setIsOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const pickerRef = useRef<HTMLDivElement | null>(null)
  const panelId = useId()

  const filteredTools = useMemo(() => filterCopilotTools({ tools, query: searchQuery }), [searchQuery, tools])
  const groupedTools = useMemo(() => groupCopilotTools(filteredTools), [filteredTools])
  const selectedToolSet = useMemo(() => new Set(selectedToolIds), [selectedToolIds])
  const selectedToolSummary = useMemo(
    () => buildSelectedToolSummary(tools, selectedToolIds, language),
    [language, selectedToolIds, tools],
  )
  const selectedToolTriggerLabel = useMemo(
    () => buildToolPickerTriggerLabel(selectedToolSummary, language),
    [language, selectedToolSummary],
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
          aria-label={copy.toolPicker.panelAriaLabel}
          data-testid="chat-tool-picker-panel"
        >
          <div className="copilot-model-picker__search-shell">
            <input
              type="search"
              className="copilot-model-picker__search"
              placeholder={copy.toolPicker.searchPlaceholder}
              value={searchQuery}
              onChange={(event) => {
                setSearchQuery(event.currentTarget.value)
              }}
              data-testid="chat-tool-picker-search"
            />
          </div>

          <div className="copilot-tool-picker__quick-actions" aria-label={copy.toolPicker.quickActionsAriaLabel}>
            <button
              type="button"
              className="copilot-model-picker__tag copilot-model-picker__tag--all"
              onClick={() => {
                onChangeToolIds(selectAllToolIds(tools))
              }}
              data-testid="chat-tool-picker-select-all"
            >
              {copy.toolPicker.selectAll}
            </button>
            <button
              type="button"
              className="copilot-model-picker__tag copilot-model-picker__tag--neutral"
              onClick={() => {
                onChangeToolIds(invertToolSelection(tools, selectedToolIds))
              }}
              data-testid="chat-tool-picker-invert"
            >
              {copy.toolPicker.invertSelection}
            </button>
            <button
              type="button"
              className="copilot-model-picker__tag copilot-model-picker__tag--tools"
              onClick={() => {
                onChangeToolIds(pickRecommendedToolIds({ tools, recommendedToolIds }))
              }}
              data-testid="chat-tool-picker-select-recommended"
            >
              {copy.toolPicker.recommendedSet}
            </button>
          </div>

          <div className="copilot-model-picker__groups">
            {groupedTools.length === 0
              ? (
                  <p className="copilot-model-picker__empty">{copy.toolPicker.noMatchingTools}</p>
                )
              : groupedTools.map((group) => (
                  <section key={group.key} className="copilot-model-picker__group">
                    <p className="copilot-model-picker__group-title">{group.title}</p>
                    <div className="copilot-model-picker__list">
                      {group.tools.map((tool) => {
                        const isSelected = selectedToolSet.has(tool.toolId)

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
                                  <span className="copilot-model-picker__option-name">{tool.displayName ?? tool.toolId}</span>
                                  <span className="copilot-model-picker__option-meta">{tool.toolId}</span>
                                  {tool.description && (
                                    <span className="copilot-tool-picker__option-description">{tool.description}</span>
                                  )}
                                </span>
                                <span className="copilot-model-picker__option-tags" aria-hidden="true">
                                  <span className={`copilot-model-picker__option-tag ${buildToolTagClassName(tool.kind, 'kind')}`}>
                                    {tool.kind}
                                  </span>
                                  <span className={`copilot-model-picker__option-tag ${buildToolTagClassName(tool.availability, 'availability')}`}>
                                    {formatToolAvailability(tool.availability, language)}
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
                                  <span className="copilot-model-picker__option-name">{tool.displayName ?? tool.toolId}</span>
                                  <span className="copilot-model-picker__option-meta">{tool.toolId}</span>
                                  {tool.description && (
                                    <span className="copilot-tool-picker__option-description">{tool.description}</span>
                                  )}
                                </span>
                                <span className="copilot-model-picker__option-tags" aria-hidden="true">
                                  <span className={`copilot-model-picker__option-tag ${buildToolTagClassName(tool.kind, 'kind')}`}>
                                    {tool.kind}
                                  </span>
                                  <span className={`copilot-model-picker__option-tag ${buildToolTagClassName(tool.availability, 'availability')}`}>
                                    {formatToolAvailability(tool.availability, language)}
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

function buildSelectedToolSummary(tools: RuntimeToolDirectoryEntry[], selectedToolIds: string[], language: string): string {
  const selectedCount = tools.filter((tool) => selectedToolIds.includes(tool.toolId)).length
  return selectedCount === 0
    ? getCopilotChatCopy(language).toolPicker.noToolsEnabled
    : getCopilotChatCopy(language).toolPicker.enabledToolsSummary(selectedCount)
}

function buildToolPickerTriggerLabel(summary: string, language: string): string {
  return getCopilotChatCopy(language).toolPicker.triggerLabel(summary)
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

function formatToolAvailability(availability: string, language: string): string {
  const labels = getCopilotChatCopy(language).toolPicker.availabilityLabels

  switch (availability) {
    case 'available':
      return labels.available
    case 'disabled-by-global-setting':
      return labels.disabledByGlobalSetting
    case 'unavailable':
      return labels.unavailable
    default:
      return availability
  }
}

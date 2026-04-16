import { useEffect, useId, useMemo, useRef, useState } from 'react'

import { getCopilotChatCopy } from '../../../workbench/locale'
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
  const [collapsedGroupKeys, setCollapsedGroupKeys] = useState<string[]>([])
  const pickerRef = useRef<HTMLDivElement | null>(null)
  const panelId = useId()

  const allGroupedTools = useMemo(
    () => groupCopilotTools({ tools, recommendedToolIds }),
    [recommendedToolIds, tools],
  )
  const filteredTools = useMemo(() => filterCopilotTools({ tools, query: searchQuery }), [searchQuery, tools])
  const groupedTools = useMemo(
    () => groupCopilotTools({ tools: filteredTools, recommendedToolIds }),
    [filteredTools, recommendedToolIds],
  )
  const isSearching = searchQuery.trim() !== ''
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
    const allGroupKeySet = new Set(allGroupedTools.map((group) => group.key))

    setCollapsedGroupKeys((current) => {
      const next = current.filter((groupKey) => allGroupKeySet.has(groupKey))
      return next.length === current.length ? current : next
    })
  }, [allGroupedTools])

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
              : groupedTools.map((group) => {
                  const isExpanded = isSearching || !collapsedGroupKeys.includes(group.key)

                  return (
                    <section key={group.key} className="copilot-model-picker__group copilot-tool-picker__group">
                      {isExpanded
                        ? (
                            <button
                              type="button"
                              className="copilot-tool-picker__group-toggle"
                              aria-expanded="true"
                              onClick={() => {
                                if (isSearching) {
                                  return
                                }

                                setCollapsedGroupKeys((current) => toggleCollapsedGroupKey(current, group.key))
                              }}
                            >
                              <span className="copilot-tool-picker__group-copy">
                                <span className="copilot-tool-picker__group-title">{group.title}</span>
                                <span className="copilot-tool-picker__group-count">{group.tools.length}</span>
                              </span>
                              <span
                                className="copilot-tool-picker__group-caret"
                                aria-hidden="true"
                                data-expanded="true"
                              >
                                ▴
                              </span>
                            </button>
                          )
                        : (
                            <button
                              type="button"
                              className="copilot-tool-picker__group-toggle"
                              aria-expanded="false"
                              onClick={() => {
                                setCollapsedGroupKeys((current) => toggleCollapsedGroupKey(current, group.key))
                              }}
                            >
                              <span className="copilot-tool-picker__group-copy">
                                <span className="copilot-tool-picker__group-title">{group.title}</span>
                                <span className="copilot-tool-picker__group-count">{group.tools.length}</span>
                              </span>
                              <span
                                className="copilot-tool-picker__group-caret"
                                aria-hidden="true"
                                data-expanded="false"
                              >
                                ▾
                              </span>
                            </button>
                          )}

                      {isExpanded && (
                        <div className="copilot-model-picker__list copilot-tool-picker__group-list">
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
                                  </button>
                                )
                          })}
                        </div>
                      )}
                    </section>
                  )
                })}
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

function toggleCollapsedGroupKey(collapsedGroupKeys: string[], groupKey: string): string[] {
  return collapsedGroupKeys.includes(groupKey)
    ? collapsedGroupKeys.filter((currentGroupKey) => currentGroupKey !== groupKey)
    : [...collapsedGroupKeys, groupKey]
}

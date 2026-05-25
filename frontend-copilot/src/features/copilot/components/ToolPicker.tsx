import { useEffect, useId, useMemo, useRef, useState } from 'react'

import type { SettingsWorkspaceToolPermissionPolicyState } from '../../../../electron/settings-workspace/schema'
import { getCopilotChatCopy } from '../../../workbench/locale'
import type { RuntimeToolDirectoryEntry } from '../chat-contract'
import { resolveCopilotToolPresentation } from '../tool-presentation'
import {
  buildCopilotToolViewModels,
  filterCopilotTools,
  groupCopilotTools,
  invertToolSelection,
  pickRecommendedToolIds,
  selectAllToolIds,
  toggleToolIdInSelection,
  type CopilotToolDisabledReason,
} from '../tool-picker'

interface ToolPickerProps {
  language?: string
  tools: RuntimeToolDirectoryEntry[]
  selectedToolIds: string[]
  recommendedToolIds: string[]
  toolPermissionPolicy?: SettingsWorkspaceToolPermissionPolicyState | null
  onChangeToolIds: (toolIds: string[]) => void
  disabled?: boolean
}

export function ToolPicker({
  language = 'zh-CN',
  tools,
  selectedToolIds,
  recommendedToolIds,
  toolPermissionPolicy = null,
  onChangeToolIds,
  disabled = false,
}: ToolPickerProps) {
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
  const filteredToolViewModels = useMemo(
    () => buildCopilotToolViewModels({ tools: filteredTools, policy: toolPermissionPolicy }),
    [filteredTools, toolPermissionPolicy],
  )
  const groupedTools = useMemo(
    () => groupCopilotTools({
      tools: filteredToolViewModels.map((entry) => entry.tool),
      recommendedToolIds,
    }),
    [filteredToolViewModels, recommendedToolIds],
  )
  const toolViewModelById = useMemo(
    () => new Map(filteredToolViewModels.map((entry) => [entry.tool.toolId, entry] as const)),
    [filteredToolViewModels],
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

  useToolPickerOutsideClick(pickerRef, isOpen, setIsOpen)

  return (
    <div className="copilot-tool-picker" ref={pickerRef}>
      <ToolPickerTrigger
        isOpen={isOpen}
        selectedToolTriggerLabel={selectedToolTriggerLabel}
        selectedToolSummary={selectedToolSummary}
        panelId={panelId}
        disabled={disabled}
        onToggle={() => setIsOpen((current) => !current)}
      />

      {isOpen && (
        <ToolPickerPanel
          panelId={panelId}
          searchQuery={searchQuery}
          groupedTools={groupedTools}
          isSearching={isSearching}
          collapsedGroupKeys={collapsedGroupKeys}
          selectedToolSet={selectedToolSet}
          toolViewModelById={toolViewModelById}
          tools={tools}
          selectedToolIds={selectedToolIds}
          recommendedToolIds={recommendedToolIds}
          toolPermissionPolicy={toolPermissionPolicy}
          language={language}
          onSearchChange={setSearchQuery}
          onCollapsedGroupKeysChange={setCollapsedGroupKeys}
          onChangeToolIds={onChangeToolIds}
        />
      )}
    </div>
  )
}

function useToolPickerOutsideClick(
  pickerRef: React.RefObject<HTMLDivElement | null>,
  isOpen: boolean,
  setIsOpen: (value: boolean) => void,
) {
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
  }, [isOpen, pickerRef, setIsOpen])
}

function ToolPickerTrigger({
  isOpen,
  selectedToolTriggerLabel,
  selectedToolSummary,
  panelId,
  disabled,
  onToggle,
}: {
  isOpen: boolean
  selectedToolTriggerLabel: string
  selectedToolSummary: string
  panelId: string
  disabled: boolean
  onToggle: () => void
}) {
  return (
    <button
      type="button"
      className="copilot-model-picker__trigger copilot-tool-picker__trigger"
      aria-haspopup="dialog"
      aria-expanded={isOpen}
      aria-controls={panelId}
      aria-label={selectedToolTriggerLabel}
      title={selectedToolTriggerLabel}
      disabled={disabled}
      onClick={onToggle}
      data-testid="chat-tool-picker-trigger"
    >
      <span className="copilot-tool-picker__trigger-copy">
        <span className="copilot-model-picker__trigger-label copilot-tool-picker__summary">{selectedToolSummary}</span>
      </span>
      <span className="copilot-tool-picker__trigger-side">
        <span className="copilot-model-picker__trigger-caret" aria-hidden="true">
          {isOpen ? '▴' : '▾'}
        </span>
      </span>
    </button>
  )
}

function ToolPickerPanel({
  panelId,
  searchQuery,
  groupedTools,
  isSearching,
  collapsedGroupKeys,
  selectedToolSet,
  toolViewModelById,
  tools,
  selectedToolIds,
  recommendedToolIds,
  toolPermissionPolicy,
  language,
  onSearchChange,
  onCollapsedGroupKeysChange,
  onChangeToolIds,
}: {
  panelId: string
  searchQuery: string
  groupedTools: ReturnType<typeof groupCopilotTools>
  isSearching: boolean
  collapsedGroupKeys: string[]
  selectedToolSet: Set<string>
  toolViewModelById: Map<string, { tool: RuntimeToolDirectoryEntry; disabled: boolean; disabledReason: CopilotToolDisabledReason | null }>
  tools: RuntimeToolDirectoryEntry[]
  selectedToolIds: string[]
  recommendedToolIds: string[]
  toolPermissionPolicy: ToolPickerProps['toolPermissionPolicy']
  language: string
  onSearchChange: (value: string) => void
  onCollapsedGroupKeysChange: (keys: string[]) => void
  onChangeToolIds: (toolIds: string[]) => void
}) {
  const copy = getCopilotChatCopy(language)

  return (
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
            onSearchChange(event.currentTarget.value)
          }}
          data-testid="chat-tool-picker-search"
        />
      </div>

      <div className="copilot-tool-picker__quick-actions" aria-label={copy.toolPicker.quickActionsAriaLabel}>
        <button
          type="button"
          className="copilot-model-picker__tag copilot-model-picker__tag--all"
          onClick={() => {
            onChangeToolIds(selectAllToolIds({ tools, policy: toolPermissionPolicy ?? null }))
          }}
          data-testid="chat-tool-picker-select-all"
        >
          {copy.toolPicker.selectAll}
        </button>
        <button
          type="button"
          className="copilot-model-picker__tag copilot-model-picker__tag--neutral"
          onClick={() => {
            onChangeToolIds(invertToolSelection({ tools, selectedToolIds, policy: toolPermissionPolicy ?? null }))
          }}
          data-testid="chat-tool-picker-invert"
        >
          {copy.toolPicker.invertSelection}
        </button>
        <button
          type="button"
          className="copilot-model-picker__tag copilot-model-picker__tag--tools"
          onClick={() => {
            onChangeToolIds(pickRecommendedToolIds({ tools, recommendedToolIds, policy: toolPermissionPolicy ?? null }))
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
              <ToolPickerGroup
                key={group.key}
                group={group}
                isExpanded={isSearching || !collapsedGroupKeys.includes(group.key)}
                selectedToolSet={selectedToolSet}
                toolViewModelById={toolViewModelById}
                selectedToolIds={selectedToolIds}
                toolPermissionPolicy={toolPermissionPolicy}
                language={language}
                onChangeToolIds={onChangeToolIds}
                onToggleCollapsed={() => {
                  if (isSearching) {
                    return
                  }
                  onCollapsedGroupKeysChange(toggleCollapsedGroupKey(collapsedGroupKeys, group.key))
                }}
              />
            ))}
      </div>
    </section>
  )
}

function ToolPickerGroup({
  group,
  isExpanded,
  selectedToolSet,
  toolViewModelById,
  selectedToolIds,
  toolPermissionPolicy,
  language,
  onChangeToolIds,
  onToggleCollapsed,
}: {
  group: ReturnType<typeof groupCopilotTools>[number]
  isExpanded: boolean
  selectedToolSet: Set<string>
  toolViewModelById: Map<string, { tool: RuntimeToolDirectoryEntry; disabled: boolean; disabledReason: CopilotToolDisabledReason | null }>
  selectedToolIds: string[]
  toolPermissionPolicy: ToolPickerProps['toolPermissionPolicy']
  language: string
  onChangeToolIds: (toolIds: string[]) => void
  onToggleCollapsed: () => void
}) {
  return (
    <section className="copilot-model-picker__group copilot-tool-picker__group">
      <ToolPickerGroupToggle
        isExpanded={isExpanded}
        title={group.title}
        count={group.tools.length}
        onToggle={onToggleCollapsed}
      />

      {isExpanded && (
        <div className="copilot-model-picker__list copilot-tool-picker__group-list">
          {group.tools.map((tool) => (
            <ToolPickerOption
              key={tool.toolId}
              tool={tool}
              isSelected={selectedToolSet.has(tool.toolId)}
              disabledReason={toolViewModelById.get(tool.toolId)?.disabledReason ?? null}
              selectedToolIds={selectedToolIds}
              toolPermissionPolicy={toolPermissionPolicy}
              language={language}
              onChangeToolIds={onChangeToolIds}
            />
          ))}
        </div>
      )}
    </section>
  )
}

function ToolPickerGroupToggle({
  isExpanded,
  title,
  count,
  onToggle,
}: {
  isExpanded: boolean
  title: string
  count: number
  onToggle: () => void
}) {
  return (
    <button
      type="button"
      className="copilot-tool-picker__group-toggle"
      aria-expanded={isExpanded}
      onClick={onToggle}
    >
      <span className="copilot-tool-picker__group-copy">
        <span className="copilot-tool-picker__group-title">{title}</span>
        <span className="copilot-tool-picker__group-count">{count}</span>
      </span>
      <span
        className="copilot-tool-picker__group-caret"
        aria-hidden="true"
        data-expanded={isExpanded}
      >
        {isExpanded ? '▴' : '▾'}
      </span>
    </button>
  )
}

function ToolPickerOption({
  tool,
  isSelected,
  disabledReason,
  selectedToolIds,
  toolPermissionPolicy,
  language,
  onChangeToolIds,
}: {
  tool: RuntimeToolDirectoryEntry
  isSelected: boolean
  disabledReason: CopilotToolDisabledReason | null
  selectedToolIds: string[]
  toolPermissionPolicy: ToolPickerProps['toolPermissionPolicy']
  language: string
  onChangeToolIds: (toolIds: string[]) => void
}) {
  const copy = getCopilotChatCopy(language)
  const presentation = resolveCopilotToolPresentation(tool)
  const disabled = disabledReason !== null
  const blocked = disabled && !isSelected
  const optionTitle = resolveToolOptionDisabledTitle(disabledReason)

  return (
    <button
      type="button"
      className={`copilot-model-picker__option copilot-tool-picker__option${isSelected ? ' copilot-model-picker__option--selected copilot-tool-picker__option--selected' : ''}${disabled ? ' copilot-tool-picker__option--disabled' : ''}`}
      aria-pressed={isSelected}
      aria-disabled={blocked ? 'true' : undefined}
      title={optionTitle}
      onClick={() => {
        onChangeToolIds(toggleToolIdInSelection({
          selectedToolIds,
          tool,
          policy: toolPermissionPolicy ?? null,
        }))
      }}
      data-testid={`chat-tool-option-${tool.toolId}`}
    >
      <span className="copilot-tool-picker__option-check" aria-hidden="true">
        {isSelected ? '✓' : '+'}
      </span>
      <span className="copilot-model-picker__option-body">
        <span className="copilot-tool-picker__option-name-row">
          <span className="copilot-model-picker__option-name copilot-tool-picker__option-name">{presentation.name}</span>
          {disabled ? <span className="copilot-tool-picker__option-status copilot-tool-picker__option-status--disabled">{copy.toolPicker.disabledBadge}</span> : null}
        </span>
        <span className="copilot-tool-picker__option-description">{presentation.description}</span>
        {disabled ? <span className="copilot-tool-picker__option-policy-hint">{resolveToolOptionDisabledHint(disabledReason, copy)}</span> : null}
      </span>
    </button>
  )
}

function resolveToolOptionDisabledTitle(disabledReason: CopilotToolDisabledReason | null): string | undefined {
  switch (disabledReason) {
    case 'policy':
      return '该工具已被设置为总是关闭，需在能力中心重新开启。'
    case 'availability':
      return '该工具当前不可用，不能启用。'
    case null:
      return undefined
  }
}

function resolveToolOptionDisabledHint(
  disabledReason: CopilotToolDisabledReason | null,
  copy: ReturnType<typeof getCopilotChatCopy>,
): string {
  switch (disabledReason) {
    case 'policy':
      return copy.toolPicker.disabledHint
    case 'availability':
      return '当前工具不可用'
    case null:
      return ''
  }
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

import { useEffect, useId, useMemo, useRef, useState, type CSSProperties } from 'react'

import { getCopilotChatCopy } from '../../../workbench/locale'
import {
  createEmptyCopilotModel,
  createFallbackCopilotModel,
  filterCopilotModelGroups,
  getCopilotModelById,
  getCopilotModelTags,
  type CopilotModelIconSpec,
  type CopilotModelGroup,
  type CopilotModelOption,
} from '../model-picker'

interface ModelPickerProps {
  language?: string
  selectedModelId: string
  onSelectModel: (model: CopilotModelOption) => void
  disabled?: boolean
  groups?: CopilotModelGroup[]
}

export function ModelPicker({
  language = 'zh-CN',
  selectedModelId,
  onSelectModel,
  disabled = false,
  groups = [],
}: ModelPickerProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [activeTags, setActiveTags] = useState<string[]>([])
  const pickerRef = useRef<HTMLDivElement | null>(null)
  const panelId = useId()
  const models = useMemo(() => groups.flatMap((group) => group.models), [groups])
  const hasAnyModels = models.length > 0
  const hasSelectedModel = selectedModelId.trim() !== ''

  const resolvedSelectedModel = useMemo(() => getCopilotModelById(selectedModelId, models), [models, selectedModelId])
  const selectedModel = useMemo(
    () => {
      if (!hasAnyModels) {
        return createEmptyCopilotModel()
      }

      return resolvedSelectedModel ?? createFallbackCopilotModel(selectedModelId)
    },
    [hasAnyModels, resolvedSelectedModel, selectedModelId],
  )
  const isSelectedModelInvalid = hasAnyModels && selectedModelId.trim() !== '' && resolvedSelectedModel === null
  const availableTags = useMemo(() => getCopilotModelTags(models), [models])
  const filteredModels = useMemo(
    () => filterCopilotModelGroups({
      groups,
      query: searchQuery,
      tags: activeTags,
    }),
    [activeTags, groups, searchQuery],
  )
  const hasVisibleModels = filteredModels.some((group) => group.models.length > 0)
  const hasAnyGroups = groups.length > 0

  useModelPickerOutsideClick(pickerRef, isOpen, setIsOpen)

  return (
    <div className="copilot-model-picker" ref={pickerRef}>
      <ModelPickerTrigger
        selectedModel={selectedModel}
        isSelectedModelInvalid={isSelectedModelInvalid}
        hasAnyModels={hasAnyModels}
        hasSelectedModel={hasSelectedModel}
        isOpen={isOpen}
        panelId={panelId}
        disabled={disabled}
        language={language}
        onToggle={() => setIsOpen((current) => !current)}
      />

      {isOpen && (
        <ModelPickerPanel
          panelId={panelId}
          searchQuery={searchQuery}
          activeTags={activeTags}
          filteredModels={filteredModels}
          availableTags={availableTags}
          hasAnyGroups={hasAnyGroups}
          hasVisibleModels={hasVisibleModels}
          selectedModelId={selectedModelId}
          language={language}
          onSearchChange={setSearchQuery}
          onActiveTagsChange={setActiveTags}
          onSelectModel={(model) => {
            onSelectModel(model)
            setIsOpen(false)
          }}
        />
      )}
    </div>
  )
}

function useModelPickerOutsideClick(
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

function ModelPickerTrigger({
  selectedModel,
  isSelectedModelInvalid,
  hasAnyModels,
  hasSelectedModel,
  isOpen,
  panelId,
  disabled,
  language,
  onToggle,
}: {
  selectedModel: CopilotModelOption
  isSelectedModelInvalid: boolean
  hasAnyModels: boolean
  hasSelectedModel: boolean
  isOpen: boolean
  panelId: string
  disabled: boolean
  language: string
  onToggle: () => void
}) {
  const copy = getCopilotChatCopy(language)

  return (
    <button
      type="button"
      className={`copilot-model-picker__trigger${isSelectedModelInvalid ? ' copilot-model-picker__trigger--invalid' : ''}`}
      aria-haspopup="dialog"
      aria-expanded={isOpen}
      aria-controls={panelId}
      disabled={disabled || !hasAnyModels}
      onClick={onToggle}
      data-testid="chat-model-picker-trigger"
    >
      <span className="copilot-model-picker__trigger-value" data-testid="chat-model-picker-trigger-value">
        <ModelPickerIcon
          icon={selectedModel.icon}
          title={hasAnyModels && hasSelectedModel ? selectedModel.name : copy.modelPicker.notConfigured}
          language={language}
        />
        <span className="copilot-model-picker__trigger-label">{hasAnyModels && hasSelectedModel ? selectedModel.name : copy.modelPicker.notConfigured}</span>
        {isSelectedModelInvalid && (
          <span className="copilot-model-picker__badge" data-testid="chat-model-picker-invalid-badge">
            {copy.modelPicker.invalidBadge}
          </span>
        )}
      </span>
      <span className="copilot-model-picker__trigger-caret" aria-hidden="true">
        {isOpen ? '▴' : '▾'}
      </span>
    </button>
  )
}

function ModelPickerPanel({
  panelId,
  searchQuery,
  activeTags,
  filteredModels,
  availableTags,
  hasAnyGroups,
  hasVisibleModels,
  selectedModelId,
  language,
  onSearchChange,
  onActiveTagsChange,
  onSelectModel,
}: {
  panelId: string
  searchQuery: string
  activeTags: string[]
  filteredModels: CopilotModelGroup[]
  availableTags: string[]
  hasAnyGroups: boolean
  hasVisibleModels: boolean
  selectedModelId: string
  language: string
  onSearchChange: (value: string) => void
  onActiveTagsChange: (tags: string[]) => void
  onSelectModel: (model: CopilotModelOption) => void
}) {
  const copy = getCopilotChatCopy(language)

  return (
    <section
      id={panelId}
      className="copilot-model-picker__panel"
      role="dialog"
      aria-label={copy.modelPicker.panelAriaLabel}
      data-testid="chat-model-picker-panel"
    >
      <div className="copilot-model-picker__search-shell">
        <input
          type="search"
          className="copilot-model-picker__search"
          placeholder={copy.modelPicker.searchPlaceholder}
          value={searchQuery}
          onChange={(event) => {
            onSearchChange(event.currentTarget.value)
          }}
          data-testid="chat-model-picker-search"
        />
      </div>

      <div className="copilot-model-picker__tags" aria-label={copy.modelPicker.filterByTagAriaLabel}>
        <button
          type="button"
          className={`copilot-model-picker__tag copilot-model-picker__tag--all${activeTags.length === 0 ? ' copilot-model-picker__tag--active' : ''}`}
          aria-pressed={activeTags.length === 0}
          onClick={() => {
            onActiveTagsChange([])
          }}
          data-testid="chat-model-picker-tag-all"
        >
          {copy.modelPicker.allTag}
        </button>
        {availableTags.map((tag) => (
          <button
            key={tag}
            type="button"
            className={buildModelTagClassName(tag, activeTags.includes(tag), 'button')}
            aria-pressed={activeTags.includes(tag)}
            onClick={() => {
              onActiveTagsChange(activeTags.includes(tag)
                ? activeTags.filter((currentTag) => currentTag !== tag)
                : [...activeTags, tag])
            }}
            data-testid={`chat-model-picker-tag-${tag}`}
          >
            {formatModelTagLabel(tag, language)}
          </button>
        ))}
      </div>

      <div className="copilot-model-picker__groups">
        {!hasAnyGroups
          ? (
              <p className="copilot-model-picker__empty">{copy.modelPicker.noModels}</p>
            )
          : (
              <>
                {!hasVisibleModels && (searchQuery.trim() !== '' || activeTags.length > 0) && (
                  <p className="copilot-model-picker__empty">{copy.modelPicker.noMatchingModels}</p>
                )}
                {filteredModels.map((group) => (
                  <ModelPickerGroup
                    key={group.key}
                    group={group}
                    selectedModelId={selectedModelId}
                    language={language}
                    onSelectModel={onSelectModel}
                  />
                ))}
              </>
            )}
      </div>
    </section>
  )
}

function ModelPickerGroup({
  group,
  selectedModelId,
  language,
  onSelectModel,
}: {
  group: CopilotModelGroup
  selectedModelId: string
  language: string
  onSelectModel: (model: CopilotModelOption) => void
}) {
  const copy = getCopilotChatCopy(language)

  return (
    <section key={group.key} className="copilot-model-picker__group">
      <p className="copilot-model-picker__group-title">{group.title}</p>
      <div className="copilot-model-picker__list">
        {group.models.length === 0
          ? (
              <p className="copilot-model-picker__group-empty" data-testid={`chat-model-group-empty-${group.key}`}>
                {copy.modelPicker.noModelsInGroup}
              </p>
            )
          : group.models.map((model) => {
              const isSelected = model.selectionValue === selectedModelId

              return (
                <button
                  key={`${group.key}:${model.id}`}
                  type="button"
                  className={`copilot-model-picker__option${isSelected ? ' copilot-model-picker__option--selected' : ''}`}
                  disabled={!model.available}
                  title={model.unavailableReason ?? model.name}
                  onClick={() => {
                    if (!model.available) {
                      return
                    }

                    onSelectModel(model)
                  }}
                  data-testid={`chat-model-option-${group.key}-${model.id}`}
                >
                  <ModelPickerIcon icon={model.icon} title={model.name} language={language} />
                  <span className="copilot-model-picker__option-body">
                    <span className="copilot-model-picker__option-name">{model.name}</span>
                    {model.unavailableReason !== null && (
                      <span className="copilot-model-picker__option-meta">{model.unavailableReason}</span>
                    )}
                  </span>
                  <span className="copilot-model-picker__option-tags" aria-hidden="true">
                    {model.tags.map((tag) => (
                      <span
                        key={`${group.key}:${model.id}:${tag}`}
                        className={buildModelTagClassName(tag, false, 'chip')}
                      >
                        {formatModelTagLabel(tag, language)}
                      </span>
                    ))}
                  </span>
                </button>
              )
            })}
      </div>
    </section>
  )
}

interface ModelPickerIconProps {
  icon: CopilotModelIconSpec
  title: string
  language?: string
}

export function ModelPickerIcon({ icon, title, language = 'zh-CN' }: ModelPickerIconProps) {
  const copy = getCopilotChatCopy(language)
  return (
    <span
      className="copilot-model-picker__icon"
      style={{ '--model-icon-accent': icon.accent } as CSSProperties}
      aria-label={copy.modelPicker.iconAriaLabel(title)}
    >
      {icon.label}
    </span>
  )
}

function buildModelTagClassName(
  tag: string,
  active: boolean,
  role: 'button' | 'chip',
) {
  const tone = getModelTagTone(tag)
  const baseClassName = role === 'button' ? 'copilot-model-picker__tag' : 'copilot-model-picker__option-tag'

  return [
    baseClassName,
    `${baseClassName}--${tone}`,
    active ? `${baseClassName}--active` : '',
  ]
    .filter((className) => className !== '')
    .join(' ')
}

function getModelTagTone(tag: string): 'reasoning' | 'tools' | 'search' | 'vision' | 'free' | 'neutral' {
  switch (tag) {
    case '推理':
    case 'Reasoning':
      return 'reasoning'
    case '工具':
    case 'Tools':
      return 'tools'
    case '联网':
    case 'Search':
      return 'search'
    case '视觉':
    case 'Vision':
      return 'vision'
    case '免费':
    case 'Free':
      return 'free'
    default:
      return 'neutral'
  }
}

const MODEL_TAG_LABEL_MAP: Record<string, Record<string, string>> = {
  '推理': { 'en-US': 'Reasoning', 'zh-CN': '推理' },
  'Reasoning': { 'en-US': 'Reasoning', 'zh-CN': '推理' },
  '工具': { 'en-US': 'Tools', 'zh-CN': '工具' },
  'Tools': { 'en-US': 'Tools', 'zh-CN': '工具' },
  '联网': { 'en-US': 'Search', 'zh-CN': '联网' },
  'Search': { 'en-US': 'Search', 'zh-CN': '联网' },
  '视觉': { 'en-US': 'Vision', 'zh-CN': '视觉' },
  'Vision': { 'en-US': 'Vision', 'zh-CN': '视觉' },
  '免费': { 'en-US': 'Free', 'zh-CN': '免费' },
  'Free': { 'en-US': 'Free', 'zh-CN': '免费' },
}

function formatModelTagLabel(tag: string, language: string): string {
  return MODEL_TAG_LABEL_MAP[tag]?.[language === 'en-US' ? 'en-US' : 'zh-CN'] ?? tag
}

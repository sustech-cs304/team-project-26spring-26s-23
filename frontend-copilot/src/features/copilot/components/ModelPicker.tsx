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
  const copy = getCopilotChatCopy(language)
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
    <div className="copilot-model-picker" ref={pickerRef}>
      <button
        type="button"
        className={`copilot-model-picker__trigger${isSelectedModelInvalid ? ' copilot-model-picker__trigger--invalid' : ''}`}
        aria-haspopup="dialog"
        aria-expanded={isOpen}
        aria-controls={panelId}
        disabled={disabled || !hasAnyModels}
        onClick={() => {
          setIsOpen((current) => !current)
        }}
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

      {isOpen && (
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
                setSearchQuery(event.currentTarget.value)
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
                setActiveTags([])
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
                  setActiveTags((current) => current.includes(tag)
                    ? current.filter((currentTag) => currentTag !== tag)
                    : [...current, tag])
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
                                  setIsOpen(false)
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
                    ))}
                  </>
                )}
          </div>
        </section>
      )}
    </div>
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

function formatModelTagLabel(tag: string, language: string): string {
  const locale = language === 'en-US' ? 'en-US' : 'zh-CN'

  switch (tag) {
    case '推理':
    case 'Reasoning':
      return locale === 'en-US' ? 'Reasoning' : '推理'
    case '工具':
    case 'Tools':
      return locale === 'en-US' ? 'Tools' : '工具'
    case '联网':
    case 'Search':
      return locale === 'en-US' ? 'Search' : '联网'
    case '视觉':
    case 'Vision':
      return locale === 'en-US' ? 'Vision' : '视觉'
    case '免费':
    case 'Free':
      return locale === 'en-US' ? 'Free' : '免费'
    default:
      return tag
  }
}

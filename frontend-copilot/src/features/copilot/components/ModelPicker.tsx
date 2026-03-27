import { useEffect, useId, useMemo, useRef, useState, type CSSProperties } from 'react'

import {
  COPILOT_SAMPLE_MODELS,
  createFallbackCopilotModel,
  filterCopilotModels,
  getCopilotModelById,
  getCopilotModelTags,
  groupCopilotModels,
  type CopilotModelIconSpec,
  type CopilotModelOption,
} from '../model-picker'

interface ModelPickerProps {
  selectedModelId: string
  onSelectModel: (model: CopilotModelOption) => void
  disabled?: boolean
  models?: CopilotModelOption[]
}

export function ModelPicker({
  selectedModelId,
  onSelectModel,
  disabled = false,
  models = COPILOT_SAMPLE_MODELS,
}: ModelPickerProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [activeTags, setActiveTags] = useState<string[]>([])
  const pickerRef = useRef<HTMLDivElement | null>(null)
  const panelId = useId()

  const selectedModel = useMemo(
    () => getCopilotModelById(selectedModelId, models) ?? createFallbackCopilotModel(selectedModelId),
    [models, selectedModelId],
  )
  const availableTags = useMemo(() => getCopilotModelTags(models), [models])
  const filteredModels = useMemo(
    () => filterCopilotModels({
      models,
      query: searchQuery,
      tags: activeTags,
    }),
    [activeTags, models, searchQuery],
  )
  const groupedModels = useMemo(() => groupCopilotModels(filteredModels), [filteredModels])

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
        className="copilot-model-picker__trigger"
        aria-haspopup="dialog"
        aria-expanded={isOpen}
        aria-controls={panelId}
        disabled={disabled}
        onClick={() => {
          setIsOpen((current) => !current)
        }}
        data-testid="chat-model-picker-trigger"
      >
        <ModelPickerIcon icon={selectedModel.icon} title={selectedModel.name} />
        <span className="copilot-model-picker__trigger-label">{selectedModel.name}</span>
        <span className="copilot-model-picker__trigger-caret" aria-hidden="true">
          {isOpen ? '▴' : '▾'}
        </span>
      </button>

      {isOpen && (
        <section
          id={panelId}
          className="copilot-model-picker__panel"
          role="dialog"
          aria-label="选择模型"
          data-testid="chat-model-picker-panel"
        >
          <div className="copilot-model-picker__search-shell">
            <input
              type="search"
              className="copilot-model-picker__search"
              placeholder="搜索模型…"
              value={searchQuery}
              onChange={(event) => {
                setSearchQuery(event.currentTarget.value)
              }}
              data-testid="chat-model-picker-search"
            />
          </div>

          <div className="copilot-model-picker__tags" aria-label="按标签筛选">
            <button
              type="button"
              className={`copilot-model-picker__tag copilot-model-picker__tag--all${activeTags.length === 0 ? ' copilot-model-picker__tag--active' : ''}`}
              aria-pressed={activeTags.length === 0}
              onClick={() => {
                setActiveTags([])
              }}
              data-testid="chat-model-picker-tag-all"
            >
              全部
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
                {tag}
              </button>
            ))}
          </div>

          <div className="copilot-model-picker__groups">
            {groupedModels.length === 0
              ? (
                  <p className="copilot-model-picker__empty">未找到匹配的模型。</p>
                )
              : groupedModels.map((group) => (
                  <section key={group.key} className="copilot-model-picker__group">
                    <p className="copilot-model-picker__group-title">{group.title}</p>
                    <div className="copilot-model-picker__list">
                      {group.models.map((model) => {
                        const isSelected = model.id === selectedModelId

                        return (
                          <button
                            key={model.id}
                            type="button"
                            className={`copilot-model-picker__option${isSelected ? ' copilot-model-picker__option--selected' : ''}`}
                            onClick={() => {
                              onSelectModel(model)
                              setIsOpen(false)
                            }}
                            data-testid={`chat-model-option-${model.id}`}
                          >
                            <ModelPickerIcon icon={model.icon} title={model.name} />
                            <span className="copilot-model-picker__option-body">
                              <span className="copilot-model-picker__option-name">{model.name}</span>
                              <span className="copilot-model-picker__option-meta">{model.id}</span>
                            </span>
                            <span className="copilot-model-picker__option-tags" aria-hidden="true">
                              {model.tags.map((tag) => (
                                <span
                                  key={`${model.id}:${tag}`}
                                  className={buildModelTagClassName(tag, false, 'chip')}
                                >
                                  {tag}
                                </span>
                              ))}
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

interface ModelPickerIconProps {
  icon: CopilotModelIconSpec
  title: string
}

export function ModelPickerIcon({ icon, title }: ModelPickerIconProps) {
  return (
    <span
      className="copilot-model-picker__icon"
      style={{ '--model-icon-accent': icon.accent } as CSSProperties}
      aria-label={`${title} 图标`}
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
      return 'reasoning'
    case '工具':
      return 'tools'
    case '联网':
      return 'search'
    case '视觉':
      return 'vision'
    case '免费':
      return 'free'
    default:
      return 'neutral'
  }
}

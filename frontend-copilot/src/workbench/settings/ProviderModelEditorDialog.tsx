import { useEffect, useRef, type KeyboardEvent as ReactKeyboardEvent } from 'react'

import { SelectField, TextField } from '../components/FormFields'
import type {
  ModelCapability,
  PositiveThinkingLevelIntent,
  ThinkingCapabilityBudgetSeriesInput,
  ThinkingLevelIntent,
} from '../types'
import {
  buildThinkingDeclarationDefaultLevelOptions,
  buildThinkingDeclarationSeriesOptions,
  getThinkingCapabilityDeclarationMode,
  initializeSupportedThinkingCapabilityDeclaration,
  setThinkingCapabilityDeclarationBinaryLevel,
  setThinkingCapabilityDeclarationBudgetConfig,
  setThinkingCapabilityDeclarationBudgetDefaultMode,
  setThinkingCapabilityDeclarationBudgetTokens,
  setThinkingCapabilityDeclarationDefaultLevel,
  setThinkingCapabilityDeclarationFixedLevel,
  setThinkingCapabilityDeclarationMode,
  setThinkingCapabilityDeclarationSeries,
  THINKING_BUDGET_DEFAULT_MODE_OPTIONS,
  THINKING_DECLARATION_MODE_OPTIONS,
  THINKING_LEVEL_OPTIONS,
  toggleThinkingCapabilityDeclarationLevel,
} from '../thinking-capabilities'
import { currencyOptions, modelCapabilityOptions } from './config'
import type { ModelEditorState } from './provider-profiles'

interface ProviderModelEditorDialogProps {
  modelEditorState: ModelEditorState | null
  modelEditorError: string | null
  onClose: () => void
  onSave: () => void
  onStateChange: (patch: Partial<ModelEditorState>) => void
  onToggleCapability: (capability: ModelCapability) => void
  onClearError: () => void
}

const focusableElementSelector = [
  'a[href]',
  'button:not([disabled])',
  'textarea:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(', ')

const positiveThinkingLevelOptions = THINKING_LEVEL_OPTIONS.filter((option) => option.value !== 'off')
const binaryThinkingLevelOptions = THINKING_LEVEL_OPTIONS.filter((option) => {
  return option.value !== 'off' && option.value !== 'auto'
})

function isFocusableElementVisible(element: HTMLElement) {
  let current: HTMLElement | null = element

  while (current) {
    const style = window.getComputedStyle(current)

    if (style.display === 'none' || style.visibility === 'hidden' || style.pointerEvents === 'none') {
      return false
    }

    current = current.parentElement
  }

  return true
}

function getFocusableElements(container: HTMLElement) {
  return Array.from(container.querySelectorAll<HTMLElement>(focusableElementSelector)).filter((element) => {
    if (element.tabIndex < 0 || element.hasAttribute('disabled') || element.getAttribute('aria-hidden') === 'true') {
      return false
    }

    if (element instanceof HTMLInputElement && element.type === 'hidden') {
      return false
    }

    return isFocusableElementVisible(element)
  })
}

function parseBudgetNumberInput(value: string): number | null {
  const normalized = value.trim()
  if (normalized === '') {
    return 0
  }

  const parsed = Number.parseInt(normalized, 10)
  if (Number.isNaN(parsed)) {
    return null
  }

  return Math.max(0, parsed)
}

function isBudgetSeriesInput(value: unknown): value is ThinkingCapabilityBudgetSeriesInput {
  return typeof value === 'object'
    && value !== null
    && 'kind' in value
    && (value as { kind?: string }).kind === 'budget'
}

export function ProviderModelEditorDialog({
  modelEditorState,
  modelEditorError,
  onClose,
  onSave,
  onStateChange,
  onToggleCapability,
  onClearError,
}: ProviderModelEditorDialogProps) {
  const dialogRef = useRef<HTMLElement | null>(null)
  const initialFocusRef = useRef<HTMLInputElement | null>(null)
  const previouslyFocusedElementRef = useRef<HTMLElement | null>(null)
  const modelEditorOpen = modelEditorState !== null
  const modelEditorAdvancedSectionId = 'settings-model-editor-advanced-panel'

  useEffect(() => {
    if (!modelEditorOpen) {
      const previousFocusedElement = previouslyFocusedElementRef.current
      previouslyFocusedElementRef.current = null

      if (previousFocusedElement?.isConnected) {
        previousFocusedElement.focus()
      }

      return
    }

    previouslyFocusedElementRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null

    const focusTimer = window.requestAnimationFrame(() => {
      const dialog = dialogRef.current

      if (!dialog) {
        return
      }

      const activeElement = document.activeElement instanceof HTMLElement ? document.activeElement : null

      if (activeElement && dialog.contains(activeElement) && activeElement !== dialog) {
        return
      }

      const focusTarget = initialFocusRef.current ?? getFocusableElements(dialog)[0] ?? dialog
      focusTarget.focus()
    })

    return () => {
      window.cancelAnimationFrame(focusTimer)
    }
  }, [modelEditorOpen])

  if (!modelEditorState) {
    return null
  }

  const thinkingDeclarationMode = getThinkingCapabilityDeclarationMode(modelEditorState.thinkingCapability)
  const normalizedThinkingCapability = modelEditorState.thinkingCapability?.supported === true
    ? initializeSupportedThinkingCapabilityDeclaration(modelEditorState.thinkingCapability)
    : null
  const thinkingDefaultLevelOptions = normalizedThinkingCapability === null
    ? []
    : buildThinkingDeclarationDefaultLevelOptions(normalizedThinkingCapability)
  const thinkingSeriesOptions = normalizedThinkingCapability === null
    ? []
    : buildThinkingDeclarationSeriesOptions(normalizedThinkingCapability.series)
  const fixedInput = normalizedThinkingCapability?.input.kind === 'fixed'
    ? normalizedThinkingCapability.input
    : null
  const binaryInput = normalizedThinkingCapability?.input.kind === 'binary'
    ? normalizedThinkingCapability.input
    : null
  const discreteInput = normalizedThinkingCapability?.input.kind === 'discrete'
    ? normalizedThinkingCapability.input
    : null
  const budgetInput = isBudgetSeriesInput(normalizedThinkingCapability?.input)
    ? normalizedThinkingCapability.input
    : null
  const budgetDefaultMode = normalizedThinkingCapability?.defaultSelection.mode === 'budget' ? 'budget' : 'off'
  const presetDefaultLevel = normalizedThinkingCapability?.defaultSelection.mode === 'preset'
    ? normalizedThinkingCapability.defaultSelection.level
    : 'off'

  const updateThinkingCapability = (nextThinkingCapability: ModelEditorState['thinkingCapability']) => {
    onClearError()
    onStateChange({ thinkingCapability: nextThinkingCapability })
  }

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      onClose()
      return
    }

    if (event.key !== 'Tab') {
      return
    }

    const dialog = dialogRef.current

    if (!dialog) {
      return
    }

    const focusableElements = getFocusableElements(dialog)

    if (focusableElements.length === 0) {
      event.preventDefault()
      dialog.focus()
      return
    }

    const activeElement = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const activeIndex = activeElement ? focusableElements.indexOf(activeElement) : -1
    const firstElement = focusableElements[0]
    const lastElement = focusableElements[focusableElements.length - 1]

    if (event.shiftKey) {
      if (activeIndex <= 0) {
        event.preventDefault()
        lastElement.focus()
      }

      return
    }

    if (activeIndex === -1 || activeIndex === focusableElements.length - 1) {
      event.preventDefault()
      firstElement.focus()
    }
  }

  return (
    <div className="model-editor-backdrop" role="presentation" onClick={onClose}>
      <section
        ref={dialogRef}
        className="model-editor-modal"
        role="dialog"
        aria-modal="true"
        aria-label={modelEditorState.isNew ? '添加模型' : '编辑模型'}
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        <div className="model-editor-modal__header">
          <div>
            <h3 className="settings-card__title">{modelEditorState.isNew ? '添加模型' : '编辑模型'}</h3>
          </div>
          <button
            type="button"
            className="model-editor-modal__close"
            aria-label="关闭模型编辑弹层"
            onClick={onClose}
          >
            ×
          </button>
        </div>

        <div className="model-editor-modal__body">
          <div className="form-grid form-grid--two">
            <TextField
              label="模型 ID"
              value={modelEditorState.modelId}
              onChange={(value) => {
                onClearError()
                onStateChange({ modelId: value })
              }}
              placeholder="例如 google/gemini-2.5-pro"
              inputRef={initialFocusRef}
            />
            <TextField
              label="模型名称"
              value={modelEditorState.displayName}
              onChange={(value) => onStateChange({ displayName: value })}
              placeholder="例如 Gemini 2.5 Pro"
            />
          </div>

          {modelEditorError ? (
            <p className="form-field__description" role="alert">
              {modelEditorError}
            </p>
          ) : null}

          <div className="model-editor-section">
            <div className="model-editor-section__header">
              <span className="form-field__label">模型类型</span>
            </div>

            <div className="model-capability-picker">
              {modelCapabilityOptions.map((option) => {
                const active = modelEditorState.capabilities.includes(option.value)
                const capabilityClassName = active ? ` model-capability-button--${option.value}` : ' model-capability-button--inactive'

                return (
                  <button
                    key={option.value}
                    type="button"
                    aria-pressed={active}
                    className={`model-capability-button${capabilityClassName}${active ? ' model-capability-button--active' : ''}`}
                    onClick={() => onToggleCapability(option.value)}
                  >
                    {option.label}
                  </button>
                )
              })}
            </div>
          </div>

          <div className="model-editor-section">
            <div className="form-grid form-grid--two">
              <SelectField
                label="思考能力"
                value={thinkingDeclarationMode}
                options={THINKING_DECLARATION_MODE_OPTIONS}
                onChange={(value) => {
                  updateThinkingCapability(
                    setThinkingCapabilityDeclarationMode(
                      modelEditorState.thinkingCapability,
                      value as 'inherit' | 'unsupported' | 'supported',
                    ),
                  )
                }}
              />
              {thinkingDeclarationMode === 'supported' && normalizedThinkingCapability !== null ? (
                <SelectField
                  label="推理系列"
                  value={normalizedThinkingCapability.series}
                  options={thinkingSeriesOptions}
                  onChange={(value) => {
                    updateThinkingCapability(
                      setThinkingCapabilityDeclarationSeries(modelEditorState.thinkingCapability, value),
                    )
                  }}
                />
              ) : <div />}
            </div>

            {thinkingDeclarationMode === 'supported' && normalizedThinkingCapability !== null ? (
              <>
                {fixedInput !== null ? (
                  <div className="form-grid form-grid--two">
                    <SelectField
                      label="固定挡位"
                      value={fixedInput.level}
                      options={positiveThinkingLevelOptions}
                      onChange={(value) => {
                        updateThinkingCapability(
                          setThinkingCapabilityDeclarationFixedLevel(
                            modelEditorState.thinkingCapability,
                            value as PositiveThinkingLevelIntent,
                          ),
                        )
                      }}
                    />
                    <SelectField
                      label="默认选择"
                      value={presetDefaultLevel}
                      options={thinkingDefaultLevelOptions}
                      onChange={(value) => {
                        updateThinkingCapability(
                          setThinkingCapabilityDeclarationDefaultLevel(
                            modelEditorState.thinkingCapability,
                            value as ThinkingLevelIntent,
                          ),
                        )
                      }}
                    />
                  </div>
                ) : null}

                {binaryInput !== null ? (
                  <div className="form-grid form-grid--two">
                    <SelectField
                      label="开启挡位"
                      value={binaryInput.enabledLevel}
                      options={binaryThinkingLevelOptions}
                      onChange={(value) => {
                        updateThinkingCapability(
                          setThinkingCapabilityDeclarationBinaryLevel(
                            modelEditorState.thinkingCapability,
                            value as Exclude<PositiveThinkingLevelIntent, 'auto'>,
                          ),
                        )
                      }}
                    />
                    <SelectField
                      label="默认选择"
                      value={presetDefaultLevel}
                      options={thinkingDefaultLevelOptions}
                      onChange={(value) => {
                        updateThinkingCapability(
                          setThinkingCapabilityDeclarationDefaultLevel(
                            modelEditorState.thinkingCapability,
                            value as ThinkingLevelIntent,
                          ),
                        )
                      }}
                    />
                  </div>
                ) : null}

                {normalizedThinkingCapability.input.kind === 'off-auto' ? (
                  <div className="form-grid form-grid--two">
                    <div className="model-editor-series-summary">
                      <span className="form-field__label">系列输入</span>
                      <p className="form-field__description">固定为关闭 / 自动。</p>
                    </div>
                    <SelectField
                      label="默认选择"
                      value={presetDefaultLevel}
                      options={thinkingDefaultLevelOptions}
                      onChange={(value) => {
                        updateThinkingCapability(
                          setThinkingCapabilityDeclarationDefaultLevel(
                            modelEditorState.thinkingCapability,
                            value as ThinkingLevelIntent,
                          ),
                        )
                      }}
                    />
                  </div>
                ) : null}

                {discreteInput !== null ? (
                  <>
                    <div className="form-grid form-grid--two">
                      <div className="model-editor-section__header">
                        <span className="form-field__label">可用挡位</span>
                      </div>
                      <SelectField
                        label="默认选择"
                        value={presetDefaultLevel}
                        options={thinkingDefaultLevelOptions}
                        onChange={(value) => {
                          updateThinkingCapability(
                            setThinkingCapabilityDeclarationDefaultLevel(
                              modelEditorState.thinkingCapability,
                              value as ThinkingLevelIntent,
                            ),
                          )
                        }}
                      />
                    </div>
                    <div className="model-capability-picker">
                      {positiveThinkingLevelOptions.map((option) => {
                        const active = discreteInput.levels.includes(option.value as PositiveThinkingLevelIntent)
                        const capabilityClassName = active ? ' model-capability-button--reasoning' : ' model-capability-button--inactive'

                        return (
                          <button
                            key={option.value}
                            type="button"
                            aria-pressed={active}
                            className={`model-capability-button${capabilityClassName}${active ? ' model-capability-button--active' : ''}`}
                            onClick={() => {
                              updateThinkingCapability(
                                toggleThinkingCapabilityDeclarationLevel(
                                  modelEditorState.thinkingCapability,
                                  option.value as PositiveThinkingLevelIntent,
                                ),
                              )
                            }}
                          >
                            {option.label}
                          </button>
                        )
                      })}
                    </div>
                  </>
                ) : null}

                {budgetInput !== null ? (
                  <>
                    <div className="form-grid form-grid--budget">
                      <TextField
                        label="最小预算"
                        value={String(budgetInput.minTokens)}
                        onChange={(value) => {
                          const parsed = parseBudgetNumberInput(value)
                          if (parsed === null) {
                            return
                          }
                          updateThinkingCapability(
                            setThinkingCapabilityDeclarationBudgetConfig(
                              modelEditorState.thinkingCapability,
                              { minTokens: parsed },
                            ),
                          )
                        }}
                        placeholder="0"
                      />
                      <TextField
                        label="最大预算"
                        value={String(budgetInput.maxTokens)}
                        onChange={(value) => {
                          const parsed = parseBudgetNumberInput(value)
                          if (parsed === null) {
                            return
                          }
                          updateThinkingCapability(
                            setThinkingCapabilityDeclarationBudgetConfig(
                              modelEditorState.thinkingCapability,
                              { maxTokens: parsed },
                            ),
                          )
                        }}
                        placeholder="32768"
                      />
                      <TextField
                        label="步进"
                        value={String(budgetInput.stepTokens)}
                        onChange={(value) => {
                          const parsed = parseBudgetNumberInput(value)
                          if (parsed === null) {
                            return
                          }
                          updateThinkingCapability(
                            setThinkingCapabilityDeclarationBudgetConfig(
                              modelEditorState.thinkingCapability,
                              { stepTokens: parsed },
                            ),
                          )
                        }}
                        placeholder="1024"
                      />
                    </div>
                    <div className="form-grid form-grid--two">
                      <SelectField
                        label="默认选择"
                        value={budgetDefaultMode}
                        options={THINKING_BUDGET_DEFAULT_MODE_OPTIONS}
                        onChange={(value) => {
                          updateThinkingCapability(
                            setThinkingCapabilityDeclarationBudgetDefaultMode(
                              modelEditorState.thinkingCapability,
                              value as 'off' | 'budget',
                            ),
                          )
                        }}
                      />
                      {budgetDefaultMode === 'budget' ? (
                        <TextField
                          label="默认预算"
                          value={String(
                            normalizedThinkingCapability.defaultSelection.mode === 'budget'
                              ? normalizedThinkingCapability.defaultSelection.budgetTokens
                              : budgetInput.minTokens,
                          )}
                          onChange={(value) => {
                            const parsed = parseBudgetNumberInput(value)
                            if (parsed === null) {
                              return
                            }
                            updateThinkingCapability(
                              setThinkingCapabilityDeclarationBudgetTokens(
                                modelEditorState.thinkingCapability,
                                parsed,
                              ),
                            )
                          }}
                          placeholder="8192"
                        />
                      ) : <div />}
                    </div>
                  </>
                ) : null}
              </>
            ) : null}
          </div>

          <div className="model-editor-advanced">
            <button
              type="button"
              className="ghost-button model-editor-advanced__toggle"
              aria-expanded={modelEditorState.advancedOpen}
              aria-controls={modelEditorAdvancedSectionId}
              onClick={() => onStateChange({ advancedOpen: !modelEditorState.advancedOpen })}
            >
              {modelEditorState.advancedOpen ? '收起更多设置' : '更多设置'}
            </button>

            <div id={modelEditorAdvancedSectionId}>
              {modelEditorState.advancedOpen ? (
                <div className="model-editor-section">
                  <div className="form-grid form-grid--pricing">
                    <SelectField
                      label="币种"
                      value={modelEditorState.currency}
                      options={currencyOptions}
                      onChange={(value) => onStateChange({ currency: value })}
                    />
                    <TextField
                      label="输入价格"
                      value={modelEditorState.inputPrice}
                      onChange={(value) => onStateChange({ inputPrice: value })}
                      placeholder="0.50"
                    />
                    <TextField
                      label="输出价格"
                      value={modelEditorState.outputPrice}
                      onChange={(value) => onStateChange({ outputPrice: value })}
                      placeholder="3.00"
                    />
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        </div>

        <div className="model-editor-modal__footer">
          <button type="button" className="secondary-button" onClick={onClose}>
            取消
          </button>
          <button
            type="button"
            className="primary-button"
            onClick={onSave}
            disabled={!modelEditorState.modelId.trim()}
          >
            保存
          </button>
        </div>
      </section>
    </div>
  )
}

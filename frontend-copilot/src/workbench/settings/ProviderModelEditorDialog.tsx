import { useEffect, useRef, type KeyboardEvent as ReactKeyboardEvent } from 'react'

import {
  getModelCapabilityOptions,
  getProviderModelEditorCopy,
  normalizeWorkbenchLanguage,
} from '../locale'
import {
  ThinkingBudgetSlider,
  ThinkingPillGroup,
  type ThinkingPillOption,
} from '../../components/ThinkingControls'
import { SelectField, TextField } from '../components/FormFields'
import {
  THINKING_BUDGET_DEFAULT_MAX_TOKENS,
  THINKING_BUDGET_DEFAULT_MIN_TOKENS,
  THINKING_BUDGET_DEFAULT_SELECTION_TOKENS,
  THINKING_BUDGET_DEFAULT_STEP_TOKENS,
} from '../thinking-display'
import type {
  ModelCapability,
  ProviderProfile,
  ThinkingSeriesBudgetValue,
  ThinkingSeriesCodeValue,
  ThinkingSeriesValue,
} from '../types'
import {
  buildThinkingDeclarationSeriesOptions,
  getThinkingCapabilityDeclarationMode,
  initializeSupportedThinkingCapabilityDeclaration,
  setThinkingCapabilityDeclarationBudgetConfig,
  setThinkingCapabilityDeclarationBudgetDefaultMode,
  setThinkingCapabilityDeclarationBudgetTokens,
  setThinkingCapabilityDeclarationDefaultCodeValue,
  setThinkingCapabilityDeclarationMode,
  setThinkingCapabilityDeclarationSeries,
} from '../thinking-capabilities'
import type { ModelEditorState } from './provider-profiles'
import { resolveThinkingCompatibilityWarning } from './thinking-compatibility-warning'

interface ProviderModelEditorDialogProps {
  language?: string
  modelEditorState: ModelEditorState | null
  providerProfile?: ProviderProfile | null
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

function isCodeThinkingValue(value: ThinkingSeriesValue | null | undefined): value is ThinkingSeriesCodeValue {
  return value?.valueType === 'code'
}

function isBudgetThinkingValue(value: ThinkingSeriesValue | null | undefined): value is ThinkingSeriesBudgetValue {
  return value?.valueType === 'budget'
}

function normalizeBudgetDeclaration(declaration: ModelEditorState['thinkingCapability']) {
  return setThinkingCapabilityDeclarationBudgetConfig(declaration, {
    minTokens: THINKING_BUDGET_DEFAULT_MIN_TOKENS,
    maxTokens: THINKING_BUDGET_DEFAULT_MAX_TOKENS,
    stepTokens: THINKING_BUDGET_DEFAULT_STEP_TOKENS,
  })
}

export function ProviderModelEditorDialog({
  language = 'zh-CN',
  modelEditorState,
  providerProfile = null,
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

  const locale = normalizeWorkbenchLanguage(language)
  const copy = getProviderModelEditorCopy(language)
  const modelCapabilityOptions = getModelCapabilityOptions(language)
  const thinkingDeclarationModeOptions = locale === 'en-US'
    ? [
        { value: 'inherit', label: 'Follow Built-in Rules' },
        { value: 'unsupported', label: 'Explicitly Unsupported' },
        { value: 'supported', label: 'Explicitly Supported' },
      ]
    : [
        { value: 'inherit', label: '跟随内置规则' },
        { value: 'unsupported', label: '显式不支持' },
        { value: 'supported', label: '显式支持' },
      ]
  const currencyOptions = locale === 'en-US'
    ? [
        { value: 'usd', label: 'USD' },
        { value: 'cny', label: 'CNY' },
      ]
    : [
        { value: 'usd', label: '美元（USD）' },
        { value: 'cny', label: '人民币（CNY）' },
      ]
  const thinkingDeclarationMode = getThinkingCapabilityDeclarationMode(modelEditorState.thinkingCapability)
  const normalizedThinkingCapability = modelEditorState.thinkingCapability?.supported === true
    ? initializeSupportedThinkingCapabilityDeclaration(modelEditorState.thinkingCapability)
    : null
  const thinkingSeriesOptions = normalizedThinkingCapability === null
    ? []
    : buildThinkingDeclarationSeriesOptions(normalizedThinkingCapability.series)
  const selectedSeriesOption = normalizedThinkingCapability === null
    ? null
    : thinkingSeriesOptions.find((option) => option.value === normalizedThinkingCapability.series) ?? null
  const presetSeriesCapability = normalizedThinkingCapability === null
    ? null
    : initializeSupportedThinkingCapabilityDeclaration(
      setThinkingCapabilityDeclarationSeries(undefined, normalizedThinkingCapability.series),
    )
  const currentThinkingValue = normalizedThinkingCapability?.template.defaultValue ?? null
  const currentAllowedCodeValues = (normalizedThinkingCapability?.template.allowedValues ?? []).filter(isCodeThinkingValue)
  const presetBudgetValues = (presetSeriesCapability?.template.allowedValues ?? []).filter(isBudgetThinkingValue)
  const supportsBudgetDefaultModes = presetSeriesCapability?.template.editorType === 'budget'
  const budgetDefaultValue = isBudgetThinkingValue(currentThinkingValue) ? currentThinkingValue : null
  const budgetDefaultMode = budgetDefaultValue?.mode ?? 'off'
  const budgetDefaultTokens = budgetDefaultValue?.mode === 'budget' && typeof budgetDefaultValue.budgetTokens === 'number'
    ? budgetDefaultValue.budgetTokens
    : THINKING_BUDGET_DEFAULT_SELECTION_TOKENS
  const thinkingCompatibilityWarning = resolveThinkingCompatibilityWarning({
    providerProfile,
    thinkingCapability: modelEditorState.thinkingCapability,
  })

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

  const currentValueOptions: ThinkingPillOption[] = currentAllowedCodeValues.map((value) => ({
    key: `default-${value.code}`,
    labelZh: value.labelZh,
    code: value.code,
    selected: currentThinkingValue?.valueType === 'code' && currentThinkingValue.code === value.code,
    testId: `settings-thinking-default-${value.code}`,
    onSelect: () => {
      updateThinkingCapability(
        setThinkingCapabilityDeclarationDefaultCodeValue(modelEditorState.thinkingCapability, value.code),
      )
    },
  }))

  const budgetModeOptions: ThinkingPillOption[] = !supportsBudgetDefaultModes
    ? []
    : [
        ...(presetBudgetValues.some((value) => value.mode === 'off')
          ? [{
              key: 'budget-off',
              labelZh: copy.budgetModes.off,
              code: 'off',
              selected: budgetDefaultMode === 'off',
              testId: 'settings-thinking-budget-mode-off',
              onSelect: () => {
                updateThinkingCapability(
                  setThinkingCapabilityDeclarationBudgetDefaultMode(
                    normalizeBudgetDeclaration(modelEditorState.thinkingCapability),
                    'off',
                  ),
                )
              },
            } satisfies ThinkingPillOption]
          : []),
        ...(presetBudgetValues.some((value) => value.mode === 'dynamic')
          ? [{
              key: 'budget-dynamic',
              labelZh: copy.budgetModes.dynamic,
              code: 'dynamic',
              selected: budgetDefaultMode === 'dynamic',
              testId: 'settings-thinking-budget-mode-dynamic',
              onSelect: () => {
                updateThinkingCapability(
                  setThinkingCapabilityDeclarationBudgetDefaultMode(
                    normalizeBudgetDeclaration(modelEditorState.thinkingCapability),
                    'dynamic',
                  ),
                )
              },
            } satisfies ThinkingPillOption]
          : []),
        {
          key: 'budget-budget',
          labelZh: copy.budgetModes.budget,
          code: 'budget_tokens',
          selected: budgetDefaultMode === 'budget',
          testId: 'settings-thinking-budget-mode-budget',
          onSelect: () => {
            updateThinkingCapability(
              setThinkingCapabilityDeclarationBudgetTokens(
                normalizeBudgetDeclaration(modelEditorState.thinkingCapability),
                budgetDefaultTokens,
              ),
            )
          },
        },
      ]

  return (
    <div className="model-editor-backdrop" role="presentation" onClick={onClose}>
      <section
        ref={dialogRef}
        className="model-editor-modal"
        role="dialog"
        aria-modal="true"
        aria-label={modelEditorState.isNew ? copy.addTitle : copy.editTitle}
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        <div className="model-editor-modal__header">
          <div>
            <h3 className="settings-card__title">{modelEditorState.isNew ? copy.addTitle : copy.editTitle}</h3>
          </div>
          <button
            type="button"
            className="model-editor-modal__close"
            aria-label={copy.closeAriaLabel}
            onClick={onClose}
          >
            ×
          </button>
        </div>

        <div className="model-editor-modal__body">
          <div className="form-grid form-grid--two">
            <TextField
              label={copy.modelIdLabel}
              value={modelEditorState.modelId}
              onChange={(value) => {
                onClearError()
                onStateChange({ modelId: value })
              }}
              placeholder={copy.modelIdPlaceholder}
              inputRef={initialFocusRef}
            />
            <TextField
              label={copy.modelNameLabel}
              value={modelEditorState.displayName}
              onChange={(value) => onStateChange({ displayName: value })}
              placeholder={copy.modelNamePlaceholder}
            />
          </div>

          {modelEditorError ? (
            <p className="form-field__description" role="alert">
              {modelEditorError}
            </p>
          ) : null}

          <div className="model-editor-section">
            <div className="model-editor-section__header">
              <span className="form-field__label">{copy.modelTypeLabel}</span>
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
                label={copy.thinkingCapabilityLabel}
                value={thinkingDeclarationMode}
                options={thinkingDeclarationModeOptions}
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
                  label={copy.thinkingSeriesLabel}
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
              <div className="model-editor-thinking-panel" data-testid="settings-thinking-panel">
                <div className="model-editor-thinking-panel__summary">
                  <div className="model-editor-thinking-panel__summary-copy">
                    <span className="model-editor-thinking-panel__series-title">
                      {selectedSeriesOption?.label ?? normalizedThinkingCapability.series}
                    </span>
                    {selectedSeriesOption?.hint ? (
                      <p className="model-editor-thinking-panel__hint" data-testid="settings-thinking-series-hint">
                        {selectedSeriesOption.hint}
                      </p>
                    ) : null}
                  </div>
                </div>

                {currentAllowedCodeValues.length > 0 ? (
                  <div className="model-editor-thinking-panel__section">
                    <span className="form-field__label">{copy.defaultValueLabel}</span>
                    <ThinkingPillGroup
                      ariaLabel={copy.defaultValueAriaLabel}
                      options={currentValueOptions}
                      className="model-editor-thinking-panel__pill-group"
                    />
                  </div>
                ) : null}

                {budgetModeOptions.length > 0 ? (
                  <div className="model-editor-thinking-panel__section">
                    <span className="form-field__label">{copy.defaultModeLabel}</span>
                    <ThinkingPillGroup
                      ariaLabel={copy.defaultModeAriaLabel}
                      options={budgetModeOptions}
                      className="model-editor-thinking-panel__pill-group"
                    />
                  </div>
                ) : null}

                {supportsBudgetDefaultModes && budgetDefaultMode === 'budget' ? (
                  <div className="model-editor-thinking-panel__section">
                    <span className="form-field__label">{copy.budgetLabel}</span>
                    <ThinkingBudgetSlider
                      label={copy.budgetInputLabel}
                      ariaLabel={copy.budgetInputAriaLabel}
                      budgetTokens={budgetDefaultTokens}
                      inputTestId="settings-thinking-budget-input"
                      valueTestId="settings-thinking-budget-value"
                      className="model-editor-thinking-panel__budget"
                      onBudgetTokensChange={(budgetTokens) => {
                        updateThinkingCapability(
                          setThinkingCapabilityDeclarationBudgetTokens(
                            normalizeBudgetDeclaration(modelEditorState.thinkingCapability),
                            budgetTokens,
                          ),
                        )
                      }}
                    />
                  </div>
                ) : null}

                {thinkingCompatibilityWarning.shouldWarn ? (
                  <p
                    className="model-editor-thinking-panel__warning"
                    data-testid="settings-thinking-compatibility-warning"
                  >
                    {thinkingCompatibilityWarning.message}
                  </p>
                ) : null}
              </div>
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
              {modelEditorState.advancedOpen ? copy.hideAdvanced : copy.showAdvanced}
            </button>

            <div id={modelEditorAdvancedSectionId}>
              {modelEditorState.advancedOpen ? (
                <div className="model-editor-section">
                  <div className="form-grid form-grid--pricing">
                    <SelectField
                      label={copy.currencyLabel}
                      value={modelEditorState.currency}
                      options={currencyOptions}
                      onChange={(value) => onStateChange({ currency: value })}
                    />
                    <TextField
                      label={copy.inputPriceLabel}
                      value={modelEditorState.inputPrice}
                      onChange={(value) => onStateChange({ inputPrice: value })}
                      placeholder="0.50"
                    />
                    <TextField
                      label={copy.outputPriceLabel}
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
            {copy.cancelButton}
          </button>
          <button
            type="button"
            className="primary-button"
            onClick={onSave}
            disabled={!modelEditorState.modelId.trim()}
          >
            {copy.saveButton}
          </button>
        </div>
      </section>
    </div>
  )
}

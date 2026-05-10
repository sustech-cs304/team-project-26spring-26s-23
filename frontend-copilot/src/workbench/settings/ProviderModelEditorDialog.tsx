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

function createThinkingDeclarationModeOptions(locale: ReturnType<typeof normalizeWorkbenchLanguage>) {
  return locale === 'en-US'
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
}

function createCurrencyOptions(locale: ReturnType<typeof normalizeWorkbenchLanguage>) {
  return locale === 'en-US'
    ? [
        { value: 'usd', label: 'USD' },
        { value: 'cny', label: 'CNY' },
      ]
    : [
        { value: 'usd', label: '美元（USD）' },
        { value: 'cny', label: '人民币（CNY）' },
      ]
}

function buildBudgetModeOptions(params: {
  copy: ReturnType<typeof getProviderModelEditorCopy>
  budgetDefaultMode: string
  budgetDefaultTokens: number
  supportsBudgetDefaultModes: boolean
  presetBudgetValues: ThinkingSeriesBudgetValue[]
  modelEditorThinkingCapability: ModelEditorState['thinkingCapability']
  updateThinkingCapability: (next: ModelEditorState['thinkingCapability']) => void
}): ThinkingPillOption[] {
  const { copy, budgetDefaultMode, budgetDefaultTokens, supportsBudgetDefaultModes, presetBudgetValues, modelEditorThinkingCapability, updateThinkingCapability } = params
  if (!supportsBudgetDefaultModes) return []
  const offOpt = presetBudgetValues.some((v) => v.mode === 'off')
    ? [{
        key: 'budget-off', labelZh: copy.budgetModes.off, code: 'off', selected: budgetDefaultMode === 'off',
        testId: 'settings-thinking-budget-mode-off',
        onSelect: () => updateThinkingCapability(setThinkingCapabilityDeclarationBudgetDefaultMode(normalizeBudgetDeclaration(modelEditorThinkingCapability), 'off')),
      } satisfies ThinkingPillOption]
    : []
  const dynOpt = presetBudgetValues.some((v) => v.mode === 'dynamic')
    ? [{
        key: 'budget-dynamic', labelZh: copy.budgetModes.dynamic, code: 'dynamic', selected: budgetDefaultMode === 'dynamic',
        testId: 'settings-thinking-budget-mode-dynamic',
        onSelect: () => updateThinkingCapability(setThinkingCapabilityDeclarationBudgetDefaultMode(normalizeBudgetDeclaration(modelEditorThinkingCapability), 'dynamic')),
      } satisfies ThinkingPillOption]
    : []
  return [...offOpt, ...dynOpt, {
    key: 'budget-budget', labelZh: copy.budgetModes.budget, code: 'budget_tokens', selected: budgetDefaultMode === 'budget',
    testId: 'settings-thinking-budget-mode-budget',
    onSelect: () => updateThinkingCapability(setThinkingCapabilityDeclarationBudgetTokens(normalizeBudgetDeclaration(modelEditorThinkingCapability), budgetDefaultTokens)),
  }]
}

function useDialogFocus(
  modelEditorOpen: boolean,
  dialogRef: React.RefObject<HTMLElement | null>,
  initialFocusRef: React.RefObject<HTMLInputElement | null>,
) {
  const previouslyFocusedElementRef = useRef<HTMLElement | null>(null)
  useEffect(() => {
    if (!modelEditorOpen) {
      const prev = previouslyFocusedElementRef.current
      previouslyFocusedElementRef.current = null
      if (prev?.isConnected) prev.focus()
      return
    }
    previouslyFocusedElementRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const timer = window.requestAnimationFrame(() => {
      const dialog = dialogRef.current
      if (!dialog) return
      const activeEl = document.activeElement instanceof HTMLElement ? document.activeElement : null
      if (activeEl && dialog.contains(activeEl) && activeEl !== dialog) return
      const target = initialFocusRef.current ?? getFocusableElements(dialog)[0] ?? dialog
      target.focus()
    })
    return () => window.cancelAnimationFrame(timer)
  }, [modelEditorOpen, dialogRef, initialFocusRef])
}

function useDialogKeyboardTrap(
  dialogRef: React.RefObject<HTMLElement | null>,
  onClose: () => void,
) {
  return (event: ReactKeyboardEvent<HTMLElement>) => {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose(); return }
    if (event.key !== 'Tab') return
    const dialog = dialogRef.current
    if (!dialog) return
    const elements = getFocusableElements(dialog)
    if (elements.length === 0) { event.preventDefault(); dialog.focus(); return }
    const activeEl = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const activeIdx = activeEl ? elements.indexOf(activeEl) : -1
    if (event.shiftKey) { if (activeIdx <= 0) { event.preventDefault(); elements[elements.length - 1]!.focus() } return }
    if (activeIdx === -1 || activeIdx === elements.length - 1) { event.preventDefault(); elements[0]!.focus() }
  }
}

interface ThinkingModelEditorComputed {
  thinkingDeclarationMode: string
  normalizedThinkingCapability: ReturnType<typeof initializeSupportedThinkingCapabilityDeclaration> | null
  thinkingSeriesOptions: ReturnType<typeof buildThinkingDeclarationSeriesOptions>
  selectedSeriesOption: ReturnType<typeof buildThinkingDeclarationSeriesOptions>[number] | null
  presetBudgetValues: ThinkingSeriesBudgetValue[]
  supportsBudgetDefaultModes: boolean
  budgetDefaultMode: string
  budgetDefaultTokens: number
  currentThinkingValue: ThinkingSeriesValue | null
  currentAllowedCodeValues: ThinkingSeriesCodeValue[]
  thinkingCompatibilityWarning: ReturnType<typeof resolveThinkingCompatibilityWarning>
}

function computeModelEditorThinkingState(
  modelEditorState: ModelEditorState,
  providerProfile: ProviderProfile | null | undefined,
): ThinkingModelEditorComputed {
  const thinkingDeclarationMode = getThinkingCapabilityDeclarationMode(modelEditorState.thinkingCapability)
  const normalizedThinkingCapability = modelEditorState.thinkingCapability?.supported === true
    ? initializeSupportedThinkingCapabilityDeclaration(modelEditorState.thinkingCapability) : null
  const thinkingSeriesOptions = normalizedThinkingCapability === null ? [] : buildThinkingDeclarationSeriesOptions(normalizedThinkingCapability.series)
  const selectedSeriesOption = normalizedThinkingCapability === null ? null
    : thinkingSeriesOptions.find((o) => o.value === normalizedThinkingCapability.series) ?? null
  const presetSeriesCapability = normalizedThinkingCapability === null ? null
    : initializeSupportedThinkingCapabilityDeclaration(setThinkingCapabilityDeclarationSeries(undefined, normalizedThinkingCapability.series))
  const currentThinkingValue = normalizedThinkingCapability?.template.defaultValue ?? null
  const currentAllowedCodeValues = (normalizedThinkingCapability?.template.allowedValues ?? []).filter(isCodeThinkingValue)
  const presetBudgetValues = (presetSeriesCapability?.template.allowedValues ?? []).filter(isBudgetThinkingValue)
  const supportsBudgetDefaultModes = presetSeriesCapability?.template.editorType === 'budget'
  const budgetDefaultValue = isBudgetThinkingValue(currentThinkingValue) ? currentThinkingValue : null
  const budgetDefaultMode = budgetDefaultValue?.mode ?? 'off'
  const budgetDefaultTokens = budgetDefaultValue?.mode === 'budget' && typeof budgetDefaultValue.budgetTokens === 'number'
    ? budgetDefaultValue.budgetTokens : THINKING_BUDGET_DEFAULT_SELECTION_TOKENS
  const thinkingCompatibilityWarning = resolveThinkingCompatibilityWarning({
    providerProfile: providerProfile ?? null, thinkingCapability: modelEditorState.thinkingCapability,
  })
  return { thinkingDeclarationMode, normalizedThinkingCapability, thinkingSeriesOptions, selectedSeriesOption,
    presetBudgetValues, supportsBudgetDefaultModes, budgetDefaultMode, budgetDefaultTokens,
    currentThinkingValue, currentAllowedCodeValues, thinkingCompatibilityWarning }
}

export function ProviderModelEditorDialog(props: ProviderModelEditorDialogProps) {
  const { language = 'zh-CN', modelEditorState, providerProfile = null, modelEditorError,
    onClose, onSave, onStateChange, onToggleCapability, onClearError } = props
  const dialogRef = useRef<HTMLElement | null>(null)
  const initialFocusRef = useRef<HTMLInputElement | null>(null)
  const modelEditorOpen = modelEditorState !== null
  useDialogFocus(modelEditorOpen, dialogRef, initialFocusRef)
  const handleKeyDown = useDialogKeyboardTrap(dialogRef, onClose)
  if (!modelEditorState) return null
  const locale = normalizeWorkbenchLanguage(language)
  const copy = getProviderModelEditorCopy(language)
  const computed = computeModelEditorThinkingState(modelEditorState, providerProfile)
  const updateThinkingCapability = (next: ModelEditorState['thinkingCapability']) => {
    onClearError(); onStateChange({ thinkingCapability: next })
  }
  const currentValueOptions: ThinkingPillOption[] = computed.currentAllowedCodeValues.map((value) => ({
    key: `default-${value.code}`, labelZh: value.labelZh, code: value.code,
    selected: computed.currentThinkingValue?.valueType === 'code' && computed.currentThinkingValue.code === value.code,
    testId: `settings-thinking-default-${value.code}`,
    onSelect: () => updateThinkingCapability(setThinkingCapabilityDeclarationDefaultCodeValue(modelEditorState.thinkingCapability, value.code)),
  }))
  const budgetModeOptions = buildBudgetModeOptions({
    copy, budgetDefaultMode: computed.budgetDefaultMode, budgetDefaultTokens: computed.budgetDefaultTokens,
    supportsBudgetDefaultModes: computed.supportsBudgetDefaultModes, presetBudgetValues: computed.presetBudgetValues,
    modelEditorThinkingCapability: modelEditorState.thinkingCapability, updateThinkingCapability,
  })
  return <ModelEditorDialogContent
    dialogRef={dialogRef} initialFocusRef={initialFocusRef} modelEditorState={modelEditorState}
    modelEditorError={modelEditorError} copy={copy}
    computed={computed} currentValueOptions={currentValueOptions} budgetModeOptions={budgetModeOptions}
    locale={locale} updateThinkingCapability={updateThinkingCapability}
    onClose={onClose} onSave={onSave} onStateChange={onStateChange}
    onToggleCapability={onToggleCapability} handleKeyDown={handleKeyDown}
  />
}

interface ModelEditorDialogContentProps {
  dialogRef: React.RefObject<HTMLElement | null>
  initialFocusRef: React.RefObject<HTMLInputElement | null>
  modelEditorState: ModelEditorState
  modelEditorError: string | null
  copy: ReturnType<typeof getProviderModelEditorCopy>
  computed: ThinkingModelEditorComputed
  currentValueOptions: ThinkingPillOption[]
  budgetModeOptions: ThinkingPillOption[]
  locale: ReturnType<typeof normalizeWorkbenchLanguage>
  updateThinkingCapability: (next: ModelEditorState['thinkingCapability']) => void
  onClose: () => void
  onSave: () => void
  onStateChange: (patch: Partial<ModelEditorState>) => void
  onToggleCapability: (capability: ModelCapability) => void
  handleKeyDown: (event: ReactKeyboardEvent<HTMLElement>) => void
}

function ModelEditorDialogContent({
  dialogRef, initialFocusRef, modelEditorState, modelEditorError, copy, computed,
  currentValueOptions, budgetModeOptions, locale, updateThinkingCapability,
  onClose, onSave, onStateChange, onToggleCapability, handleKeyDown,
}: ModelEditorDialogContentProps) {
  const modelCapabilityOptions = getModelCapabilityOptions('zh-CN') // language derived from locale
  const thinkingDeclarationModeOptions = createThinkingDeclarationModeOptions(locale)
  const currencyOptions = createCurrencyOptions(locale)
  const advancedSectionId = 'settings-model-editor-advanced-panel'

  return (
    <div className="model-editor-backdrop" role="presentation" onClick={onClose}>
      <section ref={dialogRef} className="model-editor-modal" role="dialog" aria-modal="true"
        aria-label={modelEditorState.isNew ? copy.addTitle : copy.editTitle}
        tabIndex={-1} onClick={(e) => e.stopPropagation()} onKeyDown={handleKeyDown}>
        <div className="model-editor-modal__header">
          <div><h3 className="settings-card__title">{modelEditorState.isNew ? copy.addTitle : copy.editTitle}</h3></div>
          <button type="button" className="model-editor-modal__close" aria-label={copy.closeAriaLabel} onClick={onClose}>×</button>
        </div>
        <div className="model-editor-modal__body">
          <div className="form-grid form-grid--two">
            <TextField label={copy.modelIdLabel} value={modelEditorState.modelId}
              onChange={(value) => { onStateChange({ modelId: value }) }} placeholder={copy.modelIdPlaceholder} inputRef={initialFocusRef} />
            <TextField label={copy.modelNameLabel} value={modelEditorState.displayName}
              onChange={(value) => onStateChange({ displayName: value })} placeholder={copy.modelNamePlaceholder} />
          </div>
          {modelEditorError ? <p className="form-field__description" role="alert">{modelEditorError}</p> : null}
          <div className="model-editor-section">
            <div className="model-editor-section__header"><span className="form-field__label">{copy.modelTypeLabel}</span></div>
            <div className="model-capability-picker">
              {modelCapabilityOptions.map((option) => {
                const active = modelEditorState.capabilities.includes(option.value)
                const capClass = active ? ` model-capability-button--${option.value}` : ' model-capability-button--inactive'
                return <button key={option.value} type="button" aria-pressed={active}
                  className={`model-capability-button${capClass}${active ? ' model-capability-button--active' : ''}`}
                  onClick={() => onToggleCapability(option.value)}>{option.label}</button>
              })}
            </div>
          </div>
          <div className="model-editor-section">
            <div className="form-grid form-grid--two">
              <SelectField label={copy.thinkingCapabilityLabel} value={computed.thinkingDeclarationMode}
                options={thinkingDeclarationModeOptions}
                onChange={(value) => updateThinkingCapability(setThinkingCapabilityDeclarationMode(modelEditorState.thinkingCapability, value as 'inherit' | 'unsupported' | 'supported'))} />
              {computed.thinkingDeclarationMode === 'supported' && computed.normalizedThinkingCapability !== null
                ? <SelectField label={copy.thinkingSeriesLabel} value={computed.normalizedThinkingCapability.series}
                    options={computed.thinkingSeriesOptions}
                    onChange={(value) => updateThinkingCapability(setThinkingCapabilityDeclarationSeries(modelEditorState.thinkingCapability, value))} />
                : <div />}
            </div>
            <ThinkingEditorPanel thinkingDeclarationMode={computed.thinkingDeclarationMode}
              normalizedThinkingCapability={computed.normalizedThinkingCapability}
              selectedSeriesOption={computed.selectedSeriesOption}
              currentAllowedCodeValues={computed.currentAllowedCodeValues}
              budgetModeOptions={budgetModeOptions}
              supportsBudgetDefaultModes={computed.supportsBudgetDefaultModes}
              budgetDefaultMode={computed.budgetDefaultMode} budgetDefaultTokens={computed.budgetDefaultTokens}
              thinkingCompatibilityWarning={computed.thinkingCompatibilityWarning} copy={copy}
              modelEditorThinkingCapability={modelEditorState.thinkingCapability}
              updateThinkingCapability={updateThinkingCapability} currentValueOptions={currentValueOptions} />
          </div>
          <div className="model-editor-advanced">
            <button type="button" className="ghost-button model-editor-advanced__toggle"
              aria-expanded={modelEditorState.advancedOpen} aria-controls={advancedSectionId}
              onClick={() => onStateChange({ advancedOpen: !modelEditorState.advancedOpen })}>
              {modelEditorState.advancedOpen ? copy.hideAdvanced : copy.showAdvanced}
            </button>
            <div id={advancedSectionId}>
              {modelEditorState.advancedOpen ? (
                <div className="model-editor-section"><div className="form-grid form-grid--pricing">
                  <SelectField label={copy.currencyLabel} value={modelEditorState.currency} options={currencyOptions}
                    onChange={(value) => onStateChange({ currency: value })} />
                  <TextField label={copy.inputPriceLabel} value={modelEditorState.inputPrice}
                    onChange={(value) => onStateChange({ inputPrice: value })} placeholder="0.50" />
                  <TextField label={copy.outputPriceLabel} value={modelEditorState.outputPrice}
                    onChange={(value) => onStateChange({ outputPrice: value })} placeholder="3.00" />
                </div></div>
              ) : null}
            </div>
          </div>
        </div>
        <div className="model-editor-modal__footer">
          <button type="button" className="secondary-button" onClick={onClose}>{copy.cancelButton}</button>
          <button type="button" className="primary-button" onClick={onSave} disabled={!modelEditorState.modelId.trim()}>{copy.saveButton}</button>
        </div>
      </section>
    </div>
  )
}

interface ThinkingEditorPanelProps {
  thinkingDeclarationMode: string
  normalizedThinkingCapability: ReturnType<typeof initializeSupportedThinkingCapabilityDeclaration> | null
  selectedSeriesOption: ReturnType<typeof buildThinkingDeclarationSeriesOptions>[number] | null
  currentAllowedCodeValues: ThinkingSeriesCodeValue[]
  budgetModeOptions: ThinkingPillOption[]
  supportsBudgetDefaultModes: boolean
  budgetDefaultMode: string
  budgetDefaultTokens: number
  thinkingCompatibilityWarning: ReturnType<typeof resolveThinkingCompatibilityWarning>
  copy: ReturnType<typeof getProviderModelEditorCopy>
  modelEditorThinkingCapability: ModelEditorState['thinkingCapability']
  updateThinkingCapability: (next: ModelEditorState['thinkingCapability']) => void
  currentValueOptions: ThinkingPillOption[]
}

function ThinkingEditorPanel({
  thinkingDeclarationMode, normalizedThinkingCapability, selectedSeriesOption,
  currentAllowedCodeValues, budgetModeOptions, supportsBudgetDefaultModes,
  budgetDefaultMode, budgetDefaultTokens, thinkingCompatibilityWarning,
  copy, modelEditorThinkingCapability, updateThinkingCapability, currentValueOptions,
}: ThinkingEditorPanelProps) {
  if (thinkingDeclarationMode !== 'supported' || normalizedThinkingCapability === null) return null
  return (
    <div className="model-editor-thinking-panel" data-testid="settings-thinking-panel">
      <div className="model-editor-thinking-panel__summary">
        <div className="model-editor-thinking-panel__summary-copy">
          <span className="model-editor-thinking-panel__series-title">{selectedSeriesOption?.label ?? normalizedThinkingCapability.series}</span>
          {selectedSeriesOption?.hint ? <p className="model-editor-thinking-panel__hint" data-testid="settings-thinking-series-hint">{selectedSeriesOption.hint}</p> : null}
        </div>
      </div>
      {currentAllowedCodeValues.length > 0 ? (
        <div className="model-editor-thinking-panel__section">
          <span className="form-field__label">{copy.defaultValueLabel}</span>
          <ThinkingPillGroup ariaLabel={copy.defaultValueAriaLabel} options={currentValueOptions} className="model-editor-thinking-panel__pill-group" />
        </div>
      ) : null}
      {budgetModeOptions.length > 0 ? (
        <div className="model-editor-thinking-panel__section">
          <span className="form-field__label">{copy.defaultModeLabel}</span>
          <ThinkingPillGroup ariaLabel={copy.defaultModeAriaLabel} options={budgetModeOptions} className="model-editor-thinking-panel__pill-group" />
        </div>
      ) : null}
      {supportsBudgetDefaultModes && budgetDefaultMode === 'budget' ? (
        <div className="model-editor-thinking-panel__section">
          <span className="form-field__label">{copy.budgetLabel}</span>
          <ThinkingBudgetSlider label={copy.budgetInputLabel} ariaLabel={copy.budgetInputAriaLabel}
            budgetTokens={budgetDefaultTokens} inputTestId="settings-thinking-budget-input"
            valueTestId="settings-thinking-budget-value" className="model-editor-thinking-panel__budget"
            onBudgetTokensChange={(tokens) => updateThinkingCapability(setThinkingCapabilityDeclarationBudgetTokens(normalizeBudgetDeclaration(modelEditorThinkingCapability), tokens))} />
        </div>
      ) : null}
      {thinkingCompatibilityWarning.shouldWarn ? (
        <p className="model-editor-thinking-panel__warning" data-testid="settings-thinking-compatibility-warning">{thinkingCompatibilityWarning.message}</p>
      ) : null}
    </div>
  )
}

import { useEffect, useRef, type KeyboardEvent as ReactKeyboardEvent } from 'react'

import { SelectField, TextField } from '../components/FormFields'
import type { ModelCapability, ThinkingLevelIntent } from '../types'
import {
  buildThinkingDeclarationDefaultLevelOptions,
  getThinkingCapabilityDeclarationMode,
  setThinkingCapabilityDeclarationDefaultLevel,
  setThinkingCapabilityDeclarationMode,
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
  const thinkingDefaultLevelOptions = buildThinkingDeclarationDefaultLevelOptions(modelEditorState.thinkingCapability)
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
                  onClearError()
                  onStateChange({
                    thinkingCapability: setThinkingCapabilityDeclarationMode(
                      modelEditorState.thinkingCapability,
                      value as 'inherit' | 'unsupported' | 'supported',
                    ),
                  })
                }}
              />
              {thinkingDeclarationMode === 'supported' ? (
                <SelectField
                  label="默认档位"
                  value={modelEditorState.thinkingCapability?.defaultLevel ?? 'off'}
                  options={thinkingDefaultLevelOptions}
                  onChange={(value) => {
                    onClearError()
                    onStateChange({
                      thinkingCapability: setThinkingCapabilityDeclarationDefaultLevel(
                        modelEditorState.thinkingCapability,
                        value as ThinkingLevelIntent,
                      ),
                    })
                  }}
                />
              ) : <div />}
            </div>

            {thinkingDeclarationMode === 'supported' ? (
              <>
                <div className="model-editor-section__header">
                  <span className="form-field__label">可用思考档位</span>
                </div>
                <div className="model-capability-picker">
                  {THINKING_LEVEL_OPTIONS.filter((option) => option.value !== 'off').map((option) => {
                    const active = modelEditorState.thinkingCapability?.supported === true
                      && (modelEditorState.thinkingCapability.levels ?? []).includes(option.value as Exclude<ThinkingLevelIntent, 'off'>)
                    const capabilityClassName = active ? ' model-capability-button--reasoning' : ' model-capability-button--inactive'

                    return (
                      <button
                        key={option.value}
                        type="button"
                        aria-pressed={active}
                        className={`model-capability-button${capabilityClassName}${active ? ' model-capability-button--active' : ''}`}
                        onClick={() => {
                          onClearError()
                          onStateChange({
                            thinkingCapability: toggleThinkingCapabilityDeclarationLevel(
                              modelEditorState.thinkingCapability,
                              option.value as Exclude<ThinkingLevelIntent, 'off'>,
                            ),
                          })
                        }}
                      >
                        {option.label}
                      </button>
                    )
                  })}
                </div>
                <p className="form-field__description">仅保存当前模型允许的离散档位。</p>
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

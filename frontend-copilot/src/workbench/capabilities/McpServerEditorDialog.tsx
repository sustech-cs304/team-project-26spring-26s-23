import { useEffect, useRef } from 'react'
import { X } from 'lucide-react'

import type { McpServerValidationError } from '../../../electron/mcp-registry/types'
import type { McpServerEditorMode } from './mcp-registry-view-model'

interface McpServerEditorDialogProps {
  mode: McpServerEditorMode
  value: string
  validationErrors?: readonly McpServerValidationError[]
  errorMessage?: string | null
  submitting?: boolean
  onValueChange: (value: string) => void
  onClose: () => void
  onConfirm: () => void
}

export function McpServerEditorDialog({
  mode,
  value,
  validationErrors = [],
  errorMessage = null,
  submitting = false,
  onValueChange,
  onClose,
  onConfirm,
}: McpServerEditorDialogProps) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)

  useEffect(() => {
    const focusFrame = window.requestAnimationFrame(() => {
      textareaRef.current?.focus()
      textareaRef.current?.setSelectionRange(0, textareaRef.current.value.length)
    })

    const handleWindowKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
      }
    }

    window.addEventListener('keydown', handleWindowKeyDown)

    return () => {
      window.cancelAnimationFrame(focusFrame)
      window.removeEventListener('keydown', handleWindowKeyDown)
    }
  }, [onClose])

  return (
    <div className="capabilities-dialog-backdrop" role="presentation" onClick={onClose}>
      <section
        className="capabilities-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={mode === 'edit' ? '编辑 MCP 服务器 JSON' : '添加 MCP 服务器 JSON'}
        onClick={(event) => event.stopPropagation()}
      >
        <header className="capabilities-dialog__header">
          <h3 className="capabilities-dialog__title">{mode === 'edit' ? '编辑 MCP 配置' : '添加 MCP 配置'}</h3>

          <button
            type="button"
            className="capabilities-dialog__close"
            aria-label="关闭 MCP 配置编辑器"
            onClick={onClose}
          >
            <X size={18} />
          </button>
        </header>

        <div className="capabilities-dialog__body">
          <textarea
            ref={textareaRef}
            className="text-input text-input--textarea capabilities-dialog__editor"
            value={value}
            spellCheck={false}
            aria-label={mode === 'edit' ? 'MCP 配置 JSON' : '新 MCP 配置 JSON'}
            onChange={(event) => onValueChange(event.target.value)}
          />

          {errorMessage || validationErrors.length > 0 ? (
            <div className="capabilities-dialog__errors" role="alert">
              {errorMessage ? <p>{errorMessage}</p> : null}
              {validationErrors.length > 0 ? (
                <ul>
                  {validationErrors.map((validationError) => (
                    <li key={`${validationError.fieldPath}:${validationError.message}`}>
                      {validationError.fieldPath}: {validationError.message}
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}
        </div>

        <footer className="capabilities-dialog__footer">
          <button type="button" className="secondary-button" disabled={submitting} onClick={onClose}>
            取消
          </button>
          <button type="button" className="primary-button" disabled={submitting} onClick={onConfirm}>
            {submitting ? '保存中…' : '确定'}
          </button>
        </footer>
      </section>
    </div>
  )
}

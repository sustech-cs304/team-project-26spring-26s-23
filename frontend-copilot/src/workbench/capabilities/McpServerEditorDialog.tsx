import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { X } from 'lucide-react'

import type {
  McpServerDraft,
  McpServerValidationError,
  McpTransportConfig,
} from '../../../electron/mcp-registry/types'
import {
  parseStandardMcpImportValue,
  type McpServerEditorMode,
  type StandardMcpImportCandidate,
} from './mcp-registry-view-model'

type EditorStep = 'form' | 'import'

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

interface McpServerFormState {
  serverId: string
  displayName: string
  description: string
  enabled: boolean
  transportKind: 'stdio' | 'http-sse'
  command: string
  argsText: string
  cwd: string
  envText: string
  baseUrl: string
  headersText: string
  ssePathOverride: string
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
  const firstInputRef = useRef<HTMLInputElement | null>(null)
  const importTextareaRef = useRef<HTMLTextAreaElement | null>(null)
  const [step, setStep] = useState<EditorStep>('form')
  const [formState, setFormState] = useState<McpServerFormState>(() => parseEditorValueToFormState(value))
  const [importValue, setImportValue] = useState('')
  const [importError, setImportError] = useState<string | null>(null)
  const [importCandidates, setImportCandidates] = useState<StandardMcpImportCandidate[]>([])

  useEffect(() => {
    setFormState(parseEditorValueToFormState(value))
  }, [value])

  const formValidationErrors = useMemo(
    () => validationErrors.filter((entry) => !entry.fieldPath.startsWith('$')),
    [validationErrors],
  )

  useEffect(() => {
    const focusFrame = window.requestAnimationFrame(() => {
      if (step === 'import') {
        importTextareaRef.current?.focus()
        return
      }
      firstInputRef.current?.focus()
      firstInputRef.current?.select()
    })
    return () => { window.cancelAnimationFrame(focusFrame) }
  }, [step])

  useEffect(() => {
    const handleWindowKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); onClose() }
    }
    window.addEventListener('keydown', handleWindowKeyDown)
    return () => { window.removeEventListener('keydown', handleWindowKeyDown) }
  }, [onClose])

  const updateFormState = useCallback((nextState: McpServerFormState) => {
    setFormState(nextState)
    onValueChange(JSON.stringify(buildDraftFromFormState(nextState), null, 2))
  }, [onValueChange])

  const handleParseImport = useCallback(() => {
    const result = parseStandardMcpImportValue(importValue)
    if (!result.ok) {
      setImportCandidates([])
      setImportError(result.message)
      return
    }
    setImportCandidates(result.candidates)
    setImportError(null)
    if (result.candidates.length === 1) {
      applyImportedCandidateInner(result.candidates[0])
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [importValue])

  // applyImportedCandidateInner is stable; no need to include in deps
  const applyImportedCandidate = useCallback((candidate: StandardMcpImportCandidate) => {
    applyImportedCandidateInner(candidate)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function applyImportedCandidateInner(candidate: StandardMcpImportCandidate) {
    const nextState = buildFormStateFromDraft(candidate.draft)
    setFormState(nextState)
    onValueChange(JSON.stringify(candidate.draft, null, 2))
    setStep('form')
  }

  return (
    <div className="capabilities-dialog-backdrop" role="presentation" onClick={onClose}>
      <section
        className="capabilities-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={mode === 'edit' ? '编辑 MCP 服务器' : '新增 MCP 服务器'}
        onClick={(event) => event.stopPropagation()}
      >
        <header className="capabilities-dialog__header">
          <div>
            <p className="capabilities-dialog__eyebrow">MCP 服务器</p>
            <h3 className="capabilities-dialog__title">{mode === 'edit' ? '编辑服务器' : '新增服务器'}</h3>
            <p className="capabilities-dialog__description">
              默认使用可视化表单填写；如果你已经有标准 MCP 配置，也可以直接导入。
            </p>
          </div>
          <button type="button" className="capabilities-dialog__close" aria-label="关闭服务器编辑窗口" onClick={onClose}>
            <X size={18} />
          </button>
        </header>
        <div className="capabilities-dialog__body">
          <div className="capabilities-dialog__toolbar">
            <button type="button" className={`secondary-button secondary-button--subtle${step === 'form' ? ' capabilities-dialog__tab-button--active' : ''}`} onClick={() => setStep('form')}>
              可视化表单
            </button>
            <button type="button" className={`secondary-button secondary-button--subtle${step === 'import' ? ' capabilities-dialog__tab-button--active' : ''}`} onClick={() => setStep('import')}>
              从标准 MCP 配置导入
            </button>
          </div>
          {step === 'form'
            ? renderMcpFormPanel({ formState, updateFormState, firstInputRef })
            : renderMcpImportPanel({ importValue, setImportValue, setImportError, importError, importTextareaRef, importCandidates, handleParseImport, applyImportedCandidate })}
          {renderMcpEditorErrors({ errorMessage, formValidationErrors })}
          <p className="capabilities-dialog__hint" aria-live="polite">
            这些设置会保存在当前设备中。如果包含令牌或密码，请确认设备环境安全后再保存。
          </p>
        </div>
        <footer className="capabilities-dialog__footer">
          <button type="button" className="secondary-button" disabled={submitting} onClick={onClose}>取消</button>
          <button type="button" className="primary-button" disabled={submitting} onClick={onConfirm}>
            {submitting ? '保存中…' : '保存服务器'}
          </button>
        </footer>
      </section>
    </div>
  )
}

function parseEditorValueToFormState(value: string): McpServerFormState {
  try {
    const parsed = JSON.parse(value) as McpServerDraft
    return buildFormStateFromDraft(parsed)
  } catch {
    return createEmptyFormState()
  }
}

function buildFormStateFromDraft(draft: McpServerDraft): McpServerFormState {
  if (draft.transportConfig.kind === 'stdio') {
    return {
      serverId: draft.serverId,
      displayName: draft.displayName,
      description: draft.description ?? '',
      enabled: draft.enabled,
      transportKind: 'stdio',
      command: draft.transportConfig.command,
      argsText: draft.transportConfig.args.join('\n'),
      cwd: draft.transportConfig.cwd ?? '',
      envText: stringifyStringRecord(draft.transportConfig.env),
      baseUrl: '',
      headersText: '',
      ssePathOverride: '',
    }
  }

  return {
    serverId: draft.serverId,
    displayName: draft.displayName,
    description: draft.description ?? '',
    enabled: draft.enabled,
    transportKind: 'http-sse',
    command: '',
    argsText: '',
    cwd: '',
    envText: stringifyStringRecord(draft.transportConfig.env),
    baseUrl: draft.transportConfig.baseUrl,
    headersText: stringifyStringRecord(draft.transportConfig.headers),
    ssePathOverride: draft.transportConfig.ssePathOverride ?? '',
  }
}

function buildDraftFromFormState(formState: McpServerFormState): McpServerDraft {
  const transportConfig: McpTransportConfig = formState.transportKind === 'stdio'
    ? {
        kind: 'stdio',
        command: formState.command.trim(),
        args: splitLines(formState.argsText),
        cwd: normalizeOptionalText(formState.cwd),
        env: parseKeyValueText(formState.envText),
      }
    : {
        kind: 'http-sse',
        baseUrl: formState.baseUrl.trim(),
        headers: parseKeyValueText(formState.headersText),
        env: parseKeyValueText(formState.envText),
        ssePathOverride: normalizeOptionalText(formState.ssePathOverride),
      }

  return {
    serverId: formState.serverId.trim(),
    displayName: formState.displayName.trim(),
    description: normalizeOptionalText(formState.description),
    enabled: formState.enabled,
    transportKind: formState.transportKind,
    transportConfig,
  }
}

function createEmptyFormState(): McpServerFormState {
  return {
    serverId: 'new-server',
    displayName: 'new-server',
    description: '',
    enabled: true,
    transportKind: 'stdio',
    command: 'uvx',
    argsText: 'example-mcp-server',
    cwd: '',
    envText: '',
    baseUrl: '',
    headersText: '',
    ssePathOverride: '',
  }
}

function splitLines(value: string): string[] {
  return value
    .split(/\r?\n/u)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
}

function normalizeOptionalText(value: string): string | null {
  const trimmed = value.trim()
  return trimmed === '' ? null : trimmed
}

function parseKeyValueText(value: string): Record<string, string> {
  const entries = splitLines(value)
  return Object.fromEntries(entries.map((entry) => {
    const separatorIndex = entry.indexOf('=')
    if (separatorIndex === -1) {
      return [entry.trim(), '']
    }

    return [entry.slice(0, separatorIndex).trim(), entry.slice(separatorIndex + 1).trim()]
  }).filter(([key]) => key !== ''))
}

function stringifyStringRecord(value: Record<string, string> | undefined): string {
  if (value === undefined) {
    return ''
  }

  return Object.entries(value)
    .map(([key, entryValue]) => `${key}=${entryValue}`)
    .join('\n')
}

function renderMcpFormPanel(input: {
  formState: McpServerFormState
  updateFormState: (nextState: McpServerFormState) => void
  firstInputRef: React.RefObject<HTMLInputElement | null>
}) {
  const { formState, updateFormState, firstInputRef } = input

  return (
    <div className="capabilities-dialog__form-grid">
      <label className="capabilities-dialog__field-group">
        <span className="capabilities-dialog__field-label">服务器名称</span>
        <input
          ref={firstInputRef}
          className="text-input"
          value={formState.displayName}
          aria-label="服务器名称"
          onChange={(event) => updateFormState({ ...formState, displayName: event.target.value })}
        />
      </label>

      <label className="capabilities-dialog__field-group">
        <span className="capabilities-dialog__field-label">服务器标识</span>
        <input
          className="text-input"
          value={formState.serverId}
          aria-label="服务器标识"
          onChange={(event) => updateFormState({ ...formState, serverId: event.target.value })}
        />
      </label>

      <label className="capabilities-dialog__field-group capabilities-dialog__field-group--full">
        <span className="capabilities-dialog__field-label">说明</span>
        <input
          className="text-input"
          value={formState.description}
          aria-label="服务器说明"
          placeholder="例如：用于网页抓取或浏览器调试"
          onChange={(event) => updateFormState({ ...formState, description: event.target.value })}
        />
      </label>

      <label className="capabilities-dialog__toggle-field capabilities-dialog__field-group--full">
        <input
          type="checkbox"
          checked={formState.enabled}
          aria-label="保存后立即启用"
          onChange={(event) => updateFormState({ ...formState, enabled: event.target.checked })}
        />
        <span>保存后立即启用</span>
      </label>

      {renderTransportKindSelector({ formState, updateFormState })}

      {formState.transportKind === 'stdio'
        ? renderStdioTransportFields({ formState, updateFormState })
        : renderHttpSseTransportFields({ formState, updateFormState })}

      <label className="capabilities-dialog__field-group capabilities-dialog__field-group--full">
        <span className="capabilities-dialog__field-label">环境变量</span>
        <textarea
          className="text-input text-input--textarea capabilities-dialog__compact-textarea"
          value={formState.envText}
          aria-label="环境变量"
          placeholder={'每行一个键值，例如：\nAPI_KEY=example'}
          onChange={(event) => updateFormState({ ...formState, envText: event.target.value })}
        />
      </label>
    </div>
  )
}

function renderTransportKindSelector(input: {
  formState: McpServerFormState
  updateFormState: (nextState: McpServerFormState) => void
}) {
  const { formState, updateFormState } = input

  return (
    <fieldset className="capabilities-dialog__field-group capabilities-dialog__field-group--full capabilities-dialog__transport-fieldset">
      <legend className="capabilities-dialog__field-label">连接方式</legend>
      <div className="capabilities-dialog__segmented">
        <button
          type="button"
          className={`capabilities-dialog__segmented-button${formState.transportKind === 'stdio' ? ' capabilities-dialog__segmented-button--active' : ''}`}
          onClick={() => updateFormState({ ...formState, transportKind: 'stdio' })}
        >
          命令行启动
        </button>
        <button
          type="button"
          className={`capabilities-dialog__segmented-button${formState.transportKind === 'http-sse' ? ' capabilities-dialog__segmented-button--active' : ''}`}
          onClick={() => updateFormState({ ...formState, transportKind: 'http-sse' })}
        >
          HTTP / SSE
        </button>
      </div>
    </fieldset>
  )
}

function renderStdioTransportFields(input: {
  formState: McpServerFormState
  updateFormState: (nextState: McpServerFormState) => void
}) {
  const { formState, updateFormState } = input

  return (
    <>
      <label className="capabilities-dialog__field-group capabilities-dialog__field-group--full">
        <span className="capabilities-dialog__field-label">启动命令</span>
        <input
          className="text-input"
          value={formState.command}
          aria-label="启动命令"
          placeholder="例如：uvx 或 npx"
          onChange={(event) => updateFormState({ ...formState, command: event.target.value })}
        />
      </label>

      <label className="capabilities-dialog__field-group capabilities-dialog__field-group--full">
        <span className="capabilities-dialog__field-label">命令参数</span>
        <textarea
          className="text-input text-input--textarea capabilities-dialog__compact-textarea"
          value={formState.argsText}
          aria-label="命令参数"
          placeholder={'每行一个参数，例如：\nchrome-devtools-mcp@latest'}
          onChange={(event) => updateFormState({ ...formState, argsText: event.target.value })}
        />
      </label>

      <label className="capabilities-dialog__field-group capabilities-dialog__field-group--full">
        <span className="capabilities-dialog__field-label">工作目录</span>
        <input
          className="text-input"
          value={formState.cwd}
          aria-label="工作目录"
          placeholder="可选"
          onChange={(event) => updateFormState({ ...formState, cwd: event.target.value })}
        />
      </label>
    </>
  )
}

function renderHttpSseTransportFields(input: {
  formState: McpServerFormState
  updateFormState: (nextState: McpServerFormState) => void
}) {
  const { formState, updateFormState } = input

  return (
    <>
      <label className="capabilities-dialog__field-group capabilities-dialog__field-group--full">
        <span className="capabilities-dialog__field-label">服务地址</span>
        <input
          className="text-input"
          value={formState.baseUrl}
          aria-label="服务地址"
          placeholder="例如：https://example.com/mcp"
          onChange={(event) => updateFormState({ ...formState, baseUrl: event.target.value })}
        />
      </label>

      <label className="capabilities-dialog__field-group capabilities-dialog__field-group--full">
        <span className="capabilities-dialog__field-label">SSE 路径覆盖</span>
        <input
          className="text-input"
          value={formState.ssePathOverride}
          aria-label="SSE 路径覆盖"
          placeholder="可选，例如：/sse"
          onChange={(event) => updateFormState({ ...formState, ssePathOverride: event.target.value })}
        />
      </label>

      <label className="capabilities-dialog__field-group capabilities-dialog__field-group--full">
        <span className="capabilities-dialog__field-label">请求头</span>
        <textarea
          className="text-input text-input--textarea capabilities-dialog__compact-textarea"
          value={formState.headersText}
          aria-label="请求头"
          placeholder={'每行一个键值，例如：\nAuthorization=Bearer token'}
          onChange={(event) => updateFormState({ ...formState, headersText: event.target.value })}
        />
      </label>
    </>
  )
}

function renderMcpImportPanel(input: {
  importValue: string
  setImportValue: (value: string) => void
  setImportError: (error: string | null) => void
  importError: string | null
  importTextareaRef: React.RefObject<HTMLTextAreaElement | null>
  importCandidates: StandardMcpImportCandidate[]
  handleParseImport: () => void
  applyImportedCandidate: (candidate: StandardMcpImportCandidate) => void
}) {
  const {
    importValue,
    setImportValue,
    setImportError,
    importError,
    importTextareaRef,
    importCandidates,
    handleParseImport,
    applyImportedCandidate,
  } = input

  return (
    <div className="capabilities-dialog__import-panel">
      <label className="capabilities-dialog__field-group capabilities-dialog__field-group--full">
        <span className="capabilities-dialog__field-label">粘贴标准 MCP JSON</span>
        <textarea
          ref={importTextareaRef}
          className="text-input text-input--textarea capabilities-dialog__editor"
          value={importValue}
          spellCheck={false}
          aria-label="标准 MCP JSON"
          placeholder={'支持以下两种格式：\n1. { "mcpServers": { ... } }\n2. 单个 server 配置对象'}
          onChange={(event) => {
            setImportValue(event.target.value)
            setImportError(null)
          }}
        />
      </label>

      <div className="capabilities-dialog__import-actions">
        <button type="button" className="secondary-button secondary-button--subtle" onClick={handleParseImport}>
          解析配置
        </button>
      </div>

      {importError ? (
        <div className="capabilities-dialog__errors" role="alert">
          <p>{importError}</p>
        </div>
      ) : null}

      {importCandidates.length > 1 ? (
        <div className="capabilities-dialog__import-candidates">
          <p className="capabilities-dialog__hint">检测到多个服务器，请先选择一个导入。之后可以继续逐个添加。</p>
          <ul className="capabilities-dialog__candidate-list">
            {importCandidates.map((candidate) => (
              <li key={`${candidate.serverId}:${candidate.displayName}`} className="capabilities-dialog__candidate-item">
                <div>
                  <strong>{candidate.displayName || candidate.serverId || '未命名服务器'}</strong>
                  <p>{candidate.serverId || '导入后请补充服务器标识'}</p>
                </div>
                <button
                  type="button"
                  className="secondary-button secondary-button--subtle"
                  onClick={() => applyImportedCandidate(candidate)}
                >
                  导入此项
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  )
}

function renderMcpEditorErrors(input: {
  errorMessage: string | null
  formValidationErrors: readonly McpServerValidationError[]
}) {
  const { errorMessage, formValidationErrors } = input

  if (!errorMessage && formValidationErrors.length === 0) {
    return null
  }

  return (
    <div className="capabilities-dialog__errors" role="alert">
      {errorMessage ? <p>{errorMessage}</p> : null}
      {formValidationErrors.length > 0 ? (
        <ul>
          {formValidationErrors.map((validationError) => (
            <li key={`${validationError.fieldPath}:${validationError.message}`}>
              {validationError.fieldPath}: {validationError.message}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}

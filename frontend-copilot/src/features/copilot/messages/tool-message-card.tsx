import { useEffect, useMemo, useRef, useState, type ComponentType } from 'react'
import { AlertTriangle, CircleSlash, Wrench } from 'lucide-react'

import { gsap, useGSAP } from '../../../workbench/animation-utils'
import { getCopilotChatCopy } from '../../../workbench/locale'
import { CONTROLLED_INLINE_FORM_TOOL_ID } from '../inline-form'
import type { CopilotErrorDetailSource } from '../error-detail-overlay-view-model'
import { resolveCopilotToolDisplayNameFromToolId } from '../tool-presentation'
import type { CopilotToolMessageItem } from '../run-segment-view-model'

interface ToolMessageCardProps {
  turn: CopilotToolMessageItem
  index: number
  runtimeUrl: string | null
  shellPassthrough?: {
    enabled: boolean
    sessionId: string | null
    shell: string | null
    cwd: string | null
  } | null
  onActivateShellPassthrough?: ((input: { sessionId: string; shell: string; cwd: string | null }) => void) | null
  onResolveToolApproval?: ((input: {
    runId: string
    toolCallId: string
    decision: 'approved' | 'rejected'
  }) => Promise<void>) | null
  onOpenErrorDetail?: ((errorDetail: CopilotErrorDetailSource, trigger: HTMLButtonElement | null) => void) | null
  language: string
}

export function ToolMessageCard({
  turn,
  index,
  runtimeUrl,
  shellPassthrough = null,
  onActivateShellPassthrough = null,
  onResolveToolApproval,
  onOpenErrorDetail,
  language,
}: ToolMessageCardProps) {
  const [expanded, setExpanded] = useState(false)
  const [renderPanel, setRenderPanel] = useState(false)
  const [inputExpanded, setInputExpanded] = useState(false)
  const [approvalPendingDecision, setApprovalPendingDecision] = useState<'approved' | 'rejected' | null>(null)
  const [approvalError, setApprovalError] = useState<string | null>(null)
  const [countdownNow, setCountdownNow] = useState(() => Date.now())
  const contentSections = buildToolContentSections(turn)
  const inputSummary = hasNonEmptyValue(turn.inputSummary) ? turn.inputSummary : null
  const panelId = `chat-message-tool-panel-${turn.id}`
  const panelRef = useRef<HTMLDivElement>(null)

  useGSAP(() => {
    const panel = panelRef.current
    if (!panel) return

    gsap.killTweensOf(panel)

    if (expanded && renderPanel) {
      gsap.fromTo(panel,
        { height: 0, opacity: 0 },
        {
          height: 'auto',
          opacity: 1,
          duration: 0.22,
          ease: 'power3.out',
          onComplete: () => {
            if (panelRef.current) {
              gsap.set(panelRef.current, { clearProps: 'height' })
            }
          },
        },
      )
      return
    }

    if (!expanded && renderPanel) {
      gsap.to(panel, {
        height: 0,
        opacity: 0,
        duration: 0.15,
        ease: 'power3.in',
        onComplete: () => {
          setRenderPanel(false)
          if (panelRef.current) {
            gsap.set(panelRef.current, { clearProps: 'height' })
          }
        },
      })
    }
  }, { dependencies: [expanded, renderPanel] })

  const inputPanelId = `chat-message-tool-input-panel-${turn.id}`
  const approval = turn.approval ?? null
  const errorDetail = resolveMessageErrorDetailSource(turn)
  const copy = getCopilotChatCopy(language)
  const timeoutSecondsLabel = approval === null ? null : formatToolApprovalTimeoutSecondsLabel(approval, countdownNow)
  const showApprovalActions = turn.toolPhase === 'waiting_approval'
  const approvalControlsEnabled = runtimeUrl !== null && typeof onResolveToolApproval === 'function' && approvalPendingDecision === null
  const shellPassthroughStartInfo = useMemo(() => {
    if (turn.toolId !== 'tool.shell-session.start' || turn.toolPhase !== 'completed') {
      return null
    }
    const raw = turn.resultSummary
    if (typeof raw !== 'string' || raw.trim() === '') {
      return null
    }
    try {
      const parsed = JSON.parse(raw) as Record<string, unknown>
      const sessionId = typeof parsed.sessionId === 'string' ? parsed.sessionId : null
      const shell = typeof parsed.shell === 'string' ? parsed.shell : null
      const cwd = typeof parsed.cwd === 'string' ? parsed.cwd : null
      if (sessionId === null || shell === null) {
        return null
      }
      return { sessionId, shell, cwd }
    } catch {
      return null
    }
  }, [turn.resultSummary, turn.toolId, turn.toolPhase])
  const shellPassthroughActionEnabled = shellPassthroughStartInfo !== null
    && typeof onActivateShellPassthrough === 'function'
    && runtimeUrl !== null
  const shellPassthroughAlreadyActive = shellPassthroughStartInfo !== null
    && shellPassthrough?.enabled === true
    && shellPassthrough.sessionId === shellPassthroughStartInfo.sessionId

  useEffect(() => {
    if (turn.toolPhase !== 'waiting_approval' || approval?.timeoutAt === null || approval?.timeoutAt === undefined) {
      return
    }

    const intervalId = window.setInterval(() => {
      setCountdownNow(Date.now())
    }, 1_000)

    return () => {
      window.clearInterval(intervalId)
    }
  }, [approval?.timeoutAt, turn.toolPhase])

  useEffect(() => {
    if (turn.toolPhase !== 'waiting_approval') {
      setApprovalPendingDecision(null)
      setApprovalError(null)
    }
  }, [turn.toolPhase])

  const handleResolveApproval = async (decision: 'approved' | 'rejected') => {
    if (turn.toolPhase !== 'waiting_approval' || typeof onResolveToolApproval !== 'function') {
      return
    }

    setApprovalPendingDecision(decision)
    setApprovalError(null)
    try {
      await onResolveToolApproval({
        runId: turn.runId,
        toolCallId: turn.toolCallId,
        decision,
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : '工具审批提交失败。'
      setApprovalError(message)
      setApprovalPendingDecision(null)
    }
  }

  return (
    <div className="copilot-chat__tool-card" data-testid={`chat-message-tool-card-${index}`}>
      <div className="copilot-chat__tool-header-row">
        <ToolToggleButton
          turn={turn}
          index={index}
          expanded={expanded}
          panelId={panelId}
          onToggle={() => {
            if (expanded) {
              setExpanded(false)
            } else {
              setRenderPanel(true)
              setExpanded(true)
            }
          }}
        />
        {shellPassthroughStartInfo !== null && (
          <button
            type="button"
            className="secondary-button secondary-button--subtle"
            disabled={!shellPassthroughActionEnabled || shellPassthroughAlreadyActive}
            onClick={() => {
              if (!shellPassthroughActionEnabled || shellPassthroughStartInfo === null) {
                return
              }
              onActivateShellPassthrough?.(shellPassthroughStartInfo)
            }}
          >
            {shellPassthroughAlreadyActive ? '已直连' : '启用直连'}
          </button>
        )}
        {renderToolErrorDetailButton({ turn, index, errorDetail, onOpenErrorDetail, copy })}
      </div>
      {showApprovalActions && renderToolApprovalBar({
        turn,
        index,
        timeoutSecondsLabel,
        approvalPendingDecision,
        approvalControlsEnabled,
        approvalError,
        onApprove: () => {
          void handleResolveApproval('approved')
        },
        onReject: () => {
          void handleResolveApproval('rejected')
        },
      })}
      {renderPanel && (
        <div ref={panelRef} className="copilot-chat__tool-panel" id={panelId} data-testid={`chat-message-tool-panel-${index}`}>
          {contentSections.map((section, sectionIndex) => (
            <ToolContentSection
              key={`${turn.id}:${section.label}:${sectionIndex}`}
              label={section.label}
              value={section.value}
              kind={section.kind}
              testIdPrefix={sectionIndex === 0
                ? `chat-message-tool-output-${index}`
                : `chat-message-tool-extra-${index}-${sectionIndex}`}
            />
          ))}
          {inputSummary !== null && (
            <ToolInputSection
              index={index}
              inputSummary={inputSummary}
              inputExpanded={inputExpanded}
              inputPanelId={inputPanelId}
              onToggleInput={() => setInputExpanded((current) => !current)}
            />
          )}
        </div>
      )}
    </div>
  )
}

function ToolToggleButton({
  turn,
  index,
  expanded,
  panelId,
  onToggle,
}: {
  turn: CopilotToolMessageItem
  index: number
  expanded: boolean
  panelId: string
  onToggle: () => void
}) {
  return (
    <button
      type="button"
      className="copilot-chat__tool-toggle"
      aria-controls={panelId}
      aria-expanded={expanded}
      data-expanded={expanded}
      data-testid={`chat-message-tool-toggle-${index}`}
      onClick={onToggle}
    >
      <span className="copilot-chat__tool-toggle-main">
        {renderToolStepIcon(turn)}
        <span className="copilot-chat__tool-toggle-icon" aria-hidden="true">{expanded ? '▾' : '▸'}</span>
        <span className="copilot-chat__message-label">{resolveToolCardTitle(turn)}</span>
      </span>
      {turn.status === 'streaming' && (
        <span
          className="copilot-chat__tool-spinner"
          data-testid={`chat-message-tool-spinner-${index}`}
          aria-label="工具调用进行中"
        />
      )}
    </button>
  )
}

function ToolInputSection({
  index,
  inputSummary,
  inputExpanded,
  inputPanelId,
  onToggleInput,
}: {
  index: number
  inputSummary: string
  inputExpanded: boolean
  inputPanelId: string
  onToggleInput: () => void
}) {
  return (
    <div className="copilot-chat__tool-nested">
      <button
        type="button"
        className="copilot-chat__tool-nested-toggle"
        aria-controls={inputPanelId}
        aria-expanded={inputExpanded}
        data-expanded={inputExpanded}
        data-testid={`chat-message-tool-input-toggle-${index}`}
        onClick={onToggleInput}
      >
        <span className="copilot-chat__tool-toggle-main copilot-chat__tool-toggle-main--nested">
          <span className="copilot-chat__tool-toggle-icon" aria-hidden="true">{inputExpanded ? '▾' : '▸'}</span>
          <span className="copilot-chat__tool-section-label">输入</span>
        </span>
      </button>
      {inputExpanded && (
        <div
          className="copilot-chat__tool-nested-panel"
          id={inputPanelId}
          data-testid={`chat-message-tool-input-panel-${index}`}
        >
          <ToolStructuredContent
            value={inputSummary}
            kind="input"
            testIdPrefix={`chat-message-tool-input-${index}`}
          />
        </div>
      )}
    </div>
  )
}

function renderToolStepIcon(turn: CopilotToolMessageItem) {
  const failed = turn.status === 'failed' || turn.toolPhase === 'failed'
  const cancelled = turn.status === 'cancelled' || turn.toolPhase === 'cancelled'
  const Icon = failed ? AlertTriangle : cancelled ? CircleSlash : Wrench
  const iconClassName = failed
    ? 'copilot-chat__step-icon--error'
    : cancelled
      ? 'copilot-chat__step-icon--cancelled'
      : 'copilot-chat__step-icon--tool'

  return (
    <span
      className={`copilot-chat__step-icon ${iconClassName}`}
      aria-hidden="true"
    >
      <Icon size={14} strokeWidth={2.2} />
    </span>
  )
}

function ToolContentSection({
  label,
  value,
  kind,
  testIdPrefix,
}: {
  label: string | null
  value: string
  kind: 'input' | 'result' | 'error'
  testIdPrefix: string
}) {
  return (
    <section className={[`copilot-chat__tool-section`, `copilot-chat__tool-section--${kind}`].join(' ')}>
      {label !== null && <p className="copilot-chat__tool-section-label">{label}</p>}
      <ToolStructuredContent value={value} kind={kind} testIdPrefix={testIdPrefix} />
    </section>
  )
}

interface JsonViewComponentProps {
  src: unknown
  collapsed?: boolean | number
  displaySize?: boolean | number | 'collapsed' | 'expanded'
  enableClipboard?: boolean
  theme?: 'default' | 'a11y' | 'github' | 'vscode' | 'atom' | 'winter-is-coming' | 'vitesse'
}

type JsonViewComponent = ComponentType<JsonViewComponentProps>

function ToolStructuredContent({
  value,
  kind,
  testIdPrefix,
}: {
  value: string
  kind: 'input' | 'result' | 'error'
  testIdPrefix: string
}) {
  const structuredValue = useMemo(() => parseStructuredToolValue(value), [value])
  const [jsonViewComponent, setJsonViewComponent] = useState<JsonViewComponent | null>(null)

  useEffect(() => {
    if (structuredValue.kind !== 'json' || typeof document === 'undefined') {
      return
    }

    let active = true

    void import('react18-json-view')
      .then((module) => {
        if (!active) {
          return
        }

        setJsonViewComponent(() => resolveJsonViewComponent(module))
      })
      .catch(() => {
        if (!active) {
          return
        }

        setJsonViewComponent(null)
      })

    return () => {
      active = false
    }
  }, [structuredValue.kind])

  if (structuredValue.kind === 'json') {
    const JsonViewComponent = jsonViewComponent
    return (
      <div
        className={[
          'copilot-chat__tool-json-viewer',
          `copilot-chat__tool-json-viewer--${kind}`,
        ].join(' ')}
        data-testid={`${testIdPrefix}-json`}
        data-json-viewer={JsonViewComponent === null ? 'fallback' : 'react18-json-view'}
        data-json-collapsed="true"
      >
        {JsonViewComponent === null
          ? <ToolJsonFallback value={structuredValue.value} />
          : (
              <JsonViewComponent
                src={structuredValue.value}
                collapsed={true}
                displaySize="collapsed"
                enableClipboard={false}
                theme="vscode"
              />
            )}
      </div>
    )
  }

  return (
    <pre
      className={[
        'copilot-chat__tool-plain-text',
        `copilot-chat__tool-plain-text--${kind}`,
      ].join(' ')}
      data-testid={`${testIdPrefix}-text`}
    >
      {structuredValue.value}
    </pre>
  )
}

function buildToolContentSections(turn: CopilotToolMessageItem): Array<{
  label: string | null
  value: string
  kind: 'result' | 'error'
}> {
  const sections: Array<{
    label: string | null
    value: string
    kind: 'result' | 'error'
  }> = [{
    label: resolveToolPrimarySectionLabel(turn),
    value: turn.content,
    kind: turn.status === 'failed' ? 'error' : 'result',
  }]

  if (hasDistinctNonEmptyValue(turn.errorSummary, turn.content)) {
    sections.push({
      label: '错误',
      value: turn.errorSummary,
      kind: 'error',
    })
  }

  return sections
}

function resolveToolPrimarySectionLabel(turn: CopilotToolMessageItem): string | null {
  switch (turn.status) {
    case 'streaming':
      return '当前状态'
    case 'failed':
      return '状态'
    case 'cancelled':
      return '当前状态'
    case 'completed':
      return null
  }
}

function resolveToolCardTitle(turn: CopilotToolMessageItem): string {
  const displayNameFromTitle = extractToolDisplayNameFromTitle(turn.title)
  const displayName = displayNameFromTitle ?? resolveToolDisplayNameFromToolId(turn.toolId)

  if (turn.toolId === CONTROLLED_INLINE_FORM_TOOL_ID && turn.status === 'streaming') {
    return '工具等待中'
  }

  switch (turn.status) {
    case 'streaming':
      return displayName === null ? turn.title : `${displayName}调用中`
    case 'completed':
      return displayName === null ? turn.title : `${displayName}被调用`
    case 'cancelled':
      return displayName === null ? (findFirstNonEmptyValue(turn.title) ?? '工具调用已取消') : `${displayName}已取消`
    case 'failed':
      return displayNameFromTitle === null ? (findFirstNonEmptyValue(turn.title) ?? '工具调用失败') : `${displayNameFromTitle}调用失败`
  }
}

function extractToolDisplayNameFromTitle(title: string): string | null {
  const trimmedTitle = title.trim()
  if (trimmedTitle === '') {
    return null
  }

  const titlePatterns = [
    /^调用(.+?工具)$/,
    /^(.+?工具)已返回结果$/,
    /^(.+?工具)被调用$/,
    /^(.+?工具)调用中$/,
    /^(.+?工具)调用失败$/,
    /^(.+?工具)已取消$/,
  ]

  for (const pattern of titlePatterns) {
    const matched = trimmedTitle.match(pattern)
    const candidate = matched?.[1]?.trim() ?? ''
    if (candidate !== '') {
      return candidate
    }
  }

  return trimmedTitle.endsWith('工具') && trimmedTitle !== '工具' ? trimmedTitle : null
}

function resolveToolDisplayNameFromToolId(toolId: string): string | null {
  const normalizedToolId = toolId.trim()
  if (normalizedToolId === '') {
    return null
  }

  return resolveCopilotToolDisplayNameFromToolId(normalizedToolId)
}

function resolveMessageErrorDetailSource(turn: CopilotToolMessageItem): CopilotErrorDetailSource | null {
  return turn.errorDetail ?? null
}

function renderToolErrorDetailButton(input: {
  turn: CopilotToolMessageItem
  index: number
  errorDetail: CopilotErrorDetailSource | null
  onOpenErrorDetail?: ((errorDetail: CopilotErrorDetailSource, trigger: HTMLButtonElement | null) => void) | null
  copy: ReturnType<typeof getCopilotChatCopy>
}) {
  if (input.turn.status !== 'failed' || input.errorDetail === null) {
    return null
  }

  return (
    <button
      type="button"
      className="icon-button copilot-chat__message-detail-trigger copilot-chat__tool-detail-trigger"
      aria-label={input.copy.messages.errorDetailButton}
      aria-haspopup="dialog"
      title={input.copy.messages.errorDetailButton}
      data-testid={`chat-message-tool-error-detail-button-${input.index}`}
      disabled={input.onOpenErrorDetail == null}
      onClick={(event) => {
        if (input.errorDetail !== null) {
          input.onOpenErrorDetail?.(input.errorDetail, event.currentTarget)
        }
      }}
    >
      <span aria-hidden="true">ⓘ</span>
    </button>
  )
}

function hasNonEmptyValue(value: string | null | undefined): value is string {
  return (value?.trim() ?? '') !== ''
}

function renderToolApprovalBar(input: {
  turn: CopilotToolMessageItem
  index: number
  timeoutSecondsLabel: string | null
  approvalPendingDecision: 'approved' | 'rejected' | null
  approvalControlsEnabled: boolean
  approvalError: string | null
  onApprove: () => void
  onReject: () => void
}) {
  if (input.turn.toolPhase !== 'waiting_approval') {
    return null
  }

  return (
    <div className="copilot-chat__tool-approval" data-testid={`chat-message-tool-approval-${input.index}`}>
      {input.approvalPendingDecision === null && (
        <div className="copilot-chat__tool-approval-actions">
          <button
            type="button"
            className="copilot-chat__tool-approval-button copilot-chat__tool-approval-button--reject"
            data-testid={`chat-message-tool-approval-reject-${input.index}`}
            disabled={!input.approvalControlsEnabled}
            onClick={input.onReject}
          >
            {resolveToolApprovalActionLabel({
              action: 'reject',
              approval: input.turn.approval ?? null,
              timeoutSecondsLabel: input.timeoutSecondsLabel,
            })}
          </button>
          <button
            type="button"
            className="copilot-chat__tool-approval-button copilot-chat__tool-approval-button--approve"
            data-testid={`chat-message-tool-approval-approve-${input.index}`}
            disabled={!input.approvalControlsEnabled}
            onClick={input.onApprove}
          >
            {resolveToolApprovalActionLabel({
              action: 'approve',
              approval: input.turn.approval ?? null,
              timeoutSecondsLabel: input.timeoutSecondsLabel,
            })}
          </button>
        </div>
      )}
      {input.approvalError !== null && (
        <p className="copilot-chat__tool-approval-error" data-testid={`chat-message-tool-approval-error-${input.index}`}>
          {input.approvalError}
        </p>
      )}
    </div>
  )
}

function formatToolApprovalTimeoutSecondsLabel(
  approval: NonNullable<CopilotToolMessageItem['approval']>,
  observedNow: number,
): string | null {
  if (approval.timeoutAt === null || approval.timeoutAt === undefined) {
    return approval.timeoutSeconds === null || approval.timeoutSeconds === undefined
      ? null
      : `${Math.max(0, Math.ceil(approval.timeoutSeconds))}s`
  }

  const timeoutAt = Date.parse(approval.timeoutAt)
  if (Number.isNaN(timeoutAt)) {
    return approval.timeoutSeconds === null || approval.timeoutSeconds === undefined
      ? null
      : `${Math.max(0, Math.ceil(approval.timeoutSeconds))}s`
  }

  const secondsRemaining = Math.max(0, Math.ceil((timeoutAt - observedNow) / 1_000))
  return `${secondsRemaining}s`
}

function resolveToolApprovalActionLabel(input: {
  action: 'approve' | 'reject'
  approval: CopilotToolMessageItem['approval']
  timeoutSecondsLabel: string | null
}): string {
  const baseLabel = input.action === 'approve' ? '批准' : '拒绝'
  if (
    input.approval === null
    || input.approval === undefined
    || input.approval.mode !== 'delay'
    || input.timeoutSecondsLabel === null
    || input.approval.timeoutAction === null
  ) {
    return baseLabel
  }

  const timeoutMatchesAction = (input.action === 'approve' && input.approval.timeoutAction === 'approve')
    || (input.action === 'reject' && input.approval.timeoutAction === 'deny')
  return timeoutMatchesAction ? `${baseLabel}（${input.timeoutSecondsLabel}）` : baseLabel
}

function hasDistinctNonEmptyValue(
  value: string | null | undefined,
  comparedValue: string,
): value is string {
  if (!hasNonEmptyValue(value)) {
    return false
  }

  return value !== comparedValue
}

function parseStructuredToolValue(value: string):
  | { kind: 'json'; value: unknown }
  | { kind: 'text'; value: string } {
  const trimmedValue = value.trim()
  if (trimmedValue === '') {
    return {
      kind: 'text',
      value,
    }
  }

  try {
    return {
      kind: 'json',
      value: JSON.parse(trimmedValue),
    }
  } catch {
    return {
      kind: 'text',
      value,
    }
  }
}

function ToolJsonFallback({ value }: { value: unknown }) {
  return (
    <details className="copilot-chat__tool-json-fallback">
      <summary className="copilot-chat__tool-json-fallback-summary">JSON 内容</summary>
      <pre className="copilot-chat__tool-plain-text copilot-chat__tool-plain-text--json-fallback">
        {JSON.stringify(value, null, 2)}
      </pre>
    </details>
  )
}

function findFirstNonEmptyValue(...values: Array<string | null | undefined>): string | null {
  for (const value of values) {
    const trimmedValue = value?.trim() ?? ''
    if (trimmedValue !== '') {
      return trimmedValue
    }
  }

  return null
}

function resolveJsonViewComponent(module: unknown): JsonViewComponent {
  if (typeof module === 'function') {
    return module as JsonViewComponent
  }

  if (typeof module === 'object' && module !== null && 'default' in module) {
    const defaultExport = (module as { default?: unknown }).default
    if (typeof defaultExport === 'function') {
      return defaultExport as JsonViewComponent
    }

    if (typeof defaultExport === 'object' && defaultExport !== null && 'default' in defaultExport) {
      const nestedDefaultExport = (defaultExport as { default?: unknown }).default
      if (typeof nestedDefaultExport === 'function') {
        return nestedDefaultExport as JsonViewComponent
      }
    }
  }

  throw new TypeError('Unsupported react18-json-view export shape.')
}

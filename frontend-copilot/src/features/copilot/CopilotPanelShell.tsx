import {
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type FormEvent,
  type MutableRefObject,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  type RefObject,
  type SetStateAction,
} from 'react'

import type { SettingsWorkspaceToolPermissionPolicyState } from '../../../electron/settings-workspace/schema'
import type { CopilotComposerAttachmentsState } from './attachments/types'
import { getCopilotChatCopy } from '../../workbench/locale'
import type { AgentType, AssistantSessionShell } from '../../workbench/types'
import type { AssistantAgentDirectoryState } from '../../workbench/assistant/assistant-workspace-controller'
import type { AssistantSessionHistoryState } from '../../workbench/assistant/assistant-history-state'
import { CrossFade } from './components/CrossFade'
import { CopilotComposerShell } from './composer/CopilotComposerShell'
import { CopilotMessagesShell } from './messages/CopilotMessagesShell'
import { CopilotRuntimeStateShell } from './CopilotRuntimeStateShell'
import { ErrorDetailOverlay } from './ErrorDetailOverlay'
import {
  buildErrorDetailOverlayViewModel,
  type CopilotErrorDetailSource,
  type ErrorDetailOverlayViewModel,
} from './error-detail-overlay-view-model'
import {
  createCopilotTransientErrorState,
  type CopilotChatComposerDraft,
  type CopilotTransientErrorState,
} from './copilot-chat-helpers'
import type {
  CopilotAssistantPlaceholderState,
  CopilotMessageListItem,
} from './run-segment-view-model'
import type { PersistedHistoryDriftSummary } from './persisted-history-drift'
import type { PersistedConversationSource } from './persisted-history-view-model'
import { isCopilotConnectableState } from './copilot-panel-diagnostics'
import type { CopilotModelGroup } from './model-picker'
import type { RuntimeThinkingCapability } from './thread-run-contract'
import type { CopilotBootstrapState, CopilotConnectableState } from './types'

import {
  usePersistedHistorySwitchLoadingGate,
  type PersistedHistoryViewState,
} from './useCopilotPanelHistoryLoadingGate'

const RETAINED_SESSION_COMPOSER_DISABLED_REASON = '正在切换话题，请稍候。'
const EMPTY_ASSISTANT_SESSION_CAPABILITIES: AssistantSessionShell['capabilities'] = {
  capabilitiesVersion: 'empty',
  allAvailableTools: [],
  recommendedToolsForAgent: [],
  defaultEnabledTools: [],
  toolSelectionMode: 'none',
}

export interface CopilotPanelShellProps {
  language?: string
  state: CopilotBootstrapState
  retrying: boolean
  onRetry: () => void
  selectedAgent: AgentType | null
  sessionShell: AssistantSessionShell | null
  directoryState: AssistantAgentDirectoryState
  sessionStatus: 'idle' | 'creating' | 'error'
  sessionError: string | null
  historyRestoreError?: string | null
  sessionHistory?: AssistantSessionHistoryState | null
  onRetrySessionHistory?: () => void
  onSelectSessionHistoryRun?: (runId: string | null) => void
  renderLoadingSkeleton?: boolean
  sendError: CopilotTransientErrorState | null
  modelGroups: CopilotModelGroup[]
  thinkingCapability: RuntimeThinkingCapability | null
  composerDraft: CopilotChatComposerDraft
  composerAttachments?: CopilotComposerAttachmentsState
  toolPermissionPolicy?: SettingsWorkspaceToolPermissionPolicyState | null
  onComposerDraftChange: Dispatch<SetStateAction<CopilotChatComposerDraft>>
  onComposerAttachmentsChange?: Dispatch<SetStateAction<CopilotComposerAttachmentsState>>
  onSend: (event: FormEvent<HTMLFormElement>) => void
  onSubmitInlineForm?: (input: {
    toolCallId: string
    formId: string
    summary: string
    structuredPayload: Record<string, unknown>
    values: Record<string, string | number | boolean>
  }) => Promise<void>
  onCancelCurrentRun: () => void
  onResolveToolApproval?: (input: {
    runId: string
    toolCallId: string
    decision: 'approved' | 'rejected'
  }) => Promise<void>
  runtimeUrl?: string | null
  sendStatus: 'idle' | 'sending'
  canCancelSend: boolean
  sendDisabledReason: string | null
  composerLockedReason?: string | null
  historyDrift: PersistedHistoryDriftSummary | null
  historyRebindAcknowledged: boolean
  onAcknowledgeHistoryRebind: () => void
  persistedSelectedRunConversationSource?: PersistedConversationSource
  persistedSelectedRunConversationPending?: boolean
  hasTransientConversation?: boolean
  conversation: CopilotMessageListItem[]
  assistantPlaceholder: CopilotAssistantPlaceholderState
  composerInputRef: RefObject<HTMLTextAreaElement>
  composerHeight: number
  onComposerResizeStart: (event: ReactMouseEvent<HTMLDivElement>) => void
}

type ConnectableCopilotPanelShellProps = Omit<CopilotPanelShellProps, 'state'> & {
  state: CopilotConnectableState
  persistedHistoryViewState: PersistedHistoryViewState
  composerInteractionLocked: boolean
  onOpenErrorDetail: (errorDetail: CopilotErrorDetailSource, trigger: HTMLButtonElement | null) => void
}

export function CopilotPanelShell(props: CopilotPanelShellProps) {
  const [selectedErrorDetail, setSelectedErrorDetail] = useState<ErrorDetailOverlayViewModel | null>(null)
  const errorDetailTriggerRef = useRef<HTMLButtonElement | null>(null)
  const retainedSessionShellRef = useRef<ConnectableCopilotPanelShellProps | null>(null)
  const rawPersistedHistoryViewState = resolvePersistedHistoryViewState(props.sessionHistory)
  const effectivePersistedHistoryViewState = resolveEffectivePersistedHistoryViewState({
    persistedHistoryViewState: rawPersistedHistoryViewState,
    hasTransientConversation: props.hasTransientConversation,
    persistedSelectedRunConversationPending: props.persistedSelectedRunConversationPending,
  })
  const persistedHistorySwitchGate = usePersistedHistorySwitchLoadingGate({
    sessionId: props.sessionShell?.sessionId ?? null,
    sessionHistory: props.sessionHistory,
    persistedHistoryViewState: effectivePersistedHistoryViewState,
  })

  useEffect(() => {
    if (!isCopilotConnectableState(props.state) || props.sessionShell === null) {
      setSelectedErrorDetail(null)
      errorDetailTriggerRef.current = null
    }
  }, [props.sessionShell, props.state])

  const handleOpenErrorDetail = (
    errorDetail: CopilotErrorDetailSource,
    trigger: HTMLButtonElement | null,
  ) => {
    errorDetailTriggerRef.current = trigger
    setSelectedErrorDetail(buildErrorDetailOverlayViewModel(errorDetail))
  }

  const handleCloseErrorDetail = () => {
    setSelectedErrorDetail(null)
    const trigger = errorDetailTriggerRef.current
    errorDetailTriggerRef.current = null

    if (trigger !== null) {
      requestAnimationFrame(() => {
        trigger.focus()
      })
    }
  }

  if (!isCopilotConnectableState(props.state)) {
    retainedSessionShellRef.current = null

    return (
      <CopilotRuntimeStateShell
        state={props.state}
        retrying={props.retrying}
        onRetry={props.onRetry}
      />
    )
  }

  const liveSessionShellProps: ConnectableCopilotPanelShellProps = {
    ...props,
    state: props.state,
    persistedHistoryViewState: persistedHistorySwitchGate.viewState,
    composerInteractionLocked: false,
    onOpenErrorDetail: handleOpenErrorDetail,
  }
  const renderedSessionShellProps = persistedHistorySwitchGate.isHoldingPreviousContent
    ? buildRetainedSessionShellProps({
        current: liveSessionShellProps,
        retained: retainedSessionShellRef.current,
      })
    : liveSessionShellProps

  updateRetainedSessionShellSnapshot({
    current: liveSessionShellProps,
    isHoldingPreviousContent: persistedHistorySwitchGate.isHoldingPreviousContent,
    retained: retainedSessionShellRef,
  })

  return (
    <>
      {renderSessionShell(renderedSessionShellProps)}
      <ErrorDetailOverlay
        viewModel={selectedErrorDetail}
        onClose={handleCloseErrorDetail}
      />
    </>
  )
}

function renderSessionShell(props: ConnectableCopilotPanelShellProps) {
  const hasAvailableModels = props.modelGroups.some((group) => group.models.length > 0)
  const copy = getCopilotChatCopy(props.language ?? 'zh-CN')

  if (
    props.sessionShell === null
    && (props.directoryState.status === 'loading' || props.directoryState.status === 'idle')
  ) {
    return (
      <section className="copilot-panel__card copilot-panel__card--notice" aria-live="polite">
        <p className="copilot-panel__eyebrow">{copy.panel.eyebrow}</p>
        <h2 className="copilot-panel__title">{copy.panel.loadingAgentsTitle}</h2>
        <p className="copilot-panel__description">
          {copy.panel.loadingAgentsDescription}
        </p>
      </section>
    )
  }

  if (props.directoryState.status === 'error') {
    return (
      <section className="copilot-panel__card copilot-panel__card--error" aria-live="assertive">
        <p className="copilot-panel__eyebrow">{copy.panel.eyebrow}</p>
        <h2 className="copilot-panel__title">{copy.panel.loadAgentsFailedTitle}</h2>
        <p className="copilot-panel__description">
          {copy.panel.loadAgentsFailedDescription}
        </p>
      </section>
    )
  }

  if (props.sessionShell === null) {
    return renderSessionPlaceholder(props, copy)
  }

  return renderActiveSessionShell(props, copy, hasAvailableModels)
}

function renderSessionPlaceholder(props: ConnectableCopilotPanelShellProps, copy: ReturnType<typeof getCopilotChatCopy>) {
  if (props.selectedAgent === null) {
    return (
      <section className="copilot-panel__card copilot-panel__card--notice" aria-live="polite">
        <p className="copilot-panel__eyebrow">{copy.panel.eyebrow}</p>
        <h2 className="copilot-panel__title">{copy.panel.noAgentsTitle}</h2>
        <p className="copilot-panel__description">
          {copy.panel.noAgentsDescription}
        </p>
      </section>
    )
  }

  return (
    <section className="copilot-panel__inline-placeholder" aria-live="polite" data-testid="chat-session-placeholder">
      <p className="copilot-panel__inline-placeholder-text">{copy.panel.sessionPlaceholder}</p>
      {props.historyRestoreError !== null && props.historyRestoreError !== undefined && (
        <p className="copilot-panel__error" data-testid="chat-history-restore-error">
          历史话题恢复失败，稍后自动重试。
        </p>
      )}
      {props.sessionError !== null && (
        <p className="copilot-panel__error">{copy.panel.sessionCreateError}</p>
      )}
    </section>
  )
}

// eslint-disable-next-line complexity -- active shell rendering coordinates persisted-history gates and composer/message surfaces.
function renderActiveSessionShell(
  props: ConnectableCopilotPanelShellProps,
  copy: ReturnType<typeof getCopilotChatCopy>,
  hasAvailableModels: boolean,
): ReactNode {
  const shouldRenderSuppressedLoadingAsMessageSurface = props.persistedHistoryViewState === 'loading'
    && props.renderLoadingSkeleton === false
  const shouldRenderMessageSurface = props.persistedHistoryViewState === 'none'
    || props.persistedHistoryViewState === 'ready'
    || shouldRenderSuppressedLoadingAsMessageSurface
  const persistedHistoryTransitionKey = shouldRenderMessageSurface
    ? 'messages'
    : props.persistedHistoryViewState
  const persistedConversationSource = props.persistedSelectedRunConversationSource ?? 'none'

  return (
    <section className="copilot-chat-workspace" aria-live="polite" data-testid="chat-session-shell-ready">
      <section className="copilot-chat" data-testid="chat-send-shell">
        {props.historyRestoreError !== null && props.historyRestoreError !== undefined && renderHistoryRestoreNotice()}
        {props.sessionShell !== null && renderPersistedHistoryCapabilitiesNotice({
          sessionShell: props.sessionShell,
          sessionHistory: props.sessionHistory,
          onRetrySessionHistory: props.onRetrySessionHistory,
        })}
        {renderPersistedHistoryReplayNotice({
          sessionHistory: props.sessionHistory,
          selectedRunConversationSource: persistedConversationSource,
          onRetrySessionHistory: props.onRetrySessionHistory,
        })}
        {shouldRenderMessageSurface && props.historyDrift !== null && renderHistoryDriftNotice({
          historyDrift: props.historyDrift,
          acknowledged: props.historyRebindAcknowledged,
          onAcknowledge: props.onAcknowledgeHistoryRebind,
        })}
        {shouldRenderMessageSurface && renderPersistedHistoryRunSelector({
          sessionHistory: props.sessionHistory,
          onSelectSessionHistoryRun: props.onSelectSessionHistoryRun,
        })}
        <CrossFade transitionKey={persistedHistoryTransitionKey} className="copilot-chat-workspace__content">
          {props.persistedHistoryViewState === 'loading' && props.renderLoadingSkeleton !== false
            ? renderPersistedHistoryLoading()
            : props.persistedHistoryViewState === 'error'
              ? renderPersistedHistoryRetryPrompt(props.onRetrySessionHistory)
              : (
                  <CopilotMessagesShell
                    language={props.language}
                    conversation={props.conversation}
                    assistantPlaceholder={props.assistantPlaceholder}
                    models={props.modelGroups.flatMap((group) => group.models)}
                    transientError={props.sendError ?? createTransientSessionError(props.sessionError)}
                    runtimeUrl={props.runtimeUrl}
                    onSubmitInlineForm={props.onSubmitInlineForm}
                    onResolveToolApproval={props.onResolveToolApproval}
                    onOpenErrorDetail={props.onOpenErrorDetail}
                    emptyState={hasAvailableModels
                      ? null
                      : {
                          title: copy.panel.noModelTitle,
                          description: copy.panel.noModelDescription,
                        }}
                  />
                )}
        </CrossFade>
        <CopilotComposerShell
          language={props.language}
          capabilities={props.sessionShell?.capabilities ?? EMPTY_ASSISTANT_SESSION_CAPABILITIES}
          modelGroups={props.modelGroups}
          thinkingCapability={props.thinkingCapability}
          draft={props.composerDraft}
          attachments={props.composerAttachments}
          toolPermissionPolicy={props.toolPermissionPolicy}
          onDraftChange={props.onComposerDraftChange}
          onAttachmentsChange={props.onComposerAttachmentsChange}
          onSubmit={props.onSend}
          onCancel={props.onCancelCurrentRun}
          sendStatus={props.sendStatus}
          canCancel={props.canCancelSend}
          sendDisabledReason={props.sendDisabledReason}
          controlsLockedReason={props.composerLockedReason}
          interactionLocked={props.composerInteractionLocked}
          composerInputRef={props.composerInputRef}
          composerHeight={props.composerHeight}
          onResizeStart={props.onComposerResizeStart}
        />
      </section>
    </section>
  )
}

function resolveEffectivePersistedHistoryViewState(input: {
  persistedHistoryViewState: PersistedHistoryViewState
  hasTransientConversation?: boolean
  persistedSelectedRunConversationPending?: boolean
}): PersistedHistoryViewState {
  if (input.hasTransientConversation === true && input.persistedHistoryViewState !== 'ready') {
    return 'none'
  }

  if (
    input.persistedSelectedRunConversationPending === true
    && input.persistedHistoryViewState === 'ready'
  ) {
    return 'none'
  }

  return input.persistedHistoryViewState
}

function buildRetainedSessionShellProps(input: {
  current: ConnectableCopilotPanelShellProps
  retained: ConnectableCopilotPanelShellProps | null
}): ConnectableCopilotPanelShellProps {
  const baseProps = input.retained ?? input.current

  return {
    ...baseProps,
    sendStatus: 'idle',
    canCancelSend: false,
    sendDisabledReason: RETAINED_SESSION_COMPOSER_DISABLED_REASON,
    composerInteractionLocked: true,
  }
}

function updateRetainedSessionShellSnapshot(input: {
  current: ConnectableCopilotPanelShellProps
  isHoldingPreviousContent: boolean
  retained: MutableRefObject<ConnectableCopilotPanelShellProps | null>
}) {
  if (input.isHoldingPreviousContent) {
    return
  }

  if (shouldRetainSessionShellSnapshot(input.current)) {
    input.retained.current = input.current
    return
  }

  if (shouldClearRetainedSessionShellSnapshot(input.current)) {
    input.retained.current = null
  }
}

function shouldRetainSessionShellSnapshot(props: ConnectableCopilotPanelShellProps): boolean {
  return props.sessionShell !== null
    && (props.persistedHistoryViewState === 'none' || props.persistedHistoryViewState === 'ready')
}

function shouldClearRetainedSessionShellSnapshot(props: ConnectableCopilotPanelShellProps): boolean {
  return props.sessionShell === null
    || props.persistedHistoryViewState === 'loading'
    || props.persistedHistoryViewState === 'error'
}

function resolvePersistedHistoryViewState(
  sessionHistory: AssistantSessionHistoryState | null | undefined,
): PersistedHistoryViewState {
  if (
    sessionHistory === null
    || sessionHistory === undefined
    || sessionHistory.isPersistedThread !== true
  ) {
    return 'none'
  }

  if (sessionHistory.detailStatus === 'ready' || sessionHistory.hasLoadedDetail === true) {
    return 'ready'
  }

  return sessionHistory.detailStatus === 'error' ? 'error' : 'loading'
}

function renderPersistedHistoryLoading() {
  return (
    <section
      className="copilot-panel__history-placeholder"
      aria-label="正在加载历史消息"
      data-testid="chat-history-loading-skeleton"
    >
      <div className="copilot-panel__history-top-bar-skeleton" />
      <div className="copilot-panel__history-message-list-skeleton">
        {/* User message skeleton */}
        <div className="copilot-panel__history-message-skeleton copilot-panel__history-message-skeleton--user">
          <div className="copilot-panel__history-skeleton-bubble">
            <span className="copilot-panel__history-skeleton-line copilot-panel__history-skeleton-line--full" />
            <span className="copilot-panel__history-skeleton-line copilot-panel__history-skeleton-line--short" />
          </div>
        </div>
        {/* Assistant message skeleton */}
        <div className="copilot-panel__history-message-skeleton copilot-panel__history-message-skeleton--assistant">
          <div className="copilot-panel__history-skeleton-bubble">
            <span className="copilot-panel__history-skeleton-line copilot-panel__history-skeleton-line--full" />
            <span className="copilot-panel__history-skeleton-line copilot-panel__history-skeleton-line--full" />
            <span className="copilot-panel__history-skeleton-line copilot-panel__history-skeleton-line--medium" />
          </div>
        </div>
        {/* User message skeleton */}
        <div className="copilot-panel__history-message-skeleton copilot-panel__history-message-skeleton--user">
          <div className="copilot-panel__history-skeleton-bubble">
            <span className="copilot-panel__history-skeleton-line copilot-panel__history-skeleton-line--medium" />
          </div>
        </div>
        {/* Assistant message skeleton (long) */}
        <div className="copilot-panel__history-message-skeleton copilot-panel__history-message-skeleton--assistant">
          <div className="copilot-panel__history-skeleton-bubble">
            <span className="copilot-panel__history-skeleton-line copilot-panel__history-skeleton-line--full" />
            <span className="copilot-panel__history-skeleton-line copilot-panel__history-skeleton-line--full" />
            <span className="copilot-panel__history-skeleton-line copilot-panel__history-skeleton-line--full" />
            <span className="copilot-panel__history-skeleton-line copilot-panel__history-skeleton-line--short" />
          </div>
        </div>
      </div>
    </section>
  )
}

function renderHistoryRestoreNotice() {
  return (
    <section
      className="copilot-panel__card copilot-panel__card--notice copilot-panel__enter--delay-1"
      aria-live="polite"
      data-testid="chat-history-restore-error"
    >
      <p className="copilot-panel__eyebrow">历史恢复</p>
      <p className="copilot-panel__description">历史话题恢复失败，稍后自动重试。</p>
    </section>
  )
}

function renderPersistedHistoryCapabilitiesNotice(input: {
  sessionShell: AssistantSessionShell
  sessionHistory: AssistantSessionHistoryState | null | undefined
  onRetrySessionHistory?: () => void
}) {
  if (input.sessionShell.capabilities.capabilitiesVersion !== 'history-shell') {
    return null
  }

  const capabilitiesStatus = input.sessionHistory?.capabilitiesStatus ?? 'ready'
  if (capabilitiesStatus !== 'error') {
    return null
  }

  return (
    <section
      className="copilot-panel__card copilot-panel__card--error copilot-panel__enter--delay-1"
      aria-live="polite"
      data-testid="chat-history-capabilities-error"
    >
      <p className="copilot-panel__eyebrow">历史能力</p>
      <p className="copilot-panel__description">历史线程能力恢复失败，请重试后再继续发送。</p>
      <button
        type="button"
        className="copilot-panel__history-retry"
        data-testid="chat-history-capabilities-retry-button"
        disabled={input.onRetrySessionHistory === undefined}
        onClick={() => {
          input.onRetrySessionHistory?.()
        }}
      >
        重试恢复历史能力
      </button>
    </section>
  )
}

function renderPersistedHistoryReplayNotice(input: {
  sessionHistory: AssistantSessionHistoryState | null | undefined
  selectedRunConversationSource: PersistedConversationSource
  onRetrySessionHistory?: () => void
}) {
  if (
    input.sessionHistory === null
    || input.sessionHistory === undefined
    || input.sessionHistory.isPersistedThread !== true
    || input.sessionHistory.selectedRunId === null
    || input.sessionHistory.replayStatus !== 'error'
  ) {
    return null
  }

  const description = input.selectedRunConversationSource === 'timeline'
    ? '当前运行回放失败，当前展示的是时间线快照。'
    : '当前运行回放失败，请重试恢复该运行的历史回放。'

  return (
    <section
      className="copilot-panel__card copilot-panel__card--notice copilot-panel__enter--delay-1"
      aria-live="polite"
      data-testid="chat-history-replay-error"
    >
      <p className="copilot-panel__eyebrow">历史运行</p>
      <p className="copilot-panel__description">{description}</p>
      <button
        type="button"
        className="copilot-panel__history-retry"
        data-testid="chat-history-replay-retry-button"
        disabled={input.onRetrySessionHistory === undefined}
        onClick={() => {
          input.onRetrySessionHistory?.()
        }}
      >
        重试恢复当前运行
      </button>
    </section>
  )
}

function renderPersistedHistoryRetryPrompt(onRetrySessionHistory?: () => void) {
  return (
    <button
      type="button"
      className="copilot-panel__history-retry"
      data-testid="chat-history-retry-button"
      disabled={onRetrySessionHistory === undefined}
      onClick={() => {
        onRetrySessionHistory?.()
      }}
    >
      历史消息加载失败，点击重试
    </button>
  )
}

function renderPersistedHistoryRunSelector(input: {
  sessionHistory: AssistantSessionHistoryState | null | undefined
  onSelectSessionHistoryRun?: (runId: string | null) => void
}) {
  const sessionHistory = input.sessionHistory
  if (
    sessionHistory === null
    || sessionHistory === undefined
    || sessionHistory.selectedRunId === null
    || sessionHistory.runSummaries.length < 2
    || (sessionHistory.detailStatus !== 'ready' && sessionHistory.hasLoadedDetail !== true)
  ) {
    return null
  }

  return (
    <label className="copilot-panel__description copilot-panel__enter--delay-1" data-testid="chat-history-run-selector-label">
      <span>查看运行版本</span>
      <select
        data-testid="chat-history-run-selector"
        value={sessionHistory.selectedRunId ?? ''}
        disabled={input.onSelectSessionHistoryRun === undefined}
        onChange={(event) => {
          input.onSelectSessionHistoryRun?.(event.target.value === '' ? null : event.target.value)
        }}
      >
        {sessionHistory.runSummaries.map((runSummary, index) => (
          <option key={runSummary.runId} value={runSummary.runId}>
            {formatPersistedHistoryRunOptionLabel(runSummary, index)}
          </option>
        ))}
      </select>
    </label>
  )
}

function formatPersistedHistoryRunOptionLabel(
  runSummary: AssistantSessionHistoryState['runSummaries'][number],
  index: number,
): string {
  const statusLabel = runSummary.status.trim() === '' ? 'unknown' : runSummary.status
  const modelLabel = runSummary.resolvedModelId?.trim() ?? ''
  const assistantPreview = runSummary.assistantText?.trim() ?? ''
  const previewLabel = assistantPreview === '' ? '' : ` · ${assistantPreview.slice(0, 18)}`

  return `#${index + 1} · ${statusLabel}${modelLabel === '' ? '' : ` · ${modelLabel}`}${previewLabel}`
}

function renderHistoryDriftNotice(input: {
  historyDrift: PersistedHistoryDriftSummary
  acknowledged: boolean
  onAcknowledge: () => void
}) {
  const historicalFacts = [
    input.historyDrift.historicalModelId === null
      ? null
      : { label: '历史模型', value: input.historyDrift.historicalModelId },
    input.historyDrift.historicalToolIds.length === 0
      ? null
      : { label: '历史工具', value: input.historyDrift.historicalToolIds.join('、') },
    input.historyDrift.historicalThinkingSummary === null
      ? null
      : { label: '历史思考', value: input.historyDrift.historicalThinkingSummary },
  ].filter((value): value is { label: string; value: string } => value !== null)
  const title = input.historyDrift.warnings.length > 0
    ? '当前配置与历史线程存在差异'
    : '历史运行快照'

  return (
    <section
      className="copilot-panel__card copilot-panel__card--notice copilot-panel__enter--delay-1"
      aria-live="polite"
      data-testid="chat-history-drift-notice"
    >
      <p className="copilot-panel__eyebrow">历史快照</p>
      <h2 className="copilot-panel__title">{title}</h2>
      <p className="copilot-panel__description">以下值来自历史快照，不会被当前配置改写。</p>
      {historicalFacts.length > 0 && (
        <div className="copilot-chat__message-detail-list">
          {historicalFacts.map((fact) => (
            <p key={fact.label} className="copilot-chat__message-detail copilot-chat__message-detail--meta">
              <span className="copilot-chat__message-detail-label">{fact.label}</span>
              <span>{fact.value}</span>
            </p>
          ))}
        </div>
      )}
      {input.historyDrift.warnings.length > 0 && (
        <>
          <p className="copilot-panel__description">当前可用性提示</p>
          <ul data-testid="chat-history-drift-warning-list">
            {input.historyDrift.warnings.map((warning) => (
              <li key={warning.code}>{warning.message}</li>
            ))}
          </ul>
        </>
      )}
      {input.historyDrift.requiresExplicitRebind && (
        <>
          <p className="copilot-panel__description">
            继续对话前需显式确认按当前选择的模型、工具与思考配置重新绑定。
          </p>
          <button
            type="button"
            className="copilot-model-picker__trigger"
            data-testid="chat-history-rebind-button"
            disabled={input.acknowledged}
            onClick={input.onAcknowledge}
          >
            {input.acknowledged ? '已确认按当前配置继续' : '按当前配置重新绑定'}
          </button>
        </>
      )}
    </section>
  )
}

function createTransientSessionError(sessionError: string | null): CopilotTransientErrorState | null {
  const trimmedSessionError = sessionError?.trim() ?? ''

  return trimmedSessionError === ''
    ? null
    : createCopilotTransientErrorState({
        message: trimmedSessionError,
      })
}

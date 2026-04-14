import { CopilotPanelShell } from '../CopilotPanelShell'
import {
  useCopilotChatPanelState,
  type CopilotChatPanelShellProps,
} from '../state/useCopilotChatPanelState'
import '../copilot.css'

export type { CopilotChatPanelShellProps }

export function CopilotChatPanelShell(props: CopilotChatPanelShellProps) {
  const panelState = useCopilotChatPanelState(props)

  return (
    <section className="copilot-panel" data-testid="copilot-chat-panel">
      <CopilotPanelShell
        state={props.state}
        retrying={props.retrying}
        onRetry={props.retry}
        selectedAgent={props.selectedAgent}
        sessionShell={props.sessionShell}
        directoryState={props.directoryState}
        sessionStatus={props.sessionStatus}
        sessionError={props.sessionError}
        sessionHistory={props.sessionHistory ?? null}
        onRetrySessionHistory={props.retrySessionHistory}
        onSelectSessionHistoryRun={props.selectSessionHistoryRun}
        {...panelState}
      />
    </section>
  )
}

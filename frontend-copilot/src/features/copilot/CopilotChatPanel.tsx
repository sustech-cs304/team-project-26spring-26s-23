import { useEffect, useState } from 'react'

import { loadCopilotConfigState } from './config'
import { NotConnectedNotice } from './components/NotConnectedNotice'
import type { CopilotConfigState } from './types'
import './copilot.css'

type CopilotPanelState = CopilotConfigState | { status: 'loading' }

const statusLabels: Record<CopilotPanelState['status'], string> = {
  loading: '读取中',
  empty: '未连接',
  incomplete: '配置不完整',
  ready: '骨架就绪',
  error: '读取失败',
}

export function CopilotChatPanel() {
  const [state, setState] = useState<CopilotPanelState>({ status: 'loading' })

  useEffect(() => {
    let disposed = false

    const readConfigState = async () => {
      try {
        const nextState = await loadCopilotConfigState()

        if (!disposed) {
          setState(nextState)
        }
      } catch (error) {
        if (!disposed) {
          setState({
            status: 'error',
            error: error instanceof Error ? error.message : 'Unknown copilot settings read failure.',
          })
        }
      }
    }

    void readConfigState()

    return () => {
      disposed = true
    }
  }, [])

  return (
    <section className="copilot-panel">
      <header className="copilot-panel__header">
        <div>
          <p className="copilot-panel__eyebrow">Copilot Feature</p>
          <h1 className="copilot-panel__heading">聊天面板骨架</h1>
        </div>
        <span className={`copilot-panel__status copilot-panel__status--${state.status}`}>
          {statusLabels[state.status]}
        </span>
      </header>

      {renderCopilotPanelContent(state)}
    </section>
  )
}

function renderCopilotPanelContent(state: CopilotPanelState) {
  switch (state.status) {
    case 'loading':
      return (
        <section className="copilot-panel__card" aria-live="polite">
          <p className="copilot-panel__eyebrow">Copilot</p>
          <h2 className="copilot-panel__title">正在读取 Copilot 配置</h2>
          <p className="copilot-panel__description">
            Renderer 正在通过预加载层读取桌面端保存的 Copilot 配置。
          </p>
        </section>
      )

    case 'empty':
      return (
        <NotConnectedNotice description="尚未检测到 runtime URL 与 agent 名称。请先在桌面端设置中完成配置后，再进行后端智能体联调。" />
      )

    case 'incomplete':
      return (
        <NotConnectedNotice
          description="已检测到部分 Copilot 配置，但 runtime URL 与 agent 名称尚未填写完整，因此当前仍未连接后端智能体。"
          missingFields={state.missingFields}
        />
      )

    case 'error':
      return (
        <section className="copilot-panel__card copilot-panel__card--error" aria-live="assertive">
          <p className="copilot-panel__eyebrow">Copilot</p>
          <h2 className="copilot-panel__title">读取 Copilot 配置失败</h2>
          <p className="copilot-panel__description">
            当前无法从 Electron 设置层读取 Copilot 配置。该状态与“尚未连接后端智能体”的未配置态不同，需优先检查设置读取链路。
          </p>
          <pre className="copilot-panel__error">{state.error}</pre>
        </section>
      )

    case 'ready':
      return (
        <section className="copilot-panel__card copilot-panel__card--ready" aria-live="polite">
          <p className="copilot-panel__eyebrow">Copilot</p>
          <h2 className="copilot-panel__title">聊天面板骨架已就绪</h2>
          <p className="copilot-panel__description">
            已读取到完整的 runtime URL 与 agent 名称。当前阶段仅提供 Renderer 侧骨架，不会注入真实 Copilot runtime，也不会连接本地占位服务。
          </p>
          <dl className="copilot-panel__details-grid">
            <div>
              <dt>Runtime URL</dt>
              <dd>{state.runtimeUrl}</dd>
            </div>
            <div>
              <dt>Agent 名称</dt>
              <dd>{state.agentName}</dd>
            </div>
            <div>
              <dt>存储状态</dt>
              <dd>{state.storageState}</dd>
            </div>
          </dl>
          <div className="copilot-panel__placeholder">
            <p className="copilot-panel__placeholder-label">后续接入占位</p>
            <p className="copilot-panel__placeholder-text">
              真实对话区将在后续 Provider 注入与 runtime 集成阶段接入；本组件当前只负责配置态分支与承载骨架。
            </p>
          </div>
        </section>
      )
  }
}

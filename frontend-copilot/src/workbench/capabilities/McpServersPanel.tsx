import { useRef } from 'react'
import { LoaderCircle, Trash2 } from 'lucide-react'

import { useStaggerListEnter } from '../animation-utils'
import type { McpRegistryServerViewModel } from './mcp-registry-view-model'
import { resolveMcpConnectionStateLabel } from './mcp-registry-view-model'

interface McpServersPanelProps {
  servers: readonly McpRegistryServerViewModel[]
  statusMessage?: string | null
  onToggleEnabled: (serverId: string) => void | Promise<void>
  onDelete: (serverId: string) => void | Promise<void>
  onTestConnection: (serverId: string) => void | Promise<void>
}

export function McpServersPanel({
  servers,
  statusMessage,
  onToggleEnabled,
  onDelete,
  onTestConnection,
}: McpServersPanelProps) {
  const listRef = useRef<HTMLDivElement>(null)
  useStaggerListEnter({ scope: listRef, selector: '.mcp-server-row:not(.mcp-server-row--empty)' })

  return (
    <section className="capabilities-surface capabilities-surface--mcp">
      {statusMessage ? (
        <p className="capabilities-surface__status" aria-live="polite">{statusMessage}</p>
      ) : null}

      <div className="mcp-server-list" ref={listRef}>
        {servers.length === 0 ? (
          <article className="mcp-server-row mcp-server-row--empty">
            <div className="mcp-server-row__meta">
              <h3 className="mcp-server-row__title">还没有可用的服务器</h3>
              <p className="mcp-server-row__description">点击右上角“新增 MCP 服务器”，手动填写，或从已有配置直接导入。</p>
            </div>
          </article>
        ) : null}

        {servers.map((server) => (
          <article
            key={server.serverId}
            className={`mcp-server-row mcp-server-row--${server.connectionState}${server.busy ? ' mcp-server-row--busy' : ''}`}
          >
            <div className="mcp-server-row__meta">
              <div className="mcp-server-row__title-line">
                <h3 className="mcp-server-row__title">{server.displayName}</h3>
                <span className={`mcp-server-status mcp-server-status--${server.connectionState}`}>
                  <span className="mcp-server-status__dot" />
                  {resolveMcpConnectionStateLabel(server.connectionState)}
                </span>
                {server.activityLabel ? (
                  <span className="mcp-server-activity" aria-live="polite">
                    <LoaderCircle size={14} className="mcp-server-activity__icon" />
                    {server.activityLabel}
                  </span>
                ) : null}
              </div>

              <p className="mcp-server-row__description">{server.description}</p>
            </div>

            <dl className="mcp-server-row__details">
              <div className="mcp-server-row__detail mcp-server-row__detail--transport">
                <dt>传输方式</dt>
                <dd>{server.transportLabel}</dd>
              </div>
              <div className="mcp-server-row__detail mcp-server-row__detail--endpoint">
                <dt>连接地址</dt>
                <dd title={server.endpoint}>{server.endpoint}</dd>
              </div>
              <div className="mcp-server-row__detail mcp-server-row__detail--tool-count">
                <dt>工具数量</dt>
                <dd>{server.toolCount}</dd>
              </div>
              <div className="mcp-server-row__detail">
                <dt>最近握手</dt>
                <dd>{server.lastHandshakeAtLabel ?? '尚未完成'}</dd>
              </div>
            </dl>

            <div className="mcp-server-row__actions">
              <button
                type="button"
                className="secondary-button secondary-button--subtle"
                aria-label={`测试 ${server.displayName}`}
                title={`测试 ${server.displayName}`}
                disabled={server.busy}
                onClick={() => void onTestConnection(server.serverId)}
              >
                测试连接
              </button>

              <button
                type="button"
                className={`mcp-server-toggle${server.enabled ? ' mcp-server-toggle--on' : ''}`}
                aria-label={server.enabled ? `关闭 ${server.displayName}` : `开启 ${server.displayName}`}
                title={server.enabled ? `关闭 ${server.displayName}` : `开启 ${server.displayName}`}
                disabled={server.busy}
                onClick={() => void onToggleEnabled(server.serverId)}
              >
                <span className="mcp-server-toggle__track">
                  <span className="mcp-server-toggle__thumb" />
                </span>
              </button>

              <button
                type="button"
                className="mcp-server-action-icon"
                aria-label={`删除 ${server.displayName}`}
                title={`删除 ${server.displayName}`}
                disabled={server.busy}
                onClick={() => void onDelete(server.serverId)}
              >
                <Trash2 size={16} />
              </button>
            </div>

            {server.message ? (
              <p
                className={`mcp-server-row__message mcp-server-row__message--${server.messageTone}`}
                aria-live="polite"
              >
                {resolveMessagePrefix(server.messageTone)}{server.message}
              </p>
            ) : null}
          </article>
        ))}
      </div>
    </section>
  )
}

function resolveMessagePrefix(tone: McpRegistryServerViewModel['messageTone']): string {
  switch (tone) {
    case 'success':
      return '成功：'
    case 'warning':
      return '注意：'
    case 'error':
      return '失败：'
    case 'info':
    default:
      return '状态：'
  }
}

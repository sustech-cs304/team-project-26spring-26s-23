import { Trash2 } from 'lucide-react'

import type { McpServerRecord } from './capabilities-demo'
import { resolveMcpStatusLabel } from './capabilities-demo'

interface McpServersPanelProps {
  servers: readonly McpServerRecord[]
  onToggleEnabled: (serverId: string) => void
  onDelete: (serverId: string) => void
}

export function McpServersPanel({ servers, onToggleEnabled, onDelete }: McpServersPanelProps) {
  return (
    <section className="capabilities-surface capabilities-surface--mcp">
      <div className="mcp-server-list">
        {servers.map((server) => (
          <article key={server.id} className="mcp-server-row">
            <div className="mcp-server-row__meta">
              <div className="mcp-server-row__title-line">
                <h3 className="mcp-server-row__title">{server.name}</h3>
                <span className={`mcp-server-status mcp-server-status--${server.status}`}>
                  <span className="mcp-server-status__dot" />
                  {resolveMcpStatusLabel(server.status)}
                </span>
              </div>

              <p className="mcp-server-row__description">{server.description}</p>
            </div>

            <dl className="mcp-server-row__details">
              <div className="mcp-server-row__detail mcp-server-row__detail--transport">
                <dt>传输方式</dt>
                <dd>{server.transport}</dd>
              </div>
              <div className="mcp-server-row__detail mcp-server-row__detail--endpoint">
                <dt>连接地址</dt>
                <dd title={server.endpoint}>{server.endpoint}</dd>
              </div>
            </dl>

            <div className="mcp-server-row__actions">
              <button
                type="button"
                className={`mcp-server-toggle${server.enabled ? ' mcp-server-toggle--on' : ''}`}
                aria-label={server.enabled ? `关闭 ${server.name}` : `开启 ${server.name}`}
                title={server.enabled ? `关闭 ${server.name}` : `开启 ${server.name}`}
                onClick={() => onToggleEnabled(server.id)}
              >
                <span className="mcp-server-toggle__track">
                  <span className="mcp-server-toggle__thumb" />
                </span>
              </button>

              <button
                type="button"
                className="mcp-server-action-icon"
                aria-label={`删除 ${server.name}`}
                title={`删除 ${server.name}`}
                onClick={() => onDelete(server.id)}
              >
                <Trash2 size={16} />
              </button>
            </div>
          </article>
        ))}
      </div>
    </section>
  )
}

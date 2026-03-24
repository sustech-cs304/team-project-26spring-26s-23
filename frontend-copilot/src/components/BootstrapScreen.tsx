import type { ReactNode } from 'react'

export type BootstrapScreenTone = 'info' | 'warning' | 'error'
export const BOOTSTRAP_PREPARING_MESSAGE = '正在准备桌面界面…'
export const BOOTSTRAP_CONNECTING_MESSAGE = '正在连接本地服务…'

export type BootstrapScreenLoadingMessage =
  | typeof BOOTSTRAP_PREPARING_MESSAGE
  | typeof BOOTSTRAP_CONNECTING_MESSAGE

export interface BootstrapScreenAction {
  label: string
  onClick: () => void
  disabled?: boolean
  emphasis?: 'primary' | 'secondary'
}

type BootstrapScreenProps =
  | {
    message: BootstrapScreenLoadingMessage
  }
  | {
    eyebrow?: string
    title: string
    description: string
    tone?: BootstrapScreenTone
    details?: ReactNode
    actions?: BootstrapScreenAction[]
  }

export function BootstrapScreen(props: BootstrapScreenProps) {
  if ('message' in props) {
    return (
      <main className="startup-shell startup-shell--loading" aria-live="polite">
        <div className="startup-loading" role="status" aria-label={props.message}>
          <span className="startup-loading__spinner" aria-hidden="true" />
          <p className="startup-loading__message">{props.message}</p>
        </div>
      </main>
    )
  }

  const {
    eyebrow = 'Copilot',
    title,
    description,
    tone = 'info',
    details = null,
    actions = [],
  } = props

  return (
    <main className="startup-shell">
      <section
        className={`startup-shell__card startup-shell__card--${tone}`}
        aria-live={tone === 'error' ? 'assertive' : 'polite'}
      >
        <p className="startup-shell__eyebrow">{eyebrow}</p>
        <h1 className="startup-shell__title">{title}</h1>
        <p className="startup-shell__description">{description}</p>

        {details ? <div className="startup-shell__details">{details}</div> : null}

        {actions.length > 0 && (
          <div className="startup-shell__actions">
            {actions.map((action) => (
              <button
                key={action.label}
                type="button"
                className={`startup-shell__button${
                  action.emphasis === 'secondary' ? ' startup-shell__button--secondary' : ''
                }`}
                onClick={action.onClick}
                disabled={action.disabled}
              >
                {action.label}
              </button>
            ))}
          </div>
        )}
      </section>
    </main>
  )
}

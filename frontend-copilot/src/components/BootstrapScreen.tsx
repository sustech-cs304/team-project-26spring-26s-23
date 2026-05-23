import { type ReactNode, useRef } from 'react'
import { useGSAP, gsap } from '../workbench/animation-utils'

export type BootstrapScreenTone = 'info' | 'warning' | 'error'
export const BOOTSTRAP_PREPARING_MESSAGE = '正在加载应用…'
export const BOOTSTRAP_CONNECTING_MESSAGE = '正在连接服务…'

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
  const spinnerRef = useRef<HTMLDivElement>(null)

  useGSAP(() => {
    if (!spinnerRef.current) return
    gsap.from(spinnerRef.current, { scale: 0.8, opacity: 0, duration: 0.4, ease: 'back.out(1.7)' })
    gsap.from('.startup-loading__message', { y: 8, opacity: 0, duration: 0.35, delay: 0.15, ease: 'power2.out' })
  }, { scope: spinnerRef })

  if ('message' in props) {
    return (
      <main className="startup-shell startup-shell--loading" aria-live="polite">
        <div ref={spinnerRef} className="startup-loading" role="status" aria-label={props.message}>
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

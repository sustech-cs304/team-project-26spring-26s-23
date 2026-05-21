/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./startup-tracing', () => ({
  logCopilotRootStartupTrace: vi.fn(),
  formatErrorMessage: (error: unknown) =>
    error instanceof Error ? error.message : String(error),
}))

type LazyBehavior = {
  shouldThrow?: Error
  text?: string
  bootstrapStatus?: string
}

const lazyBehavior: { current: LazyBehavior } = { current: {} }

vi.mock('./bootstrap-cache', () => ({
  LazyApp: ({ bootstrap }: { bootstrap?: unknown }) => {
    if (lazyBehavior.current.shouldThrow) {
      throw lazyBehavior.current.shouldThrow
    }
    const text = lazyBehavior.current.text ?? 'LazyApp'
    const status = lazyBehavior.current.bootstrapStatus
      ?? String((bootstrap as { state?: { status?: string } } | undefined)?.state?.status ?? 'none')
    return (
      <div data-testid="lazy-app">
        {text}
        <span data-testid="bootstrap-status">{status}</span>
      </div>
    )
  },
  loadWorkbenchApp: vi.fn(),
  loadInitialConfigState: vi.fn(),
  rememberCopilotBootstrapState: vi.fn(),
}))

import { CopilotAppRootBoundary } from './bootstrap-boundary'
import type { CopilotBootstrapController } from '../features/copilot/types'

function createMockController(
  overrides: Partial<CopilotBootstrapController> = {},
): CopilotBootstrapController {
  return {
    state: { status: 'loading' },
    retrying: false,
    retry: vi.fn(),
    ...overrides,
  }
}

describe('CopilotAppRootBoundary', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    lazyBehavior.current = {}
  })

  afterEach(() => {
    cleanup()
  })

  describe('normal rendering', () => {
    it('renders LazyApp inside Suspense when no error occurs', () => {
      render(
        <CopilotAppRootBoundary
          bootstrap={createMockController({ state: { status: 'ready' } as any })}
          configStatus="ready"
          retrying={false}
          onRetryConfig={vi.fn()}
        />,
      )

      expect(screen.getByTestId('lazy-app')).toBeDefined()
    })

    it('passes bootstrap controller to LazyApp', () => {
      lazyBehavior.current.bootstrapStatus = 'ready'

      render(
        <CopilotAppRootBoundary
          bootstrap={createMockController({ state: { status: 'ready' } as any })}
          configStatus="ready"
          retrying={false}
          onRetryConfig={vi.fn()}
        />,
      )

      expect(screen.getByTestId('bootstrap-status').textContent).toBe('ready')
    })
  })

  describe('error boundary', () => {
    it('shows error UI when LazyApp throws during render', () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      lazyBehavior.current.shouldThrow = new Error('render failure')

      render(
        <CopilotAppRootBoundary
          bootstrap={createMockController()}
          configStatus="ready"
          retrying={false}
          onRetryConfig={vi.fn()}
        />,
      )

      expect(screen.getByText('界面加载失败')).toBeDefined()
      expect(screen.getByText('应用界面渲染时出现错误，请尝试重试加载。')).toBeDefined()
      expect(screen.getByText('render failure')).toBeDefined()
      expect(screen.getByText('重试加载')).toBeDefined()

      consoleErrorSpy.mockRestore()
    })

    it('shows retry connection button when onRetryConfig is provided', () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      lazyBehavior.current.shouldThrow = new Error('fail')

      render(
        <CopilotAppRootBoundary
          bootstrap={createMockController()}
          configStatus="ready"
          retrying={false}
          onRetryConfig={vi.fn()}
        />,
      )

      expect(screen.getByText('重新连接服务')).toBeDefined()

      consoleErrorSpy.mockRestore()
    })

    it('disables retry connection button when retrying is true', () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      lazyBehavior.current.shouldThrow = new Error('fail')

      render(
        <CopilotAppRootBoundary
          bootstrap={createMockController({ retrying: true })}
          configStatus="ready"
          retrying={true}
          onRetryConfig={vi.fn()}
        />,
      )

      const retryButton = screen.getByText('正在重试连接…')
      expect((retryButton as HTMLButtonElement).disabled).toBe(true)

      consoleErrorSpy.mockRestore()
    })

    it('renders children normally when no error is thrown', () => {
      lazyBehavior.current.text = 'Safe Content'

      render(
        <CopilotAppRootBoundary
          bootstrap={createMockController({ state: { status: 'ready' } as any })}
          configStatus="ready"
          retrying={false}
          onRetryConfig={vi.fn()}
        />,
      )

      expect(screen.getByText('Safe Content')).toBeDefined()
    })
  })

  describe('retry button (reset)', () => {
    it('resets error boundary when retry button is clicked', () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      let shouldThrow = true
      function TestWithToggle() {
        const [_trigger, setTrigger] = useState(0)

        lazyBehavior.current = {
          shouldThrow: shouldThrow ? new Error('test failure') : undefined,
          text: 'Recovered',
        }

        return (
          <div>
            <CopilotAppRootBoundary
              bootstrap={createMockController()}
              configStatus="ready"
              retrying={false}
              onRetryConfig={vi.fn()}
            />
            <button
              type="button"
              data-testid="fix-error"
              onClick={() => {
                shouldThrow = false
                setTrigger((t) => t + 1)
              }}
            >
              Fix Error
            </button>
          </div>
        )
      }

      render(<TestWithToggle />)

      expect(screen.getByText('test failure')).toBeDefined()

      fireEvent.click(screen.getByTestId('fix-error'))
      fireEvent.click(screen.getByText('重试加载'))

      expect(screen.getByText('Recovered')).toBeDefined()

      consoleErrorSpy.mockRestore()
    })

    it('calls onRetryConfig when reconnect button is clicked', () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      const onRetryConfig = vi.fn()
      lazyBehavior.current.shouldThrow = new Error('fail')

      render(
        <CopilotAppRootBoundary
          bootstrap={createMockController()}
          configStatus="ready"
          retrying={false}
          onRetryConfig={onRetryConfig}
        />,
      )

      fireEvent.click(screen.getByText('重新连接服务'))
      expect(onRetryConfig).toHaveBeenCalledOnce()

      consoleErrorSpy.mockRestore()
    })
  })

  describe('resetKeys', () => {
    it('auto-resets error boundary when configStatus resetKey changes', () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      function TestResetKeys() {
        const [configStatus, setConfigStatus] = useState<string>('error')

        lazyBehavior.current = {
          shouldThrow: configStatus === 'error' ? new Error('status error') : undefined,
          text: 'Healed',
        }

        return (
          <div>
            <button
              type="button"
              data-testid="change-status"
              onClick={() => setConfigStatus('ready')}
            >
              Change
            </button>
            <CopilotAppRootBoundary
              bootstrap={createMockController()}
              configStatus={configStatus as any}
              retrying={false}
              onRetryConfig={vi.fn()}
            />
          </div>
        )
      }

      render(<TestResetKeys />)

      expect(screen.getByText('status error')).toBeDefined()

      fireEvent.click(screen.getByTestId('change-status'))

      expect(screen.queryByText('status error')).toBeNull()
      expect(screen.getByText('Healed')).toBeDefined()

      consoleErrorSpy.mockRestore()
    })

    it('does not auto-reset when resetKeys reference is unchanged', () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      lazyBehavior.current.shouldThrow = new Error('persistent error')

      const configStatus = 'ready' as const

      render(
        <CopilotAppRootBoundary
          bootstrap={createMockController()}
          configStatus={configStatus}
          retrying={false}
          onRetryConfig={vi.fn()}
        />,
      )

      expect(screen.getByText('persistent error')).toBeDefined()

      consoleErrorSpy.mockRestore()
    })
  })
})

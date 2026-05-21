/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  useCopilotBootstrapState: vi.fn(),
  logCopilotRootStartupTrace: vi.fn(),
  formatErrorMessage: vi.fn(),
}))

vi.mock('./bootstrap-state', () => ({
  useCopilotBootstrapState: mocks.useCopilotBootstrapState,
}))

vi.mock('./startup-tracing', () => ({
  logCopilotRootStartupTrace: mocks.logCopilotRootStartupTrace,
  formatErrorMessage: mocks.formatErrorMessage,
}))

vi.mock('../components/DesktopChrome', () => ({
  DesktopChrome: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="desktop-chrome">{children}</div>
  ),
}))

import { CopilotAppRootShell } from './CopilotAppRootShell'
import { createReadyBootstrapState } from './bootstrap-test-support'
import type { CopilotBootstrapController, CopilotBootstrapState } from '../features/copilot/types'

const LABEL_HTTP_LOCALHOST_4400 = 'http://localhost:4400'

function createBootstrapHookResult(overrides: {
  bootstrap?: Partial<CopilotBootstrapController>
  configState?: CopilotBootstrapState
  retrying?: boolean
  handleRetryConfig?: () => void
} = {}) {
  const readyState = createReadyBootstrapState({
    runtimeUrl: LABEL_HTTP_LOCALHOST_4400,
    agentName: 'planner',
  })

  return {
    bootstrap: {
      state: readyState,
      retrying: false,
      retry: vi.fn(),
      ...overrides.bootstrap,
    },
    configState: overrides.configState ?? readyState,
    retrying: overrides.retrying ?? false,
    handleRetryConfig: overrides.handleRetryConfig ?? vi.fn(),
  }
}

describe('CopilotAppRootShell', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    cleanup()
  })

  describe('loading state', () => {
    it('shows BootstrapScreen with preparing message when status is loading', () => {
      mocks.useCopilotBootstrapState.mockReturnValue(
        createBootstrapHookResult({
          configState: { status: 'loading' },
          bootstrap: { state: { status: 'loading' }, retrying: false, retry: vi.fn() },
        }),
      )

      render(<CopilotAppRootShell />)

      expect(screen.getByText('正在加载应用…')).toBeDefined()
      expect(screen.getByTestId('desktop-chrome')).toBeDefined()
    })

    it('shows BootstrapScreen with connecting message when status is starting', () => {
      mocks.useCopilotBootstrapState.mockReturnValue(
        createBootstrapHookResult({
          configState: { status: 'starting' },
          bootstrap: { state: { status: 'starting' }, retrying: false, retry: vi.fn() },
        }),
      )

      render(<CopilotAppRootShell />)

      expect(screen.getByText('正在连接服务…')).toBeDefined()
      expect(screen.getByTestId('desktop-chrome')).toBeDefined()
    })
  })

  describe('error state', () => {
    it('shows error BootstrapScreen when configState status is error', () => {
      mocks.useCopilotBootstrapState.mockReturnValue(
        createBootstrapHookResult({
          configState: { status: 'error', error: 'Connection refused' },
          bootstrap: { state: { status: 'error', error: 'Connection refused' }, retrying: false, retry: vi.fn() },
        }),
      )

      render(<CopilotAppRootShell />)

      expect(screen.getByText('服务连接失败')).toBeDefined()
      expect(screen.getByText('无法连接到后端服务，请检查服务是否正常运行并重试。')).toBeDefined()
      expect(screen.getByText('Connection refused')).toBeDefined()
    })

    it('shows retry button that calls handleRetryConfig', () => {
      const handleRetryConfig = vi.fn()

      mocks.useCopilotBootstrapState.mockReturnValue(
        createBootstrapHookResult({
          configState: { status: 'error', error: 'fail' },
          bootstrap: { state: { status: 'error', error: 'fail' }, retrying: false, retry: handleRetryConfig },
          handleRetryConfig,
        }),
      )

      render(<CopilotAppRootShell />)

      fireEvent.click(screen.getByText('重试连接'))
      expect(handleRetryConfig).toHaveBeenCalledOnce()
    })

    it('shows disabled retry button with retrying text when retrying is true', () => {
      mocks.useCopilotBootstrapState.mockReturnValue(
        createBootstrapHookResult({
          configState: { status: 'error', error: 'error' },
          bootstrap: { state: { status: 'error', error: 'error' }, retrying: true, retry: vi.fn() },
          retrying: true,
        }),
      )

      render(<CopilotAppRootShell />)

      const retryButton = screen.getByText('正在重试…')
      expect((retryButton as HTMLButtonElement).disabled).toBe(true)
    })

    it('does not render CopilotAppRootBoundary when in error state', () => {
      mocks.useCopilotBootstrapState.mockReturnValue(
        createBootstrapHookResult({
          configState: { status: 'error', error: 'failed' },
          bootstrap: { state: { status: 'error', error: 'failed' }, retrying: false, retry: vi.fn() },
        }),
      )

      render(<CopilotAppRootShell />)

      expect(screen.getByText('服务连接失败')).toBeDefined()
      expect(screen.queryByText('重试加载')).toBeNull()
    })
  })

  describe('ready / workbench state', () => {
    it('renders CopilotAppRootBoundary when configState is ready', () => {
      mocks.useCopilotBootstrapState.mockReturnValue(createBootstrapHookResult())

      render(<CopilotAppRootShell />)

      expect(screen.getByTestId('desktop-chrome')).toBeDefined()
    })

    it('renders CopilotAppRootBoundary when configState is degraded', () => {
      const degradedState = {
        ...createReadyBootstrapState({
          runtimeUrl: LABEL_HTTP_LOCALHOST_4400,
        }),
        status: 'degraded' as const,
      }

      mocks.useCopilotBootstrapState.mockReturnValue(
        createBootstrapHookResult({
          configState: degradedState,
          bootstrap: { state: degradedState, retrying: false, retry: vi.fn() },
        }),
      )

      render(<CopilotAppRootShell />)

      expect(screen.getByTestId('desktop-chrome')).toBeDefined()
    })
  })
})

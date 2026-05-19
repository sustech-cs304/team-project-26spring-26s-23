import { afterEach, vi } from 'vitest'

declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined
}

const hasDomEnvironment = typeof window !== 'undefined' && typeof document !== 'undefined'

if (hasDomEnvironment) {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
}

/* ── GSAP mocks for jsdom test environment ── */
vi.mock('gsap', () => {
  function returnStyleDefault(obj: Record<string, unknown>) {
    Object.defineProperty(obj, 'default', { get: () => obj })
  }

  const applyTo = (targets: unknown, vars: Record<string, unknown>) => {
    let elements: unknown[]
    if (Array.isArray(targets)) {
      elements = targets
    } else if (typeof targets === 'object' && targets !== null && typeof (targets as Record<string, unknown>).length === 'number') {
      elements = Array.from(targets as ArrayLike<unknown>)
    } else {
      elements = [targets]
    }
    for (const el of elements) {
      if (typeof (el as Record<string, unknown>)?.style !== 'object' || el === null || el === undefined) continue
      const style = (el as HTMLElement).style
      if (vars.x !== undefined) style.transform = `translateX(${vars.x}px)`
      if (vars.y !== undefined) style.transform = `translateY(${vars.y}px)`
      if (vars.scale !== undefined) style.transform = `scale(${vars.scale})`
      if (vars.opacity !== undefined) style.opacity = String(vars.opacity)
    }
  }

  const gsapMock = {
    registerPlugin: vi.fn(),
    fromTo: vi.fn((targets: unknown, _fromVars: Record<string, unknown>, toVars: Record<string, unknown>) => {
      applyTo(targets, toVars)
      if (typeof toVars.onComplete === 'function') (toVars.onComplete as () => void)()
      return { kill: vi.fn(), reverse: vi.fn(), play: vi.fn() }
    }),
    to: vi.fn((targets: unknown, vars: Record<string, unknown>) => {
      applyTo(targets, vars)
      const onComplete = vars.onComplete
      if (typeof onComplete === 'function') {
        Promise.resolve().then(() => (onComplete as () => void)())
      }
      return { kill: vi.fn(), reverse: vi.fn(), play: vi.fn() }
    }),
    from: vi.fn((targets: unknown, vars: Record<string, unknown>) => {
      applyTo(targets, { ...vars, opacity: vars.opacity ?? 1 })
      const onComplete = vars.onComplete
      if (typeof onComplete === 'function') {
        Promise.resolve().then(() => (onComplete as () => void)())
      }
      return { kill: vi.fn(), reverse: vi.fn(), play: vi.fn() }
    }),
    set: vi.fn((targets: unknown, vars: Record<string, unknown>) => {
      applyTo(targets, vars)
      return { kill: vi.fn() }
    }),
    quickTo: vi.fn(() => vi.fn()),
    killTweensOf: vi.fn(),
    context: vi.fn((callback: () => void) => {
      callback()
      return { revert: vi.fn() }
    }),
    timeline: vi.fn(() => ({
      to: vi.fn().mockReturnThis(),
      from: vi.fn().mockReturnThis(),
      fromTo: vi.fn().mockReturnThis(),
      add: vi.fn().mockReturnThis(),
      play: vi.fn().mockReturnThis(),
      reverse: vi.fn().mockReturnThis(),
      kill: vi.fn().mockReturnThis(),
    })),
  }
  returnStyleDefault(gsapMock)
  return gsapMock
})

vi.mock('@gsap/react', () => ({
  useGSAP: vi.fn((callback: () => void) => { callback() }),
  contextSafe: vi.fn((fn: (...args: unknown[]) => unknown) => fn),
}))

const registerVitestCleanup = () => {
  try {
    afterEach(() => {
      vi.useRealTimers()
      vi.restoreAllMocks()

      if (!hasDomEnvironment) {
        return
      }

      delete (window as Partial<Window>).configCenterPublicSnapshot
      delete (window as Partial<Window>).configCenterPublicSnapshotSubscription
      delete (window as Partial<Window>).configCenterPublicPatch
      delete (window as Partial<Window>).settingsWorkspaceState
      delete (window as Partial<Window>).settingsWorkspaceSecrets
    })
  } catch {
    // Ignore contexts where Vitest has not attached a current suite yet.
  }
}

registerVitestCleanup()

export {}

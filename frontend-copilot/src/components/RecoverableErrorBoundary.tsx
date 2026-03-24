import { Component, type ReactNode } from 'react'

interface RecoverableErrorBoundaryProps {
  children: ReactNode
  resetKeys?: unknown[]
  fallback: (input: { error: Error; reset: () => void }) => ReactNode
}

interface RecoverableErrorBoundaryState {
  error: Error | null
}

export class RecoverableErrorBoundary extends Component<
  RecoverableErrorBoundaryProps,
  RecoverableErrorBoundaryState
> {
  override state: RecoverableErrorBoundaryState = {
    error: null,
  }

  static getDerivedStateFromError(error: Error): RecoverableErrorBoundaryState {
    return { error }
  }

  override componentDidUpdate(previousProps: RecoverableErrorBoundaryProps) {
    if (
      this.state.error !== null
      && !areResetKeysEqual(previousProps.resetKeys, this.props.resetKeys)
    ) {
      this.setState({ error: null })
    }
  }

  private readonly reset = () => {
    this.setState({ error: null })
  }

  override render() {
    if (this.state.error !== null) {
      return this.props.fallback({
        error: this.state.error,
        reset: this.reset,
      })
    }

    return this.props.children
  }
}

function areResetKeysEqual(previous: unknown[] | undefined, current: unknown[] | undefined): boolean {
  if (previous === current) {
    return true
  }

  if (!previous || !current || previous.length !== current.length) {
    return false
  }

  return previous.every((key, index) => Object.is(key, current[index]))
}

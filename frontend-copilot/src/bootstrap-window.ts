function getBootstrapWindowApi() {
  if (typeof window === 'undefined') {
    return undefined
  }

  return window.bootstrapWindow
}

export async function notifyBootstrapScreenReady(): Promise<void> {
  const api = getBootstrapWindowApi()

  if (!api) {
    return
  }

  await api.signalBootstrapScreenReady()
}

export function waitForNextPaint(): Promise<void> {
  if (typeof window === 'undefined' || typeof window.requestAnimationFrame !== 'function') {
    return Promise.resolve()
  }

  return new Promise((resolve) => {
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        resolve()
      })
    })
  })
}

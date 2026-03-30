export const BOOTSTRAP_WINDOW_READY_CHANNEL = 'bootstrap-window:ready'

export interface BootstrapWindowApi {
  signalBootstrapScreenReady: () => Promise<void>
}

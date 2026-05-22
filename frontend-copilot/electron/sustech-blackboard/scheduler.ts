import type { BlackboardSyncInterval } from './types'
import { SECONDS_PER_HOUR } from './types'

export interface BlackboardSchedulerOptions {
  getSyncInterval: () => BlackboardSyncInterval
  onTick: () => void
}

export interface BlackboardScheduler {
  start: () => void
  stop: () => void
  reschedule: () => void
}

export function createBlackboardScheduler(options: BlackboardSchedulerOptions): BlackboardScheduler {
  let timer: ReturnType<typeof setTimeout> | null = null
  let running = false

  function clearTimer() {
    if (timer !== null) {
      clearTimeout(timer)
      timer = null
    }
  }

  function intervalSeconds(interval: BlackboardSyncInterval): number | null {
    switch (interval) {
      case 'two_hours':
        return 2 * SECONDS_PER_HOUR
      case 'daily':
        return 24 * SECONDS_PER_HOUR
      default:
        return null
    }
  }

  function scheduleNext() {
    clearTimer()

    if (!running) {
      return
    }

    const seconds = intervalSeconds(options.getSyncInterval())
    if (seconds === null) {
      return
    }

    timer = setTimeout(() => {
      timer = null
      options.onTick()
      scheduleNext()
    }, seconds * 1000)
  }

  return {
    start() {
      running = true
      scheduleNext()
    },

    stop() {
      running = false
      clearTimer()
    },

    reschedule() {
      if (running) {
        scheduleNext()
      }
    },
  }
}

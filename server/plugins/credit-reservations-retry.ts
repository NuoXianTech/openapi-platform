/**
 * Schedule recovery; creditService owns coordination, scanning and retries.
 */

import { creditService } from '~~/server/services/credit-service'

const SCAN_INTERVAL_MS = 30_000
const TIMER_KEY = Symbol.for('creditReservationsRetry.timer')

type GlobalWithTimer = typeof globalThis & {
  [TIMER_KEY]?: NodeJS.Timeout
}

export default defineNitroPlugin((nitroApp) => {
  const globalWithTimer = globalThis as GlobalWithTimer
  if (globalWithTimer[TIMER_KEY]) clearInterval(globalWithTimer[TIMER_KEY])

  const timer = setInterval(() => void creditService.recoverReservations(), SCAN_INTERVAL_MS)
  if (typeof timer.unref === 'function') timer.unref()
  globalWithTimer[TIMER_KEY] = timer

  nitroApp.hooks.hook('close', () => {
    if (!globalWithTimer[TIMER_KEY]) return
    clearInterval(globalWithTimer[TIMER_KEY])
    globalWithTimer[TIMER_KEY] = undefined
  })
})

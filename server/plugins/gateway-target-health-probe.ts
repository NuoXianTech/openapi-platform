/**
 * Proactively checks Targets so a cold Gateway instance does
 * not send a burst of traffic to a known-down deployment.  Redis coordinates
 * the probe across Platform instances; without Redis the existing local
 * fallback remains safe for a single-process deployment.
 */

import { and, eq, isNull } from 'drizzle-orm'
import { db } from '~~/server/db/client'
import {
  upstreamServiceConnections,
  upstreamServices,
  upstreamTargets
} from '~~/server/db/schema'
import { upstreamServiceTokenService } from '~~/server/services/upstream-service-token-service'
import { resolveServiceAvailability } from '~~/server/services/service-availability-service'
import { recordGatewayTargetAvailability } from '~~/server/services/dynamic-gateway-target-service'
import { withDistributedLease } from '~~/server/utils/distributed-lease'

const PROBE_INTERVAL_MS = 15_000
const PROBE_LEASE_TTL_MS = 12_000
const TIMER_KEY = Symbol.for('gatewayTargetHealthProbe.timer')

type ProbeRow = {
  upstreamId: string
  targetId: string
  baseUrl: string
  description: NonNullable<typeof upstreamServiceConnections.$inferSelect.serviceDescription>
}

async function probeTargets(): Promise<void> {
  const rows = await db.select({
    upstreamId: upstreamServices.id,
    targetId: upstreamTargets.id,
    baseUrl: upstreamTargets.baseUrl,
    description: upstreamServiceConnections.serviceDescription
  }).from(upstreamTargets)
    .innerJoin(upstreamServices, eq(
      upstreamServices.id,
      upstreamTargets.upstreamServiceId
    ))
    .innerJoin(upstreamServiceConnections, eq(
      upstreamServiceConnections.upstreamServiceId,
      upstreamServices.id
    ))
    .where(and(
      eq(upstreamServices.status, 'active'),
      isNull(upstreamServices.deletedAt),
      eq(upstreamTargets.enabled, true)
    ))

  const groups = new Map<string, ProbeRow[]>()
  for (const row of rows) {
    if (!row.description) continue
    const group = groups.get(row.upstreamId) ?? []
    group.push(row as ProbeRow)
    groups.set(row.upstreamId, group)
  }

  await Promise.all([...groups.entries()].map(async ([upstreamId, targets]) => {
    const token = await upstreamServiceTokenService.get(upstreamId)
    if (!token) return
    const description = targets[0]!.description
    const availability = await resolveServiceAvailability(
      description,
      targets.map(target => ({
        id: target.targetId,
        baseUrl: target.baseUrl,
        enabled: true
      })),
      token
    )
    for (const target of targets) {
      const status = availability.targets.get(target.targetId)
      if (status === 'online' || status === 'offline') {
        recordGatewayTargetAvailability(
          upstreamId,
          target.targetId,
          status === 'online'
        )
      }
    }
  }))
}

async function runProbeOnce(): Promise<void> {
  try {
    await withDistributedLease({
      key: 'gateway-target-health-probe',
      ttlMs: PROBE_LEASE_TTL_MS
    }, probeTargets)
  } catch (error) {
    console.warn('[gateway] target health probe skipped', {
      error: error instanceof Error ? error.message : String(error)
    })
  }
}

export default defineNitroPlugin((nitroApp) => {
  const globalWithTimer = globalThis as typeof globalThis & {
    [TIMER_KEY]?: NodeJS.Timeout
  }
  if (globalWithTimer[TIMER_KEY]) clearInterval(globalWithTimer[TIMER_KEY])

  const timer = setInterval(() => void runProbeOnce(), PROBE_INTERVAL_MS)
  if (typeof timer.unref === 'function') timer.unref()
  globalWithTimer[TIMER_KEY] = timer

  nitroApp.hooks.hook('close', () => {
    if (!globalWithTimer[TIMER_KEY]) return
    clearInterval(globalWithTimer[TIMER_KEY])
    globalWithTimer[TIMER_KEY] = undefined
  })
})

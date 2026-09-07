import type { BadgeProps } from '@nuxt/ui'
import type { ServiceAvailability } from '#shared/types/service-control'

export function platformStatusColor(status: string): BadgeProps['color'] {
  if (status === 'active' || status === 'published') return 'success'
  if (status === 'deprecated' || status === 'superseded') return 'warning'
  if (status === 'disabled' || status === 'retired' || status === 'failed') return 'error'
  return 'neutral'
}

export function serviceAvailabilityColor(
  availability: ServiceAvailability
): BadgeProps['color'] {
  if (availability === 'online') return 'success'
  if (availability === 'degraded') return 'warning'
  if (availability === 'offline') return 'error'
  return 'neutral'
}

export function formatPlatformDate(value: string | null, locale: string): string {
  if (!value) return '-'
  return new Intl.DateTimeFormat(locale, {
    dateStyle: 'medium',
    timeStyle: 'short'
  }).format(new Date(value))
}

export function shortServiceCommit(value: string | null | undefined): string {
  const commit = value?.trim()
  if (!commit) return '—'
  return /^[0-9a-f]{8,64}$/i.test(commit) ? commit.slice(0, 7) : commit
}

interface FetchLikeError {
  data?: { message?: unknown, data?: { code?: unknown } }
  statusCode?: number
  status?: number
  statusMessage?: unknown
  message?: unknown
}

/** Zod's default type errors are useful for developers, but too technical for UI feedback. */
function isZodTypeErrorMessage(message: string): boolean {
  const normalized = message.trim()
  return /(?:^|[:：]\s*)invalid input:\s*expected .+,\s*received .+$/i.test(normalized)
    || /(?:^|[:：]\s*)无效输入[:：]?\s*期望 .+，实际接[收受] .+$/.test(normalized)
}

export function parseFetchError(
  err: unknown,
  fallback: string,
  codeMap?: Record<string | number, string>
): string {
  if (err && typeof err === 'object') {
    const e = err as FetchLikeError
    const applicationCode = e.data?.data?.code
    if (codeMap && typeof applicationCode === 'string'
      && Object.hasOwn(codeMap, applicationCode)) {
      return codeMap[applicationCode]!
    }
    const dataMessage = e.data?.message
    if (typeof dataMessage === 'string' && dataMessage) {
      if (!isZodTypeErrorMessage(dataMessage)) return dataMessage

      if (codeMap) {
        const status = e.statusCode ?? e.status
        if (typeof status === 'number') {
          if (codeMap[status]) return codeMap[status]
          if (status >= 500 && codeMap[500]) return codeMap[500]
        }
      }
      return fallback
    }

    if (codeMap) {
      const status = e.statusCode ?? e.status
      if (typeof status === 'number') {
        if (codeMap[status]) return codeMap[status]
        if (status >= 500 && codeMap[500]) return codeMap[500]
      }
    }

    if (typeof e.statusMessage === 'string' && e.statusMessage) {
      return isZodTypeErrorMessage(e.statusMessage) ? fallback : e.statusMessage
    }
  }

  if (err instanceof Error && err.message) {
    return isZodTypeErrorMessage(err.message) ? fallback : err.message
  }

  return fallback
}

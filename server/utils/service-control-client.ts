import type { z } from 'zod'
import {
  isSupportedServiceControlProtocol,
  openapiDocumentSchema,
  redactedServiceConfigurationStateSchema,
  SERVICE_CONTROL_PROTOCOL_V1,
  type ServiceDescription,
  serviceDescriptionEnvelopeSchema,
  serviceDescriptionV1Schema,
  serviceConfigurationDefinitionSchema,
  serviceConfigurationUpdateResponseSchema,
  type SupportedServiceControlProtocol,
  SUPPORTED_SERVICE_CONTROL_PROTOCOLS
} from '#shared/service-control'
import { readLimitedText, safeFetch } from '~~/server/utils/safe-fetch'
import { containsDotPathSegment } from '~~/server/utils/route-pattern'

const CONTROL_TIMEOUT_MS = 10_000
const MAX_CONTROL_RESPONSE_BYTES = 4 * 1024 * 1024
const MAX_CONTROL_ERROR_BYTES = 64 * 1024
const SERVICE_ERROR_CODE_PATTERN = /^[A-Z][A-Z0-9_]{0,79}$/

export class ServiceControlRequestError extends Error {
  constructor(
    readonly status: number | null,
    readonly endpoint: string,
    message: string,
    readonly code: string | null = null,
    readonly responseData: Readonly<Record<string, unknown>> | null = null
  ) {
    super(message)
    this.name = 'ServiceControlRequestError'
  }
}

export class UnsupportedServiceProtocolError extends Error {
  readonly supportedProtocols = [...SUPPORTED_SERVICE_CONTROL_PROTOCOLS]

  constructor(readonly serviceProtocol: string) {
    super(
      `unsupported Service control protocol "${serviceProtocol}"; supported protocols: ${SUPPORTED_SERVICE_CONTROL_PROTOCOLS.join(', ')}`
    )
    this.name = 'UnsupportedServiceProtocolError'
  }
}

export function buildServiceControlUrl(
  baseUrl: string,
  endpoint: string
): URL {
  const base = new URL(baseUrl)
  const rawEndpoint = endpoint.trim()
  if (!rawEndpoint.startsWith('/') || rawEndpoint.startsWith('//')) {
    throw new Error('service control endpoint must be an absolute path')
  }
  const rawEndpointPath = rawEndpoint.split(/[?#]/, 1)[0]!
  if (containsDotPathSegment(rawEndpointPath)) {
    throw new Error('service control endpoint must not contain dot segments')
  }
  const endpointUrl = new URL(rawEndpoint, 'http://service.invalid')
  if (base.username || base.password || base.hash || base.search) {
    throw new Error('service base URL must not contain credentials, query, or fragment')
  }
  // Endpoints are path references from the Service description.  Ignore no
  // authority supplied by an absolute URL: accepting it would make a remote
  // description able to redirect control traffic to an arbitrary host.
  if (endpointUrl.origin !== 'http://service.invalid') {
    throw new Error('service control endpoint must be a relative path')
  }
  const basePath = base.pathname === '/'
    ? ''
    : base.pathname.replace(/\/$/, '')
  base.pathname = `${basePath}${endpointUrl.pathname}` || '/'
  base.search = endpointUrl.search
  base.hash = ''
  return base
}

function normalizedErrorCode(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const code = value.trim()
  return SERVICE_ERROR_CODE_PATTERN.test(code) ? code : null
}

function normalizedErrorMessage(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const message = value.trim().replace(/\s+/g, ' ')
  return message ? message.slice(0, 500) : null
}

interface ServiceControlErrorResponse {
  summary: string
  code: string | null
  data: Readonly<Record<string, unknown>> | null
}

async function describeErrorResponse(
  response: Response
): Promise<ServiceControlErrorResponse | null> {
  const headerCode = normalizedErrorCode(
    response.headers.get('x-openapi-error-code')
  )
  let raw: string
  try {
    raw = await readLimitedText(response, MAX_CONTROL_ERROR_BYTES)
  } catch {
    return headerCode
      ? { summary: `[${headerCode}]`, code: headerCode, data: null }
      : null
  }

  let body: unknown
  try {
    body = JSON.parse(raw)
  } catch {
    return headerCode
      ? { summary: `[${headerCode}]`, code: headerCode, data: null }
      : null
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return headerCode
      ? { summary: `[${headerCode}]`, code: headerCode, data: null }
      : null
  }

  const record = body as Record<string, unknown>
  const code = normalizedErrorCode(record.code) ?? headerCode
  const message = normalizedErrorMessage(record.message)
  const data = record.data && typeof record.data === 'object'
    && !Array.isArray(record.data)
    ? record.data as Record<string, unknown>
    : null
  const summary = code && message
    ? `[${code}] ${message}`
    : code ? `[${code}]` : message
  return summary ? { summary, code, data } : null
}

function parseResponseData<TSchema extends z.ZodType>(
  data: unknown,
  schema: TSchema,
  status: number,
  endpoint: string
): z.output<TSchema> {
  const parsed = schema.safeParse(data)
  if (parsed.success) return parsed.data

  const issues = parsed.error.issues
    .slice(0, 5)
    .map((issue) => {
      const path = issue.path.length > 0
        ? issue.path.join('.')
        : '<root>'
      return `${path}: ${issue.message}`
    })
    .join('; ')
  throw new ServiceControlRequestError(
    status,
    endpoint,
    `service control response does not match the protocol: ${issues}`
  )
}

function parseServiceDescription(
  data: unknown,
  protocol: SupportedServiceControlProtocol,
  status: number,
  endpoint: string
): ServiceDescription {
  switch (protocol) {
    case SERVICE_CONTROL_PROTOCOL_V1:
      return parseResponseData(
        data,
        serviceDescriptionV1Schema,
        status,
        endpoint
      )
  }
  const unsupportedProtocol: never = protocol
  throw new Error(`missing parser for Service protocol ${unsupportedProtocol}`)
}

async function requestJson<TSchema extends z.ZodType>(
  baseUrl: string,
  endpoint: string,
  token: string,
  schema: TSchema,
  init: RequestInit = {}
): Promise<{
  data: z.output<TSchema>
  headers: Headers
  status: number
  url: string
}> {
  const url = buildServiceControlUrl(baseUrl, endpoint)
  const headers = new Headers(init.headers)
  headers.set('authorization', `Service ${token}`)
  headers.set('accept', 'application/json')
  if (init.body) headers.set('content-type', 'application/json')

  let response: Response
  try {
    response = await safeFetch(url, {
      ...init,
      allowedHosts: [url.hostname],
      allowSubdomains: false,
      // Targets may intentionally live on the private Docker
      // network and commonly use HTTP for that hop.  DNS is still resolved
      // and pinned by safeFetch; control-plane redirects are returned
      // manually and never followed with configuration credentials.
      allowHttp: true,
      allowPrivateNetworks: true,
      allowNonDefaultPort: true,
      followRedirects: false,
      headers,
      redirect: 'manual',
      signal: AbortSignal.timeout(CONTROL_TIMEOUT_MS)
    })
  } catch (error) {
    throw new ServiceControlRequestError(
      null,
      endpoint,
      `service control request failed: ${
        error instanceof Error ? error.name : 'network error'
      }`
    )
  }

  if (!response.ok) {
    const detail = await describeErrorResponse(response)
    throw new ServiceControlRequestError(
      response.status,
      endpoint,
      `service control request returned HTTP ${response.status}${
        detail ? `: ${detail.summary}` : ''
      }`,
      detail?.code ?? null,
      detail?.data ?? null
    )
  }
  const raw = await readLimitedText(response, MAX_CONTROL_RESPONSE_BYTES)
  let json: unknown
  try {
    json = JSON.parse(raw)
  } catch {
    throw new ServiceControlRequestError(
      response.status,
      endpoint,
      'service control response is not valid JSON'
    )
  }
  return {
    data: parseResponseData(json, schema, response.status, endpoint),
    headers: response.headers,
    status: response.status,
    url: url.toString()
  }
}

export const serviceControlClient = {
  async getDescription(baseUrl: string, token: string) {
    const response = await requestJson(
      baseUrl,
      '/.well-known/service.json',
      token,
      serviceDescriptionEnvelopeSchema
    )
    if (!isSupportedServiceControlProtocol(response.data.serviceProtocol)) {
      throw new UnsupportedServiceProtocolError(
        response.data.serviceProtocol
      )
    }
    return {
      ...response,
      data: parseServiceDescription(
        response.data,
        response.data.serviceProtocol,
        response.status,
        '/.well-known/service.json'
      )
    }
  },

  getConfigurationDefinition(
    baseUrl: string,
    endpoint: string,
    token: string
  ) {
    return requestJson(
      baseUrl,
      endpoint,
      token,
      serviceConfigurationDefinitionSchema
    )
  },

  getConfigurationState(
    baseUrl: string,
    endpoint: string,
    token: string
  ) {
    return requestJson(
      baseUrl,
      endpoint,
      token,
      redactedServiceConfigurationStateSchema
    )
  },

  getOpenAPI(baseUrl: string, endpoint: string, token: string) {
    return requestJson(
      baseUrl,
      endpoint,
      token,
      openapiDocumentSchema
    )
  },

  updateConfiguration(
    baseUrl: string,
    endpoint: string,
    token: string,
    input: {
      revision: number
      values: Record<string, unknown>
    }
  ) {
    return requestJson(
      baseUrl,
      endpoint,
      token,
      serviceConfigurationUpdateResponseSchema,
      {
        method: 'PUT',
        body: JSON.stringify({
          schemaVersion: 1,
          revision: input.revision,
          values: input.values
        })
      }
    )
  }
}

import { safeFetch } from '~~/server/utils/safe-fetch'

/** All managed Target traffic uses one policy. HTTP must resolve exclusively
 * to private addresses, including container names; credentials never redirect. */
export function fetchUpstreamTarget(input: string | URL, init: RequestInit = {}): Promise<Response> {
  const url = new URL(input)
  return safeFetch(url, {
    ...init,
    allowedHosts: [url.hostname],
    allowSubdomains: false,
    allowHttp: 'private-only',
    allowPrivateNetworks: true,
    allowNonDefaultPort: true,
    followRedirects: false,
    redirect: 'manual'
  })
}

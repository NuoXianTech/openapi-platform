import { runtimeSecretErrors } from '../../scripts/runtime-config.mjs'

export function getRuntimeEnvironmentErrors(): string[] {
  const config = useRuntimeConfig()
  return runtimeSecretErrors({
    authSecret: config.auth.secret,
    apiKeySecret: config.apiKeySecret
  })
}

export function assertRuntimeEnvironment(): void {
  const errors = getRuntimeEnvironmentErrors()
  if (errors.length === 0) return
  const details = errors.map(error => `- ${error}`).join('\n')
  throw new Error(`Invalid runtime environment:\n${details}`)
}

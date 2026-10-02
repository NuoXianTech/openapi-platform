import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { computed } from 'vue'
import ts from 'typescript'
import { expect, it, vi } from 'vitest'
import type { AuthUser } from '#shared/types/auth'
import type { useAuth } from '~/composables/use-auth'

it('keeps SSR user state and reads isolated per request without useState or client deduplication', async () => {
  // Compile the same production composable with Nuxt's server flags. The main
  // unit-test bundle deliberately uses client flags for browser lifecycle tests.
  const source = readFileSync(new URL('../../../../app/composables/use-auth.ts', import.meta.url), 'utf8')
    .replaceAll('import.meta.server', 'true').replaceAll('import.meta.client', 'false')
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText
  const first = { context: {} as { authUser?: AuthUser }, cookie: 'fixture-first' }
  const second = { context: {} as { authUser?: AuthUser }, cookie: 'fixture-second' }
  let event = first
  let finish!: (user: AuthUser) => void
  const userA = { id: 1, username: 'first' } as AuthUser
  const userB = { id: 2, username: 'second' } as AuthUser
  const fetchMock = vi.fn().mockReturnValueOnce(new Promise<AuthUser>(resolve => { finish = resolve }))
    .mockResolvedValueOnce(userB).mockResolvedValueOnce(userA)
  const clientState = vi.fn(() => { throw new Error('SSR must not put user state into the payload') })
  const exported = {} as { useAuth: typeof useAuth }
  runInNewContext(compiled, {
    exports: exported,
    require: (id: string) => { if (id === 'vue') return { computed }; throw new Error(`unexpected import ${id}`) },
    useState: clientState,
    useRequestEvent: () => event,
    useRequestHeaders: () => ({ cookie: event.cookie }),
    $fetch: fetchMock
  })
  const a = exported.useAuth()
  const pending = a.fetchMe()
  event = second
  const b = exported.useAuth()
  await b.fetchMe()
  finish(userA)
  await pending
  await a.fetchMe()
  expect(fetchMock).toHaveBeenCalledTimes(3)
  expect(fetchMock.mock.calls.map(call => call[1].headers.cookie)).toEqual(['fixture-first', 'fixture-second', 'fixture-first'])
  expect(a.user.value).toEqual(userA)
  expect(b.user.value).toEqual(userB)
  expect(first.context.authUser).toEqual(userA)
  expect(second.context.authUser).toEqual(userB)
  expect(clientState).not.toHaveBeenCalled()
})

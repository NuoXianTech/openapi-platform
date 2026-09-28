import { describe, expect, it, vi } from 'vitest'
import { requireVerifiedBuild } from '../../../scripts/release/require-ci.mjs'

const repository = 'NuoXianTech/openapi-platform'
const sha = '1'.repeat(40)
const goodRun = { id: 11, head_sha: sha, event: 'push', head_repository: { full_name: repository }, status: 'completed', conclusion: 'success', html_url: 'https://github.com/example/runs/11' }
const goodArtifact = { id: 21, name: 'ci-distribution', expired: false }

function fixture() {
  const state = {
    runs: [{ ...goodRun }],
    current: { ...goodRun },
    artifacts: [goodArtifact],
    recoveryArtifacts: [goodArtifact],
    mainSha: sha,
    recoveryVisible: true,
    dispatched: false
  }
  const request = vi.fn(async (path: string, options?: { method?: string }) => {
    if (path.includes('/runs?')) return { workflow_runs: state.runs }
    if (path.endsWith('/commits/main')) return { sha: state.mainSha }
    if (options?.method === 'POST') {
      state.dispatched = true
      if (state.recoveryVisible) {
        state.current = { ...goodRun, id: 12, event: 'workflow_dispatch' }
        state.runs = [state.current, ...state.runs]
      }
      return null
    }
    if (path.includes('/artifacts?')) return { artifacts: state.dispatched ? state.recoveryArtifacts : state.artifacts }
    return state.current
  })
  const wait = vi.fn(async (_milliseconds: number) => {})
  const run = (ref = 'v0.1.5') => requireVerifiedBuild({ repository, sha, ref, request, wait })
  return { state, request, wait, run }
}

describe('release CI acquisition', () => {
  it('reuses an exact successful push and its unexpired artifact', async () => {
    const { run, request } = fixture()
    await expect(run()).resolves.toMatchObject({ runId: 11, sha, artifactId: 21 })
    expect(request.mock.calls.some(([, options]) => options?.method === 'POST')).toBe(false)
  })

  it.each([
    { event: 'pull_request' },
    { head_sha: '2'.repeat(40) },
    { head_repository: { full_name: 'someone/other-repository' } }
  ])('rejects unrelated CI identity %j and requests this tag', async (patch) => {
    const { run, state, request } = fixture()
    state.runs = [{ ...goodRun, ...patch }]
    await expect(run()).resolves.toMatchObject({ runId: 12, sha })
    expect(request).toHaveBeenCalledWith(expect.stringContaining('/dispatches'), { method: 'POST', body: { ref: 'v0.1.5' } })
  })

  it.each([{ artifacts: [] }, { artifacts: [{ ...goodArtifact, expired: true }] }])('recovers a missing or expired distribution', async ({ artifacts }) => {
    const { run, state } = fixture()
    state.artifacts = artifacts
    await expect(run()).resolves.toMatchObject({ runId: 12 })
    expect(state.dispatched).toBe(true)
  })

  it.each(['failure', 'cancelled'])('does not publish after CI concludes %s', async (conclusion) => {
    const { run, state } = fixture()
    state.current.conclusion = conclusion
    await expect(run()).rejects.toThrow(`finished with ${conclusion}`)
    expect(state.dispatched).toBe(false)
  })

  it('waits for an in-progress run before accepting its artifact', async () => {
    const { run, state, wait } = fixture()
    state.current.status = 'in_progress'
    wait.mockImplementationOnce(async () => { state.current.status = 'completed' })
    await expect(run()).resolves.toMatchObject({ runId: 11 })
    expect(wait).toHaveBeenCalledWith(10_000)
  })

  it('revalidates the run identity after selecting it', async () => {
    const { run, state } = fixture()
    state.current.head_sha = '2'.repeat(40)
    await expect(run()).rejects.toThrow('identity changed')
  })

  it('does not dispatch current main for an older missing build', async () => {
    const { run, state } = fixture()
    state.runs = []
    state.mainSha = '2'.repeat(40)
    await expect(run('main')).rejects.toThrow('main advanced')
    expect(state.dispatched).toBe(false)
  })

  it('bounds discovery of a dispatched run and does not accept old runs', async () => {
    const { run, state } = fixture()
    state.artifacts = []
    state.recoveryVisible = false
    await expect(run()).rejects.toThrow('dispatched CI run was not found')
  })

  it('fails clearly when recovery CI does not support the artifact contract', async () => {
    const { run, state } = fixture()
    state.artifacts = []
    state.recoveryArtifacts = []
    await expect(run()).rejects.toThrow('did not produce ci-distribution')
  })
})

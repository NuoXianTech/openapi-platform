import { appendFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import { setTimeout as sleep } from 'node:timers/promises'

const artifactName = 'ci-distribution'

/** Only a successful, non-PR run for this exact commit may supply release bytes. */
export async function requireVerifiedBuild({ repository, sha, ref, request, wait = sleep, timeoutMs = 25 * 60_000 }) {
  const workflow = `/repos/${repository}/actions/workflows/quality.yml`
  const deadline = Date.now() + timeoutMs
  const trusted = run => run.head_sha === sha && ['push', 'workflow_dispatch'].includes(run.event)
    && run.head_repository?.full_name === repository
  const listRuns = async () => (await request(`${workflow}/runs?head_sha=${sha}&per_page=100`)).workflow_runs.filter(trusted)
  const findArtifact = async (id) => (await request(`/repos/${repository}/actions/runs/${id}/artifacts?per_page=100`))
    .artifacts.find(artifact => artifact.name === artifactName && !artifact.expired)
  let run = (await listRuns())[0]
  let dispatched = false
  let existingIds = new Set()
  let dispatchPolls = 0

  while (Date.now() < deadline) {
    if (!run) {
      if (!dispatched) {
        const latestRuns = await listRuns()
        // A push run can appear between the initial lookup and this branch.
        const appeared = latestRuns.find(item => item.id !== run?.id && item.status !== 'completed')
        if (appeared) { run = appeared; continue }
        existingIds = new Set(latestRuns.map(item => item.id))
        if (ref === 'main' && (await request(`/repos/${repository}/commits/main`)).sha !== sha) {
          throw new Error('main advanced before CI recovery; publish the newer development commit or use an immutable version tag')
        }
        // Use the immutable tag for recovery, never whichever commit main now names.
        await request(`${workflow}/dispatches`, { method: 'POST', body: { ref } })
        dispatched = true
      }
      await wait(5000)
      run = (await listRuns()).find(item => !existingIds.has(item.id) && item.event === 'workflow_dispatch')
      if (!run && ++dispatchPolls >= 12) throw new Error('The dispatched CI run was not found for the requested commit')
      continue
    }

    const current = await request(`/repos/${repository}/actions/runs/${run.id}`)
    if (!trusted(current)) throw new Error('CI run identity changed; refusing this distribution')
    if (current.status !== 'completed') {
      await wait(10_000)
      continue
    }
    if (current.conclusion !== 'success') throw new Error(`CI ${current.html_url} finished with ${current.conclusion}`)
    const artifact = await findArtifact(current.id)
    if (artifact) return { runId: current.id, sha, artifactId: artifact.id, url: current.html_url }
    if (dispatched) throw new Error(`CI ${current.html_url} did not produce ${artifactName}; this ref must support distribution uploads`)
    run = undefined
  }
  throw new Error(`Timed out waiting for verified CI for ${sha}`)
}

async function main() {
  const { GITHUB_REPOSITORY: repository, GH_TOKEN: token, BUILD_REF: ref, GITHUB_OUTPUT: output } = process.env
  if (!repository || !token || !ref || !output) throw new Error('Missing verified-build environment')
  const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim()
  const sha = git('rev-parse', 'HEAD')
  const version = JSON.parse(execFileSync('git', ['show', 'HEAD:package.json'], { encoding: 'utf8' })).version
  const release = ref.startsWith('v')
  if (release && (!/^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(-rc\.(0|[1-9]\d*))?$/.test(ref) || ref !== `v${version}`)) {
    throw new Error('Release tag must be vX.Y.Z or vX.Y.Z-rc.N and match package.json')
  }
  if (!release && !/^[a-f0-9]{40}$/.test(ref)) throw new Error('Development publishing requires a full commit SHA')
  if (!release && ref !== sha) throw new Error('Checked-out commit does not match the requested SHA')
  git('fetch', '--no-tags', 'origin', 'main:refs/remotes/origin/main')
  git('merge-base', '--is-ancestor', sha, 'origin/main')
  if (release && git('rev-parse', `refs/tags/${ref}^{commit}`) !== sha) throw new Error('Tag does not resolve to the checked-out commit')

  const request = async (path, options = {}) => {
    const response = await fetch(`https://api.github.com${path}`, {
      method: options.method ?? 'GET',
      headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'Content-Type': 'application/json' },
      body: options.body ? JSON.stringify(options.body) : undefined,
      signal: AbortSignal.timeout(30_000)
    })
    if (!response.ok) throw new Error(`GitHub API ${options.method ?? 'GET'} ${path}: ${response.status}`)
    return response.status === 204 ? null : response.json()
  }
  const result = await requireVerifiedBuild({ repository, sha, ref: release ? ref : 'main', request })
  appendFileSync(output, `run-id=${result.runId}\nsha=${sha}\nversion=${version}\nprerelease=${version.includes('-')}\n`)
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `Verified distribution: ${result.url}\n\nCommit: \`${sha}\`\n`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => { console.error(error.message); process.exitCode = 1 })
}

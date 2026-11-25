import { expect, test } from 'claude-code/testing'

const releaseInput = {
  command: 'release',
  args: 'check',
  origin: { kind: 'plugin', name: 'release-conductor' },
  presentation: { isFullscreen: false, columns: 80 },
} as const

function stubGit(on: Parameters<Parameters<typeof test>[1]>[1], releaseJson: string) {
  const statted: string[] = []
  on('process.run', (_$, e) => {
    const argv = (e as { argv: string[] }).argv
    if (argv[1] === 'status') return { value: { stdout: '', stderr: '', exitCode: 0 } }
    if (argv[1] === 'describe') return { value: { stdout: 'v0.1.0\n', stderr: '', exitCode: 0 } }
    if (argv[1] === 'diff')
      return { value: { stdout: 'CHANGELOG.md\0src/a.ts\0', stderr: '', exitCode: 0 } }
    return { value: { stdout: '', stderr: '', exitCode: 1 } }
  })
  on('fs.read', () => ({ value: releaseJson }))
  on('fs.stat', (_$, e) => {
    statted.push((e as { path: string }).path)
    return { value: { size: 1 } }
  })
  on('fs.write', () => ({ value: undefined }))
  return statted
}

test('a changelog committed since the last tag counts as updated', async ($, on) => {
  stubGit(on, '{}')
  const answer = await $.command.run(releaseInput)
  expect(answer.text).toContain('[x] changelog updated')
})

test('asset paths outside the repository are refused, not probed', async ($, on) => {
  const statted = stubGit(on, '{"assets": ["/etc/passwd", "../secret", "dist/app.js"]}')
  const answer = await $.command.run(releaseInput)
  expect(statted).not.toContain('/etc/passwd')
  expect(statted).not.toContain('../secret')
  expect(answer.text).toContain('outside the repository')
})

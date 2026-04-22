import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

const hoisted = vi.hoisted(() => ({
  execFileMock: vi.fn(),
  resolveWindowsCommandChainMock: vi.fn(),
}))

vi.mock('node:child_process', () => ({
  execFile: hoisted.execFileMock,
}))

vi.mock('./command-resolution', () => ({
  resolveWindowsCommandChain: hoisted.resolveWindowsCommandChainMock,
}))

import { createManagedRuntimeCommandRunner, verifyManagedRuntimeLaunchers } from './verification'

const tempRoots: string[] = []

afterEach(async () => {
  vi.clearAllMocks()
  await Promise.all(tempRoots.splice(0).map(async (directory) => rm(directory, { recursive: true, force: true })))
})

describe('createManagedRuntimeCommandRunner', () => {
  it('wraps Windows .cmd launchers with cmd.exe during verification', async () => {
    hoisted.resolveWindowsCommandChainMock.mockReturnValue({
      command: 'C:/Windows/System32/cmd.exe',
      argsPrefix: ['/d', '/s', '/c', 'D:/managed/node/npx.cmd'],
    })
    hoisted.execFileMock.mockImplementation((_command, _args, _options, callback) => {
      callback(null, { stdout: '11.0.0\n', stderr: '' })
    })

    const runner = createManagedRuntimeCommandRunner()
    const output = await runner.run('D:/managed/node/npx.cmd', ['--version'])

    expect(output).toBe('11.0.0')
    expect(hoisted.execFileMock).toHaveBeenCalledWith(
      'C:/Windows/System32/cmd.exe',
      ['/d', '/s', '/c', 'D:/managed/node/npx.cmd', '--version'],
      { windowsHide: true },
      expect.any(Function),
    )
  })
})

describe('verifyManagedRuntimeLaunchers', () => {
  it('accepts uvx banner output after extracting the semver token', async () => {
    const tempRoot = await mkdtemp(path.join(tmpdir(), 'candue-managed-runtime-verify-'))
    tempRoots.push(tempRoot)
    const uvxPath = path.join(tempRoot, 'uvx.exe')
    await writeFile(uvxPath, 'binary')

    const verification = await verifyManagedRuntimeLaunchers([
      {
        launcher: 'uvx',
        executablePath: uvxPath,
        args: ['--version'],
        expectVersion: '0.11.7',
      },
    ], {
      run: vi.fn(async () => 'uvx 0.11.7 (9d177269e 2026-04-15 x86_64-pc-windows-msvc)'),
    })

    expect(verification.summary).toContain('uvx 0.11.7')
    expect(verification.launchers.uvx).toBe(uvxPath)
  })
})

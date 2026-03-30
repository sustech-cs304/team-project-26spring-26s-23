import { rm } from 'node:fs/promises'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildDevelopmentPythonRuntimeLaunchSpec } from './python-runtime-resolver-dev'
import { DESKTOP_RUNTIME_ENTRY_MODULE } from './python-runtime-resolver-shared'
import {
  createDevelopmentRuntimeFixture,
  writeSuccessfulCommandProbe,
} from './runtime-test-fixtures'

describe('buildDevelopmentPythonRuntimeLaunchSpec', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('resolves backend paths from the Electron app root in development mode', () => {
    const spec = buildDevelopmentPythonRuntimeLaunchSpec({
      appRoot: path.resolve('.'),
      resourcesPath: path.resolve('dist-electron'),
      isPackaged: false,
    })

    expect(spec.mode).toBe('development')
    expect(spec.workspaceRoot).toBe(path.resolve('..'))
    expect(spec.backendDir).toBe(path.resolve('..', 'backend'))
    expect(spec.workingDirectory).toBe(path.resolve('..', 'backend'))
    if (spec.pythonExecutablePath === null) {
      const expectedFallbackCommands = process.platform === 'win32'
        ? ['py', 'python', 'python3']
        : ['python3', 'python']
      expect(expectedFallbackCommands).toContain(spec.command)
    } else {
      expect(spec.command).toBe(spec.pythonExecutablePath)
    }
    expect(spec.args.slice(-2)).toEqual(['-m', DESKTOP_RUNTIME_ENTRY_MODULE])
  })

  it('does not prefer uv when falling back to shell Python interpreters', async () => {
    const fixture = await createDevelopmentRuntimeFixture()
    const fakeBinDir = path.join(fixture.tempRoot, 'fake-bin')

    await rm(fixture.pythonExecutablePath, { force: true })

    try {
      await Promise.all([
        writeSuccessfulCommandProbe(fakeBinDir, 'uv'),
        writeSuccessfulCommandProbe(fakeBinDir, 'python'),
        writeSuccessfulCommandProbe(fakeBinDir, 'python3'),
        ...(process.platform === 'win32' ? [writeSuccessfulCommandProbe(fakeBinDir, 'py')] : []),
      ])

      vi.stubEnv('PATH', fakeBinDir)
      if (process.platform === 'win32') {
        vi.stubEnv('Path', fakeBinDir)
      }

      const spec = buildDevelopmentPythonRuntimeLaunchSpec({
        appRoot: fixture.appRoot,
        resourcesPath: path.join(fixture.tempRoot, 'dist-electron'),
        isPackaged: false,
      })

      if (process.platform === 'win32') {
        expect(spec.command).toBe('py')
        expect(spec.args).toEqual(['-3', '-m', DESKTOP_RUNTIME_ENTRY_MODULE])
      } else {
        expect(spec.command).toBe('python3')
        expect(spec.args).toEqual(['-m', DESKTOP_RUNTIME_ENTRY_MODULE])
      }
    } finally {
      await rm(fixture.tempRoot, { recursive: true, force: true })
    }
  })

  it('prefers the project virtualenv interpreter when present', async () => {
    const fixture = await createDevelopmentRuntimeFixture()

    try {
      const spec = buildDevelopmentPythonRuntimeLaunchSpec({
        appRoot: fixture.appRoot,
        resourcesPath: path.join(fixture.tempRoot, 'dist-electron'),
        isPackaged: false,
      })

      expect(spec.backendDir).toBe(fixture.backendDir)
      expect(spec.command).toBe(fixture.pythonExecutablePath)
      expect(spec.args).toEqual(['-m', DESKTOP_RUNTIME_ENTRY_MODULE])
      expect(spec.pythonExecutablePath).toBe(fixture.pythonExecutablePath)
    } finally {
      await rm(fixture.tempRoot, { recursive: true, force: true })
    }
  })
})

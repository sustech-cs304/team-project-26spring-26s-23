import { rm } from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { resolvePythonRuntimeLaunchSpec } from './python-runtime-resolver'
import { DESKTOP_RUNTIME_ENTRY_MODULE } from './python-runtime-resolver-shared'
import {
  createBundledRuntimeFixture,
  createDevelopmentRuntimeFixture,
} from './runtime-test-fixtures'

describe('resolvePythonRuntimeLaunchSpec', () => {
  it('accepts the current repository layout in development mode', async () => {
    const spec = await resolvePythonRuntimeLaunchSpec({
      appRoot: path.resolve('.'),
      resourcesPath: path.resolve('dist-electron'),
      isPackaged: false,
    })

    expect(spec.backendDir).toBe(path.resolve('..', 'backend'))
    expect(spec.entryModule).toBe(DESKTOP_RUNTIME_ENTRY_MODULE)
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

  it('delegates packaged resolution to the bundled runtime resolver', async () => {
    const fixture = await createBundledRuntimeFixture()

    try {
      const spec = await resolvePythonRuntimeLaunchSpec({
        appRoot: path.join(fixture.tempRoot, 'dist-electron'),
        resourcesPath: fixture.resourcesPath,
        isPackaged: true,
      })

      expect(spec).toMatchObject({
        mode: 'bundled',
        backendDir: fixture.backendDir,
        command: fixture.pythonExecutablePath,
        manifestPath: fixture.manifestPath,
      })
    } finally {
      await rm(fixture.tempRoot, { recursive: true, force: true })
    }
  })

  it('verifies required development backend files before returning a launch spec', async () => {
    const fixture = await createDevelopmentRuntimeFixture()

    try {
      await rm(path.join(fixture.backendDir, 'pyproject.toml'), { force: true })

      await expect(resolvePythonRuntimeLaunchSpec({
        appRoot: fixture.appRoot,
        resourcesPath: path.join(fixture.tempRoot, 'dist-electron'),
        isPackaged: false,
      })).rejects.toThrow('Cannot resolve backend project file')
    } finally {
      await rm(fixture.tempRoot, { recursive: true, force: true })
    }
  })
})

import { readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  buildBundledPythonRuntimeLaunchSpec,
  buildBundledPythonRuntimePlaceholder,
} from './python-runtime-resolver-bundled'
import { DESKTOP_RUNTIME_ENTRY_MODULE } from './python-runtime-resolver-shared'
import { createBundledRuntimeFixture } from './runtime-test-fixtures'

describe('buildBundledPythonRuntimePlaceholder', () => {
  it('keeps packaged-runtime paths behind a dedicated placeholder boundary', () => {
    const placeholder = buildBundledPythonRuntimePlaceholder({
      appRoot: path.resolve('.'),
      resourcesPath: path.resolve('resources'),
      isPackaged: true,
    })

    expect(placeholder).toEqual({
      mode: 'bundled',
      resourcesRoot: path.resolve('resources', 'python-runtime'),
      manifestPath: path.resolve('resources', 'python-runtime', 'backend-runtime-manifest.json'),
    })
  })
})

describe('buildBundledPythonRuntimeLaunchSpec', () => {
  it('resolves packaged runtime paths from process.resourcesPath in bundled mode', async () => {
    const fixture = await createBundledRuntimeFixture()

    try {
      const spec = await buildBundledPythonRuntimeLaunchSpec({
        appRoot: path.join(fixture.tempRoot, 'dist-electron'),
        resourcesPath: fixture.resourcesPath,
        isPackaged: true,
      })

      expect(spec).toMatchObject({
        mode: 'bundled',
        workspaceRoot: null,
        backendDir: fixture.backendDir,
        resourcesRoot: fixture.bundledRuntimeRoot,
        workingDirectory: fixture.backendDir,
        entryModule: DESKTOP_RUNTIME_ENTRY_MODULE,
        command: fixture.pythonExecutablePath,
        args: ['-m', DESKTOP_RUNTIME_ENTRY_MODULE],
        manifestPath: fixture.manifestPath,
        pythonExecutablePath: fixture.pythonExecutablePath,
        pythonPathEntries: [fixture.backendDir, fixture.pythonPackagesDir],
        sitePackagesEntries: [fixture.pythonPackagesDir],
      })
      expect(spec.env).toEqual({
        PYTHONPATH: [fixture.backendDir, fixture.pythonPackagesDir].join(path.delimiter),
      })
    } finally {
      await rm(fixture.tempRoot, { recursive: true, force: true })
    }
  })

  it('rejects bundled runtime entries that escape the packaged resources root', async () => {
    const fixture = await createBundledRuntimeFixture()

    try {
      const rawManifest = JSON.parse(await readFile(fixture.manifestPath, 'utf8')) as Record<string, unknown>
      const rawPython = rawManifest.python as Record<string, unknown>

      rawPython.executableRelativePath = '../escaped/python'

      await writeFile(fixture.manifestPath, `${JSON.stringify(rawManifest, null, 2)}\n`, 'utf8')

      await expect(buildBundledPythonRuntimeLaunchSpec({
        appRoot: path.join(fixture.tempRoot, 'dist-electron'),
        resourcesPath: fixture.resourcesPath,
        isPackaged: true,
      })).rejects.toThrow('Bundled runtime Python executable escapes the resources root')
    } finally {
      await rm(fixture.tempRoot, { recursive: true, force: true })
    }
  })
})

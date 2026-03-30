import { readFile, rm, writeFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { readBundledPythonRuntimeManifest } from './python-runtime-manifest'
import { DESKTOP_RUNTIME_ENTRY_MODULE } from './python-runtime-resolver-shared'
import { createBundledRuntimeFixture } from './runtime-test-fixtures'

describe('readBundledPythonRuntimeManifest', () => {
  it('parses staged bundled runtime metadata into a structured manifest', async () => {
    const fixture = await createBundledRuntimeFixture()

    try {
      const manifest = await readBundledPythonRuntimeManifest(fixture.manifestPath)

      expect(manifest).toMatchObject({
        manifestVersion: 1,
        resourceLayoutVersion: 1,
        runtimeMode: 'bundled',
        python: {
          runtimeRootRelativePath: 'python',
          version: 'Python 3.12.9',
        },
        backend: {
          workingDirectoryRelativePath: 'backend',
          entryModule: DESKTOP_RUNTIME_ENTRY_MODULE,
          pythonPathRelativePaths: ['backend', 'python-packages'],
          sitePackagesRelativePaths: ['python-packages'],
        },
        metadata: {
          requirementsRelativePath: 'metadata/backend-requirements.txt',
          stagingTool: 'frontend-copilot/scripts/prepare-bundled-runtime.mjs',
        },
      })
    } finally {
      await rm(fixture.tempRoot, { recursive: true, force: true })
    }
  })

  it('allows empty site-packages arrays when the bundled runtime does not expose extra directories', async () => {
    const fixture = await createBundledRuntimeFixture()

    try {
      const rawManifest = JSON.parse(await readFile(fixture.manifestPath, 'utf8')) as {
        backend: {
          sitePackagesRelativePaths: unknown
        }
      }

      rawManifest.backend.sitePackagesRelativePaths = []
      await writeFile(fixture.manifestPath, `${JSON.stringify(rawManifest, null, 2)}\n`, 'utf8')

      const manifest = await readBundledPythonRuntimeManifest(fixture.manifestPath)

      expect(manifest.backend.sitePackagesRelativePaths).toEqual([])
    } finally {
      await rm(fixture.tempRoot, { recursive: true, force: true })
    }
  })

  it('still requires at least one Python path entry for bundled backend imports', async () => {
    const fixture = await createBundledRuntimeFixture()

    try {
      const rawManifest = JSON.parse(await readFile(fixture.manifestPath, 'utf8')) as {
        backend: {
          pythonPathRelativePaths: unknown
        }
      }

      rawManifest.backend.pythonPathRelativePaths = []
      await writeFile(fixture.manifestPath, `${JSON.stringify(rawManifest, null, 2)}\n`, 'utf8')

      await expect(readBundledPythonRuntimeManifest(fixture.manifestPath)).rejects.toThrow(
        'Bundled runtime manifest field "backend.pythonPathRelativePaths" must be a non-empty array of relative paths.',
      )
    } finally {
      await rm(fixture.tempRoot, { recursive: true, force: true })
    }
  })
})

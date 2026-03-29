import { rm } from 'node:fs/promises'
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
})

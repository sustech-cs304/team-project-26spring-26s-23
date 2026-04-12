import { rm } from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { createHostedRuntimeLaunchConfig } from './runtime-config'
import {
  buildDevelopmentPythonRuntimeLaunchSpec,
  resolvePythonRuntimeLaunchSpec,
} from './python-runtime-resolver'
import { buildPythonRuntimeSpawnArguments } from './runtime-spawn-args'
import {
  createBundledRuntimeFixture,
  createDevelopmentRuntimeFixture,
} from './runtime-test-fixtures'

describe('buildPythonRuntimeSpawnArguments', () => {
  it('appends the same hosted runtime args to development and bundled launch specs', async () => {
    const developmentFixture = await createDevelopmentRuntimeFixture()
    const bundledFixture = await createBundledRuntimeFixture()
    const runtimeConfig = createHostedRuntimeLaunchConfig({
      userDataPath: path.resolve('.tmp-userdata-shared-runtime-args'),
      processEnv: {
        COPILOT_RUNTIME_MODEL: 'qwen-plus',
      },
      port: 43210,
      localToken: 'token-shared',
    })

    try {
      const developmentSpec = buildDevelopmentPythonRuntimeLaunchSpec({
        appRoot: developmentFixture.appRoot,
        resourcesPath: path.join(developmentFixture.tempRoot, 'dist-electron'),
        isPackaged: false,
      })
      const bundledSpec = await resolvePythonRuntimeLaunchSpec({
        appRoot: path.join(bundledFixture.tempRoot, 'dist-electron'),
        resourcesPath: bundledFixture.resourcesPath,
        isPackaged: true,
      })

      expect(buildPythonRuntimeSpawnArguments(developmentSpec.args, runtimeConfig.args)).toEqual([
        ...developmentSpec.args,
        ...runtimeConfig.args,
      ])
      expect(buildPythonRuntimeSpawnArguments(bundledSpec.args, runtimeConfig.args)).toEqual([
        ...bundledSpec.args,
        ...runtimeConfig.args,
      ])
    } finally {
      await Promise.all([
        rm(developmentFixture.tempRoot, { recursive: true, force: true }),
        rm(bundledFixture.tempRoot, { recursive: true, force: true }),
      ])
    }
  })
})

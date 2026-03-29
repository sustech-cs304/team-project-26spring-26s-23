import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  collectForwardedElectronMainProcessArguments,
  createHostedRuntimeLaunchConfig,
  parseHostedRuntimeCommandLineArguments,
  parseHostedRuntimeCommandLineArgumentsSafely,
} from './runtime-config'

describe('collectForwardedElectronMainProcessArguments', () => {
  it('keeps hosted runtime flags after the npm-forwarded separator', () => {
    expect(collectForwardedElectronMainProcessArguments([
      'node',
      'vite',
      '--host',
      '0.0.0.0',
      '--',
      '--runtime-model',
      'test',
      '--runtime-environment',
      'development',
    ])).toEqual([
      '--runtime-model',
      'test',
      '--runtime-environment',
      'development',
    ])
  })

  it('collects hosted runtime flags even when vite argv arrives without a separator', () => {
    expect(collectForwardedElectronMainProcessArguments([
      'node',
      'vite',
      '--runtime-model',
      'test',
      '--runtime-host=127.0.0.1',
      '--open',
    ])).toEqual([
      '--runtime-model',
      'test',
      '--runtime-host=127.0.0.1',
    ])
  })
})

describe('parseHostedRuntimeCommandLineArguments', () => {
  it('normalizes forwarded Electron main-process runtime flags into launch options', () => {
    expect(parseHostedRuntimeCommandLineArguments([
      '--runtime-model=test',
      '--runtime-host', '127.0.0.1',
      '--runtime-app-mode', 'desktop',
      '--runtime-environment', 'development',
      '--runtime-local-token', 'token-123',
    ])).toEqual({
      model: 'test',
      host: '127.0.0.1',
      appMode: 'desktop',
      environment: 'development',
      localToken: 'token-123',
    })
  })

  it('feeds the parsed runtime model into the Python argv builder', () => {
    const forwardedArgs = collectForwardedElectronMainProcessArguments([
      'node',
      'vite',
      '--',
      '--runtime-model',
      'cli-model',
    ])
    const runtimeOptions = parseHostedRuntimeCommandLineArguments(forwardedArgs)
    const config = createHostedRuntimeLaunchConfig({
      userDataPath: path.resolve('.tmp-userdata-cli-model'),
      processEnv: {
        COPILOT_RUNTIME_MODEL: 'env-model',
      },
      port: 43210,
      model: runtimeOptions.model,
      localToken: 'token-cli',
    })

    expect(config.model).toBe('cli-model')
    expect(config.args).toEqual(expect.arrayContaining([
      '--model',
      'cli-model',
      '--local-token',
      'token-cli',
    ]))
  })

  it('returns a warning and empty options for malformed runtime flags so callers can fall back to defaults', () => {
    const result = parseHostedRuntimeCommandLineArgumentsSafely([
      '--runtime-host',
    ])

    expect(result.warning).toEqual({
      code: 'invalid-hosted-runtime-command-line-arguments',
      detail: 'Missing value for hosted runtime option --runtime-host.',
      flag: '--runtime-host',
    })
    expect(result.options).toEqual({})

    const config = createHostedRuntimeLaunchConfig({
      userDataPath: path.resolve('.tmp-userdata-cli-defaults'),
      processEnv: {},
      port: 43210,
      ...result.options,
    })

    expect(config.host).toBe('127.0.0.1')
    expect(config.appMode).toBe('desktop')
    expect(config.environment).toBe('development')
    expect(config.localToken).toHaveLength(48)
  })
})

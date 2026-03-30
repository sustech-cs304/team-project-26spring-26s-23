import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  normalizeRequiredRelativePath,
  resolveBundledRuntimeRelativePath,
} from './python-runtime-path-security'

describe('normalizeRequiredRelativePath', () => {
  it('uses the provided label instead of manifest-field wording', () => {
    expect(() => normalizeRequiredRelativePath(
      path.resolve('python', 'python.exe'),
      'Python executable',
    )).toThrow('Bundled runtime Python executable must be a relative path.')
  })
})

describe('resolveBundledRuntimeRelativePath', () => {
  it('keeps manifest field labels and descriptive labels on the same generic error model', () => {
    expect(() => resolveBundledRuntimeRelativePath(
      path.resolve('resources'),
      path.resolve('python', 'python.exe'),
      'Python executable',
    )).toThrow('Bundled runtime Python executable must be a relative path.')

    expect(() => normalizeRequiredRelativePath(
      path.resolve('python', 'python.exe'),
      'python.executableRelativePath',
    )).toThrow('Bundled runtime python.executableRelativePath must be a relative path.')
  })
})

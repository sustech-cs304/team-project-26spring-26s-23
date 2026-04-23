import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { createManagedRuntimePaths, listManagedRuntimeDirectories } from './ManagedRuntimePaths'

describe('createManagedRuntimePaths', () => {
  it('creates staging, active, version, cache, manifest, and diagnostics paths under the hosted runtime root', () => {
    const paths = createManagedRuntimePaths({
      runtimeRootDir: path.resolve('D:/workspace/candue-user-data/desktop-runtime'),
    })

    expect(paths.rootDir).toBe(path.resolve('D:/workspace/candue-user-data/desktop-runtime/managed-runtime'))
    expect(paths.manifestsDir).toBe(path.resolve('D:/workspace/candue-user-data/desktop-runtime/managed-runtime/manifests'))
    expect(paths.families.node.stagingDir).toBe(
      path.resolve('D:/workspace/candue-user-data/desktop-runtime/managed-runtime/node/staging'),
    )
    expect(paths.families.node.activeDir).toBe(
      path.resolve('D:/workspace/candue-user-data/desktop-runtime/managed-runtime/node/active'),
    )
    expect(paths.families.uv.versionsDir).toBe(
      path.resolve('D:/workspace/candue-user-data/desktop-runtime/managed-runtime/uv/versions'),
    )

    for (const directoryPath of listManagedRuntimeDirectories(paths)) {
      expect(directoryPath.startsWith(path.resolve('D:/workspace/candue-user-data/desktop-runtime'))).toBe(true)
    }
  })
})


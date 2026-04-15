import path from 'node:path'
import type { DesktopCapabilityBridgeRequest } from '../protocol'
import { DesktopCapabilityBridgeError } from '../errors'
import { createDesktopCapabilityBridgePaths } from '../paths'
import type { CreateDesktopCapabilityBridgeServiceOptions } from '../types'

export interface DesktopCapabilityDatabaseService {
  handle(request: DesktopCapabilityBridgeRequest): Promise<Record<string, unknown>>
}

export function createDesktopCapabilityDatabaseService(
  options: CreateDesktopCapabilityBridgeServiceOptions,
): DesktopCapabilityDatabaseService {
  return {
    async handle(request) {
      switch (request.operation) {
        case 'resolve_path': {
          const targetPath = await resolveDatabasePath(options, request.payload.relativePath)
          return { path: targetPath }
        }
        default:
          throw new DesktopCapabilityBridgeError(
            'unsupported_operation',
            `Database capability does not support operation '${request.operation}'.`,
            {
              details: {
                capability: request.capability,
                operation: request.operation,
              },
            },
          )
      }
    },
  }
}

async function resolveDatabasePath(
  options: CreateDesktopCapabilityBridgeServiceOptions,
  relativePathValue: unknown,
): Promise<string> {
  const hostedPaths = await options.prepareRuntimePaths()
  const bridgePaths = createDesktopCapabilityBridgePaths(hostedPaths)
  const databaseRootDir = path.resolve(bridgePaths.databaseRootDir)
  const relativePath = normalizeDatabaseRelativePath(relativePathValue)
  const resolvedPath = relativePath === null
    ? databaseRootDir
    : path.resolve(databaseRootDir, relativePath)

  assertPathInsideDatabaseRoot(databaseRootDir, resolvedPath, relativePath)

  return resolvedPath
}

function normalizeDatabaseRelativePath(value: unknown): string | null {
  if (value === undefined) {
    return null
  }

  if (typeof value !== 'string') {
    throw new DesktopCapabilityBridgeError('invalid_request', 'relativePath must be a string when provided.')
  }

  const normalized = value.trim()
  if (normalized === '') {
    return null
  }

  if (path.isAbsolute(normalized)) {
    throw new DesktopCapabilityBridgeError(
      'invalid_request',
      'relativePath must be a relative path when provided.',
      {
        details: {
          relativePath: normalized,
        },
      },
    )
  }

  return normalized
}

function assertPathInsideDatabaseRoot(
  databaseRootDir: string,
  resolvedPath: string,
  relativePath: string | null,
): void {
  const relativeToRoot = path.relative(databaseRootDir, resolvedPath)
  if (relativeToRoot === '') {
    return
  }

  if (relativeToRoot.startsWith('..') || path.isAbsolute(relativeToRoot)) {
    throw new DesktopCapabilityBridgeError(
      'permission_denied',
      'Database path must resolve inside the desktop capability database root.',
      {
        details: {
          databaseRootDir,
          resolvedPath,
          relativePath: relativePath ?? '',
        },
      },
    )
  }
}

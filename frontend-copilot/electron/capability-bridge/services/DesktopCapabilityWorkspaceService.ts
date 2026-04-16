import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import type { DesktopCapabilityBridgeRequest } from '../protocol'
import { DesktopCapabilityBridgeError } from '../errors'
import { createDesktopCapabilityBridgePaths } from '../paths'
import type { CreateDesktopCapabilityBridgeServiceOptions } from '../types'

export interface DesktopCapabilityWorkspaceService {
  handle(request: DesktopCapabilityBridgeRequest): Promise<Record<string, unknown>>
}

export function createDesktopCapabilityWorkspaceService(
  options: CreateDesktopCapabilityBridgeServiceOptions,
): DesktopCapabilityWorkspaceService {
  return {
    async handle(request) {
      switch (request.operation) {
        case 'resolve_path': {
          const targetPath = await resolveWorkspacePath(options, request.payload.relativePath)
          return { path: targetPath }
        }
        case 'ensure_directory': {
          const targetPath = await resolveWorkspacePath(options, request.payload.relativePath, {
            requireRelativePath: true,
          })
          await mkdir(targetPath, { recursive: true })
          return { path: targetPath }
        }
        default:
          throw new DesktopCapabilityBridgeError(
            'unsupported_operation',
            `Workspace capability does not support operation '${request.operation}'.`,
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

async function resolveWorkspacePath(
  options: CreateDesktopCapabilityBridgeServiceOptions,
  relativePathValue: unknown,
  resolveOptions: {
    requireRelativePath?: boolean
  } = {},
): Promise<string> {
  const hostedPaths = await options.prepareRuntimePaths()
  const bridgePaths = createDesktopCapabilityBridgePaths(hostedPaths)
  const workspaceRootDir = path.resolve(bridgePaths.workspaceRootDir)
  const relativePath = normalizeWorkspaceRelativePath(relativePathValue, resolveOptions)
  const resolvedPath = relativePath === null
    ? workspaceRootDir
    : path.resolve(workspaceRootDir, relativePath)

  assertPathInsideApprovedRoot(workspaceRootDir, resolvedPath, relativePath)

  return resolvedPath
}

function normalizeWorkspaceRelativePath(
  value: unknown,
  options: {
    requireRelativePath?: boolean
  },
): string | null {
  if (value === undefined) {
    if (options.requireRelativePath) {
      throw new DesktopCapabilityBridgeError(
        'invalid_request',
        'relativePath must be a non-empty relative path.',
      )
    }

    return null
  }

  if (typeof value !== 'string') {
    throw new DesktopCapabilityBridgeError('invalid_request', 'relativePath must be a string when provided.')
  }

  const normalized = value.trim()
  if (normalized === '') {
    if (options.requireRelativePath) {
      throw new DesktopCapabilityBridgeError(
        'invalid_request',
        'relativePath must be a non-empty relative path.',
      )
    }

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

function assertPathInsideApprovedRoot(
  workspaceRootDir: string,
  resolvedPath: string,
  relativePath: string | null,
): void {
  const relativeToRoot = path.relative(workspaceRootDir, resolvedPath)
  if (relativeToRoot === '') {
    return
  }

  if (relativeToRoot.startsWith('..') || path.isAbsolute(relativeToRoot)) {
    throw new DesktopCapabilityBridgeError(
      'permission_denied',
      'Workspace path must resolve inside the desktop capability workspace root.',
      {
        details: {
          workspaceRootDir,
          resolvedPath,
          relativePath: relativePath ?? '',
        },
      },
    )
  }
}

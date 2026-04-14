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
          const targetPath = await resolveWorkspacePath(options, request.payload.relativePath)
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
): Promise<string> {
  const hostedPaths = await options.prepareRuntimePaths()
  const bridgePaths = createDesktopCapabilityBridgePaths(hostedPaths)
  const workspaceRootDir = path.resolve(bridgePaths.workspaceRootDir)
  const relativePath = normalizeOptionalRelativePath(relativePathValue)
  const resolvedPath = relativePath === null
    ? workspaceRootDir
    : path.resolve(workspaceRootDir, relativePath)

  if (!isPathInsideRoot(workspaceRootDir, resolvedPath)) {
    throw new DesktopCapabilityBridgeError(
      'permission_denied',
      'Workspace path must resolve inside the desktop capability workspace root.',
      {
        details: {
          workspaceRootDir,
          resolvedPath,
          relativePath,
        },
      },
    )
  }

  return resolvedPath
}

function normalizeOptionalRelativePath(value: unknown): string | null {
  if (value === undefined) {
    return null
  }
  if (typeof value !== 'string') {
    throw new DesktopCapabilityBridgeError('invalid_request', 'relativePath must be a string when provided.')
  }

  const normalized = value.trim()
  return normalized === '' ? null : normalized
}

function isPathInsideRoot(rootDir: string, candidatePath: string): boolean {
  if (candidatePath === rootDir) {
    return true
  }

  const rootWithSeparator = rootDir.endsWith(path.sep) ? rootDir : `${rootDir}${path.sep}`
  return candidatePath.startsWith(rootWithSeparator)
}

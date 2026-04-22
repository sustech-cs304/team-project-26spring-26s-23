import { rm } from 'node:fs/promises'
import path from 'node:path'
import { ensureManagedRuntimeDirectories } from '../ManagedRuntimePaths'
import { activateManagedRuntimeVersion, prepareCleanStagingDirectory, readJsonFile, writeJsonFile } from '../RuntimeInstallShared'
import { createManagedRuntimeArchiveExtractor, type ManagedRuntimeArchiveExtractor } from '../archive'
import {
  createManagedRuntimeDownloadClient,
  downloadManagedRuntimeArtifact,
  verifyManagedRuntimeArtifactChecksum,
  type ManagedRuntimeDownloadClient,
} from '../download'
import { resolveManagedRuntimeDownloadSource } from '../download-source'
import {
  createManagedRuntimeCommandRunner,
  verifyManagedRuntimeLaunchers,
  type ManagedRuntimeCommandRunner,
  type ManagedRuntimeVerificationPlan,
} from '../verification'
import type {
  ManagedRuntimeActionReason,
  ManagedRuntimeErrorSummary,
  ManagedRuntimeFamilyPaths,
  ManagedRuntimeFamilySnapshot,
  ManagedRuntimePersistentState,
  ManagedRuntimeResolvedComponent,
} from '../types'

const NODE_VERSION_PATTERN = /^\d+\.\d+\.\d+$/

export interface NodeRuntimeManagerOptions {
  paths: ManagedRuntimeFamilyPaths
  pinnedVersion: string
  selectedComponents: readonly ManagedRuntimeResolvedComponent[]
  ensureRootDirectories?: () => Promise<void>
  downloadClient?: ManagedRuntimeDownloadClient
  archiveExtractor?: ManagedRuntimeArchiveExtractor
  commandRunner?: ManagedRuntimeCommandRunner
  clock?: () => string
}

export class NodeRuntimeManager {
  private readonly paths: ManagedRuntimeFamilyPaths
  private readonly pinnedVersion: string
  private readonly selectedComponents: readonly ManagedRuntimeResolvedComponent[]
  private readonly ensureRootDirectories: () => Promise<void>
  private readonly downloadClient: ManagedRuntimeDownloadClient
  private readonly archiveExtractor: ManagedRuntimeArchiveExtractor
  private readonly commandRunner: ManagedRuntimeCommandRunner
  private readonly clock: () => string

  constructor(options: NodeRuntimeManagerOptions) {
    this.paths = options.paths
    this.pinnedVersion = options.pinnedVersion
    this.selectedComponents = options.selectedComponents
    this.ensureRootDirectories = options.ensureRootDirectories ?? (async () => {
      await ensureManagedRuntimeDirectories({
        rootDir: path.resolve(this.paths.rootDir, '..'),
        manifestsDir: path.resolve(this.paths.rootDir, '../manifests'),
        diagnosticsDir: path.resolve(this.paths.rootDir, '../diagnostics'),
        families: {
          node: this.paths,
          uv: this.paths,
        },
      })
    })
    this.downloadClient = options.downloadClient ?? createManagedRuntimeDownloadClient()
    this.archiveExtractor = options.archiveExtractor ?? createManagedRuntimeArchiveExtractor()
    this.commandRunner = options.commandRunner ?? createManagedRuntimeCommandRunner()
    this.clock = options.clock ?? (() => new Date().toISOString())
  }

  async loadSnapshot(): Promise<ManagedRuntimeFamilySnapshot> {
    await this.ensureRootDirectories()
    const persisted = await this.readState()
    const activeVersion = persisted.activeVersion
    const base = this.createBaseSnapshot(persisted)

    if (activeVersion === null) {
      return {
        ...base,
        status: persisted.status === 'broken' ? 'broken' : 'missing',
      }
    }

    if (activeVersion !== this.pinnedVersion) {
      return {
        ...base,
        status: 'outdated',
      }
    }

    try {
      const verification = await this.verifyVersion(activeVersion)
      const nextState: ManagedRuntimePersistentState = {
        ...persisted,
        status: 'ready',
        lastVerification: {
          verifiedAt: this.clock(),
          summary: verification.summary,
          launchers: verification.launchers,
        },
        lastErrorSummary: null,
      }
      await this.writeState(nextState)
      return this.createBaseSnapshot(nextState)
    } catch (error) {
      const nextState: ManagedRuntimePersistentState = {
        ...persisted,
        status: 'broken',
        lastErrorSummary: this.createErrorSummary('verification_failed', error),
      }
      await this.writeState(nextState)
      return this.createBaseSnapshot(nextState)
    }
  }

  async installOrRepair(reason: ManagedRuntimeActionReason): Promise<ManagedRuntimeFamilySnapshot> {
    await this.ensureRootDirectories()
    const before = await this.readState()
    const installingState: ManagedRuntimePersistentState = { ...before }
    await this.writeState(installingState)

    const stagingDir = await prepareCleanStagingDirectory(this.paths, this.pinnedVersion)
    const stagedVersionDir = path.join(stagingDir, 'version')
    try {
      for (const component of this.selectedComponents) {
        const source = resolveManagedRuntimeDownloadSource(component)
        const { artifactFile } = await downloadManagedRuntimeArtifact({
          source,
          cacheDir: this.paths.cacheDir,
          client: this.downloadClient,
        })
        await verifyManagedRuntimeArtifactChecksum(source, artifactFile, this.downloadClient)
        const componentDir = path.join(stagedVersionDir, component.component)
        await this.archiveExtractor.extract(artifactFile, componentDir, source.archiveFormat)
      }

      const verification = await this.verifyVersionFromDirectory(stagedVersionDir)
      const activatedVersionDir = await activateManagedRuntimeVersion(this.paths, this.pinnedVersion, stagedVersionDir)
      const nextState: ManagedRuntimePersistentState = {
        ...before,
        family: 'node',
        pinnedVersion: this.pinnedVersion,
        status: 'ready',
        activeVersion: this.pinnedVersion,
        lastInstalledAt: reason === 'install' ? this.clock() : before.lastInstalledAt ?? this.clock(),
        lastRepairedAt: reason === 'repair' ? this.clock() : before.lastRepairedAt,
        lastVerification: {
          verifiedAt: this.clock(),
          summary: verification.summary,
          launchers: verification.launchers,
        },
        lastErrorSummary: null,
        schemaVersion: 1,
      }
      await this.writeState(nextState)
      await rm(stagingDir, { recursive: true, force: true })
      return this.createBaseSnapshot(nextState, activatedVersionDir)
    } catch (error) {
      await rm(stagingDir, { recursive: true, force: true })
      const failedState: ManagedRuntimePersistentState = {
        ...before,
        status: 'broken',
        lastErrorSummary: this.createErrorSummary('install_failed', error),
        lastRepairedAt: reason === 'repair' ? this.clock() : before.lastRepairedAt,
      }
      await this.writeState(failedState)
      return this.createBaseSnapshot(failedState)
    }
  }

  private async verifyVersion(version: string) {
    return await this.verifyVersionFromDirectory(path.join(this.paths.versionsDir, version))
  }

  private async verifyVersionFromDirectory(versionDir: string) {
    const nodeRoot = path.join(versionDir, 'node')
    return await verifyManagedRuntimeLaunchers(this.createVerificationPlan(nodeRoot), this.commandRunner)
  }

  private createVerificationPlan(nodeRoot: string): ManagedRuntimeVerificationPlan[] {
    const nodeComponent = this.selectedComponents.find((entry) => entry.component === 'node')
    const relative = nodeComponent?.distribution.launcherRelativePaths ?? {}
    return [
      {
        launcher: 'node',
        executablePath: path.join(nodeRoot, relative.node ?? 'node'),
        args: ['--version'],
        expectIncludes: `v${this.pinnedVersion}`,
      },
      {
        launcher: 'npm',
        executablePath: path.join(nodeRoot, relative.npm ?? 'npm'),
        args: ['--version'],
        expectPattern: NODE_VERSION_PATTERN,
      },
      {
        launcher: 'npx',
        executablePath: path.join(nodeRoot, relative.npx ?? 'npx'),
        args: ['--version'],
        expectPattern: NODE_VERSION_PATTERN,
      },
    ]
  }

  private createBaseSnapshot(state: ManagedRuntimePersistentState, activeVersionDir?: string): ManagedRuntimeFamilySnapshot {
    const launcherPaths = state.lastVerification?.launchers
      ?? this.createLauncherPathHints(state.activeVersion, activeVersionDir)
    return {
      family: 'node',
      status: state.status,
      pinnedVersion: this.pinnedVersion,
      activeVersion: state.activeVersion,
      installRootDir: this.paths.versionsDir,
      stagingDir: this.paths.stagingDir,
      activeDir: this.paths.activeDir,
      selectedComponents: this.selectedComponents,
      launcherPaths,
      lastInstalledAt: state.lastInstalledAt,
      lastRepairedAt: state.lastRepairedAt,
      lastVerification: state.lastVerification,
      lastErrorSummary: state.lastErrorSummary,
    }
  }

  private createLauncherPathHints(activeVersion: string | null, activeVersionDir?: string): Partial<Record<string, string>> {
    if (activeVersion === null) {
      return {}
    }
    const nodeComponent = this.selectedComponents.find((entry) => entry.component === 'node')
    const relative = nodeComponent?.distribution.launcherRelativePaths ?? {}
    const versionRoot = activeVersionDir ?? path.join(this.paths.versionsDir, activeVersion)
    const root = path.join(versionRoot, 'node')
    return {
      node: path.join(root, relative.node ?? 'node'),
      npm: path.join(root, relative.npm ?? 'npm'),
      npx: path.join(root, relative.npx ?? 'npx'),
    }
  }

  private async readState(): Promise<ManagedRuntimePersistentState> {
    const state = await readJsonFile<ManagedRuntimePersistentState>(this.paths.stateFile)
    return state ?? {
      schemaVersion: 1,
      family: 'node',
      pinnedVersion: this.pinnedVersion,
      status: 'missing',
      activeVersion: null,
      lastInstalledAt: null,
      lastRepairedAt: null,
      lastVerification: null,
      lastErrorSummary: null,
    }
  }

  private async writeState(state: ManagedRuntimePersistentState): Promise<void> {
    await writeJsonFile(this.paths.stateFile, state)
  }

  private createErrorSummary(code: string, error: unknown): ManagedRuntimeErrorSummary {
    return {
      code,
      message: error instanceof Error ? error.message : String(error),
      detail: error instanceof Error && error.stack ? error.stack : undefined,
      at: this.clock(),
    }
  }
}

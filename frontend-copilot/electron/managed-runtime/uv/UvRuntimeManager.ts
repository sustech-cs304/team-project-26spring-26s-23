import { access, mkdir, rm } from 'node:fs/promises'
import path from 'node:path'
import {
  activateManagedRuntimeVersion,
  createVersionDirectoryName,
  type ManagedRuntimeActivePointer,
  prepareCleanStagingDirectory,
  writeJsonFile,
  readJsonFile,
} from '../RuntimeInstallShared'
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
  ManagedRuntimeVerificationFailure,
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

export interface UvRuntimeManagerOptions {
  paths: ManagedRuntimeFamilyPaths
  pinnedVersion: string
  selectedComponents: readonly ManagedRuntimeResolvedComponent[]
  downloadClient?: ManagedRuntimeDownloadClient
  archiveExtractor?: ManagedRuntimeArchiveExtractor
  commandRunner?: ManagedRuntimeCommandRunner
  clock?: () => string
}

export class UvRuntimeManager {
  private readonly paths: ManagedRuntimeFamilyPaths
  private readonly pinnedVersion: string
  private readonly selectedComponents: readonly ManagedRuntimeResolvedComponent[]
  private readonly downloadClient: ManagedRuntimeDownloadClient
  private readonly archiveExtractor: ManagedRuntimeArchiveExtractor
  private readonly commandRunner: ManagedRuntimeCommandRunner
  private readonly clock: () => string

  constructor(options: UvRuntimeManagerOptions) {
    this.paths = options.paths
    this.pinnedVersion = options.pinnedVersion
    this.selectedComponents = options.selectedComponents
    this.downloadClient = options.downloadClient ?? createManagedRuntimeDownloadClient()
    this.archiveExtractor = options.archiveExtractor ?? createManagedRuntimeArchiveExtractor()
    this.commandRunner = options.commandRunner ?? createManagedRuntimeCommandRunner()
    this.clock = options.clock ?? (() => new Date().toISOString())
  }

  async loadSnapshot(): Promise<ManagedRuntimeFamilySnapshot> {
    await mkdir(this.paths.rootDir, { recursive: true })
    const state = await this.readResolvedState()
    if (state.activeVersion === null) {
      return this.createSnapshot({
        ...state,
        status: state.status === 'broken' ? 'broken' : 'missing',
      })
    }

    try {
      const verification = await this.verifyVersion(state.activeVersion)
      const nextState: ManagedRuntimePersistentState = {
        ...state,
        status: 'ready',
        lastVerification: {
          verifiedAt: this.clock(),
          summary: verification.summary,
          launchers: verification.launchers,
        },
        lastErrorSummary: null,
      }
      await this.writeState(nextState)
      return this.createSnapshot(nextState)
    } catch (error) {
      const failedState: ManagedRuntimePersistentState = {
        ...state,
        status: 'broken',
        lastErrorSummary: this.createErrorSummary('verification_failed', error),
      }
      await this.writeState(failedState)
      return this.createSnapshot(failedState)
    }
  }

  async installOrRepair(reason: ManagedRuntimeActionReason): Promise<ManagedRuntimeFamilySnapshot> {
    await mkdir(this.paths.rootDir, { recursive: true })
    const before = await this.readState()
    const stagingDir = await prepareCleanStagingDirectory(this.paths, this.pinnedVersion)
    const stagedVersionDir = path.join(stagingDir, 'version')
    try {
      for (const component of this.selectedComponents) {
        const source = resolveManagedRuntimeDownloadSource(component)
        if (source.installStrategy !== 'portable-archive') {
          throw new Error(`Managed runtime installer currently supports portable archives only: ${source.component}`)
        }
        const { artifactFile } = await downloadManagedRuntimeArtifact({
          source,
          cacheDir: this.paths.cacheDir,
          client: this.downloadClient,
        })
        await verifyManagedRuntimeArtifactChecksum(source, artifactFile, this.downloadClient)
        await this.archiveExtractor.extract(artifactFile, path.join(stagedVersionDir, component.component), source.archiveFormat)
      }

      let verification
      try {
        verification = await this.verifyVersionFromDirectory(stagedVersionDir)
      } catch (error) {
        throw new ManagedRuntimeVerificationFailure(error)
      }
      const activatedVersionDir = await activateManagedRuntimeVersion(this.paths, this.pinnedVersion, stagedVersionDir)
      const activatedLaunchers = this.rebaseLauncherPaths(verification.launchers, stagedVersionDir, activatedVersionDir)
      const nextState: ManagedRuntimePersistentState = {
        ...before,
        schemaVersion: 1,
        family: 'uv',
        pinnedVersion: this.pinnedVersion,
        status: 'ready',
        activeVersion: this.pinnedVersion,
        lastInstalledAt: reason === 'install' ? this.clock() : before.lastInstalledAt ?? this.clock(),
        lastRepairedAt: reason === 'repair' ? this.clock() : before.lastRepairedAt,
        lastVerification: {
          verifiedAt: this.clock(),
          summary: verification.summary,
          launchers: activatedLaunchers,
        },
        lastErrorSummary: null,
      }
      await this.writeState(nextState)
      await rm(stagingDir, { recursive: true, force: true })
      return this.createSnapshot(nextState, activatedVersionDir)
    } catch (error) {
      await rm(stagingDir, { recursive: true, force: true })
      const failedState: ManagedRuntimePersistentState = {
        ...before,
        status: 'broken',
        lastErrorSummary: this.createErrorSummary(
          error instanceof ManagedRuntimeVerificationFailure ? 'verification_failed' : 'install_failed',
          error instanceof ManagedRuntimeVerificationFailure ? error.cause : error,
        ),
        lastRepairedAt: reason === 'repair' ? this.clock() : before.lastRepairedAt,
      }
      await this.writeState(failedState)
      return this.createSnapshot(failedState)
    }
  }

  private async verifyVersion(version: string) {
    return await this.verifyVersionFromDirectory(this.resolveVersionDirectory(version))
  }

  private async verifyVersionFromDirectory(versionDir: string) {
    const componentLookup = Object.fromEntries(this.selectedComponents.map((entry) => [entry.component, entry]))
    const pythonRelative = componentLookup.python?.distribution.launcherRelativePaths.python ?? 'python'
    const uvRelative = componentLookup.uv?.distribution.launcherRelativePaths.uv ?? 'uv'
    const uvxRelative = componentLookup.uv?.distribution.launcherRelativePaths.uvx ?? 'uvx'
    const pythonVersion = componentLookup.python?.version ?? ''
    const uvVersion = componentLookup.uv?.version ?? ''

    const plans: ManagedRuntimeVerificationPlan[] = [
      {
        launcher: 'python',
        executablePath: path.join(versionDir, 'python', pythonRelative),
        args: ['--version'],
        expectIncludes: `Python ${pythonVersion}`,
      },
      {
        launcher: 'uv',
        executablePath: path.join(versionDir, 'uv', uvRelative),
        args: ['--version'],
        expectIncludes: uvVersion,
      },
      {
        launcher: 'uvx',
        executablePath: path.join(versionDir, 'uv', uvxRelative),
        args: ['--version'],
        expectVersion: uvVersion,
      },
    ]
    return await verifyManagedRuntimeLaunchers(plans, this.commandRunner)
  }

  private createSnapshot(state: ManagedRuntimePersistentState, activeVersionDir?: string): ManagedRuntimeFamilySnapshot {
    const launchers = state.lastVerification?.launchers
      ?? this.createLauncherPathHints(state.activeVersion, activeVersionDir)
    return {
      family: 'uv',
      status: state.status,
      pinnedVersion: this.pinnedVersion,
      activeVersion: state.activeVersion,
      updateRecommended: state.activeVersion !== null && state.activeVersion !== this.pinnedVersion,
      installRootDir: this.paths.versionsDir,
      stagingDir: this.paths.stagingDir,
      activeDir: this.paths.activeDir,
      selectedComponents: this.selectedComponents,
      launcherPaths: launchers,
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
    const componentLookup = Object.fromEntries(this.selectedComponents.map((entry) => [entry.component, entry]))
    const versionRoot = activeVersionDir ?? this.resolveVersionDirectory(activeVersion)
    return {
      python: path.join(versionRoot, 'python', componentLookup.python?.distribution.launcherRelativePaths.python ?? 'python'),
      uv: path.join(versionRoot, 'uv', componentLookup.uv?.distribution.launcherRelativePaths.uv ?? 'uv'),
      uvx: path.join(versionRoot, 'uv', componentLookup.uv?.distribution.launcherRelativePaths.uvx ?? 'uvx'),
    }
  }

  private resolveVersionDirectory(version: string): string {
    return path.join(this.paths.versionsDir, createVersionDirectoryName(version))
  }

  private rebaseLauncherPaths(
    launchers: Record<string, string>,
    fromRoot: string,
    toRoot: string,
  ): Record<string, string> {
    const normalizedFromRoot = this.normalizeForPrefix(fromRoot)
    return Object.fromEntries(
      Object.entries(launchers).map(([launcher, launcherPath]) => {
        const normalizedLauncherPath = this.normalizeForPrefix(launcherPath)
        if (normalizedLauncherPath === normalizedFromRoot || normalizedLauncherPath.startsWith(`${normalizedFromRoot}/`)) {
          const relativePath = normalizedLauncherPath.slice(normalizedFromRoot.length).replace(/^\//u, '')
          return [launcher, path.join(toRoot, relativePath)]
        }

        return [launcher, launcherPath]
      }),
    )
  }

  private normalizeForPrefix(input: string): string {
    return input.replace(/\\/g, '/')
  }

  private async readState(): Promise<ManagedRuntimePersistentState> {
    const state = await readJsonFile<ManagedRuntimePersistentState>(this.paths.stateFile)
    return state ?? {
      schemaVersion: 1,
      family: 'uv',
      pinnedVersion: this.pinnedVersion,
      status: 'missing',
      activeVersion: null,
      lastInstalledAt: null,
      lastRepairedAt: null,
      lastVerification: null,
      lastErrorSummary: null,
    }
  }

  private async readResolvedState(): Promise<ManagedRuntimePersistentState> {
    const state = await this.readState()
    const activePointer = await readJsonFile<ManagedRuntimeActivePointer>(this.paths.activePointerFile)
    const activeVersion = activePointer?.activeVersion

    if (typeof activeVersion !== 'string' || activeVersion.length === 0) {
      return state
    }

    if (!(await this.versionDirectoryExists(activeVersion))) {
      return state
    }

    if (state.activeVersion === activeVersion && state.pinnedVersion === this.pinnedVersion) {
      return state
    }

    return {
      ...state,
      pinnedVersion: this.pinnedVersion,
      activeVersion,
    }
  }

  private async writeState(state: ManagedRuntimePersistentState): Promise<void> {
    await writeJsonFile(this.paths.stateFile, state)
  }

  private async versionDirectoryExists(version: string): Promise<boolean> {
    try {
      await access(this.resolveVersionDirectory(version))
      return true
    } catch {
      return false
    }
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

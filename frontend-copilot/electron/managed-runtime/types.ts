import type { HostedRuntimePaths } from '../runtime/runtime-paths'

export type ManagedRuntimeFamily = 'node' | 'uv'
export type ManagedRuntimeComponent = 'node' | 'python' | 'uv'
export type ManagedRuntimePlatform = 'win32' | 'darwin' | 'linux'
export type ManagedRuntimeArch = 'x64' | 'arm64'
export type ManagedRuntimeStatus = 'missing' | 'installing' | 'ready' | 'broken' | 'outdated'
export type ManagedRuntimeOverallStatus = ManagedRuntimeStatus
export type ManagedRuntimeArchiveFormat = 'zip' | 'tar.gz' | 'tar.xz' | 'tar.zst' | 'pkg' | 'source-tar.xz'
export type ManagedRuntimeChannelKind = 'official-dist' | 'github-release' | 'python-release' | 'placeholder'
export type ManagedRuntimeInstallStrategy = 'portable-archive' | 'system-installer' | 'source-distribution' | 'planned'
export type ManagedRuntimeActionReason = 'install' | 'repair'
export type ManagedRuntimeLauncherName = 'npx' | 'uvx'

export interface ManagedRuntimeTarget {
  platform: ManagedRuntimePlatform
  arch: ManagedRuntimeArch
}

export interface ManagedRuntimeDistribution {
  target: ManagedRuntimeTarget
  fileName: string
  url: string | null
  checksumUrl?: string | null
  archiveFormat: ManagedRuntimeArchiveFormat
  installStrategy: ManagedRuntimeInstallStrategy
  launcherRelativePaths: Record<string, string>
  sourceChannelId: string
  notes?: string
}

export interface ManagedRuntimeComponentManifest {
  component: ManagedRuntimeComponent
  version: string
  versionLine: string
  sourceOfTruth: string
  distributions: readonly ManagedRuntimeDistribution[]
}

export interface ManagedRuntimeFamilyManifest {
  family: ManagedRuntimeFamily
  displayName: string
  pinnedVersion: string
  status: 'supported'
  components: readonly ManagedRuntimeComponentManifest[]
}

export interface ManagedRuntimeSourceChannel {
  channelId: string
  kind: ManagedRuntimeChannelKind
  owner: ManagedRuntimeComponent
  displayName: string
  baseUrl: string
  metadataUrl?: string | null
  checksumPolicy: 'official-sidecar' | 'release-manifest' | 'none'
  notes?: string
}

export interface ManagedRuntimeManifest {
  manifestVersion: number
  generatedAt: string
  families: readonly ManagedRuntimeFamilyManifest[]
  sourceChannels: readonly ManagedRuntimeSourceChannel[]
  releaseEvidence: {
    node: string
    python: string
    uv: string
  }
}

export interface ManagedRuntimeFamilyPaths {
  family: ManagedRuntimeFamily
  rootDir: string
  cacheDir: string
  stagingDir: string
  versionsDir: string
  activeDir: string
  activePointerFile: string
  stateFile: string
  diagnosticsDir: string
}

export interface ManagedRuntimePaths {
  rootDir: string
  manifestsDir: string
  diagnosticsDir: string
  families: Record<ManagedRuntimeFamily, ManagedRuntimeFamilyPaths>
}

export interface ManagedRuntimeResolvedComponent {
  component: ManagedRuntimeComponent
  version: string
  distribution: ManagedRuntimeDistribution
}

export interface ManagedRuntimeErrorSummary {
  code: string
  message: string
  detail?: string
  at: string
}

export interface ManagedRuntimeVerificationRecord {
  verifiedAt: string
  summary: string
  launchers: Partial<Record<string, string>>
}

export interface ManagedRuntimeWindowsCommandChain {
  command: string
  argsPrefix: string[]
}

export interface ManagedRuntimePersistentState {
  schemaVersion: number
  family: ManagedRuntimeFamily
  pinnedVersion: string
  status: Exclude<ManagedRuntimeStatus, 'installing'>
  activeVersion: string | null
  lastInstalledAt: string | null
  lastRepairedAt: string | null
  lastVerification: ManagedRuntimeVerificationRecord | null
  lastErrorSummary: ManagedRuntimeErrorSummary | null
}

export interface ManagedRuntimeFamilySnapshot {
  family: ManagedRuntimeFamily
  status: ManagedRuntimeStatus
  pinnedVersion: string
  activeVersion: string | null
  updateRecommended: boolean
  installRootDir: string
  stagingDir: string
  activeDir: string
  selectedComponents: readonly ManagedRuntimeResolvedComponent[]
  launcherPaths: Partial<Record<string, string>>
  lastInstalledAt: string | null
  lastRepairedAt: string | null
  lastVerification: ManagedRuntimeVerificationRecord | null
  lastErrorSummary: ManagedRuntimeErrorSummary | null
}

export interface ManagedRuntimeSnapshot {
  manifestVersion: number
  overallStatus: ManagedRuntimeOverallStatus
  target: ManagedRuntimeTarget
  rootDir: string
  hostedRuntimeRootDir: HostedRuntimePaths['runtimeRootDir']
  families: Record<ManagedRuntimeFamily, ManagedRuntimeFamilySnapshot>
}

export interface ManagedRuntimeLauncherResolutionSuccess {
  ok: true
  command: string
  normalizedCommand: ManagedRuntimeLauncherName
  family: ManagedRuntimeFamily
  executablePath: string
  windowsCommandChain: ManagedRuntimeWindowsCommandChain | null
}

export interface ManagedRuntimeLauncherResolutionFailure {
  ok: false
  reason: 'unmanaged_command' | 'managed_runtime_unavailable'
  command: string
  normalizedCommand?: ManagedRuntimeLauncherName
  family?: ManagedRuntimeFamily
  status?: ManagedRuntimeStatus
  message?: string
  detail?: string
}

export type ManagedRuntimeLauncherResolution =
  | ManagedRuntimeLauncherResolutionSuccess
  | ManagedRuntimeLauncherResolutionFailure

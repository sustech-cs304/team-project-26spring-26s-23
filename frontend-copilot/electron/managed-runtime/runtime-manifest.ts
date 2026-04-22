import type {
  ManagedRuntimeComponentManifest,
  ManagedRuntimeDistribution,
  ManagedRuntimeFamily,
  ManagedRuntimeFamilyManifest,
  ManagedRuntimeManifest,
  ManagedRuntimeResolvedComponent,
  ManagedRuntimeSourceChannel,
  ManagedRuntimeTarget,
} from './types'

export const MANAGED_RUNTIME_MANIFEST: ManagedRuntimeManifest = {
  manifestVersion: 1,
  generatedAt: '2026-04-22T00:00:00.000Z',
  releaseEvidence: {
    node: 'Node.js dist index checked on 2026-04-22; selected active LTS v24.15.0 (Krypton).',
    python: 'Python 3.12.10 selected as the last 3.12 full bugfix release with binary installers before source-only security releases.',
    uv: 'astral-sh/uv latest stable release checked on 2026-04-22; selected 0.11.7.',
  },
  sourceChannels: [
    {
      channelId: 'nodejs-dist',
      kind: 'official-dist',
      owner: 'node',
      displayName: 'Node.js official dist',
      baseUrl: 'https://nodejs.org/dist',
      metadataUrl: 'https://nodejs.org/dist/index.json',
      checksumPolicy: 'official-sidecar',
      notes: 'Pinned to active LTS in the v24 line for the first managed runtime rollout.',
    },
    {
      channelId: 'python-org',
      kind: 'python-release',
      owner: 'python',
      displayName: 'Python.org release files',
      baseUrl: 'https://www.python.org/ftp/python',
      metadataUrl: 'https://www.python.org/downloads/',
      checksumPolicy: 'none',
      notes: 'Python 3.12.10 is the last 3.12 release with binary installers; later 3.12 releases are source-only.',
    },
    {
      channelId: 'uv-github-release',
      kind: 'github-release',
      owner: 'uv',
      displayName: 'astral-sh/uv GitHub release assets',
      baseUrl: 'https://github.com/astral-sh/uv/releases/download',
      metadataUrl: 'https://api.github.com/repos/astral-sh/uv/releases/latest',
      checksumPolicy: 'official-sidecar',
    },
  ],
  families: [
    {
      family: 'node',
      displayName: 'Node/npm',
      pinnedVersion: '24.15.0',
      status: 'supported',
      components: [
        {
          component: 'node',
          version: '24.15.0',
          versionLine: 'Active LTS (Krypton)',
          sourceOfTruth: 'Node.js official dist index',
          distributions: [
            createNodeDistribution('win32', 'x64', 'node-v24.15.0-win-x64.zip', 'zip'),
            createNodeDistribution('win32', 'arm64', 'node-v24.15.0-win-arm64.zip', 'zip'),
          ],
        },
      ],
    },
    {
      family: 'uv',
      displayName: 'Python/uv',
      pinnedVersion: 'python 3.12.10 + uv 0.11.7',
      status: 'supported',
      components: [
        {
          component: 'python',
          version: '3.12.10',
          versionLine: 'Last full 3.12 bugfix release with binary installers',
          sourceOfTruth: 'Python release schedule / python.org release files',
          distributions: [
            createPythonDistribution('win32', 'x64', 'python-3.12.10-embed-amd64.zip', 'portable-archive', 'zip'),
            createPythonDistribution('win32', 'arm64', 'python-3.12.10-embed-arm64.zip', 'portable-archive', 'zip'),
          ],
        },
        {
          component: 'uv',
          version: '0.11.7',
          versionLine: 'Latest stable at implementation time',
          sourceOfTruth: 'astral-sh/uv latest GitHub release',
          distributions: [
            createUvDistribution('win32', 'x64', 'uv-x86_64-pc-windows-msvc.zip', 'zip'),
            createUvDistribution('win32', 'arm64', 'uv-aarch64-pc-windows-msvc.zip', 'zip'),
          ],
        },
      ],
    },
  ],
}

export function getManagedRuntimeManifest(): ManagedRuntimeManifest {
  return MANAGED_RUNTIME_MANIFEST
}

export function listManagedRuntimeFamilies(): readonly ManagedRuntimeFamilyManifest[] {
  return MANAGED_RUNTIME_MANIFEST.families
}

export function getManagedRuntimeFamilyManifest(family: ManagedRuntimeFamily): ManagedRuntimeFamilyManifest {
  const familyManifest = MANAGED_RUNTIME_MANIFEST.families.find((entry) => entry.family === family)
  if (familyManifest === undefined) {
    throw new Error(`Unknown managed runtime family: ${family}`)
  }

  return familyManifest
}

export function getManagedRuntimeSourceChannel(channelId: string): ManagedRuntimeSourceChannel {
  const channel = MANAGED_RUNTIME_MANIFEST.sourceChannels.find((entry) => entry.channelId === channelId)
  if (channel === undefined) {
    throw new Error(`Unknown managed runtime source channel: ${channelId}`)
  }

  return channel
}

export function resolveManagedRuntimeComponents(
  family: ManagedRuntimeFamily,
  target: ManagedRuntimeTarget,
): ManagedRuntimeResolvedComponent[] {
  const familyManifest = getManagedRuntimeFamilyManifest(family)
  return familyManifest.components.map((component) => ({
    component: component.component,
    version: component.version,
    distribution: resolveManagedRuntimeDistribution(component, target),
  }))
}

export function resolveManagedRuntimeDistribution(
  component: ManagedRuntimeComponentManifest,
  target: ManagedRuntimeTarget,
): ManagedRuntimeDistribution {
  const distribution = component.distributions.find((candidate) => matchesManagedRuntimeTarget(candidate.target, target))
  if (distribution === undefined) {
    throw new Error(
      `No managed runtime distribution declared for component ${component.component} on ${target.platform}/${target.arch}.`,
    )
  }

  return distribution
}

export function matchesManagedRuntimeTarget(candidate: ManagedRuntimeTarget, target: ManagedRuntimeTarget): boolean {
  return candidate.platform === target.platform && candidate.arch === target.arch
}

function createNodeDistribution(
  platform: ManagedRuntimeTarget['platform'],
  arch: ManagedRuntimeTarget['arch'],
  fileName: string,
  archiveFormat: ManagedRuntimeDistribution['archiveFormat'],
): ManagedRuntimeDistribution {
  return {
    target: { platform, arch },
    fileName,
    url: `https://nodejs.org/dist/v24.15.0/${fileName}`,
    checksumUrl: 'https://nodejs.org/dist/v24.15.0/SHASUMS256.txt',
    archiveFormat,
    installStrategy: 'portable-archive',
    launcherRelativePaths: platform === 'win32'
      ? { node: 'node.exe', npm: 'npm.cmd', npx: 'npx.cmd' }
      : { node: 'bin/node', npm: 'bin/npm', npx: 'bin/npx' },
    sourceChannelId: 'nodejs-dist',
  }
}

function createPythonDistribution(
  platform: ManagedRuntimeTarget['platform'],
  arch: ManagedRuntimeTarget['arch'],
  fileName: string,
  installStrategy: ManagedRuntimeDistribution['installStrategy'],
  archiveFormat: ManagedRuntimeDistribution['archiveFormat'],
): ManagedRuntimeDistribution {
  return {
    target: { platform, arch },
    fileName,
    url: `https://www.python.org/ftp/python/3.12.10/${fileName}`,
    archiveFormat,
    installStrategy,
    launcherRelativePaths: platform === 'win32'
      ? { python: 'python.exe' }
      : platform === 'darwin'
        ? { python: 'Python.framework/Versions/3.12/bin/python3' }
        : { python: 'bin/python3' },
    sourceChannelId: 'python-org',
  }
}

function createUvDistribution(
  platform: ManagedRuntimeTarget['platform'],
  arch: ManagedRuntimeTarget['arch'],
  fileName: string,
  archiveFormat: ManagedRuntimeDistribution['archiveFormat'],
): ManagedRuntimeDistribution {
  return {
    target: { platform, arch },
    fileName,
    url: `https://github.com/astral-sh/uv/releases/download/0.11.7/${fileName}`,
    checksumUrl: `https://github.com/astral-sh/uv/releases/download/0.11.7/${fileName}.sha256`,
    archiveFormat,
    installStrategy: 'portable-archive',
    launcherRelativePaths: platform === 'win32'
      ? { uv: 'uv.exe', uvx: 'uvx.exe' }
      : { uv: 'uv', uvx: 'uvx' },
    sourceChannelId: 'uv-github-release',
  }
}

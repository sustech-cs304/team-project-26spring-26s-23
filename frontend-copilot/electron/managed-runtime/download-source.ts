import { getManagedRuntimeSourceChannel } from './runtime-manifest'
import type {
  ManagedRuntimeDistribution,
  ManagedRuntimeResolvedComponent,
  ManagedRuntimeSourceChannel,
  ManagedRuntimeTarget,
} from './types'

export interface ManagedRuntimeResolvedDownloadSource {
  channel: ManagedRuntimeSourceChannel
  component: ManagedRuntimeResolvedComponent['component']
  version: string
  target: ManagedRuntimeTarget
  fileName: string
  url: string | null
  checksumUrl: string | null
  archiveFormat: ManagedRuntimeDistribution['archiveFormat']
  installStrategy: ManagedRuntimeDistribution['installStrategy']
}

export function resolveManagedRuntimeDownloadSource(
  resolvedComponent: ManagedRuntimeResolvedComponent,
): ManagedRuntimeResolvedDownloadSource {
  const channel = getManagedRuntimeSourceChannel(resolvedComponent.distribution.sourceChannelId)

  return {
    channel,
    component: resolvedComponent.component,
    version: resolvedComponent.version,
    target: resolvedComponent.distribution.target,
    fileName: resolvedComponent.distribution.fileName,
    url: resolvedComponent.distribution.url,
    checksumUrl: resolvedComponent.distribution.checksumUrl ?? null,
    archiveFormat: resolvedComponent.distribution.archiveFormat,
    installStrategy: resolvedComponent.distribution.installStrategy,
  }
}


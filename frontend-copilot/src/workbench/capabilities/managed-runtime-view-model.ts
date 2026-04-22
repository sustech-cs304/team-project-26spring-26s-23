import type {
  ManagedRuntimeFamily,
  ManagedRuntimeFamilySnapshot,
  ManagedRuntimeSnapshot,
  ManagedRuntimeStatus,
} from '../../../electron/managed-runtime/types'

export interface ManagedRuntimeFamilyStatusCardViewModel {
  family: ManagedRuntimeFamily
  title: string
  status: ManagedRuntimeStatus
  statusLabel: string
  activeVersion: string | null
  launcherPath: string | null
}

export interface ManagedRuntimeStatusViewModel {
  overallStatus: ManagedRuntimeStatus
  overallLabel: string
  summary: string
  actionLabel: string
  families: ManagedRuntimeFamilyStatusCardViewModel[]
}

export function createManagedRuntimeStatusViewModel(snapshot: ManagedRuntimeSnapshot): ManagedRuntimeStatusViewModel {
  const node = createManagedRuntimeFamilyStatusCardViewModel(snapshot.families.node)
  const uv = createManagedRuntimeFamilyStatusCardViewModel(snapshot.families.uv)
  const overallStatus = snapshot.overallStatus

  return {
    overallStatus,
    overallLabel: resolveManagedRuntimeStatusLabel(overallStatus),
    summary: `Node/npm ${node.statusLabel} · Python/uv ${uv.statusLabel}`,
    actionLabel: overallStatus === 'ready' ? '重新校验并修复' : '一键安装/修复',
    families: [node, uv],
  }
}

export function resolveManagedRuntimeStatusLabel(status: ManagedRuntimeStatus): string {
  switch (status) {
    case 'missing':
      return '未安装'
    case 'installing':
      return '安装中'
    case 'ready':
      return '可用'
    case 'broken':
      return '损坏'
    case 'outdated':
      return '需修复'
    default:
      return status
  }
}

function createManagedRuntimeFamilyStatusCardViewModel(
  snapshot: ManagedRuntimeFamilySnapshot,
): ManagedRuntimeFamilyStatusCardViewModel {
  return {
    family: snapshot.family,
    title: snapshot.family === 'node' ? 'Node/npm' : 'Python/uv',
    status: snapshot.status,
    statusLabel: resolveManagedRuntimeStatusLabel(snapshot.status),
    activeVersion: snapshot.activeVersion,
    launcherPath: resolvePrimaryLauncherPath(snapshot),
  }
}

function resolvePrimaryLauncherPath(snapshot: ManagedRuntimeFamilySnapshot): string | null {
  if (snapshot.family === 'node') {
    return snapshot.launcherPaths.npx ?? snapshot.lastVerification?.launchers.npx ?? null
  }

  return snapshot.launcherPaths.uvx ?? snapshot.lastVerification?.launchers.uvx ?? null
}

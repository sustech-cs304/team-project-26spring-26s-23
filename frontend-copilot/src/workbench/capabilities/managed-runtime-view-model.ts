import type {
  ManagedRuntimeFamily,
  ManagedRuntimeFamilySnapshot,
  ManagedRuntimeSnapshot,
  ManagedRuntimeStatus,
} from '../../../electron/managed-runtime/types'

export interface ManagedRuntimeFamilyStatusCardViewModel {
  family: ManagedRuntimeFamily
  title: string
  description: string
  status: ManagedRuntimeStatus
  statusLabel: string
  pinnedVersion: string
  activeVersion: string | null
  lastVerificationSummary: string | null
  lastErrorSummary: string | null
  lastInstalledAtLabel: string | null
  lastRepairedAtLabel: string | null
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
    description: snapshot.family === 'node'
      ? '用于 MCP stdio 中的 npx 运行链路。'
      : '用于 MCP stdio 中的 Python 与 uvx 运行链路。',
    status: snapshot.status,
    statusLabel: resolveManagedRuntimeStatusLabel(snapshot.status),
    pinnedVersion: snapshot.pinnedVersion,
    activeVersion: snapshot.activeVersion,
    lastVerificationSummary: snapshot.lastVerification?.summary ?? null,
    lastErrorSummary: snapshot.lastErrorSummary?.message ?? null,
    lastInstalledAtLabel: snapshot.lastInstalledAt,
    lastRepairedAtLabel: snapshot.lastRepairedAt,
  }
}

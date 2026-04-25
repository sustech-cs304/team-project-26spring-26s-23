import type {
  SkillRefreshResult,
  SkillRegistryApiFailure,
} from '../../../electron/skill-registry/ipc'
import type {
  SkillRecord,
  SkillValidationIssue,
  SkillValidationStatus,
} from '../../../electron/skill-registry/types'

export type SkillBusyOperation = 'importing' | 'refreshing' | 'toggling' | 'deleting'

export interface SkillRegistrySkillViewModel {
  skillId: string
  displayName: string
  description: string
  source: SkillRecord['source']
  deletable: boolean
  versionLabel: string
  enabled: boolean
  trusted: boolean
  status: SkillValidationStatus
  statusLabel: string
  tags: string[]
  entrySummary: string | null
  resourceCount: number
  resourcesLabel: string
  resourceSummaries: SkillRecord['resourceSummaries']
  validationErrors: SkillValidationIssue[]
  validationWarnings: SkillValidationIssue[]
  updatedAtLabel: string | null
  message: string | null
  messageTone: 'info' | 'warning' | 'error' | 'success'
  busy: boolean
  busyOperation: SkillBusyOperation | null
  activityLabel: string | null
}

export function buildSkillRegistrySkillViewModels(
  skills: readonly SkillRecord[],
  operationMessages: Readonly<Record<string, string | null | undefined>>,
  busyOperations: Readonly<Record<string, SkillBusyOperation | null | undefined>>,
): SkillRegistrySkillViewModel[] {
  return skills
    .map((skill) => {
      const busyOperation = busyOperations[skill.skillId] ?? null
      const operationMessage = operationMessages[skill.skillId] ?? null
      const validationErrorMessage = skill.validation.errors[0]?.message ?? null
      return {
        skillId: skill.skillId,
        displayName: skill.displayName,
        description: skill.description || '尚未填写说明。',
        source: skill.source,
        deletable: skill.source !== 'builtin',
        versionLabel: skill.version?.trim() || '未声明版本',
        enabled: skill.enabled,
        trusted: skill.trusted,
        status: skill.validation.status,
        statusLabel: resolveSkillValidationStatusLabel(skill.validation.status),
        tags: [...skill.tags],
        entrySummary: skill.entrySummary,
        resourceCount: skill.resourceSummaries.length,
        resourcesLabel: `${skill.resourceSummaries.length} 个显式资源`,
        resourceSummaries: skill.resourceSummaries.map((resource) => ({ ...resource })),
        validationErrors: skill.validation.errors.map((error) => ({ ...error })),
        validationWarnings: skill.validation.warnings.map((warning) => ({ ...warning })),
        updatedAtLabel: formatTimestamp(skill.updatedAt),
        message: operationMessage ?? validationErrorMessage,
        messageTone: resolveMessageTone(operationMessage, skill.validation.errors),
        busy: busyOperation !== null,
        busyOperation,
        activityLabel: resolveBusyOperationLabel(busyOperation),
      }
    })
    .sort((left, right) => left.displayName.localeCompare(right.displayName, 'zh-CN'))
}

export function formatSkillImportMessage(skill: SkillRecord): string {
  return `已导入 ${skill.displayName}，当前${skill.enabled ? '已开启' : '已关闭'}。`
}

export function formatSkillToggleMessage(skill: SkillRecord): string {
  return `${skill.displayName} 已${skill.enabled ? '开启' : '关闭'}。`
}

export function formatSkillRefreshMessage(result: SkillRefreshResult, skillId?: string | null): string {
  if (!result.ok) {
    return `刷新失败：${result.error}`
  }

  const matchedResult = typeof skillId === 'string' && skillId.trim() !== ''
    ? result.results.find((entry) => entry.skillId === skillId)
    : null

  if (matchedResult !== null && matchedResult !== undefined) {
    if (matchedResult.status === 'valid') {
      return '刷新完成，Skill 校验通过。'
    }

    return `刷新完成，Skill 校验失败：${matchedResult.errors[0]?.message ?? '请查看校验错误。'}`
  }

  const invalidCount = result.results.filter((entry) => entry.status === 'invalid').length
  if (invalidCount > 0) {
    return `已刷新 ${result.refreshedSkillIds.length} 个 Skill，其中 ${invalidCount} 个校验失败。`
  }

  return `已刷新 ${result.refreshedSkillIds.length} 个 Skill。`
}

export function formatSkillFailureMessage(result: SkillRegistryApiFailure): string {
  if (result.validationErrors !== undefined && result.validationErrors.length > 0) {
    return `${result.error} ${result.validationErrors[0]?.message ?? ''}`.trim()
  }

  return result.error
}

function resolveSkillValidationStatusLabel(status: SkillValidationStatus): string {
  return status === 'valid' ? '校验通过' : '校验失败'
}

function resolveBusyOperationLabel(operation: SkillBusyOperation | null): string | null {
  switch (operation) {
    case 'importing':
      return '导入中'
    case 'refreshing':
      return '刷新中'
    case 'toggling':
      return '更新中'
    case 'deleting':
      return '删除中'
    default:
      return null
  }
}

function resolveMessageTone(
  operationMessage: string | null,
  validationErrors: readonly SkillValidationIssue[],
): SkillRegistrySkillViewModel['messageTone'] {
  if (operationMessage !== null) {
    return inferMessageTone(operationMessage)
  }

  if (validationErrors.length > 0) {
    return 'error'
  }

  return 'success'
}

function inferMessageTone(message: string): SkillRegistrySkillViewModel['messageTone'] {
  if (/失败|错误|不可用|failed|error/iu.test(message)) {
    return 'error'
  }

  if (/注意|校验失败|warning|invalid/iu.test(message)) {
    return 'warning'
  }

  if (/成功|完成|已导入|已开启|已关闭|已删除|已刷新|通过/iu.test(message)) {
    return 'success'
  }

  return 'info'
}

function formatTimestamp(value: string | null | undefined): string | null {
  if (typeof value !== 'string' || value.trim() === '') {
    return null
  }

  return value.replace('T', ' ').replace(/\.\d{3}Z$/, 'Z')
}

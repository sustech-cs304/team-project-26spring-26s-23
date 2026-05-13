import { useCallback, useEffect, useMemo, useState } from 'react'

import type {
  SkillRecord,
  SkillRegistrySubscriptionEvent,
  SkillValidationIssue,
} from '../../../electron/skill-registry/types'
import type { SkillRegistryClient } from './skill-registry-client'
import { createWindowSkillRegistryClient } from './skill-registry-client'
import {
  buildSkillRegistrySkillViewModels,
  formatSkillFailureMessage,
  formatSkillImportMessage,
  formatSkillToggleMessage,
  type SkillBusyOperation,
  type SkillRegistrySkillViewModel,
} from './skill-registry-view-model'

interface SkillRegistryState {
  loadStatus: 'loading' | 'ready' | 'error'
  loadError: string | null
  registryRevision: number
  snapshotRevision: number
  skills: SkillRecord[]
  operationMessages: Record<string, string | null>
  busyOperations: Record<string, SkillBusyOperation | null>
  globalBusyOperation: SkillBusyOperation | null
  globalMessage: string | null
  globalMessageTone: 'info' | 'warning' | 'error' | 'success'
  importValidationErrors: SkillValidationIssue[]
}

export type SkillImportFromPathResult =
  | { ok: true }
  | { ok: false, errorMessage: string, validationErrors: SkillValidationIssue[] }

export interface UseSkillRegistryResult {
  loadStatus: SkillRegistryState['loadStatus']
  registryRevision: number
  snapshotRevision: number
  rawSkills: readonly SkillRecord[]
  skills: readonly SkillRegistrySkillViewModel[]
  statusMessage: string | null
  globalBusyOperation: SkillBusyOperation | null
  globalMessage: string | null
  globalMessageTone: SkillRegistryState['globalMessageTone']
  importValidationErrors: readonly SkillValidationIssue[]
  selectAndImportSkill: () => Promise<SkillImportFromPathResult>
  toggleSkillEnabled: (skillId: string) => Promise<void>
  deleteSkill: (skillId: string) => Promise<void>
  refreshSkill: (skillId: string) => Promise<void>
  refreshSkills: () => Promise<void>
}

const INITIAL_STATE: SkillRegistryState = {
  loadStatus: 'loading',
  loadError: null,
  registryRevision: 0,
  snapshotRevision: 0,
  skills: [],
  operationMessages: {},
  busyOperations: {},
  globalBusyOperation: null,
  globalMessage: null,
  globalMessageTone: 'info',
  importValidationErrors: [],
}

export function useSkillRegistry(client?: SkillRegistryClient): UseSkillRegistryResult {
  const resolvedClient = useMemo(() => client ?? createWindowSkillRegistryClient(), [client])
  const [registryState, setRegistryState] = useState<SkillRegistryState>(INITIAL_STATE)

  useSkillRegistryLoad(resolvedClient, setRegistryState)

  const setBusyOperation = useCallback((skillId: string, operation: SkillBusyOperation | null) => {
    setRegistryState((previous) => ({
      ...previous,
      busyOperations: {
        ...previous.busyOperations,
        [skillId]: operation,
      },
    }))
  }, [])

  const setOperationMessage = useCallback((skillId: string, message: string | null) => {
    setRegistryState((previous) => ({
      ...previous,
      operationMessages: { ...previous.operationMessages, [skillId]: message },
    }))
  }, [])

  const setGlobalOperation = useCallback((
    operation: SkillBusyOperation | null,
    message: string | null,
    tone: SkillRegistryState['globalMessageTone'] = 'info',
    validationErrors: SkillValidationIssue[] = [],
  ) => {
    setRegistryState((previous) => ({
      ...previous,
      globalBusyOperation: operation,
      globalMessage: message,
      globalMessageTone: tone,
      importValidationErrors: validationErrors.map((error) => ({ ...error })),
    }))
  }, [])

  const selectAndImportSkill = useSkillRegistryImport(
    resolvedClient,
    setRegistryState,
    setGlobalOperation,
  )

  const {
    toggleSkillEnabled,
    deleteSkill,
    refreshSkill,
    refreshSkills,
  } = useSkillRegistryOperations({
    resolvedClient,
    registryState,
    setRegistryState,
    setBusyOperation,
    setOperationMessage,
    setGlobalOperation,
  })

  const skills = useMemo(
    () => buildSkillRegistrySkillViewModels(
      registryState.skills,
      registryState.operationMessages,
      registryState.busyOperations,
    ),
    [registryState.busyOperations, registryState.operationMessages, registryState.skills],
  )

  return {
    loadStatus: registryState.loadStatus,
    registryRevision: registryState.registryRevision,
    snapshotRevision: registryState.snapshotRevision,
    rawSkills: registryState.skills,
    skills,
    statusMessage: resolveStatusMessage(registryState),
    globalBusyOperation: registryState.globalBusyOperation,
    globalMessage: registryState.globalMessage,
    globalMessageTone: registryState.globalMessageTone,
    importValidationErrors: registryState.importValidationErrors,
    selectAndImportSkill,
    toggleSkillEnabled,
    deleteSkill,
    refreshSkill,
    refreshSkills,
  }
}

function useSkillRegistryLoad(
  resolvedClient: SkillRegistryClient,
  setRegistryState: React.Dispatch<React.SetStateAction<SkillRegistryState>>,
) {
  useEffect(() => {
    let cancelled = false

    setRegistryState((previous) => ({ ...previous, loadStatus: 'loading', loadError: null }))

    void resolvedClient.loadRegistry({ includeDisabled: true }).then((result) => {
      if (cancelled) {
        return
      }

      setRegistryState((previous) => result.ok
        ? {
            ...previous,
            loadStatus: 'ready',
            loadError: null,
            registryRevision: result.registryRevision,
            snapshotRevision: result.snapshotRevision,
            skills: result.skills.map(cloneSkillRecord),
          }
        : { ...previous, loadStatus: 'error', loadError: result.error })
    })

    const unsubscribe = resolvedClient.subscribe((event) => {
      if (!cancelled) {
        setRegistryState((previous) => applyRegistrySubscriptionEvent(previous, event))
      }
    })

    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [resolvedClient, setRegistryState])
}

function useSkillRegistryImport(
  resolvedClient: SkillRegistryClient,
  setRegistryState: React.Dispatch<React.SetStateAction<SkillRegistryState>>,
  setGlobalOperation: (
    operation: SkillBusyOperation | null,
    message: string | null,
    tone?: SkillRegistryState['globalMessageTone'],
    validationErrors?: SkillValidationIssue[],
  ) => void,
) {
  return useCallback(async (): Promise<SkillImportFromPathResult> => {
    setGlobalOperation('importing', null, 'info')
    try {
      const result = await resolvedClient.selectAndImportSkill()
      if (!result.ok) {
        const message = formatSkillFailureMessage(result)
        setGlobalOperation(
          null,
          result.validationErrors !== undefined && result.validationErrors.length > 0 ? null : message,
          'error',
          result.validationErrors ?? [],
        )
        return { ok: false, errorMessage: message, validationErrors: result.validationErrors ?? [] }
      }
      if (result.skill === undefined) {
        setGlobalOperation(null, null, 'info')
        return { ok: true }
      }

      setRegistryState((previous) => upsertSkill({
        ...previous,
        loadStatus: 'ready',
        loadError: null,
        registryRevision: result.registryRevision,
        snapshotRevision: result.snapshotRevision,
        globalBusyOperation: null,
        globalMessage: formatSkillImportMessage(result.skill),
        globalMessageTone: 'success',
        importValidationErrors: [],
      }, result.skill))
      return { ok: true }
    } finally {
      setRegistryState((previous) => previous.globalBusyOperation === 'importing'
        ? { ...previous, globalBusyOperation: null }
        : previous)
    }
  }, [resolvedClient, setRegistryState, setGlobalOperation])
}

interface SkillRegistryOpInput {
  resolvedClient: SkillRegistryClient
  registryState: SkillRegistryState
  setRegistryState: React.Dispatch<React.SetStateAction<SkillRegistryState>>
  setBusyOperation: (skillId: string, operation: SkillBusyOperation | null) => void
  setOperationMessage: (skillId: string, message: string | null) => void
  setGlobalOperation: (
    operation: SkillBusyOperation | null,
    message: string | null,
    tone?: SkillRegistryState['globalMessageTone'],
    validationErrors?: SkillValidationIssue[],
  ) => void
}

function useSkillRegistryOperations(input: SkillRegistryOpInput) {
  const {
    resolvedClient,
    registryState,
    setRegistryState,
    setBusyOperation,
    setOperationMessage,
    setGlobalOperation,
  } = input

  const toggleSkillEnabled = useCallback(async (skillId: string) => {
    const skill = registryState.skills.find((entry) => entry.skillId === skillId)
    if (skill === undefined) {
      return
    }

    setBusyOperation(skillId, 'toggling')
    try {
      const result = await resolvedClient.setSkillEnabled({ skillId, enabled: !skill.enabled })
      if (!result.ok) {
        setOperationMessage(skillId, result.error)
        return
      }

      setRegistryState((previous) => upsertSkill({
        ...previous,
        loadStatus: 'ready',
        loadError: null,
        registryRevision: result.registryRevision,
        snapshotRevision: result.snapshotRevision,
      }, result.skill))
      setOperationMessage(skillId, formatSkillToggleMessage(result.skill))
    } finally {
      setBusyOperation(skillId, null)
    }
  }, [registryState.skills, resolvedClient, setBusyOperation, setOperationMessage, setRegistryState])

  const deleteSkill = useCallback(async (skillId: string) => {
    setBusyOperation(skillId, 'deleting')
    try {
      const result = await resolvedClient.deleteSkill(skillId)
      if (!result.ok) {
        setOperationMessage(skillId, result.error)
        return
      }

      setRegistryState((previous) => removeSkill({
        ...previous,
        registryRevision: result.registryRevision,
        snapshotRevision: result.snapshotRevision,
        globalMessage: `Skill ${skillId} 已删除。`,
        globalMessageTone: 'success',
      }, skillId))
    } finally {
      setBusyOperation(skillId, null)
    }
  }, [resolvedClient, setBusyOperation, setOperationMessage, setRegistryState])

  const refreshSkill = useCallback(async (skillId: string) => {
    setBusyOperation(skillId, 'refreshing')
    try {
      const result = await resolvedClient.refreshSkills({ skillId })
      if (!result.ok) {
        setOperationMessage(skillId, result.error)
        return
      }

      setRegistryState((previous) => ({
        ...previous,
        registryRevision: result.registryRevision,
        snapshotRevision: result.snapshotRevision,
      }))
      setOperationMessage(skillId, null)
    } finally {
      setBusyOperation(skillId, null)
    }
  }, [resolvedClient, setBusyOperation, setOperationMessage, setRegistryState])

  const refreshSkills = useCallback(async () => {
    setGlobalOperation('refreshing', null, 'info')
    try {
      const result = await resolvedClient.refreshSkills()
      if (!result.ok) {
        setGlobalOperation(null, result.error, 'error')
        return
      }

      setRegistryState((previous) => ({
        ...previous,
        registryRevision: result.registryRevision,
        snapshotRevision: result.snapshotRevision,
        globalBusyOperation: null,
        globalMessage: null,
        globalMessageTone: 'info',
      }))
    } finally {
      setRegistryState((previous) => previous.globalBusyOperation === 'refreshing'
        ? { ...previous, globalBusyOperation: null }
        : previous)
    }
  }, [resolvedClient, setGlobalOperation, setRegistryState])

  return { toggleSkillEnabled, deleteSkill, refreshSkill, refreshSkills }
}

function resolveStatusMessage(registryState: SkillRegistryState): string | null {
  if (registryState.loadStatus === 'loading') {
    return '正在加载 Skills 列表…'
  }

  if (registryState.loadStatus === 'error') {
    return registryState.loadError
  }

  return null
}

function applyRegistrySubscriptionEvent(previous: SkillRegistryState, event: SkillRegistrySubscriptionEvent): SkillRegistryState {
  if (event.kind === 'snapshot') {
    return pruneRegistryState({
      ...previous,
      loadStatus: 'ready',
      loadError: null,
      registryRevision: event.registryRevision,
      snapshotRevision: event.snapshotRevision,
      skills: event.skills.map(cloneSkillRecord),
    })
  }

  if (event.kind === 'skill-updated') {
    return upsertSkill({
      ...previous,
      loadStatus: 'ready',
      loadError: null,
      registryRevision: event.registryRevision,
      snapshotRevision: event.snapshotRevision,
    }, event.skill)
  }

  if (event.kind === 'skill-deleted') {
    return removeSkill({
      ...previous,
      registryRevision: event.registryRevision,
      snapshotRevision: event.snapshotRevision,
    }, event.skillId)
  }

  return previous
}

function upsertSkill(previous: SkillRegistryState, nextSkill: SkillRecord): SkillRegistryState {
  const existingIndex = previous.skills.findIndex((skill) => skill.skillId === nextSkill.skillId)
  const skills = existingIndex === -1
    ? [...previous.skills.map(cloneSkillRecord), cloneSkillRecord(nextSkill)]
    : previous.skills.map((skill, index) => index === existingIndex ? cloneSkillRecord(nextSkill) : cloneSkillRecord(skill))

  return { ...previous, skills }
}

function removeSkill(previous: SkillRegistryState, skillId: string): SkillRegistryState {
  const operationMessages = { ...previous.operationMessages }
  const busyOperations = { ...previous.busyOperations }
  delete operationMessages[skillId]
  delete busyOperations[skillId]

  return {
    ...previous,
    skills: previous.skills.filter((skill) => skill.skillId !== skillId),
    operationMessages,
    busyOperations,
  }
}

function pruneRegistryState(previous: SkillRegistryState): SkillRegistryState {
  const knownSkillIds = new Set(previous.skills.map((skill) => skill.skillId))
  return {
    ...previous,
    operationMessages: Object.fromEntries(
      Object.entries(previous.operationMessages).filter(([skillId]) => knownSkillIds.has(skillId)),
    ),
    busyOperations: Object.fromEntries(
      Object.entries(previous.busyOperations).filter(([skillId]) => knownSkillIds.has(skillId)),
    ),
  }
}

function cloneSkillRecord(skill: SkillRecord): SkillRecord {
  return {
    ...skill,
    tags: [...skill.tags],
    capabilities: { ...skill.capabilities, scripts: false },
    validation: {
      status: skill.validation.status,
      errors: skill.validation.errors.map((error) => ({ ...error })),
      warnings: skill.validation.warnings.map((warning) => ({ ...warning })),
    },
    resourceSummaries: skill.resourceSummaries.map((resource) => ({ ...resource })),
  }
}

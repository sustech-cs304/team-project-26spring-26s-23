import { useEffect, useRef, useState } from 'react'

import {
  applyConfigCenterPublicPatch,
  loadConfigCenterPublicSnapshot,
  subscribeToConfigCenterPublicSnapshotUpdates,
} from '../../../../features/copilot/config-center'
import type { ConfigCenterPublicTextFieldDefinition } from './config-center-public-field-definitions'
import {
  applyConfigCenterPublicTextFieldFailure,
  applyConfigCenterPublicTextFieldSaveSuccess,
  applyDraftValueToConfigCenterPublicTextField,
  applyExternalSnapshotToConfigCenterPublicTextField,
  createLoadingConfigCenterPublicTextFieldState,
  normalizeConfigCenterPublicTextFieldValue,
  shouldCommitConfigCenterPublicTextField,
  startSavingConfigCenterPublicTextField,
  syncEquivalentDraftToConfigCenterPublicTextField,
  type ConfigCenterPublicTextFieldState,
} from './ConfigCenterPublicFieldDomain'

export interface ConfigCenterPublicTextFieldController {
  state: ConfigCenterPublicTextFieldState
  updateDraftValue: (nextDraftValue: string) => void
  commitDraftValue: () => Promise<void>
}

export function useConfigCenterPublicTextField(
  definition: ConfigCenterPublicTextFieldDefinition,
): ConfigCenterPublicTextFieldController {
  const [state, setState] = useState<ConfigCenterPublicTextFieldState>(() => createLoadingConfigCenterPublicTextFieldState())
  const stateRef = useRef(state)

  useEffect(() => {
    stateRef.current = state
  }, [state])

  useEffect(() => {
    let active = true

    setState(createLoadingConfigCenterPublicTextFieldState())

    void loadConfigCenterPublicSnapshot().then((result) => {
      if (!active) {
        return
      }

      if (result.ok) {
        setState((currentState) =>
          applyExternalSnapshotToConfigCenterPublicTextField(currentState, definition.readFromSnapshot(result.snapshot)),
        )
        return
      }

      setState((currentState) => applyConfigCenterPublicTextFieldFailure(currentState, result.error))
    })

    const unsubscribe = subscribeToConfigCenterPublicSnapshotUpdates((snapshot) => {
      if (!active) {
        return
      }

      setState((currentState) =>
        applyExternalSnapshotToConfigCenterPublicTextField(currentState, definition.readFromSnapshot(snapshot)),
      )
    })

    return () => {
      active = false
      unsubscribe()
    }
  }, [definition])

  async function commitDraftValue() {
    const currentState = syncEquivalentDraftToConfigCenterPublicTextField(stateRef.current)

    if (currentState.status === 'saving') {
      return
    }

    if (!shouldCommitConfigCenterPublicTextField(currentState)) {
      setState(currentState)
      return
    }

    const patchValue = normalizeConfigCenterPublicTextFieldValue(currentState.draftValue)
    setState(startSavingConfigCenterPublicTextField(currentState))

    const result = await applyConfigCenterPublicPatch(definition.createPatch(patchValue))

    if (result.ok) {
      setState((latestState) =>
        applyConfigCenterPublicTextFieldSaveSuccess(latestState, definition.readFromSnapshot(result.snapshot)),
      )
      return
    }

    setState((latestState) => applyConfigCenterPublicTextFieldFailure(latestState, result.error))
  }

  return {
    state,
    updateDraftValue(nextDraftValue: string) {
      setState((currentState) => applyDraftValueToConfigCenterPublicTextField(currentState, nextDraftValue))
    },
    commitDraftValue,
  }
}

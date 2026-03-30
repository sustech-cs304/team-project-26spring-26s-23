import {
  applyConfigCenterPublicPatch,
  loadConfigCenterPublicSnapshot,
  projectAnimationsEnabledFromConfigCenterPublicSnapshot,
  subscribeToConfigCenterPublicSnapshotUpdates,
} from '../features/copilot/config-center'

export type AnimationsPreferenceLoadResult =
  | { ok: true; animationsEnabled: boolean }
  | { ok: false; error: string }

export type AnimationsPreferenceSaveResult =
  | { ok: true; animationsEnabled: boolean }
  | { ok: false; error: string; revertedAnimationsEnabled: boolean }

export async function loadAnimationsEnabledPreference(): Promise<AnimationsPreferenceLoadResult> {
  const result = await loadConfigCenterPublicSnapshot()

  if (!result.ok) {
    return {
      ok: false,
      error: result.error,
    }
  }

  return {
    ok: true,
    animationsEnabled: projectAnimationsEnabledFromConfigCenterPublicSnapshot(result.snapshot),
  }
}

export async function persistAnimationsEnabledPreference(input: {
  previousAnimationsEnabled: boolean
  animationsEnabled: boolean
  applyAnimationsEnabled: (animationsEnabled: boolean) => void
}): Promise<AnimationsPreferenceSaveResult> {
  input.applyAnimationsEnabled(input.animationsEnabled)

  const result = await applyConfigCenterPublicPatch({
    domains: {
      frontendPreferences: {
        animationsEnabled: input.animationsEnabled,
      },
    },
  })

  if (!result.ok) {
    input.applyAnimationsEnabled(input.previousAnimationsEnabled)
    return {
      ok: false,
      error: result.error,
      revertedAnimationsEnabled: input.previousAnimationsEnabled,
    }
  }

  const nextAnimationsEnabled = projectAnimationsEnabledFromConfigCenterPublicSnapshot(result.snapshot)
  input.applyAnimationsEnabled(nextAnimationsEnabled)

  return {
    ok: true,
    animationsEnabled: nextAnimationsEnabled,
  }
}

export function subscribeToAnimationsEnabledPreferenceUpdates(
  listener: (animationsEnabled: boolean) => void,
) {
  return subscribeToConfigCenterPublicSnapshotUpdates((snapshot) => {
    listener(projectAnimationsEnabledFromConfigCenterPublicSnapshot(snapshot))
  })
}

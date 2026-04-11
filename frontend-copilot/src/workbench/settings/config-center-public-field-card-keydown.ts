import type { KeyboardEvent as ReactKeyboardEvent } from 'react'

export function handleConfigCenterPublicTextFieldKeyDown(
  event: ReactKeyboardEvent<HTMLInputElement>,
  commitDraftValue: () => Promise<void>,
) {
  if (event.key !== 'Enter') {
    return
  }

  event.preventDefault()
  void commitDraftValue()
}

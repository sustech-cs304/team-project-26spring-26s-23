import type { SustechInfoSectionDomain as SustechInfoSectionViewDomain } from '../../SustechInfoSection'

export interface CreateSustechInfoSectionDomainArgs {
  studentId: string
  sustechEmail: string
  sustechEmailFocused: boolean
  casPasswordDraft: string
  casPasswordFeedback: string | null
  blackboardAutoDownloadEnabled: boolean
  blackboardDownloadLimitMb: string
  onStudentIdChange: (value: string) => void
  onSustechEmailChange: (value: string) => void
  onSustechEmailFocusChange: (focused: boolean) => void
  onCasPasswordDraftChange: (value: string) => void
  onPersistCasPasswordDraft: () => void | Promise<void>
  onBlackboardAutoDownloadEnabledChange: (value: boolean) => void
  onBlackboardDownloadLimitMbChange: (value: string) => void
}

export function createSustechInfoSectionDomain(
  args: CreateSustechInfoSectionDomainArgs,
): SustechInfoSectionViewDomain {
  const normalizedStudentId = args.studentId.trim()
  const derivedSustechEmail = normalizedStudentId === ''
    ? ''
    : `${normalizedStudentId}@sustech.edu.cn`
  const displayedSustechEmail = args.sustechEmail.trim() || (!args.sustechEmailFocused ? derivedSustechEmail : '')

  return {
    studentId: args.studentId,
    displayedSustechEmail,
    casPasswordDraft: args.casPasswordDraft,
    casPasswordFeedback: args.casPasswordFeedback,
    blackboardAutoDownloadEnabled: args.blackboardAutoDownloadEnabled,
    blackboardDownloadLimitMb: args.blackboardDownloadLimitMb,
    onStudentIdChange: args.onStudentIdChange,
    onSustechEmailChange: args.onSustechEmailChange,
    onSustechEmailFocusChange: args.onSustechEmailFocusChange,
    onCasPasswordDraftChange: args.onCasPasswordDraftChange,
    onPersistCasPasswordDraft: args.onPersistCasPasswordDraft,
    onBlackboardAutoDownloadEnabledChange: args.onBlackboardAutoDownloadEnabledChange,
    onBlackboardDownloadLimitMbChange: args.onBlackboardDownloadLimitMbChange,
  }
}

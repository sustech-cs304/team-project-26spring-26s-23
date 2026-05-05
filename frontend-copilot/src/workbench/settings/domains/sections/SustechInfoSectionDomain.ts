import type { SustechInfoSectionDomain as SustechInfoSectionViewDomain } from '../../SustechInfoSection'

export interface CreateSustechInfoSectionDomainArgs {
  studentId: string
  sustechEmail: string
  sustechEmailFocused: boolean
  casPasswordDraft: string
  casPasswordFeedback: string | null
  blackboardCurrentTermOnly: boolean
  blackboardParallelSyncWorkers: string
  onStudentIdChange: (value: string) => void
  onSustechEmailChange: (value: string) => void
  onSustechEmailFocusChange: (focused: boolean) => void
  onCasPasswordDraftChange: (value: string) => void
  onPersistCasPasswordDraft: () => void | Promise<void>
  onBlackboardCurrentTermOnlyChange: (value: boolean) => void
  onBlackboardParallelSyncWorkersChange: (value: string) => void
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
    blackboardCurrentTermOnly: args.blackboardCurrentTermOnly,
    blackboardParallelSyncWorkers: args.blackboardParallelSyncWorkers,
    onStudentIdChange: args.onStudentIdChange,
    onSustechEmailChange: args.onSustechEmailChange,
    onSustechEmailFocusChange: args.onSustechEmailFocusChange,
    onCasPasswordDraftChange: args.onCasPasswordDraftChange,
    onPersistCasPasswordDraft: args.onPersistCasPasswordDraft,
    onBlackboardCurrentTermOnlyChange: args.onBlackboardCurrentTermOnlyChange,
    onBlackboardParallelSyncWorkersChange: args.onBlackboardParallelSyncWorkersChange,
  }
}

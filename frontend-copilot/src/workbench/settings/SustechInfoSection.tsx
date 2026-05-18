import { getSustechInfoCopy } from '../locale'
import { TextField, ToggleSwitch } from '../components/FormFields'

export interface SustechInfoSectionDomain {
  studentId: string
  displayedSustechEmail: string
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

interface SustechInfoSectionProps {
  sustech: SustechInfoSectionDomain
  language: string
}

export function SustechInfoSection({ sustech, language }: SustechInfoSectionProps) {
  const {
    studentId,
    displayedSustechEmail,
    casPasswordDraft,
    casPasswordFeedback,
    blackboardCurrentTermOnly,
    blackboardParallelSyncWorkers,
    onStudentIdChange,
    onSustechEmailChange,
    onSustechEmailFocusChange,
    onCasPasswordDraftChange,
    onPersistCasPasswordDraft,
    onBlackboardCurrentTermOnlyChange,
    onBlackboardParallelSyncWorkersChange,
  } = sustech

  const handleBlackboardParallelSyncWorkersChange = (value: string) => {
    if (!/^\d*$/.test(value)) {
      return
    }

    if (value === '') {
      onBlackboardParallelSyncWorkersChange('')
      return
    }

    const normalized = Math.min(6, Math.max(1, Number.parseInt(value, 10) || 1))
    onBlackboardParallelSyncWorkersChange(String(normalized))
  }

  const copy = getSustechInfoCopy(language)

  return (
    <div className="settings-page settings-page--split settings-page--balanced">
      <section className="settings-card settings-card--form">
        <div className="settings-card__header">
          <div>
            <h3 className="settings-card__title">{copy.basicInfoTitle}</h3>
          </div>
        </div>

        <div className="settings-stack">
          <div className="form-grid form-grid--two">
            <TextField
              label={copy.studentIdLabel}
              value={studentId}
              onChange={onStudentIdChange}
              placeholder={copy.studentIdPlaceholder}
            />
            <label className="form-field">
              <span className="form-field__meta">
                <span className="form-field__label">{copy.emailLabel}</span>
              </span>
              <input
                className="text-input"
                type="text"
                value={displayedSustechEmail}
                placeholder={copy.emailPlaceholder}
                onFocus={() => onSustechEmailFocusChange(true)}
                onBlur={() => onSustechEmailFocusChange(false)}
                onChange={(event) => onSustechEmailChange(event.target.value)}
              />
            </label>
            <label className="form-field form-field--full" htmlFor="sustech-cas-password-input">
              <span className="form-field__meta">
                <span className="form-field__label">{copy.casPasswordLabel}</span>
              </span>
              <input
                id="sustech-cas-password-input"
                data-testid="sustech-cas-password-input"
                className="text-input"
                type="password"
                value={casPasswordDraft}
                placeholder={copy.casPasswordPlaceholder}
                onChange={(event) => onCasPasswordDraftChange(event.target.value)}
                onBlur={() => {
                  void onPersistCasPasswordDraft()
                }}
              />
              {casPasswordFeedback ? (
                <span className="form-field__feedback form-field__feedback--success" role="status">
                  {casPasswordFeedback}
                </span>
              ) : null}
            </label>
          </div>
        </div>
      </section>

      <div className="settings-detail-column">
        <section className="settings-card settings-card--form">
          <div className="settings-card__header">
            <div>
              <h3 className="settings-card__title">{copy.blackboardInfoTitle}</h3>
            </div>
          </div>

          <div className="settings-stack">
            <ToggleSwitch
              label={copy.currentTermOnlyLabel}
              description={copy.currentTermOnlyDescription}
              checked={blackboardCurrentTermOnly}
              onChange={onBlackboardCurrentTermOnlyChange}
            />
            <TextField
              label={copy.parallelSyncWorkersLabel}
              value={blackboardParallelSyncWorkers}
              onChange={handleBlackboardParallelSyncWorkersChange}
              placeholder="1"
            />
            <p className="form-field__description">{copy.parallelSyncWorkersDescription}</p>
          </div>
        </section>

        <section className="settings-card settings-card--form">
          <div className="settings-card__header">
            <div>
              <h3 className="settings-card__title">{copy.tisInfoTitle}</h3>
            </div>
          </div>

          <div className="settings-stack">
            <p className="settings-empty-hint">{copy.comingSoon}</p>
          </div>
        </section>
      </div>
    </div>
  )
}

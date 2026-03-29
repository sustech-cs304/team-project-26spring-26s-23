import { TextField, ToggleSwitch } from '../components/FormFields'

interface SustechInfoSectionProps {
  studentId: string
  displayedSustechEmail: string
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

export function SustechInfoSection({
  studentId,
  displayedSustechEmail,
  casPasswordDraft,
  casPasswordFeedback,
  blackboardAutoDownloadEnabled,
  blackboardDownloadLimitMb,
  onStudentIdChange,
  onSustechEmailChange,
  onSustechEmailFocusChange,
  onCasPasswordDraftChange,
  onPersistCasPasswordDraft,
  onBlackboardAutoDownloadEnabledChange,
  onBlackboardDownloadLimitMbChange,
}: SustechInfoSectionProps) {
  const handleBlackboardDownloadLimitChange = (value: string) => {
    if (!/^\d*$/.test(value)) {
      return
    }

    onBlackboardDownloadLimitMbChange(value === '' ? '' : String(Number.parseInt(value, 10) || 0))
  }

  return (
    <div className="settings-page settings-page--split settings-page--balanced">
      <section className="settings-card settings-card--form">
        <div className="settings-card__header">
          <div>
            <h3 className="settings-card__title">基本信息</h3>
          </div>
        </div>

        <div className="settings-stack">
          <div className="form-grid form-grid--two">
            <TextField
              label="学号"
              value={studentId}
              onChange={onStudentIdChange}
              placeholder="输入学号"
            />
            <label className="form-field">
              <span className="form-field__meta">
                <span className="form-field__label">邮箱</span>
              </span>
              <input
                className="text-input"
                type="text"
                value={displayedSustechEmail}
                placeholder="输入邮箱"
                onFocus={() => onSustechEmailFocusChange(true)}
                onBlur={() => onSustechEmailFocusChange(false)}
                onChange={(event) => onSustechEmailChange(event.target.value)}
              />
            </label>
            <label className="form-field form-field--full" htmlFor="sustech-cas-password-input">
              <span className="form-field__meta">
                <span className="form-field__label">CAS 密码</span>
              </span>
              <input
                id="sustech-cas-password-input"
                data-testid="sustech-cas-password-input"
                className="text-input"
                type="password"
                value={casPasswordDraft}
                placeholder="输入 CAS 密码"
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
              <h3 className="settings-card__title">Blackboard 信息</h3>
            </div>
          </div>

          <div className="settings-stack">
            <ToggleSwitch
              label="自动下载 Blackboard 文件"
              checked={blackboardAutoDownloadEnabled}
              onChange={onBlackboardAutoDownloadEnabledChange}
            />
            <TextField
              label="下载文件大小限制（MB）"
              value={blackboardDownloadLimitMb}
              onChange={handleBlackboardDownloadLimitChange}
              placeholder="0"
            />
            <p className="form-field__description">0为不限制</p>
          </div>
        </section>

        <section className="settings-card settings-card--form">
          <div className="settings-card__header">
            <div>
              <h3 className="settings-card__title">TIS 信息</h3>
            </div>
          </div>

          <div className="settings-stack">
            <p className="settings-empty-hint">敬请期待</p>
          </div>
        </section>
      </div>
    </div>
  )
}

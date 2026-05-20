import { ChevronDown, Eye, LoaderCircle, RefreshCw, Trash2 } from 'lucide-react'
import { useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

import type { SkillValidationIssue } from '../../../electron/skill-registry/types'
import { useStaggerListEnter } from '../animation-utils'
import type { SkillRegistrySkillViewModel } from './skill-registry-view-model'

interface SkillsPanelProps {
  skills: readonly SkillRegistrySkillViewModel[]
  statusMessage?: string | null
  importValidationErrors: readonly SkillValidationIssue[]
  onToggleEnabled: (skillId: string) => Promise<void>
  onDelete: (skillId: string) => Promise<void>
  onRefresh: (skillId: string) => Promise<void>
}

export function SkillsPanel({
  skills,
  statusMessage,
  importValidationErrors,
  onToggleEnabled,
  onDelete,
  onRefresh,
}: SkillsPanelProps) {
  const [expandedSkillId, setExpandedSkillId] = useState<string | null>(null)
  const listRef = useRef<HTMLDivElement>(null)
  useStaggerListEnter({ scope: listRef, selector: '.skill-row:not(.skill-row--empty)', itemCount: skills.length })

  return (
    <section className="capabilities-surface capabilities-surface--skills">
      {statusMessage ? (
        <p className="capabilities-surface__status" aria-live="polite">{statusMessage}</p>
      ) : null}
      {importValidationErrors.length > 0 ? (
        <ValidationIssueList
          title="导入遇到问题"
          issues={importValidationErrors}
          className="skills-validation-list--import"
        />
      ) : null}

      <div className="skill-list" ref={listRef}>
        {skills.length === 0 ? (
          <article className="skill-row skill-row--empty">
            <div className="skill-row__meta">
              <h3 className="skill-row__title">还没有 Skills</h3>
              <p className="skill-row__description">
                可从本地文件夹导入 Skill。导入后可在这里开启、关闭、刷新并查看校验结果。
              </p>
            </div>
          </article>
        ) : null}

        {skills.map((skill) => (
          <SkillRow
            key={skill.skillId}
            skill={skill}
            expanded={expandedSkillId === skill.skillId}
            onToggleExpand={() => setExpandedSkillId(expandedSkillId === skill.skillId ? null : skill.skillId)}
            onToggleEnabled={onToggleEnabled}
            onDelete={onDelete}
            onRefresh={onRefresh}
          />
        ))}
      </div>
    </section>
  )
}

function SkillRow({
  skill,
  expanded,
  onToggleExpand,
  onToggleEnabled,
  onDelete,
  onRefresh,
}: {
  skill: SkillRegistrySkillViewModel
  expanded: boolean
  onToggleExpand: () => void
  onToggleEnabled: (skillId: string) => Promise<void>
  onDelete: (skillId: string) => Promise<void>
  onRefresh: (skillId: string) => Promise<void>
}) {
  return (
    <article
      className={`skill-row skill-row--${skill.status}${skill.enabled ? ' skill-row--enabled' : ' skill-row--disabled'}${skill.busy ? ' skill-row--busy' : ''}`}
    >
      <div className="skill-row__meta">
        <div className="skill-row__title-line">
          <h3 className="skill-row__title">{skill.displayName}</h3>
          {skill.activityLabel ? (
            <span className="skill-activity" aria-live="polite">
              <LoaderCircle size={14} className="skill-activity__icon" aria-hidden="true" />
              {skill.activityLabel}
            </span>
          ) : null}
        </div>

        {skill.tags.length > 0 ? (
          <div className="skill-tags" aria-label={`${skill.displayName} 标签`}>
            {skill.tags.map((tag) => (
              <span key={tag} className="skill-tag">{tag}</span>
            ))}
          </div>
        ) : null}
      </div>

      <div className="skill-row__actions">
        <button
          type="button"
          className="mcp-server-action-icon"
          disabled={skill.busy}
          aria-label={expanded ? `收起 ${skill.displayName} 详情` : `查看 ${skill.displayName} 详情`}
          title={expanded ? `收起 ${skill.displayName} 详情` : `查看 ${skill.displayName} 详情`}
          onClick={onToggleExpand}
        >
          {expanded ? <ChevronDown size={16} aria-hidden="true" /> : <Eye size={16} aria-hidden="true" />}
        </button>

        <button
          type="button"
          className="mcp-server-action-icon"
          aria-label={`刷新 ${skill.displayName}`}
          title={`刷新 ${skill.displayName}`}
          disabled={skill.busy}
          onClick={() => void onRefresh(skill.skillId)}
        >
          <RefreshCw size={16} />
        </button>

        <button
          type="button"
          className={`mcp-server-toggle${skill.enabled ? ' mcp-server-toggle--on' : ''}`}
          aria-label={skill.enabled ? `关闭 ${skill.displayName}` : `开启 ${skill.displayName}`}
          title={skill.enabled ? `关闭 ${skill.displayName}` : `开启 ${skill.displayName}`}
          disabled={skill.busy || skill.status === 'invalid'}
          onClick={() => void onToggleEnabled(skill.skillId)}
        >
          <span className="mcp-server-toggle__track">
            <span className="mcp-server-toggle__thumb" />
          </span>
        </button>

        <button
          type="button"
          className="mcp-server-action-icon"
          aria-label={`删除 ${skill.displayName}`}
          title={skill.deletable ? `删除 ${skill.displayName}` : `${skill.displayName} 是内置 Skill，不可删除`}
          disabled={skill.busy || !skill.deletable}
          onClick={() => {
            if (!skill.deletable) {
              return
            }
            if (window.confirm(`确定删除 Skill「${skill.displayName}」吗？此操作会移除应用管理目录中的副本。`)) {
              void onDelete(skill.skillId)
            }
          }}
        >
          <Trash2 size={16} />
        </button>
      </div>

      {skill.message ? (
        <p className={`skill-row__message skill-row__message--${skill.messageTone}`} aria-live="polite">
          {skill.message}
        </p>
      ) : null}

      {expanded ? <SkillDetails skill={skill} /> : null}
    </article>
  )
}

function SkillDetails({ skill }: { skill: SkillRegistrySkillViewModel }) {
  return (
    <div className="skill-row__details-panel">
      <section className="skill-row__detail-column">
        <h4>适用场景</h4>
        <div className="skill-row__detail-scroll skill-row__description-scroll">
          <p className="skill-row__description-detail">{skill.description}</p>
        </div>
      </section>

      <section className="skill-row__detail-column">
        <h4>技能预览</h4>
        {skill.entrySummary ? (
          <div className="skill-row__markdown skill-row__detail-scroll">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>
              {normalizeSkillMarkdown(skill.entrySummary)}
            </ReactMarkdown>
          </div>
        ) : (
          <p>这个 Skill 暂无入口说明。</p>
        )}
      </section>

      <section className="skill-row__detail-column">
        <h4>资源</h4>
        {skill.resourceSummaries.length === 0 ? (
          <p>暂无显式引用资源。</p>
        ) : (
          <ul className="skill-resource-list skill-row__detail-scroll">
            {skill.resourceSummaries.map((resource) => (
              <li key={resource.path}>
                <code>{resource.path}</code>
              </li>
            ))}
          </ul>
        )}
      </section>

      {skill.validationErrors.length > 0 ? (
        <ValidationIssueList title="需要处理的问题" issues={skill.validationErrors} />
      ) : null}

      {skill.validationWarnings.length > 0 ? (
        <ValidationIssueList title="建议检查" issues={skill.validationWarnings} />
      ) : null}
    </div>
  )
}

function normalizeSkillMarkdown(value: string): string {
  return value
    .replace(/^\uFEFF/u, '')
    .replace(/\r\n/g, '\n')
    .replace(/\s+(#{1,6}\s+)/g, '\n\n$1')
    .replace(/([.!?：:])\s+(#{1,6}\s+)/g, '$1\n\n$2')
    .replace(/\s+(-\s+)/g, '\n$1')
    .replace(/\s+(\*\s+)/g, '\n$1')
    .replace(/\s+(\d+\.\s+)/g, '\n$1')
    .replace(/([^\n])\n(-|\*|\d+\.)\s+/g, '$1\n\n$2 ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function ValidationIssueList({
  title,
  issues,
  className = '',
}: {
  title: string
  issues: readonly SkillValidationIssue[]
  className?: string
}) {
  return (
    <section className={`skills-validation-list ${className}`}>
      <h4>{title}</h4>
      <ul>
        {issues.map((issue, index) => (
          <li key={`${issue.fieldPath}:${issue.code}:${index}`}>
            <span className="skills-validation-list__message">{issue.message}</span>
            {issue.fieldPath ? (
              <span className="skills-validation-list__field">位置：{issue.fieldPath}</span>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  )
}

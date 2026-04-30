import { BarChart3, BookOpen, ChevronRight, Download, FolderOpen, MessageSquare } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { WorkbenchLanguage } from '../_locale/types'

interface Course {
  id: number
  course_id: string
  name: string
  code: string | null
  instructor: string | null
  term: string | null
  url?: string | null
  is_active: boolean
  total_grade?: string | null
  listed_grade?: string | null
  total_assignments?: number
  total_resources?: number
  total_announcements?: number
}

export interface DataItem {
  id: number
  resource_id?: string | null
  parent_id?: string | null
  title?: string
  name?: string
  item_name?: string
  body?: string | null
  content?: string | null
  author?: string | null
  score?: string | null
  total_score?: string | null
  percentage?: number | null
  status?: string | null
  grade_type?: string | null
  category?: string | null
  due_date?: string | null
  publish_time?: string | null
  posted_at?: string | null
  graded_date?: string | null
  feedback?: string | null
  type?: string | null
  size?: string | null
  url?: string | null
  local_path?: string | null
  is_downloaded?: boolean
  download_failed?: boolean
}

interface ResourceTreeItem extends DataItem {
  children: ResourceTreeItem[]
  depth: number
}

type DetailTab = 'announcements' | 'assignments' | 'grades' | 'resources'

const TAB_CONFIG: { key: DetailTab; labelZh: string; labelEn: string; icon: typeof BookOpen }[] = [
  { key: 'announcements', labelZh: '公告', labelEn: 'Announcements', icon: MessageSquare },
  { key: 'assignments', labelZh: '作业', labelEn: 'Assignments', icon: BookOpen },
  { key: 'grades', labelZh: '成绩', labelEn: 'Grades', icon: BarChart3 },
  { key: 'resources', labelZh: '资源', labelEn: 'Resources', icon: FolderOpen },
]

const DETAIL_TAB_FADE_OUT_MS = 110

interface DetailTabState {
  items: DataItem[]
  loading: boolean
  error: string | null
}

function createInitialDetailTabState(): Record<DetailTab, DetailTabState> {
  return {
    announcements: { items: [], loading: false, error: null },
    assignments: { items: [], loading: false, error: null },
    grades: { items: [], loading: false, error: null },
    resources: { items: [], loading: false, error: null },
  }
}

export function splitCourseDisplayName(name: string): { prefix: string | null; title: string } {
  const match = /^([^:：]+)[:：]\s*(.+)$/.exec(name.trim())
  if (!match) {
    return { prefix: null, title: name }
  }

  const prefix = match[1]?.trim() ?? ''
  const title = match[2]?.trim() ?? ''
  if (!prefix || !title) {
    return { prefix: null, title: name }
  }
  return { prefix, title }
}

export function formatDetailTimestamp(value: string | null | undefined, isEnglish: boolean, now = new Date()): string | null {
  if (!value) return null

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return value
  }

  const dayMs = 24 * 60 * 60 * 1000
  const diffMs = now.getTime() - date.getTime()
  if (diffMs >= 0 && diffMs < 30 * dayMs) {
    const daysAgo = Math.floor(diffMs / dayMs)
    if (daysAgo <= 0) {
      return isEnglish ? 'Today' : '今天'
    }
    if (isEnglish) {
      return `${daysAgo} ${daysAgo === 1 ? 'day' : 'days'} ago`
    }
    return `${daysAgo} 天前`
  }

  return value.slice(0, 10)
}

export function flattenResourceHierarchy(items: DataItem[]): ResourceTreeItem[] {
  const nodes = new Map<string, ResourceTreeItem>()
  const roots: ResourceTreeItem[] = []

  items.forEach((item, index) => {
    const key = item.resource_id ?? `row-${item.id ?? index}`
    nodes.set(key, { ...item, children: [], depth: 0 })
  })

  items.forEach((item, index) => {
    const key = item.resource_id ?? `row-${item.id ?? index}`
    const node = nodes.get(key)
    if (!node) return

    const parentKey = item.parent_id ?? null
    const parent = parentKey ? nodes.get(parentKey) : null
    if (parent && parent !== node) {
      parent.children.push(node)
      return
    }
    roots.push(node)
  })

  const result: ResourceTreeItem[] = []
  const append = (node: ResourceTreeItem, depth: number) => {
    node.depth = depth
    result.push(node)
    node.children.forEach((child) => append(child, depth + 1))
  }
  roots.forEach((root) => append(root, 0))
  return result
}

function courseMatchesSearch(course: Course, query: string): boolean {
  const keyword = query.trim().toLocaleLowerCase()
  if (!keyword) {
    return true
  }

  const displayName = splitCourseDisplayName(course.name)
  return [
    course.course_id,
    course.code,
    course.name,
    displayName.prefix,
    displayName.title,
    course.instructor,
    course.term,
  ]
    .filter((value): value is string => Boolean(value))
    .some((value) => value.toLocaleLowerCase().includes(keyword))
}

interface BlackboardDataBrowserProps {
  language: WorkbenchLanguage
  baseUrl: string
  refreshToken?: number
}

export function BlackboardDataBrowser({ language, baseUrl, refreshToken = 0 }: BlackboardDataBrowserProps) {
  const isEnglish = language === 'en-US'
  const [courses, setCourses] = useState<Course[]>([])
  const [selectedCourseId, setSelectedCourseId] = useState<string | null>(null)
  const [loadingCourses, setLoadingCourses] = useState(false)
  const [coursesError, setCoursesError] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<DetailTab>('announcements')
  const [visitedDetailTabs, setVisitedDetailTabs] = useState<Set<DetailTab>>(
    () => new Set<DetailTab>(['announcements']),
  )
  const [visibleDetailTab, setVisibleDetailTab] = useState<DetailTab>('announcements')
  const [exitingDetailTab, setExitingDetailTab] = useState<DetailTab | null>(null)
  const targetDetailTabRef = useRef<DetailTab>('announcements')
  const visibleDetailTabRef = useRef<DetailTab>('announcements')
  const detailTabTransitionTimerRef = useRef<number | null>(null)
  const [detailStateByTab, setDetailStateByTab] = useState<Record<DetailTab, DetailTabState>>(
    createInitialDetailTabState,
  )
  const [searchQuery, setSearchQuery] = useState('')

  const fetchCourses = useCallback(async () => {
    setLoadingCourses(true)
    setCoursesError(null)
    try {
      const res = await fetch(`${baseUrl}/api/blackboard/data/courses`)
      const data = await res.json()
      if (data.ok) {
        const loadedCourses = Array.isArray(data.courses) ? data.courses as Course[] : []
        setCourses(loadedCourses)
        setSelectedCourseId((current) => {
          if (current && loadedCourses.some((course) => course.course_id === current)) {
            return current
          }
          return loadedCourses[0]?.course_id ?? null
        })
      } else {
        setCoursesError(data.error ?? 'Failed to load courses')
      }
    } catch (err) {
      setCoursesError(String(err))
    } finally {
      setLoadingCourses(false)
    }
  }, [baseUrl])

  useEffect(() => {
    void fetchCourses()
  }, [fetchCourses, refreshToken])

  const filteredCourses = useMemo(
    () => courses.filter((course) => courseMatchesSearch(course, searchQuery)),
    [courses, searchQuery],
  )

  useEffect(() => {
    setSelectedCourseId((current) => {
      if (filteredCourses.length === 0) {
        return null
      }
      if (current && filteredCourses.some((course) => course.course_id === current)) {
        return current
      }
      return filteredCourses[0]?.course_id ?? null
    })
  }, [filteredCourses])

  useEffect(() => () => {
    if (detailTabTransitionTimerRef.current !== null) {
      window.clearTimeout(detailTabTransitionTimerRef.current)
    }
  }, [])

  useEffect(() => {
    targetDetailTabRef.current = activeTab
    setVisitedDetailTabs((prev) => {
      if (prev.has(activeTab)) {
        return prev
      }
      const next = new Set(prev)
      next.add(activeTab)
      return next
    })

    if (detailTabTransitionTimerRef.current !== null) {
      window.clearTimeout(detailTabTransitionTimerRef.current)
      detailTabTransitionTimerRef.current = null
    }

    if (activeTab === visibleDetailTabRef.current) {
      setExitingDetailTab(null)
      return
    }

    const tabToFadeOut = visibleDetailTabRef.current
    setExitingDetailTab(tabToFadeOut)
    detailTabTransitionTimerRef.current = window.setTimeout(() => {
      const tabToFadeIn = targetDetailTabRef.current
      visibleDetailTabRef.current = tabToFadeIn
      setVisibleDetailTab(tabToFadeIn)
      setExitingDetailTab(null)
      detailTabTransitionTimerRef.current = null
    }, DETAIL_TAB_FADE_OUT_MS)
  }, [activeTab])

  useEffect(() => {
    setDetailStateByTab(() => createInitialDetailTabState())
    setVisitedDetailTabs(new Set<DetailTab>(['announcements']))
    setActiveTab('announcements')
    setVisibleDetailTab('announcements')
    setExitingDetailTab(null)
    targetDetailTabRef.current = 'announcements'
    visibleDetailTabRef.current = 'announcements'
    if (detailTabTransitionTimerRef.current !== null) {
      window.clearTimeout(detailTabTransitionTimerRef.current)
      detailTabTransitionTimerRef.current = null
    }
  }, [selectedCourseId])

  useEffect(() => {
    if (!selectedCourseId) {
      return
    }

    let cancelled = false
    const detailTab = activeTab
    setDetailStateByTab((prev) => ({
      ...prev,
      [detailTab]: { ...prev[detailTab], loading: true, error: null },
    }))

    void (async () => {
      try {
        const res = await fetch(
          `${baseUrl}/api/blackboard/data/courses/${encodeURIComponent(selectedCourseId)}/${detailTab}`,
        )
        const data = await res.json()
        if (cancelled) return
        if (data.ok) {
          setDetailStateByTab((prev) => ({
            ...prev,
            [detailTab]: {
              items: Array.isArray(data[detailTab]) ? data[detailTab] as DataItem[] : [],
              loading: false,
              error: null,
            },
          }))
          return
        }
        setDetailStateByTab((prev) => ({
          ...prev,
          [detailTab]: {
            items: [],
            loading: false,
            error: data.error ?? (isEnglish ? 'Failed to load detail data.' : '加载详情数据失败。'),
          },
        }))
      } catch (err) {
        if (!cancelled) {
          setDetailStateByTab((prev) => ({
            ...prev,
            [detailTab]: { items: [], loading: false, error: String(err) },
          }))
        }
      }
    })()
    return () => { cancelled = true }
  }, [selectedCourseId, activeTab, baseUrl, isEnglish])

  const selectedCourse = courses.find((course) => course.course_id === selectedCourseId) ?? null
  const selectedCourseName = selectedCourse ? splitCourseDisplayName(selectedCourse.name) : null
  const selectedCourseMeta = selectedCourse
    ? [selectedCourse.term, selectedCourse.instructor].filter(Boolean).join(' · ')
    : ''
  const hasSearchQuery = searchQuery.trim().length > 0
  const courseCountLabel = hasSearchQuery
    ? isEnglish ? `${filteredCourses.length}/${courses.length} course(s)` : `${filteredCourses.length}/${courses.length} 门`
    : isEnglish ? `${courses.length} course(s)` : `${courses.length} 门`
  return (
    <div className="sustech-course-browser">
      <section className="sustech-course-browser__list-pane" aria-label={isEnglish ? 'Courses' : '课程列表'}>
        <header className="sustech-course-browser__pane-header">
          <div>
            <p className="sustech-course-browser__eyebrow">Blackboard</p>
            <h3 className="sustech-course-browser__title">{isEnglish ? 'Courses' : '课程列表'}</h3>
          </div>
          <span className="sustech-course-browser__count">{courseCountLabel}</span>
        </header>

        <div className="sustech-course-search">
          <input
            type="search"
            className="sustech-course-search__input"
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder={isEnglish ? 'Search by code, course, teacher…' : '搜索编号、课程名、授课老师…'}
            aria-label={isEnglish ? 'Search courses' : '搜索课程'}
          />
        </div>

        <div className="sustech-course-list">
          {loadingCourses && (
            <p className="sustech-empty-hint">
              {isEnglish ? 'Loading courses…' : '加载课程中…'}
            </p>
          )}
          {coursesError && (
            <div className="sustech-sync-error">
              <span>{coursesError}</span>
            </div>
          )}
          {!loadingCourses && !coursesError && courses.length === 0 && (
            <p className="sustech-empty-hint">
              {isEnglish ? 'No courses synced yet. Run a sync first.' : '暂无已同步课程，请先执行同步。'}
            </p>
          )}
          {!loadingCourses && !coursesError && courses.length > 0 && filteredCourses.length === 0 && (
            <p className="sustech-empty-hint">
              {isEnglish ? 'No matching courses.' : '没有匹配的课程。'}
            </p>
          )}
          {filteredCourses.map((course) => {
            const displayName = splitCourseDisplayName(course.name)
            const courseMeta = [course.term, course.instructor].filter(Boolean).join(' · ')
            const isSelected = selectedCourseId === course.course_id
            return (
              <button
                key={course.course_id}
                type="button"
                className={`sustech-course-item${isSelected ? ' sustech-course-item--active' : ''}`}
                onClick={() => setSelectedCourseId(course.course_id)}
              >
                <div className="sustech-course-item__body">
                  {displayName.prefix && <span className="sustech-course-item__code">{displayName.prefix}</span>}
                  <span className="sustech-course-item__name">{displayName.title}</span>
                  {courseMeta && <span className="sustech-course-item__meta">{courseMeta}</span>}
                  <span className="sustech-course-item__badges">
                    <span>{isEnglish ? 'Announcements' : '公告'} {course.total_announcements ?? 0}</span>
                    <span>{isEnglish ? 'Assignments' : '作业'} {course.total_assignments ?? 0}</span>
                    <span>{isEnglish ? 'Resources' : '资源'} {course.total_resources ?? 0}</span>
                    {(course.total_grade || course.listed_grade) && (
                      <span>{isEnglish ? 'Grade' : '总评'} {course.total_grade ?? course.listed_grade}</span>
                    )}
                  </span>
                </div>
                <ChevronRight size={15} className="sustech-course-item__chevron" />
              </button>
            )
          })}
        </div>
      </section>

      <section className="sustech-course-browser__detail-pane" aria-label={isEnglish ? 'Course details' : '课程详情'}>
        <header className="sustech-course-detail__header">
          <div>
            <p className="sustech-course-browser__eyebrow">Blackboard</p>
            <h3 className="sustech-course-browser__title">{isEnglish ? 'Course details' : '课程详情'}</h3>
            {selectedCourse && selectedCourseMeta && (
              <p className="sustech-course-detail__meta">{selectedCourseMeta}</p>
            )}
          </div>
          {selectedCourse?.is_active && (
            <span className="sustech-course-detail__status">{isEnglish ? 'Active' : '进行中'}</span>
          )}
        </header>

        {!selectedCourse ? (
          <div className="sustech-course-detail__empty">
            <BookOpen size={20} />
            <p>{isEnglish ? 'Select a course from the left list to view details.' : '从左侧课程列表选择课程以查看详情。'}</p>
          </div>
        ) : (
          <>
            <div className="sustech-course-detail__summary">
              {selectedCourseName?.prefix && <span className="sustech-course-detail__code">{selectedCourseName.prefix}</span>}
              <strong>{selectedCourseName?.title ?? selectedCourse.name}</strong>
              <div className="sustech-course-detail__summary-badges">
                <span>{isEnglish ? 'Announcements' : '公告'} {selectedCourse.total_announcements ?? 0}</span>
                <span>{isEnglish ? 'Assignments' : '作业'} {selectedCourse.total_assignments ?? 0}</span>
                <span>{isEnglish ? 'Resources' : '资源'} {selectedCourse.total_resources ?? 0}</span>
                {(selectedCourse.total_grade || selectedCourse.listed_grade) && (
                  <span>{isEnglish ? 'Grade' : '总评'} {selectedCourse.total_grade ?? selectedCourse.listed_grade}</span>
                )}
              </div>
            </div>

            <div className="sustech-detail-tabs" aria-label={isEnglish ? 'Course detail sections' : '课程详情分类'}>
              {TAB_CONFIG.map(({ key, labelZh, labelEn, icon: Icon }) => (
                <button
                  key={key}
                  type="button"
                  className={`sustech-detail-tab${activeTab === key ? ' sustech-detail-tab--active' : ''}`}
                  onClick={() => setActiveTab(key)}
                >
                  <Icon size={14} />
                  {isEnglish ? labelEn : labelZh}
                </button>
              ))}
            </div>

            <div className="sustech-detail-viewport">
              {TAB_CONFIG.map(({ key }) => {
                if (!visitedDetailTabs.has(key)) {
                  return null
                }

                const tabState = detailStateByTab[key]
                const isExiting = key === exitingDetailTab
                const isActive = key === visibleDetailTab && !isExiting
                const isVisible = key === visibleDetailTab || isExiting
                const displayedDetailItems = key === 'resources'
                  ? flattenResourceHierarchy(tabState.items)
                  : tabState.items

                return (
                  <div
                    key={key}
                    className={[
                      'sustech-detail-keepalive-panel',
                      isActive ? 'sustech-detail-keepalive-panel--active' : null,
                      isExiting ? 'sustech-detail-keepalive-panel--exiting' : null,
                    ].filter(Boolean).join(' ')}
                    data-sustech-detail-tab={key}
                    hidden={!isVisible}
                    aria-hidden={!isActive}
                  >
                    <div className="sustech-detail-list">
                      {tabState.loading && (
                        <p className="sustech-empty-hint">{isEnglish ? 'Loading…' : '加载中…'}</p>
                      )}
                      {tabState.error && (
                        <div className="sustech-sync-error">
                          <span>{tabState.error}</span>
                        </div>
                      )}
                      {!tabState.loading && !tabState.error && tabState.items.length === 0 && (
                        <p className="sustech-empty-hint">{isEnglish ? 'No data available.' : '暂无数据。'}</p>
                      )}
                      {displayedDetailItems.map((item, index) => {
                        const title = item.title ?? item.name ?? item.item_name ?? `#${item.id}`
                        const description = item.body ?? item.content ?? item.feedback ?? null
                        const secondaryMeta = [
                          item.category,
                          item.grade_type,
                          item.status,
                          item.author,
                          item.type,
                          item.size,
                          item.local_path ? (isEnglish ? 'Downloaded' : '已下载') : null,
                        ].filter(Boolean)
                        const timestamp = formatDetailTimestamp(
                          item.publish_time ?? item.posted_at ?? item.graded_date ?? null,
                          isEnglish,
                        )
                        const resourceNode = key === 'resources' ? item as ResourceTreeItem : null
                        const resourceDepth = resourceNode ? Math.min(resourceNode.depth ?? 0, 4) : 0
                        const resourceChildCount = resourceNode?.children?.length ?? 0
                        const isResourceParent = resourceChildCount > 0
                        const itemClassName = `sustech-detail-item sustech-detail-item--${key}${
                          resourceNode ? ` sustech-detail-item--depth-${resourceDepth}` : ''
                        }${isResourceParent ? ' sustech-detail-item--resource-parent' : ''}`
                        return (
                          <div key={`${key}-${item.resource_id ?? item.id ?? index}`} className={itemClassName}>
                            <div className="sustech-detail-item__body">
                              <span className="sustech-detail-item__title">
                                {resourceNode && (
                                  <span className="sustech-resource-tree-marker" aria-hidden="true">
                                    {resourceDepth > 0 ? '└' : isResourceParent ? '▾' : '•'}
                                  </span>
                                )}
                                <span>{title}</span>
                              </span>
                              {description && <span className="sustech-detail-item__desc">{description}</span>}
                              {secondaryMeta.length > 0 && (
                                <span className="sustech-detail-item__meta-row">{secondaryMeta.join(' · ')}</span>
                              )}
                            </div>
                            {item.score !== undefined && item.score !== null && (
                              <span className="sustech-detail-item__score">
                                {item.score}{item.total_score ? ` / ${item.total_score}` : ''}
                                {item.percentage !== undefined && item.percentage !== null ? ` · ${item.percentage}%` : ''}
                              </span>
                            )}
                            {item.due_date && <span className="sustech-detail-item__meta">{item.due_date}</span>}
                            {timestamp && (
                              <span className="sustech-detail-item__meta sustech-detail-item__date">
                                {timestamp}
                              </span>
                            )}
                            {key === 'resources' && (
                              <button
                                type="button"
                                className="sustech-download-button"
                                disabled
                                title={isEnglish ? 'Download will be available in a future release' : '下载功能将在后续版本开放'}
                              >
                                <Download size={14} />
                              </button>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )
              })}
            </div>
          </>
        )}
      </section>
    </div>
  )
}

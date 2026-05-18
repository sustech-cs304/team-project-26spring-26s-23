import type { CopilotToolPlatformGroup } from './types'

export const TOOL_PRESENTATION_OVERRIDES: Record<string, { name: string, description: string }> = {
  'tool.remote-search': {
    name: '联网搜索',
    description: '搜索外部公开信息',
  },
}

export const TOOL_NAMESPACE_DESCRIPTIONS: Record<string, string> = {
  blackboard: 'Blackboard 相关操作',
  tis: 'TIS 相关操作',
  tool: '内建辅助能力',
}

export const TOOL_TOKEN_LABELS: Record<string, string> = {
  blackboard: 'Blackboard',
  tis: 'TIS',
  tool: '工具',
  file: '文件',
  convert: '转换',
  weather: '天气',
  current: '当前',
  remote: '远程',
  search: '搜索',
  sql: 'SQL',
  query: '查询',
  course: '课程',
  courses: '课程',
  catalog: '目录',
  calendar: '日历',
  refresh: '刷新',
  snapshot: '快照',
  sync: '同步',
  resources: '资源',
  resource: '资源',
  skill: '技能',
  activate: '激活',
  read: '读取',
  personal: '个人',
  grades: '成绩',
  grade: '成绩',
  credit: '学分',
  gpa: '绩点',
  selected: '已选',
  fetch: '获取',
}

export const STATIC_TOOL_PLATFORM_GROUPS: Record<string, Omit<CopilotToolPlatformGroup, 'searchKeywords'>> = {
  tool: {
    key: 'builtin',
    title: 'Candue 内建',
    order: 0,
    sourceKind: 'builtin',
  },
  blackboard: {
    key: 'sustech-blackboard',
    title: 'SUSTech Blackboard',
    order: 10,
    sourceKind: 'sustech-blackboard',
  },
  tis: {
    key: 'sustech-tis',
    title: 'SUSTech TIS',
    order: 20,
    sourceKind: 'sustech-tis',
  },
}

export const PLATFORM_TOKEN_LABELS: Record<string, string> = {
  api: 'API',
  fs: 'FS',
  mcp: 'MCP',
  sql: 'SQL',
  sustech: 'SUSTech',
  tis: 'TIS',
}

export const MCP_GROUP_ORDER = 100
export const FALLBACK_GROUP_ORDER = 200

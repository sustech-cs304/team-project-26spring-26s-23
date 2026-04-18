import type { RuntimeToolDirectoryEntry } from '../../src/features/copilot/chat-contract'

export function createToolCatalogFixture(): RuntimeToolDirectoryEntry[] {
  return [
    {
      toolId: 'tool.fs.read',
      kind: 'builtin',
      availability: 'available',
      displayName: '读取文件',
      description: '读取项目内文件内容，用于理解上下文与定位实现细节。',
    },
    {
      toolId: 'tool.fs.write',
      kind: 'builtin',
      availability: 'available',
      displayName: '写入文件',
      description: '创建或覆盖文件内容，用于输出生成结果与落盘修改。',
    },
    {
      toolId: 'tool.fs.edit',
      kind: 'builtin',
      availability: 'available',
      displayName: '编辑文件',
      description: '对现有文件执行精确编辑，适用于补丁式修改与小范围更新。',
    },
    {
      toolId: 'mcp--fetch--fetch',
      kind: 'external',
      availability: 'available',
      displayName: '联网抓取',
      description: '抓取网页内容，用于补充外部说明与页面上下文。',
    },
    {
      toolId: 'mcp--puppeteer--puppeteer_navigate',
      kind: 'external',
      availability: 'available',
      displayName: '浏览器自动化',
      description: '驱动浏览器执行界面级操作，用于录制流程或验证可见交互。',
    },
  ]
}

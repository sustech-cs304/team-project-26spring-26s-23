import ReactMarkdown from 'react-markdown'
import rehypeHighlight from 'rehype-highlight'
import rehypeMathjax from 'rehype-mathjax/svg'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import type { Components } from 'react-markdown'

interface RehypeNode {
  tagName?: string
  properties?: {
    className?: unknown
  }
  children?: unknown[]
}

const assistantMarkdownRemarkPlugins = [remarkGfm, remarkMath]
const assistantMarkdownRehypePlugins = [rehypeHighlight, rehypeMathjax]
const blockCodeNodes = new WeakSet<object>()

const assistantMarkdownComponents: Components = {
  hr({ node: _node, className, ...props }) {
    return (
      <hr
        {...props}
        className={joinClassNames('copilot-chat__markdown-divider', className)}
      />
    )
  },
  pre({ node, className, children, ...props }) {
    markBlockCodeNodes(node)
    const languageLabel = resolveCodeLanguageLabel(readCodeClassNameFromPreNode(node))

    return (
      <div className="copilot-chat__code-block" data-language={languageLabel}>
        <div className="copilot-chat__code-block-header">
          <span className="copilot-chat__code-block-language">{languageLabel}</span>
        </div>
        <pre
          {...props}
          className={joinClassNames('copilot-chat__code-block-pre', className)}
        >
          {children}
        </pre>
      </div>
    )
  },
  code({ node, className, children, ...props }) {
    const isBlockCode = isTrackedBlockCodeNode(node)
      || className?.includes('language-') === true
      || className?.includes('hljs') === true

    if (!isBlockCode) {
      return (
        <code
          {...props}
          className={joinClassNames('copilot-chat__inline-code', stripInlineCodeClass(className))}
        >
          {children}
        </code>
      )
    }

    return (
      <code
        {...props}
        className={normalizeBlockCodeClassName(className)}
      >
        {children}
      </code>
    )
  },
}

export function renderAssistantMarkdownMessageBody(content: string) {
  return (
    <div className="copilot-chat__message-text copilot-chat__message-text--markdown">
      <ReactMarkdown
        components={assistantMarkdownComponents}
        remarkPlugins={assistantMarkdownRemarkPlugins}
        rehypePlugins={assistantMarkdownRehypePlugins}
      >
        {content}
      </ReactMarkdown>
    </div>
  )
}

function markBlockCodeNodes(node: unknown) {
  if (!isRehypeNode(node) || node.tagName !== 'pre' || !Array.isArray(node.children)) {
    return
  }

  for (const child of node.children) {
    if (!isRehypeNode(child) || child.tagName !== 'code' || !isWeakSetCompatible(child)) {
      continue
    }

    blockCodeNodes.add(child)
  }
}

function isTrackedBlockCodeNode(node: unknown): boolean {
  return isWeakSetCompatible(node) && blockCodeNodes.has(node)
}

function readCodeClassNameFromPreNode(node: unknown): string | undefined {
  if (!isRehypeNode(node) || !Array.isArray(node.children)) {
    return undefined
  }

  for (const child of node.children) {
    if (!isRehypeNode(child) || child.tagName !== 'code') {
      continue
    }

    return readClassName(child.properties?.className)
  }

  return undefined
}

function resolveCodeLanguageLabel(className?: string): string {
  const languageId = className?.match(/(?:^|\s)language-([a-zA-Z0-9_+-]+)/)?.[1]?.toLowerCase() ?? ''

  switch (languageId) {
    case 'js':
    case 'javascript':
      return 'JavaScript'
    case 'ts':
    case 'typescript':
      return 'TypeScript'
    case 'tsx':
      return 'TSX'
    case 'jsx':
      return 'JSX'
    case 'py':
    case 'python':
      return 'Python'
    case 'sh':
    case 'bash':
    case 'shell':
      return 'Bash'
    case 'json':
      return 'JSON'
    case 'yaml':
    case 'yml':
      return 'YAML'
    case 'md':
    case 'markdown':
      return 'Markdown'
    case 'text':
    case 'plain':
    case 'plaintext':
      return 'Text'
    default:
      return languageId === '' ? 'Text' : `${languageId.slice(0, 1).toUpperCase()}${languageId.slice(1)}`
  }
}

function normalizeBlockCodeClassName(className?: string): string {
  const tokens = stripInlineCodeClass(className)
    .split(/\s+/)
    .filter((value) => value !== '' && value !== 'hljs')

  return ['hljs', ...tokens].join(' ')
}

function stripInlineCodeClass(className?: string): string {
  return className
    ?.split(/\s+/)
    .filter((value) => value !== '' && value !== 'copilot-chat__inline-code')
    .join(' ')
    ?? ''
}

function isRehypeNode(value: unknown): value is RehypeNode {
  return typeof value === 'object' && value !== null
}

function isWeakSetCompatible(value: unknown): value is object {
  return typeof value === 'object' && value !== null
}

function readClassName(value: unknown): string | undefined {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === 'string').join(' ')
  }

  return typeof value === 'string' ? value : undefined
}

function joinClassNames(...values: Array<string | null | undefined | false>): string {
  return values.filter((value): value is string => value !== undefined && value !== null && value !== '').join(' ')
}

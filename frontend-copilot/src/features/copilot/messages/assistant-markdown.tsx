import type { ReactElement, ReactNode } from 'react'
import ReactMarkdown from 'react-markdown'
import rehypeHighlight from 'rehype-highlight'
import rehypeMathjax from 'rehype-mathjax/svg'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import type { Components } from 'react-markdown'

interface MarkdownCodeElementProps {
  className?: string
  children?: ReactNode
}

const assistantMarkdownRemarkPlugins = [remarkGfm, remarkMath]
const assistantMarkdownRehypePlugins = [rehypeHighlight, rehypeMathjax]

const assistantMarkdownComponents: Components = {
  hr({ node: _node, className, ...props }) {
    return (
      <hr
        {...props}
        className={joinClassNames('copilot-chat__markdown-divider', className)}
      />
    )
  },
  pre({ node: _node, className, children, ...props }) {
    const codeChild = findCodeElement(children)
    const languageLabel = resolveCodeLanguageLabel(codeChild?.props.className)

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
  code({ node: _node, className, children, ...props }) {
    const isBlockCode = className?.includes('language-') === true || className?.includes('hljs') === true

    if (!isBlockCode) {
      return (
        <code
          {...props}
          className={joinClassNames('copilot-chat__inline-code', className)}
        >
          {children}
        </code>
      )
    }

    return (
      <code
        {...props}
        className={joinClassNames('hljs', className)}
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

function findCodeElement(children: ReactNode): ReactElement<MarkdownCodeElementProps> | null {
  if (Array.isArray(children)) {
    for (const child of children) {
      const resolvedChild = findCodeElement(child)
      if (resolvedChild !== null) {
        return resolvedChild
      }
    }

    return null
  }

  if (!isCodeElement(children)) {
    return null
  }

  return children
}

function isCodeElement(value: ReactNode): value is ReactElement<MarkdownCodeElementProps> {
  return typeof value === 'object' && value !== null && 'props' in value
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

function joinClassNames(...values: Array<string | null | undefined | false>): string {
  return values.filter((value): value is string => value !== undefined && value !== null && value !== '').join(' ')
}

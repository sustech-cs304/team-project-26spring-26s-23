import { Check, Copy, Download, TextWrap } from 'lucide-react'
import { isValidElement, useEffect, useMemo, useState, type ComponentPropsWithoutRef, type ReactNode } from 'react'
import ReactMarkdown from 'react-markdown'
import rehypeHighlight from 'rehype-highlight'
import rehypeMathjax from 'rehype-mathjax/svg'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import type { Components } from 'react-markdown'
import type { PluggableList } from 'unified'

interface RehypeNode {
  type?: string
  tagName?: string
  value?: unknown
  properties?: {
    className?: unknown
  }
  children?: unknown[]
}

type AssistantCodeBlockProps = ComponentPropsWithoutRef<'pre'> & {
  node?: unknown
  children?: ReactNode
}

type AssistantCodeProps = ComponentPropsWithoutRef<'code'> & {
  node?: unknown
  children?: ReactNode
}

type CodeCopyStatus = 'idle' | 'copied' | 'failed'

const typstPlainTextAliases = ['typst', 'typ']
const assistantMarkdownRemarkPlugins = [remarkGfm, remarkMath]
const assistantMarkdownRehypePlugins: PluggableList = [
  [rehypeHighlight, { plainText: typstPlainTextAliases }],
  rehypeTypstHighlight,
  rehypeMathjax,
]
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
  pre: AssistantCodeBlock,
  code: AssistantCode,
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

// eslint-disable-next-line react-refresh/only-export-components -- used as react-markdown component via Components map
function AssistantCodeBlock({ node, className, children, ...props }: AssistantCodeBlockProps) {
  markBlockCodeNodes(node)
  const codeClassName = readCodeClassNameFromPreNode(node)
  const languageId = resolveCodeLanguageId(codeClassName)
  const languageLabel = resolveCodeLanguageLabelFromId(languageId)
  const codeText = useMemo(() => extractTextFromReactNode(children), [children])
  const [isWrapped, setIsWrapped] = useState(true)
  const [copyStatus, setCopyStatus] = useState<CodeCopyStatus>('idle')

  useEffect(() => {
    if (copyStatus === 'idle') {
      return undefined
    }

    const timeoutId = window.setTimeout(() => {
      setCopyStatus('idle')
    }, 1_600)

    return () => window.clearTimeout(timeoutId)
  }, [copyStatus])

  const handleCopyCode = async () => {
    const copied = await copyCodeTextToClipboard(codeText)
    setCopyStatus(copied ? 'copied' : 'failed')
  }

  const handleDownloadCode = () => {
    downloadCodeText(codeText, languageId)
  }

  const copyLabel = copyStatus === 'copied'
    ? '代码已复制'
    : copyStatus === 'failed'
      ? '复制失败'
      : '复制代码'
  const wrapLabel = isWrapped ? '取消自动换行' : '启用自动换行'

  return (
    <div
      className={joinClassNames('copilot-chat__code-block', !isWrapped && 'copilot-chat__code-block--nowrap')}
      data-language={languageLabel}
      data-language-id={languageId || 'text'}
    >
      <div className="copilot-chat__code-block-header">
        <span className="copilot-chat__code-block-language">{languageLabel}</span>
        <span className="copilot-chat__code-block-actions" aria-label="代码块操作">
          <button
            type="button"
            className={joinClassNames(
              'copilot-chat__code-block-action',
              copyStatus === 'copied' && 'copilot-chat__code-block-action--success',
              copyStatus === 'failed' && 'copilot-chat__code-block-action--danger',
            )}
            aria-label={copyLabel}
            title={copyLabel}
            data-code-block-action="copy"
            onClick={() => {
              void handleCopyCode()
            }}
          >
            {copyStatus === 'copied' ? <Check size={14} strokeWidth={2.4} /> : <Copy size={14} strokeWidth={2.2} />}
          </button>
          <button
            type="button"
            className="copilot-chat__code-block-action"
            aria-label="下载代码"
            title="下载代码"
            data-code-block-action="download"
            onClick={handleDownloadCode}
          >
            <Download size={14} strokeWidth={2.2} />
          </button>
          <button
            type="button"
            className={joinClassNames('copilot-chat__code-block-action', !isWrapped && 'copilot-chat__code-block-action--active')}
            aria-label={wrapLabel}
            title={wrapLabel}
            data-code-block-action="wrap"
            data-code-block-wrap-mode={isWrapped ? 'wrapped' : 'scroll'}
            onClick={() => setIsWrapped((current) => !current)}
          >
            <TextWrap size={14} strokeWidth={2.2} />
          </button>
        </span>
      </div>
      <pre
        {...props}
        className={joinClassNames('copilot-chat__code-block-pre', className)}
      >
        {children}
      </pre>
    </div>
  )
}

// eslint-disable-next-line react-refresh/only-export-components -- used as react-markdown component via Components map
function AssistantCode({ node, className, children, ...props }: AssistantCodeProps) {
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
}

function rehypeTypstHighlight() {
  return (tree: unknown) => {
    visitTypstCodeNodes(tree, undefined)
  }
}

function visitTypstCodeNodes(node: unknown, parent: RehypeNode | undefined) {
  if (!isRehypeNode(node)) {
    return
  }

  if (node.tagName === 'code' && parent?.tagName === 'pre' && isTypstCodeNode(node)) {
    highlightTypstCodeNode(node)
    return
  }

  if (!Array.isArray(node.children)) {
    return
  }

  for (const child of node.children) {
    visitTypstCodeNodes(child, node)
  }
}

function isTypstCodeNode(node: RehypeNode): boolean {
  const languageId = resolveCodeLanguageId(readClassName(node.properties?.className))
  return languageId === 'typst' || languageId === 'typ'
}

function highlightTypstCodeNode(node: RehypeNode) {
  const classNameTokens = readClassName(node.properties?.className)
    ?.split(/\s+/)
    .filter((value) => value !== '')
    ?? []

  if (!classNameTokens.includes('hljs')) {
    classNameTokens.unshift('hljs')
  }

  node.properties = {
    ...node.properties,
    className: classNameTokens,
  }
  node.children = tokenizeTypstCode(readTextFromHast(node))
}

function tokenizeTypstCode(value: string): unknown[] {
  const nodes: unknown[] = []
  const tokenPattern = /(^={1,6}[^\n]*|\/\/[^\n]*|\/\*[\s\S]*?\*\/|"(?:\\.|[^"\\])*"|\$[^$]*\$|#[A-Za-z_][\w-]*|\b(?:as|auto|break|context|continue|else|false|for|if|import|in|include|let|none|return|set|show|true|while)\b|\b\d+(?:\.\d+)?(?:%|pt|em|cm|mm|in|deg|rad|s|ms)?\b|[()[\]{}.,:;+\-*/=<>!]+)/gm
  let cursor = 0
  let match: RegExpExecArray | null

  while ((match = tokenPattern.exec(value)) !== null) {
    const [token] = match
    if (match.index > cursor) {
      nodes.push(createHastText(value.slice(cursor, match.index)))
    }

    nodes.push(createHastSpan(resolveTypstTokenClassName(token), token))
    cursor = match.index + token.length
  }

  if (cursor < value.length) {
    nodes.push(createHastText(value.slice(cursor)))
  }

  return nodes
}

function resolveTypstTokenClassName(token: string): string {
  if (token.startsWith('//') || token.startsWith('/*')) {
    return 'hljs-comment'
  }

  if (token.startsWith('"') || token.startsWith('$')) {
    return 'hljs-string'
  }

  if (token.startsWith('=')) {
    return 'hljs-title'
  }

  if (token.startsWith('#') || /^(?:as|auto|break|context|continue|else|false|for|if|import|in|include|let|none|return|set|show|true|while)$/.test(token)) {
    return 'hljs-keyword'
  }

  if (/^\d/.test(token)) {
    return 'hljs-number'
  }

  return 'hljs-punctuation'
}

function createHastText(value: string): unknown {
  return {
    type: 'text',
    value,
  }
}

function createHastSpan(className: string, value: string): unknown {
  return {
    type: 'element',
    tagName: 'span',
    properties: {
      className: [className],
    },
    children: [createHastText(value)],
  }
}

function readTextFromHast(node: unknown): string {
  if (!isRehypeNode(node)) {
    return ''
  }

  if (node.type === 'text') {
    return typeof node.value === 'string' ? node.value : ''
  }

  return Array.isArray(node.children)
    ? node.children.map((child) => readTextFromHast(child)).join('')
    : ''
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

function resolveCodeLanguageId(className?: string): string {
  return className?.match(/(?:^|\s)language-([a-zA-Z0-9_+-]+)/)?.[1]?.toLowerCase() ?? ''
}

const CODE_LANGUAGE_LABEL_MAP: Record<string, string> = {
  js: 'JavaScript',
  javascript: 'JavaScript',
  ts: 'TypeScript',
  typescript: 'TypeScript',
  tsx: 'TSX',
  jsx: 'JSX',
  py: 'Python',
  python: 'Python',
  sh: 'Bash',
  bash: 'Bash',
  shell: 'Bash',
  json: 'JSON',
  yaml: 'YAML',
  yml: 'YAML',
  md: 'Markdown',
  markdown: 'Markdown',
  typ: 'Typst',
  typst: 'Typst',
  text: 'Text',
  plain: 'Text',
  plaintext: 'Text',
}

function resolveCodeLanguageLabelFromId(languageId: string): string {
  const mapped = CODE_LANGUAGE_LABEL_MAP[languageId]
  if (mapped !== undefined) {
    return mapped
  }
  return languageId === '' ? 'Text' : `${languageId.slice(0, 1).toUpperCase()}${languageId.slice(1)}`
}

const CODE_LANGUAGE_EXTENSION_MAP: Record<string, string> = {
  js: 'js',
  javascript: 'js',
  ts: 'ts',
  typescript: 'ts',
  tsx: 'tsx',
  jsx: 'jsx',
  py: 'py',
  python: 'py',
  sh: 'sh',
  bash: 'sh',
  shell: 'sh',
  json: 'json',
  yaml: 'yml',
  yml: 'yml',
  md: 'md',
  markdown: 'md',
  typ: 'typ',
  typst: 'typ',
  html: 'html',
  css: 'css',
}

function resolveCodeLanguageFileExtension(languageId: string): string {
  const mapped = CODE_LANGUAGE_EXTENSION_MAP[languageId]
  if (mapped !== undefined) {
    return mapped
  }
  return languageId === '' || languageId === 'text' || languageId === 'plain' || languageId === 'plaintext'
    ? 'txt'
    : languageId.replace(/[^a-z0-9_-]/g, '') || 'txt'
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

function extractTextFromReactNode(node: ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') {
    return String(node)
  }

  if (Array.isArray(node)) {
    return node.map((child) => extractTextFromReactNode(child)).join('')
  }

  if (isValidElement<{ children?: ReactNode }>(node)) {
    return extractTextFromReactNode(node.props.children)
  }

  return ''
}

async function copyCodeTextToClipboard(value: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value)
      return true
    }
  } catch {
    return copyCodeTextWithTextArea(value)
  }

  return copyCodeTextWithTextArea(value)
}

function copyCodeTextWithTextArea(value: string): boolean {
  if (typeof document === 'undefined') {
    return false
  }

  const textarea = document.createElement('textarea')
  textarea.value = value
  textarea.setAttribute('readonly', '')
  textarea.style.position = 'fixed'
  textarea.style.inset = '0 auto auto 0'
  textarea.style.opacity = '0'
  textarea.style.pointerEvents = 'none'
  document.body.appendChild(textarea)
  textarea.select()

  try {
    return document.execCommand('copy')
  } catch {
    return false
  } finally {
    textarea.remove()
  }
}

function downloadCodeText(value: string, languageId: string) {
  if (typeof document === 'undefined' || typeof URL === 'undefined') {
    return
  }

  const blob = new Blob([value], { type: 'text/plain;charset=utf-8' })
  const objectUrl = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = objectUrl
  anchor.download = buildCodeDownloadFileName(languageId)
  anchor.rel = 'noopener'
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 0)
}

function buildCodeDownloadFileName(languageId: string): string {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
  return `copilot-code-${timestamp}.${resolveCodeLanguageFileExtension(languageId)}`
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

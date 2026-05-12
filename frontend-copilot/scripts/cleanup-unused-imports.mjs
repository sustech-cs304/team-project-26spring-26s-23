/**
 * Final approach: Pre-compute all import blocks, then filter based on TS6133/TS6192.
 * Uses two-pass: first build import map, then apply removals.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')

const TARGET = [
  'src/features/copilot/CopilotChatPanel.composer.history.test.tsx',
  'src/features/copilot/CopilotChatPanel.composer.input.test.tsx',
  'src/features/copilot/CopilotChatPanel.composer.messages.test.tsx',
  'src/features/copilot/CopilotChatPanel.composer.model-picker.test.tsx',
  'src/features/copilot/CopilotChatPanel.composer.send-error.test.tsx',
  'src/features/copilot/CopilotChatPanel.composer.session.test.tsx',
  'src/features/copilot/CopilotChatPanel.composer.tool-lifecycle.test.tsx',
  'src/features/copilot/CopilotChatPanel.composer.tool-picker.test.tsx',
]

// Run tsc and collect errors
let tscOut = ''
try { tscOut = execSync('npx tsc --noEmit -p tsconfig.json 2>&1', { cwd: ROOT, encoding: 'utf-8', maxBuffer: 10*1024*1024 }) }
catch(e) { tscOut = e.stdout || e.stderr || '' }

// Map: fileRel -> { unusedLines: Set<int>, unusedSymbols: Map<lineNum, symbolName> }
const errMap = {}
for (const line of tscOut.split('\n')) {
  let m = line.match(/^(.+?)\((\d+),\d+\): error TS6133: '(\w+)' is declared but its value is never read/)
  if (m) {
    const [, f, ln, sym] = m
    const fileRel = f.replace(/\\/g, '/')
    if (!TARGET.includes(fileRel)) continue
    if (!errMap[fileRel]) errMap[fileRel] = { unusedLines: new Set(), unusedSymbols: new Map() }
    errMap[fileRel].unusedSymbols.set(parseInt(ln, 10), sym)
    continue
  }
  m = line.match(/^(.+?)\((\d+),\d+\): error TS6192: All imports in import declaration are unused/)
  if (m) {
    const [, f, ln] = m
    const fileRel = f.replace(/\\/g, '/')
    if (!TARGET.includes(fileRel)) continue
    if (!errMap[fileRel]) errMap[fileRel] = { unusedLines: new Set(), unusedSymbols: new Map() }
    errMap[fileRel].unusedLines.add(parseInt(ln, 10))
    continue
  }
}

for (const fileRel of TARGET) {
  if (!errMap[fileRel]) { console.log(`  ${fileRel}: no errors`); continue }
  
  const fullPath = resolve(ROOT, fileRel)
  const lines = readFileSync(fullPath, 'utf-8').split('\n')
  const { unusedLines, unusedSymbols } = errMap[fileRel]
  
  // ---- Phase 1: Find all import blocks ----
  // importBlock: { startIdx: 0-based, endIdx: 0-based, lines: string[] }
  const blocks = []
  let i = 0
  while (i < lines.length) {
    const t = lines[i].trim()
    if (!t.startsWith('import ')) { i++; continue }
    
    const start = i
    // Check if single-line (has from on same line, or no {)
    if (!t.includes('{') || /\bfrom\s+['"]/.test(t)) {
      blocks.push({ start, end: start, rawLines: [lines[start]] })
      i = start + 1
      continue
    }
    
    // Multi-line: scan for '} from'
    let end = i
    while (end < lines.length && !/\}\s*from\s+['"]/.test(lines[end].trim())) {
      end++
    }
    blocks.push({ start, end, rawLines: lines.slice(start, end + 1) })
    i = end + 1
  }
  
  // ---- Phase 2: Determine which lines (0-based) to remove ----
  const removeLineIdxs = new Set()
  
  // TS6192: remove entire block
  for (const ln1 of unusedLines) {
    const block = blocks.find(b => b.start + 1 <= ln1 && b.end + 1 >= ln1)
    if (block) {
      for (let j = block.start; j <= block.end; j++) removeLineIdxs.add(j)
    }
  }
  
  // TS6133: For multi-line blocks, remove the specific line.
  // For single-line blocks, collect symbols to trim.
  // But first, skip lines already in removeLineIdxs.
  const singleLineMods = new Map() // 0-based lineIdx -> Set<symbolName>
  
  for (const [ln1, sym] of unusedSymbols) {
    if (removeLineIdxs.has(ln1 - 1)) continue
    
    const block = blocks.find(b => b.start + 1 <= ln1 && b.end + 1 >= ln1)
    if (!block) continue
    
    if (block.start === block.end) {
      // Single-line
      if (!singleLineMods.has(block.start)) singleLineMods.set(block.start, new Set())
      singleLineMods.get(block.start).add(sym)
    } else {
      // Multi-line: remove the line containing this symbol
      removeLineIdxs.add(ln1 - 1)
    }
  }
  
  // ---- Phase 3: Build output ----
  const outLines = []
  for (let i = 0; i < lines.length; i++) {
    if (removeLineIdxs.has(i)) continue
    
    let line = lines[i]
    if (singleLineMods.has(i)) {
      const syms = singleLineMods.get(i)
      line = trimImportSymbols(line, syms)
      if (line === null) continue // all symbols removed
    }
    outLines.push(line)
  }
  
  // Clean blanks
  const cleaned = []
  let bc = 0
  for (const l of outLines) {
    if (l.trim() === '') { bc++; if (bc <= 2) cleaned.push(l) }
    else { bc = 0; cleaned.push(l) }
  }
  
  writeFileSync(fullPath, cleaned.join('\n').trimEnd() + '\n', 'utf-8')
  
  const removed = removeLineIdxs.size
  const trimmed = singleLineMods.size
  console.log(`  ${fileRel}: removed ${removed} lines, trimmed ${trimmed} imports`)
}

console.log('\nDone.')

function trimImportSymbols(line, symsToRemove) {
  const m = line.match(/^(import\s+(?:type\s+)?)\{([^}]+)\}(\s*from\s+.+)$/)
  if (!m) return line
  
  const prefix = m[1], body = m[2], suffix = m[3]
  const parts = body.split(',').map(s => s.trim()).filter(Boolean)
  
  const kept = parts.filter(p => {
    let name = p.replace(/^type\s+/, '').trim()
    const as = name.match(/^(\w+)\s+as\s+(\w+)$/)
    if (as) name = as[2]
    return !symsToRemove.has(name)
  })
  
  if (kept.length === 0) return null
  return `${prefix}{ ${kept.join(', ')} } ${suffix}`
}

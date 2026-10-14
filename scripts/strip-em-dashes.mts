// Rewrites em dashes inside string and template literals (never comments or regexes) to commas or full stops.
import fs from 'node:fs'
import ts from 'typescript'

const args = process.argv.slice(2)
const dry = args.includes('--dry')
const files = args.filter((a) => !a.startsWith('--'))

/** Context-aware replacement for one dash occurrence. */
function rewrite(text: string, endsOpen: boolean): string {
  return text.replace(/\s*[—―]\s*/g, (match, offset: number) => {
    const after = text.slice(offset + match.length)
    if (after.length === 0) return endsOpen ? ', ' : '...'
    return /^[A-Z0-9]/.test(after) ? '. ' : ', '
  })
}

/** Strings that exist to name or match the character itself keep it. */
function isProtected(text: string): boolean {
  const t = text.replace(/\s/g, '')
  return t.length <= 3 || /em[- ]?dash/i.test(text)
}

let total = 0
for (const file of files) {
  const source = fs.readFileSync(file, 'utf8')
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.ES2020, true, file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
  const edits: { start: number; end: number; text: string }[] = []

  const visit = (node: ts.Node) => {
    let literalStart = -1
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) literalStart = node.getStart(sf) + 1
    else if (ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) literalStart = node.getStart(sf) + 1
    if (literalStart >= 0) {
      const raw = source.slice(node.getStart(sf), node.getEnd())
      const isTemplatePart = ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)
      const body = isTemplatePart
        ? raw.slice(1, ts.isTemplateTail(node) ? -1 : -2)
        : raw.slice(1, -1)
      if (/[—―]/.test(body) && !isProtected(body)) {
        const next = rewrite(body, ts.isTemplateHead(node) || ts.isTemplateMiddle(node))
        if (next !== body) {
          edits.push({ start: literalStart, end: literalStart + body.length, text: next })
          total++
        }
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)

  if (edits.length && !dry) {
    let out = source
    for (const e of edits.sort((a, b) => b.start - a.start)) out = out.slice(0, e.start) + e.text + out.slice(e.end)
    fs.writeFileSync(file, out)
  }
  if (edits.length) console.log(`${dry ? '[dry] ' : ''}${file}: ${edits.length}`)
}
console.log(`${total} string(s) ${dry ? 'would change' : 'changed'}`)

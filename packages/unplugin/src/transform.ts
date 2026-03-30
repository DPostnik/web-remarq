import { parse } from '@babel/parser'
import MagicString from 'magic-string'

interface TransformResult {
  code: string
  map: ReturnType<MagicString['generateMap']>
}

/**
 * Find the nearest component name by walking up from a JSX element position.
 * Scans the AST body for function/class declarations or variable declarators
 * containing the JSX element at the given position.
 */
function findComponentName(ast: ReturnType<typeof parse>, jsxStart: number): string | null {
  // Walk the AST to find the function/class that contains this position
  const body = ast.program.body
  for (const node of body) {
    if (!containsPosition(node, jsxStart)) continue

    // export default function Foo() { ... }
    // function Foo() { ... }
    if (
      (node.type === 'FunctionDeclaration' || node.type === 'ExportDefaultDeclaration') &&
      containsPosition(node, jsxStart)
    ) {
      if (node.type === 'FunctionDeclaration' && node.id) {
        return node.id.name
      }
      if (node.type === 'ExportDefaultDeclaration') {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const decl = node.declaration as any
        if (decl.type === 'FunctionDeclaration' && decl.id && typeof decl.id.name === 'string') {
          return decl.id.name as string
        }
      }
    }

    // const Foo = () => { ... } / const Foo = memo(() => { ... })
    if (node.type === 'VariableDeclaration') {
      for (const declarator of node.declarations) {
        if (
          declarator.id.type === 'Identifier' &&
          declarator.init &&
          containsPosition(declarator, jsxStart)
        ) {
          return declarator.id.name
        }
      }
    }

    // export const Foo = ...
    if (node.type === 'ExportNamedDeclaration' && node.declaration) {
      const decl = node.declaration
      if (decl.type === 'VariableDeclaration') {
        for (const declarator of decl.declarations) {
          if (
            declarator.id.type === 'Identifier' &&
            declarator.init &&
            containsPosition(declarator, jsxStart)
          ) {
            return declarator.id.name
          }
        }
      }
      if (decl.type === 'FunctionDeclaration' && decl.id && containsPosition(decl, jsxStart)) {
        return decl.id.name
      }
    }

    // class Foo extends Component { ... }
    if (node.type === 'ClassDeclaration' && node.id && containsPosition(node, jsxStart)) {
      return node.id.name
    }
  }

  return null
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function containsPosition(node: any, pos: number): boolean {
  const start = (node.start as number | undefined) ?? -1
  const end = (node.end as number | undefined) ?? -1
  return start <= pos && pos < end
}

/**
 * Collect all JSXOpeningElement positions from the parsed AST.
 */
interface JSXElement {
  /** Position right after the tag name, where we insert attributes */
  insertPos: number
  /** Start position of the element for component name lookup */
  start: number
  /** AST line number */
  line: number
  /** AST column number */
  column: number
  /** Whether data-remarq-source already exists */
  hasSource: boolean
}

function collectJSXElements(ast: ReturnType<typeof parse>): JSXElement[] {
  const elements: JSXElement[] = []
  walkAST(ast.program, (node) => {
    if (node.type !== 'JSXOpeningElement') return

    // Skip fragments
    const name = node.name as Record<string, unknown>
    if (name.type === 'JSXIdentifier' && name.name === '') return
    if (
      name.type === 'JSXMemberExpression' &&
      (name.property as Record<string, unknown>)?.type === 'JSXIdentifier' &&
      ((name.property as Record<string, unknown>).name as string) === 'Fragment'
    ) return

    // Check if already has data-remarq-source
    const attrs = (node.attributes as Array<Record<string, unknown>>) ?? []
    const hasSource = attrs.some(
      attr =>
        attr.type === 'JSXAttribute' &&
        (attr.name as Record<string, unknown>)?.type === 'JSXIdentifier' &&
        ((attr.name as Record<string, unknown>).name as string) === 'data-remarq-source'
    )

    // Find insertion position: after the tag name (before first attribute or before >)
    // The name node has start/end positions
    const nameEnd = (name.end as number | undefined) ?? (node.start as number) + 1
    const loc = node.loc as { start: { line: number; column: number } } | undefined

    elements.push({
      insertPos: nameEnd,
      start: node.start as number,
      line: loc?.start.line ?? 0,
      column: loc?.start.column ?? 0,
      hasSource,
    })
  })
  return elements
}

/**
 * Simple recursive AST walker.
 */
function walkAST(node: unknown, visitor: (node: Record<string, unknown>) => void): void {
  if (!node || typeof node !== 'object') return
  if (Array.isArray(node)) {
    for (const child of node) walkAST(child, visitor)
    return
  }
  const obj = node as Record<string, unknown>
  if (typeof obj.type === 'string') {
    visitor(obj)
  }
  for (const key of Object.keys(obj)) {
    if (key === 'type' || key === 'start' || key === 'end' || key === 'loc') continue
    walkAST(obj[key], visitor)
  }
}

/**
 * Transform JSX/TSX source code to inject data-remarq-source and data-remarq-component.
 */
export function transformJSX(code: string, filePath: string): TransformResult | null {
  let ast: ReturnType<typeof parse>
  try {
    ast = parse(code, {
      sourceType: 'module',
      plugins: ['jsx', 'typescript', 'decorators-legacy'],
      sourceFilename: filePath,
    })
  } catch {
    return null
  }

  const elements = collectJSXElements(ast)
  if (!elements.length) return null

  const s = new MagicString(code)
  let modified = false

  for (const el of elements) {
    if (el.hasSource) continue

    const sourceAttr = ` data-remarq-source="${filePath}:${el.line}:${el.column}"`
    const componentName = findComponentName(ast, el.start)
    const componentAttr = componentName
      ? ` data-remarq-component="${componentName}"`
      : ''

    s.appendLeft(el.insertPos, sourceAttr + componentAttr)
    modified = true
  }

  if (!modified) return null

  return {
    code: s.toString(),
    map: s.generateMap({ hires: true }),
  }
}

/**
 * Transform Vue SFC <template> block to inject data-remarq-source and data-remarq-component.
 * Uses simple regex-based approach for HTML element detection.
 */
export function transformVueSFC(code: string, filePath: string): TransformResult | null {
  // Find <template> block
  const templateMatch = code.match(/<template(\s[^>]*)?>/)
  if (!templateMatch) return null

  const templateStart = templateMatch.index! + templateMatch[0].length
  const templateEndTag = code.lastIndexOf('</template>')
  if (templateEndTag === -1 || templateEndTag <= templateStart) return null

  const templateContent = code.slice(templateStart, templateEndTag)

  // Find opening HTML tags within the template
  // Matches: <tag-name (not </closing, not <!doctype, not <!-- comment)
  const tagRegex = /<([a-zA-Z][a-zA-Z0-9-]*(?:\.[a-zA-Z][a-zA-Z0-9-]*)*)(?=[\s/>])/g

  const s = new MagicString(code)
  let modified = false
  let match: RegExpExecArray | null

  // Compute line numbers for the template section
  const linesBeforeTemplate = code.slice(0, templateStart).split('\n').length

  while ((match = tagRegex.exec(templateContent)) !== null) {
    const tagName = match[1]
    // Skip Vue built-in tags that don't render DOM elements
    if (['template', 'slot', 'component', 'transition', 'transition-group', 'keep-alive', 'teleport', 'suspense'].includes(tagName)) continue

    // Check if already annotated
    const afterTag = templateContent.slice(match.index + match[0].length)
    const closingBracket = afterTag.indexOf('>')
    if (closingBracket === -1) continue
    const attrsPart = afterTag.slice(0, closingBracket)
    if (attrsPart.includes('data-remarq-source')) continue

    // Calculate line number within template
    const textBefore = templateContent.slice(0, match.index)
    const lineInTemplate = textBefore.split('\n').length
    const line = linesBeforeTemplate + lineInTemplate - 1
    const lastNewline = textBefore.lastIndexOf('\n')
    const col = lastNewline === -1 ? match.index : match.index - lastNewline - 1

    const insertPos = templateStart + match.index + match[0].length
    const sourceAttr = ` data-remarq-source="${filePath}:${line}:${col}"`

    // For Vue SFC, component name is the filename without extension
    const componentName = filePath.split('/').pop()?.replace(/\.vue$/, '') ?? null
    const componentAttr = componentName
      ? ` data-remarq-component="${componentName}"`
      : ''

    s.appendLeft(insertPos, sourceAttr + componentAttr)
    modified = true
  }

  if (!modified) return null

  return {
    code: s.toString(),
    map: s.generateMap({ hires: true }),
  }
}

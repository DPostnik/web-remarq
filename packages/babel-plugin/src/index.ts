import { relative } from 'path'
import type { PluginObj, PluginPass } from '@babel/core'
import type { NodePath } from '@babel/traverse'
import type * as BabelTypes from '@babel/types'

interface Options {
  production?: boolean
}

interface API {
  types: typeof BabelTypes
}

function findComponentName(t: typeof BabelTypes, startPath: NodePath): string | null {
  let current: NodePath | null = startPath.parentPath
  while (current) {
    // function MyComponent() { ... }
    if (current.isFunctionDeclaration() && current.node.id) {
      return (current.node.id as BabelTypes.Identifier).name
    }

    // Named function expression: memo(function MyComponent() { ... })
    if (current.isFunctionExpression()) {
      const id = (current.node as BabelTypes.FunctionExpression).id
      if (id) return id.name
    }

    // Arrow / anonymous function expression
    if (current.isArrowFunctionExpression() || current.isFunctionExpression()) {
      const parent = current.parentPath
      // const MyComponent = () => ...
      if (parent?.isVariableDeclarator() && t.isIdentifier(parent.node.id)) {
        return parent.node.id.name
      }
      // const MyComponent = memo(() => ...)
      if (parent?.isCallExpression()) {
        const gp = parent.parentPath
        if (gp?.isVariableDeclarator() && t.isIdentifier(gp.node.id)) {
          return gp.node.id.name
        }
      }
    }

    // class MyComponent extends Component { ... }
    if (current.isClassDeclaration() && current.node.id) {
      return (current.node.id as BabelTypes.Identifier).name
    }

    current = current.parentPath
  }
  return null
}

export default function webRemarqPlugin(api: API, options: Options = {}): PluginObj<PluginPass> {
  const { types: t } = api

  return {
    name: 'web-remarq',
    visitor: {
      JSXOpeningElement(path, state) {
        // Dev-only by default
        if (!options.production && process.env.NODE_ENV === 'production') return

        const name = path.node.name

        // Skip JSX fragments (<> and <React.Fragment>)
        if (t.isJSXIdentifier(name) && name.name === '') return
        if (
          t.isJSXMemberExpression(name) &&
          t.isJSXIdentifier(name.property) &&
          name.property.name === 'Fragment'
        ) return

        // Skip already annotated elements
        const alreadyAnnotated = path.node.attributes.some(
          attr =>
            t.isJSXAttribute(attr) &&
            t.isJSXIdentifier(attr.name) &&
            attr.name.name === 'data-remarq-source'
        )
        if (alreadyAnnotated) return

        // Compute relative file path (forward slashes)
        const filename = state.filename || 'unknown'
        const cwd = state.cwd || process.cwd()
        const rel = relative(cwd, filename).split('\\').join('/')

        // Source location from AST
        const loc = path.node.loc?.start
        const line = loc?.line ?? 0
        const col = loc?.column ?? 0

        // Inject data-remarq-source="path:line:col"
        path.node.attributes.push(
          t.jsxAttribute(
            t.jsxIdentifier('data-remarq-source'),
            t.stringLiteral(`${rel}:${line}:${col}`)
          )
        )

        // Inject data-remarq-component="ComponentName" (if found)
        const componentName = findComponentName(t, path as unknown as NodePath)
        if (componentName) {
          path.node.attributes.push(
            t.jsxAttribute(
              t.jsxIdentifier('data-remarq-component'),
              t.stringLiteral(componentName)
            )
          )
        }
      },
    },
  }
}

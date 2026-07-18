import { describe, expect, it } from 'vitest'
import type { Annotation } from 'web-remarq'
import { renderTaskFile } from './task-folder'

export function ann(id: string, status: Annotation['status'] = 'pending', extra: Partial<Annotation> = {}): Annotation {
  return {
    id, comment: `c-${id}`, route: '/', viewport: '1024x768', viewportBucket: 1000,
    timestamp: 1, status,
    lifecycle: [{ type: 'created', actor: 'designer', timestamp: 1 }],
    fingerprint: {
      dataAnnotate: null, dataTestId: null, id: null, tagName: 'button', textContent: null,
      role: null, ariaLabel: null, stableClasses: [], domPath: 'body > button', siblingIndex: 0,
      parentAnchor: null, sourceLocation: null, componentName: null, detectedSource: null, detectedComponent: null,
    },
    ...extra,
  }
}

describe('renderTaskFile', () => {
  it('renders frontmatter with id, route, status and the comment', () => {
    const md = renderTaskFile(ann('a1b2c3d4', 'pending', { route: '/dashboard', comment: 'Increase padding' }))
    expect(md.startsWith('---\n')).toBe(true)
    expect(md).toContain('id: "a1b2c3d4"')
    expect(md).toContain('route: "/dashboard"')
    expect(md).toContain('status: pending')
    expect(md).toContain('Increase padding')
    expect(md.endsWith('\n')).toBe(true)
  })

  it('includes source file:line:col and search hints when the fingerprint has them', () => {
    const a = ann('a1')
    a.fingerprint.sourceLocation = 'src/components/Form.tsx:24:6'
    a.fingerprint.componentName = 'Form'
    a.fingerprint.dataTestId = 'save-btn'
    const md = renderTaskFile(a)
    expect(md).toContain('src/components/Form.tsx:24:6')
    expect(md).toContain('Form')
    expect(md).toContain('data-testid="save-btn"')
    expect(md).toContain('[high]')
  })

  it('omits source line and search hints section when unavailable', () => {
    const md = renderTaskFile(ann('a1'))
    expect(md).not.toContain('Source:')
    expect(md).not.toContain('## Search hints')
  })

  it('instructs the agent to acknowledge before working and claim_fix via MCP, never edit the file', () => {
    const md = renderTaskFile(ann('a1b2c3d4'))
    expect(md).toContain('acknowledge')
    expect(md).toContain('claim_fix')
    expect(md).toContain('"a1b2c3d4"')
    expect(md.toLowerCase()).toContain('do not edit')
  })

  it('surfaces a non-clear quality verdict', () => {
    const md = renderTaskFile(ann('a1', 'pending', {
      qualityCheck: {
        score: 'ambiguous', issues: ['Which button?'], clarifyingQuestions: ['Left or right button?'],
        refinedBy: 'auto', timestamp: 2,
      },
    }))
    expect(md).toContain('quality: ambiguous')
    expect(md).toContain('Which button?')
    expect(md).toContain('Left or right button?')
  })

  it('is deterministic for the same annotation', () => {
    expect(renderTaskFile(ann('a1'))).toBe(renderTaskFile(ann('a1')))
  })
})

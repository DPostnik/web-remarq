import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Annotation } from 'web-remarq'
import { renderTaskFile, TaskFolder } from './task-folder'
import { FileStorageAdapter } from './file-storage-adapter'

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

describe('TaskFolder', () => {
  let dir: string
  let tasksDir: string
  let adapter: FileStorageAdapter

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'remarq-tasks-'))
    tasksDir = join(dir, '.remarq', 'tasks')
    adapter = new FileStorageAdapter(join(dir, '.remarq', 'annotations.json'))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('sync() writes one <id>.md per actionable annotation only', async () => {
    await adapter.save(ann('p1', 'pending'))
    await adapter.save(ann('w2', 'in_progress'))
    await adapter.save(ann('d3', 'draft'))
    await adapter.save(ann('f4', 'fixed_unverified'))
    await adapter.save(ann('v5', 'verified'))
    await adapter.save(ann('x6', 'dismissed'))
    const folder = new TaskFolder(adapter, tasksDir)
    await folder.sync()
    expect(readdirSync(tasksDir).sort()).toEqual(['p1.md', 'w2.md'])
    expect(readFileSync(join(tasksDir, 'p1.md'), 'utf8')).toBe(renderTaskFile(ann('p1', 'pending')))
  })

  it('sync() deletes files whose annotation left the actionable states', async () => {
    await adapter.save(ann('p1', 'pending'))
    const folder = new TaskFolder(adapter, tasksDir)
    await folder.sync()
    expect(readdirSync(tasksDir)).toEqual(['p1.md'])
    await adapter.save(ann('p1', 'verified'))
    await folder.sync()
    expect(readdirSync(tasksDir)).toEqual([])
  })

  it('sync() updates the file when the annotation changes (status pending -> in_progress)', async () => {
    await adapter.save(ann('p1', 'pending'))
    const folder = new TaskFolder(adapter, tasksDir)
    await folder.sync()
    await adapter.save(ann('p1', 'in_progress'))
    await folder.sync()
    expect(readFileSync(join(tasksDir, 'p1.md'), 'utf8')).toContain('status: in_progress')
  })

  it('sync() removes stale .md files but leaves non-md files alone', async () => {
    mkdirSync(tasksDir, { recursive: true })
    writeFileSync(join(tasksDir, 'stale.md'), 'orphan')
    writeFileSync(join(tasksDir, 'notes.txt'), 'keep me')
    const folder = new TaskFolder(adapter, tasksDir)
    await folder.sync()
    expect(readdirSync(tasksDir)).toEqual(['notes.txt'])
  })

  it('sync() does not rewrite an unchanged file (mtime stable)', async () => {
    await adapter.save(ann('p1', 'pending'))
    const folder = new TaskFolder(adapter, tasksDir)
    await folder.sync()
    const before = statSync(join(tasksDir, 'p1.md')).mtimeMs
    await new Promise((r) => setTimeout(r, 20))
    await folder.sync()
    expect(statSync(join(tasksDir, 'p1.md')).mtimeMs).toBe(before)
  })

  it('schedule() coalesces a burst into finite syncs and settles on the final state', async () => {
    const folder = new TaskFolder(adapter, tasksDir)
    await adapter.save(ann('p1', 'pending'))
    folder.schedule()
    folder.schedule()
    folder.schedule()
    // let the coalescing loop drain
    await vi.waitFor(() => {
      expect(readdirSync(tasksDir)).toEqual(['p1.md'])
    })
  })

  it('schedule() survives a storage error and logs to stderr', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const broken = new TaskFolder(
      { load: () => Promise.reject(new Error('boom')), save: async () => {}, remove: async () => {}, clear: async () => {} } as unknown as FileStorageAdapter,
      tasksDir,
    )
    broken.schedule()
    await vi.waitFor(() => {
      expect(errSpy).toHaveBeenCalledWith(expect.stringContaining('task folder'), expect.any(Error))
    })
    errSpy.mockRestore()
  })
})

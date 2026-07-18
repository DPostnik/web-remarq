import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'

/**
 * The "agent on duty" dispatcher prompt, exposed via MCP prompts so clients
 * that support them (Claude Code renders it as /mcp__web-remarq__watch)
 * don't need the copy-paste block from the README.
 * Keep the text in sync with the README's "Parallel mode" section.
 */
export const DUTY_PROMPT =
  'You are on annotation duty for this project. Designers drop feedback via ' +
  'the web-remarq MCP server. Run this loop until told to stop: call ' +
  'watch_annotations (timeoutSeconds: 60); if it times out, call it again. ' +
  'For EACH annotation it returns, call acknowledge with its id first. Then, ' +
  'if you can run background subagents, dispatch one that applies the fix to ' +
  'the project files and calls claim_fix when done - do not fix anything ' +
  'yourself in the main loop and do not wait for subagents, go straight back ' +
  'to watch_annotations so new feedback is never missed. Without background ' +
  'subagents, apply the fix inline after acknowledging, then return to ' +
  'watch_annotations. If a comment is ambiguous or unactionable, dismiss it ' +
  'with a reason instead of guessing.'

export function registerPrompts(server: McpServer): void {
  server.registerPrompt(
    'watch',
    {
      title: 'Annotation duty (dispatcher loop)',
      description:
        'Put this agent on annotation duty: loop on watch_annotations, acknowledge each annotation first, hand the fix to a background subagent that calls claim_fix, return to watching immediately.',
    },
    () => ({
      messages: [{ role: 'user' as const, content: { type: 'text' as const, text: DUTY_PROMPT } }],
    }),
  )
}

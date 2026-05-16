export type ToolErrorCode =
  | 'annotation_not_found'
  | 'invalid_transition'
  | 'storage_error'
  | 'validation_error'

export interface ToolErrorPayload {
  code: ToolErrorCode
  message: string
  details?: Record<string, unknown>
}

export interface ToolErrorResult {
  isError: true
  content: Array<{ type: 'text'; text: string }>
}

export function toolError(code: ToolErrorCode, message: string, details?: Record<string, unknown>): ToolErrorResult {
  const payload: ToolErrorPayload = { code, message, details }
  return {
    isError: true,
    content: [{ type: 'text', text: JSON.stringify(payload) }],
  }
}

export function toolSuccess(value: unknown): { content: Array<{ type: 'text'; text: string }> } {
  return {
    content: [{ type: 'text', text: JSON.stringify(value) }],
  }
}

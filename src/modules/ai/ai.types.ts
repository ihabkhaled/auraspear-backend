export interface AiTokenUsage {
  input: number
  output: number
}

export interface AiResponse {
  result: string
  reasoning: string[]
  confidence: number
  model: string
  tokensUsed: AiTokenUsage
}

export interface CreateAiAuditLogData {
  tenantId: string
  actor: string
  action: string
  model: string
  inputTokens: number
  outputTokens: number
  durationMs: number
  prompt?: string
  response?: string
}

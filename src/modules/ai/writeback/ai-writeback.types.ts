import type { AiFindingType } from '../../../common/enums'

export interface AiWritebackParameters {
  tenantId: string
  sessionId: string
  agentId: string
  sourceModule: string
  sourceEntityId?: string
  aiResponse: AiWritebackResponse
  actionType: string
  /** True when the sessionId corresponds to a real AiAgentSession record (FK-linked to AiAgent). */
  hasRealSession?: boolean
  /** Schedule ID if triggered by a schedule */
  scheduleId?: string
  /** Duration of the AI execution in milliseconds */
  durationMs?: number
}

export interface AiWritebackResponse {
  result: string
  model: string
  provider: string
  confidence?: number
  tokensUsed: { input: number; output: number }
}

export interface ParsedAiFinding {
  findingType: AiFindingType
  title: string
  summary: string
  confidence: number | null
  severity: string | null
  recommendedAction: string | null
}

export interface SearchFindingsOptions {
  query?: string
  sourceModule?: string
  agentId?: string
  status?: string
  findingType?: string
  severity?: string
  sourceEntityId?: string
  confidenceMin?: number
  confidenceMax?: number
  dateFrom?: string
  dateTo?: string
  sortBy?: string
  sortOrder?: string
  page?: number
  limit?: number
}

export interface SearchFindingsResult {
  data: unknown[]
  total: number
}

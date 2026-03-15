import type { PaginatedResponse } from '../../common/interfaces/pagination.interface'
import type { AiAgent, AiAgentSession, AiAgentTool } from '@prisma/client'

export type AiAgentRecord = AiAgent & {
  toolsCount: number
  sessionsCount: number
  tools?: AiAgentTool[]
  recentSessions?: AiAgentSession[]
}

export type PaginatedAgents = PaginatedResponse<
  AiAgent & {
    toolsCount: number
    sessionsCount: number
  }
>

export interface AiAgentStats {
  totalAgents: number
  onlineAgents: number
  totalSessions: number
  totalTokens: number
  totalCost: number
}

export type AiAgentSessionRecord = AiAgentSession

export type AiAgentToolRecord = AiAgentTool

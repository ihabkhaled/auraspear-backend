import type { PaginatedResponse } from '../../common/interfaces/pagination.interface'
import type { AiAgent, AiAgentSession, AiAgentTool } from '@prisma/client'

export type AiAgentRecord = Omit<AiAgent, 'totalTokens'> & {
  totalTokens: string
  toolsCount: number
  sessionsCount: number
  tools?: AiAgentTool[]
  recentSessions?: AiAgentSession[]
}

export type PaginatedAgents = PaginatedResponse<
  Omit<AiAgent, 'totalTokens'> & {
    totalTokens: string
    toolsCount: number
    sessionsCount: number
  }
>

export interface AiAgentStats {
  totalAgents: number
  onlineAgents: number
  totalSessions: number
  totalTokens: string
  totalCost: number
}

// Note: totalTokens is serialized as string to avoid JS Number overflow for BigInt values

export type AiAgentSessionRecord = AiAgentSession

export type AiAgentToolRecord = AiAgentTool

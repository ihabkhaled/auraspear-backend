import type { PaginatedResponse } from '../../common/interfaces/pagination.interface'
import type {
  Case,
  CaseArtifact,
  CaseComment,
  CaseCommentMention,
  CaseNote,
  CaseTask,
  CaseTimeline,
  TenantMembership,
} from '@prisma/client'

export type CaseRecord = Case & {
  notes: CaseNote[]
  timeline: CaseTimeline[]
  tasks: CaseTask[]
  artifacts: CaseArtifact[]
  ownerName: string | null
  ownerEmail: string | null
  createdByName: string | null
  tenantName: string
}

export type PaginatedCases = PaginatedResponse<
  Case & {
    ownerName: string | null
    ownerEmail: string | null
    createdByName: string | null
    tenantName: string
  }
>

export type PaginatedCaseNotes = PaginatedResponse<CaseNote>

export interface CommentAuthor {
  id: string
  name: string
  email: string
}

export interface CommentMentionUser {
  id: string
  name: string
  email: string
}

export interface CaseCommentResponse {
  id: string
  caseId: string
  body: string
  isEdited: boolean
  isDeleted: boolean
  createdAt: Date
  updatedAt: Date
  author: CommentAuthor
  mentions: CommentMentionUser[]
}

export type PaginatedCaseComments = PaginatedResponse<CaseCommentResponse>

export type CaseWithRelations = Case & {
  notes: CaseNote[]
  timeline: CaseTimeline[]
  tasks: CaseTask[]
  artifacts: CaseArtifact[]
  tenant: { name: string }
}

export type CaseWithTenant = Case & { tenant: { name: string } }

export type CaseCommentWithMentions = CaseComment & {
  mentions: CaseCommentMention[]
}

export type MembershipWithUser = TenantMembership & {
  user: { id: string; name: string; email: string }
}

export interface MentionableUser {
  id: string
  name: string
  email: string
}

export interface CaseStats {
  total: number
  open: number
  inProgress: number
  closed: number
  bySeverity: {
    critical: number
    high: number
    medium: number
    low: number
  }
  closedLast30d: number
  avgResolutionHours: number | null
}

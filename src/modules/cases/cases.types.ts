import type { PaginatedResponse } from '../../common/interfaces/pagination.interface'
import type {
  Case,
  CaseArtifact,
  CaseComment,
  CaseCommentMention,
  CaseNote,
  CaseTask,
  CaseTimeline,
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

export type CaseCommentWithMentions = CaseComment & {
  mentions: CaseCommentMention[]
}

export interface MentionableUser {
  id: string
  name: string
  email: string
}

import type { PaginatedResponse } from '../../common/interfaces/pagination.interface'

export interface NotificationResponse {
  id: string
  type: string
  actorName: string
  actorEmail: string
  title: string
  message: string
  entityType: string
  entityId: string
  caseId: string | null
  caseCommentId: string | null
  isRead: boolean
  createdAt: Date
}

export type PaginatedNotifications = PaginatedResponse<NotificationResponse>

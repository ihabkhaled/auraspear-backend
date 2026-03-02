import type { PaginatedResponse } from '../../common/interfaces/pagination.interface'
import type { AuditLog } from '@prisma/client'

export type AuditLogRecord = AuditLog

export type PaginatedAuditLogs = PaginatedResponse<AuditLogRecord>

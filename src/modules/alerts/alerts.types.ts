import type { PaginatedResponse } from '../../common/interfaces/pagination.interface'
import type { Alert } from '@prisma/client'

export type AlertRecord = Alert

export type PaginatedAlerts = PaginatedResponse<AlertRecord>

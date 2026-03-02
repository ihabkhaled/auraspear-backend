import type { PaginatedResponse } from '../../common/interfaces/pagination.interface'
import type { HuntSession, HuntEvent } from '@prisma/client'

export type HuntSessionRecord = HuntSession & { events: HuntEvent[] }
export type PaginatedHuntSessions = PaginatedResponse<HuntSession>
export type PaginatedHuntEvents = PaginatedResponse<HuntEvent>

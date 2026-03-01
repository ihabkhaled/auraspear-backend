import { randomUUID } from 'node:crypto'
import { Injectable, Logger, NotFoundException } from '@nestjs/common'
import { CreateCaseDto } from './dto/create-case.dto'
import { CreateNoteDto } from './dto/create-note.dto'
import { LinkAlertDto } from './dto/link-alert.dto'
import { UpdateCaseDto } from './dto/update-case.dto'
import { JwtPayload } from '../../common/interfaces/authenticated-request.interface'
import { PrismaService } from '../../prisma/prisma.service'
import type { CaseNote, CaseRecord, PaginatedCases } from './cases.types'

@Injectable()
export class CasesService {
  private readonly logger = new Logger(CasesService.name)

  /** In-memory store keyed by case ID. */
  private readonly cases: Map<string, CaseRecord> = new Map()
  private caseCounter = 15 // start after mock data

  constructor(private readonly prisma: PrismaService) {
    this.seedMockCases()
  }

  /* ---------------------------------------------------------------- */
  /* LIST (paginated, tenant-scoped)                                   */
  /* ---------------------------------------------------------------- */

  async listCases(tenantId: string, page = 1, limit = 20): Promise<PaginatedCases> {
    // Try Prisma first
    try {
      const where = { tenantId }
      const [total, rows] = await Promise.all([
        this.prisma.case.count({ where }),
        this.prisma.case.findMany({
          where,
          skip: (page - 1) * limit,
          take: limit,
          orderBy: { createdAt: 'desc' },
        }),
      ])

      if (total > 0) {
        const totalPages = Math.ceil(total / limit)
        return {
          data: rows.map((r: Record<string, unknown>) => this.mapPrismaCase(r)),
          pagination: {
            page,
            limit,
            total,
            totalPages,
            hasNext: page < totalPages,
            hasPrev: page > 1,
          },
        }
      }
    } catch {
      this.logger.warn('cases table not available; using in-memory store')
    }

    // Fallback to in-memory mock
    const allCases = [...this.cases.values()]
      .filter(c => c.tenantId === tenantId)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())

    const total = allCases.length
    const totalPages = Math.ceil(total / limit)
    const start = (page - 1) * limit
    const paginated = allCases.slice(start, start + limit)

    return {
      data: paginated.map(({ notes: _n, ...rest }) => rest),
      pagination: {
        page,
        limit,
        total,
        totalPages,
        hasNext: page < totalPages,
        hasPrev: page > 1,
      },
    }
  }

  /* ---------------------------------------------------------------- */
  /* CREATE                                                            */
  /* ---------------------------------------------------------------- */

  async createCase(dto: CreateCaseDto, user: JwtPayload): Promise<CaseRecord> {
    const id = randomUUID()
    this.caseCounter += 1
    const caseNumber = `SOC-2026-${String(this.caseCounter).padStart(3, '0')}`
    const now = new Date().toISOString()

    const newCase: CaseRecord = {
      id,
      caseNumber,
      tenantId: user.tenantId,
      title: dto.title,
      description: dto.description,
      severity: dto.severity,
      status: 'open',
      ownerUserId: dto.ownerUserId ?? null,
      createdBy: user.email,
      createdAt: now,
      updatedAt: now,
      closedAt: null,
      linkedAlerts: [],
      timeline: [
        {
          id: randomUUID(),
          timestamp: now,
          type: 'creation',
          actor: user.email,
          description: `Case ${caseNumber} created: ${dto.title}`,
        },
      ],
      notes: [],
    }

    // Try Prisma
    try {
      await this.prisma.case.create({
        data: {
          id,
          tenantId: user.tenantId,
          title: dto.title,
          description: dto.description,
          severity: dto.severity,
          status: 'open',
          ownerUserId: dto.ownerUserId ?? null,
        },
      })
    } catch {
      this.logger.warn('cases table not available; storing in memory')
    }

    this.cases.set(id, newCase)
    this.logger.log(`Case ${caseNumber} created by ${user.email} for tenant ${user.tenantId}`)
    return newCase
  }

  /* ---------------------------------------------------------------- */
  /* GET BY ID                                                         */
  /* ---------------------------------------------------------------- */

  async getCaseById(id: string, tenantId: string): Promise<CaseRecord> {
    const c = this.cases.get(id)
    if (c?.tenantId === tenantId) {
      return c
    }

    // Try Prisma
    try {
      const row = await this.prisma.case.findFirst({
        where: { id, tenantId },
      })
      if (row) {
        return this.mapPrismaCase(row) as CaseRecord
      }
    } catch {
      // table unavailable
    }

    throw new NotFoundException(`Case ${id} not found`)
  }

  /* ---------------------------------------------------------------- */
  /* UPDATE                                                            */
  /* ---------------------------------------------------------------- */

  async updateCase(id: string, dto: UpdateCaseDto, user: JwtPayload): Promise<CaseRecord> {
    const existing = await this.getCaseById(id, user.tenantId)
    const now = new Date().toISOString()

    const updated: CaseRecord = {
      ...existing,
      title: dto.title ?? existing.title,
      description: dto.description ?? existing.description,
      severity: dto.severity ?? existing.severity,
      status: dto.status ?? existing.status,
      ownerUserId: dto.ownerUserId ?? existing.ownerUserId,
      closedAt: dto.status === 'closed' ? (dto.closedAt ?? now) : existing.closedAt,
      updatedAt: now,
      timeline: [
        ...existing.timeline,
        {
          id: randomUUID(),
          timestamp: now,
          type: 'update',
          actor: user.email,
          description: `Case updated: ${Object.keys(dto).join(', ')} modified`,
        },
      ],
    }

    this.cases.set(id, updated)

    // Try Prisma
    try {
      await this.prisma.case.update({
        where: { id },
        data: {
          title: updated.title,
          description: updated.description,
          severity: updated.severity as 'critical' | 'high' | 'medium' | 'low',
          status: updated.status as 'open' | 'in_progress' | 'closed',
          ownerUserId: updated.ownerUserId,
          closedAt: updated.closedAt ? new Date(updated.closedAt) : null,
        },
      })
    } catch {
      // table unavailable
    }

    this.logger.log(`Case ${existing.caseNumber} updated by ${user.email}`)
    return updated
  }

  /* ---------------------------------------------------------------- */
  /* DELETE                                                            */
  /* ---------------------------------------------------------------- */

  async deleteCase(id: string, tenantId: string): Promise<{ deleted: boolean }> {
    const existing = this.cases.get(id)
    if (existing?.tenantId !== tenantId) {
      throw new NotFoundException(`Case ${id} not found`)
    }

    this.cases.delete(id)

    try {
      await this.prisma.case.delete({ where: { id } })
    } catch {
      // table unavailable
    }

    this.logger.log(`Case ${existing.caseNumber} deleted`)
    return { deleted: true }
  }

  /* ---------------------------------------------------------------- */
  /* LINK ALERT                                                        */
  /* ---------------------------------------------------------------- */

  async linkAlert(caseId: string, dto: LinkAlertDto, user: JwtPayload): Promise<CaseRecord> {
    const existing = await this.getCaseById(caseId, user.tenantId)
    const now = new Date().toISOString()

    const alreadyLinked = existing.linkedAlerts.some(a => a.alertId === dto.alertId)
    if (alreadyLinked) {
      return existing
    }

    existing.linkedAlerts.push({
      alertId: dto.alertId,
      indexName: dto.indexName,
      linkedAt: now,
      linkedBy: user.email,
    })

    existing.timeline.push({
      id: randomUUID(),
      timestamp: now,
      type: 'link',
      actor: user.email,
      description: `Alert ${dto.alertId} linked from index ${dto.indexName}`,
    })

    existing.updatedAt = now
    this.cases.set(caseId, existing)

    this.logger.log(`Alert ${dto.alertId} linked to case ${existing.caseNumber}`)
    return existing
  }

  /* ---------------------------------------------------------------- */
  /* NOTES                                                             */
  /* ---------------------------------------------------------------- */

  async getCaseNotes(caseId: string, tenantId: string): Promise<CaseNote[]> {
    const existing = await this.getCaseById(caseId, tenantId)
    return existing.notes
  }

  async addCaseNote(caseId: string, dto: CreateNoteDto, user: JwtPayload): Promise<CaseNote> {
    const existing = await this.getCaseById(caseId, user.tenantId)
    const now = new Date().toISOString()

    const note: CaseNote = {
      id: randomUUID(),
      caseId,
      body: dto.body,
      createdBy: user.email,
      createdAt: now,
    }

    existing.notes.push(note)
    existing.timeline.push({
      id: randomUUID(),
      timestamp: now,
      type: 'note',
      actor: user.email,
      description: `Note added: ${dto.body.slice(0, 80)}${dto.body.length > 80 ? '...' : ''}`,
    })

    existing.updatedAt = now
    this.cases.set(caseId, existing)

    this.logger.log(`Note added to case ${existing.caseNumber} by ${user.email}`)
    return note
  }

  /* ---------------------------------------------------------------- */
  /* Helpers                                                           */
  /* ---------------------------------------------------------------- */

  private mapPrismaCase(row: Record<string, unknown>): Omit<CaseRecord, 'notes'> {
    return {
      id: row.id as string,
      caseNumber: `SOC-${row.id}`,
      tenantId: row.tenantId as string,
      title: row.title as string,
      description: (row.description as string) ?? '',
      severity: row.severity as string,
      status: row.status as string,
      ownerUserId: (row.ownerUserId as string) ?? null,
      createdBy: '',
      createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : '',
      updatedAt: row.updatedAt instanceof Date ? row.updatedAt.toISOString() : '',
      closedAt: row.closedAt instanceof Date ? row.closedAt.toISOString() : null,
      linkedAlerts: [],
      timeline: [],
    }
  }

  private seedMockCases(): void {
    const tenantId = 'tenant-001'
    const mockCases: CaseRecord[] = [
      {
        id: 'case-001',
        caseNumber: 'SOC-2026-001',
        tenantId,
        title: 'Active Ransomware Incident on File Server',
        description:
          'Mass file encryption detected on file-server-02. Immediate containment and investigation required.',
        severity: 'critical',
        status: 'in_progress',
        ownerUserId: 'user-001',
        createdBy: 'system',
        createdAt: '2026-03-01T12:50:00Z',
        updatedAt: '2026-03-01T14:30:00Z',
        closedAt: null,
        linkedAlerts: [
          {
            alertId: 'alert-003',
            indexName: 'wazuh-alerts-2026.03',
            linkedAt: '2026-03-01T12:50:00Z',
            linkedBy: 'system',
          },
        ],
        timeline: [
          {
            id: 'tl-001',
            timestamp: '2026-03-01T12:50:00Z',
            type: 'creation',
            actor: 'System',
            description:
              'Case automatically created from critical alert: Ransomware File Encryption Detected',
          },
          {
            id: 'tl-002',
            timestamp: '2026-03-01T12:55:00Z',
            type: 'assignment',
            actor: 'Dispatch',
            description: 'Case assigned to Sarah Chen (Incident Lead)',
          },
          {
            id: 'tl-003',
            timestamp: '2026-03-01T13:05:00Z',
            type: 'action',
            actor: 'Sarah Chen',
            description: 'Initiated network isolation of file-server-02 from all network segments',
          },
        ],
        notes: [
          {
            id: 'note-001',
            caseId: 'case-001',
            body: 'Confirmed ransomware variant: LockBit 3.0. Encryption started at 12:42 UTC. Approximately 1247 files affected.',
            createdBy: 'sarah.chen@auraspear.com',
            createdAt: '2026-03-01T13:30:00Z',
          },
        ],
      },
      {
        id: 'case-002',
        caseNumber: 'SOC-2026-002',
        tenantId,
        title: 'Brute Force Campaign Against Domain Controller',
        description:
          'Sustained brute force attack targeting SSH and RDP services on dc-01. Over 500 failed attempts from external IP.',
        severity: 'high',
        status: 'in_progress',
        ownerUserId: 'user-002',
        createdBy: 'system',
        createdAt: '2026-03-01T13:20:00Z',
        updatedAt: '2026-03-01T14:15:00Z',
        closedAt: null,
        linkedAlerts: [
          {
            alertId: 'alert-002',
            indexName: 'wazuh-alerts-2026.03',
            linkedAt: '2026-03-01T13:20:00Z',
            linkedBy: 'system',
          },
        ],
        timeline: [
          {
            id: 'tl-006',
            timestamp: '2026-03-01T13:20:00Z',
            type: 'creation',
            actor: 'System',
            description: 'Case created from critical alert: Brute Force Attack Detected',
          },
          {
            id: 'tl-007',
            timestamp: '2026-03-01T13:25:00Z',
            type: 'assignment',
            actor: 'Dispatch',
            description: 'Case assigned to Mike Torres',
          },
          {
            id: 'tl-008',
            timestamp: '2026-03-01T13:40:00Z',
            type: 'action',
            actor: 'Mike Torres',
            description: 'Blocked source IP 198.51.100.22 at perimeter firewall',
          },
        ],
        notes: [
          {
            id: 'note-002',
            caseId: 'case-002',
            body: 'Source IP traced to known botnet infrastructure. No successful logins confirmed. Forced password reset for targeted accounts.',
            createdBy: 'mike.torres@auraspear.com',
            createdAt: '2026-03-01T14:00:00Z',
          },
        ],
      },
      {
        id: 'case-003',
        caseNumber: 'SOC-2026-003',
        tenantId,
        title: 'C2 Beaconing from Workstation-17',
        description:
          'Periodic beaconing activity detected from workstation-17 to known C2 infrastructure. DNS tunneling observed.',
        severity: 'high',
        status: 'in_progress',
        ownerUserId: 'user-001',
        createdBy: 'sarah.chen@auraspear.com',
        createdAt: '2026-03-01T10:10:00Z',
        updatedAt: '2026-03-01T13:45:00Z',
        closedAt: null,
        linkedAlerts: [
          {
            alertId: 'alert-005',
            indexName: 'wazuh-alerts-2026.03',
            linkedAt: '2026-03-01T10:10:00Z',
            linkedBy: 'sarah.chen@auraspear.com',
          },
          {
            alertId: 'alert-010',
            indexName: 'wazuh-alerts-2026.03',
            linkedAt: '2026-03-01T10:15:00Z',
            linkedBy: 'sarah.chen@auraspear.com',
          },
        ],
        timeline: [
          {
            id: 'tl-010',
            timestamp: '2026-03-01T10:10:00Z',
            type: 'creation',
            actor: 'Analyst',
            description:
              'Case created manually after correlating C2 and DNS tunneling alerts from workstation-17',
          },
          {
            id: 'tl-011',
            timestamp: '2026-03-01T10:30:00Z',
            type: 'action',
            actor: 'Sarah Chen',
            description: 'Initiated EDR isolation on workstation-17',
          },
        ],
        notes: [
          {
            id: 'note-003',
            caseId: 'case-003',
            body: 'Beaconing interval is approximately 60 seconds. C2 domain update-service.xyz registered 3 days ago.',
            createdBy: 'sarah.chen@auraspear.com',
            createdAt: '2026-03-01T11:00:00Z',
          },
        ],
      },
      {
        id: 'case-004',
        caseNumber: 'SOC-2026-004',
        tenantId,
        title: 'SQL Injection Attack on Web Application',
        description:
          'Active SQL injection exploitation attempt detected against web-server-01 API endpoint.',
        severity: 'critical',
        status: 'open',
        ownerUserId: 'user-002',
        createdBy: 'system',
        createdAt: '2026-03-01T14:35:00Z',
        updatedAt: '2026-03-01T14:35:00Z',
        closedAt: null,
        linkedAlerts: [
          {
            alertId: 'alert-001',
            indexName: 'wazuh-alerts-2026.03',
            linkedAt: '2026-03-01T14:35:00Z',
            linkedBy: 'system',
          },
        ],
        timeline: [
          {
            id: 'tl-036',
            timestamp: '2026-03-01T14:35:00Z',
            type: 'creation',
            actor: 'System',
            description: 'Case created from critical alert: Possible SQL Injection Attempt',
          },
        ],
        notes: [],
      },
      {
        id: 'case-005',
        caseNumber: 'SOC-2026-005',
        tenantId,
        title: 'Data Exfiltration to Cloud Storage',
        description:
          'Large file upload detected from db-primary to external cloud storage. Confirmed as authorized backup activity.',
        severity: 'high',
        status: 'closed',
        ownerUserId: 'user-002',
        createdBy: 'system',
        createdAt: '2026-02-28T13:15:00Z',
        updatedAt: '2026-02-28T18:00:00Z',
        closedAt: '2026-02-28T18:00:00Z',
        linkedAlerts: [
          {
            alertId: 'alert-013',
            indexName: 'wazuh-alerts-2026.02',
            linkedAt: '2026-02-28T13:15:00Z',
            linkedBy: 'system',
          },
        ],
        timeline: [
          {
            id: 'tl-022',
            timestamp: '2026-02-28T13:15:00Z',
            type: 'creation',
            actor: 'System',
            description: 'Case created from medium alert: Data Exfiltration via HTTP Upload',
          },
          {
            id: 'tl-026',
            timestamp: '2026-02-28T18:00:00Z',
            type: 'resolution',
            actor: 'Mike Torres',
            description:
              'Closed as authorized activity. Recommended using approved backup solution.',
          },
        ],
        notes: [
          {
            id: 'note-005',
            caseId: 'case-005',
            body: 'Upload was authorized by DBA for off-site backup per disaster recovery plan. Verified with manager.',
            createdBy: 'mike.torres@auraspear.com',
            createdAt: '2026-02-28T16:00:00Z',
          },
        ],
      },
    ]

    for (const c of mockCases) {
      this.cases.set(c.id, c)
    }
  }
}

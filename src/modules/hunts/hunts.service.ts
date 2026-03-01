import { randomUUID } from 'node:crypto'
import { Injectable, Logger, NotFoundException } from '@nestjs/common'
import { RunHuntDto } from './dto/run-hunt.dto'
import { JwtPayload } from '../../common/interfaces/authenticated-request.interface'
import { PrismaService } from '../../prisma/prisma.service'
import type { HuntEvent, HuntRunResult } from './hunts.types'

@Injectable()
export class HuntsService {
  private readonly logger = new Logger(HuntsService.name)

  /** In-memory store for mock hunt runs (per tenant). */
  private readonly huntRuns: Map<string, HuntRunResult> = new Map()

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Starts a new threat hunt run with mock results.
   * In production this would submit a query to OpenSearch / Wazuh Indexer.
   */
  async runHunt(dto: RunHuntDto, user: JwtPayload): Promise<HuntRunResult> {
    const huntId = randomUUID()
    const now = new Date().toISOString()

    this.logger.log(`User ${user.email} started hunt "${dto.query}" for tenant ${user.tenantId}`)

    // Persist the query as a saved_query if Prisma table exists
    try {
      await this.prisma.savedQuery.create({
        data: {
          id: huntId,
          tenantId: user.tenantId,
          name: dto.description || `Hunt: ${dto.query.slice(0, 60)}`,
          query: dto.query,
          createdBy: user.sub,
        },
      })
    } catch {
      // Table may not exist yet; fall through to mock
      this.logger.warn('saved_queries table not available; using in-memory store')
    }

    const mockEvents = this.generateMockHuntEvents(dto.query)

    const result: HuntRunResult = {
      id: huntId,
      tenantId: user.tenantId,
      query: dto.query,
      timeRange: dto.timeRange,
      description: dto.description ?? null,
      status: 'completed',
      startedAt: now,
      completedAt: new Date(Date.now() + 3200).toISOString(),
      startedBy: user.email,
      eventsFound: mockEvents.length,
      events: mockEvents,
      reasoning: [
        'Querying Wazuh Indexer for matching events',
        `Filtering events within ${dto.timeRange} time range`,
        'Correlating source IPs with threat intelligence feeds',
        `Found ${mockEvents.length} matching events across log sources`,
        'Cross-referencing with MITRE ATT&CK framework',
      ],
    }

    this.huntRuns.set(huntId, result)
    return result
  }

  /**
   * Lists all hunt runs for a given tenant.
   */
  async listHuntRuns(tenantId: string): Promise<Omit<HuntRunResult, 'events'>[]> {
    const runs: Omit<HuntRunResult, 'events'>[] = []

    for (const run of this.huntRuns.values()) {
      if (run.tenantId === tenantId) {
        const { events: _events, ...rest } = run
        runs.push(rest)
      }
    }

    // Add some default mock runs if none exist yet for this tenant
    if (runs.length === 0) {
      return this.getDefaultMockRuns(tenantId)
    }

    return runs.sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime())
  }

  /**
   * Gets a single hunt run by ID, scoped to the tenant.
   */
  async getHuntRun(id: string, tenantId: string): Promise<HuntRunResult> {
    const run = this.huntRuns.get(id)

    if (run?.tenantId !== tenantId) {
      // Check default mocks
      const defaults = this.getDefaultMockRuns(tenantId)
      const defaultRun = defaults.find(r => r.id === id)
      if (defaultRun) {
        return {
          ...defaultRun,
          events: this.generateMockHuntEvents('brute force dc-01'),
        }
      }
      throw new NotFoundException(`Hunt run ${id} not found`)
    }

    return run
  }

  private getDefaultMockRuns(tenantId: string): Omit<HuntRunResult, 'events'>[] {
    return [
      {
        id: 'hunt-run-001',
        tenantId,
        query: 'event.id:4625 AND agent.name:dc-01',
        timeRange: '7d',
        description: 'Brute force investigation on domain controller',
        status: 'completed',
        startedAt: '2026-03-01T09:00:00Z',
        completedAt: '2026-03-01T09:00:03Z',
        startedBy: 'sarah.chen@auraspear.com',
        eventsFound: 15,
        reasoning: [
          'Querying authentication logs for dc-01',
          'Filtering failed login events (Event ID 4625)',
          'Grouping by source IP and time window',
          'Cross-referencing IPs with threat intelligence',
          'Found 523 failed attempts from 198.51.100.22',
        ],
      },
      {
        id: 'hunt-run-002',
        tenantId,
        query: 'rule.mitre.id:T1071 AND data.srcip:10.0.*',
        timeRange: '24h',
        description: 'C2 beaconing detection across internal network',
        status: 'completed',
        startedAt: '2026-03-01T08:15:00Z',
        completedAt: '2026-03-01T08:15:04Z',
        startedBy: 'mike.torres@auraspear.com',
        eventsFound: 8,
        reasoning: [
          'Scanning for application layer protocol indicators',
          'Filtering internal source IPs for beaconing patterns',
          'Detected periodic HTTP callbacks from 10.0.6.17',
          'C2 domain update-service.xyz flagged by threat intel',
        ],
      },
      {
        id: 'hunt-run-003',
        tenantId,
        query: 'event.id:4728 OR event.id:4729',
        timeRange: '30d',
        description: 'Privilege escalation via group membership changes',
        status: 'completed',
        startedAt: '2026-02-28T14:30:00Z',
        completedAt: '2026-02-28T14:30:05Z',
        startedBy: 'sarah.chen@auraspear.com',
        eventsFound: 4,
        reasoning: [
          'Querying security group modification events',
          'Found svc-backup added to Domain Admins outside change window',
          'Escalation window was 30 minutes on Feb 28',
          'Activity consistent with emergency maintenance',
        ],
      },
    ]
  }

  private generateMockHuntEvents(query: string): HuntEvent[] {
    const lowerQuery = query.toLowerCase()
    const now = new Date()

    if (lowerQuery.includes('4625') || lowerQuery.includes('brute')) {
      return [
        {
          id: 'he-001',
          timestamp: new Date(now.getTime() - 3600000).toISOString(),
          severity: 'critical',
          eventId: 'EVT-4625',
          sourceIp: '198.51.100.22',
          user: 'admin',
          description: 'Failed SSH login attempt - invalid credentials (attempt 1 of 523)',
        },
        {
          id: 'he-002',
          timestamp: new Date(now.getTime() - 3590000).toISOString(),
          severity: 'critical',
          eventId: 'EVT-4625',
          sourceIp: '198.51.100.22',
          user: 'admin',
          description: 'Failed SSH login attempt - invalid credentials (attempt 50 of 523)',
        },
        {
          id: 'he-003',
          timestamp: new Date(now.getTime() - 3400000).toISOString(),
          severity: 'critical',
          eventId: 'EVT-4625',
          sourceIp: '198.51.100.22',
          user: 'root',
          description: 'Failed SSH login attempt - account does not exist (attempt 156 of 523)',
        },
        {
          id: 'he-004',
          timestamp: new Date(now.getTime() - 3200000).toISOString(),
          severity: 'high',
          eventId: 'EVT-4740',
          sourceIp: '198.51.100.22',
          user: 'admin',
          description: 'Account lockout triggered after 15 consecutive failed attempts',
        },
        {
          id: 'he-005',
          timestamp: new Date(now.getTime() - 86400000).toISOString(),
          severity: 'medium',
          eventId: 'EVT-4740',
          sourceIp: '10.0.6.33',
          user: 'm.jones',
          description:
            'Account lockout triggered - 15 failed login attempts from internal workstation',
        },
      ]
    }

    if (
      lowerQuery.includes('t1071') ||
      lowerQuery.includes('c2') ||
      lowerQuery.includes('beacon')
    ) {
      return [
        {
          id: 'he-c2-001',
          timestamp: new Date(now.getTime() - 7200000).toISOString(),
          severity: 'high',
          eventId: 'EVT-DNS',
          sourceIp: '10.0.6.17',
          user: 'SYSTEM',
          description: 'DNS query to known C2 domain: update-service.xyz (beaconing interval ~60s)',
        },
        {
          id: 'he-c2-002',
          timestamp: new Date(now.getTime() - 7140000).toISOString(),
          severity: 'high',
          eventId: 'EVT-HTTP',
          sourceIp: '10.0.6.17',
          user: 'SYSTEM',
          description: 'Encoded HTTP POST to 185.220.101.34:443 - potential C2 callback',
        },
        {
          id: 'he-c2-003',
          timestamp: new Date(now.getTime() - 5400000).toISOString(),
          severity: 'medium',
          eventId: 'EVT-DNS',
          sourceIp: '10.0.6.17',
          user: 'SYSTEM',
          description:
            'DNS tunneling detected - high entropy TXT record queries to data.exfil-cdn.net',
        },
      ]
    }

    // Default generic hunt events
    return [
      {
        id: 'he-gen-001',
        timestamp: new Date(now.getTime() - 1800000).toISOString(),
        severity: 'medium',
        eventId: 'EVT-4624',
        sourceIp: '10.0.5.42',
        user: 'svc-sql',
        description:
          'Kerberos service ticket requested with RC4 encryption - potential Kerberoasting',
      },
      {
        id: 'he-gen-002',
        timestamp: new Date(now.getTime() - 900000).toISOString(),
        severity: 'high',
        eventId: 'EVT-4728',
        sourceIp: '10.0.2.50',
        user: 'svc-backup',
        description: 'Account added to security-enabled global group: Domain Admins',
      },
      {
        id: 'he-gen-003',
        timestamp: new Date(now.getTime() - 600000).toISOString(),
        severity: 'low',
        eventId: 'EVT-5140',
        sourceIp: '10.0.2.50',
        user: 'svc-backup',
        description: 'Network share accessed: \\\\file-server-02\\backups',
      },
      {
        id: 'he-gen-004',
        timestamp: new Date(now.getTime() - 300000).toISOString(),
        severity: 'medium',
        eventId: 'EVT-4624',
        sourceIp: '10.0.2.50',
        user: 'svc-backup',
        description: 'Successful NTLM network logon (Type 3) to db-primary',
      },
    ]
  }
}

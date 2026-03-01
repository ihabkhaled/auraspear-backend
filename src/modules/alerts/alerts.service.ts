import { Injectable, Logger, NotFoundException } from '@nestjs/common'
import type { Alert, PaginatedResult } from './alerts.types'
import type { SearchAlertsDto } from './dto/search-alerts.dto'

const MOCK_ALERTS: Alert[] = [
  {
    id: 'alert-001',
    tenantId: 'aura-finance',
    title: 'Brute Force Attack Detected',
    description: 'Multiple failed SSH login attempts from 203.0.113.42',
    severity: 'high',
    status: 'new',
    source: 'wazuh',
    ruleId: 'T1110.001',
    mitreTactic: 'Credential Access',
    mitreTechnique: 'Brute Force: Password Guessing',
    sourceIp: '203.0.113.42',
    destIp: '10.0.1.15',
    agent: 'web-server-01',
    timestamp: '2024-12-15T14:30:00Z',
  },
  {
    id: 'alert-002',
    tenantId: 'aura-finance',
    title: 'Suspicious PowerShell Execution',
    description: 'Encoded PowerShell command with download cradle detected',
    severity: 'critical',
    status: 'new',
    source: 'wazuh',
    ruleId: 'T1059.001',
    mitreTactic: 'Execution',
    mitreTechnique: 'Command and Scripting: PowerShell',
    sourceIp: '10.0.2.34',
    destIp: '185.220.101.1',
    agent: 'workstation-042',
    timestamp: '2024-12-15T15:12:00Z',
  },
  {
    id: 'alert-003',
    tenantId: 'aura-finance',
    title: 'Data Exfiltration via DNS',
    description: 'Unusually high DNS query volume to suspicious domain',
    severity: 'critical',
    status: 'acknowledged',
    source: 'graylog',
    ruleId: 'T1048.003',
    mitreTactic: 'Exfiltration',
    mitreTechnique: 'Exfiltration Over Alternative Protocol: DNS',
    sourceIp: '10.0.3.88',
    destIp: '198.51.100.77',
    agent: 'db-server-02',
    timestamp: '2024-12-15T13:45:00Z',
  },
  {
    id: 'alert-004',
    tenantId: 'aura-health',
    title: 'Privilege Escalation Attempt',
    description: 'Local privilege escalation via sudo misconfiguration',
    severity: 'high',
    status: 'new',
    source: 'wazuh',
    ruleId: 'T1548.003',
    mitreTactic: 'Privilege Escalation',
    mitreTechnique: 'Abuse Elevation Control: Sudo',
    sourceIp: '10.1.0.22',
    destIp: '10.1.0.22',
    agent: 'linux-app-03',
    timestamp: '2024-12-15T16:00:00Z',
  },
  {
    id: 'alert-005',
    tenantId: 'aura-health',
    title: 'Lateral Movement via RDP',
    description: 'RDP session from non-standard source to critical server',
    severity: 'medium',
    status: 'new',
    source: 'velociraptor',
    ruleId: 'T1021.001',
    mitreTactic: 'Lateral Movement',
    mitreTechnique: 'Remote Services: RDP',
    sourceIp: '10.1.2.55',
    destIp: '10.1.0.5',
    agent: 'dc-01',
    timestamp: '2024-12-15T12:30:00Z',
  },
  {
    id: 'alert-006',
    tenantId: 'aura-enterprise',
    title: 'Malware C2 Beacon',
    description: 'Periodic HTTP POST requests matching known C2 pattern',
    severity: 'critical',
    status: 'in_progress',
    source: 'wazuh',
    ruleId: 'T1071.001',
    mitreTactic: 'Command and Control',
    mitreTechnique: 'Application Layer Protocol: HTTP',
    sourceIp: '10.2.1.99',
    destIp: '45.33.32.156',
    agent: 'endpoint-177',
    timestamp: '2024-12-15T11:15:00Z',
  },
  {
    id: 'alert-007',
    tenantId: 'aura-enterprise',
    title: 'SQL Injection Attempt',
    description: 'Union-based SQL injection detected on login endpoint',
    severity: 'high',
    status: 'new',
    source: 'graylog',
    ruleId: 'T1190',
    mitreTactic: 'Initial Access',
    mitreTechnique: 'Exploit Public-Facing Application',
    sourceIp: '203.0.113.100',
    destIp: '10.2.0.10',
    agent: 'web-app-01',
    timestamp: '2024-12-15T10:45:00Z',
  },
]

@Injectable()
export class AlertsService {
  private readonly logger = new Logger(AlertsService.name)
  private readonly alerts: Alert[] = [...MOCK_ALERTS]

  async search(tenantId: string, query: SearchAlertsDto): Promise<PaginatedResult> {
    let filtered = this.alerts.filter(a => a.tenantId === tenantId)

    if (query.severity) {
      filtered = filtered.filter(a => a.severity === query.severity)
    }

    if (query.status) {
      filtered = filtered.filter(a => a.status === query.status)
    }

    if (query.query && query.query !== '*') {
      const q = query.query.toLowerCase()
      filtered = filtered.filter(
        a =>
          a.title.toLowerCase().includes(q) ||
          a.description.toLowerCase().includes(q) ||
          a.sourceIp.includes(q) ||
          a.destIp.includes(q)
      )
    }

    // Sort
    const sortOrder = query.sortOrder === 'asc' ? 1 : -1
    filtered.sort((a, b) => {
      const aValue = a[query.sortBy as keyof Alert] ?? ''
      const bValue = b[query.sortBy as keyof Alert] ?? ''
      return String(aValue).localeCompare(String(bValue)) * sortOrder
    })

    const total = filtered.length
    const { page } = query
    const { pageSize } = query
    const start = (page - 1) * pageSize
    const data = filtered.slice(start, start + pageSize)

    return {
      data,
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    }
  }

  async findById(tenantId: string, id: string): Promise<Alert> {
    const alert = this.alerts.find(a => a.id === id && a.tenantId === tenantId)
    if (!alert) throw new NotFoundException('Alert not found')
    return alert
  }

  async acknowledge(tenantId: string, id: string, email: string): Promise<Alert> {
    const alert = await this.findById(tenantId, id)
    alert.status = 'acknowledged'
    alert.acknowledgedBy = email
    alert.acknowledgedAt = new Date().toISOString()
    return alert
  }

  async investigate(
    tenantId: string,
    id: string,
    notes?: string
  ): Promise<Alert & { investigation: string }> {
    const alert = await this.findById(tenantId, id)
    alert.status = 'in_progress'
    this.logger.debug(`Investigation started for alert ${id}${notes ? `: ${notes}` : ''}`)
    return { ...alert, investigation: 'Investigation started' }
  }

  async close(tenantId: string, id: string, resolution: string): Promise<Alert> {
    const alert = await this.findById(tenantId, id)
    alert.status = 'closed'
    alert.resolution = resolution
    alert.closedAt = new Date().toISOString()
    return alert
  }
}

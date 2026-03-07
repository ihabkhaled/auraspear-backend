import {
  PrismaClient,
  UserRole,
  ConnectorType,
  AuthType,
  type AlertSeverity,
  type AlertStatus,
  type CaseSeverity,
  type CaseStatus,
  type HuntSessionStatus,
} from '@prisma/client'
import * as bcrypt from 'bcryptjs'
import { randomUUID } from 'node:crypto'
import pino from 'pino'

const logger = pino({
  transport: { target: 'pino-pretty' },
  level: 'info',
})

const prisma = new PrismaClient()

const DEFAULT_PASSWORD = 'Admin@123'
const BCRYPT_ROUNDS = 10

// Global case counter to ensure unique case numbers across tenants
let globalCaseCounter = 0

// ─── Tenant profiles ────────────────────────────────────────────
// Each tenant gets a different "personality" for its seed data

interface ConnectorSeed {
  type: ConnectorType
  name: string
  authType: AuthType
  enabled: boolean
}

interface TenantProfile {
  id: string
  name: string
  slug: string
  alertCount: number
  alertStatusWeights: AlertStatus[]
  alertTemplateIndices: number[]
  agentPool: string[]
  caseTemplateIndices: number[]
  huntQueryIndices: number[]
  huntSessionStatuses: HuntSessionStatus[]
  iocIndices: number[]
  mispEventIndices: number[]
  connectors: ConnectorSeed[]
}

const TENANT_PROFILES: TenantProfile[] = [
  {
    id: randomUUID(),
    name: 'Aura Finance',
    slug: 'aura-finance',
    alertCount: 32,
    alertStatusWeights: [
      'new_alert',
      'new_alert',
      'acknowledged',
      'acknowledged',
      'in_progress',
      'in_progress',
      'resolved',
      'closed',
    ],
    alertTemplateIndices: [0, 1, 2, 5, 6, 10, 11],
    agentPool: [
      'fin-web-01',
      'fin-web-02',
      'fin-db-01',
      'trading-server-01',
      'payment-gateway-01',
      'fin-dc-01',
      'treasury-ws-003',
      'compliance-app-01',
    ],
    caseTemplateIndices: [0, 1, 4, 6, 7],
    huntQueryIndices: [0, 1, 2, 3],
    huntSessionStatuses: ['completed', 'completed', 'completed', 'running'],
    iocIndices: [0, 1, 3, 4, 6, 8, 11, 14],
    mispEventIndices: [0, 1, 3, 5, 6, 9],
    connectors: [
      { type: ConnectorType.wazuh, name: 'Wazuh Manager', authType: AuthType.basic, enabled: true },
      {
        type: ConnectorType.graylog,
        name: 'Graylog SIEM',
        authType: AuthType.basic,
        enabled: true,
      },
      {
        type: ConnectorType.velociraptor,
        name: 'Velociraptor EDR',
        authType: AuthType.api_key,
        enabled: false,
      },
      { type: ConnectorType.grafana, name: 'Grafana', authType: AuthType.api_key, enabled: true },
      { type: ConnectorType.influxdb, name: 'InfluxDB', authType: AuthType.token, enabled: true },
      {
        type: ConnectorType.misp,
        name: 'MISP Threat Intel',
        authType: AuthType.api_key,
        enabled: true,
      },
      {
        type: ConnectorType.shuffle,
        name: 'Shuffle SOAR',
        authType: AuthType.api_key,
        enabled: true,
      },
      {
        type: ConnectorType.bedrock,
        name: 'AWS Bedrock AI',
        authType: AuthType.iam,
        enabled: true,
      },
    ],
  },
  {
    id: randomUUID(),
    name: 'Aura Health',
    slug: 'aura-health',
    alertCount: 18,
    alertStatusWeights: [
      'new_alert',
      'new_alert',
      'new_alert',
      'acknowledged',
      'in_progress',
      'resolved',
      'closed',
      'closed',
    ],
    alertTemplateIndices: [0, 3, 4, 7, 8, 9],
    agentPool: [
      'ehr-server-01',
      'ehr-server-02',
      'lab-system-01',
      'imaging-ws-01',
      'nurse-station-12',
      'pharmacy-app-01',
      'health-dc-01',
      'telehealth-gw-01',
    ],
    caseTemplateIndices: [1, 2, 3, 5],
    huntQueryIndices: [1, 4, 5],
    huntSessionStatuses: ['completed', 'completed', 'error'],
    iocIndices: [2, 5, 7, 9, 10, 12, 13],
    mispEventIndices: [2, 4, 7, 8],
    connectors: [
      { type: ConnectorType.wazuh, name: 'Wazuh Manager', authType: AuthType.basic, enabled: true },
      {
        type: ConnectorType.graylog,
        name: 'Graylog SIEM',
        authType: AuthType.basic,
        enabled: false,
      },
      {
        type: ConnectorType.velociraptor,
        name: 'Velociraptor EDR',
        authType: AuthType.api_key,
        enabled: true,
      },
      { type: ConnectorType.grafana, name: 'Grafana', authType: AuthType.api_key, enabled: false },
      { type: ConnectorType.influxdb, name: 'InfluxDB', authType: AuthType.token, enabled: true },
      {
        type: ConnectorType.misp,
        name: 'MISP Threat Intel',
        authType: AuthType.api_key,
        enabled: true,
      },
      {
        type: ConnectorType.bedrock,
        name: 'AWS Bedrock AI',
        authType: AuthType.iam,
        enabled: true,
      },
    ],
  },
  {
    id: randomUUID(),
    name: 'Aura Enterprise',
    slug: 'aura-enterprise',
    alertCount: 45,
    alertStatusWeights: [
      'new_alert',
      'new_alert',
      'new_alert',
      'new_alert',
      'acknowledged',
      'in_progress',
      'false_positive',
      'resolved',
    ],
    alertTemplateIndices: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
    agentPool: [
      'ent-web-01',
      'ent-web-02',
      'ent-web-03',
      'ent-dc-01',
      'ent-dc-02',
      'ent-db-01',
      'ent-db-02',
      'erp-server-01',
      'crm-app-01',
      'vpn-gw-01',
      'workstation-101',
      'workstation-202',
      'mail-relay-01',
      'ci-runner-01',
    ],
    caseTemplateIndices: [0, 1, 2, 3, 4, 5, 6, 7],
    huntQueryIndices: [0, 2, 3, 4, 5, 6],
    huntSessionStatuses: ['completed', 'completed', 'completed', 'completed', 'running', 'error'],
    iocIndices: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14],
    mispEventIndices: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
    connectors: [
      { type: ConnectorType.wazuh, name: 'Wazuh Manager', authType: AuthType.basic, enabled: true },
      {
        type: ConnectorType.graylog,
        name: 'Graylog SIEM',
        authType: AuthType.basic,
        enabled: true,
      },
      {
        type: ConnectorType.velociraptor,
        name: 'Velociraptor EDR',
        authType: AuthType.api_key,
        enabled: true,
      },
      { type: ConnectorType.grafana, name: 'Grafana', authType: AuthType.api_key, enabled: true },
      { type: ConnectorType.influxdb, name: 'InfluxDB', authType: AuthType.token, enabled: true },
      {
        type: ConnectorType.misp,
        name: 'MISP Threat Intel',
        authType: AuthType.api_key,
        enabled: true,
      },
      {
        type: ConnectorType.shuffle,
        name: 'Shuffle SOAR',
        authType: AuthType.api_key,
        enabled: true,
      },
      {
        type: ConnectorType.bedrock,
        name: 'AWS Bedrock AI',
        authType: AuthType.iam,
        enabled: true,
      },
    ],
  },
]

// ─── Alert seed data ──────────────────────────────────────────

const ALERT_TEMPLATES: Array<{
  title: string
  description: string
  severity: AlertSeverity
  source: string
  ruleName: string
  ruleId: string
  mitreTactics: string[]
  mitreTechniques: string[]
}> = [
  {
    title: 'Brute Force Attack Detected',
    description: 'Multiple failed SSH login attempts detected',
    severity: 'high',
    source: 'wazuh',
    ruleName: 'SSH brute force attack',
    ruleId: '5710',
    mitreTactics: ['Credential Access'],
    mitreTechniques: ['T1110.001'],
  },
  {
    title: 'Suspicious PowerShell Execution',
    description: 'Encoded PowerShell command with download cradle detected',
    severity: 'critical',
    source: 'wazuh',
    ruleName: 'Suspicious PowerShell activity',
    ruleId: '91816',
    mitreTactics: ['Execution'],
    mitreTechniques: ['T1059.001'],
  },
  {
    title: 'Data Exfiltration via DNS',
    description: 'Unusually high DNS query volume to suspicious domain',
    severity: 'critical',
    source: 'graylog',
    ruleName: 'DNS tunneling detected',
    ruleId: 'GL-DNS-001',
    mitreTactics: ['Exfiltration'],
    mitreTechniques: ['T1048.003'],
  },
  {
    title: 'Privilege Escalation Attempt',
    description: 'Local privilege escalation via sudo misconfiguration',
    severity: 'high',
    source: 'wazuh',
    ruleName: 'Sudo privilege escalation',
    ruleId: '5401',
    mitreTactics: ['Privilege Escalation'],
    mitreTechniques: ['T1548.003'],
  },
  {
    title: 'Lateral Movement via RDP',
    description: 'RDP session from non-standard source to critical server',
    severity: 'medium',
    source: 'velociraptor',
    ruleName: 'Anomalous RDP connection',
    ruleId: 'VR-RDP-001',
    mitreTactics: ['Lateral Movement'],
    mitreTechniques: ['T1021.001'],
  },
  {
    title: 'Malware C2 Beacon',
    description: 'Periodic HTTP POST requests matching known C2 pattern',
    severity: 'critical',
    source: 'wazuh',
    ruleName: 'C2 beacon communication',
    ruleId: '100201',
    mitreTactics: ['Command and Control'],
    mitreTechniques: ['T1071.001'],
  },
  {
    title: 'SQL Injection Attempt',
    description: 'Union-based SQL injection detected on login endpoint',
    severity: 'high',
    source: 'graylog',
    ruleName: 'Web application attack',
    ruleId: 'GL-WAF-042',
    mitreTactics: ['Initial Access'],
    mitreTechniques: ['T1190'],
  },
  {
    title: 'Unauthorized File Access',
    description: 'Access to restricted /etc/shadow file detected',
    severity: 'medium',
    source: 'wazuh',
    ruleName: 'File integrity monitoring alert',
    ruleId: '550',
    mitreTactics: ['Collection'],
    mitreTechniques: ['T1005'],
  },
  {
    title: 'Suspicious Process Spawned',
    description: 'cmd.exe spawned by Word document',
    severity: 'high',
    source: 'velociraptor',
    ruleName: 'Office macro execution',
    ruleId: 'VR-PROC-005',
    mitreTactics: ['Execution'],
    mitreTechniques: ['T1204.002'],
  },
  {
    title: 'Port Scan Detected',
    description: 'Sequential port scanning activity from internal host',
    severity: 'low',
    source: 'wazuh',
    ruleName: 'Network reconnaissance',
    ruleId: '100100',
    mitreTactics: ['Discovery'],
    mitreTechniques: ['T1046'],
  },
  {
    title: 'Credential Dumping Attempt',
    description: 'LSASS memory access detected from non-system process',
    severity: 'critical',
    source: 'velociraptor',
    ruleName: 'LSASS credential dump',
    ruleId: 'VR-CRED-001',
    mitreTactics: ['Credential Access'],
    mitreTechniques: ['T1003.001'],
  },
  {
    title: 'Malicious File Download',
    description: 'Known malware hash detected in downloaded file',
    severity: 'high',
    source: 'wazuh',
    ruleName: 'Malware detection',
    ruleId: '87105',
    mitreTactics: ['Execution'],
    mitreTechniques: ['T1204.002'],
  },
]

// ─── Case seed data ────────────────────────────────────────────

const CASE_TEMPLATES: Array<{
  title: string
  description: string
  severity: CaseSeverity
  status: CaseStatus
}> = [
  {
    title: 'Ransomware Investigation',
    description: 'Investigating potential ransomware deployment on finance workstations',
    severity: 'critical',
    status: 'in_progress',
  },
  {
    title: 'Phishing Campaign Response',
    description: 'Multiple employees reported suspicious emails with malicious links',
    severity: 'high',
    status: 'open',
  },
  {
    title: 'Insider Threat Review',
    description: 'Unusual data access patterns from departing employee',
    severity: 'high',
    status: 'in_progress',
  },
  {
    title: 'Network Intrusion Analysis',
    description: 'Suspicious traffic detected from compromised IoT device',
    severity: 'medium',
    status: 'open',
  },
  {
    title: 'Malware Containment',
    description: 'Trojan detected on endpoint-177, containment in progress',
    severity: 'critical',
    status: 'closed',
  },
  {
    title: 'DDoS Mitigation Review',
    description: 'Post-incident review of DDoS attack on web infrastructure',
    severity: 'medium',
    status: 'closed',
  },
  {
    title: 'Credential Leak Response',
    description: 'Employee credentials found on dark web marketplace',
    severity: 'high',
    status: 'open',
  },
  {
    title: 'Vulnerability Exploitation',
    description: 'Log4Shell exploitation attempt detected on Java applications',
    severity: 'critical',
    status: 'in_progress',
  },
]

// ─── Hunt query pool ────────────────────────────────────────────

const HUNT_QUERIES = [
  'source.ip:203.0.113.* AND event.action:login_failed',
  'process.name:powershell.exe AND process.args:*-enc*',
  'dns.question.name:*.onion OR dns.question.name:*.bit',
  'event.action:file_created AND file.extension:(exe OR dll OR scr)',
  'network.bytes_out:>1000000 AND destination.geo.country_name:!internal',
  'process.parent.name:winword.exe AND process.name:(cmd.exe OR powershell.exe)',
  'registry.path:*\\Run\\* AND event.action:registry_modified',
]

// ─── Intel seed data ────────────────────────────────────────────

const IOC_DATA: Array<{
  iocValue: string
  iocType: string
  source: string
  severity: string
}> = [
  { iocValue: '203.0.113.42', iocType: 'ip', source: 'MISP', severity: 'high' },
  { iocValue: '198.51.100.77', iocType: 'ip', source: 'MISP', severity: 'critical' },
  { iocValue: '45.33.32.156', iocType: 'ip', source: 'AlienVault', severity: 'high' },
  { iocValue: 'evil-domain.xyz', iocType: 'domain', source: 'MISP', severity: 'critical' },
  { iocValue: 'c2-server.onion', iocType: 'domain', source: 'MISP', severity: 'critical' },
  { iocValue: 'phishing-site.com', iocType: 'domain', source: 'URLHaus', severity: 'high' },
  {
    iocValue: 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4',
    iocType: 'md5',
    source: 'VirusTotal',
    severity: 'high',
  },
  { iocValue: 'malware@evil.com', iocType: 'email', source: 'MISP', severity: 'medium' },
  { iocValue: '10.0.0.0/8', iocType: 'cidr', source: 'Internal', severity: 'info' },
  { iocValue: 'dropper.exe', iocType: 'filename', source: 'MISP', severity: 'high' },
  { iocValue: '185.220.101.1', iocType: 'ip', source: 'TOR Exit Nodes', severity: 'medium' },
  { iocValue: 'ransomware-payload.dll', iocType: 'filename', source: 'MISP', severity: 'critical' },
  { iocValue: 'suspicious-script.ps1', iocType: 'filename', source: 'Internal', severity: 'high' },
  { iocValue: '172.16.0.100', iocType: 'ip', source: 'Honeypot', severity: 'medium' },
  { iocValue: 'data-exfil.net', iocType: 'domain', source: 'MISP', severity: 'high' },
]

const MISP_EVENTS = [
  {
    mispEventId: '10001',
    organization: 'CERT-EU',
    threatLevel: 'high',
    info: 'APT28 Campaign Targeting Financial Sector',
    attributeCount: 42,
  },
  {
    mispEventId: '10002',
    organization: 'US-CERT',
    threatLevel: 'critical',
    info: 'Ransomware IOCs - LockBit 3.0',
    attributeCount: 87,
  },
  {
    mispEventId: '10003',
    organization: 'CIRCL',
    threatLevel: 'medium',
    info: 'Phishing Kit Distribution Network',
    attributeCount: 23,
  },
  {
    mispEventId: '10004',
    organization: 'CERT-EU',
    threatLevel: 'high',
    info: 'Emotet Botnet Resurgence',
    attributeCount: 156,
  },
  {
    mispEventId: '10005',
    organization: 'FIRST',
    threatLevel: 'low',
    info: 'Cryptocurrency Mining Malware Indicators',
    attributeCount: 15,
  },
  {
    mispEventId: '10006',
    organization: 'MITRE',
    threatLevel: 'high',
    info: 'Supply Chain Attack via NPM Packages',
    attributeCount: 34,
  },
  {
    mispEventId: '10007',
    organization: 'US-CERT',
    threatLevel: 'critical',
    info: 'Zero-Day Exploit - CVE-2024-XXXX',
    attributeCount: 8,
  },
  {
    mispEventId: '10008',
    organization: 'ENISA',
    threatLevel: 'medium',
    info: 'DDoS-for-Hire Service Takedown IOCs',
    attributeCount: 67,
  },
  {
    mispEventId: '10009',
    organization: 'CERT-EU',
    threatLevel: 'high',
    info: 'Spear Phishing Campaign Against Healthcare',
    attributeCount: 29,
  },
  {
    mispEventId: '10010',
    organization: 'FBI',
    threatLevel: 'critical',
    info: 'State-Sponsored Espionage - Operation Shadow',
    attributeCount: 112,
  },
]

// ─── Helpers ────────────────────────────────────────────────────

function randomIp(): string {
  return `${10 + Math.floor(Math.random() * 190)}.${Math.floor(Math.random() * 256)}.${Math.floor(Math.random() * 256)}.${Math.floor(Math.random() * 256)}`
}

function randomDate(daysBack: number): Date {
  return new Date(Date.now() - Math.floor(Math.random() * daysBack * 86_400_000))
}

function randomItem<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)] as T
}

function pickByIndices<T>(arr: T[], indices: number[]): T[] {
  return indices.filter(i => i < arr.length).map(i => arr[i] as T)
}

// ─── Seed functions ─────────────────────────────────────────────

async function seedAlerts(tenantId: string, profile: TenantProfile): Promise<void> {
  const templates = pickByIndices(ALERT_TEMPLATES, profile.alertTemplateIndices)

  // Use deterministic externalId so alerts are idempotent via @@unique([tenantId, externalId])
  // Seed a fixed set per tenant using the template index as part of the key
  for (let i = 0; i < profile.alertCount; i++) {
    const externalId = `seed-${profile.slug}-${i}`
    const templateIndex = i % templates.length
    const template = templates[templateIndex] as (typeof ALERT_TEMPLATES)[number]
    const statusIndex = i % profile.alertStatusWeights.length
    const status = profile.alertStatusWeights[statusIndex] as AlertStatus
    const timestamp = randomDate(30)

    await prisma.alert.upsert({
      where: { tenantId_externalId: { tenantId, externalId } },
      update: {},
      create: {
        tenantId,
        externalId,
        title: template.title,
        description: template.description,
        severity: template.severity,
        status,
        source: template.source,
        ruleName: template.ruleName,
        ruleId: template.ruleId,
        agentName: randomItem(profile.agentPool),
        sourceIp: randomIp(),
        destinationIp: randomIp(),
        mitreTactics: template.mitreTactics,
        mitreTechniques: template.mitreTechniques,
        timestamp,
        acknowledgedBy: status !== 'new_alert' ? `analyst@${profile.slug}.io` : null,
        acknowledgedAt: status !== 'new_alert' ? new Date(timestamp.getTime() + 300_000) : null,
        closedBy:
          status === 'closed' || status === 'resolved' ? `analyst@${profile.slug}.io` : null,
        closedAt:
          status === 'closed' || status === 'resolved'
            ? new Date(timestamp.getTime() + 3_600_000)
            : null,
        resolution:
          status === 'closed'
            ? 'Confirmed and mitigated'
            : status === 'resolved'
              ? 'False positive'
              : null,
      },
    })
  }
}

async function seedCases(tenantId: string, profile: TenantProfile): Promise<void> {
  const year = new Date().getFullYear()
  const templates = pickByIndices(CASE_TEMPLATES, profile.caseTemplateIndices)

  for (const template of templates) {
    globalCaseCounter++
    const caseNumber = `SOC-${year}-${String(globalCaseCounter).padStart(3, '0')}`

    await prisma.case.upsert({
      where: { caseNumber },
      update: {},
      create: {
        tenantId,
        caseNumber,
        title: template.title,
        description: template.description,
        severity: template.severity,
        status: template.status,
        createdBy: `admin@${profile.slug}.io`,
        closedAt: template.status === 'closed' ? randomDate(5) : null,
        timeline: {
          create: [
            {
              type: 'created',
              actor: `admin@${profile.slug}.io`,
              description: `Case ${caseNumber} created: ${template.title}`,
            },
            ...(template.status !== 'open'
              ? [
                  {
                    type: 'status_changed',
                    actor: `analyst.l2@${profile.slug}.io`,
                    description: `Status changed to ${template.status}`,
                  },
                ]
              : []),
          ],
        },
        notes: {
          create:
            template.status !== 'open'
              ? [
                  {
                    author: `analyst.l2@${profile.slug}.io`,
                    body: 'Initial triage completed. Escalating for further investigation.',
                  },
                ]
              : [],
        },
      },
    })
  }
}

async function seedHuntSessions(tenantId: string, profile: TenantProfile): Promise<void> {
  const queries = pickByIndices(HUNT_QUERIES, profile.huntQueryIndices)

  for (let qi = 0; qi < queries.length; qi++) {
    const query = queries[qi] as string
    const status = (profile.huntSessionStatuses[qi] ?? 'completed') as HuntSessionStatus
    const eventsCount = status === 'error' ? 0 : 3 + Math.floor(Math.random() * 20)

    // Skip if a session with this query already exists for this tenant
    const existing = await prisma.huntSession.findFirst({
      where: { tenantId, query },
      select: { id: true },
    })
    if (existing) {
      continue
    }

    const session = await prisma.huntSession.create({
      data: {
        tenantId,
        query,
        status,
        startedBy: `hunter@${profile.slug}.io`,
        startedAt: randomDate(14),
        completedAt: status === 'running' ? null : randomDate(13),
        eventsFound: eventsCount,
        reasoning:
          status === 'error'
            ? ['Searching for matching patterns in Wazuh alerts index', 'Connection timeout']
            : status === 'running'
              ? ['Searching for matching patterns in Wazuh alerts index']
              : [
                  'Searching for matching patterns in Wazuh alerts index',
                  `Found ${eventsCount} events matching query criteria`,
                  'Analysis complete. Results stored.',
                ],
      },
    })

    const events = []
    for (let i = 0; i < eventsCount; i++) {
      events.push({
        huntSessionId: session.id,
        timestamp: randomDate(14),
        severity: randomItem(['critical', 'high', 'medium', 'low', 'info']),
        eventId: `evt-${randomUUID().slice(0, 8)}`,
        sourceIp: randomIp(),
        user: randomItem(['john.doe', 'jane.smith', 'admin', 'svc-backup', null]),
        description: `Event matching hunt query: ${query.slice(0, 50)}...`,
      })
    }

    await prisma.huntEvent.createMany({ data: events })
  }
}

async function seedIntel(tenantId: string, profile: TenantProfile): Promise<void> {
  const iocs = pickByIndices(IOC_DATA, profile.iocIndices)
  const mispEvents = pickByIndices(MISP_EVENTS, profile.mispEventIndices)

  for (const ioc of iocs) {
    await prisma.intelIOC.upsert({
      where: {
        tenantId_iocValue_iocType: { tenantId, iocValue: ioc.iocValue, iocType: ioc.iocType },
      },
      update: {},
      create: {
        tenantId,
        ...ioc,
        hitCount: Math.floor(Math.random() * 50),
        firstSeen: randomDate(90),
        lastSeen: randomDate(7),
        tags: ['seed-data'],
        active: true,
      },
    })
  }

  for (const evt of mispEvents) {
    await prisma.intelMispEvent.upsert({
      where: {
        tenantId_mispEventId: { tenantId, mispEventId: evt.mispEventId },
      },
      update: {},
      create: {
        tenantId,
        mispEventId: evt.mispEventId,
        organization: evt.organization,
        threatLevel: evt.threatLevel,
        info: evt.info,
        date: randomDate(60),
        tags: JSON.parse('["seed-data"]'),
        attributeCount: evt.attributeCount,
        published: true,
      },
    })
  }
}

// ─── Main seed function ────────────────────────────────────────

async function main(): Promise<void> {
  logger.info('Seeding database...')

  const passwordHash = await bcrypt.hash(DEFAULT_PASSWORD, BCRYPT_ROUNDS)

  // Initialize global case counter from existing max case number
  const maxCase = await prisma.case.findFirst({
    orderBy: { caseNumber: 'desc' },
    select: { caseNumber: true },
  })
  if (maxCase?.caseNumber) {
    const match = maxCase.caseNumber.match(/SOC-\d+-(\d+)/)
    if (match?.[1]) {
      globalCaseCounter = Number.parseInt(match[1], 10)
    }
  }

  for (const profile of TENANT_PROFILES) {
    await prisma.tenant.upsert({
      where: { slug: profile.slug },
      update: {},
      create: {
        id: profile.id,
        name: profile.name,
        slug: profile.slug,
      },
    })

    const createdTenant = await prisma.tenant.findUnique({ where: { slug: profile.slug } })
    const tenantId = createdTenant?.id ?? profile.id

    // ─── Users + Memberships ───
    const userDefs = [
      {
        oidcSub: `admin-${profile.slug}`,
        email: `admin@${profile.slug}.io`,
        name: 'Admin User',
        role: UserRole.GLOBAL_ADMIN,
      },
      {
        oidcSub: `analyst-l2-${profile.slug}`,
        email: `analyst.l2@${profile.slug}.io`,
        name: 'Senior Analyst',
        role: UserRole.SOC_ANALYST_L2,
      },
      {
        oidcSub: `analyst-l1-${profile.slug}`,
        email: `analyst.l1@${profile.slug}.io`,
        name: 'Junior Analyst',
        role: UserRole.SOC_ANALYST_L1,
      },
      {
        oidcSub: `hunter-${profile.slug}`,
        email: `hunter@${profile.slug}.io`,
        name: 'Threat Hunter',
        role: UserRole.THREAT_HUNTER,
      },
      {
        oidcSub: `exec-${profile.slug}`,
        email: `exec@${profile.slug}.io`,
        name: 'Executive',
        role: UserRole.EXECUTIVE_READONLY,
      },
    ]

    for (const userDef of userDefs) {
      const isProtected = userDef.role === UserRole.GLOBAL_ADMIN

      const createdUser = await prisma.user.upsert({
        where: { email: userDef.email },
        update: {},
        create: {
          email: userDef.email,
          name: userDef.name,
          oidcSub: userDef.oidcSub,
          passwordHash,
          isProtected,
        },
      })

      await prisma.tenantMembership.upsert({
        where: { userId_tenantId: { userId: createdUser.id, tenantId } },
        update: {},
        create: {
          userId: createdUser.id,
          tenantId,
          role: userDef.role,
        },
      })

      await prisma.userPreference.upsert({
        where: { userId: createdUser.id },
        update: {},
        create: {
          userId: createdUser.id,
          theme: 'system',
          language: 'en',
          notificationsEmail: true,
          notificationsInApp: true,
        },
      })

      logger.info({ tenant: profile.slug, email: userDef.email, role: userDef.role }, 'Seeded user')
    }

    // ─── Connectors ───
    for (const connector of profile.connectors) {
      await prisma.connectorConfig.upsert({
        where: { tenantId_type: { tenantId, type: connector.type } },
        update: {},
        create: {
          tenantId,
          type: connector.type,
          name: connector.name,
          authType: connector.authType,
          enabled: connector.enabled,
          encryptedConfig: JSON.stringify({ placeholder: true }),
        },
      })
    }

    // ─── Alerts (idempotent via deterministic externalId) ───
    await seedAlerts(tenantId, profile)
    logger.info({ tenant: profile.slug, count: profile.alertCount }, 'Seeded alerts')

    // ─── Cases (idempotent via upsert on caseNumber) ───
    await seedCases(tenantId, profile)
    logger.info({ tenant: profile.slug, count: profile.caseTemplateIndices.length }, 'Seeded cases')

    // ─── Hunt Sessions (idempotent via query check per tenant) ───
    await seedHuntSessions(tenantId, profile)
    logger.info(
      { tenant: profile.slug, count: profile.huntQueryIndices.length },
      'Seeded hunt sessions'
    )

    // ─── Intel ───
    await seedIntel(tenantId, profile)
    logger.info(
      {
        tenant: profile.slug,
        iocs: profile.iocIndices.length,
        mispEvents: profile.mispEventIndices.length,
      },
      'Seeded intel'
    )
  }

  logger.info('Seed completed.')
}

main()
  .catch(error => {
    logger.error(error, 'Seed failed')
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })

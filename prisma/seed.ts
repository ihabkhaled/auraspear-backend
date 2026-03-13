import {
  Prisma,
  PrismaClient,
  UserRole,
  ConnectorType,
  AuthType,
  type AlertSeverity,
  type AlertStatus,
  type CaseCycleStatus,
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

function requireEnv(name: string): string {
  const value = process.env[name]
  if (!value) {
    throw new Error(
      `${name} environment variable is required. Set a strong password (12+ chars) before seeding.`
    )
  }
  return value
}

const DEFAULT_PASSWORD: string = requireEnv('SEED_DEFAULT_PASSWORD')
const BCRYPT_ROUNDS = 12

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
    alertTemplateIndices: [0, 1, 2, 5, 6, 10, 11, 12, 14, 17],
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
    iocIndices: [
      0, 1, 3, 7, 8, 11, 12, 14, 17, 20, 21, 23, 25, 29, 30, 34, 35, 38, 39, 43, 44, 48, 50, 53, 56,
      58, 60, 62, 64, 65, 66, 69, 70, 72, 74, 76, 78, 81, 83, 85, 87, 89, 91, 94, 96,
    ],
    mispEventIndices: [0, 1, 3, 5, 6, 9, 11, 13],
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
    alertTemplateIndices: [0, 3, 4, 7, 8, 9, 13, 15, 18, 19],
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
    iocIndices: [
      2, 4, 5, 9, 10, 13, 15, 18, 22, 24, 26, 27, 31, 36, 40, 41, 45, 46, 49, 51, 54, 57, 59, 61,
      63, 67, 68, 71, 73, 75, 77, 79, 80, 82, 84, 86, 88, 90, 92, 93, 95, 97, 99,
    ],
    mispEventIndices: [2, 4, 7, 8, 10, 12],
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
    alertTemplateIndices: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19],
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
    iocIndices: [
      0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25,
      26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48,
      49, 50, 51, 52, 53, 54, 55, 56, 57, 58, 59, 60, 61, 62, 63, 64, 65, 66, 67, 68, 69, 70, 71,
      72, 73, 74, 75, 76, 77, 78, 79, 80, 81, 82, 83, 84, 85, 86, 87, 88, 89, 90, 91, 92, 93, 94,
      95, 96, 97, 98, 99,
    ],
    mispEventIndices: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13],
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
  // ── Additional alert sources ──
  {
    title: 'Ransomware Encryption Activity',
    description: 'Rapid file rename operations consistent with ransomware encryption pattern',
    severity: 'critical',
    source: 'logstash',
    ruleName: 'Ransomware file activity pattern',
    ruleId: 'LS-RANSOM-001',
    mitreTactics: ['Impact'],
    mitreTechniques: ['T1486'],
  },
  {
    title: 'Anomalous Outbound Traffic Volume',
    description: 'Data transfer to external IP exceeds 95th percentile baseline',
    severity: 'high',
    source: 'logstash',
    ruleName: 'Outbound data anomaly',
    ruleId: 'LS-EXFIL-003',
    mitreTactics: ['Exfiltration'],
    mitreTechniques: ['T1041'],
  },
  {
    title: 'Known C2 IP Communication',
    description: 'Network connection to IP flagged in ThreatFox C2 feed',
    severity: 'critical',
    source: 'misp',
    ruleName: 'Threat intel IOC match',
    ruleId: 'MISP-IOC-001',
    mitreTactics: ['Command and Control'],
    mitreTechniques: ['T1071.001'],
  },
  {
    title: 'Phishing Email Delivered',
    description: 'Email with known malicious attachment hash bypassed spam filter',
    severity: 'high',
    source: 'misp',
    ruleName: 'Phishing campaign indicator',
    ruleId: 'MISP-IOC-042',
    mitreTactics: ['Initial Access'],
    mitreTechniques: ['T1566.001'],
  },
  {
    title: 'DLL Side-Loading Attempt',
    description: 'Legitimate process loaded unsigned DLL from non-standard path',
    severity: 'high',
    source: 'velociraptor',
    ruleName: 'DLL hijack detection',
    ruleId: 'VR-DLL-002',
    mitreTactics: ['Persistence', 'Privilege Escalation'],
    mitreTechniques: ['T1574.002'],
  },
  {
    title: 'Kerberoasting Activity Detected',
    description: 'Service ticket requests for multiple SPNs from single account in short timeframe',
    severity: 'critical',
    source: 'wazuh',
    ruleName: 'Kerberoasting attack',
    ruleId: '92100',
    mitreTactics: ['Credential Access'],
    mitreTechniques: ['T1558.003'],
  },
  {
    title: 'Suspicious Cron Job Created',
    description: 'New cron entry added with base64-encoded command payload',
    severity: 'medium',
    source: 'wazuh',
    ruleName: 'Scheduled task persistence',
    ruleId: '2830',
    mitreTactics: ['Persistence'],
    mitreTechniques: ['T1053.003'],
  },
  {
    title: 'DNS Over HTTPS Detected',
    description: 'Application bypassing local DNS resolver via DoH to external provider',
    severity: 'medium',
    source: 'graylog',
    ruleName: 'DNS over HTTPS evasion',
    ruleId: 'GL-DNS-005',
    mitreTactics: ['Command and Control'],
    mitreTechniques: ['T1071.004'],
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

// ─── Case Cycle seed data ──────────────────────────────────────

const CYCLE_TEMPLATES: Array<{
  name: string
  description: string
  status: CaseCycleStatus
  daysAgo: number
  durationDays: number
}> = [
  {
    name: 'Cycle 1 — January Ops',
    description: 'First operational cycle covering initial incident response and triage',
    status: 'closed',
    daysAgo: 60,
    durationDays: 14,
  },
  {
    name: 'Cycle 2 — February Ops',
    description:
      'Second operational cycle with focus on phishing campaigns and malware containment',
    status: 'closed',
    daysAgo: 30,
    durationDays: 14,
  },
  {
    name: 'Cycle 3 — March Ops',
    description: 'Current active cycle for ongoing threat monitoring and response',
    status: 'active',
    daysAgo: 7,
    durationDays: 14,
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
  // ── IP sources (ip-src) ──
  { iocValue: '203.0.113.42', iocType: 'ip-src', source: 'MISP-10001', severity: 'high' },
  { iocValue: '198.51.100.77', iocType: 'ip-src', source: 'MISP-10002', severity: 'critical' },
  { iocValue: '45.33.32.156', iocType: 'ip-src', source: 'MISP-10003', severity: 'high' },
  { iocValue: '185.220.101.1', iocType: 'ip-src', source: 'MISP-10004', severity: 'medium' },
  { iocValue: '91.219.236.222', iocType: 'ip-src', source: 'MISP-10006', severity: 'high' },
  { iocValue: '23.129.64.100', iocType: 'ip-src', source: 'MISP-10007', severity: 'critical' },
  { iocValue: '104.244.72.115', iocType: 'ip-src', source: 'MISP-10010', severity: 'high' },
  // ── IP destinations (ip-dst) ──
  { iocValue: '172.16.0.100', iocType: 'ip-dst', source: 'MISP-10001', severity: 'medium' },
  { iocValue: '10.20.30.40', iocType: 'ip-dst', source: 'MISP-10004', severity: 'low' },
  { iocValue: '192.168.1.200', iocType: 'ip-dst', source: 'MISP-10008', severity: 'medium' },
  { iocValue: '10.50.100.5', iocType: 'ip-dst', source: 'MISP-10009', severity: 'high' },
  // ── Domains ──
  { iocValue: 'evil-domain.xyz', iocType: 'domain', source: 'MISP-10002', severity: 'critical' },
  { iocValue: 'c2-server.onion', iocType: 'domain', source: 'MISP-10007', severity: 'critical' },
  { iocValue: 'phishing-site.com', iocType: 'domain', source: 'MISP-10003', severity: 'high' },
  { iocValue: 'data-exfil.net', iocType: 'domain', source: 'MISP-10006', severity: 'high' },
  { iocValue: 'malware-drop.ru', iocType: 'domain', source: 'MISP-10010', severity: 'critical' },
  { iocValue: 'crypto-mine.cc', iocType: 'domain', source: 'MISP-10005', severity: 'medium' },
  // ── Hostnames ──
  { iocValue: 'ns1.evil-domain.xyz', iocType: 'hostname', source: 'MISP-10002', severity: 'high' },
  {
    iocValue: 'mail.phishing-site.com',
    iocType: 'hostname',
    source: 'MISP-10003',
    severity: 'high',
  },
  {
    iocValue: 'cdn.malware-drop.ru',
    iocType: 'hostname',
    source: 'MISP-10010',
    severity: 'critical',
  },
  {
    iocValue: 'api.c2-server.onion',
    iocType: 'hostname',
    source: 'MISP-10007',
    severity: 'critical',
  },
  // ── MD5 hashes ──
  {
    iocValue: 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4',
    iocType: 'md5',
    source: 'MISP-10002',
    severity: 'high',
  },
  {
    iocValue: 'd41d8cd98f00b204e9800998ecf8427e',
    iocType: 'md5',
    source: 'MISP-10004',
    severity: 'critical',
  },
  {
    iocValue: '098f6bcd4621d373cade4e832627b4f6',
    iocType: 'md5',
    source: 'MISP-10007',
    severity: 'high',
  },
  {
    iocValue: 'e99a18c428cb38d5f260853678922e03',
    iocType: 'md5',
    source: 'MISP-10010',
    severity: 'critical',
  },
  {
    iocValue: '5d41402abc4b2a76b9719d911017c592',
    iocType: 'md5',
    source: 'MISP-10001',
    severity: 'medium',
  },
  // ── SHA1 hashes ──
  {
    iocValue: 'da39a3ee5e6b4b0d3255bfef95601890afd80709',
    iocType: 'sha1',
    source: 'MISP-10002',
    severity: 'high',
  },
  {
    iocValue: 'aaf4c61ddcc5e8a2dabede0f3b482cd9aea9434d',
    iocType: 'sha1',
    source: 'MISP-10004',
    severity: 'critical',
  },
  {
    iocValue: '356a192b7913b04c54574d18c28d46e6395428ab',
    iocType: 'sha1',
    source: 'MISP-10007',
    severity: 'high',
  },
  // ── SHA256 hashes ──
  {
    iocValue: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    iocType: 'sha256',
    source: 'MISP-10002',
    severity: 'critical',
  },
  {
    iocValue: 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    iocType: 'sha256',
    source: 'MISP-10004',
    severity: 'high',
  },
  {
    iocValue: 'a591a6d40bf420404a011733cfb7b190d62c65bf0bcda32b57b277d9ad9f146e',
    iocType: 'sha256',
    source: 'MISP-10010',
    severity: 'critical',
  },
  {
    iocValue: 'ca978112ca1bbdcafac231b39a23dc4da786eff8147c4e72b9807785afee48bb',
    iocType: 'sha256',
    source: 'MISP-10001',
    severity: 'medium',
  },
  {
    iocValue: '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824',
    iocType: 'sha256',
    source: 'MISP-10006',
    severity: 'high',
  },
  {
    iocValue: '3e23e8160039594a33894f6564e1b1348bbd7a0088d42c4acb73eeaed59c009d',
    iocType: 'sha256',
    source: 'MISP-10009',
    severity: 'high',
  },
  // ── URLs ──
  {
    iocValue: 'https://evil-domain.xyz/payload.exe',
    iocType: 'url',
    source: 'MISP-10002',
    severity: 'critical',
  },
  {
    iocValue: 'http://phishing-site.com/login',
    iocType: 'url',
    source: 'MISP-10003',
    severity: 'high',
  },
  {
    iocValue: 'https://malware-drop.ru/stage2.dll',
    iocType: 'url',
    source: 'MISP-10010',
    severity: 'critical',
  },
  {
    iocValue: 'http://crypto-mine.cc/worker.js',
    iocType: 'url',
    source: 'MISP-10005',
    severity: 'medium',
  },
  // ── Filenames ──
  { iocValue: 'dropper.exe', iocType: 'filename', source: 'MISP-10002', severity: 'high' },
  {
    iocValue: 'ransomware-payload.dll',
    iocType: 'filename',
    source: 'MISP-10010',
    severity: 'critical',
  },
  {
    iocValue: 'suspicious-script.ps1',
    iocType: 'filename',
    source: 'MISP-10007',
    severity: 'high',
  },
  { iocValue: 'keylogger.sys', iocType: 'filename', source: 'MISP-10004', severity: 'critical' },
  {
    iocValue: 'backdoor-installer.msi',
    iocType: 'filename',
    source: 'MISP-10001',
    severity: 'high',
  },
  // ── CIDR ranges ──
  { iocValue: '203.0.113.0/24', iocType: 'cidr', source: 'MISP-10001', severity: 'medium' },
  { iocValue: '198.51.100.0/24', iocType: 'cidr', source: 'MISP-10002', severity: 'high' },
  { iocValue: '185.220.101.0/24', iocType: 'cidr', source: 'MISP-10004', severity: 'medium' },
  // ── Email addresses ──
  {
    iocValue: 'phishing@evil-domain.xyz',
    iocType: 'email',
    source: 'MISP-10003',
    severity: 'high',
  },
  {
    iocValue: 'c2-admin@malware-drop.ru',
    iocType: 'email',
    source: 'MISP-10010',
    severity: 'critical',
  },
  {
    iocValue: 'recruitment@fake-corp.com',
    iocType: 'email',
    source: 'MISP-10009',
    severity: 'medium',
  },
  {
    iocValue: 'support@phishing-site.com',
    iocType: 'email',
    source: 'MISP-10003',
    severity: 'high',
  },
  // ── ASN ──
  { iocValue: 'AS14061', iocType: 'asn', source: 'MISP-10001', severity: 'low' },
  { iocValue: 'AS9009', iocType: 'asn', source: 'MISP-10004', severity: 'medium' },
  { iocValue: 'AS16276', iocType: 'asn', source: 'MISP-10010', severity: 'medium' },
  // ── CVE ──
  { iocValue: 'CVE-2024-3094', iocType: 'cve', source: 'MISP-10006', severity: 'critical' },
  { iocValue: 'CVE-2023-44228', iocType: 'cve', source: 'MISP-10007', severity: 'critical' },
  { iocValue: 'CVE-2024-21887', iocType: 'cve', source: 'MISP-10014', severity: 'high' },
  { iocValue: 'CVE-2023-46805', iocType: 'cve', source: 'MISP-10012', severity: 'high' },
  // ── Registry keys ──
  {
    iocValue: 'HKLM\\Software\\Microsoft\\Windows\\CurrentVersion\\Run\\MalwareKey',
    iocType: 'registry',
    source: 'MISP-10002',
    severity: 'high',
  },
  {
    iocValue: 'HKCU\\Software\\Classes\\CLSID\\{random-guid}\\InprocServer32',
    iocType: 'registry',
    source: 'MISP-10004',
    severity: 'critical',
  },
  {
    iocValue: 'HKLM\\System\\CurrentControlSet\\Services\\MalService',
    iocType: 'registry',
    source: 'MISP-10010',
    severity: 'high',
  },
  // ── File paths ──
  {
    iocValue: 'C:\\Windows\\Temp\\svchost_update.exe',
    iocType: 'filepath',
    source: 'MISP-10002',
    severity: 'high',
  },
  {
    iocValue: '/tmp/.hidden/backdoor',
    iocType: 'filepath',
    source: 'MISP-10007',
    severity: 'critical',
  },
  {
    iocValue: 'C:\\Users\\Public\\Documents\\stage2.dll',
    iocType: 'filepath',
    source: 'MISP-10010',
    severity: 'critical',
  },
  {
    iocValue: '/var/tmp/.cache/miner',
    iocType: 'filepath',
    source: 'MISP-10005',
    severity: 'medium',
  },
  // ── Wazuh-sourced IOCs ──
  { iocValue: '77.91.124.20', iocType: 'ip-src', source: 'wazuh', severity: 'critical' },
  { iocValue: '94.232.42.58', iocType: 'ip-src', source: 'wazuh', severity: 'high' },
  { iocValue: 'invoke-mimikatz.ps1', iocType: 'filename', source: 'wazuh', severity: 'critical' },
  {
    iocValue: 'HKLM\\System\\CurrentControlSet\\Control\\Lsa\\RunAsPPL',
    iocType: 'registry',
    source: 'wazuh',
    severity: 'high',
  },
  {
    iocValue: 'C:\\ProgramData\\svchost_task.exe',
    iocType: 'filepath',
    source: 'wazuh',
    severity: 'critical',
  },
  // ── Manual IOCs ──
  { iocValue: '5.188.86.10', iocType: 'ip-src', source: 'manual', severity: 'high' },
  { iocValue: 'suspicious-update.com', iocType: 'domain', source: 'manual', severity: 'medium' },
  { iocValue: 'CVE-2024-38063', iocType: 'cve', source: 'manual', severity: 'critical' },
  {
    iocValue: 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4',
    iocType: 'md5',
    source: 'manual',
    severity: 'high',
  },
  {
    iocValue: 'admin@suspicious-update.com',
    iocType: 'email',
    source: 'manual',
    severity: 'medium',
  },
  // ── ThreatFox IOCs ──
  { iocValue: '45.155.205.233', iocType: 'ip-src', source: 'threatfox', severity: 'critical' },
  { iocValue: '185.215.113.43', iocType: 'ip-src', source: 'threatfox', severity: 'critical' },
  {
    iocValue: 'redline-stealer-c2.top',
    iocType: 'domain',
    source: 'threatfox',
    severity: 'critical',
  },
  {
    iocValue: 'raccoon-stealer-drop.xyz',
    iocType: 'domain',
    source: 'threatfox',
    severity: 'high',
  },
  {
    iocValue: 'e99a18c428cb38d5f260853678922e03',
    iocType: 'md5',
    source: 'threatfox',
    severity: 'critical',
  },
  {
    iocValue: 'http://45.155.205.233:8080/loader.exe',
    iocType: 'url',
    source: 'threatfox',
    severity: 'critical',
  },
  { iocValue: 'AS44477', iocType: 'asn', source: 'threatfox', severity: 'high' },
  // ── OTX IOCs ──
  { iocValue: '103.224.182.250', iocType: 'ip-src', source: 'otx', severity: 'high' },
  { iocValue: '82.118.21.1', iocType: 'ip-src', source: 'otx', severity: 'medium' },
  { iocValue: 'apt-lazarus-c2.net', iocType: 'domain', source: 'otx', severity: 'critical' },
  { iocValue: 'cobalt-strike-beacon.cc', iocType: 'domain', source: 'otx', severity: 'critical' },
  {
    iocValue: 'dab758bf98d9b36fa057a66c0f5c45a5e03e9a52',
    iocType: 'sha1',
    source: 'otx',
    severity: 'high',
  },
  { iocValue: 'CVE-2023-36884', iocType: 'cve', source: 'otx', severity: 'critical' },
  { iocValue: '103.224.182.0/24', iocType: 'cidr', source: 'otx', severity: 'medium' },
  // ── VirusTotal IOCs ──
  {
    iocValue: '8b2e97f4d590f8b15dc8c82bfa8a1c2092eb3f37a4e3a86bc4e39c6ef8b7c1d0',
    iocType: 'sha256',
    source: 'virustotal',
    severity: 'critical',
  },
  {
    iocValue: 'f47c75614f3a67e5b2e5c2dbab2c46b2',
    iocType: 'md5',
    source: 'virustotal',
    severity: 'high',
  },
  { iocValue: 'trojan-agent.exe', iocType: 'filename', source: 'virustotal', severity: 'critical' },
  { iocValue: 'stealer-payload.dll', iocType: 'filename', source: 'virustotal', severity: 'high' },
  { iocValue: 'info-stealer-c2.ru', iocType: 'domain', source: 'virustotal', severity: 'critical' },
  { iocValue: 'AS62904', iocType: 'asn', source: 'virustotal', severity: 'medium' },
  // ── Logstash IOCs ──
  { iocValue: '146.70.87.199', iocType: 'ip-src', source: 'logstash', severity: 'high' },
  { iocValue: '62.102.148.68', iocType: 'ip-src', source: 'logstash', severity: 'critical' },
  { iocValue: 'ransomware-c2.top', iocType: 'domain', source: 'logstash', severity: 'critical' },
  { iocValue: 'exfil-staging.net', iocType: 'domain', source: 'logstash', severity: 'high' },
  {
    iocValue: 'http://62.102.148.68:443/beacon',
    iocType: 'url',
    source: 'logstash',
    severity: 'critical',
  },
  { iocValue: '146.70.87.0/24', iocType: 'cidr', source: 'logstash', severity: 'medium' },
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
    organization: 'Kaspersky GReAT',
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
    organization: 'CrowdStrike',
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
    organization: 'Mandiant',
    threatLevel: 'high',
    info: 'Spear Phishing Campaign Against Healthcare',
    attributeCount: 29,
  },
  {
    mispEventId: '10010',
    organization: 'FBI IC3',
    threatLevel: 'critical',
    info: 'State-Sponsored Espionage - Operation Shadow',
    attributeCount: 112,
  },
  {
    mispEventId: '10011',
    organization: 'Recorded Future',
    threatLevel: 'high',
    info: 'Magecart Skimming Infrastructure',
    attributeCount: 45,
  },
  {
    mispEventId: '10012',
    organization: 'Palo Alto Unit 42',
    threatLevel: 'critical',
    info: 'APT29 SolarWinds Follow-up Campaign',
    attributeCount: 93,
  },
  {
    mispEventId: '10013',
    organization: 'JPCERT/CC',
    threatLevel: 'medium',
    info: 'BlackTech Router Implant Indicators',
    attributeCount: 18,
  },
  {
    mispEventId: '10014',
    organization: 'NCSC-UK',
    threatLevel: 'high',
    info: 'Sandworm ICS Targeting Campaign',
    attributeCount: 37,
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

function buildRawEvent(
  template: (typeof ALERT_TEMPLATES)[number],
  agentName: string,
  srcIp: string,
  dstIp: string,
  ts: Date
): Record<string, unknown> {
  const base = {
    timestamp: ts.toISOString(),
    agent: { name: agentName, id: `agent-${Math.floor(Math.random() * 999)}` },
    rule: {
      id: template.ruleId,
      description: template.ruleName,
      level: Math.floor(Math.random() * 12) + 3,
    },
    source: { ip: srcIp, port: 1024 + Math.floor(Math.random() * 64000) },
    destination: { ip: dstIp, port: randomItem([22, 80, 443, 3389, 8080, 8443, 53]) },
  }

  if (template.source === 'wazuh') {
    return {
      ...base,
      manager: { name: 'wazuh-manager-01' },
      decoder: { name: randomItem(['sshd', 'syslog', 'windows', 'json', 'auditd']) },
      full_log: `${ts.toISOString()} ${agentName} ${template.ruleName}: src=${srcIp} dst=${dstIp}`,
      data: {
        srcip: srcIp,
        dstip: dstIp,
        srcuser: randomItem(['root', 'admin', 'svc-backup', 'www-data', 'nobody']),
        program_name: randomItem(['sshd', 'sudo', 'systemd', 'kernel', 'auditd']),
      },
    }
  }

  if (template.source === 'graylog') {
    return {
      ...base,
      gl2_source_input: `5f8c${Math.floor(Math.random() * 9999)}`,
      gl2_source_node: 'graylog-node-01',
      facility: randomItem(['auth', 'daemon', 'kern', 'local0', 'syslog']),
      message: `${template.description} [${srcIp} → ${dstIp}]`,
      streams: [`stream-${Math.floor(Math.random() * 99)}`],
      level: randomItem([3, 4, 5, 6]),
    }
  }

  if (template.source === 'velociraptor') {
    return {
      ...base,
      client_id: `C.${Math.random().toString(36).slice(2, 14)}`,
      flow_id: `F.${Math.random().toString(36).slice(2, 14)}`,
      artifact: randomItem([
        'Windows.System.ProcessCreation',
        'Windows.EventLogs.RDPNTLM',
        'Generic.Client.Info',
        'Windows.Detection.LSASS',
      ]),
      hostname: agentName,
      os_info: { system: 'windows', release: '10.0.19045', machine: 'AMD64' },
    }
  }

  return base
}

const RESOLUTION_TEXTS = [
  'Confirmed and mitigated — affected hosts isolated and patched',
  'False positive — triggered by scheduled maintenance script',
  'Contained — malicious process terminated, IOCs blocked at perimeter',
  'Escalated to IR team — ongoing investigation',
  'Remediated — user credentials rotated and MFA enforced',
  'No action required — benign scanning by vulnerability assessment tool',
]

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
    const agentName = randomItem(profile.agentPool)
    const srcIp = randomIp()
    const dstIp = randomIp()

    // Randomly decide which optional fields to populate (variety per alert)
    const roll = i % 5 // 0-4 gives us 5 variation groups
    const hasRawEvent = roll !== 0 // ~80% have raw event
    const hasAcknowledged = status !== 'new_alert' && roll !== 1 // most non-new alerts
    const hasClosed = (status === 'closed' || status === 'resolved') && roll !== 2
    const hasResolution =
      (status === 'closed' || status === 'resolved' || status === 'false_positive') && roll !== 3

    await prisma.alert.upsert({
      where: { tenantId_externalId: { tenantId, externalId } },
      update: {
        rawEvent: hasRawEvent
          ? (buildRawEvent(template, agentName, srcIp, dstIp, timestamp) as Prisma.InputJsonValue)
          : undefined,
        acknowledgedBy: hasAcknowledged ? `analyst@${profile.slug}.io` : null,
        acknowledgedAt: hasAcknowledged ? new Date(timestamp.getTime() + 300_000) : null,
        closedBy: hasClosed ? `analyst@${profile.slug}.io` : null,
        closedAt: hasClosed ? new Date(timestamp.getTime() + 3_600_000) : null,
        resolution: hasResolution ? randomItem(RESOLUTION_TEXTS) : null,
      },
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
        agentName,
        sourceIp: srcIp,
        destinationIp: dstIp,
        mitreTactics: template.mitreTactics,
        mitreTechniques: template.mitreTechniques,
        timestamp,
        rawEvent: hasRawEvent
          ? (buildRawEvent(template, agentName, srcIp, dstIp, timestamp) as Prisma.InputJsonValue)
          : undefined,
        acknowledgedBy: hasAcknowledged ? `analyst@${profile.slug}.io` : null,
        acknowledgedAt: hasAcknowledged ? new Date(timestamp.getTime() + 300_000) : null,
        closedBy: hasClosed ? `analyst@${profile.slug}.io` : null,
        closedAt: hasClosed ? new Date(timestamp.getTime() + 3_600_000) : null,
        resolution: hasResolution ? randomItem(RESOLUTION_TEXTS) : null,
      },
    })
  }
}

async function seedCases(
  tenantId: string,
  profile: TenantProfile,
  cycleIds: string[],
  assignableUserIds: string[]
): Promise<void> {
  const year = new Date().getFullYear()
  const templates = pickByIndices(CASE_TEMPLATES, profile.caseTemplateIndices)

  for (const [idx, template] of templates.entries()) {
    globalCaseCounter++
    const caseNumber = `SOC-${year}-${String(globalCaseCounter).padStart(3, '0')}`

    // Distribute cases across cycles: round-robin assignment
    const cycleId = cycleIds.length > 0 ? cycleIds[idx % cycleIds.length] : null

    // Distribute cases across assignable users: round-robin, leave every 3rd case unassigned
    const ownerUserId =
      assignableUserIds.length > 0 && idx % 3 !== 2
        ? assignableUserIds[idx % assignableUserIds.length]
        : null

    await prisma.case.upsert({
      where: { caseNumber },
      update: {
        // Update existing seeded cases with owner + cycle assignment
        ...(ownerUserId ? { ownerUserId } : {}),
        ...(cycleId ? { cycleId } : {}),
      },
      create: {
        tenantId,
        caseNumber,
        title: template.title,
        description: template.description,
        severity: template.severity,
        status: template.status,
        createdBy: `admin@${profile.slug}.io`,
        closedAt: template.status === 'closed' ? randomDate(5) : null,
        ...(cycleId ? { cycleId } : {}),
        ...(ownerUserId ? { ownerUserId } : {}),
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

async function seedCaseCycles(tenantId: string, profile: TenantProfile): Promise<string[]> {
  const now = new Date()
  const cycleIds: string[] = []

  for (const template of CYCLE_TEMPLATES) {
    const startDate = new Date(now.getTime() - template.daysAgo * 24 * 60 * 60 * 1000)
    const endDate = new Date(startDate.getTime() + template.durationDays * 24 * 60 * 60 * 1000)
    const cycleName = `[${profile.slug}] ${template.name}`

    // Idempotent: check if cycle with this name already exists for this tenant
    const existing = await prisma.caseCycle.findFirst({
      where: { tenantId, name: cycleName },
      select: { id: true },
    })
    if (existing) {
      cycleIds.push(existing.id)
      continue
    }

    const cycle = await prisma.caseCycle.create({
      data: {
        tenantId,
        name: cycleName,
        description: template.description,
        status: template.status,
        startDate,
        endDate: template.status === 'closed' ? endDate : null,
        createdBy: `admin@${profile.slug}.io`,
        closedBy: template.status === 'closed' ? `admin@${profile.slug}.io` : null,
        closedAt: template.status === 'closed' ? endDate : null,
      },
    })

    cycleIds.push(cycle.id)
  }

  return cycleIds
}

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

    // Collect user IDs that can be assigned cases (analysts, hunters, admins — not execs)
    const assignableUsers = await prisma.tenantMembership.findMany({
      where: {
        tenantId,
        status: 'active',
        role: {
          in: [
            UserRole.GLOBAL_ADMIN,
            UserRole.TENANT_ADMIN,
            UserRole.SOC_ANALYST_L2,
            UserRole.SOC_ANALYST_L1,
            UserRole.THREAT_HUNTER,
          ],
        },
      },
      select: { userId: true },
    })
    const assignableUserIds = assignableUsers.map(u => u.userId)

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

    // ─── Case Cycles (idempotent via name check per tenant) ───
    const cycleIds = await seedCaseCycles(tenantId, profile)
    logger.info({ tenant: profile.slug, count: CYCLE_TEMPLATES.length }, 'Seeded case cycles')

    // ─── Cases (idempotent via upsert on caseNumber) ───
    await seedCases(tenantId, profile, cycleIds, assignableUserIds)
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

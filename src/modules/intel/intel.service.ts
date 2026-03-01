import { Injectable, Logger } from '@nestjs/common'

/* ------------------------------------------------------------------ */
/* Type definitions                                                    */
/* ------------------------------------------------------------------ */

export interface MISPTag {
  id: string
  name: string
  color: string
}

export interface MISPEvent {
  id: string
  eventId: string
  organization: string
  threatLevel: string
  info: string
  date: string
  tags: MISPTag[]
  attributeCount: number
  published: boolean
}

export interface IOCSearchResult {
  id: string
  iocValue: string
  iocType: string
  source: string
  hitCount: number
  lastSeen: string
  severity: string
}

export interface IOCMatchResult {
  alertId: string
  matchedIOCs: {
    iocValue: string
    iocType: string
    source: string
    severity: string
  }[]
  matchCount: number
}

@Injectable()
export class IntelService {
  private readonly logger = new Logger(IntelService.name)

  /**
   * Returns recent MISP events (mock data, tenant-scoped).
   * In production this would call MispConnectorService.getEvents().
   */
  async getRecentEvents(tenantId: string): Promise<MISPEvent[]> {
    this.logger.log(`Fetching recent MISP events for tenant ${tenantId}`)

    return [
      {
        id: 'misp-001',
        eventId: 'MISP-8842',
        organization: 'CIRCL',
        threatLevel: 'high',
        info: 'APT29 - Cozy Bear Campaign Targeting Government Infrastructure',
        date: '2026-02-28',
        tags: [
          { id: 'tag-001', name: 'tlp:red', color: '#cc0033' },
          { id: 'tag-002', name: 'misp-galaxy:threat-actor="APT29"', color: '#0088cc' },
          { id: 'tag-003', name: 'misp-galaxy:mitre-attack-pattern="T1071"', color: '#2b2b2b' },
        ],
        attributeCount: 47,
        published: true,
      },
      {
        id: 'misp-002',
        eventId: 'MISP-8839',
        organization: 'CERT-EU',
        threatLevel: 'high',
        info: 'LockBit 3.0 Ransomware - New TTPs and IOCs',
        date: '2026-02-27',
        tags: [
          { id: 'tag-004', name: 'tlp:amber', color: '#ffc000' },
          { id: 'tag-005', name: 'misp-galaxy:ransomware="LockBit"', color: '#cc0033' },
          { id: 'tag-006', name: 'misp-galaxy:mitre-attack-pattern="T1486"', color: '#2b2b2b' },
        ],
        attributeCount: 89,
        published: true,
      },
      {
        id: 'misp-003',
        eventId: 'MISP-8835',
        organization: 'AlienVault OTX',
        threatLevel: 'medium',
        info: 'Cobalt Strike Infrastructure - February 2026 Update',
        date: '2026-02-26',
        tags: [
          { id: 'tag-007', name: 'tlp:green', color: '#33b35a' },
          { id: 'tag-008', name: 'misp-galaxy:tool="Cobalt Strike"', color: '#6633cc' },
          { id: 'tag-009', name: 'type:OSINT', color: '#004466' },
        ],
        attributeCount: 156,
        published: true,
      },
      {
        id: 'misp-004',
        eventId: 'MISP-8830',
        organization: 'MISP Community',
        threatLevel: 'high',
        info: 'Brute Force Campaign - SSH/RDP Botnet Infrastructure',
        date: '2026-02-25',
        tags: [
          { id: 'tag-010', name: 'tlp:green', color: '#33b35a' },
          { id: 'tag-011', name: 'misp-galaxy:mitre-attack-pattern="T1110"', color: '#2b2b2b' },
          { id: 'tag-012', name: 'type:OSINT', color: '#004466' },
        ],
        attributeCount: 234,
        published: true,
      },
      {
        id: 'misp-005',
        eventId: 'MISP-8825',
        organization: 'US-CERT',
        threatLevel: 'high',
        info: 'APT41 - Winnti Group Supply Chain Compromise',
        date: '2026-02-24',
        tags: [
          { id: 'tag-013', name: 'tlp:amber', color: '#ffc000' },
          { id: 'tag-014', name: 'misp-galaxy:threat-actor="APT41"', color: '#0088cc' },
          { id: 'tag-015', name: 'misp-galaxy:mitre-attack-pattern="T1195"', color: '#2b2b2b' },
        ],
        attributeCount: 63,
        published: true,
      },
      {
        id: 'misp-006',
        eventId: 'MISP-8820',
        organization: 'SANS ISC',
        threatLevel: 'medium',
        info: 'Phishing Campaign Using Invoice-Themed Lures - Q1 2026',
        date: '2026-02-23',
        tags: [
          { id: 'tag-016', name: 'tlp:white', color: '#ffffff' },
          { id: 'tag-017', name: 'misp-galaxy:mitre-attack-pattern="T1566"', color: '#2b2b2b' },
          { id: 'tag-018', name: 'type:OSINT', color: '#004466' },
        ],
        attributeCount: 42,
        published: true,
      },
      {
        id: 'misp-007',
        eventId: 'MISP-8815',
        organization: 'Mandiant',
        threatLevel: 'high',
        info: 'Volt Typhoon - Critical Infrastructure Targeting',
        date: '2026-02-22',
        tags: [
          { id: 'tag-019', name: 'tlp:amber', color: '#ffc000' },
          { id: 'tag-020', name: 'misp-galaxy:threat-actor="Volt Typhoon"', color: '#0088cc' },
          { id: 'tag-021', name: 'misp-galaxy:mitre-attack-pattern="T1053"', color: '#2b2b2b' },
        ],
        attributeCount: 78,
        published: true,
      },
      {
        id: 'misp-008',
        eventId: 'MISP-8810',
        organization: 'CrowdStrike',
        threatLevel: 'medium',
        info: 'Tor Exit Node Infrastructure Update - February 2026',
        date: '2026-02-21',
        tags: [
          { id: 'tag-022', name: 'tlp:green', color: '#33b35a' },
          { id: 'tag-023', name: 'misp-galaxy:mitre-attack-pattern="T1090"', color: '#2b2b2b' },
          { id: 'tag-024', name: 'type:OSINT', color: '#004466' },
        ],
        attributeCount: 512,
        published: true,
      },
      {
        id: 'misp-009',
        eventId: 'MISP-8805',
        organization: 'CIRCL',
        threatLevel: 'low',
        info: 'DNS Tunneling Tools and Infrastructure Indicators',
        date: '2026-02-20',
        tags: [
          { id: 'tag-025', name: 'tlp:white', color: '#ffffff' },
          { id: 'tag-026', name: 'misp-galaxy:mitre-attack-pattern="T1048"', color: '#2b2b2b' },
        ],
        attributeCount: 28,
        published: true,
      },
      {
        id: 'misp-010',
        eventId: 'MISP-8800',
        organization: 'Recorded Future',
        threatLevel: 'medium',
        info: 'Kerberoasting and AS-REP Roasting Detection Indicators',
        date: '2026-02-19',
        tags: [
          { id: 'tag-027', name: 'tlp:green', color: '#33b35a' },
          { id: 'tag-028', name: 'misp-galaxy:mitre-attack-pattern="T1558"', color: '#2b2b2b' },
          { id: 'tag-029', name: 'type:OSINT', color: '#004466' },
        ],
        attributeCount: 35,
        published: false,
      },
    ]
  }

  /**
   * Search IOCs by query string (mock data, tenant-scoped).
   * In production this would call MispConnectorService.searchAttributes().
   */
  async searchIOCs(query: string, tenantId: string): Promise<IOCSearchResult[]> {
    this.logger.log(`Searching IOCs for "${query}" in tenant ${tenantId}`)

    const allIOCs: IOCSearchResult[] = [
      {
        id: 'ioc-001',
        iocValue: '198.51.100.22',
        iocType: 'ip-dst',
        source: 'MISP-8830',
        hitCount: 523,
        lastSeen: '2026-03-01T13:25:00Z',
        severity: 'critical',
      },
      {
        id: 'ioc-002',
        iocValue: '185.220.101.34',
        iocType: 'ip-dst',
        source: 'MISP-8810',
        hitCount: 142,
        lastSeen: '2026-03-01T10:05:00Z',
        severity: 'high',
      },
      {
        id: 'ioc-003',
        iocValue: 'update-service.xyz',
        iocType: 'domain',
        source: 'MISP-8842',
        hitCount: 340,
        lastSeen: '2026-03-01T10:05:00Z',
        severity: 'high',
      },
      {
        id: 'ioc-004',
        iocValue: 'data.exfil-cdn.net',
        iocType: 'domain',
        source: 'MISP-8805',
        hitCount: 340,
        lastSeen: '2026-02-28T18:55:00Z',
        severity: 'high',
      },
      {
        id: 'ioc-005',
        iocValue: 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6abcd',
        iocType: 'sha256',
        source: 'MISP-8839',
        hitCount: 1,
        lastSeen: '2026-03-01T12:48:00Z',
        severity: 'critical',
      },
      {
        id: 'ioc-006',
        iocValue: '185.220.100.252',
        iocType: 'ip-dst',
        source: 'MISP-8810',
        hitCount: 3,
        lastSeen: '2026-02-27T12:55:00Z',
        severity: 'medium',
      },
      {
        id: 'ioc-007',
        iocValue: 'supplier-update.com',
        iocType: 'domain',
        source: 'MISP-8820',
        hitCount: 1,
        lastSeen: '2026-02-25T18:10:00Z',
        severity: 'medium',
      },
      {
        id: 'ioc-008',
        iocValue: '203.0.113.45',
        iocType: 'ip-src',
        source: 'MISP-8830',
        hitCount: 15,
        lastSeen: '2026-03-01T14:32:00Z',
        severity: 'high',
      },
      {
        id: 'ioc-009',
        iocValue: 'e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6',
        iocType: 'sha256',
        source: 'MISP-8835',
        hitCount: 1,
        lastSeen: '2026-02-26T14:00:00Z',
        severity: 'high',
      },
      {
        id: 'ioc-010',
        iocValue: '10.0.5.42',
        iocType: 'ip-src',
        source: 'MISP-8800',
        hitCount: 47,
        lastSeen: '2026-02-26T14:25:00Z',
        severity: 'medium',
      },
    ]

    if (!query || query.trim().length === 0) {
      return allIOCs
    }

    const lowerQuery = query.toLowerCase()
    return allIOCs.filter(
      ioc =>
        ioc.iocValue.toLowerCase().includes(lowerQuery) ||
        ioc.iocType.toLowerCase().includes(lowerQuery) ||
        ioc.source.toLowerCase().includes(lowerQuery) ||
        ioc.severity.toLowerCase().includes(lowerQuery)
    )
  }

  /**
   * Match IOCs against a list of alert IDs (mock data).
   * In production this would cross-reference MISP attributes
   * with alert fields from OpenSearch.
   */
  async matchIOCsAgainstAlerts(alertIds: string[], tenantId: string): Promise<IOCMatchResult[]> {
    this.logger.log(`Matching IOCs against ${alertIds.length} alerts for tenant ${tenantId}`)

    // Simulated IOC matches per alert
    const mockMatches: Record<string, IOCMatchResult> = {
      'alert-001': {
        alertId: 'alert-001',
        matchedIOCs: [
          { iocValue: '203.0.113.45', iocType: 'ip-src', source: 'MISP-8830', severity: 'high' },
        ],
        matchCount: 1,
      },
      'alert-002': {
        alertId: 'alert-002',
        matchedIOCs: [
          {
            iocValue: '198.51.100.22',
            iocType: 'ip-dst',
            source: 'MISP-8830',
            severity: 'critical',
          },
        ],
        matchCount: 1,
      },
      'alert-003': {
        alertId: 'alert-003',
        matchedIOCs: [
          {
            iocValue: 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6abcd',
            iocType: 'sha256',
            source: 'MISP-8839',
            severity: 'critical',
          },
        ],
        matchCount: 1,
      },
      'alert-005': {
        alertId: 'alert-005',
        matchedIOCs: [
          {
            iocValue: 'update-service.xyz',
            iocType: 'domain',
            source: 'MISP-8842',
            severity: 'high',
          },
          { iocValue: '185.220.101.34', iocType: 'ip-dst', source: 'MISP-8810', severity: 'high' },
        ],
        matchCount: 2,
      },
      'alert-010': {
        alertId: 'alert-010',
        matchedIOCs: [
          {
            iocValue: 'data.exfil-cdn.net',
            iocType: 'domain',
            source: 'MISP-8805',
            severity: 'high',
          },
        ],
        matchCount: 1,
      },
      'alert-015': {
        alertId: 'alert-015',
        matchedIOCs: [
          { iocValue: '10.0.5.42', iocType: 'ip-src', source: 'MISP-8800', severity: 'medium' },
        ],
        matchCount: 1,
      },
    }

    return alertIds.map(alertId => {
      if (mockMatches[alertId]) {
        return mockMatches[alertId]
      }
      return {
        alertId,
        matchedIOCs: [],
        matchCount: 0,
      }
    })
  }
}

import { DashboardsService } from '../../src/modules/dashboards/dashboards.service'

const mockAppLogger = {
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}

function createMockRepository() {
  return {
    countOpenCases: jest.fn(),
    countAlertsSince: jest.fn(),
    countResolvedAlertsSince: jest.fn(),
    getAvgResolutionMsSince: jest.fn(),
    countAlertsBetween: jest.fn(),
    countAlertsBetweenExclusiveEnd: jest.fn(),
    countCriticalAlertsBetween: jest.fn(),
    countCriticalAlertsBetweenExclusiveEnd: jest.fn(),
    countCasesCreatedBetween: jest.fn(),
    countCasesCreatedBetweenExclusiveEnd: jest.fn(),
    getAvgResolutionMsBetween: jest.fn(),
    getAvgResolutionMsBetweenExclusiveEnd: jest.fn(),
    getAlertCountsByDateAndSeverity: jest.fn(),
    groupAlertsBySeveritySince: jest.fn(),
    getTopMitreTechniques: jest.fn(),
    getTopTargetedAssets: jest.fn(),
    findEnabledConnectors: jest.fn(),
  }
}

function createMockConnectorsService() {
  return {
    getEnabledConnectors: jest.fn(),
  }
}

const TENANT_ID = 'tenant-001'

describe('DashboardsService', () => {
  let service: DashboardsService
  let repository: ReturnType<typeof createMockRepository>
  let connectorsService: ReturnType<typeof createMockConnectorsService>

  beforeEach(() => {
    repository = createMockRepository()
    connectorsService = createMockConnectorsService()
    service = new DashboardsService(
      repository as never,
      connectorsService as never,
      mockAppLogger as never
    )
    jest.clearAllMocks()
  })

  /* ------------------------------------------------------------------ */
  /* getSummary                                                          */
  /* ------------------------------------------------------------------ */

  describe('getSummary', () => {
    it('should return all KPI fields with correct values', async () => {
      // openCases
      repository.countOpenCases.mockResolvedValueOnce(12)
      // alertsLast24h
      repository.countAlertsSince.mockResolvedValueOnce(45)
      // resolvedLast24h
      repository.countResolvedAlertsSince.mockResolvedValueOnce(8)
      // avgResolutionTime (overall MTTR)
      repository.getAvgResolutionMsSince.mockResolvedValueOnce([{ avg_ms: 300000 }])
      // alertsCurrentWeek
      repository.countAlertsBetween.mockResolvedValueOnce(150)
      // criticalCurrentWeek
      repository.countCriticalAlertsBetween.mockResolvedValueOnce(20)
      // casesCurrentWeek
      repository.countCasesCreatedBetween.mockResolvedValueOnce(10)
      // mttrCurrentWeek
      repository.getAvgResolutionMsBetween.mockResolvedValueOnce([{ avg_ms: 240000 }])
      // alertsPreviousWeek
      repository.countAlertsBetweenExclusiveEnd.mockResolvedValueOnce(100)
      // criticalPreviousWeek
      repository.countCriticalAlertsBetweenExclusiveEnd.mockResolvedValueOnce(10)
      // casesPreviousWeek
      repository.countCasesCreatedBetweenExclusiveEnd.mockResolvedValueOnce(8)
      // mttrPreviousWeek
      repository.getAvgResolutionMsBetweenExclusiveEnd.mockResolvedValueOnce([{ avg_ms: 200000 }])
      // getEnabledConnectors
      connectorsService.getEnabledConnectors.mockResolvedValueOnce([
        { type: 'wazuh', name: 'Wazuh' },
        { type: 'misp', name: 'MISP' },
      ])

      const result = await service.getSummary(TENANT_ID)

      expect(result.tenantId).toBe(TENANT_ID)
      expect(result.totalAlerts).toBe(150)
      expect(result.criticalAlerts).toBe(20)
      expect(result.openCases).toBe(12)
      expect(result.alertsLast24h).toBe(45)
      expect(result.resolvedLast24h).toBe(8)
      expect(result.meanTimeToRespond).toBe('5m')
      expect(result.connectedSources).toBe(2)
      // Trend: (150 - 100) / 100 * 100 = 50.0
      expect(result.totalAlertsTrend).toBe(50)
      // Trend: (20 - 10) / 10 * 100 = 100.0
      expect(result.criticalAlertsTrend).toBe(100)
      // Trend: (10 - 8) / 8 * 100 = 25.0
      expect(result.openCasesTrend).toBe(25)
      // Trend: (240000 - 200000) / 200000 * 100 = 20.0
      expect(result.mttrTrend).toBe(20)
    })

    it('should return N/A for MTTR when no resolved alerts exist', async () => {
      repository.countOpenCases.mockResolvedValue(0)
      repository.countAlertsSince.mockResolvedValue(0)
      repository.countResolvedAlertsSince.mockResolvedValue(0)
      // avgResolutionTime — no resolved alerts
      repository.getAvgResolutionMsSince.mockResolvedValueOnce([{ avg_ms: null }])
      // Current week
      repository.countAlertsBetween.mockResolvedValue(0)
      repository.countCriticalAlertsBetween.mockResolvedValue(0)
      repository.countCasesCreatedBetween.mockResolvedValue(0)
      // mttrCurrentWeek
      repository.getAvgResolutionMsBetween.mockResolvedValueOnce([{ avg_ms: null }])
      // Previous week
      repository.countAlertsBetweenExclusiveEnd.mockResolvedValue(0)
      repository.countCriticalAlertsBetweenExclusiveEnd.mockResolvedValue(0)
      repository.countCasesCreatedBetweenExclusiveEnd.mockResolvedValue(0)
      // mttrPreviousWeek
      repository.getAvgResolutionMsBetweenExclusiveEnd.mockResolvedValueOnce([{ avg_ms: null }])
      connectorsService.getEnabledConnectors.mockResolvedValueOnce([])

      const result = await service.getSummary(TENANT_ID)

      expect(result.meanTimeToRespond).toBe('N/A')
    })

    it('should calculate trend as 100 when previousValue is 0 and currentValue > 0', async () => {
      repository.countOpenCases.mockResolvedValue(0)
      repository.countAlertsSince.mockResolvedValueOnce(0)
      repository.countResolvedAlertsSince.mockResolvedValueOnce(0)
      repository.getAvgResolutionMsSince.mockResolvedValue([{ avg_ms: null }])
      repository.countAlertsBetween.mockResolvedValueOnce(15)
      repository.countCriticalAlertsBetween.mockResolvedValueOnce(5)
      repository.countCasesCreatedBetween.mockResolvedValue(0)
      repository.getAvgResolutionMsBetween.mockResolvedValue([{ avg_ms: null }])
      repository.countAlertsBetweenExclusiveEnd.mockResolvedValueOnce(0)
      repository.countCriticalAlertsBetweenExclusiveEnd.mockResolvedValueOnce(0)
      repository.countCasesCreatedBetweenExclusiveEnd.mockResolvedValue(0)
      repository.getAvgResolutionMsBetweenExclusiveEnd.mockResolvedValue([{ avg_ms: null }])
      connectorsService.getEnabledConnectors.mockResolvedValueOnce([])

      const result = await service.getSummary(TENANT_ID)

      // prev=0, curr=15 → 100
      expect(result.totalAlertsTrend).toBe(100)
      // prev=0, curr=5 → 100
      expect(result.criticalAlertsTrend).toBe(100)
    })

    it('should calculate trend as 0 when both current and previous are 0', async () => {
      repository.countOpenCases.mockResolvedValue(0)
      repository.countAlertsSince.mockResolvedValue(0)
      repository.countResolvedAlertsSince.mockResolvedValue(0)
      repository.getAvgResolutionMsSince.mockResolvedValue([{ avg_ms: null }])
      repository.countAlertsBetween.mockResolvedValue(0)
      repository.countCriticalAlertsBetween.mockResolvedValue(0)
      repository.countCasesCreatedBetween.mockResolvedValue(0)
      repository.getAvgResolutionMsBetween.mockResolvedValue([{ avg_ms: null }])
      repository.countAlertsBetweenExclusiveEnd.mockResolvedValue(0)
      repository.countCriticalAlertsBetweenExclusiveEnd.mockResolvedValue(0)
      repository.countCasesCreatedBetweenExclusiveEnd.mockResolvedValue(0)
      repository.getAvgResolutionMsBetweenExclusiveEnd.mockResolvedValue([{ avg_ms: null }])
      connectorsService.getEnabledConnectors.mockResolvedValueOnce([])

      const result = await service.getSummary(TENANT_ID)

      expect(result.totalAlertsTrend).toBe(0)
      expect(result.criticalAlertsTrend).toBe(0)
      expect(result.openCasesTrend).toBe(0)
      expect(result.mttrTrend).toBe(0)
    })

    it('should calculate negative trend when current is less than previous', async () => {
      repository.countOpenCases.mockResolvedValueOnce(5)
      repository.countAlertsSince.mockResolvedValueOnce(10)
      repository.countResolvedAlertsSince.mockResolvedValueOnce(2)
      repository.getAvgResolutionMsSince.mockResolvedValueOnce([{ avg_ms: 180000 }])
      repository.countAlertsBetween.mockResolvedValueOnce(80)
      repository.countCriticalAlertsBetween.mockResolvedValueOnce(5)
      repository.countCasesCreatedBetween.mockResolvedValueOnce(3)
      repository.getAvgResolutionMsBetween.mockResolvedValueOnce([{ avg_ms: 150000 }])
      repository.countAlertsBetweenExclusiveEnd.mockResolvedValueOnce(100)
      repository.countCriticalAlertsBetweenExclusiveEnd.mockResolvedValueOnce(10)
      repository.countCasesCreatedBetweenExclusiveEnd.mockResolvedValueOnce(6)
      repository.getAvgResolutionMsBetweenExclusiveEnd.mockResolvedValueOnce([{ avg_ms: 200000 }])
      connectorsService.getEnabledConnectors.mockResolvedValueOnce([
        { type: 'wazuh', name: 'Wazuh' },
      ])

      const result = await service.getSummary(TENANT_ID)

      // (80 - 100) / 100 * 100 = -20
      expect(result.totalAlertsTrend).toBe(-20)
      // (5 - 10) / 10 * 100 = -50
      expect(result.criticalAlertsTrend).toBe(-50)
      // (3 - 6) / 6 * 100 = -50
      expect(result.openCasesTrend).toBe(-50)
      // (150000 - 200000) / 200000 * 100 = -25
      expect(result.mttrTrend).toBe(-25)
    })
  })

  /* ------------------------------------------------------------------ */
  /* getAlertTrend                                                       */
  /* ------------------------------------------------------------------ */

  describe('getAlertTrend', () => {
    it('should return trend data pivoted by severity', async () => {
      repository.getAlertCountsByDateAndSeverity.mockResolvedValueOnce([
        { date: '2026-03-01', severity: 'critical', count: 5n },
        { date: '2026-03-01', severity: 'high', count: 10n },
        { date: '2026-03-01', severity: 'medium', count: 20n },
        { date: '2026-03-02', severity: 'low', count: 3n },
        { date: '2026-03-02', severity: 'info', count: 7n },
      ])

      const result = await service.getAlertTrend(TENANT_ID, 7)

      expect(result.tenantId).toBe(TENANT_ID)
      expect(result.days).toBe(7)
      expect(result.trend).toHaveLength(2)

      const day1 = result.trend[0]
      expect(day1).toEqual({
        date: '2026-03-01',
        critical: 5,
        high: 10,
        medium: 20,
        low: 0,
        info: 0,
      })

      const day2 = result.trend[1]
      expect(day2).toEqual({
        date: '2026-03-02',
        critical: 0,
        high: 0,
        medium: 0,
        low: 3,
        info: 7,
      })
    })

    it('should convert bigint counts to number', async () => {
      repository.getAlertCountsByDateAndSeverity.mockResolvedValueOnce([
        { date: '2026-03-10', severity: 'critical', count: 999n },
      ])

      const result = await service.getAlertTrend(TENANT_ID, 30)

      expect(result.trend[0]?.critical).toBe(999)
      expect(typeof result.trend[0]?.critical).toBe('number')
    })

    it('should return empty trend when no data', async () => {
      repository.getAlertCountsByDateAndSeverity.mockResolvedValueOnce([])

      const result = await service.getAlertTrend(TENANT_ID, 7)

      expect(result.trend).toEqual([])
    })

    it('should aggregate multiple severities for the same date', async () => {
      repository.getAlertCountsByDateAndSeverity.mockResolvedValueOnce([
        { date: '2026-03-05', severity: 'critical', count: 2n },
        { date: '2026-03-05', severity: 'high', count: 8n },
        { date: '2026-03-05', severity: 'medium', count: 15n },
        { date: '2026-03-05', severity: 'low', count: 30n },
        { date: '2026-03-05', severity: 'info', count: 50n },
      ])

      const result = await service.getAlertTrend(TENANT_ID, 7)

      expect(result.trend).toHaveLength(1)
      expect(result.trend[0]).toEqual({
        date: '2026-03-05',
        critical: 2,
        high: 8,
        medium: 15,
        low: 30,
        info: 50,
      })
    })
  })

  /* ------------------------------------------------------------------ */
  /* getSeverityDistribution                                             */
  /* ------------------------------------------------------------------ */

  describe('getSeverityDistribution', () => {
    it('should return distribution with counts and percentages', async () => {
      repository.groupAlertsBySeveritySince.mockResolvedValueOnce([
        { severity: 'critical', _count: 10 },
        { severity: 'high', _count: 30 },
        { severity: 'medium', _count: 40 },
        { severity: 'low', _count: 15 },
        { severity: 'info', _count: 5 },
      ])

      const result = await service.getSeverityDistribution(TENANT_ID)

      expect(result.tenantId).toBe(TENANT_ID)
      expect(result.distribution).toHaveLength(5)

      const critical = result.distribution.find(d => d.severity === 'critical')
      expect(critical).toEqual({ severity: 'critical', count: 10, percentage: 10 })

      const high = result.distribution.find(d => d.severity === 'high')
      expect(high).toEqual({ severity: 'high', count: 30, percentage: 30 })

      const medium = result.distribution.find(d => d.severity === 'medium')
      expect(medium).toEqual({ severity: 'medium', count: 40, percentage: 40 })
    })

    it('should handle empty distribution (total=0 gives percentage=0)', async () => {
      repository.groupAlertsBySeveritySince.mockResolvedValueOnce([])

      const result = await service.getSeverityDistribution(TENANT_ID)

      expect(result.tenantId).toBe(TENANT_ID)
      expect(result.distribution).toEqual([])
    })

    it('should calculate percentages correctly with rounding', async () => {
      // 7 + 3 = 10 total => 70% and 30%
      repository.groupAlertsBySeveritySince.mockResolvedValueOnce([
        { severity: 'critical', _count: 7 },
        { severity: 'high', _count: 3 },
      ])

      const result = await service.getSeverityDistribution(TENANT_ID)

      expect(result.distribution).toEqual([
        { severity: 'critical', count: 7, percentage: 70 },
        { severity: 'high', count: 3, percentage: 30 },
      ])
    })

    it('should handle uneven percentage splits', async () => {
      // 1 + 2 = 3 total => 33.3% and 66.7%
      repository.groupAlertsBySeveritySince.mockResolvedValueOnce([
        { severity: 'low', _count: 1 },
        { severity: 'high', _count: 2 },
      ])

      const result = await service.getSeverityDistribution(TENANT_ID)

      const low = result.distribution.find(d => d.severity === 'low')
      const high = result.distribution.find(d => d.severity === 'high')
      // Math.round((1/3) * 1000) / 10 = Math.round(333.33) / 10 = 333 / 10 = 33.3
      expect(low?.percentage).toBe(33.3)
      // Math.round((2/3) * 1000) / 10 = Math.round(666.67) / 10 = 667 / 10 = 66.7
      expect(high?.percentage).toBe(66.7)
    })
  })

  /* ------------------------------------------------------------------ */
  /* getMitreTopTechniques                                               */
  /* ------------------------------------------------------------------ */

  describe('getMitreTopTechniques', () => {
    it('should return technique IDs and counts', async () => {
      repository.getTopMitreTechniques.mockResolvedValueOnce([
        { technique: 'T1059', count: 10n },
        { technique: 'T1053', count: 8n },
        { technique: 'T1071', count: 5n },
      ])

      const result = await service.getMitreTopTechniques(TENANT_ID)

      expect(result.tenantId).toBe(TENANT_ID)
      expect(result.techniques).toEqual([
        { id: 'T1059', count: 10 },
        { id: 'T1053', count: 8 },
        { id: 'T1071', count: 5 },
      ])
    })

    it('should convert bigint counts to number', async () => {
      repository.getTopMitreTechniques.mockResolvedValueOnce([{ technique: 'T1059', count: 1234n }])

      const result = await service.getMitreTopTechniques(TENANT_ID)

      expect(result.techniques[0]?.count).toBe(1234)
      expect(typeof result.techniques[0]?.count).toBe('number')
    })

    it('should return empty techniques array when no data', async () => {
      repository.getTopMitreTechniques.mockResolvedValueOnce([])

      const result = await service.getMitreTopTechniques(TENANT_ID)

      expect(result.techniques).toEqual([])
    })
  })

  /* ------------------------------------------------------------------ */
  /* getTopTargetedAssets                                                 */
  /* ------------------------------------------------------------------ */

  describe('getTopTargetedAssets', () => {
    it('should return hostname, alertCount, criticalCount, and lastSeen', async () => {
      const lastSeen = new Date('2026-03-10T12:00:00Z')
      repository.getTopTargetedAssets.mockResolvedValueOnce([
        { hostname: 'web-01', alert_count: 50n, critical_count: 5n, last_seen: lastSeen },
        { hostname: 'db-01', alert_count: 30n, critical_count: 2n, last_seen: lastSeen },
      ])

      const result = await service.getTopTargetedAssets(TENANT_ID)

      expect(result.tenantId).toBe(TENANT_ID)
      expect(result.assets).toEqual([
        { hostname: 'web-01', alertCount: 50, criticalCount: 5, lastSeen },
        { hostname: 'db-01', alertCount: 30, criticalCount: 2, lastSeen },
      ])
    })

    it('should convert bigint fields to number', async () => {
      repository.getTopTargetedAssets.mockResolvedValueOnce([
        {
          hostname: 'app-01',
          alert_count: 9999n,
          critical_count: 100n,
          last_seen: new Date(),
        },
      ])

      const result = await service.getTopTargetedAssets(TENANT_ID)

      expect(typeof result.assets[0]?.alertCount).toBe('number')
      expect(typeof result.assets[0]?.criticalCount).toBe('number')
      expect(result.assets[0]?.alertCount).toBe(9999)
      expect(result.assets[0]?.criticalCount).toBe(100)
    })

    it('should return empty assets array when no data', async () => {
      repository.getTopTargetedAssets.mockResolvedValueOnce([])

      const result = await service.getTopTargetedAssets(TENANT_ID)

      expect(result.assets).toEqual([])
    })
  })

  /* ------------------------------------------------------------------ */
  /* getPipelineHealth                                                    */
  /* ------------------------------------------------------------------ */

  describe('getPipelineHealth', () => {
    it('should return healthy status when lastTestOk is true', async () => {
      repository.findEnabledConnectors.mockResolvedValueOnce([
        {
          type: 'wazuh',
          name: 'Wazuh SIEM',
          lastTestAt: new Date('2026-03-10T10:00:00Z'),
          lastTestOk: true,
          lastError: null,
        },
      ])

      const result = await service.getPipelineHealth(TENANT_ID)

      expect(result.tenantId).toBe(TENANT_ID)
      expect(result.pipelines).toHaveLength(1)
      expect(result.pipelines[0]?.status).toBe('healthy')
      expect(result.pipelines[0]?.name).toBe('Wazuh SIEM')
      expect(result.pipelines[0]?.type).toBe('wazuh')
    })

    it('should return down status when lastTestOk is false', async () => {
      repository.findEnabledConnectors.mockResolvedValueOnce([
        {
          type: 'misp',
          name: 'MISP Feed',
          lastTestAt: new Date('2026-03-10T09:00:00Z'),
          lastTestOk: false,
          lastError: 'Connection refused',
        },
      ])

      const result = await service.getPipelineHealth(TENANT_ID)

      expect(result.pipelines[0]?.status).toBe('down')
      expect(result.pipelines[0]?.lastError).toBe('Connection refused')
    })

    it('should return unknown status when lastTestOk is null', async () => {
      repository.findEnabledConnectors.mockResolvedValueOnce([
        {
          type: 'graylog',
          name: 'Graylog',
          lastTestAt: null,
          lastTestOk: null,
          lastError: null,
        },
      ])

      const result = await service.getPipelineHealth(TENANT_ID)

      expect(result.pipelines[0]?.status).toBe('unknown')
      expect(result.pipelines[0]?.lastChecked).toBeNull()
    })

    it('should handle multiple connectors with mixed statuses', async () => {
      repository.findEnabledConnectors.mockResolvedValueOnce([
        {
          type: 'wazuh',
          name: 'Wazuh',
          lastTestAt: new Date(),
          lastTestOk: true,
          lastError: null,
        },
        {
          type: 'misp',
          name: 'MISP',
          lastTestAt: new Date(),
          lastTestOk: false,
          lastError: 'Timeout',
        },
        {
          type: 'graylog',
          name: 'Graylog',
          lastTestAt: null,
          lastTestOk: null,
          lastError: null,
        },
      ])

      const result = await service.getPipelineHealth(TENANT_ID)

      expect(result.pipelines).toHaveLength(3)
      expect(result.pipelines[0]?.status).toBe('healthy')
      expect(result.pipelines[1]?.status).toBe('down')
      expect(result.pipelines[2]?.status).toBe('unknown')
    })

    it('should handle empty connectors list', async () => {
      repository.findEnabledConnectors.mockResolvedValueOnce([])

      const result = await service.getPipelineHealth(TENANT_ID)

      expect(result.tenantId).toBe(TENANT_ID)
      expect(result.pipelines).toEqual([])
    })
  })
})

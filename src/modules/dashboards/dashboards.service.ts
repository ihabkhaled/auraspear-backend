import { Injectable } from '@nestjs/common';

@Injectable()
export class DashboardsService {
  async getSummary(tenantId: string) {
    return {
      tenantId,
      totalAlerts: 1247,
      criticalAlerts: 23,
      highAlerts: 89,
      openCases: 12,
      meanTimeToDetect: '4m 32s',
      meanTimeToRespond: '18m 15s',
      alertsLast24h: 156,
      resolvedLast24h: 142,
      activeAgents: 247,
      connectedSources: 6,
    };
  }

  async getAlertTrend(tenantId: string, days: number) {
    const trend = [];
    const now = Date.now();
    for (let index = days - 1; index >= 0; index--) {
      const date = new Date(now - index * 86_400_000);
      trend.push({
        date: date.toISOString().split('T')[0],
        critical: Math.floor(Math.random() * 8) + 1,
        high: Math.floor(Math.random() * 20) + 5,
        medium: Math.floor(Math.random() * 40) + 15,
        low: Math.floor(Math.random() * 60) + 20,
      });
    }
    return { tenantId, days, trend };
  }

  async getSeverityDistribution(tenantId: string) {
    return {
      tenantId,
      distribution: [
        { severity: 'critical', count: 23, percentage: 1.8 },
        { severity: 'high', count: 89, percentage: 7.1 },
        { severity: 'medium', count: 412, percentage: 33.0 },
        { severity: 'low', count: 723, percentage: 58.0 },
      ],
    };
  }

  async getMitreTopTechniques(tenantId: string) {
    return {
      tenantId,
      techniques: [
        { id: 'T1059.001', name: 'PowerShell', tactic: 'Execution', count: 145 },
        { id: 'T1110.001', name: 'Password Guessing', tactic: 'Credential Access', count: 98 },
        { id: 'T1071.001', name: 'Web Protocols', tactic: 'Command and Control', count: 87 },
        { id: 'T1548.003', name: 'Sudo and Sudo Caching', tactic: 'Privilege Escalation', count: 65 },
        { id: 'T1190', name: 'Exploit Public-Facing Application', tactic: 'Initial Access', count: 54 },
        { id: 'T1048.003', name: 'DNS Exfiltration', tactic: 'Exfiltration', count: 42 },
        { id: 'T1021.001', name: 'RDP', tactic: 'Lateral Movement', count: 38 },
        { id: 'T1078', name: 'Valid Accounts', tactic: 'Defense Evasion', count: 31 },
      ],
    };
  }

  async getTopTargetedAssets(tenantId: string) {
    return {
      tenantId,
      assets: [
        { hostname: 'web-server-01', alertCount: 87, criticalCount: 5, lastSeen: '2024-12-15T14:30:00Z' },
        { hostname: 'dc-01', alertCount: 65, criticalCount: 8, lastSeen: '2024-12-15T12:30:00Z' },
        { hostname: 'db-server-02', alertCount: 54, criticalCount: 3, lastSeen: '2024-12-15T13:45:00Z' },
        { hostname: 'workstation-042', alertCount: 42, criticalCount: 12, lastSeen: '2024-12-15T15:12:00Z' },
        { hostname: 'endpoint-177', alertCount: 38, criticalCount: 2, lastSeen: '2024-12-15T11:15:00Z' },
      ],
    };
  }

  async getPipelineHealth(tenantId: string) {
    return {
      tenantId,
      pipelines: [
        { name: 'Wazuh Ingestion', status: 'healthy', eps: 1247, lag: '0s' },
        { name: 'Graylog Processing', status: 'healthy', eps: 890, lag: '2s' },
        { name: 'OpenSearch Indexing', status: 'healthy', eps: 2100, lag: '1s' },
        { name: 'MISP Feed Sync', status: 'healthy', eps: 12, lag: '0s' },
        { name: 'Shuffle Automation', status: 'degraded', eps: 45, lag: '15s' },
      ],
    };
  }
}

import { Injectable, Logger } from '@nestjs/common';

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

interface ServiceHealthResult {
  service: string;
  status: 'healthy' | 'degraded' | 'down' | 'maintenance';
  latencyMs: number;
  version: string;
  uptime: number;
  lastCheck: string;
  details?: Record<string, unknown>;
}

interface OverallHealth {
  status: 'healthy' | 'degraded' | 'down';
  timestamp: string;
  version: string;
  services: {
    total: number;
    healthy: number;
    degraded: number;
    down: number;
  };
}

@Injectable()
export class HealthService {
  private readonly logger = new Logger(HealthService.name);

  /**
   * GET /health
   * Overall system health -- aggregates status of all services.
   * This endpoint is public (no auth required).
   */
  async getOverallHealth(): Promise<OverallHealth> {
    const services = await Promise.all([
      this.checkWazuh(),
      this.checkIndexer(),
      this.checkLogstash(),
      this.checkMisp(),
    ]);

    const healthy = services.filter((s) => s.status === 'healthy').length;
    const degraded = services.filter((s) => s.status === 'degraded').length;
    const down = services.filter((s) => s.status === 'down').length;

    let overallStatus: 'healthy' | 'degraded' | 'down' = 'healthy';
    if (down > 0) {
      overallStatus = 'down';
    } else if (degraded > 0) {
      overallStatus = 'degraded';
    }

    return {
      status: overallStatus,
      timestamp: new Date().toISOString(),
      version: '1.0.0',
      services: {
        total: services.length,
        healthy,
        degraded,
        down,
      },
    };
  }

  /**
   * Check Wazuh Manager connectivity and return health status.
   * In production, would make an HTTP call to the Wazuh API.
   */
  async checkWazuh(): Promise<ServiceHealthResult> {
    const startTime = Date.now();

    // Simulated health check
    const latencyMs = this.simulateLatency(8, 45);

    this.logger.debug(`Wazuh health check completed in ${latencyMs}ms`);

    return {
      service: 'Wazuh Manager',
      status: 'healthy',
      latencyMs,
      version: '4.9.2',
      uptime: 99.97,
      lastCheck: new Date().toISOString(),
      details: {
        activationAgents: 47,
        totalAgents: 52,
        eventsPerSecond: 2450,
        clusterStatus: 'green',
        ruleset: '4.9.2-r1',
        queueUtilization: '23%',
      },
    };
  }

  /**
   * Check OpenSearch / Wazuh Indexer connectivity and return health status.
   * In production, would call the OpenSearch _cluster/health API.
   */
  async checkIndexer(): Promise<ServiceHealthResult> {
    const latencyMs = this.simulateLatency(5, 30);

    this.logger.debug(`Indexer health check completed in ${latencyMs}ms`);

    return {
      service: 'Wazuh Indexer (OpenSearch)',
      status: 'healthy',
      latencyMs,
      version: '2.14.0',
      uptime: 99.95,
      lastCheck: new Date().toISOString(),
      details: {
        clusterName: 'auraspear-prod',
        clusterStatus: 'green',
        numberOfNodes: 3,
        numberOfDataNodes: 3,
        activeShards: 142,
        activePrimaryShards: 71,
        relocatingShards: 0,
        unassignedShards: 0,
        pendingTasks: 0,
        diskUsage: '67.3%',
        heapUsage: '54.2%',
        indexCount: 24,
        documentCount: '18.4M',
        storeSizeGb: 42.7,
      },
    };
  }

  /**
   * Check Logstash connectivity and return health status.
   * In production, would call the Logstash monitoring API.
   */
  async checkLogstash(): Promise<ServiceHealthResult> {
    const latencyMs = this.simulateLatency(10, 50);

    this.logger.debug(`Logstash health check completed in ${latencyMs}ms`);

    return {
      service: 'Logstash',
      status: 'healthy',
      latencyMs,
      version: '8.12.2',
      uptime: 99.91,
      lastCheck: new Date().toISOString(),
      details: {
        pipelineWorkers: 4,
        pipelineBatchSize: 125,
        eventsIn: 2450,
        eventsOut: 2448,
        eventsFiltered: 2,
        queueType: 'persisted',
        queueCapacity: '1GB',
        queueUtilization: '12%',
        cpuPercent: 34,
        heapUsedPercent: 61,
        uptime: '14d 7h 23m',
      },
    };
  }

  /**
   * Check MISP connectivity and return health status.
   * In production, would call the MISP REST API.
   */
  async checkMisp(): Promise<ServiceHealthResult> {
    const latencyMs = this.simulateLatency(15, 80);

    this.logger.debug(`MISP health check completed in ${latencyMs}ms`);

    return {
      service: 'MISP',
      status: 'healthy',
      latencyMs,
      version: '2.4.185',
      uptime: 99.88,
      lastCheck: new Date().toISOString(),
      details: {
        organizationCount: 12,
        eventCount: 1847,
        attributeCount: 24563,
        userCount: 8,
        correlationsEnabled: true,
        feedsActive: 6,
        feedsTotal: 8,
        lastFeedPull: '2026-03-01T14:00:00Z',
        warninglistEnabled: true,
        taxonomyCount: 15,
        galaxyCount: 42,
      },
    };
  }

  /**
   * Simulate realistic network latency for mock health checks.
   */
  private simulateLatency(minMs: number, maxMs: number): number {
    return Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs;
  }
}

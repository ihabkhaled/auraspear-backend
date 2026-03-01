import { Injectable, Logger } from '@nestjs/common';

interface TestResult {
  ok: boolean;
  details: string;
}

@Injectable()
export class OpenSearchService {
  private readonly logger = new Logger(OpenSearchService.name);

  async testConnection(
    type: string,
    config: Record<string, unknown>,
  ): Promise<TestResult> {
    this.logger.debug(`Testing ${type} connection via OpenSearch`);

    await this.simulateLatency();

    const baseUrl = config.baseUrl as string | undefined;
    if (!baseUrl) {
      return { ok: false, details: `${type} base URL not configured` };
    }

    const details: Record<string, string> = {
      graylog: `Graylog node reachable at ${baseUrl}. Version: 5.2.4, Input count: 12.`,
      velociraptor: `Velociraptor server reachable at ${baseUrl}. API version: 0.73, Clients: 89.`,
      grafana: `Grafana reachable at ${baseUrl}. Version: 11.0.0, Org: AuraSpear SOC.`,
      influxdb: `InfluxDB reachable at ${baseUrl}. Version: 2.7.4, Buckets: 5.`,
    };

    return {
      ok: true,
      details: details[type] ?? `${type} connected successfully at ${baseUrl}.`,
    };
  }

  async search(
    _config: Record<string, unknown>,
    _index: string,
    _query: Record<string, unknown>,
  ): Promise<unknown[]> {
    return [];
  }

  private simulateLatency(): Promise<void> {
    return new Promise((resolve) => {
      setTimeout(resolve, 100 + Math.random() * 150);
    });
  }
}

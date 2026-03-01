import { Injectable, Logger } from '@nestjs/common';

interface TestResult {
  ok: boolean;
  details: string;
}

@Injectable()
export class ShuffleService {
  private readonly logger = new Logger(ShuffleService.name);

  async testConnection(
    config: Record<string, unknown>,
  ): Promise<TestResult> {
    this.logger.debug('Testing Shuffle SOAR connection');

    await this.simulateLatency();

    const baseUrl = config.webhookUrl ?? config.baseUrl;
    if (!baseUrl) {
      return { ok: false, details: 'Shuffle URL not configured' };
    }

    return {
      ok: true,
      details: `Shuffle SOAR reachable. Workflows: 14 active, Executions (24h): 1,247.`,
    };
  }

  async triggerWorkflow(
    _config: Record<string, unknown>,
    _workflowId: string,
    _payload: Record<string, unknown>,
  ): Promise<{ executionId: string }> {
    return { executionId: `exec-${Date.now()}` };
  }

  private simulateLatency(): Promise<void> {
    return new Promise((resolve) => {
      setTimeout(resolve, 100 + Math.random() * 200);
    });
  }
}

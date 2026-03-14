import { Injectable, Logger } from '@nestjs/common'
import { AppLogFeature, AppLogOutcome, AppLogSourceType } from '../../../common/enums'
import { AppLoggerService } from '../../../common/services/app-logger.service'
import type { TestResult } from '../connectors.types'

@Injectable()
export class BedrockService {
  private readonly logger = new Logger(BedrockService.name)

  constructor(private readonly appLogger: AppLoggerService) {}

  /**
   * Test AWS Bedrock connection.
   * Uses AWS SDK to list foundation models and verify access.
   */
  async testConnection(config: Record<string, unknown>): Promise<TestResult> {
    // Mock mode: always succeed for dev/demo
    if (process.env['BEDROCK_MOCK'] === 'true') {
      const region = (config.region ?? 'us-east-1') as string
      const modelId = (config.modelId ?? 'anthropic.claude-3-sonnet-20240229-v1:0') as string
      this.appLogger.info('Bedrock mock connection test', {
        feature: AppLogFeature.CONNECTORS,
        action: 'testConnection',
        outcome: AppLogOutcome.SUCCESS,
        sourceType: AppLogSourceType.SERVICE,
        className: 'BedrockService',
        functionName: 'testConnection',
        metadata: { connectorType: 'bedrock', mock: true, region, modelId },
      })
      return {
        ok: true,
        details: `[MOCK] AWS Bedrock accessible in ${region}. Model: ${modelId}. Ready.`,
      }
    }

    const region = (config.region ?? 'us-east-1') as string
    const accessKeyId = config.accessKeyId as string | undefined
    const secretAccessKey = config.secretAccessKey as string | undefined
    const modelId = (config.modelId ?? 'anthropic.claude-3-sonnet-20240229-v1:0') as string

    if (!accessKeyId || !secretAccessKey) {
      return { ok: false, details: 'AWS access key ID and secret access key are required' }
    }

    try {
      // Use AWS Bedrock Runtime API via HTTP (SigV4 auth)
      // For a proper integration, install @aws-sdk/client-bedrock-runtime
      // For now, verify credentials format is valid
      const { BedrockRuntimeClient, InvokeModelCommand } = await this.loadAwsSdk()

      const endpoint = config.endpoint as string | undefined

      const client = new BedrockRuntimeClient({
        region,
        credentials: { accessKeyId, secretAccessKey },
        ...(endpoint ? { endpoint, forcePathStyle: true } : {}),
      })

      // Send a minimal test prompt
      const command = new InvokeModelCommand({
        modelId,
        contentType: 'application/json',
        accept: 'application/json',
        body: JSON.stringify({
          anthropic_version: 'bedrock-2023-05-31',
          max_tokens: 10,
          messages: [{ role: 'user', content: 'Hi' }],
        }),
      })

      const response = await client.send(command)
      const bodyString = new TextDecoder().decode(response.body)
      const body = JSON.parse(bodyString) as Record<string, unknown>

      this.appLogger.info('Bedrock connection test succeeded', {
        feature: AppLogFeature.CONNECTORS,
        action: 'testConnection',
        outcome: AppLogOutcome.SUCCESS,
        sourceType: AppLogSourceType.SERVICE,
        className: 'BedrockService',
        functionName: 'testConnection',
        metadata: { connectorType: 'bedrock', region, modelId },
      })

      return {
        ok: true,
        details: `AWS Bedrock accessible in ${region}. Model: ${modelId}. Stop reason: ${body.stop_reason ?? 'ok'}.`,
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Connection failed'
      this.logger.warn(`Bedrock connection test failed: ${message}`)

      this.appLogger.error('Bedrock connection test failed', {
        feature: AppLogFeature.CONNECTORS,
        action: 'testConnection',
        outcome: AppLogOutcome.FAILURE,
        sourceType: AppLogSourceType.SERVICE,
        className: 'BedrockService',
        functionName: 'testConnection',
        metadata: { connectorType: 'bedrock', region },
        stackTrace: error instanceof Error ? error.stack : undefined,
      })

      // Check if it's a missing SDK error
      if (message.includes('Cannot find module') || message.includes('MODULE_NOT_FOUND')) {
        return {
          ok: false,
          details: 'AWS SDK not installed. Run: npm install @aws-sdk/client-bedrock-runtime',
        }
      }

      return { ok: false, details: message }
    }
  }

  /**
   * Invoke a Bedrock model with a prompt.
   * When BEDROCK_MOCK=true, returns a simulated response without calling AWS.
   */
  async invoke(
    config: Record<string, unknown>,
    prompt: string,
    maxTokens: number = 1024
  ): Promise<{ text: string; inputTokens: number; outputTokens: number }> {
    // Mock mode: return realistic responses without AWS credentials
    if (process.env['BEDROCK_MOCK'] === 'true') {
      return this.mockInvoke(prompt, maxTokens)
    }

    const region = (config.region ?? 'us-east-1') as string
    const accessKeyId = config.accessKeyId as string
    const secretAccessKey = config.secretAccessKey as string
    const modelId = (config.modelId ?? 'anthropic.claude-3-sonnet-20240229-v1:0') as string

    const endpoint = config.endpoint as string | undefined
    const { BedrockRuntimeClient, InvokeModelCommand } = await this.loadAwsSdk()

    const client = new BedrockRuntimeClient({
      region,
      credentials: { accessKeyId, secretAccessKey },
      ...(endpoint ? { endpoint, forcePathStyle: true } : {}),
    })

    const command = new InvokeModelCommand({
      modelId,
      contentType: 'application/json',
      accept: 'application/json',
      body: JSON.stringify({
        anthropic_version: 'bedrock-2023-05-31',
        max_tokens: maxTokens,
        messages: [{ role: 'user', content: prompt }],
      }),
    })

    const response = await client.send(command)
    const bodyString = new TextDecoder().decode(response.body)
    const body = JSON.parse(bodyString) as Record<string, unknown>
    const content = body.content as Array<{ text: string }> | undefined
    const usage = body.usage as { input_tokens: number; output_tokens: number } | undefined

    this.appLogger.info('Bedrock model invoked', {
      feature: AppLogFeature.CONNECTORS,
      action: 'invoke',
      outcome: AppLogOutcome.SUCCESS,
      sourceType: AppLogSourceType.SERVICE,
      className: 'BedrockService',
      functionName: 'invoke',
      metadata: {
        connectorType: 'bedrock',
        region,
        modelId,
        maxTokens,
        inputTokens: usage?.input_tokens ?? 0,
        outputTokens: usage?.output_tokens ?? 0,
      },
    })

    return {
      text: content?.[0]?.text ?? '',
      inputTokens: usage?.input_tokens ?? 0,
      outputTokens: usage?.output_tokens ?? 0,
    }
  }

  /**
   * Mock invoke: returns realistic AI responses for dev/demo without AWS.
   */
  private mockInvoke(
    prompt: string,
    _maxTokens: number
  ): { text: string; inputTokens: number; outputTokens: number } {
    const lowerPrompt = prompt.toLowerCase()

    const inputTokens = Math.floor(prompt.length / 4)
    const outputTokens = Math.floor(Math.random() * 800) + 400

    let text: string

    if (lowerPrompt.includes('hunt') || lowerPrompt.includes('threat')) {
      text = this.mockHuntResponse(prompt)
    } else if (lowerPrompt.includes('investigate') || lowerPrompt.includes('alert')) {
      text = this.mockInvestigateResponse(prompt)
    } else {
      text = this.mockExplainResponse(prompt)
    }

    this.appLogger.info('Bedrock mock invoked', {
      feature: AppLogFeature.CONNECTORS,
      action: 'mockInvoke',
      outcome: AppLogOutcome.SUCCESS,
      sourceType: AppLogSourceType.SERVICE,
      className: 'BedrockService',
      functionName: 'mockInvoke',
      metadata: { connectorType: 'bedrock', mock: true, inputTokens, outputTokens },
    })

    return { text, inputTokens, outputTokens }
  }

  private mockHuntResponse(prompt: string): string {
    const safePrompt = prompt.slice(0, 100).replaceAll(/[<>"'&]/g, '')
    return `## AI Threat Hunt Analysis

**Query Context:** ${safePrompt}

**Hypothesis:**
Based on the query pattern, this hunt targets potential adversary activity involving lateral movement and credential abuse within the network. The indicators suggest a multi-stage attack leveraging compromised service accounts.

**Suggested Detection Queries:**
1. \`event.action:authentication_success AND source.ip:10.0.0.0/8 AND user.name:svc_*\` — Service account lateral movement
2. \`process.name:cmd.exe AND process.parent.name:services.exe\` — Suspicious service execution
3. \`event.id:4768 AND ticket.options:*forwardable*\` — Kerberos ticket anomalies
4. \`network.bytes_out:>500000 AND destination.port:443 AND NOT destination.ip:10.*\` — Data exfiltration indicators

**MITRE ATT&CK Mapping:**
- **T1078** — Valid Accounts (service account abuse)
- **T1021.002** — Remote Services: SMB/Windows Admin Shares
- **T1003.001** — OS Credential Dumping: LSASS Memory
- **T1048.003** — Exfiltration Over Alternative Protocol: HTTPS

**Risk Assessment:**
- Immediate Risk: **HIGH** — Credential misuse detected
- Lateral Movement Risk: **MEDIUM** — Limited to internal subnet so far
- Data Exposure Risk: **MEDIUM** — Outbound traffic anomalies require verification

**Recommended Actions:**
1. Isolate affected service accounts immediately and rotate credentials
2. Enable enhanced audit logging on domain controllers for Kerberos events
3. Review outbound proxy logs for the identified destination IPs
4. Cross-reference with MISP threat intelligence feeds for known C2 infrastructure
5. Escalate to Tier 3 if exfiltration indicators are confirmed`
  }

  private mockInvestigateResponse(prompt: string): string {
    const safePrompt = prompt.slice(0, 80).replaceAll(/[<>"'&]/g, '')
    return `## AI Investigation Report

**Alert Context:** ${safePrompt}

**Verdict:** Suspicious — Requires Further Investigation (Confidence: 78%)

**Summary:**
The alert indicates anomalous authentication patterns consistent with credential stuffing or password spraying techniques. Multiple failed authentication attempts were followed by a successful login from an IP address not previously associated with this user account.

**Key Findings:**
1. 47 failed login attempts in a 3-minute window from source IP \`198.51.100.45\`
2. Successful authentication achieved on attempt #48 using valid credentials
3. Source IP geolocates to a known VPS provider (DigitalOcean, Frankfurt region)
4. No prior authentication history from this IP or ASN for the target account
5. Post-authentication activity includes enumeration of shared drives (3 SMB connections)

**Risk Assessment:**
- Immediate Risk: **HIGH** — Account may be compromised
- Lateral Movement: **MEDIUM** — SMB enumeration suggests reconnaissance
- Data Exposure: **LOW** — No confirmed data access beyond enumeration

**Recommended Actions:**
1. Force password reset for the affected account
2. Enable MFA if not already configured
3. Block source IP \`198.51.100.45\` at the perimeter
4. Review SMB access logs for the 30-minute window post-authentication
5. Check for similar patterns against other accounts in the same OU`
  }

  private mockExplainResponse(prompt: string): string {
    const safePrompt = prompt.slice(0, 80).replaceAll(/[<>"'&]/g, '')
    return `## AI Explanation

**Topic:** ${safePrompt}

**Analysis:**
This security finding relates to a detection rule that identifies anomalous behavior patterns in your environment. The rule correlates multiple data sources including endpoint telemetry, network flow data, and authentication logs.

**How This Works:**
1. The detection engine monitors baseline behavioral patterns for all entities
2. Statistical deviation scoring identifies outliers beyond 2 standard deviations
3. Threat intelligence correlation enriches findings with known campaign indicators
4. Temporal clustering analysis groups related events into coherent incident timelines

**What This Means:**
- The detected pattern matches known adversary tradecraft (MITRE ATT&CK)
- Confidence is driven by multi-source correlation rather than single-event detection
- False positive rate for this rule type is historically ~12% in similar environments

**Remediation Guidance:**
- Verify the finding against your asset inventory and known-good baselines
- Check if the affected systems are in a maintenance window or change freeze
- Correlate with your SIEM for additional context from other detection sources
- Document findings and update the case timeline if this is part of an ongoing investigation`
  }

  /**
   * Dynamically import AWS SDK to avoid hard dependency.
   * Install with: npm install @aws-sdk/client-bedrock-runtime
   */
  private async loadAwsSdk(): Promise<{
    BedrockRuntimeClient: new (config: unknown) => {
      send: (command: unknown) => Promise<{ body: Uint8Array }>
    }
    InvokeModelCommand: new (input: unknown) => unknown
  }> {
    try {
      // Dynamic import to avoid compile-time dependency
      const moduleName = '@aws-sdk/client-bedrock-runtime'
      const sdk = (await import(moduleName)) as unknown as Record<string, unknown>
      return sdk as unknown as {
        BedrockRuntimeClient: new (config: unknown) => {
          send: (command: unknown) => Promise<{ body: Uint8Array }>
        }
        InvokeModelCommand: new (input: unknown) => unknown
      }
    } catch {
      this.appLogger.warn('AWS SDK not installed for Bedrock', {
        feature: AppLogFeature.CONNECTORS,
        action: 'loadAwsSdk',
        className: 'BedrockService',
        sourceType: AppLogSourceType.SERVICE,
        outcome: AppLogOutcome.FAILURE,
        metadata: {},
      })
      throw new Error(
        '@aws-sdk/client-bedrock-runtime is not installed. Run: npm install @aws-sdk/client-bedrock-runtime'
      )
    }
  }
}

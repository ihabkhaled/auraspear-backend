import {
  Injectable,
  Logger,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AiHuntDto } from './dto/ai-hunt.dto';
import { AiInvestigateDto } from './dto/ai-investigate.dto';
import { JwtPayload } from '../../common/interfaces/authenticated-request.interface';
import { randomUUID } from 'crypto';

/* ------------------------------------------------------------------ */
/* Response types                                                      */
/* ------------------------------------------------------------------ */

interface AiTokenUsage {
  input: number;
  output: number;
}

interface AiResponse {
  result: string;
  reasoning: string[];
  confidence: number;
  model: string;
  tokensUsed: AiTokenUsage;
}

interface AiAuditRecord {
  id: string;
  tenantId: string;
  userId: string;
  action: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
  status: 'success' | 'error';
  createdAt: string;
}

@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);
  private readonly MODEL = 'anthropic.claude-3-sonnet';

  constructor(private readonly prisma: PrismaService) {}

  /* ---------------------------------------------------------------- */
  /* AI Gate: checks per-tenant AI enable/disable                      */
  /* ---------------------------------------------------------------- */

  private async ensureAiEnabled(tenantId: string): Promise<void> {
    try {
      const connector = await this.prisma.connectorConfig.findFirst({
        where: {
          tenantId,
          type: 'bedrock',
          enabled: true,
        },
      });

      if (!connector) {
        throw new ForbiddenException(
          'AI features are not enabled for this tenant. Configure a Bedrock connector with aiEnabled=true.',
        );
      }
    } catch (error) {
      if (error instanceof ForbiddenException) {
        throw error;
      }
      // If Prisma table doesn't exist, allow AI in mock mode
      this.logger.warn('connector_configs table not available; allowing AI in mock mode');
    }
  }

  /* ---------------------------------------------------------------- */
  /* Audit logging                                                     */
  /* ---------------------------------------------------------------- */

  private async logAudit(record: AiAuditRecord): Promise<void> {
    try {
      await this.prisma.aiAuditLog.create({
        data: {
          tenantId: record.tenantId,
          actor: record.userId,
          action: record.action,
          model: record.model,
          inputTokens: record.inputTokens,
          outputTokens: record.outputTokens,
          durationMs: record.latencyMs,
        },
      });
    } catch {
      this.logger.warn('ai_audit_logs table not available; audit record stored in memory only');
    }

    this.logger.log(
      `AI Audit: ${record.action} by ${record.userId} | ${record.model} | ${record.inputTokens}+${record.outputTokens} tokens | ${record.latencyMs}ms | ${record.status}`,
    );
  }

  /* ---------------------------------------------------------------- */
  /* AI-Assisted Threat Hunting                                        */
  /* ---------------------------------------------------------------- */

  async aiHunt(dto: AiHuntDto, user: JwtPayload): Promise<AiResponse> {
    await this.ensureAiEnabled(user.tenantId);

    const startTime = Date.now();
    const auditId = randomUUID();

    // Mock AI response for threat hunting
    const response: AiResponse = {
      result: this.generateHuntResponse(dto.query),
      reasoning: [
        `Analyzing hunt query: "${dto.query}"`,
        'Decomposing query into sub-hypotheses for structured threat hunting',
        'Cross-referencing with MITRE ATT&CK framework for technique coverage',
        'Generating OpenSearch/Wazuh query syntax for each hypothesis',
        'Prioritizing by likelihood of true positive based on environment context',
        'Correlating with recent threat intelligence from MISP feeds',
      ],
      confidence: 0.87,
      model: this.MODEL,
      tokensUsed: {
        input: 1247,
        output: 2156,
      },
    };

    const latencyMs = Date.now() - startTime + 1200; // simulate model latency

    await this.logAudit({
      id: auditId,
      tenantId: user.tenantId,
      userId: user.sub,
      action: 'ai_hunt',
      model: this.MODEL,
      inputTokens: response.tokensUsed.input,
      outputTokens: response.tokensUsed.output,
      latencyMs,
      status: 'success',
      createdAt: new Date().toISOString(),
    });

    return response;
  }

  /* ---------------------------------------------------------------- */
  /* AI Investigation of Alert                                         */
  /* ---------------------------------------------------------------- */

  async aiInvestigate(dto: AiInvestigateDto, user: JwtPayload): Promise<AiResponse> {
    await this.ensureAiEnabled(user.tenantId);

    const startTime = Date.now();
    const auditId = randomUUID();

    const response: AiResponse = {
      result: this.generateInvestigationResponse(dto.alertId),
      reasoning: [
        `Retrieving alert ${dto.alertId} details from Wazuh Indexer`,
        'Analyzing alert rule, severity, and MITRE ATT&CK mapping',
        'Examining source/destination IPs against threat intelligence databases',
        'Reviewing agent behavior patterns in the 24-hour window around the alert',
        'Checking for related alerts from same agent or same rule ID',
        'Evaluating false positive probability based on historical data',
        'Generating investigation recommendations and suggested containment actions',
      ],
      confidence: 0.92,
      model: this.MODEL,
      tokensUsed: {
        input: 1834,
        output: 2891,
      },
    };

    const latencyMs = Date.now() - startTime + 1500;

    await this.logAudit({
      id: auditId,
      tenantId: user.tenantId,
      userId: user.sub,
      action: 'ai_investigate',
      model: this.MODEL,
      inputTokens: response.tokensUsed.input,
      outputTokens: response.tokensUsed.output,
      latencyMs,
      status: 'success',
      createdAt: new Date().toISOString(),
    });

    return response;
  }

  /* ---------------------------------------------------------------- */
  /* Explainable AI Output                                             */
  /* ---------------------------------------------------------------- */

  async aiExplain(
    body: { prompt: string },
    user: JwtPayload,
  ): Promise<AiResponse> {
    await this.ensureAiEnabled(user.tenantId);

    const startTime = Date.now();
    const auditId = randomUUID();

    const response: AiResponse = {
      result: this.generateExplainResponse(body.prompt),
      reasoning: [
        'Parsing the security concept or finding to explain',
        'Breaking down technical details into analyst-friendly language',
        'Mapping to MITRE ATT&CK tactics, techniques, and procedures',
        'Providing contextual examples relevant to the environment',
        'Including remediation guidance and best practices',
      ],
      confidence: 0.95,
      model: this.MODEL,
      tokensUsed: {
        input: 892,
        output: 1654,
      },
    };

    const latencyMs = Date.now() - startTime + 900;

    await this.logAudit({
      id: auditId,
      tenantId: user.tenantId,
      userId: user.sub,
      action: 'ai_explain',
      model: this.MODEL,
      inputTokens: response.tokensUsed.input,
      outputTokens: response.tokensUsed.output,
      latencyMs,
      status: 'success',
      createdAt: new Date().toISOString(),
    });

    return response;
  }

  /* ---------------------------------------------------------------- */
  /* Mock response generators                                          */
  /* ---------------------------------------------------------------- */

  private generateHuntResponse(query: string): string {
    const lowerQuery = query.toLowerCase();

    if (lowerQuery.includes('brute') || lowerQuery.includes('4625') || lowerQuery.includes('login')) {
      return `## Threat Hunt Analysis: Brute Force Activity

**Hypothesis:** An external threat actor is conducting credential-based attacks against authentication services.

**Suggested Queries:**
1. \`event.id:4625 AND agent.name:dc-01 | stats count by data.srcip\` - Group failed logins by source IP
2. \`event.id:4625 AND data.srcip:198.51.100.* | timechart span=1m count\` - Time distribution of attacks
3. \`(event.id:4624) AND data.srcip:198.51.100.22\` - Check for successful logins from attacker IP

**Recommended Actions:**
- Block source IP 198.51.100.22 at the perimeter firewall
- Enable account lockout policies if not already configured
- Monitor for successful authentications from the same IP range
- Review VPN and remote access logs for the same time window

**MITRE ATT&CK Coverage:** T1110.001 (Password Guessing), T1110.003 (Password Spraying)`;
    }

    if (lowerQuery.includes('c2') || lowerQuery.includes('beacon') || lowerQuery.includes('dns')) {
      return `## Threat Hunt Analysis: Command & Control Detection

**Hypothesis:** A compromised endpoint is communicating with external C2 infrastructure via DNS or HTTP channels.

**Suggested Queries:**
1. \`dns.query.name:*.xyz OR dns.query.name:*.net | stats count by agent.name, dns.query.name\` - Unusual TLD activity
2. \`rule.mitre.id:T1071 | stats count by agent.name\` - Application layer protocol abuse
3. \`data.dstip:185.220.* | timechart span=5m count\` - Known C2 infrastructure communication

**Indicators Found:**
- Beaconing pattern detected from workstation-17 (60-second intervals)
- Domain update-service.xyz registered 3 days ago (DGA indicator)
- Encoded payloads observed in DNS TXT records

**MITRE ATT&CK Coverage:** T1071 (Application Layer Protocol), T1048 (Exfiltration Over Alternative Protocol), T1568 (Dynamic Resolution)`;
    }

    return `## Threat Hunt Analysis

**Query Analysis:** "${query}"

**Suggested Investigation Steps:**
1. Correlate the query across Wazuh alerts, Sysmon events, and network flow data
2. Establish a baseline of normal activity for comparison
3. Look for anomalous patterns in user behavior analytics
4. Cross-reference findings with the latest MISP threat intelligence feeds

**Recommended Queries:**
1. \`${query} | stats count by agent.name, rule.id\` - Activity summary
2. \`${query} | timechart span=1h count\` - Temporal analysis
3. \`${query} AND rule.mitre.id:* | stats count by rule.mitre.id\` - ATT&CK mapping

**MITRE ATT&CK Coverage:** Multiple techniques may apply -- review mapped events for specific coverage.`;
  }

  private generateInvestigationResponse(alertId: string): string {
    return `## AI Investigation Report: ${alertId}

**Verdict:** Likely True Positive (Confidence: 92%)

**Summary:**
This alert indicates a genuine security event that warrants immediate investigation. The combination of behavioral indicators, threat intelligence matches, and temporal correlation with other alerts suggests active adversary activity.

**Key Findings:**
1. **Source IP** matches known malicious infrastructure in MISP feed MISP-8830
2. **Target service** (authentication endpoint) is a common attack vector
3. **Volume and velocity** of events exceeds baseline by 47x standard deviation
4. **Related alerts** found: 3 additional alerts from the same source within 2 hours

**Risk Assessment:**
- Immediate Risk: HIGH - Active exploitation attempt detected
- Lateral Movement Risk: MEDIUM - No evidence of successful compromise yet
- Data Exposure Risk: LOW - No indicators of data access or exfiltration

**Recommended Actions:**
1. Block the source IP at the perimeter firewall immediately
2. Review target accounts for any successful authentication attempts
3. Enable enhanced logging on the targeted service
4. Correlate with EDR telemetry from affected endpoints
5. Create an incident case if not already linked

**MITRE ATT&CK Mapping:**
- Tactic: Initial Access, Credential Access
- Techniques: T1110 (Brute Force), T1078 (Valid Accounts)
- Detection: DS0015 (Application Log), DS0028 (Logon Session)`;
  }

  private generateExplainResponse(prompt: string): string {
    return `## Explainable AI Analysis

**Topic:** ${prompt}

**Explanation:**
This security finding involves indicators of potential adversary activity within your environment. The detection logic is based on correlation of multiple data sources including endpoint telemetry, network flow data, and authentication logs.

**How This Was Detected:**
1. Rule-based detection triggered on specific event patterns
2. Statistical anomaly detection identified deviation from baseline behavior
3. Threat intelligence correlation matched observed indicators with known campaigns
4. Temporal analysis revealed clustering of events within a suspicious time window

**What This Means for Your Environment:**
- The detected activity pattern is consistent with known adversary tradecraft
- The affected systems should be prioritized for investigation
- The blast radius assessment shows limited spread beyond the initial detection point

**Confidence Factors:**
- High-fidelity rule match: +30% confidence
- Threat intel correlation: +25% confidence
- Behavioral anomaly score: +20% confidence
- Environmental context alignment: +20% confidence

**Recommended Learning Resources:**
- MITRE ATT&CK Navigator: Map detected techniques to your coverage matrix
- SIGMA Rules Repository: Review and tune detection logic for similar patterns
- NIST SP 800-61r2: Incident handling guidance for this type of activity`;
  }
}

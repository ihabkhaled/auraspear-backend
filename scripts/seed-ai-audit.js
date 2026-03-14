/* eslint-disable */
// Seed script: 500+ AiAuditLog entries per tenant
const { PrismaClient } = require('@prisma/client')
const crypto = require('crypto')
const prisma = new PrismaClient()

const TENANT_SLUGS = ['aura-finance', 'aura-health', 'aura-enterprise']

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)]
const rand = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min
const uuid = () => crypto.randomUUID()
const daysAgo = (d) => new Date(Date.now() - d * 86400000 - rand(0, 86400) * 1000)

const ACTORS = [
  'analyst@auraspear.io', 'hunter@auraspear.io', 'soc-lead@auraspear.io',
  'admin@auraspear.io', 'responder@auraspear.io', 'tier2@auraspear.io',
  'tier3@auraspear.io', 'incident@auraspear.io',
]
const ACTIONS = ['ai_hunt', 'ai_hunt', 'ai_hunt', 'ai_investigate', 'ai_investigate', 'ai_explain']
const MODELS = [
  'anthropic.claude-3-sonnet', 'anthropic.claude-3-sonnet', 'anthropic.claude-3-sonnet',
  'anthropic.claude-3-haiku', 'rule-based',
]

const HUNT_PROMPTS = [
  'Look for brute force login attempts from external IPs in the last 24 hours',
  'Find evidence of lateral movement using SMB and WMI across internal subnets',
  'Detect DNS tunneling or suspicious TXT record queries to newly registered domains',
  'Hunt for PowerShell encoded commands executed by non-admin users',
  'Search for C2 beacon activity with regular interval outbound connections',
  'Identify privilege escalation attempts via service account abuse',
  'Look for data exfiltration over HTTPS to uncommon destinations',
  'Find evidence of persistence via scheduled tasks or registry Run keys',
  'Detect suspicious process injection using WriteProcessMemory',
  'Hunt for credential harvesting tools like Mimikatz or LaZagne',
  'Search for ransomware precursors: shadow copy deletion and mass file renaming',
  'Look for anomalous SSH login patterns from unexpected geolocations',
  'Detect web shell activity on public-facing web servers',
  'Hunt for supply chain attack indicators in recently updated packages',
  'Search for Kerberoasting or AS-REP roasting activity in Active Directory',
  'Find evidence of NTLM relay attacks in the authentication logs',
  'Detect living-off-the-land binary (LOLBin) execution chains',
  'Hunt for email-based initial access vectors via macro-enabled documents',
  'Look for unusual outbound traffic on non-standard ports from servers',
  'Detect unauthorized VPN connections from new device fingerprints',
  'Search for MFA bypass attempts or session token theft',
  'Hunt for cloud infrastructure reconnaissance via API enumeration',
  'Find evidence of container escape attempts in Kubernetes clusters',
  'Detect insider threat indicators via abnormal data access patterns',
  'Look for DNS over HTTPS (DoH) tunneling to bypass security controls',
]

const HUNT_RESPONSES = [
  `## Threat Hunt Analysis: Brute Force Activity

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

**MITRE ATT&CK Coverage:** T1110.001 (Password Guessing), T1110.003 (Password Spraying)`,

  `## Threat Hunt Analysis: Lateral Movement via SMB/WMI

**Hypothesis:** Compromised credentials are being used for lateral movement across the internal network.

**Suggested Queries:**
1. \`event.action:logon AND logon.type:3 AND source.ip:10.0.0.0/8\` - Network logons from internal
2. \`process.name:wmic.exe AND process.args:*process*call*create*\` - WMI remote process creation
3. \`event.action:share_access AND share.name:(ADMIN$ OR C$)\` - Admin share access attempts

**Key Findings:**
- 12 unique source IPs performing lateral movement in the last 6 hours
- 3 service accounts (svc_backup, svc_deploy, svc_monitor) with anomalous login patterns
- Admin share access spike from workstation-23 (42 connections in 10 minutes)

**MITRE ATT&CK Coverage:** T1021.002 (SMB/Windows Admin Shares), T1047 (WMI)

**Recommended Actions:**
- Immediately rotate credentials for identified service accounts
- Isolate workstation-23 pending investigation
- Enable Enhanced Audit Policy for SMB share access`,

  `## Threat Hunt Analysis: DNS Tunneling Detection

**Hypothesis:** A compromised host is exfiltrating data via DNS tunneling using encoded subdomain queries.

**Suggested Queries:**
1. \`dns.question.name:*.xyz AND dns.question.subdomain.length:>50\` - Long subdomain queries (encoding indicator)
2. \`dns.question.type:TXT AND dns.response.data:*==\` - Base64 encoded DNS TXT responses
3. \`dns.query.count:>1000 AND agent.name:workstation-*\` - Anomalous DNS query volume per host

**Indicators Found:**
- Beaconing pattern detected from workstation-17 (60-second intervals over 4 hours)
- Domain update-service.xyz registered 3 days ago — DGA characteristics
- Average query length 3.2x above environmental baseline
- 47MB of data estimated to have been exfiltrated via DNS

**MITRE ATT&CK Coverage:** T1071.004 (DNS), T1048 (Exfiltration Over Alternative Protocol)

**Recommended Actions:**
- Block DNS queries to update-service.xyz at the resolver level
- Isolate workstation-17 and initiate forensic imaging
- Deploy DNS query length monitoring rule in Wazuh`,

  `## Threat Hunt Analysis: PowerShell Abuse

**Hypothesis:** Adversary is using encoded PowerShell commands for defense evasion and malicious execution.

**Suggested Queries:**
1. \`process.name:powershell.exe AND process.args:*-enc*\` - Encoded command execution
2. \`process.parent.name:winword.exe AND process.name:powershell.exe\` - Office spawning PowerShell
3. \`powershell.scriptblock:*IEX*downloadstring*\` - Download cradle patterns

**Key Findings:**
- 23 encoded PowerShell executions detected in the last 12 hours
- 5 originated from Office macro execution (Word documents)
- 2 unique download URLs identified in decoded payloads
- Base64 decoded content reveals Cobalt Strike beacon stager

**MITRE ATT&CK Coverage:** T1059.001 (PowerShell), T1027 (Obfuscated Files), T1204.002 (Malicious File)

**Recommended Actions:**
- Block identified download URLs at proxy
- Enable PowerShell Constrained Language Mode on non-admin endpoints
- Deploy Script Block Logging (Event ID 4104) across all endpoints`,

  `## Threat Hunt Analysis: Command & Control Detection

**Hypothesis:** A compromised endpoint is communicating with external C2 infrastructure via regular beacons.

**Suggested Queries:**
1. \`network.direction:outbound AND destination.port:443 | stats count by source.ip, destination.ip\`
2. \`network.bytes_out:>100000 AND connection.interval:~60s\` - Regular interval connections
3. \`destination.geo.country_name:(!US AND !UK AND !DE) AND destination.as.org:*hosting*\`

**Indicators Found:**
- 2 endpoints (workstation-09, workstation-14) showing beaconing behavior
- Beacon interval: 60 seconds with 5-second jitter (classic Cobalt Strike profile)
- Destination IPs: 185.220.101.45, 91.189.114.22 — both on bulletproof hosting
- TLS certificate analysis shows self-signed certs with suspicious CN values

**MITRE ATT&CK Coverage:** T1071 (Application Layer Protocol), T1573 (Encrypted Channel), T1568 (Dynamic Resolution)

**Recommended Actions:**
- Network isolate workstation-09 and workstation-14 immediately
- Block C2 IPs at the firewall and add to MISP as local IOCs
- Capture full PCAP for the identified sessions
- Initiate incident response procedure`,
]

const INVESTIGATE_PROMPTS = [
  'alert-brute-force-ssh-203.0.113.45',
  'alert-malware-certutil-download',
  'alert-privilege-escalation-sudo',
  'alert-data-exfiltration-large-upload',
  'alert-ransomware-shadow-delete',
  'alert-phishing-macro-execution',
  'alert-suspicious-process-injection',
  'alert-network-scan-nmap-detected',
  'alert-credential-dump-lsass',
  'alert-web-shell-aspx-detected',
  'alert-kerberos-golden-ticket',
  'alert-rdp-brute-force-internal',
  'alert-dns-exfil-high-entropy',
  'alert-service-account-abuse',
  'alert-unauthorized-usb-device',
]

const INVESTIGATE_RESPONSES = [
  `## AI Investigation Report

**Alert:** Brute Force SSH Attack from 203.0.113.45
**Severity:** CRITICAL
**Verdict:** True Positive (Confidence: 87%)

**Summary:**
847 failed SSH login attempts detected from IP 203.0.113.45 targeting the root account on web-prod-03 over a 15-minute window. A successful authentication was achieved on attempt #848. Post-exploitation activity includes privilege escalation via sudo misconfiguration and establishment of a reverse shell.

**Key Findings:**
1. Source IP 203.0.113.45 is a known scanner listed in Shodan/Censys databases
2. Attack targeted root account on production server web-prod-03
3. Successful authentication at 14:23:07 UTC after 847 consecutive failures
4. Post-auth: sudo privilege escalation achieved within 30 seconds
5. Outbound reverse shell connection to 45.33.32.156:4444 established at 14:23:45

**Risk Assessment:**
- Immediate Risk: CRITICAL — Active compromise with root access
- Lateral Movement: HIGH — Root credentials may be reused on other hosts
- Data Exposure: HIGH — Database credentials found in environment variables

**MITRE ATT&CK Mapping:**
- T1110.001 — Password Guessing
- T1078 — Valid Accounts
- T1548.003 — Sudo and Sudo Caching
- T1059.004 — Unix Shell

**Recommended Actions:**
1. ISOLATE web-prod-03 from the network immediately
2. Rotate ALL credentials stored on the compromised host
3. Block 203.0.113.45 and 45.33.32.156 at perimeter firewall
4. Initiate forensic disk imaging of the affected system
5. Review SSH authentication logs across all servers for the past 30 days`,

  `## AI Investigation Report

**Alert:** Suspicious Download via certutil.exe
**Severity:** HIGH
**Verdict:** Suspicious — Requires Further Investigation (Confidence: 72%)

**Summary:**
The endpoint detection system triggered on certutil.exe being used to download a remote payload to the user's temp directory. The downloaded file was subsequently executed 12 seconds after download. This behavior is consistent with known download cradle techniques used by multiple threat actors.

**Key Findings:**
1. certutil.exe invoked with flags: -urlcache -split -f
2. Downloaded file: update-service.exe (SHA256: a1b2c3d4e5f6...)
3. File executed via cmd.exe → update-service.exe chain, 12 seconds post-download
4. Parent process chain: explorer.exe → cmd.exe → certutil.exe
5. No prior history of certutil usage for downloads on this endpoint

**Risk Assessment:**
- Immediate Risk: HIGH — Executable of unknown provenance running
- Lateral Movement: MEDIUM — No network lateral movement observed yet
- Data Exposure: LOW — No data access patterns detected post-execution

**MITRE ATT&CK Mapping:**
- T1105 — Ingress Tool Transfer
- T1059.003 — Windows Command Shell
- T1204.002 — Malicious File

**Recommended Actions:**
1. Quarantine update-service.exe and submit hash to VirusTotal
2. Terminate the running process and block its network connections
3. Interview the user regarding recent email attachments or downloads
4. Check for persistence mechanisms (Run keys, scheduled tasks)
5. Scan the endpoint with updated EDR signatures`,

  `## AI Investigation Report

**Alert:** Privilege Escalation via Service Account
**Severity:** HIGH
**Verdict:** Likely True Positive (Confidence: 81%)

**Summary:**
Service account svc_deploy was observed performing unauthorized privilege escalation on app-server-05. The account, normally restricted to deployment operations, executed administrative commands including user creation and group membership modification.

**Key Findings:**
1. svc_deploy account created a new local admin user: maintenance_admin
2. New account added to Domain Admins group within 2 minutes
3. Source of svc_deploy session: workstation-31 (not a deployment server)
4. Login time outside normal deployment window (02:47 AM local)
5. No corresponding change management ticket for this activity

**Risk Assessment:**
- Immediate Risk: HIGH — Unauthorized admin account created
- Lateral Movement: HIGH — Domain Admin privileges obtained
- Data Exposure: MEDIUM — No confirmed data access yet

**MITRE ATT&CK Mapping:**
- T1078.002 — Domain Accounts
- T1136.002 — Domain Account Creation
- T1098 — Account Manipulation

**Recommended Actions:**
1. Disable maintenance_admin account immediately
2. Reset svc_deploy credentials and review access scope
3. Audit all actions performed by both accounts in the last 72 hours
4. Check workstation-31 for compromise indicators
5. Enable alerting for service account interactive logons`,

  `## AI Investigation Report

**Alert:** Large Data Transfer to External Storage
**Severity:** MEDIUM
**Verdict:** Requires Investigation (Confidence: 65%)

**Summary:**
Anomalous outbound data transfer detected from finance-workstation-12 to an external cloud storage service. Approximately 2.3GB of data was uploaded over a 45-minute window to a Mega.nz endpoint, which is unusual for this user's baseline behavior.

**Key Findings:**
1. Upload destination: mega.nz (known file sharing service)
2. Total data transferred: 2.3GB in 45 minutes
3. Transfer occurred between 11:15 PM and 12:00 AM (outside business hours)
4. User account: j.martinez (Finance department)
5. No DLP policy violation triggered (encrypted upload)

**Risk Assessment:**
- Immediate Risk: MEDIUM — Potential data exfiltration
- Data Exposure: HIGH if sensitive — Finance workstation may contain PII/financial data
- Intent: UNKNOWN — Could be legitimate personal use or malicious exfiltration

**Recommended Actions:**
1. Review j.martinez's access to sensitive file shares in the past 7 days
2. Check if Mega.nz is an approved cloud storage service
3. Interview user regarding the upload activity
4. Enable DLP content inspection for cloud storage uploads
5. Correlate with any recent termination or performance review flags`,
]

const EXPLAIN_PROMPTS = [
  'Explain MITRE ATT&CK technique T1059.001 PowerShell',
  'What is a golden ticket attack in Active Directory?',
  'Explain the difference between IDS and IPS',
  'What is MITRE T1110 Brute Force and how to detect it?',
  'Explain DNS over HTTPS (DoH) security implications',
  'What is a SIEM and how does it correlate events?',
  'Explain the concept of lateral movement in cybersecurity',
  'What are indicators of compromise (IOCs) vs indicators of attack (IOAs)?',
  'Explain Kerberoasting and how to defend against it',
  'What is the MITRE ATT&CK framework and why is it important?',
  'Explain zero-day vulnerabilities and responsible disclosure',
  'What is a supply chain attack and recent examples?',
  'Explain the concept of defense in depth',
  'What is endpoint detection and response (EDR)?',
  'Explain the OWASP Top 10 web application security risks',
]

const EXPLAIN_RESPONSES = [
  `## Explainable AI: PowerShell Abuse (T1059.001)

**Explanation:**
PowerShell is a legitimate system administration tool that adversaries frequently abuse for execution, defense evasion, and data collection. It provides direct access to .NET framework, WMI, and COM objects, making it extremely versatile for both legitimate and malicious purposes.

**Detection Strategies:**
1. Monitor for encoded commands (-enc, -EncodedCommand flags)
2. Enable PowerShell Script Block Logging (Event ID 4104)
3. Track PowerShell processes spawned from unusual parents (Office apps, browsers)
4. Alert on download cradles (IEX, Invoke-WebRequest, DownloadString patterns)

**MITRE ATT&CK Context:**
- Tactic: Execution
- Technique: T1059.001 (Command and Scripting Interpreter: PowerShell)
- Common in: APT29, FIN7, Lazarus Group, Wizard Spider campaigns

**Remediation:**
- Enable Constrained Language Mode where possible
- Implement Application Control via WDAC or AppLocker
- Monitor PowerShell transcription logs centrally via SIEM`,

  `## Explainable AI: Golden Ticket Attack

**Explanation:**
A Golden Ticket attack occurs when an adversary compromises the KRBTGT account password hash in Active Directory. With this hash, they can forge Ticket Granting Tickets (TGTs) for any account in the domain, effectively granting unrestricted access to all resources.

**How It Works:**
1. Attacker first obtains the KRBTGT password hash (via DCSync or ntds.dit extraction)
2. Uses Mimikatz or similar tools to forge a TGT with arbitrary privileges
3. The forged ticket can impersonate any user, including Domain Admins
4. Default TGT lifetime is 10 years, giving persistent access

**Detection:**
- Monitor for TGT requests with abnormally long lifetimes
- Detect KRBTGT password hash extraction attempts (DCSync Event ID 4662)
- Alert on Event IDs 4768/4769 with anomalous ticket options
- Compare ticket encryption types against domain policy

**Remediation:**
- Rotate KRBTGT password TWICE (once, wait for replication, then again)
- Implement Privileged Access Workstations (PAWs) for admin accounts
- Enable Advanced Audit Policy for Kerberos Service Ticket Operations
- Consider implementing Credential Guard on sensitive systems`,

  `## Explainable AI: IDS vs IPS

**Explanation:**
Intrusion Detection Systems (IDS) and Intrusion Prevention Systems (IPS) are network security technologies that monitor traffic for malicious activity. While they share similar detection capabilities, their response mechanisms differ fundamentally.

**Key Differences:**
| Feature | IDS | IPS |
|---------|-----|-----|
| Mode | Passive (monitor) | Active (inline) |
| Response | Alert only | Block + Alert |
| Position | Out-of-band (SPAN/TAP) | Inline (traffic flows through) |
| Latency | None | Minimal added latency |
| Risk | May miss threats | May block legitimate traffic |

**Types:**
- Network-based (NIDS/NIPS): Monitor network traffic
- Host-based (HIDS/HIPS): Monitor endpoint activity
- Signature-based: Match known attack patterns
- Anomaly-based: Detect deviations from baseline

**Best Practices:**
- Deploy IPS inline at network perimeter for known threats
- Use IDS in detection-only mode for internal network visibility
- Combine both with SIEM for comprehensive coverage
- Regularly update signatures and tune rules to reduce false positives`,
]

async function main() {
  const tenants = await prisma.tenant.findMany({
    where: { slug: { in: TENANT_SLUGS } },
    select: { id: true, slug: true },
  })
  if (tenants.length === 0) {
    console.error('No tenants found! Run prisma seed first.')
    process.exit(1)
  }
  console.log('Found tenants:', tenants.map(t => t.slug).join(', '))

  let totalRecords = 0

  for (const tenant of tenants) {
    const records = []
    const targetCount = rand(500, 600)

    for (let i = 0; i < targetCount; i++) {
      const action = pick(ACTIONS)
      const model = pick(MODELS)
      const actor = pick(ACTORS)
      const createdAt = daysAgo(rand(0, 60))

      let prompt, response, inputTokens, outputTokens, durationMs

      if (action === 'ai_hunt') {
        prompt = pick(HUNT_PROMPTS)
        response = pick(HUNT_RESPONSES)
        inputTokens = rand(200, 1200)
        outputTokens = rand(400, 2000)
        durationMs = model === 'rule-based' ? rand(50, 300) : rand(800, 4500)
      } else if (action === 'ai_investigate') {
        prompt = pick(INVESTIGATE_PROMPTS)
        response = pick(INVESTIGATE_RESPONSES)
        inputTokens = rand(500, 2000)
        outputTokens = rand(600, 2500)
        durationMs = model === 'rule-based' ? rand(100, 500) : rand(1200, 6000)
      } else {
        prompt = pick(EXPLAIN_PROMPTS)
        response = pick(EXPLAIN_RESPONSES)
        inputTokens = rand(100, 900)
        outputTokens = rand(300, 1800)
        durationMs = model === 'rule-based' ? rand(50, 200) : rand(600, 3000)
      }

      if (model === 'rule-based') {
        inputTokens = 0
        outputTokens = 0
      }

      records.push({
        id: uuid(),
        tenantId: tenant.id,
        actor,
        action,
        model,
        inputTokens,
        outputTokens,
        prompt,
        response,
        durationMs,
        createdAt,
      })
    }

    // Batch insert in chunks of 100
    for (let i = 0; i < records.length; i += 100) {
      const chunk = records.slice(i, i + 100)
      await prisma.aiAuditLog.createMany({ data: chunk })
    }

    totalRecords += records.length
    console.log(`${tenant.slug}: ${records.length} records seeded`)
  }

  console.log(`\nTotal AI audit records seeded: ${totalRecords}`)

  // Verify per tenant
  for (const tenant of tenants) {
    const count = await prisma.aiAuditLog.count({ where: { tenantId: tenant.id } })
    console.log(`${tenant.slug}: ${count} verified in DB`)
    if (count < 500) {
      console.error(`WARNING: ${tenant.slug} has < 500 records!`)
    }
  }

  // Show sample
  const sample = await prisma.aiAuditLog.findFirst({
    orderBy: { createdAt: 'desc' },
    select: { action: true, model: true, actor: true, inputTokens: true, outputTokens: true, durationMs: true },
  })
  console.log('\nSample record:', JSON.stringify(sample, null, 2))

  await prisma.$disconnect()
}

main().catch(e => { console.error(e); process.exit(1) })

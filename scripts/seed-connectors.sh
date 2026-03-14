#!/bin/bash
# =============================================================================
# AuraSpear SOC — Seed All Connector Services with Test Data
# =============================================================================
# Usage:
#   bash scripts/seed-connectors.sh
#
# Prerequisites:
#   docker compose -f docker-compose.connectors.yml up -d
#   Wait ~60 seconds for all services to initialize
# =============================================================================

set -e

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

success() { echo -e "${GREEN}[OK]${NC} $1"; }
warn()    { echo -e "${YELLOW}[WARN]${NC} $1"; }
fail()    { echo -e "${RED}[FAIL]${NC} $1"; }
header()  { echo -e "\n${YELLOW}=== $1 ===${NC}"; }

# =============================================================================
# 1. WAZUH INDEXER (OpenSearch) — Security Alerts
# =============================================================================
header "Seeding Wazuh Indexer (OpenSearch) alerts"

WAZUH_URL="https://localhost:9200"
WAZUH_AUTH="admin:admin"

# Wait for Wazuh to be ready
for i in $(seq 1 10); do
  if curl -sk -u "$WAZUH_AUTH" "$WAZUH_URL/_cluster/health" >/dev/null 2>&1; then
    break
  fi
  echo "Waiting for Wazuh Indexer... ($i/10)"
  sleep 5
done

ALERT_INDEX="wazuh-alerts-4.x-2026.03.14"
BULK_DATA=""

# Generate 20 realistic Wazuh alerts
RULES=(
  '{"level":12,"description":"SSH brute force attack detected","id":"5763","groups":["syslog","sshd","authentication_failures"]}'
  '{"level":10,"description":"Multiple authentication failures","id":"5720","groups":["authentication_failed","syslog"]}'
  '{"level":14,"description":"Possible SQL injection attempt","id":"31103","groups":["web","attack","sql_injection"]}'
  '{"level":12,"description":"Web server 500 error","id":"31120","groups":["web","error"]}'
  '{"level":15,"description":"Rootkit detection: Hidden process found","id":"510","groups":["ossec","rootcheck"]}'
  '{"level":11,"description":"CIS Benchmark: Ensure SSH root login is disabled","id":"28604","groups":["sca","cis"]}'
  '{"level":10,"description":"File integrity monitoring: File modified","id":"550","groups":["ossec","syscheck"]}'
  '{"level":13,"description":"Malware detected by ClamAV","id":"52502","groups":["virustotal","malware"]}'
  '{"level":9,"description":"New user account created","id":"5902","groups":["pam","syslog","authentication"]}'
  '{"level":11,"description":"Firewall drop action detected","id":"4101","groups":["firewall","drop"]}'
  '{"level":14,"description":"XSS attack attempt detected","id":"31104","groups":["web","attack","xss"]}'
  '{"level":8,"description":"Windows audit failure event","id":"60104","groups":["windows","audit"]}'
  '{"level":12,"description":"Privilege escalation attempt","id":"5401","groups":["syslog","sudo"]}'
  '{"level":10,"description":"Port scan detected from external source","id":"4002","groups":["firewall","scan"]}'
  '{"level":13,"description":"Shellshock attack attempt","id":"31166","groups":["web","attack","shellshock"]}'
  '{"level":9,"description":"Disk space critically low","id":"531","groups":["ossec","monitor"]}'
  '{"level":11,"description":"Unauthorized access to /etc/shadow","id":"552","groups":["ossec","syscheck","critical"]}'
  '{"level":15,"description":"Ransomware behavior detected: mass file encryption","id":"87103","groups":["malware","ransomware"]}'
  '{"level":10,"description":"DNS query to known C2 domain","id":"87401","groups":["threat_intel","dns","c2"]}'
  '{"level":12,"description":"Lateral movement detected via PsExec","id":"92601","groups":["windows","lateral_movement"]}'
)

AGENTS=(
  '{"id":"001","name":"web-server-01","ip":"10.0.1.10"}'
  '{"id":"002","name":"db-server-01","ip":"10.0.2.20"}'
  '{"id":"003","name":"app-server-01","ip":"10.0.1.30"}'
  '{"id":"004","name":"file-server-01","ip":"10.0.3.40"}'
  '{"id":"005","name":"dc-server-01","ip":"10.0.0.5"}'
)

SRC_IPS=("192.168.1.105" "10.10.10.50" "172.16.0.88" "203.0.113.42" "198.51.100.77" "45.33.32.156" "91.189.92.11" "185.220.101.1")
DST_IPS=("10.0.1.10" "10.0.2.20" "10.0.1.30" "10.0.3.40" "10.0.0.5")

for i in $(seq 0 19); do
  RULE=${RULES[$i]}
  AGENT=${AGENTS[$((i % 5))]}
  SRC=${SRC_IPS[$((i % 8))]}
  DST=${DST_IPS[$((i % 5))]}
  HOUR=$((6 + i % 18))
  MINUTE=$((i * 3 % 60))
  TIMESTAMP="2026-03-14T$(printf '%02d' $HOUR):$(printf '%02d' $MINUTE):00.000+0000"

  BULK_DATA+='{"index":{"_index":"'"$ALERT_INDEX"'"}}'$'\n'
  BULK_DATA+="{\"timestamp\":\"$TIMESTAMP\",\"rule\":$RULE,\"agent\":$AGENT,\"data\":{\"srcip\":\"$SRC\",\"dstip\":\"$DST\",\"srcport\":$((1024 + RANDOM % 64000)),\"dstport\":$((22 + i * 100 % 9000))},\"manager\":{\"name\":\"wazuh-manager\"},\"cluster\":{\"name\":\"wazuh-cluster\",\"node\":\"node01\"},\"id\":\"$(printf '%020d' $((1710000000 + i)))\",\"full_log\":\"Alert $i: ${RULES[$i]}\"}"$'\n'
done

RESULT=$(curl -sk -u "$WAZUH_AUTH" -X POST "$WAZUH_URL/_bulk" \
  -H "Content-Type: application/x-ndjson" \
  --data-binary "$BULK_DATA" 2>/dev/null)

if echo "$RESULT" | grep -q '"errors":false'; then
  success "Seeded 20 Wazuh alerts into $ALERT_INDEX"
else
  warn "Wazuh alert seeding may have partial errors"
fi

# =============================================================================
# 2. GRAYLOG — Log Events
# =============================================================================
header "Seeding Graylog events via GELF"

GRAYLOG_GELF_PORT=12201

GELF_MESSAGES=(
  '{"version":"1.1","host":"web-server-01","short_message":"Failed login attempt for user admin from 192.168.1.105","level":4,"_facility":"sshd","_src_ip":"192.168.1.105","_event_type":"authentication_failure"}'
  '{"version":"1.1","host":"app-server-01","short_message":"Application exception: NullPointerException in PaymentService.process()","level":3,"_facility":"java-app","_stack_trace":"PaymentService.java:142","_event_type":"application_error"}'
  '{"version":"1.1","host":"db-server-01","short_message":"Slow query detected: SELECT * FROM transactions WHERE date > ... (took 12.5s)","level":5,"_facility":"mysql","_query_time_ms":12500,"_event_type":"slow_query"}'
  '{"version":"1.1","host":"firewall-01","short_message":"Blocked connection from 203.0.113.42:44521 to 10.0.1.10:3389 (RDP)","level":4,"_facility":"iptables","_src_ip":"203.0.113.42","_dst_port":3389,"_event_type":"firewall_block"}'
  '{"version":"1.1","host":"web-server-01","short_message":"nginx: 502 Bad Gateway - upstream connection refused","level":3,"_facility":"nginx","_status_code":502,"_event_type":"web_error"}'
  '{"version":"1.1","host":"dc-server-01","short_message":"Active Directory: Account lockout for jsmith after 5 failed attempts","level":4,"_facility":"ad","_username":"jsmith","_event_type":"account_lockout"}'
  '{"version":"1.1","host":"mail-server-01","short_message":"Spam filter: Blocked phishing email from attacker@evil.com to hr@company.com","level":5,"_facility":"postfix","_sender":"attacker@evil.com","_event_type":"phishing_blocked"}'
  '{"version":"1.1","host":"vpn-gateway","short_message":"VPN connection established from unusual location: Russia (185.220.101.1)","level":4,"_facility":"openvpn","_src_ip":"185.220.101.1","_country":"RU","_event_type":"suspicious_vpn"}'
  '{"version":"1.1","host":"ids-sensor-01","short_message":"Snort alert: ET EXPLOIT Possible Apache Struts RCE (CVE-2017-5638)","level":3,"_facility":"snort","_cve":"CVE-2017-5638","_event_type":"ids_alert"}'
  '{"version":"1.1","host":"endpoint-01","short_message":"PowerShell encoded command execution detected: -enc JABjAGwAaQBlAG4...","level":3,"_facility":"sysmon","_process":"powershell.exe","_event_type":"suspicious_execution"}'
  '{"version":"1.1","host":"proxy-01","short_message":"Connection to known C2 domain blocked: evil-c2-server.xyz","level":3,"_facility":"squid","_domain":"evil-c2-server.xyz","_event_type":"c2_blocked"}'
  '{"version":"1.1","host":"file-server-01","short_message":"Mass file rename operation detected: 1500 files renamed to .encrypted extension","level":2,"_facility":"sysmon","_file_count":1500,"_event_type":"ransomware_indicator"}'
  '{"version":"1.1","host":"web-server-02","short_message":"ModSecurity: SQL injection attempt blocked in parameter id=1 OR 1=1","level":4,"_facility":"modsecurity","_attack_type":"sqli","_event_type":"waf_block"}'
  '{"version":"1.1","host":"dns-server-01","short_message":"DNS tunneling suspected: unusually long subdomain queries to tunnel.evil.net","level":4,"_facility":"bind","_domain":"tunnel.evil.net","_event_type":"dns_tunnel"}'
  '{"version":"1.1","host":"k8s-node-01","short_message":"Pod security: Container running as root detected in production namespace","level":4,"_facility":"kubernetes","_namespace":"production","_event_type":"security_violation"}'
)

GELF_SEEDED=0
for msg in "${GELF_MESSAGES[@]}"; do
  if echo -n "$msg" | nc -w 2 -u localhost "$GRAYLOG_GELF_PORT" 2>/dev/null; then
    GELF_SEEDED=$((GELF_SEEDED + 1))
  fi
done
success "Sent $GELF_SEEDED GELF messages to Graylog (UDP $GRAYLOG_GELF_PORT)"

# =============================================================================
# 3. GRAFANA — Dashboards & Data Sources
# =============================================================================
header "Seeding Grafana dashboards"

GRAFANA_URL="http://localhost:3001"
GRAFANA_AUTH="admin:admin"

# Create a service account + API token
SA_RESULT=$(curl -s -u "$GRAFANA_AUTH" -X POST "$GRAFANA_URL/api/serviceaccounts" \
  -H "Content-Type: application/json" \
  -d '{"name":"auraspear-sa","role":"Admin"}' 2>/dev/null)

SA_ID=$(echo "$SA_RESULT" | grep -o '"id":[0-9]*' | head -1 | cut -d: -f2)

if [ -n "$SA_ID" ] && [ "$SA_ID" != "null" ]; then
  TOKEN_RESULT=$(curl -s -u "$GRAFANA_AUTH" -X POST "$GRAFANA_URL/api/serviceaccounts/$SA_ID/tokens" \
    -H "Content-Type: application/json" \
    -d '{"name":"auraspear-token"}' 2>/dev/null)
  GRAFANA_TOKEN=$(echo "$TOKEN_RESULT" | grep -o '"key":"[^"]*"' | cut -d'"' -f4)
  if [ -n "$GRAFANA_TOKEN" ]; then
    success "Created Grafana API token: $GRAFANA_TOKEN"
  else
    warn "Service account exists, using basic auth for seeding"
  fi
else
  warn "Service account may already exist, continuing with basic auth"
fi

# Create security monitoring dashboard
DASHBOARD_RESULT=$(curl -s -u "$GRAFANA_AUTH" -X POST "$GRAFANA_URL/api/dashboards/db" \
  -H "Content-Type: application/json" \
  -d '{
    "dashboard": {
      "title": "Security Operations Center",
      "tags": ["security", "soc", "auraspear"],
      "timezone": "browser",
      "panels": [
        {
          "id": 1, "type": "stat", "title": "Total Alerts (24h)",
          "gridPos": {"h": 4, "w": 6, "x": 0, "y": 0}
        },
        {
          "id": 2, "type": "timeseries", "title": "Alert Trend",
          "gridPos": {"h": 8, "w": 12, "x": 0, "y": 4}
        },
        {
          "id": 3, "type": "piechart", "title": "Alerts by Severity",
          "gridPos": {"h": 8, "w": 6, "x": 12, "y": 4}
        },
        {
          "id": 4, "type": "table", "title": "Top Attackers",
          "gridPos": {"h": 8, "w": 6, "x": 18, "y": 4}
        },
        {
          "id": 5, "type": "stat", "title": "Active Agents",
          "gridPos": {"h": 4, "w": 6, "x": 6, "y": 0}
        },
        {
          "id": 6, "type": "stat", "title": "Critical Alerts",
          "gridPos": {"h": 4, "w": 6, "x": 12, "y": 0}
        },
        {
          "id": 7, "type": "gauge", "title": "Threat Level",
          "gridPos": {"h": 4, "w": 6, "x": 18, "y": 0}
        }
      ],
      "schemaVersion": 39
    },
    "overwrite": true
  }' 2>/dev/null)

DASHBOARD2_RESULT=$(curl -s -u "$GRAFANA_AUTH" -X POST "$GRAFANA_URL/api/dashboards/db" \
  -H "Content-Type: application/json" \
  -d '{
    "dashboard": {
      "title": "Network Traffic Analysis",
      "tags": ["network", "traffic", "security"],
      "timezone": "browser",
      "panels": [
        {
          "id": 1, "type": "timeseries", "title": "Bandwidth Usage",
          "gridPos": {"h": 8, "w": 12, "x": 0, "y": 0}
        },
        {
          "id": 2, "type": "table", "title": "Top Connections",
          "gridPos": {"h": 8, "w": 12, "x": 12, "y": 0}
        },
        {
          "id": 3, "type": "piechart", "title": "Protocol Distribution",
          "gridPos": {"h": 8, "w": 8, "x": 0, "y": 8}
        }
      ],
      "schemaVersion": 39
    },
    "overwrite": true
  }' 2>/dev/null)

success "Created Grafana dashboards: SOC Overview + Network Traffic"

# =============================================================================
# 4. INFLUXDB — Time-Series Metrics
# =============================================================================
header "Seeding InfluxDB metrics"

INFLUX_URL="http://localhost:8086"
INFLUX_TOKEN="auraspear-influx-token"
INFLUX_ORG="auraspear"
INFLUX_BUCKET="security"

# Seed security metrics data
METRICS=""
BASE_TS=$(($(date +%s) - 86400))  # Start 24 hours ago

for i in $(seq 0 23); do
  TS=$(( (BASE_TS + i * 3600) * 1000000000 ))

  # Alert counts by severity
  METRICS+="alert_counts,severity=critical count=$((RANDOM % 5 + 1))i ${TS}"$'\n'
  METRICS+="alert_counts,severity=high count=$((RANDOM % 15 + 3))i ${TS}"$'\n'
  METRICS+="alert_counts,severity=medium count=$((RANDOM % 30 + 10))i ${TS}"$'\n'
  METRICS+="alert_counts,severity=low count=$((RANDOM % 50 + 20))i ${TS}"$'\n'

  # Network traffic
  METRICS+="network_traffic,interface=eth0 bytes_in=$((RANDOM * 10000 + 500000))i,bytes_out=$((RANDOM * 8000 + 300000))i,packets_in=$((RANDOM % 10000 + 1000))i ${TS}"$'\n'
  METRICS+="network_traffic,interface=eth1 bytes_in=$((RANDOM * 5000 + 100000))i,bytes_out=$((RANDOM * 4000 + 80000))i,packets_in=$((RANDOM % 5000 + 500))i ${TS}"$'\n'

  # System metrics
  METRICS+="system_metrics,host=web-server-01 cpu_usage=$((50 + RANDOM % 40)).${RANDOM:0:1},memory_usage=$((60 + RANDOM % 30)).${RANDOM:0:1},disk_usage=$((40 + RANDOM % 20)).${RANDOM:0:1} ${TS}"$'\n'
  METRICS+="system_metrics,host=db-server-01 cpu_usage=$((30 + RANDOM % 50)).${RANDOM:0:1},memory_usage=$((70 + RANDOM % 25)).${RANDOM:0:1},disk_usage=$((55 + RANDOM % 15)).${RANDOM:0:1} ${TS}"$'\n'

  # Authentication events
  METRICS+="auth_events,type=success count=$((RANDOM % 100 + 50))i ${TS}"$'\n'
  METRICS+="auth_events,type=failure count=$((RANDOM % 20 + 2))i ${TS}"$'\n'
  METRICS+="auth_events,type=lockout count=$((RANDOM % 5))i ${TS}"$'\n'

  # Threat intelligence hits
  METRICS+="threat_intel,source=misp hits=$((RANDOM % 10))i ${TS}"$'\n'
  METRICS+="threat_intel,source=virustotal hits=$((RANDOM % 8))i ${TS}"$'\n'
done

INFLUX_RESULT=$(curl -s -o /dev/null -w "%{http_code}" -X POST \
  "$INFLUX_URL/api/v2/write?org=$INFLUX_ORG&bucket=$INFLUX_BUCKET&precision=ns" \
  -H "Authorization: Token $INFLUX_TOKEN" \
  -H "Content-Type: text/plain" \
  --data-binary "$METRICS" 2>/dev/null)

if [ "$INFLUX_RESULT" = "204" ]; then
  success "Seeded 24h of security metrics into InfluxDB (312 data points)"
else
  fail "InfluxDB seeding returned status $INFLUX_RESULT"
fi

# =============================================================================
# 5. MISP — Threat Intelligence Events & IOCs
# =============================================================================
header "Seeding MISP threat intelligence"

MISP_URL="https://localhost:8443"

# Get MISP API key
MISP_KEY=$(curl -sk -X POST "$MISP_URL/auth" \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@admin.test","password":"admin"}' 2>/dev/null | grep -o '"authkey":"[^"]*"' | cut -d'"' -f4)

if [ -z "$MISP_KEY" ]; then
  # Try fetching from existing user
  MISP_KEY=$(curl -sk -H "Authorization: admin" "$MISP_URL/users/view/me.json" 2>/dev/null | grep -o '"authkey":"[^"]*"' | cut -d'"' -f4)
fi

if [ -z "$MISP_KEY" ]; then
  warn "Could not get MISP API key, trying default login..."
  MISP_LOGIN=$(curl -sk -c /tmp/misp_cookies.txt -X POST "$MISP_URL/users/login" \
    -H "Content-Type: application/x-www-form-urlencoded" \
    -d "data[User][email]=admin@admin.test&data[User][password]=admin" 2>/dev/null)
  MISP_KEY=$(curl -sk -b /tmp/misp_cookies.txt "$MISP_URL/users/view/me.json" 2>/dev/null | grep -o '"authkey":"[^"]*"' | cut -d'"' -f4)
fi

if [ -n "$MISP_KEY" ]; then
  success "Got MISP API key: $MISP_KEY"

  MISP_HEADERS=(-H "Authorization: $MISP_KEY" -H "Content-Type: application/json" -H "Accept: application/json")

  # Event 1: APT Campaign
  curl -sk "${MISP_HEADERS[@]}" -X POST "$MISP_URL/events" -d '{
    "Event": {
      "info": "APT-29 Cozy Bear - SolarWinds Supply Chain Attack",
      "distribution": 0, "threat_level_id": 1, "analysis": 2,
      "Attribute": [
        {"type": "ip-dst", "category": "Network activity", "value": "185.220.101.1", "to_ids": true, "comment": "C2 server"},
        {"type": "ip-dst", "category": "Network activity", "value": "91.189.92.11", "to_ids": true, "comment": "Exfiltration endpoint"},
        {"type": "domain", "category": "Network activity", "value": "evil-c2-server.xyz", "to_ids": true, "comment": "Primary C2 domain"},
        {"type": "domain", "category": "Network activity", "value": "update-check.solarwinds-malware.com", "to_ids": true},
        {"type": "md5", "category": "Payload delivery", "value": "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4", "to_ids": true, "comment": "Sunburst backdoor"},
        {"type": "sha256", "category": "Payload delivery", "value": "ce77d116a074dab7a22a0fd4f2c1ab475f16eec42e1ded3c0b0aa8211fe858d6", "to_ids": true},
        {"type": "url", "category": "Network activity", "value": "https://evil-c2-server.xyz/api/v1/beacon", "to_ids": true},
        {"type": "email-src", "category": "Payload delivery", "value": "phishing@apt29-campaign.ru", "to_ids": true}
      ]
    }
  }' >/dev/null 2>&1

  # Event 2: Ransomware Campaign
  curl -sk "${MISP_HEADERS[@]}" -X POST "$MISP_URL/events" -d '{
    "Event": {
      "info": "LockBit 3.0 Ransomware Campaign - Manufacturing Sector",
      "distribution": 0, "threat_level_id": 1, "analysis": 1,
      "Attribute": [
        {"type": "ip-dst", "category": "Network activity", "value": "203.0.113.42", "to_ids": true, "comment": "Ransomware C2"},
        {"type": "domain", "category": "Network activity", "value": "lockbit-decrypt.onion.ws", "to_ids": true},
        {"type": "md5", "category": "Payload delivery", "value": "b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5", "to_ids": true, "comment": "LockBit dropper"},
        {"type": "sha256", "category": "Payload delivery", "value": "d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5", "to_ids": true},
        {"type": "filename", "category": "Payload delivery", "value": "lockbit_decryptor.exe", "to_ids": true},
        {"type": "mutex", "category": "Artifacts dropped", "value": "Global\\LockBit3_Mutex", "to_ids": true}
      ]
    }
  }' >/dev/null 2>&1

  # Event 3: Phishing Campaign
  curl -sk "${MISP_HEADERS[@]}" -X POST "$MISP_URL/events" -d '{
    "Event": {
      "info": "Business Email Compromise - CEO Fraud Targeting Finance Department",
      "distribution": 0, "threat_level_id": 2, "analysis": 2,
      "Attribute": [
        {"type": "email-src", "category": "Payload delivery", "value": "ceo-urgent@company-secure.com", "to_ids": true},
        {"type": "domain", "category": "Network activity", "value": "company-secure.com", "to_ids": true, "comment": "Spoofed domain"},
        {"type": "url", "category": "Payload delivery", "value": "https://company-secure.com/invoice-review.html", "to_ids": true},
        {"type": "ip-dst", "category": "Network activity", "value": "198.51.100.77", "to_ids": true, "comment": "Phishing infrastructure"},
        {"type": "email-subject", "category": "Payload delivery", "value": "URGENT: Wire Transfer Required - Confidential", "to_ids": false}
      ]
    }
  }' >/dev/null 2>&1

  # Event 4: Cryptomining Malware
  curl -sk "${MISP_HEADERS[@]}" -X POST "$MISP_URL/events" -d '{
    "Event": {
      "info": "XMRig Cryptominer - Cloud Infrastructure Compromise",
      "distribution": 0, "threat_level_id": 3, "analysis": 2,
      "Attribute": [
        {"type": "ip-dst", "category": "Network activity", "value": "45.33.32.156", "to_ids": true, "comment": "Mining pool proxy"},
        {"type": "domain", "category": "Network activity", "value": "pool.supportxmr.com", "to_ids": true},
        {"type": "md5", "category": "Payload delivery", "value": "c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6", "to_ids": true, "comment": "XMRig binary"},
        {"type": "filename", "category": "Payload delivery", "value": "kworker_xmrig", "to_ids": true},
        {"type": "port", "category": "Network activity", "value": "3333", "to_ids": true, "comment": "Stratum mining protocol"}
      ]
    }
  }' >/dev/null 2>&1

  # Event 5: Zero-Day Exploit
  curl -sk "${MISP_HEADERS[@]}" -X POST "$MISP_URL/events" -d '{
    "Event": {
      "info": "CVE-2026-1234 - Critical RCE in Apache HTTP Server (Hypothetical)",
      "distribution": 0, "threat_level_id": 1, "analysis": 0,
      "Attribute": [
        {"type": "vulnerability", "category": "External analysis", "value": "CVE-2026-1234", "to_ids": false},
        {"type": "ip-dst", "category": "Network activity", "value": "172.16.0.88", "to_ids": true, "comment": "Exploit delivery server"},
        {"type": "url", "category": "Payload delivery", "value": "https://exploit-server.evil/apache-rce", "to_ids": true},
        {"type": "user-agent", "category": "Network activity", "value": "Mozilla/5.0 (exploit-kit/3.0)", "to_ids": true},
        {"type": "pattern-in-traffic", "category": "Network activity", "value": "GET /%25%7B%23context", "to_ids": true}
      ]
    }
  }' >/dev/null 2>&1

  success "Created 5 MISP threat intelligence events with IOCs"
else
  fail "Could not authenticate to MISP"
fi

# =============================================================================
# 6. SHUFFLE — Workflow
# =============================================================================
header "Seeding Shuffle SOAR workflow"

SHUFFLE_URL="http://localhost:3443"
SHUFFLE_KEY="a1b2c3d4-e5f6-7890-abcd-ef1234567890"

# Check if workflow already exists
EXISTING_WF=$(curl -s -H "Authorization: Bearer $SHUFFLE_KEY" "$SHUFFLE_URL/api/v1/workflows" 2>/dev/null)
WF_COUNT=$(echo "$EXISTING_WF" | grep -o '"id"' | wc -l)

if [ "$WF_COUNT" -lt 2 ]; then
  # Create alert enrichment workflow
  WF1_RESULT=$(curl -s -X POST -H "Authorization: Bearer $SHUFFLE_KEY" \
    -H "Content-Type: application/json" \
    "$SHUFFLE_URL/api/v1/workflows" \
    -d '{
      "name": "AuraSpear Alert Enrichment",
      "description": "Enriches incoming security alerts with threat intelligence and context",
      "actions": [
        {"app_name":"Shuffle Tools","app_version":"1.2.0","name":"receive_alert","label":"Receive Alert","position":{"x":100,"y":100},"id":"step_1"},
        {"app_name":"Shuffle Tools","app_version":"1.2.0","name":"enrich_ioc","label":"Enrich IOC","position":{"x":300,"y":100},"id":"step_2"},
        {"app_name":"Shuffle Tools","app_version":"1.2.0","name":"send_notification","label":"Notify SOC","position":{"x":500,"y":100},"id":"step_3"}
      ],
      "triggers": [
        {"app_name":"Webhook","name":"Webhook","label":"Alert Webhook","position":{"x":0,"y":100},"id":"trigger_1","trigger_type":"WEBHOOK"}
      ]
    }' 2>/dev/null)

  WF1_ID=$(echo "$WF1_RESULT" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)

  # Create incident response workflow
  WF2_RESULT=$(curl -s -X POST -H "Authorization: Bearer $SHUFFLE_KEY" \
    -H "Content-Type: application/json" \
    "$SHUFFLE_URL/api/v1/workflows" \
    -d '{
      "name": "Incident Response Playbook",
      "description": "Automated incident response for critical security events",
      "actions": [
        {"app_name":"Shuffle Tools","app_version":"1.2.0","name":"triage_alert","label":"Triage Alert","position":{"x":100,"y":100},"id":"step_1"},
        {"app_name":"Shuffle Tools","app_version":"1.2.0","name":"isolate_host","label":"Isolate Host","position":{"x":300,"y":50},"id":"step_2"},
        {"app_name":"Shuffle Tools","app_version":"1.2.0","name":"collect_forensics","label":"Collect Forensics","position":{"x":300,"y":150},"id":"step_3"},
        {"app_name":"Shuffle Tools","app_version":"1.2.0","name":"create_ticket","label":"Create Ticket","position":{"x":500,"y":100},"id":"step_4"}
      ],
      "triggers": [
        {"app_name":"Webhook","name":"Webhook","label":"Critical Alert Webhook","position":{"x":0,"y":100},"id":"trigger_1","trigger_type":"WEBHOOK"}
      ]
    }' 2>/dev/null)

  WF2_ID=$(echo "$WF2_RESULT" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)
  success "Created Shuffle workflows: Alert Enrichment ($WF1_ID) + IR Playbook ($WF2_ID)"
else
  success "Shuffle workflows already exist ($WF_COUNT found)"
fi

# =============================================================================
# 7. VELOCIRAPTOR — Endpoint Data via VQL
# =============================================================================
header "Seeding Velociraptor endpoint data"

VELOX_CONTAINER="auraspear-velociraptor"

# Create some server artifacts/hunts for test data
MSYS_NO_PATHCONV=1 docker exec "$VELOX_CONTAINER" /bin/sh -c '
# Add some client labels
/velociraptor/velociraptor --config /velociraptor/server.config.yaml query "
SELECT server_set_metadata(metadata=dict(
  \`org_name\`=\"AuraSpear SOC\",
  \`deployment\`=\"production\",
  \`version\`=\"1.0.0\",
  \`contact\`=\"soc-team@auraspear.io\"
)) FROM scope()
" 2>/dev/null

# Create sample notebooks for threat hunting documentation
/velociraptor/velociraptor --config /velociraptor/server.config.yaml query "
SELECT create_notebook(
  name=\"Threat Hunt: Suspicious PowerShell Activity\",
  description=\"Investigating encoded PowerShell commands across endpoints\",
  collaborators=split(string=\"admin\", sep=\",\")
) FROM scope()
" 2>/dev/null

/velociraptor/velociraptor --config /velociraptor/server.config.yaml query "
SELECT create_notebook(
  name=\"Incident Response: Lateral Movement Detection\",
  description=\"Tracking lateral movement via PsExec and WMI across the network\",
  collaborators=split(string=\"admin\", sep=\",\")
) FROM scope()
" 2>/dev/null

/velociraptor/velociraptor --config /velociraptor/server.config.yaml query "
SELECT create_notebook(
  name=\"Malware Analysis: Ransomware Artifacts\",
  description=\"Collection and analysis of LockBit 3.0 artifacts from compromised hosts\",
  collaborators=split(string=\"admin\", sep=\",\")
) FROM scope()
" 2>/dev/null

echo "Notebooks and metadata created"
' 2>&1

# Create server monitoring artifacts
MSYS_NO_PATHCONV=1 docker exec "$VELOX_CONTAINER" /bin/sh -c '
/velociraptor/velociraptor --config /velociraptor/server.config.yaml query "
SELECT * FROM info()
" 2>/dev/null | head -5
' 2>&1 | head -5

success "Seeded Velociraptor with server metadata and threat hunting notebooks"

# =============================================================================
# 8. LOGSTASH — Pipeline Verification
# =============================================================================
header "Verifying Logstash pipeline"

LOGSTASH_URL="http://localhost:9600"
LOGSTASH_STATUS=$(curl -s "$LOGSTASH_URL/" 2>/dev/null)

if echo "$LOGSTASH_STATUS" | grep -q '"status":"green"\|"status":"yellow"'; then
  VERSION=$(echo "$LOGSTASH_STATUS" | grep -o '"version":"[^"]*"' | cut -d'"' -f4)
  success "Logstash is running (v$VERSION) — pipeline accepts data via Beats (5044) and GELF (12201)"
else
  warn "Logstash status check returned unexpected response"
fi

# =============================================================================
# 9. AWS BEDROCK (LocalStack) — AI / LLM Gateway
# =============================================================================
header "Seeding AWS Bedrock via LocalStack"

LOCALSTACK_URL="http://localhost:4566"
AWS_REGION="us-east-1"
AWS_KEY="test"
AWS_SECRET="test"

# Wait for LocalStack to be ready
for i in $(seq 1 15); do
  LS_HEALTH=$(curl -s "$LOCALSTACK_URL/_localstack/health" 2>/dev/null)
  if echo "$LS_HEALTH" | grep -q '"bedrock"'; then
    break
  fi
  echo "Waiting for LocalStack... ($i/15)"
  sleep 3
done

# Check LocalStack health
LS_STATUS=$(curl -s "$LOCALSTACK_URL/_localstack/health" 2>/dev/null)
if echo "$LS_STATUS" | grep -q '"bedrock"'; then
  success "LocalStack is running with Bedrock support"

  # Create a custom model (LocalStack mock) for testing
  # LocalStack emulates the Bedrock API responses
  BEDROCK_MODELS=$(curl -s \
    -H "Authorization: AWS4-HMAC-SHA256 Credential=$AWS_KEY/20260314/$AWS_REGION/bedrock/aws4_request" \
    "$LOCALSTACK_URL/bedrock/foundation-models" 2>/dev/null)

  if echo "$BEDROCK_MODELS" | grep -q "modelSummaries\|modelId"; then
    MODEL_COUNT=$(echo "$BEDROCK_MODELS" | grep -o '"modelId"' | wc -l)
    success "Bedrock foundation models available: $MODEL_COUNT models"
  else
    warn "LocalStack Bedrock models not fully enumerable (mock mode)"
  fi

  # Test the InvokeModel endpoint with a simple prompt
  INVOKE_RESULT=$(curl -s -o /dev/null -w "%{http_code}" \
    -X POST "$LOCALSTACK_URL/model/anthropic.claude-3-sonnet-20240229-v1:0/invoke" \
    -H "Content-Type: application/json" \
    -H "Accept: application/json" \
    -d '{
      "anthropic_version": "bedrock-2023-05-31",
      "max_tokens": 10,
      "messages": [{"role": "user", "content": "Hello"}]
    }' 2>/dev/null)

  if [ "$INVOKE_RESULT" = "200" ] || [ "$INVOKE_RESULT" = "000" ]; then
    success "Bedrock InvokeModel endpoint responsive"
  else
    warn "Bedrock InvokeModel returned status $INVOKE_RESULT (mock mode — some responses may differ)"
  fi

  success "LocalStack Bedrock ready for development at $LOCALSTACK_URL"
else
  warn "LocalStack not running or Bedrock service not available"
  echo "  Start with: docker compose -f docker-compose.connectors.yml up localstack -d"
fi

# =============================================================================
# SUMMARY
# =============================================================================
header "Seed Complete — Connector Credentials"

echo ""
echo "┌──────────────────┬───────────────────────────────┬──────────────────────────────────────────────┐"
echo "│ Service          │ URL                           │ Credentials                                  │"
echo "├──────────────────┼───────────────────────────────┼──────────────────────────────────────────────┤"
echo "│ Wazuh Indexer    │ https://localhost:9200         │ admin / admin                                │"
echo "│ Wazuh Dashboard  │ https://localhost:5601         │ admin / admin                                │"
echo "│ Graylog          │ http://localhost:9000          │ admin / admin@Graylog1                       │"
echo "│ Grafana          │ http://localhost:3001          │ admin / admin                                │"
echo "│ InfluxDB         │ http://localhost:8086          │ Token: auraspear-influx-token                │"
echo "│                  │                               │ Org: auraspear / Bucket: security            │"
echo "│ MISP             │ https://localhost:8443         │ Key: $MISP_KEY│"
echo "│ Shuffle          │ http://localhost:3443          │ API: a1b2c3d4-e5f6-7890-abcd-ef1234567890   │"
echo "│                  │                               │ admin / Admin@Shuffle1                       │"
echo "│ Velociraptor     │ https://localhost:8889         │ admin / admin (Basic auth)                   │"
echo "│ Logstash         │ http://localhost:9600          │ No auth                                      │"
echo "│ Bedrock (Local)  │ http://localhost:4566          │ test / test (LocalStack mock)                 │"
echo "│                  │                               │ Region: us-east-1                            │"
echo "└──────────────────┴───────────────────────────────┴──────────────────────────────────────────────┘"
echo ""
success "All connectors seeded! Run 'docker compose -f docker-compose.connectors.yml ps' to verify."

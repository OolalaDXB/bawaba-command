export interface Agent {
  id: string;
  name: string;
  auth: string;
  allowedTools: string[];
  deniedTools: string[];
  piiMode: string;
  rateLimit: number;
  status: 'healthy' | 'rate-limited' | 'blocked' | 'pending';
  lastActive: Date;
  created: Date;
  callsToday: number;
  callsTotal: number;
  violations: number;
  jurisdictions?: string[];
}

export interface MCPEvent {
  id: string;
  timestamp: Date;
  agent: string;
  tool: string;
  decision: 'allow' | 'deny' | 'rate-limited';
  piiTokens: number;
  latency: number;
  jurisdiction: string;
  hash: string;
  prevHash: string;
  details: Record<string, unknown>;
  // Optional metadata for UI-originated events (agent registration, reviews).
  eventType?: string;
  refEventId?: string;
  reviewer?: string;
  reviewLabel?: 'acknowledge' | 'escalate';
}

export interface JurisdictionData {
  code: string;
  name: string;
  regulation: string;
  callsToday: number;
  piiTokenized: number;
  denials: number;
  complianceScore: number;
  lastAudit: string;
  nextReview: string;
  status: 'compliant' | 'review' | 'non-compliant';
}

export const AGENTS: Agent[] = [
  {
    id: 'ag-001', name: 'claude-code', auth: 'OAuth 2.0',
    allowedTools: ['database-query', 'git-read', 'git-write', 'jira-read'],
    deniedTools: ['slack-send'], piiMode: 'tokenize', rateLimit: 1000,
    status: 'healthy', lastActive: new Date(), created: new Date('2024-11-15'),
    callsToday: 1247, callsTotal: 89432, violations: 3,
  },
  {
    id: 'ag-002', name: 'cursor-ide', auth: 'mTLS',
    allowedTools: ['git-read', 'git-write', 'database-query'],
    deniedTools: ['jira-read', 'slack-send'], piiMode: 'tokenize', rateLimit: 500,
    status: 'healthy', lastActive: new Date(), created: new Date('2024-12-01'),
    callsToday: 834, callsTotal: 45210, violations: 1,
  },
  {
    id: 'ag-003', name: 'chatgpt-agent', auth: 'API Key',
    allowedTools: ['jira-read', 'slack-send'],
    deniedTools: ['database-query', 'git-write'], piiMode: 'redact', rateLimit: 200,
    status: 'rate-limited', lastActive: new Date(Date.now() - 300000), created: new Date('2025-01-10'),
    callsToday: 198, callsTotal: 12340, violations: 7,
  },
  {
    id: 'ag-004', name: 'gemini-pro', auth: 'OAuth 2.0',
    allowedTools: ['database-query'],
    deniedTools: ['git-read', 'git-write', 'jira-read', 'slack-send'], piiMode: 'block', rateLimit: 100,
    status: 'blocked', lastActive: new Date(Date.now() - 3600000), created: new Date('2025-02-01'),
    callsToday: 0, callsTotal: 2130, violations: 14,
  },
];

export const TOOLS = ['database-query', 'git-read', 'git-write', 'jira-read', 'slack-send'];
const JURISDICTIONS_CODES = ['ma', 'sa', 'ae', 'fr'];
const JURISDICTION_NAMES: Record<string, string> = { ma: 'Morocco', sa: 'KSA', ae: 'UAE', fr: 'France' };

export const JURISDICTIONS: JurisdictionData[] = [
  { code: 'ma', name: 'Morocco', regulation: 'Loi 09-08', callsToday: 892, piiTokenized: 3412, denials: 23, complianceScore: 97, lastAudit: '2025-02-10', nextReview: '2025-03-10', status: 'compliant' },
  { code: 'sa', name: 'KSA', regulation: 'PDPL / SAMA', callsToday: 1134, piiTokenized: 5621, denials: 41, complianceScore: 94, lastAudit: '2025-02-08', nextReview: '2025-03-08', status: 'compliant' },
  { code: 'ae', name: 'UAE', regulation: 'DIFC / ADGM', callsToday: 678, piiTokenized: 2190, denials: 12, complianceScore: 98, lastAudit: '2025-02-12', nextReview: '2025-03-12', status: 'compliant' },
  { code: 'fr', name: 'France', regulation: 'CNIL / RGPD', callsToday: 445, piiTokenized: 1834, denials: 8, complianceScore: 91, lastAudit: '2025-02-05', nextReview: '2025-03-05', status: 'review' },
];

let eventCounter = 0;
let lastHash = 'a0b1c2d3e4f5';

function randomHash(): string {
  return Math.random().toString(36).substring(2, 14);
}

export function generateEvent(): MCPEvent {
  const agent = AGENTS[Math.floor(Math.random() * AGENTS.length)];
  const tool = TOOLS[Math.floor(Math.random() * TOOLS.length)];
  const denied = agent.deniedTools.includes(tool);
  const rateLimited = agent.status === 'rate-limited' && Math.random() > 0.5;
  const decision: MCPEvent['decision'] = denied ? 'deny' : rateLimited ? 'rate-limited' : 'allow';
  const prevHash = lastHash;
  const hash = randomHash();
  lastHash = hash;
  eventCounter++;

  return {
    id: `evt-${eventCounter.toString().padStart(6, '0')}`,
    timestamp: new Date(),
    agent: agent.name,
    tool,
    decision,
    piiTokens: decision === 'deny' ? 0 : Math.floor(Math.random() * 8),
    latency: Math.floor(Math.random() * 15) + 1,
    jurisdiction: JURISDICTIONS_CODES[Math.floor(Math.random() * JURISDICTIONS_CODES.length)],
    hash,
    prevHash,
    details: {
      request_id: `req-${randomHash()}`,
      agent_id: agent.id,
      tool_name: tool,
      policy_matched: denied ? 'deny-rule-' + tool : 'allow-default',
      pii_entities: decision !== 'deny' ? ['IBAN', 'phone', 'email', 'national_id', 'card'].slice(0, Math.floor(Math.random() * 3)) : [],
      jurisdiction: JURISDICTIONS_CODES[Math.floor(Math.random() * JURISDICTIONS_CODES.length)],
      evaluation_time_ms: (Math.random() * 5).toFixed(2),
    },
  };
}

export function generateInitialEvents(count: number): MCPEvent[] {
  const events: MCPEvent[] = [];
  const now = Date.now();
  // Keep the seeded "needs review" set realistic: ~13 of 50 events are
  // deny / rate-limited / PII-bearing, the rest are clean allows with no PII.
  const reviewIdx = new Set(
    [2, 6, 9, 13, 18, 22, 26, 31, 35, 39, 43, 46, 49].filter(i => i < count),
  );
  let r = 0;
  for (let i = 0; i < count; i++) {
    const event = generateEvent();
    event.timestamp = new Date(now - (count - i) * 3000);
    if (reviewIdx.has(i)) {
      const kind = r % 3;
      r++;
      if (kind === 0) {
        event.decision = 'deny';
        event.piiTokens = 0;
        event.details.policy_matched = `deny-rule-${event.tool}`;
      } else if (kind === 1) {
        event.decision = 'rate-limited';
        event.piiTokens = Math.floor(Math.random() * 3);
      } else {
        event.decision = 'allow';
        event.piiTokens = Math.floor(Math.random() * 4) + 1;
      }
    } else {
      event.decision = 'allow';
      event.piiTokens = 0;
    }
    events.push(event);
  }
  return events;
}

export function generateSparklineData(points: number, base: number, variance: number): number[] {
  const data: number[] = [];
  let value = base;
  for (let i = 0; i < points; i++) {
    value = Math.max(0, value + (Math.random() - 0.45) * variance);
    data.push(Math.round(value));
  }
  return data;
}

export const PII_TYPES = [
  { type: 'IBAN', count: 4521, today: 342 },
  { type: 'Phone', count: 3210, today: 287 },
  { type: 'Email', count: 2890, today: 198 },
  { type: 'National ID', count: 1654, today: 124 },
  { type: 'Card', count: 987, today: 67 },
];

export const POLICY_RULES = [
  { agent: 'claude-code', tool: 'database-query', action: 'allow', conditions: 'jurisdiction in [ma, sa, ae, fr]', matched: 892 },
  { agent: 'claude-code', tool: 'git-read', action: 'allow', conditions: 'always', matched: 1247 },
  { agent: 'chatgpt-agent', tool: 'database-query', action: 'deny', conditions: 'always', matched: 41 },
  { agent: 'chatgpt-agent', tool: 'git-write', action: 'deny', conditions: 'always', matched: 28 },
  { agent: 'gemini-pro', tool: 'git-read', action: 'deny', conditions: 'status = blocked', matched: 14 },
  { agent: '*', tool: 'slack-send', action: 'allow', conditions: 'pii_mode != block', matched: 156 },
  { agent: '*', tool: '*', action: 'deny', conditions: 'rate_limit_exceeded', matched: 67 },
];

export function getJurisdictionFlag(code: string): string {
  // Emoji flag from the ISO code via regional indicators (eu → 🇪🇺 works too).
  const cc = code.trim().toLowerCase().slice(0, 2);
  if (!/^[a-z]{2}$/.test(cc)) return code.toUpperCase();
  return String.fromCodePoint(...[...cc].map(c => 0x1f1e6 + c.charCodeAt(0) - 97));
}

export function getJurisdictionName(code: string): string {
  return JURISDICTION_NAMES[code] || code.toUpperCase();
}

export const ROUTING_NODES = [
  { id: 'casa', name: 'Casablanca', provider: 'Inwi DC', jurisdiction: 'ma', lat: 33.5, lng: -7.6, status: 'active' as const, calls: 892, latency: 12 },
  { id: 'riyadh', name: 'Riyadh', provider: 'stc cloud', jurisdiction: 'sa', lat: 24.7, lng: 46.7, status: 'active' as const, calls: 1134, latency: 18 },
  { id: 'abudhabi', name: 'Abu Dhabi', provider: 'G42', jurisdiction: 'ae', lat: 24.4, lng: 54.6, status: 'active' as const, calls: 678, latency: 15 },
  { id: 'paris', name: 'Paris', provider: 'OVHcloud', jurisdiction: 'fr', lat: 48.9, lng: 2.3, status: 'active' as const, calls: 445, latency: 8 },
];

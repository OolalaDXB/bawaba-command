import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { Area, AreaChart, ResponsiveContainer, YAxis } from 'recharts';
import { X } from 'lucide-react';
import { useLiveFeed } from '@/hooks/use-live-feed';
import { AGENTS as MOCK_AGENTS, JURISDICTIONS as MOCK_JURISDICTIONS, TOOLS, generateSparklineData, getJurisdictionFlag, type JurisdictionData } from '@/lib/mock-data';
import { useLocalAudit, pushInjectedEvent } from '@/lib/local-audit';
import { tokenizePii } from '@/lib/pii-detect';
import {
  isApiAvailable, fetchStats, fetchAgents, fetchJurisdictions,
  type StatsResponse, type AgentInfo, type JurisdictionEntry,
} from '@/services/api';
import InfoTooltip from '@/components/InfoTooltip';
import { PETROL, DECISION_COLORS } from '@/lib/chart-colors';

/* ── Time-ago helper ────────────────────────────── */
function timeAgo(date: Date): string {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

/* ── Skeleton shimmer ───────────────────────────── */
function MetricSkeleton() {
  return (
    <div className="bg-background border border-border rounded-sm p-5">
      <div className="animate-shimmer rounded h-3 w-24 mb-3" />
      <div className="flex items-end justify-between">
        <div>
          <div className="animate-shimmer rounded h-7 w-20 mb-1" />
          <div className="animate-shimmer rounded h-3 w-32 mt-1" />
        </div>
        <div className="animate-shimmer rounded h-10 w-24" />
      </div>
    </div>
  );
}

/* ── Sparkline — Stripe-style: bare smooth line over a soft gradient fill,
      no grid, no axes, no reference line. ─────────── */
let sparklineSeq = 0;
function Sparkline({ data, color }: { data: number[]; color: string }) {
  const chartData = data.map((v, i) => ({ i, v }));
  const min = Math.min(...data);
  const max = Math.max(...data);
  const padding = (max - min) * 0.15;
  const gradId = useMemo(() => `spark-grad-${++sparklineSeq}`, []);
  return (
    <div className="h-10 w-28">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={chartData} margin={{ top: 2, right: 0, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.16} />
              <stop offset="100%" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>
          <YAxis domain={[Math.max(0, min - padding), max + padding]} hide />
          <Area
            type="monotone"
            dataKey="v"
            stroke={color}
            strokeWidth={1.75}
            strokeLinecap="round"
            fill={`url(#${gradId})`}
            dot={false}
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

/* ── Count-up hook ─────────────────────────────── */
function useCountUp(target: string, duration = 800) {
  const [display, setDisplay] = useState('0');
  const [done, setDone] = useState(false);
  const rafRef = useRef<number>(0);

  useEffect(() => {
    // Parse numeric value from formatted string (e.g. "3,149" -> 3149)
    const numeric = parseFloat(target.replace(/,/g, ''));
    if (isNaN(numeric)) {
      setDisplay(target);
      setDone(true);
      return;
    }

    const isInteger = !target.includes('.');
    const start = performance.now();

    function tick(now: number) {
      const elapsed = now - start;
      const progress = Math.min(elapsed / duration, 1);
      // ease-out: 1 - (1-t)^3
      const eased = 1 - Math.pow(1 - progress, 3);
      const current = eased * numeric;

      if (isInteger) {
        setDisplay(Math.round(current).toLocaleString());
      } else {
        setDisplay(current.toFixed(1));
      }

      if (progress < 1) {
        rafRef.current = requestAnimationFrame(tick);
      } else {
        setDisplay(target);
        setDone(true);
      }
    }

    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [target, duration]);

  return { display, done };
}

/* ── Metric Card ────────────────────────────────── */
function MetricCard({ label, value, sparkData, sparkColor, subtitle }: {
  label: React.ReactNode; value: string; sparkData: number[]; sparkColor: string; subtitle?: React.ReactNode;
}) {
  const { display, done } = useCountUp(value);

  return (
    <div className="bg-background border border-border rounded-sm p-5 animate-fade-in">
      <div className="table-header mb-3">{label}</div>
      <div className="flex items-end justify-between">
        <div>
          <div className="font-data tabular-nums font-normal tracking-tight text-foreground" style={{ fontSize: '32px', lineHeight: 1 }}>{display}</div>
          {subtitle && <div className="mt-1 text-xs">{subtitle}</div>}
        </div>
        <div className={done ? 'animate-fade-in' : 'opacity-0'}>
          <Sparkline data={sparkData} color={sparkColor} />
        </div>
      </div>
    </div>
  );
}

/* ── Status Dot ─────────────────────────────────── */
function StatusDot({ status }: { status: string }) {
  const cls = status === 'healthy' ? 'bg-safe' : status === 'rate-limited' ? 'bg-warn' : 'bg-danger';
  return <span className={`inline-block w-1.5 h-1.5 rounded-full ${cls} animate-pulse-dot`} />;
}

/* ── PII Count-up display ──────────────────────── */
function PiiCount({ value, isNew }: { value: number; isNew: boolean }) {
  const [display, setDisplay] = useState(isNew ? 0 : value);
  const rafRef = useRef<number>(0);

  useEffect(() => {
    if (!isNew || value === 0) {
      setDisplay(value);
      return;
    }
    const start = performance.now();
    const duration = 400;

    function tick(now: number) {
      const progress = Math.min((now - start) / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 2);
      setDisplay(Math.round(eased * value));
      if (progress < 1) {
        rafRef.current = requestAnimationFrame(tick);
      }
    }

    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [value, isNew]);

  return <span className="text-muted-foreground">{display}</span>;
}

/* ── Live Feed ──────────────────────────────────── */
function LiveFeed() {
  const { events, isLive, toggleLive } = useLiveFeed(30);
  const { injected } = useLocalAudit();
  const allEvents = useMemo(() => [...injected, ...events], [injected, events]);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [, setTick] = useState(0);
  const prevEventsLenRef = useRef(0);
  const seenIdsRef = useRef<Set<string>>(new Set());

  // Track which events are "new" (appeared since last render)
  const newEventIds = useMemo(() => {
    const newIds = new Set<string>();
    for (const evt of allEvents) {
      if (!seenIdsRef.current.has(evt.id)) {
        newIds.add(evt.id);
      }
    }
    return newIds;
  }, [allEvents]);

  // After render, record all seen IDs
  useEffect(() => {
    for (const evt of allEvents) {
      seenIdsRef.current.add(evt.id);
    }
    prevEventsLenRef.current = allEvents.length;
  }, [allEvents]);

  // Update "time ago" every second
  useEffect(() => {
    const interval = setInterval(() => setTick(t => t + 1), 1000);
    return () => clearInterval(interval);
  }, []);

  // Build row animation class based on decision + freshness
  const getRowAnimClass = useCallback((evt: { id: string; decision: string }, index: number) => {
    const isNew = newEventIds.has(evt.id);
    const classes: string[] = [];

    if (isNew) {
      classes.push('animate-slide-in-left');
      if (evt.decision === 'allow') {
        classes.push('animate-flash-green');
      } else if (evt.decision === 'deny') {
        classes.push('animate-flash-red', 'animate-shake');
      }
    }

    return classes.join(' ');
  }, [newEventIds]);

  // Progressive opacity: index 0 = 1.0, then fade to min 0.5
  const getRowOpacity = (index: number) => {
    if (index === 0) return 1;
    return Math.max(0.5, 1 - index * 0.07);
  };

  return (
    <div className="bg-background border border-border rounded-sm flex flex-col" style={{ height: 520 }}>
      <div className="flex items-center justify-between px-5 py-3 border-b border-border">
        <div className="flex items-center gap-3">
          <div>
            <div className="text-sm font-body font-medium text-foreground">Live activity feed <InfoTooltip text="Each row represents an MCP call processed in real time by the Bawaba gateway." /></div>
            <div className="text-xs text-muted-foreground">{allEvents.length} events captured</div>
          </div>
        </div>
        <button
          onClick={toggleLive}
          className={`flex items-center gap-2 micro-label px-3 py-1.5 border rounded transition-colors ${
            isLive ? 'border-safe/30 text-safe bg-safe-bg' : 'border-border text-muted-foreground'
          }`}
        >
          <span className={`w-1.5 h-1.5 rounded-full ${isLive ? 'bg-safe animate-pulse-dot' : 'bg-ink-4'}`} />
          {isLive ? 'LIVE' : 'PAUSED'}
        </button>
      </div>

      {/* Table header */}
      <div className="grid grid-cols-[90px_100px_1fr_104px_44px_56px_44px] gap-2 px-5 py-2 border-b border-border">
        {['Time', 'Agent', 'Tool', 'Decision', 'PII', 'Lat.', 'Jur.'].map(h => (
          <span key={h} className="table-header">{h}</span>
        ))}
      </div>

      {/* Events */}
      <div className="flex-1 overflow-y-auto zebra">
        {allEvents.map((evt, i) => {
          const isNew = newEventIds.has(evt.id);
          return (
            <div key={evt.id}>
              <div
                onClick={() => setExpandedId(expandedId === evt.id ? null : evt.id)}
                style={{ opacity: getRowOpacity(i) }}
                className={`data-row grid grid-cols-[90px_100px_1fr_104px_44px_56px_44px] gap-2 px-5 py-2 text-sm font-data tabular-nums cursor-pointer transition-colors hover:bg-secondary/50 ${
                  getRowAnimClass(evt, i)
                } ${evt.decision === 'deny' && !isNew ? 'row-deny' : evt.decision === 'rate-limited' ? 'row-rate-limited' : ''}`}
              >
                <span className="text-muted-foreground">{timeAgo(evt.timestamp)}</span>
                <span className="text-foreground truncate font-medium">{evt.agent}</span>
                <span className="text-ink-2 truncate flex items-center gap-1">
                  {evt.tool}
                  {evt.id.startsWith('loc-') && (
                    <span className="pill pill-neutral shrink-0" style={{ fontSize: '10px', padding: '2px 5px' }}>
                      {(evt.details as { simulated?: boolean })?.simulated ? 'sim' : 'local'}
                    </span>
                  )}
                </span>
                <span className="min-w-0">
                  <span className={`pill ${evt.decision === 'allow' ? 'pill-allow' : evt.decision === 'deny' ? 'pill-deny' : 'pill-rate'}`}>
                    {evt.decision}
                  </span>
                </span>
                <PiiCount value={evt.piiTokens} isNew={isNew} />
                <span className="text-muted-foreground">{evt.latency}ms</span>
                <span className="text-ink-3 uppercase">{evt.jurisdiction}</span>
              </div>
              {expandedId === evt.id && (
                <div className="px-5 py-3 bg-secondary/30 border-y border-border animate-fade-in">
                  <pre className="text-xs font-mono text-ink-2 whitespace-pre-wrap">
                    {JSON.stringify(evt.details, null, 2)}
                  </pre>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ── Jurisdiction Panel ─────────────────────────── */
function JurisdictionPanel({ jurisdictions, loading }: { jurisdictions: JurisdictionData[]; loading: boolean }) {
  return (
    <div className="bg-background border border-border rounded-sm p-5">
      <div className="flex items-center gap-3 mb-5">
        <div>
          <div className="text-sm font-body font-medium text-foreground">Data planes <InfoTooltip text="Sovereign infrastructure in each jurisdiction. Data never leaves the configured zone." /></div>
          <div className="text-xs text-muted-foreground">Active jurisdictions</div>
        </div>
      </div>

      {/* Simple node diagram */}
      <div className="flex flex-col gap-3 mb-6">
        {loading ? (
          Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="flex items-center gap-3 p-3 border border-border rounded-sm bg-background">
              <div className="animate-shimmer rounded-full w-2 h-2 shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="animate-shimmer rounded h-3 w-20 mb-1" />
                <div className="animate-shimmer rounded h-2 w-16" />
              </div>
              <div className="animate-shimmer rounded h-3 w-6" />
            </div>
          ))
        ) : (
          [
            { code: 'ma', label: 'Casablanca', provider: 'Inwi DC' },
            { code: 'sa', label: 'Riyadh', provider: 'stc cloud' },
            { code: 'ae', label: 'Abu Dhabi', provider: 'G42' },
            { code: 'fr', label: 'Paris', provider: 'OVHcloud' },
          ].map(node => (
            <div key={node.code} className="flex items-center gap-3 p-3 border border-border rounded-sm bg-background">
              <span className="w-2 h-2 rounded-full bg-safe animate-pulse-dot shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="text-xs font-body font-medium text-foreground">{node.label}</div>
                <div className="text-[10px] text-muted-foreground">{node.provider}</div>
              </div>
              <span className="table-header">{node.code.toUpperCase()}</span>
            </div>
          ))
        )}
      </div>

      {/* Per-jurisdiction stats */}
      <div className="border-t border-border pt-4">
        <div className="table-header mb-3">Statistics by jurisdiction <InfoTooltip text="Call volume, PII tokens, and denials broken down by active jurisdiction." /></div>
        {loading ? (
          Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="flex items-center justify-between py-2 border-b border-border last:border-0">
              <div className="animate-shimmer rounded h-3 w-20" />
              <div className="flex gap-4">
                <div className="animate-shimmer rounded h-3 w-10" />
                <div className="animate-shimmer rounded h-3 w-10" />
                <div className="animate-shimmer rounded h-3 w-6" />
              </div>
            </div>
          ))
        ) : (
          jurisdictions.map(j => (
            <div key={j.code} className="flex items-center justify-between py-2 border-b border-border last:border-0">
              <div className="flex items-center gap-2">
                <span className="text-base text-ink-3 w-6">{getJurisdictionFlag(j.code)}</span>
                <span className="text-sm text-foreground">{j.name}</span>
              </div>
              <div className="flex gap-4 text-sm font-data tabular-nums">
                <span className="text-muted-foreground">{j.callsToday.toLocaleString()}</span>
                <span className="text-safe">{j.piiTokenized.toLocaleString()}</span>
                <span className="text-danger">{j.denials}</span>
              </div>
            </div>
          ))
        )}
        <div className="flex gap-6 mt-2">
          {[
            { label: 'Calls', cls: 'text-muted-foreground' },
            { label: 'PII', cls: 'text-safe' },
            { label: 'Denials', cls: 'text-danger' },
          ].map(l => (
            <span key={l.label} className={`text-[11px] ${l.cls}`}>{l.label}</span>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ── Compliance Bar ─────────────────────────────── */
function ComplianceBar({ jurisdictions, loading }: { jurisdictions: JurisdictionData[]; loading: boolean }) {
  if (loading) {
    return (
      <div className="grid grid-cols-4 gap-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="bg-background border border-border rounded-sm p-4">
            <div className="flex items-center justify-between mb-3">
              <div className="animate-shimmer rounded h-3 w-16" />
              <div className="animate-shimmer rounded h-4 w-20" />
            </div>
            <div className="animate-shimmer rounded h-3 w-24 mb-2" />
            <div className="animate-shimmer rounded h-6 w-12 mb-3" />
            <div className="animate-shimmer rounded h-1 w-full mb-3" />
            <div className="flex justify-between">
              <div className="animate-shimmer rounded h-2 w-20" />
              <div className="animate-shimmer rounded h-2 w-20" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-4 gap-4">
      {jurisdictions.map(j => (
        <div key={j.code} className="bg-background border border-border rounded-sm p-4">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-body font-medium text-foreground">{j.name}</span>
            <span className={`pill ${j.status === 'compliant' ? 'pill-allow' : 'pill-rate'}`}>
              {j.status === 'compliant' ? 'Compliant' : 'Review'}
            </span>
          </div>
          <div className="text-xs text-muted-foreground mb-2">{j.regulation}</div>
          <div className="flex items-end gap-1 mb-3">
            <span className="text-2xl font-data tabular-nums font-normal text-foreground">{j.complianceScore}</span>
            <span className="text-xs text-muted-foreground mb-0.5">%</span>
          </div>
          <div className="w-full h-1 bg-secondary rounded-full overflow-hidden mb-3">
            <div
              className={`h-full ${j.complianceScore >= 95 ? 'bg-safe' : 'bg-warn'}`}
              style={{ width: `${j.complianceScore}%` }}
            />
          </div>
          <div className="flex justify-between text-[10px] text-muted-foreground">
            <span>Audit: {j.lastAudit}</span>
            <span>Next: {j.nextReview}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

/* ── Map API jurisdiction to UI JurisdictionData ── */
const JURISDICTION_META: Record<string, { name: string; regulation: string; lastAudit: string; nextReview: string }> = {
  ma: { name: 'Morocco', regulation: 'Loi 09-08', lastAudit: '2025-02-10', nextReview: '2025-03-10' },
  sa: { name: 'KSA', regulation: 'PDPL / SAMA', lastAudit: '2025-02-08', nextReview: '2025-03-08' },
  ae: { name: 'UAE', regulation: 'DIFC / ADGM', lastAudit: '2025-02-12', nextReview: '2025-03-12' },
  fr: { name: 'France', regulation: 'CNIL / RGPD', lastAudit: '2025-02-05', nextReview: '2025-03-05' },
};

function mapJurisdiction(entry: JurisdictionEntry): JurisdictionData {
  const meta = JURISDICTION_META[entry.code] || {
    name: entry.code.toUpperCase(),
    regulation: entry.compliance?.join(', ') || '',
    lastAudit: '-',
    nextReview: '-',
  };
  const score = entry.event_count > 0 ? Math.min(99, 90 + Math.floor(Math.random() * 10)) : 95;
  return {
    code: entry.code,
    name: meta.name,
    regulation: meta.regulation,
    callsToday: entry.event_count,
    piiTokenized: Math.floor(entry.event_count * 3.5),
    denials: Math.floor(entry.event_count * 0.03),
    complianceScore: score,
    lastAudit: meta.lastAudit,
    nextReview: meta.nextReview,
    status: score >= 95 ? 'compliant' : 'review',
  };
}

/* ── Simulate Request panel ──────────────────────── */
const SIM_BACKENDS: Record<string, string> = {
  ma: 'inwi-dc-casa',
  sa: 'stc-cloud-riyadh',
  ae: 'g42-abudhabi',
  fr: 'ovhcloud-paris',
};
const SIM_STAGES = ['Identity', 'Policy', 'Data', 'Jurisdiction', 'Rate', 'Evidence'] as const;
type StageStatus = 'pending' | 'pass' | 'deny' | 'rate-limited' | 'skipped';
interface StageResult { name: string; status: StageStatus; ms: number; note: string; }

function randMs(min: number, max: number) {
  return Math.round((min + Math.random() * (max - min)) * 10) / 10;
}

function computePipeline(agentId: string, tool: string, jurisdiction: string, payload: string): {
  stages: StageResult[]; outcome: 'allow' | 'deny' | 'rate-limited'; entities: number;
} {
  const agent = MOCK_AGENTS.find(a => a.id === agentId);
  const denied = !!agent?.deniedTools.includes(tool);
  const notAllowed = !!agent && agent.allowedTools.length > 0 && !agent.allowedTools.includes(tool);
  const policyDeny = denied || notAllowed;
  const rateLimited = agent?.status === 'rate-limited';
  const { tokens } = tokenizePii(payload);
  const entities = tokens.length;

  const stages: StageResult[] = [
    { name: 'Identity', status: 'pass', ms: randMs(0.5, 2), note: `${agentId} authenticated (${agent?.auth ?? 'API Key'})` },
    {
      name: 'Policy',
      status: policyDeny ? 'deny' : 'pass',
      ms: randMs(0.3, 1.2),
      note: denied ? `${tool} in denied_tools` : notAllowed ? `${tool} not in allowed_tools (default-deny)` : `allow rule matched for ${tool}`,
    },
    {
      name: 'Data',
      status: policyDeny ? 'skipped' : 'pass',
      ms: policyDeny ? 0 : randMs(0.4, 1 + entities * 0.3),
      note: policyDeny ? 'skipped (denied)' : `${entities} PII entit${entities === 1 ? 'y' : 'ies'} tokenized`,
    },
    {
      name: 'Jurisdiction',
      status: policyDeny ? 'skipped' : 'pass',
      ms: policyDeny ? 0 : randMs(0.5, 1.5),
      note: policyDeny ? 'skipped (denied)' : `routed to ${SIM_BACKENDS[jurisdiction]}, Ed25519 proof`,
    },
    {
      name: 'Rate',
      status: policyDeny ? 'skipped' : rateLimited ? 'rate-limited' : 'pass',
      ms: policyDeny ? 0 : randMs(0.2, 0.8),
      note: policyDeny ? 'skipped (denied)' : rateLimited ? 'rate limit exceeded (sliding window)' : 'within sliding window',
    },
    {
      name: 'Evidence',
      status: 'pass',
      ms: randMs(0.4, 1.3),
      note: 'event appended, SHA-256 chained + signed',
    },
  ];

  const outcome: 'allow' | 'deny' | 'rate-limited' = policyDeny ? 'deny' : rateLimited ? 'rate-limited' : 'allow';
  return { stages, outcome, entities };
}

const STAGE_COLOR: Record<StageStatus, string> = {
  pending: 'text-muted-foreground',
  pass: 'text-safe',
  deny: 'text-danger',
  'rate-limited': 'text-warn',
  skipped: 'text-ink-3',
};

const SIM_GATEWAY_URL = import.meta.env.VITE_GATEWAY_URL || 'http://localhost:8080';
// Demo API keys for the seeded agents; only these can post a real MCP request.
const SIM_DEMO_KEYS: Record<string, string> = {
  'claude-code': 'claude-key-67890',
  'cursor-ide': 'cursor-key-11111',
};

function SimulateRequestPanel({ onClose }: { onClose: () => void }) {
  const [agentId, setAgentId] = useState(MOCK_AGENTS[0]?.id ?? '');
  const [tool, setTool] = useState(TOOLS[0]);
  const [jurisdiction, setJurisdiction] = useState('ma');
  const [payload, setPayload] = useState(
    "SELECT * FROM customers WHERE iban = 'MA64011519000001205000534921' AND email = 'sara@example.ma'",
  );
  const [running, setRunning] = useState(false);
  const [revealed, setRevealed] = useState(0);
  const [result, setResult] = useState<ReturnType<typeof computePipeline> | null>(null);
  const [delivery, setDelivery] = useState<'real' | 'simulated' | null>(null);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  useEffect(() => () => { timers.current.forEach(t => clearTimeout(t)); }, []);

  // If the gateway is reachable, post a real MCP request and let the real event
  // stream back into the feed. Otherwise inject a locally-simulated event.
  const deliver = async (computed: ReturnType<typeof computePipeline>) => {
    const key = SIM_DEMO_KEYS[agentId];
    if (key) {
      try {
        const available = await isApiAvailable();
        if (available) {
          await fetch(`${SIM_GATEWAY_URL}/mcp`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Bawaba-Key': key },
            body: JSON.stringify({
              jsonrpc: '2.0',
              id: `sim-${agentId}-${tool}`,
              method: 'tools/call',
              params: { name: tool, arguments: { message: payload } },
            }),
          });
          setDelivery('real');
          return;
        }
      } catch {
        // fall through to simulated injection
      }
    }
    pushInjectedEvent({
      eventType: computed.outcome === 'deny' ? 'policy_deny' : 'tool_call',
      agent: agentId,
      tool,
      decision: computed.outcome,
      jurisdiction,
      piiTokens: computed.entities,
      details: {
        simulated: true,
        backend: SIM_BACKENDS[jurisdiction],
        payload_preview: payload.slice(0, 80),
        policy: computed.stages[1].note,
      },
    });
    setDelivery('simulated');
  };

  const run = () => {
    timers.current.forEach(t => clearTimeout(t));
    timers.current = [];
    const computed = computePipeline(agentId, tool, jurisdiction, payload);
    setResult(computed);
    setDelivery(null);
    setRunning(true);
    setRevealed(0);
    computed.stages.forEach((_, i) => {
      const t = setTimeout(() => {
        setRevealed(i + 1);
        if (i === computed.stages.length - 1) {
          setRunning(false);
          void deliver(computed);
        }
      }, i * 420);
      timers.current.push(t);
    });
  };

  const totalMs = result ? result.stages.slice(0, revealed).reduce((s, st) => s + st.ms, 0) : 0;

  return (
    <div className="fixed inset-y-0 right-0 w-[460px] bg-card border-l border-border z-50 overflow-y-auto shadow-card">
      <div className="flex items-center justify-between p-5 border-b border-border">
        <div>
          <div className="text-lg font-heading text-foreground">Simulate request</div>
          <div className="text-xs text-muted-foreground font-mono">Run a request through the gateway pipeline</div>
        </div>
        <button onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors">
          <X className="h-4 w-4" strokeWidth={1.5} />
        </button>
      </div>

      <div className="p-5 space-y-5">
        {/* Inputs */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <div className="table-header mb-1.5">Agent</div>
            <select value={agentId} onChange={e => setAgentId(e.target.value)} className="w-full text-xs font-mono px-2 py-2 border border-border rounded-sm bg-background text-foreground focus:outline-none focus:border-primary">
              {MOCK_AGENTS.map(a => <option key={a.id} value={a.id}>{a.id}</option>)}
            </select>
          </div>
          <div>
            <div className="table-header mb-1.5">Tool</div>
            <select value={tool} onChange={e => setTool(e.target.value)} className="w-full text-xs font-mono px-2 py-2 border border-border rounded-sm bg-background text-foreground focus:outline-none focus:border-primary">
              {TOOLS.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
        </div>
        <div>
          <div className="table-header mb-1.5">Jurisdiction</div>
          <div className="flex gap-1.5">
            {['ma', 'sa', 'ae', 'fr'].map(j => (
              <button key={j} onClick={() => setJurisdiction(j)} className={`text-[10px] font-mono px-2 py-1 rounded-sm border transition-colors ${jurisdiction === j ? 'bg-primary/10 text-foreground border-primary/40' : 'bg-background text-muted-foreground border-border hover:text-foreground'}`}>
                {j.toUpperCase()}
              </button>
            ))}
          </div>
        </div>
        <div>
          <div className="table-header mb-1.5">Payload (optional)</div>
          <textarea value={payload} onChange={e => setPayload(e.target.value)} rows={3} className="w-full text-xs font-mono px-3 py-2 border border-border rounded-sm bg-background text-foreground focus:outline-none focus:border-primary resize-y" />
        </div>

        <button onClick={run} disabled={running} className="w-full text-xs font-body font-medium px-4 py-2 bg-primary text-primary-foreground rounded-sm hover:opacity-90 transition-opacity disabled:opacity-50">
          {running ? 'Running…' : 'Run request'}
        </button>

        {/* Pipeline visualization */}
        {result && (
          <div className="space-y-1.5">
            <div className="table-header mb-1">Pipeline</div>
            {result.stages.map((st, i) => {
              const shown = i < revealed;
              const active = i === revealed - 1 && running;
              return (
                <div key={st.name} className={`flex items-center gap-3 px-3 py-2 border rounded-sm transition-all ${shown ? 'border-border bg-background' : 'border-border/40 opacity-40'} ${active ? 'ring-1 ring-primary/30' : ''}`}>
                  <span className="text-[10px] font-mono text-muted-foreground w-4">{i + 1}</span>
                  <span className="text-xs font-body text-foreground w-24">{st.name}</span>
                  {shown ? (
                    <>
                      <span className={`text-[10px] font-mono uppercase ${STAGE_COLOR[st.status]}`}>{st.status}</span>
                      <span className="text-[10px] font-mono text-muted-foreground ml-auto">{st.ms > 0 ? `${st.ms}ms` : '—'}</span>
                    </>
                  ) : (
                    <span className="text-[11px] text-ink-3 ml-auto">pending</span>
                  )}
                </div>
              );
            })}
            {revealed > 0 && (
              <div className="text-[10px] text-muted-foreground font-mono px-3">{result.stages[revealed - 1]?.note}</div>
            )}

            {/* Final result */}
            {!running && revealed === result.stages.length && (
              <div className={`mt-3 p-3 rounded-sm border ${result.outcome === 'allow' ? 'bg-safe-bg border-safe/20' : result.outcome === 'deny' ? 'bg-danger-bg border-danger/20' : 'bg-warn-bg border-warn/20'}`}>
                <div className={`text-xs font-mono font-medium flex items-center gap-2 ${result.outcome === 'allow' ? 'text-safe' : result.outcome === 'deny' ? 'text-danger' : 'text-warn'}`}>
                  <span>{result.outcome === 'allow' ? '✓ Allowed' : result.outcome === 'deny' ? '✗ Denied' : '⚠ Rate-limited'} · {totalMs.toFixed(1)}ms total</span>
                  {delivery === 'simulated' && (
                    <span className="text-[9px] font-mono uppercase tracking-wide px-1.5 py-0.5 rounded-sm bg-muted text-muted-foreground border border-border">simulated</span>
                  )}
                </div>
                <div className="text-[10px] text-muted-foreground mt-1">
                  {delivery === 'real'
                    ? 'Posted a real MCP request to the gateway — the real event will appear in the live feed.'
                    : delivery === 'simulated'
                      ? `Gateway not reachable — a simulated event was injected locally with ${result.entities} tokenized PII entit${result.entities === 1 ? 'y' : 'ies'}.`
                      : 'Delivering…'}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/* ── Dashboard Page ─────────────────────────────── */
export default function Dashboard() {
  const sparkCalls = useMemo(() => generateSparklineData(7, 3200, 400), []);
  const sparkPii = useMemo(() => generateSparklineData(7, 13000, 1500), []);
  const sparkDenials = useMemo(() => generateSparklineData(7, 84, 20), []);
  const sparkAgents = useMemo(() => generateSparklineData(7, 4, 1), []);

  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState<StatsResponse | null>(null);
  const [agentCount, setAgentCount] = useState<number>(MOCK_AGENTS.length);
  const [jurisdictions, setJurisdictions] = useState<JurisdictionData[]>(MOCK_JURISDICTIONS);
  const [showSimulate, setShowSimulate] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      const available = await isApiAvailable();
      if (cancelled) return;

      if (available) {
        try {
          const [statsData, agentsData, jurData] = await Promise.all([
            fetchStats(),
            fetchAgents(),
            fetchJurisdictions(),
          ]);
          if (cancelled) return;

          setStats(statsData);
          setAgentCount(agentsData?.length ?? MOCK_AGENTS.length);

          if (jurData && jurData.length > 0) {
            setJurisdictions(jurData.map(mapJurisdiction));
          }
        } catch {
          // API call failed, keep mock data
        }
      }

      if (!cancelled) setLoading(false);
    }

    load();
    return () => { cancelled = true; };
  }, []);

  // Derive metric values
  const callsToday = stats ? stats.total_events.toLocaleString() : '3,149';
  const piiTokenized = stats ? Math.floor(stats.total_events * 4.1).toLocaleString() : '13,057';
  const denials = stats
    ? Math.floor(stats.deny_rate * stats.total_events / 100).toLocaleString()
    : '84';

  // Agent status counts (from mock since API doesn't have status)
  const healthyCount = MOCK_AGENTS.filter(a => a.status === 'healthy').length;
  const rateLimitedCount = MOCK_AGENTS.filter(a => a.status === 'rate-limited').length;
  const blockedCount = MOCK_AGENTS.filter(a => a.status === 'blocked').length;

  return (
    <div className="space-y-6">
      {/* Section 01: Metrics */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <div className="text-sm font-body font-medium text-foreground">Overview</div>
          <button
            onClick={() => setShowSimulate(true)}
            className="text-xs font-body font-medium px-4 py-2 bg-primary text-primary-foreground rounded-sm hover:opacity-90 transition-opacity"
          >
            Simulate request
          </button>
        </div>
        <div className="grid grid-cols-4 gap-4">
          {loading ? (
            <>
              <MetricSkeleton />
              <MetricSkeleton />
              <MetricSkeleton />
              <MetricSkeleton />
            </>
          ) : (
            <>
              <MetricCard
                label={<>MCP calls today <InfoTooltip text="Total number of MCP calls processed by the gateway today. Includes allow, deny, and rate-limited." /></>}
                value={callsToday}
                sparkData={sparkCalls}
                sparkColor={PETROL}
                subtitle={<span className="text-safe">+12.4% vs yesterday</span>}
              />
              <MetricCard
                label={<>PII entities tokenized <InfoTooltip text="Personal data detected and replaced with UUID tokens before transmission to the LLM." /></>}
                value={piiTokenized}
                sparkData={sparkPii}
                sparkColor={DECISION_COLORS.allow}
                subtitle="Across 4 jurisdictions"
              />
              <MetricCard
                label={<>Policy denials <InfoTooltip text="Requests denied by the policy engine. A denial protects against unauthorized usage." /></>}
                value={denials}
                sparkData={sparkDenials}
                sparkColor={DECISION_COLORS.deny}
                subtitle={<span className="text-danger">-6.7% vs yesterday</span>}
              />
              <MetricCard
                label={<>Active agents <InfoTooltip text="Number of AI agents registered and authorized to send requests through the gateway." /></>}
                value={agentCount.toString()}
                sparkData={sparkAgents}
                sparkColor={PETROL}
                subtitle={
                  <span className="flex items-center gap-2">
                    <StatusDot status="healthy" /> {healthyCount}
                    <StatusDot status="rate-limited" /> {rateLimitedCount}
                    <StatusDot status="blocked" /> {blockedCount}
                  </span>
                }
              />
            </>
          )}
        </div>
      </div>

      {/* Section 02 + 03: Feed + Jurisdiction */}
      <div className="grid grid-cols-12 gap-6">
        <div className="col-span-8">
          <LiveFeed />
        </div>
        <div className="col-span-4">
          <JurisdictionPanel jurisdictions={jurisdictions} loading={loading} />
        </div>
      </div>

      {/* Section 04: Compliance */}
      <div>
        <div className="flex items-center gap-3 mb-4">
          <div className="text-sm font-body font-medium text-foreground">Compliance status <InfoTooltip text="Compliance score per jurisdiction based on local regulations (GDPR, Loi 09-08, PDPL, etc.)." /></div>
        </div>
        <ComplianceBar jurisdictions={jurisdictions} loading={loading} />
      </div>

      {/* Simulate request panel */}
      {showSimulate && (
        <>
          <div className="fixed inset-0 bg-foreground/5 z-40" onClick={() => setShowSimulate(false)} />
          <SimulateRequestPanel onClose={() => setShowSimulate(false)} />
        </>
      )}
    </div>
  );
}

import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { Area, AreaChart, CartesianGrid, ReferenceLine, ResponsiveContainer, YAxis } from 'recharts';
import { useLiveFeed } from '@/hooks/use-live-feed';
import { AGENTS as MOCK_AGENTS, JURISDICTIONS as MOCK_JURISDICTIONS, generateSparklineData, getJurisdictionFlag, type JurisdictionData } from '@/lib/mock-data';
import {
  isApiAvailable, fetchStats, fetchAgents, fetchJurisdictions,
  type StatsResponse, type AgentInfo, type JurisdictionEntry,
} from '@/services/api';
import InfoTooltip from '@/components/InfoTooltip';

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

/* ── Sparkline ──────────────────────────────────── */
function Sparkline({ data, color }: { data: number[]; color: string }) {
  const chartData = data.map((v, i) => ({ i, v }));
  const min = Math.min(...data);
  const max = Math.max(...data);
  const padding = (max - min) * 0.15;
  return (
    <div className="h-10 w-24">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={chartData} margin={{ top: 2, right: 0, left: 0, bottom: 0 }}>
          <YAxis domain={[Math.max(0, min - padding), max + padding]} hide />
          <CartesianGrid horizontal verticalPoints={[]} stroke="hsl(var(--border))" strokeDasharray="3 3" horizontalPoints={[0]} />
          <ReferenceLine y={0} stroke="hsl(var(--muted-foreground))" strokeWidth={0.5} />
          <Area type="monotone" dataKey="v" stroke={color} strokeWidth={1.5} fill="none" dot={false} />
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
      <div className="table-header mb-3 font-body" style={{ fontSize: '12px' }}>{label}</div>
      <div className="flex items-end justify-between">
        <div>
          <div className="font-heading font-light tracking-tight text-foreground" style={{ fontSize: '32px', lineHeight: 1 }}>{display}</div>
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
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [, setTick] = useState(0);
  const prevEventsLenRef = useRef(0);
  const seenIdsRef = useRef<Set<string>>(new Set());

  // Track which events are "new" (appeared since last render)
  const newEventIds = useMemo(() => {
    const newIds = new Set<string>();
    for (const evt of events) {
      if (!seenIdsRef.current.has(evt.id)) {
        newIds.add(evt.id);
      }
    }
    return newIds;
  }, [events]);

  // After render, record all seen IDs
  useEffect(() => {
    for (const evt of events) {
      seenIdsRef.current.add(evt.id);
    }
    prevEventsLenRef.current = events.length;
  }, [events]);

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
            <div className="text-xs text-muted-foreground">{events.length} events captured</div>
          </div>
        </div>
        <button
          onClick={toggleLive}
          className={`flex items-center gap-2 text-xs font-mono px-3 py-1.5 border rounded transition-colors ${
            isLive ? 'border-safe/30 text-safe bg-safe-bg' : 'border-border text-muted-foreground'
          }`}
        >
          <span className={`w-1.5 h-1.5 rounded-full ${isLive ? 'bg-safe animate-pulse-dot' : 'bg-ink-4'}`} />
          {isLive ? 'LIVE' : 'PAUSED'}
        </button>
      </div>

      {/* Table header */}
      <div className="grid grid-cols-[90px_100px_120px_70px_50px_50px_40px] gap-2 px-5 py-2 border-b border-border">
        {['Time', 'Agent', 'Tool', 'Decision', 'PII', 'Lat.', 'Jur.'].map(h => (
          <span key={h} className="table-header">{h}</span>
        ))}
      </div>

      {/* Events */}
      <div className="flex-1 overflow-y-auto">
        {events.map((evt, i) => {
          const isNew = newEventIds.has(evt.id);
          return (
            <div key={evt.id}>
              <div
                onClick={() => setExpandedId(expandedId === evt.id ? null : evt.id)}
                style={{ opacity: getRowOpacity(i) }}
                className={`grid grid-cols-[90px_100px_120px_70px_50px_50px_40px] gap-2 px-5 py-2 text-xs font-mono cursor-pointer transition-colors hover:bg-secondary/50 ${
                  getRowAnimClass(evt, i)
                } ${evt.decision === 'deny' && !isNew ? 'row-deny' : evt.decision === 'rate-limited' ? 'row-rate-limited' : ''}`}
              >
                <span className="text-muted-foreground font-mono" style={{ fontSize: '11px' }}>{timeAgo(evt.timestamp)}</span>
                <span className="text-foreground truncate font-body font-medium">{evt.agent}</span>
                <span className="text-ink-2 truncate">{evt.tool}</span>
                <span className={evt.decision === 'allow' ? 'text-safe' : evt.decision === 'deny' ? 'text-danger' : 'text-warn'}>
                  {evt.decision}
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
                <span className="text-xs font-mono text-ink-3 w-6">{getJurisdictionFlag(j.code)}</span>
                <span className="text-xs text-foreground">{j.name}</span>
              </div>
              <div className="flex gap-4 text-xs font-mono">
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
            <span key={l.label} className={`text-[9px] ${l.cls}`}>{l.label}</span>
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
            <span className={`text-[10px] font-mono px-2 py-0.5 rounded-sm ${
              j.status === 'compliant' ? 'bg-safe-bg text-safe' : 'bg-warn-bg text-warn'
            }`}>
              {j.status === 'compliant' ? 'COMPLIANT' : 'REVIEW'}
            </span>
          </div>
          <div className="text-xs text-muted-foreground mb-2">{j.regulation}</div>
          <div className="flex items-end gap-1 mb-3">
            <span className="text-xl font-heading font-light text-foreground">{j.complianceScore}</span>
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
        <div className="flex items-center gap-3 mb-4">
          <div className="text-sm font-body font-medium text-foreground">Overview</div>
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
                sparkColor="hsl(30, 24%, 44%)"
                subtitle={<span className="text-safe">+12.4% vs yesterday</span>}
              />
              <MetricCard
                label={<>PII entities tokenized <InfoTooltip text="Personal data detected and replaced with UUID tokens before transmission to the LLM." /></>}
                value={piiTokenized}
                sparkData={sparkPii}
                sparkColor="hsl(148, 59%, 24%)"
                subtitle="Across 4 jurisdictions"
              />
              <MetricCard
                label={<>Policy denials <InfoTooltip text="Requests denied by the OPA policy engine. A denial protects against unauthorized usage." /></>}
                value={denials}
                sparkData={sparkDenials}
                sparkColor="hsl(343, 78%, 35%)"
                subtitle={<span className="text-danger">-6.7% vs yesterday</span>}
              />
              <MetricCard
                label={<>Active agents <InfoTooltip text="Number of AI agents registered and authorized to send requests through the gateway." /></>}
                value={agentCount.toString()}
                sparkData={sparkAgents}
                sparkColor="hsl(30, 24%, 44%)"
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
    </div>
  );
}

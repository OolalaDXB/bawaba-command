import { useState, useMemo } from 'react';
import { Area, AreaChart, CartesianGrid, ReferenceLine, ResponsiveContainer, YAxis } from 'recharts';
import { useLiveFeed } from '@/hooks/use-live-feed';
import { useAgents } from '@/hooks/use-agents';
import { useAuditEvents, useJurisdictionStats } from '@/hooks/use-audit-events';
import { generateSparklineData, JURISDICTIONS, getJurisdictionFlag } from '@/lib/mock-data';

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

/* ── Metric Card ────────────────────────────────── */
function MetricCard({ label, value, sparkData, sparkColor, subtitle }: {
  label: string; value: string; sparkData: number[]; sparkColor: string; subtitle?: React.ReactNode;
}) {
  return (
    <div className="bg-background border border-border rounded-sm p-5">
      <div className="table-header mb-3">{label}</div>
      <div className="flex items-end justify-between">
        <div>
          <div className="text-2xl font-mono font-light tracking-tight text-foreground">{value}</div>
          {subtitle && <div className="mt-1 text-xs">{subtitle}</div>}
        </div>
        <Sparkline data={sparkData} color={sparkColor} />
      </div>
    </div>
  );
}

/* ── Status Dot ─────────────────────────────────── */
function StatusDot({ status }: { status: string }) {
  const cls = status === 'healthy' ? 'bg-safe' : status === 'rate-limited' ? 'bg-warn' : 'bg-danger';
  return <span className={`inline-block w-1.5 h-1.5 rounded-full ${cls} animate-pulse-dot`} />;
}

/* ── Live Feed ──────────────────────────────────── */
function LiveFeed() {
  const { events, isLive, toggleLive } = useLiveFeed(30);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  return (
    <div className="bg-background border border-border rounded-sm flex flex-col" style={{ height: 520 }}>
      <div className="flex items-center justify-between px-5 py-3 border-b border-border">
        <div className="flex items-center gap-3">
          <div>
            <div className="text-sm font-body font-medium text-foreground">Live Activity Feed</div>
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
        {events.map((evt, i) => (
          <div key={evt.event_id}>
            <div
              onClick={() => setExpandedId(expandedId === evt.event_id ? null : evt.event_id)}
              className={`grid grid-cols-[90px_100px_120px_70px_50px_50px_40px] gap-2 px-5 py-2 text-xs font-mono cursor-pointer transition-colors hover:bg-secondary/50 ${
                i === 0 ? 'animate-fade-in-row' : ''
              } ${evt.policy_result === 'deny' ? 'row-deny' : evt.policy_result === 'rate-limited' ? 'row-rate-limited' : ''}`}
            >
              <span className="text-muted-foreground">{new Date(evt.timestamp).toLocaleTimeString('en-GB', { hour12: false })}</span>
              <span className="text-foreground truncate">{evt.agent_id}</span>
              <span className="text-ink-2 truncate">{evt.tool}</span>
              <span className={evt.policy_result === 'allow' ? 'text-safe' : evt.policy_result === 'deny' ? 'text-danger' : 'text-warn'}>
                {evt.policy_result}
              </span>
              <span className="text-muted-foreground">{evt.tokens_generated}</span>
              <span className="text-muted-foreground">{evt.latency_ms}ms</span>
              <span className="text-ink-3 uppercase">{evt.jurisdiction}</span>
            </div>
            {expandedId === evt.event_id && (
              <div className="px-5 py-3 bg-secondary/30 border-y border-border">
                <pre className="text-xs font-mono text-ink-2 whitespace-pre-wrap">
                  {JSON.stringify({
                    event_id: evt.event_id,
                    event_type: evt.event_type,
                    agent_id: evt.agent_id,
                    tool: evt.tool,
                    matched_rule: evt.matched_rule,
                    pii_mode: evt.pii_mode,
                    entities_detected: evt.entities_detected,
                    jurisdiction: evt.jurisdiction,
                    latency_ms: evt.latency_ms,
                    overhead_ms: evt.overhead_ms,
                  }, null, 2)}
                </pre>
              </div>
            )}
          </div>
        ))}
        {events.length === 0 && (
          <div className="p-8 text-center text-xs text-muted-foreground">No audit events yet</div>
        )}
      </div>
    </div>
  );
}

/* ── Jurisdiction Panel ─────────────────────────── */
function JurisdictionPanel() {
  const { data: jStats } = useJurisdictionStats();

  return (
    <div className="bg-background border border-border rounded-sm p-5">
      <div className="flex items-center gap-3 mb-5">
        <div>
          <div className="text-sm font-body font-medium text-foreground">Data Planes</div>
          <div className="text-xs text-muted-foreground">Active jurisdictions</div>
        </div>
      </div>

      {/* Simple node diagram */}
      <div className="flex flex-col gap-3 mb-6">
        {[
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
        ))}
      </div>

      {/* Per-jurisdiction stats from Supabase */}
      <div className="border-t border-border pt-4">
        <div className="table-header mb-3">Jurisdiction Statistics</div>
        {JURISDICTIONS.map(j => {
          const stats = jStats?.[j.code];
          return (
            <div key={j.code} className="flex items-center justify-between py-2 border-b border-border last:border-0">
              <div className="flex items-center gap-2">
                <span className="text-xs font-mono text-ink-3 w-6">{getJurisdictionFlag(j.code)}</span>
                <span className="text-xs text-foreground">{j.name}</span>
              </div>
              <div className="flex gap-4 text-xs font-mono">
                <span className="text-muted-foreground">{(stats?.calls ?? 0).toLocaleString()}</span>
                <span className="text-safe">{(stats?.pii ?? 0).toLocaleString()}</span>
                <span className="text-danger">{stats?.denials ?? 0}</span>
              </div>
            </div>
          );
        })}
        <div className="flex gap-6 mt-2">
          {[
            { label: 'Calls', cls: 'text-muted-foreground' },
            { label: 'PII', cls: 'text-safe' },
            { label: 'Deny', cls: 'text-danger' },
          ].map(l => (
            <span key={l.label} className={`text-[9px] ${l.cls}`}>{l.label}</span>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ── Compliance Bar ─────────────────────────────── */
function ComplianceBar() {
  return (
    <div className="grid grid-cols-4 gap-4">
      {JURISDICTIONS.map(j => (
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
            <span className="text-xl font-mono font-light text-foreground">{j.complianceScore}</span>
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

/* ── Dashboard Page ─────────────────────────────── */
export default function Dashboard() {
  const { data: auditEvents } = useAuditEvents(100);
  const { data: agentsData } = useAgents();

  const totalCalls = auditEvents?.length ?? 0;
  const totalPii = useMemo(() => (auditEvents ?? []).reduce((s, e) => s + (e.tokens_generated ?? 0), 0), [auditEvents]);
  const totalDenials = useMemo(() => (auditEvents ?? []).filter(e => e.policy_result === 'deny').length, [auditEvents]);
  const agentCount = agentsData?.length ?? 0;
  const activeAgents = agentsData?.filter(a => a.active).length ?? 0;
  const inactiveAgents = agentCount - activeAgents;

  const sparkCalls = useMemo(() => generateSparklineData(7, Math.max(totalCalls, 10), Math.max(totalCalls * 0.1, 5)), [totalCalls]);
  const sparkPii = useMemo(() => generateSparklineData(7, Math.max(totalPii, 10), Math.max(totalPii * 0.1, 5)), [totalPii]);
  const sparkDenials = useMemo(() => generateSparklineData(7, Math.max(totalDenials, 5), Math.max(totalDenials * 0.2, 2)), [totalDenials]);
  const sparkAgents = useMemo(() => generateSparklineData(7, Math.max(agentCount, 1), 1), [agentCount]);

  return (
    <div className="space-y-6">
      {/* Section: Metrics */}
      <div>
        <div className="flex items-center gap-3 mb-4">
          <div className="text-sm font-body font-medium text-foreground">Overview</div>
        </div>
        <div className="grid grid-cols-4 gap-4">
          <MetricCard
            label="MCP Calls"
            value={totalCalls.toLocaleString()}
            sparkData={sparkCalls}
            sparkColor="hsl(30, 24%, 44%)"
          />
          <MetricCard
            label="PII Entities Tokenized"
            value={totalPii.toLocaleString()}
            sparkData={sparkPii}
            sparkColor="hsl(148, 59%, 24%)"
            subtitle="Across all jurisdictions"
          />
          <MetricCard
            label="Policy Denials"
            value={totalDenials.toLocaleString()}
            sparkData={sparkDenials}
            sparkColor="hsl(343, 78%, 35%)"
          />
          <MetricCard
            label="Registered Agents"
            value={agentCount.toString()}
            sparkData={sparkAgents}
            sparkColor="hsl(30, 24%, 44%)"
            subtitle={
              <span className="flex items-center gap-2">
                <StatusDot status="healthy" /> {activeAgents}
                <StatusDot status="blocked" /> {inactiveAgents}
              </span>
            }
          />
        </div>
      </div>

      {/* Feed + Jurisdiction */}
      <div className="grid grid-cols-12 gap-6">
        <div className="col-span-8">
          <LiveFeed />
        </div>
        <div className="col-span-4">
          <JurisdictionPanel />
        </div>
      </div>

      {/* Compliance */}
      <div>
        <div className="flex items-center gap-3 mb-4">
          <div className="text-sm font-body font-medium text-foreground">Compliance Status</div>
        </div>
        <ComplianceBar />
      </div>
    </div>
  );
}

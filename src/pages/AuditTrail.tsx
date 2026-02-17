import { useState, useMemo } from 'react';
import { generateInitialEvents, getJurisdictionName, type MCPEvent, AGENTS, TOOLS } from '@/lib/mock-data';
import { BarChart, Bar, PieChart, Pie, Cell, LineChart, Line, ResponsiveContainer, XAxis, YAxis, Tooltip } from 'recharts';

/* ── Merkle Chain Viz ───────────────────────────── */
function MerkleChain({ events }: { events: MCPEvent[] }) {
  const chain = events.slice(0, 6);
  return (
    <div className="card-surface shadow-card p-5">
      <div className="flex items-center gap-3 mb-4">
        <span className="section-number">02</span>
        <div>
          <div className="text-sm font-body font-medium text-foreground">Hash Chain</div>
          <div className="text-xs text-muted-foreground">Tamper-evident audit trail</div>
        </div>
      </div>

      <div className="flex items-center gap-0 overflow-x-auto pb-2">
        {chain.map((evt, i) => (
          <div key={evt.id} className="flex items-center shrink-0">
            <div className="border border-border rounded-sm p-3 bg-background min-w-[140px]">
              <div className="text-[9px] text-muted-foreground mb-1">{evt.id}</div>
              <div className="font-mono text-[10px] text-foreground truncate">{evt.hash}</div>
              <div className="text-[9px] text-muted-foreground mt-1.5 flex items-center gap-1">
                <span>prev:</span>
                <span className="font-mono">{evt.prevHash.slice(0, 8)}…</span>
              </div>
              <div className={`text-[9px] font-mono mt-1 ${
                evt.decision === 'allow' ? 'text-safe' : evt.decision === 'deny' ? 'text-danger' : 'text-warn'
              }`}>
                {evt.decision}
              </div>
            </div>
            {i < chain.length - 1 && (
              <div className="w-6 h-px bg-ink-5 shrink-0" />
            )}
          </div>
        ))}
      </div>

      <div className="mt-4 flex items-center gap-3 p-3 bg-safe-bg border border-safe/10 rounded-sm">
        <span className="w-2 h-2 rounded-full bg-safe" />
        <span className="text-xs text-safe font-mono">Merkle root verified</span>
        <span className="text-[10px] text-muted-foreground font-mono ml-auto">Root: {chain[0]?.hash || '—'}</span>
      </div>
    </div>
  );
}

/* ── Audit Stats Sidebar ────────────────────────── */
function AuditStats({ events }: { events: MCPEvent[] }) {
  const byDecision = useMemo(() => {
    const counts: Record<string, number> = { allow: 0, deny: 0, 'rate-limited': 0 };
    events.forEach(e => { counts[e.decision] = (counts[e.decision] || 0) + 1; });
    return Object.entries(counts).map(([name, value]) => ({ name, value }));
  }, [events]);

  const byJurisdiction = useMemo(() => {
    const counts: Record<string, number> = {};
    events.forEach(e => { counts[e.jurisdiction] = (counts[e.jurisdiction] || 0) + 1; });
    return Object.entries(counts).map(([code, value]) => ({ name: getJurisdictionName(code), value }));
  }, [events]);

  const byAgent = useMemo(() => {
    const counts: Record<string, number> = {};
    events.forEach(e => { counts[e.agent] = (counts[e.agent] || 0) + 1; });
    return Object.entries(counts).map(([name, value]) => ({ name, value }));
  }, [events]);

  const latencyTrend = useMemo(() => {
    return Array.from({ length: 7 }, (_, i) => ({
      day: `D-${7 - i}`,
      avg: Math.floor(Math.random() * 8) + 4,
    }));
  }, []);

  const COLORS = ['hsl(148, 59%, 24%)', 'hsl(343, 78%, 35%)', 'hsl(28, 84%, 31%)'];

  return (
    <div className="space-y-5">
      {/* By Decision */}
      <div className="card-surface shadow-card p-4">
        <div className="table-header mb-3">By Decision</div>
        <div className="h-28">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie data={byDecision} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={45} strokeWidth={1} stroke="hsl(0, 0%, 100%)">
                {byDecision.map((_, i) => <Cell key={i} fill={COLORS[i]} />)}
              </Pie>
              <Tooltip contentStyle={{ fontSize: 10, fontFamily: 'JetBrains Mono' }} />
            </PieChart>
          </ResponsiveContainer>
        </div>
        <div className="flex justify-center gap-4 mt-2">
          {byDecision.map((d, i) => (
            <span key={d.name} className="flex items-center gap-1 text-[10px] text-muted-foreground">
              <span className="w-2 h-2 rounded-full" style={{ background: COLORS[i] }} />
              {d.name} ({d.value})
            </span>
          ))}
        </div>
      </div>

      {/* By Jurisdiction */}
      <div className="card-surface shadow-card p-4">
        <div className="table-header mb-3">By Jurisdiction</div>
        <div className="h-28">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={byJurisdiction} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
              <XAxis dataKey="name" tick={{ fontSize: 9 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 9 }} axisLine={false} tickLine={false} />
              <Bar dataKey="value" fill="hsl(30, 24%, 44%)" radius={[1, 1, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* By Agent */}
      <div className="card-surface shadow-card p-4">
        <div className="table-header mb-3">By Agent</div>
        <div className="h-28">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={byAgent} layout="vertical" margin={{ top: 0, right: 0, left: 0, bottom: 0 }}>
              <XAxis type="number" tick={{ fontSize: 9 }} axisLine={false} tickLine={false} />
              <YAxis type="category" dataKey="name" tick={{ fontSize: 9, fontFamily: 'JetBrains Mono' }} axisLine={false} tickLine={false} width={90} />
              <Bar dataKey="value" fill="hsl(30, 24%, 44%)" radius={[0, 1, 1, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Latency Trend */}
      <div className="card-surface shadow-card p-4">
        <div className="table-header mb-3">Avg Latency (7d)</div>
        <div className="h-20">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={latencyTrend} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
              <XAxis dataKey="day" tick={{ fontSize: 9 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 9 }} axisLine={false} tickLine={false} />
              <Line type="monotone" dataKey="avg" stroke="hsl(30, 24%, 44%)" strokeWidth={1.5} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}

/* ── Audit Trail Page ───────────────────────────── */
export default function AuditTrail() {
  const events = useMemo(() => generateInitialEvents(50), []);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [filterDecision, setFilterDecision] = useState<string>('all');

  const filtered = filterDecision === 'all' ? events : events.filter(e => e.decision === filterDecision);

  return (
    <div className="space-y-6">
      {/* Export controls */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="section-number">01</span>
          <div>
            <div className="text-sm font-body font-medium text-foreground">Audit Explorer</div>
            <div className="text-xs text-muted-foreground">{events.length} events · Tamper-evident chain</div>
          </div>
        </div>
        <div className="flex gap-2">
          <button className="text-xs font-body px-3 py-1.5 border border-border rounded-sm text-muted-foreground hover:text-foreground transition-colors">
            Export to SIEM
          </button>
          <button className="text-xs font-body px-3 py-1.5 border border-border rounded-sm text-muted-foreground hover:text-foreground transition-colors">
            Generate Report
          </button>
          <button className="text-xs font-body px-3 py-1.5 bg-safe-bg border border-safe/10 text-safe rounded-sm hover:opacity-90 transition-opacity">
            Verify Merkle Root
          </button>
        </div>
      </div>

      {/* Merkle Chain */}
      <MerkleChain events={events} />

      {/* Main content + stats sidebar */}
      <div className="grid grid-cols-12 gap-6">
        <div className="col-span-8">
          {/* Filters */}
          <div className="flex gap-2 mb-4">
            {['all', 'allow', 'deny', 'rate-limited'].map(f => (
              <button
                key={f}
                onClick={() => setFilterDecision(f)}
                className={`text-xs font-mono px-3 py-1.5 rounded-sm border transition-colors ${
                  filterDecision === f ? 'border-primary bg-primary/5 text-foreground' : 'border-border text-muted-foreground hover:text-foreground'
                }`}
              >
                {f === 'all' ? 'All' : f}
              </button>
            ))}
          </div>

          {/* Table */}
          <div className="card-surface shadow-card overflow-hidden">
            <div className="grid grid-cols-[80px_100px_110px_70px_50px_50px_80px] gap-2 px-5 py-2 border-b border-border">
              {['Time', 'Agent', 'Tool', 'Result', 'PII', 'Lat.', 'Hash'].map(h => (
                <span key={h} className="table-header">{h}</span>
              ))}
            </div>
            <div className="max-h-[400px] overflow-y-auto">
              {filtered.map(evt => (
                <div key={evt.id}>
                  <div
                    onClick={() => setExpandedId(expandedId === evt.id ? null : evt.id)}
                    className={`grid grid-cols-[80px_100px_110px_70px_50px_50px_80px] gap-2 px-5 py-2 text-xs font-mono cursor-pointer hover:bg-secondary/30 transition-colors border-b border-border ${
                      evt.decision === 'deny' ? 'row-deny' : evt.decision === 'rate-limited' ? 'row-rate-limited' : ''
                    }`}
                  >
                    <span className="text-muted-foreground">{evt.timestamp.toLocaleTimeString('en-GB', { hour12: false })}</span>
                    <span className="text-foreground truncate">{evt.agent}</span>
                    <span className="text-ink-2 truncate">{evt.tool}</span>
                    <span className={evt.decision === 'allow' ? 'text-safe' : evt.decision === 'deny' ? 'text-danger' : 'text-warn'}>{evt.decision}</span>
                    <span className="text-muted-foreground">{evt.piiTokens}</span>
                    <span className="text-muted-foreground">{evt.latency}ms</span>
                    <span className="text-ink-4 truncate">{evt.hash.slice(0, 8)}…</span>
                  </div>
                  {expandedId === evt.id && (
                    <div className="px-5 py-3 bg-secondary/20 border-b border-border">
                      <div className="flex gap-4 mb-2">
                        <span className="text-[10px] text-muted-foreground">prev_hash: <span className="font-mono text-ink-3">{evt.prevHash}</span></span>
                        <span className="text-[10px] text-muted-foreground">event_hash: <span className="font-mono text-ink-3">{evt.hash}</span></span>
                      </div>
                      <pre className="text-xs font-mono text-ink-2 whitespace-pre-wrap">{JSON.stringify(evt.details, null, 2)}</pre>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="col-span-4">
          <AuditStats events={events} />
        </div>
      </div>
    </div>
  );
}

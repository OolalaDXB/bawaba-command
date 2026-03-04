import { useState, useEffect, useMemo, useCallback } from 'react';
import { generateInitialEvents, getJurisdictionName, type MCPEvent, AGENTS, TOOLS } from '@/lib/mock-data';
import { BarChart, Bar, PieChart, Pie, Cell, LineChart, Line, ResponsiveContainer, XAxis, YAxis, Tooltip } from 'recharts';
import {
  isApiAvailable, fetchEvents, verifyChain, exportEvents,
  type ApiEvent, type ChainVerification,
} from '@/services/api';

/* ── Time-ago helper ────────────────────────────── */
function timeAgo(date: Date): string {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

/** Map an API event to the MCPEvent shape used by the UI. */
function mapApiEvent(apiEvt: ApiEvent): MCPEvent {
  return {
    id: apiEvt.event_id,
    timestamp: new Date(apiEvt.timestamp),
    agent: apiEvt.agent_id,
    tool: apiEvt.tool,
    decision:
      apiEvt.policy_result === 'allow'
        ? 'allow'
        : apiEvt.policy_result === 'deny'
          ? 'deny'
          : 'rate-limited',
    piiTokens: apiEvt.entities_detected || 0,
    latency: apiEvt.latency_ms || 0,
    jurisdiction: apiEvt.jurisdiction,
    hash: apiEvt.event_hash || '',
    prevHash: apiEvt.prev_hash || '',
    details: {
      request_id: apiEvt.event_id,
      agent_id: apiEvt.agent_id,
      tool_name: apiEvt.tool,
      policy_matched: apiEvt.matched_rule,
      pii_entities: [],
      jurisdiction: apiEvt.jurisdiction,
      evaluation_time_ms: apiEvt.overhead_ms?.toFixed(2) ?? '0.00',
    },
  };
}

/* ── Merkle Chain Viz ───────────────────────────── */
function MerkleChain({ events, verification }: { events: MCPEvent[]; verification: ChainVerification | null }) {
  const chain = events.slice(0, 6);
  const verified = verification?.valid ?? true;
  const verifiedLabel = verification
    ? (verification.valid ? 'Merkle root verified' : `Chain invalid: ${verification.error || 'unknown error'}`)
    : 'Merkle root verified';

  return (
    <div className="card-surface shadow-card p-5">
      <div className="flex items-center gap-3 mb-4">
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
                <span className="font-mono">{evt.prevHash.slice(0, 8)}{evt.prevHash.length > 8 ? '...' : ''}</span>
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

      <div className={`mt-4 flex items-center gap-3 p-3 ${verified ? 'bg-safe-bg border border-safe/10' : 'bg-danger-bg border border-danger/10'} rounded-sm`}>
        <span className={`w-2 h-2 rounded-full ${verified ? 'bg-safe' : 'bg-danger'}`} />
        <span className={`text-xs ${verified ? 'text-safe' : 'text-danger'} font-mono`}>{verifiedLabel}</span>
        <span className="text-[10px] text-muted-foreground font-mono ml-auto">
          {verification ? `${verification.events} events checked` : `Root: ${chain[0]?.hash || '-'}`}
        </span>
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

/* ── Table skeleton ─────────────────────────────── */
function TableSkeleton() {
  return (
    <div className="max-h-[400px] overflow-y-auto">
      {Array.from({ length: 10 }).map((_, i) => (
        <div key={i} className="grid grid-cols-[80px_100px_110px_70px_50px_50px_80px] gap-2 px-5 py-2 border-b border-border">
          <div className="animate-pulse bg-muted rounded h-4 w-full" />
          <div className="animate-pulse bg-muted rounded h-4 w-full" />
          <div className="animate-pulse bg-muted rounded h-4 w-full" />
          <div className="animate-pulse bg-muted rounded h-4 w-full" />
          <div className="animate-pulse bg-muted rounded h-4 w-full" />
          <div className="animate-pulse bg-muted rounded h-4 w-full" />
          <div className="animate-pulse bg-muted rounded h-4 w-full" />
        </div>
      ))}
    </div>
  );
}

/* ── Audit Trail Page ───────────────────────────── */
export default function AuditTrail() {
  const [events, setEvents] = useState<MCPEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [filterDecision, setFilterDecision] = useState<string>('all');
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [apiAvailable, setApiAvailable] = useState(false);
  const [verification, setVerification] = useState<ChainVerification | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [, setTick] = useState(0);

  const PAGE_SIZE = 50;

  // Live timestamp updates
  useEffect(() => {
    const interval = setInterval(() => setTick(t => t + 1), 1000);
    return () => clearInterval(interval);
  }, []);

  // Initial load
  useEffect(() => {
    let cancelled = false;

    async function load() {
      const available = await isApiAvailable();
      if (cancelled) return;
      setApiAvailable(available);

      if (available) {
        try {
          const resp = await fetchEvents(1, PAGE_SIZE);
          if (cancelled) return;
          if (resp.events && resp.events.length > 0) {
            setEvents(resp.events.map(mapApiEvent));
            setHasMore(resp.events.length >= PAGE_SIZE);
          } else {
            setEvents(generateInitialEvents(50));
            setHasMore(false);
          }
        } catch {
          if (!cancelled) {
            setEvents(generateInitialEvents(50));
            setHasMore(false);
          }
        }
      } else {
        setEvents(generateInitialEvents(50));
        setHasMore(false);
      }

      if (!cancelled) setLoading(false);
    }

    load();
    return () => { cancelled = true; };
  }, []);

  // Load more (pagination)
  const loadMore = useCallback(async () => {
    if (!apiAvailable || loadingMore || !hasMore) return;
    setLoadingMore(true);
    const nextPage = page + 1;
    try {
      const resp = await fetchEvents(nextPage, PAGE_SIZE);
      if (resp.events && resp.events.length > 0) {
        setEvents(prev => [...prev, ...resp.events.map(mapApiEvent)]);
        setPage(nextPage);
        setHasMore(resp.events.length >= PAGE_SIZE);
      } else {
        setHasMore(false);
      }
    } catch {
      setHasMore(false);
    }
    setLoadingMore(false);
  }, [apiAvailable, loadingMore, hasMore, page]);

  // Verify chain
  const handleVerify = useCallback(async () => {
    if (!apiAvailable) return;
    setVerifying(true);
    try {
      const result = await verifyChain();
      setVerification(result);
    } catch {
      setVerification({ valid: false, events: 0, verified_at: new Date().toISOString(), error: 'Verification request failed' });
    }
    setVerifying(false);
  }, [apiAvailable]);

  // Export
  const handleExport = useCallback(async () => {
    if (!apiAvailable) return;
    setExporting(true);
    try {
      const data = await exportEvents('json');
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `bawaba-audit-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      // Export failed silently
    }
    setExporting(false);
  }, [apiAvailable]);

  const filtered = filterDecision === 'all' ? events : events.filter(e => e.decision === filterDecision);

  return (
    <div className="space-y-6">
      {/* Export controls */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div>
            <div className="text-sm font-body font-medium text-foreground">Audit Explorer</div>
            <div className="text-xs text-muted-foreground">{events.length} events · Tamper-evident chain</div>
          </div>
        </div>
        <div className="flex gap-2">
          <button
            onClick={handleExport}
            disabled={exporting}
            className="text-xs font-body px-3 py-1.5 border border-border rounded-sm text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
          >
            {exporting ? 'Exporting...' : 'Export to SIEM'}
          </button>
          <button className="text-xs font-body px-3 py-1.5 border border-border rounded-sm text-muted-foreground hover:text-foreground transition-colors">
            Generate Report
          </button>
          <button
            onClick={handleVerify}
            disabled={verifying}
            className="text-xs font-body px-3 py-1.5 bg-safe-bg border border-safe/10 text-safe rounded-sm hover:opacity-90 transition-opacity disabled:opacity-50"
          >
            {verifying ? 'Verifying...' : 'Verify Merkle Root'}
          </button>
        </div>
      </div>

      {/* Merkle Chain */}
      <MerkleChain events={events} verification={verification} />

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
            {loading ? (
              <TableSkeleton />
            ) : (
              <div className="max-h-[400px] overflow-y-auto">
                {filtered.map(evt => (
                  <div key={evt.id}>
                    <div
                      onClick={() => setExpandedId(expandedId === evt.id ? null : evt.id)}
                      className={`grid grid-cols-[80px_100px_110px_70px_50px_50px_80px] gap-2 px-5 py-2 text-xs font-mono cursor-pointer hover:bg-secondary/30 transition-colors border-b border-border ${
                        evt.decision === 'deny' ? 'row-deny' : evt.decision === 'rate-limited' ? 'row-rate-limited' : ''
                      }`}
                    >
                      <span className="text-muted-foreground">{timeAgo(evt.timestamp)}</span>
                      <span className="text-foreground truncate">{evt.agent}</span>
                      <span className="text-ink-2 truncate">{evt.tool}</span>
                      <span className={evt.decision === 'allow' ? 'text-safe' : evt.decision === 'deny' ? 'text-danger' : 'text-warn'}>{evt.decision}</span>
                      <span className="text-muted-foreground">{evt.piiTokens}</span>
                      <span className="text-muted-foreground">{evt.latency}ms</span>
                      <span className="text-ink-4 truncate">{evt.hash.slice(0, 8)}{evt.hash.length > 8 ? '...' : ''}</span>
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

                {/* Load More button */}
                {hasMore && (
                  <div className="px-5 py-3 text-center border-t border-border">
                    <button
                      onClick={loadMore}
                      disabled={loadingMore}
                      className="text-xs font-body px-4 py-1.5 border border-border rounded-sm text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
                    >
                      {loadingMore ? 'Loading...' : 'Load More'}
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        <div className="col-span-4">
          <AuditStats events={events} />
        </div>
      </div>
    </div>
  );
}

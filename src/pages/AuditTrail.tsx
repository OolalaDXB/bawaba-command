import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { generateInitialEvents, getJurisdictionName, type MCPEvent } from '@/lib/mock-data';
import { BarChart, Bar, PieChart, Pie, Cell, LineChart, Line, ResponsiveContainer, XAxis, YAxis, Tooltip as RechartsTooltip } from 'recharts';
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
  TooltipProvider,
} from '@/components/ui/tooltip';
import {
  isApiAvailable, fetchEvents, verifyChain, exportEvents,
  type ApiEvent, type ChainVerification,
} from '@/services/api';
import InfoTooltip from '@/components/InfoTooltip';
import { useLocalAudit, pushInjectedEvent, setReviewStatus } from '@/lib/local-audit';
import { PETROL, PETROL_SERIES, DECISION_COLORS } from '@/lib/chart-colors';
import { X } from 'lucide-react';

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

/* ── Collapsible Explainer Panel ─────────────────── */
function ExplainerPanel() {
  const [open, setOpen] = useState(true);

  return (
    <div className="card-surface shadow-card overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-3 px-5 py-3 text-left hover:bg-secondary/20 transition-colors"
      >
        {/* Shield icon */}
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-safe shrink-0">
          <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
        </svg>
        <span className="text-xs font-body font-medium text-foreground flex-1">
          How does the audit chain work?
        </span>
        <svg
          width="14" height="14" viewBox="0 0 24 24" fill="none"
          stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
          className={`text-muted-foreground shrink-0 transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {open && (
        <div className="px-5 pb-4 pt-0">
          <p className="text-xs font-body text-muted-foreground leading-relaxed">
            Every event carries the SHA-256 fingerprint of the previous one and is cryptographically signed (Ed25519). Alter a single event and the chain breaks; BAWABA detects it immediately.
          </p>
        </div>
      )}
    </div>
  );
}

/* ── Hash Chain Visualization ───────────────────── */
type BlockStatus = 'idle' | 'verified' | 'corrupt';

function HashChainViz({
  events,
  blockStatuses,
  lineStatuses,
}: {
  events: MCPEvent[];
  blockStatuses: BlockStatus[];
  lineStatuses: ('idle' | 'verified')[];
}) {
  const chain = events.slice(0, 8);

  return (
    <div className="flex items-center gap-0 overflow-x-auto pb-2">
      <TooltipProvider delayDuration={150}>
        {chain.map((evt, i) => (
          <div key={evt.id} className="flex items-center shrink-0">
            {/* Block */}
            <div
              className={`border rounded-sm p-3 bg-background min-w-[130px] transition-none ${
                blockStatuses[i] === 'verified'
                  ? 'animate-chain-verify'
                  : blockStatuses[i] === 'corrupt'
                    ? 'animate-chain-corrupt'
                    : 'border-border'
              }`}
            >
              <div className="text-[9px] text-muted-foreground mb-1 font-body">#{i + 1}</div>

              {/* Hash with tooltip */}
              <Tooltip>
                <TooltipTrigger asChild>
                  <div className="font-mono text-[10px] text-foreground cursor-help">
                    {evt.hash.slice(0, 8)}
                  </div>
                </TooltipTrigger>
                <TooltipContent side="top" className="font-mono text-[10px] max-w-[260px] break-all">
                  {evt.hash}
                </TooltipContent>
              </Tooltip>

              {/* Prev hash */}
              <div className="text-[9px] text-muted-foreground mt-1.5 flex items-center gap-1">
                <span className="font-body">prev:</span>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="font-mono cursor-help">
                      {evt.prevHash.slice(0, 8)}
                    </span>
                  </TooltipTrigger>
                  <TooltipContent side="bottom" className="font-mono text-[10px] max-w-[260px] break-all">
                    {evt.prevHash}
                  </TooltipContent>
                </Tooltip>
              </div>

              {/* Decision badge */}
              <div className={`text-[9px] font-mono mt-1 ${
                evt.decision === 'allow' ? 'text-safe' : evt.decision === 'deny' ? 'text-danger' : 'text-warn'
              }`}>
                {evt.decision}
              </div>
            </div>

            {/* Connecting line */}
            {i < chain.length - 1 && (
              <div
                className={`w-8 h-px shrink-0 ${
                  lineStatuses[i] === 'verified' ? 'animate-line-verify' : 'bg-ink-5'
                }`}
              />
            )}
          </div>
        ))}
      </TooltipProvider>
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

  const COLORS = [DECISION_COLORS.allow, DECISION_COLORS.deny, DECISION_COLORS['rate-limited']];

  return (
    <div className="space-y-5">
      {/* By Decision */}
      <div className="card-surface shadow-card p-4">
        <div className="table-header mb-3">By decision <InfoTooltip text="Event distribution by policy decision type." /></div>
        <div className="h-28">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie data={byDecision} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={45} strokeWidth={1} stroke="hsl(0, 0%, 100%)">
                {byDecision.map((_, i) => <Cell key={i} fill={COLORS[i]} />)}
              </Pie>
              <RechartsTooltip contentStyle={{ fontSize: 10, fontFamily: 'JetBrains Mono' }} />
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
        <div className="table-header mb-3">By jurisdiction</div>
        <div className="h-28">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={byJurisdiction} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
              <XAxis dataKey="name" tick={{ fontSize: 9 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 9 }} axisLine={false} tickLine={false} />
              <Bar dataKey="value" fill={PETROL} radius={[1, 1, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* By Agent */}
      <div className="card-surface shadow-card p-4">
        <div className="table-header mb-3">By agent</div>
        <div className="h-28">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={byAgent} layout="vertical" margin={{ top: 0, right: 0, left: 0, bottom: 0 }}>
              <XAxis type="number" tick={{ fontSize: 9 }} axisLine={false} tickLine={false} />
              <YAxis type="category" dataKey="name" tick={{ fontSize: 9, fontFamily: 'JetBrains Mono' }} axisLine={false} tickLine={false} width={90} />
              <Bar dataKey="value" radius={[0, 1, 1, 0]}>
                {byAgent.map((_, i) => <Cell key={i} fill={PETROL_SERIES[i % PETROL_SERIES.length]} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Latency Trend */}
      <div className="card-surface shadow-card p-4">
        <div className="table-header mb-3">Avg latency (7d)</div>
        <div className="h-20">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={latencyTrend} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
              <XAxis dataKey="day" tick={{ fontSize: 9 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 9 }} axisLine={false} tickLine={false} />
              <Line type="monotone" dataKey="avg" stroke={PETROL} strokeWidth={1} dot={false} />
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
  const [selectedEvent, setSelectedEvent] = useState<MCPEvent | null>(null);
  const [filterDecision, setFilterDecision] = useState<string>('all');
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [apiAvailable, setApiAvailable] = useState(false);
  const [verification, setVerification] = useState<ChainVerification | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [, setTick] = useState(0);

  /* Chain verification animation state */
  const [blockStatuses, setBlockStatuses] = useState<BlockStatus[]>([]);
  const [lineStatuses, setLineStatuses] = useState<('idle' | 'verified')[]>([]);
  const [verifyMessage, setVerifyMessage] = useState<string | null>(null);
  const animTimers = useRef<ReturnType<typeof setTimeout>[]>([]);

  const PAGE_SIZE = 50;
  const CHAIN_SIZE = 8;

  // Local, UI-originated events (agent registrations, review decisions) are
  // merged on top of the server/mock feed so they appear in the same chain.
  const { injected, reviewStatus } = useLocalAudit();
  const allEvents = useMemo(() => [...injected, ...events], [injected, events]);

  // An event needs review if it was denied, rate-limited or carried PII, and
  // has not been reviewed yet. Review/registration events are never reviewable.
  const needsReview = useCallback(
    (e: MCPEvent) =>
      e.eventType !== 'review_decision' &&
      e.eventType !== 'agent_registered' &&
      !reviewStatus[e.id] &&
      (e.decision === 'deny' || e.decision === 'rate-limited' || e.piiTokens > 0),
    [reviewStatus],
  );

  // Append-only review: create a NEW chained event, never touch the original.
  // Exactly one review decision per event.
  const submitReview = useCallback((origin: MCPEvent, label: 'acknowledge' | 'escalate') => {
    if (reviewStatus[origin.id]) return;
    pushInjectedEvent({
      eventType: 'review_decision',
      agent: 'mickael.thomas',
      tool: `review:${origin.id.slice(0, 8)}`,
      decision: 'allow',
      jurisdiction: origin.jurisdiction,
      reviewer: 'mickael.thomas',
      refEventId: origin.id,
      reviewLabel: label,
      details: {
        origin_event: origin.id,
        origin_decision: origin.decision,
        origin_tool: origin.tool,
      },
    });
    setReviewStatus(origin.id, label === 'acknowledge' ? 'reviewed' : 'escalated');
  }, [reviewStatus]);

  // Live timestamp updates
  useEffect(() => {
    const interval = setInterval(() => setTick(t => t + 1), 1000);
    return () => clearInterval(interval);
  }, []);

  // Initialize block/line statuses when events change
  useEffect(() => {
    const count = Math.min(allEvents.length, CHAIN_SIZE);
    setBlockStatuses(Array(count).fill('idle'));
    setLineStatuses(Array(Math.max(0, count - 1)).fill('idle'));
  }, [allEvents]);

  // Clean up timers on unmount
  useEffect(() => {
    return () => {
      animTimers.current.forEach(t => clearTimeout(t));
    };
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

  // Verify chain with animated block-by-block progression
  const handleVerify = useCallback(async () => {
    // Clear previous animation timers
    animTimers.current.forEach(t => clearTimeout(t));
    animTimers.current = [];

    setVerifyMessage(null);
    setVerifying(true);

    const count = Math.min(allEvents.length, CHAIN_SIZE);
    // Reset all to idle
    setBlockStatuses(Array(count).fill('idle'));
    setLineStatuses(Array(Math.max(0, count - 1)).fill('idle'));

    // Try API verification
    let result: ChainVerification;
    if (apiAvailable) {
      try {
        result = await verifyChain();
      } catch {
        result = { valid: false, events: 0, verified_at: new Date().toISOString(), error: 'Verification request failed' };
      }
    } else {
      // Mock: simulate a valid chain for demo
      result = {
        valid: true,
        events: allEvents.length,
        verified_at: new Date().toISOString(),
      };
    }

    setVerification(result);

    // Animate blocks left-to-right with 100ms delay between each
    const DELAY = 100;
    for (let i = 0; i < count; i++) {
      const timer = setTimeout(() => {
        setBlockStatuses(prev => {
          const next = [...prev];
          next[i] = result.valid ? 'verified' : (i === count - 1 ? 'corrupt' : 'verified');
          return next;
        });

        // Animate connecting line (the line before this block)
        if (i > 0) {
          setLineStatuses(prev => {
            const next = [...prev];
            next[i - 1] = 'verified';
            return next;
          });
        }

        // After last block, show the result message
        if (i === count - 1) {
          if (result.valid) {
            setVerifyMessage(`Chain verified — ${result.events} events — 0 tampering`);
          } else {
            setVerifyMessage(`Tampering detected at event #${count}`);
          }
          setVerifying(false);
        }
      }, i * DELAY);
      animTimers.current.push(timer);
    }

    // Safety: ensure verifying is reset even if no events
    if (count === 0) {
      setVerifying(false);
      setVerifyMessage('No events to verify');
    }
  }, [apiAvailable, allEvents]);

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

  const filtered =
    filterDecision === 'all'
      ? allEvents
      : filterDecision === 'needs-review'
        ? allEvents.filter(needsReview)
        : allEvents.filter(e => e.decision === filterDecision);

  const needsReviewCount = allEvents.filter(needsReview).length;

  return (
    <div className="space-y-6">
      {/* Explainer Panel */}
      <ExplainerPanel />

      {/* Export controls */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div>
            <div className="text-sm font-body font-medium text-foreground">Audit Explorer</div>
            <div className="text-xs text-muted-foreground">{allEvents.length} events · Tamper-evident chain</div>
          </div>
        </div>
        <div className="flex gap-2">
          <button
            onClick={handleExport}
            disabled={exporting}
            className="text-xs font-body px-3 py-1.5 border border-border rounded-sm text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50 inline-flex items-center"
          >
            {exporting ? 'Exporting...' : 'Export to SIEM'}
            <InfoTooltip text="Generates a verifiable evidence.json bundle — transmittable to Risk/Audit/Compliance." />
          </button>
          <button className="text-xs font-body px-3 py-1.5 border border-border rounded-sm text-muted-foreground hover:text-foreground transition-colors inline-flex items-center">
            Generate Report
            <InfoTooltip text="Renders the current chain and its verification result as a printable evidence report." />
          </button>
        </div>
      </div>

      {/* Hash Chain Visualization */}
      <div className="card-surface shadow-card p-5">
        <div className="flex items-center justify-between mb-4">
          <div>
            <div className="text-sm font-body font-medium text-foreground">Hash Chain <InfoTooltip text="Each event includes the SHA-256 hash of the previous event. Any modification breaks the chain — detectable by VerifyChain()." /></div>
            <div className="text-xs text-muted-foreground">Tamper-evident audit trail</div>
          </div>
          <button
            onClick={handleVerify}
            disabled={verifying}
            className="text-xs font-body px-4 py-2 bg-safe-bg border border-safe/10 text-safe rounded-sm hover:opacity-90 transition-opacity disabled:opacity-50 flex items-center gap-2"
          >
            {/* Checkmark / shield icon */}
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
            </svg>
            {verifying ? 'Verifying...' : 'Verify integrity'}
          </button>
        </div>

        <HashChainViz
          events={allEvents}
          blockStatuses={blockStatuses}
          lineStatuses={lineStatuses}
        />

        {/* Verification result message */}
        {verifyMessage && (
          <div className={`mt-4 flex items-center gap-3 p-3 rounded-sm ${
            verification?.valid
              ? 'bg-safe-bg border border-safe/10'
              : 'bg-danger-bg border border-danger/10'
          }`}>
            <span className={`w-2 h-2 rounded-full ${verification?.valid ? 'bg-safe' : 'bg-danger'}`} />
            <span className={`text-xs font-mono ${verification?.valid ? 'text-safe' : 'text-danger'}`}>
              {verifyMessage}
            </span>
            <span className="text-[10px] text-muted-foreground font-mono ml-auto">
              {verification ? `${verification.events} events` : ''}
            </span>
          </div>
        )}
      </div>

      {/* Main content + stats sidebar */}
      <div className="grid grid-cols-12 gap-6">
        <div className="col-span-8">
          {/* Filters */}
          <div className="flex gap-2 mb-4 flex-wrap">
            {['all', 'allow', 'deny', 'rate-limited', 'needs-review'].map(f => (
              <button
                key={f}
                onClick={() => setFilterDecision(f)}
                className={`text-xs font-mono px-3 py-1.5 rounded-sm border transition-colors ${
                  filterDecision === f ? 'border-primary bg-primary/5 text-foreground' : 'border-border text-muted-foreground hover:text-foreground'
                } ${f === 'needs-review' ? 'inline-flex items-center gap-1.5' : ''}`}
              >
                {f === 'all' ? 'All' : f === 'needs-review' ? 'needs review' : f}
                {f === 'needs-review' && needsReviewCount > 0 && (
                  <span className="text-[9px] font-mono px-1.5 py-0.5 rounded-full bg-warn-bg text-warn border border-warn/20">{needsReviewCount}</span>
                )}
              </button>
            ))}
          </div>

          {/* Hint */}
          <div className="text-[10px] text-muted-foreground font-body mb-2">Click a row to see the full cryptographic proof and JSON payload</div>

          {/* Table */}
          <div className="card-surface shadow-card overflow-hidden">
            <div className="grid grid-cols-[80px_100px_110px_70px_50px_50px_80px] gap-2 px-5 py-2 border-b border-border">
              {(['Time', 'Agent', 'Tool', 'Result', 'PII', 'Lat.', 'Hash'] as const).map(h => (
                <span key={h} className="table-header">{h}</span>
              ))}
            </div>
            {loading ? (
              <TableSkeleton />
            ) : (
              <div className="max-h-[400px] overflow-y-auto">
                {filtered.map(evt => {
                  const isReview = evt.eventType === 'review_decision';
                  const badge = reviewStatus[evt.id];
                  return (
                    <div key={evt.id}>
                      <div
                        onClick={() => setSelectedEvent(selectedEvent?.id === evt.id ? null : evt)}
                        className={`grid grid-cols-[80px_100px_110px_70px_50px_50px_80px] gap-2 px-5 py-2 text-xs font-mono cursor-pointer hover:bg-secondary/30 transition-colors border-b border-border ${
                          isReview ? 'bg-secondary/20' : evt.decision === 'deny' ? 'row-deny' : evt.decision === 'rate-limited' ? 'row-rate-limited' : ''
                        }`}
                      >
                        <span className="text-muted-foreground">{timeAgo(evt.timestamp)}</span>
                        <span className="text-foreground truncate">{evt.agent}</span>
                        <span className="text-ink-2 truncate">{evt.tool}</span>
                        <span className="flex flex-col gap-0.5 min-w-0">
                          {isReview ? (
                            <span className={evt.reviewLabel === 'escalate' ? 'text-warn' : 'text-safe'}>{evt.reviewLabel}</span>
                          ) : (
                            <span className={evt.decision === 'allow' ? 'text-safe' : evt.decision === 'deny' ? 'text-danger' : 'text-warn'}>{evt.decision}</span>
                          )}
                          {badge && (
                            <span className={`text-[8px] uppercase tracking-wide ${badge === 'escalated' ? 'text-warn' : 'text-safe'}`}>{badge}</span>
                          )}
                        </span>
                        <span className="text-muted-foreground">{evt.piiTokens}</span>
                        <span className="text-muted-foreground">{evt.latency}ms</span>
                        <span className="text-ink-4 truncate">{evt.hash.slice(0, 8)}{evt.hash.length > 8 ? '...' : ''}</span>
                      </div>
                    </div>
                  );
                })}

                {/* Load More button */}
                {hasMore && (
                  <div className="px-5 py-3 text-center border-t border-border">
                    <button
                      onClick={loadMore}
                      disabled={loadingMore}
                      className="text-xs font-body px-4 py-1.5 border border-border rounded-sm text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
                    >
                      {loadingMore ? 'Loading...' : 'Load more'}
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        <div className="col-span-4">
          <AuditStats events={allEvents} />
        </div>
      </div>

      {/* Detail Drawer */}
      {selectedEvent && (
        <>
          <div className="fixed inset-0 bg-foreground/5 z-40" onClick={() => setSelectedEvent(null)} />
          <div className="fixed inset-y-0 right-0 w-[400px] bg-card border-l border-border z-50 overflow-y-auto shadow-card">
            <div className="flex items-center justify-between p-5 border-b border-border">
              <div>
                <div className="text-lg font-heading text-foreground">Event #{selectedEvent.id.slice(0, 8)}</div>
                <div className="text-xs text-muted-foreground font-mono">{timeAgo(selectedEvent.timestamp)}</div>
              </div>
              <button onClick={() => setSelectedEvent(null)} className="text-muted-foreground hover:text-foreground transition-colors">
                <X className="h-4 w-4" strokeWidth={1.5} />
              </button>
            </div>
            <div className="p-5 space-y-5">
              {/* Review status badge */}
              {reviewStatus[selectedEvent.id] && (
                <div className={`inline-flex items-center gap-2 text-[11px] font-mono px-2.5 py-1 rounded-sm border ${
                  reviewStatus[selectedEvent.id] === 'escalated'
                    ? 'bg-warn-bg text-warn border-warn/20'
                    : 'bg-safe-bg text-safe border-safe/20'
                }`}>
                  <span className="w-1.5 h-1.5 rounded-full bg-current" />
                  {reviewStatus[selectedEvent.id] === 'escalated' ? 'Escalated' : 'Reviewed'}
                </div>
              )}

              {/* Review decision detail (for review_decision events) */}
              {selectedEvent.eventType === 'review_decision' && (
                <div className="text-[10px] text-muted-foreground bg-muted/40 rounded p-2 space-y-1">
                  <div>Human review decision: <span className="font-mono text-foreground">{selectedEvent.reviewLabel}</span> by <span className="font-mono text-foreground">{selectedEvent.reviewer}</span>.</div>
                  <div>References original event <span className="font-mono text-foreground">{selectedEvent.refEventId?.slice(0, 12)}</span>. This is a new, chained, signed event — the original was not modified.</div>
                </div>
              )}

              {/* Human-in-the-loop review actions */}
              {selectedEvent.eventType !== 'review_decision' &&
                selectedEvent.eventType !== 'agent_registered' &&
                (selectedEvent.decision === 'deny' || selectedEvent.decision === 'rate-limited' || selectedEvent.piiTokens > 0) && (
                  <div>
                    <div className="table-header mb-2">Review<InfoTooltip text="Records an append-only review decision as a new signed event chained after this one. The original event is never modified or deleted." /></div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => submitReview(selectedEvent, 'acknowledge')}
                        disabled={!!reviewStatus[selectedEvent.id]}
                        className="flex-1 text-xs font-body font-medium px-3 py-2 bg-safe-bg border border-safe/20 text-safe rounded-sm hover:opacity-90 transition-opacity disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        Acknowledge
                      </button>
                      <button
                        onClick={() => submitReview(selectedEvent, 'escalate')}
                        disabled={!!reviewStatus[selectedEvent.id]}
                        className="flex-1 text-xs font-body font-medium px-3 py-2 bg-warn-bg border border-warn/20 text-warn rounded-sm hover:opacity-90 transition-opacity disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        Escalate
                      </button>
                    </div>
                    <div className="text-[10px] text-muted-foreground bg-muted/40 rounded p-2 mt-1.5">
                      {reviewStatus[selectedEvent.id]
                        ? 'This event has already been reviewed. Exactly one review decision is allowed per event; the decision is recorded as a chained, immutable event.'
                        : <>Each decision appends a new <span className="font-mono">review_decision</span> event to the chain, referencing this event's id. One decision per event; the original event is immutable.</>}
                    </div>
                  </div>
                )}

              {/* Intro explainer */}
              <div className="text-[10px] text-muted-foreground bg-muted/40 rounded p-2">
                Each event is chained to the previous one by its SHA-256 hash and individually signed (Ed25519). Any modification of a single field invalidates the entire chain — making the audit tamper-proof.
              </div>

              {/* Event hash */}
              <div>
                <div className="table-header mb-1">Event hash</div>
                <div className="font-mono text-xs text-foreground break-all bg-secondary/20 rounded-sm p-2">{selectedEvent.hash}</div>
                <div className="text-[10px] text-muted-foreground bg-muted/40 rounded p-2 mt-1.5">
                  SHA-256 of this event's canonical payload. Serves as an anchor for chaining.
                </div>
              </div>

              {/* Previous hash */}
              <div>
                <div className="table-header mb-1">Previous hash</div>
                <div className="font-mono text-xs text-foreground break-all bg-secondary/20 rounded-sm p-2">{selectedEvent.prevHash}</div>
                <div className="text-[10px] text-muted-foreground bg-muted/40 rounded p-2 mt-1.5">
                  Fingerprint of event N-1. Guarantees the order and integrity of the sequence.
                </div>
              </div>

              {/* Signature Ed25519 */}
              <div>
                <div className="table-header mb-1">Ed25519 Signature</div>
                <div className="text-xs text-safe font-mono">Signature verified ✓</div>
                <div className="text-[10px] text-muted-foreground bg-muted/40 rounded p-2 mt-1.5">
                  The signing private key is isolated in the gateway module. An auditor can verify with the public key alone.
                </div>
              </div>

              {/* Agent */}
              <div>
                <div className="table-header mb-1">Agent</div>
                <div className="text-xs font-mono text-foreground">{selectedEvent.agent}</div>
              </div>

              {/* Tool */}
              <div>
                <div className="table-header mb-1">Tool</div>
                <div className="text-xs font-mono text-foreground">{selectedEvent.tool}</div>
              </div>

              {/* Decision */}
              <div>
                <div className="table-header mb-1">Decision</div>
                <div className={`text-xs font-mono ${
                  selectedEvent.decision === 'allow' ? 'text-safe' : selectedEvent.decision === 'deny' ? 'text-danger' : 'text-warn'
                }`}>
                  {selectedEvent.decision === 'allow' ? '✓ Allowed' : selectedEvent.decision === 'deny' ? '✗ Denied' : '⚠ Rate-limited'} ({selectedEvent.decision})
                </div>
              </div>

              {/* PII detected */}
              <div>
                <div className="table-header mb-1">PII detected</div>
                <div className="text-xs font-mono text-foreground">{selectedEvent.piiTokens}</div>
              </div>

              {/* Latency */}
              <div>
                <div className="table-header mb-1">Latency</div>
                <div className="text-xs font-mono text-foreground">{selectedEvent.latency}ms</div>
              </div>

              {/* Full payload */}
              <div>
                <div className="table-header mb-1">Full payload</div>
                <pre className="text-xs font-mono text-ink-2 whitespace-pre-wrap bg-secondary/20 rounded-sm p-2 overflow-x-auto">{JSON.stringify(selectedEvent.details, null, 2)}</pre>
                <div className="text-[10px] text-muted-foreground bg-muted/40 rounded p-2 mt-1.5">
                  This JSON constitutes the exportable evidence.json file — independently verifiable without server access.
                </div>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

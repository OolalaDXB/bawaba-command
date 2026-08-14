import { useState, useEffect, useMemo } from 'react';
import { PII_TYPES as MOCK_PII_TYPES } from '@/lib/mock-data';
import { useLiveFeed } from '@/hooks/use-live-feed';
import { BarChart, Bar, ResponsiveContainer, XAxis, YAxis } from 'recharts';
import { isApiAvailable, fetchPiiStats } from '@/services/api';
import { PETROL } from '@/lib/chart-colors';
import { tokenizePii, PII_LABELS, type PiiMatch } from '@/lib/pii-detect';
import InfoTooltip from '@/components/InfoTooltip';
import { X } from 'lucide-react';

/* ── Time-ago helper ────────────────────────────── */
function timeAgo(date: Date): string {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

/** PII entity type shape for the UI. */
interface PiiTypeEntry {
  type: string;
  count: number;
  today: number;
}

/** Selected token detail for the drawer. */
interface SelectedToken {
  id: string;
  agent: string;
  mode: string;
  entities: number;
  time: string;
  timestamp: Date;
}

/* ── Skeleton for stats cards ───────────────────── */
function StatsSkeleton() {
  return (
    <div className="grid grid-cols-4 gap-4 mb-6">
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="card-surface shadow-card p-4">
          <div className="animate-pulse bg-muted rounded h-3 w-16 mb-2" />
          <div className="animate-pulse bg-muted rounded h-7 w-24" />
        </div>
      ))}
    </div>
  );
}

/* ── Vault status tooltips ───────────────────────── */
const VAULT_TOOLTIPS: Record<string, string> = {
  'Active sessions': 'Number of active tokenization sessions currently open.',
  'Tokens in memory': '',
  'Avg TTL remaining': 'Average token time-to-live remaining in memory. After expiration, detokenization becomes impossible.',
  'Memory usage': 'RAM usage by the token vault.',
};

/* ── "Try it" live PII detection ─────────────────── */
const TRY_IT_SAMPLE =
  'Wire settlement to IBAN MA64011519000001205000534921 for Ahmed, reachable at ahmed.benali@example.ma or +212 661 234 567. Card on file 4111 1111 1111 1111, Emirates ID 784-1985-1234567-8, KSA ID 1023456789.';

function Highlighted({ text, matches }: { text: string; matches: PiiMatch[] }) {
  if (!text) {
    return <span className="text-muted-foreground">Paste text containing an IBAN, email, phone, card, Emirates ID, KSA ID or Morocco CIN…</span>;
  }
  if (!matches.length) return <span>{text}</span>;
  const parts: React.ReactNode[] = [];
  let cursor = 0;
  matches.forEach((m, i) => {
    if (m.start > cursor) parts.push(<span key={`t${i}`}>{text.slice(cursor, m.start)}</span>);
    parts.push(
      <mark
        key={`m${i}`}
        title={PII_LABELS[m.type] || m.type}
        className="rounded-sm px-0.5 font-medium"
        style={{ background: 'rgba(159, 18, 57, 0.16)', color: 'inherit' }}
      >
        {m.value}
      </mark>,
    );
    cursor = m.end;
  });
  if (cursor < text.length) parts.push(<span key="tail">{text.slice(cursor)}</span>);
  return <>{parts}</>;
}

function PiiTryIt() {
  const [input, setInput] = useState(TRY_IT_SAMPLE);
  const result = useMemo(() => tokenizePii(input), [input]);

  return (
    <div className="card-surface shadow-card p-4">
      <div className="flex items-center justify-between mb-3">
        <div>
          <div className="table-header">
            Try it — live detection
            <InfoTooltip text="Runs the same 7 MENA patterns as the Rust tokenizer in your browser. Nothing leaves the page." />
          </div>
          <div className="text-[10px] text-muted-foreground font-body mt-0.5">Client-side preview · mirrors rust/tokenizer patterns</div>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-mono text-muted-foreground">{result.matches.length} entities</span>
          <button
            onClick={() => setInput(TRY_IT_SAMPLE)}
            className="text-[10px] font-body px-2 py-1 border border-border rounded-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            Reset sample
          </button>
        </div>
      </div>

      <textarea
        value={input}
        onChange={e => setInput(e.target.value)}
        rows={3}
        placeholder="Type or paste free text…"
        className="w-full text-xs font-mono px-3 py-2 border border-border rounded-sm bg-background text-foreground placeholder:text-ink-4 focus:outline-none focus:border-primary resize-y"
      />

      <div className="grid grid-cols-2 gap-3 mt-3">
        <div>
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Detected</div>
          <div className="text-xs font-mono leading-relaxed bg-background border border-border rounded-sm p-2 min-h-[64px] whitespace-pre-wrap break-words">
            <Highlighted text={input} matches={result.matches} />
          </div>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Tokenized</div>
          <div className="text-xs font-mono leading-relaxed bg-background border border-border rounded-sm p-2 min-h-[64px] whitespace-pre-wrap break-words text-ink-2">
            {result.output || <span className="text-ink-4">—</span>}
          </div>
        </div>
      </div>

      {result.tokens.length > 0 && (
        <div className="mt-3 space-y-1">
          {result.tokens.map((t, i) => (
            <div key={i} className="flex items-center gap-2 text-[11px] font-mono">
              <span className="px-1.5 py-0.5 rounded-sm bg-danger-bg text-danger border border-danger/10 shrink-0">{PII_LABELS[t.type] || t.type}</span>
              <span className="text-muted-foreground truncate">{t.value}</span>
              <span className="text-ink-4">→</span>
              <span className="text-safe truncate">{t.token}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function PiiTokenizer() {
  const { events } = useLiveFeed(20);
  const [loading, setLoading] = useState(true);
  const [piiTypes, setPiiTypes] = useState<PiiTypeEntry[]>(MOCK_PII_TYPES);
  const [totalAll, setTotalAll] = useState(MOCK_PII_TYPES.reduce((s, p) => s + p.count, 0));
  const [totalToday, setTotalToday] = useState(MOCK_PII_TYPES.reduce((s, p) => s + p.today, 0));
  const [, setTick] = useState(0);
  const [selectedToken, setSelectedToken] = useState<SelectedToken | null>(null);

  // Live timestamp updates
  useEffect(() => {
    const interval = setInterval(() => setTick(t => t + 1), 1000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      const available = await isApiAvailable();
      if (cancelled) return;

      if (available) {
        try {
          const stats = await fetchPiiStats();
          if (!cancelled && stats && stats.length > 0) {
            // Group by pii_mode to create entity type entries
            const byMode: Record<string, { count: number; today: number }> = {};
            stats.forEach(entry => {
              const key = entry.pii_mode || 'unknown';
              if (!byMode[key]) byMode[key] = { count: 0, today: 0 };
              byMode[key].count += entry.entities_detected;
              byMode[key].today += entry.event_count;
            });

            const mapped: PiiTypeEntry[] = Object.entries(byMode).map(([type, data]) => ({
              type: type.charAt(0).toUpperCase() + type.slice(1),
              count: data.count,
              today: data.today,
            }));

            if (mapped.length > 0) {
              setPiiTypes(mapped);
              setTotalAll(mapped.reduce((s, p) => s + p.count, 0));
              setTotalToday(mapped.reduce((s, p) => s + p.today, 0));
            }
          }
        } catch {
          // Keep mock data on failure
        }
      }

      if (!cancelled) setLoading(false);
    }

    load();
    return () => { cancelled = true; };
  }, []);

  const processingDist = useMemo(() => [
    { range: '<1ms', count: 4210 },
    { range: '1-2ms', count: 6340 },
    { range: '2-5ms', count: 2180 },
    { range: '>5ms', count: 327 },
  ], []);

  // Live rows use only values persisted by the backend. The API currently
  // exposes entity counts and tokenization mode, not individual token UUIDs or
  // entity categories, so the UI must not fabricate either.
  const feedRows = useMemo(() =>
    events.filter(e => e.piiTokens > 0).map(evt => ({
      evt,
      mode: String(evt.details.pii_mode || 'tokenize'),
      processingTime: Math.max(0, evt.latency).toFixed(1),
    })),
  [events]);

  return (
    <div className="space-y-6">
      {/* Try it — live PII detection */}
      <PiiTryIt />

      {/* Stats */}
      <div>
        <div className="flex items-center gap-3 mb-4">
          <div>
            <div className="text-sm font-body font-medium text-foreground">
              Tokenization Statistics
              <InfoTooltip text="Overview of PII detection and tokenization activity by the Rust library." />
            </div>
            <div className="text-xs text-muted-foreground">Simulated aggregate volumes · live persisted events below</div>
          </div>
        </div>

        {loading ? (
          <StatsSkeleton />
        ) : (
          <div className="grid grid-cols-4 gap-4 mb-6">
            <div className="card-surface shadow-card p-4">
              <div className="table-header mb-2">
                All time
                <InfoTooltip text="Total PII entities detected since system start." />
              </div>
              <div className="text-3xl font-data tabular-nums font-normal text-foreground">{totalAll.toLocaleString()}</div>
            </div>
            <div className="card-surface shadow-card p-4">
              <div className="table-header mb-2">Today</div>
              <div className="text-3xl font-data tabular-nums font-normal text-foreground">{totalToday.toLocaleString()}</div>
            </div>
            <div className="card-surface shadow-card p-4">
              <div className="table-header mb-2">This hour</div>
              <div className="text-3xl font-data tabular-nums font-normal text-foreground">{Math.floor(totalToday / 8)}</div>
            </div>
            <div className="card-surface shadow-card p-4">
              <div className="table-header mb-2">
                Active tokens
                <InfoTooltip text="Number of PII tokens currently in the vault. Expires after TTL." />
              </div>
              <div className="text-3xl font-data tabular-nums font-normal text-foreground">8,421</div>
            </div>
          </div>
        )}

        {/* By entity type + processing dist */}
        <div className="grid grid-cols-2 gap-4">
          <div className="card-surface shadow-card p-4">
            <div className="table-header mb-3">
              By processing mode
              <InfoTooltip text="Distribution of persisted PII entities by configured processing mode." />
            </div>
            {loading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="flex items-center justify-between py-2 border-b border-border last:border-0">
                  <div className="animate-pulse bg-muted rounded h-4 w-16" />
                  <div className="flex items-center gap-4">
                    <div className="animate-pulse bg-muted rounded h-1.5 w-24" />
                    <div className="animate-pulse bg-muted rounded h-4 w-12" />
                    <div className="animate-pulse bg-muted rounded h-4 w-8" />
                  </div>
                </div>
              ))
            ) : (
              piiTypes.map(p => (
                <div key={p.type} className="data-row flex items-center justify-between py-2 border-b border-border last:border-0">
                  <span className="text-sm text-foreground">{p.type}</span>
                  <div className="flex items-center gap-4">
                    <div className="w-24 h-1.5 bg-secondary rounded-full overflow-hidden">
                      <div className="h-full" style={{ background: PETROL, width: `${totalAll > 0 ? (p.count / totalAll) * 100 : 0}%` }} />
                    </div>
                    <span className="text-sm font-data tabular-nums text-muted-foreground w-14 text-right">{p.count.toLocaleString()}</span>
                    <span className="text-xs font-data tabular-nums text-ink-3 w-8 text-right">+{p.today}</span>
                  </div>
                </div>
              ))
            )}
          </div>

          <div className="card-surface shadow-card p-4">
            <div className="table-header mb-3">
              Processing time distribution
              <InfoTooltip text="Detection and tokenization time by the Rust library. <1ms = nominal. >5ms = high load." />
            </div>
            <div className="h-40">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={processingDist} margin={{ top: 0, right: 0, left: -10, bottom: 0 }}>
                  <XAxis dataKey="range" tick={{ fontSize: 10, fontFamily: 'JetBrains Mono' }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 9 }} axisLine={false} tickLine={false} />
                  <Bar dataKey="count" fill={PETROL} radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
      </div>

      {/* Live feed + Vault */}
      <div className="grid grid-cols-12 gap-6">
        <div className="col-span-8">
          <div className="flex items-center gap-3 mb-4">
            <div className="text-sm font-body font-medium text-foreground">
              Live persisted tokenization events
              <InfoTooltip text="Each row is a real audit event returned by the running backend. Sensitive values are not written to the audit log." />
            </div>
            <div className="text-[10px] text-muted-foreground font-body">Click a row to see the persisted tokenization event</div>
          </div>
          <div className="card-surface shadow-card overflow-hidden">
            <div className="grid grid-cols-[80px_100px_100px_72px_1fr_64px] gap-2 px-5 py-2 border-b border-border">
              {['Time', 'Agent', 'Redacted', 'Mode', 'Event ID', 'Duration'].map((h, idx) => (
                <span key={h + idx} className="table-header">
                  {h}
                  {h === 'Redacted' && <InfoTooltip text="Sensitive values are never written to the audit log; only the entity count is persisted." />}
                  {h === 'Mode' && <InfoTooltip text="Configured PII action persisted with the audit event." />}
                  {h === 'Event ID' && <InfoTooltip text="Persisted audit event identifier. Individual vault token UUIDs are not exposed by this API." />}
                  {h === 'Duration' && <InfoTooltip text="Detection + replacement time by the Rust lib." />}
                </span>
              ))}
            </div>
            <div className="max-h-[350px] overflow-y-auto zebra">
              {feedRows.map(({ evt, mode, processingTime }, i) => (
                <div
                  key={evt.id}
                  className={`data-row grid grid-cols-[80px_100px_100px_72px_1fr_64px] gap-2 px-5 py-2 text-sm font-data tabular-nums border-b border-border cursor-pointer hover:bg-muted/50 transition-colors ${i === 0 ? 'animate-fade-in-row' : ''}`}
                  onClick={() => setSelectedToken({
                    id: evt.id,
                    agent: evt.agent,
                    mode,
                    entities: evt.piiTokens,
                    time: `${processingTime}ms`,
                    timestamp: evt.timestamp,
                  })}
                >
                  <span className="text-muted-foreground">{timeAgo(evt.timestamp)}</span>
                  <span className="text-foreground truncate">{evt.agent}</span>
                  <span className="text-ink-3">{evt.piiTokens} field{evt.piiTokens === 1 ? '' : 's'}</span>
                  <span className="text-ink-2">{mode}</span>
                  <span className="text-ink-3 truncate mono-cell text-xs self-center">{evt.id.slice(0, 18)}...</span>
                  <span className="text-muted-foreground">{processingTime}ms</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="col-span-4">
          <div className="flex items-center gap-3 mb-4">
            <div className="text-sm font-body font-medium text-foreground">
              Simulated vault status
              <InfoTooltip text="Illustrative vault volumes for the demonstration environment. The live audit feed is shown separately." />
            </div>
          </div>
          <div className="card-surface shadow-card p-4 space-y-4">
            {([
              ['Active sessions', '24'],
              ['Tokens in memory', '8,421'],
              ['Avg TTL remaining', '23m 14s'],
              ['Memory usage', '142 MB'],
            ] as const).map(([label, val]) => (
              <div key={label} className="flex justify-between py-2 border-b border-border last:border-0">
                <span className="text-sm text-muted-foreground">
                  {label}
                  {VAULT_TOOLTIPS[label] && <InfoTooltip text={VAULT_TOOLTIPS[label]} />}
                </span>
                <span className="text-sm font-data tabular-nums text-foreground">{val}</span>
              </div>
            ))}

            <div className="pt-2">
              <div className="table-header mb-2">
                Tokens by tenant
                <InfoTooltip text="Distribution of active tokens by tenant organization." />
              </div>
              {[
                ['Atlas Commercial Bank', '3,210'],
                ['Gulf Meridian Bank', '2,891'],
                ['Oasis Markets', '1,420'],
                ['Northern Europe Branch', '900'],
              ].map(([t, c]) => (
                <div key={t} className="flex justify-between py-1.5 text-sm">
                  <span className="text-muted-foreground">{t}</span>
                  <span className="font-data tabular-nums text-foreground">{c}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Detail Drawer */}
      {selectedToken && (
        <>
          <div className="fixed inset-0 bg-foreground/5 z-40" onClick={() => setSelectedToken(null)} />
          <div className="fixed inset-y-0 right-0 w-[400px] bg-card border-l border-border z-50 overflow-y-auto shadow-card">
            <div className="flex items-center justify-between p-5 border-b border-border">
              <div>
                <div className="text-lg font-heading text-foreground">Tokenization Event</div>
                <div className="text-xs text-muted-foreground font-mono">{selectedToken.id}</div>
              </div>
              <button
                onClick={() => setSelectedToken(null)}
                className="p-1.5 rounded hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-5 space-y-5">
              {/* Persisted PII result */}
              <div>
                <div className="table-header mb-1">Persisted result</div>
                <div className="text-sm font-mono text-foreground">{selectedToken.entities} entities · {selectedToken.mode}</div>
                <div className="text-[10px] text-muted-foreground bg-muted/40 rounded p-2 mt-1.5">
                  The audit API persists the number of detected entities and the configured processing mode. Sensitive values and vault token UUIDs are not exposed here.
                </div>
              </div>

              {/* Source agent */}
              <div>
                <div className="table-header mb-1">Source agent</div>
                <div className="text-sm font-mono text-foreground">{selectedToken.agent}</div>
                <div className="text-[10px] text-muted-foreground bg-muted/40 rounded p-2 mt-1.5">
                  The AI agent that sent the request containing this sensitive data.
                </div>
              </div>

              {/* Configured TTL */}
              <div>
                <div className="table-header mb-1">Configured TTL</div>
                <div className="text-sm font-mono text-foreground">60 minutes</div>
                <div className="text-[10px] text-muted-foreground bg-muted/40 rounded p-2 mt-1.5">
                  The running gateway initializes the in-memory vault with a 60-minute TTL. After expiration, the mapping is purged from memory.
                </div>
              </div>

              {/* Processing time */}
              <div>
                <div className="table-header mb-1">Processing time</div>
                <div className="text-sm font-mono text-foreground">{selectedToken.time}</div>
              </div>

              {/* Status */}
              <div>
                <div className="table-header mb-1">Status</div>
                <span className="pill pill-allow">
                  <span className="w-1.5 h-1.5 rounded-full bg-safe" />
                  Event recorded
                </span>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

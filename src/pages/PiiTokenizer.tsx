import { useState, useEffect, useMemo } from 'react';
import { PII_TYPES as MOCK_PII_TYPES, JURISDICTIONS, generateSparklineData } from '@/lib/mock-data';
import { useLiveFeed } from '@/hooks/use-live-feed';
import { BarChart, Bar, ResponsiveContainer, XAxis, YAxis } from 'recharts';
import { isApiAvailable, fetchPiiStats, type PiiStatEntry } from '@/services/api';
import InfoTooltip from '@/components/InfoTooltip';
import { X } from 'lucide-react';

/* ── Constants for PII types & patterns ──────────── */
const PII_TYPE_LIST = ['IBAN', 'Phone', 'Email', 'NID', 'Card'] as const;
const PII_PATTERNS: Record<string, string> = {
  IBAN: '[A-Z]{2}\\d{2}[A-Z0-9]{4,}',
  Phone: '\\+?\\d{8,15}',
  Email: '[\\w.-]+@[\\w.-]+',
  NID: '[A-Z]\\d{6,9}',
  Card: '\\d{4}[\\s-]?\\d{4}[\\s-]?\\d{4}[\\s-]?\\d{4}',
};

/* ── Stable hash helper ──────────────────────────── */
function stableHash(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + ch;
    hash |= 0;
  }
  return Math.abs(hash);
}

/* ── Stable UUID from event id ───────────────────── */
function stableUUID(id: string): string {
  const h = stableHash(id);
  const hex = (n: number, len: number) => n.toString(16).padStart(len, '0');
  return `${hex(h & 0xffffffff, 8)}-${hex((h >> 4) & 0xffff, 4)}-4${hex((h >> 8) & 0xfff, 3)}-${hex(0x8000 | ((h >> 12) & 0x3fff), 4)}-${hex(h & 0xffffffffffff, 12)}`;
}

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
  type: string;
  uuid: string;
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

  /* Precompute stable type + UUID per event */
  const feedRows = useMemo(() =>
    events.filter(e => e.piiTokens > 0).map(evt => {
      const h = stableHash(evt.id);
      const piiType = PII_TYPE_LIST[h % PII_TYPE_LIST.length];
      const uuid = stableUUID(evt.id);
      const processingTime = ((h % 30) / 10 + 0.1).toFixed(1);
      return { evt, piiType, uuid, processingTime };
    }),
  [events]);

  return (
    <div className="space-y-6">
      {/* Stats */}
      <div>
        <div className="flex items-center gap-3 mb-4">
          <div>
            <div className="text-sm font-body font-medium text-foreground">
              Tokenization Statistics
              <InfoTooltip text="Overview of PII detection and tokenization activity by the Rust library." />
            </div>
            <div className="text-xs text-muted-foreground">PII detection and token vault</div>
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
              <div className="text-2xl font-mono font-light text-foreground">{totalAll.toLocaleString()}</div>
            </div>
            <div className="card-surface shadow-card p-4">
              <div className="table-header mb-2">Today</div>
              <div className="text-2xl font-mono font-light text-foreground">{totalToday.toLocaleString()}</div>
            </div>
            <div className="card-surface shadow-card p-4">
              <div className="table-header mb-2">This hour</div>
              <div className="text-2xl font-mono font-light text-foreground">{Math.floor(totalToday / 8)}</div>
            </div>
            <div className="card-surface shadow-card p-4">
              <div className="table-header mb-2">
                Active tokens
                <InfoTooltip text="Number of PII tokens currently in the vault. Expires after TTL." />
              </div>
              <div className="text-2xl font-mono font-light text-foreground">8,421</div>
            </div>
          </div>
        )}

        {/* By entity type + processing dist */}
        <div className="grid grid-cols-2 gap-4">
          <div className="card-surface shadow-card p-4">
            <div className="table-header mb-3">
              By entity type
              <InfoTooltip text="Distribution of detected PII entities by category (IBAN, Email, Phone, etc.)." />
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
                <div key={p.type} className="flex items-center justify-between py-2 border-b border-border last:border-0">
                  <span className="text-xs text-foreground">{p.type}</span>
                  <div className="flex items-center gap-4">
                    <div className="w-24 h-1.5 bg-secondary rounded-full overflow-hidden">
                      <div className="h-full bg-primary" style={{ width: `${totalAll > 0 ? (p.count / totalAll) * 100 : 0}%` }} />
                    </div>
                    <span className="text-xs font-mono text-muted-foreground w-12 text-right">{p.count.toLocaleString()}</span>
                    <span className="text-[10px] font-mono text-ink-4 w-8 text-right">+{p.today}</span>
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
                  <Bar dataKey="count" fill="hsl(30, 24%, 44%)" radius={[1, 1, 0, 0]} />
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
              Live tokenization feed
              <InfoTooltip text="Each row represents a sensitive data item detected and replaced by a UUID token. The actual data is never sent to the LLM." />
            </div>
            <div className="text-[10px] text-muted-foreground font-body">Click a row to see token details and the detection pattern</div>
          </div>
          <div className="card-surface shadow-card overflow-hidden">
            <div className="grid grid-cols-[80px_100px_100px_70px_120px_60px] gap-2 px-5 py-2 border-b border-border">
              {['Time', 'Agent', 'Redacted', 'Type', 'UUID', 'Duration'].map((h, idx) => (
                <span key={h + idx} className="table-header">
                  {h}
                  {h === 'Redacted' && <InfoTooltip text="The actual value is redacted. Only the type (IBAN, Email...) and UUID are kept in logs." />}
                  {h === 'Type' && <InfoTooltip text="Detected PII category (IBAN, Phone, Email, NID, Card)." />}
                  {h === 'UUID' && <InfoTooltip text="Unique v4 identifier replacing the sensitive data in the LLM stream." />}
                  {h === 'Duration' && <InfoTooltip text="Detection + replacement time by the Rust lib." />}
                </span>
              ))}
            </div>
            <div className="max-h-[350px] overflow-y-auto">
              {feedRows.map(({ evt, piiType, uuid, processingTime }, i) => (
                <div
                  key={evt.id}
                  className={`grid grid-cols-[80px_100px_100px_70px_120px_60px] gap-2 px-5 py-2 text-xs font-mono border-b border-border cursor-pointer hover:bg-muted/50 transition-colors ${i === 0 ? 'animate-fade-in-row' : ''}`}
                  onClick={() => setSelectedToken({
                    id: evt.id,
                    agent: evt.agent,
                    type: piiType,
                    uuid,
                    time: `${processingTime}ms`,
                    timestamp: evt.timestamp,
                  })}
                >
                  <span className="text-muted-foreground">{timeAgo(evt.timestamp)}</span>
                  <span className="text-foreground truncate">{evt.agent}</span>
                  <span className="text-ink-4">{'########'}</span>
                  <span className="text-ink-2">{piiType}</span>
                  <span className="text-ink-3 truncate">{uuid.slice(0, 18)}...</span>
                  <span className="text-muted-foreground">{processingTime}ms</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="col-span-4">
          <div className="flex items-center gap-3 mb-4">
            <div className="text-sm font-body font-medium text-foreground">
              Vault status
              <InfoTooltip text="In-memory vault state storing token ↔ real data associations." />
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
                <span className="text-xs text-muted-foreground">
                  {label}
                  {VAULT_TOOLTIPS[label] && <InfoTooltip text={VAULT_TOOLTIPS[label]} />}
                </span>
                <span className="text-xs font-mono text-foreground">{val}</span>
              </div>
            ))}

            <div className="pt-2">
              <div className="table-header mb-2">
                Tokens by tenant
                <InfoTooltip text="Distribution of active tokens by tenant organization." />
              </div>
              {[
                ['Al Maghrib Bank', '3,210'],
                ['SAMA Corp', '2,891'],
                ['DIFC Holdings', '1,420'],
                ['France Branch', '900'],
              ].map(([t, c]) => (
                <div key={t} className="flex justify-between py-1.5 text-xs">
                  <span className="text-muted-foreground">{t}</span>
                  <span className="font-mono text-foreground">{c}</span>
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
                <div className="text-lg font-heading text-foreground">PII Token Detail</div>
                <div className="text-xs text-muted-foreground font-mono">{selectedToken.uuid}</div>
              </div>
              <button
                onClick={() => setSelectedToken(null)}
                className="p-1.5 rounded hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-5 space-y-5">
              {/* Detected type */}
              <div>
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Detected type</div>
                <div className="text-sm font-mono text-foreground">{selectedToken.type}</div>
                <div className="text-[10px] text-muted-foreground bg-muted/40 rounded p-2 mt-1.5">
                  PII category identified by the Rust detection engine. The corresponding regex pattern is shown below.
                </div>
              </div>

              {/* Source agent */}
              <div>
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Source agent</div>
                <div className="text-sm font-mono text-foreground">{selectedToken.agent}</div>
                <div className="text-[10px] text-muted-foreground bg-muted/40 rounded p-2 mt-1.5">
                  The AI agent that sent the request containing this sensitive data.
                </div>
              </div>

              {/* Detection pattern */}
              <div>
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Detection pattern</div>
                <div className="text-sm font-mono text-foreground bg-muted/50 rounded px-2 py-1.5 break-all">
                  {PII_PATTERNS[selectedToken.type] || '.*'}
                </div>
                <div className="text-[10px] text-muted-foreground bg-muted/40 rounded p-2 mt-1.5">
                  Regular expression used to detect this PII type in the data stream.
                </div>
              </div>

              {/* Token UUID */}
              <div>
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Token UUID</div>
                <div className="text-sm font-mono text-foreground break-all">{selectedToken.uuid}</div>
                <div className="text-[10px] text-muted-foreground bg-muted/40 rounded p-2 mt-1.5">
                  This UUID v4 replaces the actual data in the stream sent to the LLM. The reverse mapping is held in the in-memory vault.
                </div>
              </div>

              {/* Configured TTL */}
              <div>
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Configured TTL</div>
                <div className="text-sm font-mono text-foreground">30 minutes</div>
                <div className="text-[10px] text-muted-foreground bg-muted/40 rounded p-2 mt-1.5">
                  After TTL expiration, detokenization becomes impossible — the real data is permanently purged from memory.
                </div>
              </div>

              {/* Processing time */}
              <div>
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Processing time</div>
                <div className="text-sm font-mono text-foreground">{selectedToken.time}</div>
              </div>

              {/* Status */}
              <div>
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Status</div>
                <span className="inline-flex items-center gap-1.5 text-xs font-mono px-2 py-1 rounded-full bg-emerald-500/10 text-emerald-600">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                  Active in memory
                </span>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

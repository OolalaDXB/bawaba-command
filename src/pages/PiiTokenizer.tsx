import { useMemo } from 'react';
import { PII_TYPES, JURISDICTIONS, generateSparklineData } from '@/lib/mock-data';
import { useLiveFeed } from '@/hooks/use-live-feed';
import { BarChart, Bar, ResponsiveContainer, XAxis, YAxis } from 'recharts';

export default function PiiTokenizer() {
  const { events } = useLiveFeed(20);

  const totalAll = PII_TYPES.reduce((s, p) => s + p.count, 0);
  const totalToday = PII_TYPES.reduce((s, p) => s + p.today, 0);

  const processingDist = useMemo(() => [
    { range: '<1ms', count: 4210 },
    { range: '1-2ms', count: 6340 },
    { range: '2-5ms', count: 2180 },
    { range: '>5ms', count: 327 },
  ], []);

  return (
    <div className="space-y-6">
      {/* Stats */}
      <div>
        <div className="flex items-center gap-3 mb-4">
          <div>
            <div className="text-sm font-body font-medium text-foreground">Tokenization Statistics</div>
            <div className="text-xs text-muted-foreground">PII detection and token vault</div>
          </div>
        </div>

        <div className="grid grid-cols-4 gap-4 mb-6">
          <div className="card-surface shadow-card p-4">
            <div className="table-header mb-2">All Time</div>
            <div className="text-2xl font-mono font-light text-foreground">{totalAll.toLocaleString()}</div>
          </div>
          <div className="card-surface shadow-card p-4">
            <div className="table-header mb-2">Today</div>
            <div className="text-2xl font-mono font-light text-foreground">{totalToday.toLocaleString()}</div>
          </div>
          <div className="card-surface shadow-card p-4">
            <div className="table-header mb-2">This Hour</div>
            <div className="text-2xl font-mono font-light text-foreground">{Math.floor(totalToday / 8)}</div>
          </div>
          <div className="card-surface shadow-card p-4">
            <div className="table-header mb-2">Active Tokens</div>
            <div className="text-2xl font-mono font-light text-foreground">8,421</div>
          </div>
        </div>

        {/* By entity type + processing dist */}
        <div className="grid grid-cols-2 gap-4">
          <div className="card-surface shadow-card p-4">
            <div className="table-header mb-3">By Entity Type</div>
            {PII_TYPES.map(p => (
              <div key={p.type} className="flex items-center justify-between py-2 border-b border-border last:border-0">
                <span className="text-xs text-foreground">{p.type}</span>
                <div className="flex items-center gap-4">
                  <div className="w-24 h-1.5 bg-secondary rounded-full overflow-hidden">
                    <div className="h-full bg-primary" style={{ width: `${(p.count / totalAll) * 100}%` }} />
                  </div>
                  <span className="text-xs font-mono text-muted-foreground w-12 text-right">{p.count.toLocaleString()}</span>
                  <span className="text-[10px] font-mono text-ink-4 w-8 text-right">+{p.today}</span>
                </div>
              </div>
            ))}
          </div>

          <div className="card-surface shadow-card p-4">
            <div className="table-header mb-3">Processing Time Distribution</div>
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
            <div className="text-sm font-body font-medium text-foreground">Live Tokenization Feed</div>
          </div>
          <div className="card-surface shadow-card overflow-hidden">
            <div className="grid grid-cols-[80px_100px_100px_70px_120px_60px] gap-2 px-5 py-2 border-b border-border">
              {['Time', 'Agent', 'Redacted', 'Type', 'UUID', 'Time'].map(h => (
                <span key={h} className="table-header">{h}</span>
              ))}
            </div>
            <div className="max-h-[350px] overflow-y-auto">
              {events.filter(e => e.piiTokens > 0).map((evt, i) => (
                <div key={evt.id} className={`grid grid-cols-[80px_100px_100px_70px_120px_60px] gap-2 px-5 py-2 text-xs font-mono border-b border-border ${i === 0 ? 'animate-fade-in-row' : ''}`}>
                  <span className="text-muted-foreground">{evt.timestamp.toLocaleTimeString('en-GB', { hour12: false })}</span>
                  <span className="text-foreground truncate">{evt.agent}</span>
                  <span className="text-ink-4">████████</span>
                  <span className="text-ink-2">{(['IBAN', 'Phone', 'Email', 'NID', 'Card'])[Math.floor(Math.random() * 5)]}</span>
                  <span className="text-ink-3 truncate">{crypto.randomUUID().slice(0, 18)}…</span>
                  <span className="text-muted-foreground">{(Math.random() * 3).toFixed(1)}ms</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="col-span-4">
          <div className="flex items-center gap-3 mb-4">
            <div className="text-sm font-body font-medium text-foreground">Vault Status</div>
          </div>
          <div className="card-surface shadow-card p-4 space-y-4">
            {[
              ['Active Sessions', '24'],
              ['Tokens in Memory', '8,421'],
              ['Avg TTL Remaining', '23m 14s'],
              ['Memory Usage', '142 MB'],
            ].map(([label, val]) => (
              <div key={label} className="flex justify-between py-2 border-b border-border last:border-0">
                <span className="text-xs text-muted-foreground">{label}</span>
                <span className="text-xs font-mono text-foreground">{val}</span>
              </div>
            ))}

            <div className="pt-2">
              <div className="table-header mb-2">Tokens by Tenant</div>
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
    </div>
  );
}

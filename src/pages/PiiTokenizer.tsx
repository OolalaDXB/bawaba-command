import { useMemo } from 'react';
import { useAuditEvents } from '@/hooks/use-audit-events';
import { useLiveFeed } from '@/hooks/use-live-feed';
import { BarChart, Bar, ResponsiveContainer, XAxis, YAxis } from 'recharts';

export default function PiiTokenizer() {
  const { events: liveEvents } = useLiveFeed(20);
  const { data: allEvents = [] } = useAuditEvents(200);

  // PII stats from real data
  const piiEvents = useMemo(() => allEvents.filter(e => e.tokens_generated > 0), [allEvents]);
  const totalTokens = useMemo(() => allEvents.reduce((s, e) => s + (e.tokens_generated ?? 0), 0), [allEvents]);
  const totalEntities = useMemo(() => allEvents.reduce((s, e) => s + (e.entities_detected ?? 0), 0), [allEvents]);

  // By pii_mode
  const byMode = useMemo(() => {
    const counts: Record<string, number> = {};
    allEvents.forEach(e => {
      const mode = e.pii_mode || 'none';
      counts[mode] = (counts[mode] || 0) + 1;
    });
    return Object.entries(counts).map(([mode, count]) => ({ type: mode, count }));
  }, [allEvents]);

  const processingDist = useMemo(() => {
    const buckets = { '<1ms': 0, '1-5ms': 0, '5-10ms': 0, '>10ms': 0 };
    allEvents.forEach(e => {
      if (e.latency_ms < 1) buckets['<1ms']++;
      else if (e.latency_ms < 5) buckets['1-5ms']++;
      else if (e.latency_ms < 10) buckets['5-10ms']++;
      else buckets['>10ms']++;
    });
    return Object.entries(buckets).map(([range, count]) => ({ range, count }));
  }, [allEvents]);

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
            <div className="table-header mb-2">Total Tokens</div>
            <div className="text-2xl font-mono font-light text-foreground">{totalTokens.toLocaleString()}</div>
          </div>
          <div className="card-surface shadow-card p-4">
            <div className="table-header mb-2">Entities Detected</div>
            <div className="text-2xl font-mono font-light text-foreground">{totalEntities.toLocaleString()}</div>
          </div>
          <div className="card-surface shadow-card p-4">
            <div className="table-header mb-2">Events with PII</div>
            <div className="text-2xl font-mono font-light text-foreground">{piiEvents.length}</div>
          </div>
          <div className="card-surface shadow-card p-4">
            <div className="table-header mb-2">Total Events</div>
            <div className="text-2xl font-mono font-light text-foreground">{allEvents.length}</div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="card-surface shadow-card p-4">
            <div className="table-header mb-3">By PII Mode</div>
            {byMode.map(p => (
              <div key={p.type} className="flex items-center justify-between py-2 border-b border-border last:border-0">
                <span className="text-xs text-foreground">{p.type}</span>
                <div className="flex items-center gap-4">
                  <div className="w-24 h-1.5 bg-secondary rounded-full overflow-hidden">
                    <div className="h-full bg-primary" style={{ width: `${allEvents.length > 0 ? (p.count / allEvents.length) * 100 : 0}%` }} />
                  </div>
                  <span className="text-xs font-mono text-muted-foreground w-12 text-right">{p.count.toLocaleString()}</span>
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
            <div className="grid grid-cols-[80px_100px_80px_60px_60px_60px] gap-2 px-5 py-2 border-b border-border">
              {['Time', 'Agent', 'PII Mode', 'Entities', 'Tokens', 'Lat.'].map(h => (
                <span key={h} className="table-header">{h}</span>
              ))}
            </div>
            <div className="max-h-[350px] overflow-y-auto">
              {liveEvents.filter(e => e.tokens_generated > 0).length === 0 ? (
                <div className="p-8 text-center text-xs text-muted-foreground">No PII events yet</div>
              ) : (
                liveEvents.filter(e => e.tokens_generated > 0).map((evt, i) => (
                  <div key={evt.event_id} className={`grid grid-cols-[80px_100px_80px_60px_60px_60px] gap-2 px-5 py-2 text-xs font-mono border-b border-border ${i === 0 ? 'animate-fade-in-row' : ''}`}>
                    <span className="text-muted-foreground">{new Date(evt.timestamp).toLocaleTimeString('en-GB', { hour12: false })}</span>
                    <span className="text-foreground truncate">{evt.agent_id}</span>
                    <span className="text-ink-2">{evt.pii_mode}</span>
                    <span className="text-muted-foreground">{evt.entities_detected}</span>
                    <span className="text-safe">{evt.tokens_generated}</span>
                    <span className="text-muted-foreground">{evt.latency_ms}ms</span>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        <div className="col-span-4">
          <div className="flex items-center gap-3 mb-4">
            <div className="text-sm font-body font-medium text-foreground">Vault Status</div>
          </div>
          <div className="card-surface shadow-card p-4 space-y-4">
            {[
              ['Total Tokens', totalTokens.toLocaleString()],
              ['PII Events', piiEvents.length.toString()],
              ['Entities Found', totalEntities.toLocaleString()],
              ['Events Scanned', allEvents.length.toString()],
            ].map(([label, val]) => (
              <div key={label} className="flex justify-between py-2 border-b border-border last:border-0">
                <span className="text-xs text-muted-foreground">{label}</span>
                <span className="text-xs font-mono text-foreground">{val}</span>
              </div>
            ))}

            <div className="pt-2">
              <div className="table-header mb-2">Tokens by Jurisdiction</div>
              {Object.entries(
                allEvents.reduce((acc, e) => {
                  const j = e.jurisdiction || 'unknown';
                  acc[j] = (acc[j] || 0) + (e.tokens_generated ?? 0);
                  return acc;
                }, {} as Record<string, number>)
              ).map(([j, count]) => (
                <div key={j} className="flex justify-between py-1.5 text-xs">
                  <span className="text-muted-foreground">{j.toUpperCase()}</span>
                  <span className="font-mono text-foreground">{count.toLocaleString()}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

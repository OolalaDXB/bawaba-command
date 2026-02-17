import { useState } from 'react';
import { useAuditEvents } from '@/hooks/use-audit-events';
import { ROUTING_NODES } from '@/lib/mock-data';

function RoutingMap() {
  return (
    <div className="card-surface shadow-card p-6">
      <div className="flex items-center gap-3 mb-6">
        <div>
          <div className="text-sm font-body font-medium text-foreground">Data Plane Map</div>
          <div className="text-xs text-muted-foreground">MENA + Europe sovereign infrastructure</div>
        </div>
      </div>

      <svg viewBox="0 0 800 400" className="w-full" style={{ maxHeight: 380 }}>
        {Array.from({ length: 20 }).map((_, i) => (
          <line key={`vg-${i}`} x1={i * 40} y1={0} x2={i * 40} y2={400} stroke="hsl(24, 6%, 90%)" strokeWidth={0.5} />
        ))}
        {Array.from({ length: 10 }).map((_, i) => (
          <line key={`hg-${i}`} x1={0} y1={i * 40} x2={800} y2={i * 40} stroke="hsl(24, 6%, 90%)" strokeWidth={0.5} />
        ))}

        <path d="M 300 80 L 420 60 L 480 90 L 450 140 L 380 160 L 320 130 Z" fill="hsl(24, 6%, 93%)" stroke="hsl(24, 6%, 83%)" strokeWidth={1} />
        <path d="M 280 180 L 500 170 L 520 220 L 480 260 L 300 250 L 260 210 Z" fill="hsl(24, 6%, 93%)" stroke="hsl(24, 6%, 83%)" strokeWidth={1} />
        <path d="M 520 160 L 620 140 L 680 200 L 660 280 L 580 300 L 530 240 Z" fill="hsl(24, 6%, 93%)" stroke="hsl(24, 6%, 83%)" strokeWidth={1} />

        <line x1={340} y1={215} x2={400} y2={110} stroke="hsl(30, 24%, 44%)" strokeWidth={1} strokeDasharray="4 4" opacity={0.4} />
        <line x1={340} y1={215} x2={600} y2={200} stroke="hsl(30, 24%, 44%)" strokeWidth={1} strokeDasharray="4 4" opacity={0.4} />
        <line x1={340} y1={215} x2={620} y2={240} stroke="hsl(30, 24%, 44%)" strokeWidth={1} strokeDasharray="4 4" opacity={0.4} />
        <line x1={400} y1={110} x2={600} y2={200} stroke="hsl(30, 24%, 44%)" strokeWidth={1} strokeDasharray="4 4" opacity={0.4} />
        <line x1={600} y1={200} x2={620} y2={240} stroke="hsl(30, 24%, 44%)" strokeWidth={1} strokeDasharray="4 4" opacity={0.4} />

        <circle cx={400} cy={110} r={6} fill="hsl(148, 59%, 24%)" />
        <circle cx={400} cy={110} r={10} fill="none" stroke="hsl(148, 59%, 24%)" strokeWidth={1} opacity={0.3}>
          <animate attributeName="r" values="10;16;10" dur="3s" repeatCount="indefinite" />
          <animate attributeName="opacity" values="0.3;0;0.3" dur="3s" repeatCount="indefinite" />
        </circle>
        <text x={400} y={98} textAnchor="middle" fill="hsl(24, 10%, 10%)" fontSize={10} fontFamily="Hanken Grotesk">Frankfurt</text>
        <text x={400} y={130} textAnchor="middle" fill="hsl(25, 6%, 45%)" fontSize={8} fontFamily="JetBrains Mono">Hetzner · 445 calls · 8ms</text>

        <circle cx={340} cy={215} r={6} fill="hsl(148, 59%, 24%)" />
        <circle cx={340} cy={215} r={10} fill="none" stroke="hsl(148, 59%, 24%)" strokeWidth={1} opacity={0.3}>
          <animate attributeName="r" values="10;16;10" dur="3s" begin="0.5s" repeatCount="indefinite" />
          <animate attributeName="opacity" values="0.3;0;0.3" dur="3s" begin="0.5s" repeatCount="indefinite" />
        </circle>
        <text x={340} y={240} textAnchor="middle" fill="hsl(24, 10%, 10%)" fontSize={10} fontFamily="Hanken Grotesk">Casablanca</text>
        <text x={340} y={253} textAnchor="middle" fill="hsl(25, 6%, 45%)" fontSize={8} fontFamily="JetBrains Mono">Inwi DC · 892 calls · 12ms</text>

        <circle cx={600} cy={200} r={6} fill="hsl(148, 59%, 24%)" />
        <circle cx={600} cy={200} r={10} fill="none" stroke="hsl(148, 59%, 24%)" strokeWidth={1} opacity={0.3}>
          <animate attributeName="r" values="10;16;10" dur="3s" begin="1s" repeatCount="indefinite" />
          <animate attributeName="opacity" values="0.3;0;0.3" dur="3s" begin="1s" repeatCount="indefinite" />
        </circle>
        <text x={600} y={190} textAnchor="middle" fill="hsl(24, 10%, 10%)" fontSize={10} fontFamily="Hanken Grotesk">Riyadh</text>
        <text x={600} y={220} textAnchor="middle" fill="hsl(25, 6%, 45%)" fontSize={8} fontFamily="JetBrains Mono">stc cloud · 1,134 calls · 18ms</text>

        <circle cx={620} cy={240} r={6} fill="hsl(148, 59%, 24%)" />
        <circle cx={620} cy={240} r={10} fill="none" stroke="hsl(148, 59%, 24%)" strokeWidth={1} opacity={0.3}>
          <animate attributeName="r" values="10;16;10" dur="3s" begin="1.5s" repeatCount="indefinite" />
          <animate attributeName="opacity" values="0.3;0;0.3" dur="3s" begin="1.5s" repeatCount="indefinite" />
        </circle>
        <text x={660} y={248} textAnchor="start" fill="hsl(24, 10%, 10%)" fontSize={10} fontFamily="Hanken Grotesk">Abu Dhabi</text>
        <text x={620} y={263} textAnchor="middle" fill="hsl(25, 6%, 45%)" fontSize={8} fontFamily="JetBrains Mono">G42 · 678 calls · 15ms</text>
      </svg>
    </div>
  );
}

export default function SovereignRouting() {
  const [testInput, setTestInput] = useState('');
  const { data: events = [] } = useAuditEvents(50);

  return (
    <div className="space-y-6">
      <RoutingMap />

      <div className="grid grid-cols-12 gap-6">
        {/* Routing rules */}
        <div className="col-span-5">
          <div className="flex items-center gap-3 mb-4">
            <div className="text-sm font-body font-medium text-foreground">Routing Rules</div>
          </div>
          <div className="card-surface shadow-card p-4 space-y-0">
            {[
              { jurisdiction: 'Morocco (ma)', backend: 'Inwi DC — Casablanca', compliance: 'Loi 09-08, CNDP' },
              { jurisdiction: 'KSA (sa)', backend: 'stc cloud — Riyadh', compliance: 'PDPL, SAMA circular' },
              { jurisdiction: 'UAE (ae)', backend: 'G42 — Abu Dhabi', compliance: 'DIFC DP Law, ADGM' },
              { jurisdiction: 'France (fr)', backend: 'OVHcloud — Paris', compliance: 'CNIL / RGPD' },
            ].map(rule => (
              <div key={rule.jurisdiction} className="py-3 border-b border-border last:border-0">
                <div className="text-xs font-body font-medium text-foreground mb-1">{rule.jurisdiction}</div>
                <div className="text-[10px] font-mono text-ink-2">{rule.backend}</div>
                <div className="text-[10px] text-muted-foreground mt-0.5">{rule.compliance}</div>
              </div>
            ))}

            <div className="pt-3">
              <div className="table-header mb-2">Test Routing</div>
              <div className="flex gap-2">
                <input
                  value={testInput}
                  onChange={e => setTestInput(e.target.value)}
                  placeholder="e.g. jurisdiction=ma, tool=database-query"
                  className="flex-1 text-xs font-mono px-3 py-2 border border-border rounded-sm bg-background text-foreground placeholder:text-ink-4 focus:outline-none focus:border-primary"
                />
                <button className="text-xs font-body px-3 py-2 bg-primary text-primary-foreground rounded-sm hover:opacity-90 transition-opacity whitespace-nowrap">
                  Test
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Routing proofs from Supabase */}
        <div className="col-span-7">
          <div className="flex items-center gap-3 mb-4">
            <div className="text-sm font-body font-medium text-foreground">Routing Proofs</div>
          </div>
          <div className="card-surface shadow-card overflow-hidden">
            <div className="grid grid-cols-[80px_120px_100px_1fr_60px] gap-2 px-5 py-2 border-b border-border">
              {['Time', 'Request', 'Jurisdiction', 'Proof Hash', 'Result'].map(h => (
                <span key={h} className="table-header">{h}</span>
              ))}
            </div>
            <div className="max-h-[350px] overflow-y-auto">
              {events.length === 0 ? (
                <div className="p-8 text-center text-xs text-muted-foreground">No routing proofs yet</div>
              ) : (
                events.map(evt => (
                  <div key={evt.event_id} className="grid grid-cols-[80px_120px_100px_1fr_60px] gap-2 px-5 py-2 text-xs font-mono border-b border-border">
                    <span className="text-muted-foreground">{new Date(evt.timestamp).toLocaleTimeString('en-GB', { hour12: false })}</span>
                    <span className="text-foreground truncate">{evt.tool || evt.event_type}</span>
                    <span className="text-ink-2 uppercase">{evt.jurisdiction}</span>
                    <span className="text-ink-4 truncate">{evt.event_hash}</span>
                    <span className={evt.policy_result === 'allow' ? 'text-safe' : 'text-danger'}>{evt.policy_result}</span>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

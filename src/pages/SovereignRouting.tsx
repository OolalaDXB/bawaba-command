import { useState, useEffect, useMemo } from 'react';
import { ROUTING_NODES } from '@/lib/mock-data';
import { isApiAvailable, fetchJurisdictions, type JurisdictionEntry } from '@/services/api';
import SovereignMap from '@/components/SovereignMap';
import InfoTooltip from '@/components/InfoTooltip';

/** Routing rule shape for the sidebar. */
interface RoutingRule {
  jurisdiction: string;
  backend: string;
  compliance: string;
  eventCount: number;
}

/** Default metadata per jurisdiction code. */
const JURISDICTION_META: Record<string, { label: string; backend: string }> = {
  ma: { label: 'Morocco (ma)', backend: 'Inwi DC -- Casablanca' },
  sa: { label: 'KSA (sa)', backend: 'stc cloud -- Riyadh' },
  ae: { label: 'UAE (ae)', backend: 'G42 -- Abu Dhabi' },
  fr: { label: 'France (fr)', backend: 'OVHcloud -- Paris' },
};

/** Extended jurisdiction info for the "Pourquoi cette route ?" panel. */
const JURISDICTION_DETAIL: Record<string, {
  country: string;
  law: string;
  city: string;
  dataPlane: string;
  cloudActStatus: string;
  dataType: string;
}> = {
  ma: { country: 'Maroc', law: 'Loi 09-08', city: 'Casablanca', dataPlane: 'Inwi DC', cloudActStatus: 'Hors Cloud Act', dataType: 'CIN (Carte d\'Identite Nationale)' },
  sa: { country: 'KSA', law: 'PDPL / SAMA', city: 'Riyadh', dataPlane: 'stc cloud', cloudActStatus: 'Hors Cloud Act', dataType: 'National ID (Iqama)' },
  ae: { country: 'UAE', law: 'DIFC / ADGM', city: 'Abu Dhabi', dataPlane: 'G42', cloudActStatus: 'Hors Cloud Act', dataType: 'Emirates ID' },
  fr: { country: 'France', law: 'CNIL / RGPD', city: 'Paris', dataPlane: 'OVHcloud', cloudActStatus: 'Hors Cloud Act (UE)', dataType: 'CNI / Carte Vitale' },
};

/** Mock routing rules as fallback. */
const MOCK_ROUTING_RULES: RoutingRule[] = [
  { jurisdiction: 'Morocco (ma)', backend: 'Inwi DC -- Casablanca', compliance: 'Loi 09-08, CNDP', eventCount: 892 },
  { jurisdiction: 'KSA (sa)', backend: 'stc cloud -- Riyadh', compliance: 'PDPL, SAMA circular', eventCount: 1134 },
  { jurisdiction: 'UAE (ae)', backend: 'G42 -- Abu Dhabi', compliance: 'DIFC DP Law, ADGM', eventCount: 678 },
  { jurisdiction: 'France (fr)', backend: 'OVHcloud -- Paris', compliance: 'CNIL / RGPD', eventCount: 445 },
];

/** Map an API jurisdiction entry to a routing rule. */
function mapJurisdictionToRule(entry: JurisdictionEntry): RoutingRule {
  const meta = JURISDICTION_META[entry.code];
  return {
    jurisdiction: meta?.label || entry.code.toUpperCase(),
    backend: meta?.backend || entry.backend,
    compliance: entry.compliance?.join(', ') || '',
    eventCount: entry.event_count,
  };
}

/** Shape of a routing proof row. */
interface RoutingProof {
  id: string;
  time: string;
  request: string;
  decision: string;
  hash: string;
  jurisdictionCode: string;
  tool: string;
}

/* ── Skeleton for routing rules ─────────────────── */
function RulesSkeleton() {
  return (
    <div className="space-y-0">
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="py-3 border-b border-border last:border-0">
          <div className="animate-pulse bg-muted rounded h-4 w-28 mb-1" />
          <div className="animate-pulse bg-muted rounded h-3 w-40 mb-1" />
          <div className="animate-pulse bg-muted rounded h-3 w-32" />
        </div>
      ))}
    </div>
  );
}

/* ── "Pourquoi cette route ?" Side Panel ─────────── */
function RouteExplainerPanel({
  proof,
  onClose,
}: {
  proof: RoutingProof;
  onClose: () => void;
}) {
  const detail = JURISDICTION_DETAIL[proof.jurisdictionCode];

  if (!detail) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-foreground/10 z-40"
        onClick={onClose}
      />
      {/* Panel */}
      <div className="fixed top-0 right-0 h-full w-[380px] z-50 animate-slide-in-right shadow-lg">
        <div className="h-full card-surface border-l border-border flex flex-col">
          {/* Header */}
          <div className="flex items-center justify-between px-5 py-4 border-b border-border">
            <div>
              <div className="text-sm font-body font-medium text-foreground">Pourquoi cette route ?</div>
              <div className="text-[10px] text-muted-foreground font-mono mt-0.5">{proof.request}</div>
            </div>
            <button
              onClick={onClose}
              className="w-7 h-7 flex items-center justify-center rounded-sm border border-border text-muted-foreground hover:text-foreground hover:bg-secondary/30 transition-colors"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>

          {/* Content */}
          <div className="flex-1 overflow-y-auto px-5 py-5 space-y-5">
            {/* Detected data */}
            <div>
              <div className="table-header mb-2">Donnée détectée <InfoTooltip text="Type de donnée personnelle détecté qui détermine la juridiction applicable." /></div>
              <div className="card-surface p-3">
                <div className="flex items-center gap-2">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-warn shrink-0">
                    <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                    <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                  </svg>
                  <span className="text-xs font-body text-foreground">{detail.dataType}</span>
                </div>
              </div>
            </div>

            {/* Jurisdiction */}
            <div>
              <div className="table-header mb-2">Juridiction <InfoTooltip text="Résolue depuis le claim du token agent. Le header X-Bawaba-Jurisdiction n'est accepté qu'en mode démo." /></div>
              <div className="card-surface p-3">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-mono text-foreground uppercase">{proof.jurisdictionCode}</span>
                  <span className="text-[10px] text-muted-foreground">--</span>
                  <span className="text-xs font-body text-foreground">{detail.country}, {detail.law}</span>
                </div>
              </div>
            </div>

            {/* Data plane */}
            <div>
              <div className="table-header mb-2">Plan de données <InfoTooltip text="Infrastructure physique qui traite la requête. Hors périmètre Cloud Act." /></div>
              <div className="card-surface p-3">
                <div className="text-xs font-body text-foreground">{detail.city} -- {detail.dataPlane}</div>
              </div>
            </div>

            {/* Cloud Act guarantee */}
            <div>
              <div className="table-header mb-2">Garantie</div>
              <div className="card-surface p-3">
                <div className="flex items-center gap-2">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-safe shrink-0">
                    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                  </svg>
                  <span className="text-xs font-body text-safe font-medium">{detail.cloudActStatus}</span>
                </div>
              </div>
            </div>

            {/* Proof hash */}
            <div>
              <div className="table-header mb-2">Preuve <InfoTooltip text="Hash cryptographique de la décision, vérifiable indépendamment." /></div>
              <div className="card-surface p-3">
                <div className="font-mono text-xs text-foreground">{proof.hash.slice(0, 8)}</div>
                <div className="font-mono text-[10px] text-muted-foreground mt-1 break-all">{proof.hash}</div>
              </div>
            </div>
          </div>

          {/* Footer */}
          <div className="px-5 py-3 border-t border-border">
            <div className="text-[10px] text-muted-foreground font-body">
              Cette décision de routage est journalisée et signée cryptographiquement dans le journal d'audit.
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

export default function SovereignRouting() {
  const [testInput, setTestInput] = useState('');
  const [routingRules, setRoutingRules] = useState<RoutingRule[]>(MOCK_ROUTING_RULES);
  const [loading, setLoading] = useState(true);
  const [selectedProof, setSelectedProof] = useState<RoutingProof | null>(null);

  // Raw jurisdiction data used by SovereignMap
  const [jurisdictionEntries, setJurisdictionEntries] = useState<
    Array<{ code: string; event_count: number; avg_latency?: number }>
  >(
    ROUTING_NODES.map((n) => ({
      code: n.jurisdiction,
      event_count: n.calls,
      avg_latency: n.latency,
    })),
  );

  useEffect(() => {
    let cancelled = false;

    async function load() {
      const available = await isApiAvailable();
      if (cancelled) return;

      if (available) {
        try {
          const data = await fetchJurisdictions();
          if (!cancelled && data && data.length > 0) {
            setRoutingRules(data.map(mapJurisdictionToRule));
            setJurisdictionEntries(
              data.map((d) => ({
                code: d.code,
                event_count: d.event_count,
              })),
            );
          }
        } catch {
          // Keep mock routing rules on failure
        }
      }

      if (!cancelled) setLoading(false);
    }

    load();
    return () => { cancelled = true; };
  }, []);

  // Generate routing proof rows (memoized to keep stable hashes)
  const routingProofs = useMemo<RoutingProof[]>(() => {
    const toolNames = ['database-query', 'git-read', 'slack-send', 'jira-read'];
    return ROUTING_NODES.flatMap(node =>
      Array.from({ length: 4 }, (_, i) => ({
        id: `${node.id}-${i}`,
        time: new Date(Date.now() - i * 60000 - Math.floor(Math.random() * 60000))
          .toLocaleTimeString('en-GB', { hour12: false }),
        request: `${node.jurisdiction}/${toolNames[i]}`,
        decision: `-> ${node.name}`,
        hash: Math.random().toString(36).substring(2, 14) + Math.random().toString(36).substring(2, 14),
        jurisdictionCode: node.jurisdiction,
        tool: toolNames[i],
      }))
    );
  }, []);

  return (
    <div className="space-y-6">
      {/* Interactive sovereign data-plane map */}
      <div className="card-surface shadow-card p-6">
        <div className="flex items-center gap-3 mb-4">
          <div>
            <div className="text-sm font-body font-medium text-foreground">Carte des plans de données <InfoTooltip text="Visualisation géographique des data planes souverains. Les données restent dans la juridiction configurée." /></div>
            <div className="text-xs text-muted-foreground">Infrastructure souveraine MENA + Europe</div>
          </div>
        </div>
        <SovereignMap jurisdictions={jurisdictionEntries} />
      </div>

      <div className="grid grid-cols-12 gap-6">
        {/* Routing rules */}
        <div className="col-span-5">
          <div className="flex items-center gap-3 mb-4">
            <div className="text-sm font-body font-medium text-foreground">Règles de routage <InfoTooltip text="Configuration des routes par juridiction. Chaque requête est dirigée vers le backend souverain approprié." /></div>
          </div>
          <div className="card-surface shadow-card p-4 space-y-0">
            {loading ? (
              <RulesSkeleton />
            ) : (
              routingRules.map(rule => (
                <div key={rule.jurisdiction} className="py-3 border-b border-border last:border-0">
                  <div className="flex items-center justify-between">
                    <div className="text-xs font-body font-medium text-foreground mb-1">{rule.jurisdiction}</div>
                    <span className="text-[10px] font-mono text-muted-foreground">{rule.eventCount.toLocaleString()} événements</span>
                  </div>
                  <div className="text-[10px] font-mono text-ink-2">{rule.backend}</div>
                  <div className="text-[10px] text-muted-foreground mt-0.5">{rule.compliance}</div>
                </div>
              ))
            )}

            <div className="pt-3">
              <div className="table-header mb-2">Tester le routage <InfoTooltip text="Simuler une décision de routage pour vérifier la configuration." /></div>
              <div className="flex gap-2">
                <input
                  value={testInput}
                  onChange={e => setTestInput(e.target.value)}
                  placeholder="ex. juridiction=ma, outil=database-query"
                  className="flex-1 text-xs font-mono px-3 py-2 border border-border rounded-sm bg-background text-foreground placeholder:text-ink-4 focus:outline-none focus:border-primary"
                />
                <button className="text-xs font-body px-3 py-2 bg-primary text-primary-foreground rounded-sm hover:opacity-90 transition-opacity whitespace-nowrap">
                  Tester
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Routing proofs */}
        <div className="col-span-7">
          <div className="flex items-center gap-3 mb-4">
            <div className="text-sm font-body font-medium text-foreground">Preuves de routage <InfoTooltip text="Payload JSON canonique + signature Ed25519 stockés pour chaque décision. Vérifiable indépendamment sans accès aux serveurs." /></div>
            <div className="text-[10px] text-muted-foreground font-body">Cliquez sur une ligne pour voir le détail</div>
          </div>
          <div className="card-surface shadow-card overflow-hidden">
            <div className="grid grid-cols-[80px_120px_100px_1fr_60px] gap-2 px-5 py-2 border-b border-border">
              <span className="table-header">Heure</span>
              <span className="table-header">Requête <InfoTooltip text="Juridiction et outil demandés par l'agent." /></span>
              <span className="table-header">Décision <InfoTooltip text="Backend souverain sélectionné pour cette requête." /></span>
              <span className="table-header">Hash preuve <InfoTooltip text="Empreinte cryptographique de la décision de routage. Vérifiable offline." /></span>
              <span className="table-header">Vérifier</span>
            </div>
            <div className="max-h-[350px] overflow-y-auto">
              {routingProofs.map(proof => (
                <div
                  key={proof.id}
                  onClick={() => setSelectedProof(proof)}
                  className={`grid grid-cols-[80px_120px_100px_1fr_60px] gap-2 px-5 py-2 text-xs font-mono border-b border-border cursor-pointer hover:bg-secondary/30 transition-colors ${
                    selectedProof?.id === proof.id ? 'bg-secondary/20' : ''
                  }`}
                >
                  <span className="text-muted-foreground">{proof.time}</span>
                  <span className="text-foreground truncate">{proof.request}</span>
                  <span className="text-safe truncate">{proof.decision}</span>
                  <span className="text-ink-4 truncate">{proof.hash.slice(0, 8)}...</span>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setSelectedProof(proof);
                    }}
                    className="text-[10px] text-primary hover:underline text-left"
                  >
                    vérifier
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Route Explainer Side Panel */}
      {selectedProof && (
        <RouteExplainerPanel
          proof={selectedProof}
          onClose={() => setSelectedProof(null)}
        />
      )}
    </div>
  );
}

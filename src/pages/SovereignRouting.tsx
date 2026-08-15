import { useEffect, useMemo, useState } from 'react';
import { ROUTING_NODES, getJurisdictionFlag } from '@/lib/mock-data';
import {
  addJurisdiction,
  fetchEvents,
  fetchJurisdictions,
  isApiAvailable,
  streamEvents,
  type ApiEvent,
  type JurisdictionEntry,
} from '@/services/api';
import SovereignMap from '@/components/SovereignMap';
import InfoTooltip from '@/components/InfoTooltip';

interface RoutingRule {
  jurisdiction: string;
  backend: string;
  compliance: string;
  eventCount: number;
}

const JURISDICTION_META: Record<string, { label: string; backend: string }> = {
  ma: { label: 'Morocco (ma)', backend: 'Casablanca sovereign data plane' },
  sa: { label: 'Saudi Arabia (sa)', backend: 'Riyadh sovereign data plane' },
  ae: { label: 'UAE (ae)', backend: 'Abu Dhabi sovereign data plane' },
  eu: { label: 'European Union (eu)', backend: 'Frankfurt EU data plane' },
  fr: { label: 'France (fr)', backend: 'Paris EU data plane' },
};

const MOCK_ROUTING_RULES: RoutingRule[] = [
  { jurisdiction: 'Morocco (ma)', backend: 'Casablanca sovereign data plane', compliance: 'Loi 09-08, CNDP', eventCount: 49 },
  { jurisdiction: 'Saudi Arabia (sa)', backend: 'Riyadh sovereign data plane', compliance: 'PDPL, SAMA circular', eventCount: 10 },
  { jurisdiction: 'UAE (ae)', backend: 'Abu Dhabi sovereign data plane', compliance: 'UAE PDPL, DIFC, ADGM', eventCount: 11 },
  { jurisdiction: 'European Union (eu)', backend: 'Frankfurt EU data plane', compliance: 'GDPR, DORA', eventCount: 13 },
];

function mapJurisdictionToRule(entry: JurisdictionEntry): RoutingRule {
  const meta = JURISDICTION_META[entry.code];
  return {
    jurisdiction: meta?.label || entry.code.toUpperCase(),
    backend: meta?.backend || entry.backend,
    compliance: entry.compliance?.join(', ') || '',
    eventCount: entry.event_count,
  };
}

interface RoutingProofPayload {
  jurisdiction: string;
  node_id: string;
  nonce: string;
  request_id: string;
  timestamp: string;
}

interface RoutingProofEnvelope {
  payload: RoutingProofPayload;
  signature: string;
}

interface RoutingProofRow {
  id: string;
  time: string;
  request: string;
  decision: string;
  signature: string;
  eventHash: string;
  jurisdictionCode: string;
  tool: string;
  payload: RoutingProofPayload;
}

function parseRoutingProof(evt: ApiEvent): RoutingProofRow | null {
  if (!evt.routing_proof) return null;
  try {
    const proof = JSON.parse(evt.routing_proof) as RoutingProofEnvelope;
    if (!proof?.payload?.jurisdiction || !proof?.payload?.node_id || !proof?.signature) {
      return null;
    }
    return {
      id: evt.event_id,
      time: new Date(evt.timestamp).toLocaleTimeString('en-GB', { hour12: false }),
      request: `${evt.jurisdiction}/${evt.tool}`,
      decision: `→ ${proof.payload.node_id}`,
      signature: proof.signature,
      eventHash: evt.event_hash,
      jurisdictionCode: proof.payload.jurisdiction,
      tool: evt.tool,
      payload: proof.payload,
    };
  } catch {
    return null;
  }
}

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

function RouteExplainerPanel({ proof, onClose }: { proof: RoutingProofRow; onClose: () => void }) {
  return (
    <>
      <div className="fixed inset-0 bg-foreground/10 z-40" onClick={onClose} />
      <div className="fixed top-0 right-0 h-full w-[420px] z-50 animate-slide-in-right shadow-lg">
        <div className="h-full card-surface border-l border-border flex flex-col">
          <div className="flex items-center justify-between px-5 py-4 border-b border-border">
            <div>
              <div className="text-sm font-body font-medium text-foreground">Signed routing decision</div>
              <div className="text-[10px] text-muted-foreground font-mono mt-0.5">{proof.id}</div>
            </div>
            <button
              onClick={onClose}
              className="w-7 h-7 flex items-center justify-center rounded-sm border border-border text-muted-foreground hover:text-foreground hover:bg-secondary/30 transition-colors"
              aria-label="Close routing proof"
            >
              ×
            </button>
          </div>

          <div className="flex-1 overflow-y-auto px-5 py-5 space-y-5">
            <div>
              <div className="table-header mb-2">Request</div>
              <div className="card-surface p-3 text-xs font-mono text-foreground">{proof.request}</div>
            </div>

            <div>
              <div className="table-header mb-2">Selected data plane</div>
              <div className="card-surface p-3">
                <div className="text-xs font-mono text-foreground">{proof.payload.node_id}</div>
                <div className="text-[10px] text-muted-foreground mt-1">Jurisdiction: {proof.payload.jurisdiction.toUpperCase()}</div>
              </div>
            </div>

            <div>
              <div className="table-header mb-2">Canonical signed payload</div>
              <pre className="card-surface p-3 text-[10px] font-mono text-foreground whitespace-pre-wrap break-all">
                {JSON.stringify(proof.payload, null, 2)}
              </pre>
            </div>

            <div>
              <div className="table-header mb-2">Ed25519 signature</div>
              <div className="card-surface p-3 text-[10px] font-mono text-muted-foreground break-all">
                {proof.signature}
              </div>
            </div>

            <div>
              <div className="table-header mb-2">Audit event hash</div>
              <div className="card-surface p-3 text-[10px] font-mono text-muted-foreground break-all">
                {proof.eventHash}
              </div>
            </div>
          </div>

          <div className="px-5 py-3 border-t border-border text-[10px] text-muted-foreground font-body">
            The proof is generated by the running router and persisted with the audit event. Independent offline verification remains a current-sprint deliverable.
          </div>
        </div>
      </div>
    </>
  );
}


function AddJurisdictionForm({ onAdded, apiAvailable }: { onAdded: () => void; apiAvailable: boolean }) {
  const [code, setCode] = useState('');
  const [backend, setBackend] = useState('');
  const [compliance, setCompliance] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  if (!apiAvailable) return null;

  const submit = async () => {
    setBusy(true); setMsg(null);
    try {
      await addJurisdiction({
        jurisdiction: code.trim().toLowerCase(),
        backend: backend.trim(),
        compliance: compliance.split(',').map(x => x.trim()).filter(Boolean),
      });
      setMsg(`${getJurisdictionFlag(code)} ${code.toLowerCase()} added — in-memory until restart (durable routing is P2).`);
      setCode(''); setBackend(''); setCompliance('');
      onAdded();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    }
    setBusy(false);
  };

  return (
    <div className="card-surface shadow-card p-4 mt-4">
      <div className="text-sm font-body font-medium text-foreground mb-2">Add a jurisdiction</div>
      <div className="flex flex-wrap gap-2 items-center">
        <input value={code} onChange={e => setCode(e.target.value)} placeholder="code (qa, sg…)"
          className="border border-border rounded-[4px] bg-background px-2 py-1 text-xs font-mono w-24" maxLength={2} />
        <input value={backend} onChange={e => setBackend(e.target.value)} placeholder="sovereign backend (e.g. Ooredoo DC Doha)"
          className="border border-border rounded-[4px] bg-background px-2 py-1 text-xs w-64" />
        <input value={compliance} onChange={e => setCompliance(e.target.value)} placeholder="compliance tags, comma-separated"
          className="border border-border rounded-[4px] bg-background px-2 py-1 text-xs w-56" />
        <button onClick={submit} disabled={busy || code.trim().length !== 2 || !backend.trim()}
          className="text-xs font-mono border border-border rounded-[6px] px-3 py-1 bg-primary text-primary-foreground disabled:opacity-50">
          Add
        </button>
      </div>
      <div className="text-[11px] text-muted-foreground mt-2">
        Registered live in the router (audit-logged). Traffic for this code routes to the new backend immediately; map pins for new countries arrive with durable routing (P2).
      </div>
      {msg && <div className="text-xs text-ink-2 mt-1">{msg}</div>}
    </div>
  );
}

export default function SovereignRouting() {
  const [routingRules, setRoutingRules] = useState<RoutingRule[]>(MOCK_ROUTING_RULES);
  const [loading, setLoading] = useState(true);
  const [selectedProof, setSelectedProof] = useState<RoutingProofRow | null>(null);
  const [routingProofs, setRoutingProofs] = useState<RoutingProofRow[]>([]);
  const [apiAvailable, setApiAvailable] = useState(false);
  const [jurisdictionEntries, setJurisdictionEntries] = useState<Array<{ code: string; event_count: number; avg_latency?: number }>>(
    ROUTING_NODES.map(node => ({
      code: node.jurisdiction === 'fr' ? 'eu' : node.jurisdiction,
      event_count: node.calls,
      avg_latency: node.latency,
    })),
  );

  useEffect(() => {
    let cancelled = false;

    async function load() {
      const available = await isApiAvailable();
      if (cancelled) return;
      setApiAvailable(available);

      if (available) {
        try {
          const [jurisdictions, eventsResponse] = await Promise.all([
            fetchJurisdictions(),
            fetchEvents(1, 100),
          ]);
          if (cancelled) return;

          if (jurisdictions?.length) {
            setRoutingRules(jurisdictions.map(mapJurisdictionToRule));
            setJurisdictionEntries(jurisdictions.map(entry => ({
              code: entry.code,
              event_count: entry.event_count,
            })));
          }

          const proofs = (eventsResponse.events || [])
            .map(parseRoutingProof)
            .filter((proof): proof is RoutingProofRow => proof !== null);
          setRoutingProofs(proofs);
        } catch {
          setRoutingRules([]);
          setJurisdictionEntries([]);
          setRoutingProofs([]);
        }
      }

      if (!cancelled) setLoading(false);
    }

    load();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!apiAvailable) return;
    return streamEvents((event: ApiEvent) => {
      const proof = parseRoutingProof(event);
      if (!proof) return;
      setRoutingProofs(previous => [proof, ...previous.filter(item => item.id !== proof.id)].slice(0, 100));
      setJurisdictionEntries(previous => previous.map(entry =>
        entry.code === proof.jurisdictionCode
          ? { ...entry, event_count: entry.event_count + 1 }
          : entry,
      ));
    });
  }, [apiAvailable]);

  const latestProofByJurisdiction = useMemo(() => {
    const result: Record<string, RoutingProofRow> = {};
    for (const proof of routingProofs) {
      if (!result[proof.jurisdictionCode]) result[proof.jurisdictionCode] = proof;
    }
    return result;
  }, [routingProofs]);

  return (
    <div className="space-y-6">
      <div className="card-surface shadow-card p-6">
        <div className="flex items-center gap-3 mb-4">
          <div>
            <div className="text-sm font-body font-medium text-foreground">
              Data plane map
              <InfoTooltip text="Configured sovereign data planes. Click a node to open its latest real signed routing proof." />
            </div>
            <div className="text-xs text-muted-foreground">MENA + Europe sovereign infrastructure</div>
          </div>
        </div>
        <SovereignMap
          jurisdictions={jurisdictionEntries}
          onNodeClick={(code) => {
            const normalized = code === 'fr' ? 'eu' : code;
            const proof = latestProofByJurisdiction[normalized];
            if (proof) setSelectedProof(proof);
          }}
        />
      </div>

      <div className="grid grid-cols-12 gap-6">
        <div className="col-span-5">
          <div className="flex items-center gap-3 mb-4">
            <div className="text-base font-body font-medium text-foreground">
              Routing rules
              <InfoTooltip text="Configuration returned by the live BAWABA API." />
            </div>
          </div>
          <div className="card-surface shadow-card p-4 space-y-0">
            {loading ? <RulesSkeleton /> : routingRules.map(rule => (
              <div key={rule.jurisdiction} className="py-3 border-b border-border last:border-0">
                <div className="flex items-center justify-between">
                  <div className="text-sm font-body font-medium text-foreground mb-1">{rule.jurisdiction}</div>
                  <span className="text-xs font-data tabular-nums text-muted-foreground">{rule.eventCount.toLocaleString()} events</span>
                </div>
                <div className="text-sm text-ink-2">{rule.backend}</div>
                <div className="text-xs text-muted-foreground mt-0.5">{rule.compliance}</div>
              </div>
            ))}
          </div>
          <AddJurisdictionForm
            apiAvailable={apiAvailable}
            onAdded={() => {
              fetchJurisdictions().then(jurisdictions => {
                if (jurisdictions?.length) setRoutingRules(jurisdictions.map(mapJurisdictionToRule));
              }).catch(() => {});
            }}
          />
        </div>

        <div className="col-span-7">
          <div className="flex items-center gap-3 mb-4">
            <div className="text-base font-body font-medium text-foreground">
              Signed routing proofs
              <InfoTooltip text="Real canonical JSON payloads and Ed25519 signatures persisted by the running router." />
            </div>
            <div className="text-[10px] text-muted-foreground font-body">Click a row to inspect the persisted proof</div>
          </div>
          <div className="card-surface shadow-card overflow-hidden">
            <div className="grid grid-cols-[80px_120px_150px_1fr_64px] gap-2 px-5 py-2 border-b border-border">
              <span className="table-header">Time</span>
              <span className="table-header">Request</span>
              <span className="table-header">Decision</span>
              <span className="table-header">Signature</span>
              <span className="table-header">Inspect</span>
            </div>
            <div className="max-h-[350px] overflow-y-auto zebra">
              {routingProofs.length === 0 ? (
                <div className="px-5 py-8 text-sm text-muted-foreground text-center">
                  No persisted routing proofs yet. Run the deterministic routing scenario.
                </div>
              ) : routingProofs.map(proof => (
                <div
                  key={proof.id}
                  onClick={() => setSelectedProof(proof)}
                  className={`data-row grid grid-cols-[80px_120px_150px_1fr_64px] gap-2 px-5 py-2 text-sm font-data tabular-nums border-b border-border cursor-pointer hover:bg-secondary/30 transition-colors ${selectedProof?.id === proof.id ? 'bg-secondary/20' : ''}`}
                >
                  <span className="text-muted-foreground">{proof.time}</span>
                  <span className="text-foreground truncate">{proof.request}</span>
                  <span className="text-safe truncate">{proof.decision}</span>
                  <span className="text-ink-3 truncate mono-cell text-xs self-center">{proof.signature.slice(0, 16)}…</span>
                  <button
                    onClick={(event) => {
                      event.stopPropagation();
                      setSelectedProof(proof);
                    }}
                    className="text-xs text-primary hover:underline text-left"
                  >
                    inspect
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {selectedProof && <RouteExplainerPanel proof={selectedProof} onClose={() => setSelectedProof(null)} />}
    </div>
  );
}

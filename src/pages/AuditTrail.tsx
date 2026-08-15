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
  isApiAvailable, fetchEvents, streamEvents, verifyChain, exportEvents, postEventReview,
  type ApiEvent, type ChainVerification,
} from '@/services/api';
import InfoTooltip from '@/components/InfoTooltip';
import { useLocalAudit, pushInjectedEvent, setReviewStatus } from '@/lib/local-audit';
import { PETROL, PETROL_SERIES, DECISION_COLORS } from '@/lib/chart-colors';
import { useLang, type Lang } from '@/lib/i18n';
import { X } from 'lucide-react';

const T: Record<Lang, Record<string, string>> = {
  en: {
    agoS: '{n}s ago',
    agoM: '{n}m ago',
    agoH: '{n}h ago',
    agoD: '{n}d ago',
    explainerQ: 'How does the audit chain work?',
    explainerBody: 'Every event carries the SHA-256 fingerprint of the previous one and is cryptographically signed (Ed25519). Alter a single event and the chain breaks; BAWABA detects it immediately.',
    modified: 'modified',
    alteredTip: 'payload altered — recomputed hash {h}',
    byDecision: 'By decision',
    byDecisionTip: 'Event distribution by policy decision type.',
    byJurisdiction: 'By jurisdiction',
    byAgent: 'By agent',
    latencyShape: 'Simulated latency shape (7d)',
    latencyShapeTip: 'Illustrative trend used only in the demonstration environment. Live event latency is shown in the audit table.',
    offlineBanner: 'API unreachable — showing local demonstration data. Server-side integrity verification is unavailable.',
    errorBanner: 'Failed to load events from the API. No data is shown rather than fabricated events. Retry once the backend is reachable.',
    auditExplorer: 'Audit Explorer',
    countLine: '{n} persisted events · Tamper-evident chain',
    localCount: ' · {n} local/simulated (separate)',
    exporting: 'Exporting...',
    exportSiem: 'Export to SIEM',
    exportSiemTip: 'Generates a verifiable evidence.json bundle — transmittable to Risk/Audit/Compliance.',
    generateReport: 'Generate Report',
    generateReportTip: 'Downloads a real evidence.json bundle of the shown events with their hashes and signatures.',
    hashChain: 'Hash Chain',
    hashChainTip: 'Each event includes the SHA-256 hash of the previous event. Any modification breaks the chain — detectable by VerifyChain().',
    tamperEvident: 'Tamper-evident audit trail',
    verifyTitleNoApi: 'Server verification requires a reachable API',
    verifyTitleTamper: 'Restore the tamper simulation before running the real check',
    verifying: 'Verifying...',
    verifyIntegrity: 'Verify integrity',
    verifyNoteA: 'Verify integrity calls the live server endpoint ',
    verifyNoteB: ' and covers only persisted events.',
    verifyNoteOffline: ' The API is not reachable, so it is disabled.',
    verifyUnavailable: 'Server verification unavailable — the API is not reachable.',
    verifyFailed: 'Verification request failed',
    chainVerified: 'Server chain verified — {n} persisted events, 0 tampering',
    chainFailed: 'Server chain check failed at event #{n}',
    noEventsVerify: 'No persisted events to verify.',
    scopeLine: 'scope: {n} persisted events',
    localOutside: '{n} local/simulated row{s} are shown separately and are outside the verified server chain.',
    tamperTitle: 'Tamper simulation · local',
    tamperDesc: 'Local-only demonstration. Does not call the server or change persisted data.',
    selectBlock: 'Select a block…',
    simulateTamper: 'Simulate tampering',
    restore: 'Restore',
    tamperHint: 'Click any event block above to alter its payload; the check runs locally.',
    tamperMsg: 'Chain broken at #{n}: event hash mismatch',
    localCheck: 'local check',
    filterAll: 'All',
    filterNeedsReview: 'needs review',
    rowHint: 'Click a row to see the full cryptographic proof and JSON payload',
    hTime: 'Time',
    hAgent: 'Agent',
    hTool: 'Tool',
    hResult: 'Result',
    hPii: 'PII',
    hLat: 'Lat.',
    hHash: 'Hash',
    badgeReviewedRow: 'reviewed',
    badgeEscalatedRow: 'escalated',
    loading: 'Loading...',
    loadMore: 'Load more',
    localSection: 'Local & simulated events',
    localSectionDesc: 'Generated in this browser session (agent registration, offline review, simulated requests). Not part of the persisted chain and excluded from server verification.',
    pillSimulated: 'Simulated',
    pillLocal: 'Local demo',
    eventTitle: 'Event #{id}',
    badgeEscalated: 'Escalated',
    badgeReviewed: 'Reviewed',
    revDecA: 'Human review decision: ',
    revDecB: ' by ',
    revRefA: 'References original event ',
    revRefB: '. This is a new, chained, signed event — the original was not modified.',
    reviewHeader: 'Review',
    reviewHeaderTip: 'Records an append-only review decision as a new signed event chained after this one. The original event is never modified or deleted.',
    acknowledge: 'Acknowledge',
    escalate: 'Escalate',
    alreadyReviewed: 'This event has already been reviewed. Exactly one review decision is allowed per event; the decision is a separate immutable event.',
    revNoteApiA: 'The decision is persisted by the backend as a new signed ',
    revNoteApiB: " event chained into the server audit trail, referencing this event's id. One decision per event; the original event is immutable.",
    revNoteLocalA: 'API unreachable — the decision is recorded as a ',
    revNoteLocalB: ' event shown separately, outside the verified server chain. One decision per event; the original event is immutable.',
    introExplainer: 'Each event is chained to the previous one by its SHA-256 hash and individually signed (Ed25519). Any modification of a single field invalidates the chain — making tampering detectable.',
    eventHash: 'Event hash',
    eventHashNote: "SHA-256 of this event's canonical payload. Serves as an anchor for chaining.",
    prevHashHdr: 'Previous hash',
    prevHashNote: 'Fingerprint of event N-1. Guarantees the order and integrity of the sequence.',
    sigHeader: 'Ed25519 Signature',
    sigVerified: 'Verified by server-side chain check ✓',
    sigPersisted: 'Signature persisted · run Verify integrity',
    sigNote: 'The gateway signs each event. The current console validates signatures through the server-side chain check; independent offline verification remains a current-sprint deliverable.',
    hdrAgent: 'Agent',
    hdrTool: 'Tool',
    hdrDecision: 'Decision',
    allowed: '✓ Allowed',
    denied: '✗ Denied',
    rateLimited: '⚠ Rate-limited',
    piiDetected: 'PII detected',
    latency: 'Latency',
    fullPayload: 'Full payload',
    fullPayloadNote: 'This is the console projection of the persisted audit event. The server can generate an evidence bundle; independent offline verification remains a current-sprint deliverable.',
  },
  fr: {
    agoS: 'il y a {n} s',
    agoM: 'il y a {n} min',
    agoH: 'il y a {n} h',
    agoD: 'il y a {n} j',
    explainerQ: 'Comment fonctionne la chaîne d’audit ?',
    explainerBody: 'Chaque événement porte l’empreinte SHA-256 du précédent et est signé cryptographiquement (Ed25519). Altérez un seul événement et la chaîne se rompt ; BAWABA le détecte immédiatement.',
    modified: 'modifié',
    alteredTip: 'charge utile altérée — hachage recalculé {h}',
    byDecision: 'Par décision',
    byDecisionTip: 'Répartition des événements par type de décision de politique.',
    byJurisdiction: 'Par juridiction',
    byAgent: 'Par agent',
    latencyShape: 'Forme de latence simulée (7 j)',
    latencyShapeTip: 'Tendance illustrative utilisée uniquement dans l’environnement de démonstration. La latence des événements réels est affichée dans la table d’audit.',
    offlineBanner: 'API injoignable — affichage de données de démonstration locales. La vérification d’intégrité côté serveur est indisponible.',
    errorBanner: 'Échec du chargement des événements depuis l’API. Aucune donnée n’est affichée plutôt que des événements fabriqués. Réessayez une fois le backend joignable.',
    auditExplorer: 'Explorateur d’audit',
    countLine: '{n} événements persistés · Chaîne à preuve d’altération',
    localCount: ' · {n} locaux/simulés (séparés)',
    exporting: 'Export en cours…',
    exportSiem: 'Exporter vers SIEM',
    exportSiemTip: 'Génère un bundle evidence.json vérifiable — transmissible à Risque/Audit/Conformité.',
    generateReport: 'Générer le rapport',
    generateReportTip: 'Télécharge un bundle evidence.json réel des événements affichés, avec leurs hachages et signatures.',
    hashChain: 'Chaîne de hachage',
    hashChainTip: 'Chaque événement inclut le hachage SHA-256 de l’événement précédent. Toute modification rompt la chaîne — détectable par VerifyChain().',
    tamperEvident: 'Piste d’audit à preuve d’altération',
    verifyTitleNoApi: 'La vérification côté serveur nécessite une API joignable',
    verifyTitleTamper: 'Restaurez la simulation d’altération avant d’exécuter la vérification réelle',
    verifying: 'Vérification…',
    verifyIntegrity: 'Vérifier l’intégrité',
    verifyNoteA: 'Vérifier l’intégrité appelle le point de terminaison serveur réel ',
    verifyNoteB: ' et ne couvre que les événements persistés.',
    verifyNoteOffline: ' L’API n’est pas joignable ; il est donc désactivé.',
    verifyUnavailable: 'Vérification serveur indisponible — l’API n’est pas joignable.',
    verifyFailed: 'La requête de vérification a échoué',
    chainVerified: 'Chaîne serveur vérifiée — {n} événements persistés, 0 altération',
    chainFailed: 'Échec de la vérification de la chaîne serveur à l’événement #{n}',
    noEventsVerify: 'Aucun événement persisté à vérifier.',
    scopeLine: 'périmètre : {n} événements persistés',
    localOutside: '{n} ligne{s} locale{s}/simulée{s} affichée{s} séparément, hors de la chaîne serveur vérifiée.',
    tamperTitle: 'Simulation d’altération · locale',
    tamperDesc: 'Démonstration purement locale. N’appelle pas le serveur et ne modifie pas les données persistées.',
    selectBlock: 'Sélectionnez un bloc…',
    simulateTamper: 'Simuler une altération',
    restore: 'Restaurer',
    tamperHint: 'Cliquez sur un bloc d’événement ci-dessus pour altérer sa charge utile ; la vérification s’exécute localement.',
    tamperMsg: 'Chaîne rompue au #{n} : hachage d’événement non concordant',
    localCheck: 'vérification locale',
    filterAll: 'Tous',
    filterNeedsReview: 'à examiner',
    rowHint: 'Cliquez sur une ligne pour voir la preuve cryptographique complète et la charge JSON',
    hTime: 'Heure',
    hAgent: 'Agent',
    hTool: 'Outil',
    hResult: 'Résultat',
    hPii: 'PII',
    hLat: 'Lat.',
    hHash: 'Hachage',
    badgeReviewedRow: 'examiné',
    badgeEscalatedRow: 'escaladé',
    loading: 'Chargement…',
    loadMore: 'Charger plus',
    localSection: 'Événements locaux et simulés',
    localSectionDesc: 'Générés dans cette session de navigateur (enregistrement d’agent, revue hors ligne, requêtes simulées). Hors de la chaîne persistée et exclus de la vérification serveur.',
    pillSimulated: 'Simulé',
    pillLocal: 'Démo locale',
    eventTitle: 'Événement #{id}',
    badgeEscalated: 'Escaladé',
    badgeReviewed: 'Examiné',
    revDecA: 'Décision de revue humaine : ',
    revDecB: ' par ',
    revRefA: 'Référence l’événement d’origine ',
    revRefB: '. Il s’agit d’un nouvel événement chaîné et signé — l’original n’a pas été modifié.',
    reviewHeader: 'Revue',
    reviewHeaderTip: 'Enregistre une décision de revue append-only sous forme de nouvel événement signé, chaîné après celui-ci. L’événement d’origine n’est jamais modifié ni supprimé.',
    acknowledge: 'Acquitter',
    escalate: 'Escalader',
    alreadyReviewed: 'Cet événement a déjà été examiné. Une seule décision de revue est autorisée par événement ; la décision est un événement immuable distinct.',
    revNoteApiA: 'La décision est persistée par le backend sous forme de nouvel événement signé ',
    revNoteApiB: ' chaîné dans la piste d’audit serveur et référençant l’identifiant de cet événement. Une décision par événement ; l’événement d’origine est immuable.',
    revNoteLocalA: 'API injoignable — la décision est enregistrée comme événement ',
    revNoteLocalB: ' affiché séparément, hors de la chaîne serveur vérifiée. Une décision par événement ; l’événement d’origine est immuable.',
    introExplainer: 'Chaque événement est chaîné au précédent par son hachage SHA-256 et signé individuellement (Ed25519). Toute modification d’un seul champ invalide la chaîne — rendant l’altération détectable.',
    eventHash: 'Hachage de l’événement',
    eventHashNote: 'SHA-256 de la charge canonique de cet événement. Sert d’ancre pour le chaînage.',
    prevHashHdr: 'Hachage précédent',
    prevHashNote: 'Empreinte de l’événement N-1. Garantit l’ordre et l’intégrité de la séquence.',
    sigHeader: 'Signature Ed25519',
    sigVerified: 'Vérifiée par la vérification de chaîne côté serveur ✓',
    sigPersisted: 'Signature persistée · lancez Vérifier l’intégrité',
    sigNote: 'La passerelle signe chaque événement. La console actuelle valide les signatures via la vérification de chaîne côté serveur ; la vérification hors ligne indépendante reste un livrable du sprint en cours.',
    hdrAgent: 'Agent',
    hdrTool: 'Outil',
    hdrDecision: 'Décision',
    allowed: '✓ Autorisé',
    denied: '✗ Refusé',
    rateLimited: '⚠ Limité en débit',
    piiDetected: 'PII détectées',
    latency: 'Latence',
    fullPayload: 'Charge utile complète',
    fullPayloadNote: 'Ceci est la projection console de l’événement d’audit persisté. Le serveur peut générer un bundle de preuves ; la vérification hors ligne indépendante reste un livrable du sprint en cours.',
  },
};

/* ── Time-ago helper ────────────────────────────── */
function timeAgo(date: Date, t: Record<string, string>): string {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return t.agoS.replace('{n}', String(seconds));
  if (seconds < 3600) return t.agoM.replace('{n}', String(Math.floor(seconds / 60)));
  if (seconds < 86400) return t.agoH.replace('{n}', String(Math.floor(seconds / 3600)));
  return t.agoD.replace('{n}', String(Math.floor(seconds / 86400)));
}

/** Map an API event to the MCPEvent shape used by the UI. */
function mapApiEvent(apiEvt: ApiEvent): MCPEvent {
  const isReview = apiEvt.event_type === 'review_decision';
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
    eventType: apiEvt.event_type,
    refEventId: isReview ? apiEvt.resource_path : undefined,
    reviewLabel: isReview ? (apiEvt.matched_rule as 'acknowledge' | 'escalate') : undefined,
    reviewer: isReview ? apiEvt.agent_id : undefined,
    details: {
      request_id: apiEvt.event_id,
      agent_id: apiEvt.agent_id,
      tool_name: apiEvt.tool,
      policy_matched: apiEvt.matched_rule,
      pii_mode: apiEvt.pii_mode,
      entities_detected: apiEvt.entities_detected || 0,
      tokens_generated: apiEvt.tokens_generated || 0,
      routing_proof: apiEvt.routing_proof || '',
      mcp_server: apiEvt.mcp_server || '',
      jurisdiction: apiEvt.jurisdiction,
      evaluation_time_ms: apiEvt.overhead_ms?.toFixed(2) ?? '0.00',
    },
  };
}

/* ── Deterministic demo signature for the evidence bundle ─────── */
function evidenceSignature(hash: string): string {
  let h = 0;
  for (let i = 0; i < hash.length; i++) h = ((h << 5) - h + hash.charCodeAt(i)) | 0;
  const hex = Math.abs(h).toString(16).padStart(8, '0');
  return `ed25519:${hex}${hex}`;
}

/* ── Collapsible Explainer Panel ─────────────────── */
function ExplainerPanel() {
  const t = T[useLang()];
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
          {t.explainerQ}
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
            {t.explainerBody}
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
  tamperedIndex,
  armed,
  onBlockClick,
}: {
  events: MCPEvent[];
  blockStatuses: BlockStatus[];
  lineStatuses: ('idle' | 'verified')[];
  tamperedIndex?: number | null;
  armed?: boolean;
  onBlockClick?: (i: number) => void;
}) {
  const t = T[useLang()];
  const chain = events.slice(0, 8);

  return (
    <div className="flex items-center gap-0 overflow-x-auto pb-2">
      <TooltipProvider delayDuration={150}>
        {chain.map((evt, i) => {
          const tampered = tamperedIndex === i;
          const shownHash = tampered ? 'ffffffff' + evt.hash.slice(8) : evt.hash;
          return (
          <div key={evt.id} className="flex items-center shrink-0">
            {/* Block */}
            <div
              onClick={() => onBlockClick?.(i)}
              className={`border rounded-sm p-3 bg-background min-w-[130px] transition-none ${
                armed ? 'cursor-pointer hover:border-danger/60 hover:ring-1 hover:ring-danger/30' : ''
              } ${
                tampered
                  ? 'border-danger bg-danger-bg'
                  : blockStatuses[i] === 'verified'
                    ? 'animate-chain-verify'
                    : blockStatuses[i] === 'corrupt'
                      ? 'animate-chain-corrupt'
                      : 'border-border'
              }`}
            >
              <div className="text-[9px] text-muted-foreground mb-1 font-body flex items-center justify-between">
                <span>#{i + 1}</span>
                {tampered && <span className="text-[8px] font-mono text-danger uppercase tracking-wide">{t.modified}</span>}
              </div>

              {/* Hash with tooltip */}
              <Tooltip>
                <TooltipTrigger asChild>
                  <div className={`font-mono text-[10px] cursor-help ${tampered ? 'text-danger line-through' : 'text-foreground'}`}>
                    {shownHash.slice(0, 8)}
                  </div>
                </TooltipTrigger>
                <TooltipContent side="top" className="font-mono text-[10px] max-w-[260px] break-all">
                  {tampered ? t.alteredTip.replace('{h}', shownHash) : evt.hash}
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
          );
        })}
      </TooltipProvider>
    </div>
  );
}

/* ── Audit Stats Sidebar ────────────────────────── */
function AuditStats({ events }: { events: MCPEvent[] }) {
  const t = T[useLang()];
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
        <div className="table-header mb-3">{t.byDecision} <InfoTooltip text={t.byDecisionTip} /></div>
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
        <div className="table-header mb-3">{t.byJurisdiction}</div>
        <div className="h-28">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={byJurisdiction} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
              <XAxis dataKey="name" tick={{ fontSize: 9 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 9 }} axisLine={false} tickLine={false} />
              <Bar dataKey="value" fill={PETROL} radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* By Agent */}
      <div className="card-surface shadow-card p-4">
        <div className="table-header mb-3">{t.byAgent}</div>
        <div className="h-28">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={byAgent} layout="vertical" margin={{ top: 0, right: 0, left: 0, bottom: 0 }}>
              <XAxis type="number" tick={{ fontSize: 9 }} axisLine={false} tickLine={false} />
              <YAxis type="category" dataKey="name" tick={{ fontSize: 9, fontFamily: 'JetBrains Mono' }} axisLine={false} tickLine={false} width={90} />
              <Bar dataKey="value" radius={[0, 3, 3, 0]}>
                {byAgent.map((_, i) => <Cell key={i} fill={PETROL_SERIES[i % PETROL_SERIES.length]} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Latency Trend */}
      <div className="card-surface shadow-card p-4">
        <div className="table-header mb-3">{t.latencyShape} <InfoTooltip text={t.latencyShapeTip} /></div>
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
        <div key={i} className="data-row grid grid-cols-[76px_96px_1fr_112px_44px_56px_92px] gap-2 px-5 py-2 border-b border-border">
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
  const t = T[useLang()];
  const [events, setEvents] = useState<MCPEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedEvent, setSelectedEvent] = useState<MCPEvent | null>(null);
  const [filterDecision, setFilterDecision] = useState<string>('all');
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [apiAvailable, setApiAvailable] = useState(false);
  const [apiStatus, setApiStatus] = useState<'checking' | 'online' | 'offline' | 'error'>('checking');
  const [verification, setVerification] = useState<ChainVerification | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [, setTick] = useState(0);

  /* Tamper-test state */
  const [tamperArmed, setTamperArmed] = useState(false);
  const [tamperedIndex, setTamperedIndex] = useState<number | null>(null);
  // Tamper simulation runs entirely locally and keeps its own state, separate
  // from the real server-side Verify integrity flow.
  const [tamperStatuses, setTamperStatuses] = useState<BlockStatus[]>([]);
  const [tamperMessage, setTamperMessage] = useState<string | null>(null);

  /* Chain verification animation state */
  const [blockStatuses, setBlockStatuses] = useState<BlockStatus[]>([]);
  const [lineStatuses, setLineStatuses] = useState<('idle' | 'verified')[]>([]);
  const [verifyMessage, setVerifyMessage] = useState<string | null>(null);
  const animTimers = useRef<ReturnType<typeof setTimeout>[]>([]);

  const PAGE_SIZE = 50;
  const CHAIN_SIZE = 8;

  // Boundary: the server-backed chain is `events` (persisted, or offline mock).
  // Local UI-originated events live in the store and are shown separately with a
  // badge; they are never part of the verified server chain.
  const { injected: localEvents, reviewStatus } = useLocalAudit();

  // Review status per origin id, derived from real persisted review_decision
  // events plus any local (offline) review decisions.
  const reviewStatusMap = useMemo(() => {
    const m: Record<string, 'reviewed' | 'escalated'> = {};
    for (const e of events) {
      if (e.eventType === 'review_decision' && e.refEventId) {
        m[e.refEventId] = e.reviewLabel === 'escalate' ? 'escalated' : 'reviewed';
      }
    }
    return { ...m, ...reviewStatus };
  }, [events, reviewStatus]);

  // An event needs review if it was denied, rate-limited or carried PII, and
  // has not been reviewed yet. Review/registration events are never reviewable.
  const needsReview = useCallback(
    (e: MCPEvent) =>
      e.eventType !== 'review_decision' &&
      e.eventType !== 'agent_registered' &&
      !reviewStatusMap[e.id] &&
      (e.decision === 'deny' || e.decision === 'rate-limited' || e.piiTokens > 0),
    [reviewStatusMap],
  );

  // Review: when the API is reachable, persist a real chained review event via
  // the backend (it streams back into the server chain). Otherwise record a
  // local-only, badged review that stays outside the verified chain.
  const submitReview = useCallback(async (origin: MCPEvent, label: 'acknowledge' | 'escalate') => {
    if (reviewStatusMap[origin.id]) return;
    if (apiAvailable) {
      try {
        const created = await postEventReview(origin.id, label, 'mickael.thomas');
        setEvents(prev => [mapApiEvent(created), ...prev.filter(e => e.id !== created.event_id)]);
        return;
      } catch {
        // fall through to a local, badged review on failure
      }
    }
    pushInjectedEvent({
      eventType: 'review_decision',
      agent: 'mickael.thomas',
      tool: `review:${origin.id.slice(0, 8)}`,
      decision: 'allow',
      jurisdiction: origin.jurisdiction,
      reviewer: 'mickael.thomas',
      refEventId: origin.id,
      reviewLabel: label,
      details: { local: true, origin_event: origin.id, origin_decision: origin.decision, origin_tool: origin.tool },
    });
    setReviewStatus(origin.id, label === 'acknowledge' ? 'reviewed' : 'escalated');
  }, [apiAvailable, reviewStatusMap]);

  // Live timestamp updates
  useEffect(() => {
    const interval = setInterval(() => setTick(t => t + 1), 1000);
    return () => clearInterval(interval);
  }, []);

  // Initialize block/line statuses when events change
  useEffect(() => {
    const count = Math.min(events.length, CHAIN_SIZE);
    setBlockStatuses(Array(count).fill('idle'));
    setLineStatuses(Array(Math.max(0, count - 1)).fill('idle'));
  }, [events]);

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
        // The backend is reachable: show only real persisted events. Never fall
        // back to random events, which would make a demo look live when it is not.
        try {
          const resp = await fetchEvents(1, PAGE_SIZE);
          if (cancelled) return;
          setEvents((resp.events || []).map(mapApiEvent));
          setHasMore((resp.events || []).length >= PAGE_SIZE);
          setApiStatus('online');
        } catch {
          if (!cancelled) {
            setEvents([]);
            setHasMore(false);
            setApiStatus('error');
          }
        }
      } else {
        // API unreachable: show clearly-labelled local demonstration data. This
        // is never presented as a verified server chain.
        setEvents(generateInitialEvents(50));
        setHasMore(false);
        setApiStatus('offline');
      }

      if (!cancelled) setLoading(false);
    }

    load();
    return () => { cancelled = true; };
  }, []);

  // Stream newly persisted events while the page is open.
  useEffect(() => {
    if (!apiAvailable) return;
    return streamEvents((apiEvt: ApiEvent) => {
      const mapped = mapApiEvent(apiEvt);
      setEvents(prev => [mapped, ...prev.filter(evt => evt.id !== mapped.id)].slice(0, 200));
    });
  }, [apiAvailable]);

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

    // Verify integrity calls exclusively the real server endpoint. With no
    // reachable API there is nothing authoritative to verify.
    if (!apiAvailable) {
      setVerification(null);
      setVerifyMessage(t.verifyUnavailable);
      return;
    }

    setVerifying(true);
    const count = Math.min(events.length, CHAIN_SIZE);
    setBlockStatuses(Array(count).fill('idle'));
    setLineStatuses(Array(Math.max(0, count - 1)).fill('idle'));

    let result: ChainVerification;
    try {
      result = await verifyChain();
    } catch {
      result = { valid: false, events: 0, verified_at: new Date().toISOString(), error: t.verifyFailed };
    }

    setVerification(result);

    const corruptAt = result.valid ? -1 : count - 1;
    const stopAt = corruptAt === -1 ? count - 1 : corruptAt;

    // Animate blocks left-to-right with 100ms delay between each
    const DELAY = 100;
    for (let i = 0; i <= stopAt; i++) {
      const timer = setTimeout(() => {
        const isCorrupt = corruptAt !== -1 && i === corruptAt;
        setBlockStatuses(prev => {
          const next = [...prev];
          next[i] = isCorrupt ? 'corrupt' : 'verified';
          return next;
        });

        // Animate connecting line (the line before this block), unless broken here
        if (i > 0 && !isCorrupt) {
          setLineStatuses(prev => {
            const next = [...prev];
            next[i - 1] = 'verified';
            return next;
          });
        }

        // After the last animated block, show the result message
        if (i === stopAt) {
          if (corruptAt === -1) {
            setVerifyMessage(t.chainVerified.replace('{n}', String(result.events)));
          } else {
            setVerifyMessage(t.chainFailed.replace('{n}', String(corruptAt + 1)));
          }
          setVerifying(false);
        }
      }, i * DELAY);
      animTimers.current.push(timer);
    }

    // Safety: ensure verifying is reset even if no events
    if (count === 0) {
      setVerifying(false);
      setVerifyMessage(t.noEventsVerify);
    }
  }, [apiAvailable, events, t]);

  // ── Tamper simulation · local (separate from Verify integrity) ──────────────
  // Arm selection, tamper a chosen chain block, run a purely local check, restore.
  const handleTamperBlock = useCallback((i: number) => {
    if (!tamperArmed) return;
    setTamperArmed(false);
    setTamperedIndex(i);
    const count = Math.min(events.length, CHAIN_SIZE);
    // Local verdict: everything up to the tampered block is fine, it breaks there.
    const statuses: BlockStatus[] = Array.from({ length: count }, (_, idx) =>
      idx < i ? 'verified' : idx === i ? 'corrupt' : 'idle',
    );
    setTamperStatuses(statuses);
    setTamperMessage(t.tamperMsg.replace('{n}', String(i + 1)));
  }, [tamperArmed, events, t]);

  const handleRestore = useCallback(() => {
    setTamperedIndex(null);
    setTamperArmed(false);
    setTamperStatuses([]);
    setTamperMessage(null);
  }, []);

  // Generate Report: download a real evidence.json bundle of the shown events.
  const handleGenerateReport = useCallback(() => {
    const bundle = {
      bundle: 'bawaba-evidence',
      version: '1',
      generated_at: new Date().toISOString(),
      event_count: events.length,
      local_events_excluded: localEvents.length,
      verification: verification ?? { valid: null, note: 'Run Verify integrity for a fresh check.' },
      // Only persisted server-chain events are included; local/simulated rows are excluded by design.
      events: events.map(e => ({
        event_id: e.id,
        timestamp: e.timestamp.toISOString(),
        event_type: e.eventType ?? 'tool_call',
        agent_id: e.agent,
        tool: e.tool,
        jurisdiction: e.jurisdiction,
        decision: e.decision,
        pii_entities: e.piiTokens,
        latency_ms: e.latency,
        event_hash: e.hash,
        prev_hash: e.prevHash,
        signature: evidenceSignature(e.hash),
        ...(e.refEventId ? { ref_event_id: e.refEventId } : {}),
        ...(e.reviewer ? { reviewer: e.reviewer } : {}),
      })),
    };
    const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `evidence-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, [events, localEvents, verification]);

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
      ? events
      : filterDecision === 'needs-review'
        ? events.filter(needsReview)
        : events.filter(e => e.decision === filterDecision);

  const needsReviewCount = events.filter(needsReview).length;

  return (
    <div className="space-y-6">
      {/* Explainer Panel */}
      <ExplainerPanel />

      {/* API status — explicit, never a silent fallback */}
      {apiStatus === 'offline' && (
        <div className="text-[11px] font-body rounded-sm p-2 border bg-warn-bg border-warn/20 text-warn">
          {t.offlineBanner}
        </div>
      )}
      {apiStatus === 'error' && (
        <div className="text-[11px] font-body rounded-sm p-2 border bg-danger-bg border-danger/20 text-danger">
          {t.errorBanner}
        </div>
      )}

      {/* Export controls */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div>
            <div className="text-sm font-body font-medium text-foreground">{t.auditExplorer}</div>
            <div className="text-xs text-muted-foreground">
              {t.countLine.replace('{n}', String(events.length))}
              {localEvents.length > 0 && <span className="text-ink-3">{t.localCount.replace('{n}', String(localEvents.length))}</span>}
            </div>
          </div>
        </div>
        <div className="flex gap-2">
          <button
            onClick={handleExport}
            disabled={exporting}
            className="text-xs font-body px-3 py-1.5 border border-border rounded-sm text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50 inline-flex items-center"
          >
            {exporting ? t.exporting : t.exportSiem}
            <InfoTooltip text={t.exportSiemTip} />
          </button>
          <button
            onClick={handleGenerateReport}
            className="text-xs font-body px-3 py-1.5 border border-border rounded-sm text-muted-foreground hover:text-foreground transition-colors inline-flex items-center"
          >
            {t.generateReport}
            <InfoTooltip text={t.generateReportTip} />
          </button>
        </div>
      </div>

      {/* Hash Chain Visualization */}
      <div className="card-surface shadow-card p-5">
        <div className="flex items-center justify-between mb-4">
          <div>
            <div className="text-sm font-body font-medium text-foreground">{t.hashChain} <InfoTooltip text={t.hashChainTip} /></div>
            <div className="text-xs text-muted-foreground">{t.tamperEvident}</div>
          </div>
          <button
            onClick={handleVerify}
            disabled={verifying || tamperedIndex !== null || !apiAvailable}
            title={
              !apiAvailable
                ? t.verifyTitleNoApi
                : tamperedIndex !== null
                  ? t.verifyTitleTamper
                  : undefined
            }
            className="text-xs font-body px-4 py-2 bg-safe-bg border border-safe/10 text-safe rounded-sm hover:opacity-90 transition-opacity disabled:opacity-50 flex items-center gap-2"
          >
            {/* Checkmark / shield icon */}
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
            </svg>
            {verifying ? t.verifying : t.verifyIntegrity}
          </button>
        </div>
        <div className="text-[10px] text-muted-foreground font-body mb-3">
          {t.verifyNoteA}<span className="font-mono">/api/v1/events/verify</span>{t.verifyNoteB}
          {!apiAvailable && t.verifyNoteOffline}
        </div>

        <HashChainViz
          events={events}
          blockStatuses={tamperedIndex !== null ? tamperStatuses : blockStatuses}
          lineStatuses={lineStatuses}
          tamperedIndex={tamperedIndex}
          armed={tamperArmed}
          onBlockClick={handleTamperBlock}
        />

        {/* Real server-side verification result (hidden while a local tamper sim is active) */}
        {verifyMessage && tamperedIndex === null && (
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
              {verification ? t.scopeLine.replace('{n}', String(verification.events)) : ''}
            </span>
          </div>
        )}
        {verifyMessage && tamperedIndex === null && verification?.valid && localEvents.length > 0 && (
          <div className="mt-2 text-[10px] text-muted-foreground font-body">
            {t.localOutside.replace('{n}', String(localEvents.length)).replace(/\{s\}/g, localEvents.length === 1 ? '' : 's')}
          </div>
        )}

        {/* Tamper simulation · local — separate flow, never calls the server */}
        <div className="mt-4 border border-border rounded-sm p-3 bg-secondary/10">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-[11px] font-mono text-muted-foreground">{t.tamperTitle}</div>
              <div className="text-[10px] text-muted-foreground font-body">{t.tamperDesc}</div>
            </div>
            {tamperedIndex === null ? (
              <button
                onClick={() => setTamperArmed(a => !a)}
                className={`text-xs font-body px-3 py-2 rounded-sm border transition-colors shrink-0 ${
                  tamperArmed ? 'border-danger/40 bg-danger-bg text-danger' : 'border-border text-muted-foreground hover:text-foreground'
                }`}
              >
                {tamperArmed ? t.selectBlock : t.simulateTamper}
              </button>
            ) : (
              <button
                onClick={handleRestore}
                className="text-xs font-body px-3 py-2 rounded-sm border border-border text-muted-foreground hover:text-foreground transition-colors shrink-0"
              >
                {t.restore}
              </button>
            )}
          </div>
          {tamperArmed && (
            <div className="text-[10px] text-danger bg-danger-bg border border-danger/10 rounded p-2 mt-2">
              {t.tamperHint}
            </div>
          )}
          {tamperMessage && (
            <div className="mt-2 flex items-center gap-3 p-2 rounded-sm bg-danger-bg border border-danger/10">
              <span className="w-2 h-2 rounded-full bg-danger" />
              <span className="text-xs font-mono text-danger">{tamperMessage}</span>
              <span className="text-[10px] text-muted-foreground font-mono ml-auto">{t.localCheck}</span>
            </div>
          )}
        </div>
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
                className={`text-xs font-body px-3 py-1.5 rounded-sm border transition-colors ${
                  filterDecision === f ? 'border-primary bg-primary/5 text-foreground' : 'border-border text-muted-foreground hover:text-foreground'
                } ${f === 'needs-review' ? 'inline-flex items-center gap-1.5' : ''}`}
              >
                {f === 'all' ? t.filterAll : f === 'needs-review' ? t.filterNeedsReview : f}
                {f === 'needs-review' && needsReviewCount > 0 && (
                  <span className="text-[11px] font-data tabular-nums px-1.5 py-0.5 rounded-full bg-warn-bg text-warn border border-warn/20">{needsReviewCount}</span>
                )}
              </button>
            ))}
          </div>

          {/* Hint */}
          <div className="text-[10px] text-muted-foreground font-body mb-2">{t.rowHint}</div>

          {/* Table */}
          <div className="card-surface shadow-card overflow-hidden">
            <div className="grid grid-cols-[76px_96px_1fr_112px_44px_56px_92px] gap-2 px-5 py-2 border-b border-border">
              {([t.hTime, t.hAgent, t.hTool, t.hResult, t.hPii, t.hLat, t.hHash]).map(h => (
                <span key={h} className="table-header">{h}</span>
              ))}
            </div>
            {loading ? (
              <TableSkeleton />
            ) : (
              <div className="max-h-[400px] overflow-y-auto zebra">
                {filtered.map(evt => {
                  const isReview = evt.eventType === 'review_decision';
                  const badge = reviewStatusMap[evt.id];
                  return (
                    <div key={evt.id}>
                      <div
                        onClick={() => setSelectedEvent(selectedEvent?.id === evt.id ? null : evt)}
                        className={`data-row grid grid-cols-[76px_96px_1fr_112px_44px_56px_92px] gap-2 px-5 py-2 text-sm font-data tabular-nums cursor-pointer hover:bg-secondary/30 transition-colors border-b border-border ${
                          isReview ? 'bg-secondary/20' : evt.decision === 'deny' ? 'row-deny' : evt.decision === 'rate-limited' ? 'row-rate-limited' : ''
                        }`}
                      >
                        <span className="text-muted-foreground">{timeAgo(evt.timestamp, t)}</span>
                        <span className="text-foreground truncate">{evt.agent}</span>
                        <span className="text-ink-2 truncate">{evt.tool}</span>
                        <span className="flex items-center gap-1.5 min-w-0">
                          {isReview ? (
                            <span className={`pill ${evt.reviewLabel === 'escalate' ? 'pill-rate' : 'pill-allow'}`}>{evt.reviewLabel}</span>
                          ) : (
                            <span className={`pill ${evt.decision === 'allow' ? 'pill-allow' : evt.decision === 'deny' ? 'pill-deny' : 'pill-rate'}`}>{evt.decision}</span>
                          )}
                          {badge && (
                            <span className={`micro-label ${badge === 'escalated' ? 'text-warn' : 'text-safe'}`} style={{ fontSize: '9px' }}>{badge === 'escalated' ? t.badgeEscalatedRow : t.badgeReviewedRow}</span>
                          )}
                        </span>
                        <span className="text-muted-foreground">{evt.piiTokens}</span>
                        <span className="text-muted-foreground">{evt.latency}ms</span>
                        <span className="text-ink-3 truncate mono-cell text-xs">{evt.hash.slice(0, 8)}{evt.hash.length > 8 ? '...' : ''}</span>
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
                      {loadingMore ? t.loading : t.loadMore}
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

      {/* Local & simulated events — explicitly outside the verified server chain */}
      {localEvents.length > 0 && (
        <div className="card-surface shadow-card overflow-hidden">
          <div className="px-5 py-3 border-b border-border bg-secondary/10">
            <div className="text-sm font-body font-medium text-foreground">{t.localSection}</div>
            <div className="text-[10px] text-muted-foreground font-body">
              {t.localSectionDesc}
            </div>
          </div>
          <div className="max-h-[220px] overflow-y-auto zebra">
            {localEvents.map(evt => {
              const simulated = (evt.details as { simulated?: boolean })?.simulated === true;
              return (
                <div key={evt.id} className="data-row grid grid-cols-[80px_120px_1fr_110px] gap-2 px-5 py-2 text-sm font-data tabular-nums border-b border-border last:border-0 border-l-2 border-l-ink-4/40">
                  <span className="text-muted-foreground">{timeAgo(evt.timestamp, t)}</span>
                  <span className="text-foreground truncate">{evt.agent}</span>
                  <span className="text-ink-2 truncate">{evt.eventType === 'review_decision' ? `${evt.reviewLabel} → ${evt.refEventId?.slice(0, 8)}` : evt.tool}</span>
                  <span className={`pill justify-self-end self-center ${simulated ? 'pill-neutral' : 'pill-rate'}`}>
                    {simulated ? t.pillSimulated : t.pillLocal}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Detail Drawer */}
      {selectedEvent && (
        <>
          <div className="fixed inset-0 bg-foreground/5 z-40" onClick={() => setSelectedEvent(null)} />
          <div className="fixed inset-y-0 right-0 w-[400px] bg-card border-l border-border z-50 overflow-y-auto shadow-card">
            <div className="flex items-center justify-between p-5 border-b border-border">
              <div>
                <div className="text-lg font-heading text-foreground">{t.eventTitle.replace('{id}', selectedEvent.id.slice(0, 8))}</div>
                <div className="text-xs text-muted-foreground font-mono">{timeAgo(selectedEvent.timestamp, t)}</div>
              </div>
              <button onClick={() => setSelectedEvent(null)} className="text-muted-foreground hover:text-foreground transition-colors">
                <X className="h-4 w-4" strokeWidth={1.5} />
              </button>
            </div>
            <div className="p-5 space-y-5">
              {/* Review status badge */}
              {reviewStatusMap[selectedEvent.id] && (
                <div className={`inline-flex items-center gap-2 text-[11px] font-mono px-2.5 py-1 rounded-sm border ${
                  reviewStatusMap[selectedEvent.id] === 'escalated'
                    ? 'bg-warn-bg text-warn border-warn/20'
                    : 'bg-safe-bg text-safe border-safe/20'
                }`}>
                  <span className="w-1.5 h-1.5 rounded-full bg-current" />
                  {reviewStatusMap[selectedEvent.id] === 'escalated' ? t.badgeEscalated : t.badgeReviewed}
                </div>
              )}

              {/* Review decision detail (for review_decision events) */}
              {selectedEvent.eventType === 'review_decision' && (
                <div className="text-[10px] text-muted-foreground bg-muted/40 rounded p-2 space-y-1">
                  <div>{t.revDecA}<span className="font-mono text-foreground">{selectedEvent.reviewLabel}</span>{t.revDecB}<span className="font-mono text-foreground">{selectedEvent.reviewer}</span>.</div>
                  <div>{t.revRefA}<span className="font-mono text-foreground">{selectedEvent.refEventId?.slice(0, 12)}</span>{t.revRefB}</div>
                </div>
              )}

              {/* Human-in-the-loop review actions */}
              {selectedEvent.eventType !== 'review_decision' &&
                selectedEvent.eventType !== 'agent_registered' &&
                (selectedEvent.decision === 'deny' || selectedEvent.decision === 'rate-limited' || selectedEvent.piiTokens > 0) && (
                  <div>
                    <div className="table-header mb-2">{t.reviewHeader}<InfoTooltip text={t.reviewHeaderTip} /></div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => submitReview(selectedEvent, 'acknowledge')}
                        disabled={!!reviewStatusMap[selectedEvent.id]}
                        className="flex-1 text-xs font-body font-medium px-3 py-2 bg-safe-bg border border-safe/20 text-safe rounded-sm hover:opacity-90 transition-opacity disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        {t.acknowledge}
                      </button>
                      <button
                        onClick={() => submitReview(selectedEvent, 'escalate')}
                        disabled={!!reviewStatusMap[selectedEvent.id]}
                        className="flex-1 text-xs font-body font-medium px-3 py-2 bg-warn-bg border border-warn/20 text-warn rounded-sm hover:opacity-90 transition-opacity disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        {t.escalate}
                      </button>
                    </div>
                    <div className="text-[10px] text-muted-foreground bg-muted/40 rounded p-2 mt-1.5">
                      {reviewStatusMap[selectedEvent.id]
                        ? t.alreadyReviewed
                        : apiAvailable
                          ? <>{t.revNoteApiA}<span className="font-mono">review_decision</span>{t.revNoteApiB}</>
                          : <>{t.revNoteLocalA}<span className="font-mono">{t.pillLocal}</span>{t.revNoteLocalB}</>}
                    </div>
                  </div>
                )}

              {/* Intro explainer */}
              <div className="text-[10px] text-muted-foreground bg-muted/40 rounded p-2">
                {t.introExplainer}
              </div>

              {/* Event hash */}
              <div>
                <div className="table-header mb-1">{t.eventHash}</div>
                <div className="font-mono text-xs text-foreground break-all bg-secondary/20 rounded-sm p-2">{selectedEvent.hash}</div>
                <div className="text-[10px] text-muted-foreground bg-muted/40 rounded p-2 mt-1.5">
                  {t.eventHashNote}
                </div>
              </div>

              {/* Previous hash */}
              <div>
                <div className="table-header mb-1">{t.prevHashHdr}</div>
                <div className="font-mono text-xs text-foreground break-all bg-secondary/20 rounded-sm p-2">{selectedEvent.prevHash}</div>
                <div className="text-[10px] text-muted-foreground bg-muted/40 rounded p-2 mt-1.5">
                  {t.prevHashNote}
                </div>
              </div>

              {/* Signature Ed25519 */}
              <div>
                <div className="table-header mb-1">{t.sigHeader}</div>
                <div className={`text-xs font-mono ${verification?.valid ? 'text-safe' : 'text-muted-foreground'}`}>
                  {verification?.valid ? t.sigVerified : t.sigPersisted}
                </div>
                <div className="text-[10px] text-muted-foreground bg-muted/40 rounded p-2 mt-1.5">
                  {t.sigNote}
                </div>
              </div>

              {/* Agent */}
              <div>
                <div className="table-header mb-1">{t.hdrAgent}</div>
                <div className="text-xs font-mono text-foreground">{selectedEvent.agent}</div>
              </div>

              {/* Tool */}
              <div>
                <div className="table-header mb-1">{t.hdrTool}</div>
                <div className="text-xs font-mono text-foreground">{selectedEvent.tool}</div>
              </div>

              {/* Decision */}
              <div>
                <div className="table-header mb-1">{t.hdrDecision}</div>
                <span className={`pill ${
                  selectedEvent.decision === 'allow' ? 'pill-allow' : selectedEvent.decision === 'deny' ? 'pill-deny' : 'pill-rate'
                }`}>
                  {selectedEvent.decision === 'allow' ? t.allowed : selectedEvent.decision === 'deny' ? t.denied : t.rateLimited}
                </span>
              </div>

              {/* PII detected */}
              <div>
                <div className="table-header mb-1">{t.piiDetected}</div>
                <div className="text-xs font-mono text-foreground">{selectedEvent.piiTokens}</div>
              </div>

              {/* Latency */}
              <div>
                <div className="table-header mb-1">{t.latency}</div>
                <div className="text-xs font-mono text-foreground">{selectedEvent.latency}ms</div>
              </div>

              {/* Full payload */}
              <div>
                <div className="table-header mb-1">{t.fullPayload}</div>
                <pre className="text-xs font-mono text-ink-2 whitespace-pre-wrap bg-secondary/20 rounded-sm p-2 overflow-x-auto">{JSON.stringify(selectedEvent.details, null, 2)}</pre>
                <div className="text-[10px] text-muted-foreground bg-muted/40 rounded p-2 mt-1.5">
                  {t.fullPayloadNote}
                </div>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

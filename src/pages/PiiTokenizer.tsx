import { useState, useEffect, useMemo } from 'react';
import { PII_TYPES as MOCK_PII_TYPES } from '@/lib/mock-data';
import { useLiveFeed } from '@/hooks/use-live-feed';
import { BarChart, Bar, ResponsiveContainer, XAxis, YAxis } from 'recharts';
import { isApiAvailable, fetchPiiStats } from '@/services/api';
import { PETROL } from '@/lib/chart-colors';
import { tokenizePii, PII_LABELS, type PiiMatch } from '@/lib/pii-detect';
import InfoTooltip from '@/components/InfoTooltip';
import { useLang, type Lang } from '@/lib/i18n';
import { X } from 'lucide-react';

const T: Record<Lang, Record<string, string>> = {
  en: {
    agoS: '{n}s ago',
    agoM: '{n}m ago',
    agoH: '{n}h ago',
    agoD: '{n}d ago',
    trySample: 'Wire settlement to IBAN MA64011519000001205000534921 for Ahmed, reachable at ahmed.benali@example.ma or +212 661 234 567. Card on file 4111 1111 1111 1111, Emirates ID 784-1985-1234567-8, KSA ID 1023456789.',
    tryPlaceholder: 'Paste text containing an IBAN, email, phone, card, Emirates ID, KSA ID or Morocco CIN…',
    tryTitle: 'Try it — live detection',
    tryTip: 'Runs the same 7 MENA patterns as the Rust tokenizer in your browser. Nothing leaves the page.',
    trySub: 'Client-side preview · mirrors rust/tokenizer patterns',
    tryEntities: '{n} entities',
    tryReset: 'Reset sample',
    tryInputPlaceholder: 'Type or paste free text…',
    tryDetected: 'Detected',
    tryTokenized: 'Tokenized',
    statsTitle: 'Tokenization Statistics',
    statsTip: 'Overview of PII detection and tokenization activity by the Rust library.',
    statsSub: 'Simulated aggregate volumes · live persisted events below',
    allTime: 'All time',
    allTimeTip: 'Total PII entities detected since system start.',
    today: 'Today',
    thisHour: 'This hour',
    activeTokens: 'Active tokens',
    activeTokensTip: 'Number of PII tokens currently in the vault. Expires after TTL.',
    byMode: 'By processing mode',
    byModeTip: 'Distribution of persisted PII entities by configured processing mode.',
    procDist: 'Processing time distribution',
    procDistTip: 'Detection and tokenization time by the Rust library. <1ms = nominal. >5ms = high load.',
    liveTitle: 'Live persisted tokenization events',
    liveTip: 'Each row is a real audit event returned by the running backend. Sensitive values are not written to the audit log.',
    liveHint: 'Click a row to see the persisted tokenization event',
    hTime: 'Time',
    hAgent: 'Agent',
    hRedacted: 'Redacted',
    hRedactedTip: 'Sensitive values are never written to the audit log; only the entity count is persisted.',
    hMode: 'Mode',
    hModeTip: 'Configured PII action persisted with the audit event.',
    hEventId: 'Event ID',
    hEventIdTip: 'Persisted audit event identifier. Individual vault token UUIDs are not exposed by this API.',
    hDuration: 'Duration',
    hDurationTip: 'Detection + replacement time by the Rust lib.',
    fields: '{n} field{s}',
    vaultTitle: 'Simulated vault status',
    vaultTip: 'Illustrative vault volumes for the demonstration environment. The live audit feed is shown separately.',
    vSessions: 'Active sessions',
    vSessionsTip: 'Number of active tokenization sessions currently open.',
    vTokens: 'Tokens in memory',
    vTtl: 'Avg TTL remaining',
    vTtlTip: 'Average token time-to-live remaining in memory. After expiration, detokenization becomes impossible.',
    vMemory: 'Memory usage',
    vMemoryTip: 'RAM usage by the token vault.',
    byTenant: 'Tokens by tenant',
    byTenantTip: 'Distribution of active tokens by tenant organization.',
    drawerTitle: 'Tokenization Event',
    persistedResult: 'Persisted result',
    persistedLine: '{n} entities · {mode}',
    persistedNote: 'The audit API persists the number of detected entities and the configured processing mode. Sensitive values and vault token UUIDs are not exposed here.',
    sourceAgent: 'Source agent',
    sourceAgentNote: 'The AI agent that sent the request containing this sensitive data.',
    configuredTtl: 'Configured TTL',
    ttlValue: '60 minutes',
    ttlNote: 'The running gateway initializes the in-memory vault with a 60-minute TTL. After expiration, the mapping is purged from memory.',
    processingTime: 'Processing time',
    status: 'Status',
    eventRecorded: 'Event recorded',
  },
  fr: {
    agoS: 'il y a {n} s',
    agoM: 'il y a {n} min',
    agoH: 'il y a {n} h',
    agoD: 'il y a {n} j',
    trySample: 'Virement de règlement vers l’IBAN MA64011519000001205000534921 pour Ahmed, joignable à ahmed.benali@example.ma ou au +212 661 234 567. Carte enregistrée 4111 1111 1111 1111, Emirates ID 784-1985-1234567-8, identifiant KSA 1023456789.',
    tryPlaceholder: 'Collez un texte contenant un IBAN, un e-mail, un téléphone, une carte, un Emirates ID, un identifiant KSA ou une CIN marocaine…',
    tryTitle: 'Essayez — détection en direct',
    tryTip: 'Exécute dans votre navigateur les 7 mêmes motifs MENA que le tokeniseur Rust. Rien ne quitte la page.',
    trySub: 'Aperçu côté client · reflète les motifs de rust/tokenizer',
    tryEntities: '{n} entités',
    tryReset: 'Réinitialiser l’exemple',
    tryInputPlaceholder: 'Saisissez ou collez un texte libre…',
    tryDetected: 'Détecté',
    tryTokenized: 'Tokenisé',
    statsTitle: 'Statistiques de tokenisation',
    statsTip: 'Vue d’ensemble de l’activité de détection et de tokenisation PII par la bibliothèque Rust.',
    statsSub: 'Volumes agrégés simulés · événements persistés en direct ci-dessous',
    allTime: 'Depuis le début',
    allTimeTip: 'Total des entités PII détectées depuis le démarrage du système.',
    today: 'Aujourd’hui',
    thisHour: 'Cette heure',
    activeTokens: 'Jetons actifs',
    activeTokensTip: 'Nombre de jetons PII actuellement dans le coffre. Expirent après le TTL.',
    byMode: 'Par mode de traitement',
    byModeTip: 'Répartition des entités PII persistées par mode de traitement configuré.',
    procDist: 'Distribution du temps de traitement',
    procDistTip: 'Temps de détection et de tokenisation par la bibliothèque Rust. <1 ms = nominal. >5 ms = forte charge.',
    liveTitle: 'Événements de tokenisation persistés en direct',
    liveTip: 'Chaque ligne est un événement d’audit réel renvoyé par le backend en cours d’exécution. Les valeurs sensibles ne sont pas écrites dans le journal d’audit.',
    liveHint: 'Cliquez sur une ligne pour voir l’événement de tokenisation persisté',
    hTime: 'Heure',
    hAgent: 'Agent',
    hRedacted: 'Caviardé',
    hRedactedTip: 'Les valeurs sensibles ne sont jamais écrites dans le journal d’audit ; seul le nombre d’entités est persisté.',
    hMode: 'Mode',
    hModeTip: 'Action PII configurée, persistée avec l’événement d’audit.',
    hEventId: 'ID d’événement',
    hEventIdTip: 'Identifiant de l’événement d’audit persisté. Les UUID individuels des jetons du coffre ne sont pas exposés par cette API.',
    hDuration: 'Durée',
    hDurationTip: 'Temps de détection + remplacement par la bibliothèque Rust.',
    fields: '{n} champ{s}',
    vaultTitle: 'État simulé du coffre',
    vaultTip: 'Volumes de coffre illustratifs pour l’environnement de démonstration. Le flux d’audit en direct est affiché séparément.',
    vSessions: 'Sessions actives',
    vSessionsTip: 'Nombre de sessions de tokenisation actives actuellement ouvertes.',
    vTokens: 'Jetons en mémoire',
    vTtl: 'TTL moyen restant',
    vTtlTip: 'Durée de vie moyenne restante des jetons en mémoire. Après expiration, la détokenisation devient impossible.',
    vMemory: 'Utilisation mémoire',
    vMemoryTip: 'Utilisation de la RAM par le coffre à jetons.',
    byTenant: 'Jetons par tenant',
    byTenantTip: 'Répartition des jetons actifs par organisation cliente.',
    drawerTitle: 'Événement de tokenisation',
    persistedResult: 'Résultat persisté',
    persistedLine: '{n} entités · {mode}',
    persistedNote: 'L’API d’audit persiste le nombre d’entités détectées et le mode de traitement configuré. Les valeurs sensibles et les UUID des jetons du coffre ne sont pas exposés ici.',
    sourceAgent: 'Agent source',
    sourceAgentNote: 'L’agent IA qui a envoyé la requête contenant ces données sensibles.',
    configuredTtl: 'TTL configuré',
    ttlValue: '60 minutes',
    ttlNote: 'La passerelle en cours d’exécution initialise le coffre en mémoire avec un TTL de 60 minutes. Après expiration, la correspondance est purgée de la mémoire.',
    processingTime: 'Temps de traitement',
    status: 'Statut',
    eventRecorded: 'Événement enregistré',
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

/* ── "Try it" live PII detection ─────────────────── */
function Highlighted({ text, matches }: { text: string; matches: PiiMatch[] }) {
  const t = T[useLang()];
  if (!text) {
    return <span className="text-muted-foreground">{t.tryPlaceholder}</span>;
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
  const t = T[useLang()];
  const [input, setInput] = useState(t.trySample);
  const result = useMemo(() => tokenizePii(input), [input]);

  return (
    <div className="card-surface shadow-card p-4">
      <div className="flex items-center justify-between mb-3">
        <div>
          <div className="table-header">
            {t.tryTitle}
            <InfoTooltip text={t.tryTip} />
          </div>
          <div className="text-[10px] text-muted-foreground font-body mt-0.5">{t.trySub}</div>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-mono text-muted-foreground">{t.tryEntities.replace('{n}', String(result.matches.length))}</span>
          <button
            onClick={() => setInput(t.trySample)}
            className="text-[10px] font-body px-2 py-1 border border-border rounded-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            {t.tryReset}
          </button>
        </div>
      </div>

      <textarea
        value={input}
        onChange={e => setInput(e.target.value)}
        rows={3}
        placeholder={t.tryInputPlaceholder}
        className="w-full text-xs font-mono px-3 py-2 border border-border rounded-sm bg-background text-foreground placeholder:text-ink-4 focus:outline-none focus:border-primary resize-y"
      />

      <div className="grid grid-cols-2 gap-3 mt-3">
        <div>
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">{t.tryDetected}</div>
          <div className="text-xs font-mono leading-relaxed bg-background border border-border rounded-sm p-2 min-h-[64px] whitespace-pre-wrap break-words">
            <Highlighted text={input} matches={result.matches} />
          </div>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">{t.tryTokenized}</div>
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
  const t = T[useLang()];
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
              {t.statsTitle}
              <InfoTooltip text={t.statsTip} />
            </div>
            <div className="text-xs text-muted-foreground">{t.statsSub}</div>
          </div>
        </div>

        {loading ? (
          <StatsSkeleton />
        ) : (
          <div className="grid grid-cols-4 gap-4 mb-6">
            <div className="card-surface shadow-card p-4">
              <div className="table-header mb-2">
                {t.allTime}
                <InfoTooltip text={t.allTimeTip} />
              </div>
              <div className="text-3xl font-data tabular-nums font-normal text-foreground">{totalAll.toLocaleString()}</div>
            </div>
            <div className="card-surface shadow-card p-4">
              <div className="table-header mb-2">{t.today}</div>
              <div className="text-3xl font-data tabular-nums font-normal text-foreground">{totalToday.toLocaleString()}</div>
            </div>
            <div className="card-surface shadow-card p-4">
              <div className="table-header mb-2">{t.thisHour}</div>
              <div className="text-3xl font-data tabular-nums font-normal text-foreground">{Math.floor(totalToday / 8)}</div>
            </div>
            <div className="card-surface shadow-card p-4">
              <div className="table-header mb-2">
                {t.activeTokens}
                <InfoTooltip text={t.activeTokensTip} />
              </div>
              <div className="text-3xl font-data tabular-nums font-normal text-foreground">8,421</div>
            </div>
          </div>
        )}

        {/* By entity type + processing dist */}
        <div className="grid grid-cols-2 gap-4">
          <div className="card-surface shadow-card p-4">
            <div className="table-header mb-3">
              {t.byMode}
              <InfoTooltip text={t.byModeTip} />
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
              {t.procDist}
              <InfoTooltip text={t.procDistTip} />
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
              {t.liveTitle}
              <InfoTooltip text={t.liveTip} />
            </div>
            <div className="text-[10px] text-muted-foreground font-body">{t.liveHint}</div>
          </div>
          <div className="card-surface shadow-card overflow-hidden">
            <div className="grid grid-cols-[80px_100px_100px_72px_1fr_64px] gap-2 px-5 py-2 border-b border-border">
              {(['hTime', 'hAgent', 'hRedacted', 'hMode', 'hEventId', 'hDuration'] as const).map((h, idx) => (
                <span key={h + idx} className="table-header">
                  {t[h]}
                  {t[h + 'Tip'] && <InfoTooltip text={t[h + 'Tip']} />}
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
                  <span className="text-muted-foreground">{timeAgo(evt.timestamp, t)}</span>
                  <span className="text-foreground truncate">{evt.agent}</span>
                  <span className="text-ink-3">{t.fields.replace('{n}', String(evt.piiTokens)).replace(/\{s\}/g, evt.piiTokens === 1 ? '' : 's')}</span>
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
              {t.vaultTitle}
              <InfoTooltip text={t.vaultTip} />
            </div>
          </div>
          <div className="card-surface shadow-card p-4 space-y-4">
            {([
              ['vSessions', '24'],
              ['vTokens', '8,421'],
              ['vTtl', '23m 14s'],
              ['vMemory', '142 MB'],
            ] as const).map(([label, val]) => (
              <div key={label} className="flex justify-between py-2 border-b border-border last:border-0">
                <span className="text-sm text-muted-foreground">
                  {t[label]}
                  {t[label + 'Tip'] && <InfoTooltip text={t[label + 'Tip']} />}
                </span>
                <span className="text-sm font-data tabular-nums text-foreground">{val}</span>
              </div>
            ))}

            <div className="pt-2">
              <div className="table-header mb-2">
                {t.byTenant}
                <InfoTooltip text={t.byTenantTip} />
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
                <div className="text-lg font-heading text-foreground">{t.drawerTitle}</div>
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
                <div className="table-header mb-1">{t.persistedResult}</div>
                <div className="text-sm font-mono text-foreground">{t.persistedLine.replace('{n}', String(selectedToken.entities)).replace('{mode}', selectedToken.mode)}</div>
                <div className="text-[10px] text-muted-foreground bg-muted/40 rounded p-2 mt-1.5">
                  {t.persistedNote}
                </div>
              </div>

              {/* Source agent */}
              <div>
                <div className="table-header mb-1">{t.sourceAgent}</div>
                <div className="text-sm font-mono text-foreground">{selectedToken.agent}</div>
                <div className="text-[10px] text-muted-foreground bg-muted/40 rounded p-2 mt-1.5">
                  {t.sourceAgentNote}
                </div>
              </div>

              {/* Configured TTL */}
              <div>
                <div className="table-header mb-1">{t.configuredTtl}</div>
                <div className="text-sm font-mono text-foreground">{t.ttlValue}</div>
                <div className="text-[10px] text-muted-foreground bg-muted/40 rounded p-2 mt-1.5">
                  {t.ttlNote}
                </div>
              </div>

              {/* Processing time */}
              <div>
                <div className="table-header mb-1">{t.processingTime}</div>
                <div className="text-sm font-mono text-foreground">{selectedToken.time}</div>
              </div>

              {/* Status */}
              <div>
                <div className="table-header mb-1">{t.status}</div>
                <span className="pill pill-allow">
                  <span className="w-1.5 h-1.5 rounded-full bg-safe" />
                  {t.eventRecorded}
                </span>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

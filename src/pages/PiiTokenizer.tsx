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
  if (seconds < 60) return `il y a ${seconds}s`;
  if (seconds < 3600) return `il y a ${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `il y a ${Math.floor(seconds / 3600)}h`;
  return `il y a ${Math.floor(seconds / 86400)}j`;
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
  'Sessions actives': 'Nombre de sessions de tokenisation actuellement ouvertes.',
  'Tokens en mémoire': '',
  'TTL moyen restant': 'Durée de vie moyenne des tokens en mémoire. À l\u2019expiration, la détokenisation devient impossible.',
  'Utilisation mémoire': 'Mémoire RAM utilisée par le coffre-fort de tokens.',
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
      {/* Explainer banner */}
      <div className="card-surface shadow-card px-5 py-3">
        <p className="text-xs font-body text-muted-foreground leading-relaxed">
          Chaque donnée personnelle (email, IBAN, CIN...) est détectée par la bibliothèque Rust
          et remplacée par un UUID v4 <em>avant</em> d'atteindre le LLM. Le coffre-fort en mémoire
          conserve la correspondance token ↔ valeur réelle pendant le TTL configuré.
        </p>
      </div>

      {/* Stats */}
      <div>
        <div className="flex items-center gap-3 mb-4">
          <div>
            <div className="text-sm font-body font-medium text-foreground">
              Statistiques de tokenisation
              <InfoTooltip text="Vue d'ensemble de l'activité de détection et tokenisation PII par la bibliothèque Rust." />
            </div>
            <div className="text-xs text-muted-foreground">Détection PII et coffre-fort de tokens</div>
          </div>
        </div>

        {loading ? (
          <StatsSkeleton />
        ) : (
          <div className="grid grid-cols-4 gap-4 mb-6">
            <div className="card-surface shadow-card p-4">
              <div className="table-header mb-2">
                Depuis le début
                <InfoTooltip text="Nombre total d'entités PII détectées depuis le démarrage du système." />
              </div>
              <div className="text-2xl font-mono font-light text-foreground">{totalAll.toLocaleString()}</div>
            </div>
            <div className="card-surface shadow-card p-4">
              <div className="table-header mb-2">Aujourd&apos;hui</div>
              <div className="text-2xl font-mono font-light text-foreground">{totalToday.toLocaleString()}</div>
            </div>
            <div className="card-surface shadow-card p-4">
              <div className="table-header mb-2">Cette heure</div>
              <div className="text-2xl font-mono font-light text-foreground">{Math.floor(totalToday / 8)}</div>
            </div>
            <div className="card-surface shadow-card p-4">
              <div className="table-header mb-2">
                Tokens actifs
                <InfoTooltip text="Nombre de tokens PII actuellement en mémoire dans le coffre-fort. Expire après TTL." />
              </div>
              <div className="text-2xl font-mono font-light text-foreground">8,421</div>
            </div>
          </div>
        )}

        {/* By entity type + processing dist */}
        <div className="grid grid-cols-2 gap-4">
          <div className="card-surface shadow-card p-4">
            <div className="table-header mb-3">
              Par type d&apos;entité
              <InfoTooltip text="Répartition des entités PII détectées par catégorie (IBAN, Email, Téléphone, etc.)." />
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
              Distribution des temps de traitement
              <InfoTooltip text="Temps de détection et tokenisation par la bibliothèque Rust. <1ms = nominal. >5ms = charge élevée." />
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
              Flux de tokenisation en direct
              <InfoTooltip text="Chaque ligne représente une donnée sensible détectée et remplacée par un token UUID. La donnée réelle n'est jamais transmise au LLM." />
            </div>
            <div className="text-[10px] text-muted-foreground font-body">👆 Cliquez une ligne pour voir le détail du token et le pattern de détection</div>
          </div>
          <div className="card-surface shadow-card overflow-hidden">
            <div className="grid grid-cols-[80px_100px_100px_70px_120px_60px] gap-2 px-5 py-2 border-b border-border">
              {['Heure', 'Agent', 'Masqué', 'Type', 'UUID', 'Durée'].map((h, idx) => (
                <span key={h + idx} className="table-header">
                  {h}
                  {h === 'Masqué' && <InfoTooltip text="La valeur réelle est masquée. Seul le type (IBAN, Email…) et l'UUID sont conservés dans les logs." />}
                  {h === 'Type' && <InfoTooltip text="Catégorie PII détectée (IBAN, Phone, Email, NID, Card)." />}
                  {h === 'UUID' && <InfoTooltip text="Identifiant unique v4 remplaçant la donnée sensible dans le flux LLM." />}
                  {h === 'Durée' && <InfoTooltip text="Temps de détection + remplacement par la lib Rust." />}
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
              État du coffre-fort
              <InfoTooltip text="État du coffre-fort en mémoire qui stocke les associations token ↔ donnée réelle." />
            </div>
          </div>
          <div className="card-surface shadow-card p-4 space-y-4">
            {([
              ['Sessions actives', '24'],
              ['Tokens en mémoire', '8,421'],
              ['TTL moyen restant', '23m 14s'],
              ['Utilisation mémoire', '142 MB'],
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
                Tokens par client
                <InfoTooltip text="Répartition des tokens actifs par organisation cliente." />
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
                <div className="text-lg font-heading text-foreground">Détail du token</div>
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
              {/* Type détecté */}
              <div>
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Type détecté</div>
                <div className="text-sm font-mono text-foreground">{selectedToken.type}</div>
                <div className="text-[10px] text-muted-foreground bg-muted/40 rounded p-2 mt-1.5">
                  Catégorie PII identifiée par le moteur de détection Rust. Le pattern regex correspondant est affiché ci-dessous.
                </div>
              </div>

              {/* Agent source */}
              <div>
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Agent source</div>
                <div className="text-sm font-mono text-foreground">{selectedToken.agent}</div>
                <div className="text-[10px] text-muted-foreground bg-muted/40 rounded p-2 mt-1.5">
                  L'agent IA qui a envoyé la requête contenant cette donnée sensible.
                </div>
              </div>

              {/* Pattern de détection */}
              <div>
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Pattern de détection</div>
                <div className="text-sm font-mono text-foreground bg-muted/50 rounded px-2 py-1.5 break-all">
                  {PII_PATTERNS[selectedToken.type] || '.*'}
                </div>
                <div className="text-[10px] text-muted-foreground bg-muted/40 rounded p-2 mt-1.5">
                  Expression régulière utilisée pour détecter ce type de PII dans le flux de données.
                </div>
              </div>

              {/* UUID du token */}
              <div>
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">UUID du token</div>
                <div className="text-sm font-mono text-foreground break-all">{selectedToken.uuid}</div>
                <div className="text-[10px] text-muted-foreground bg-muted/40 rounded p-2 mt-1.5">
                  Cet UUID v4 remplace la donnée réelle dans le flux transmis au LLM. La correspondance inverse est conservée dans le coffre-fort en mémoire.
                </div>
              </div>

              {/* TTL configuré */}
              <div>
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">TTL configuré</div>
                <div className="text-sm font-mono text-foreground">30 minutes</div>
                <div className="text-[10px] text-muted-foreground bg-muted/40 rounded p-2 mt-1.5">
                  Après expiration du TTL, la détokenisation devient impossible — la donnée réelle est définitivement purgée de la mémoire.
                </div>
              </div>

              {/* Temps de traitement */}
              <div>
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Temps de traitement</div>
                <div className="text-sm font-mono text-foreground">{selectedToken.time}</div>
              </div>

              {/* Statut */}
              <div>
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Statut</div>
                <span className="inline-flex items-center gap-1.5 text-xs font-mono px-2 py-1 rounded-full bg-emerald-500/10 text-emerald-600">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                  Actif en mémoire
                </span>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

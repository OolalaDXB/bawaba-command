import { useState, useEffect, useCallback, useRef } from 'react';
import { Shield, Server, Users, Scale, Globe, ChevronDown, Download, Lock } from 'lucide-react';
import {
  isApiAvailable, fetchHealth, fetchAgents, fetchPolicies, fetchJurisdictions,
  type HealthResponse, type AgentInfo, type PolicyEntry, type JurisdictionEntry,
} from '@/services/api';
import InfoTooltip from '@/components/InfoTooltip';
import { useLang, type Lang } from '@/lib/i18n';

const T: Record<Lang, Record<string, string>> = {
  en: {
    gateway: 'Gateway',
    gatewaySub: 'Main gateway configuration',
    gatewayTip: 'Core Bawaba gateway component. Manages the proxy, control API, and security modules.',
    rowStatus: 'Status',
    statusTip: 'Gateway connection state. Connected = operational. Offline = unavailable.',
    connected: 'Connected',
    offline: 'Offline',
    rowVersion: 'Version',
    rowUptime: 'Uptime',
    uptimeTip: 'Time elapsed since the last gateway restart.',
    rowPortProxy: 'Port proxy',
    rowPortApi: 'Port API',
    rowLogLevel: 'Log level',
    regAgents: 'Registered agents',
    regAgentsSub: '{n} agents configured',
    regAgentsTip: 'List of configured AI agents with their API keys and permissions.',
    hAgent: 'Agent',
    hKey: 'Key',
    keyTip: 'Masked API key for the agent. Only the last 4 characters are visible.',
    hPermissions: 'Permissions',
    permTip: 'Allowed (green) and denied (red strikethrough) MCP tools for this agent.',
    hStatus: 'Status',
    agentStatusTip: 'Active = recently issued requests. Inactive = no activity detected.',
    active: 'Active',
    inactive: 'Inactive',
    activePolicies: 'Active policies',
    policiesSub: '{n} policy rules',
    policiesTip: 'Policy rules configured for each agent. Define permissions and restrictions.',
    noPolicies: 'No policies configured',
    allowed: 'Allowed',
    denied: 'Denied',
    none: 'None',
    jurisdictions: 'Jurisdictions',
    jurSub: '{n} active zones',
    jurTip: 'Active sovereign data zones with their associated data planes.',
    hCode: 'Code',
    hName: 'Name',
    hPlane: 'Data plane',
    planeTip: 'Physical processing infrastructure in each jurisdiction.',
    hEvents: 'Events',
    eventsTip: 'Number of events processed in this jurisdiction.',
    jur_ma: 'Morocco',
    jur_sa: 'KSA',
    jur_ae: 'UAE',
    jur_fr: 'France',
    jur_eu: 'EU',
    pageTitle: 'Configuration',
    pageSub: 'Gateway settings and registered resources (read-only)',
    editConfig: 'Edit configuration',
    exportConfig: 'Export config',
    exportAlert: 'P2 feature — YAML export coming soon.',
  },
  fr: {
    gateway: 'Passerelle',
    gatewaySub: 'Configuration principale de la passerelle',
    gatewayTip: 'Composant central de la passerelle Bawaba. Gère le proxy, l’API de contrôle et les modules de sécurité.',
    rowStatus: 'Statut',
    statusTip: 'État de connexion de la passerelle. Connecté = opérationnel. Hors ligne = indisponible.',
    connected: 'Connecté',
    offline: 'Hors ligne',
    rowVersion: 'Version',
    rowUptime: 'Temps de fonctionnement',
    uptimeTip: 'Temps écoulé depuis le dernier redémarrage de la passerelle.',
    rowPortProxy: 'Port proxy',
    rowPortApi: 'Port API',
    rowLogLevel: 'Niveau de log',
    regAgents: 'Agents enregistrés',
    regAgentsSub: '{n} agents configurés',
    regAgentsTip: 'Liste des agents IA configurés avec leurs clés API et leurs permissions.',
    hAgent: 'Agent',
    hKey: 'Clé',
    keyTip: 'Clé API masquée de l’agent. Seuls les 4 derniers caractères sont visibles.',
    hPermissions: 'Permissions',
    permTip: 'Outils MCP autorisés (vert) et refusés (rouge barré) pour cet agent.',
    hStatus: 'Statut',
    agentStatusTip: 'Actif = requêtes émises récemment. Inactif = aucune activité détectée.',
    active: 'Actif',
    inactive: 'Inactif',
    activePolicies: 'Politiques actives',
    policiesSub: '{n} règles de politique',
    policiesTip: 'Règles de politique configurées pour chaque agent. Définissent les permissions et les restrictions.',
    noPolicies: 'Aucune politique configurée',
    allowed: 'Autorisés',
    denied: 'Refusés',
    none: 'Aucun',
    jurisdictions: 'Juridictions',
    jurSub: '{n} zones actives',
    jurTip: 'Zones de données souveraines actives avec leurs plans de données associés.',
    hCode: 'Code',
    hName: 'Nom',
    hPlane: 'Plan de données',
    planeTip: 'Infrastructure physique de traitement dans chaque juridiction.',
    hEvents: 'Événements',
    eventsTip: 'Nombre d’événements traités dans cette juridiction.',
    jur_ma: 'Maroc',
    jur_sa: 'Arabie saoudite',
    jur_ae: 'EAU',
    jur_fr: 'France',
    jur_eu: 'UE',
    pageTitle: 'Configuration',
    pageSub: 'Paramètres de la passerelle et ressources enregistrées (lecture seule)',
    editConfig: 'Modifier la configuration',
    exportConfig: 'Exporter la config',
    exportAlert: 'Fonctionnalité P2 — export YAML bientôt disponible.',
  },
};

/* ── Skeleton shimmer ───────────────────────────── */
function Shimmer({ className }: { className?: string }) {
  return <div className={`animate-shimmer rounded ${className ?? ''}`} />;
}

/* ── Section header ─────────────────────────────── */
function SectionHeader({ icon: Icon, title, subtitle, tooltip }: {
  icon: React.ElementType; title: string; subtitle: string; tooltip?: string;
}) {
  return (
    <div className="flex items-center gap-3 mb-4">
      <Icon className="h-4 w-4 text-muted-foreground" strokeWidth={1.5} />
      <div>
        <div className="text-sm font-body font-medium text-foreground">{title}{tooltip && <InfoTooltip text={tooltip} />}</div>
        <div className="text-xs text-muted-foreground">{subtitle}</div>
      </div>
    </div>
  );
}

/* ── Status badge ───────────────────────────────── */
function StatusBadge({ ok }: { ok: boolean }) {
  const t = T[useLang()];
  return (
    <span className={`pill ${ok ? 'pill-allow' : 'pill-deny'}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${ok ? 'bg-safe animate-pulse-dot' : 'bg-danger'}`} />
      {ok ? t.connected : t.offline}
    </span>
  );
}

/* ── Format uptime ──────────────────────────────── */
function formatUptime(seconds: number): string {
  if (seconds < 60) return `${Math.floor(seconds)}s`;
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const parts: string[] = [];
  if (d > 0) parts.push(`${d}d`);
  if (h > 0) parts.push(`${h}h`);
  parts.push(`${m}m`);
  return parts.join(' ');
}

/* ── Mask agent key ─────────────────────────────── */
function maskAgentKey(id: string): string {
  const last4 = id.length >= 4 ? id.slice(-4) : id;
  return `baw_\u2022\u2022\u2022\u2022${last4}`;
}

/* ── Jurisdiction flags ─────────────────────────── */
const JURISDICTION_FLAGS: Record<string, string> = {
  ma: '\u{1F1F2}\u{1F1E6}',
  sa: '\u{1F1F8}\u{1F1E6}',
  ae: '\u{1F1E6}\u{1F1EA}',
  fr: '\u{1F1EB}\u{1F1F7}',
  eu: '\u{1F1EA}\u{1F1FA}',
};

/* ── Gateway Section ────────────────────────────── */
function GatewaySection({ health, loading }: { health: HealthResponse | null; loading: boolean }) {
  const t = T[useLang()];
  const rows: { label: React.ReactNode; value: React.ReactNode }[] = [
    { label: <span>{t.rowStatus}<InfoTooltip text={t.statusTip} /></span>, value: health ? <StatusBadge ok={health.status === 'healthy'} /> : null },
    { label: t.rowVersion, value: <span className="font-mono">{health?.version || '-'}</span> },
    { label: <span>{t.rowUptime}<InfoTooltip text={t.uptimeTip} /></span>, value: health ? formatUptime(health.uptime_seconds) : '-' },
    { label: t.rowPortProxy, value: <span className="font-mono">8080</span> },
    { label: t.rowPortApi, value: <span className="font-mono">8081</span> },
    { label: t.rowLogLevel, value: 'info' },
  ];

  // Append modules_status rows if available
  const moduleRows: { label: React.ReactNode; value: React.ReactNode }[] = [];
  if (health?.modules_status) {
    for (const [mod, status] of Object.entries(health.modules_status)) {
      moduleRows.push({
        label: mod,
        value: (
          <span className={`pill ${status === 'healthy' || status === 'ok' ? 'pill-allow' : 'pill-deny'}`}>
            <span className={`w-1.5 h-1.5 rounded-full ${
              status === 'healthy' || status === 'ok' ? 'bg-safe' : 'bg-danger'
            }`} />
            {status}
          </span>
        ),
      });
    }
  }

  const allRows = [...rows, ...moduleRows];

  return (
    <div className="bg-background border border-border rounded-sm p-5">
      <SectionHeader icon={Server} title={t.gateway} subtitle={t.gatewaySub} tooltip={t.gatewayTip} />
      <div className="space-y-0">
        {allRows.map((row, idx) => (
          <div key={idx} className="data-row flex items-center justify-between py-2.5 border-b border-border last:border-0">
            {loading ? (
              <>
                <Shimmer className="h-3 w-24" />
                <Shimmer className="h-3 w-20" />
              </>
            ) : (
              <>
                <span className="text-sm text-muted-foreground font-body">{row.label}</span>
                <span className="text-sm font-data tabular-nums text-foreground">{row.value}</span>
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

/* ── Agents Section ─────────────────────────────── */
function AgentsSection({ agents, recentAgents, loading }: {
  agents: AgentInfo[]; recentAgents: Set<string>; loading: boolean;
}) {
  const t = T[useLang()];
  const headers: { label: string; tooltip?: string }[] = [
    { label: t.hAgent },
    { label: t.hKey, tooltip: t.keyTip },
    { label: t.hPermissions, tooltip: t.permTip },
    { label: t.hStatus, tooltip: t.agentStatusTip },
  ];

  return (
    <div className="bg-background border border-border rounded-sm p-5">
      <SectionHeader icon={Users} title={t.regAgents} subtitle={t.regAgentsSub.replace('{n}', String(agents.length))} tooltip={t.regAgentsTip} />

      {/* Table header */}
      <div className="grid grid-cols-[1fr_110px_1fr_92px] gap-3 mb-2">
        {headers.map(h => (
          <span key={h.label} className="table-header">{h.label}{h.tooltip && <InfoTooltip text={h.tooltip} />}</span>
        ))}
      </div>

      {/* Rows */}
      {loading ? (
        Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="grid grid-cols-[1fr_110px_1fr_92px] gap-3 py-2.5 border-b border-border last:border-0">
            <Shimmer className="h-3 w-24" />
            <Shimmer className="h-3 w-16" />
            <Shimmer className="h-3 w-40" />
            <Shimmer className="h-3 w-14" />
          </div>
        ))
      ) : (
        agents.map(agent => (
          <div key={agent.id} className="data-row grid grid-cols-[1fr_110px_1fr_92px] gap-3 py-2.5 border-b border-border last:border-0 items-center">
            <span className="mono-cell text-xs text-foreground truncate">{agent.id}</span>
            <span className="text-xs mono-cell text-muted-foreground">{maskAgentKey(agent.id)}</span>
            <div className="flex flex-wrap gap-1 items-center">
              {agent.allowed_tools.slice(0, 3).map(t => (
                <span key={t} className="text-[11px] font-data px-1.5 py-0.5 bg-safe-bg text-safe rounded-sm">{t}</span>
              ))}
              {agent.denied_tools.slice(0, 2).map(t => (
                <span key={t} className="text-[11px] font-data px-1.5 py-0.5 bg-danger-bg text-danger rounded-sm line-through">{t}</span>
              ))}
              {(agent.allowed_tools.length + agent.denied_tools.length) > 5 && (
                <span className="text-[11px] text-muted-foreground">+{agent.allowed_tools.length + agent.denied_tools.length - 5}</span>
              )}
            </div>
            <span className={`pill ${recentAgents.has(agent.id) ? 'pill-allow' : 'pill-neutral'}`}>
              <span className={`w-1.5 h-1.5 rounded-full ${recentAgents.has(agent.id) ? 'bg-safe' : 'bg-ink-4'}`} />
              {recentAgents.has(agent.id) ? t.active : t.inactive}
            </span>
          </div>
        ))
      )}
    </div>
  );
}

/* ── Policies Section ───────────────────────────── */
function PoliciesSection({ policies, loading }: { policies: PolicyEntry[]; loading: boolean }) {
  const t = T[useLang()];
  const [expanded, setExpanded] = useState<string | null>(null);

  return (
    <div className="bg-background border border-border rounded-sm p-5">
      <SectionHeader icon={Scale} title={t.activePolicies} subtitle={t.policiesSub.replace('{n}', String(policies.length))} tooltip={t.policiesTip} />

      {loading ? (
        Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="py-3 border-b border-border last:border-0">
            <Shimmer className="h-3 w-32 mb-2" />
            <Shimmer className="h-3 w-48" />
          </div>
        ))
      ) : policies.length === 0 ? (
        <div className="py-6 text-center">
          <span className="text-xs text-muted-foreground">{t.noPolicies}</span>
        </div>
      ) : (
        policies.map(policy => (
          <div key={policy.agent_id} className="border-b border-border last:border-0">
            <button
              onClick={() => setExpanded(expanded === policy.agent_id ? null : policy.agent_id)}
              className="w-full flex items-center justify-between py-3 text-left hover:bg-secondary/30 transition-colors -mx-2 px-2 rounded-sm"
            >
              <div className="flex items-center gap-3">
                <Shield className="h-3.5 w-3.5 text-muted-foreground" strokeWidth={1.5} />
                <span className="text-xs font-mono text-foreground">{policy.agent_id}</span>
                <span className="text-[10px] font-mono text-muted-foreground">{policy.pii_mode} · {policy.rate_limit}</span>
              </div>
              <ChevronDown className={`h-3.5 w-3.5 text-muted-foreground transition-transform ${expanded === policy.agent_id ? 'rotate-180' : ''}`} />
            </button>

            {expanded === policy.agent_id && (
              <div className="pb-3 pl-8 animate-fade-in">
                <div className="mb-2">
                  <span className="table-header">{t.allowed}</span>
                  <div className="flex flex-wrap gap-1 mt-1">
                    {policy.allowed_tools.length > 0 ? policy.allowed_tools.map(tool => (
                      <span key={tool} className="text-[10px] font-mono px-1.5 py-0.5 bg-safe-bg text-safe rounded-sm">{tool}</span>
                    )) : <span className="text-[10px] text-muted-foreground">{t.none}</span>}
                  </div>
                </div>
                <div>
                  <span className="table-header">{t.denied}</span>
                  <div className="flex flex-wrap gap-1 mt-1">
                    {policy.denied_tools.length > 0 ? policy.denied_tools.map(tool => (
                      <span key={tool} className="text-[10px] font-mono px-1.5 py-0.5 bg-danger-bg text-danger rounded-sm">{tool}</span>
                    )) : <span className="text-[10px] text-muted-foreground">{t.none}</span>}
                  </div>
                </div>
              </div>
            )}
          </div>
        ))
      )}
    </div>
  );
}

/* ── Jurisdictions Section ──────────────────────── */
const JURISDICTION_META: Record<string, { name: string; plane: string }> = {
  ma: { name: 'Morocco', plane: 'Casablanca \u2014 Inwi DC' },
  sa: { name: 'KSA', plane: 'Riyadh \u2014 stc cloud' },
  ae: { name: 'UAE', plane: 'Abu Dhabi \u2014 G42' },
  fr: { name: 'France', plane: 'Paris \u2014 OVHcloud' },
  eu: { name: 'EU', plane: 'Frankfurt \u2014 Hetzner' },
};

function JurisdictionsSection({ jurisdictions, loading }: {
  jurisdictions: JurisdictionEntry[]; loading: boolean;
}) {
  const t = T[useLang()];
  const maxEvents = jurisdictions.length > 0
    ? Math.max(...jurisdictions.map(j => j.event_count))
    : 0;

  const headers: { label: string; tooltip?: string }[] = [
    { label: t.hCode },
    { label: t.hName },
    { label: t.hPlane, tooltip: t.planeTip },
    { label: t.hEvents, tooltip: t.eventsTip },
  ];

  return (
    <div className="bg-background border border-border rounded-sm p-5">
      <SectionHeader icon={Globe} title={t.jurisdictions} subtitle={t.jurSub.replace('{n}', String(jurisdictions.length))} tooltip={t.jurTip} />

      {/* Table header */}
      <div className="grid grid-cols-[60px_1fr_1fr_80px] gap-3 mb-2">
        {headers.map(h => (
          <span key={h.label} className="table-header">{h.label}{h.tooltip && <InfoTooltip text={h.tooltip} />}</span>
        ))}
      </div>

      {loading ? (
        Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="grid grid-cols-[60px_1fr_1fr_80px] gap-3 py-2.5 border-b border-border last:border-0">
            <Shimmer className="h-3 w-8" />
            <Shimmer className="h-3 w-20" />
            <Shimmer className="h-3 w-32" />
            <Shimmer className="h-3 w-10" />
          </div>
        ))
      ) : (
        jurisdictions.map(j => {
          const meta = JURISDICTION_META[j.code] || { name: j.code.toUpperCase(), plane: j.backend };
          const flag = JURISDICTION_FLAGS[j.code] || '';
          const pct = maxEvents > 0 ? (j.event_count / maxEvents) * 100 : 0;
          return (
            <div key={j.code} className="border-b border-border last:border-0">
              <div className="data-row grid grid-cols-[60px_1fr_1fr_80px] gap-3 py-2.5 items-center">
                <span className="text-sm mono-cell text-foreground uppercase">
                  {flag && <span className="mr-1">{flag}</span>}{j.code}
                </span>
                <span className="text-sm font-body text-foreground">{t[`jur_${j.code}`] ?? meta.name}</span>
                <span className="text-sm text-muted-foreground">{meta.plane}</span>
                <span className="text-sm font-data tabular-nums text-foreground">{j.event_count.toLocaleString()}</span>
              </div>
              <div className="h-[3px] w-full bg-border rounded-sm overflow-hidden mb-1">
                <div
                  className="h-full bg-primary rounded-sm transition-all duration-500"
                  style={{ width: `${pct}%` }}
                />
              </div>
            </div>
          );
        })
      )}
    </div>
  );
}

/* ── Settings Page ──────────────────────────────── */
export default function Settings() {
  const t = T[useLang()];
  const [loading, setLoading] = useState(true);
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [agents, setAgents] = useState<AgentInfo[]>([]);
  const [policies, setPolicies] = useState<PolicyEntry[]>([]);
  const [jurisdictions, setJurisdictions] = useState<JurisdictionEntry[]>([]);
  const [recentAgents, setRecentAgents] = useState<Set<string>>(new Set());
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  /* ── Health poll every 10s ──────────────────────── */
  const pollHealth = useCallback(async () => {
    try {
      const h = await fetchHealth();
      setHealth(h);
    } catch {
      // keep previous health state on error
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      const available = await isApiAvailable();
      if (cancelled) return;

      if (available) {
        try {
          const [h, a, p, j] = await Promise.all([
            fetchHealth(),
            fetchAgents(),
            fetchPolicies(),
            fetchJurisdictions(),
          ]);
          if (cancelled) return;

          setHealth(h);
          setAgents(a || []);
          setPolicies(p || []);
          setJurisdictions(j || []);

          // All agents returned by the API are considered active
          const active = new Set<string>();
          if (a) {
            for (const agent of a) {
              active.add(agent.id);
            }
          }
          setRecentAgents(active);
        } catch {
          // Keep defaults
        }
      }

      if (!cancelled) setLoading(false);
    }

    load();

    // Start health polling every 10 seconds
    intervalRef.current = setInterval(pollHealth, 10_000);

    return () => {
      cancelled = true;
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [pollHealth]);

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div>
        <h2 className="font-heading text-2xl font-light text-foreground" style={{ letterSpacing: '1px' }}>
          {t.pageTitle}
        </h2>
        <p className="text-xs text-muted-foreground mt-1">
          {t.pageSub}
        </p>
      </div>

      {/* 2-column layout for Gateway + Agents */}
      <div className="grid grid-cols-12 gap-6">
        <div className="col-span-4">
          <GatewaySection health={health} loading={loading} />
        </div>
        <div className="col-span-8">
          <AgentsSection agents={agents} recentAgents={recentAgents} loading={loading} />
        </div>
      </div>

      {/* 2-column layout for Policies + Jurisdictions */}
      <div className="grid grid-cols-12 gap-6">
        <div className="col-span-6">
          <PoliciesSection policies={policies} loading={loading} />
        </div>
        <div className="col-span-6">
          <JurisdictionsSection jurisdictions={jurisdictions} loading={loading} />
        </div>
      </div>

      {/* Bottom actions */}
      <div className="flex items-center gap-3 pt-2">
        <button
          disabled
          className="flex items-center gap-2 px-4 py-2 text-xs font-body font-medium border border-border rounded-sm text-muted-foreground bg-secondary/50 cursor-not-allowed"
        >
          <Lock className="h-3.5 w-3.5" strokeWidth={1.5} />
          {t.editConfig}
          <span className="text-[9px] font-mono px-1.5 py-0.5 bg-secondary rounded-sm ml-1">P2</span>
        </button>
        <button
          onClick={() => alert(t.exportAlert)}
          className="flex items-center gap-2 px-4 py-2 text-xs font-body font-medium border border-border rounded-sm text-foreground hover:bg-secondary/50 transition-colors"
        >
          <Download className="h-3.5 w-3.5" strokeWidth={1.5} />
          {t.exportConfig}
        </button>
      </div>
    </div>
  );
}

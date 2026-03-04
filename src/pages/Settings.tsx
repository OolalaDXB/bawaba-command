import { useState, useEffect, useCallback, useRef } from 'react';
import { Shield, Server, Users, Scale, Globe, ChevronDown, Download, Lock } from 'lucide-react';
import {
  isApiAvailable, fetchHealth, fetchAgents, fetchPolicies, fetchJurisdictions,
  type HealthResponse, type AgentInfo, type PolicyEntry, type JurisdictionEntry,
} from '@/services/api';

/* ── Skeleton shimmer ───────────────────────────── */
function Shimmer({ className }: { className?: string }) {
  return <div className={`animate-shimmer rounded ${className ?? ''}`} />;
}

/* ── Section header ─────────────────────────────── */
function SectionHeader({ icon: Icon, title, subtitle }: {
  icon: React.ElementType; title: string; subtitle: string;
}) {
  return (
    <div className="flex items-center gap-3 mb-4">
      <Icon className="h-4 w-4 text-muted-foreground" strokeWidth={1.5} />
      <div>
        <div className="text-sm font-heading font-medium text-foreground">{title}</div>
        <div className="text-xs text-muted-foreground">{subtitle}</div>
      </div>
    </div>
  );
}

/* ── Status badge ───────────────────────────────── */
function StatusBadge({ ok }: { ok: boolean }) {
  return (
    <span className={`inline-flex items-center gap-1.5 text-[10px] font-mono px-2 py-0.5 rounded-sm ${
      ok ? 'bg-safe-bg text-safe' : 'bg-danger-bg text-danger'
    }`}>
      <span className={`w-1.5 h-1.5 rounded-full ${ok ? 'bg-safe animate-pulse-dot' : 'bg-danger'}`} />
      {ok ? 'Connected' : 'Offline'}
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
  if (d > 0) parts.push(`${d}j`);
  if (h > 0) parts.push(`${h}h`);
  parts.push(`${m}min`);
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
  const rows: { label: string; value: React.ReactNode }[] = [
    { label: 'Status', value: health ? <StatusBadge ok={health.status === 'healthy'} /> : null },
    { label: 'Version', value: <span className="font-mono">{health?.version || '-'}</span> },
    { label: 'Uptime', value: health ? formatUptime(health.uptime_seconds) : '-' },
    { label: 'Proxy Port', value: <span className="font-mono">8080</span> },
    { label: 'API Port', value: <span className="font-mono">8081</span> },
    { label: 'Log Level', value: 'info' },
  ];

  // Append modules_status rows if available
  const moduleRows: { label: string; value: React.ReactNode }[] = [];
  if (health?.modules_status) {
    for (const [mod, status] of Object.entries(health.modules_status)) {
      moduleRows.push({
        label: mod,
        value: (
          <span className={`inline-flex items-center gap-1.5 text-[10px] font-mono px-2 py-0.5 rounded-sm ${
            status === 'healthy' || status === 'ok' ? 'bg-safe-bg text-safe' : 'bg-danger-bg text-danger'
          }`}>
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
      <SectionHeader icon={Server} title="Gateway" subtitle="Core gateway configuration" />
      <div className="space-y-0">
        {allRows.map(row => (
          <div key={row.label} className="flex items-center justify-between py-2.5 border-b border-border last:border-0">
            {loading ? (
              <>
                <Shimmer className="h-3 w-24" />
                <Shimmer className="h-3 w-20" />
              </>
            ) : (
              <>
                <span className="text-xs text-muted-foreground font-body">{row.label}</span>
                <span className="text-xs font-mono text-foreground">{row.value}</span>
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
  return (
    <div className="bg-background border border-border rounded-sm p-5">
      <SectionHeader icon={Users} title="Registered Agents" subtitle={`${agents.length} agents configured`} />

      {/* Table header */}
      <div className="grid grid-cols-[1fr_100px_1fr_80px] gap-3 mb-2">
        {['Agent', 'Key', 'Permissions', 'Status'].map(h => (
          <span key={h} className="table-header">{h}</span>
        ))}
      </div>

      {/* Rows */}
      {loading ? (
        Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="grid grid-cols-[1fr_100px_1fr_80px] gap-3 py-2.5 border-b border-border last:border-0">
            <Shimmer className="h-3 w-24" />
            <Shimmer className="h-3 w-16" />
            <Shimmer className="h-3 w-40" />
            <Shimmer className="h-3 w-14" />
          </div>
        ))
      ) : (
        agents.map(agent => (
          <div key={agent.id} className="grid grid-cols-[1fr_100px_1fr_80px] gap-3 py-2.5 border-b border-border last:border-0 items-center">
            <span className="text-xs font-mono text-foreground">{agent.id}</span>
            <span className="text-xs font-mono text-muted-foreground">{maskAgentKey(agent.id)}</span>
            <div className="flex flex-wrap gap-1">
              {agent.allowed_tools.slice(0, 3).map(t => (
                <span key={t} className="text-[10px] font-mono px-1.5 py-0.5 bg-safe-bg text-safe rounded-sm">{t}</span>
              ))}
              {agent.denied_tools.slice(0, 2).map(t => (
                <span key={t} className="text-[10px] font-mono px-1.5 py-0.5 bg-danger-bg text-danger rounded-sm line-through">{t}</span>
              ))}
              {(agent.allowed_tools.length + agent.denied_tools.length) > 5 && (
                <span className="text-[10px] text-muted-foreground">+{agent.allowed_tools.length + agent.denied_tools.length - 5}</span>
              )}
            </div>
            <span className={`inline-flex items-center gap-1.5 text-[10px] font-mono ${
              recentAgents.has(agent.id) ? 'text-safe' : 'text-muted-foreground'
            }`}>
              <span className={`w-1.5 h-1.5 rounded-full ${recentAgents.has(agent.id) ? 'bg-safe' : 'bg-ink-4'}`} />
              {recentAgents.has(agent.id) ? 'Active' : 'Idle'}
            </span>
          </div>
        ))
      )}
    </div>
  );
}

/* ── Policies Section ───────────────────────────── */
function PoliciesSection({ policies, loading }: { policies: PolicyEntry[]; loading: boolean }) {
  const [expanded, setExpanded] = useState<string | null>(null);

  return (
    <div className="bg-background border border-border rounded-sm p-5">
      <SectionHeader icon={Scale} title="Active Policies" subtitle={`${policies.length} policy rules`} />

      {loading ? (
        Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="py-3 border-b border-border last:border-0">
            <Shimmer className="h-3 w-32 mb-2" />
            <Shimmer className="h-3 w-48" />
          </div>
        ))
      ) : policies.length === 0 ? (
        <div className="py-6 text-center">
          <span className="text-xs text-muted-foreground">Aucune politique configurée</span>
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
                  <span className="table-header">Allowed</span>
                  <div className="flex flex-wrap gap-1 mt-1">
                    {policy.allowed_tools.length > 0 ? policy.allowed_tools.map(t => (
                      <span key={t} className="text-[10px] font-mono px-1.5 py-0.5 bg-safe-bg text-safe rounded-sm">{t}</span>
                    )) : <span className="text-[10px] text-muted-foreground">None</span>}
                  </div>
                </div>
                <div>
                  <span className="table-header">Denied</span>
                  <div className="flex flex-wrap gap-1 mt-1">
                    {policy.denied_tools.length > 0 ? policy.denied_tools.map(t => (
                      <span key={t} className="text-[10px] font-mono px-1.5 py-0.5 bg-danger-bg text-danger rounded-sm">{t}</span>
                    )) : <span className="text-[10px] text-muted-foreground">None</span>}
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
  const maxEvents = jurisdictions.length > 0
    ? Math.max(...jurisdictions.map(j => j.event_count))
    : 0;

  return (
    <div className="bg-background border border-border rounded-sm p-5">
      <SectionHeader icon={Globe} title="Jurisdictions" subtitle={`${jurisdictions.length} active zones`} />

      {/* Table header */}
      <div className="grid grid-cols-[60px_1fr_1fr_80px] gap-3 mb-2">
        {['Code', 'Name', 'Data Plane', 'Events'].map(h => (
          <span key={h} className="table-header">{h}</span>
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
              <div className="grid grid-cols-[60px_1fr_1fr_80px] gap-3 py-2.5 items-center">
                <span className="text-xs font-mono text-foreground uppercase">
                  {flag && <span className="mr-1">{flag}</span>}{j.code}
                </span>
                <span className="text-xs font-body text-foreground">{meta.name}</span>
                <span className="text-xs text-muted-foreground">{meta.plane}</span>
                <span className="text-xs font-mono text-foreground">{j.event_count.toLocaleString()}</span>
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
          Configuration
        </h2>
        <p className="text-xs text-muted-foreground mt-1">
          Gateway settings and registered resources (read-only)
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
          Modifier la configuration
          <span className="text-[9px] font-mono px-1.5 py-0.5 bg-secondary rounded-sm ml-1">P2</span>
        </button>
        <button
          onClick={() => alert('Fonctionnalite P2 — Export YAML bientot disponible.')}
          className="flex items-center gap-2 px-4 py-2 text-xs font-body font-medium border border-border rounded-sm text-foreground hover:bg-secondary/50 transition-colors"
        >
          <Download className="h-3.5 w-3.5" strokeWidth={1.5} />
          Exporter la config
        </button>
      </div>
    </div>
  );
}

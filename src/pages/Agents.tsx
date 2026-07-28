import { useState, useEffect, useCallback } from 'react';
import { AGENTS as MOCK_AGENTS, TOOLS, JURISDICTIONS, type Agent } from '@/lib/mock-data';
import { pushInjectedEvent } from '@/lib/local-audit';
import { X } from 'lucide-react';
import { Area, AreaChart, ResponsiveContainer } from 'recharts';
import InfoTooltip from '@/components/InfoTooltip';
import {
  isApiAvailable, fetchAgents, fetchAgentActivity,
  type AgentInfo, type AgentActivityEntry,
} from '@/services/api';

/* ── Time-ago helper ────────────────────────────── */
function timeAgo(date: Date): string {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

/** Map an API agent to the UI Agent shape. */
function mapAgent(agent: AgentInfo): Agent {
  return {
    id: agent.id,
    name: agent.id,
    auth: agent.auth,
    allowedTools: agent.allowed_tools || [],
    deniedTools: agent.denied_tools || [],
    piiMode: agent.pii_mode,
    rateLimit: parseInt(agent.rate_limit) || 0,
    status: 'healthy',
    lastActive: new Date(),
    created: new Date(),
    callsToday: 0,
    callsTotal: 0,
    violations: 0,
  };
}

function AgentDetailPanel({ agent, onClose, apiAvailable }: { agent: Agent; onClose: () => void; apiAvailable: boolean }) {
  const [activityData, setActivityData] = useState<{ day: number; calls: number }[]>(
    () => Array.from({ length: 30 }, (_, i) => ({ day: i, calls: Math.floor(Math.random() * 200) + 50 }))
  );
  const [activity, setActivity] = useState<AgentActivityEntry[]>([]);
  const [loadingActivity, setLoadingActivity] = useState(false);
  const [, setTick] = useState(0);

  // Live timestamp updates
  useEffect(() => {
    const interval = setInterval(() => setTick(t => t + 1), 1000);
    return () => clearInterval(interval);
  }, []);

  // Fetch real activity when API is available
  useEffect(() => {
    if (!apiAvailable) return;
    let cancelled = false;
    setLoadingActivity(true);

    async function load() {
      try {
        const data = await fetchAgentActivity(agent.id);
        if (!cancelled && data) {
          setActivity(data);
          // Build a simple activity chart from real data
          if (data.length > 0) {
            const buckets: Record<number, number> = {};
            data.forEach(entry => {
              const day = Math.floor((Date.now() - new Date(entry.timestamp).getTime()) / 86400000);
              buckets[day] = (buckets[day] || 0) + 1;
            });
            const chartData = Array.from({ length: 30 }, (_, i) => ({
              day: i,
              calls: buckets[29 - i] || 0,
            }));
            setActivityData(chartData);
          }
        }
      } catch {
        // Keep mock activity data on failure
      }
      if (!cancelled) setLoadingActivity(false);
    }

    load();
    return () => { cancelled = true; };
  }, [agent.id, apiAvailable]);

  return (
    <div className="fixed inset-y-0 right-0 w-[480px] bg-card border-l border-border z-50 overflow-y-auto shadow-card">
      <div className="flex items-center justify-between p-5 border-b border-border">
        <div>
          <div className="text-lg font-heading text-foreground">{agent.name}</div>
          <div className="text-xs text-muted-foreground font-mono">{agent.id}</div>
        </div>
        <button onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors">
          <X className="h-4 w-4" strokeWidth={1.5} />
        </button>
      </div>

      <div className="p-5 space-y-6">
        {/* Identity */}
        <div>
          <div className="table-header mb-3">Identity<InfoTooltip text="Agent identity and configuration information." /></div>
          <div className="text-[10px] text-muted-foreground bg-muted/40 rounded p-2 mb-3">
            Each agent has a unique identity verified on every request. The auth method,
            PII mode, and rate limit are configured in bawaba.yaml.
          </div>
          <div className="space-y-2">
            {[
              ['Auth method', agent.auth],
              ['PII mode', agent.piiMode],
              ['Rate limit', `${agent.rateLimit} req/hr`],
              ['Status', agent.status],
              ['Created', agent.created.toLocaleDateString()],
            ].map(([k, v]) => (
              <div key={k} className="flex justify-between text-xs">
                <span className="text-muted-foreground">
                  {k}
                  {k === 'Auth method' && <InfoTooltip text="API key (bcrypt), Bearer (shared secret, pilot mode) or mTLS. OIDC/JWT planned P2." />}
                </span>
                <span className={`font-mono ${k === 'Status' ? `status-${v}` : 'text-foreground'}`}>{v}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Capabilities */}
        <div>
          <div className="table-header mb-3">Allowed tools<InfoTooltip text="MCP tools this agent is authorized to call through the gateway." /></div>
          <div className="flex flex-wrap gap-1.5">
            {agent.allowedTools.map(t => (
              <span key={t} className="text-[10px] font-mono px-2 py-1 bg-safe-bg text-safe border border-safe/10 rounded-sm">{t}</span>
            ))}
          </div>
          <div className="text-[10px] text-muted-foreground bg-muted/40 rounded p-2 mt-2">
            Any call to a tool outside this list will be denied with a 403 code and logged in the audit trail.
          </div>
          <div className="table-header mb-3 mt-4">Denied tools<InfoTooltip text="Tools explicitly denied for this agent. Any attempt is blocked and logged." /></div>
          <div className="flex flex-wrap gap-1.5">
            {agent.deniedTools.map(t => (
              <span key={t} className="text-[10px] font-mono px-2 py-1 bg-danger-bg text-danger border border-danger/10 rounded-sm">{t}</span>
            ))}
          </div>
        </div>

        {/* Activity Graph */}
        <div>
          <div className="table-header mb-3">Activity (30 days)<InfoTooltip text="Daily call volume over the last 30 days." /></div>
          <div className="h-24">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={activityData} margin={{ top: 0, right: 0, left: 0, bottom: 0 }}>
                <Area type="monotone" dataKey="calls" stroke="hsl(30, 24%, 44%)" strokeWidth={1} fill="hsl(30, 24%, 44%)" fillOpacity={0.08} dot={false} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Recent Activity from API */}
        {apiAvailable && activity.length > 0 && (
          <div>
            <div className="table-header mb-3">Recent activity</div>
            <div className="space-y-0 border border-border rounded-sm overflow-hidden">
              {activity.slice(0, 10).map(entry => (
                <div key={entry.event_id} className="flex items-center justify-between px-3 py-2 text-xs font-mono border-b border-border last:border-0">
                  <span className="text-muted-foreground">{timeAgo(new Date(entry.timestamp))}</span>
                  <span className="text-ink-2 truncate mx-2">{entry.tool}</span>
                  <span className={entry.policy_result === 'allow' ? 'text-safe' : 'text-danger'}>{entry.policy_result}</span>
                  <span className="text-muted-foreground">{entry.latency_ms}ms</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Stats */}
        <div>
          <div className="table-header mb-3">Statistics<InfoTooltip text="Usage counters: calls today, cumulative total, and policy violations." /></div>
          <div className="grid grid-cols-3 gap-3">
            {[
              ['Today', agent.callsToday.toLocaleString()],
              ['Total', agent.callsTotal.toLocaleString()],
              ['Violations', agent.violations.toString()],
            ].map(([label, val]) => (
              <div key={label} className="p-3 bg-background border border-border rounded-sm text-center">
                <div className="text-lg font-mono font-light text-foreground">{val}</div>
                <div className="text-[10px] text-muted-foreground mt-1">{label}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── Add Agent side panel ───────────────────────── */
type ToolMode = 'off' | 'allow' | 'deny';

function generateApiKey(): string {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let s = '';
  for (let i = 0; i < 32; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return `baw_${s}`;
}

function AddAgentPanel({ onClose, onCreate }: { onClose: () => void; onCreate: (a: Agent) => void }) {
  const [name, setName] = useState('');
  const [toolModes, setToolModes] = useState<Record<string, ToolMode>>(
    () => Object.fromEntries(TOOLS.map(t => [t, 'off'])) as Record<string, ToolMode>,
  );
  const [rateLimit, setRateLimit] = useState(1000);
  const [jurisdictions, setJurisdictions] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [createdKey, setCreatedKey] = useState<string | null>(null);

  const cycleTool = (t: string) => {
    const order: ToolMode[] = ['off', 'allow', 'deny'];
    setToolModes(prev => ({ ...prev, [t]: order[(order.indexOf(prev[t]) + 1) % order.length] }));
  };
  const toggleJur = (c: string) =>
    setJurisdictions(prev => (prev.includes(c) ? prev.filter(x => x !== c) : [...prev, c]));

  const submit = () => {
    if (!name.trim()) {
      setError('Agent name is required.');
      return;
    }
    const key = generateApiKey();
    const id =
      name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') ||
      `agent-${Math.floor(Math.random() * 1e6)}`;
    const agent: Agent = {
      id,
      name: name.trim(),
      auth: 'API Key',
      allowedTools: TOOLS.filter(t => toolModes[t] === 'allow'),
      deniedTools: TOOLS.filter(t => toolModes[t] === 'deny'),
      piiMode: 'tokenize',
      rateLimit,
      status: 'pending',
      lastActive: new Date(),
      created: new Date(),
      callsToday: 0,
      callsTotal: 0,
      violations: 0,
      jurisdictions,
    };
    onCreate(agent);
    setCreatedKey(key);
  };

  const TOOL_MODE_STYLE: Record<ToolMode, string> = {
    off: 'bg-background text-muted-foreground border-border',
    allow: 'bg-safe-bg text-safe border-safe/20',
    deny: 'bg-danger-bg text-danger border-danger/20',
  };

  return (
    <div className="fixed inset-y-0 right-0 w-[480px] bg-card border-l border-border z-50 overflow-y-auto shadow-card">
      <div className="flex items-center justify-between p-5 border-b border-border">
        <div>
          <div className="text-lg font-heading text-foreground">{createdKey ? 'Agent created' : 'Add agent'}</div>
          <div className="text-xs text-muted-foreground font-mono">
            {createdKey ? 'Registered in the local demo registry' : 'Register a new agent (local demo)'}
          </div>
        </div>
        <button onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors">
          <X className="h-4 w-4" strokeWidth={1.5} />
        </button>
      </div>

      {createdKey ? (
        /* ── Success view: key shown once ── */
        <div className="p-5 space-y-5">
          <div className="text-xs text-foreground">
            <span className="font-mono">{name.trim()}</span> is now in the registry with status{' '}
            <span className="status-pending font-mono">pending</span>, and turns{' '}
            <span className="status-healthy font-mono">healthy</span> once the first heartbeat lands. An{' '}
            <span className="font-mono">agent_registered</span> event was written to the audit chain.
          </div>
          <div>
            <div className="table-header mb-1.5">API key<InfoTooltip text="Shown once. It is not stored in plaintext — only a bcrypt hash is kept server-side." /></div>
            <div className="font-mono text-xs text-foreground break-all bg-secondary/20 rounded-sm p-2 border border-border">{createdKey}</div>
            <div className="text-[10px] text-warn bg-warn-bg border border-warn/10 rounded p-2 mt-1.5">
              Copy this key now — it is displayed only once and cannot be retrieved later.
            </div>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => navigator.clipboard?.writeText(createdKey)}
              className="text-xs font-body px-3 py-2 border border-border rounded-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              Copy key
            </button>
            <button
              onClick={onClose}
              className="text-xs font-body font-medium px-4 py-2 bg-primary text-primary-foreground rounded-sm hover:opacity-90 transition-opacity"
            >
              Done
            </button>
          </div>
        </div>
      ) : (
        /* ── Form view ── */
        <div className="p-5 space-y-6">
          {/* Name */}
          <div>
            <div className="table-header mb-2">Agent name</div>
            <input
              value={name}
              onChange={e => { setName(e.target.value); setError(null); }}
              placeholder="e.g. claude-analytics"
              className="w-full text-xs font-mono px-3 py-2 border border-border rounded-sm bg-background text-foreground placeholder:text-ink-4 focus:outline-none focus:border-primary"
            />
          </div>

          {/* Auth method */}
          <div>
            <div className="table-header mb-2">Auth method</div>
            <div className="text-xs font-mono text-foreground bg-secondary/20 border border-border rounded-sm px-3 py-2">API key (bcrypt)</div>
            <div className="text-[10px] text-muted-foreground bg-muted/40 rounded p-2 mt-1.5">
              A <span className="font-mono">baw_…</span> key is generated on creation and shown only once.
            </div>
          </div>

          {/* Allowed / Denied tools */}
          <div>
            <div className="table-header mb-2">Tools<InfoTooltip text="Click a tool to cycle Off -> Allow -> Deny. Allow builds the allowlist, Deny the denylist. Anything left Off is denied by default." /></div>
            <div className="space-y-1.5">
              {TOOLS.map(t => (
                <button
                  key={t}
                  onClick={() => cycleTool(t)}
                  className="w-full flex items-center justify-between px-3 py-1.5 border border-border rounded-sm bg-background hover:bg-secondary/30 transition-colors"
                >
                  <span className="text-xs font-mono text-foreground">{t}</span>
                  <span className={`text-[10px] font-mono uppercase px-2 py-0.5 rounded-sm border ${TOOL_MODE_STYLE[toolModes[t]]}`}>
                    {toolModes[t]}
                  </span>
                </button>
              ))}
            </div>
          </div>

          {/* PII mode */}
          <div>
            <div className="table-header mb-2">PII mode</div>
            <div className="text-xs font-mono text-foreground bg-secondary/20 border border-border rounded-sm px-3 py-2">tokenize</div>
            <div className="text-[10px] text-muted-foreground bg-muted/40 rounded p-2 mt-1.5">
              Tokenize is the only implemented mode. PII is replaced with UUID tokens held in a scoped vault.
            </div>
          </div>

          {/* Rate limit */}
          <div>
            <div className="table-header mb-2">Rate limit (req/h)</div>
            <input
              type="number"
              min={1}
              value={rateLimit}
              onChange={e => setRateLimit(Math.max(1, parseInt(e.target.value) || 0))}
              className="w-full text-xs font-mono px-3 py-2 border border-border rounded-sm bg-background text-foreground focus:outline-none focus:border-primary"
            />
          </div>

          {/* Jurisdictions */}
          <div>
            <div className="table-header mb-2">Allowed jurisdictions</div>
            <div className="flex flex-wrap gap-1.5">
              {JURISDICTIONS.map(j => (
                <button
                  key={j.code}
                  onClick={() => toggleJur(j.code)}
                  className={`text-[10px] font-mono px-2 py-1 rounded-sm border transition-colors ${
                    jurisdictions.includes(j.code)
                      ? 'bg-primary/10 text-foreground border-primary/40'
                      : 'bg-background text-muted-foreground border-border hover:text-foreground'
                  }`}
                >
                  {j.code.toUpperCase()} · {j.name}
                </button>
              ))}
            </div>
          </div>

          {error && <div className="text-[11px] text-danger bg-danger-bg border border-danger/10 rounded p-2">{error}</div>}

          <div className="flex gap-2 pt-1">
            <button
              onClick={submit}
              className="text-xs font-body font-medium px-4 py-2 bg-primary text-primary-foreground rounded-sm hover:opacity-90 transition-opacity"
            >
              Create agent
            </button>
            <button
              onClick={onClose}
              className="text-xs font-body px-4 py-2 border border-border rounded-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Table skeleton ─────────────────────────────── */
function AgentTableSkeleton() {
  return (
    <>
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="grid grid-cols-[160px_100px_1fr_1fr_80px_80px_80px_120px] gap-2 px-5 py-3 border-b border-border">
          <div className="animate-pulse bg-muted rounded h-4 w-full" />
          <div className="animate-pulse bg-muted rounded h-4 w-full" />
          <div className="animate-pulse bg-muted rounded h-4 w-full" />
          <div className="animate-pulse bg-muted rounded h-4 w-full" />
          <div className="animate-pulse bg-muted rounded h-4 w-full" />
          <div className="animate-pulse bg-muted rounded h-4 w-full" />
          <div className="animate-pulse bg-muted rounded h-4 w-full" />
          <div className="animate-pulse bg-muted rounded h-4 w-full" />
        </div>
      ))}
    </>
  );
}

export default function Agents() {
  const [agents, setAgents] = useState<Agent[]>(MOCK_AGENTS);
  const [loading, setLoading] = useState(true);
  const [apiAvailable, setApiAvailable] = useState(false);
  const [selectedAgent, setSelectedAgent] = useState<Agent | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [, setTick] = useState(0);

  const handleCreateAgent = useCallback((agent: Agent) => {
    setAgents(prev => [agent, ...prev.filter(a => a.id !== agent.id)]);
    pushInjectedEvent({
      eventType: 'agent_registered',
      agent: agent.id,
      tool: 'agent:register',
      decision: 'allow',
      jurisdiction: agent.jurisdictions?.[0] ?? 'default',
      reviewer: 'mickael.thomas',
      details: {
        agent_id: agent.id,
        auth: agent.auth,
        pii_mode: agent.piiMode,
        rate_limit: agent.rateLimit,
        allowed_tools: agent.allowedTools,
        denied_tools: agent.deniedTools,
        jurisdictions: agent.jurisdictions,
      },
    });
    // pending -> healthy once the first heartbeat lands (demo transition)
    setTimeout(() => {
      setAgents(prev => prev.map(a => (a.id === agent.id ? { ...a, status: 'healthy' } : a)));
    }, 1400);
  }, []);

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
      setApiAvailable(available);

      if (available) {
        try {
          const data = await fetchAgents();
          if (!cancelled && data && data.length > 0) {
            setAgents(data.map(mapAgent));
          }
        } catch {
          // Keep mock agents on failure
        }
      }

      if (!cancelled) setLoading(false);
    }

    load();
    return () => { cancelled = true; };
  }, []);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div>
            <div className="text-sm font-body font-medium text-foreground">Agent registry<InfoTooltip text="List of AI agents registered with the gateway. Each agent has its own permissions and limits." /></div>
            <div className="text-xs text-muted-foreground">{agents.length} agents connected</div>
          </div>
        </div>
        <button
          onClick={() => { setSelectedAgent(null); setShowAdd(true); }}
          className="text-xs font-body font-medium px-4 py-2 bg-primary text-primary-foreground rounded-sm hover:opacity-90 transition-opacity"
        >
          Add agent
        </button>
      </div>

      <div className="text-[10px] text-muted-foreground font-body mb-2">Click an agent to see its full configuration, allowed tools, and activity history</div>

      <div className="card-surface shadow-card overflow-hidden">
        {/* Table header */}
        <div className="grid grid-cols-[160px_100px_1fr_1fr_80px_80px_80px_120px] gap-2 px-5 py-3 border-b border-border">
          <span className="table-header">Agent</span>
          <span className="table-header">Auth<InfoTooltip text="Authentication method: API key (bcrypt), Bearer (shared secret, pilot mode) or mTLS. OIDC/JWT planned P2." /></span>
          <span className="table-header">Allowed tools<InfoTooltip text="Allowlist of MCP tools this agent can call. Any off-list call → 403." /></span>
          <span className="table-header">Denied tools<InfoTooltip text="Tools explicitly denied for this agent. Any attempt is blocked and logged." /></span>
          <span className="table-header">PII mode<InfoTooltip text="PII handling strategy: tokenize (replace with UUID) or redact (remove)." /></span>
          <span className="table-header">Rate limit</span>
          <span className="table-header">Status<InfoTooltip text="Active = authorized to send requests. Inactive = blocked immediately at auth level." /></span>
          <span className="table-header">Last active</span>
        </div>

        {/* Rows */}
        {loading ? (
          <AgentTableSkeleton />
        ) : (
          agents.map(agent => (
            <div
              key={agent.id}
              onClick={() => setSelectedAgent(agent)}
              className="grid grid-cols-[160px_100px_1fr_1fr_80px_80px_80px_120px] gap-2 px-5 py-3 border-b border-border last:border-0 cursor-pointer hover:bg-secondary/30 transition-colors"
            >
              <span className="text-xs font-mono text-foreground">{agent.name}</span>
              <span className="text-xs text-muted-foreground">{agent.auth}</span>
              <div className="flex flex-wrap gap-1">
                {agent.allowedTools.map(t => (
                  <span key={t} className="text-[9px] font-mono px-1.5 py-0.5 bg-safe-bg text-safe rounded-sm">{t}</span>
                ))}
              </div>
              <div className="flex flex-wrap gap-1">
                {agent.deniedTools.map(t => (
                  <span key={t} className="text-[9px] font-mono px-1.5 py-0.5 bg-danger-bg text-danger rounded-sm">{t}</span>
                ))}
              </div>
              <span className="text-xs font-mono text-muted-foreground">{agent.piiMode}</span>
              <span className="text-xs font-mono text-muted-foreground">{agent.rateLimit}/hr</span>
              <span className={`text-xs font-mono status-${agent.status}`}>{agent.status}</span>
              <span className="text-xs text-muted-foreground">
                {timeAgo(agent.lastActive)}
              </span>
            </div>
          ))
        )}
      </div>

      {/* Detail panel */}
      {selectedAgent && (
        <>
          <div className="fixed inset-0 bg-foreground/5 z-40" onClick={() => setSelectedAgent(null)} />
          <AgentDetailPanel agent={selectedAgent} onClose={() => setSelectedAgent(null)} apiAvailable={apiAvailable} />
        </>
      )}

      {/* Add agent panel */}
      {showAdd && (
        <>
          <div className="fixed inset-0 bg-foreground/5 z-40" onClick={() => setShowAdd(false)} />
          <AddAgentPanel onClose={() => setShowAdd(false)} onCreate={handleCreateAgent} />
        </>
      )}
    </div>
  );
}

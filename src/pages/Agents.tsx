import { useState, useEffect, useCallback } from 'react';
import { AGENTS as MOCK_AGENTS, type Agent } from '@/lib/mock-data';
import { X } from 'lucide-react';
import { Area, AreaChart, ResponsiveContainer } from 'recharts';
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
          <div className="table-header mb-3">Identity</div>
          <div className="space-y-2">
            {[
              ['Auth Method', agent.auth],
              ['PII Mode', agent.piiMode],
              ['Rate Limit', `${agent.rateLimit} req/hr`],
              ['Status', agent.status],
              ['Created', agent.created.toLocaleDateString()],
            ].map(([k, v]) => (
              <div key={k} className="flex justify-between text-xs">
                <span className="text-muted-foreground">{k}</span>
                <span className={`font-mono ${k === 'Status' ? `status-${v}` : 'text-foreground'}`}>{v}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Capabilities */}
        <div>
          <div className="table-header mb-3">Allowed Tools</div>
          <div className="flex flex-wrap gap-1.5">
            {agent.allowedTools.map(t => (
              <span key={t} className="text-[10px] font-mono px-2 py-1 bg-safe-bg text-safe border border-safe/10 rounded-sm">{t}</span>
            ))}
          </div>
          <div className="table-header mb-3 mt-4">Denied Tools</div>
          <div className="flex flex-wrap gap-1.5">
            {agent.deniedTools.map(t => (
              <span key={t} className="text-[10px] font-mono px-2 py-1 bg-danger-bg text-danger border border-danger/10 rounded-sm">{t}</span>
            ))}
          </div>
        </div>

        {/* Activity Graph */}
        <div>
          <div className="table-header mb-3">Activity (30 Days)</div>
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
            <div className="table-header mb-3">Recent Activity</div>
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
          <div className="table-header mb-3">Statistics</div>
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
  const [, setTick] = useState(0);

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
            <div className="text-sm font-body font-medium text-foreground">Agent Registry</div>
            <div className="text-xs text-muted-foreground">{agents.length} agents connected</div>
          </div>
        </div>
        <button className="text-xs font-body font-medium px-4 py-2 bg-primary text-primary-foreground rounded-sm hover:opacity-90 transition-opacity">
          Add Agent
        </button>
      </div>

      <div className="card-surface shadow-card overflow-hidden">
        {/* Table header */}
        <div className="grid grid-cols-[160px_100px_1fr_1fr_80px_80px_80px_120px] gap-2 px-5 py-3 border-b border-border">
          {['Agent', 'Auth', 'Allowed Tools', 'Denied Tools', 'PII Mode', 'Rate Limit', 'Status', 'Last Active'].map(h => (
            <span key={h} className="table-header">{h}</span>
          ))}
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
    </div>
  );
}

import { useState } from 'react';
import { useAgents, type AgentRow } from '@/hooks/use-agents';
import { X } from 'lucide-react';
import { Area, AreaChart, ResponsiveContainer } from 'recharts';

function AgentDetailPanel({ agent, onClose }: { agent: AgentRow; onClose: () => void }) {
  const activityData = Array.from({ length: 30 }, (_, i) => ({
    day: i,
    calls: Math.floor(Math.random() * 200) + 50,
  }));

  return (
    <div className="fixed inset-y-0 right-0 w-[480px] bg-card border-l border-border z-50 overflow-y-auto shadow-card">
      <div className="flex items-center justify-between p-5 border-b border-border">
        <div>
          <div className="text-lg font-heading text-foreground">{agent.agent_id}</div>
          <div className="text-xs text-muted-foreground font-mono">{agent.tenant_id}</div>
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
              ['Agent ID', agent.agent_id],
              ['Tenant', agent.tenant_id],
              ['Auth Method', agent.auth_method],
              ['Status', agent.active ? 'active' : 'inactive'],
              ['Created', new Date(agent.created_at).toLocaleDateString()],
              ['Updated', new Date(agent.updated_at).toLocaleDateString()],
            ].map(([k, v]) => (
              <div key={k} className="flex justify-between text-xs">
                <span className="text-muted-foreground">{k}</span>
                <span className={`font-mono ${k === 'Status' ? (v === 'active' ? 'text-safe' : 'text-danger') : 'text-foreground'}`}>{v}</span>
              </div>
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
      </div>
    </div>
  );
}

export default function Agents() {
  const { data: agents, isLoading } = useAgents();
  const [selectedAgent, setSelectedAgent] = useState<AgentRow | null>(null);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div>
            <div className="text-sm font-body font-medium text-foreground">Agent Registry</div>
            <div className="text-xs text-muted-foreground">{agents?.length ?? 0} agents registered</div>
          </div>
        </div>
        <button className="text-xs font-body font-medium px-4 py-2 bg-primary text-primary-foreground rounded-sm hover:opacity-90 transition-opacity">
          Add Agent
        </button>
      </div>

      <div className="card-surface shadow-card overflow-hidden">
        {/* Table header */}
        <div className="grid grid-cols-[200px_120px_120px_100px_160px_160px] gap-2 px-5 py-3 border-b border-border">
          {['Agent ID', 'Auth Method', 'Tenant', 'Status', 'Created', 'Updated'].map(h => (
            <span key={h} className="table-header">{h}</span>
          ))}
        </div>

        {/* Rows */}
        {isLoading ? (
          <div className="p-8 text-center text-xs text-muted-foreground">Loading agents…</div>
        ) : (agents ?? []).length === 0 ? (
          <div className="p-8 text-center text-xs text-muted-foreground">No agents registered yet</div>
        ) : (
          (agents ?? []).map(agent => (
            <div
              key={agent.agent_id}
              onClick={() => setSelectedAgent(agent)}
              className="grid grid-cols-[200px_120px_120px_100px_160px_160px] gap-2 px-5 py-3 border-b border-border last:border-0 cursor-pointer hover:bg-secondary/30 transition-colors"
            >
              <span className="text-xs font-mono text-foreground truncate">{agent.agent_id}</span>
              <span className="text-xs text-muted-foreground">{agent.auth_method}</span>
              <span className="text-xs font-mono text-muted-foreground">{agent.tenant_id}</span>
              <span className={`text-xs font-mono ${agent.active ? 'text-safe' : 'text-danger'}`}>
                {agent.active ? 'active' : 'inactive'}
              </span>
              <span className="text-xs text-muted-foreground">{new Date(agent.created_at).toLocaleDateString()}</span>
              <span className="text-xs text-muted-foreground">{new Date(agent.updated_at).toLocaleDateString()}</span>
            </div>
          ))
        )}
      </div>

      {/* Detail panel */}
      {selectedAgent && (
        <>
          <div className="fixed inset-0 bg-foreground/5 z-40" onClick={() => setSelectedAgent(null)} />
          <AgentDetailPanel agent={selectedAgent} onClose={() => setSelectedAgent(null)} />
        </>
      )}
    </div>
  );
}

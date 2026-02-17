import { useState } from 'react';
import { useAuditEvents } from '@/hooks/use-audit-events';
import { POLICY_RULES } from '@/lib/mock-data';

const POLICY_YAML = `# bawaba.yaml — Policy Configuration
version: "1.0"
policies:
  - agent: claude-code
    rules:
      - tool: database-query
        action: allow
        conditions:
          jurisdiction: [ma, sa, ae, fr]
          pii_mode: tokenize
      - tool: git-read
        action: allow
      - tool: git-write
        action: allow
      - tool: jira-read
        action: allow
      - tool: slack-send
        action: deny
        reason: "Agent not authorized for messaging"

  - agent: chatgpt-agent
    rules:
      - tool: jira-read
        action: allow
      - tool: slack-send
        action: allow
        conditions:
          pii_mode: redact
      - tool: database-query
        action: deny
        reason: "Insufficient trust level"
      - tool: git-write
        action: deny
        reason: "Read-only agent"

  - agent: gemini-pro
    rules:
      - tool: "*"
        action: deny
        reason: "Agent blocked — compliance review pending"

  - agent: "*"
    rules:
      - tool: "*"
        action: deny
        conditions:
          rate_limit_exceeded: true
        reason: "Rate limit exceeded"

defaults:
  pii_mode: tokenize
  rate_limit: 1000
  audit: required
  merkle_chain: enabled`;

const REGO_COMPILED = `package bawaba.policy

import future.keywords.in

default allow := false

allow {
    input.agent == "claude-code"
    input.tool in {"database-query", "git-read", "git-write", "jira-read"}
    input.jurisdiction in {"ma", "sa", "ae", "fr"}
}

deny {
    input.agent == "claude-code"
    input.tool == "slack-send"
}

deny {
    input.agent == "chatgpt-agent"
    input.tool in {"database-query", "git-write"}
}

deny {
    input.agent == "gemini-pro"
}

deny {
    input.rate_limit_exceeded == true
}`;

export default function Policy() {
  const { data: events = [] } = useAuditEvents(20);
  const [activeTab, setActiveTab] = useState<'yaml' | 'rego'>('yaml');

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <div>
          <div className="text-sm font-body font-medium text-foreground">Policy Configuration</div>
          <div className="text-xs text-muted-foreground">{POLICY_RULES.length} active rules</div>
        </div>
      </div>

      <div className="grid grid-cols-12 gap-6">
        {/* Policy tree */}
        <div className="col-span-3">
          <div className="card-surface shadow-card p-4">
            <div className="table-header mb-3">Active Rules</div>
            <div className="space-y-1">
              {POLICY_RULES.map((rule, i) => (
                <div key={i} className="flex items-center justify-between py-2 px-2 border-b border-border last:border-0 text-xs">
                  <div>
                    <span className="font-mono text-foreground">{rule.agent}</span>
                    <span className="text-ink-4 mx-1">→</span>
                    <span className="font-mono text-ink-2">{rule.tool}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`font-mono text-[10px] ${rule.action === 'allow' ? 'text-safe' : 'text-danger'}`}>
                      {rule.action}
                    </span>
                    <span className="text-[9px] text-ink-4 font-mono">{rule.matched}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* YAML / Rego editor */}
        <div className="col-span-9">
          <div className="card-surface shadow-card">
            <div className="flex border-b border-border">
              {(['yaml', 'rego'] as const).map(tab => (
                <button
                  key={tab}
                  onClick={() => setActiveTab(tab)}
                  className={`px-4 py-2.5 text-xs font-mono uppercase tracking-wider transition-colors ${
                    activeTab === tab ? 'text-foreground border-b-2 border-primary' : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  {tab === 'yaml' ? 'bawaba.yaml' : 'compiled.rego'}
                </button>
              ))}
            </div>
            <pre className="p-5 text-xs font-mono text-ink-2 leading-relaxed overflow-x-auto max-h-[500px] overflow-y-auto">
              {activeTab === 'yaml' ? POLICY_YAML : REGO_COMPILED}
            </pre>
          </div>
        </div>
      </div>

      {/* Evaluation log from Supabase */}
      <div>
        <div className="flex items-center gap-3 mb-4">
          <div className="text-sm font-body font-medium text-foreground">Policy Evaluation Log</div>
        </div>
        <div className="card-surface shadow-card overflow-hidden">
          <div className="grid grid-cols-[80px_100px_110px_70px_1fr_60px] gap-2 px-5 py-2 border-b border-border">
            {['Time', 'Agent', 'Tool', 'Result', 'Matched Rule', 'Lat.'].map(h => (
              <span key={h} className="table-header">{h}</span>
            ))}
          </div>
          <div className="max-h-[300px] overflow-y-auto">
            {events.length === 0 ? (
              <div className="p-8 text-center text-xs text-muted-foreground">No evaluation events yet</div>
            ) : (
              events.slice(0, 15).map(evt => (
                <div key={evt.event_id} className="grid grid-cols-[80px_100px_110px_70px_1fr_60px] gap-2 px-5 py-2 text-xs font-mono border-b border-border">
                  <span className="text-muted-foreground">{new Date(evt.timestamp).toLocaleTimeString('en-GB', { hour12: false })}</span>
                  <span className="text-foreground truncate">{evt.agent_id}</span>
                  <span className="text-ink-2 truncate">{evt.tool}</span>
                  <span className={evt.policy_result === 'allow' ? 'text-safe' : evt.policy_result === 'deny' ? 'text-danger' : 'text-warn'}>
                    {evt.policy_result}
                  </span>
                  <span className="text-ink-3 truncate">{evt.matched_rule || '—'}</span>
                  <span className="text-muted-foreground">{evt.latency_ms}ms</span>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

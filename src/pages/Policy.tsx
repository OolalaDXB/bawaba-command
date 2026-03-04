import { useState, useEffect } from 'react';
import { POLICY_RULES as MOCK_POLICY_RULES } from '@/lib/mock-data';
import { useLiveFeed } from '@/hooks/use-live-feed';
import { isApiAvailable, fetchPolicies, type PolicyEntry } from '@/services/api';

/* ── Time-ago helper ────────────────────────────── */
function timeAgo(date: Date): string {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

/** Shape used for the rule list in the sidebar */
interface PolicyRule {
  agent: string;
  tool: string;
  action: string;
  conditions: string;
  matched: number;
}

/** Map an API policy entry to individual rule rows. */
function mapPolicyToRules(policy: PolicyEntry): PolicyRule[] {
  const rules: PolicyRule[] = [];

  // Allowed tools
  for (const tool of policy.allowed_tools || []) {
    rules.push({
      agent: policy.agent_id,
      tool,
      action: 'allow',
      conditions: `pii_mode=${policy.pii_mode}, rate=${policy.rate_limit}`,
      matched: 0,
    });
  }

  // Denied tools
  for (const tool of policy.denied_tools || []) {
    rules.push({
      agent: policy.agent_id,
      tool,
      action: 'deny',
      conditions: 'always',
      matched: 0,
    });
  }

  return rules;
}

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

/* ── Skeleton for rules sidebar ─────────────────── */
function RulesSkeleton() {
  return (
    <div className="space-y-1">
      {Array.from({ length: 7 }).map((_, i) => (
        <div key={i} className="flex items-center justify-between py-2 px-2 border-b border-border last:border-0">
          <div className="animate-pulse bg-muted rounded h-4 w-32" />
          <div className="animate-pulse bg-muted rounded h-4 w-12" />
        </div>
      ))}
    </div>
  );
}

export default function Policy() {
  const { events } = useLiveFeed(20);
  const [activeTab, setActiveTab] = useState<'yaml' | 'rego'>('yaml');
  const [rules, setRules] = useState<PolicyRule[]>(MOCK_POLICY_RULES);
  const [loading, setLoading] = useState(true);
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

      if (available) {
        try {
          const policies = await fetchPolicies();
          if (!cancelled && policies && policies.length > 0) {
            const mapped = policies.flatMap(mapPolicyToRules);
            if (mapped.length > 0) {
              setRules(mapped);
            }
          }
        } catch {
          // Keep mock rules on failure
        }
      }

      if (!cancelled) setLoading(false);
    }

    load();
    return () => { cancelled = true; };
  }, []);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <div>
          <div className="text-sm font-body font-medium text-foreground">Policy Configuration</div>
          <div className="text-xs text-muted-foreground">{rules.length} active rules</div>
        </div>
      </div>

      <div className="grid grid-cols-12 gap-6">
        {/* Policy tree */}
        <div className="col-span-3">
          <div className="card-surface shadow-card p-4">
            <div className="table-header mb-3">Active Rules</div>
            {loading ? (
              <RulesSkeleton />
            ) : (
              <div className="space-y-1">
                {rules.map((rule, i) => (
                  <div key={i} className="flex items-center justify-between py-2 px-2 border-b border-border last:border-0 text-xs">
                    <div>
                      <span className="font-mono text-foreground">{rule.agent}</span>
                      <span className="text-ink-4 mx-1">{'->'}</span>
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
            )}
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

      {/* Evaluation log */}
      <div>
        <div className="flex items-center gap-3 mb-4">
          <div className="text-sm font-body font-medium text-foreground">Policy Evaluation Log</div>
        </div>
        <div className="card-surface shadow-card overflow-hidden">
          <div className="grid grid-cols-[80px_100px_110px_70px_1fr_60px] gap-2 px-5 py-2 border-b border-border">
            {['Time', 'Agent', 'Tool', 'Result', 'Matched Rule', 'Eval'].map(h => (
              <span key={h} className="table-header">{h}</span>
            ))}
          </div>
          <div className="max-h-[300px] overflow-y-auto">
            {events.slice(0, 15).map(evt => (
              <div key={evt.id} className="grid grid-cols-[80px_100px_110px_70px_1fr_60px] gap-2 px-5 py-2 text-xs font-mono border-b border-border">
                <span className="text-muted-foreground">{timeAgo(evt.timestamp)}</span>
                <span className="text-foreground truncate">{evt.agent}</span>
                <span className="text-ink-2 truncate">{evt.tool}</span>
                <span className={evt.decision === 'allow' ? 'text-safe' : evt.decision === 'deny' ? 'text-danger' : 'text-warn'}>
                  {evt.decision}
                </span>
                <span className="text-ink-3 truncate">{String(evt.details.policy_matched)}</span>
                <span className="text-muted-foreground">{String(evt.details.evaluation_time_ms)}ms</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

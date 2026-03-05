import { useState, useEffect } from 'react';
import { X } from 'lucide-react';
import { POLICY_RULES as MOCK_POLICY_RULES } from '@/lib/mock-data';
import { useLiveFeed } from '@/hooks/use-live-feed';
import { isApiAvailable, fetchPolicies, type PolicyEntry } from '@/services/api';
import InfoTooltip from '@/components/InfoTooltip';

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
  const [selectedRule, setSelectedRule] = useState<{type: 'rule', rule: PolicyRule, index: number} | {type: 'eval', evt: any} | null>(null);

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
          <div className="text-sm font-body font-medium text-foreground">
            Policy Configuration
            <InfoTooltip text="OPA/Rego rules evaluated for each MCP request. Defines who can call what and under which conditions." />
          </div>
          <div className="text-xs text-muted-foreground">{rules.length} active rules</div>
        </div>
      </div>

      <div className="grid grid-cols-12 gap-6">
        {/* Policy tree */}
        <div className="col-span-3">
          <div className="card-surface shadow-card p-4">
            <div className="table-header mb-3">
              Active rules
              <InfoTooltip text="List of currently active policy rules. Each rule links an agent to a tool with an action." />
            </div>
            <div className="text-[10px] text-muted-foreground font-body mb-3">Click a rule to see conditions, impacted agents, and shadow status</div>
            {loading ? (
              <RulesSkeleton />
            ) : (
              <div className="space-y-1">
                {rules.map((rule, i) => (
                  <div
                    key={i}
                    className="flex items-center justify-between py-2 px-2 border-b border-border last:border-0 text-xs cursor-pointer hover:bg-muted/50 transition-colors"
                    onClick={() => setSelectedRule({ type: 'rule', rule, index: i })}
                  >
                    <div>
                      <span className="font-mono text-foreground">{rule.agent}</span>
                      <span className="text-ink-4 mx-1">{'->'}</span>
                      <span className="font-mono text-ink-2">{rule.tool}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className={`font-mono text-[10px] ${rule.action === 'allow' ? 'text-safe' : 'text-danger'}`}>
                        {rule.action}
                      </span>
                      <InfoTooltip
                        text={
                          rule.action === 'allow'
                            ? 'Request allowed if conditions are met.'
                            : 'Request systematically denied for this agent/tool.'
                        }
                      />
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
          <div className="text-sm font-body font-medium text-foreground">
            Policy evaluation log
            <InfoTooltip text="Real-time history of policy evaluations. Each row = one OPA engine decision." />
          </div>
          <div className="text-[10px] text-muted-foreground font-body">Click an evaluation to see the Rego rule that produced this decision</div>
        </div>
        <div className="card-surface shadow-card overflow-hidden">
          <div className="grid grid-cols-[80px_100px_110px_70px_1fr_60px] gap-2 px-5 py-2 border-b border-border">
            <span className="table-header">Time</span>
            <span className="table-header">Agent</span>
            <span className="table-header">Tool</span>
            <span className="table-header">
              Result
              <InfoTooltip text="OPA engine decision: allow (authorized) or deny (refused)." />
            </span>
            <span className="table-header">
              Matched rule
              <InfoTooltip text="Identifier of the Rego rule that produced this decision." />
            </span>
            <span className="table-header">
              Eval.
              <InfoTooltip text="Policy evaluation time in milliseconds." />
            </span>
          </div>
          <div className="max-h-[300px] overflow-y-auto">
            {events.slice(0, 15).map(evt => (
              <div
                key={evt.id}
                className="grid grid-cols-[80px_100px_110px_70px_1fr_60px] gap-2 px-5 py-2 text-xs font-mono border-b border-border cursor-pointer hover:bg-muted/50 transition-colors"
                onClick={() => setSelectedRule({ type: 'eval', evt })}
              >
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

      {/* Detail Drawer */}
      {selectedRule && (
        <>
          <div className="fixed inset-0 bg-foreground/5 z-40" onClick={() => setSelectedRule(null)} />
          <div className="fixed inset-y-0 right-0 w-[400px] bg-card border-l border-border z-50 overflow-y-auto shadow-card">
            <div className="flex items-center justify-between p-5 border-b border-border">
              <div>
                <div className="text-lg font-heading text-foreground">
                  {selectedRule.type === 'rule' ? 'Rule detail' : 'Evaluation detail'}
                </div>
              </div>
              <button onClick={() => setSelectedRule(null)} className="text-muted-foreground hover:text-foreground transition-colors">
                <X className="h-4 w-4" strokeWidth={1.5} />
              </button>
            </div>
            <div className="p-5 space-y-5">
              {selectedRule.type === 'rule' ? (
                <>
                  <div>
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Agent</div>
                    <div className="text-sm font-mono text-foreground">{selectedRule.rule.agent}</div>
                  </div>
                  <div>
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Tool</div>
                    <div className="text-sm font-mono text-foreground">{selectedRule.rule.tool}</div>
                  </div>
                  <div>
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Action</div>
                    <div className={`text-sm font-mono ${selectedRule.rule.action === 'allow' ? 'text-safe' : 'text-danger'}`}>
                      {selectedRule.rule.action === 'allow' ? 'Allowed' : 'Denied'} ({selectedRule.rule.action})
                    </div>
                  </div>
                  <div>
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Conditions</div>
                    <div className="text-sm font-mono text-ink-2">{selectedRule.rule.conditions === 'always' ? 'None' : selectedRule.rule.conditions}</div>
                  </div>
                  <div>
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Matches</div>
                    <div className="text-sm font-mono text-foreground">{selectedRule.rule.matched}</div>
                  </div>
                  <div>
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">
                      Shadow mode
                      <InfoTooltip text="In shadow mode, the rule is evaluated but the denial is not enforced. Allows validating a rule before production deployment." />
                    </div>
                    <div className="text-sm font-mono text-ink-3">Not active</div>
                  </div>
                </>
              ) : (
                <>
                  <div>
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Agent</div>
                    <div className="text-sm font-mono text-foreground">{selectedRule.evt.agent}</div>
                  </div>
                  <div>
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Tool</div>
                    <div className="text-sm font-mono text-foreground">{selectedRule.evt.tool}</div>
                  </div>
                  <div>
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Decision</div>
                    <div className={`text-sm font-mono ${selectedRule.evt.decision === 'allow' ? 'text-safe' : selectedRule.evt.decision === 'deny' ? 'text-danger' : 'text-warn'}`}>
                      {selectedRule.evt.decision === 'allow' ? 'Allowed' : selectedRule.evt.decision === 'deny' ? 'Denied' : selectedRule.evt.decision} ({selectedRule.evt.decision})
                    </div>
                  </div>
                  <div>
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Matched rule</div>
                    <div className="text-sm font-mono text-ink-2">{String(selectedRule.evt.details.policy_matched)}</div>
                  </div>
                  <div>
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Evaluation time</div>
                    <div className="text-sm font-mono text-foreground">{String(selectedRule.evt.details.evaluation_time_ms)}ms</div>
                  </div>
                  <div>
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Timestamp</div>
                    <div className="text-sm font-mono text-foreground">{selectedRule.evt.timestamp.toLocaleString('en-GB')}</div>
                  </div>
                </>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

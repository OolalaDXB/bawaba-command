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

const POLICY_YAML = `# bawaba.yaml — live policy projection
agents:
  test-agent:
    allowed_tools: [echo, time]
    denied_tools: []
    pii_mode: tokenize
    jurisdiction: ma

  claude-code:
    allowed_tools: [database-query, git-read, jira-read]
    denied_tools: [database-write, git-push]
    pii_mode: tokenize
    jurisdiction: ma

  cursor-ide:
    allowed_tools: [git-read, git-write]
    denied_tools: []
    pii_mode: mask
    jurisdiction: ae

policy_semantics:
  deny_precedence: true
  default_decision: deny
  version: v1.0.0`;

const DECISION_LOGIC = `decision(agent, tool):
  1. unknown agent               -> deny · default_deny
  2. tool matches denied_tools   -> deny · denied_tools.<tool>
  3. allowed_tools is empty      -> deny · no_allowed_tools
  4. tool matches allowed_tools  -> allow · allowed_tools.<tool>
  5. otherwise                   -> deny · default_deny

Implementation:
  YAML-backed in-memory evaluation
  deny rules take precedence
  every decision records policy version + matched rule

Roadmap:
  optional external policy-engine adapter — not active in this build`;

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
  const [activeTab, setActiveTab] = useState<'yaml' | 'logic'>('yaml');
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
          if (!cancelled) {
            setRules((policies || []).flatMap(mapPolicyToRules));
          }
        } catch {
          if (!cancelled) setRules([]);
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
            <InfoTooltip text="YAML-backed in-memory rules evaluated for each governed tool call. Deny rules take precedence and the default is deny." />
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
            <div className="text-[10px] text-muted-foreground font-body mb-3">Click a rule to inspect the active agent/tool decision</div>
            {loading ? (
              <RulesSkeleton />
            ) : (
              <div className="space-y-1">
                {rules.map((rule, i) => (
                  <div
                    key={i}
                    className="data-row flex items-center justify-between py-2 px-2 border-b border-border last:border-0 text-sm cursor-pointer hover:bg-muted/50 transition-colors"
                    onClick={() => setSelectedRule({ type: 'rule', rule, index: i })}
                  >
                    <div className="min-w-0 truncate">
                      <span className="text-foreground">{rule.agent}</span>
                      <span className="text-ink-4 mx-1">{'->'}</span>
                      <span className="text-ink-2">{rule.tool}</span>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className={`pill ${rule.action === 'allow' ? 'pill-allow' : 'pill-deny'}`}>
                        {rule.action}
                      </span>
                      <InfoTooltip
                        text={
                          rule.action === 'allow'
                            ? 'Request allowed if conditions are met.'
                            : 'Request systematically denied for this agent/tool.'
                        }
                      />
                      <span className="text-xs text-ink-3 font-data tabular-nums">{rule.matched}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* YAML / decision-logic view */}
        <div className="col-span-9">
          <div className="card-surface shadow-card">
            <div className="flex border-b border-border">
              {(['yaml', 'logic'] as const).map(tab => (
                <button
                  key={tab}
                  onClick={() => setActiveTab(tab)}
                  className={`px-4 py-2.5 text-xs font-mono uppercase tracking-wider transition-colors ${
                    activeTab === tab ? 'text-foreground border-b-2 border-primary' : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  {tab === 'yaml' ? 'bawaba.yaml' : 'decision.logic'}
                </button>
              ))}
            </div>
            <pre className="p-5 text-xs font-mono text-ink-2 leading-relaxed overflow-x-auto max-h-[500px] overflow-y-auto">
              {activeTab === 'yaml' ? POLICY_YAML : DECISION_LOGIC}
            </pre>
          </div>
        </div>
      </div>

      {/* Evaluation log */}
      <div>
        <div className="flex items-center gap-3 mb-4">
          <div className="text-sm font-body font-medium text-foreground">
            Policy evaluation log
            <InfoTooltip text="Real-time history of decisions returned by the running YAML-backed policy engine." />
          </div>
          <div className="text-[10px] text-muted-foreground font-body">Click an evaluation to inspect the persisted matched-rule identifier</div>
        </div>
        <div className="card-surface shadow-card overflow-hidden">
          <div className="grid grid-cols-[76px_100px_120px_104px_1fr_64px] gap-2 px-5 py-2 border-b border-border">
            <span className="table-header">Time</span>
            <span className="table-header">Agent</span>
            <span className="table-header">Tool</span>
            <span className="table-header">
              Result
              <InfoTooltip text="Policy-engine decision: allow (authorized) or deny (refused)." />
            </span>
            <span className="table-header">
              Matched rule
              <InfoTooltip text="Identifier persisted by the policy engine for the rule that produced this decision." />
            </span>
            <span className="table-header">
              Eval.
              <InfoTooltip text="Policy evaluation time in milliseconds." />
            </span>
          </div>
          <div className="max-h-[300px] overflow-y-auto zebra">
            {events.slice(0, 15).map(evt => (
              <div
                key={evt.id}
                className="data-row grid grid-cols-[76px_100px_120px_104px_1fr_64px] gap-2 px-5 py-2 text-sm font-data tabular-nums border-b border-border cursor-pointer hover:bg-muted/50 transition-colors"
                onClick={() => setSelectedRule({ type: 'eval', evt })}
              >
                <span className="text-muted-foreground">{timeAgo(evt.timestamp)}</span>
                <span className="text-foreground truncate">{evt.agent}</span>
                <span className="text-ink-2 truncate">{evt.tool}</span>
                <span>
                  <span className={`pill ${evt.decision === 'allow' ? 'pill-allow' : evt.decision === 'deny' ? 'pill-deny' : 'pill-rate'}`}>
                    {evt.decision}
                  </span>
                </span>
                <span className="text-ink-3 truncate mono-cell text-xs self-center">{String(evt.details.policy_matched)}</span>
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
                    <div className="table-header mb-1">Agent</div>
                    <div className="text-sm font-mono text-foreground">{selectedRule.rule.agent}</div>
                  </div>
                  <div>
                    <div className="table-header mb-1">Tool</div>
                    <div className="text-sm font-mono text-foreground">{selectedRule.rule.tool}</div>
                  </div>
                  <div>
                    <div className="table-header mb-1">Action</div>
                    <span className={`pill ${selectedRule.rule.action === 'allow' ? 'pill-allow' : 'pill-deny'}`}>
                      {selectedRule.rule.action === 'allow' ? 'Allowed' : 'Denied'}
                    </span>
                  </div>
                  <div>
                    <div className="table-header mb-1">Conditions</div>
                    <div className="text-sm font-mono text-ink-2">{selectedRule.rule.conditions === 'always' ? 'None' : selectedRule.rule.conditions}</div>
                  </div>
                  <div>
                    <div className="table-header mb-1">Matches</div>
                    <div className="text-sm font-mono text-foreground">{selectedRule.rule.matched}</div>
                  </div>
                </>
              ) : (
                <>
                  <div>
                    <div className="table-header mb-1">Agent</div>
                    <div className="text-sm font-mono text-foreground">{selectedRule.evt.agent}</div>
                  </div>
                  <div>
                    <div className="table-header mb-1">Tool</div>
                    <div className="text-sm font-mono text-foreground">{selectedRule.evt.tool}</div>
                  </div>
                  <div>
                    <div className="table-header mb-1">Decision</div>
                    <span className={`pill ${selectedRule.evt.decision === 'allow' ? 'pill-allow' : selectedRule.evt.decision === 'deny' ? 'pill-deny' : 'pill-rate'}`}>
                      {selectedRule.evt.decision === 'allow' ? 'Allowed' : selectedRule.evt.decision === 'deny' ? 'Denied' : selectedRule.evt.decision}
                    </span>
                  </div>
                  <div>
                    <div className="table-header mb-1">Matched rule</div>
                    <div className="text-sm font-mono text-ink-2">{String(selectedRule.evt.details.policy_matched)}</div>
                  </div>
                  <div>
                    <div className="table-header mb-1">Evaluation time</div>
                    <div className="text-sm font-mono text-foreground">{String(selectedRule.evt.details.evaluation_time_ms)}ms</div>
                  </div>
                  <div>
                    <div className="table-header mb-1">Timestamp</div>
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

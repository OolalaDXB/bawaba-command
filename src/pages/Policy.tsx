import { useState, useEffect } from 'react';
import { X } from 'lucide-react';
import { POLICY_RULES as MOCK_POLICY_RULES } from '@/lib/mock-data';
import { useLiveFeed } from '@/hooks/use-live-feed';
import { isApiAvailable, fetchPolicies, type PolicyEntry } from '@/services/api';
import InfoTooltip from '@/components/InfoTooltip';
import { useLang, type Lang } from '@/lib/i18n';

const T: Record<Lang, Record<string, string>> = {
  en: {
    agoS: '{n}s ago',
    agoM: '{n}m ago',
    agoH: '{n}h ago',
    agoD: '{n}d ago',
    title: 'Policy Configuration',
    titleTip: 'YAML-backed in-memory rules evaluated for each governed tool call. Deny rules take precedence and the default is deny.',
    activeRulesCount: '{n} active rules',
    activeRules: 'Active rules',
    activeRulesTip: 'List of currently active policy rules. Each rule links an agent to a tool with an action.',
    clickRuleHint: 'Click a rule to inspect the active agent/tool decision',
    allowTip: 'Request allowed if conditions are met.',
    denyTip: 'Request systematically denied for this agent/tool.',
    evalLog: 'Policy evaluation log',
    evalLogTip: 'Real-time history of decisions returned by the running YAML-backed policy engine.',
    clickEvalHint: 'Click an evaluation to inspect the persisted matched-rule identifier',
    hTime: 'Time',
    hAgent: 'Agent',
    hTool: 'Tool',
    hResult: 'Result',
    resultTip: 'Policy-engine decision: allow (authorized) or deny (refused).',
    hMatched: 'Matched rule',
    matchedTip: 'Identifier persisted by the policy engine for the rule that produced this decision.',
    hEval: 'Eval.',
    evalTip: 'Policy evaluation time in milliseconds.',
    drawerRule: 'Rule detail',
    drawerEval: 'Evaluation detail',
    dAgent: 'Agent',
    dTool: 'Tool',
    dAction: 'Action',
    allowed: 'Allowed',
    denied: 'Denied',
    dConditions: 'Conditions',
    none: 'None',
    dMatches: 'Matches',
    dDecision: 'Decision',
    dMatchedRule: 'Matched rule',
    dEvalTime: 'Evaluation time',
    dTimestamp: 'Timestamp',
  },
  fr: {
    agoS: 'il y a {n} s',
    agoM: 'il y a {n} min',
    agoH: 'il y a {n} h',
    agoD: 'il y a {n} j',
    title: 'Configuration des politiques',
    titleTip: 'Règles en mémoire adossées au YAML, évaluées pour chaque appel d’outil gouverné. Les règles deny priment et la décision par défaut est deny.',
    activeRulesCount: '{n} règles actives',
    activeRules: 'Règles actives',
    activeRulesTip: 'Liste des règles de politique actuellement actives. Chaque règle lie un agent à un outil avec une action.',
    clickRuleHint: 'Cliquez sur une règle pour inspecter la décision agent/outil active',
    allowTip: 'Requête autorisée si les conditions sont remplies.',
    denyTip: 'Requête systématiquement refusée pour ce couple agent/outil.',
    evalLog: 'Journal d’évaluation des politiques',
    evalLogTip: 'Historique en temps réel des décisions rendues par le moteur de politiques YAML en fonctionnement.',
    clickEvalHint: 'Cliquez sur une évaluation pour inspecter l’identifiant de règle persisté',
    hTime: 'Heure',
    hAgent: 'Agent',
    hTool: 'Outil',
    hResult: 'Résultat',
    resultTip: 'Décision du moteur de politiques : allow (autorisé) ou deny (refusé).',
    hMatched: 'Règle correspondante',
    matchedTip: 'Identifiant persisté par le moteur de politiques pour la règle ayant produit cette décision.',
    hEval: 'Éval.',
    evalTip: 'Temps d’évaluation de la politique en millisecondes.',
    drawerRule: 'Détail de la règle',
    drawerEval: 'Détail de l’évaluation',
    dAgent: 'Agent',
    dTool: 'Outil',
    dAction: 'Action',
    allowed: 'Autorisé',
    denied: 'Refusé',
    dConditions: 'Conditions',
    none: 'Aucune',
    dMatches: 'Correspondances',
    dDecision: 'Décision',
    dMatchedRule: 'Règle correspondante',
    dEvalTime: 'Temps d’évaluation',
    dTimestamp: 'Horodatage',
  },
};

/* ── Time-ago helper ────────────────────────────── */
function timeAgo(date: Date, t: Record<string, string>): string {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return t.agoS.replace('{n}', String(seconds));
  if (seconds < 3600) return t.agoM.replace('{n}', String(Math.floor(seconds / 60)));
  if (seconds < 86400) return t.agoH.replace('{n}', String(Math.floor(seconds / 3600)));
  return t.agoD.replace('{n}', String(Math.floor(seconds / 86400)));
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
  const t = T[useLang()];
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
            {t.title}
            <InfoTooltip text={t.titleTip} />
          </div>
          <div className="text-xs text-muted-foreground">{t.activeRulesCount.replace('{n}', String(rules.length))}</div>
        </div>
      </div>

      <div className="grid grid-cols-12 gap-6">
        {/* Policy tree */}
        <div className="col-span-3">
          <div className="card-surface shadow-card p-4">
            <div className="table-header mb-3">
              {t.activeRules}
              <InfoTooltip text={t.activeRulesTip} />
            </div>
            <div className="text-[10px] text-muted-foreground font-body mb-3">{t.clickRuleHint}</div>
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
                            ? t.allowTip
                            : t.denyTip
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
            {t.evalLog}
            <InfoTooltip text={t.evalLogTip} />
          </div>
          <div className="text-[10px] text-muted-foreground font-body">{t.clickEvalHint}</div>
        </div>
        <div className="card-surface shadow-card overflow-hidden">
          <div className="grid grid-cols-[76px_100px_120px_104px_1fr_64px] gap-2 px-5 py-2 border-b border-border">
            <span className="table-header">{t.hTime}</span>
            <span className="table-header">{t.hAgent}</span>
            <span className="table-header">{t.hTool}</span>
            <span className="table-header">
              {t.hResult}
              <InfoTooltip text={t.resultTip} />
            </span>
            <span className="table-header">
              {t.hMatched}
              <InfoTooltip text={t.matchedTip} />
            </span>
            <span className="table-header">
              {t.hEval}
              <InfoTooltip text={t.evalTip} />
            </span>
          </div>
          <div className="max-h-[300px] overflow-y-auto zebra">
            {events.slice(0, 15).map(evt => (
              <div
                key={evt.id}
                className="data-row grid grid-cols-[76px_100px_120px_104px_1fr_64px] gap-2 px-5 py-2 text-sm font-data tabular-nums border-b border-border cursor-pointer hover:bg-muted/50 transition-colors"
                onClick={() => setSelectedRule({ type: 'eval', evt })}
              >
                <span className="text-muted-foreground">{timeAgo(evt.timestamp, t)}</span>
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
                  {selectedRule.type === 'rule' ? t.drawerRule : t.drawerEval}
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
                    <div className="table-header mb-1">{t.dAgent}</div>
                    <div className="text-sm font-mono text-foreground">{selectedRule.rule.agent}</div>
                  </div>
                  <div>
                    <div className="table-header mb-1">{t.dTool}</div>
                    <div className="text-sm font-mono text-foreground">{selectedRule.rule.tool}</div>
                  </div>
                  <div>
                    <div className="table-header mb-1">{t.dAction}</div>
                    <span className={`pill ${selectedRule.rule.action === 'allow' ? 'pill-allow' : 'pill-deny'}`}>
                      {selectedRule.rule.action === 'allow' ? t.allowed : t.denied}
                    </span>
                  </div>
                  <div>
                    <div className="table-header mb-1">{t.dConditions}</div>
                    <div className="text-sm font-mono text-ink-2">{selectedRule.rule.conditions === 'always' ? t.none : selectedRule.rule.conditions}</div>
                  </div>
                  <div>
                    <div className="table-header mb-1">{t.dMatches}</div>
                    <div className="text-sm font-mono text-foreground">{selectedRule.rule.matched}</div>
                  </div>
                </>
              ) : (
                <>
                  <div>
                    <div className="table-header mb-1">{t.dAgent}</div>
                    <div className="text-sm font-mono text-foreground">{selectedRule.evt.agent}</div>
                  </div>
                  <div>
                    <div className="table-header mb-1">{t.dTool}</div>
                    <div className="text-sm font-mono text-foreground">{selectedRule.evt.tool}</div>
                  </div>
                  <div>
                    <div className="table-header mb-1">{t.dDecision}</div>
                    <span className={`pill ${selectedRule.evt.decision === 'allow' ? 'pill-allow' : selectedRule.evt.decision === 'deny' ? 'pill-deny' : 'pill-rate'}`}>
                      {selectedRule.evt.decision === 'allow' ? t.allowed : selectedRule.evt.decision === 'deny' ? t.denied : selectedRule.evt.decision}
                    </span>
                  </div>
                  <div>
                    <div className="table-header mb-1">{t.dMatchedRule}</div>
                    <div className="text-sm font-mono text-ink-2">{String(selectedRule.evt.details.policy_matched)}</div>
                  </div>
                  <div>
                    <div className="table-header mb-1">{t.dEvalTime}</div>
                    <div className="text-sm font-mono text-foreground">{String(selectedRule.evt.details.evaluation_time_ms)}ms</div>
                  </div>
                  <div>
                    <div className="table-header mb-1">{t.dTimestamp}</div>
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

import { useState, useEffect, useCallback } from 'react';
import { AGENTS as MOCK_AGENTS, TOOLS, JURISDICTIONS, type Agent } from '@/lib/mock-data';
import { pushInjectedEvent } from '@/lib/local-audit';
import { X } from 'lucide-react';
import { Area, AreaChart, ResponsiveContainer } from 'recharts';
import { PETROL } from '@/lib/chart-colors';
import InfoTooltip from '@/components/InfoTooltip';
import {
  isApiAvailable, fetchAgents, fetchAgentActivity,
  type AgentInfo, type AgentActivityEntry,
} from '@/services/api';
import { useLang, type Lang } from '@/lib/i18n';

const T: Record<Lang, Record<string, string>> = {
  en: {
    agoS: '{n}s ago',
    agoM: '{n}m ago',
    agoH: '{n}h ago',
    agoD: '{n}d ago',
    identity: 'Identity',
    identityTip: 'Agent identity and configuration information.',
    identityNote: 'Each agent has a unique identity verified on every request. The auth method, PII mode, and rate limit are configured in bawaba.yaml.',
    rowAuth: 'Auth method',
    rowAuthTip: 'API key (bcrypt), Bearer (shared secret, pilot mode) or mTLS. OIDC/JWT planned P2.',
    rowPii: 'PII mode',
    rowRate: 'Rate limit',
    rateVal: '{n} req/hr',
    rowStatus: 'Status',
    rowCreated: 'Created',
    allowedTools: 'Allowed tools',
    allowedToolsTip: 'MCP tools this agent is authorized to call through the gateway.',
    allowedNote: 'Any call to a tool outside this list will be denied with a 403 code and logged in the audit trail.',
    deniedTools: 'Denied tools',
    deniedToolsTip: 'Tools explicitly denied for this agent. Any attempt is blocked and logged.',
    activity30: 'Activity (30 days)',
    activity30Tip: 'Daily call volume over the last 30 days.',
    recentActivity: 'Recent activity',
    statistics: 'Statistics',
    statisticsTip: 'Usage counters: calls today, cumulative total, and policy violations.',
    statToday: 'Today',
    statTotal: 'Total',
    statViolations: 'Violations',
    titleCreated: 'Agent created',
    titleAdd: 'Add agent',
    subCreated: 'Registered in the local demo registry',
    subAdd: 'Register a new agent (local demo)',
    succ1: ' is now in the registry with status ',
    succ2: ', and turns ',
    succ3: ' once the first heartbeat lands. An ',
    succ4: ' event was written to the audit chain.',
    apiKey: 'API key',
    apiKeyTip: 'Shown once. It is not stored in plaintext — only a bcrypt hash is kept server-side.',
    copyWarn: 'Copy this key now — it is displayed only once and cannot be retrieved later.',
    copyKey: 'Copy key',
    done: 'Done',
    agentName: 'Agent name',
    namePlaceholder: 'e.g. claude-analytics',
    keyNote1: 'A ',
    keyNote2: ' key is generated on creation and shown only once.',
    tools: 'Tools',
    toolsTip: 'Click a tool to cycle Off -> Allow -> Deny. Allow builds the allowlist, Deny the denylist. Anything left Off is denied by default.',
    piiNote: 'Tokenize is the only implemented mode. PII is replaced with UUID tokens held in a scoped vault.',
    rateLimitLabel: 'Rate limit (req/h)',
    allowedJur: 'Allowed jurisdictions',
    errName: 'Agent name is required.',
    createAgent: 'Create agent',
    cancel: 'Cancel',
    registry: 'Agent registry',
    registryTip: 'List of AI agents registered with the gateway. Each agent has its own permissions and limits.',
    agentsConnected: '{n} agents connected',
    addAgentBtn: 'Add agent',
    clickHint: 'Click an agent to see its full configuration, allowed tools, and activity history',
    hAgent: 'Agent',
    hAuth: 'Auth',
    hAuthTip: 'Authentication method: API key (bcrypt), Bearer (shared secret, pilot mode) or mTLS. OIDC/JWT planned P2.',
    hAllowed: 'Allowed tools',
    hAllowedTip: 'Allowlist of MCP tools this agent can call. Any off-list call → 403.',
    hDenied: 'Denied tools',
    hPii: 'PII mode',
    hPiiTip: 'PII handling strategy: tokenize (replace with UUID) or redact (remove).',
    hRate: 'Rate limit',
    hStatus: 'Status',
    hStatusTip: 'Active = authorized to send requests. Inactive = blocked immediately at auth level.',
    hLast: 'Last active',
    perHr: '{n}/hr',
    jur_ma: 'Morocco',
    jur_sa: 'KSA',
    jur_ae: 'UAE',
    jur_fr: 'France',
    jur_eu: 'EU',
  },
  fr: {
    agoS: 'il y a {n} s',
    agoM: 'il y a {n} min',
    agoH: 'il y a {n} h',
    agoD: 'il y a {n} j',
    identity: 'Identité',
    identityTip: 'Informations d’identité et de configuration de l’agent.',
    identityNote: 'Chaque agent possède une identité unique vérifiée à chaque requête. La méthode d’authentification, le mode PII et la limite de débit sont configurés dans bawaba.yaml.',
    rowAuth: 'Méthode d’auth',
    rowAuthTip: 'Clé API (bcrypt), Bearer (secret partagé, mode pilote) ou mTLS. OIDC/JWT prévu en P2.',
    rowPii: 'Mode PII',
    rowRate: 'Limite de débit',
    rateVal: '{n} req/h',
    rowStatus: 'Statut',
    rowCreated: 'Créé le',
    allowedTools: 'Outils autorisés',
    allowedToolsTip: 'Outils MCP que cet agent est autorisé à appeler via la passerelle.',
    allowedNote: 'Tout appel à un outil hors de cette liste sera refusé avec un code 403 et journalisé dans la piste d’audit.',
    deniedTools: 'Outils refusés',
    deniedToolsTip: 'Outils explicitement refusés pour cet agent. Toute tentative est bloquée et journalisée.',
    activity30: 'Activité (30 jours)',
    activity30Tip: 'Volume d’appels quotidien sur les 30 derniers jours.',
    recentActivity: 'Activité récente',
    statistics: 'Statistiques',
    statisticsTip: 'Compteurs d’usage : appels du jour, total cumulé et violations de politique.',
    statToday: 'Aujourd’hui',
    statTotal: 'Total',
    statViolations: 'Violations',
    titleCreated: 'Agent créé',
    titleAdd: 'Ajouter un agent',
    subCreated: 'Enregistré dans le registre local de démo',
    subAdd: 'Enregistrer un nouvel agent (démo locale)',
    succ1: ' figure désormais dans le registre avec le statut ',
    succ2: ', et passe à ',
    succ3: ' dès l’arrivée du premier heartbeat. Un événement ',
    succ4: ' a été écrit dans la chaîne d’audit.',
    apiKey: 'Clé API',
    apiKeyTip: 'Affichée une seule fois. Elle n’est pas stockée en clair — seul un hachage bcrypt est conservé côté serveur.',
    copyWarn: 'Copiez cette clé maintenant — elle n’est affichée qu’une seule fois et ne pourra pas être récupérée plus tard.',
    copyKey: 'Copier la clé',
    done: 'Terminé',
    agentName: 'Nom de l’agent',
    namePlaceholder: 'ex. claude-analytics',
    keyNote1: 'Une clé ',
    keyNote2: ' est générée à la création et affichée une seule fois.',
    tools: 'Outils',
    toolsTip: 'Cliquez sur un outil pour alterner Off -> Allow -> Deny. Allow construit la liste d’autorisation, Deny la liste de refus. Tout ce qui reste Off est refusé par défaut.',
    piiNote: 'Tokenize est le seul mode implémenté. Les PII sont remplacées par des tokens UUID conservés dans un coffre à portée limitée.',
    rateLimitLabel: 'Limite de débit (req/h)',
    allowedJur: 'Juridictions autorisées',
    errName: 'Le nom de l’agent est requis.',
    createAgent: 'Créer l’agent',
    cancel: 'Annuler',
    registry: 'Registre des agents',
    registryTip: 'Liste des agents IA enregistrés auprès de la passerelle. Chaque agent a ses propres permissions et limites.',
    agentsConnected: '{n} agents connectés',
    addAgentBtn: 'Ajouter un agent',
    clickHint: 'Cliquez sur un agent pour voir sa configuration complète, ses outils autorisés et son historique d’activité',
    hAgent: 'Agent',
    hAuth: 'Auth',
    hAuthTip: 'Méthode d’authentification : clé API (bcrypt), Bearer (secret partagé, mode pilote) ou mTLS. OIDC/JWT prévu en P2.',
    hAllowed: 'Outils autorisés',
    hAllowedTip: 'Liste d’autorisation des outils MCP que cet agent peut appeler. Tout appel hors liste → 403.',
    hDenied: 'Outils refusés',
    hPii: 'Mode PII',
    hPiiTip: 'Stratégie de traitement des PII : tokenize (remplacement par UUID) ou redact (suppression).',
    hRate: 'Limite de débit',
    hStatus: 'Statut',
    hStatusTip: 'Actif = autorisé à envoyer des requêtes. Inactif = bloqué immédiatement au niveau de l’authentification.',
    hLast: 'Dernière activité',
    perHr: '{n}/h',
    jur_ma: 'Maroc',
    jur_sa: 'Arabie saoudite',
    jur_ae: 'EAU',
    jur_fr: 'France',
    jur_eu: 'UE',
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
  const t = T[useLang()];
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
          <div className="table-header mb-3">{t.identity}<InfoTooltip text={t.identityTip} /></div>
          <div className="text-[10px] text-muted-foreground bg-muted/40 rounded p-2 mb-3">
            {t.identityNote}
          </div>
          <div className="space-y-2">
            {[
              ['auth', t.rowAuth, agent.auth],
              ['pii', t.rowPii, agent.piiMode],
              ['rate', t.rowRate, t.rateVal.replace('{n}', String(agent.rateLimit))],
              ['status', t.rowStatus, agent.status],
              ['created', t.rowCreated, agent.created.toLocaleDateString()],
            ].map(([id, k, v]) => (
              <div key={id} className="flex justify-between text-xs">
                <span className="text-muted-foreground">
                  {k}
                  {id === 'auth' && <InfoTooltip text={t.rowAuthTip} />}
                </span>
                <span className={`font-mono ${id === 'status' ? `status-${v}` : 'text-foreground'}`}>{v}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Capabilities */}
        <div>
          <div className="table-header mb-3">{t.allowedTools}<InfoTooltip text={t.allowedToolsTip} /></div>
          <div className="flex flex-wrap gap-1.5">
            {agent.allowedTools.map(t => (
              <span key={t} className="text-[10px] font-mono px-2 py-1 bg-safe-bg text-safe border border-safe/10 rounded-sm">{t}</span>
            ))}
          </div>
          <div className="text-[10px] text-muted-foreground bg-muted/40 rounded p-2 mt-2">
            {t.allowedNote}
          </div>
          <div className="table-header mb-3 mt-4">{t.deniedTools}<InfoTooltip text={t.deniedToolsTip} /></div>
          <div className="flex flex-wrap gap-1.5">
            {agent.deniedTools.map(t => (
              <span key={t} className="text-[10px] font-mono px-2 py-1 bg-danger-bg text-danger border border-danger/10 rounded-sm">{t}</span>
            ))}
          </div>
        </div>

        {/* Activity Graph */}
        <div>
          <div className="table-header mb-3">{t.activity30}<InfoTooltip text={t.activity30Tip} /></div>
          <div className="h-24">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={activityData} margin={{ top: 0, right: 0, left: 0, bottom: 0 }}>
                <Area type="monotone" dataKey="calls" stroke={PETROL} strokeWidth={1} fill={PETROL} fillOpacity={0.1} dot={false} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Recent Activity from API */}
        {apiAvailable && activity.length > 0 && (
          <div>
            <div className="table-header mb-3">{t.recentActivity}</div>
            <div className="space-y-0 border border-border rounded-sm overflow-hidden">
              {activity.slice(0, 10).map(entry => (
                <div key={entry.event_id} className="data-row flex items-center justify-between px-3 py-2 text-sm font-data tabular-nums border-b border-border last:border-0">
                  <span className="text-muted-foreground">{timeAgo(new Date(entry.timestamp), t)}</span>
                  <span className="text-ink-2 truncate mx-2">{entry.tool}</span>
                  <span className={`pill ${entry.policy_result === 'allow' ? 'pill-allow' : 'pill-deny'}`}>{entry.policy_result}</span>
                  <span className="text-muted-foreground">{entry.latency_ms}ms</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Stats */}
        <div>
          <div className="table-header mb-3">{t.statistics}<InfoTooltip text={t.statisticsTip} /></div>
          <div className="grid grid-cols-3 gap-3">
            {[
              [t.statToday, agent.callsToday.toLocaleString()],
              [t.statTotal, agent.callsTotal.toLocaleString()],
              [t.statViolations, agent.violations.toString()],
            ].map(([label, val]) => (
              <div key={label} className="p-3 bg-background border border-border rounded-sm text-center">
                <div className="text-xl font-data tabular-nums font-normal text-foreground">{val}</div>
                <div className="text-[11px] text-muted-foreground mt-1">{label}</div>
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
  const t = T[useLang()];
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
      setError(t.errName);
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
          <div className="text-lg font-heading text-foreground">{createdKey ? t.titleCreated : t.titleAdd}</div>
          <div className="text-xs text-muted-foreground font-mono">
            {createdKey ? t.subCreated : t.subAdd}
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
            <span className="font-mono">{name.trim()}</span>{t.succ1}
            <span className="status-pending font-mono">pending</span>{t.succ2}
            <span className="status-healthy font-mono">healthy</span>{t.succ3}
            <span className="font-mono">agent_registered</span>{t.succ4}
          </div>
          <div>
            <div className="table-header mb-1.5">{t.apiKey}<InfoTooltip text={t.apiKeyTip} /></div>
            <div className="font-mono text-xs text-foreground break-all bg-secondary/20 rounded-sm p-2 border border-border">{createdKey}</div>
            <div className="text-[10px] text-warn bg-warn-bg border border-warn/10 rounded p-2 mt-1.5">
              {t.copyWarn}
            </div>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => navigator.clipboard?.writeText(createdKey)}
              className="text-xs font-body px-3 py-2 border border-border rounded-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              {t.copyKey}
            </button>
            <button
              onClick={onClose}
              className="text-xs font-body font-medium px-4 py-2 bg-primary text-primary-foreground rounded-sm hover:opacity-90 transition-opacity"
            >
              {t.done}
            </button>
          </div>
        </div>
      ) : (
        /* ── Form view ── */
        <div className="p-5 space-y-6">
          {/* Name */}
          <div>
            <div className="table-header mb-2">{t.agentName}</div>
            <input
              value={name}
              onChange={e => { setName(e.target.value); setError(null); }}
              placeholder={t.namePlaceholder}
              className="w-full text-xs font-mono px-3 py-2 border border-border rounded-sm bg-background text-foreground placeholder:text-ink-4 focus:outline-none focus:border-primary"
            />
          </div>

          {/* Auth method */}
          <div>
            <div className="table-header mb-2">{t.rowAuth}</div>
            <div className="text-xs font-mono text-foreground bg-secondary/20 border border-border rounded-sm px-3 py-2">API key (bcrypt)</div>
            <div className="text-[10px] text-muted-foreground bg-muted/40 rounded p-2 mt-1.5">
              {t.keyNote1}<span className="font-mono">baw_…</span>{t.keyNote2}
            </div>
          </div>

          {/* Allowed / Denied tools */}
          <div>
            <div className="table-header mb-2">{t.tools}<InfoTooltip text={t.toolsTip} /></div>
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
            <div className="table-header mb-2">{t.rowPii}</div>
            <div className="text-xs font-mono text-foreground bg-secondary/20 border border-border rounded-sm px-3 py-2">tokenize</div>
            <div className="text-[10px] text-muted-foreground bg-muted/40 rounded p-2 mt-1.5">
              {t.piiNote}
            </div>
          </div>

          {/* Rate limit */}
          <div>
            <div className="table-header mb-2">{t.rateLimitLabel}</div>
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
            <div className="table-header mb-2">{t.allowedJur}</div>
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
                  {j.code.toUpperCase()} · {t[`jur_${j.code}`] ?? j.name}
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
              {t.createAgent}
            </button>
            <button
              onClick={onClose}
              className="text-xs font-body px-4 py-2 border border-border rounded-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              {t.cancel}
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
        <div key={i} className="data-row grid grid-cols-[150px_92px_1fr_1fr_76px_76px_108px_100px] gap-2 px-5 py-3 border-b border-border">
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
  const t = T[useLang()];
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
            <div className="text-sm font-body font-medium text-foreground">{t.registry}<InfoTooltip text={t.registryTip} /></div>
            <div className="text-xs text-muted-foreground">{t.agentsConnected.replace('{n}', String(agents.length))}</div>
          </div>
        </div>
        <button
          onClick={() => { setSelectedAgent(null); setShowAdd(true); }}
          className="text-xs font-body font-medium px-4 py-2 bg-primary text-primary-foreground rounded-sm hover:opacity-90 transition-opacity"
        >
          {t.addAgentBtn}
        </button>
      </div>

      <div className="text-[10px] text-muted-foreground font-body mb-2">{t.clickHint}</div>

      <div className="card-surface shadow-card overflow-hidden zebra">
        {/* Table header */}
        <div className="grid grid-cols-[150px_92px_1fr_1fr_76px_76px_108px_100px] gap-2 px-5 py-3 border-b border-border">
          <span className="table-header">{t.hAgent}</span>
          <span className="table-header">{t.hAuth}<InfoTooltip text={t.hAuthTip} /></span>
          <span className="table-header">{t.hAllowed}<InfoTooltip text={t.hAllowedTip} /></span>
          <span className="table-header">{t.hDenied}<InfoTooltip text={t.deniedToolsTip} /></span>
          <span className="table-header">{t.hPii}<InfoTooltip text={t.hPiiTip} /></span>
          <span className="table-header">{t.hRate}</span>
          <span className="table-header">{t.hStatus}<InfoTooltip text={t.hStatusTip} /></span>
          <span className="table-header">{t.hLast}</span>
        </div>

        {/* Rows */}
        {loading ? (
          <AgentTableSkeleton />
        ) : (
          agents.map(agent => (
            <div
              key={agent.id}
              onClick={() => setSelectedAgent(agent)}
              className="data-row grid grid-cols-[150px_92px_1fr_1fr_76px_76px_108px_100px] gap-2 px-5 py-3 border-b border-border last:border-0 cursor-pointer hover:bg-secondary/30 transition-colors"
            >
              <span className="text-sm text-foreground truncate">{agent.name}</span>
              <span className="text-sm text-muted-foreground">{agent.auth}</span>
              <div className="flex flex-wrap gap-1 items-center">
                {agent.allowedTools.map(t => (
                  <span key={t} className="text-[11px] font-data px-1.5 py-0.5 bg-safe-bg text-safe rounded-sm">{t}</span>
                ))}
              </div>
              <div className="flex flex-wrap gap-1 items-center">
                {agent.deniedTools.map(t => (
                  <span key={t} className="text-[11px] font-data px-1.5 py-0.5 bg-danger-bg text-danger rounded-sm">{t}</span>
                ))}
              </div>
              <span className="text-sm font-data tabular-nums text-muted-foreground">{agent.piiMode}</span>
              <span className="text-sm font-data tabular-nums text-muted-foreground">{t.perHr.replace('{n}', String(agent.rateLimit))}</span>
              <span>
                <span className={`pill ${agent.status === 'healthy' ? 'pill-allow' : agent.status === 'rate-limited' ? 'pill-rate' : agent.status === 'blocked' ? 'pill-deny' : 'pill-neutral'}`}>{agent.status}</span>
              </span>
              <span className="text-sm text-muted-foreground">
                {timeAgo(agent.lastActive, t)}
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

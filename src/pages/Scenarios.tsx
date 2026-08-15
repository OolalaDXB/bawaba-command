import { useState } from 'react';
import {
  createAgent,
  deleteAgent,
  fetchEvents,
  isApiAvailable,
  postEventReview,
  runMcpToolCall,
  verifyChain,
  type ApiEvent,
} from '@/services/api';
import { Button } from '@/components/ui/button';
import { useEffect } from 'react';
import { resolveAgent, activeWorkspace } from '@/lib/demoWorkspace';
import { SouffleurExplain } from '@/components/SouffleurExplain';
import { useLang, type Lang } from '@/lib/i18n';

/**
 * Scenarios (P1, demo mandate §5/§9): really-triggerable flows on the live
 * engine — tool DENY, PII tokenization, jurisdiction fail-closed, rate
 * limit, conditional amount envelope — each ending with a real Verify.
 * No mock path: stack down → the page says so and stops.
 */

const T: Record<Lang, Record<string, string>> = {
  en: {
    checking: 'Checking the gateway…',
    downTitle: 'The live stack is not running',
    downBody: 'Scenarios only trigger REAL flows — nothing is simulated. Start the stack, then reload:',
    h1: 'Scenarios',
    intro: 'Each button triggers a REAL flow through the gateway; each card ends with a real server-side chain verification. Nothing here is simulated.',
    wsLine: 'Private workspace {id}: payment/finance scenarios run on YOUR clones (PII, jurisdiction and rate-limit scenarios use the shared seeded agents).',
    piiEntities: '{n} PII entities',
    btnVerifyChain: 'Verify chain',
    chainValid: 'CHAIN VALID — {n} events',
    chainInvalid: 'CHAIN INVALID — {err}',
    noEventYet: 'No event surfaced (yet).',
    card1Title: '1 · Policy denial by tool',
    card1Desc: 'payment-assistant calls execute_payment, which its policy denies (unless you allowed it in the Guided Demo — the matched_rule tells you which).',
    card1Action: 'Trigger the call',
    card2Title: '2 · PII tokenization',
    card2Desc: 'test-agent echoes a payload containing a real-format IBAN and email; the Rust tokenizer detects and tokenizes them before anything else sees the data.',
    card2Action: 'Send PII payload',
    card3Title: '3 · Jurisdiction fail-closed',
    card3Desc: "apac-analyst is configured with jurisdiction 'sg', which has NO routing rule. BAWABA refuses to route rather than guess — fail closed.",
    card3Action: 'Trigger the call',
    card3Note: 'The gateway rejected the call before any tool ran (JSON-RPC jurisdiction error) — fail closed.',
    card4Title: '4 · Rate limit',
    card4Desc: 'burst-agent is capped at 5 calls/minute. Fire 8 echo calls and watch the sliding window cut in.',
    card4Action: 'Fire 8 calls',
    card4Note: 'rate_limit events mark the cut-off; earlier calls passed.',
    card5Title: '5 · Conditional amount envelope (REAL engine)',
    card5Desc: 'finance-analyst-eu may execute_payment only within: amount ≤ 10 000, EUR, jurisdiction eu. 25 000 EUR falls outside — the failed condition is named in matched_rule.',
    card5Action: 'Try 25 000 then 9 000 EUR',
    card6Title: '6 · Human review',
    card6Desc: 'Acknowledge the most recent event for finance-analyst-eu — the review is recorded against the real event.',
    card6Action: 'Acknowledge latest',
    card6Err: 'Run scenario 5 first — no event to review.',
    card6Note: 'acknowledged {id}',
    crudTitle: 'Control-plane CRUD (P1)',
    crudDesc: 'Create a real agent (persisted in PostgreSQL, credentials generated server-side, creation audit-logged) — then delete it. Every change lands in the append-only policy_versions history.',
    crudCreate: 'Create agent',
    crudDelete: 'Delete it',
    crudDeleted: 'Agent {id} deleted (soft — history and audit events preserved).',
    crudKeyOnce: '(shown ONCE — only its hash is stored)',
  },
  fr: {
    checking: 'Vérification de la passerelle…',
    downTitle: 'La stack n’est pas démarrée',
    downBody: 'Les scénarios ne déclenchent que des flux RÉELS — rien n’est simulé. Démarrez la stack, puis rechargez :',
    h1: 'Scénarios',
    intro: 'Chaque bouton déclenche un flux RÉEL à travers la passerelle ; chaque carte se conclut par une vérification de chaîne réelle, côté serveur. Rien ici n’est simulé.',
    wsLine: 'Espace privé {id} : les scénarios paiement/finance s’exécutent sur VOS clones (les scénarios PII, juridiction et rate-limit utilisent les agents partagés pré-provisionnés).',
    piiEntities: '{n} entités PII',
    btnVerifyChain: 'Vérifier la chaîne',
    chainValid: 'CHAÎNE VALIDE — {n} événements',
    chainInvalid: 'CHAÎNE INVALIDE — {err}',
    noEventYet: 'Aucun événement remonté (pour l’instant).',
    card1Title: '1 · Refus de politique par outil',
    card1Desc: 'payment-assistant appelle execute_payment, que sa politique refuse (sauf si vous l’avez autorisé dans la Démo guidée — matched_rule vous l’indique).',
    card1Action: 'Déclencher l’appel',
    card2Title: '2 · Tokenisation PII',
    card2Desc: 'test-agent renvoie une charge utile contenant un IBAN au format réel et un e-mail ; le tokeniseur Rust les détecte et les tokenise avant que quoi que ce soit d’autre ne voie les données.',
    card2Action: 'Envoyer la charge PII',
    card3Title: '3 · Juridiction fail-closed',
    card3Desc: 'apac-analyst est configuré avec la juridiction « sg », qui n’a AUCUNE règle de routage. BAWABA refuse de router plutôt que de deviner — fail closed.',
    card3Action: 'Déclencher l’appel',
    card3Note: 'La passerelle a rejeté l’appel avant l’exécution de tout outil (erreur de juridiction JSON-RPC) — fail closed.',
    card4Title: '4 · Limitation de débit',
    card4Desc: 'burst-agent est plafonné à 5 appels/minute. Lancez 8 appels echo et regardez la fenêtre glissante intervenir.',
    card4Action: 'Lancer 8 appels',
    card4Note: 'Les événements rate_limit marquent la coupure ; les appels précédents sont passés.',
    card5Title: '5 · Enveloppe conditionnelle de montant (moteur RÉEL)',
    card5Desc: 'finance-analyst-eu ne peut appeler execute_payment que dans : montant ≤ 10 000, EUR, juridiction eu. 25 000 EUR tombe en dehors — la condition en échec est nommée dans matched_rule.',
    card5Action: 'Essayer 25 000 puis 9 000 EUR',
    card6Title: '6 · Revue humaine',
    card6Desc: 'Acquittez l’événement le plus récent de finance-analyst-eu — la revue est enregistrée sur l’événement réel.',
    card6Action: 'Acquitter le dernier',
    card6Err: 'Exécutez d’abord le scénario 5 — aucun événement à examiner.',
    card6Note: 'acquitté {id}',
    crudTitle: 'CRUD du plan de contrôle (P1)',
    crudDesc: 'Créez un agent réel (persisté dans PostgreSQL, identifiants générés côté serveur, création journalisée dans l’audit) — puis supprimez-le. Chaque changement atterrit dans l’historique append-only policy_versions.',
    crudCreate: 'Créer l’agent',
    crudDelete: 'Le supprimer',
    crudDeleted: 'Agent {id} supprimé (soft — historique et événements d’audit conservés).',
    crudKeyOnce: '(affichée UNE SEULE fois — seul son hachage est stocké)',
  },
};

const KEYS: Record<string, string> = {
  'payment-assistant': 'payment-key-33333',
  'finance-analyst-eu': 'finance-key-44444',
  'burst-agent': 'burst-key-55555',
  'apac-analyst': 'apac-key-66666',
  'test-agent': 'test-key-12345',
};

interface RunOutcome {
  label: string;
  events: ApiEvent[];
  note?: string;
}

async function latestEvents(agent: string, notBefore: string, max = 3): Promise<ApiEvent[]> {
  for (let i = 0; i < 20; i++) {
    const res = await fetchEvents(1, 10, { agent });
    const hits = res.events.filter(e => e.timestamp > notBefore);
    if (hits.length > 0) return hits.slice(0, max);
    await new Promise(r => setTimeout(r, 400));
  }
  return [];
}

function EventLine({ e }: { e: ApiEvent }) {
  const t = T[useLang()];
  const deny = e.policy_result === 'deny';
  return (
    <div className="py-1 border-b border-border/60 last:border-0">
      <div className="flex items-baseline gap-3 text-xs font-mono">
        <span className={`uppercase px-1.5 rounded-[3px] ${deny ? 'bg-danger-bg text-danger' : 'bg-safe-bg text-safe'}`}>{e.policy_result || e.event_type}</span>
        <span className="text-ink-2">{e.event_type}</span>
        <span>{e.tool}</span>
        <span className="text-ink-3 truncate">{e.matched_rule}</span>
        {e.entities_detected > 0 && <span className="text-primary">{t.piiEntities.replace('{n}', String(e.entities_detected))}</span>}
      </div>
      <SouffleurExplain eventId={e.event_id} />
    </div>
  );
}

function ScenarioCard({
  title, description, action, run,
}: {
  title: string; description: string; action: string;
  run: () => Promise<RunOutcome>;
}) {
  const t = T[useLang()];
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<RunOutcome | null>(null);
  const [verify, setVerify] = useState<{ ok: boolean; text: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const trigger = async () => {
    setBusy(true); setError(null); setVerify(null);
    try { setOutcome(await run()); } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    setBusy(false);
  };
  const doVerify = async () => {
    setBusy(true);
    try {
      const v = await verifyChain();
      setVerify(v.valid
        ? { ok: true, text: t.chainValid.replace('{n}', String(v.events)) }
        : { ok: false, text: t.chainInvalid.replace('{err}', String(v.error)) });
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    setBusy(false);
  };

  return (
    <div className="border border-border bg-card rounded-[6px] p-5">
      <div className="text-sm font-medium text-foreground mb-1">{title}</div>
      <p className="text-xs text-ink-3 leading-relaxed mb-3">{description}</p>
      <div className="flex gap-2 mb-3">
        <Button size="sm" onClick={trigger} disabled={busy}>{action}</Button>
        {outcome && <Button size="sm" variant="outline" onClick={doVerify} disabled={busy}>{t.btnVerifyChain}</Button>}
      </div>
      {error && <div className="text-xs text-danger mb-2">{error}</div>}
      {outcome && (
        <div className="bg-background border border-border rounded-[4px] px-3 py-1">
          {outcome.events.length === 0 && <div className="text-xs text-ink-3 py-1">{t.noEventYet}</div>}
          {outcome.events.map(e => <EventLine key={e.event_id} e={e} />)}
          {outcome.note && <div className="text-[11px] text-ink-3 py-1">{outcome.note}</div>}
        </div>
      )}
      {verify && <div className={`mt-2 text-xs font-mono ${verify.ok ? 'text-safe' : 'text-danger'}`}>{verify.text}</div>}
    </div>
  );
}

function CrudPanel() {
  const t = T[useLang()];
  const [agentId, setAgentId] = useState('');
  const [created, setCreated] = useState<{ agent_id: string; api_key: string } | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const create = async () => {
    setBusy(true); setMsg(null);
    try {
      const res = await createAgent({ agent_id: agentId.trim(), allowed_tools: ['echo'], denied_tools: ['shell'], jurisdiction: 'eu' });
      setCreated(res);
      setMsg(null);
    } catch (e) { setMsg(e instanceof Error ? e.message : String(e)); }
    setBusy(false);
  };
  const remove = async () => {
    if (!created) return;
    setBusy(true);
    try {
      await deleteAgent(created.agent_id);
      setMsg(t.crudDeleted.replace('{id}', created.agent_id));
      setCreated(null);
    } catch (e) { setMsg(e instanceof Error ? e.message : String(e)); }
    setBusy(false);
  };

  return (
    <div className="border border-border bg-card rounded-[6px] p-5">
      <div className="text-sm font-medium text-foreground mb-1">{t.crudTitle}</div>
      <p className="text-xs text-ink-3 leading-relaxed mb-3">
        {t.crudDesc}
      </p>
      <div className="flex gap-2 items-center mb-3">
        <input
          value={agentId}
          onChange={e => setAgentId(e.target.value)}
          placeholder="new-agent-id (kebab-case)"
          className="border border-border rounded-[4px] bg-background px-2 py-1 text-xs font-mono w-56"
        />
        <Button size="sm" onClick={create} disabled={busy || !agentId.trim()}>{t.crudCreate}</Button>
        {created && <Button size="sm" variant="outline" onClick={remove} disabled={busy}>{t.crudDelete}</Button>}
      </div>
      {created && (
        <div className="text-xs font-mono bg-background border border-border rounded-[4px] p-2 break-all">
          agent_id: {created.agent_id}<br />api_key {t.crudKeyOnce}: {created.api_key}
        </div>
      )}
      {msg && <div className="text-xs text-ink-2 mt-2">{msg}</div>}
    </div>
  );
}

export default function Scenarios() {
  const t = T[useLang()];
  // Workspace-aware: the payment/finance scenarios run on YOUR clones when a
  // private workspace is active; the shared seeded agents otherwise.
  const pa = resolveAgent('payment-assistant', 'payment-assistant', KEYS['payment-assistant']);
  const fin = resolveAgent('finance-analyst-eu', 'finance-analyst-eu', KEYS['finance-analyst-eu']);
  const [stackUp, setStackUp] = useState<boolean | null>(null);
  useEffect(() => { isApiAvailable().then(setStackUp); }, []);

  if (stackUp === null) return <div className="p-10 text-sm text-ink-3">{t.checking}</div>;
  if (!stackUp) {
    return (
      <div className="max-w-xl mx-auto mt-20 border border-border bg-card rounded-[6px] p-8 text-sm">
        <div className="text-base font-medium text-foreground mb-2">{t.downTitle}</div>
        <p className="text-ink-2 mb-3">{t.downBody}</p>
        <pre className="bg-muted rounded-[4px] p-3 font-mono text-xs">docker compose up --build -d</pre>
      </div>
    );
  }

  const stamp = () => new Date().toISOString();

  return (
    <div className="max-w-4xl mx-auto px-6 py-8">
      <h1 className="text-lg font-medium text-foreground mb-1">{t.h1}</h1>
      <p className="text-xs text-ink-3 mb-2">
        {t.intro}
      </p>
      {activeWorkspace() ? (
        <div className="text-xs font-mono text-primary mb-6">
          {t.wsLine.replace('{id}', activeWorkspace()!.session_id)}
        </div>
      ) : (
        <div className="mb-6" />
      )}

      <div className="grid md:grid-cols-2 gap-4">
        <ScenarioCard
          title={t.card1Title}
          description={t.card1Desc}
          action={t.card1Action}
          run={async () => {
            const t0 = stamp();
            await runMcpToolCall(pa.apiKey, 'execute_payment', { invoice_id: 'INV-7', amount: 100, currency: 'EUR' });
            return { label: 'deny', events: await latestEvents(pa.agentId, t0) };
          }}
        />
        <ScenarioCard
          title={t.card2Title}
          description={t.card2Desc}
          action={t.card2Action}
          run={async () => {
            const t0 = stamp();
            await runMcpToolCall(KEYS['test-agent'], 'echo', {
              message: "Customer IBAN MA64011519000001205000534921, contact sara@example.ma",
            });
            return { label: 'pii', events: await latestEvents('test-agent', t0) };
          }}
        />
        <ScenarioCard
          title={t.card3Title}
          description={t.card3Desc}
          action={t.card3Action}
          run={async () => {
            const t0 = stamp();
            try {
              await runMcpToolCall(KEYS['apac-analyst'], 'echo', { message: 'hello' });
            } catch { /* the gateway rejects — that IS the scenario */ }
            const events = await latestEvents('apac-analyst', t0);
            return {
              label: 'jurisdiction',
              events,
              note: events.length === 0 ? t.card3Note : undefined,
            };
          }}
        />
        <ScenarioCard
          title={t.card4Title}
          description={t.card4Desc}
          action={t.card4Action}
          run={async () => {
            const t0 = stamp();
            for (let i = 0; i < 8; i++) {
              try { await runMcpToolCall(KEYS['burst-agent'], 'echo', { message: `burst ${i}` }); } catch { /* 429s expected */ }
            }
            const events = await latestEvents('burst-agent', t0, 8);
            return { label: 'rate', events, note: t.card4Note };
          }}
        />
        <ScenarioCard
          title={t.card5Title}
          description={t.card5Desc}
          action={t.card5Action}
          run={async () => {
            const t0 = stamp();
            await runMcpToolCall(fin.apiKey, 'execute_payment', { amount: 25000, currency: 'EUR' });
            await runMcpToolCall(fin.apiKey, 'execute_payment', { amount: 9000, currency: 'EUR' });
            return { label: 'conditional', events: await latestEvents(fin.agentId, t0, 2) };
          }}
        />
        <ScenarioCard
          title={t.card6Title}
          description={t.card6Desc}
          action={t.card6Action}
          run={async () => {
            const res = await fetchEvents(1, 1, { agent: fin.agentId });
            const evt = res.events[0];
            if (!evt) throw new Error(t.card6Err);
            await postEventReview(evt.event_id, 'acknowledge', 'scenario-visitor');
            return { label: 'review', events: [evt], note: t.card6Note.replace('{id}', evt.event_id) };
          }}
        />
      </div>

      <div className="mt-6">
        <CrudPanel />
      </div>
    </div>
  );
}

import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  fetchPolicies,
  isApiAvailable,
  patchPolicy,
  postEventReview,
  runMcpToolCall,
  fetchEvents,
  verifyChain,
  type ApiEvent,
  type ChainVerification,
  type PolicyEntry,
} from '@/services/api';
import { Button } from '@/components/ui/button';
import { resolveAgent, activeWorkspace } from '@/lib/demoWorkspace';
import { SouffleurExplain } from '@/components/SouffleurExplain';
import { useLang, type Lang } from '@/lib/i18n';

/**
 * Guided Demo (P0) — a narrated path over the REAL engine (demo mandate §3).
 * Every value on screen is read from real API responses and real audit
 * events; matched_rule and policy_result are rendered VERBATIM, never
 * paraphrased. There is NO mock fallback here: if the stack is down, the
 * demo says so and stops. Honesty is the feature.
 */

const DENIED_TOOL = 'execute_payment';

const T: Record<Lang, Record<string, string>> = {
  en: {
    checking: 'Checking the gateway…',
    downTitle: 'The live stack is not running',
    downBody: 'The Guided Demo only shows REAL decisions signed by the running gateway — it never simulates. Start the stack, then reload:',
    back: '← Back',
    crumb: 'Guided Demo · real engine, real signatures · ',
    exit: 'exit',
    h1: 'Follow one agent decision, end to end',
    wsLine: 'Private workspace {id} — your edits touch YOUR agents only; everything expires at {time}.',
    stepLabel: 'Step {n}',
    s1Title: 'Meet the agent',
    s1Body: ' handles supplier invoices. Like any AI agent, it acts through tools — and every tool call passes through BAWABA before anything happens.',
    btnShowPolicy: 'Show me its policy',
    s2Title: 'See its real policy',
    s2Intro: 'This is the live policy the engine will enforce — read from the running gateway, not a slide:',
    empty: '(empty)',
    btnGotIt: 'Got it',
    s3Title: 'Ask it to do something forbidden',
    s3a: "Let's have the agent try ",
    s3b: ' — a tool its policy explicitly denies. This posts a REAL MCP call to the gateway.',
    btnCalling: 'Calling the gateway…',
    btnRunDenied: 'Run execute_payment',
    s4Title: 'BAWABA decides: DENY',
    s4Body: 'The deterministic engine refused the call before anything executed. No LLM decided this.',
    s5Title: 'The real why — no paraphrase',
    s5a: 'These fields come verbatim from the signed decision record — the rule that matched is ',
    s5colon: ':',
    cardDecision: 'Decision record',
    btnChangeRule: 'Now let me change the rule',
    s6Title: 'Edit the REAL policy',
    s6a: 'Move ',
    s6b: ' from denied to allowed. This is a real mutation: the engine updates live, and the edit itself is recorded as a signed ',
    s6c: ' event in the audit chain.',
    btnApplying: 'Applying…',
    btnAllow: 'Allow execute_payment',
    s6Note: 'In-memory for this demo — a restart restores the original policy.',
    s7Title: 'Run it again',
    s7Body: 'Same agent, same tool, same request — only the policy changed.',
    btnRunAgain: 'Run execute_payment again',
    s8Title: 'BAWABA decides: ALLOW',
    s8Body: 'The same deterministic engine, applying the policy you just wrote.',
    s9Title: 'Both decisions, side by side',
    cardBefore: 'Before your edit',
    cardAfter: 'After your edit',
    s9Note: 'Note the policy_version changed, and each event chains to the previous one via prev_hash.',
    btnProve: 'Prove it',
    s10Title: 'Verify the evidence',
    s10Body: 'Ask the server to replay the ENTIRE audit chain — every hash link and every Ed25519 signature, including your two decisions and your policy edit.',
    btnVerifying: 'Verifying…',
    btnVerify: 'Verify audit chain',
    chainValidAt: 'CHAIN VALID — {n} events verified at {at}',
    chainInvalid: 'CHAIN INVALID — {err}',
    s11Title: 'Human review',
    s11Body: 'Decisions stay reviewable by humans. Acknowledge the ALLOW event — or escalate it if the payment should have stayed blocked.',
    btnAck: 'Acknowledge',
    btnEsc: 'Escalate',
    s11a: 'Recorded: ',
    s11b: ". That's the whole loop — policy, decision, evidence, verification, human oversight. All real.",
    linkRoom: 'Open the Control Room →',
    ch2Crumb: 'Chapter 2 · Conditional policy (real attribute engine)',
    ch2H: 'Beyond allow/deny: a payment limit',
    ch2a: ' may execute payments only inside a real conditional envelope: amount ≤ 10 000, currency EUR, jurisdiction EU. The engine evaluates the ACTUAL call arguments — the failed condition is named in ',
    ch2You: 'Here YOU issue the exact MCP call an AI agent would issue in production — same bytes, same gateway. The engine judges the call, never the caller: it neither knows nor needs to know whether an AI or a human is behind it.',
    btnTry25: 'Try 25 000 EUR',
    btnTryCustom: 'Try this amount',
    amountLabel: 'Your amount (EUR)',
    cardCustom: '{amount} EUR — the engine decides',
    btnTry9: 'Try 9 000 EUR',
    btnVerifyChain: 'Verify chain',
    card25: '25 000 EUR — outside the envelope',
    card9: '9 000 EUR — inside the envelope',
    chainValid: 'CHAIN VALID — {n} events',
    errNoEvent: 'No event surfaced from the gateway within 8s — is the stack healthy?',
    errNotSeeded: 'Agent "{id}" is not seeded — pull latest main and restart the stack.',
    errExpectedAllow: 'Expected ALLOW after the edit, the engine said "{result}" — check the policy state.',
    errNoEvent2: 'No event surfaced within 8s.',
  },
  fr: {
    checking: 'Vérification de la passerelle…',
    downTitle: 'La stack n’est pas démarrée',
    downBody: 'La Démo guidée ne montre que des décisions RÉELLES signées par la passerelle en cours d’exécution — elle ne simule jamais. Démarrez la stack, puis rechargez :',
    back: '← Retour',
    crumb: 'Démo guidée · moteur réel, signatures réelles · ',
    exit: 'quitter',
    h1: 'Suivez une décision d’agent, de bout en bout',
    wsLine: 'Espace privé {id} — vos modifications ne touchent que VOS agents ; tout expire à {time}.',
    stepLabel: 'Étape {n}',
    s1Title: 'Rencontrez l’agent',
    s1Body: ' traite les factures fournisseurs. Comme tout agent IA, il agit via des outils — et chaque appel d’outil passe par BAWABA avant que quoi que ce soit ne s’exécute.',
    btnShowPolicy: 'Montrez-moi sa politique',
    s2Title: 'Voir sa politique réelle',
    s2Intro: 'Voici la politique vivante que le moteur va appliquer — lue depuis la passerelle en cours d’exécution, pas depuis une diapositive :',
    empty: '(vide)',
    btnGotIt: 'Compris',
    s3Title: 'Demandez-lui quelque chose d’interdit',
    s3a: 'Demandons à l’agent d’appeler ',
    s3b: ' — un outil que sa politique refuse explicitement. Ceci envoie un appel MCP RÉEL à la passerelle.',
    btnCalling: 'Appel de la passerelle…',
    btnRunDenied: 'Exécuter execute_payment',
    s4Title: 'BAWABA décide : DENY',
    s4Body: 'Le moteur déterministe a refusé l’appel avant toute exécution. Aucun LLM n’a pris cette décision.',
    s5Title: 'Le vrai pourquoi — sans paraphrase',
    s5a: 'Ces champs proviennent, mot pour mot, de l’enregistrement de décision signé — la règle qui a correspondu est ',
    s5colon: ' :',
    cardDecision: 'Enregistrement de décision',
    btnChangeRule: 'Modifier la règle maintenant',
    s6Title: 'Modifiez la VRAIE politique',
    s6a: 'Déplacez ',
    s6b: ' de refusé vers autorisé. Il s’agit d’une mutation réelle : le moteur se met à jour en direct, et la modification elle-même est enregistrée comme un événement ',
    s6c: ' signé dans la chaîne d’audit.',
    btnApplying: 'Application…',
    btnAllow: 'Autoriser execute_payment',
    s6Note: 'En mémoire pour cette démo — un redémarrage restaure la politique d’origine.',
    s7Title: 'Relancez l’appel',
    s7Body: 'Même agent, même outil, même requête — seule la politique a changé.',
    btnRunAgain: 'Exécuter execute_payment à nouveau',
    s8Title: 'BAWABA décide : ALLOW',
    s8Body: 'Le même moteur déterministe, appliquant la politique que vous venez d’écrire.',
    s9Title: 'Les deux décisions, côte à côte',
    cardBefore: 'Avant votre modification',
    cardAfter: 'Après votre modification',
    s9Note: 'Notez que policy_version a changé, et que chaque événement se chaîne au précédent via prev_hash.',
    btnProve: 'Prouvez-le',
    s10Title: 'Vérifiez la preuve',
    s10Body: 'Demandez au serveur de rejouer TOUTE la chaîne d’audit — chaque lien de hachage et chaque signature Ed25519, y compris vos deux décisions et votre modification de politique.',
    btnVerifying: 'Vérification…',
    btnVerify: 'Vérifier la chaîne d’audit',
    chainValidAt: 'CHAÎNE VALIDE — {n} événements vérifiés à {at}',
    chainInvalid: 'CHAÎNE INVALIDE — {err}',
    s11Title: 'Revue humaine',
    s11Body: 'Les décisions restent révisables par des humains. Acquittez l’événement ALLOW — ou escaladez-le si le paiement aurait dû rester bloqué.',
    btnAck: 'Acquitter',
    btnEsc: 'Escalader',
    s11a: 'Enregistré : ',
    s11b: '. Voilà la boucle complète — politique, décision, preuve, vérification, supervision humaine. Le tout réel.',
    linkRoom: 'Ouvrir la Salle de contrôle →',
    ch2Crumb: 'Chapitre 2 · Politique conditionnelle (moteur d’attributs réel)',
    ch2H: 'Au-delà d’allow/deny : un plafond de paiement',
    ch2a: ' ne peut exécuter des paiements que dans une enveloppe conditionnelle réelle : montant ≤ 10 000, devise EUR, juridiction UE. Le moteur évalue les arguments RÉELS de l’appel — la condition en échec est nommée dans ',
    ch2You: 'Ici, c’est VOUS qui émettez l’appel MCP exact qu’un agent IA émettrait en production — mêmes octets, même passerelle. Le moteur juge l’appel, jamais l’appelant : il ne sait pas, et n’a pas besoin de savoir, si une IA ou un humain est derrière.',
    btnTry25: 'Essayer 25 000 EUR',
    btnTryCustom: 'Essayer ce montant',
    amountLabel: 'Votre montant (EUR)',
    cardCustom: '{amount} EUR — décision du moteur',
    btnTry9: 'Essayer 9 000 EUR',
    btnVerifyChain: 'Vérifier la chaîne',
    card25: '25 000 EUR — hors de l’enveloppe',
    card9: '9 000 EUR — dans l’enveloppe',
    chainValid: 'CHAÎNE VALIDE — {n} événements',
    errNoEvent: 'Aucun événement remonté de la passerelle en 8 s — la stack est-elle en bonne santé ?',
    errNotSeeded: 'L’agent « {id} » n’est pas provisionné — récupérez la dernière version de main et redémarrez la stack.',
    errExpectedAllow: 'ALLOW attendu après la modification, le moteur a répondu « {result} » — vérifiez l’état de la politique.',
    errNoEvent2: 'Aucun événement remonté en 8 s.',
  },
};

type StepState = 'locked' | 'active' | 'done';

function useStepper(count: number) {
  const [current, setCurrent] = useState(0);
  const stateOf = (i: number): StepState => (i < current ? 'done' : i === current ? 'active' : 'locked');
  const advance = () => setCurrent(c => Math.min(c + 1, count));
  return { current, stateOf, advance };
}

/** Poll /events until a NEW event for our agent+tool appears (or timeout). */
async function awaitRealEvent(agentId: string, tool: string, notBefore: string, eventTypes: string[], errMsg: string): Promise<ApiEvent> {
  for (let attempt = 0; attempt < 20; attempt++) {
    const res = await fetchEvents(1, 10, { agent: agentId });
    const hit = res.events.find(
      e => e.tool === tool && e.timestamp > notBefore && eventTypes.includes(e.event_type),
    );
    if (hit) return hit;
    await new Promise(r => setTimeout(r, 400));
  }
  throw new Error(errMsg);
}

function EventCard({ title, event }: { title: string; event: ApiEvent }) {
  const deny = event.policy_result === 'deny';
  return (
    <div className="border border-border bg-card rounded-[6px] p-4 text-sm">
      <div className="flex items-center justify-between mb-3">
        <span className="font-medium text-foreground">{title}</span>
        <span className={`font-mono text-xs uppercase px-2 py-0.5 rounded-[4px] ${deny ? 'bg-danger-bg text-danger' : 'bg-safe-bg text-safe'}`}>
          {event.policy_result}
        </span>
      </div>
      <dl className="grid grid-cols-[minmax(90px,110px)_minmax(0,1fr)] gap-y-1.5 gap-x-3 text-xs">
        <dt className="text-ink-3">event_id</dt><dd className="font-mono break-all min-w-0">{event.event_id}</dd>
        <dt className="text-ink-3">matched_rule</dt><dd className="font-mono break-all min-w-0">{event.matched_rule}</dd>
        <dt className="text-ink-3">policy_version</dt><dd className="font-mono break-all min-w-0">{event.policy_version}</dd>
        <dt className="text-ink-3">event_hash</dt><dd className="font-mono break-all min-w-0">{event.event_hash.slice(0, 32)}…</dd>
        <dt className="text-ink-3">prev_hash</dt><dd className="font-mono break-all min-w-0">{(event.prev_hash || 'genesis').slice(0, 32)}…</dd>
        <dt className="text-ink-3">signature</dt><dd className="font-mono break-all min-w-0">{event.signature.slice(0, 32)}…</dd>
      </dl>
      <SouffleurExplain eventId={event.event_id} />
    </div>
  );
}

function Step({ n, title, state, children }: { n: number; title: string; state: StepState; children?: React.ReactNode }) {
  const t = T[useLang()];
  return (
    <section className={`border-l-2 pl-5 pb-8 ${state === 'active' ? 'border-primary' : state === 'done' ? 'border-safe' : 'border-border'}`}>
      <div className={`text-xs font-mono uppercase tracking-widest mb-1 ${state === 'locked' ? 'text-ink-4' : 'text-ink-3'}`}>
        {t.stepLabel.replace('{n}', String(n))}
      </div>
      <h2 className={`text-base font-medium mb-2 ${state === 'locked' ? 'text-ink-4' : 'text-foreground'}`}>{title}</h2>
      {state !== 'locked' && <div className="space-y-3 text-sm text-ink-2 leading-relaxed">{children}</div>}
    </section>
  );
}

export default function GuidedDemo() {
  const lang = useLang();
  const t = T[lang];
  const pa = resolveAgent('payment-assistant', 'payment-assistant', 'payment-key-33333');
  const AGENT_ID = pa.agentId;
  const AGENT_KEY = pa.apiKey;
  const steps = useStepper(11);
  const [stackUp, setStackUp] = useState<boolean | null>(null);
  const [policy, setPolicy] = useState<PolicyEntry | null>(null);
  const [denyEvent, setDenyEvent] = useState<ApiEvent | null>(null);
  const [allowEvent, setAllowEvent] = useState<ApiEvent | null>(null);
  const [verification, setVerification] = useState<ChainVerification | null>(null);
  const [reviewed, setReviewed] = useState<string | null>(null);
  const [overEvent, setOverEvent] = useState<ApiEvent | null>(null);
  const [withinEvent, setWithinEvent] = useState<ApiEvent | null>(null);
  const [custom, setCustom] = useState<{ amount: number; event: ApiEvent } | null>(null);
  const [customAmount, setCustomAmount] = useState('12500');
  const [ch2Verify, setCh2Verify] = useState<ChainVerification | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    isApiAvailable().then(setStackUp);
  }, []);

  const guard = useCallback(async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, []);

  const loadPolicy = () =>
    guard(async () => {
      const policies = await fetchPolicies();
      const p = policies.find(x => x.agent_id === AGENT_ID);
      if (!p) throw new Error(t.errNotSeeded.replace('{id}', AGENT_ID));
      setPolicy(p);
      steps.advance();
    });

  const runDenied = () =>
    guard(async () => {
      const before = new Date().toISOString();
      await runMcpToolCall(AGENT_KEY, DENIED_TOOL, { invoice_id: 'INV-2041', amount: 12500, currency: 'EUR' });
      const evt = await awaitRealEvent(AGENT_ID, DENIED_TOOL, before, ['policy_deny', 'tool_call'], t.errNoEvent);
      setDenyEvent(evt);
      steps.advance(); // → decides
      steps.advance(); // → real why
    });

  const editPolicy = () =>
    guard(async () => {
      if (!policy) return;
      const allowed = [...policy.allowed_tools.filter(t => t !== DENIED_TOOL), DENIED_TOOL];
      const denied = policy.denied_tools.filter(t => t !== DENIED_TOOL);
      const updated = await patchPolicy(AGENT_ID, allowed, denied);
      setPolicy(updated);
      steps.advance();
    });

  const runAllowed = () =>
    guard(async () => {
      const before = new Date().toISOString();
      await runMcpToolCall(AGENT_KEY, DENIED_TOOL, { invoice_id: 'INV-2041', amount: 12500, currency: 'EUR' });
      const evt = await awaitRealEvent(AGENT_ID, DENIED_TOOL, before, ['tool_call', 'policy_deny'], t.errNoEvent);
      if (evt.policy_result !== 'allow') throw new Error(t.errExpectedAllow.replace('{result}', evt.policy_result));
      setAllowEvent(evt);
      steps.advance(); // → allow
      steps.advance(); // → side by side
    });

  const doVerify = () =>
    guard(async () => {
      const v = await verifyChain();
      setVerification(v);
      steps.advance();
    });

  const doReview = (decision: 'acknowledge' | 'escalate') =>
    guard(async () => {
      if (!allowEvent) return;
      await postEventReview(allowEvent.event_id, decision, 'demo-visitor');
      setReviewed(decision);
      steps.advance();
    });

  const fin = resolveAgent('finance-analyst-eu', 'finance-analyst-eu', 'finance-key-44444');
  const FIN_AGENT_KEY = fin.apiKey;
  const awaitFinanceEvent = async (notBefore: string) => {
    for (let i = 0; i < 20; i++) {
      const res = await fetchEvents(1, 5, { agent: fin.agentId });
      const hit = res.events.find(e => e.tool === 'execute_payment' && e.timestamp > notBefore);
      if (hit) return hit;
      await new Promise(r => setTimeout(r, 400));
    }
    throw new Error(t.errNoEvent2);
  };
  const runOver = () =>
    guard(async () => {
      const before = new Date().toISOString();
      await runMcpToolCall(FIN_AGENT_KEY, 'execute_payment', { amount: 25000, currency: 'EUR' });
      setOverEvent(await awaitFinanceEvent(before));
    });
  const runWithin = () =>
    guard(async () => {
      const before = new Date().toISOString();
      await runMcpToolCall(FIN_AGENT_KEY, 'execute_payment', { amount: 9000, currency: 'EUR' });
      setWithinEvent(await awaitFinanceEvent(before));
    });
  const runCustom = () =>
    guard(async () => {
      const amount = Number(customAmount);
      if (!Number.isFinite(amount) || amount <= 0) return;
      const before = new Date().toISOString();
      await runMcpToolCall(FIN_AGENT_KEY, 'execute_payment', { amount, currency: 'EUR' });
      setCustom({ amount, event: await awaitFinanceEvent(before) });
    });
  const ch2DoVerify = () => guard(async () => setCh2Verify(await verifyChain()));

  if (stackUp === null) {
    return <div className="p-10 text-sm text-ink-3">{t.checking}</div>;
  }
  if (!stackUp) {
    // Honesty rule: no mock fallback in the guided path — ever.
    return (
      <div className="max-w-xl mx-auto mt-20 border border-border bg-card rounded-[6px] p-8 text-sm">
        <div className="text-base font-medium text-foreground mb-2">{t.downTitle}</div>
        <p className="text-ink-2 leading-relaxed mb-4">
          {t.downBody}
        </p>
        <pre className="bg-muted rounded-[4px] p-3 font-mono text-xs mb-4">docker compose up --build -d</pre>
        <Link to="/" className="text-primary text-xs font-mono">{t.back}</Link>
      </div>
    );
  }

  const s = steps.stateOf;

  return (
    <div className="max-w-3xl mx-auto px-6 py-10">
      <div className="mb-2 text-xs font-mono uppercase tracking-widest text-ink-3">
        {t.crumb}<Link to="/" className="text-primary">{t.exit}</Link>
      </div>
      <h1 className="text-xl font-medium text-foreground mb-2">{t.h1}</h1>
      {activeWorkspace() && (
        <div className="mb-6 text-xs font-mono text-primary">
          {t.wsLine
            .replace('{id}', activeWorkspace()!.session_id)
            .replace('{time}', new Date(activeWorkspace()!.expires_at).toLocaleTimeString())}
        </div>
      )}
      {!activeWorkspace() && <div className="mb-6" />}

      {error && (
        <div className="mb-6 border border-danger bg-danger-bg text-danger rounded-[6px] p-3 text-sm">{error}</div>
      )}

      <Step n={1} title={t.s1Title} state={s(0)}>
        <p>
          <b>Payment Assistant</b>{t.s1Body}
        </p>
        <Button onClick={loadPolicy} disabled={busy}>{t.btnShowPolicy}</Button>
      </Step>

      <Step n={2} title={t.s2Title} state={s(1)}>
        {policy && (
          <>
            <p>{t.s2Intro}</p>
            <div className="grid grid-cols-2 gap-3">
              <div className="border border-border bg-card rounded-[6px] p-3">
                <div className="text-xs font-mono uppercase text-safe mb-1.5">allowed_tools</div>
                {policy.allowed_tools.map(t => <div key={t} className="font-mono text-xs">{t}</div>)}
              </div>
              <div className="border border-border bg-card rounded-[6px] p-3">
                <div className="text-xs font-mono uppercase text-danger mb-1.5">denied_tools</div>
                {policy.denied_tools.length === 0 && <div className="font-mono text-xs text-ink-4">{t.empty}</div>}
                {policy.denied_tools.map(t => <div key={t} className="font-mono text-xs">{t}</div>)}
              </div>
            </div>
            <Button onClick={() => steps.advance()} disabled={busy}>{t.btnGotIt}</Button>
          </>
        )}
      </Step>

      <Step n={3} title={t.s3Title} state={s(2)}>
        <p>
          {t.s3a}<code className="font-mono">execute_payment</code>{t.s3b}
        </p>
        <Button onClick={runDenied} disabled={busy}>{busy ? t.btnCalling : t.btnRunDenied}</Button>
      </Step>

      <Step n={4} title={t.s4Title} state={s(3)}>
        <p>{t.s4Body}</p>
      </Step>

      <Step n={5} title={t.s5Title} state={s(4)}>
        {denyEvent && (
          <>
            <p>
              {t.s5a}
              <code className="font-mono">{denyEvent.matched_rule}</code>{t.s5colon}
            </p>
            <EventCard title={t.cardDecision} event={denyEvent} />
            <Button onClick={() => steps.advance()} disabled={busy}>{t.btnChangeRule}</Button>
          </>
        )}
      </Step>

      <Step n={6} title={t.s6Title} state={s(5)}>
        <p>
          {t.s6a}<code className="font-mono">execute_payment</code>{t.s6b}
          <code className="font-mono">policy_change</code>{t.s6c}
        </p>
        <Button onClick={editPolicy} disabled={busy}>{busy ? t.btnApplying : t.btnAllow}</Button>
        <p className="text-xs text-ink-3">{t.s6Note}</p>
      </Step>

      <Step n={7} title={t.s7Title} state={s(6)}>
        <p>{t.s7Body}</p>
        <Button onClick={runAllowed} disabled={busy}>{busy ? t.btnCalling : t.btnRunAgain}</Button>
      </Step>

      <Step n={8} title={t.s8Title} state={s(7)}>
        <p>{t.s8Body}</p>
      </Step>

      <Step n={9} title={t.s9Title} state={s(8)}>
        {denyEvent && allowEvent && (
          <>
            <div className="grid md:grid-cols-2 gap-3">
              <EventCard title={t.cardBefore} event={denyEvent} />
              <EventCard title={t.cardAfter} event={allowEvent} />
            </div>
            <p className="text-xs text-ink-3">
              {t.s9Note}
            </p>
            <Button onClick={() => steps.advance()} disabled={busy}>{t.btnProve}</Button>
          </>
        )}
      </Step>

      <Step n={10} title={t.s10Title} state={s(9)}>
        <p>
          {t.s10Body}
        </p>
        <Button onClick={doVerify} disabled={busy}>{busy ? t.btnVerifying : t.btnVerify}</Button>
        {verification && (
          <div className={`border rounded-[6px] p-3 text-sm font-mono ${verification.valid ? 'border-safe bg-safe-bg text-safe' : 'border-danger bg-danger-bg text-danger'}`}>
            {verification.valid
              ? t.chainValidAt.replace('{n}', String(verification.events)).replace('{at}', verification.verified_at)
              : t.chainInvalid.replace('{err}', String(verification.error))}
          </div>
        )}
      </Step>

      <Step n={11} title={t.s11Title} state={s(10)}>
        <p>
          {t.s11Body}
        </p>
        {!reviewed ? (
          <div className="flex gap-2">
            <Button onClick={() => doReview('acknowledge')} disabled={busy}>{t.btnAck}</Button>
            <Button variant="outline" onClick={() => doReview('escalate')} disabled={busy}>{t.btnEsc}</Button>
          </div>
        ) : (
          <div className="text-sm">
            {t.s11a}<b>{reviewed}</b>{t.s11b}{' '}
            <Link to="/dashboard" className="text-primary">{t.linkRoom}</Link>
          </div>
        )}
      </Step>

      {reviewed && (
        <div className="mt-4 border-t border-border pt-8">
          <div className="text-xs font-mono uppercase tracking-widest text-ink-3 mb-1">{t.ch2Crumb}</div>
          <h2 className="text-base font-medium text-foreground mb-2">{t.ch2H}</h2>
          <p className="text-sm text-ink-2 leading-relaxed mb-3">
            <b>Finance Analyst EU</b>{t.ch2a}<code className="font-mono">matched_rule</code>.
          </p>
          <p className="text-xs text-ink-3 leading-relaxed mb-3">
            {t.ch2You}
          </p>
          <div className="flex gap-2 mb-4">
            <Button onClick={runOver} disabled={busy}>{t.btnTry25}</Button>
            <Button onClick={runWithin} disabled={busy || !overEvent}>{t.btnTry9}</Button>
            <span className="inline-flex items-center gap-1.5 ml-2">
              <input
                type="number"
                min="1"
                value={customAmount}
                onChange={e => setCustomAmount(e.target.value)}
                aria-label={t.amountLabel}
                className="border border-border rounded-[4px] bg-background px-2 py-1.5 text-xs font-mono w-28"
              />
              <Button variant="outline" onClick={runCustom} disabled={busy || !customAmount.trim()}>{t.btnTryCustom}</Button>
            </span>
            {withinEvent && <Button variant="outline" onClick={ch2DoVerify} disabled={busy}>{t.btnVerifyChain}</Button>}
          </div>
          <div className="grid md:grid-cols-2 gap-3">
            {overEvent && <EventCard title={t.card25} event={overEvent} />}
            {withinEvent && <EventCard title={t.card9} event={withinEvent} />}
            {custom && <EventCard title={t.cardCustom.replace('{amount}', custom.amount.toLocaleString('fr-FR'))} event={custom.event} />}
          </div>
          {ch2Verify && (
            <div className={`mt-3 border rounded-[6px] p-3 text-sm font-mono ${ch2Verify.valid ? 'border-safe bg-safe-bg text-safe' : 'border-danger bg-danger-bg text-danger'}`}>
              {ch2Verify.valid ? t.chainValid.replace('{n}', String(ch2Verify.events)) : t.chainInvalid.replace('{err}', String(ch2Verify.error))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

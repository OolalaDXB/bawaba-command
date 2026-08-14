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

/**
 * Guided Demo (P0) — a narrated path over the REAL engine (demo mandate §3).
 * Every value on screen is read from real API responses and real audit
 * events; matched_rule and policy_result are rendered VERBATIM, never
 * paraphrased. There is NO mock fallback here: if the stack is down, the
 * demo says so and stops. Honesty is the feature.
 */

const AGENT_ID = 'payment-assistant';
const AGENT_KEY = 'payment-key-33333'; // seeded demo key (docker-compose)
const DENIED_TOOL = 'execute_payment';

type StepState = 'locked' | 'active' | 'done';

function useStepper(count: number) {
  const [current, setCurrent] = useState(0);
  const stateOf = (i: number): StepState => (i < current ? 'done' : i === current ? 'active' : 'locked');
  const advance = () => setCurrent(c => Math.min(c + 1, count));
  return { current, stateOf, advance };
}

/** Poll /events until a NEW event for our agent+tool appears (or timeout). */
async function awaitRealEvent(tool: string, notBefore: string, eventTypes: string[]): Promise<ApiEvent> {
  for (let attempt = 0; attempt < 20; attempt++) {
    const res = await fetchEvents(1, 10, { agent: AGENT_ID });
    const hit = res.events.find(
      e => e.tool === tool && e.timestamp > notBefore && eventTypes.includes(e.event_type),
    );
    if (hit) return hit;
    await new Promise(r => setTimeout(r, 400));
  }
  throw new Error('No event surfaced from the gateway within 8s — is the stack healthy?');
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
      <dl className="grid grid-cols-[130px_1fr] gap-y-1.5 text-xs">
        <dt className="text-ink-3">event_id</dt><dd className="font-mono break-all">{event.event_id}</dd>
        <dt className="text-ink-3">matched_rule</dt><dd className="font-mono">{event.matched_rule}</dd>
        <dt className="text-ink-3">policy_version</dt><dd className="font-mono">{event.policy_version}</dd>
        <dt className="text-ink-3">event_hash</dt><dd className="font-mono break-all">{event.event_hash.slice(0, 32)}…</dd>
        <dt className="text-ink-3">prev_hash</dt><dd className="font-mono break-all">{(event.prev_hash || 'genesis').slice(0, 32)}…</dd>
        <dt className="text-ink-3">signature</dt><dd className="font-mono break-all">{event.signature.slice(0, 32)}…</dd>
      </dl>
    </div>
  );
}

function Step({ n, title, state, children }: { n: number; title: string; state: StepState; children?: React.ReactNode }) {
  return (
    <section className={`border-l-2 pl-5 pb-8 ${state === 'active' ? 'border-primary' : state === 'done' ? 'border-safe' : 'border-border'}`}>
      <div className={`text-xs font-mono uppercase tracking-widest mb-1 ${state === 'locked' ? 'text-ink-4' : 'text-ink-3'}`}>
        Step {n}
      </div>
      <h2 className={`text-base font-medium mb-2 ${state === 'locked' ? 'text-ink-4' : 'text-foreground'}`}>{title}</h2>
      {state !== 'locked' && <div className="space-y-3 text-sm text-ink-2 leading-relaxed">{children}</div>}
    </section>
  );
}

export default function GuidedDemo() {
  const steps = useStepper(11);
  const [stackUp, setStackUp] = useState<boolean | null>(null);
  const [policy, setPolicy] = useState<PolicyEntry | null>(null);
  const [denyEvent, setDenyEvent] = useState<ApiEvent | null>(null);
  const [allowEvent, setAllowEvent] = useState<ApiEvent | null>(null);
  const [verification, setVerification] = useState<ChainVerification | null>(null);
  const [reviewed, setReviewed] = useState<string | null>(null);
  const [overEvent, setOverEvent] = useState<ApiEvent | null>(null);
  const [withinEvent, setWithinEvent] = useState<ApiEvent | null>(null);
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
      if (!p) throw new Error(`Agent "${AGENT_ID}" is not seeded — pull latest main and restart the stack.`);
      setPolicy(p);
      steps.advance();
    });

  const runDenied = () =>
    guard(async () => {
      const before = new Date().toISOString();
      await runMcpToolCall(AGENT_KEY, DENIED_TOOL, { invoice_id: 'INV-2041', amount: 12500, currency: 'EUR' });
      const evt = await awaitRealEvent(DENIED_TOOL, before, ['policy_deny', 'tool_call']);
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
      const evt = await awaitRealEvent(DENIED_TOOL, before, ['tool_call', 'policy_deny']);
      if (evt.policy_result !== 'allow') throw new Error(`Expected ALLOW after the edit, the engine said "${evt.policy_result}" — check the policy state.`);
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

  const FIN_AGENT_KEY = 'finance-key-44444';
  const awaitFinanceEvent = async (notBefore: string) => {
    for (let i = 0; i < 20; i++) {
      const res = await fetchEvents(1, 5, { agent: 'finance-analyst-eu' });
      const hit = res.events.find(e => e.tool === 'execute_payment' && e.timestamp > notBefore);
      if (hit) return hit;
      await new Promise(r => setTimeout(r, 400));
    }
    throw new Error('No event surfaced within 8s.');
  };
  const runOver = () =>
    guard(async () => {
      const t = new Date().toISOString();
      await runMcpToolCall(FIN_AGENT_KEY, 'execute_payment', { amount: 25000, currency: 'EUR' });
      setOverEvent(await awaitFinanceEvent(t));
    });
  const runWithin = () =>
    guard(async () => {
      const t = new Date().toISOString();
      await runMcpToolCall(FIN_AGENT_KEY, 'execute_payment', { amount: 9000, currency: 'EUR' });
      setWithinEvent(await awaitFinanceEvent(t));
    });
  const ch2DoVerify = () => guard(async () => setCh2Verify(await verifyChain()));

  if (stackUp === null) {
    return <div className="p-10 text-sm text-ink-3">Checking the gateway…</div>;
  }
  if (!stackUp) {
    // Honesty rule: no mock fallback in the guided path — ever.
    return (
      <div className="max-w-xl mx-auto mt-20 border border-border bg-card rounded-[6px] p-8 text-sm">
        <div className="text-base font-medium text-foreground mb-2">The live stack is not running</div>
        <p className="text-ink-2 leading-relaxed mb-4">
          The Guided Demo only shows REAL decisions signed by the running gateway — it never simulates.
          Start the stack, then reload:
        </p>
        <pre className="bg-muted rounded-[4px] p-3 font-mono text-xs mb-4">docker compose up --build -d</pre>
        <Link to="/" className="text-primary text-xs font-mono">← Back</Link>
      </div>
    );
  }

  const s = steps.stateOf;

  return (
    <div className="max-w-3xl mx-auto px-6 py-10">
      <div className="mb-2 text-xs font-mono uppercase tracking-widest text-ink-3">
        Guided Demo · real engine, real signatures · <Link to="/" className="text-primary">exit</Link>
      </div>
      <h1 className="text-xl font-medium text-foreground mb-8">Follow one agent decision, end to end</h1>

      {error && (
        <div className="mb-6 border border-danger bg-danger-bg text-danger rounded-[6px] p-3 text-sm">{error}</div>
      )}

      <Step n={1} title="Meet the agent" state={s(0)}>
        <p>
          <b>Payment Assistant</b> handles supplier invoices. Like any AI agent, it acts through tools —
          and every tool call passes through BAWABA before anything happens.
        </p>
        <Button onClick={loadPolicy} disabled={busy}>Show me its policy</Button>
      </Step>

      <Step n={2} title="See its real policy" state={s(1)}>
        {policy && (
          <>
            <p>This is the live policy the engine will enforce — read from the running gateway, not a slide:</p>
            <div className="grid grid-cols-2 gap-3">
              <div className="border border-border bg-card rounded-[6px] p-3">
                <div className="text-xs font-mono uppercase text-safe mb-1.5">allowed_tools</div>
                {policy.allowed_tools.map(t => <div key={t} className="font-mono text-xs">{t}</div>)}
              </div>
              <div className="border border-border bg-card rounded-[6px] p-3">
                <div className="text-xs font-mono uppercase text-danger mb-1.5">denied_tools</div>
                {policy.denied_tools.length === 0 && <div className="font-mono text-xs text-ink-4">(empty)</div>}
                {policy.denied_tools.map(t => <div key={t} className="font-mono text-xs">{t}</div>)}
              </div>
            </div>
            <Button onClick={() => steps.advance()} disabled={busy}>Got it</Button>
          </>
        )}
      </Step>

      <Step n={3} title="Ask it to do something forbidden" state={s(2)}>
        <p>
          Let's have the agent try <code className="font-mono">execute_payment</code> — a tool its policy
          explicitly denies. This posts a REAL MCP call to the gateway.
        </p>
        <Button onClick={runDenied} disabled={busy}>{busy ? 'Calling the gateway…' : 'Run execute_payment'}</Button>
      </Step>

      <Step n={4} title="BAWABA decides: DENY" state={s(3)}>
        <p>The deterministic engine refused the call before anything executed. No LLM decided this.</p>
      </Step>

      <Step n={5} title="The real why — no paraphrase" state={s(4)}>
        {denyEvent && (
          <>
            <p>
              These fields come verbatim from the signed decision record — the rule that matched is{' '}
              <code className="font-mono">{denyEvent.matched_rule}</code>:
            </p>
            <EventCard title="Decision record" event={denyEvent} />
            <Button onClick={() => steps.advance()} disabled={busy}>Now let me change the rule</Button>
          </>
        )}
      </Step>

      <Step n={6} title="Edit the REAL policy" state={s(5)}>
        <p>
          Move <code className="font-mono">execute_payment</code> from denied to allowed. This is a real
          mutation: the engine updates live, and the edit itself is recorded as a signed{' '}
          <code className="font-mono">policy_change</code> event in the audit chain.
        </p>
        <Button onClick={editPolicy} disabled={busy}>{busy ? 'Applying…' : 'Allow execute_payment'}</Button>
        <p className="text-xs text-ink-3">In-memory for this demo — a restart restores the original policy.</p>
      </Step>

      <Step n={7} title="Run it again" state={s(6)}>
        <p>Same agent, same tool, same request — only the policy changed.</p>
        <Button onClick={runAllowed} disabled={busy}>{busy ? 'Calling the gateway…' : 'Run execute_payment again'}</Button>
      </Step>

      <Step n={8} title="BAWABA decides: ALLOW" state={s(7)}>
        <p>The same deterministic engine, applying the policy you just wrote.</p>
      </Step>

      <Step n={9} title="Both decisions, side by side" state={s(8)}>
        {denyEvent && allowEvent && (
          <>
            <div className="grid md:grid-cols-2 gap-3">
              <EventCard title="Before your edit" event={denyEvent} />
              <EventCard title="After your edit" event={allowEvent} />
            </div>
            <p className="text-xs text-ink-3">
              Note the policy_version changed, and each event chains to the previous one via prev_hash.
            </p>
            <Button onClick={() => steps.advance()} disabled={busy}>Prove it</Button>
          </>
        )}
      </Step>

      <Step n={10} title="Verify the evidence" state={s(9)}>
        <p>
          Ask the server to replay the ENTIRE audit chain — every hash link and every Ed25519 signature,
          including your two decisions and your policy edit.
        </p>
        <Button onClick={doVerify} disabled={busy}>{busy ? 'Verifying…' : 'Verify audit chain'}</Button>
        {verification && (
          <div className={`border rounded-[6px] p-3 text-sm font-mono ${verification.valid ? 'border-safe bg-safe-bg text-safe' : 'border-danger bg-danger-bg text-danger'}`}>
            {verification.valid
              ? `CHAIN VALID — ${verification.events} events verified at ${verification.verified_at}`
              : `CHAIN INVALID — ${verification.error}`}
          </div>
        )}
      </Step>

      <Step n={11} title="Human review" state={s(10)}>
        <p>
          Decisions stay reviewable by humans. Acknowledge the ALLOW event — or escalate it if the payment
          should have stayed blocked.
        </p>
        {!reviewed ? (
          <div className="flex gap-2">
            <Button onClick={() => doReview('acknowledge')} disabled={busy}>Acknowledge</Button>
            <Button variant="outline" onClick={() => doReview('escalate')} disabled={busy}>Escalate</Button>
          </div>
        ) : (
          <div className="text-sm">
            Recorded: <b>{reviewed}</b>. That's the whole loop — policy, decision, evidence, verification,
            human oversight. All real.{' '}
            <Link to="/dashboard" className="text-primary">Open the Control Room →</Link>
          </div>
        )}
      </Step>

      {reviewed && (
        <div className="mt-4 border-t border-border pt-8">
          <div className="text-xs font-mono uppercase tracking-widest text-ink-3 mb-1">Chapter 2 · Conditional policy (real attribute engine)</div>
          <h2 className="text-base font-medium text-foreground mb-2">Beyond allow/deny: a payment limit</h2>
          <p className="text-sm text-ink-2 leading-relaxed mb-3">
            <b>Finance Analyst EU</b> may execute payments only inside a real conditional envelope:
            amount ≤ 10 000, currency EUR, jurisdiction EU. The engine evaluates the ACTUAL call
            arguments — the failed condition is named in <code className="font-mono">matched_rule</code>.
          </p>
          <div className="flex gap-2 mb-4">
            <Button onClick={runOver} disabled={busy}>Try 25 000 EUR</Button>
            <Button onClick={runWithin} disabled={busy || !overEvent}>Try 9 000 EUR</Button>
            {withinEvent && <Button variant="outline" onClick={ch2DoVerify} disabled={busy}>Verify chain</Button>}
          </div>
          <div className="grid md:grid-cols-2 gap-3">
            {overEvent && <EventCard title="25 000 EUR — outside the envelope" event={overEvent} />}
            {withinEvent && <EventCard title="9 000 EUR — inside the envelope" event={withinEvent} />}
          </div>
          {ch2Verify && (
            <div className={`mt-3 border rounded-[6px] p-3 text-sm font-mono ${ch2Verify.valid ? 'border-safe bg-safe-bg text-safe' : 'border-danger bg-danger-bg text-danger'}`}>
              {ch2Verify.valid ? `CHAIN VALID — ${ch2Verify.events} events` : `CHAIN INVALID — ${ch2Verify.error}`}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

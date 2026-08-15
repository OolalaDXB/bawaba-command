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

/**
 * Scenarios (P1, demo mandate §5/§9): really-triggerable flows on the live
 * engine — tool DENY, PII tokenization, jurisdiction fail-closed, rate
 * limit, conditional amount envelope — each ending with a real Verify.
 * No mock path: stack down → the page says so and stops.
 */

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
  const deny = e.policy_result === 'deny';
  return (
    <div className="flex items-baseline gap-3 text-xs font-mono py-1 border-b border-border/60 last:border-0">
      <span className={`uppercase px-1.5 rounded-[3px] ${deny ? 'bg-danger-bg text-danger' : 'bg-safe-bg text-safe'}`}>{e.policy_result || e.event_type}</span>
      <span className="text-ink-2">{e.event_type}</span>
      <span>{e.tool}</span>
      <span className="text-ink-3 truncate">{e.matched_rule}</span>
      {e.entities_detected > 0 && <span className="text-primary">{e.entities_detected} PII entities</span>}
    </div>
  );
}

function ScenarioCard({
  title, description, action, run,
}: {
  title: string; description: string; action: string;
  run: () => Promise<RunOutcome>;
}) {
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<RunOutcome | null>(null);
  const [verify, setVerify] = useState<string | null>(null);
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
      setVerify(v.valid ? `CHAIN VALID — ${v.events} events` : `CHAIN INVALID — ${v.error}`);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    setBusy(false);
  };

  return (
    <div className="border border-border bg-card rounded-[6px] p-5">
      <div className="text-sm font-medium text-foreground mb-1">{title}</div>
      <p className="text-xs text-ink-3 leading-relaxed mb-3">{description}</p>
      <div className="flex gap-2 mb-3">
        <Button size="sm" onClick={trigger} disabled={busy}>{action}</Button>
        {outcome && <Button size="sm" variant="outline" onClick={doVerify} disabled={busy}>Verify chain</Button>}
      </div>
      {error && <div className="text-xs text-danger mb-2">{error}</div>}
      {outcome && (
        <div className="bg-background border border-border rounded-[4px] px-3 py-1">
          {outcome.events.length === 0 && <div className="text-xs text-ink-3 py-1">No event surfaced (yet).</div>}
          {outcome.events.map(e => <EventLine key={e.event_id} e={e} />)}
          {outcome.note && <div className="text-[11px] text-ink-3 py-1">{outcome.note}</div>}
        </div>
      )}
      {verify && <div className={`mt-2 text-xs font-mono ${verify.startsWith('CHAIN VALID') ? 'text-safe' : 'text-danger'}`}>{verify}</div>}
    </div>
  );
}

function CrudPanel() {
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
      setMsg(`Agent ${created.agent_id} deleted (soft — history and audit events preserved).`);
      setCreated(null);
    } catch (e) { setMsg(e instanceof Error ? e.message : String(e)); }
    setBusy(false);
  };

  return (
    <div className="border border-border bg-card rounded-[6px] p-5">
      <div className="text-sm font-medium text-foreground mb-1">Control-plane CRUD (P1)</div>
      <p className="text-xs text-ink-3 leading-relaxed mb-3">
        Create a real agent (persisted in PostgreSQL, credentials generated server-side, creation
        audit-logged) — then delete it. Every change lands in the append-only policy_versions history.
      </p>
      <div className="flex gap-2 items-center mb-3">
        <input
          value={agentId}
          onChange={e => setAgentId(e.target.value)}
          placeholder="new-agent-id (kebab-case)"
          className="border border-border rounded-[4px] bg-background px-2 py-1 text-xs font-mono w-56"
        />
        <Button size="sm" onClick={create} disabled={busy || !agentId.trim()}>Create agent</Button>
        {created && <Button size="sm" variant="outline" onClick={remove} disabled={busy}>Delete it</Button>}
      </div>
      {created && (
        <div className="text-xs font-mono bg-background border border-border rounded-[4px] p-2 break-all">
          agent_id: {created.agent_id}<br />api_key (shown ONCE — only its hash is stored): {created.api_key}
        </div>
      )}
      {msg && <div className="text-xs text-ink-2 mt-2">{msg}</div>}
    </div>
  );
}

export default function Scenarios() {
  // Workspace-aware: the payment/finance scenarios run on YOUR clones when a
  // private workspace is active; the shared seeded agents otherwise.
  const pa = resolveAgent('payment-assistant', 'payment-assistant', KEYS['payment-assistant']);
  const fin = resolveAgent('finance-analyst-eu', 'finance-analyst-eu', KEYS['finance-analyst-eu']);
  const [stackUp, setStackUp] = useState<boolean | null>(null);
  useEffect(() => { isApiAvailable().then(setStackUp); }, []);

  if (stackUp === null) return <div className="p-10 text-sm text-ink-3">Checking the gateway…</div>;
  if (!stackUp) {
    return (
      <div className="max-w-xl mx-auto mt-20 border border-border bg-card rounded-[6px] p-8 text-sm">
        <div className="text-base font-medium text-foreground mb-2">The live stack is not running</div>
        <p className="text-ink-2 mb-3">Scenarios only trigger REAL flows — nothing is simulated. Start the stack, then reload:</p>
        <pre className="bg-muted rounded-[4px] p-3 font-mono text-xs">docker compose up --build -d</pre>
      </div>
    );
  }

  const stamp = () => new Date().toISOString();

  return (
    <div className="max-w-4xl mx-auto px-6 py-8">
      <h1 className="text-lg font-medium text-foreground mb-1">Scenarios</h1>
      <p className="text-xs text-ink-3 mb-2">
        Each button triggers a REAL flow through the gateway; each card ends with a real server-side
        chain verification. Nothing here is simulated.
      </p>
      {activeWorkspace() ? (
        <div className="text-xs font-mono text-primary mb-6">
          Private workspace {activeWorkspace()!.session_id}: payment/finance scenarios run on YOUR clones (PII, jurisdiction and rate-limit scenarios use the shared seeded agents).
        </div>
      ) : (
        <div className="mb-6" />
      )}

      <div className="grid md:grid-cols-2 gap-4">
        <ScenarioCard
          title="1 · Policy denial by tool"
          description="payment-assistant calls execute_payment, which its policy denies (unless you allowed it in the Guided Demo — the matched_rule tells you which)."
          action="Trigger the call"
          run={async () => {
            const t = stamp();
            await runMcpToolCall(pa.apiKey, 'execute_payment', { invoice_id: 'INV-7', amount: 100, currency: 'EUR' });
            return { label: 'deny', events: await latestEvents(pa.agentId, t) };
          }}
        />
        <ScenarioCard
          title="2 · PII tokenization"
          description="test-agent echoes a payload containing a real-format IBAN and email; the Rust tokenizer detects and tokenizes them before anything else sees the data."
          action="Send PII payload"
          run={async () => {
            const t = stamp();
            await runMcpToolCall(KEYS['test-agent'], 'echo', {
              message: "Customer IBAN MA64011519000001205000534921, contact sara@example.ma",
            });
            return { label: 'pii', events: await latestEvents('test-agent', t) };
          }}
        />
        <ScenarioCard
          title="3 · Jurisdiction fail-closed"
          description="apac-analyst is configured with jurisdiction 'sg', which has NO routing rule. BAWABA refuses to route rather than guess — fail closed."
          action="Trigger the call"
          run={async () => {
            const t = stamp();
            try {
              await runMcpToolCall(KEYS['apac-analyst'], 'echo', { message: 'hello' });
            } catch { /* the gateway rejects — that IS the scenario */ }
            const events = await latestEvents('apac-analyst', t);
            return {
              label: 'jurisdiction',
              events,
              note: events.length === 0 ? 'The gateway rejected the call before any tool ran (JSON-RPC jurisdiction error) — fail closed.' : undefined,
            };
          }}
        />
        <ScenarioCard
          title="4 · Rate limit"
          description="burst-agent is capped at 5 calls/minute. Fire 8 echo calls and watch the sliding window cut in."
          action="Fire 8 calls"
          run={async () => {
            const t = stamp();
            for (let i = 0; i < 8; i++) {
              try { await runMcpToolCall(KEYS['burst-agent'], 'echo', { message: `burst ${i}` }); } catch { /* 429s expected */ }
            }
            const events = await latestEvents('burst-agent', t, 8);
            return { label: 'rate', events, note: 'rate_limit events mark the cut-off; earlier calls passed.' };
          }}
        />
        <ScenarioCard
          title="5 · Conditional amount envelope (REAL engine)"
          description="finance-analyst-eu may execute_payment only within: amount ≤ 10 000, EUR, jurisdiction eu. 25 000 EUR falls outside — the failed condition is named in matched_rule."
          action="Try 25 000 then 9 000 EUR"
          run={async () => {
            const t = stamp();
            await runMcpToolCall(fin.apiKey, 'execute_payment', { amount: 25000, currency: 'EUR' });
            await runMcpToolCall(fin.apiKey, 'execute_payment', { amount: 9000, currency: 'EUR' });
            return { label: 'conditional', events: await latestEvents(fin.agentId, t, 2) };
          }}
        />
        <ScenarioCard
          title="6 · Human review"
          description="Acknowledge the most recent event for finance-analyst-eu — the review is recorded against the real event."
          action="Acknowledge latest"
          run={async () => {
            const res = await fetchEvents(1, 1, { agent: fin.agentId });
            const evt = res.events[0];
            if (!evt) throw new Error('Run scenario 5 first — no event to review.');
            await postEventReview(evt.event_id, 'acknowledge', 'scenario-visitor');
            return { label: 'review', events: [evt], note: `acknowledged ${evt.event_id}` };
          }}
        />
      </div>

      <div className="mt-6">
        <CrudPanel />
      </div>
    </div>
  );
}

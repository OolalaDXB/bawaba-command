import { useState } from 'react';
import { copilotExplain, ApiError, type CopilotExplanation } from '@/services/api';
import { Button } from '@/components/ui/button';

/**
 * P3 Copilot (mandate §7): one button per REAL audit event. The server loads
 * the event from the append-only trail, sends its decision fields to the
 * configured LLM provider, and returns a translation — never a decision,
 * never a guess. No provider configured → the honest 503 is shown as-is.
 */
export function CopilotExplain({ eventId }: { eventId: string }) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<CopilotExplanation | null>(null);
  const [error, setError] = useState<string | null>(null);

  const explain = async () => {
    setBusy(true); setError(null);
    try {
      setResult(await copilotExplain(eventId));
    } catch (e) {
      if (e instanceof ApiError && e.status === 503) {
        setError('Copilot not configured — no LLM provider is set on the gateway (BAWABA_COPILOT_PROVIDER). The Copilot never invents an explanation, so there is nothing to show.');
      } else {
        setError(e instanceof Error ? e.message : String(e));
      }
    }
    setBusy(false);
  };

  return (
    <div className="mt-2">
      {!result && (
        <Button size="sm" variant="outline" onClick={explain} disabled={busy}>
          {busy ? 'Copilot is reading the record…' : 'Explain (Copilot)'}
        </Button>
      )}
      {error && <div className="text-xs text-ink-3 mt-1 leading-relaxed">{error}</div>}
      {result && (
        <div className="bg-background border border-border rounded-[4px] p-3 mt-1">
          <p className="text-xs text-foreground leading-relaxed">{result.explanation}</p>
          <div className="text-[10px] font-mono text-ink-3 mt-2">
            translated from event {result.event_id} · fields: policy_result, matched_rule, policy_version (verbatim) · provider {result.provider}/{result.model} — the deterministic engine decided, the Copilot only translated
          </div>
        </div>
      )}
    </div>
  );
}

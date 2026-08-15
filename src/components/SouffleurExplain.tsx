import { useState } from 'react';
import { souffleurExplain, ApiError, type SouffleurExplanation } from '@/services/api';
import { Button } from '@/components/ui/button';

/**
 * P3 Souffleur (mandate §7): one button per REAL audit event. The server loads
 * the event from the append-only trail, sends its decision fields to the
 * configured LLM provider, and returns a translation — never a decision,
 * never a guess. No provider configured → the honest 503 is shown as-is.
 */
export function SouffleurExplain({ eventId }: { eventId: string }) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<SouffleurExplanation | null>(null);
  const [error, setError] = useState<string | null>(null);

  const explain = async () => {
    setBusy(true); setError(null);
    try {
      setResult(await souffleurExplain(eventId));
    } catch (e) {
      if (e instanceof ApiError && e.status === 503) {
        setError('Souffleur not configured — no LLM provider is set on the gateway (BAWABA_SOUFFLEUR_PROVIDER). The Souffleur never invents an explanation, so there is nothing to show.');
      } else {
        setError(e instanceof Error ? e.message : String(e));
      }
    }
    setBusy(false);
  };

  return (
    <div className="mt-2">
      {!result && (
        <Button
          size="sm"
          variant="outline"
          onClick={explain}
          disabled={busy}
          title="The Souffleur — from the French for a theater prompter: it whispers what the record says. It never acts, never decides, never improvises."
        >
          {busy ? 'The Souffleur is reading the record…' : 'Explain (Souffleur)'}
        </Button>
      )}
      {error && <div className="text-xs text-ink-3 mt-1 leading-relaxed">{error}</div>}
      {result && (
        <div className="bg-background border border-border rounded-[4px] p-3 mt-1">
          <p className="text-xs text-foreground leading-relaxed">{result.explanation}</p>
          <div className="text-[10px] font-mono text-ink-3 mt-2">
            translated from event {result.event_id} · fields: policy_result, matched_rule, policy_version (verbatim) · provider {result.provider}/{result.model} — the deterministic engine decided, the Souffleur only translated
          </div>
        </div>
      )}
    </div>
  );
}

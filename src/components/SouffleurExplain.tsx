import { useState } from 'react';
import { souffleurExplain, ApiError, type SouffleurExplanation } from '@/services/api';
import { Button } from '@/components/ui/button';
import { useLang, type Lang } from '@/lib/i18n';

/**
 * P3 Souffleur (mandate §7): one button per REAL audit event. The server loads
 * the event from the append-only trail, sends its decision fields to the
 * configured LLM provider, and returns a translation — never a decision,
 * never a guess. No provider configured → the honest 503 is shown as-is.
 */

const T: Record<Lang, Record<string, string>> = {
  en: {
    err503: 'Souffleur not configured — no LLM provider is set on the gateway (BAWABA_SOUFFLEUR_PROVIDER). The Souffleur never invents an explanation, so there is nothing to show.',
    tooltip: 'The Souffleur — from the French for a theater prompter: it whispers what the record says. It never acts, never decides, never improvises.',
    busy: 'The Souffleur is reading the record…',
    explain: 'Explain (Souffleur)',
    footer: 'translated from event {id} · fields: policy_result, matched_rule, policy_version (verbatim) · provider {provider}/{model} — the deterministic engine decided, the Souffleur only translated',
  },
  fr: {
    err503: 'Souffleur non configuré — aucun fournisseur LLM n’est défini sur la passerelle (BAWABA_SOUFFLEUR_PROVIDER). Le Souffleur n’invente jamais d’explication, il n’y a donc rien à afficher.',
    tooltip: 'Le Souffleur — comme au théâtre : il murmure ce que dit l’enregistrement. Il n’agit jamais, ne décide jamais, n’improvise jamais.',
    busy: 'Le Souffleur lit l’enregistrement…',
    explain: 'Expliquer (Souffleur)',
    footer: 'traduit depuis l’événement {id} · champs : policy_result, matched_rule, policy_version (verbatim) · fournisseur {provider}/{model} — le moteur déterministe a décidé, le Souffleur n’a fait que traduire',
  },
};

export function SouffleurExplain({ eventId }: { eventId: string }) {
  const lang = useLang();
  const t = T[lang];
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<SouffleurExplanation | null>(null);
  const [error, setError] = useState<string | null>(null);

  const explain = async () => {
    setBusy(true); setError(null);
    try {
      setResult(await souffleurExplain(eventId, undefined, lang));
    } catch (e) {
      if (e instanceof ApiError && e.status === 503) {
        setError(t.err503);
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
          title={t.tooltip}
          className="gap-1.5"
        >
          <img src="/souffleur-mark.png" alt="" className="w-4 h-4 object-contain" />
          {busy ? t.busy : t.explain}
        </Button>
      )}
      {error && <div className="text-xs text-ink-3 mt-1 leading-relaxed">{error}</div>}
      {result && (
        <div className="bg-background border border-border rounded-[4px] p-3 mt-1">
          <div className="flex items-start gap-2">
            <img src="/souffleur-mark.png" alt="Souffleur" className="w-5 h-5 object-contain mt-0.5 shrink-0" />
            <p className="text-xs text-foreground leading-relaxed">{result.explanation}</p>
          </div>
          <div className="text-[10px] font-mono text-ink-3 mt-2">
            {t.footer
              .replace('{id}', result.event_id)
              .replace('{provider}', result.provider)
              .replace('{model}', result.model)}
          </div>
        </div>
      )}
    </div>
  );
}

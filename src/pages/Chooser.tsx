import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { startWorkspace, activeWorkspace, shareLink } from '@/lib/demoWorkspace';
import { useLang, setLang, type Lang } from '@/lib/i18n';

/**
 * Entry chooser (demo mandate §3): two ways into the same console. The
 * Guided Demo is NOT a dumbed-down view — it is a narrated path over the
 * same real engine, events and evidence. Bilingual FR/EN entry point;
 * sovereignty is named, not implied.
 */

const T: Record<Lang, Record<string, string>> = {
  en: {
    subtitle: 'Sovereignty, control and evidence for enterprise AI agents',
    banner: 'Demonstration environment · real engine, real signatures · no customer data',
    how: 'How would you like to explore BAWABA?',
    guidedTitle: 'Guided Demo',
    guidedBody: 'Understand BAWABA in 3 minutes. Follow a real agent decision from request to verifiable evidence — then change the policy yourself and watch the decision flip.',
    guidedCta: 'Start the guided path →',
    wsTitle: 'Private Workspace',
    wsBody: 'Start a seeded, ephemeral 60-minute session: your own agents and policies to edit and break. Everything expires and disappears — the audit chain stays append-only.',
    wsCreating: 'Creating workspace…',
    wsStart: 'Start a private session →',
    wsResume: 'Resume (expires {time})',
    wsCopied: 'Link copied — valid until the session expires',
    wsCopy: 'Copy shareable link',
    roomTitle: 'Control Room',
    roomBody: 'Explore the full control and evidence plane. Agents, policies, events, jurisdictions and audit evidence directly.',
    roomCta: 'Open the console →',
    stackDown: ' — is the stack running?',
  },
  fr: {
    subtitle: 'Souveraineté, contrôle et preuve pour les agents IA d’entreprise',
    banner: 'Environnement de démonstration · moteur réel, signatures réelles · aucune donnée client',
    how: 'Comment voulez-vous explorer BAWABA ?',
    guidedTitle: 'Démo guidée',
    guidedBody: 'Comprendre BAWABA en 3 minutes. Suivez une décision réelle d’agent, de la requête à la preuve vérifiable — puis modifiez la politique vous-même et regardez la décision s’inverser.',
    guidedCta: 'Commencer le parcours guidé →',
    wsTitle: 'Espace privé',
    wsBody: 'Démarrez une session éphémère de 60 minutes : vos propres agents et politiques, à modifier et à casser. Tout expire et disparaît — la chaîne d’audit reste append-only.',
    wsCreating: 'Création de l’espace…',
    wsStart: 'Démarrer une session privée →',
    wsResume: 'Reprendre (expire à {time})',
    wsCopied: 'Lien copié — valable jusqu’à l’expiration de la session',
    wsCopy: 'Copier le lien de partage',
    roomTitle: 'Salle de contrôle',
    roomBody: 'Explorez tout le plan de contrôle et de preuve : agents, politiques, événements, juridictions et preuves d’audit, en direct.',
    roomCta: 'Ouvrir la console →',
    stackDown: ' — la stack tourne-t-elle ?',
  },
};

export default function Chooser() {
  const navigate = useNavigate();
  const lang = useLang();
  const t = T[lang];
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const ws = activeWorkspace();

  // P3: the share link carries the workspace in the URL fragment — it never
  // reaches a server and dies with the session (~60 min).
  const copyShare = async (e: React.MouseEvent) => {
    e.stopPropagation();
    const link = shareLink();
    if (!link) return;
    await navigator.clipboard.writeText(link);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };

  const start = async () => {
    setBusy(true); setErr(null);
    try {
      await startWorkspace();
      navigate('/demo');
    } catch (e) {
      setErr(e instanceof Error ? `${e.message}${t.stackDown}` : String(e));
    }
    setBusy(false);
  };

  const card = 'group border border-border bg-card p-8 rounded-[6px] shadow-[0_1px_2px_rgba(16,24,40,0.05)] hover:border-primary transition-colors';

  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center px-6 relative">
      <div className="absolute top-5 right-6 flex gap-1 text-xs font-mono">
        {(['fr', 'en'] as Lang[]).map(l => (
          <button
            key={l}
            onClick={() => setLang(l)}
            className={`px-2 py-1 rounded-[4px] uppercase tracking-wide ${lang === l ? 'bg-foreground text-background' : 'text-ink-3 hover:text-foreground'}`}
          >
            {l}
          </button>
        ))}
      </div>

      <div className="mb-4 font-heading text-7xl md:text-8xl text-foreground tracking-wide">BAWABA</div>
      <div className="mb-3 text-xl md:text-2xl text-ink-2 text-center max-w-3xl leading-snug">{t.subtitle}</div>
      <div className="mb-12 text-xs font-mono uppercase tracking-widest text-ink-3 text-center">
        {t.banner}
      </div>

      <h1 className="mb-8 text-lg text-foreground">{t.how}</h1>

      <div className="grid gap-6 md:grid-cols-3 w-full max-w-5xl">
        <Link to="/demo" className={card}>
          <div className="text-base font-medium text-foreground mb-2">{t.guidedTitle}</div>
          <div className="text-sm text-ink-3 leading-relaxed">{t.guidedBody}</div>
          <div className="mt-4 text-xs font-mono text-primary">{t.guidedCta}</div>
        </Link>

        <button onClick={start} disabled={busy} className={`${card} text-left disabled:opacity-60`}>
          <div className="text-base font-medium text-foreground mb-2">{t.wsTitle}</div>
          <div className="text-sm text-ink-3 leading-relaxed">{t.wsBody}</div>
          <div className="mt-4 text-xs font-mono text-primary">
            {busy ? t.wsCreating : ws ? t.wsResume.replace('{time}', new Date(ws.expires_at).toLocaleTimeString()) : t.wsStart}
          </div>
          {ws && (
            <span
              role="button"
              onClick={copyShare}
              className="mt-2 inline-block text-xs font-mono text-ink-3 underline decoration-dotted hover:text-primary"
            >
              {copied ? t.wsCopied : t.wsCopy}
            </span>
          )}
          {err && <div className="mt-2 text-xs text-danger">{err}</div>}
        </button>

        <Link to="/dashboard" className={card}>
          <div className="text-base font-medium text-foreground mb-2">{t.roomTitle}</div>
          <div className="text-sm text-ink-3 leading-relaxed">{t.roomBody}</div>
          <div className="mt-4 text-xs font-mono text-primary">{t.roomCta}</div>
        </Link>
      </div>
    </div>
  );
}

import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { getDemoWorkspace } from '@/services/api';
import { adoptWorkspace, decodeShareFragment } from '@/lib/demoWorkspace';
import { useLang, type Lang } from '@/lib/i18n';

/**
 * P3 shareable URL: /join#<payload>. The fragment carries the workspace
 * session (id + clone keys) and never reaches any server. Before adopting
 * it we ask the gateway whether the session is still alive — an expired or
 * torn-down workspace is reported honestly, not silently recreated.
 */

const T: Record<Lang, Record<string, string>> = {
  en: {
    checking: 'Checking this workspace with the gateway…',
    back: '← Back to the entrance (you can start a fresh workspace there)',
    invalidTitle: 'Invalid share link',
    invalidBody: 'This link does not carry a valid workspace payload — it may have been truncated when copied.',
    expiredTitle: 'This workspace has expired',
    expiredBody: 'Shared workspaces live ~60 minutes, then the janitor revokes their credentials and removes their agents. Nothing is recoverable — by design. Start a fresh one from the entrance.',
    offlineTitle: 'The gateway is unreachable',
    offlineBody: 'This link points at a live workspace session, but the BAWABA stack did not answer. Nothing is simulated: start the stack (docker compose up --build -d) or check the shared host, then reload.',
  },
  fr: {
    checking: 'Vérification de cet espace auprès de la passerelle…',
    back: '← Retour à l’entrée (vous pouvez y démarrer un nouvel espace)',
    invalidTitle: 'Lien de partage invalide',
    invalidBody: 'Ce lien ne contient pas de charge utile d’espace valide — il a peut-être été tronqué lors de la copie.',
    expiredTitle: 'Cet espace a expiré',
    expiredBody: 'Les espaces partagés vivent ~60 minutes, puis le janitor révoque leurs identifiants et supprime leurs agents. Rien n’est récupérable — c’est voulu. Démarrez-en un nouveau depuis l’entrée.',
    offlineTitle: 'La passerelle est injoignable',
    offlineBody: 'Ce lien pointe vers une session d’espace active, mais la stack BAWABA n’a pas répondu. Rien n’est simulé : démarrez la stack (docker compose up --build -d) ou vérifiez l’hôte partagé, puis rechargez.',
  },
};

export default function Join() {
  const navigate = useNavigate();
  const t = T[useLang()];
  const [state, setState] = useState<'checking' | 'invalid' | 'expired' | 'offline'>('checking');

  useEffect(() => {
    (async () => {
      let ws;
      try {
        ws = decodeShareFragment(window.location.hash);
      } catch {
        setState('invalid');
        return;
      }
      try {
        const status = await getDemoWorkspace(ws.session_id);
        if (status.expired || new Date(ws.expires_at).getTime() < Date.now()) {
          setState('expired');
          return;
        }
      } catch {
        setState('offline');
        return;
      }
      adoptWorkspace(ws);
      // Drop the fragment from the address bar once adopted.
      window.history.replaceState(null, '', '/demo');
      navigate('/demo', { replace: true });
    })();
  }, [navigate]);

  const box = (title: string, body: string) => (
    <div className="min-h-screen bg-background flex items-center justify-center px-6">
      <div className="max-w-md border border-border bg-card rounded-[6px] p-8 text-sm">
        <div className="text-base font-medium text-foreground mb-2">{title}</div>
        <p className="text-ink-2 leading-relaxed mb-4">{body}</p>
        <Link to="/" className="text-xs font-mono text-primary">{t.back}</Link>
      </div>
    </div>
  );

  if (state === 'checking') return <div className="min-h-screen bg-background flex items-center justify-center text-sm text-ink-3">{t.checking}</div>;
  if (state === 'invalid') return box(t.invalidTitle, t.invalidBody);
  if (state === 'expired') return box(t.expiredTitle, t.expiredBody);
  return box(t.offlineTitle, t.offlineBody);
}

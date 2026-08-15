import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { getDemoWorkspace } from '@/services/api';
import { adoptWorkspace, decodeShareFragment } from '@/lib/demoWorkspace';

/**
 * P3 shareable URL: /join#<payload>. The fragment carries the workspace
 * session (id + clone keys) and never reaches any server. Before adopting
 * it we ask the gateway whether the session is still alive — an expired or
 * torn-down workspace is reported honestly, not silently recreated.
 */
export default function Join() {
  const navigate = useNavigate();
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
        <Link to="/" className="text-xs font-mono text-primary">← Back to the entrance (you can start a fresh workspace there)</Link>
      </div>
    </div>
  );

  if (state === 'checking') return <div className="min-h-screen bg-background flex items-center justify-center text-sm text-ink-3">Checking this workspace with the gateway…</div>;
  if (state === 'invalid') return box('Invalid share link', 'This link does not carry a valid workspace payload — it may have been truncated when copied.');
  if (state === 'expired') return box('This workspace has expired', 'Shared workspaces live ~60 minutes, then the janitor revokes their credentials and removes their agents. Nothing is recoverable — by design. Start a fresh one from the entrance.');
  return box('The gateway is unreachable', 'This link points at a live workspace session, but the BAWABA stack did not answer. Nothing is simulated: start the stack (docker compose up --build -d) or check the shared host, then reload.');
}

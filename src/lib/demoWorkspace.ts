import { createDemoWorkspace, getDemoWorkspace, type DemoWorkspace } from '@/services/api';

/**
 * P2 ephemeral workspace client state. The visitor's session (agents + keys,
 * shown once by the API) lives in sessionStorage only — closing the tab or
 * hitting the ~60 min expiry loses it, by design. The canonical seeded
 * agents are never touched by workspace edits.
 */
const KEY = 'bawaba-demo-workspace';

export function activeWorkspace(): DemoWorkspace | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return null;
    const ws = JSON.parse(raw) as DemoWorkspace;
    if (new Date(ws.expires_at).getTime() < Date.now()) {
      sessionStorage.removeItem(KEY);
      return null;
    }
    return ws;
  } catch {
    return null;
  }
}

export async function startWorkspace(): Promise<DemoWorkspace> {
  const ws = await createDemoWorkspace();
  sessionStorage.setItem(KEY, JSON.stringify(ws));
  return ws;
}

export function clearWorkspace(): void {
  sessionStorage.removeItem(KEY);
}

/** Resolve an agent id+key: the workspace clone when active, else the shared seeded default. */
export function resolveAgent(template: string, fallbackId: string, fallbackKey: string): { agentId: string; apiKey: string; workspace: boolean } {
  const ws = activeWorkspace();
  const hit = ws?.agents.find(a => a.template === template);
  return hit
    ? { agentId: hit.agent_id, apiKey: hit.api_key, workspace: true }
    : { agentId: fallbackId, apiKey: fallbackKey, workspace: false };
}

// ── P3: shareable workspace link ───────────────────────────────────────────
// The workspace payload (session id + clone agent keys, shown once by the
// API) is carried in the URL FRAGMENT: fragments never leave the browser —
// no server, proxy or access log ever sees the keys. The link is only as
// durable as the session itself (~60 min, janitor-enforced server-side).

/** Build a /join#… link carrying the active workspace, or null if none. */
export function shareLink(): string | null {
  const ws = activeWorkspace();
  if (!ws) return null;
  const payload = btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(ws))))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `${window.location.origin}/join#${payload}`;
}

/** Decode a /join fragment back into a workspace payload (throws on garbage). */
export function decodeShareFragment(fragment: string): DemoWorkspace {
  const b64 = fragment.replace(/^#/, '').replace(/-/g, '+').replace(/_/g, '/');
  const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
  const ws = JSON.parse(new TextDecoder().decode(bytes)) as DemoWorkspace;
  if (!ws.session_id || !Array.isArray(ws.agents) || !ws.expires_at) {
    throw new Error('This link does not carry a valid workspace payload.');
  }
  return ws;
}

/** Adopt a workspace received via a share link (after server-side validation). */
export function adoptWorkspace(ws: DemoWorkspace): void {
  sessionStorage.setItem(KEY, JSON.stringify(ws));
}

/** Re-check server-side state (janitor may have expired it early). */
export async function refreshWorkspace(): Promise<DemoWorkspace | null> {
  const ws = activeWorkspace();
  if (!ws) return null;
  try {
    const status = await getDemoWorkspace(ws.session_id);
    if (status.expired) {
      clearWorkspace();
      return null;
    }
  } catch {
    clearWorkspace();
    return null;
  }
  return ws;
}

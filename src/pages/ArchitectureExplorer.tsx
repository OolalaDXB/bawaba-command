import { useState } from 'react';
import { X } from 'lucide-react';

type Persona = 'engineer' | 'ciso' | 'vc';
type PersonaContent = Record<Persona, string>;

/**
 * Everything on this page is derived from the real codebase:
 *  - the pipeline mirrors internal/proxy/proxy.go (handleToolsCall)
 *  - module LOC come from `wc -l` on non-test sources per package
 *  - the commit list is `git log --oneline -8`
 * No invented modules, metrics, or commits.
 */

interface PipelineStage {
  id: string;
  name: string;
  tagline: string;
  lang: 'Go' | 'Rust';
  loc: number;
  file: string;
  persona: PersonaContent;
  verify: string;
}

interface Module {
  pkg: string;
  lang: 'Go' | 'Rust' | 'TS';
  loc: number;
  path: string;
  detail: string;
}

interface Commit {
  hash: string;
  subject: string;
  date: string;
}

type DrawerContent =
  | { type: 'stage'; stage: PipelineStage }
  | { type: 'module'; module: Module }
  | { type: 'commit'; commit: Commit };

// ── Pipeline — the 6 stages as implemented in internal/proxy ────────────────

const PIPELINE: PipelineStage[] = [
  {
    id: '1',
    name: 'Identity',
    tagline: 'API key (bcrypt) / Bearer pilot',
    lang: 'Go',
    loc: 253,
    file: 'internal/auth/auth.go — Authenticate(), RegisterAPIKey()',
    persona: {
      engineer:
        'Authenticate() resolves the caller before anything else runs: it tries the API key path first (authenticateAPIKey), then a Bearer/OAuth2 token (authenticateBearer). API keys are stored only as bcrypt hashes (bcrypt.GenerateFromPassword at DefaultCost) — never in plaintext.',
      ciso:
        'No shared secret is ever persisted in the clear; only bcrypt hashes are kept. Bearer/OAuth2 is a pilot path that runs alongside API keys. Every request produces an AgentIdentity{AgentID, TenantID} that the rest of the pipeline keys off.',
      vc:
        'Identity is the anchor for tenant isolation: every downstream decision — policy, tokenization scope, routing, audit — is bound to the authenticated agent and tenant.',
    },
    verify: 'grep bcrypt internal/auth/auth.go · authenticateAPIKey / authenticateBearer',
  },
  {
    id: '2',
    name: 'Policy',
    tagline: 'default-deny, YAML config',
    lang: 'Go',
    loc: 124,
    file: 'internal/policy/policy.go — Evaluate()',
    persona: {
      engineer:
        'Evaluate() is fail-closed. Denied tools are checked first (deny wins). An agent with an empty allowed_tools list is denied everything. When nothing matches, the result is default_deny. The decision carries PolicyVersion and MatchedRule.',
      ciso:
        'Authorization defaults to deny, not allow. Each decision records the matched rule and policy version, and both flow into the audit event so every allow/deny is attributable.',
      vc:
        'Access is policy-as-config: allow/deny per agent × tool, read from bawaba.yaml and versioned — no code change needed to re-scope an agent.',
    },
    verify: 'internal/policy/policy.go — MatchedRule "default_deny", denied-tools-first',
  },
  {
    id: '3',
    name: 'Data',
    tagline: 'PII tokenization (Rust), 7 MENA patterns',
    lang: 'Rust',
    loc: 395,
    file: 'rust/tokenizer/src/regex.rs — PATTERNS, luhn_check()',
    persona: {
      engineer:
        'The Rust tokenizer scans arguments with 7 compiled regex patterns: iban, email, phone, emirates_id, card, ksa_nid, morocco_cin. Card matches are Luhn-checked. Matches are swapped for UUID tokens held in a vault scoped to tenant_id:agent_id, then de-tokenized on the response path. Called from Go over cgo FFI (internal/tokenizer).',
      ciso:
        'PII is replaced before the request leaves the gateway. The vault is keyed by tenant_id:agent_id and has a TTL — once it expires, de-tokenization is impossible and the original values are gone.',
      vc:
        'Coverage is MENA-native: Morocco CIN, KSA National ID / Iqama, and UAE Emirates ID are first-class patterns — sovereign identifier formats generic scanners miss.',
    },
    verify: 'rust/tokenizer/src/regex.rs — PATTERNS (7), luhn_check · internal/tokenizer/tokenizer.go (cgo)',
  },
  {
    id: '4',
    name: 'Jurisdiction',
    tagline: 'routing decision + Ed25519 proof',
    lang: 'Go',
    loc: 137,
    file: 'internal/router/router.go — Route(), generateProof()',
    persona: {
      engineer:
        'Route(tenantID, jurisdiction, requestID) selects the sovereign backend and returns an Ed25519-signed proof over the canonical decision. The nonce is derived deterministically from the requestID, so the same request yields the same verifiable proof.',
      ciso:
        'Jurisdiction resolution is fail-closed on unknown values. Every routing decision is independently verifiable offline using only the Ed25519 public key — no access to the gateway required.',
      vc:
        'Each request carries a cryptographic sovereignty proof: the auditable artifact that answers "where did this data go, and can you prove it?".',
    },
    verify: 'internal/router/router.go — crypto/ed25519, generateProof(), deterministic nonce',
  },
  {
    id: '5',
    name: 'Rate',
    tagline: 'sliding window + anomaly detection',
    lang: 'Go',
    loc: 166,
    file: 'internal/ratelimit/ratelimit.go — SlidingWindow, AnomalyDetector',
    persona: {
      engineer:
        'A SlidingWindow limiter enforces limit/window parsed from config (per-second/minute/hour/day). An AnomalyDetector.RecordRead() flags sequential bulk reads over a threshold within a window and raises a separate "anomaly" audit event with matched rule sequential_bulk_read.',
      ciso:
        'Beyond a 429, bulk-exfiltration-shaped access raises an anomaly alert into the audit trail — a behavioural signal, not just a counter.',
      vc:
        'One layer gives both usage metering and an abuse/anomaly signal, reused by the dashboard and SIEM export.',
    },
    verify: 'internal/ratelimit/ratelimit.go — SlidingWindow, AnomalyDetector.RecordRead · proxy.go emits "anomaly"',
  },
  {
    id: '6',
    name: 'Evidence',
    tagline: 'SHA-256 chain, append-only Postgres',
    lang: 'Go',
    loc: 296,
    file: 'internal/audit/audit.go — Append(), VerifyChain()',
    persona: {
      engineer:
        "Each event's SHA-256 hash chains to the previous one (starting from a genesis root), is Ed25519-signed, and is INSERTed into the Postgres audit_events table — never updated or deleted. VerifyChain() recomputes every hash and checks every signature.",
      ciso:
        'The trail is append-only and tamper-evident. Changing a single field breaks the hash chain and fails VerifyChain(), which is exactly what an auditor re-runs.',
      vc:
        'Evidence exports as JSON and is verifiable offline by the bawaba CLI without server access — a portable compliance artifact.',
    },
    verify: 'internal/audit/audit.go — crypto/sha256 chain, INSERT-only, VerifyChain() · cmd/cli offline verifier',
  },
];

// ── Modules — real packages, LOC = wc -l on non-test sources ────────────────

const MODULES: Module[] = [
  { pkg: 'internal/api', lang: 'Go', loc: 1289, path: 'internal/api/', detail: 'HTTP API server, SSE stream and quota endpoints that back the dashboard.' },
  { pkg: 'internal/proxy', lang: 'Go', loc: 600, path: 'internal/proxy/', detail: 'The MCP gateway itself — orchestrates the 6-stage pipeline in ServeHTTP / handleToolsCall.' },
  { pkg: 'rust/tokenizer', lang: 'Rust', loc: 395, path: 'rust/tokenizer/', detail: 'PII detection + tokenization vault. 7 regex patterns and Luhn validation, exposed to Go via cgo.' },
  { pkg: 'cmd/cli', lang: 'Go', loc: 301, path: 'cmd/cli/', detail: 'The bawaba CLI, including the offline evidence-chain verifier.' },
  { pkg: 'internal/audit', lang: 'Go', loc: 296, path: 'internal/audit/', detail: 'Append-only, SHA-256-chained, Ed25519-signed audit trail with VerifyChain().' },
  { pkg: 'cmd/gateway', lang: 'Go', loc: 265, path: 'cmd/gateway/', detail: 'Gateway binary entrypoint: wires config, auth, policy, tokenizer, router and audit together.' },
  { pkg: 'internal/auth', lang: 'Go', loc: 253, path: 'internal/auth/', detail: 'API-key (bcrypt) and Bearer/OAuth2 authentication, agent registry.' },
  { pkg: 'internal/siem', lang: 'Go', loc: 184, path: 'internal/siem/', detail: 'SIEM export: webhook sink and a no-op sink for local runs.' },
  { pkg: 'internal/config', lang: 'Go', loc: 179, path: 'internal/config/', detail: 'Loads and validates bawaba.yaml (agents, policies, routing, pii_mode).' },
  { pkg: 'internal/ratelimit', lang: 'Go', loc: 166, path: 'internal/ratelimit/', detail: 'Sliding-window rate limiter and sequential-bulk-read anomaly detector.' },
  { pkg: 'internal/router', lang: 'Go', loc: 137, path: 'internal/router/', detail: 'Sovereign routing with Ed25519-signed, offline-verifiable routing proofs.' },
  { pkg: 'internal/policy', lang: 'Go', loc: 124, path: 'internal/policy/', detail: 'Default-deny policy evaluation from YAML config.' },
  { pkg: 'internal/tokenizer', lang: 'Go', loc: 73, path: 'internal/tokenizer/', detail: 'cgo binding to the Rust tokenizer: Tokenize() / Detokenize().' },
  { pkg: 'src (dashboard)', lang: 'TS', loc: 9429, path: 'src/', detail: 'React + Tailwind single-page dashboard (this UI).' },
];

// ── Commits — git log --oneline -8 (verbatim) ───────────────────────────────

const COMMITS: Commit[] = [
  { hash: 'c0ca061', subject: 'demo: full English UI, fictional tenants, simulated-data banner, tokenize-only', date: '2026-07-28' },
  { hash: 'ab48490', subject: 'demo: fictional tenant names + simulated-data banner (#2)', date: '2026-07-28' },
  { hash: '21ad814', subject: 'feat(map): replace hand-drawn SVG with proper world map using react-simple-maps', date: '2026-03-05' },
  { hash: '877a604', subject: 'fix(sse): flush response headers immediately to unblock clients', date: '2026-03-05' },
  { hash: '5bd4ea8', subject: 'fix(ci): fix all failing CI tests and translate UI to English', date: '2026-03-05' },
  { hash: '63c53d8', subject: 'fix(ui): enrichir tooltips, hints et drawers sur toutes les pages', date: '2026-03-05' },
  { hash: 'b50e3d2', subject: 'feat(dashboard): traduction FR complète, InfoTooltip et drawers détail', date: '2026-03-05' },
  { hash: 'd47aa9a', subject: 'feat(dashboard): add Architecture Explorer page with persona switch', date: '2026-03-05' },
];

// ── Helpers ─────────────────────────────────────────────────────────────────

const LANG_COLORS: Record<Module['lang'], string> = {
  Go: 'bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300',
  Rust: 'bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300',
  TS: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
};

const PERSONA_LABELS: Record<Persona, string> = { engineer: 'Engineer', ciso: 'CISO', vc: 'VC' };

// ── Component ─────────────────────────────────────────────────────────────────

export default function ArchitectureExplorer() {
  const [persona, setPersona] = useState<Persona>('engineer');
  const [drawer, setDrawer] = useState<DrawerContent | null>(null);

  return (
    <div className="space-y-6">
      {/* Persona switch */}
      <div className="flex items-center justify-between">
        <div className="text-[11px] text-muted-foreground font-body max-w-[640px]">
          Rebuilt from the real gateway: the pipeline mirrors <span className="font-mono">internal/proxy</span>, module sizes are
          <span className="font-mono"> wc -l</span> per package, and the commit list is <span className="font-mono">git log</span>.
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {(['engineer', 'ciso', 'vc'] as Persona[]).map(p => (
            <button
              key={p}
              onClick={() => setPersona(p)}
              className={`px-4 py-1.5 text-xs font-medium rounded transition-colors ${
                persona === p ? 'bg-primary text-primary-foreground' : 'bg-secondary text-muted-foreground hover:text-foreground'
              }`}
            >
              {PERSONA_LABELS[p]}
            </button>
          ))}
        </div>
      </div>

      {/* Pipeline */}
      <section>
        <div className="table-header mb-3">Request pipeline — 6 stages (internal/proxy)</div>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {PIPELINE.map((stage, i) => (
            <button
              key={stage.id}
              onClick={() => setDrawer({ type: 'stage', stage })}
              className="card-surface shadow-card p-4 text-left hover:bg-secondary/30 transition-colors relative"
            >
              <div className="flex items-baseline gap-2 mb-1">
                <span className="text-xs font-mono text-muted-foreground">{stage.id}</span>
                <span className="text-sm font-heading font-medium text-foreground">{stage.name}</span>
                <span className={`ml-auto text-[10px] font-mono px-1.5 py-0.5 rounded ${LANG_COLORS[stage.lang]}`}>{stage.lang}</span>
              </div>
              <p className="text-xs text-muted-foreground leading-relaxed">{stage.tagline}</p>
              <div className="text-[10px] font-mono text-ink-4 mt-2">{stage.loc} LOC</div>
              {i < PIPELINE.length - 1 && (
                <span className="hidden xl:block absolute -right-2 top-1/2 -translate-y-1/2 text-ink-4 text-xs">→</span>
              )}
            </button>
          ))}
        </div>
      </section>

      {/* Modules */}
      <section>
        <div className="table-header mb-3">Modules (real packages · LOC from wc -l)</div>
        <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
          {MODULES.map(mod => (
            <button
              key={mod.pkg}
              onClick={() => setDrawer({ type: 'module', module: mod })}
              className="card-surface shadow-card p-4 text-left hover:bg-secondary/30 transition-colors"
            >
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-heading font-medium text-foreground truncate">{mod.pkg}</span>
                <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded shrink-0 ${LANG_COLORS[mod.lang]}`}>{mod.lang}</span>
              </div>
              <div className="text-[11px] font-mono text-muted-foreground mb-2 truncate">{mod.path}</div>
              <span className="text-[10px] text-muted-foreground">{mod.loc.toLocaleString()} LOC</span>
            </button>
          ))}
        </div>
      </section>

      {/* Commits */}
      <section>
        <div className="table-header mb-3">Latest commits — git log --oneline -8</div>
        <div className="space-y-1">
          {COMMITS.map(commit => (
            <button
              key={commit.hash}
              onClick={() => setDrawer({ type: 'commit', commit })}
              className="card-surface shadow-card w-full p-3 text-left hover:bg-secondary/30 transition-colors flex items-center gap-4"
            >
              <span className="text-xs font-mono text-primary shrink-0">{commit.hash}</span>
              <span className="text-xs text-foreground flex-1 truncate">{commit.subject}</span>
              <span className="text-[11px] text-muted-foreground shrink-0">{commit.date}</span>
            </button>
          ))}
        </div>
      </section>

      {/* Detail drawer */}
      {drawer && (
        <>
          <div className="fixed inset-0 bg-foreground/5 z-40" onClick={() => setDrawer(null)} />
          <div className="fixed inset-y-0 right-0 w-[480px] bg-card border-l border-border z-50 overflow-y-auto shadow-card">
            <div className="flex items-center justify-between p-5 border-b border-border">
              <div>
                <div className="text-lg font-heading text-foreground">
                  {drawer.type === 'stage' && `${drawer.stage.id} — ${drawer.stage.name}`}
                  {drawer.type === 'module' && drawer.module.pkg}
                  {drawer.type === 'commit' && drawer.commit.hash}
                </div>
                <div className="text-xs text-muted-foreground font-mono">
                  {drawer.type === 'stage' && 'Pipeline stage'}
                  {drawer.type === 'module' && drawer.module.path}
                  {drawer.type === 'commit' && drawer.commit.date}
                </div>
              </div>
              <button onClick={() => setDrawer(null)} className="text-muted-foreground hover:text-foreground transition-colors">
                <X className="h-4 w-4" strokeWidth={1.5} />
              </button>
            </div>

            <div className="p-5 space-y-6">
              {drawer.type === 'stage' && (
                <>
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Viewing as</span>
                    <span className="text-xs font-medium px-2 py-0.5 rounded bg-primary text-primary-foreground">{PERSONA_LABELS[persona]}</span>
                    <span className={`ml-auto text-[10px] font-mono px-2 py-0.5 rounded ${LANG_COLORS[drawer.stage.lang]}`}>{drawer.stage.lang}</span>
                    <span className="text-xs text-muted-foreground">{drawer.stage.loc} LOC</span>
                  </div>
                  <DrawerSection title="What it does" content={drawer.stage.persona[persona]} />
                  <DrawerSection title="Source" content={drawer.stage.file} mono />
                  <DrawerSection title="Verify in code" content={drawer.stage.verify} mono />
                </>
              )}

              {drawer.type === 'module' && (
                <>
                  <div className="flex items-center gap-3">
                    <span className={`text-[10px] font-mono px-2 py-1 rounded ${LANG_COLORS[drawer.module.lang]}`}>{drawer.module.lang}</span>
                    <span className="text-xs text-muted-foreground">{drawer.module.loc.toLocaleString()} LOC</span>
                    <span className="text-xs font-mono text-muted-foreground">{drawer.module.path}</span>
                  </div>
                  <DrawerSection title="Detail" content={drawer.module.detail} />
                </>
              )}

              {drawer.type === 'commit' && (
                <>
                  <div className="text-sm text-foreground">{drawer.commit.subject}</div>
                  <DrawerSection title="Commit" content={`${drawer.commit.hash} · ${drawer.commit.date}`} mono />
                  <div className="text-[10px] text-muted-foreground bg-muted/40 rounded p-2">
                    Verbatim from <span className="font-mono">git log --oneline -8</span> on this repository.
                  </div>
                </>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function DrawerSection({ title, content, mono }: { title: string; content: string; mono?: boolean }) {
  return (
    <div>
      <div className="table-header mb-1.5">{title}</div>
      <p className={`leading-relaxed text-foreground ${mono ? 'font-mono text-xs break-words' : 'text-sm'}`}>{content}</p>
    </div>
  );
}

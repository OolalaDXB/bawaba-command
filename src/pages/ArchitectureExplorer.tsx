import { useState } from 'react';
import { X } from 'lucide-react';
import { useLang, type Lang } from '@/lib/i18n';

type Persona = 'engineer' | 'ciso' | 'vc';
type PersonaContent = Record<Persona, string>;

/**
 * Everything on this page is derived from the real codebase:
 *  - the pipeline mirrors internal/proxy/proxy.go (handleToolsCall)
 *  - module LOC come from `wc -l` on non-test sources per package
 *  - the commit list is `git log --oneline -8`
 * No invented modules, metrics, or commits.
 */

const T: Record<Lang, Record<string, string>> = {
  en: {
    introA: 'Rebuilt from the real gateway: the pipeline mirrors ',
    introB: ', module sizes are',
    introC: ' per package, and the commit list is ',
    introD: '.',
    pipelineHeader: 'Request pipeline — 6 stages (internal/proxy)',
    modulesHeader: 'Modules (real packages · LOC from wc -l)',
    commitsHeader: 'Latest commits — git log --oneline -8',
    pipelineStage: 'Pipeline stage',
    viewingAs: 'Viewing as',
    whatItDoes: 'What it does',
    source: 'Source',
    verifyInCode: 'Verify in code',
    detail: 'Detail',
    commit: 'Commit',
    verbatimA: 'Verbatim from ',
    verbatimB: ' on this repository.',
    personaEngineer: 'Engineer',
    personaCiso: 'CISO',
    personaVc: 'VC',
  },
  fr: {
    introA: 'Reconstruit depuis la passerelle réelle : le pipeline reflète ',
    introB: ', la taille des modules provient de',
    introC: ' par package, et la liste des commits est ',
    introD: '.',
    pipelineHeader: 'Pipeline de requête — 6 étapes (internal/proxy)',
    modulesHeader: 'Modules (packages réels · LOC via wc -l)',
    commitsHeader: 'Derniers commits — git log --oneline -8',
    pipelineStage: 'Étape du pipeline',
    viewingAs: 'Vue en tant que',
    whatItDoes: 'Ce que ça fait',
    source: 'Source',
    verifyInCode: 'Vérifier dans le code',
    detail: 'Détail',
    commit: 'Commit',
    verbatimA: 'Verbatim de ',
    verbatimB: ' sur ce dépôt.',
    personaEngineer: 'Ingénieur',
    personaCiso: 'RSSI',
    personaVc: 'VC',
  },
};

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

const PIPELINE: Record<Lang, PipelineStage[]> = {
  en: [
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
  ],
  fr: [
  {
    id: '1',
    name: 'Identité',
    tagline: 'Clé API (bcrypt) / Bearer pilote',
    lang: 'Go',
    loc: 253,
    file: 'internal/auth/auth.go — Authenticate(), RegisterAPIKey()',
    persona: {
      engineer:
        'Authenticate() résout l’appelant avant toute autre exécution : il tente d’abord la voie clé API (authenticateAPIKey), puis un jeton Bearer/OAuth2 (authenticateBearer). Les clés API ne sont stockées que sous forme de hachages bcrypt (bcrypt.GenerateFromPassword à DefaultCost) — jamais en clair.',
      ciso:
        'Aucun secret partagé n’est jamais persisté en clair ; seuls les hachages bcrypt sont conservés. Bearer/OAuth2 est une voie pilote qui fonctionne en parallèle des clés API. Chaque requête produit une AgentIdentity{AgentID, TenantID} sur laquelle s’appuie le reste du pipeline.',
      vc:
        'L’identité est l’ancre de l’isolation par tenant : chaque décision en aval — politique, périmètre de tokenisation, routage, audit — est liée à l’agent et au tenant authentifiés.',
    },
    verify: 'grep bcrypt internal/auth/auth.go · authenticateAPIKey / authenticateBearer',
  },
  {
    id: '2',
    name: 'Politique',
    tagline: 'default-deny, configuration YAML',
    lang: 'Go',
    loc: 124,
    file: 'internal/policy/policy.go — Evaluate()',
    persona: {
      engineer:
        'Evaluate() est fail-closed. Les outils refusés sont vérifiés en premier (le refus l’emporte). Un agent avec une liste allowed_tools vide se voit tout refuser. Quand rien ne correspond, le résultat est default_deny. La décision porte PolicyVersion et MatchedRule.',
      ciso:
        'L’autorisation est refusée par défaut, pas accordée. Chaque décision enregistre la règle correspondante et la version de politique, et les deux alimentent l’événement d’audit, de sorte que chaque allow/deny est attribuable.',
      vc:
        'L’accès est de la politique-en-configuration : allow/deny par agent × outil, lu depuis bawaba.yaml et versionné — aucun changement de code n’est nécessaire pour redéfinir le périmètre d’un agent.',
    },
    verify: 'internal/policy/policy.go — MatchedRule "default_deny", denied-tools-first',
  },
  {
    id: '3',
    name: 'Données',
    tagline: 'Tokenisation PII (Rust), 7 motifs MENA',
    lang: 'Rust',
    loc: 395,
    file: 'rust/tokenizer/src/regex.rs — PATTERNS, luhn_check()',
    persona: {
      engineer:
        'Le tokeniseur Rust analyse les arguments avec 7 motifs regex compilés : iban, email, phone, emirates_id, card, ksa_nid, morocco_cin. Les correspondances de carte sont validées par Luhn. Les correspondances sont remplacées par des jetons UUID conservés dans un coffre au périmètre tenant_id:agent_id, puis détokenisées sur le chemin de réponse. Appelé depuis Go via FFI cgo (internal/tokenizer).',
      ciso:
        'Les PII sont remplacées avant que la requête ne quitte la passerelle. Le coffre est indexé par tenant_id:agent_id et possède un TTL — une fois expiré, la détokenisation est impossible et les valeurs d’origine ont disparu.',
      vc:
        'La couverture est nativement MENA : la CIN marocaine, le KSA National ID / Iqama et l’Emirates ID des Émirats sont des motifs de premier rang — des formats d’identifiants souverains que les scanners génériques manquent.',
    },
    verify: 'rust/tokenizer/src/regex.rs — PATTERNS (7), luhn_check · internal/tokenizer/tokenizer.go (cgo)',
  },
  {
    id: '4',
    name: 'Juridiction',
    tagline: 'décision de routage + preuve Ed25519',
    lang: 'Go',
    loc: 137,
    file: 'internal/router/router.go — Route(), generateProof()',
    persona: {
      engineer:
        'Route(tenantID, jurisdiction, requestID) sélectionne le backend souverain et renvoie une preuve signée Ed25519 sur la décision canonique. Le nonce est dérivé de manière déterministe du requestID, si bien que la même requête produit la même preuve vérifiable.',
      ciso:
        'La résolution de juridiction est fail-closed sur les valeurs inconnues. Chaque décision de routage est vérifiable indépendamment, hors ligne, avec la seule clé publique Ed25519 — aucun accès à la passerelle n’est requis.',
      vc:
        'Chaque requête porte une preuve cryptographique de souveraineté : l’artefact auditable qui répond à « où sont allées ces données, et pouvez-vous le prouver ? ».',
    },
    verify: 'internal/router/router.go — crypto/ed25519, generateProof(), deterministic nonce',
  },
  {
    id: '5',
    name: 'Débit',
    tagline: 'fenêtre glissante + détection d’anomalies',
    lang: 'Go',
    loc: 166,
    file: 'internal/ratelimit/ratelimit.go — SlidingWindow, AnomalyDetector',
    persona: {
      engineer:
        'Un limiteur SlidingWindow applique limit/window lus depuis la configuration (par seconde/minute/heure/jour). AnomalyDetector.RecordRead() signale les lectures massives séquentielles au-delà d’un seuil dans une fenêtre et émet un événement d’audit « anomaly » distinct avec la règle correspondante sequential_bulk_read.',
      ciso:
        'Au-delà d’un 429, un accès en forme d’exfiltration massive déclenche une alerte d’anomalie dans la piste d’audit — un signal comportemental, pas seulement un compteur.',
      vc:
        'Une seule couche fournit à la fois le comptage d’usage et un signal d’abus/anomalie, réutilisés par le tableau de bord et l’export SIEM.',
    },
    verify: 'internal/ratelimit/ratelimit.go — SlidingWindow, AnomalyDetector.RecordRead · proxy.go emits "anomaly"',
  },
  {
    id: '6',
    name: 'Preuve',
    tagline: 'chaîne SHA-256, Postgres append-only',
    lang: 'Go',
    loc: 296,
    file: 'internal/audit/audit.go — Append(), VerifyChain()',
    persona: {
      engineer:
        'Le hachage SHA-256 de chaque événement est chaîné au précédent (à partir d’une racine genesis), signé Ed25519, et inséré (INSERT) dans la table Postgres audit_events — jamais mis à jour ni supprimé. VerifyChain() recalcule chaque hachage et vérifie chaque signature.',
      ciso:
        'La piste est append-only et à preuve d’altération. Modifier un seul champ rompt la chaîne de hachage et fait échouer VerifyChain(), qui est exactement ce qu’un auditeur ré-exécute.',
      vc:
        'Les preuves s’exportent en JSON et sont vérifiables hors ligne par la CLI bawaba sans accès serveur — un artefact de conformité portable.',
    },
    verify: 'internal/audit/audit.go — crypto/sha256 chain, INSERT-only, VerifyChain() · cmd/cli offline verifier',
  },
  ],
};

// ── Modules — real packages, LOC = wc -l on non-test sources ────────────────

const MODULES: Record<Lang, Module[]> = {
  en: [
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
  ],
  fr: [
  { pkg: 'internal/api', lang: 'Go', loc: 1289, path: 'internal/api/', detail: 'Serveur d’API HTTP, flux SSE et points de terminaison de quota qui alimentent le tableau de bord.' },
  { pkg: 'internal/proxy', lang: 'Go', loc: 600, path: 'internal/proxy/', detail: 'La passerelle MCP elle-même — orchestre le pipeline en 6 étapes dans ServeHTTP / handleToolsCall.' },
  { pkg: 'rust/tokenizer', lang: 'Rust', loc: 395, path: 'rust/tokenizer/', detail: 'Détection PII + coffre de tokenisation. 7 motifs regex et validation Luhn, exposés à Go via cgo.' },
  { pkg: 'cmd/cli', lang: 'Go', loc: 301, path: 'cmd/cli/', detail: 'La CLI bawaba, dont le vérificateur hors ligne de la chaîne de preuves.' },
  { pkg: 'internal/audit', lang: 'Go', loc: 296, path: 'internal/audit/', detail: 'Piste d’audit append-only, chaînée SHA-256 et signée Ed25519, avec VerifyChain().' },
  { pkg: 'cmd/gateway', lang: 'Go', loc: 265, path: 'cmd/gateway/', detail: 'Point d’entrée du binaire de la passerelle : assemble config, auth, politique, tokeniseur, routeur et audit.' },
  { pkg: 'internal/auth', lang: 'Go', loc: 253, path: 'internal/auth/', detail: 'Authentification par clé API (bcrypt) et Bearer/OAuth2, registre des agents.' },
  { pkg: 'internal/siem', lang: 'Go', loc: 184, path: 'internal/siem/', detail: 'Export SIEM : puits webhook et puits no-op pour les exécutions locales.' },
  { pkg: 'internal/config', lang: 'Go', loc: 179, path: 'internal/config/', detail: 'Charge et valide bawaba.yaml (agents, politiques, routage, pii_mode).' },
  { pkg: 'internal/ratelimit', lang: 'Go', loc: 166, path: 'internal/ratelimit/', detail: 'Limiteur de débit à fenêtre glissante et détecteur d’anomalies de lectures massives séquentielles.' },
  { pkg: 'internal/router', lang: 'Go', loc: 137, path: 'internal/router/', detail: 'Routage souverain avec des preuves de routage signées Ed25519, vérifiables hors ligne.' },
  { pkg: 'internal/policy', lang: 'Go', loc: 124, path: 'internal/policy/', detail: 'Évaluation de politique default-deny depuis la configuration YAML.' },
  { pkg: 'internal/tokenizer', lang: 'Go', loc: 73, path: 'internal/tokenizer/', detail: 'Liaison cgo vers le tokeniseur Rust : Tokenize() / Detokenize().' },
  { pkg: 'src (dashboard)', lang: 'TS', loc: 9429, path: 'src/', detail: 'Tableau de bord monopage React + Tailwind (cette interface).' },
  ],
};

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

// ── Component ─────────────────────────────────────────────────────────────────

export default function ArchitectureExplorer() {
  const lang = useLang();
  const t = T[lang];
  const [persona, setPersona] = useState<Persona>('engineer');
  const [drawer, setDrawer] = useState<DrawerContent | null>(null);

  const personaLabels: Record<Persona, string> = {
    engineer: t.personaEngineer,
    ciso: t.personaCiso,
    vc: t.personaVc,
  };

  return (
    <div className="space-y-6">
      {/* Persona switch */}
      <div className="flex items-center justify-between">
        <div className="text-[11px] text-muted-foreground font-body max-w-[640px]">
          {t.introA}<span className="font-mono">internal/proxy</span>{t.introB}
          <span className="font-mono"> wc -l</span>{t.introC}<span className="font-mono">git log</span>{t.introD}
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
              {personaLabels[p]}
            </button>
          ))}
        </div>
      </div>

      {/* Pipeline */}
      <section>
        <div className="table-header mb-3">{t.pipelineHeader}</div>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {PIPELINE[lang].map((stage, i) => (
            <button
              key={stage.id}
              onClick={() => setDrawer({ type: 'stage', stage })}
              className="card-surface shadow-card p-4 text-left hover:bg-secondary/30 transition-colors relative"
            >
              <div className="flex items-baseline gap-2 mb-1">
                <span className="text-xs font-mono text-muted-foreground">{stage.id}</span>
                <span className="text-sm font-body font-medium text-foreground">{stage.name}</span>
                <span className={`ml-auto text-[11px] font-data px-1.5 py-0.5 rounded ${LANG_COLORS[stage.lang]}`}>{stage.lang}</span>
              </div>
              <p className="text-xs text-muted-foreground leading-relaxed">{stage.tagline}</p>
              <div className="text-[11px] font-data tabular-nums text-ink-3 mt-2">{stage.loc} LOC</div>
              {i < PIPELINE[lang].length - 1 && (
                <span className="hidden xl:block absolute -right-2 top-1/2 -translate-y-1/2 text-ink-4 text-xs">→</span>
              )}
            </button>
          ))}
        </div>
      </section>

      {/* Modules */}
      <section>
        <div className="table-header mb-3">{t.modulesHeader}</div>
        <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
          {MODULES[lang].map(mod => (
            <button
              key={mod.pkg}
              onClick={() => setDrawer({ type: 'module', module: mod })}
              className="card-surface shadow-card p-4 text-left hover:bg-secondary/30 transition-colors"
            >
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-body font-medium text-foreground truncate">{mod.pkg}</span>
                <span className={`text-[11px] font-data px-1.5 py-0.5 rounded shrink-0 ${LANG_COLORS[mod.lang]}`}>{mod.lang}</span>
              </div>
              <div className="text-[11px] font-mono text-muted-foreground mb-2 truncate">{mod.path}</div>
              <span className="text-[11px] font-data tabular-nums text-muted-foreground">{mod.loc.toLocaleString()} LOC</span>
            </button>
          ))}
        </div>
      </section>

      {/* Commits */}
      <section>
        <div className="table-header mb-3">{t.commitsHeader}</div>
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
                  {drawer.type === 'stage' && t.pipelineStage}
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
                    <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{t.viewingAs}</span>
                    <span className="text-xs font-medium px-2 py-0.5 rounded bg-primary text-primary-foreground">{personaLabels[persona]}</span>
                    <span className={`ml-auto text-[10px] font-mono px-2 py-0.5 rounded ${LANG_COLORS[drawer.stage.lang]}`}>{drawer.stage.lang}</span>
                    <span className="text-xs text-muted-foreground">{drawer.stage.loc} LOC</span>
                  </div>
                  <DrawerSection title={t.whatItDoes} content={drawer.stage.persona[persona]} />
                  <DrawerSection title={t.source} content={drawer.stage.file} mono />
                  <DrawerSection title={t.verifyInCode} content={drawer.stage.verify} mono />
                </>
              )}

              {drawer.type === 'module' && (
                <>
                  <div className="flex items-center gap-3">
                    <span className={`text-[10px] font-mono px-2 py-1 rounded ${LANG_COLORS[drawer.module.lang]}`}>{drawer.module.lang}</span>
                    <span className="text-xs text-muted-foreground">{drawer.module.loc.toLocaleString()} LOC</span>
                    <span className="text-xs font-mono text-muted-foreground">{drawer.module.path}</span>
                  </div>
                  <DrawerSection title={t.detail} content={drawer.module.detail} />
                </>
              )}

              {drawer.type === 'commit' && (
                <>
                  <div className="text-sm text-foreground">{drawer.commit.subject}</div>
                  <DrawerSection title={t.commit} content={`${drawer.commit.hash} · ${drawer.commit.date}`} mono />
                  <div className="text-[10px] text-muted-foreground bg-muted/40 rounded p-2">
                    {t.verbatimA}<span className="font-mono">git log --oneline -8</span>{t.verbatimB}
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

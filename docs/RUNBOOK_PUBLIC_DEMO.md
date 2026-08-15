# Runbook — demo.bawaba.systems en public

Tout le code est prêt (garde P3, workspaces éphémères, Souffleur, backend
réel). Ce qui manque est de l'infrastructure que seul l'opérateur peut
fournir : un VPS et une entrée DNS. Durée totale estimée : ~30 minutes.

## 0. Prérequis (à fournir par l'opérateur)

- Un VPS Ubuntu 22.04+ (OVHcloud recommandé — Europe, hors Cloud Act),
  2 vCPU / 4 Go suffisent pour la démo. Noter son IP publique.
- Accès DNS de bawaba.systems : créer `demo.bawaba.systems A <IP_VPS>`.
- La clé Mistral (Souffleur) sous la main — jamais dans git.

## 1. Déployer la stack sur le VPS

Depuis ton Mac, dans bawaba-command :

```bash
./scripts/deploy-ovh.sh <IP_VPS> demo.bawaba.systems
```

Puis, sur le VPS (`ssh ubuntu@<IP_VPS>`), créer `/opt/bawaba/.env` :

```
BAWABA_PUBLIC_DEMO=true
BAWABA_SOUFFLEUR_PROVIDER=mistral
BAWABA_SOUFFLEUR_API_KEY=<ta clé>
BAWABA_DB_PASSWORD=<mot de passe fort>
BAWABA_AGENT_KEY_test_agent=<clé forte>        # remplace les clés de dev
BAWABA_AGENT_KEY_payment_assistant=<clé forte> # idem pour chaque agent seedé
BAWABA_AGENT_KEY_finance_analyst_eu=<clé forte>
BAWABA_AGENT_KEY_burst_agent=<clé forte>
BAWABA_AGENT_KEY_apac_analyst=<clé forte>
```

`BAWABA_PUBLIC_DEMO=true` est la ligne qui compte : mutations limitées aux
clones `-demo-`, règles de routage read-only, agents canoniques
intouchables. Puis `docker compose up --build -d`.

NOTE clés seedées : avec des clés fortes secrètes, les visiteurs publics ne
peuvent PAS déclencher les scénarios sur les agents partagés — c'est voulu.
Le parcours public passe par le Private Workspace (clés générées par
session, montrées une fois). La Démo guidée détecte le workspace et
l'utilise.

## 2. TLS (obligatoire — le listener Go est en HTTP nu)

Caddy fait TLS + reverse proxy en un fichier. Sur le VPS :

```bash
sudo apt install -y caddy
sudo tee /etc/caddy/Caddyfile <<'EOF'
demo.bawaba.systems {
    # console statique
    root * /opt/bawaba/dist
    file_server
    # API REST
    handle_path /api/* {
        reverse_proxy localhost:8081
    }
    # gateway MCP
    handle_path /mcp* {
        reverse_proxy localhost:8080
    }
    # ledger du backend (preuve d'enforcement, lecture seule)
    handle_path /ledger {
        reverse_proxy localhost:9090
    }
}
EOF
sudo systemctl reload caddy
```

Caddy obtient le certificat Let's Encrypt tout seul dès que le DNS pointe.

## 3. Console

Sur ton Mac :

```bash
VITE_API_URL=https://demo.bawaba.systems \
VITE_GATEWAY_URL=https://demo.bawaba.systems \
  npm run build
scp -r dist ubuntu@<IP_VPS>:/opt/bawaba/dist
```

(Les fetchs du front visent alors le même domaine ; Caddy route /api et
/mcp vers les bons ports — le CORS localhost n'est plus concerné.)

Le bouton « ledger » de l'étape 8 suit `VITE_LEDGER_URL` (défaut
`http://localhost:9090/ledger`) — ajouter
`VITE_LEDGER_URL=https://demo.bawaba.systems/ledger` au build public.

## 4. Vérifications avant de partager le lien

```bash
curl -s https://demo.bawaba.systems/api/v1/health
curl -s https://demo.bawaba.systems/api/v1/souffleur/status   # configured:true/mistral
curl -s -X POST https://demo.bawaba.systems/api/v1/agents \
  -H 'Content-Type: application/json' -d '{"agent_id":"intrus"}'
# attendu: 403 "public demo: mutations are limited to your private workspace clones"
```

Puis dans le navigateur : Private Workspace → Démo guidée complète →
étape 10 CHAÎNE VALIDE → Souffleur en français.

## 5. Ce qui reste honnêtement hors périmètre

- Auth OIDC/JWT toujours en stub — la démo publique repose sur la garde
  PUBLIC_DEMO + clés secrètes, pas sur une vraie authentification opérateur.
- Pas de rate-limit global anti-abus au niveau Caddy (ajouter
  `rate_limit` si le lien circule largement).
- Sauvegardes Postgres non configurées (données de démo uniquement).

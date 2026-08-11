# CLAUDE.md — Contrat de développement

Ce fichier est le **contrat** du dépôt. Chaque session Claude Code repart d'un contexte neuf :
tout ce qui n'est pas écrit ici est perdu. Il fait autorité sur les conventions, les commandes,
les garde-fous et les interdits.

Le **brief projet** est dans [`docs/brief.md`](docs/brief.md) : objectifs, méthodologie de mesure,
modèle de données, feuille de route. Le lire avant toute décision structurante.
L'**état d'avancement** est dans [`docs/roadmap.md`](docs/roadmap.md) : ce qui est fait, en
cours, bloqué, et par quoi. Le consulter avant de choisir sur quoi travailler.
Le **journal de frictions** est dans `docs/journal.md` : c'est le livrable réel de l'expérimentation.

---

## 1. Contexte en une minute

`observatoire-web.fr` publie des mesures automatisées de qualité et d'accessibilité technique
sur les sites des communes françaises de plus de 10 000 habitants (~950–1 000 entités).

**Le site n'est pas le livrable.** Le livrable est la démonstration qu'un projet web
production-ready peut être créé, maintenu et *fait évoluer* intégralement dans le cloud via
Claude Code, sans aucun outillage local. Quand un arbitrage oppose « meilleur produit » à
« meilleur test du workflow cloud », **on tranche en faveur du test**.

Conséquences pratiques :

- L'exploitation fait partie du produit : tout ce qui se ferait au shell doit exister comme
  surface d'ops authentifiée, versionnée et testable.
- La CI est l'unique juge de qualité. Si la CI est verte et que le produit est cassé, c'est la
  CI qu'il faut corriger, dans la même PR.
- Les artefacts de CI (captures Playwright, rapports Lighthouse, logs de migration) sont
  **toujours** uploadés : c'est le seul moyen de « voir » le produit.

---

## 2. Stack

| Domaine | Choix | Notes |
|---|---|---|
| Runtime | Node.js 22 LTS | Pinné par `.nvmrc` **et** `engines` dans `package.json` |
| Gestionnaire de paquets | pnpm (via `corepack`) | Version pinnée par `packageManager`. Lockfile committé. |
| Framework | Astro (SSR, adaptateur `@astrojs/netlify`) | Îlots uniquement là où c'est nécessaire |
| Langage | TypeScript en `strict` | `any` implicite ou explicite interdit hors justification commentée |
| Base | Postgres serverless (Neon) | Branches Neon pour les previews et les dry-run de migration. **Un seul client, `pg` en TCP, pour les jobs comme pour le rendu SSR** : les jobs tournent dans un runner Actions et le site dans une fonction Netlify — un processus Node, pas un runtime edge —, donc aucun des deux n'a besoin du SDK serverless, et le même chemin de code s'éprouve contre un Postgres jetable en session (journal 017 et 019). Le job prend l'endpoint direct, le site l'endpoint *pooled* |
| ORM / migrations | Drizzle + drizzle-kit | Migrations SQL versionnées et committées |
| Validation | Zod | Toute donnée externe est parsée, jamais castée |
| Hébergement | Netlify | Cache edge + purge par tag |
| Observabilité | Sentry (dès le jour 1) | Endpoints SSR et jobs. Le SDK navigateur est activé par la présence de `PUBLIC_SENTRY_DSN` au build : à laisser vide tant que le site n'envoie aucun JavaScript au client — 48 ko gz pour surveiller zéro script (journal 011) |
| Tests unitaires et d'intégration | Vitest (`projects` séparés) | Aucune I/O dans le projet unitaire |
| Tests E2E et accessibilité | Playwright + axe-core | Exécutés contre l'URL de deploy preview |
| Tests de mutation | Stryker | Restreint à `src/lib/`, hors du chemin des PR |
| Lint / format | ESLint (flat config) + Prettier | `eslint-plugin-astro`, `prettier-plugin-astro` |
| CI/CD | GitHub Actions | Dépôt public, Actions gratuit |

Décisions encore ouvertes (cf. `docs/brief.md` §11) : formule du score composite, rétention de
l'historique au-delà de 12 mois, fréquence définitive des scans. **Ne pas les trancher
implicitement dans du code** — ouvrir une discussion, puis mettre à jour le brief **et son
changelog** dans la PR qui applique la décision.

---

## 3. Commandes

Ces noms de scripts sont **contractuels** : la CI, la documentation et les sessions futures en
dépendent. On peut changer leur implémentation, pas leur nom, sans mettre à jour ce fichier.

```bash
pnpm install --frozen-lockfile   # Installation (toujours --frozen-lockfile en CI)
pnpm dev                         # Serveur de développement
pnpm build                       # Build de production (site)
pnpm build:jobs                  # Compile src/jobs/ et ses dépendances vers dist-jobs/
pnpm preview                     # Sert le build local

pnpm typecheck                   # astro check + tsc --noEmit — zéro erreur exigé
pnpm lint                        # ESLint, zéro warning (--max-warnings=0)
pnpm format                      # Prettier --write
pnpm format:check                # Prettier --check (utilisé en CI)

pnpm test                        # Vitest, projet unitaire seul — zéro I/O, budget < 30 s
pnpm test:watch                  # Vitest en watch (unitaire)
pnpm test:integration            # Vitest, projet intégration (DATABASE_URL requis)
pnpm test:e2e                    # Playwright + axe-core (BASE_URL requis)
pnpm test:contract               # Vraies API tierces — planifié, hors du chemin des PR
pnpm test:mutation               # Stryker sur src/lib/ — hors du chemin des PR

pnpm db:generate                 # Génère une migration depuis le schéma Drizzle
pnpm db:migrate                  # Applique les migrations (DATABASE_URL requis)
pnpm db:check                    # Vérifie la cohérence schéma / migrations
pnpm db:studio                   # Drizzle Studio

pnpm verify                      # typecheck + lint + format:check + test + build + build:jobs
```

`pnpm verify` est la porte d'entrée : **le lancer avant tout commit**. Ce qu'il valide doit
correspondre exactement à ce que valide le job rapide de la CI ; toute divergence est un bug à
corriger. Il n'inclut **délibérément pas** `test:integration`, `test:e2e`, `test:contract` ni
`test:mutation` :
ces couches ont leur propre place dans le pipeline (§5) et alourdiraient une commande dont tout
l'intérêt est d'être exécutable à chaque commit sans y penser.

`build:jobs` est dans `verify` pour une raison précise : les jobs de `src/jobs/` sont le seul
TypeScript que rien d'autre ne compile — Astro construit le site, Vitest transpile les tests, et un
job lancé par Actions n'a ni l'un ni l'autre. Sans cette étape, une erreur de résolution de module
dans un job ne se découvrirait qu'au moment de le déclencher, c'est-à-dire le jour où on en a
besoin. Node ne peut pas exécuter les sources telles quelles : son *type stripping* ne résout pas
un spécificateur `./x.js` vers un fichier `.ts` (vérifié en session), et tout le dépôt écrit ses
imports ainsi.

**Pas de shell en production.** Il n'existe aucune commande à lancer « sur le serveur ».
Toute opération sur les données passe par la surface d'ops (§8) ou par un workflow GitHub
Actions déclenchable manuellement (`workflow_dispatch`) — aujourd'hui
`.github/workflows/ingest.yml`, qui exécute l'ingestion du référentiel, et
`.github/workflows/migrate.yml`, qui applique les migrations. Les deux tournent sur
l'environment `production` (§9), donc derrière une approbation humaine.

**Le schéma de production s'applique par ce workflow, et par rien d'autre.** Cette phrase
manquait, et son absence a coûté une panne : la migration `0000` avait été « appliquée et
éprouvée » sur des Postgres jetables de session, la CI de PR n'avait pas encore de branche Neon,
et personne n'avait écrit *comment* la vraie base recevait son schéma. Elle ne l'a jamais reçu.
`pnpm db:migrate` reste la commande locale ; `migrate.yml` est le seul chemin vers la production.
Il **rend compte avant d'agir** : sans `apply`, il énumère ce qu'il appliquerait et n'écrit rien.

---

## 4. Conventions

### Git

- Branches : `feat/<sujet>`, `fix/<sujet>`, `chore/<sujet>`. Une session = un ticket = une PR.
- Commits : [Conventional Commits](https://www.conventionalcommits.org/) (`feat:`, `fix:`,
  `chore:`, `docs:`, `refactor:`, `test:`, `ci:`, `perf:`). Le message explique le *pourquoi*.
- `main` est protégée : PR obligatoire, checks requis, pas de push direct, historique linéaire.
- Ne jamais `--force` sur `main`. Sur une branche de PR, `--force-with-lease` uniquement.
- **Regrouper les merges est une préférence, pas une contrainte.** Le compte Netlify est sur un
  plan *legacy* antérieur au modèle de crédits de septembre 2025 : les déploiements de production
  ne sont pas plafonnés. On itère quand même sur la deploy preview plutôt que d'enchaîner les
  merges, pour la lisibilité de l'historique — pas pour un quota.

### Langue

- **Code, identifiants, commentaires, messages de commit, noms de tests : anglais.**
- **Contenu du site, documentation (`docs/`), ce fichier : français.**
- **Exception — le vocabulaire métier reste en français** parce qu'il n'a pas d'équivalent
  fidèle : `commune`, `code_insee`, `epci`, `departement`, `region`. Les noms de tables et de
  colonnes suivent le modèle de données du brief **verbatim** (§6 de `docs/brief.md`) :
  `commune`, `site`, `scan_run`, `measurement`, `finding`.

### Code

- Structure : `src/lib/` (logique métier pure, testable sans I/O), `src/db/` (schéma Drizzle et
  requêtes), `src/pages/` (routes Astro), `src/components/`, `src/content/`.
- La logique métier (scoring, résolution d'URL, agrégations) vit dans `src/lib/` en fonctions
  pures. Elle ne doit jamais importer depuis `src/pages/`.
- Toute réponse d'API externe est parsée par un schéma Zod avant usage. Un champ absent ou
  d'un type inattendu est une erreur explicite, jamais un `undefined` qui se propage.
- Pas de `console.log` en dehors des scripts de développement — utiliser le logger applicatif.
- Les dates sont stockées et manipulées en UTC (`timestamptz`), formatées en `Europe/Paris`
  uniquement à l'affichage.
- **Les variables d'environnement se lisent par `src/lib/env`, jamais par `process.env` en
  direct** — règle appliquée par ESLint. Ce module déclare le schéma Zod du §9, traite une chaîne
  vide comme une variable absente, et sépare les variables `PUBLIC_` des variables serveur. C'est
  le seul endroit où la discipline du préfixe `PUBLIC_` peut être vérifiée plutôt que supposée.
- Prettier ne formate pas le Markdown (`.prettierignore`). Les tableaux de `docs/` sont écrits et
  alignés à la main : le repadding automatique transforme une correction d'un mot en diff de
  cinquante lignes, alors que dans ce dépôt le diff *est* la trace.

### Accessibilité

Un site qui mesure l'accessibilité des autres doit être exemplaire. Non négociable :

- HTML sémantique, un seul `<h1>` par page, hiérarchie de titres sans saut.
- Tout élément interactif atteignable et utilisable au clavier, focus visible.
- Contraste conforme WCAG 2.2 AA sur l'ensemble des états.
- Tableaux de données avec `<caption>`, `<th scope>`, et une alternative textuelle aux
  représentations graphiques.
- Le site publie sa propre **déclaration d'accessibilité** et son propre score.

---

## 5. Stratégie de tests

La CI est le seul juge : aucune vérification manuelle ne rattrapera un test manquant. Cela tire
dans deux directions opposées — **plus** de tests que la normale parce qu'aucun autre filet
n'existe, et des tests **plus rapides** que la normale parce que chaque aller-retour CI coûte un
cycle de session. On résout la tension par la séparation stricte des couches, jamais en
renonçant à l'une des deux exigences.

### Doctrine : TDD conditionnel

Le test-first est **obligatoire** dans deux cas, et dans deux cas seulement :

1. **Toute correction de bug** — on commence par un test qui échoue et reproduit le défaut.
2. **Toute logique pure dans `src/lib/`** — scoring, machine à états de résolution d'URL,
   agrégations, parsers. Là, la spécification est connaissable avant le code.

La raison est propre à ce projet : chaque session repart d'un contexte neuf, donc **le test est
le seul endroit où la spécification survit**. Une intention non écrite en test est perdue à la
session suivante.

Partout ailleurs — endpoints, jobs, intégrations — le test vient après le code mais **avant le
merge**. Pour tout ce qui touche une API externe, la démarche est inversée et assumée : on
observe le comportement réel, puis on **fige l'observation en fixture et en test de contrat**.
On n'écrit pas le test d'abord quand la spécification est « ce que PSI fait vraiment sous
charge ».

### Couches et budget de temps

Le budget est **contractuel et mesuré**, pas aspirationnel. Un budget qu'on ne mesure pas dérive
sans que personne ne le remarque, et c'est ainsi qu'on se retrouve avec une CI de trente minutes.

| Couche | Périmètre | Budget | Quand |
|---|---|---|---|
| Unitaire (Vitest, zéro I/O) | `src/lib/` — l'essentiel des tests | **< 30 s**, échec de CI au-delà de 60 s | Chaque push |
| Intégration (branche Neon éphémère, transport HTTP intercepté) | `src/db/`, jobs, endpoints, migrations en dry-run | **< 4 min** | Chaque push |
| E2E et accessibilité (Playwright sur la deploy preview) | 5 à 8 parcours, un par gabarit de page | **< 6 min** | Chaque PR |
| Mutation, Lighthouse complet, contrats API réels | voir plus bas | non borné | Planifié |

Les **contrats d'API** sont le projet Vitest `contract` (`tests/contract/`), le seul sans garde
anti-I/O : il interroge `geo.api.gouv.fr` et l'annuaire DILA pour vérifier que les fixtures gelées
de `tests/fixtures/` décrivent encore la réalité. Hebdomadaire, plus `workflow_dispatch`
(`.github/workflows/contracts.yml`), **jamais sur une PR**. Il distingue explicitement une panne de
disponibilité — l'API n'a pas répondu — d'une dérive de contrat, où la charge est arrivée et ne
correspond plus : seule la seconde justifie de toucher un schéma.

**Cible globale : moins de 10 minutes** du push au verdict, alerte à 15. Les jobs unitaire et
intégration tournent en parallèle ; l'E2E attend la preview. Le temps total est celui du plus
lent, pas la somme.

Le budget est appliqué par `scripts/budget.mjs`, qui enveloppe chaque couche de test : au-delà de
la durée allouée, le processus est tué et la commande échoue. C'est ce qui rend le budget
*mesuré* et non aspirationnel. Relever un plafond est une décision qui se discute dans la PR,
pas un chiffre qu'on ajuste en passant.

La pyramide est **volontairement large au milieu**. Les bugs intéressants de ce projet ne sont
pas dans les fonctions pures mais aux frontières : reprise d'un scan interrompu, tagging du
cache, migration sur données réelles. Le branching Neon rend les tests d'intégration assez peu
coûteux pour qu'on en fasse un usage franc.

### Règles inviolables

- **Aucun test sur le chemin d'une PR ne fait de requête réseau réelle.** Ni PSI, ni
  `geo.api.gouv.fr`, ni DILA. De tels tests seraient lents, instables, consommeraient du quota
  et échoueraient pour des raisons étrangères au diff — c'est-à-dire qu'ils apprendraient à tout
  le monde à ignorer un échec de CI. Dans un projet où la CI est le seul juge, **une CI qu'on
  apprend à ignorer est la panne la plus grave possible.**
- **Aucune I/O dans le projet unitaire**, imposé par le code : un garde en `setup` lève une
  exception si `fetch` ou le client Postgres est appelé. C'est ce qui empêche la dérive sur deux
  ans — pas la bonne volonté.
- **Un parcours E2E par gabarit de page, pas un par commune.** C'est la couche qui grossit sans
  qu'on s'en aperçoive.

### Ce qui doit être testé en priorité

Par ratio valeur/coût :

1. **Le scoring, figé par `methodology_version`.** Un jeu de fixtures par version, à sortie
   épinglée. Quand la méthodologie v2 arrivera, le test v1 doit **toujours passer sur les
   données v1**. C'est le garde-fou du jalon 5 (migration non destructive) et il ne coûte
   presque rien tant que l'historique est court.
2. **Le garde-fou SSRF** (§7) : test tabulaire des plages rejetées, **y compris après
   redirection** — c'est le contournement classique, et c'est de la logique pure.
3. **L'idempotence et la reprise d'un scan** : lancer, interrompre en cours, reprendre, vérifier
   qu'aucune commune n'est ni dupliquée ni perdue. C'est la propriété dont dépend toute la
   surface d'ops.
4. **Les parsers Zod contre fixtures gelées**, plus un **test de contrat planifié** qui
   interroge les vraies API en cron et échoue bruyamment quand la forme dérive en amont.
5. **Les en-têtes de cache** : énumérer les routes, échouer si l'une ne déclare pas sa politique
   (§10).
6. **L'authentification de la surface d'ops** : jeton absent ou faux rejeté, `GET` mutant
   impossible.
7. **L'accessibilité** : axe-core sur un exemplaire de chaque gabarit.

### Couverture et mutation

La couverture est un **diagnostic** — « qu'ai-je oublié ? ». Le score de mutation est la
**mesure de qualité** — « mes tests détecteraient-ils une régression ? ». On ne confond pas les
deux, et on ne pilote pas le projet à la couverture.

- `src/lib/` : **≥ 90 % de branches**, bloquant.
- `src/pages/`, `src/components/` : **non mesurés et non bloquants**. Ils sont couverts par
  l'E2E, où la couverture ligne n'a pas de sens.
- Pas de seuil global en pourcentage : il se contourne et produit des tests de complaisance.
- **Mutation (Stryker)** : restreint à `src/lib/`, hebdomadaire en cron plus `workflow_dispatch`
  à la demande, **jamais sur le chemin d'une PR**. Informatif jusqu'au jalon 3 ; **bloquant sur
  le module de scoring à partir du jalon 5**, quand la méthodologie v2 rendra le sujet vital.
  Seuil de départ : **80 %** sur le scoring, à confirmer après la première exécution réelle —
  annoncer un chiffre avant d'avoir mesuré serait arbitraire.

---

## 6. Definition of Done

Une PR n'est mergeable que si **tous** ces points sont vrais :

1. `pnpm verify` passe localement (dans la session cloud) **et** en CI.
2. Les nouveaux comportements sont couverts par des tests, à la couche prévue par la stratégie
   (§5). Une correction de bug commence par un test qui échoue.
3. Les budgets de temps du §5 sont tenus. Une couche qui dépasse son budget est un problème à
   traiter dans la PR, pas un seuil à relever.
4. Aucune régression d'accessibilité : E2E Playwright verts, budget Lighthouse tenu.
5. Toute migration de schéma est **versionnée, committée, réversible ou explicitement
   documentée comme non réversible**, et validée en dry-run sur une branche Neon éphémère.
6. Aucun secret, aucune URL de base, aucun jeton dans le diff — y compris dans les tests,
   les fixtures et les snapshots.
7. Les variables d'environnement nouvelles sont documentées dans `.env.example` (sans valeur)
   et dans §9 de ce fichier.
8. La documentation impactée est à jour dans la même PR (`docs/`, ce fichier, page méthodologie).
9. `docs/roadmap.md` reflète l'état réel : la tâche traitée y change de statut **dans cette PR**,
   et toute tâche qu'elle débloque aussi. Un suivi mis à jour séparément dérive et devient faux.
10. `docs/journal.md` est mis à jour si la PR a rencontré une friction liée au travail cloud-only
    — un contournement, un outil manquant, une limite atteinte. **C'est le livrable réel.**
11. La description de PR indique quoi, pourquoi, et comment ça a été vérifié.

---

## 7. Sécurité

Le dépôt est **public** et le site interroge des sites tiers. Les règles ci-dessous ne sont pas
des recommandations.

### Secrets

- Aucun secret dans le dépôt, jamais, même temporairement, même dans une branche supprimée
  ensuite. Un secret committé est un secret **compromis** : le révoquer et le régénérer avant
  toute autre action, puis noter l'incident dans le journal.
- `.env` est dans `.gitignore`. Seul `.env.example` est committé, sans valeurs.
- Les secrets vivent dans les GitHub Actions Secrets et les variables d'environnement Netlify.
- Secret scanning et push protection activés sur le dépôt.
- Ne jamais logger un secret, une chaîne de connexion, ni le contenu d'un en-tête `Authorization`
  — y compris dans les breadcrumbs Sentry (configurer le scrubbing).

### Chaîne d'approvisionnement

- Actions GitHub tierces **épinglées par SHA de commit**, pas par tag mobile.
- `permissions:` déclaré explicitement au niveau le plus bas possible dans chaque workflow ;
  `contents: read` par défaut.
- **`pull_request_target` est interdit.** Il expose les secrets du dépôt à du code de fork.
- Les workflows déclenchés par une PR ne reçoivent aucun secret de production.
- Dependabot (ou Renovate) actif sur `npm` et `github-actions`, revue groupée hebdomadaire.
- CodeQL activé sur `main` et sur les PR.
- Lockfile committé, `--frozen-lockfile` en CI. Aucune dépendance ajoutée sans justification
  dans la description de PR.

### Récupération de contenu tiers (crawl) — risque SSRF

Le projet récupère des URLs issues d'un annuaire externe, potentiellement périmées ou
incorrectes. **Toute requête sortante vers une URL non maîtrisée** passe par le client HTTP
dédié de `src/lib/fetch/`, qui impose :

- schéma `https:` uniquement (`http:` accepté seulement en fallback explicite et journalisé) ;
- résolution DNS puis **rejet des adresses privées, de loopback, link-local et de la plage de
  métadonnées cloud `169.254.169.254`** — vérification appliquée après chaque redirection,
  pas seulement sur l'URL initiale ;
- maximum 3 redirections, timeout dur, plafond de taille de réponse ;
- aucun cookie, aucun identifiant, aucun en-tête d'authentification transmis ;
- `User-Agent` identifiant le projet et une URL de contact — on s'annonce, on ne se cache pas ;
- HTML tiers traité comme **donnée hostile** : jamais rendu en `set:html`, jamais évalué,
  jamais réinjecté sans échappement.

### Base de données

- Requêtes via Drizzle. Le SQL brut est autorisé uniquement en requête paramétrée
  (`sql` tag de Drizzle) — **jamais** de concaténation de chaîne avec une valeur d'entrée.
- L'application se connecte avec un rôle aux droits minimaux : pas de `SUPERUSER`, pas de `DROP`.
- Le `DATABASE_URL` de production n'est jamais utilisé en CI ni en preview : les previews
  utilisent une branche Neon éphémère.

### Surface publique du site

- En-têtes de sécurité sur toutes les réponses : `Content-Security-Policy` (sans `unsafe-inline`
  ni `unsafe-eval`), `Strict-Transport-Security`, `X-Content-Type-Options: nosniff`,
  `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy` restrictive.
  Ils sont construits dans `src/lib/http/security.ts` et posés par `src/middleware.ts` pour les
  réponses rendues ; les ressources statiques ne traversent pas Astro et tiennent leurs en-têtes
  de `netlify.toml`.
- **Conséquence directe du `unsafe-inline` interdit : aucun `<script>` ni `<style>` en ligne dans
  le HTML.** C'est pourquoi `build.inlineStylesheets` vaut `'never'`. Un manquement ne se voit ni
  au build ni dans un statut HTTP — seulement dans un navigateur —, donc
  `scripts/check-deploy.mjs` l'assère sur le déploiement réel.
- L'API publique est **en lecture seule**, sans authentification, avec pagination bornée et
  limitation de débit. Aucune route publique ne mute l'état.
- Pas de donnée personnelle. Les mesures portent sur des sites d'organismes publics, jamais sur
  des personnes : aucun nom d'agent, aucun email de contact, aucune donnée de navigation.
- Analytics sans cookie et sans traçage individuel, ou pas d'analytics.

### Ce qu'on ne fait jamais

- Désactiver la vérification TLS, contourner un `robots.txt`, ou masquer l'identité du crawler.
- Charger un site tiers dans un navigateur headless pour contourner une protection.
- Publier une mesure sans sa date, sa `methodology_version` et son lien vers la méthodologie.

---

## 8. Exploitation sans shell

À partir du jalon 2, le projet expose une **surface d'ops authentifiée** permettant de :
déclencher un scan complet ou partiel, reprendre un scan interrompu, rejouer une commune isolée,
invalider le cache d'une page ou d'un ensemble, consulter l'état du dernier run et ses erreurs.

Règles de cette surface :

- Authentification par jeton porteur en en-tête `Authorization`, **jamais en paramètre d'URL**
  (les query strings finissent dans les logs et les referrers).
- Comparaison du jeton en **temps constant** (`crypto.timingSafeEqual`).
- Toute opération mutante est en `POST`, jamais en `GET` — un `GET` mutant est déclenchable
  par un préchargement ou un crawler.
- Limitation de débit et journalisation de chaque action (qui, quoi, quand, résultat).
- Toute opération est **idempotente** : la rejouer ne duplique rien et ne corrompt rien.
- Aucune opération destructive sans confirmation explicite dans le corps de la requête.

**Contraintes du scan** (détail dans `docs/brief.md` §4) :

- Débit réel de l'API PageSpeed Insights ≈ **1 requête/seconde**, très en deçà du quota affiché.
  Au-delà, l'API renvoie des 500 pendant plusieurs minutes. Le job est lent, patient, avec
  backoff exponentiel et reprise.
- Un scan est **idempotent et reprenable à la commune près**. Chaque mesure porte son propre
  statut. Jamais de « le job a planté, on recommence tout ».
- La résolution d'URL est un **processus à états** (`candidat → vérifié → invalide → à revoir`),
  pas une simple colonne. Ses règles vivent dans `src/lib/resolve/` en logique pure : ce qu'on
  peut requêter et dans quel ordre (`attempt`), ce que vaut une observation (`verdict`), quelles
  transitions sont légales et **par qui** (`states`), et que faire des autres candidats d'une même
  commune (`arbitrate`). Deux règles y sont non négociables, parce qu'elles protègent le travail
  humain de la ré-ingestion hebdomadaire : un scan ne ressuscite jamais une URL invalidée, et un
  scan ne sort jamais une URL de `à revoir`. Seul un opérateur le peut.

---

## 9. Variables d'environnement

Documenter toute nouvelle variable ici **et** dans `.env.example`.

Côté Actions, la **portée est un choix de sécurité, pas un rangement** : un secret de dépôt est
lisible par tout workflow, y compris celui qu'une PR déclenche, ce que le §7 interdit pour la
production. Les secrets de production vivent donc dans l'environment GitHub `production`
(branche `main` uniquement, reviewer requis), qu'un job nomme par `environment: production`.
Ceux dont un job de PR a besoin restent au niveau du dépôt — et ils n'y restent que parce qu'ils
n'ouvrent rien en production.

| Variable | Portée | Rôle |
|---|---|---|
| `DATABASE_URL` | Netlify, Actions (env. `production`) | Chaîne de connexion Neon (pooled) |
| `DATABASE_URL_UNPOOLED` | Actions (env. `production`) | Connexion directe : hôte **sans** le suffixe `-pooler`. Requise par les migrations et par la transaction unique de l'ingestion, que le mode transaction du pooler ne sait pas tenir |
| `PSI_API_KEY` | Netlify, Actions (dépôt) | Clé API PageSpeed Insights. N'ouvre qu'un quota ; passe dans l'environment le jour où le scan écrit |
| `OPS_TOKEN` | Netlify | Jeton de la surface d'ops. Rotation à la moindre suspicion. **Non provisionné tant que la surface d'ops n'existe pas** (jalon 2) : un jeton sans consommateur n'est qu'une surface d'exposition |
| `PUBLIC_SENTRY_DSN` | Netlify | DSN Sentry côté client (public par nature). Sa présence embarque le SDK navigateur — cf. §2 |
| `SENTRY_DSN` | Netlify, Actions (env. `production`) | DSN Sentry côté serveur |
| `SENTRY_AUTH_TOKEN` | Netlify | Upload des source maps. **Sur Netlify, pas sur Actions** : le build tourne là-bas, et l'upload a lieu pendant le build |
| `NEON_API_KEY` | Actions (dépôt) | Création/suppression des branches Neon éphémères. **Au niveau du dépôt délibérément** : c'est le seul secret dont un job de PR a besoin (J1-11), et il ne touche à aucune donnée de production |
| `NETLIFY_AUTH_TOKEN` | Actions (env. `production`) | Purge de cache depuis Actions. **Non provisionné** : un PAT Netlify vaut pour tout le compte et ne se restreint pas à un site, et une purge déclenchée *depuis une fonction* Netlify n'en demande aucun. À créer si, et seulement si, la purge part d'Actions (jalon 4) |
| `SITE_URL` | Netlify, Actions (variable) | URL canonique, utilisée pour les liens absolus |

Sous Astro, **seules** les variables préfixées `PUBLIC_` sont exposées au client. Ne jamais
préfixer une valeur sensible. Vérifier ce point dans toute revue touchant à la configuration.

---

## 10. Cache et déploiement

**Règle non négociable : un rafraîchissement de données ne déclenche jamais un redéploiement.**

- Les données vivent en base. Les pages sont rendues à la demande et mises en cache longuement
  au bord. Les déploiements ne servent qu'aux changements de **code**.
- Le cache edge est piloté par en-têtes : `Cache-Control` pour le navigateur,
  `Netlify-CDN-Cache-Control` pour le CDN (durées beaucoup plus longues), et
  `Netlify-Cache-Tag` pour marquer chaque réponse.
- Après un scan, la purge est **ciblée par tag** (`purgeCache` de `@netlify/functions`), jamais
  globale. Une purge globale masque les erreurs de tagging et écroule les performances.
- Tout endpoint est explicite sur sa politique de cache. Une réponse sans en-tête de cache
  décidé est un oubli, pas un défaut acceptable.
- Cette exigence est **tenue par un registre, pas par la discipline** : `src/lib/http/routes.ts`
  associe une politique et des tags de purge à chaque route, `src/middleware.ts` l'applique, et
  `tests/unit/route-cache-policy.test.ts` compare le registre aux fichiers de `src/pages/` dans
  les deux sens — une page non déclarée échoue, une déclaration orpheline aussi. Une route sans
  politique déclarée n'atteint pas `main`.
- Une route mise en cache **déclare au moins un tag de purge**. Sans tag, la seule façon de
  l'évincer est une purge globale, que ce paragraphe interdit : `cacheHeaders` lève plutôt que
  de servir une page qu'on ne saurait pas invalider.
- Une page lisant la base porte la politique `donnees` (plus courte que `editorial` tant que la
  purge par tag n'existe pas) et le tag de la donnée qu'elle affiche, pas seulement le sien.
- **Une page ne peut modifier sa politique que dans un sens : y renoncer.** `Astro.locals`
  `cacheDowngrade` vaut `'uncached'` et rien d'autre — c'est ce qui permet à un rendu dégradé
  (« les chiffres n'ont pas pu être lus ») de ne pas être conservé au bord, sans qu'une page
  puisse jamais s'accorder plus de cache que le registre ne lui en donne.

---

## 11. Interdits

À ne jamais faire, quelle que soit l'urgence apparente :

1. **Stocker les rapports Lighthouse bruts** (300–500 Ko pièce). On extrait une vingtaine de
   métriques et on jette le reste. Sans cette règle, le stockage explose en trois semaines.
2. **Écrire une mesure sans `methodology_version`.** Sans elle, impossible de faire évoluer le
   scoring sans trahir l'historique — et cette évolution est un jalon explicite.
3. **Déclencher un déploiement pour rafraîchir des données** (§10).
4. **Redémarrer un scan de zéro** au lieu de le reprendre (§8).
5. **Employer un vocabulaire non factuel.** On écrit « score de conformité technique
   automatisée ». Jamais « site conforme » / « non conforme au RGAA », jamais de qualification
   juridique, jamais de « palmarès des pires ». Un audit automatisé ne couvre qu'une fraction
   des critères RGAA, et le site le dit.
6. **Laisser croire à une origine publique.** Mention « initiative indépendante » en pied de
   page, mentions légales nommant DG-Tech (dg-tech.dev) sans ambiguïté, droit de réponse visible avec
   re-mesure sous 48 h.
7. **Contourner la CI** : `--no-verify`, désactivation d'un check, `skip ci`, test mis en
   `.skip` pour faire passer une PR. Un test qui gêne est un test à corriger ou à supprimer
   avec justification.
8. **Élargir le périmètre v1** vers ce qui est explicitement hors-scope (`docs/brief.md` §10) :
   hub éditorial, alertes email, authentification publique, mesure par navigateur headless,
   monétisation.
9. **Basculer silencieusement sur un outillage local.** Si un terminal local devient nécessaire,
   on le note dans `docs/journal.md` avec la raison, et on poursuit en cloud.

---

## 12. Travailler dans ce dépôt

- Commencer par lire `docs/brief.md` et `docs/journal.md`. Ils portent l'intention ; ce fichier
  ne porte que les règles.
- Choisir sa tâche dans `docs/roadmap.md`, et n'y prendre qu'une tâche `à faire` : une tâche
  `bloqué` ne peut pas être terminée dans la session, et une tâche `[humain]` n'est pas
  réalisable depuis une session cloud.
- Une session = un ticket = une PR. Pas de session fourre-tout. Si le périmètre dérive en cours
  de route, ouvrir une issue plutôt que de l'absorber dans la PR courante.
- En cas de contradiction entre ce fichier et le brief, **le brief l'emporte** sur l'intention,
  **ce fichier l'emporte** sur la mise en œuvre. Si la contradiction est réelle, la signaler
  plutôt que de choisir en silence.
- Devant une décision structurante non tranchée ici (§2), demander plutôt que présumer. Le coût
  d'une question est très inférieur au coût d'une migration corrective.
- En cas de friction liée au travail cloud-only, l'écrire dans `docs/journal.md` **au moment où
  elle survient**. Reconstituée après coup, elle est déjà perdue.

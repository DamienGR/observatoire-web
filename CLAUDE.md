# CLAUDE.md — Contrat de développement

Ce fichier est le **contrat** du dépôt. Chaque session Claude Code repart d'un contexte neuf :
tout ce qui n'est pas écrit ici est perdu. Il fait autorité sur les conventions, les commandes,
les garde-fous et les interdits.

Le **brief projet** est dans [`docs/brief.md`](docs/brief.md) : objectifs, méthodologie de mesure,
modèle de données, feuille de route. Le lire avant toute décision structurante.
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
| Base | Postgres serverless (Neon) | Branches Neon pour les previews et les dry-run de migration |
| ORM / migrations | Drizzle + drizzle-kit | Migrations SQL versionnées et committées |
| Validation | Zod | Toute donnée externe est parsée, jamais castée |
| Hébergement | Netlify | Cache edge + purge par tag |
| Observabilité | Sentry (dès le jour 1) | Front, endpoints SSR et jobs |
| Tests unitaires | Vitest | |
| Tests E2E | Playwright | Exécutés contre l'URL de deploy preview |
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
pnpm build                       # Build de production
pnpm preview                     # Sert le build local

pnpm typecheck                   # astro check + tsc --noEmit — zéro erreur exigé
pnpm lint                        # ESLint, zéro warning (--max-warnings=0)
pnpm format                      # Prettier --write
pnpm format:check                # Prettier --check (utilisé en CI)

pnpm test                        # Vitest, une passe
pnpm test:watch                  # Vitest en watch
pnpm test:e2e                    # Playwright (BASE_URL requis)

pnpm db:generate                 # Génère une migration depuis le schéma Drizzle
pnpm db:migrate                  # Applique les migrations (DATABASE_URL requis)
pnpm db:check                    # Vérifie la cohérence schéma / migrations
pnpm db:studio                   # Drizzle Studio

pnpm verify                      # typecheck + lint + format:check + test + build
```

`pnpm verify` est la porte d'entrée : **le lancer avant tout commit**. Ce qu'il valide doit
correspondre exactement à ce que valide la CI ; toute divergence est un bug à corriger.

**Pas de shell en production.** Il n'existe aucune commande à lancer « sur le serveur ».
Toute opération sur les données passe par la surface d'ops (§7) ou par un workflow GitHub
Actions déclenchable manuellement (`workflow_dispatch`).

---

## 4. Conventions

### Git

- Branches : `feat/<sujet>`, `fix/<sujet>`, `chore/<sujet>`. Une session = un ticket = une PR.
- Commits : [Conventional Commits](https://www.conventionalcommits.org/) (`feat:`, `fix:`,
  `chore:`, `docs:`, `refactor:`, `test:`, `ci:`, `perf:`). Le message explique le *pourquoi*.
- `main` est protégée : PR obligatoire, checks requis, pas de push direct, historique linéaire.
- Ne jamais `--force` sur `main`. Sur une branche de PR, `--force-with-lease` uniquement.
- **Regrouper les merges** : sur Netlify, seuls les déploiements de production réussis
  consomment des crédits (~15 par déploiement, 300/mois). Les deploy previews sont gratuits.
  Itérer sur la preview, merger une fois.

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

### Accessibilité

Un site qui mesure l'accessibilité des autres doit être exemplaire. Non négociable :

- HTML sémantique, un seul `<h1>` par page, hiérarchie de titres sans saut.
- Tout élément interactif atteignable et utilisable au clavier, focus visible.
- Contraste conforme WCAG 2.2 AA sur l'ensemble des états.
- Tableaux de données avec `<caption>`, `<th scope>`, et une alternative textuelle aux
  représentations graphiques.
- Le site publie sa propre **déclaration d'accessibilité** et son propre score.

---

## 5. Definition of Done

Une PR n'est mergeable que si **tous** ces points sont vrais :

1. `pnpm verify` passe localement (dans la session cloud) **et** en CI.
2. Les nouveaux comportements sont couverts par des tests. Une correction de bug commence par
   un test qui échoue.
3. Aucune régression d'accessibilité : E2E Playwright verts, budget Lighthouse tenu.
4. Toute migration de schéma est **versionnée, committée, réversible ou explicitement
   documentée comme non réversible**, et validée en dry-run sur une branche Neon éphémère.
5. Aucun secret, aucune URL de base, aucun jeton dans le diff — y compris dans les tests,
   les fixtures et les snapshots.
6. Les variables d'environnement nouvelles sont documentées dans `.env.example` (sans valeur)
   et dans §8 de ce fichier.
7. La documentation impactée est à jour dans la même PR (`docs/`, ce fichier, page méthodologie).
8. `docs/journal.md` est mis à jour si la PR a rencontré une friction liée au travail cloud-only
   — un contournement, un outil manquant, une limite atteinte. **C'est le livrable réel.**
9. La description de PR indique quoi, pourquoi, et comment ça a été vérifié.

---

## 6. Sécurité

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

## 7. Exploitation sans shell

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
  pas une simple colonne.

---

## 8. Variables d'environnement

Documenter toute nouvelle variable ici **et** dans `.env.example`.

| Variable | Portée | Rôle |
|---|---|---|
| `DATABASE_URL` | Netlify, Actions | Chaîne de connexion Neon (pooled) |
| `DATABASE_URL_UNPOOLED` | Actions | Connexion directe, requise pour les migrations |
| `PSI_API_KEY` | Netlify, Actions | Clé API PageSpeed Insights |
| `OPS_TOKEN` | Netlify, Actions | Jeton de la surface d'ops. Rotation à la moindre suspicion. |
| `PUBLIC_SENTRY_DSN` | Netlify | DSN Sentry côté client (public par nature) |
| `SENTRY_DSN` | Netlify, Actions | DSN Sentry côté serveur |
| `SENTRY_AUTH_TOKEN` | Actions | Upload des source maps |
| `NEON_API_KEY` | Actions | Création/suppression des branches Neon éphémères |
| `NETLIFY_AUTH_TOKEN` | Actions | Déploiement et purge de cache |
| `SITE_URL` | Netlify, Actions | URL canonique, utilisée pour les liens absolus |

Sous Astro, **seules** les variables préfixées `PUBLIC_` sont exposées au client. Ne jamais
préfixer une valeur sensible. Vérifier ce point dans toute revue touchant à la configuration.

---

## 9. Cache et déploiement

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

---

## 10. Interdits

À ne jamais faire, quelle que soit l'urgence apparente :

1. **Stocker les rapports Lighthouse bruts** (300–500 Ko pièce). On extrait une vingtaine de
   métriques et on jette le reste. Sans cette règle, le stockage explose en trois semaines.
2. **Écrire une mesure sans `methodology_version`.** Sans elle, impossible de faire évoluer le
   scoring sans trahir l'historique — et cette évolution est un jalon explicite.
3. **Déclencher un déploiement pour rafraîchir des données** (§9).
4. **Redémarrer un scan de zéro** au lieu de le reprendre (§7).
5. **Employer un vocabulaire non factuel.** On écrit « score de conformité technique
   automatisée ». Jamais « site conforme » / « non conforme au RGAA », jamais de qualification
   juridique, jamais de « palmarès des pires ». Un audit automatisé ne couvre qu'une fraction
   des critères RGAA, et le site le dit.
6. **Laisser croire à une origine publique.** Mention « initiative indépendante » en pied de
   page, mentions légales nommant StudioMaestro sans ambiguïté, droit de réponse visible avec
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

## 11. Travailler dans ce dépôt

- Commencer par lire `docs/brief.md` et `docs/journal.md`. Ils portent l'intention ; ce fichier
  ne porte que les règles.
- Une session = un ticket = une PR. Pas de session fourre-tout. Si le périmètre dérive en cours
  de route, ouvrir une issue plutôt que de l'absorber dans la PR courante.
- En cas de contradiction entre ce fichier et le brief, **le brief l'emporte** sur l'intention,
  **ce fichier l'emporte** sur la mise en œuvre. Si la contradiction est réelle, la signaler
  plutôt que de choisir en silence.
- Devant une décision structurante non tranchée ici (§2), demander plutôt que présumer. Le coût
  d'une question est très inférieur au coût d'une migration corrective.
- En cas de friction liée au travail cloud-only, l'écrire dans `docs/journal.md` **au moment où
  elle survient**. Reconstituée après coup, elle est déjà perdue.

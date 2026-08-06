# Feuille de route et suivi des tâches

Ce fichier répond à une seule question : **où en est-on ?** Il complète les trois autres
documents du dépôt sans les recouper.

| Document | Répond à |
|---|---|
| `docs/brief.md` | Pourquoi on fait ça, et jusqu'où |
| `CLAUDE.md` | Comment on le fait |
| `docs/roadmap.md` | Où on en est |
| `docs/journal.md` | Ce qui a résisté en chemin |

## Règle de mise à jour

**Le statut d'une tâche ne change que dans la PR qui le change.** On ne tient pas ce fichier à
jour « de temps en temps » : une PR qui termine `J1-05` bascule `J1-05` en `terminé` dans le même
diff. C'est ce qui évite le suivi fantôme — un tableau qu'on met à jour séparément dérive en
trois semaines et devient plus nuisible qu'utile.

Corollaire : ce fichier est **volontairement grossier**. Une tâche = une session = une PR, comme
le veut le §12 de `CLAUDE.md`. Le détail d'exécution n'a pas sa place ici ; s'il faut discuter
d'un point, on ouvre une issue et on la référence dans la colonne *Notes*.

## Statuts

| Statut | Sens |
|---|---|
| `à faire` | Prête à être prise, aucune dépendance en attente |
| `bloqué` | En attente de quelque chose d'extérieur — la colonne *Dépend de* dit quoi |
| `en cours` | Une session travaille dessus |
| `terminé` | Mergée sur `main` |
| `reporté` | Décidée mais volontairement repoussée, avec la raison |

Le statut `bloqué` est important dans ce projet : plusieurs tâches dépendent d'une action en
console web qu'aucune session ne peut faire. Les distinguer de `à faire` évite qu'une session
prenne une tâche qu'elle ne peut pas terminer.

Les tâches marquées **[humain]** ne sont pas réalisables depuis une session cloud.

**Ne marquer `[humain]` qu'une tâche dont *aucune* part n'est réalisable en session.** Une tâche
mixte ainsi marquée est une tâche que personne ne prend : la session s'en écarte, et le porteur
croit qu'elle attend la session. Si les deux natures coexistent — un réglage de console et un
fichier versionné — on scinde en deux lignes. Constaté sur J1-03 le 5/8, resté `à faire` pendant
que sa moitié versionnée était réalisable depuis le premier jour.

---

## Jalon 1 — Bootstrap, ingestion, CI complète

Épreuve visée : la CI devient l'unique juge de qualité.

| ID | Tâche | Statut | Dépend de | Notes |
|---|---|---|---|---|
| J1-01 | Documentation socle : `CLAUDE.md`, journal, brief v1.1 | `terminé` | — | PR #1 |
| J1-02 | **[humain]** Provisionnement Neon, Netlify, Sentry, clé PSI | `terminé` | — | Secrets en place |
| J1-03 | Durcissement du dépôt : secret scanning, push protection, Dependabot, CodeQL | `terminé` | — | Moitié console **[humain]** faite le 5/8 ; moitié versionnée (`dependabot.yml`, `codeql.yml`) dans la même journée. La marque **[humain]** était trop large : cf. dette. Première récolte traitée le 5/8 (journal 005) |
| J1-04 | Bootstrap : `package.json`, Astro, TS strict, ESLint/Prettier, Vitest (2 projects + garde anti-I/O), `.env.example`, job CI rapide | `terminé` | — | Toutes les dépendances des tâches parallèles sont installées |
| J1-05 | Garde SSRF — `src/lib/fetch/` | `terminé` | J1-04 | TDD strict tenu : la table de plages a été écrite avant le code et n'a pas bougé. Résidu de rebinding DNS en dette |
| J1-06 | Machine à états de résolution d'URL — `src/lib/` | `à faire` | J1-04 | TDD strict |
| J1-07 | Parsers Zod + fixtures gelées (`geo.api.gouv.fr`, DILA) | `à faire` | J1-04 | Capture des fixtures à faire une fois |
| J1-08 | Schéma Drizzle (5 tables du §6 du brief) + 1re migration | `à faire` | J1-04 | |
| J1-09 | Coquille du site : layout accessible, en-têtes de sécurité, pages légales et méthodologie | `à faire` | J1-04 | §9 du brief |
| J1-10 | **[humain]** Environment GitHub `production` + politique de branche `main` | `reporté` | — | Décidé le 4/8 : à faire avant J1-11 |
| J1-11 | Job CI d'intégration + branche Neon éphémère + migration en dry-run | `bloqué` | J1-04, J1-08, J1-10 | Seul job de PR utilisant un secret |
| J1-12 | Job CI E2E : Playwright + axe-core sur deploy preview, upload d'artefacts | `bloqué` | J1-09 | La preview **sert enfin des pages** depuis la PR #21 : jusque-là Netlify publiait la racine du dépôt et l'E2E n'aurait eu rien à mesurer. La note « Netlify est lié » était vraie et trompeuse à la fois. Ne dépend plus que de J1-09 |
| J1-13 | **[humain]** Protection de `main` : checks requis, merge linéaire | `terminé` | J1-04 | Check `verify` exigé et historique linéaire activés le 5/8. Statut **déclaré par le porteur** : une session ne peut pas le constater (cf. dette) |
| J1-14 | Job d'ingestion du référentiel des communes | `bloqué` | J1-05, J1-07, J1-08 | |
| J1-15 | Page `/stats` minimale sur données réelles | `bloqué` | J1-14 | |

**Parallélisable après J1-04** : J1-05, J1-06, J1-07, J1-08 et J1-09 touchent des répertoires
disjoints et ne se gênent pas. Toutes les dépendances sont installées dès J1-04 pour qu'aucune
branche parallèle n'ait à toucher `pnpm-lock.yaml` — c'est le conflit le plus pénible à résoudre.

Le compte Netlify étant sur un plan *legacy*, le nombre de déploiements de production n'est pas
plafonné : on peut merger les PR au fil de l'eau sans surveiller un quota.

---

## Jalons suivants

Non décomposés à ce stade, et c'est délibéré : détailler maintenant produirait une fausse
précision qu'il faudrait défaire. Chaque jalon est décomposé au moment de l'attaquer, à partir du
§8 du brief.

| Jalon | Livrable | Statut |
|---|---|---|
| 2 | Mesure sur 20 communes, fiche entité, surface d'ops | `à faire` |
| 3 | Passage à 1 000 communes, scan par lots, reprise sur incident | `à faire` |
| 4 | Publication : classements, cache edge, purge ciblée | `à faire` |
| 5 | Méthodologie v2 appliquée à l'historique | `à faire` |
| 6 | 4 semaines sans nouvelle fonctionnalité | `à faire` |

---

## Dette et points à reprendre

Ce qu'on a laissé volontairement de côté, pour ne pas l'oublier.

| Sujet | Origine | Notes |
|---|---|---|
| Portée de `NEON_API_KEY` | 4/8 | Vérifier qu'il s'agit d'une clé scopée au projet et non au compte |
| ~~Historique non linéaire~~ | 4/8 → soldé le 5/8 | L'historique linéaire est exigé sur `main` (J1-13). Le commit de merge de la PR #1 reste dans l'historique : on ne réécrit pas `main` pour l'effacer |
| Configuration du dépôt illisible depuis une session | 5/8 | `GET /branches/main/protection` répond `403 Resource not accessible by integration`, et il en va de même des réglages de sécurité. Une session ne peut vérifier ni le §4 ni le §7 : les statuts de J1-13 et J1-03 sont **déclaratifs**. Cf. journal 002 et 003 |
| Granularité de la marque **[humain]** | 5/8 | J1-03 était marquée `[humain]` en bloc alors que la moitié (Dependabot, CodeQL) est faite de fichiers versionnés. Une tâche mixte marquée `[humain]` est une tâche qu'aucune session ne prend, donc une tâche qui dort. Relire les autres `[humain]` avec cette grille |
| CodeQL : périmètre et sévérité | 5/8 | Trois choix de départ à revoir après quelques exécutions réelles : suite de requêtes par défaut plutôt que `security-extended`, check **non requis**, et **aucune analyse des fichiers `.astro`** faute d'extracteur — la couverture des gabarits repose sur ESLint et l'E2E |
| Langue des descriptions de PR | 4/8 | Le §4 ne tranche pas, et la pratique a déjà divergé : PR #1 en anglais, PR #3 en français. À arbitrer dans le §4 avant que le corpus ne devienne illisible |
| Décisions ouvertes du brief §11 | — | Score composite, rétention au-delà de 12 mois, fréquence des scans |
| Suites de tests vides qui passent | 5/8 | `test:integration` et `test:e2e` tournent avec `--passWithNoTests` faute de tests existants. **À retirer dès la première PR qui en ajoute** : une suite vide qui passe est exactement la CI qu'on apprend à ignorer (§5 de `CLAUDE.md`) |
| Sentry non câblé | 5/8 | La dépendance `@sentry/astro` est installée mais l'intégration n'est pas branchée. Le brief exige Sentry « dès le jour 1 » : à faire dans J1-09 |
| `pnpm approve-builds` non silencieux | 5/8 | `onlyBuiltDependencies: []` déclaré dans `pnpm-workspace.yaml`, mais pnpm 10.33 affiche quand même l'avertissement à chaque installation. Cosmétique, à revoir sur une version ultérieure |
| Écriture des tests E2E | 5/8 | `playwright.config.ts` existe, `tests/e2e/` est vide. Les parcours arrivent avec J1-12 |
| Rebinding DNS non couvert | 5/8 | Le garde résout, juge, puis rend le **nom d'hôte** à `fetch`, qui résout à nouveau. Un enregistrement dont le TTL expire entre les deux réponses peut donner une adresse publique au garde et une adresse privée à la connexion. Fermer la brèche exige de composer l'IP vérifiée avec un `Host` épinglé et un dispatcher dédié. Documenté plutôt qu'à moitié corrigé |
| Ports non restreints par le garde SSRF | 5/8 | Le garde n'impose ni 80 ni 443. Une fois les plages privées bloquées, le risque résiduel porte sur des services publics exotiques ; à réévaluer si le scan sort de la page d'accueil |
| Branches défensives et couverture | 5/8 | `noUncheckedIndexedAccess` pousse à écrire des gardes que TypeScript prouve inatteignables, et le seuil de 90 % de branches interdit de les laisser non couvertes. Les deux exigences tirent en sens inverse : la sortie est de changer la représentation des données, pas d'ajouter un test factice. Cf. journal 004 |
| ~~Plafond Dependabot atteint sur npm~~ | 5/8 → constaté le 5/8 | Hypothèse confirmée dans la minute suivant le merge : libérer le plafond a fait apparaître trois majeures d'outillage jusque-là invisibles (`typescript`, `astro-eslint-parser`, `globals`). **Un plafond atteint ne se distingue pas d'un dépôt à jour.** Cf. journal 006 |
| Réglages Astro 7 à revoir dans J1-09 | 5/8 | `compressHTML` passe par défaut de `true` à `'jsx'` (espacement entre éléments en ligne) et `src/fetch.ts` devient un chemin réservé au routage — sans effet sur une page de bootstrap, à reconsidérer quand le gabarit réel arrive. Cf. journal 005 |
| `git ls-remote` est disponible depuis le conteneur | 5/8 | Corrige une affirmation de l'entrée 002 du journal : résoudre une étiquette en SHA est possible sans authentification, et c'est ce qui permet de contrôler les pins d'actions tierces (§7). Une limite supposée, jamais testée, avait été inscrite comme un fait |
| Advisories résiduelles — `esbuild` et `qs` | 5/8 | `sharp` est soldée (ligne suivante). Restent deux modérées, toutes deux transitives et non atteignables depuis la surface publique : `esbuild` n'est exposé qu'en développement, `qs` sert au parsing de query strings dans l'outillage Netlify. `pnpm audit` est à **0 haute / 2 modérées**. À revoir quand un `pnpm audit` propre deviendra une exigence de CI plutôt qu'un contrôle manuel |
| ~~`sharp` : CVE libvips (haute)~~ | 5/8 → soldé le 5/8 | Corrigée par un `overrides` pnpm vers `^0.35.3` (GHSA-f88m-g3jw-g9cj, quatre CVE libvips, aucun rétroportage en 0.34.x). **La note d'origine se trompait de risque** : `astro@7.1.6` déclare `^0.34.0 \|\| ^0.35.0`, la version est donc dans sa plage supportée. Le paquet réellement dépassé est `ipx@3.1.1` (`^0.34.3`), tiré par `@netlify/images` — chemin d'image CDN que ce site n'emprunte pas. Retirer l'entrée dès qu'`ipx` accepte 0.35. Cf. journal 008 |
| ~~Alias `~` non miroité dans Vitest~~ | 5/8 → soldé le 5/8 | Miroité **par projet** dans `vitest.config.ts` : un `resolve.alias` à la racine du fichier n'est pas hérité par les entrées `projects`, chacune étant une config Vite à part entière. La version racine ne résout donc rien tout en ayant l'air correcte — piège vérifié, pas déduit. Tenu par `tests/unit/path-alias.test.ts`, qui compare la liaison obtenue par l'alias à celle obtenue par chemin relatif. Cf. journal 007 |
| Montées de TypeScript plafonnées à 6.0.x | 5/8 | `typescript-eslint@8.66.0` déclare le pair `>=4.8.4 <6.1.0` et `@astrojs/check@0.9.10` accepte `^5 \|\| ^6`. TS 7 est déjà en `latest` mais casserait les deux. Le déblocage viendra de `typescript-eslint` 9, pas de nous : ne pas confondre « aucune PR Dependabot » avec « à jour ». Cf. journal 006 |
| `projectService` ignoré sur les fichiers `.astro` | 5/8 | `astro-eslint-parser` avertit qu'il ne gère pas `projectService` et retombe sur `project: true`. Le lint typé des `.astro` s'exécute donc dans un mode dégradé, silencieusement, depuis le bootstrap. Sans conséquence visible sur une page unique ; à réévaluer avec J1-09, quand les gabarits arriveront |
| ~~`astro-eslint-parser` en dépendance directe~~ | 5/8 → soldé le 5/8 | Déclarée au bootstrap mais jamais utilisée : `eslint.config.js` passe par `astro.configs.recommended`, et c'est la copie d'`eslint-plugin-astro` (`^1.3.0`) qui parse. La PR Dependabot qui proposait de la monter en 3.0.0 a rendu l'incohérence visible ; la dépendance a été retirée plutôt que montée |
| ~~Netlify ne construit pas le projet : il publie la racine du dépôt~~ | 5/8 → soldé le 5/8 | `netlify.toml` versionné (`command = "pnpm build"`, `publish = "dist"`). Vérifié sur la deploy preview de la PR #21 : `/` répond **200** avec le `<h1>` attendu, `/package.json` et `/CLAUDE.md` répondent enfin **404**, et l'horodatage rendu par `index.astro` change entre deux requêtes (`cache-status: fwd=miss`) — c'est bien la fonction SSR qui répond. Aucun réglage d'interface n'écrasait le fichier, contrairement à ce qu'on redoutait. Cf. journal 008 |
| ~~Aucun check ne regarde ce que la preview sert~~ | 5/8 → soldé le 5/8 | Job `deploy` dans `ci.yml` : `scripts/resolve-netlify-url.mjs` lit l'URL depuis le statut de commit Netlify (jamais écrite en dur, §6), `scripts/check-deploy.mjs` exige un 200, un `text/html`, le `<h1>` attendu, et surtout que `/package.json`, `/CLAUDE.md` et `/src/pages/index.astro` **ne soient pas servis** — l'assertion qui encode la panne du 5/8. Les deux chemins ont été éprouvés localement, vert sur la preview réelle et rouge sur un déploiement inexistant. Cf. journal 010 |
| **[humain]** Rendre le check `deploy` requis sur `main` | 5/8 | Le job existe et tourne, mais rien n'empêche de merger malgré son échec tant qu'il n'est pas ajouté aux checks requis — réglage de console qu'une session ne peut ni faire ni constater (même limite que J1-13). À faire une fois quelques exécutions observées |

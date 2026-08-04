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

---

## Jalon 1 — Bootstrap, ingestion, CI complète

Épreuve visée : la CI devient l'unique juge de qualité.

| ID | Tâche | Statut | Dépend de | Notes |
|---|---|---|---|---|
| J1-01 | Documentation socle : `CLAUDE.md`, journal, brief v1.1 | `terminé` | — | PR #1 |
| J1-02 | **[humain]** Provisionnement Neon, Netlify, Sentry, clé PSI | `terminé` | — | Secrets en place |
| J1-03 | **[humain]** Durcissement du dépôt : secret scanning, push protection, Dependabot, CodeQL | `à faire` | — | §7 de `CLAUDE.md` |
| J1-04 | Bootstrap : `package.json`, Astro, TS strict, ESLint/Prettier, Vitest (2 projects + garde anti-I/O), `.env.example`, job CI rapide | `à faire` | — | Point de sérialisation : tout en dépend |
| J1-05 | Garde SSRF — `src/lib/fetch/` | `à faire` | J1-04 | TDD strict. Priorité 2 du §5 |
| J1-06 | Machine à états de résolution d'URL — `src/lib/` | `à faire` | J1-04 | TDD strict |
| J1-07 | Parsers Zod + fixtures gelées (`geo.api.gouv.fr`, DILA) | `à faire` | J1-04 | Capture des fixtures à faire une fois |
| J1-08 | Schéma Drizzle (5 tables du §6 du brief) + 1re migration | `à faire` | J1-04 | |
| J1-09 | Coquille du site : layout accessible, en-têtes de sécurité, pages légales et méthodologie | `à faire` | J1-04 | §9 du brief |
| J1-10 | **[humain]** Environment GitHub `production` + politique de branche `main` | `reporté` | — | Décidé le 4/8 : à faire avant J1-11 |
| J1-11 | Job CI d'intégration + branche Neon éphémère + migration en dry-run | `bloqué` | J1-04, J1-08, J1-10 | Seul job de PR utilisant un secret |
| J1-12 | Job CI E2E : Playwright + axe-core sur deploy preview, upload d'artefacts | `bloqué` | J1-04, J1-09, Netlify lié au dépôt | |
| J1-13 | **[humain]** Protection de `main` : checks requis, merge linéaire | `bloqué` | J1-04 | Les checks ne sont sélectionnables qu'après leur 1re exécution |
| J1-14 | Job d'ingestion du référentiel des communes | `bloqué` | J1-05, J1-07, J1-08 | |
| J1-15 | Page `/stats` minimale sur données réelles | `bloqué` | J1-14 | |

**Parallélisable après J1-04** : J1-05, J1-06, J1-07, J1-08 et J1-09 touchent des répertoires
disjoints et ne se gênent pas. Toutes les dépendances sont installées dès J1-04 pour qu'aucune
branche parallèle n'ait à toucher `pnpm-lock.yaml` — c'est le conflit le plus pénible à résoudre.

**Attention aux crédits Netlify** (§4 de `CLAUDE.md`) : itérer sur les previews, merger en lot.
Cinq PR mergées séparément coûtent ~75 crédits sur les 300 mensuels.

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
| Historique non linéaire | 4/8 | PR #1 mergée par commit de merge, alors que le §4 exige un historique linéaire. Régler le mode de merge du dépôt |
| Langue des descriptions de PR | 4/8 | Le §4 ne tranche pas ; la PR #1 était en anglais |
| Décisions ouvertes du brief §11 | — | Score composite, rétention au-delà de 12 mois, fréquence des scans |

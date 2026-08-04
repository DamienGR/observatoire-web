# observatoire-web

Mesures automatisées de qualité et d'accessibilité technique des sites des communes
françaises de plus de 10 000 habitants (~950–1 000 entités), publiées sur
[observatoire-web.fr](https://observatoire-web.fr).

> **Initiative indépendante** portée par StudioMaestro. Ce projet n'émane d'aucun organisme
> public et n'a aucun caractère officiel.

---

## Le vrai livrable

**Le site n'est pas le livrable.** Le livrable est la démonstration qu'un projet web
production-ready peut être créé, maintenu et *fait évoluer* intégralement dans le cloud via
Claude Code, sans aucun outillage local — et le journal des frictions rencontrées en chemin.

Quand un arbitrage oppose « meilleur produit » à « meilleur test du workflow cloud », on
tranche en faveur du test.

## Ce que le site publie

- **Fiche par commune** : score courant, historique, principaux problèmes techniques détectés,
  présence ou absence de déclaration d'accessibilité, date de mesure.
- **Classements filtrables** par région, strate de population, CMS détecté.
- **Baromètre périodique** : médianes, évolutions, progressions et régressions.
- **Données ouvertes** : export CSV et API publique en lecture seule.
- **Page méthodologie**, accessible depuis chaque fiche.

## Honnêteté méthodologique

Un audit automatisé ne couvre qu'une fraction des critères RGAA. Le vocabulaire employé est
strictement factuel : on parle de **« score de conformité technique automatisée »**, jamais de
site « conforme » ou « non conforme au RGAA ». Aucune qualification juridique, aucun palmarès.

Chaque mesure publiée porte sa date, sa `methodology_version` et un lien vers la méthodologie.
Un **droit de réponse** avec re-mesure sous 48 h est ouvert à toute collectivité mesurée.

## Sources de données

| Donnée | Source |
|---|---|
| Référentiel des communes | API Découpage administratif (`geo.api.gouv.fr`) |
| URL des sites | API Annuaire de l'administration (DILA) |
| Mesure principale | API PageSpeed Insights (Lighthouse + axe-core) |
| Signaux complémentaires | Récupération HTML directe |

Aucune donnée personnelle n'est collectée : les mesures portent sur des sites d'organismes
publics, jamais sur des personnes.

## Stack

Astro (SSR) · TypeScript strict · Postgres serverless (Neon) · Drizzle · Zod · Netlify ·
Sentry · Vitest · Playwright · GitHub Actions.

## Développement

Node.js 22 LTS et pnpm (via `corepack`).

```bash
pnpm install --frozen-lockfile
pnpm dev        # serveur de développement
pnpm verify     # typecheck + lint + format:check + test + build
```

`pnpm verify` est la porte d'entrée : le lancer avant tout commit. La liste complète des
commandes est dans [`CLAUDE.md`](CLAUDE.md) §3.

Il n'existe aucune commande à lancer « sur le serveur » : toute opération sur les données passe
par la surface d'ops authentifiée ou par un workflow GitHub Actions déclenchable manuellement.

## Documentation

| Fichier | Contenu |
|---|---|
| [`CLAUDE.md`](CLAUDE.md) | Le contrat du dépôt : conventions, commandes, garde-fous, interdits |
| [`docs/brief.md`](docs/brief.md) | Le brief : objectifs, méthodologie, modèle de données, feuille de route |
| `docs/journal.md` | Le journal de frictions du travail cloud-only — le livrable réel |

## Licence

À définir.

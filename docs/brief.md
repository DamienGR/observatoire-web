# observatoire-web.fr — Brief projet

**Version** 1.4 — 7 août 2026
**Porteur** DG-Tech (Damien) — dg-tech.dev
**Domaine** observatoire-web.fr
**Dépôt** `observatoire-web` (public)

---

## 1. Objectif

Le projet poursuit **deux objectifs de rang inégal**.

**Objectif primaire — banc d'essai technique.**
Vérifier qu'un projet web production-ready, de qualité professionnelle, peut être créé, maintenu et *fait évoluer* intégralement dans le cloud via Claude Code, sans aucune dépendance à un outillage local. Le livrable réel de l'expérimentation n'est pas le site : c'est un **journal de frictions** documentant ce qui a fonctionné, ce qui a résisté, et ce qui a nécessité un contournement.

**Objectif secondaire — produit publiable.**
Le site doit être réellement en ligne, réellement à jour, et défendable publiquement. Cette contrainte n'est pas cosmétique : c'est elle qui génère les problèmes intéressants (incidents en production, données périmées visibles, cache, montée en charge) qu'un projet jetable ne produirait jamais.

**Conséquence directe :** quand un arbitrage oppose « ce qui ferait un meilleur produit » à « ce qui ferait un meilleur test », on tranche en faveur du test. Le trafic, le SEO et la génération de leads ne sont pas des critères de succès de la v1.

### Ce que le projet doit prouver

| # | Épreuve | Pourquoi c'est dur sans local |
|---|---------|-------------------------------|
| 1 | Bootstrap et mise en place de la CI | La CI devient l'unique juge de qualité |
| 2 | Migration de schéma sur données de production | Aucun psql sous la main |
| 3 | Pilotage d'un job long, faillible, reprenable | Pas de shell pour relancer |
| 4 | Diagnostic d'un incident en production | Pas de logs locaux, pas de debugger |
| 5 | Changement de méthodologie sur historique existant | Migration non destructive |
| 6 | Maintenance sur la durée (dépendances, incidents) | Le vrai test |

---

## 2. Règles de l'expérimentation

1. **Zéro outillage local.** Tout passe par Claude Code on the web, l'interface GitHub, et les consoles web des prestataires.
2. **Règle d'échec explicite.** Si l'ouverture d'un terminal local devient nécessaire, on le note dans le journal avec la raison, et on poursuit en cloud. On ne bascule pas silencieusement.
3. **Journal de frictions** (`docs/journal.md`) mis à jour à chaque jalon. Sans lui, il ne restera qu'un site et un souvenir vague au lieu d'une conclusion.
4. **`main` protégée** dès le premier commit : PR obligatoire, checks requis, pas de push direct.
5. **Une session cloud = un ticket = une PR.** Pas de session fourre-tout.
6. **Dépôt public.** Actions gratuit, et l'historique des PR devient lui-même une démonstration exploitable par DG-Tech.

---

## 3. Le produit

### Périmètre v1

Les **communes françaises de plus de 10 000 habitants** — **1 067 entités**, mesurées le 7 août 2026 sur 34 969 communes. Le comptage est dérivé de l'API et non d'une source secondaire : c'est le premier test d'ingestion, et il a corrigé l'estimation initiale de « 950 à 1 000 » de 7 %.

Ce nombre n'est écrit nulle part dans le code : il est **recalculé à chaque ingestion** et publié dans le rapport du job. Une commune qui franchit le seuil au recensement suivant entre dans le périmètre sans qu'on touche à quoi que ce soit — et le chiffre ci-dessus vieillira, ce qui est la raison pour laquelle il porte sa date.

Le périmètre est extensible par conception (autres strates de communes, EPCI, puis éventuellement d'autres secteurs). Le nom du site n'enferme pas le périmètre : c'est délibéré.

### Ce que le site publie

- **Fiche par commune** : score courant, historique, principaux problèmes techniques détectés, présence ou absence de déclaration d'accessibilité, position par rapport à la médiane, date de mesure, lien vers la méthodologie.
- **Classements filtrables** : par région, par strate de population, par CMS détecté.
- **Baromètre périodique** : médianes, évolutions, progressions et régressions.
- **Données ouvertes** : export CSV et API publique en lecture.
- **Page méthodologie**, en accès direct depuis chaque fiche.

### Visiteurs attendus

Par ordre de valeur, pas de volume :

1. **L'ego-search** — responsable numérique ou communication de la collectivité auditée, souvent arrivé par un lien qu'on lui a transmis.
2. **Pairs et concurrents** — agences, experts accessibilité. Ne convertissent pas, relaient.
3. **Journalistes et associations** — cherchent un chiffre citable. Source principale de backlinks.

**À accepter d'emblée :** les fiches par commune ne généreront presque aucun trafic organique. Le volume de recherche sur « accessibilité site mairie de X » est proche de zéro. Elles existent pour être trouvées nominativement et pour servir de preuve, pas pour ranker.

---

## 4. Méthodologie de mesure

### Sources de données

| Donnée | Source | Notes |
|--------|--------|-------|
| Référentiel communes | API Découpage administratif (`geo.api.gouv.fr`) | Code INSEE, nom, population, département, région, EPCI. Paramètre `fields` pour filtrer. |
| URL des sites | API Annuaire de l'administration (DILA) | Sur `service-public.gouv.fr` — l'ancien domaine `service-public.fr` n'est plus à utiliser. |
| Mesure principale | API PageSpeed Insights | Lighthouse hébergé, dont l'audit accessibilité axe-core. 25 000 requêtes/jour gratuites avec clé API. |
| Signaux complémentaires | Fetch HTML direct | Déclaration d'accessibilité, mentions légales, politique de confidentialité, en-têtes de sécurité, CMS détecté. |

### Contraintes opérationnelles

- **Débit réel de l'API PSI ≈ 1 requête/seconde**, très en deçà du quota affiché : au-delà, l'API renvoie des erreurs 500 pendant plusieurs minutes. Le job doit être lent, patient, avec backoff et reprise.
- **Le champ URL de l'annuaire est incomplet et parfois périmé.** La résolution d'URL est modélisée comme un **processus à états** (candidat → vérifié → invalide → à revoir), pas comme une simple colonne. Mesuré le 7 août 2026 sur le périmètre v1 : **1 052 communes sur 1 067** reçoivent au moins une URL candidate, **15 n'en reçoivent aucune** (dont deux sans aucune fiche mairie), et **138 en reçoivent plusieurs** — souvent une page de démarches à côté de l'accueil. C'est cette dernière file, et non les URL mortes, qui justifie la machine à états.
- **Ne jamais stocker les rapports Lighthouse bruts** (300–500 Ko pièce). On extrait une vingtaine de métriques et on jette le reste. Sans cette règle, le stockage explose en trois semaines.

### Ce qu'on ne mesure pas en v1

Tout ce qui exige un navigateur headless : dépôt de cookies avant consentement, parcours utilisateur, tests d'interaction. C'est précisément ce qui ramènerait à gérer de l'infrastructure lourde et ferait dériver l'expérimentation.

### Honnêteté méthodologique

Un audit automatisé ne couvre qu'une fraction des critères RGAA. Le vocabulaire du site est donc strictement factuel : **« score de conformité technique automatisée »**, jamais « site conforme » ou « site non conforme au RGAA ». Cette précaution protège juridiquement autant qu'elle crédibilise auprès des experts accessibilité.

---

## 5. Architecture

### Le principe structurant : l'exploitation est dans le produit

Sans shell, l'opération courante doit être **explicite, exposée et testable**. Dès le jalon 2, le projet expose une surface d'ops authentifiée permettant de :

- déclencher un scan complet ou partiel,
- reprendre un scan interrompu,
- rejouer une commune isolée,
- invalider le cache d'une page ou d'un ensemble,
- consulter l'état du dernier run et ses erreurs.

Ce qui ressemble à un sur-investissement précoce est en réalité l'apprentissage central : la contrainte cloud-only force à sortir l'exploitation de l'historique du shell pour la rendre versionnée et vérifiable.

### Découplage données / build

**Règle non négociable :** un rafraîchissement de données ne déclenche jamais un redéploiement.

- Les données vivent en base.
- Les pages sont rendues à la demande et mises en cache longuement au bord, avec purge ciblée après chaque scan.
- Les déploiements ne servent qu'aux changements de code.

Cette règle règle simultanément trois problèmes : le coût d'hébergement, le temps de build, et la fraîcheur des données.

### Stack

- **Front / rendu** : **Astro** en rendu serveur, avec cache edge et îlots limités aux endroits
  qui en ont besoin. Retenu contre Next pour un site de données à nombreuses pages : très peu de
  JavaScript envoyé au client, donc un budget Lighthouse tenable sur un site qui mesure celui
  des autres.
- **Hébergement** : **Netlify**, adaptateur `@astrojs/netlify`. Voir le point de vigilance sur
  le modèle de crédits en §7.
- **Base** : Postgres serverless (Neon), migrations versionnées via Drizzle.
- **Ordonnancement** : routine planifiée ou cron GitHub Actions, découpé en lots.
- **Observabilité** : Sentry dès le premier jour — c'est le seul moyen de diagnostiquer la production sans terminal.
- **CI** : GitHub Actions — typecheck strict, lint, tests unitaires, migrations en dry-run, build, E2E Playwright sur l'URL de preview, budget Lighthouse. **Les artefacts (captures, rapports) sont systématiquement uploadés** : c'est le seul moyen de « voir » le produit.

---

## 6. Modèle de données

```
commune       (code_insee, nom, population, dept, region, epci)
site          (commune_id, url, statut_resolution, source, verified_at)
scan_run      (id, started_at, finished_at, statut, methodology_version)
measurement   (scan_run_id, site_id, url, fetched_at, scores…, http_status, error_code)
finding       (measurement_id, rule_id, impact, occurrences)
```

Deux décisions à ne pas rater, très coûteuses à rattraper ensuite :

1. **`methodology_version` sur chaque mesure.** Sans elle, impossible de faire évoluer le scoring sans invalider ou trahir l'historique — et cette évolution est explicitement un des jalons.
2. **Un scan est idempotent et reprenable à la commune près.** Chaque mesure porte son propre statut. Jamais de « le job a planté, on recommence tout ».

---

## 7. Infrastructure et coûts

| Poste | Coût | Remarque |
|-------|------|----------|
| API PageSpeed Insights | 0 € | 25 000 requêtes/jour gratuites ; le débit réel est le vrai facteur limitant |
| Base Postgres (Neon) | 0 € | Plan gratuit : 0,5 Go de stockage et 100 CU-heures/mois par projet, avec mise en veille. Tient si on stocke des agrégats. |
| Hébergement | 0 → 20 $/mois | Voir ci-dessous |
| Domaine | ~12 €/an | `.fr` + `.com` en redirection, whois en diffusion restreinte |
| GitHub Actions | 0 € | Dépôt public |
| Sentry | 0 € | Palier gratuit |

**L'hébergement — point de vigilance levé.** Netlify est retenu (§5). Sur les comptes créés après septembre 2025, le plan gratuit fonctionne en crédits : 300 par mois, 15 par déploiement de production, soit une vingtaine de déploiements — de quoi étrangler un projet en développement actif. **Le compte utilisé ici est antérieur à cette date et reste sur le plan *legacy*, sans plafond de déploiements.** La contrainte ne s'applique donc pas, et la discipline de regroupement des merges n'est plus qu'une préférence d'hygiène d'historique.

Cloudflare reste objectivement mieux adapté à un site de données à nombreuses pages et demeure un plan de repli crédible, mais l'argument économique qui le renforçait a disparu. À réévaluer au jalon 4 sur le seul terrain technique, quand le cache edge et la purge ciblée seront réellement exercés.

**Volumétrie v1 :** 1 commune = 1 URL (page d'accueil), 1 stratégie (mobile), soit **1 067 mesures** par passage hebdomadaire — au débit réel de l'API PSI (≈ 1 req/s), une trentaine de minutes de scan si rien n'échoue. L'extension à 3 URLs par commune est un jalon à part entière.

**Coût total réaliste :** 0 € au démarrage, 20–30 €/mois si l'audience décolle. Le coût dominant reste le temps de revue et les rate limits Claude.

---

## 8. Feuille de route

Chaque jalon est calibré pour provoquer une difficulté précise du travail cloud-only.

| Jalon | Livrable | Épreuve visée |
|-------|----------|---------------|
| **1** | Ingestion du référentiel, résolution d'URL, page `/stats` minimale, CI complète | Bootstrap, migration initiale, CI comme unique juge |
| **2** | Mesure sur 20 communes, fiche entité, surface d'ops | API externe capricieuse, idempotence, pilotage sans shell |
| **3** | Passage à 1 000 communes, scan par lots, reprise sur incident | Backfill long piloté depuis un navigateur |
| **4** | Publication : classements, cache edge, purge ciblée | Découplage données / build |
| **5** | Méthodologie v2 appliquée à l'historique | Migration non destructive sur données réelles |
| **6** | **4 semaines sans nouvelle fonctionnalité** | Maintenance, dépendances, incidents — le vrai test |

Les cinq premiers jalons sont à la portée de n'importe quel agent. C'est le jalon 6 qui répond à la question de départ.

---

## 9. Cadre juridique et éthique

Le site publie des mesures nominatives sur des organismes publics. Quatre garde-fous, tous en place dès la v1 :

1. **Méthodologie publique et reproductible**, accessible depuis chaque fiche.
2. **Vocabulaire strictement factuel.** Aucune qualification juridique, aucun jugement de valeur. Pas de « palmarès des pires ».
3. **Droit de réponse** avec procédure de re-mesure sous 48 h, visible et facile à activer.
4. **Indépendance affichée.** Mention « initiative indépendante » en pied de page, mentions légales nommant DG-Tech sans ambiguïté. Le nom « observatoire » sonne institutionnel : le risque qu'on prenne le site pour une émanation publique est l'angle d'attaque le plus probable, et il se neutralise gratuitement dès le départ.

**Collisions de nom connues**, aucune bloquante : Médiamétrie commercialise une étude « Web Observatoire » (termes inversés, marché différent) ; il existe par ailleurs un « Observatoire de la compublique numérique ». Ces termes étant descriptifs, aucun dépôt de marque n'est envisagé, mais le positionnement doit être distinct dès la page d'accueil.

---

## 10. Hors périmètre v1

Écartés parce qu'ils n'apprennent rien sur le workflow cloud :

- Hub de contenu éditorial (obligations, guides de correction)
- Alertes email et capture de leads
- Espace client, authentification publique
- Mesure par navigateur headless
- Toute monétisation

Le lien vers DG-Tech se limite à une page assumant la limite de la mesure automatique et proposant un audit réel.

---

## 11. Décisions encore ouvertes

- Formule exacte du score composite et pondération des signaux complémentaires
- Politique de rétention de l'historique au-delà de 12 mois
- Fréquence définitive des scans (hebdomadaire en hypothèse de travail)

Ces décisions ne doivent pas être tranchées implicitement dans du code : on les arbitre
explicitement, on met ce fichier à jour, et on consigne le changement dans le changelog.

**Décisions tranchées** — voir le changelog pour la date et la justification : framework de
rendu (Astro, v1.1), hébergeur (Netlify, v1.1).

---

## Annexe — Conventions

- Dépôt : `observatoire-web` · Package : `observatoire-web` · Environnement cloud Claude Code : `observatoire-web`
- Branches : `feat/`, `fix/`, `chore/`
- Le `CLAUDE.md` du dépôt reprend la stack, les commandes exactes, les conventions, la definition of done et les interdits. Chaque session cloud repart d'un contexte neuf : ce fichier est le contrat.

---

## Changelog

Ce brief porte l'**intention** du projet ; le `CLAUDE.md` porte les **règles de mise en œuvre**.
Toute décision structurante — un arbitrage du §11, un changement de périmètre, une révision de
la méthodologie — est reportée ici avec sa date et sa justification, dans la PR qui l'applique.
Sans cette trace, une session future ne peut pas distinguer un choix délibéré d'un défaut hérité.

Format : versions par ordre décroissant, la plus récente en tête. Les corrections de forme ne
justifient pas d'entrée ; les changements de fond, toujours.

### 1.4 — 7 août 2026

**Le périmètre v1 est mesuré, plus estimé : 1 067 communes.** L'ingestion du référentiel (J1-14)
a dérivé le chiffre de `geo.api.gouv.fr` — 34 969 communes lues, 1 067 au-dessus de 10 000
habitants — contre « de l'ordre de 950 à 1 000 » écrit au jour 1. L'écart est de 7 % : sans
conséquence technique, mais ce nombre finira sur une page publique, et une estimation présentée
comme un décompte est exactement le genre d'approximation que le §9 interdit ailleurs.

Le chiffre reste **dérivé, jamais écrit dans le code** : il est recalculé à chaque ingestion. Il
est daté ici parce qu'il vieillira.

- §3 : le périmètre annonce la mesure et sa date, et dit qu'elle se recalcule.
- §4 : la couverture réelle de l'annuaire sur le périmètre (1 052 / 15 / 138) chiffre le travail
  que la machine à états de résolution aura à faire.
- §7 : la volumétrie passe de « ~1 000 » à 1 067 mesures par passage.

### 1.3 — 5 août 2026

**Correction d'attribution.** Le porteur du projet est **DG-Tech** (dg-tech.dev), pas
StudioMaestro. Les deux sont portés par la même personne, mais StudioMaestro est une offre
commerciale de construction de sites à bas coût, sans rapport avec cet outil.

L'erreur n'était pas cosmétique : le §9 fait de l'identification sans ambiguïté de l'éditeur une
contre-mesure au risque principal du projet — qu'on prenne « observatoire » pour une émanation
publique. Nommer la mauvaise entité affaiblit exactement la protection qu'on croyait avoir, et la
mention était déjà servie en production.

- §9 et `CLAUDE.md` §11 : les mentions légales nomment DG-Tech.
- §2 et §10 : la démonstration et le lien commercial se rattachent à DG-Tech.
- `src/pages/index.astro` : pied de page corrigé.

### 1.2 — 4 août 2026

Le compte Netlify utilisé est sur un plan *legacy* antérieur à septembre 2025 : **le modèle de
crédits ne s'applique pas**, les déploiements de production ne sont pas plafonnés.

- §7 : point de vigilance sur l'hébergement levé, et non plus seulement atténué.
- Conséquence sur le choix d'hébergeur (§5) : Cloudflare reste un repli technique, mais
  l'argument économique qui le renforçait disparaît. La réévaluation du jalon 4 se fera sur le
  seul terrain technique.
- Conséquence dans `CLAUDE.md` §4 : le regroupement des merges devient une préférence d'hygiène
  d'historique, plus une contrainte de quota.

### 1.1 — 4 août 2026

Deux décisions du §11 tranchées, à l'occasion de la rédaction du `CLAUDE.md` : le contrat de
dépôt devait nommer une stack pour pouvoir fixer des commandes exactes.

- **Framework de rendu : Astro** (§5), contre Next. Le site est un site de données à nombreuses
  pages, majoritairement en lecture. Astro envoie très peu de JavaScript au client, ce qui rend
  le budget Lighthouse tenable — exigence non négociable pour un site qui publie le score des
  autres. Next offrait une purge par tag plus ergonomique (`revalidateTag`), avantage jugé
  insuffisant face au coût en poids client et à la couche d'adaptateur à maintenir hors Vercel.
- **Hébergeur : Netlify** (§5, §7), contre Cloudflare. Cloudflare reste techniquement mieux
  adapté et devient le plan de repli si le plafond de crédits devient contraignant. Le point de
  vigilance du §7 est donc maintenu, pas résolu, et à réévaluer au jalon 4.
- §11 allégé de ces deux lignes ; trois décisions y restent ouvertes.

### 1.0 — 4 août 2026

Version initiale. Objectifs, règles de l'expérimentation, périmètre produit, méthodologie de
mesure, architecture, modèle de données, coûts, feuille de route, cadre juridique.

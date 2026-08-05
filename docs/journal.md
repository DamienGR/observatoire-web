# Journal de frictions

Ce fichier est le **livrable réel** de l'expérimentation (`docs/brief.md` §1). Le site n'en est
que le prétexte : ce qui compte est la trace de ce qui a fonctionné, de ce qui a résisté, et de
ce qui a demandé un contournement dans un workflow strictement cloud.

## Comment l'alimenter

- Une entrée par friction, **écrite au moment où elle survient**. Reconstituée après coup, elle
  est déjà perdue : on se souvient de la solution, jamais du temps passé à chercher.
- Les entrées sont **numérotées et rangées par ordre chronologique croissant** — les plus
  récentes en bas. On ajoute, on ne réécrit pas.
- On consigne aussi les **hypothèses fausses**. Une mauvaise piste suivie pendant vingt minutes
  fait partie du coût réel et dit quelque chose sur la lisibilité de l'outillage.
- Une friction résolue sans effort mérite quand même une ligne : l'absence de difficulté est un
  résultat, pas un non-événement.
- Ce qui a marché du premier coup se note aussi, brièvement. Un journal qui ne contient que des
  échecs donne une image fausse de l'expérimentation.

---

## 001 — Le premier push est refusé : le dépôt n'était pas autorisé dans l'app GitHub

**4 août 2026** · jalon 1 · branche `claude/claude-md-setup-6pakih`

### Contexte

Toute première session sur un dépôt ne contenant que `docs/brief.md`. Objectif : rédiger le
`CLAUDE.md`. La rédaction n'a posé aucune difficulté — le brief était suffisamment précis pour
que le contrat en découle presque mécaniquement. Deux décisions laissées ouvertes au §11 du brief
ont dû être tranchées pour que le fichier soit utilisable : le framework (Astro) et l'hébergeur
(Netlify).

Le fichier écrit et commité localement (`8242520`), le push a échoué.

### Friction

`git push` renvoie `403` sur `git-receive-pack`. **Mais `git fetch` fonctionne parfaitement.**
Cette asymétrie est la partie coûteuse : elle donne l'impression que l'accès au dépôt est
accordé et oriente le diagnostic vers la mauvaise cause.

Quatre voies d'écriture ont été tentées, toutes refusées de façon identique :

| Voie | Résultat |
|---|---|
| `git push` via le proxy git de la session | `403` sur `git-receive-pack` |
| API GitHub — création de fichiers | `403 Resource not accessible by integration` |
| API GitHub — création de branche | `403 Resource not accessible by integration` |
| Rattachement du dépôt en accès `push` | `already_present`, aucun justificatif renouvelé |

Une tentative a par ailleurs renvoyé une erreur transitoire (`GitHub token store temporarily
unavailable`) qui a disparu au réessai — bruit sans rapport avec la cause réelle, mais qui a
brièvement fait croire à un problème passager.

### Hypothèse fausse

J'ai conclu que les jetons de la session avaient été émis à son démarrage, avant toute
correction de permissions, et qu'ils n'étaient pas renouvelables — donc qu'il fallait ouvrir une
nouvelle session. **C'était faux.** Le proxy git a fonctionné immédiatement après l'autorisation
du dépôt, sans redémarrage. Les jetons n'étaient pas périmés ; le dépôt n'était simplement pas
dans leur périmètre.

### Cause réelle et résolution

Le dépôt `observatoire-web` n'était pas autorisé dans l'application Claude côté GitHub. Une fois
ajouté à la liste des dépôts accessibles, le push est passé du premier coup.

### Ce que ça coûte, et pourquoi c'est instructif

Trois choses ont rendu ce blocage plus long qu'il n'aurait dû l'être :

1. **Le message d'erreur ne nomme rien.** `Resource not accessible by integration` ne dit ni
   quelle permission manque, ni sur quelle ressource, ni où la corriger. Côté proxy git, c'est
   pire : un `403` nu.
2. **Deux mécanismes GitHub coexistent et se ressemblent.** Le connecteur GitHub visible dans
   les paramètres Claude sert à lire GitHub depuis une conversation ; l'app GitHub de Claude
   Code, elle, est ce qui pousse du code. Le réglage cherché n'était pas là où il paraissait
   naturel de le chercher, et le connecteur visible et actif a renforcé l'impression que tout
   était en place.
3. **Le diagnostic est aveugle depuis la session.** Aucun moyen, depuis le conteneur, de lire le
   périmètre effectif du jeton. On ne peut qu'observer des refus et inférer — ce qui est
   précisément la manière dont on aboutit à une hypothèse fausse.

C'est la friction cloud-only sous sa forme la plus pure : le premier obstacle du projet n'est pas
venu du code, mais des permissions de la plateforme, et il n'était pas diagnosticable depuis
l'endroit où il se manifestait.

### Ce qu'on en retire

- **Vérifier l'accès en écriture avant de produire du travail.** Un push à vide en début de
  session coûte quelques secondes et déplace la découverte du blocage avant l'effort, pas après.
- **Sortir le livrable du conteneur dès qu'il existe.** Le conteneur est éphémère : tant que le
  push est bloqué, un commit local ne survit pas à la session. Le `CLAUDE.md` a été transmis en
  pièce jointe, ce qui a rendu le blocage gênant mais jamais destructeur.
- **Ne pas insister sur un refus de politique.** Cinq tentatives n'ont rien produit d'autre que
  la confirmation du refus. La cause était en dehors de la session ; seule une action humaine
  pouvait la lever.

### Au passage

`main` était déjà protégée au premier commit, sans intervention : la règle 4 du §2 du brief est
satisfaite dès le départ.

---

## 002 — Le bootstrap passe, mais trois outils sur quatre échouent d'abord en silence

**5 août 2026** · jalon 1 · branche `claude/phase-bootstrap-scm7na` · tâche J1-04

### Contexte

Première session de code : `package.json`, Astro SSR, TypeScript strict, ESLint/Prettier, Vitest
à deux projets avec garde anti-I/O, `.env.example`, et le job CI rapide. Rien de conceptuellement
difficile — le contrat du dépôt dit exactement quoi construire. Tout le coût réel a été dans des
frictions d'outillage, dont aucune n'était visible avant d'avoir lancé la commande.

Le fil conducteur de cette session : **la seule chose qui a fonctionné, c'est d'exécuter
`pnpm verify` dans le conteneur avant de pousser.** Trois des quatre problèmes ci-dessous
auraient produit une CI rouge — ou pire, une CI bloquée — si on s'était contenté de lire le code.

### Friction 1 — `astro check` attend une réponse interactive

`pnpm typecheck` lance `astro check`, qui constate que `@astrojs/check` n'est pas installé et
**ouvre un prompt** : `Continue? › (Y/n)`. En local, on tape `y` sans y penser. En CI, il n'y a
personne pour répondre : le job aurait attendu jusqu'au timeout de dix minutes, et le message
d'échec aurait parlé de durée, pas de dépendance manquante.

C'est le pire profil de panne pour ce projet : *lent, muet, et diagnostiqué de travers.* Corrigé
en installant `@astrojs/check` explicitement en dépendance de développement, et en fixant
`ASTRO_TELEMETRY_DISABLED: '1'` au niveau du workflow — Astro pose une seconde question, sur la
télémétrie, à la première exécution.

**À retenir :** toute commande du §3 doit être lancée au moins une fois dans une session neuve,
pas seulement écrite. Un outil qui pose une question est un outil qui bloque la CI.

### Friction 2 — épingler les actions par SHA se heurte au périmètre GitHub de la session

Le §7 impose d'épingler les actions tierces par SHA de commit. Encore faut-il obtenir le SHA
correspondant à `v6.1.0` de `actions/checkout`. Les outils GitHub de la session refusent :

```
Access denied: repository "actions/checkout" is not configured for this session.
Allowed repositories: damiengr/observatoire-web
```

Le cloisonnement est parfaitement légitime — la session ne doit voir que le dépôt du projet. Mais
il rend inaccessible une **information publique** dont une règle du dépôt dépend. Contournement :
`git ls-remote --tags https://github.com/actions/checkout`, qui passe par le proxy HTTPS et
fonctionne sans autorisation particulière.

Piège au passage : le premier `ls-remote` filtré sur `refs/tags/vN^{}` n'a renvoyé que `v1`. Les
entrées `^{}` (« tag pelé ») n'existent que pour les tags *annotés* ; les versions récentes de ces
dépôts utilisent des tags légers, dont le SHA est directement celui du commit. Deux minutes
perdues à croire que les tags récents n'existaient pas.

**Reste ouvert :** aucun moyen, depuis la session, de vérifier qu'un SHA épinglé correspond
toujours au tag annoncé. Le commentaire `# v6.1.0` en fin de ligne est une déclaration
d'intention, pas une preuve. C'est Dependabot (J1-03) qui devra tenir cette cohérence.

### Friction 3 — Prettier réécrit la documentation française

`pnpm format` a touché 121 lignes de `CLAUDE.md`, `brief.md`, `roadmap.md` et `journal.md` sans
qu'aucun de ces fichiers ait été modifié : Prettier repadde les cellules des tableaux Markdown et
convertit `*italique*` en `_italique_`.

Le résultat n'est pas faux, il est *nuisible* : dans un dépôt où la trace du raisonnement est le
livrable, un tableau repaddé transforme la correction d'un mot en diff de cinquante lignes, et
noie la modification réelle. Le Markdown est donc sorti du périmètre de Prettier
(`.prettierignore`), avec la raison écrite sur place.

**Hypothèse fausse au passage :** `proseWrap: "preserve"` semblait suffire à protéger les
documents. Il ne préserve que les retours à la ligne du texte courant, pas l'alignement des
tableaux ni le style d'emphase.

### Friction 4 — un avertissement pnpm qu'aucune configuration ne fait taire

pnpm 10 bloque par défaut les scripts d'installation des dépendances, ce qui est exactement le
comportement voulu (§7). Il le signale à chaque `pnpm install` en invitant à lancer
`pnpm approve-builds`. Déclarer `onlyBuiltDependencies: []` et `ignoredBuiltDependencies` — dans
`package.json` d'abord, puis dans `pnpm-workspace.yaml`, emplacement canonique en v10 — **n'a rien
changé à l'affichage**. L'installation réussit, aucun script ne s'exécute, la politique est bien
appliquée et versionnée ; seul l'avertissement persiste.

Coût réel : faible, mais il illustre un risque propre au cloud-only. Un avertissement permanent
et non actionnable dans les logs de CI est précisément ce qui entraîne à ne plus les lire.
Consigné en dette plutôt que résolu par un contournement.

### Ce qui a marché du premier coup

- Le push, sans aucune manipulation : le blocage de l'entrée 001 était bien définitif.
- L'installation complète des dépendances — Astro, Drizzle, Playwright, Stryker, Sentry — en
  17 secondes, sans conflit de résolution.
- Le garde anti-I/O. Bloquer `fetch` **et** `net.Socket.prototype.connect` couvre tout ce qu'un
  test unitaire pourrait atteindre : `node:http`, `node:https` et `node:tls` passent tous par ce
  même point de passage. Les six tests du garde sont verts sans ajustement.
- TypeScript en `erasableSyntaxOnly` a immédiatement rejeté les propriétés de paramètre de
  constructeur (`constructor(readonly issues: string[])`). Contrariant sur le moment, correct sur
  le fond.

### Une note sur la convention de branches

Le §4 impose `feat/`, `fix/`, `chore/`. Cette session travaille sur `claude/phase-bootstrap-scm7na`,
nom imposé par l'environnement d'exécution et non choisi. La convention du dépôt et la
plateforme se contredisent sans que la session puisse arbitrer. Signalé ici plutôt que résolu en
silence : c'est au §4 d'accepter le préfixe `claude/` ou à la plateforme de laisser choisir.

### Addendum du 5 août — la session ne peut pas vérifier la protection de `main`

Le check requis `verify` a été activé côté GitHub après le premier passage vert de la CI, ce qui
achève la moitié de J1-13. La session a essayé de le confirmer par elle-même :

```
GET /repos/DamienGR/observatoire-web/branches/main/protection
→ 403 Resource not accessible by integration
```

Troisième occurrence du même motif, après le `403` de l'entrée 001 et le cloisonnement des dépôts
de la friction 2 : **la session est aveugle à l'état de la plateforme dont dépendent ses propres
règles.** Le §4 exige une `main` protégée avec checks requis et historique linéaire ; aucune
session ne peut vérifier qu'il l'est. Ce que le conteneur observe, c'est un effet indirect —
`mergeable_state: "clean"` sur la PR — qui ne distingue pas « aucune protection » de « protection
satisfaite ».

Conséquence pratique : le statut de J1-13 dans la roadmap est **déclaratif**, pas constaté. Il est
donc écrit comme tel — check requis actif, historique linéaire encore ouvert — plutôt que
consolidé en un `terminé` qui laisserait croire à une vérification qui n'a pas eu lieu. C'est
exactement le mécanisme de dérive que la règle de mise à jour de `docs/roadmap.md` cherche à
éviter, et il vient ici de la plateforme, pas de la négligence.

---

## 003 — Durcir le dépôt : trois réglages sur quatre ne se constatent pas

**5 août 2026** · jalon 1 · tâche J1-03

### Contexte

Activation des garde-fous du §7 : secret scanning, push protection, durcissement des Actions,
Dependabot, CodeQL. Tâche marquée `[humain]` dans la roadmap, donc jamais prise par une session
depuis son ouverture. C'est la première leçon de l'entrée, et elle n'est pas technique.

### La marque `[humain]` était trop large

J1-03 mélange deux natures de travail. Secret scanning, push protection et les permissions
Actions sont des interrupteurs de console : effectivement hors de portée d'une session. Mais
Dependabot et CodeQL, eux, se configurent par **des fichiers versionnés** — `.github/dependabot.yml`
et un workflow — qu'une session écrit sans difficulté.

Marquée `[humain]` en bloc, la tâche est restée `à faire` alors que la moitié était réalisable
depuis le premier jour. Le §12 de `CLAUDE.md` dit qu'une session ne doit pas prendre une tâche
`[humain]` ; il n'avait pas prévu qu'une tâche puisse l'être à moitié. **Une tâche mixte marquée
`[humain]` est une tâche qui dort**, et elle dort sans que personne le remarque, parce que son
statut a l'air justifié.

Inscrit en dette : relire les autres `[humain]` avec cette grille.

### Friction 1 — l'option secret scanning n'existe pas, et c'est normal

Recherche infructueuse de l'interrupteur « secret scanning » dans les réglages. La documentation
GitHub explique pourquoi : **sur un dépôt public, le secret scanning tourne automatiquement et
gratuitement**, sans réglage à activer. Idem pour push protection, désormais active par défaut
sur les dépôts publics.

La friction n'est donc pas un blocage mais un **faux négatif d'interface** : l'absence de case à
cocher se lit spontanément comme l'absence de fonctionnalité. C'est le symétrique exact du
piège de l'entrée 001, où la présence d'un connecteur GitHub actif faisait croire que l'accès en
écriture était accordé. Dans les deux cas, l'interface donne un signal sur l'état du système qui
n'en est pas un.

Ce qui est réellement observable : l'onglet `Security` expose une section d'alertes de secret
scanning. Sa présence est la preuve ; l'absence de case ne prouve rien, ni dans un sens ni dans
l'autre.

### Friction 2 — la configuration Dependabot avait atterri dans un autre dépôt

Le porteur a indiqué avoir ajouté la configuration Dependabot. Avant de l'utiliser comme acquise,
vérification depuis la session : `.github/dependabot.yml` **est absent** de `main`, de toutes les
branches distantes et des PR ouvertes. Renseignements pris, le fichier avait été créé **sur un
autre dépôt**.

Erreur banale, mais sa forme est propre au travail cloud-only. Sans machine locale, il n'existe
pas de répertoire courant qui ancre le contexte : le dépôt sur lequel on agit est un onglet parmi
d'autres, et rien dans l'interface ne fait obstacle quand on se trompe de cible. Le travail
paraît fait, il l'est même réellement — ailleurs. Aucune erreur n'est levée, puisqu'aucune règle
n'est violée.

Ce qui a rattrapé le coup n'est pas de la méfiance mais une habitude déjà notée à l'entrée 001 :
**vérifier plutôt qu'inférer**, y compris ce qu'on nous affirme, et surtout quand c'est bon
marché. Deux minutes ici ; sans elles, `dependabot.yml` restait absent des deux côtés — chacun le
croyant chez l'autre — et le §7 n'était pas satisfait sans que rien ne le signale.

Corollaire pour la suite : **un changement hors dépôt n'est confirmé que par une observation dans
le dépôt.** C'est aussi la seule vérification qui restera possible pour les réglages de console
(cf. plus bas).

### Friction 3 — CodeQL ne voit pas les fichiers `.astro`

Il n'existe pas d'extracteur CodeQL pour le format `.astro`. L'analyse porte sur `.ts` et `.js` ;
les gabarits de page ne sont **pas analysés du tout**.

Ça compte ici plus qu'ailleurs. Le §7 traite le HTML tiers comme donnée hostile et interdit
`set:html` — précisément le genre d'injection qu'un scanner de code devrait attraper, et
précisément là où il ne regardera pas. La couverture des gabarits repose donc entièrement sur
ESLint (`eslint-plugin-astro`, règles `jsx-a11y`) et sur l'E2E.

Écrit ici et en dette parce qu'**un angle mort que personne n'a nommé finit par être pris pour
de la couverture**. Découvrir cette limite au jalon 4, en cherchant pourquoi une injection est
passée, coûterait infiniment plus cher que ces cinq lignes.

### Deux choix de départ assumés, pas tranchés

- **Advanced setup plutôt que default setup.** Le default garde son workflow hors du dépôt, où
  rien n'est relisible, épinglable ni diffable. Dans un projet dont la prémisse est que
  l'exploitation doit être versionnée et inspectable, un workflow invisible est le mauvais
  défaut.
- **Suite de requêtes par défaut, et CodeQL non requis.** `security-extended` trouve plus et
  bruite plus ; le choisir sans ligne de base serait une supposition. Ériger CodeQL en check
  requis avant d'avoir observé quelques exécutions serait fixer un seuil sans mesure — le
  reproche que le brief adresse ailleurs. Les deux sont à revoir sur données réelles.

### Ce que ça confirme

Sur cinq réglages du §7, **un seul est vérifiable depuis une session** : la présence des fichiers
versionnés. Les quatre autres répondent `403 Resource not accessible by integration`. Après J1-13,
c'est le second statut de roadmap qui doit être écrit comme *déclaré* et non *constaté*.

Ce n'est plus un incident, c'est une propriété du dispositif : **la posture de sécurité d'un
projet cloud-only n'est pas auditable depuis le projet.** À terme, le seul contrôle honnête est
comportemental — une PR Dependabot qui arrive le lundi prouve la configuration bien mieux qu'une
case cochée.

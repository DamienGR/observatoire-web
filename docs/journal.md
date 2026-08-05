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

---

## 004 — Le garde SSRF : le TDD paie, et deux règles de lint s'annulent

**5 août 2026** · jalon 1 · tâche J1-05

### Contexte

Première tâche de logique pure du projet, et la priorité 2 du §5 : le garde SSRF de
`src/lib/fetch/`. TDD strict imposé par la doctrine. Résultat : 166 tests, 93,9 % de branches,
2,1 s pour la couche unitaire.

### Ce que le TDD a réellement apporté ici

La table des plages rejetées a été écrite **avant** toute implémentation — une entrée par bloc
qu'on a déjà vu servir à pivoter vers un réseau interne, avec la raison en troisième colonne.

Puis l'implémentation a été **entièrement réécrite** en cours de route (voir plus bas). La table
n'a pas bougé d'une ligne, et elle a validé la seconde implémentation exactement comme la
première.

C'est la démonstration la plus nette qu'on ait eue jusqu'ici du raisonnement du §5 : *le test est
le seul endroit où la spécification survit*. Une session future qui voudra ajouter une plage n'a
pas besoin de comprendre l'implémentation ; elle ajoute une ligne à la table. Et si la
représentation interne change encore, la spécification, elle, ne bouge pas.

### Friction 1 — deux règles ESLint qui s'excluent mutuellement

Le code de parsing indexait des tableaux d'octets. Sous `noUncheckedIndexedAccess`, `bytes[i]`
vaut `number | undefined`, ce qui a déclenché deux règles de `strictTypeChecked` **en
contradiction directe** :

| Règle | Exige |
|---|---|
| `@typescript-eslint/non-nullable-type-assertion-style` | remplacer `bytes[i] as number` par `bytes[i]!` |
| `@typescript-eslint/no-non-null-assertion` | interdire `bytes[i]!` |

Aucune écriture ne satisfait les deux. Les sorties évidentes étaient mauvaises : désactiver une
règle de sûreté dans un garde SSRF, ou ajouter des `if (x === undefined) return null` que
TypeScript prouve inatteignables.

**La bonne sortie était de changer la représentation des données, pas la configuration.** Les
adresses sont devenues des `bigint`, et les plages sont déclarées en notation CIDR
(`'169.254.169.254/32'`, `'fc00::/7'`), analysées au chargement du module par le même parseur que
le garde utilise. Plus aucune indexation, plus aucune assertion, plus aucune branche morte.

Le conflit de lint a donc produit un meilleur code que celui qu'on aurait écrit sans lui — et il
a fait apparaître un **bug latent** : la plage IPv6 `100::/64` était comparée sur 16 bits au lieu
de 64, parce que l'ancien code bornait sa boucle à la longueur du préfixe écrit à la main. En
CIDR, la longueur est dans la notation : l'erreur devient impossible à écrire.

### Ce que ça dit du contrat lui-même

Deux exigences du dépôt tirent en sens inverse, et il vaut mieux l'écrire :
`noUncheckedIndexedAccess` **pousse à écrire des gardes défensifs**, et le seuil de 90 % de
branches **interdit de les laisser non couverts**. Quand un garde porte sur un cas que le
compilateur prouve impossible, aucun test ne peut l'atteindre.

La règle qu'on en tire, appliquée trois fois dans cette PR : **une branche que TypeScript prouve
inatteignable est supprimée, pas testée.** Un `if` qui ne peut pas être faux n'est pas une
défense, c'est une fausse assurance — et il coûte du taux de couverture qu'on serait tenté de
racheter par un test de complaisance. Trois branches ont été retirées ainsi, chacune avec le
commentaire disant pourquoi elle n'est pas là.

### Friction 2 — une apostrophe typographique dans le User-Agent

Le `User-Agent` par défaut avait été écrit en français, avec une apostrophe typographique (`’`,
U+2019). Quatorze tests ont échoué d'un coup sur :

```
Cannot convert argument to a ByteString because the character at index 42
has a value of 8217 which is greater than 255.
```

Une valeur d'en-tête HTTP est une `ByteString` : aucun point de code au-dessus de 255. Le §4 dit
déjà que le code et les identifiants sont en anglais ; cette panne montre que la règle n'est pas
qu'une convention de lisibilité, elle a des effets à l'exécution.

Détail plus intéressant que la panne : le premier test écrit pour l'empêcher de revenir vérifiait
les points de code par une expression régulière — et ESLint l'a refusée (`no-control-regex`). Le
test a été réécrit en `expect(() => new Headers({ 'user-agent': UA })).not.toThrow()`, c'est-à-dire
**en interrogeant l'API qui impose réellement la contrainte** au lieu d'en réimplémenter une
approximation. La seconde version est plus courte et plus juste. Le refus du linter a, là encore,
amélioré le test.

### Ce qui n'est pas couvert, et pourquoi c'est écrit

**Le rebinding DNS reste ouvert.** Le garde résout le nom, juge les adresses, puis rend le **nom
d'hôte** à `fetch`, qui résout à nouveau. Un enregistrement dont le TTL expire entre les deux
réponses peut présenter une adresse publique au garde et une adresse privée à la connexion.

Fermer la brèche demande de composer directement l'IP vérifiée avec un en-tête `Host` épinglé et
un dispatcher HTTP dédié. C'est faisable, mais c'est une autre tâche. Le résidu est écrit dans le
module, dans la roadmap et ici, plutôt que corrigé à moitié : **une atténuation partielle qui a
l'air complète est pire qu'une brèche documentée.**

### Ce qui a marché du premier coup

- L'injection de `resolve` et `fetch` en dépendances. Le garde anti-I/O de l'entrée 002 rendait le
  test du client impossible autrement — et c'est le module où « on n'a pas pu le tester » aurait
  été une réponse inacceptable. La contrainte a dicté l'architecture, dans le bon sens.
- Les 79 tests de la table de plages, verts à la première exécution après implémentation.
- Le parcours des bornes (`9.255.255.255` autorisée, `10.0.0.0` refusée, et ainsi de suite pour
  chaque bloc) : aucun décalage d'un bit.

---

## 005 — Six PR Dependabot : l'intérêt était dans celle qu'on refuse

**5 août 2026** · jalon 1 · branche `claude/dependabot-updates-vgavfn`

### Contexte

Première récolte de Dependabot après J1-03 : six PR ouvertes d'un coup — deux majeures Astro
(`5 → 7`) et `@astrojs/netlify` (`6 → 8`), une PR combinant les deux, `drizzle-orm` en mineure,
`@types/node` (`22 → 26`), et le groupe `github-actions` avec cinq actions.

### Friction 1 — le groupement produit quand même des PR redondantes

Le `dependabot.yml` laisse les majeures **délibérément non groupées** (« elles portent des
ruptures, on les lit une par une »). Résultat : Astro seul (#9), `@astrojs/netlify` seul (#7),
**et** les deux ensemble (#10) — parce que l'adaptateur a une plage de pair sur Astro et que
Dependabot ouvre alors la PR combinée en plus des deux isolées. Trois PR pour deux paquets, dont
deux qui ne peuvent pas être mergées seules.

Ce n'est pas un défaut de configuration à corriger : la PR combinée est la seule mergeable, et
les deux autres sont le prix à payer pour lire les majeures séparément. Le noter suffit —
**la règle à retenir est de chercher la PR combinée avant de regarder les isolées**, pas
l'inverse.

Autre effet du plafond : `open-pull-requests-limit: 5` était atteint sur npm. Le groupe
`dev-dependencies` (mineur/correctif) n'a produit **aucune PR** — non pas parce qu'il n'y avait
rien, mais parce qu'il n'y avait plus de place. Un plafond atteint est silencieux : rien ne
distingue « à jour » de « masqué ».

### Friction 2 — `@types/node` : la seule PR à refuser, et la CI ne l'aurait pas dit

`@types/node` passait de 22 à 26. La CI serait probablement **verte** : les types de Node 26
décrivent un sur-ensemble d'API, `tsc` n'a aucune raison de se plaindre.

C'est précisément ce qui la rend dangereuse. Le moteur est épinglé sur Node 22 LTS
(`.nvmrc`, `engines`). Des types en avance de quatre majeures autorisent le code à appeler des
API qui n'existent pas à l'exécution, et le seul juge du projet (§5 de `CLAUDE.md`) ne verra
rien. **`@types/node` n'est pas une dépendance ordinaire dont la dernière version est la
meilleure : c'est un suiveur du moteur.** Refusée, et la règle est écrite dans `dependabot.yml`
plutôt que laissée à la mémoire d'une session future — une décision non versionnée ne survit pas
au changement de contexte.

### Ce que la majeure Astro a révélé sur nos propres déclarations

Astro 6 relève le plancher à **Node 22.12.0**. Nos `engines` déclaraient `>=22.0.0 <23`.

Le plancher déclaré était donc devenu **faux**, et rien ne l'aurait signalé : la CI installe
depuis `.nvmrc` (`22`), qui flotte vers la dernière 22.x et satisfait le vrai plancher par
accident. `engines` resserré à `>=22.12.0 <23` dans la même PR. La leçon est générale — **une
majeure d'un cadre applicatif déplace des contraintes que le dépôt a recopiées ailleurs**, et
ces copies ne sont vérifiées par personne.

Deux autres points relevés en lisant les guides de migration, sans effet ici mais notés :

- Astro 7 **réserve `src/fetch.ts`** comme point d'entrée de routage avancé. J1-05 vient de créer
  `src/lib/fetch/` — hors du chemin réservé, donc rien à faire. À un répertoire près, la PR
  précédente aurait transformé le garde SSRF en route.
- `compressHTML` passe par défaut de `true` à `'jsx'`. Changement silencieux d'espacement, sans
  conséquence tant que le site est une page de bootstrap ; à revoir dans J1-09.

### Friction 3 — un pin d'action qui n'était pas un commit

Le §7 exige les actions tierces épinglées **par SHA de commit**. Le groupe `github-actions`
proposait pour `github/codeql-action` un nouveau SHA… avec le **même** commentaire de version
(`# v4.37.6`). Une mise à jour qui ne met rien à jour : suspect.

Vérification :

```
git ls-remote --tags https://github.com/github/codeql-action
9e3211c9a3b9311dfe05da2ed48eea3386f042dd  refs/tags/v4.37.6
5595ccaf912efad79be6eef63a5619ff05969be3  refs/tags/v4.37.6^{}
```

L'ancien pin était l'**objet tag annoté**, pas le commit. GitHub Actions l'accepte et l'analyse
tournait, mais le dépôt croyait appliquer une règle qu'il n'appliquait qu'à moitié. Dependabot a
corrigé le type d'objet, pas la version. Les trois autres actions (`checkout` v7.0.1,
`setup-node` v7.0.0, `upload-artifact` v7.0.1) ont été vérifiées de la même façon : SHA conformes
aux étiquettes annoncées.

### Une friction de l'entrée 002 qui n'en est plus une

L'entrée 002 affirmait qu'« une session ne peut pas résoudre une étiquette en SHA depuis le
conteneur ». **C'est faux** : `git ls-remote --tags <url>` fonctionne, sans authentification,
depuis le conteneur. La vérification ci-dessus en dépend entièrement.

L'hypothèse d'origine venait d'un échec de l'API REST GitHub et avait été généralisée à tort à
tout accès sortant. On ne réécrit pas 002 (le journal s'ajoute, il ne se corrige pas), mais la
correction vaut d'être écrite : **une capacité déclarée absente sans avoir été testée devient un
contournement permanent.** C'est le mode de panne le plus coûteux d'un journal — il fige une
limite imaginaire.

### Ce qui a marché du premier coup

- Le saut de deux majeures d'Astro (`5.18.2 → 7.1.6`) et de deux de l'adaptateur Netlify
  (`6.6.5 → 8.1.3`) : `pnpm verify` vert sans **aucune** modification de code. Le mérite en
  revient à la date plus qu'à l'architecture — le site est une page de bootstrap, la surface
  d'API exposée se résume à `defineConfig`. Le même saut dans six mois coûtera davantage, et
  c'est un argument pour ne pas laisser les majeures s'accumuler.
- La consolidation des quatre PR npm en une seule branche : `pnpm-lock.yaml` n'a été résolu
  qu'une fois. Merger les PR l'une après l'autre aurait imposé trois rebases Dependabot et trois
  cycles de CI pour le même résultat — la roadmap prévenait déjà que ce fichier est « le conflit
  le plus pénible à résoudre ».

---

## 006 — Trois majeures d'outillage : deux vraies, une qui n'existait pas

**5 août 2026** · jalon 1 · branche `claude/dependabot-updates-vgavfn`

### Contexte

Suite immédiate de l'entrée 005. Le merge de la récolte a libéré le plafond
`open-pull-requests-limit`, et Dependabot a aussitôt ouvert les trois PR qu'il gardait en
réserve : `typescript` 5.9.3 → 6.0.3, `astro-eslint-parser` 1.4.0 → 3.0.0, `globals` 16 → 17.

La prédiction de l'entrée 005 s'est donc vérifiée **dans la minute**. Elle mérite d'être retenue
telle quelle : *un plafond atteint ne se distingue pas d'un dépôt à jour.* Trois majeures
d'outillage sont restées invisibles tant que cinq PR occupaient la file.

### Friction 1 — la PR qui ne changeait rien

`astro-eslint-parser` était déclaré en `devDependencies` depuis le commit de bootstrap. La monter
en 3.0.0 semblait mécanique. Deux vérifications ont montré le contraire :

```
pnpm exec eslint --print-config src/pages/index.astro   → parser: astro-eslint-parser@1.4.0
pnpm why astro-eslint-parser                            → 2 versions installées
```

ESLint linte bien les `.astro`, mais avec la **1.4.0** — celle qu'embarque `eslint-plugin-astro`,
dont la plage est `^1.3.0`. Le `eslint.config.js` n'importe jamais le parser directement : il
passe par `astro.configs.recommended`. Notre dépendance directe n'a donc jamais été celle qui
lint, et `eslint-plugin-astro@1.7.0` ne *peut pas* utiliser une 3.x.

Monter la version aurait produit une deuxième copie inutilisée et, surtout, un `package.json`
annonçant un parser que le lint n'emploie pas. **La bonne disposition n'était pas de monter la
dépendance mais de la supprimer.** Vérifié par sonde : un `.astro` contenant un `any` et un
`<img>` sans `alt` est toujours rejeté sur `@typescript-eslint/no-explicit-any` et
`astro/jsx-a11y/alt-text`, à l'identique, après retrait.

C'est la même erreur que le pin de tag annoté de l'entrée 005, sous un autre habit : **une
déclaration que personne ne vérifie finit par décrire autre chose que la réalité.** La différence
est qu'ici c'est Dependabot qui l'a rendue visible, en proposant de mettre à jour une chose
inerte.

### Friction 2 — un vert n'aurait rien prouvé

Il faut le dire franchement : `pnpm verify` était **vert** avec `astro-eslint-parser@3.0.0`
installé. La CI n'aurait rien signalé, et la PR aurait été mergée comme les autres.

Ce n'est pas un défaut de la CI — aucun test raisonnable ne peut vérifier « la version déclarée
est celle qui s'exécute » pour chaque dépendance. C'est une limite structurelle du principe
« la CI est l'unique juge » (§1) : elle juge le **comportement**, pas la **cohérence des
déclarations**. Les deux entrées 005 et 006 ont trouvé chacune une déclaration fausse qu'aucun
test n'aurait attrapée. Ce qui les a trouvées, dans les deux cas, c'est d'avoir demandé à
l'outil ce qu'il faisait vraiment (`git ls-remote`, `eslint --print-config`) au lieu de croire le
fichier sur parole.

### TypeScript 6 : la dépréciation qui arrive au bon moment

`tsc` a refusé de passer sur une seule ligne :

```
tsconfig.json(14,5): error TS5101: Option 'baseUrl' is deprecated and will stop
functioning in TypeScript 7.0.
```

Deux sorties possibles : `"ignoreDeprecations": "6.0"`, ou retirer `baseUrl`. La première n'est
pas une correction, c'est un report — et le report expire à TS 7, **déjà publié en `latest`**.
`baseUrl` retiré, les `paths` étant résolus relativement au `tsconfig.json` quand il est absent.

Vérifié par sonde, parce que changer un mécanisme de résolution sans le prouver est exactement le
genre de chose qui se découvre trois sessions plus tard : un fichier important `~/lib/fetch/…`
échoue en `TS2305` (« pas d'export nommé »), **pas** en `TS2307` (« module introuvable »). Le
module est donc bien résolu.

### Pourquoi Dependabot ne propose pas la dernière version, et il a raison

`npm view typescript dist-tags` donne `latest: 7.0.2`. Dependabot proposait 6.0.3. Ce n'était pas
un retard :

| Paquet | Pair `typescript` |
|---|---|
| `@astrojs/check@0.9.10` | `^5.0.0 \|\| ^6.0.0` |
| `typescript-eslint@8.66.0` | `>=4.8.4 <6.1.0` |

6.0.3 est la **plus haute version que la chaîne d'outils accepte**. Passer en TS 7 aurait cassé
les deux pairs — et `pnpm` n'aurait émis qu'un avertissement, pas une erreur. Suivre `latest`
plutôt que la proposition de Dependabot aurait été une régression déguisée en modernisation.

Corollaire à retenir : les prochaines montées de TypeScript seront **plafonnées à 6.0.x** tant
que `typescript-eslint` reste en 8.x. Une PR Dependabot qui « n'arrive pas » n'est pas
nécessairement un dépôt à jour.

### Ce qui a marché du premier coup

- `globals` 16 → 17 : aucun effet, la config n'utilise que `globals.node`.
- TypeScript 6 sur le reste du dépôt : zéro erreur sur 22 fichiers, `astro check` compris. La
  configuration est pourtant agressive (`exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`,
  `erasableSyntaxOnly`). Le mérite revient au fait que le code est jeune, pas à la config.
- Les sondes jetables (`__probe.astro`, `__probe.ts`, créées, exécutées, supprimées) : c'est le
  moyen le plus court trouvé jusqu'ici pour vérifier ce que fait réellement un outil dans une
  session sans terminal interactif.

---

## 007 — L'alias `~` : la correction évidente ne corrigeait rien

**5 août 2026** · jalon 1 · branche `claude/dependabot-updates-vgavfn`

### Contexte

Dette ouverte par l'entrée 006 : `tsconfig.json` et `astro.config.mjs` déclaraient l'alias `~`,
`vitest.config.ts` non. Aucun fichier ne l'utilisant encore, la brèche était latente — mais J1-06,
J1-07 et J1-08 écrivent toutes dans `src/lib/` et l'emploieraient naturellement.

### La friction

La correction paraissait tenir en trois lignes :

```ts
export default defineConfig({
  resolve: { alias: { '~': new URL('./src/', import.meta.url).pathname } },
  test: { projects: [ /* … */ ] },
});
```

**Elle ne fonctionne pas.** Le test écrit d'abord — rouge sur `Cannot find module '~/lib/fetch'`
— est resté rouge après cette correction. Un `resolve.alias` posé à la racine du fichier n'est
**pas hérité** par les entrées `projects` : chaque projet est une configuration Vite complète et
indépendante. L'alias doit être déclaré dans chacune.

Le détail qui rend la chose vicieuse : la version racine ne produit **aucun avertissement**. Elle
a l'air d'une déclaration correcte, elle est syntaxiquement valide, et elle ne résout rien.

C'est le troisième cas de la journée après le pin de tag annoté (005) et le parser inerte (006).
Trois configurations différentes, une seule et même forme : *quelque chose qui a l'air déclaré ne
l'est pas.* La différence ici est que le TDD imposé par le §5 l'a attrapé **avant** le commit,
parce que le test existait déjà et refusait de virer au vert. Sans lui, la correction aurait été
poussée, mergée, et la panne serait apparue trois sessions plus tard dans une PR qui n'aurait rien
à voir — au moment précis où quelqu'un écrit son premier `import … from '~/lib/…'`.

### Le test, et pourquoi il n'assère pas la résolution

```ts
expect(viaAlias).toBe(viaRelative);
```

Un test qui se contenterait d'importer via l'alias passerait sur une configuration qui le résout
vers une **seconde copie** du module — cas où l'état de niveau module se dédouble silencieusement.
Comparer les deux liaisons ferme les deux pannes d'un coup : non résolu, et résolu ailleurs.

Le projet `integration` a été vérifié de la même façon, par sonde jetable, puisqu'il n'a encore
aucun test à porter la garantie (`--passWithNoTests`, cf. dette).

### Ce que ça ajoute au contrat

Le §5 justifie le test-first par « le test est le seul endroit où la spécification survit ». Cette
entrée en montre un second usage, plus immédiat : **le test-first est aussi ce qui distingue une
correction d'une correction apparente.** Les deux se ressemblent beaucoup dans un diff.

---

## 008 — `sharp` : l'override était moins risqué que ma propre note ne le disait

**5 août 2026** · jalon 1 · branche `claude/dependabot-updates-vgavfn`

### Contexte

Dernière advisory haute après la récolte de l'entrée 005 : `sharp@0.34.5` hérite de quatre CVE
libvips (GHSA-f88m-g3jw-g9cj). Le correctif n'existe qu'en `>=0.35.0` — aucun rétroportage en
0.34.x — donc aucune plage directe ne peut l'atteindre. Il fallait un `overrides` pnpm.

### La friction : ma propre note de dette était fausse

L'entrée écrite en 005 disait qu'un override reviendrait à « imposer à Astro une version qu'il
n'a pas testée ». Vérification faite au moment de l'appliquer :

```
astro@7.1.6  → sharp: ^0.34.0 || ^0.35.0   (optionnelle)
ipx@3.1.1    → sharp: ^0.34.3
```

**Astro accepte déjà 0.35.** Le paquet qui plafonnait la résolution était `ipx`, tiré par
`@netlify/images ← @netlify/dev ← @netlify/vite-plugin ← @astrojs/netlify`. Le risque réel
n'était donc pas là où la note le plaçait, et il est nettement plus étroit : le chemin d'image
CDN de Netlify, que ce site n'emprunte pas puisqu'il ne sert aucune image.

C'est la quatrième fois de la journée qu'une affirmation écrite se révèle inexacte à la
vérification — après le pin de tag annoté (005), le parser inerte (006) et l'alias Vitest (007).
Les trois premières venaient d'outils tiers. **Celle-ci venait de moi**, écrite quelques heures
plus tôt dans ce même dépôt, avec l'assurance d'un constat alors que c'était une supposition.

La leçon est désolante de simplicité et vaut d'être écrite : *une note de dette est une
hypothèse, pas un fait.* Elle est rédigée au moment où l'on quitte le sujet, c'est-à-dire au
moment où l'on en sait le moins. La relire en la vérifiant coûte quelques minutes ; la croire
coûte une décision prise sur un risque mal situé.

### Ce que l'override déclare, et ce qu'il tait

Un `overrides` est une affirmation : *nous savons mieux que la plage déclarée par ce paquet.*
Écrit sans justification, il devient exactement ce que ce dépôt combat depuis trois entrées — une
déclaration que personne ne peut vérifier. L'entrée porte donc, en commentaire dans
`pnpm-workspace.yaml` : la référence de l'advisory, pourquoi la plage ne suffit pas, quel paquet
est réellement dépassé, quel risque est accepté, et **la condition de retrait** (le jour où `ipx`
accepte 0.35).

pnpm 10 lit `overrides` depuis `pnpm-workspace.yaml`, au même endroit que la politique de scripts
d'installation déjà présente — vérifié, pas supposé : le lockfile en porte la trace en tête de
fichier.

### La vérification qui manquait

`pnpm verify` vert ne prouve rien ici : le site ne sert aucune image, donc le build n'exerce
jamais `sharp`. Un binaire libvips incompatible serait passé inaperçu jusqu'au premier usage.

Sondé directement — chargement du module, création d'une image, redimensionnement, relecture des
métadonnées :

```
sharp 0.35.3 | libvips 8.18.3
rendu : png 16x8 (99 octets)
```

Le binaire natif fonctionne sans script d'installation, ce qui était attendu (`sharp` publie des
binaires précompilés en dépendances optionnelles) mais méritait d'être constaté, le §7 interdisant
justement l'exécution de scripts d'installation.

### Résultat

`pnpm audit` : **0 haute, 2 modérées** (`esbuild`, `qs`), contre 4 hautes / 7 modérées / 4 basses
sur `main` ce matin. Une seule copie de `sharp` dans l'arbre, plus aucune référence aux binaires
0.34 dans le lockfile.

### Post-scriptum — la vérification qui a trouvé autre chose

L'override touchant un paquet du chemin Netlify (`ipx`), la deploy preview a été interrogée pour
constater qu'elle servait toujours quelque chose. Elle répond **404**.

Vérification immédiate avant d'accuser le diff : la production et les previews des PR #10, #18 et
#19 répondent **404 elles aussi**. Le défaut est pré-existant et sans rapport.

Première hypothèse : « la fonction SSR n'est pas invoquée ». Juste, mais c'est le symptôme. La
cause se lit en demandant au site autre chose que `/` :

| Chemin | Réponse |
|---|---|
| `/` | 404 |
| `/package.json` | **200**, notre vrai `package.json` |
| `/CLAUDE.md`, `/docs/brief.md`, `/src/pages/index.astro` | **200** |
| `/README.md` | 404 — fichier absent du dépôt |

La correspondance est exacte : **Netlify publie l'arborescence Git en statique.** Le build n'est
jamais exécuté, la fonction SSR jamais déployée, et `/` échoue faute d'`index.html` à la racine.
Il n'existe aucun `netlify.toml` dans le dépôt, et les réglages du site n'ont ni commande de build
ni répertoire de publication.

Deux conséquences que le symptôme seul ne laissait pas voir : **aucun en-tête de sécurité du §7
n'a jamais été en vigueur** (seul `Strict-Transport-Security`, que Netlify ajoute de lui-même), et
J1-12 était bloquée sur une preview qui ne sert rien.

La leçon de méthode est la même qu'aux entrées 005 à 007 : la première explication plausible
n'était pas fausse, elle était **trop haut placée**. Ce qui a fait apparaître la cause est d'avoir
demandé au système quelque chose qu'on ne cherchait pas — ici, un chemin autre que celui qui
échouait.

C'est le cas que le §1 décrit mot pour mot : *si la CI est verte et que le produit est cassé,
c'est la CI qu'il faut corriger.* Quatre PR ont été mergées aujourd'hui avec un check `verify`
vert et un statut « Deploy Preview ready! », sans que rien ne regarde jamais **ce que la preview
sert**. Le seul juge du projet ne juge que le build.

Non corrigé ici (§12 : on n'absorbe pas), inscrit en dette avec la contrainte qui manque — un
check qui exige un 200 et le `<h1>` attendu. C'est la découverte la plus importante de la journée,
et elle vient d'une vérification faite pour une tout autre raison.

### Épilogue — la cause était versionnable

Le correctif tient en un `netlify.toml` de deux directives : `command = "pnpm build"`,
`publish = "dist"`. Il n'existait aucun fichier de configuration de déploiement dans le dépôt.

On redoutait que les réglages d'interface écrasent le fichier — auquel cas la réparation aurait
exigé une intervention **[humain]** en console. Ce n'était pas le cas : la deploy preview de la
PR #21 répond **200** sur `/` avec le `<h1>` attendu, `/package.json` et `/CLAUDE.md` répondent
enfin 404, et l'horodatage rendu par `index.astro` change entre deux requêtes
(`cache-status: fwd=miss`) — c'est bien la fonction SSR qui répond, pas un fichier statique.

Ce qui reste à faire n'est pas la réparation mais **la garde**. Quatre PR ont été mergées ce jour
avec un check `verify` vert et un statut « Deploy Preview ready! » pendant que le site servait
404. Rien ne regardait ce que la preview *sert*. Tant que ce check n'existe pas, la panne peut
revenir à l'identique et personne ne le saura — et c'est exactement ce que le §1 refuse.

Dernière remarque, pour le fil de la journée : trois des quatre déclarations fausses trouvées
aujourd'hui l'ont été en interrogeant un outil. Celle-ci a été trouvée en interrogeant le
**produit**, et par accident, à l'occasion d'une vérification faite pour une autre raison. C'est
un argument pour que la vérification du produit soit un check, pas une curiosité.

---

## 009 — La sixième déclaration fausse, et la seule qu'aucun outil ne pouvait trouver

**5 août 2026** · jalon 1 · branche `claude/dependabot-updates-vgavfn`

Entrée courte, mais elle clôt le motif de la journée.

Le dépôt nommait **StudioMaestro** comme porteur du projet, en pied de page, dans les mentions
légales prévues et dans le brief. C'est faux : le porteur est **DG-Tech** (dg-tech.dev).
StudioMaestro est une offre commerciale de construction de sites à bas coût, portée par la même
personne mais sans rapport avec cet outil. Signalé par le porteur, corrigé, brief passé en 1.3.

Ce n'était pas une coquille. Le §9 fait de l'identification sans ambiguïté de l'éditeur une
**contre-mesure** au risque principal du projet : qu'on prenne « observatoire » pour une émanation
publique. Nommer la mauvaise entité n'affaiblit pas seulement la mention, elle affaiblit la
protection — et le §11 de `CLAUDE.md` en fait un interdit explicite. La mention était servie en
production depuis la réparation du déploiement de l'entrée 008.

C'est la sixième déclaration fausse trouvée aujourd'hui. Les cinq premières se laissaient
attraper en interrogeant un outil (`git ls-remote`, `eslint --print-config`, un test rouge) ou le
produit (`curl` sur la preview). **Celle-ci, aucune interrogation n'aurait pu la trouver.** Le
dépôt était cohérent avec lui-même : le brief, le contrat et la page disaient tous la même chose,
et tous se trompaient ensemble. Il n'existe aucune source de vérité dans le dépôt contre laquelle
la vérifier.

La limite est structurelle et vaut d'être écrite noir sur blanc : **une session ne peut vérifier
que ce qui est vérifiable depuis le dépôt et le réseau.** Les faits qui ne vivent que chez le
porteur — qui édite, quelle entité juridique, quel domaine commercial — ne sont contrôlables par
personne d'autre que lui. Ils appartiennent à la même famille que les réglages de console de
l'entrée 003 : ni la CI ni une session ne les couvrent, et les traiter comme acquis parce qu'ils
sont écrits est précisément l'erreur.

Corollaire pratique : les affirmations sur le **monde** (identité, mentions légales, domaines,
comptes) méritent une relecture humaine explicite au moins une fois, au même titre qu'une
migration de schéma. Les affirmations sur le **code** ont la CI ; celles-là n'ont personne.

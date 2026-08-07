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

---

## 010 — Le check qui manquait : ce qu'on assère, et ce qu'on refuse d'asserer

**5 août 2026** · jalon 1 · branche `claude/dependabot-updates-vgavfn`

L'entrée 008 réparait le déploiement et laissait la garde ouverte. La voici.

### L'assertion qui compte n'est pas celle qu'on croit

Le réflexe est de vérifier que `/` répond 200. C'est nécessaire et **insuffisant pour la panne
qu'on vient de vivre** : un site qui publie la racine du dépôt répond bel et bien 404 sur `/`,
faute d'`index.html`. Un check limité à la page d'accueil aurait viré au rouge, oui — mais en
désignant un problème de routage, pas la mauvaise configuration qu'il s'agissait de nommer.

L'assertion qui décrit vraiment le défaut est l'inverse d'une disponibilité :

```
/package.json          ne doit PAS être servi
/CLAUDE.md             ne doit PAS être servi
/src/pages/index.astro ne doit PAS être servi
```

Un 200 sur l'un de ces chemins signifie une seule chose, sans ambiguïté possible : c'est le dépôt
qui est publié, pas le build. Le message d'échec le dit en toutes lettres, pour que la prochaine
lecture n'ait pas à refaire le diagnostic de l'entrée 008.

### Ce qu'on a refusé d'asserer, et c'est le point intéressant

La tentation était forte de vérifier que la fonction SSR rend bien à chaque requête — c'est ce qui
avait servi de preuve en 008, en comparant deux horodatages. **Écarté délibérément.**

Le §10 prévoit un cache edge long avec purge par tag. Le jour où il arrive, deux requêtes
renverront légitimement le même horodatage, et l'assertion virerait au rouge sur un comportement
correct. Un check qu'il faut supprimer pour livrer une fonctionnalité prévue est un check qu'on
apprend à ignorer — exactement ce que le §5 range parmi les pannes les plus graves.

La règle qu'on en tire : **une assertion doit rester vraie sur toute la trajectoire prévue du
produit, pas seulement aujourd'hui.** Une assertion à durée de vie limitée coûte plus cher que
l'absence d'assertion, parce qu'elle érode la confiance dans toutes les autres.

### Découverte de l'URL plutôt que configuration

Le §6 interdit une URL de base dans le diff, et un hôte écrit en dur serait faux sur toutes les
branches sauf une. `scripts/resolve-netlify-url.mjs` lit donc l'URL du **statut de commit** que
Netlify publie — `deploy-preview-<n>--<site>` sur une PR, l'hôte de production sur un push. La
correspondance par préfixe `netlify/` couvre les deux sans les nommer.

Le job tourne en `contents: read` + `statuses: read`, sans aucun secret : c'est ce qui le rend sûr
sur une PR, y compris de fork, sans jamais approcher `pull_request_target` (§7). Aucune action
tierce n'est ajoutée — un script maison évite une dépendance de chaîne d'approvisionnement de
plus, et il est plus court que la configuration qu'il aurait fallu écrire pour une action.

Détail appris en écrivant : un statut Netlify en `error` ou `failure` doit être traité comme un
**échec immédiat**, pas comme « pas encore prêt ». Sinon on attend les cinq minutes du délai
d'attente pour finir par rapporter un timeout à la place de la vraie cause.

### Éprouvé dans les deux sens

Le chemin vert sur la preview réelle, le chemin rouge sur un déploiement inexistant :

```
ok    GET / returns 200                    FAIL  GET / returns HTTP 404, expected 200
ok    GET / is text/html                   FAIL  GET / content-type is "absent"
ok    GET / renders the expected heading   FAIL  GET / does not contain <h1>…</h1>
```

La première rédaction rapportait « returns no response (HTTP 404) » — deux affirmations
contradictoires dans la même ligne, parce que le statut réel était perdu à la dernière tentative.
Corrigé : un message d'échec qui envoie chercher une panne réseau inexistante coûte plus cher que
pas de message.

### Ce qui reste **[humain]**

Le job existe et tourne, mais **rien n'empêche de merger malgré son échec** tant qu'il n'est pas
ajouté aux checks requis de `main` — réglage de console qu'une session ne peut ni faire ni
constater (même limite que J1-13 et l'entrée 003). Inscrit comme tel : un check non requis est un
avis, pas une garde.

### Post-scriptum — le job a échoué au premier push sur `main`, et c'était ma phrase

Le job `deploy` est passé au vert sur la PR #23, puis **rouge au merge**. Le commentaire que
j'avais écrit dans le workflow disait :

> La correspondance par préfixe couvre les deux contextes que Netlify utilise — deploy-preview
> sur une PR, et le déploiement de production sur un push vers `main`.

Faux. Sur le commit de `main`, l'API GitHub renvoie **zéro** statut de commit, et le job l'a
constaté trente fois de suite avant d'expirer :

```
attempt 29/30: no successful netlify/* status yet (0 netlify status(es) seen)
No successful netlify/* commit status on 7e36ec2 after 300s.
Either the site is not linked to this repository, or the deploy never started.
```

Netlify publie un statut pour les deploy previews, pas pour les déploiements de production.

Il faut le dire sans détour : **c'est la septième déclaration fausse de la journée, et je l'ai
écrite dans la PR dont le sujet était de ne pas livrer de déclarations invérifiables.** Toutes les
autres assertions de cette PR avaient été éprouvées — les deux chemins du script, le vert et le
rouge. Celle-là, seule, était une supposition sur le comportement d'un tiers, glissée dans un
commentaire. Un commentaire n'a pas de chemin d'exécution : rien ne l'oblige à être vrai, et il
échappe à la discipline qu'on applique au code juste à côté.

Deux choses ont bien fonctionné, et elles valent d'être notées parce qu'elles sont ce qui a rendu
le diagnostic immédiat :

- Le compteur `0 netlify status(es) seen` désignait la cause au lieu de la masquer. Un simple
  « timeout » aurait envoyé chercher une lenteur de déploiement.
- Le message d'expiration nommait les deux hypothèses réelles, dont la bonne.

Le job est restreint aux `pull_request`. Vérifier la production demanderait son hôte, que le §6
garde hors du diff : cela attend `SITE_URL` en variable Actions, donc une action **[humain]**. La
perte est faible, `main` étant protégée — tout commit y arrive par une PR que ce job a déjà
gardée.

La règle qu'on en tire : **un commentaire qui affirme un comportement externe est une assertion
non testée.** Soit on le vérifie avant de l'écrire, soit on écrit ce qu'on a mesuré et rien de
plus.

### Second post-scriptum — la dette disait « il faut », le porteur a répondu « c'est déjà là »

Le premier post-scriptum concluait que vérifier la production attendait `SITE_URL` en variable
Actions, réglage **[humain]**. Réponse du porteur : la variable existait déjà.

C'est la **deuxième fois de la journée** qu'une de mes notes de dette situe mal un obstacle —
après celle de l'entrée 008 qui plaçait le risque de `sharp` chez Astro alors qu'il était chez
`ipx`. Le motif est identique : la note est écrite au moment où l'on quitte le sujet, donc au
moment où l'on en sait le moins, et elle prend dans le fichier l'apparence d'un constat.

Il faut en tirer la règle explicitement, parce qu'elle a maintenant deux occurrences :
**une ligne de dette est une hypothèse datée, pas un fait.** Celles qui affirment qu'une chose
*manque* sont les plus traîtresses — elles ferment une piste sans que personne ne repasse
vérifier. Le format devrait porter la distinction : « constaté que X » n'est pas « supposé que X ».

Le job `deploy-production` existe donc, sur les pushes vers `main`, l'hôte venant de la variable.
Il affirme que **la production sert l'application**, pas qu'elle sert déjà ce commit : Netlify
bascule atomiquement, le déploiement peut être en vol pendant que la version précédente répond
correctement. C'est « la production est cassée » qu'on veut attraper — la panne de 008, exactement.

Reste une limite que la session ne peut pas lever : `GET /actions/variables` répond **403**, comme
la protection de branche. Le job échoue bruyamment si la variable est vide, mais **rien ne peut
vérifier qu'elle pointe le bon hôte**. Troisième réglage de console dans la même famille que
l'entrée 003, et troisième statut « déclaré par le porteur » plutôt que constaté.

---

## 011 — La CSP n'est pas un en-tête, c'est une contrainte sur toute la chaîne de rendu

**6 août 2026** · jalon 1 · branche `claude/j1-09-u7chaw`

### Contexte

J1-09, la coquille du site : gabarit accessible, en-têtes de sécurité, pages légales et
méthodologie. Sur le papier, la tâche la plus banale du jalon — écrire des pages. Dans les faits,
c'est celle qui a produit le plus de découvertes, parce qu'elle est la première à faire se
rencontrer des règles écrites séparément dans le contrat.

### Friction 1 — le §7 décide de la configuration du build, et rien ne le dit

Le §7 interdit `unsafe-inline`. Une ligne dans un document, lue vingt fois. Ce qu'elle implique
réellement est ailleurs, dans une valeur par défaut d'Astro : `build.inlineStylesheets` vaut
`'auto'`, ce qui **incorpore dans le HTML toute feuille de style de moins de 4 ko** sous forme de
balise `<style>`. La coquille en fait 3,9 ko.

Une CSP `style-src 'self'` sans hachage bloque cette balise. Le site serait parti en production
avec une page sans aucun style, et — c'est le point — **rien dans le pipeline ne l'aurait dit** :
le build réussit, le HTML est valide, la réponse est un 200 avec le bon contenu. Seul un
navigateur refuse d'appliquer la feuille, et aucun de nos juges n'est un navigateur.

La règle générale mérite d'être écrite, parce qu'elle vaut au-delà de ce cas : **une politique de
sécurité qui n'a pas de vérificateur est une politique qui sera relâchée** — le jour où quelqu'un
verra une page cassée, il ajoutera `unsafe-inline` et la page sera réparée. Le vérificateur est
donc devenu une assertion de `scripts/check-deploy.mjs` sur le HTML réellement servi : aucune
balise `<script>` en ligne, aucune balise `<style>` en ligne. Elle reste vraie tant que la
politique l'est ; le jour où une fonctionnalité exigera un script en ligne, la CSP devra gagner un
hachage dans la même PR, et ce check est le rappel.

### Friction 2 — vérifier le rendu réel depuis une session, sans preview

`astro dev` ne prouve rien de ce qui compte ici : le serveur de développement injecte ses propres
scripts en ligne, et la fonction Netlify n'est pas celle qui répond. La preview aurait tranché,
mais elle arrive après le push — c'est-à-dire après le moment où l'on décide quoi écrire.

Le déblocage tient en une ligne : **la fonction SSR construite est un module ordinaire.**

```js
const { default: handler } = await import('.netlify/v1/functions/ssr/ssr.mjs');
const response = await handler(new Request('https://x.netlify.app/'), {});
```

C'est exactement ce que Netlify appelle, avec le même bundle, les mêmes middlewares et les mêmes
en-têtes. Quarante lignes de plus — un serveur HTTP qui sert `dist/` pour les chemins statiques et
délègue le reste à ce `handler` — et `scripts/check-deploy.mjs` a pu être **éprouvé dans les deux
sens avant le moindre push** : vert sur le build normal, rouge sur un build où le SDK Sentry est
embarqué.

Ce serveur n'est pas versionné, et c'est délibéré : il vaut pour la vérification d'une session,
pas comme deuxième implémentation du routage de Netlify à maintenir. Il est décrit ici pour que la
prochaine session le réécrive en deux minutes au lieu de conclure qu'il faut pousser pour voir.

Friction dans la friction, purement cloud : le Chromium préinstallé de l'environnement est le
build 1194, le Playwright du projet en veut 1234. `chromium.launch()` échoue avec « run
`npx playwright install` » — c'est-à-dire télécharger 150 Mo pour un navigateur déjà présent.
`executablePath: '/opt/pw-browsers/chromium'` suffit. À retenir pour J1-12 : le job de CI, lui,
téléchargera son navigateur ; c'est la session qui doit s'adapter, pas le contraire.

### Friction 3 — 48 ko de JavaScript pour surveiller zéro JavaScript

Le §2 du contrat dit « Sentry, dès le jour 1 : front, endpoints SSR et jobs ». La dette de J1-04
disait « à câbler dans J1-09 ». Les deux ont été écrits avant qu'on ait mesuré quoi que ce soit.

Mesure, build avec un DSN factice : **145 ko de JavaScript, 48 ko compressés, sur chaque page.**
En face, le site envoie aujourd'hui *zéro* octet de script au navigateur. Le SDK front ne
surveillerait donc aucun code — un `window.onerror` sur une page qui n'exécute rien — au prix du
poste le plus lourd du budget de performance d'un site qui publie le score de performance des
autres.

Le §12 dit quoi faire d'une contradiction : la signaler plutôt que choisir en silence. Trois
choses ont donc été faites plutôt qu'une.

1. Le SDK navigateur est **conditionné à la présence de `PUBLIC_SENTRY_DSN` au build**. La
   variable est le seul interrupteur, et elle est visible en console : le porteur décide, pas un
   booléen enfoui dans une configuration.
2. `scripts/check-deploy.mjs` mesure le JavaScript servi et **échoue au-delà de 20 ko**. Si la
   variable est définie sans que ce soit voulu, la CI le dit avec la mesure et la cause.
3. Le §2 du contrat porte désormais le chiffre et la condition. Un contrat qui contredit une
   mesure ne se contourne pas dans le code : il se corrige, en laissant la trace de pourquoi.

Le SDK serveur, lui, est branché sans réserve : c'est celui qui répond à la question du brief —
diagnostiquer la production sans terminal. Le scrubbing du §7 (en-tête `Authorization`, cookies,
query strings, y compris dans les breadcrumbs) est une fonction pure testée, pas une option
cochée : une règle d'expurgation que personne n'exerce cesse silencieusement de correspondre le
jour où un en-tête change de nom.

### Friction 4 — la dette disait « dégradé », c'était « rouge »

Une ligne de dette du 5/8 : « `astro-eslint-parser` ne gère pas `projectService` et retombe sur
`project: true`. Le lint typé des `.astro` s'exécute dans un mode dégradé, silencieusement. Sans
conséquence visible sur une page unique. »

Première page contenant un `{items.map(...)}` : `@typescript-eslint/no-unsafe-return`. Les
expressions de template ne résolvent pas au type attendu, elles résolvent au type `error`, et la
famille `no-unsafe-*` signale ce type comme une violation. Aucune réécriture ne satisfait une règle
qui lit un type qu'on n'a pas su calculer.

**Troisième occurrence de la même erreur de journal**, après `sharp` (008) et `SITE_URL` (010) :
une note de dette écrite au moment où l'on quitte le sujet décrit ce qu'on suppose, pas ce qu'on a
constaté, et prend ensuite dans le fichier l'apparence d'un fait. Ici, « sans conséquence visible »
signifiait « je n'ai pas de page à lint ». Les nouvelles lignes de dette de cette PR distinguent
donc explicitement **constaté** de **supposé**, comme l'entrée 010 le proposait.

Le lint typé est coupé sur `**/*.astro`, explicitement et avec la raison en commentaire, plutôt
que dégradé en silence. On ne perd presque rien : `astro check` passe le vrai serveur de langage
sur ces mêmes fichiers, il fait partie de `pnpm verify`, et c'est lui le juge des types depuis le
début. Tout ce qui ne demande pas de types — dont l'ensemble jsx-a11y, la raison d'être du lint sur
ces fichiers — continue de tourner.

### Friction 5 — deux formateurs, deux sémantiques de l'espace

Astro 7 fait passer `compressHTML` de `true` à `'jsx'` par défaut : les retours à la ligne
*adjacents à une balise* sont supprimés, comme en JSX. Prettier, lui, formate les `.astro` avec la
sémantique HTML, où ce même retour à la ligne **est une espace**, et il reflow librement à cent
colonnes.

Les deux se contredisent, et la contradiction ne se voit ni au build, ni au lint, ni dans une
revue de diff : elle se voit dans la page rendue, sous la forme d'un `méthodologiepour` fabriqué
par une passe de formatage que personne n'a relue. `compressHTML: true` — la compression sans
perte — remet les deux d'accord. Vérifié sur le HTML rendu après un passage de Prettier.

### Ce qu'une capture d'écran a trouvé et qu'aucun test n'aurait vu

La feuille de style limitait la largeur de lecture sur *chaque enfant* de `main` plutôt que sur un
conteneur. Résultat : les blocs étroits se centraient, les larges restaient à gauche, et l'encadré
de la page d'accueil flottait au milieu d'un texte aligné à gauche. Zéro violation axe-core, HTML
valide, tests verts — et une page manifestement de travers.

C'est l'illustration exacte du §1 : les artefacts sont le seul moyen de *voir* le produit depuis
une session. Une capture pleine page a suffi, là où aucune assertion n'aurait été écrite parce que
personne n'écrit un test pour un défaut qu'il n'a pas encore imaginé.

### Ce qui a marché du premier coup

- **Le TDD des modules purs.** Les en-têtes de sécurité, les politiques de cache et le registre de
  routes ont été écrits en test d'abord ; aucune reprise. La spécification était connaissable —
  c'est exactement le cas où le §5 l'exige.
- **Le registre de routes.** `tests/unit/route-cache-policy.test.ts` compare `src/pages/` au
  registre dans les deux sens ; il est passé au rouge dès qu'il a existé (cinq pages déclarées,
  aucune écrite), puis au vert au fur et à mesure. Un test qui échoue pour la bonne raison avant
  d'exister vaut mieux qu'un test écrit après.
- **axe-core : zéro violation** sur les six gabarits, en thème clair comme en thème sombre, règles
  `best-practice` comprises. Le lien d'évitement déplace réellement le focus — l'élément actif est
  bien `<main>` après activation —, ce qui est le détail que tout le monde rate.
- **Les mentions légales sans adresse inventée.** L'hébergeur est nommé, son adresse postale ne
  l'est pas : rien dans la session ne permet de la vérifier, et une adresse plausible mais fausse
  dans un document légal est pire qu'une adresse absente. Inscrit en dette **[humain]** plutôt
  qu'en supposition — la leçon de l'entrée 010, appliquée avant de la répéter.

### Post-scriptum — le budget a viré au rouge sur la preview, et c'était le but

La PR #26 est partie avec `verify` vert et le check `deploy` **rouge**, sur une seule ligne :

```
ok    content-security-policy does not allow 'unsafe-inline'
ok    GET / carries no inline <script>, as script-src 'self' requires
ok    GET /methodologie, /droit-de-reponse, /mentions-legales, /accessibilite → 200
ok    GET an unknown path returns 404
FAIL  GET / ships 143.1 kB of JavaScript as served, over the 20.0 kB budget.
```

`PUBLIC_SENTRY_DSN` était bien définie sur Netlify, en contexte `all`. La preview embarquait donc
le SDK navigateur, et le budget écrit quelques heures plus tôt l'a dit avec le chiffre et la cause.

Deux choses méritent d'être notées, parce qu'elles se contredisent en apparence :

- **Le check a fait exactement son travail.** Il a transformé une supposition de session (« il
  faudrait vérifier en console ») en constat daté et chiffré sur le déploiement réel. Aucune autre
  couche du pipeline ne pouvait le voir : le build réussit, les tests passent, la page s'affiche.
- **Il a bloqué le merge.** Et c'est correct : le §11.7 interdit de contourner un check qui gêne,
  la sortie est de traiter la cause. La variable a été retirée côté Netlify, ce qui est réversible
  d'un clic le jour où le site aura du JavaScript client à surveiller.

La question posée par le porteur mérite sa réponse écrite, parce qu'elle se reposera : **non, on
ne peut pas « brancher Sentry » sous 20 ko — mais le budget ne concerne que le navigateur.** Le SDK
serveur est actif, coûte zéro octet côté client, et c'est lui qui répond à l'exigence du brief.
Couper le tracing et le replay, déjà fait, ne descend pas sous les 48 ko gz : c'est le plancher du
paquet. Le loader CDN de Sentry ne sauverait rien non plus — ~30 ko, et servi par un domaine tiers
que `script-src 'self'` refuse. Le jour où un îlot existera, l'arbitrage sera explicite : relever
le budget dans une PR qui l'argumente, ou écrire un mouchard de quelques centaines d'octets.

### Ce que la lecture des variables Netlify a montré au passage

Retirer la variable a demandé de lister l'environnement du projet, et cette liste a appris quelque
chose qu'aucune tâche ne cherchait : **`OPS_TOKEN` n'y est pas marqué « secret ».** Netlify renvoie
donc sa valeur en clair à qui interroge l'API, là où `DATABASE_URL` et `PSI_API_KEY`, eux, sont
masqués. Le §7 dit ce qu'il faut en faire — rotation à la moindre suspicion — et la valeur ayant
transité en clair dans une session, la suspicion est acquise. Inscrit en dette **[humain]**.

C'est la deuxième fois dans ce projet qu'un détour opérationnel trouve mieux que la tâche en
cours : la première fois, c'était la vérification de `sharp` qui avait trouvé `ipx` (entrée 008).
Il y a probablement une règle là-dedans : **une session qui va lire l'état réel d'un service en
rapporte toujours plus que ce qu'elle était venue chercher**, et c'est un argument pour aller le
lire plutôt que de le supposer.

### Les 1,6 ko qui restent, et à qui ils appartiennent

Le check repassé au vert annonce `ships 1.6 kB of JavaScript in 1 file(s)`. Zéro était attendu : le
build local n'émet aucune balise `<script>`. Vérification plutôt que conjecture, sur les trois
URL :

| URL | Scripts servis |
|---|---|
| `deploy-preview-26--observatoireweb.netlify.app` | `/.netlify/scripts/cdp` |
| `observatoireweb.netlify.app` (production) | aucun |
| `main--observatoireweb.netlify.app` | aucun |

Le fichier est le tiroir d'aperçu de Netlify (`ntl-drawer`), injecté par la plateforme sur les
deploy previews uniquement. Trois conséquences, toutes utiles à la prochaine session :

- **La production n'envoie aucun JavaScript.** La déclaration d'accessibilité du site, qui
  l'affirme, reste exacte — elle a été vérifiée, pas supposée.
- Le script est servi en même origine, donc `script-src 'self'` l'autorise : ce n'est pas une
  entorse à la CSP.
- **Le budget JS mesure des previews, et inclut donc ce que Netlify y ajoute.** Un chiffre non nul
  dans un log vert n'est pas un début de dérive : la marge restante est de 18 ko, et le jour où
  elle se réduira, il faudra se souvenir que 1,6 ko ne sont pas les nôtres.

---

## 012 — Le check que j'ai livré a cassé `main`, de deux façons différentes

**6 août 2026** · jalon 1 · branche `fix/deploy-check-race`

Le merge de la PR #26 a fait virer `main` au rouge. Pas le produit : le check que la PR venait
d'étendre. Deux défauts distincts, découverts l'un après l'autre, et le second seulement parce que
j'avais relancé le job pour vérifier le premier.

### Défaut 1 — une assertion couplée au commit dans un job qui prétendait l'inverse

Le job `deploy-production` portait ce commentaire, écrit la veille :

> Il affirme que **la production sert l'application**, pas qu'elle sert déjà ce commit : Netlify
> bascule atomiquement, le déploiement peut être en vol.

C'était faux au moment même où je l'écrivais. Le script assère le `<h1>` attendu — et depuis la
PR #26, les en-têtes que ce build ajoute. Ces assertions sont **couplées au commit**. Tant que la
phrase et le code se contredisaient sans conséquence, personne ne pouvait le voir : jusqu'ici,
aucun merge n'avait changé le titre de la page d'accueil. `cabda6a` est le premier, et le job a
mesuré la version précédente :

```
FAIL  content-security-policy is absent from GET /
FAIL  referrer-policy is absent from GET /
FAIL  permissions-policy is absent from GET /
```

Trois en-têtes « absents » sur une production parfaitement saine, qui les servait tous deux
minutes plus tard. **Le rouge était correct sur les données observées et faux sur la réalité.**

La correction ne consiste pas à retirer l'assertion mais à la faire dire ce qu'elle fait : le
script réessaie maintenant jusqu'à ce que le titre attendu soit celui qui répond, et le
commentaire du workflow décrit ce comportement au lieu de le nier. C'est le même travers que
l'entrée 010 avait nommé — un commentaire n'a pas de chemin d'exécution, donc rien ne l'oblige à
être vrai — sauf qu'ici je l'avais commis en écrivant l'entrée 010.

### Défaut 2 — le script plantait au lieu de conclure

Job relancé une fois la production basculée, et rouge à nouveau, en seize secondes :

```
TypeError: fetch failed
    at async request (scripts/check-deploy.mjs:82:20)
  [cause]: Error: read ECONNRESET
```

Un `fetch` sans `catch`. La page d'accueil, elle, avait sa boucle de réessai depuis le premier
jour ; les autres requêtes, non — et une connexion coupée par le CDN suffisait à tuer le processus
avant qu'il ne rende un verdict sur quoi que ce soit. J'avais d'ailleurs vu le symptôme une heure
plus tôt, en `curl` : `Recv failure: Connection reset by peer`, sur la preview, suivi d'une
requête identique qui passait. Je l'avais mis sur le compte du proxy de la session et je suis
passé à autre chose. **Un symptôme observé et non expliqué est une panne qu'on rencontrera deux
fois.**

Trois tentatives de transport, deux secondes d'écart, et une erreur réseau devient une ligne
`FAIL` nommée au lieu d'une trace de pile.

### Le détail qui compte : quatre `ok` sur un site mort

En éprouvant le chemin rouge — le script pointé sur un port fermé — quatre lignes restaient
vertes :

```
ok    content-security-policy does not allow 'unsafe-inline'
ok    GET / carries no inline <script>
ok    GET / carries no inline <style>
ok    GET / ships 0.0 kB of JavaScript
```

Toutes lisent le corps ou les en-têtes de la page d'accueil. Sur une chaîne vide, l'absence
d'`unsafe-inline` est vraie, l'absence de `<script>` est vraie, zéro kilo-octet est vrai. **Quatre
succès parfaitement exacts et totalement vides de sens.** Sur un déploiement à moitié cassé, ils
auraient rassuré exactement au mauvais moment. Elles sont désormais **sautées**, avec la mention
`-- (home page unavailable)` : le journal dit ce qui n'a pas été vérifié, plutôt que de laisser
croire que ça l'a été.

### Ce que cette séquence apprend sur la CI comme juge unique

Trois occurrences en deux jours du même motif : le check du jour J attrape une vraie panne, et
c'est le check lui-même qui devient la panne du jour J+1. Ce n'est pas un argument contre les
checks — sans celui-ci, la production aurait pu servir des pages sans CSP pendant des semaines.
C'est un argument pour les traiter comme du code de production : **un check a des chemins
d'erreur, et ils doivent être éprouvés comme les autres.** Le chemin vert de celui-ci avait été
vérifié avant le push. Ses chemins d'erreur, non. Ils le sont maintenant, tous les deux : port
fermé, et production réelle.

---

## 013 — Le serveur de développement ne montre pas le site, et je l'ai appris par un test rouge

**6 août 2026** · jalon 1 · branche `claude/tache-j1-12-ia95i5`

J1-09 avait laissé cette phrase dans la feuille de route : « axe-core sans violation sur les 6
pages, clair et sombre — **mesuré en session, pas encore en CI** ». J1-12 consiste à transformer
cette mesure en juge. Le livrable tient en trois fichiers et un job. Tout l'intérêt est dans ce
que la mise au point a fait apparaître, et qui n'a rien à voir avec Playwright.

### La friction : `pnpm dev` sert le HTML sans le CSS

Premier passage de la suite contre le serveur de développement, trois tests rouges. Le plus
parlant :

```
Error: expect(locator).not.toBeInViewport() failed
  - locator resolved to <a href="#contenu" class="skip-link">Aller au contenu principal</a>
  - unexpected value "viewport ratio 1"
```

Le lien d'évitement est censé être hors de l'écran tant qu'il n'a pas le focus. Il était visible,
en haut à gauche, en permanence. J'ai d'abord soupçonné le CSS lui-même — `transform` ne s'applique
pas à une boîte en ligne, et `.skip-link` est un `<a>`. Fausse piste : la règle porte aussi
`position: absolute`, qui rend la boîte en bloc. La mesure a tranché en une commande :

```
skip box   {"x":8,"y":8,"width":167.5,"height":17}
skip style { display: 'inline', transform: 'none', position: 'static', top: 'auto' }
```

`display: inline`, `position: static` : **aucune** des règles de `.skip-link` n'était appliquée.
Et `x: 8, y: 8` est la marge par défaut du navigateur, alors que la feuille de style met
`body { margin: 0 }`. Ce n'est pas une règle qui manque, c'est la feuille entière qui n'existe pas
pour le navigateur.

La cause est dans l'en-tête, pas dans le CSS :

```html
<style data-vite-dev-id="/home/user/observatoire-web/src/styles/global.css">
```

```
content-security-policy: … style-src 'self' …
```

En développement, Astro sert la feuille de style **en ligne** — c'est Vite qui l'injecte, pour le
rechargement à chaud. Le build, lui, ne le fait pas : `build.inlineStylesheets: 'never'` existe
précisément pour ça (entrée 011). Mais le middleware pose la même CSP en développement qu'en
production, et `style-src 'self'` sans `unsafe-inline` la bloque. Le serveur de développement rend
donc le site **entièrement sans style**, silencieusement : rien dans le terminal, rien dans le
statut HTTP, une page qui a l'air d'une page.

C'est la troisième fois que la CSP se manifeste ailleurs que dans un en-tête, après les
stylesheets inlinées et le SDK Sentry de l'entrée 011. La formule de cette entrée tient toujours,
et gagne un cran : **la CSP n'est pas une contrainte sur la chaîne de rendu, c'en est une sur la
chaîne d'observation.** Ce qu'on regarde en développement n'est pas ce qu'on livre.

Conséquence directe et non négociable pour J1-12 : toute assertion qui lit un style calculé —
l'anneau de focus, le lien d'évitement hors écran, et **l'intégralité des contrôles de contraste
d'axe-core** — n'a de sens que contre la deploy preview. Le choix était déjà écrit dans
`playwright.config.ts` au titre du « tester ce qui est déployé » ; il est maintenant *obligatoire*,
et le commentaire dit pourquoi avec la mesure à l'appui.

### Le sélecteur traverse le shadow DOM, et la barre d'outils de développement y vit

Deuxième symptôme du même passage, et une deuxième fausse piste. Deux pages échouaient sur
`h1 → h3` — un saut de niveau de titre. Or `grep` sur les six pages ne montre que des `h1` et des
`h2`. Plus troublant : **les pages fautives changeaient d'une exécution à l'autre**. Une
instabilité, pas une erreur de contenu.

C'est l'instabilité qui donne la réponse : quelque chose arrive après le chargement. Dump des
titres avec leur racine :

```json
{ "tag": "H1", "text": "Audit", "inShadow": true, "host": "ASTRO-DEV-TOOLBAR-AUDIT-WINDOW" }
{ "tag": "H1", "text": "No islands detected.", "inShadow": true, "host": "ASTRO-DEV-TOOLBAR-APP-CANVAS" }
```

Les sélecteurs CSS de Playwright **traversent les shadow roots ouverts** par défaut. La barre
d'outils de développement d'Astro y loge ses propres titres, et le test comptait les titres d'un
outil de développement comme s'ils appartenaient à la page.

Ici encore, l'artefact est propre au développement : la preview ne contient pas cette barre. Mais
le motif est le même que le précédent, et c'est ce qui mérite d'être retenu — **valider une suite
E2E contre `astro dev`, c'est la valider contre un document que le visiteur ne reçoit jamais**,
deux fois plutôt qu'une : sans le CSS, et avec du DOM en plus. Pour la validation en session, j'ai
coupé la barre (`astro preferences disable devToolbar`, qui écrit dans `.astro/`, déjà ignoré par
Git) et contourné la CSP côté navigateur (`bypassCSP`, dans une configuration Playwright de
session, jamais committée). Aucun des deux contournements n'entre dans le dépôt : ce sont des
béquilles d'observation, et le juge reste la preview.

### Éprouver le rouge, puisque l'entrée 012 l'a payé cher

L'entrée précédente s'achève sur « un check a des chemins d'erreur, et ils doivent être éprouvés
comme les autres ». Appliqué ici avant le push, en cassant volontairement le produit :

| Ce qu'on casse | Ce qu'on attend | Ce qu'on observe |
|---|---|---|
| `--text` de la **palette sombre** seule | les 6 tests sombres rouges, les 6 clairs verts | exactement ça : `color-contrast [serious] … 20 nœud(s)` |
| un `<h3>` juste après le `<h1>` | un saut de niveau nommé | `/ skips a heading level` → `"h1 → h3"` |
| un second `<h1>` | le compte des titres de niveau 1 | `toHaveCount(1)` rouge |
| `outline: none` sur `:focus-visible` | l'anneau de focus absent | `the focused skip link draws no outline` |
| `BASE_URL` absente | un refus lisible avant tout navigateur | l'erreur de configuration, en 0,8 s |

La première ligne est la seule qui m'intéressait vraiment. `colorScheme: 'dark'` est une étiquette
dans une configuration ; rien ne prouve qu'elle change ce qui est mesuré. Six rouges d'un côté et
six verts de l'autre, sur une couleur modifiée **uniquement** sous
`@media (prefers-color-scheme: dark)`, le prouvent. Sans cette manipulation, j'aurais livré douze
tests verts dont six auraient pu ne rien regarder.

### Ce qui a marché sans effort, et une friction de conteneur

Le reste n'a pas résisté. `@axe-core/playwright` était installé depuis le bootstrap (J1-04), les
six gabarits passent la totalité des règles axe — y compris les *best practices*, qu'aucun filtre
de tags ne retire —, et la suite complète tourne en **11,4 s** pour 22 tests sur deux workers. Le
budget de §5 est de 6 minutes ; il est désormais appliqué par `scripts/budget.mjs`, ce que la
phrase « enveloppe chaque couche de test » du §5 affirmait déjà sans que ce soit vrai pour l'E2E.

Une friction de conteneur, mineure et notée pour la suivante : la session embarque Chromium en
révision **1194**, alors que `@playwright/test@1.62.1` en épingle **1234**. `playwright install`
est déconseillé dans cet environnement ; la validation en session est donc passée par un
`executablePath` pointant le binaire préinstallé, dans la configuration de session jetable. En CI,
c'est la révision épinglée qui est installée — le navigateur est versionné avec la suite, pas avec
le runner.

Enfin, une divergence assumée avec le §4 de `CLAUDE.md` : la branche s'appelle
`claude/tache-j1-12-ia95i5` et non `feat/e2e-accessibilite`. Le nom est imposé par le harnais qui
ouvre la session, pas choisi. Ça ne coûte rien aujourd'hui ; ça vaut d'être écrit avant qu'on
lise l'historique en se demandant qui a ignoré la convention.

### Premier passage réel en CI : vert, et un flake

Ajouté après le push, parce que le job a livré des chiffres qu'aucune mesure en session ne pouvait
donner. **22 tests, 51,2 s** contre la preview, budget de 360 s ; artefact de 60 fichiers pour
6,9 Mo. La preview a été résolue en dix secondes, et l'ordre des étapes a payé : les installations
de dépendances et de navigateur ont couvert l'attente du build Netlify au lieu de s'y ajouter.

Un test sur vingt-deux a échoué au premier essai et passé au second :

```
palette light › /droit-de-reponse raises no axe-core violation
  Test timeout of 30000ms exceeded.
  Error: page.goto: net::ERR_ABORTED; maybe frame was detached?
    - navigating to "…/droit-de-reponse", waiting until "load"
```

Une navigation avortée, sur une page qui n'a rien de particulier, dans une exécution où les cinq
autres pages de la même palette sont passées. La cause la plus probable est la fonction SSR froide,
sollicitée par deux workers à la fois sur un déploiement qui vient de naître — mais **je ne l'ai
pas mesurée**, et l'entrée 012 dit assez ce que vaut ici un symptôme expliqué à l'estime. Je le
note plutôt que de le corriger : ajouter un préchauffage ou allonger le délai serait livrer un
remède à une cause supposée, et masquerait la seule chose qu'on sait avec certitude, à savoir que
ça arrive.

Ce que le réessai fait ici est exactement son office — la couche traverse un CDN tiers, et exiger
zéro nouvelle tentative sur ce trajet fabriquerait des rouges étrangers au diff, c'est-à-dire la
CI qu'on apprend à ignorer. Ce qu'il ne fait pas, c'est le dire fort : le job reste vert et la
mention `1 flaky` ne vit que dans le journal d'exécution. Si le motif se répète, c'est la
fréquence qui devra devenir visible, pas le seuil qui devra bouger.

---

## 014 — Le conteneur embarque Postgres 16, et une migration peut donc être éprouvée avant d'exister en base

**6 août 2026** · jalon 1 · branche `claude/j1-08-937gb8`

J1-08 est la tâche la plus mécanique du jalon : cinq tables décrites au §6 du brief, une migration
générée par `drizzle-kit`. Rien à débattre, ou presque. Deux choses valent d'être écrites : ce
qu'on a refusé de trancher, et le fait qu'une migration a pu être **exécutée** dans la session,
alors que la validation en branche Neon éphémère est censée n'arriver qu'avec J1-11.

### La friction attendue : aucun moyen d'appliquer la migration

`drizzle-kit generate` ne se connecte à rien : il lit le schéma TypeScript et écrit du SQL. Il
produit donc, sans broncher, du SQL que Postgres refusera. Or J1-11 — le job d'intégration avec sa
branche Neon — est `bloqué` sur J1-10, un réglage de console. Livrer J1-08 revenait à committer un
fichier `.sql` dont personne n'aurait vérifié qu'il s'applique, en pariant sur le générateur.

Le doute portait sur un point précis : `drizzle-kit` écrit les contraintes `CHECK` avec des noms de
colonnes **qualifiés par la table** — `CHECK ("commune"."population" > 0)` — et une contrainte de
table ne référence normalement ses colonnes que par leur nom nu. C'est le genre de détail qui rend
un fichier de migration invalide à la seule ligne qui compte.

### Ce qui a débloqué : `which psql`

Le conteneur de session embarque **PostgreSQL 16.13**, client *et* serveur
(`/usr/lib/postgresql/16/bin/`). Il n'y avait donc rien à contourner :

```
initdb -D … -U postgres --auth=trust        # sous un utilisateur non root : initdb refuse root
pg_ctl -D … -o '-p 55432 -k /home/pgtest' start
psql … -f drizzle/0000_married_whistler.sql # les `--> statement-breakpoint` retirés au sed
```

Les 23 instructions passent. Les `CHECK` qualifiés sont acceptés — Postgres les réécrit. Le doute
est levé par une exécution, pas par une lecture de documentation.

La suite est allée plus loin que « ça s'applique ». Chaque garde-fou du schéma a été **éprouvé par
une insertion qui doit échouer**, dans l'esprit de l'entrée 013 :

| Ce qu'on tente | Ce qu'on attend | Ce qu'on observe |
|---|---|---|
| `code_insee` valant `1004` | refus : cinq caractères | `commune_code_insee_length` |
| population négative | refus | `commune_population_positive` |
| même URL proposée deux fois pour une commune | refus | `site_commune_url_key` |
| `source` inconnue | refus | `site_source_known` |
| run `succeeded` sans `finished_at` | refus | `scan_run_finished_at_matches_statut` |
| deux mesures du même site dans le même run | refus | `measurement_run_site_key` |
| `performance_score` à 101 | refus | `measurement_scores_in_range` |
| `methodology_version` vide | refus | `measurement_methodology_version_present` |
| `impact` hors vocabulaire axe | refus | `finding_impact_known` |
| suppression d'un `site` mesuré | refus | `measurement_site_id_site_id_fk` (restrict) |
| suppression d'un `scan_run` | cascade jusqu'aux `finding` | 0 mesure, 0 finding |

C'est la deuxième ligne du tableau qui justifie l'exercice : une contrainte qu'on n'a jamais vue
refuser quoi que ce soit est une contrainte qu'on **espère**.

**Ce que cela ne remplace pas.** Postgres 16 dans un conteneur n'est pas Neon, et une migration sur
base vide n'est pas une migration sur données réelles — les deux épreuves que le brief vise
explicitement (§1, épreuves 2 et 5). La validation en branche éphémère reste le travail de J1-11 ;
ce qui change, c'est que J1-11 n'aura plus à découvrir en même temps que le SQL est valide et que
son job fonctionne. Et la règle du §2 du brief n'est pas entamée : rien de tout cela n'est sorti du
cloud, c'est le conteneur de session qui portait l'outil.

### Ce qu'on a refusé de trancher : la colonne de score composite

Le §11 du brief laisse ouverte « la formule exacte du score composite ». La tentation, en écrivant
une table `measurement`, est d'ajouter une colonne `score` *nullable* — elle ne coûte rien, elle
servira bien. Elle n'a pas été ajoutée.

La raison n'est pas la pureté : c'est que la colonne aurait figé la partie du problème dont
personne ne discute (« il y a un nombre par mesure ») tout en laissant croire que la partie
discutée restait ouverte. La table stocke donc les **signaux** — quatre scores de catégories
Lighthouse, six métriques, huit signaux complémentaires — et pas leur pondération. La PR qui
tranchera la formule apportera la colonne et sa migration ; c'est un jalon de plus pour l'épreuve 2,
pas un coût.

Deux autres décisions, plus petites, prises explicitement :

- **`CHECK` plutôt que `enum` Postgres** pour les vocabulaires de statut. Le jalon 5 migre un
  schéma vivant, et `ALTER TYPE … ADD VALUE` traîne des restrictions transactionnelles qu'un couple
  `DROP CONSTRAINT` / `ADD CONSTRAINT` n'a pas. On choisit l'option ennuyeuse.
- **`departement`, pas `dept`.** Le brief écrit `dept`, le §4 de `CLAUDE.md` liste `departement`
  parmi le vocabulaire métier admis. Le §12 dit que le brief l'emporte sur l'intention et le
  contrat sur la mise en œuvre : un nom de colonne est de la mise en œuvre.

### Ce que la CI regarde, faute de base

Deux fichiers de tests unitaires, tous deux sans I/O réseau :

- `src/db/schema.test.ts` transforme les règles du contrat en assertions sur le schéma en mémoire :
  les cinq noms de tables verbatim, `methodology_version` `not null` **et sans défaut** des deux
  côtés, les clés d'idempotence, **aucune colonne `json`** (§11.1 — c'est par « juste pour
  déboguer » qu'un rapport brut entre en base), et tous les horodatages en `timestamptz`.
- `tests/unit/migration-schema-sync.test.ts` compare le schéma au dernier instantané de
  `drizzle-kit`. Ce trou-là était réel : `pnpm typecheck` ne lit jamais `drizzle/`, et `db:check` ne
  vérifie que la cohérence interne de l'historique. Une colonne ajoutée sans `pnpm db:generate`
  donnait une CI verte, un déploiement vert, et un `column does not exist` en production — le seul
  endroit où ce projet n'a pas de shell pour réparer.

Les deux chemins rouges ont été éprouvés avant le push, comme l'exige l'entrée 012 : une colonne
ajoutée au schéma sans régénérer → `declares the same columns on measurement` rouge ; une contrainte
retirée → `declares the same constraints on finding` rouge. Le reste de la suite reste vert dans les
deux cas, ce qui dit que le test vise bien ce qu'il prétend viser.

---

## 015 — Deux hypothèses fausses en une heure, et six communes à zéro habitant

**6 août 2026** · jalon 1 · branche `claude/j1-08-937gb8`

J1-07 : parser les deux référentiels et geler des fixtures. Sur le papier, la tâche la plus
prévisible du jalon. Elle a produit deux fausses pistes de ma part, un défaut dans le schéma
mergé le matin même, et un écart de 7 % avec un chiffre du brief.

### Fausse piste 1 — j'ai inventé une sentinelle `"None"` qui n'existe pas

En explorant l'annuaire DILA depuis un `python3 -c`, j'ai imprimé un enregistrement avec
`str(v)[:200]` et lu ceci :

```
"site_internet": "None",
```

J'en ai conclu que l'API encodait l'absence par la **chaîne** `"None"` — un piège classique
d'export Python mal sérialisé — et j'ai écrit le parser autour de cette découverte : une constante
`ABSENT_MARKER`, un helper dédié, un commentaire de dix lignes expliquant que 13 656 enregistrements
la portent et qu'une lecture naïve donne une commune dont le site web s'appelle `None`.

C'était mon propre `str(None)`. L'API envoie `null`, comme tout le monde. Vérifié sur les octets
bruts : **zéro occurrence** de `"None"`, 13 656 `null`.

Ce qui a fait tomber le masque n'est pas une relecture, c'est un test rouge : en recapturant la
fixture depuis le bon endpoint, le schéma a refusé `null` là où il attendait une chaîne. Sans ce
test, je livrais une défense contre un fantôme, un commentaire affirmant une contre-vérité, et la
session suivante l'aurait crue — c'est exactement ce que ce journal existe pour empêcher.

Ce que j'en retiens, et qui vaut au-delà de ce cas : **l'outil d'inspection fait partie de
l'observation**. Un REPL Python et un `curl | jq` ne montrent pas le même document. La règle que
j'applique désormais est d'asserter sur les octets quand la question porte sur l'encodage — c'est
ce que fait `tests/contract/annuaire.test.ts`, qui cherche `"None"` dans le texte brut de la
réponse et non dans l'objet décodé.

### Fausse piste 2 — l'intrus qui n'en était pas un

Deuxième affirmation, écrite avec le même aplomb : la requête `where=pivot like "mairie"` est une
recherche de sous-chaîne dans un blob JSON, donc elle laisse passer un intrus — le Conseil
territorial de Saint-Barthélemy, dont le `pivot` vaut `cg`. J'ai écrit `isMairie()` pour l'exclure,
et un test qui l'attendait `false`.

Le test est sorti rouge. L'enregistrement porte **deux** pivots : `cg`, puis `mairie`. Saint-Barthélemy
n'est pas un intrus, c'est une collectivité qui exerce la fonction de mairie, et l'annuaire le dit
correctement. J'avais regardé `pivots[0]` et conclu sur l'ensemble.

La fonction ne change pas — elle utilise `some()` — mais sa *justification* était fausse, et une
justification fausse est un piège différé : la prochaine session qui optimise « puisque c'est
toujours le premier pivot » supprime une commune du périmètre, une seule, silencieusement.

Deux hypothèses, deux fois la même erreur de méthode : conclure sur l'ensemble depuis un
échantillon de un. Les deux ont été attrapées par des tests écrits contre des captures réelles.
Aucune ne l'aurait été par une relecture.

### La vraie trouvaille : six communes à zéro habitant

En vérifiant les contraintes du schéma Zod sur le référentiel **complet** plutôt que sur les trois
premiers enregistrements, une ligne a sauté :

```
population<=0: 6
```

Beaumont-en-Verdunois, Bezonvaux, Cumières-le-Mort-Homme, Fleury-devant-Douaumont,
Haumont-près-Samogneux, Louvemont-Côte-du-Poivre. Les six villages détruits en 1916 autour de
Verdun, jamais reconstruits, toujours communes de plein droit, et l'INSEE leur compte **0
habitant**.

Or la migration `0000` mergée le matin même porte :

```sql
CONSTRAINT "commune_population_positive" CHECK ("commune"."population" > 0)
```

Cette contrainte est fausse. Pas approximative : fausse sur six lignes réelles du référentiel
qu'elle est censée décrire. Je l'avais écrite depuis une intuition de ce qu'est une commune, et
elle est passée sous les yeux de la CI, du contrôle de contraintes sur Postgres réel, et de la
relecture — parce que **rien de tout cela ne confronte le schéma aux données**. Ce qui l'a trouvée,
c'est d'aller chercher les cas limites dans le jeu complet pour construire une fixture.

Corrigé ici : migration `0001`, `>= 0`, appliquée à la suite de `0000` sur le Postgres jetable de
l'entrée 014, avec vérification que `0` passe et que `-1` est toujours refusé. Sans effet pratique
aujourd'hui — le périmètre v1 s'arrête à 10 000 habitants — mais une contrainte qui affirme quelque
chose de faux sur le domaine finit toujours par se rappeler à vous, et le jour où le périmètre
s'élargira, elle l'aurait fait au milieu d'un batch de nuit.

C'est aussi la première migration *évolutive* du projet : `DROP CONSTRAINT` puis `ADD CONSTRAINT`,
exactement le couple que le choix `CHECK` plutôt qu'`enum` de l'entrée 014 rendait facile.

### Le périmètre réel : 1 067, pas « 950 à 1 000 »

Compté sur le référentiel complet : **1 067** communes de plus de 10 000 habitants, contre « de
l'ordre de 950 à 1 000 » au §3 du brief. Sept pour cent d'écart. Le brief dit lui-même que le
comptage exact se dérive de l'API, donc ce n'est pas une contradiction — mais c'est un chiffre qui
finira sur une page publique, et deux sources pour un même nombre finissent toujours par diverger.
Noté en dette plutôt que corrigé dans le brief : c'est au porteur de décider si le brief porte le
chiffre ou si la page le dérive de l'ingestion.

Au passage, deux de ces 1 067 n'ont **aucune** fiche mairie dans l'annuaire (`49126`, `98747`). La
résolution d'URL de J1-06 devra produire quelque chose pour elles, et ce quelque chose n'est pas
« candidat ».

### Ce que les fixtures ne contiennent pas

Les enregistrements de l'annuaire portent `adresse_courriel`, `telephone`, `affectation_personne` :
des coordonnées de personnes nommées, que le §7 interdit à ce dépôt. Elles sont absentes des
fixtures parce que la capture **ne les a jamais demandées** — la clause `select=` nomme sept champs
et sept seulement. Ne pas demander est plus fort que filtrer après coup : il ne reste aucune étape
où quelqu'un peut oublier.

Un cas a quand même dû être écarté à la main. Parmi les cinq valeurs de `site_internet` sans schéma
d'URL, l'une est une **adresse email personnelle** — la commune a renseigné son mail dans le champ
site web. Le cas est intéressant pour le parser, l'adresse n'a rien à faire dans un dépôt public :
la fixture garde `www.bajus.fr` (même cas, pas de donnée personnelle) et le test couvre l'email avec
une valeur synthétique. C'est la seule entorse à la règle « fixture = observation verbatim », et
elle est écrite dans `tests/fixtures/README.md` plutôt que laissée à deviner.

### Une fixture sans test de contrat pourrit

Le §5 range les « contrats API réels » dans les couches planifiées ; c'est resté une ligne de
tableau jusqu'ici. Elle devient un projet Vitest `contract`, une commande `pnpm test:contract` et
un workflow hebdomadaire. Le raisonnement tient en une phrase : une fixture gelée épingle la forme
contre laquelle le code a été écrit, et **rien dans une fixture ne peut remarquer que l'amont a
changé**.

Deux détails de mise au point valent d'être notés.

La première version du test `geo` tirait le référentiel entier — 35 000 enregistrements, 12 Mo —
pour asserter qu'il avait « une taille plausible ». L'API a répondu **503**. Le volume n'est pas un
contrat ; la forme d'un enregistrement en est un. La version livrée refait exactement les huit
enregistrements de la fixture, un par un, et compare les jeux de clés.

La seconde version contenait une assertion vraie et inutile : « certaines valeurs ne sont pas des
URL parsables ». Vraie sur les 22 147 sites, invérifiable sur un échantillon de 100 — cinq cas au
total. Le test est sorti rouge, et il avait raison : une assertion qui ne tient que par chance est
pire que pas d'assertion. Elle est remplacée par une plus faible et honnête, avec la raison écrite
à côté.

Enfin, le suite distingue explicitement **deux rouges** : l'API n'a pas répondu après quatre
tentatives avec backoff (panne de disponibilité, on relance), ou la charge est arrivée et ne
correspond plus (dérive de contrat, on touche au schéma). Un test de contrat qui confond les deux
apprend à tout le monde à ignorer son verdict — et le §5 dit assez ce que vaut ici une CI qu'on
apprend à ignorer.

Chemins rouges éprouvés avant le push, comme l'exige l'entrée 012 : une clé ajoutée à une fixture
et un champ retiré d'une autre font virer au rouge exactement les deux tests concernés, et eux
seuls.

---

## 016 — Le juge unique n'est pas rouge, il est absent

**6 août 2026** · jalon 1 · branche `claude/j1-08-937gb8`

Écrit pendant que ça se produit, comme l'exige le §12 — la PR de J1-07 est ouverte, vérifiée en
session, et **ne peut pas être mergée**.

### Ce qui s'est passé

La CI de la PR #30 s'est comportée bizarrement : `e2e` et CodeQL sont passés au vert, mais `verify`
et `deploy` sont restés **treize minutes sans obtenir de runner**, dans la *même* run que l'`e2e`
qui, lui, en avait eu un. L'API d'annulation a répondu **502**. Après relance, `verify` a démarré
puis a été tué par son propre `timeout-minutes: 10` — onze minutes pour un job qui en prend deux.

J'ai d'abord cherché la cause dans le diff, puis dans la configuration du workflow. Elle n'était ni
dans l'un ni dans l'autre :

```
overall: Partial System Outage
component: Actions -> major_outage
incident: Incident with Actions | investigating | 2026-08-06T15:22:49Z
  "Workflow runs are still failing or delayed in starting, and some queued
   jobs may time out. Some requests to the Actions API are returning errors."
```

Vingt minutes de diagnostic qu'un coup d'œil à `githubstatus.com` aurait économisées. La leçon
tient en une ligne : **quand plusieurs jobs indépendants échouent de plusieurs manières
différentes, la cause commune n'est pas dans le dépôt.** Un test rouge, un job qui expire et une
API qui renvoie 502 n'ont aucune raison d'arriver ensemble pour une raison qui vous appartient.

### Pourquoi ça compte au-delà de l'incident

Le §5 a longuement pensé au **rouge qu'on apprend à ignorer** — un test instable, une requête
réseau sur le chemin d'une PR — et pas du tout à ceci : le juge n'est pas rouge, il est **absent**.

Les deux se ressemblent de loin. Dans les deux cas rien ne merge. Mais ils n'appellent pas la même
réaction, et rien dans le dépôt ne permet aujourd'hui de les distinguer : il faut aller lire un
onglet Actions à la main, puis une page de statut d'un tiers. C'est exactement le genre de
diagnostic que ce projet est censé rendre possible **depuis le produit**, et il ne l'est pas.

C'est aussi la friction la plus purement *cloud-only* rencontrée jusqu'ici, et elle mérite d'être
nommée sans la dramatiser. Sur un poste local, la panne serait un désagrément : on lance la suite,
on constate qu'elle est verte, on merge. Ici, `pnpm verify` **est** vert — 338 tests, mesurés dans
la session, y compris `pnpm test:contract` contre les vraies API — et cette information n'a aucune
valeur institutionnelle. Le §1 dit que la CI est l'unique juge ; le corollaire, découvert
aujourd'hui, est qu'**un juge unique est aussi un point de panne unique**, et que la règle « si la
CI est verte et que le produit est cassé, c'est la CI qu'il faut corriger » n'a pas de symétrique
pour « la CI ne rend pas de verdict ».

Je ne propose pas de contournement, et c'est délibéré. Un `--no-verify`, un check rendu non requis
« le temps de la panne », un merge administrateur : chacun résout l'heure qui vient et détruit la
propriété qui fait tenir le reste. La règle du §2 du brief est de noter et de poursuivre en cloud,
pas de basculer dès que ça résiste. On attend.

### Ce qu'on en retire, quand même

Une chose concrète à reprendre : `timeout-minutes: 10` sur `verify` a transformé une indisponibilité
en **échec attribué au job**. Le statut rapporté est `cancelled`, indiscernable d'une annulation
volontaire, sur une exécution où rien du diff n'a été mesuré. Un budget de temps sert à attraper une
suite qui dérive ; il ne devrait pas prononcer un verdict sur du code qu'il n'a pas exécuté. Le
distinguer demande de savoir si le job attendait un runner ou s'il travaillait — information que
l'API expose (`started_at` du job contre `started_at` des étapes) et que personne ne lit.

À reprendre quand la panne sera finie, pas pendant : corriger un timeout au milieu d'un incident,
c'est valider une hypothèse sur un système dont on sait qu'il ment.

---

## 017 — L'ingestion tourne pour de vrai en session, et Node refuse d'exécuter le job

**7 août 2026** · jalon 1 · branche `claude/traite-j1-14-85bsg0`

### Contexte

J1-14 : le job d'ingestion du référentiel des communes. Ses trois dépendances étaient livrées —
le garde SSRF (J1-05), les parsers gelés (J1-07), le schéma et sa migration (J1-08) — et il ne
restait, sur le papier, qu'à les câbler : télécharger deux référentiels, croiser, écrire.

Deux choses valent d'être notées : une friction purement cloud-only qui a coûté une décision
d'architecture, et le fait que le job a été **exécuté en entier**, sur les vraies API et sur une
vraie base, avant d'être poussé.

### La friction : rien dans ce dépôt ne sait exécuter un job

Le site est construit par Astro, les tests sont transpilés par Vitest. Un job déclenché par
GitHub Actions n'a ni l'un ni l'autre : c'est du TypeScript que rien ne compile. Node 22.22 sait
pourtant exécuter du TypeScript sans outil — le *type stripping* est actif par défaut depuis
22.18 — et j'ai commencé par supposer que l'affaire était réglée.

Elle ne l'était pas, et la vérification a pris trente secondes :

```
Error [ERR_MODULE_NOT_FOUND]: Cannot find module '…/src/lib/sources/geo.js'
```

Node **ne résout pas** un spécificateur `./x.js` vers un fichier `x.ts`. Or tout le dépôt écrit
ses imports ainsi, parce que `verbatimModuleSyntax` et la discipline ESM le demandent. Le type
stripping fonctionne fichier par fichier ; il ne fonctionne pas sur un graphe de modules qui suit
la convention recommandée par ailleurs. Les deux règles sont raisonnables séparément et
incompatibles ensemble.

Deux sorties : ajouter un exécutant TypeScript (`tsx`, `vite-node`), ou compiler. J'ai compilé —
`tsconfig.jobs.json`, `module: NodeNext`, sortie dans `dist-jobs/`. Ce n'est pas la solution la
plus courte, c'est celle qui ne fait pas dépendre l'exploitation d'un paquet de plus. Et surtout
`build:jobs` entre dans `pnpm verify` : une erreur de résolution dans un job casse désormais la
PR, au lieu d'attendre le jour où quelqu'un déclenche le workflow et découvre que le job ne
démarre pas. C'était le vrai risque — dans un projet sans shell, un job qui ne démarre pas ne se
constate qu'en le déclenchant.

### Ce qui a marché sans résistance, et qui aurait dû être dur

Le §12 du contrat dit de commencer par les documents ; ici c'est le §5 qui a payé. La logique
pure — périmètre, appariement mairie/commune, plan d'écriture — a été écrite en test-first, et les
tests ont tenu sans être retouchés parce qu'ils n'ont pas été imaginés : les cas viennent des
mesures faites par J1-07 sur les jeux complets (13 fiches dont le code INSEE de tête contredit
celui du pivot, une fiche qui déclare deux rôles, 13 656 sans site). Écrire ces tests revenait à
recopier des faits.

Le résultat est tombé juste du premier coup, et il est identique à celui qu'une exploration
indépendante avait donné avant l'écriture du code : **34 969 communes lues, 1 067 dans le
périmètre, 1 224 URL candidates, 138 communes en portant plusieurs, 15 sans aucune**.

### Le job a été exécuté, pas seulement compilé

Le journal 014 avait établi qu'un Postgres 16 jetable tourne dans le conteneur de session. Il a
servi ici pour ce qu'il vaut : le job complet a été lancé **contre les vraies API et une vraie
base**, deux fois de suite.

```
{"communesPlanned":1067,"communesInserted":1067,"communesUpdated":0,
 "sitesPlanned":1224,"sitesInserted":1224,"sitesAlreadyKnown":0}
{"communesPlanned":1067,"communesInserted":0,"communesUpdated":1067,
 "sitesPlanned":1224,"sitesInserted":0,"sitesAlreadyKnown":1224}
```

Le second passage est la seule preuve qui compte pour le §8 : **rejouer ne duplique rien**. Ce
n'est pas une propriété qu'un test unitaire peut établir, parce que ce n'est pas une propriété
d'une fonction — c'est une propriété d'un index unique et d'un `ON CONFLICT DO NOTHING`. Et
`DO NOTHING` plutôt que `DO UPDATE` sur `site` n'est pas une micro-optimisation : l'annuaire
proposera la même URL toutes les semaines, et un upsert qui touche `statut_resolution`
ramènerait à `candidat` tout ce que J1-06 aura vérifié — silencieusement, et seulement pour les
sites que quelqu'un avait pris la peine de juger.

### La friction que je me suis infligée : l'API m'a coupé le robinet

Entre deux essais, `geo.api.gouv.fr` s'est mis à répondre `503` sur les quatre tentatives. Trois
tirages du référentiel complet en cinq minutes suffisent. Aucune conséquence en production — une
exécution, un tirage — mais deux enseignements.

Le premier est une règle de mise au point : **on met au point sur une capture, pas sur l'API**.
C'est exactement ce que disent le §5 et les fixtures gelées ; je l'ai redécouvert en le violant.

Le second est plus intéressant, parce que le job a réagi comme on voulait sans que personne ne
l'ait éprouvé pour de bon :

```
{"level":"error","message":"ingestion failed",
 "error":"ReferentialUnavailableError: geo.api.gouv.fr did not answer after 4 attempts (HTTP 503)…
          This is an availability failure, not a contract failure…"}
```

La distinction disponibilité / dérive de contrat avait été écrite par J1-07 pour les tests de
contrat. Elle vient de servir ailleurs, en vrai, et sur le bon message : rien dans ce que
l'ingestion a vu ne justifiait de toucher un schéma. C'est le genre de vérification qu'on ne peut
pas planifier — elle est arrivée parce que j'ai été impatient.

### Ce qu'on n'a pas fait, et pourquoi

- **Aucun `schedule:` sur le workflow.** La fréquence de rafraîchissement est une décision
  ouverte du §11 du brief. Un cron « en attendant » l'aurait tranchée sans le dire.
- **Aucune URL n'est jugée.** 154 candidates sont en `http`, certaines pointent une page de
  démarches plutôt qu'un accueil, cinq n'ont pas de schéma du tout (hors périmètre). Tout est
  enregistré verbatim en `candidat`. Normaliser ici aurait fabriqué une URL que l'annuaire n'a
  jamais donnée, et surtout aurait supprimé la ligne que J1-06 doit pouvoir rejeter en laissant
  une trace.
- **Rien n'est jamais supprimé.** Une commune qui passe sous le seuil, une URL que l'annuaire
  retire : la ligne reste. Retirer une candidate est une décision, et une décision doit avoir un
  auteur.

### Ce que ça dit de l'expérimentation

Trois jalons plus tôt, la question « comment lancer un job sans shell ? » aurait été un vrai
obstacle. Elle s'est réduite à un fichier de workflow et un `tsconfig` parce que les règles
posées au jour 1 — pas de `console.log`, pas de `process.env` en direct, tout ce qui est pur dans
`src/lib/` — ont désigné d'elles-mêmes où chaque morceau devait aller. Le logger applicatif que le
§4 exigeait depuis le premier jour n'existait pas ; il a été écrit ici, en quarante lignes, parce
que c'est le premier composant du projet dont **quelqu'un lit vraiment la sortie**.

La friction restante est ailleurs, et elle est connue : ces neuf tests d'intégration ne tournent
dans aucune CI. Ils ont été exécutés dans la session, ce qui n'a, comme l'a établi l'entrée 016,
aucune valeur institutionnelle. J1-11 attend toujours un réglage de console.

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

---

## 018 — Le premier module qu'aucune mesure ne peut calibrer

**9 août 2026** · jalon 1 · branche `claude/j1-06-osmspn`

### Contexte

J1-06 : la machine à états de résolution d'URL. Le brief la réclame depuis le jour 1 et la
justifie par un chiffre — 138 communes du périmètre portent plusieurs URL candidates, une
d'accueil et une de démarches le plus souvent. J1-14 avait rempli la file ; il s'agissait de la
juger. Périmètre : `src/lib/`, logique pure, test-first strict (§5).

Le livrable est fait de quatre étages — ce qu'on peut requêter et dans quel ordre, ce que vaut
une observation, quelles transitions sont légales et par qui, que faire des autres candidats
d'une même commune — et de 73 tests écrits avant eux.

### La friction : cette fois, les tests ne recopiaient pas des faits

L'entrée 017 notait que la logique pure de J1-14 était tombée juste du premier coup parce que
ses tests n'avaient pas été imaginés : chaque cas venait d'une mesure faite sur les jeux complets.
**Ici, cette ressource manque.** Les règles à écrire sont de la forme « que signifie un 403 ? »,
« que faire quand deux URL d'une même commune répondent toutes les deux ? » — et il n'existe
aucun moyen de les calibrer :

- le §5 interdit toute requête réseau sur le chemin d'une PR, donc rien dans la CI ne peut
  observer un site de commune ;
- le module n'a **aucun consommateur** : le job qui exécutera ces règles est du jalon 2. Il n'y a
  donc même pas d'exécution en session à regarder, contrairement à J1-14.

C'est le premier module du dépôt dont la spécification est une **décision** et non une mesure.
Et c'est exactement la situation où l'on écrit un seuil qui a l'air d'une règle, que la session
suivante lira comme un fait établi. Le dépôt en a déjà un exemple : la contrainte
`commune_population_positive`, écrite depuis une intuition de ce qu'est une commune, et démentie
par six communes détruites en 1916.

La règle que je me suis donnée est donc : **ancrer tout ce qui est mesuré, et refuser d'écrire
ce qui ne l'est pas.** Concrètement, presque chaque test porte une URL réelle de la capture gelée
et un compte mesuré par J1-07 ou J1-14 — `www.bajus.fr` sans schéma, les trois adresses de
Saint-Malo, la page de rendez-vous de Conlie, les 154 candidates en `http`. Et là où rien n'est
mesuré, le code **signale sans juger** : quand une chaîne de redirections finit sur un autre
hôte, `movedHost` est levé et l'état reste `verifie`. Décider qu'un tel déplacement est suspect
demanderait de savoir à quelle fréquence il arrive ; ce chiffre n'existera qu'après le premier
scan réel. Un drapeau qu'un humain lira coûte un drapeau ; un seuil inventé coûte une donnée
publiée à tort.

### Ce que la contrainte cloud a rendu visible : qui a le droit de décider

La partie du module dont je suis le plus sûr est aussi celle qu'aucune mesure ne dictait — et
elle vient en droite ligne de l'organisation du projet, pas du domaine. Les transitions déclarent
non seulement ce qui est légal, mais **par qui** : un scan peut vérifier, invalider, mettre à
revoir ; il ne peut ni ressusciter une URL invalidée, ni sortir une URL de `à revoir`. Seul un
opérateur le peut.

Sans ces deux règles, la ré-ingestion hebdomadaire de l'annuaire — qui reproposera exactement les
mêmes 1 224 candidates — effacerait chaque semaine tout jugement humain, silencieusement. C'est
la deuxième fois que ce risque précis est attrapé à un endroit différent : l'entrée 017 raconte
le choix d'un `ON CONFLICT DO NOTHING` plutôt qu'un `DO UPDATE` sur `site`, pour que l'écriture
ne ramène pas à `candidat` ce qui aura été vérifié. Le même danger, vu deux fois, à deux couches.
Dans un projet sans shell, il n'y a aucune session de rattrapage où l'on s'apercevrait que la
base a été « remise à plat » : ce qui écrase une décision l'écrase définitivement.

### Deux frictions mineures, notées parce qu'elles coûtent cinq minutes chacune

**Le conteneur démarre sans `node_modules`.** Le premier `vitest` d'une session échoue en
`ERR_MODULE_NOT_FOUND: Cannot find package 'vitest'` — depuis `vitest.config.ts` lui-même, ce
qui ressemble beaucoup à une configuration cassée alors qu'il ne manque qu'un
`pnpm install --frozen-lockfile`. Sans conséquence, mais c'est un faux départ que chaque session
paiera tant qu'il n'est pas écrit quelque part.

**`erasableSyntaxOnly` refuse les propriétés de paramètres.** Écrire
`constructor(readonly from: Statut, …)` est du TypeScript parfaitement ordinaire, et le réglage
l'interdit parce que Node doit pouvoir effacer les types sans les compiler. Le point notable
n'est pas la correction — trois lignes — mais **qui a parlé** : la suite de tests était verte,
c'est `astro check`, deuxième étape de `pnpm verify`, qui a refusé. L'ordre des étapes de
`verify` est donc ce qui sépare « vert » de « vert pour de mauvaises raisons ». Une session qui
se contenterait de `pnpm test` avant de pousser aurait envoyé du code que la CI aurait rejeté.

### Ce qui a marché

Le cycle rouge-vert a tenu, y compris son premier échec, qui était de ma faute et instructif : le
test exigeait que le message d'erreur nomme les deux états et l'acteur *dans cet ordre*, par une
expression régulière. L'implémentation les nommait dans un autre. La spécification que je voulais
écrire était « le message nomme les trois choses » — c'est donc le test qui a été corrigé, pas le
message. Un test qui contraint plus que la spécification est un test qui interdira demain une
réécriture parfaitement légitime.

Reste que ce module est, pour l'instant, une bibliothèque que personne n'appelle. Sa vraie
épreuve n'est pas la CI verte d'aujourd'hui : c'est le premier scan réel, où l'on saura combien
de communes tombent dans `à revoir` — et si cette file est utilisable par un humain ou si elle
compte 300 lignes.

---

## 019 — La première page qui lit la base, et le seul juge qui ait vu le défaut

**9 août 2026** · jalon 1 · branche `claude/traite-j1-15-0xxidx`

### Contexte

J1-15 : la page `/stats`, dernière tâche `à faire` du jalon 1. Le brief la décrit en trois mots
— « page `/stats` minimale sur données réelles » — et c'est la première fois que du HTML de ce
site est rendu depuis la base plutôt que depuis le code. Elle publie ce qui existe : 1 067
communes ingérées, 1 224 adresses candidates, 15 communes sans adresse, **zéro mesure**.

Une décision attendait cette tâche depuis le bootstrap : quel client Postgres côté SSR. Elle est
tranchée pour `pg`, partout, et le SDK `@neondatabase/serverless` est retiré du dépôt.
`@astrojs/netlify` déploie le point d'entrée en *fonction* Netlify — un processus Node sur
Lambda, pas un runtime edge — donc il tient une socket, et l'endpoint *pooled* de Neon existe
exactement pour cette forme. Le SDK n'apportait rien et coûtait un deuxième client à maintenir.

### Le défaut que seul un vrai Postgres pouvait montrer

La lecture est en SQL brut — six sous-requêtes scalaires en un aller-retour, plutôt que six
requêtes sur le chemin d'un visiteur. J'ai fait passer la ligne obtenue par un schéma Zod, en
notant en commentaire que ce n'était pas le cas d'usage prévu par le §4 (une base qui est la
nôtre n'est pas une API tierce), mais que `db.execute` rend un `Record<string, unknown>` et que
l'alternative au parsing était un `as` qui continuerait de compiler après un renommage de
colonne.

Le premier affichage de la page, sur la base réelle, a répondu ceci :

```
{"error":"ZodError: [{ \"expected\": \"date\", \"path\": [\"referential_updated_at\"],
  \"message\": \"Invalid input: expected date, received string\" }]",
 "level":"error","message":"stats read failed"}
```

`max(updated_at)` revient en **chaîne**, pas en `Date`. La raison est que Drizzle installe ses
propres analyseurs de types sur le pool pour convertir les colonnes lui-même — et du SQL brut n'a
aucune colonne à convertir. Ce qui compte n'est pas la correction, qui tient en cinq lignes, mais
**qui a parlé** :

- `pnpm verify` était vert. TypeScript croyait la valeur `Date` : c'est ce que le schéma
  déclarait, et il n'existe aucun moyen pour le compilateur de savoir ce que `pg` a rendu.
- Un test unitaire ne pouvait pas l'attraper : il aurait fourni une `Date`, comme moi.
- Un `as` aurait publié `Invalid Date` sur une page publique, sans qu'aucun test, aucun statut
  HTTP et aucun log ne s'en émeuve.

C'est le troisième défaut de ce dépôt trouvé en exécutant pour de vrai plutôt qu'en relisant
(après les six communes à zéro habitant, et le check de production qui mesurait la version
précédente). La conclusion se répète : **la frontière entre notre code et un système extérieur
est le seul endroit où « ça compile » ne veut rien dire**, et la parade n'est pas plus de types,
c'est une assertion qui s'exécute. Le test d'intégration ajouté vérifie désormais le *type* de
cette valeur, pas seulement sa présence.

### La friction cloud-only : Node ne sort pas du conteneur

Je voulais rejouer l'ingestion réelle pour voir la page sur ses vraies données. Le job a échoué
quatre fois de suite en `503`, avec l'erreur d'indisponibilité que J1-14 avait justement pris
soin de distinguer d'une dérive de contrat. J'ai d'abord cru retrouver la limite de débit de
`geo.api.gouv.fr` mesurée le 7 août — l'explication était disponible, plausible, et fausse.

`curl` sur la même URL : `200`, 4,2 Mo. `fetch` de Node sur la même URL, dans le même conteneur,
à la même seconde : `503 upstream connect error`. Node n'honore pas `HTTPS_PROXY`, et tout le
trafic sortant de cette session passe par un proxy. **Aucun job de ce dépôt ne peut télécharger
quoi que ce soit depuis une session** — ce qui n'a aucune conséquence en production, où les
runners Actions sortent directement, mais qui change la manière de mettre au point.

Le contournement est resté hors du dépôt : un script dans le répertoire de travail temporaire
lit les deux captures faites au `curl` et appelle les parsers, le planificateur et l'écriture du
dépôt, inchangés. Tout ce qui est à nous a donc bien tourné sur les 34 969 communes et les 35 803
fiches réelles ; seul le transport a été remplacé. Résultat écrit en base : 1 067 communes, 1 224
adresses, exactement les chiffres du 7 août.

Le piège dans cette histoire n'est pas le proxy, c'est le message d'erreur juste. `503` +
« indisponibilité » désignait un coupable connu et documenté dans ce même journal. Un diagnostic
qui confirme une note existante mérite d'être vérifié une fois de plus qu'un diagnostic qui la
contredit.

### Ce qu'une page de données oblige à décider, et que j'ai failli trancher en silence

Une page qui lit une base peut échouer, et il fallait choisir ce qu'elle répond alors. Répondre
503 est plus honnête pour un moniteur ; c'est aussi ce qui aurait fait virer au rouge
`scripts/check-deploy.mjs`, qui suit les liens de l'accueil et exige un 200 sur chacun — un check
rouge pour une variable d'environnement absente, c'est-à-dire pour une raison étrangère au diff.
Le §5 est catégorique là-dessus : dans un projet où la CI est le seul juge, une CI qu'on apprend
à ignorer est la panne la plus grave possible.

La page répond donc 200 et **dit ce qu'elle ne peut pas lire**, avec trois conséquences écrites
plutôt que supposées : la lecture ratée est journalisée côté serveur, le test E2E du tableau se
*saute* visiblement au lieu de passer à vide, et surtout la réponse dégradée **renonce à son
cache**. Ce dernier point a demandé le seul mécanisme nouveau de cette PR : `Astro.locals` porte
un `cacheDowngrade` dont le type ne peut valoir que `'uncached'`. Une page peut abandonner le
cache que le registre lui accorde, jamais s'en accorder davantage — sans quoi le registre du §10
cesserait d'être la source unique. Vérifié sur le serveur réel, dans les deux sens : base debout,
`s-maxage=300` et les trois tags ; base arrêtée, `no-store`.

Reste une dette que je préfère écrire que masquer : **rien en CI ne distingue aujourd'hui une
preview sans base d'un chemin de lecture cassé**. La sonde qui saurait le dire doit connaître
l'environnement qu'elle interroge — c'est la surface d'ops du jalon 2, pas un `if` de plus dans
une page.

### Ce qui a marché

Le test-first sur `src/lib/stats/`, sans surprise cette fois : la spécification y était
connaissable d'avance, et les cas venaient des mesures de J1-14 plutôt que d'exemples inventés.
Deux d'entre eux ont eu un intérêt immédiat — la division par zéro d'une base vide, qui est
l'état *normal* de cette page le jour où elle est déployée, et l'obligation d'afficher les états
de résolution à zéro. « 0 adresse à revoir » est un fait ; une ligne absente ressemble à un
oubli, et la file que personne n'affiche est celle que personne ne vide.

### Addendum — la CI a trouvé ce qu'aucune session ne pouvait mesurer

L'E2E de cette PR est parti rouge sur la deploy preview, et sur la seule assertion que j'avais
pourtant *vérifiée à la main* une heure plus tôt :

```
expect(headers['netlify-cdn-cache-control']).toBe('no-store')
Expected: "no-store"   Received: undefined
```

**Netlify consomme `Netlify-CDN-Cache-Control` et `Netlify-Cache-Tag`.** Ce sont des
instructions au CDN : il les lit, les applique, et ne les transmet pas. Aucun client ne les voit
donc jamais. Le serveur de développement, lui, n'est pas la plateforme : il relaie les en-têtes
tels quels, et c'est exactement ce que j'avais observé en session — deux `curl`, base debout puis
base arrêtée, `s-maxage=300` puis `no-store`. La mesure était juste ; ce qu'elle mesurait n'était
pas ce que je croyais.

Le comportement, lui, était correct depuis le début. Ce que la plateforme expose est meilleur que
ce que j'assérais :

```
/methodologie  cache-status: "Netlify Edge"; fwd=miss; fwd-status=200; stored
/stats         cache-status: "Netlify Edge"; fwd=miss; fwd-status=200
```

`Cache-Status` (RFC 9211) dit ce que le bord **a fait**, pas ce qu'on lui a demandé. La page
éditoriale est stockée, la page de données dégradée ne l'est pas. Le test assère désormais cela,
et la déclaration — la politique et ses tags de purge — reste assérée là où elle est visible, en
test unitaire. La répartition est plus propre qu'avant l'échec : l'unitaire vérifie ce qu'on
émet, l'E2E vérifie ce que le bord en fait.

C'est la deuxième fois dans cette PR qu'une exécution réelle dément une vérification qui avait
l'air complète, et la deuxième fois que le juge n'est pas celui que j'attendais. La première
était la base (`max(updated_at)` en chaîne), attrapée par un parse. Celle-ci ne pouvait être
attrapée que par la plateforme elle-même — c'est-à-dire par la CI, sur une PR. Le §1 dit que la
CI est l'unique juge de qualité ; ce jour-là, elle a jugé quelque chose qu'aucune session ne
pouvait voir, et le mot « unique » a cessé d'être une formule.

---

## 020 — Le quatrième réglage que personne ici ne peut voir

**9 août 2026** · jalon 1 · branche `claude/traite-j1-15-0xxidx`

### Contexte

J1-10 : l'environment GitHub `production`. Une tâche de console, trois clics, et la dernière
avant de débloquer J1-11. Elle attendait depuis le 4 août avec la mention « à faire avant
J1-11 », c'est-à-dire sans que rien ne dise *pourquoi* elle était urgente. C'est J1-15 qui l'a
dit, et pas de la manière prévue.

### Ce que la question du porteur a révélé

Le porteur a demandé quoi faire exactement. J'ai commencé par recopier la liste du §9 — six
secrets à déplacer — puis j'ai vérifié ce que le dépôt lit réellement :

```
NETLIFY_AUTH_TOKEN → src/lib/env/index.ts uniquement
OPS_TOKEN          → src/lib/env/index.ts uniquement
PSI_API_KEY        → src/lib/env/index.ts uniquement
NEON_API_KEY       → src/lib/env/index.ts uniquement
```

**Quatre des six secrets provisionnés n'ont aucun consommateur.** Ils n'existent que comme
lignes d'un schéma Zod, déclarés au bootstrap pour des fonctionnalités qui arriveront aux jalons
2 et 4. Deux d'entre eux valent mieux que d'être déplacés : `OPS_TOKEN`, dont la dette du 6 août
dit qu'il a transité en clair et doit être tourné, et `NETLIFY_AUTH_TOKEN`, qui n'existe pas
encore et dont un PAT Netlify donnerait accès à **tout le compte** — un jeton non restreignable
pour une purge qui, déclenchée depuis une fonction Netlify, n'en demande aucun.

La réponse juste n'était donc pas « déplace-les » mais « supprime-les, et crée-les quand quelque
chose les appellera ». C'est le même raisonnement qui a fait retirer le SDK Neon la veille, et il
se trouve qu'il s'applique aux secrets bien plus fort qu'aux dépendances : une dépendance
inutilisée coûte une montée de version, un secret inutilisé coûte une fuite possible pour rien.

Ce que je retiens de la séquence : la liste du §9 avait l'air d'un inventaire de ce qui existe,
et c'était un inventaire de ce qui était *prévu*. Personne ne l'aurait vu sans la question, parce
qu'aucun outil ne signale un secret que rien ne lit — GitHub ne sait pas ce que le code appelle,
et le code ne sait pas ce que GitHub détient. La colonne « Portée » du §9 dit désormais où vit
chaque valeur **et** laquelle n'est pas provisionnée.

### La friction, la même que d'habitude, pour la quatrième fois

Rien de tout cela n'est vérifiable d'ici :

```
GET /repos/…/environments      → 403
GET /repos/…/actions/secrets   → 403
GET /repos/…/actions/variables → 403
```

Le statut de J1-10 est donc **déclaratif**, comme J1-13, comme le check `deploy` requis, comme la
valeur de `SITE_URL`. C'est la quatrième entrée de la même famille, et il faut cesser de la
traiter comme un accident : dans ce projet, **une session ne peut pas constater la configuration
de son propre dépôt**. Ce que je peux faire, en revanche, est écrire le code qui *échoue
bruyamment* si le réglage n'est pas celui qu'on croit — et c'est exactement ce que le
`environment: production` posé sur `ingest.yml` produit : si l'environment n'existe pas ou si les
secrets n'y sont pas, le prochain dispatch d'ingestion échoue sur une chaîne de connexion vide,
avec le nom de la variable manquante. Le réglage reste invérifiable ; sa conséquence, elle, est
observable.

### Ce qui reste ouvert

`/stats` en production dit toujours « la base n'a pas répondu ». La cause la plus probable est
qu'aucune migration n'a jamais été appliquée à Neon — les cinq tables n'existent que dans des
Postgres jetables détruits avec leur session. Je ne peux pas le confirmer : la page dit que
l'incident est journalisé côté serveur, et **le journal des fonctions Netlify n'est pas lisible
depuis une session**. Une page qui renvoie vers une trace que ses propres auteurs ne peuvent pas
ouvrir ne tient sa promesse qu'à moitié ; c'est noté en dette, et c'est J1-11 qui répondra — soit
en donnant enfin un schéma à Neon, soit en prouvant qu'on cherchait au mauvais endroit.

---

## 021 — Le trou n'était pas dans le code, il était dans la feuille de route

**11 août 2026** · jalon 1 · branche `claude/traite-j1-15-0xxidx`

### Contexte

Le porteur dispatche l'ingestion pour la première fois, maintenant que J1-10 a posé l'environment
`production`. Elle échoue :

```
{"error":"Error: Failed query: select count(*) from \"commune\"","level":"error",
 "message":"ingestion failed"}
```

Deux choses en sortent, et aucune n'est celle que je cherchais.

### La friction : un message d'erreur qui a l'air complet et ne dit rien

`Failed query: select count(*) from "commune"` dit que quelque chose a échoué et rien sur quoi.
J'ai monté un Postgres vide en session et rejoué la requête :

```
--- ce que le job journalise ---
Error: Failed query: select count(*) from "commune"
--- ce qu'il jette ---
cause[0]: error | relation "commune" does not exist | code= 42P01
```

Drizzle emballe l'erreur du driver, et les deux gestionnaires du dépôt — celui de
`ingest-communes.ts` et celui de `src/db/runtime.ts` — journalisent `${error.name}:
${error.message}`. La cause est à **une propriété** de là et se perd systématiquement. Dans un
projet où le log est la seule fenêtre sur un job, ce n'est pas un défaut cosmétique : c'est
l'écart entre « la base n'a pas de schéma » et « on ne sait pas ».

Le détail qui pique : ce gestionnaire avait été écrit avec soin, et son commentaire dit « the
message, never the payload », par souci de ne pas fuiter un secret dans un log public. La règle
était bonne, l'implémentation en gardait trop peu. Une prudence mal calibrée coûte exactement ce
que coûte une imprudence, en moins visible.

### Le vrai sujet : personne n'avait écrit comment la production reçoit son schéma

`relation "commune" does not exist` sur une base qui répond, c'est une base sans schéma. En
remontant, la chaîne se lit toute seule :

- J1-08 a livré le schéma et sa migration, « appliquée et éprouvée » — sur un Postgres jetable
  de session, détruit avec elle ;
- J1-11 prévoit d'appliquer les migrations en *dry-run* sur une branche Neon éphémère, pour les
  PR ;
- J1-14 charge les données, en supposant les tables présentes ;
- J1-15 lit les données, en supposant les tables présentes.

**Aucune ligne, nulle part, ne dit comment la base de production obtient ses tables.** Ce n'est
pas un oubli d'implémentation : c'est un trou dans la feuille de route, resté invisible parce que
chaque tâche voisine avait l'air de le couvrir. Quatre tickets se sont succédé en le contournant,
et il a fallu qu'une opération réelle tape dedans pour qu'il apparaisse.

Je retiens la forme du piège, parce qu'elle se reproduira : **un trou entouré de tâches
plausibles ne se voit pas dans un plan, il se voit dans une exécution.** Le dépôt a déjà appris
que la CI trouve ce qu'une session ne peut pas mesurer ; ici c'est une opération de production
qui a trouvé ce qu'aucune relecture de plan n'aurait montré.

### Ce que le workflow fait, et pourquoi il en fait plus que `drizzle-kit migrate`

Le plus court aurait été un workflow lançant `pnpm db:migrate`. Il fait trois choses de plus,
chacune payée par une raison :

**Il rend compte avant d'agir, et c'est le défaut.** `apply` vaut `false` par défaut — l'inverse
de `dry_run` sur l'ingestion. Une migration est la seule opération de ce dépôt qu'on ne peut pas
défaire : drizzle-kit ne génère pas de migration descendante, la dette le note depuis le 6 août.
Le défaut doit donc être celui qui ne détruit rien.

**Il nomme ce qu'il va appliquer.** La table de Drizzle stocke `id`, `hash` et `created_at`, et
**pas le tag** — mesuré sur une vraie base, pas lu dans une documentation. Le seul lien entre une
ligne en base et un fichier du dépôt est cet horodatage, qui est exactement le `when` du journal.
Sans un module qui fait cette jointure, un log de migration ne peut pas dire *quelle* migration a
tourné. C'est ce que `src/lib/migrate/plan.ts` calcule, en logique pure et test-first.

**Il refuse d'appliquer sur une base qui a dérivé.** Deux cas bloquants : la base a appliqué une
migration absente du dépôt (elle vient d'une autre branche, ou l'historique a été réécrit), ou
une migration en attente est plus ancienne qu'une déjà appliquée — ce que produisent deux
branches parallèles fusionnées dans le mauvais ordre. Le second cas n'est pas théorique dans ce
dépôt : le §12 organise le travail en branches parallèles, et J1-11 va créer des bases jetables
par PR. Drizzle appliquerait sans un mot, produisant un schéma qu'aucune séquence de ces fichiers
ne reproduit.

### Ce qui a été éprouvé avant le push

Base vide → 2 migrations planifiées, rien écrit en mode par défaut ; `--apply` → les 5 tables ;
rejeu → « nothing to apply » ; dérive simulée en insérant une ligne étrangère dans la table de
Drizzle → refus, code de sortie 1 ; variable absente → `MissingEnvError` nommée ; base injoignable
→ `Failed query … ← Error: connect ECONNREFUSED`, c'est-à-dire précisément l'information qui
manquait ce matin.

Reste que le workflow n'a pas encore tourné sur la vraie base. Le dépôt en est à sa troisième
leçon du même ordre — la CI a trouvé ce que la session ne pouvait pas voir, la production a
trouvé ce que la CI ne pouvait pas voir — et je n'écrirai donc pas ici que la production est
réparée. Elle le sera quand le job l'aura dit.

---

## 022 — Éprouver un job dont on ne peut pas avoir la clé

**12 août 2026** · jalon 1 · branche `claude/j1-11-w4yw73`

### Contexte

J1-11 est la dernière brique du jalon : le job de CI qui fait tourner la couche d'intégration
contre une branche Neon éphémère. Elle attendait depuis le 4 août — d'abord `bloqué` sur un
réglage de console (J1-10, fait le 9/8), puis simplement en file.

Sa valeur avait été réécrite deux fois pendant cette attente, et une de ces réécritures était
fausse. C'est le sujet de la dernière section.

### La friction centrale : le secret qu'aucune session ne peut lire

`NEON_API_KEY` vit dans les secrets du dépôt. Une session cloud ne peut ni le lire, ni s'en
servir : `GET /actions/secrets` ne rend que des noms, et c'est très bien ainsi. Conséquence
directe et inhabituelle pour ce dépôt : **le composant central de la tâche ne peut pas être
exécuté une seule fois avant d'être poussé.**

L'entrée 016 a déjà établi qu'une exécution en session n'a « aucune valeur institutionnelle ».
Ici c'est pire : il n'y a même pas d'exécution à ne pas valoriser.

La réponse tient en une règle de découpage, appliquée plus strictement que d'habitude : **tout ce
qui décide vit dans `src/lib/neon/`, en fonctions pures, et tout ce qui appelle vit dans
`src/jobs/neon-branch.ts`.** Le partage n'est pas esthétique, il est dicté par ce qui est
testable :

- ce qui pourrait supprimer la mauvaise branche (`selectStaleBranches`) ;
- ce qui pourrait donner au job une adresse de base fausse (`pooledConnectionUri`) ;
- ce qui pourrait le faire agir sur le projet d'un tiers (`selectProjectId`) ;
- ce qui pourrait produire un nom que le pruner reprendrait pour une fuite (`ephemeralBranchName`).

Quarante-quatre tests unitaires, tous écrits avant le code, contre zéro requête. Le transport,
lui, reçoit son `fetch` par injection, comme `src/lib/ingest/referentials.ts` : la politique de
réessai, la distinction 4xx/5xx et le refus de retenter une requête malformée sont donc eux aussi
éprouvés sans réseau.

### La répétition générale : une fausse API Neon et un vrai Postgres

Restait la question à laquelle aucun test unitaire ne répond : est-ce que la *chaîne* marche ?
Créer, transmettre les deux chaînes de connexion à des étapes suivantes, migrer, tester,
supprimer — cinq maillons dont chacun peut casser sur un détail de format.

Le conteneur de session porte déjà Postgres 16 (entrée 014). Il ne manquait qu'un interlocuteur
côté Neon : une soixantaine de lignes de `node:http`, servant la forme décrite par la
spécification OpenAPI de Neon (téléchargée dans la session, pas récitée de mémoire), et créant une
vraie base par branche sur le cluster jetable. Le job reçoit alors `--api-base` et parle à ce
serveur.

Ce que la répétition a établi, dans l'ordre où le job l'a fait :

| Ce qu'on voulait voir | Ce qu'on a vu |
|---|---|
| le projet découvert sans être écrit nulle part | `proj-fake-0001` |
| une branche fuitée par une exécution antérieure élaguée | `ci-pr-7-999-1` supprimée |
| un nom de branche lisible tiré d'un `ref_name` sale | `feat/J1-11 branche éphémère` → `ci-feat-j1-11-branche-ephemere-1000-1` |
| les identifiants masqués **avant** toute autre sortie | trois `::add-mask::` en tête de log |
| l'attente de disponibilité réellement exercée | branche `init` au premier regard, `ready` au second |
| la migration en compte rendu, puis appliquée | 2 en attente, 0 après |
| la couche d'intégration | 17 tests verts en 3,5 s |
| la suppression rejouée | deuxième `delete` sans erreur, base réellement disparue |

Puis cinq chemins rouges : variable absente, clé refusée (401, sans réessai et sans que la clé
apparaisse dans le message), commande inconnue, `create` sans `--env-out`, `delete` sans
`--branch`. Aucun ne laisse de branche derrière lui.

**Ce que cela ne remplace pas.** La fausse API dit ce que la spécification promet, pas ce que
Neon fait. La forme exacte d'un `connection_uris` réel, les états intermédiaires d'une branche,
le message d'un dépassement de quota : rien de tout cela n'a été observé. La première exécution
en CI reste le premier vrai essai — exactement ce que l'entrée 021 disait de `migrate.yml`, et
c'est pourquoi c'est écrit ici avant de le redécouvrir.

### Le détail qui a coûté vingt minutes : `--env-file` appartient à Node

Le job devait écrire les chaînes de connexion dans un fichier, que le workflow ajoute ensuite à
`$GITHUB_ENV` — un fichier plutôt que stdout parce que deux de ces valeurs sont des identifiants
et qu'un log de workflow est public. L'option s'appelait naturellement `--env-file`.

Elle ne fonctionne pas. Node 22 revendique `--env-file` **pour lui-même, où qu'elle apparaisse
sur la ligne de commande**, arguments du script compris :

```
$ node script.mjs --env-file /tmp/nope.env
node: /tmp/nope.env: not found      # code 9, le script n'a jamais démarré
$ node script.mjs --env-out  /tmp/nope.env
["--env-out","/tmp/nope.env"]       # tout autre nom passe sans problème
```

Mesuré, pas déduit : le job mourait avant sa première ligne, avec un message qui ne nomme ni le
script ni l'option. L'option s'appelle `--env-out`, et la raison est écrite en tête du fichier —
c'est le genre de collision qu'une session future refait en trente secondes si personne ne l'a
notée.

### La correction : J1-11 ne donne pas de base à la deploy preview

Le 9 août, une ligne de dette affirmait que J1-11 ferait passer `/stats` « de "la base n'a pas
répondu" à de vrais chiffres, en preview comme en production », et la ligne de la feuille de route
le répétait. C'est faux, et il vaut mieux l'écrire que le laisser se démentir tout seul.

La branche éphémère naît dans un runner GitHub Actions et meurt avec lui, une quinzaine de
minutes plus tard. La deploy preview, elle, est construite par Netlify, qui n'a jamais entendu
parler de cette branche. Les relier demanderait de poser une variable d'environnement Netlify par
pull request depuis Actions — donc un `NETLIFY_AUTH_TOKEN` valant pour tout le compte, que le §9
refuse justement de provisionner sans usage — pour donner une base à une page que personne
n'ouvrira avant qu'elle soit détruite.

Ce que J1-11 apporte réellement est ailleurs, et suffit : **les migrations de ce dépôt sont
désormais appliquées à un Postgres géré, par la CI, avant chaque merge, sur une copie des données
réelles.** Jusqu'à ce matin, la seule chose qui les avait jamais exécutées était un cluster
jetable détruit avec sa session — et c'est précisément cet écart qui avait laissé la production
sans schéma pendant six jours (entrée 021).

### Une limite qui n'est pas de la coquetterie

Un projet Neon plafonne son nombre de branches. Une exécution tuée entre la création et
l'enregistrement de l'identifiant ne laisse rien à l'étape de nettoyage, et `cancel-in-progress`
tue des exécutions à chaque nouveau push. Trois ou quatre fuites, et **toutes** les exécutions
suivantes échouent sur un quota — c'est-à-dire sur un message qui ne parle pas du diff, la CI
qu'on apprend à ignorer du §5.

D'où l'élagage au début de chaque exécution, avec trois garde-fous qui protègent tous la même
chose : ne supprimer que des noms que ce dépôt a lui-même préfixés, jamais la branche par défaut
ni une branche protégée, jamais une branche de moins de deux heures — celle-là appartient à une
exécution en vol, et la tuer ferait échouer la pull request d'un tiers. Un échec de l'élagage ne
fait pas échouer le job : ne pas savoir ranger n'est pas une raison de ne pas travailler.

### Post-scriptum : la première exécution réelle a trouvé la chose en trente secondes

Écrit une heure après le reste de cette entrée, et c'est précisément pourquoi il vaut la peine
d'être écrit. La section précédente annonçait que la fausse API dit « ce que la spécification
promet, pas ce que Neon fait », et que la première exécution en CI serait le premier vrai essai.
Elle l'a été, et elle a échoué à la deuxième requête :

```
NeonApiError: The Neon API rejected GET /projects with HTTP 400:
org_id is required, you can find it on your organization settings page
```

Le compte derrière `NEON_API_KEY` appartient à une organisation. Neon refuse alors de deviner de
quel compte parle une énumération de projets sans filtre. La spécification OpenAPI décrit bien un
paramètre `org_id` sur `GET /projects` — **« Search for projects by `org_id` »**, présenté comme
un filtre facultatif. Elle ne dit nulle part qu'il cesse d'être facultatif. Aucune lecture, si
attentive soit-elle, n'aurait produit cette information : seule la requête la donne.

Trois choses valent d'être notées.

**Le message était lisible, et c'est un choix qui a payé.** Le §7 interdit de logger un secret,
pas de logger une explication. Le client remonte le `message` que l'API fournit, plafonné à deux
cents caractères, à côté du verbe et du chemin. « HTTP 400 » aurait envoyé la session suivante
lire du code ; « org_id is required » l'envoie corriger une requête. Le diagnostic a coûté une
lecture de log.

**Rien n'a fuité.** L'échec arrive *avant* la création de la branche — la découverte du projet est
la première chose que fait le job —, donc aucune branche n'a été laissée derrière. L'ordre des
opérations n'était pas un hasard, mais je ne l'avais pas justifié par ce cas-là.

**Le correctif est déclenché par le statut, pas par le texte.** Le job retente en nommant
l'organisation (`GET /users/me/organizations`, puis `GET /projects?org_id=…`), et il ne le fait
que sur un **400** : une requête sans paramètre qui se fait refuser pour cause de paramètre
manquant ne peut rien vouloir dire d'autre. Reconnaître la phrase aurait marché aujourd'hui et
cassé le jour où Neon la reformule. `selectOrganizationId` applique la même discipline que son
voisin `selectProjectId` — refuser de choisir entre plusieurs, et nommer `NEON_PROJECT_ID` comme
la sortie qui court-circuite toute cette découverte.

La fausse API a été mise à jour pour répondre comme la vraie, et la chaîne complète a été
rejouée : organisation découverte, projet trouvé, branche fuitée élaguée, migrations appliquées,
17 tests verts, suppression. Cette fausse API vaut désormais un peu plus que la spécification dont
elle est née — c'est la première ligne d'un fichier de contrat qui n'existe pas encore.

### Ce que la première exécution verte a dit en plus

Trente-cinq secondes, dont treize de tests. Le job a découvert l'organisation
`org-quiet-river-…`, le projet `fancy-voice-…`, créé `ci-pr-37-31579635601-1`, migré, lancé les
17 tests, supprimé la branche. Les deux chaînes de connexion apparaissent dans le log sous la
forme `DATABASE_URL: ***` : le masquage fonctionne, y compris dans l'en-tête que le runner imprime
lui-même au début de chaque étape — que le job ne contrôle pas.

Deux choses qu'on ne cherchait pas.

**La production a bien son schéma.** Le compte rendu de migration sur une branche *fraîchement
créée* dit `applied: 2, pending: []`. Une branche Neon naît par copie sur écriture de la branche
par défaut : ces deux migrations sont donc celles de la production. L'entrée 021 se terminait sur
« je n'écrirai pas ici que la production est réparée. Elle le sera quand le job l'aura dit. » Ce
n'est pas le job qu'on attendait qui l'a dit, c'est celui-ci, en passant.

**`pg` prévient d'un affaiblissement futur.** À chaque connexion :

> The SSL modes 'prefer', 'require', and 'verify-ca' are treated as aliases for 'verify-full'. In
> the next major version… these modes will adopt standard libpq semantics, which have weaker
> security guarantees.

Les URI que Neon fabrique portent `sslmode=require`. Aujourd'hui `pg` le lit comme `verify-full` ;
demain il le lira comme libpq, c'est-à-dire en chiffrant sans vérifier le certificat. **Rien ne
cassera** : la connexion marchera et vérifiera moins. C'est exactement la forme de régression que
le §7 redoute le plus, et elle arrivera par une montée de version mineure de notre point de vue.
L'avertissement est antérieur à cette PR — `ingest` et `migrate` connectent de la même façon — mais
il n'était visible nulle part avant qu'un job tourne en CI à chaque push. Noté plutôt que corrigé
au passage : réécrire une query string de connexion mérite sa propre PR, pas une ligne glissée dans
celle-ci (§12).

---

## 023 — Une commande que personne n'avait jamais lancée, et ce qu'elle a dit du dépôt

**12 août 2026** · jalon 1 · branche `claude/j1-11-w4yw73`

### Contexte

Toutes les tâches numérotées du jalon 1 étaient `terminé`. Restait une phrase du §5 sans réalité :
« Mutation (Stryker) : restreint à `src/lib/`, **hebdomadaire en cron plus `workflow_dispatch`** ».
`stryker.config.json`, `pnpm test:mutation` et les deux dépendances étaient là depuis le bootstrap.
Aucun workflow ne les appelait.

C'est mot pour mot la situation que J1-11 venait de corriger pour les tests d'intégration, et le
dépôt a donc maintenant deux exemplaires de la même leçon : **une commande que le contrat promet
et que rien n'exécute n'est pas « presque faite », elle est fausse.** Elle est même pire qu'absente,
parce que sa présence dans le §5 fait croire que la couche existe.

### La configuration était cassée deux fois, et de façon indétectable

Elle n'avait jamais tourné, donc rien n'avait jamais dit qu'elle était fausse. `pnpm verify` ne la
lit pas, `astro check` non plus, ESLint encore moins : c'est un fichier JSON que seul Stryker
comprend.

**Premier défaut — le plugin ne se chargeait pas.** Stryker découvre ses plugins en globbant
`node_modules/@stryker-mutator/*`. Sous pnpm, ce répertoire ne contient que des liens symboliques
vers le magasin, et le glob ne les suit pas. Résultat :

```
Cannot find TestRunner plugin "vitest". In fact, no TestRunner plugins were loaded.
```

Le message est bon — il dit *aucun*, pas *pas celui-là* —, mais il envoie vérifier une installation
qui est correcte. Nommer le plugin explicitement (`"plugins": ["@stryker-mutator/vitest-runner"]`)
le fait résoudre par Node plutôt que par un glob, et Node, lui, suit les liens.

**Second défaut — et celui-là fait plus que casser.** La configuration sélectionnait le projet
unitaire avec `"vitest": { "project": "unit" }`. Cette clé n'existe pas. Le type d'options généré
du runner, lu dans `node_modules`, accepte `dir`, `related` et `configFile`, et rien d'autre.

Ce n'est pas une faute de frappe sans conséquence. Pointé sur `vitest.config.ts`, le runner charge
**tous** les projets, et le troisième est `contract` — le seul du dépôt sans garde anti-I/O, celui
qui interroge `geo.api.gouv.fr` et l'annuaire DILA pour de vrai. Une fois par mutant. Il y a
1 957 mutants. Soit environ deux mille appels à deux API publiques, depuis un cron hebdomadaire
que personne ne regarde, et **rien dans un rapport de mutation ne l'aurait signalé**.

Le §5 interdit bien moins que cela. La correction est un `vitest.mutation.config.ts` qui ne
contient que le projet unitaire ; les définitions de projets sont passées dans `vitest.shared.ts`
et importées par les deux fichiers, parce que ce qui dériverait dans une copie est précisément la
garde anti-I/O et l'alias `~` — les deux échouent en silence, et l'entrée 007 raconte déjà ce que
coûte le second. `tests/unit/mutation-config.test.ts` l'assère dans les deux sens, chemin rouge
éprouvé avant le push.

### Ce que la mesure a dit, une fois qu'elle a pu tourner

**75,57 %** sur `src/lib/`. 1 957 mutants, 1 475 tués, 443 survivants, 4 en dépassement de délai.
**6 minutes 24**, alors que Stryker annonçait 26 minutes au bout d'une minute — une estimation
fausse d'un facteur quatre, ce qui est la raison d'attendre la fin plutôt que d'écrire un chiffre
prédit dans un `timeout-minutes`.

Trois choses valent le détour, et aucune n'était le chiffre global.

**Le test-first se voit dans le score.** `src/lib/resolve/` — le module dont la note de J1-06 dit
que les 73 tests ont tous été écrits avant le code — obtient **90,34 %**, et `arbitrate.ts`
**100 %**. Les plus bas sont les constructeurs de messages d'erreur, écrits après coup partout dans
le dépôt. La doctrine du §5 n'était jusqu'ici qu'un argument ; elle est maintenant mesurée sur son
propre code.

**41 % des survivants sont des chaînes de caractères.** 183 sur 443 : de la prose de message
d'erreur qu'aucun test n'assère mot pour mot. Le score global est donc, pour une bonne part, une
mesure de « assères-tu tes phrases » et non de « détecterais-tu une régression ». Le §5 dit qu'on
ne pilote pas le projet à la couverture ; il faudra dire la même chose du score de mutation global,
ou exclure cette classe de mutants. La décision attend le jalon 5, elle est en dette.

**Le pire score du dépôt est le garde SSRF.** `src/lib/fetch/address.ts` : **49,16 %**, 144
survivants. C'est le module que le §5 classe deuxième priorité de test, et dont la note de J1-05 dit
avec raison que sa table de plages a été écrite avant le code et n'a pas bougé. La répartition des
survivants dit ce que la note ne pouvait pas savoir : 32 `ArrayDeclaration` — une liste de plages
peut être **vidée** sans qu'un test s'en aperçoive — et 51 mutants d'égalité ou de condition sur
l'arithmétique CIDR, c'est-à-dire des bornes non épinglées. Les tests vérifient *qu'*une adresse est
rejetée ; ils verrouillent mal *pourquoi*.

Rien de tout cela n'est corrigé ici : le §12 dit une session, un ticket, et celui-ci était
« faire tourner la couche », pas « réécrire les tests du garde SSRF ». Mais c'est exactement le
genre de chose pour laquelle la couche existe, et elle l'a trouvée à sa première exécution.

### Une tentation refusée

Stryker signale que les mutants *statiques* — ceux du code exécuté au chargement du module, donc
les tables de constantes dont ce dépôt est plein — consomment **91 %** du temps, chacun forçant un
rejeu complet de la suite. L'option `ignoreStatic` diviserait la durée par dix.

Elle retirerait aussi de la mesure la table de plages du garde SSRF, c'est-à-dire précisément ce
que la section précédente vient de désigner comme le point faible du dépôt. Six minutes par semaine
ne sont pas un problème ; un score qui monte parce qu'on a cessé de regarder en serait un.

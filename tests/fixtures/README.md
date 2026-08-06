# Frozen fixtures

These files are **verbatim captures of third-party APIs**, kept so that the unit
suite can pin the shape of two moving upstreams without ever touching the network
(CLAUDE.md §5: no test on the path of a pull request makes a real request).

They are frozen observations, not test data someone made up. Nothing in them is
edited by hand — if a record here looks wrong, it is because the source says so,
and that is the point. What keeps them honest over time is `tests/contract/`,
which asks the real APIs the same questions on a schedule and fails loudly when
the answers stop matching.

## `geo/communes.json`

API Découpage administratif, `geo.api.gouv.fr` (docs/brief.md §4).

    GET https://geo.api.gouv.fr/communes
        ?fields=code,nom,population,codeDepartement,codeRegion,codeEpci

Captured 6 August 2026 — 34 969 communes, of which eight are kept here. Each was
picked for a case *measured* across the whole referential, not imagined:

| Record | Why it is here |
|---|---|
| `01001` L'Abergement-Clémenciat | An ordinary commune, below the v1 threshold |
| `01004` Ambérieu-en-Bugey | An ordinary commune, inside the perimeter |
| `2A004` Ajaccio | Corsica: the INSEE code's second character is a letter |
| `75056` Paris | The largest population, a single commune (arrondissements are a separate type upstream) |
| `97101` Les Abymes | Overseas: a three-character département code |
| `22016` Île-de-Bréhat | No EPCI at all — 98 communes are in this case |
| `55039` Beaumont-en-Verdunois | **Population 0.** Destroyed in 1916, never rebuilt, still legally a commune. Six are in this case |
| `98411` Îles Saint-Paul et Nouvelle-Amsterdam | No `population` key at all. Six are in this case |

## `annuaire/mairies.json` and `annuaire/mairies-export.json`

Annuaire de l'administration, DILA, on `api-lannuaire.service-public.gouv.fr`
(docs/brief.md §4 — the old `service-public.fr` domain is no longer used).

    GET …/records?where=pivot like "mairie"&select=<the seven fields below>
    GET …/exports/json?where=pivot like "mairie"&select=<the same seven>

Captured 6 August 2026 — 35 803 town-hall records, of which the same ten appear
in both files. **Two files for two endpoints**, because they do not answer the
same way: `/records` wraps its results in `{total_count, results}` and
`/exports/json` returns the bare array. Pinning both is what would catch one of
them drifting alone.

| Record | Why it is here |
|---|---|
| Mairie - Curgy | One website, `https`, the ordinary case |
| Mairie - Baignes-Sainte-Radegonde | `http` — 4 957 records are in this case |
| Mairie - Courcelles-sur-Aire | No website: the field is `null`. 13 656 records |
| Mairie - Saint-Malo - annexe Saint-Servan | Three candidate URLs for one town hall |
| Mairie - Conlie | A second entry carrying a non-empty `libelle` |
| Mairie - Bajus | A value with **no scheme** (`www.bajus.fr`) — five records have one |
| Mairie déléguée - Coudreceau | A town hall serving several communes: `pivot` holds two INSEE codes |
| Mairie déléguée - Magny-le-Freule | The top-level INSEE code **disagrees** with the `pivot` one. 13 records do |
| Mairie annexe - Sainte-Croix-Grand-Tonne | An annexe. 61 communes carry more than one record |
| Conseil territorial de Saint-Barthélemy | The only record declaring **two roles** (`cg` then `mairie`) |

### On personal data

The records also carry `adresse_courriel`, `telephone` and
`affectation_personne` — contact details of named people, which CLAUDE.md §7
forbids this repository to hold. They are absent from these files because the
capture **never requested them**: the `select=` clause names seven fields and
only those. Not asking is stronger than filtering afterwards, since there is no
later step where someone can forget.

One consequence worth stating: a value observed in `site_internet` was a personal
email address rather than a URL. It is deliberately **not** in these fixtures. The
case it illustrates — a value with no scheme — is covered by `Mairie - Bajus`, and
the parser is tested against a synthetic email in
`src/lib/sources/annuaire.test.ts`.

## Refreshing a fixture

Don't, unless the upstream shape actually changed. A fixture updated to make a
test pass is a test that no longer pins anything. When upstream *has* changed,
the schema in `src/lib/sources/` and the fixture move in the same pull request,
and the reason goes in `docs/journal.md`.

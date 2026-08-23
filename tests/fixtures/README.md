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

## `psi/*.json`

PageSpeed Insights, `www.googleapis.com/pagespeedonline/v5` (docs/brief.md §4).

    GET …/runPagespeed?url=<target>&strategy=mobile
        &category=performance&category=accessibility
        &category=best-practices&category=seo&key=<secret>

Captured 23 August 2026 by a manual dispatch of the Contracts workflow, which
is the only way any of this can be observed: **no session can call PSI.** The
keyless mode is not a reduced quota but a quota of zero — measured, `HTTP 429,
"quota_limit_value": "0"` — and `PSI_API_KEY` is a repository secret no
container here holds (docs/journal.md 027 and 032).

Six real town halls were requested, five kept. Each is here for a case the
parser has to survive, and all of them are addresses of actual communes: a
synthetic target would say what PSI does to a page nobody publishes.

| File | Why it is here |
|---|---|
| `paris.mobile.json` | The ordinary case, and the largest commune of the perimeter. Three accessibility failures, all `serious` |
| `andrezieux-boutheon.mobile.json` | The small end of the perimeter. Seven failures across three impact levels — **and** `image-redundant-alt`, an *informative* audit carrying five items and an impact while scoring 1. That one audit is why `findings.ts` tests the display mode and not only the score |
| `paris-page-absente.mobile.json` | A URL that 404s on a site that works. PSI measures the error page and scores it **95 on accessibility** — a perfectly good number about a page that is not the commune's |
| `erreur-document-indisponible.json` | `HTTP 400`, `FAILED_DOCUMENT_REQUEST`, `net::ERR_FAILED`: a commune whose CDN was answering 503 |
| `erreur-hote-injoignable.json` | `HTTP 400`, the same code and the same reason, `net::ERR_CONNECTION_FAILED`: a directory URL whose host no longer resolves. **The whole difference between "down for a minute" and "gone for good" is those five words of prose**, which is what `src/lib/psi/outcome.ts` is built around |

### These five are pruned, and the other fixtures are not

A raw report is 600 kB to 1.2 MB, of which three quarters is a full-page
screenshot in base64. Committing that would be absurd and CLAUDE.md §11.1
already says what this project thinks of keeping raw Lighthouse reports.

So the reduction is **mechanical, and done by a committed script** —
`scripts/prune-psi-capture.mjs` — rather than by hand, which this file forbids
everywhere else. What it keeps is a fixed list, not a filter over what the
parser reads: a fixture pruned by the parser's own opinion could never
contradict it. In particular the accessibility category is kept **whole**, all
76 audits including the passing ones, precisely so a test can prove the
extraction ignores the ones it should.

Removed: `fullPageScreenshot`, `i18n`, `timing`, `entities`, `categoryGroups`,
`userAgent`, `loadingExperience` and `originLoadingExperience` (CrUX field data
this project does not read), every audit outside the accessibility category but
the nine listed below, and — the one reduction *inside* an audit — the
`network-requests` items that are not the document. Error payloads are kept
byte for byte; they are under 700 bytes.

The ninth audit is kept although **nothing reads it**, and it is the reason this
section exists rather than being a footnote. `document-latency-insight` is of
type `checklist`, so its `details.items` is an **object** where every other
audit sends a list. The first version of the schema declared an array there and
rejected every live report because of it — and the first version of the pruning
had dropped that audit, so no unit test could have found out. The weekly
contract test found it within the hour (docs/journal.md 032). It stays as the
counter-example, which is the whole point of not pruning by what the parser
happens to want.

Being pruned is exactly why `tests/contract/psi.test.ts` matters more here than
for the two sources below: these files are not what arrived, so only the live
API can confirm they still describe it.

## Refreshing a fixture

Don't, unless the upstream shape actually changed. A fixture updated to make a
test pass is a test that no longer pins anything. When upstream *has* changed,
the schema in `src/lib/sources/` and the fixture move in the same pull request,
and the reason goes in `docs/journal.md`.

/**
 * Die Faltungsregeln der Forge — geprüft wird, was in der Fläche STILL bricht:
 *
 *   1. **Status-Faltung 1630–1633 bei mehreren Ereignissen zum selben Ziel.**
 *      Der neueste gewinnt, bei Gleichstand entscheidet die Id — sonst hinge
 *      die Anzeige an der Ankunftsreihenfolge des Relays und dieselbe Zeile
 *      zeigte nach einem Reload etwas anderes.
 *   2. **Ein Status von einem Unberechtigten zählt nicht.** 1630–1633 sind
 *      gewöhnliche Ereignisse; jedes Relay-Mitglied darf eins schreiben. Ohne
 *      diesen Riegel wäre die Anzeige trivial fälschbar.
 *   3. **PR-Zustand aus 1618 + MEHREREN 1619.** Die Updates referenzieren über
 *      ein grosses `E`; wer nur `e` prüft, sieht keins.
 *   4. **Projekt → Repo über `a`-Tags, inklusive einer Koordinate ins Leere.**
 *      Eine unauflösbare Koordinate muss sichtbar bleiben statt zu verschwinden.
 *   5. **Grabsteine (kind 5) über `#a`.** Ein Grabstein wirkt nur vom
 *      Eigentümer und nur auf Fassungen, die nicht neuer sind als er.
 *   6. **Der Branch-Zustand ist RELAY-signiert.** Lässt man nur den
 *      Repo-Eigentümer als Autor zu, sieht man am echten Relay null Zustände.
 *
 * Ausführen:
 * node --experimental-strip-types --test packages/einundzwanzig-group/js/forgeModels.test.ts
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
    DELETION,
    FORGE_COMMENT,
    GIT_ISSUE,
    GIT_PATCH,
    GIT_PR_UPDATE,
    GIT_PULL_REQUEST,
    GIT_STATUS_APPLIED,
    GIT_STATUS_CLOSED,
    GIT_STATUS_DRAFT,
    GIT_STATUS_OPEN,
    PROJECT_ANNOUNCEMENT,
    REPO_ANNOUNCEMENT,
    REPO_STATE,
    buildIssues,
    buildPatches,
    buildProjects,
    buildPullRequests,
    buildRepos,
    dedupeReplaceable,
    deletionThresholds,
    foldRepoState,
    foldStatus,
    maintainerLookupFor,
    parseRepoAddress,
    repoAddressOf,
    toIssue,
    toPatch,
    toPullRequest,
    toRepo,
    toRepoState,
    truncatedLists,
    unclaimedRepos,
    type ForgeEvent,
} from './forgeModels.ts'

const OWNER = '0adf67475ccc5ca456fd3022e46f5d526eb0af6284bf85494c0dd7847f3e5033'
const RELAY_SELF = 'e699af6e6e9802ea253b18a8cbb8f816f8533708f08164469eba99f1ccacdf53'
const MAINTAINER = '40b87b4cc62aeb820b10b4e652b26ba7e6793933736185ee2b821dafa2683b49'
const FREMD = 'f'.repeat(64)
const REPO_D = 'einundzwanzig-verein'
const REPO_ADDR = repoAddressOf(OWNER, REPO_D)

let counter = 0
const ev = (partial: Partial<ForgeEvent> & { kind: number }): ForgeEvent => ({
    id: partial.id ?? `${String(counter++).padStart(64, '0')}`,
    pubkey: partial.pubkey ?? OWNER,
    kind: partial.kind,
    created_at: partial.created_at ?? 1_000,
    content: partial.content ?? '',
    tags: partial.tags ?? [],
})

// ── Adressen ────────────────────────────────────────────────────────────────

test('parseRepoAddress: gültige Koordinate, falsches Kind, Grossbuchstaben, `d` mit Doppelpunkt', () => {
    assert.deepEqual(parseRepoAddress(REPO_ADDR), { owner: OWNER, dtag: REPO_D })
    // Ein `d` darf Doppelpunkte tragen — nur an den ERSTEN beiden wird geschnitten.
    assert.deepEqual(parseRepoAddress(`30617:${OWNER}:a:b`), { owner: OWNER, dtag: 'a:b' })
    assert.equal(parseRepoAddress(`30618:${OWNER}:x`), null, 'falsches Kind')
    assert.equal(parseRepoAddress(`30617:${OWNER.toUpperCase()}:x`), null, 'Owner muss klein sein')
    assert.equal(parseRepoAddress(`30617:${OWNER}:`), null, 'leeres d')
    assert.equal(parseRepoAddress('kaputt'), null)
})

// ── 30617 ───────────────────────────────────────────────────────────────────

test('toRepo liest das echte 30617 des Ziel-Relays: Name, Beschreibung, Clone-URL, 10 Maintainer, buzz-protect', () => {
    const repo = toRepo(
        ev({
            kind: REPO_ANNOUNCEMENT,
            created_at: 1786792213,
            tags: [
                ['d', REPO_D],
                ['name', REPO_D],
                ['description', 'Einundzwanzig Verein'],
                ['clone', `https://buzz.einundzwanzig.space/git/${OWNER}/${REPO_D}`],
                ['web', `https://buzz.einundzwanzig.space/git/${OWNER}/${REPO_D}`],
                ['buzz-channel', '576d38b2-9372-418e-93ec-134ca508722c'],
                ['h', '576d38b2-9372-418e-93ec-134ca508722c'],
                ...Array.from({ length: 10 }, (_, i) => [
                    'maintainers',
                    `${String(i)}${'a'.repeat(63)}`,
                ]),
                ['buzz-protect', 'refs/heads/master', 'push:admin'],
                ['buzz-protect', 'refs/heads/master', 'no-force-push'],
                ['buzz-protect', 'refs/heads/master', 'no-delete'],
            ],
        }),
    )

    assert.ok(repo)
    assert.equal(repo.address, REPO_ADDR)
    assert.equal(repo.name, REPO_D)
    assert.equal(repo.description, 'Einundzwanzig Verein')
    assert.equal(repo.cloneUrls.length, 1)
    assert.equal(repo.maintainers.length, 10)
    assert.equal(repo.channelId, '576d38b2-9372-418e-93ec-134ca508722c')
    assert.deepEqual(
        repo.protections.map((p) => p.rule),
        ['push:admin', 'no-force-push', 'no-delete'],
    )
    // Am Ziel-Relay fehlt `default-branch` — der echte HEAD steht im 30618.
    assert.equal(repo.defaultBranch, '')
})

test('toRepo: `maintainers` in der MEHRWERTIGEN Schreibweise geht nicht verloren', () => {
    const repo = toRepo(
        ev({
            kind: REPO_ANNOUNCEMENT,
            tags: [
                ['d', REPO_D],
                ['maintainers', MAINTAINER, RELAY_SELF],
            ],
        }),
    )

    // Wer nur `tag[1]` liest, verliert hier den zweiten Eintrag — und merkt es nie.
    assert.deepEqual(repo?.maintainers, [MAINTAINER, RELAY_SELF])
})

test('toRepo lehnt ab, was kein Repo ist (falsches Kind, fehlendes d)', () => {
    assert.equal(toRepo(ev({ kind: 1, tags: [['d', 'x']] })), null)
    assert.equal(toRepo(ev({ kind: REPO_ANNOUNCEMENT, tags: [] })), null)
})

// ── Ersetzbare Köpfe ────────────────────────────────────────────────────────

test('dedupeReplaceable: neuester Kopf je (kind, pubkey, d); bei Gleichstand gewinnt die KLEINERE Id', () => {
    const alt = ev({ kind: REPO_ANNOUNCEMENT, created_at: 10, tags: [['d', 'r']], id: 'b'.repeat(64) })
    const neu = ev({ kind: REPO_ANNOUNCEMENT, created_at: 20, tags: [['d', 'r']], id: 'c'.repeat(64) })
    assert.deepEqual(dedupeReplaceable([alt, neu]).map((e) => e.id), [neu.id])
    assert.deepEqual(dedupeReplaceable([neu, alt]).map((e) => e.id), [neu.id], 'Reihenfolge egal')

    const gleichA = ev({ kind: REPO_ANNOUNCEMENT, created_at: 20, tags: [['d', 'r']], id: 'a'.repeat(64) })
    const gleichB = ev({ kind: REPO_ANNOUNCEMENT, created_at: 20, tags: [['d', 'r']], id: 'z'.repeat(64) })
    assert.deepEqual(dedupeReplaceable([gleichB, gleichA]).map((e) => e.id), [gleichA.id])
})

// ── 30618 ───────────────────────────────────────────────────────────────────

test('toRepoState liest Refs aus den TAG-NAMEN und löst das `ref:`-Präfix von HEAD auf', () => {
    const state = toRepoState(
        ev({
            kind: REPO_STATE,
            pubkey: RELAY_SELF,
            created_at: 1785499858,
            tags: [
                ['d', REPO_D],
                ['refs/heads/master', 'ca1c707b2d1f21849fca434d3683e238d1365e62'],
                ['refs/tags/v1', 'a'.repeat(40)],
                ['HEAD', 'ref: refs/heads/master'],
                ['p', MAINTAINER],
            ],
        }),
    )

    assert.deepEqual(state.branches, [
        { name: 'master', commit: 'ca1c707b2d1f21849fca434d3683e238d1365e62' },
    ])
    assert.deepEqual(state.tags, [{ name: 'v1', commit: 'a'.repeat(40) }])
    assert.equal(state.head, 'master')
    assert.equal(state.actor, MAINTAINER, 'der `p`-Tag ist der Pusher (Buzz-Erweiterung)')
})

test('foldRepoState akzeptiert den RELAY als Autor — sonst ist der Branch-Zustand am echten Relay leer', () => {
    // Genau die drei Ereignisse, die am 2026-08-17 am Ziel-Relay lagen: alle drei
    // vom Relay signiert, alle drei mit demselben `d`, KEINES vom Eigentümer.
    const events = [
        ev({ kind: REPO_STATE, pubkey: RELAY_SELF, created_at: 1785499770, tags: [['d', REPO_D], ['HEAD', 'ref: refs/heads/main']] }),
        ev({ kind: REPO_STATE, pubkey: RELAY_SELF, created_at: 1785499821, tags: [['d', REPO_D], ['HEAD', 'ref: refs/heads/main']] }),
        ev({
            kind: REPO_STATE,
            pubkey: RELAY_SELF,
            created_at: 1785499858,
            tags: [['d', REPO_D], ['refs/heads/master', 'ca1c707b2d1f21849fca434d3683e238d1365e62'], ['HEAD', 'ref: refs/heads/master']],
        }),
    ]

    const state = foldRepoState(events, { owner: OWNER, relaySelf: RELAY_SELF, dtag: REPO_D })
    assert.ok(state, 'mit relaySelf steht der Zustand')
    assert.equal(state.head, 'master', 'der NEUESTE der drei gewinnt')

    // Und die Gegenprobe: ohne relaySelf sieht man nichts. Das ist der Fehler,
    // den man ohne echte Messung baut.
    assert.equal(foldRepoState(events, { owner: OWNER, relaySelf: '', dtag: REPO_D }), null)
})

test('foldRepoState: bei gleicher Sekunde verliert der LEERE Zustand — nicht der relay-signierte', () => {
    // Der gemessene Fall (P11): Buzz schreibt bei einer frisch reservierten
    // Repo-Adresse selbst ein 30618 mit `HEAD`, aber OHNE einen einzigen Ref
    // (`emit_initial_ref_state`). Faellt es in dieselbe Unix-Sekunde wie das echte,
    // entschied hier vorher `a.id.localeCompare(b.id)` — ein Muenzwurf ueber den
    // Event-Hash. Die beiden Ids sind deshalb bewusst so gewaehlt, dass der LEERE
    // den alten Tiebreak GEWINNEN wuerde ('0…' < 'f…').
    const leer = ev({
        kind: REPO_STATE,
        id: '0'.repeat(64),
        pubkey: RELAY_SELF,
        created_at: 1_785_500_000,
        tags: [['d', REPO_D], ['HEAD', 'ref: refs/heads/master']],
    })
    const echt = ev({
        kind: REPO_STATE,
        id: 'f'.repeat(64),
        pubkey: OWNER,
        created_at: 1_785_500_000,
        tags: [
            ['d', REPO_D],
            ['refs/heads/master', 'ca1c707b2d1f21849fca434d3683e238d1365e62'],
            ['HEAD', 'ref: refs/heads/master'],
        ],
    })

    for (const events of [[leer, echt], [echt, leer]]) {
        const state = foldRepoState(events, { owner: OWNER, relaySelf: RELAY_SELF, dtag: REPO_D })
        assert.equal(state?.branches.length, 1, 'der Zustand MIT Refs gewinnt, unabhaengig von der Reihenfolge')
    }

    // Die Regel gilt NUR beim Gleichstand: ein Repo, dessen Branches geloescht
    // wurden, ist legitim leer — ein NEUERES leeres 30618 muss weiter gewinnen.
    const spaeterLeer = ev({
        kind: REPO_STATE,
        id: '1'.repeat(64),
        pubkey: RELAY_SELF,
        created_at: 1_785_500_060,
        tags: [['d', REPO_D], ['HEAD', 'ref: refs/heads/master']],
    })
    assert.equal(
        foldRepoState([echt, spaeterLeer], { owner: OWNER, relaySelf: RELAY_SELF, dtag: REPO_D })?.branches.length,
        0,
        'ein juengerer leerer Zustand bleibt massgeblich',
    )

    // Und die bewusst NICHT gebaute Regel: relay-signiert wird nicht pauschal
    // zurueckgestuft. Am Ziel-Relay ist jeder 30618 relay-signiert; eine solche
    // Regel liesse ein altes owner-signiertes den echten Push-Zustand dauerhaft
    // ueberstimmen. Hier ist der relay-signierte juenger UND voll — er gewinnt.
    const relayNeuer = ev({
        kind: REPO_STATE,
        pubkey: RELAY_SELF,
        created_at: 1_785_500_120,
        tags: [['d', REPO_D], ['refs/heads/main', 'b'.repeat(40)], ['HEAD', 'ref: refs/heads/main']],
    })
    assert.equal(
        foldRepoState([echt, relayNeuer], { owner: OWNER, relaySelf: RELAY_SELF, dtag: REPO_D })?.head,
        'main',
        'der neuere relay-signierte Zustand bleibt massgeblich',
    )
})

test('foldRepoState (N2): ein juengeres leeres 30618 gewinnt — und heilt sich beim naechsten Push', () => {
    // N2 des Nachlese-Plans: reicht die Gleichstands-Regel, oder verdeckt ein
    // LEERES 30618 mit HOEHEREM created_at einen echten Push-Zustand?
    //
    // Der Relay-Weg ist ausgeschlossen (gemessen, siehe Doc-Kommentar an
    // foldRepoState). Bleibt der Eigentuemer: Buzz nimmt ein owner-signiertes
    // 30618 an, `created_at` nur durch ein Server-Zeitfenster begrenzt. Genau
    // dieser Fall steht hier — er ist BEWUSST nicht verriegelt, und dieser Test
    // haelt die Entscheidung fest, damit sie beim naechsten Anfassen nicht als
    // Versehen gelesen wird.
    const push = ev({
        kind: REPO_STATE,
        pubkey: RELAY_SELF,
        created_at: 1_785_600_000,
        tags: [['d', REPO_D], ['refs/heads/master', 'c'.repeat(40)], ['HEAD', 'ref: refs/heads/master']],
    })
    const ownerLeerJuenger = ev({
        kind: REPO_STATE,
        pubkey: OWNER,
        created_at: 1_785_600_060,
        tags: [['d', REPO_D], ['HEAD', 'ref: refs/heads/master']],
    })

    assert.equal(
        foldRepoState([push, ownerLeerJuenger], { owner: OWNER, relaySelf: RELAY_SELF, dtag: REPO_D })?.branches.length,
        0,
        'der juengere leere Zustand gewinnt — sichtbar leer, nicht falsch befuellt',
    )

    // Und das ist der Grund, warum er gewinnen DARF: der naechste Push repariert
    // die Anzeige von selbst. Der Fehler ist voruebergehend.
    const naechsterPush = ev({
        kind: REPO_STATE,
        pubkey: RELAY_SELF,
        created_at: 1_785_600_120,
        tags: [['d', REPO_D], ['refs/heads/master', 'd'.repeat(40)], ['HEAD', 'ref: refs/heads/master']],
    })
    assert.equal(
        foldRepoState([push, ownerLeerJuenger, naechsterPush], { owner: OWNER, relaySelf: RELAY_SELF, dtag: REPO_D })
            ?.branches[0]?.commit,
        'd'.repeat(40),
        'der naechste Push ist wieder massgeblich',
    )

    // Die Gegenprobe zum NICHT gebauten Riegel („mit Refs schlaegt ohne Refs,
    // auch ueber Autorengrenzen"): ein Push, der alle Branches entfernt, ist
    // legitim leer. Mit jenem Riegel gewaenne hier der ALTE owner-signierte
    // Zustand — und zwar dauerhaft, denn ein Repo ohne Branches hat keinen
    // naechsten Push. Deshalb muss der leere Zustand auch hier gewinnen.
    const ownerAltMitRefs = ev({
        kind: REPO_STATE,
        pubkey: OWNER,
        created_at: 1_785_600_000,
        tags: [['d', REPO_D], ['refs/heads/master', 'e'.repeat(40)], ['HEAD', 'ref: refs/heads/master']],
    })
    const pushLoeschtAlles = ev({
        kind: REPO_STATE,
        pubkey: RELAY_SELF,
        created_at: 1_785_600_060,
        tags: [['d', REPO_D], ['HEAD', 'ref: refs/heads/master']],
    })
    assert.equal(
        foldRepoState([ownerAltMitRefs, pushLoeschtAlles], { owner: OWNER, relaySelf: RELAY_SELF, dtag: REPO_D })
            ?.branches.length,
        0,
        'ein Push, der alle Branches entfernt, bleibt massgeblich',
    )
})

test('foldRepoState ignoriert einen fremden Autor und ein fremdes `d`', () => {
    const events = [
        ev({ kind: REPO_STATE, pubkey: FREMD, created_at: 9_000, tags: [['d', REPO_D], ['HEAD', 'ref: refs/heads/fremd']] }),
        ev({ kind: REPO_STATE, pubkey: RELAY_SELF, created_at: 8_000, tags: [['d', 'anderes-repo'], ['HEAD', 'ref: refs/heads/x']] }),
        ev({ kind: REPO_STATE, pubkey: RELAY_SELF, created_at: 1_000, tags: [['d', REPO_D], ['HEAD', 'ref: refs/heads/main']] }),
    ]

    assert.equal(foldRepoState(events, { owner: OWNER, relaySelf: RELAY_SELF, dtag: REPO_D })?.head, 'main')
})

// ── Status-Faltung ──────────────────────────────────────────────────────────

const issueRoot = (id = 'i'.repeat(64)): ForgeEvent =>
    ev({
        kind: GIT_ISSUE,
        id,
        pubkey: MAINTAINER,
        created_at: 100,
        content: 'Erste Zeile\nzweite Zeile',
        tags: [['a', REPO_ADDR], ['t', 'bug']],
    })

const status = (kind: number, rootId: string, created_at: number, pubkey = MAINTAINER, id?: string) =>
    ev({ kind, pubkey, created_at, id, tags: [['e', rootId, '', 'root'], ['a', REPO_ADDR]] })

test('Status-Faltung: bei MEHREREN Status-Ereignissen zum selben Ziel gewinnt das neueste', () => {
    const root = issueRoot()
    const events = [
        status(GIT_STATUS_OPEN, root.id, 200),
        status(GIT_STATUS_CLOSED, root.id, 300),
        status(GIT_STATUS_APPLIED, root.id, 250),
    ]

    assert.equal(foldStatus(root, events)?.kind, GIT_STATUS_CLOSED)
    assert.equal(toIssue(root, events).status, 'closed')

    // Auch verdreht angeliefert — der Relay liefert beim Reconnect-Replay nicht
    // in Erstellungsreihenfolge.
    assert.equal(toIssue(root, [...events].reverse()).status, 'closed')
})

test('Status-Faltung: Gleichstand in created_at wird deterministisch über die Id gelöst', () => {
    const root = issueRoot()
    const a = status(GIT_STATUS_APPLIED, root.id, 300, MAINTAINER, 'a'.repeat(64))
    const z = status(GIT_STATUS_CLOSED, root.id, 300, MAINTAINER, 'z'.repeat(64))

    assert.equal(foldStatus(root, [a, z])?.id, a.id)
    assert.equal(foldStatus(root, [z, a])?.id, a.id, 'unabhängig von der Reihenfolge')
})

test('Status-Faltung: ein Status von einem UNBERECHTIGTEN wird ignoriert; Eigentümer und Autor zählen', () => {
    const root = issueRoot()

    assert.equal(toIssue(root, [status(GIT_STATUS_CLOSED, root.id, 400, FREMD)]).status, 'open')
    // Der Repo-Eigentümer aus dem `a`-Tag darf — auch wenn er das Issue nicht schrieb.
    assert.equal(toIssue(root, [status(GIT_STATUS_CLOSED, root.id, 400, OWNER)]).status, 'closed')
    // Der Autor der Wurzel ebenfalls.
    assert.equal(toIssue(root, [status(GIT_STATUS_DRAFT, root.id, 400, MAINTAINER)]).status, 'draft')
})

test('Status-Faltung: ein Status auf eine ANDERE Wurzel färbt nicht ab', () => {
    const root = issueRoot()
    const anderes = status(GIT_STATUS_CLOSED, 'j'.repeat(64), 400)

    assert.equal(toIssue(root, [anderes]).status, 'open')
})

test('Issue ohne Status ist offen; `subject` schlägt die erste Inhaltszeile', () => {
    const ohneSubject = toIssue(issueRoot())
    assert.equal(ohneSubject.status, 'open')
    assert.equal(ohneSubject.title, 'Erste Zeile')
    assert.deepEqual(ohneSubject.labels, ['bug'])

    const mitSubject = toIssue(
        ev({ kind: GIT_ISSUE, content: 'Text', tags: [['a', REPO_ADDR], ['subject', 'Kurzfassung']] }),
    )
    assert.equal(mitSubject.title, 'Kurzfassung')
})

test('buildIssues sortiert nach letzter Regung, nicht nach Erstellung', () => {
    const alt = ev({ kind: GIT_ISSUE, id: 'a'.repeat(64), created_at: 100, tags: [['a', REPO_ADDR]] })
    const neu = ev({ kind: GIT_ISSUE, id: 'b'.repeat(64), created_at: 200, tags: [['a', REPO_ADDR]] })
    const kommentar = ev({ kind: 1, created_at: 900, pubkey: FREMD, tags: [['e', alt.id], ['a', REPO_ADDR]] })

    const issues = buildIssues([alt, neu], [], [kommentar])
    assert.deepEqual(issues.map((i) => i.id), [alt.id, neu.id])
    assert.equal(issues[0].commentCount, 1)
    assert.equal(issues[0].updatedAt, 900)
})

// ── Pull Request ────────────────────────────────────────────────────────────

const prRoot = (id = 'p'.repeat(64)): ForgeEvent =>
    ev({
        kind: GIT_PULL_REQUEST,
        id,
        pubkey: MAINTAINER,
        created_at: 100,
        content: 'PR-Text',
        tags: [
            ['a', REPO_ADDR],
            ['subject', 'Titel des PR'],
            ['branch-name', 'feat/x'],
            ['target-branch', 'master'],
            ['c', '1111111111111111111111111111111111111111'],
        ],
    })

const prUpdate = (rootId: string, commit: string, created_at: number, pubkey = MAINTAINER) =>
    ev({ kind: GIT_PR_UPDATE, pubkey, created_at, content: 'Update', tags: [['E', rootId], ['a', REPO_ADDR], ['c', commit]] })

test('PR-Zustand aus 1618 + MEHREREN 1619: der jüngste Commit gewinnt, alle Updates werden gezählt', () => {
    const root = prRoot()
    const updates = [
        prUpdate(root.id, '2'.repeat(40), 200),
        prUpdate(root.id, '3'.repeat(40), 400),
        prUpdate(root.id, '4'.repeat(40), 300),
    ]

    const pr = toPullRequest(root, updates)
    assert.equal(pr.updateCount, 3)
    assert.equal(pr.commit, '3'.repeat(40), 'der Commit des JÜNGSTEN Updates')
    assert.equal(pr.branch, 'feat/x')
    assert.equal(pr.targetBranch, 'master')
    assert.equal(pr.updatedAt, 400)
    assert.equal(pr.status, 'open', 'ohne Status-Ereignis ist ein PR offen')
    // Die Updates sind aufsteigend sortiert — die Zeitleiste liest sie so.
    assert.deepEqual(pr.updates.map((u) => u.createdAt), [200, 300, 400])
})

test('PR-Update: `E` (gross) wird erkannt — ein reiner `e`-Test sähe kein einziges', () => {
    const root = prRoot()
    const mitGrossE = toPullRequest(root, [prUpdate(root.id, '9'.repeat(40), 500)])
    assert.equal(mitGrossE.updateCount, 1)

    // Und ein Update auf eine fremde Wurzel zählt nicht.
    const fremd = ev({ kind: GIT_PR_UPDATE, pubkey: MAINTAINER, created_at: 500, tags: [['E', 'x'.repeat(64)], ['c', '8'.repeat(40)]] })
    assert.equal(toPullRequest(root, [fremd]).updateCount, 0)
})

test('PR-Update von einem Unberechtigten biegt den Commit NICHT um', () => {
    const root = prRoot()
    const pr = toPullRequest(root, [prUpdate(root.id, '7'.repeat(40), 900, FREMD)])

    assert.equal(pr.updateCount, 0)
    assert.equal(pr.commit, '1111111111111111111111111111111111111111', 'der Commit der Wurzel bleibt stehen')
})

test('PR-Status: 1631 heisst „merged" (beim Issue heisst dasselbe Kind „resolved")', () => {
    const root = prRoot()
    const merged = status(GIT_STATUS_APPLIED, root.id, 600)

    assert.equal(toPullRequest(root, [], [merged]).status, 'merged')

    // Dasselbe Kind 1631 am Issue: dort ist es kein „merged" (ein Issue wird
    // nicht gemergt), sondern „erledigt". Ein gemeinsamer Code für beide wäre in
    // der Oberfläche ein falsches Wort an einer der beiden Stellen.
    const issue = issueRoot()
    assert.equal(toIssue(issue, [status(GIT_STATUS_APPLIED, issue.id, 600)]).status, 'resolved')
})

test('PR ohne Status, aber mit `t: draft`, gilt als Entwurf — ein gesetzter Status schlägt das Label', () => {
    const entwurf = ev({
        kind: GIT_PULL_REQUEST,
        id: 'd'.repeat(64),
        pubkey: MAINTAINER,
        tags: [['a', REPO_ADDR], ['t', 'Draft']],
    })

    assert.equal(toPullRequest(entwurf).status, 'draft')
    assert.equal(toPullRequest(entwurf, [], [status(GIT_STATUS_OPEN, entwurf.id, 500)]).status, 'open')
})

test('buildPullRequests fasst Wurzeln, Updates, Status und Kommentare zusammen', () => {
    const root = prRoot()
    const kommentar = ev({ kind: 1, pubkey: FREMD, created_at: 700, content: 'Sieht gut aus', tags: [['E', root.id], ['a', REPO_ADDR]] })
    const [pr] = buildPullRequests([root], [prUpdate(root.id, '5'.repeat(40), 300)], [status(GIT_STATUS_CLOSED, root.id, 800)], [kommentar])

    assert.equal(pr.status, 'closed')
    assert.equal(pr.commentCount, 1)
    assert.equal(pr.comments[0].content, 'Sieht gut aus')
    assert.equal(pr.updatedAt, 800)
})

// ── Projekte (NIP-MP) ───────────────────────────────────────────────────────

const repoEvent = (dtag: string, pubkey = OWNER, created_at = 1_000) =>
    ev({ kind: REPO_ANNOUNCEMENT, pubkey, created_at, tags: [['d', dtag], ['name', dtag]] })

test('Projekt → Repo über `a`-Tags, inklusive einer Koordinate, die auf KEIN vorhandenes Repo zeigt', () => {
    const vorhanden = repoEvent(REPO_D)
    const zweites = repoEvent('zweites-repo')
    const fehlend = repoAddressOf(FREMD, 'gibt-es-nicht')
    const repos = buildRepos([vorhanden, zweites])

    const projekt = ev({
        kind: PROJECT_ANNOUNCEMENT,
        pubkey: OWNER,
        created_at: 2_000,
        tags: [
            ['d', REPO_D],
            ['name', 'Verein'],
            ['a', REPO_ADDR],
            ['a', repoAddressOf(OWNER, 'zweites-repo')],
            ['a', fehlend],
            ['a', 'voelliger-unsinn'],
        ],
    })

    const [projekt1] = buildProjects([projekt], repos)
    assert.equal(projekt1.name, 'Verein')
    // Drei gültige Koordinaten — der Unsinn fliegt schon beim Parsen raus.
    assert.equal(projekt1.memberAddresses.length, 3)
    assert.deepEqual(projekt1.repos.map((r) => r.dtag).sort(), ['einundzwanzig-verein', 'zweites-repo'])
    // Und die dritte verschwindet NICHT still, sondern bleibt benennbar.
    assert.deepEqual(projekt1.missingAddresses, [fehlend])
})

test('Projekt: `buzz-visibility: unlisted` erscheint nicht; ohne den Tag schon', () => {
    const repos = buildRepos([repoEvent(REPO_D)])
    const unlisted = ev({
        kind: PROJECT_ANNOUNCEMENT,
        created_at: 2_000,
        tags: [['d', 'geheim'], ['buzz-visibility', 'unlisted'], ['a', REPO_ADDR]],
    })
    const gelistet = ev({ kind: PROJECT_ANNOUNCEMENT, created_at: 2_000, tags: [['d', 'offen'], ['a', REPO_ADDR]] })

    assert.deepEqual(buildProjects([unlisted, gelistet], repos).map((p) => p.dtag), ['offen'])
})

test('unclaimedRepos: ein Repo verschwindet nur dann aus der Repo-Liste, wenn der Projekt-Eigentümer es besitzt', () => {
    const repos = buildRepos([repoEvent(REPO_D)])
    const eigenes = ev({ kind: PROJECT_ANNOUNCEMENT, pubkey: OWNER, tags: [['d', 'p'], ['a', REPO_ADDR]] })
    const fremdes = ev({ kind: PROJECT_ANNOUNCEMENT, pubkey: FREMD, tags: [['d', 'p'], ['a', REPO_ADDR]] })

    assert.equal(unclaimedRepos(repos, buildProjects([eigenes], repos)).length, 0)
    // Ein Fremder darf ein Repo nicht aus der Liste ziehen, indem er ein Projekt
    // darauf anlegt.
    assert.equal(unclaimedRepos(repos, buildProjects([fremdes], repos)).length, 1)
})

// ── Grabsteine ──────────────────────────────────────────────────────────────

const tombstone = (coordinate: string, created_at: number, pubkey = OWNER) =>
    ev({ kind: DELETION, pubkey, created_at, tags: [['a', coordinate]] })

test('Grabstein über `#a`: vom Eigentümer wirkt er, vom Fremden nicht', () => {
    const repo = repoEvent(REPO_D, OWNER, 1_000)

    assert.equal(buildRepos([repo], [tombstone(REPO_ADDR, 2_000)]).length, 0)
    assert.equal(buildRepos([repo], [tombstone(REPO_ADDR, 2_000, FREMD)]).length, 1, 'fremder Grabstein wirkt nicht')
})

test('Grabstein ist eine SCHWELLE: eine danach angelegte Fassung lebt wieder', () => {
    const alt = repoEvent(REPO_D, OWNER, 1_000)
    const neu = repoEvent(REPO_D, OWNER, 3_000)
    const grab = tombstone(REPO_ADDR, 2_000)

    assert.equal(buildRepos([alt], [grab]).length, 0)
    assert.equal(buildRepos([neu], [grab]).length, 1)
    // Gleichstand zählt als gelöscht (NIP-09: „created_at ≥ head").
    assert.equal(buildRepos([repoEvent(REPO_D, OWNER, 2_000)], [grab]).length, 0)
})

test('deletionThresholds behält die SPÄTESTE Schwelle je Koordinate und ignoriert kaputte Tags', () => {
    const thresholds = deletionThresholds([
        tombstone(REPO_ADDR, 1_000),
        tombstone(REPO_ADDR, 5_000),
        tombstone(REPO_ADDR, 3_000),
        ev({ kind: DELETION, tags: [['a', 'kein-doppelpunkt']] }),
        ev({ kind: 1, tags: [['a', REPO_ADDR]] }),
    ])

    assert.equal(thresholds.get(REPO_ADDR), 5_000)
    assert.equal(thresholds.size, 1)
})

test('Ein Grabstein wirkt auch auf Projekte', () => {
    const repos = buildRepos([repoEvent(REPO_D)])
    const projekt = ev({ kind: PROJECT_ANNOUNCEMENT, pubkey: OWNER, created_at: 1_000, tags: [['d', 'p'], ['a', REPO_ADDR]] })
    const grab = tombstone(`${PROJECT_ANNOUNCEMENT}:${OWNER}:p`, 2_000)

    assert.equal(buildProjects([projekt], repos).length, 1)
    assert.equal(buildProjects([projekt], repos, [grab]).length, 0)
})

// ── Kürzung ─────────────────────────────────────────────────────────────────

test('truncatedLists meldet GENAU die Listen, die am Limit ankamen', () => {
    const limits = { listLimit: 500, rootLimit: 200 }

    // Der Normalfall am Ziel-Relay: nichts ist am Anschlag, also kein Hinweis.
    assert.deepEqual(truncatedLists({ repos: 1, issues: 0, pulls: 0, ...limits }), [])

    // Exakt am Limit heißt „nicht beweisbar vollständig" — genau das schuldet
    // die Fläche dem Leser. Ein Hinweis erst bei 501 käme nie, weil der Relay
    // nie mehr als das Limit liefert.
    assert.deepEqual(truncatedLists({ repos: 500, issues: 0, pulls: 0, ...limits }), ['repos'])
    assert.deepEqual(truncatedLists({ repos: 0, issues: 200, pulls: 0, ...limits }), ['issues'])
    assert.deepEqual(truncatedLists({ repos: 0, issues: 0, pulls: 200, ...limits }), ['pulls'])
    assert.deepEqual(
        truncatedLists({ repos: 500, issues: 200, pulls: 200, ...limits }),
        ['repos', 'issues', 'pulls'],
    )

    // Und eins darunter: kein Hinweis. Ohne diesen Fall wäre `>=` von `>= 0`
    // nicht zu unterscheiden.
    assert.deepEqual(truncatedLists({ repos: 499, issues: 199, pulls: 199, ...limits }), [])
})

// ── NIP-34: der Statuswechsel eines MAINTAINERS ist gültig ──────────────────
//
// Bis zum 2026-08-23 liess `allowedActorsFor` nur Autor und Repo-Eigentümer zu. NIP-34
// sagt wörtlich, gültig sei der jüngste Status „from either the issue/patch author **or a
// maintainer**" — wir verwarfen den eines eingetragenen Maintainers also STILL: die Zeile
// blieb „offen", keine Meldung, kein Weg das zu bemerken.
//
// Die drei Fälle unten hängen zusammen und dürfen nicht getrennt werden. Der ERSTE ist
// die Negativkontrolle: ohne durchgereichte Maintainer-Liste muss der Status weiterhin
// verworfen werden. Ohne ihn wäre nicht gezeigt, dass der Test wirklich an der Liste hängt
// — er könnte grün sein, weil die Faltung gar nichts mehr prüft.

/** Jemand, der WEDER Autor noch Eigentümer ist — nur Maintainer. */
const NUR_MAINTAINER = '3'.repeat(64)

test('Maintainer-Status: OHNE durchgereichte Liste weiterhin verworfen (Kontrolle)', () => {
    const root = issueRoot()
    const s = status(GIT_STATUS_CLOSED, root.id, 300, NUR_MAINTAINER)

    // Der alte, engere Riegel — und er MUSS greifen, sonst prüft der Fall darunter nichts.
    assert.equal(foldStatus(root, [s]), null)
    assert.equal(toIssue(root, [s]).status, 'open')
})

test('Maintainer-Status: MIT Liste zählt er — das ist die NIP-34-Regel', () => {
    const root = issueRoot()
    const s = status(GIT_STATUS_CLOSED, root.id, 300, NUR_MAINTAINER)

    assert.equal(foldStatus(root, [s], [NUR_MAINTAINER])?.kind, GIT_STATUS_CLOSED)
    assert.equal(toIssue(root, [s], [], [NUR_MAINTAINER]).status, 'closed')

    // Grossschreibung darf nichts ändern: die Liste wird beim Aufnehmen normalisiert.
    assert.equal(foldStatus(root, [s], [NUR_MAINTAINER.toUpperCase()])?.kind, GIT_STATUS_CLOSED)
})

test('Maintainer-Status: ein FREMDER bleibt draussen, auch wenn eine Liste vorliegt', () => {
    const root = issueRoot()
    const s = status(GIT_STATUS_CLOSED, root.id, 300, FREMD)

    // Die Erweiterung darf den Riegel nicht aufmachen, sondern nur die berechtigte Menge
    // vergrössern. Ein Fremder ohne Eintrag bleibt ein Fremder.
    assert.equal(foldStatus(root, [s], [NUR_MAINTAINER]), null)
    assert.equal(toIssue(root, [s], [], [NUR_MAINTAINER]).status, 'open')
})

test('maintainerLookupFor: bekannte Adresse liefert die Liste, unbekannte eine leere', () => {
    const nachschlagen = maintainerLookupFor([
        { address: REPO_ADDR, maintainers: [NUR_MAINTAINER] },
    ])

    assert.deepEqual(nachschlagen(REPO_ADDR), [NUR_MAINTAINER])
    // Unbekannt heisst die alte, engere Menge — nicht ein Wurf und kein stiller Sonderweg.
    assert.deepEqual(nachschlagen(repoAddressOf(FREMD, 'gibt-es-nicht')), [])
})

// ── 1617: Patches ───────────────────────────────────────────────────────────

/**
 * Ein realistischer, kleiner `git format-patch`-Text.
 *
 * Die Signaturzeile endet auf `-- ` MIT Leerzeichen (byte-geprüft mit `cat -A`
 * an echter git-Ausgabe) und wird deshalb zusammengesetzt statt getippt —
 * jeder Formatierer, der Zeilenenden putzt, hätte den Fall sonst lautlos
 * entschärft. Die ausführliche Prüfung des Formats steht in `forgeDiff.test.ts`;
 * hier geht es nur darum, dass das MODELL Titel und Rohtext richtig führt.
 */
const PATCH_TEXT =
    `From abc Mon Sep 17 00:00:00 2001
From: Test <t@e.st>
Date: Sun, 23 Aug 2026 22:14:02 +0200
Subject: [PATCH 1/2] Ein Betreff der ueber die Faltgrenze laeuft und deshalb
 in einer zweiten Zeile weitergeht

Beschreibung des Patches.
---
 a.txt | 2 +-

diff --git a/a.txt b/a.txt
index f00189a..8686969 100644
--- a/a.txt
+++ b/a.txt
@@ -1,3 +1,3 @@
 eins
-zwei
+ZWEI
 drei
` + '--' + ' \n2.55.0\n'

const patchEv = (over: Partial<ForgeEvent> = {}): ForgeEvent =>
    ev({
        kind: GIT_PATCH,
        content: PATCH_TEXT,
        tags: [
            ['a', REPO_ADDR],
            ['r', 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'euc'],
            ['p', OWNER],
            ['t', 'root'],
            ['commit', 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'],
            ['parent-commit', 'cccccccccccccccccccccccccccccccccccccccc'],
        ],
        ...over,
    })

test('toPatch: der Titel kommt aus dem GEFALTETEN Subject-Header, nicht aus einem Tag', () => {
    // Das ist die ganze Pointe von kind 1617: es trägt kein `subject`-Tag
    // (`build_git_patch` setzt keines), also gibt es keinen anderen Weg zum
    // Titel. Käme hier die erste Header-Zeile allein, wäre der Titel ein Torso.
    const patch = toPatch(patchEv())
    assert.equal(
        patch.title,
        'Ein Betreff der ueber die Faltgrenze laeuft und deshalb in einer zweiten Zeile weitergeht',
    )
    assert.ok(!patch.title.includes('[PATCH'), 'Der Serien-Präfix steht noch im Titel.')
})

test('toPatch: der ROHE Patchtext bleibt erhalten — die Fläche liest ihn selbst', () => {
    // Würde das Modell hier schon parsen oder kürzen, gäbe es keinen Weg mehr
    // zum vollständigen Patch — und ein Patch, den man nicht mehr anwenden
    // kann, ist keiner.
    assert.equal(toPatch(patchEv()).content, PATCH_TEXT)
})

test('toPatch: Commit, Eltern-Commit und die Serien-Marker', () => {
    const patch = toPatch(patchEv())
    assert.equal(patch.commit, 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb')
    assert.equal(patch.parentCommit, 'cccccccccccccccccccccccccccccccccccccccc')
    assert.equal(patch.isRoot, true)
    assert.equal(patch.isRootRevision, false)
    assert.equal(patch.inReplyTo, '')
    assert.equal(patch.repoAddress, REPO_ADDR)
})

test('toPatch: der Vorgänger einer Serie steht im `e`-Tag mit Marker `reply`', () => {
    // Buzz setzt `["e", <vorgänger>, "", "reply"]` (`build_git_patch`). Ein
    // `e`-Tag OHNE diesen Marker ist etwas anderes und darf nicht als
    // Serienglied durchgehen.
    const mitVorgaenger = toPatch(
        patchEv({
            tags: [
                ['a', REPO_ADDR],
                ['e', 'd'.repeat(64), '', 'reply'],
                ['t', 'root-revision'],
            ],
        }),
    )
    assert.equal(mitVorgaenger.inReplyTo, 'd'.repeat(64))
    assert.equal(mitVorgaenger.isRootRevision, true)

    const ohneMarker = toPatch(
        patchEv({ tags: [['a', REPO_ADDR], ['e', 'd'.repeat(64)]] }),
    )
    assert.equal(ohneMarker.inReplyTo, '', 'Ein `e` ohne `reply`-Marker ist kein Serienglied.')
})

test('toPatch: ohne Subject-Header bleibt der Titel LEER statt englisch', () => {
    const patch = toPatch(patchEv({ content: 'diff --git a/x b/x\n' }))
    assert.equal(patch.title, '')
})

test('Patch-Status: 1631 heisst hier `applied`, nicht `merged` und nicht `resolved`', () => {
    // Dasselbe Kind, drei Flächen, drei Wörter — beim Patch ist die Handlung
    // das Anwenden (`git am`), nicht das Zusammenführen eines Branches.
    const root = patchEv()
    const status = ev({
        kind: GIT_STATUS_APPLIED,
        created_at: 2_000,
        tags: [['e', root.id], ['a', REPO_ADDR]],
    })
    assert.equal(toPatch(root, [status]).status, 'applied')
    assert.equal(toPatch(root, []).status, 'open', 'Ohne Status-Ereignis ist ein Patch offen.')
})

test('Patch-Status: ein `t`-Label ändert den Zustand NICHT', () => {
    // Beim PR gibt es die Ausnahme für `draft`; am Patch sind `root` und
    // `root-revision` die einzigen Labels, die Buzz setzt, und beide sagen
    // etwas über die Serie, nicht über den Lebenszyklus.
    const patch = toPatch(patchEv({ tags: [['a', REPO_ADDR], ['t', 'draft']] }))
    assert.equal(patch.status, 'open')
})

test('KONTROLLE Patch-Status: ein FREMDER darf einen Patch nicht schliessen', () => {
    const root = patchEv()
    const fremd = ev({
        kind: GIT_STATUS_CLOSED,
        pubkey: FREMD,
        created_at: 3_000,
        tags: [['e', root.id], ['a', REPO_ADDR]],
    })
    assert.equal(toPatch(root, [fremd]).status, 'open', 'Ein Fremdstatus wurde übernommen.')
})

test('Patch-Status: ein eingetragener MAINTAINER darf es — dieselbe NIP-34-Regel wie beim Issue', () => {
    // Der Riegel aus P2 muss auch hier greifen. Ohne durchgereichte Liste
    // bliebe derselbe Fehler an einer neuen Stelle bestehen: der Patch sähe
    // offen aus, obwohl ein Berechtigter ihn angewandt hat.
    const root = patchEv()
    const vomMaintainer = ev({
        kind: GIT_STATUS_APPLIED,
        pubkey: MAINTAINER,
        created_at: 3_000,
        tags: [['e', root.id], ['a', REPO_ADDR]],
    })
    assert.equal(
        toPatch(root, [vomMaintainer], [], []).status,
        'open',
        'KONTROLLE: ohne Liste bleibt er verworfen.',
    )
    assert.equal(toPatch(root, [vomMaintainer], [], [MAINTAINER]).status, 'applied')
})

test('buildPatches: filtert auf 1617, reicht die Maintainer je Repo durch und sortiert nach Bewegung', () => {
    const alt = patchEv({ created_at: 1_000 })
    const neu = patchEv({ created_at: 2_000 })
    const kommentar = ev({
        kind: FORGE_COMMENT,
        created_at: 5_000,
        tags: [['e', alt.id], ['a', REPO_ADDR]],
        content: 'dazu',
    })
    const fremdesKind = ev({ kind: GIT_ISSUE, tags: [['a', REPO_ADDR]] })

    const patches = buildPatches(
        [alt, neu, fremdesKind],
        [],
        [kommentar],
        maintainerLookupFor([{ address: REPO_ADDR, maintainers: [MAINTAINER] }]),
    )
    assert.equal(patches.length, 2, 'Ein fremdes Kind ist durchgerutscht.')
    // `alt` wurde durch den Kommentar zuletzt bewegt und steht deshalb oben.
    assert.deepEqual(patches.map((p) => p.id), [alt.id, neu.id])
    assert.equal(patches[0]?.commentCount, 1)
})

test('toRepo liest `relays`, `euc` und ALLE web-URLs — der Heuhaufen der Suche', () => {
    const repo = toRepo(
        ev({
            kind: REPO_ANNOUNCEMENT,
            tags: [
                ['d', REPO_D],
                ['name', REPO_D],
                // NIP-34 erlaubt mehrwertig UND wiederholt einwertig; ngit
                // schreibt die mehrwertige Form.
                ['web', 'https://eins.example', 'https://zwei.example'],
                ['web', 'https://drei.example'],
                ['relays', 'wss://a.example', 'wss://b.example'],
                ['r', 'a'.repeat(40), 'euc'],
                // Ein gewöhnliches `r` (Buzz setzt es am Patch für den Commit)
                // darf NICHT als euc durchgehen.
                ['r', 'b'.repeat(40)],
            ],
        }),
    )
    assert.ok(repo)
    assert.deepEqual(repo.webUrls, ['https://eins.example', 'https://zwei.example', 'https://drei.example'])
    assert.deepEqual(repo.relays, ['wss://a.example', 'wss://b.example'])
    assert.equal(repo.euc, 'a'.repeat(40))
    // Die Einzel-URL bleibt die erste — die Fläche zeigt genau einen Link.
    assert.equal(repo.webUrl, 'https://eins.example')
})

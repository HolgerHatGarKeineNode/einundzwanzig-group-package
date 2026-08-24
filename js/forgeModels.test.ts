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
    commentsForRoot,
    dedupeReplaceable,
    deletionThresholds,
    foldAssignments,
    foldRepoState,
    foldReviews,
    foldStatus,
    gruppiereNachRepo,
    isOperationNote,
    maintainerLookupFor,
    operationOf,
    reviewerRows,
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
const ZWEITER = '2'.repeat(64)
const DRITTER = '3'.repeat(64)
const COMMIT_A = 'a'.repeat(40)
const COMMIT_B = 'b'.repeat(40)
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

// ── Zuweisungen, Reviewer, Freigaben (P1) ───────────────────────────────────

/**
 * KERNBEWEIS 1 — der Zähler.
 *
 * `commentCount` wird als `comments.length` gesetzt; ein Test, der beide
 * gegeneinander hält, hält NICHTS fest. Deshalb steht hier die **literale** 1.
 *
 * Dieser Test war vor der Reparatur rot (`commentCount` lieferte 2) — gemessen
 * am 2026-08-24, bevor `commentsForRoot` den Label-Ausschluss bekam. Er ist
 * damit ein belegter Regressionsfall und keine Hypothese.
 */
test('KERNBEWEIS Zähler: die Zuweisungs-Notiz ist kein Kommentar — nicht in der Liste, nicht in der Zahl', () => {
    const root = ev({ kind: GIT_ISSUE, tags: [['a', REPO_ADDR], ['subject', 'Titel']] })
    const echt = ev({
        kind: FORGE_COMMENT,
        pubkey: MAINTAINER,
        created_at: 1_100,
        content: 'Ich schaue mir das an.',
        tags: [['e', root.id, '', 'root'], ['a', REPO_ADDR]],
    })
    const zuweisung = ev({
        kind: FORGE_COMMENT,
        pubkey: OWNER,
        created_at: 1_200,
        content: 'Assigned this issue to Bob',
        tags: [['e', root.id, '', 'root'], ['a', REPO_ADDR], ['p', MAINTAINER], ['t', 'assignment']],
    })

    const [issue] = buildIssues([root], [], [echt, zuweisung])

    // Beide Ausfallrichtungen einzeln — „assignees nicht leer" allein deckte nur eine.
    assert.deepEqual(issue.assignees, [MAINTAINER])
    assert.equal(issue.comments.length, 1)
    assert.equal(issue.comments[0].content, 'Ich schaue mir das an.')
    assert.equal(issue.commentCount, 1)
})

/**
 * KERNBEWEIS 2 — der Fehler war DREIFACH.
 *
 * Derselbe Ausschluss wirkt an allen drei Zählstellen, weil alle drei durch
 * `commentsForRoot` laufen. Gemessen vor dem Eingriff: Issue 3, PR 3, Patch 2.
 * Auch hier literale Zahlen — `comments.length` gegen `commentCount` zu halten
 * hielte nichts fest.
 */
test('KERNBEWEIS Zähler: dieselbe Korrektur an PR und Patch, nicht nur am Issue', () => {
    const pr = ev({ kind: GIT_PULL_REQUEST, tags: [['a', REPO_ADDR], ['subject', 'PR'], ['c', COMMIT_A]] })
    const prNotizen = [
        ev({ kind: FORGE_COMMENT, pubkey: MAINTAINER, created_at: 1_100, content: 'Sieht gut aus.', tags: [['e', pr.id, '', 'root'], ['a', REPO_ADDR]] }),
        ev({ kind: FORGE_COMMENT, pubkey: OWNER, created_at: 1_150, content: 'Requested a review', tags: [['e', pr.id, '', 'root'], ['a', REPO_ADDR], ['p', MAINTAINER], ['t', 'review-request']] }),
        ev({ kind: FORGE_COMMENT, pubkey: MAINTAINER, created_at: 1_200, content: 'Approved these changes', tags: [['e', pr.id, '', 'root'], ['a', REPO_ADDR], ['t', 'approval'], ['c', COMMIT_A]] }),
    ]
    assert.equal(buildPullRequests([pr], [], [], prNotizen)[0].commentCount, 1)

    const patch = ev({ kind: GIT_PATCH, content: 'Subject: [PATCH] x\n\n---\n', tags: [['a', REPO_ADDR]] })
    const patchNotizen = [
        ev({ kind: FORGE_COMMENT, pubkey: MAINTAINER, created_at: 1_100, content: 'Danke.', tags: [['e', patch.id, '', 'root'], ['a', REPO_ADDR]] }),
        ev({ kind: FORGE_COMMENT, pubkey: OWNER, created_at: 1_200, content: '', tags: [['e', patch.id, '', 'root'], ['a', REPO_ADDR], ['p', MAINTAINER], ['t', 'assignment']] }),
    ]
    assert.equal(buildPatches([patch], [], patchNotizen)[0].commentCount, 1)
})

/**
 * Die Regression, die der naive Fix erzeugt: fällt die Zuweisung aus
 * `comments`, verliert `updatedAt` sie mit — und die Liste sortiert plötzlich
 * anders, ohne dass ein Test es sieht. Eine Zuweisung IST Bewegung.
 */
test('updatedAt: eine Zuweisung zieht die Zeile weiter nach oben, obwohl sie kein Kommentar mehr ist', () => {
    const root = ev({ kind: GIT_ISSUE, created_at: 1_000, tags: [['a', REPO_ADDR]] })
    const zuweisung = ev({
        kind: FORGE_COMMENT,
        created_at: 9_000,
        tags: [['e', root.id, '', 'root'], ['a', REPO_ADDR], ['p', MAINTAINER], ['t', 'assignment']],
    })

    const [issue] = buildIssues([root], [], [zuweisung])

    assert.equal(issue.commentCount, 0)
    assert.equal(issue.updatedAt, 9_000)
})

// ── foldAssignments ─────────────────────────────────────────────────────────

const zuweisung = (
    root: ForgeEvent,
    over: { pubkey?: string; p: string[]; label?: string; created_at?: number; prior?: string[] },
): ForgeEvent =>
    ev({
        kind: FORGE_COMMENT,
        pubkey: over.pubkey ?? OWNER,
        created_at: over.created_at ?? 1_000,
        tags: [
            ['e', root.id, '', 'root'],
            ['a', REPO_ADDR],
            ...over.p.map((pubkey) => ['p', pubkey]),
            ['t', over.label ?? 'assignment'],
            ...(over.prior ?? []).map((value) => ['prior', value]),
        ],
    })

test('foldAssignments: der Autor darf jeden zuweisen, ein Fremder nur sich selbst', () => {
    const root = ev({ kind: GIT_ISSUE, tags: [['a', REPO_ADDR]] })

    // Autor/Eigentümer weist einen Dritten zu — gilt.
    assert.deepEqual(
        foldAssignments(root, [zuweisung(root, { p: [MAINTAINER] })]).assignees,
        [MAINTAINER],
    )
    // Ein Fremder zieht das Issue an sich — gilt ebenfalls (Selbstbedienung).
    assert.deepEqual(
        foldAssignments(root, [zuweisung(root, { pubkey: FREMD, p: [FREMD] })]).assignees,
        [FREMD],
    )
    // KONTROLLE: derselbe Fremde weist einen Dritten zu — zählt NICHT.
    assert.deepEqual(
        foldAssignments(root, [zuweisung(root, { pubkey: FREMD, p: [MAINTAINER] })]).assignees,
        [],
    )
    // KONTROLLE: und er hängt sich nicht als Alibi mit hinein — zwei `p` sind
    // keine Selbstbedienung, auch wenn einer davon der Signierer ist.
    assert.deepEqual(
        foldAssignments(root, [zuweisung(root, { pubkey: FREMD, p: [FREMD, MAINTAINER] })]).assignees,
        [],
    )
})

test('foldAssignments: ein eingetragener MAINTAINER darf zuweisen — unsere Abweichung von Buzz', () => {
    const root = ev({ kind: GIT_ISSUE, pubkey: FREMD, tags: [['a', REPO_ADDR]] })
    const notiz = zuweisung(root, { pubkey: MAINTAINER, p: [ZWEITER] })

    assert.deepEqual(foldAssignments(root, [notiz], [MAINTAINER]).assignees, [ZWEITER])
    // KONTROLLE: ohne die Maintainer-Liste ist derselbe Mensch ein Fremder.
    assert.deepEqual(foldAssignments(root, [notiz]).assignees, [])
})

test('foldAssignments: beide Label oder keins ist keine Operation — sie wird übersprungen, nicht geraten', () => {
    const root = ev({ kind: GIT_ISSUE, tags: [['a', REPO_ADDR]] })
    const beide = ev({
        kind: FORGE_COMMENT,
        tags: [['e', root.id, '', 'root'], ['a', REPO_ADDR], ['p', MAINTAINER], ['t', 'assignment'], ['t', 'unassignment']],
    })
    const keins = ev({
        kind: FORGE_COMMENT,
        tags: [['e', root.id, '', 'root'], ['a', REPO_ADDR], ['p', MAINTAINER]],
    })

    assert.deepEqual(foldAssignments(root, [beide, keins]).assignees, [])
})

/**
 * **Hier stand zuerst die naive Erwartung, und der Referenzparser hat sie
 * widerlegt** — der Test war rot, der Code nicht.
 *
 * Ein Selbst-Entzug OHNE `prior` verliert gegen eine autoritative Zuweisung,
 * auch wenn er später datiert ist: die unverkettete Selbstbedienung läuft in der
 * ERSTEN Phase, die autoritative Entscheidung danach
 * (`projectIssues.mjs:149-153`). Wer sich einer Zuweisung entziehen will, muss
 * sich auf sie berufen. Das ist keine Kuriosität, sondern der Kern des Aufbaus:
 * ein selbstgewählter Zeitstempel darf Autorität nicht aushebeln.
 */
test('foldAssignments: Entzug wirkt vom Autor; ein Selbst-Entzug braucht das `prior`', () => {
    const root = ev({ kind: GIT_ISSUE, tags: [['a', REPO_ADDR]] })
    const zu = zuweisung(root, { p: [MAINTAINER], created_at: 1_000 })

    // Der Autor nimmt seine eigene Zuweisung zurück — beides autoritativ, Zeit entscheidet.
    assert.deepEqual(
        foldAssignments(root, [zu, zuweisung(root, { p: [MAINTAINER], label: 'unassignment', created_at: 2_000 })])
            .assignees,
        [],
    )
    // Der Betroffene entzieht sich UNVERKETTET — die Autorität bleibt stehen.
    assert.deepEqual(
        foldAssignments(root, [
            zu,
            zuweisung(root, { pubkey: MAINTAINER, p: [MAINTAINER], label: 'unassignment', created_at: 2_000 }),
        ]).assignees,
        [MAINTAINER],
    )
    // Beruft er sich auf genau diese Zuweisung, kommt er heraus.
    assert.deepEqual(
        foldAssignments(root, [
            zu,
            zuweisung(root, {
                pubkey: MAINTAINER,
                p: [MAINTAINER],
                label: 'unassignment',
                created_at: 2_000,
                prior: [zu.id],
            }),
        ]).assignees,
        [],
    )
    // KONTROLLE: ein Unbeteiligter kann niemanden herauswerfen.
    assert.deepEqual(
        foldAssignments(root, [
            zu,
            zuweisung(root, { pubkey: FREMD, p: [MAINTAINER], label: 'unassignment', created_at: 2_000 }),
        ]).assignees,
        [MAINTAINER],
    )
})

/**
 * Die Rangfolge der drei Phasen — der Grund, warum das keine Sortierung ist.
 *
 * Die unverkettete Selbstzuweisung ist die ÄLTESTE Notiz und der autoritative
 * Entzug die jüngere; nach reiner Zeitordnung gewänne der Entzug ohnehin. Der
 * Test taugt deshalb erst mit umgekehrten Zeitstempeln: die Selbstzuweisung ist
 * hier die JÜNGERE und verliert trotzdem.
 */
test('foldAssignments: eine autoritative Entscheidung schlägt die unverkettete Selbstbedienung, auch die jüngere', () => {
    const root = ev({ kind: GIT_ISSUE, tags: [['a', REPO_ADDR]] })
    const autoritativ = zuweisung(root, { p: [FREMD], label: 'unassignment', created_at: 1_000 })
    const selbst = zuweisung(root, { pubkey: FREMD, p: [FREMD], created_at: 5_000 })

    assert.deepEqual(foldAssignments(root, [autoritativ, selbst]).assignees, [])
})

test('foldAssignments: mit `prior` auf genau diese Entscheidung überstimmt der Betroffene sie doch', () => {
    const root = ev({ kind: GIT_ISSUE, tags: [['a', REPO_ADDR]] })
    const autoritativ = zuweisung(root, { p: [FREMD], label: 'unassignment', created_at: 1_000 })
    const kausal = zuweisung(root, { pubkey: FREMD, p: [FREMD], created_at: 5_000, prior: [autoritativ.id] })

    assert.deepEqual(foldAssignments(root, [autoritativ, kausal]).assignees, [FREMD])
    // Und der Kopf zeigt danach auf die eigene Operation — das ist der Wert,
    // den ein nächstes `prior` tragen muss.
    assert.equal(foldAssignments(root, [autoritativ, kausal]).heads[FREMD], kausal.id)
})

test('foldAssignments: ein `prior`, das den Kopf nicht trifft, wirkt nicht', () => {
    const root = ev({ kind: GIT_ISSUE, tags: [['a', REPO_ADDR]] })
    const autoritativ = zuweisung(root, { p: [FREMD], label: 'unassignment', created_at: 1_000 })
    const daneben = zuweisung(root, { pubkey: FREMD, p: [FREMD], created_at: 5_000, prior: ['a'.repeat(64)] })

    assert.deepEqual(foldAssignments(root, [autoritativ, daneben]).assignees, [])
})

test('foldAssignments: zwei `prior` oder ein unsinniges `prior` fallen heraus statt eine Auswahl zu erfinden', () => {
    const root = ev({ kind: GIT_ISSUE, tags: [['a', REPO_ADDR]] })
    const autoritativ = zuweisung(root, { p: [FREMD], label: 'unassignment', created_at: 1_000 })
    const zweiPriors = zuweisung(root, {
        pubkey: FREMD,
        p: [FREMD],
        created_at: 5_000,
        prior: [autoritativ.id, 'a'.repeat(64)],
    })
    const muell = zuweisung(root, { pubkey: FREMD, p: [FREMD], created_at: 6_000, prior: ['nicht-hex'] })

    assert.deepEqual(foldAssignments(root, [autoritativ, zweiPriors, muell]).assignees, [])
})

/**
 * Die offene Frage des Plans, am Referenzparser beantwortet
 * (`projectIssues.mjs:150-163`): zwei Operationen mit demselben `prior`.
 * Die erste in der Zeitordnung gewinnt und verschiebt den Kopf; die zweite
 * findet ihn nicht mehr vor. Erster gewinnt, ohne Sonderregel.
 */
test('foldAssignments: beanspruchen zwei Operationen denselben `prior`, gewinnt die erste', () => {
    const root = ev({ kind: GIT_ISSUE, tags: [['a', REPO_ADDR]] })
    const autoritativ = zuweisung(root, { p: [FREMD], label: 'unassignment', created_at: 1_000 })
    const erste = zuweisung(root, { pubkey: FREMD, p: [FREMD], created_at: 5_000, prior: [autoritativ.id] })
    const zweite = zuweisung(root, {
        pubkey: FREMD,
        p: [FREMD],
        label: 'unassignment',
        created_at: 6_000,
        prior: [autoritativ.id],
    })

    const state = foldAssignments(root, [autoritativ, erste, zweite])
    assert.deepEqual(state.assignees, [FREMD])
    assert.equal(state.heads[FREMD], erste.id)
})

test('foldAssignments: ein `p`-Wert, der kein Schlüssel ist, wird nie zu einer Person', () => {
    const root = ev({ kind: GIT_ISSUE, tags: [['a', REPO_ADDR]] })
    const notiz = zuweisung(root, { p: ['nicht-hex', MAINTAINER] })

    assert.deepEqual(foldAssignments(root, [notiz]).assignees, [MAINTAINER])
})

// ── foldReviews ─────────────────────────────────────────────────────────────

const reviewNotiz = (
    root: ForgeEvent,
    over: { pubkey?: string; label: string; p?: string[]; commit?: string; created_at?: number },
): ForgeEvent =>
    ev({
        kind: FORGE_COMMENT,
        pubkey: over.pubkey ?? OWNER,
        created_at: over.created_at ?? 1_000,
        tags: [
            ['e', root.id, '', 'root'],
            ['a', REPO_ADDR],
            ...(over.p ?? []).map((pubkey) => ['p', pubkey]),
            ['t', over.label],
            ...(over.commit ? [['c', over.commit]] : []),
        ],
    })

test('foldReviews: Reviewer sind Wurzel-`p` plus vertraute Anfragen — ohne den Autor', () => {
    const root = ev({
        kind: GIT_PULL_REQUEST,
        pubkey: FREMD,
        tags: [['a', REPO_ADDR], ['c', COMMIT_A], ['p', MAINTAINER], ['p', FREMD]],
    })
    const anfrage = reviewNotiz(root, { label: 'review-request', p: [ZWEITER] })
    const fremdeAnfrage = reviewNotiz(root, { pubkey: DRITTER, label: 'review-request', p: [DRITTER] })

    const state = foldReviews(root, [anfrage, fremdeAnfrage], COMMIT_A)

    assert.deepEqual(state.reviewers.sort(), [MAINTAINER, ZWEITER].sort())
    // Der Autor steht im eigenen `p` — das ist Zustellung, keine Anfrage.
    assert.equal(state.reviewers.includes(FREMD), false)
    // KONTROLLE: wer sich selbst zum Reviewer erklärt, ist keiner.
    assert.equal(state.reviewers.includes(DRITTER), false)
})

test('foldReviews: eine Freigabe gilt für EINEN Commit — ein Push danach entwertet sie', () => {
    const root = ev({ kind: GIT_PULL_REQUEST, tags: [['a', REPO_ADDR], ['c', COMMIT_A], ['p', MAINTAINER]] })
    const freigabe = reviewNotiz(root, { pubkey: MAINTAINER, label: 'approval', created_at: 2_000 })

    // Die Freigabe erbt das `c` der Wurzel und passt.
    assert.equal(foldReviews(root, [freigabe], COMMIT_A).approvals.length, 1)
    // Nach einem Push zeigt der PR auf COMMIT_B — dieselbe Freigabe zählt nicht mehr.
    assert.equal(foldReviews(root, [freigabe], COMMIT_B).approvals.length, 0)
    // Ohne bekannten Commit gibt es GAR KEINE Entscheidungen, nicht etwa alle.
    assert.equal(foldReviews(root, [freigabe], '').approvals.length, 0)
    // Die Reviewer bleiben trotzdem sichtbar — sie hängen nicht am Commit.
    assert.deepEqual(foldReviews(root, [freigabe], '').reviewers, [MAINTAINER])
})

test('foldReviews: der Autor gibt seinen eigenen PR nicht frei, auch als Repo-Eigentümer', () => {
    const root = ev({ kind: GIT_PULL_REQUEST, pubkey: OWNER, tags: [['a', REPO_ADDR], ['c', COMMIT_A]] })
    const selbst = reviewNotiz(root, { pubkey: OWNER, label: 'approval' })

    assert.deepEqual(foldReviews(root, [selbst], COMMIT_A).approvals, [])
})

test('foldReviews: je Entscheider die JÜNGSTE Meinung — jemand darf sie ändern', () => {
    const root = ev({ kind: GIT_PULL_REQUEST, pubkey: FREMD, tags: [['a', REPO_ADDR], ['c', COMMIT_A], ['p', MAINTAINER]] })
    const zuerst = reviewNotiz(root, { pubkey: MAINTAINER, label: 'changes-requested', created_at: 2_000 })
    const danach = reviewNotiz(root, { pubkey: MAINTAINER, label: 'approval', created_at: 3_000 })

    const state = foldReviews(root, [zuerst, danach], COMMIT_A)

    assert.equal(state.approvals.length, 1)
    assert.equal(state.approvals[0].id, danach.id)
    assert.deepEqual(state.changeRequests, [])
})

test('foldReviews: ein Unbeteiligter kann nicht freigeben, der Repo-Eigentümer schon', () => {
    const root = ev({ kind: GIT_PULL_REQUEST, pubkey: FREMD, tags: [['a', REPO_ADDR], ['c', COMMIT_A]] })

    assert.deepEqual(foldReviews(root, [reviewNotiz(root, { pubkey: DRITTER, label: 'approval' })], COMMIT_A).approvals, [])
    assert.equal(
        foldReviews(root, [reviewNotiz(root, { pubkey: OWNER, label: 'approval' })], COMMIT_A).approvals.length,
        1,
    )
})

test('toPullRequest reicht Reviewer und Freigaben durch — mit dem Commit des jüngsten 1619', () => {
    const root = ev({ kind: GIT_PULL_REQUEST, tags: [['a', REPO_ADDR], ['c', COMMIT_A], ['p', MAINTAINER]] })
    const update = ev({
        kind: GIT_PR_UPDATE,
        created_at: 2_000,
        tags: [['E', root.id], ['a', REPO_ADDR], ['c', COMMIT_B]],
    })
    const alteFreigabe = reviewNotiz(root, { pubkey: MAINTAINER, label: 'approval', created_at: 1_500 })
    const neueFreigabe = reviewNotiz(root, {
        pubkey: MAINTAINER,
        label: 'approval',
        created_at: 3_000,
        commit: COMMIT_B,
    })

    const pr = toPullRequest(root, [update], [], [alteFreigabe, neueFreigabe])

    assert.equal(pr.commit, COMMIT_B)
    assert.deepEqual(pr.reviewers, [MAINTAINER])
    assert.equal(pr.approvals.length, 1)
    assert.equal(pr.approvals[0].id, neueFreigabe.id)
    assert.equal(pr.commentCount, 0)
})

// ── reviewerRows (Nachzug zu P1) ────────────────────────────────────────────

/**
 * Die Lücke, die dieser Aufbau schliesst: das Markup rechnete die Zuordnung
 * Reviewer→Entscheidung mit `.some()` selbst und kannte nur die ANGEFRAGTEN.
 * Wer freigibt, ohne angefragt worden zu sein — der Repo-Eigentümer darf das
 * ({@link foldReviews}, Regel 2) —, stand in keinem Chip.
 */
test('reviewerRows: angefragte zuerst, Entscheider ohne Anfrage danach', () => {
    const rows = reviewerRows(
        [MAINTAINER, ZWEITER],
        [{ id: 'a', author: OWNER, createdAt: 1, commit: COMMIT_A, decision: 'approved' }],
        [{ id: 'b', author: MAINTAINER, createdAt: 2, commit: COMMIT_A, decision: 'changes-requested' }],
    )

    assert.deepEqual(rows, [
        { pubkey: MAINTAINER, decision: 'changes-requested' },
        // Angefragt, aber noch nicht entschieden — die offene Erwartung bleibt
        // sichtbar und steht VOR dem ungefragten Entscheider.
        { pubkey: ZWEITER, decision: '' },
        { pubkey: OWNER, decision: 'approved' },
    ])
})

test('reviewerRows: ohne Reviewer und ohne Entscheidung bleibt die Zeile leer', () => {
    assert.deepEqual(reviewerRows([], [], []), [])
})

/**
 * Der Fall, den ein Nachschlagen in `RepoRow.people` still falsch beantwortet
 * hätte: ein Zugewiesener, der KEIN Maintainer des Repos ist. Jedes Mitglied
 * darf ein Issue an sich ziehen — die Faltung kennt ihn, die Maintainer-Liste
 * des Announcements nicht.
 */
test('foldAssignments: ein Zugewiesener muss kein Maintainer sein', () => {
    const repo = ev({ kind: REPO_ANNOUNCEMENT, tags: [['d', REPO_D], ['maintainers', MAINTAINER]] })
    const root = ev({ kind: GIT_ISSUE, tags: [['a', REPO_ADDR]] })
    const selbst = ev({
        kind: FORGE_COMMENT,
        pubkey: ZWEITER,
        tags: [['e', root.id, '', 'root'], ['a', REPO_ADDR], ['p', ZWEITER], ['t', 'assignment']],
    })

    const [gebaut] = buildRepos([repo])
    assert.equal(gebaut.maintainers.includes(ZWEITER), false, 'Vorbedingung: kein Maintainer')
    assert.deepEqual(foldAssignments(root, [selbst], gebaut.maintainers).assignees, [ZWEITER])
})

// ── operationOf ─────────────────────────────────────────────────────────────

test('operationOf: ein Label je Kategorie ergibt die Form, zwei Kategorien ergeben nichts', () => {
    // Mit `p`: die drei personennennenden Label brauchen es (Mindestform, siehe
    // `traegtOperation`), die beiden anderen stört es nicht.
    const mit = (...labels: string[]): ForgeEvent =>
        ev({ kind: FORGE_COMMENT, tags: [['p', MAINTAINER], ...labels.map((label) => ['t', label])] })

    assert.equal(operationOf(mit('assignment')), 'assignment')
    assert.equal(operationOf(mit('unassignment')), 'unassignment')
    assert.equal(operationOf(mit('review-request')), 'review-request')
    assert.equal(operationOf(mit('approval')), 'approval')
    assert.equal(operationOf(mit('changes-requested')), 'changes-requested')
    // Grosskleinschreibung zählt nicht — wie bei Buzz.
    assert.equal(operationOf(mit('Approval')), 'approval')
    // Ein fremdes Label daneben stört nicht: es ist keine der fünf Kategorien.
    assert.equal(operationOf(mit('approval', 'bug')), 'approval')

    assert.equal(operationOf(mit()), '')
    assert.equal(operationOf(mit('bug')), '')
    assert.equal(operationOf(mit('assignment', 'unassignment')), '')
    assert.equal(operationOf(mit('approval', 'changes-requested')), '')
    // Zwei Kategorien: keine Wahl treffen, die ein fremder Client bestimmt.
    assert.equal(operationOf(mit('review-request', 'approval')), '')
    assert.equal(operationOf(mit('assignment', 'approval')), '')
})

/**
 * `isOperationNote` und `operationOf` sind NICHT dasselbe, und der Unterschied
 * trägt: die widersprüchlich beschriftete Notiz ist kein Gesprächsbeitrag
 * (fliegt also aus `comments`) und zugleich kein benennbarer Vorgang. Wer im
 * Aktivitätsstrom `operationOf(…) === ''` als „ist ein Kommentar" liest, holt
 * genau sie als Kommentar zurück — beim Testen aufgefallen.
 */
test('isOperationNote ist weiter als operationOf — und genau darauf kommt es an', () => {
    const widerspruch = ev({
        kind: FORGE_COMMENT,
        tags: [['p', MAINTAINER], ['t', 'assignment'], ['t', 'unassignment']],
    })

    assert.equal(operationOf(widerspruch), '')
    assert.equal(isOperationNote(widerspruch), true)

    const root = ev({ kind: GIT_ISSUE, tags: [['a', REPO_ADDR]] })
    const notiz = ev({
        kind: FORGE_COMMENT,
        content: 'sieht aus wie ein Kommentar',
        tags: [
            ['e', root.id, '', 'root'],
            ['a', REPO_ADDR],
            ['p', MAINTAINER],
            ['t', 'assignment'],
            ['t', 'unassignment'],
        ],
    })
    assert.deepEqual(commentsForRoot(root.id, [notiz]), [])
})

/**
 * **Die Testlücke aus der Abnahme (2026-08-24).**
 *
 * `foldAssignments` prüft die Selbstbedienung bewusst auf der ROHEN `p`-Liste:
 * genau ein Tag, und es ist der Signierer. Wer vor dieser Prüfung zusätzlich mit
 * `isPubkey` filterte, machte aus `["p", <selbst>], ["p","müll"]` eine
 * Selbstbedienung — wir wären **großzügiger** als der Referenzparser statt
 * strenger. Die Eigenschaft war gebaut und dokumentiert, aber von keinem Test
 * gehalten: ein solcher Vorfilter liess alle Fälle grün.
 *
 * Dieser Test schliesst genau das. Er ist ohne die Eigenschaft rot.
 */
test('foldAssignments: der Selbstbedienungs-Riegel zählt die ROHEN `p`-Tags, nicht die brauchbaren', () => {
    const root = ev({ kind: GIT_ISSUE, tags: [['a', REPO_ADDR]] })
    const getarnt = ev({
        kind: FORGE_COMMENT,
        pubkey: FREMD,
        tags: [
            ['e', root.id, '', 'root'],
            ['a', REPO_ADDR],
            ['p', FREMD],
            // Ein zweiter, unbrauchbarer Wert. Würde er vor der Prüfung
            // weggefiltert, sähe die Notiz wie eine Selbstzuweisung aus.
            ['p', 'kein-schluessel'],
            ['t', 'assignment'],
        ],
    })

    assert.deepEqual(foldAssignments(root, [getarnt]).assignees, [])

    // KONTROLLE: mit nur dem einen Tag ist es eine echte Selbstzuweisung und
    // geht durch — der Riegel sperrt nicht pauschal.
    const echt = ev({
        kind: FORGE_COMMENT,
        pubkey: FREMD,
        tags: [['e', root.id, '', 'root'], ['a', REPO_ADDR], ['p', FREMD], ['t', 'assignment']],
    })
    assert.deepEqual(foldAssignments(root, [echt]).assignees, [FREMD])
})

/** F1 an der Quelle: der `p`-Tag eines 30618 ist Fremdeingabe wie jede andere. */
test('F1 toRepoState: ein `p`, das kein Schlüssel ist, ergibt KEINEN Handelnden', () => {
    const mit = (wert: string): ForgeEvent =>
        ev({ kind: REPO_STATE, tags: [['d', REPO_D], ['refs/heads/master', 'a'.repeat(40)], ['p', wert]] })

    assert.equal(toRepoState(mit('Bob')).actor, '')
    assert.equal(toRepoState(mit('refs/heads/master')).actor, '')
    assert.equal(toRepoState(mit('')).actor, '')
    // KONTROLLE: der echte Schlüssel kommt weiterhin an.
    assert.equal(toRepoState(mit(MAINTAINER)).actor, MAINTAINER)
})

/**
 * **Der Hashtag-Fall (Befund der Sicherheitsprüfung, 2026-08-24).**
 *
 * `assignment` ist ein gewöhnliches englisches Wort. Ein Client, der Hashtags in
 * `t`-Tags spiegelt, macht aus „#assignment noch offen" eine Notiz, die wie eine
 * Vorgangsform aussieht — und sie verschwände lautlos aus Liste, Zähler und
 * Leiste. Für die drei Label, bei denen das SDK selbst eine Mindestform erzwingt
 * (mindestens ein `p`, `builders.rs:1219-1223`), verlangen wir sie jetzt auch.
 *
 * Das schliesst die Kante nicht ganz — `approval` hat keine solche Invariante —,
 * und genau das steht als bewusst getragener Rest am Ort.
 */
test('Hashtag-Falle: `#assignment` ohne genannte Person bleibt ein gewöhnlicher Kommentar', () => {
    const root = ev({ kind: GIT_ISSUE, tags: [['a', REPO_ADDR]] })
    const hashtag = ev({
        kind: FORGE_COMMENT,
        pubkey: MAINTAINER,
        content: 'Das braucht noch ein #assignment.',
        tags: [['e', root.id, '', 'root'], ['a', REPO_ADDR], ['t', 'assignment']],
    })

    assert.equal(isOperationNote(hashtag), false)
    assert.equal(operationOf(hashtag), '')
    const [kommentar] = commentsForRoot(root.id, [hashtag])
    assert.equal(kommentar?.content, 'Das braucht noch ein #assignment.')
    assert.equal(toIssue(root, [], [hashtag]).commentCount, 1)

    // KONTROLLE: mit genannter Person ist es wieder eine Vorgangsform — die
    // Mindestform sperrt echte Zuweisungen nicht aus.
    const echt = ev({
        kind: FORGE_COMMENT,
        tags: [['e', root.id, '', 'root'], ['a', REPO_ADDR], ['p', MAINTAINER], ['t', 'assignment']],
    })
    assert.equal(isOperationNote(echt), true)
    assert.deepEqual(commentsForRoot(root.id, [echt]), [])
})

/**
 * Die verbleibende Kante, ausdrücklich festgehalten statt verschwiegen: für
 * `approval` gibt es keine Mindestform im SDK, also greift dort weiterhin das
 * blosse Label. Dieser Test hält den Ist-Zustand fest — schliesst jemand die
 * Kante später, wird er rot und zwingt zur bewussten Entscheidung.
 */
test('BEKANNTE KANTE: `#approval` ohne alles gilt weiterhin als Vorgangsform', () => {
    const hashtag = ev({ kind: FORGE_COMMENT, content: 'Wartet auf #approval.', tags: [['t', 'approval']] })

    assert.equal(isOperationNote(hashtag), true)
    assert.equal(operationOf(hashtag), 'approval')
})

// ── N1 an der Zweig-Anzeige: geteilter Name, relay-signierter Zustand ───────

const ZWEITER_OWNER = '7'.repeat(64)

/**
 * **Der Fall, den `foldRepoState` bis zum 2026-08-24 still auflöste.**
 *
 * Zwei Repositories gleichen Namens, zwei distinkte relay-signierte 30618.
 * `dedupeReplaceable` faltet sie auf ihre gemeinsame Koordinate
 * `(30618, relaySelf, d)` zusammen — zwei rein, einer raus — und die Anzeige
 * behauptete daraufhin für BEIDE denselben Zustand. Alice sah Bobs Commit,
 * ohne Marker, ohne zweiten Eintrag.
 *
 * Der Strom machte denselben Fehler zur selben Zeit SICHTBAR (zwei Zeilen, zwei
 * Schlüssel); diese Fläche löste ihn still auf. Zwei Politiken für dieselbe
 * Mehrdeutigkeit — und die sichere lag auf der unwichtigeren Fläche.
 */
test('N1: bei geteiltem `d` wird ein relay-signierter Zustand NICHT behauptet', () => {
    const vonAlice = ev({
        kind: REPO_STATE,
        pubkey: RELAY_SELF,
        created_at: 5_000,
        tags: [['d', REPO_D], ['refs/heads/master', '1'.repeat(40)], ['p', OWNER]],
    })
    const vonBob = ev({
        kind: REPO_STATE,
        pubkey: RELAY_SELF,
        created_at: 6_000,
        tags: [['d', REPO_D], ['refs/heads/master', '2'.repeat(40)], ['p', ZWEITER_OWNER]],
    })

    const state = foldRepoState([vonAlice, vonBob], {
        owner: OWNER,
        relaySelf: RELAY_SELF,
        dtag: REPO_D,
        dtagGeteilt: true,
    })

    assert.ok(state, 'kein Marker — die Fläche kann „nicht zuzuordnen" dann nicht sagen')
    assert.equal(state.ambiguous, true)
    // Und vor allem: KEIN fremder Commit wird behauptet.
    assert.deepEqual(state.branches, [])
    assert.equal(state.head, '')
})

/**
 * POSITIVKONTROLLE — ein fail-closed, das immer zumacht, ist kein Riegel.
 * Derselbe Bestand, aber der Name ist NICHT geteilt: der Zustand steht.
 */
test('N1 POSITIVKONTROLLE: ohne geteilten Namen bleibt der relay-signierte Zustand sichtbar', () => {
    const zustand = ev({
        kind: REPO_STATE,
        pubkey: RELAY_SELF,
        created_at: 5_000,
        tags: [['d', REPO_D], ['refs/heads/master', '1'.repeat(40)], ['p', OWNER]],
    })

    const state = foldRepoState([zustand], { owner: OWNER, relaySelf: RELAY_SELF, dtag: REPO_D })

    assert.ok(state)
    assert.equal(state.ambiguous, false)
    assert.deepEqual(state.branches, [{ name: 'master', commit: '1'.repeat(40) }])
})

/**
 * Die auflösbare Hälfte, auch bei geteiltem Namen: was der Eigentümer SELBST
 * signiert hat, ist eindeutig seins — und gilt, obwohl der relay-signierte
 * Zustand jünger ist. „Sicher und älter" schlägt „unsicher und neuer".
 */
test('N1: bei geteiltem `d` zählt der eigentümer-signierte Zustand — auch als älterer', () => {
    const selbstBezeugt = ev({
        kind: REPO_STATE,
        pubkey: OWNER,
        created_at: 5_000,
        tags: [['d', REPO_D], ['refs/heads/master', '1'.repeat(40)], ['p', OWNER]],
    })
    const jüngerVomRelay = ev({
        kind: REPO_STATE,
        pubkey: RELAY_SELF,
        created_at: 9_000,
        tags: [['d', REPO_D], ['refs/heads/master', '2'.repeat(40)], ['p', ZWEITER_OWNER]],
    })

    const state = foldRepoState([selbstBezeugt, jüngerVomRelay], {
        owner: OWNER,
        relaySelf: RELAY_SELF,
        dtag: REPO_D,
        dtagGeteilt: true,
    })

    assert.ok(state)
    assert.equal(state.ambiguous, false)
    assert.deepEqual(state.branches, [{ name: 'master', commit: '1'.repeat(40) }])
})

/**
 * Und die dritte Lage bleibt unterscheidbar: gibt es GAR NICHTS, ist die
 * Antwort `null` — nicht der Mehrdeutigkeits-Marker. Sonst zeigte die Fläche
 * „nicht zuzuordnen" über einen Zustand, den niemand je veröffentlicht hat.
 */
test('N1: ohne jeden Zustand bleibt die Antwort `null`, nicht „mehrdeutig"', () => {
    assert.equal(
        foldRepoState([], { owner: OWNER, relaySelf: RELAY_SELF, dtag: REPO_D, dtagGeteilt: true }),
        null,
    )
})

// ── Workspace-weite Gruppierung (P3) ────────────────────────────────────────

test('gruppiereNachRepo: Repo-Reihenfolge von aussen, Item-Reihenfolge erhalten, leere Gruppen weg', () => {
    const repos = [
        { address: 'a', name: 'Zebra' },
        { address: 'b', name: 'Anton' },
        { address: 'c', name: 'Ohne' },
    ]
    const items = [
        { repoAddress: 'b', id: 'b1' },
        { repoAddress: 'a', id: 'a1' },
        { repoAddress: 'b', id: 'b2' },
    ]

    const gruppen = gruppiereNachRepo(items, repos)

    // Die Reihenfolge ist die der REPOS (hier bewusst nicht alphabetisch) —
    // nicht die des ersten Treffers und nicht neu sortiert.
    assert.deepEqual(gruppen.map((g) => g.name), ['Zebra', 'Anton'])
    // Innerhalb der Gruppe bleibt die Eingabe-Reihenfolge stehen.
    assert.deepEqual(gruppen[1].items.map((i) => i.id), ['b1', 'b2'])
    // `Ohne` hat keine Vorgänge und erscheint nicht.
    assert.equal(gruppen.some((g) => g.name === 'Ohne'), false)
})

test('gruppiereNachRepo: eine unbekannte Koordinate erzeugt KEINE namenlose Gruppe', () => {
    const gruppen = gruppiereNachRepo(
        [{ repoAddress: 'fremd' }, { repoAddress: 'a' }],
        [{ address: 'a', name: 'Anton' }],
    )

    assert.equal(gruppen.length, 1)
    assert.equal(gruppen[0].items.length, 1)
})

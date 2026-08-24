/**
 * Die Zeitleiste — geprüft wird das, was sie zu einer Lüge machen würde:
 *
 *   1. **Nicht jedes 30618 ist ein Push.** Buzz schreibt beim Anlegen eines Repos
 *      ein leeres Ref-State-Ereignis; am Ziel-Relay stehen drei 30618 zu EINEM
 *      echten Push. Wer jedes zählt, behauptet zwei Handlungen, die niemand
 *      ausgeführt hat.
 *   2. **Der Pusher steht im `p`-Tag**, nicht im `pubkey` — das 30618 ist
 *      relay-signiert. Wer `pubkey` nimmt, schreibt jeden Push dem Relay zu.
 *   3. **Ohne auflösbare Wurzel keine Zeile.** „Jemand hat etwas kommentiert"
 *      ist Rauschen, kein Satz.
 *   4. **Unberechtigte Statuswechsel und PR-Updates erscheinen nicht** — sonst
 *      wäre die Leiste von jedem Relay-Mitglied beschreibbar.
 *
 * Ausführen:
 * node --experimental-strip-types --test packages/einundzwanzig-group/js/forgeActivity.test.ts
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildActivity } from './forgeActivity.ts'
import {
    FORGE_COMMENT,
    GIT_ISSUE,
    GIT_PATCH,
    GIT_PR_UPDATE,
    GIT_PULL_REQUEST,
    GIT_STATUS_CLOSED,
    REPO_ANNOUNCEMENT,
    REPO_STATE,
    buildRepos,
    repoAddressOf,
    type ForgeEvent,
} from './forgeModels.ts'

const OWNER = '0adf67475ccc5ca456fd3022e46f5d526eb0af6284bf85494c0dd7847f3e5033'
const RELAY_SELF = 'e699af6e6e9802ea253b18a8cbb8f816f8533708f08164469eba99f1ccacdf53'
const PUSHER = '40b87b4cc62aeb820b10b4e652b26ba7e6793933736185ee2b821dafa2683b49'
const FREMD = 'f'.repeat(64)
const REPO_D = 'einundzwanzig-verein'
const REPO_ADDR = repoAddressOf(OWNER, REPO_D)
const COMMIT = 'ca1c707b2d1f21849fca434d3683e238d1365e62'

let counter = 0
const ev = (partial: Partial<ForgeEvent> & { kind: number }): ForgeEvent => ({
    id: partial.id ?? String(counter++).padStart(64, '0'),
    pubkey: partial.pubkey ?? OWNER,
    kind: partial.kind,
    created_at: partial.created_at ?? 1_000,
    content: partial.content ?? '',
    tags: partial.tags ?? [],
})

const repoEvent = ev({
    kind: REPO_ANNOUNCEMENT,
    pubkey: OWNER,
    created_at: 1786792213,
    tags: [['d', REPO_D], ['name', REPO_D], ['description', 'Einundzwanzig Verein']],
})
const REPOS = buildRepos([repoEvent])

/** Die drei 30618, die am 2026-08-17 tatsächlich am Ziel-Relay lagen. */
const ECHTE_ZUSTAENDE: ForgeEvent[] = [
    ev({ kind: REPO_STATE, pubkey: RELAY_SELF, created_at: 1785499770, tags: [['d', REPO_D], ['HEAD', 'ref: refs/heads/main'], ['p', OWNER]] }),
    ev({ kind: REPO_STATE, pubkey: RELAY_SELF, created_at: 1785499821, tags: [['d', REPO_D], ['HEAD', 'ref: refs/heads/main'], ['p', PUSHER]] }),
    ev({
        kind: REPO_STATE,
        pubkey: RELAY_SELF,
        created_at: 1785499858,
        tags: [['d', REPO_D], ['refs/heads/master', COMMIT], ['HEAD', 'ref: refs/heads/master'], ['p', PUSHER]],
    }),
]

test('Drei 30618 am Ziel-Relay ergeben GENAU EINE Push-Zeile — die beiden leeren Ref-Zustände sind keine Handlung', () => {
    const items = buildActivity({ repos: REPOS, events: [repoEvent, ...ECHTE_ZUSTAENDE] })
    const pushes = items.filter((item) => item.type === 'push')

    assert.equal(pushes.length, 1)
    assert.equal(pushes[0].object, 'master')
    assert.equal(pushes[0].badge, 'ca1c707', 'Kurzhash wie im Referenzclient')
    assert.equal(pushes[0].actor, PUSHER, 'der `p`-Tag, NICHT der relay-signierte pubkey')
    assert.notEqual(pushes[0].actor, RELAY_SELF)
})

test('Die Repo-Zeile steht mit Name und Beschreibung; zusammen sind es zwei Zeilen, neueste zuerst', () => {
    const items = buildActivity({ repos: REPOS, events: [repoEvent, ...ECHTE_ZUSTAENDE] })

    assert.equal(items.length, 2)
    assert.equal(items[0].type, 'repo-created', 'das Announcement ist jünger als der Push')
    assert.equal(items[0].object, REPO_D)
    assert.equal(items[0].body, 'Einundzwanzig Verein')
    assert.ok(items[0].createdAt >= items[1].createdAt, 'absteigend nach created_at')
})

test('Ein zweiter Push auf denselben Branch mit NEUEM Commit ergibt eine zweite Zeile — mit demselben Commit keine', () => {
    const gleich = ev({ kind: REPO_STATE, pubkey: RELAY_SELF, created_at: 1785499900, tags: [['d', REPO_D], ['refs/heads/master', COMMIT], ['p', PUSHER]] })
    const neuer = ev({ kind: REPO_STATE, pubkey: RELAY_SELF, created_at: 1785499999, tags: [['d', REPO_D], ['refs/heads/master', 'b'.repeat(40)], ['p', PUSHER]] })

    const nurGleich = buildActivity({ repos: REPOS, events: [repoEvent, ...ECHTE_ZUSTAENDE, gleich] })
    assert.equal(nurGleich.filter((i) => i.type === 'push').length, 1, 'unveränderter Ref = kein Push')

    const mitNeuem = buildActivity({ repos: REPOS, events: [repoEvent, ...ECHTE_ZUSTAENDE, gleich, neuer] })
    assert.equal(mitNeuem.filter((i) => i.type === 'push').length, 2)
})

test('Issue, PR, PR-Update, Statuswechsel und Kommentar werden zu je einer Zeile mit auflösbarem Repo-Namen', () => {
    const issue = ev({ kind: GIT_ISSUE, id: 'i'.repeat(64), pubkey: PUSHER, created_at: 1786792300, content: 'Etwas klemmt', tags: [['a', REPO_ADDR]] })
    const pr = ev({ kind: GIT_PULL_REQUEST, id: 'p'.repeat(64), pubkey: PUSHER, created_at: 1786792400, tags: [['a', REPO_ADDR], ['subject', 'Fix'], ['c', COMMIT]] })
    const update = ev({ kind: GIT_PR_UPDATE, pubkey: PUSHER, created_at: 1786792500, tags: [['E', pr.id], ['c', 'd'.repeat(40)]] })
    const zu = ev({ kind: GIT_STATUS_CLOSED, pubkey: OWNER, created_at: 1786792600, tags: [['e', issue.id]] })
    const kommentar = ev({ kind: FORGE_COMMENT, pubkey: FREMD, created_at: 1786792700, content: 'Danke', tags: [['e', issue.id]] })

    const items = buildActivity({ repos: REPOS, events: [repoEvent, issue, pr, update, zu, kommentar] })
    const typen = items.map((item) => item.type)

    assert.deepEqual(typen, ['comment', 'issue-status', 'pr-updated', 'pr-opened', 'issue-opened', 'repo-created'])
    assert.ok(items.every((item) => item.repoAddress === '' || item.repoName === REPO_D))
    assert.equal(items[1].status, 'closed')
    assert.equal(items[2].badge, 'ddddddd')
    assert.equal(items[3].object, 'Fix')
    assert.equal(items[4].object, 'Etwas klemmt', 'Titel aus der ersten Inhaltszeile')
})

test('Ohne auflösbare Wurzel entsteht keine Zeile — auch nicht für Statuswechsel und Kommentare', () => {
    const verwaist = [
        ev({ kind: FORGE_COMMENT, pubkey: FREMD, created_at: 1786792800, tags: [['e', 'x'.repeat(64)]] }),
        ev({ kind: GIT_STATUS_CLOSED, pubkey: OWNER, created_at: 1786792900, tags: [['e', 'y'.repeat(64)]] }),
        ev({ kind: GIT_PR_UPDATE, pubkey: OWNER, created_at: 1786793000, tags: [['E', 'z'.repeat(64)]] }),
        ev({ kind: FORGE_COMMENT, pubkey: FREMD, created_at: 1786793100, content: 'ganz ohne Bezug' }),
    ]

    const items = buildActivity({ repos: REPOS, events: [repoEvent, ...verwaist] })
    assert.deepEqual(items.map((i) => i.type), ['repo-created'])
})

test('Ein Issue auf ein UNBEKANNTES Repo erscheint nicht — sonst flutet ein Fremder die Leiste', () => {
    const fremdesRepo = ev({ kind: GIT_ISSUE, pubkey: FREMD, created_at: 1786793200, tags: [['a', repoAddressOf(FREMD, 'nicht-unseres')]] })

    assert.deepEqual(
        buildActivity({ repos: REPOS, events: [repoEvent, fremdesRepo] }).map((i) => i.type),
        ['repo-created'],
    )
})

test('Unberechtigte Statuswechsel und PR-Updates erscheinen nicht in der Leiste', () => {
    const pr = ev({ kind: GIT_PULL_REQUEST, id: 'p'.repeat(64), pubkey: PUSHER, created_at: 1786793300, tags: [['a', REPO_ADDR], ['subject', 'X']] })
    const fremderStatus = ev({ kind: GIT_STATUS_CLOSED, pubkey: FREMD, created_at: 1786793400, tags: [['e', pr.id]] })
    const fremdesUpdate = ev({ kind: GIT_PR_UPDATE, pubkey: FREMD, created_at: 1786793500, tags: [['E', pr.id], ['c', 'e'.repeat(40)]] })

    const typen = buildActivity({ repos: REPOS, events: [repoEvent, pr, fremderStatus, fremdesUpdate] }).map((i) => i.type)
    assert.deepEqual(typen, ['pr-opened', 'repo-created'])
})

test('Leerer Bestand ergibt eine leere Leiste — und wirft nicht', () => {
    assert.deepEqual(buildActivity({ repos: [], events: [] }), [])
})

// ── Patches in der Spur (P5) ────────────────────────────────────────────────

/** Ein knapper, aber echt geformter `git format-patch`-Text. */
const PATCH_TEXT = `From ${COMMIT} Mon Sep 17 00:00:00 2001
From: Test <t@e.st>
Subject: [PATCH] Den Zaehler zuruecksetzen

---
diff --git a/a.txt b/a.txt
--- a/a.txt
+++ b/a.txt
@@ -1 +1 @@
-alt
+neu
`

const patchEvent = ev({
    kind: GIT_PATCH,
    created_at: 4_000,
    content: PATCH_TEXT,
    tags: [['a', REPO_ADDR], ['commit', COMMIT], ['t', 'root']],
})

test('ein 1617 erzeugt eine eigene Zeile — bis zum 2026-08-23 fehlte es ganz', () => {
    const spur = buildActivity({ repos: REPOS, events: [patchEvent] })
    const zeile = spur.find((item) => item.type === 'patch-opened')
    assert.ok(zeile, 'Kein `patch-opened` in der Spur — Patches sind unsichtbar.')
    assert.equal(zeile.repoAddress, REPO_ADDR)
    assert.equal(zeile.badge, COMMIT.slice(0, 7))
})

test('WÄCHTER: der Patch-Titel ist der Betreff, NICHT die erste Inhaltszeile', () => {
    // Ohne eigenen Titelweg fiele `rootTitle` auf die erste Zeile des Inhalts
    // zurück — und die lautet bei jedem `git format-patch`
    // „From <sha> Mon Sep 17 00:00:00 2001". Jede Patchzeile der Spur sähe
    // dann gleich aus, und keine sagte, worum es geht.
    const zeile = buildActivity({ repos: REPOS, events: [patchEvent] }).find(
        (item) => item.type === 'patch-opened',
    )
    assert.equal(zeile?.object, 'Den Zaehler zuruecksetzen')
    assert.ok(!zeile?.object.startsWith('From '), 'Der Git-Header ist als Titel durchgerutscht.')
})

test('der ROHE Patchtext landet nicht im Rumpf der Zeile', () => {
    // `body` ist die zweite Zeile einer Aktivitätszeile. Ein Diff darin wäre
    // Zeichensalat über die halbe Spur.
    const zeile = buildActivity({ repos: REPOS, events: [patchEvent] }).find(
        (item) => item.type === 'patch-opened',
    )
    assert.equal(zeile?.body, '')
})

test('ein Statuswechsel an einem Patch heisst `patch-status`, nicht `issue-status`', () => {
    const status = ev({
        kind: GIT_STATUS_CLOSED,
        created_at: 5_000,
        tags: [['e', patchEvent.id], ['a', REPO_ADDR]],
    })
    const spur = buildActivity({ repos: REPOS, events: [patchEvent, status] })
    const zeile = spur.find((item) => item.id === `status:${status.id}`)
    assert.equal(zeile?.type, 'patch-status')
    assert.equal(zeile?.status, 'closed')
    // Auch hier der Betreff, nicht der Git-Header.
    assert.equal(zeile?.object, 'Den Zaehler zuruecksetzen')
})

test('KONTROLLE: ein Patch auf ein UNBEKANNTES Repo erscheint nicht', () => {
    const fremd = ev({
        kind: GIT_PATCH,
        content: PATCH_TEXT,
        tags: [['a', repoAddressOf(FREMD, 'gibt-es-nicht')]],
    })
    const spur = buildActivity({ repos: REPOS, events: [fremd] })
    assert.equal(spur.filter((item) => item.type === 'patch-opened').length, 0)
})

test('KONTROLLE: ein fremder Statuswechsel an einem Patch zählt nicht', () => {
    const fremdStatus = ev({
        kind: GIT_STATUS_CLOSED,
        pubkey: FREMD,
        created_at: 6_000,
        tags: [['e', patchEvent.id], ['a', REPO_ADDR]],
    })
    const spur = buildActivity({ repos: REPOS, events: [patchEvent, fremdStatus] })
    assert.equal(spur.filter((item) => item.type === 'patch-status').length, 0)
})

test('ein Kommentar an einem Patch findet seine Wurzel', () => {
    // Ohne den Patch in der Wurzel-Landkarte fiele der Kommentar heraus —
    // „jemand hat etwas kommentiert" ohne Objekt ist Rauschen, und genau
    // deshalb verwirft die Spur wurzellose Ereignisse.
    const kommentar = ev({
        kind: FORGE_COMMENT,
        created_at: 7_000,
        content: 'passt',
        tags: [['e', patchEvent.id], ['a', REPO_ADDR]],
    })
    const spur = buildActivity({ repos: REPOS, events: [patchEvent, kommentar] })
    const zeile = spur.find((item) => item.id === `comment:${kommentar.id}`)
    assert.ok(zeile, 'Der Kommentar an einem Patch ist verschwunden.')
    assert.equal(zeile.object, 'Den Zaehler zuruecksetzen')
})

// ── Vorgangsformen im Strom (Nachzug zu P1) ─────────────────────────────────

const ZWEITER = '2'.repeat(64)
const issueRoot = ev({ kind: GIT_ISSUE, pubkey: OWNER, created_at: 2_000, tags: [['a', REPO_ADDR], ['subject', 'Titel']] })

const notiz = (over: {
    pubkey?: string
    label?: string
    p?: string[]
    content?: string
    created_at?: number
    root?: ForgeEvent
}): ForgeEvent =>
    ev({
        kind: FORGE_COMMENT,
        pubkey: over.pubkey ?? OWNER,
        created_at: over.created_at ?? 3_000,
        content: over.content ?? '',
        tags: [
            ['e', (over.root ?? issueRoot).id, '', 'root'],
            ['a', REPO_ADDR],
            ...(over.p ?? []).map((pubkey) => ['p', pubkey]),
            ...(over.label ? [['t', over.label]] : []),
        ],
    })

/**
 * RICHTUNG 1 — der Fehler, der repariert wurde.
 *
 * Bis zum Nachzug erzeugte eine Zuweisungsnotiz eine Zeile vom Typ `comment`,
 * und der Strom gab die englische Prosa eines fremden Clients als Äußerung des
 * Nutzers aus. Beide Hälften einzeln geprüft: KEIN Kommentar-Satz, und der
 * Fremdtext taucht in KEINEM `body` auf.
 */
test('Strom: eine Zuweisungsnotiz ist kein Kommentar-Satz — und ihr Fremdtext erscheint nirgends', () => {
    const items = buildActivity({
        repos: REPOS,
        events: [repoEvent, issueRoot, notiz({ label: 'assignment', p: [PUSHER], content: 'Assigned this issue to Bob' })],
    })

    assert.equal(items.some((item) => item.type === 'comment'), false)
    assert.equal(items.some((item) => item.body.includes('Assigned this issue')), false)
})

/**
 * RICHTUNG 2 — sie verschwindet aber auch NICHT.
 *
 * Die naheliegende Reparatur wäre gewesen, die Notizen aus dem Strom zu werfen.
 * Der Strom beantwortet „was ist hier passiert" — eine Zuweisung ist genau das,
 * und eine Lücke sieht niemand. Sie bekommt deshalb einen eigenen Satztyp und
 * nennt die Person, um die es geht.
 */
test('Strom: die Zuweisung bekommt einen EIGENEN Satz und nennt den Zugewiesenen', () => {
    const items = buildActivity({
        repos: REPOS,
        events: [repoEvent, issueRoot, notiz({ label: 'assignment', p: [PUSHER], content: 'Assigned this issue to Bob' })],
    })

    const zeile = items.find((item) => item.type === 'assignment')
    assert.ok(zeile, 'kein Satz vom Typ `assignment`')
    assert.equal(zeile.actor, OWNER)
    assert.deepEqual(zeile.targets, [PUSHER])
    assert.equal(zeile.object, 'Titel')
})

test('Strom: gewöhnliche Kommentare bleiben unverändert Kommentare', () => {
    const items = buildActivity({
        repos: REPOS,
        events: [repoEvent, issueRoot, notiz({ pubkey: PUSHER, content: 'Ich schaue mir das an.' })],
    })

    const zeile = items.find((item) => item.type === 'comment')
    assert.ok(zeile, 'kein Kommentar-Satz')
    assert.equal(zeile.body, 'Ich schaue mir das an.')
})

/**
 * Der Riegel, ohne den der Strom zur Gerüchteküche würde: ein
 * `["t","approval"]` ist ein gewöhnliches kind 1, der Relay prüft daran nichts.
 * Ohne dieselbe Vertrauensfrage wie in der Faltung stünde „X hat freigegeben"
 * in der Leiste, während die PR-Zeile daneben nichts davon anerkennt.
 */
test('Strom: eine Freigabe von einem Unbeteiligten erscheint NICHT', () => {
    const prRoot = ev({
        kind: GIT_PULL_REQUEST,
        pubkey: PUSHER,
        created_at: 2_000,
        tags: [['a', REPO_ADDR], ['subject', 'PR'], ['c', COMMIT], ['p', ZWEITER]],
    })
    const events = [repoEvent, prRoot]

    // KONTROLLE zuerst: der angefragte Reviewer kommt durch — sonst misst der
    // Negativfall unten womöglich gar nichts.
    const echt = buildActivity({
        repos: REPOS,
        events: [...events, notiz({ root: prRoot, pubkey: ZWEITER, label: 'approval' })],
    })
    assert.equal(echt.filter((item) => item.type === 'approval').length, 1)

    const gefaelscht = buildActivity({
        repos: REPOS,
        events: [...events, notiz({ root: prRoot, pubkey: FREMD, label: 'approval' })],
    })
    assert.equal(gefaelscht.filter((item) => item.type === 'approval').length, 0)
})

test('Strom: der Autor eines PR kann sich nicht selbst freigeben', () => {
    const prRoot = ev({
        kind: GIT_PULL_REQUEST,
        pubkey: OWNER,
        created_at: 2_000,
        tags: [['a', REPO_ADDR], ['subject', 'PR'], ['c', COMMIT]],
    })
    const items = buildActivity({
        repos: REPOS,
        events: [repoEvent, prRoot, notiz({ root: prRoot, pubkey: OWNER, label: 'approval' })],
    })

    assert.equal(items.some((item) => item.type === 'approval'), false)
})

test('Strom: eine Fremdzuweisung zählt nicht, eine Selbstzuweisung schon', () => {
    const fremd = buildActivity({
        repos: REPOS,
        events: [repoEvent, issueRoot, notiz({ pubkey: FREMD, label: 'assignment', p: [PUSHER] })],
    })
    assert.equal(fremd.some((item) => item.type === 'assignment'), false)

    const selbst = buildActivity({
        repos: REPOS,
        events: [repoEvent, issueRoot, notiz({ pubkey: FREMD, label: 'assignment', p: [FREMD] })],
    })
    assert.equal(selbst.filter((item) => item.type === 'assignment').length, 1)
})

test('Strom: eine Notiz mit zwei widersprüchlichen Labeln ergibt gar keinen Satz', () => {
    const beide = ev({
        kind: FORGE_COMMENT,
        created_at: 3_000,
        content: 'was auch immer',
        tags: [
            ['e', issueRoot.id, '', 'root'],
            ['a', REPO_ADDR],
            ['p', PUSHER],
            ['t', 'assignment'],
            ['t', 'unassignment'],
        ],
    })
    const items = buildActivity({ repos: REPOS, events: [repoEvent, issueRoot, beide] })

    // Weder Vorgang noch Kommentar: `operationOf` erkennt sie als Vorgangsform
    // (sie trägt die Label), kann sie aber nicht eindeutig einordnen.
    assert.equal(items.some((item) => item.type === 'assignment' || item.type === 'unassignment'), false)
    assert.equal(items.some((item) => item.type === 'comment'), false)
})

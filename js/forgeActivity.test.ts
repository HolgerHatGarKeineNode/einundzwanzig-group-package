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

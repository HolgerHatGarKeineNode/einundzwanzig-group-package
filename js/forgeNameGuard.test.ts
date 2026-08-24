/**
 * F1 — **der Riegel gegen den Wurf, der die ganze Seite mitreisst.**
 *
 * Diese Datei ist die einzige der Forge-Prüfstände, die welshman WIRKLICH lädt,
 * und das ist ihr Zweck. Die reinen Prüfstände (`forgeModels.test.ts`,
 * `forgeActivity.test.ts`) können nur behaupten, ein Wert sei „ein Schlüssel";
 * ob `nip19` ihn auch annimmt, weiss allein `nip19`. Genau in dieser Lücke lag
 * F1: der Wert sah in jedem Test harmlos aus und riss im Browser die Insel um.
 *
 * ── Was passiert, wenn der Riegel fehlt ─────────────────────────────────────
 *
 * `nameOf` (`forge.ts`) endet bei fehlendem kind 0 in `displayPubkey`, also in
 * `nip19.npubEncode` — und das WIRFT bei allem, was nicht hexadezimal ist. Der
 * Aufruf steht in einem `derived()`-Callback. Svelte hält seine
 * `subscriber_queue` modulweit; nach einem Wurf darin wird sie nie geleert, und
 * ab da liefert JEDER Store der Seite nichts mehr aus — auch solche, die mit der
 * Forge nichts zu tun haben. Die Insel ist bis zum Reload tot, und weil das
 * auslösende Ereignis am Relay liegen bleibt, ist sie es nach dem Reload wieder.
 *
 * Ausführen:
 * node --experimental-strip-types --test packages/einundzwanzig-group/js/forgeNameGuard.test.ts
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { displayPubkey } from '@welshman/util'
import { buildActivity } from './forgeActivity.ts'
import {
    FORGE_COMMENT,
    GIT_ISSUE,
    REPO_ANNOUNCEMENT,
    REPO_STATE,
    buildRepos,
    isPubkey,
    repoAddressOf,
    toRepoState,
    type ForgeEvent,
} from './forgeModels.ts'

const OWNER = '0adf67475ccc5ca456fd3022e46f5d526eb0af6284bf85494c0dd7847f3e5033'
const RELAY_SELF = 'e699af6e6e9802ea253b18a8cbb8f816f8533708f08164469eba99f1ccacdf53'
const REPO_D = 'einundzwanzig-verein'
const REPO_ADDR = repoAddressOf(OWNER, REPO_D)

let counter = 0
const ev = (partial: Partial<ForgeEvent> & { kind: number }): ForgeEvent => ({
    id: partial.id ?? String(counter++).padStart(64, '0'),
    pubkey: partial.pubkey ?? OWNER,
    kind: partial.kind,
    created_at: partial.created_at ?? 1_000,
    content: partial.content ?? '',
    tags: partial.tags ?? [],
})

/** Die Werte, die ein fremder Client in ein `p` schreiben kann. */
const GIFT = ['Bob', 'bob', 'refs/heads/master', 'npub1xyz', '0x' + 'a'.repeat(62), 'a'.repeat(63)]

/**
 * KALIBRIERUNG — ohne sie wüsste niemand, ob die Sonde überhaupt etwas berührt.
 *
 * Nimmt `nip19` diese Werte klaglos, wäre jede Zusicherung unten vakuum-grün.
 * Sie tut es nicht: der Wurf ist echt und reproduzierbar.
 */
test('KALIBRIERUNG: `displayPubkey` WIRFT bei einem Wert, der kein Schlüssel ist', () => {
    for (const wert of GIFT) {
        assert.throws(() => displayPubkey(wert), `„${wert}" hätte werfen müssen`)
    }
    // Gegenprobe: ein echter Schlüssel läuft durch — die Sonde misst nicht bloß
    // „alles wirft".
    assert.doesNotThrow(() => displayPubkey(OWNER))
})

/**
 * Der eigentliche Beweis: die Werte, die aus dem Modell herauskommen, dürfen
 * `displayPubkey` erreichen, ohne dass es wirft.
 *
 * **Bewusst gegen die echte Funktion geprüft und nicht gegen `isPubkey`.** Eine
 * Zusicherung `isPubkey(x) === true` prüfte den Riegel gegen sich selbst und
 * hielte gar nichts fest; hier entscheidet die Bibliothek, die im Browser wirft.
 */
const durchDieNamensaufloesung = (werte: string[]): void => {
    for (const wert of werte) {
        // Genau die Bedingung aus `nameOf` (`forge.ts`) — ein leerer Wert erreicht
        // `displayProfileByPubkey` nie.
        if (!isPubkey(wert)) {
            continue
        }
        assert.doesNotThrow(() => displayPubkey(wert), `„${wert}" kam durch den Riegel und wirft`)
    }
}

test('F1: ein 30618 mit `["p","Bob"]` erzeugt keinen Handelnden, der die Insel umreisst', () => {
    for (const gift of GIFT) {
        const repoEvent = ev({ kind: REPO_ANNOUNCEMENT, tags: [['d', REPO_D], ['name', REPO_D]] })
        const state = ev({
            kind: REPO_STATE,
            pubkey: RELAY_SELF,
            created_at: 2_000,
            tags: [['d', REPO_D], ['refs/heads/master', 'a'.repeat(40)], ['p', gift]],
        })

        // Erste Hälfte: die Faltung selbst gibt den Rohwert nicht weiter.
        assert.equal(toRepoState(state).actor, '', `toRepoState reichte „${gift}" durch`)

        // Zweite Hälfte: auch über die Leiste kommt nichts Werfendes heraus.
        const items = buildActivity({ relaySelf: RELAY_SELF, repos: buildRepos([repoEvent]), events: [repoEvent, state] })
        assert.ok(items.length > 0, 'keine Zeile — dann misst dieser Fall nichts')
        durchDieNamensaufloesung(items.map((item) => item.actor))
    }
})

test('F1: eine Zuweisungsnotiz mit unbrauchbarem `p` nennt niemanden, statt zu werfen', () => {
    const repoEvent = ev({ kind: REPO_ANNOUNCEMENT, tags: [['d', REPO_D], ['name', REPO_D]] })
    const root = ev({ kind: GIT_ISSUE, created_at: 2_000, tags: [['a', REPO_ADDR], ['subject', 'Titel']] })

    for (const gift of GIFT) {
        const notiz = ev({
            kind: FORGE_COMMENT,
            created_at: 3_000,
            tags: [['e', root.id, '', 'root'], ['a', REPO_ADDR], ['p', gift], ['t', 'assignment']],
        })
        const items = buildActivity({
            relaySelf: RELAY_SELF,
            repos: buildRepos([repoEvent]),
            events: [repoEvent, root, notiz],
        })

        const zeile = items.find((item) => item.type === 'assignment')
        assert.ok(zeile, `keine Zuweisungszeile für „${gift}" — dann misst dieser Fall nichts`)
        assert.deepEqual(zeile.targets, [], `„${gift}" blieb als genannte Person stehen`)
        durchDieNamensaufloesung([...(zeile.targets ?? []), zeile.actor])
    }
})

test('F1: ein gültiger Schlüssel kommt weiterhin durch — der Riegel sperrt nicht alles aus', () => {
    const repoEvent = ev({ kind: REPO_ANNOUNCEMENT, tags: [['d', REPO_D], ['name', REPO_D]] })
    const state = ev({
        kind: REPO_STATE,
        pubkey: RELAY_SELF,
        created_at: 2_000,
        tags: [['d', REPO_D], ['refs/heads/master', 'a'.repeat(40)], ['p', OWNER]],
    })
    const items = buildActivity({ relaySelf: RELAY_SELF, repos: buildRepos([repoEvent]), events: [repoEvent, state] })
    const push = items.find((item) => item.type === 'push')

    assert.ok(push, 'keine Push-Zeile')
    assert.equal(push.actor, OWNER)
    assert.doesNotThrow(() => displayPubkey(push.actor))
})

/**
 * **Der Kernbeweis von P6** — Vertragstest gegen das INSTALLIERTE welshman, mit dem
 * echten `repository` und dem echten `tracker`:
 *
 *   node --experimental-strip-types --test packages/einundzwanzig-group/js/articleMetricsStore.test.ts
 *
 * ── Die zwei Fragen, die nur hier beantwortet werden können ─────────────────────────
 *
 * 1. **Dedupliziert die Multi-Relay-Ableitung über die Event-Id?** Dieselbe Reaktion
 *    liegt auf drei Relays; sie darf einmal zählen, nicht dreimal.
 * 2. **Emittiert die Ableitung ein ZWEITES Mal, wenn Ereignisse NACH dem ersten Emit
 *    hereinkommen?** Das ist die Reaktivitäts-Falle, die diese Fläche schon einmal eine
 *    Phase gekostet hat (`deriveRoomChat`/`deriveThread` waren auf `#h` gefiltert und
 *    rechneten bei nachgeladenen Ereignissen nicht neu — die Oberfläche blieb stumm
 *    leer, obwohl die Daten im Store lagen).
 *
 * ── Warum ein Aufruf der reinen Funktion das nicht leisten kann ────────────────────
 *
 * Die Falle ist **kein Rechenfehler im Reduzierer, sondern ein fehlender Eingang im
 * Abhängigkeitsarray**. Ein Test, der `berechneArtikelMetriken` direkt aufruft, kann per
 * Konstruktion nicht sehen, dass der echte Aufrufer ein Argument nie nachliefert — er
 * bliebe grün, während die Fläche leer bleibt. Deshalb wird hier **abonniert**, jedes
 * Emit protokolliert und auf ein **zweites** assertiert.
 *
 * Und deshalb beginnt der Reaktivitätsfall mit einem **leeren** Bestand für seine
 * Adresse: hätte die Ableitung beim ersten Emit schon alles, wäre der Test auch dann
 * grün, wenn nie ein zweites käme.
 *
 * ── Die Grenze dieses Tests, ausdrücklich ──────────────────────────────────────────
 *
 * Geprüft wird die **Primitive** (`deriveEventsForUrls`) in derselben Komposition, die
 * `deriveArticles` fährt — nicht `deriveArticles` selbst. Das Modul `longformFeed.ts`
 * lässt sich unter `node --test` nicht laden (endungslose Importe, danach `localStorage`
 * beim Import von `session.ts`; die Herleitung steht in `longformFeed.test.ts`). Dass
 * die PRODUKTIVE Ableitung den Eingang wirklich im `derived([...])` stehen hat, prüft
 * `tests/e2e/article-metrics.spec.ts` im Host-Repo, indem es ein Ereignis NACH dem
 * ersten Render einspielt.
 */
import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { repository, tracker } from '@welshman/app'
import { normalizeRelayUrl, type TrustedEvent } from '@welshman/util'
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure'
import { get } from 'svelte/store'
import { deriveEventsForUrls } from './repository.ts'
import { artikelAdresse, berechneArtikelMetriken, type ArtikelMetriken } from './articleMetrics.ts'

const BOARD = normalizeRelayUrl('wss://board.test.invalid/')
const NOS = normalizeRelayUrl('wss://nos.test.invalid/')
const DAMUS = normalizeRelayUrl('wss://damus.test.invalid/')
const FREMD = normalizeRelayUrl('wss://fremd.test.invalid/')

const autorSecret = generateSecretKey()
const AUTOR = getPublicKey(autorSecret)

/**
 * Ein echt signiertes Ereignis. Nicht Zierde: `repository.publish` prüft über welshmans
 * `isEventValid` (Vorgabe `verifyEvent`) — ein handgeschriebenes Objekt käme gar nicht
 * erst in den Store und der Test wäre aus dem falschen Grund rot.
 */
const signiert = (kind: number, tags: string[][], content = '', secret = generateSecretKey()): TrustedEvent =>
    finalizeEvent({ kind, created_at: 1_700_000_000, tags, content }, secret) as unknown as TrustedEvent

/** Ein Ereignis in den Store legen und ihm eine Herkunft geben — der echte Netz-Pfad. */
const einspielen = (event: TrustedEvent, urls: string[]): void => {
    for (const url of urls) {
        tracker.track(event.id, url)
    }
    repository.publish(event)
}

describe('P6: die Multi-Relay-Ableitung der Artikel-Sozialsignale', () => {
    const relays = [BOARD, NOS, DAMUS]

    /**
     * `repository` kennt kein `clear()` (nur `removeEvent(idOrAddress)`), `tracker`
     * schon. Beide sind hier ohnehin frisch: dieser Prozess laedt `@welshman/app` zum
     * ersten Mal, und `node --test` faehrt jede Datei in einem eigenen Prozess. Der
     * Aufraeumer danach ist trotzdem da, damit ein spaeterer Import in DERSELBEN Datei
     * nichts erbt.
     */
    after(() => {
        for (const event of repository.dump()) {
            repository.removeEvent(event.id)
        }
        tracker.clear()
    })

    test('KERNBEWEIS 1 — dasselbe Ereignis von DREI Relays zaehlt EINMAL', () => {
        const adresse = artikelAdresse(AUTOR, 'dedup')
        // Ein einziges signiertes Ereignis, drei Herkuenfte. Genau so kommt es real
        // herein: der `#a`-REQ gegen nos.lol und der gegen damus liefern beide dieselbe
        // Reaktion, weil sie genau einmal signiert wurde.
        const reaktion = signiert(7, [['a', adresse]], '+')
        einspielen(reaktion, [BOARD, NOS, DAMUS])

        const ableitung = deriveEventsForUrls(relays, [{ kinds: [7] }])
        const events = get(ableitung)

        assert.equal(events.length, 1, 'drei Herkuenfte, ein Ereignis — sonst zaehlt die Flaeche dreifach')
        assert.equal(events[0]!.id, reaktion.id)

        // Und die Zahl, die daraus wird:
        const tabelle = berechneArtikelMetriken({
            adressen: [adresse],
            adresseVonId: new Map(),
            autorVonAdresse: new Map([[adresse, AUTOR]]),
            ereignisse: events,
            zapperVon: () => undefined,
        })
        assert.equal(tabelle.get(adresse)?.reaktionen, 1)
    })

    test('GEGENPROBE — ohne Deduplizierung waeren es drei', () => {
        // Die Zusage oben ist nur etwas wert, wenn der `tracker` die drei Herkuenfte
        // tatsaechlich fuehrt. Faellt DIESE Zeile, ist Kernbeweis 1 trivial gruen
        // geworden und sagt nichts mehr.
        const adresse = artikelAdresse(AUTOR, 'dedup')
        const [reaktion] = repository.query([{ kinds: [7], '#a': [adresse] }])

        assert.equal(tracker.getRelays(reaktion!.id).size, 3, 'der tracker muss alle drei Herkuenfte kennen')
    })

    test('ein Ereignis von einem NICHT gefragten Relay bleibt draussen', () => {
        const adresse = artikelAdresse(AUTOR, 'fremd-relay')
        einspielen(signiert(7, [['a', adresse]], '🔥'), [FREMD])

        const events = get(deriveEventsForUrls(relays, [{ kinds: [7], '#a': [adresse] }]))

        assert.deepEqual(events, [], 'die Ableitung ist auf die Herkunfts-URLs gescopet')
    })

    test('KERNBEWEIS 2 — ein NACH dem ersten Emit eingespieltes Ereignis loest ein ZWEITES Emit mit erhoehtem Zaehler aus', () => {
        const adresse = artikelAdresse(AUTOR, 'reaktivitaet')
        const eingang = deriveEventsForUrls(relays, [{ kinds: [7], '#a': [adresse] }])

        // Die Komposition, die `deriveArticles` fährt: die Ableitung als EINGANG, die
        // reine Funktion als Reduzierer. Protokolliert wird jedes Emit.
        const emits: ArtikelMetriken[] = []
        const abmelden = eingang.subscribe((events) => {
            const tabelle = berechneArtikelMetriken({
                adressen: [adresse],
                adresseVonId: new Map(),
                autorVonAdresse: new Map([[adresse, AUTOR]]),
                ereignisse: events,
                zapperVon: () => undefined,
            })
            emits.push(tabelle.get(adresse) ?? { reaktionen: 0, zaps: 0, sats: 0, kommentare: 0 })
        })

        try {
            // Der Ausgangszustand ist LEER — sonst waere der Test auch dann gruen, wenn
            // nie ein zweites Emit kaeme.
            assert.equal(emits.length, 1, 'ein Emit beim Abonnieren')
            assert.equal(emits[0]!.reaktionen, 0, 'Vorbedingung: noch kein Signal fuer diese Adresse')

            // Jetzt kommt das Netz — genau der Moment, den die Falle verschluckt.
            einspielen(signiert(7, [['a', adresse]], '+'), [NOS])

            assert.ok(emits.length >= 2, `kein zweites Emit — die Flaeche bliebe stumm leer (Emits: ${emits.length})`)
            assert.equal(emits.at(-1)!.reaktionen, 1, 'der Zaehler muss sich erhoeht haben, nicht nur neu gerechnet worden sein')

            // Und noch einmal, mit einem anderen Autor: der Zaehler zieht weiter nach.
            einspielen(signiert(7, [['a', adresse]], '🔥'), [DAMUS])

            assert.ok(emits.length >= 3, 'auch das dritte Ereignis muss ein Emit ausloesen')
            assert.equal(emits.at(-1)!.reaktionen, 2)
        } finally {
            abmelden()
        }
    })

    test('auch ein Kommentar mit NUR A loest ein Emit aus und wird gezaehlt', () => {
        // Die Union `#A`+`#a` ist eine Aussage ueber die REQ-Filter; hier steht die
        // andere Haelfte: dass die Ableitung ein so getaggtes Ereignis auch weiterreicht
        // und der Reduzierer es dem Artikel zuordnet.
        const adresse = artikelAdresse(AUTOR, 'nur-grosses-A')
        const eingang = deriveEventsForUrls(relays, [{ kinds: [1111] }])
        const emits: number[] = []
        const abmelden = eingang.subscribe((events) => {
            const tabelle = berechneArtikelMetriken({
                adressen: [adresse],
                adresseVonId: new Map(),
                autorVonAdresse: new Map([[adresse, AUTOR]]),
                ereignisse: events,
                zapperVon: () => undefined,
            })
            emits.push(tabelle.get(adresse)?.kommentare ?? 0)
        })

        try {
            assert.equal(emits.at(-1), 0)
            einspielen(
                signiert(1111, [
                    ['A', adresse],
                    // Der Elternteil ist ein KOMMENTAR, nicht der Artikel — genau die
                    // Form, die ein `#a`-only-Filter nicht findet.
                    ['a', '30023:ffff:ein-anderer-kommentar'],
                ]),
                [DAMUS],
            )

            assert.equal(emits.at(-1), 1, 'ein Kommentar mit nur `A` muss zaehlen')
        } finally {
            abmelden()
        }
    })
})

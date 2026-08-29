/**
 * **R1-Tor: das Zapper-Gate von 0.9.5 verlangt ein Feld, das es in NIP-57 nicht gibt.**
 *
 * Ausführen (läuft in `npm run test:unit` mit, Repo-Root):
 *   node --experimental-strip-types --test packages/einundzwanzig-group/js/welshmanZapperGate.test.ts
 *
 * ── Dieser Test ist ein ALARM, kein Beweis ─────────────────────────────────────────
 *
 * Anders als das R2-Tor (`js/welshmanParseBech32.test.ts`) hält er ein Verhalten fest,
 * das wir BEHALTEN wollen. Er ist heute grün, wird beim Sprung auf 0.9.5 rot und bleibt
 * es, **bis 0.9.6 erscheint**. Sein Rotwerden ist das Signal „die Zap-Fläche wartet noch",
 * und genau so steht es im Plan
 * (`docs/plans/2026-08-28T1950-welshman-0-9-sprung.md`, R1 · Scope „Out").
 *
 * **Was der Sprung mit dieser Datei getan hat:** Ebene A und C unverändert gelassen —
 * sie sind der Alarm und laufen weiter. In Ebene B ist der eine Fall übersprungen, den
 * 0.9.5 nicht mehr ausführbar macht; seine Begründung steht am Fall und verweist auf
 * 0.9.6. Wer eine Erwartung LOCKERT, um Grün zu sehen, hat den Alarm abgeschaltet und
 * nicht das Problem gelöst — das gilt unverändert.
 * **Was P4/eine spätere Phase damit tut:** nach dem Update auf 0.9.6 muss er von selbst
 * grün werden. Tut er das nicht, ist der Upstream-Fix nicht drin.
 *
 * ── Der Defekt, mit Zeile ──────────────────────────────────────────────────────────
 *
 * `@welshman/app@0.9.5`, `dist/app/src/plugins/zappers.js:21`:
 *
 *     if (info?.pubkey && info?.nostrPubkey) {
 *
 * `info` ist die **lnurl-pay-Antwort** des Empfänger-Servers (LUD-06/LUD-16, mit den
 * NIP-57-Zusätzen `allowsNostr`/`nostrPubkey`). Ein Feld `pubkey` gibt es dort nicht — in
 * keiner der drei Spezifikationen. Das Gate verwirft damit **jeden** Zapper, bevor unser
 * eigenes, korrektes `canZap` (`js/zaps.ts:281`, `allowsNostr && nostrPubkey`) ihn je zu
 * sehen bekommt. 0.8.16 hat an dieser Stelle gar kein Gate (`if (info)`).
 *
 * Der Fix steht auf `master` (`bebf008`, 2026-08-27, `allowsNostr && nostrPubkey`), ist
 * in **0.9.5 nicht enthalten**, und `master` trägt keinen Tag.
 *
 * ── Drei Ebenen, weil eine nicht reicht ────────────────────────────────────────────
 *
 * A **Datenform** — versionsunabhängig: die Antwort trägt `allowsNostr`+`nostrPubkey`
 *   und KEIN `pubkey`. Das ist die Tatsache, an der sich das Gate blamiert; sie gilt
 *   unabhängig davon, welche welshman-Fassung installiert ist.
 * B **Verhalten der Ladewege** — aus dieser Antwort wird ein brauchbarer Zapper
 *   (`canZap` sagt ja, `zapFromEvent` nimmt eine Quittung an).
 *
 *   **Seit dem Sprung auf 0.9.5 ist diese Ebene geteilt**, und zwar entlang dessen, was
 *   R1 wirklich trifft: der Fall über welshmans EIGENEN Lader ist **übersprungen** (mit
 *   Begründung am Fall), weil `fetchZapper`/`getZapper` dort nicht mehr existieren und
 *   der Ersatzweg per Konstruktion in das Gate läuft. Die Fälle über UNSEREN Weg
 *   (`loadZapperNow`, `canZap`, `zapFromEvent`) laufen weiter und sind grün — gemessen,
 *   nicht angenommen: unser Lader holt das Dokument selbst und geht an welshmans Gate
 *   vorbei.
 *
 *   Eine Datei, die schon an der Importzeile scheitert, wäre der schlechtere Alarm: sie
 *   vergiftet die Suite mit einer nichtssagenden Meldung und nimmt Ebene A und C mit.
 * C **Quelltext-Riegel auf die installierte `@welshman/app`** — versionsunabhängig und
 *   unabhängig von unserer Importfläche: der Zapper-Batchlader darf nicht auf `pubkey`
 *   prüfen. Diese Ebene überlebt den Sprung als lauffähiger Test und nennt den Defekt
 *   beim Namen, während B schon an der Importzeile scheitert.
 *
 * Ebene C ist ein Quelltext-Test und damit von Natur aus anfällig dafür, still blind zu
 * werden. Sie hat deshalb zwei Ankerprüfungen (der Lader wird GEFUNDEN, und er enthält
 * seinen Annahmezweig) und eine Positivkontrolle des Suchmusters gegen die wörtliche
 * 0.9.5-Zeile. Findet sie ihren Gegenstand nicht, wirft sie — sie überspringt nicht.
 *
 * ── Ein Befund am Rande, damit ihn P3 nicht neu suchen muss ───────────────────────
 *
 * Unser **heißer** Pfad geht gar nicht durch welshmans Lader: `loadZapperNow`
 * (`js/zaps.ts:249`) holt das LNURL-Dokument selbst und schreibt den Zapper direkt in
 * `zappersByLnurl` — bewusst, siehe die Begründung in `js/bridge.ts:7487-7507`
 * (Batcher-Defekt, Drosselung). Durch welshmans Lader läuft nur `resolveZapper`
 * (`js/zaps.ts:64` → `loadZapperForPubkey`), und das ruft heute keine Produktionsstelle
 * auf.
 *
 * **Nachgemessen beim Sprung — der Satz „der Weg ist ein anderer, die Sperre dieselbe"
 * stimmt so NICHT:** in 0.9.5 ist der Wert im Store zwar als `Zapper`-KLASSE typisiert,
 * aber `MapPlugin.set` nimmt am laufenden Paket gemessen jedes schlichte Objekt an
 * (kein `instanceof`-Zwang), und `get` gibt genau dieses Objekt zurück. Die Feldzugriffe,
 * auf denen `canZap`/`canPay` beruhen, funktionieren daran unverändert — die Fälle unten
 * belegen das. Was zur Laufzeit brechen WÜRDE, sind Klassenmethoden (`validate`,
 * `getResponseFilter`) auf einem solchen Objekt; die ruft unser Code nicht auf, und
 * `js/welshmanZapApi.ts` hebt den Zapper vorher in eine echte Instanz.
 *
 * R1 bleibt damit auf genau einen Weg beschränkt: `loadZapperForPubkey`. Der wirft seit
 * dem Sprung mit einer Meldung, die hierher zeigt, statt still `undefined` zu liefern.
 */
import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { getLnUrl } from '@welshman/util'
import { bech32ToHex } from '@welshman/lib'
import { zapFromEvent } from './welshmanZap.ts'
import { canZap, loadZapperNow } from './zaps.ts'

const hex = (c: string): string => c.repeat(64)

/** Der Server, der die Quittungen signiert (NIP-57 `nostrPubkey`). */
const NOSTR_PUBKEY = hex('e')
/** Der Empfänger des Zaps — ein ganz anderer Schlüssel, absichtlich. */
const EMPFAENGER = hex('c')
/** Der Absender. */
const ABSENDER = hex('d')

/**
 * **Eine realistische lnurl-pay-Antwort** (LUD-06 `payRequest` + LUD-12 `commentAllowed`
 * + LUD-16 `text/identifier` + die NIP-57-Zusätze). Feldnamen und -formen nach der
 * Spezifikation, nicht nach Gefühl — insbesondere gibt es **kein** `pubkey`.
 */
const LNURL_PAY_ANTWORT = {
    callback: 'https://example.test/lnurlp/zap/callback',
    maxSendable: 11_000_000_000,
    minSendable: 1_000,
    metadata: '[["text/identifier","zap@example.test"],["text/plain","Sats für zap"]]',
    commentAllowed: 255,
    tag: 'payRequest',
    allowsNostr: true,
    nostrPubkey: NOSTR_PUBKEY,
} as const

/** Dieselbe Antwort ohne die NIP-57-Zusätze — der Server kann keine Nostr-Zaps. */
const LNURL_PAY_OHNE_NOSTR = {
    callback: 'https://example.test/lnurlp/still/callback',
    maxSendable: 11_000_000_000,
    minSendable: 1_000,
    metadata: '[["text/plain","Sats für still"]]',
    tag: 'payRequest',
} as const

// ── Ebene A: die Datenform ──────────────────────────────────────────────────────────

describe('R1 · A · die Datenform einer NIP-57-lnurl-pay-Antwort', () => {
    test('sie trägt allowsNostr und nostrPubkey', () => {
        assert.equal(LNURL_PAY_ANTWORT.allowsNostr, true)
        assert.match(LNURL_PAY_ANTWORT.nostrPubkey, /^[0-9a-f]{64}$/)
    })

    test('KERNBEWEIS: sie trägt KEIN Feld `pubkey` — deshalb ist das 0.9.5-Gate falsch', () => {
        assert.equal('pubkey' in LNURL_PAY_ANTWORT, false)
        // Und die Gegenprobe zum `in`-Operator selbst, damit die Zeile darüber nicht
        // aus einem Tippfehler heraus wahr ist.
        assert.equal('nostrPubkey' in LNURL_PAY_ANTWORT, true)
    })

    test('die Vergleichsantwort ohne Nostr-Zusätze ist wirklich ohne sie', () => {
        assert.equal('allowsNostr' in LNURL_PAY_OHNE_NOSTR, false)
        assert.equal('nostrPubkey' in LNURL_PAY_OHNE_NOSTR, false)
    })
})

// ── Ebene B: das Verhalten der installierten Ladewege ───────────────────────────────

/**
 * Der einzige Baustein, der hier ersetzt wird, ist der **HTTP-Transport**. Alles
 * dahinter — Bech32-Auflösung, Batcher, Annahmezweig, Store-Schreiben, `canZap`,
 * `zapFromEvent` — läuft im Original. Die Attrappe entscheidet nichts über den
 * Prüfgegenstand; sie liefert nur die Antwort, die ein echter Server liefern würde, und
 * protokolliert die angefragte URL, damit belegt ist, dass sie am richtigen Punkt greift.
 */
const gerufeneUrls: string[] = []
let echterFetch: typeof globalThis.fetch

const stelleFetch = (nachDokument: Record<string, unknown> | undefined): void => {
    globalThis.fetch = (async (eingabe: unknown) => {
        gerufeneUrls.push(String(eingabe))
        if (!nachDokument) {
            throw new Error('Endpoint nicht erreichbar')
        }

        return { ok: true, status: 200, json: async () => nachDokument }
    }) as unknown as typeof globalThis.fetch
}

before(() => {
    echterFetch = globalThis.fetch
})

after(() => {
    globalThis.fetch = echterFetch
})

describe('R1 · B · aus dieser Antwort wird heute ein brauchbarer Zapper', () => {
    test('KALIBRIERUNG: die lnurl zeigt wirklich auf den erwarteten HTTPS-Endpoint', () => {
        // Ohne diese Zeile wäre nicht auszuschließen, dass der Lader eine ganz andere
        // Adresse anfragt und die Attrappe nur zufällig antwortet.
        const lnurl = getLnUrl('zap@example.test')
        assert.ok(lnurl !== undefined && lnurl.startsWith('lnurl1'), `getLnUrl lieferte ${String(lnurl)}`)
        assert.equal(bech32ToHex(lnurl), 'https://example.test/.well-known/lnurlp/zap')
    })

    test(
        'welshmans eigener Lader nimmt sie an — das ist die Stelle, die 0.9.5 zumacht',
        {
            skip:
                'R1 · abgeschaltet mit dem Sprung auf @welshman/app@0.9.5, nicht repariert. ' +
                'Dieser Fall prüfte welshmans EIGENEN Zapper-Lader über `fetchZapper`/`getZapper` — ' +
                'beide gibt es in 0.9.5 nicht mehr (dort: `app.use(Zappers)`), und der Ersatzweg ' +
                '`Zappers.loadForPubkey` läuft in genau das Gate, das dieser Test anprangert: ' +
                '`if (info?.pubkey && info?.nostrPubkey)` in `plugins/zappers.js:21`. Ihn auf den ' +
                'neuen Weg umzuschreiben hiesse, einen Fall zu bauen, der per Konstruktion rot ist ' +
                'und nichts Neues sagt — den Defekt hält Ebene C fest, dauerhaft und lauffähig. ' +
                'Der Fix steht upstream auf master (bebf008) und kommt mit 0.9.6; DANN ist dieser ' +
                'Fall auf `app.use(Zappers).load(lnurl)` umzuschreiben und wieder scharfzustellen.',
        },
        () => {},
    )

    test('unser eigener Lader (`loadZapperNow`) ebenso — der Weg, den die Fläche wirklich geht', async () => {
        const lnurl = getLnUrl('unser-weg@example.test')!
        gerufeneUrls.length = 0
        stelleFetch({ ...LNURL_PAY_ANTWORT })

        const zapper = await loadZapperNow(lnurl)

        assert.ok(zapper, 'loadZapperNow hat nichts geliefert')
        assert.equal(canZap(zapper), true, 'canZap verweigert einen Zapper, der allowsNostr und nostrPubkey trägt')
        assert.deepEqual(gerufeneUrls, [bech32ToHex(lnurl)])
    })

    test('GEGENPROBE: ohne die NIP-57-Zusätze sagt `canZap` nein', async () => {
        // Ohne diesen Fall wäre „canZap === true" oben keine Aussage über die Felder,
        // sondern nur darüber, dass `canZap` irgendetwas zurückgibt.
        const lnurl = getLnUrl('ohne-nostr@example.test')!
        stelleFetch({ ...LNURL_PAY_OHNE_NOSTR })

        const zapper = await loadZapperNow(lnurl)

        assert.ok(zapper, 'das Dokument ist gültiges LUD-06 und muss geladen werden')
        assert.equal(canZap(zapper), false)
    })

    test('und die Quittung dieses Servers wird angenommen — „brauchbar" heißt genau das', async () => {
        const lnurl = getLnUrl('quittung@example.test')!
        stelleFetch({ ...LNURL_PAY_ANTWORT })
        const zapper = await loadZapperNow(lnurl)
        assert.ok(zapper)

        const zap = zapFromEvent(quittung(zapper.lnurl!, NOSTR_PUBKEY), zapper)

        assert.ok(zap, 'zapFromEvent hat die Quittung verworfen')
        assert.equal(zap.invoiceAmount, 21_000)
        assert.equal(zap.request.pubkey, ABSENDER)
    })

    test('GEGENPROBE: eine Quittung von einem FREMDEN Signierer wird verworfen', async () => {
        // Sonst hinge die Zusage oben nur daran, dass `zapFromEvent` überhaupt etwas
        // zurückgibt — die Prüfung gegen `nostrPubkey` bliebe ungemessen.
        const lnurl = getLnUrl('fremd@example.test')!
        stelleFetch({ ...LNURL_PAY_ANTWORT })
        const zapper = await loadZapperNow(lnurl)
        assert.ok(zapper)

        assert.equal(zapFromEvent(quittung(zapper.lnurl!, hex('f')), zapper), undefined)
    })
})

/** Eine kind-9735-Quittung (NIP-57) über 21 sat, signiert von `signierer`. */
const quittung = (lnurl: string, signierer: string) => ({
    id: hex('1'),
    pubkey: signierer,
    created_at: 1_756_000_000,
    kind: 9735,
    sig: hex('2'),
    content: '',
    tags: [
        ['p', EMPFAENGER],
        ['bolt11', 'lnbc210n1pexampleinvoice'],
        [
            'description',
            JSON.stringify({
                id: hex('3'),
                pubkey: ABSENDER,
                created_at: 1_756_000_000,
                kind: 9734,
                sig: hex('4'),
                content: '⚡',
                tags: [
                    ['relays', 'wss://relay.example/'],
                    ['amount', '21000'],
                    ['lnurl', lnurl],
                    ['p', EMPFAENGER],
                ],
            }),
        ],
    ],
})

// ── Ebene C: der Quelltext-Riegel auf die installierte @welshman/app ────────────────

/**
 * Nur für die KALIBRIERUNG dieses Riegels: ein anderes `dist`-Verzeichnis messen (etwa
 * den entpackten 0.9.5-Tarball). Ist die Variable gesetzt, macht {@link KALIBRIERMODUS}
 * den Lauf absichtlich rot — ein Lauf im Kalibriermodus ist kein Nachweis, und das soll
 * niemand versehentlich für einen halten.
 */
const KALIBRIER_DIST = process.env.W_APP_DIST_KALIBRIERUNG

/** Der Batchlader in beiden Fassungen — Dateiname und Pfad haben sich geändert, diese Zeile nicht. */
const LADER_ANKER = 'lnurls.filter(lnurl => lnurl.startsWith("lnurl1"))'
/** Der Zweig, in dem der Lader einen Zapper ANNIMMT. */
const ANNAHME_ANKER = 'result.set(lnurl'
/** Das Muster für den Defekt: eine Bedingung an einem `pubkey`-Feld der lnurl-pay-Antwort. */
const DEFEKT = /info\s*\??\.\s*pubkey/

/** Die wörtliche 0.9.5-Zeile — Positivkontrolle, damit {@link DEFEKT} nicht tot ist. */
const ZEILE_0_9_5 = '            if (info?.pubkey && info?.nostrPubkey) {'

const jsDateien = (verzeichnis: string): string[] => {
    const raus: string[] = []
    for (const name of readdirSync(verzeichnis)) {
        const pfad = join(verzeichnis, name)
        if (statSync(pfad).isDirectory()) {
            raus.push(...jsDateien(pfad))
        } else if (name.endsWith('.js')) {
            raus.push(pfad)
        }
    }

    return raus
}

const distVerzeichnis = (): string => {
    if (KALIBRIER_DIST) {
        assert.ok(existsSync(KALIBRIER_DIST), `W_APP_DIST_KALIBRIERUNG zeigt auf ${KALIBRIER_DIST} — das gibt es nicht`)

        return KALIBRIER_DIST
    }
    const pfad = createRequire(import.meta.url).resolve('@welshman/app/package.json')
    const dist = join(dirname(pfad), 'dist')
    assert.ok(existsSync(dist), `Kein dist-Verzeichnis unter ${dist} — dieser Riegel misst dann nichts`)

    return dist
}

/** Die EINE Datei, in der der Zapper-Batchlader steht. Wirft, wenn sie nicht eindeutig ist. */
const laderDatei = (): { pfad: string; quelle: string } => {
    const treffer = jsDateien(distVerzeichnis())
        .map((pfad) => ({ pfad, quelle: readFileSync(pfad, 'utf8') }))
        .filter(({ quelle }) => quelle.includes(LADER_ANKER))

    assert.equal(
        treffer.length,
        1,
        `Erwartet: genau EINE Datei mit dem Zapper-Batchlader (Anker: ${LADER_ANKER}), gefunden: ${treffer.length}. ` +
            'Hat welshman den Lader umgebaut, misst dieser Riegel nichts mehr — dann ist der Anker nachzuziehen, ' +
            'nicht der Riegel zu entfernen.',
    )

    return treffer[0]!
}

describe('R1 · C · der installierte Zapper-Lader verlangt kein `pubkey`', () => {
    test('KALIBRIERMODUS ist aus', () => {
        assert.equal(
            KALIBRIER_DIST,
            undefined,
            `W_APP_DIST_KALIBRIERUNG=${String(KALIBRIER_DIST)} ist gesetzt: dieser Lauf misst ein FREMDES dist-Verzeichnis ` +
                'und ist kein Nachweis über die installierte Fassung.',
        )
    })

    test('KALIBRIERUNG: das Suchmuster trifft die wörtliche 0.9.5-Zeile', () => {
        // Ohne diese Zeile könnte DEFEKT still zu einem Muster werden, das nichts mehr
        // findet — der Riegel wäre dann für immer grün.
        assert.match(ZEILE_0_9_5, DEFEKT)
        assert.doesNotMatch('            if (info?.allowsNostr && info?.nostrPubkey) {', DEFEKT)
    })

    test('ANKER: der Lader wird gefunden und enthält seinen Annahmezweig', () => {
        const { pfad, quelle } = laderDatei()
        assert.ok(quelle.includes(ANNAHME_ANKER), `${pfad} enthält den Annahmezweig (${ANNAHME_ANKER}) nicht — der Riegel misst die falsche Stelle`)
    })

    test('KERNBEWEIS: kein Ladepfad gatet auf einem `pubkey`-Feld der lnurl-pay-Antwort', () => {
        const { pfad, quelle } = laderDatei()
        const zeilen = quelle.split('\n').filter((zeile) => DEFEKT.test(zeile))

        assert.deepEqual(
            zeilen.map((z) => z.trim()),
            [],
            `${pfad} verwirft Zapper anhand eines Feldes \`pubkey\`, das eine NIP-57-lnurl-pay-Antwort nicht hat ` +
                '(LUD-06/LUD-16 kennen es nicht). Das ist der Upstream-Defekt aus R1: in 0.9.5 vorhanden, auf `master` ' +
                'mit `bebf008` behoben (`allowsNostr && nostrPubkey`), aber ohne Tag. Solange dieser Fall rot ist, ' +
                'ist die Zap-Fläche blockiert — sie wartet auf 0.9.6. NICHT durch Lockern dieser Zusage beheben.',
        )
    })
})

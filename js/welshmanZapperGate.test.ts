/**
 * **R1 latch: the zapper gate 0.9.5 shipped asked for a field NIP-57 does not have.**
 *
 * Run (part of `npm run test:unit`, repo root):
 *   node --experimental-strip-types --test packages/einundzwanzig-group/js/welshmanZapperGate.test.ts
 *
 * ── This file is an ALARM, not a proof ─────────────────────────────────────────────
 *
 * Unlike the R2 latch (`js/welshmanParseBech32.test.ts`) it pins behaviour we want to
 * KEEP. It was green on 0.8.16, went red with the jump to 0.9.5, and stayed red until the
 * upstream fix shipped — its going red was the signal "the zap surface is still waiting",
 * and that is exactly how the plan described it
 * (`docs/plans/2026-08-28T1950-welshman-0-9-sprung.md`, R1 · scope "Out").
 * Whoever LOOSENS an expectation here to see green has switched the alarm off instead of
 * fixing the problem. That sentence stood here while the latch was red and it is repeated
 * now that it is green, because it is the only reason a green run means anything: not one
 * expectation below was weakened when the pins moved.
 *
 * ── Where this stands: 2026-09-11, `@welshman/*` 0.9.5 → 0.9.9 ────────────────────
 *
 * The fix is in. Measured on the INSTALLED package, not read from a changelog —
 * `@welshman/app@0.9.9`, `dist/app/src/plugins/zappers.js:22`:
 *
 *     if (info?.allowsNostr && info?.nostrPubkey) {
 *
 * and `grep -rn 'info?.pubkey'` over both installed welshman trees returns nothing.
 * Level C therefore went green because its subject changed, not because its assertion did:
 * pattern, anchors and the positive control against the literal 0.9.5 line are unchanged.
 *
 * What actually moved between the two pins was measured by diffing the published tarballs
 * of all nine packages: the zapper gate is the ONLY change that touches this file's
 * subject. (The other three: `relayTags` now normalises its URLs, a thunk abort check in
 * the NIP-59 branch, and a rewritten socket lifecycle policy in `@welshman/net` — that
 * last one drops `socketPolicyPing` and renames `socketPolicyCloseInactive` to
 * `socketPolicyLifecycle`, neither of which this repo imports.)
 *
 * **What this bump did NOT do, and it is due work.** `js/welshmanZapApi.ts` still makes
 * `loadZapperForPubkey` THROW, and its message names 0.9.5 and the `info.pubkey` gate as
 * the reason. That reason is gone. The block is ours alone now, so `resolveZapper`
 * (`js/zaps.ts`) and with it the zapper-less branch of `createZapInvoice` stay dead until
 * someone removes the throw and covers `Zappers.loadForPubkey` with a case of its own.
 * Reported with this bump, deliberately not done inside it.
 *
 * ── The defect, with its line — kept as the historical record ──────────────────────
 *
 * `@welshman/app@0.9.5`, `dist/app/src/plugins/zappers.js:21`:
 *
 *     if (info?.pubkey && info?.nostrPubkey) {
 *
 * `info` is the recipient server's **lnurl-pay response** (LUD-06/LUD-16 with the NIP-57
 * additions `allowsNostr`/`nostrPubkey`). There is no `pubkey` field there — in none of
 * the three specifications. The gate discarded **every** zapper before our own, correct
 * `canZap` (`js/zaps.ts`, `allowsNostr && nostrPubkey`) ever saw one. 0.8.16 had no gate
 * at that spot at all (`if (info)`).
 *
 * The fix sat on `master` as `bebf008` (2026-08-27, `allowsNostr && nostrPubkey`), was not
 * in 0.9.5, and `master` carried no tag then. It was published as 0.9.6 on 2026-09-01.
 *
 * ── Three levels, because one is not enough ────────────────────────────────────────
 *
 * A **data shape** — version independent: the response carries `allowsNostr` and
 *   `nostrPubkey` and NO `pubkey`. That is the fact the gate embarrassed itself on, and it
 *   holds whichever welshman is installed.
 * B **behaviour of the load paths** — this response becomes a usable zapper (`canZap` says
 *   yes, `zapFromEvent` accepts a receipt).
 *
 *   **The split this level carried under 0.9.5 is gone.** The case over welshman's OWN
 *   loader was skipped there, because `fetchZapper`/`getZapper` no longer existed and the
 *   replacement ran by construction into the gate. It is live again, rewritten onto
 *   `app.use(Zappers).load(lnurl)` — the API the installed version really offers
 *   (`LoadableMapPlugin.load`, `dist/app/src/plugins/base.d.ts`), checked at the package
 *   rather than taken from the skip text, which was written against 0.9.5. It comes with a
 *   counter-probe, because "the loader returns something" is not the same statement as
 *   "the gate is still a gate": 0.9.9 NARROWED the condition, it did not delete it, and a
 *   later version that deleted it would look identical from the positive case alone.
 *
 *   The cases over OUR path (`loadZapperNow`, `canZap`, `zapFromEvent`) ran throughout —
 *   measured, not assumed: our loader fetches the document itself and walks past
 *   welshman's gate.
 *
 *   A file that already fails at its import line would be the worse alarm: it poisons the
 *   suite with a meaningless message and takes levels A and C with it.
 * C **source latch on the installed `@welshman/app`** — version independent and
 *   independent of our import surface: the zapper batch loader must not gate on `pubkey`.
 *   This level survived the jump as a runnable test and named the defect out loud while B
 *   was split.
 *
 * Level C is a source-text test and so is prone to going blind in silence. It therefore
 * carries two anchor checks (the loader IS found, and it contains its acceptance branch)
 * and a positive control of the search pattern against the literal 0.9.5 line. If it
 * cannot find its subject it throws — it does not skip.
 *
 * ── A side finding, so nobody has to hunt for it twice ─────────────────────────────
 *
 * Our HOT path does not go through welshman's loader at all: `loadZapperNow`
 * (`js/zaps.ts`) fetches the LNURL document itself and writes the zapper straight into
 * `zappersByLnurl` — deliberately, see the (a)/(b) reasoning in `js/bridge.ts` (search
 * `Batcher-Defekt`): exponential backoff on one side, a promise that never settles on the
 * other. Only `resolveZapper` (`js/zaps.ts` → `loadZapperForPubkey`) goes through
 * welshman's loader, and no production site calls it today.
 *
 * Measured at the jump and still true: the value in the store is TYPED as the `Zapper`
 * class, but `MapPlugin.set` takes any plain object (no `instanceof` check) and `get`
 * hands exactly that object back. The field reads `canZap`/`canPay` rest on work on it
 * unchanged — the cases below show it. What WOULD break at runtime are class methods
 * (`validate`, `getResponseFilter`) on such an object; our code does not call them, and
 * `js/welshmanZapApi.ts` lifts the zapper into a real instance first.
 */
import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { getLnUrl } from '@welshman/util'
import { bech32ToHex } from '@welshman/lib'
import { Zappers } from '@welshman/app'
import { app } from './welshmanInstance.ts'
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

    test("welshman's own loader accepts it — this is the spot 0.9.5 closed", async () => {
        const lnurl = getLnUrl('welshman-lader@example.test')!
        gerufeneUrls.length = 0
        stelleFetch({ ...LNURL_PAY_ANTWORT })

        const zapper = await app.use(Zappers).load(lnurl)

        assert.ok(zapper, 'app.use(Zappers).load returned nothing — the gate discarded the document')
        assert.equal(canZap(zapper), true, 'canZap refuses a zapper carrying allowsNostr and nostrPubkey')
        // Proves the stub answered the endpoint the lnurl encodes, not some other address.
        assert.deepEqual(gerufeneUrls, [bech32ToHex(lnurl)])
    })

    test("COUNTER-PROBE: welshman's loader still turns down a response without the NIP-57 additions", async () => {
        // Without this case the one above would only say "the loader returns something".
        // 0.9.9 NARROWED the gate (`allowsNostr && nostrPubkey`), it did not remove it, and
        // a later version that removed it would pass the case above unchanged.
        const lnurl = getLnUrl('welshman-ohne-nostr@example.test')!
        gerufeneUrls.length = 0
        stelleFetch({ ...LNURL_PAY_OHNE_NOSTR })

        assert.equal(await app.use(Zappers).load(lnurl), undefined)
        // ... and the document really was fetched, so `undefined` means turned down here
        // rather than never asked for.
        assert.deepEqual(gerufeneUrls, [bech32ToHex(lnurl)])
    })

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

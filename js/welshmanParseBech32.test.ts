/**
 * **R2-Tor: was `parse()` mit NACKTEM bech32 macht — heute und nach dem Sprung.**
 *
 * Ausführen (läuft in `npm run test:unit` mit, Repo-Root):
 *   node --experimental-strip-types --test packages/einundzwanzig-group/js/welshmanParseBech32.test.ts
 *
 * ── Dieser Test SOLL beim Sprung auf 0.9.5 rot werden ───────────────────────────────
 *
 * Er ist **kein Riegel gegen** die Verhaltensänderung, sondern ihr **Beweis**. Die
 * Produktentscheidung ist gefallen (`docs/plans/2026-08-28T1950-welshman-0-9-sprung.md`,
 * „Offene Fragen": *Wollen wir nacktes bech32 linkifizieren? — JA, entschieden
 * 2026-08-28*): wir **wollen** das 0.9.5-Verhalten. Hier steht deshalb das ALTE Verhalten
 * festgenagelt, damit der Wechsel beim Sprung als Liste sichtbar wird statt in 52
 * geänderten Dateien unterzugehen.
 *
 * **Was P3 mit dieser Datei tut — und nur das:**
 * 1. `STAND` unten von `'vor-dem-sprung'` auf `'nach-dem-sprung'` setzen. Sonst nichts.
 * 2. Der Lauf ist dann grün, wenn 0.9.5 sich genau so verhält, wie die Spalte
 *    `nachSprung` es (am 2026-08-28 gegen den npm-Tarball `@welshman/content@0.9.5`)
 *    gemessen hat. Bleibt ein Fall rot, hat 0.9.5 etwas getan, das hier NIEMAND erwartet
 *    hat — das ist dann ein Befund, keine Zeile zum Nachziehen.
 * 3. Erst danach `js/nostrEventLink.ts` nachziehen (P3-Auftrag im Plan): dessen
 *    `nostr:`-Präfix-Pflicht wird sonst zur Divergenz — der Nachrichtentext verlinkt eine
 *    nackte Kennung nach njump, die Zitatkarte kennt sie weiterhin nicht.
 *
 * **Was P3 NICHT tut:** die Erwartungen „reparieren", bis es grün ist. Wer einen Fall
 * anfasst, ohne `STAND` zu drehen, dreht die Zusage in die falsche Richtung.
 *
 * ── Der Mechanismus, in einer Zeile ────────────────────────────────────────────────
 *
 * `@welshman/content` `parser.js`: `parseEvent` und `parseProfile` tragen die Gruppe
 * `(nostr:)` — in 0.8.16 OHNE `?` (Pflicht), in 0.9.5 MIT `?` (optional, Commit
 * `fef5c5a`). Eine Zeichenposition, zwei Parser, und `parse()` läuft bei uns auf **jeder
 * Chat-Nachricht** (`js/feeds.ts:309`, `renderMessageHtml`).
 *
 * ── Die Folge in unserem Code, damit sie niemand suchen muss ────────────────────────
 *
 * - `ParsedType.Profile` → `renderMentionSpan()` (`js/feeds.ts:317`). Nackte `npub1…`
 *   werden also zu aufgelösten `@Namen`. **Und sie setzen `hasMention = true`** — solche
 *   Nachrichten fallen damit aus dem HTML-Cache (`js/feeds.ts:352`). Das ist kein Fehler,
 *   aber eine Kostenänderung, die niemand bestellt hat.
 * - `ParsedType.Event` hat keinen eigenen Zweig und geht an `renderAsHtml` → ein
 *   `https://njump.me/…`-Link mitten in der Nachricht.
 *
 * ── Warum die Kennungen hier ERZEUGT und nicht hingeschrieben werden ────────────────
 *
 * Eine erfundene bech32-Zeichenkette scheitert an der Prüfsumme; `decode()` wirft, beide
 * Parser fallen auf Text zurück und **sehen dadurch gleich aus**. Ein Test mit erfundenen
 * Kennungen wäre grün und wertlos. Alle Kennungen unten kommen deshalb aus
 * `nip19.noteEncode`/`npubEncode`/`neventEncode`/`nprofileEncode`, und
 * {@link KALIBRIERUNG} prüft vor allem anderen nach, dass sie dekodieren — und dass die
 * absichtlich kaputte es nicht tut.
 */
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { parse, renderAsHtml } from '@welshman/content'
import * as nip19 from 'nostr-tools/nip19'

/**
 * **Der eine Schalter.** `'vor-dem-sprung'` = 0.8.16, `'nach-dem-sprung'` = 0.9.5.
 *
 * Er wird von {@link VERSIONS_RIEGEL} gegen die tatsächlich installierte Fassung
 * geprüft — der Schalter lässt sich also nicht vergessen und nicht vorauseilend drehen.
 */
const STAND: 'vor-dem-sprung' | 'nach-dem-sprung' = 'vor-dem-sprung'

const hex = (c: string): string => c.repeat(64)

const NOTE = nip19.noteEncode(hex('a'))
const NPUB = nip19.npubEncode(hex('b'))
const NPROFILE = nip19.nprofileEncode({ pubkey: hex('c'), relays: ['wss://relay.example/'] })
const NEVENT = nip19.neventEncode({ id: hex('d'), relays: ['wss://relay.example/'], author: hex('e'), kind: 1 })

/**
 * Dieselbe Kennung wie {@link NOTE}, letztes Datenzeichen gekippt → Prüfsumme verletzt.
 * Abgeleitet statt hingeschrieben, damit sie nicht bei einer Fixture-Änderung still
 * gültig wird; {@link KALIBRIERUNG} weist nach, dass `decode()` sie ablehnt.
 */
const KAPUTT = NOTE.slice(0, -1) + (NOTE.at(-1) === 'q' ? 'p' : 'q')

/**
 * Ein Fall: derselbe Text, zweimal durch `parse()` — die Knotenfolge in 0.8.16 und die
 * in 0.9.5. Beide Spalten sind GEMESSEN (2026-08-28, `@welshman/content` 0.8.16 aus
 * `node_modules` gegen den npm-Tarball 0.9.5), keine davon ist geraten.
 */
type Fall = {
    readonly name: string
    readonly text: string
    /** Knotenfolge unter 0.8.16 (`parse(...).map(n => n.type).join(', ')`). */
    readonly vorSprung: string
    /** Knotenfolge unter 0.9.5. */
    readonly nachSprung: string
}

/**
 * **Acht Fälle, die sich bewegen — und sechs, die es nicht tun.**
 *
 * Die Kontrollen sind nicht Zierrat: ohne sie wäre nicht unterscheidbar, ob 0.9.5 die
 * Präfix-Pflicht gelockert hat (das ist gewollt) oder ob es jetzt beliebige Zeichenketten
 * verlinkt (das wäre der Ärger, gegen den `js/nostrEventLink.ts:15-22` argumentiert).
 * F9–F14 belegen: die Prüfsumme trägt die Grenze, nicht das Präfix.
 */
const FAELLE: readonly Fall[] = [
    // ── Das, was sich bewegt ────────────────────────────────────────────────────────
    { name: 'F1 nacktes note1 mitten im Satz', text: `schau mal ${NOTE} an`, vorSprung: 'text', nachSprung: 'text, event, text' },
    { name: 'F2 @npub1 mit at-Präfix, ohne nostr:', text: `hallo @${NPUB} magst du`, vorSprung: 'text', nachSprung: 'text, profile, text' },
    { name: 'F3 nacktes npub1 ohne at', text: `hallo ${NPUB} magst du`, vorSprung: 'text', nachSprung: 'text, profile, text' },
    { name: 'F4 nacktes nprofile1', text: `profil ${NPROFILE} bitte`, vorSprung: 'text', nachSprung: 'text, profile, text' },
    { name: 'F5 nacktes nevent1', text: `event ${NEVENT} hier`, vorSprung: 'text', nachSprung: 'text, event, text' },
    { name: 'F6 nacktes npub1 am Satzanfang', text: `${NPUB} hallo`, vorSprung: 'text', nachSprung: 'profile, text' },
    { name: 'F7 nacktes npub1 direkt vor einem Punkt', text: `hallo ${NPUB}.`, vorSprung: 'text', nachSprung: 'text, profile, text' },
    { name: 'F8 nacktes NPUB1 in Grossbuchstaben', text: `hallo ${NPUB.toUpperCase()} du`, vorSprung: 'text', nachSprung: 'text, profile, text' },

    // ── Die Kontrollen: was sich NICHT bewegt ───────────────────────────────────────
    { name: 'F9 KONTROLLE nostr:note1 — verlinkt in BEIDEN', text: `schau mal nostr:${NOTE} an`, vorSprung: 'text, event, text', nachSprung: 'text, event, text' },
    { name: 'F10 KONTROLLE kaputte Prüfsumme, nackt — verlinkt in KEINER', text: `schau mal ${KAPUTT} an`, vorSprung: 'text', nachSprung: 'text' },
    { name: 'F11 KONTROLLE kaputte Prüfsumme mit nostr: — verlinkt in KEINER', text: `schau mal nostr:${KAPUTT} an`, vorSprung: 'text', nachSprung: 'text' },
    { name: 'F12 KONTROLLE Kennung mit angehängtem Wort — verlinkt in KEINER', text: `${NOTE}xyz`, vorSprung: 'text', nachSprung: 'text' },
    { name: 'F13 KONTROLLE Kennung in Backticks bleibt Code', text: `code \`${NPUB}\` ende`, vorSprung: 'text, code, text', nachSprung: 'text, code, text' },
    { name: 'F14 KONTROLLE Kennung als URL-Pfad bleibt ein Link', text: `https://njump.me/${NPUB} guck`, vorSprung: 'link, text', nachSprung: 'link, text' },
]

/** Zahl der Fälle, die sich beim Sprung ändern — GEMESSEN, nicht aus dem Plan übernommen. */
const WECHSELNDE = 8

const knotenfolge = (text: string): string =>
    parse({ content: text, tags: [] })
        .map((node) => String(node.type))
        .join(', ')

const erwartet = (fall: Fall): string => (STAND === 'vor-dem-sprung' ? fall.vorSprung : fall.nachSprung)

describe('R2 · KALIBRIERUNG: die Fixtures sind echt', () => {
    test('KALIBRIERUNG: jede verwendete Kennung dekodiert wirklich', () => {
        // Ohne diesen Fall wäre der ganze Test grün, sobald sich ein Tippfehler in eine
        // Kennung schleicht: eine ungültige Kennung ist in BEIDEN Fassungen Text.
        for (const [name, kennung] of [['note', NOTE], ['npub', NPUB], ['nprofile', NPROFILE], ['nevent', NEVENT]] as const) {
            assert.doesNotThrow(() => nip19.decode(kennung), `${name} dekodiert nicht — die Fixture ist kaputt, nicht der Parser`)
        }
    })

    test('KALIBRIERUNG: die absichtlich kaputte Kennung wird von nip19 abgelehnt', () => {
        // Die Gegenprobe zur Zeile darüber. F10/F11 sagen „verlinkt in keiner Fassung" —
        // das ist nur dann eine Aussage über die PRÜFSUMME, wenn die Prüfsumme wirklich
        // verletzt ist. Wäre KAPUTT zufällig gültig, prüften beide Fälle nichts.
        assert.throws(() => nip19.decode(KAPUTT), /checksum/i)
        assert.notEqual(KAPUTT, NOTE)
    })

    test('KALIBRIERUNG: jeder Fixture-Text enthält seine Kennung noch', () => {
        // Ein umgebauter Text, aus dem die Kennung herausgefallen ist, wäre überall
        // „text" und damit klaglos grün.
        const mitKennung = FAELLE.filter((f) => [NOTE, NPUB, NPROFILE, NEVENT, KAPUTT].some((k) => f.text.toLowerCase().includes(k.toLowerCase())))
        assert.equal(mitKennung.length, FAELLE.length, 'ein Fall trägt keine bech32-Kennung mehr')
    })
})

describe('R2 · VERSIONS_RIEGEL: der Schalter passt zur installierten Fassung', () => {
    /**
     * Der Riegel, der den Schalter erzwingt. Ohne ihn wäre `STAND` eine Meinung: nach
     * dem Sprung stünden 8 rote Fälle da und der naheliegende Griff wäre, sie einzeln
     * „anzupassen". Mit ihm sagt der Lauf, was zu tun ist.
     */
    test('VERSIONS_RIEGEL: 0.8.x ⇔ vor-dem-sprung, 0.9.x ⇔ nach-dem-sprung', () => {
        const pfad = createRequire(import.meta.url).resolve('@welshman/content/package.json')
        const version = String((JSON.parse(readFileSync(pfad, 'utf8')) as { version?: unknown }).version ?? '')
        assert.match(version, /^\d+\.\d+\./, `Keine lesbare Version in ${pfad} — dieser Riegel misst dann nichts`)

        const erwarteterStand = version.startsWith('0.8.') ? 'vor-dem-sprung' : 'nach-dem-sprung'
        assert.equal(
            STAND,
            erwarteterStand,
            `@welshman/content ist ${version}, der Schalter STAND steht aber auf "${STAND}". ` +
                `Beim Sprung auf 0.9.x ist STAND auf "nach-dem-sprung" zu setzen — und NUR das; ` +
                'die Erwartungen in FAELLE sind gemessen und werden nicht "angepasst".',
        )
    })
})

describe('R2 · die Knotenfolge je Fall', () => {
    for (const fall of FAELLE) {
        test(fall.name, () => {
            assert.equal(
                knotenfolge(fall.text),
                erwartet(fall),
                `${fall.name}: erwartet für STAND="${STAND}". Ist der Sprung gerade passiert, ist das die ` +
                    'gewollte Änderung — dann STAND drehen, nicht diesen Fall.',
            )
        })
    }

    test('die Bilanz: genau 8 von 14 Fällen wechseln beim Sprung', () => {
        // Hält die Zahl fest, die im Bericht steht. Sie ist gemessen (2026-08-28) und
        // korrigiert die „4 von 5" des Plans, die mit einem kleineren Fallsatz entstanden.
        const wechselnd = FAELLE.filter((f) => f.vorSprung !== f.nachSprung)
        assert.equal(FAELLE.length, 14)
        assert.equal(wechselnd.length, WECHSELNDE, `wechselnde Fälle: ${wechselnd.map((f) => f.name).join(' · ')}`)
        // Und die Gegenrichtung, damit die Kontrollgruppe nicht leer werden kann.
        assert.equal(FAELLE.length - wechselnd.length, 6)
    })
})

describe('R2 · die sichtbare Folge: was der Leser im Chat sieht', () => {
    /**
     * `renderAsHtml` escapt über einen DOM-Knoten (`render.js:11-14`), den es unter
     * `node --test` nicht gibt. Ersetzt wird deshalb **nur** `createElement` — der
     * Prüfgegenstand (welcher Parser-Zweig gegriffen hat) bleibt unangetastet; die
     * Attrappe entscheidet nichts, sie hält nur Text und gibt ihn zurück.
     */
    const createElement = (tag: string): Record<string, unknown> => ({
        tag,
        href: '',
        target: '',
        innerText: '',
        get innerHTML(): string {
            return String((this as { innerText: unknown }).innerText).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        },
        get outerHTML(): string {
            const self = this as { tag: string; href: string; target: string; innerHTML: string }

            return `<${self.tag} href="${self.href}" target="${self.target}">${self.innerHTML}</${self.tag}>`
        },
    })

    const html = (text: string): string => renderAsHtml(parse({ content: text, tags: [] }), { createElement }).toString()

    test('KALIBRIERUNG: die DOM-Attrappe rendert überhaupt einen Link', () => {
        // Sonst wäre „kein <a>" unten trivial wahr — die Attrappe könnte Links
        // verschlucken und der Riegel bliebe still.
        assert.match(html(`schau mal nostr:${NOTE} an`), /<a href="https:\/\/njump\.me\//)
    })

    test('KERNBEWEIS: ein nacktes npub1 erzeugt heute KEINEN Link', () => {
        const gerendert = html(`hallo @${NPUB} magst du`)
        if (STAND === 'vor-dem-sprung') {
            assert.ok(!gerendert.includes('<a '), `nackte Kennung ist verlinkt worden: ${gerendert}`)
            assert.ok(gerendert.includes(NPUB), 'die Kennung steht heute unverändert im Text')
        } else {
            assert.match(gerendert, /<a href="https:\/\/njump\.me\/nprofile1/)
        }
    })
})

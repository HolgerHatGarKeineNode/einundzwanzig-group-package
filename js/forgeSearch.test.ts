/**
 * Die Repo-Suche — geprüft wird das, was sie unbrauchbar machen würde:
 *
 *   1. **Ein Repo muss über den Maintainer-npub UND über den Hex zu finden
 *      sein.** Das ist die Zusage aus der Definition of Done von P5. Ein
 *      Mensch kopiert einen npub aus einem anderen Client und fügt ihn ein; im
 *      Ereignis steht Hex. Ohne Übersetzung findet er nichts und hält das Repo
 *      für abwesend.
 *   2. **Auch der ANGETIPPTE npub muss treffen.** Wer den Schlüssel nicht
 *      einfügt, sondern tippt, hat nach fünf Zeichen keinen gültigen bech32 —
 *      und genau dann darf die Liste nicht leer werden.
 *   3. **Mehrere Wörter sind ein UND.** `"verein satzung"` darf nicht jedes
 *      Repo liefern, in dem irgendeins von beiden vorkommt.
 *   4. **Leere Anfrage ist kein Filter, aber auch kein Treffer.** Die beiden
 *      Einstiege beantworten das bewusst verschieden; wer sie verwechselt,
 *      zeigt entweder eine leere oder eine ungefilterte Liste als „Ergebnis".
 *
 * ── Die npubs hier sind ECHT ────────────────────────────────────────────────
 *
 * Erzeugt mit `nip19.npubEncode` aus genau den Hex-Schlüsseln, die daneben
 * stehen (2026-08-23). Ein erfundener „npub1" + Zeichen wäre **kein bech32**:
 * die Prüfsumme stimmte nicht, `nip19.decode` würfe, und der Test bewiese
 * genau das Gegenteil dessen, was er behauptet — nämlich dass der
 * Präfix-Zweig läuft, obwohl der Dekodier-Zweig nie erreicht wurde.
 *
 * Ausführen:
 * node --experimental-strip-types --test packages/einundzwanzig-group/js/forgeSearch.test.ts
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { nip19 } from 'nostr-tools'
import {
    filterRepos,
    npubZuHex,
    repoHaystack,
    repoTrifft,
    repoTrifftBegriffe,
    zerlegeAnfrage,
    type SearchableRepo,
} from './forgeSearch.ts'

const OWNER = '0adf67475ccc5ca456fd3022e46f5d526eb0af6284bf85494c0dd7847f3e5033'
const MAINTAINER = '40b87b4cc62aeb820b10b4e652b26ba7e6793933736185ee2b821dafa2683b49'
const OWNER_NPUB = 'npub1pt0kw36ue3w2g4haxq3wgm6a2fhtptmzsjlc2j2vphtcgle72qesgpjyc6'
const MAINTAINER_NPUB = 'npub1gzu8knxx9t4cyzcsknn99vnt5ln8jwfnwdsctm3tsgw6lgng8dysnee3nw'

const repo = (over: Partial<SearchableRepo> = {}): SearchableRepo => ({
    name: 'einundzwanzig-verein',
    dtag: 'einundzwanzig-verein',
    description: 'Die Satzung und die Beschluesse des Vereins',
    hashtags: ['bitcoin', 'verein'],
    cloneUrls: ['https://buzz.einundzwanzig.space/git/abc/einundzwanzig-verein'],
    webUrls: ['https://einundzwanzig.space/verein'],
    relays: ['wss://buzz.einundzwanzig.space'],
    maintainers: [MAINTAINER],
    owner: OWNER,
    euc: 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678',
    ...over,
})

// ── Vorbedingung ────────────────────────────────────────────────────────────

test('VORBEDINGUNG: die npubs der Vorlage sind ECHTES bech32', () => {
    // Ohne diese Zusage könnten alle npub-Tests grün sein, weil sie nur noch
    // Zeichenketten vergleichen und der Dekodier-Zweig nie läuft.
    assert.equal(nip19.npubEncode(OWNER), OWNER_NPUB)
    assert.equal(nip19.npubEncode(MAINTAINER), MAINTAINER_NPUB)
    assert.equal(npubZuHex(OWNER_NPUB), OWNER)
    assert.equal(npubZuHex(MAINTAINER_NPUB), MAINTAINER)
})

test('KONTROLLE: ein ERFUNDENER npub ist kein bech32 und wird nicht dekodiert', () => {
    // `b` steht nicht einmal im bech32-Zeichenvorrat. Ein Test, der so etwas
    // als Schlüssel benutzt, prüft nichts.
    assert.equal(npubZuHex('npub1' + 'b'.repeat(58)), '')
    // Richtiger Zeichenvorrat, falsche Prüfsumme — auch das ist kein npub.
    assert.equal(npubZuHex(OWNER_NPUB.slice(0, -1) + 'q'), '')
    assert.equal(npubZuHex('einundzwanzig'), '')
})

// ── Die Zusage aus der Definition of Done ───────────────────────────────────

test('DoD: das Repo wird über den Maintainer-NPUB gefunden', () => {
    assert.equal(repoTrifft(repo(), MAINTAINER_NPUB), true)
})

test('DoD: das Repo wird über den Maintainer-HEX gefunden', () => {
    assert.equal(repoTrifft(repo(), MAINTAINER), true)
    // Auch in Grossschreibung eingefügt — Hex kommt in beiden Formen vor.
    assert.equal(repoTrifft(repo(), MAINTAINER.toUpperCase()), true)
})

test('KONTROLLE: ein FREMDER Schlüssel trifft nicht', () => {
    const fremdHex = 'f'.repeat(64)
    assert.equal(repoTrifft(repo(), fremdHex), false)
    assert.equal(repoTrifft(repo(), nip19.npubEncode(fremdHex)), false)
})

test('der EIGENTÜMER ist mitdurchsuchbar — NIP-34 nennt ihn impliziten Maintainer', () => {
    assert.equal(repoTrifft(repo(), OWNER_NPUB), true)
    assert.equal(repoTrifft(repo(), OWNER), true)
})

test('ein angetippter npub-PRÄFIX trifft ebenfalls', () => {
    // Der Fall, den ein reiner Dekodier-Weg verliert: nach 12 Zeichen ist der
    // Begriff kein gültiger npub, aber die Liste soll schon filtern.
    assert.equal(repoTrifft(repo(), MAINTAINER_NPUB.slice(0, 12)), true)
    assert.equal(repoTrifft(repo(), MAINTAINER_NPUB.slice(0, 30)), true)
    // Und ein Präfix, der zu keinem der Schlüssel gehört, trifft nicht.
    assert.equal(repoTrifft(repo(), 'npub1zzzzzzzzz'), false)
})

// ── Die übrigen Felder ──────────────────────────────────────────────────────

test('Name, d, Beschreibung, Hashtag, clone-, web- und Relay-URL sind alle durchsuchbar', () => {
    const r = repo()
    assert.equal(repoTrifft(r, 'einundzwanzig-verein'), true, 'Name')
    assert.equal(repoTrifft(r, 'satzung'), true, 'Beschreibung')
    assert.equal(repoTrifft(r, 'bitcoin'), true, 'Hashtag')
    assert.equal(repoTrifft(r, 'buzz.einundzwanzig.space/git'), true, 'clone-URL')
    assert.equal(repoTrifft(r, 'einundzwanzig.space/verein'), true, 'web-URL')
    assert.equal(repoTrifft(r, 'wss://buzz'), true, 'Relay')
})

test('der `euc` ist durchsuchbar — ein Commit-Hash aus einem fremden Client führt zum Repo', () => {
    assert.equal(repoTrifft(repo(), 'a1b2c3d4'), true)
    assert.equal(repoTrifft(repo(), 'A1B2C3D4'), true)
})

test('die Suche ist unabhängig von Gross- und Kleinschreibung', () => {
    assert.equal(repoTrifft(repo(), 'SATZUNG'), true)
    assert.equal(repoTrifft(repo({ name: 'Grosses REPO' }), 'grosses repo'), true)
})

// ── Die Verknüpfung ─────────────────────────────────────────────────────────

test('mehrere Wörter sind ein UND, kein ODER', () => {
    const r = repo()
    // Beide Wörter kommen vor — in VERSCHIEDENEN Feldern, und das genügt.
    assert.equal(repoTrifft(r, 'verein satzung'), true)
    // Eines kommt vor, das andere nicht: kein Treffer.
    assert.equal(repoTrifft(r, 'verein monero'), false, 'Die Verknüpfung ist ein ODER geworden.')
})

test('ein Wort darf ein anderes Feld treffen als das nächste', () => {
    // `bitcoin` steht im Hashtag, `wss` in der Relay-URL — ein Matcher, der
    // beide Wörter im SELBEN Feld verlangte, fände das nicht.
    assert.equal(repoTrifft(repo(), 'bitcoin wss'), true)
})

// ── Die Ränder ──────────────────────────────────────────────────────────────

test('leere Anfrage: `repoTrifft` sagt nein, `filterRepos` filtert nicht', () => {
    // Absichtlich verschieden, siehe die Begründungen an beiden Funktionen.
    assert.equal(repoTrifft(repo(), ''), false)
    assert.equal(repoTrifft(repo(), '   '), false)
    const liste = [repo({ name: 'a' }), repo({ name: 'b' })]
    assert.equal(filterRepos(liste, '').length, 2)
    assert.equal(filterRepos(liste, '   ').length, 2)
})

test('filterRepos behält die REIHENFOLGE der Liste bei', () => {
    // Nach Güte umzusortieren liesse die Liste bei jedem Tastendruck springen.
    const liste = [
        repo({ name: 'zeta-verein' }),
        repo({ name: 'alpha-verein' }),
        repo({ name: 'mitte-verein' }),
    ]
    assert.deepEqual(
        filterRepos(liste, 'verein').map((r) => r.name),
        ['zeta-verein', 'alpha-verein', 'mitte-verein'],
    )
})

test('fehlende Felder werfen nicht — ein 30617 darf fast leer sein', () => {
    const mager: SearchableRepo = {
        name: 'nur-name',
        dtag: 'nur-name',
        description: '',
        hashtags: [],
        cloneUrls: [],
        webUrls: [],
        relays: [],
        maintainers: [],
        owner: OWNER,
        euc: '',
    }
    assert.equal(repoTrifft(mager, 'nur-name'), true)
    assert.equal(repoTrifft(mager, 'irgendwas'), false)
    // Leere Werte dürfen nicht als leeres Feld im Heuhaufen landen, sonst
    // träfe die Anfrage `''` über `includes` jedes Repo.
    assert.ok(!repoHaystack(mager).includes(''))
})

test('ein Repo ohne gültigen Eigentümer-Hex bricht den npub-Zweig nicht', () => {
    // `npubEncode` wirft bei ungültigem Hex. Kein Wurf nach aussen — die Suche
    // ist ein Filter, kein Validierer.
    const kaputt = repo({ owner: 'kein-hex', maintainers: ['auch-nicht'] })
    assert.equal(repoTrifft(kaputt, MAINTAINER_NPUB.slice(0, 12)), false)
    assert.equal(repoTrifft(kaputt, 'einundzwanzig-verein'), true)
})

// ── Die Äquivalenz der beiden npub-Wege ─────────────────────────────────────

test('beide npub-Wege finden DASSELBE — der Dekodier-Weg ist nur die Abkürzung', () => {
    // Diese Zusage bewachte zuerst niemand, und eine Mutationsprobe hat es
    // aufgedeckt: schaltete man das Dekodieren ab, blieb „findet über den
    // Maintainer-npub" grün — ein ganzer npub ist auch ein Präfix seiner
    // selbst. Der Dekodier-Weg ist damit eine KOSTEN-Optimierung, keine
    // zweite Trefferregel, und der Kommentar am Modul behauptete das Gegenteil.
    //
    // Hier steht die Aussage jetzt ausdrücklich: über welchen Weg ein Begriff
    // auch läuft, das Ergebnis ist gleich. Verschiebt eine spätere
    // Aufräumrunde das, fällt dieser Test.
    const r = repo()
    const ganz = MAINTAINER_NPUB
    const alsPraefix = { text: ganz, hex: '', alsNpub: true }
    const alsGanzer = { text: ganz, hex: MAINTAINER, alsNpub: true }

    assert.equal(repoTrifftBegriffe(r, [alsPraefix]), true, 'Kodier-Weg findet nicht.')
    assert.equal(repoTrifftBegriffe(r, [alsGanzer]), true, 'Dekodier-Weg findet nicht.')

    // Und über eine ganze Liste: dieselbe Trefferauswahl, egal welcher Weg.
    const liste = [repo({ name: 'a' }), repo({ name: 'b', maintainers: [], owner: 'f'.repeat(64) })]
    assert.deepEqual(
        liste.filter((x) => repoTrifftBegriffe(x, [alsPraefix])).map((x) => x.name),
        liste.filter((x) => repoTrifftBegriffe(x, [alsGanzer])).map((x) => x.name),
    )
})

test('zerlegeAnfrage bereitet den Begriff EINMAL vor', () => {
    const [ganz, praefix, wort] = zerlegeAnfrage(`${MAINTAINER_NPUB} ${MAINTAINER_NPUB.slice(0, 12)} verein`)
    assert.equal(ganz?.hex, MAINTAINER, 'Ein ganzer npub wird beim Zerlegen dekodiert.')
    assert.equal(ganz?.alsNpub, true)
    assert.equal(praefix?.hex, '', 'Ein Präfix ist nicht dekodierbar — das ist kein Fehler.')
    assert.equal(praefix?.alsNpub, true)
    assert.equal(wort?.hex, '')
    assert.equal(wort?.alsNpub, false, 'Ein gewöhnliches Wort darf den teuren Weg nicht auslösen.')
})

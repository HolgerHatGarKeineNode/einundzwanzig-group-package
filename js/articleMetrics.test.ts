/**
 * Die Sozialsignale der Artikelfläche (P6) — `js/articleMetrics.ts`, welshman-nah aber
 * relayfrei:
 *   node --experimental-strip-types --test packages/einundzwanzig-group/js/articleMetrics.test.ts
 *
 * ── Was hier gedeckt ist, und was NICHT ────────────────────────────────────────────
 *
 * Gedeckt: die Filterform (welche REQs entstehen), die Zuordnung eines Sekundär-
 * Ereignisses zu einem Artikel über `A`/`a`/`e`, die Zählregeln und die Zap-Validierung
 * mit echtem welshman-`zapFromEvent`.
 *
 * **Nicht** gedeckt: dass die Ableitung bei nachgeladenen Ereignissen NEU RECHNET. Das
 * ist eine Aussage über das Abhängigkeits-Array eines `derived([...])` und per
 * Konstruktion nicht durch einen Aufruf der reinen Funktion prüfbar — sie steht in
 * `articleMetricsStore.test.ts` gegen das echte `repository`.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { COMMENT, REACTION, ZAP_RESPONSE, type TrustedEvent, type Zapper } from '@welshman/util'
import {
    KEINE_METRIKEN,
    METRIK_LOAD_LIMIT,
    artikelAdresse,
    artikelMetrikFilters,
    artikelVonEreignis,
    autorenMitQuittungen,
    berechneArtikelMetriken,
    deckelVerdacht,
    darfAuthBekommen,
    hatMetriken,
    leseRelayListe,
    leseRelayListeNachsichtig,
    summiereZaps,
    zaehleReaktionen,
} from './articleMetrics.ts'

const AUTOR = '3bf0c63fcb93463407af97a5e5ee64fa883d107ef9e558472c4eb9aaaefa459d'
const ANDERER = '97c70a44366a6535c145b333f973ea86dfdc2d7a99da618c40c64705ad98e322'

let laufend = 0
const ereignis = (kind: number, tags: string[][], over: Partial<TrustedEvent> = {}): TrustedEvent => {
    laufend += 1

    return {
        id: String(laufend).padStart(64, '0'),
        pubkey: AUTOR,
        kind,
        created_at: 1_700_000_000,
        content: '',
        tags,
        sig: 'f'.repeat(128),
        ...over,
    } as TrustedEvent
}

// ── Die Adresse ─────────────────────────────────────────────────────────────────────

test('artikelAdresse baut die NIP-01-Form — Literal, nicht das Symbol gegen sich selbst', () => {
    // Die Zeichenkette steht hier AUSGESCHRIEBEN. Ein `${LONGFORM}:${pk}:${d}` als
    // Erwartung wäre die Funktion gegen sich selbst und ginge auch dann grün durch,
    // wenn aus dem Doppelpunkt ein Bindestrich würde.
    assert.equal(
        artikelAdresse('3bf0c63fcb93463407af97a5e5ee64fa883d107ef9e558472c4eb9aaaefa459d', 'draft-1782503404724'),
        '30023:3bf0c63fcb93463407af97a5e5ee64fa883d107ef9e558472c4eb9aaaefa459d:draft-1782503404724',
    )
})

// ── Die Relay-Liste aus der Konfiguration ──────────────────────────────────────────

test('leseRelayListe: die empfohlene Konfiguration ergibt GENAU zwei normalisierte Adressen', () => {
    // Die Werte stehen hier als LITERAL — sie sind die Zeile, die `.env.example` unter
    // `NOSTR_ARTICLE_METRIC_RELAYS` empfiehlt. Ein Vergleich gegen `SEKUNDAER_RELAYS`
    // wäre das Symbol gegen sich selbst und ginge auch grün durch, wenn der Parser aus
    // zwei Adressen eine machte.
    assert.deepEqual(leseRelayListe('wss://nos.lol,wss://relay.damus.io'), [
        'wss://nos.lol/',
        'wss://relay.damus.io/',
    ])
})

test('leseRelayListe traegt Leerzeichen, ein Schlusskomma und einen fehlenden Schraegstrich', () => {
    // Jede dieser drei Schreibweisen ist eine, die ein Mensch in eine `.env` tippt —
    // und jede erzeugte ohne Normalisierung eine URL, die der `tracker` nie
    // wiederfindet. Die Zähler blieben dann klein, ohne dass irgendetwas fehlschlägt.
    assert.deepEqual(leseRelayListe(' wss://nos.lol , wss://relay.damus.io/ , '), [
        'wss://nos.lol/',
        'wss://relay.damus.io/',
    ])
})

test('leseRelayListe: nicht gesetzt und leer heissen beide „keine Fremdrelays"', () => {
    assert.deepEqual(leseRelayListe(undefined), [])
    assert.deepEqual(leseRelayListe(''), [])
    assert.deepEqual(leseRelayListe('  ,  '), [])
})

// ── Der nachsichtige Konstruktor (core.ts, uneindaembar) ──────────────────────────

/**
 * Die Formen, die **über die Listen-Zerlegung** einen Wurf ausloesen — am 2026-08-21
 * gemessen, nicht abgeleitet.
 *
 * ── Warum das NICHT dieselbe Liste ist wie „was `normalizeRelayUrl` wirft" ────────
 *
 * Der erste Entwurf dieser Konstante hiess `['nicht mal eine url', 'ws://', '   ']` und
 * war in BEIDE Richtungen falsch. Gemessen:
 *
 * | Eingabe | direkt an `normalizeRelayUrl` | ueber die Zerlegung |
 * |---|---|---|
 * | `'nicht mal eine url'` | wirft | wirft |
 * | `'ws://'` | wirft | wirft |
 * | `'   '` | **wirft** | **wirft NICHT** — `trim`+`filter` entfernen es vorher |
 * | `'data:text/html,x'` | **wirft NICHT** (wird zu `wss://data:text/html,x`) | **wirft** |
 * | `'http://x.de'` | wirft nicht (wird zu `wss://x.de/`) | wirft nicht |
 *
 * Die `data:`-Zeile ist der interessante Fall, und sie steht deshalb NICHT in dieser
 * Konstante, sondern in einem eigenen Test darunter: das Komma IM Wert zerreisst ihn in
 * `data:text/html` und `x`. Eine kommagetrennte Liste verhaelt sich also anders als ihre
 * Einzelteile — wer die eine Liste fuer die andere haelt, prueft am Gegenstand vorbei.
 */
const WIRFT = ['nicht mal eine url', 'ws://']

test('leseRelayListe bleibt STRENG — der Wurf ist in longformFeed.ts die bessere Rueckmeldung', () => {
    // **Bewusst nicht nachsichtig gemacht.** `longformFeed.ts` wird ausschliesslich
    // DYNAMISCH importiert (bridge.ts, vier Stellen, alle mit catch — drei davon setzen
    // eine sichtbare Fehlerzeile). Dort ist ein Wurf eingedaemmt und sagt dem Betreiber,
    // dass seine Konfiguration kaputt ist. Wuerde daraus stilles Verwerfen, verloere er
    // genau diese Rueckmeldung.
    for (const kaputt of WIRFT) {
        assert.throws(() => leseRelayListe(`wss://nos.lol,${kaputt}`))
    }
})

test('KERNBEWEIS: leseRelayListeNachsichtig wirft NIE — core.ts hat nichts, was faengt', () => {
    // Zusaetzlich der reine Leerraum: er wirft DIREKT an `normalizeRelayUrl`, faellt hier
    // aber schon in der Zerlegung heraus (siehe {@link WIRFT}). Beide Wege muessen halten.
    // `core.ts` wird von elf Modulen STATISCH importiert (darunter `bridge.ts`, der
    // Einstiegspunkt) und von keinem dynamisch. Ein Wurf im Modul-Toplevel reisst dort
    // die GANZE Client-Insel beim Boot ab — stumm, ausgeloest von einem
    // Betreiber-Tippfehler. Faellt dieser Fall um, ist das wieder moeglich.
    for (const kaputt of WIRFT) {
        assert.doesNotThrow(() => leseRelayListeNachsichtig(`wss://nos.lol,${kaputt}`, () => {}))
    }
    assert.doesNotThrow(() => leseRelayListeNachsichtig(WIRFT.join(','), () => {}))
    assert.doesNotThrow(() => leseRelayListeNachsichtig('wss://nos.lol,   ', () => {}))
    assert.deepEqual(leseRelayListeNachsichtig('wss://nos.lol,   ', () => {}), ['wss://nos.lol/'])
})

test('der gute Nachbar UEBERLEBT den kaputten Eintrag — verworfen wird nur der Muell', () => {
    // Die Zusage ist nicht „wirft nicht", sondern „wirft nicht UND behaelt den Rest".
    // Ein Konstruktor, der bei einem kaputten Eintrag stumm die ganze Liste leert, waere
    // ebenso gruen und haette die Sperre klammheimlich aufgehoben.
    for (const kaputt of WIRFT) {
        assert.deepEqual(leseRelayListeNachsichtig(`wss://nos.lol,${kaputt},wss://relay.damus.io`, () => {}), [
            'wss://nos.lol/',
            'wss://relay.damus.io/',
        ])
    }
})

test('DIE ZUSAGE, auf die sich darfAuthBekommen stuetzt: die Rueckgabe ist per Konstruktion normalisiert', () => {
    // **Hier haengt die Sicherheit der Metrik-Liste.** `darfAuthBekommen` behandelt einen
    // unlesbaren Eintrag als ABWESEND; fuer die Metrik-Liste waere das die unsichere
    // Richtung (der Mülleintrag selbst bekaeme als Socket-URL ein AUTH). Erreichbar ist
    // das nur dann nicht, wenn hier nichts Unlesbares herauskommt.
    const gemischt = leseRelayListeNachsichtig(`wss://nos.lol, ${WIRFT.join(', ')}, WSS://RELAY.DAMUS.IO`, () => {})

    assert.deepEqual(gemischt, ['wss://nos.lol/', 'wss://relay.damus.io/'])
    // Jeder Eintrag ist ein Fixpunkt der Normalisierung — nichts Rohes rutscht durch.
    for (const eintrag of gemischt) {
        assert.doesNotThrow(() => darfAuthBekommen(eintrag, gemischt, []))
        assert.equal(darfAuthBekommen(eintrag, gemischt, []), false, `${eintrag} muss gesperrt sein`)
    }
})

test('ein Wert MIT KOMMA zerfaellt — und hinterlaesst einen Rest, der wie eine Adresse aussieht', () => {
    // **Gemessen, nicht vermutet** (2026-08-21): `wss://nos.lol,data:text/html,x` wird an
    // den Kommata zerlegt, `data:text/html` wirft, und der Rest `x` normalisiert zu
    // `wss://x/`. Aus einem kaputten Konfigurationswert entsteht also ein zusaetzlicher,
    // syntaktisch gueltiger Eintrag.
    //
    // **Bewertung, und sie gehoert neben den Befund:** das ist der Preis der Nachsicht und
    // er ist gering. Der Eintrag landet ausschliesslich in der SPERRLISTE von `core.ts`
    // (`METRIK_RELAYS`) — er sperrt dort eine Adresse, die niemand abfragt. Geladen wird
    // von ihm nichts: `longformFeed.ts` bleibt streng und wirft bei derselben Eingabe, und
    // dieser Wurf ist dort eingedaemmt. Ein Phantomeintrag in einer Sperrliste ist
    // folgenlos; ein toter Client waere es nicht.
    //
    // Faellt diese Zeile um, hat sich das Zerlegungsverhalten geaendert — dann ist die
    // Bewertung oben neu zu treffen, nicht die Erwartung anzupassen.
    assert.deepEqual(leseRelayListeNachsichtig('wss://nos.lol,data:text/html,x,wss://relay.damus.io', () => {}), [
        'wss://nos.lol/',
        'wss://x/',
        'wss://relay.damus.io/',
    ])
    // Und der strenge Leser wirft bei derselben Eingabe — dort entsteht gar nichts.
    assert.throws(() => leseRelayListe('wss://nos.lol,data:text/html,x,wss://relay.damus.io'))
})

test('der Betreiber wird GEMELDET, nicht stillschweigend uebergangen', () => {
    // Eine Warnung statt einer Ausnahme: sie erreicht ihn, ohne den Boot zu nehmen.
    // Ohne diesen Fall waere „nachsichtig" von „stumm" nicht zu unterscheiden.
    const meldungen: string[] = []
    leseRelayListeNachsichtig('wss://nos.lol,nicht mal eine url,ws://', (n) => meldungen.push(n))

    assert.equal(meldungen.length, 1, 'genau EINE Meldung, nicht eine je Eintrag')
    assert.match(meldungen[0]!, /nicht mal eine url/)
    assert.match(meldungen[0]!, /ws:\/\//)
})

test('ohne kaputten Eintrag wird NICHT gemeldet — sonst waere die Warnung Rauschen', () => {
    const meldungen: string[] = []
    const gut = leseRelayListeNachsichtig('wss://nos.lol,wss://relay.damus.io', (n) => meldungen.push(n))

    assert.deepEqual(gut, ['wss://nos.lol/', 'wss://relay.damus.io/'])
    assert.deepEqual(meldungen, [])
})

test('beide Leser sind bei WOHLGEFORMTER Eingabe zeichengleich — eine Zerlegung, zwei Strengegrade', () => {
    // Die Schranke gegen ein Auseinanderdriften: der nachsichtige Leser ist kein zweiter
    // Parser, sondern derselbe mit abgefangener Normalisierung.
    for (const roh of ['wss://nos.lol,wss://relay.damus.io', ' wss://nos.lol , wss://relay.damus.io/ , ', '', '  ,  ']) {
        assert.deepEqual(leseRelayListeNachsichtig(roh, () => {}), leseRelayListe(roh), `Abweichung bei ${JSON.stringify(roh)}`)
    }
})

// ── Die Filterform ──────────────────────────────────────────────────────────────────

test('METRIK_LOAD_LIMIT ist 500 — der von nos.lol und damus annoncierte max_limit', () => {
    assert.equal(METRIK_LOAD_LIMIT, 500)
})

test('artikelMetrikFilters fragt SECHS Filter: drei Kinds über #a, die Wurzelform #A und zwei #e', () => {
    const filters = artikelMetrikFilters({ adressen: ['30023:aa:bb'], ids: ['cc'] })

    assert.equal(filters.length, 6)
    assert.deepEqual(filters, [
        { kinds: [7], '#a': ['30023:aa:bb'], limit: 500 },
        { kinds: [9735], '#a': ['30023:aa:bb'], limit: 500 },
        { kinds: [1111], '#a': ['30023:aa:bb'], limit: 500 },
        { kinds: [1111], '#A': ['30023:aa:bb'], limit: 500 },
        { kinds: [7], '#e': ['cc'], limit: 500 },
        { kinds: [9735], '#e': ['cc'], limit: 500 },
    ])
})

test('artikelMetrikFilters legt die Kinds NICHT zusammen — der 500er-Deckel gilt je REQ', () => {
    // Ein einziger `{kinds:[7,9735,1111]}` wäre drei REQs statt sechs und lief in
    // nos.lols `max_limit` (2026-08-21 gemessen: 500 statt der 590 vorhandenen).
    const filters = artikelMetrikFilters({ adressen: ['30023:aa:bb'], ids: [] })

    for (const filter of filters) {
        assert.equal(filter.kinds?.length, 1, `Filter mit mehreren Kinds: ${JSON.stringify(filter)}`)
    }
})

test('ohne Adressen und ohne Ids entsteht KEIN Filter — nichts zu fragen', () => {
    assert.deepEqual(artikelMetrikFilters({ adressen: [], ids: [] }), [])
})

test('ohne Ids entfallen genau die beiden #e-Filter', () => {
    const filters = artikelMetrikFilters({ adressen: ['30023:aa:bb'], ids: [] })

    assert.equal(filters.length, 4)
    assert.equal(
        filters.some((filter) => '#e' in filter),
        false,
    )
})

// ── Die Zuordnung ───────────────────────────────────────────────────────────────────

const ADRESSE = artikelAdresse(AUTOR, 'kennung')
const bekannt = new Set([ADRESSE])
const vonId = new Map([['a'.repeat(64), ADRESSE]])

test('ein Kommentar mit NUR A wird zugeordnet — der Fall, an dem ein #a-only-Filter scheitert', () => {
    // Eine Antwort auf einen Kommentar trägt im `a` den ELTERNKOMMENTAR (hier: eine
    // fremde Adresse) und nur im `A` den Artikel. Gemessen am 2026-08-21: 7 der 64
    // Kommentare des Bestands sind ausschließlich über `#A` zu finden.
    const antwort = ereignis(COMMENT, [
        ['A', ADRESSE],
        ['a', '30023:ffff:etwas-anderes'],
    ])

    assert.equal(artikelVonEreignis(antwort, vonId, bekannt), ADRESSE)
})

test('A gewinnt gegen a — die Wurzel ist die verlässlichere Zeigeform', () => {
    const beide = ereignis(COMMENT, [
        ['a', ADRESSE],
        ['A', ADRESSE],
    ])

    assert.equal(artikelVonEreignis(beide, vonId, bekannt), ADRESSE)
})

test('ein e-Tag auf eine bekannte Fassung wird über die Id-Tabelle aufgeloest', () => {
    const reaktion = ereignis(REACTION, [['e', 'a'.repeat(64)]], { content: '+' })

    assert.equal(artikelVonEreignis(reaktion, vonId, bekannt), ADRESSE)
})

test('ein Zeiger auf einen FREMDEN Artikel wird nicht zugeordnet — nicht „irgendwohin"', () => {
    const fremd = ereignis(REACTION, [['a', '30023:ffff:fremd']], { content: '+' })

    assert.equal(artikelVonEreignis(fremd, vonId, bekannt), '')
})

test('ein e-Tag auf eine UNBEKANNTE Fassung wird nicht zugeordnet', () => {
    // Wichtig für die Vollansicht: sie kennt nur einen Artikel. Ein `#e`-Signal auf eine
    // andere Fassung darf dort nicht am falschen Eintrag landen.
    const reaktion = ereignis(REACTION, [['e', 'b'.repeat(64)]], { content: '+' })

    assert.equal(artikelVonEreignis(reaktion, vonId, bekannt), '')
})

// ── Die Zählregeln ──────────────────────────────────────────────────────────────────

test('zaehleReaktionen dedupliziert je (Autor, Emoji) — die Regel des Chats', () => {
    const reaktionen = [
        ereignis(REACTION, [], { content: '+', pubkey: AUTOR }),
        // Derselbe Mensch, dasselbe Emoji, zweites Ereignis: zählt EINMAL.
        ereignis(REACTION, [], { content: '+', pubkey: AUTOR }),
        // Derselbe Mensch, ANDERES Emoji: zählt zusätzlich.
        ereignis(REACTION, [], { content: '🔥', pubkey: AUTOR }),
        ereignis(REACTION, [], { content: '+', pubkey: ANDERER }),
    ]

    assert.equal(zaehleReaktionen(reaktionen), 3)
})

test('hatMetriken: nur Sats ohne Zaps ist kein Signal — ein Wert 0 ueberall heisst „nichts"', () => {
    assert.equal(hatMetriken(KEINE_METRIKEN), false)
    assert.equal(hatMetriken({ ...KEINE_METRIKEN, reaktionen: 1 }), true)
    assert.equal(hatMetriken({ ...KEINE_METRIKEN, zaps: 1 }), true)
    assert.equal(hatMetriken({ ...KEINE_METRIKEN, kommentare: 1 }), true)
})

// ── Die Zap-Validierung, mit echtem welshman ───────────────────────────────────────

const LNURL_DIENST = 'd'.repeat(64)
const ANGREIFER = '9'.repeat(64)

/**
 * Eine bolt11-Rechnung, aus der welshmans `getInvoiceAmount` genau `msats` liest.
 *
 * Kein echtes Netzobjekt: `getInvoiceAmount` liest ausschließlich den Betragsteil des
 * HRP (`/lnbc(\d+\w)/`). Die Einheit `p` ist Piko-BTC = **0,1 msat** — am installierten
 * welshman nachgemessen (2026-08-21: `lnbc2100000p` → 210 000 msats), nicht aus der
 * Spezifikation abgeleitet.
 */
const bolt11Fuer = (msats: number): string => `lnbc${msats * 10}p1p0000000`

/**
 * Eine Zap-Quittung. `p` (Empfänger) und der SIGNER sind getrennte Parameter — genau in
 * dieser Trennung liegt der Angriff, den der `p`-Riegel abwehrt.
 */
const quittung = (msats: number, p: string | string[], signer: string, requestTags: string[][] = []): TrustedEvent => {
    // **`p` darf eine LISTE sein**, und das ist kein Komfort: Nostr verbietet doppelte
    // Tags nicht, Relays deduplizieren sie nicht, und genau daran ist der erste Riegel
    // dieser Phase gescheitert (`find` liest den ersten, welshmans `fromPairs` den
    // letzten). Ein Fixture, das nur einen `p`-Tag bauen kann, kann diese Klasse nicht
    // prüfen.
    const pListe = Array.isArray(p) ? p : [p]
    const request = { pubkey: ANDERER, tags: [...pListe.map((wert) => ['p', wert]), ['amount', String(msats)], ...requestTags] }

    return ereignis(
        ZAP_RESPONSE,
        [
            ['bolt11', bolt11Fuer(msats)],
            ['description', JSON.stringify(request)],
            ...pListe.map((wert) => ['p', wert]),
        ],
        { pubkey: signer },
    )
}

/** Der Zapper des Autors, wie ihn `zappersByLnurl` liefert. */
const zapperDesAutors = { nostrPubkey: LNURL_DIENST, lnurl: 'lnurl1beispiel' } as unknown as Zapper

test('der ECHTE Fall geht durch: vom LNURL-Dienst des Autors signiert, p = Autor', () => {
    const { zaps, sats } = summiereZaps([quittung(21_000, AUTOR, LNURL_DIENST)], zapperDesAutors, AUTOR)

    assert.equal(zaps, 1)
    assert.equal(sats, 21)
})

test('summiereZaps summiert in Sats, nicht in Millisats', () => {
    const { zaps, sats } = summiereZaps(
        [quittung(21_000, AUTOR, LNURL_DIENST), quittung(1_000, AUTOR, LNURL_DIENST)],
        zapperDesAutors,
        AUTOR,
    )

    assert.equal(zaps, 2)
    assert.equal(sats, 22)
})

test('SICHERHEIT: eine selbst signierte Quittung mit dem EIGENEN Pubkey im p zaehlt NICHT', () => {
    // **Der Kern des Sicherheitsbefunds.** welshmans `zapFromEvent` hat VOR beiden
    // Signaturprüfungen einen Kurzschluss: `if (responseMeta.p === response.pubkey)
    // return zap`. Ein Angreifer signiert also selbst, trägt sich selbst ins `p` und
    // erfindet einen beliebigen Betrag — die Zuordnung zum Artikel läuft über `#a` und
    // sagt über den Empfänger nichts.
    //
    // Ohne den `p`-Riegel liefert genau dieser Aufruf `{zaps: 1, sats: 2_100_000}`.
    const angriff = quittung(2_100_000_000, ANGREIFER, ANGREIFER)

    assert.deepEqual(summiereZaps([angriff], zapperDesAutors, AUTOR), { zaps: 0, sats: 0 })

    // Und er skaliert nicht durch Wiederholung.
    assert.deepEqual(summiereZaps([angriff, angriff, angriff], zapperDesAutors, AUTOR), { zaps: 0, sats: 0 })
})

test('SICHERHEIT: ZWEI p-Tags [Autor, Angreifer] zaehlen NICHT — der Riegel liest wie welshman', () => {
    // **Die Umgehung, an der der erste Riegel dieser Phase gescheitert ist.** `find`
    // liefert den ERSTEN `p`-Tag (= Autor, sieht harmlos aus), welshmans `fromPairs` den
    // LETZTEN (= Angreifer, feuert den Kurzschluss `responseMeta.p === response.pubkey`).
    // Ein selbst gebauter Leser erzeugt damit ein Differential, und in dem Spalt lebt der
    // ganze Angriff: gemessen 2 100 000 Sats an einem fremden Artikel.
    //
    // Deshalb liest der Riegel mit derselben Funktion wie welshman — dann ist der Spalt
    // per Konstruktion zu. **Fällt dieser Fall um, ist er wieder offen.**
    const angriff = quittung(2_100_000_000, [AUTOR, ANGREIFER], ANGREIFER)

    assert.deepEqual(summiereZaps([angriff], zapperDesAutors, AUTOR), { zaps: 0, sats: 0 })
    assert.deepEqual(summiereZaps([angriff, angriff, angriff], zapperDesAutors, AUTOR), { zaps: 0, sats: 0 })
})

test('SICHERHEIT: DREI p-Tags [Autor, Autor, Angreifer] zaehlen ebenfalls NICHT', () => {
    // Die naheliegende nächste Variante — und sie ist genau der Fall, der einen Riegel
    // aushebelte, der „das zweite `p`" prüft statt „das, was welshman sieht".
    // Wiederholung desselben Werts ändert nichts, entscheidend ist allein der letzte.
    const angriff = quittung(2_100_000_000, [AUTOR, AUTOR, ANGREIFER], ANGREIFER)

    assert.deepEqual(summiereZaps([angriff], zapperDesAutors, AUTOR), { zaps: 0, sats: 0 })
})

test('GEGENRICHTUNG: [Angreifer, Autor] kommt am Riegel vorbei — und welshman verwirft es selbst', () => {
    // **Die Positivkontrolle, ohne die die Empfehlung nicht trüge.** Hier ist der letzte
    // `p` der Autor, der Riegel lässt also durch. Verworfen wird trotzdem, eine Ebene
    // tiefer: `responseMeta.p` ist dann nicht mehr der Signer, der Kurzschluss feuert
    // nicht, und `response.pubkey !== zapper.nostrPubkey` greift.
    //
    // Damit ist der Riegel **ausreichend** und nicht bloß enger — er muss diese Form gar
    // nicht selbst fangen. Fiele diese Zeile um, wäre die Arbeitsteilung zwischen Riegel
    // und welshman verschoben und der Riegel allein zu schwach.
    const angriff = quittung(2_100_000_000, [ANGREIFER, AUTOR], ANGREIFER)

    assert.deepEqual(summiereZaps([angriff], zapperDesAutors, AUTOR), { zaps: 0, sats: 0 })
})

test('POSITIVKONTROLLE: der echte Einfach-p-Fall zaehlt weiter — der Korpus misst in BEIDE Richtungen', () => {
    // Ohne diese Zeile wären die vier Sicherheitsfälle darüber auch dann grün, wenn
    // `summiereZaps` schlicht immer null lieferte.
    assert.deepEqual(summiereZaps([quittung(21_000, AUTOR, LNURL_DIENST)], zapperDesAutors, AUTOR), {
        zaps: 1,
        sats: 21,
    })
})

test('SICHERHEIT: ohne bekannten Empfaenger zaehlt gar nichts — „wissen wir nicht" ist keine Zahl', () => {
    // Der Aufrufer kennt den Autor der Adresse nicht (leere Tabelle). Eine Quittung
    // durchzulassen hieße, eine Zahl über einen Artikel zu zeigen, dessen Empfänger
    // unbekannt ist — also genau die Lücke von oben durch die Hintertür.
    assert.deepEqual(summiereZaps([quittung(21_000, AUTOR, LNURL_DIENST)], zapperDesAutors, ''), { zaps: 0, sats: 0 })
})

test('eine Quittung an einen FREMDEN Empfaenger zaehlt beim Autor nicht mit', () => {
    // Formal einwandfrei, nur an jemand anderen gerichtet: ein `#a`-Treffer allein macht
    // sie nicht zu einem Zap AUF DIESEN ARTIKEL.
    assert.deepEqual(summiereZaps([quittung(21_000, ANDERER, LNURL_DIENST)], zapperDesAutors, AUTOR), { zaps: 0, sats: 0 })
})

test('eine Quittung, deren bolt11 dem amount-Tag WIDERSPRICHT, zaehlt nicht — Anti-Spoof', () => {
    const gefaelscht = ereignis(
        ZAP_RESPONSE,
        [
            // behauptet 1 000 000 msats, die Rechnung lautet über 21 000
            ['bolt11', bolt11Fuer(21_000)],
            ['description', JSON.stringify({ pubkey: ANDERER, tags: [['p', AUTOR], ['amount', '1000000']] })],
            ['p', AUTOR],
        ],
        { pubkey: LNURL_DIENST },
    )

    assert.deepEqual(summiereZaps([gefaelscht], zapperDesAutors, AUTOR), { zaps: 0, sats: 0 })
})

test('OHNE aufgeloesten Zapper faellt eine fremd signierte Quittung durch — kein erfundener Zaehler', () => {
    // `p !== Signer` und kein `zapper`: welshman kann den Signer gegen nichts prüfen und
    // verwirft. Das ist die Richtung, die diese Fläche will — lieber kein Zähler als ein
    // falscher.
    const echt = quittung(21_000, AUTOR, LNURL_DIENST)

    assert.deepEqual(summiereZaps([echt], undefined, AUTOR), { zaps: 0, sats: 0 })
    // Mit passendem Zapper geht dieselbe Quittung durch.
    assert.deepEqual(summiereZaps([echt], zapperDesAutors, AUTOR), { zaps: 1, sats: 21 })
})

test('ein lnurl-Tag, das NICHT dem zapper.lnurl entspricht, verwirft — die 36 von 168 des Bestands', () => {
    const mitLnurl = quittung(21_000, AUTOR, LNURL_DIENST, [
        // So schreiben es 26 der 36 verworfenen Quittungen des Bestands: die URL statt
        // ihrer bech32-Form.
        ['lnurl', 'https://primal.net/.well-known/lnurlp/markusturm'],
    ])

    assert.deepEqual(summiereZaps([mitLnurl], zapperDesAutors, AUTOR), { zaps: 0, sats: 0 })
})

// ── Der AUTH-Riegel gegen die Metrik-Relais ────────────────────────────────────────

test('darfAuthBekommen sperrt GENAU die konfigurierten Metrik-Relais', () => {
    const metrik = ['wss://nos.lol/', 'wss://relay.damus.io/']

    assert.equal(darfAuthBekommen('wss://nos.lol/', metrik), false)
    assert.equal(darfAuthBekommen('wss://relay.damus.io/', metrik), false)
    // Alles andere bleibt unangetastet — Space, Board, Workspace, Indexer, Signer.
    assert.equal(darfAuthBekommen('wss://nostr.einundzwanzig.space/', metrik), true)
    assert.equal(darfAuthBekommen('ws://localhost:3334/', metrik), true)
    assert.equal(darfAuthBekommen('wss://buzz.einundzwanzig.space/', metrik), true)
    assert.equal(darfAuthBekommen('wss://purplepag.es/', metrik), true)
})

test('darfAuthBekommen normalisiert BEIDE Seiten — ein fehlender Schraegstrich hebelt nichts aus', () => {
    // Der wahrscheinlichste Weg, den Riegel versehentlich zu umgehen: die `.env` trägt
    // `wss://nos.lol`, der Socket meldet `wss://nos.lol/`. Ein roher Stringvergleich
    // ließe die Challenge durch, und niemandem fiele es auf.
    assert.equal(darfAuthBekommen('wss://nos.lol/', ['wss://nos.lol']), false)
    assert.equal(darfAuthBekommen('wss://nos.lol', ['wss://nos.lol/']), false)
    assert.equal(darfAuthBekommen('WSS://NOS.LOL/', ['wss://nos.lol']), false)
})

test('ohne konfigurierte Metrik-Relais aendert der Riegel NICHTS am Bestandsverhalten', () => {
    // Der Normalfall einer Installation ohne `NOSTR_ARTICLE_METRIC_RELAYS`: jeder Relay
    // verhält sich wie vor P6. Ohne diesen Fall wäre nicht belegt, dass der Riegel keine
    // Bestandsverbindung trifft.
    assert.equal(darfAuthBekommen('wss://nos.lol/', []), true)
    assert.equal(darfAuthBekommen('ws://localhost:3334/', []), true)
})

test('KERNBEWEIS des Riegels: ein EIGENER Relay, der ZUGLEICH Metrik-Relay ist, bekommt weiter AUTH', () => {
    // **Der Fall, der beim Bauen alle fuenf E2E-Faelle rot gemacht hat.**
    // `board-fixtures.ts` traegt den worker-eigenen zooid absichtlich als Board UND als
    // Metrik-Relay ein (eine fremde Adresse waere dort ein Bruch des Relay-Waechters),
    // und dieser zooid verlangt AUTH. Ohne die Rueckausnahme nahm die Sperre ihm die
    // Identitaet — und die Flaeche blieb STUMM leer, nicht laut.
    const board = 'ws://localhost:3335/'

    assert.equal(darfAuthBekommen(board, [board], [board]), true)
    // Und die Gegenprobe, sonst waere die Zeile darueber trivial: OHNE die Rueckausnahme
    // ist derselbe Relay gesperrt. Faellt dieser Fall um, ist der Riegel wirkungslos
    // geworden.
    assert.equal(darfAuthBekommen(board, [board], []), false)
})

test('die Rueckausnahme gilt NUR fuer den genannten Relay, nicht fuer alle', () => {
    const eigene = ['ws://localhost:3335/', '', 'wss://buzz.einundzwanzig.space/']
    const metrik = ['ws://localhost:3335/', 'wss://nos.lol/']

    assert.equal(darfAuthBekommen('ws://localhost:3335/', metrik, eigene), true)
    // nos.lol steht NICHT unter den eigenen — die Sperre haelt.
    assert.equal(darfAuthBekommen('wss://nos.lol/', metrik, eigene), false)
})

test('F3: ein UNLESBARER Eintrag wirft nicht — und hebt weder eine Sperre auf noch erfindet er eine', () => {
    // **Der Befund, gegen den das steht.** `normalizeRelayUrl` wirft bei Muell
    // (`TypeError: Invalid URL`, am 2026-08-21 gemessen fuer `'nicht mal eine url'`,
    // `'ws://'` und reinen Leerraum). Diese Funktion laeuft INNERHALB von welshmans
    // `shouldAuth`; ein Wurf dort fliegt aus `AuthState.emit` heraus und schaltet die
    // AUTH-Beantwortung auf ALLEN Relays ab — stumm. Ausgeloest von einem
    // Betreiber-Tippfehler in `NOSTR_SPACE_URL`, nicht von einem Angreifer.
    const muell = ['nicht mal eine url', 'ws://', '   ']

    // (a) Muell in den EIGENEN: die Sperre der wohlgeformten Metrik-Adresse haelt.
    assert.equal(darfAuthBekommen('wss://nos.lol/', ['wss://nos.lol/'], [...muell, 'ws://localhost:3334/']), false)
    // (b) Muell in den EIGENEN: die Rueckausnahme des wohlgeformten Eintrags haelt.
    assert.equal(darfAuthBekommen('ws://localhost:3334/', ['ws://localhost:3334/'], [...muell, 'ws://localhost:3334/']), true)
    // (c) Muell in den METRIK-Relais: der wohlgeformte Nachbar sperrt weiter.
    assert.equal(darfAuthBekommen('wss://nos.lol/', [...muell, 'wss://nos.lol/'], []), false)
    // (d) Ein unlesbarer Eintrag ist ABWESEND, kein Treffer: er sperrt nichts.
    assert.equal(darfAuthBekommen('wss://nos.lol/', muell, []), true)
    // (e) Und eine unlesbare SOCKET-Url faellt auf das Bestandsverhalten zurueck.
    assert.equal(darfAuthBekommen('nicht mal eine url', ['wss://nos.lol/'], []), true)
})

test('F3: der Aufruf wirft unter keiner der gemessenen Muellformen', () => {
    // Die Zusage, auf die es ankommt, ist nicht der Rueckgabewert, sondern dass es
    // ueberhaupt einen gibt. Ein `assert.doesNotThrow` waere hier keine Formalie: genau
    // dieser Wurf war der Befund.
    for (const kaputt of ['nicht mal eine url', 'ws://', '   ', 'data:text/html,x', '']) {
        assert.doesNotThrow(() => darfAuthBekommen(kaputt, [kaputt], [kaputt]))
        assert.doesNotThrow(() => darfAuthBekommen('wss://nos.lol/', [kaputt], [kaputt]))
    }
})

test('leere Eintraege in der Rueckausnahme heben die Sperre NICHT auf', () => {
    // Eine Installation ohne Workspace liefert dort `''`. Wuerde der leere String
    // normalisiert und verglichen, koennte er eine Sperre versehentlich aufheben —
    // `normalizeRelayUrl('')` ist kein definierter Wert, auf den man sich verlassen darf.
    assert.equal(darfAuthBekommen('wss://nos.lol/', ['wss://nos.lol/'], ['', '', '']), false)
})

// ── Der Bestand am Stück ───────────────────────────────────────────────────────────

test('berechneArtikelMetriken bündelt je Artikel und laesst signallose Artikel WEG', () => {
    const mit = artikelAdresse(AUTOR, 'mit-signal')
    const ohne = artikelAdresse(AUTOR, 'ohne-signal')
    const tabelle = berechneArtikelMetriken({
        adressen: [mit, ohne],
        adresseVonId: new Map(),
        autorVonAdresse: new Map([
            [mit, AUTOR],
            [ohne, AUTOR],
        ]),
        ereignisse: [
            ereignis(REACTION, [['a', mit]], { content: '+', pubkey: ANDERER }),
            ereignis(COMMENT, [['A', mit]], { pubkey: ANDERER }),
        ],
        zapperVon: () => undefined,
    })

    assert.deepEqual(tabelle.get(mit), { reaktionen: 1, zaps: 0, sats: 0, kommentare: 1 })
    // NICHT `{…, reaktionen: 0}` — der Artikel ohne Signal steht gar nicht in der Tabelle.
    assert.equal(tabelle.has(ohne), false)
})

test('ein und dasselbe Signal über ZWEI Zeigeformen zaehlt EINMAL', () => {
    // Der Normalfall im Bestand: dieselbe Reaktion wird vom `#a`- UND vom `#e`-REQ
    // geliefert. Dedupliziert wird über die Event-Id — hier absichtlich schon in der
    // Eingabe, weil die Ableitung das tut; die Funktion muss zusätzlich robust sein,
    // wenn ein Autor zweimal dasselbe Emoji schickt.
    const adresse = artikelAdresse(AUTOR, 'kennung')
    const doppelt = [
        ereignis(REACTION, [['a', adresse]], { content: '+', pubkey: ANDERER }),
        ereignis(REACTION, [['e', 'a'.repeat(64)]], { content: '+', pubkey: ANDERER }),
    ]
    const tabelle = berechneArtikelMetriken({
        adressen: [adresse],
        adresseVonId: new Map([['a'.repeat(64), adresse]]),
        autorVonAdresse: new Map([[adresse, AUTOR]]),
        ereignisse: doppelt,
        zapperVon: () => undefined,
    })

    assert.equal(tabelle.get(adresse)?.reaktionen, 1)
})

test('Kommentare werden über die Event-Id dedupliziert, nicht ueber den Autor', () => {
    const adresse = artikelAdresse(AUTOR, 'kennung')
    const tabelle = berechneArtikelMetriken({
        adressen: [adresse],
        adresseVonId: new Map(),
        autorVonAdresse: new Map([[adresse, AUTOR]]),
        ereignisse: [
            // Derselbe Mensch, zwei verschiedene Kommentare: zählt zwei.
            ereignis(COMMENT, [['A', adresse]], { pubkey: ANDERER }),
            ereignis(COMMENT, [['A', adresse]], { pubkey: ANDERER }),
        ],
        zapperVon: () => undefined,
    })

    assert.equal(tabelle.get(adresse)?.kommentare, 2)
})

// ── Der Bedarfs-Riegel vor den LNURL-Anfragen ─────────────────────────────────────

test('autorenMitQuittungen liefert NUR Autoren mit Zap-Quittung — jeder weitere waere eine fremde HTTPS-Anfrage', () => {
    // Jeder zurueckgegebene Autor kostet eine Anfrage an seinen fremden Wallet-Host,
    // beim blossen Oeffnen der Liste und ohne Nutzerhandlung. Am Bestand gemessen: 6 von
    // 12 Autoren tragen ueberhaupt Quittungen — die Kopplung halbiert die Hosts.
    const mitZap = artikelAdresse(AUTOR, 'mit-zap')
    const ohneZap = artikelAdresse(ANDERER, 'ohne-zap')
    const eingang = {
        adressen: [mitZap, ohneZap],
        adresseVonId: new Map(),
        autorVonAdresse: new Map([
            [mitZap, AUTOR],
            [ohneZap, ANDERER],
        ]),
    }

    assert.deepEqual(
        autorenMitQuittungen({
            ...eingang,
            ereignisse: [
                quittung(21_000, AUTOR, LNURL_DIENST, []),
                // Reaktion und Kommentar duerfen KEINE LNURL-Anfrage ausloesen.
                ereignis(REACTION, [['a', ohneZap]], { content: '+' }),
                ereignis(COMMENT, [['A', ohneZap]]),
            ].map((event) => (event.kind === ZAP_RESPONSE ? { ...event, tags: [...event.tags, ['a', mitZap]] } : event)),
        }),
        [AUTOR],
    )

    // Und ohne jede Quittung: keine einzige Anfrage.
    assert.deepEqual(autorenMitQuittungen({ ...eingang, ereignisse: [] }), [])
})

test('eine Quittung an einen UNBEKANNTEN Artikel loest keine Anfrage aus', () => {
    assert.deepEqual(
        autorenMitQuittungen({
            adressen: [artikelAdresse(AUTOR, 'meiner')],
            adresseVonId: new Map(),
            autorVonAdresse: new Map([[artikelAdresse(AUTOR, 'meiner'), AUTOR]]),
            ereignisse: [{ ...quittung(21_000, AUTOR, LNURL_DIENST, []), tags: [['a', '30023:ffff:fremd']] } as TrustedEvent],
        }),
        [],
    )
})

// ── Der Detektor fuer den Relay-Deckel ────────────────────────────────────────────

test('deckelVerdacht schlaegt bei GENAU dem Limit an — der einzige Hinweis, den ein Relay gibt', () => {
    // Die Zahl steht als LITERAL: `deckelVerdacht(500)` gegen `METRIK_LOAD_LIMIT` waere
    // das Symbol gegen sich selbst.
    assert.equal(deckelVerdacht(500), true)
    assert.equal(deckelVerdacht(501), true)
    assert.equal(deckelVerdacht(499), false)
    // Der heutige Groesstwert des Bestands (kind 7 auf nos.lol) loest NICHT aus — sonst
    // waere die Warnung von Anfang an Rauschen.
    assert.equal(deckelVerdacht(380), false)
})

test('deckelVerdacht nimmt ein eigenes Limit — sonst waere er an eine Konstante genagelt', () => {
    assert.equal(deckelVerdacht(100, 100), true)
    assert.equal(deckelVerdacht(99, 100), false)
})

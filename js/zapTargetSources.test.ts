/**
 * **Die Regel als Ganzes: Zahlungs- und Identitätsfelder kommen NIE aus der
 * Fremdquelle — auch nicht bei dem Leser, den morgen jemand dazuschreibt.**
 *
 * Ausführen:
 *   node --experimental-strip-types --test packages/einundzwanzig-group/js/zapTargetSources.test.ts
 *
 * ── Warum diese Form, und was sie NICHT abdeckt ─────────────────────────────
 *
 * Es gibt schon zwei Zusagen daneben, und beide prüfen eine BEKANNTE Funktion:
 * `profileMerge.test.ts` misst die Regeln pur, `spaceProfiles.test.ts` misst sie
 * am Vertrag gegen die installierte welshman-Fassung. Beide bleiben still, wenn
 * ein VIERTER Leser dazukommt, der sein Profil woanders herholt. Genau daran ist
 * der Fehler zweimal beinahe durchgerutscht.
 *
 * Deshalb steht hier eine Kombination aus vier Ebenen — jede schließt eine Lücke,
 * die die anderen offen lassen:
 *
 * 1. **Inventar der LESER (statisch).** Jeder Zugriff auf
 *    `lud16`/`lud06`/`lnurl`/`nip05` im Paket — TypeScript UND Markup — wird
 *    gescannt und muss unten deklariert stehen. Ein neuer Leser, egal in welcher
 *    Datei, macht diesen Test rot; er ist dann zu klassifizieren, nicht
 *    wegzuklicken. Das ist die Ebene, die über die HEUTE bekannten Stellen
 *    hinausreicht.
 * 1b. **Inventar der AUFLÖSER (statisch).** Dieselbe Frage von der anderen Seite:
 *    wer löst überhaupt eine Empfangsadresse auf (`getLnUrl`, `loadZapperNow`,
 *    `resolveZapper`, …), und WOMIT. Nötig, weil ein künftiger Leser einen fremden
 *    Wert weiterreichen kann, ohne je selbst `.lud16` zu schreiben — Ebene 1 und 2
 *    blieben dann still (nachgewiesen: siehe Mutationsprobe M4 im Bericht).
 * 2. **Herkunft mechanisch gegengeprüft (statisch).** Die Deklaration darf nicht
 *    bloß behaupten, woher ein Leser sein Profil hat: der Test sucht die BINDUNG
 *    des Empfängers im Quelltext und vergleicht sie mit der Deklaration. Wer
 *    `getProfile()` gegen `getSpaceProfile()` tauscht, wird rot, ohne dass ihn
 *    jemand daran erinnert. Die Klasse (repository/gemergt/…) wird aus dem
 *    gefundenen Produzenten ABGELEITET, nicht deklariert.
 * 3. **Die Fremdquelle trägt die Felder gar nicht (verhaltensbasiert).** Ein
 *    feindliches kind 0 vom Space-Relay läuft durch den ECHTEN `loadSpaceProfiles`
 *    (MockAdapter, Kontext-Riegel wie in `core.ts`) — und danach wird nicht eine
 *    Handvoll bekannter Namen abgefragt, sondern die GESAMTE Export-Oberfläche von
 *    `spaceProfiles.ts` reflektiv abgelaufen. Ein neuer Ausgang der Zweitquelle
 *    macht den Test rot, bis jemand sagt, wie er zu prüfen ist.
 *
 * **Was diese Form nicht abdeckt — ausdrücklich:**
 * - *Dynamische Feldzugriffe.* `profil[feld]` mit berechnetem `feld` sieht der
 *   Scanner nicht. `profileMerge.ts` selbst benutzt genau das (`local[field]`) —
 *   dort ist es die Allowlist-Schleife und damit Prüfgegenstand von Ebene 3, nicht
 *   ein Leser. Ein Angreifer im eigenen Code könnte damit am Inventar vorbei.
 * - *Weitergereichte Werte.* Steht ein `lud16` erst einmal in einer Zwischenvariable
 *   (`this.profileLud16`), verfolgt der Scanner sie nicht. Er greift an der Stelle,
 *   an der das Feld AUS EINEM PROFIL gelesen wird — das ist die Engstelle.
 * - *Andere Pakete/Repos.* Gescannt wird dieses Paket und (wenn vorhanden) der
 *   Host-Baum `resources/`, nicht `node_modules` und nicht welshman selbst.
 * - *Die Richtigkeit der Klassifikation im Grenzfall.* Ebene 2 belegt, dass die
 *   deklarierte Quelle im Code steht; ob ein KÜNFTIGER Produzent zu Recht als
 *   „repository" gilt, entscheidet weiterhin ein Mensch — der Test zwingt ihn nur,
 *   die Entscheidung zu treffen und einzutragen.
 */
import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { get } from 'svelte/store'
import { repository } from './welshmanApp.ts'
import { netContext, MockAdapter, type AbstractAdapter, type ClientMessage } from '@welshman/net'
import { normalizeRelayUrl, verifyEvent, type TrustedEvent } from '@welshman/util'
import { PROFILE } from './welshmanKinds.ts'
import { readProfile } from './welshmanProfile.ts'
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure'
import * as spaceProfilesModul from './spaceProfiles.ts'

const {
    loadSpaceProfiles,
    profilesByPubkey,
    spaceProfilesByPubkey,
    getSpaceProfile,
    getMergedProfile,
    deriveMergedProfile,
    displayProfileByPubkey,
} = spaceProfilesModul

// ════════════════════════════════════════════════════════════════════════════
// Ebene 1 + 2 — Inventar & Herkunft
// ════════════════════════════════════════════════════════════════════════════

/** Die vier Felder, um die es geht. `lnurl` ist abgeleitet, aber genauso wirksam. */
const FELDER = ['lud16', 'lud06', 'lnurl', 'nip05'] as const
/** Davon die, an denen Geld hängt. `nip05` ist derselbe Fehlertyp ohne Geldschaden. */
const ZAHLUNGSFELDER: readonly string[] = ['lud16', 'lud06', 'lnurl']

const PAKET_DIR = join(import.meta.dirname, '..')
const HOST_DIR = join(PAKET_DIR, '..', '..')

/**
 * Produzenten von Profil-Objekten und ihre Klasse. **Das ist die eigentliche
 * Entscheidungsliste** — sie ist klein und auditierbar, und jede Fundstelle wird
 * über sie klassifiziert statt einzeln beurteilt.
 *
 * `gemergt` heißt: das Objekt kann Anteile der Fremdquelle tragen. Zulässig ist es
 * nur, weil Ebene 3 misst, dass dort keine Zahlungs-/Identitätsfelder ankommen.
 */
const PRODUZENTEN: { schluessel: string; muster: RegExp; klasse: string }[] = [
    { schluessel: 'getProfile', muster: /\bgetProfile\s*\(/, klasse: 'repository' },
    { schluessel: 'loadProfile', muster: /\bloadProfile\s*\(/, klasse: 'repository' },
    { schluessel: 'userProfile', muster: /\buserProfile\b/, klasse: 'repository' },
    { schluessel: 'deriveMergedProfile', muster: /\bderiveMergedProfile\s*\(/, klasse: 'gemergt' },
    { schluessel: '$profiles', muster: /\$profiles\b/, klasse: 'gemergt' },
    { schluessel: 'profiles-parameter', muster: /\bprofiles\s*:\s*Map</, klasse: 'parameter' },
    // Die Autorenkarte der Artikel-Vollansicht (P3) bekommt ihre Felder als Parameter,
    // aus demselben Grund wie `ArticleRowDeps`: `longform.ts` kennt welshman nicht.
    // Zulaessig ist damit nur ein IDENTITAETSfeld — ein Zahlungsfeld steht in diesem
    // Typ gar nicht erst (`ArticleAuthorDeps` traegt `hatLightning: boolean`, nicht
    // `lud16`), und der Aufrufer-Hop unten nagelt fest, woher der Wert kommt.
    { schluessel: 'autor-deps-parameter', muster: /\bdeps\s*:\s*ArticleAuthorDeps\b/, klasse: 'parameter' },
    { schluessel: 'deriveHandleForPubkey', muster: /\bderiveHandleForPubkey\s*\(/, klasse: 'handle' },
    // Das FERTIGE Autorenmodell aus `deriveAuthorPage` — dieselbe Herkunft, die die vier
    // Markup-Zugriffe auf `autor.nip05` in `⚡article-author.blade.php` per `modell`
    // deklarieren, nur einmal in TypeScript statt in Blade. `AuthorView['autor']` ist
    // `ArticleAuthor`, und dessen `nip05` entsteht ausschließlich in
    // `buildArticleAuthor` aus `verifiedNip05(…)`; die Bindung im Code sagt das über den
    // TYP, nicht über einen Namen, den man frei wählen könnte.
    { schluessel: 'autor-modell', muster: /\bAuthorView\['autor'\]/, klasse: 'handle' },
    { schluessel: 'handles-map', muster: /\$handles\b|\bhandles\s*:\s*Map</, klasse: 'handle' },
    { schluessel: 'zapper', muster: /\bzapper\b/, klasse: 'zapper-dokument' },
    { schluessel: 'formular-input', muster: /\(input\s*:\s*\{/, klasse: 'eigene-eingabe' },
    { schluessel: 'space-suchtreffer', muster: /\breadProfile\s*\(\s*event\s*\)/, klasse: 'fremd-roh' },
    // Die ROHE Zweitquelle. Steht hier nicht, weil sie erlaubt wäre, sondern damit ein
    // Zugriff über sie einen NAMEN bekommt statt „unbekannt" — sie ist der Weg, auf dem
    // der Fehler zweimal beinahe durchgerutscht ist.
    { schluessel: 'space-zweitquelle', muster: /\bgetSpaceProfile\s*\(|\bspaceProfilesByPubkey\b/, klasse: 'fremd-roh' },
]

/** Welche Klassen ein ZAHLUNGSFELD lesen dürfen. `fremd-roh` steht bewusst nicht drin. */
const ZAHLUNG_ERLAUBT = new Set(['repository', 'gemergt', 'zapper-dokument', 'eigene-eingabe'])
/** Welche Klassen ein `nip05` lesen dürfen — plus die unten einzeln benannten Ausnahmen. */
const IDENTITAET_ERLAUBT = new Set(['repository', 'gemergt', 'handle', 'parameter', 'eigene-eingabe'])

type Fund = {
    datei: string
    ausdruck: string
    feld: string
    treffer: number
    zeilen: number[]
}

type Deklaration = {
    datei: string
    ausdruck: string
    /**
     * Erwarteter Produzent je Vorkommen, in Zeilenreihenfolge (Schlüssel aus
     * {@link PRODUZENTEN}) — wird am Code gegengeprüft. Die Länge ist zugleich die
     * erwartete Zahl der Vorkommen: derselbe Ausdruck zweimal in einer Datei kann
     * aus zwei verschiedenen Quellen stammen, und genau das muss sichtbar sein.
     */
    quellen: string[]
    warum: string
    /** Nur für Markup: welches JS-Modell den Wert baut, und woran man das erkennt. */
    modell?: { datei: string; token: string }
    /**
     * Ein `nip05`, das NICHT gegen `.well-known/nostr.json` verifiziert ist und
     * trotzdem angezeigt wird. Jeder Eintrag hier ist ein bewusst getragenes
     * Restrisiko — nicht ein Versehen, das der Test stillschweigend durchwinkt.
     */
    unverifiziert?: true
}

/**
 * Kommentare entfernen, Zeilennummern erhalten.
 *
 * `//` nach einem Doppelpunkt bleibt stehen — sonst fräse der Stripper an
 * `'https://…'` mitten in einer Codezeile und ein echter Feldzugriff dahinter
 * verschwände lautlos. Genau diese stille Blindheit ist der Fehler, den ein
 * Scanner nicht machen darf.
 */
const ohneKommentare = (quelle: string, blade: boolean): string[] => {
    const zeilen = quelle.split('\n')
    let imBlock = false
    return zeilen.map((zeile) => {
        let out = ''
        let i = 0
        while (i < zeile.length) {
            if (imBlock) {
                const ende = zeile.indexOf(blade ? '--}}' : '*/', i)
                if (ende === -1) {
                    i = zeile.length
                } else {
                    imBlock = false
                    i = ende + (blade ? 4 : 2)
                }
                continue
            }
            if (blade ? zeile.startsWith('{{--', i) : zeile.startsWith('/*', i)) {
                imBlock = true
                i += blade ? 4 : 2
                continue
            }
            if (!blade && zeile.startsWith('//', i) && !(i > 0 && zeile[i - 1] === ':')) {
                break
            }
            out += zeile[i]
            i++
        }
        return out
    })
}

const dateienUnter = (dir: string, endung: string): string[] => {
    if (!existsSync(dir)) {
        return []
    }
    const treffer: string[] = []
    for (const eintrag of readdirSync(dir)) {
        if (eintrag === 'node_modules' || eintrag === 'vendor' || eintrag.startsWith('.')) {
            continue
        }
        const pfad = join(dir, eintrag)
        if (statSync(pfad).isDirectory()) {
            treffer.push(...dateienUnter(pfad, endung))
        } else if (pfad.endsWith(endung)) {
            treffer.push(pfad)
        }
    }
    return treffer
}

/**
 * `x?.lud16`, `a.b.get(k)?.nip05`, … — der Empfänger wird mitgenommen.
 *
 * Der Empfänger ist eine Namenskette mit höchstens EINEM abschließenden Aufruf.
 * Ein loseres Muster (beliebige Klammern) verschluckte den umgebenden Aufruf mit:
 * aus `getLnUrl(profile?.lud16 …)` wurde dann der Empfänger `getLnUrl(profile`,
 * und die Bindung von `profile` war nicht mehr auffindbar.
 */
const ZUGRIFF = /(?<![\w$.])([A-Za-z_$][\w$]*(?:\s*\??\.\s*[A-Za-z_$][\w$]*)*(?:\([^()]*\))?)\s*\??\.\s*(lud16|lud06|lnurl|nip05)\b/g
/** `x['lud16']` — heute nirgends benutzt, aber ein Zugang, der nicht offen bleiben darf. */
const KLAMMER = /\[\s*['"](lud16|lud06|lnurl|nip05)['"]\s*\]/g
/** `const { lud16 } = profil` — `}\s*=(?!>)` hält Typliterale und Pfeilfunktionen draußen. */
const DESTRUKTUR = /\{[^{}]*\b(lud16|lud06|lnurl|nip05)\b[^{}]*\}\s*=(?!>)/g
/**
 * Die zweite Hälfte der Frage: nicht „wer LIEST ein Feld", sondern „wer LÖST eine
 * Empfangsadresse AUF". Ein künftiger Leser könnte einen fremden Wert weiterreichen,
 * ohne selbst je `.lud16` zu schreiben — an dieser Liste kommt er trotzdem nicht vorbei.
 */
const AUFLOESER = /\b(getLnUrl|lnurlInvoice|loadZapperNow|resolveZapper|getZapper|loadZapperForPubkey)\s*\(/g

const scanne = (): Fund[] => {
    const quellen: string[] = [
        ...dateienUnter(join(PAKET_DIR, 'js'), '.ts').filter((p) => !p.endsWith('.test.ts') && !p.endsWith('.d.ts')),
        ...dateienUnter(join(PAKET_DIR, 'resources'), '.blade.php'),
        ...dateienUnter(join(HOST_DIR, 'resources'), '.blade.php'),
        ...dateienUnter(join(HOST_DIR, 'resources'), '.ts'),
    ]
    const nachSchluessel = new Map<string, Fund>()
    for (const pfad of quellen) {
        const blade = pfad.endsWith('.blade.php')
        const zeilen = ohneKommentare(readFileSync(pfad, 'utf8'), blade)
        const datei = relative(PAKET_DIR, pfad).split(sep).join('/')
        zeilen.forEach((zeile, index) => {
            const nimm = (ausdruck: string, feld: string): void => {
                const schluessel = `${datei}|${ausdruck}`
                const vorhanden = nachSchluessel.get(schluessel)
                if (vorhanden) {
                    vorhanden.treffer++
                    vorhanden.zeilen.push(index + 1)
                } else {
                    nachSchluessel.set(schluessel, { datei, ausdruck, feld, treffer: 1, zeilen: [index + 1] })
                }
            }
            for (const m of zeile.matchAll(ZUGRIFF)) {
                // `this.x` ist ein SCHREIBZIEL der Insel, keine Profilquelle — die Quelle
                // steht auf derselben Zeile rechts vom `=` und wird dort erfasst.
                if (m[1] === 'this') {
                    continue
                }
                nimm(`${m[1]!.replace(/\s+/g, '')}.${m[2]}`, m[2]!)
            }
            for (const m of zeile.matchAll(KLAMMER)) {
                nimm(`[${m[1]}]`, m[1]!)
            }
            for (const m of zeile.matchAll(DESTRUKTUR)) {
                nimm(`{${m[1]}}=`, m[1]!)
            }
        })
    }
    return [...nachSchluessel.values()].sort((a, b) => `${a.datei}|${a.ausdruck}`.localeCompare(`${b.datei}|${b.ausdruck}`))
}

type Aufloesung = { datei: string; fn: string; zeilen: number[]; texte: string[] }

/** Wo eine Empfangsadresse überhaupt AUFGELÖST wird — unabhängig davon, wer sie gelesen hat. */
const scanneAufloeser = (): Aufloesung[] => {
    const nachSchluessel = new Map<string, Aufloesung>()
    for (const pfad of dateienUnter(join(PAKET_DIR, 'js'), '.ts').filter((p) => !p.endsWith('.test.ts') && !p.endsWith('.d.ts'))) {
        const datei = relative(PAKET_DIR, pfad).split(sep).join('/')
        ohneKommentare(readFileSync(pfad, 'utf8'), false).forEach((zeile, index) => {
            for (const m of zeile.matchAll(AUFLOESER)) {
                const schluessel = `${datei}|${m[1]}`
                const vorhanden = nachSchluessel.get(schluessel)
                if (vorhanden) {
                    vorhanden.zeilen.push(index + 1)
                    vorhanden.texte.push(zeile.trim())
                } else {
                    nachSchluessel.set(schluessel, { datei, fn: m[1]!, zeilen: [index + 1], texte: [zeile.trim()] })
                }
            }
        })
    }
    return [...nachSchluessel.values()].sort((a, b) => `${a.datei}|${a.fn}`.localeCompare(`${b.datei}|${b.fn}`))
}

/**
 * **Jede Auflösung einer Empfangsadresse, mit ihrem ARGUMENT.**
 *
 * `argumente` hält je Vorkommen einen Textausschnitt fest, der auf der Zeile stehen
 * muss. Damit ist nicht nur der Aufruf inventarisiert, sondern das, was er auflöst:
 * wer `profile?.lud16` gegen etwas anderes tauscht, wird hier rot — auch dann, wenn
 * das Neue gar kein Profilfeld mehr ist und Ebene 2 es deshalb nicht sähe.
 */
const AUFLOESER_INVENTAR: { datei: string; fn: string; argumente: string[]; warum: string }[] = [
    {
        datei: 'js/bridge.ts',
        fn: 'getLnUrl',
        argumente: ["getLnUrl(profile?.lud16 || profile?.lud06 || '')"],
        warum: 'Zap-Sheet (5978) — Profil aus dem Repository.',
    },
    {
        datei: 'js/bridge.ts',
        fn: 'getZapper',
        argumente: ['getZapper(lnurl)'],
        warum: 'Zapper-Cache zu der eine Zeile darüber aufgelösten lnurl.',
    },
    {
        datei: 'js/bridge.ts',
        fn: 'loadZapperNow',
        argumente: ['loadZapperNow(lnurl)'],
        warum: 'Nachladen derselben lnurl beim Nutzer-Tap.',
    },
    {
        datei: 'js/bridge.ts',
        fn: 'lnurlInvoice',
        argumente: ['lnurlInvoice(req, this.payAmountSats)'],
        warum: 'Wallet-Senden: `req` ist die vom Nutzer eingegebene bzw. eingescannte Adresse, kein Profilwert.',
    },
    {
        datei: 'js/feeds.ts',
        fn: 'getLnUrl',
        argumente: ["getLnUrl(profile?.lud16 || profile?.lud06 || '')", "getLnUrl(profile?.lud16 || profile?.lud06 || '')"],
        warum: 'Zap-Ziel der Chat-Nachricht (939) und Cache-Key (1122) — beide aus der gemergten Map, die Ebene 3 trägt.',
    },
    {
        datei: 'js/longformFeed.ts',
        fn: 'getLnUrl',
        argumente: ["getLnUrl(profil?.lud16 || profil?.lud06 || '')"],
        warum: 'Zap-ZÄHLER der Artikelfläche (P6, `zapperNachschlag`): der Zapper des AUTORS wird gebraucht, um seine 9735-Quittungen zu validieren — ohne ihn verwirft `zapFromEvent` jede und der Zähler bliebe auf null. Aufgelöst wird ausschließlich aus der gemergten Map, die Ebene 3 trägt; es wird nichts bezahlt und nichts angezeigt außer einer Summe.',
    },
    {
        datei: 'js/wallet.ts',
        fn: 'getLnUrl',
        argumente: ['getLnUrl(address.trim())'],
        warum: 'Plain-LNURL-Zahlung: die Adresse kommt als Parameter vom Nutzer (Eingabefeld/QR), nicht aus einem Profil.',
    },
    {
        datei: 'js/zaps.ts',
        fn: 'getZapper',
        argumente: ['getZapper(lnurl)'],
        warum: 'Cache-Blick auf die übergebene lnurl.',
    },
    {
        datei: 'js/zaps.ts',
        fn: 'loadZapperNow',
        argumente: ['loadZapperNow(profile.lnurl)'],
        warum: 'Vorwärmen aus dem NATIVEN Profil (`loadProfile`).',
    },
    {
        datei: 'js/zaps.ts',
        fn: 'loadZapperForPubkey',
        argumente: ['loadZapperForPubkey(pubkey)'],
        warum: 'welshmans eigener Weg Profil→lnurl→Zapper; er liest das Repository, nicht unsere Zweitquelle.',
    },
    {
        datei: 'js/zaps.ts',
        fn: 'resolveZapper',
        argumente: ['resolveZapper(input.pubkey)'],
        warum: 'Zap-Ablauf ohne mitgegebenen Zapper — landet in `loadZapperForPubkey`.',
    },
]

/**
 * **Das Inventar.** Jede Zeile ist eine bewusste Entscheidung; `quelle` wird gegen
 * den Quelltext geprüft, `treffer` gegen die Zahl der Vorkommen.
 */
const INVENTAR: Deklaration[] = [
    // ── TypeScript ──────────────────────────────────────────────────────────
    {
        datei: 'js/bridge.ts',
        ausdruck: 'p.lud16',
        quellen: ['deriveMergedProfile', 'userProfile'],
        warum: 'Zwei verschiedene Quellen unter EINEM Ausdruck: die Profilkarte (1764) liest ein GEMERGTES Objekt — genau der Fall, den Ebene 3 trägt —, das Wallet (1843) spiegelt das eigene, signierte `userProfile`.',
    },
    {
        datei: 'js/bridge.ts',
        ausdruck: 'p.nip05',
        quellen: ['userProfile'],
        warum: 'Wallet zeigt den eigenen NIP-05-Rohwert an (`profileNip05`) — eigenes, signiertes kind 0.',
    },
    {
        datei: 'js/bridge.ts',
        ausdruck: 'handle.nip05',
        quellen: ['deriveHandleForPubkey', 'deriveHandleForPubkey'],
        warum: 'welshman-Handle: nur bei bestätigtem nostr.json↔pubkey-Match gesetzt (Profilkarte 1754, eigene Kopfzeile 6561).',
    },
    {
        datei: 'js/bridge.ts',
        ausdruck: 'autor.nip05',
        quellen: ['autor-modell'],
        warum: 'Der Profil-Verweis nach media. (`nostrArticleAuthor.medienUrl`): die öffentliche Adresse trägt den NIP-05-Handle nur, wenn er BESTÄTIGT ist — sonst die npub. Ein unverifizierter Handle führte auf eine fremde Person, mit unserer Empfehlung im Rücken. Der Wert ist das fertige Autorenmodell aus `deriveAuthorPage`, dessen `nip05` in `buildArticleAuthor` aus `verifiedNip05(…)` entsteht. Die Adressbildung selbst liegt in `js/medienProfil.ts` und ist dort samt Verwechslungs-Fall geprüft; dass beide Flächen sie benutzen, hält `js/medienProfilMarkup.test.ts` fest.',
    },
    {
        datei: 'js/bridge.ts',
        ausdruck: 'profile.lud16',
        quellen: ['getProfile'],
        warum: 'Zap-Sheet (5978): das Zahlungsziel kommt aus dem Repository, nicht aus dem gemergten Objekt.',
    },
    {
        datei: 'js/bridge.ts',
        ausdruck: 'profile.lud06',
        quellen: ['getProfile'],
        warum: 'Zweite Hälfte desselben Ausdrucks (5978).',
    },
    {
        datei: 'js/feeds.ts',
        ausdruck: 'profile.lud16',
        quellen: ['$profiles', '$profiles'],
        warum: 'Zap-Ziel der Chat-Nachricht (939) und derselbe Wert im Cache-Key (1122). Quelle ist die GEMERGTE Map — trägt Ebene 3.',
    },
    {
        datei: 'js/feeds.ts',
        ausdruck: 'profile.lud06',
        quellen: ['$profiles', '$profiles'],
        warum: 'Zweite Hälfte derselben zwei Ausdrücke.',
    },
    {
        datei: 'js/handles.ts',
        ausdruck: 'profiles.get(pubkey).nip05',
        quellen: ['profiles-parameter'],
        warum: 'Der Wert kommt vom Aufrufer; welche Map das ist, prüft der Aufrufer-Hop unten. Ein Häkchen entsteht ohnehin nur bei bestätigtem nostr.json-Match.',
    },
    {
        datei: 'js/longform.ts',
        ausdruck: 'deps.nip05',
        quellen: ['autor-deps-parameter'],
        warum: 'Autorenkarte der Artikel-Vollansicht (P3): reine Durchreiche eines Parameters. Welche Map dahintersteht, prüft der Aufrufer-Hop `buildArticleAuthor` unten — und ein Zahlungsfeld kommt hier gar nicht an, `ArticleAuthorDeps` trägt nur `hatLightning: boolean`.',
    },
    {
        datei: 'js/longformFeed.ts',
        ausdruck: 'profil.lud16',
        quellen: ['$profiles', '$profiles', '$profiles'],
        warum: 'DREI Stellen, und die dritte ist seit P6 eine andere Art von Leser. Zwei machen aus der Adresse nur ein Ja/Nein (`hatLightning` in `deriveArticle` und `deriveAuthorPage`); die dritte, `zapperNachschlag`, reicht sie an `getLnUrl` weiter, um den LNURL-Zapper des AUTORS im Store zu finden — nötig, weil `zapFromEvent` den Signer einer Zap-Quittung gegen dessen `nostrPubkey` prüft. Auch dort verlässt die Adresse die Datei nicht: hinaus geht der bech32-Schlüssel, und was zurückkommt, ist ein Zapper-Objekt. Quelle ist alle drei Male die GEMERGTE Map, trägt Ebene 3.',
    },
    {
        datei: 'js/longformFeed.ts',
        ausdruck: 'profil.lud06',
        quellen: ['$profiles'],
        warum: 'Der Rückfall derselben Zeile (`zapperNachschlag`, P6): welshmans `getLnUrl` nimmt lud16 ODER lud06. Dasselbe Muster und dieselbe Quelle wie in `feeds.ts` (Chat) und `bridge.ts` (Zap-Sheet); ohne den Rückfall bekäme ein Autor mit nur lud06 dauerhaft keinen Zap-Zähler.',
    },
    {
        datei: 'js/vereinFlow.ts',
        ausdruck: 'input.nip05',
        quellen: ['formular-input'],
        warum: 'Kein Profil-Leser: der Nutzer tippt seinen Handle in das Vereins-Antragsformular. Steht hier, damit der Scanner vollständig bleibt.',
    },
    {
        datei: 'js/zaps.ts',
        ausdruck: 'profile.lnurl',
        quellen: ['loadProfile', 'loadProfile'],
        warum: 'Zapper-Vorwärmen (271 Prüfung, 272 Auflösung): `loadProfile` liefert das native Profil aus welshman, nie die Zweitquelle.',
    },
    {
        datei: 'js/zaps.ts',
        ausdruck: 'zapper.lnurl',
        quellen: ['zapper'],
        warum: 'Rückgabe des LNURL-Dokuments, das aus einer bereits klassifizierten Adresse aufgelöst wurde.',
    },

    // ── Markup ──────────────────────────────────────────────────────────────
    {
        datei: 'resources/views/⚡article.blade.php',
        ausdruck: 'article.author.nip05',
        // Drei Vorkommen: das Häkchen (`nostr-nip05`) und die Zeile darunter, die den
        // Handle als Text zeigt — letztere zweimal (`x-show` und `x-text`).
        quellen: ['markup', 'markup', 'markup'],
        modell: { datei: 'js/longformFeed.ts', token: 'verifiedNip05(' },
        warum: 'Autorenkarte der Artikel-Vollansicht (Häkchen + Zeile darunter): `nip05` der Karte ist der VERIFIZIERTE Handle aus `buildArticleAuthor`, nicht der Profil-Rohwert. Eine Zahlungsadresse steht in dieser Datei gar nicht — der Lightning-Einstieg liest `hatLightning`, einen Wahrheitswert.',
    },
    {
        datei: 'resources/views/⚡article-author.blade.php',
        ausdruck: 'autor.nip05',
        // VIER Vorkommen, und das vierte ist keins der drei aus `⚡article.blade.php`:
        // die Bedingung, ob die Autorenkarte überhaupt erscheint (`x-if`, sie erscheint nur,
        // wenn sie etwas trägt), dann das Häkchen (`nostr-nip05`), das `x-show` der Zeile
        // darunter und ihr `x-text`. Der erste liest den Handle nur auf Vorhandensein.
        quellen: ['markup', 'markup', 'markup', 'markup'],
        modell: { datei: 'js/longformFeed.ts', token: 'verifiedNip05(' },
        warum: 'Autorenkarte der Autorenseite (P4): `nip05` der Karte ist der VERIFIZIERTE Handle aus `buildArticleAuthor`, nicht der Profil-Rohwert. Eine Zahlungsadresse steht in dieser Datei gar nicht — der Lightning-Einstieg liest `autor.lightning`, einen von drei Zuständen.',
    },
    {
        datei: 'resources/views/⚡directory.blade.php',
        ausdruck: 'm.nip05',
        quellen: ['markup', 'markup'],
        modell: { datei: 'js/members.ts', token: 'verifiedNip05(' },
        warum: 'Mitgliederliste (Häkchen + Zeile): `nip05` des Modells ist der VERIFIZIERTE Handle, nicht der Profil-Rohwert.',
    },
    {
        datei: 'resources/views/⚡room.blade.php',
        ausdruck: 'threadRoot.nip05',
        quellen: ['markup'],
        modell: { datei: 'js/feeds.ts', token: 'verifiedNip05(' },
        warum: 'Thread-Wurzel aus `personFields` — derselbe verifizierte Handle.',
    },
    {
        datei: 'resources/views/components/command-palette.blade.php',
        ausdruck: 'member.nip05',
        quellen: ['markup'],
        modell: { datei: 'js/members.ts', token: 'verifiedNip05(' },
        warum: 'Palette zeigt dieselben Mitglieder-Modelle.',
    },
    {
        datei: 'resources/views/partials/chat-row.blade.php',
        ausdruck: 'm.nip05',
        quellen: ['markup'],
        modell: { datei: 'js/feeds.ts', token: 'verifiedNip05(' },
        warum: 'Chat-Zeile aus `personFields` — verifizierter Handle.',
    },
]

const schluesselVon = (d: { datei: string; ausdruck: string }): string => `${d.datei}|${d.ausdruck}`

describe('Ebene 1 — Inventar: jeder Leser eines Zahlungs-/Identitätsfeldes ist bekannt', () => {
    const gefunden = scanne()

    test('KALIBRIERUNG: der Scanner ist nicht blind', () => {
        // Ein Inventar-Test, dessen Scanner nichts findet, ist immer grün. Die drei
        // Stellen, an denen das Zap-Ziel entsteht, MÜSSEN im Rohergebnis stehen.
        const schluessel = gefunden.map(schluesselVon)
        assert.ok(schluessel.includes('js/feeds.ts|profile.lud16'), 'feeds.ts baut das Zap-Ziel — der Scanner muss es sehen')
        assert.ok(schluessel.includes('js/bridge.ts|profile.lud16'), 'bridge.ts (Zap-Sheet) fehlt im Scan')
        assert.ok(schluessel.includes('js/zaps.ts|profile.lnurl'), 'zaps.ts (Zapper-Vorwärmen) fehlt im Scan')
        assert.ok(schluessel.includes('js/handles.ts|profiles.get(pubkey).nip05'), 'ein Empfänger mit Klammern darf nicht durchrutschen')
        assert.ok(gefunden.length >= 10, `zu wenige Fundstellen (${gefunden.length}) — der Scanner greift nicht`)
    })

    test('kein unbekannter Leser, keine verwaiste Deklaration', () => {
        assert.deepEqual(
            gefunden.map(schluesselVon).sort(),
            INVENTAR.map(schluesselVon).sort(),
            'Ein Zugriff auf lud16/lud06/lnurl/nip05 ist ohne Eintrag im INVENTAR nicht erlaubt — trag ihn ein und sag, woher das Profil kommt.',
        )
    })

    test('… und auch die ANZAHL der Vorkommen je Stelle stimmt', () => {
        // Sonst verschwände ein zweiter Zugriff in einer bereits deklarierten Datei.
        const erwartet = new Map(INVENTAR.map((d) => [schluesselVon(d), d.quellen.length]))
        for (const fund of gefunden) {
            assert.equal(
                fund.treffer,
                erwartet.get(schluesselVon(fund)),
                `${schluesselVon(fund)}: ${fund.treffer} Vorkommen (Zeilen ${fund.zeilen.join(', ')}), deklariert ${erwartet.get(schluesselVon(fund))}`,
            )
        }
    })
})

describe('Ebene 1b — Inventar: jede Auflösung einer Empfangsadresse ist bekannt', () => {
    const gefunden = scanneAufloeser()

    test('KALIBRIERUNG: die Auflöser-Suche greift', () => {
        assert.ok(
            gefunden.some((a) => a.datei === 'js/feeds.ts' && a.fn === 'getLnUrl'),
            'der bekannteste Auflöser fehlt im Scan',
        )
        assert.ok(gefunden.length >= 8, `zu wenige Auflösungen gefunden (${gefunden.length})`)
    })

    test('kein unbekannter Auflöser', () => {
        assert.deepEqual(
            gefunden.map((a) => `${a.datei}|${a.fn}`).sort(),
            AUFLOESER_INVENTAR.map((a) => `${a.datei}|${a.fn}`).sort(),
            'Eine neue Stelle, die eine Empfangsadresse auflöst — eintragen und sagen, woher ihr Argument kommt.',
        )
    })

    test('und jeder löst genau das auf, was deklariert ist', () => {
        const erwartet = new Map(AUFLOESER_INVENTAR.map((a) => [`${a.datei}|${a.fn}`, a.argumente]))
        for (const aufloesung of gefunden) {
            const argumente = erwartet.get(`${aufloesung.datei}|${aufloesung.fn}`)!
            assert.equal(aufloesung.zeilen.length, argumente.length, `${aufloesung.datei}: ${aufloesung.fn} in Zeilen ${aufloesung.zeilen.join(', ')}`)
            aufloesung.texte.forEach((text, i) => {
                assert.ok(
                    text.includes(argumente[i]!),
                    `${aufloesung.datei}:${aufloesung.zeilen[i]}: aufgelöst wird „${text}", deklariert war „${argumente[i]}"`,
                )
            })
        }
    })
})

/**
 * Die Bindung des Empfängers im Quelltext suchen: erst eine `const/let/var`-Zuweisung,
 * sonst die nächstgelegene Parameter-/Callback-Zeile, die den Namen einführt.
 */
const bindungFuer = (zeilen: string[], zeileNr: number, wurzel: string): string => {
    const zuweisung = new RegExp(`\\b(?:const|let|var)\\s+${wurzel}\\s*=`)
    // Ein Callback-Parameter: `(p) => …`, `(p: Profile) => …`. Ohne den `=>` griff das
    // Muster auch bei einer bloßen VERWENDUNG (`displayProfile(p, fallback)`) und lieferte
    // eine Zeile, die über die Herkunft nichts sagt.
    const pfeilParameter = new RegExp(`\\(\\s*${wurzel}\\s*(?::[^)]*)?\\)\\s*=>`)
    // Ein benannter Parameter in einer Signatur — auch als eigene Zeile in einer
    // mehrzeiligen Parameterliste (`    profiles: Map<…>,`).
    const typParameter = new RegExp(`(?:[(,]|^)\\s*${wurzel}\\s*:`)
    for (let i = zeileNr - 1; i >= Math.max(0, zeileNr - 60); i--) {
        const zeile = zeilen[i] ?? ''
        if (zuweisung.test(zeile) || pfeilParameter.test(zeile) || typParameter.test(zeile)) {
            return zeile.trim()
        }
    }
    return ''
}

const klasseVon = (text: string): { schluessel: string; klasse: string } => {
    for (const p of PRODUZENTEN) {
        if (p.muster.test(text)) {
            return { schluessel: p.schluessel, klasse: p.klasse }
        }
    }
    return { schluessel: 'unbekannt', klasse: 'unbekannt' }
}

describe('Ebene 2 — Herkunft: die deklarierte Quelle steht wirklich im Code', () => {
    const gefunden = scanne()
    const nachSchluessel = new Map(gefunden.map((f) => [schluesselVon(f), f]))

    for (const deklaration of INVENTAR.filter((d) => !d.quellen.includes('markup'))) {
        test(`${deklaration.datei} · ${deklaration.ausdruck} ⇐ ${deklaration.quellen.join(' + ')}`, () => {
            const fund = nachSchluessel.get(schluesselVon(deklaration))
            assert.ok(fund, 'Fundstelle nicht mehr im Code — Deklaration entfernen')
            const zeilen = ohneKommentare(readFileSync(join(PAKET_DIR, deklaration.datei), 'utf8'), false)
            const wurzel = deklaration.ausdruck.split(/[.?([]/)[0]!

            fund.zeilen.forEach((zeileNr, i) => {
                const kontext = `${deklaration.ausdruck} ${bindungFuer(zeilen, zeileNr - 1, wurzel)}`
                const { schluessel, klasse } = klasseVon(kontext)

                assert.equal(
                    schluessel,
                    deklaration.quellen[i],
                    `${deklaration.datei}:${zeileNr}: die Quelle im Code ist „${schluessel}", deklariert war „${deklaration.quellen[i]}" — Bindung: ${kontext}`,
                )

                const erlaubt = ZAHLUNGSFELDER.includes(fund.feld) ? ZAHLUNG_ERLAUBT : IDENTITAET_ERLAUBT
                if (deklaration.unverifiziert) {
                    assert.ok(
                        !ZAHLUNGSFELDER.includes(fund.feld),
                        `${deklaration.datei}:${zeileNr}: ein ZAHLUNGSFELD aus einer unverifizierten Fremdquelle ist nie zulässig`,
                    )
                } else {
                    assert.ok(
                        erlaubt.has(klasse),
                        `${deklaration.datei}:${zeileNr}: ${fund.feld} aus Klasse „${klasse}" — nicht zulässig. Zahlungsdaten kommen ausschließlich aus dem Repository.`,
                    )
                }
            })
        })
    }

    test('Markup: der angezeigte Wert stammt aus dem deklarierten Modell', () => {
        for (const deklaration of INVENTAR.filter((d) => d.quellen.includes('markup'))) {
            const modell = deklaration.modell
            assert.ok(modell, `${deklaration.datei}: Markup-Eintrag ohne Modell-Angabe`)
            const quelle = readFileSync(join(PAKET_DIR, modell.datei), 'utf8')
            assert.ok(
                quelle.includes(modell.token),
                `${deklaration.datei}: ${modell.datei} enthält „${modell.token}" nicht mehr — das Markup zeigt etwas anderes an als deklariert`,
            )
        }
    })

    test('AUFRUFER-HOP: buildArticleAuthor bekommt einen VERIFIZIERTEN Handle und ein Ja/Nein', () => {
        // `longform.ts` liest `deps.nip05` aus einem Parameter — die Klassifikation liegt
        // damit beim Aufrufer, genau wie bei `verifiedNip05`. Zwei Zusagen:
        //  · das `nip05` stammt aus `verifiedNip05(…)`, nie aus einem Profil-Rohwert;
        //  · `hatLightning` ist ein Vergleich, keine durchgereichte Adresse.
        const dateien = dateienUnter(join(PAKET_DIR, 'js'), '.ts').filter((p) => !p.endsWith('.test.ts'))
        const aufrufe: { datei: string; zeile: number; block: string }[] = []
        for (const pfad of dateien) {
            const datei = relative(PAKET_DIR, pfad).split(sep).join('/')
            const zeilen = ohneKommentare(readFileSync(pfad, 'utf8'), false)
            zeilen.forEach((zeile, i) => {
                if (/\bbuildArticleAuthor\s*\(/.test(zeile) && !/export const buildArticleAuthor/.test(zeile)) {
                    // Der Argumentblock geht über mehrere Zeilen; 14 reichen für das
                    // Objektliteral samt seiner Begruendungen und sind kleiner als jede Nachbar-Funktion.
                    aufrufe.push({ datei, zeile: i + 1, block: zeilen.slice(i, i + 26).join('\n') })
                }
            })
        }

        // Die Schranke zuerst — ein Test über null Aufrufer ist fail-open.
        // ZWEI seit P4: `deriveArticle` (Vollansicht) und `deriveAuthorPage` (Autorenseite).
        // Die Zahl ist die Schranke — ein dritter Aufrufer muss hier auffallen und
        // dieselben zwei Zusagen unterschreiben, nicht still danebenstehen.
        assert.equal(aufrufe.length, 2, `buildArticleAuthor-Aufrufe: ${aufrufe.map((a) => `${a.datei}:${a.zeile}`).join(', ')}`)
        for (const aufruf of aufrufe) {
            assert.match(
                aufruf.block,
                /nip05:\s*verifiedNip05\(/,
                `${aufruf.datei}:${aufruf.zeile}: nip05 muss aus verifiedNip05(…) kommen, nicht aus einem Profil-Rohwert`,
            )
            assert.match(
                aufruf.block,
                /hatLightning:\s*\(profil\?\.lud16 \?\? ''\) !== ''/,
                `${aufruf.datei}:${aufruf.zeile}: hatLightning muss ein Vergleich auf der gemergten Map sein — keine durchgereichte Adresse`,
            )
        }
    })

    test('AUFRUFER-HOP: verifiedNip05 bekommt immer die gemergte Profil-Map', () => {
        // `handles.ts` liest `nip05` aus einem PARAMETER — die Klassifikation liegt
        // damit beim Aufrufer. Ohne diese Zusage wäre die Kette dort offen.
        const dateien = dateienUnter(join(PAKET_DIR, 'js'), '.ts').filter((p) => !p.endsWith('.test.ts'))
        const aufrufe: string[] = []
        for (const pfad of dateien) {
            const datei = relative(PAKET_DIR, pfad).split(sep).join('/')
            ohneKommentare(readFileSync(pfad, 'utf8'), false).forEach((zeile, i) => {
                if (/\bverifiedNip05\s*\(/.test(zeile) && !/export const verifiedNip05/.test(zeile)) {
                    aufrufe.push(`${datei}:${i + 1}:${zeile.trim()}`)
                }
            })
        }

        // FÜNF seit P4 — der neue ist `deriveAuthorPage` in `longformFeed.ts`.
        assert.equal(aufrufe.length, 5, `verifiedNip05-Aufrufe: ${aufrufe.join(' || ')}`)
        for (const aufruf of aufrufe) {
            assert.match(
                aufruf,
                /verifiedNip05\([^,]+,\s*(?:ctx\.)?\$profiles\s*,/,
                `${aufruf}: das zweite Argument muss die gemergte Profil-Map sein`,
            )
        }
    })
})

// ════════════════════════════════════════════════════════════════════════════
// Ebene 3 — Die Fremdquelle trägt die Felder gar nicht
// ════════════════════════════════════════════════════════════════════════════

const SPACE = normalizeRelayUrl('wss://buzz.zapziel.invalid/')

/** Die Werte, die ein feindliches Relay unterschieben würde — je einmalig, damit sie im JSON auffindbar sind. */
const GIFT = {
    lud16: 'angreifer-zz@wallet.invalid',
    lud06: 'lnurl1dp68gurn8ghj7ampd3kx2ar0veekzar0wd5xjtnrdakj7zzgiftzz',
    nip05: 'praesident-zz@buzz.zapziel.invalid',
} as const

const opferSecret = generateSecretKey()
const opferPubkey = getPublicKey(opferSecret)
const nurSpaceSecret = generateSecretKey()
const nurSpacePubkey = getPublicKey(nurSpaceSecret)
const PUBKEYS = [opferPubkey, nurSpacePubkey]

const kind0 = (secret: Uint8Array, content: Record<string, string>, created_at: number): TrustedEvent =>
    finalizeEvent({ kind: PROFILE, created_at, tags: [], content: JSON.stringify(content) }, secret) as unknown as TrustedEvent

/**
 * Das native Profil des Opfers: Name gepflegt, `about` LEER — damit der Merge-Zweig
 * (natives Profil vorhanden, Lücke wird gefüllt) tatsächlich läuft und der Test
 * nicht nur den Kurzschluss misst.
 */
const nativesProfil = kind0(opferSecret, { name: 'Echte Person', picture: 'https://image.nostr.build/echt.jpg' }, 1_700_000_000)

const feindlich = (name: string): Record<string, string> => ({
    display_name: name,
    about: 'Workspace-Konto',
    picture: 'https://buzz.zapziel.invalid/media/x.jpg',
    lud16: GIFT.lud16,
    lud06: GIFT.lud06,
    nip05: GIFT.nip05,
})

/** Beide Zweige feindlich: MIT nativem Profil (jünger!) und OHNE. */
const spaceProfilOpfer = kind0(opferSecret, { name: 'Buzz-Name', ...feindlich('BuzzPraesident') }, 1_800_000_000)
const spaceProfilNurSpace = kind0(nurSpaceSecret, feindlich('nostr-specialist'), 1_800_000_001)

const tick = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * Alle Ausgänge von `spaceProfiles.ts` und wie sie geprüft werden.
 *
 * `anzeige: true` = das Ergebnis landet in der Fläche; dort darf auch kein
 * Space-EVENT hängen (an dem die Felder sonst wieder dranhingen).
 */
const AUSGAENGE: Record<string, { anzeige: boolean; probe: () => unknown[] }> = {
    spaceProfilesByPubkey: { anzeige: false, probe: () => [...get(spaceProfilesByPubkey).values()] },
    getSpaceProfile: { anzeige: false, probe: () => PUBKEYS.map(getSpaceProfile) },
    profilesByPubkey: { anzeige: true, probe: () => [...get(profilesByPubkey).values()] },
    getMergedProfile: { anzeige: true, probe: () => PUBKEYS.map(getMergedProfile) },
    deriveMergedProfile: { anzeige: true, probe: () => PUBKEYS.map((pk) => get(deriveMergedProfile(pk))) },
    displayProfileByPubkey: { anzeige: true, probe: () => PUBKEYS.map(displayProfileByPubkey) },
    // Kein Ausgang: nimmt Daten AUF bzw. räumt auf. Wird oben scharf gefahren.
    loadSpaceProfiles: { anzeige: false, probe: () => [] },
    purgeSpaceLocalProfiles: { anzeige: false, probe: () => [] },
    // Kein Ausgang: reine Steuerfunktionen des Anlauf-Riegels (markieren/entsperren
    // einen pubkey als "natives Laden läuft") — geben nie ein Profil-Objekt zurück,
    // tragen also strukturell keine Zahlungs-/Identitätsfelder.
    markNativePending: { anzeige: false, probe: () => [] },
    clearNativePending: { anzeige: false, probe: () => [] },
}

type Ernte = { objekte: Record<string, unknown>[]; strings: string[]; events: TrustedEvent[] }

/** Rekursiv einsammeln — der `event`-Teilbaum wird getrennt behandelt, nicht ignoriert. */
const ernte = (wert: unknown, ziel: Ernte = { objekte: [], strings: [], events: [] }): Ernte => {
    if (typeof wert === 'string') {
        ziel.strings.push(wert)
        return ziel
    }
    if (wert instanceof Map) {
        wert.forEach((v) => ernte(v, ziel))
        return ziel
    }
    if (Array.isArray(wert)) {
        wert.forEach((v) => ernte(v, ziel))
        return ziel
    }
    if (wert && typeof wert === 'object') {
        const objekt = wert as Record<string, unknown>
        ziel.objekte.push(objekt)
        for (const [schluessel, v] of Object.entries(objekt)) {
            if (schluessel === 'event') {
                if (v && typeof v === 'object') {
                    ziel.events.push(v as TrustedEvent)
                }
                continue
            }
            ernte(v, ziel)
        }
    }
    return ziel
}

describe('Ebene 3 — kein Ausgang der Fremdquelle trägt Zahlungs- oder Identitätsdaten', () => {
    const originalGetAdapter = netContext.getAdapter
    const originalIsEventValid = netContext.isEventValid
    let unsubscribe: () => void

    before(async () => {
        netContext.getAdapter = (): AbstractAdapter => {
            const adapter: MockAdapter = new MockAdapter(SPACE, (message: ClientMessage) => {
                if (message[0] !== 'REQ') {
                    return
                }
                const subId = message[1] as string
                setTimeout(() => {
                    adapter.receive(['EVENT', subId, spaceProfilOpfer])
                    adapter.receive(['EVENT', subId, spaceProfilNurSpace])
                    adapter.receive(['EOSE', subId])
                }, 0)
            })
            return adapter
        }
        // Der Riegel aus `core.ts` — ohne ihn wäre der Test grün aus dem falschen Grund.
        netContext.isEventValid = (event: TrustedEvent, url: string) =>
            event.kind === PROFILE && normalizeRelayUrl(url) === SPACE ? false : verifyEvent(event)

        unsubscribe = profilesByPubkey.subscribe(() => {})
        repository.publish(nativesProfil)
        await tick(50)
        await loadSpaceProfiles(SPACE, PUBKEYS)
        await tick(250)
    })

    after(() => {
        unsubscribe()
        netContext.getAdapter = originalGetAdapter
        netContext.isEventValid = originalIsEventValid
    })

    test('KALIBRIERUNG: das Fixture IST feindlich — roh trägt es alle vier Felder', () => {
        // Ohne diese Zusage misst der Rest nichts: ein Fixture ohne Zahlungsfelder
        // wäre auf jeder Seite der Regel grün. `lnurl` setzt welshmans `readProfile`
        // selbst aus `lud16` — es steht nicht im Event und ist trotzdem da.
        const roh = readProfile(spaceProfilNurSpace)
        assert.equal(roh.lud16, GIFT.lud16)
        assert.equal(roh.lud06, GIFT.lud06)
        assert.equal(roh.nip05, GIFT.nip05)
        assert.ok(roh.lnurl && roh.lnurl.startsWith('lnurl1'), `welshman leitet lnurl ab: ${roh.lnurl}`)
    })

    test('KALIBRIERUNG: beide Zweige sind wirklich belegt', () => {
        // Zweig A: natives Profil vorhanden (Merge). Zweig B: keins (Kurzschluss) —
        // der im Workspace gemessene NORMALFALL, an dem der Fehler durchrutschte.
        assert.equal(get(profilesByPubkey).get(opferPubkey)?.name, 'Echte Person', 'natives Profil muss geladen sein')
        assert.equal(repository.query([{ kinds: [PROFILE], authors: [nurSpacePubkey] }]).length, 0, 'für diesen Pubkey darf es KEIN natives Profil geben')
        assert.equal(get(spaceProfilesByPubkey).size, 2, 'beide Space-Profile müssen angekommen sein')
        assert.equal(get(profilesByPubkey).get(nurSpacePubkey)?.display_name, 'nostr-specialist', 'der Kurzschluss-Zweig muss etwas liefern')
    })

    test('jeder Export ist als Ausgang klassifiziert', () => {
        // Ein neuer Export ist ein neuer Weg nach draußen. Er darf nicht ungeprüft
        // dazukommen — genau das ist die Lücke, an der eine Liste bekannter Leser still bleibt.
        assert.deepEqual(
            Object.keys(spaceProfilesModul).sort(),
            Object.keys(AUSGAENGE).sort(),
            'Neuer Ausgang aus spaceProfiles.ts: in AUSGAENGE eintragen und sagen, wie er geprüft wird.',
        )
    })

    for (const [name, { anzeige, probe }] of Object.entries(AUSGAENGE)) {
        test(`${name}: keine Zahlungs-/Identitätsdaten am Ausgang`, () => {
            const werte = probe()
            const gesammelt = ernte(werte)

            for (const objekt of gesammelt.objekte) {
                for (const feld of FELDER) {
                    assert.equal(
                        objekt[feld],
                        undefined,
                        `${name}: Feld „${feld}" am Ausgang (${JSON.stringify(objekt).slice(0, 160)})`,
                    )
                }
            }

            // Der `event`-Teilbaum bleibt aus dem Wert-Abgleich draußen und wird gleich
            // EIGENS geprüft: die Zweitquelle hält das rohe Space-Event absichtlich (sie
            // vergleicht daran Zeitstempel), sein `content` trägt die Giftwerte also zu
            // Recht. Unzulässig ist nur, dass dieses Event an einem ANZEIGE-Objekt hängt.
            const text =
                JSON.stringify(gesammelt.objekte, (schluessel, wert) => (schluessel === 'event' ? undefined : wert)) +
                gesammelt.strings.join(' ')
            for (const [feld, wert] of Object.entries(GIFT)) {
                assert.ok(!text.includes(wert), `${name}: der Wert aus „${feld}" der Fremdquelle taucht am Ausgang auf`)
            }

            if (anzeige) {
                for (const event of gesammelt.events) {
                    assert.notEqual(event.id, spaceProfilOpfer.id, `${name}: das Space-Event hängt am Anzeige-Objekt`)
                    assert.notEqual(event.id, spaceProfilNurSpace.id, `${name}: das Space-Event hängt am Anzeige-Objekt`)
                }
            }
        })
    }

    test('GEGENPROBE: die erlaubten Felder kommen sehr wohl durch', () => {
        // Sonst wäre die ganze Ebene auch dann grün, wenn die Zweitquelle gar nichts
        // liefert — „nichts durchgelassen" ist keine Leistung, wenn nichts ankommt.
        const gemergt = get(profilesByPubkey).get(nurSpacePubkey)
        assert.equal(gemergt?.display_name, 'nostr-specialist')
        assert.equal(gemergt?.about, 'Workspace-Konto')
        assert.equal(gemergt?.picture, 'https://buzz.zapziel.invalid/media/x.jpg')
    })
})

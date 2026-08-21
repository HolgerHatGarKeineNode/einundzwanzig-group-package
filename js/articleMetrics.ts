/**
 * Sozialsignale eines Longform-Artikels (P6, LESEND): Reaktionen, Zaps, Kommentare.
 *
 * Rein bis auf `@welshman/util` — kein `core`, kein `@welshman/app`, kein Store. Damit
 * ist diese Datei unter `node --test` ladbar (gemessen 2026-08-21), im Gegensatz zu
 * `feeds.ts` und `longformFeed.ts`. Alles, was ein Relay oder einen Store braucht, steht
 * in `longformFeed.ts`.
 *
 * ── Die Filterform ist der ganze Trick, und sie wurde gemessen ──────────────────────
 *
 * Ein Artikel ist ein ERSETZBARES Event (kind 30023). Auf so etwas kann man auf zwei
 * Arten zeigen, und beide kommen im Bestand vor:
 *
 *  · über die **Adresse** — `["a", "30023:<pubkey>:<d>"]` (NIP-01). Zeigt auf „den
 *    Artikel", überlebt jede Überarbeitung.
 *  · über die **Event-Id** — `["e", "<id>"]`. Zeigt auf **eine Fassung**.
 *
 * Am Bestand vom **2026-08-21** (104 Artikel, drei Relays: das Vereins-Board, `nos.lol`,
 * `relay.damus.io`), Union über alle drei:
 *
 * | Kind | Union | nur mit `#a` gefunden | verloren |
 * |------|-------|-----------------------|----------|
 * | 7 (Reaktion)  | 465 | 390 | **75 (16 %)** |
 * | 9735 (Zap)    | 168 | 155 | **13 (7,7 %)** |
 *
 * **Auf die ANGEZEIGTEN Werte übersetzt** — also nach Deduplizierung je (Autor, Emoji)
 * und nach welshmans Zap-Validierung, nicht auf die Rohzahlen oben. Dieselbe Messung, mit
 * `#a`-only gegen die volle Union gerechnet:
 *
 * | abweichend bei | Artikel (von 104) |
 * |---|---|
 * | Reaktionszähler | **39** |
 * | Zap-Zahl und Sat-Summe | **9** |
 * | Kommentarzahl | **3** |
 * | irgendeinem Wert | **40** |
 *
 * Dazu verlöre **ein** Artikel seinen Zähler vollständig, und in der Sat-Summe über den
 * ganzen Bestand fehlten 298 von 18 804 Sats. Deshalb fragt {@link artikelMetrikFilters}
 * **beide Formen** ab und dedupliziert danach über die Event-Id.
 *
 * **Das korrigiert eine ältere Messung ausdrücklich.** Der Plan hielt fest: „78 von 78
 * Quittungen tragen ein `a`-Tag — die Anzeige braucht nur einen `#a`-Filter." Heute sind
 * es 168 Quittungen, davon 155 mit `a`-Tag. Die Zahl 78 ist am aktuellen Bestand die
 * Anzahl der Zap-REQUESTS mit einem `lnurl`-Tag, nicht die Zahl der Quittungen.
 *
 * ── Kommentare: `#A` UND `#a` ──────────────────────────────────────────────────────
 *
 * NIP-22 unterscheidet Großbuchstabe (Wurzel) und Kleinbuchstabe (direkter Elternteil).
 * Ein Kommentar DIREKT am Artikel trägt beide; eine Antwort auf einen Kommentar trägt
 * `A` = Artikel und `a` = Elternkommentar. Gemessen (2026-08-21, Union über die drei
 * Relays): `#A` findet **64**, `#a` findet **57**, und die 7 zusätzlichen liegen
 * ausschließlich in `#A`. Ein `#a`-only-Filter verlöre also die Antworten, die tiefer im
 * Baum hängen.
 *
 * **Eine Zahl im Plan wird hier korrigiert:** dort steht „`#a` findet auf damus null
 * Treffer". Am 2026-08-21 nachgemessen findet `#a` auf `relay.damus.io` **33** Treffer
 * (`#A`: 38). Die Union bleibt trotzdem richtig — nur die Begründung „sonst stumm leer"
 * gilt in dieser Schärfe nicht mehr.
 *
 * ── Der Relay-Deckel, der einen naheliegenden Sparweg verbietet ────────────────────
 *
 * Es liegt nahe, die Kinds in EINEN Filter zu legen (`kinds:[7,9735,1111]`) und damit
 * drei REQs statt sechs zu fahren. **Gemessen ist das falsch:** `nos.lol` und
 * `relay.damus.io` annoncieren beide `max_limit: 500` (NIP-11, 2026-08-21). Ein
 * kombinierter REQ gegen nos.lol lief mit `--limit 2000` in genau 500 Treffer und die
 * Union über die drei Relays verlor dabei **44 Ereignisse** gegenüber den getrennten
 * Abfragen. Der Deckel gilt je REQ — getrennte Kind-Filter sind deshalb kein Luxus.
 */
import { COMMENT, REACTION, ZAP_RESPONSE, normalizeRelayUrl, zapFromEvent, type Filter, type TrustedEvent, type Zapper } from '@welshman/util'
import { fromPairs } from '@welshman/lib'
// **`import type` und ein eigenes Kind-Modul — beides gegen dieselbe Bundle-Grenze.**
// `longform.ts` hängt an markdown-it, und diese Datei liegt über `core.ts` im Boot-Pfad
// JEDER Seite. Ein WERT-Import von dort zog den Renderer in den app-Chunk: +48 kB gzip
// überall, für die Zahl 30023 (gemessen 2026-08-21, Tabelle in `longformKinds.ts`).
// Der Typ-Import ist zur Laufzeit weggestrippt und deshalb unbedenklich — aber nur als
// `import type` ausgeschrieben; ein gewöhnlicher Import derselben Zeile stellte die
// Kante wieder her, ohne dass etwas rot würde. Riegel: `tests/bundleGrenze.nodetest.ts`.
import { LONGFORM } from './longformKinds.ts'
import type { ArticleRow } from './longform.ts'

/**
 * Obergrenze je Sekundär-REQ.
 *
 * `500` ist keine gewählte Zahl, sondern die annoncierte: `nos.lol` und `relay.damus.io`
 * führen `max_limit: 500` in ihrer NIP-11 (2026-08-21). Ein höherer Wert wird vom Relay
 * stillschweigend auf 500 gekürzt — die Zahl hier zu erhöhen ändert nichts, außer dass
 * der Code eine Zusage macht, die der Relay nicht hält.
 *
 * **Woran man merkt, dass der Deckel greift:** eine Kind-Abfrage liefert exakt 500
 * Treffer. Der größte Einzelwert im Bestand ist heute `kind 7` auf nos.lol mit **380**.
 *
 * **Und das misst {@link deckelVerdacht}, statt es nur zu beschreiben.** Der Abstand ist
 * einstellig prozentual, und wenn er fällt, fällt er still: die Zähler werden leise zu
 * klein und niemand merkt es. Eine Beschreibung im Docblock ist kein Riegel.
 */
export const METRIK_LOAD_LIMIT = 500

/**
 * Riecht diese Antwort nach einem gekappten REQ?
 *
 * Genau `limit` Treffer sind der einzige Hinweis, den ein Relay auf seinen `max_limit`
 * gibt — er sagt es nicht, er hört einfach auf. Der Gleichstand ist deshalb der Verdacht:
 * exakt so viele Ereignisse, wie erlaubt waren, sind fast nie ein Zufall.
 *
 * **Gezählt wird JE REQ, nicht über die Gesamtantwort** — der Deckel gilt je REQ, und der
 * Unterschied ist der zwischen einer Warnung und Rauschen. Am 2026-08-21 über die 104
 * Artikel gemessen: der größte Einzel-REQ liefert **380** Ereignisse (nos.lol, kind 7,
 * `#a`), die Gesamtantwort über alle sechs Filter und drei Relays dagegen **1977**. Ein
 * Riegel auf die Gesamtzahl hätte im Normalbetrieb **immer** gefeuert; je REQ schweigt er
 * und hat noch 120 Treffer Luft.
 *
 * **Falsch-positiv ist möglich und hingenommen:** ein einzelner REQ, der zufällig genau
 * 500 trägt, meldet ebenfalls. Der umgekehrte Fehler wäre teurer — eine stille Kappung
 * verkleinert jede Zahl auf der Fläche, ohne dass irgendetwas fehlschlägt.
 *
 * Rein und ohne Nebenwirkung: **was mit dem Verdacht geschieht, entscheidet der
 * Aufrufer** (`longformFeed.ts` warnt auf der Konsole). So ist die Regel prüfbar, ohne
 * dass ein Test eine Ausgabe abfangen muss.
 */
export const deckelVerdacht = (anzahl: number, limit: number = METRIK_LOAD_LIMIT): boolean => anzahl >= limit

/**
 * Eine kommagetrennte Relay-Liste einlesen und normalisieren.
 *
 * **Der Parser ist die Stelle, an der eine Konfiguration still danebengreift**, deshalb
 * steht er als eigene, geprüfte Funktion hier: Leerzeichen um die Kommata, ein
 * abschließendes Komma, eine Adresse ohne Schrägstrich am Ende — jedes davon führte
 * sonst zu einer URL, die der `tracker` nie wiederfindet, und die Zähler blieben
 * dauerhaft klein, ohne dass irgendetwas fehlschlägt.
 *
 * `normalizeRelayUrl` ist dieselbe Funktion, mit der welshman die Herkunft im `tracker`
 * schreibt — sie hier anzuwenden ist der ganze Punkt.
 */
export const leseRelayListe = (raw: string | undefined): string[] => zerlegeRelayListe(raw).map((teil) => normalizeRelayUrl(teil))

/** Die gemeinsame Zerlegung beider Leser — trennen, trimmen, Leeres weg. Ohne Urteil. */
const zerlegeRelayListe = (raw: string | undefined): string[] =>
    (raw ?? '')
        .split(',')
        .map((teil) => teil.trim())
        .filter((teil) => teil !== '')

/**
 * Wie {@link leseRelayListe}, aber **ohne Wurf**: unlesbare Einträge werden verworfen
 * und einmal gemeldet. Die Rückgabe enthält damit **per Konstruktion nur normalisierte,
 * wohlgeformte Adressen**.
 *
 * ── Warum es diese zweite Form gibt, und warum sie NICHT die einzige ist ─────────
 *
 * Die Asymmetrie folgt der **Eindämmung**, nicht dem Geschmack, und beide Seiten sind
 * am Baum nachgemessen (2026-08-21):
 *
 *  · **`longformFeed.ts` ist eingedämmt** — es wird ausschließlich DYNAMISCH importiert
 *    (`bridge.ts`, vier Stellen; die statische Zeile dort ist ein `import type` und zur
 *    Laufzeit weg). Alle vier fangen: drei setzen eine sichtbare Fehlerzeile („Die
 *    Artikel sind gerade nicht erreichbar."), die vierte ist ein Prefetch mit
 *    `.catch(() => undefined)` und damit folgenlos. Dort ist der **Wurf die bessere
 *    Rückmeldung**: der Betreiber sieht seinen Tippfehler auf der Fläche. Deshalb bleibt
 *    {@link leseRelayListe} streng.
 *  · **`core.ts` ist NICHT eingedämmt** — 11 Module importieren es STATISCH, darunter
 *    `bridge.ts` (der Einstiegspunkt), und **kein einziges dynamisch**. Ein Wurf im
 *    Modul-Toplevel reißt dort nicht die Artikelfläche ab, sondern die **gesamte
 *    Client-Insel, beim Boot, stumm**. Für einen Konfigurationstippfehler ist ein toter
 *    Client der falsche Preis; ein stiller Zähler weniger ist der richtige.
 *
 * **Das war eine Eindämmungs-Regression und kein theoretischer Fall:** dieselbe Konstante
 * lag bis zum F2-Fix nur in `longformFeed.ts` und war damit aufgefangen. Mit dem Riegel
 * ist sie nach `core.ts` gewandert — aus der Eindämmung heraus, ohne dass sich am Parser
 * etwas geändert hätte.
 *
 * ── Und sie löst eine Kopplung auf, statt sie nur zu dokumentieren ──────────────
 *
 * {@link darfAuthBekommen} behandelt einen unlesbaren Eintrag als **abwesend**. Für die
 * eigenen Relays ist das die sichere Richtung; für die METRIK-Liste wäre es die
 * unsichere — der Mülleintrag selbst, als Socket-URL, bekäme dann AUTH. Erreichbar ist
 * das heute nicht, aber nur, weil die Konstruktion vorher aussiebt. Diese Funktion
 * garantiert genau das **per Konstruktion**: was sie zurückgibt, ist normalisiert, also
 * kann die unsichere Richtung auch künftig nicht scharf werden. Wer hier lockert, macht
 * sie scharf — deshalb steht der Satz auch bei {@link darfAuthBekommen}.
 *
 * `melde` ist injizierbar, damit ein Test die Meldung **zählen** kann; ohne Angabe geht
 * sie an `console.warn`. Eine Warnung und keine Ausnahme: sie erreicht den Betreiber,
 * ohne den Boot zu nehmen.
 */
export const leseRelayListeNachsichtig = (
    raw: string | undefined,
    melde: (nachricht: string) => void = (nachricht) => console.warn(nachricht),
): string[] => {
    const gute: string[] = []
    const schlechte: string[] = []
    for (const teil of zerlegeRelayListe(raw)) {
        try {
            gute.push(normalizeRelayUrl(teil))
        } catch {
            schlechte.push(teil)
        }
    }
    if (schlechte.length > 0) {
        melde(`Unlesbare Relay-Adresse(n) in der Konfiguration, ignoriert: ${schlechte.join(', ')}`)
    }

    return gute
}

/**
 * Darf dieser Relay eine NIP-42-AUTH-Antwort von uns bekommen — also unseren Pubkey?
 *
 * **Rein und exportiert, damit die Entscheidung prüfbar ist.** Verdrahtet wird sie in
 * `js/core.ts` (`shouldAuth`), und dort ist sie nicht testbar: die Datei ist unter
 * `node --test` nicht ladbar und ihre Wirkung hängt an einem echten Socket. Die REGEL
 * gehört deshalb hierher, wo ein Fixture sie festnageln kann.
 *
 * ── Was hier verhindert wird ──────────────────────────────────────────────────────
 *
 * Ein signiertes kind 22242 gibt dem Relay den Pubkey des Lesers — verknüpfbar mit IP,
 * Zeitpunkt und den angefragten Filtern. Die Metrik-Relais sind FREMDE Betreiber, und
 * gefragt werden sie **ohne jede Nutzerhandlung**, beim bloßen Öffnen einer
 * Artikelfläche; die Vollansicht fragt dabei mit genau EINER Artikeladresse. Das wäre
 * die Verknüpfung von Identität und Lesehistorie.
 *
 * Ein Metrik-Relay braucht dafür nichts: es liefert öffentliche Reaktionen. Am
 * 2026-08-21 per NIP-11 nachgesehen führen `nos.lol` und `relay.damus.io` in ihrer
 * `limitation` **gar kein `auth_required`** (nur `max_limit`, `max_message_length`,
 * `max_subscriptions`) — sie verlangen also keins. „Meldet `false`" wäre die falsche
 * Wiedergabe eines fehlenden Felds; wer nachschlägt, soll finden, was hier steht.
 *
 * ── Warum AUSSCHLUSS und nicht Whitelist ─────────────────────────────────────────
 *
 * Die naheliegende Form wäre „nur unsere eigenen Relays" — und sie ist **nicht sicher
 * baubar**, aus einem Grund, der im Code steht und nicht in einer Meinung: die Menge der
 * eigenen Relays ist **nicht statisch**. `userSpaceUrls` (`groups.ts`) wird aus der
 * 10009-Gruppenliste des Nutzers ABGELEITET, wächst also zur Laufzeit aus dem Netz, und
 * `setActiveSpace(url)` nimmt aus den Einstellungen jede beliebige Adresse. Eine
 * Whitelist wäre für genau diese unvollständig — und ausgerechnet dort ist AUTH zwingend:
 * ein zooid mit `public_read=false` liefert ohne AUTH **nichts**, und der Ausfall wäre
 * **stumm** (eine hängende AUTH-Runde verschluckt das EOSE, ein Mitschnitt an `Receive`
 * sieht es nicht).
 *
 * ── Die Rückausnahme, und warum sie nicht optional ist ──────────────────────────
 *
 * `eigeneRelays` sticht die Sperre. **Das ist gemessen, nicht vorsorglich:** ohne diese
 * Rückausnahme waren am 2026-08-21 **alle fünf** E2E-Fälle der Artikelfläche rot. Grund
 * ist, dass ein Relay beides sein DARF — `board-fixtures.ts` trägt den worker-eigenen
 * zooid absichtlich als Board **und** als Metrik-Relay ein (eine fremde Adresse wäre dort
 * ein Bruch des Relay-Wächters), und dieser zooid verlangt AUTH. Die Sperre nahm ihm
 * damit die Identität, und die Fläche blieb leer — **stumm**, genau wie oben beschrieben.
 *
 * Derselbe Fall ist produktiv möglich: wer sein eigenes Space-Relay zusätzlich als
 * Signal-Quelle einträgt, darf davon keinen stummen Ausfall bekommen.
 *
 * **Die Grenze der Rückausnahme, ausdrücklich:** sie kennt nur die zum Boot bekannten
 * Config-Relays (Space, Workspace, Board). Ein Relay aus `userSpaceUrls`, den der
 * BETREIBER zusätzlich als Metrik-Relay einträgt, wäre gesperrt. Das ist eine
 * Konfiguration gegen sich selbst — die Metrik-Relais kommen aus der `.env`, nicht vom
 * Nutzer — und es steht hier, damit es bei der Fehlersuche nicht erst gefunden werden muss.
 *
 * ── Die Ausschlussform ist die ZWISCHENLÖSUNG, nicht das Ziel ────────────────────
 *
 * **Ihr Preis ist, dass sie fail-OPEN ist für alles, was künftig dazukommt.** Ein neuer
 * Fremdrelay-Pfad — eine weitere Quelle, ein weiterer Indexer, irgendein Nachladeweg —
 * bekommt AUTH, ohne dass jemand etwas tut oder etwas rot wird. Gemessen und ausdrücklich
 * hingenommen: fehlt die eigene Konfiguration ganz, sperrt diese Funktion trotzdem
 * korrekt die Metrik-Relais (die Sperre kollabiert nicht), aber ein **unbekannter**
 * Fremdrelay bekommt AUTH.
 *
 * Für diese Phase ist das tragbar, weil sie exakt den Radius schließt, den P6 geöffnet
 * hat, und weil die Einschlussform hier nachweislich funktionierende Nutzer-Spaces
 * lautlos abschaltete. **Die Richtung bleibt trotzdem die Einschlussform über
 * `userSpaceUrls`**, so wie der `ponytail`-Vermerk in `core.ts` sie beschreibt — wer sie
 * angeht, muss den dynamischen Store einbeziehen, nicht eine Literalliste. Dieser Punkt
 * ist damit **nicht erledigt, sondern zwischengelöst.**
 *
 * **Was hiermit ebenfalls NICHT behoben ist:** `INDEXER_RELAYS`, `DEFAULT_RELAYS` und
 * `SIGNER_RELAYS` (`core.ts`) sind fremd und bekommen weiterhin AUTH. Bestand von vor P6,
 * Teil desselben offenen Auftrags.
 *
 * ── Die Bedingung, unter der „abwesend" hier tragbar ist ────────────────────────
 *
 * Ein unlesbarer Eintrag gilt in beiden Listen als **abwesend** (siehe
 * {@link normalisiereOderNichts}). Für `eigeneRelays` ist das die sichere Richtung: die
 * Sperre der wohlgeformten Nachbarn hält, die Rückausnahme ebenso — gemessen.
 *
 * **Für `metrikRelays` wäre es die UNSICHERE Richtung.** Stünde dort Müll, bekäme genau
 * dieser Mülleintrag als Socket-URL ein AUTH. Dass das nicht erreichbar ist, liegt
 * **nicht an dieser Funktion**, sondern daran, dass der Aufrufer die Liste mit
 * {@link leseRelayListeNachsichtig} baut und die nur normalisierte Adressen zurückgibt.
 *
 * **Wer diese Vorfilterung entfernt oder lockert, macht die unsichere Richtung scharf** —
 * ohne dass hier eine Zeile anders aussähe. Der Satz steht deshalb an beiden Stellen.
 *
 * Alle Seiten laufen durch `normalizeRelayUrl`; ein fehlender Schrägstrich oder ein
 * `WSS://` in Großbuchstaben darf die Regel nicht aushebeln.
 */
export const darfAuthBekommen = (
    url: string,
    metrikRelays: Iterable<string>,
    eigeneRelays: Iterable<string> = [],
): boolean => {
    const ziel = normalisiereOderNichts(url)
    // Eine unlesbare Socket-URL kann mit nichts übereinstimmen. Dann gilt das
    // Bestandsverhalten (AUTH erlaubt) — diese Funktion ist der Metrik-Riegel und nicht
    // die Stelle, an der über unbekannte Adressen entschieden wird.
    if (!ziel) {
        return true
    }
    for (const eintrag of eigeneRelays) {
        if (normalisiereOderNichts(eintrag) === ziel) {
            return true
        }
    }
    for (const eintrag of metrikRelays) {
        if (normalisiereOderNichts(eintrag) === ziel) {
            return false
        }
    }

    return true
}

/**
 * `normalizeRelayUrl`, aber **ohne Wurf** — `''` für alles Unlesbare.
 *
 * ── Warum das eine eigene Funktion ist und kein `try` am Aufrufort ────────────────
 *
 * `normalizeRelayUrl` **wirft** bei Müll (`TypeError: Invalid URL`; am 2026-08-21
 * gemessen für `'nicht mal eine url'`, `'ws://'` und einen reinen Leerraum-String).
 * {@link darfAuthBekommen} läuft **innerhalb von welshmans `shouldAuth`**, und dort ist
 * ein Wurf kein lokaler Fehler: die Ausnahme fliegt aus `AuthState.emit` heraus und
 * **schaltet die AUTH-Beantwortung auf ALLEN Relays ab** — gemessen mit Gegenproben
 * davor und danach (Relay sah nur `[REQ]` statt `[REQ, AUTH]`).
 *
 * Die Folge wäre der schlimmste Ausfalltyp dieser Anwendung: **stumm**. Eine
 * fehlerhafte `NOSTR_SPACE_URL`, `NOSTR_WORKSPACE_URL` oder `NOSTR_BOARD_URL` — ein
 * Betreiber-Tippfehler, kein Angriff — machte die halbe Fläche leer, ohne eine einzige
 * Fehlermeldung. Vor dem P6-Riegel konnte `shouldAuth` nicht werfen; die Fehlerart wäre
 * also mit ihm erst entstanden.
 *
 * **Ein unlesbarer Eintrag gilt deshalb als ABWESEND**, nicht als Treffer und nicht als
 * Fehler: die Sperre und die Rückausnahme bleiben für alle wohlgeformten Einträge
 * daneben genau so wirksam, wie sie es ohne den kaputten wären. Das ist die einzige
 * Richtung, die weder eine Sperre erfindet noch eine aufhebt.
 *
 * Der leere String fällt aus demselben Grund vorab heraus — `normalizeRelayUrl('')`
 * ist kein Wert, auf den ein Vergleich sich stützen darf, und eine nicht konfigurierte
 * `__nostrWorkspace` liefert genau ihn.
 */
const normalisiereOderNichts = (url: string): string => {
    if (!url) {
        return ''
    }
    try {
        return normalizeRelayUrl(url)
    } catch {
        return ''
    }
}

/**
 * Die Adresse eines ersetzbaren Artikels, wie sie in einem `a`/`A`-Tag steht (NIP-01):
 * `<kind>:<pubkey>:<d>`.
 *
 * **Der einzige Ort, an dem diese Zeichenkette entsteht.** Sie wird an drei Stellen
 * gebraucht — beim Bauen der REQ-Filter, beim Zuordnen eintreffender Ereignisse und beim
 * Nachschlagen der Zahl an der Zeile. Stünde sie dreimal, reichte ein vergessener
 * Doppelpunkt, damit die Fläche dauerhaft „keine Reaktionen" zeigt, ohne dass irgendetwas
 * fehlschlägt.
 */
export const artikelAdresse = (pubkey: string, identifier: string): string => `${LONGFORM}:${pubkey}:${identifier}`

/**
 * Die REQ-Filter für alle Sozialsignale eines Artikelbestands.
 *
 * Sechs Filter, und jeder einzelne hat einen gemessenen Grund (siehe Modulkopf):
 * drei Kinds × zwei Zeigeformen. welshman zerlegt eine Filterliste ohnehin in **ein REQ
 * je Filter** — die Liste hier ist also wörtlich die Zahl der Abfragen je Relay.
 *
 * `ids` darf leer sein (dann entfallen die `#e`-Filter), `adressen` ebenso. Eine leere
 * Rückgabe heißt: nichts zu fragen.
 */
export const artikelMetrikFilters = ({
    adressen,
    ids,
    limit = METRIK_LOAD_LIMIT,
}: {
    adressen: string[]
    ids: string[]
    limit?: number
}): Filter[] => {
    const filters: Filter[] = []
    if (adressen.length > 0) {
        filters.push(
            { kinds: [REACTION], '#a': adressen, limit },
            { kinds: [ZAP_RESPONSE], '#a': adressen, limit },
            { kinds: [COMMENT], '#a': adressen, limit },
            // Die Wurzelform. Sie ist keine Dublette des `#a`-Filters darüber: eine
            // Antwort auf einen Kommentar trägt im `a` den ELTERNKOMMENTAR und nur im `A`
            // den Artikel.
            { kinds: [COMMENT], '#A': adressen, limit },
        )
    }
    if (ids.length > 0) {
        filters.push({ kinds: [REACTION], '#e': ids, limit }, { kinds: [ZAP_RESPONSE], '#e': ids, limit })
    }

    return filters
}

/** Die Sozialsignale EINES Artikels, anzeigefertig. */
export type ArtikelMetriken = {
    /** Reaktionen (kind 7), dedupliziert je (Autor, Emoji) — siehe {@link zaehleReaktionen}. */
    reaktionen: number
    /** VALIDIERTE Zap-Quittungen (kind 9735) — siehe {@link summiereZaps}. */
    zaps: number
    /** Summe der validierten Zaps in **Sats** (nicht Millisats). */
    sats: number
    /** Kommentare (kind 1111), dedupliziert über die Event-Id. */
    kommentare: number
}

/**
 * Eine Artikelzeile **mit** ihren Sozialsignalen.
 *
 * ── Warum die Metriken kein Feld von `ArticleRow` sind ─────────────────────────────
 *
 * `ArticleRow` ist die Übersetzung EINES Ereignisses in Anzeigezustand, gebaut von
 * `buildArticleRow` (`longform.ts`). Die Metriken sind das Gegenteil davon: eine
 * Aggregation über ~700 FREMDE Ereignisse von drei Relays, die zum Zeitpunkt des
 * Zeilenbaus noch gar nicht da sind. Sie in `ArticleRowDeps` zu schieben hieße,
 * `buildArticleRow` und seine Tests für einen Wert anzufassen, der mit dem Artikel-
 * Ereignis nichts zu tun hat.
 *
 * Als Erweiterung ist der Typ überall dort zuweisbar, wo `ArticleRow` erwartet wird — der
 * Bestandscode braucht keine Zeile Änderung, um weiterhin Titel und Datum zu lesen.
 */
export type ArticleRowMitMetriken = ArticleRow & { metriken: ArtikelMetriken }

/**
 * Alles null — und das ist kein Randfall: **20 der 104 Artikel** tragen am 2026-08-21
 * über alle drei Relays hinweg kein einziges Signal.
 */
export const KEINE_METRIKEN: ArtikelMetriken = { reaktionen: 0, zaps: 0, sats: 0, kommentare: 0 }

/** Trägt dieser Artikel überhaupt ein anzeigbares Signal? */
export const hatMetriken = (m: ArtikelMetriken): boolean => m.reaktionen > 0 || m.zaps > 0 || m.kommentare > 0

/** Erster Wert eines Tags, sonst `''`. */
const tagWert = (event: TrustedEvent, name: string): string => event.tags.find((t) => t[0] === name)?.[1] ?? ''

/**
 * Welchem Artikel gehört dieses Sekundär-Ereignis?
 *
 * Die Reihenfolge ist die Verlässlichkeitsreihenfolge, nicht Geschmack: `A` (NIP-22-
 * Wurzel) und `a` (Adresse) zeigen auf **den Artikel** und überleben jede Überarbeitung;
 * `e` zeigt auf eine FASSUNG und wird deshalb erst über die Id-Tabelle des geladenen
 * Bestands aufgelöst. Steht in keiner der drei Formen ein bekannter Artikel, gehört das
 * Ereignis nicht hierher — es zählt dann bei niemandem, statt irgendwo zu landen.
 *
 * `adresseVonId` ist die Tabelle `Event-Id → Adresse` des GELADENEN Bestands. Ein `e`-Tag
 * auf eine Fassung, die wir nicht geladen haben, ist damit nicht zuordenbar — richtig so:
 * die Zahl gehörte sonst an einen Artikel, den diese Fläche gar nicht zeigt.
 */
export const artikelVonEreignis = (event: TrustedEvent, adresseVonId: Map<string, string>, bekannt: Set<string>): string => {
    const wurzel = tagWert(event, 'A')
    if (wurzel && bekannt.has(wurzel)) {
        return wurzel
    }
    const adresse = tagWert(event, 'a')
    if (adresse && bekannt.has(adresse)) {
        return adresse
    }
    const id = tagWert(event, 'e')

    return (id && adresseVonId.get(id)) || ''
}

/**
 * Reaktionen zählen — **dedupliziert je (Autor, Emoji)**, nicht roh.
 *
 * Das ist genau die Regel, die der Chat seit langem fährt (`aggregateReactions` in
 * `js/feeds.ts`: `uniqBy(e => e.pubkey + e.content)`, danach je Emoji ein Chip). Die
 * Summe über alle Chips ist zeichengleich mit dem, was hier herauskommt.
 *
 * ── Warum die Chat-Funktion NICHT wiederverwendet wird ──────────────────────────────
 *
 * Der Plan nannte sie „reine Funktion, fertig". Nachgeprüft ist sie das nicht:
 *
 *  1. Sie ist in `feeds.ts` **nicht exportiert**.
 *  2. `feeds.ts` lässt sich unter `node --test` nicht laden (endungslose Importe, danach
 *     `localStorage` beim Import von `session.ts`) — ein Test dieser Zählung hinge damit
 *     am ganzen Speicher-Subsystem.
 *  3. Sie baut `ReactionChip[]` mit Anzeigenamen, Custom-Emoji-Bildern und
 *     `proxifyImage` — für eine Liste, die davon **eine Zahl** zeigt, ist das Arbeit über
 *     104 Artikel für nichts.
 *
 * Übernommen wird deshalb die **Regel**, nicht die Funktion; der Test darunter nagelt sie
 * an einem Fixture fest, in dem derselbe Autor zweimal dasselbe und einmal etwas anderes
 * reagiert.
 *
 * **Und die Regel ist eine Entscheidung, keine Selbstverständlichkeit:** derselbe Mensch
 * mit zwei verschiedenen Emojis zählt **zwei**. Das ist die Chat-Semantik („zwei Chips,
 * je einer") in eine Zahl gefaltet — nicht „wie viele Menschen haben reagiert".
 */
export const zaehleReaktionen = (reaktionen: TrustedEvent[]): number =>
    new Set(reaktionen.map((e) => `${e.pubkey}${e.content}`)).size

/**
 * Zap-Quittungen validieren und summieren — **nie roh zählen**.
 *
 * Eine kind 9735 ist ein Ereignis wie jedes andere: sie behauptet eine Zahlung, sie
 * beweist sie nicht. welshmans {@link zapFromEvent} prüft das Trio, auf das es ankommt —
 * `bolt11` gegen das `amount`-Tag des Requests, den `lnurl`-Tag gegen den aufgelösten
 * Zapper des Empfängers, und den SIGNER der Quittung gegen dessen `nostrPubkey`.
 *
 * ── Der `p`-Riegel, und warum er hier stehen MUSS ─────────────────────────────────
 *
 * `zapFromEvent` hat **vor** beiden Signaturprüfungen einen Kurzschluss
 * (`@welshman/util`, `Zaps.js`):
 *
 * ```js
 * if (responseMeta.p === response.pubkey) { return zap; }
 * ```
 *
 * Trägt eine Quittung im `p`-Tag denselben Pubkey, der sie signiert hat, gilt sie als
 * legitim — ohne `lnurl`-Vergleich und ohne den Signer-Check. Für eine Nachricht, deren
 * Empfänger feststeht, ist das harmlos; für einen ARTIKEL nicht: die Zuordnung läuft über
 * `#a`/`#e`, und die sagt nichts darüber, an WEN gezahlt wurde. Der Betrag kommt aus
 * `getInvoiceAmount` per `bolt11.match(/lnbc(\d+\w)/)` — keine Signatur, keine Prüfsumme.
 *
 * **Gemessen mit frischen Schlüsseln durch genau diese Funktion:**
 *
 * | Fall | `p`-Tag(s) | Signer | ohne Riegel |
 * |---|---|---|---|
 * | echt | Autor | LNURL-Dienst | zaps 1 · 21 000 sats |
 * | Fälschung mit fremdem Signer | Autor | Angreifer | **verworfen** (der Signer-Check hält) |
 * | **Angriff** | **Angreifer** | Angreifer | **zaps 1 · 2 100 000 sats** |
 * | **Angriff, zweite Form** | **Autor, Angreifer** | Angreifer | **zaps 1 · 2 100 000 sats** |
 *
 * Die letzte Zeile ist die, an der ein selbst gebauter Leser scheitert — siehe den
 * `fromPairs`-Kommentar im Rumpf. Die Gegenrichtung `[["p",ANGREIFER],["p",AUTOR]]` ist
 * ebenfalls gemessen: sie kommt am Riegel vorbei, und **welshman verwirft sie selbst**,
 * weil `responseMeta.p` dann der Autor ist und der Signer-Check greift. Der Riegel ist
 * damit ausreichend, nicht bloß enger.
 *
 * Der Angriffspfad war ein selbst signiertes kind 9735 mit `["a","30023:<autor>:<d>"]`
 * und dem eigenen Pubkey im `p`, publiziert auf einem der Metrik-Relais. **Vor P6 wurden
 * 9735 nur vom Board geholt, wo Schreiben an NIP-05 hängt — die beiden neuen Relais sind
 * offen.** Der Riegel unten ist deshalb Teil dieser Phase und kein Nachtrag.
 *
 * **Der legitime Fall verliert dadurch nichts:** NIP-57 schreibt vor, dass der Request
 * den Empfänger im `p` trägt, und der Dienst kopiert ihn in die Quittung. Am ganzen
 * Bestand nachgemessen (2026-08-21, 168 Quittungen über drei Relays), und zwar **mit dem
 * `fromPairs`-Leser**, also mit dem Code, der wirklich läuft:
 *
 * | Variante | validiert | Sats |
 * |---|---|---|
 * | ohne Riegel | 132 | 18 804 |
 * | Riegel über den ersten `p` (`find`) | 132 | 18 804 |
 * | **Riegel über `fromPairs`** | **132** | **18 804** |
 *
 * **Null echte Quittungen gehen verloren**, und bei **null** der 168 urteilen die beiden
 * Leser verschieden. Der Grund ist messbar und gehört dazu: **keine einzige Quittung des
 * Bestands trägt mehr als einen `p`-Tag.** Nur 2 der 168 tragen überhaupt ein `p`, das
 * nicht der Autor ist, und beide waren auch vorher nicht validiert.
 *
 * **Daraus folgt ausdrücklich nicht, dass der Leser egal wäre.** Der Riegel richtet sich
 * gegen eine Form, die im heutigen Bestand nicht vorkommt — ein Angreifer wählt seine
 * Ereignisse, der Bestand sagt über ihn nichts. Der Riegel tauscht keine fälschbare Zahl
 * gegen eine zu kleine; er nimmt eine Angriffsfläche weg, ohne etwas zu kosten.
 *
 * ── Was diese Prüfung NICHT leistet ──────────────────────────────────────────────
 *
 * Sie prüft **Form und Herkunft, nie Zahlung**. Ein Autor, der seinen eigenen
 * LNURL-Endpunkt betreibt, kann sich beliebig hohe Quittungen auf die eigenen Artikel
 * ausstellen — der Signer ist dann tatsächlich sein `nostrPubkey`, alles stimmt, und
 * geflossen ist nichts. Das ist NIP-57-inhärent und mit keinem Client-Code zu heilen.
 * Die Zahl ist damit „so viel wurde behauptet und ist formal gedeckt", nicht „so viel
 * wurde bezahlt".
 *
 * ── Was der `lnurl`-Vergleich real kostet ───────────────────────────────────────
 *
 * Am selben Bestand gehen **132 von 168** durch, **36 nicht** — und alle 36 hängen am
 * `lnurl`-Tag-Vergleich. Die Clients tragen dort Uneinheitliches ein: 26-mal eine
 * `https://…/.well-known/lnurlp/…`-URL, dreimal die blanke `name@domain`-Adresse,
 * zweimal bech32 in GROSSBUCHSTABEN — während `zapFromEvent` gegen den bech32-
 * Kleinbuchstabenwert vergleicht.
 *
 * **Die angezeigte Summe ist damit systematisch eher zu klein als zu groß.** Das ist eine
 * Eigenheit von welshmans Prüfung, keine unseres Codes, und sie wird hier bewusst NICHT
 * aufgeweicht: eine großzügigere Prüfung machte die Zahl fälschbar, und eine fälschbare
 * Sat-Summe ist schlechter als eine vorsichtige.
 *
 * `zapperVon` liefert den Zapper des Artikel-AUTORS (der Empfänger ist der Autor), oder
 * `undefined`, solange die LNURL-Metadaten noch nicht geladen sind.
 *
 * @param empfaenger Der Pubkey des Artikel-Autors. **Pflichtparameter, kein Default.**
 *   Ein Default machte aus einem vergessenen Aufrufer wieder die frei setzbare Summe von
 *   oben; verpflichtend wird derselbe Fehler ein Typfehler beim Übersetzen.
 */
export const summiereZaps = (
    quittungen: TrustedEvent[],
    zapper: Zapper | undefined,
    empfaenger: string,
): { zaps: number; sats: number } => {
    let zaps = 0
    let msats = 0
    for (const quittung of quittungen) {
        // **Der Riegel gegen den `p`-Kurzschluss — VOR `zapFromEvent`, nicht danach.**
        // Ohne ihn ist die Sat-Summe eines fremden Artikels von jedem Dritten frei
        // setzbar (Messtabelle oben). Ein leerer `empfaenger` sperrt alles: „wir wissen
        // nicht, wem der Artikel gehört" ist kein Grund, eine Zahl zu zeigen.
        //
        // **`fromPairs` und NICHT `tags.find(…)` — das ist der ganze Punkt.** Ein
        // eigener Leser war der erste Entwurf, und er war umgehbar: `find` liefert den
        // ERSTEN `p`-Tag, welshmans `fromPairs` den LETZTEN. Nostr verbietet doppelte
        // Tags nicht, und Relays deduplizieren sie nicht. `[["p",AUTOR],["p",ANGREIFER]]`
        // lief damit an einem `find`-Riegel vorbei (erster Tag = Autor) und traf drinnen
        // auf `responseMeta.p === response.pubkey` → Kurzschluss → gezählt. Gemessen:
        // 2 100 000 Sats an einem fremden Artikel, beliebig oft wiederholbar.
        //
        // Mit demselben Leser ist dieses Differential **per Konstruktion** ausgeschlossen:
        // was hier geprüft wird, ist bitgleich das, worüber `zapFromEvent` gleich
        // entscheidet. Nicht selbst parsen, sondern an den Parser delegieren, der
        // ohnehin urteilt.
        if (!empfaenger || fromPairs(quittung.tags).p !== empfaenger) {
            continue
        }
        const zap = zapFromEvent(quittung, zapper)
        if (zap) {
            zaps += 1
            msats += zap.invoiceAmount
        }
    }

    // Abrunden statt kaufmännisch: eine angezeigte Sat-Zahl darf nie höher stehen als der
    // Betrag, der tatsächlich geflossen ist.
    return { zaps, sats: Math.floor(msats / 1000) }
}

/**
 * Die Autoren, für deren Artikel überhaupt eine Zap-QUITTUNG vorliegt.
 *
 * ── Wozu, und warum das eine Datenschutzfrage ist ─────────────────────────────────
 *
 * Um eine 9735 zu validieren, braucht {@link summiereZaps} den LNURL-Zapper des
 * Empfängers — und den holt welshman mit einer **HTTPS-Anfrage an einen FREMDEN Host**
 * (`getalby.com`, `primal.net`, `walletofsatoshi.com` …). Das ist ein anderer
 * Datenabfluss als die Relay-Verbindungen: er geht an den Wallet-Anbieter des Autors und
 * wird von `NOSTR_ARTICLE_METRIC_RELAYS` **nicht** abgeschaltet.
 *
 * Die naheliegende Form wäre „alle Autoren wärmen", so wie es der Chat tut
 * (`feeds.ts`: `warmZappers(events.map((e) => e.pubkey))`). Auf der Artikelliste hieße
 * das: **beim bloßen Öffnen eine Anfrage an jeden der zwölf Autoren-Endpunkte**, auch
 * an die, deren Artikel nie jemand gezappt hat.
 *
 * **Gemessen am 2026-08-21:** von 12 Autoren tragen **6** überhaupt Zap-Quittungen. Die
 * Kopplung an den echten Bedarf halbiert die fremden Hosts, die beim Öffnen kontaktiert
 * werden — und auf einer Installation ohne Metrik-Relais und ohne Board-Zaps sind es
 * **null**.
 *
 * **Der Preis ist eine Runde Verzögerung, kein Verlust:** beim ersten Emit liegen noch
 * keine Quittungen vor, also wird nichts gewärmt. Treffen sie ein, emittiert die
 * Ableitung erneut (dafür steht der Sekundär-Eingang im `derived([…])`), und dann wird
 * gewärmt. Die Zahl erscheint eine Runde später statt gar nicht — dieselbe Mechanik, die
 * ohnehin jeden Zähler trägt.
 *
 * Zugeordnet wird über {@link artikelVonEreignis} — dieselbe Funktion wie in
 * {@link berechneArtikelMetriken}, damit es über „welches Signal gehört wem" nicht zwei
 * Wahrheiten gibt.
 *
 * ── „6 von 12" ist eine BESTANDSMESSUNG, keine Zusage ────────────────────────────
 *
 * Diese Funktion filtert auf `kind === ZAP_RESPONSE` und Adresszugehörigkeit — **der
 * `p`-Riegel aus {@link summiereZaps} sitzt NICHT davor.** Ein Dritter kann die Kopplung
 * deshalb aufheben: zwölf gefälschte 9735, eines je Board-Artikel, und es sind wieder
 * zwölf Hosts statt sechs. Er gewinnt dabei nichts für sich — kein eigener Host, kein
 * Rückkanal —, er hebt nur eine Datenschutzmaßnahme auf.
 *
 * **Was er NICHT kann: den Host wählen.** Der gewärmte Pubkey kommt aus
 * `autorVonAdresse`, also aus dem geladenen Board-Bestand, **nie aus der Quittung**. Eine
 * Quittung auf eine erfundene Adresse bewirkt nichts (`bekannt.has(adresse)` sperrt),
 * eine ohne `a`-Tag ebenfalls nichts. Die Menge möglicher Hosts ist durch die `lud16` der
 * realen Board-Autoren begrenzt.
 *
 * **Und härten lässt es sich nicht.** Ein `p`-Riegel davor hülfe nicht — `p` ist ein Tag,
 * den jeder auf den Autor setzen kann. Die echte Validierung braucht den Zapper, und den
 * bekommt man nur über genau die HTTPS-Anfrage, die man vermeiden will. Zirkulär. Also
 * benannt statt gehärtet: ein Angreifer wählt seine Ereignisse, der Bestand sagt über ihn
 * nichts — derselbe Vorbehalt wie bei {@link summiereZaps}.
 */
export const autorenMitQuittungen = ({
    adressen,
    adresseVonId,
    autorVonAdresse,
    ereignisse,
}: Omit<MetrikEingang, 'zapperVon'>): string[] => {
    const bekannt = new Set(adressen)
    const autoren = new Set<string>()
    for (const event of ereignisse) {
        if (event.kind !== ZAP_RESPONSE) {
            continue
        }
        const adresse = artikelVonEreignis(event, adresseVonId, bekannt)
        const autor = adresse && bekannt.has(adresse) ? autorVonAdresse.get(adresse) : undefined
        if (autor) {
            autoren.add(autor)
        }
    }

    return [...autoren]
}

/** Was {@link berechneArtikelMetriken} über den Bestand wissen muss. */
export type MetrikEingang = {
    /** Die Adressen aller geladenen Artikel — `30023:<pubkey>:<d>`. */
    adressen: string[]
    /** `Event-Id → Adresse` des geladenen Bestands, für die `#e`-Form. */
    adresseVonId: Map<string, string>
    /** `Adresse → pubkey des Autors`, für die Zapper-Auswahl. */
    autorVonAdresse: Map<string, string>
    /** Die Sekundär-Ereignisse, bereits über die Event-Id dedupliziert. */
    ereignisse: TrustedEvent[]
    /** Zapper des Autors — `undefined`, solange die LNURL-Metadaten fehlen. */
    zapperVon: (pubkey: string) => Zapper | undefined
}

/**
 * Der ganze Bestand auf einmal: `Adresse → {@link ArtikelMetriken}`.
 *
 * In EINEM Durchgang über die Ereignisse, nicht je Artikel einmal über alle: die Liste
 * zeigt 104 Zeilen und der Bestand trägt ~700 Sekundär-Ereignisse; ein Durchgang je Zeile
 * wäre 104 × 700 Vergleiche bei jedem Emit der Ableitung.
 *
 * Artikel ohne jedes Signal stehen **nicht** in der Rückgabe. Der Aufrufer fällt auf
 * {@link KEINE_METRIKEN} zurück; so trägt die Map nur, was es wirklich gibt — am
 * 2026-08-21 sind das **84 von 104** Adressen (81 mit Reaktionen, 64 mit Zaps, 37 mit
 * Kommentaren; 697 Sekundär-Ereignisse insgesamt, davon **null** nicht zuordenbar).
 */
export const berechneArtikelMetriken = ({
    adressen,
    adresseVonId,
    autorVonAdresse,
    ereignisse,
    zapperVon,
}: MetrikEingang): Map<string, ArtikelMetriken> => {
    const bekannt = new Set(adressen)
    const reaktionen = new Map<string, TrustedEvent[]>()
    const quittungen = new Map<string, TrustedEvent[]>()
    const kommentare = new Map<string, Set<string>>()

    for (const event of ereignisse) {
        const adresse = artikelVonEreignis(event, adresseVonId, bekannt)
        if (!adresse || !bekannt.has(adresse)) {
            continue
        }
        if (event.kind === REACTION) {
            const eimer = reaktionen.get(adresse)
            eimer ? eimer.push(event) : reaktionen.set(adresse, [event])
        } else if (event.kind === ZAP_RESPONSE) {
            const eimer = quittungen.get(adresse)
            eimer ? eimer.push(event) : quittungen.set(adresse, [event])
        } else if (event.kind === COMMENT) {
            const eimer = kommentare.get(adresse)
            eimer ? eimer.add(event.id) : kommentare.set(adresse, new Set([event.id]))
        }
    }

    const ergebnis = new Map<string, ArtikelMetriken>()
    for (const adresse of new Set([...reaktionen.keys(), ...quittungen.keys(), ...kommentare.keys()])) {
        // Der Autor ist zugleich der einzig zulässige Zap-EMPFÄNGER dieses Artikels —
        // beide Argumente kommen aus derselben Tabelle, damit sie nicht auseinanderlaufen
        // können.
        const autor = autorVonAdresse.get(adresse) ?? ''
        const zap = summiereZaps(quittungen.get(adresse) ?? [], zapperVon(autor), autor)
        const metriken: ArtikelMetriken = {
            reaktionen: zaehleReaktionen(reaktionen.get(adresse) ?? []),
            zaps: zap.zaps,
            sats: zap.sats,
            kommentare: kommentare.get(adresse)?.size ?? 0,
        }
        if (hatMetriken(metriken)) {
            ergebnis.set(adresse, metriken)
        }
    }

    return ergebnis
}

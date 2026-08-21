/**
 * Die Autorenseite (`/articles/autor/{autor}`, P4) — **rein**: Adresse deuten, NIP-05
 * auflösen, Artikel eines Autors auswählen, nach Monat gliedern.
 *
 * Kein welshman, kein Alpine, kein DOM. Alles hier ist unter `node --test` prüfbar:
 *
 *   node --experimental-strip-types --test packages/einundzwanzig-group/js/articleAuthor.test.ts
 *
 * Dieselbe Aufteilung wie bei `articleReader.ts`/`bridge.ts` und `longform.ts`/
 * `longformFeed.ts`: die Entscheidungen stehen hier, die Anbindung an Store und
 * Bildschirm steht dort.
 *
 * ── Die eine Architekturfrage dieser Fläche: zwei Adressformen, vier Fehlausgänge ────
 *
 * Eine Autorenseite ist über **npub** (synchron, ohne Netz) oder über eine **NIP-05-
 * Adresse** (`name@domain.tld`, eine Abfrage über HTTPS) erreichbar. Beide Wege enden in
 * einem Hex-Pubkey, und ab da ist die Seite dieselbe. Was sie unterscheidet, sind die
 * Fehlausgänge — und die dürfen **nicht zu einem verschmelzen**:
 *
 *  1. `format`               — das ist gar keine Adresse (weder npub noch `name@domain`).
 *  2. `npub`                 — sieht aus wie eine npub, lässt sich aber nicht dekodieren.
 *  3. `nip05-unbekannt`      — die Domain hat geantwortet und kennt den Namen nicht.
 *  4. `nip05-fehlgeschlagen` — die Domain hat gar nicht oder unbrauchbar geantwortet.
 *
 * **Nur (4) ist wiederholbar.** (1) und (2) sind Eigenschaften des Links und werden auch
 * beim zehnten Versuch nicht besser; (3) ist eine Aussage der Domain über sich selbst.
 * Ein einziger Satz „Autor nicht gefunden" über alle vier hätte dem Leser genau die
 * Information vorenthalten, die entscheidet, ob er es noch einmal versuchen soll.
 *
 * ── Warum welshmans `queryProfile` das NICHT trägt ──────────────────────────────────
 *
 * `@welshman/app` bringt `queryProfile(nip05)` mit, und es tut fast dasselbe: Handle
 * zerlegen, `https://<domain>/.well-known/nostr.json?name=<name>` holen, `names[name]`
 * lesen. Es ist hier trotzdem nicht verwendbar, und der Grund steht in seinem Quelltext
 * (`node_modules/@welshman/app/dist/app/src/handles.js`, gelesen 2026-08-21):
 *
 *   · `catch (_e) { return undefined }` um den gesamten `fetch` — ein Netzfehler ist
 *     danach von einem fehlenden Eintrag nicht mehr zu unterscheiden.
 *   · `if (!pubkey) { return undefined }` — derselbe Rückgabewert für „kennt den Namen
 *     nicht".
 *
 * Beide Ausgänge sind `undefined`. Die Fälle (3) und (4) der Liste oben sind über
 * `queryProfile` **prinzipiell** nicht trennbar, und `loadHandleForPubkey`/`loadHandle`
 * erben das. Genau deshalb steht die Auflösung hier und nicht dort.
 *
 * **Was weiterhin welshman macht:** das NIP-05-**Häkchen** neben dem Namen. Das ist die
 * umgekehrte Richtung (Pubkey → Handle → Bestätigung) und liegt unverändert bei
 * `handles.ts` (`warmHandles`, `verifiedNip05`). Diese Datei löst nur die **Adresse in
 * der URL** auf; sie schreibt nichts in welshmans Stores und ist kein zweiter
 * Verifizierer.
 */
// Der schmale Einstiegspunkt, nicht der Sammelexport — Präzedenzfall `longform.ts:55`
// und `nostrEventLink.ts:27`. `nostr-tools` als Barrel zöge die halbe Bibliothek nach.
import * as nip19 from 'nostr-tools/nip19'

/**
 * Wie lang ein Adress-Parameter höchstens sein darf.
 *
 * Eine npub ist 63 Zeichen, eine gewöhnliche NIP-05-Adresse deutlich kürzer. 256 ist
 * großzügig und trotzdem eine Grenze: der Wert kommt aus der URL, geht (im NIP-05-Fall)
 * in einen Hostnamen und damit in eine Netzverbindung. Ein Parameter jenseits davon ist
 * kein Tippfehler mehr, sondern ein Versuch — und er endet als `format`, ohne dass
 * irgendetwas ihn ansieht.
 */
export const AUTOR_PARAM_MAX = 256

/**
 * Der lokale NIP-05-Name (`alice` in `alice@example.com`).
 *
 * NIP-05 selbst erlaubt `a-z0-9-_.`; hier steht zusätzlich `A-Z`, weil Nutzer ihre
 * Adresse großgeschrieben teilen und ein „ungültiges Format" darauf unfreundlich wäre.
 * Nachgeschlagen wird trotzdem **zeichengenau** ({@link leseNip05Antwort}) — welshman
 * tut dasselbe, und zwei verschiedene Auffassungen darüber, was `names` ist, wären
 * schlimmer als eine strenge.
 */
const NIP05_NAME = /^[A-Za-z0-9._-]+$/

/**
 * Die Domain, Form: reine Labels aus `a-z0-9-`, kein Label beginnt oder endet mit `-`,
 * **mindestens ein Punkt**, kein Port, keine Zugangsdaten, keine Klammern, kein Pfad.
 */
const NIP05_DOMAIN_FORM = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/

/**
 * Ist das eine Domain, an die ein NIP-05-Abruf gehen darf?
 *
 * ── Warum das eine eigene Funktion ist und nicht nur ein Muster ─────────────────────
 *
 * Der Wert kommt aus der URL, wird zum Hostnamen einer `https://`-Anfrage und bestimmt
 * damit, **wohin der Browser des Lesers eine Verbindung aufbaut**. Ein Link
 * `/articles/autor/x@irgendwo.tld` genügt, damit jeder, der ihn öffnet, dort anklopft.
 * Das ist keine SSRF — der Server dieses Clients holt nichts, die Anfrage kommt aus dem
 * Browser (siehe Modulkopf und der Docblock in `⚡article-author.blade.php`) — aber es ist
 * ein Abfluss, und die Menge der erreichbaren Ziele gehört deshalb hier eingegrenzt.
 *
 * ── Drei Stufen, und jede schließt etwas, das die anderen nicht schließen ───────────
 *
 * **(1) Die Form** ({@link NIP05_DOMAIN_FORM}). Sie weist ab: `localhost` (kein Punkt) ·
 * `[::1]` · `evil.tld:8080` · `user:pw@example.com` · `example.com/pfad` · `a..b.de` ·
 * `.example.com` · `example.com.` · Leerraum · jedes Nicht-ASCII (ein kyrillisches
 * Homoglyph in „example.com" fällt durch, weil es nicht in `a-z0-9-` liegt).
 *
 * **(2) Der Parser muss die Eingabe unverändert lassen.** `new URL('https://<d>/').hostname`
 * ist genau das, was der `fetch` gleich als Host verwendet; weicht es von `<d>` ab, hat
 * der Parser die Eingabe **umgeschrieben** — und dann ist `<d>` nicht der Name, für den
 * der Leser ihn hält. Das ist die Stufe, die die gesamte Klasse der nicht-kanonischen
 * IP-Schreibweisen schließt, ohne sie aufzuzählen (gemessen 2026-08-21, Node 26.7,
 * jeder Fall als Test):
 *
 * | Eingabe                 | `hostname` danach | Urteil    |
 * |-------------------------|-------------------|-----------|
 * | `0x7f.0x1`              | `127.0.0.1`       | abgewiesen |
 * | `0x7f.0x0.0x0.0x1`      | `127.0.0.1`       | abgewiesen |
 * | `0177.0.0.0x1`          | `127.0.0.1`       | abgewiesen |
 * | `0xa9.0xfe.0xa9.0xfe`   | `169.254.169.254` | abgewiesen |
 * | `0xc0.0xa8.0x1.0x1`     | `192.168.1.1`     | abgewiesen |
 * | `0xa.0x0.0x0.0x1`       | `10.0.0.1`        | abgewiesen |
 * | `2130706433`            | `127.0.0.1`       | abgewiesen |
 * | `0300.0250.0.1`         | `192.168.0.1`     | abgewiesen |
 * | `example.com`           | `example.com`     | **durch** |
 * | `xn--bcher-kva.example` | (unverändert)     | **durch** |
 *
 * Sie kann nicht altern: ergänzt eine künftige URL-Spec eine weitere Schreibweise, wird
 * sie ebenfalls umgeschrieben und fällt hier heraus. Und sie kostet keine echte Adresse —
 * nach Stufe (1) besteht die Eingabe nur noch aus `a-z0-9-.` in sauberer Labelstruktur,
 * und daran hat der Parser außer der Zahlendeutung nichts umzuschreiben.
 *
 * **(3) Das letzte Label muss einen Buchstaben tragen** — und diese Stufe ist NICHT
 * überflüssig geworden. Der naheliegende Schluss „Stufe (2) erledigt alle IP-Literale"
 * ist **gemessen falsch**: die KANONISCHE Punktschreibweise ist ein Fixpunkt des Parsers.
 * `new URL('https://127.0.0.1/').hostname` ist `127.0.0.1`, identisch zur Eingabe —
 * dasselbe für `10.0.0.1`, `192.168.1.1`, `169.254.169.254`, `0.0.0.0` und `1.1.1.1`
 * (gemessen 2026-08-21). Stufe (2) feuert nur, wo der Parser UMSCHREIBT; wo er nichts zu
 * tun hat, schweigt sie. Diese Stufe ist der Rest: ein kanonisches IPv4-Literal hat ein
 * rein numerisches letztes Label, und kein reales TLD besteht nur aus Ziffern (die
 * IANA-Wurzel führt keins). Sie kostet damit ebenfalls keine echte Adresse.
 *
 * ── Was BEWUSST durchgeht, und was daran offen BLEIBT ───────────────────────────────
 *
 * Punycode (`xn--bcher-kva.example`) geht durch — das IST die ASCII-Form einer
 * internationalen Domain, und sie abzuweisen hieße, NIP-05 für alle nicht-lateinischen
 * Handles abzuschalten.
 *
 * **Der benannte Rest — kein Loch, das noch jemand zu stopfen versuchen soll:**
 * `drucker.local` (mDNS, RFC 6762), `intern.internal` (ICANN-Privatnamensraum) und
 * **jeder ganz gewöhnliche öffentliche Name mit privater A-Record-Adresse** kommen durch
 * und zielen damit ins LAN des Lesers.
 *
 * **Eine TLD-Sperrliste ist dafür kein Fix, und zwar nicht, weil Listen veralten.** Der
 * tragende Grund ist ein anderer: `intern.example.com` mit einem A-Record auf
 * `192.168.1.1` ist ein öffentlicher Name in einer öffentlichen TLD und läuft durch
 * **jede** Liste, die man schreiben kann. Ob ein Name im LAN landet, ist **am Namen nicht
 * entscheidbar** — nur an der Adressfamilie, die die Auflösung liefert, und die sieht
 * dieser Code nie. Eine Liste kaufte also nicht „etwas weniger Angriffsfläche", sondern
 * **nichts** — und kostete den Eindruck, das Problem sei behandelt.
 *
 * Entschieden wird das eine Ebene tiefer: der Browser prüft die Adressfamilie (Local
 * Network Access; Chromium verlangt für eine Anfrage aus öffentlichem Kontext in ein
 * privates Netz eine eigene Erlaubnis). Das ist die einzige Stelle, an der die Frage
 * überhaupt beantwortbar ist, und sie liegt nicht hier.
 */
const istNip05Domain = (domain: string): boolean => {
    // (1) Form.
    if (!NIP05_DOMAIN_FORM.test(domain)) {
        return false
    }
    // (2) Der Parser, der gleich den `fetch` fährt, darf nichts umschreiben.
    let hostname: string
    try {
        hostname = new URL(`https://${domain}/`).hostname
    } catch {
        return false
    }
    if (hostname !== domain) {
        return false
    }
    // (3) Der Rest, den (2) nicht sieht: das kanonische IPv4-Literal.
    const letztes = domain.slice(domain.lastIndexOf('.') + 1)

    return /[a-z]/.test(letztes)
}

/** Ein Hex-Pubkey, wie ihn ein Event und eine `names`-Tabelle tragen. */
const HEX64 = /^[0-9a-f]{64}$/

/**
 * Der NIP-05-Name der **Wurzel-Adresse**. `_@example.com` wird überall als `example.com`
 * angezeigt (welshmans `displayNip05` tut genau das) — wer diese Anzeige kopiert und in
 * die URL setzt, landet hier.
 */
export const NIP05_WURZEL = '_'

/** Warum eine Adresse zu keiner Autorenseite führt. Vier Ausgänge, vier Sätze. */
export type AutorFehler = 'format' | 'npub' | 'nip05-unbekannt' | 'nip05-fehlgeschlagen'

/** Was aus dem Routen-Parameter zu machen ist. */
export type AutorZiel =
    /** Fertig, ohne Netz: die npub war lesbar. */
    | { art: 'pubkey'; pubkey: string }
    /** Erst nach einer Abfrage bei `domain` bekannt. */
    | { art: 'nip05'; name: string; domain: string }
    /** Endstation, und zwar sofort — hier geht keine Anfrage mehr raus. */
    | { art: 'ungueltig'; grund: 'format' | 'npub' }

/**
 * Routen-Parameter → Ziel. **Ohne Netz, ohne Nebenwirkung, immer entschieden.**
 *
 * Die Reihenfolge der Prüfungen ist nicht beliebig:
 *
 *  1. **Ein `@` entscheidet zuerst.** Es ist das einzige Zeichen, das in keiner
 *     bech32-Kennung vorkommt, und damit die eindeutige Absichtserklärung „das soll
 *     eine NIP-05-Adresse sein". Ein `@` in einer kaputten Adresse führt deshalb nach
 *     `format` und nicht nach `npub` — der Leser bekommt den Satz, der zu dem passt,
 *     was er eingegeben hat.
 *  2. **Dann `npub1…`.** Nur mit dem Präfix; alles andere Bech32 (`nsec1`, `nevent1`,
 *     `naddr1`) fällt nach `format`.
 *  3. **Dann die nackte Domain** als `_@domain` — die Form, die auf dem Bildschirm steht.
 *
 * ── Der rohe Parameter verlässt diese Funktion NIE ──────────────────────────────────
 *
 * Kein Rückgabewert trägt die Eingabe weiter, außer in ihren geprüften Bestandteilen
 * (`name`, `domain`), und die Fläche zeigt davon **nur die Domain**. Der Grund ist
 * unangenehm konkret: in eine URL wird auch mal ein `nsec` getippt. Was diese Funktion
 * nicht zurückgibt, kann die Oberfläche nicht rendern und ein Screenshot nicht
 * weitertragen.
 *
 * **Was das nicht heilt:** in der Adresszeile, im Verlauf und im Server-Log steht der
 * Parameter trotzdem. Ein privater Schlüssel, der je in einer URL stand, ist
 * kompromittiert — daran ändert diese Fläche nichts, sie macht es nur nicht schlimmer.
 */
export const deuteAutorParam = (roh: string): AutorZiel => {
    const wert = roh.trim()
    if (wert === '' || wert.length > AUTOR_PARAM_MAX) {
        return { art: 'ungueltig', grund: 'format' }
    }

    if (wert.includes('@')) {
        const at = wert.indexOf('@')
        const name = wert.slice(0, at)
        const domain = wert.slice(at + 1).toLowerCase()

        return NIP05_NAME.test(name) && istNip05Domain(domain)
            ? { art: 'nip05', name, domain }
            : { art: 'ungueltig', grund: 'format' }
    }

    if (/^npub1/i.test(wert)) {
        try {
            const dekodiert = nip19.decode(wert)
            if (dekodiert.type === 'npub' && HEX64.test(dekodiert.data)) {
                return { art: 'pubkey', pubkey: dekodiert.data }
            }
        } catch {
            // Fällt unten in denselben Ausgang — `decode` wirft bei kaputter Prüfsumme.
        }

        return { art: 'ungueltig', grund: 'npub' }
    }

    const domain = wert.toLowerCase()

    return istNip05Domain(domain)
        ? { art: 'nip05', name: NIP05_WURZEL, domain }
        : { art: 'ungueltig', grund: 'format' }
}

/** Das Ergebnis einer NIP-05-Abfrage — drei Ausgänge, und der mittlere ist kein Fehler. */
export type Nip05Ergebnis =
    | { art: 'gefunden'; pubkey: string }
    /** Die Domain hat geantwortet und führt diesen Namen nicht. */
    | { art: 'unbekannt' }
    /** Die Domain war nicht erreichbar oder ihre Antwort war keine `nostr.json`. */
    | { art: 'fehlgeschlagen' }

/**
 * Die Abfrage-URL. **Der Name wird kodiert, die Domain nicht** — sie ist bereits gegen
 * {@link istNip05Domain} geprüft und enthält per Konstruktion nur `a-z0-9-.`; ein
 * `encodeURIComponent` darüber würde nichts verändern und den Eindruck erwecken, hier
 * käme Ungeprüftes an.
 */
export const nip05Url = (ziel: { name: string; domain: string }): string =>
    `https://${ziel.domain}/.well-known/nostr.json?name=${encodeURIComponent(ziel.name)}`

/**
 * Die Antwort einer Domain deuten.
 *
 * ── Wo die Grenze zwischen „unbekannt" und „fehlgeschlagen" verläuft ────────────────
 *
 * `unbekannt` gilt **nur**, wenn die Antwort eine gültige `nostr.json` ist und der Name
 * darin schlicht fehlt. Alles andere ist `fehlgeschlagen`:
 *
 *  · kein Objekt, kein `names`-Objekt ⇒ das ist keine `nostr.json`, sondern irgendetwas
 *    (eine Fehlerseite, ein Reverse-Proxy, ein leeres 200er).
 *  · `names[name]` steht da, ist aber kein Hex-Pubkey ⇒ die Domain führt einen Eintrag,
 *    er ist nur unbrauchbar. „Kennt den Namen nicht" wäre dafür schlicht falsch.
 *
 * Nachgeschlagen wird **zeichengenau**, wie in welshmans `queryProfile`. Eine eigene
 * Groß-/Kleinschreibungs-Regel hier wäre eine zweite Auffassung davon, was `names` ist —
 * und sie würde still von der abweichen, mit der das Häkchen daneben entsteht.
 */
export const leseNip05Antwort = (roh: unknown, name: string): Nip05Ergebnis => {
    if (typeof roh !== 'object' || roh === null) {
        return { art: 'fehlgeschlagen' }
    }
    const names = (roh as { names?: unknown }).names
    if (typeof names !== 'object' || names === null) {
        return { art: 'fehlgeschlagen' }
    }
    if (!Object.prototype.hasOwnProperty.call(names, name)) {
        return { art: 'unbekannt' }
    }
    const pubkey = (names as Record<string, unknown>)[name]

    return typeof pubkey === 'string' && HEX64.test(pubkey)
        ? { art: 'gefunden', pubkey }
        : { art: 'fehlgeschlagen' }
}

/**
 * Eine NIP-05-Adresse auflösen. Die Abfrage kommt **von außen** herein — deshalb ist
 * diese Funktion unter `node --test` vollständig prüfbar, ohne dass je ein Byte das
 * Testgerät verlässt.
 *
 * `holeJson` darf werfen; jeder Wurf ist `fehlgeschlagen`. Das ist die einzige Stelle,
 * an der ein Fehler verschluckt wird, und sie verschluckt ihn **in einen benannten
 * Zustand** statt in ein `undefined` (siehe Modulkopf, `queryProfile`).
 */
export const aufloesenNip05 = async (
    ziel: { name: string; domain: string },
    holeJson: (url: string) => Promise<unknown>,
): Promise<Nip05Ergebnis> => {
    let roh: unknown
    try {
        roh = await holeJson(nip05Url(ziel))
    } catch {
        return { art: 'fehlgeschlagen' }
    }

    return leseNip05Antwort(roh, ziel.name)
}

/**
 * Wie lange auf eine `.well-known/nostr.json` gewartet wird.
 *
 * Ohne Frist bliebe die Seite im Ladezustand hängen, solange ein fremder Server die
 * Verbindung offen hält — und das ist kein Randfall, sondern die billigste Art, eine
 * Fläche stillzulegen. Acht Sekunden sind großzügig gegen eine langsame Leitung und
 * kurz genug, dass „diese Domain hat nicht geantwortet" noch eine Auskunft ist und
 * keine Beobachtung.
 */
export const NIP05_TIMEOUT_MS = 8_000

/**
 * Wie viele Zeichen einer `nostr.json` gelesen werden — **gelesen, nicht geparst.**
 *
 * Der Server am anderen Ende ist fremd und die Größe seiner Antwort seine Entscheidung.
 * Eine Million Zeichen sind rund zwanzigtausend Einträge — jenseits jeder echten
 * `nostr.json` und diesseits dessen, was `JSON.parse` in einem Frame schafft.
 *
 * ── Hier stand eine Zusage, die die Zeile nicht einlöste ────────────────────────────
 *
 * Bis 2026-08-21 lautete der Satz: „Ohne diese Grenze legt eine 200 MB große Antwort den
 * Tab still, und zwar im Parser." Der zweite Halbsatz stimmte, der erste nicht — die
 * Grenze stand **hinter** `await antwort.text()` und schützte damit nur `JSON.parse`,
 * nicht den Speicher. Gemessen in Chromium 151 am Produktivcode: 150 MB kamen als
 * 157.286.418 Zeichen in 139 ms an, und erst DANACH warf die Grenze; bei 250 MB starb
 * der Renderer-Tab, bevor irgendeine Zeile dieses Moduls zum Zug kam.
 *
 * Die Grenze steht seitdem **im Lesen** ({@link holeNip05Json}): der Körper wird
 * stückweise dekodiert, nach jedem Stück gezählt und beim Überschreiten wird der Strom
 * abgebrochen. Der Höchstverbrauch ist damit die Grenze plus ein Stück, unabhängig davon,
 * wie viel die Gegenseite senden wollte.
 *
 * **Der Frist ({@link NIP05_TIMEOUT_MS}) bleibt das nicht überlassen.** Sie greift sauber
 * — ein endloser Strom bricht nach exakt 8000 ms ab — und deckelt faktisch auf das, was
 * in acht Sekunden über die Leitung passt. Das ist auf einer schnellen Leitung sehr viel,
 * und „faktisch gedeckelt" ist keine Grenze, sondern eine Beobachtung über die Bandbreite
 * des Lesers.
 */
export const NIP05_MAX_ZEICHEN = 1_000_000

/**
 * Einen Antwortkörper lesen und **beim Überschreiten der Grenze abbrechen**.
 *
 * Steht als eigene, exportierte Funktion da, weil genau sie die Zusage von
 * {@link NIP05_MAX_ZEICHEN} trägt und ohne Netz prüfbar sein muss: ein Test reicht ihr
 * einen unendlichen Strom und zählt mit, wie viel die Gegenseite überhaupt liefern
 * durfte. Über `fetch` verschraubt wäre dieselbe Zusage nur noch behauptbar.
 *
 * **Warum kein `Content-Length` davor.** Der Kopf ist optional und kommt von genau dem
 * Server, gegen den die Grenze schützt — er kann lügen, und dann läse man trotzdem. Er
 * könnte also nie die tragende Prüfung sein, sondern nur eine zweite daneben, die im
 * gutartigen Fall ein Stück Arbeit spart und im bösartigen nichts. Eine Prüfung, die
 * nicht trägt, aber so aussieht, ist teurer als keine.
 *
 * **Warum stückweise dekodiert und nicht `await antwort.text()` mit Prüfung danach:**
 * genau das war der Fehler, den diese Fassung behebt (siehe {@link NIP05_MAX_ZEICHEN}).
 * `TextDecoder` mit `stream: true` hält dabei Mehrbyte-Zeichen über die Stückgrenze
 * hinweg zusammen — ein Umlaut, der auf zwei Stücke fällt, wird nicht zu zwei Fragezeichen.
 */
export const liesBegrenzt = async (koerper: ReadableStream<Uint8Array> | null): Promise<string> => {
    if (koerper === null) {
        // Ein 200er ohne Körper ist keine `nostr.json`. Fail-closed: der Aufrufer macht
        // daraus `fehlgeschlagen`, nicht „kennt den Namen nicht".
        throw new Error('NIP-05: Antwort ohne Körper')
    }
    const leser = koerper.getReader()
    const dekoder = new TextDecoder('utf-8')
    let text = ''
    try {
        for (;;) {
            const { done, value } = await leser.read()
            if (done) {
                return text + dekoder.decode()
            }
            text += dekoder.decode(value, { stream: true })
            if (text.length > NIP05_MAX_ZEICHEN) {
                throw new Error(`NIP-05: Antwort zu groß (über ${NIP05_MAX_ZEICHEN} Zeichen)`)
            }
        }
    } finally {
        // **Der Abbruch ist der Punkt der ganzen Funktion**, nicht Aufräumen: er schließt
        // die Verbindung, statt den Rest der Antwort noch entgegenzunehmen. Auf dem
        // regulären Weg ist der Strom bereits erschöpft und das hier ein Nullbetrieb.
        void leser.cancel().catch(() => {})
    }
}

/**
 * Die eine unreine Funktion dieses Moduls: die tatsächliche Abfrage.
 *
 * **Sie steht hier und nicht in `longformFeed.ts`**, weil sie mit {@link nip05Url} und
 * {@link leseNip05Antwort} einen Vertrag bildet — welche URL, welche Grenzen, welche
 * Antwort zählt. Über zwei Dateien verteilt wäre dieser Vertrag nirgends ganz zu lesen.
 * Für Tests wird sie nicht gebraucht: {@link aufloesenNip05} nimmt jede Implementierung.
 *
 * Drei Entscheidungen, alle drei bewusst:
 *  · `credentials: 'omit'` — die Domain ist fremd und bekommt keine Cookies zu sehen.
 *    (Der Browser-Default `same-origin` täte hier dasselbe; ausgeschrieben steht es da,
 *    weil eine Zusage, die von einem Default abhängt, keine ist.)
 *  · `AbortSignal.timeout` statt einer eigenen Uhr — die Frist gilt für die gesamte
 *    Anfrage inklusive Verbindungsaufbau.
 *  · **Der Körper geht durch {@link liesBegrenzt}** und nicht durch `res.json()` oder
 *    `res.text()`: nur so wirkt die Größengrenze VOR dem Speicher und nicht erst vor dem
 *    Parser.
 */
export const holeNip05Json = async (url: string): Promise<unknown> => {
    const antwort = await fetch(url, {
        credentials: 'omit',
        headers: { accept: 'application/json' },
        signal: AbortSignal.timeout(NIP05_TIMEOUT_MS),
    })
    if (!antwort.ok) {
        throw new Error(`NIP-05: ${antwort.status}`)
    }

    return JSON.parse(await liesBegrenzt(antwort.body))
}

/**
 * **Der Kernbeweis dieser Phase: gefiltert wird der `pubkey`, nie der Name.**
 *
 * Zwei Autoren dürfen gleich heißen, und im Bestand ist das kein Gedankenspiel — der
 * Anzeigename kommt aus einem kind 0, das jeder für sich selbst schreibt, und niemand
 * prüft ihn gegen irgendetwas. Ein Filter über `authorName` legte die Artikel zweier
 * Menschen zusammen und schriebe sie beide dem zu, dessen Seite gerade offen ist.
 *
 * Der Name ist zusätzlich **asynchron**: bis das kind 0 eintrifft, heißt jeder Autor
 * `npub1abcde…xyz123`. Ein namensbasierter Filter fände in dieser Zeitspanne entweder
 * nichts oder alles.
 *
 * **Fail-closed bei leerem `pubkey`.** Ohne Adresse gibt es keine Auswahl, und eine
 * leere Zeichenkette dürfte nie „alles" bedeuten: `rows.filter(r => r.pubkey === '')`
 * ergäbe zwar auch nichts, aber die Absicht stünde nirgends. Hier steht sie.
 *
 * Nimmt jedes Objekt mit `pubkey` — dieselbe Funktion wählt die rohen Events auf der
 * welshman-Seite aus und die {@link ArticleRow}s in einem Test.
 */
export const artikelDesAutors = <T extends { pubkey: string }>(zeilen: readonly T[], pubkey: string): T[] =>
    pubkey === '' ? [] : zeilen.filter((zeile) => zeile.pubkey === pubkey)

/**
 * Das Jahr eines Zeitpunkts — **in der Zone des Lesers**, nicht in UTC.
 *
 * Das Haus rechnet Kalenderdaten sonst über UTC-Ordinale, damit eine Differenz nicht von
 * einer Zeitzone abhängt. Hier ist die Frage eine andere: nicht „wie viele Tage liegen
 * dazwischen", sondern „in welches Jahr fällt dieser Zeitpunkt für den, der hinsieht".
 * Und darauf ist die lokale Antwort die richtige — die Karte darunter trägt ihr Datum
 * ebenfalls lokal (`formatTimestamp`, `locale.ts`). Rechnete die Jahresmarke in UTC,
 * stünde für jeden Leser östlich von Greenwich irgendwann ein „31. Dezember 2024" unter
 * der Marke „2025", und die Gliederung widerspräche sichtbar ihrem eigenen Inhalt.
 *
 * Injizierbar bleibt sie trotzdem: ein Test, der eine Jahresgrenze prüft, darf nicht
 * davon abhängen, in welcher Zone er läuft.
 */
export const lokalesJahr = (ts: number): number => new Date(ts * 1000).getFullYear()

/** Ein Monat der Autorenseite: das Datum, die Artikel darin, in Eingabereihenfolge. */
export type Monatsgruppe<T> = {
    /** Kalenderjahr, lokal. */
    jahr: number
    /** Monat, **1–12** (nicht 0-basiert wie `Date.getMonth()`). */
    monat: number
    /**
     * Ein Zeitpunkt AUS diesem Monat — das `publishedAt` des ersten Artikels der Gruppe.
     *
     * Er ist der Formatierer-Eingang: die Fläche macht daraus „August 2026" über
     * `formatTimestamp` und damit in der Sprache des Lesers. Er ist per Konstruktion
     * korrekt — gruppiert wird nach dem LOKALEN Monat desselben Zeitstempels, ein
     * Formatieren derselben Zahl in derselben Zone kann also gar nicht in einem anderen
     * Monat landen. Ein aus `jahr`/`monat` neu gebautes `Date` wäre der wackligere Weg:
     * `new Date(jahr, monat - 1, 1)` liegt am Monatsersten um Mitternacht, und genau dort
     * verschieben Zeitzonen einen Tag.
     */
    stempel: number
    artikel: T[]
}

/** Jahr und Monat (1–12) eines Zeitpunkts, **in der Zone des Lesers** — siehe {@link lokalesJahr}. */
export const lokalerMonat = (ts: number): { jahr: number; monat: number } => {
    const d = new Date(ts * 1000)

    return { jahr: d.getFullYear(), monat: d.getMonth() + 1 }
}

/**
 * Die Artikel eines Autors nach Erscheinungs-MONAT gliedern, **neuester Monat zuerst**.
 *
 * ── Warum Monat und nicht Jahr — gemessen, nicht geschätzt ──────────────────────────
 *
 * Der erste Entwurf gliederte nach Jahr. Am echten Bestand nachgemessen (2026-08-21,
 * 104 Artikel, 12 Autoren, gezogen mit `nak req -k 30023 --limit 300`) trägt das nichts:
 *
 * | Autor (Artikel) | Jahrgänge | Monate |
 * |-----------------|----------:|-------:|
 * | 55              |         1 |      5 |
 * | 14              |         1 |      2 |
 * | 13              |         1 |      2 |
 * | 11              |         2 |      4 |
 * | 3               |         2 |      3 |
 * | 2 und 6× 1      |         1 |      1 |
 *
 * **Zehn von zwölf Autoren hätten genau einen Jahrgang** — der Vielschreiber mit 55
 * Artikeln eingeschlossen. Eine Gliederung, die über 55 Karten eine einzige Marke setzt,
 * ist keine Gliederung, sondern eine Beschriftung. Nach Monat entstehen dort fünf Gruppen
 * (28 · 17 · 8 · 1 · 1) und die Fläche zeigt etwas Wahres: dieser Autor hat im Februar
 * angefangen, monatelang geschwiegen und im Juni losgelegt.
 *
 * Die Gliederung greift damit genau bei den vier Autoren, die 93 der 104 Artikel
 * schreiben (5 · 2 · 2 · 4 Gruppen), und fällt bei den sechs Ein-Artikel-Autoren auf eine
 * Marke zurück — dort fiele jede Gliederung darauf zurück.
 *
 * ── Die Bedingung, unter der Jahr wieder richtig wäre — neu entschieden ─────────────
 *
 * **Hier stand „die längste Spanne ist elf Monate (2025-10 bis 2026-08)". Die Zahl war
 * falsch, und mit ihr die Größe, die sie messen sollte.** Am selben Bestand nachgemessen
 * (2026-08-21, `nak req -k 30023 --limit 300`, 104 Artikel, dieselbe Ziehung wie oben):
 * die längste Spanne eines Autors ist **20 Monate** — `acbcec47…`, 2024-12 bis 2026-07.
 * Der Autor, der 2025-10 beginnt (`ad073484…`), endet 2026-01; das genannte Intervall
 * gehörte **keinem einzigen Autor**. Unter `created_at` gerechnet dasselbe Bild.
 *
 * **Und die Korrektur trifft die Begründung selbst, nicht nur ihre Zahl.** Die Spanne war
 * die falsche Größe: sie sagt nichts darüber, wie viele Marken auf der Seite stehen.
 * `acbcec47…` überspannt 20 Monate und bekommt trotzdem **drei** Marken, weil er drei
 * Artikel hat. Eine Jahresgliederung machte daraus zwei Marken über drei Karten — kaum
 * weniger Beschriftung und nachweislich weniger Auskunft: sie verschwiege, dass zwischen
 * dem ersten und den beiden anderen neunzehn Monate liegen.
 *
 * Die Größe, an der die Gliederung wirklich kippt, ist die **Zahl der Marken auf EINER
 * Seite** — sie und nur sie ist der Preis. Gemessen am Bestand:
 *
 *  · Höchstzahl der Monatsgruppen bei einem Autor: **fünf** (der Vielschreiber mit 55
 *    Artikeln), zweithöchste **vier**. Über alle zwölf Autoren zusammen 23 Gruppen auf
 *    104 Artikel, also **0,22 Marken je Artikel**.
 *  · Der schlechteste Wert dieser Quote ist **1,00** — bei `acbcec47…` (drei Artikel in
 *    drei Monaten) und bei den sechs Autoren mit genau einem Artikel. Dort entartet
 *    allerdings JEDE Gliederung, auch die nach Jahr, und drei Marken passen auf einen
 *    Bildschirm.
 *
 * **Jahr wird richtig, sobald eines von beidem eintritt:**
 *
 *  1. **Ein Autor kommt auf mehr als rund zwei Dutzend Monatsgruppen.** Jede Marke kostet
 *    eine eigene Zeile — `text-xs` (16 px Zeilenhöhe) + `mb-3` (12 px) + `space-y-8`
 *    (32 px) = 60 px, gerechnet aus den Klassen der Fläche, nicht gemessen. Zwei Dutzend
 *    Marken sind rund 1440 px, die niemand liest: der Leser scrollt dann an
 *    Beschriftungen entlang statt an Artikeln. Heute liegt das Maximum bei fünf.
 *  2. **Die Quote Marken/Artikel geht bei einem Autor mit mehr als einer Handvoll
 *    Artikeln gegen 1.** Dann steht über jeder Karte eine Marke, die nur ihr eigenes
 *    Datum wiederholt — und das Datum steht ohnehin schon auf der Karte. Heute erreicht
 *    das nur, wer ein bis drei Artikel hat, wo es folgenlos ist.
 *
 * Bei 20 Monaten Spanne trägt die Monatsgliederung also weiter, und zwar nicht knapp:
 * die Spanne ist überhaupt nicht die Größe, die sie belastet. **Wer das ändert, misst
 * vorher nach — und misst GRUPPEN je Autor, nicht Monate zwischen erstem und letztem.**
 *
 * **Ausdrücklich sortiert, nicht sequenziell gebildet** (dieselbe Begründung wie zuvor):
 * eine Bildung „solange derselbe Monat" hinge daran, dass die Eingabe bereits absteigend
 * sortiert ist. Die Reihenfolge INNERHALB einer Gruppe bleibt die der Eingabe.
 */
export const nachMonat = <T extends { publishedAt: number }>(
    zeilen: readonly T[],
    monatVon: (ts: number) => { jahr: number; monat: number } = lokalerMonat,
): Monatsgruppe<T>[] => {
    const gruppen = new Map<number, Monatsgruppe<T>>()
    for (const zeile of zeilen) {
        const { jahr, monat } = monatVon(zeile.publishedAt)
        // Ein Schlüssel, der ordnet: Jahr × 12 + Monat ist über jede Monatsgrenze hinweg
        // monoton, ein zusammengesetzter String wäre es nicht (`2026-9` > `2026-10`).
        const schluessel = jahr * 12 + monat
        const bestand = gruppen.get(schluessel)
        if (bestand) {
            bestand.artikel.push(zeile)
        } else {
            gruppen.set(schluessel, { jahr, monat, stempel: zeile.publishedAt, artikel: [zeile] })
        }
    }

    return [...gruppen.entries()].sort(([links], [rechts]) => rechts - links).map(([, gruppe]) => gruppe)
}

/** Die zwei Zahlen, die nur diese Seite beantworten kann. */
export type AutorGrunddaten = {
    /** Wie viele Artikel dieses Autors der Bestand kennt. */
    anzahl: number
    /**
     * Das Jahr des ÄLTESTEN Artikels — `0`, solange es keinen gibt.
     *
     * `0` ist hier kein Platzhalter, sondern „keine Angabe": die Fläche lässt die Zeile
     * dann weg, statt „seit 1970" zu behaupten. Dieselbe Regel wie bei
     * `ArticleRow.readingMinutes`.
     */
    seitJahr: number
}

/**
 * Anzahl und Anfangsjahr in einem Zug.
 *
 * Beides aus **denselben** Zeilen, die die Seite auch zeigt — und nicht aus einer
 * zweiten Abfrage: eine Zahl, die aus einer anderen Quelle stammt als die Liste
 * darunter, weicht früher oder später von ihr ab, und dann glaubt der Leser der Zahl.
 *
 * Das Minimum wird über `publishedAt` gebildet und nicht über die Position: die Liste
 * ist zwar absteigend sortiert, aber diese Funktion darf sich darauf nicht verlassen —
 * derselbe Grund wie bei {@link nachMonat}.
 */
export const autorGrunddaten = <T extends { publishedAt: number }>(
    zeilen: readonly T[],
    jahrVon: (ts: number) => number = lokalesJahr,
): AutorGrunddaten => {
    if (zeilen.length === 0) {
        return { anzahl: 0, seitJahr: 0 }
    }
    let aeltester = zeilen[0].publishedAt
    for (const zeile of zeilen) {
        if (zeile.publishedAt < aeltester) {
            aeltester = zeile.publishedAt
        }
    }

    return { anzahl: zeilen.length, seitJahr: jahrVon(aeltester) }
}

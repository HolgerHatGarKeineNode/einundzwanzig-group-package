/**
 * Die Relay-Konfiguration der Insel — als eigene Schicht UNTER `core.ts`.
 *
 * ── Warum diese Datei mit dem 0.9.5-Sprung entsteht ──────────────────────────────
 * Bis 0.8.16 waren die welshman-Kontexte mutierbare Globals: `core.ts` konnte sie im
 * Modul-Toplevel setzen, nachdem `@welshman/app` sich selbst konfiguriert hatte. In
 * 0.9.5 gibt es diese Globals nicht mehr — die Konfiguration wird `createApp({config})`
 * ÜBERGEBEN und ist danach an der Instanz festgeschrieben.
 *
 * Damit dreht sich die Abhängigkeitsrichtung um: die App-Instanz (`welshmanInstance.ts`)
 * muss ihre Konfiguration kennen, BEVOR irgendjemand sie benutzt — sie kann sie also
 * nicht aus `core.ts` holen, das seinerseits die Instanz importiert. Ein Import zurück
 * wäre genau der Zyklus, den `core.ts` an drei Stellen ausdrücklich vermeidet
 * (`WORKSPACE`, `METRIK_RELAYS`, `EIGENE_RELAYS` lesen alle direkt aus `globalThis`).
 *
 * Diese Datei ist die Auflösung: sie liest dieselbe eine Quelle — die Werte, die das
 * Head-Partial des Hosts vor dem Boot auf `globalThis` schreibt — und beide Seiten holen
 * sie hier ab. `core.ts` re-exportiert die drei Relay-Listen unverändert weiter, damit
 * seine sechs Importeure (`emoji.ts`, `feeds.ts`, `session.ts`, `bridge.ts`, …) nicht
 * angefasst werden müssen.
 *
 * **Bewusst schmal gehalten:** hier steht nur, was die App-Instanz zur Konstruktionszeit
 * braucht. Alles andere aus `core.ts` (Bild-Proxy, NativePHP-Bridge, Boot-Seiteneffekte)
 * bleibt dort — diese Datei ist keine zweite `core.ts`.
 */
import { normalizeRelayUrl } from '@welshman/util'
import { darfAuthBekommen as authErlaubt, leseRelayListeNachsichtig } from './articleMetrics.ts'

/**
 * Relay-Override für Tests/Self-Hosting: setzt `window.__nostrRelays` VOR dem Laden
 * (E2E via addInitScript) auf einen lokalen zooid. Ohne Override die öffentlichen
 * Defaults (aus dem Referenz-Client übernommen). NativePHP/Web identisch.
 */
type RelayOverride = { indexer?: string[]; default?: string[]; signer?: string[] }
const relayOverride = (globalThis as { __nostrRelays?: RelayOverride }).__nostrRelays

/**
 * **Ohne Fenster keine Default-Relays.** Eine Weiche mit einem gemessenen Grund.
 *
 * Bis 0.8.16 standen die Relay-Listen in `core.ts` und wurden von dort in die globalen
 * welshman-Kontexte geschrieben. Eine Testdatei, die `core.ts` nicht importierte, sah
 * deshalb schlicht keine Relays — und ging nie ins Netz.
 *
 * Mit 0.9.5 kehrt sich das um: die Konfiguration gehört zur App-INSTANZ, und die entsteht
 * in `js/welshmanInstance.ts`, das jede Datei mit `app`-Zugriff mitzieht. Ohne diese
 * Weiche telefonieren damit die Unit-Tests. **Gemessen, nicht befürchtet:** ein Lauf von
 * `js/zapTargetSources.test.ts` baute TLS-Verbindungen zu `purplepag.es`,
 * `relay.damus.io` und `indexer.coracle.social` auf — die Profil-Sammlung lädt über das
 * Outbox-Modell nach, sobald jemand `one(pubkey)` abonniert. Der Prozess beendete sich
 * danach nicht mehr, `npm run test:unit` lief in die Zeitgrenze.
 *
 * Das ist nicht nur langsam und flakig: ein Testlauf, der fremde Relays anspricht,
 * verrät dabei Abfragemuster an Dritte und hängt von deren Erreichbarkeit ab.
 *
 * `window` ist die Weiche und nicht `process`: im Browser und im WebView der
 * Companion-App gibt es es immer, unter `node --test` nie. Die E2E-Läufe sind nicht
 * betroffen — dort setzt der Host `__nostrRelays` per `addInitScript`, und ein
 * ausdrücklicher Override sticht diese Weiche.
 */
const imBrowser = typeof window !== 'undefined'

export const INDEXER_RELAYS = relayOverride?.indexer ?? (imBrowser ? [
    'wss://purplepag.es/',
    'wss://relay.damus.io/',
    'wss://indexer.coracle.social/',
] : [])

export const DEFAULT_RELAYS = relayOverride?.default ?? (imBrowser ? [
    'wss://relay.primal.net/',
    'wss://theforest.nostr1.com/',
    'wss://nostr.oxtr.dev/',
    'wss://nos.lol/',
] : [])

// relay.nsec.app ist tot — dauerhaft ausgeschlossen (Anweisung).
export const SIGNER_RELAYS = relayOverride?.signer ?? (imBrowser ? [
    'wss://bucket.coracle.social/',
    'wss://relay.primal.net/',
    'wss://nos.lol/',
] : [])

/**
 * Der ROHWERT aus `window.__nostrWorkspace`, ungeprüft und ungetrimmt-vergleichbar.
 *
 * Existiert nur, damit `js/welshmanInstance.ts` „konfiguriert, aber unbrauchbar" von
 * „gar nicht konfiguriert" unterscheiden kann — {@link WORKSPACE} kann beides nicht,
 * weil beides `''` ergibt.
 */
export const WORKSPACE_ROH = ((globalThis as { __nostrWorkspace?: string }).__nostrWorkspace ?? '').trim()

/**
 * Normalisiert eine konfigurierte Workspace-URL — **nachsichtig: eine unbrauchbare
 * Eingabe wird zu `''` („Feature aus"), nicht zu einem Wurf.**
 *
 * ── Warum nachsichtig, obwohl ein Wurf ehrlicher aussieht ──────────────────────
 *
 * Der Wert kommt aus der Server-Konfiguration: `config('group.workspace_url')` →
 * `partials/head.blade.php` → `window.__nostrWorkspace`. Er wird auf MODUL-TOPLEVEL
 * gelesen, und dieses Modul liegt unter `js/core.ts` (dort statisch importiert, Zeile 23).
 *
 * `normalizeRelayUrl` wirft bei kaputter Eingabe. Am Paket gemessen:
 *
 *   'buzz.example'  → 'wss://buzz.example/'      (nachgezogen, gut)
 *   'http://x'      → 'wss://x/'                 (nachgezogen, gut)
 *   'wss:// x/'     → TypeError: Invalid URL     ← ein Leerzeichen genügt
 *   'wss://'        → TypeError: Invalid URL
 *
 * Und gemessen, was der Wurf anrichtet: mit `__nostrWorkspace = 'wss:// buzz…/'` ist
 * `js/relayConfig.ts` nicht mehr importierbar — damit `js/core.ts` nicht, damit die
 * gesamte Nostr-Insel nicht. Ein Tippfehler in EINER ENV-Zeile nimmt also nicht den
 * Workspace-Tab weg, sondern die ganze Anwendung, und die Konsole nennt als Ursache
 * „Invalid URL" ohne zu sagen, welche. Das ist der teuerste denkbare Umgang mit dem
 * billigsten denkbaren Fehler.
 *
 * Nachsichtig heißt NICHT still: `js/welshmanInstance.ts` meldet den Fall einmalig und
 * benannt in die Konsole, samt Rohwert. Das Feature fällt aus, die Anwendung läuft, und
 * es steht dran, warum.
 */
export const normalisiereWorkspaceUrl = (roh?: string): string => {
    const wert = (roh ?? '').trim()

    if (!wert) {
        return ''
    }

    try {
        return normalizeRelayUrl(wert)
    } catch {
        return ''
    }
}

/**
 * Die Workspace-URL, normalisiert — oder `''`, wenn kein zweiter Space konfiguriert ist
 * ODER der konfigurierte unbrauchbar war (siehe {@link normalisiereWorkspaceUrl}).
 * Direkt aus `globalThis` und nicht aus `groups.ts`: das wäre ein Zyklus (siehe Modulkopf).
 */
export const WORKSPACE = normalisiereWorkspaceUrl(WORKSPACE_ROH)

/**
 * The FOREIGN relays that never get an AUTH: the article social signals (P6) **and since
 * P2 the calendar relays** (`__nostrCalendarRelays`, NIP-52).
 *
 * ── Why the calendar relays had to go in here ────────────────────────────────────
 *
 * The header of {@link darfAuthBekommen} names the price of the exclusion form outright:
 * *"it is fail-OPEN for anything that comes later. A new foreign-relay path … gets AUTH
 * without anybody doing anything and without anything going red."* P2 is such a path —
 * and the case is the same one as the metric relays, not a similar one:
 * `nos.lol`/`relay.damus.io` are foreign operators, they are asked **without any user
 * action** on the bare opening of a meetup room, and the filter carries exactly ONE
 * meetup coordinate. A signed 22242 would tie identity, IP, time and "which meetup does
 * this reader care about" together.
 *
 * **WRITING an RSVP is untouched by this and does not refute the block:** a kind 31925
 * carries the pubkey in the clear anyway, but it only leaves on a button press. The block
 * protects the reader, not the responder — and neither relay demands an AUTH for either
 * path (NIP-11 `limitation` without `auth_required`, measured 2026-08-21 and confirmed
 * unchanged during the calendar load on 2026-09-05).
 *
 * The `EIGENE_RELAYS` exception applies here just the same: an E2E run enters the
 * worker's own zooid as the calendar relay (a foreign address there would break the relay
 * guard), and that zooid does demand AUTH. Without the exception the surface would be
 * **silently** empty there — the same measurement that `board-fixtures.ts` already paid
 * for once.
 *
 * ── `…Nachsichtig` und NICHT `leseRelayListe`, und das ist hier kein Detail ──────
 *
 * `normalizeRelayUrl` **wirft** bei Müll, und dieser Ausdruck steht im **Modul-Toplevel**.
 * Am Baum nachgemessen (2026-08-21): `core.ts` wird von **elf Modulen STATISCH** importiert
 * — darunter `bridge.ts`, der Einstiegspunkt — und von **keinem einzigen dynamisch. Es gibt
 * hier also nichts, was einen Wurf auffangen könnte.** Ein Tippfehler in
 * `NOSTR_ARTICLE_METRIC_RELAYS` risse damit nicht die Artikelfläche ab, sondern die
 * **gesamte Client-Insel, beim Boot, stumm.**
 *
 * **Der Befund gilt nach dem 0.9.5-Sprung unverändert und für DIESE Datei erst recht:**
 * sie liegt jetzt noch tiefer im Graphen — `welshmanInstance.ts` importiert sie, und den
 * importiert alles, was `app` anfasst. Der Radius eines Wurfs ist also größer geworden,
 * nicht kleiner.
 *
 * **Das war eine Eindämmungs-Regression:** dieselbe Konstante lag vor dem AUTH-Riegel nur
 * in `longformFeed.ts`, und das wird ausschließlich DYNAMISCH geladen — alle vier
 * Importstellen fangen, drei davon mit sichtbarer Fehlerzeile. Dort ist der Wurf die
 * bessere Rückmeldung und bleibt deshalb; hier wäre er ein toter Client für einen
 * Konfigurationsfehler.
 *
 * Der Nebeneffekt ist zugleich eine Zusage: das Set enthält **per Konstruktion nur
 * wohlgeformte Adressen**, und genau darauf stützt sich {@link darfAuthBekommen}, wenn es
 * einen unlesbaren Eintrag als abwesend behandelt.
 */
const METRIK_RELAYS = new Set([
    ...leseRelayListeNachsichtig((globalThis as { __nostrArticleRelays?: string }).__nostrArticleRelays),
    ...leseRelayListeNachsichtig((globalThis as { __nostrCalendarRelays?: string }).__nostrCalendarRelays),
])

/**
 * Die zum Boot bekannten EIGENEN Relays — sie stechen die Metrik-Sperre.
 *
 * Dieselbe Quelle, aus der das Head-Partial sie schreibt. Leere Einträge fallen in
 * `darfAuthBekommen` durch (`if (eintrag && …)`), eine fehlende Konfiguration erzeugt
 * hier also keine leere Rückausnahme.
 */
const EIGENE_RELAYS = [
    (globalThis as { __nostrSpace?: string }).__nostrSpace ?? '',
    (globalThis as { __nostrWorkspace?: string }).__nostrWorkspace ?? '',
    (globalThis as { __nostrBoard?: string }).__nostrBoard ?? '',
]

/**
 * Darf dieser Relay eine AUTH-Challenge von uns beantwortet bekommen?
 *
 * ── Der Befund, gegen den das steht ────────────────────────────────────────────────
 *
 * `shouldAuth` bekommt den Socket übergeben und hat ihn bis P6 ignoriert: **jeder** Relay,
 * der eine Challenge schickt, bekam ein signiertes kind 22242 — also den Pubkey des Lesers,
 * verknüpfbar mit IP, Zeitpunkt und den angefragten Filtern. Solange der Radius das
 * Vereins-Relay war, war das der dokumentierte Handel („ponytail: aggressiv").
 * **P6 macht daraus zwei fremde Betreiber, und zwar ohne jede Nutzerhandlung:**
 * `loadArticleMetrics` hängt an `loadArticles`/`loadArticle`, beide laufen beim Mount, und
 * die Vollansicht fragt mit genau EINER Artikeladresse. Das ist die Verknüpfung von
 * Identität und Lesehistorie, frei Haus.
 *
 * ── Warum eine AUSSCHLUSSliste und keine Whitelist ────────────────────────────────
 *
 * Die naheliegende Form wäre „nur unsere eigenen Relays" — und sie ist hier **nicht sicher
 * baubar**, aus einem Grund, der im Code steht und nicht in einer Meinung: die Menge der
 * eigenen Relays ist **nicht statisch**. `userSpaceUrls` (`groups.ts`) wird aus der
 * 10009-Gruppenliste des Nutzers ABGELEITET, wächst also zur Laufzeit aus dem Netz, und
 * `setActiveSpace(url)` nimmt aus den Einstellungen jede beliebige Adresse. Eine Whitelist
 * aus den drei Config-Werten wäre für genau diese Relays unvollständig — und ausgerechnet
 * dort ist AUTH zwingend: ein zooid mit `public_read=false` liefert ohne AUTH **nichts**,
 * und der Ausfall wäre **stumm** (eine hängende AUTH-Runde verschluckt das EOSE, ein
 * Mitschnitt an `Receive` sieht es nicht).
 *
 * Die Ausschlussform ist dagegen **exakt und vollständig**: sie schließt genau den Radius,
 * den P6 geöffnet hat, und lässt jeden Bestandspfad Zeichen für Zeichen, wie er war —
 * Space, Workspace/Buzz, Board, Indexer, Signer-Relays.
 *
 * ── Und sie kostet nichts, das ist gemessen ───────────────────────────────────────
 *
 * Ein Metrik-Relay liefert öffentliche Reaktionen; für ein REQ darauf braucht niemand eine
 * Identität. Am 2026-08-21 per NIP-11 nachgesehen: `nos.lol` und `relay.damus.io` (die
 * empfohlenen Werte) führen in ihrer `limitation` **gar kein `auth_required`** — sie
 * verlangen also keins. „Meldet `false`" wäre die falsche Wiedergabe eines fehlenden Felds.
 * Fiele ein künftiges Metrik-Relay unter AUTH-Zwang, lieferte es hier nichts mehr — die
 * Zähler würden kleiner, nichts bräche, und das ist die richtige Richtung für einen Zähler.
 *
 * **Und sie ist die ZWISCHENLÖSUNG, nicht das Ziel.** Ihr Preis ist, dass sie fail-OPEN ist
 * für alles, was künftig dazukommt: ein neuer Fremdrelay-Pfad bekommt AUTH, ohne dass jemand
 * etwas tut und ohne dass etwas rot wird. Tragbar, weil sie exakt den Radius schließt, den
 * P6 geöffnet hat — **die Richtung bleibt die Einschlussform über `userSpaceUrls`**. Dieser
 * Punkt ist damit nicht erledigt, sondern zwischengelöst.
 *
 * **Was hiermit ebenfalls NICHT behoben ist, ausdrücklich:** `INDEXER_RELAYS`,
 * `DEFAULT_RELAYS` und `SIGNER_RELAYS` sind fremd und bekommen weiterhin AUTH. Bestand von
 * vor P6, Teil desselben offenen Auftrags. Wer ihn angeht, fängt bei `userSpaceUrls` an —
 * nicht bei einer Literalliste.
 */
export const darfAuthBekommen = (url: string): boolean => authErlaubt(url, METRIK_RELAYS, EIGENE_RELAYS)

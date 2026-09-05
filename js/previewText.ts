/**
 * Der Vorschautext einer Nachricht — die eine Regel für alle Zeilen, die eine Nachricht
 * ANREISSEN statt sie zu rendern.
 *
 * Sechs Flächen zeigen einen Anriss:
 *
 *   1. die Benachrichtigungs-Liste (`updates.ts`)
 *   2. die Antwort-Vorschau über einer Nachricht (`feeds.ts replyPreview`)
 *   3. die Leiste der angepinnten Nachricht (`roomPins.ts pinnedEntry`)
 *   4. die Trefferzeile der Raum-Suche (`roomSearch.ts roomSearchRow`)
 *   5. der Thread-Kopf in der Space-Übersicht der Startseite (`feeds.ts threadSnippet`)
 *   6. der Ausschnitt in der Zitatkarte (`feeds.ts refCardText`)
 *
 * Alle sechs gaben bis zum 2026-09-05 `bodyWithoutQuote(event)` weiter und damit jede
 * NIP-19-Kennung, die im Text steht — die ersten vier roh, die letzten beiden gekürzt,
 * aber in der falschen Reihenfolge und ohne Namen. Sie kamen in drei Schritten desselben
 * Tages nach; 5 und 6 lagen ausserhalb der DoD des ersten Schritts.
 *
 * **Diese Liste ist der einzige Schutz gegen eine SIEBTE Fläche.** Kein Test sieht eine
 * Zeile, die es noch nicht gibt: der Verdrahtungs-Riegel in `previewText.test.ts` prüft je
 * Aufrufstelle, kennt also nur die sechs hier. Wer eine Zeile baut, die eine Nachricht
 * anreisst statt sie zu rendern, trägt sie an beiden Orten ein.
 *
 * **Was das gekostet hat, gemessen am 2026-09-04** (390 px, `line-clamp-2`, Textspalte
 * 278 px, Zeichen per Range-Rect gegen die Elementbox gezählt):
 *
 *   | Fall | im DOM | sichtbar | davon bech32 |
 *   |---|---|---|---|
 *   | Antwort mit `nostr:nevent…`-Zitat ohne `q`-Tag | 234 | 64 | 33, Satz danach abgeschnitten |
 *   | Erwähnung, wie unser eigener Verfasser sie schreibt | 100 | 63 | 33 |
 *   | dieselbe Erwähnung nach dieser Regel | 48 | 47 | 0 |
 *
 * Der zweite Fall braucht kein fehlendes Tag und keinen fremden Client: `interactions.ts`
 * `mentionInsert` schreibt Erwähnungen als `nostr:<npub> `, und `updates.ts` macht eine
 * Zeile GENAU DANN zur Erwähnung, wenn der eigene npub wörtlich im Text steht. Jede
 * „X hat dich erwähnt"-Zeile trug damit zwangsläufig mindestens 69 rohe Zeichen — den
 * npub des Lesers selbst.
 *
 * ── Drei Entscheidungen, die hier festgeschrieben sind ─────────────────────────────
 *
 * **1. Das vorangestellte Zitat fällt OHNE `q`-Tag-Bedingung.** `feeds.ts
 * bodyWithoutQuote` entfernt den Präfix nur, wenn das Ereignis ein `q`-Tag trägt (NIP-18)
 * — und das ist dort richtig: der Chat rendert stattdessen eine Zitatkarte, und ein
 * Text, der ohne `q`-Tag mit `nostr:nevent…` beginnt, ist eben KEINE Antwort, sondern
 * ein geteilter Beitrag, der seine Karte bekommen soll (`firstNostrRef` liest denselben
 * Text). Eine Vorschauzeile hat keine Karte. Für sie gibt es keinen Grund, den Präfix
 * stehen zu lassen, nur weil ein Fremdclient statt `q` ein `e`-Tag gesetzt hat. Der
 * Android-Poller entscheidet seit dem 2026-08-19 genauso (`twenty-one-companion`,
 * `RelayPollWorker.kt readableBody` — dort ebenfalls bedingungslos).
 *
 * **2. Bereinigen kommt VOR Kürzen.** Umgekehrt (`withShortRefTokens(snippet(x))`) ist es
 * löchrig: eine Kennung, die über die 120-Zeichen-Kappung von `feeds.ts snippet`
 * hinausragt, wird verstümmelt, passt danach auf kein Muster mehr — `REF_TOKEN` wie
 * {@link PREVIEW_REF} verlangen für `nevent1` `{60,512}` — und bleibt roh stehen
 * (nachgemessen 2026-09-04 an `…\n\nvgl. nostr:note1…`). Wer diese Funktion benutzt, ruft
 * sie deshalb VOR jedem `slice`/`snippet` auf.
 *
 * Am 2026-09-05 ausgerechnet und gemessen: 62 Zeichen Vorlauf, dann eine `nevent1`-Kennung
 * — nach der Kappung überleben 44 ihrer Datenzeichen. Zu wenig für `{60,512}`, also lässt
 * die alte Reihenfolge sie stehen: 51 bech32-Zeichen (`nevent1` + 44) plus das `nostr:`
 * davor, also 57 Zeichen roher Kennungs-Rumpf in einer Zeile, die 120 lang sein darf. Die
 * richtige Reihenfolge liefert stattdessen `nevent1qgsvenxve…`. Genau diese Rechnung ist
 * die Kalibrierung des Ordnungsfalls in `previewText.test.ts` — mit einer zu kleinen
 * Füllung kürzt auch die FALSCHE Reihenfolge den Rest weg, und der Fall unterscheidet die
 * beiden nicht mehr.
 *
 * **Seit dem 2026-09-05 macht es kein Ort im Haus mehr umgekehrt.** `feeds.ts buildRefCard`
 * war der letzte (`text:` der Zitatkarte, byte-gleiche Komposition) und wurde im selben
 * Zug nachgezogen. Das Argument „daneben steht ja ein aufgelöster Link" hat ihn eine Runde
 * lang gerettet und trägt nicht: die rohen Zeichen stehen IM Ausschnitt.
 * `withShortRefTokens` hat damit keinen Aufrufer in der Anwendung mehr — es lebt nur noch
 * in seinen eigenen Tests.
 *
 * **3. Die Fehlerrichtung geht nur nach kürzer und generischer, nie auf leer.** Kein
 * Nachladen, kein Wurf, kein Rückfall auf die rohe Kennung. Begründung an
 * {@link readableRefTokens}.
 */
import { type TrustedEvent } from '@welshman/util'
import { QUOTE_PREFIX } from './polls.ts'
import { REF_DECODE_CAP, shortenEntity } from './nostrEventLink.ts'
import * as nip19 from 'nostr-tools/nip19'

/**
 * Wie eine Fläche den Anzeigenamen eines Pubkeys auflöst.
 *
 * **Reine Momentaufnahme, niemals ein Ladeanstoss.** Die drei Chat-Flächen reichen
 * `spaceProfiles.ts displayProfileByPubkey` durch (liest `app.use(Profiles).get`, ein
 * Cache-Zugriff ohne Netz), `updates.ts` reicht seine schon gehaltene `profiles`-Map.
 *
 * Der Grund ist kein Geschmack: diese Funktionen laufen im Benachrichtigungslauf von
 * svelte 5.56.4s globaler `subscriber_queue`, und ein Wurf von dort zerlegt sie dauerhaft.
 * `svelte/src/store/shared/index.js:56-59` leert die Queue erst NACH der Schleife
 * (`subscriber_queue.length = 0`); wer aus der Schleife heraus wirft, lässt sie gefüllt
 * zurück, und jedes spätere `set` sieht `run_queue === false` und stellt nur noch ein.
 * Danach erreicht ein völlig unabhängiger `writable` seine Subscriber nicht mehr
 * (`updates.ts`, Vorfall vom 2026-07-23).
 *
 * **Nicht „`derived`-Callbacks" — das stand hier bis zum 2026-09-05 und war für zwei der
 * sechs Flächen falsch.** Zeile 57 ruft den SUBSCRIBER auf; ein `.subscribe()`-Callback
 * steht damit genauso in der Schleife wie eine Ableitung. Der Weg je Fläche:
 *
 *   | Fläche | wie sie hierher kommt |
 *   |---|---|
 *   | `updates.ts computeUpdates` | `derived([...])`-Callback |
 *   | `feeds.ts replyPreview` / `threadSnippet` / `refCardText` | `derived([...])`-Callback |
 *   | `roomPins.ts pinnedEntry` | `recompute()` aus `derivePinSource(...).subscribe(...)` |
 *   | `roomSearch.ts roomSearchRow` | `run()` aus `deriveRoomMessages(...).subscribe(...)` — **und** aus Alpines `$watch('query')` |
 *
 * Nur der `$watch`-Pfad steht ausserhalb der Queue; für ihn galt die alte Begründung nie.
 * Die Vorsicht ändert das nicht, denn dieselbe Funktion läuft über den Abo-Pfad wieder
 * hinein — eine Zusage, die nur auf einem von zwei Aufrufwegen gilt, ist keine. Und ein
 * Ladeanstoss aus einer Ableitung heraus feuert bei jeder Neuberechnung erneut.
 *
 * Rückgabe ist IMMER etwas Anzeigbares — bei unbekanntem Profil die gekürzte Kennung aus
 * `@welshman/domain displayPubkey`. Liefert eine Fläche trotzdem `''`, greift der
 * Rückfall in {@link readableRefTokens}.
 */
export type NameResolver = (pubkeyHex: string) => string

/**
 * NIP-21-Referenzen im Vorschautext, längenbegrenzt je Kennungsart.
 *
 * **Bewusst ein eigenes Muster statt `nostrEventLink.ts REF_TOKEN`**, obwohl die Schranken
 * von dort übernommen sind (dort gemessen am 2026-08-11): `REF_TOKEN` speist
 * {@link import('./nostrEventLink.ts').firstNostrRef}, also die Auswahl der EINEN
 * Zitatkarte je Nachricht. `naddr1` gehört dort nicht hinein — `decodeEventToken` kann es
 * nicht auflösen, es würde nur das Dekodier-Budget verbrennen. In einer Vorschauzeile
 * dagegen ist ein `naddr` (Langtext, NIP-23) genauso eine Kennungs-Wurst wie ein `nevent`
 * und muss weg. Die Erweiterung hier lässt den Kartenpfad unangetastet.
 *
 * `(?![0-9a-z])` ist dieselbe Grenze wie dort: ohne sie schnitte
 * `nostr:note1<58 Zeichen><mehr>` ein Präfix heraus und ersetzte etwas, das gar keine
 * Kennung ist.
 *
 * Modul-global und `g`: `String.replace` setzt `lastIndex` selbst zurück, `.test()`/
 * `.exec()` täten es nicht — auf diesem Muster läuft deshalb ausschliesslich `replace`.
 */
const PREVIEW_REF =
    /nostr:(note1[0-9a-z]{58}|npub1[0-9a-z]{58}|nevent1[0-9a-z]{60,512}|nprofile1[0-9a-z]{60,512}|naddr1[0-9a-z]{60,512})(?![0-9a-z])/g

/** Kennungsarten, die eine PERSON meinen — nur sie haben einen Namen aufzulösen. */
const isProfileToken = (token: string): boolean => token.startsWith('npub1') || token.startsWith('nprofile1')

/**
 * Eine nackte NIP-19-Kennung IM NAMEN — ohne `nostr:`, denn das ist beim Sanieren schon
 * weg. Ab 20 Datenzeichen: jede Kurzform liegt darunter (16 bzw. 14), ein Wort mit 20
 * bech32-Zeichen hinter `npub1` ist kein Wort mehr.
 */
const BLOSSE_KENNUNG = /(?:note1|npub1|nevent1|nprofile1|naddr1)[0-9a-z]{20,}/g

/**
 * Ein aufgelöster Name, so wie er in eine Vorschauzeile darf.
 *
 * Ein kind-0-`name` ist Fremdtext: er kann Zeilenumbrüche tragen (die eine einzeilige
 * Vorschau sprengen) und er kann selbst eine Kennung enthalten. Ohne diesen Schritt hätte
 * die Bereinigung ein Loch, durch das genau das zurückkäme, was sie entfernt — ein Profil,
 * das sich so benennt, wäre der billigste Angriff auf diese Fläche.
 *
 * **Zwei Schnitte, nicht einer.** Der erste Entwurf entfernte nur `nostr:` — und liess die
 * 63 Zeichen dahinter stehen. Der Wall war weiterhin da, nur ohne Schema (vom Test dieser
 * Datei gefangen, nicht vermutet). Deshalb fällt hier auch die BLOSSE Kennung.
 *
 * **Warum im Namen strenger als im Nachrichtentext**, wo nacktes bech32 stehen bleibt
 * (NIP-21-Grenze, siehe {@link PREVIEW_REF}): den Nachrichtentext hat ein Mensch
 * geschrieben, und die Grenze gilt dort auf allen Flächen gleich. Der Name dagegen wird
 * von DIESER Funktion in eine Zeile eingesetzt, die sie gerade säubert. Wer säubert, darf
 * nicht selbst der Einlass sein.
 *
 * 60 Zeichen ist die Grenze, die `welshmanProfile.ts displayProfile` ohnehin schon zieht;
 * sie steht hier ein zweites Mal, weil dieser Pfad auch mit Namen aus anderen Quellen
 * gefüttert werden kann.
 */
const sanitizeName = (name: string): string =>
    name
        .replace(/nostr:/gi, '')
        .replace(BLOSSE_KENNUNG, (treffer) => shortenEntity(treffer))
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 60)
        .trim()

/**
 * Ersetzt jede NIP-21-Referenz durch etwas Lesbares: Personen durch `@Name`, alles andere
 * durch die gekürzte Kennung.
 *
 * ── Die Fehlerrichtung, Stufe für Stufe ────────────────────────────────────────────
 *
 *   Person mit kind 0        → `@Alice`
 *   Person ohne kind 0       → `@npub1abc…de123`  (der Resolver liefert `displayPubkey`)
 *   Resolver liefert nichts  → `npub1abcdefghijk…` (gekürzte Kennung, {@link shortenEntity})
 *   Kennung nicht dekodierbar→ `npub1abcdefghijk…`
 *   mehr als {@link REF_DECODE_CAP} Fehlschläge → ab da nur noch gekürzt
 *
 * **Nie leer.** „Frag mal danach" ohne jeden Hinweis ist eine andere Nachricht als die
 * geschriebene; die Kennung wird ERSETZT, nicht gelöscht. **Nie roh.** Jede Stufe endet
 * bei etwas Kurzem, keine bei der vollen Kennung. **Nie ein Wurf:** `nip19.decode` wirft
 * bei kaputter Prüfsumme, und dieser Code läuft im Benachrichtigungslauf der svelte-Stores
 * — in Ableitungen wie in `.subscribe`-Callbacks (siehe {@link NameResolver}).
 *
 * **Der Deckel ist nicht gegen das Suchen, sondern gegen das Dekodieren.** Jeder
 * fehlschlagende `nip19.decode` erzeugt einen Error samt Stack; ein Text aus Attrappen
 * kostete in `updates.ts` gemessen ~700× so viel wie normaler Text. Das Längenmuster hält
 * die billigen Attrappen (`nostr:npub1x`) schon draussen; der Deckel hält die teuren
 * (formal plausibel, Prüfsumme kaputt) auf. Danach wird weiter ersetzt, nur ohne Namen —
 * roh bleibt nichts stehen.
 *
 * **Warum die Personen-Kurzform Kopf UND Ende zeigt** (`npub1abc…de123`, 14 Zeichen aus
 * `@welshman/domain displayPubkey`) **und die Ereignis-Kurzform nur den Kopf**
 * (`nevent1qgsthwamhwa…`, 16 Zeichen aus {@link shortenEntity}): zwei npubs mit gleichem
 * Präfix sind in einer reinen Kopf-Kürzung nicht mehr auseinanderzuhalten, und eine
 * Person will man unterscheiden können. Eine Ereignis-Kennung dagegen ist Bauteil eines
 * Deep-Links, dort ist der Kopf die vertraute Form (Zitatkarte, Threads-Liste). Die dritte
 * Zahl im Haus — 12 Zeichen im Android-Poller (`RelayPollWorker.kt`) — ist damit die
 * abweichende; sie liegt in einem anderen Repo und bleibt in dieser Runde offen.
 */
export const readableRefTokens = (text: string, resolveName: NameResolver): string => {
    let fehlschlaege = 0
    return text.replace(PREVIEW_REF, (_match, token: string) => {
        if (!isProfileToken(token)) {
            return shortenEntity(token)
        }
        if (fehlschlaege >= REF_DECODE_CAP) {
            return shortenEntity(token)
        }
        let pubkey = ''
        try {
            const decoded = nip19.decode(token)
            if (decoded.type === 'npub') {
                pubkey = decoded.data
            } else if (decoded.type === 'nprofile') {
                pubkey = decoded.data.pubkey
            }
        } catch {
            // Kaputte Prüfsumme / gekürztes Token — keine Person, kein Fehler.
        }
        if (!pubkey) {
            fehlschlaege++
            return shortenEntity(token)
        }
        let name = ''
        try {
            name = sanitizeName(resolveName(pubkey) ?? '')
        } catch {
            // Eine Fläche, die beim Auflösen wirft, darf die Ableitung nicht mitreissen.
        }
        return name ? `@${name}` : shortenEntity(token)
    })
}

/**
 * Der Vorschautext eines Ereignisses: ohne vorangestelltes Antwort-Zitat, ohne rohe
 * NIP-19-Kennung.
 *
 * Das ist die Funktion, die die sechs Anriss-Flächen rufen — **vor** jedem Kürzen und vor
 * `stripInlineMarkup` (Auszeichnung zuletzt, gleiche Reihenfolge wie im Android-Poller).
 *
 * Ersetzt `feeds.ts bodyWithoutQuote` NICHT: das bleibt der richtige Griff überall dort,
 * wo der volle Text gerendert wird und eine Zitatkarte danebensteht (`parse()`,
 * `firstNostrRef`, `mentionPubkeys`). Siehe Entscheidung 1 im Modulkopf.
 */
export const previewBody = (event: TrustedEvent, resolveName: NameResolver): string =>
    readableRefTokens(event.content.replace(QUOTE_PREFIX, ''), resolveName)

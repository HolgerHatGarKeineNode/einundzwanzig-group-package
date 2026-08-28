/**
 * P7 — die **schreibende** Seite der Artikelfläche, als reine Funktionen.
 *
 * P1 bis P6 waren lesend und damit folgenlos: eine falsche Zahl auf dem Bildschirm ist
 * ein Fehler, den ein Reload heilt. Ab hier entsteht ein signiertes Nostr-Ereignis, und
 * das ist unwiderruflich — kind 5 ist eine Bitte, kein Löschen. Dieses Modul hält
 * deshalb genau die Entscheidungen, die man ohne Netz und ohne Browser festnageln kann:
 * **wem gehört ein Kommentar, habe ICH schon reagiert, und darf dieser Entwurf überhaupt
 * abgeschickt werden.** Alles, was ein Relay anfasst, steht in `longformFeed.ts`.
 *
 * ── Warum eine eigene Datei und nicht `articleMetrics.ts` ───────────────────────────
 *
 * `articleMetrics.ts` beantwortet EINE Frage — „wie viele" — und faltet dafür ~700
 * fremde Ereignisse zu vier Zahlen. Hier geht es um die Gegenrichtung: aus denselben
 * Ereignissen die **einzelnen** herauszuholen, die der Nutzer sieht und anfasst. Beide
 * teilen sich die Zuordnungsregel ({@link artikelVonEreignis}) und nichts sonst; sie in
 * eine Datei zu legen hieße, die Zählung bei jeder Kommentaränderung mit anzufassen.
 *
 * ── `node --test`-Grenze ───────────────────────────────────────────────────────────
 *
 * Kein Import aus `longform.ts` (markdown-it, 48 kB gzip — siehe `bundleGrenze.nodetest.ts`)
 * und keiner aus `feeds.ts`/`session.ts` (nicht ladbar unter node, siehe `articleMetrics.ts`).
 * Was hier steht, läuft mit einem Ereignis-Array und einem Rückgabewert.
 */
import { type TrustedEvent } from '@welshman/util'
import { COMMENT, REACTION } from './welshmanKinds.ts'
import { artikelVonEreignis } from './articleMetrics.ts'

/**
 * Das Emoji, mit dem die Artikelfläche reagiert.
 *
 * **Ein einziges, und das ist eine Entscheidung.** Der Chat hat einen Emoji-Picker, weil
 * dort eine Reaktion ein Gesprächsbeitrag ist („👀", „😂"); an einem Artikel ist sie eine
 * Zustimmung. NIP-25 nennt `"+"` ausdrücklich als die Form dafür, und jeder andere
 * Nostr-Client zeigt sie als Herz oder Daumen. Ein Picker hier brächte einen zweiten
 * MRU-Speicher, die Custom-Emoji-Kette (NIP-30) und eine Panel-Positionierung mit — für
 * eine Fläche, die von den Reaktionen bisher nur die ANZAHL zeigt.
 *
 * Die Zählung dahinter dedupliziert je (Autor, Emoji) — dieselbe Regel wie im Chat, siehe
 * {@link zaehleReaktionen}. Mit nur einem Emoji ist eine zweite Reaktion desselben Autors
 * damit zwangsläufig ein No-op, und genau deshalb gibt es den Toggle unten.
 */
export const ARTIKEL_REAKTION = '+'

/**
 * Obergrenze eines Kommentarentwurfs, in Zeichen.
 *
 * Keine gefundene Zahl, sondern eine gesetzte — und sie steht hier, damit sie EINE Zahl
 * bleibt: die Fläche zeigt den Restzähler, die Prüfung unten sperrt den Knopf, und beide
 * lesen dieselbe Konstante. Der Bestand gibt die Größenordnung vor: die 64 vorhandenen
 * Artikel-Kommentare sind im Median 1 121 Byte ROH (also mit Tags und Signatur),
 * gemessen am 2026-08-21 über Board, nos.lol und damus.
 *
 * Der Grund für eine Grenze überhaupt ist nicht der Relay, sondern die Unwiderruflichkeit:
 * ein versehentlich eingefügter Zwischenspeicher-Inhalt (ein halbes Dokument, ein
 * Schlüssel) ist nach dem Absenden öffentlich. Eine sichtbare Grenze macht aus einem
 * unbemerkten Einfügen einen bemerkten.
 */
export const KOMMENTAR_MAX_ZEICHEN = 5000

/** Ein Kommentar (kind 1111) an einem Artikel, so wie die Fläche ihn braucht. */
export type ArtikelKommentar = {
    id: string
    pubkey: string
    /** Roher Klartext. Wird als **Text** gebunden, nie als HTML — siehe `⚡article.blade.php`. */
    content: string
    createdAt: number
}

/** Die eigene Reaktion auf einen Artikel — `null`, wenn es keine gibt. */
export type EigeneReaktion = { id: string; content: string } | null

/**
 * Die gemeinsame Vorarbeit von {@link artikelKommentare} und {@link eigeneReaktion}:
 * welche der Sekundär-Ereignisse gehören zu **diesem** Artikel?
 *
 * `bekannt` ist bewusst ein Ein-Element-Set und keine Zeichenkette: {@link artikelVonEreignis}
 * ist die einzige Stelle im Haus, die `A`/`a`/`e` in der richtigen Verlässlichkeits-
 * reihenfolge auflöst, und sie zweimal zu haben wäre der Riss, an dem die Vollansicht und
 * die Liste einmal verschiedene Kommentare zeigen.
 */
const gehoertZu = (
    ereignisse: readonly TrustedEvent[],
    adresse: string,
    adresseVonId: Map<string, string>,
    kind: number,
): TrustedEvent[] => {
    const bekannt = new Set([adresse])

    return ereignisse.filter((event) => event.kind === kind && artikelVonEreignis(event, adresseVonId, bekannt) === adresse)
}

/**
 * Die Kommentare eines Artikels, **jüngste zuletzt**.
 *
 * ── Die Reihenfolge ist eine Aussage über die Fläche ────────────────────────────────
 *
 * Chronologisch aufsteigend wie ein Gesprächsverlauf, nicht „neueste zuerst" wie eine
 * Kommentarspalte. Der Grund steht im Entwurf der Vollansicht: der Leser kommt hier unten
 * an, NACHDEM er den Artikel gelesen hat — er liest weiter, statt eine Rangliste zu
 * überfliegen. Bei Gleichstand der Sekunde entscheidet die Event-Id, damit die Liste
 * zwischen zwei Emits nicht springt; `created_at` ist sekundengenau, und zwei Kommentare
 * in derselben Sekunde sind bei einem Relay, das AUTH und NIP-05 verlangt, seltener als
 * bei einem Chat — aber nicht unmöglich.
 *
 * ── Was hier NICHT passiert: verschachteln ─────────────────────────────────────────
 *
 * NIP-22 kennt einen Baum (`A`/`E` = Wurzel, `a`/`e` = direkter Elternteil), und 9 der 64
 * vorhandenen Kommentare hängen tiefer als eine Ebene (gemessen 2026-08-21, sequenziell
 * über dieselben drei Relais: `#A` findet 64, `#a` nur 55 — eine erste Messung nannte
 * hier 57 und damit 7; **woran das lag, ist ungeklärt**. Zwei spätere Läufe mit EINEM
 * Filter über alle 104 Adressen ergaben für `#a` beide Male 55, während `#A` zwischen
 * parallelem und sequenziellem Lauf von 61 auf 64 wanderte — das spricht für
 * Relay-Wankelmut, nicht für die Filterzahl. Die 57 ist mit keiner bekannten Methode
 * reproduzierbar.)
 * **Eine Bestandszahl, keine Zusage** — sie ändert sich mit jedem neuen Kommentar. Diese
 * Liste zeigt sie trotzdem flach. Eine Baumdarstellung braucht
 * eine Antwort-Aktion je Knoten, eine Einrückungsgrenze und einen Umgang mit dem Fall
 * „Elternteil nicht geladen" — drei Entscheidungen für eine Fläche, die bis P6 gar keine
 * Kommentare zeigte. Die flache Liste verliert dabei **nichts**: jeder Kommentar ist da,
 * nur die Verwandtschaft steht nicht daneben.
 */
export const artikelKommentare = ({
    ereignisse,
    adresse,
    adresseVonId,
}: {
    ereignisse: readonly TrustedEvent[]
    adresse: string
    adresseVonId: Map<string, string>
}): ArtikelKommentar[] =>
    gehoertZu(ereignisse, adresse, adresseVonId, COMMENT)
        .map((event) => ({ id: event.id, pubkey: event.pubkey, content: event.content, createdAt: event.created_at }))
        .sort((a, b) => a.createdAt - b.createdAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))

/**
 * Habe **ich** auf diesen Artikel reagiert — und mit welchem Ereignis?
 *
 * Die Id ist der eigentliche Rückgabewert: der Toggle nimmt die Reaktion über ein kind 5
 * auf genau diese Id zurück, und ohne sie bliebe nur „nochmal reagieren", was durch die
 * (Autor, Emoji)-Deduplizierung ein sichtbares No-op wäre.
 *
 * **Die JÜNGSTE gewinnt, nicht die erste.** Wer zweimal reagiert hat (zwei Fassungen im
 * Store, etwa nach einem fehlgeschlagenen Rücknahmeversuch), nimmt sonst eine Reaktion
 * zurück, die der Relay längst nicht mehr führt, und der Knopf bliebe gedrückt.
 *
 * `meinPubkey` leer → `null`. Ein abgemeldeter Leser hat keine eigene Reaktion, und
 * `''` als Autor träfe sonst jedes Ereignis mit leerem Pubkey (das es nicht gibt, aber
 * ein Vergleich, der nur zufällig nichts trifft, ist kein Riegel).
 */
export const eigeneReaktion = ({
    ereignisse,
    adresse,
    adresseVonId,
    meinPubkey,
}: {
    ereignisse: readonly TrustedEvent[]
    adresse: string
    adresseVonId: Map<string, string>
    meinPubkey: string
}): EigeneReaktion => {
    if (!meinPubkey) {
        return null
    }
    const meine = gehoertZu(ereignisse, adresse, adresseVonId, REACTION).filter((event) => event.pubkey === meinPubkey)
    const juengste = meine.reduce<TrustedEvent | null>(
        (best, event) => (!best || event.created_at > best.created_at ? event : best),
        null,
    )

    return juengste ? { id: juengste.id, content: juengste.content } : null
}

/**
 * Darf dieser Kommentarentwurf abgeschickt werden?
 *
 * Drei Gründe, und alle drei sind **benennbar** — das ist der ganze Zweck dieser Funktion.
 * Ein Knopf, der aus unklarem Grund nicht reagiert, wird ein zweites Mal gedrückt; ein
 * `disabled` ohne Text ist auf einem Telefon nicht befragbar. Der Aufrufer bekommt hier
 * den Grund und zeigt ihn an.
 *
 * `''` heißt „darf". Dieselbe Konvention wie bei den Publish-Wegen in `feeds.ts`
 * (`''` = Erfolg, sonst der Text) — eine zweite Konvention für dasselbe Muster wäre die
 * Art Fehler, die man erst im dritten Aufrufer bemerkt.
 */
export const kommentarSperre = ({
    entwurf,
    angemeldet,
    laeuft,
}: {
    entwurf: string
    angemeldet: boolean
    laeuft: boolean
}): 'leer' | 'zu-lang' | 'abgemeldet' | 'laeuft' | '' => {
    if (laeuft) {
        return 'laeuft'
    }
    if (!angemeldet) {
        return 'abgemeldet'
    }
    // **`trim()` und nicht `length`:** ein Entwurf aus Leerzeichen und Zeilenumbrüchen ist
    // leer, wird aber vom Relay klaglos angenommen und steht danach für immer da.
    if (!entwurf.trim()) {
        return 'leer'
    }
    // Gemessen wird der ROHE Entwurf, nicht der getrimmte: die Grenze ist eine Grenze für
    // das, was gesendet wird, und gesendet wird der getrimmte Text — aber wer 5 000
    // Zeichen plus Leerzeilen einfügt, soll die Grenze sehen, bevor er sie unterschreitet.
    if (entwurf.length > KOMMENTAR_MAX_ZEICHEN) {
        return 'zu-lang'
    }

    return ''
}

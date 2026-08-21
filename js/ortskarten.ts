/**
 * Die Ortskarten-Leiste (P5) — **rein**: wann darf eine Live-Zeile die statische
 * Unterzeile ersetzen, und wie lange wartet das Nachladen?
 *
 * Die Leiste führt die drei Hauptflächen des Clients (Chat · Artikel · Forge). Jede Karte
 * trägt eine Unterzeile, und die hat eine ungewöhnliche, aber begründete Regel:
 *
 * **Die Karte rendert SOFORT mit ihrer statischen Unterzeile, und die bleibt stehen,
 * solange es nichts Besseres gibt.** Kein Skeleton, kein Platzhalter, kein Springen.
 *
 * ── Warum das keine Bequemlichkeit ist ───────────────────────────────────────────────
 *
 * Ein Skeleton ist eine Zusage: „hier kommt gleich etwas". Für die Zahlen dieser Leiste
 * ist diese Zusage nicht gedeckt — sie kommen von zwei verschiedenen Relays, eines davon
 * hinter NIP-42, und eine Antwort ist der Normalfall, keine Garantie. Ein Skeleton, das
 * nie zur Zahl wird, ist eine Lüge über den Systemzustand (Nielsen #1). Die statische
 * Zeile ist dagegen immer wahr: „Räume" steht unter Chat, ob eine Zahl kommt oder nicht.
 *
 * Zweitens die Bewegung: die Leiste sitzt ÜBER dem Inhalt. Eine Zeile, die von leer auf
 * Text wechselt, verschiebt alles darunter — und zwar zu einem Zeitpunkt, den der Nutzer
 * nicht wählt. Deshalb hat die Unterzeile von der ersten Pixelzeile an ihre endgültige
 * Höhe, und der Live-Wert wird HINEINgeblendet, nicht darüber gestapelt.
 *
 * Kein Import: das Modul ist rein und ohne welshman/Alpine testbar
 * (`node --experimental-strip-types --test packages/einundzwanzig-group/js/ortskarten.test.ts`).
 */

/**
 * Wie lange nach dem ersten Paint das Nachladen spätestens beginnt (ms).
 *
 * Der Auslöser ist `requestIdleCallback`; diese Zahl ist dessen `timeout`, also die
 * Obergrenze für den Fall, dass der Hauptstrang nie ruhig wird. Sie ist bewusst großzügig:
 * die Leiste ist NAVIGATION, ihre Zahlen sind Beiwerk. Nichts an ihr darf mit dem
 * Erstaufbau der Fläche konkurrieren, auf der sie steht — auf `/spaces` ist das der
 * Raum-Feed, und der ist das, wofür der Nutzer gekommen ist.
 */
export const ORTSKARTEN_NACHLADE_MS = 1_500

/**
 * Drosselung der Live-Zeilen (ms).
 *
 * Die Quellen emittieren nachziehend: jedes eintreffende kind 0 lässt die Artikelliste neu
 * rechnen, jeder Forge-Push den Baum. Ungedrosselt schriebe die Leiste dann Dutzende Male
 * dieselbe Zahl — sichtbar als Flimmern in einer Zeile, die niemand liest.
 *
 * 500 ms und nicht die 300 ms der Feeds: hier zählt keine Reaktionszeit, sondern Ruhe.
 */
export const ORTSKARTEN_DROSSEL_MS = 500

/**
 * Darf der Live-Wert die statische Unterzeile ersetzen?
 *
 * **Genau eine Regel für alle drei Karten, und `0` gehört ausdrücklich NICHT dazu.**
 * `null` heißt „noch nichts geladen", `0` heißt „geladen, nichts zu berichten" — für die
 * Unterzeile ist beides derselbe Fall: es gibt nichts zu sagen, also sagt die Karte, was
 * sie ohnehin schon sagte.
 *
 * „0 Artikel" wäre zudem doppelt unglücklich: es ist von „noch nicht geladen" optisch
 * nicht zu unterscheiden und behauptet zugleich einen leeren Bestand, den die Karte gar
 * nicht feststellen kann (ein Relay, das schweigt, sieht aus wie ein Relay ohne Artikel).
 * Dieselbe Haltung wie beim Ungelesen-Marker des Hauses: `0` bleibt marker-los.
 */
export const zeigeLive = (wert: number | null | undefined): boolean =>
    typeof wert === 'number' && Number.isFinite(wert) && wert > 0

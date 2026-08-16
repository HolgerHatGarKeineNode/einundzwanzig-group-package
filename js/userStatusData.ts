/**
 * NIP-38-Status (kind 30315, `d`=`general`) — die **reine** Hälfte: parsen, verfallen
 * lassen, je Pubkey den Gewinner bestimmen. Kein Netz, kein Store, kein welshman, keine
 * Uhr; alles Zeitliche kommt als Parameter herein. Deshalb läuft
 * `userStatusData.test.ts` unter `node --test` ohne Relay und ohne echte Sekunden. Die
 * unreine Hälfte (Ableitung + Warm-Loader) steht in `userStatus.ts`.
 *
 * ── Vier Entscheidungen, und keine davon folgt aus der Spec allein ──────────────
 *
 * **1. Das `emoji`-Tag ist NICHT NIP-38.** Die Spec kennt für kind 30315 nur `d`, `r`,
 * `p`/`e`/`a` und `expiration`; ein Emoji gehört dort in den `content`. Buzz schreibt
 * es stattdessen als eigenes Tag (`crates/buzz-sdk/src/builders.rs:1720-1728`,
 * `desktop/src/shared/api/relayClientSession.ts:380-393`), und wir lesen es so, weil
 * derselbe Nutzer beide Clients fährt. Der Haken: **`emoji` ist in NIP-30 bereits
 * vergeben** — dort ist es `["emoji", <shortcode>, <url>]`, also ein Verweis auf ein
 * BILD, kein Zeichen. Ein Client, der blind `tag[1]` nimmt, malt bei einem NIP-30-Tag
 * den nackten Shortcode („kekw") an die Stelle, an der ein Emoji stehen sollte.
 * Deshalb wird hier ausschließlich die **zweigliedrige** Buzz-Form akzeptiert; ein
 * Tag mit URL (NIP-30) wird verworfen statt falsch gerendert.
 *
 * **2. `expiration` (NIP-40) wird ausgewertet.** Buzz Desktop tut das nicht: sein
 * `parseUserStatusEvent` liest `content`, `emoji` und `created_at` und sonst nichts
 * (`desktop/src/features/user-status/hooks.ts:24-38`) — ein Status „bin bis 14 Uhr
 * weg" steht dort auch um 22 Uhr noch. Buzz Mobile wertet es dagegen aus
 * (`mobile/lib/features/profile/user_status.dart:52`), die Relay-Seite kennt das Tag
 * ebenfalls. Wir folgen Mobile und der Spec, nicht Desktop.
 *
 * **3. Das Höchstalter ist unsere Erfindung** — es steht in keiner NIP. Grund: ein
 * `general`-Status ohne `expiration` wird von Hand gesetzt und von Hand gelöscht.
 * Passiert Letzteres nie (der Normalfall), behauptet die Zeile auf Dauer etwas über
 * das Jetzt, das aus dem Vorjahr stammt — und weil kind 30315 ersetzbar ist, gibt es
 * keinen zweiten Datenpunkt, der das aufdeckte. {@link MAX_STATUS_AGE_SEC} ist die
 * Grenze, ab der wir „alt" für wahrscheinlicher halten als „immer noch wahr". Der
 * Wert ist bewusst großzügig: die Fehlerrichtung „einen gültigen Status zu früh
 * ausblenden" ist ärgerlicher als „einen alten eine Woche zu lang zeigen".
 *
 * **4. Leer heißt gelöscht, nicht unverändert.** NIP-38: „If the `content` is an empty
 * string then the client should clear the status." Ein leerer `content` OHNE Emoji
 * entfernt den Pubkey deshalb aus der Tabelle — und zwar auch dann, wenn ein ÄLTERES,
 * gefülltes Event noch im Repository liegt. Genau das ist der Fall, den ein „nimm den
 * jüngsten nicht-leeren" still falsch macht.
 *
 * ── NIP-33-Replace statt Ankunftsreihenfolge ───────────────────────────────────
 *
 * Je Pubkey gewinnt das größte `created_at`, bei Gleichstand die lexikografisch
 * kleinste `id` (NIP-01, Regel für ersetzbare Events). **Nicht** das zuletzt
 * eingetroffene: beim Reconnect spielt ein Relay seinen Bestand erneut ein, und die
 * Reihenfolge ist dabei nicht zugesichert — ein Fold über „letzter gewinnt" ließe den
 * Status dann sichtbar zurückspringen.
 */

/** kind 30315 (NIP-38 User Status). */
export const USER_STATUS = 30315

/** Der `d`-Wert des allgemeinen Status. `music` (NIP-38) lesen wir bewusst nicht. */
export const STATUS_D_GENERAL = 'general'

/**
 * Höchstalter eines Status ohne `expiration`: **7 Tage**. Siehe Punkt 3 im Modul-Kopf
 * — der Wert ist eine Setzung, keine Spec-Zahl, und hier ist die einzige Stelle, an
 * der er steht.
 */
export const MAX_STATUS_AGE_SEC = 7 * 24 * 60 * 60

/**
 * Zeichen-Deckel des Textes.
 *
 * Nicht kosmetisch: Buzz erlaubt **64 KB** `content` für kind 30315
 * (`crates/buzz-sdk/src/builders.rs:1722`, `check_content(text, 64 * 1024)`). Ohne
 * Deckel landete ein solcher Text sowohl im DOM jeder Chat-Zeile des Autors als auch
 * — über {@link statusFingerprint} — im Cache-Schlüssel jeder dieser Zeilen. Die
 * Anzeige kürzt zusätzlich per CSS; dieser Deckel ist der, der die Datenmenge begrenzt.
 */
export const STATUS_TEXT_CAP = 140

/**
 * Zeichen-Deckel des Emojis (UTF-16-Einheiten). Ein zusammengesetztes Emoji
 * (Familie mit ZWJ, Flagge mit Modifier) braucht bis zu elf Einheiten; alles darüber
 * ist kein Emoji mehr, sondern jemand, der ein Textfeld zweckentfremdet.
 */
export const STATUS_EMOJI_CAP = 16

/** Ein aufgelöster Status, wie ihn die Oberfläche zeigt. */
export type UserStatus = {
    /** Gekürzt, einzeilig, getrimmt — nie roher `content`. */
    text: string
    /** Genau ein (zusammengesetztes) Zeichen aus dem Buzz-`emoji`-Tag, sonst ''. */
    emoji: string
    /** `created_at` des gewinnenden Events — die Sortierachse des Replace. */
    updatedAt: number
}

/**
 * Das Stück Event, das dieses Modul braucht. Bewusst strukturell statt
 * `TrustedEvent`: so hängt die reine Hälfte an keinem welshman-Paket und der
 * Node-Test baut seine Fälle aus Objektliteralen.
 */
export type StatusEventLike = {
    id?: string
    kind?: number
    pubkey: string
    created_at: number
    content: string
    tags: string[][]
}

/** Ein geparstes Event, bevor Verfall und Replace darüber entschieden haben. */
export type ParsedStatus = UserStatus & {
    pubkey: string
    /** Ereignis-Id (Gleichstands-Entscheid), '' wenn das Event keine mitbringt. */
    id: string
    /** NIP-40-`expiration` in Sekunden, `null` = kein/unlesbares Tag. */
    expiresAt: number | null
}

/** Zeilenumbrüche und Steuerzeichen zu einfachen Leerzeichen — der Status ist einzeilig. */
const singleLine = (value: string): string => value.replace(/\s+/g, ' ').trim()

const firstTag = (tags: string[][], name: string): string[] | undefined =>
    tags.find((tag) => Array.isArray(tag) && tag[0] === name)

/**
 * Das Emoji aus der **zweigliedrigen** Buzz-Form `["emoji", "🚀"]`.
 *
 * Ein drittes Feld bedeutet NIP-30 (`["emoji", shortcode, url]`) — dann ist `tag[1]`
 * ein Shortcode und kein Zeichen; wir geben lieber nichts aus als „kekw". Siehe
 * Punkt 1 im Modul-Kopf.
 */
export const statusEmoji = (tags: string[][]): string => {
    const tag = firstTag(tags, 'emoji')
    if (!tag || tag.length !== 2 || typeof tag[1] !== 'string') {
        return ''
    }
    const emoji = singleLine(tag[1])
    return emoji.length > STATUS_EMOJI_CAP ? '' : emoji
}

/**
 * NIP-40-`expiration` als Sekunden-Zeitstempel. `null` bei fehlendem, nicht
 * numerischem oder nicht-endlichem Wert — ein kaputtes Tag darf einen Status weder
 * sofort verfallen lassen noch unsterblich machen.
 */
export const statusExpiresAt = (tags: string[][]): number | null => {
    const raw = firstTag(tags, 'expiration')?.[1]
    if (typeof raw !== 'string' || raw.trim() === '') {
        return null
    }
    const parsed = Number(raw)
    return Number.isFinite(parsed) ? Math.floor(parsed) : null
}

/**
 * Ein Event → {@link ParsedStatus}, oder `null`, wenn es gar kein allgemeiner Status
 * ist. Kind und `d`-Tag werden geprüft, obwohl der Filter beides schon einschränkt:
 * ein Relay, das auf einen `#d`-Filter etwas anderes zurückgibt, darf nicht als
 * Status eines fremden Pubkeys durchrutschen (gleiche Disziplin wie
 * `readStateSync.ts:281-284`).
 */
export const parseStatusEvent = (event: StatusEventLike): ParsedStatus | null => {
    if (!event || typeof event.pubkey !== 'string' || event.pubkey === '') {
        return null
    }
    if (event.kind !== undefined && event.kind !== USER_STATUS) {
        return null
    }
    const tags = Array.isArray(event.tags) ? event.tags : []
    if (firstTag(tags, 'd')?.[1] !== STATUS_D_GENERAL) {
        return null
    }
    return {
        pubkey: event.pubkey,
        id: typeof event.id === 'string' ? event.id : '',
        text: singleLine(typeof event.content === 'string' ? event.content : '').slice(0, STATUS_TEXT_CAP),
        emoji: statusEmoji(tags),
        updatedAt: typeof event.created_at === 'number' ? event.created_at : 0,
        expiresAt: statusExpiresAt(tags),
    }
}

/** Ersetzt `next` das bisherige `best`? NIP-01: größeres `created_at`, sonst kleinere Id. */
const replaces = (next: ParsedStatus, best: ParsedStatus): boolean =>
    next.updatedAt > best.updatedAt || (next.updatedAt === best.updatedAt && next.id < best.id)

/**
 * Ist dieser Status jetzt noch zu zeigen? Drei Gründe dagegen — und alle drei greifen
 * erst NACH dem Replace, nicht davor: ein abgelaufener oder leerer Gewinner löscht die
 * Anzeige, statt einen älteren Stand wieder hervorzuholen.
 */
export const isStatusVisible = (status: ParsedStatus, now: number, maxAgeSec = MAX_STATUS_AGE_SEC): boolean => {
    if (status.text === '' && status.emoji === '') {
        return false // NIP-38: leerer content ⇒ Status gelöscht
    }
    if (status.expiresAt !== null && status.expiresAt <= now) {
        return false // NIP-40
    }
    return now - status.updatedAt <= maxAgeSec
}

/**
 * Die Statustabelle eines Relays: je Pubkey **ein** Status, `created_at`-maximal,
 * abgelaufene und gelöschte fehlen ganz.
 *
 * `now` und `maxAgeSec` kommen von außen — der Aufrufer besitzt die Uhr, dieses Modul
 * nicht. Reihenfolge der Eingabe ist bedeutungslos (siehe Modul-Kopf).
 */
export const foldUserStatuses = (
    events: readonly StatusEventLike[],
    now: number,
    maxAgeSec = MAX_STATUS_AGE_SEC,
): Map<string, UserStatus> => {
    const winners = new Map<string, ParsedStatus>()
    for (const event of events) {
        const parsed = parseStatusEvent(event)
        if (!parsed) {
            continue
        }
        const best = winners.get(parsed.pubkey)
        if (!best || replaces(parsed, best)) {
            winners.set(parsed.pubkey, parsed)
        }
    }

    const out = new Map<string, UserStatus>()
    for (const [pubkey, status] of winners) {
        if (isStatusVisible(status, now, maxAgeSec)) {
            out.set(pubkey, { text: status.text, emoji: status.emoji, updatedAt: status.updatedAt })
        }
    }
    return out
}

/**
 * Fingerabdruck eines Status für Memoisierungs-Schlüssel — **der Grund, warum dieses
 * Modul überhaupt einen String ausgibt und nicht nur ein Objekt.**
 *
 * Die Chat-Zeile ist je Event-Id gemerkt (`feeds.ts memoedToChatMessage`), und der
 * Schlüssel vergleicht Profil-Werte per REFERENZ. Für den Status geht das nicht:
 * {@link foldUserStatuses} baut die Tabelle bei jedem Emit neu, jedes Objekt darin ist
 * frisch — ein Referenzvergleich meldete bei jedem Tastendruck eines Fremden
 * „geändert" und machte die Memoisierung wertlos. Ein Wertvergleich über diesen String
 * meldet genau dann eine Änderung, wenn eine sichtbar ist.
 *
 * `updatedAt` allein reicht nicht: zwei Fassungen mit gleichem `created_at` (Buzz'
 * Sekundenauflösung, zwei Publishes in derselben Sekunde) unterschieden sich sonst
 * nicht. Deshalb stehen Text und Emoji mit im Abdruck — bezahlbar, weil
 * {@link STATUS_TEXT_CAP} die Länge deckelt.
 */
export const statusFingerprint = (status: UserStatus | undefined): string =>
    status ? `${status.updatedAt}:${status.emoji}:${status.text}` : '-'

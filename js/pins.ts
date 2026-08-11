/**
 * Angepinnte Nachrichten — die reine Logik (P6b).
 *
 * Bewusst **ohne** welshman-Importe, damit alles hier unter `node --test` ohne Browser,
 * ohne Relay und ohne Mocks läuft. Die Netz- und Store-Seite liegt in `roomPins.ts`.
 * Gleiche Aufteilung wie `relayCaps.ts`/`buzzAdmin.ts` und `search.ts`/`roomSearch.ts`.
 *
 * ── Zwei Relays, zwei völlig verschiedene Mechanismen ───────────────────────────────
 *
 * Das ist keine Weiche im Detail, sondern eine **Matrix**: Pin ist auf zooid ein
 * ZUSTAND, auf Buzz eine LISTE. Wer das mit einem Reader und einem `if` erschlagen
 * will, baut auf genau einem der beiden Relays stilles Fehlverhalten.
 *
 * |                  | zooid                                   | Buzz                          |
 * |------------------|-----------------------------------------|-------------------------------|
 * | Setzen           | `kind 9010` (`h` + n × `e`)             | `kind 40004` (`h` + 1 × `e`)  |
 * | Ergebnis         | **relay-signiertes** `kind 39005`       | das 40004 selbst              |
 * | Form             | EIN adressierbares Event je Raum        | n reguläre Events, wachsend   |
 * | Ersetzen         | jedes 9010 ersetzt die GANZE Liste      | gibt es nicht                 |
 * | Lösen            | 9010 mit den VERBLEIBENDEN `e`          | `kind 5` bzw. `kind 9005`     |
 * | Wer darf setzen  | nur `can_manage` (Relay-Admin)          | jedes Kanal-Mitglied          |
 *
 * Alles darin ist am laufenden Relay gemessen, nicht aus Spezifikationen abgeleitet;
 * die Roh-Frames stehen in
 * `docs/plans/2026-08-09T1513-ux-und-nostr-standardfunktionen/p6-messung-pin.md`
 * (Host-Repo). **Gemessen wurde gegen LOKALE Instanzen** — der Prod-zooid ist wegen
 * `policy.public_read = false` nicht messbar und könnte 9010 anders behandeln.
 *
 * ── Der Preis: dieser Pin ist NICHT portabel ────────────────────────────────────────
 *
 * **NIP-29 kennt kein Pin-Kind.** Weder `9010`/`39005` (zooid) noch `40004` (Buzz)
 * stehen in irgendeinem NIP; beide sind Erweiterungen ihres jeweiligen Relays. Ein
 * fremder NIP-29-Client sieht unsere Pins **nicht**, und Pins eines fremden Clients
 * sähen wir nur, wenn er zufällig dieselbe Erweiterung spricht. Zwischen zooid und
 * Buzz ist der Pin ebenfalls nicht übertragbar: wer einen Raum umzieht, verliert ihn.
 *
 * Das ist die **zweite bewusste Sonderlocke** nach {@link BUZZ_MESSAGE_V2} (`relayCaps.ts`)
 * und eine Entscheidung des Plans, keine Nachlässigkeit. Der Preis steht hier, weil er
 * hier bezahlt wird: wer diese Datei anfasst, um „Pins auch für X" zu bauen, muss
 * wissen, dass es keinen gemeinsamen Nenner gibt, den man nur noch verkabeln müsste.
 */

/** zooid: Pin-Kommando eines Admins. Erzeugt relay-seitig das {@link ZOOID_PIN_LIST}. */
export const ZOOID_PUT_PINS = 9010

/**
 * zooid: die relay-signierte Pin-Liste (adressierbar, `d` = Raum-`h`).
 *
 * **Kollidiert im Kind mit Buzz' `KIND_THREAD_SUMMARY`** — siehe {@link isZooidPinList}.
 */
export const ZOOID_PIN_LIST = 39005

/** Buzz: ein einzelner Pin (`buzz-core/src/kind.rs:472`, `KIND_STREAM_MESSAGE_PINNED`). */
export const BUZZ_PIN = 40004

/**
 * NIP-09-Löschung. Auf Buzz der Weg, den **eigenen** Pin zu lösen
 * (`side_effects.rs:225` → `must be event author`).
 */
export const NIP09_DELETION = 5

/**
 * NIP-29-Löschung durch einen Admin. Auf Buzz der Weg, einen **fremden** Pin zu lösen
 * (`side_effects.rs:713` → `must be event author or channel owner/admin`).
 */
export const NIP29_DELETE_EVENT = 9005

/** So viel wie hier vom Ereignis gebraucht wird — bewusst kein welshman-Typ. */
export type PinEventLike = {
    id: string
    kind: number
    pubkey: string
    created_at: number
    tags: string[][]
    content: string
}

const tagValues = (name: string, tags: string[][]): string[] =>
    tags.filter((t) => t[0] === name && typeof t[1] === 'string' && t[1] !== '').map((t) => t[1])

const hasTag = (name: string, tags: string[][]): boolean => tags.some((t) => t[0] === name)

/**
 * Ist dieses `kind 39005` **wirklich** die zooid-Pin-Liste — und nicht Buzz'
 * Thread-Zusammenfassung?
 *
 * **Die Kollision ist real und gemessen.** Beide Relays benutzen 39005, beide signieren
 * relay-seitig, beide sind adressierbar. Gemessen wurde zweierlei, und die zwei
 * Ergebnisse ziehen zwei verschiedene Konsequenzen nach sich:
 *
 *  1. **Überschreiben können sie sich nicht.** Die Adresse eines adressierbaren Events
 *     ist `kind:pubkey:d`, und die Relay-Pubkeys unterscheiden sich
 *     (`39005:da99fbe3…:pinraum` gegen `39005:301eb324…:8a266b33…`). Ein Repository mit
 *     beiden Ereignissen hält nach zwei `publish()` auch zwei Einträge — nachgemessen
 *     gegen das installierte `@welshman/net`.
 *  2. **Der FILTER trifft beide.** `matchFilters([{kinds:[39005]}], …)` ist für beide
 *     `true`. Deshalb liest `roomPins.ts` ausschließlich über `deriveEventsForUrl`
 *     (`repository.ts:20`), also gebunden an die Herkunfts-URL aus dem `tracker`.
 *
 * Diese Funktion ist die **zweite, unabhängige** Absicherung — Gürtel neben Hosenträger.
 * Sie kostet nichts und schützt gegen den Fall, dass irgendwann jemand einen Filter ohne
 * Relay-Bindung schreibt. Drei gemessene Strukturmerkmale, jedes für sich ausreichend:
 *
 * | Merkmal      | zooid-Pin       | Buzz-Summary              |
 * |--------------|-----------------|---------------------------|
 * | `["-"]`      | **ja** (NIP-70) | nein                      |
 * | `["h"]`      | nein            | **ja** (Kanal-UUID)       |
 * | `content`    | leer            | JSON `{reply_count, …}`   |
 *
 * `relaySelf` (aus NIP-11, Feld `self`) ist optional: liegt das Info-Doc noch nicht vor,
 * tragen die Strukturmerkmale die Entscheidung allein. **Nicht** auf das `d`-Tag prüfen —
 * das ist das schwächste Merkmal (Buzz benutzt eine 64-stellige Event-Id, zooid einen
 * freien Raum-Slug; ein Raum DARF bei zooid wie eine Event-Id heißen).
 */
export const isZooidPinList = (event: PinEventLike, relaySelf?: string): boolean => {
    if (event.kind !== ZOOID_PIN_LIST) {
        return false
    }
    if (!hasTag('-', event.tags) || hasTag('h', event.tags) || event.content !== '') {
        return false
    }
    return !relaySelf || event.pubkey === relaySelf
}

/**
 * Die angepinnten Ereignis-Ids aus einer zooid-Pin-Liste, in der Reihenfolge des Relays.
 *
 * `d` muss zum Raum passen: eine Instanz kann Pin-Listen mehrerer Räume im Speicher
 * halten, und der Filter `{kinds:[39005],'#d':[h]}` ist nur die eine Hälfte — die
 * andere ist diese Prüfung.
 */
export const pinnedIdsFromList = (event: PinEventLike, h: string): string[] => {
    if (tagValues('d', event.tags)[0] !== h) {
        return []
    }
    return unique(tagValues('e', event.tags))
}

/** Ein Buzz-Pin: das Pin-Ereignis selbst plus sein Ziel. Beides wird zum Lösen gebraucht. */
export type BuzzPinEntry = {
    /** Id der angepinnten Nachricht (`e`-Tag). */
    targetId: string
    /** Id des `40004` — das ist beim Lösen das ZIEL, nicht `targetId`. */
    pinEventId: string
    /** Wer gepinnt hat. Entscheidet, ob `kind 5` reicht oder `kind 9005` nötig ist. */
    pinnedBy: string
    created_at: number
}

/**
 * Buzz' Pin-Liste aus den rohen `40004` — **dedupliziert**, älteste zuerst.
 *
 * **Warum Dedup keine Kosmetik ist:** `40004` liegt bei 40000+, ist also regulär und
 * unveränderlich; jedes Pinnen ist ein neuer Datensatz. Am Testrelay lagen nach zwei
 * Sitzungen zwei `40004` auf **derselben** Zielnachricht (`948f7e8e…` und `6a83a80f…`,
 * beide `e=59a823ab…`). Ohne Dedup stünde dieselbe Nachricht zweimal in der Pin-Leiste.
 *
 * Behalten wird je Ziel der **jüngste** Pin: er ist der, den ein Lösen entfernen muss,
 * und sein Autor ist der, dessen Rechte dafür zählen. Die verbleibenden älteren
 * Duplikate bleiben am Relay liegen — sie sind unsichtbar, solange der jüngste steht,
 * und tauchen wieder auf, wenn er gelöst wird. Das ist eine bekannte Grenze des
 * Buzz-Mechanismus, keine Nachlässigkeit hier: siehe {@link olderDuplicatePinIds}.
 */
export const buzzPinEntries = (events: PinEventLike[]): BuzzPinEntry[] => {
    const newestByTarget = new Map<string, BuzzPinEntry>()
    for (const event of events) {
        if (event.kind !== BUZZ_PIN) {
            continue
        }
        const targetId = tagValues('e', event.tags)[0]
        if (!targetId) {
            continue
        }
        const previous = newestByTarget.get(targetId)
        if (previous && previous.created_at >= event.created_at) {
            continue
        }
        newestByTarget.set(targetId, {
            targetId,
            pinEventId: event.id,
            pinnedBy: event.pubkey,
            created_at: event.created_at,
        })
    }
    return Array.from(newestByTarget.values()).sort((a, b) => a.created_at - b.created_at)
}

/**
 * Die **verdeckten** älteren `40004` auf dasselbe Ziel.
 *
 * Wer einen Buzz-Pin löst, muss sie mitlösen — sonst verschwindet die Nachricht aus der
 * Leiste und ist beim nächsten Laden wieder da, weil ein älteres Duplikat nachrückt. Für
 * den Nutzer sähe das aus, als hätte das Lösen nicht funktioniert.
 */
export const olderDuplicatePinIds = (events: PinEventLike[], targetId: string, keepPinEventId: string): string[] =>
    events
        .filter((e) => e.kind === BUZZ_PIN && tagValues('e', e.tags)[0] === targetId && e.id !== keepPinEventId)
        .map((e) => e.id)

/**
 * Tags für ein `kind 9010` — die **vollständige** neue Pin-Liste eines Raums.
 *
 * **Es gibt kein „einen Pin hinzufügen".** Ein zweites 9010 ersetzt die Liste
 * vollständig (gemessen: nach einem 9010 mit einem `e` standen die beiden vorherigen
 * `e` nicht mehr in der 39005). Anpinnen heißt also „bisherige Liste + neues Ziel",
 * Lösen heißt „bisherige Liste ohne dieses Ziel", und ein 9010 ganz ohne `e` leert sie.
 *
 * `keepTags` trägt Tags der bestehenden Liste, die erhalten bleiben müssen —
 * **konkret die `a`-Tags**. zooid kopiert `e` UND `a` aus dem 9010 in die 39005
 * (`zooid/groups.go:86-94`, gemessen: ein `a` auf einen 30023-Artikel überlebte, ein
 * `p` nicht). Wer die Liste nur aus `e` neu aufbaut, **löscht** damit stillschweigend
 * jeden gepinnten Artikel. Für P6b werden `a`-Pins nicht erzeugt — durchgereicht werden
 * sie trotzdem, weil ein anderer Client sie gesetzt haben kann.
 */
export const putPinsTags = (h: string, eventIds: string[], keepTags: string[][] = []): string[][] => [
    ['h', h],
    ...unique(eventIds).map((id) => ['e', id]),
    ...keepTags.filter((t) => t[0] === 'a'),
]

/** Die `a`-Tags einer bestehenden Pin-Liste (Eingabe für `keepTags` oben). */
export const foreignPinTags = (event: PinEventLike | null | undefined): string[][] =>
    (event?.tags ?? []).filter((t) => t[0] === 'a')

/**
 * Was muss gesendet werden, um einen **Buzz**-Pin zu lösen?
 *
 * Beide Wege sind gemessen; sie unterscheiden sich nur in den Rechten:
 *  - **`kind 5`** (NIP-09) — nur der **Autor** des `40004`. Kein `h` nötig.
 *  - **`kind 9005`** (NIP-29) — Autor **oder** Kanal-Owner/Admin. `h` ist Pflicht
 *    (`side_effects.rs:1662`).
 *
 * Der eigene Pin geht bewusst über `kind 5`: das ist der engste Weg, er braucht keine
 * Admin-Rolle. Erst für fremde Pins wird der Admin-Weg nötig.
 *
 * **Das `h`-Tag steht auch am `kind 5`, obwohl NIP-09 es nicht verlangt** — und das ist
 * kein Zierrat, sondern der Unterschied zwischen „wirkt" und „wirkt sichtbar". Gemessen:
 *
 *  - Ein `kind 5` **ohne** `h` wird angenommen und löscht den Pin. Aber die Live-Sub des
 *    Raums filtert Löschungen über `{kinds:[DELETE], '#h':[h]}` (`feeds.ts listenRoom`) —
 *    ein `h`-loses `kind 5` erreicht die anderen Clients also **nie**. Deren Pin-Leiste
 *    zeigte den Pin bis zum nächsten Kaltstart weiter.
 *  - Ein `kind 5` **mit** `h` wird ebenso angenommen (`OK true`) und kommt auf genau
 *    dieser Subscription an. Nachgemessen mit offener `{kinds:[5],'#h':[h],limit:0}`-Sub:
 *    das Lösch-Ereignis traf ein, und die anschliessende `40004`-Abfrage war leer.
 *
 * **Genau EIN Ziel je Lösch-Event** — Buzz lehnt mehr hart ab
 * (`ingest.rs:2331-2342`: `deletion events must reference exactly one target via e or a
 * tag`). Deshalb liefert diese Funktion eine LISTE von Kommandos, keins mit n `e`-Tags.
 */
export type DeleteCommand = { kind: number; tags: string[][] }

export const buzzUnpinCommands = (
    h: string,
    pinEventIds: string[],
    ownPubkey: string,
    pinAuthorByEventId: Map<string, string>,
): DeleteCommand[] =>
    unique(pinEventIds).map((pinEventId) => {
        const mine = pinAuthorByEventId.get(pinEventId) === ownPubkey
        return mine
            ? { kind: NIP09_DELETION, tags: [['h', h], ['e', pinEventId], ['k', String(BUZZ_PIN)]] }
            : { kind: NIP29_DELETE_EVENT, tags: [['h', h], ['e', pinEventId]] }
    })

/**
 * Meldet der Relay hier in Wahrheit „ist bereits weg"?
 *
 * **Gemessen:** ein zweites `9005` auf ein bereits gelöschtes Ziel wird mit
 * `invalid: target event not found` **abgelehnt** — obwohl der gewünschte Zustand
 * längst erreicht ist. Das passiert im Alltag ständig: doppelter Tipp, zwei offene
 * Geräte, ein Duplikat-Aufräumen (siehe {@link olderDuplicatePinIds}), das ein bereits
 * gelöschtes Ereignis mitnimmt.
 *
 * Ein Fehler-Toast wäre an dieser Stelle **falsch** und würde den Nutzer obendrein zum
 * Wiederholen einladen — was denselben Fehler erneut erzeugt. Das Ziel ist weg, das ist
 * genau das, was er wollte.
 */
export const isAlreadyGoneError = (error: string): boolean => /target event not found/i.test(error)

/**
 * Ist die gewünschte Wirkung eingetreten?
 *
 * **`OK true` ist kein Erfolgsnachweis** — das ist der teuerste einzelne Befund der
 * Vormessung, und er hat zwei verschiedene Ursachen, die beide still sind:
 *
 *  1. **zooid übernimmt `created_at` aus dem 9010** (`zooid/groups.go:99`) und
 *     `ReplaceEvent` verwirft ein Event mit KLEINEREM `created_at` ohne Fehler
 *     (`zooid/events.go:440-443`, Rückgabe `deleted, nil`). Eine nachgehende Uhr macht
 *     Pins damit wirkungslos, während der Relay `OK true` meldet.
 *  2. **Der Rückgabewert von `UpdatePins` wird verworfen** (`zooid/instance.go:440-442`).
 *     Selbst ein echter Fehler erreichte den Client nicht.
 *
 * Der Client misst deshalb an der **Wirkung**: Enthält die Pin-Liste das Ziel (bzw.
 * enthält sie es nicht mehr)? Diese Funktion ist die Frage in einer Zeile.
 *
 * **Was der Client dagegen NICHT tut: `created_at` selbst setzen.** Der Plan riet dazu;
 * die Messung sagt etwas anderes. Gegen eine schiefe Systemuhr hilft das nicht — der
 * Browser hat keine bessere Zeitquelle als dieselbe Uhr, und ein selbst gesetzter Wert
 * kann die Lage sogar verschlimmern. Der Default des Signers (`makeEvent` → `now()`) ist
 * das Beste, was verfügbar ist. Der **Gleichstand** ist dabei unkritisch: zooid weicht
 * bewusst vom NIP-01-Tie-Break ab und lässt das zuletzt verarbeitete Ereignis gewinnen
 * (`<=`, `events.go:440`) — zwei Pins in derselben Sekunde funktionieren, gemessen.
 * Scharf ist ausschließlich der Rücksprung.
 */
export const pinStateReached = (pinnedIds: string[], targetId: string, shouldBePinned: boolean): boolean =>
    pinnedIds.includes(targetId) === shouldBePinned

/**
 * Darf dieser Nutzer im aktuellen Raum pinnen?
 *
 * **Die Asymmetrie ist gemessen und asymmetrisch bleibt sie auch in der Oberfläche:**
 *  - **zooid** vergibt das Recht ausschließlich über die Config-Rolle `can_manage`
 *    (`zooid/groups.go:346` → `restricted: you are not authorized to manage groups`).
 *  - **Buzz** nimmt ein `40004` von **jedem Kanal-Mitglied** an (gemessen: `OK true`
 *    für `role=member` ohne jede Admin-Rolle).
 *
 * `isSpaceAdmin` ist auf beiden Relays das richtige Signal — aber es bedeutet nicht
 * dasselbe, und genau deshalb steht die Weiche hier und nicht im Markup: auf zooid ist
 * es der NIP-86-Probe-Aufruf (und der ist relay-seitig durch **exakt** `CanManage`
 * gegatet, `zooid/management.go:670`), auf Buzz die Rolle `owner`/`admin` aus der 13534 —
 * die für das Pinnen gerade **nicht** nötig ist.
 */
export const mayPin = (isBuzz: boolean, isSpaceAdmin: boolean, isRoomMember: boolean): boolean =>
    isBuzz ? isRoomMember : isSpaceAdmin

/**
 * Darf dieser Nutzer DIESEN Pin lösen?
 *
 * Auf zooid dieselbe Rolle wie beim Setzen (die Liste ist ein einziges Admin-Kommando).
 * Auf Buzz zusätzlich der **Autor** des Pins, auch ohne Admin-Rolle — der gemessene
 * `kind 5`-Weg. Ein Mitglied, das einen fremden Pin lösen will, bekäme sonst
 * `invalid: must be event author`, und der Knopf hätte nichts getan.
 */
export const mayUnpin = (
    isBuzz: boolean,
    isSpaceAdmin: boolean,
    isRoomMember: boolean,
    pinnedBy: string,
    ownPubkey: string,
): boolean => {
    if (!isBuzz) {
        return isSpaceAdmin
    }
    return isRoomMember && (pinnedBy === ownPubkey || isSpaceAdmin)
}

const unique = <T>(items: T[]): T[] => Array.from(new Set(items))

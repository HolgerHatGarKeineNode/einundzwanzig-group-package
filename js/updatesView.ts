/**
 * Screen-Logik von `/updates` (P4) — und der Rückweg, den ein Deep-Link erzeugt.
 *
 * Dinge, die nichts miteinander zu tun haben, aber dieselbe Eigenschaft teilen: sie sind
 * **rein**. Filter, Buckets, Paginierung, die `?from=`-Whitelist und die Ladeentscheidung
 * ({@link firstNonEmpty}) rechnen ausschließlich aus ihren Argumenten — kein Store, kein
 * `window`, kein `Date.now()`.
 * Deshalb liegen sie hier und nicht in `bridge.ts`: dort wären sie nur über einen
 * Browser prüfbar, hier laufen sie unter `node --test` (`updatesView.test.ts`).
 *
 * Die Zeilen selbst kommen fertig gerechnet aus `updates.ts` ({@link UpdateItem}) —
 * dieses Modul ordnet, kappt und beschriftet sie, es rechnet keine einzige neu.
 *
 * Der relative Import trägt absichtlich seine `.ts`-Endung (Begründung siehe
 * `unread.ts`): ohne sie liefe `node --test updatesView.test.ts` in ERR_MODULE_NOT_FOUND.
 */
import type { UpdateBucket, UpdateItem } from './updates.ts'

// ── Filter (die drei Tabs) ─────────────────────────────────────────────────

/** Die drei Tabs aus `⚡updates.blade.php`. `all` ist der Default. */
export type UpdateFeed = 'all' | 'mentions' | 'threads'

/**
 * Tab → Zeilen. `message`-Zeilen erscheinen **nur** unter „Alle": weder eine Erwähnung
 * noch eine Thread-Antwort, und ein vierter Tab „Räume" wäre die Liste selbst.
 */
export const filterUpdates = (items: readonly UpdateItem[], feed: UpdateFeed): UpdateItem[] => {
    if (feed === 'mentions') {
        return items.filter((item) => item.type === 'mention')
    }
    if (feed === 'threads') {
        return items.filter((item) => item.type === 'thread')
    }
    return [...items]
}

// ── Paginierung (§3.6) ────────────────────────────────────────────────────

/** Startgröße UND Schrittweite von „Ältere anzeigen" (§3.6). */
export const UPDATES_PAGE = 30

/** Der sichtbare Ausschnitt: gefiltert, dann gekappt. Gruppiert wird NUR daraus. */
export const visibleUpdates = (items: readonly UpdateItem[], feed: UpdateFeed, limit: number): UpdateItem[] =>
    filterUpdates(items, feed).slice(0, Math.max(0, limit))

/**
 * Steht der „Ältere anzeigen"-Knopf? Gemessen wird an der **gefilterten** Menge — unter
 * „Erwähnungen" darf der Knopf nicht stehen, weil es irgendwo noch Nachrichten gibt.
 */
export const hasMoreUpdates = (items: readonly UpdateItem[], feed: UpdateFeed, limit: number): boolean =>
    filterUpdates(items, feed).length > Math.max(0, limit)

/** Nächste Seite. Absichtlich eine Funktion: die Schrittweite hat genau eine Quelle. */
export const nextUpdatesLimit = (limit: number): number => Math.max(0, limit) + UPDATES_PAGE

// ── Gruppierung (§3.4) ────────────────────────────────────────────────────

export type UpdateGroup = { label: string; items: UpdateItem[] }

/** Reihenfolge der Divider. Identisch zur Sortierung in `computeUpdates`. */
export const BUCKET_SEQUENCE: readonly UpdateBucket[] = ['today', 'yesterday', 'week', 'older']

/**
 * Deutsche Divider-Beschriftung — **normal geschrieben**. Die Versalien macht
 * ausschließlich das Markup (`uppercase` am `<h2>`), optisch ändert das nichts.
 *
 * Grund: der Text im DOM ist der, den die Sprachausgabe bekommt, und
 * Versalien-Wörter werden uneinheitlich behandelt (als Wort oder buchstabenweise
 * vorgelesen). Die Nachbarebene derselben Zeile macht es schon richtig — `item.context`
 * ist normal geschrieben und wird per CSS versalisiert.
 */
export const BUCKET_LABELS: Record<UpdateBucket, string> = {
    today: 'Heute',
    yesterday: 'Gestern',
    week: 'Diese Woche',
    older: 'Älter',
}

/**
 * Zeilen → Bucket-Gruppen in fester Reihenfolge, **leere Buckets fallen raus**.
 *
 * Bewusst über {@link BUCKET_SEQUENCE} iteriert statt über die Eingabe: die Reihenfolge
 * der Divider hängt dann nicht daran, dass die Liste sortiert ankommt. Sie kommt sortiert
 * an (`computeUpdates`), aber eine Gruppierung, die bei unsortierter Eingabe „HEUTE"
 * zweimal ausgäbe, wäre eine Falle für den nächsten Aufrufer — `x-for :key="group.label"`
 * bräche daran sichtbar.
 */
export function groupUpdates(items: readonly UpdateItem[]): UpdateGroup[] {
    const out: UpdateGroup[] = []
    for (const bucket of BUCKET_SEQUENCE) {
        const inBucket = items.filter((item) => item.bucket === bucket)
        if (inBucket.length > 0) {
            out.push({ label: BUCKET_LABELS[bucket], items: inBucket })
        }
    }
    return out
}

// ── Beschriftungen ────────────────────────────────────────────────────────

/**
 * Kopfzeilen-Untertitel. Gezählt werden die **gerade gerenderten Zeilen** — die
 * Aufrufstelle reicht dafür den sichtbaren Ausschnitt ({@link visibleUpdates}) herein,
 * nicht die Gesamtmenge.
 *
 * **Warum ausdrücklich KEINE Ungelesen-Zahl** (das wäre die naheliegende Lesart von
 * §3.1 „12 ungelesene Hinweise"): eine Zahl mit dem Etikett „ungelesen"/„neu" ist eine
 * Behauptung über das Wasserzeichen, und die ist bis P6 gesperrt — die Gate-Bedingung
 * „Badge sagt N, im Raum stehen N" ist ungeprüft. Dass die Zahl hier im Untertitel
 * statt in einem Badge stünde, ändert an der Behauptung nichts; es wäre nur die
 * Hintertür in dieselbe Sperre. Eine Zahl **gerenderter Zeilen** behauptet dagegen
 * nichts, was der Nutzer nicht unmittelbar darunter nachzählen kann.
 *
 * `Alles gelesen` bleibt als Nullzustand — aber **nur ohne aktiven Filter**: unter
 * „Erwähnungen" hieße eine leere Ansicht nicht, dass alles gelesen wäre. Genau dieser
 * Widerspruch stand gemessen im Kopf („Alles gelesen" neben dem sichtbaren Knopf „Alles
 * als gelesen markieren", weil es ungelesene `message`-Zeilen gab). Im Filter-Nullfall
 * sagt der Untertitel deshalb GAR NICHTS — die Erklärung trägt der Leerzustand darunter,
 * der den Filter benennt und den Ausweg anbietet.
 *
 * @param filtered Ist gerade ein anderer Tab als „Alle" aktiv? (`isFiltered()`)
 */
export function updatesSubtitle(items: readonly UpdateItem[], filtered = false): string {
    if (items.length === 0) {
        return filtered ? '' : 'Alles gelesen'
    }
    return items.length === 1 ? '1 Hinweis' : `${items.length} Hinweise`
}

/**
 * Der Ungelesen-Hinweis für Screenreader — **vorangestellt**, nicht angehängt.
 *
 * Am Ende eines Labels (gemessen: 343 und 739 Zeichen) hört ihn niemand, der nach dem
 * Snippet unterbricht — und das ist normale Bedienpraxis. Dieses Label ist zugleich der
 * EINZIGE Zugang zu „ungelesen": die 2-px-Rail ist `aria-hidden`, die Typ-Icons sind
 * textlos, und ein `sr-only`-Geschwister wäre unter einem `aria-label` totes Markup.
 * Der Zustand muss deshalb im ersten Wort stehen.
 *
 * Nicht der Bestandstext `', ungelesene Nachrichten'` aus `unread-dot.blade.php`:
 * vorangestellt liest der sich nicht.
 */
export const UNREAD_SR_PREFIX = 'Ungelesen. '

/** Snippet-Länge IM LABEL. Der volle Text steht in der Zeile, nicht im Namen des Knopfes. */
export const LABEL_SNIPPET_MAX = 120

const shortenForLabel = (snippet: string): string =>
    snippet.length <= LABEL_SNIPPET_MAX ? snippet : `${snippet.slice(0, LABEL_SNIPPET_MAX).trimEnd()}…`

/**
 * Barrierefreier Name der Zeile. Er ERSETZT den kompletten Kindtext (`aria-label` am
 * `<button>`) und trägt deshalb alle vier sichtbaren Ebenen — den Snippet allerdings
 * gekürzt ({@link LABEL_SNIPPET_MAX}): ein Name ist eine Kennung, kein Vorlesetext, und
 * hörend bekommt man ihn am Stück statt ihn zu überfliegen.
 */
export const updateAriaLabel = (item: UpdateItem): string => {
    const text = [item.context, item.title, shortenForLabel(item.snippet), item.timeLabel]
        .filter((part) => part !== '')
        .join('. ')
    return item.unread ? UNREAD_SR_PREFIX + text : text
}

// ── Ladeentscheidung: auf die Raumliste warten ────────────────────────────

/**
 * Minimalvertrag eines Svelte-Stores. Absichtlich strukturell statt `Readable<T>` aus
 * `svelte/store`: so bleibt dieses Modul frei von Laufzeit-Abhängigkeiten und unter
 * `node --test` mit einem handgeschriebenen Fake prüfbar.
 */
export type Subscribable<T> = { subscribe(run: (value: T) => void): () => void }

/** Wie lange {@link firstNonEmpty} höchstens auf die Mitgliedschaften wartet. */
export const ROOM_LIST_WAIT_MS = 10_000

/**
 * Wartet auf den ersten NICHT-leeren Wert einer Liste — und gibt nach `timeoutMs` auf.
 *
 * Ohne dieses Warten setzt der Nachhol-Load beim kalten Direkteinstieg (Reload,
 * Bookmark, geteilter Link) **keine einzige Abfrage** ab: die Mitgliedschaften (39002)
 * sind im ersten Emit des Space noch nicht da, `hs` ist `[]`, und `loadRoomActivity`
 * liefert ohne REQ ein leeres Array zurück. `loading`/`error` würden dann aus einem
 * Lauf entschieden, der nie stattgefunden hat.
 *
 * Der Timeout ist kein Schönheitsfehler, sondern der Fall „dieser Nutzer ist in keinem
 * Raum": dort bleibt die Liste dauerhaft leer und das Warten müsste sonst ewig laufen.
 * Aufgegeben wird mit dem zuletzt gesehenen Wert — das ist dann ehrlich leer, nicht
 * fälschlich leer.
 *
 * Der `settled`-Riegel trägt den Synchron-Fall: ein Svelte-Store ruft `run` bereits
 * WÄHREND `subscribe()`, die Unsubscribe-Funktion existiert zu dem Zeitpunkt also noch
 * nicht. Ohne den Riegel liefe der Abbau ins Leere und die Subscription bliebe offen.
 */
export function firstNonEmpty<T>(store: Subscribable<readonly T[]>, timeoutMs = ROOM_LIST_WAIT_MS): Promise<readonly T[]> {
    return new Promise((resolve) => {
        let settled = false
        let last: readonly T[] = []
        let unsubscribe: (() => void) | null = null
        let timer: ReturnType<typeof setTimeout> | null = null

        const finish = (value: readonly T[]): void => {
            if (settled) {
                return
            }
            settled = true
            if (timer) {
                clearTimeout(timer)
            }
            unsubscribe?.()
            resolve(value)
        }

        unsubscribe = store.subscribe((value) => {
            last = value ?? []
            if (last.length > 0) {
                finish(last)
            }
        })
        if (settled) {
            unsubscribe() // synchron aufgelöst — die Subscription ist erst JETZT abbaubar
            return
        }
        timer = setTimeout(() => finish(last), timeoutMs)
    })
}

// ── „Alles gelesen" und sein Rückgängig (§8) ──────────────────────────────

/**
 * Gibt es überhaupt etwas zu quittieren? Gemessen an der GESAMTMENGE, nicht an der
 * gefilterten Ansicht: „Alles gelesen" wirkt global (`all`-Wasserzeichen), nicht auf
 * den gerade sichtbaren Tab.
 *
 * Der Knopf hängt hieran und **nicht** an `hasAny()`: gelesene Zeilen bleiben 24 h
 * stehen ({@link UPDATES_RETENTION_SEC} in `updates.ts`), die Liste ist nach dem
 * Quittieren also nicht leer. Ein Knopf, der dann weiter dasteht, verspricht eine
 * Handlung, die nichts tut — und widerspricht dem Untertitel, der daneben bereits
 * „Alles gelesen" sagt.
 */
export const hasUnreadUpdates = (items: readonly UpdateItem[]): boolean => items.some((item) => item.unread)

/**
 * Die Autoren der Zeilen — die pubkeys, deren kind-0 gewärmt werden muss, damit die
 * zweite Zeilenebene (§3.2 ②) einen NAMEN trägt statt eines npub.
 *
 * `computeUpdates` baut den Fallback korrekt (`displayProfile(…, displayPubkey(…))`),
 * aber niemand lädt die Profile: `loadSpaceThreads` wärmt nur die Kommentar- und
 * Wurzel-Autoren, und `message` — die häufigste Zeile — kommt über den Raum-Filter, der
 * keine Profile mitbringt.
 *
 * Entdoppelt und in stabiler Reihenfolge (erstes Auftreten): `warmProfiles` entdoppelt
 * zwar selbst über sein `seeded`-Set, aber eine Liste mit 40 Wiederholungen desselben
 * pubkey zu übergeben verschleiert, was hier eigentlich gemeint ist.
 */
export function updateAuthors(items: readonly UpdateItem[]): string[] {
    const out: string[] = []
    const seen = new Set<string>()
    for (const item of items) {
        if (item.pubkey !== '' && !seen.has(item.pubkey)) {
            seen.add(item.pubkey)
            out.push(item.pubkey)
        }
    }
    return out
}

/**
 * Welche Momentaufnahme gilt, wenn „Alles gelesen" ein ZWEITES Mal geklickt wird,
 * während die Undo-Frist noch läuft?
 *
 * Die bereits gepufferte — niemals die frische. Der zweite Klick fände einen Zustand
 * vor, in dem das erste Markieren schon passiert ist; ihn zu puffern hieße, als
 * „vorher" genau das zu sichern, was rückgängig gemacht werden soll. Das Ergebnis wäre
 * ein Rückgängig, das reagiert und nichts tut (gemessen: es bliebe `{all: …}` übrig,
 * alle Raum- und Thread-Wasserzeichen dauerhaft weg) — die Form, die §8 ausdrücklich
 * verbietet.
 *
 * Generisch statt auf `ReadState` getippt, damit dieses Modul rein bleibt und nichts
 * aus `readState.ts` zieht.
 */
export const undoSnapshotFor = <T>(buffered: T | null, fresh: T): T => buffered ?? fresh

/**
 * Läuft die Undo-Frist JETZT noch? Die Zeitquelle kommt von außen (Muster:
 * `computeUpdates` bekommt sein `now` als Argument) — nur so ist die Frist ohne Browser
 * prüfbar.
 *
 * Warum nicht `undoUntil > 0` genügt: der `setTimeout` ist die einzige Instanz, die den
 * Wert zurücksetzt, und Browser **strecken** Timer in gedrosselten Hintergrund-Tabs
 * erheblich. Die Leiste stünde dort länger als die zugesagten 10 s und bliebe klickbar.
 * Beides zusammen trägt: der Timer lässt die Leiste von selbst verschwinden, dieser
 * Vergleich lässt einen späten KLICK nicht mehr durch.
 *
 * `undoUntil === 0` (kein Puffer) fällt automatisch durch — 0 ist nie größer als `now`.
 */
export const undoStillOpen = (undoUntil: number, now: number): boolean => undoUntil > now

/**
 * Was ein Klick auf „Rückgängig" JETZT auslöst:
 *   `restore` — Frist läuft, Puffer da → Karte zurückspielen.
 *   `discard` — Frist abgelaufen (oder kein Puffer) → nichts zurückspielen, aber den
 *               Zustand aufräumen, damit keine Zombie-Leiste stehen bleibt.
 *
 * Warum der Klick eine EIGENE Prüfung braucht und `canUndo()` nicht genügt: `canUndo()`
 * hängt nur an `x-show`, und Alpine wertet einen Ausdruck erst neu aus, wenn sich eine
 * REAKTIVE Abhängigkeit ändert — `Date.now()` ist keine. Im Zielszenario (gedrosselter
 * Hintergrund-Tab, gestreckter Timer) ändert sich `_undoUntil` gerade nicht: die Leiste
 * bleibt sichtbar UND klickbar. Ohne diesen Riegel dehnt sich die zugesagte
 * 10-Sekunden-Grenze auf ein beliebig langes Fenster — und mit ihr die dokumentierte
 * Nebenwirkung, dass ein Geschwister-Tab sein Wasserzeichen aus DIESEN zehn Sekunden
 * verliert (siehe `restoreReadState`).
 */
export const undoClickAction = (undoUntil: number, now: number, hasSnapshot: boolean): 'restore' | 'discard' =>
    hasSnapshot && undoStillOpen(undoUntil, now) ? 'restore' : 'discard'

// ── Rückweg: der Herkunfts-Parameter `?from=` (§6.2) ──────────────────────

/**
 * Die Whitelist. Alles außerhalb ist Müll und wird verworfen — der Parameter kommt aus
 * der Adressleiste, ist also fremde Eingabe: `?from=javascript:alert(1)`,
 * `?from=//evil.tld` oder `?from=https://phish.example` dürfen weder ein
 * Navigationsziel werden noch weitergereicht.
 */
export const ORIGIN_KEYS = ['updates', 'spaces', 'room'] as const
export type OriginKey = (typeof ORIGIN_KEYS)[number]

/** Default-UP-Ziel, wenn keine gültige Herkunft dasteht. */
export const ORIGIN_FALLBACK = '/spaces'

/**
 * Gültige Herkunft aus einem Query-String, sonst `null`.
 *
 * Bei doppeltem Parameter (`?from=spaces&from=updates`) gewinnt der ERSTE — das ist die
 * Zusage von `URLSearchParams.get`, und eine eigene Regel wäre eine zweite Wahrheit über
 * dieselbe URL.
 */
export function readOrigin(search: string): OriginKey | null {
    const value = new URLSearchParams(search).get('from')
    return value !== null && (ORIGIN_KEYS as readonly string[]).includes(value) ? (value as OriginKey) : null
}

/**
 * UP-Ziel aus der Herkunft (§6.2/§6.4).
 *
 * `updates` ist der einzige Wert mit eigenem Ziel. `spaces` fällt bewusst auf denselben
 * Weg wie der Default (es IST der Default), und `room` hat **kein** Ziel: der Parameter
 * trägt nur den Screen-TYP, keine `h` — welcher Raum gemeint war, steht nirgends. Ein
 * Raum kann auch nicht sein eigenes UP-Ziel sein, das wäre eine Schleife. `room` bleibt
 * trotzdem in der Whitelist, weil {@link withOrigin} ihn DURCHREICHEN muss statt ihn als
 * Müll zu verwerfen — sonst verlöre ein Thread-Wechsel eine gültige Herkunft.
 *
 * @param fallback UP-Ziel ohne gültige Herkunft. Die Aufrufstelle (`⚡room.blade.php`)
 *   reicht dafür `route('group.spaces')` durch — damit bleibt das Ziel dort, wo die
 *   Routen definiert sind, statt als zweites Literal im JS zu leben.
 */
export function originTarget(search: string, fallback: string = ORIGIN_FALLBACK): string {
    return readOrigin(search) === 'updates' ? '/updates' : fallback
}

/**
 * Hängt eine gültige Herkunft an ein Ziel an (§6.2: „`threadHref()` muss `?from=`
 * durchreichen, sonst verliert der warme Thread-Wechsel die Herkunft").
 *
 * Kein `encodeURIComponent` nötig und keins gewollt: `key` stammt aus
 * {@link ORIGIN_KEYS}, ist also nie etwas anderes als eines von drei Wörtern. Ein bereits
 * vorhandenes `from=` bleibt unangetastet — zwei Herkünfte an einer URL wären eine.
 */
export function withOrigin(href: string, search: string): string {
    const key = readOrigin(search)
    if (key === null || /[?&]from=/.test(href)) {
        return href
    }
    return `${href}${href.includes('?') ? '&' : '?'}from=${key}`
}

/**
 * Adressleisten-Ziel beim Schließen des Threads (`backFromThread`).
 *
 * `prevUrl` ist die vor dem Öffnen gemerkte Raum-URL — sie trägt die Herkunft bereits,
 * weil sie beim warmen Öffnen aus `window.location` stammt. Sie ist aber **nur** dann
 * gesetzt, wenn der Thread aus dem Raum heraus geöffnet wurde; beim DEEP-GEMOUNTETEN
 * Thread (`openThread(…, syncUrl=false)`, die URL stand schon) bleibt sie `null`.
 *
 * Genau in diesem Fall muss die Herkunft aus der aktuellen Query gerettet werden. Ein
 * blankes `/rooms/{h}` schnitte sie weg — und der nächste Zurück-Druck wertete
 * {@link originTarget} gegen ein leeres `search` aus und landete auf `/spaces` statt auf
 * „Neu". Das trifft ausgerechnet den Fall, für den `?from=` überhaupt existiert: den
 * frischen Tab ohne History (geteilter Link, Notification-Tap), in dem `backFromRoom`
 * nicht auf `history.back()` ausweichen kann.
 */
export const threadBackTarget = (prevUrl: string | null, roomHref: string, search: string): string =>
    prevUrl ?? withOrigin(roomHref, search)

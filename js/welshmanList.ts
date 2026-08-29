/**
 * Adapter: NIP-51-Listen und NIP-29-Raum-Metadaten.
 *
 * ── Warum das hier steht und nicht bei `@welshman/domain` ────────────────────────
 * Beide Bereiche haben in 0.9.5 ein Gegenstück, aber mit **anderem Zuschnitt**, nicht
 * mit anderem Namen:
 *
 * - **Listen:** aus `readList(event)` wird ein `ListReader` — und der ist ein
 *   `AsyncEventReader`, sein `parse()` gibt ein `Promise` zurück (er entschlüsselt die
 *   privaten Tags selbst). `js/groups.ts:92` liest Listen aber in einem synchronen
 *   `eventToItem` einer abgeleiteten Sammlung. Aus `addToListPublicly(list, tag)` wird
 *   `ListWriter.addPublic(tag)`, aus dem `Encryptable`/`reconcile`-Paar wird
 *   `renderContent()`.
 * - **Räume:** aus `readRoomMeta(event)` wird ein `RoomMetaReader` mit Methoden statt
 *   Feldern (`meta.name` → `reader.name()`), aus `makeRoomEditEvent(room)` ein
 *   `RoomMetaWriter` mit `renderTemplate(): Promise<EventTemplate>`.
 *
 * **Stand nach P5, Etappe 2 — die Datei fällt NICHT weg, anders als geplant.** Der Plan
 * sah vor, sie mit dem `Rooms`-Umbau abzuräumen. Nachgezählt sind 10 ihrer 12 Exporte
 * weiter in Gebrauch: `makeRoomEditEvent` an 15 Stellen, die Listen-Hälfte
 * (`readList`/`makeList`/`addToListPublicly`/`removeFromListByPredicate`/
 * `asDecryptedEvent`) an je zwei. `app.use(Rooms)` ersetzt das LESEN der Raum-Metadaten,
 * nicht das Schreiben und nicht die NIP-51-Listen.
 *
 * Erledigt ist die Lese-Hälfte der Räume: `readRoomMeta` wird nirgends mehr als Funktion
 * aufgerufen — `js/groups.ts roomsByUrl` liest jetzt `RoomMetaReader` aus dem Plugin.
 * Der Export bleibt trotzdem, weil der `Room`-Typ als `ReturnType<typeof readRoomMeta>`
 * daran hängt und damit erzwingt, dass beide Formen dieselben Felder tragen.
 *
 * Offen und ausdrücklich nicht in dieser Etappe: `makeRoomEditEvent` → `RoomMetaWriter`
 * (dessen `renderTemplate()` ist `Promise`-wertig, das berührt jede Schreibstelle) und
 * die Listen-Hälfte (`ListReader` ist ein `AsyncEventReader`, `js/groups.ts` liest Listen
 * aber in einem synchronen `eventToItem`). Zwei tote Exporte fielen dabei auf und sind
 * gemeldet, nicht entfernt: `DecryptedEvent` und `removeFromList` haben null Nutzer.
 *
 * Bis dahin stehen hier die 0.8.16-Rümpfe, Zeile für Zeile aus `@welshman/util@0.8.16`
 * übernommen (`dist/util/src/List.js`, `Room.js`, `Encryptable.js`), damit das Verhalten
 * sich beim Sprung nicht ändert.
 *
 * **Diese Datei importiert ausschliesslich `@welshman/util` und `@welshman/lib`.**
 */
import { nthEq, parseJson, spec, uniqBy } from '@welshman/lib'
import {
    Address,
    ROOM_META,
    ROOM_EDIT_META,
    getIdentifier,
    isRelayUrl,
    makeEvent,
    matchTag,
    tagSpec,
    tagValue,
    type EventTemplate,
    type StampedEvent,
    type TrustedEvent,
} from '@welshman/util'

// ── NIP-51-Listen ────────────────────────────────────────────────────────────────

/** Ein Ereignis mit (optional) entschlüsseltem Zweitinhalt. */
export type DecryptedEvent = TrustedEvent & { plaintext: { content?: string; tags?: string[][] } }

export type List = { kind: number; publicTags: string[][]; privateTags: string[][]; event?: TrustedEvent }
export type PublishedList = List & { event: TrustedEvent }

export const asDecryptedEvent = (
    event: TrustedEvent,
    plaintext: { content?: string; tags?: string[][] } = {},
): DecryptedEvent => ({ ...event, plaintext })

export const makeList = (list: Partial<List> & { kind: number }): List => ({
    publicTags: [],
    privateTags: [],
    ...list,
})

/**
 * Tag-Plausibilität beim Lesen einer Liste — verhindert, dass ein kaputter Eintrag
 * (halber Pubkey, unbrauchbare Relay-URL) als gültiger Listeneintrag durchgeht.
 */
const isValidTag = (tag: string[]): boolean => {
    if (tag[0] === 'p' || tag[0] === 'e') {
        return tag[1]?.length === 64
    }
    if (tag[0] === 'a') {
        return Address.isAddress(tag[1] || '')
    }
    if (tag[0] === 't') {
        return (tag[1]?.length ?? 0) > 0
    }
    if (tag[0] === 'r' || tag[0] === 'relay') {
        return isRelayUrl(tag[1] ?? '')
    }

    return true
}

export const readList = (event: DecryptedEvent): PublishedList => {
    const filtern = (tags: unknown): string[][] => (Array.isArray(tags) ? (tags as string[][]).filter(isValidTag) : [])

    return {
        event,
        kind: event.kind,
        publicTags: filtern(event.tags),
        privateTags: filtern(parseJson(event.plaintext?.content ?? '') || []),
    }
}

/**
 * Ein Ereignis-Entwurf mit noch zu verschlüsselnden Anteilen. `reconcile(encrypt)`
 * verschlüsselt sie und liefert das fertige Template — die Verschlüsselung bleibt beim
 * Aufrufer, also im Browser, beim Signer des Nutzers.
 */
export class Encryptable {
    readonly event: Partial<EventTemplate> & { kind: number }
    readonly updates: { content?: string; tags?: string[][] }

    constructor(event: Partial<EventTemplate> & { kind: number }, updates: { content?: string; tags?: string[][] }) {
        this.event = event
        this.updates = updates
    }

    async reconcile(encrypt: (payload: string) => Promise<string>): Promise<StampedEvent> {
        const content = this.updates.content ? await encrypt(this.updates.content) : undefined
        const tags = this.updates.tags
            ? await Promise.all(
                  this.updates.tags.map(async (tag) => {
                      const kopie = [...tag]
                      kopie[1] = await encrypt(kopie[1] as string)

                      return kopie
                  }),
              )
            : undefined

        return makeEvent(this.event.kind, {
            content: content ?? this.event.content ?? '',
            tags: tags ?? this.event.tags ?? [],
        })
    }
}

/** Tags ohne Dubletten, verglichen über Schlüssel + Wert. 0.8.16: `uniqTags`. */
const uniqTags = (tags: string[][]): string[][] => uniqBy((t) => t.slice(0, 2).join(':'), tags)

export const addToListPublicly = (list: List, ...tags: string[][]): Encryptable =>
    new Encryptable(
        { kind: list.kind, content: list.event?.content || '', tags: uniqTags([...list.publicTags, ...tags]) },
        {},
    )

export const removeFromListByPredicate = (list: List, pred: (tag: string[]) => boolean): Encryptable => {
    const updates: { content?: string } = {}
    // Eine überflüssige Signer-Anfrage vermeiden: nur neu verschlüsseln, wenn das
    // Prädikat wirklich einen privaten Tag trifft.
    if (list.privateTags.some((t) => pred(t))) {
        updates.content = JSON.stringify(list.privateTags.filter((t) => !pred(t)))
    }

    return new Encryptable(
        { kind: list.kind, content: list.event?.content || '', tags: list.publicTags.filter((t) => !pred(t)) },
        updates,
    )
}

export const removeFromList = (list: List, value: string): Encryptable =>
    removeFromListByPredicate(list, nthEq(1, value))

// ── NIP-29-Raum-Metadaten (kind 39000 lesen, kind 9002 bauen) ────────────────────

export type RoomMeta = {
    h: string
    event: TrustedEvent
    name?: string
    about?: string
    picture?: string
    pictureMeta?: string[]
    isClosed: boolean
    isHidden: boolean
    isPrivate: boolean
    isRestricted: boolean
    livekit: boolean
}

export const readRoomMeta = (event: TrustedEvent): RoomMeta => {
    if (event.kind !== ROOM_META) {
        throw new Error('Invalid group meta event')
    }
    const h = getIdentifier(event)
    if (!h) {
        throw new Error('Group meta event had no d tag')
    }

    const bildTag = matchTag(tagSpec('picture'), event.tags)

    return {
        h,
        event,
        name: tagValue(tagSpec('name'), event.tags),
        about: tagValue(tagSpec('about'), event.tags),
        picture: tagValue(tagSpec('picture'), event.tags),
        pictureMeta: bildTag?.slice(2),
        isClosed: event.tags.some(spec(['closed'])),
        isHidden: event.tags.some(spec(['hidden'])),
        isPrivate: event.tags.some(spec(['private'])),
        isRestricted: event.tags.some(spec(['restricted'])),
        livekit: event.tags.some(spec(['livekit'])),
    }
}

/**
 * Das kind-9002-Bearbeitungsereignis.
 *
 * **Der Übertrag der Alt-Tags am Ende ist keine Kür, sondern nötig:** zooid ersetzt das
 * 39000 KOMPLETT aus den 9002-Tags. Was hier fehlt, ist danach weg. Die fünf Flags
 * werden dabei ausdrücklich NICHT übernommen — sie stehen oben schon oder sollen
 * gelöscht werden, und ein Übertrag machte das Abschalten unmöglich.
 */
export const makeRoomEditEvent = (room: Partial<RoomMeta> & { h: string }): StampedEvent => {
    const tags: string[][] = [['h', room.h]]
    if (room.name) {
        tags.push(['name', room.name])
    }
    if (room.about) {
        tags.push(['about', room.about])
    }
    if (room.picture) {
        tags.push(['picture', room.picture, ...(room.pictureMeta ?? [])])
    }
    for (const [flag, an] of [
        ['closed', room.isClosed],
        ['hidden', room.isHidden],
        ['private', room.isPrivate],
        ['restricted', room.isRestricted],
        ['livekit', room.livekit],
    ] as const) {
        if (an) {
            tags.push([flag])
        }
    }
    if (room.event) {
        for (const t of room.event.tags) {
            if (tags.some(spec(t.slice(0, 1)))) {
                continue
            }
            if (['closed', 'hidden', 'private', 'restricted', 'livekit'].includes(t[0] as string)) {
                continue
            }
            tags.push(t)
        }
    }

    return makeEvent(ROOM_EDIT_META, { tags })
}

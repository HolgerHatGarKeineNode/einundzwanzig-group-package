/**
 * Meetup-Praesentation — REIN & welshman-frei (wie `relayCaps.ts`), damit die
 * Logik ohne Browser-/Store-Runtime testbar bleibt (`meetupPresentation.test.ts`).
 *
 * Modell (Plan E1/E2):
 * - Ein Meetup-Raum ist ein NIP-29-39000 mit dem Marker `["t","meetup"]`, dem
 *   stabilen Bindungs-Tag `["i","meetup:<id>"]` und `["meetup_slug","<slug>"]`.
 *   `name` + `picture` (=Logo) sind nativ im Event.
 * - Alles Uebrige (Laenderflagge, Portal-Deep-Link, naechster Termin) ist NICHT
 *   im Event gebunden, sondern wird zur Render-Zeit aus der oeffentlichen
 *   Portal-Meetup-Liste per SLUG gejoint (Portal = Source of Truth, null Drift).
 *
 * Verifiziert 2026-07-19: `portalLink` ist zu 100 % aus `country`+`slug`
 * ableitbar (304/304 Treffer gegen /api/meetups?withIntro&withLogos) -> ein
 * einziger Fetch von /api/mobile/meetups genuegt fuer den kompletten Join.
 */

/** Die oeffentliche Portal-Meetup-Liste (CORS offen: access-control-allow-origin: *). */
export const MEETUP_API_URL = 'https://portal.einundzwanzig.space/api/mobile/meetups'

/** Marker/Bindungs-Tags, aus `room.event.tags` gehoben. */
export type MeetupTags = {
    /** Traegt das 39000 den `["t","meetup"]`-Marker? */
    isMeetup: boolean
    /** Stabile Meetup-id aus `["i","meetup:<id>"]` ('' wenn keins). */
    meetupId: string
    /** Slug aus `["meetup_slug","<slug>"]` — der Join-Schluessel ('' wenn keins). */
    meetupSlug: string
}

/** Ein Record der oeffentlichen /api/mobile/meetups. */
export type MeetupApiRecord = {
    name: string
    slug: string
    city?: string | null
    country?: string | null
    logo?: string | null
    next_event_start?: string | null
}

/** Fertige Praesentationsdaten je Meetup-Slug (der Render-Join). */
export type MeetupPresentation = {
    slug: string
    /** ISO-3166-1-alpha-2, GROSS ('' wenn unbekannt). */
    country: string
    /** Emoji-Flagge aus `country` ('' wenn nicht ableitbar). */
    flag: string
    /** Portal-Deep-Link `…/<country>/meetup/<slug>`. */
    portalLink: string
    city: string
    name: string
    /** Naechster Termin (ISO-String der Portal-API) oder ''. */
    nextEventStart: string
}

const MEETUP_MARKER = 'meetup'
const MEETUP_ID_PREFIX = 'meetup:'

/**
 * Hebt die Meetup-Felder aus den ROH-Tags eines 39000 (`room.event.tags`).
 * welshmans `readRoomMeta` liest diese Custom-Tags NICHT — daher hier selbst.
 */
export const parseMeetupTags = (tags: string[][]): MeetupTags => {
    let isMeetup = false
    let meetupId = ''
    let meetupSlug = ''
    for (const tag of tags) {
        if (tag[0] === 't' && tag[1] === MEETUP_MARKER) {
            isMeetup = true
        } else if (tag[0] === 'i' && typeof tag[1] === 'string' && tag[1].startsWith(MEETUP_ID_PREFIX)) {
            meetupId = tag[1].slice(MEETUP_ID_PREFIX.length)
        } else if (tag[0] === 'meetup_slug' && typeof tag[1] === 'string') {
            meetupSlug = tag[1]
        }
    }
    return { isMeetup, meetupId, meetupSlug }
}

/**
 * ISO-3166-1-alpha-2 → Emoji-Flagge (zwei Regional-Indicator-Codepoints).
 * Rein clientseitig, kein Netz. Nur zwei A–Z-Buchstaben ergeben eine Flagge;
 * alles andere (leer, ungueltig, „UK" statt „GB") → ''.
 */
export const flagEmoji = (country: string): string => {
    const cc = (country || '').trim().toUpperCase()
    if (!/^[A-Z]{2}$/.test(cc)) {
        return ''
    }
    const base = 0x1f1e6 // Regional Indicator Symbol Letter A
    return String.fromCodePoint(base + (cc.charCodeAt(0) - 65), base + (cc.charCodeAt(1) - 65))
}

/**
 * Baut den Portal-Deep-Link aus `country`+`slug` (verifiziert 100 % deckungs-
 * gleich mit dem `portalLink` der reichen API). '' wenn country/slug fehlen.
 */
export const portalLink = (country: string, slug: string): string => {
    const cc = (country || '').trim().toLowerCase()
    if (!cc || !slug) {
        return ''
    }
    return `https://portal.einundzwanzig.space/${cc}/meetup/${slug}`
}

/** Ein API-Record → fertige Praesentation (Flagge + Deep-Link abgeleitet). */
export const buildPresentation = (rec: MeetupApiRecord): MeetupPresentation => {
    const country = (rec.country || '').trim().toUpperCase()
    return {
        slug: rec.slug,
        country,
        flag: flagEmoji(country),
        portalLink: portalLink(country, rec.slug),
        city: rec.city || '',
        name: rec.name,
        nextEventStart: rec.next_event_start || '',
    }
}

/** Die ganze API-Liste → Map slug → Praesentation (der Join-Index). */
export const buildPresentationMap = (records: MeetupApiRecord[]): Map<string, MeetupPresentation> => {
    const map = new Map<string, MeetupPresentation>()
    for (const rec of records) {
        if (rec && rec.slug) {
            map.set(rec.slug, buildPresentation(rec))
        }
    }
    return map
}

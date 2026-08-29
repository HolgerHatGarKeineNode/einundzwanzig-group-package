/**
 * Adapter: Profil-Helfer (kind 0, NIP-01/NIP-05).
 *
 * ── Was 0.9.5 hier weggenommen hat ───────────────────────────────────────────────
 * Genau **ein** Name überlebt den Sprung unverändert: `displayPubkey` (von
 * `@welshman/util` nach `@welshman/domain`). Er ist unten eine reine Weiterleitung.
 *
 * Alles andere ist dort kein Funktionspaar mehr, sondern ein **Reader/Writer-Paar**:
 * `Profile` ist eine `KindFactory<ProfileReader, ProfileWriter>`, und aus
 * `displayProfile(profile, fallback)` wird `reader.display(fallback)`, aus
 * `profile.name` wird `reader.name()`, aus `createProfile`/`editProfile` werden
 * `ProfileWriter.update(...)`/`.setName(...)`.
 *
 * ── Warum hier trotzdem ein DATENTYP steht und kein Reader ───────────────────────
 * Weil unser Profilbild aus **zwei Quellen zusammengesetzt** wird. `js/profileMerge.ts`
 * führt das native Nostr-Profil und das space-lokale zu EINEM Anzeigeobjekt zusammen
 * (`mergeProfileForDisplay`), und `js/spaceProfiles.ts` hält eine eigene Map davon. Ein
 * `ProfileReader` ist an genau ein Ereignis gebunden — er kann ein Merge-Ergebnis gar
 * nicht darstellen. Für diesen Fall hat 0.9.5 kein Gegenstück, also bleibt der Datentyp.
 *
 * Er ist damit **unser** Typ, nicht mehr welshmans: das rohe kind-0-Wertebild plus das
 * Ereignis, aus dem es stammt. {@link ausReader} baut ihn aus dem, was
 * `app.use(Profiles)` liefert.
 *
 * ── Die eine Verhaltensdifferenz, die dabei sichtbar wurde ───────────────────────
 * **`ProfileReader.display()` ist NICHT `displayProfile()`.** Gemessen an den Rümpfen
 * (0.8.16 `util/src/Profile.js:39-48` gegen 0.9.5 `domain/src/kinds/Profile.js:52-57`):
 * - 0.8.16 fällt bei fehlendem `name` auf **`display_name`** zurück, 0.9.5 nicht mehr.
 * - 0.8.16 nimmt den übergebenen `fallback`, wenn gar kein Ereignis da ist; in 0.9.5
 *   steht `displayPubkey(...)` **vor** dem Fallback, der Parameter ist praktisch tot.
 *
 * Welcher Name in der Oberfläche steht, ist eine Produktentscheidung und kein
 * Framework-Detail — deshalb behält {@link displayProfile} die 0.8.16-Regel. Wer sie
 * ändern will, ändert sie hier und sieht dabei, was er tut.
 *
 * **Diese Datei importiert `@welshman/domain` und `@welshman/util`** — kein
 * `@welshman/app`; `js/polls.ts` und `js/articleMetrics.ts` halten diese Reinheit
 * ausdrücklich fest.
 */
import { ellipsize, parseJson } from '@welshman/lib'
import { PROFILE, type EventTemplate, type TrustedEvent } from '@welshman/util'
import { displayPubkey, parseLnUrl, type ProfileReader } from '@welshman/domain'

export { displayPubkey } from '@welshman/domain'

/**
 * Das kind-0-Wertebild als Datenobjekt — siehe Modulkopf. `lnurl` ist abgeleitet
 * (`lud06`/`lud16` → bech32), `event` fehlt bei einem noch nicht publizierten Profil.
 */
export type Profile = {
    name?: string
    display_name?: string
    about?: string
    picture?: string
    banner?: string
    website?: string
    nip05?: string
    lud06?: string
    lud16?: string
    lnurl?: string
    event?: TrustedEvent
    [key: string]: unknown
}

/** Ein Profil mit Ereignis — also eines, das wirklich publiziert wurde. */
export type PublishedProfile = Profile & { event: TrustedEvent }

export const isPublishedProfile = (profile: Profile): profile is PublishedProfile => Boolean(profile.event)

/** Leitet `lnurl` aus `lud06`/`lud16` ab. Die Ableitung selbst kommt aus `domain`. */
export const makeProfile = (profile: Profile = {}): Profile => {
    const lnurl = parseLnUrl(profile)

    return lnurl ? { ...profile, lnurl } : profile
}

/** kind-0-Ereignis → Datenobjekt. */
export const readProfile = (event: TrustedEvent): Profile => ({
    ...makeProfile((parseJson(event.content) as Profile) || {}),
    event,
})

/**
 * Das, was `app.use(Profiles)` liefert, in unser Wertebild überführen.
 *
 * `reader.values` ist das geparste kind-0-JSON (`domain/src/kinds/Profile.js:23-30`),
 * also genau der Inhalt, den `readProfile` aus dem Ereignis holt — nur ohne den zweiten
 * `JSON.parse`. Der Weg über `values` und nicht über die Methoden ist Absicht: er trägt
 * auch die Felder, für die der Reader keinen Getter hat (`display_name`, `lud06`,
 * `lud16` und alles Projekteigene).
 */
export const ausReader = (reader: ProfileReader | undefined): Profile | undefined =>
    reader ? { ...makeProfile(reader.values as Profile), event: reader.event } : undefined

/** Neues kind-0 aus einem Datenobjekt (ohne `event`/`lnurl`, beide sind abgeleitet). */
export const createProfile = ({ event, lnurl, ...profile }: Profile): EventTemplate => ({
    kind: PROFILE,
    content: JSON.stringify(profile),
    tags: [],
})

/** Ersetzendes kind-0: übernimmt die Tags des bisherigen Ereignisses. */
export const editProfile = ({ event, lnurl, ...profile }: PublishedProfile): EventTemplate => ({
    kind: PROFILE,
    content: JSON.stringify(profile),
    tags: event.tags,
})

/**
 * Anzeigename. **Die 0.8.16-Regel, bewusst behalten** — Begründung im Modulkopf:
 * `name`, sonst `display_name`, sonst der gekürzte npub, sonst der Fallback.
 */
export const displayProfile = (profile: Profile | undefined, fallback = ''): string => {
    const { display_name, name, event } = profile || {}
    if (name) {
        return ellipsize(name, 60).trim()
    }
    if (display_name) {
        return ellipsize(display_name, 60).trim()
    }
    if (event) {
        return displayPubkey(event.pubkey).trim()
    }

    return fallback.trim()
}

export const profileHasName = (profile: Profile | undefined): boolean =>
    Boolean(profile?.name || profile?.display_name)

/**
 * Eine ganze Reader-Sammlung in unser Wertebild überführen.
 *
 * Für die Stellen, die den Index von `app.use(Profiles)` als `Map<string, Profile>`
 * weiterreichen (`js/spaceProfiles.ts`, `js/updates.ts`). Der Aufwand ist linear in der
 * Zahl der Profile und fällt nur an, wenn der Index sich ändert — die Aufrufstelle in
 * `spaceProfiles.ts` ist ohnehin auf 200 ms gedrosselt.
 */
export const ausReaderMap = (index: Map<string, ProfileReader>): Map<string, Profile> => {
    const map = new Map<string, Profile>()
    for (const [pubkey, reader] of index) {
        const profil = ausReader(reader)
        if (profil) {
            map.set(pubkey, profil)
        }
    }

    return map
}

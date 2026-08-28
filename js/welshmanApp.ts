/**
 * Fassade: der App-Kontext — jetzt die **echten** 0.9.5-Plugins.
 *
 * ── Was diese Datei nach dem Sprung noch ist ─────────────────────────────────────
 * Bis P1 bildete sie die 0.9.5-Zugriffspfade (`app.use(Profiles)`, `app.use(Thunks)`)
 * über den 0.8.16-Globals nach, damit der Sprung hier ein Entkernen wird und nicht ein
 * zweiter Umbau an 29 Aufrufstellen. **Das ist eingelöst:** die Plugin-Klassen unten
 * sind Re-Exporte aus `@welshman/app`, die Aufrufstellen blieben unverändert.
 *
 * Übrig bleiben die Symbole, für die 0.9.5 **kein** Gegenstück in dieser Form hat. Sie
 * stehen am Ende der Datei, jedes mit dem Grund, warum es hier und nicht dort liegt.
 *
 * ── Die App-Instanz liegt NICHT hier ─────────────────────────────────────────────
 * Sie liegt in `js/welshmanInstance.ts`, zusammen mit dem Identitätswechsel und den
 * Policies. Der Grund ist die Konstruktionsreihenfolge: eine 0.9.5-App bekommt ihre
 * Konfiguration bei `createApp` übergeben, nicht danach zugewiesen — die Instanz muss
 * also unterhalb von `core.ts` liegen, das sie benutzt. Diese Datei reicht `app` nur
 * durch, damit die 27 Importstellen unverändert bleiben.
 *
 * ── Was hier bewusst NICHT nachgebildet wird ─────────────────────────────────────
 * Die Reader-Klassen. `Profiles.get()` liefert in 0.9.5 einen `ProfileReader`
 * (`reader.name()` statt `profile.name`), `Relays` einen `Relay`. Die Aufrufstellen
 * lesen jetzt so — das ist die 0.9.5-Form und keine Hülle davor.
 */
import { derived, get, type Readable } from 'svelte/store'
import { Network, Profiles, RelayLists } from '@welshman/app'
import type { Thunk } from '@welshman/app'
import { getAddress, isReplaceable, isReplaceableKind, type TrustedEvent } from '@welshman/util'
import type { ProfileReader } from '@welshman/domain'
import { app, appStore } from './welshmanInstance.ts'
import { pubkey } from './welshmanSession.ts'

export {
    Profiles,
    Relays,
    Handles,
    Zappers,
    Thunks,
    RelayManagement,
    BlockedRelayLists,
    RelayLists,
} from '@welshman/app'
export type { Thunk, ThunkOptions, IApp, Plugin } from '@welshman/app'
export type { ManagementResponse } from '@welshman/util'
export { app } from './welshmanInstance.ts'

// ── Ohne Gegenstück in dieser Form: Grund je Symbol ──────────────────────────────

/**
 * Das Profil des EINGELOGGTEN Nutzers, reaktiv.
 *
 * 0.9.5 kennt dafür `app.use(Profiles).one(app.user.pubkey)` — aber `app.user` ist eine
 * Property und kein Store, eine App ist an EINE Identität gebunden. Unsere Identität
 * wechselt zur Laufzeit und wird reaktiv gelesen (`welshmanSession.ts`), deshalb steht
 * hier eine Ableitung über beides.
 *
 * `appStore`, nicht `derived([…])` direkt: der Profil-Index gehört der App-Instanz, und
 * ein im Modul-Toplevel festgehaltener Index bliebe nach einem Identitätswechsel am
 * alten hängen (Risiko R4 des Sprung-Plans).
 */
export const userProfile: Readable<ProfileReader | undefined> = appStore<ProfileReader | undefined>(
    (a) =>
        derived([a.use(Profiles).index.$, pubkey], ([$index, $pubkey]) =>
            $pubkey ? $index.get($pubkey) : undefined,
        ),
    undefined,
)

/** Das eigene Profil nachladen. 0.9.5: `Profiles.load(pubkey)` — nur der Pubkey fehlt dort. */
export const loadUserProfile = (): Promise<ProfileReader | undefined> => {
    const pk = get(pubkey)

    return pk ? app.use(Profiles).load(pk) : Promise.resolve(undefined)
}

/**
 * In 0.9.5 eine Methode am Thunk selbst. Hier weiter eine freie Funktion, damit die
 * beiden Aufrufstellen (`js/profiles.ts:198`, `js/readStateSync.ts:371`) unverändert
 * bleiben; der Rumpf ist die 0.9.5-Form.
 */
export const waitForThunkCompletion = (thunk: Thunk): Promise<void> => thunk.waitForCompletion()

/**
 * ── Die drei Tag-Bauer: warum sie hier nachgebaut stehen ─────────────────────────
 *
 * In 0.9.5 sind sie kein freies Funktionstrio mehr, sondern gehen in den Writern aus
 * `@welshman/domain` auf: `CommentWriter.setParentFromEvent(event)` und
 * `ReactionWriter.setEvent(event)` bauen dieselben Tags. **Der Umstieg darauf ist aber
 * kein Import-Tausch, sondern eine Signaturänderung:** `EventWriter.renderTags()` ist
 * `Promise<string[][]>`, weil der Relay-Hint über den jetzt **asynchronen** Router
 * aufgelöst wird. Unsere drei Aufrufer stehen in synchronen Objektliteralen
 * (`js/interactions.ts:59,71,162`), und deren Aufrufer wiederum in
 * `publishOptimistic(url, makeX(...))` an sechs Stellen. Der Umstieg ist also ein
 * async-Umbau der Reaktions-, Kommentar- und Löschpfade — eine eigene Arbeit mit
 * eigenem Verhaltensrisiko am optimistischen Publizieren, nicht ein Nebenprodukt des
 * Versionssprungs. Er gehört in dieselbe Phase, die `js/interactions.ts` ohnehin
 * anfasst.
 *
 * Die Rümpfe sind die von 0.8.16, Zeile für Zeile, mit **einer** bewussten Abweichung:
 * der Relay-Hint kommt aus `RelayLists.writeUrls(pubkey).get()` statt aus
 * `Router.get().Event(event).getUrl()`. Das ist dieselbe Quelle — 0.8.16 löste
 * `Router.Event(event)` gemessen als `FromRelays(getRelaysForPubkey(event.pubkey, Write))`
 * auf (`router@0.8.16 dist/index.js:55`), also die Outbox des Autors —, nur synchron aus
 * der Sammlung gelesen statt über den Resolver. Genau das tat 0.8.16 intern auch: sein
 * `getPubkeyRelays` las aus einem Store, nicht aus dem Netz.
 */
const schreibHint = (autor: string): string => app.use(RelayLists).writeUrls(autor).get()[0] ?? ''

/** `["p", pubkey, hint, anzeigename]` — die 0.8.16-Form von `tagPubkey`. */
const tagPubkey = (pk: string): string[] => ['p', pk, schreibHint(pk), app.use(Profiles).display(pk).get()]

/** `["e", id, hint, mark, autor]`, bei ersetzbaren Kinds zusätzlich `["a", …]`. */
export const tagEvent = (event: TrustedEvent, url = '', mark = ''): string[][] => {
    const hint = url || schreibHint(event.pubkey)
    const tags = [['e', event.id, hint, mark, event.pubkey]]
    if (isReplaceable(event)) {
        tags.push(['a', getAddress(event), hint, mark, event.pubkey])
    }

    return tags
}

/**
 * NIP-22: `K/E/A/P` (Thread-Wurzel, gross) + `k/e/a/p` (direktes Elternteil, klein).
 * Trägt das Elternteil bereits Wurzel-Tags, werden die übernommen statt neu gesetzt —
 * dadurch teilen alle Kommentare eines Threads dasselbe `["E", rootId]`.
 */
export const tagEventForComment = (event: TrustedEvent, relay?: string): string[][] => {
    const pubkeyHint = schreibHint(event.pubkey)
    const eventHint = relay || schreibHint(event.pubkey)
    const address = getAddress(event)
    const seenRoots = new Set<string>()
    const tags: string[][] = []
    for (const [t, ...tag] of event.tags) {
        if (['K', 'E', 'A', 'I', 'P'].includes(t as string)) {
            tags.push([t as string, ...tag])
            seenRoots.add(t as string)
        }
    }
    if (seenRoots.size === 0) {
        tags.push(['K', String(event.kind)])
        tags.push(['P', event.pubkey, pubkeyHint])
        tags.push(['E', event.id, eventHint, event.pubkey])
        if (isReplaceableKind(event.kind)) {
            tags.push(['A', address, eventHint, event.pubkey])
        }
    }
    tags.push(['k', String(event.kind)])
    tags.push(['p', event.pubkey, pubkeyHint])
    tags.push(['e', event.id, eventHint, event.pubkey])
    if (isReplaceableKind(event.kind)) {
        tags.push(['a', address, eventHint, event.pubkey])
    }

    return tags
}

/** NIP-25: `["p", autor]` (ausser bei sich selbst) + `["k", kind]` + `["e", id, hint]`. */
export const tagEventForReaction = (event: TrustedEvent, relay?: string): string[][] => {
    const hint = relay || schreibHint(event.pubkey)
    const tags: string[][] = []
    if (event.pubkey !== get(pubkey)) {
        tags.push(tagPubkey(event.pubkey))
    }
    tags.push(['k', String(event.kind)])
    tags.push(['e', event.id, hint])
    if (isReplaceable(event)) {
        tags.push(['a', getAddress(event), hint])
    }

    return tags
}

/**
 * Nutzerdaten- und Outbox-Lader. In 0.9.5 ersatzlos aufgegangen in den Plugins selbst
 * (jedes `DerivedPlugin` bringt `load`/`forceLoad` über das Outbox-Modell mit) bzw. in
 * `Rooms`. Beide Aufrufstellen liegen in `js/groups.ts`, das die Rooms-Phase ohnehin
 * ersetzt — deshalb hier nachgebaut statt die Aufrufstellen zweimal umzuschreiben.
 */
export const makeUserData = <T>(index: Readable<Map<string, T>>): Readable<T | undefined> =>
    derived([index, pubkey], ([$index, $pubkey]) => ($pubkey ? $index.get($pubkey) : undefined))

/**
 * Ein Lader für ein ersetzbares Event über das Outbox-Modell des Autors. 0.9.5-Form:
 * `app.use(Network).loadUsingOutbox(pubkey, filter, hints)` — dieselbe Semantik, nur
 * ohne die Kind-Vorbindung, die die eine Aufrufstelle (`js/groups.ts:767`) braucht.
 */
export const makeOutboxLoader =
    (kind: number) =>
    (pubkey: string, hints: string[] = []): Promise<TrustedEvent | undefined> =>
        app.use(Network).loadUsingOutbox(pubkey, { kinds: [kind] }, hints)

/**
 * Ein Forum-Thema **anlegen** (kind 45001) — der Teil, der einen Signer, den
 * `repository` und ein Relay braucht.
 *
 * Gegenstück zu `forumWriteModels.ts` (rein, `node --test`-fähig). Dort steht die
 * Ereignisform samt Beleg am Buzz-Quellcode; hier steht der Weg auf den Draht.
 * Die Bauform ist die von `forgeWrite.ts` — Sperre je Ziel, {@link WriteOutcome},
 * optimistischer Merker, der sich im Erfolgsfall sofort zurücknimmt.
 *
 * ── Der Schlüssel bleibt im Browser ─────────────────────────────────────────
 *
 * Signiert wird ausschließlich über welshmans aktiven Signer (NIP-07/NIP-46/
 * NIP-55): `publishThunk` holt ihn sich selbst aus `signer` und ruft
 * `signer.sign()`. In dieser Datei steht kein Krypto, kein Secret, kein
 * Server-Aufruf.
 *
 * ── Drei Eigenschaften, die den Aufbau bestimmen ────────────────────────────
 *
 * 1. **Optimistisch ist geschenkt, die Korrektur nicht.** `publishThunk` legt das
 *    Ereignis synchron in den `repository` und trägt die Ziel-URL im `tracker`
 *    ein — die Themenzeile steht sofort in der Liste, weil `deriveForumTopics`
 *    genau daraus ableitet. Scheitert das Senden, nimmt welshman die Herkunft
 *    wieder weg und die Zeile verschwindet **lautlos**. {@link forumPending} hält
 *    den Vorgang über diesen Moment hinaus fest, samt Relay-Begründung.
 *
 * 2. **`OK` ist nicht die einzige Antwort, mit der man rechnen muss.** Buzz
 *    beantwortet ein ratenbegrenztes `EVENT` mit einer nackten `NOTICE` statt mit
 *    einem `OK` (NIP-01 verlangt das `OK`). welshman ordnet Publish-Ergebnisse
 *    über die Event-Id aus dem `OK` zu — ohne `OK` bleibt der Thunk **für immer**
 *    `pending`. Deshalb läuft dieser Pfad über {@link waitForPublishError} und
 *    nicht über welshmans `waitForThunkError`: die dortige Zeitgrenze
 *    (`PUBLISH_VERDICT_TIMEOUT_MS`) macht aus „gar keine Antwort" einen
 *    Endzustand und hängt, wenn in der Zeit eine NOTICE kam, deren **echten
 *    Wortlaut** an die Meldung. Der Ausgang ist damit in jedem Fall sichtbar:
 *    Erfolg, Ablehnung mit Grund, oder „nicht bestätigt" mit Relay-Notiz. Ein
 *    Dauer-Spinner ist keiner der drei.
 *
 * 3. **Ein Flug je Ziel.** {@link isForumBusy} verriegelt den Kanal, solange ein
 *    Thema unterwegs ist; ein Doppelklick erzeugt kein zweites Ereignis. Der
 *    Riegel sitzt HIER und nicht nur am Knopf — die Tastatur löst denselben Pfad
 *    aus, und ein `aria-disabled` ist nur eine Ansage.
 *
 * ── Warum das RELAY hereingereicht wird und nicht `WORKSPACE_URL` ist ───────
 *
 * `forgeWrite.ts` schreibt gegen den einen Workspace-Relay, weil Repositories dort
 * und nur dort liegen. Ein Forum ist ein KANAL, und ein Kanal gehört zu dem
 * Space, den der Nutzer gerade offen hat — auf einem Buzz-Space ist das derselbe
 * Relay, auf einem zooid-Space gibt es gar keine Foren. Die Ziel-URL kommt
 * deshalb vom Aufrufer (`this._url` der Rauminsel), genau wie bei
 * `loadForumTopics`/`listenForum`. Die Alternative — hier `WORKSPACE_URL` lesen —
 * wäre auf dem heutigen Stand zufällig richtig und beim ersten zweiten Space
 * lautlos falsch.
 */
import { app, Thunks } from './welshmanApp.ts'
import { pubkey, signer } from './welshmanSession.ts'
import { makeEvent } from '@welshman/util'
import { writable, type Readable } from 'svelte/store'
import { t } from './i18n.ts'
import { mentionPubkeys } from './interactions.ts'
import { publishFehlermeldung, waitForPublishError } from './publishResult.ts'
import { FORUM_POST } from './forumModels.ts'
import { buildTopicTags, normalizeTopicContent, topicContentProblem } from './forumWriteModels.ts'

/** Ergebnis einer Schreibaktion. `error === ''` heißt: durchgekommen. */
export type WriteOutcome = { id: string; error: string }

/** Ein Thema, das gerade unterwegs ist oder unterwegs war und scheiterte. */
export type PendingTopic = {
    /** Die Ereignis-Id — sie steht VOR dem Signieren fest (`prep` hasht in welshman). */
    id: string
    /** Kanal-UUID, damit ein Raumwechsel fremde Merker nicht mitschleppt. */
    h: string
    state: 'sending' | 'failed'
    /** Die Relay-Begründung, im Klartext. Leer, solange gesendet wird. */
    error: string
}

const pending = writable<PendingTopic[]>([])

/** Nur lesend für die Insel — schreiben darf ausschließlich dieses Modul. */
export const forumPending: Readable<PendingTopic[]> = { subscribe: pending.subscribe }

// ── Doppelklick-Riegel ──────────────────────────────────────────────────────

/**
 * Kanäle mit einem laufenden Thema. Ein Modul-`Set` und kein Flag an der Insel:
 * die Insel wird beim Raumwechsel neu gebaut, ein laufender Thunk nicht. Der
 * Schlüssel ist deshalb das Ziel (Relay + Kanal), nicht die Fläche.
 */
const inFlight = new Set<string>()

const lockKey = (url: string, h: string): string => `topic:${url}:${h}`

/** Läuft für diesen Kanal gerade ein Thema? */
export const isForumBusy = (url: string, h: string): boolean => inFlight.has(lockKey(url, h))

// ── Merker ──────────────────────────────────────────────────────────────────

/** Einen Merker verwerfen — nach Erfolg oder auf Wunsch des Nutzers. */
export const dismissPendingTopic = (id: string): void => {
    pending.update((list) => list.filter((entry) => entry.id !== id))
}

/** Alle Merker eines Kanals verwerfen (Fläche verlassen). */
export const clearPendingTopics = (): void => {
    pending.set([])
}

// ── Der Schreibpfad ─────────────────────────────────────────────────────────

/**
 * Kann überhaupt gesendet werden? Beantwortet in der Insel schon das Gate — hier
 * steht der Backstop, weil `new Thunk(…)` bei fehlendem Signer **wirft** und ein
 * Wurf im Klick-Handler eine leere Fläche statt einer Meldung ergäbe.
 */
const senderReady = (url: string): string => {
    if (!url) {
        return t('Dieser Client kennt kein Relay, auf dem dieses Forum liegt.')
    }

    return pubkey.get() && signer.get() ? '' : t('Zum Schreiben bitte anmelden.')
}

/**
 * Ein neues Thema (kind 45001) im Forumkanal `h` am Relay `url`.
 *
 * Der Erfolgsfall nimmt den Merker **sofort** zurück: das Ereignis liegt dann im
 * `repository`, `deriveForumTopics` zeigt es aus der normalen Ableitung, und der
 * Merker wäre ab da eine zweite Quelle für dieselbe Zeile — genau die Art
 * Doppelquelle, aus der später zwei verschiedene Zähler entstehen.
 *
 * Der Fehlerfall behält ihn: die Zeile ist in diesem Moment schon wieder aus der
 * Ableitung verschwunden (welshman nimmt die Herkunft zurück), und ohne den
 * Merker hätte der Nutzer ein Thema getippt, gesendet, und nichts wäre passiert.
 */
export const publishForumTopic = async (url: string, h: string, raw: string): Promise<WriteOutcome> => {
    const key = lockKey(url, h)
    if (inFlight.has(key)) {
        return { id: '', error: t('Der vorige Versuch läuft noch.') }
    }

    const problem = topicContentProblem(raw)
    if (problem === 'leer') {
        return { id: '', error: t('Ein Thema braucht einen Text.') }
    }
    if (problem === 'zu-lang') {
        return { id: '', error: t('Das Thema ist zu lang — Buzz nimmt höchstens 64 KB an.') }
    }

    const guard = senderReady(url)
    if (guard) {
        return { id: '', error: guard }
    }

    const content = normalizeTopicContent(raw)
    // Die Erwähnungen kommen aus dem RUMPF und werden HIER gelesen, nicht vom
    // Aufrufer gereicht: es gibt zwei Absendewege (Knopf und Tastatur) und nur
    // einen Rumpf. Ein Aufrufer, der es vergisst, erzeugte einen Beitrag, der
    // aussieht wie eine Erwähnung und niemanden erreicht.
    const event = makeEvent(FORUM_POST, { content, tags: buildTopicTags(h, mentionPubkeys(content)) })

    let thunk
    try {
        thunk = app.use(Thunks).publish({ relays: [url], event })
    } catch {
        // `new Thunk` wirft ohne pubkey/signer — die Sitzung kann zwischen Gate
        // und Klick abgelaufen sein.
        return { id: '', error: t('Zum Schreiben bitte anmelden.') }
    }

    const id = thunk.event.id
    inFlight.add(key)
    pending.update((list) => [...list.filter((entry) => entry.id !== id), { id, h, state: 'sending', error: '' }])

    try {
        // `publishFehlermeldung` trennt die zwei Ausgänge, die hier ankommen können:
        // eine echte Ablehnung (`OK false`) bekommt „Vom Relay abgelehnt: <Grund>"
        // bzw. den handlungsleitenden Satz; das **ausbleibende Verdikt** des
        // Ratenbegrenzers behält seinen eigenen Satz und bekommt den Hinweis nur
        // vorangestellt. Beides ist ein sichtbarer Ausgang — und keiner von beiden
        // behauptet eine Ablehnung, die nicht stattgefunden hat.
        const error = publishFehlermeldung(await waitForPublishError(thunk))
        if (error) {
            pending.update((list) =>
                list.map((entry) => (entry.id === id ? { ...entry, state: 'failed' as const, error } : entry)),
            )

            return { id, error }
        }
        dismissPendingTopic(id)

        return { id, error: '' }
    } finally {
        inFlight.delete(key)
    }
}

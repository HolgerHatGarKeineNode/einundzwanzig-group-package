/**
 * P8 — die Forge **schreiben**: Issue anlegen, kommentieren, Status setzen.
 *
 * Gegenstück zu `forgeWriteModels.ts` (rein, `node --test`-fähig). Hier steht
 * alles, was einen Signer, den `repository` oder ein Relay braucht — und sonst
 * nichts. Die Messung, auf der beide Module stehen, ist im Kopf des reinen
 * Moduls protokolliert.
 *
 * ── Der Schlüssel bleibt im Browser ─────────────────────────────────────────
 *
 * Signiert wird ausschließlich über welshmans aktiven Signer (NIP-07/NIP-46/
 * NIP-55) — `publishThunk` holt ihn sich selbst aus `signer`
 * (`@welshman/app/…/thunk.js:29`) und ruft `signer.sign()`. In dieser Datei
 * steht kein Krypto, kein Secret und kein Server-Aufruf.
 *
 * ── Drei Eigenschaften, die den Aufbau bestimmen ────────────────────────────
 *
 * 1. **Optimistisch ist geschenkt, die Korrektur nicht.** `publishThunk` legt
 *    das Ereignis synchron in den `repository` und trägt die Ziel-URL im
 *    `tracker` ein — die Zeile steht sofort. Scheitert das Senden, nimmt
 *    welshman die Herkunft wieder weg und die Zeile verschwindet **lautlos**.
 *    Deshalb der Merker {@link pendingWrites}: er hält den Eintrag über den
 *    Fehlschlag hinaus fest, samt Relay-Begründung.
 * 2. **`OK true` ist keine Zusage, dass es WIRKT.** Bei einem Statuswechsel
 *    entscheidet nicht der Relay, sondern die Faltung: `foldStatus` behält je
 *    Wurzel genau ein Ereignis. Deshalb wird nach dem `OK` am gefalteten
 *    Ergebnis nachgeprüft, ob wirklich die eigene Fassung steht — und wenn
 *    nicht, sagt die Fläche das, statt Erfolg zu melden.
 * 3. **Ein Flug je Ziel.** {@link isBusy} verriegelt die Aktion, solange sie
 *    unterwegs ist; ein Doppelklick erzeugt kein zweites Ereignis. Der Riegel
 *    sitzt HIER und nicht nur am Knopf — die Tastatur löst denselben Pfad aus.
 */
import { publishThunk, pubkey, signer } from '@welshman/app'
import { makeEvent } from '@welshman/util'
import { writable, type Readable } from 'svelte/store'
import { t } from './i18n.ts'
import { mentionPubkeys } from './interactions.ts'
import { waitForPublishError } from './publishResult.ts'
import { WORKSPACE_URL } from './spaceCaps.ts'
import {
    FORGE_COMMENT_KIND,
    GIT_ISSUE_KIND,
    addPending,
    awaitValue,
    buildCommentTags,
    buildIssueTags,
    buildStatusTags,
    dropPending,
    failPending,
    nextCreatedAt,
    statusKindFor,
    type PendingWrite,
    type WritableIssueStatus,
} from './forgeWriteModels.ts'

/** Ergebnis einer Schreibaktion. `error === ''` heißt: durchgekommen. */
export type WriteOutcome = { id: string; error: string }

/** Der Merker der laufenden und der gescheiterten Schreibvorgänge. */
export const pendingWrites = writable<PendingWrite[]>([])

/** Nur lesend für die Insel — schreiben darf ausschließlich dieses Modul. */
export const forgePending: Readable<PendingWrite[]> = { subscribe: pendingWrites.subscribe }

// ── Doppelklick-Riegel ──────────────────────────────────────────────────────

/**
 * Ziele mit einem laufenden Vorgang.
 *
 * Ein Modul-`Set` statt eines Flags an der Insel: dieselbe Fläche kann mehrere
 * Formulare gleichzeitig offen haben (ein Kommentarfeld je aufgeklapptem
 * Issue), und zwei verschiedene Ziele dürfen sich nicht gegenseitig sperren.
 * Der Schlüssel ist deshalb das Ziel, nicht die Insel.
 */
const inFlight = new Set<string>()

/** Läuft für dieses Ziel gerade ein Vorgang? */
export const isBusy = (key: string): boolean => inFlight.has(key)

const withLock = async (key: string, run: () => Promise<WriteOutcome>): Promise<WriteOutcome> => {
    if (inFlight.has(key)) {
        return { id: '', error: t('Der vorige Versuch läuft noch.') }
    }
    inFlight.add(key)
    try {
        return await run()
    } finally {
        inFlight.delete(key)
    }
}

// ── Gemeinsamer Sendepfad ───────────────────────────────────────────────────

const now = (): number => Math.floor(Date.now() / 1000)

/**
 * Kann überhaupt gesendet werden? Beantwortet in der Insel schon der Gate —
 * hier steht der Backstop, weil `new Thunk(…)` bei fehlendem Signer **wirft**
 * und ein Wurf im Klick-Handler eine leere Fläche statt einer Meldung ergäbe.
 */
const senderReady = (): string => {
    if (!WORKSPACE_URL) {
        return t('Dieser Client kennt kein Relay, auf dem Repositories liegen.')
    }

    return pubkey.get() && signer.get() ? '' : t('Zum Schreiben bitte anmelden.')
}

/**
 * Ereignis bauen, senden, den Merker führen. Gibt die Ereignis-Id zurück, weil
 * die Fläche daran die eigene Zeile wiedererkennt.
 *
 * Die Id steht **vor** dem Signieren fest: `publishThunk` hasht das Ereignis in
 * `prep` (`@welshman/util/…/Keys.js:14`), und das Signieren ändert sie nicht.
 */
const send = async (
    template: { kind: number; content: string; tags: string[][]; created_at?: number },
    entry: Omit<PendingWrite, 'id' | 'state' | 'error' | 'author' | 'createdAt'>,
): Promise<WriteOutcome> => {
    const guard = senderReady()
    if (guard) {
        return { id: '', error: guard }
    }
    const event = makeEvent(template.kind, {
        content: template.content,
        tags: template.tags,
        ...(template.created_at === undefined ? {} : { created_at: template.created_at }),
    })

    let thunk
    try {
        thunk = publishThunk({ relays: [WORKSPACE_URL], event })
    } catch {
        // `new Thunk` wirft ohne pubkey/signer — die Sitzung kann zwischen Gate
        // und Klick abgelaufen sein.
        return { id: '', error: t('Zum Schreiben bitte anmelden.') }
    }
    const id = thunk.event.id

    pendingWrites.update((list) =>
        addPending(list, {
            ...entry,
            id,
            state: 'sending',
            error: '',
            author: pubkey.get() ?? '',
            createdAt: thunk.event.created_at,
        }),
    )

    const error = await waitForPublishError(thunk)
    if (error) {
        pendingWrites.update((list) => failPending(list, id, error))

        return { id, error }
    }

    return { id, error: '' }
}

/** Einen Eintrag aus dem Merker nehmen — nach Erfolg oder auf Wunsch des Nutzers. */
export const dismissPending = (id: string): void => {
    pendingWrites.update((list) => dropPending(list, id))
}

/** Alle Merker eines Repos verwerfen (Fläche verlassen). */
export const clearPending = (): void => {
    pendingWrites.set([])
}

// ── Die drei Schreibpfade ───────────────────────────────────────────────────

/**
 * Ein neues Issue (kind 1621) am Repo `repoAddress`.
 *
 * Der Erfolgsfall nimmt den Merker sofort zurück: das Ereignis liegt dann im
 * `repository` und die Liste zeigt es aus der normalen Ableitung — der Merker
 * wäre ab da eine zweite Quelle für dieselbe Zeile.
 */
export const publishIssue = async (
    repoAddress: string,
    draft: { title: string; body: string },
): Promise<WriteOutcome> =>
    withLock(`issue:${repoAddress}`, async () => {
        const outcome = await send(
            {
                kind: GIT_ISSUE_KIND,
                content: draft.body.trim(),
                // Die Erwähnungen kommen aus dem RUMPF und werden hier gelesen,
                // nicht vom Aufrufer gereicht: es gibt drei Absendewege (Knopf,
                // Tastatur, künftige Fläche) und nur einen Rumpf. Ein Aufrufer,
                // der es vergisst, erzeugte einen Beitrag, der aussieht wie eine
                // Erwähnung und niemanden erreicht.
                tags: buildIssueTags(repoAddress, draft.title, mentionPubkeys(draft.body)),
            },
            {
                what: 'issue',
                repoAddress,
                rootId: '',
                label: draft.title.trim(),
                content: draft.body.trim(),
            },
        )
        if (!outcome.error && outcome.id) {
            dismissPending(outcome.id)
        }

        return outcome
    })

/**
 * Ein Kommentar (kind 1) an ein Issue **oder** einen Pull Request.
 *
 * `lastCreatedAt` ist der Zeitstempel des jüngsten bereits vorhandenen
 * Kommentars an dieser Wurzel: `commentsForRoot` sortiert aufsteigend nach
 * `created_at`, ein Kommentar in derselben Sekunde landete sonst im
 * Id-Tiebreak — also mal über, mal unter dem, auf den er antwortet.
 */
export const publishForgeComment = async (
    target: { repoAddress: string; rootId: string; rootAuthor: string; lastCreatedAt: number },
    content: string,
): Promise<WriteOutcome> =>
    withLock(`comment:${target.rootId}`, async () => {
        const outcome = await send(
            {
                kind: FORGE_COMMENT_KIND,
                content: content.trim(),
                tags: buildCommentTags(
                    target.repoAddress,
                    target.rootId,
                    target.rootAuthor,
                    mentionPubkeys(content),
                ),
                created_at: nextCreatedAt(now(), target.lastCreatedAt),
            },
            {
                what: 'comment',
                repoAddress: target.repoAddress,
                rootId: target.rootId,
                label: '',
                content: content.trim(),
            },
        )
        if (!outcome.error && outcome.id) {
            dismissPending(outcome.id)
        }

        return outcome
    })

/**
 * Wie lange auf die Faltung gewartet wird, bevor der Statuswechsel als „nicht
 * durchgesetzt" gilt. Die Ableitung ist `throttled(300)`; vier Sekunden lassen
 * reichlich Luft für den Rückweg über das `limit:0`-Abo.
 */
export const STATUS_VERIFY_TIMEOUT_MS = 4_000
const STATUS_VERIFY_STEP_MS = 200

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * Den Zustand eines Issues setzen (1630/1631/1632) — **mit Nachprüfung**.
 *
 * Das ist die Aktion, bei der `OK true` am wenigsten wert ist: der Relay nimmt
 * ein Status-Ereignis von **jedem** an (am Teststack gemessen, siehe
 * `forgeWriteModels.ts`), aber angezeigt wird nur, was `foldStatus` durchlässt —
 * das neueste Ereignis eines Berechtigten. Ein fremder Wechsel mit späterem
 * `created_at` schlägt unseren, ohne dass irgendetwas fehlschlägt.
 *
 * `readStatus` liefert den Zustand, den die Fläche gerade ANZEIGT. Steht dort
 * nach dem Warten nicht der gewünschte Wert, wird der Vorgang als
 * fehlgeschlagen markiert — mit einer Begründung, die den Unterschied benennt,
 * statt Erfolg zu behaupten.
 */
export const publishIssueStatus = async (
    target: {
        repoAddress: string
        rootId: string
        rootAuthor: string
        /** `created_at` des derzeit geltenden Status-Ereignisses, `0` wenn keins. */
        statusCreatedAt: number
    },
    status: WritableIssueStatus,
    readStatus: () => string,
): Promise<WriteOutcome> =>
    withLock(`status:${target.rootId}`, async () => {
        const kind = statusKindFor(status)
        if (kind === 0) {
            return { id: '', error: t('Dieser Zustand lässt sich nicht setzen.') }
        }
        const outcome = await send(
            {
                kind,
                content: '',
                tags: buildStatusTags(target.repoAddress, target.rootId, target.rootAuthor),
                created_at: nextCreatedAt(now(), target.statusCreatedAt),
            },
            {
                what: 'status',
                repoAddress: target.repoAddress,
                rootId: target.rootId,
                label: status,
                content: '',
            },
        )
        if (outcome.error || !outcome.id) {
            return outcome
        }

        const settled = await awaitValue({
            read: readStatus,
            accept: (value) => value === status,
            timeoutMs: STATUS_VERIFY_TIMEOUT_MS,
            stepMs: STATUS_VERIFY_STEP_MS,
            sleep,
        })
        if (!settled.ok) {
            const error = t('Das Relay hat den Wechsel angenommen, aber er hat sich nicht durchgesetzt — ein neuerer Statuswechsel gilt.')
            pendingWrites.update((list) => failPending(list, outcome.id, error))

            return { id: outcome.id, error }
        }
        dismissPending(outcome.id)

        return outcome
    })

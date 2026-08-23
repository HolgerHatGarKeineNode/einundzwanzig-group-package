/**
 * P9 — die Weckmeldung **senden**. Gegenstück zum reinen `forgeWakeModels.ts`,
 * in dem steht, warum es sie überhaupt braucht und wann sie ausbleibt.
 *
 * ── Zwei Vorgänge, zwei Ergebnisse ──────────────────────────────────────────
 *
 * Der Forge-Beitrag ist zu diesem Zeitpunkt **schon veröffentlicht**. Scheitert
 * die Weckmeldung, ist das ein zweiter, eigener Ausgang — der Beitrag bleibt
 * gültig und wird als gelungen dargestellt. Deshalb wirft diese Funktion nicht
 * und liefert nie einen Fehler, der wie ein Fehlschlag des Beitrags aussieht;
 * sie gibt einen eigenen {@link WakeResult} zurück, den die Fläche neben dem
 * Beitrag zeigt. Dasselbe Muster wie „gezahlt ist gezahlt": nach dem gelungenen
 * ersten Schritt darf der zweite den ersten nicht rückwirkend entwerten.
 *
 * ── Nur auf Nutzerhandlung ──────────────────────────────────────────────────
 *
 * Aufgerufen wird das ausschließlich aus `submitIssue`/`submitComment`, also
 * unmittelbar nach einem Klick oder Tastendruck. Keine Hintergrundschleife, kein
 * Aufruf beim Lesen, Nachladen oder Neuzeichnen — eine Weckmeldung ist eine
 * Nachricht an einen Prozess, der daraufhin ein Modell aufruft; sie zweimal zu
 * senden kostet echtes Geld und weckt jemanden für nichts.
 */
import { makeEvent } from '@welshman/util'
import type { AgentEntry } from './agentDirectoryData.ts'
import { PROTECTED, canEnforceNip70, mentionPubkeys } from './interactions.ts'
import { publishOptimistic } from './publishOptimistic.ts'
import * as nip19 from 'nostr-tools/nip19'
import { agentLabels, buildWakeMessage, planWake, type WakeTarget } from './forgeWakeModels.ts'

/**
 * Wie die Weckmeldung ausgegangen ist. `none` heißt: es war keine nötig — nur
 * dieser eine Fall bleibt in der Fläche stumm.
 */
export type WakeResult = {
    code: 'none' | 'no-channel' | 'channel-foreign' | 'not-wakeable' | 'sent' | 'failed'
    /**
     * Wie die betroffenen Agenten in der Meldung benannt werden — Name UND
     * Schlüssel-Kurzform. Der Name allein wäre eine Zusicherung über eine
     * Identität, die niemand geprüft hat (Begründung an `agentLabels`).
     */
    names: string[]
    /** Relay-Begründung, nur bei `failed`. */
    error: string
}

/**
 * Erwähnte Agenten im Projektkanal wecken — **genau eine** Nachricht je
 * Absendevorgang, alle weckbaren darin.
 *
 * `content` ist der Rumpf des gerade veröffentlichten Beitrags; die Erwähnungen
 * werden hier erneut daraus gelesen und nicht vom Aufrufer gereicht. Grund: es
 * ist derselbe Rumpf, aus dem `forgeWrite.ts` die `p`-Tags baut — zwei Wege zu
 * derselben Liste wären zwei Listen, sobald einer von beiden altert.
 */
export const wakeMentionedAgents = async ({
    url,
    channelId,
    agents,
    viewerPubkey,
    content,
    target,
    knownChannelIds,
}: {
    url: string
    channelId: string
    agents: readonly AgentEntry[]
    viewerPubkey: string
    content: string
    target: WakeTarget
    /** Die Kanäle dieses Nutzers — der Riegel gegen einen fremdgesetzten Zielkanal. */
    knownChannelIds: ReadonlySet<string>
}): Promise<WakeResult> => {
    const plan = planWake({
        agents,
        channelId,
        viewerPubkey,
        mentioned: mentionPubkeys(content),
        knownChannelIds,
    })
    if (plan.code !== 'ready') {
        return { code: plan.code, names: agentLabels(plan.mentionedAgents, nip19.npubEncode), error: '' }
    }
    const names = agentLabels(plan.wakeable, nip19.npubEncode)
    const message = buildWakeMessage({
        channelId,
        wakeable: plan.wakeable,
        target,
        // Wie jede andere schreibende Raum-Aktion des Hauses: NIP-70 nur, wenn
        // der Relay es laut NIP-11 durchsetzt (`roomTags`, `interactions.ts`).
        extraTags: canEnforceNip70(url) ? [PROTECTED] : [],
    })
    if (!message) {
        // Kann nach `planWake` nur eintreten, wenn ein Eintrag keinen brauchbaren
        // Schlüssel trägt. Dann ist niemand geweckt — und das ist zu sagen.
        return { code: 'not-wakeable', names, error: '' }
    }
    const error = await publishOptimistic(
        url,
        makeEvent(message.kind, { content: message.content, tags: message.tags }),
    )

    return error ? { code: 'failed', names, error } : { code: 'sent', names, error: '' }
}

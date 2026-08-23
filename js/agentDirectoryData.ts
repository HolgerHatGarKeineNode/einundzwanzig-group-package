/**
 * Headless Buzz-Agenten im @-Autocomplete (kind 10100) — die **reine** Hälfte:
 * parsen, validieren, filtern. Kein Netz, keine Stores, keine welshman-Importe;
 * damit läuft `agentDirectoryData.test.ts` unter `node --test`. Die unreine
 * Hälfte (Laden/Abo/Ableitung) liegt in `agentDirectory.ts`.
 *
 * ── Was ein Agent ist und was ihn weckt ─────────────────────────────────────
 *
 * Ein Agent ist ein Nostr-Schlüssel, hinter dem ein Prozess hängt (`buzz-acp`).
 * Geweckt wird er von einer Nachricht, die **alle drei** Bedingungen erfüllt
 * (an der Quelle gelesen, Repo `buzz`, Stand 2026-08-23):
 *
 * | Bedingung                                   | Fundstelle                          |
 * |---------------------------------------------|-------------------------------------|
 * | `["p", <64-hex des Agenten>, …]` im Event    | `buzz-acp/src/filter.rs:392-396`    |
 * | kind 9 (Chat-Nachricht)                      | `buzz-acp/src/config.rs:1276-1290`  |
 * | im abonnierten Kanal (`#h` = Kanal-UUID)     | `buzz-acp/src/relay.rs:880`         |
 *
 * **Kein npub, kein nprofile** — der Vergleich in `filter.rs` ist ein roher
 * String-Vergleich gegen die 64-stellige Hex-Form. Unser Weg dahin ist der
 * bestehende: `pickMention` fügt `nostr:npub…` in den Entwurf, `mentionPubkeys`
 * (`interactions.ts:220`) dekodiert ihn zurück nach hex, `withMentionTags`
 * (`feeds.ts:1618`) hängt `["p", hex, url]` an. Dieser Weg wurde für diese Phase
 * **gemessen und nicht verändert** (`agentPTag.test.ts`).
 *
 * ── Warum `content.pubkey` nicht zählt ──────────────────────────────────────
 *
 * Der `content` eines 10100 ist frei wählbarer Text eines beliebigen Autors. Wer
 * `{"pubkey":"<fremder Schlüssel>","name":"ceo"}` publiziert, bekäme einen
 * Vorschlag „ceo", dessen `p`-Tag auf jemand anderen zeigt — die Nachricht ginge
 * an den Falschen und der echte Agent bliebe stumm. Maßgeblich ist deshalb
 * **ausschließlich `event.pubkey`**; ein `content.pubkey` wird gelesen wie jedes
 * andere Feld: gar nicht. Genau so hält es die Gegenseite („Always overwrite the
 * pubkey with the event author", `nostr_convert.rs`, zitiert in
 * `/home/user/buzz-team/bin/publish-agent-profiles.mjs:36-40`).
 *
 * ── Zwei Hälften der Eignung, nicht eine ────────────────────────────────────
 *
 * Der Referenzclient (Buzz Desktop,
 * `desktop/src/features/agents/lib/agentAutocompleteEligibility.ts`) schlägt
 * einen Agenten nur vor, wenn **beide** Hälften tragen:
 *
 *   relayAgentCanRespondInChannel = channelIds.includes(channelId)
 *                                   && relayAgentIsSharedWithUser(…, currentPubkey)
 *
 * Die zweite Hälfte prüft den **Betrachter**: bei `respond_to === "allowlist"`
 * muss sein Pubkey in `respond_to_allowlist` stehen, sonst zählt nur
 * `respond_to === "anyone"`. Das ist keine Kosmetik, sondern deckungsgleich mit
 * dem, was der Agent selbst tut: `buzz-acp/src/lib.rs:249-257` verwirft eine
 * Nachricht, deren Autor weder in der Allowlist noch Owner/Geschwister ist.
 *
 * Ein Vorschlag ohne diese zweite Hälfte wäre also ein Knopf, der garantiert
 * nichts tut — der Nutzer schreibt `@ceo`, das Event geht raus, der Relay
 * quittiert, und niemand antwortet je. Deshalb steht sie hier.
 *
 * (Bewusste Abweichung vom Agenten: `buzz-acp` lässt zusätzlich Owner und
 * Geschwister-Agenten durch. Der Referenzclient tut das nicht, und wir folgen
 * dem Referenzclient — er ist strenger, nie großzügiger.)
 */

/** Agenten-Verzeichnisprofil. Ersetzbar nach NIP-01 (10000–19999) → eins je Autor. */
export const AGENT_PROFILE = 10100

/** Die Hex-Form, die `buzz-acp` im `p`-Tag vergleicht: 64 Zeichen, klein. */
const HEX64 = /^[0-9a-f]{64}$/

/** Was ein 10100 mindestens mitbringen muss, um überhaupt geprüft zu werden. */
export type AgentProfileEventLike = {
    kind: number
    pubkey: string
    content: string
    created_at?: number
}

/** Ein geprüfter Verzeichniseintrag. `pubkey` ist IMMER `event.pubkey`. */
export type AgentEntry = {
    pubkey: string
    name: string
    displayName: string
    agentType: string
    channelIds: string[]
    respondTo: string
    respondToAllowlist: string[]
    status: string
    createdAt: number
}

/** Ein Vorschlag im Composer-Popover. Deckungsgleich mit `MentionItem` (bridge.ts). */
export type MentionItemLike = {
    pubkey: string
    npub: string
    name: string
    picture: string
    search: string
    isAgent?: boolean
}

/** `String[]` aus einem beliebigen JSON-Wert: alles andere fällt still weg. */
const stringList = (value: unknown): string[] => {
    if (!Array.isArray(value)) {
        return []
    }
    const out: string[] = []
    for (const raw of value) {
        if (typeof raw === 'string') {
            const trimmed = raw.trim()
            if (trimmed && !out.includes(trimmed)) {
                out.push(trimmed)
            }
        }
    }
    return out
}

const stringValue = (value: unknown): string => (typeof value === 'string' ? value.trim() : '')

/**
 * Ein kind-10100-Event → Verzeichniseintrag, oder `null`.
 *
 * `null` bei: falschem Kind, `event.pubkey` nicht 64-hex-klein, unlesbarem oder
 * nicht-objektartigem `content`, sowie bei **leerer `channel_ids`** — ein
 * solches Profil kann per Konstruktion in keinem Kanal vorgeschlagen werden, und
 * ein Eintrag, der nie zu einem Vorschlag führt, ist kein Eintrag, sondern eine
 * Falle für den nächsten Leser.
 */
export const parseAgentProfile = (event: AgentProfileEventLike): AgentEntry | null => {
    if (event.kind !== AGENT_PROFILE || !HEX64.test(event.pubkey)) {
        return null
    }
    let raw: unknown
    try {
        raw = JSON.parse(event.content)
    } catch {
        return null
    }
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
        return null
    }
    const body = raw as Record<string, unknown>
    // `channels` ist das Zwillingsfeld, das dasselbe Skript mitschreibt
    // (publish-agent-profiles.mjs:86-87). `channel_ids` führt; `channels` dient
    // nur als Rückfall, falls ein anderer Schreiber nur eins von beiden setzt.
    const channelIds = stringList(body.channel_ids).length
        ? stringList(body.channel_ids)
        : stringList(body.channels)
    if (channelIds.length === 0) {
        return null
    }
    const name = stringValue(body.name)
    const displayName = stringValue(body.display_name) || name
    if (!name && !displayName) {
        return null
    }
    return {
        pubkey: event.pubkey, // NICHT body.pubkey — siehe Modulkopf
        name: name || displayName,
        displayName: displayName || name,
        agentType: stringValue(body.agent_type),
        channelIds,
        respondTo: stringValue(body.respond_to),
        respondToAllowlist: stringList(body.respond_to_allowlist).filter((pk) => HEX64.test(pk)),
        status: stringValue(body.status),
        createdAt: typeof event.created_at === 'number' ? event.created_at : 0,
    }
}

/**
 * Mehrere 10100 → Einträge, je Autor genau einer (der neuere `created_at`
 * gewinnt; bei Gleichstand der zuerst gesehene). Ersetzbare Events hält
 * welshmans Repository ohnehin schon eindeutig — dieser Schritt ist der Riegel
 * für den Fall, dass sie aus zwei Quellen zusammenlaufen.
 */
export const parseAgentProfiles = (events: AgentProfileEventLike[]): AgentEntry[] => {
    const byPubkey = new Map<string, AgentEntry>()
    for (const event of events) {
        const entry = parseAgentProfile(event)
        if (!entry) {
            continue
        }
        const seen = byPubkey.get(entry.pubkey)
        if (!seen || entry.createdAt > seen.createdAt) {
            byPubkey.set(entry.pubkey, entry)
        }
    }
    return [...byPubkey.values()].sort((a, b) => a.name.localeCompare(b.name))
}

/** Erste Hälfte der Eignung: bedient dieser Agent DIESEN Kanal? */
export const agentServesChannel = (agent: AgentEntry, h: string): boolean =>
    Boolean(h) && agent.channelIds.includes(h)

/**
 * Zweite Hälfte: würde der Agent auf DIESEN Betrachter überhaupt reagieren?
 * Nachbau von `relayAgentIsSharedWithUser` (Referenzclient) für den Fall
 * „genau ein Kanal", der bei uns immer vorliegt.
 */
export const agentIsSharedWithUser = (agent: AgentEntry, h: string, viewerPubkey: string): boolean => {
    if (agent.respondTo === 'allowlist' && viewerPubkey) {
        return agent.respondToAllowlist.includes(viewerPubkey)
    }
    return agent.respondTo === 'anyone' && agentServesChannel(agent, h)
}

/** Beide Hälften zusammen — die einzige Stelle, die „darf vorgeschlagen werden" sagt. */
export const agentCanRespondInChannel = (agent: AgentEntry, h: string, viewerPubkey: string): boolean =>
    agentServesChannel(agent, h) && agentIsSharedWithUser(agent, h, viewerPubkey)

/**
 * Die Vorschlagsliste eines Raums.
 *
 * **Der Riegel gegen zooid steht hier und nicht in der Fläche**: `spaceKind`
 * ist dreiwertig (`spaceCaps.ts`), und alles außer `'buzz'` — auch das noch
 * unentschiedene `'unknown'` — liefert die leere Liste. Ein Agentenvorschlag auf
 * einem zooid-Space wäre nicht nur nutzlos (dort läuft kein `buzz-acp`), er wäre
 * eine Falschaussage über einen fremden Relay.
 *
 * `encodeNpub` wird injiziert, damit dieses Modul rein bleibt; die Fläche reicht
 * `nip19.npubEncode` durch. Wirft der Encoder (kaputter Schlüssel), fällt der
 * Eintrag still weg statt die ganze Liste zu reißen.
 */
export const agentMentionItems = ({
    agents,
    h,
    viewerPubkey,
    spaceKind,
    encodeNpub,
    memberItems = [],
}: {
    agents: AgentEntry[]
    h: string
    viewerPubkey: string
    spaceKind: string
    encodeNpub: (pubkey: string) => string
    memberItems?: MentionItemLike[]
}): MentionItemLike[] => {
    if (spaceKind !== 'buzz') {
        return []
    }
    const memberByPubkey = new Map(memberItems.map((m) => [m.pubkey, m]))
    const out: MentionItemLike[] = []
    for (const agent of agents) {
        if (!agentCanRespondInChannel(agent, h, viewerPubkey)) {
            continue
        }
        let npub: string
        try {
            npub = encodeNpub(agent.pubkey)
        } catch {
            continue
        }
        const member = memberByPubkey.get(agent.pubkey)
        const name = agent.displayName || agent.name
        out.push({
            pubkey: agent.pubkey,
            npub,
            name,
            // Avatar aus dem Space-Directory (kind 0), wenn der Agent dort auch
            // Mitglied ist — das Verzeichnisprofil trägt selbst kein Bild.
            picture: member?.picture ?? '',
            // Beide Namen durchsuchbar: `@ceo` soll auch dann treffen, wenn das
            // kind-0-Profil des Agenten anders heißt als sein Verzeichniseintrag.
            search: `${name} ${agent.name} ${member?.name ?? ''} ${npub}`.toLowerCase(),
            isAgent: true,
        })
    }
    return out
}

/**
 * Agenten vor Mitglieder, jede Identität genau einmal.
 *
 * Die Agenten stehen vorn, weil sie der Zweck der Erwähnung sind; ein Agent, der
 * zugleich Relay-Mitglied ist (bei uns: alle zehn), erscheint **nur** als Agent —
 * zwei Zeilen mit demselben Pubkey wären zwei Zeilen mit derselben Wirkung, und
 * der Nutzer könnte die wirkungslose erwischen.
 */
export const mergeMentionItems = (memberItems: MentionItemLike[], agentItems: MentionItemLike[]): MentionItemLike[] => {
    const agentPubkeys = new Set(agentItems.map((a) => a.pubkey))
    return [...agentItems, ...memberItems.filter((m) => !agentPubkeys.has(m.pubkey))]
}

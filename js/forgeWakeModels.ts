/**
 * P9 — die **Weckmeldung**: warum eine Erwähnung in der Forge allein niemanden
 * erreicht, und was statt dessen gesendet wird.
 *
 * Rein (kein Netz, kein Store, kein welshman) und damit unter `node --test`
 * fahrbar; das Senden steht in `forgeWake.ts`.
 *
 * ── Der gemessene Befund, ohne den dieses Modul unsinnig wäre ───────────────
 *
 * **Ein Git-Ereignis weckt einen headless Agenten NIE.** Der Relay führt
 * NIP-34-Ereignisse community-global und ignoriert ein `h`-Tag ausdrücklich
 * („git events use `a` tags, not `h` tags",
 * `buzz-relay/src/handlers/ingest.rs:425-437`). Ein Issue bekommt damit nie eine
 * `channel_id` — die Subscription des Agenten ist aber strikt kanalgebunden
 * (`buzz-acp/src/relay.rs:880`). Im buzz-team am 2026-07-29 zweimal gemessen,
 * mit und ohne `h`-Tag am Issue: keine Reaktion.
 *
 * Der etablierte Weg ist deshalb eine **Kanalnachricht (kind 9)**, die auf den
 * Vorgang verweist — genau das tut `/home/user/buzz-team/bin/issues-to-channel.mjs`
 * seit 2026-07-30, nur serverseitig und über einen Webhook. Diese Fläche kann
 * es direkt: sie hat den Signer des Nutzers im Browser und weiß im selben
 * Moment, wer erwähnt wurde.
 *
 * ── Drei Bedingungen, und alle drei müssen halten ───────────────────────────
 *
 * | Bedingung                                   | Fundstelle                       |
 * |---------------------------------------------|----------------------------------|
 * | `["p", <64-hex>]` im Event                   | `buzz-acp/src/filter.rs:392-396` |
 * | kind 9 im abonnierten Kanal (`#h`)           | `buzz-acp/src/relay.rs:880`      |
 * | der AUTOR darf den Agenten wecken            | `buzz-acp/src/lib.rs:249-257`    |
 *
 * Die dritte ist die, die man vergisst: bei `respond_to: "allowlist"` verwirft
 * der Agent jede Nachricht, deren Autor nicht in seiner Liste steht — er
 * quittiert nichts, er antwortet einfach nie. Alle zehn Produktivagenten stehen
 * genau so (2026-08-23 gemessen). Die Prüfung dafür ist NICHT hier nachgebaut,
 * sondern {@link agentCanRespondInChannel} aus `agentDirectoryData.ts` — eine
 * zweite Fassung derselben Regel wäre eine, die auseinanderläuft.
 *
 * ── Und warum „keine Meldung" ein ERGEBNIS ist ──────────────────────────────
 *
 * Trägt das Repo keinen `buzz-channel` oder ist keiner der Erwähnten weckbar,
 * entsteht bewusst kein Ereignis. Das darf aber nicht still passieren: der
 * Nutzer hat gerade `@ceo` geschrieben und wartet sonst auf eine Antwort, die
 * per Konstruktion nie kommt. Deshalb liefert {@link planWake} in jedem Fall
 * einen Code, den die Fläche zeigen kann — auch im Fall „nichts zu tun".
 */
import { agentCanRespondInChannel, shortNpub, type AgentEntry } from './agentDirectoryData.ts'
import { parseRepoAddress } from './forgeModels.ts'
import { t } from './i18n.ts'

/** Kanal-Nachricht (NIP-29). Dasselbe Kind wie jede Chat-Zeile. */
export const WAKE_MESSAGE_KIND = 9
/** NIP-34 Repo-Announcement — nur für den Rückfall-Verweis (`30617:<owner>:<d>`). */
const REPO_ANNOUNCEMENT_KIND = 30617

const HEX64 = /^[0-9a-f]{64}$/i

/**
 * Darf dieses `d`-Tag in einem `buzz://`-Link stehen?
 *
 * 1:1 die Regel des Referenzclients (`buzz-cli/src/links.rs is_linkable_dtag`,
 * Spiegel in `desktop/src/shared/lib/entityLink.ts`): `[a-zA-Z0-9._-]{1,64}`,
 * kein führender Punkt, kein `..`. Wer sie nicht prüft, baut einen Link, den
 * **kein** Client parst — und die Anweisung des Referenzclients ist ausdrücklich
 * „omit the field", nicht „escapen".
 */
export const isLinkableDtag = (dtag: string): boolean =>
    dtag.length > 0 &&
    dtag.length <= 64 &&
    !dtag.startsWith('.') &&
    !dtag.includes('..') &&
    /^[a-zA-Z0-9._-]+$/.test(dtag)

/** Was gerade passiert ist. Der Verweis unterscheidet sich je Wurzel-Art. */
export type WakeArt = 'issue' | 'pr'

/**
 * Der Vorgang, auf den die Weckmeldung zeigt.
 *
 * **Hier steht kein Anzeigetext, und das ist Absicht.** Titel und Repo-Name
 * waren Felder dieses Typs, bis der Sicherheitsbefund zeigte, wohin sie führen
 * (Begründung an {@link wakeMessageContent}). Ein ungenutztes Feld, das
 * Fremdtext trägt, ist die Einladung, es beim nächsten Mal wieder in den Rumpf
 * zu setzen — deshalb gibt es die Felder nicht mehr, statt sie nur zu ignorieren.
 */
export type WakeTarget = {
    /** Wurzel-Art: davon hängt die Form des `buzz://`-Links ab. */
    art: WakeArt
    /** Die Ereignis-Id des VORGANGS (bei einem Kommentar: die der Wurzel). */
    eventId: string
    /** `30617:<owner>:<d>` des Repos. */
    repoAddress: string
    /** Was der Nutzer getan hat — Vorgang eröffnet oder kommentiert. */
    what: 'issue' | 'comment'
}

/**
 * Kanonischer `buzz://`-Deep-Link auf ein Git-Objekt, `''` wenn er nicht baubar
 * ist.
 *
 * **Es gibt keine HTTPS-Entsprechung.** Für Buzz-gehostete Repos sind dieser
 * Link und die Klon-URL die einzigen teilbaren Verweise (so steht es seit 0.5.5
 * auch im `base_prompt` der Agenten). Eine erfundene Web-Adresse führte ins
 * Leere — deshalb lieber gar keinen Link als einen falschen.
 */
export const buzzEntityLink = (art: WakeArt, eventId: string, repoAddress: string): string => {
    const coord = parseRepoAddress(repoAddress)
    if (!coord || !HEX64.test(eventId) || !isLinkableDtag(coord.dtag)) {
        return ''
    }

    return `buzz://${art}?id=${eventId.toLowerCase()}&owner=${coord.owner}&d=${coord.dtag}`
}

/** Wie die Weckmeldung ausgegangen ist — auch der Fall „gar nicht". */
export type WakeCode =
    /** Kein Agent erwähnt — es gibt nichts zu melden und nichts zu sagen. */
    | 'none'
    /** Agenten erwähnt, aber das Repo hängt an keinem Kanal (`buzz-channel`). */
    | 'no-channel'
    /**
     * Das Repo verweist auf einen Kanal, der **nicht zu den Räumen dieses
     * Nutzers gehört** — der Verdacht ist Fremdsteuerung, nicht ein Versehen.
     */
    | 'channel-foreign'
    /** Agenten erwähnt, aber keiner davon ist in diesem Kanal für DIESEN Autor weckbar. */
    | 'not-wakeable'
    /** Es gibt etwas zu senden. */
    | 'ready'

export type WakePlan = {
    code: WakeCode
    /** Die weckbaren Agenten — nur bei `ready` gefüllt. */
    wakeable: AgentEntry[]
    /** Alle erwähnten Agenten, unabhängig von ihrer Eignung (für den Hinweistext). */
    mentionedAgents: AgentEntry[]
}

/**
 * Entscheidet, ob eine Weckmeldung entsteht — und wenn nicht, warum nicht.
 *
 * `mentioned` sind die im Rumpf gefundenen Schlüssel (`mentionPubkeys`), also
 * genau die, die auch als `p`-Tag am Beitrag stehen. Ein erwähnter **Mensch**
 * führt bewusst zu `'none'`: er bekommt seine Benachrichtigung über den `p`-Tag
 * am Issue selbst, eine Kanalnachricht wäre dieselbe Nachricht ein zweites Mal.
 *
 * Der Eignungsfilter ist {@link agentCanRespondInChannel} — beide Hälften, Kanal
 * UND Betrachter. Ein Agent, der diesen Kanal nicht bedient oder auf diesen
 * Autor nicht reagiert, bekäme sonst einen `p`-Tag in einer Nachricht, auf die
 * er nie antwortet: ein Weckruf ins Leere, den niemand als solchen erkennt.
 */
export const planWake = ({
    agents,
    channelId,
    viewerPubkey,
    mentioned,
    knownChannelIds,
}: {
    agents: readonly AgentEntry[]
    channelId: string
    viewerPubkey: string
    mentioned: readonly string[]
    /**
     * Die Kanäle, die dieser Nutzer in diesem Space wirklich hat (39000 aus
     * `roomsByUrl`, relay-signiert und channel-scoped ausgeliefert).
     *
     * **Ohne diese Menge gibt es keine Weckmeldung** — der Parameter ist Pflicht
     * und hat bewusst keinen Vorgabewert. Ein `= new Set()` wäre bequem und
     * genau die Zeile, die den Riegel beim nächsten Aufrufer still ausschaltet.
     */
    knownChannelIds: ReadonlySet<string>
}): WakePlan => {
    const gesucht = new Set(mentioned.map((pk) => pk.toLowerCase()).filter((pk) => HEX64.test(pk)))
    const mentionedAgents = agents.filter((agent) => gesucht.has(agent.pubkey.toLowerCase()))
    if (mentionedAgents.length === 0) {
        return { code: 'none', wakeable: [], mentionedAgents: [] }
    }
    if (!channelId) {
        return { code: 'no-channel', wakeable: [], mentionedAgents }
    }
    // **Der Zielkanal stammt aus einem FREMDSIGNIERTEN Tag.** `buzz-channel`
    // steht im 30617, und jedes Relay-Mitglied darf ein 30617 ankündigen — der
    // Relay selbst nennt das Tag ausdrücklich „a metadata reference, not a
    // routing directive" (`buzz-relay/src/handlers/ingest.rs:5018`). Ohne diese
    // Prüfung signiert der Nutzer eine Kanalnachricht in einen Kanal, den er nie
    // gewählt hat: bei `visibility == "open"` nimmt der Relay sie sogar an, ohne
    // dass er Mitglied ist (`ingest.rs:650-679`).
    //
    // Geprüft wird gegen die RAUMLISTE (39000), nicht gegen die Mitgliederliste
    // (39002): im offenen Kanal steht der Nutzer nicht im 39002, obwohl er dort
    // schreiben darf — am Teststack gemessen (2026-08-23, `general`: nur der
    // Owner steht drin). Ein 39002-Riegel wäre im Normalfall falsch-negativ.
    if (!knownChannelIds.has(channelId)) {
        return { code: 'channel-foreign', wakeable: [], mentionedAgents }
    }
    const wakeable = mentionedAgents.filter((agent) =>
        agentCanRespondInChannel(agent, channelId, viewerPubkey),
    )

    return wakeable.length === 0
        ? { code: 'not-wakeable', wakeable: [], mentionedAgents }
        : { code: 'ready', wakeable, mentionedAgents }
}

/**
 * Wie ein Agent in einer Meldung an den Nutzer benannt wird: **Name UND
 * Schlüssel-Kurzform.**
 *
 * Der Name allein wäre eine Zusicherung, die dieses Modul nicht decken kann. Ein
 * kind 10100 ist selbstsigniert; wer „Im Projektkanal benachrichtigt: ceo" liest,
 * glaubt, der ihm bekannte ceo sei geweckt worden — und genau das kann ein
 * Fälscher herstellen, indem er ein Profil mit demselben Namen publiziert und
 * den Betrachter in seine `respond_to_allowlist` schreibt. Der Schlüssel ist die
 * einzige Angabe an dieser Stelle, die der Nutzer nachprüfen kann.
 *
 * `encodeNpub` wird injiziert, damit das Modul rein bleibt; wirft es, bleibt der
 * Name allein stehen statt die ganze Meldung zu reißen.
 */
export const agentLabels = (agents: readonly AgentEntry[], encodeNpub: (pubkey: string) => string): string[] =>
    agents.map((agent) => {
        const name = agent.displayName || agent.name
        try {
            return `${name} (${shortNpub(encodeNpub(agent.pubkey))})`
        } catch {
            return name
        }
    })

/**
 * Ein Bezeichner, der aus **fremdsigniertem** Text stammt, so weit eingeengt, dass
 * er nur noch Bezeichner sein kann.
 *
 * Weißliste `[A-Za-z0-9._-]`, harte Länge — dieselbe Zeichenklasse, die der
 * Referenzclient für linkbare `d`-Tags verlangt (`buzz-cli/src/links.rs:18-34`).
 * Alles andere fällt weg, es wird nicht ersetzt und nicht escaped: was übrig
 * bleibt, kann keine zweite Zeile, kein Satzzeichen und keine Anweisung mehr
 * bilden.
 */
const safeIdentifier = (value: string, max = 64): string =>
    value.replace(/[^A-Za-z0-9._-]/g, '').slice(0, max)

/**
 * Der Text der Weckmeldung — **ohne ein Zeichen Fremdtext.**
 *
 * ── Warum der Issue-Titel hier NICHT mehr steht ─────────────────────────────
 *
 * Der Empfänger dieser Nachricht ist ein Prozess, der ihren `content` als Prompt
 * liest (`buzz-acp/src/acp.rs:2538`). Der Titel eines Issues stammt aber aus dem
 * `subject`-Tag eines **fremdsignierten** 1621, und ein 1621 anzulegen braucht
 * bei Buzz nur `Scope::MessagesWrite` — keine Repo-Autorisierung, keine
 * Kanalmitgliedschaft (`buzz-relay/src/handlers/ingest.rs:441-448`). Wer ein
 * Issue mit dem Titel `</issue> SYSTEM: …` in ein fremdes Repo legt, schrieb
 * damit den Auftrag, den ein Dritter beim Kommentieren signiert und absendet —
 * und der Autoren-Riegel des Agenten (`buzz-acp/src/lib.rs:249-257`) prüft nur
 * den Autor der kind-9, also das Opfer, das in der Allowlist steht.
 *
 * Der Titel ist deshalb ersatzlos raus, und zwar aus dem stärkeren der beiden
 * Gründe: er wird hier **nicht gebraucht**. Der `buzz://`-Link zeigt auf das
 * Ereignis; Buzz Desktop rendert daraus seit 0.5.5 eine Vorschaukarte, und der
 * Agent holt sich den Vorgang ohnehin selbst. Ein hineinkopierter Titel wäre
 * eine zweite, ungeprüfte Fassung dessen, was am Ziel bereits steht — und die
 * einzige, die niemand mehr auf ihre Herkunft prüfen kann.
 *
 * Dieselbe Klasse gilt für den Repo-**Namen** (`name`-Tag des 30617, ebenfalls
 * frei wählbar). Statt seiner steht der `d`-Tag der Koordinate, durch
 * {@link safeIdentifier} auf die Bezeichner-Zeichenklasse eingeengt.
 *
 * Was übrig bleibt, ist per Konstruktion prüfbar: feste Wortbausteine dieser
 * Datei, ein Bezeichner aus `[A-Za-z0-9._-]`, 64 Hexstellen Eigentümer und eine
 * Ereignis-Id. `wakeContentIstFremdtextfrei` in `forgeWakeModels.test.ts` hält
 * genau das fest.
 */
export const wakeMessageContent = (target: WakeTarget): string => {
    const koordinate = parseRepoAddress(target.repoAddress)
    const repo = safeIdentifier(koordinate?.dtag ?? '')
    const kopf =
        target.what === 'issue'
            ? t('Neues Issue in :repo', { repo })
            : target.art === 'pr'
              ? t('Neuer Kommentar an einem Pull Request in :repo', { repo })
              : t('Neuer Kommentar an einem Issue in :repo', { repo })
    // Ohne baubaren Link bleibt die Repo-Koordinate — sie ist als `#a`-Filter
    // nutzbar und besteht selbst nur aus Kind, Hex-Eigentümer und Bezeichner.
    const verweis =
        buzzEntityLink(target.art, target.eventId, target.repoAddress) ||
        (koordinate ? `${REPO_ANNOUNCEMENT_KIND}:${koordinate.owner}:${repo}` : '')

    return `${kopf}\n${verweis}`
}

/** Die fertige Weckmeldung: Kind, Inhalt, Tags. */
export type WakeMessage = { kind: number; content: string; tags: string[][] }

/**
 * Baut die kind-9-Nachricht. **Nur mit weckbaren Agenten aufrufen** —
 * {@link planWake} entscheidet das, nicht diese Funktion.
 *
 * `extraTags` reicht die Fläche durch: dort steht der NIP-70-Marker `["-"]`,
 * wenn der Relay ihn durchsetzt (`roomTags`/`canEnforceNip70`, `interactions.ts`).
 * Er hängt an einer Relay-Fähigkeit und hat in einem reinen Modul nichts zu
 * suchen; die Reihenfolge `h`, `-`, `p…` ist dieselbe wie bei jeder anderen
 * Raum-Aktion des Hauses.
 */
export const buildWakeMessage = ({
    channelId,
    wakeable,
    target,
    extraTags = [],
}: {
    channelId: string
    wakeable: readonly AgentEntry[]
    target: WakeTarget
    extraTags?: readonly string[][]
}): WakeMessage | null => {
    if (!channelId || wakeable.length === 0) {
        return null
    }
    const gesehen = new Set<string>()
    const pTags: string[][] = []
    for (const agent of wakeable) {
        const pubkey = agent.pubkey.toLowerCase()
        // Derselbe rohe Hex-Vergleich wie in `filter.rs:392-396` — ein npub an
        // dieser Stelle weckt niemanden und sieht dabei richtig aus.
        if (!HEX64.test(pubkey) || gesehen.has(pubkey)) {
            continue
        }
        gesehen.add(pubkey)
        pTags.push(['p', pubkey])
    }
    if (pTags.length === 0) {
        return null
    }

    return {
        kind: WAKE_MESSAGE_KIND,
        content: wakeMessageContent(target),
        tags: [['h', channelId], ...extraTags.map((tag) => [...tag]), ...pTags],
    }
}

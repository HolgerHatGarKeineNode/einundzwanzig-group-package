/**
 * Blossom-Upload für Chat-Anhänge (PLAN5 C6a). Der Blob (bereits vom Cropper
 * zugeschnitten + als WebP komprimiert, siehe bridge.ts) wird hash-basiert auf
 * einen Blossom-Server geladen (BUD-Spec: `Authorization`-Event kind 24242,
 * im Browser signiert — der Server sieht nie den Key). Ergebnis: URL + NIP-92
 * `imeta`-Tag, das `sendRoomMessage` an die kind-9-Nachricht hängt.
 *
 * Server-Wahl wie beim Referenz-Client: erster Eintrag der `userBlossomServerList`
 * (kind 10063) des Nutzers, sonst der Default. Render steht bereits (`renderMessageLink`
 * macht Bild-URLs zu `<img>`), deshalb muss die URL eine Bild-Endung tragen.
 */
import { BLOSSOM_SERVERS, getListTags, getTagValues, makeBlossomAuthEvent, uploadBlob } from '@welshman/util'
import { signer, pubkey, userBlossomServerList } from '@welshman/app'
import { load } from '@welshman/net'
import { parseJson, sha256 } from '@welshman/lib'
import { get } from 'svelte/store'
import { DEFAULT_RELAYS } from './core'

/** Fallback, wenn der Nutzer keine eigene Blossom-Server-Liste (kind 10063) hat. */
export const DEFAULT_BLOSSOM_SERVER = 'https://blossom.band'

/**
 * Normalisiert eine Server-URL auf ihren http(s)-Ursprung (+Pfad, Trailing-Slash weg).
 * Wirft bei ungültiger oder nicht-http(s)-URL — so kann eine manipulierte kind-10063-
 * Liste keinen fremden Scheme-Wert (z. B. `javascript:`) einschleusen.
 */
const normalizeServer = (raw: string): string => {
    const u = new URL(raw)
    if (u.protocol !== 'https:' && u.protocol !== 'http:') {
        throw new Error('kein http(s)-Server')
    }
    return `${u.protocol}//${u.host}${u.pathname}`.replace(/\/+$/, '')
}

/**
 * Alle im Profil (kind 10063, `server`-Tags) konfigurierten Blossom-Server, normalisiert;
 * ungültige Einträge fallen still raus. LIEST nur den aktuellen Repository-Stand — die
 * Liste muss vorher geladen sein (`ensureBlossomServersLoaded`), sonst ist sie leer.
 */
export const userBlossomServers = (): string[] => {
    const normalized = getTagValues('server', getListTags(get(userBlossomServerList)))
        .map((u) => {
            try {
                return normalizeServer(u)
            } catch {
                return null
            }
        })
        .filter((u): u is string => u !== null)
    // Dedupe: doppelte/aliasgleiche Einträge (z. B. mit/ohne Trailing-Slash) kollidierten
    // sonst als `x-for :key` in der Settings-Liste.
    return [...new Set(normalized)]
}

/**
 * Lädt die kind-10063-Liste des Nutzers in den Repository-Store — EXPLIZIT von
 * `DEFAULT_RELAYS` (wie die Relay-Liste in der Settings-Insel), NICHT über welshmans
 * Outbox-Loader: der braucht die (auf einem harten Reload noch nicht geladene) Relay-
 * Auswahl des Nutzers und fand die Liste sonst erst nach einem Seitenwechsel.
 * MUSS vor `resolveBlossomServer`/`userBlossomServers` awaited werden — `userBlossomServerList`
 * gibt synchron nur den JETZIGEN Stand zurück, sonst greift der Fallback trotz Profil-Server.
 */
const blossomLoadedFor = new Set<string>()
export const ensureBlossomServersLoaded = async (): Promise<void> => {
    const pk = pubkey.get()
    if (!pk || blossomLoadedFor.has(pk)) {
        return
    }
    // Einmal pro Sitzung & Pubkey holen (kein Refetch bei jedem Upload). Erst NACH Erfolg
    // markieren — scheitert der Load, wird beim nächsten Mal erneut versucht.
    await load({ filters: [{ kinds: [BLOSSOM_SERVERS], authors: [pk] }], relays: DEFAULT_RELAYS })
    blossomLoadedFor.add(pk)
}

/** Erster Blossom-Server des Nutzers (kind 10063) oder der Default (immer gültig). */
export const resolveBlossomServer = (): string => userBlossomServers()[0] ?? normalizeServer(DEFAULT_BLOSSOM_SERVER)

export type Attachment = { url: string; imetaTag: string[] }

/**
 * Baut URL + NIP-92-`imeta`-Tag aus dem Blossom-Ergebnis. Rein (kein Netzwerk/Store) →
 * als JS-Unit testbar. Die Server-URL ist **untrusted** (Antwort des konfigurierten
 * Servers): `new URL(...).href` normalisiert sie (entfernt eingeschleuste Whitespace/
 * Newlines, die sonst als Fremdtext in den publizierten Nachrichten-Content lecken
 * würden) und `protocol` wird auf http(s) beschränkt. Fehlt dem LETZTEN Pfad-Segment
 * die Bild-Endung, wird sie aus dem MIME ergänzt (sonst erkennt `renderMessageLink`
 * das Bild nicht) — vor dem Query, nicht am rohen String. `dim` (BxH) nur, wenn bekannt.
 */
export const buildAttachment = (rawUrl: string, mime: string, hash: string, dim?: string): Attachment => {
    const u = new URL(rawUrl)
    if (u.protocol !== 'https:' && u.protocol !== 'http:') {
        throw new Error('Ungültige Upload-URL vom Server')
    }
    const lastSegment = u.pathname.split('/').pop() ?? ''
    if (!lastSegment.includes('.')) {
        u.pathname = u.pathname.replace(/\/+$/, '') + '.' + (mime.split('/')[1] || 'webp')
    }
    const url = u.href
    const imetaTag = ['imeta', `url ${url}`, `m ${mime}`, `x ${hash}`]
    if (dim) {
        imetaTag.push(`dim ${dim}`)
    }
    return { url, imetaTag }
}

/**
 * Lädt einen Bild-Blob auf den Blossom-Server und gibt URL + `imeta`-Tag zurück.
 * Wirft mit der Server-/Netzwerkmeldung bei Fehlschlag (bridge zeigt sie als Toast).
 * `dim` = BxH des zugeschnittenen Canvas (für NIP-92, optional).
 */
export const uploadAttachment = async (blob: Blob, dim?: string): Promise<Attachment> => {
    const activeSigner = signer.get()
    if (!activeSigner) {
        throw new Error('Kein aktiver Signer — bitte anmelden.')
    }
    // Profil-Blossom-Liste (kind 10063) laden, BEVOR wir den Server wählen — sonst greift
    // beim ersten Upload der Fallback, obwohl der Nutzer einen eigenen Server konfiguriert hat.
    // Best-effort: scheitert der Load (Netz), fällt resolveBlossomServer auf den Default —
    // der Upload soll daran nicht sterben.
    await ensureBlossomServersLoaded().catch(() => {})
    const server = resolveBlossomServer()
    const hash = await sha256(await blob.arrayBuffer())
    const authEvent = await activeSigner.sign(makeBlossomAuthEvent({ action: 'upload', server, hashes: [hash] }))
    const res = await uploadBlob(server, blob, { authEvent })
    const text = await res.text()
    const task = parseJson<{ url?: string }>(text)
    if (!task?.url) {
        throw new Error(text || `Upload fehlgeschlagen (HTTP ${res.status})`)
    }
    return buildAttachment(task.url, blob.type, hash, dim)
}

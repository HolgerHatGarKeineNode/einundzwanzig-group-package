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
import { getListTags, getTagValues, makeBlossomAuthEvent, uploadBlob } from '@welshman/util'
import { signer, userBlossomServerList } from '@welshman/app'
import { first, parseJson, sha256 } from '@welshman/lib'
import { get } from 'svelte/store'

/** Fallback, wenn der Nutzer keine eigene Blossom-Server-Liste (kind 10063) hat. */
const DEFAULT_BLOSSOM_SERVER = 'https://blossom.band'

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

/** Erster Blossom-Server des Nutzers (kind 10063) oder der Default (immer gültig). */
export const resolveBlossomServer = (): string => {
    const candidate = first(getTagValues('server', getListTags(get(userBlossomServerList))))
    try {
        return normalizeServer(candidate ?? DEFAULT_BLOSSOM_SERVER)
    } catch {
        return normalizeServer(DEFAULT_BLOSSOM_SERVER)
    }
}

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

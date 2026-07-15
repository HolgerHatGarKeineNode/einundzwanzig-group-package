/**
 * Blossom-Upload für Chat-Anhänge (PLAN5 C6a). Der Blob (bereits vom Cropper
 * zugeschnitten + als WebP komprimiert, siehe bridge.ts) wird hash-basiert auf
 * einen Blossom-Server geladen (BUD-Spec: `Authorization`-Event kind 24242,
 * im Browser signiert — der Server sieht nie den Key). Ergebnis: URL + NIP-92
 * `imeta`-Tag, das `sendRoomMessage` an die kind-9-Nachricht hängt.
 *
 * Server-Wahl: fix auf den Vereins-Blossom. Alle Nutzer sind Vereinsmitglieder und
 * dürfen dort hochladen — die kind-10063-Auflösung (Profil-Serverliste) ist deshalb
 * vorerst raus. Render steht bereits (`renderMessageLink` macht Bild-URLs zu `<img>`),
 * deshalb muss die URL eine Bild-Endung tragen.
 */
import { makeBlossomAuthEvent, uploadBlob } from '@welshman/util'
import { signer } from '@welshman/app'
import { parseJson, sha256 } from '@welshman/lib'

// ponytail: fixer Server statt kind-10063-Auflösung; Profil-Serverliste wieder einbauen,
// wenn Nutzer außerhalb des Vereins-Blossom hochladen sollen (git log hat die alte Logik).
export const BLOSSOM_SERVER = 'https://blossom.einundzwanzig.space'

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
    const server = BLOSSOM_SERVER
    const host = new URL(server).host
    const hash = await sha256(await blob.arrayBuffer())
    const authEvent = await activeSigner.sign(makeBlossomAuthEvent({ action: 'upload', server, hashes: [hash] }))

    // `uploadBlob` ist ein nacktes `fetch` (welshman): Netzfehler → TypeError ("Failed to fetch",
    // NIE beim Server angekommen); HTTP-Fehler → Response mit res.ok=false, Grund im `X-Reason`-
    // Header (Blossom BUD-06, Body oft leer). Beides so aufbereiten, dass der Toast dem Nutzer den
    // Server nennt und WOHER der Fehler stammt (Netz vs. Server-Ablehnung).
    let res: Response
    try {
        res = await uploadBlob(server, blob, { authEvent })
    } catch {
        throw new Error(`Blossom-Server ${host} nicht erreichbar (Netzwerkfehler) — bitte erneut versuchen.`)
    }
    const text = await res.text()
    if (!res.ok) {
        const reason = res.headers.get('X-Reason') || text.trim()
        throw new Error(`${host} lehnte den Upload ab (HTTP ${res.status}${reason ? `: ${reason}` : ''}).`)
    }
    const task = parseJson<{ url?: string }>(text)
    if (!task?.url) {
        throw new Error(`${host} lieferte keine Upload-URL${text.trim() ? `: ${text.trim()}` : ''}.`)
    }
    return buildAttachment(task.url, blob.type, hash, dim)
}

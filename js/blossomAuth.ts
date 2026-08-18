/**
 * Blossom-Leseauth (BUD-11, kind 24242) — die **Form** des Auth-Events, pur und ohne
 * Netz prüfbar. Wer signiert, holt und zwischenspeichert, steht in `blossomMedia.ts`.
 *
 * ── Warum es das überhaupt gibt ──
 *
 * Buzz verlangt seit `block/buzz#4610` für JEDES `GET /media/…` ein signiertes
 * Blossom-Event; ein `<img src>` kann keinen `Authorization`-Header mitschicken. Die
 * kind-0-Profile des Workspace tragen ihre Bilder aber genau dort. Der Ausweg ist ein
 * `fetch` mit Header und eine `blob:`-URL für das `<img>` — mit dem Schlüssel des
 * ANGEMELDETEN NUTZERS. Die serverseitige Variante (unser Bild-Proxy signiert mit
 * einem Member-Key) ist ausdrücklich verworfen: sie machte den öffentlichen Proxy zum
 * Orakel, das jedem mit dem Blob-Hash private Relay-Medien ausliefert.
 *
 * ── Alles hier ist gemessen, nicht aus der Spec gelesen ──
 *
 * Am 2026-08-19 gegen `https://buzz.einundzwanzig.space/media/<sha>.jpg`:
 *
 * | Auth-Event | Antwort |
 * |---|---|
 * | `t=get`, `server=https://buzz.einundzwanzig.space`, Blob A | **200**, 46112 B |
 * | dasselbe Event, Blob **B** | **200**, 45689 B |
 * | `server=buzz.einundzwanzig.space` (ohne Schema) | 200 |
 * | `server=https://buzz.einundzwanzig.space/` (Slash) | 200 |
 * | `x=<sha von Blob A>` auf Blob **B** | 403 |
 * | ohne `t`-Tag | 401 |
 * | leerer `content` | 401 |
 * | `created_at` −50 min, `expiration` +10 min | 200 |
 * | `created_at` −2 h, `expiration` +1 h | **401** |
 * | `expiration` in der Vergangenheit | **401** |
 *
 * Daraus folgt die ganze Bauform: **ein** Event mit `server`-Tag deckt **alle** Blobs
 * eines Hosts ab (Zeile 1+2) — deshalb wird pro Origin einmal signiert und nicht pro
 * Bild. Ein `x`-Tag täte das Gegenteil (Zeile 5) und kostete bei NIP-46 zehn
 * Bestätigungen für eine Avatar-Zeile. Und die Wiederverwendung hat ZWEI Grenzen,
 * nicht eine: das `expiration` **und** ein `created_at`, das nicht älter als eine
 * Stunde sein darf. {@link AUTH_REUSE_SECONDS} liegt unter beiden.
 */
import { encodeNip98Header, httpBase, type SignedLike, type SignFn } from './nip98.ts'

export type { SignedLike, SignFn }

/** Blossom-Auth (BUD-11). */
export const BLOSSOM_AUTH_KIND = 24242

/** Gültigkeitsdauer, die wir ins Event schreiben. */
export const AUTH_TTL_SECONDS = 3600

/**
 * So lange wird EIN Auth-Event wiederverwendet.
 *
 * 45 Minuten, mit Absicht deutlich unter beiden gemessenen Grenzen (60 min
 * `created_at`-Alter, 60 min `expiration`): ein Event, das während des Fluges abläuft,
 * kostet ein 401 und damit ein Bild, das der Nutzer nie wiederbekommt.
 */
export const AUTH_REUSE_SECONDS = 2700

/**
 * `ws(s)://host/…` oder `http(s)://host/…` → `https://host` (nur Schema+Host).
 *
 * Der `server`-Tag wird gegen den gebundenen Tenant-Host geprüft; ein Pfad im
 * Relay-URL hätte dort nichts zu suchen. Leerer String, wenn sich nichts parsen lässt —
 * der Aufrufer entscheidet dann „nicht geschützt" statt zu raten.
 */
export const mediaOriginOf = (url: string): string => {
    try {
        return new URL(httpBase(url)).origin
    } catch {
        return ''
    }
}

/**
 * Das Auth-Event für **einen Host** (nicht für ein Bild).
 *
 * `content` ist bewusst nicht leer: ein leerer Inhalt wird mit 401 abgewiesen
 * (gemessen). `created_at` kommt herein statt aus der Uhr — sonst wäre die Form nur
 * mit Zeitmanipulation prüfbar.
 */
export const makeBlossomAuthTemplate = (origin: string, createdAt: number, ttl = AUTH_TTL_SECONDS) => ({
    kind: BLOSSOM_AUTH_KIND,
    created_at: createdAt,
    content: `Medien lesen (${origin})`,
    tags: [
        ['t', 'get'],
        ['server', origin],
        ['expiration', String(createdAt + ttl)],
    ],
})

/**
 * Darf dieses Auth-Event JETZT noch einmal benutzt werden?
 *
 * Beide gemessenen Grenzen, nicht nur die naheliegende: `expiration` in der Zukunft
 * UND `created_at` jünger als {@link AUTH_REUSE_SECONDS}. Wer nur auf `expiration`
 * schaut, baut sich ein Event, das der Server wegen seines Alters ablehnt.
 */
export const isAuthEventUsable = (event: SignedLike | undefined, now: number): boolean => {
    if (!event || event.kind !== BLOSSOM_AUTH_KIND) {
        return false
    }
    const expiration = Number(event.tags.find((tag) => tag[0] === 'expiration')?.[1] ?? 0)
    return expiration > now && event.created_at + AUTH_REUSE_SECONDS > now
}

/**
 * Der fertige `Authorization`-Wert: `Nostr <base64(event-json)>`.
 *
 * Dieselbe Hülle wie NIP-98 (nur ein anderer Kind im Event), deshalb dieselbe
 * Kodierfunktion statt einer zweiten Kopie — inklusive ihrer UTF-8-Härtung gegen
 * `btoa`, das bei Zeichen > U+00FF wirft.
 */
export const blossomAuthHeader = (event: SignedLike): string => encodeNip98Header(event)

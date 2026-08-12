/**
 * NIP-98 (HTTP Auth, kind 27235) — signierte `Authorization: Nostr <base64>`-Header
 * für HTTP-Aufrufe aus dem Client.
 *
 * Gebraucht wird das von Buzz' Moderations-Routen (`GET /moderation/reports`,
 * `/moderation/audit`, `/moderation/restricted`), die alle über
 * `authorize_moderation_read` laufen. Ohne Header antwortet der Relay
 * `401 {"error":"missing Nostr auth"}` — am laufenden buzz-test-Stack gemessen.
 *
 * **Bewusst welshman-frei.** Das Modul kennt keinen Signer und keinen Store; es
 * bekommt eine `sign`-Funktion herein. Damit ist die ganze Header-Konstruktion
 * ohne Browser- und ohne Store-Runtime testbar (`nip98.test.ts`) — und das
 * eigentliche Signieren bleibt dort, wo es hingehört: beim welshman-Signer
 * (NIP-07/NIP-46), der Key verlässt den Browser nicht.
 *
 * ── Drei Eigenschaften, die am Buzz-Quelltext geprüft und am laufenden Relay
 *    gemessen wurden (`crates/buzz-auth/src/nip98.rs`) ──
 *
 * 1. **Die Signatur deckt den vollständigen URL inklusive Query-String.**
 *    `verify_nip98_event` vergleicht den `u`-Tag mit dem vom Server aus
 *    `path + "?" + raw_query` zusammengesetzten URL (`bridge.rs:2065-2069`);
 *    verglichen wird nach `Url::parse` — nur ein trailing `/` im Pfad fällt weg,
 *    die Query bleibt zeichengenau erhalten. Gegenprobe am laufenden Relay:
 *    `u` ohne Query + Fetch mit Query →
 *    `401 NIP-98: … URL mismatch: event has '…/moderation/reports', expected
 *    '…/moderation/reports?status=open&limit=50'`.
 *    Deshalb baut [[nip98Url]] den URL **einmal** und derselbe String geht in den
 *    `u`-Tag UND in `fetch()`. Es wird nie ein zweites Mal serialisiert.
 *
 * 2. **`created_at` muss innerhalb ±60 s liegen** (`TIMESTAMP_TOLERANCE_SECS`,
 *    `nip98.rs:77-85`). Der Header wird deshalb pro Request frisch gebaut, nie
 *    gecacht.
 *
 * 3. **Jede Event-id darf nur EINMAL benutzt werden.** Buzz führt einen
 *    Replay-Guard (`check_nip98_replay`, `bridge.rs:136-176`) — eine zweite
 *    Anfrage mit derselben Event-id bekommt `401 NIP-98: replay detected`.
 *    `created_at` hat nur Sekundenauflösung, zwei Abrufe derselben URL innerhalb
 *    einer Sekunde ergäben also ein identisches Event. Darum trägt jedes
 *    Auth-Event einen zufälligen `nonce`-Tag — er ändert nichts an der Prüfung
 *    (Buzz liest nur `u`, `method`, `payload`), macht die id aber eindeutig.
 *    Ohne ihn wäre die Melde-Queue bei zwei schnellen Klicks unbenutzbar.
 */

/** NIP-98: HTTP Auth (NIP-98). */
export const HTTP_AUTH_KIND = 27235

/** Ein signiertes Nostr-Event, so weit dieses Modul es kennen muss. */
export type SignedLike = {
    kind: number
    created_at: number
    tags: string[][]
    content: string
    pubkey: string
    id: string
    sig: string
}

/** Nur der Teil des welshman-Signers, den NIP-98 braucht. */
export type SignFn = (event: { kind: number; created_at: number; tags: string[][]; content: string }) => Promise<SignedLike>

/**
 * `ws(s)://host/pfad` → `http(s)://host` (ohne trailing Slashes). Buzz' Moderations-
 * Routen liegen auf demselben Host wie der WebSocket, und der Relay leitet den
 * erwarteten NIP-98-URL aus dem **Host-Header** plus dem Schema seiner
 * `RELAY_URL`-Konfiguration ab (`nip98_expected_url`, `bridge.rs:195-206`):
 * `ws://` → `http`, `wss://` → `https`. Genau diese Abbildung bildet die Funktion
 * nach — dadurch stimmt der signierte URL mit dem überein, den der Server erwartet.
 */
export const httpBase = (relayUrl: string): string => relayUrl.replace(/^ws/, 'http').replace(/\/+$/, '')

/**
 * Baut den URL, der signiert UND abgerufen wird — **eine** Quelle für beides.
 * Query-Parameter mit leerem/undefiniertem Wert fallen raus, der Rest wird von
 * `URLSearchParams` in Einfügereihenfolge serialisiert. Wer diesen String später
 * noch einmal umbaut (Parameter sortiert, neu encodiert), zerstört die Signatur.
 */
export const nip98Url = (relayUrl: string, path: string, query: Record<string, string | number | undefined> = {}): string => {
    const params = new URLSearchParams()
    for (const [key, value] of Object.entries(query)) {
        if (value !== undefined && value !== '') {
            params.set(key, String(value))
        }
    }
    const qs = params.toString()
    return `${httpBase(relayUrl)}${path}${qs ? `?${qs}` : ''}`
}

/** Zufälliger 16-Byte-Hex-Wert — macht die Auth-Event-id eindeutig (siehe Punkt 3 oben). */
const randomNonce = (): string => {
    const bytes = new Uint8Array(16)
    crypto.getRandomValues(bytes)
    return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

/**
 * sha256 als Kleinbuchstaben-Hex über die UTF-8-Bytes von `text` — der Wert des
 * `payload`-Tags (NIP-98).
 *
 * Bewusst über `crypto.subtle` und nicht über `sha256` aus `@welshman/lib`: das
 * Modul ist welshman-frei (siehe Kopf), und `crypto.subtle` gibt es sowohl im
 * Browser als auch unter `node --test` — sonst wäre der `payload`-Zweig genau
 * der Teil, der nicht ohne Browser-Runtime prüfbar ist.
 */
export const sha256Hex = async (text: string): Promise<string> => {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
    return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('')
}

/**
 * Das unsignierte NIP-98-Event zu (url, method). `content` bleibt leer (NIP-98).
 *
 * `payloadHash` ist der sha256-Hex des **rohen Request-Bodys** und gehört an
 * jeden Aufruf MIT Body. Für Buzz' Moderations-Routen (reine GETs) bleibt er
 * weg; die Vereins-Strecke (`POST /applications`, `POST /payments/…`) braucht
 * ihn zwingend, weil der Verein den Hash gegen die rohen Bytes prüft
 * (einundzwanzig-verein `app/Support/Nip98.php:337-347`) — und unser eigener
 * Proxy davor ebenso (`app/Support/VereinNip98.php`, Schritt 5).
 *
 * **Der Hash muss über GENAU DIE Zeichenkette gebildet werden, die anschließend
 * an `fetch` geht.** Zwei `JSON.stringify`-Aufrufe auf dasselbe Objekt können
 * verschiedene Bytes liefern (Schlüsselreihenfolge, Unicode-Escapes); der Hash
 * passte dann zum einen und der Body zum anderen, und der Verein antwortet mit
 * einem 401, das nach einem Signaturproblem aussieht. Dieselbe Regel wie bei
 * [[nip98Url]] für den `u`-Tag, nur für den Inhalt.
 *
 * `created_at` wird hereingereicht statt hier gezogen, damit der Test ohne
 * Zeitmanipulation prüfen kann.
 */
export const nip98Template = (
    url: string,
    method: string,
    createdAt: number,
    nonce: string = randomNonce(),
    payloadHash?: string,
) => ({
    kind: HTTP_AUTH_KIND,
    created_at: createdAt,
    content: '',
    tags: [
        ['u', url],
        ['method', method.toUpperCase()],
        ['nonce', nonce],
        ...(payloadHash ? [['payload', payloadHash]] : []),
    ],
})

/**
 * Base64 des Event-JSON — der Wert hinter `Authorization: Nostr `.
 *
 * Bewusst über den `TextEncoder` statt `btoa(json)` direkt: `btoa` wirft bei
 * Zeichen > U+00FF. Unsere URLs sind heute ASCII, aber ein Space-Host mit
 * Umlaut-Domain oder ein künftiger Query-Wert wäre es nicht — und der Fehler
 * käme dann als unverständlicher `InvalidCharacterError` mitten im Klickpfad.
 */
export const encodeNip98Header = (event: SignedLike): string => {
    const bytes = new TextEncoder().encode(JSON.stringify(event))
    let binary = ''
    for (const b of bytes) {
        binary += String.fromCharCode(b)
    }
    return `Nostr ${btoa(binary)}`
}

/**
 * Der fertige `Authorization`-Wert für (url, method) — signiert mit `sign`.
 * Der URL muss **derselbe String** sein, der anschliessend an `fetch` geht.
 *
 * `body` ist der ROHE Request-Body als String; ist er gesetzt, trägt das Event
 * einen `payload`-Tag über genau diese Zeichenkette. Auch hier gilt: derselbe
 * String muss an `fetch` gehen, nicht ein zweites Mal serialisiert werden.
 */
export const nip98AuthHeader = async (sign: SignFn, url: string, method = 'GET', body?: string): Promise<string> => {
    const payloadHash = body ? await sha256Hex(body) : undefined

    return encodeNip98Header(
        await sign(nip98Template(url, method, Math.floor(Date.now() / 1000), randomNonce(), payloadHash)),
    )
}

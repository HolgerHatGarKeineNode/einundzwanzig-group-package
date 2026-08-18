/**
 * Die EINE Instanz des Blossom-Ladewegs, mit den echten Abhängigkeiten verdrahtet.
 *
 * Steht getrennt von [[blossomMedia]], damit die Fabrik dort import-arm und unter
 * `node --test` prüfbar bleibt: `sign`/`signer` ziehen `@welshman/app` und damit
 * `localStorage` herein, und die Browser-Seite (`fetch`, `URL.createObjectURL`) gibt
 * es im Testlauf gar nicht.
 *
 * Geschützt ist genau das, was der **Workspace**-Relay selbst ausliefert. Für alles
 * andere ist `needsAuth` falsch und die bestehende Proxy-Kette bleibt unangetastet.
 */
import { pubkey, sign } from '@welshman/app'
import { makeBlossomLoader, type BlossomResponse } from './blossomMedia.ts'
import { isSpaceHostedMedia } from './profileMerge.ts'
import { WORKSPACE_URL } from './spaceCaps.ts'
import type { SignedLike } from './blossomAuth.ts'

export const blossomMedia = makeBlossomLoader({
    isProtected: (url: string) => WORKSPACE_URL !== '' && isSpaceHostedMedia(url, WORKSPACE_URL),
    // Der Pubkey der Sitzung — nicht nur „ist eine da". Er ist der Schlüssel, an dem
    // der Loader einen Nutzerwechsel erkennt und seinen ganzen Zustand wegwirft; ohne
    // Reload wäre er sonst der Bearer des vorigen Nutzers. Dieselbe Quelle, die auch
    // die NIP-42-Policy in `core.ts` als Sitzungsprobe benutzt.
    sessionPubkey: () => pubkey.get() ?? '',
    sign: async (template) => (await sign(template)) as SignedLike,
    fetchMedia: async (url: string, authorization: string): Promise<BlossomResponse> => {
        // `no-store`: die Antwort ist nutzergebunden (Buzz setzt selbst
        // `Cache-Control: private`), und sie liegt danach ohnehin als `blob:` vor.
        //
        // `redirect: 'error'`: eine Umleitung wird zum Fehler, statt ihr zu folgen.
        // Gemessen strippt Chromium den `Authorization`-Header beim Origin-Wechsel —
        // aber das ist eine Eigenschaft der Engine, keine unserer Zusagen. Der Header
        // ist ein 45-Minuten-Lesebearer für den ganzen Medien-Endpunkt; eine
        // Umleitung, der wir folgen, hat hier ohnehin nichts zu suchen (der Blob liegt
        // unter seiner eigenen, unveränderlichen Adresse). Kaputt geht dadurch nichts:
        // die drei gemessenen Produktions-URLs antworten direkt mit 200.
        const response = await fetch(url, { headers: { Authorization: authorization }, cache: 'no-store', redirect: 'error' })
        return { ok: response.ok, status: response.status, blob: () => response.blob() }
    },
    createObjectURL: (blob: unknown) => URL.createObjectURL(blob as Blob),
    revokeObjectURL: (objectUrl: string) => URL.revokeObjectURL(objectUrl),
    now: () => Math.floor(Date.now() / 1000),
})

/**
 * Beim Abmelden alles freigeben — **sofort**, nicht erst beim nächsten Bild.
 *
 * Die tragende Absicherung ist die Sitzungsprüfung IM Loader (`sessionPubkey`): sie
 * greift auch dann, wenn dieser Weg hier ausfällt. Diese Zeile ist der frühe Griff:
 * ein `blob:` bleibt gültig, bis es widerrufen wird, und die Medien gehörten dem
 * vorigen Nutzer. Zwei Wege für dieselbe Zusage, weil der eine (Abmelden → Reload)
 * nachweislich ausfallen kann.
 */
pubkey.subscribe(($pubkey) => {
    if (!$pubkey) {
        blossomMedia.revokeAll()
    }
})

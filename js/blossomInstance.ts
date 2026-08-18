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
import { signer, sign } from '@welshman/app'
import { makeBlossomLoader, type BlossomResponse } from './blossomMedia.ts'
import { isSpaceHostedMedia } from './profileMerge.ts'
import { WORKSPACE_URL } from './spaceCaps.ts'
import type { SignedLike } from './blossomAuth.ts'

export const blossomMedia = makeBlossomLoader({
    isProtected: (url: string) => WORKSPACE_URL !== '' && isSpaceHostedMedia(url, WORKSPACE_URL),
    // `signer.get()` ist die Sitzung: ohne sie liefert `sign()` `undefined`, und wir
    // fragen erst gar nicht. Genau derselbe Test, den die NIP-42-Policy in `core.ts`
    // für AUTH benutzt.
    hasSession: () => Boolean(signer.get()),
    sign: async (template) => (await sign(template)) as SignedLike,
    fetchMedia: async (url: string, authorization: string): Promise<BlossomResponse> => {
        // `no-store`: die Antwort ist nutzergebunden (Buzz setzt selbst
        // `Cache-Control: private`), und sie liegt danach ohnehin als `blob:` vor.
        const response = await fetch(url, { headers: { Authorization: authorization }, cache: 'no-store' })
        return { ok: response.ok, status: response.status, blob: () => response.blob() }
    },
    createObjectURL: (blob: unknown) => URL.createObjectURL(blob as Blob),
    revokeObjectURL: (objectUrl: string) => URL.revokeObjectURL(objectUrl),
    now: () => Math.floor(Date.now() / 1000),
})

/**
 * Beim Abmelden alles freigeben.
 *
 * Zwei Gründe, und der zweite wiegt schwerer als der erste: die `blob:`-URLs belegen
 * Speicher, und sie zeigen auf Medien, die der NÄCHSTE Nutzer dieser Sitzung nicht
 * sehen dürfte — sie wurden mit dem Schlüssel des vorigen geholt. Ein `blob:` bleibt
 * gültig, bis es widerrufen wird; ohne diese Zeile überlebte es den Wechsel.
 */
signer.subscribe(($signer) => {
    if (!$signer) {
        blossomMedia.revokeAll()
    }
})

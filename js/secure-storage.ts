/**
 * Gehärtete Ablage für Client-Secrets (ZAPS.md Z0.3). Das NWC-`secret` ist ein
 * privater Schlüssel und darf NIEMALS im Klartext persistiert werden — deshalb
 * NICHT in die welshman-`sessions`-Map (die schreibt `session.ts` als Klartext
 * nach localStorage). Zwei Backends, nach Plattform gewählt:
 *
 * - **Mobile (NativePHP, lizenziertes SecureStorage-Plugin):** iOS-Keychain /
 *   Android-Keystore (hardware-backed) über die `nativeCall`-Bridge.
 * - **Web (WebCrypto at-rest, Auftraggeber-Wahl 2026-07-10):** AES-GCM; der
 *   Schlüssel wird `extractable:false` erzeugt und als `CryptoKey` in IndexedDB
 *   gehalten (nie exportierbar). Persistiert wird NUR der Ciphertext.
 *
 * ponytail: bewusst eine einzige AES-GCM-Schicht — keine Passphrase/Argon2-Kür.
 * Ehrliche Obergrenze: aktives Same-Origin-XSS ist VOLLKOMPROMITTIERUNG — es kann
 * den App-eigenen Entschlüsselungspfad (loadWallet) aufrufen und das entschlüsselte
 * NWC-Secret als Klartext lesen UND exfiltrieren. `extractable:false` schützt NUR
 * das AES-Schlüsselmaterial (nicht exportierbar), NICHT das entschlüsselte Secret.
 * Der Nutzen ist rein at-rest: kein Klartext auf Platte / in DevTools / localStorage.
 */
import { isMobile, nativeCall } from './core'

const DB_NAME = 'einundzwanzig-secure'
const STORE = 'kv'
const KEY_ID = '__aeskey__'

const enc = new TextEncoder()
const dec = new TextDecoder()

function openDb(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, 1)
        req.onupgradeneeded = () => req.result.createObjectStore(STORE)
        req.onsuccess = () => resolve(req.result)
        req.onerror = () => reject(req.error)
    })
}

function idbGet<T>(key: string): Promise<T | undefined> {
    return openDb().then(
        (db) =>
            new Promise<T | undefined>((resolve, reject) => {
                const req = db.transaction(STORE, 'readonly').objectStore(STORE).get(key)
                req.onsuccess = () => resolve(req.result as T | undefined)
                req.onerror = () => reject(req.error)
            }),
    )
}

function idbPut(key: string, value: unknown): Promise<void> {
    return openDb().then(
        (db) =>
            new Promise<void>((resolve, reject) => {
                const tx = db.transaction(STORE, 'readwrite')
                tx.objectStore(STORE).put(value, key)
                tx.oncomplete = () => resolve()
                tx.onerror = () => reject(tx.error)
            }),
    )
}

function idbDelete(key: string): Promise<void> {
    return openDb().then(
        (db) =>
            new Promise<void>((resolve, reject) => {
                const tx = db.transaction(STORE, 'readwrite')
                tx.objectStore(STORE).delete(key)
                tx.oncomplete = () => resolve()
                tx.onerror = () => reject(tx.error)
            }),
    )
}

/** Persistenter, non-extractable AES-GCM-Schlüssel (einmal erzeugt, in IndexedDB). */
async function getCryptoKey(): Promise<CryptoKey> {
    const existing = await idbGet<CryptoKey>(KEY_ID)
    if (existing) {
        return existing
    }
    // Erst-Erzeugung atomar: Kandidat vorab generieren, dann in EINER readwrite-
    // Transaktion KEY_ID re-lesen und NUR bei Abwesenheit putten. IndexedDB
    // serialisiert überlappende readwrite-Transaktionen → zwei gleichzeitige
    // Erst-Writes (z. B. zwei Tabs) einigen sich auf denselben Schlüssel statt auf
    // divergierende (sonst wäre der Ciphertext unter K1 mit K2 nicht entschlüsselbar).
    const candidate = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
    const db = await openDb()
    return new Promise<CryptoKey>((resolve, reject) => {
        const tx = db.transaction(STORE, 'readwrite')
        const store = tx.objectStore(STORE)
        const getReq = store.get(KEY_ID)
        let winner: CryptoKey = candidate
        getReq.onsuccess = () => {
            const found = getReq.result as CryptoKey | undefined
            if (found) {
                winner = found
            } else {
                store.put(candidate, KEY_ID)
            }
        }
        tx.oncomplete = () => resolve(winner)
        tx.onerror = () => reject(tx.error)
    })
}

async function webSet(key: string, value: string): Promise<void> {
    const iv = crypto.getRandomValues(new Uint8Array(12))
    const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv as BufferSource }, await getCryptoKey(), enc.encode(value))
    await idbPut('data:' + key, { iv, ct })
}

async function webGet(key: string): Promise<string | null> {
    const blob = await idbGet<{ iv: Uint8Array; ct: ArrayBuffer }>('data:' + key)
    if (!blob) {
        return null
    }
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: blob.iv as BufferSource }, await getCryptoKey(), blob.ct)
    return dec.decode(pt)
}

/** Kleines Text-Secret sicher ablegen (Mobile Keystore / Web WebCrypto at-rest). */
export async function secureSet(key: string, value: string): Promise<void> {
    if (isMobile) {
        await nativeCall('SecureStorage.Set', { key, value })
        return
    }
    await webSet(key, value)
}

export async function secureGet(key: string): Promise<string | null> {
    if (isMobile) {
        const res = await nativeCall('SecureStorage.Get', { key })
        return (res as { value: string | null } | null)?.value ?? null
    }
    return webGet(key)
}

export async function secureRemove(key: string): Promise<void> {
    if (isMobile) {
        await nativeCall('SecureStorage.Delete', { key })
        return
    }
    await idbDelete('data:' + key)
}

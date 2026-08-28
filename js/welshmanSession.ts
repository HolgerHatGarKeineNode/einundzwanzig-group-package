/**
 * Fassade: Identität und Signieren.
 *
 * ── Welche 0.9.5-API diese Datei vorwegnimmt — und warum nur teilweise ───────────
 * In 0.9.5 gibt es die Stores `pubkey`/`signer`/`sessions` nicht mehr. Eine App-Instanz
 * ist an **genau eine** Identität gebunden: `app.user` ist eine `User`-Property (Pubkey
 * + Signer), kein Store, und Signieren läuft über `User.require(app).sign(event)` bzw.
 * `.nip44EncryptToSelf(payload)`. Login/Logout sind dort Anwendungssache über die
 * Handler-Registry (`registerSessionHandler`, `nip01`/`nip07`/`nip46`/`nip55`).
 *
 * **Diese Fassade bildet 0.8.16 ab, nicht 0.9.5 — bewusst.** Der Grund ist kein
 * Zeitmangel, sondern eine Formdifferenz, die sich nicht ohne Verhaltensänderung
 * überbrücken lässt: unsere Identität wechselt zur Laufzeit und wird an 24 Stellen
 * **reaktiv** gelesen (`pubkey` steht in `derived([...])`-Listen, `js/core.ts` hängt ein
 * `pubkey.subscribe(…)` daran). 0.9.5 hat für den Wechsel kein reaktives Primitiv — der
 * vorgesehene Weg ist, die App zu **ersetzen**. Ein `app.user`-förmiger Adapter über
 * 0.8.16 müsste die Reaktivität entweder wegwerfen (verbotener Verhaltenswechsel) oder
 * einen Store erfinden, den 0.9.5 nicht kennt und den P3 wieder abräumen müsste.
 *
 * ── Was P3 hier tun muss ─────────────────────────────────────────────────────────
 * Diese Datei ist die eine Stelle, an der der Identitätswechsel entschieden wird: ein
 * Shim, der die App-Instanz bei Login/Logout austauscht und `pubkey`/`signer` als
 * Stores darüber nachbildet — mit der Auflage aus Risiko R4 des Plans, dass alles, was
 * eine Referenz auf `repository`/`tracker`/`pool` festhält, mitwandern muss.
 * Alle 24 Leser bleiben davon unberührt; sie importieren bereits hier.
 *
 * ── Abgrenzung zu `js/session.ts` ────────────────────────────────────────────────
 * Dort liegt UNSERE Login-Logik (Signer-Auswahl, NIP-46-Broker, localStorage-Bindung,
 * Logout-Aufräumen). Hier liegt nur der welshman-Zugang, den `session.ts` und die Leser
 * gemeinsam benutzen. Wer Login auslösen will, ruft `js/session.ts` — nicht die
 * `loginWith*` von hier.
 *
 * **Diese Datei importiert ausschließlich `@welshman/app`.**
 */

// Identität und Sitzungen. 0.9.5: `app.user` (Property) bzw. die Handler-Registry.
export { pubkey, sessions } from '@welshman/app'

// Signer. 0.9.5: `User.require(app).sign(…)` / `.nip44EncryptToSelf(…)`,
// `ensurePlaintext` → `app.use(Plaintext).ensure(ciphertext, decrypt)`.
export { signer, sign, nip44EncryptToSelf, ensurePlaintext } from '@welshman/app'

// Sitzungs-Lebenszyklus. 0.9.5: `User.fromSigner`/`User.fromSession` + Handler-Registry.
export { loginWithNip01, loginWithNip07, loginWithNip46, dropSession } from '@welshman/app'

// Signer-Diagnose (`js/signer-health.ts`). 0.9.5: `appPolicyLogSignerMethods`.
export { signerLog } from '@welshman/app'
export type { SignerLogEntry } from '@welshman/app'

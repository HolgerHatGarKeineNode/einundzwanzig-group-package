/**
 * Fassade: Identität und Signieren aus `@welshman/app`.
 *
 * **Warum diese Datei existiert.** `pubkey` steht heute in 24 Dateien als direkter
 * Import aus `@welshman/app`, `signer` in neun. In 0.9.5 gibt es beide Stores nicht
 * mehr: eine App-Instanz ist dort an genau eine Identität gebunden, und `app.user` ist
 * eine Property, kein Store (`app/src/user.ts`). Der Ersatz — ein Store, den ein Shim
 * beim Identitätswechsel neu befüllt — ist machbar, aber nur, wenn er an EINER Stelle
 * gebaut wird. Diese ist es.
 *
 * **Heute ist das eine reine Durchreiche.** Es wird nichts gehalten, nichts gecacht,
 * nichts umgerechnet; die Stores sind dieselben Objekte wie vorher, inklusive
 * `.get()` und `.subscribe()`. P1 verlegt nur, wo der Import steht.
 *
 * **Abgrenzung zu `js/session.ts`:** dort liegt UNSERE Login-Logik (Signer-Auswahl,
 * NIP-46-Broker, localStorage-Bindung, Logout-Aufräumen). Hier liegt nur der
 * welshman-Zugang, den `session.ts` und die 24 Leser gemeinsam benutzen. Wer Login
 * auslösen will, ruft `js/session.ts` — nicht die `loginWith*` hier.
 *
 * **Diese Datei importiert ausschließlich `@welshman/app`.**
 */

// Identität und Sitzungen
export { pubkey, sessions } from '@welshman/app'

// Signer: Store, Signatur, NIP-44-Krypto mit dem aktuellen Signer
export { signer, sign, nip44EncryptToSelf, ensurePlaintext } from '@welshman/app'

// Sitzungs-Lebenszyklus. Der Einstieg der Anwendung ist `js/session.ts`.
export { loginWithNip01, loginWithNip07, loginWithNip46, dropSession } from '@welshman/app'

// Signer-Diagnose (`js/signer-health.ts`)
export { signerLog } from '@welshman/app'
export type { SignerLogEntry } from '@welshman/app'

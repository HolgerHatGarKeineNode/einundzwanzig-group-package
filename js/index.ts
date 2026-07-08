// Öffentlicher Einstieg der Nostr-Chat-Insel. Der Host (Web-Client heute,
// Portal in P1) importiert `registerNostrComponents` und ruft es in
// `alpine:init`. Der `core`-Side-Effect-Import bootet welshman EINMAL beim Laden.
import './core'
import { setupFlashToast } from './toast'

// Flash-Toasts (z.B. Vereins-Relay-Hinweis aus den Einstellungen) über
// wire:navigate hinweg zustellen — Listener EINMAL beim Insel-Boot registrieren.
setupFlashToast()

export { registerNostrComponents } from './bridge'

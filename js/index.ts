// Öffentlicher Einstieg der Nostr-Chat-Insel. Der Host (Web-Client heute,
// Portal in P1) importiert `registerNostrComponents` und ruft es in
// `alpine:init`. Der `core`-Side-Effect-Import bootet welshman EINMAL beim Laden.
import './core'

export { registerNostrComponents } from './bridge'

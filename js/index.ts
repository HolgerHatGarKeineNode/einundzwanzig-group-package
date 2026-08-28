// Öffentlicher Einstieg der EINUNDZWANZIG-Group-Insel. Der Host (Web-Client heute,
// Portal in P1) importiert `registerNostrComponents` und ruft es in
// `alpine:init`. Der `core`-Side-Effect-Import bootet welshman EINMAL beim Laden.
import './core.ts'
import { setupFlashToast } from './toast.ts'
import { beobachtePanellosTabs } from './fluxTabsPanellos.ts'

// Flash-Toasts (z.B. Vereins-Relay-Hinweis aus den Einstellungen) über
// wire:navigate hinweg zustellen — Listener EINMAL beim Insel-Boot registrieren.
setupFlashToast()

// Schutzhülle für die vier Flächen mit `flux:tabs` OHNE `flux:tab.group`:
// Flux' MutationObserver in `UITabs.mount()` ruft `showPanel()` ungeprüft auf einer
// Tab-Gruppe auf, die es dort per Bauform nicht gibt. Begründung und Messungen im
// Kopf von `fluxTabsPanellos.ts`.
beobachtePanellosTabs()

export { registerNostrComponents } from './bridge.ts'

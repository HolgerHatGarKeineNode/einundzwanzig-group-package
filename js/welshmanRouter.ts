/**
 * Adapter: Relay-Auswahl.
 *
 * ── Warum es diese Datei gibt ────────────────────────────────────────────────────
 * **`@welshman/router` ist gelöscht, nicht umbenannt** (letzte Version auf npm:
 * 0.9.0-pre1). An seine Stelle treten zwei Dinge:
 * - die deklarative **RelaySelection-DSL** in `@welshman/util` (`userOutbox()`,
 *   `inbox(pk)`, `relays([...])`, `indexers()` …), und
 * - das **`Router`-Plugin** in `@welshman/app`, dessen `resolve(selections)` daraus ein
 *   gewichtetes `RelayScenario` macht.
 *
 * Der Haken: **`resolve()` ist asynchron.** Es löst Relay-Listen über `RelayLists.load`
 * auf, und das kann ins Netz gehen. Vier unserer Aufrufstellen standen in synchronen
 * Ausdrücken (`js/groups.ts:1432,1444`, `js/readStateSync.ts:233`, `js/zaps.ts:299`),
 * eine davon in einer Datei, die dieser Sprung ausdrücklich nicht anfassen darf.
 *
 * ── Der Ausweg: dieselbe Maschinerie, nur mit synchron beschafften Listen ────────
 * Die Gewichtung, das Limit, die Fallback-Politik und die Güte-Sperre stecken alle in
 * `RelayScenario` — und die Klasse ist synchron. Asynchron ist nur das **Beschaffen**
 * der Relay-Listen. Die liegen bei uns aber bereits im Repository: `RelayLists` ist ein
 * `DerivedPlugin`, sein `readUrls(pk)`/`writeUrls(pk)` ist eine `Projection` mit einem
 * synchronen `.get()`.
 *
 * Die synchronen Helfer unten setzen deshalb das Szenario selbst zusammen — aus den
 * Listen, die schon da sind, und **mit den Optionen des echten Routers**
 * (`app.use(Router).resolver.options`), also inklusive `guardRelayQuality` und der
 * Default-Relays. Das ist keine Nachbildung der Auswahl-Logik, sondern dieselbe Klasse
 * mit einer anderen Beschaffung.
 *
 * **Der Unterschied ist benannt, nicht verschwiegen:** wo `resolve()` eine fehlende
 * Relay-Liste noch nachladen würde, sieht der synchrone Weg nur, was im Repository
 * liegt. In 0.8.16 war das nicht anders — dessen `getPubkeyRelays` las ebenfalls aus
 * einem Store und ging nie ins Netz. Wer neu baut, nimmt {@link resolveRelays}.
 */
import { RelayScenario, addNoFallbacks, makeSelection, type RelayScenarioOptions, type RelaySelection } from '@welshman/util'
import { Router, RelayLists } from '@welshman/app'
import { get } from 'svelte/store'
import { app } from './welshmanInstance.ts'
import { pubkey } from './welshmanSession.ts'

export { userOutbox, userInbox, outbox, inbox, relay, relays, inboxes, indexers, searchRelays, addNoFallbacks, addMinimalFallbacks, addMaximalFallbacks } from '@welshman/util'
export type { RelaySelection, RelayScenario } from '@welshman/util'

/** Der volle, asynchrone Weg — für alles, was neu gebaut wird. */
export const resolveRelays = (selections: RelaySelection[]) => app.use(Router).resolve(selections)

/** Die Optionen des echten Routers: Güte-Sperre (`deadRelays.ts`) und Default-Relays. */
const routerOptionen = (): RelayScenarioOptions => app.use(Router).resolver.options

/** Ein Szenario aus fertigen URLs — die 0.9.5-Form von `Router.FromRelays(urls)`. */
export const szenarioAusUrls = (urls: string[], weight = 1): RelayScenario =>
    new RelayScenario([makeSelection(urls, weight)], routerOptionen())

/**
 * Die Write-Relays (Outbox) des eingeloggten Nutzers — die 0.9.5-Form von
 * `Router.get().FromUser().getUrls()`, synchron.
 *
 * **Ohne kind 10002 fällt das bewusst auf NICHTS zurück**, genau wie vorher: die Liste
 * ist dann leer, und das Szenario bekommt keine Fallbacks untergeschoben. Darauf baut
 * `js/readStateSync.ts:153` ausdrücklich auf.
 */
export const eigeneOutboxUrls = (): string[] => {
    const pk = get(pubkey)

    return pk ? szenarioAusUrls(app.use(RelayLists).writeUrls(pk).get()).policy(addNoFallbacks).getUrls() : []
}

/**
 * Die Read-Relays (Inbox) eines Empfängers — die 0.9.5-Form von
 * `Router.get().ForPubkey(pk).getUrls()`, synchron. Dorthin zustellen heisst: dort
 * liest er.
 */
export const empfaengerInboxUrls = (pk: string): string[] =>
    szenarioAusUrls(app.use(RelayLists).readUrls(pk).get()).getUrls()

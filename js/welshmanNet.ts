/**
 * Adapter: `load`/`request`/`requestOne` — **an die App-Instanz gebunden**.
 *
 * ── Der Fund, um dessentwillen diese Datei existiert ─────────────────────────────
 * `@welshman/net@0.9.5` exportiert weiterhin ein freistehendes `load`, `request` und
 * `requestOne`. Sie sehen aus wie vorher, sind es aber nicht: sie brauchen einen
 * **`context` mit `pool` und `repository`**, und das freistehende `load` hat keinen.
 *
 * Am installierten Paket gemessen, nicht aus der Signatur gelesen — `context` ist dort
 * `optional`, der Typecheck sagt also nichts:
 *
 *     globales load()        -> WIRFT: Unable to connect to relays without context.pool
 *     globales request()     -> WIRFT: Unable to connect to relays without context.pool
 *     globales requestOne()  -> WIRFT: Unable to connect to relays without context.pool
 *     app.use(Network).load()  -> kein Wurf
 *
 * Der Wurf kommt aus `net/src/adapter.js getAdapter`, sobald eine echte Relay-URL im
 * Spiel ist. **Ohne diese Datei wäre die Insel nach dem Sprung stumm gewesen — jede
 * Abfrage in 17 Dateien hätte geworfen, bei grünem `npm run typecheck`.**
 *
 * ── Warum ein Adapter und nicht `app.use(Network)` an jeder Aufrufstelle ─────────
 * Weil die Signaturen identisch sind. So bleibt der Umbau eine Import-Umhängung in 17
 * Dateien statt einer Änderung an jedem der rund 60 Aufrufe — und die Aufrufe selbst
 * bleiben lesbar wie vorher.
 *
 * `app.use(Network)` wird bei JEDEM Aufruf neu aufgelöst, nicht einmal beim Modul-Eval.
 * Das ist Absicht: die Registry ist je App memoisiert, und nach einem Identitätswechsel
 * (`js/welshmanInstance.ts`) muss der Loader der NEUEN App gehören. Ein im Toplevel
 * festgehaltener Loader zeigte danach auf einen toten Pool — und meldete nichts.
 */
import { Network } from '@welshman/app'
import { requestOne as requestOne095 } from '@welshman/net'
import type { LoadOptions, RequestOptions, RequestOneOptions, PublishOptions } from '@welshman/net'
import { app } from './welshmanInstance.ts'

/** Gebündelte, gedrosselte Abfrage über mehrere Relays. 0.9.5: `app.use(Network).load`. */
export const load = (options: LoadOptions) => app.use(Network).load(options)

/** Einzelne Abfrage ohne Bündelung. 0.9.5: `app.use(Network).request`. */
export const request = (options: Omit<RequestOptions, 'context'>) => app.use(Network).request(options)

/**
 * Abfrage gegen genau EINEN Relay. `Network` hat dafür kein Gegenstück, deshalb hier
 * direkt — mit dem Netz-Kontext der App, der ihm sonst fehlt.
 */
export const requestOne = (options: Omit<RequestOneOptions, 'context'>) =>
    requestOne095({ ...options, context: app.netContext })

/** Publizieren ohne Thunk (ohne optimistisches Schreiben). 0.9.5: `app.use(Network).publish`. */
export const publish = (options: Omit<PublishOptions, 'context'>) => app.use(Network).publish(options)

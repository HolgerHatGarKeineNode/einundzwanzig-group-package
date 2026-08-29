/**
 * NIP-88-Poll-Logik (kind 1068 Poll, kind 1018 Response) — seit P4 des 0.9.5-Sprungs
 * eine **dünne Hülle um `PollReader` aus `@welshman/domain`** statt einer eigenen
 * Auswertung. Bewusst weiterhin **welshman-app-frei**: `@welshman/domain` importiert
 * nur `lib` und `util` (nachgesehen in `Poll.js`/`EventReader.js`), also bleiben die
 * Auswahl- und Tally-Regeln als reine JS-Unit ohne Browser prüfbar — `polls.test.ts`
 * läuft unter `node --test`.
 *
 * Die publish-nahen Builder (`makePoll`/`makePollResponse`) liegen in `interactions.ts`.
 *
 * ── Warum eine HÜLLE und kein Ersatz: zwei Upstream-Fehler ──────────────────────
 *
 * Beide Implementierungen wurden gegeneinander ausgeführt. Sie stimmen überein, bis auf
 * zwei Stellen — und an beiden liegt der Fehler upstream, nicht bei uns:
 *
 * **(1) Die namenlose Geist-Option.** `PollReader.options()` filtert die `option`-Tags
 * und destrukturiert `[, id, label = id]`, ohne zu prüfen, dass `id` existiert. Ein
 * nacktes `["option"]`-Tag — das jeder Absender senden kann — wird damit zu `{}`:
 *
 *   Tags `[["option"], ["option","b","Birne"]]`
 *     welshman `options()` → `[{}, {id:"b",label:"Birne"}]`
 *     welshman `results()` → `{options:[{votes:0}, {id:"b",…,votes:1}], voters:1}`
 *
 * Die Geist-Option erscheint also **im Ergebnis** und wird gerendert: eine Zeile ohne
 * Beschriftung mit 0 Stimmen, die niemand angelegt hat. `results()` erbt den Fehler von
 * `options()`, deshalb reicht es, die Tags vorher zu bereinigen.
 *
 * **(2) Der ungeprüfte Cast beim Poll-Typ.** `PollReader.pollType()` gibt den Tagwert
 * roh zurück (`tagValue(…) || "singlechoice"`), obwohl der Rückgabetyp nur zwei Werte
 * kennt. `results()` vergleicht danach `pollType === "singlechoice"` — jeder andere
 * Wert fällt also in den **Mehrfachwahl**-Zweig:
 *
 *   Tag `["polltype","quatsch"]` → welshman `"quatsch"`, unsere Regel `"singlechoice"`
 *
 * Eine Einfachwahl-Poll mit vertipptem oder böswillig gesetztem `polltype` wird damit
 * wie eine Mehrfachwahl gezählt: ein Wähler mit mehreren `response`-Tags bekommt mehrere
 * Stimmen. NIP-88 nennt genau zwei zulässige Werte; alles andere gehört auf den Default.
 *
 * **Die Hülle normalisiert deshalb das EVENT, bevor es in den Reader geht**
 * (siehe {@link normalisierePollEvent}) — an einer Stelle statt an jeder Methode. Alles
 * Übrige delegiert unverändert; die Regeln selbst stehen nicht mehr hier.
 *
 * Beide Befunde sind als Upstream-Meldung aufbereitet und liegen beim Auftraggeber; ob
 * sie an coracle-social/welshman rausgeht, ist dessen Entscheidung und nicht in diesem
 * Repo hinterlegt. Erscheint upstream ein Fix, sind die zwei Fälle am Ende von
 * `polls.test.ts` die Stelle, an der er sichtbar wird — sie beschreiben das ungeschützte
 * Verhalten im Kommentar mit.
 */
import { uniq } from '@welshman/lib'
import { type TrustedEvent } from '@welshman/util'
import { PollReader } from '@welshman/domain'
import { POLL } from './welshmanKinds.ts'
import { matchTag, tagSpec, tagValue, tagValues } from './welshmanTags.ts'

export type PollType = 'singlechoice' | 'multiplechoice'

/** Eine Poll-Option: stabile `id` (im `option`-Tag) + Anzeigetext. */
export type PollOption = { id: string; label: string }

/** Die beiden von NIP-88 zugelassenen Werte des `polltype`-Tags. */
const POLL_TYPEN: readonly string[] = ['singlechoice', 'multiplechoice']

/**
 * Entfernt aus einem Poll-Event genau die Tags, an denen `PollReader` stolpert:
 * `option`-Tags ohne id und `polltype`-Tags mit einem Wert außerhalb von NIP-88.
 *
 * **Wegwerfen statt korrigieren, und das ist die Entscheidung:** Ein `["polltype","quatsch"]`
 * wird nicht auf `singlechoice` umgeschrieben, sondern gestrichen — dann greift der Default
 * des Readers, und es gibt genau EINE Stelle, die den Default kennt. Ein nacktes
 * `["option"]` lässt sich ohnehin nicht reparieren: eine Option ohne id kann keine Stimme
 * bekommen, denn `response`-Tags referenzieren die id.
 *
 * Das Original wird nicht verändert; es entsteht eine flache Kopie, und nur wenn wirklich
 * etwas zu streichen ist (sonst geht das Event unangetastet weiter).
 */
export const normalisierePollEvent = (event: TrustedEvent): TrustedEvent => {
    const sauber = event.tags.filter(
        (tag) =>
            !(tag[0] === 'option' && !tag[1]) && !(tag[0] === 'polltype' && !POLL_TYPEN.includes(tag[1] ?? '')),
    )

    return sauber.length === event.tags.length ? event : { ...event, tags: sauber }
}

/**
 * Der Reader auf dem normalisierten Event — der einzige Ort, an dem diese Datei
 * `PollReader` instanziiert.
 *
 * Der `context` ist bewusst leer: `PollReader` liest ihn in keiner der hier genutzten
 * Methoden (`options`/`pollType`/`endsAt`/`isClosed`/`results` arbeiten ausschließlich auf
 * `this.event`), und ein echter `KindContext` würde die App-Freiheit dieses Moduls
 * aufgeben, die `polls.test.ts` ohne Browser laufen lässt. Am Paket gemessen: alle
 * Aufrufe laufen mit `{}` durch.
 *
 * `parse()` wird nicht gebraucht — `PollReader` ist ein synchroner Reader (kein
 * Entschlüsseln), die Methoden lesen direkt.
 */
const leser = (event: TrustedEvent): PollReader =>
    new PollReader(POLL, {} as ConstructorParameters<typeof PollReader>[1], normalisierePollEvent(event))

/**
 * `["polltype", …]` → Einfach-/Mehrfachwahl (Default Einfachwahl).
 *
 * Der Cast ist hier sicher — anders als upstream: `normalisierePollEvent` hat jeden Wert
 * außerhalb von NIP-88 bereits entfernt, der Reader kann also nur noch einen der beiden
 * zulässigen Werte oder seinen Default liefern.
 */
export const getPollType = (event: TrustedEvent): PollType => leser(event).pollType() as PollType

/** Optionen aus den `["option", id, label]`-Tags (ohne id verworfen; label defaultet auf id). */
export const getPollOptions = (event: TrustedEvent): PollOption[] => leser(event).options()

/** `["endsAt", unix]` → Timestamp oder undefined (auch bei kaputtem Wert). */
export const getPollEndsAt = (event: TrustedEvent): number | undefined => leser(event).endsAt()

/** Läuft die Poll noch? Ohne `endsAt` nie geschlossen. */
export const isPollClosed = (event: TrustedEvent): boolean => leser(event).isClosed()

/**
 * Gewählte Options-IDs einer Response, unter Beachtung des Poll-Typs: Einfachwahl
 * zählt nur die erste, Mehrfachwahl dedupliziert.
 *
 * **Bleibt bewusst eigene Tag-Logik und delegiert NICHT an `PollResponseReader`** — die
 * einzige Stelle dieser Datei, die das tut, und deshalb mit Begründung: Dessen
 * `selections()` dedupliziert immer und kennt den Poll-Typ überhaupt nicht, kann die
 * Einfachwahl-Regel also nicht abbilden. Der Rest wäre `uniq(tagValues(…))` — dieselbe
 * Zeile, die hier ohnehin steht. Eingehandelt hätten wir uns dafür den
 * Konstruktor-Wurf von `BaseEventReader` (`Expected a kind 1018 event, got kind …`) auf
 * einem Pfad, der heute jedes Event verträgt: null Gewinn, ein neuer Absturzweg. Das ist
 * kein Konservieren des Status quo, sondern das Ergebnis des Vergleichs.
 */
export const getPollResponseSelections = (event: TrustedEvent, pollType: PollType): string[] => {
    const selections = tagValues(tagSpec('response'), event.tags)
    return pollType === 'singlechoice' ? selections.slice(0, 1) : uniq(selections)
}

/** Aggregiertes Ergebnis: Stimmen je Option + Wählerzahl. */
export type PollResults = { options: { id: string; label: string; votes: number }[]; voters: number }

/**
 * Zählt die Stimmen: pro Wähler zählt nur die **jüngste** Response (created_at),
 * ihre Auswahl (typ-korrekt) erhöht die Options-Zähler.
 *
 * Delegiert an `PollReader.results()` — auf dem normalisierten Event, und darauf kommt
 * es an: `results()` erbt beide Upstream-Fehler (die Geist-Option kommt aus `options()`,
 * die Fehlzählung aus `pollType()`), und beide sind vor dem Reader schon weg. Der
 * Aggregationsteil selbst — jüngste Response je Wähler, Zähler je Option — ist in beiden
 * Implementierungen identisch; er wird deshalb nicht länger doppelt gepflegt.
 */
export const getPollResults = (event: TrustedEvent, responses: TrustedEvent[]): PollResults =>
    leser(event).results(responses)

/** Options-IDs, die `pubkey` zuletzt gewählt hat (leeres Array = keine Stimme). */
export const ownPollSelection = (
    event: TrustedEvent,
    responses: TrustedEvent[],
    pubkey: string | null | undefined,
): string[] => {
    if (!pubkey) {
        return []
    }
    let latest: TrustedEvent | undefined
    for (const response of responses) {
        if (response.pubkey === pubkey && (!latest || response.created_at > latest.created_at)) {
            latest = response
        }
    }
    return latest ? getPollResponseSelections(latest, getPollType(event)) : []
}

/** `["e", pollId]` einer Response → zugehörige Poll (fürs Gruppieren nach Ziel). */
export const pollResponseTarget = (event: TrustedEvent): string => matchTag(tagSpec('e'), event.tags)?.[1] ?? ''

/** Vorangestelltes `nostr:nevent…`/`note…`-Zitat (unser Quote-Prefix). */
export const QUOTE_PREFIX = /^nostr:(?:nevent1|note1)[0-9a-z]+\n\n/

/**
 * Ist `event` die reine kind-9-Share-Quote einer Poll aus `pollIds` (Frage kommt
 * bereits als native Poll-Karte)? Erkennungsmerkmal: `q`-Tag zeigt auf eine Poll-ID
 * UND der Text besteht NUR aus dem `nostr:nevent…`-Zitat (kein eigener Kommentar).
 * Diese Quote posten wir ausschließlich für Flotilla (dessen Chat-Feed kind-1068
 * nicht direkt lädt); im eigenen Feed wird sie ausgeblendet, sonst erschiene die
 * Poll doppelt. Ein echtes Textzitat auf eine Poll (nicht leer) bleibt sichtbar.
 */
export const isPollShareQuote = (event: TrustedEvent, pollIds: Set<string>): boolean => {
    const q = tagValue(tagSpec('q'), event.tags)
    return q !== undefined && pollIds.has(q) && event.content.replace(QUOTE_PREFIX, '').trim() === ''
}

/**
 * P5 — die **reine** Logik des Vereins-Onboardings: welcher Schritt gilt, was
 * genau schiefging und wo der Ausweg liegt, wie lange die Freischaltung dauert
 * und wann das nächste Nachfassen fällig ist.
 *
 * ── Warum ein eigenes Modul neben `verein.ts` ────────────────────────────────
 * `verein.ts` ist die Insel: welshman-Stores, `fetch`, Wallet, Relay-Sockets.
 * Nichts davon ist unter `node --test` ladbar. Die Aussagen, an denen dieser
 * Schritt hängt, sind aber genau die, die man ohne Browser prüfen können MUSS —
 * allen voran die eine, die unsichtbar falsch sein kann:
 *
 *   **Ein Lesefehler ist kein „kein Mitglied".**
 *
 * Die heutige Mitgliedsprüfung trennt das richtig (`deriveVereinAccess`:
 * `ready` wird erst nach EOSE/CLOSED wahr, `members.ts:286-298`). Der neue
 * Wartezustand darf diese Trennung nicht einebnen — und „darf nicht" ist keine
 * Zusicherung, solange es keine Stelle gibt, die sie durchsetzt. Diese Stelle
 * ist [[vereinView]] mit dem Riegel in [[STAGE_REQUIRES_DIRECTORY]]:
 *
 *   Die EINZIGE Stufe, deren Text eine Aussage über die Mitgliedschaft trifft
 *   (`freischaltung` — „du bist noch nicht freigeschaltet"), wird nur erreicht,
 *   wenn `dirReady` wahr ist. Ist die Directory noch nicht gelesen, heißt die
 *   Stufe `zugang-pruefen`; ist der Lesevorgang gescheitert, `lesefehler` — mit
 *   sichtbarem Ausweg, nicht mit einer Behauptung.
 *
 * Deshalb ist das hier ein Modul ohne einen einzigen Import.
 */

// ── Schritte der Strecke ─────────────────────────────────────────────────────

/**
 * Der äußere Schritt. `laden` ist bewusst ein eigener Schritt und nicht „noch
 * kein Zustand": solange `/config` und `/me` unterwegs sind, ist über den Nutzer
 * NICHTS bekannt, und jede Fläche, die in dieser Zeit etwas behauptet, behauptet
 * es zu früh.
 */
export type VereinPhase = 'laden' | 'statuten' | 'antrag' | 'zahlung' | 'warten' | 'freigeschaltet'

/**
 * Die Feinstufe innerhalb von `warten` — der Schritt, an dem dieser Plan hängt.
 * Jede Stufe beantwortet dem Nutzer dieselben drei Fragen: was passiert gerade,
 * wie lange dauert es, und passiert es auch ohne offene App.
 *
 * - `zahlung-offen`      Zahlung raus, der Verein hat sie noch nicht bestätigt.
 * - `zahlung-geprueft`   Nachfass-Plan durch, immer noch nicht bestätigt → ein
 *                        Mensch schaut drauf (Betrags-/Währungsabweichung legt
 *                        beim Verein einen `PaymentReview` an und lässt `paid`
 *                        auf `false` — für den Client ununterscheidbar von
 *                        „nicht bezahlt", deshalb wird es hier erklärt).
 * - `zugang-pruefen`     Zahlung bestätigt, die relay-signierte Mitgliederliste
 *                        ist noch nicht gelesen. **Keine Aussage über die
 *                        Mitgliedschaft.**
 * - `lesefehler`         Die Liste konnte nicht gelesen werden. **Auch keine.**
 * - `freischaltung`      Zahlung bestätigt, Liste gelesen, Pubkey steht (noch)
 *                        nicht drin → der nächtliche Abgleich fehlt noch.
 */
export type WaitStage = 'zahlung-offen' | 'zahlung-geprueft' | 'zugang-pruefen' | 'lesefehler' | 'freischaltung'

/**
 * Stufen, die eine Aussage über die Mitgliedschaft treffen und deshalb eine
 * **gelesene** Directory voraussetzen.
 *
 * Der Riegel steht als Datum und nicht als `if` im Code, damit der Test ihn
 * gegen ALLE Stufen prüfen kann statt gegen die, an die der Autor gerade dachte.
 */
export const STAGE_REQUIRES_DIRECTORY: ReadonlySet<WaitStage> = new Set<WaitStage>(['freischaltung'])

/** Alles, was der Schritt-Entscheid braucht — bewusst flach und ohne Verhalten. */
export type VereinSnapshot = {
    /** Sind `/config` UND `/me` beantwortet? Vorher gilt nichts als bekannt. */
    loaded: boolean
    /** `statutes_accepted_at` aus `/me` ist gesetzt. */
    statutesAccepted: boolean
    /** `current_year.paid` aus `/me`. */
    paid: boolean
    /** Der Nutzer hat die Statuten in dieser Sitzung abgehakt (noch nicht gesendet). */
    statutesConfirmed: boolean
    /** Eine Zahlung ist raus (Wallet gezahlt oder Checkout geöffnet). */
    paymentSent: boolean
    /** Der Nachfass-Plan ist abgearbeitet — ab hier wird nur noch von Hand geprüft. */
    exhausted: boolean
    /** Der aktive Space ist ein Vereins-Relay (sonst gibt es nichts freizuschalten). */
    dirGated: boolean
    /** Die relay-signierte Mitgliederliste ist FERTIG gelesen (EOSE/CLOSED nach AUTH). */
    dirReady: boolean
    /** Der eigene Pubkey steht in der Liste. */
    dirMember: boolean
    /** Der Lesevorgang ist gescheitert (Relay nicht erreichbar / AUTH blind). */
    dirFailed: boolean
}

export type VereinView = { phase: VereinPhase; stage: WaitStage | null }

/**
 * Der Schritt-Entscheid. Reihenfolge ist Bedeutung:
 *
 * 1. Wer drin ist, ist drin — das schlägt jeden anderen Zustand, auch einen
 *    unfertigen `/me`-Abruf.
 * 2. Ohne geladene Fakten wird nichts behauptet.
 * 3. Statuten vor Antrag vor Zahlung — die Reihenfolge des Vereins.
 * 4. Innerhalb von `warten` entscheidet zuerst der LESEZUSTAND, dann der Inhalt.
 *    Genau diese Reihenfolge ist der Riegel: `dirFailed`/`!dirReady` werden
 *    geprüft, BEVOR über die Mitgliedschaft geredet wird.
 */
export const vereinView = (s: VereinSnapshot): VereinView => {
    if (s.dirMember) {
        return { phase: 'freigeschaltet', stage: null }
    }

    if (!s.loaded) {
        return { phase: 'laden', stage: null }
    }

    if (!s.statutesAccepted) {
        return { phase: s.statutesConfirmed ? 'antrag' : 'statuten', stage: null }
    }

    if (!s.paid) {
        if (!s.paymentSent) {
            return { phase: 'zahlung', stage: null }
        }

        return { phase: 'warten', stage: s.exhausted ? 'zahlung-geprueft' : 'zahlung-offen' }
    }

    // Bezahlt. Ohne Vereins-Relay im aktiven Space gibt es nichts freizuschalten
    // — dann ist die Mitgliedschaft die Zahlung, und der Flow ist fertig.
    if (!s.dirGated) {
        return { phase: 'freigeschaltet', stage: null }
    }

    if (s.dirFailed) {
        return { phase: 'warten', stage: 'lesefehler' }
    }

    if (!s.dirReady) {
        return { phase: 'warten', stage: 'zugang-pruefen' }
    }

    return { phase: 'warten', stage: 'freischaltung' }
}

// ── Wartezeit ────────────────────────────────────────────────────────────────

/**
 * Die Wartezeit als Text. **Ein** konfigurierter Wert (Minuten) trägt jede
 * Stelle, an der eine Dauer steht — nach P1 (Cron auf Viertelstunde) wird
 * `VEREIN_ACTIVATION_MINUTES` von 1440 auf 15 gesetzt und kein Satz umgeschrieben.
 *
 * Eine Zahl zu zeigen, die nicht stimmt, ist an dieser Stelle schlimmer als gar
 * keine: `minutes <= 0` liefert deshalb `null`, und die Fläche sagt dann „in
 * Kürze" statt „in 0 Minuten".
 *
 * `t` wird hereingereicht statt importiert — dadurch ist die Formatierung ohne
 * i18n-Runtime prüfbar, und der Katalog bleibt die einzige Quelle der Texte.
 */
export const formatWait = (minutes: number, t: (key: string, replace?: Record<string, string | number>) => string): string | null => {
    if (!Number.isFinite(minutes) || minutes <= 0) {
        return null
    }

    const whole = Math.round(minutes)

    if (whole % 60 === 0 && whole >= 60) {
        const hours = whole / 60

        return hours === 1 ? t('bis zu einer Stunde') : t('bis zu :count Stunden', { count: hours })
    }

    return whole === 1 ? t('bis zu einer Minute') : t('bis zu :count Minuten', { count: whole })
}

// ── Ganze Sätze fürs Markup ──────────────────────────────────────────────────

/**
 * Die Übersetzungs-Funktion, wie sie hier hereingereicht wird. Ausgeschrieben
 * statt `typeof t` importiert: diese Datei hat bewusst KEINEN Import und bleibt
 * damit unter `node --test` ohne i18n-Runtime prüfbar.
 */
export type Translate = (key: string, replace?: Record<string, string | number>) => string

/*
 * ── Warum diese vier Funktionen überhaupt existieren ─────────────────────────
 *
 * Bis hierher standen vier Sätze im Markup **in Stücken**, weil ein reaktives
 * `<span x-text>` mittendrin steht:
 *
 *     {{ __('Bitte noch') }} <span x-text="error.retryAfter"></span> {{ __('Sekunden warten.') }}
 *
 * Deutsch liest sich das richtig — für jede andere Sprache ist es unlösbar. Der
 * Übersetzer bekommt „Bitte noch" und „Sekunden warten." als zwei Einträge und
 * kann weder die Wortstellung ändern (Ungarisch stellt das Verb ans Ende) noch
 * den Kasus wählen (Lettisch, Polnisch), weil beides von dem abhängt, was
 * dazwischen steht — und das sieht er nie. Belegt in den sieben Katalogen: die
 * ungarischen Wartezeit-Texte tragen `-ig`-Endungen, die NUR in dieser einen
 * deutschen Satzstellung aufgehen.
 *
 * Deshalb ist der Satz jetzt EIN Schlüssel mit Platzhalter, und die Ersetzung
 * passiert hier in JS statt in Blade: `__()` würde serverseitig füllen und den
 * reaktiven Wert damit einfrieren.
 *
 * ── Numerus: die Entscheidung, nicht die Vertagung ──────────────────────────
 *
 * `t()` kennt nur `:name`-Ersetzung, keine Numerus-Regeln (kein
 * `trans_choice`-Gegenstück). **Das bleibt so, ausdrücklich.** Gezählt wurde,
 * nicht geschätzt: von 746 Katalogschlüsseln tragen 35 überhaupt einen
 * Platzhalter, und im Vereins-Flow sind es nach dieser Runde **null**, bei
 * denen eine Zahl die Form eines Wortes bestimmt. Eine echte Pluralmechanik
 * bräuchte Regeln für acht Sprachen (pl hat drei Klassen, lv zwei), einen
 * Katalog, der pro Schlüssel mehrere Formen trägt, und Tests für beide — für
 * eine Menge, die leer ist. Der Aufwand hätte kein Ziel.
 *
 * Gelöst ist es stattdessen über die FORMULIERUNG, an drei Stellen dieselbe
 * Technik in drei Ausprägungen:
 *
 *  · **Einheit abgekürzt** — `Bitte noch :seconds Sek. warten.` („Sek." richtet
 *    sich nach keiner Zahl; `RETRY_AFTER_MIN_SECONDS` ist 1, der Fall also
 *    erreichbar). In `pl`/`lv` ebenso, in `hu` unnötig: Ungarisch setzt nach
 *    einem Zahlwort ohnehin den Singular.
 *  · **Einheit vor den Zähler** — `:used / :max Zeichen`: als „Zeichen" hinter
 *    zwei Zahlen konnte keine Sprache die Einheit voranstellen, und genau das
 *    brauchen Polnisch und Lettisch, um dem Numerus zu entgehen.
 *  · **Singular als eigener Schlüssel** — `bis zu einer Stunde` neben
 *    `bis zu :count Stunden`; `formatWait` wählt. Deshalb ist `:count` dort nie
 *    1. Übrig blieb allein Lettisch: `līdz` regiert den Dativ, und der ist dort
 *    zahlabhängig (21 → Singular „stundai"). Behoben in `lv.json` durch
 *    dieselbe Abkürzung („līdz :count st."), **nicht** durch Mechanik. Die
 *    anderen sieben Sprachen wurden auf dieselbe Klasse geprüft: de/en/es/pt
 *    bilden für jede Zahl ≠ 1 den Plural, nl setzt nach Zahlen „uur", hu den
 *    Singular, pl steht hinter „do" im Genitiv Plural — alle unauffällig.
 */

/**
 * „Bitte noch 42 Sek. warten." — die Bremse nach einem 429.
 *
 * **Die Einheit ist abgekürzt, und das ist kein Stilentscheid.**
 * `RETRY_AFTER_MIN_SECONDS` ist 1, der Wert 1 also erreichbar — „Bitte noch 1
 * Sekunden warten." wäre im Deutschen schlicht falsch, und `t()` kennt keine
 * Numerus-Regeln. Eine Abkürzung richtet sich nach keiner Zahl. Dieselbe
 * Umgehung wie beim Zeichenzähler, nur an der Einheit statt an der Stellung
 * (die lange Begründung steht im Block darüber).
 */
export const formatRetry = (seconds: number, t: Translate): string =>
    t('Bitte noch :seconds Sek. warten.', { seconds })

/** „0 / 2000 Zeichen" — der Zähler unter dem Nachrichtenfeld. */
export const formatCharCount = (used: number, max: number, t: Translate): string =>
    t(':used / :max Zeichen', { used, max })

// ── Ein Satz, ein Schlüssel — und trotzdem ein hervorgehobenes Teilstück ─────

/**
 * Ein Stück eines übersetzten Satzes. `value` = dieses Stück ist ein
 * eingesetzter Wert (Fassung, Datum, Dauer) und darf ausgezeichnet werden;
 * `false` = Rahmentext des Übersetzers.
 */
export type Segment = { text: string; value: boolean }

/**
 * Der übersetzte Satz, an seinen Platzhaltern aufgeteilt statt gefüllt.
 *
 * ── Wozu das gut ist ────────────────────────────────────────────────────────
 * Beim Fragment-Umbau sind drei Auszeichnungen verloren gegangen (`font-medium`
 * auf Fassung und Datum, `whitespace-nowrap` auf dem Datum, `font-semibold` auf
 * der Wartedauer): innerhalb EINES `x-text` lässt sich kein Teilstück
 * hervorheben. Die beiden naheliegenden Wege sind beide falsch —
 *
 *  · **`x-html`**: dort fließen fremde Vereinsdaten ein (`version`, `date`
 *    kommen aus `GET /config`). Eine Hervorhebung ist kein Grund, eine
 *    Injektionsfläche aufzumachen.
 *  · **wieder zerstückeln**: genau der Zustand, der gerade behoben wurde. Der
 *    Übersetzer bekäme wieder Bruchstücke ohne Wortstellung und ohne Kasus.
 *
 * Der dritte Weg kostet keines von beidem: der Satz bleibt EIN Katalogeintrag,
 * der Übersetzer sieht ihn ganz, und geteilt wird erst **hinter** `t()` — an
 * den Platzhaltern, die in JEDER Sprache dieselben sind. Gerendert wird jedes
 * Stück als `x-text`, also weiterhin als Text und nie als Markup.
 *
 * ── Zwei Feinheiten ─────────────────────────────────────────────────────────
 *  1. `t(key)` wird OHNE `replace` gerufen — sonst wären die Platzhalter schon
 *     weg, bevor hier geteilt werden kann.
 *  2. Die Alternative ist **längster Name zuerst** sortiert, wie `fill()` in
 *     `i18n.ts`. Ohne das schnitte ein gleichzeitig übergebenes `:c` das
 *     `:count` mitten entzwei.
 *
 * Fehlt ein Platzhalter in der Übersetzung, fällt sein Wert weg — dasselbe
 * Verhalten wie bei `t()` mit `replace`, und dagegen steht der Katalog-Test in
 * `tests/Feature/GroupI18nTest.php`.
 */
export const splitSentence = (
    key: string,
    replace: Record<string, string | number>,
    t: Translate,
): Segment[] => {
    const line = t(key)
    const names = Object.keys(replace).sort((a, b) => b.length - a.length)

    if (names.length === 0) {
        return line === '' ? [] : [{ text: line, value: false }]
    }

    const pattern = new RegExp(`(${names.map((n) => `:${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`).join('|')})`)

    return line
        .split(pattern)
        .filter((part) => part !== '')
        .map((part) => {
            const name = part.startsWith(':') ? part.slice(1) : ''

            return Object.prototype.hasOwnProperty.call(replace, name)
                ? { text: String(replace[name]), value: true }
                : { text: part, value: false }
        })
}

/** Die Stücke wieder zu dem einen Satz zusammen — die Textwahrheit dazu. */
export const joinSegments = (segments: Segment[]): string => segments.map((s) => s.text).join('')

/**
 * „Fassung 1.2, beschlossen am 01.03.2024" — der Kopf über den Statuten, in
 * Stücken. Fassung und Datum tragen `value: true` und damit die Auszeichnung.
 *
 * Der Gedankenstrich für einen fehlenden Wert stand vorher im Markup
 * (`x-text="statutesVersion || '—'"`); er gehört zur Formatierung und damit
 * hierher, wo er prüfbar ist.
 */
export const statutesSegments = (version: string, adoptedAt: string, t: Translate): Segment[] =>
    splitSentence('Fassung :version, beschlossen am :date', { version: version || '—', date: adoptedAt || '—' }, t)

/** Derselbe Satz als reiner Text — abgeleitet, damit der Schlüssel EINMAL dasteht. */
export const formatStatutes = (version: string, adoptedAt: string, t: Translate): string =>
    joinSegments(statutesSegments(version, adoptedAt, t))

/** „Das dauert bis zu 24 Stunden." — {@link formatWait} liefert den Einschub. */
export const waitSentenceSegments = (waitText: string, t: Translate): Segment[] =>
    splitSentence('Das dauert :duration.', { duration: waitText }, t)

/** Derselbe Satz als reiner Text — abgeleitet, damit der Schlüssel EINMAL dasteht. */
export const formatWaitSentence = (waitText: string, t: Translate): string =>
    joinSegments(waitSentenceSegments(waitText, t))

// ── Nachfassen ───────────────────────────────────────────────────────────────

/**
 * Der Nachfass-Plan in Sekunden ab dem Auslöser (Zahlung raus bzw. Rückkehr aus
 * dem Checkout). **Neun Nachfassungen über 20 Minuten**, vorne dicht, hinten dünn.
 *
 * ── Warum nicht „alle 15 s in den ersten zwei Minuten" ───────────────────────
 * Weil das Intervall nach den SIGNATUREN bemessen wird, nicht nach dem
 * Rate-Limit. Jede Runde kostet ein frisches NIP-98-Event: bei NIP-07 ein
 * Extension-Aufruf, bei NIP-46 ein Bunker-Roundtrip über ein Relay und bei
 * unbeschränkten Berechtigungen eine Nutzerbestätigung PRO AUFRUF. Ein
 * 15-s-Takt sind acht Bunker-Prompts in zwei Minuten — das ist keine
 * Fortschrittsanzeige, das ist ein Denial-of-Service gegen den eigenen Nutzer.
 *
 * Die Wahrscheinlichkeitsmasse liegt zudem ganz vorne: eine Lightning-Zahlung
 * settled in Sekunden, BTCPay markiert die Invoice unmittelbar danach. Was in
 * den ersten 90 s nicht bestätigt ist, ist mit hoher Wahrscheinlichkeit ein
 * anderer Fall (on-chain, `PaymentReview`, Nutzer hat den Checkout nur
 * geöffnet) — und keiner davon wird durch häufigeres Fragen schneller.
 *
 * ── Gegen die Deckel gerechnet ───────────────────────────────────────────────
 * Der dichteste Abstand ist 20 s → **3 Aufrufe/min im Spitzenfall**. Der
 * Proxy-Eimer erlaubt 10/min pro Session-Pubkey (`AppServiceProvider`) — es
 * bleibt Raum für den `/me`-Abruf und einen Handgriff des Nutzers daneben, ohne
 * dass ein 429 ein bereits erzeugtes Event verbrennt. Instanzweit gilt 30/min:
 * bei 3/min passen zehn gleichzeitige Onboardings hinein, bei den
 * vorgeschlagenen 15 s (4/min) nur sieben. Der Verein selbst deckelt 60/min pro
 * IP für den GESAMTEN Proxy — derselbe Puffer, eine Ebene höher.
 *
 * Insgesamt: höchstens **neun** Signaturen in 20 Minuten statt 23 (8×15 s +
 * 13×60 s) im Vorschlag, bei einer besseren Abdeckung der ersten Minute
 * (0/20/45/90 s statt 0/15/30/45/60 s — vier Runden im selben Fenster, aber die
 * erste Bestätigung kommt genauso schnell).
 *
 * Danach wird NICHT weitergepollt, sondern der Wartezustand sagt, dass der
 * Zugang auch ohne offene App kommt, und bietet einen Knopf für den, der
 * trotzdem jetzt wissen will.
 */
export const FOLLOW_UP_SECONDS: readonly number[] = [0, 20, 45, 90, 180, 300, 600, 900, 1200]

/**
 * Abstand bis zur nächsten Runde (ms), `null` = Plan abgearbeitet.
 *
 * `done` ist die Anzahl der bereits ERLEDIGTEN Runden; der Rückgabewert ist die
 * Wartezeit bis zur Runde mit dem Index `done`. Bei `done = 0` sind das 0 ms —
 * die erste Runde läuft sofort, und das ist kein Schönheitsfehler: ausgelöst
 * wird der Plan, nachdem `payInvoice` mit dem Preimage zurückgekehrt ist, die
 * Zahlung ALSO bereits settled ist. Wer hier 20 s wartet, lässt den Nutzer beim
 * häufigsten Fall grundlos vor einem Spinner sitzen.
 */
export const nextFollowUpDelay = (done: number): number | null => {
    if (done < 0 || done >= FOLLOW_UP_SECONDS.length) {
        return null
    }

    const previous = done === 0 ? 0 : FOLLOW_UP_SECONDS[done - 1]

    return (FOLLOW_UP_SECONDS[done] - previous) * 1000
}

/**
 * Der Abstand bis zur nächsten Runde, wenn der Verein zusätzlich ein
 * `Retry-After` vorgegeben hat. `null` = Schluss.
 *
 * ── Warum das eine eigene Funktion ist und kein `??` an der Aufrufstelle ─────
 * Genau dort stand der Fehler. Die erste Fassung nahm `forced ?? planned`: sobald
 * ein `Retry-After` vorlag, wurde [[nextFollowUpDelay]] **gar nicht mehr
 * befragt** — und das ist die einzige Stelle, die je `null` liefert, also die
 * einzige Abbruchbedingung des ganzen Plans. Solange der Verein mit 429
 * antwortete, lief der Plan damit unbegrenzt weiter, und jede Runde kostete eine
 * frische Signatur (bei NIP-46 einen Bunker-Roundtrip). Am laufenden Client
 * gemessen: bei `Retry-After: 1` 16 Runden in 16 Sekunden ohne Ende.
 *
 * Ein 429 ist der Lastfall — die Bauform machte also ausgerechnet unter Last auf.
 *
 * **Beide Angaben sind untere Schranken für die Wartezeit**, und die Verbindung
 * zweier unterer Schranken ist ihr Maximum, nicht die zuletzt genannte:
 *   - der Plan sagt „nicht ÖFTER als" (Signaturkosten, unser Rate-Limit),
 *   - `Retry-After` sagt „nicht VOR" (das Kontingent des Vereins).
 * Ein kurzes `Retry-After` darf den Plan deshalb nicht beschleunigen, ein langes
 * ihn sehr wohl dehnen. Und weil der Plan IMMER befragt wird, bleibt seine
 * Obergrenze von neun Runden unter jeder Antwort des Vereins erhalten.
 */
export const followUpDelay = (done: number, forcedMs: number | null): number | null => {
    const planned = nextFollowUpDelay(done)

    // Zuerst der Plan. Ist er durch, ist er durch — ein `Retry-After` ist ein
    // Grund, SPÄTER zu fragen, nie ein Grund, überhaupt weiterzufragen.
    if (planned === null) {
        return null
    }

    if (forcedMs === null || !Number.isFinite(forcedMs) || forcedMs <= 0) {
        return planned
    }

    return Math.max(planned, forcedMs)
}

/**
 * Ist ein Nachfassen beim Wiedererscheinen der App fällig?
 *
 * Der In-App-Browser (Custom Tab / SFSafariViewController) kommt NICHT von
 * selbst zurück und es gibt keinen Deep-Link-Handler, der das Schema auswertet.
 * Das einzige Signal, das sicher kommt, ist der Sichtbarkeitswechsel — also
 * fasst der Wartezustand dann selbst nach, statt auf einen Callback zu hoffen,
 * den es nicht gibt.
 *
 * Die Sperre von 20 s verhindert, dass ein App-Wechsel-Karussell jede Rückkehr
 * in eine Signatur übersetzt.
 */
export const RESUME_MIN_GAP_MS = 20_000

export const shouldFollowUpOnResume = (lastAttemptAt: number, now: number): boolean =>
    now - lastAttemptAt >= RESUME_MIN_GAP_MS

// ── Fehler ───────────────────────────────────────────────────────────────────

/**
 * Der sichtbare Ausweg zu einem Fehler. Es gibt **keinen** Fehlerzustand ohne
 * Ausweg — das ist der Grund, warum das ein eigener, geschlossener Typ ist und
 * kein optionales Feld: wer hier einen Fall ergänzt, muss den Ausweg mitnennen,
 * er kann ihn nicht vergessen.
 *
 * - `neu-signieren`   Ausweis untauglich/abgelaufen → neues Event, gleicher Weg.
 * - `neu-anmelden`    Der Ausweis gehört zu einem anderen Konto → Sitzung neu.
 * - `erneut`          Vorübergehend → derselbe Aufruf noch einmal.
 * - `korrigieren`     Eingabe abgelehnt (422) → Felder anzeigen, Nutzer bessert nach.
 * - `abwarten`        429 → `Retry-After` abwarten, dann automatisch weiter.
 * - `neue-rechnung`   Rechnung abgelaufen/verbraucht → neue erzeugen.
 * - `checkout`        In-App-Zahlung gescheitert → Checkout-Zweig.
 * - `extern`          Der Weg im Client trägt nicht mehr → Beitritt im Browser.
 * - `neu-laden`       Sitzung/CSRF abgelaufen → Seite neu laden.
 * - `zurueck`         Falscher Bezugspunkt (z.B. Jahr) → zurück an den Anfang.
 */
export type VereinEscape =
    | 'neu-signieren'
    | 'neu-anmelden'
    | 'erneut'
    | 'korrigieren'
    | 'abwarten'
    | 'neue-rechnung'
    | 'checkout'
    | 'extern'
    | 'neu-laden'
    | 'zurueck'

/**
 * Der Status, auf den `call()` eine undurchsichtige Umleitung abbildet.
 *
 * Ein eigener Wert und nicht einfach `302`: der echte Status ist uns nicht
 * bekannt (der Browser räumt ihn ab), und eine erfundene `302` würde später
 * jemanden glauben lassen, wir hätten sie gelesen. `-302` kann aus keiner
 * HTTP-Antwort kommen und ist damit als „von uns gesetzt" erkennbar.
 */
export const OPAQUE_REDIRECT_STATUS = -302

/**
 * Darf diese Adresse in `window.open` / den In-App-Browser?
 *
 * Nur `http:` und `https:`. Der Grund ist nicht das Öffnen an sich, sondern die
 * HERKUNFT: `checkoutUrl` überlebt den Checkout-Ausflug in `localStorage`, und
 * localStorage gehört nicht uns allein — jedes Skript auf dem Origin und der
 * Nutzer selbst können hineinschreiben. Ein Wert, der einmal durch den Speicher
 * gelaufen ist, ist keine Antwort des Vereins mehr, sondern eine Eingabe.
 *
 * `new URL()` statt eines Präfix-Vergleichs: führende Steuerzeichen, `\t` mitten
 * im Schema und Groß-/Kleinschreibung sind sonst genau die Fälle, an denen eine
 * Zeichenketten-Prüfung vorbeigeht.
 */
export const isSafeExternalUrl = (url: string | null | undefined): boolean => {
    if (typeof url !== 'string' || url === '') {
        return false
    }

    try {
        return ['http:', 'https:'].includes(new URL(url).protocol)
    } catch {
        return false
    }
}

/** Die Adresse, wenn sie taugt — sonst `null`. Ein Aufruf, eine Entscheidung. */
export const safeExternalUrl = (url: string | null | undefined): string | null =>
    isSafeExternalUrl(url) ? (url as string) : null

export type VereinError = {
    status: number
    /** Meldung des Vereins bzw. des Proxys, unverfälscht — sonst ein eigener Satz. */
    message: string
    escape: VereinEscape
    /** Sekunden aus `Retry-After`, nur bei 429. */
    retryAfter?: number
    /** Feldfehler aus einem 422, unverändert durchgereicht. */
    fields?: Record<string, string[]>
}

/**
 * Grenzen, in denen ein `Retry-After` überhaupt als Wartezeit taugt.
 *
 * Nach oben, weil der Wert in einen `setTimeout` geht: Browser rechnen die
 * Verzögerung auf ein vorzeichenbehaftetes 32-Bit-Feld herunter, und alles über
 * 2^31−1 ms läuft über und feuert **sofort**. Aus „bitte in 31 Jahren wieder"
 * wird so „bitte jetzt, und zwar in einer Schleife" — am laufenden Client
 * gemessen: 1233 `POST …/refresh` in 5 Sekunden bei `Retry-After: 999999999999`.
 * Ein Header, der von der Gegenseite kommt, darf nie ungeprüft eine Zeitspanne
 * werden.
 *
 * Nach unten, weil ein `Retry-After: 0` die Bremse ganz löste. Die eigentliche
 * Deckelung ist ohnehin der Plan ([[followUpDelay]]) — diese Klammer ist die
 * zweite Sicherung daneben, nicht die erste.
 *
 * 600 s ist zugleich die Grenze, ab der die Angabe für den Nutzer nichts mehr
 * bedeutet: der Wartezustand sagt ihm dann ohnehin, dass der Zugang auch ohne
 * offene App kommt.
 */
export const RETRY_AFTER_MIN_SECONDS = 1

export const RETRY_AFTER_MAX_SECONDS = 600

export const clampRetryAfter = (seconds: number): number => {
    if (!Number.isFinite(seconds)) {
        return RETRY_AFTER_MIN_SECONDS
    }

    return Math.min(RETRY_AFTER_MAX_SECONDS, Math.max(RETRY_AFTER_MIN_SECONDS, Math.ceil(seconds)))
}

/** `Retry-After` ist laut RFC 9110 Sekunden ODER ein HTTP-Datum — beides lesen. */
export const parseRetryAfter = (header: string | null, now = Date.now()): number | undefined => {
    if (!header) {
        return undefined
    }

    const seconds = Number(header.trim())
    if (Number.isFinite(seconds) && seconds >= 0) {
        return Math.ceil(seconds)
    }

    const at = Date.parse(header)
    if (Number.isNaN(at)) {
        return undefined
    }

    return Math.max(0, Math.ceil((at - now) / 1000))
}

/**
 * HTTP-Antwort → Fehler mit Ausweg.
 *
 * Die Statuscodes sind die des Proxys aus P4, der die des Vereins unverfälscht
 * durchreicht. **401 ist ununterscheidbar** — alle NIP-98-Verfehlungen (falsche
 * Methode, falscher `u`, abgelaufen, Signatur, Replay) kommen dort an. Genau
 * deshalb ist der Ausweg für alle derselbe und der einzige, der immer trägt:
 * neu signieren. Ein Retry mit DEMSELBEN Event wäre sinnlos — der Verein hat
 * die Event-ID nach dem ersten Versuch für 150 s verbrannt.
 *
 * `body` wird so genommen, wie es kommt; ist keine Meldung darin, steht ein
 * eigener Satz da statt eines rohen Statuscodes.
 */
export const mapVereinError = (
    status: number,
    body: unknown,
    retryAfterHeader: string | null,
    t: (key: string, replace?: Record<string, string | number>) => string,
    now = Date.now(),
): VereinError => {
    const payload = (body ?? {}) as { message?: unknown; errors?: unknown }
    const remote = typeof payload.message === 'string' && payload.message !== '' ? payload.message : null
    const fields =
        payload.errors && typeof payload.errors === 'object' ? (payload.errors as Record<string, string[]>) : undefined

    const of = (escape: VereinEscape, fallback: string, extra: Partial<VereinError> = {}): VereinError => ({
        status,
        message: remote ?? fallback,
        escape,
        ...extra,
    })

    if (status === 401) {
        return of('neu-signieren', t('Der Ausweis wurde abgelehnt. Bitte noch einmal signieren.'))
    }

    if (status === 403) {
        return of('neu-anmelden', t('Dieser Vorgang gehört zu einem anderen Schlüssel. Bitte neu anmelden.'))
    }

    if (status === 404) {
        return of('zurueck', t('Der Verein kennt diesen Vorgang nicht (mehr).'))
    }

    if (status === 419) {
        return of('neu-laden', t('Die Sitzung ist abgelaufen. Bitte die Seite neu laden.'))
    }

    if (status === 415) {
        return of('erneut', t('Die Anfrage wurde nicht angenommen.'))
    }

    if (status === 422) {
        return of('korrigieren', t('Bitte die Angaben prüfen.'), { fields })
    }

    if (status === 429) {
        // GEKLAMMERT, nicht roh übernommen: der Wert kommt von der Gegenseite und
        // wird bei uns zu einer Zeitspanne und zu einer angezeigten Zahl. Siehe
        // [[clampRetryAfter]] für den gemessenen Überlauf.
        return of('abwarten', t('Zu viele Anfragen. Bitte einen Moment warten.'), {
            retryAfter: clampRetryAfter(parseRetryAfter(retryAfterHeader, now) ?? 30),
        })
    }

    if (status === 503) {
        return of('extern', t('Die Vereins-Anbindung ist gerade nicht verfügbar.'))
    }

    if (status === 504) {
        return of('erneut', t('Der Verein hat nicht rechtzeitig geantwortet.'))
    }

    /*
     * Umleitung. Der Proxy reicht ein 3xx unverfälscht durch, hält den
     * `Location`-Header aber zurück (er würde uns an ein Ziel schicken, das der
     * Verein bestimmt). Für den Client ist das eine Antwort, mit der er nichts
     * anfangen kann — der ehrliche Ausweg ist der Weg im Browser.
     *
     * ── Achtung: dieser Zweig sieht den echten Statuscode NIE ──────────────
     * `call()` fetcht mit `redirect: 'manual'`. Im BROWSER liefert das nach der
     * Fetch-Spezifikation eine undurchsichtige Antwort: `status` ist `0`, `type`
     * ist `'opaqueredirect'`, die Header sind abgeräumt — ein `status >= 300`
     * wäre hier also für immer unerreichbar gewesen. (In Node liefert dieselbe
     * Option `status: 302, type: 'basic'`; genau daran ist eine frühere Prüfung
     * vorbeigelaufen. Maßgeblich ist der Browser.)
     *
     * Deshalb normalisiert `call()` eine `opaqueredirect`-Antwort auf
     * [[OPAQUE_REDIRECT_STATUS]], und dieser Zweig prüft darauf mit. Die Absicht
     * bleibt erhalten, der Zweig ist erreichbar, und der Kommentar stimmt.
     */
    if (status === OPAQUE_REDIRECT_STATUS || (status >= 300 && status < 400)) {
        return of('extern', t('Der Verein hat unerwartet weitergeleitet.'))
    }

    return of('erneut', t('Unerwartete Antwort vom Verein.'))
}

/**
 * Die Beschriftung des Auswegs — je Fall genau eine, und für jeden Fall eine.
 *
 * Bewusst eine `switch` über den geschlossenen Typ statt einer Tabelle mit
 * Rückfall: ein neuer Ausweg ohne Beschriftung ist damit ein Typfehler und kein
 * leerer Knopf. Ein Fehlerzustand mit unbeschriftetem Ausweg ist praktisch ein
 * Fehlerzustand ohne Ausweg.
 */
export const escapeLabel = (escape: VereinEscape, t: (key: string) => string): string => {
    switch (escape) {
        case 'neu-signieren':
            return t('Neu signieren')
        case 'neu-anmelden':
            return t('Neu anmelden')
        case 'erneut':
            return t('Erneut versuchen')
        case 'korrigieren':
            return t('Angaben korrigieren')
        case 'abwarten':
            return t('Gleich noch einmal versuchen')
        case 'neue-rechnung':
            return t('Neue Rechnung erzeugen')
        case 'checkout':
            return t('Im Browser bezahlen')
        case 'neu-laden':
            return t('Seite neu laden')
        case 'zurueck':
            return t('Zurück zum Anfang')
        case 'extern':
            return t('Beitritt im Browser öffnen')
    }
}

// ── Rechnung ─────────────────────────────────────────────────────────────────

/** Die Antwort auf `POST /payments/{year}/invoice`, so weit der Client sie kennt. */
export type InvoiceData = { bolt11: string | null; checkoutUrl: string | null; invoiceId: string | null }

/**
 * Rechnung aus der Antwort lesen — **additiv**, wie P3 es zugesichert hat.
 *
 * `bolt11` ist `null`-fähig (on-chain-only oder Lightning-Methode abgelaufen;
 * P2 hat es in 4 von 239 echten Invoices gemessen) UND kann in einer Instanz,
 * die den P3-Stand noch nicht ausliefert, komplett FEHLEN. Beide Fälle sind
 * hier derselbe Fall und führen beide in den Checkout-Zweig — deshalb wird auf
 * „nicht-leerer String" geprüft und nicht auf `'bolt11' in data`.
 *
 * Die Checkout-Adresse heißt beim Verein je nach Fassung `checkout_url` oder
 * `checkoutLink`; beide werden gelesen, damit ein Feldnamen-Detail nicht den
 * einzigen verbliebenen Zahlweg abschneidet.
 */
export const readInvoice = (body: unknown): InvoiceData => {
    const root = (body ?? {}) as { data?: unknown }
    const data = ((root.data ?? root) ?? {}) as Record<string, unknown>

    const str = (...keys: string[]): string | null => {
        for (const key of keys) {
            const value = data[key]
            if (typeof value === 'string' && value.trim() !== '') {
                return value.trim()
            }
        }

        return null
    }

    return {
        bolt11: str('bolt11'),
        checkoutUrl: str('checkout_url', 'checkoutUrl', 'checkoutLink', 'url'),
        invoiceId: str('invoice_id', 'invoiceId', 'id'),
    }
}

/**
 * In der App zahlen oder in den Checkout? Beides muss gehen, und die Weiche darf
 * nicht raten: **nur** eine vorhandene BOLT11 UND eine verbundene Wallet führen
 * in die App. Alles andere — kein Feld, `null`, leerer String, keine Wallet —
 * führt in den Checkout.
 */
export const canPayInApp = (invoice: InvoiceData, hasWallet: boolean): boolean =>
    hasWallet && typeof invoice.bolt11 === 'string' && invoice.bolt11 !== ''

// ── /me ──────────────────────────────────────────────────────────────────────

export type MeData = {
    statutesAccepted: boolean
    paid: boolean
    year: number | null
    fee: number | null
    currency: string | null
    receiptUrl: string | null
    status: string | null
}

/** `/me` lesen. Fehlende Felder sind „nicht bekannt", nie „nein". */
export const readMe = (body: unknown): MeData => {
    const root = (body ?? {}) as { data?: unknown }
    const data = ((root.data ?? root) ?? {}) as Record<string, unknown>
    const year = (data.current_year ?? {}) as Record<string, unknown>

    return {
        statutesAccepted: typeof data.statutes_accepted_at === 'string' && data.statutes_accepted_at !== '',
        paid: year.paid === true,
        year: typeof year.year === 'number' ? year.year : null,
        fee: typeof year.fee === 'number' ? year.fee : null,
        currency: typeof year.currency === 'string' ? year.currency : null,
        receiptUrl: typeof year.receipt_url === 'string' && year.receipt_url !== '' ? year.receipt_url : null,
        status: typeof data.association_status === 'string' ? data.association_status : null,
    }
}

export type ConfigData = {
    fee: number | null
    currency: string | null
    /** Das EINZIGE Jahr, das der Invoice-Endpunkt annimmt — nie `new Date()`. */
    year: number | null
    statutesUrl: string | null
    statutesVersion: string | null
    statutesAdoptedAt: string | null
    applicationTextMax: number
    optionalFields: string[]
}

/**
 * `/config` lesen.
 *
 * `year` kommt aus der Antwort und wird NICHT aus der Uhr des Browsers
 * abgeleitet: der Invoice-Endpunkt nimmt genau dieses eine Jahr an, und am
 * 1. Januar um 00:05 wäre die Browser-Uhr die falsche Quelle — der Nutzer bekäme
 * einen 404 auf einen Vorgang, den es gibt.
 */
export const readConfig = (body: unknown): ConfigData => {
    const root = (body ?? {}) as { data?: unknown }
    const data = ((root.data ?? root) ?? {}) as Record<string, unknown>
    const statutes = (data.statutes ?? {}) as Record<string, unknown>
    const application = (data.application ?? {}) as Record<string, unknown>

    const text = (value: unknown): string | null => (typeof value === 'string' && value !== '' ? value : null)

    return {
        fee: typeof data.fee === 'number' ? data.fee : null,
        currency: text(data.currency),
        year: typeof data.year === 'number' ? data.year : null,
        statutesUrl: text(statutes.url),
        statutesVersion: text(statutes.version),
        statutesAdoptedAt: text(statutes.adopted_at),
        applicationTextMax: typeof application.application_text_max_length === 'number' ? application.application_text_max_length : 2000,
        optionalFields: Array.isArray(application.optional_fields)
            ? application.optional_fields.filter((f): f is string => typeof f === 'string')
            : [],
    }
}

/**
 * Der Antrags-Body — **als String**, denn genau dieser String wird gehasht UND
 * gesendet. Ein zweites `JSON.stringify` bräche den `payload`-Tag.
 *
 * `pubkey`, `npub` und `key` stehen bewusst NICHT drin und dürfen es nie: der
 * Verein antwortet darauf mit 403. Der handelnde Schlüssel kommt aus dem
 * signierten Ausweis, nicht aus dem Inhalt — das ist die ganze Idee.
 */
export const applicationBody = (input: {
    applicationText?: string
    email?: string
    noEmail?: boolean
    nip05?: string
}): string => {
    const body: Record<string, string | boolean> = { statutes_accepted: 'accepted' }

    const text = input.applicationText?.trim()
    if (text) {
        body.application_text = text
    }

    const email = input.email?.trim()
    if (email) {
        body.email = email
    }

    if (input.noEmail) {
        body.no_email = true
    }

    const nip05 = input.nip05?.trim()
    if (nip05) {
        body.nip05_handle = nip05
    }

    return JSON.stringify(body)
}

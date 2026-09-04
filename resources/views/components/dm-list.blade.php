@props([
    // Alpine-Ausdruck, der wahr ist, solange diese Fläche GEBRAUCHT wird. Er entscheidet
    // über die EXISTENZ des Knotens, nicht über seine Sichtbarkeit — siehe unten.
    'show' => 'true',
])

{{-- ── Die Unterhaltungen in der Raumliste (mobile Erreichbarkeit) ──────────────────

     Bis hierher gab es die Direktnachrichten an genau ZWEI Orten, und beide sind auf
     einem Telefon nicht da: die Gruppe in `desktop-rail.blade.php` (die Rail rendert der
     NativePHP-Host serverseitig nie und der Web-Client erst ab `xl`) und die Liste IM
     Dialog, die man nur sieht, während man eine neue Unterhaltung eröffnet. Wer auf dem
     Telefon eine bestehende Unterhaltung suchte, hatte keinen Weg dorthin — die Glocke
     führt auf `/updates`, und das ist eine Liste von Hinweisen, keine von Gesprächen.
     Eine NEUE eröffnen ging gar nicht.

     ── Warum ein ABSCHNITT der Raumliste und kein dritter Tab ──────────────────────
     Der erste Entwurf war ein dritter Eintrag „Direkt" in der Segmented-Bar. Er ist an
     einer Messung gescheitert, nicht an einer Meinung: die Bar ist `inline-flex` und
     schrumpft nicht, ihre drei Einträge messen zusammen **314 px** (je Tab 32 px
     Polster + 20 px Icon + 8 px Lücke + Text; Text 35/49/42 px in Inconsolata 14 px),
     die Inhaltsspalte bei 320 px Fenster misst **288 px**. Ergebnis am gerenderten
     Element: `document.scrollWidth` 330 gegen `clientWidth` 320 — 10 px waagerechter
     Überlauf, und das auf der Hauptfläche des Clients. Mit zwei Einträgen sind es 212 px;
     die Bar ist also schon vor dieser Änderung zu 74 % gefüllt.

     Drei Auswege wurden durchgerechnet und verworfen: Icons weglassen (−84 px, passt —
     nimmt aber eine ausdrückliche Entscheidung samt mutationsgeprüftem Test zurück,
     `OrtskartenTest` „Threads-Tab und Chat-Ortskarte zeigen verschiedene Zeichen"),
     Polster auf `px-2` (passt — verliert aber gegen Flux' eigenes `px-4`: beide sind
     Tailwind-Utilities gleicher Spezifität, und im gebauten Bundle steht `.px-4` bei Byte
     70292, `.px-2` bei 70086, also gewinnt `px-4`), und die Bar scrollen zu lassen (ein
     Eintrag, den man wegschieben muss, ist kein Einstieg).

     **Der Abschnitt ist ohnehin der bessere Ort, und das hat einen zweiten, härteren
     Grund als die Breite.** `$store.unread.roomsTotal` — die Pille am Tab „Räume" —
     zählt die Unterhaltungen HEUTE SCHON mit: `countedRoomHsOf` (`bridge.ts`) faltet
     `dmRooms` ausdrücklich ein. Der Tab behauptete also Ungelesenes, das seine Liste
     nirgends zeigte. Ein eigener Tab daneben hätte diesen Widerspruch verdoppelt; der
     Abschnitt löst ihn auf: die Pille zählt, was darunter steht.

     ── `x-if` und nicht `xl:hidden`, obwohl die Nachbarabschnitte es umgekehrt tun ──
     Die Nachbarn („Meine Räume", „Andere Räume") verstecken sich ab `xl` per CSS, mit
     der ausdrücklichen Begründung, eine `x-if`-Bedingung wäre eine zweite Wahrheit über
     den Breakpoint. Für sie stimmt das: sie kosten nichts, wenn sie unsichtbar sind.

     Dieser Abschnitt kostet etwas. Er meldet über `armList()` eine Ableitung an, und
     **Alpine initialisiert `x-data` auch in Elementen, die per CSS versteckt sind** —
     dieselbe Falle, wegen der `desktop-rail` in einem `<template x-if>` steht. Per
     `xl:hidden` versteckt zahlte jede Desktop-Ansicht für eine Liste, die dort die Rail
     zeigt. Die Bedingung liest `$store.viewport.desktop`, also genau die eine
     `matchMedia`-Wahrheit aus `viewport.ts` — keine zweite.

     ── Warum es KEINEN Leerzustand „dieser Space kann keine DMs" gibt ──────────────
     Weil ein Abschnitt, den es nicht gibt, die ehrlichere Auskunft ist. Ein Tab muss
     immer dastehen und deshalb erklären, warum er leer ist; ein Abschnitt in einer Liste
     darf schlicht fehlen. Auf einem zooid-Space gibt es keine Unterhaltungen und keinen
     Knopf — und keine Zeile, die über etwas spricht, das es hier nicht gibt.

     Aus demselben Grund kein Skelett, solange das NIP-11-Doc fehlt: ein Skelett sagt
     „hier kommt gleich etwas" zu, und für diesen Abschnitt ist die Zusage nicht gedeckt.

     ── Was diese Fläche NICHT kann, und warum ──────────────────────────────────────
     Erweitern und Ausblenden je Zeile. Beides steht im Dialog, einen Tap entfernt, und
     beides ist eine Handlung, die im Jahr zweimal vorkommt. Drei Ziele in einer
     320-px-Zeile hießen entweder Ziele unter 44 px oder eine zweizeilige Zeile.
     Dieselbe Abwägung, die der Dialog für die Rail-Zeile schon einmal getroffen hat.

     Und sie sagt NICHTS über Verschlüsselung. Der Satz „Nachrichten liegen
     unverschlüsselt auf diesem Relay" steht im Dialog, also dort, wo eine Unterhaltung
     ENTSTEHT. Zweimal dieselbe Zusage an zwei Orten ist der Anfang von zwei Fassungen
     davon.

     Der Zähler in `armList()` ist kein Zierrat: der Dialog wird VON dieser Fläche aus
     geöffnet und meldet dieselbe Liste ein zweites Mal an. Ohne den Zähler räumte das
     erste `closeDialog()` die Liste ab, in die der Nutzer gerade schaut
     (`js/dmListArming.test.ts`, mutationsgeprüft). --}}
<template x-if="{{ $show }}">
    <div data-dm-panel x-data="{
             init() { $store.dms?.armList() },
             destroy() { $store.dms?.disarmList() },
         }">

        {{-- Der ganze Abschnitt entsteht nur, wenn es etwas zu zeigen oder zu tun gibt:
             Zeilen, oder das Recht, eine Unterhaltung zu eröffnen. --}}
        <template x-if="($store.dms?.conversations ?? []).length > 0 || $store.dms?.canDm">
            <div class="mt-2">

                {{-- Sektionskopf in der Form der Nachbarn: Beschriftung, Bestand als
                     graue Zahl daneben. Die Zahl steht INLINE hinter der Beschriftung und
                     nicht rechtsbündig — dieselbe Entscheidung wie bei „Meine Räume" und
                     „Andere Räume", und aus demselben Grund: sie beschreibt genau das, was
                     unmittelbar darunter steht.

                     Der Eröffnen-Knopf sitzt rechts in derselben Zeile. `min-h-11` (44 px)
                     steht an der ZEILE und nicht am Knopf: der Kopf behält seine Höhe auch
                     dann, wenn der Knopf fehlt (kein `canDm`) — sonst spränge die Liste,
                     sobald die NIP-11-Antwort eintrifft. --}}
                <div class="flex min-h-11 items-center justify-between gap-2 px-2">
                    <p class="flex min-w-0 items-baseline gap-1.5 text-[0.7rem] font-semibold uppercase tracking-wider text-muted">
                        <span class="truncate">{{ __('Direktnachrichten') }}</span>
                        <span x-show="($store.dms?.conversations ?? []).length > 0" x-cloak
                              class="font-normal normal-case tabular-nums tracking-normal"
                              x-text="($store.dms?.conversations ?? []).length"></span>
                    </p>

                    {{-- Am `canDm` und nicht an `dmSupport`: der Knopf ist eine SCHREIB-
                         Handlung, und ohne Signer-Sitzung führte er in eine Signatur, die
                         nie kommt. Icon-only mit `aria-label` — die Beschriftung „Neue
                         Unterhaltung" kostete in einer 288-px-Spalte neben dem Sektionskopf
                         mehr Platz, als sie erklärt, und dasselbe Zeichen (`pencil-square`)
                         trägt die Rail an derselben Stelle. --}}
                    <flux:button x-show="$store.dms?.canDm" x-cloak size="sm" variant="ghost" icon="pencil-square"
                                 class="icon-btn-touch shrink-0" data-dm-neu
                                 aria-label="{{ __('Neue Unterhaltung') }}"
                                 x-on:click="$store.dms.openNew()" />
                </div>

                {{-- Kein eigener Leerzustand, wenn nur der Knopf dasteht: die Zeile
                     „Direktnachrichten +" sagt bereits alles, was ein Satz sagen würde,
                     und ein Leerzustand mitten in einer Liste anderer Abschnitte wäre eine
                     zweite Karte in einer Karte (dieselbe Regel wie beim gated-Zustand und
                     beim Meetup-Filter in derselben Karte). --}}
                <div class="space-y-0.5">
                    <template x-for="room in ($store.dms?.conversations ?? [])" :key="room.h">
                        {{-- **Niemals `room.name`** — der Relay speichert für JEDE
                             Unterhaltung wörtlich `"DM"` (`buzz-db/src/dm.rs:157-162`),
                             eine Liste daraus wäre eine Spalte identischer Zeilen.
                             `displayName` löst die Beteiligten auf und stößt die fehlenden
                             Profile selbst an; weil es `self.names` liest, läuft dieser
                             Ausdruck neu, sobald eines eintrifft.

                             Kein `aria-label` am Knopf: sein Kindtext IST der Name, und die
                             Ungelesen-Pille bringt ihren sr-Text mit. Ein Label hier
                             ersetzte beide und müsste sie nachbauen — dieselbe Regel wie in
                             `room-tile`.

                             Der Avatar bekommt bewusst KEIN Bild: eine Unterhaltung hat
                             keins, und die Bilder der Beteiligten lägen nur vor, solange
                             der Dialog armiert ist. Die Initiale aus dem aufgelösten Namen
                             ist die Auskunft, die ohne zweite Datenquelle stimmt — und sie
                             unterscheidet die Zeile auf einen Blick von der `#`-Kachel der
                             Räume darüber. --}}
                        <button type="button" data-dm-row
                                x-on:click="$store.dms.openConversation(room)"
                                class="pressable flex min-h-11 w-full items-center gap-2.5 rounded-tile p-1.5 text-start transition-colors hover:bg-zinc-100 dark:hover:bg-zinc-800">
                            <x-group::nostr-avatar picture="''" name="$store.dms.displayName(room)" size="2rem" />
                            <span class="min-w-0 flex-1 truncate font-medium" x-text="$store.dms.displayName(room)"></span>
                            <x-group::unread-badge count="$store.unread?.rooms?.[room.h]" />
                            <flux:icon.chevron-right class="size-4 shrink-0 text-zinc-400" />
                        </button>
                    </template>
                </div>
            </div>
        </template>
    </div>
</template>

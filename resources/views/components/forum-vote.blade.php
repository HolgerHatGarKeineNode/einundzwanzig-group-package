{{-- ══ Bewertung eines Forum-Themas (kind 45002, P3) ═══════════════════════════

     Eine schmale Spalte links neben der Themenkarte: Pfeil hoch, Punktstand,
     Pfeil runter.

     ── Warum NEBEN der Karte und nicht darin ─────────────────────────────────
     Weil die Karte selbst ein `<button>` ist (ein Thema hat genau ein Ziel, also
     genau eine Trefferfläche) und ein Knopf im Knopf kein gültiges HTML ist. Der
     Browser bricht das verschachtelte Element aus dem Elternteil heraus, und was
     danach im Baum steht, hat mit dem Quelltext nichts mehr zu tun. Die Spalte
     ist deshalb ein Geschwister der Karte in derselben Listenzeile.

     ── Die Zahl kommt von UNS, nicht vom Relay ───────────────────────────────
     Der Relay ZÄHLT 45002 nicht. Ausserhalb von `kind.rs` und `ingest.rs` liegt
     jedes Vorkommen des Kinds im Relay-Repo in `#[cfg(test)]`: kein Leser, keine
     Aggregation, kein synthetisiertes Zusammenfassungs-Ereignis. Was hier steht,
     hat `foldForumVotes` (`js/forumModels.ts`) aus den einzelnen Ereignissen
     gerechnet — pro `(pubkey, ziel)` gewinnt die jüngste Stimme, alle älteren
     fallen weg. Wer diese Zahl je gegen eine Serverangabe stellen will, wird
     keine finden.

     ── Warum die Pfeile fehlen dürfen, ohne dass die Zahl fehlt ──────────────
     Lesen darf jeder, der den Kanal sieht; schreiben nur ein Mitglied auf einem
     Buzz-Space. `canVote` trägt die RELAY-Frage (`mayWriteKind`, fail-closed:
     `'unknown'` sperrt, solange das NIP-11-Doc unterwegs ist), `joined` die
     Mitgliedschaft — dasselbe Feld, an dem schon der Themen-Composer hängt. Ohne
     beides bleibt die Spalte eine Anzeige. Ein Knopf, der garantiert scheitert,
     ist schlimmer als keiner.

     ── Es gibt keinen Weg zurück auf „keine Stimme", und das ist entschieden ──
     Ein zweiter Klick auf den bereits gewählten Pfeil schreibt NICHTS
     (`planForumVote` verweigert ihn) — er hebt die Stimme nicht auf. Die
     Begründung steht bei `planForumVote` in `js/forumVoteModels.ts`: ein dritter
     `content`-Wert wäre ein privater Dialekt in einem geteilten Kanal (der Relay
     validiert `content` gar nicht), und ein kind-5-Grabstein scheitert genau im
     wichtigen Fall — welshmans Repository wendet ihn nur bei STRIKT grösserem
     `created_at` an, und die Rücknahme eines Fehlklicks trägt dieselbe Sekunde.
     Deshalb trägt der aktive Pfeil `aria-pressed="true"` und bleibt bedienbar,
     statt ein Aufheben anzudeuten, das nicht stattfindet.

     ── Zählung ───────────────────────────────────────────────────────────────
     Eine Komponente, also bewusst nicht in der ARIA-Trägerzählung von
     `tests/Feature/EmptyStatesAndA11yTest.php` (`'room' => 37`) — dieselbe Regel
     und derselbe Grund wie beim Lightbox-Overlay, den Ortskarten und den zwei
     Themen-Composer-Bauformen. --}}
@props(['topic' => 'topic'])
{{-- `w-11` = 2,75 rem = 44 px, und das ist gerechnet, nicht geschätzt: `icon-btn-touch`
     setzt auf grobem Pointer `min-width: 2.75rem` (`theme.css:216-220`). Eine schmalere
     Spalte — `w-10` stand hier zuerst — liesse den Knopf auf dem Telefon um 4 px über
     seine Spalte hinauslaufen und in die Karte daneben drücken. Am Desktop bleibt der
     Knopf 24 px (Flux `size="xs"`, WCAG 2.5.8 erfüllt) und sitzt zentriert darin. --}}
<div class="flex w-11 shrink-0 flex-col items-center justify-start gap-0.5 pt-1" data-forum-vote-spalte>
    {{-- `x-if` und nicht `x-show`: die Knöpfe tragen `data-`-Haken, und ein per
         CSS verstecktes Duplikat wäre in `getByRole`/`locator` ein
         Strict-Mode-Treffer auf zwei Elemente. --}}
    <template x-if="canVote && joined">
        <flux:button size="xs" variant="ghost" square icon="chevron-up"
                     class="icon-btn-touch"
                     data-forum-vote="up"
                     x-bind:aria-pressed="({{ $topic }}).myVote === 1 ? 'true' : 'false'"
                     x-bind:aria-label="@js(__('Thema :title befürworten')).split(':title').join(({{ $topic }}).title || @js(__('Ohne Titel')))"
                     x-on:click="voteTopic({{ $topic }}, 1)" />
    </template>

    {{-- Der Punktstand. `brand-800` und nicht `brand-700`, wenn er die eigene
         Stimme trägt: die Farbe trägt hier TEXT (WCAG 1.4.3, 4,5:1), und
         brand-700 (#c2570b) hält auf dem hellen Seitenrumpf nur ~4,0:1 — das ist
         dieselbe Rollenregel wie am Sortier-Chip der Artikelliste
         („brand-700 = Linie/Grafik, brand-800 = Text", `theme.css`). Der dunkle
         Zweig nimmt brand-400 (8,95:1 auf zinc-900/950). --}}
    <span class="text-sm font-semibold tabular-nums"
          x-bind:class="({{ $topic }}).myVote !== 0 ? 'text-brand-800 dark:text-brand-400' : 'text-zinc-700 dark:text-zinc-300'">
        {{-- Ohne diesen Vorspann läse eine Sprachausgabe an dieser Stelle nur
             eine nackte Zahl zwischen zwei Pfeilen. --}}
        <span class="sr-only">{{ __('Punkte:') }}</span>
        <span data-forum-score x-text="({{ $topic }}).score"></span>
    </span>

    <template x-if="canVote && joined">
        <flux:button size="xs" variant="ghost" square icon="chevron-down"
                     class="icon-btn-touch"
                     data-forum-vote="down"
                     x-bind:aria-pressed="({{ $topic }}).myVote === -1 ? 'true' : 'false'"
                     x-bind:aria-label="@js(__('Thema :title ablehnen')).split(':title').join(({{ $topic }}).title || @js(__('Ohne Titel')))"
                     x-on:click="voteTopic({{ $topic }}, -1)" />
    </template>
</div>

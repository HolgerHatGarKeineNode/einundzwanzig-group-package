@props([
    /** Alpine-Ausdruck → Array aus `{ pubkey, name, picture }` (aus `peopleOf`). */
    'personen',
    /** Wie viele Gesichter, bevor „+n" übernimmt. */
    'deckel' => 3,
    /**
     * Vorlesetext, `:count` und `:namen` werden ersetzt. Er trägt die ganze
     * Auskunft — der Stapel selbst ist für die Sprachausgabe stumm.
     */
    'srEins',
    'srViele',
    /**
     * Der Anker, den JEDES Gesicht trägt (`data-forge-assignee` bzw.
     * `data-forge-reviewer`). Er ist E2E-bewacht und muss den Umbau überleben:
     * bis P3 sass er am Personen-CHIP, seither am Platz im Stapel.
     */
    'anker',
    /**
     * Optional: Alpine-Ausdruck für die Review-Entscheidung je Person
     * (`'approved'` · `'changes-requested'` · sonst leer). Ohne diesen Prop
     * entsteht keine Plakette.
     */
    'entscheidung' => null,
])

{{-- ── PERSONEN ALS GESICHTER, NICHT ALS CHIPS (P3, 2026-08-26) ───────────────
     Bis P3 standen Assignees und Reviewer als eigene BLOCKZEILEN unter dem
     Titel, jede mit einem vorangestellten Versalwort („ZUGEWIESEN", „REVIEWER")
     und danach bis zu sechs Chips. Zwei Zeilen, die keine Zeile brauchen.

     ── Warum das die Chip-Frage mitlöst ───────────────────────────────────────
     Drei bedeutungsverschiedene Chips waren byte-gleich: Label, Assignee und
     Reviewer trugen identisch `rounded-pill bg-zinc-100 px-2 py-0.5
     text-[0.7rem] text-muted`, unterschieden nur durch das Wort davor — und das
     Label hatte gar keins. In einer PR-Zeile mit Labels UND Reviewern standen
     bis zu zwölf gleich aussehende Chips nebeneinander.

     Nach P3 trägt jede Rolle eine eigene FORM, nicht ein eigenes Wort:
       · Label   → Pille (`flux:badge variant="pill"`), im Titelrang
       · Anker   → Rechteck mit Mono-Ziffern (Commit/Branch), in der Metazeile
       · Person  → RUNDES Gesicht, gestapelt — dieses Bauteil
     Drei Formen, drei Bedeutungen. Wer die Zeile überfliegt, muss nichts lesen,
     um sie auseinanderzuhalten.

     ── Die Sprachausgabe hört EINEN Satz ──────────────────────────────────────
     Der Stapel ist `aria-hidden`: drei Avatare plus „+9" sind für sie keine
     vier Elemente, sondern eine Auskunft („3 Zuständige: Anna, Bo, Cem").
     Dieselbe Bauform wie am Maintainer-Stapel der Übersicht.

     ── Kein Avatar für rohe Schlüssel — und warum es hier trotzdem geht ───────
     `⚡forge-repo` warnte an dieser Stelle einmal, die Initiale käme bei
     fehlendem Profil aus einem `npub`-Zeichen. Das stimmt, und es ist
     hinnehmbar: `nameOf()` liefert nie die rohe Hex-Kette, sondern die gekürzte
     `npub`-Form, und der Stapel läuft schon seit P6 (Maintainer) genau so. Der
     volle Schlüssel steht im `title`, der Name im Vorlesetext. --}}
<span {{ $attributes->class('inline-flex items-center') }}>
    <span class="forge-stapel" aria-hidden="true">
        <template x-for="person in ({{ $personen }}).slice(0, {{ $deckel }})" :key="person.pubkey">
            <span class="forge-stapel-platz relative" {{ $anker }}
                  :data-pubkey="person.pubkey"
                  @if ($entscheidung !== null) :data-entscheidung="{{ $entscheidung }}" @endif
                  :title="person.name + ' · ' + person.pubkey">
                <x-group::nostr-avatar picture="person.picture" name="person.name" size="1.25rem" />
                @if ($entscheidung !== null)
                    {{-- Die Entscheidung als PLAKETTE am Gesicht, nicht als zweiter Chip
                         daneben: sie gehört zu DIESER Person, und eine Plakette sagt das
                         ohne ein Wort dazwischen.

                         Die Aussage hängt an der FORM (Häkchen bzw. Ausrufezeichen), nicht
                         an der Farbe — WCAG 1.4.1 bleibt erfüllt, auch wenn die beiden
                         Forge-Token daneben die Rolle einfärben. Der Ring in Kartenfarbe
                         stanzt die Plakette vom Avatar frei, damit sie auch auf einem
                         dunklen Profilbild lesbar bleibt (dieselbe Bauform wie die
                         Status-Plakette in `nostr-avatar`). --}}
                    <template x-if="({{ $entscheidung }}) === 'approved'">
                        <span class="forge-plakette text-forge-erledigt">
                            <flux:icon.check variant="micro" class="size-3" />
                        </span>
                    </template>
                    {{-- `arrow-uturn-left` und NICHT `exclamation-circle`: das
                         Ausrufezeichen im Kreis bedeutet in derselben Zeile schon
                         „Zustand: offen" (Zustandspille, P1). Der Pfeil zurück sagt,
                         was hier wirklich passiert ist — der Vorgang geht an den
                         Autor zurück. Dasselbe Zeichen trägt der Knopf, der es
                         auslöst („Änderungen erbitten"): eine Handlung behält ihr
                         Zeichen über den ganzen Weg. --}}
                    <template x-if="({{ $entscheidung }}) === 'changes-requested'">
                        <span class="forge-plakette text-forge-offen">
                            <flux:icon.arrow-uturn-left variant="micro" class="size-3" />
                        </span>
                    </template>
                @endif
            </span>
        </template>
        <template x-if="({{ $personen }}).length > {{ $deckel }}">
            <span class="ms-1 text-[0.7rem] font-semibold text-muted"
                  x-text="'+' + (({{ $personen }}).length - {{ $deckel }})"></span>
        </template>
    </span>
    <span class="sr-only"
          x-text="({{ $personen }}).length === 1
              ? @js($srEins).split(':namen').join(({{ $personen }})[0].name)
              : @js($srViele).split(':count').join(({{ $personen }}).length).split(':namen').join(({{ $personen }}).map(function (p) { return p.name }).join(', '))"></span>
</span>

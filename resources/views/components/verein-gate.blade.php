@props([
    'context' => 'Räume und Chat',
])

@php($context = __($context))

{{-- Vereins-Gate: Nicht-Vereinsmitgliedern auf einem EINUNDZWANZIG-Vereins-Relay
     zeigen, dass voller Zugang eine Mitgliedschaft braucht — mit direktem Link
     zum Vereinsbeitritt. `context` benennt, was gerade gesperrt ist (Räume /
     Mitglieder). Sichtbarkeit steuert die Insel (nostrVereinGate) reaktiv über
     die relay-signierte 13534-Liste; `x-cloak` verhindert Aufblitzen.

     ZWEI Zielgruppen, und sie bekommen NICHT denselben Satz (`isGuest`):

     • **Angemeldetes Nicht-Mitglied** — von ihm wissen wir es: er steht nicht in
       der relay-signierten 13534. „Du bist (noch) kein Mitglied" ist eine
       belegte Aussage, und der richtige Weg ist der Vereinsbeitritt.

     • **Gast ohne Signer** — von ihm wissen wir es NICHT. Er kann sehr wohl
       Vereinsmitglied sein und nur nicht angemeldet; die Mitgliedschaftsfrage
       ist ohne Pubkey gar nicht gestellt. Ihm „du bist kein Mitglied" zu sagen,
       wäre eine zweite falsche Behauptung an der Stelle, an der P4 gerade die
       erste entfernt hat („Du liest mit", während nichts lädt). Er bekommt
       deshalb nur, was wirklich feststeht: der Bereich verlangt Mitgliedschaft,
       und sein nächster Schritt ist die Anmeldung. --}}
<div x-data="nostrVereinGate" x-show="show" x-cloak x-transition.opacity.duration.300ms
     {{ $attributes->class('page-enter surface-card relative overflow-hidden border-brand-500/30!') }}>

    {{-- Brand-Akzent: warmer Verlauf oben, dezenter Glow --}}
    <div aria-hidden="true" class="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-brand-500 to-transparent"></div>
    <div aria-hidden="true" class="pointer-events-none absolute -top-16 left-1/2 size-40 -translate-x-1/2 rounded-full bg-brand-500/15 blur-3xl"></div>

    <div class="relative p-6 text-center">
        {{-- Brand-Chip mit Logomark --}}
        <div class="mx-auto mb-4 flex size-14 items-center justify-center">
            <x-group::app-brand-mark class="size-14 shadow-pop" />
        </div>

        {{-- Gast: nur das, was ohne Pubkey feststeht. --}}
        <div x-show="isGuest">
            <flux:badge size="sm" color="orange" icon="lock-closed" class="mb-3">{{ __('Anmeldung nötig') }}</flux:badge>

            <flux:heading size="lg" class="text-balance">{{ __('Nur für Mitglieder') }}</flux:heading>

            <flux:text class="mx-auto mt-2 max-w-xs text-balance text-sm text-muted">
                {{ __('Dieser Bereich ist Mitgliedern vorbehalten.') }}
            </flux:text>

            {{-- `requireAuth` statt eines handgeschriebenen `open-login-sheet`:
                 derselbe Weg wie bei jeder gegateten Tab (`nav-tab`). Er dispatcht
                 dasselbe Event, merkt aber ZUSÄTZLICH den Rückweg vor
                 (`pendingReturn` → `postLoginRedirect`) und trägt den Fallback auf
                 den Login-View, falls kein Sheet montiert ist. Ein direkter
                 Dispatch verlöre beides still — und genau dieser Rückweg ist die
                 Eigenschaft, die der zurückgebaute Gast-Composer hier hinterlässt. --}}
            <flux:button
                variant="primary"
                icon:trailing="arrow-right"
                data-testid="verein-gate-anmelden"
                class="mt-5 w-full"
                x-on:click="$store.authGate.requireAuth({ label: @js(__('Melde dich an, um fortzufahren.')) })">
                {{ __('Anmelden') }}
            </flux:button>

            <flux:text class="mt-3 text-xs text-muted">
                {{ __('Melde dich an, um fortzufahren.') }}
            </flux:text>
        </div>

        {{-- Angemeldetes Nicht-Mitglied: die belegte Aussage plus der Weg dorthin. --}}
        <div x-show="!isGuest">
            <flux:badge size="sm" color="orange" icon="lock-closed" class="mb-3">{{ __('Vereinszugang') }}</flux:badge>

            <flux:heading size="lg" class="text-balance">{{ __('Noch kein Vereinsmitglied') }}</flux:heading>

            <flux:text class="mx-auto mt-2 max-w-xs text-balance text-sm text-muted">
                {{ __('Du bist (noch) kein Mitglied im Verein') }} <span class="font-semibold text-zinc-700 dark:text-zinc-200">EINUNDZWANZIG</span>.
                {{ $context }} {{ __('in diesem Space bleiben deshalb gesperrt.') }}
            </flux:text>

            <div class="mx-auto mt-4 max-w-xs rounded-tile bg-brand-500/10 px-4 py-3">
                <flux:text class="text-sm text-zinc-600 dark:text-zinc-300">
                    {{ __('Eine Mitgliedschaft schaltet') }} <span class="font-semibold">{{ __('automatisch') }}</span> {{ __('den Zugang zu diesem Space und Relay frei.') }}
                </flux:text>
            </div>

        {{-- P5: Aus dem Link nach außen wird ein Weg nach innen.

             Die Weiche ist eine SERVER-Entscheidung und keine Insel-Prüfung: ohne
             `verein_api_url` könnte die Onboarding-Insel den `u`-Tag ihrer
             NIP-98-Ausweise nicht auf den Verein setzen (der prüft ihn byteweise
             gegen seinen eigenen Origin), jeder Aufruf endete in einem 401 bzw. im
             503 des Proxys. Ein Knopf, der zuverlässig scheitert, ist schlechter als
             der ehrliche Weg nach draußen — deshalb hier `@if` und nicht `x-if`. --}}
        @if (config('group.verein_api_url'))
            <flux:button
                :href="route('group.verein.join')"
                wire:navigate
                variant="primary"
                icon:trailing="arrow-right"
                data-testid="verein-gate-beitreten"
                class="mt-5 w-full">
                {{ __('Vereinsmitglied werden') }}
            </flux:button>

            {{-- `text-muted` statt `text-zinc-400`: gemessen 2,52:1 auf hellem
                 Grund (WCAG 1.4.3 verlangt 4,5:1). Im Dunklen war derselbe Wert
                 unauffällig (7,11:1) — genau die Sorte Fehler, die man im Dark
                 Mode entwickelt und nie sieht. `--color-muted` ist das Haus-Token
                 dafür: zinc-600 im Hellen, zinc-400 im Dunklen.

                 Und es ist die Zeile, die aus der Sackgasse eine Einladung macht
                 („direkt hier in der App") — sie ausgerechnet unlesbar zu setzen,
                 hätte den ganzen Umbau dieser Phase am Bildschirm kassiert. --}}
            <flux:text class="mt-3 text-xs text-muted">
                {{ __('Statuten, Antrag und Beitrag — direkt hier in der App.') }}
            </flux:text>
        @else
            {{-- Web: normales <a target=_blank>. Native: WebView reicht den Link nicht
                 extern weiter → openExternal() öffnet ihn über die In-App-Browser-Bridge. --}}
            <flux:button
                href="{{ config('group.verein_public_url') }}"
                target="_blank"
                rel="noopener"
                x-on:click="openExternal(@js(config('group.verein_public_url')), $event)"
                variant="primary"
                icon:trailing="arrow-up-right"
                data-testid="verein-gate-extern"
                class="mt-5 w-full">
                {{ __('Vereinsmitglied werden') }}
            </flux:button>

            {{-- Gleiche Reparatur wie im Zweig darüber (2,52:1 → text-muted). Die
                 nackte Adresse ist hier kein Zierrat, sondern die Ansage, WOHIN
                 der Knopf führt — sie muss lesbar sein, gerade weil sie aus der
                 App hinausführt. --}}
            <flux:text class="mt-3 text-xs text-muted">
                {{ Str::of(config('group.verein_public_url'))->after('://')->rtrim('/') }}
            </flux:text>
        @endif
        </div>
    </div>
</div>

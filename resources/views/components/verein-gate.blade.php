@props([
    'context' => 'Räume und Chat',
])

{{-- Vereins-Gate: Nicht-Vereinsmitgliedern auf einem EINUNDZWANZIG-Vereins-Relay
     zeigen, dass voller Zugang eine Mitgliedschaft braucht — mit direktem Link
     zum Vereinsbeitritt. `context` benennt, was gerade gesperrt ist (Räume /
     Mitglieder). Sichtbarkeit steuert die Insel (nostrVereinGate) reaktiv über
     die relay-signierte 13534-Liste; `x-cloak` verhindert Aufblitzen. --}}
<div x-data="nostrVereinGate" x-show="show" x-cloak x-transition.opacity.duration.300ms
     {{ $attributes->class('page-enter surface-card relative overflow-hidden !border-brand-500/30') }}>

    {{-- Brand-Akzent: warmer Verlauf oben, dezenter Glow --}}
    <div aria-hidden="true" class="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-brand-500 to-transparent"></div>
    <div aria-hidden="true" class="pointer-events-none absolute -top-16 left-1/2 size-40 -translate-x-1/2 rounded-full bg-brand-500/15 blur-3xl"></div>

    <div class="relative p-6 text-center">
        {{-- Brand-Chip mit Logomark --}}
        <div class="mx-auto mb-4 flex size-14 items-center justify-center">
            <x-chat::app-brand-mark class="size-14 shadow-pop" />
        </div>

        <flux:badge size="sm" color="orange" icon="lock-closed" class="mb-3">Vereinszugang</flux:badge>

        <flux:heading size="lg" class="text-balance">Noch kein Vereinsmitglied</flux:heading>

        <flux:text class="mx-auto mt-2 max-w-xs text-balance text-sm text-zinc-500 dark:text-zinc-400">
            Du bist (noch) kein Mitglied im Verein <span class="font-semibold text-zinc-700 dark:text-zinc-200">EINUNDZWANZIG</span>.
            {{ $context }} in diesem Space bleiben deshalb gesperrt.
        </flux:text>

        <div class="mx-auto mt-4 max-w-xs rounded-tile bg-brand-500/10 px-4 py-3">
            <flux:text class="text-sm text-zinc-600 dark:text-zinc-300">
                Eine Mitgliedschaft schaltet <span class="font-semibold">automatisch</span> den Zugang zu diesem Space und Relay frei.
            </flux:text>
        </div>

        {{-- Web: normales <a target=_blank>. Native: WebView reicht den Link nicht
             extern weiter → openExternal() öffnet ihn über die In-App-Browser-Bridge. --}}
        <flux:button
            href="https://verein.einundzwanzig.space/"
            target="_blank"
            rel="noopener"
            x-on:click="openExternal('https://verein.einundzwanzig.space/', $event)"
            variant="primary"
            icon:trailing="arrow-up-right"
            class="mt-5 w-full">
            Vereinsmitglied werden
        </flux:button>

        <flux:text class="mt-3 text-xs text-zinc-400">
            verein.einundzwanzig.space
        </flux:text>
    </div>
</div>

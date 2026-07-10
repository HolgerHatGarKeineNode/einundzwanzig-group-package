<?php

use Livewire\Attributes\Layout;
use Livewire\Attributes\Title;
use Livewire\Component;

/**
 * Amber-NIP-55-Callback (Mobile): Amber liefert nach dem get_public_key-Login den
 * pubkey als Pfadsegment (<scheme>://amber-chat/{pubkey}). Diese dünne SFC reicht
 * ihn an die Insel (`nip55Callback`), die den welshman-NIP-07-Login abschließt und
 * in den Chat weiterleitet. Signing bleibt lokal in Amber (ContentResolver).
 */
new #[Layout('group::einundzwanzig')] #[Title('Anmelden …')] class extends Component
{
    public string $result = '';

    public function mount(string $result): void
    {
        $this->result = $result;
    }
}; ?>

<main class="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center px-4 py-10 pt-safe">
    <div x-data="nip55Callback(@js($result))" class="surface-card p-6 text-center">
        <flux:icon.bolt variant="solid" class="mx-auto size-8 text-brand-500" />
        <flux:heading size="lg" class="mt-3">Anmeldung wird abgeschlossen …</flux:heading>
        <flux:text class="mt-1">Amber hat den Login bestätigt.</flux:text>
        <flux:text x-show="error" x-cloak class="mt-3 text-sm text-red-500" x-text="error"></flux:text>
    </div>
</main>

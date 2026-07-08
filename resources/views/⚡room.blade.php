<?php

use App\Chat\Nostr\SpaceCache;
use Illuminate\Support\Facades\View;
use Livewire\Attributes\Layout;
use Livewire\Component;

/**
 * Raum-Chat als Livewire-SFC. `$h` (Raum-ID) kommt aus dem Routen-Parameter und
 * wird via `@js($h)` an die welshman/Alpine-Insel gereicht — die einzige
 * Server→Insel-Übergabe; der ganze Chat-Zustand lebt clientseitig.
 *
 * Titel + OG-Beschreibung kommen aus dem server-seitigen Read-Cache (§10/M7):
 * server-gerenderter `<head>` für Crawler/Share-Previews, ohne die client-seitige
 * Architektur zu berühren. Cache-Miss = Fallback auf die rohe Raum-ID.
 */
new #[Layout('chat::einundzwanzig')] class extends Component
{
    public string $h;

    public ?string $roomName = null;

    public string $roomAbout = '';

    public function mount(string $h, SpaceCache $cache): void
    {
        $this->h = $h;
        $room = $cache->rooms(SpaceCache::spaceUrl())[$h] ?? null;
        $this->roomName = $room['name'] ?? null;
        $this->roomAbout = $room['about'] ?? '';
    }

    public function render()
    {
        View::share('ogDescription', $this->roomAbout ?: null);

        return $this->view()->title('# '.($this->roomName ?? $this->h));
    }
}; ?>

{{-- Chat-Bühne: Kopf + Verlauf + Composer unter EINEM Alpine-Scope (M4 lesen, M5 schreiben). --}}
<div x-data="nostrRoomChat(@js($h))" class="mx-auto flex h-dvh w-full max-w-md flex-col px-4 pt-safe pb-safe">

    <x-chat::app-header :title="'# '.($roomName ?? $h)" :back="route('chat.spaces')" class="shrink-0">
        <x-slot:actions>
            {{-- Mitglied → Verlassen (kind 9022). Beitreten liegt beim Composer. --}}
            <flux:button size="xs" variant="ghost" icon="arrow-right-start-on-rectangle"
                         x-show="joined" x-cloak x-on:click="leave()" ::disabled="joining" aria-label="Raum verlassen">
                Verlassen
            </flux:button>
        </x-slot:actions>
    </x-chat::app-header>

    <div class="relative flex min-h-0 flex-1 flex-col">

        <div x-ref="scroll" x-on:scroll.debounce.50ms="onScroll()"
             role="log" aria-live="polite" aria-relevant="additions" aria-label="Chat-Verlauf"
             class="min-h-0 flex-1 space-y-0.5 overflow-y-auto pb-4 transition-opacity"
             :class="(!firstPaintDone && messages.length > 0) ? 'opacity-0' : 'opacity-100'">

            {{-- Ältere laden (Cursor-Pagination) --}}
            <div class="py-2 text-center" x-show="hasMore && messages.length > 0" x-cloak>
                <flux:button size="xs" variant="ghost" x-on:click="loadOlder()" ::disabled="loadingMore">
                    <span x-text="loadingMore ? 'Lädt…' : 'Ältere laden'"></span>
                </flux:button>
            </div>

            {{-- Erstes Laden --}}
            <template x-if="loading && messages.length === 0">
                <div class="space-y-3 pt-4">
                    <template x-for="i in 6" :key="i">
                        <div class="flex gap-2">
                            <div class="skeleton size-8 shrink-0 rounded-full"></div>
                            <div class="flex-1 space-y-1.5 py-1">
                                <div class="skeleton h-3 w-24"></div>
                                <div class="skeleton h-3 w-2/3"></div>
                            </div>
                        </div>
                    </template>
                </div>
            </template>

            {{-- Leerer Raum --}}
            <template x-if="!loading && messages.length === 0">
                <div class="surface-card empty-state mt-8 p-6 text-center">
                    <flux:icon.chat-bubble-left-right class="mx-auto size-8 text-zinc-400" />
                    <flux:text class="mt-2">Noch keine Nachrichten in diesem Raum.</flux:text>
                </div>
            </template>

            {{-- Verlauf --}}
            <template x-for="m in messages" :key="m.id">
                <div>
                    <template x-if="m.divider">
                        <div class="my-3 flex items-center gap-3">
                            <flux:separator class="flex-1" />
                            <span class="font-mono text-[0.7rem] tracking-wide text-zinc-500" x-text="m.divider"></span>
                            <flux:separator class="flex-1" />
                        </div>
                    </template>

                    {{-- Last-Read-Grenze: erste ungelesene Fremd-Nachricht seit dem letzten Besuch. --}}
                    <template x-if="m.unreadDivider">
                        <div class="my-3 flex items-center gap-3">
                            <flux:separator class="flex-1" />
                            <span class="shrink-0 font-mono text-[0.7rem] font-semibold tracking-wide text-brand-500">Neue Nachrichten</span>
                            <flux:separator class="flex-1" />
                        </div>
                    </template>

                    <div class="group flex gap-2 px-1" :class="m.showAuthor ? 'mt-2.5' : ''">
                        <div class="w-8 shrink-0">
                            <template x-if="m.showAuthor">
                                <flux:avatar circle size="xs" ::src="m.picture || null" ::name="m.name" />
                            </template>
                        </div>
                        <div class="min-w-0 flex-1">
                            <template x-if="m.showAuthor">
                                <div class="flex items-baseline gap-2">
                                    <span class="truncate text-sm font-semibold" x-text="m.name"></span>
                                    <span class="shrink-0 font-mono text-[0.7rem] text-zinc-500" x-text="m.time"></span>
                                </div>
                            </template>
                            {{-- Zitat-Vorschau (Antwort auf eine Nachricht im selben Raum) --}}
                            <template x-if="m.reply">
                                <div class="mt-0.5 mb-1 border-l-2 border-brand-500/60 pl-2">
                                    <div class="truncate text-xs font-semibold text-brand-500" x-text="m.reply.name"></div>
                                    <div class="truncate text-xs text-zinc-500" x-text="m.reply.text"></div>
                                </div>
                            </template>
                            <div class="chat-content text-sm break-words whitespace-pre-wrap" x-html="m.html"></div>
                        </div>
                        {{-- Aktionen (erscheinen bei Hover): Antworten, Löschen (nur eigene) --}}
                        <div class="flex shrink-0 items-start gap-0.5 self-start opacity-0 group-hover:opacity-100 focus-within:opacity-100">
                            <button type="button" x-on:click="setReply(m)"
                                    class="pressable p-1 text-zinc-400 hover:text-brand-500" aria-label="Antworten">
                                <flux:icon.arrow-uturn-left variant="micro" />
                            </button>
                            <button type="button" x-show="m.mine" x-cloak x-on:click="remove(m.id, m.created_at)"
                                    class="pressable p-1 text-zinc-400 hover:text-red-500" aria-label="Nachricht löschen">
                                <flux:icon.trash variant="micro" />
                            </button>
                        </div>
                    </div>
                </div>
            </template>
        </div>

        {{-- Zurück ans Ende, sobald hochgescrollt — mit Zähler, wenn neue Nachrichten warten. --}}
        <div class="pointer-events-none absolute inset-x-0 bottom-3 flex justify-center" x-show="!atBottom" x-cloak
             x-transition.opacity>
            <flux:button size="xs" variant="primary" class="pointer-events-auto" icon="arrow-down"
                         x-on:click="scrollToBottom()" aria-label="Zum Ende springen">
                <span x-show="unread > 0"><span x-text="unread"></span> neue</span>
            </flux:button>
        </div>
    </div>

    {{-- Fehler (Relay lehnt ab, AUTH etc.) erscheinen als globaler Toast. --}}

    {{-- Composer nur für Mitglieder; sonst Beitreten-Hinweis. Mitgliedschaft ist
         relay-seitig (NIP-29 39002) und persistent. `membershipReady` verhindert,
         dass der Hinweis kurz aufblitzt, bevor die Members-Liste geladen ist.
         Senden ist eine reine Alpine-Aktion (welshman signiert im Browser). --}}
    <div class="shrink-0 pt-2">
        <div x-show="!membershipReady" x-cloak class="skeleton h-11 rounded-card"></div>

        {{-- Antwort-Kontext (Zitat) über dem Composer, mit Abbrechen --}}
        <div x-show="membershipReady && joined && replyTo" x-cloak
             class="surface-card mb-1 flex items-center gap-2 border-l-2 border-brand-500/60 px-3 py-1.5">
            <div class="min-w-0 flex-1">
                <div class="text-xs font-semibold text-brand-500">Antwort an <span x-text="replyTo?.name"></span></div>
                <div class="truncate text-xs text-zinc-500" x-text="replyTo?.text"></div>
            </div>
            <button type="button" x-on:click="clearReply()" class="pressable p-1 text-zinc-400 hover:text-zinc-600" aria-label="Antwort abbrechen">
                <flux:icon.x-mark variant="micro" />
            </button>
        </div>

        <div x-show="membershipReady && joined" x-cloak class="flex items-end gap-2">
            <flux:textarea x-ref="composer" x-model="draft" rows="1" resize="none"
                           placeholder="Nachricht schreiben…" class="flex-1"
                           x-on:focus="atBottom && scrollToBottom()"
                           x-on:keydown.enter.prevent="!$event.shiftKey && send()" />
            <flux:button type="button" variant="primary" icon="paper-airplane"
                         x-on:click="send()" ::disabled="sending || draft.trim().length === 0"
                         aria-label="Senden" />
        </div>

        <div x-show="membershipReady && !joined" x-cloak
             class="surface-card flex items-center justify-between gap-3 p-3">
            <flux:text class="text-sm text-zinc-500">Tritt dem Raum bei, um mitzuschreiben.</flux:text>
            <flux:button size="sm" variant="primary" icon="plus" x-on:click="join()" ::disabled="joining">
                <span x-text="joining ? 'Trete bei…' : 'Beitreten'"></span>
            </flux:button>
        </div>
    </div>
</div>

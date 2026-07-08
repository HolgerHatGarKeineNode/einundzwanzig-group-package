/**
 * Flux-Toast aus der Alpine/JS-Insel auslösen. Flux' `<flux:toast>` lauscht auf
 * ein `toast-show`-Document-Event und ruft `showToast($event.detail)`. Das Detail
 * muss exakt Flux' Form haben (wie `Flux::toast()` in PHP): der Text steht unter
 * `slots.text`, die Variante unter `dataset.variant` — NICHT als flache `text`/
 * `variant`-Felder (die füllen die `<slot>`s nicht und ergeben einen leeren Toast).
 */
type ToastVariant = 'danger' | 'success' | 'warning' | 'info'

export function toast(text: string, variant: ToastVariant = 'danger', duration = 5000): void {
    document.dispatchEvent(
        new CustomEvent('toast-show', {
            detail: { duration, slots: { text }, dataset: { variant } },
        }),
    )
}

const FLASH_KEY = 'nostr:flash-toast'

/**
 * Toast, der eine `wire:navigate`-Navigation übersteht: Flux' `<flux:toast>` wird
 * beim Body-Swap neu gemountet und verliert direkt gefeuerte Toasts. Der Payload
 * wird deshalb in sessionStorage geparkt und nach dem nächsten Seitenaufbau
 * (`livewire:navigated`) genau einmal abgespielt.
 */
export function flashToast(text: string, variant: ToastVariant = 'info', duration = 6000): void {
    try {
        sessionStorage.setItem(FLASH_KEY, JSON.stringify({ text, variant, duration }))
    } catch {
        toast(text, variant, duration)
    }
}

/** Registriert das einmalige Abspielen geparkter Flash-Toasts nach Navigation. */
export function setupFlashToast(): void {
    const replay = (): void => {
        const raw = sessionStorage.getItem(FLASH_KEY)
        if (!raw) {
            return
        }
        sessionStorage.removeItem(FLASH_KEY)
        try {
            const { text, variant, duration } = JSON.parse(raw)
            // flux:toast wird nach dem Body-Swap erst neu gemountet und lauscht dann
            // auf `toast-show`. Ein sofortiger Dispatch verpufft → kurz warten.
            setTimeout(() => toast(text, variant, duration), 250)
        } catch {
            // kaputter Payload — ignorieren
        }
    }
    document.addEventListener('livewire:navigated', replay)
}

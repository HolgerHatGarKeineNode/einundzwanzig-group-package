/**
 * Flux-Toast aus der Alpine/JS-Insel auslösen. Flux' `<flux:toast>` lauscht auf
 * ein `toast-show`-Document-Event und ruft `showToast($event.detail)` — also
 * genügt ein CustomEvent mit dem Toast-Payload. Kein Livewire-Kontext nötig.
 */
type ToastVariant = 'danger' | 'success' | 'warning' | 'info'

export function toast(text: string, variant: ToastVariant = 'danger', duration = 5000): void {
    document.dispatchEvent(new CustomEvent('toast-show', { detail: { text, variant, duration } }))
}

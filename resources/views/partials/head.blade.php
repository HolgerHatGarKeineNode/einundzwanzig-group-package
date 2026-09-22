{{--
    Minimal-Head des Chat-Vollbild-Layouts für Fremdhosts (Portal). Bringt nur,
    was der Chat braucht: Meta + CSRF + __nostrSpace-Injektion + die Insel-Vite-
    Entries. OG/Favicons regelt der Host selbst. Aktiv via config('group.head_partial').
--}}
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
<meta name="csrf-token" content="{{ csrf_token() }}" />

<title>{{ filled($title ?? null) ? $title.' – '.config('app.name') : config('app.name') }}</title>

{{-- Boot globals of the island — shared with every host layout that loads the bundle. --}}
@include('group::partials.globals')

@vite(config('group.vite'))
@fluxAppearance
@include('group::partials.appearance-default')

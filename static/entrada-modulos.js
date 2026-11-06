(function () {
    'use strict';

    var MODULOS = window.SS_HUB_MODULOS || [];
    var LS_RECENT = 'ss_hub_recent_v1';
    var LS_FAV = 'ss_hub_fav_v1';
    var MAX_RECENT = 6;

    var ICONS = {
        truck: '<svg viewBox="0 0 48 48" aria-hidden="true"><rect x="6" y="14" width="22" height="16" rx="2" fill="none" stroke="currentColor" stroke-width="2"/><path d="M28 18h8l6 8v4H28V18z" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="14" cy="32" r="3" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="36" cy="32" r="3" fill="none" stroke="currentColor" stroke-width="2"/></svg>',
        return: '<svg viewBox="0 0 48 48" aria-hidden="true"><path d="M28 10H14a4 4 0 00-4 4v20a4 4 0 004 4h20a4 4 0 004-4V22" fill="none" stroke="currentColor" stroke-width="2"/><path d="M18 24l-6-6 6-6M12 18h18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
        inbound: '<svg viewBox="0 0 48 48" aria-hidden="true"><path d="M24 8v22M24 30l-8-8M24 30l8-8" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><rect x="10" y="32" width="28" height="8" rx="2" fill="none" stroke="currentColor" stroke-width="2"/></svg>',
        outbound: '<svg viewBox="0 0 48 48" aria-hidden="true"><path d="M24 30V8M24 8l-8 8M24 8l8 8" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><rect x="10" y="32" width="28" height="8" rx="2" fill="none" stroke="currentColor" stroke-width="2"/></svg>',
        stock: '<svg viewBox="0 0 48 48" aria-hidden="true"><path d="M8 18l16-8 16 8v16l-16 8-16-8V18z" fill="none" stroke="currentColor" stroke-width="2"/><path d="M24 26v16M8 18l16 8 16-8" fill="none" stroke="currentColor" stroke-width="2"/></svg>',
        wms: '<svg viewBox="0 0 48 48" aria-hidden="true"><rect x="8" y="8" width="14" height="14" rx="1" fill="none" stroke="currentColor" stroke-width="2"/><rect x="26" y="8" width="14" height="14" rx="1" fill="none" stroke="currentColor" stroke-width="2"/><rect x="8" y="26" width="14" height="14" rx="1" fill="none" stroke="currentColor" stroke-width="2"/><rect x="26" y="26" width="14" height="14" rx="1" fill="none" stroke="currentColor" stroke-width="2"/></svg>',
        search: '<svg viewBox="0 0 48 48" aria-hidden="true"><circle cx="21" cy="21" r="11" fill="none" stroke="currentColor" stroke-width="2"/><path d="M29 29l10 10" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
        move: '<svg viewBox="0 0 48 48" aria-hidden="true"><path d="M16 14h20M30 8l6 6-6 6M32 34H12M18 28l-6 6 6 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
        calendar: '<svg viewBox="0 0 48 48" aria-hidden="true"><rect x="8" y="10" width="32" height="28" rx="3" fill="none" stroke="currentColor" stroke-width="2"/><path d="M16 6v8M32 6v8M8 20h32" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
        chart: '<svg viewBox="0 0 48 48" aria-hidden="true"><path d="M10 38V10M10 38h28M18 38V24M26 38V16M34 38V20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
        finance: '<svg viewBox="0 0 48 48" aria-hidden="true"><rect x="6" y="12" width="36" height="24" rx="3" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="24" cy="24" r="6" fill="none" stroke="currentColor" stroke-width="2"/></svg>',
        history: '<svg viewBox="0 0 48 48" aria-hidden="true"><circle cx="24" cy="24" r="15" fill="none" stroke="currentColor" stroke-width="2"/><path d="M24 15v9l6 4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
        report: '<svg viewBox="0 0 48 48" aria-hidden="true"><rect x="12" y="8" width="24" height="32" rx="2" fill="none" stroke="currentColor" stroke-width="2"/><path d="M18 18h12M18 25h12M18 32h8" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
        cancel: '<svg viewBox="0 0 48 48" aria-hidden="true"><rect x="12" y="8" width="24" height="32" rx="2" fill="none" stroke="currentColor" stroke-width="2"/><path d="M18 20l12 12M30 20L18 32" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
        ai: '<svg viewBox="0 0 48 48" aria-hidden="true"><path d="M24 8l3.5 9.5L37 21l-9.5 3.5L24 34l-3.5-9.5L11 21l9.5-3.5L24 8z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>',
        print: '<svg viewBox="0 0 48 48" aria-hidden="true"><path d="M14 18V10h20v8M14 34v6h20v-6" fill="none" stroke="currentColor" stroke-width="2"/><rect x="8" y="18" width="32" height="16" rx="2" fill="none" stroke="currentColor" stroke-width="2"/></svg>',
        checklist: '<svg viewBox="0 0 48 48" aria-hidden="true"><rect x="10" y="8" width="28" height="32" rx="2" fill="none" stroke="currentColor" stroke-width="2"/><path d="M16 20l3 3 6-6M16 30l3 3 6-6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
        inventory: '<svg viewBox="0 0 48 48" aria-hidden="true"><path d="M10 14h28M10 24h28M10 34h18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
        thermo: '<svg viewBox="0 0 48 48" aria-hidden="true"><path d="M20 12a4 4 0 018 0v16a8 8 0 11-8 0V12z" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="24" cy="34" r="3" fill="currentColor"/></svg>',
        shield: '<svg viewBox="0 0 48 48" aria-hidden="true"><path d="M24 40s14-7 14-18V11L24 6 10 11v11c0 11 14 18 14 18z" fill="none" stroke="currentColor" stroke-width="2"/></svg>',
        catalog: '<svg viewBox="0 0 48 48" aria-hidden="true"><path d="M38 25L23 40a3 3 0 01-4 0L8 29V10h19l11 11a3 3 0 010 4z" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="16" cy="18" r="2.5" fill="currentColor"/></svg>',
        settings: '<svg viewBox="0 0 48 48" aria-hidden="true"><circle cx="24" cy="24" r="7" fill="none" stroke="currentColor" stroke-width="2"/><path d="M24 8v5M24 35v5M8 24h5M35 24h5M12.7 12.7l3.5 3.5M31.8 31.8l3.5 3.5M35.3 12.7l-3.5 3.5M16.2 31.8l-3.5 3.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
        users: '<svg viewBox="0 0 48 48" aria-hidden="true"><circle cx="19" cy="17" r="6" fill="none" stroke="currentColor" stroke-width="2"/><path d="M8 38c0-6 5-10 11-10s11 4 11 10" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M36 16v10M31 21h10" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
        menu: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="3" fill="none" stroke="currentColor" stroke-width="2"/><path d="M4 20c0-4 4-6 8-6s8 2 8 6" fill="none" stroke="currentColor" stroke-width="2"/></svg>'
    };

    function readJson(key, fallback) {
        try {
            var raw = localStorage.getItem(key);
            return raw ? JSON.parse(raw) : fallback;
        } catch (e) {
            return fallback;
        }
    }

    function writeJson(key, val) {
        try {
            localStorage.setItem(key, JSON.stringify(val));
        } catch (e) { /* ignore */ }
    }

    function getRecent() {
        return readJson(LS_RECENT, []);
    }

    function getFav() {
        return readJson(LS_FAV, ['enderecamento-wms', 'camaras-consulta', 'light-contagem']);
    }

    function pushRecent(id) {
        var list = getRecent().filter(function (x) { return x !== id; });
        list.unshift(id);
        writeJson(LS_RECENT, list.slice(0, MAX_RECENT));
    }

    function toggleFav(id) {
        var list = getFav();
        var i = list.indexOf(id);
        if (i >= 0) list.splice(i, 1);
        else list.push(id);
        writeJson(LS_FAV, list);
        renderAll(document.getElementById('hub-search').value.trim().toLowerCase());
    }

    function byId(id) {
        return MODULOS.find(function (m) { return m.id === id; });
    }

    function modIcon(name) {
        return ICONS[name] || ICONS.menu;
    }

    function sidebarItem(mod) {
        var li = document.createElement('li');
        var a = document.createElement('a');
        a.href = mod.href;
        a.className = 'ss-hub-sidebar-link';
        a.innerHTML = '<span class="ss-hub-sidebar-link-ico">' + modIcon(mod.icon) + '</span><span>' + mod.label + '</span>';
        a.addEventListener('click', function () { pushRecent(mod.id); });
        li.appendChild(a);
        return li;
    }

    function moduleCard(mod) {
        var fav = getFav().indexOf(mod.id) >= 0;
        var card = document.createElement('a');
        card.href = mod.href;
        card.className = 'ss-hub-card';
        card.setAttribute('data-mod-id', mod.id);
        card.setAttribute('data-label', mod.label.toLowerCase());
        card.innerHTML =
            '<span class="ss-hub-card-ico">' + modIcon(mod.icon) + '</span>' +
            '<span class="ss-hub-card-label">' + mod.label + '</span>' +
            '<button type="button" class="ss-hub-card-star' + (fav ? ' is-on' : '') + '" title="Favorito" aria-label="Favorito">' +
            (fav ? '★' : '☆') + '</button>';
        card.addEventListener('click', function (ev) {
            if (ev.target.closest('.ss-hub-card-star')) {
                ev.preventDefault();
                toggleFav(mod.id);
                return;
            }
            pushRecent(mod.id);
        });
        return card;
    }

    function fillGrid(el, ids, query) {
        if (!el) return 0;
        el.innerHTML = '';
        var shown = 0;
        ids.forEach(function (id) {
            var mod = byId(id);
            if (!mod) return;
            if (query && mod.label.toLowerCase().indexOf(query) < 0) return;
            el.appendChild(moduleCard(mod));
            shown++;
        });
        return shown;
    }

    function fillSidebarList(el, ids) {
        if (!el) return;
        el.innerHTML = '';
        ids.forEach(function (id) {
            var mod = byId(id);
            if (mod) el.appendChild(sidebarItem(mod));
        });
    }

    function idsByGroup(grp) {
        return MODULOS.filter(function (m) { return m.group === grp; }).map(function (m) { return m.id; });
    }

    function renderAll(query) {
        query = query || '';
        var recentIds = getRecent();
        var favIds = getFav();
        var allIds = MODULOS.map(function (m) { return m.id; });

        var nRecent = fillGrid(document.getElementById('grid-recentes'), recentIds, query);
        var nFav = fillGrid(document.getElementById('grid-favoritos'), favIds, query);
        fillGrid(document.getElementById('grid-pro'), idsByGroup('pro'), query);
        fillGrid(document.getElementById('grid-plus'), idsByGroup('plus'), query);
        fillGrid(document.getElementById('grid-light'), idsByGroup('light'), query);
        fillGrid(document.getElementById('grid-admin'), idsByGroup('admin'), query);

        var emptyRecent = document.getElementById('empty-recentes');
        var emptyFav = document.getElementById('empty-favoritos');
        if (emptyRecent) emptyRecent.hidden = !!(nRecent || query);
        if (emptyFav) emptyFav.hidden = !!(nFav || query);

        fillSidebarList(document.getElementById('sidebar-mais'), allIds.slice(0, 8));
        fillSidebarList(document.getElementById('sidebar-fav'), favIds);
        fillSidebarList(document.getElementById('sidebar-all'), allIds);

        document.querySelectorAll('.ss-hub-section').forEach(function (sec) {
            var grid = sec.querySelector('.ss-hub-grid');
            if (!grid) return;
            var visible = grid.querySelectorAll('.ss-hub-card').length;
            sec.hidden = !!(query && visible === 0);
        });
    }

    function initClock() {
        var el = document.getElementById('ss-hub-clock');
        if (!el) return;
        function tick() {
            var d = new Date();
            el.textContent = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
        }
        tick();
        setInterval(tick, 30000);
    }

    function initSearch() {
        var input = document.getElementById('hub-search');
        if (!input) return;
        input.addEventListener('input', function () {
            renderAll(input.value.trim().toLowerCase());
        });
    }

    function initMenuCompleto() {
        var btn = document.getElementById('btn-menu-completo');
        var list = document.getElementById('sidebar-all');
        if (!btn || !list) return;
        btn.addEventListener('click', function () {
            var open = list.hidden;
            list.hidden = !open;
            btn.setAttribute('aria-expanded', open ? 'true' : 'false');
        });
    }

    function initSidebarToggle() {
        var btn = document.getElementById('btn-hub-sidebar-toggle');
        var sidebar = document.querySelector('.ss-hub-sidebar');
        var LS = 'dl-hub-sidebar-wide';

        function isWide() {
            return document.body.classList.contains('ss-hub-sidebar-wide');
        }

        function applyWide(wide) {
            document.body.classList.toggle('ss-hub-sidebar-wide', wide);
            if (sidebar) sidebar.classList.toggle('ss-hub-sidebar--wide', wide);
            if (btn) {
                btn.setAttribute('aria-pressed', wide ? 'true' : 'false');
                btn.setAttribute('aria-label', wide ? 'Recolher menu lateral' : 'Abrir menu lateral');
                btn.title = wide ? 'Recolher menu lateral' : 'Abrir menu lateral';
            }
            try { localStorage.setItem(LS, wide ? '1' : '0'); } catch (e) { /* ignore */ }
        }

        var wide = true;
        try {
            var raw = localStorage.getItem(LS);
            if (raw === '0') wide = false;
        } catch (e) { /* ignore */ }
        applyWide(wide);

        if (btn) btn.addEventListener('click', function () { applyWide(!isWide()); });
    }

    renderAll();
    initClock();
    initSearch();
    initMenuCompleto();
    initSidebarToggle();
})();

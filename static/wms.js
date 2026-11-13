// WMS Doca Livre — tema, relógio, painel do usuário e menu lateral.
// O menu segue o comportamento do Doca Livre Oferta de Carga: recolhido só com ícones; abre ao
// passar o mouse com um pequeno atraso (não dispara ao passar de raspão); o botão do cabeçalho fixa.
(function () {
    var html = document.documentElement;
    function ler(chave) { try { return localStorage.getItem(chave); } catch (e) { return null; } }
    function gravar(chave, valor) { try { localStorage.setItem(chave, valor); } catch (e) {} }

    // ------------------------------------------------------------ tema
    var btnTema = document.getElementById('btnTema');
    var iconeTema = document.getElementById('iconeTema');
    function aplicarTema(tema) {
        html.setAttribute('data-tema', tema);
        html.setAttribute('data-bs-theme', tema === 'escuro' ? 'dark' : 'light');
        if (iconeTema) iconeTema.className = tema === 'escuro' ? 'fas fa-sun' : 'fas fa-moon';
        var meta = document.getElementById('metaThemeColor');
        if (meta) meta.setAttribute('content', tema === 'escuro' ? '#0a0a0b' : '#ffffff');
        gravar('wms.tema', tema);
    }
    if (btnTema) {
        btnTema.addEventListener('click', function () {
            aplicarTema(html.getAttribute('data-tema') === 'escuro' ? 'claro' : 'escuro');
        });
    }
    aplicarTema(html.getAttribute('data-tema') === 'escuro' ? 'escuro' : 'claro');

    // ------------------------------------------------------------ relógio
    var hora = document.getElementById('relogioHora');
    var dataEl = document.getElementById('relogioData');
    if (hora) {
        var dois = function (n) { return (n < 10 ? '0' : '') + n; };
        var tique = function () {
            var agora = new Date();
            hora.textContent = dois(agora.getHours()) + ':' + dois(agora.getMinutes());
            dataEl.textContent = dois(agora.getDate()) + '/' + dois(agora.getMonth() + 1) + '/' + agora.getFullYear();
        };
        tique();
        setInterval(tique, 15000);
    }

    // ------------------------------------------------------------ painel do usuário
    var btnPerfil = document.getElementById('btnPerfil');
    var painel = document.getElementById('perfilPainel');
    if (btnPerfil && painel) {
        var carregado = false;
        var abrirPerfil = function (aberto) {
            painel.hidden = !aberto;
            btnPerfil.setAttribute('aria-expanded', aberto ? 'true' : 'false');
            if (aberto && !carregado) {
                painel.innerHTML = '<p class="perfil-carregando">Carregando…</p>';
                fetch(btnPerfil.getAttribute('data-url'), { credentials: 'same-origin' })
                    .then(function (r) { if (!r.ok) throw new Error(); return r.text(); })
                    .then(function (conteudo) { painel.innerHTML = conteudo; carregado = true; })
                    .catch(function () { painel.innerHTML = '<p class="perfil-carregando">Não foi possível carregar o perfil. Tente de novo.</p>'; });
            }
        };
        btnPerfil.addEventListener('click', function () { abrirPerfil(painel.hidden); });
        document.addEventListener('click', function (ev) {
            if (!painel.hidden && !document.getElementById('perfilWrap').contains(ev.target)) abrirPerfil(false);
        });
        document.addEventListener('keydown', function (ev) {
            if (ev.key === 'Escape' && !painel.hidden) { abrirPerfil(false); btnPerfil.focus(); }
        });
        // O conteúdo chega depois: os cliques são tratados aqui, no próprio painel.
        painel.addEventListener('click', function (ev) {
            var aba = ev.target.closest('[data-perfil-aba]');
            if (aba) {
                var nome = aba.getAttribute('data-perfil-aba');
                painel.querySelectorAll('[data-perfil-conteudo]').forEach(function (c) { c.hidden = c.getAttribute('data-perfil-conteudo') !== nome; });
                painel.querySelectorAll('.perfil-tabs button').forEach(function (b) {
                    var ativa = b.getAttribute('data-perfil-aba') === nome;
                    b.classList.toggle('is-active', ativa);
                    b.setAttribute('aria-selected', ativa ? 'true' : 'false');
                });
            } else if (ev.target.closest('[data-perfil-foto]')) {
                painel.querySelector('#perfilFotoArquivo').click();
            } else if (ev.target.closest('[data-perfil-fechar]')) {
                abrirPerfil(false);
            }
        });
        painel.addEventListener('change', function (ev) {
            if (ev.target.id === 'perfilFotoArquivo' && ev.target.files.length) painel.querySelector('#formPerfilFoto').submit();
        });
    }

    // ------------------------------------------------------------ menu lateral
    var sidebar = document.getElementById('sidebar');
    if (!sidebar) return;
    var conteudo = document.getElementById('mainContent');
    var btnMenu = document.getElementById('btnMenu');
    var overlay = document.getElementById('sidebarOverlay');
    var estreita = window.matchMedia('(max-width: 1200px)');
    var ATRASO_ABRIR = 120;         // ms com o mouse em cima antes de abrir
    var TRAVA_APOS_RECOLHER = 400;  // ms sem reabrir depois de recolher pelo botão (o cursor ainda está em cima)
    var temporizador = null;
    var travadoAte = 0;

    function cancelarTemporizador() { if (temporizador !== null) { clearTimeout(temporizador); temporizador = null; } }
    function fixado() { return sidebar.classList.contains('sidebar-fixed'); }

    function fixar(fixo) {
        sidebar.classList.toggle('sidebar-fixed', fixo);
        if (conteudo) conteudo.classList.toggle('sidebar-expanded', fixo);
        if (btnMenu) btnMenu.setAttribute('aria-expanded', fixo ? 'true' : 'false');
        gravar('wms.menu.fixo', fixo ? '1' : '0');
    }
    function gaveta(aberta) {
        sidebar.classList.toggle('open', aberta);
        if (overlay) overlay.classList.toggle('show', aberta);
        if (btnMenu) btnMenu.setAttribute('aria-expanded', aberta ? 'true' : 'false');
    }
    function abrirComMouse() {
        if (fixado() || estreita.matches || Date.now() < travadoAte) return;
        cancelarTemporizador();
        temporizador = setTimeout(function () { sidebar.classList.add('sidebar-aberta-mouse'); temporizador = null; }, ATRASO_ABRIR);
    }
    function fecharComMouse() {
        cancelarTemporizador();
        sidebar.classList.remove('sidebar-aberta-mouse');
    }

    if (btnMenu) {
        btnMenu.addEventListener('click', function () {
            if (estreita.matches) { gaveta(!sidebar.classList.contains('open')); return; }
            if (fixado()) {
                // Recolhe de verdade, sem ficar aberto só porque o cursor está em cima.
                travadoAte = Date.now() + TRAVA_APOS_RECOLHER;
                fecharComMouse();
                fixar(false);
            } else {
                fecharComMouse();
                fixar(true);
            }
        });
    }
    if (overlay) overlay.addEventListener('click', function () { gaveta(false); });
    sidebar.addEventListener('mouseenter', abrirComMouse);
    sidebar.addEventListener('mouseleave', fecharComMouse);
    // Teclado: navegar com Tab dentro do menu também o abre.
    sidebar.addEventListener('focusin', function () {
        if (!estreita.matches && !fixado()) sidebar.classList.add('sidebar-aberta-mouse');
    });
    sidebar.addEventListener('focusout', function (e) {
        if (!sidebar.contains(e.relatedTarget) && !sidebar.matches(':hover')) fecharComMouse();
    });
    // Tela mudou de tamanho: larga perde a gaveta; estreita perde o "aberto pelo mouse".
    estreita.addEventListener('change', function () { gaveta(false); fecharComMouse(); });

    // Grupos do menu (sanfona): abre um e fecha os outros.
    sidebar.querySelectorAll('.dropdown-btn').forEach(function (botao) {
        botao.addEventListener('click', function () {
            var lista = document.getElementById(botao.getAttribute('aria-controls'));
            var abrir = !lista.classList.contains('show');
            sidebar.querySelectorAll('.dropdown-container.show').forEach(function (outra) { outra.classList.remove('show'); });
            sidebar.querySelectorAll('.dropdown-btn.aberto').forEach(function (outro) {
                outro.classList.remove('aberto');
                outro.setAttribute('aria-expanded', 'false');
            });
            if (abrir) {
                lista.classList.add('show');
                botao.classList.add('aberto');
                botao.setAttribute('aria-expanded', 'true');
            }
        });
    });
    sidebar.querySelectorAll('.dropdown-container a').forEach(function (link) {
        link.addEventListener('click', function () { if (estreita.matches) gaveta(false); });
    });

    if (!estreita.matches && ler('wms.menu.fixo') === '1') fixar(true);
    var ativo = sidebar.querySelector('.dropdown-container a.active');
    if (ativo && ativo.scrollIntoView) ativo.scrollIntoView({ block: 'nearest' });
})();

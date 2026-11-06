/**
 * WMS Doca Livre — moldura única.
 * Um cabeçalho, um menu por processo e uma busca para todas as telas. Cada sistema interno
 * (operação/armazém, câmaras, contagem) roda num quadro carregado uma única vez: trocar de
 * tela dentro dele é instantâneo (sem recarregar a página).
 */
(function () {
  'use strict';
  var M = window.WMS_MENU;
  var USUARIO = window.WMS_USUARIO || {};
  var itens = M.itens.filter(function (i) { return !i.su || USUARIO.su; });
  var porId = {};
  var porChave = {};
  itens.forEach(function (i) {
    porId[i.id] = i;
    var k = M.chaveDaUrl(i.url);
    if (!porChave[k]) porChave[k] = i;
  });

  var $ = function (id) { return document.getElementById(id); };
  var quadros = {};          // app -> { el, carregado }
  var appVisivel = null;     // 'inicio' | 'pro' | 'plus' | 'light' | 'outro'
  var ehMobile = function () { return window.matchMedia('(max-width: 900px)').matches; };

  var ICONES = {
    inicio: '<path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
    entrada: '<path d="M12 3v12m0 0l-4-4m4 4l4-4M4 17v3h16v-3"/>',
    fiscal: '<path d="M7 3h7l5 5v13H7z"/><path d="M14 3v5h5M10 13h6M10 17h6"/>',
    armazem: '<path d="M3 9l9-5 9 5v11H3z"/><path d="M7 20v-7h10v7M7 16h10"/>',
    camara: '<path d="M12 2v20M4.9 6.5l14.2 11M19.1 6.5L4.9 17.5"/><circle cx="12" cy="12" r="2.5"/>',
    estoque: '<path d="M4 7l8-4 8 4-8 4z"/><path d="M4 12l8 4 8-4M4 17l8 4 8-4"/>',
    inventario: '<path d="M9 4h6v3H9z"/><path d="M7 5H5v16h14V5h-2M8 12l2 2 4-4M8 17h8"/>',
    saida: '<path d="M3 7h11v9H3zM14 10h4l3 3v3h-7"/><circle cx="7" cy="17.5" r="1.8"/><circle cx="17" cy="17.5" r="1.8"/>',
    devolucao: '<path d="M9 14L4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 0 12h-3"/>',
    financeiro: '<rect x="3" y="6" width="18" height="12" rx="2"/><circle cx="12" cy="12" r="2.5"/>',
    relatorio: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
    cadastro: '<path d="M4 6h16M4 12h16M4 18h10"/>',
    config: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M19.1 4.9L17 7M7 17l-2.1 2.1"/>'
  };
  function icone(nome) {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' +
      (ICONES[nome] || ICONES.cadastro) + '</svg>';
  }
  function ler(chave, padrao) {
    try { var v = localStorage.getItem(chave); return v == null ? padrao : JSON.parse(v); } catch (e) { return padrao; }
  }
  function gravar(chave, valor) {
    try { localStorage.setItem(chave, JSON.stringify(valor)); } catch (e) { /* armazenamento indisponível */ }
  }
  function normalizar(s) {
    return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  }
  function criar(tag, classe, texto) {
    var e = document.createElement(tag);
    if (classe) e.className = classe;
    if (texto != null) e.textContent = texto;
    return e;
  }

  /* ── Menu lateral ─────────────────────────────────────── */
  function montarMenu() {
    var cont = $('ws-menu-grupos');
    M.grupos.forEach(function (g) {
      var visiveis = g.itens.filter(function (i) { return porId[i.id]; });
      if (!visiveis.length) return;
      var grupo = criar('div', 'ws-grupo');
      grupo.dataset.grupo = g.id;
      grupo.setAttribute('aria-expanded', 'false');
      var titulo = criar('button', 'ws-grupo-titulo');
      titulo.type = 'button';
      titulo.title = g.rotulo;
      titulo.innerHTML = '<span class="ws-icone" aria-hidden="true">' + icone(g.icone) + '</span>' +
        '<span class="ws-rotulo"></span><span class="ws-seta" aria-hidden="true">›</span>';
      titulo.querySelector('.ws-rotulo').textContent = g.rotulo;
      titulo.setAttribute('aria-controls', 'ws-itens-' + g.id);
      titulo.addEventListener('click', function () {
        var abrir;
        if (document.body.classList.contains('ws-menu-recolhido') && !ehMobile()) {
          alternarMenu(false);
          abrir = true;
        } else {
          abrir = grupo.getAttribute('aria-expanded') !== 'true';
        }
        // Sanfona: um módulo aberto por vez.
        if (abrir) {
          document.querySelectorAll('#ws-menu .ws-grupo').forEach(function (outro) {
            if (outro !== grupo) outro.setAttribute('aria-expanded', 'false');
          });
        }
        grupo.setAttribute('aria-expanded', abrir ? 'true' : 'false');
        if (abrir) {
          try { grupo.scrollIntoView({ block: 'nearest' }); } catch (e) { /* ignore */ }
        }
      });
      var lista = criar('div', 'ws-grupo-itens');
      lista.id = 'ws-itens-' + g.id;
      var secoesVisiveis = (g.secoes || [{ rotulo: '', itens: visiveis }]).filter(function (sec) {
        return sec.itens.some(function (i) { return porId[i.id]; });
      });
      var mostrarSecoes = secoesVisiveis.length > 1;
      secoesVisiveis.forEach(function (sec) {
        if (mostrarSecoes) lista.appendChild(criar('div', 'ws-secao', sec.rotulo));
        sec.itens.filter(function (i) { return porId[i.id]; }).forEach(function (it) {
          var a = criar('a', 'ws-item', it.rotulo);
          a.href = '/app?tela=' + encodeURIComponent(it.id);
          a.dataset.tela = it.id;
          var estrela = criar('button', 'ws-item-fav', '★');
          estrela.type = 'button';
          estrela.dataset.tela = it.id;
          estrela.title = 'Favoritar';
          estrela.setAttribute('aria-label', 'Favoritar ' + it.rotulo);
          estrela.setAttribute('aria-pressed', favoritos().indexOf(it.id) !== -1 ? 'true' : 'false');
          estrela.addEventListener('click', function (ev) {
            ev.preventDefault();
            ev.stopPropagation();
            alternarFavorito(it.id);
          });
          a.appendChild(estrela);
          a.addEventListener('click', function (ev) {
            if (ev.ctrlKey || ev.metaKey || ev.shiftKey || ev.button !== 0) return;
            ev.preventDefault();
            abrirTela(it.id);
          });
          lista.appendChild(a);
        });
      });
      grupo.appendChild(titulo);
      grupo.appendChild(lista);
      cont.appendChild(grupo);
    });
    ['ws-btn-modulos', 'ws-marca'].forEach(function (id) {
      var el = $(id);
      if (!el) return;
      el.addEventListener('click', function (ev) {
        if (ev.ctrlKey || ev.metaKey || ev.shiftKey || ev.button !== 0) return;
        ev.preventDefault();
        abrirTela('inicio');
      });
    });
  }

  function marcarAtivo(item) {
    var id = item === 'inicio' ? 'inicio' : (item && item.id);
    document.querySelectorAll('.ws-ativo').forEach(function (e) { e.classList.remove('ws-ativo'); });
    document.querySelectorAll('.ws-grupo-ativo').forEach(function (e) { e.classList.remove('ws-grupo-ativo'); });
    if (!id) return;
    var alvo = document.querySelector('#ws-menu [data-tela="' + id + '"]');
    if (!alvo) return;
    alvo.classList.add('ws-ativo');
    var grupo = alvo.closest('.ws-grupo');
    // Sanfona: ao navegar, fica aberto só o grupo da tela atual (o menu não cresce sem parar).
    document.querySelectorAll('#ws-menu .ws-grupo').forEach(function (g) {
      if (g !== grupo) g.setAttribute('aria-expanded', 'false');
    });
    if (grupo) {
      grupo.classList.add('ws-grupo-ativo');
      grupo.setAttribute('aria-expanded', 'true');
    }
    try { alvo.scrollIntoView({ block: 'nearest' }); } catch (e) { /* ignore */ }
  }

  function alternarMenu(recolher) {
    if (ehMobile()) {
      var abrir = !document.body.classList.contains('ws-menu-aberto-mobile');
      document.body.classList.toggle('ws-menu-aberto-mobile', abrir);
      $('ws-menu-fundo').hidden = !abrir;
      $('ws-btn-menu').setAttribute('aria-expanded', abrir ? 'true' : 'false');
      return;
    }
    var r = typeof recolher === 'boolean' ? recolher : !document.body.classList.contains('ws-menu-recolhido');
    document.body.classList.toggle('ws-menu-recolhido', r);
    $('ws-btn-menu').setAttribute('aria-expanded', r ? 'false' : 'true');
    gravar('ws-menu-recolhido', r);
  }
  function fecharMenuMobile() {
    document.body.classList.remove('ws-menu-aberto-mobile');
    $('ws-menu-fundo').hidden = true;
  }

  /* ── Quadros (um por sistema interno) ─────────────────── */
  function carregando(sim) { $('ws-carregando').hidden = !sim; }

  function quadro(app) {
    if (quadros[app]) return quadros[app];
    var f = document.createElement('iframe');
    f.title = 'Tela do WMS';
    f.setAttribute('allow', 'camera; microphone; clipboard-read; clipboard-write; fullscreen; geolocation');
    f.hidden = true;
    var q = { el: f, carregado: false };
    f.addEventListener('load', function () {
      q.carregado = true;
      carregando(false);
      setTimeout(sincronizarBarraPro, 300);
      try {
        var w = f.contentWindow;
        urlInternaMudou(w, w.location.pathname + w.location.search);
      } catch (e) { /* ignore */ }
    });
    $('ws-quadros').appendChild(f);
    quadros[app] = q;
    return q;
  }

  /** Troca de tela dentro do sistema já carregado, sem recarregar. */
  function navegarNoLocal(app, q, url) {
    if (!q.carregado) return false;
    var w;
    try { w = q.el.contentWindow; if (!w || !w.location) return false; } catch (e) { return false; }
    var destino = new URL(url, window.location.origin);
    var atual = w.location.pathname;
    if (M.appDaUrl(atual) !== app) return false;
    if (app === 'pro') {
      if (typeof w.wmsAbrirTela !== 'function') return false;
      var p = destino.searchParams;
      return w.wmsAbrirTela(p.get('modulo') || 'carregamento', p.get('aba') || '') !== false;
    }
    if (app === 'plus' || app === 'light') {
      if (atual !== destino.pathname) return false;
      if (app === 'plus') {
        var cfgDestino = destino.searchParams.get('secao') === 'config';
        var cfgAtual = new URL(w.location.href).searchParams.get('secao') === 'config';
        if (cfgDestino || cfgAtual) return false;   // Hierarquia & Permissões é outra tela do Plus
      }
      try {
        w.history.replaceState(w.history.state, '', destino.pathname + destino.search);
        w.dispatchEvent(new w.PopStateEvent('popstate', { state: w.history.state }));
        return true;
      } catch (e) { return false; }
    }
    return false;
  }

  function atualizarUrlShell(busca, substituir) {
    var nova = '/app' + (busca || '');
    if (window.location.pathname + window.location.search === nova) return;
    try { history[substituir ? 'replaceState' : 'pushState']({}, '', nova); } catch (e) { /* ignore */ }
  }

  function mostrarInicio(opts) {
    opts = opts || {};
    appVisivel = 'inicio';
    Object.keys(quadros).forEach(function (a) { quadros[a].el.hidden = true; });
    $('ws-quadros').hidden = true;
    carregando(false);
    $('ws-inicio').hidden = false;
    renderInicioPessoal();
    marcarAtivo('inicio');
    atualizarTrilha(null);
    sincronizarBarraPro();
    atualizarUrlShell('', opts.substituir);
    document.title = 'Módulos — WMS DOCA LIVRE PRO';
    fecharMenuMobile();
  }

  function abrirUrl(url, opts) {
    opts = opts || {};
    var caminho = String(url || '').split('?')[0];
    if (caminho === '/entrada' || caminho === '/' || caminho === '/app') return mostrarInicio(opts);
    var app = M.appDaUrl(url);
    var item = porChave[M.chaveDaUrl(url)] || null;
    // Registra a nova entrada do histórico ANTES de trocar a tela: a tela interna avisa a
    // URL nova (replaceState) e esse aviso deve cair na entrada nova, não na anterior.
    atualizarUrlShell(item ? '?tela=' + encodeURIComponent(item.id) : '?abrir=' + encodeURIComponent(url), opts.substituir);
    $('ws-inicio').hidden = true;
    $('ws-quadros').hidden = false;
    var q = quadro(app);
    if (!navegarNoLocal(app, q, url)) {
      carregando(true);
      var jaAberto = q.carregado;
      q.carregado = false;
      // location.replace não cria entrada no histórico do navegador (o Voltar é da moldura).
      var trocou = false;
      if (jaAberto) {
        try { q.el.contentWindow.location.replace(url); trocou = true; } catch (e) { trocou = false; }
      }
      if (!trocou) q.el.src = url;
    }
    Object.keys(quadros).forEach(function (a) { quadros[a].el.hidden = a !== app; });
    appVisivel = app;
    marcarAtivo(item);
    atualizarTrilha(item);
    if (item) registrarRecente(item.id);
    sincronizarBarraPro();
    document.title = (item ? tituloItem(item) + ' — ' : '') + 'WMS DOCA LIVRE PRO';
    fecharMenuMobile();
  }

  function abrirTela(id, opts) {
    if (id === 'inicio' || !porId[id]) return mostrarInicio(opts);
    abrirUrl(porId[id].url, opts);
  }

  /** Chamado pelas telas internas (wms-embutido.js) quando a URL delas muda. */
  function urlInternaMudou(win, url) {
    var app = null;
    Object.keys(quadros).forEach(function (a) {
      try { if (quadros[a].el.contentWindow === win) app = a; } catch (e) { /* ignore */ }
    });
    if (!app || app !== appVisivel) return;
    var item = porChave[M.chaveDaUrl(url)];
    if (!item) return;
    marcarAtivo(item);
    atualizarTrilha(item);
    atualizarUrlShell('?tela=' + encodeURIComponent(item.id), true);
    document.title = tituloItem(item) + ' — WMS DOCA LIVRE PRO';
  }

  function tituloItem(item) { return item.grupoRotulo + ' › ' + item.rotulo; }

  /** Trilha "Módulo › Tela" no cabeçalho; "← Módulos" só aparece dentro de uma tela. */
  function atualizarTrilha(item) {
    var trilha = $('ws-trilha');
    var voltar = $('ws-btn-modulos');
    if (voltar) voltar.hidden = !item;
    if (!trilha) return;
    trilha.innerHTML = '';
    if (!item) {
      trilha.appendChild(criar('strong', null, 'Módulos'));
      return;
    }
    var grupo = criar('button', 'ws-trilha-modulo', item.grupoRotulo);
    grupo.type = 'button';
    grupo.title = 'Abrir ' + item.grupoRotulo;
    grupo.addEventListener('click', function () {
      var g = M.grupos.filter(function (x) { return x.id === item.grupo; })[0];
      if (g && porId[g.principal]) abrirTela(g.principal);
    });
    trilha.appendChild(grupo);
    trilha.appendChild(criar('span', 'ws-trilha-sep', '›'));
    trilha.appendChild(criar('strong', null, item.rotulo));
  }

  /* ── Sino de NFs paradas e "Atualizar aba" do PRO no cabeçalho único ── */
  function docPro() {
    if (appVisivel !== 'pro' || !quadros.pro || !quadros.pro.carregado) return null;
    try { return quadros.pro.el.contentWindow.document; } catch (e) { return null; }
  }
  function sincronizarBarraPro() {
    var doc = docPro();
    var contPro = doc && doc.getElementById('terceiros-alertas-count');
    var sinoPro = doc && doc.getElementById('btn-terceiros-alertas');
    var atualizarPro = doc && doc.getElementById('btn-atualizar-aba');
    $('ws-alertas').hidden = !contPro;
    if (contPro) {
      $('ws-alertas-count').textContent = contPro.textContent;
      $('ws-btn-alertas').classList.toggle('header-alertas-btn--ativo', !!(sinoPro && sinoPro.classList.contains('header-alertas-btn--ativo')));
    }
    // O PRO mostra "Atualizar aba" só no Carregamento (style.display controlado por ele).
    $('ws-btn-atualizar').hidden = !(atualizarPro && atualizarPro.style.display !== 'none');
  }
  function ligarBarraPro() {
    $('ws-btn-alertas').addEventListener('click', function () {
      var doc = docPro();
      var b = doc && doc.getElementById('btn-terceiros-alertas');
      if (b) b.click();
    });
    $('ws-btn-atualizar').addEventListener('click', function () {
      var doc = docPro();
      var b = doc && doc.getElementById('btn-atualizar-aba');
      if (b) b.click();
    });
    setInterval(sincronizarBarraPro, 1500);
  }

  /* ── Relógio (como no cabeçalho do PRO) ──────────────── */
  function atualizarRelogio() {
    var d = new Date();
    var p = function (n) { return String(n).padStart(2, '0'); };
    if ($('ws-hora')) $('ws-hora').textContent = p(d.getHours()) + ':' + p(d.getMinutes());
    if ($('ws-data')) $('ws-data').textContent = p(d.getDate()) + '/' + p(d.getMonth() + 1) + '/' + d.getFullYear();
  }

  /* ── Busca ───────────────────────────────────────────── */
  var indiceBusca = itens.map(function (i) {
    return { item: i, texto: normalizar(i.rotulo + ' ' + i.grupoRotulo + ' ' + (i.secao || '')), rotulo: normalizar(i.rotulo) };
  });
  var resultadoSel = -1;
  function buscar(q) {
    var termos = normalizar(q).split(/\s+/).filter(Boolean);
    if (!termos.length) return [];
    return indiceBusca
      .filter(function (e) { return termos.every(function (t) { return e.texto.indexOf(t) !== -1; }); })
      .sort(function (a, b) {
        var pa = a.rotulo.indexOf(termos[0]) === 0 ? 0 : 1;
        var pb = b.rotulo.indexOf(termos[0]) === 0 ? 0 : 1;
        return pa - pb || a.rotulo.localeCompare(b.rotulo);
      })
      .slice(0, 12)
      .map(function (e) { return e.item; });
  }
  function renderBusca() {
    var lista = $('ws-busca-resultados');
    var q = $('ws-busca').value;
    lista.innerHTML = '';
    resultadoSel = -1;
    if (!q.trim()) { lista.hidden = true; return; }
    var res = buscar(q);
    if (!res.length) {
      var vazio = criar('li', 'ws-busca-vazio', 'Nenhuma tela encontrada.');
      lista.appendChild(vazio);
    }
    res.forEach(function (it, idx) {
      var li = criar('li');
      li.setAttribute('role', 'option');
      var b = criar('button');
      b.type = 'button';
      b.appendChild(criar('span', null, it.rotulo));
      b.appendChild(criar('small', null, it.grupoRotulo + (it.secao ? ' › ' + it.secao : '')));
      b.addEventListener('mousedown', function (ev) { ev.preventDefault(); });
      b.addEventListener('click', function () { escolherResultado(it); });
      li.dataset.idx = idx;
      li.appendChild(b);
      lista.appendChild(li);
    });
    lista.hidden = false;
  }
  function escolherResultado(it) {
    $('ws-busca').value = '';
    $('ws-busca-resultados').hidden = true;
    $('ws-busca').blur();
    abrirTela(it.id);
  }
  function moverSelecao(delta) {
    var lis = $('ws-busca-resultados').querySelectorAll('li[role="option"]');
    if (!lis.length) return;
    resultadoSel = (resultadoSel + delta + lis.length) % lis.length;
    lis.forEach(function (li, i) { li.setAttribute('aria-selected', i === resultadoSel ? 'true' : 'false'); });
    try { lis[resultadoSel].scrollIntoView({ block: 'nearest' }); } catch (e) { /* ignore */ }
  }
  function ligarBusca() {
    var input = $('ws-busca');
    input.addEventListener('input', renderBusca);
    input.addEventListener('focus', renderBusca);
    input.addEventListener('blur', function () { setTimeout(function () { $('ws-busca-resultados').hidden = true; }, 120); });
    input.addEventListener('keydown', function (ev) {
      if (ev.key === 'ArrowDown') { ev.preventDefault(); moverSelecao(1); }
      else if (ev.key === 'ArrowUp') { ev.preventDefault(); moverSelecao(-1); }
      else if (ev.key === 'Escape') { input.value = ''; renderBusca(); input.blur(); }
      else if (ev.key === 'Enter') {
        var res = buscar(input.value);
        if (res.length) escolherResultado(res[resultadoSel >= 0 ? resultadoSel : 0]);
      }
    });
    document.addEventListener('keydown', function (ev) {
      var t = ev.target;
      var digitando = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
      if (ev.key === '/' && !digitando) { ev.preventDefault(); input.focus(); }
    });
  }

  /* ── Início: favoritos, recentes e todas as áreas ─────── */
  function favoritos() { return ler('ws-favoritos', []).filter(function (id) { return porId[id]; }); }
  function registrarRecente(id) {
    var r = ler('ws-recentes', []).filter(function (x) { return x !== id; });
    r.unshift(id);
    gravar('ws-recentes', r.slice(0, 8));
  }
  function alternarFavorito(id) {
    var f = favoritos();
    var i = f.indexOf(id);
    if (i === -1) f.push(id); else f.splice(i, 1);
    gravar('ws-favoritos', f);
    renderInicioPessoal();
    document.querySelectorAll('.ws-fav[data-tela="' + id + '"], .ws-item-fav[data-tela="' + id + '"]').forEach(function (b) {
      b.setAttribute('aria-pressed', i === -1 ? 'true' : 'false');
    });
  }
  /** Atalho compacto (favoritos/recentes): nome da tela + módulo, para não haver ambiguidade. */
  function atalho(it) {
    var b = criar('div', 'ws-atalho');
    b.tabIndex = 0;
    b.setAttribute('role', 'link');
    var txt = criar('span', 'ws-atalho-texto');
    txt.appendChild(criar('strong', null, it.rotulo));
    txt.appendChild(criar('small', null, it.grupoRotulo));
    b.appendChild(txt);
    var fav = criar('button', 'ws-fav', '★');
    fav.type = 'button';
    fav.dataset.tela = it.id;
    fav.title = favoritos().indexOf(it.id) !== -1 ? 'Tirar dos favoritos' : 'Favoritar';
    fav.setAttribute('aria-label', fav.title + ': ' + it.rotulo);
    fav.setAttribute('aria-pressed', favoritos().indexOf(it.id) !== -1 ? 'true' : 'false');
    fav.addEventListener('click', function (ev) { ev.stopPropagation(); alternarFavorito(it.id); });
    b.appendChild(fav);
    b.addEventListener('click', function () { abrirTela(it.id); });
    b.addEventListener('keydown', function (ev) { if (ev.key === 'Enter') abrirTela(it.id); });
    return b;
  }
  function renderLista(idBloco, idCont, ids) {
    var cont = $(idCont);
    cont.innerHTML = '';
    ids.forEach(function (id) { if (porId[id]) cont.appendChild(atalho(porId[id])); });
    $(idBloco).hidden = !cont.children.length;
  }
  function renderInicioPessoal() {
    renderLista('ws-inicio-favoritos-bloco', 'ws-inicio-favoritos', favoritos());
    renderLista('ws-inicio-recentes-bloco', 'ws-inicio-recentes', ler('ws-recentes', []).slice(0, 6));
  }

  /** Um cartão por módulo: para que serve, atalhos das telas mais usadas e a tela principal. */
  function cartaoModulo(g) {
    var visiveis = g.itens.filter(function (i) { return porId[i.id]; });
    if (!visiveis.length) return null;
    var principal = porId[g.principal] || visiveis[0];
    var c = criar('article', 'ws-modulo');
    c.tabIndex = 0;
    c.setAttribute('role', 'link');
    c.setAttribute('aria-label', g.rotulo + ' — abrir ' + principal.rotulo);
    c.dataset.grupo = g.id;
    var topo = criar('div', 'ws-modulo-topo');
    var ic = criar('span', 'ws-modulo-icone');
    ic.setAttribute('aria-hidden', 'true');
    ic.innerHTML = icone(g.icone);
    var titulos = criar('div');
    titulos.appendChild(criar('h3', null, g.rotulo));
    if (g.descricao) titulos.appendChild(criar('p', null, g.descricao));
    topo.appendChild(ic);
    topo.appendChild(titulos);
    c.appendChild(topo);
    var chips = criar('div', 'ws-modulo-atalhos');
    (g.atalhos || []).forEach(function (id) {
      var it = porId[id];
      if (!it) return;
      var chip = criar('button', 'ws-chip', it.rotulo);
      chip.type = 'button';
      chip.dataset.tela = id;
      chip.addEventListener('click', function (ev) { ev.stopPropagation(); abrirTela(id); });
      chips.appendChild(chip);
    });
    if (chips.children.length) c.appendChild(chips);
    var rodape = criar('div', 'ws-modulo-rodape');
    rodape.appendChild(criar('span', null, visiveis.length + (visiveis.length === 1 ? ' tela' : ' telas')));
    rodape.appendChild(criar('span', 'ws-modulo-abrir', 'Abrir ' + principal.rotulo + ' ›'));
    c.appendChild(rodape);
    c.addEventListener('click', function () { abrirTela(principal.id); });
    c.addEventListener('keydown', function (ev) { if (ev.key === 'Enter') abrirTela(principal.id); });
    return c;
  }
  function renderInicioGrupos() {
    var cont = $('ws-inicio-grupos');
    M.grupos.forEach(function (g) {
      var c = cartaoModulo(g);
      if (c) cont.appendChild(c);
    });
  }

  /* ── Inicialização ──────────────────────────────────── */
  function abrirPelaUrlDoNavegador(substituir) {
    var p = new URLSearchParams(window.location.search);
    var tela = p.get('tela');
    var abrir = p.get('abrir');
    if (tela && porId[tela]) return abrirTela(tela, { substituir: substituir });
    if (abrir && /^\/[a-z]/i.test(abrir)) return abrirUrl(abrir, { substituir: substituir });
    mostrarInicio({ substituir: substituir });
  }

  window.wmsShell = { abrirUrl: function (url) { abrirUrl(url); }, abrirTela: abrirTela, urlInternaMudou: urlInternaMudou };

  montarMenu();
  ligarBarraPro();
  atualizarRelogio();
  setInterval(atualizarRelogio, 20000);
  renderInicioGrupos();
  ligarBusca();
  if (ler('ws-menu-recolhido', false) && !ehMobile()) alternarMenu(true);
  $('ws-btn-menu').addEventListener('click', function () { alternarMenu(); });
  $('ws-menu-fundo').addEventListener('click', fecharMenuMobile);
  window.addEventListener('popstate', function () { abrirPelaUrlDoNavegador(true); });

  if (window.WMS_TELA_INICIAL && porId[window.WMS_TELA_INICIAL]) abrirTela(window.WMS_TELA_INICIAL, { substituir: true });
  else if (window.WMS_ABRIR_INICIAL) abrirUrl(window.WMS_ABRIR_INICIAL, { substituir: true });
  else abrirPelaUrlDoNavegador(true);
})();

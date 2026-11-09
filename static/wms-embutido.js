/**
 * Carregado em todas as telas internas (Pro, Câmaras, Contagem, Início, Usuários).
 * Quando a tela está dentro do WMS unificado (/app), ela:
 *  - marca <html class="wms-embutido"> (cada tela esconde o próprio cabeçalho/menu);
 *  - envia para o WMS unificado os links que levam a outra tela do sistema;
 *  - avisa o WMS unificado sempre que a URL interna muda (menu destacado fica certo).
 */
(function () {
  var embutido = false;
  try { embutido = window.self !== window.top; } catch (e) { embutido = true; }
  window.__WMS_EMBUTIDO__ = embutido;
  var ROTAS = /^\/(painel|camaras|contagem|entrada|usuarios\/novo|config-portal|visao-camaras)(\/|$)/;

  if (!embutido) {
    // Tela interna aberta direto na janela (favorito antigo, link): abre dentro do WMS unificado.
    // ?moldura=0 mantém a tela sozinha (diagnóstico/impressão).
    var sozinha = /(?:^|[?&])moldura=0(?:&|$)/.test(window.location.search);
    if (!sozinha && ROTAS.test(window.location.pathname)) {
      window.location.replace('/app?abrir=' + encodeURIComponent(window.location.pathname + window.location.search));
    }
    return;
  }
  document.documentElement.classList.add('wms-embutido');

  function shell() {
    try { return window.top.wmsShell || null; } catch (e) { return null; }
  }

  document.addEventListener('click', function (ev) {
    if (ev.defaultPrevented || ev.button !== 0 || ev.ctrlKey || ev.metaKey || ev.shiftKey) return;
    var a = ev.target && ev.target.closest ? ev.target.closest('a[href]') : null;
    if (!a || (a.target && a.target !== '_self')) return;
    var url;
    try { url = new URL(a.getAttribute('href'), window.location.href); } catch (e) { return; }
    if (url.origin !== window.location.origin) return;
    if (url.pathname === '/login') {           // "Sair" e afins: sai do sistema inteiro
      ev.preventDefault();
      window.top.location.href = url.href;
      return;
    }
    if (!ROTAS.test(url.pathname)) return;
    var s = shell();
    if (!s) return;
    ev.preventDefault();
    s.abrirUrl(url.pathname + url.search);
  }, true);

  function avisar() {
    var s = shell();
    if (s && s.urlInternaMudou) s.urlInternaMudou(window, window.location.pathname + window.location.search);
  }
  // Dentro da moldura quem controla o histórico (botão Voltar) é o WMS unificado:
  // pushState da tela vira replaceState para não misturar entradas no histórico do navegador.
  var replaceOriginal = history.replaceState;
  history.replaceState = function () {
    var r = replaceOriginal.apply(this, arguments);
    try { avisar(); } catch (e) { /* ignore */ }
    return r;
  };
  history.pushState = function () {
    return history.replaceState.apply(this, arguments);
  };
  window.addEventListener('popstate', avisar);
})();

/**
 * Impressão HTML etiquetas WMS — força @page em polegadas (driver Zebra no Windows).
 */
(function (global) {
  function whenReady(fn) {
    if (document.readyState === 'complete') fn();
    else global.addEventListener('load', fn, { once: true });
  }

  function pageDimsFromBody() {
    var b = document.body;
    if (!b) return null;
    var page = b.getAttribute('data-etq-page');
    var w = b.getAttribute('data-etq-w');
    var h = b.getAttribute('data-etq-h');
    if (!page && !(w && h)) return null;
    if (!w || !h) {
      var parts = (page || '').trim().split(/\s+/);
      w = parts[0] || null;
      h = parts[1] || null;
    }
    return { page: page || (w + ' ' + h), w: w, h: h };
  }

  function injectPrintPageSize() {
    var dims = pageDimsFromBody();
    if (!dims) return;
    var el = document.getElementById('wms-dynamic-page');
    if (!el) {
      el = document.createElement('style');
      el.id = 'wms-dynamic-page';
      document.head.appendChild(el);
    }
    el.textContent =
      '@media print { @page { size: ' + dims.page + '; margin: 0; } ' +
      'html, body { margin: 0 !important; padding: 0 !important; background: #fff !important; } ' +
      '.etq-page { width: ' + dims.w + ' !important; height: ' + dims.h + ' !important; ' +
      'max-width: ' + dims.w + ' !important; max-height: ' + dims.h + ' !important; } }';
  }

  function imprimir(preparar) {
    whenReady(function () {
      injectPrintPageSize();
      if (typeof preparar === 'function') {
        try { preparar(); } catch (e) { console.warn(e); }
      }
      requestAnimationFrame(function () {
        requestAnimationFrame(function () {
          try { global.focus(); } catch (e) { /* pop-up */ }
          global.print();
        });
      });
    });
  }

  global.wmsEtiquetaImprimir = imprimir;
  global.addEventListener('beforeprint', injectPrintPageSize);
})(window);

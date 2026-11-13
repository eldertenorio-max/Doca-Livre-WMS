// WMS Doca Livre - o sistema nao funciona como "aplicativo instalado pelo navegador" (PWA): so pelo navegador comum
// ou pelo aplicativo oficial (APK). Janela sem barra de endereco que nao veio do APK e levada para a tela de aviso.
(function () {
    'use strict';
    var PACOTE = 'android-app://br.com.docalivre.wms';
    var doApk = false;
    try {
        // o APK abre o site informando de onde veio; guarda isso enquanto a janela estiver aberta
        // (pelo "referrer" e, a partir da versao 1.0.3, tambem pela marca ?apk=1 no endereco que o app abre)
        if ((document.referrer || '').indexOf(PACOTE) === 0 || /[?&]apk=1(&|$)/.test(location.search)) sessionStorage.setItem('wms.apk', '1');
        doApk = sessionStorage.getItem('wms.apk') === '1';
    } catch (e) {}
    var modo = function (m) { return !!(window.matchMedia && window.matchMedia('(display-mode: ' + m + ')').matches); };
    var instaladoPeloNavegador = modo('standalone') || modo('fullscreen') || modo('minimal-ui') || modo('window-controls-overlay')
        || window.navigator.standalone === true;
    if (instaladoPeloNavegador && !doApk && location.pathname !== '/app-antigo') location.replace('/app-antigo');
    // remove service workers que o sistema antigo tenha deixado neste endereco
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.getRegistrations().then(function (lista) {
            lista.forEach(function (r) { r.unregister(); });
        }).catch(function () {});
    }
})();

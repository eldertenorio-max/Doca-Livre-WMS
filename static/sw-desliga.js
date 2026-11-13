// WMS Doca Livre - desliga o "aplicativo instalado pelo navegador" do WMS antigo.
// O sistema antigo registrava um service worker neste endereco. Este arquivo toma o lugar dele, apaga o que ele
// guardou e se remove. O WMS novo nao usa service worker: o aplicativo oficial e o APK (Coletor > Aplicativo Android).
self.addEventListener('install', function () { self.skipWaiting(); });
self.addEventListener('activate', function (event) {
    event.waitUntil(
        caches.keys()
            .then(function (chaves) { return Promise.all(chaves.map(function (c) { return caches.delete(c); })); })
            .then(function () { return self.registration.unregister(); })
            .then(function () { return self.clients.matchAll({ type: 'window' }); })
            .then(function (janelas) { janelas.forEach(function (j) { try { j.navigate(j.url); } catch (e) {} }); })
    );
});

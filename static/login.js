// Login: mostrar/ocultar senha e a intro do WMS (barra de progresso e saída suave).
(function () {
    var botao = document.getElementById('btnVerSenha');
    if (botao) {
        botao.addEventListener('click', function () {
            var campo = document.getElementById('password');
            var mostrar = campo.type === 'password';
            campo.type = mostrar ? 'text' : 'password';
            botao.setAttribute('aria-label', mostrar ? 'Ocultar senha' : 'Mostrar senha');
            botao.querySelector('i').className = mostrar ? 'far fa-eye-slash' : 'far fa-eye';
        });
    }

    var splash = document.getElementById('wms-splash');
    if (!splash) return;

    function remover() { if (splash.parentNode) splash.parentNode.removeChild(splash); }

    // Depois de um erro de login (ou para quem pediu menos animação) a intro não se repete.
    var houveErro = !!document.querySelector('.error-message');
    var menosMovimento = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (houveErro || menosMovimento) { remover(); return; }

    var DURACAO_MINIMA = 2200;
    var SAIDA = 650;
    var barra = document.getElementById('splashBarra');
    var pct = document.getElementById('splashPct');
    var inicio = Date.now();
    var progresso = 0;

    var relogio = setInterval(function () {
        var minimoCumprido = Date.now() - inicio >= DURACAO_MINIMA;
        progresso = minimoCumprido ? Math.min(100, progresso + 6)
                                   : Math.min(88, progresso + 1.2 + Math.random() * 2.5);
        if (barra) barra.style.width = progresso + '%';
        if (pct) pct.textContent = String(Math.round(progresso));
        if (minimoCumprido && progresso >= 100) {
            clearInterval(relogio);
            setTimeout(function () {
                splash.classList.add('intro-splash--exit');
                setTimeout(remover, SAIDA + 40);
            }, 350);
        }
    }, 60);
})();

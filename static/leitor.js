// WMS Doca Livre — leitor de código de barras pela câmera (telas do Coletor).
// Ao lado de cada campo de bipar aparece um botão de câmera. O código lido entra no campo e a tela segue como se
// tivesse sido bipado (envia o formulário, ou escolhe o item quando o campo é o do produto).
// Usa o leitor do próprio navegador (BarcodeDetector, presente no Chrome do Android e no aplicativo). Onde ele não
// existe, o botão não aparece e o campo continua funcionando com leitor físico ou digitação.
(function () {
    'use strict';
    if (!('BarcodeDetector' in window) || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return;
    var campos = document.querySelectorAll('input[data-bipar], input[data-camera]');
    if (!campos.length) return;

    var FORMATOS = ['code_128', 'code_39', 'code_93', 'ean_13', 'ean_8', 'itf', 'upc_a', 'upc_e', 'codabar', 'qr_code', 'data_matrix'];
    var painel = null, video = null, aviso = null, fluxo = null, ativo = false, alvo = null, detector = null;

    function montar() {
        painel = document.createElement('div');
        painel.className = 'leitor-painel';
        painel.setAttribute('role', 'dialog');
        painel.setAttribute('aria-label', 'Ler código de barras com a câmera');
        painel.innerHTML = '<video playsinline muted></video><div class="leitor-mira"></div>' +
            '<p class="leitor-aviso">Aponte a câmera para o código de barras</p>' +
            '<button type="button" class="coletor-acao coletor-acao--leve leitor-fechar">Cancelar</button>';
        document.body.appendChild(painel);
        video = painel.querySelector('video');
        aviso = painel.querySelector('.leitor-aviso');
        painel.querySelector('.leitor-fechar').addEventListener('click', fechar);
    }

    function fechar() {
        ativo = false;
        if (fluxo) { fluxo.getTracks().forEach(function (t) { t.stop(); }); fluxo = null; }
        if (painel) painel.hidden = true;
        if (alvo) alvo.focus();
    }

    function entregar(codigo) {
        var campo = alvo;
        fechar();
        if (navigator.vibrate) navigator.vibrate(80);
        campo.value = codigo;
        campo.dispatchEvent(new Event('input', { bubbles: true }));
        if (campo.getAttribute('data-camera') === 'enter' || !campo.form) {
            campo.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
        } else if (campo.form.requestSubmit) {
            campo.form.requestSubmit();
        } else {
            campo.form.submit();
        }
    }

    function procurar() {
        if (!ativo) return;
        detector.detect(video).then(function (achados) {
            if (!ativo) return;
            if (achados.length && achados[0].rawValue) { entregar(String(achados[0].rawValue).trim()); return; }
            setTimeout(procurar, 160);
        }).catch(function () { if (ativo) setTimeout(procurar, 400); });
    }

    function abrir(campo) {
        if (!painel) montar();
        alvo = campo;
        painel.hidden = false;
        aviso.textContent = 'Abrindo a câmera…';
        navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false }).then(function (s) {
            fluxo = s;
            video.srcObject = s;
            return video.play();
        }).then(function () {
            return window.BarcodeDetector.getSupportedFormats ? window.BarcodeDetector.getSupportedFormats() : FORMATOS;
        }).then(function (suportados) {
            var formatos = FORMATOS.filter(function (f) { return suportados.indexOf(f) >= 0; });
            detector = new window.BarcodeDetector(formatos.length ? { formats: formatos } : undefined);
            aviso.textContent = 'Aponte a câmera para o código de barras';
            ativo = true;
            procurar();
        }).catch(function (erro) {
            aviso.textContent = erro && erro.name === 'NotAllowedError'
                ? 'A câmera está bloqueada para o WMS. Libere a câmera nas permissões do site ou do aplicativo.'
                : 'Não foi possível abrir a câmera deste aparelho.';
        });
    }

    campos.forEach(function (campo) {
        var botao = document.createElement('button');
        botao.type = 'button';
        botao.className = 'leitor-botao';
        botao.setAttribute('aria-label', 'Ler o código de barras com a câmera');
        botao.title = 'Ler com a câmera';
        botao.innerHTML = '<i class="fas fa-camera"></i>';
        var caixa = document.createElement('div');
        caixa.className = 'leitor-campo';
        campo.parentNode.insertBefore(caixa, campo);
        caixa.appendChild(campo);
        caixa.appendChild(botao);
        botao.addEventListener('click', function () { abrir(campo); });
    });
    document.addEventListener('keydown', function (ev) { if (ev.key === 'Escape' && ativo) fechar(); });
})();

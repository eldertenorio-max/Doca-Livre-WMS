// Gráficos da Análise de estoque (os mesmos do WMS Light), desenhados em SVG sem biblioteca.
// Cada <div class="grafico" data-grafico="{...}"> vira um gráfico:
//   tipo "linhas": um ponto por item no eixo de baixo, uma linha por série; "colunas": uma coluna por rótulo.
//   Passar o mouse mostra os valores; clicar num item (ou status) filtra a tela inteira; clicar de novo limpa.
(function () {
    'use strict';
    var NS = 'http://www.w3.org/2000/svg';
    var L = 1100, A = 340, M = { e: 78, d: 22, t: 26, b: 56 };      // largura, altura e margens do desenho
    var MAX_ROTULOS = 12;

    function el(nome, attrs, pai) {
        var e = document.createElementNS(NS, nome);
        Object.keys(attrs || {}).forEach(function (k) { e.setAttribute(k, attrs[k]); });
        if (pai) pai.appendChild(e);
        return e;
    }
    function numero(v, sufixo) {
        return Number(v).toLocaleString('pt-BR', { maximumFractionDigits: 2 }) + (sufixo || '');
    }
    function curto(t) { t = String(t); return t.length > 12 ? t.slice(0, 11) + '…' : t; }
    function escapar(t) {
        return String(t).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; });
    }
    // Passos "redondos" para o eixo vertical.
    function escala(min, max, inteiros) {
        if (min === max) { max = min + 1; }
        var bruto = (max - min) / 4, pot = Math.pow(10, Math.floor(Math.log10(bruto))), f = bruto / pot;
        var passo = (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * pot;
        if (inteiros && passo < 1) passo = 1;        // contagem não tem meio item
        var ini = Math.floor(min / passo) * passo, fim = Math.ceil(max / passo) * passo, marcas = [];
        for (var v = ini; v <= fim + passo / 2; v += passo) marcas.push(Math.round(v * 1e6) / 1e6);
        return { min: ini, max: fim, marcas: marcas };
    }

    function desenhar(caixa) {
        var g = JSON.parse(caixa.getAttribute('data-grafico'));
        var n = g.rotulos.length;
        var area = caixa.querySelector('.grafico-area');
        if (!n) { area.innerHTML = '<p class="text-muted small mb-0">' + (g.textoVazio || 'Sem itens para o gráfico neste filtro.') + '</p>'; return; }

        var todos = [];
        g.series.forEach(function (s) { s.valores.forEach(function (v) { todos.push(v || 0); }); });
        var esc = escala(Math.min(0, Math.min.apply(null, todos)), Math.max.apply(null, todos), todos.every(function (v) { return v === Math.round(v); }));
        var largura = L - M.e - M.d, altura = A - M.t - M.b;
        var colunas = g.tipo === 'colunas';
        function x(i) { return colunas ? M.e + (i + 0.5) * largura / n : M.e + (n === 1 ? largura / 2 : i * largura / (n - 1)); }
        function y(v) { return M.t + altura - ((v || 0) - esc.min) / (esc.max - esc.min) * altura; }

        var svg = el('svg', { viewBox: '0 0 ' + L + ' ' + A, role: 'img', 'aria-label': g.titulo + ' — os valores estão na lista abaixo', class: 'grafico-svg' });
        // grade e eixo vertical
        esc.marcas.forEach(function (m) {
            el('line', { x1: M.e, x2: L - M.d, y1: y(m), y2: y(m), class: m === 0 ? 'grafico-base' : 'grafico-grade' }, svg);
            el('text', { x: M.e - 8, y: y(m) + 6, 'text-anchor': 'end', class: 'grafico-eixo' }, svg).textContent = numero(m, g.sufixo);
        });
        // rótulos do eixo de baixo (amostrados quando são muitos)
        var passo = n <= MAX_ROTULOS ? 1 : Math.ceil(n / 10);
        g.rotulos.forEach(function (r, i) {
            if (i % passo) return;
            el('text', { x: x(i), y: A - M.b + 26, 'text-anchor': colunas || n === 1 ? 'middle' : i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle', class: 'grafico-eixo' + (g.ativo === g.chaves[i] ? ' grafico-eixo--ativo' : '') }, svg).textContent = curto(r);
        });

        if (colunas) {
            var w = Math.min(90, largura / n * 0.6);
            g.series[0].valores.forEach(function (v, i) {
                var topo = y(v), base = y(0);
                if (v) el('path', { d: 'M' + (x(i) - w / 2) + ',' + base + ' V' + (topo + 4) + ' q0,-4 4,-4 H' + (x(i) + w / 2 - 4) + ' q4,0 4,4 V' + base + ' Z',
                                     fill: g.pontos[i], class: g.ativo && g.ativo !== g.chaves[i] ? 'grafico-apagado' : '' }, svg);
                el('text', { x: x(i), y: topo - 8, 'text-anchor': 'middle', class: 'grafico-valor' }, svg).textContent = numero(v);
            });
        } else {
            g.series.forEach(function (s) {
                var d = s.valores.map(function (v, i) { return (i ? 'L' : 'M') + x(i).toFixed(1) + ',' + y(v).toFixed(1); }).join(' ');
                el('path', { d: d, fill: 'none', stroke: g.pontos ? 'var(--grafico-linha-neutra)' : 'var(' + s.cor + ')', 'stroke-width': 3, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }, svg);
                if (n <= 60) s.valores.forEach(function (v, i) {
                    el('circle', { cx: x(i), cy: y(v), r: g.ativo === g.chaves[i] ? 9 : 6, fill: g.pontos ? g.pontos[i] : 'var(' + s.cor + ')', class: 'grafico-ponto' }, svg);
                });
            });
        }

        // camada de passar o mouse: linha vertical + marcadores + caixa com os valores de todas as séries
        var guia = el('line', { y1: M.t, y2: A - M.b, class: 'grafico-guia', visibility: 'hidden' }, svg);
        var marcas = g.series.map(function (s) { return colunas ? null : el('circle', { r: 9, fill: 'var(' + s.cor + ')', class: 'grafico-ponto', visibility: 'hidden' }, svg); });
        var alvo = el('rect', { x: M.e - 10, y: M.t, width: largura + 20, height: altura + 30, fill: 'transparent', class: g.links ? 'grafico-alvo grafico-alvo--clicavel' : 'grafico-alvo' }, svg);
        var dica = caixa.querySelector('.grafico-dica');
        function indice(ev) {
            var r = svg.getBoundingClientRect(), px = (ev.clientX - r.left) / r.width * L;
            var i = colunas ? Math.floor((px - M.e) / (largura / n)) : Math.round((px - M.e) / (n === 1 ? 1 : largura / (n - 1)));
            return Math.max(0, Math.min(n - 1, i));
        }
        function mostrar(ev) {
            var i = indice(ev);
            guia.setAttribute('x1', x(i)); guia.setAttribute('x2', x(i)); guia.setAttribute('visibility', colunas ? 'hidden' : 'visible');
            marcas.forEach(function (m, k) {
                if (!m) return;
                m.setAttribute('cx', x(i)); m.setAttribute('cy', y(g.series[k].valores[i])); m.setAttribute('visibility', 'visible');
                if (g.pontos) m.setAttribute('fill', g.pontos[i]);
            });
            dica.innerHTML = '<strong>' + escapar(g.rotulos[i]) + '</strong>' + (g.descricoes && g.descricoes[i] ? '<small>' + escapar(g.descricoes[i]) + '</small>' : '') +
                g.series.map(function (s) {
                    return '<span><i style="background:' + (g.pontos ? g.pontos[i] : 'var(' + s.cor + ')') + '"></i>' + escapar(s.nome) + '<b>' + numero(s.valores[i] || 0, g.sufixo) + '</b></span>';
                }).join('') + (g.links ? '<em>' + (g.ativo === g.chaves[i] ? 'Clique para limpar o filtro' : (g.textoLink || 'Clique para filtrar')) + '</em>' : '');
            dica.hidden = false;
            var r = caixa.getBoundingClientRect(), s = svg.getBoundingClientRect();
            var esquerda = s.left - r.left + x(i) / L * s.width, larguraDica = dica.offsetWidth;
            dica.style.left = Math.max(0, Math.min(r.width - larguraDica, esquerda + (esquerda > r.width / 2 ? -larguraDica - 12 : 12))) + 'px';
            dica.style.top = (s.top - r.top + 8) + 'px';
        }
        function esconder() { dica.hidden = true; guia.setAttribute('visibility', 'hidden'); marcas.forEach(function (m) { if (m) m.setAttribute('visibility', 'hidden'); }); }
        alvo.addEventListener('mousemove', mostrar);
        alvo.addEventListener('mouseleave', esconder);
        if (g.links) alvo.addEventListener('click', function (ev) { window.location.href = g.links[indice(ev)]; });

        area.innerHTML = '';
        area.appendChild(svg);
    }

    document.querySelectorAll('.grafico[data-grafico]').forEach(desenhar);
    // O painel de gráficos lembra se a pessoa o deixou aberto ou fechado.
    var painel = document.getElementById('painelGraficos');
    if (painel) {
        try { if (localStorage.getItem('wms.analise.graficos') === 'fechado') painel.open = false; } catch (e) {}
        painel.addEventListener('toggle', function () {
            try { localStorage.setItem('wms.analise.graficos', painel.open ? 'aberto' : 'fechado'); } catch (e) {}
        });
    }
})();

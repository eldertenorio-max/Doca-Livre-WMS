// Mapa das câmaras.
// 2D: mesmo desenho do mapa do WMS Plus — cada câmara num painel com os cartões de resumo, as ruas lado a
//     lado e as posições como estante (vão branco, longarina em cima, montante à esquerda).
// 3D: disponível quando uma câmara está escolhida; só é carregado quando a pessoa pede.
(function () {
    'use strict';
    var bruto = document.getElementById('dadosMapa');
    var area2d = document.getElementById('mapa2d');
    if (!bruto || !area2d) return;

    var dados = JSON.parse(bruto.textContent);
    var cfg = window.WMS_MAPA;
    var area3d = document.getElementById('mapa3d');
    var btn2d = document.getElementById('btnVisao2d');
    var btn3d = document.getElementById('btnVisao3d');
    var aviso = document.getElementById('mapaAviso');
    var ROTULO = { livre: 'Disponível', ocupado: 'Ocupado', bloqueado: 'Bloqueado' };
    var CEL_MIN = 18, CEL_MAX = 40, CEL_MIN_CELULAR = 14, CEL_MAX_CELULAR = 22;
    var celular = window.matchMedia('(max-width: 767px)');

    function ler(chave) { try { return localStorage.getItem(chave); } catch (e) { return null; } }
    function gravar(chave, valor) { try { localStorage.setItem(chave, valor); } catch (e) {} }
    function escapar(t) {
        return String(t == null ? '' : t).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; });
    }
    function numerico(a, b) { return a - b; }

    // ------------------------------------------------------------ preparo: ruas, portas e resumo de cada câmara
    var porId = {};
    dados.camaras.forEach(function (camara) {
        var mapa = {};
        camara.ruas = [];
        function ruaDe(nome) {
            if (!mapa[nome]) { mapa[nome] = { rua: nome, celulas: {}, vaos: {}, colunas: {}, niveis: {} }; camara.ruas.push(mapa[nome]); }
            return mapa[nome];
        }
        camara.enderecos.forEach(function (e) {
            e.camara = camara;
            porId[e.id] = e;
            var r = ruaDe(e.rua);
            r.celulas[e.coluna + '|' + e.nivel] = e;
            r.colunas[e.coluna] = true;
            r.niveis[e.nivel] = true;
        });
        // Portas e pontos sem posição marcados na criação da câmara: também contam para o tamanho da rua.
        (camara.vaos || []).forEach(function (v) {
            var r = ruaDe(v.rua);
            r.vaos[v.coluna + '|' + v.nivel] = v.tipo;
            r.colunas[v.coluna] = true;
            r.niveis[v.nivel] = true;
        });
        camara.ruas.sort(function (a, b) { return a.rua < b.rua ? -1 : a.rua > b.rua ? 1 : 0; });
        var topo = 0;
        camara.ruas.forEach(function (r) {
            r.colunas = Object.keys(r.colunas).map(Number).sort(numerico);
            r.niveis = Object.keys(r.niveis).map(Number).sort(numerico);
            topo = Math.max(topo, r.niveis[r.niveis.length - 1]);
        });
        camara.ruas.forEach(function (r) {
            // Todas as ruas da câmara mostram os mesmos níveis e todas as colunas do intervalo, como numa estante.
            var cols = [], nivs = [];
            for (var c = r.colunas[0]; c <= r.colunas[r.colunas.length - 1]; c++) cols.push(c);
            for (var n = 1; n <= topo; n++) nivs.push(n);
            r.colunas = cols; r.niveis = nivs;
            r.portas = acharPortas(r);
        });
        var ocupados = camara.enderecos.filter(function (e) { return e.status === 'ocupado'; });
        var skus = {}, notas = {}, paletes = 0;
        ocupados.forEach(function (e) {
            e.paletes.forEach(function (p) { paletes++; if (p.sku) skus[p.sku] = true; if (p.nf) notas[p.nf] = true; });
        });
        camara.resumo = {
            total: camara.enderecos.length, ocupadas: ocupados.length,
            bloqueadas: camara.enderecos.filter(function (e) { return e.status === 'bloqueado'; }).length,
            itens: Object.keys(skus).length, notas: Object.keys(notas).length, paletes: paletes
        };
        camara.resumo.livres = camara.resumo.total - camara.resumo.ocupadas - camara.resumo.bloqueadas;
        camara.resumo.pct = camara.resumo.total ? 100 * camara.resumo.ocupadas / camara.resumo.total : 0;
    });

    // Portas da rua. Colunas vizinhas com a mesma faixa de níveis formam uma porta só, para a imagem da porta
    // ser recortada por cima do bloco inteiro.
    // - Rua com marcações (câmara criada pelo desenho): vale o que foi marcado como Porta.
    // - Rua sem marcações (layout importado): vão sem posição que começa no chão é porta.
    function acharPortas(r) {
        r.temMarcas = Object.keys(r.vaos).length > 0;
        var portas = [], atual = null;
        r.colunas.forEach(function (c) {
            var n0 = 0, n1 = 0;
            if (r.temMarcas) {
                r.niveis.forEach(function (n) { if (r.vaos[c + '|' + n] === 'Porta') { if (!n0) n0 = n; n1 = n; } });
            } else {
                var altura = 0;
                while (altura < r.niveis.length && !r.celulas[c + '|' + (altura + 1)]) altura++;
                if (altura && altura < r.niveis.length) { n0 = 1; n1 = altura; }   // coluna inteira vazia não é porta
            }
            if (n0 && atual && atual.n0 === n0 && atual.n1 === n1 && atual.c1 === c - 1) { atual.c1 = c; return; }
            atual = n0 ? { c0: c, c1: c, n0: n0, n1: n1 } : null;
            if (atual) portas.push(atual);
        });
        return portas;
    }
    function portaDe(r, coluna, nivel) {
        if (r.temMarcas && r.vaos[coluna + '|' + nivel] !== 'Porta') return null;
        for (var i = 0; i < r.portas.length; i++) {
            var p = r.portas[i];
            if (coluna >= p.c0 && coluna <= p.c1 && nivel >= p.n0 && nivel <= p.n1) return p;
        }
        return null;
    }

    function conteudo(e) {
        var p = e.paletes && e.paletes[0];
        return p ? ' · ' + (p.sku || '') + ' ' + (p.quantidade || '') : '';
    }
    function descricao(e) {
        return 'Cam. ' + e.camara.codigo + ' · Rua ' + e.rua + ' · Col ' + e.coluna + ' · Nív ' + e.nivel + ' — ' + ROTULO[e.status] +
               conteudo(e) + (e.destino ? ' · ' + e.destino : '') + (e.cliente ? ' · espaço de ' + e.cliente : '');
    }

    // ------------------------------------------------------------ detalhe do endereço (modal)
    var modalEl = document.getElementById('modalEndereco');
    var modal = modalEl ? new bootstrap.Modal(modalEl) : null;
    function texto(id, valor) { var el = document.getElementById(id); if (el) el.textContent = valor; }
    function cnpj(v) {
        return v && v.length === 14 ? v.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5') : (v || '');
    }
    // Logo da empresa dona da mercadoria; sem logo cadastrado, as iniciais.
    function marca(p, classe) {
        return p.logo ? '<img class="' + classe + '" src="' + escapar(p.logo) + '" alt="" loading="lazy">'
                      : '<span class="' + classe + ' ' + classe + '--iniciais" aria-hidden="true">' + escapar(p.iniciais || '?') + '</span>';
    }
    function campo(rotulo, valor, classe) {
        return '<div><dt>' + rotulo + '</dt><dd' + (classe ? ' class="' + classe + '"' : '') + '>' + escapar(valor || '—') + '</dd></div>';
    }
    // Todos os dados do palete que está na posição (clique no quadrado).
    function cartaoPalete(p) {
        var itens = (p.itens || []).map(function (i) {
            return '<tr><td><strong>' + escapar(i.sku) + '</strong></td><td>' + escapar(i.descricao || '') + '</td><td class="codigo-mono">' + escapar(i.ean || '—') +
                '</td><td class="codigo-mono">' + escapar(i.dun || '—') + '</td><td>' + escapar(i.quantidade) + '</td><td>' + escapar(i.lote || '—') +
                '</td><td>' + escapar(i.fabricacao || '—') + '</td><td>' + escapar(i.validade || '—') + '</td></tr>';
        }).join('');
        var atalhos = '';
        // "Abrir nota fiscal" abre o PDF da nota (DANFE) numa aba nova; a tela de conferência fica em "Recebimento da nota".
        if (p.nota_id && cfg.urlNotaPdf) atalhos += '<a class="btn btn-sm btn-outline-primary" target="_blank" rel="noopener" href="' + cfg.urlNotaPdf.replace('/0/', '/' + p.nota_id + '/') + '"><i class="fas fa-file-pdf"></i>Abrir nota fiscal</a>';
        if (p.nota_id && cfg.urlNota) atalhos += '<a class="btn btn-sm btn-outline-primary" href="' + cfg.urlNota.replace('/0', '/' + p.nota_id) + '"><i class="fas fa-file-invoice"></i>Recebimento da nota</a>';
        if (cfg.urlEtiquetaPalete) atalhos += '<a class="btn btn-sm btn-outline-primary" target="_blank" rel="noopener" href="' + cfg.urlEtiquetaPalete.replace('/0/', '/' + p.id + '/') + '"><i class="fas fa-tag"></i>Etiqueta do palete</a>';
        if (cfg.urlPaletes) atalhos += '<a class="btn btn-sm btn-outline-primary" href="' + cfg.urlPaletes + '?q=' + encodeURIComponent(p.etiqueta) + '"><i class="fas fa-pallet"></i>Controle de palete</a>';
        return '<section class="palete-ficha">' +
            '<header class="palete-ficha-topo">' + marca(p, 'palete-ficha-logo') +
                '<div><strong>' + escapar(p.razao || p.empresa || 'Empresa não informada') + '</strong>' +
                '<span>' + escapar([p.empresa && p.empresa !== p.razao ? p.empresa : '', p.cnpj ? 'CNPJ ' + cnpj(p.cnpj) : ''].filter(Boolean).join(' · ')) + '</span></div>' +
                '<div class="palete-ficha-nf"><small>Nota fiscal</small><strong>' + escapar(p.nf || '—') + '</strong></div></header>' +
            '<dl class="detalhe-endereco detalhe-endereco--ficha">' +
                campo('Série', p.serie) + campo('Emissão', p.emissao) + campo('Classificação', p.classificacao) + campo('Situação', p.status) +
                campo('Palete (etiqueta)', p.etiqueta, 'codigo-mono') + campo('UP', p.up) +
                campo('Montado por', [p.criado_por, p.criado_em].filter(Boolean).join(' · ')) + campo('Armazenado em', p.armazenado_em) +
            '</dl>' +
            (p.chave ? '<div class="palete-ficha-chave"><dt>Chave de acesso</dt><dd class="codigo-mono">' + escapar(p.chave) + '</dd></div>' : '') +
            (itens ? '<div class="tabela-scroll"><table class="table table-sm table-striped mb-0"><thead><tr><th>SKU</th><th>Descrição</th><th>EAN</th><th>DUN</th><th>Quantidade</th><th>Lote</th><th>Fabricação</th><th>Validade</th></tr></thead><tbody>' + itens + '</tbody></table></div>'
                   : '<p class="text-muted small mb-0">Palete sem itens.</p>') +
            (atalhos ? '<div class="palete-ficha-atalhos">' + atalhos + '</div>' : '') + '</section>';
    }
    function abrirDetalhe(e) {
        if (!modal) return;
        texto('endCodigo', e.codigo);
        texto('endCamara', ('0' + e.camara.codigo).slice(-2) + ' · ' + e.camara.nome);
        texto('endRua', e.rua);
        texto('endColuna', e.coluna);
        texto('endNivel', e.nivel);
        texto('endBip', e.bip);
        texto('endTipo', e.tipo);
        texto('endDestino', e.destino || '—');
        texto('endCliente', e.cliente || 'Uso livre');
        texto('endStatus', ROTULO[e.status] + (e.bloqueado && e.status !== 'bloqueado' ? ' · bloqueado' : '') + (e.motivo ? ' — ' + e.motivo : ''));
        document.getElementById('endEtiqueta').href = cfg.urlEtiqueta + '?ids=' + e.id;
        document.getElementById('endPaletes').innerHTML = (e.paletes || []).map(cartaoPalete).join('');
        esconderDica();
        var form = document.getElementById('formBloqueio');
        if (form) {
            form.action = cfg.urlBloqueio.replace('/0/', '/' + e.id + '/');
            var bloqueado = e.bloqueado;
            document.getElementById('blocoMotivo').hidden = bloqueado;
            document.getElementById('endMotivo').value = '';
            document.getElementById('btnBloqueio').innerHTML = bloqueado ? '<i class="fas fa-unlock"></i>Liberar endereço' : '<i class="fas fa-ban"></i>Bloquear endereço';
        }
        modal.show();
    }

    // Notas fiscais e produtos armazenados na câmara (botão "i") e conteúdo do stage.
    var modalInfoEl = document.getElementById('modalCamaraInfo');
    var modalInfo = modalInfoEl ? new bootstrap.Modal(modalInfoEl) : null;
    function abrirInfo(camara) {
        var linhas = [];
        camara.enderecos.forEach(function (e) {
            (e.paletes || []).forEach(function (p) {
                linhas.push('<tr><td class="codigo-mono">' + escapar(e.codigo) + '</td><td>' + escapar(p.nf || '—') + '</td><td><strong>' + escapar(p.sku || '—') +
                    '</strong> · ' + escapar(p.descricao || '') + '</td><td>' + escapar(p.quantidade || '—') + '</td><td>' + escapar(p.lote || '—') +
                    '</td><td>' + escapar(p.validade || '—') + '</td><td>' + escapar(p.classificacao || '') + '</td><td class="codigo-mono">' + escapar(p.etiqueta) + '</td></tr>');
            });
        });
        document.getElementById('modalCamaraInfoTitulo').textContent = camara.nome + ' — notas fiscais e produtos armazenados';
        document.getElementById('modalCamaraInfoCorpo').innerHTML = linhas.length
            ? '<div class="tabela-scroll"><table class="table table-striped mb-0"><thead><tr><th>Posição</th><th>NF</th><th>Produto</th><th>Quantidade</th><th>Lote</th><th>Validade</th><th>Classificação</th><th>Palete</th></tr></thead><tbody>' +
              linhas.join('') + '</tbody></table></div>'
            : '<p class="text-muted mb-0">Nada armazenado em ' + escapar(camara.nome) + ' no momento.</p>';
        if (modalInfo) modalInfo.show();
    }

    // ------------------------------------------------------------ 2D
    function cartoes(camara) {
        var r = camara.resumo;
        function cartao(classe, rotulo, valor) {
            return '<article class="camara-stat-card ' + classe + '"><span class="camara-stat-label">' + rotulo + '</span><strong class="camara-stat-value">' + valor + '</strong></article>';
        }
        return '<div class="camara-stats" aria-label="Resumo da ' + escapar(camara.nome) + '">' +
            cartao('camara-stat-card--valor', 'Paletes armazenados', r.paletes) +
            cartao('', 'Itens', r.itens) +
            cartao('', 'Notas fiscais', r.notas) +
            cartao('camara-stat-card--livre', 'Posições livres', r.livres) +
            cartao('camara-stat-card--ocupada', 'Posições ocupadas', r.ocupadas) +
            cartao('camara-stat-card--ocupacao', 'Taxa de ocupação', r.pct.toFixed(1).replace('.', ',') + '%') + '</div>';
    }

    function celula(r, coluna, nivel) {
        var e = r.celulas[coluna + '|' + nivel];
        if (e) {
            var classe = 'cell ' + (e.status === 'ocupado' ? 'cell--ocupado' : 'cell--disponivel') + (e.bloqueado ? ' cell--bloqueado' : '') + (e.cliente ? ' cell--reservada' : '');
            var p = e.paletes && e.paletes[0];
            var dica = escapar(descricao(e));
            if (!p) return '<button type="button" class="' + classe + '" data-id="' + e.id + '" title="' + dica + '" aria-label="' + dica + '"></button>';
            // Ocupado: logo da empresa e, embaixo, o número da nota. O resumo aparece ao passar o mouse
            // (por isso sem "title", que abriria uma segunda dica por cima).
            var nf = p.nf || '';
            if (nf.length > 7) nf = '…' + nf.slice(-6);
            return '<button type="button" class="' + classe + '" data-id="' + e.id + '" aria-label="' + dica + '">' +
                   '<span class="cell-ocup-labels">' + marca(p, 'cell-logo') + '<span class="cell-nf">' + escapar(nf) + '</span></span></button>';
        }
        var porta = portaDe(r, coluna, nivel);
        if (porta) {
            var cols = porta.c1 - porta.c0 + 1, linhas = porta.n1 - porta.n0 + 1;
            var x = cols === 1 ? 50 : ((coluna - porta.c0) / (cols - 1)) * 100;
            var y = linhas === 1 ? 50 : ((porta.n1 - nivel) / (linhas - 1)) * 100;
            var borda = (nivel === porta.n1 ? ' cell--porta-edge-top' : '') + (coluna === porta.c0 ? ' cell--porta-edge-left' : '');
            return '<span class="cell cell--porta' + borda + '" title="Porta" style="background-image:url(\'' + cfg.porta + '\');background-size:' +
                   (cols * 100) + '% ' + (linhas * 100) + '%;background-position:' + x + '% ' + y + '%;background-repeat:no-repeat"></span>';
        }
        return '<span class="cell cell--sem-nivel5" title="Sem posição"></span>';
    }

    function desenharRua(r) {
        var modelo = 'grid-template-columns:repeat(' + r.colunas.length + ', var(--cel))';
        var html = '<div class="rua-block"><div class="rua-title">Rua ' + escapar(r.rua) + '</div><div class="rua-grid-scroll"><div class="rua-grid-inner">' +
                   '<div class="col-headers" style="' + modelo + '">';
        r.colunas.forEach(function (c) { html += '<span class="axis-label">' + c + '</span>'; });
        html += '</div><div class="rua-body"><div class="row-labels">';
        var niveis = r.niveis.slice().reverse();
        niveis.forEach(function (n) { html += '<span class="axis-label row-axis">' + n + '</span>'; });
        html += '</div><div class="cells-area"><div class="cells-stack">';
        niveis.forEach(function (n) {
            html += '<div class="cells-row" style="' + modelo + '">';
            r.colunas.forEach(function (c) { html += celula(r, c, n); });
            html += '</div>';
        });
        return html + '</div></div></div></div></div></div>';
    }

    function desenharCamara(camara) {
        var cabecalho = '<header class="camara-header"><h2>' + escapar(camara.nome) + '</h2><span class="camara-header-tipo">' + escapar(camara.descricao) + '</span>' +
            '<button type="button" class="camara-info-btn" data-info="' + camara.id + '" title="Ver notas fiscais e produtos armazenados" aria-label="Informações da ' + escapar(camara.nome) + '">' +
            '<svg class="camara-info-btn-icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 10v6M12 7h.01" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg></button>' +
            (dados.unica ? '' : '<a class="camara-abrir" href="' + cfg.urlMapa + '?camara=' + camara.id + '">Abrir só esta câmara</a>') + '</header>';
        if (camara.tipo === 'Stage') {
            // Stage: área única de separação (sem estante), como no WMS Plus.
            var n = camara.resumo.paletes;
            return '<section class="stage-section" data-camara="' + camara.id + '"><div class="stage-section-head"><h2 class="camara-title">' + escapar(camara.nome).toUpperCase() +
                '</h2><p class="stage-section-hint">Área de separação · armazenamento ilimitado</p></div>' +
                '<button type="button" class="stage-area-cell" data-info="' + camara.id + '" aria-label="Abrir stage com ' + n + ' palete(s)">' +
                '<span class="stage-area-label">STAGE</span><span class="stage-area-count">' + n + ' palete' + (n === 1 ? '' : 's') +
                '</span><span class="stage-area-hint">Clique para ver o conteúdo</span></button></section>';
        }
        return '<section class="camara-section" data-camara="' + camara.id + '">' + cabecalho + cartoes(camara) +
               '<div class="ruas-row">' + camara.ruas.map(desenharRua).join('') + '</div></section>';
    }

    // Tamanho do quadrado: o maior (até 40 px) em que todas as ruas da câmara cabem lado a lado no painel.
    // Se nem com o menor couber, as ruas rolam na horizontal.
    function ajustarTamanhos() {
        dados.camaras.forEach(function (camara) {
            var secao = area2d.querySelector('.camara-section[data-camara="' + camara.id + '"]');
            if (!secao || !camara.ruas.length) return;
            var maxCols = Math.max.apply(null, camara.ruas.map(function (r) { return r.colunas.length; }));
            var largura = secao.clientWidth, tamanho;
            if (celular.matches) {
                // No celular as ruas ficam uma embaixo da outra: basta caber a mais larga.
                tamanho = Math.floor((Math.min(largura, window.innerWidth) - 16 - 24) / maxCols);
                tamanho = Math.min(CEL_MAX_CELULAR, Math.max(CEL_MIN_CELULAR, tamanho));
            } else {
                var disponivel = largura - 26 - 8 * (camara.ruas.length - 1);
                tamanho = CEL_MIN;
                for (var t = CEL_MAX; t >= CEL_MIN; t--) {
                    var ocupado = 0;
                    camara.ruas.forEach(function (r) { ocupado += Math.max(22, t * 0.82) + 6 + r.colunas.length * t + 4; });
                    if (ocupado <= disponivel) { tamanho = t; break; }
                }
            }
            secao.style.setProperty('--cel', tamanho + 'px');
            secao.style.setProperty('--cel-fonte', (tamanho >= 48 ? 12 : tamanho >= 36 ? 11 : tamanho >= 28 ? 9 : 8) + 'px');
            secao.classList.toggle('camara-section--rotulos', tamanho >= 28);
        });
    }

    function desenhar2d() {
        area2d.classList.toggle('layout-panel--mobile', celular.matches);
        area2d.innerHTML = '<div class="camaras-stack">' + dados.camaras.map(desenharCamara).join('') + '</div>';
        ajustarTamanhos();
    }
    area2d.addEventListener('click', function (ev) {
        var botao = ev.target.closest('button[data-id]');
        if (botao) { abrirDetalhe(porId[botao.getAttribute('data-id')]); return; }
        var info = ev.target.closest('[data-info]');
        if (info) abrirInfo(dados.camaras.filter(function (c) { return String(c.id) === info.getAttribute('data-info'); })[0]);
    });

    // Resumo ao passar o mouse (ou focar pelo teclado) numa posição ocupada.
    var dica2d = document.createElement('div');
    dica2d.className = 'mapa-dica';
    dica2d.hidden = true;
    dica2d.setAttribute('role', 'tooltip');
    document.body.appendChild(dica2d);
    var celulaDaDica = null;
    function linhaDica(rotulo, valor) {
        return valor ? '<div class="mapa-dica-linha"><span>' + rotulo + '</span><strong>' + escapar(valor) + '</strong></div>' : '';
    }
    function mostrarDica(botao) {
        var e = porId[botao.getAttribute('data-id')];
        var p = e && e.paletes && e.paletes[0];
        if (!p) { esconderDica(); return; }
        celulaDaDica = botao;
        var outros = (p.itens || []).length - 1, mais = e.paletes.length - 1;
        dica2d.innerHTML =
            '<div class="mapa-dica-topo">' + marca(p, 'mapa-dica-logo') + '<div><strong>' + escapar(p.empresa || 'Empresa não informada') + '</strong>' +
            '<span>NF ' + escapar(p.nf || '—') + (p.serie ? ' · série ' + escapar(p.serie) : '') + '</span></div></div>' +
            linhaDica('Posição', e.codigo) +
            linhaDica('Produto', [p.sku, p.descricao].filter(Boolean).join(' · ')) +
            linhaDica('Quantidade', p.quantidade) + linhaDica('Lote', p.lote) + linhaDica('Validade', p.validade) +
            linhaDica('Classificação', p.classificacao) + linhaDica('Armazenado em', p.armazenado_em) + linhaDica('Espaço de', e.cliente) +
            (outros > 0 ? '<div class="mapa-dica-mais">+ ' + outros + (outros === 1 ? ' outro item' : ' outros itens') + ' neste palete</div>' : '') +
            (mais > 0 ? '<div class="mapa-dica-mais">+ ' + mais + (mais === 1 ? ' outro palete' : ' outros paletes') + ' nesta posição</div>' : '') +
            (e.bloqueado ? '<div class="mapa-dica-mais">Posição bloqueada' + (e.motivo ? ' — ' + escapar(e.motivo) : '') + '</div>' : '') +
            '<div class="mapa-dica-rodape">Clique para ver todos os dados</div>';
        dica2d.hidden = false;
        // Em cima do quadrado; se não couber, embaixo. Nunca sai da tela.
        var r = botao.getBoundingClientRect(), d = dica2d.getBoundingClientRect();
        var x = Math.min(Math.max(8, r.left + r.width / 2 - d.width / 2), window.innerWidth - d.width - 8);
        var y = r.top - d.height - 8;
        if (y < 8) y = Math.min(r.bottom + 8, window.innerHeight - d.height - 8);
        dica2d.style.left = x + 'px';
        dica2d.style.top = Math.max(8, y) + 'px';
    }
    function esconderDica() { dica2d.hidden = true; celulaDaDica = null; }
    function aoEntrar(ev) {
        var botao = ev.target.closest && ev.target.closest('button.cell--ocupado[data-id]');
        if (botao) { if (botao !== celulaDaDica) mostrarDica(botao); } else if (celulaDaDica) esconderDica();
    }
    area2d.addEventListener('mouseover', aoEntrar);
    area2d.addEventListener('focusin', aoEntrar);
    area2d.addEventListener('mouseleave', esconderDica);
    area2d.addEventListener('focusout', esconderDica);
    window.addEventListener('scroll', esconderDica, true);
    document.addEventListener('keydown', function (ev) { if (ev.key === 'Escape') esconderDica(); });

    var temporizadorTamanho = null;
    window.addEventListener('resize', function () {
        clearTimeout(temporizadorTamanho);
        temporizadorTamanho = setTimeout(function () {
            area2d.classList.toggle('layout-panel--mobile', celular.matches);
            ajustarTamanhos();
        }, 80);
    });

    // ------------------------------------------------------------ localizar endereço
    function normalizar(t) { return t.toUpperCase().replace(/\s+/g, ''); }
    var todos = [];
    dados.camaras.forEach(function (c) { todos = todos.concat(c.enderecos); });
    document.getElementById('formBuscaMapa').addEventListener('submit', function (ev) {
        ev.preventDefault();
        var termo = normalizar(document.getElementById('buscaMapa').value);
        if (!termo) return;
        var achado = todos.filter(function (e) { return normalizar(e.codigo) === termo || normalizar(e.bip) === termo; })[0] ||
                     todos.filter(function (e) { return normalizar(e.codigo).indexOf(termo) !== -1; })[0];
        if (!achado) { aviso.textContent = 'Endereço "' + termo + '" não encontrado' + (dados.unica ? ' nesta câmara.' : '.'); return; }
        aviso.textContent = 'Encontrado: ' + achado.codigo + ' (' + ROTULO[achado.status].toLowerCase() + ').';
        area2d.querySelectorAll('.cell--achada').forEach(function (c) { c.classList.remove('cell--achada'); });
        var quadro = area2d.querySelector('button[data-id="' + achado.id + '"]');
        if (quadro) quadro.classList.add('cell--achada');
        if (visaoAtual === '3d') { abrir3d().then(function () { if (cena3d) cena3d.destacar(achado.id); }); }
        else if (quadro) { quadro.scrollIntoView({ block: 'center', inline: 'center', behavior: 'smooth' }); quadro.focus({ preventScroll: true }); }
    });

    // ------------------------------------------------------------ 3D (uma câmara)
    var visaoAtual = '2d';
    var cena3d = null;       // { enquadrar, destacar, ajustar, destruir }
    var carregando3d = null;

    function carregarScript(url) {
        return new Promise(function (ok, falha) {
            var s = document.createElement('script');
            s.src = url; s.onload = ok; s.onerror = function () { falha(new Error(url)); };
            document.head.appendChild(s);
        });
    }

    function cores() {
        var css = getComputedStyle(document.documentElement);
        function v(nome) { return css.getPropertyValue(nome).trim(); }
        var escuro = document.documentElement.getAttribute('data-tema') === 'escuro';
        return {
            fundo: v('--fundo-suave'), piso: escuro ? '#1b1b20' : '#dfe5ee',
            livre: v('--verde'), ocupado: v('--cell-ocup'), bloqueado: v('--vermelho'),
            longarina: v('--rack-beam'), montante: v('--rack-upright'), texto: v('--texto-titulo'),
            semPosicao: escuro ? '#a1a1aa' : '#6b7280'
        };
    }

    function montar3d() {
        var THREE = window.THREE;
        // Uma câmara, ou todas as câmaras de estante em sequência (visão geral). O stage não tem estante.
        var ruas = [];
        dados.camaras.forEach(function (camara, indice) {
            if (camara.tipo === 'Stage') return;
            camara.ruas.forEach(function (r, i) {
                ruas.push({ rua: r.rua, colunas: r.colunas, niveis: r.niveis, celulas: r.celulas,
                            portas: r.portas, vaos: r.vaos, temMarcas: r.temMarcas,
                            camara: !dados.unica && i === 0 ? camara.nome : null, novaCamara: i === 0 && ruas.length > 0 });
            });
        });
        var tela = document.getElementById('mapa3dTela');
        var dica = document.getElementById('mapa3dDica');
        var cor = cores();
        var L = 1.25, A = 1.0, P = 1.15, CORREDOR = 3.0;   // largura, altura e profundidade da posição; corredor entre ruas

        var renderer = new THREE.WebGLRenderer({ antialias: true });
        renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
        tela.innerHTML = '';
        tela.appendChild(renderer.domElement);
        var scene = new THREE.Scene();
        scene.background = new THREE.Color(cor.fundo);
        var camera = new THREE.PerspectiveCamera(45, 1, 0.1, 500);
        var controls = new THREE.OrbitControls(camera, renderer.domElement);
        controls.enableDamping = true;
        controls.maxPolarAngle = Math.PI / 2 - 0.03;

        scene.add(new THREE.AmbientLight(0xffffff, 0.75));
        var sol = new THREE.DirectionalLight(0xffffff, 0.7);
        sol.position.set(20, 40, 25);
        scene.add(sol);

        var minCol = Infinity, maxCol = -Infinity, maxNivel = 0;
        ruas.forEach(function (r) {
            minCol = Math.min(minCol, r.colunas[0]); maxCol = Math.max(maxCol, r.colunas[r.colunas.length - 1]);
            maxNivel = Math.max(maxNivel, r.niveis[r.niveis.length - 1]);
        });
        var largura = (maxCol - minCol + 1) * L;
        var ENTRE_CAMARAS = 4.0;       // espaço extra entre uma câmara e a seguinte
        var zCursor = 0;
        ruas.forEach(function (r, i) {
            if (r.novaCamara) zCursor += ENTRE_CAMARAS;
            r.z = zCursor + P / 2;
            zCursor += P + (i < ruas.length - 1 ? CORREDOR : 0);
        });
        var fundoTotal = zCursor;

        // Texto que fica sempre de frente para a câmera. "larguraTela": largura do desenho (textos longos pedem mais).
        function rotulo(textoRotulo, tamanho, larguraTela) {
            var canvas = document.createElement('canvas');
            canvas.width = larguraTela || 256; canvas.height = 128;
            var ctx = canvas.getContext('2d');
            ctx.fillStyle = cor.texto;
            ctx.font = '700 84px Inter, Arial, sans-serif';
            ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
            ctx.fillText(textoRotulo, canvas.width / 2, 68);
            var sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(canvas), transparent: true, depthTest: false }));
            sprite.scale.set(tamanho * canvas.width / 128, tamanho, 1);
            return sprite;
        }
        function bloco(w, h, d, corBloco, x, y, z) {
            var m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshLambertMaterial({ color: corBloco }));
            m.position.set(x, y, z);
            scene.add(m);
            return m;
        }

        var piso = new THREE.Mesh(new THREE.PlaneGeometry(largura + 8, fundoTotal + 8), new THREE.MeshLambertMaterial({ color: cor.piso }));
        piso.rotation.x = -Math.PI / 2;
        piso.position.set(largura / 2, -0.01, fundoTotal / 2);
        scene.add(piso);

        var geoCaixa = new THREE.BoxGeometry(L * 0.86, A * 0.78, P * 0.86);
        var geoBorda = new THREE.EdgesGeometry(geoCaixa);
        var caixas = [];
        // Carga de uma posição ocupada: caixa de papelão, fita por cima e palete de madeira embaixo.
        var geoCarga = new THREE.BoxGeometry(L * 0.74, A * 0.6, P * 0.74);
        var geoCargaBorda = new THREE.EdgesGeometry(geoCarga);
        var materialCargaBorda = new THREE.LineBasicMaterial({ color: 0x7a5a2e });
        var geoFita = new THREE.BoxGeometry(L * 0.745, A * 0.605, P * 0.1);
        var materialFita = new THREE.MeshLambertMaterial({ color: 0x9c7a45 });
        var geoPalete = new THREE.BoxGeometry(L * 0.84, 0.1, P * 0.84);
        var materialPalete = new THREE.MeshLambertMaterial({ color: 0x8b5e34 });
        // Porta: placa azul com a imagem da porta, do tamanho do vão. Sem posição: um X no lugar.
        var imagemPorta = null, materiaisPorta = [];
        new THREE.TextureLoader().load(cfg.porta, function (textura) {
            imagemPorta = textura;
            materiaisPorta.forEach(function (m) { m.map = textura; m.color.set(0xffffff); m.needsUpdate = true; });
            pedirQuadro();
        });
        var diagonal = Math.sqrt(Math.pow(L * 0.86, 2) + Math.pow(A * 0.78, 2));
        var geoRisco = new THREE.BoxGeometry(diagonal, 0.07, 0.07);
        var materialRisco = new THREE.MeshLambertMaterial({ color: cor.semPosicao });
        var inclinacao = Math.atan2(A * 0.78, L * 0.86);
        function desenharX(x, y, z) {
            [inclinacao, -inclinacao].forEach(function (angulo) {
                // um X em cada face da estante, para aparecer dos dois corredores
                [-P * 0.43, P * 0.43].forEach(function (dz) {
                    var risco = new THREE.Mesh(geoRisco, materialRisco);
                    risco.position.set(x, y, z + dz);
                    risco.rotation.z = angulo;
                    scene.add(risco);
                });
            });
        }
        ruas.forEach(function (r) {
            var z = r.z;
            var x0 = (r.colunas[0] - minCol) * L, x1 = (r.colunas[r.colunas.length - 1] - minCol + 1) * L;
            if (r.camara) {
                var nomeCamara = rotulo(r.camara.slice(0, 18), 1.2, 1024);
                nomeCamara.position.set(x0 - 8, 2.6, z);
                scene.add(nomeCamara);
            }
            var topo = r.niveis[r.niveis.length - 1] * A;
            // montantes (em cada divisa de coluna) e longarinas (em cada nível), como numa estante porta-paletes
            // Onde há porta não passa estante: nem longarina na frente, nem montante no meio do vão.
            var naPorta = function (coluna, nivel) {
                return r.portas.some(function (p) { return coluna >= p.c0 && coluna <= p.c1 && nivel >= p.n0 && nivel <= p.n1; });
            };
            var ultimoNivel = r.niveis[r.niveis.length - 1], primeiraCol = r.colunas[0], ultimaCol = r.colunas[r.colunas.length - 1];
            // trechos seguidos em que "livre(i)" vale, de inicio a fim: devolve [[de, ate], ...]
            var trechos = function (inicio, fim, livre) {
                var lista = [], de = null;
                for (var i = inicio; i <= fim + 1; i++) {
                    if (i <= fim && livre(i)) { if (de === null) de = i; } else if (de !== null) { lista.push([de, i - 1]); de = null; }
                }
                return lista;
            };
            for (var c = primeiraCol; c <= ultimaCol + 1; c++) {
                (function (c) {
                    var x = (c - minCol) * L;
                    // o montante da divisa some só nos níveis em que a porta ocupa os dois lados dele
                    trechos(1, ultimoNivel, function (n) { return !(naPorta(c - 1, n) && naPorta(c, n)); }).forEach(function (t) {
                        var base = (t[0] - 1) * A, alto = t[1] * A + (t[1] === ultimoNivel ? 0.1 : 0);
                        [-P / 2, P / 2].forEach(function (dz) { bloco(0.07, alto - base, 0.07, cor.montante, x, (base + alto) / 2, z + dz); });
                    });
                })(c);
            }
            for (var n = 1; n <= ultimoNivel; n++) {
                (function (n) {
                    trechos(primeiraCol, ultimaCol, function (col) { return !naPorta(col, n); }).forEach(function (t) {
                        var xa = (t[0] - minCol) * L, xb = (t[1] - minCol + 1) * L;
                        [-P / 2, P / 2].forEach(function (dz) { bloco(xb - xa, 0.09, 0.06, cor.longarina, (xa + xb) / 2, (n - 1) * A + 0.045, z + dz); });
                    });
                })(n);
            }
            var nomeRua = rotulo(r.rua, 1.5);
            nomeRua.position.set(x0 - 1.6, 1.0, z);
            scene.add(nomeRua);
            r.colunas.forEach(function (c) {
                var numero = rotulo(String(c), 0.55);
                numero.position.set((c - minCol + 0.5) * L, topo + 0.45, z);
                scene.add(numero);
            });
            r.portas.forEach(function (p) {
                var larguraPorta = (p.c1 - p.c0 + 1) * L, alturaPorta = (p.n1 - p.n0 + 1) * A;
                var material = new THREE.MeshLambertMaterial({ color: imagemPorta ? 0xffffff : 0x1d4ed8, map: imagemPorta });
                materiaisPorta.push(material);
                var placa = new THREE.Mesh(new THREE.BoxGeometry(larguraPorta * 0.96, alturaPorta * 0.97, P * 0.9), material);
                placa.position.set((p.c0 - minCol) * L + larguraPorta / 2, (p.n0 - 1) * A + alturaPorta / 2, z);
                scene.add(placa);
            });
            r.colunas.forEach(function (coluna) {
                r.niveis.forEach(function (nivel) {
                    if (r.celulas[coluna + '|' + nivel] || portaDe(r, coluna, nivel)) return;
                    desenharX((coluna - minCol + 0.5) * L, (nivel - 1) * A + 0.09 + A * 0.39, z);
                });
            });
            Object.keys(r.celulas).forEach(function (chave) {
                var e = r.celulas[chave];
                var x = (e.coluna - minCol + 0.5) * L, base = (e.nivel - 1) * A + 0.09;
                var caixa;
                if (e.status === 'ocupado') {
                    // Posição ocupada: uma caixa de papelão com fita, em cima do palete.
                    caixa = new THREE.Mesh(geoCarga, new THREE.MeshLambertMaterial({ color: 0xc9a26b }));
                    caixa.position.set(x, base + 0.1 + A * 0.3, z);
                    caixa.add(new THREE.LineSegments(geoCargaBorda, materialCargaBorda));
                    caixa.add(new THREE.Mesh(geoFita, materialFita));
                    var palete = new THREE.Mesh(geoPalete, materialPalete);
                    palete.position.y = -(A * 0.3 + 0.05);
                    caixa.add(palete);
                    if (e.bloqueado) desenharX(x, base + A * 0.39, z);
                } else {
                    caixa = new THREE.Mesh(geoCaixa, new THREE.MeshLambertMaterial({
                        color: cor[e.status], transparent: e.status === 'livre', opacity: e.status === 'livre' ? 0.28 : 1
                    }));
                    caixa.position.set(x, base + A * 0.39, z);
                    caixa.add(new THREE.LineSegments(geoBorda, new THREE.LineBasicMaterial({ color: cor[e.status] })));
                }
                caixa.userData.endereco = e;
                scene.add(caixa);
                caixas.push(caixa);
            });
        });

        var centro = new THREE.Vector3(largura / 2, maxNivel * A / 2, fundoTotal / 2);
        var quadroPedido = false;
        function quadro() {
            quadroPedido = false;
            if (controls.update()) pedirQuadro();
            renderer.render(scene, camera);
        }
        function pedirQuadro() { if (!quadroPedido) { quadroPedido = true; requestAnimationFrame(quadro); } }
        function enquadrar() {
            if (fundoTotal > largura * 1.3) {
                // Várias câmaras em fila (visão geral): olha de lado e do alto, para caber a fila inteira.
                var distancia = Math.max(fundoTotal * 0.62, largura * 1.2);
                camera.position.set(centro.x + distancia * 0.95, centro.y + distancia * 0.75, centro.z + distancia * 0.25);
            } else {
                var alcance = Math.max(largura, fundoTotal * 1.4, maxNivel * A * 2.4);
                camera.position.set(centro.x - alcance * 0.18, centro.y + alcance * 0.38, centro.z + alcance * 0.62);
            }
            controls.target.copy(centro);
            pedirQuadro();
        }
        function ajustarTamanho() {
            var w = tela.clientWidth, h = tela.clientHeight;
            if (!w || !h) return;
            renderer.setSize(w, h, false);
            camera.aspect = w / h;
            camera.updateProjectionMatrix();
            pedirQuadro();
        }
        controls.addEventListener('change', pedirQuadro);
        if (window.ResizeObserver) new ResizeObserver(ajustarTamanho).observe(tela);
        window.addEventListener('resize', ajustarTamanho);

        // passar o mouse / clicar
        var raio = new THREE.Raycaster(), ponteiro = new THREE.Vector2();
        var sobre = null, destaque = null, inicioClique = null;
        function alvo(ev) {
            var caixaTela = renderer.domElement.getBoundingClientRect();
            ponteiro.x = ((ev.clientX - caixaTela.left) / caixaTela.width) * 2 - 1;
            ponteiro.y = -((ev.clientY - caixaTela.top) / caixaTela.height) * 2 + 1;
            raio.setFromCamera(ponteiro, camera);
            var achados = raio.intersectObjects(caixas, false);
            return achados.length ? achados[0].object : null;
        }
        function realcar(caixa, ligado) {
            if (caixa && caixa !== destaque) caixa.material.emissive.setHex(ligado ? 0x555555 : 0x000000);
        }
        renderer.domElement.addEventListener('pointermove', function (ev) {
            var caixa = alvo(ev);
            if (caixa !== sobre) { realcar(sobre, false); sobre = caixa; realcar(sobre, true); pedirQuadro(); }
            renderer.domElement.style.cursor = caixa ? 'pointer' : 'grab';
            if (caixa) {
                var e = caixa.userData.endereco;
                dica.textContent = e.codigo + ' · ' + ROTULO[e.status] + conteudo(e) + ' · ' + e.tipo + (e.destino ? ' · ' + e.destino : '');
                var base = area3d.getBoundingClientRect();
                dica.style.left = (ev.clientX - base.left + 14) + 'px';
                dica.style.top = (ev.clientY - base.top + 14) + 'px';
                dica.hidden = false;
            } else {
                dica.hidden = true;
            }
        });
        renderer.domElement.addEventListener('pointerleave', function () { realcar(sobre, false); sobre = null; dica.hidden = true; pedirQuadro(); });
        renderer.domElement.addEventListener('pointerdown', function (ev) { inicioClique = { x: ev.clientX, y: ev.clientY }; });
        renderer.domElement.addEventListener('pointerup', function (ev) {
            // só é clique se o mouse não arrastou (arrastar gira a câmera)
            if (!inicioClique || Math.abs(ev.clientX - inicioClique.x) + Math.abs(ev.clientY - inicioClique.y) > 6) return;
            var caixa = alvo(ev);
            if (caixa) abrirDetalhe(caixa.userData.endereco);
        });

        function destacar(id) {
            if (destaque) { destaque.material.emissive.setHex(0x000000); destaque.scale.set(1, 1, 1); }
            destaque = caixas.filter(function (c) { return c.userData.endereco.id === id; })[0] || null;
            if (!destaque) return;
            destaque.material.emissive.setHex(0xaa8800);
            destaque.scale.set(1.18, 1.18, 1.18);
            controls.target.copy(destaque.position);
            camera.position.set(destaque.position.x - 4, destaque.position.y + 5, destaque.position.z + 9);
            pedirQuadro();
        }

        ajustarTamanho();
        enquadrar();
        return {
            enquadrar: enquadrar, destacar: destacar, ajustar: ajustarTamanho,
            destruir: function () { renderer.dispose(); tela.innerHTML = ''; }
        };
    }

    function abrir3d() {
        if (cena3d) { cena3d.ajustar(); return Promise.resolve(); }
        if (!carregando3d) {
            aviso.textContent = 'Carregando a visão 3D…';
            carregando3d = (window.THREE ? Promise.resolve() : carregarScript(cfg.three))
                .then(function () { return window.THREE.OrbitControls ? null : carregarScript(cfg.orbit); })
                .then(function () { cena3d = montar3d(); aviso.textContent = ''; })
                .catch(function () {
                    carregando3d = null;
                    aviso.textContent = 'Não foi possível carregar a visão 3D (sem acesso à internet?). A visão 2D continua disponível.';
                    mostrar('2d');
                });
        }
        return carregando3d;
    }

    // ------------------------------------------------------------ alternar 2D / 3D
    function mostrar(visao) {
        visaoAtual = visao;
        area2d.hidden = visao !== '2d';
        area3d.hidden = visao !== '3d';
        if (btn2d) {
            btn2d.classList.toggle('active', visao === '2d');
            btn3d.classList.toggle('active', visao === '3d');
            btn2d.setAttribute('aria-pressed', visao === '2d');
            btn3d.setAttribute('aria-pressed', visao === '3d');
            gravar('wms.mapa.visao', visao);
        }
        if (visao === '2d') { ajustarTamanhos(); return Promise.resolve(); }
        return abrir3d();
    }
    if (btn2d) {
        btn2d.addEventListener('click', function () { mostrar('2d'); });
        btn3d.addEventListener('click', function () { mostrar('3d'); });
    }
    document.getElementById('btnVisaoGeral3d').addEventListener('click', function () { if (cena3d) cena3d.enquadrar(); });

    // O tema mudou: o 3D é refeito com as cores novas.
    new MutationObserver(function () {
        if (!cena3d) return;
        cena3d.destruir(); cena3d = null; carregando3d = null;
        if (visaoAtual === '3d') abrir3d();
    }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-tema'] });

    desenhar2d();
    // O 3D precisa de ao menos uma câmara de estantes (o stage é só uma área, sem estante).
    var pode3d = dados.camaras.some(function (c) { return c.tipo !== 'Stage' && c.ruas.length; });
    if (btn3d && !pode3d) btn3d.disabled = true;
    mostrar(pode3d && ler('wms.mapa.visao') === '3d' ? '3d' : '2d');
})();

// WMS Doca Livre — controle de voz (em todas as telas).
// Usa o reconhecimento de fala do próprio navegador (Chrome / Edge), em português. Nada é enviado pelo WMS a
// serviços de IA: a frase é interpretada aqui mesmo, por regras.
//
// Duas partes:
//   WMSVoz.interpretar(frase, contexto) -> ação   (só texto; é o que os testes exercitam)
//   a parte de tela: botão do microfone, painel, fala de resposta e execução da ação.
(function (raiz) {
    'use strict';

    // ------------------------------------------------------------ texto
    function normalizar(texto) {
        return String(texto || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
            .replace(/[^a-z0-9\s\/\-]/g, ' ').replace(/\s+/g, ' ').trim();
    }

    var NUMEROS = { zero: '0', um: '1', uma: '1', dois: '2', duas: '2', tres: '3', quatro: '4', cinco: '5', seis: '6', meia: '6', sete: '7', oito: '8', nove: '9' };

    // "um dois três" -> "123"; "12 345" -> "12345" (número de nota ditado em partes)
    function soDigitos(texto) {
        var partes = normalizar(texto).split(' ').map(function (p) { return NUMEROS.hasOwnProperty(p) ? NUMEROS[p] : p; });
        var junto = partes.join('');
        return /^\d+$/.test(junto) ? junto : null;
    }

    // Outros jeitos de chamar cada tela (chave = nome da tela no menu, normalizado).
    var APELIDOS = {
        'inicio': ['tela inicial', 'pagina inicial', 'home', 'bem vindo'],
        'painel': ['painel geral', 'graficos', 'indicadores gerais', 'visao geral'],
        'produtos': ['cadastro de produtos', 'produto'],
        'empresas': ['cadastro de empresas', 'empresa', 'clientes cadastrados', 'fornecedores'],
        'pessoas': ['cadastro de pessoas', 'pessoa', 'conferentes', 'motoristas'],
        'veiculos': ['cadastro de veiculos', 'veiculo', 'placas'],
        'camaras e enderecos': ['camaras', 'enderecos', 'enderecamento', 'cadastro de camaras'],
        'mapa 2d / 3d': ['mapa', 'mapa do armazem', 'mapa 2d', 'mapa 3d', 'mapa das camaras'],
        'etiqueta longarina': ['etiquetas', 'etiqueta', 'etiqueta de longarina', 'longarina'],
        'temperatura das camaras': ['temperatura', 'temperaturas'],
        'recebimento': ['entrada', 'entradas', 'notas de entrada', 'receber'],
        'conferencia de entrada': ['conferencia', 'conferir entrada'],
        'movimentacao': ['movimentar', 'movimentar palete', 'transferencia'],
        'controle de palete': ['paletes', 'palete'],
        'saida por xml': ['saida', 'saidas', 'expedicao', 'cargas', 'carga'],
        'painel de saida': ['painel da saida', 'painel da expedicao'],
        'extrato': ['extratos', 'comprovante', 'comprovantes'],
        'divergencias': ['divergencia'],
        'separacao': ['separar', 'picking'],
        'retornos e reentregas': ['retornos', 'retorno', 'reentrega', 'reentregas', 'devolucao', 'devolucoes'],
        'estoque atual': ['estoque', 'consulta de estoque', 'posicao de estoque'],
        'historico de movimentacao': ['historico', 'movimentacoes', 'historico de movimentacoes'],
        'historico nf': ['historico da nota', 'historico de nota', 'historico de notas', 'historico nota fiscal'],
        'analise de estoque': ['analise', 'analises', 'estoque de seguranca', 'shelf life', 'visao cruzada'],
        'inventario': ['inventarios', 'contagem'],
        'dashboard': ['dashboard do estoque', 'indicadores', 'painel do estoque'],
        'relatorios': ['relatorio'],
        'agendamento': ['agenda', 'agendamentos', 'docas', 'agenda de docas'],
        'ocorrencias': ['ocorrencia'],
        'financeiro': ['cobranca', 'faturamento', 'controle de permanencia'],
        'usuarios': ['usuario', 'cadastro de usuarios'],
        'permissoes': ['permissao'],
        'hierarquia': ['organizacoes', 'grupos'],
        'log de acoes': ['log', 'logs', 'auditoria']
    };

    // Atalhos para partes de uma tela (sub-abas): [frases, caminho da tela no menu, o que acrescentar]
    var SUBTELAS = [
        [['tabela de cobranca', 'tabelas de cobranca'], 'financeiro', '?aba=tabelas'],
        [['contratos', 'contrato'], 'financeiro', '?aba=contratos'],
        [['clientes do financeiro', 'clientes financeiro'], 'financeiro', '?aba=clientes'],
        [['logica de cobranca'], 'financeiro', '?aba=logica'],
        [['permanencia'], 'financeiro', '?aba=movimentacao']
    ];

    var ABRIR = /^(abrir|abra|abre|ir para|ir pra|va para|vai para|mostrar|mostra|mostre|tela de|tela do|tela da|tela|acessar|entrar em|entrar no|entrar na|quero ver|ver)\s+/;
    var ARTIGO = /^(o|a|os|as|do|da|dos|das|de|no|na|nos|nas|em|um|uma|pelo|pela|por)\s+/;

    function semArtigo(texto) {
        var antes;
        do { antes = texto; texto = texto.replace(ARTIGO, ''); } while (texto !== antes);
        return texto;
    }

    // Procura a tela pelo nome ou por um apelido. Devolve a tela ou null.
    function acharTela(dito, telas, soIgual) {
        dito = semArtigo(dito);
        if (!dito) return null;
        var melhor = null, nota = 0;
        telas.forEach(function (tela) {
            var nome = normalizar(tela.nome);
            var nomes = [nome].concat(APELIDOS[nome] || []);
            nomes.forEach(function (n, i) {
                var pontos = 0;
                if (n === dito) pontos = 100 - i * 0.01;                                   // igual: o nome ganha do apelido
                else if (i === 0 && (' ' + n + ' ').indexOf(' ' + dito + ' ') >= 0 && dito.length >= 4) pontos = 60 + dito.length;
                else if ((' ' + dito + ' ').indexOf(' ' + n + ' ') >= 0 && n.length >= 4) pontos = 50 + n.length;
                if (pontos > nota) { nota = pontos; melhor = tela; }
            });
        });
        return (soIgual && nota < 99) ? null : melhor;
    }

    function telaPorNome(nome, telas) {
        for (var i = 0; i < telas.length; i++) if (normalizar(telas[i].nome) === nome) return telas[i];
        return null;
    }

    function comBusca(url, parametro, valor) {
        return url + (url.indexOf('?') >= 0 ? '&' : '?') + parametro + '=' + encodeURIComponent(valor);
    }

    // Buscas que levam a uma tela: [expressão, nome da tela no menu, parâmetro, só números?]
    var BUSCAS = [
        [/^(?:historico (?:da |de )?)?(?:nota fiscal|nota|nf|n f)\s+(?:numero\s+)?(.+)$/, 'historico nf', 'nf', true],
        [/^(?:consultar |consulta |buscar |pesquisar |procurar )?estoque\s+(?:de |do |da )?(.+)$/, 'estoque atual', 'q', false],
        [/^(?:buscar |pesquisar |procurar |consultar )?paletes?\s+(.+)$/, 'controle de palete', 'q', false],
        [/^(?:buscar |pesquisar |procurar |consultar )?produtos?\s+(.+)$/, 'produtos', 'q', false],
        [/^(?:buscar |pesquisar |procurar |consultar )?empresas?\s+(.+)$/, 'empresas', 'q', false],
        [/^(?:buscar |pesquisar |procurar |consultar )?cargas?\s+(.+)$/, 'saida por xml', 'q', false],
        [/^(?:buscar |pesquisar |procurar |consultar )?(?:recebimento|entrada)\s+(.+)$/, 'recebimento', 'q', false]
    ];

    /**
     * Interpreta uma frase. contexto = { telas: [{nome, url}], temBusca: bool, temCampo: bool }
     * Devolve { tipo, ... , fala } — tipo: ir | tema | menu | voltar | recarregar | ajuda | buscar_aqui | digitar |
     * limpar | enviar | proximo | clicar | parar | sair | nada
     */
    function interpretar(frase, contexto) {
        contexto = contexto || {};
        var telas = contexto.telas || [];
        var original = String(frase || '').trim();
        var t = normalizar(original).replace(/^(ok |ola |oi |ei )?doca( livre)?[\s,]*/, '').replace(/^por favor\s+/, '').replace(/\s+por favor$/, '');
        if (!t) return { tipo: 'nada', fala: 'Não entendi.' };

        if (/^(ajuda|comandos|o que posso (dizer|falar)|quais (sao )?os comandos|lista de comandos)$/.test(t)) return { tipo: 'ajuda', fala: 'Estes são os comandos.' };
        if (/^(parar|pare|para de ouvir|parar de ouvir|desligar (o )?microfone|desligar voz|silencio|chega)$/.test(t)) return { tipo: 'parar', fala: 'Microfone desligado.' };
        if (/^(voltar|volta|voltar uma tela|tela anterior|pagina anterior)$/.test(t)) return { tipo: 'voltar', fala: 'Voltando.' };
        if (/^(atualizar|atualiza|recarregar|recarrega|atualizar (a )?(tela|pagina))$/.test(t)) return { tipo: 'recarregar', fala: 'Atualizando.' };
        if (/^(sair do sistema|encerrar sessao|fazer logout|logout)$/.test(t)) return { tipo: 'sair', fala: 'Saindo do sistema.' };

        var m = t.match(/^(?:tema|modo)\s+(escuro|claro|noturno|diurno)$/) || t.match(/^(?:ativar|ligar|usar|colocar)\s+(?:o\s+)?(?:tema|modo)\s+(escuro|claro|noturno|diurno)$/);
        if (m) {
            var tema = (m[1] === 'escuro' || m[1] === 'noturno') ? 'escuro' : 'claro';
            return { tipo: 'tema', tema: tema, fala: 'Tema ' + tema + '.' };
        }
        if (/^(trocar|mudar|alternar)\s+(o\s+)?tema$/.test(t)) return { tipo: 'tema', tema: 'alternar', fala: 'Tema trocado.' };

        m = t.match(/^(abrir|abre|mostrar|fixar|expandir|fechar|fecha|recolher|esconder|soltar)\s+(o\s+)?menu$/);
        if (m) {
            var abrir = ['abrir', 'abre', 'mostrar', 'fixar', 'expandir'].indexOf(m[1]) >= 0;
            return { tipo: 'menu', abrir: abrir, fala: abrir ? 'Menu aberto.' : 'Menu recolhido.' };
        }

        // campo em que a pessoa está
        m = t.match(/^(?:digitar|digite|digita|escrever|escreve|escreva|preencher|preenche|preencha)\s+(.+)$/);
        if (m) {
            // o texto vai como foi falado (com acentos e maiúsculas), tirando só o verbo
            var falado = original.replace(/^\s*((ok|ol[aá]|oi|ei)\s+)?doca(\s+livre)?[\s,]*/i, '').replace(/^(por favor\s+)?\S+\s+/i, '');
            return { tipo: 'digitar', texto: soDigitos(m[1]) || falado, fala: 'Preenchido.' };
        }
        if (/^(limpar( o)? campo|apagar( o)? campo|apagar tudo|limpar)$/.test(t)) return { tipo: 'limpar', fala: 'Campo limpo.' };
        if (/^(proximo campo|proximo|campo seguinte)$/.test(t)) return { tipo: 'proximo', fala: '' };
        if (/^(confirmar|confirma|enviar|envia|salvar|salva|gravar|ok)$/.test(t)) return { tipo: 'enviar', fala: 'Enviando.' };

        m = t.match(/^(?:clicar|clica|clique|apertar|aperta|aperte|pressionar)\s+(?:em\s+|no\s+|na\s+|o\s+|a\s+)?(?:botao\s+)?(.+)$/);
        if (m) return { tipo: 'clicar', texto: m[1], fala: '' };

        // câmara no mapa
        m = t.match(/^(?:abrir |mostrar |ver |mapa (?:da |de )?)?camara\s+(?:numero\s+)?(.+)$/);
        if (m && soDigitos(m[1])) {
            var mapa = telaPorNome('mapa 2d / 3d', telas);
            if (mapa) return { tipo: 'ir', url: comBusca(mapa.url, 'camara', soDigitos(m[1])), fala: 'Câmara ' + soDigitos(m[1]) + '.' };
        }

        // buscas que levam a uma tela
        var semVerbo = t.replace(ABRIR, '');
        for (var i = 0; i < BUSCAS.length; i++) {
            var b = BUSCAS[i];
            m = semVerbo.match(b[0]);
            if (!m) continue;
            var termo = b[3] ? soDigitos(m[1]) : (soDigitos(m[1]) || m[1]);
            var destino = telaPorNome(b[1], telas);
            if (!termo || !destino) continue;
            if (!b[3] && acharTela(semVerbo, telas, true)) break;        // "estoque atual", "produtos" etc. são telas, não busca
            return { tipo: 'ir', url: comBusca(destino.url, b[2], termo), fala: 'Buscando ' + termo + '.' };
        }

        // partes de uma tela (sub-abas)
        for (i = 0; i < SUBTELAS.length; i++) {
            if (SUBTELAS[i][0].indexOf(semArtigo(semVerbo)) >= 0) {
                var base = telaPorNome(SUBTELAS[i][1], telas);
                if (base) return { tipo: 'ir', url: base.url + SUBTELAS[i][2], fala: 'Abrindo ' + SUBTELAS[i][0][0] + '.' };
            }
        }

        // navegação
        var tela = acharTela(semVerbo, telas);
        if (tela) return { tipo: 'ir', url: tela.url, fala: 'Abrindo ' + tela.nome + '.' };

        // busca na tela em que a pessoa está
        m = t.match(/^(?:buscar|busca|busque|pesquisar|pesquisa|pesquise|procurar|procura|procure|filtrar|consultar)\s+(?:por\s+)?(.+)$/);
        if (m) {
            var procurado = soDigitos(m[1]) || m[1];
            if (contexto.temBusca) return { tipo: 'buscar_aqui', texto: procurado, fala: 'Buscando ' + procurado + '.' };
            var estoque = telaPorNome('estoque atual', telas);
            if (estoque) return { tipo: 'ir', url: comBusca(estoque.url, 'q', procurado), fala: 'Buscando ' + procurado + ' no estoque.' };
        }
        if (ABRIR.test(t)) return { tipo: 'nada', fala: 'Não encontrei a tela ' + semVerbo + '.' };
        return { tipo: 'nada', fala: 'Não entendi. Diga ajuda para ver os comandos.' };
    }

    var AJUDA = [
        ['Abrir uma tela', '“abrir estoque”, “ir para recebimento”, “mapa”, “financeiro”, “contratos”'],
        ['Buscar', '“estoque de frango”, “nota 1214”, “palete 123”, “produto picanha”, “carga V100”, “câmara 7”'],
        ['Buscar na tela aberta', '“buscar Alora”'],
        ['Preencher o campo em que você está', '“digitar 150”, “limpar campo”, “próximo campo”, “confirmar”'],
        ['Botões da tela', '“clicar em Baixar Excel” (exclusões só pelo clique)'],
        ['Sistema', '“tema escuro”, “abrir menu”, “voltar”, “atualizar”, “sair do sistema”'],
        ['Microfone', '“ajuda”, “parar”. No modo contínuo, comece a frase por “Doca”: “Doca, abrir estoque”']
    ];

    raiz.WMSVoz = { interpretar: interpretar, normalizar: normalizar, soDigitos: soDigitos, AJUDA: AJUDA };
    if (typeof module !== 'undefined' && module.exports) module.exports = raiz.WMSVoz;
    if (typeof document === 'undefined') return;

    // ============================================================ tela
    var botao = document.getElementById('btnVoz');
    if (!botao) return;
    var Reconhecimento = raiz.SpeechRecognition || raiz.webkitSpeechRecognition;
    function ler(chave) { try { return localStorage.getItem(chave); } catch (e) { return null; } }
    function gravar(chave, valor) { try { localStorage.setItem(chave, valor); } catch (e) {} }

    var painel = document.createElement('div');
    painel.className = 'voz-painel';
    painel.hidden = true;
    painel.setAttribute('role', 'status');
    painel.setAttribute('aria-live', 'polite');
    painel.innerHTML =
        '<div class="voz-topo"><span class="voz-estado" id="vozEstado"></span>' +
        '<button type="button" class="btn-close" id="vozFechar" aria-label="Fechar o painel de voz"></button></div>' +
        '<p class="voz-ouvido" id="vozOuvido"></p><p class="voz-resposta" id="vozResposta"></p>' +
        '<div class="voz-opcoes">' +
        '<label class="form-check form-switch mb-0"><input class="form-check-input" type="checkbox" id="vozContinuo"><span class="form-check-label">Ouvir sempre (diga “Doca” antes)</span></label>' +
        '<label class="form-check form-switch mb-0"><input class="form-check-input" type="checkbox" id="vozFala"><span class="form-check-label">Responder falando</span></label>' +
        '<button type="button" class="btn btn-sm btn-outline-secondary" id="vozAjuda">Comandos</button></div>' +
        '<dl class="voz-ajuda" id="vozLista" hidden></dl>';
    document.body.appendChild(painel);
    var elEstado = painel.querySelector('#vozEstado'), elOuvido = painel.querySelector('#vozOuvido'), elResposta = painel.querySelector('#vozResposta');
    var chkContinuo = painel.querySelector('#vozContinuo'), chkFala = painel.querySelector('#vozFala'), lista = painel.querySelector('#vozLista');
    AJUDA.forEach(function (linha) {
        var dt = document.createElement('dt'), dd = document.createElement('dd');
        dt.textContent = linha[0]; dd.textContent = linha[1];
        lista.appendChild(dt); lista.appendChild(dd);
    });

    var continuo = ler('wms.voz.continuo') === '1';
    var falar = ler('wms.voz.fala') !== '0';
    chkContinuo.checked = continuo;
    chkFala.checked = falar;

    function estado(texto, ouvindo) {
        elEstado.textContent = texto;
        botao.classList.toggle('ouvindo', !!ouvindo);
        botao.setAttribute('aria-pressed', ouvindo ? 'true' : 'false');
    }
    function responder(texto, erro) {
        elResposta.textContent = texto || '';
        elResposta.classList.toggle('voz-erro', !!erro);
        if (falar && texto && raiz.speechSynthesis) {
            try {
                raiz.speechSynthesis.cancel();
                var fala = new SpeechSynthesisUtterance(texto);
                fala.lang = 'pt-BR';
                raiz.speechSynthesis.speak(fala);
            } catch (e) {}
        }
    }
    function mostrarAjuda(mostrar) { lista.hidden = !mostrar; painel.hidden = false; }

    if (!Reconhecimento) {
        botao.classList.add('sem-suporte');
        botao.title = 'Controle de voz: este navegador não tem reconhecimento de fala. Use o Chrome ou o Edge.';
        botao.addEventListener('click', function () {
            painel.hidden = false;
            estado('Voz indisponível', false);
            responder('Este navegador não tem reconhecimento de fala. Use o Chrome ou o Edge.', true);
        });
        painel.querySelector('#vozFechar').addEventListener('click', function () { painel.hidden = true; });
        painel.querySelector('#vozAjuda').addEventListener('click', function () { mostrarAjuda(lista.hidden); });
        return;
    }

    // último campo em que a pessoa esteve (o clique no microfone tira o foco dele)
    var ultimoCampo = null;
    document.addEventListener('focusin', function (ev) {
        var el = ev.target;
        if (el && el.matches && el.matches('input:not([type=hidden]):not([type=checkbox]):not([type=radio]):not([type=file]):not([type=submit]):not([type=button]), textarea')
            && !painel.contains(el)) ultimoCampo = el;
    });
    function campoAtual() { return ultimoCampo && document.body.contains(ultimoCampo) && !ultimoCampo.disabled && !ultimoCampo.readOnly ? ultimoCampo : null; }
    function campoDeBusca() {
        var conteudo = document.getElementById('mainContent') || document;
        return conteudo.querySelector('form[method="GET" i] input[type=search], form[method="GET" i] input[name=q], form:not([method]) input[type=search]');
    }
    function telasDoMenu() {
        var telas = [{ nome: 'Início', url: '/' }, { nome: 'Painel', url: '/?aba=geral' }];
        document.querySelectorAll('#sidebar .dropdown-container a:not(.em-breve)').forEach(function (a) {
            var nome = a.textContent.trim();
            // nome repetido (ex.: "Painel" da Saída): acrescenta o grupo do menu
            if (telas.some(function (t) { return t.nome === nome; })) {
                var grupo = a.closest('.nav-item').querySelector('.dropdown-btn .link-text');
                nome = nome + ' de ' + (grupo ? grupo.textContent.trim() : '');
            }
            telas.push({ nome: nome, url: a.getAttribute('href') });
        });
        return telas;
    }
    function preencher(campo, valor) {
        campo.focus();
        campo.value = valor;
        campo.dispatchEvent(new Event('input', { bubbles: true }));
        campo.dispatchEvent(new Event('change', { bubbles: true }));
    }
    function visivel(el) { return !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length); }

    function executar(acao) {
        var campo, ok = true, fala = acao.fala;
        switch (acao.tipo) {
        case 'ir': gravar('wms.voz.ultima', fala); raiz.location.href = acao.url; break;
        case 'voltar': raiz.history.back(); break;
        case 'recarregar': raiz.location.reload(); break;
        case 'sair': raiz.location.href = '/sair'; break;
        case 'ajuda': mostrarAjuda(true); break;
        case 'parar': desligar(); break;
        case 'tema':
            var atual = document.documentElement.getAttribute('data-tema');
            var btnTema = document.getElementById('btnTema');
            if (btnTema && (acao.tema === 'alternar' || acao.tema !== atual)) btnTema.click();
            break;
        case 'menu':
            var menu = document.getElementById('sidebar'), btnMenu = document.getElementById('btnMenu');
            var aberto = menu && (menu.classList.contains('sidebar-fixed') || menu.classList.contains('open'));
            if (btnMenu && aberto !== acao.abrir) btnMenu.click();
            break;
        case 'buscar_aqui':
            campo = campoDeBusca();
            if (campo) { preencher(campo, acao.texto); if (campo.form.requestSubmit) campo.form.requestSubmit(); else campo.form.submit(); }
            else { ok = false; fala = 'Esta tela não tem busca.'; }
            break;
        case 'digitar':
            campo = campoAtual();
            if (campo) preencher(campo, acao.texto); else { ok = false; fala = 'Clique primeiro no campo que quer preencher.'; }
            break;
        case 'limpar':
            campo = campoAtual();
            if (campo) preencher(campo, ''); else { ok = false; fala = 'Clique primeiro no campo.'; }
            break;
        case 'proximo':
            campo = campoAtual();
            if (campo && campo.form) {
                var campos = Array.prototype.filter.call(campo.form.elements, function (el) {
                    return el.type !== 'hidden' && !el.disabled && visivel(el) && el.tagName !== 'BUTTON';
                });
                var proximo = campos[campos.indexOf(campo) + 1];
                if (proximo) proximo.focus(); else { ok = false; fala = 'Este é o último campo.'; }
            } else { ok = false; fala = 'Clique primeiro num campo.'; }
            break;
        case 'enviar':
            campo = campoAtual();
            if (campo && campo.form) {
                // requestSubmit passa pela validação e pelas confirmações do formulário, como o clique no botão
                if (campo.form.requestSubmit) campo.form.requestSubmit(); else campo.form.submit();
            } else { ok = false; fala = 'Clique primeiro num campo do formulário que quer enviar.'; }
            break;
        case 'clicar':
            var alvo = WMSVoz.normalizar(acao.texto), achado = null, perigoso = false;
            var conteudo = document.getElementById('mainContent') || document.body;
            Array.prototype.some.call(conteudo.querySelectorAll('button, a.btn, a[role=tab], .sub-abas a'), function (el) {
                if (!visivel(el) || el.disabled) return false;
                var rotulo = WMSVoz.normalizar(el.textContent || el.getAttribute('aria-label') || el.title);
                if (!rotulo || (rotulo !== alvo && rotulo.indexOf(alvo) !== 0)) return false;
                if (/btn(-outline)?-danger/.test(el.className)) { perigoso = true; return false; }
                achado = el;
                return true;
            });
            if (achado) { fala = 'Clicando em ' + achado.textContent.trim() + '.'; achado.click(); }
            else { ok = false; fala = perigoso ? 'Por segurança, excluir e cancelar só pelo clique.' : 'Não encontrei o botão ' + acao.texto + '.'; }
            break;
        default: ok = false;
        }
        responder(fala, !ok);
    }

    // ------------------------------------------------------------ reconhecimento
    var rec = null, ligado = false, querOuvir = false;
    function ouvirFrase(frase) {
        elOuvido.textContent = '“' + frase + '”';
        if (continuo && !/^\s*(ok |ol[aá] |oi |ei )?doca\b/i.test(frase)) {
            // no modo contínuo só vale o que começa por "Doca" (para conversa perto do microfone não virar comando)
            elResposta.textContent = 'Diga “Doca” antes do comando.';
            elResposta.classList.remove('voz-erro');
            return;
        }
        executar(interpretar(frase, { telas: telasDoMenu(), temBusca: !!campoDeBusca(), temCampo: !!campoAtual() }));
    }
    function ligar() {
        if (ligado) return;
        querOuvir = true;
        painel.hidden = false;
        rec = new Reconhecimento();
        rec.lang = 'pt-BR';
        rec.continuous = continuo;
        rec.interimResults = true;
        rec.maxAlternatives = 1;
        rec.onstart = function () { ligado = true; estado(continuo ? 'Ouvindo sempre — diga “Doca, …”' : 'Ouvindo… fale o comando', true); };
        rec.onresult = function (ev) {
            for (var i = ev.resultIndex; i < ev.results.length; i++) {
                var trecho = ev.results[i][0].transcript.trim();
                if (ev.results[i].isFinal) { if (trecho) ouvirFrase(trecho); } else elOuvido.textContent = trecho + '…';
            }
        };
        rec.onerror = function (ev) {
            if (ev.error === 'no-speech' || ev.error === 'aborted') return;
            querOuvir = false;
            var motivo = { 'not-allowed': 'O navegador bloqueou o microfone. Libere o microfone para este site (cadeado ao lado do endereço).',
                           'service-not-allowed': 'O navegador bloqueou o reconhecimento de fala.',
                           'audio-capture': 'Nenhum microfone encontrado.',
                           'network': 'Sem conexão com o serviço de fala do navegador.' }[ev.error] || 'Erro no reconhecimento de fala (' + ev.error + ').';
            if (continuo) { continuo = false; chkContinuo.checked = false; gravar('wms.voz.continuo', '0'); }
            responder(motivo, true);
        };
        rec.onend = function () {
            ligado = false;
            if (querOuvir && continuo) { try { rec.start(); return; } catch (e) {} }
            querOuvir = false;
            estado('Microfone desligado', false);
        };
        try { rec.start(); } catch (e) { estado('Microfone desligado', false); }
    }
    function desligar() {
        querOuvir = false;
        if (continuo) { continuo = false; chkContinuo.checked = false; gravar('wms.voz.continuo', '0'); }
        if (rec && ligado) { try { rec.stop(); } catch (e) {} }
        estado('Microfone desligado', false);
    }

    botao.addEventListener('mousedown', function (ev) { ev.preventDefault(); });      // não tira o foco do campo em uso
    botao.addEventListener('click', function () { if (ligado) desligar(); else ligar(); });
    document.addEventListener('keydown', function (ev) {
        if (ev.altKey && !ev.ctrlKey && !ev.metaKey && (ev.key === 'v' || ev.key === 'V')) { ev.preventDefault(); if (ligado) desligar(); else ligar(); }
    });
    painel.querySelector('#vozFechar').addEventListener('click', function () { painel.hidden = true; });
    painel.querySelector('#vozAjuda').addEventListener('click', function () { mostrarAjuda(lista.hidden); });
    chkFala.addEventListener('change', function () { falar = chkFala.checked; gravar('wms.voz.fala', falar ? '1' : '0'); });
    chkContinuo.addEventListener('change', function () {
        continuo = chkContinuo.checked;
        gravar('wms.voz.continuo', continuo ? '1' : '0');
        if (ligado) { querOuvir = continuo; try { rec.stop(); } catch (e) {} if (continuo) setTimeout(ligar, 400); }
        else if (continuo) ligar();
    });

    estado('Microfone desligado', false);
    // depois de um comando que trocou de tela: mostra o que foi feito e, no modo contínuo, volta a ouvir
    var ultima = ler('wms.voz.ultima');
    if (ultima) { gravar('wms.voz.ultima', ''); painel.hidden = false; elResposta.textContent = ultima; }
    if (continuo) ligar();
})(typeof window !== 'undefined' ? window : globalThis);

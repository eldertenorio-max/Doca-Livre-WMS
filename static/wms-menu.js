/**
 * Menu único do WMS Doca Livre — fonte da verdade para o menu lateral, a busca e a tela inicial.
 * Organizado por processo do armazém (docs/INVENTARIO_FUNCIONALIDADES.md, seção 5).
 * Cada item aponta para a tela existente; nenhuma funcionalidade foi removida.
 *   [id, rótulo, url, opções]   opções.su = só Super Usuário
 */
(function () {
  var W = 'enderecamento-wms';
  function wms(aba) { return '/painel?modulo=' + W + '&aba=' + aba; }
  function pro(modulo, aba) { return '/painel?modulo=' + modulo + '&aba=' + aba; }
  function cam(secao) { return '/camaras?secao=' + secao; }
  function cont(view) { return '/contagem?view=' + view; }

  var grupos = [
    { id: 'recebimento', rotulo: 'Recebimento', icone: 'entrada', itens: [
      ['rec-previsoes', 'Previsões de entrada (agendamentos)', wms('hub')],
      ['rec-yms', 'Pátio e docas (YMS)', wms('yms')],
      ['rec-asn', 'Aviso de recebimento (ASN)', wms('asn')],
      ['rec-enviar-xml', 'Enviar XML da NF-e', pro('terceiros', 'enviar-xml')],
      ['rec-pendencia', 'Pendência de recebimento', pro('terceiros', 'pendencia-recebimento')],
      ['rec-conferencia', 'Conferência e paletização', wms('recebimento')],
      ['rec-recebidos', 'Fornecedores recebidos', pro('terceiros', 'fornecedores-recebidos')],
      ['rec-qa', 'Qualidade do lote (QA)', wms('qa-lote')],
      ['rec-painel', 'Painel do recebimento', pro('terceiros', 'painel')]
    ]},
    { id: 'fiscal', rotulo: 'Fiscal e transferências', icone: 'fiscal', itens: [
      ['fis-pendentes', 'NFs pendentes de lançamento', pro('terceiros', 'pendentes-lancamento')],
      ['fis-lancadas', 'Notas fiscais lançadas', pro('terceiros', 'notas-lancadas')],
      ['fis-pend-mg', 'Pendências de envio para MG', pro('terceiros', 'pendencias-mg')],
      ['fis-enviadas-mg', 'Notas enviadas para MG', pro('terceiros', 'notas-enviadas-mg')],
      ['fis-receb-mg', 'Recebimentos de MG', pro('terceiros', 'recebimentos-mg')],
      ['fis-historico', 'Histórico do recebimento', pro('terceiros', 'historico')],
      ['fis-relatorios', 'Relatórios do recebimento', pro('terceiros', 'relatorios')]
    ]},
    { id: 'armazenagem', rotulo: 'Armazenagem', icone: 'armazem', itens: [
      ['arm-painel', 'Painel do armazém', wms('painel')],
      ['arm-mapa', 'Endereçamento 2D/3D', wms('enderecamento')],
      ['arm-mapa3d', 'Mapa 3D', wms('mapa-3d')],
      ['arm-localizacoes', 'Localizações', wms('localizacoes')],
      ['arm-movimentacoes', 'Movimentações e putaway', wms('movimentacoes')],
      ['arm-paletes', 'Controle de paletes', wms('controle-paletes')],
      ['arm-etiquetas', 'Etiquetas de longarina', wms('etiquetas-longarina')],
      ['arm-ocupacao', 'Ocupação do armazém', wms('ocupacao')]
    ]},
    { id: 'camaras', rotulo: 'Câmaras frias', icone: 'camara', itens: [
      ['cam-mapa', 'Mapa das câmaras e consulta', cam('consulta')],
      ['cam-entrada', 'Entrada de NF-e nas câmaras', cam('entrada')],
      ['cam-saida', 'Saída de NF-e das câmaras', cam('saida')],
      ['cam-movimentar', 'Movimentar posição', cam('editar')],
      ['cam-canceladas', 'NF-e canceladas', cam('canceladas')],
      ['cam-agendamentos', 'Agendamentos das câmaras', cam('agendamentosHub')],
      ['cam-historico', 'Histórico das câmaras', cam('historico')],
      ['cam-relatorio', 'Relatório das câmaras', cam('relatorio')],
      ['cam-painel', 'Painel das câmaras', cam('painel')],
      ['cam-imprimir', 'Imprimir mapa das câmaras', cam('imprimir')],
      ['cam-ia', 'IA Doca Livre e voz', cam('cadastroVoz')]
    ]},
    { id: 'estoque', rotulo: 'Estoque', icone: 'estoque', itens: [
      ['est-atual', 'Estoque geral', pro('estoque-sp', 'estoque-atual')],
      ['est-saida', 'Histórico de saída', pro('estoque-sp', 'saida')],
      ['est-ent-dev', 'Entradas de devolução', pro('estoque-sp', 'entrada-devolucao')],
      ['est-ent-ter', 'Entradas de terceiros', pro('estoque-sp', 'entrada-terceiros')],
      ['est-reentregas', 'Reentregas', pro('estoque-sp', 'reentregas')],
      ['est-avaria', 'Avaria', pro('estoque-sp', 'avaria')],
      ['est-descarte', 'Descarte e perdas', pro('estoque-sp', 'descarte-perdas')],
      ['est-bloqueado', 'Palete bloqueado', pro('estoque-sp', 'palete-bloqueado')],
      ['est-sku', 'Pesquisa por SKU', wms('pesquisa')],
      ['est-produtos', 'Produtos endereçados', wms('produtos')],
      ['est-seguranca', 'Estoque de segurança', wms('estoque-seguranca')],
      ['est-shelf', 'Shelf life', wms('shelf-life')],
      ['est-cruzada', 'Visão cruzada', wms('visao-cruzada')],
      ['est-seg-planilha', 'Estoque de segurança (planilhas)', cont('seguranca')],
      ['est-contagens', 'Estoque e shelf-life das contagens', cont('estoque')]
    ]},
    { id: 'inventario', rotulo: 'Inventário e contagem', icone: 'inventario', itens: [
      ['inv-contagem', 'Contagem diária', cont('contagem')],
      ['inv-inventarios', 'Inventários', cont('inventarios')],
      ['inv-wms', 'Inventário do armazém', wms('inventario')],
      ['inv-painel', 'Painel de contagem', cont('painel')],
      ['inv-temperatura', 'Temperatura das câmaras', cont('temperatura')],
      ['inv-ocupacao', 'Ocupação e avarias', cont('ocupacao')],
      ['inv-agendamentos', 'Agendamentos da contagem', cont('agendamentos')]
    ]},
    { id: 'expedicao', rotulo: 'Expedição', icone: 'saida', itens: [
      ['exp-painel', 'Painel de expedição', pro('carregamento', 'painel')],
      ['exp-ravex', 'Importar romaneios (Ravex)', pro('carregamento', 'importar-ravex')],
      ['exp-baixados', 'Romaneios baixados', pro('carregamento', 'baixa-ravex')],
      ['exp-separacao', 'Separação', wms('separacao')],
      ['exp-picking', 'Ondas de picking', wms('picking-avancado')],
      ['exp-conferencia', 'Conferência de carregamento', pro('carregamento', 'conferencia')],
      ['exp-extrato', 'Extrato do carregamento', pro('carregamento', 'extrato')],
      ['exp-romaneio', 'Romaneio por item', pro('carregamento', 'romaneio')],
      ['exp-divergencias', 'Divergências de carregamento', pro('carregamento', 'divergencias')],
      ['exp-relatorios', 'Relatórios de expedição', pro('carregamento', 'relatorios')]
    ]},
    { id: 'devolucoes', rotulo: 'Devoluções', icone: 'devolucao', itens: [
      ['dev-painel', 'Painel de devoluções', pro('devolucoes', 'painel')],
      ['dev-conferencia', 'Conferência de devolução', pro('devolucoes', 'conferencia')],
      ['dev-extrato', 'Extrato de devoluções', pro('devolucoes', 'extrato')],
      ['dev-baixados', 'Devoluções baixadas (Ravex)', pro('devolucoes', 'baixa-ravex')],
      ['dev-divergencias', 'Divergências de devolução', pro('devolucoes', 'divergencias')],
      ['dev-relatorios', 'Relatórios de devolução', pro('devolucoes', 'relatorios')]
    ]},
    { id: 'faturamento', rotulo: 'Faturamento 3PL', icone: 'financeiro', itens: [
      ['fat-financeiro', 'Financeiro 3PL', cam('financeiro')],
      ['fat-3pl', 'Depositantes e faturas', wms('3pl')]
    ]},
    { id: 'relatorios', rotulo: 'Relatórios', icone: 'relatorio', itens: [
      ['rel-wms', 'Relatórios do armazém', wms('relatorios')],
      ['rel-historico-nf', 'Histórico de NF', wms('historico-nf')]
    ]},
    { id: 'cadastros', rotulo: 'Cadastros', icone: 'cadastro', itens: [
      ['cad-base', 'Base de produtos (códigos de barras)', pro('carregamento', 'base')],
      ['cad-catalogo', 'Catálogo de produtos', cont('produtos')],
      ['cad-familia', 'Famílias de produto', cont('produtosFamilia')],
      ['cad-grupos', 'Grupos de produto', cont('produtosGrupos')],
      ['cad-subgrupos', 'Subgrupos de produto', cont('produtosSubGrupos')],
      ['cad-importacao', 'Importar planilha de produtos', cont('produtosImportacao')],
      ['cad-enderecos', 'Cadastro de endereços', cont('enderecamento')]
    ]},
    { id: 'configuracoes', rotulo: 'Configurações', icone: 'config', itens: [
      ['cfg-rfq', 'Regras de recebimento (RFQ)', wms('config-rfq')],
      ['cfg-verticais', 'Verticais (cross-dock, bobinas)', wms('verticais')],
      ['cfg-usuarios', 'Usuários', '/usuarios/novo', { su: true }],
      ['cfg-permissoes', 'Hierarquia e permissões', '/camaras?secao=config', { su: true }]
    ]}
  ];

  var itens = [];
  grupos.forEach(function (g) {
    g.itens = g.itens.map(function (t) {
      var it = { id: t[0], rotulo: t[1], url: t[2], su: !!(t[3] && t[3].su), grupo: g.id, grupoRotulo: g.rotulo };
      itens.push(it);
      return it;
    });
  });

  /** Qual sistema interno serve a URL (cada um fica num quadro próprio, carregado uma vez). */
  function appDaUrl(url) {
    var p = String(url || '').split('?')[0];
    if (p.indexOf('/painel') === 0) return 'pro';
    if (p.indexOf('/camaras') === 0 || p.indexOf('/config-portal') === 0) return 'plus';
    if (p.indexOf('/contagem') === 0) return 'light';
    return 'outro';
  }

  /** Parâmetros que identificam a tela dentro de cada sistema. */
  function chaveDaUrl(url) {
    var u;
    try { u = new URL(url, window.location.origin); } catch (e) { return ''; }
    var app = appDaUrl(u.pathname);
    var q = u.searchParams;
    if (app === 'pro') return 'pro:' + (q.get('modulo') || 'carregamento') + ':' + (q.get('aba') || '');
    if (app === 'plus') return 'plus:' + (q.get('secao') || (q.get('config') === '1' ? 'config' : ''));
    if (app === 'light') return 'light:' + (q.get('view') || 'painel');
    return 'outro:' + u.pathname;
  }

  window.WMS_MENU = { grupos: grupos, itens: itens, appDaUrl: appDaUrl, chaveDaUrl: chaveDaUrl };
})();

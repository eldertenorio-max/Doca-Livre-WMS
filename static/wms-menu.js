/**
 * Menu único do WMS DOCA LIVRE PRO — fonte da verdade para o menu lateral, a busca e a tela de módulos.
 * Base: os módulos e abas do WMS PRO (Carga / Expedição, Retorno / Devoluções, Descarga / Recebimento,
 * Estoque Geral, Endereçamento WMS 2D/3D). As telas das Câmaras e da Contagem entram nesses menus ou
 * em módulos novos no mesmo padrão. Nenhuma funcionalidade foi removida.
 *   [id, rótulo, url, opções]   opções.su = só Super Usuário
 */
(function () {
  var W = 'enderecamento-wms';
  function wms(aba) { return '/painel?modulo=' + W + '&aba=' + aba; }
  function pro(modulo, aba) { return '/painel?modulo=' + modulo + '&aba=' + aba; }
  function cam(secao) { return '/camaras?secao=' + secao; }
  function cont(view) { return '/contagem?view=' + view; }

  var grupos = [
    { id: 'carga', rotulo: 'Carga / Expedição', icone: 'saida',
      descricao: 'Importar romaneios do Ravex, conferir o carregamento, extrato, divergências e relatórios.', principal: 'exp-painel', atalhos: ['exp-conferencia', 'exp-ravex', 'exp-extrato', 'exp-relatorios'],
      itens: [
      ['exp-painel', 'Painel', pro('carregamento', 'painel')],
      ['exp-ravex', 'Importar Ravex', pro('carregamento', 'importar-ravex')],
      ['exp-baixados', 'Baixados (Ravex)', pro('carregamento', 'baixa-ravex')],
      ['exp-conferencia', 'Conferência', pro('carregamento', 'conferencia')],
      ['exp-extrato', 'Extrato', pro('carregamento', 'extrato')],
      ['exp-romaneio', 'Romaneio por Item', pro('carregamento', 'romaneio')],
      ['exp-relatorios', 'Relatórios', pro('carregamento', 'relatorios')],
      ['exp-divergencias', 'Divergências', pro('carregamento', 'divergencias')],
      ['exp-separacao', 'Separação', wms('separacao')],
      ['exp-picking', 'Ondas de Picking', wms('picking-avancado')],
      ['cad-base', 'Base de Produtos', pro('carregamento', 'base')]
    ]},
    { id: 'devolucoes', rotulo: 'Retorno / Devoluções', icone: 'devolucao',
      descricao: 'Conferência do retorno, extrato, divergências e relatórios de devolução.', principal: 'dev-painel', atalhos: ['dev-conferencia', 'dev-extrato', 'dev-relatorios'],
      itens: [
      ['dev-painel', 'Painel', pro('devolucoes', 'painel')],
      ['dev-conferencia', 'Conferência', pro('devolucoes', 'conferencia')],
      ['dev-extrato', 'Extrato', pro('devolucoes', 'extrato')],
      ['dev-baixados', 'Baixados (Ravex)', pro('devolucoes', 'baixa-ravex')],
      ['dev-relatorios', 'Relatórios', pro('devolucoes', 'relatorios')],
      ['dev-divergencias', 'Divergências', pro('devolucoes', 'divergencias')]
    ]},
    { id: 'recebimento', rotulo: 'Descarga / Recebimento', icone: 'entrada',
      descricao: 'XML da NF-e, pendências de recebimento, conferência, lançamento fiscal e envio para MG.', principal: 'rec-painel', atalhos: ['rec-enviar-xml', 'rec-pendencia', 'rec-conferencia', 'rec-previsoes'],
      itens: [
      ['rec-painel', 'Painel', pro('terceiros', 'painel')],
      ['rec-enviar-xml', '1° Enviar XML', pro('terceiros', 'enviar-xml')],
      ['rec-pendencia', '2° Pendência de Recebimento', pro('terceiros', 'pendencia-recebimento')],
      ['rec-recebidos', '3° Fornecedores Recebidos', pro('terceiros', 'fornecedores-recebidos')],
      ['fis-pendentes', '4° NFs Pendentes de Lançamento', pro('terceiros', 'pendentes-lancamento')],
      ['fis-lancadas', '5° Notas Fiscais Lançadas', pro('terceiros', 'notas-lancadas')],
      ['fis-pend-mg', '6° Pendências Envio MG', pro('terceiros', 'pendencias-mg')],
      ['fis-enviadas-mg', '7° Notas Enviadas para MG', pro('terceiros', 'notas-enviadas-mg')],
      ['fis-receb-mg', '8° Recebimentos de MG', pro('terceiros', 'recebimentos-mg')],
      ['fis-relatorios', 'Relatórios', pro('terceiros', 'relatorios')],
      ['fis-historico', 'Histórico', pro('terceiros', 'historico')],
      ['rec-previsoes', 'Agendamentos', wms('hub')],
      ['rec-yms', 'Pátio e Docas (YMS)', wms('yms')],
      ['rec-asn', 'ASN', wms('asn')],
      ['rec-conferencia', 'Conferência e Paletização', wms('recebimento')],
      ['rec-qa', 'QA Lote', wms('qa-lote')]
    ]},
    { id: 'estoque', rotulo: 'Estoque Geral', icone: 'estoque',
      descricao: 'Estoque atual, saídas, entradas, avarias, reentregas e pesquisa por SKU.', principal: 'est-atual', atalhos: ['est-atual', 'est-sku', 'est-avaria', 'est-shelf'],
      itens: [
      ['est-atual', 'Estoque Atual', pro('estoque-sp', 'estoque-atual')],
      ['est-saida', 'Histórico de Saída', pro('estoque-sp', 'saida')],
      ['est-ent-dev', 'Entrada (Devoluções)', pro('estoque-sp', 'entrada-devolucao')],
      ['est-ent-ter', 'Entrada Terceiros', pro('estoque-sp', 'entrada-terceiros')],
      ['est-reentregas', 'Reentregas', pro('estoque-sp', 'reentregas')],
      ['est-avaria', 'Avaria', pro('estoque-sp', 'avaria')],
      ['est-descarte', 'Descarte / Perdas', pro('estoque-sp', 'descarte-perdas')],
      ['est-bloqueado', 'Palete Bloqueado', pro('estoque-sp', 'palete-bloqueado')],
      ['est-sku', 'Pesquisa SKU', wms('pesquisa')],
      ['est-produtos', 'Produtos Endereçados', wms('produtos')],
      ['est-seguranca', 'Estoque de Segurança', wms('estoque-seguranca')],
      ['est-shelf', 'Shelf Life', wms('shelf-life')],
      ['est-cruzada', 'Visão Cruzada', wms('visao-cruzada')],
      ['est-contagens', 'Estoque x Shelf-Life (contagens)', cont('estoque')],
      ['est-seg-planilha', 'Estoque de Segurança (planilhas)', cont('seguranca')]
    ]},
    { id: 'wms', rotulo: 'Endereçamento WMS 2D/3D', icone: 'armazem',
      descricao: 'Mapa 2D/3D, localizações, movimentações, paletes, ocupação e inventário do armazém.', principal: 'arm-painel', atalhos: ['arm-mapa', 'arm-mapa3d', 'arm-movimentacoes', 'inv-wms'],
      itens: [
      ['arm-painel', 'Painel', wms('painel')],
      ['arm-mapa', 'Endereçamento 2D/3D', wms('enderecamento')],
      ['arm-mapa3d', 'Mapa 3D', wms('mapa-3d')],
      ['arm-localizacoes', 'Localizações', wms('localizacoes')],
      ['arm-etiquetas', 'Etq. Longarina', wms('etiquetas-longarina')],
      ['arm-movimentacoes', 'Movimentações', wms('movimentacoes')],
      ['arm-paletes', 'Controle Paletes', wms('controle-paletes')],
      ['arm-ocupacao', 'Ocupação', wms('ocupacao')],
      ['inv-wms', 'Inventário', wms('inventario')],
      ['rel-historico-nf', 'Histórico NF', wms('historico-nf')],
      ['rel-wms', 'Relatórios', wms('relatorios')],
      ['fat-3pl', '3PL', wms('3pl')],
      ['cfg-rfq', 'Config RFQ', wms('config-rfq')],
      ['cfg-verticais', 'Verticais', wms('verticais')]
    ]},
    { id: 'camaras', rotulo: 'Câmaras Frias', icone: 'camara',
      descricao: 'Mapa das câmaras, entrada e saída de NF-e, movimentação por voz e financeiro 3PL.', principal: 'cam-mapa', atalhos: ['cam-mapa', 'cam-entrada', 'cam-saida', 'fat-financeiro'],
      itens: [
      ['cam-mapa', 'Mapa de Câmaras & Consulta', cam('consulta')],
      ['cam-entrada', 'Entrada NF-e', cam('entrada')],
      ['cam-saida', 'Saída NF-e', cam('saida')],
      ['cam-movimentar', 'Movimentar Posição / Voz', cam('editar')],
      ['cam-canceladas', 'NF-e Canceladas', cam('canceladas')],
      ['cam-agendamentos', 'Agendamentos', cam('agendamentosHub')],
      ['cam-historico', 'Histórico', cam('historico')],
      ['cam-relatorio', 'Relatórios', cam('relatorio')],
      ['cam-painel', 'KPIs & Painel', cam('painel')],
      ['cam-imprimir', 'Imprimir Mapa', cam('imprimir')],
      ['cam-ia', 'IA Doca Livre & Voz', cam('cadastroVoz')],
      ['fat-financeiro', 'Financeiro 3PL', cam('financeiro')]
    ]},
    { id: 'contagem', rotulo: 'Contagem & Inventário', icone: 'inventario',
      descricao: 'Contagem diária, inventários, temperatura e ocupação das câmaras.', principal: 'inv-painel', atalhos: ['inv-contagem', 'inv-inventarios', 'inv-temperatura'],
      itens: [
      ['inv-painel', 'Painel de Contagem', cont('painel')],
      ['inv-contagem', 'Contagem Diária', cont('contagem')],
      ['inv-inventarios', 'Inventários', cont('inventarios')],
      ['inv-temperatura', 'Temperatura das Câmaras', cont('temperatura')],
      ['inv-ocupacao', 'Ocupação & Avarias', cont('ocupacao')],
      ['inv-agendamentos', 'Agendamentos', cont('agendamentos')]
    ]},
    { id: 'cadastros', rotulo: 'Cadastros', icone: 'cadastro',
      descricao: 'Catálogo de produtos, famílias, grupos e cadastro de endereços.', principal: 'cad-catalogo', atalhos: ['cad-catalogo', 'cad-enderecos', 'cad-importacao'],
      itens: [
      ['cad-catalogo', 'Catálogo de Produtos', cont('produtos')],
      ['cad-familia', 'Família', cont('produtosFamilia')],
      ['cad-grupos', 'Grupos', cont('produtosGrupos')],
      ['cad-subgrupos', 'SubGrupos', cont('produtosSubGrupos')],
      ['cad-importacao', 'Importação de Planilha', cont('produtosImportacao')],
      ['cad-enderecos', 'Cadastro de Endereços', cont('enderecamento')]
    ]},
    { id: 'administracao', rotulo: 'Administração', icone: 'config',
      descricao: 'Usuários, hierarquia e permissões.', principal: 'cfg-usuarios', atalhos: ['cfg-usuarios', 'cfg-permissoes'],
      itens: [
      ['cfg-usuarios', 'Usuários', '/usuarios/novo', { su: true }],
      ['cfg-permissoes', 'Hierarquia & Permissões', '/camaras?secao=config', { su: true }]
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

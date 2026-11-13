"""Catalogo unico de modulos e telas do WMS, na ordem de construcao combinada.

Cada modulo vira um grupo do menu lateral e uma linha da matriz de permissoes.
Tela com "endpoint" ja esta construida; sem "endpoint" abre "Em construcao" com o escopo previsto.
Para ligar uma tela nova: criar a rota e preencher "endpoint" (e "args", se a rota tiver parametros).
"""

MODULOS = [
    {
        'id': 'cadastros', 'nome': 'Cadastros', 'icone': 'database', 'passo': 1,
        'descricao': 'Bases usadas por todos os módulos.',
        'telas': [
            {'id': 'produtos', 'nome': 'Produtos', 'icone': 'box',
             'endpoint': 'cadastros.lista', 'args': {'slug': 'produtos'}},
            {'id': 'empresas', 'nome': 'Empresas', 'icone': 'building',
             'endpoint': 'cadastros.lista', 'args': {'slug': 'empresas'}},
            {'id': 'pessoas', 'nome': 'Pessoas', 'icone': 'id-card',
             'endpoint': 'cadastros.lista', 'args': {'slug': 'pessoas'}},
            {'id': 'veiculos', 'nome': 'Veículos', 'icone': 'truck',
             'endpoint': 'cadastros.lista', 'args': {'slug': 'veiculos'}},
        ],
    },
    {
        'id': 'enderecamento', 'nome': 'Endereçamento', 'icone': 'warehouse', 'passo': 2,
        'descricao': 'Câmaras, endereços e mapa do armazém.',
        'telas': [
            {'id': 'enderecos', 'nome': 'Câmaras e endereços', 'icone': 'table-cells',
             'endpoint': 'enderecamento.camaras',
             'tambem': ['/enderecamento/enderecos', '/enderecamento/layout-padrao', '/enderecamento/layouts']},
            {'id': 'mapa', 'nome': 'Mapa 2D / 3D', 'icone': 'cube', 'endpoint': 'enderecamento.mapa'},
            {'id': 'etiquetas', 'nome': 'Etiqueta longarina', 'icone': 'tag',
             'endpoint': 'enderecamento.etiquetas'},
            {'id': 'temperaturas', 'nome': 'Temperatura das câmaras', 'icone': 'temperature-half',
             'endpoint': 'temperaturas.lista'},
        ],
    },
    {
        'id': 'recebimento', 'nome': 'Entrada', 'icone': 'dolly', 'passo': 3,
        'descricao': 'Recebimento de notas fiscais e conferência física.',
        'telas': [
            {'id': 'notas', 'nome': 'Recebimento', 'icone': 'file-import', 'endpoint': 'entrada.notas'},
            {'id': 'conferencia', 'nome': 'Conferência de entrada', 'icone': 'barcode',
             'endpoint': 'entrada.conferencia'},
        ],
    },
    {
        'id': 'movimentacao', 'nome': 'Movimentação', 'icone': 'right-left', 'passo': 3,
        'descricao': 'Movimentação interna e controle de paletes.',
        'telas': [
            {'id': 'movimentar', 'nome': 'Movimentação', 'icone': 'right-left',
             'endpoint': 'movimentacao.movimentar'},
            {'id': 'paletes', 'nome': 'Controle de palete', 'icone': 'pallet',
             'endpoint': 'movimentacao.paletes'},
        ],
    },
    {
        'id': 'expedicao', 'nome': 'Saída', 'icone': 'truck-ramp-box', 'passo': 3,
        'descricao': 'Expedição: separação, conferência e carregamento.',
        'telas': [
            {'id': 'painel', 'nome': 'Painel', 'icone': 'gauge-high', 'endpoint': 'saida.painel'},
            # A conferencia de carga nao tem item proprio no menu: e uma etapa dentro da carga
            # (botoes Itens / Separação / Conferência / Extrato), como a conferencia dentro da nota no recebimento.
            {'id': 'saida-xml', 'nome': 'Saída por XML', 'icone': 'file-export', 'endpoint': 'saida.cargas',
             'tambem': ['/saida/conferencia']},
            {'id': 'separacao', 'nome': 'Separação', 'icone': 'cart-flatbed', 'endpoint': 'saida.separacao'},
            {'id': 'extrato', 'nome': 'Extrato', 'icone': 'receipt', 'endpoint': 'saida.extratos'},
            {'id': 'divergencias', 'nome': 'Divergências', 'icone': 'triangle-exclamation',
             'endpoint': 'saida.divergencias'},
            # A base de produtos e codigos de barras usada na bipagem e o cadastro em Cadastros › Produtos
            # (nao ha item "Base de dados" aqui para nao duplicar a mesma tela no menu).
        ],
    },
    {
        'id': 'devolucoes', 'nome': 'Retornos', 'icone': 'rotate-left', 'passo': 3,
        'descricao': 'Retornos e reentregas.',
        'telas': [
            {'id': 'retornos', 'nome': 'Retornos e reentregas', 'icone': 'rotate-left',
             'endpoint': 'retornos.lista'},
        ],
    },
    {
        'id': 'estoque', 'nome': 'Estoque', 'icone': 'boxes-stacked', 'passo': 4,
        'descricao': 'Saldo, histórico e indicadores do estoque.',
        'telas': [
            {'id': 'alertas', 'nome': 'Alertas', 'icone': 'bell', 'endpoint': 'sistema.alertas'},
            {'id': 'dashboard', 'nome': 'Dashboard', 'icone': 'chart-pie', 'endpoint': 'relatorios.dashboard'},
            {'id': 'atual', 'nome': 'Estoque atual', 'icone': 'magnifying-glass', 'endpoint': 'estoque.atual'},
            {'id': 'historico', 'nome': 'Histórico de movimentação', 'icone': 'clock-rotate-left',
             'endpoint': 'estoque.historico'},
            {'id': 'historico-nf', 'nome': 'Histórico NF', 'icone': 'file-invoice', 'endpoint': 'estoque.historico_nf'},
            # Uma aba so, com sub-abas: estoque de seguranca, relacao shelf life, visao cruzada e estoque x shelf life.
            {'id': 'analise', 'nome': 'Análise de estoque', 'icone': 'chart-simple', 'endpoint': 'estoque.analise'},
            {'id': 'inventario', 'nome': 'Inventário', 'icone': 'clipboard-check', 'endpoint': 'inventario.lista'},
        ],
    },
    {
        'id': 'relatorios', 'nome': 'Relatórios', 'icone': 'chart-column', 'passo': 4,
        'descricao': 'Relatórios com exportação em Excel.',
        'telas': [
            {'id': 'relatorios', 'nome': 'Relatórios', 'icone': 'chart-column', 'endpoint': 'relatorios.lista'},
            {'id': 'produtividade', 'nome': 'Produtividade', 'icone': 'stopwatch', 'endpoint': 'relatorios.produtividade'},
        ],
    },
    {
        'id': 'agendamento', 'nome': 'Agendamento', 'icone': 'calendar-check', 'passo': 5,
        'descricao': 'Agenda de docas ligada ao status dos produtos.',
        'telas': [
            {'id': 'agendamentos', 'nome': 'Agendamento', 'icone': 'calendar-check', 'endpoint': 'agendamento.lista'},
            {'id': 'ocorrencias', 'nome': 'Ocorrências', 'icone': 'triangle-exclamation', 'endpoint': 'agendamento.ocorrencias'},
        ],
    },
    {
        'id': 'financeiro', 'nome': 'Financeiro', 'icone': 'coins', 'passo': 6,
        'descricao': 'Faturamento da armazenagem.',
        'telas': [
            {'id': 'financeiro', 'nome': 'Financeiro', 'icone': 'coins', 'endpoint': 'financeiro.painel'},
        ],
    },
    {
        'id': 'coletor', 'nome': 'Coletor', 'icone': 'barcode', 'passo': 9,
        'descricao': 'Telas de bipagem para celular ou coletor de dados.',
        'telas': [
            {'id': 'coletor', 'nome': 'Coletor', 'icone': 'barcode', 'endpoint': 'coletor.inicio'},
            {'id': 'aplicativo', 'nome': 'Aplicativo Android', 'icone': 'mobile-screen-button', 'endpoint': 'aplicativo.pagina'},
        ],
    },
    {
        'id': 'portal', 'nome': 'Portal do cliente', 'icone': 'building-user', 'passo': 9,
        'descricao': 'O embarcador vê só o estoque, as notas e a cobrança dele.',
        'telas': [
            {'id': 'portal', 'nome': 'Portal do cliente', 'icone': 'building-user', 'endpoint': 'portal.inicio'},
        ],
    },
    {
        # modulo proprio (e nao uma tela da Administracao) para poder ser liberado a quem nao e administrador
        'id': 'hierarquia', 'nome': 'Hierarquia', 'icone': 'sitemap', 'passo': 7,
        'descricao': 'Organizações, grupos e vínculo dos usuários.',
        'telas': [
            {'id': 'hierarquia', 'nome': 'Hierarquia', 'icone': 'sitemap', 'endpoint': 'hierarquia.painel'},
        ],
    },
    {
        'id': 'admin', 'nome': 'Administração', 'icone': 'shield-halved', 'passo': 0,
        'descricao': 'Usuários, permissões e auditoria.',
        'telas': [
            {'id': 'usuarios', 'nome': 'Usuários', 'icone': 'users', 'endpoint': 'admin.usuarios'},
            {'id': 'permissoes', 'nome': 'Permissões', 'icone': 'user-lock', 'endpoint': 'admin.permissoes'},
            {'id': 'configuracoes', 'nome': 'Configurações e backup', 'icone': 'sliders', 'endpoint': 'sistema.configuracoes'},
            {'id': 'logs', 'nome': 'Log de ações', 'icone': 'clock-rotate-left', 'endpoint': 'admin.logs'},
        ],
    },
]

MODULOS_POR_ID = {m['id']: m for m in MODULOS}

# Modulos em que o perfil Operador ja nasce com nivel Editar.
MODULOS_OPERACAO = ('recebimento', 'movimentacao', 'expedicao', 'devolucoes', 'estoque', 'agendamento', 'coletor')


def telas_prontas(modulo):
    return sum(1 for t in modulo['telas'] if t.get('endpoint'))

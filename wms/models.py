"""Modelos do WMS Doca Livre.

Passo 1 (fundacao): usuarios, permissoes por perfil e log de acoes.
Os modelos operacionais (produtos, enderecos, paletes, notas, pedidos...)
entram nos proximos passos, cada um junto com o seu modulo.
"""
from datetime import datetime, timedelta, timezone

from flask_sqlalchemy import SQLAlchemy
from werkzeug.security import check_password_hash, generate_password_hash

db = SQLAlchemy()

# Horario de Brasilia (sem horario de verao desde 2019).
BRT = timezone(timedelta(hours=-3))


def agora():
    return datetime.now(BRT).replace(tzinfo=None)


class Usuario(db.Model):
    __tablename__ = 'usuario'

    id = db.Column(db.Integer, primary_key=True)
    username = db.Column(db.String(80), unique=True, nullable=False)
    nome = db.Column(db.String(120), nullable=False)
    email = db.Column(db.String(120))
    password_hash = db.Column(db.Text, nullable=False)
    perfil = db.Column(db.String(20), nullable=False, default='operador')
    ativo = db.Column(db.Boolean, nullable=False, default=True)
    trocar_senha = db.Column(db.Boolean, nullable=False, default=False)
    avatar = db.Column(db.String(40))           # arquivo da foto de perfil em instance/avatars/
    # Confirmacao de cadastro por e-mail: enquanto houver confirmacao_hash o cadastro esta aguardando a pessoa abrir
    # o link (guardamos so o hash do codigo do link) e ela nao entra no sistema.
    confirmacao_hash = db.Column(db.String(64), index=True)
    confirmacao_expira = db.Column(db.DateTime)
    email_confirmado_em = db.Column(db.DateTime)
    # Aplicativo Android: codigo pessoal usado pelo widget e pelos avisos (vazio = app nao ativado),
    # a versao do app que buscou o resumo por ultimo e quando.
    app_token = db.Column(db.String(64), unique=True)
    app_versao = db.Column(db.String(20))
    app_visto_em = db.Column(db.DateTime)
    # Hierarquia: organizacao a que o usuario pertence (vazio = sem restricao de grupo)
    organizacao_id = db.Column(db.Integer, db.ForeignKey('organizacao.id'), index=True)
    organizacao = db.relationship('Organizacao')
    criado_em = db.Column(db.DateTime, nullable=False, default=agora)
    ultimo_acesso = db.Column(db.DateTime)

    def set_password(self, senha):
        self.password_hash = generate_password_hash(senha)

    def check_password(self, senha):
        return check_password_hash(self.password_hash, senha)


class Permissao(db.Model):
    """Nivel de acesso de um perfil a um modulo: 0 = sem acesso, 1 = visualizar, 2 = editar."""
    __tablename__ = 'permissao'
    __table_args__ = (db.UniqueConstraint('perfil', 'modulo', name='uq_permissao_perfil_modulo'),)

    id = db.Column(db.Integer, primary_key=True)
    perfil = db.Column(db.String(20), nullable=False)
    modulo = db.Column(db.String(30), nullable=False)
    nivel = db.Column(db.Integer, nullable=False, default=0)


class PermissaoUsuario(db.Model):
    """Permissao de UMA pessoa num modulo, por cima da do perfil dela (so o Super Usuario define).
    Sem linha = vale o perfil. nivel: 0 = sem acesso, 1 = visualizar, 2 = editar."""
    __tablename__ = 'permissao_usuario'
    __table_args__ = (db.UniqueConstraint('usuario_id', 'modulo', name='uq_permissao_usuario_modulo'),)

    id = db.Column(db.Integer, primary_key=True)
    usuario_id = db.Column(db.Integer, db.ForeignKey('usuario.id'), nullable=False, index=True)
    modulo = db.Column(db.String(30), nullable=False)
    nivel = db.Column(db.Integer, nullable=False, default=0)


class ArquivoEnviado(db.Model):
    """Copia, dentro do banco, das imagens enviadas pelas pessoas (logos e fotos de perfil).

    Em producao o disco do aplicativo e apagado a cada reinicio (e ha mais de uma copia do aplicativo rodando): o
    arquivo que nao estiver no disco e recriado a partir daqui na hora de mostrar."""
    __tablename__ = 'arquivo_enviado'

    pasta = db.Column(db.String(20), primary_key=True)          # logos / avatars
    nome = db.Column(db.String(80), primary_key=True)
    conteudo = db.Column(db.LargeBinary, nullable=False)
    criado_em = db.Column(db.DateTime, nullable=False, default=agora)


class Configuracao(db.Model):
    """Configuracoes do sistema, uma por linha (chave -> valor em texto). As chaves e os padroes ficam em sistema.py."""
    __tablename__ = 'configuracao'

    chave = db.Column(db.String(40), primary_key=True)
    valor = db.Column(db.Text, nullable=False, default='')


# ---------------------------------------------------------------- Passo 1: cadastros

class Empresa(db.Model):
    __tablename__ = 'empresa'

    id = db.Column(db.Integer, primary_key=True)
    nome = db.Column(db.String(150), unique=True, nullable=False)
    fantasia = db.Column(db.String(150))
    cnpj = db.Column(db.String(14), index=True)
    tipo = db.Column(db.String(20), nullable=False, default='Fornecedor')
    cidade = db.Column(db.String(80))
    uf = db.Column(db.String(2))
    telefone = db.Column(db.String(30))
    email = db.Column(db.String(120))
    logo = db.Column(db.String(40))             # arquivo do logo em instance/logos/ (aparece no mapa)
    ativo = db.Column(db.Boolean, nullable=False, default=True)
    criado_em = db.Column(db.DateTime, nullable=False, default=agora)


class Produto(db.Model):
    __tablename__ = 'produto'

    id = db.Column(db.Integer, primary_key=True)
    sku = db.Column(db.String(40), unique=True, nullable=False)
    descricao = db.Column(db.String(200), nullable=False)
    ean = db.Column(db.String(14), index=True)      # codigo de barras da unidade
    dun = db.Column(db.String(14), index=True)      # codigo de barras da caixa
    unidade = db.Column(db.String(6), nullable=False, default='UN')
    fator_caixa = db.Column(db.Float, nullable=False, default=1)   # unidades por caixa (leitura do DUN)
    categoria = db.Column(db.String(20))            # Congelado / Resfriado / Seco -> zoneamento
    familia = db.Column(db.String(60))
    grupo = db.Column(db.String(60))
    subgrupo = db.Column(db.String(60))
    peso_kg = db.Column(db.Float)
    shelf_dias = db.Column(db.Integer)
    estoque_seguranca = db.Column(db.Float)        # minimo: abaixo disso o semaforo fica vermelho
    estoque_ideal = db.Column(db.Float)            # abaixo disso (e acima do minimo), amarelo
    estoque_maximo = db.Column(db.Float)           # acima disso, excedido
    depositante_id = db.Column(db.Integer, db.ForeignKey('empresa.id'))
    depositante = db.relationship('Empresa')
    ativo = db.Column(db.Boolean, nullable=False, default=True)
    criado_em = db.Column(db.DateTime, nullable=False, default=agora)


class Pessoa(db.Model):
    __tablename__ = 'pessoa'

    id = db.Column(db.Integer, primary_key=True)
    nome = db.Column(db.String(120), unique=True, nullable=False)
    funcao = db.Column(db.String(30), nullable=False, default='Conferente')
    documento = db.Column(db.String(20))
    telefone = db.Column(db.String(30))
    empresa_id = db.Column(db.Integer, db.ForeignKey('empresa.id'))
    empresa = db.relationship('Empresa')
    ativo = db.Column(db.Boolean, nullable=False, default=True)
    criado_em = db.Column(db.DateTime, nullable=False, default=agora)


class Veiculo(db.Model):
    __tablename__ = 'veiculo'

    id = db.Column(db.Integer, primary_key=True)
    placa = db.Column(db.String(8), unique=True, nullable=False)
    tipo = db.Column(db.String(20), nullable=False, default='Truck')
    transportadora_id = db.Column(db.Integer, db.ForeignKey('empresa.id'))
    transportadora = db.relationship('Empresa')
    observacao = db.Column(db.String(200))
    ativo = db.Column(db.Boolean, nullable=False, default=True)
    criado_em = db.Column(db.DateTime, nullable=False, default=agora)


# ---------------------------------------------------------------- Passo 2: enderecamento

class Camara(db.Model):
    __tablename__ = 'camara'

    id = db.Column(db.Integer, primary_key=True)
    codigo = db.Column(db.Integer, unique=True, nullable=False)   # 1 a 99 (os 2 digitos do endereco)
    nome = db.Column(db.String(80), nullable=False)
    tipo = db.Column(db.String(20), nullable=False, default='Armazenagem')   # Armazenagem / Stage / Área especial
    categoria = db.Column(db.String(20))        # Congelado / Resfriado / Seco -> zoneamento da guarda
    temp_min = db.Column(db.Float)
    temp_max = db.Column(db.Float)
    ativo = db.Column(db.Boolean, nullable=False, default=True)
    criado_em = db.Column(db.DateTime, nullable=False, default=agora)
    enderecos = db.relationship('Endereco', backref='camara', cascade='all, delete-orphan', lazy='dynamic')


class Endereco(db.Model):
    """Uma posicao de palete: camara + rua + coluna + nivel. Codigo no formato 12-C-14-1."""
    __tablename__ = 'endereco'
    __table_args__ = (db.UniqueConstraint('camara_id', 'rua', 'coluna', 'nivel', name='uq_endereco_posicao'),)

    id = db.Column(db.Integer, primary_key=True)
    camara_id = db.Column(db.Integer, db.ForeignKey('camara.id'), nullable=False, index=True)
    rua = db.Column(db.String(3), nullable=False)
    coluna = db.Column(db.Integer, nullable=False)
    nivel = db.Column(db.Integer, nullable=False)
    codigo = db.Column(db.String(16), unique=True, nullable=False)
    tipo = db.Column(db.String(10), nullable=False, default='Pulmão')    # Pulmão / Picking
    destino = db.Column(db.String(40))          # uso da posicao (ex.: REENTREGAS, AVARIA, DESCARTE)
    # True = posicao reservada para o destino (a etiqueta mostra o destino no rodape);
    # False = o destino e so um rotulo e a posicao aceita estoque normal.
    destino_fixo = db.Column(db.Boolean, nullable=False, default=False)
    bloqueado = db.Column(db.Boolean, nullable=False, default=False)
    motivo_bloqueio = db.Column(db.String(120))
    # Espaco reservado para um cliente (empresa): so mercadoria dele e guardada aqui. Vazio = uso livre.
    cliente_id = db.Column(db.Integer, db.ForeignKey('empresa.id'), index=True)
    cliente = db.relationship('Empresa')
    criado_em = db.Column(db.DateTime, nullable=False, default=agora)


class Vao(db.Model):
    """Lugar da estante que nao e posicao de palete: uma porta ou um ponto sem posicao.

    Serve para o mapa desenhar a camara como ela e. Camara sem nenhum registro aqui (layout importado)
    continua com a regra automatica: falta de posicao a partir do chao e porta; no alto, sem posicao.
    """
    __tablename__ = 'vao'
    __table_args__ = (db.UniqueConstraint('camara_id', 'rua', 'coluna', 'nivel', name='uq_vao_posicao'),)

    id = db.Column(db.Integer, primary_key=True)
    camara_id = db.Column(db.Integer, db.ForeignKey('camara.id'), nullable=False, index=True)
    camara = db.relationship('Camara', backref=db.backref('vaos', cascade='all, delete-orphan'))
    rua = db.Column(db.String(3), nullable=False)
    coluna = db.Column(db.Integer, nullable=False)
    nivel = db.Column(db.Integer, nullable=False)
    tipo = db.Column(db.String(12), nullable=False)      # Porta / Sem posição


class TemperaturaCamara(db.Model):
    """Leitura de temperatura de uma camara. Guarda a faixa que valia na hora, porque o cadastro pode mudar depois."""
    __tablename__ = 'temperatura_camara'

    id = db.Column(db.Integer, primary_key=True)
    camara_id = db.Column(db.Integer, db.ForeignKey('camara.id'), nullable=False, index=True)
    camara = db.relationship('Camara', backref=db.backref('temperaturas', cascade='all, delete-orphan', lazy='dynamic'))
    temperatura = db.Column(db.Float, nullable=False)          # graus Celsius
    medido_em = db.Column(db.DateTime, nullable=False, index=True)
    conferente = db.Column(db.String(120), nullable=False)
    observacao = db.Column(db.String(200))
    temp_min = db.Column(db.Float)
    temp_max = db.Column(db.Float)
    fora = db.Column(db.Boolean)                               # True = fora da faixa; None = camara sem faixa cadastrada
    registrado_por = db.Column(db.String(80))
    criado_em = db.Column(db.DateTime, nullable=False, default=agora)


class LayoutSalvo(db.Model):
    """Fotografia do layout do CD (camaras, enderecos, portas e espacos de cliente) guardada com um nome.

    "grupo" e o grupo hierarquico de quem salvou (hoje, o perfil do usuario): so esse grupo ve e carrega.
    """
    __tablename__ = 'layout_salvo'
    __table_args__ = (db.UniqueConstraint('grupo', 'nome', name='uq_layout_grupo_nome'),)

    id = db.Column(db.Integer, primary_key=True)
    nome = db.Column(db.String(60), nullable=False)
    grupo = db.Column(db.String(20), nullable=False, index=True)
    dados = db.Column(db.Text, nullable=False)          # JSON: {"camaras": [...]}
    camaras = db.Column(db.Integer, nullable=False, default=0)
    enderecos = db.Column(db.Integer, nullable=False, default=0)
    criado_por = db.Column(db.String(80))
    criado_em = db.Column(db.DateTime, nullable=False, default=agora)


# ---------------------------------------------------------------- Passo 3: entrada e movimentacao

class NotaFiscal(db.Model):
    __tablename__ = 'nota_fiscal'

    id = db.Column(db.Integer, primary_key=True)
    tipo = db.Column(db.String(10), nullable=False, default='Entrada', index=True)   # Entrada | Retorno
    numero = db.Column(db.String(15), nullable=False, index=True)
    serie = db.Column(db.String(5))
    chave = db.Column(db.String(44), unique=True)             # chave de acesso da NF-e (so quando veio de XML)
    # XML original da NF-e (so quando veio de XML): e dele que sai o DANFE em PDF. Carregado so quando pedido.
    xml = db.deferred(db.Column(db.Text))
    empresa_id = db.Column(db.Integer, db.ForeignKey('empresa.id'))    # emitente / remetente
    empresa = db.relationship('Empresa')
    data_emissao = db.Column(db.Date)
    valor_total = db.Column(db.Float)
    origem = db.Column(db.String(10), nullable=False, default='Manual')   # XML / Planilha / Manual
    status = db.Column(db.String(15), nullable=False, default='Aguardando', index=True)
    # Aguardando -> Em conferência -> Finalizada | Cancelada
    conferencia_cega = db.Column(db.Boolean, nullable=False, default=False)   # esconde a quantidade da NF de quem confere
    doca = db.Column(db.String(10))
    placa = db.Column(db.String(8))
    motorista = db.Column(db.String(120))
    conferente = db.Column(db.String(120))
    observacao = db.Column(db.String(300))
    motivo_cancelamento = db.Column(db.String(200))
    # Retorno (tipo = 'Retorno'): por que a mercadoria voltou e de qual carga de saida ela e.
    motivo_retorno = db.Column(db.String(60))
    carga_id = db.Column(db.Integer, db.ForeignKey('carga.id'), index=True)
    carga = db.relationship('Carga', foreign_keys=[carga_id])
    # Peso da nota em kg (vem do XML): usado no Financeiro quando o produto nao tem peso no cadastro.
    # 0 = o XML foi lido e nao informa peso; vazio = ainda nao lido / nota sem XML.
    peso_bruto = db.Column(db.Float)
    peso_liquido = db.Column(db.Float)
    # Financeiro: de quando a armazenagem comeca a contar (vazio = dia em que o primeiro palete foi montado)
    # e o periodo de cobranca escolhido para esta nota (vazio = do dia 1 do mes ate hoje).
    data_armazenagem = db.Column(db.Date)
    cobranca_inicio = db.Column(db.Date)
    cobranca_fim = db.Column(db.Date)
    criado_por = db.Column(db.String(80))
    criado_em = db.Column(db.DateTime, nullable=False, default=agora)
    finalizado_em = db.Column(db.DateTime)
    itens = db.relationship('NotaItem', backref='nota', cascade='all, delete-orphan', order_by='NotaItem.id')
    paletes = db.relationship('Palete', backref='nota', order_by='Palete.id')


class NotaItem(db.Model):
    __tablename__ = 'nota_item'

    id = db.Column(db.Integer, primary_key=True)
    nota_id = db.Column(db.Integer, db.ForeignKey('nota_fiscal.id'), nullable=False, index=True)
    produto_id = db.Column(db.Integer, db.ForeignKey('produto.id'), nullable=False)
    produto = db.relationship('Produto')
    codigo = db.Column(db.String(60))          # codigo do produto como veio na nota
    descricao = db.Column(db.String(200))
    unidade = db.Column(db.String(6))
    quantidade = db.Column(db.Float, nullable=False)       # quantidade da nota
    lote = db.Column(db.String(30))
    fabricacao = db.Column(db.Date)
    validade = db.Column(db.Date)
    motivo_divergencia = db.Column(db.String(200))


class Palete(db.Model):
    __tablename__ = 'palete'

    id = db.Column(db.Integer, primary_key=True)
    etiqueta = db.Column(db.String(22), unique=True, nullable=False)    # codigo de barras do palete (22 caracteres)
    nota_id = db.Column(db.Integer, db.ForeignKey('nota_fiscal.id'), index=True)
    endereco_id = db.Column(db.Integer, db.ForeignKey('endereco.id'), index=True)        # onde esta agora
    endereco = db.relationship('Endereco', foreign_keys=[endereco_id])
    sugerido_id = db.Column(db.Integer, db.ForeignKey('endereco.id'))                    # indicacao de guarda
    sugerido = db.relationship('Endereco', foreign_keys=[sugerido_id])
    status = db.Column(db.String(20), nullable=False, default='Aguardando guarda', index=True)
    # Aguardando guarda -> Armazenado <-> Stage -> Expedido (saiu numa carga)
    # | Fora (saiu e pode voltar) | Baixado (removido do estoque)
    classificacao = db.Column(db.String(20), nullable=False, default='Bom')
    up = db.Column(db.String(20))               # unidade de palete informada na conferencia
    motivo = db.Column(db.String(200))          # motivo da saida ou da baixa
    criado_por = db.Column(db.String(80))
    criado_em = db.Column(db.DateTime, nullable=False, default=agora)
    armazenado_em = db.Column(db.DateTime)
    carga_id = db.Column(db.Integer, db.ForeignKey('carga.id'), index=True)   # separado para esta carga (saida)
    itens = db.relationship('PaleteItem', backref='palete', cascade='all, delete-orphan')


class PaleteItem(db.Model):
    __tablename__ = 'palete_item'

    id = db.Column(db.Integer, primary_key=True)
    palete_id = db.Column(db.Integer, db.ForeignKey('palete.id'), nullable=False, index=True)
    produto_id = db.Column(db.Integer, db.ForeignKey('produto.id'), nullable=False, index=True)
    produto = db.relationship('Produto')
    nota_item_id = db.Column(db.Integer, db.ForeignKey('nota_item.id'), index=True)
    lote = db.Column(db.String(30))
    fabricacao = db.Column(db.Date)
    validade = db.Column(db.Date)
    quantidade = db.Column(db.Float, nullable=False)


class Movimentacao(db.Model):
    """Historico unico de tudo o que acontece com um palete (entrada, guarda, movimentacao e saida)."""
    __tablename__ = 'movimentacao'

    id = db.Column(db.Integer, primary_key=True)
    palete_id = db.Column(db.Integer, db.ForeignKey('palete.id'), nullable=False, index=True)
    palete = db.relationship('Palete', backref=db.backref('movimentacoes', order_by='Movimentacao.id',
                                                          cascade='all, delete-orphan'))
    tipo = db.Column(db.String(20), nullable=False)     # Entrada / Guarda / Transferência / Stage / Saída / Retorno / Baixa
    origem = db.Column(db.String(16))                   # codigo do endereco de onde saiu (texto: sobrevive a exclusao)
    destino = db.Column(db.String(16))
    motivo = db.Column(db.String(200))
    observacao = db.Column(db.String(300))
    usuario = db.Column(db.String(80), nullable=False)
    criado_em = db.Column(db.DateTime, nullable=False, default=agora, index=True)


# ---------------------------------------------------------------- Passo 3: saida (expedicao)

class Carga(db.Model):
    """Uma viagem / roteiro de expedicao: junta as notas de saida que vao no mesmo veiculo."""
    __tablename__ = 'carga'

    id = db.Column(db.Integer, primary_key=True)
    codigo = db.Column(db.String(20), unique=True, nullable=False)     # ID da viagem / roteiro
    status = db.Column(db.String(15), nullable=False, default='Aberta', index=True)
    # Aberta -> Em separação -> Em conferência -> Expedida | Cancelada
    motivo = db.Column(db.String(30), nullable=False, default='Venda')
    data_expedicao = db.Column(db.Date)
    doca = db.Column(db.String(10))
    placa = db.Column(db.String(8))
    motorista = db.Column(db.String(120))
    coordenador = db.Column(db.String(120))
    conferente = db.Column(db.String(120))
    ajudantes = db.Column(db.String(200))
    observacao = db.Column(db.String(300))
    inicio_conferencia = db.Column(db.DateTime)
    fim_conferencia = db.Column(db.DateTime)
    criado_por = db.Column(db.String(80))
    criado_em = db.Column(db.DateTime, nullable=False, default=agora)
    itens = db.relationship('CargaItem', backref='carga', cascade='all, delete-orphan', order_by='CargaItem.id')
    paletes = db.relationship('Palete', backref='carga', order_by='Palete.id')


class NfSaida(db.Model):
    """XML de uma NF de saida (a que entrou numa carga por XML), guardado para gerar o PDF dela (DANFE)."""
    __tablename__ = 'nf_saida'

    id = db.Column(db.Integer, primary_key=True)
    chave = db.Column(db.String(44), unique=True, nullable=False)
    numero = db.Column(db.String(15), index=True)
    xml = db.deferred(db.Column(db.Text))
    criado_em = db.Column(db.DateTime, nullable=False, default=agora)


class CargaItem(db.Model):
    """Linha do romaneio: um produto de uma nota fiscal de saida, com o esperado e o conferido."""
    __tablename__ = 'carga_item'

    id = db.Column(db.Integer, primary_key=True)
    carga_id = db.Column(db.Integer, db.ForeignKey('carga.id'), nullable=False, index=True)
    nf_numero = db.Column(db.String(15), index=True)
    nf_serie = db.Column(db.String(5))
    nf_chave = db.Column(db.String(44), index=True)
    cliente = db.Column(db.String(150))
    cidade = db.Column(db.String(80))
    produto_id = db.Column(db.Integer, db.ForeignKey('produto.id'), nullable=False, index=True)
    produto = db.relationship('Produto')
    unidade = db.Column(db.String(6))
    quantidade = db.Column(db.Float, nullable=False)                   # quantidade da nota
    conferido = db.Column(db.Float, nullable=False, default=0)         # bipado no carregamento
    motivo_divergencia = db.Column(db.String(200))
    tarefas = db.relationship('Separacao', backref='item', cascade='all, delete-orphan')


class Separacao(db.Model):
    """Tarefa de separacao: tirar uma quantidade de um palete e levar ao stage."""
    __tablename__ = 'separacao'

    id = db.Column(db.Integer, primary_key=True)
    carga_item_id = db.Column(db.Integer, db.ForeignKey('carga_item.id'), nullable=False, index=True)
    palete_id = db.Column(db.Integer, db.ForeignKey('palete.id'), nullable=False, index=True)
    palete = db.relationship('Palete')
    palete_item_id = db.Column(db.Integer, db.ForeignKey('palete_item.id'), nullable=False)
    palete_item = db.relationship('PaleteItem')
    origem = db.Column(db.String(16))                # endereco de onde sai (texto: continua valendo depois da movimentacao)
    quantidade = db.Column(db.Float, nullable=False)
    status = db.Column(db.String(10), nullable=False, default='Pendente', index=True)    # Pendente / Separado
    usuario = db.Column(db.String(80))
    separado_em = db.Column(db.DateTime)


# ---------------------------------------------------------------- Passo 4: inventario

class Inventario(db.Model):
    """Um inventario: fotografia do estoque no momento em que foi iniciado + o que foi contado."""
    __tablename__ = 'inventario'

    id = db.Column(db.Integer, primary_key=True)
    descricao = db.Column(db.String(120), nullable=False)
    camara_id = db.Column(db.Integer, db.ForeignKey('camara.id'))          # vazio = estoque inteiro
    camara = db.relationship('Camara')
    status = db.Column(db.String(15), nullable=False, default='Ativo', index=True)   # Ativo -> Em andamento -> Finalizado
    cego = db.Column(db.Boolean, nullable=False, default=False)            # quem conta nao ve o esperado
    aplicado = db.Column(db.Boolean, nullable=False, default=False)        # as contagens corrigiram o estoque
    criado_por = db.Column(db.String(80))
    criado_em = db.Column(db.DateTime, nullable=False, default=agora)
    finalizado_por = db.Column(db.String(80))
    finalizado_em = db.Column(db.DateTime)
    linhas = db.relationship('InventarioLinha', backref='inventario', cascade='all, delete-orphan')


class InventarioLinha(db.Model):
    """Uma linha do inventario: o que o sistema tinha (fotografia) e o que foi contado (bip_*).

    Os dados da fotografia sao copiados em texto, para o resultado continuar valendo mesmo que o palete saia depois.
    status: Pendente -> Conferido (tudo igual) | Divergente (alguma diferenca) | Extra (nao estava na fotografia).
    """
    __tablename__ = 'inventario_linha'

    id = db.Column(db.Integer, primary_key=True)
    inventario_id = db.Column(db.Integer, db.ForeignKey('inventario.id'), nullable=False, index=True)
    palete_item_id = db.Column(db.Integer, index=True)       # sem chave estrangeira: o item pode deixar de existir
    palete_etiqueta = db.Column(db.String(22), index=True)
    endereco = db.Column(db.String(16), index=True)
    camara_nome = db.Column(db.String(80))
    produto_id = db.Column(db.Integer, db.ForeignKey('produto.id'), nullable=False)
    produto = db.relationship('Produto')
    sku = db.Column(db.String(40), nullable=False, index=True)
    descricao = db.Column(db.String(200))
    unidade = db.Column(db.String(6))
    classificacao = db.Column(db.String(20))
    lote = db.Column(db.String(30))
    fabricacao = db.Column(db.Date)
    validade = db.Column(db.Date)
    quantidade_esperada = db.Column(db.Float)
    up = db.Column(db.String(20))
    status = db.Column(db.String(12), nullable=False, default='Pendente', index=True)
    bip_sku = db.Column(db.String(40))
    bip_lote = db.Column(db.String(30))
    bip_fabricacao = db.Column(db.Date)
    bip_validade = db.Column(db.Date)
    bip_quantidade = db.Column(db.Float)
    bip_up = db.Column(db.String(20))
    observacao = db.Column(db.String(200))
    contado_por = db.Column(db.String(80))
    contado_em = db.Column(db.DateTime, index=True)

    @property
    def diferenca(self):
        """Contado menos sistema (extra conta inteiro; pendente nao tem diferenca)."""
        if self.bip_quantidade is None:
            return 0
        return round(self.bip_quantidade - (self.quantidade_esperada or 0), 3)


# ---------------------------------------------------------------- Passo 5: agendamento e ocorrencias

class Agendamento(db.Model):
    """Entrada, saida ou retorno marcado para um dia (e, se quiser, hora e doca).

    origem / id_externo: preparados para uma integracao futura (ex.: Doca Livre YMS) criar ou atualizar o registro
    sem duplicar. O que nasce nesta tela tem origem 'WMS' e id_externo vazio.
    """
    __tablename__ = 'agendamento'
    __table_args__ = (db.UniqueConstraint('origem', 'id_externo', name='uq_agendamento_externo'),)

    id = db.Column(db.Integer, primary_key=True)
    origem = db.Column(db.String(20), nullable=False, default='WMS')
    id_externo = db.Column(db.String(60))
    tipo = db.Column(db.String(10), nullable=False, default='Entrada')          # Entrada / Saída / Retorno
    data = db.Column(db.Date, nullable=False, index=True)
    hora = db.Column(db.String(5))                                             # HH:MM
    doca = db.Column(db.String(10))
    status = db.Column(db.String(16), nullable=False, default='Agendado', index=True)
    # Agendado -> No pátio -> Em operação -> Concluído | Não compareceu | Cancelado
    cliente = db.Column(db.String(150), nullable=False)
    nf_numero = db.Column(db.String(15), index=True)
    pedido = db.Column(db.String(30))
    transportadora = db.Column(db.String(150))
    placa = db.Column(db.String(8))
    motorista = db.Column(db.String(120))
    volumes = db.Column(db.Float)
    peso = db.Column(db.Float)
    protocolo = db.Column(db.String(40))
    observacao = db.Column(db.String(300))
    chegada_em = db.Column(db.DateTime)
    inicio_em = db.Column(db.DateTime)
    fim_em = db.Column(db.DateTime)
    criado_por = db.Column(db.String(80))
    criado_em = db.Column(db.DateTime, nullable=False, default=agora)


class Ocorrencia(db.Model):
    """Problema de um agendamento ou de uma nota (atraso, avaria, falta...). Fica aberta ate alguem resolver."""
    __tablename__ = 'ocorrencia'
    __table_args__ = (db.UniqueConstraint('origem', 'id_externo', name='uq_ocorrencia_externo'),)

    id = db.Column(db.Integer, primary_key=True)
    origem = db.Column(db.String(20), nullable=False, default='WMS')          # 'WMS' ou o sistema de fora que mandou
    id_externo = db.Column(db.String(60))
    agendamento_id = db.Column(db.Integer, db.ForeignKey('agendamento.id'), index=True)
    agendamento = db.relationship('Agendamento', backref=db.backref('ocorrencias', cascade='all, delete-orphan'))
    nf_numero = db.Column(db.String(15), index=True)
    tipo = db.Column(db.String(30), nullable=False)
    descricao = db.Column(db.String(500), nullable=False)
    status = db.Column(db.String(10), nullable=False, default='Aberta', index=True)      # Aberta / Resolvida
    resolucao = db.Column(db.String(300))
    criado_por = db.Column(db.String(80))
    criado_em = db.Column(db.DateTime, nullable=False, default=agora)
    resolvido_por = db.Column(db.String(80))
    resolvido_em = db.Column(db.DateTime)


# ---------------------------------------------------------------- Passo 6: financeiro

class TabelaCobranca(db.Model):
    """Precos da armazenagem. Posicao, quilo e palete valem por ciclo (mes ou quinzena); entrada e saida, por palete."""
    __tablename__ = 'tabela_cobranca'

    id = db.Column(db.Integer, primary_key=True)
    nome = db.Column(db.String(80), unique=True, nullable=False)
    custo_posicao = db.Column(db.Float, nullable=False, default=0)
    custo_kilo = db.Column(db.Float, nullable=False, default=0)
    custo_palete = db.Column(db.Float, nullable=False, default=0)
    custo_entrada = db.Column(db.Float, nullable=False, default=0)
    custo_saida = db.Column(db.Float, nullable=False, default=0)
    criado_em = db.Column(db.DateTime, nullable=False, default=agora)


class ContratoCobranca(db.Model):
    """Contrato de armazenagem de um cliente (empresa): qual tabela usa, o ciclo, a regra de tempo e o que cobrar.

    Vale o contrato ativo mais recente de cada empresa.
    """
    __tablename__ = 'contrato_cobranca'

    id = db.Column(db.Integer, primary_key=True)
    empresa_id = db.Column(db.Integer, db.ForeignKey('empresa.id'), nullable=False, index=True)
    empresa = db.relationship('Empresa')
    tabela_id = db.Column(db.Integer, db.ForeignKey('tabela_cobranca.id'), nullable=False, index=True)
    tabela = db.relationship('TabelaCobranca')
    ciclo = db.Column(db.String(10), nullable=False, default='mensal')                 # mensal (30 dias) / quinzenal (15 dias)
    regra_tempo = db.Column(db.String(12), nullable=False, default='proporcional')     # proporcional / cheia
    cobrar_posicao = db.Column(db.Boolean, nullable=False, default=False)
    cobrar_kilo = db.Column(db.Boolean, nullable=False, default=False)
    cobrar_palete = db.Column(db.Boolean, nullable=False, default=False)
    cobrar_entrada = db.Column(db.Boolean, nullable=False, default=False)
    cobrar_saida = db.Column(db.Boolean, nullable=False, default=False)
    ativo = db.Column(db.Boolean, nullable=False, default=True)
    observacao = db.Column(db.String(300))
    criado_em = db.Column(db.DateTime, nullable=False, default=agora)


class FechamentoMensal(db.Model):
    """Valor do mes de um cliente, congelado (ver fechamento.py). "dados" guarda em JSON as linhas por nota e o contrato."""
    __tablename__ = 'fechamento_mensal'
    __table_args__ = (db.UniqueConstraint('empresa_id', 'ano', 'mes', name='uq_fechamento_empresa_mes'),)

    id = db.Column(db.Integer, primary_key=True)
    empresa_id = db.Column(db.Integer, db.ForeignKey('empresa.id'), nullable=False, index=True)
    empresa = db.relationship('Empresa')
    ano = db.Column(db.Integer, nullable=False)
    mes = db.Column(db.Integer, nullable=False)
    inicio = db.Column(db.Date, nullable=False)
    fim = db.Column(db.Date, nullable=False)
    notas = db.Column(db.Integer, nullable=False, default=0)
    armazenagem = db.Column(db.Float, nullable=False, default=0)
    debitos_entrada = db.Column(db.Float, nullable=False, default=0)
    debitos_saida = db.Column(db.Float, nullable=False, default=0)
    total = db.Column(db.Float, nullable=False, default=0)
    dados = db.Column(db.Text, nullable=False)
    observacao = db.Column(db.String(300))
    criado_por = db.Column(db.String(80))
    criado_em = db.Column(db.DateTime, nullable=False, default=agora)


# ---------------------------------------------------------------- Passo 7: hierarquia

class Organizacao(db.Model):
    """No da arvore: Operador Logistico -> Filial Operador / Embarcador -> Unidade -> Transportadora."""
    __tablename__ = 'organizacao'

    id = db.Column(db.Integer, primary_key=True)
    pai_id = db.Column(db.Integer, db.ForeignKey('organizacao.id'), index=True)
    pai = db.relationship('Organizacao', remote_side=[id], backref='filhos')
    tipo = db.Column(db.String(20), nullable=False)
    nome = db.Column(db.String(150), nullable=False)
    cnpj = db.Column(db.String(14), index=True)
    codigo = db.Column(db.String(30))
    fornecedor = db.Column(db.Boolean, nullable=False, default=False)
    empresa_id = db.Column(db.Integer, db.ForeignKey('empresa.id'), index=True)     # o cadastro em Cadastros > Empresas
    empresa = db.relationship('Empresa')
    criado_em = db.Column(db.DateTime, nullable=False, default=agora)


class GrupoHierarquia(db.Model):
    """Grupo de organizacoes que trabalham juntas: compartilham layouts salvos e a lista de clientes."""
    __tablename__ = 'grupo_hierarquia'

    id = db.Column(db.Integer, primary_key=True)
    nome = db.Column(db.String(80), unique=True, nullable=False)
    descricao = db.Column(db.String(200))
    criado_em = db.Column(db.DateTime, nullable=False, default=agora)
    membros = db.relationship('GrupoMembro', backref='grupo', cascade='all, delete-orphan', order_by='GrupoMembro.id')


class GrupoMembro(db.Model):
    __tablename__ = 'grupo_membro'
    __table_args__ = (db.UniqueConstraint('grupo_id', 'organizacao_id', name='uq_grupo_membro'),)

    id = db.Column(db.Integer, primary_key=True)
    grupo_id = db.Column(db.Integer, db.ForeignKey('grupo_hierarquia.id'), nullable=False, index=True)
    organizacao_id = db.Column(db.Integer, db.ForeignKey('organizacao.id'), nullable=False, index=True)
    organizacao = db.relationship('Organizacao', foreign_keys=[organizacao_id],
                                  backref=db.backref('participacoes', cascade='all, delete-orphan'))
    pai_id = db.Column(db.Integer, db.ForeignKey('organizacao.id'))             # "pai no grupo" (opcional)
    pai = db.relationship('Organizacao', foreign_keys=[pai_id])


# ---------------------------------------------------------------- auditoria

class LogAcao(db.Model):
    __tablename__ = 'log_acao'

    id = db.Column(db.Integer, primary_key=True)
    usuario = db.Column(db.String(80), nullable=False)
    modulo = db.Column(db.String(30))
    acao = db.Column(db.String(80), nullable=False)
    detalhe = db.Column(db.Text)
    criado_em = db.Column(db.DateTime, nullable=False, default=agora, index=True)

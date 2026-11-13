"""Regras de palete usadas pela entrada, pela movimentacao e pelo mapa:
etiqueta de 22 caracteres, ocupacao de endereco, indicacao de guarda e registro de movimentacao."""
import secrets
import string
from datetime import datetime, timezone

from .core import usuario_atual
from .sistema import politica_separacao
from .models import Camara, Endereco, Movimentacao, Palete, agora, db

CLASSIFICACOES = ['Bom', 'Avaria', 'Descarte / Perdas', 'Palete bloqueado']
# No retorno existe mais uma: Reentrega = voltou da rua e espera sair de novo para o mesmo cliente.
CLASSIFICACOES_RETORNO = ['Reentrega'] + CLASSIFICACOES
MOTIVOS_RETORNO = ['Cliente ausente', 'Recusa do cliente', 'Endereço não localizado', 'Fora do horário de recebimento',
                   'Falta de agendamento', 'Avaria no transporte', 'Divergência de pedido', 'Devolução do cliente', 'Outro']
# Classificacao -> trecho que identifica o destino fixo do endereco (areas especiais do layout).
DESTINO_DA_CLASSIFICACAO = {'Avaria': 'AVARIA', 'Descarte / Perdas': 'DESCARTE', 'Palete bloqueado': 'BLOQUEADO',
                            'Reentrega': 'REENTREGA'}
NO_ARMAZEM = ('Armazenado', 'Stage')          # status em que o palete ocupa um endereco

MOTIVOS_SAIDA = ['Expedição', 'Transferência', 'Auditoria', 'Manutenção', 'Outro']
MOTIVOS_BAIXA = ['NF incorreta', 'Endereçamento incorreto', 'Entrada duplicada', 'Dados do item incorretos',
                 'XML com erro', 'Quantidade incorreta', 'Entrada indevida', 'Outro']


def gerar_etiqueta():
    """Etiqueta do palete com exatamente 22 caracteres: UP + data/hora + sorteio (padrao do WMS Pro)."""
    prefixo = 'UP' + datetime.now(timezone.utc).strftime('%y%m%d%H%M')
    while True:
        etiqueta = prefixo + ''.join(secrets.choice(string.digits + string.ascii_uppercase)
                                     for _ in range(22 - len(prefixo)))
        if not Palete.query.filter_by(etiqueta=etiqueta).first():
            return etiqueta


def palete_no_endereco(endereco_id):
    return Palete.query.filter(Palete.endereco_id == endereco_id, Palete.status.in_(NO_ARMAZEM)).first()


def _indisponiveis(ignorar_palete_id=None):
    """Duas subconsultas: enderecos ocupados por um palete e enderecos ja indicados para outro a caminho."""
    ocupados = db.select(Palete.endereco_id).where(Palete.endereco_id.isnot(None), Palete.status.in_(NO_ARMAZEM))
    reservados = db.select(Palete.sugerido_id).where(Palete.sugerido_id.isnot(None),
                                                     Palete.status == 'Aguardando guarda')
    if ignorar_palete_id:
        reservados = reservados.where(Palete.id != ignorar_palete_id)
    return ocupados, reservados


def empresa_do_palete(palete):
    """Dono da mercadoria do palete: quem emitiu a nota; sem nota, o depositante do produto."""
    if palete.nota and palete.nota.empresa:
        return palete.nota.empresa
    return next((i.produto.depositante for i in palete.itens if i.produto.depositante), None)


def categoria_do_palete(palete):
    """Categoria (Congelado / Resfriado / Seco) do produto do palete; None quando o cadastro nao informa."""
    return next((i.produto.categoria for i in palete.itens if i.produto.categoria), None)


def data_fifo(palete):
    """Data que ordena a fila de saida do palete.

    FEFO: a validade mais proxima; palete sem validade cai na regra do FIFO.
    FIFO: a fabricacao mais antiga do palete; sem fabricacao, o dia em que ele entrou."""
    if politica_separacao() == 'FEFO':
        validades = [i.validade for i in palete.itens if i.validade]
        if validades:
            return min(validades)
    datas = [i.fabricacao for i in palete.itens if i.fabricacao]
    return min(datas) if datas else (palete.criado_em or agora()).date()


def validar_destino(endereco, palete):
    """Devolve a mensagem de erro se o palete nao pode ir para o endereco; None se pode.

    Vale o que foi definido na camara: espaco de cliente, categoria da camara, bloqueio e ocupacao.
    """
    if endereco.cliente_id:
        dono = empresa_do_palete(palete)
        if not dono or dono.id != endereco.cliente_id:
            reservado = endereco.cliente.fantasia or endereco.cliente.nome
            return f'O endereço {endereco.codigo} é espaço reservado para {reservado}.'
    if endereco.bloqueado:
        return f'O endereço {endereco.codigo} está bloqueado' + (f' ({endereco.motivo_bloqueio}).' if endereco.motivo_bloqueio else '.')
    if not endereco.camara.ativo:
        return f'A câmara do endereço {endereco.codigo} está inativa.'
    if endereco.camara.tipo == 'Stage':
        return None      # o stage aceita varios paletes na mesma vaga
    # Categoria da camara: camara de Congelado so guarda produto Congelado (e assim por diante). Camara sem categoria
    # aceita qualquer produto; produto sem categoria no cadastro nao e barrado (o sistema nao tem como saber).
    categoria = categoria_do_palete(palete)
    if endereco.camara.categoria and categoria and endereco.camara.categoria != categoria and not endereco.destino_fixo:
        return (f'A {endereco.camara.nome} é de {endereco.camara.categoria} e o produto deste palete é {categoria}. '
                'Escolha um endereço numa câmara da mesma categoria.')
    ocupante = palete_no_endereco(endereco.id)
    if ocupante and ocupante.id != palete.id:
        return f'O endereço {endereco.codigo} já está ocupado pelo palete {ocupante.etiqueta}.'
    reservado = Palete.query.filter(Palete.sugerido_id == endereco.id, Palete.status == 'Aguardando guarda',
                                    Palete.id != palete.id).first()
    if reservado:
        return f'O endereço {endereco.codigo} já está indicado para o palete {reservado.etiqueta}.'
    return None


def _nivel_fifo_vertical(data_nova, ocupados, livres):
    """FIFO vertical numa coluna: lote mais antigo embaixo, mais novo em cima (como no WMS Pro).

    ocupados = {nivel: data}; livres = niveis vagos. Devolve o nivel vago que respeita essa ordem; se nenhum respeitar,
    o mais alto quando o palete e o mais novo da coluna, senao o mais baixo.
    """
    livres = sorted(livres)
    if not ocupados:
        return livres[0]
    bons = [n for n in livres
            if not any((nivel < n and data_nova < data) or (nivel > n and data_nova > data) for nivel, data in ocupados.items())]
    if bons:
        return bons[-1]
    return livres[-1] if data_nova >= max(ocupados.values()) else livres[0]


def sugerir_endereco(palete, motivos=None):
    """Indicacao de guarda, pelas regras definidas na camara + FIFO. "motivos" (lista) recebe o porque da escolha.

    Avaria / descarte / bloqueado / reentrega: area reservada para esse destino (enderecos de destino fixo).
    Estoque bom:
      1. so camara de armazenagem ativa, endereco livre, nao bloqueado e sem destino fixo;
      2. espaco de cliente: primeiro o espaco do dono da mercadoria, depois o de uso livre; nunca o de outro cliente;
      3. categoria: so camara da categoria do produto (ou camara sem categoria);
      4. pulmao primeiro; picking quando nao ha pulmao livre;
      5. mesmo produto junto: na rua do mesmo lote (coluna mais perto) ou, senao, na rua onde o produto mais esta;
      6. FIFO vertical na coluna: lote mais antigo embaixo, mais novo em cima.
    """
    motivos = motivos if motivos is not None else []
    ocupados, reservados = _indisponiveis(palete.id)
    livres = (Endereco.query.join(Camara)
              .filter(Camara.ativo.is_(True), Endereco.bloqueado.is_(False),
                      Endereco.id.notin_(ocupados), Endereco.id.notin_(reservados)))
    trecho = DESTINO_DA_CLASSIFICACAO.get(palete.classificacao)
    if trecho:
        vaga = (livres.filter(Endereco.destino_fixo.is_(True), db.func.upper(Endereco.destino).like(f'%{trecho}%'))
                .order_by(Camara.codigo, Endereco.rua, Endereco.coluna, Endereco.nivel).first())
        if not vaga:
            # Area reservada cheia (ou inexistente): posicao comum que leva o mesmo rotulo de destino.
            vaga = (livres.filter(Endereco.destino_fixo.is_(False), db.func.upper(Endereco.destino).like(f'%{trecho}%'))
                    .order_by(Camara.codigo, Endereco.rua, Endereco.coluna, Endereco.nivel).first())
        if vaga:
            motivos.append(f'área de {palete.classificacao.lower()}')
            return vaga
    categoria = categoria_do_palete(palete)
    normais = livres.filter(Camara.tipo == 'Armazenagem', Endereco.destino_fixo.is_(False))
    dono = empresa_do_palete(palete)
    if dono:
        normais = normais.filter(db.or_(Endereco.cliente_id.is_(None), Endereco.cliente_id == dono.id))
    else:
        normais = normais.filter(Endereco.cliente_id.is_(None))
    if categoria:
        normais = normais.filter(db.or_(Camara.categoria.is_(None), Camara.categoria == categoria))
    vagas = normais.all()
    if not vagas:
        return None

    # Onde este produto ja esta guardado (para juntar) e a data de cada posicao ocupada (para o FIFO vertical).
    produtos = {i.produto_id for i in palete.itens}
    lotes = {i.lote for i in palete.itens if i.lote}
    rua_do_lote, por_rua, datas = None, {}, {}
    guardados = (db.session.query(Palete, Endereco).join(Endereco, Palete.endereco_id == Endereco.id)
                 .filter(Palete.status == 'Armazenado', Palete.id != palete.id, Endereco.camara_id.in_({v.camara_id for v in vagas})))
    for outro, onde in guardados:
        datas.setdefault((onde.camara_id, onde.rua, onde.coluna), {})[onde.nivel] = data_fifo(outro)
        if produtos & {i.produto_id for i in outro.itens}:
            por_rua[(onde.camara_id, onde.rua)] = por_rua.get((onde.camara_id, onde.rua), 0) + 1
            if rua_do_lote is None and lotes & {i.lote for i in outro.itens if i.lote}:
                rua_do_lote = (onde.camara_id, onde.rua, onde.coluna)
    rua_do_produto = max(por_rua, key=por_rua.get) if por_rua else None
    nova = data_fifo(palete)

    def prioridade(vaga):
        """Menor = melhor. A ordem das regras e a ordem dos campos."""
        rua = (vaga.camara_id, vaga.rua)
        return (0 if vaga.cliente_id else 1,
                0 if categoria and vaga.camara.categoria == categoria else 1,
                0 if vaga.tipo == 'Pulmão' else 1,
                0 if rua_do_lote and rua == rua_do_lote[:2] else 1,
                abs(vaga.coluna - rua_do_lote[2]) if rua_do_lote and rua == rua_do_lote[:2] else 0,
                0 if rua == rua_do_produto else 1,
                vaga.camara.codigo, vaga.rua, vaga.coluna)

    # A melhor coluna pelas regras; dentro dela, o nivel do FIFO vertical (entre os vagos do mesmo tipo e do mesmo dono).
    melhor = min(vagas, key=lambda v: (prioridade(v), v.nivel))
    coluna = (melhor.camara_id, melhor.rua, melhor.coluna)
    iguais = {v.nivel: v for v in vagas if (v.camara_id, v.rua, v.coluna) == coluna and prioridade(v) == prioridade(melhor)}
    escolhida = iguais[_nivel_fifo_vertical(nova, datas.get(coluna, {}), list(iguais))]

    if escolhida.cliente_id:
        motivos.append('espaço do cliente')
    if categoria and escolhida.camara.categoria == categoria:
        motivos.append(f'câmara de {categoria}')
    motivos.append(escolhida.tipo.lower() if escolhida.tipo == 'Pulmão' else 'picking (sem pulmão livre)')
    if rua_do_lote and (escolhida.camara_id, escolhida.rua) == rua_do_lote[:2]:
        motivos.append('junto do mesmo lote')
    elif (escolhida.camara_id, escolhida.rua) == rua_do_produto:
        motivos.append('na rua onde o produto já está')
    if datas.get(coluna):
        motivos.append('FEFO: o que vence primeiro embaixo' if politica_separacao() == 'FEFO'
                       else 'FIFO: mais antigo embaixo, mais novo em cima')
    return escolhida


def vaga_no_stage():
    return (Endereco.query.join(Camara)
            .filter(Camara.tipo == 'Stage', Camara.ativo.is_(True), Endereco.bloqueado.is_(False))
            .order_by(Camara.codigo, Endereco.rua, Endereco.coluna, Endereco.nivel).first())


def registrar(palete, tipo, origem=None, destino=None, motivo=None, observacao=None):
    user = usuario_atual()
    db.session.add(Movimentacao(palete=palete, tipo=tipo, origem=origem.codigo if origem else None,
                                destino=destino.codigo if destino else None, motivo=motivo or None,
                                observacao=(observacao or '').strip()[:300] or None,
                                usuario=user.username if user else 'sistema'))


def colocar_em(palete, endereco, tipo, motivo=None, observacao=None):
    """Poe o palete no endereco (ja validado) e registra a movimentacao."""
    origem = palete.endereco
    palete.endereco = endereco
    palete.sugerido = None
    palete.status = 'Stage' if endereco.camara.tipo == 'Stage' else 'Armazenado'
    if not palete.armazenado_em:
        palete.armazenado_em = agora()
    registrar(palete, tipo, origem=origem, destino=endereco, motivo=motivo, observacao=observacao)


def tirar_do_armazem(palete, status, tipo, motivo=None, observacao=None):
    """Libera o endereco: status 'Fora' (pode voltar) ou 'Baixado' (removido do estoque)."""
    origem = palete.endereco
    palete.endereco = None
    palete.sugerido = None
    palete.status = status
    palete.motivo = motivo
    registrar(palete, tipo, origem=origem, motivo=motivo, observacao=observacao)


def localizar_palete(texto):
    """Acha o palete pela etiqueta ou pelo endereco onde ele esta. Devolve (palete, erro)."""
    from .enderecamento import localizar_endereco   # evita importacao circular
    texto = (texto or '').strip().upper()
    if not texto:
        return None, 'Informe a etiqueta do palete ou o endereço onde ele está.'
    palete = Palete.query.filter_by(etiqueta=texto).first()
    if palete:
        return palete, None
    endereco, erro = localizar_endereco(texto)
    if not endereco:
        return None, f'"{texto}" não é uma etiqueta de palete conhecida nem um endereço ({erro})'
    palete = palete_no_endereco(endereco.id)
    if not palete:
        return None, f'Não há palete no endereço {endereco.codigo}.'
    return palete, None


def resumo_itens(palete):
    """Texto curto do conteudo do palete para listas: 'P0001 · 40 CX'."""
    partes = [f'{i.produto.sku} · {i.quantidade:g} {i.produto.unidade}' for i in palete.itens]
    return ' + '.join(partes) or '—'

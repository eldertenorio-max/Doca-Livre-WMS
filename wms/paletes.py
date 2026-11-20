"""Regras de palete usadas pela entrada, pela movimentacao e pelo mapa:
etiqueta de 22 caracteres, ocupacao de endereco, indicacao de guarda e registro de movimentacao."""
import secrets
import string
from datetime import datetime, timezone

from .core import usuario_atual
from .sistema import politica_separacao
from .models import Camara, Empresa, Endereco, Movimentacao, NotaFiscal, Palete, agora, db

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


def embarcador_de(empresa):
    """Dono da mercadoria: o embarcador a que a empresa esta ligada (Cadastros > Empresas); sem ligacao, ela mesma."""
    vistos = set()
    while empresa is not None and empresa.embarcador_id and empresa.id not in vistos and empresa.embarcador is not None:
        vistos.add(empresa.id)
        empresa = empresa.embarcador
    return empresa


def mesmo_embarcador(a, b):
    """True quando as duas empresas sao a mesma ou remetem mercadoria do mesmo embarcador."""
    if a is None or b is None:
        return False
    return a.id == b.id or embarcador_de(a).id == embarcador_de(b).id


def empresas_do_embarcador(empresa):
    """Ids de todas as empresas do mesmo embarcador: a principal e as que remetem mercadoria dele."""
    raiz = embarcador_de(empresa)
    ids = novos = {raiz.id}
    while novos:
        novos = {i for (i,) in db.session.query(Empresa.id).filter(Empresa.embarcador_id.in_(novos))} - ids
        ids = ids | novos
    return ids


def vincular_embarcador(empresa, outra):
    """Aprende que as duas empresas sao do mesmo embarcador e devolve a principal.

    Chamado quando alguem confirma isso na conferencia (juntar num palete de outra empresa ou guardar num espaco
    reservado para outra). Fica como principal a que tem espaco reservado na camara; sem isso, a que ja era a dona
    do palete ou do espaco (`outra`). Da para ver e desfazer em Cadastros > Empresas, campo Embarcador."""
    a, b = embarcador_de(empresa), embarcador_de(outra)
    if a.id == b.id:
        return a

    def tem_espaco(e):
        return db.session.query(Endereco.id).filter(Endereco.cliente_id.in_(empresas_do_embarcador(e))).first() is not None

    principal, ligada = (a, b) if tem_espaco(a) and not tem_espaco(b) else (b, a)
    ligada.embarcador = principal
    ligada.embarcador_id = principal.id      # ja vale nesta mesma requisicao, antes de gravar no banco
    return principal


def reserva_de_outro(endereco, palete):
    """Empresa para quem o endereco esta reservado, quando ela nao e do mesmo embarcador da mercadoria do palete.
    None quando o palete pode usar o espaco (endereco de uso livre ou reservado para o proprio embarcador)."""
    if endereco is None or not endereco.cliente_id:
        return None
    dono = empresa_do_palete(palete)
    return None if (dono and mesmo_embarcador(dono, endereco.cliente)) else endereco.cliente


def ultima_posicao_do_embarcador(empresa, menos_palete_id=None):
    """Endereco do palete que o embarcador guardou por ultimo (e que continua no armazem); None se nao ha nenhum.
    A conferencia mostra essa posicao quando ela e diferente da indicada, para a carga do mesmo dono ficar junta."""
    if empresa is None:
        return None
    consulta = (Palete.query.join(NotaFiscal, Palete.nota_id == NotaFiscal.id)
                .filter(NotaFiscal.empresa_id.in_(empresas_do_embarcador(empresa)), Palete.status == 'Armazenado',
                        Palete.endereco_id.isnot(None)))
    if menos_palete_id:
        consulta = consulta.filter(Palete.id != menos_palete_id)
    ultimo = consulta.order_by(Palete.armazenado_em.desc(), Palete.id.desc()).first()
    return ultimo.endereco if ultimo else None


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
    reservado = reserva_de_outro(endereco, palete)
    if reservado:
        dono = empresa_do_palete(palete)
        return (f'O endereço {endereco.codigo} é espaço reservado para {reservado.fantasia or reservado.nome}'
                + (f' e a mercadoria deste palete é de {dono.fantasia or dono.nome}. Se forem do mesmo embarcador, indique o '
                   'endereço pela tela da nota (ela pergunta e o sistema grava) ou marque "Agrupa endereços" em Cadastros › Empresas.'
                   if dono else '.'))
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
        return (f'A {endereco.camara.rotulo} é de {endereco.camara.categoria} e o produto deste palete é {categoria}. '
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

    ocupados = {nivel: data}; livres = niveis vagos. Devolve o nivel vago que respeita essa ordem, encostado no que
    ja esta na coluna (o mais novo entra logo acima do ultimo, deixando os niveis de cima para os proximos, que serao
    mais novos ainda). Se nenhum respeitar, o mais alto quando o palete e o mais novo da coluna, senao o mais baixo.
    """
    livres = sorted(livres)
    if not ocupados:
        return livres[0]
    bons = [n for n in livres
            if not any((nivel < n and data_nova < data) or (nivel > n and data_nova > data) for nivel, data in ocupados.items())]
    if bons:
        return min(bons, key=lambda n: (min(abs(n - nivel) for nivel in ocupados), n))
    return livres[-1] if data_nova >= max(ocupados.values()) else livres[0]


def sugerir_endereco(palete, motivos=None):
    """Indicacao de guarda, pelas regras definidas na camara + FIFO. "motivos" (lista) recebe o porque da escolha.

    Avaria / descarte / bloqueado / reentrega: area reservada para esse destino (enderecos de destino fixo).
    Estoque bom:
      1. so camara de armazenagem ativa, endereco livre, nao bloqueado e sem destino fixo;
      2. espaco de cliente: primeiro o espaco do dono da mercadoria, depois o de uso livre; nunca o de outro cliente;
      3. categoria: so camara da categoria do produto (ou camara sem categoria);
      4. pulmao primeiro; picking quando nao ha pulmao livre;
      5. mesmo produto sempre junto: na rua do mesmo lote ou, senao, na rua onde o produto ja esta, na coluna mais
         perto dele (a propria coluna, depois as vizinhas); rua cheia, vai para a mesma camara. Contam os paletes
         guardados e os da mesma descarga que ainda aguardam guarda (pela posicao indicada). Produto que ainda nao
         esta no armazem comeca numa coluna vazia, sem misturar na coluna de outro produto enquanto houver espaco;
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
        # espaco do proprio embarcador: vale o reservado para qualquer empresa dele (ex.: outro CNPJ do mesmo cliente)
        normais = normais.filter(db.or_(Endereco.cliente_id.is_(None), Endereco.cliente_id.in_(empresas_do_embarcador(dono))))
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
    # Vale o palete guardado e tambem o que ainda aguarda guarda com posicao indicada (os outros da mesma descarga).
    colunas_do_lote, colunas_do_produto, camaras_do_produto, datas, de_outro_produto = {}, {}, set(), {}, set()
    camaras = {v.camara_id for v in vagas}
    guardados = (db.session.query(Palete, Endereco).join(Endereco, Palete.endereco_id == Endereco.id)
                 .filter(Palete.status == 'Armazenado', Palete.id != palete.id, Endereco.camara_id.in_(camaras)).all())
    indicados = (db.session.query(Palete, Endereco).join(Endereco, Palete.sugerido_id == Endereco.id)
                 .filter(Palete.status == 'Aguardando guarda', Palete.id != palete.id, Endereco.camara_id.in_(camaras)).all())
    for outro, onde in guardados + indicados:
        datas.setdefault((onde.camara_id, onde.rua, onde.coluna), {})[onde.nivel] = data_fifo(outro)
        if produtos & {i.produto_id for i in outro.itens}:
            colunas_do_produto.setdefault((onde.camara_id, onde.rua), set()).add(onde.coluna)
            camaras_do_produto.add(onde.camara_id)
            if lotes & {i.lote for i in outro.itens if i.lote}:
                colunas_do_lote.setdefault((onde.camara_id, onde.rua), set()).add(onde.coluna)
        else:
            de_outro_produto.add((onde.camara_id, onde.rua, onde.coluna))
    nova = data_fifo(palete)

    def distancia(colunas, coluna):
        return min(abs(coluna - c) for c in colunas)

    def prioridade(vaga):
        """Menor = melhor. A ordem das regras e a ordem dos campos."""
        rua = (vaga.camara_id, vaga.rua)
        do_lote, do_produto = colunas_do_lote.get(rua), colunas_do_produto.get(rua)
        return (0 if vaga.cliente_id else 1,
                0 if categoria and vaga.camara.categoria == categoria else 1,
                0 if vaga.tipo == 'Pulmão' else 1,
                0 if do_lote else 1,
                distancia(do_lote, vaga.coluna) if do_lote else 0,
                0 if do_produto else 1,
                distancia(do_produto, vaga.coluna) if do_produto else 0,
                0 if vaga.camara_id in camaras_do_produto else 1,
                # nao mistura na coluna de outro produto enquanto houver coluna vazia (cada produto cresce na sua)
                1 if (vaga.camara_id, vaga.rua, vaga.coluna) in de_outro_produto else 0,
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
    rua_escolhida = (escolhida.camara_id, escolhida.rua)
    if rua_escolhida in colunas_do_lote:
        motivos.append('junto do mesmo lote')
    elif rua_escolhida in colunas_do_produto:
        motivos.append('na rua onde o produto já está')
    elif escolhida.camara_id in camaras_do_produto:
        motivos.append('na câmara onde o produto já está')
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

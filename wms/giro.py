"""Giro dos produtos (curva ABC pelas saidas) e sugestao de troca de endereco para ficar perto da doca.

Saida = tarefa de separacao concluida (o produto saiu do endereco para uma carga). A curva usa a quantidade de
saidas de cada produto nos ultimos 90 dias, nao a quantidade de caixas: e a saida que faz o operador andar, e
unidades diferentes (CX, KG, UN) nao se comparam.
"""
from datetime import timedelta

from .models import CargaItem, Separacao, agora, db
from .paletes import empresa_do_palete, mesmo_embarcador

DIAS = 90
# Medidas usadas so para estimar a caminhada (as mesmas do desenho 3D): passo de uma coluna para a outra,
# de uma rua para a seguinte (estante + corredor) e o custo de subir um nivel.
PASSO_COLUNA, PASSO_RUA, PASSO_NIVEL = 1.25, 4.15, 1.0
GANHO_MINIMO = 0.5          # metros por dia: abaixo disso nao vale sugerir


def giro_dos_produtos(dias=DIAS):
    """produto_id -> {'saidas', 'quantidade', 'por_dia', 'classe'} dos produtos que sairam no periodo.

    Classe: A = os produtos que somam 80% das saidas; B = os 15% seguintes; C = o resto. Produto sem saida
    no periodo nao aparece (fica "sem giro")."""
    desde = agora() - timedelta(days=dias)
    linhas = (db.session.query(CargaItem.produto_id, db.func.count(Separacao.id), db.func.sum(Separacao.quantidade))
              .join(CargaItem, CargaItem.id == Separacao.carga_item_id)
              .filter(Separacao.status == 'Separado', Separacao.separado_em >= desde)
              .group_by(CargaItem.produto_id).all())
    linhas = sorted(linhas, key=lambda l: (-l[1], -(l[2] or 0), l[0]))
    total = sum(l[1] for l in linhas)
    giro, acumulado = {}, 0
    for produto_id, saidas, quantidade in linhas:
        antes = acumulado / total if total else 1
        classe = 'A' if antes < 0.80 else 'B' if antes < 0.95 else 'C'
        acumulado += saidas
        giro[produto_id] = {'saidas': saidas, 'quantidade': round(quantidade or 0, 3),
                            'por_dia': round(saidas / dias, 3), 'classe': classe}
    return giro


def giro_do_palete(palete, giro):
    """Soma das saidas dos produtos do palete e a melhor classe entre eles ('' se nenhum tem giro)."""
    dos_itens = [giro[i.produto_id] for i in palete.itens if i.produto_id in giro]
    if not dos_itens:
        return {'saidas': 0, 'por_dia': 0, 'classe': ''}
    return {'saidas': sum(g['saidas'] for g in dos_itens), 'por_dia': round(sum(g['por_dia'] for g in dos_itens), 3),
            'classe': min(g['classe'] for g in dos_itens)}


def distancias_da_doca(camara, enderecos):
    """endereco.id -> metros estimados ate a doca da camara. Vazio se a camara nao tem doca cadastrada."""
    ruas = sorted({e.rua for e in enderecos})
    if not camara.doca_rua or camara.doca_rua not in ruas:
        return {}
    colunas = [e.coluna for e in enderecos]
    coluna_doca = max(colunas) if camara.doca_ponta == 'fim' else min(colunas)
    indice_doca = ruas.index(camara.doca_rua)
    return {e.id: round(abs(e.coluna - coluna_doca) * PASSO_COLUNA + abs(ruas.index(e.rua) - indice_doca) * PASSO_RUA
                        + (e.nivel - 1) * PASSO_NIVEL, 1) for e in enderecos}


def sugestoes_de_troca(camara, enderecos, ocupados, giro):
    """palete.id -> sugestao para aproximar da doca quem mais sai. So onde a camara tem doca cadastrada.

    Cada sugestao: {'acao': 'trocar' | 'mover', 'destino': codigo, 'com': etiqueta do outro palete (na troca),
    'ganho': metros por dia, ida e volta}. Quem mais sai escolhe primeiro; um endereco so entra em uma sugestao.
    Respeita espaco reservado de cliente, destino fixo e bloqueio; so paletes guardados e fora de carga.
    """
    distancia = distancias_da_doca(camara, enderecos)
    if not distancia:
        return {}

    def serve(endereco, dono):
        return (not endereco.bloqueado and not endereco.destino_fixo
                and (endereco.cliente_id is None or mesmo_embarcador(dono, endereco.cliente)))

    postos = []          # (endereco, palete ou None, saidas por dia, dono)
    for e in enderecos:
        la = ocupados.get(e.id, [])
        if not la:
            postos.append((e, None, 0, None))
        elif len(la) == 1 and la[0].status == 'Armazenado' and not la[0].carga_id:
            postos.append((e, la[0], giro_do_palete(la[0], giro)['por_dia'], empresa_do_palete(la[0])))
    usados, sugestoes = set(), {}
    for e, palete, por_dia, dono in sorted([p for p in postos if p[1] is not None and p[2] > 0], key=lambda p: -p[2]):
        if e.id in usados or e.bloqueado or e.destino_fixo:
            continue
        melhor = None
        for e2, palete2, por_dia2, dono2 in postos:
            if e2.id == e.id or e2.id in usados or distancia[e2.id] > distancia[e.id] - 0.5 or not serve(e2, dono):
                continue
            if palete2 is not None and (por_dia2 >= por_dia or not serve(e, dono2)):
                continue
            ganho = 2 * (distancia[e.id] - distancia[e2.id]) * (por_dia - por_dia2)
            if ganho >= GANHO_MINIMO and (melhor is None or ganho > melhor[0]):
                melhor = (ganho, e2, palete2)
        if melhor:
            ganho, e2, palete2 = melhor
            usados.update((e.id, e2.id))
            sugestoes[palete.id] = {'acao': 'trocar' if palete2 is not None else 'mover', 'destino': e2.codigo,
                                    'com': palete2.etiqueta if palete2 is not None else None, 'ganho': round(ganho, 1)}
    return sugestoes

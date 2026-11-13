"""Motor de calculo do Financeiro (armazenagem 3PL), na logica do WMS Plus.

So contas: nao le banco nem tela. Quem monta os dados de cada nota e o wms/financeiro.py.

Regras herdadas do Plus:
- Dias armazenados: da data de armazenagem ate hoje (nota em estoque) ou ate a ultima saida (nota finalizada).
  O dia da entrada nao conta e o minimo e 1.
- Ciclo: mensal = 30 dias, quinzenal = 15 dias corridos a partir da entrada (nao e mes de calendario).
- Regra de tempo: proporcional = dias / ciclo; cheia = ciclos inteiros, arredondando para cima.
- Posicao palete e palete: quantidade x custo x fator de tempo.
- Quilo: diaria = peso x custo / dias do ciclo, cortada no centavo; acumulado = dias x diaria. Nao usa a regra de
  tempo. Com saida parcial, passa a contar o peso atual desde a ultima saida. Nota finalizada cobra o peso de entrada.
- Entrada: paletes da entrada x custo, uma vez so.
- Periodo de cobranca: dias do periodo (contando o primeiro e o ultimo) x diaria, recortado pela entrada e pela saida.

Diferencas em relacao ao Plus (la eram falhas):
- A saida e cobrada (paletes que sairam x custo de saida); no Plus o campo existia mas nunca entrava na conta.
- Contrato com quilo E posicao: a diaria e o valor do periodo somam os dois (no Plus so o quilo aparecia).
- Contrato sem quilo: o periodo tambem e recortado pela entrada e pela saida final.
- Nota finalizada cobra posicao/palete pela quantidade que entrou (ja nao ha posicao ocupada).
"""
import math
from datetime import date, datetime

DIAS_DO_CICLO = {'mensal': 30, 'quinzenal': 15}
ROTULO_CICLO = {'mensal': 'Mensal', 'quinzenal': 'Quinzenal'}
ROTULO_REGRA = {'proporcional': 'Proporcional', 'cheia': 'Cheia'}


def arredondar(valor):
    """Centavo mais proximo, meio para cima (igual ao Math.round do Plus; o round() do Python arredonda para o par)."""
    return math.floor(valor * 100 + 0.5) / 100


def cortar(valor):
    """Corta no centavo, sem arredondar."""
    return math.floor(valor * 100) / 100


def _dia(valor):
    return valor.date() if isinstance(valor, datetime) else valor


def dias_armazenados(inicio, fim):
    """Dias entre duas datas, sem contar o primeiro; minimo 1."""
    return max(1, (_dia(fim) - _dia(inicio)).days)


def dias_no_ciclo(ciclo):
    return DIAS_DO_CICLO.get(ciclo, 30)


def dias_inclusive(inicio, fim):
    if not inicio or not fim:
        return 0
    return max(0, (_dia(fim) - _dia(inicio)).days + 1)


def fator_tempo(dias, ciclo, regra):
    periodo = dias_no_ciclo(ciclo)
    if regra == 'cheia':
        return max(1, math.ceil(dias / periodo))
    return dias / periodo


def diaria_por_quilo(peso, custo, ciclo):
    if peso <= 0 or custo <= 0:
        return 0.0
    return cortar(peso * custo / dias_no_ciclo(ciclo))


def acumulado(dias, diaria):
    return arredondar(max(1, dias) * diaria)


def valor_do_periodo(dias, diaria):
    if dias <= 0 or diaria <= 0:
        return 0.0
    return arredondar(dias * diaria)


def no_periodo(dia, inicio, fim):
    dia = _dia(dia)
    if dia is None:
        return False
    if inicio and dia < inicio:
        return False
    if fim and dia > fim:
        return False
    return True


def resumir(entrada, saidas, em_estoque, peso_entrada, peso_atual, paletes_entrada, paletes_atuais, posicoes, caixas, hoje):
    """Situacao de uma nota para a cobranca.

    saidas: lista de {'data': datetime/date, 'peso', 'caixas', 'paletes', 'ref'} em ordem de data.
    """
    ultima_saida = max((_dia(s['data']) for s in saidas), default=None)
    data_saida = None if em_estoque else ultima_saida
    dias = dias_armazenados(entrada, data_saida or hoje)
    if em_estoque and ultima_saida:
        dias_cobranca = dias_armazenados(ultima_saida, hoje)       # quilo: conta de novo a partir da ultima saida
    else:
        dias_cobranca = dias
    return {
        'status': 'Armazenada' if em_estoque else 'Finalizada', 'armazenada': em_estoque,
        'entrada': entrada, 'data_saida': data_saida, 'ultima_saida': ultima_saida, 'saidas': saidas,
        'dias': dias, 'dias_cobranca': dias_cobranca,
        'peso_entrada': peso_entrada, 'peso_atual': peso_atual if em_estoque else 0.0,
        'peso_saido': sum(s['peso'] for s in saidas),
        'paletes_entrada': paletes_entrada, 'paletes': paletes_atuais if em_estoque else 0,
        'paletes_saidos': sum(s['paletes'] for s in saidas),
        'posicoes': posicoes if em_estoque else 0, 'caixas': caixas if em_estoque else 0,
    }


def _moeda(valor):
    texto = f'{arredondar(valor):,.2f}'
    return 'R$ ' + texto.replace(',', '#').replace('.', ',').replace('#', '.')


def _numero(valor, casas=3):
    texto = f'{valor:,.{casas}f}'.rstrip('0').rstrip('.')
    return texto.replace(',', '#').replace('.', ',').replace('#', '.')


def formatar_fator(fator):
    return str(round(fator)) if abs(fator - round(fator)) < 0.01 else _numero(fator, 2)


VAZIA = {'fator': 0, 'detalhes': [], 'total': 0.0, 'recorrente': 0.0, 'diaria_quilo': 0.0, 'diaria_outros': 0.0,
         'valor_diaria': 0.0, 'valor_vigente': 0.0}


def calcular(resumo, contrato, tabela):
    """Cobranca da estadia inteira de uma nota. contrato e tabela sao dicionarios (ou None).

    contrato: ciclo, regra, cobrar_posicao, cobrar_kilo, cobrar_palete, cobrar_entrada, cobrar_saida
    tabela: custo_posicao, custo_kilo, custo_palete, custo_entrada, custo_saida
    """
    if not contrato or not tabela:
        return dict(VAZIA)
    ciclo, regra = contrato['ciclo'], contrato['regra']
    fator = fator_tempo(resumo['dias'], ciclo, regra)
    detalhes, outros = [], 0.0
    armazenada = resumo['armazenada']
    # nota finalizada nao ocupa mais posicao: vale o que entrou
    posicoes = resumo['posicoes'] if armazenada else resumo['paletes_entrada']
    paletes = resumo['paletes'] if armazenada else resumo['paletes_entrada']

    if contrato['cobrar_posicao'] and tabela['custo_posicao'] > 0 and posicoes > 0:
        valor = posicoes * tabela['custo_posicao'] * fator
        detalhes.append((f'Posição palete ({posicoes} × {_moeda(tabela["custo_posicao"])} × {formatar_fator(fator)})', valor))
        outros += valor

    diaria_quilo = acumulado_quilo = 0.0
    if contrato['cobrar_kilo'] and tabela['custo_kilo'] > 0:
        peso = resumo['peso_atual'] if armazenada else resumo['peso_entrada']
        if peso > 0:
            diaria_quilo = diaria_por_quilo(peso, tabela['custo_kilo'], ciclo)
            dias_quilo = max(1, resumo['dias_cobranca'])
            acumulado_quilo = acumulado(dias_quilo, diaria_quilo)
            desde = 'última saída' if (resumo['ultima_saida'] and armazenada) else 'entrada'
            detalhes.append((f'Quilo/dia ({_numero(peso)} kg × {_moeda(tabela["custo_kilo"])} ÷ {dias_no_ciclo(ciclo)} dias × '
                             f'{dias_quilo} dias desde a {desde})', acumulado_quilo))

    if contrato['cobrar_palete'] and tabela['custo_palete'] > 0 and paletes > 0:
        valor = paletes * tabela['custo_palete'] * fator
        detalhes.append((f'Palete ({paletes} × {_moeda(tabela["custo_palete"])} × {formatar_fator(fator)})', valor))
        outros += valor

    if contrato['cobrar_entrada'] and tabela['custo_entrada'] > 0 and resumo['paletes_entrada'] > 0:
        detalhes.append((f'Entrada ({resumo["paletes_entrada"]} paletes × {_moeda(tabela["custo_entrada"])})',
                         resumo['paletes_entrada'] * tabela['custo_entrada']))

    if contrato['cobrar_saida'] and tabela['custo_saida'] > 0 and resumo['paletes_saidos'] > 0:
        detalhes.append((f'Saída ({resumo["paletes_saidos"]} paletes × {_moeda(tabela["custo_saida"])})',
                         resumo['paletes_saidos'] * tabela['custo_saida']))

    dias = max(1, resumo['dias'])
    diaria_outros = cortar(outros / dias) if outros > 0 else 0.0
    vigente = acumulado_quilo + (arredondar(dias * diaria_outros) if diaria_outros else 0.0)
    return {'fator': fator, 'detalhes': detalhes, 'total': sum(v for _, v in detalhes), 'recorrente': outros + acumulado_quilo,
            'diaria_quilo': diaria_quilo, 'diaria_outros': diaria_outros,
            'valor_diaria': arredondar(diaria_quilo + diaria_outros), 'valor_vigente': arredondar(vigente)}


def dias_do_periodo(inicio, fim, resumo, desde_ultima_saida):
    """Dias cobrados dentro do periodo, recortados pela entrada e pela saida.

    desde_ultima_saida (quilo): nota em estoque com saida parcial so conta a partir da ultima saida, porque o peso
    cobrado e o atual.
    """
    if not inicio or not fim:
        return 0
    inicio = max(inicio, _dia(resumo['entrada']))
    if not resumo['armazenada']:
        final = resumo['data_saida'] or resumo['ultima_saida']
        if final:
            if final < inicio:
                return 0
            fim = min(fim, final)
    elif desde_ultima_saida and resumo['ultima_saida']:
        inicio = max(inicio, resumo['ultima_saida'])
    if inicio > fim:
        return 0
    return dias_inclusive(inicio, fim)


def cobrar_periodo(resumo, cobranca, contrato, tabela, inicio, fim):
    """Valor a cobrar de uma nota num periodo (inicio e fim sao datas, contando os dois)."""
    vazio = {'inicio': inicio, 'fim': fim, 'dias': dias_do_periodo(inicio, fim, resumo, False), 'valor_diaria': 0.0, 'armazenagem': 0.0,
             'debitos_entrada': 0.0, 'paletes_entrada': 0, 'debitos_saida': 0.0, 'paletes_saida': 0, 'saidas': 0, 'total': 0.0}
    if not contrato or not tabela:
        return vazio
    quilo = bool(contrato['cobrar_kilo'] and tabela['custo_kilo'] > 0)
    dias_quilo = dias_do_periodo(inicio, fim, resumo, True) if quilo else 0
    dias_outros = vazio['dias']
    diaria_quilo = 0.0
    if quilo:
        peso = resumo['peso_atual'] if resumo['peso_atual'] > 1e-6 else (resumo['peso_entrada'] if resumo['saidas'] else 0.0)
        diaria_quilo = diaria_por_quilo(peso, tabela['custo_kilo'], contrato['ciclo'])
    armazenagem = valor_do_periodo(dias_quilo, diaria_quilo) + valor_do_periodo(dias_outros, cobranca['diaria_outros'])

    debitos_entrada, paletes_entrada = 0.0, 0
    if (contrato['cobrar_entrada'] and tabela['custo_entrada'] > 0 and resumo['paletes_entrada'] > 0
            and no_periodo(resumo['entrada'], inicio, fim)):
        paletes_entrada = resumo['paletes_entrada']
        debitos_entrada = arredondar(paletes_entrada * tabela['custo_entrada'])

    saidas = [s for s in resumo['saidas'] if inicio and fim and no_periodo(s['data'], inicio, fim)]
    debitos_saida, paletes_saida = 0.0, 0
    if contrato['cobrar_saida'] and tabela['custo_saida'] > 0:
        paletes_saida = sum(s['paletes'] for s in saidas)
        debitos_saida = arredondar(paletes_saida * tabela['custo_saida'])

    return {'inicio': inicio, 'fim': fim, 'dias': dias_quilo if quilo else dias_outros,
            'valor_diaria': arredondar(diaria_quilo + cobranca['diaria_outros']), 'armazenagem': arredondar(armazenagem),
            'debitos_entrada': debitos_entrada, 'paletes_entrada': paletes_entrada,
            'debitos_saida': debitos_saida, 'paletes_saida': paletes_saida, 'saidas': len(saidas),
            'total': arredondar(armazenagem + debitos_entrada + debitos_saida)}


def periodo_padrao(hoje):
    """Do primeiro dia do mes ate hoje."""
    return date(hoje.year, hoje.month, 1), hoje

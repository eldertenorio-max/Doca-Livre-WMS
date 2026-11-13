"""PDF da nota fiscal ("Abrir nota fiscal").

Como no WMS Pro: com o XML da nota guardado e a chave MEU_DANFE_API_KEY configurada, o DANFE oficial e gerado
pela API do Meu Danfe (o XML e enviado para esse servico). Sem a chave, sem o XML ou se a API falhar, o sistema
monta aqui mesmo um espelho da nota em PDF, com os dados que tem — serve para conferencia, nao substitui o DANFE.
"""
import base64
import json
import os
import re
import threading
import time
import urllib.error
import urllib.request

from fpdf import FPDF
from fpdf.enums import XPos, YPos
from fpdf.fonts import FontFace

from .models import agora

URL_MEU_DANFE = 'https://api.meudanfe.com.br/v2/fd/convert/xml-to-da'


def busca_paga_ligada():
    """A busca da nota pela chave de acesso custa R$ 0,03 por nota no Meu Danfe. So acontece se for ligada no .env
    (MEU_DANFE_BUSCAR_POR_CHAVE=1). Desligada, o sistema usa so o caminho gratis: converter o XML guardado."""
    return (os.environ.get('MEU_DANFE_BUSCAR_POR_CHAVE') or '').strip().lower() in ('1', 'true', 'sim')


def chave_meu_danfe():
    return (os.environ.get('MEU_DANFE_API_KEY') or os.environ.get('MEUDANFE_API_KEY') or '').strip()


def pdf_oficial(xml_texto):
    """DANFE pela API do Meu Danfe. Devolve (pdf em bytes, None) ou (None, mensagem de erro)."""
    chave = chave_meu_danfe()
    if not chave:
        return None, 'A chave do Meu Danfe (MEU_DANFE_API_KEY) não está configurada.'
    if not (xml_texto or '').strip():
        return None, 'Esta nota não tem o XML guardado.'
    pedido = urllib.request.Request(
        (os.environ.get('MEU_DANFE_API_URL') or URL_MEU_DANFE).strip(), data=xml_texto.strip().encode('utf-8'), method='POST',
        headers={'Api-Key': chave, 'Content-Type': 'text/plain; charset=utf-8', 'Accept': 'application/json'})
    try:
        with urllib.request.urlopen(pedido, timeout=int(os.environ.get('MEU_DANFE_TIMEOUT') or 60)) as resposta:
            corpo = json.loads(resposta.read().decode('utf-8'))
    except urllib.error.HTTPError as erro:
        return None, {401: 'A chave do Meu Danfe é inválida.', 403: 'A chave do Meu Danfe foi substituída; atualize MEU_DANFE_API_KEY.',
                      400: 'O Meu Danfe recusou o XML desta nota.'}.get(erro.code, f'O Meu Danfe respondeu com erro {erro.code}.')
    except (urllib.error.URLError, TimeoutError, OSError):
        return None, 'Não foi possível falar com o Meu Danfe (sem internet ou serviço fora do ar).'
    except ValueError:
        return None, 'O Meu Danfe devolveu uma resposta que não deu para ler.'
    try:
        pdf = base64.b64decode((corpo.get('data') or '').strip())
    except (ValueError, AttributeError):
        pdf = b''
    if not pdf.startswith(b'%PDF'):
        return None, 'O Meu Danfe não devolveu o PDF.'
    return pdf, None


BASE_MEU_DANFE = 'https://api.meudanfe.com.br/v2'
# O Meu Danfe BLOQUEIA a conta se a mesma chave for consultada mais de uma vez por segundo. Por isso: uma busca
# de cada vez neste processo (trava) e pelo menos 1,5 s entre uma consulta de situacao e a seguinte.
_TRAVA = threading.Lock()
ESPERA_ENTRE_CONSULTAS = 2
MAX_CONSULTAS = 5
# Limite de tentativas por chave (a documentacao pede: insistir na mesma chave em pouco tempo bloqueia a conta e o IP).
# Depois de uma busca que falhou, a mesma nota so e tentada de novo apos este intervalo, e no maximo N vezes por dia.
INTERVALO_APOS_FALHA = 10 * 60          # segundos
MAX_FALHAS_POR_DIA = 5
_ERROS_HTTP = {400: 'O Meu Danfe não aceitou a chave de acesso desta nota.', 401: 'A chave do Meu Danfe é inválida.',
               402: 'Saldo insuficiente no Meu Danfe para buscar a nota (a busca pela chave custa R$ 0,03). Adicione créditos na Área do Cliente.',
               403: 'A chave do Meu Danfe foi substituída; atualize MEU_DANFE_API_KEY.',
               404: 'O Meu Danfe não encontrou esta nota.'}


def _api(metodo, caminho):
    """Chamada simples a API do Meu Danfe (so a chave no cabecalho). Devolve (status http, json ou None)."""
    pedido = urllib.request.Request(BASE_MEU_DANFE + caminho, method=metodo,
                                    headers={'Api-Key': chave_meu_danfe(), 'Accept': 'application/json'})
    try:
        with urllib.request.urlopen(pedido, timeout=int(os.environ.get('MEU_DANFE_TIMEOUT') or 60)) as resposta:
            return resposta.status, json.loads(resposta.read().decode('utf-8') or 'null')
    except urllib.error.HTTPError as erro:
        return erro.code, None
    except (urllib.error.URLError, TimeoutError, OSError, ValueError):
        return 0, None


def _erro_http(status):
    if not status:
        return 'Não foi possível falar com o Meu Danfe (sem internet ou serviço fora do ar).'
    return _ERROS_HTTP.get(status, f'O Meu Danfe respondeu com erro {status}.')


def _pdf_da_resposta(corpo):
    try:
        pdf = base64.b64decode(((corpo or {}).get('data') or '').strip())
    except (ValueError, AttributeError):
        return None
    return pdf if pdf.startswith(b'%PDF') else None


def pdf_pela_chave(chave_acesso, esperar=time.sleep):
    """DANFE oficial de uma nota da qual so se tem a chave de acesso (44 digitos).

    Primeiro tenta baixar (gratis: a nota ja pode estar na Area do Cliente do Meu Danfe). Se nao estiver, pede a busca
    na Receita (R$ 0,03, cobrado uma vez por nota), espera ficar pronta e baixa o PDF e o XML.
    Devolve (pdf, xml, erro): pdf e xml podem ser None; erro e a mensagem quando o pdf nao veio.
    """
    if not chave_meu_danfe():
        return None, None, 'A chave do Meu Danfe (MEU_DANFE_API_KEY) não está configurada.'
    if not re.fullmatch(r'[0-9]{6}[A-Z0-9]{12}[0-9]{26}', chave_acesso or ''):
        return None, None, 'Esta nota não tem uma chave de acesso válida (44 dígitos).'
    with _TRAVA:
        status, corpo = _api('GET', f'/fd/get/da/{chave_acesso}')
        if status == 404:
            # ainda nao esta na conta: busca na Receita e acompanha a situacao
            situacao = None
            for tentativa in range(MAX_CONSULTAS):
                if tentativa:
                    esperar(ESPERA_ENTRE_CONSULTAS)
                status, corpo = _api('PUT', f'/fd/add/{chave_acesso}')
                if status != 200:
                    return None, None, _erro_http(status)
                situacao = (corpo or {}).get('status')
                if situacao not in ('WAITING', 'SEARCHING'):
                    break
            if situacao == 'NOT_FOUND':
                return None, None, 'A Receita não encontrou esta nota pela chave de acesso.'
            if situacao in ('WAITING', 'SEARCHING'):
                return None, None, 'O Meu Danfe ainda está buscando esta nota na Receita. Abra de novo em alguns segundos.'
            if situacao != 'OK':
                return None, None, 'O Meu Danfe não conseguiu buscar esta nota: ' + str((corpo or {}).get('statusMessage') or situacao) + '.'
            esperar(ESPERA_ENTRE_CONSULTAS)
            status, corpo = _api('GET', f'/fd/get/da/{chave_acesso}')
        if status != 200:
            return None, None, _erro_http(status)
        pdf = _pdf_da_resposta(corpo)
        if not pdf:
            return None, None, 'O Meu Danfe não devolveu o PDF.'
        # o XML vem junto (gratis) para ficar guardado na nota
        esperar(ESPERA_ENTRE_CONSULTAS)
        status, corpo = _api('GET', f'/fd/get/xml/{chave_acesso}')
        xml = (corpo or {}).get('data') if status == 200 else None
        return pdf, (xml if isinstance(xml, str) and '<' in xml else None), None


# ---------------------------------------------------------------- espelho da nota, gerado aqui

def _t(valor):
    """Texto para as fontes padrao do PDF (latin-1): o que nao existe nelas vira um equivalente simples."""
    texto = '' if valor is None else str(valor)
    for de, para in (('—', '-'), ('–', '-'), ('…', '...'), ('“', '"'), ('”', '"'), ('‘', "'"), ('’', "'"),
                     ('→', '->'), (' ', ' ')):
        texto = texto.replace(de, para)
    return texto.encode('latin-1', 'replace').decode('latin-1')


def _data(valor, hora=False):
    return valor.strftime('%d/%m/%Y %H:%M' if hora else '%d/%m/%Y') if valor else '-'


def _cnpj(valor):
    v = ''.join(c for c in (valor or '') if c.isdigit())
    return f'{v[:2]}.{v[2:5]}.{v[5:8]}/{v[8:12]}-{v[12:]}' if len(v) == 14 else (valor or '-')


def _numero(valor):
    if valor is None:
        return '-'
    texto = f'{float(valor):,.3f}'.rstrip('0').rstrip('.')
    return texto.replace(',', '#').replace('.', ',').replace('#', '.')


class _Espelho(FPDF):
    rodape = ''

    def footer(self):
        self.set_y(-12)
        self.set_font('Helvetica', '', 7)
        self.set_text_color(110, 110, 110)
        self.cell(0, 4, _t(self.rodape), align='L')
        self.cell(0, 4, f'Página {self.page_no()} de {{nb}}', align='R')


def pdf_espelho(nota, destinatario=None, usuario='', aviso=None):
    """Espelho da nota em PDF (A4), com os dados que o WMS guarda. Devolve os bytes do PDF."""
    retorno = nota.tipo == 'Retorno'
    pdf = _Espelho(format='A4')
    pdf.rodape = f'WMS Doca Livre · gerado em {_data(agora(), True)}' + (f' por {usuario}' if usuario else '')
    pdf.set_title(_t(f'NF {nota.numero}'))
    pdf.set_auto_page_break(True, margin=16)
    pdf.set_margins(12, 12, 12)
    pdf.add_page()
    largura = pdf.epw

    # cabecalho
    pdf.set_fill_color(26, 35, 126)
    pdf.set_text_color(255, 255, 255)
    pdf.set_font('Helvetica', 'B', 15)
    pdf.cell(largura * 0.62, 12, _t(f'  NOTA FISCAL Nº {nota.numero}' + (f'  ·  SÉRIE {nota.serie}' if nota.serie else '')), fill=True)
    pdf.set_font('Helvetica', 'B', 9)
    pdf.cell(largura * 0.38, 12, _t(('RETORNO' if retorno else 'ENTRADA') + f' · {nota.status.upper()}  '), fill=True, align='R',
             new_x=XPos.LMARGIN, new_y=YPos.NEXT)
    pdf.set_text_color(90, 90, 90)
    pdf.set_font('Helvetica', '', 7.5)
    pdf.cell(0, 5, _t('Espelho da nota para conferência no armazém. Não substitui o DANFE nem tem valor fiscal.'),
             new_x=XPos.LMARGIN, new_y=YPos.NEXT)
    pdf.ln(1)

    def bloco(titulo, campos, colunas=3):
        """Caixa com titulo e campos (rotulo em cima, valor embaixo), em colunas."""
        pdf.set_font('Helvetica', 'B', 8)
        pdf.set_text_color(26, 35, 126)
        pdf.cell(0, 6, _t(titulo.upper()), new_x=XPos.LMARGIN, new_y=YPos.NEXT)
        w = largura / colunas
        for inicio in range(0, len(campos), colunas):
            linha = campos[inicio:inicio + colunas]
            y = pdf.get_y()
            altura = 0
            for n, (rotulo, valor) in enumerate(linha):
                pdf.set_xy(pdf.l_margin + n * w, y)
                pdf.set_font('Helvetica', '', 6.5)
                pdf.set_text_color(110, 110, 110)
                pdf.cell(w, 3.5, _t(rotulo.upper()))
                pdf.set_xy(pdf.l_margin + n * w, y + 3.5)
                pdf.set_font('Helvetica', 'B', 9)
                pdf.set_text_color(20, 20, 20)
                pdf.multi_cell(w - 2, 4.5, _t(valor if valor not in (None, '') else '-'), align='L')
                altura = max(altura, pdf.get_y() - y)
            pdf.set_y(y + altura + 1.5)
        pdf.set_draw_color(205, 210, 220)
        pdf.line(pdf.l_margin, pdf.get_y(), pdf.l_margin + largura, pdf.get_y())
        pdf.ln(2)

    if nota.chave:
        chave = ' '.join(nota.chave[i:i + 4] for i in range(0, len(nota.chave), 4))
        bloco('Chave de acesso', [('NF-e', chave)], colunas=1)
    empresa = nota.empresa
    bloco('Dono da mercadoria' if retorno else 'Emitente / remetente',
          [('Razão social', empresa.nome if empresa else None), ('CNPJ', _cnpj(empresa.cnpj) if empresa else None),
           ('Cidade / UF', ' / '.join(p for p in ((empresa.cidade, empresa.uf) if empresa else ()) if p) or None)])
    if destinatario and (destinatario.get('nome') or destinatario.get('cidade')):
        bloco('Destinatário', [('Nome', destinatario.get('nome')), ('Cidade', destinatario.get('cidade'))], colunas=2)
    campos = [('Emissão', _data(nota.data_emissao)), ('Valor total da nota', ('R$ ' + f'{nota.valor_total:,.2f}'.replace(',', '#').replace('.', ',').replace('#', '.')) if nota.valor_total else None),
              ('Origem do cadastro', nota.origem), ('Entrada no sistema', f'{_data(nota.criado_em, True)} · {nota.criado_por or "-"}'),
              ('Finalizado em', _data(nota.finalizado_em, True)), ('Doca', nota.doca), ('Placa', nota.placa), ('Motorista', nota.motorista),
              ('Conferente', nota.conferente)]
    if retorno:
        campos += [('Motivo do retorno', nota.motivo_retorno), ('Carga de origem', nota.carga.codigo if nota.carga else None)]
    if nota.observacao:
        campos.append(('Observação', nota.observacao))
    bloco('Dados da nota', campos)

    # itens
    pdf.set_font('Helvetica', 'B', 8)
    pdf.set_text_color(26, 35, 126)
    pdf.cell(0, 6, _t(f'ITENS ({len(nota.itens)})'), new_x=XPos.LMARGIN, new_y=YPos.NEXT)
    pdf.set_text_color(20, 20, 20)
    pdf.set_draw_color(205, 210, 220)
    pdf.set_font('Helvetica', '', 8)
    total = 0
    with pdf.table(col_widths=(18, 66, 20, 9, 16, 18, 17, 17), line_height=5, text_align=('LEFT', 'LEFT', 'LEFT', 'CENTER', 'RIGHT', 'LEFT', 'CENTER', 'CENTER'),
                   headings_style=FontFace(emphasis='BOLD', color=(255, 255, 255), fill_color=(26, 35, 126)),
                   cell_fill_color=(255, 255, 255), cell_fill_mode='ALL', borders_layout='HORIZONTAL_LINES') as tabela:
        cabecalho = tabela.row()
        for titulo in ('Código', 'Descrição', 'EAN', 'Un.', 'Qtd.', 'Lote', 'Fabricação', 'Validade'):
            cabecalho.cell(_t(titulo))
        for item in nota.itens:
            total += item.quantidade or 0
            linha = tabela.row()
            for valor in (item.produto.sku, item.descricao or item.produto.descricao, item.produto.ean or '-', item.unidade or item.produto.unidade,
                          _numero(item.quantidade), item.lote or '-', _data(item.fabricacao), _data(item.validade)):
                linha.cell(_t(valor))
    pdf.ln(2)
    pdf.set_font('Helvetica', 'B', 9)
    pdf.cell(0, 6, _t(f'Quantidade total: {_numero(round(total, 3))}'), align='R', new_x=XPos.LMARGIN, new_y=YPos.NEXT)
    if aviso:
        pdf.ln(2)
        pdf.set_font('Helvetica', '', 7.5)
        pdf.set_text_color(150, 60, 0)
        pdf.multi_cell(0, 4, _t(aviso), align='L')
    return bytes(pdf.output())

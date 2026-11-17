"""Configuracoes do sistema, backup automatico do banco e alertas.

- Configuracoes: tabela chave/valor (Configuracao). Hoje: politica de separacao (FEFO ou FIFO), antecedencia do
  alerta de validade, e-mails que recebem o resumo dos alertas e quantos backups guardar.
- Backup: copia diaria do banco SQLite para a pasta "backups" ao lado dele (feita no primeiro acesso do dia) e
  copia na hora pela tela. So existe para SQLite; com Postgres o backup e do servidor do banco.
- Alertas: produto vencido ou perto do vencimento, estoque abaixo do minimo e camara com a ultima leitura fora da
  faixa. Aparecem no sino do topo e na tela Alertas; se houver SMTP no .env e e-mails configurados, sai um resumo
  por dia.
"""
import hashlib
import os
import re
import smtplib
import sqlite3
import time
from datetime import timedelta
from email.message import EmailMessage

from flask import Blueprint, abort, current_app, flash, g, redirect, render_template, request, send_from_directory, url_for

from . import correio
from .core import eh_super, perm, registrar_log, usuario_atual
from .models import AlertaLido, Camara, Configuracao, Palete, PaleteItem, Produto, TemperaturaCamara, agora, db

bp = Blueprint('sistema', __name__)

PADROES = {'separacao': 'FEFO', 'alerta_validade_dias': '30', 'alerta_emails': '', 'backup_manter': '30', 'alerta_ultimo_envio': '', 'layout_nome': ''}
EM_ESTOQUE = ('Aguardando guarda', 'Armazenado', 'Stage')


# ---------------------------------------------------------------- configuracoes

def _todas():
    if '_config' not in g:
        g._config = {c.chave: c.valor for c in Configuracao.query.all()}
    return g._config


def obter(chave):
    valor = _todas().get(chave)
    return PADROES.get(chave, '') if valor is None else valor


def definir(chave, valor):
    linha = db.session.get(Configuracao, chave)
    if linha is None:
        db.session.add(Configuracao(chave=chave, valor=str(valor)))
    else:
        linha.valor = str(valor)
    _todas()[chave] = str(valor)


def politica_separacao():
    """FEFO = sai primeiro o que vence primeiro; FIFO = sai primeiro o que entrou (foi fabricado) primeiro."""
    valor = obter('separacao')
    return valor if valor in ('FEFO', 'FIFO') else 'FEFO'


def _inteiro(chave, minimo, maximo):
    try:
        return min(max(int(obter(chave)), minimo), maximo)
    except ValueError:
        return int(PADROES[chave])


# ---------------------------------------------------------------- backup

def caminho_do_banco():
    """Arquivo do banco SQLite; None quando o banco nao e um arquivo SQLite."""
    url = db.engine.url
    if url.get_backend_name() != 'sqlite' or not url.database or url.database == ':memory:':
        return None
    return os.path.abspath(url.database)


def pasta_backups():
    banco = caminho_do_banco()
    return os.path.join(os.path.dirname(banco), 'backups') if banco else None


def listar_backups():
    pasta = pasta_backups()
    if not pasta or not os.path.isdir(pasta):
        return []
    arquivos = []
    for nome in os.listdir(pasta):
        if re.fullmatch(r'wms-\d{4}-\d{2}-\d{2}_\d{6}\.db', nome):
            caminho = os.path.join(pasta, nome)
            arquivos.append({'nome': nome, 'tamanho': os.path.getsize(caminho),
                             'quando': f'{nome[13:15]}/{nome[10:12]}/{nome[4:8]} {nome[16:18]}:{nome[18:20]}'})
    return sorted(arquivos, key=lambda a: a['nome'], reverse=True)


def fazer_backup():
    """Copia o banco (com ele em uso) para a pasta de backups e apaga os mais antigos. Devolve o nome do arquivo."""
    banco = caminho_do_banco()
    if not banco:
        return None
    pasta = pasta_backups()
    os.makedirs(pasta, exist_ok=True)
    nome = f'wms-{agora().strftime("%Y-%m-%d_%H%M%S")}.db'
    origem = sqlite3.connect(banco)
    destino = sqlite3.connect(os.path.join(pasta, nome))
    try:
        with destino:
            origem.backup(destino)
    finally:
        destino.close()
        origem.close()
    for velho in listar_backups()[_inteiro('backup_manter', 1, 365):]:
        os.remove(os.path.join(pasta, velho['nome']))
    return nome


def backup_do_dia():
    """Garante um backup por dia. Devolve o nome se fez agora."""
    hoje = agora().strftime('%Y-%m-%d')
    if not caminho_do_banco() or any(a['nome'].startswith(f'wms-{hoje}') for a in listar_backups()):
        return None
    return fazer_backup()


# ---------------------------------------------------------------- alertas

def calcular_alertas():
    """Lista de alertas, os graves primeiro. Cada um: tipo, grave, titulo, detalhe, url e chave.
    A chave identifica o alerta para o "lido" de cada usuario; ela muda quando a situacao muda (passou a grave,
    nova leitura de temperatura), e ai o alerta volta a aparecer como nao lido."""
    hoje = agora().date()
    dias = _inteiro('alerta_validade_dias', 0, 3650)
    alertas = []

    vencendo = (db.session.query(Produto.sku, Produto.descricao, PaleteItem.lote, PaleteItem.validade,
                                 db.func.sum(PaleteItem.quantidade), db.func.count(db.distinct(Palete.id)))
                .select_from(PaleteItem).join(Palete, PaleteItem.palete_id == Palete.id)
                .join(Produto, PaleteItem.produto_id == Produto.id)
                .filter(Palete.status.in_(EM_ESTOQUE), PaleteItem.quantidade > 0, PaleteItem.validade.isnot(None),
                        PaleteItem.validade <= hoje + timedelta(days=dias))
                .group_by(Produto.sku, Produto.descricao, PaleteItem.lote, PaleteItem.validade).order_by(PaleteItem.validade))
    for sku, descricao, lote, validade, quantidade, paletes in vencendo:
        falta = (validade - hoje).days
        quando = (f'vencido há {-falta} dia(s)' if falta < 0 else 'vence hoje' if falta == 0 else f'vence em {falta} dia(s)')
        alertas.append({'tipo': 'Validade', 'grave': falta <= 0, 'titulo': f'{sku} · {descricao}',
                        'detalhe': f'{"Lote " + lote + " · " if lote else ""}{quando} ({validade.strftime("%d/%m/%Y")}) · '
                                   f'{quantidade:g} em {paletes} palete(s)',
                        'url': url_for('estoque.atual', q=sku), 'chave': _chave('V', sku, lote, validade, falta <= 0)})

    saldos = dict(db.session.query(PaleteItem.produto_id, db.func.sum(PaleteItem.quantidade))
                  .join(Palete, PaleteItem.palete_id == Palete.id)
                  .filter(Palete.status.in_(EM_ESTOQUE), Palete.classificacao == 'Bom').group_by(PaleteItem.produto_id))
    for produto in Produto.query.filter(Produto.ativo.is_(True), Produto.estoque_seguranca > 0).order_by(Produto.descricao):
        saldo = saldos.get(produto.id) or 0
        if saldo < produto.estoque_seguranca:
            alertas.append({'tipo': 'Estoque mínimo', 'grave': saldo <= 0, 'titulo': f'{produto.sku} · {produto.descricao}',
                            'detalhe': f'Saldo {saldo:g} {produto.unidade}, abaixo do mínimo de {produto.estoque_seguranca:g}',
                            'url': url_for('estoque.analise', aba='seguranca', q=produto.sku),
                            'chave': _chave('M', produto.id, saldo <= 0)})

    for camara in Camara.query.filter(Camara.ativo.is_(True)).order_by(Camara.codigo):
        ultima = camara.temperaturas.order_by(TemperaturaCamara.medido_em.desc(), TemperaturaCamara.id.desc()).first()
        if ultima is not None and ultima.fora:
            faixa = ' a '.join(f'{v:g} °C' for v in (ultima.temp_min, ultima.temp_max) if v is not None)
            alertas.append({'tipo': 'Temperatura', 'grave': True, 'titulo': f'Câmara {camara.codigo} · {camara.nome}',
                            'detalhe': f'Última leitura {ultima.temperatura:g} °C em {ultima.medido_em.strftime("%d/%m/%Y %H:%M")}, '
                                       f'fora da faixa ({faixa})', 'url': url_for('temperaturas.lista'),
                            'chave': _chave('T', camara.id, ultima.id)})
    return sorted(alertas, key=lambda a: not a['grave'])


def _chave(*partes):
    return hashlib.sha1('|'.join(str(p) for p in partes).encode()).hexdigest()


_contagem = {'quando': 0.0, 'total': 0, 'graves': 0, 'chaves': []}


def _atualizar_contagem(forcar=False):
    if forcar or time.monotonic() - _contagem['quando'] > 30:
        alertas = calcular_alertas()
        _contagem.update(quando=time.monotonic(), total=len(alertas), graves=sum(1 for a in alertas if a['grave']),
                         chaves=[(a['chave'], a['grave']) for a in alertas])


def resumo_alertas():
    """(total, graves) de todos os alertas, para o painel. Recalcula no maximo a cada 30 segundos."""
    _atualizar_contagem()
    return _contagem['total'], _contagem['graves']


def lidos_do_usuario():
    user = usuario_atual()
    if user is None:
        return set()
    return {chave for (chave,) in db.session.query(AlertaLido.chave).filter_by(usuario_id=user.id)}


def resumo_do_sino():
    """(nao lidos, nao lidos graves) do usuario que esta na tela: e o numero do sino do topo."""
    _atualizar_contagem()
    if not _contagem['chaves']:
        return 0, 0
    lidos = lidos_do_usuario()
    novos = [grave for chave, grave in _contagem['chaves'] if chave not in lidos]
    return len(novos), sum(1 for grave in novos if grave)


def smtp_configurado():
    """Ha por onde enviar e-mail (Azure Communication Services ou servidor SMTP)?"""
    return correio.configurado()


def destinatarios():
    return [e for e in re.split(r'[,;\s]+', obter('alerta_emails')) if re.fullmatch(r'[^@\s]+@[^@\s]+\.[^@\s]+', e)]


def enviar_resumo_alertas(forcar=False):
    """Manda por e-mail o resumo dos alertas (uma vez por dia). Devolve quantos alertas foram enviados (0 = nao enviou)."""
    para = destinatarios()
    hoje = agora().strftime('%Y-%m-%d')
    if not para or not smtp_configurado() or (not forcar and obter('alerta_ultimo_envio') == hoje):
        return 0
    alertas = calcular_alertas()
    if not alertas and not forcar:
        return 0
    linhas = [f'[{a["tipo"]}{" · GRAVE" if a["grave"] else ""}] {a["titulo"]} — {a["detalhe"]}' for a in alertas]
    situacao = correio.enviar_email(para, f'WMS Doca Livre: {len(alertas)} alerta(s) em {agora().strftime("%d/%m/%Y")}',
                                    'Alertas do WMS Doca Livre\n\n' + ('\n'.join(linhas) if linhas else 'Nenhum alerta no momento.') + '\n',
                                    rotulo='resumo dos alertas')
    if situacao != 'ok':
        raise RuntimeError('o servidor de e-mail recusou o envio')
    definir('alerta_ultimo_envio', hoje)
    db.session.commit()
    return len(alertas) or 1


# ---------------------------------------------------------------- rotina diaria (primeiro acesso do dia)

_ultimo_dia = {'dia': None}


def rotina_diaria():
    hoje = agora().date()
    if _ultimo_dia['dia'] == hoje or request.endpoint == 'static':
        return
    _ultimo_dia['dia'] = hoje
    for tarefa in (backup_do_dia, enviar_resumo_alertas):
        try:
            tarefa()
        except Exception:                      # a rotina nunca pode derrubar a tela de quem entrou
            db.session.rollback()
            current_app.logger.exception('Falha na rotina diária (%s).', tarefa.__name__)


def registrar(app):
    app.before_request(rotina_diaria)

    @app.context_processor
    def _contexto():
        return {'resumo_alertas': resumo_do_sino, 'politica_separacao': politica_separacao}


# ---------------------------------------------------------------- telas

@bp.route('/alertas')
@perm('estoque')
def alertas():
    lista = calcular_alertas()
    tipo = request.args.get('tipo') or ''
    so_novos = request.args.get('ver') == 'novos'
    tipos = [(t, sum(1 for a in lista if a['tipo'] == t)) for t in sorted({a['tipo'] for a in lista})]
    # "lido" e de cada usuario. O que nao e mais alerta sai da lista de lidos dele (se voltar, volta como novo).
    lidos, atuais = lidos_do_usuario(), {a['chave'] for a in lista}
    if lidos - atuais:
        AlertaLido.query.filter(AlertaLido.usuario_id == usuario_atual().id, AlertaLido.chave.in_(lidos - atuais)).delete(synchronize_session=False)
        db.session.commit()
    for a in lista:
        a['lido'] = a['chave'] in lidos
    mostrar = [a for a in lista if (not tipo or a['tipo'] == tipo) and not (so_novos and a['lido'])]
    mostrar.sort(key=lambda a: a['lido'])              # os nao lidos primeiro (a ordem dos graves se mantem)
    return render_template('alertas.html', alertas=mostrar, todos=len(lista), tipo=tipo, so_novos=so_novos,
                           novos=sum(1 for a in lista if not a['lido']),
                           tipos=tipos, graves=sum(1 for a in lista if a['grave']), dias=_inteiro('alerta_validade_dias', 0, 3650))


@bp.route('/alertas/marcar', methods=['POST'])
@perm('estoque')
def alertas_marcar():
    """Marca alertas como lidos ou nao lidos para o usuario. "Ver" marca como lido e abre a tela do alerta."""
    user = usuario_atual()
    acao = request.form.get('acao')
    lista = calcular_alertas()
    por_chave = {a['chave']: a for a in lista}
    volta = redirect(url_for('sistema.alertas', tipo=request.form.get('tipo') or None, ver=request.form.get('ver') or None))
    if acao == 'ler_todos':
        chaves = set(por_chave)
    else:
        chaves = {request.form.get('chave')} & set(por_chave)
        if not chaves:
            flash('Esse alerta não existe mais.', 'error')
            return volta
    if acao == 'nao_lido':
        AlertaLido.query.filter(AlertaLido.usuario_id == user.id, AlertaLido.chave.in_(chaves)).delete(synchronize_session=False)
    else:
        for chave in chaves - lidos_do_usuario():
            db.session.add(AlertaLido(usuario_id=user.id, chave=chave))
    db.session.commit()
    if acao == 'ver':
        return redirect(por_chave[next(iter(chaves))]['url'])
    return volta


@bp.route('/admin/configuracoes', methods=['GET', 'POST'])
@perm('admin')
def configuracoes():
    if request.method == 'POST':
        erros = []
        separacao = request.form.get('separacao')
        if separacao not in ('FEFO', 'FIFO'):
            erros.append('Escolha a regra de separação.')
        valores = {}
        for chave, rotulo, minimo, maximo in (('alerta_validade_dias', 'Antecedência do alerta de validade', 0, 3650),
                                              ('backup_manter', 'Quantos backups guardar', 1, 365)):
            texto = (request.form.get(chave) or '').strip()
            if not texto.isdigit() or not minimo <= int(texto) <= maximo:
                erros.append(f'{rotulo}: informe um número de {minimo} a {maximo}.')
            valores[chave] = texto
        emails = ' '.join((request.form.get('alerta_emails') or '').replace(',', ' ').replace(';', ' ').split())
        invalidos = [e for e in emails.split() if not re.fullmatch(r'[^@\s]+@[^@\s]+\.[^@\s]+', e)]
        if invalidos:
            erros.append('E-mail inválido: ' + ', '.join(invalidos) + '.')
        if erros:
            for erro in erros:
                flash(erro, 'error')
            return _tela_configuracoes(request.form)
        mudou = []
        for chave, valor in {'separacao': separacao, 'alerta_emails': emails, **valores}.items():
            if obter(chave) != valor:
                mudou.append(f'{chave}: {obter(chave) or "—"} → {valor or "—"}')
                definir(chave, valor)
        if mudou:
            registrar_log('Alterou configurações', '; '.join(mudou), modulo='admin')
            db.session.commit()
        flash('Configurações salvas.' if mudou else 'Nenhuma alteração.', 'success')
        return redirect(url_for('sistema.configuracoes'))
    return _tela_configuracoes(None)


def _tela_configuracoes(form):
    return render_template('sistema_configuracoes.html', form=form, backups=listar_backups(), tem_backup=bool(caminho_do_banco()),
                           smtp=smtp_configurado(), valores={chave: obter(chave) for chave in PADROES})


@bp.route('/admin/configuracoes/backup', methods=['POST'])
@perm('admin')
def backup_agora():
    nome = fazer_backup()
    if nome:
        registrar_log('Fez backup do banco', nome, modulo='admin')
        db.session.commit()
        flash(f'Backup feito: {nome}.', 'success')
    else:
        flash('O backup pela tela só existe para o banco em arquivo (SQLite).', 'error')
    return redirect(url_for('sistema.configuracoes'))


@bp.route('/admin/configuracoes/backup/<nome>')
@perm('admin')
def backup_baixar(nome):
    """O arquivo tem o banco inteiro (inclusive as senhas, embaralhadas): so o Super Usuario baixa."""
    if not eh_super():
        abort(403)
    if not any(a['nome'] == nome for a in listar_backups()):
        abort(404)
    registrar_log('Baixou backup do banco', nome, modulo='admin')
    db.session.commit()
    return send_from_directory(pasta_backups(), nome, as_attachment=True)


@bp.route('/admin/configuracoes/email-teste', methods=['POST'])
@perm('admin')
def email_teste():
    if not smtp_configurado():
        flash('Falta configurar o servidor de e-mail (SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASSWORD) no arquivo .env.', 'error')
    elif not destinatarios():
        flash('Informe e salve pelo menos um e-mail para receber os alertas.', 'error')
    else:
        try:
            enviar_resumo_alertas(forcar=True)
            flash('E-mail de alertas enviado para ' + ', '.join(destinatarios()) + '.', 'success')
        except Exception as erro:              # mostra o motivo para quem esta configurando
            db.session.rollback()
            flash(f'Não foi possível enviar o e-mail: {erro}', 'error')
    return redirect(url_for('sistema.configuracoes'))

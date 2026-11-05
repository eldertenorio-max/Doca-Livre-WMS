import { useMemo, useState } from 'react'
import { formatValorNfe, formatPesoBruto, formatQuantidadeNfe } from '../lib/formatNfeItem'
import {
  calcularCobrancaDetalhada,
  debitosEntradaPeriodo,
  diasPeriodoCobrancaArmazenagem,
  formatMoedaFinanceiro,
  formatarCnpj,
  formatarDataBr,
  formatarDataHoraBr,
  normalizarCnpj,
  pesoBrutoParaCobrancaPeriodo,
  resumirClienteFinanceiro,
  resumirNfArmazenada,
  saidasNoPeriodoCobranca,
  valorCobrancaPeriodo,
  valorDiariaPorKilo,
} from '../lib/financeiro/calculo'
import { dataArmazenagemNf } from '../lib/dataArmazenagem'
import { contratoAtivoCliente, tabelaById } from '../lib/financeiro/clientes'
import { downloadTextFile } from '../lib/relatorioEstoque'
import type {
  CicloCobranca,
  ClienteFinanceiro,
  ContratoCliente,
  FinanceiroData,
  RegraTempo,
  TabelaCobranca,
} from '../lib/financeiro/types'
import type { MovimentoRegistro, NotaFiscal } from '../types'

type SubAba = 'tabela' | 'contrato' | 'clientes' | 'entrada' | 'logica'

const FIN_ENTRADA_PAGE_SIZE = 8
const FIN_LOGICA_PAGE_SIZE = 10

type LinhaFinanceiroEntrada = {
  nf: ReturnType<typeof resumirNfArmazenada>
  nota: NotaFiscal | undefined
  cliente: ClienteFinanceiro | undefined
  contrato: ContratoCliente | null
  tabela: TabelaCobranca | null
  valorDiaria: number
  valorDiariaPeriodo: number
  valorVigente: number
  periodoInicio: string
  periodoFim: string
  diasPeriodo: number
  valorArmazenagem: number
  debitosEntrada: number
  paletesEntradaPeriodo: number
  qtdSaidasPeriodo: number
  valorPeriodo: number
  posicoes: number
}

type DetalheLogicaCobranca = {
  label: string
  valor: number
}

type LinhaLogicaCobranca = {
  nf: ReturnType<typeof resumirNfArmazenada>
  nota: NotaFiscal
  cliente: ClienteFinanceiro | undefined
  contrato: ContratoCliente | null
  tabela: TabelaCobranca | null
  entradaMovimento: MovimentoRegistro | undefined
  saidaMovimento: MovimentoRegistro | undefined
  posicoes: number
  pesoBase: number
  caixas: number
  paletes: number
  valorMercadoria: number
  fatorTempo: number
  detalhes: DetalheLogicaCobranca[]
  total: number
}

type Props = {
  data: FinanceiroData
  notas: NotaFiscal[]
  movimentos: MovimentoRegistro[]
  loading: boolean
  saving: boolean
  error: string | null
  onUpdate: (updater: (prev: FinanceiroData) => FinanceiroData) => void
  onSaveNow: (snapshot?: FinanceiroData) => Promise<void>
  onUpdateNotaDataArmazenagem: (nfId: string, data: string) => void
}

const SUBABAS: { id: SubAba; label: string }[] = [
  { id: 'tabela', label: 'Tabela de cobrança' },
  { id: 'contrato', label: 'Contrato' },
  { id: 'clientes', label: 'Clientes' },
  { id: 'entrada', label: 'Movimentação' },
  { id: 'logica', label: 'Lógica de cobrança' },
]

function parseNum(raw: string): number {
  const n = Number(raw.replace(',', '.'))
  return Number.isFinite(n) ? n : 0
}

function newId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
}

function dateInputValue(raw: string | undefined): string {
  if (!raw) return new Date().toISOString().slice(0, 10)
  const match = raw.match(/^\d{4}-\d{2}-\d{2}/)
  if (match) return match[0]
  const d = new Date(raw)
  return Number.isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10)
}

function parseDateInput(raw: string): Date | null {
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!match) return null
  const [, y, m, d] = match
  const parsed = new Date(Number(y), Number(m) - 1, Number(d))
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

function diasPeriodoCobranca(inicio: string, fim: string): number {
  const start = parseDateInput(inicio)
  const end = parseDateInput(fim)
  if (!start || !end) return 0
  const diff = Math.floor((end.getTime() - start.getTime()) / 86_400_000)
  return Math.max(0, diff + 1)
}

function dateToInputValueLocal(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

function todayInputValue(): string {
  return dateToInputValueLocal(new Date())
}

function inicioMesVigenteInputValue(): string {
  const hoje = new Date()
  return dateToInputValueLocal(new Date(hoje.getFullYear(), hoje.getMonth(), 1))
}

function csvEscapeFinanceiro(value: string | number | undefined | null): string {
  const s = value == null ? '' : String(value)
  if (/[",;\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`
  return s
}

function csvLineFinanceiro(cols: (string | number | undefined | null)[]): string {
  return cols.map(csvEscapeFinanceiro).join(';')
}

function numeroCsv(value: number): string {
  return value.toLocaleString('pt-BR', { maximumFractionDigits: 3 })
}

function totalPosicoesNota(nf: NotaFiscal | undefined): number {
  return nf?.items.reduce((s, it) => s + it.allocatedAddresses.length, 0) ?? 0
}

function totalPosicoesMovimento(mov: MovimentoRegistro | undefined): number {
  return mov?.itens.reduce((s, it) => s + it.addressIds.length, 0) ?? 0
}

function totalPaletesMovimento(mov: MovimentoRegistro | undefined): number {
  return mov?.itens.reduce((s, it) => s + (it.paletes ?? it.addressIds.length), 0) ?? 0
}

function totalCaixasMovimento(mov: MovimentoRegistro | undefined): number {
  return mov?.itens.reduce((s, it) => {
    const unidade = it.unidade.trim().toUpperCase()
    if (unidade === 'CX' || unidade === 'CAIXA' || unidade === 'FD' || unidade === 'FARDO') {
      return s + it.quantidade
    }
    return s
  }, 0) ?? 0
}

function valorMovimento(mov: MovimentoRegistro | undefined): number {
  return mov?.valorTotal ?? mov?.itens.reduce((s, it) => s + (it.valorTotal ?? 0), 0) ?? 0
}

function pesoMovimento(mov: MovimentoRegistro | undefined): number {
  return mov?.pesoLiquido ?? mov?.pesoBruto ?? mov?.itens.reduce((s, it) => s + (it.pesoLiquido ?? it.pesoBruto ?? 0), 0) ?? 0
}

function labelCiclo(ciclo: CicloCobranca | undefined): string {
  if (!ciclo) return 'Sem contrato'
  return ciclo === 'quinzenal' ? 'Quinzenal' : 'Mensal'
}

function labelRegraTempo(regra: RegraTempo | undefined): string {
  if (!regra) return 'Sem contrato'
  return regra === 'cheia' ? 'Cheia' : 'Proporcional'
}

function formatFatorFinanceiro(fator: number): string {
  if (Math.abs(fator - Math.round(fator)) < 0.01) return String(Math.round(fator))
  return fator.toLocaleString('pt-BR', { maximumFractionDigits: 2 })
}

function flagsContrato(contrato: ContratoCliente | null): string {
  if (!contrato) return 'Sem contrato ativo'
  const flags = [
    contrato.cobrarPosicaoPalete && 'Posição',
    contrato.cobrarKilo && 'Kilo',
    contrato.cobrarEntrada && 'Entrada',
    contrato.cobrarSaida && 'Saída',
  ].filter(Boolean)
  return flags.length ? flags.join(', ') : 'Nenhuma cobrança marcada'
}

function calcularDetalhesLogica({
  nf,
  contrato,
  tabela,
  posicoes,
  pesoBase,
  paletes,
}: {
  nf: ReturnType<typeof resumirNfArmazenada>
  contrato: ContratoCliente | null
  tabela: TabelaCobranca | null
  posicoes: number
  pesoBase: number
  paletes: number
}): { fatorTempo: number; detalhes: DetalheLogicaCobranca[]; total: number } {
  const cobranca = calcularCobrancaDetalhada(nf, contrato, tabela, { posicoes, pesoBase, paletes })
  return { fatorTempo: cobranca.fatorTempo, detalhes: cobranca.detalhes, total: cobranca.total }
}

export function FinanceiroPanel({
  data,
  notas,
  movimentos,
  loading,
  saving,
  error,
  onUpdate,
  onSaveNow,
  onUpdateNotaDataArmazenagem,
}: Props) {
  const [subAba, setSubAba] = useState<SubAba>('tabela')
  const [clienteSelecionado, setClienteSelecionado] = useState<string | null>(null)

  const resumoCliente = useMemo(() => {
    if (!clienteSelecionado) return null
    const cli = data.clientes.find((c) => c.cnpj === clienteSelecionado)
    if (!cli) return null
    const contrato = contratoAtivoCliente(data, cli.cnpj)
    const tabela = tabelaById(data, contrato?.tabelaId ?? null)
    return resumirClienteFinanceiro(cli.cnpj, cli.razaoSocial, contrato, tabela, notas, movimentos)
  }, [clienteSelecionado, data, notas, movimentos])

  if (loading) {
    return (
      <div className="financeiro-panel">
        <p className="muted">Carregando financeiro…</p>
      </div>
    )
  }

  return (
    <div className="financeiro-panel">
      {error && <p className="error">{error}</p>}
      {saving && <p className="muted fin-saving">Salvando…</p>}

      <div className="fin-subabas" role="tablist">
        {SUBABAS.map((a) => (
          <button
            key={a.id}
            type="button"
            role="tab"
            className={`fin-subaba ${subAba === a.id ? 'fin-subaba--active' : ''}`}
            aria-selected={subAba === a.id}
            onClick={() => setSubAba(a.id)}
          >
            {a.label}
          </button>
        ))}
      </div>

      {subAba === 'tabela' && (
        <TabelaCobrancaSection data={data} onUpdate={onUpdate} onSaveNow={onSaveNow} />
      )}
      {subAba === 'contrato' && (
        <ContratoSection data={data} onUpdate={onUpdate} onSaveNow={onSaveNow} />
      )}
      {subAba === 'clientes' && (
        <ClientesSection
          data={data}
          resumoCliente={resumoCliente}
          clienteSelecionado={clienteSelecionado}
          onSelectCliente={setClienteSelecionado}
          onUpdate={onUpdate}
          onSaveNow={onSaveNow}
        />
      )}
      {subAba === 'entrada' && (
        <DataEntradaSection
          data={data}
          notas={notas}
          movimentos={movimentos}
          onUpdateNotaDataArmazenagem={onUpdateNotaDataArmazenagem}
          onSelectCliente={(cnpj) => {
            setClienteSelecionado(cnpj)
            setSubAba('clientes')
          }}
        />
      )}
      {subAba === 'logica' && (
        <LogicaCobrancaSection
          data={data}
          notas={notas}
          movimentos={movimentos}
          onSelectCliente={(cnpj) => {
            setClienteSelecionado(cnpj)
            setSubAba('clientes')
          }}
        />
      )}
    </div>
  )
}

/* ─── Tabela de cobrança ─── */

function TabelaCobrancaSection({
  data,
  onUpdate,
  onSaveNow,
}: {
  data: FinanceiroData
  onUpdate: Props['onUpdate']
  onSaveNow: Props['onSaveNow']
}) {
  const [editId, setEditId] = useState<string | null>(null)
  const [nome, setNome] = useState('')
  const [cPosicao, setCPosicao] = useState('')
  const [cKilo, setCKilo] = useState('')
  const [cPalete, setCPalete] = useState('')
  const [cEntrada, setCEntrada] = useState('')
  const [cSaida, setCSaida] = useState('')

  function resetForm() {
    setEditId(null)
    setNome('')
    setCPosicao('')
    setCKilo('')
    setCPalete('')
    setCEntrada('')
    setCSaida('')
  }

  function loadEdit(t: TabelaCobranca) {
    setEditId(t.id)
    setNome(t.nome)
    setCPosicao(String(t.custoPosicaoPalete))
    setCKilo(String(t.custoPorKilo))
    setCPalete(String(t.custoPorPalete))
    setCEntrada(String(t.custoEntrada))
    setCSaida(String(t.custoSaida))
  }

  function handleSalvar() {
    const trimmed = nome.trim()
    if (!trimmed) return
    const tabela: TabelaCobranca = {
      id: editId ?? newId('tab'),
      nome: trimmed,
      custoPosicaoPalete: parseNum(cPosicao),
      custoPorKilo: parseNum(cKilo),
      custoPorPalete: parseNum(cPalete),
      custoEntrada: parseNum(cEntrada),
      custoSaida: parseNum(cSaida),
      criadoEm: editId
        ? (data.tabelas.find((t) => t.id === editId)?.criadoEm ?? new Date().toISOString())
        : new Date().toISOString(),
    }
    const next: FinanceiroData = {
      ...data,
      tabelas: editId
        ? data.tabelas.map((t) => (t.id === editId ? tabela : t))
        : [tabela, ...data.tabelas],
    }
    onUpdate(() => next)
    resetForm()
    void onSaveNow(next)
  }

  function handleExcluir(id: string) {
    if (data.contratos.some((c) => c.tabelaId === id)) return
    const next: FinanceiroData = {
      ...data,
      tabelas: data.tabelas.filter((t) => t.id !== id),
    }
    onUpdate(() => next)
    if (editId === id) resetForm()
    void onSaveNow(next)
  }

  return (
    <div className="fin-section">
      <div className="sidebar-block">
        <h4>{editId ? 'Editar tabela' : 'Nova tabela de cobrança'}</h4>
        <label className="nf-itens-campo">
          <span>Nome da tabela</span>
          <input type="text" className="input-nf" value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Ex.: Padrão congelados" />
        </label>
        <div className="fin-grid-2">
          <label className="nf-itens-campo">
            <span>Custo por posição palete (R$)</span>
            <input type="text" className="input-nf" value={cPosicao} onChange={(e) => setCPosicao(e.target.value)} placeholder="0,00" />
          </label>
          <label className="nf-itens-campo">
            <span>Custo por quilo (R$)</span>
            <input type="text" className="input-nf" value={cKilo} onChange={(e) => setCKilo(e.target.value)} placeholder="0,00" />
          </label>
          <label className="nf-itens-campo">
            <span>Custo por palete (R$)</span>
            <input type="text" className="input-nf" value={cPalete} onChange={(e) => setCPalete(e.target.value)} placeholder="0,00" />
          </label>
          <label className="nf-itens-campo">
            <span>Custo de entrada (R$/palete)</span>
            <input type="text" className="input-nf" value={cEntrada} onChange={(e) => setCEntrada(e.target.value)} placeholder="0,00" />
          </label>
          <label className="nf-itens-campo">
            <span>Custo de saída (R$/palete)</span>
            <input type="text" className="input-nf" value={cSaida} onChange={(e) => setCSaida(e.target.value)} placeholder="0,00" />
          </label>
        </div>
        <div className="fin-actions">
          <button type="button" className="btn primary" onClick={handleSalvar} disabled={!nome.trim()}>
            {editId ? 'Atualizar' : 'Cadastrar tabela'}
          </button>
          {editId && (
            <button type="button" className="btn" onClick={resetForm}>
              Cancelar
            </button>
          )}
        </div>
      </div>

      <div className="sidebar-block fin-tabelas-cadastradas">
        <div className="fin-block-title">
          <div>
            <h4>Tabelas cadastradas</h4>
            <p className="muted">As tabelas salvas aqui aparecem no cadastro de contrato.</p>
          </div>
          <span className="fin-count">{data.tabelas.length}</span>
        </div>

        {data.tabelas.length === 0 ? (
          <p className="muted fin-empty">
            Nenhuma tabela cadastrada ainda. Preencha os valores acima e clique em Cadastrar tabela.
          </p>
        ) : (
          <ul className="fin-lista">
            {data.tabelas.map((t) => {
              const contratosVinculados = data.contratos.filter((c) => c.tabelaId === t.id).length
              return (
                <li key={t.id} className="fin-lista-item">
                  <div className="fin-lista-main">
                    <strong>{t.nome}</strong>
                    <span className="muted fin-lista-detalhe">
                      Posição {formatMoedaFinanceiro(t.custoPosicaoPalete)} · Kilo{' '}
                      {formatMoedaFinanceiro(t.custoPorKilo)} · Palete{' '}
                      {formatMoedaFinanceiro(t.custoPorPalete)} · Entrada{' '}
                      {formatMoedaFinanceiro(t.custoEntrada)} · Saída{' '}
                      {formatMoedaFinanceiro(t.custoSaida)}
                    </span>
                    {contratosVinculados > 0 && (
                      <span className="muted fin-lista-detalhe">
                        Em uso em {contratosVinculados} contrato{contratosVinculados > 1 ? 's' : ''}
                      </span>
                    )}
                  </div>
                  <div className="fin-lista-btns">
                    <button type="button" className="btn btn-sm" onClick={() => loadEdit(t)}>
                      Editar
                    </button>
                    <button
                      type="button"
                      className="btn btn-sm btn-danger"
                      onClick={() => handleExcluir(t.id)}
                      disabled={contratosVinculados > 0}
                      title={contratosVinculados > 0 ? 'Remova ou altere os contratos antes de excluir esta tabela.' : undefined}
                    >
                      Excluir
                    </button>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </div>
  )
}

/* ─── Contrato ─── */

function ContratoSection({
  data,
  onUpdate,
  onSaveNow,
}: {
  data: FinanceiroData
  onUpdate: Props['onUpdate']
  onSaveNow: Props['onSaveNow']
}) {
  const [editId, setEditId] = useState<string | null>(null)
  const [cnpj, setCnpj] = useState('')
  const [razao, setRazao] = useState('')
  const [tabelaId, setTabelaId] = useState('')
  const [ciclo, setCiclo] = useState<CicloCobranca>('mensal')
  const [regraTempo, setRegraTempo] = useState<RegraTempo>('proporcional')
  const [cobPosicao, setCobPosicao] = useState(false)
  const [cobKilo, setCobKilo] = useState(false)
  const [cobEntrada, setCobEntrada] = useState(false)
  const [cobSaida, setCobSaida] = useState(false)
  const [obs, setObs] = useState('')
  const podeSalvar = Boolean(cnpj.trim() && razao.trim() && tabelaId)

  function resetForm() {
    setEditId(null)
    setCnpj('')
    setRazao('')
    setTabelaId('')
    setCiclo('mensal')
    setRegraTempo('proporcional')
    setCobPosicao(false)
    setCobKilo(false)
    setCobEntrada(false)
    setCobSaida(false)
    setObs('')
  }

  function loadEdit(c: ContratoCliente) {
    setEditId(c.id)
    setCnpj(c.cnpj)
    setRazao(c.razaoSocial)
    setTabelaId(c.tabelaId ?? '')
    setCiclo(c.ciclo)
    setRegraTempo(c.regraTempo)
    setCobPosicao(c.cobrarPosicaoPalete)
    setCobKilo(c.cobrarKilo)
    setCobEntrada(c.cobrarEntrada)
    setCobSaida(c.cobrarSaida)
    setObs(c.observacao ?? '')
  }

  function handleSelectCliente(cnpjKey: string) {
    const cli = data.clientes.find((c) => c.cnpj === cnpjKey)
    if (cli) {
      setCnpj(cli.cnpj)
      setRazao(cli.razaoSocial)
    }
  }

  function handleSalvar() {
    const cnpjNorm = normalizarCnpj(cnpj) || cnpj.trim()
    const razaoTrim = razao.trim()
    if (!cnpjNorm || !razaoTrim || !tabelaId) return

    const contrato: ContratoCliente = {
      id: editId ?? newId('ctr'),
      cnpj: cnpjNorm,
      razaoSocial: razaoTrim,
      tabelaId,
      ciclo,
      regraTempo,
      cobrarPosicaoPalete: cobPosicao,
      cobrarKilo: cobKilo,
      cobrarPalete: false,
      cobrarEntrada: cobEntrada,
      cobrarSaida: cobSaida,
      kiloPorDia: false,
      ativo: true,
      ...(obs.trim() ? { observacao: obs.trim() } : {}),
      criadoEm: editId
        ? (data.contratos.find((c) => c.id === editId)?.criadoEm ?? new Date().toISOString())
        : new Date().toISOString(),
    }

    const clientes = data.clientes.some((c) => c.cnpj === cnpjNorm)
      ? data.clientes
      : [
          {
            cnpj: cnpjNorm,
            razaoSocial: razaoTrim,
            origem: 'manual' as const,
            criadoEm: new Date().toISOString(),
          },
          ...data.clientes,
        ]
    const next: FinanceiroData = {
      ...data,
      clientes,
      contratos: editId
        ? data.contratos.map((c) => (c.id === editId ? contrato : c))
        : [contrato, ...data.contratos],
    }
    onUpdate(() => next)
    resetForm()
    void onSaveNow(next)
  }

  function handleExcluir(id: string) {
    const next: FinanceiroData = {
      ...data,
      contratos: data.contratos.filter((c) => c.id !== id),
    }
    onUpdate(() => next)
    if (editId === id) resetForm()
    void onSaveNow(next)
  }

  return (
    <div className="fin-section">
      <div className="sidebar-block">
        <h4>{editId ? 'Editar contrato' : 'Novo contrato de armazenagem'}</h4>

        {data.clientes.length > 0 && (
          <label className="nf-itens-campo">
            <span>Cliente cadastrado</span>
            <select
              className="input-nf"
              value=""
              onChange={(e) => {
                if (e.target.value) handleSelectCliente(e.target.value)
              }}
            >
              <option value="">Selecionar cliente…</option>
              {data.clientes.map((c) => (
                <option key={c.cnpj} value={c.cnpj}>
                  {c.razaoSocial} {c.cnpj.startsWith('nome:') ? '' : `(${formatarCnpj(c.cnpj)})`}
                </option>
              ))}
            </select>
          </label>
        )}

        <div className="fin-grid-2">
          <label className="nf-itens-campo">
            <span>CNPJ</span>
            <input type="text" className="input-nf" value={cnpj} onChange={(e) => setCnpj(e.target.value)} placeholder="00.000.000/0000-00" />
          </label>
          <label className="nf-itens-campo">
            <span>Razão social</span>
            <input type="text" className="input-nf" value={razao} onChange={(e) => setRazao(e.target.value)} />
          </label>
        </div>

        <label className="nf-itens-campo">
          <span>Tabela de cobrança</span>
          <select
            className="input-nf"
            value={tabelaId}
            onChange={(e) => setTabelaId(e.target.value)}
            disabled={data.tabelas.length === 0}
          >
            <option value="">
              {data.tabelas.length === 0 ? 'Cadastre uma tabela primeiro' : 'Selecione uma tabela'}
            </option>
            {data.tabelas.map((t) => (
              <option key={t.id} value={t.id}>
                {t.nome}
              </option>
            ))}
          </select>
          <span className="muted fin-input-help">
            {data.tabelas.length === 0
              ? 'Crie a tabela na aba Tabela de cobrança para poder vincular ao contrato.'
              : 'O contrato usará os valores da tabela escolhida para calcular a cobrança.'}
          </span>
        </label>

        <div className="fin-grid-2">
          <fieldset className="fin-fieldset">
            <legend>Ciclo de cobrança</legend>
            <label className="fin-check">
              <input type="radio" name="fin-ciclo" checked={ciclo === 'mensal'} onChange={() => setCiclo('mensal')} />
              Mensal
            </label>
            <label className="fin-check">
              <input type="radio" name="fin-ciclo" checked={ciclo === 'quinzenal'} onChange={() => setCiclo('quinzenal')} />
              Quinzenal
            </label>
          </fieldset>

          <fieldset className="fin-fieldset">
            <legend>Regra de tempo</legend>
            <label className="fin-check">
              <input type="radio" name="fin-regra" checked={regraTempo === 'proporcional'} onChange={() => setRegraTempo('proporcional')} />
              Proporcional (por dias)
            </label>
            <label className="fin-check">
              <input type="radio" name="fin-regra" checked={regraTempo === 'cheia'} onChange={() => setRegraTempo('cheia')} />
              Cheia (período inteiro)
            </label>
          </fieldset>
        </div>

        <fieldset className="fin-fieldset fin-cobrancas">
          <legend>O que cobrar</legend>
          <div className="fin-check-grid">
            <label className="fin-check">
              <input type="checkbox" checked={cobPosicao} onChange={(e) => setCobPosicao(e.target.checked)} />
              Posição palete
            </label>
            <label className="fin-check">
              <input type="checkbox" checked={cobKilo} onChange={(e) => setCobKilo(e.target.checked)} />
              Por quilo
            </label>
            <label className="fin-check">
              <input type="checkbox" checked={cobEntrada} onChange={(e) => setCobEntrada(e.target.checked)} />
              Entrada
            </label>
            <label className="fin-check">
              <input type="checkbox" checked={cobSaida} onChange={(e) => setCobSaida(e.target.checked)} />
              Saída
            </label>
          </div>
        </fieldset>

        <label className="nf-itens-campo">
          <span>Observação</span>
          <input type="text" className="input-nf" value={obs} onChange={(e) => setObs(e.target.value)} placeholder="Opcional" />
        </label>

        <div className="fin-actions">
          <button type="button" className="btn primary" onClick={handleSalvar} disabled={!podeSalvar}>
            {editId ? 'Atualizar contrato' : 'Cadastrar contrato'}
          </button>
          {editId && (
            <button type="button" className="btn" onClick={resetForm}>
              Cancelar
            </button>
          )}
        </div>
      </div>

      {data.contratos.length > 0 && (
        <div className="sidebar-block">
          <h4>Contratos ({data.contratos.length})</h4>
          <ul className="fin-lista">
            {data.contratos.map((c) => {
              const tab = data.tabelas.find((t) => t.id === c.tabelaId)
              const flags = [
                c.cobrarPosicaoPalete && 'Posição',
                c.cobrarKilo && 'Kilo',
                c.cobrarEntrada && 'Entrada',
                c.cobrarSaida && 'Saída',
              ].filter(Boolean)
              return (
                <li key={c.id} className="fin-lista-item">
                  <div className="fin-lista-main">
                    <strong>{c.razaoSocial}</strong>
                    <span className="muted">
                      {c.cnpj.startsWith('nome:') ? c.cnpj.slice(5) : formatarCnpj(c.cnpj)}
                    </span>
                    <span className="muted fin-lista-detalhe">
                      {c.ciclo === 'quinzenal' ? 'Quinzenal' : 'Mensal'} ·{' '}
                      {c.regraTempo === 'cheia' ? 'Cheia' : 'Proporcional'}
                      {tab ? ` · ${tab.nome}` : ''}
                      {flags.length ? ` · ${flags.join(', ')}` : ''}
                    </span>
                  </div>
                  <div className="fin-lista-btns">
                    <button type="button" className="btn btn-sm" onClick={() => loadEdit(c)}>
                      Editar
                    </button>
                    <button type="button" className="btn btn-sm btn-danger" onClick={() => handleExcluir(c.id)}>
                      Excluir
                    </button>
                  </div>
                </li>
              )
            })}
          </ul>
        </div>
      )}
    </div>
  )
}

/* ─── Clientes cadastrados ─── */

function ClientesSection({
  data,
  resumoCliente,
  clienteSelecionado,
  onSelectCliente,
  onUpdate,
  onSaveNow,
}: {
  data: FinanceiroData
  resumoCliente: ReturnType<typeof resumirClienteFinanceiro> | null
  clienteSelecionado: string | null
  onSelectCliente: (cnpj: string | null) => void
  onUpdate: Props['onUpdate']
  onSaveNow: Props['onSaveNow']
}) {
  const [cnpjManual, setCnpjManual] = useState('')
  const [razaoManual, setRazaoManual] = useState('')

  function handleCadastrarManual() {
    const cnpjNorm = normalizarCnpj(cnpjManual) || cnpjManual.trim()
    const razao = razaoManual.trim()
    if (!cnpjNorm || !razao) return
    if (data.clientes.some((c) => c.cnpj === cnpjNorm)) return

    const novo: ClienteFinanceiro = {
      cnpj: cnpjNorm,
      razaoSocial: razao,
      origem: 'manual',
      criadoEm: new Date().toISOString(),
    }
    const next: FinanceiroData = {
      ...data,
      clientes: [novo, ...data.clientes],
    }
    onUpdate(() => next)
    setCnpjManual('')
    setRazaoManual('')
    void onSaveNow(next)
  }

  return (
    <div className="fin-section">
      <div className="sidebar-block">
        <h4>Cadastrar cliente manualmente</h4>
        <div className="fin-grid-2">
          <label className="nf-itens-campo">
            <span>CNPJ</span>
            <input type="text" className="input-nf" value={cnpjManual} onChange={(e) => setCnpjManual(e.target.value)} />
          </label>
          <label className="nf-itens-campo">
            <span>Razão social</span>
            <input type="text" className="input-nf" value={razaoManual} onChange={(e) => setRazaoManual(e.target.value)} />
          </label>
        </div>
        <button
          type="button"
          className="btn primary"
          onClick={handleCadastrarManual}
          disabled={!cnpjManual.trim() || !razaoManual.trim()}
        >
          Cadastrar
        </button>
        <p className="muted fin-hint">Clientes também são cadastrados automaticamente ao dar entrada de NF.</p>
      </div>

      <div className="sidebar-block">
        <h4>Clientes cadastrados ({data.clientes.length})</h4>
        {data.clientes.length === 0 ? (
          <p className="muted">Nenhum cliente ainda. Dê entrada de uma NF ou cadastre manualmente.</p>
        ) : (
          <ul className="fin-lista">
            {data.clientes.map((c) => (
              <li key={c.cnpj}>
                <button
                  type="button"
                  className={`fin-cliente-btn ${clienteSelecionado === c.cnpj ? 'fin-cliente-btn--active' : ''}`}
                  onClick={() => onSelectCliente(clienteSelecionado === c.cnpj ? null : c.cnpj)}
                >
                  <strong>{c.razaoSocial}</strong>
                  <span className="muted">
                    {c.cnpj.startsWith('nome:') ? 'Sem CNPJ no XML' : formatarCnpj(c.cnpj)}
                    {' · '}
                    {c.origem === 'auto' ? 'Auto' : 'Manual'}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {resumoCliente && (
        <div className="sidebar-block fin-cliente-detalhe">
          <h4>{resumoCliente.razaoSocial}</h4>
          {!resumoCliente.contrato && (
            <p className="muted fin-aviso">Sem contrato ativo — cadastre um contrato para calcular cobranças.</p>
          )}

          <div className="fin-resumo-cards">
            <article className="fin-resumo-card">
              <span className="muted">NFs armazenadas</span>
              <strong>{resumoCliente.nfsArmazenadas.length}</strong>
            </article>
            <article className="fin-resumo-card">
              <span className="muted">NFs finalizadas</span>
              <strong>{resumoCliente.nfsFinalizadas.length}</strong>
            </article>
            <article className="fin-resumo-card fin-resumo-card--destaque">
              <span className="muted">Total a cobrar</span>
              <strong>{formatMoedaFinanceiro(resumoCliente.totalGeral)}</strong>
            </article>
          </div>

          {resumoCliente.nfsArmazenadas.length > 0 && (
            <>
              <h5>Notas em armazenagem</h5>
              <ul className="fin-nf-lista">
                {resumoCliente.nfsArmazenadas.map((nf) => {
                  const cob = resumoCliente.cobrancas.find((c) => c.nfId === nf.nfId)
                  return (
                    <li key={nf.nfId} className="fin-nf-item">
                      <div className="fin-nf-header">
                        <strong>NF {nf.nfNumero}</strong>
                        <span className="fin-badge fin-badge--ativo">Armazenada</span>
                      </div>
                      <div className="fin-nf-stats muted">
                        Armazenagem {formatarDataBr(nf.dataEntrada)} · {nf.diasArmazenados} dias ·{' '}
                        {formatPesoBruto(nf.pesoRestante > 0 ? nf.pesoRestante : nf.pesoEntrada)} kg ·{' '}
                        {nf.totalItens} itens ·{' '}
                        {formatQuantidadeNfe(nf.totalCaixas)} CX · {nf.totalPaletes} paletes
                      </div>
                      {cob && cob.detalhes.length > 0 && (
                        <ul className="fin-cobranca-detalhes">
                          {cob.detalhes.map((d, i) => (
                            <li key={i}>
                              {d.label}: <strong>{formatMoedaFinanceiro(d.valor)}</strong>
                            </li>
                          ))}
                          <li className="fin-cobranca-total">
                            Total NF: <strong>{formatMoedaFinanceiro(cob.total)}</strong>
                          </li>
                        </ul>
                      )}
                    </li>
                  )
                })}
              </ul>
            </>
          )}

          {resumoCliente.nfsFinalizadas.length > 0 && (
            <>
              <h5>Notas finalizadas (saída concluída)</h5>
              <ul className="fin-nf-lista">
                {resumoCliente.nfsFinalizadas.map((nf) => {
                  const cob = resumoCliente.cobrancas.find((c) => c.nfId === nf.nfId)
                  return (
                    <li key={nf.nfId} className="fin-nf-item fin-nf-item--finalizada">
                      <div className="fin-nf-header">
                        <strong>NF {nf.nfNumero}</strong>
                        <span className="fin-badge fin-badge--finalizada">Finalizada</span>
                      </div>
                      <div className="fin-nf-stats muted">
                        Armazenagem {formatarDataBr(nf.dataEntrada)} →{' '}
                        {nf.dataSaida ? formatarDataBr(nf.dataSaida) : '—'} · {nf.diasArmazenados} dias ·{' '}
                        {formatPesoBruto(nf.pesoLiquido)} kg
                      </div>
                      {cob && (
                        <div className="fin-cobranca-total muted">
                          Cobrança final: <strong>{formatMoedaFinanceiro(cob.total)}</strong>
                        </div>
                      )}
                    </li>
                  )
                })}
              </ul>
            </>
          )}

          {resumoCliente.nfsArmazenadas.length === 0 && resumoCliente.nfsFinalizadas.length === 0 && (
            <p className="muted">Nenhuma NF vinculada a este cliente.</p>
          )}
        </div>
      )}
    </div>
  )
}

/* ─── Lógica de cobrança ─── */

function LogicaCobrancaSection({
  data,
  notas,
  movimentos,
  onSelectCliente,
}: {
  data: FinanceiroData
  notas: NotaFiscal[]
  movimentos: MovimentoRegistro[]
  onSelectCliente: (cnpj: string) => void
}) {
  const [pagina, setPagina] = useState(1)

  const linhas = useMemo<LinhaLogicaCobranca[]>(
    () =>
      notas
        .map((nota) => {
          const nf = resumirNfArmazenada(nota, movimentos)
          const cliente = data.clientes.find((c) => {
            const cnpj = nf.emitenteCnpj ? normalizarCnpj(nf.emitenteCnpj) : ''
            return c.cnpj === cnpj || c.razaoSocial.trim().toLowerCase() === nf.emitente.trim().toLowerCase()
          })
          const contrato = cliente ? contratoAtivoCliente(data, cliente.cnpj) : null
          const tabela = tabelaById(data, contrato?.tabelaId ?? null)
          const entradaMovimento = movimentos.find((m) => m.tipo === 'entrada' && m.nfId === nf.nfId && !m.excluido)
          const saidaMovimento = movimentos
            .filter((m) => m.tipo === 'saida' && m.nfId === nf.nfId && !m.excluido)
            .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0]
          const posicoes = Math.max(totalPosicoesNota(nota), totalPosicoesMovimento(entradaMovimento))
          const pesoBase =
            nf.status === 'armazenada'
              ? nf.pesoRestante > 0
                ? nf.pesoRestante
                : nf.pesoEntrada
              : nf.pesoEntrada || nf.pesoLiquido || nf.pesoBruto || pesoMovimento(entradaMovimento)
          const caixas = Math.max(nf.totalCaixas, totalCaixasMovimento(entradaMovimento))
          const paletes = Math.max(nf.totalPaletes, totalPaletesMovimento(entradaMovimento))
          const valorMercadoria = nf.valorMercadoria || valorMovimento(entradaMovimento)
          const calculo = calcularDetalhesLogica({
            nf,
            contrato,
            tabela,
            posicoes,
            pesoBase,
            paletes,
          })
          return {
            nf,
            nota,
            cliente,
            contrato,
            tabela,
            entradaMovimento,
            saidaMovimento,
            posicoes,
            pesoBase,
            caixas,
            paletes,
            valorMercadoria,
            ...calculo,
          }
        })
        .sort((a, b) => {
          if (a.nf.status !== b.nf.status) return a.nf.status === 'armazenada' ? -1 : 1
          return b.nf.dataEntrada.localeCompare(a.nf.dataEntrada)
        }),
    [data, movimentos, notas],
  )

  const resumo = useMemo(
    () =>
      linhas.reduce(
        (acc, linha) => ({
          nfs: acc.nfs + 1,
          armazenadas: acc.armazenadas + (linha.nf.status === 'armazenada' ? 1 : 0),
          finalizadas: acc.finalizadas + (linha.nf.status === 'finalizada' ? 1 : 0),
          semContrato: acc.semContrato + (!linha.contrato ? 1 : 0),
          semTabela: acc.semTabela + (linha.contrato && !linha.tabela ? 1 : 0),
          dias: acc.dias + linha.nf.diasArmazenados,
          total: acc.total + linha.total,
        }),
        {
          nfs: 0,
          armazenadas: 0,
          finalizadas: 0,
          semContrato: 0,
          semTabela: 0,
          dias: 0,
          total: 0,
        },
      ),
    [linhas],
  )

  const totalPaginas = Math.max(1, Math.ceil(linhas.length / FIN_LOGICA_PAGE_SIZE))
  const paginaAtual = Math.min(pagina, totalPaginas)
  const inicio = (paginaAtual - 1) * FIN_LOGICA_PAGE_SIZE
  const linhasPagina = linhas.slice(inicio, inicio + FIN_LOGICA_PAGE_SIZE)
  const fim = Math.min(inicio + linhasPagina.length, linhas.length)

  if (linhas.length === 0) {
    return (
      <div className="fin-section">
        <p className="muted">Nenhuma NF encontrada para lógica de cobrança.</p>
      </div>
    )
  }

  return (
    <div className="fin-section">
      <div className="sidebar-block fin-logica-resumo">
        <div className="fin-entrada-resumo-head">
          <h4>Lógica de cobrança</h4>
          <span className="muted">Inclui NFs armazenadas e finalizadas.</span>
        </div>
        <div className="fin-entrada-resumo-grid">
          <div className="fin-entrada-resumo-card fin-entrada-resumo-card--destaque">
            <span>Total calculado</span>
            <strong>{formatMoedaFinanceiro(resumo.total)}</strong>
          </div>
          <div className="fin-entrada-resumo-card">
            <span>NFs</span>
            <strong>{resumo.nfs}</strong>
          </div>
          <div className="fin-entrada-resumo-card">
            <span>Armazenadas</span>
            <strong>{resumo.armazenadas}</strong>
          </div>
          <div className="fin-entrada-resumo-card">
            <span>Finalizadas</span>
            <strong>{resumo.finalizadas}</strong>
          </div>
          <div className="fin-entrada-resumo-card">
            <span>Dias somados</span>
            <strong>{resumo.dias}</strong>
          </div>
          <div className="fin-entrada-resumo-card">
            <span>Sem contrato</span>
            <strong>{resumo.semContrato}</strong>
          </div>
          <div className="fin-entrada-resumo-card">
            <span>Sem tabela</span>
            <strong>{resumo.semTabela}</strong>
          </div>
        </div>
      </div>

      <div className="fin-paginacao fin-paginacao--top">
        <span>
          Mostrando {inicio + 1}-{fim} de {linhas.length}
        </span>
        <div>
          <button
            type="button"
            className="btn btn-sm"
            disabled={paginaAtual <= 1}
            onClick={() => setPagina(Math.max(1, paginaAtual - 1))}
          >
            Anterior
          </button>
          <strong>
            Página {paginaAtual} de {totalPaginas}
          </strong>
          <button
            type="button"
            className="btn btn-sm"
            disabled={paginaAtual >= totalPaginas}
            onClick={() => setPagina(Math.min(totalPaginas, paginaAtual + 1))}
          >
            Próxima
          </button>
        </div>
      </div>

      <ul className="fin-logica-lista">
        {linhasPagina.map((linha) => (
          <li key={linha.nf.nfId} className="fin-logica-item">
            <div className="fin-logica-head">
              <div>
                <strong>NF {linha.nf.nfNumero}</strong>
                <span>{linha.nf.emitente}</span>
              </div>
              <span className={`fin-badge ${linha.nf.status === 'armazenada' ? 'fin-badge--ativo' : 'fin-badge--finalizada'}`}>
                {linha.nf.status === 'armazenada' ? 'Armazenada' : 'Finalizada'}
              </span>
            </div>

            <div className="fin-logica-grid">
              <div>
                <span>Cliente financeiro</span>
                <strong>{linha.cliente?.razaoSocial ?? 'Sem cliente vinculado'}</strong>
                {linha.cliente && (
                  <button type="button" className="btn-link fin-link-cliente" onClick={() => onSelectCliente(linha.cliente!.cnpj)}>
                    Ver cliente →
                  </button>
                )}
              </div>
              <div>
                <span>CNPJ</span>
                <strong>{linha.nf.emitenteCnpj ? formatarCnpj(linha.nf.emitenteCnpj) : '—'}</strong>
              </div>
              <div>
                <span>Data de armazenagem</span>
                <strong>{formatarDataBr(linha.nf.dataEntrada)}</strong>
              </div>
              <div>
                <span>Entrada registrada</span>
                <strong>{formatarDataHoraBr(linha.entradaMovimento?.createdAt ?? linha.nota.createdAt)}</strong>
              </div>
              <div>
                <span>Saída registrada</span>
                <strong>{linha.nf.dataSaida ? formatarDataHoraBr(linha.nf.dataSaida) : 'Em estoque'}</strong>
              </div>
              <div>
                <span>NF de saída</span>
                <strong>{linha.saidaMovimento?.nfSaida?.numero ?? '—'}</strong>
              </div>
              <div>
                <span>Tempo armazenado</span>
                <strong>{linha.nf.diasArmazenados} dia(s)</strong>
              </div>
              <div>
                <span>Ciclo de cobrança</span>
                <strong>{labelCiclo(linha.contrato?.ciclo)}</strong>
              </div>
              <div>
                <span>Regra de tempo</span>
                <strong>{labelRegraTempo(linha.contrato?.regraTempo)}</strong>
              </div>
              <div>
                <span>Fator aplicado</span>
                <strong>{linha.fatorTempo > 0 ? formatFatorFinanceiro(linha.fatorTempo) : '—'}</strong>
              </div>
              <div>
                <span>Tabela</span>
                <strong>{linha.tabela?.nome ?? (linha.contrato ? 'Sem tabela' : '—')}</strong>
              </div>
              <div>
                <span>O que cobra</span>
                <strong>{flagsContrato(linha.contrato)}</strong>
              </div>
              <div>
                <span>Peso base</span>
                <strong>{formatPesoBruto(linha.pesoBase)} kg</strong>
              </div>
              <div>
                <span>Caixas</span>
                <strong>{formatQuantidadeNfe(linha.caixas)}</strong>
              </div>
              <div>
                <span>Paletes</span>
                <strong>{linha.paletes}</strong>
              </div>
              <div>
                <span>Posições</span>
                <strong>{linha.posicoes}</strong>
              </div>
              <div>
                <span>Valor mercadoria</span>
                <strong>{formatValorNfe(linha.valorMercadoria)}</strong>
              </div>
            </div>

            <div className="fin-logica-cobranca">
              <div className="fin-logica-cobranca-head">
                <strong>Composição da cobrança</strong>
                <span>{formatMoedaFinanceiro(linha.total)}</span>
              </div>
              {linha.detalhes.length === 0 ? (
                <p className="muted">Sem valor calculado. Verifique contrato ativo, tabela e opções de cobrança.</p>
              ) : (
                <ul>
                  {linha.detalhes.map((detalhe) => (
                    <li key={detalhe.label}>
                      <span>{detalhe.label}</span>
                      <strong>{formatMoedaFinanceiro(detalhe.valor)}</strong>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </li>
        ))}
      </ul>

      {totalPaginas > 1 && (
        <div className="fin-paginacao">
          <span>
            Mostrando {inicio + 1}-{fim} de {linhas.length}
          </span>
          <div>
            <button
              type="button"
              className="btn btn-sm"
              disabled={paginaAtual <= 1}
              onClick={() => setPagina(Math.max(1, paginaAtual - 1))}
            >
              Anterior
            </button>
            <strong>
              Página {paginaAtual} de {totalPaginas}
            </strong>
            <button
              type="button"
              className="btn btn-sm"
              disabled={paginaAtual >= totalPaginas}
              onClick={() => setPagina(Math.min(totalPaginas, paginaAtual + 1))}
            >
              Próxima
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

/* ─── Movimentação ─── */

function DataEntradaSection({
  data,
  notas,
  movimentos,
  onUpdateNotaDataArmazenagem,
  onSelectCliente,
}: {
  data: FinanceiroData
  notas: NotaFiscal[]
  movimentos: MovimentoRegistro[]
  onUpdateNotaDataArmazenagem: Props['onUpdateNotaDataArmazenagem']
  onSelectCliente: (cnpj: string) => void
}) {
  const [filtroCliente, setFiltroCliente] = useState('')
  const [periodosCobranca, setPeriodosCobranca] = useState<
    Record<string, { inicio: string; fim: string }>
  >({})
  const [periodoMassa, setPeriodoMassa] = useState(() => ({
    inicio: inicioMesVigenteInputValue(),
    fim: todayInputValue(),
  }))
  const [nfsMarcadas, setNfsMarcadas] = useState<Set<string>>(() => new Set())
  const [paginaEntrada, setPaginaEntrada] = useState(1)

  const resumos = useMemo(
    () => notas.map((nf) => resumirNfArmazenada(nf, movimentos)),
    [notas, movimentos],
  )

  const notasById = useMemo(() => new Map(notas.map((nf) => [nf.id, nf])), [notas])

  const filtrados = useMemo(() => {
    if (!filtroCliente) return resumos
    return resumos.filter((r) => {
      const cnpj = r.emitenteCnpj ? normalizarCnpj(r.emitenteCnpj) : ''
      return cnpj === filtroCliente || r.emitente.trim().toLowerCase().includes(filtroCliente.toLowerCase())
    })
  }, [resumos, filtroCliente])

  const linhasFinanceiro = useMemo<LinhaFinanceiroEntrada[]>(
    () =>
      filtrados.map((nf) => {
        const cliente = data.clientes.find((c) => {
          const cnpj = nf.emitenteCnpj ? normalizarCnpj(nf.emitenteCnpj) : ''
          return c.cnpj === cnpj || c.razaoSocial.trim().toLowerCase() === nf.emitente.trim().toLowerCase()
        })
        const contrato = cliente ? contratoAtivoCliente(data, cliente.cnpj) : null
        const tabela = tabelaById(data, contrato?.tabelaId ?? null)
        const nota = notasById.get(nf.nfId)
        const pesoCobranca = nf.pesoRestante > 0 ? nf.pesoRestante : nf.pesoEntrada
        const cobranca = calcularCobrancaDetalhada(nf, contrato, tabela, {
          posicoes: totalPosicoesNota(nota),
          pesoBase: pesoCobranca,
          paletes: nf.totalPaletes,
        })
        const valorDiaria = cobranca.valorDiaria
        const valorVigente = cobranca.valorVigente
        const periodo = periodosCobranca[nf.nfId]
        const periodoInicio = periodo?.inicio ?? inicioMesVigenteInputValue()
        const periodoFim = periodo?.fim ?? todayInputValue()
        const diasPeriodo = contrato?.cobrarKilo
          ? diasPeriodoCobrancaArmazenagem(
              periodoInicio,
              periodoFim,
              nf.dataEntrada,
              nf.dataUltimaSaida,
              nf.dataSaida,
              nf.status,
              nf.pesoAtual,
            )
          : diasPeriodoCobranca(periodoInicio, periodoFim)
        const teveSaida = nf.saidas.length > 0
        const pesoPeriodo =
          contrato?.cobrarKilo && tabela
            ? pesoBrutoParaCobrancaPeriodo(nf.pesoAtual, nf.pesoBruto, teveSaida)
            : pesoCobranca
        const valorDiariaPeriodo =
          contrato?.cobrarKilo && tabela && pesoPeriodo > 0
            ? valorDiariaPorKilo(pesoPeriodo, tabela.custoPorKilo, contrato.ciclo)
            : valorDiaria
        const valorArmazenagem = valorCobrancaPeriodo(diasPeriodo, valorDiariaPeriodo)
        const saidasPeriodo = saidasNoPeriodoCobranca(nf.saidas, periodoInicio, periodoFim)
        const entradaNoPeriodo = debitosEntradaPeriodo(
          nf.dataEntrada,
          nf.paletesEntrada,
          periodoInicio,
          periodoFim,
          contrato,
          tabela,
        )
        const debitosEntrada = entradaNoPeriodo
        const paletesEntradaPeriodo = entradaNoPeriodo > 0 ? nf.paletesEntrada : 0
        const valorPeriodo = Math.round((valorArmazenagem + debitosEntrada) * 100) / 100
        return {
          nf,
          nota,
          cliente,
          tabela,
          contrato,
          valorDiaria,
          valorDiariaPeriodo,
          valorVigente,
          periodoInicio,
          periodoFim,
          diasPeriodo,
          valorArmazenagem,
          debitosEntrada,
          paletesEntradaPeriodo,
          qtdSaidasPeriodo: saidasPeriodo.length,
          valorPeriodo,
          posicoes: totalPosicoesNota(nota),
        }
      }),
    [data, filtrados, notasById, periodosCobranca],
  )

  const resumoGeral = useMemo(
    () =>
      linhasFinanceiro.reduce(
        (acc, linha) => ({
          nfs: acc.nfs + 1,
          valorPeriodo: acc.valorPeriodo + linha.valorPeriodo,
          valorArmazenagem: acc.valorArmazenagem + linha.valorArmazenagem,
          debitosEntrada: acc.debitosEntrada + linha.debitosEntrada,
          valorVigente: acc.valorVigente + linha.valorVigente,
          posicoes: acc.posicoes + linha.posicoes,
          peso: acc.peso + (linha.nf.pesoRestante > 0 ? linha.nf.pesoRestante : linha.nf.pesoEntrada),
          caixas: acc.caixas + linha.nf.totalCaixas,
          paletes: acc.paletes + linha.nf.totalPaletes,
          itens: acc.itens + linha.nf.totalItens,
        }),
        {
          nfs: 0,
          valorPeriodo: 0,
          valorArmazenagem: 0,
          debitosEntrada: 0,
          valorVigente: 0,
          posicoes: 0,
          peso: 0,
          caixas: 0,
          paletes: 0,
          itens: 0,
        },
      ),
    [linhasFinanceiro],
  )

  const totalPaginasEntrada = Math.max(1, Math.ceil(linhasFinanceiro.length / FIN_ENTRADA_PAGE_SIZE))
  const paginaEntradaAtual = Math.min(paginaEntrada, totalPaginasEntrada)
  const inicioPaginaEntrada = (paginaEntradaAtual - 1) * FIN_ENTRADA_PAGE_SIZE
  const linhasPaginaEntrada = linhasFinanceiro.slice(
    inicioPaginaEntrada,
    inicioPaginaEntrada + FIN_ENTRADA_PAGE_SIZE,
  )
  const fimPaginaEntrada = Math.min(inicioPaginaEntrada + linhasPaginaEntrada.length, linhasFinanceiro.length)
  const nfsMarcadasFiltradas = linhasFinanceiro.filter((linha) => nfsMarcadas.has(linha.nf.nfId))
  const financeiroIncompleto =
    data.tabelas.length === 0 ||
    data.contratos.length === 0 ||
    linhasFinanceiro.some((l) => !l.cliente || !data.contratos.some((c) => c.cnpj === l.cliente?.cnpj && c.ativo))
  const todasPaginaMarcadas =
    linhasPaginaEntrada.length > 0 &&
    linhasPaginaEntrada.every((linha) => nfsMarcadas.has(linha.nf.nfId))

  function toggleNfMarcada(nfId: string, marcada: boolean) {
    setNfsMarcadas((prev) => {
      const next = new Set(prev)
      if (marcada) next.add(nfId)
      else next.delete(nfId)
      return next
    })
  }

  function marcarPaginaEntrada(marcar: boolean) {
    setNfsMarcadas((prev) => {
      const next = new Set(prev)
      for (const linha of linhasPaginaEntrada) {
        if (marcar) next.add(linha.nf.nfId)
        else next.delete(linha.nf.nfId)
      }
      return next
    })
  }

  function marcarTodasFiltradas() {
    setNfsMarcadas((prev) => {
      const next = new Set(prev)
      for (const linha of linhasFinanceiro) next.add(linha.nf.nfId)
      return next
    })
  }

  function limparMarcadasFiltradas() {
    setNfsMarcadas((prev) => {
      const next = new Set(prev)
      for (const linha of linhasFinanceiro) next.delete(linha.nf.nfId)
      return next
    })
  }

  function aplicarPeriodoMarcadas() {
    if (nfsMarcadasFiltradas.length === 0) return
    setPeriodosCobranca((prev) => {
      const next = { ...prev }
      for (const linha of nfsMarcadasFiltradas) {
        next[linha.nf.nfId] = { inicio: periodoMassa.inicio, fim: periodoMassa.fim }
      }
      return next
    })
  }

  function gerarRelatorioExcelDetalhado() {
    const header = csvLineFinanceiro([
      'NF',
      'Cliente',
      'CNPJ',
      'Status',
      'Data de armazenagem',
      'Entrada registrada',
      'Saída',
      'Dias armazenados',
      'Período início',
      'Período fim',
      'Dias do período',
      'Valor diária',
      'Valor acumulado',
      'Valor armazenagem período',
      'Débitos entrada período',
      'Valor total a cobrar',
      'Peso entrada kg',
      'Peso bruto kg',
      'Peso atual kg',
      'Peso saído kg',
      'Qtd saídas',
      'Caixas NF',
      'Paletes NF',
      'Posições NF',
      'Valor mercadoria NF',
      'Código item',
      'Descrição item',
      'Quantidade item',
      'Unidade item',
      'Paletes item',
      'Endereços item',
      'UP',
      'Lote',
      'Fabricação',
      'Validade',
      'Valor item',
    ])

    const rows = linhasFinanceiro.flatMap((linha) => {
      const itens = linha.nota?.items.length ? linha.nota.items : [null]
      return itens.map((item) =>
        csvLineFinanceiro([
          linha.nf.nfNumero,
          linha.nf.emitente,
          linha.nf.emitenteCnpj ? formatarCnpj(linha.nf.emitenteCnpj) : '',
          linha.nf.status,
          dateInputValue(linha.nf.dataEntrada),
          formatarDataHoraBr(linha.nota?.createdAt ?? linha.nf.dataEntrada),
          linha.nf.dataSaida ? formatarDataHoraBr(linha.nf.dataSaida) : '',
          linha.nf.diasArmazenados,
          linha.periodoInicio,
          linha.periodoFim,
          linha.diasPeriodo,
          numeroCsv(linha.valorDiaria),
          numeroCsv(linha.valorVigente),
          numeroCsv(linha.valorArmazenagem),
          numeroCsv(linha.debitosEntrada),
          numeroCsv(linha.valorPeriodo),
          numeroCsv(linha.nf.pesoEntrada),
          numeroCsv(linha.nf.pesoBruto),
          numeroCsv(linha.nf.pesoAtual),
          numeroCsv(linha.nf.pesoSaido),
          linha.nf.saidas.length,
          numeroCsv(linha.nf.totalCaixas),
          linha.nf.totalPaletes,
          linha.posicoes,
          numeroCsv(linha.nf.valorMercadoria),
          item?.codigo ?? '',
          item?.descricao ?? '',
          item ? numeroCsv(item.quantidade) : '',
          item?.unidade ?? '',
          item?.paletes ?? item?.allocatedAddresses.length ?? '',
          item?.allocatedAddresses.join(', ') ?? '',
          item?.up ?? '',
          item?.lote ?? '',
          item?.dataFabricacao ?? '',
          item?.dataValidade ?? '',
          item?.valorTotal != null ? numeroCsv(item.valorTotal) : '',
        ]),
      )
    })

    downloadTextFile(
      `ultrafrio-financeiro-detalhado-${todayInputValue()}.csv`,
      [header, ...rows].join('\r\n'),
    )
  }

  return (
    <div className="fin-section">
      <div className="sidebar-block">
        <h4>Controle de permanência</h4>

        {financeiroIncompleto && (
          <p className="error fin-aviso-config">
            Para calcular a diária, cadastre uma <strong>tabela de cobrança</strong>, um{' '}
            <strong>contrato</strong> ativo para o cliente (com posição, kilo ou palete marcados) e
            confira os valores na tabela.
          </p>
        )}

        {data.clientes.length > 0 && (
          <label className="nf-itens-campo">
            <span>Filtrar por cliente</span>
            <select className="input-nf" value={filtroCliente} onChange={(e) => setFiltroCliente(e.target.value)}>
              <option value="">Todos os clientes</option>
              {data.clientes.map((c) => (
                <option key={c.cnpj} value={c.cnpj}>
                  {c.razaoSocial}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>

      {linhasFinanceiro.length > 0 && (
        <div className="sidebar-block fin-entrada-resumo">
          <div className="fin-entrada-resumo-head">
            <h4>Resumo geral</h4>
            <button type="button" className="btn primary btn-sm" onClick={gerarRelatorioExcelDetalhado}>
              Gerar Excel detalhado
            </button>
          </div>
          <div className="fin-entrada-resumo-grid">
            <div className="fin-entrada-resumo-card fin-entrada-resumo-card--destaque">
              <span>Valor a cobrar</span>
              <strong>{formatMoedaFinanceiro(resumoGeral.valorPeriodo)}</strong>
            </div>
            <div className="fin-entrada-resumo-card">
              <span>Valor acumulado</span>
              <strong>{formatMoedaFinanceiro(resumoGeral.valorVigente)}</strong>
            </div>
            <div className="fin-entrada-resumo-card">
              <span>Posições</span>
              <strong>{resumoGeral.posicoes}</strong>
            </div>
            <div className="fin-entrada-resumo-card">
              <span>Peso</span>
              <strong>{formatPesoBruto(resumoGeral.peso)} kg</strong>
            </div>
            <div className="fin-entrada-resumo-card">
              <span>Caixas</span>
              <strong>{formatQuantidadeNfe(resumoGeral.caixas)}</strong>
            </div>
            <div className="fin-entrada-resumo-card">
              <span>Paletes</span>
              <strong>{resumoGeral.paletes}</strong>
            </div>
            <div className="fin-entrada-resumo-card">
              <span>Itens</span>
              <strong>{resumoGeral.itens}</strong>
            </div>
            <div className="fin-entrada-resumo-card">
              <span>NFs</span>
              <strong>{resumoGeral.nfs}</strong>
            </div>
          </div>
        </div>
      )}

      {linhasFinanceiro.length > 0 && (
        <div className="sidebar-block fin-periodo-massa">
          <div className="fin-periodo-massa-head">
            <h4>Aplicar para todos - Período de cobrança</h4>
            <span className="muted">{nfsMarcadasFiltradas.length} NF(s) marcada(s)</span>
          </div>
          <div className="fin-periodo-massa-grid">
            <label className="nf-itens-campo">
              <span>Início</span>
              <input
                type="date"
                className="input-nf input-nf--compact"
                value={periodoMassa.inicio}
                onChange={(e) => setPeriodoMassa((prev) => ({ ...prev, inicio: e.target.value }))}
              />
            </label>
            <label className="nf-itens-campo">
              <span>Fim</span>
              <input
                type="date"
                className="input-nf input-nf--compact"
                value={periodoMassa.fim}
                onChange={(e) => setPeriodoMassa((prev) => ({ ...prev, fim: e.target.value }))}
              />
            </label>
            <button
              type="button"
              className="btn primary"
              onClick={aplicarPeriodoMarcadas}
              disabled={nfsMarcadasFiltradas.length === 0}
            >
              Aplicar nos marcados
            </button>
          </div>
          <div className="fin-periodo-massa-actions">
            <button type="button" className="btn btn-sm" onClick={() => marcarPaginaEntrada(!todasPaginaMarcadas)}>
              {todasPaginaMarcadas ? 'Desmarcar página' : 'Marcar página'}
            </button>
            <button type="button" className="btn btn-sm" onClick={marcarTodasFiltradas}>
              Marcar todos
            </button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={limparMarcadasFiltradas}>
              Limpar marcações
            </button>
          </div>
        </div>
      )}

      {linhasFinanceiro.length === 0 ? (
        <p className="muted">Nenhuma NF encontrada.</p>
      ) : (
        <>
          <div className="fin-paginacao fin-paginacao--top">
            <span>
              Mostrando {inicioPaginaEntrada + 1}-{fimPaginaEntrada} de {linhasFinanceiro.length}
            </span>
            <div>
              <button
                type="button"
                className="btn btn-sm"
                disabled={paginaEntradaAtual <= 1}
                onClick={() => setPaginaEntrada(Math.max(1, paginaEntradaAtual - 1))}
              >
                Anterior
              </button>
              <strong>
                Página {paginaEntradaAtual} de {totalPaginasEntrada}
              </strong>
              <button
                type="button"
                className="btn btn-sm"
                disabled={paginaEntradaAtual >= totalPaginasEntrada}
                onClick={() => setPaginaEntrada(Math.min(totalPaginasEntrada, paginaEntradaAtual + 1))}
              >
                Próxima
              </button>
            </div>
          </div>

          <ul className="fin-nf-lista">
            {linhasPaginaEntrada.map((linha) => {
              const {
                nf,
                cliente: cli,
                valorDiaria,
                valorDiariaPeriodo,
                valorVigente,
                periodoInicio,
                periodoFim,
                diasPeriodo,
                valorArmazenagem,
                debitosEntrada,
                paletesEntradaPeriodo,
              } = linha
              const updatePeriodo = (patch: Partial<{ inicio: string; fim: string }>) => {
                setPeriodosCobranca((prev) => ({
                  ...prev,
                  [nf.nfId]: {
                    inicio: periodoInicio,
                    fim: periodoFim,
                    ...patch,
                  },
                }))
              }
              return (
                <li key={nf.nfId} className="fin-nf-item">
                  <div className="fin-nf-header">
                    <label className="fin-nf-marcador">
                      <input
                        type="checkbox"
                        checked={nfsMarcadas.has(nf.nfId)}
                        onChange={(e) => toggleNfMarcada(nf.nfId, e.target.checked)}
                      />
                      <strong>NF {nf.nfNumero}</strong>
                    </label>
                    <span className={`fin-badge ${nf.status === 'armazenada' ? 'fin-badge--ativo' : 'fin-badge--finalizada'}`}>
                      {nf.status === 'armazenada' ? 'Armazenada' : 'Finalizada'}
                    </span>
                  </div>
                  <div className="fin-nf-stats">
                    <span>{nf.emitente}</span>
                    {cli && (
                      <button type="button" className="btn-link fin-link-cliente" onClick={() => onSelectCliente(cli.cnpj)}>
                        Ver cliente →
                      </button>
                    )}
                  </div>
                <div className="fin-entrada-layout">
                  <div className="fin-entrada-grid">
                    <div>
                      <span className="muted">Data de armazenagem</span>
                      <input
                        type="date"
                        className="input-nf input-nf--compact fin-data-armazenagem-input"
                        value={dateInputValue(
                          dataArmazenagemNf(linha.nota ?? {}) ?? nf.dataEntrada,
                        )}
                        onChange={(e) => onUpdateNotaDataArmazenagem(nf.nfId, e.target.value)}
                      />
                    </div>
                    <div>
                      <span className="muted">Entrada registrada</span>
                      <strong>{formatarDataHoraBr(notasById.get(nf.nfId)?.createdAt ?? nf.dataEntrada)}</strong>
                    </div>
                    <div>
                      <span className="muted">Saídas</span>
                      <strong>{nf.saidas.length > 0 ? `${nf.saidas.length} registro(s)` : '—'}</strong>
                    </div>
                    <div>
                      <span className="muted">Dias</span>
                      <strong>
                        {nf.dataUltimaSaida && nf.status === 'armazenada'
                          ? `${nf.diasCobranca} (desde última saída)`
                          : nf.diasArmazenados}
                      </strong>
                    </div>
                    <div>
                      <span className="muted">Valor acumulado</span>
                      <strong>{formatMoedaFinanceiro(valorVigente)}</strong>
                    </div>
                    <div>
                      <span className="muted">Valor diária</span>
                      <strong>{formatMoedaFinanceiro(valorDiaria)}</strong>
                    </div>
                    <div>
                      <span className="muted">Bruto (entrada)</span>
                      <strong>{formatPesoBruto(nf.pesoBruto)} kg</strong>
                    </div>
                    <div>
                      <span className="muted">Peso atual</span>
                      <strong>{formatPesoBruto(nf.pesoAtual)} kg</strong>
                    </div>
                    <div>
                      <span className="muted">Itens</span>
                      <strong>{nf.totalItens}</strong>
                    </div>
                    <div>
                      <span className="muted">Caixas</span>
                      <strong>{formatQuantidadeNfe(nf.totalCaixas)}</strong>
                    </div>
                    <div>
                      <span className="muted">Paletes</span>
                      <strong>{nf.totalPaletes}</strong>
                    </div>
                    <div>
                      <span className="muted">Valor merc.</span>
                      <strong>{formatValorNfe(nf.valorMercadoria)}</strong>
                    </div>
                  </div>
                </div>
                <div className="fin-periodo-cobranca-card">
                  <div className="fin-periodo-cobranca-head">
                    <strong>Período de cobrança</strong>
                    <span className="muted">Informe o intervalo para calcular o valor a cobrar.</span>
                  </div>
                  <div className="fin-periodo-cobranca-grid">
                    <label className="nf-itens-campo">
                      <span>Início</span>
                      <input
                        type="date"
                        className="input-nf input-nf--compact"
                        value={periodoInicio}
                        onChange={(e) => updatePeriodo({ inicio: e.target.value })}
                      />
                    </label>
                    <label className="nf-itens-campo">
                      <span>Fim</span>
                      <input
                        type="date"
                        className="input-nf input-nf--compact"
                        value={periodoFim}
                        onChange={(e) => updatePeriodo({ fim: e.target.value })}
                      />
                    </label>
                    <div>
                      <span className="muted">Dias do período</span>
                      <strong>{diasPeriodo}</strong>
                    </div>
                    <div>
                      <span className="muted">Valor diária</span>
                      <strong>{formatMoedaFinanceiro(valorDiariaPeriodo)}</strong>
                    </div>
                  </div>
                  <div className="fin-periodo-cobranca-total">
                    <span>Valor a cobrar</span>
                    <strong>{formatMoedaFinanceiro(valorArmazenagem)}</strong>
                  </div>
                  {debitosEntrada > 0 && (
                    <div className="fin-periodo-cobranca-debitos">
                      <div className="fin-periodo-cobranca-debitos-linha">
                        <span>Débitos de entrada</span>
                        <strong>{formatMoedaFinanceiro(debitosEntrada)}</strong>
                      </div>
                      <span className="muted fin-periodo-cobranca-debitos-hint">
                        {paletesEntradaPeriodo} palete(s) na entrada
                        {linha.tabela && linha.tabela.custoEntrada > 0
                          ? ` · ${formatMoedaFinanceiro(linha.tabela.custoEntrada)}/palete`
                          : ''}
                      </span>
                    </div>
                  )}
                </div>
                {nf.saidas.length > 0 && (
                  <div className="fin-saidas-card">
                    <div className="fin-saidas-head">
                      <strong>Saídas registradas</strong>
                      <span className="muted">
                        Total saído: {formatPesoBruto(nf.pesoSaido)} kg
                        {nf.pesoRestante > 0 && nf.pesoSaido > 0 ? (
                          <> · Restante: {formatPesoBruto(nf.pesoRestante)} kg</>
                        ) : null}
                      </span>
                    </div>
                    <ul className="fin-saidas-lista">
                      {nf.saidas.map((saida, idx) => (
                        <li key={saida.id} className="fin-saidas-item">
                          <span className="fin-saidas-num">#{idx + 1}</span>
                          <span>{formatarDataHoraBr(saida.data)}</span>
                          {saida.nfSaidaNumero ? (
                            <span>NF saída {saida.nfSaidaNumero}</span>
                          ) : (
                            <span>Saída parcial</span>
                          )}
                          <strong>{formatPesoBruto(saida.pesoSaida)} kg</strong>
                          {saida.caixasSaida > 0 && (
                            <span>{formatQuantidadeNfe(saida.caixasSaida)} CX</span>
                          )}
                          {saida.paletesSaida > 0 && <span>{saida.paletesSaida} palete(s)</span>}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </li>
            )
            })}
          </ul>

          {totalPaginasEntrada > 1 && (
            <div className="fin-paginacao">
              <span>
                Mostrando {inicioPaginaEntrada + 1}-{fimPaginaEntrada} de {linhasFinanceiro.length}
              </span>
              <div>
                <button
                  type="button"
                  className="btn btn-sm"
                  disabled={paginaEntradaAtual <= 1}
                  onClick={() => setPaginaEntrada(Math.max(1, paginaEntradaAtual - 1))}
                >
                  Anterior
                </button>
                <strong>
                  Página {paginaEntradaAtual} de {totalPaginasEntrada}
                </strong>
                <button
                  type="button"
                  className="btn btn-sm"
                  disabled={paginaEntradaAtual >= totalPaginasEntrada}
                  onClick={() => setPaginaEntrada(Math.min(totalPaginasEntrada, paginaEntradaAtual + 1))}
                >
                  Próxima
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}

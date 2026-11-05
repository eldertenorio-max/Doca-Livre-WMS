import { useEffect, useRef, useState } from 'react'
import * as XLSX from 'xlsx'
import { normalizeCodigoInternoCompareKey } from '../lib/codigoInternoCompare'
import {
  createProdutoLista,
  listProdutoListas,
  mesclarProdutosNaListaSalva,
  produtoListasHabilitado,
  type ProdutoLista,
  type ProdutoListaItem,
} from '../lib/produtoListaSupabase'
import { emitProdutoListaAtualizada } from '../lib/sessaoProdutoListaContext'
import { formatUnknownError, isColumnMissingError } from '../lib/supabaseError'
import { supabase } from '../lib/supabaseClient'
import { PagePanelHeading } from '../components/ui/PagePanelHeading'

const TABELA = 'Todos os Produtos'

type LinhaImport = {
  codigo_interno: string
  descricao: string
  unidade: string | null
  ean: string | null
  dun: string | null
}

type CatalogoRef = { id: string; codigo_interno: string }

type CatalogoIndex = {
  byExact: Map<string, CatalogoRef>
  byNorm: Map<string, CatalogoRef>
}

type ModoListaDestino = 'nova' | 'existente'

function normCell(v: unknown): string {
  if (v == null) return ''
  return String(v).trim()
}

function pickColumn(row: Record<string, unknown>, keys: string[]): string {
  for (const k of keys) {
    const hit = Object.keys(row).find((h) => h.trim().toLowerCase() === k.toLowerCase())
    if (hit) return normCell(row[hit])
  }
  return ''
}

function parseSheet(rows: Record<string, unknown>[]): LinhaImport[] {
  const out: LinhaImport[] = []
  const seen = new Set<string>()
  for (const row of rows) {
    const codigo = pickColumn(row, [
      'codigo_interno',
      'codigo',
      'código',
      'código interno',
      'codigo interno',
      'cod',
    ])
    const descricao = pickColumn(row, ['descricao', 'descrição', 'desc', 'produto', 'nome'])
    if (!codigo || !descricao) continue
    const key = normalizeCodigoInternoCompareKey(codigo)
    if (seen.has(key)) continue
    seen.add(key)
    const unidade = pickColumn(row, ['unidade', 'un', 'unidade_medida', 'um']) || null
    const ean = pickColumn(row, ['ean', 'codigo_barras', 'código de barras']) || null
    const dun = pickColumn(row, ['dun']) || null
    out.push({
      codigo_interno: codigo,
      descricao,
      unidade,
      ean,
      dun,
    })
  }
  return out
}

function linhasParaListaItens(linhas: LinhaImport[]): ProdutoListaItem[] {
  return linhas.map((ln) => ({
    codigo_interno: ln.codigo_interno.trim(),
    descricao: ln.descricao.trim(),
    unidade: ln.unidade,
    ean: ln.ean,
    dun: ln.dun,
  }))
}

function nomeListaFromArquivo(fileName: string): string {
  return fileName.replace(/\.(xlsx|xls|csv)$/i, '').trim()
}

function isUniqueViolationError(e: unknown): boolean {
  const code =
    e && typeof e === 'object' && 'code' in e ? String((e as { code: unknown }).code) : ''
  if (code === '23505') return true
  const msg = formatUnknownError(e).toLowerCase()
  return msg.includes('duplicate') || msg.includes('unique constraint') || msg.includes('already exists')
}

function buildCatalogoIndex(rows: CatalogoRef[]): CatalogoIndex {
  const byExact = new Map<string, CatalogoRef>()
  const byNorm = new Map<string, CatalogoRef>()
  for (const row of rows) {
    const codigo = String(row.codigo_interno ?? '').trim()
    if (!codigo) continue
    if (!byExact.has(codigo)) byExact.set(codigo, row)
    const norm = normalizeCodigoInternoCompareKey(codigo)
    if (norm && !byNorm.has(norm)) byNorm.set(norm, row)
  }
  return { byExact, byNorm }
}

function findInCatalogoIndex(codigo: string, index: CatalogoIndex): CatalogoRef | undefined {
  const trimmed = codigo.trim()
  if (!trimmed) return undefined
  const exact = index.byExact.get(trimmed)
  if (exact) return exact
  const norm = normalizeCodigoInternoCompareKey(trimmed)
  if (norm) return index.byNorm.get(norm)
  return undefined
}

function registerInCatalogoIndex(index: CatalogoIndex, ref: CatalogoRef): void {
  const codigo = ref.codigo_interno.trim()
  if (!codigo) return
  index.byExact.set(codigo, ref)
  const norm = normalizeCodigoInternoCompareKey(codigo)
  if (norm) index.byNorm.set(norm, ref)
}

async function loadCatalogoIndex(): Promise<CatalogoIndex> {
  const { data, error } = await supabase.from(TABELA).select('id,codigo_interno').limit(50000)
  if (error) throw new Error(formatUnknownError(error))
  return buildCatalogoIndex((data ?? []) as CatalogoRef[])
}

function buildPayloads(ln: LinhaImport): Record<string, unknown>[] {
  const cod = ln.codigo_interno.trim()
  const payload: Record<string, unknown> = {
    codigo_interno: cod,
    descricao: ln.descricao.trim(),
    ean: ln.ean,
    dun: ln.dun,
    unidade: ln.unidade,
  }
  return [
    payload,
    { ...payload, unidade_medida: ln.unidade },
    { codigo_interno: cod, descricao: ln.descricao.trim(), ean: ln.ean, dun: ln.dun },
  ]
}

async function updateCatalogoRow(
  ref: CatalogoRef,
  payloads: Record<string, unknown>[],
): Promise<{ ok: boolean; err?: string }> {
  for (const p of payloads) {
    const { error } = await supabase.from(TABELA).update(p).eq('id', ref.id)
    if (!error) return { ok: true }
    if (!isColumnMissingError(error)) return { ok: false, err: formatUnknownError(error) }
  }
  return { ok: false, err: 'Não foi possível atualizar o produto no catálogo.' }
}

async function insertCatalogoRow(
  payloads: Record<string, unknown>[],
): Promise<{ ok: boolean; row?: CatalogoRef; err?: string }> {
  for (const p of payloads) {
    const { data, error } = await supabase.from(TABELA).insert(p).select('id,codigo_interno').limit(1)
    if (!error && data?.[0]) {
      return { ok: true, row: data[0] as CatalogoRef }
    }
    if (error && !isColumnMissingError(error)) {
      return { ok: false, err: formatUnknownError(error) }
    }
  }
  return { ok: false, err: 'Não foi possível inserir o produto no catálogo.' }
}

async function upsertLinha(
  ln: LinhaImport,
  index: CatalogoIndex,
  atualizarExistentes: boolean,
): Promise<'ok' | 'skip' | { err: string }> {
  const cod = ln.codigo_interno.trim()
  const payloads = buildPayloads(ln)
  let existente = findInCatalogoIndex(cod, index)

  if (existente && !atualizarExistentes) return 'skip'

  if (existente) {
    const res = await updateCatalogoRow(existente, payloads)
    return res.ok ? 'ok' : { err: res.err ?? 'Falha ao atualizar.' }
  }

  const ins = await insertCatalogoRow(payloads)
  if (ins.ok) {
    if (ins.row) registerInCatalogoIndex(index, ins.row)
    return 'ok'
  }

  if (!isUniqueViolationError(ins.err)) {
    return { err: ins.err ?? 'Falha ao inserir.' }
  }

  const refreshed = await loadCatalogoIndex()
  index.byExact = refreshed.byExact
  index.byNorm = refreshed.byNorm
  existente = findInCatalogoIndex(cod, index)
  if (!existente) {
    return { err: ins.err ?? 'Código já existe no catálogo, mas não foi localizado para atualização.' }
  }
  if (!atualizarExistentes) return 'skip'

  const res = await updateCatalogoRow(existente, payloads)
  return res.ok ? 'ok' : { err: res.err ?? 'Falha ao atualizar após conflito de código.' }
}

function baixarModeloImportacao() {
  const exemplo = [
    {
      codigo_interno: '01.01.0001',
      descricao: 'EXEMPLO — MASSA CONGELADA DE PAO FRANCES RAPIDA - 5KG',
      unidade: 'PT',
      ean: '7891234567890',
      dun: '17891234567897',
    },
    {
      codigo_interno: '01.02.0003',
      descricao: 'EXEMPLO — MASSA CONGELADA DE MINI PAO FRANCES INTEGRAL RAPIDA - 5KG',
      unidade: 'PT',
      ean: '',
      dun: '',
    },
  ]
  const ws = XLSX.utils.json_to_sheet(exemplo)
  ws['!cols'] = [{ wch: 16 }, { wch: 52 }, { wch: 8 }, { wch: 16 }, { wch: 16 }]
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Produtos')
  XLSX.writeFile(wb, 'modelo-importacao-produtos.xlsx')
}

export default function ProdutosImportacaoPlanilha() {
  const inputRef = useRef<HTMLInputElement>(null)
  const feedbackRef = useRef<HTMLPreElement>(null)
  const [nomeLista, setNomeLista] = useState('')
  const [modoListaDestino, setModoListaDestino] = useState<ModoListaDestino>('nova')
  const [listaExistenteId, setListaExistenteId] = useState('')
  const [produtoListas, setProdutoListas] = useState<ProdutoLista[]>([])
  const [linhas, setLinhas] = useState<LinhaImport[]>([])
  const [arquivo, setArquivo] = useState('')
  const [importando, setImportando] = useState(false)
  const [log, setLog] = useState<string[]>([])
  const [erro, setErro] = useState('')
  const [atualizarExistentes, setAtualizarExistentes] = useState(true)

  useEffect(() => {
    if (!produtoListasHabilitado()) return
    void listProdutoListas()
      .then((listas) => {
        setProdutoListas(listas)
        if (listas.length === 1) setListaExistenteId(listas[0].id)
      })
      .catch(() => {})
  }, [])

  function mostrarFeedback(msgs: string[]) {
    setLog(msgs)
    requestAnimationFrame(() => {
      feedbackRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    })
  }

  function handleFile(file: File) {
    setLog([])
    setErro('')
    setArquivo(file.name)
    if (!nomeLista.trim() && modoListaDestino === 'nova') {
      setNomeLista(nomeListaFromArquivo(file.name))
    }
    const reader = new FileReader()
    reader.onload = (ev) => {
      try {
        const data = ev.target?.result
        const wb = XLSX.read(data, { type: 'array' })
        const sheet = wb.Sheets[wb.SheetNames[0]]
        const json = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' })
        const parsed = parseSheet(json)
        setLinhas(parsed)
        mostrarFeedback([`Arquivo lido: ${parsed.length} linha(s) válida(s).`])
      } catch (e: unknown) {
        setLinhas([])
        setErro('')
        mostrarFeedback([`Erro ao ler planilha: ${formatUnknownError(e)}`])
      }
    }
    reader.readAsArrayBuffer(file)
  }

  async function gravarListaImportada(nome: string, linhasImport: LinhaImport[]): Promise<ProdutoLista> {
    const itens = linhasParaListaItens(linhasImport)

    if (modoListaDestino === 'existente') {
      const id = listaExistenteId.trim()
      if (!id) throw new Error('Selecione a lista existente para adicionar os produtos.')
      return mesclarProdutosNaListaSalva(id, itens)
    }

    const nomeTrim = nome.trim()
    if (!nomeTrim) throw new Error('Informe o nome da nova lista.')
    const listas = await listProdutoListas()
    const dup = listas.find((l) => l.nome.trim().toLowerCase() === nomeTrim.toLowerCase())
    if (dup) {
      throw new Error(
        `Já existe uma lista chamada «${dup.nome}». Escolha «Adicionar a lista existente» ou informe outro nome.`,
      )
    }
    return createProdutoLista(nomeTrim, itens)
  }

  async function handleImportar() {
    setErro('')
    if (!linhas.length) {
      setErro('Selecione um arquivo Excel com pelo menos uma linha válida.')
      return
    }
    if (modoListaDestino === 'nova' && !nomeLista.trim()) {
      setErro('Informe o nome da nova lista antes de importar.')
      return
    }
    if (modoListaDestino === 'existente' && !listaExistenteId.trim()) {
      setErro('Selecione a lista existente para adicionar os produtos.')
      return
    }
    if (!produtoListasHabilitado()) {
      setErro('Supabase não configurado — não é possível gravar a lista de produtos.')
      return
    }

    setImportando(true)
    const msgs: string[] = []
    let ok = 0
    let skip = 0
    let err = 0
    let atualizados = 0

    try {
      const index = await loadCatalogoIndex()

      for (const ln of linhas) {
        const existia = !!findInCatalogoIndex(ln.codigo_interno, index)
        try {
          const r = await upsertLinha(ln, index, atualizarExistentes)
          if (r === 'ok') {
            ok++
            if (existia && atualizarExistentes) atualizados++
          } else if (r === 'skip') {
            skip++
          } else {
            err++
            msgs.push(`Falha ${ln.codigo_interno}: ${r.err}`)
          }
        } catch (e: unknown) {
          err++
          msgs.push(`${ln.codigo_interno}: ${formatUnknownError(e)}`)
        }
      }

      const lista = await gravarListaImportada(nomeLista, linhas)
      emitProdutoListaAtualizada([lista.id])

      const modoListaMsg =
        modoListaDestino === 'existente'
          ? `Lista «${lista.nome}» atualizada — produtos mesclados pelo código (${lista.produtos.length} no total).`
          : `Lista «${lista.nome}» criada com ${lista.produtos.length} produto(s).`

      msgs.unshift(
        `${modoListaMsg} Aparece em Produtos → listas salvas e pode ser usada no inventário.`,
      )
      msgs.unshift(
        `Concluído — ${ok} gravado(s) em Todos os Produtos` +
          (atualizados ? ` (${atualizados} atualizado(s) pelo código)` : '') +
          `, ${skip} ignorado(s), ${err} erro(s).`,
      )
      setErro('')
      mostrarFeedback(msgs)
    } catch (e: unknown) {
      setErro(formatUnknownError(e))
    } finally {
      setImportando(false)
    }
  }

  const podeImportar = linhas.length > 0 && !importando

  return (
    <div className="page-panel">
      <PagePanelHeading
        title="Importação de Planilha de Produtos"
        info={
          <>
            Envie um Excel (.xlsx) com colunas <strong>codigo_interno</strong> (ou código) e <strong>descricao</strong>.
            Opcional: unidade, ean, dun. Os produtos entram em <strong>Todos os Produtos</strong> (pelo código — se já
            existir, atualiza descrição, EAN e DUN) e na lista escolhida abaixo.
          </>
        }
      />

      <div className="page-form-grid page-form-grid--import">
        <fieldset className="page-form-grid__destino">
          <legend>Destino da lista</legend>
          <div className="page-form-grid__radio-row">
            <label className="page-form-grid__check">
              <input
                type="radio"
                name="modo-lista-import"
                checked={modoListaDestino === 'nova'}
                onChange={() => setModoListaDestino('nova')}
              />
              Criar nova lista
            </label>
            <label className="page-form-grid__check">
              <input
                type="radio"
                name="modo-lista-import"
                checked={modoListaDestino === 'existente'}
                onChange={() => setModoListaDestino('existente')}
              />
              Adicionar a lista existente (mescla pelo código)
            </label>
          </div>
        </fieldset>

        {modoListaDestino === 'nova' ? (
          <label className="page-form-grid__full">
            Nome da nova lista *
            <input
              value={nomeLista}
              onChange={(e) => {
                setNomeLista(e.target.value)
                if (erro) setErro('')
              }}
              placeholder="Ex.: CD Ultrapao guarulhos — importação jun/2026"
              required
              aria-invalid={linhas.length > 0 && !nomeLista.trim()}
            />
          </label>
        ) : (
          <label className="page-form-grid__full">
            Lista existente *
            <select
              value={listaExistenteId}
              onChange={(e) => {
                setListaExistenteId(e.target.value)
                if (erro) setErro('')
              }}
            >
              <option value="">Selecione…</option>
              {produtoListas.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.nome} ({l.produtos.length} produto(s))
                </option>
              ))}
            </select>
          </label>
        )}

        {linhas.length > 0 && modoListaDestino === 'nova' && !nomeLista.trim() ? (
          <p className="page-form-hint page-form-hint--err page-form-grid__full">
            Informe o nome da nova lista para concluir a importação.
          </p>
        ) : null}
        {linhas.length > 0 && modoListaDestino === 'existente' && !listaExistenteId ? (
          <p className="page-form-hint page-form-hint--err page-form-grid__full">
            Selecione a lista existente para concluir a importação.
          </p>
        ) : null}

        <label className="page-form-grid__full">
          Arquivo Excel
          <input
            ref={inputRef}
            type="file"
            accept=".xlsx,.xls,.csv"
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) handleFile(f)
            }}
          />
        </label>
        <div className="page-form-grid__footer-bar">
          <label className="page-form-grid__check">
            <input
              type="checkbox"
              checked={atualizarExistentes}
              onChange={(e) => setAtualizarExistentes(e.target.checked)}
            />
            Atualizar existentes em Todos os Produtos (mesmo código — descrição, EAN e DUN)
          </label>
          <div className="page-form-grid__actions">
            <button type="button" disabled={!podeImportar} onClick={() => void handleImportar()}>
              {importando ? 'Importando…' : `Importar ${linhas.length} linha(s)`}
            </button>
            <button type="button" className="page-btn-ghost" onClick={baixarModeloImportacao}>
              Baixar modelo
            </button>
          </div>
        </div>
      </div>

      {erro ? <div className="page-form-alert page-form-alert--err">{erro}</div> : null}

      {arquivo ? (
        <p style={{ marginTop: 12, fontSize: 14, color: 'var(--muted, #94a3b8)' }}>
          Arquivo: {arquivo}
        </p>
      ) : null}

      {linhas.length > 0 ? (
        <div className="page-table-wrap" style={{ marginTop: 20 }}>
          <p className="page-panel__section-title">Prévia (até 15 linhas)</p>
          <table className="page-table">
            <thead>
              <tr>
                <th>Código</th>
                <th>Descrição</th>
                <th>Un.</th>
                <th>EAN</th>
                <th>DUN</th>
              </tr>
            </thead>
            <tbody>
              {linhas.slice(0, 15).map((ln) => (
                <tr key={ln.codigo_interno}>
                  <td>{ln.codigo_interno}</td>
                  <td>{ln.descricao}</td>
                  <td>{ln.unidade ?? '—'}</td>
                  <td>{ln.ean ?? '—'}</td>
                  <td>{ln.dun ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {log.length > 0 ? (
        <pre ref={feedbackRef} className="page-form-log">
          {log.join('\n')}
        </pre>
      ) : null}
    </div>
  )
}

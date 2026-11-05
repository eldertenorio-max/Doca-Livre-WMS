import type { CSSProperties, Dispatch, SetStateAction } from 'react'
import type { OfflineChecklistItem } from '../../lib/offlineContagemSession'
import {
  clampDataFabricacaoYmd,
  isDatasProdutoContagemInvalidas,
  maxDataFabricacaoHoje,
} from '../../lib/contagemDatasValidacao'
import {
  CHECKLIST_QTY_NAV_ATTR,
  handleChecklistFieldNavKeyDown,
} from '../../lib/checklistFieldNavigation'
import { calcHistoryKeyForCodigo, ChecklistQtyCalcButton } from '../ChecklistCalculatorModal'
import {
  getInventarioRuaArmazem,
  inventarioArmazemPosNivel,
  formatContagemLabel,
  formatPlanilhaLinhaRelatorio,
  isPlanilhaItemLinhaSelecionada,
  planilhaRepeticaoFromOrdemNaAba,
  type PlanilhaRepeticao,
} from './inventarioPlanilhaModel'

export type ChecklistEditDraft = {
  codigo_interno: string
  descricao: string
  quantidade_contada: string
}

export type InventarioPlanilhaTabelaProps = {
  items: OfflineChecklistItem[]
  armazemItemsSorted: OfflineChecklistItem[]
  armazemContagem: number | null
  planilhaQtdContagemHeader: string
  showChecklistColumn: (id: string) => boolean
  thStyle: CSSProperties
  tdStyle: CSSProperties
  buttonStyle: CSSProperties
  checklistQtdInputStyle: CSSProperties
  checklistEditingKey: string | null
  checklistEditDraft: ChecklistEditDraft | null
  setChecklistEditDraft: Dispatch<SetStateAction<ChecklistEditDraft | null>>
  checklistSavedFlashKey: string | null
  saveChecklistEdit: () => void
  cancelChecklistEdit: () => void
  openChecklistEdit: (it: OfflineChecklistItem) => void
  updateOfflineItemFields: (key: string, patch: Partial<OfflineChecklistItem>) => void
  updateOfflineItemQty: (key: string, value: string) => void
  handleLimparQuantidadeOffline: (key: string) => void
  openPhotoModalForCodigo: (codigo: string) => void
  removePhotoFromChecklistItem: (it: OfflineChecklistItem) => void
  /** Modo planilha em branco: ao sair do campo código, preenche descrição a partir do cadastro. */
  onPlanilhaCodigoBlur?: (key: string, codigo: string) => void
  /** Bip na coluna EAN/DUN da linha: preenche só a próxima repetição vazia do POS/NÍVEL. */
  onPlanilhaRowBarcodeChange?: (key: string, raw: string) => void
  /** Nome do conferente da sessão (mesmo em todas as linhas). */
  conferenteLabel: string
  /** Rodada selecionada (1–4): exibida na coluna de contagem (somente leitura). */
  inventarioNumeroContagemRodada: 1 | 2 | 3 | 4
  /** Endereço ativo no seletor (RUA/POS/NÍVEL/repetição): destaca a linha correspondente. */
  planilhaEnderecoAtivo?: {
    grupo: number
    pos: number
    nivel: number
    repeticao: PlanilhaRepeticao
  } | null
  /** Abre calculadora para inserir o resultado na quantidade da linha em edição / visualização. */
  openQtyCalculator?: (onApply: (value: string) => void, productHint?: string, historyStorageKey?: string) => void
}

/**
 * Tabela HTML só do inventário físico no modo armazém (colunas como na planilha Excel).
 * A checklist de contagem diária / tabela clássica fica em `ContagemEstoque`.
 */
export function InventarioPlanilhaTabela(props: InventarioPlanilhaTabelaProps) {
  const {
    items,
    armazemItemsSorted,
    armazemContagem,
    planilhaQtdContagemHeader,
    showChecklistColumn,
    thStyle,
    tdStyle,
    buttonStyle,
    checklistQtdInputStyle,
    checklistEditingKey,
    checklistEditDraft,
    setChecklistEditDraft,
    checklistSavedFlashKey,
    saveChecklistEdit,
    cancelChecklistEdit,
    openChecklistEdit,
    updateOfflineItemFields,
    updateOfflineItemQty,
    handleLimparQuantidadeOffline,
    openPhotoModalForCodigo,
    removePhotoFromChecklistItem,
    onPlanilhaCodigoBlur,
    onPlanilhaRowBarcodeChange,
    conferenteLabel,
    inventarioNumeroContagemRodada,
    planilhaEnderecoAtivo,
    openQtyCalculator,
  } = props

  const contagemRodadaLabel = formatContagemLabel(inventarioNumeroContagemRodada)
  const planilhaModoEndereco = planilhaEnderecoAtivo != null && planilhaEnderecoAtivo.grupo > 0

  const ruaPlanilha = getInventarioRuaArmazem(armazemContagem)

  /** Texto amarelo no painel da planilha + cabeçalho congelado ao rolar. */
  const corPainelAmarelo = '#fff59d'
  const thPlanilha: CSSProperties = {
    ...thStyle,
    position: 'sticky',
    top: 0,
    zIndex: 2,
    background: '#4a4a1c',
    color: corPainelAmarelo,
    borderBottom: '1px solid rgba(255, 235, 59, 0.35)',
    boxShadow: '0 1px 0 rgba(0,0,0,.2)',
  }
  const tdPlanilha: CSSProperties = {
    ...tdStyle,
    color: corPainelAmarelo,
    borderBottom: '1px solid rgba(255, 235, 59, 0.12)',
  }
  const inputPlanilha: CSSProperties = {
    ...checklistQtdInputStyle,
    color: corPainelAmarelo,
    background: 'rgba(0,0,0,0.28)',
    borderColor: 'rgba(255, 235, 59, 0.45)',
  }
  const tdPlanilhaQtd: CSSProperties = {
    ...tdPlanilha,
    whiteSpace: 'nowrap',
    verticalAlign: 'middle',
    minWidth: 148,
    overflow: 'visible',
  }
  const planilhaQtdCellWrap: CSSProperties = {
    display: 'flex',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexWrap: 'nowrap',
    position: 'relative',
  }
  const inputPlanilhaQtdCell: CSSProperties = {
    ...inputPlanilha,
    flex: '1 1 0',
    width: 0,
    minWidth: 52,
    maxWidth: 96,
  }

  return (
    <div
      style={{
        overflow: 'auto',
        overflowX: 'auto',
        maxHeight: 'min(72vh, 640px)',
        marginTop: 0,
      }}
    >
      <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: 1740 }}>
        <thead>
          <tr>
            <th style={thPlanilha}>Rua</th>
            <th style={thPlanilha}>Pos.</th>
            <th style={thPlanilha}>Nível</th>
            {planilhaModoEndereco ? <th style={thPlanilha}>LINHA</th> : null}
            {showChecklistColumn('conferente') ? <th style={thPlanilha}>Conferente</th> : null}
            <th style={thPlanilha}>CÓDIGO</th>
            <th style={thPlanilha}>DESCRIÇÃO</th>
            {showChecklistColumn('unidade') ? <th style={thPlanilha}>UNIDADE</th> : null}
            {showChecklistColumn('quantidade') ? (
              <>
                <th style={thPlanilha}>{planilhaQtdContagemHeader}</th>
                <th style={thPlanilha}>QUANTIDADE</th>
              </>
            ) : null}
            {showChecklistColumn('data_fabricacao') ? <th style={thPlanilha}>FABRICAÇÃO</th> : null}
            {showChecklistColumn('data_validade') ? <th style={thPlanilha}>VENCIMENTO</th> : null}
            {showChecklistColumn('lote') ? <th style={thPlanilha}>LOTE</th> : null}
            {showChecklistColumn('up') ? <th style={thPlanilha}>UP</th> : null}
            {showChecklistColumn('observacao') ? <th style={thPlanilha}>Observação</th> : null}
            {showChecklistColumn('ean') ? <th style={thPlanilha}>EAN</th> : null}
            {showChecklistColumn('dun') ? <th style={thPlanilha}>DUN</th> : null}
            {showChecklistColumn('foto') ? <th style={thPlanilha}>Foto</th> : null}
            {showChecklistColumn('acoes') ? <th style={thPlanilha}>Ações</th> : null}
          </tr>
        </thead>
        <tbody data-checklist-nav-root onKeyDown={handleChecklistFieldNavKeyDown}>
          {items.map((it) => {
            const hasPhoto = Boolean(String(it.foto_base64 ?? '').trim())
            const isEditing = checklistEditingKey === it.key && checklistEditDraft
            const pn =
              armazemItemsSorted.length > 0 ? inventarioArmazemPosNivel(armazemItemsSorted, it) : { pos: 0, nivel: 0 }
            const linhaRep =
              it.planilha_ordem_na_aba != null
                ? planilhaRepeticaoFromOrdemNaAba(it.planilha_ordem_na_aba, pn.pos, pn.nivel)
                : null
            const linhaLabel = formatPlanilhaLinhaRelatorio(linhaRep) || '—'
            const isLinhaAtiva =
              planilhaEnderecoAtivo != null &&
              isPlanilhaItemLinhaSelecionada(
                it,
                planilhaEnderecoAtivo.grupo,
                planilhaEnderecoAtivo.pos,
                planilhaEnderecoAtivo.nivel,
                planilhaEnderecoAtivo.repeticao,
              )
            const edicaoPlanilha = true
            const datasOrdemInvalida = isDatasProdutoContagemInvalidas(it.data_fabricacao, it.data_validade)
            const trHighlight =
              isLinhaAtiva && planilhaModoEndereco
                ? {
                    background: 'rgba(255, 235, 59, 0.14)',
                    boxShadow: 'inset 0 0 0 2px rgba(255, 235, 59, 0.55)',
                  }
                : undefined
            return (
              <tr
                key={it.key}
                style={
                  datasOrdemInvalida
                    ? {
                        background: 'rgba(120, 20, 20, 0.42)',
                        boxShadow: 'inset 0 0 0 1px rgba(255, 120, 120, 0.5)',
                      }
                    : trHighlight
                }
              >
                {isEditing && checklistEditDraft ? (
                  <>
                    <td style={tdPlanilha}>{ruaPlanilha}</td>
                    <td style={tdPlanilha}>{pn.pos}</td>
                    <td style={tdPlanilha}>{pn.nivel}</td>
                    {planilhaModoEndereco ? (
                      <td style={{ ...tdPlanilha, fontWeight: isLinhaAtiva ? 700 : 400 }}>{linhaLabel}</td>
                    ) : null}
                    {showChecklistColumn('conferente') ? (
                      <td
                        style={{ ...tdPlanilha, maxWidth: 140 }}
                        title="Quem gravou esta linha no banco (visível para todos)"
                      >
                        {String(it.contagem_banco_ultimo_conferente_nome ?? '').trim() || conferenteLabel}
                      </td>
                    ) : null}
                    <td style={tdPlanilha}>
                      <input
                        value={checklistEditDraft.codigo_interno}
                        onChange={(e) =>
                          setChecklistEditDraft((d) => (d ? { ...d, codigo_interno: e.target.value } : d))
                        }
                        onBlur={() => onPlanilhaCodigoBlur?.(it.key, checklistEditDraft.codigo_interno)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
                        }}
                        style={{ ...inputPlanilha, width: '100%', minWidth: 100 }}
                        aria-label="Código do produto"
                      />
                    </td>
                    <td style={{ ...tdPlanilha, whiteSpace: 'normal', maxWidth: 420 }}>
                      <textarea
                        value={checklistEditDraft.descricao}
                        onChange={(e) =>
                          setChecklistEditDraft((d) => (d ? { ...d, descricao: e.target.value } : d))
                        }
                        rows={2}
                        style={{
                          ...inputPlanilha,
                          width: '100%',
                          minWidth: 160,
                          resize: 'vertical',
                          fontFamily: 'inherit',
                        }}
                        aria-label="Descrição"
                      />
                    </td>
                    {showChecklistColumn('unidade') ? (
                      <td style={tdPlanilha}>
                        <input
                          type="text"
                          value={it.unidade_medida ?? ''}
                          onChange={(e) =>
                            updateOfflineItemFields(it.key, {
                              unidade_medida: e.target.value.trim() === '' ? null : e.target.value,
                            })
                          }
                          style={{ ...inputPlanilha, width: 72, minWidth: 56 }}
                          placeholder="—"
                          aria-label="Unidade de medida"
                        />
                      </td>
                    ) : null}
                    {showChecklistColumn('quantidade') ? (
                      <>
                        <td style={{ ...tdPlanilha, textAlign: 'center', whiteSpace: 'nowrap' }}>
                          {contagemRodadaLabel}
                        </td>
                        <td style={tdPlanilhaQtd}>
                          <div style={planilhaQtdCellWrap}>
                            <input
                              type="text"
                              inputMode="decimal"
                              value={checklistEditDraft.quantidade_contada}
                              onChange={(e) =>
                                setChecklistEditDraft((d) =>
                                  d ? { ...d, quantidade_contada: e.target.value } : d,
                                )
                              }
                              {...{ [CHECKLIST_QTY_NAV_ATTR]: '' }}
                              style={inputPlanilhaQtdCell}
                              placeholder="—"
                              aria-label="Quantidade"
                            />
                            {openQtyCalculator ? (
                              <ChecklistQtyCalcButton
                                buttonStyle={buttonStyle}
                                onClick={() =>
                                  openQtyCalculator(
                                    (v) =>
                                      setChecklistEditDraft((d) => (d ? { ...d, quantidade_contada: v } : d)),
                                    `${checklistEditDraft.codigo_interno} — ${checklistEditDraft.descricao}`,
                                    calcHistoryKeyForCodigo(checklistEditDraft.codigo_interno),
                                  )
                                }
                              />
                            ) : null}
                          </div>
                        </td>
                      </>
                    ) : null}
                    {showChecklistColumn('data_fabricacao') ? (
                      <td style={tdPlanilha}>
                        <input
                          type="date"
                          max={maxDataFabricacaoHoje()}
                          value={it.data_fabricacao ?? ''}
                          onChange={(e) =>
                            updateOfflineItemFields(it.key, {
                              data_fabricacao: clampDataFabricacaoYmd(e.target.value),
                            })
                          }
                          style={{ ...inputPlanilha, width: 145 }}
                          aria-label={`Data de fabricação ${it.codigo_interno}`}
                        />
                      </td>
                    ) : null}
                    {showChecklistColumn('data_validade') ? (
                      <td style={tdPlanilha}>
                        <input
                          type="date"
                          value={it.data_validade ?? ''}
                          onChange={(e) =>
                            updateOfflineItemFields(it.key, { data_validade: e.target.value })
                          }
                          style={{ ...inputPlanilha, width: 145 }}
                          aria-label={`Data de vencimento ${it.codigo_interno}`}
                        />
                      </td>
                    ) : null}
                    {showChecklistColumn('lote') ? (
                      <td style={tdPlanilha}>
                        <input
                          type="text"
                          value={it.lote ?? ''}
                          onChange={(e) => updateOfflineItemFields(it.key, { lote: e.target.value })}
                          style={{ ...inputPlanilha, width: '100%', minWidth: 88 }}
                          placeholder="—"
                          aria-label={`Lote ${it.codigo_interno}`}
                        />
                      </td>
                    ) : null}
                    {showChecklistColumn('up') ? (
                      <td style={tdPlanilha}>
                        <input
                          type="text"
                          inputMode="decimal"
                          value={it.up_quantidade ?? ''}
                          onChange={(e) =>
                            updateOfflineItemFields(it.key, { up_quantidade: e.target.value })
                          }
                          style={{ ...inputPlanilha, width: '100%', minWidth: 72 }}
                          placeholder="—"
                          aria-label={`UP ${it.codigo_interno}`}
                        />
                      </td>
                    ) : null}
                    {showChecklistColumn('observacao') ? (
                      <td style={tdPlanilha}>
                        <input
                          type="text"
                          value={it.observacao ?? ''}
                          onChange={(e) =>
                            updateOfflineItemFields(it.key, { observacao: e.target.value })
                          }
                          style={{ ...inputPlanilha, width: 180 }}
                          placeholder="—"
                          aria-label={`Observação ${it.codigo_interno}`}
                        />
                      </td>
                    ) : null}
                    {showChecklistColumn('ean') ? (
                      <td style={tdPlanilha}>
                        <input
                          type="text"
                          inputMode="numeric"
                          value={it.ean ?? ''}
                          readOnly={planilhaModoEndereco ? !edicaoPlanilha : false}
                          onChange={
                            !planilhaModoEndereco || edicaoPlanilha
                              ? (e) => {
                                  const v = e.target.value
                                  updateOfflineItemFields(it.key, {
                                    ean: v.trim() === '' ? null : v,
                                  })
                                  onPlanilhaRowBarcodeChange?.(it.key, v)
                                }
                              : undefined
                          }
                          style={{
                            ...inputPlanilha,
                            width: 130,
                            minWidth: 100,
                            opacity: !planilhaModoEndereco || edicaoPlanilha ? 1 : 0.65,
                          }}
                          placeholder="—"
                          aria-label={`EAN ${it.codigo_interno}`}
                        />
                      </td>
                    ) : null}
                    {showChecklistColumn('dun') ? (
                      <td style={tdPlanilha}>
                        <input
                          type="text"
                          inputMode="numeric"
                          value={it.dun ?? ''}
                          readOnly={planilhaModoEndereco ? !edicaoPlanilha : false}
                          onChange={
                            !planilhaModoEndereco || edicaoPlanilha
                              ? (e) => {
                                  const v = e.target.value
                                  updateOfflineItemFields(it.key, {
                                    dun: v.trim() === '' ? null : v,
                                  })
                                  onPlanilhaRowBarcodeChange?.(it.key, v)
                                }
                              : undefined
                          }
                          style={{
                            ...inputPlanilha,
                            width: 130,
                            minWidth: 100,
                            opacity: !planilhaModoEndereco || edicaoPlanilha ? 1 : 0.65,
                          }}
                          placeholder="—"
                          aria-label={`DUN ${it.codigo_interno}`}
                        />
                      </td>
                    ) : null}
                    {showChecklistColumn('foto') ? (
                      <td style={tdPlanilha}>{hasPhoto ? 'Com foto' : 'Sem foto'}</td>
                    ) : null}
                    {showChecklistColumn('acoes') ? (
                      <td style={{ ...tdPlanilha, whiteSpace: 'normal' }}>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                          <button
                            type="button"
                            style={{ ...buttonStyle, background: '#0b5', fontSize: 12, padding: '6px 10px' }}
                            onClick={() => saveChecklistEdit()}
                          >
                            Salvar
                          </button>
                          <button
                            type="button"
                            style={{ ...buttonStyle, background: '#666', fontSize: 12, padding: '6px 10px' }}
                            onClick={() => cancelChecklistEdit()}
                          >
                            Cancelar
                          </button>
                        </div>
                      </td>
                    ) : null}
                  </>
                ) : (
                  <>
                    <td style={tdPlanilha}>{ruaPlanilha}</td>
                    <td style={tdPlanilha}>{pn.pos}</td>
                    <td style={tdPlanilha}>{pn.nivel}</td>
                    {planilhaModoEndereco ? (
                      <td style={{ ...tdPlanilha, fontWeight: isLinhaAtiva ? 700 : 400 }}>{linhaLabel}</td>
                    ) : null}
                    {showChecklistColumn('conferente') ? (
                      <td
                        style={{ ...tdPlanilha, maxWidth: 140 }}
                        title="Quem gravou esta linha no banco (visível para todos)"
                      >
                        {String(it.contagem_banco_ultimo_conferente_nome ?? '').trim() || conferenteLabel}
                      </td>
                    ) : null}
                    <td style={tdPlanilha}>
                      {onPlanilhaCodigoBlur && edicaoPlanilha ? (
                        <input
                          value={it.codigo_interno}
                          onChange={(e) =>
                            updateOfflineItemFields(it.key, { codigo_interno: e.target.value })
                          }
                          onBlur={(e) => onPlanilhaCodigoBlur(it.key, e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
                          }}
                          style={{ ...inputPlanilha, width: '100%', minWidth: 100 }}
                          placeholder="Digite o código"
                          aria-label="Código do produto"
                        />
                      ) : (
                        it.codigo_interno || '—'
                      )}
                    </td>
                    <td style={{ ...tdPlanilha, whiteSpace: 'normal', maxWidth: 420 }}>
                      {onPlanilhaCodigoBlur && edicaoPlanilha ? (
                        <input
                          value={it.descricao}
                          onChange={(e) => updateOfflineItemFields(it.key, { descricao: e.target.value })}
                          style={{ ...inputPlanilha, width: '100%', minWidth: 120 }}
                          placeholder="Digite a descrição"
                          aria-label="Descrição do produto"
                        />
                      ) : (
                        it.descricao || '—'
                      )}
                    </td>
                    {showChecklistColumn('unidade') ? (
                      <td style={tdPlanilha}>
                        <input
                          type="text"
                          value={it.unidade_medida ?? ''}
                          onChange={(e) =>
                            updateOfflineItemFields(it.key, {
                              unidade_medida: e.target.value.trim() === '' ? null : e.target.value,
                            })
                          }
                          style={{ ...inputPlanilha, width: 72, minWidth: 56 }}
                          placeholder="—"
                          aria-label={`Unidade ${it.codigo_interno}`}
                        />
                      </td>
                    ) : null}
                    {showChecklistColumn('quantidade') ? (
                      <>
                        <td style={{ ...tdPlanilha, textAlign: 'center', whiteSpace: 'nowrap' }}>
                          {contagemRodadaLabel}
                        </td>
                        <td style={tdPlanilhaQtd}>
                          <div style={planilhaQtdCellWrap}>
                            {edicaoPlanilha ? (
                              <>
                                <input
                                  type="text"
                                  inputMode="decimal"
                                  value={it.quantidade_contada ?? ''}
                                  onChange={(e) => updateOfflineItemQty(it.key, e.target.value)}
                                  {...{ [CHECKLIST_QTY_NAV_ATTR]: '' }}
                                  style={inputPlanilhaQtdCell}
                                  placeholder="—"
                                  aria-label={`Quantidade ${it.codigo_interno}${it.inventario_repeticao ? ` ${it.inventario_repeticao}ª` : ''}`}
                                />
                                {openQtyCalculator ? (
                                  <ChecklistQtyCalcButton
                                    buttonStyle={buttonStyle}
                                    onClick={() =>
                                      openQtyCalculator(
                                        (v) => updateOfflineItemQty(it.key, v),
                                        `${it.codigo_interno} — ${it.descricao}`,
                                        calcHistoryKeyForCodigo(it.codigo_interno),
                                      )
                                    }
                                  />
                                ) : null}
                              </>
                            ) : (
                              <span>{it.quantidade_contada || '—'}</span>
                            )}
                            {checklistSavedFlashKey === it.key ? (
                              <span
                                style={{
                                  position: 'absolute',
                                  top: -14,
                                  right: 0,
                                  fontSize: 10,
                                  color: '#0a0',
                                  fontWeight: 700,
                                  whiteSpace: 'nowrap',
                                }}
                              >
                                Salvo
                              </span>
                            ) : null}
                          </div>
                        </td>
                      </>
                    ) : null}
                    {showChecklistColumn('data_fabricacao') ? (
                      <td style={tdPlanilha}>
                        <input
                          type="date"
                          max={maxDataFabricacaoHoje()}
                          value={it.data_fabricacao ?? ''}
                          onChange={(e) =>
                            updateOfflineItemFields(it.key, {
                              data_fabricacao: clampDataFabricacaoYmd(e.target.value),
                            })
                          }
                          style={{ ...inputPlanilha, width: 145 }}
                          aria-label={`Data de fabricação ${it.codigo_interno}`}
                        />
                      </td>
                    ) : null}
                    {showChecklistColumn('data_validade') ? (
                      <td style={tdPlanilha}>
                        <input
                          type="date"
                          value={it.data_validade ?? ''}
                          onChange={(e) =>
                            updateOfflineItemFields(it.key, { data_validade: e.target.value })
                          }
                          style={{ ...inputPlanilha, width: 145 }}
                          aria-label={`Data de vencimento ${it.codigo_interno}`}
                        />
                      </td>
                    ) : null}
                    {showChecklistColumn('lote') ? (
                      <td style={tdPlanilha}>
                        <input
                          type="text"
                          value={it.lote ?? ''}
                          onChange={(e) => updateOfflineItemFields(it.key, { lote: e.target.value })}
                          style={{ ...inputPlanilha, width: '100%', minWidth: 88 }}
                          placeholder="—"
                          aria-label={`Lote ${it.codigo_interno}`}
                        />
                      </td>
                    ) : null}
                    {showChecklistColumn('up') ? (
                      <td style={tdPlanilha}>
                        <input
                          type="text"
                          inputMode="decimal"
                          value={it.up_quantidade ?? ''}
                          onChange={(e) =>
                            updateOfflineItemFields(it.key, { up_quantidade: e.target.value })
                          }
                          style={{ ...inputPlanilha, width: '100%', minWidth: 72 }}
                          placeholder="—"
                          aria-label={`UP ${it.codigo_interno}`}
                        />
                      </td>
                    ) : null}
                    {showChecklistColumn('observacao') ? (
                      <td style={tdPlanilha}>
                        <input
                          type="text"
                          value={it.observacao ?? ''}
                          onChange={(e) =>
                            updateOfflineItemFields(it.key, { observacao: e.target.value })
                          }
                          style={{ ...inputPlanilha, width: 180 }}
                          placeholder="—"
                          aria-label={`Observação ${it.codigo_interno}`}
                        />
                      </td>
                    ) : null}
                    {showChecklistColumn('ean') ? (
                      <td style={tdPlanilha}>
                        <input
                          type="text"
                          inputMode="numeric"
                          value={it.ean ?? ''}
                          readOnly={planilhaModoEndereco ? !edicaoPlanilha : false}
                          onChange={
                            !planilhaModoEndereco || edicaoPlanilha
                              ? (e) => {
                                  const v = e.target.value
                                  updateOfflineItemFields(it.key, {
                                    ean: v.trim() === '' ? null : v,
                                  })
                                  onPlanilhaRowBarcodeChange?.(it.key, v)
                                }
                              : undefined
                          }
                          style={{
                            ...inputPlanilha,
                            width: 130,
                            minWidth: 100,
                            opacity: !planilhaModoEndereco || edicaoPlanilha ? 1 : 0.65,
                          }}
                          placeholder="—"
                          aria-label={`EAN ${it.codigo_interno}`}
                        />
                      </td>
                    ) : null}
                    {showChecklistColumn('dun') ? (
                      <td style={tdPlanilha}>
                        <input
                          type="text"
                          inputMode="numeric"
                          value={it.dun ?? ''}
                          readOnly={planilhaModoEndereco ? !edicaoPlanilha : false}
                          onChange={
                            !planilhaModoEndereco || edicaoPlanilha
                              ? (e) => {
                                  const v = e.target.value
                                  updateOfflineItemFields(it.key, {
                                    dun: v.trim() === '' ? null : v,
                                  })
                                  onPlanilhaRowBarcodeChange?.(it.key, v)
                                }
                              : undefined
                          }
                          style={{
                            ...inputPlanilha,
                            width: 130,
                            minWidth: 100,
                            opacity: !planilhaModoEndereco || edicaoPlanilha ? 1 : 0.65,
                          }}
                          placeholder="—"
                          aria-label={`DUN ${it.codigo_interno}`}
                        />
                      </td>
                    ) : null}
                    {showChecklistColumn('foto') ? (
                      <td style={tdPlanilha}>{hasPhoto ? 'Com foto' : 'Sem foto'}</td>
                    ) : null}
                    {showChecklistColumn('acoes') ? (
                      <td style={{ ...tdPlanilha, whiteSpace: 'normal' }}>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                          <button
                            type="button"
                            style={{ ...buttonStyle, background: '#2a4d7a', fontSize: 12, padding: '6px 10px' }}
                            onClick={() => openChecklistEdit(it)}
                          >
                            Editar
                          </button>
                          <button
                            type="button"
                            style={{ ...buttonStyle, background: '#666', fontSize: 12, padding: '6px 10px' }}
                            onClick={() => handleLimparQuantidadeOffline(it.key)}
                          >
                            Limpar
                          </button>
                          <button
                            type="button"
                            style={{
                              ...buttonStyle,
                              background: hasPhoto ? '#0b5' : '#444',
                              fontSize: 12,
                              padding: '6px 10px',
                            }}
                            onClick={() => openPhotoModalForCodigo(it.codigo_interno)}
                            title={hasPhoto ? 'Ver/atualizar foto' : 'Anexar foto'}
                          >
                            {hasPhoto ? 'Foto (ok)' : 'Sem foto'}
                          </button>
                          {hasPhoto ? (
                            <button
                              type="button"
                              style={{ ...buttonStyle, background: '#a85a00', fontSize: 12, padding: '6px 10px' }}
                              onClick={() => removePhotoFromChecklistItem(it)}
                              title="Remover foto anexada"
                            >
                              Remover foto
                            </button>
                          ) : null}
                        </div>
                      </td>
                    ) : null}
                  </>
                )}
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

/** @deprecated Use `InventarioPlanilhaTabela` */
export const InventarioPlanilhaArmazemDesktopTable = InventarioPlanilhaTabela
export type InventarioPlanilhaArmazemDesktopTableProps = InventarioPlanilhaTabelaProps

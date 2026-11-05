import { useState, type ChangeEvent } from 'react'
import { useBodyScrollLock } from '../hooks/useBodyScrollLock'
import type { NotaFiscal, NotaFiscalCancelada } from '../types'
import { notasDisponiveisParaVinculo } from '../lib/nfCanceladas'

type Props = {
  canceladas: NotaFiscalCancelada[]
  notas: NotaFiscal[]
  onUpload: (file: File) => void
  onVincular: (canceladaId: string, novaNfId: string) => void
  onDesvincular: (canceladaId: string) => void
  onExcluir: (canceladaId: string) => void
  onCancelarCancelada: (canceladaId: string) => void
  canceladaPendenteId: string | null
  uploadError: string | null
}

export function CanceladasPanel({
  canceladas,
  notas,
  onUpload,
  onVincular,
  onDesvincular,
  onExcluir,
  onCancelarCancelada,
  canceladaPendenteId,
  uploadError,
}: Props) {
  const [selecao, setSelecao] = useState<Record<string, string>>({})
  const [confirmarCancelar, setConfirmarCancelar] = useState<string | null>(null)
  const [confirmarExcluir, setConfirmarExcluir] = useState<string | null>(null)
  useBodyScrollLock(confirmarCancelar !== null || confirmarExcluir !== null)

  function handleFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (file) onUpload(file)
    e.target.value = ''
  }

  const canceladaPendente = canceladaPendenteId
    ? canceladas.find((c) => c.id === canceladaPendenteId && !c.vinculoNfNovaId) ?? null
    : null

  const confirmDialogs = (
    <>
      {confirmarCancelar && (() => {
        const c = canceladas.find((x) => x.id === confirmarCancelar)
        if (!c) return null
        return (
          <div className="confirm-backdrop" onClick={() => setConfirmarCancelar(null)}>
            <div className="confirm-box" onClick={(e) => e.stopPropagation()}>
              <h4>Cancelar cadastro?</h4>
              <p>
                NF cancelada <strong>{c.numero}</strong>
              </p>
              <p className="confirm-warn">
                O registro será removido. Nenhum vínculo com NF nova será criado.
              </p>
              <div className="confirm-actions">
                <button type="button" className="btn" onClick={() => setConfirmarCancelar(null)}>
                  Voltar
                </button>
                <button
                  type="button"
                  className="btn btn-danger"
                  onClick={() => {
                    onCancelarCancelada(c.id)
                    setConfirmarCancelar(null)
                    setSelecao((s) => {
                      const next = { ...s }
                      delete next[c.id]
                      return next
                    })
                  }}
                >
                  Cancelar cadastro
                </button>
              </div>
            </div>
          </div>
        )
      })()}

      {confirmarExcluir && (() => {
        const c = canceladas.find((x) => x.id === confirmarExcluir)
        if (!c) return null
        return (
          <div className="confirm-backdrop" onClick={() => setConfirmarExcluir(null)}>
            <div className="confirm-box" onClick={(e) => e.stopPropagation()}>
              <h4>Excluir NF cancelada?</h4>
              <p>
                NF <strong>{c.numero}</strong>
              </p>
              <p className="confirm-warn">
                O registro será removido permanentemente do histórico de canceladas.
              </p>
              <div className="confirm-actions">
                <button type="button" className="btn" onClick={() => setConfirmarExcluir(null)}>
                  Voltar
                </button>
                <button
                  type="button"
                  className="btn btn-danger"
                  onClick={() => {
                    onExcluir(c.id)
                    setConfirmarExcluir(null)
                    setSelecao((s) => {
                      const next = { ...s }
                      delete next[c.id]
                      return next
                    })
                  }}
                >
                  Excluir
                </button>
              </div>
            </div>
          </div>
        )
      })()}
    </>
  )

  if (canceladas.length === 0) {
    return (
      <>
        <label className="upload-btn upload-btn--muted">
          <input type="file" accept=".xml,text/xml,application/xml" hidden onChange={handleFile} />
          Subir XML da NF-e cancelada (nota ou evento)
        </label>
        {uploadError && <p className="error">{uploadError}</p>}
        <p className="muted canceladas-empty">Nenhuma NF cancelada registrada.</p>
        {confirmDialogs}
      </>
    )
  }

  return (
    <>
      <label className="upload-btn upload-btn--muted">
        <input type="file" accept=".xml,text/xml,application/xml" hidden onChange={handleFile} />
        Subir XML da NF-e cancelada (nota ou evento)
      </label>
      {uploadError && <p className="error">{uploadError}</p>}

      {canceladaPendente && (
        <div className="sidebar-block canceladas-pendente">
          <div className="nf-detail-head">
            <h3>NF {canceladaPendente.numero}</h3>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => setConfirmarCancelar(canceladaPendente.id)}
            >
              Cancelar cadastro
            </button>
          </div>
          <p className="muted">Vincule à NF nova ou cancele para remover o registro.</p>
        </div>
      )}

      <p className="muted canceladas-hint">
        Vincule a NF cancelada à nota nova para rastrear substituição.
      </p>

      <ul className="canceladas-list">
        {canceladas.map((c) => {
          const opcoes = notasDisponiveisParaVinculo(notas, canceladas, c.id)
          const sel = selecao[c.id] ?? ''
          return (
            <li key={c.id} className="canceladas-card">
              <div className="canceladas-head">
                <span className="canceladas-badge">Cancelada</span>
                <button
                  type="button"
                  className="hist-delete"
                  title="Excluir NF cancelada"
                  onClick={() => setConfirmarExcluir(c.id)}
                >
                  <TrashIcon />
                </button>
              </div>
              <strong>NF {c.numero}</strong>
              <p className="muted">{c.emitente || '—'}</p>
              <p className="muted">{formatDate(c.dataEmissao)} · {c.items.length} item(ns)</p>

              {c.vinculoNfNovaId ? (
                <div className="vinculo-box vinculo-box--ok">
                  <span className="vinculo-label">Vínculo</span>
                  <p>
                    <span className="vinculo-antiga">NF antiga {c.numero}</span>
                    <span className="vinculo-arrow">→</span>
                    <span className="vinculo-nova">NF nova {c.vinculoNfNovaNumero}</span>
                  </p>
                  <button type="button" className="btn btn-sm" onClick={() => onDesvincular(c.id)}>
                    Desvincular
                  </button>
                </div>
              ) : (
                <div className="vinculo-box">
                  <span className="vinculo-label">Vincular à NF nova</span>
                  <div className="vinculo-form">
                    <select
                      className="input-select"
                      value={sel}
                      onChange={(e) => setSelecao((s) => ({ ...s, [c.id]: e.target.value }))}
                    >
                      <option value="">Selecione a NF nova…</option>
                      {opcoes.map((n) => (
                        <option key={n.id} value={n.id}>
                          NF {n.numero} — {n.emitente?.slice(0, 28)}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      className="btn primary btn-sm"
                      disabled={!sel}
                      onClick={() => {
                        onVincular(c.id, sel)
                        setSelecao((s) => ({ ...s, [c.id]: '' }))
                      }}
                    >
                      Vincular
                    </button>
                    {sel && (
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        onClick={() => setSelecao((s) => ({ ...s, [c.id]: '' }))}
                      >
                        Cancelar
                      </button>
                    )}
                  </div>
                  {opcoes.length === 0 && (
                    <p className="muted vinculo-aviso">Suba a NF nova na seção Entrada primeiro.</p>
                  )}
                </div>
              )}
            </li>
          )
        })}
      </ul>
      {confirmDialogs}
    </>
  )
}

function TrashIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M4 7h16M9 7V5h6v2M10 11v6M14 11v6M6 7l1 13h10l1-13"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function formatDate(raw: string): string {
  if (!raw) return '—'
  const d = new Date(raw)
  if (Number.isNaN(d.getTime())) return raw.slice(0, 10)
  return d.toLocaleString('pt-BR')
}

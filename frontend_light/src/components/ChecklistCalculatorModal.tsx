import { useEffect, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import { normalizeCodigoInternoCompareKey } from '../lib/codigoInternoCompare'

const CALC_HIST_STORAGE_PREFIX = 'checklist-qty-calc-hist:v1'
const MAX_CALC_HIST = 30

export type QtyCalcHistoryItem = { expr: string; result: string; at: string }

/** Chave estável por código de produto para histórico no `localStorage`. */
export function calcHistoryKeyForCodigo(codigo: string | null | undefined): string | undefined {
  const raw = String(codigo ?? '').trim()
  if (!raw) return undefined
  const norm = normalizeCodigoInternoCompareKey(raw)
  return norm || raw.toLowerCase()
}

function loadQtyCalcHistory(storageKey: string): QtyCalcHistoryItem[] {
  try {
    const s = localStorage.getItem(`${CALC_HIST_STORAGE_PREFIX}:${storageKey}`)
    if (!s) return []
    const p = JSON.parse(s) as { items?: QtyCalcHistoryItem[] }
    if (!Array.isArray(p.items)) return []
    return p.items.filter((x) => x && typeof x.expr === 'string' && typeof x.result === 'string')
  } catch {
    return []
  }
}

function pushQtyCalcHistory(storageKey: string, expr: string, result: string) {
  const e = expr.trim()
  if (!storageKey || !e) return
  const prev = loadQtyCalcHistory(storageKey)
  const item: QtyCalcHistoryItem = { expr: e, result, at: new Date().toISOString() }
  const next = [item, ...prev].slice(0, MAX_CALC_HIST)
  try {
    localStorage.setItem(`${CALC_HIST_STORAGE_PREFIX}:${storageKey}`, JSON.stringify({ items: next }))
  } catch {
    /* quota ou modo privado */
  }
}

function clearQtyCalcHistory(storageKey: string) {
  try {
    localStorage.removeItem(`${CALC_HIST_STORAGE_PREFIX}:${storageKey}`)
  } catch {
    /* ignore */
  }
}

export function evaluateQtyExpression(input: string): { ok: true; value: number } | { ok: false; error: string } {
  const raw = input.trim().replace(/\s/g, '').replace(/,/g, '.')
  if (raw === '') return { ok: false, error: 'Digite um cálculo ou número.' }
  if (!/^[0-9+\-*/().]+$/.test(raw)) return { ok: false, error: 'Use apenas números e operadores + - * / ( ).' }
  try {
    const result = Function(`"use strict"; return (${raw})`)() as unknown
    if (typeof result !== 'number' || !Number.isFinite(result)) {
      return { ok: false, error: 'Resultado inválido.' }
    }
    if (result < 0) return { ok: false, error: 'Quantidade não pode ser negativa.' }
    return { ok: true, value: result }
  } catch {
    return { ok: false, error: 'Expressão inválida.' }
  }
}

export function formatQtyForChecklist(n: number): string {
  if (!Number.isFinite(n)) return ''
  const rounded = Math.round(n * 1_000_000) / 1_000_000
  if (Number.isInteger(rounded)) return String(rounded)
  return String(rounded)
}

const padBtn: CSSProperties = {
  padding: '12px 14px',
  fontSize: 18,
  fontWeight: 600,
  borderRadius: 8,
  border: '1px solid var(--border, #555)',
  background: 'var(--code-bg, #2a2a30)',
  color: 'var(--text-h, #fff)',
  cursor: 'pointer',
  minWidth: 48,
}

type Props = {
  open: boolean
  onClose: () => void
  onApply: (value: string) => void
  productHint?: string
  /** Chave do produto (ex.: `calcHistoryKeyForCodigo`) para histórico em `localStorage`. */
  historyStorageKey?: string
}

export function ChecklistCalculatorModal({ open, onClose, onApply, productHint, historyStorageKey }: Props) {
  const [expr, setExpr] = useState('')
  const [msg, setMsg] = useState('')
  const [showHistoryPanel, setShowHistoryPanel] = useState(false)
  const [historyItems, setHistoryItems] = useState<QtyCalcHistoryItem[]>([])
  /** Expressão completa antes do último `=`; assim o histórico mostra a conta (ex.: 500+125), não só o resultado no campo. */
  const formulaForHistoryRef = useRef<string | null>(null)

  useEffect(() => {
    if (open) {
      setExpr('')
      setMsg('')
      setShowHistoryPanel(false)
      formulaForHistoryRef.current = null
      if (historyStorageKey) {
        setHistoryItems(loadQtyCalcHistory(historyStorageKey))
      } else {
        setHistoryItems([])
      }
    }
  }, [open, historyStorageKey])

  if (!open) return null

  const clearHistoryFormula = () => {
    formulaForHistoryRef.current = null
  }

  const append = (ch: string) => {
    setMsg('')
    clearHistoryFormula()
    setExpr((e) => e + ch)
  }

  const back = () => {
    setMsg('')
    clearHistoryFormula()
    setExpr((e) => e.slice(0, -1))
  }

  const clear = () => {
    setMsg('')
    clearHistoryFormula()
    setExpr('')
  }

  const equals = () => {
    const r = evaluateQtyExpression(expr)
    if (r.ok) {
      formulaForHistoryRef.current = expr.trim()
      setExpr(formatQtyForChecklist(r.value))
      setMsg('')
    } else {
      setMsg(r.error)
    }
  }

  const insertResult = () => {
    const r = evaluateQtyExpression(expr)
    if (!r.ok) {
      setMsg(r.error)
      return
    }
    const valueStr = formatQtyForChecklist(r.value)
    const savedFormula = formulaForHistoryRef.current?.trim()
    const histExpr =
      savedFormula && savedFormula !== '' ? savedFormula : expr.trim()
    if (historyStorageKey) {
      pushQtyCalcHistory(historyStorageKey, histExpr, valueStr)
      setHistoryItems(loadQtyCalcHistory(historyStorageKey))
    }
    formulaForHistoryRef.current = null
    onApply(valueStr)
    onClose()
  }

  const key = (label: string, value: string) => (
    <button type="button" key={value} style={padBtn} onClick={() => append(value)}>
      {label}
    </button>
  )

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="checklist-calc-title"
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,.55)',
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        zIndex: 100000,
        padding: 16,
        boxSizing: 'border-box',
      }}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        style={{
          width: '100%',
          maxWidth: 360,
          background: 'var(--panel-bg, #1e1f26)',
          border: '1px solid var(--border, #444)',
          borderRadius: 12,
          padding: 16,
          color: 'var(--text, #e5e7eb)',
          boxSizing: 'border-box',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <h3 id="checklist-calc-title" style={{ margin: '0 0 8px', fontSize: 17 }}>
          Calculadora
        </h3>
        {productHint ? (
          <p style={{ margin: '0 0 10px', fontSize: 12, color: 'var(--text, #9ca3af)' }}>{productHint}</p>
        ) : null}
        {historyStorageKey ? (
          <div style={{ marginBottom: 10 }}>
            <button
              type="button"
              onClick={() => setShowHistoryPanel((v) => !v)}
              style={{
                ...padBtn,
                width: '100%',
                fontSize: 13,
                padding: '10px 12px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 8,
              }}
              aria-expanded={showHistoryPanel}
            >
              <span>
                Histórico de cálculos neste item
                {historyItems.length > 0 ? (
                  <span style={{ color: '#93c5fd', marginLeft: 6 }}>({historyItems.length})</span>
                ) : null}
              </span>
              <span aria-hidden style={{ fontSize: 11, opacity: 0.85 }}>
                {showHistoryPanel ? 'Ocultar' : 'Ver'}
              </span>
            </button>
            {showHistoryPanel ? (
              <div
                style={{
                  marginTop: 8,
                  maxHeight: 160,
                  overflowY: 'auto',
                  borderRadius: 8,
                  border: '1px solid var(--border, #444)',
                  background: 'var(--bg, #12131a)',
                  padding: '8px 10px',
                  boxSizing: 'border-box',
                }}
              >
                {historyItems.length === 0 ? (
                  <p style={{ margin: 0, fontSize: 12, color: 'var(--text, #9ca3af)', lineHeight: 1.45 }}>
                    Nenhum registro ainda. Ao usar <strong style={{ color: 'var(--text-h, #e5e7eb)' }}>Inserir resultado na quantidade</strong>, o
                    cálculo fica salvo aqui neste aparelho.
                  </p>
                ) : (
                  <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {historyItems.map((h, i) => (
                      <li key={`${h.at}-${i}`}>
                        <button
                          type="button"
                          onClick={() => {
                            setMsg('')
                            clearHistoryFormula()
                            setExpr(h.expr)
                          }}
                          title="Reutilizar esta expressão no campo"
                          style={{
                            width: '100%',
                            textAlign: 'left',
                            padding: '8px 10px',
                            borderRadius: 6,
                            border: '1px solid rgba(79, 142, 255, 0.35)',
                            background: 'rgba(79, 142, 255, 0.08)',
                            color: 'var(--text-h, #f3f4f6)',
                            cursor: 'pointer',
                            fontSize: 13,
                            fontFamily: 'ui-monospace, Consolas, monospace',
                            lineHeight: 1.35,
                            boxSizing: 'border-box',
                          }}
                        >
                          <span style={{ color: '#fde68a' }}>{h.expr}</span>
                          <span style={{ color: 'var(--text, #9ca3af)' }}> → </span>
                          <strong style={{ color: '#86efac' }}>{h.result}</strong>
                          <div style={{ fontSize: 10, color: 'var(--text, #6b7280)', marginTop: 4, fontFamily: 'var(--sans, system-ui)' }}>
                            {new Date(h.at).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}
                          </div>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                {historyItems.length > 0 ? (
                  <button
                    type="button"
                    onClick={() => {
                      clearQtyCalcHistory(historyStorageKey)
                      setHistoryItems([])
                    }}
                    style={{
                      marginTop: 10,
                      width: '100%',
                      padding: '8px 10px',
                      fontSize: 12,
                      borderRadius: 6,
                      border: '1px solid #7f1d1d',
                      background: 'rgba(127, 29, 29, 0.25)',
                      color: '#fecaca',
                      cursor: 'pointer',
                    }}
                  >
                    Apagar todo o histórico deste item
                  </button>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : null}
        <input
          type="text"
          inputMode="decimal"
          value={expr}
          onChange={(e) => {
            setMsg('')
            clearHistoryFormula()
            setExpr(e.target.value.replace(/,/g, '.'))
          }}
          placeholder="Ex.: 100+50*2"
          style={{
            width: '100%',
            boxSizing: 'border-box',
            padding: '12px 10px',
            fontSize: 18,
            fontFamily: 'monospace',
            borderRadius: 8,
            border: '1px solid var(--border, #555)',
            marginBottom: 10,
            background: 'var(--bg, #12131a)',
            color: 'var(--text-h, #fff)',
          }}
          aria-label="Expressão"
        />
        {msg ? (
          <div style={{ color: '#f87171', fontSize: 13, marginBottom: 10 }}>{msg}</div>
        ) : null}

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(4, 1fr)',
            gap: 8,
            marginBottom: 12,
          }}
        >
          <button type="button" style={padBtn} onClick={clear}>
            C
          </button>
          <button type="button" style={padBtn} onClick={back}>
            {'\u2190'}
          </button>
          <button type="button" style={{ ...padBtn, background: '#374151' }} onClick={() => append('(')}>
            (
          </button>
          <button type="button" style={{ ...padBtn, background: '#374151' }} onClick={() => append(')')}>
            )
          </button>

          {key('7', '7')}
          {key('8', '8')}
          {key('9', '9')}
          <button type="button" style={{ ...padBtn, background: '#374151' }} onClick={() => append('/')}>
            /
          </button>

          {key('4', '4')}
          {key('5', '5')}
          {key('6', '6')}
          <button type="button" style={{ ...padBtn, background: '#374151' }} onClick={() => append('*')}>
            *
          </button>

          {key('1', '1')}
          {key('2', '2')}
          {key('3', '3')}
          <button type="button" style={{ ...padBtn, background: '#374151' }} onClick={() => append('-')}>
            -
          </button>

          {key('0', '0')}
          {key('.', '.')}
          <button type="button" style={{ ...padBtn, background: '#374151' }} onClick={() => append('+')}>
            +
          </button>
          <button type="button" style={{ ...padBtn, background: '#1d4ed8' }} onClick={equals}>
            =
          </button>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <button
            type="button"
            onClick={insertResult}
            style={{
              ...padBtn,
              width: '100%',
              background: 'linear-gradient(180deg, #16a34a 0%, #15803d 100%)',
              border: '1px solid #166534',
              fontSize: 15,
            }}
          >
            Inserir resultado na quantidade
          </button>
          <button
            type="button"
            onClick={onClose}
            style={{
              ...padBtn,
              width: '100%',
              background: 'transparent',
              fontSize: 14,
            }}
          >
            Fechar
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}

type BtnProps = {
  onClick: () => void
  buttonStyle: CSSProperties
  disabled?: boolean
  title?: string
}

function CalcIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden focusable="false">
      <rect x="3" y="2" width="18" height="20" rx="2" fill="none" stroke="currentColor" strokeWidth="1.75" />
      <line x1="7" y1="6" x2="17" y2="6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <circle cx="8" cy="10.5" r="1.15" fill="currentColor" />
      <circle cx="12" cy="10.5" r="1.15" fill="currentColor" />
      <circle cx="16" cy="10.5" r="1.15" fill="currentColor" />
      <circle cx="8" cy="14.5" r="1.15" fill="currentColor" />
      <circle cx="12" cy="14.5" r="1.15" fill="currentColor" />
      <circle cx="16" cy="14.5" r="1.15" fill="currentColor" />
      <rect x="7" y="17.2" width="10" height="2.8" rx="0.6" fill="currentColor" />
    </svg>
  )
}

export function ChecklistQtyCalcButton({ onClick, buttonStyle, disabled, title }: BtnProps) {
  return (
    <button
      type="button"
      disabled={disabled}
      title={title ?? 'Calculadora — inserir resultado nesta quantidade'}
      aria-label={title ?? 'Abrir calculadora para esta quantidade'}
      onClick={(e) => {
        e.preventDefault()
        e.stopPropagation()
        onClick()
      }}
      style={{
        ...buttonStyle,
        padding: '6px 10px',
        fontSize: 12,
        lineHeight: 1,
        minWidth: 72,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 6,
        flexShrink: 0,
        border: '1px solid #4f8eff',
        boxShadow: '0 0 0 1px rgba(79, 142, 255, 0.25)',
      }}
    >
      <CalcIcon />
      <span style={{ fontWeight: 800, letterSpacing: 0.02 }}>Calc</span>
    </button>
  )
}

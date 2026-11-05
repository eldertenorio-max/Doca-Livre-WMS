import { createPortal } from 'react-dom'
import {
  CAMARAS,
  NIVEIS,
  cellKind,
  makeAddressId,
  portaCellBackgroundStyle,
  portaCellEdgeClasses,
  type CamaraConfig,
  type RuaConfig,
} from '../layout/camaras'
import { portaCamaraUrl } from '../lib/portaCamaraAsset'
import { codigoProdutoExibicao } from '../lib/codigoProduto'
import type { AddressId, AddressOccupancy } from '../types'

const CELL_GAP = 0

/** A4 paisagem: 210mm − margens @page 5mm = 200mm úteis na vertical. */
const PRINT_PAGE_HEIGHT_MM = 200
const PRINT_PAGE_HEADER_MM = 20
const PRINT_PAGE_FOOTER_MM = 28
const PRINT_BODY_WIDTH_MM = 287
const PRINT_BODY_HEIGHT_MM = PRINT_PAGE_HEIGHT_MM - PRINT_PAGE_HEADER_MM - PRINT_PAGE_FOOTER_MM
const PRINT_COL_HEADER_MM = 8

type PrintCellDims = {
  cellW: number
  cellH: number
  labelW: number
  headerH: number
  gridW: number
  gridH: number
}

function printGridMetrics(colunas: number, cellW: number, cellH: number): PrintCellDims {
  const labelW = Math.max(10, Math.round(cellW * 0.55))
  const gapsW = (colunas - 1) * CELL_GAP
  const gapsH = (NIVEIS.length - 1) * CELL_GAP
  const gridW = labelW + 3 + colunas * cellW + gapsW
  const gridH = PRINT_COL_HEADER_MM + NIVEIS.length * cellH + gapsH
  return { cellW, cellH, labelW, headerH: PRINT_COL_HEADER_MM, gridW, gridH }
}

/** Largura máxima por coluna; altura estica para preencher a folha (retângulo vertical). */
function computePrintCellDimensions(colunas: number): PrintCellDims {
  const gapsW = (colunas - 1) * CELL_GAP
  const gapsH = (NIVEIS.length - 1) * CELL_GAP
  const overheadW = 12

  const cellW = Math.round(((PRINT_BODY_WIDTH_MM - overheadW - gapsW) / colunas) * 10) / 10
  const cellH = Math.round(((PRINT_BODY_HEIGHT_MM - PRINT_COL_HEADER_MM - gapsH) / NIVEIS.length) * 10) / 10

  let dims = printGridMetrics(colunas, cellW, cellH)

  while (dims.gridW > PRINT_BODY_WIDTH_MM && dims.cellW > 8) {
    const nextW = Math.round((dims.cellW - 0.1) * 10) / 10
    const nextH = Math.round(((PRINT_BODY_HEIGHT_MM - PRINT_COL_HEADER_MM - gapsH) / NIVEIS.length) * 10) / 10
    dims = printGridMetrics(colunas, nextW, nextH)
  }

  while (dims.gridH > PRINT_BODY_HEIGHT_MM && dims.cellH > 8) {
    const nextH = Math.round((dims.cellH - 0.2) * 10) / 10
    dims = printGridMetrics(colunas, dims.cellW, nextH)
  }

  return dims
}

function printColAxisFont(cellW: number): number {
  return Math.max(14, Math.min(22, Math.round(cellW * 0.82)))
}

function printRowAxisFont(cellH: number): number {
  return Math.max(14, Math.min(28, Math.round(cellH * 0.36)))
}

function printNfFontSize(cellW: number, cellH: number): number {
  const ref = Math.min(cellW, cellH)
  if (ref >= 14) return 11
  if (ref >= 11) return 9
  if (ref >= 9) return 7.5
  return 6
}

function printNfLabel(numero: string, cellW: number, cellH: number): string {
  const ref = Math.min(cellW, cellH)
  if (ref >= 11) return numero
  if (ref >= 9) return numero.length > 6 ? numero.slice(-6) : numero
  return numero.length > 4 ? numero.slice(-4) : numero
}

function printCodigoFontSize(cellW: number, cellH: number): number {
  const nf = printNfFontSize(cellW, cellH)
  if (nf >= 11) return 9
  if (nf >= 9) return 7.5
  if (nf >= 7.5) return 6.5
  return 5.5
}

function printCodigoLabel(codigo: string, cellW: number, cellH: number): string {
  const ref = Math.min(cellW, cellH)
  if (ref >= 14) return codigo.length > 12 ? `${codigo.slice(0, 11)}…` : codigo
  if (ref >= 11) return codigo.length > 10 ? `${codigo.slice(0, 9)}…` : codigo
  if (ref >= 9) return codigo.length > 8 ? `${codigo.slice(0, 7)}…` : codigo
  return codigo.length > 6 ? `${codigo.slice(0, 5)}…` : codigo
}

type Props = {
  camaraIds: number[]
  occupancy?: Map<AddressId, AddressOccupancy>
}

function PrintRuaGrid({
  camaraId,
  config,
  dims,
  occupancy,
}: {
  camaraId: number
  config: RuaConfig
  dims: PrintCellDims
  occupancy?: Map<AddressId, AddressOccupancy>
}) {
  const { cellW, cellH, labelW } = dims
  const colFont = printColAxisFont(cellW)
  const rowFont = printRowAxisFont(cellH)

  return (
    <div className="print-rua-grid">
      <div
        className="print-col-headers"
        style={{
          marginLeft: labelW + 3,
          gridTemplateColumns: `repeat(${config.colunas}, ${cellW}mm)`,
          gap: `${CELL_GAP}mm`,
        }}
      >
        {Array.from({ length: config.colunas }, (_, i) => (
          <span key={i} className="print-axis" style={{ width: `${cellW}mm`, fontSize: colFont }}>
            {i + 1}
          </span>
        ))}
      </div>

      <div className="print-rua-body">
        <div className="print-row-labels" style={{ width: labelW, gap: `${CELL_GAP}mm` }}>
          {NIVEIS.map((nivel) => (
            <span
              key={nivel}
              className="print-axis print-axis--row"
              style={{ height: `${cellH}mm`, lineHeight: `${cellH}mm`, fontSize: rowFont }}
            >
              {nivel}
            </span>
          ))}
        </div>

        <div className="print-cells-area">
          <div className="print-cells-stack" style={{ gap: `${CELL_GAP}mm` }}>
            {NIVEIS.map((nivel) => (
              <div
                key={nivel}
                className="print-cells-row"
                style={{
                  gridTemplateColumns: `repeat(${config.colunas}, ${cellW}mm)`,
                  gap: `${CELL_GAP}mm`,
                }}
              >
                {Array.from({ length: config.colunas }, (_, i) => {
                  const col = i + 1
                  const addressId = makeAddressId(camaraId, config.rua, nivel, col)
                  const kind = cellKind(
                    col,
                    nivel,
                    config.colunas,
                    config.porta,
                    config.semNivel5Inexistente !== false,
                    config.colunasBloqueadas,
                    config.celulasBloqueadas,
                  )
                  const occ = occupancy?.get(addressId)
                  const portaBg =
                    kind === 'porta' && config.porta
                      ? portaCellBackgroundStyle(col, nivel, config.porta, portaCamaraUrl)
                      : null
                  let cellClass = `print-cell print-cell--${kind}`
                  if (occ && kind === 'disponivel') cellClass += ' print-cell--ocupado'
                  if (kind === 'porta' && config.porta) {
                    const edge = portaCellEdgeClasses(col, nivel, config.porta)
                    if (edge) cellClass += ` ${edge.replace(/cell--/g, 'print-cell--')}`
                  }
                  const nfFont = printNfFontSize(cellW, cellH)
                  const codigoFont = printCodigoFontSize(cellW, cellH)
                  const codigo = occ
                    ? codigoProdutoExibicao(occ.codigo, occ.descricao)
                    : ''
                  return (
                    <div
                      key={addressId}
                      className={cellClass}
                      style={{
                        width: `${cellW}mm`,
                        height: `${cellH}mm`,
                        ...(portaBg ?? {}),
                      }}
                    >
                      {occ && kind === 'disponivel' && (
                        <span className="print-cell-labels">
                          <span
                            className="print-cell-nf"
                            style={{ fontSize: `${nfFont}pt` }}
                          >
                            {printNfLabel(occ.nfNumero, cellW, cellH)}
                          </span>
                          {codigo && (
                            <span
                              className="print-cell-codigo"
                              style={{ fontSize: `${codigoFont}pt` }}
                            >
                              {printCodigoLabel(codigo, cellW, cellH)}
                            </span>
                          )}
                        </span>
                      )}
                    </div>
                  )
                })}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

function PrintPage({
  cam,
  rua,
  pageIndex,
  totalPages,
  occupancy,
}: {
  cam: CamaraConfig
  rua: RuaConfig
  pageIndex: number
  totalPages: number
  occupancy?: Map<AddressId, AddressOccupancy>
}) {
  const dims = computePrintCellDimensions(rua.colunas)
  const isRua1 = rua.rua === cam.ruas[0]?.rua
  const versoRua = cam.ruas.find((r) => r.rua !== rua.rua)
  const withOccupancy = occupancy != null

  return (
    <section className="print-page">
      <header className="print-page-header">
        <div>
          <h1>Câmara {cam.id}</h1>
          <p className="print-page-sub">{cam.tipo} · Rua {rua.rua}</p>
        </div>
        <div className="print-page-meta">
          <span>
            Ultrafrio — {withOccupancy ? 'Mapa de ocupação' : 'Layout de endereçamento'}
          </span>
          <span>
            Folha {pageIndex + 1} de {totalPages}
          </span>
        </div>
      </header>

      <div className="print-page-body">
        <PrintRuaGrid camaraId={cam.id} config={rua} dims={dims} occupancy={occupancy} />
      </div>

      <footer className="print-page-footer">
        <div className="print-legend">
          {withOccupancy ? (
            <>
              <span><i className="print-swatch print-swatch--ocup" /> Ocupado (NF + código)</span>
              <span><i className="print-swatch print-swatch--disp" /> Disponível</span>
            </>
          ) : (
            <span><i className="print-swatch print-swatch--disp" /> Posição</span>
          )}
          <span><i className="print-swatch print-swatch--porta" /> Porta</span>
          <span><i className="print-swatch print-swatch--nv5" /> Nív. 5 inexistente</span>
        </div>
        {isRua1 && versoRua && (
          <p className="print-duplex-hint">
            Impressão frente e verso: esta folha = <strong>Rua {rua.rua}</strong> (frente) · verso ={' '}
            <strong>Rua {versoRua.rua}</strong>
          </p>
        )}
        {!isRua1 && (
          <p className="print-duplex-hint">
            Verso da folha anterior — <strong>Rua {rua.rua}</strong>
          </p>
        )}
      </footer>
    </section>
  )
}

export function PrintLayoutDocument({ camaraIds, occupancy }: Props) {
  const pages: { cam: CamaraConfig; rua: RuaConfig }[] = []

  for (const cam of CAMARAS) {
    if (!camaraIds.includes(cam.id)) continue
    for (const rua of cam.ruas) {
      pages.push({ cam, rua })
    }
  }

  if (pages.length === 0) return null

  return createPortal(
    <div className="print-document" aria-hidden>
      {pages.map(({ cam, rua }, i) => (
        <PrintPage
          key={`${cam.id}-r${rua.rua}`}
          cam={cam}
          rua={rua}
          pageIndex={i}
          totalPages={pages.length}
          occupancy={occupancy}
        />
      ))}
    </div>,
    document.body,
  )
}

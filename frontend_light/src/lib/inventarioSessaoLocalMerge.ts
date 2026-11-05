import { mergeLinhasCapturaPorId } from './capturaSessaoLinhasMerge'
import { mergeSessaoStatusComFontesLocais } from './capturaSessaoExportUtils'
import { readCachedInventario } from './inventarioLocalCache'
import type { InventarioLinhaCaptura } from './inventarioSessaoTypes'
import type { InventarioSessao } from './inventarioSessaoTypes'

const LINHAS_OVERLAY_KEY = 'inventario-linhas-overlay-v1'

function readLinhasOverlayMap(): Record<string, InventarioLinhaCaptura[]> {
  try {
    const raw = localStorage.getItem(LINHAS_OVERLAY_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as Record<string, InventarioLinhaCaptura[]>
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

/** Une linhas, status e dataFim do banco com cache/overlay local. */
export function mergeInventarioComFontesLocais(
  sessao: InventarioSessao,
  extraFontes?: Array<InventarioSessao | null | undefined>,
): InventarioSessao {
  const overlay = readLinhasOverlayMap()[sessao.id]
  const cached = readCachedInventario(sessao.id)
  const fontes = [cached, ...(extraFontes ?? [])].filter(Boolean) as InventarioSessao[]
  const linhas = mergeLinhasCapturaPorId(
    sessao.linhas,
    overlay,
    ...fontes.map((f) => f.linhas),
  )
  return mergeSessaoStatusComFontesLocais({ ...sessao, linhas }, fontes)
}

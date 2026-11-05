import { mergeLinhasCapturaPorId } from './capturaSessaoLinhasMerge'
import { mergeSessaoStatusComFontesLocais } from './capturaSessaoExportUtils'
import { readCachedSessao } from './contagemDiariaLocalCache'
import type { ContagemDiariaLinhaCaptura } from './contagemDiariaLinhaTypes'
import type { ContagemDiariaSessao } from './contagemDiariaSessaoTypes'

const LINHAS_OVERLAY_KEY = 'contagem-diaria-linhas-overlay-v1'

function readLinhasOverlayMap(): Record<string, ContagemDiariaLinhaCaptura[]> {
  try {
    const raw = localStorage.getItem(LINHAS_OVERLAY_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as Record<string, ContagemDiariaLinhaCaptura[]>
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

/** Une linhas, status e dataFim do banco com cache/overlay local. */
export function mergeContagemDiariaComFontesLocais(
  sessao: ContagemDiariaSessao,
  extraFontes?: Array<ContagemDiariaSessao | null | undefined>,
): ContagemDiariaSessao {
  const overlay = readLinhasOverlayMap()[sessao.id]
  const cached = readCachedSessao(sessao.id)
  const fontes = [cached, ...(extraFontes ?? [])].filter(Boolean) as ContagemDiariaSessao[]
  const linhas = mergeLinhasCapturaPorId(
    sessao.linhas,
    overlay,
    ...fontes.map((f) => f.linhas),
  )
  return mergeSessaoStatusComFontesLocais({ ...sessao, linhas }, fontes)
}

import { syncContagemDiariaSessaoParaContagens } from './contagemDiariaFinalizeSync'
import { getContagemDiaria, saveContagemDiaria } from './contagemDiariaSessaoStore'

const QUEUE_KEY = 'contagem-diaria-pending-sync-v1'

export function loadPendingContagemDiariaSync(): string[] {
  try {
    const raw = localStorage.getItem(QUEUE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as string[]
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function savePendingContagemDiariaSync(ids: string[]): void {
  try {
    localStorage.setItem(QUEUE_KEY, JSON.stringify(ids))
  } catch {
    /* quota */
  }
}

export function enqueuePendingContagemDiariaSync(sessaoId: string): void {
  const queue = loadPendingContagemDiariaSync()
  if (!queue.includes(sessaoId)) {
    queue.push(sessaoId)
    savePendingContagemDiariaSync(queue)
  }
}

export function removePendingContagemDiariaSync(sessaoId: string): void {
  savePendingContagemDiariaSync(loadPendingContagemDiariaSync().filter((id) => id !== sessaoId))
}

export function countPendingContagemDiariaSync(): number {
  return loadPendingContagemDiariaSync().length
}

/** Envia ao Supabase as contagens finalizadas offline. */
export async function flushPendingContagemDiariaSync(opts?: {
  onProgress?: (msg: string) => void
}): Promise<{ enviadas: number; erros: string[] }> {
  const queue = loadPendingContagemDiariaSync()
  if (!queue.length) return { enviadas: 0, erros: [] }

  let enviadas = 0
  const erros: string[] = []

  for (const id of queue) {
    opts?.onProgress?.(`Sincronizando contagem ${id.slice(0, 8)}…`)
    try {
      const sessao = await getContagemDiaria(id)
      if (!sessao || sessao.status !== 'fechado' || sessao.linhas.length === 0) {
        removePendingContagemDiariaSync(id)
        continue
      }
      await saveContagemDiaria(sessao)
      const { inserted } = await syncContagemDiariaSessaoParaContagens(sessao, { force: true })
      if (inserted > 0 || sessao.linhas.length > 0) {
        removePendingContagemDiariaSync(id)
        enviadas++
      }
    } catch (e) {
      erros.push(e instanceof Error ? e.message : String(e))
    }
  }

  return { enviadas, erros }
}

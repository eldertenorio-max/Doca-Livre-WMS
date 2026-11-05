import { syncInventarioSessaoParaContagens } from './inventarioSessaoFinalizeSync'
import { getInventario, saveInventario } from './inventarioSessaoStore'

const QUEUE_KEY = 'inventario-pending-sync-v1'

export function loadPendingInventarioSync(): string[] {
  try {
    const raw = localStorage.getItem(QUEUE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as string[]
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function savePendingInventarioSync(ids: string[]): void {
  try {
    localStorage.setItem(QUEUE_KEY, JSON.stringify(ids))
  } catch {
    /* quota */
  }
}

export function enqueuePendingInventarioSync(sessaoId: string): void {
  const queue = loadPendingInventarioSync()
  if (!queue.includes(sessaoId)) {
    queue.push(sessaoId)
    savePendingInventarioSync(queue)
  }
}

export function removePendingInventarioSync(sessaoId: string): void {
  savePendingInventarioSync(loadPendingInventarioSync().filter((id) => id !== sessaoId))
}

export function countPendingInventarioSync(): number {
  return loadPendingInventarioSync().length
}

/** Envia ao Supabase inventários finalizados offline. */
export async function flushPendingInventarioSync(opts?: {
  onProgress?: (msg: string) => void
}): Promise<{ enviadas: number; erros: string[] }> {
  const queue = loadPendingInventarioSync()
  if (!queue.length) return { enviadas: 0, erros: [] }

  let enviadas = 0
  const erros: string[] = []

  for (const id of queue) {
    opts?.onProgress?.(`Sincronizando inventário ${id.slice(0, 8)}…`)
    try {
      const sessao = await getInventario(id)
      if (!sessao || sessao.status !== 'fechado' || sessao.linhas.length === 0) {
        removePendingInventarioSync(id)
        continue
      }
      await saveInventario(sessao)
      const { inserted } = await syncInventarioSessaoParaContagens(sessao, { force: true })
      if (inserted > 0 || sessao.linhas.length > 0) {
        removePendingInventarioSync(id)
        enviadas++
      }
    } catch (e) {
      erros.push(e instanceof Error ? e.message : String(e))
    }
  }

  return { enviadas, erros }
}

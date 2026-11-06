/**
 * Tempo real por consulta periódica (substitui o WebSocket do Supabase).
 *
 * Com os dados na Azure, o backend do WMS expõe a API compatível em `/sb`
 * e o endpoint `/sb/changes?since=<ms>` diz quais tabelas mudaram. Aqui
 * `client.channel()` passa a devolver um canal que consulta esse endpoint (a cada 4 s)
 * e chama os callbacks `postgres_changes` das tabelas alteradas — os módulos
 * continuam usando `.channel().on(...).subscribe()` sem mudança.
 */

type PayloadMudanca = {
  eventType: '*'
  schema: string
  table: string
  commit_timestamp: string
  new: Record<string, unknown>
  old: Record<string, unknown>
  errors: null
}

type Handler = { table: string; cb: (payload: PayloadMudanca) => void }

type StatusCb = (status: string, err?: unknown) => void

export type CanalConsulta = {
  topic: string
  on: (tipo: string, filtro: unknown, cb?: (payload: PayloadMudanca) => void) => CanalConsulta
  subscribe: (cb?: StatusCb) => CanalConsulta
  unsubscribe: () => Promise<'ok'>
}

const INTERVALO_MS = 4000

let base = ''
let desde: number | null = null
let timer: ReturnType<typeof setInterval> | null = null
let consultando = false
const ativos = new Set<{ handlers: Handler[] }>()

function tabelasAtivas(): string[] {
  const s = new Set<string>()
  for (const c of ativos) for (const h of c.handlers) s.add(h.table)
  return [...s]
}

async function consultar(): Promise<void> {
  if (consultando || !ativos.size) return
  if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return
  consultando = true
  try {
    const tabelas = tabelasAtivas().filter((t) => t !== '*')
    // 1ª consulta só sincroniza o relógio com o servidor (sem disparar recarga).
    const since = desde === null ? 9999999999999 : desde
    const url = `${base}/changes?since=${since}&tables=${encodeURIComponent(tabelas.join(','))}`
    const res = await fetch(url, { credentials: 'same-origin', cache: 'no-store' })
    if (!res.ok) return
    const json = (await res.json()) as { now?: number; changed?: string[] }
    const primeira = desde === null
    if (typeof json.now === 'number') desde = json.now
    if (primeira) return
    for (const tabela of json.changed ?? []) {
      const payload: PayloadMudanca = {
        eventType: '*',
        schema: 'public',
        table: tabela,
        commit_timestamp: new Date().toISOString(),
        new: {},
        old: {},
        errors: null,
      }
      for (const canal of ativos) {
        for (const h of canal.handlers) {
          if (h.table === tabela || h.table === '*') {
            try {
              h.cb(payload)
            } catch {
              /* callback do módulo não deve parar a consulta */
            }
          }
        }
      }
    }
  } catch {
    /* rede instável: tenta na próxima rodada */
  } finally {
    consultando = false
  }
}

function iniciar(): void {
  if (timer) return
  void consultar()
  timer = setInterval(() => void consultar(), INTERVALO_MS)
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', aoVoltarParaAba)
  }
}

function parar(): void {
  if (ativos.size) return
  if (timer) clearInterval(timer)
  timer = null
  if (typeof document !== 'undefined') {
    document.removeEventListener('visibilitychange', aoVoltarParaAba)
  }
}

function aoVoltarParaAba(): void {
  if (document.visibilityState === 'visible') void consultar()
}

function criarCanal(topic: string): CanalConsulta {
  const estado = { handlers: [] as Handler[] }
  const canal: CanalConsulta = {
    topic,
    on(tipo, filtro, cb) {
      if (tipo === 'postgres_changes' && typeof cb === 'function') {
        const f = (filtro ?? {}) as { table?: string }
        estado.handlers.push({ table: f.table || '*', cb })
      }
      return canal
    },
    subscribe(cb) {
      ativos.add(estado)
      iniciar()
      if (cb) setTimeout(() => cb('SUBSCRIBED'), 0)
      return canal
    },
    async unsubscribe() {
      ativos.delete(estado)
      parar()
      return 'ok'
    },
  }
  return canal
}

/** True quando o cliente aponta para a camada /sb do próprio WMS (dados na Azure). */
export function usaBackendWms(url: string): boolean {
  return /\/sb\/?$/.test(String(url || '').trim())
}

/** Troca channel/removeChannel do cliente supabase-js pelo canal por consulta. */
export function instalarRealtimePorConsulta<T extends object>(client: T, url: string): T {
  base = String(url).replace(/\/+$/, '')
  const c = client as unknown as Record<string, unknown>
  c.channel = (topic: string) => criarCanal(topic)
  c.removeChannel = async (canal: CanalConsulta | null | undefined) => {
    await canal?.unsubscribe?.()
    return 'ok'
  }
  c.removeAllChannels = async () => {
    ativos.clear()
    parar()
    return []
  }
  c.getChannels = () => []
  return client
}

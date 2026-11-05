/** Une linhas de captura por `id`, mantendo a versão mais recente de cada uma. */
export function mergeLinhasCapturaPorId<T extends { id: string; createdAt: string }>(
  ...listas: Array<T[] | undefined | null>
): T[] {
  const map = new Map<string, T>()
  for (const list of listas) {
    if (!list?.length) continue
    for (const ln of list) {
      const prev = map.get(ln.id)
      if (!prev || String(ln.createdAt).localeCompare(String(prev.createdAt)) >= 0) {
        map.set(ln.id, ln)
      }
    }
  }
  return [...map.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

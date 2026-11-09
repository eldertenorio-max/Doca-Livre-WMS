import { useLayoutEffect, useRef, useState } from 'react'
import { LOGO_DOCA_LIVRE_CLARO_SRC, LOGO_DOCA_LIVRE_ESCURO_SRC } from '../lib/brandAssets'
import { fundoEhEscuro, useTemaAtual } from '../lib/useLogoDocaLivre'

type Props = {
  className?: string
  alt?: string
}

/**
 * Logo Doca Livre que escolhe a versão pelo fundo real atrás dela:
 * azul-marinho em fundo claro, branca em fundo escuro (o cabeçalho, por exemplo,
 * fica branco nos dois temas). Mede de novo quando o tema muda.
 */
export function LogoDocaLivre({ className, alt = '' }: Props) {
  const ref = useRef<HTMLImageElement>(null)
  const tema = useTemaAtual()
  const [escuro, setEscuro] = useState(false)

  useLayoutEffect(() => {
    const medir = () => {
      const r = fundoEhEscuro(ref.current)
      setEscuro(r ?? tema === 'dark')
    }
    medir()
    const t = window.setTimeout(medir, 450) // depois das transições de cor da troca de tema
    return () => window.clearTimeout(t)
  }, [tema])

  return (
    <img
      ref={ref}
      src={escuro ? LOGO_DOCA_LIVRE_ESCURO_SRC : LOGO_DOCA_LIVRE_CLARO_SRC}
      alt={alt}
      className={className}
      data-versao={escuro ? 'escura' : 'clara'}
    />
  )
}

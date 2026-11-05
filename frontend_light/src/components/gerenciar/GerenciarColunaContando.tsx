import { labelContandoGerenciar } from '../../lib/capturaPresencaStatus'

type Props = {
  aberto: boolean
  nomes?: string[]
}

export default function GerenciarColunaContando({ aberto, nomes }: Props) {
  const { texto, title } = labelContandoGerenciar(aberto, nomes)
  if (!aberto) return <span className="inv-contando inv-contando--na">—</span>
  if (!nomes?.length) {
    return (
      <span className="inv-contando inv-contando--livre" title={title}>
        Livre
      </span>
    )
  }
  return (
    <span className="inv-contando inv-contando--ativo" title={title}>
      {texto}
    </span>
  )
}

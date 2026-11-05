import type { Session } from '@supabase/supabase-js'
import { usernameFromSession } from '../lib/authUser'
import './AcessoPendenteScreen.css'

type Props = {
  session: Session | null
  onSignOut: () => void
  onRecarregar: () => void
  recarregando?: boolean
}

export default function AcessoPendenteScreen({ session, onSignOut, onRecarregar, recarregando }: Props) {
  const nome = usernameFromSession(session)

  return (
    <div className="acesso-pendente">
      <div className="acesso-pendente__card">
        <h1 className="acesso-pendente__title">Aguardando autorização</h1>
        <p className="acesso-pendente__text">
          Olá, <strong>{nome}</strong>. Sua conta foi criada e está aguardando aprovação do administrador.
        </p>
        <p className="acesso-pendente__text">
          O responsável irá definir quais telas você poderá acessar. Tente novamente em alguns minutos ou entre em
          contato com o administrador.
        </p>
        <div className="acesso-pendente__actions">
          <button type="button" disabled={recarregando} onClick={onRecarregar}>
            {recarregando ? 'Verificando…' : 'Verificar novamente'}
          </button>
          <button type="button" className="page-btn-ghost" onClick={onSignOut}>
            Sair
          </button>
        </div>
      </div>
    </div>
  )
}

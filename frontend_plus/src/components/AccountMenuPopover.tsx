import { useEffect, useRef, type RefObject } from 'react'
import type { ContaUsuario } from '../lib/contaSessao'
import { corAvatarUsuario, iniciaisUsuario } from '../lib/contaSessao'
import type { Theme } from '../lib/theme'

type Props = {
  open: boolean
  onClose: () => void
  anchorRef: RefObject<HTMLElement | null>
  usuarios: ContaUsuario[]
  usuarioAtivoId: string
  onSelectUsuario: (id: string) => void
  onConfigConta: () => void
  onComandoVoz: () => void
  theme: Theme
  onToggleTheme: () => void
}

function UsuarioAvatar({ usuario, size = 32 }: { usuario: ContaUsuario; size?: number }) {
  if (usuario.avatarUrl) {
    return (
      <span
        className="account-menu-avatar account-menu-avatar--img"
        style={{ width: size, height: size }}
      >
        <img src={usuario.avatarUrl} alt="" />
      </span>
    )
  }

  return (
    <span
      className="account-menu-avatar account-menu-avatar--iniciais"
      style={{ width: size, height: size, background: corAvatarUsuario(usuario.id) }}
      aria-hidden
    >
      {iniciaisUsuario(usuario.nome)}
    </span>
  )
}

export function AccountMenuPopover({
  open,
  onClose,
  anchorRef,
  usuarios,
  usuarioAtivoId,
  onSelectUsuario,
  onConfigConta,
  onComandoVoz,
  theme,
  onToggleTheme,
}: Props) {
  const panelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return

    function onPointerDown(e: PointerEvent) {
      const target = e.target as Node
      if (panelRef.current?.contains(target)) return
      if (anchorRef.current?.contains(target)) return
      onClose()
    }

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }

    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open, onClose, anchorRef])

  if (!open) return null

  return (
    <div ref={panelRef} className="account-menu-popover" role="menu" aria-label="Menu da conta">
      <p className="account-menu-section-label">Conta</p>
      <button type="button" className="account-menu-item" role="menuitem" onClick={onConfigConta}>
        Configurações da conta
      </button>
      <button type="button" className="account-menu-item" role="menuitem" onClick={onComandoVoz}>
        IA DOCA LIVRE
      </button>
      <button type="button" className="account-menu-item" role="menuitem" onClick={onToggleTheme}>
        Tema {theme === 'dark' ? 'claro' : 'escuro'}
      </button>

      <div className="account-menu-divider" role="separator" />

      <p className="account-menu-section-label">Usuários logados</p>
      {usuarios.length === 0 ? (
        <p className="account-menu-empty muted">Nenhum usuário nesta sessão.</p>
      ) : (
        <ul className="account-menu-users">
          {usuarios.map((usuario) => {
            const ativo = usuario.id === usuarioAtivoId
            return (
              <li key={usuario.id}>
                <button
                  type="button"
                  className={`account-menu-user ${ativo ? 'account-menu-user--active' : ''}`}
                  role="menuitemradio"
                  aria-checked={ativo}
                  onClick={() => onSelectUsuario(usuario.id)}
                >
                  <UsuarioAvatar usuario={usuario} />
                  <span className="account-menu-user-name">{usuario.nome}</span>
                  {ativo && <span className="account-menu-user-badge">Ativo</span>}
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

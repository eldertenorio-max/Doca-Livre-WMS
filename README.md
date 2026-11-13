# Doca Livre WMS

Sistema de gestão de armazém (WMS) da Doca Livre: cadastros, endereçamento com mapa 2D/3D, entrada, movimentação,
saída, retornos, estoque, inventário, agendamento, financeiro de armazenagem, hierarquia, portal do cliente, coletor
e controle de voz.

Feito em Python (Flask + SQLAlchemy). Roda com SQLite no computador e com Postgres em produção.

## Rodar no computador

```
python -m venv .venv
.venv\Scripts\pip install -r requirements.txt
.venv\Scripts\python app.py
```

Abre em http://127.0.0.1:5002. No primeiro início, com o banco vazio, é criado o usuário `admin` (Super Usuário), que
troca a senha no primeiro acesso. O banco fica em `instance/wms.db`.

## Produção

- **Endereço oficial:** https://wms.docalivre.com.br, domínio próprio que aponta para o Azure Container Apps. A imagem é construída a partir do `Dockerfile`.
- **Render**: o serviço antigo só redireciona para o endereço oficial na Azure (ver `destino_do_redirecionamento` em
  `wms/__init__.py`).

Variáveis de ambiente (nunca escreva os valores no código):

| Variável | Para que serve |
|---|---|
| `DATABASE_URL` | Postgres de produção. Sem ela o sistema usa SQLite dentro do serviço e os dados somem. |
| `SECRET_KEY` | Chave da sessão. |
| `SESSION_COOKIE_SECURE` | `1` em produção (HTTPS). |
| `ADMIN_PASSWORD` | Senha do `admin` criado no primeiro início, quando o banco está vazio. |
| `MEU_DANFE_API_KEY` | Chave do Meu Danfe, para o PDF oficial das notas. Opcional. |
| `ACS_ENDPOINT`, `EMAIL_FROM` | E-mail de confirmação de cadastro e resumo dos alertas, pelo Azure Communication Services (o mesmo do Faz um Freela). Na Azure o sistema se autentica pela identidade gerenciada; fora dela, use `ACS_CONNECTION_STRING`. |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM` | Alternativa ao ACS: servidor de e-mail comum. Opcional. |

Logos e fotos de perfil ficam guardados também no banco, porque em produção o disco do aplicativo é apagado a cada
reinício.

## Código antigo

O WMS anterior (Pro, Plus e Light) está guardado neste repositório nos branches `legado/*`.

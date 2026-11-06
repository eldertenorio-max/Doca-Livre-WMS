# Inventário completo de funcionalidades — WMS Doca Livre (Pro + Plus + Light)

> Levantamento feito por leitura do código em 06/11/2026, branch `homolog`, para planejar uma interface única sem perder nenhuma função.
> Só está registrado o que foi encontrado no código, sempre com o arquivo de origem.
> Os números de linha são aproximados. O `app.py` foi alterado durante o levantamento (passou de 17.566 para 17.598 linhas) e as rotas andaram cerca de 32 linhas; as citações seguem a versão mais recente lida.

## Sumário

- [Resumo](#resumo)
- [Convenções](#convenções)
- [Mapa de entrada: como cada sistema é aberto](#mapa-de-entrada-como-cada-sistema-é-aberto)
- [1. Entrada unificada e administração (Flask)](#1-entrada-unificada-e-administração-flask)
- [2. Pro — `/painel`](#2-pro--painel)
- [3. Plus / Câmaras — `/camaras`](#3-plus--câmaras--camaras)
- [4. Light / Contagem — `/contagem`](#4-light--contagem--contagem)
- [5. Proposta de organização por processo do armazém](#5-proposta-de-organização-por-processo-do-armazém)
- [6. Sobreposições](#6-sobreposições)
- [7. Código morto / não ligado](#7-código-morto--não-ligado)
- [8. Anexo: tabelas, endpoints e serviços externos](#8-anexo-tabelas-endpoints-e-serviços-externos)

## Resumo

| Sistema | Rota | Telas (abas/sub-abas/seções/views) | Funcionalidades listadas | Controle de acesso real |
|---|---|---|---|---|
| Entrada unificada (Flask) | `/login`, `/entrada`, `/usuarios/novo` | 3 (+ serviços de backend) | 29 | Login; cadastro de usuários só SU |
| **Pro** — operacional | `/painel?modulo=carregamento\|devolucoes\|terceiros\|estoque-sp` | 34 (Carregamento 9, Devoluções 6, Terceiros 11, Estoque SP 8) | 161 | Só login |
| **Pro** — Endereçamento WMS | `/painel?modulo=enderecamento-wms` | 26 sub-abas | 112 | Só login (+ flags `RFQ_FLAG_*`) |
| **Pro (total)** | `/painel` | **60** | **273** | Só login |
| **Plus / Câmaras** | `/camaras?secao=` | **21** (12 seções do menu + abas internas, mapa principal, Hierarquia & Permissões e login interno) | **125** | Login + permissão Editar/Visualizar por seção (no cliente) |
| **Light / Contagem** | `/contagem?view=` | **21** (16 views com tela, `permissoes` vazia e abas internas) | **145** | Só login |
| **Total** | — | **105** | **572** | — |

Como foi contado:
- **Telas:** cada aba, sub-aba ou view que o usuário abre. As abas internas com conteúdo próprio também contam: Financeiro 3PL (5), Estoque de Segurança (3), Painel de Contagem (2), Estoque do Light (2), Consulta do Plus (2), Hierarquia & Permissões (2). Os blocos "estrutura comum" não contam.
- **Funcionalidades:** cada linha de primeiro nível nas seções 1 a 4. Ações quase iguais foram agrupadas numa linha; os levantamentos detalhados chegaram a ~157 linhas no Pro operacional, 114 no WMS, ~133 no Plus e 173 no Light.

Principais achados:
1. **Só o Plus aplica permissão por tela.**
   - Pro e Light exigem apenas login. O catálogo `portal_permissoes.py` tem os módulos dos três sistemas, mas o Pro e o Light não o leem.
   - Qualquer usuário logado pode executar ações destrutivas no Pro, como excluir importação Ravex em cascata, zerar conferência ou excluir NF.
2. **Dados:** Plus e Light acessam os dados pela camada `/sb` do Flask (`supabase_compat.py`, Postgres da Azure). O Pro usa as rotas próprias `/api/*`. **Nenhum sistema lê as tabelas dos outros**, com uma única ponte: Pro operacional ↔ WMS (`terceiros_*`, `romaneio_por_item`, `produtos_bipados`).
3. **Usuários:** o cadastro é só por Super Usuário em `/usuarios/novo`, e a tela de login não tem autocadastro. O cadastro por código de e-mail que restou no login interno do Plus também exige SU.
4. **Sobreposições centrais:**
   - 3 cadastros de endereços;
   - 4 bases de produto;
   - 2 fluxos de entrada de NF-e;
   - 2 inventários e 4 consultas de estoque;
   - ocupação, estoque de segurança, shelf life e visão cruzada duplicados entre o Pro (WMS) e o Light;
   - 3 telas de agendamento para a mesma API.
5. **Código morto relevante:**
   - `frontend_light/src/pages/ContagemEstoque.tsx` (9,3 mil linhas) guarda funções que não existem em mais nenhum lugar: foto do produto, calculadora, checklist, planilha de inventário por armazém.
   - O Plus perdeu a única tela de cadastro de voz (`CadastroVozPanel.tsx`, não importado).
   - Morreram também `templates/portal.html`, a bipagem de terceiros no Pro, todas as rotas ZPL/CSV de etiqueta e 7 rotas RFQ.

## Convenções

- **Uma linha por funcionalidade**, no formato: `Ação concreta — endpoints/tabelas — (arquivo:linha)`.
- **Tela** é cada aba, sub-aba, seção ou view que o usuário abre (títulos `####`). As contagens do resumo contam esses títulos e as linhas de funcionalidade de primeiro nível.
- **Permissão:** fica no início de cada sistema e de cada tela. Exceções aparecem na própria linha:
  - `[SU]` = só Super Usuário;
  - `[editar]` = no Plus, exige nível "Editar" no módulo (no nível "Visualizar" a ação é bloqueada).
- **Caminhos:**
  - Pro: relativos à raiz (`static/script.js`, `templates/index.html`, `app.py`, `wms_enderecamento.py`, `rfq_platform.py`).
  - Plus: relativos a `frontend_plus/src`.
  - Light: relativos a `frontend_light/src`.
- **Tabelas do Plus e do Light** são lidas e gravadas pelo cliente Supabase, que no deploy atual aponta para o compat do Flask, `/sb/rest/v1/<tabela>` (`supabase_compat.py:518`). Quando a linha cita só a tabela, o endpoint é esse.

## Mapa de entrada: como cada sistema é aberto

| Rota | O que abre | Arquivo | Controle de acesso |
|---|---|---|---|
| `/` | Redireciona ao `/entrada` (logado) ou ao `/login` | `app.py:2449` | — |
| `/login` | Tela de login única | `templates/login.html`; `app.py:2429` | público |
| `/entrada` | Hub unificado com os atalhos dos 3 sistemas | `templates/entrada_modulos.html`, `static/entrada-modulos.js`; `app.py:3921` | sessão |
| `/painel?modulo=<carregamento\|devolucoes\|terceiros\|estoque-sp\|enderecamento-wms>[&aba=]` | **Pro** (Flask + JS puro) | `templates/index.html`, `static/script.js`; `app.py:3934` | sessão (sem permissão por módulo) |
| `/camaras?secao=<...>` | **Plus** (bundle React em `static/wms-plus`) | `frontend_plus/src`; `app.py:3899` (`_serve_unified_spa('wms-plus')`) | sessão + permissão por módulo (no cliente) |
| `/contagem?view=<...>` | **Light** (bundle React em `static/wms-light`) | `frontend_light/src`; `app.py:3892` | sessão (sem permissão por view) |
| `/config-portal` | Redireciona para `/camaras?secao=config` (Hierarquia & Permissões) | `app.py:3906` | APIs exigem SU |
| `/usuarios/novo` | Cadastro de usuários | `templates/usuarios_novo.html`; `app.py:3912` | SU |

**Atalhos do Hub** (`window.SS_HUB_MODULOS`, `templates/entrada_modulos.html:117-153`):

- **Pro (5):**
  - `carregamento` (Carga / Expedição)
  - `devolucoes` (Retorno / Devoluções)
  - `terceiros&aba=pendencia-recebimento` (Descarga / Recebimento) — **o `&aba` é ignorado**
  - `estoque-sp` (Estoque Geral)
  - `enderecamento-wms` (Endereçamento WMS 2D/3D)
- **Plus (12):** `consulta`, `entrada`, `saida`, `editar`, `agendamentosHub`, `painel`, `financeiro`, `historico`, `relatorio`, `canceladas`, `cadastroVoz`, `imprimir`.
- **Light (10):** `contagem`, `inventarios`, `temperatura`, `ocupacao`, `seguranca`, `estoque`, `produtos`, `enderecamento`, `agendamentos`, `painel`.
- **Admin (2, só SU):** `/config-portal`, `/usuarios/novo`.

**Telas que existem mas não têm atalho no Hub:**

- **Light:** `produtosFamilia`, `produtosGrupos`, `produtosSubGrupos` e `produtosImportacao` (só pelo menu lateral); `contagemCaptura` e `inventarioCaptura` (só por botão).
- **Pro:** as abas internas de cada módulo.

---

## 1. Entrada unificada e administração (Flask)

> **Quem pode usar:**
> - Login e Hub: qualquer usuário cadastrado na tabela `usuarios`.
> - Cadastro de usuários e Hierarquia & Permissões: só Super Usuário.
> - Super Usuário é uma lista fixa em `PORTAL_SUPERUSERS`: variável de ambiente; o padrão é Diego/Elder e variações; login em formato de e-mail só vale no domínio `docalivre.com.br` (`portal_permissoes.py:10-24, 77-118`).
> - **Não existe papel ou perfil aplicado no Pro nem no Light.** O catálogo de permissões por módulo (`portal_permissoes.py:28-66`) só é respeitado pelo Plus.

#### Login — `/login`
- Entrar com usuário, e-mail ou nome completo (quando o 1º nome é único) e senha. Timeout de 12 s. Ao entrar, vai para `/entrada` — POST `/api/login` — tabela `usuarios` (`senha_hash` pbkdf2) — (templates/login.html:135-175; app.py:2545; `_buscar_usuario_login` ~app.py:2465)
- O login também emite o `hub_token` (SSO) e devolve `is_superuser` — (app.py:2578-2592)
- Mostrar/ocultar senha — (templates/login.html:114-139)
- Já logado: `/login` redireciona ao Hub; mostra o cartão "Acessar painel" — (app.py:2429-2447; templates/login.html:67)
- Sair: `/login?sair=1` (ou `/?sair=1`) limpa a sessão — (app.py:2429-2460)
- Splash de abertura da marca — (templates/_doca_livre_splash.html; static/doca-livre-intro.js)

#### Hub — `/entrada`
- Cards dos módulos em 4 grupos: Operação/Doca (Pro), Câmaras/NF-e/3PL (Plus), Contagem/Inventário (Light) e Administração (só SU) — (templates/entrada_modulos.html:84-153; static/entrada-modulos.js:150-168)
- Pesquisar módulo pelo nome; esconde as seções sem resultado — (static/entrada-modulos.js:197-203, 174-180)
- Favoritar/desfavoritar pela estrela. Grava em `localStorage ss_hub_fav_v1`; o padrão é Endereçamento WMS, Mapa de Câmaras e Contagem Diária — (static/entrada-modulos.js:58-75, 104-127)
- Seção "Recentes": os 6 últimos módulos abertos (`localStorage ss_hub_recent_v1`) — (static/entrada-modulos.js:5-7, 62-67)
- Menu lateral com "Mais acessados", Favoritos e "Todos os módulos" (expansível). "Mais acessados" são, na verdade, os 8 primeiros da lista fixa — (static/entrada-modulos.js:170-172, 205-214)
- Recolher/expandir o menu lateral (`localStorage dl-hub-sidebar-wide`) — (static/entrada-modulos.js:216-247)
- Relógio no rodapé do menu — (static/entrada-modulos.js:186-195)
- Atalhos "+ Usuários" e "⚙ Hierarquia & Permissões" na barra superior — [SU] — (templates/entrada_modulos.html:37-40)
- Sair — `/login?sair=1` — (templates/entrada_modulos.html:46)
- Banner de instalação como app (PWA) — `/sw.js`, `/manifest.webmanifest`, ícones — (templates/_pwa_install.html; static/pwa-install.js; app.py:3766-3826)
- Faixa de "ambiente de homologação" — (templates/_app_env_banner.html)

> Obs.: o Hub mostra todos os módulos para qualquer usuário logado. A matriz de permissões do portal não filtra os cards.

#### Cadastrar Usuários — `/usuarios/novo` [SU]
- Cadastrar usuário (usuário com 2+ caracteres, senha com 4+, confirmação) — POST `/api/cadastrar` [SU] — `usuarios` — (templates/usuarios_novo.html:122-152; app.py:3650)
- Listar os usuários com a data de criação — GET `/api/usuarios` [SU] — `usuarios` — (templates/usuarios_novo.html:109-118; app.py:3721)
- Filtrar a lista pelo nome — (templates/usuarios_novo.html:68, 120)
- Quem não é SU é redirecionado ao Hub — (app.py:3912-3918)

> Obs.: não há edição, exclusão, troca de senha nem e-mail nesta tela. O "esqueci a senha" e o cadastro por código de e-mail só existem no login interno do Plus (seção 3).

#### Serviços transversais do backend (sem tela própria)
- Proteção global: `before_request proteger_rotas` exige sessão em tudo, menos `login`, `static`, `/api/health`, `/api/ravex-env-check`, `/api/sso/*` e `/api/portal/*`. Também confere se o usuário ainda existe (cache de 600 s) — (app.py:2390-2427, 2300)
- SSO entre sistemas — `sso_portal.py`, tabelas de tokens — (app.py:3547-3648):
  - POST `/api/sso/issue` emite o token e respeita `pode_acessar`;
  - POST `/api/sso/verify` consome o token;
  - GET `/sso/entrar` cria a sessão no Pro.
- Dados do usuário logado (usuário, `is_superuser`, matriz de permissões) — POST `/api/portal/me` — tabelas de permissões do portal — (app.py:3095)
- Ponte Supabase → PostgreSQL para o Plus e o Light — (supabase_compat.py:49-64, 518-722, 732, 773-781):
  - `/sb/rest/v1/<tabela>` com lista branca `TABELAS_PERMITIDAS` (21 tabelas/views do Light e 10 do Plus) e alias `usuarios`→`light_usuarios`;
  - recusa DELETE sem filtro;
  - `/sb/changes` faz "tempo real" por consulta periódica;
  - `/sb/auth/v1` e `/sb/realtime/v1` respondem "indisponível".
- Injeta `window.__WMS_UNIFIED__` (usuario, isSuperuser, hubToken, `supabaseUrl=<origem>/sb`, hubHref, logoutHref) no HTML dos bundles Plus e Light — (app.py `_serve_unified_spa` ~3840-3890)
- Config do cliente Supabase — GET `/supabase-config.json` — (app.py:3827)
- Health check público (`?db=1` testa o banco) — GET `/api/health` — (app.py:3733)
- F5 em qualquer página autenticada redireciona ao `/login`, que manda de volta ao Hub — (static/stock-system-reload-login.js; app.py:2429-2447)

---

## 2. Pro — `/painel`

> **Quem pode usar:** basta estar logado.
> - O controle é só o `before_request proteger_rotas` (app.py:2390) e o `_requer_login` (app.py:2300), que devolvem 401 JSON em `/api/*`.
> - Nenhuma rota do Pro (`app.py`, `/api/wms`, `/api/rfq`) confere Super Usuário, perfil ou permissão de módulo. O catálogo `portal_permissoes.py:60-66` tem os 5 módulos do Pro, mas nada o aplica.
> - Ações destrutivas têm só `confirm()` no navegador: excluir importação Ravex, zerar conferência, excluir NF de terceiros, excluir item da base, excluir recebimento ou inventário WMS.
> - `session['usuario']` é usado apenas como autor dos registros.
>
> **Leitura de código de barras no Pro:** só por leitor tipo teclado (ou digitação) e Enter. Não há leitura por câmera nem voz (`script.js` não usa `getUserMedia`/`BarcodeDetector`). Há correção para leitura duplicada colada (`normalizarCodigoBarrasDuplicado`, script.js:21205).

### 2.1 Pro — Estrutura comum do `/painel`

#### Pro › Barra superior, menu lateral e parâmetros de URL
- Abrir o módulo por `?modulo=`. O `&aba=` só funciona em `estoque-sp` e `enderecamento-wms`; Carregamento e Devoluções sempre abrem no Painel; Terceiros reabre a última sub-aba da sessão (`sessionStorage terceiros_subaba_v1`, 12 h) — (script.js:3222-3229, 3837-3843, 10533-10588)
- Menu lateral gerado a partir das abas de cada módulo, recolhível (`localStorage dl-modulo-sidebar-wide`), com rodapé "Trocar módulo" que leva a `/entrada` — (script.js:3098 `initModuloSidebars`; static/doca-livre-sidebar.js; static/doca-livre-pro.js)
- Link "← Módulos" para o Hub, relógio, nome do usuário e "Sair" (`/login?sair=1`) — (templates/index.html:29-77)
- Sino "NFs paradas no módulo Terceiros": contador e lista (até 30) das NFs em etapa não final; o clique leva à aba e à NF — GET `/api/terceiros/documentos?area=todas` (cache) — (templates/index.html:48-58; script.js:15620-15720)
- Botão "🔄 Atualizar aba" (só no Carregamento) — (script.js:3168-3171)
- Atualização em tempo real por SSE: a conexão fecha a cada ~20 s e reconecta em 4 s; cada evento recarrega os dados (debounce de 5 s) — GET `/api/eventos-stream` — (app.py:3945; script.js:1766-1805)
  - Disparado só por bipagem, zerar, remover, cancelar NF de devolução e zerar devolução (`_broadcast_atualizar`, app.py:245).
- Overlays de carregamento com botão Cancelar (`ter-acao-loading`, `ter-descarga-loading`, `relatorio-loading`, `ravex-loading`) — (templates/index.html:4091-4135)

### 2.2 Pro — Carregamento (Carga / Expedição) — `/painel?modulo=carregamento`

#### Pro › Carregamento › Painel (`data-tab="painel"`, aba padrão)
- Filtrar o painel por data/hora de início e fim e limpar os filtros — GET `/api/painel-completo?data_inicio&data_fim&hora_inicio&hora_fim` — `produtos_bipados`, `romaneio_por_item`, `viagem_periodo_bipagem` — (templates/index.html:104-123; script.js:20328, 20378; app.py:12437)
- Seção "Bipagem e cargas" — `/api/painel-completo` + GET `/api/estatisticas` (`produtos_bipados`) — (templates/index.html:126-175; script.js:19722; app.py:17480):
  - 6 cards: registros bipados, soma das quantidades, itens carregados, códigos únicos, viagens/roteiros, itens com divergência;
  - gráfico "Cargas bipadas por roteiro", tabela "Top itens bipados" e cards "Por veículo".
- Seção "Erros de carregamento" — `/api/painel-completo` + `divergencia_motivo` — (templates/index.html:177-238):
  - 5 cards: itens com erro, faltas, sobras, roteiros com erro, eficiência média;
  - gráficos de erros por roteiro, por tipo e bipagem × erros;
  - tabela de detalhe com motivo.
- Seção "Placas baixadas no período" — `viagem_placa`, `viagem_periodo_bipagem` — (templates/index.html:240-307):
  - 5 cards: total, concluídas, em andamento, não carregadas, peso;
  - tabela de placas;
  - 4 gráficos: status, baixadas × concluídas, tempo por placa, peso por placa.
- Seção "Romaneio por item" — `romaneio_por_item` — (templates/index.html:309-373):
  - 4 cards;
  - 4 gráficos: roteiros/veículos, quantidade por item, peso por carro, peso total;
  - tabelas "Quantidade por código" e "Peso por veículo".
- Seção "Detalhamento por viagem": tabela (roteiro, início, fim, duração, itens, faltas) e 7 gráficos (tempo, faltas, itens, top 15 itens, carros com mais itens/peso) — (templates/index.html:375-429)
- "Importar planilha do diretório": o servidor procura `CONTROLE DE CARREGAMENTO ULTRAPAO*.xlsx` — POST `/api/importar-planilha-local` — grava a aba BASE em `produtos_bipados` e o ROMANEIO na tabela legada `romaneio` — (templates/index.html:436; script.js:24739; app.py:11384)
- "Enviar planilha" (upload .xlsx/.xls) — POST `/api/importar-planilha` — mesmas tabelas legadas — (templates/index.html:439-441; script.js:24789; app.py:11356)

#### Pro › Carregamento › Importar Ravex (`data-tab="importar-ravex"`)
- Puxar todos os roteiros de um período (data início/fim) — `ravex_client.obter_roteiro_por_periodo` — grava `romaneio_por_item`, `id_roteiros`, `viagem_placa`, `viagem_motorista`, `ravex_importacoes` — (templates/index.html:929-940; script.js:18513, 19662; app.py:9149):
  - POST `/api/ravex/sincronizar-periodo` cria um job assíncrono (202);
  - o cliente acompanha com polling em GET `/api/ravex/importar-romaneio/status/<job_id>` a cada 1,2 s.
- Puxar por ID único (roteiro ou viagem) — Ravex: roteiro, viagem faturada, NFs/itens, canhotos, veículo — (templates/index.html:942-949; script.js:18668, 19697; app.py:8596, 8926):
  - primeiro checa duplicado em GET `/api/ravex/verificar-baixado`;
  - depois POST `/api/ravex/importar-romaneio` e polling.
- Puxar uma lista de IDs (um por linha ou separados por vírgula) — POST `/api/ravex/verificar-baixado-lote` e POST `/api/ravex/importar-lista` — (templates/index.html:951-959; script.js:18729-18790; app.py:8632, 9368)
- Checkbox "forçar reimportar" (`forcar_reimportar`, pula a checagem de duplicado) — (templates/index.html:922; script.js:19645)
- Overlay de progresso com Cancelar (AbortController) e modal "Concluído", que recarrega os Baixados — (templates/index.html:964-968, 4126; script.js:18518-18530, 19610-19640)

> Obs.: o cliente Ravex (`ravex_client.py:21-413`) autentica por POST `/usuario/autenticar`, guarda o token por 55 min e usa as credenciais `RAVEX_USER`/`RAVEX_PASSWORD`/`RAVEX_CREDENTIALS_FILE`.

#### Pro › Carregamento › Baixados (Ravex) (`data-tab="baixa-ravex"`)
- Listar o histórico de importações (data, tipo, status com DUPLICADO destacado, viagens, itens, usuário, erros) — GET `/api/ravex/importacoes?limit=150&usuarios=1` — `ravex_importacoes` (se vazia, cai no legado `romaneio_por_item`) — (script.js:10931; app.py:9423)
- Filtros Todos/Hoje/Ontem, intervalo de data/hora, filtro por usuário e "Limpar filtros" — (templates/index.html:978-1008; script.js:11158, 11036)
- "Atualizar lista" (ignora o cache) e pré-carga ao passar o mouse na aba — (templates/index.html:1010; script.js:10910, 10644)
- Excluir importação — DELETE `/api/ravex/importacoes/<id>` — (script.js:10997; app.py:9503, 7728-7831)
  - **Apaga em cascata** `romaneio_por_item`, `produtos_bipados`, `viagem_placa`, `viagem_motorista`, `viagem_responsaveis`, `divergencia_motivo`, `viagem_periodo_bipagem`, `id_roteiros` e `ravex_importacoes`.

#### Pro › Carregamento › Conferência (`data-tab="conferencia"`)
- Bloco 1 — buscar roteiro/viagem por ID (Enter ou lupa) e listar os itens do romaneio com o status de bipagem — GET `/api/conferencia/<id>` (parâmetros `fluxo`, `limit` 200-2000, `motivos`, `periodo_meta`, `verificar_baixado`) — `romaneio_por_item`, `produtos_bipados`, `id_roteiros`, `divergencia_motivo`, `viagem_periodo_bipagem`, `ravex_importacoes` — (templates/index.html:515-527; script.js:22232, 23001; app.py:6523-6610)
- Avisos de "roteiro não baixado do Ravex" e de romaneio vazio vinculado a outra viagem — (templates/index.html:713; app.py:6579-6600)
- Bloco 2 — editar a placa da viagem, com sugestões — PUT `/api/viagem/<id>/placa`; sugestões de GET `/api/placas` — `viagem_placa`, `placas` — (script.js:22196, 22064; app.py:5530, 5672)
- Bloco 2 — editar o motorista, com sugestões — PUT `/api/viagem/<id>/motorista`; sugestões de GET `/api/colaboradores-motoristas` — `viagem_motorista`, `colaboradores`, `motoristas` — (script.js:22179, 22051; app.py:5502, 5620)
- Mostrar data de expedição, rota, IDs e início/fim do carregamento — GET `/api/viagem/<id>/info` e `/api/viagem/<id>/periodo` — (script.js:22135, 22001; app.py:5401, 5037)
- Bloco 3 — doca obrigatória (1-4) para liberar a bipagem; "Fixar doca" neste aparelho (`localStorage controle_doca_fixa`) e selo "VOCÊ ESTÁ NA DOCA X" — (templates/index.html:565-575; script.js:18455-18510)
- Bloco 3 — responsáveis (coordenador, conferente, ajudantes 1 e 2), salvos ao sair do campo — PUT `/api/viagem/<id>/responsaveis` — `viagem_responsaveis` — (templates/index.html:579-591; script.js:22213; app.py:5558)
- Bloco 4 — bipar EAN/DUN ou código interno, com quantidade — GET `/api/buscar-produto/<cb>`, `/api/buscar-produto-por-codigo-interno/<cod>`, `/api/conferencia/<id>/produto-na-lista` — `base_codigo_barras`, `romaneio_por_item` — (templates/index.html:611-660; script.js:19114, 19285, 19020; app.py:11212, 11229, 5996)
  - **No carregamento, a bipagem fica em rascunho local** (sessionStorage) até gerar o comprovante.
- Classificar o item bipado (normal, avariado, descarte/perdas, palete bloqueado) — `produtos_bipados.disposicao_estoque`, que alimenta o Estoque SP — (templates/index.html:631-636; script.js:31-40)
- Campos Veículo e Status (PENDENTE/CARREGADO); botões "Limpar campos" e "Zerar" — (templates/index.html:645-657; script.js:22496)
- Aviso "Produto não está na relação desta viagem" e modal "Produto não cadastrado" → "Cadastro do item": vincula o código bipado a um item do romaneio e, se quiser, atualiza a base (descrição, código interno, EAN, DUN, unidade, peso) — POST `/api/base-item/vincular-codigo` — `base_codigo_barras`, `excel_datasets` — (templates/index.html:3803-3868; script.js:21371, 21795-21906; app.py:4205)
- Editar o código de barras direto na coluna "Cód. barras" (✏️) — POST `/api/base-item/vincular-codigo` — (script.js:338-420)
- Ações por linha: "Bipar" (completa o que falta), "Tirar 1", "Tirar tudo", "Excluir". No rascunho é tudo local; fora dele chama a API — POST `/api/conferencia/remover` — `produtos_bipados` — (script.js:2860-2920, 22701-22760; app.py:4696)
- Motivo de divergência por item (múltipla escolha + observação) — PUT `/api/divergencias/motivo` — `divergencia_motivo` — (script.js:465-560, 24677)
- Totais Total/Bipado/status e "Maximizar lista" (tela cheia) — (templates/index.html:662-686; script.js:21522)
- Zerar todos os itens (modal com aceite obrigatório) — POST `/api/conferencia/<id>/zerar` — apaga `produtos_bipados` (fluxo carregamento) e o período — (templates/index.html:3883-3897; script.js:22578; app.py:4656)
- Ao voltar para a aba, modal com 3 opções: continuar bipando, bipar outra viagem, ou zerar e recomeçar — (templates/index.html:3724-3748; script.js:1076, 1113)
- Gerar comprovante completo ou divergente (com confirmação). Grava e abre o Extrato — POST `/api/conferencia/<id>/gravar-bipagem` (doca, veículo, status, itens, início/fim) — `produtos_bipados`, `viagem_periodo_bipagem` — (templates/index.html:719-735, 3698-3722; script.js:1550-1600, 23389-23450; app.py:4889)

#### Pro › Carregamento › Extrato (`data-tab="extrato"`)
- Buscar o extrato (comprovante) pelo ID do roteiro — GET `/api/conferencia/<id>?limit=2000` — (templates/index.html:744-748; script.js:23482, 24181)
- Resumo da carga em 5 grupos (identificação, veículo, totais, período, responsáveis), lista de itens a mais e faltantes, e aviso de completo/divergente — (templates/index.html:757-835)
- Imprimir o extrato com linhas de assinatura (`window.print`, classe `print-extrato`) — (templates/index.html:749, 836-860; script.js:23492)
- Excluir o extrato da viagem (apaga os bipados) — POST `/api/conferencia/<id>/zerar` — (templates/index.html:750; script.js:23456)

#### Pro › Carregamento › Romaneio por item (`data-tab="romaneio"`)
- Ver todas as colunas do romaneio, com filtros por viagem, roteiro, cliente, produto, endereço e cidade; botões "Filtrar" e "Limpar" — GET `/api/romaneio` — `romaneio_por_item` — (templates/index.html:875-900; script.js:24342, 24398; app.py:9566)

#### Pro › Carregamento › Relatórios (`data-tab="relatorios"`)
- Filtro opcional por data de expedição (`data_expedicao_inicio/fim`), aplicado a todos os botões — (templates/index.html:1041-1048; script.js:23521)
- Exportar o extrato do roteiro em Excel — GET `/api/relatorios/excel/extrato?id_viagem=` — (script.js:23633; app.py:10932)
- Excel "Tudo que foi bipado" — GET `/api/relatorios/excel/bipados` — `produtos_bipados`, `base_codigo_barras`, `viagem_responsaveis` — (script.js:23648; app.py:10265)
- Excel "Resumo por roteiro" — GET `/api/relatorios/excel/resumo_roteiro` — (script.js:23652; app.py:10770)
- Excel "Tempo de carregamento por placa" — GET `/api/relatorios/excel/tempo_placa` — (script.js:23656; app.py:10782)
- Excel "Itens bipados por roteiro" — GET `/api/relatorios/excel/itens_por_roteiro` — (script.js:23660; app.py:10793)
- Excel "Itens mais bipados" — GET `/api/relatorios/excel/itens_mais_bipados` — (script.js:23664; app.py:10804)
- Excel "Resumo por produto" — GET `/api/relatorios/excel/resumo_produto` — (script.js:23668; app.py:10815)
- Excel "Roteiros com divergência" — GET `/api/relatorios/excel/roteiros_divergencia` — (script.js:23672; app.py:10827)
- Excel de divergências: itens, dados dos roteiros ou página completa — GET `/api/divergencias/excel?tipo=itens|roteiros|completo` — (templates/index.html:1111-1119; script.js:23508; app.py:10118)
- Excel "Carregamento por veículo" — GET `/api/relatorios/excel/carregamento_veiculo` — (script.js:23676; app.py:10839)
- Excel "Peso por viagem e placa" — GET `/api/relatorios/excel/peso_viagem_placa` — (script.js:23680; app.py:10850)
- Excel "Responsáveis por viagem" — GET `/api/relatorios/excel/responsaveis_viagem` — (script.js:23684; app.py:10861)
- Excel "Romaneio CD Guarulhos" (resumo, quantidade por item, peso por carro) — GET `/api/relatorios/excel/romaneio_guarulhos` — (script.js:23688; app.py:10923)

#### Pro › Carregamento › Divergências (`data-tab="divergencias"`)
- Listar as faltas e sobras dos 50 roteiros mais recentes, com botão "Atualizar" — GET `/api/divergencias?limit_viagens=50` — `produtos_bipados`, `romaneio_por_item`, `divergencia_motivo`, `viagem_*` — (script.js:24445; app.py:10013)
- Registrar motivo por item ("Avaria durante o carregamento", "Produtos inseridos a mais que o pedido" + observação) — PUT `/api/divergencias/motivo` — (script.js:465, 24677; app.py:10042)
- Imprimir as divergências (`window.print`, classe `print-divergencias`) — (templates/index.html:1170; script.js:23879)
- Exportar Excel: itens, roteiros ou página completa — GET `/api/divergencias/excel?tipo=` — (templates/index.html:1172-1174)

#### Pro › Carregamento › Base de Produtos (`data-tab="base"`)
- Listar a base (Código, Descrição, EAN-13, DUN-14, Unidade, Peso Bruto) do dataset ativo — GET `/api/base-planilha` — `base_codigo_barras`, `excel_datasets` — (script.js:21007; app.py:4104)
- Filtrar por código de barras, código interno, descrição, EAN, DUN e unidade — (templates/index.html:456-468; script.js:21085)
- "Adicionar produto" (modal com campos dinâmicos) — POST `/api/base-item` — `base_codigo_barras` — (templates/index.html:469-484; script.js:21153; app.py:4359)
- Editar registro — PUT `/api/base-item/<id>` — (script.js:21153; app.py:4402)
- Excluir registro (com confirmação) — DELETE `/api/base-item/<id>` — (templates/index.html:486-496; script.js:21140; app.py:4438)

### 2.3 Pro — Devoluções (Retorno) — `/painel?modulo=devolucoes`

#### Pro › Devoluções › Painel (`data-dev-tab="painel"`)
- Filtrar por data/hora e "Limpar" — GET `/api/devolucoes/painel` — `produtos_bipados` (fluxo=devolucao) — (templates/index.html:1204-1220; script.js:11256; app.py:13903)
- 6 cards: registros, soma, itens únicos, viagens com retorno, docas usadas, usuários bipando — (templates/index.html:1222-1250)
- 4 gráficos: itens mais devolvidos, veículos com mais devoluções, por doca, por usuário — (templates/index.html:1252-1270)
- Tabelas de viagens, itens, veículos, resumo por doca e usuários — (templates/index.html:1272-1360)

#### Pro › Devoluções › Conferência (`data-dev-tab="conferencia"`)
- Buscar roteiro/viagem; placa e motorista só para leitura — GET `/api/viagem/<id>/info` — (templates/index.html:1370-1395; script.js:18866)
- Escolher a NF com divergência no carregamento — GET `/api/devolucoes/notas-divergentes` — **consulta a API Ravex ao vivo** (NFs e itens da viagem) e cruza com `produtos_bipados` — (script.js:3355; app.py:13239)
- Pré-visualizar os itens divergentes da NF — GET `/api/devolucoes/itens-nf` — (script.js:3402; app.py:13205)
- Escolher motivo (parcial, total, reentrega) e doca (1-4) e clicar "▶ Iniciar NF" — POST `/api/devolucoes/notas` — `devolucao_nota_fiscal` — (templates/index.html:1400-1440; script.js:3557; app.py:13308)
- "✅ NF concluída" — POST `/api/devolucoes/notas/<id>/concluir` — (script.js:3576; app.py:13369)
- "⏹ Parar/cancelar NF" (apaga as bipagens da NF) — POST `/api/devolucoes/notas/<id>/cancelar` — `devolucao_nota_fiscal`, `produtos_bipados` — (script.js:3490; app.py:13402)
- Tabela das NFs da viagem com "Continuar" e "Cancelar" — GET `/api/devolucoes/notas?id_viagem=` — (templates/index.html:1475; script.js:3600-3640; app.py:13255)
- Conferência só da NF ativa — GET `/api/devolucoes/conferencia/<id>?devolucao_nf_id=` — (script.js:3691; app.py:13512)
- Bipar o retorno com classificação (normal, reentrega, avariado, descarte, palete bloqueado). **Grava na hora**, sem rascunho — POST `/api/produtos` (`fluxo=devolucao`, `devolucao_nf_id`) — `produtos_bipados` — (templates/index.html:1500-1560; script.js:21273-21330; app.py:4478)
- Tirar 1, tirar tudo, excluir item — POST `/api/conferencia/remover` (`fluxo=devolucao`) — (script.js:22745)
- Zerar a conferência da rota (cancela as NFs em andamento) — POST `/api/devolucoes/conferencia/<id>/zerar` — (templates/index.html:1441, 1566; script.js:22571; app.py:13453)
- Maximizar a lista — (script.js:21522)

#### Pro › Devoluções › Extrato (`data-dev-tab="extrato"`)
- Buscar o extrato de devoluções pelo ID — GET `/api/conferencia/<id>?fluxo=devolucao&limit=2000` — (script.js:24282)
- Imprimir o extrato de devoluções (`window.print`) — (script.js:23866)

#### Pro › Devoluções › Baixados (Ravex) (`data-dev-tab="baixa-ravex"`)
- Mesma lista, filtros e botão Excluir do Carregamento › Baixados — GET `/api/ravex/importacoes` (sem filtro de fluxo) e DELETE `/api/ravex/importacoes/<id>` — (templates/index.html:1662-1722; script.js:10931)
  - **O Excluir aqui também apaga a bipagem do carregamento.**

#### Pro › Devoluções › Relatórios (`data-dev-tab="relatorios"`)
Todos os botões enviam `fluxo=devolucao` e aceitam data de expedição opcional (templates/index.html:1724-1781; script.js:23537-23551).
- Excel do extrato de devolução — GET `/api/relatorios/excel/extrato?id_viagem&fluxo=devolucao` — (script.js:23693)
- Excel "Tudo que foi bipado no retorno" — GET `/api/relatorios/excel/bipados?fluxo=devolucao` — (script.js:23708)
- Excel "Resumo por roteiro" — GET `/api/relatorios/excel/resumo_roteiro?fluxo=devolucao` — (script.js:23712)
- Excel "Resumo por produto" — GET `/api/relatorios/excel/resumo_produto?fluxo=devolucao` — (script.js:23716)
- Excel "Itens divergentes" e "Dados dos roteiros com divergência" — GET `/api/divergencias/excel?tipo=itens|roteiros&fluxo=devolucao` — (script.js:23724)
- Excel "Roteiros com divergência" — GET `/api/relatorios/excel/roteiros_divergencia?fluxo=devolucao` — (script.js:23720)

#### Pro › Devoluções › Divergências (`data-dev-tab="divergencias"`)
- Listar as divergências do retorno — GET `/api/divergencias?fluxo=devolucao&limit_viagens=50` — (script.js:24598)
- Motivo por item — PUT `/api/divergencias/motivo` — (script.js:24677)
- Excel de itens, roteiros ou página completa — GET `/api/divergencias/excel?tipo=&fluxo=devolucao` — (templates/index.html:1786-1788)

### 2.4 Pro — Terceiros (Descarga / Recebimento) — `/painel?modulo=terceiros`

#### Pro › Terceiros › Painel (`data-ter-tab="painel"`)
- Filtrar por data/hora e "Limpar". Sem filtro, o painel é montado do cache local — GET `/api/terceiros/painel` — `terceiros_documentos`, `terceiros_documento_itens` — (templates/index.html:1824-1836; script.js:11916; app.py:16529)
- 14 cards: total, pendência, recebidos, concluídos, pendentes de lançamento, lançadas, pendências MG, qtd XML × qtd recebida no WMS, carreta, conferência OK/divergente, aguardando MG — (templates/index.html:1840-1856)
- 8 gráficos: NFs por etapa, XML × WMS, top remetentes, placas, UF, conferência no WMS, motoristas, início do recebimento da carreta — (templates/index.html:1858-1866)
- Tabelas de últimas NFs, itens mais bipados, remetentes, motoristas e placas — (templates/index.html:1868-1908)

#### Pro › Terceiros › 1° Enviar XML (`data-ter-tab="enviar-xml"`)
- Subir XMLs de NF-e de terceiros (vários arquivos). Previsão de chegada e nº do pedido são obrigatórios (o pedido também é extraído do XML). "Consumível SP" exige o recebedor — POST `/api/terceiros/upload-xml` (`area=recebimento`) — `terceiros_documentos`, `terceiros_documento_itens`, `terceiros_documento_eventos`, com os itens casados em `base_codigo_barras` — (templates/index.html:1920-1958; script.js:12958, 13083; app.py:16362)
- Subir XML de carreta: previsão, motorista e placa obrigatórios — POST `/api/terceiros/upload-xml` (`area=carreta`, `motorista_carreta`, `placa_carreta`) — (templates/index.html:1962-1986; script.js:13087)
- Modal de sucesso do upload — (templates/index.html:4057; script.js:13065)

#### Pro › Terceiros › 2° Pendência de Recebimento (`data-ter-tab="pendencia-recebimento"`)
- Listar as NFs com recebimento em aberto (NF, pedido, remetente, destinatário, UF, motorista/placa, previsão, status) — GET `/api/terceiros/documentos?area=todas[&leve=1]` — (script.js:13203, 15485; app.py:16896)
- Filtrar por previsão (todos, hoje, atrasado, amanhã, depois de amanhã, semana que vem, data livre) — (templates/index.html:2003-2012; script.js:14358)
- "Ver detalhe" abre a descarga por NF: dados, resumo e itens com status no WMS (XML × WMS, "Cadastro local/Sem cadastro") — GET `/api/terceiros/documentos/<id>?sem_eventos=1` — (script.js:15318-15390, 17406; app.py:16932)
- "Receber no WMS" / "📍 Abrir no Endereçamento WMS": abre o WMS › Recebimento com a NF preenchida — (script.js:14701-14727)
- "🔄 Atualizar status" (WMS) — (script.js:14775)
- Motivo por item, salvo ao sair do campo — POST `/api/terceiros/documentos/<id>/item-motivo` — `terceiros_documento_itens` — (script.js:17555; app.py:17184)
- Comprovante de descarga (completo ou divergente) para imprimir — (templates/index.html:2151-2160, 3790-3800; script.js:16883, 17044)
- "Ver PDF da NF" (DANFE) pela API Meu Danfe (`MEU_DANFE_API_KEY`); sem chave, gera HTML imprimível — GET `/api/terceiros/documentos/<id>/danfe` — (script.js:14539; app.py:17022)
- "Baixar XML" original — GET `/api/terceiros/documentos/<id>/xml` — (script.js:14616; app.py:17082)
- Excluir NF (apaga o documento, os itens e os eventos) — DELETE `/api/terceiros/documentos/<id>` — (script.js:12850; app.py:17121)

> Obs.: o botão "Recebimento concluído" fica sempre desabilitado ("Aguardando WMS"). A conclusão é automática quando o WMS finaliza o recebimento (wms_enderecamento.py:2047-2075; script.js:16493-16506).

#### Pro › Terceiros › 3° Fornecedores Recebidos (`data-ter-tab="fornecedores-recebidos"`)
- Listar as NFs com recebimento concluído (as já lançadas aparecem como "arquivo"). Ações: detalhe, PDF, XML, comprovante, excluir — mesmas rotas da aba 2 — (script.js:15006, 15529)

#### Pro › Terceiros › 4° NFs Pendentes de Lançamento (`data-ter-tab="pendentes-lancamento"`)
- Listas agrupadas por UF (MG, SP e demais), com contadores — (templates/index.html:2225-2300; script.js:15725)
- Marcar "Lançada" Sim/Não por NF — POST `/api/terceiros/documentos/<id>/status` (`campo=nota_lancada`) — `terceiros_documentos`, `terceiros_documento_eventos` — (script.js:2381-2412, 12292; app.py:17234-17345)
  - "Não" exige motivo (`motivo_nao_lancada`).
  - "Sim" sem recebimento pede confirmação "lançar sem recebimento" (HTTP 409).
  - NF de MG só pode ser lançada com "Recebida MG" = Sim.
- Ações: detalhe, PDF, XML, comprovante, excluir — (script.js:2368)

#### Pro › Terceiros › 5° Notas Fiscais Lançadas (`data-ter-tab="notas-lancadas"`)
- Marcar "Enviado MG": "Sim — ir para pendência MG" ou "Não" (com motivo) — POST `.../status` (`campo=enviar_para_mg`) — (script.js:15785, 2655)
- Carreta: "Registrar no histórico" (sem MG) — (script.js:13707, 12631)
- Consumível SP: "Enviar para histórico" (exige Lançada = Sim) — POST `.../status` (`campo=consumivel_sp_historico`) — (script.js:13699; app.py:17262-17266)

#### Pro › Terceiros › 6° Pendências Envio MG (`data-ter-tab="pendencias-mg"`)
- Editar na linha o motorista e a placa de saída para MG — POST `/api/terceiros/documentos/<id>/motorista` (`tipo:'saida_mg'`) — (script.js:13641, 16017; app.py:17420)
- Marcar "Enviar para MG" Sim/Não (motorista obrigatório em certas rotas) — POST `.../status` (`campo=enviar_para_mg`) — (script.js:16035; app.py:17305-17311)

#### Pro › Terceiros › 7° Notas Enviadas para MG (`data-ter-tab="notas-enviadas-mg"`)
- Lista só de leitura das NFs finalizadas em MG, com detalhe, PDF, XML, comprovante e excluir — GET `/api/terceiros/documentos` — (script.js:15865-15895)

#### Pro › Terceiros › 8° Recebimentos de MG (`data-ter-tab="recebimentos-mg"`)
- Marcar "Recebida MG" Sim/Não. "Sim" pede quem recebeu em MG (obrigatório, exceto carreta); "Não" exige motivo — POST `.../status` (`campo=carga_recebida_mg`) — `recebedor_mg`, `motivo_nao_recebida_mg` — (script.js:15901, 12275; app.py:17312-17318)

#### Pro › Terceiros › Relatórios (`data-ter-tab="relatorios"`)
Filtro opcional por data de cadastro da NF (`data_criacao_inicio/fim`) (templates/index.html:2476-2482; script.js:23736). Todos são GET `/api/terceiros/relatorios/excel/<nome>` (script.js:23736-23862).
- Excel da NF e itens (por ID do documento) — `.../nf?documento_id=` — (app.py:16351)
- Excel "Notas fiscais lançadas" — `.../notas_lancadas` — (app.py:16255)
- Excel "Histórico — NFs finalizadas" — `.../historico` — (app.py:16261)
- Excel "Consumível SP" — `.../consumivel_sp` — (app.py:16267)
- Excel "Fluxo MG completo" — `.../fluxo_mg` — (app.py:16285)
- Excel "Encerradas com Não + motivo" — `.../encerradas_motivo` — (app.py:16279)
- Excel "Recebimentos concluídos" — `.../recebimentos_periodo` — (app.py:16309)
- Excel "Pendências por etapa" — `.../pendencias_etapa` — (app.py:16273)
- Excel "Resumo por UF destino" — `.../por_uf` — (app.py:16291)
- Excel "Resumo por remetente" — `.../por_remetente` — (app.py:16297)
- Excel "Previsão vs. chegada" — `.../previsao_chegada` — (app.py:16303)
- Excel "SLA entre etapas" — `.../sla_etapas` — (app.py:16345)
- Excel "Resumo por NF" — `.../resumo_nf` — (app.py:16225)
- Excel "Tudo que foi bipado" — `.../itens_bipados` — (app.py:16231)
- Excel "Itens mais bipados" — `.../itens_mais_bipados` — (app.py:16237)
- Excel "NFs com divergência" — `.../divergencias` — (app.py:16243)
- Excel "Divergência por item" — `.../divergencia_itens` — (app.py:16315)
- Excel "NFs sem bipagem iniciada" — `.../sem_bipagem` — (app.py:16321)
- Excel "Conferência incompleta" — `.../conferencia_incompleta` — (app.py:16327)
- Excel "Carreta — quem trouxe e chegada" — `.../carreta` — (app.py:16249)
- Excel "Linha do tempo — eventos por NF" — `.../eventos` — `terceiros_documento_eventos` — (app.py:16333)
- Excel "Auditoria por usuário" — `.../auditoria_usuario` — `terceiros_documento_eventos` — (app.py:16339)

#### Pro › Terceiros › Histórico (`data-ter-tab="historico"`)
- Visão geral das NFs encerradas (carreta, consumível SP, fluxo MG completo), com os motivos de "Não" — (script.js:16040)
- Filtros por previsão e por UF (Todos/MG/SP) — (templates/index.html:2620-2632; script.js:14326)
- Ações: detalhe, PDF, XML, comprovante, excluir — (script.js:16040-16080)

> Obs.: o e-mail "consumível SP" (Resend/SMTP, `app.py:14982, 17362-17372`) só dispara em POST `.../status` com `campo=recebimento_concluido`. Como esse botão está desabilitado e o WMS conclui gravando direto no banco, **o e-mail não dispara mais**.

### 2.5 Pro — Estoque SP (Estoque Geral) — `/painel?modulo=estoque-sp[&aba=]`

> Aqui o `&aba=` funciona: `estoque-atual | saida | entrada-devolucao | entrada-terceiros | reentregas | avaria | descarte-perdas | palete-bloqueado`. Tudo é só leitura: não há ajuste, transferência nem exportação.

#### Pro › Estoque SP › Estoque atual (`&aba=estoque-atual`)
- Filtros comuns a todas as abas: data/hora de início e fim, código do produto, código de barras, descrição; "Filtrar" e "Limpar" — (templates/index.html:2680-2712; script.js:3733, 3829)
- Saldo por produto = entrada de devoluções + entrada de terceiros (sem MG e sem consumível) − saída da expedição (só itens normais). Mostra 4 cards — GET `/api/estoque-sp/tempo-real` — `produtos_bipados` (fluxo + `disposicao_estoque`), `terceiros_documento_itens`, `terceiros_documentos` — (script.js:3853; app.py:13826, 13688-13750)
- Atualização automática a cada 30 s com a aba ativa — (script.js:3719-3730)

#### Pro › Estoque SP › Histórico de saída (`&aba=saida`)
- Saída da expedição bipada, por produto (linhas, quantidade, registros) — GET `/api/estoque-sp/resumo` (seção `saida`) — `produtos_bipados` — (templates/index.html:2751; app.py:13853)

#### Pro › Estoque SP › Entrada (devoluções) (`&aba=entrada-devolucao`)
- Entrada de devoluções por produto — GET `/api/estoque-sp/resumo` (seção `devolucao`) — (templates/index.html:2763)

#### Pro › Estoque SP › Entrada terceiros (`&aba=entrada-terceiros`)
- Entrada de terceiros por produto (quantidade bipada, NFs) — GET `/api/estoque-sp/resumo` (seção `terceiros`) — `terceiros_documento_itens` — (templates/index.html:2775)

#### Pro › Estoque SP › Reentregas (`&aba=reentregas`)
- Entrada, saída, total e registros por produto. Também usa `devolucao_nota_fiscal.motivo='reentrega'` — GET `/api/estoque-sp/resumo` — (templates/index.html:2787-2838; app.py:13753)

#### Pro › Estoque SP › Avaria (`&aba=avaria`)
- Entrada, saída e total de itens avariados por produto. **O WMS também lança aqui** (paletes classificados no recebimento, wms_enderecamento.py:1083) — GET `/api/estoque-sp/resumo` — `produtos_bipados.disposicao_estoque` — (templates/index.html:2787-2838)

#### Pro › Estoque SP › Descarte / Perdas (`&aba=descarte-perdas`)
- Entrada, saída e total de descarte/perdas por produto — GET `/api/estoque-sp/resumo` — (templates/index.html:2787-2838)

#### Pro › Estoque SP › Palete bloqueado (`&aba=palete-bloqueado`)
- Entrada, saída e total de paletes bloqueados por produto — GET `/api/estoque-sp/resumo` — (templates/index.html:2787-2838)

### 2.6 Pro — Endereçamento WMS 2D/3D — `/painel?modulo=enderecamento-wms&aba=<id>`

> **Arquivos:**
> - Telas: `templates/index.html:2842-3693`.
> - JS: `static/script.js` (trechos 3129-3232, 3977-10531), `static/wms-analise.js`, `static/wms-rfq.js`, `static/wms-hub.js`, `static/wms-mapa-3d.js` (Three.js r128 por CDN).
> - Backend: `wms_enderecamento.py` (blueprint `/api/wms`) e `rfq_platform.py` (blueprint `/api/rfq`).
>
> **Quem pode usar:** basta estar logado. As rotas `/api/rfq/*` devolvem 403 quando a flag de ambiente `RFQ_FLAG_*` correspondente está desligada (rfq_platform.py:80).
>
> **Dados:**
> - tabelas `wms_*` do núcleo, mais `terceiros_*` (leitura e escrita), `romaneio_por_item` (leitura) e `produtos_bipados` (escrita);
> - layout em `data/wms_layout_camaras.json` e `data/wms_areas_especiais.json`;
> - **não lê** `ultrafrio_*`, `contagens_*` nem "Todos os Produtos".

#### Pro › WMS › Comum a todas as sub-abas
- Escolher a sub-aba pela URL (`&aba=<id>`; `areas-especiais` vira `enderecamento`; id inválido abre o Painel) — (script.js:3222-3226, 7012-7017)
  - **`mapa-3d` e `hub` não estão na lista `abasWms`** (script.js:7013), então `?aba=mapa-3d` e `?aba=hub` caem no Painel.
- Trocar de sub-aba pelos botões, mostrados como menu lateral. A URL não muda — (script.js:3129-3135, 4796, 7022)
- Overlay global "Carregando" com barra de progresso e limite de 20 s — (templates/index.html:4235; script.js:4031-4131)
- Cache das abas em `sessionStorage wms_ui_*` (painel, localizações, produtos, opções e resumo de etiquetas, layout, ocupação) — (script.js:4005-4020)

#### Pro › WMS › Painel (`&aba=painel`)
- KPIs Mov. pendentes, Receb. abertos, Inventários ativos e Paletes fora — GET `/api/wms/painel` (primeiro `?leve=1`, depois completo; `?force=1`; cache de 90 s no servidor e 120 s no cliente) — `wms_movimentacao`, `wms_recebimento`, `wms_inventario` — (script.js:7352; wms_enderecamento.py:6740)
  - "Paletes fora" vem sempre 0: só é calculado com `completo=1`, que o JS nunca envia (wms_enderecamento.py:6854).
- Barras de ocupação por câmara (ocupadas, vazias, %) — GET `/api/wms/painel` — `wms_localizacao`, `wms_camara` — (script.js:7243; wms_enderecamento.py:2973)
- Distribuição por categoria A/B/C/D × câmara, posições médias e status de planejamento (Vermelho/Amarelo/Verde/Excedido) — `wms_produto_enderecamento`, `wms_localizacao` — (script.js:7254-7274)
- Recalcular a distribuição regerando o layout de endereços (com confirmação) — POST `/api/wms/layout/gerar {force:true}` — `wms_localizacao`, `wms_camara`, `data/wms_layout_camaras.json` — (script.js:7337; wms_enderecamento.py:6895, 2854)
- Consultar o zoneamento categoria → câmara/prioridade (só leitura) — via `/api/wms/painel` — `wms_zoneamento` — (script.js:7275)
- Editar o sentido do corredor (serpentina asc/desc por câmara/rua) e salvar — POST `/api/wms/sequencia-rota` — `wms_sequencia_rota` — (script.js:7286-7335; wms_enderecamento.py:9042)

#### Pro › WMS › Etq. Longarina (`&aba=etiquetas-longarina`)
- Ver o resumo para etiquetar: níveis configurados, nível máximo no banco, total de etiquetas, colunas, por câmara — GET `/api/wms/etiqueta/enderecos/resumo` — `wms_localizacao` — (script.js:7868; wms_enderecamento.py:10415)
- "Atualizar resumo", que sincroniza o layout para N níveis e grava em `wms_localizacao` — GET `/api/wms/etiqueta/enderecos/resumo?sync=1` — (script.js:7055, 7890; wms_enderecamento.py:9246)
- Imprimir TODAS as longarinas em HTML 102×73 mm com CODE128 (com confirmação) — GET `/api/wms/etiqueta/enderecos?todas=1` — template `templates/wms/etiquetas_endereco.html` — (script.js:7942; wms_enderecamento.py:10445, 9842)
- Ver o modelo (demo) de etiqueta de longarina — GET `/api/wms/etiqueta/modelo?tipo=endereco` — (script.js:7961; wms_enderecamento.py:10060)
- Abrir o teste de driver Zebra — GET `/api/wms/etiqueta/teste-driver` — template `etiqueta_teste_driver.html` — (script.js:7965; wms_enderecamento.py:10050)
- Selects encadeados Câmara → Rua → Prédio (coluna) — GET `/api/wms/etiqueta/enderecos/opcoes` — (script.js:7684, 7836; wms_enderecamento.py:10405)
- Imprimir uma coluna (5 níveis) — GET `/api/wms/etiqueta/enderecos?camara&rua&posicao` — (script.js:7544)
- Imprimir uma câmara inteira (com confirmação) — GET `/api/wms/etiqueta/enderecos?camara=` — (script.js:7861)
- Imprimir 1 etiqueta avulsa pelo código de bipagem (`12.14.1*47`) ou pelo código WMS (`12-C-14-1`), aceitando Enter — GET `/api/wms/etiqueta/endereco?codigo=` (interpretação em `wms_endereco.py`) — (script.js:7955; wms_enderecamento.py:10356)
- Abrir a etiqueta numa aba nova e imprimir (`@page` em polegadas + `window.print`, com nova tentativa em 502-504) — (script.js:7478; static/wms/imprimir-etiqueta.js)

#### Pro › WMS › Localizações (`&aba=localizacoes`)
- Listar endereços filtrando por câmara (11/12/13/21/98/99), categoria A-D e status vazia/ocupada. Mostra endereço WMS, código de bipagem da longarina com DV, PICKING/PULMÃO e categoria. Limite fixo de 150, sem paginação — GET `/api/wms/localizacoes?limite=150` — `wms_localizacao` (com fallback no layout JSON) — (script.js:7435; wms_enderecamento.py:6971)
- Botão "Longarina" por linha, que imprime a etiqueta do endereço — GET `/api/wms/etiqueta/endereco?codigo=` — (script.js:7431)

#### Pro › WMS › Mapa 3D (só pelo botão)
- Ver o layout em 3D com a ocupação de cada posição — GET `/api/wms/mapa-3d` (também roda schema e seed) — `wms_localizacao` + layout JSON — (script.js:5038; wms_enderecamento.py:7136)
- Filtrar por câmara (11 A/B, 12 C/D, 13 E/F, 21 G/H ou todas) — (script.js:7039)
- Botões Atualizar, Visão geral e Wireframe — (script.js:7029-7038)
- Tooltip ao passar o mouse; clique mostra o detalhe da posição e anima seta e rota até ela; duplo clique entra na câmara — (static/wms-mapa-3d.js:2209-2260, 2869)

#### Pro › WMS › Produtos (`&aba=produtos`)
- Consultar o estoque real por endereço (câmara/rua/coluna/nível, SKU, descrição, caixas, fabricação, validade, UP, lote), com total de linhas e caixas. Filtros por categoria A-D e busca por SKU, descrição, lote, UP ou endereço. Mostra só paletes armazenados e não bloqueados — GET `/api/wms/produtos?categoria&q` — `wms_palete_item`, `wms_palete`, `wms_localizacao`, `wms_produto_enderecamento` — (script.js:7973; wms_enderecamento.py:7293, 7197)

> Obs.: não há cadastro ou edição de produto no WMS. `wms_produto_enderecamento` (categoria, posições médias, shelf_dias) só é carregada por `scripts/importar_wms_enderecamento.py`.

#### Pro › WMS › Movimentações (`&aba=movimentacoes`)
- Transferir palete: etiqueta de 22 caracteres ou endereço atual → novo endereço, com observação — POST `/api/wms/movimentacoes {acao:'transferir'}` — `wms_palete`, `wms_localizacao`, `wms_movimentacao` — (script.js:8101; wms_enderecamento.py:7543, 5575)
- Listar o putaway pendente — GET `/api/wms/movimentacoes?status=pendente` — (script.js:8042; wms_enderecamento.py:7515)
- Concluir uma movimentação pendente (libera a origem, ocupa o destino, marca o palete como armazenado) — POST `{acao:'concluir', id}` — (script.js:8154; wms_enderecamento.py:7559)
- Histórico das últimas 80 movimentações (putaway, transferência, separação → stage) — GET `?historico=1&limite=80` — (script.js:8043; wms_enderecamento.py:7510)

#### Pro › WMS › Recebimento (`&aba=recebimento`)
- Buscar a NF da descarga (lupa ou Enter); preenche fornecedor, placa, situação e itens — GET `/api/wms/recebimentos/buscar-nf?numero_nf=` — `terceiros_documentos`, `terceiros_documento_itens`, `wms_recebimento` — (script.js:8887; wms_enderecamento.py:7731)
- Modal "NF não encontrada": "Subir XML" leva a Terceiros › Enviar XML; "Pesquisar outra NF" — (templates/index.html:3774; script.js:8775)
- Banner do modo de conferência; no modo cego esconde a coluna Qtd NF — GET `/api/rfq/depositos` + `/api/rfq/conferencia/modo` — `rfq_param_perfil` — (static/wms-rfq.js:175)
- Tabela de itens da NF: SKU, qtd NF, qtd bipada, falta, status, EAN, andamento, destinos — (script.js:8326)
- "Montar paletes": cria ou reutiliza o recebimento WMS e reabre uma descarga concluída quando permitido — POST `/api/wms/recebimentos/iniciar-bipagem` e POST `/api/wms/recebimentos {acao:'reabrir_descarga'}` — `wms_recebimento`, `terceiros_*` — (script.js:8686, 8434; wms_enderecamento.py:7785, 8319)
- Passo 1 — bipar EAN/SKU (resolve a linha da NF e sugere a qtd pendente) e informar UP, lote, produção, validade e caixas, com a classificação de entrada (bom, avaria, descarte/perdas, palete bloqueado) — POST `{acao:'bip_palete'}` (gera a etiqueta de 22 caracteres) e `{acao:'bip_produto'}` — `wms_palete`, `wms_recebimento_palete`, `wms_palete_item`, `wms_palete_controle` — (script.js:9669, 9309; wms_enderecamento.py:7962, 8020)
- Vincular uma etiqueta de palete já existente (22 caracteres) — POST `{acao:'bip_palete', etiqueta}` — (script.js:9644)
- Imprimir a etiqueta única do palete (produto + código 22 + endereço de guarda com código de barras) — GET `/api/wms/etiqueta?etiqueta&destino&...` — template `etiqueta_palete.html` — (script.js:9785; wms_enderecamento.py:9947)
- Ver o modelo da etiqueta de palete — GET `/api/wms/etiqueta/modelo?tipo=palete` — (script.js:7969)
- "Etiqueta colada — ir guardar" (avança o stepper de 2 passos) — (script.js:9346, 9426)
- Putaway sugerido ("Atualizar indicação"), que cria uma movimentação pendente — POST `{acao:'sugerir_destino'}` — `wms_produto_enderecamento`, `wms_zoneamento`, `wms_localizacao`, `wms_movimentacao` — (script.js:9819; wms_enderecamento.py:8154, 3810)
- Passo 2 — confirmar a guarda bipando a longarina (confirma sozinho com o código completo; o servidor recusa endereço diferente da sugestão). Itens classificados são lançados no Estoque SP — POST `{acao:'confirmar_armazenagem'}` — `wms_localizacao`, `wms_palete`, `wms_movimentacao`, `wms_palete_controle`, `produtos_bipados` — (script.js:9833, 9134; wms_enderecamento.py:8176, 1083)
- Montar o próximo palete — (script.js:9388)
- Finalizar a NF (só com todos os paletes guardados). Sincroniza `terceiros_documento_itens`, conclui a pendência da descarga e abre o Histórico NF — POST `{acao:'finalizar'}` — (script.js:8599, 10147; wms_enderecamento.py:8386)
- Reiniciar o recebimento de uma NF finalizada (remove paletes, libera endereços, reabre a descarga) — POST `{acao:'reiniciar'}` — (script.js:9045; wms_enderecamento.py:8367)
- Excluir recebimento (o atual ou um da lista; `forcar` quando finalizado) — POST `{acao:'excluir'}` — (script.js:8964, 9081; wms_enderecamento.py:8349)
- Lista dos recebimentos em andamento (clique abre) — GET `/api/wms/recebimentos?leve=1` — (script.js:8165; wms_enderecamento.py:7827)
- "Ver histórico da NF" (abre o Histórico NF já preenchido) — (script.js:7098)

#### Pro › WMS › Controle Paletes (`&aba=controle-paletes`)
- Consultar palete pela etiqueta de 22 caracteres: detalhe e histórico de entrada/saída/retorno — GET `/api/wms/paletes/controle?etiqueta=` — `wms_palete`, `wms_palete_controle`, `wms_localizacao` — (script.js:4306; wms_enderecamento.py:10562)
- Registrar saída com motivo (expedição, transferência, auditoria, manutenção, outro), destino externo e observação; libera o endereço — POST `{acao:'saida'}` — (script.js:4364; wms_enderecamento.py:10603)
- Registrar retorno com motivo, endereço opcional para rearmazenar e observação — POST `{acao:'retorno'}` — (script.js:4395; wms_enderecamento.py:10617)
- Listar os paletes fora do armazém — GET `?lista=fora` — (script.js:4329)

#### Pro › WMS › Histórico NF (`&aba=historico-nf`)
- Buscar por NF ou ID do recebimento, filtrando por SKU, produto, palete, destino, status e período de bipagem; limpar filtros. O resultado mostra documento, período da bipagem (início, fim, duração, operadores), conferência NF × WMS, movimentações, paletes e linha do tempo — GET `/api/wms/historico-nf` — `wms_recebimento`, `wms_palete*`, `wms_movimentacao`, `terceiros_*` — (script.js:4520, 4559; wms_enderecamento.py:10644, 6185)

#### Pro › WMS › Relatórios (`&aba=relatorios`)
Todos via GET `/api/wms/relatorios?tipo=…&data_inicio&data_fim` (padrão de 30 dias) (script.js:4728; wms_enderecamento.py:10678, 6468).
- Relatório "Recebimentos por período" (`recebimentos`)
- Relatório "Itens bipados — detalhe" (`bipagem_itens`)
- Relatório "Paletes criados/armazenados" (`paletes`)
- Relatório "Movimentações" (`movimentacoes`)
- Relatório "Consolidado por SKU" (`produtos_recebidos`)
- Relatório "Produtividade por operador" (`operadores`)
- Relatório "NFs/recebimentos em aberto" (`nfs_pendentes`)
- Relatório "Entrada/saída/retorno de paletes" (`controle_paletes`)
- Relatório "Paletes fora agora" (`paletes_fora`)
- Relatório "Ocupação por câmara" (`ocupacao`)
- Exportar CSV (separador `;`, com BOM, gerado no navegador) — (script.js:4773)

#### Pro › WMS › Separação (`&aba=separacao`)
- Gerar a lista de separação por ID roteiro + ID viagem: PICKING antes de PULMÃO, FIFO por produção, cor pelo status — GET `/api/wms/picking` — **`romaneio_por_item` (Carregamento)**, `wms_palete_item`, `wms_localizacao`, `wms_produto_enderecamento` — (script.js:10041; wms_enderecamento.py:10813, 4011)
- Bipar a saída para o stage (doca 1-4; etiqueta ou endereço de origem) — POST `/api/wms/separacao/bip-stage` — `wms_palete`, `wms_localizacao` (câmara 99), `wms_movimentacao` — (script.js:9973; wms_enderecamento.py:10738)
- Validar a saída de todos os paletes do stage — POST `/api/wms/separacao/validar-saida` — (script.js:10011; wms_enderecamento.py:10767)
- Listar o stage da viagem (pendentes de validação) — GET `/api/wms/separacao/stage` — (script.js:9953; wms_enderecamento.py:10792)

#### Pro › WMS › Endereçamento 2D/3D (`&aba=enderecamento`)
- "Atualizar ocupação" (força recarga) — GET `/api/wms/mapa-3d/layout` + GET `/api/wms/enderecamento?leve=1[&force=1]` — layout JSON, `wms_localizacao`, área 98 (`data/wms_areas_especiais.json`) — (script.js:6910, 5288; wms_enderecamento.py:7126, 10699)
- Planta 2D por câmara/rua: grade colunas × níveis colorida por status, área 98 (avaria/descarte/bloqueado), portas e bloqueios, com legenda — (script.js:6465, 6204)
- Mostrar/ocultar os itens armazenados numa câmara — GET `/api/wms/camara/<cod>/itens` — (script.js:6275; wms_enderecamento.py:7269)
- Clicar numa célula ou câmara abre o 3D com seta e rota até a posição — (script.js:6872, 6644)
- Acordeão 3D: escolher câmara, Abrir/Fechar 3D, Visão geral, Wireframe — GET `/api/wms/mapa-3d` — (script.js:6688, 6796)
- Barras de progresso com Cancelar para a planta, o 3D e o painel — (script.js:5218-5432)

#### Pro › WMS › Ocupação (`&aba=ocupacao`)
- Resumo do armazém (câmaras 11, 12 e 13 por padrão): total de posições, ocupadas com avaria, % ocupada, livres, % livre, vazias físicas e avaria; cards por câmara e gráfico de % por câmara (Chart.js) — GET `/api/wms/analise/ocupacao` — `wms_localizacao`, `wms_palete`, áreas especiais — (static/wms-analise.js:51; wms_enderecamento.py:7335, 4713)

#### Pro › WMS › Estoque Seg. (`&aba=estoque-seguranca`)
- Status por SKU (Excedido/Verde/Amarelo/Vermelho) com cards que filtram, rosca por status, top 15 estoque × ideal médio e tabela (até 200), filtro por categoria. **O GET também grava** o cache de estoque — GET `/api/wms/analise/estoque-seguranca?sync=1&categoria=` — `wms_produto_enderecamento` — (static/wms-analise.js:129-222; wms_enderecamento.py:7353, 4757)

#### Pro › WMS › Shelf Life (`&aba=shelf-life`)
- Shelf % por SKU (validade armazenada ÷ shelf_dias; Verde ≥60, Amarelo ≥40, Laranja ≥20, Vermelho abaixo), com cards, rosca, top 20 menores e tabela (até 150) — GET `/api/wms/analise/shelf-life?categoria=` — `wms_palete_item`, `wms_palete`, `wms_localizacao`, `wms_produto_enderecamento` — (static/wms-analise.js:224-292; wms_enderecamento.py:7372, 4825)

#### Pro › WMS › Visão Cruzada (`&aba=visao-cruzada`)
- Estoque de segurança × shelf life: prioridades (crítico, desperdício, produzir, validade, avaliar, excedente_ok, ok) com cards que filtram, matriz 3×3 e tabela com ação sugerida (até 120) — GET `/api/wms/analise/visao-cruzada?sync=1&categoria=` — (static/wms-analise.js:294-357; wms_enderecamento.py:7390, 4942)

#### Pro › WMS › Inventário (`&aba=inventario`)
- Iniciar inventário (descrição, câmara opcional), tirando um snapshot do estoque armazenado — POST `/api/wms/inventarios {tipo:'produto'}` — `wms_inventario`, `wms_inventario_linha` — (script.js:10317; wms_enderecamento.py:8929, 8574)
- Listar os inventários com progresso (conferidas/total), status e botões Abrir/Ver e Excluir — GET `/api/wms/inventarios` — (script.js:10341)
- Abrir o detalhe: pendentes, conferidos, divergências e extras — GET `?id=` — (script.js:10297; wms_enderecamento.py:8788)
- Bipar produto para conferir (EAN/SKU, UP, lote, fabricação, validade, qtd); a linha vira conferido, divergente ou extra — POST `{acao:'bip'}` — (script.js:10370; wms_enderecamento.py:8839)
- Aplicar as bipagens na base (atualiza `wms_palete_item` das linhas divergentes/extras) e finalizar — POST `{acao:'aplicar_base'}` — (script.js:10414; wms_enderecamento.py:8861, 8703)
- Finalizar sem atualizar a base — POST `{acao:'finalizar'}` — (script.js:10435)
- Excluir inventário — POST `{acao:'excluir'}` — (script.js:10450)

#### Pro › WMS › Pesquisa SKU (`&aba=pesquisa`)
- Pesquisar por SKU, descrição, etiqueta ou UP: lista lote, validade, palete, endereço, bloqueio e qtd, ordenada por validade, com resumo do estoque real. Ao abrir, roda com busca vazia (até 500 linhas) — GET `/api/wms/pesquisa-sku?q=` — `wms_palete_item`, `wms_palete`, `wms_localizacao`, `wms_produto_enderecamento` — (script.js:10505; wms_enderecamento.py:7680)

#### Pro › WMS › ASN (`&aba=asn`)
- Importar ASN (número, fornecedor, depósito), gravando também um evento de integração — POST `/api/rfq/asn` — `wms_asn`, `rfq_integration_event` — (static/wms-rfq.js:65; rfq_platform.py:597)
- Listar os últimos 50 ASNs (só cabeçalho; **sem itens e sem vínculo real com o Recebimento**) — GET `/api/rfq/asn` — (static/wms-rfq.js:45)

#### Pro › WMS › Config RFQ (`&aba=config-rfq`)
- Carregar os depósitos (só existe o CD01 do seed; não há tela para criar outros) — GET `/api/rfq/depositos` — `wms_deposito`, `wms_empresa` — (static/wms-rfq.js:85)
- Carregar os parâmetros ao trocar de depósito — GET `/api/rfq/params?deposito_id` — `rfq_param_perfil` — (static/wms-rfq.js:107)
- Salvar conferência (total/parcial/cego), política de lote (FIFO/FEFO/LIFO), inventário cego e recontagem automática — 4× POST `/api/rfq/params` — (static/wms-rfq.js:125)
  - **Só `conferencia_modo` tem efeito** (banner do Recebimento).
- Ver a cobertura RFQ (resumo + 40 itens) — GET `/api/rfq/coverage` — constante `RFQ_CATALOG` — (static/wms-rfq.js:149)

#### Pro › WMS › QA Lote (`&aba=qa-lote`)
- Registrar o status de QA de um lote (SKU, lote, quarentena/aprovado/reprovado, motivo, depósito). **Não bloqueia o putaway**, embora a resposta diga que sim, e não há listagem — POST `/api/rfq/qa/lote` — `wms_lote_qa` — (static/wms-rfq.js:206; rfq_platform.py:651)

#### Pro › WMS › PICKING+ (`&aba=picking-avancado`)
- Criar onda (código, zona, depósito), sem listagem nem execução — POST `/api/rfq/picking/onda` — `wms_picking_onda` — (static/wms-rfq.js:234)
- Ordenar uma rota colando endereços (um por linha) — POST `/api/rfq/picking/rota` — usa `wms_endereco.parse_codigo_wms` — (static/wms-rfq.js:248; rfq_platform.py:740)

#### Pro › WMS › YMS (`&aba=yms`)
- Agendar doca (doca, transportadora, placa, slot, prioridade normal/VIP) — POST `/api/rfq/yms/agendamento` — `yms_agendamento` — (static/wms-rfq.js:317)
- Listar os últimos 50 agendamentos — GET `/api/rfq/yms/agendamentos` — (static/wms-rfq.js:275)
- Check-in na portaria (agendamento, placa, motorista, peso, documentos OK); não muda o status do agendamento — POST `/api/rfq/yms/portaria/checkin` — `yms_portaria_checkin` — (static/wms-rfq.js:336)
- Criar vaga de pátio — POST `/api/rfq/yms/patio/vaga` — `yms_patio_vaga` — (static/wms-rfq.js:352)
- Mapa do pátio (vagas livres/ocupadas, placa), sem ação de ocupar/liberar — GET `/api/rfq/yms/patio` — (static/wms-rfq.js:297)

#### Pro › WMS › Agendamentos (Hub) (só pelo botão)
- Listar as previsões de entrada destinadas ao Pro (NF/pedido, cliente·portal, status no Hub, data, placa, volumes, protocolo) — GET externo `{HUB_API_URL}/api/public/wms/previsoes?wms=pro` (padrão `https://dockhub-api.onrender.com`) — (static/wms-hub.js:40; app.py:3934-3942)
- Botão Atualizar — (static/wms-hub.js:99)

#### Pro › WMS › 3PL (`&aba=3pl`)
- Criar depositante (código, nome, depósito) — POST `/api/rfq/tpl/depositante` — `wms_depositante` — (static/wms-rfq.js:370)
- Salvar tarifa (depositante, tipo posição/palete/m³, valor por dia) — POST `/api/rfq/tpl/tarifa` — `tpl_tarifa` — (static/wms-rfq.js:385)
- Gerar fatura rascunho com período e total **digitado à mão** (não calcula) — POST `/api/rfq/tpl/fatura` — `tpl_fatura` — (static/wms-rfq.js:400)
- Abrir o "portal" do depositante (JSON com estoque/NFs/SLA vazios — stub) — GET `/api/rfq/tpl/portal/<codigo>` — (static/wms-rfq.js:414)

#### Pro › WMS › Verticais (`&aba=verticais`)
- Liberar cross-dock por ID de recebimento (**stub: não grava nada**, só devolve `XD-xxxx`) — POST `/api/rfq/cross-dock/liberar` — (static/wms-rfq.js:447)
- Cadastrar bobina (código, peso, diâmetro, empilhamento máximo) — POST `/api/rfq/bobinas` — `wms_bobina` — (static/wms-rfq.js:457)
- Listar bobinas — GET `/api/rfq/bobinas` — (static/wms-rfq.js:474)
- Registrar evento WCS (tipo, fabricante) — POST `/api/rfq/wcs/evento` — `rfq_integration_event` — (static/wms-rfq.js:494)
- Banner "Portuário/Siscomex fora do núcleo" (resposta fixa) — GET `/api/rfq/portuario` — (static/wms-rfq.js:432)

---

## 3. Plus / Câmaras — `/camaras`

> **Arquivos:** fonte em `frontend_plus/src` (`App.tsx` ~4,7 mil linhas, `components/`, `hooks/`, `lib/`, `pages/`, `layout/`). O bundle servido é `static/wms-plus`.
>
> **Dados** (via `/sb/rest/v1`):
> - estoque e NFs: `ultrafrio_notas_fiscais`, `ultrafrio_nf_itens`, `ultrafrio_enderecamentos`, `ultrafrio_movimentos`, `ultrafrio_notas_canceladas`, `ultrafrio_cadastro_remetentes`;
> - voz: `ultrafrio_voz_cadastros`;
> - financeiro: `ultrafrio_fin_tabelas`, `ultrafrio_fin_clientes`, `ultrafrio_fin_contratos`.
>
> O Plus não chama nenhuma rota `/api/wms/*`.
>
> **Quem pode usar:**
> - **Abrir o Plus:** exige sessão Flask; sem ela, vai para `/login` (app.py ~3840).
> - **Permissão por tela:**
>   - Cada seção corresponde a um módulo de `permissoes.plus.modulos`, que vem de POST `/api/portal/me` (App.tsx:3881-3929, 3976-3981; catálogo em portal_permissoes.py:45-58).
>   - Níveis:
>     - **Editar:** acesso completo.
>     - **Visualizar:** banner "somente leitura" + `guardMutations`, que bloqueia as ações marcadas `[editar]`.
>     - **Ausente:** o item some do menu e, aberto por URL ou voz, mostra "Sem acesso a esta aba" (App.tsx:3385; AppSidebar.tsx:96-108).
>   - `null` (Super Usuário) libera tudo.
> - **Exceções:**
>   - `pode_acessar=false` para o Plus **não bloqueia** a entrada: `allowedSystemIds` nunca é lido.
>   - O mapa principal fica sempre visível.
>   - Há um fallback no cliente que trata como SU qualquer login que comece com "diego" ou "elder" (lib/portalConfigApi.ts:319-343). O estado resultante `isSuperUser` nunca é lido.
>
> **Não existe no Plus:** leitura de código de barras e exportação real para Excel/PDF por biblioteca (só CSV + `window.print`). **Existe:** voz (Web Speech API) e IA (Gemini).

#### Plus › Infraestrutura comum (todas as seções)
- Carregar e salvar todo o estado com gravação incremental e novas tentativas (3 + 5 automáticas) — `ultrafrio_*` — (lib/repository/supabaseRepository.ts:88-610; hooks/useEnderecamentoStore.ts:65-86, 222)
- Sincronizar entre abas e usuários: consulta mudanças a cada 4 s e faz recarga completa a cada 30 s — GET `/sb/changes?since=&tables=` — (lib/pollingRealtime.ts:32-93; hooks/useEnderecamentoStore.ts:55-64)
- Mesclar o rascunho local com o remoto, com proteção contra regressão, bloqueio de "apagar todo o estoque" e detecção de banco resetado — `localStorage ultrafrio-enderecamento-v3` — (hooks/useEnderecamentoStore.ts:98-120, 275-294)
- Modo 100% local (localStorage) quando o Supabase não está configurado — (lib/repository/index.ts:9; lib/repository/localRepository.ts)
- Ler a config do cliente — GET `/supabase-config.json` — (lib/supabaseConfig.ts:15)
- Reparar no boot as NFs com endereços perdidos ou inválidos — (App.tsx:488-501; lib/repararNfEstoque.ts:161)
- Recalcular o peso bruto dos itens a partir do total da NF ao carregar — (lib/parseNfeXml.ts:96)
- Restaurar após F5 a aba, a NF ativa e a saída/entrada/cancelada pendente — (App.tsx:507-583; lib/uiSession.ts)
- Abrir a seção por `?secao=` e reescrever a URL ao trocar de aba — (App.tsx:292-313, 3383-3404)
- Avisar ao sair com entrada incompleta ou movimentação não salva — (App.tsx:698-718, 3345-3381; components/EntradaPendenteAlert.tsx; MovimentacaoPendenteAlert.tsx)
- Overlay "Salvando…", banner de instalação PWA e banner de homologação — (App.tsx:4200-4207; components/PwaInstallBanner.tsx; AmbienteBanner.tsx)

#### Plus › Barra superior e menu da conta (global)
- Recolher/abrir o menu e escolher o layout Recolhido / Aberto / Tela cheia; redimensionar a largura arrastando — (AppTopBar.tsx:79-92, 143, 182; AppSidebar.tsx:44-73, 139-180)
- Botão "← Módulos": volta ao Hub `/entrada` — (AppTopBar.tsx:154-164)
- Legenda dinâmica do mapa conforme o modo ativo — (AppTopBar.tsx:181; App.tsx:4215-4232)
- Alternar tema claro/escuro e atualizar a página — (ThemeToggle.tsx; AccountMenuPopover.tsx:89; AppTopBar.tsx:117, 201)
- Zerar o estoque de homologação (dupla confirmação; preserva financeiro e remetentes). Só em homologação; **sem checagem de papel** — DELETE em `ultrafrio_movimentos`, `ultrafrio_notas_canceladas`, `ultrafrio_enderecamentos`, `ultrafrio_nf_itens`, `ultrafrio_notas_fiscais` — (AppTopBar.tsx:121-138, 189; lib/homologZerarBanco.ts:11-42)
- Relógio, data e versão — (AppTopBar.tsx:212-216)
- Trocar o "usuário logado" ativo (lista local: SSO, vozes reconhecidas, "Doca Livre") — (AccountMenuPopover.tsx:95-113; App.tsx:3593-3628; lib/contaSessao.ts)
- Itens "Configurar conta" e "Comando de voz" (**quebrados**: rolam até um elemento do CadastroVozPanel, que não é renderizado) — (AppTopBar.tsx:102-110; App.tsx:3609-3622)
- Mostrar erro de gravação no cartão do usuário — (AppTopBar.tsx:231)

#### Plus › Mapa de Câmaras (painel principal, sempre visível)
- Exibir as câmaras 6, 7, 8, 9 e 10 (ruas × 15 colunas × níveis 1-5, portas e células bloqueadas **fixas no código**, sem cadastro editável) — (layout/camaras.ts:21-69; components/LayoutPanel.tsx)
- Clicar num endereço ocupado e ver produto, NF, quantidade, fabricação e validade — (App.tsx:1215-1220; components/DetailModal.tsx)
- Selecionar endereços por clique ou arrasto (entrada, movimentação, saída, consulta), com alerta de ocupado e de limite de paletes — [editar] — (LayoutPanel.tsx:451-467; App.tsx:1244-1518; OcupadoAlert.tsx; PaletesLimiteAlert.tsx)
- Cards por câmara: ocupadas, livres, % de ocupação e valor — (LayoutPanel.tsx:572; CamaraStatsCards.tsx)
- "Ver notas fiscais e produtos armazenados" da câmara: NFs, posições, produto, quantidade, fabricação, validade e data de armazenagem — (LayoutPanel.tsx:553-558, 798; CamaraInfoModal.tsx:65-130; lib/camaraInventario.ts:133)
- Área STAGE: modal com os itens no stage e alvo para "enviar ao stage" — (LayoutPanel.tsx:746; StageSection.tsx:35; StageModal.tsx)
- Focar, rolar e pulsar o endereço encontrado numa busca, com aviso "encontrado" — (App.tsx:597-651; lib/focarMapaBusca.ts; BuscaEncontradaToast.tsx)

#### Plus › Consulta estoque › Pesquisa (`?secao=consulta`)
- Pesquisar por NF, item (código ou descrição), remetente (com autocompletar) e lote, com origem Armazém / Stage / Ambos, e destacar no mapa — (components/ConsultaEstoquePanel.tsx:157-236; App.tsx:3080-3109; lib/consultaEstoque.ts:59)
- Limpar a pesquisa — (ConsultaEstoquePanel.tsx:239; App.tsx:3111)
- Resultados agrupados por NF: detalhe, itens, lote/UP, posições, paletes e endereços físico/stage — (ConsultaEstoquePanel.tsx:249-320)
- Diagnóstico quando a NF existe mas sumiu do mapa — (App.tsx:225-251, 3100-3106)
- "Adicionar mais itens em um novo endereço": buscar uma NF existente — [editar] — (ConsultaEstoquePanel.tsx:326-336; App.tsx:3127)
- Replicar um item existente com N paletes e endereçar no mapa — [editar] — `ultrafrio_nf_itens`, `ultrafrio_enderecamentos`, `ultrafrio_movimentos` — (ConsultaEstoquePanel.tsx:426-468; lib/adicionarItemNf.ts)
- Adicionar item manual a uma NF existente e endereçar — [editar] — (ConsultaItemManualForm.tsx; App.tsx:3197)
- Confirmar ou cancelar os endereços do item adicionado — [editar] — `ultrafrio_enderecamentos` — (ConsultaEstoquePanel.tsx:358-364; App.tsx:3154)
- Excluir item da NF (remove a NF da entrada se for o último) — [editar] — `ultrafrio_nf_itens`, `ultrafrio_movimentos` — (ConsultaEstoquePanel.tsx:410-505; App.tsx:3216-3286; lib/excluirItemNf.ts)

#### Plus › Consulta estoque › Inventário completo (aba interna de `?secao=consulta`)
- Ver todas as NFs com estoque, de forma resumida ou detalhada, e destacar uma NF ou tudo no mapa — (ConsultaEstoquePanel.tsx:121-150; ConsultaEstoqueInventario.tsx:70-151; lib/consultaEstoque.ts:159)

#### Plus › Entrada (`?secao=entrada`)
- Subir um ou vários XMLs de NF-e de entrada e criar a NF com itens, pesos, valores, lote e validade — [editar] — `ultrafrio_notas_fiscais`, `ultrafrio_nf_itens`, `ultrafrio_movimentos`, `ultrafrio_cadastro_remetentes` — (components/EntradaPanel.tsx:83-92; App.tsx:941-1038; lib/parseNfeXml.ts:175)
- Detectar NF duplicada ou cancelada e reparar a NF existente pelo XML — [editar] — (App.tsx:957-986; lib/nfDuplicate.ts; lib/repararNfEstoque.ts:181)
- Cadastrar automaticamente o cliente financeiro pelo CNPJ do emitente — `ultrafrio_fin_clientes` — (App.tsx:992, 1066; hooks/useFinanceiro.ts:134)
- Escolher o destino da importação: Armazém (endereçar) ou Stage — [editar] — (App.tsx:1040-1076; EntradaDestinoModal.tsx)
- Cadastrar NF manual (número, série, remetente e N itens com código, descrição, quantidade, unidade, UP, lote, fabricação, validade) ou escolher o item de uma NF existente — [editar] — (EntradaPanel.tsx:94; ManualNfModal.tsx:168-404; App.tsx:1827-1893; lib/manualNf.ts)
- Listar "Entradas em andamento" com seleção múltipla (Ctrl/Shift) e contagem de pendentes — (EntradaPanel.tsx:102-118; App.tsx:1138-1207)
- Editar a data de armazenagem da NF (base da cobrança) — [editar] — `ultrafrio_notas_fiscais.data_armazenagem` — (EntradaPanel.tsx:165, 191; App.tsx:1648)
- Editar por item: UP, lote, fabricação, validade, destino Armazém/Stage, paletes ou quantidade — [editar] — `ultrafrio_nf_itens` — (NfItensTable.tsx:245-336; App.tsx:1628-1766)
- Desmembrar item (dividir a linha) — [editar] — (NfItensTable.tsx:342-356; lib/desmembrarItem.ts)
- Selecionar no mapa N endereços (= nº de paletes) e "Confirmar endereços do item" ou "Limpar seleção" — [editar] — `ultrafrio_enderecamentos` — (EntradaPanel.tsx:220-237; App.tsx:1520-1626, 1936)
- "Confirmar no stage" para item com destino stage — [editar] — (EntradaPanel.tsx:249-254; App.tsx:1568)
- "Deixar pendente" ou "Finalizar entrada" — [editar] — `ultrafrio_notas_fiscais.status` — (EntradaPanel.tsx:263-288; App.tsx:1788-1825)
- "Cancelar entrada" (remove a NF e seus movimentos) — [editar] — (EntradaPanel.tsx:142-147, 296-321; App.tsx:1899; lib/movimentos.ts)

#### Plus › Agendamentos (Hub) (`?secao=agendamentosHub`)
- Listar os agendamentos do Hub destinados ao Plus (status, cliente, portal, data/hora, protocolo, placa, volumes) com a situação no WMS (Previsão / Pronto / Entrada em andamento / Já no WMS) — GET externo `{VITE_HUB_API_URL ou https://dockhub-api.onrender.com}/api/public/wms/previsoes?wms=plus` — (components/HubPrevisaoEntrada.tsx:20-120; lib/hubIntegracao.ts:41-61)
- Atualizar manualmente, com recarga automática a cada 60 s — (HubPrevisaoEntrada.tsx:63; lib/hubIntegracao.ts:132)
- "Subir XML" a partir do agendamento, entrando na Entrada com vínculo `hubAgendamentoId` (o vínculo não é gravado no banco nem devolvido ao Hub) — [editar] — (HubPrevisaoEntrada.tsx:115; App.tsx:4305)
- "Cadastrar NF" com o número da NF do agendamento já preenchido — [editar] — (HubPrevisaoEntrada.tsx:118; App.tsx:4309-4319)
- "Abrir no WMS": seleciona a NF na Entrada (só funciona para NF em andamento) — (HubPrevisaoEntrada.tsx:105; App.tsx:1140, 4320)

#### Plus › Saída (`?secao=saida`)
- Escolher o modo de busca: número da NF ou XML de NF-e de saída — (components/SaidaPanel.tsx:165-180; App.tsx:2043)
- Buscar a NF de origem pelo número — (SaidaPanel.tsx:193-199; App.tsx:2135)
- Subir o XML de saída. Lê `refNFe`, vincula sozinho com uma única referência com estoque, ou lista as referências e sugere a origem pelo código; limita as quantidades ao XML — [editar] — (SaidaPanel.tsx:214, 230-315; App.tsx:2056-2133; lib/saidaXml.ts)
- Escolher a origem Armazém × Stage quando a NF tem os dois — (App.tsx:1988-2041, 4722-4749; EscolhaEstoqueModal.tsx)
- Saída do armazém por paletes: escolher o item e a quantidade de paletes, selecioná-los no mapa e confirmar — [editar] — (SaidaItemSubpainel.tsx:195-245; App.tsx:2164-2248)
- Saída parcial: caixas por palete, com prévia do cálculo; confirmar ou remover palete — [editar] — (SaidaItemSubpainel.tsx:272-319; App.tsx:2260-2371; lib/saidaParcial.ts)
- Saída do stage por quantidade de cada item — [editar] — (SaidaPanel.tsx:438-552; App.tsx:2446-2491)
- Informar a data e o motivo (Venda, Transferência, Descarte, Devolução de remessa, Acerto de estoque, Revenda) e "Finalizar saída": libera os endereços e grava o movimento com a NF de saída — [editar] — `ultrafrio_movimentos`, `ultrafrio_nf_itens`, `ultrafrio_enderecamentos` — (SaidaPanel.tsx:422, 598-627; App.tsx:2373-2421, 2493-2540; lib/justificativaSaida.ts)
- Cancelar a saída — [editar] — (SaidaPanel.tsx:352, 644, 663-693; App.tsx:2542)
- Ver o resumo total da saída e o resumo de entrada de cada item — (SaidaResumoTotal.tsx; SaidaItemEntradaResumo.tsx; lib/resumoItemEntrada.ts)

#### Plus › Movimentação (`?secao=editar`)
- Buscar a NF pelo número e ver o detalhe — (components/EditarPosicaoPanel.tsx:198-203; App.tsx:2601-2620)
- Reposicionar: marcar no mapa as origens e os destinos e "Confirmar movimentação" — [editar] — `ultrafrio_enderecamentos`, `ultrafrio_movimentos` — (EditarPosicaoPanel.tsx:286, 370-395; App.tsx:1354-1398, 2850-3008)
- Enviar paletes ao STAGE (marcar no mapa e soltar na área STAGE) — [editar] — (EditarPosicaoPanel.tsx:293-340; App.tsx:2812-2848)
- Tirar do STAGE para o estoque físico, com o endereço por Câmara/Rua/Posição/Nível ou pelo mapa — [editar] — (EditarPosicaoPanel.tsx:227-325; EnderecoDestinoForm.tsx:79-151; App.tsx:2803)
- Adicionar posições a um item (item e quantidade, seleção no mapa, confirmação) — [editar] — (EditarPosicaoPanel.tsx:143, 248-259, 415-460; App.tsx:3010-3072)
- Movimentar por voz: escolher a origem, falar o destino ("câmara 6 rua 1 coluna 2 nível 3") e confirmar por voz (Web Speech API) — [editar] — (MovimentacaoVozControle.tsx:24-133; App.tsx:2722-2801; lib/parseEnderecoFalado.ts; lib/movimentacaoVoz.ts)
- "Remover do estoque" com motivo (NF incorreta, endereçamento incorreto, entrada duplicada, dados do item incorretos, XML com erro, quantidade incorreta, entrada indevida, outro) — [editar] — `ultrafrio_notas_fiscais`, `ultrafrio_movimentos` — (EditarPosicaoPanel.tsx:151, 473-527; App.tsx:3288-3335; lib/motivoRemocaoEstoque.ts)
- Cancelar a edição — (EditarPosicaoPanel.tsx:159, 532-557; App.tsx:3074)

#### Plus › NF cancelada (`?secao=canceladas`)
- Subir o XML da NF-e cancelada (nota completa ou evento `procEventoNFe`) — [editar] — `ultrafrio_notas_canceladas` — (components/CanceladasPanel.tsx:128, 141; App.tsx:1078-1102; lib/parseCanceladaXml.ts:104)
- Bloquear cancelada duplicada — (App.tsx:1084; lib/nfDuplicate.ts)
- "Cancelar cadastro" da cancelada recém-enviada — [editar] — (CanceladasPanel.tsx:50-70, 150; App.tsx:1134)
- Vincular a cancelada à NF nova (substituição) ou desvincular — [editar] — `ultrafrio_notas_canceladas`, `ultrafrio_notas_fiscais` — (CanceladasPanel.tsx:195-220; lib/nfCanceladas.ts:165, 190)
- Excluir NF cancelada (marca como excluída) — [editar] — (CanceladasPanel.tsx:88-114, 174; lib/nfCanceladas.ts:197)

#### Plus › Histórico (`?secao=historico`)
- Filtrar por Todos / Movimentação / Entrada / Saída / Canceladas, com contadores — (components/HistoricoPanel.tsx:22-76)
- Abrir os cards de entrada, saída, movimentação e cancelada, com motivo da saída, NF de saída, motivo de remoção e itens/paletes — `ultrafrio_movimentos`, `ultrafrio_notas_canceladas` — (HistoricoPanel.tsx:108-453, 572-630)

#### Plus › Relatório (`?secao=relatorio`)
- Escolher a origem Armazém / Stage / Todos e ver os totais de notas, itens e posições — (components/RelatorioPanel.tsx:18-65; lib/relatorioEstoque.ts:64)
- Baixar CSV de notas fiscais e CSV de itens armazenados — (RelatorioPanel.tsx:74-110; lib/relatorioEstoque.ts:143, 175, 211)
- "Imprimir / PDF" de notas e de itens (abre janela e chama `window.print`) — (RelatorioPanel.tsx:86-117; lib/relatorioEstoque.ts:240-318)

#### Plus › Painel (`?secao=painel`, abre em tela cheia)
- Filtrar por período rápido (Hoje / 7 / 30 / 90 dias) ou por data e hora (salvo em `localStorage ultrafrio-painel-filtros`) — (components/PainelPanel.tsx:20-136; App.tsx:253-271, 3337)
- KPIs: % de ocupação, valor armazenado, paletes armazenados, posições livres — (PainelKpiCards.tsx:21-77)
- 13 gráficos em 3 seções — (lib/painelAnalytics.ts:452-478; PainelGraficoCard.tsx):
  - Estoque atual: ocupação, valor total, valor em paletes, posições ocupadas, posições livres, stage × armazém.
  - Movimentação: entradas × saídas por dia, volume no tempo, movimentos por tipo, paletes/dia, NFs/dia.
  - Operação: principais emitentes, saídas por motivo.

#### Plus › Financeiro 3PL › Tabela de cobrança (`?secao=financeiro`)
- Criar, editar e excluir tabela (nome, custo por posição palete, R$/kg, R$/palete, entrada R$/palete, saída R$/palete) — [editar] — `ultrafrio_fin_tabelas` — (components/FinanceiroPanel.tsx:334-495)

#### Plus › Financeiro 3PL › Contrato
- Criar, editar e excluir contrato (cliente ou CNPJ + razão social, tabela, ciclo mensal/quinzenal, regra proporcional/cheia, cobrar posição/kg/entrada/saída, observação) — [editar] — `ultrafrio_fin_contratos` — (FinanceiroPanel.tsx:510-782)

#### Plus › Financeiro 3PL › Clientes
- Cadastrar cliente manualmente (CNPJ, razão social) e listar — [editar] — `ultrafrio_fin_clientes` — (FinanceiroPanel.tsx:797-870)
- Selecionar cliente e ver o resumo (contrato ativo, tabela, NFs armazenadas, valores) — (FinanceiroPanel.tsx:249-257, 870-900; lib/financeiro/calculo.ts:730)
- Criar clientes automaticamente a partir do CNPJ dos emitentes das NFs (upsert por CNPJ) — `ultrafrio_fin_clientes` — (hooks/useFinanceiro.ts:134; lib/financeiro/clientes.ts:16-49)

#### Plus › Financeiro 3PL › Movimentação ("Controle de permanência")
- Filtrar por cliente e ver o resumo geral (valor a cobrar, acumulado, posições, peso, caixas, paletes, itens, NFs) — (FinanceiroPanel.tsx:1306-1673)
- "Gerar Excel detalhado" (na verdade baixa um **CSV** `ultrafrio-financeiro-detalhado-AAAA-MM-DD.csv`) — (FinanceiroPanel.tsx:1517-1602, 1639)
- Definir o período de cobrança em massa ou por NF (**estado local, não é gravado**) — (FinanceiroPanel.tsx:1506-1515, 1683-1721, 1876-1888)
- Editar a data de armazenagem de cada NF na lista — [editar] — `ultrafrio_notas_fiscais` — (FinanceiroPanel.tsx:1812; App.tsx:1648)
- Ver por NF o valor a cobrar, os débitos de entrada e as saídas (incluindo parciais), com paginação — (FinanceiroPanel.tsx:1737-1975)

#### Plus › Financeiro 3PL › Lógica de cobrança
- Totais (calculado, NFs, armazenadas, finalizadas, dias, sem contrato, sem tabela) e detalhamento por NF (ciclo, regra, fator, tabela, o que cobra, peso, caixas, paletes, posições, valor da mercadoria), com paginação — (FinanceiroPanel.tsx:987-1300)
- Motor de cálculo: diárias, regra proporcional/cheia, ciclo mensal/quinzenal, por posição/kg/palete, débitos de entrada/saída — (lib/financeiro/calculo.ts:112-730)
- Gravar por sincronização (delete + upsert por tabela), com fallback `localStorage ultrafrio-financeiro` — (lib/financeiro/repository/supabaseFinanceiroRepository.ts:133-221)

> Obs.: o Financeiro não emite fatura, boleto nem NFS-e; só calcula e exporta CSV.

#### Plus › IA DOCA LIVRE (`?secao=cadastroVoz`)
- Conversar por texto, com histórico e indicador de "pensando" — [editar] — (components/IaDocaLivrePanel.tsx:136-160; App.tsx:3630-3696)
- Chips de sugestão ("Abre o painel", "Tem leite no estoque?", "Pesquise a NF 20835", "Mostra o financeiro") — (IaDocaLivrePanel.tsx:17-22, 94)
- Ditar pelo microfone (Web Speech API) — (IaDocaLivrePanel.tsx:29, 68, 149-157; hooks/useSpeechRecognition.ts)
- Interpretar localmente e, se houver chave, pelo Gemini com chamada de ferramentas — `https://generativelanguage.googleapis.com/v1beta/models/<modelo>:generateContent` — (lib/wmsGeminiAgent.ts:12-177, 327-334; lib/voiceAiInterpret.ts:52-100)
  - Chave: `VITE_GEMINI_API_KEY` ou `localStorage`.
  - Ferramentas: open/close_section, consultar_estoque, buscar_nota_movimentacao, buscar_nota_saida, limpar_consulta, painel_periodo, confirmar_movimentacao, selecionar_endereco, sidebar_mode, toggle_theme, get_resumo_estoque.
- Executar o comando reconhecido (abrir/fechar aba, buscar NF na Movimentação ou na Saída, consultar estoque, período do painel, confirmar movimentação, modo do menu, tema) — (App.tsx:3438-3549)
- Assistente por palavra de ativação "ok estoque" com HUD e fala (TTS). Está ligado no código, mas **não pode ser ativado pela interface** (`voicePrefs.enabled=false` e a tela que liga não é renderizada) — `ultrafrio_voz_cadastros` — (App.tsx:3422-3436, 3698-3775; hooks/useVoiceAssistant.ts; components/VoiceAssistantHUD.tsx)
- Carregar e sincronizar o registro de vozes cadastradas (sem tela para cadastrar ou remover) — `ultrafrio_voz_cadastros` — (hooks/useVoiceRegistry.ts; lib/voiceRegistrySync.ts:34-148)

#### Plus › Mapa (Imprimir) (`?secao=imprimir`)
- Selecionar câmaras (6-10) uma a uma, todas ou nenhuma — (components/ImprimirPanel.tsx:30-60)
- Escolher a orientação Paisagem ou Retrato — (ImprimirPanel.tsx:64-80)
- "Imprimir mapa preenchido", com ocupação e código do produto nas células (A4) — [editar] — (ImprimirPanel.tsx:87-93; App.tsx:669-694; PrintLayoutDocument.tsx)
- "Imprimir layout em branco" — [editar] — (ImprimirPanel.tsx:95-101)

#### Plus › Hierarquia & Permissões › Hierarquia (`?secao=config`; `/config-portal` redireciona para cá)
> O frontend abre para qualquer usuário (App.tsx:314-321, 354, 4143). O backend exige SU em todo `/api/portal/config/*` (`_portal_require_superuser`, app.py:2693: 403 "Apenas Super Usuários").
- Carregar o overview (usuários, níveis, matriz de permissões, árvores, grupos, catálogo de módulos) — [SU] — POST `/api/portal/config/overview` — (pages/PortalConfigScreen.tsx:78-100; lib/portalConfigApi.ts:196; app.py:2716)
- Escolher o sistema (WMS Light / Plus / Pro) — [SU] — (PortalConfigScreen.tsx:253-298)
- Árvore de organizações (criar a raiz "Operador Logístico"; adicionar filhos dos tipos permitidos operador_logistico → filial_operador / embarcador → unidade → transportadora; editar nome, CNPJ, código e marca "fornecedor"; excluir) — [SU] — POST `/api/portal/config/org` e `/api/portal/config/org/delete` — tabelas de `portal_hierarquia.py` — (components/PortalHierarchyTree.tsx:72-312; app.py:2839, 3070)
- Grupos de hierarquia: criar (nome, descrição), selecionar, excluir — [SU] — POST `/api/portal/config/grupos` e `/grupos/delete` — (components/PortalHierarchyGroups.tsx:49-170; app.py:2930, 2978)
- Membros do grupo: adicionar empresa com "pai no grupo", remover — [SU] — POST `/api/portal/config/grupos/membros` e `/grupos/membros/delete` — (PortalHierarchyGroups.tsx:79-224; app.py:3003, 3043)
- "Sair" (`/login?sair=1`) e "Continuar" (vai para `/entrada`) — (PortalConfigScreen.tsx:243-246; App.tsx:4147-4161)

#### Plus › Hierarquia & Permissões › Permissões
- Lista de usuários (sem os SU) com busca por nome ou e-mail — [SU] — (PortalConfigScreen.tsx:45-47, 322-360)
- Vincular o usuário a uma empresa da hierarquia (salva na hora) — [SU] — POST `/api/portal/config/hierarquia` — (PortalConfigScreen.tsx:409-425; app.py:2806)
- Liberar ou bloquear o acesso por sistema (`pode_acessar`) — [SU] — (PortalConfigScreen.tsx:~470-490)
- Definir as telas de um sistema como Editar / Visualizar / Nenhuma, em massa ou tela por tela — [SU] — (PortalConfigScreen.tsx:499-516, 540-545)
- Salvar a matriz de permissões — [SU] — POST `/api/portal/config/permissoes` — (PortalConfigScreen.tsx:151, 574-578; app.py:2778)

> Obs.: a matriz salva aqui só é aplicada no Plus. O Pro e o Light ignoram as permissões por tela, e o `pode_acessar` só é checado na emissão de SSO (`/api/sso/issue`), que nenhuma tela viva chama.

#### Plus › Login interno do portal (`/camaras?sair=1` ou após erro de SSO)
- Entrar com usuário e senha (antes "acorda" a API com `/api/health`) — POST `/api/portal/login` — (pages/PortalLoginScreen.tsx:91, 120; lib/portalApi.ts:101-167; app.py:2595)
- Criar conta com código por e-mail (enviar, verificar, concluir). O backend exige SU — POST `/api/portal/cadastro/{enviar-codigo,verificar-codigo,concluir}` — (PortalLoginScreen.tsx:155-198; app.py:3142-3326)
- Esqueci a senha (enviar código ao e-mail, verificar, redefinir) — POST `/api/portal/senha/{enviar-codigo,verificar-codigo,redefinir}` — (PortalLoginScreen.tsx:224-274; app.py:3327-3546)
- Entrar por SSO com `?sso=`/`?token=`. Chama a URL externa `{VITE_WMS_PRO_URL ou https://doca-livre-wms-pro.onrender.com}/api/sso/verify`, não a origem unificada — (lib/portalSso.ts:3-47; App.tsx:4054-4088)

> Obs.: depois desse login, quem não é SU cai na tela de Configuração, recebe 403 e só sai por "Continuar" (App.tsx:4166-4176).

---

## 4. Light / Contagem — `/contagem`

> **Arquivos:** fonte em `frontend_light/src` (`App.tsx`, `pages/`, `components/`, `lib/`). O bundle servido é `static/wms-light`. A tela é escolhida por `?view=`; sem view ou com view inválida, abre o `painel` (App.tsx:57-69).
>
> **Dados** (via `/sb/rest/v1`, o Postgres do Flask):
> - catálogo e pessoas: `"Todos os Produtos"`, `produto_listas`, `conferentes`;
> - contagem diária: `contagem_diaria_sessoes`, `contagem_diaria_captura_presenca`, `contagens_estoque`;
> - inventário: `inventario_sessoes`, `inventario_captura_presenca`, `contagens_inventario`, `inventario_planilha_linhas`;
> - endereços: `enderecamento_listas`;
> - câmaras: `contagem_temperatura_camaras`, `contagem_ocupacao_camaras`;
> - painel e exportação: `contagem_diaria_presenca` (só contagem), `v_contagem_diaria_itens_painel`.
>
> **O Light não chama nenhum `/api/*` do Flask.** Fora o `/sb`, usa a API externa do Hub (`dockhub-api`) e CSVs públicos do Google Sheets.
>
> **Quem pode usar:** basta estar logado.
> - `/contagem` redireciona ao login sem `session['usuario']` (app.py ~3840).
> - `/sb` exige a mesma sessão, aceita só tabelas da lista branca e recusa DELETE sem filtro (supabase_compat.py:49-64, 518-548, 709-722).
> - O sistema de permissões por view do Light (`PermissoesAcessoPage`, `appPermissions`, `light_usuarios.permissoes_views`) é **código morto**.
> - `isSuperuser` é injetado mas só é lido pela página morta (lib/authUser.ts:11).
>
> **Leitura de código de barras:** pela câmera (`getUserMedia` + `BarcodeDetector`; EAN-13/8, UPC, Code128/39, Codabar, ITF) e por leitor tipo teclado. Não há voz.
>
> **Exportação:** Excel com a lib `xlsx` (sem PDF, sem CSV de saída, sem impressão).

#### Light › Estrutura comum (shell e menu)
- Ler `view` da URL e trocar de tela sem recarregar (`history.replaceState`); o "voltar" do navegador relê a view — (App.tsx:60-69, 137-143, 175-187)
- Menu lateral recolhível (estado em localStorage) com Painel de Contagem, Contagem diária, Inventários, Temperatura, Ocupação, Estoque de segurança, Estoque & Shelf-Life, Cadastro Endereços, Catálogo de Produtos (submenu Produtos/Família/Grupos/SubGrupos/Importação de Planilha) e Agendamentos — (App.tsx:145-170; components/layout/ExpandableSidebar.tsx; lib/sidebarOpen.ts)
- Botão "← Módulos" (volta a `/entrada`) e "Sair" (`/login?sair=1`) — (components/layout/AppHeader.tsx:155-165, 213-226; App.tsx:199-207)
- Alternar tema claro/escuro pelo rodapé e pelo item "Configurações" — (App.tsx:209-241; AppHeader.tsx:231-237; lib/appTheme.ts)
- Nome do usuário, "empresa / WMS PRO" e data/hora (atualiza a cada 30 s); selects Empresa/Cliente gravam só em localStorage e não filtram dados — (AppHeader.tsx:103-139, 241-255)
- Selo "Homologação" pelo host ou por `VITE_APP_AMBIENTE` — (AppHeader.tsx:172; lib/appAmbiente.ts)
- Capturar erro por tela e oferecer "Recarregar página" — (App.tsx:90-115)
- Proteção no cliente contra exclusão em massa (bloqueia delete sem filtro ou por data nas tabelas de contagem, inventário, presença, temperatura e ocupação) — (lib/supabaseDataProtection.ts:21-124)

#### Light › Painel de Contagem › Contagem diária (`?view=painel`, aba "Contagem diária")
- Filtro de período De/Até (padrão 14 dias) com Aplicar e Atualizar; chips de filtro ativo com Limpar — `contagens_estoque` — (pages/PainelPage.tsx:46-48, 271-313; lib/painelAnalyticsData.ts:82-160)
- KPIs Itens contados, Conferentes, SKUs distintos e Presença hoje (o clique filtra hoje) — `contagens_estoque`, `conferentes`, `contagem_diaria_presenca` (count) — (PainelPage.tsx:322-356; painelAnalyticsData.ts:170-176)
- KPIs Média/conferente e Pico no período (o clique filtra o dia do pico) — (PainelPage.tsx:406-420)
- Gráficos Volume por dia, Donut por conferente, Quantidade por dia e Top produtos — (PainelPage.tsx:363-400)
- Filtro cruzado ao clicar em barra ou fatia (dia, conferente, câmara, produto) — (PainelPage.tsx:203-218)

> Obs.: "Presença hoje" lê `contagem_diaria_presenca`, que só o código morto (`ContagemEstoque.tsx`) alimenta.

#### Light › Painel de Contagem › Inventário (aba interna)
- KPIs Linhas, Inventários abertos, Fechados e Conferentes — `contagens_inventario`, `inventario_sessoes` — (PainelPage.tsx:428-456; painelAnalyticsData.ts:133-168)
- Gráficos Capturas por dia, Por conferente, Quantidade por dia, Status das sessões, Linhas por câmara, Quantidade por câmara, Por rodada de contagem e Top produtos — (PainelPage.tsx:465-550)

#### Light › Contagem diária — lista e gestão (`?view=contagem`)
- Criar contagem num modal: nome (sugestões manhã/tarde/noite), local (padrão "ULTRAPAO GUARULHOS DISTRI"), data; o conferente é o usuário logado — `contagem_diaria_sessoes` (upsert) — (pages/ContagemGerenciar.tsx:231-263, 620-690; lib/contagemDiariaSessaoSupabase.ts:95-160)
- Editar nome, local e data — `contagem_diaria_sessoes` — (ContagemGerenciar.tsx:265-286)
- Começar/Continuar a contagem (abre a captura) — (ContagemGerenciar.tsx:288-290, 334)
- Finalizar contagem: fecha a sessão e copia as linhas para `contagens_estoque` (apaga por `finalizacao_sessao_id` e insere em blocos de 250); sem rede, vai para uma fila local — `contagem_diaria_sessoes`, `contagens_estoque`, `conferentes` — (ContagemGerenciar.tsx:340-358; lib/contagemDiariaFinalizeSync.ts:70-150, 281-298)
- Excluir contagem — `contagem_diaria_sessoes` — (ContagemGerenciar.tsx:309-321)
- "Entrar e alterar" uma contagem finalizada (reabre) e "Ver" em somente leitura — (ContagemGerenciar.tsx:292-307, 374, 377)
- Cadastrar conferente (o modal lista os existentes) — `conferentes` — (ContagemGerenciar.tsx:436-444; components/conferente/CadastroConferenteModal.tsx:20-60)
- Abas Todos / Abertos / Finalizados; busca por nome, local, nº, conferente ou dia; filtros Local e Data de/até; Atualizar — (ContagemGerenciar.tsx:69-81, 132-164, 433-511)
- Lista em tabela (desktop) e cards (mobile) com #, Nome, Local, Dia, Status, Contando, Linhas, Início, Fim — (ContagemGerenciar.tsx:530-600)
- Coluna "Contando": quem está na captura agora (consulta a cada 30 s) — `contagem_diaria_captura_presenca` — (ContagemGerenciar.tsx:119; lib/contagemDiariaCapturaPresenca.ts:67-111)
- Barra Online/Offline com produtos no catálogo offline e contagens aguardando envio — (ContagemGerenciar.tsx:400-416)
- "Preparar modo offline" (câmara fria sem internet): baixa até 15 mil produtos, conferentes, listas de endereço e de produto para o aparelho — `"Todos os Produtos"`, `conferentes`, `enderecamento_listas`, `produto_listas`, `inventario_sessoes` — (ContagemGerenciar.tsx:182-200; lib/prefetchContagemOfflineCatalog.ts:24-107)
- Envio automático da fila offline ao voltar a rede — `contagens_estoque` — (ContagemGerenciar.tsx:170-180; lib/contagemDiariaOfflineSync.ts:42-71)
- Modo local com aviso quando a tabela de sessões não existe — (ContagemGerenciar.tsx:420-426; lib/supabaseTableProbe.ts)

#### Light › Contagem diária — captura (`?view=contagemCaptura`, só pelo botão da lista)
- Cabeçalho com Voltar, chips Local/Data/Conferente e selo de pendências offline — (pages/ContagemCaptura.tsx:790-826)
- "Atualizar lista de produtos": usa a lista da sessão ou "Todos os Produtos" (até 5 mil), com cache offline — `produto_listas`, `"Todos os Produtos"` — (ContagemCaptura.tsx:251-312, 827-832)
- Endereço por código digitado ou bipado com máscara (ex.: 21-A-03-2), confirmado no Enter; aceita código fora da lista — (ContagemCaptura.tsx:482-522, 870-890)
- Cascata Câmara → Rua → Posição → Nível (a fonte `localStorage enderecamento-cadastro-v1` não é gravada por nenhum código vivo, então na prática fica vazia) — (ContagemCaptura.tsx:180-210, 524-560; lib/enderecamentoCascata.ts:40-56)
- Ler o código do endereço pela câmera — (ContagemCaptura.tsx:575-591, 893-905; components/barcode/BarcodeCameraScanner.tsx:11, 119-135)
- Produto por EAN, DUN, código ou descrição com sugestões; se não achar localmente, consulta o banco — `"Todos os Produtos"` — (ContagemCaptura.tsx:424-455, 593-615, 1015-1095; lib/fetchProductOptionByCodigo.ts:36-100)
- Ler o código de barras do produto pela câmera — (ContagemCaptura.tsx:1040-1048)
- Campos Quantidade, Unidade (automática), UP e Lote — (ContagemCaptura.tsx:1102-1135)
- Fabricação e Validade com calendário (fabricação até hoje; validade não anterior à fabricação) — (ContagemCaptura.tsx:1137-1180, 694-701)
- Salvar linha nova ou editada, com confirmação quando o endereço já está na sessão — `contagem_diaria_sessoes` (campo `linhas`) — (ContagemCaptura.tsx:666-760; lib/contagemDiariaSessaoStore.ts:414-462)
- Editar, cancelar edição e excluir linha — (ContagemCaptura.tsx:629-664, 1189, 1293-1300)
- "Linhas salvas" em tabela/cards, com endereços repetidos em amarelo e paginação — (ContagemCaptura.tsx:1223-1330)
- Presença multiusuário (avisa a cada 45 s, lê os outros a cada 30 s) — `contagem_diaria_captura_presenca` — (ContagemCaptura.tsx:159-171, 390-415)
- Recarregar a sessão a cada 12 s para juntar linhas de outros aparelhos — (ContagemCaptura.tsx:380-389)
- Avisar a tela de Produtos qual lista está em uso (produto cadastrado lá aparece na captura) — (ContagemCaptura.tsx:336-356; lib/sessaoProdutoListaContext.ts)
- Somente leitura quando finalizada; envio da fila offline ao reconectar — (ContagemCaptura.tsx:314-322, 668-671, 842-846)

#### Light › Inventários — lista e gestão (`?view=inventarios`)
- Criar inventário (nome, local; conferente = logado), bloqueando nome repetido entre os abertos — `inventario_sessoes` — (pages/InventarioGerenciar.tsx:203-232; lib/inventarioSessaoStore.ts:216-240, 299-345)
- Editar nome e local (mesma checagem) — (InventarioGerenciar.tsx:234-262)
- "Começar inventário": escolher a lista de endereçamento e a lista de produtos (cria as listas padrão "CD Ultrapao guarulhos" se faltarem) — `enderecamento_listas`, `produto_listas`, `inventario_sessoes` — (InventarioGerenciar.tsx:282-323; components/inventario/InventarioIniciarModal.tsx:26-75)
- Continuar inventário (abre a captura) — (InventarioGerenciar.tsx:358)
- "Posições": escolher os endereços do inventário (nome do conjunto, busca, selecionar visíveis, limpar, salvar) — `inventario_sessoes.posicoesCodigos`, `enderecamento_listas` — (InventarioGerenciar.tsx:364; components/inventario/InventarioPosicoesModal.tsx:38-230)
- "Criar posições em lote" (câmara 11/12/13/21, rua, nível de/até, posição de/até, observação, substituir) — `enderecamento_listas` — (InventarioPosicoesModal.tsx:158-214, 270-370)
- "Recuperar linhas": junta as linhas guardadas no aparelho com o banco e mostra relatório — (InventarioGerenciar.tsx:325-345; inventarioSessaoStore.ts:540)
- Finalizar inventário: copia para `contagens_inventario` (substitui registros do mesmo endereço no mesmo dia) e grava `inventario_planilha_linhas`; sem rede, vai para a fila — (InventarioGerenciar.tsx:374-392; lib/inventarioSessaoFinalizeSync.ts:357-460; lib/inventarioUpsertOnFinalize.ts:101-226)
- Excluir inventário — `inventario_sessoes` — (InventarioGerenciar.tsx:265-280)
- "Entrar e alterar" (reabre) e "Ver" em somente leitura — (InventarioGerenciar.tsx:290-305, 412, 415)
- Atualizar lista e Cadastrar conferente — `conferentes` — (InventarioGerenciar.tsx:470-483)
- Abas Todos/Abertos/Finalizados, busca e filtros; tabela/cards com Posições, Status, Contando (`inventario_captura_presenca`) e Linhas — (InventarioGerenciar.tsx:488-640)
- Preparar modo offline, contador de pendências e envio automático — `contagens_inventario` — (InventarioGerenciar.tsx:183-200, 440-460; lib/inventarioOfflineSync.ts:42-71)

#### Light › Inventários — captura (`?view=inventarioCaptura`, só pelo botão da lista)
- Chips Local, Data, Posições, Endereçamento e Voltar — (pages/InventarioCaptura.tsx:923-975)
- Endereço restrito à lista de endereçamento e às posições escolhidas, com cascata montada da lista — `enderecamento_listas` — (InventarioCaptura.tsx:241, 428-470, 784-800)
- Ler endereço e produto pela câmera — (InventarioCaptura.tsx:690-707, 1036, 1183)
- Produto por EAN, DUN, código ou descrição, com consulta ao banco — `"Todos os Produtos"` — (InventarioCaptura.tsx:515-551)
- Quantidade, UP, Lote, Fabricação/Validade com as mesmas validações; endereço obrigatório; confirmação de endereço repetido — `inventario_sessoes` — (InventarioCaptura.tsx:784-880, 1241-1380)
- Editar e excluir linha; tabela com coluna Câmara; paginação — (InventarioCaptura.tsx:746-782, 1386-1495)
- Presença multiusuário e recarga da sessão a cada 12 s — `inventario_captura_presenca` — (InventarioCaptura.tsx:415-422, 480-505)
- Lista de produtos da sessão com cache offline e botão Atualizar — (InventarioCaptura.tsx:270-330, 969)
- Somente leitura quando fechado; selo de pendências offline — (InventarioCaptura.tsx:786-789, 933)

#### Light › Temperatura das Câmaras (`?view=temperatura`)
- Registrar temperatura: conferente, data e °C das câmaras 11, 12 e 13 (todas obrigatórias) — `contagem_temperatura_camaras` (insert), `conferentes` — (pages/ContagemDiariaAmbiental.tsx:3773-3777, 3824-3861, 4032-4092)
- Um gráfico de linha por câmara (até 2000 registros), com tooltip e ampliação em modal — (ContagemDiariaAmbiental.tsx:507-940, 3762-3771)
- Gráfico combinado das três câmaras, ampliável — (ContagemDiariaAmbiental.tsx:1390-1830, 4239)
- Data, hora e conferente do último registro do dia — (ContagemDiariaAmbiental.tsx:3916-3936)
- Histórico em tabela (Conferente, Data/horário, Câm. 11/12/13), 5 por página — (ContagemDiariaAmbiental.tsx:97-150, 4095-4130)

#### Light › Ocupação & Avarias (`?view=ocupacao`)
- Registrar ocupação: conferente, data, vagas vazias por câmara (11 = 138 posições, 12 = 134, 13 = 138; total 410) e "Avaria — acréscimo"; recusa vazias acima do total — `contagem_ocupacao_camaras` (insert) — (ContagemDiariaAmbiental.tsx:40-46, 3863-3914, 3548-3640)
- Resumo do dia salvo: ocupadas físicas, ocupação com avaria, % livre, saldo livre — (ContagemDiariaAmbiental.tsx:3971-3995, 3280-3380)
- Painel Avaria (quantidade e %) e cards "Média Ocupação Mês" / "Média Livre Mês" — (ContagemDiariaAmbiental.tsx:3380-3445)
- Resumo em rascunho recalculado enquanto digita — (ContagemDiariaAmbiental.tsx:3940-3969, 3643-3665)
- Tabela de histórico (vazias por câmara, avaria, livre, ocupadas, % com avaria) — (ContagemDiariaAmbiental.tsx:3667-3700)
- Gráfico combinado de ocupação (último lançamento de cada dia) — (ContagemDiariaAmbiental.tsx:78-95, 2194-2650)
- Gráficos individuais: % ocupada geral, % por câmara 11/12/13, avaria em quantidade e em % — (ContagemDiariaAmbiental.tsx:4352-4440)

#### Light › Estoque de Segurança › Estoque de segurança (`?view=seguranca`)
- Carregar os dados de uma planilha pública do Google (ID `1KBDdsl4…`, gid 1626679618) e o "Estoque Atual" da coluna D da aba "Estoque"; **não usa banco** — CSV do Google Sheets — (pages/EstoqueSeguranca.tsx:13-18, 544-620; lib/googleSheetsCsv.ts:394-397)
- Gráfico de pedidos (média e máximo de abril, média dos últimos 5 dias) — (EstoqueSeguranca.tsx:360-388)
- Gráfico de estoque ideal (máx/méd/mín) — (EstoqueSeguranca.tsx:420-448)
- Gráfico de dias de estoque com a cobertura calculada (estoque atual ÷ média de 5 dias) — (EstoqueSeguranca.tsx:450-484)
- Gráfico de posições (máx/méd/mín) — (EstoqueSeguranca.tsx:390-418)
- Gráfico de Estoque Atual — (EstoqueSeguranca.tsx:329-358)
- Gráfico semáforo por status (o clique filtra tudo) — (EstoqueSeguranca.tsx:486-531)
- Filtro global por SKU ou status, com Limpar — (EstoqueSeguranca.tsx:623-650, 756-770)
- Lista com formatação condicional, filtro por semáforo (Excedido/Verde/Amarelo/Vermelho/Analisar), coluna "Confiabilidade (decisão)" (PRODUZ / AVALIA / NÃO PRODUZ) e 15 por página — (EstoqueSeguranca.tsx:181-246, 1072-1210)
- Exportar a lista filtrada em Excel — (EstoqueSeguranca.tsx:276-294, 1085)
- Sininho com nº de itens Amarelo/Vermelho; modal de alertas com filtro e exportação em Excel — (EstoqueSeguranca.tsx:247-273, 738-750, 830-960)
- Abrir os alertas uma vez por dia e disparar notificação do navegador, com botão para permitir — Notification API — (EstoqueSeguranca.tsx:655-685, 962-970)
- Abrir a planilha de origem e ajuda sobre os gráficos — (EstoqueSeguranca.tsx:702, 733, 985-995)

#### Light › Estoque de Segurança › Shelf Life (aba interna)
- Carregar a planilha `1EoT2x4M…`, aba "CONTROLE SHELF LIFE", com Atualizar e Abrir planilha — CSV do Google Sheets — (components/ControleShelfLifePanel.tsx:18-19, 175-200, 380-395)
- Buscar por código ou texto e filtrar por status — (ControleShelfLifePanel.tsx:450-520, 570-580)
- Gráficos Semáforo, Shelf % por produto, Dias para vencer / dias de vida, Quantidade em estoque — (ControleShelfLifePanel.tsx:520-565)
- Lista (Código, Descrição, Un., Qtd., Fab., Venc., Shelf, D. vencer, D. vida, Shelf %, Status), 15 por página — (ControleShelfLifePanel.tsx:599-700)
- Exportar Excel `controle-shelf-life_<data>.xlsx` — (ControleShelfLifePanel.tsx:330-341, 603)
- Legenda das regras de shelf life — (components/ShelfLifeRegrasLegenda.tsx)

#### Light › Estoque de Segurança › Visão cruzada (aba interna)
- Cruzar o semáforo do estoque com o shelf life pelo código; cards de prioridade (Urgentes e demais) — Google Sheets — (components/VisaoCruzadaEstoqueShelfPanel.tsx:161-200, 340-395; lib/estoqueShelfCruzada.ts:101-230)
- Matriz clicável Estoque (pouco/ok/muito) × Shelf (boa/atenção/ruim) — (VisaoCruzadaEstoqueShelfPanel.tsx:405-470; estoqueShelfCruzada.ts:232-253)
- Busca e tabela com ação sugerida, com paginação — (VisaoCruzadaEstoqueShelfPanel.tsx:485-610)
- Exportar Excel `visao-cruzada-estoque-shelf_<data>.xlsx` e Atualizar shelf — (VisaoCruzadaEstoqueShelfPanel.tsx:250-262, 305, 322)

#### Light › Estoque › Consulta (`?view=estoque`; o Hub chama de "Estoque x Shelf-Life", mas não há shelf-life aqui)
- Escolher Tipo (Todos / Contagem diária / Inventário) e Data de/até (padrão 7 dias) e Carregar, ignorando rascunhos — `contagens_estoque`, `contagens_inventario`, `conferentes` — (pages/EstoqueConsulta.tsx:47-66, 162-234; lib/estoqueConsultaFetch.ts:52-100)
- Filtros por busca (código, descrição, lote), conferente e câmara/grupo 1-8 — (EstoqueConsulta.tsx:78-105, 192-237)
- Tabela (Data, Tipo, Código, Descrição, Qtd, Un., Lote, Validade, Conferente, Câmara, Rodada), 50 por página — (EstoqueConsulta.tsx:250-318)

#### Light › Estoque › Exportar Excel (aba interna; usa `pages/RelatorioContagem.tsx` em modo exportação)
- Escolher Tipo, Data de/até, "Carregar todas as datas", "Filtrar por dia" e Dia — (RelatorioContagem.tsx:2617-2710; EstoqueConsulta.tsx:150-158)
- Carregar: envia as filas offline, copia para o banco as sessões finalizadas que faltam e lista as finalizadas do período — `contagem_diaria_sessoes`, `inventario_sessoes`, `contagens_estoque`, `contagens_inventario`, `inventario_planilha_linhas` — (RelatorioContagem.tsx:1580-1700; lib/exportSessoesList.ts:26-140)
- Avisos de contagem pendente de finalização no dia e de "Nenhuma contagem neste dia" — (RelatorioContagem.tsx:1549-1604, 3375-3465)
- Exportar Excel do período (contagem diária): aba "Contagem_diaria" consolidada por código → `relatorio-contagem_<período>.xlsx` — `contagens_estoque`, `v_contagem_diaria_itens_painel`, `inventario_planilha_linhas`, `"Todos os Produtos"` — (RelatorioContagem.tsx:1213-1270, 2077-2160)
- Exportar Excel do período (inventário): uma aba por rodada (1-4) → `relatorio-inventario_<período>.xlsx` — `contagens_inventario`, `inventario_planilha_linhas` — (RelatorioContagem.tsx:1959-2025, 2136-2153)
- Bloquear o Excel de um dia enquanto houver rascunho pendente — (RelatorioContagem.tsx:2088-2116)
- Exportar Excel de um inventário finalizado (`inventario_<...>.xlsx`, abas por rodada) — (RelatorioContagem.tsx:2166-2220, 3060-3070)
- Exportar Excel de uma contagem diária finalizada (`contagem-diaria_<...>.xlsx`) — (RelatorioContagem.tsx:2221-2275, 3115-3125)
- "Exportar relatório alteração DUN/EAN": base inteira com datas de alteração → `relatorio-base-todos-produtos_<stamp>.xlsx` — `"Todos os Produtos"` — (RelatorioContagem.tsx:2296-2370, 2728-2735)

#### Light › Cadastro de Endereços (`?view=enderecamento`)
- Tabela das listas de endereçamento salvas (Nome, Endereços, Atualizado em) — `enderecamento_listas` — (pages/CadastroEnderecamento.tsx:532-600)
- Abrir e fechar uma lista na área de trabalho — (CadastroEnderecamento.tsx:143-164, 570-580)
- Renomear lista — `enderecamento_listas` (upsert) — (CadastroEnderecamento.tsx:212-228)
- Excluir lista — `enderecamento_listas` (delete) — (CadastroEnderecamento.tsx:230-250)
- Nova lista e Salvar lista (cria ou atualiza) — (CadastroEnderecamento.tsx:138-141, 185-210, 613-630)
- Cadastro em lote: câmara, rua, nível de/até, coluna de/até, observação, "atualizar os que já existirem" — (CadastroEnderecamento.tsx:458-510, 675-790)
- Exclusão em massa por nível, rua, câmara ou todos (dupla confirmação para "todos") — (CadastroEnderecamento.tsx:326-420, 790-885)
- Cadastro individual (código ex. 11-A-05-02, câmara, rua, posição, nível, observação), editar e cancelar — (CadastroEnderecamento.tsx:423-456, 889-945)
- Tabela de endereços com filtro, editar/excluir e 30 por página — (CadastroEnderecamento.tsx:950-1030)
- Criar a lista padrão "CD Ultrapao guarulhos" e migrar uma vez o localStorage legado — (lib/enderecamentoListaSupabase.ts:104-118)

#### Light › Catálogo de Produtos › Produtos (`?view=produtos`)
- "Novo produto" (lista de destino, código, descrição, unidade, EAN, DUN); grava no catálogo e nas listas vinculadas — `"Todos os Produtos"` (insert), `produto_listas` (upsert) — (pages/BaseProdutos.tsx:261-290, 906-1040, 1468-1575)
- Tabela das listas de produtos salvas: Abrir, Fechar — `produto_listas` — (BaseProdutos.tsx:310-334, 1095-1170)
- Renomear e excluir lista de produtos — `produto_listas` — (BaseProdutos.tsx:366-405)
- Área de trabalho: Nova lista, "Carregar base do Supabase" (até 20 mil) e "Salvar lista" — (BaseProdutos.tsx:305-365, 440-470, 1177-1200)
- Buscar por código, EAN, DUN ou descrição; bipar EAN/DUN pula para a aba certa — (BaseProdutos.tsx:536-553, 597-645, 1225-1245)
- Escolher o conferente registrado nas alterações de EAN/DUN — `conferentes` — (BaseProdutos.tsx:405-415, 1246-1262)
- Abas por família ("Todos (n)", "Fam. XX (n)") — (BaseProdutos.tsx:28, 530-572, 1285-1295)
- Editar a linha (descrição, unidade, EAN, DUN) e salvar, gravando data/hora/conferente da alteração de EAN e DUN e atualizando as listas — `"Todos os Produtos"` (update), `produto_listas` — (BaseProdutos.tsx:574-590, 668-838, 1395-1430)
- Excluir produto do catálogo — `"Todos os Produtos"` (delete) — (BaseProdutos.tsx:839-905)
- Paginação de 25 e faixa "lista X" quando se chega vindo de uma captura — (BaseProdutos.tsx:1100-1110, 1440-1455)

#### Light › Catálogo de Produtos › Família (`?view=produtosFamilia`)
- Cadastrar/editar família (código, nome, ativo), buscar, excluir e limpar o formulário. **Grava só no localStorage do navegador** (`produto-familias-v1`) — (pages/ProdutosFamilia.tsx:10-27; pages/ProdutoClassificacaoPage.tsx:60-190; lib/produtoClassificacaoStore.ts:24-45)

#### Light › Catálogo de Produtos › Grupos (`?view=produtosGrupos`)
- Cadastrar/editar grupo ligado a uma família, buscar, excluir — localStorage `produto-grupos-v1` — (pages/ProdutosGrupos.tsx:11-47)

#### Light › Catálogo de Produtos › SubGrupos (`?view=produtosSubGrupos`)
- Cadastrar/editar subgrupo ligado a um grupo, buscar, excluir — localStorage `produto-subgrupos-v1` — (pages/ProdutosSubGrupos.tsx:20-22)

#### Light › Catálogo de Produtos › Importação de Planilha (`?view=produtosImportacao`)
- Escolher o destino: "Nova lista" (com nome) ou "Lista existente" — `produto_listas` — (pages/ProdutosImportacaoPlanilha.tsx:249, 414-468)
- Enviar .xlsx/.xls/.csv e ver a prévia (Código, Descrição, Un., EAN, DUN) — (ProdutosImportacaoPlanilha.tsx:36-80, 276-300, 520-550)
- Opção "Atualizar existentes em Todos os Produtos" (descrição, EAN, DUN pelo código) — (ProdutosImportacaoPlanilha.tsx:494-500)
- Importar: insere os novos (e atualiza os existentes, se marcado) e grava a lista — `"Todos os Produtos"`, `produto_listas` — (ProdutosImportacaoPlanilha.tsx:133-220, 302-390)
- Baixar o modelo `modelo-importacao-produtos.xlsx` — (ProdutosImportacaoPlanilha.tsx:221-243, 506)

#### Light › Agendamentos (`?view=agendamentos`)
- Listar as previsões de entrada do Hub destinadas ao Light (NF/Pedido, Cliente·Portal, Status, Data, Placa, Volumes, Protocolo); só leitura — GET externo `https://dockhub-api.onrender.com/api/public/wms/previsoes?wms=light` — (pages/AgendamentosHub.tsx:16-110; lib/hubIntegracao.ts:36-53)
- Botão Atualizar e recarga automática a cada 60 s — (AgendamentosHub.tsx:35-45, 66-70)

#### Light › Permissões (`?view=permissoes`, só pela URL)
- A view é aceita, mas nada é renderizado (tela em branco dentro do shell) — (App.tsx:57, 263-328)

---

## 5. Proposta de organização por processo do armazém

Todas as telas das seções 1 a 4 aparecem abaixo, reagrupadas por etapa. Siglas de origem: **[PRO]** Pro operacional, **[WMS]** Pro › Endereçamento WMS, **[PLUS]**, **[LIGHT]**, **[SHELL]** entrada unificada (seção 1). O Financeiro 3PL não cabe em nenhuma das etapas pedidas; ficou em "Relatórios/Indicadores" como subetapa "Faturamento 3PL", mas pode virar uma etapa própria.

### 5.1 Recebimento

| Funcionalidades | Origem | Nota para a fusão |
|---|---|---|
| Agendamento de doca, check-in na portaria, vagas e mapa do pátio | [WMS] YMS | Único agendamento local (`yms_agendamento`); sem ligação com o recebimento |
| Previsões de entrada do Hub externo (dockhub) | [WMS] Agendamentos (`wms=pro`), [PLUS] Agendamentos (`wms=plus`), [LIGHT] Agendamentos (`wms=light`) | 3 telas para a mesma API; fundir numa só com filtro de destino. Só o Plus atalha para a entrada ("Subir XML", "Cadastrar NF") |
| ASN (cabeçalho) | [WMS] ASN | Sem itens nem vínculo com o recebimento |
| Upload de XML de NF-e (recebimento, carreta, consumível SP) | [PRO] Terceiros › 1° Enviar XML | Parser no servidor; casa os itens com `base_codigo_barras` |
| Upload de XML de NF-e de entrada, NF manual, destino Armazém/Stage, edição de lote/validade/paletes, desmembrar, finalizar ou cancelar entrada | [PLUS] Entrada | Parser no navegador (`lib/parseNfeXml.ts`); grava `ultrafrio_*` |
| Fila de NFs a receber, detalhe da descarga, DANFE, XML, comprovante de descarga, motivo por item, excluir NF | [PRO] Terceiros › 2° Pendência e 3° Fornecedores recebidos | A "conferência" virou espelho do WMS |
| Conferência física por NF: bipagem EAN/SKU, montagem de palete, classificação bom/avaria/descarte/bloqueado, etiqueta de palete, finalizar/reiniciar/excluir | [WMS] Recebimento | Já integrado a Terceiros (`terceiros_documento_id`) |
| Modo de conferência (total/parcial/cego) | [WMS] Config RFQ | Só o modo de conferência tem efeito |
| Status de qualidade do lote (quarentena/aprovado/reprovado) | [WMS] QA Lote | Não bloqueia nada hoje |
| NF-e cancelada: upload do XML de cancelamento, vincular à substituta, excluir | [PLUS] NF cancelada | Só existe no Plus |
| Escrituração e transferência para MG: lançada sim/não, enviar para MG, motorista/placa de saída, recebida em MG, histórico | [PRO] Terceiros › 4° a 8° e Histórico | Fluxo fiscal pós-recebimento; e-mail consumível SP parado |
| Painel do recebimento (14 cards, 8 gráficos) e sino de NFs paradas | [PRO] Terceiros › Painel; barra do `/painel` | — |

### 5.2 Armazenagem / Endereçamento

| Funcionalidades | Origem | Nota para a fusão |
|---|---|---|
| Putaway sugerido (zoneamento por categoria) e confirmação da guarda por bipagem da longarina | [WMS] Recebimento, Movimentações (pendentes) | Único putaway com regra |
| Seleção manual de endereços no mapa ao dar entrada (N paletes = N endereços) | [PLUS] Entrada + Mapa de Câmaras | Sem regra de putaway |
| Transferência de palete, conclusão de movimentação pendente, histórico de movimentações | [WMS] Movimentações | — |
| Reposicionar, enviar ao stage, tirar do stage, adicionar posições, remover do estoque com motivo, movimentar por voz | [PLUS] Movimentação | A voz só existe no Plus |
| Saída e retorno de palete com motivo (auditoria, manutenção etc.), paletes fora | [WMS] Controle Paletes | — |
| Cadastro e geração de endereços: layout JSON + `/layout/gerar`, sequência de rota (serpentina), zoneamento | [WMS] Painel, Localizações | Sem CRUD de endereço; layout em arquivo |
| Listas de endereços (lote, individual, exclusão em massa) | [LIGHT] Cadastro de Endereços; posições em lote em [LIGHT] Inventários | Mesmas câmaras 11/12/13/21 do WMS, em outra tabela |
| Layout das câmaras 6-10 | [PLUS] Mapa (fixo em `layout/camaras.ts`) | Sem cadastro |
| Etiquetas de longarina (todas, por câmara, coluna, avulsa, modelo, teste Zebra) | [WMS] Etq. Longarina, Localizações | Única impressão de etiqueta de endereço |
| Etiqueta de palete | [WMS] Recebimento | — |
| Mapas: planta 2D, 3D com rota até a posição, itens por câmara | [WMS] Endereçamento 2D/3D, Mapa 3D | Dois visualizadores 3D no próprio Pro |
| Mapa interativo de câmaras, cards por câmara, NFs/produtos da câmara, área STAGE | [PLUS] Mapa de Câmaras | — |
| Impressão do mapa preenchido ou em branco | [PLUS] Mapa (Imprimir) | — |

### 5.3 Estoque / Inventário / Contagem

| Funcionalidades | Origem | Nota para a fusão |
|---|---|---|
| Estoque endereçado por SKU/lote/UP/endereço | [WMS] Produtos, Pesquisa SKU | — |
| Consulta de estoque por NF/item/remetente/lote; inventário completo por NF; adicionar/replicar/excluir item de NF | [PLUS] Consulta estoque | Estoque por NF, não por SKU |
| Saldo por bipagens (entradas de devolução/terceiros − expedição) e resumos por classificação | [PRO] Estoque SP (8 abas) | Recebe lançamentos do WMS |
| Consulta das contagens e inventários registrados | [LIGHT] Estoque › Consulta | — |
| Inventário por snapshot do WMS: bipar, divergências/extras, aplicar na base | [WMS] Inventário | — |
| Inventário por sessões: listas de endereço/produto, posições, captura por câmera, presença multiusuário, offline, rodadas 1-4, finalizar/reabrir | [LIGHT] Inventários (lista e captura) | Mais completo em campo; não atualiza estoque |
| Contagem diária: sessões, captura por câmera, presença, offline, finalizar/reabrir, cadastrar conferente | [LIGHT] Contagem diária (lista e captura) | Só existe no Light |
| Temperatura das câmaras 11/12/13 | [LIGHT] Temperatura | Só existe no Light |
| Ocupação calculada pelo banco | [WMS] Ocupação; [WMS] Painel (barras por câmara); [PLUS] cards/KPIs | — |
| Ocupação e avaria digitadas por câmara | [LIGHT] Ocupação & Avarias | Mesmas câmaras 11/12/13 do WMS |
| Estoque de segurança, Shelf Life e Visão cruzada | [WMS] Estoque Seg., Shelf Life, Visão Cruzada (banco); [LIGHT] Estoque de Segurança (3 abas, Google Sheets) | Mesmos nomes e regras, fontes diferentes |

### 5.4 Separação / Expedição

| Funcionalidades | Origem | Nota para a fusão |
|---|---|---|
| Importação de romaneios do Ravex (período, ID, lista) e histórico/exclusão de importações | [PRO] Carregamento › Importar Ravex, Baixados | Exclusão em cascata |
| Lista de separação por roteiro/viagem (PICKING → PULMÃO, FIFO), bipagem para stage, validação de saída | [WMS] Separação | Lê `romaneio_por_item` do Carregamento |
| Ondas de picking e ordenação de rota | [WMS] PICKING+ | Sem execução |
| Conferência de carregamento: doca, placa/motorista, responsáveis, bipagem com rascunho, classificação, vínculo de código, comprovante | [PRO] Carregamento › Conferência | — |
| Extrato do carregamento (imprimir/excluir), romaneio por item, divergências com motivo e impressão | [PRO] Carregamento › Extrato, Romaneio, Divergências | — |
| Saída por NF/XML de saída: paletes, saída parcial, stage, motivo, finalizar | [PLUS] Saída | Saída fiscal das câmaras |
| Cross-dock | [WMS] Verticais | Stub |

### 5.5 Devoluções

| Funcionalidades | Origem | Nota para a fusão |
|---|---|---|
| Conferência do retorno por NF divergente (Ravex ao vivo): motivo, doca, bipagem com classificação, concluir/cancelar NF, zerar | [PRO] Devoluções › Conferência | Cópia do Carregamento com `fluxo=devolucao` |
| Painel, extrato, relatórios Excel e divergências do retorno | [PRO] Devoluções › Painel, Extrato, Relatórios, Divergências | — |
| Baixados (Ravex) dentro de Devoluções | [PRO] Devoluções › Baixados | Mesma lista do Carregamento; o Excluir apaga o carregamento |
| Reentregas, avaria, descarte/perdas, palete bloqueado | [PRO] Estoque SP | — |
| Motivo de saída "Devolução de remessa" | [PLUS] Saída | — |

### 5.6 Relatórios / Indicadores

| Funcionalidades | Origem | Nota para a fusão |
|---|---|---|
| Painel de expedição (6 seções, ~30 gráficos) | [PRO] Carregamento › Painel | — |
| 12 relatórios Excel do carregamento + 3 de divergências | [PRO] Carregamento › Relatórios | Excel gerado no servidor |
| 6 relatórios Excel de devolução | [PRO] Devoluções › Relatórios | — |
| 22 relatórios Excel de terceiros | [PRO] Terceiros › Relatórios | — |
| Painel WMS (KPIs, ocupação, categorias) e 10 relatórios WMS em CSV | [WMS] Painel, Relatórios | CSV gerado no navegador |
| Histórico detalhado da NF no WMS | [WMS] Histórico NF | — |
| Cobertura RFQ | [WMS] Config RFQ | — |
| Painel de câmaras (4 KPIs, 13 gráficos), relatório de notas/itens em CSV e impressão, histórico de movimentos | [PLUS] Painel, Relatório, Histórico | — |
| Painel de contagem e de inventário; exportações Excel de contagens, inventários e base EAN/DUN | [LIGHT] Painel de Contagem, Estoque › Exportar Excel | Excel gerado no navegador (`xlsx`) |
| Assistente IA / voz para consultas e navegação | [PLUS] IA DOCA LIVRE | — |
| **Faturamento 3PL:** tabelas de cobrança, contratos, clientes, permanência, lógica de cobrança, CSV | [PLUS] Financeiro 3PL (5 abas) | Cálculo completo |
| **Faturamento 3PL:** depositante, tarifa, fatura rascunho manual, portal stub | [WMS] 3PL | Esqueleto sem cálculo |

### 5.7 Cadastros

| Funcionalidades | Origem | Nota para a fusão |
|---|---|---|
| Base de produtos/códigos de barras (CRUD) e vínculo de código durante a bipagem | [PRO] Carregamento › Base, Conferência | `base_codigo_barras` |
| Catálogo de produtos, listas de produtos, importação por planilha, alteração de EAN/DUN | [LIGHT] Catálogo › Produtos, Importação | `"Todos os Produtos"` + `produto_listas` |
| Família, Grupo, SubGrupo | [LIGHT] Catálogo | Só em localStorage |
| Parâmetros de endereçamento por produto (categoria, posições médias, shelf_dias) | [WMS] (só por script) | Sem tela |
| Conferentes | [LIGHT] Contagem/Inventários | — |
| Placas, motoristas, colaboradores (só sugestões) e responsáveis por viagem | [PRO] Conferência | APIs CRUD sem tela |
| Remetentes (automático) e clientes financeiros | [PLUS] Entrada, Financeiro › Clientes | — |
| Depositantes, depósitos, bobinas | [WMS] 3PL, Config RFQ, Verticais | — |
| Vozes cadastradas | [PLUS] (sem tela viva) | — |

### 5.8 Administração / Permissões

| Funcionalidades | Origem | Nota para a fusão |
|---|---|---|
| Login, sair, F5 → login, splash, PWA, banner de homologação | [SHELL] Login, Hub | — |
| Hub de módulos com busca, favoritos e recentes | [SHELL] Hub | Base natural do menu único |
| Cadastro e listagem de usuários | [SHELL] `/usuarios/novo` [SU] | Sem editar/excluir/trocar senha |
| Hierarquia de organizações, grupos, vínculo usuário-empresa, matriz de permissões por sistema e tela | [PLUS] Hierarquia & Permissões [SU] | Aplicada só no Plus |
| Login interno, cadastro por código de e-mail [SU], esqueci a senha, SSO | [PLUS] Login interno; [SHELL] SSO | "Esqueci a senha" só existe aqui |
| Permissão Editar/Visualizar por tela | [PLUS] (aplicada no cliente) | Pro e Light não aplicam |
| Zerar banco de homologação | [PLUS] Barra superior | Sem checagem de papel |
| Tema claro/escuro, layout do menu, troca de "usuário ativo" | [PLUS], [LIGHT] | — |
| Health check, diagnóstico Ravex e diagnóstico/teste de e-mail | [SHELL] `/api/health`; `/api/ravex-env-check`; `/api/terceiros/email/*` | Os dois últimos sem tela |

---

## 6. Sobreposições

Funções duplicadas ou parecidas que precisarão ser fundidas, das mais importantes para as menores.

1. **Três cadastros de endereços/layout sem ligação.**
   - [WMS] `wms_localizacao` gerada de `data/wms_layout_camaras.json` (câmaras 11, 12, 13, 21, 98, 99; código `12-C-14-1` e bipagem `12.14.1*47`), sem CRUD na tela.
   - [LIGHT] `enderecamento_listas` (listas JSON, câmaras 11/12/13/21, código `11-A-05-02`), com CRUD completo.
   - [PLUS] câmaras 6-10 fixas em `layout/camaras.ts`, com ocupação em `ultrafrio_enderecamentos`.
   - O WMS e o Light descrevem as **mesmas câmaras 11/12/13/21** em tabelas e formatos de código diferentes.
2. **Quatro bases de produto.**
   - [PRO] `base_codigo_barras` (+ `excel_datasets`), com CRUD e vínculo na bipagem.
   - [WMS] `wms_produto_enderecamento` (categoria, planejamento, shelf), carregada só por script.
   - [LIGHT] `"Todos os Produtos"` + `produto_listas` + Família/Grupo/SubGrupo em localStorage.
   - Tabela `produtos`, liberada no `/sb` mas sem uso.
   - O [PLUS] não tem catálogo: usa texto livre da NF.
   - Edição de EAN/DUN existe no Pro (vínculo de código) e no Light (com auditoria de alteração).
3. **Entrada de NF-e em dois mundos.**
   - [PRO] Terceiros (XML no servidor, `terceiros_documentos`) + [WMS] Recebimento (bipagem, palete, putaway).
   - [PLUS] Entrada (XML no navegador, `ultrafrio_notas_fiscais`, endereçamento manual no mapa).
   - Mais o ASN do RFQ, que é um cabeçalho solto.
   - São dois parsers de NF-e, dois cadastros de emitente/remetente e duas noções de "NF recebida".
4. **Inventário e consulta de estoque em quatro lugares.**
   - Inventário: [WMS] (snapshot + aplicar na base) × [LIGHT] Inventários (sessões, rodadas, câmera, offline, presença, sem efeito no estoque). O "Inventário completo" do [PLUS] é só consulta.
   - Consulta de estoque: [WMS] Produtos/Pesquisa SKU (palete endereçado), [PRO] Estoque SP (saldo por bipagens), [PLUS] Consulta (por NF), [LIGHT] Estoque › Consulta (contagens).
   - Não há um saldo único.
5. **Ocupação, Estoque de segurança, Shelf Life e Visão cruzada duplicados entre [WMS] e [LIGHT].**
   - Mesmos nomes, mesmo semáforo (Excedido/Verde/Amarelo/Vermelho), mesma matriz 3×3 estoque × shelf.
   - O WMS calcula do banco; o Light lê planilhas do Google Sheets (segurança/shelf) e vagas digitadas (ocupação).
   - Ocupação aparece ainda no [WMS] Painel e nos cards/KPIs do [PLUS].
6. **Agendamentos: três telas para a mesma API.** `dockhub-api /api/public/wms/previsoes?wms=pro|plus|light`, mais o YMS local do WMS (`yms_agendamento`), que não conversa com elas.
7. **Painéis/KPIs em pelo menos sete telas:**
   - [PRO]: Carregamento › Painel, Devoluções › Painel, Terceiros › Painel, mais `/api/estatisticas`;
   - [WMS] Painel; [PLUS] Painel; [LIGHT] Painel de Contagem.
   - Cada um tem seu filtro de período e sua biblioteca de gráfico.
8. **Movimentação, stage e saída de palete.**
   - [WMS] Movimentações, Controle Paletes e Separação (stage = câmara 99).
   - [PLUS] Movimentação, área STAGE e Saída.
   - Os dois têm "stage", "saída de palete" e "histórico de movimentos" com modelos diferentes.
9. **Motor de bipagem/conferência repetido:**
   - [PRO] Carregamento (rascunho local) e Devoluções (gravação imediata), quase idênticos;
   - [WMS] Recebimento, Inventário e Separação;
   - [LIGHT] Contagem e Inventário (com câmera).
   - A leitura de código também difere: o Pro usa só leitor-teclado, o Light usa câmera e o Plus não lê código.
10. **Financeiro 3PL duplicado:** [PLUS] Financeiro (tabelas, contratos, clientes, cálculo, CSV) × [WMS] 3PL (depositante, tarifa, fatura rascunho manual).
11. **Login, cadastro e senha em quatro lugares:**
    - [SHELL] `/login` + `/usuarios/novo`;
    - [PLUS] PortalLoginScreen (login, cadastro por código, esqueci a senha);
    - [LIGHT] LoginScreen (morto);
    - `templates/portal.html` (morto, com "Cadastrar-se").
12. **Permissões:**
    - o catálogo `portal_permissoes.py` cobre os 3 sistemas, mas só o [PLUS] aplica;
    - o [LIGHT] tem um sistema próprio morto (`light_usuarios.permissoes_views`);
    - o [PRO] não tem nenhum.
    - A tela de Hierarquia & Permissões serve aos 3 sistemas, mas mora dentro do bundle do Plus.
13. **Pessoas e empresas espalhadas:**
    - usuários: `usuarios` (Pro), `light_usuarios`;
    - pessoas da operação: `conferentes` (Light), `colaboradores`/`motoristas`/`placas` (Pro), responsáveis por viagem (texto), motorista/placa de carreta e de MG (texto);
    - vozes: `ultrafrio_voz_cadastros`;
    - empresas: `ultrafrio_cadastro_remetentes`, `ultrafrio_fin_clientes`, organizações da hierarquia (com CNPJ), `wms_depositante`, `wms_empresa`/`wms_deposito`, remetentes de `terceiros_documentos`.
14. **Classificação avaria / descarte / palete bloqueado** lançada em 4 pontos (Carregamento, Devoluções, WMS Recebimento, Estoque SP), mais a "avaria" digitada na Ocupação do Light.
15. **Histórico de NF/movimentos:** [WMS] Histórico NF, [PRO] Terceiros › Histórico, [PLUS] Histórico.
16. **Exportação e impressão com mecanismos diferentes:**
    - Excel no servidor (Pro), CSV no navegador (WMS e Plus), `xlsx` no navegador (Light);
    - `window.print` próprio em extrato, divergências, comprovante de descarga, relatório do Plus, mapa do Plus e etiquetas do WMS.
17. **Tempo real com três técnicas:** SSE (Pro), consulta a `/sb/changes` (Plus) e intervalos próprios por tela (Light: 12, 30 e 45 s; Estoque SP: 30 s).
18. **Shell de interface triplicado:** três barras superiores e menus laterais, três "← Módulos", tema claro/escuro só no Plus e no Light, três relógios.

---

## 7. Código morto / não ligado

Telas, rotas e arquivos que existem no código mas não são alcançáveis pela interface. A evidência está entre parênteses (grep sem resultado ou condição que nunca é verdadeira).

### 7.1 Entrada unificada (Flask, templates e estáticos)
- **Templates mortos:**
  - `templates/portal.html`: nenhuma rota o renderiza. O endpoint `portal` aparece na lista de rotas públicas (app.py:2302, 2392), mas não existe. Ele tinha login + "Cadastrar-se" + seletor de sistemas.
  - Só incluídos por esse template morto: `_portal_company_splash.html`, `_portal_system_selector.html`, `_portal_system_entry.html`.
  - `templates/_stock_system_splash.html`: nenhum template o inclui.
- **Estáticos usados só pelo `portal.html`:** `static/system-portal.js`, `static/system-portal.css`, `static/portal-login.js`.
- **Estáticos não referenciados** em templates, `app.py` ou outros estáticos: `static/stock-system-intro.js`, `static/stock-system-icon.svg`, `static/stock-system-logo.svg`, `static/logo.png`, `static/wms-planta-2d-referencia.svg` (só gerado por `scripts/gen_planta_svg.py`).
- **Rotas sem chamador:**
  - POST `/api/logout`: o "Sair" usa `/login?sair=1`.
  - GET `/api/portal/config/catalogo`, `/api/portal/config/org/filhos`, `/api/portal/config/org/visiveis`.
  - POST `/api/sso/issue`: só chamada pelo código morto do Plus (`handleSystemSelect`). Com isso, GET `/sso/entrar` também fica sem uso prático.
  - GET `/api/ravex-env-check`: pública e sem chamador.
- **Restos de pastas e arquivos:**
  - `backend/` só contém `__pycache__`.
  - `config_usuarios.py` é carregado só como legado opcional (app.py:880-891).

### 7.2 Pro — módulos operacionais
- **Rotas sem chamador:**
  - Diagnóstico e consultas soltas: GET `/api/debug-romaneio-headers`; GET `/api/extrato` (o Extrato usa `/api/conferencia/<id>`); GET `/api/viagem/<id>/data-expedicao`; GET `/api/relatorios/excel/bipados_periodo` (nenhum botão).
  - Colaboradores: GET/POST `/api/colaboradores`, PUT/DELETE `/api/colaboradores/<id>` e POST `/api/colaboradores/importar-planilha`. **Não existe tela de cadastro de colaboradores, motoristas ou placas.**
  - E-mail: GET `/api/terceiros/email/diagnostico` e POST `/api/terceiros/email/teste`.
  - Legado de romaneio e produtos:
    - POST `/api/romaneio` (tabela legada `romaneio`), só chamada por `window.updateRomaneio`, que ninguém chama;
    - GET `/api/produtos` e PUT/DELETE `/api/produtos/<id>`, só por `openEditModal`/`updateProduto`/`deleteProduto`/`loadProdutos`, sem chamador; o modal `#edit-modal` (index.html:3899) nunca abre.
  - Painéis antigos: GET `/api/painel-graficos` e `/api/painel-graficos-extras`, só por `loadPainelGraficos` (script.js:20829), sem chamador.
  - GET `/api/conferencia` sem ID: sempre responde 400.
- **Bipagem de terceiros no Pro (morta, migrou para o WMS):**
  - POST `/api/terceiros/documentos/<id>/bipar`, `/desbipar` e `/zerar-bipagem`;
  - `initTerceirosBipagemForm` (script.js:17774) nunca é chamada, e `#form-ter-bipagem` não existe no HTML.
- **Conclusão manual de recebimento:**
  - `campo=recebimento_concluido`: o botão `#btn-ter-rec-concluir` está sempre desabilitado;
  - com isso o e-mail de consumível SP não dispara mais;
  - `marcarRecebimentoConcluidoTerceiros` (script.js:18248) não tem chamador.
- `upload-xml` com `area=expedicao`: a interface só envia `recebimento` e `carreta`.
- **JS sem elemento correspondente:**
  - Hub antigo: `initHubModulosOverlay`, `_mostrarHubModulos`, `_ocultarHubModulos` (script.js:2799-2852) e `.modulo-button` (script.js:3150).
  - Funções vazias ou sem chamador: `initCadastroRapidoCodigoBarras` (vazia), `gerarComprovanteCarregamento`, `bindTerceirosExcluirButtons` (stub). `appendParamsDataCriacaoTerceiros` está definida duas vezes (script.js:23746, 23752).
  - Selects `#ter-rec-nota-lancada`, `#ter-rec-enviar-mg`, `#ter-rec-recebida-mg` e o botão `#btn-ter-rec-motorista` não existem no HTML.
  - Modais mortos `#modal-terceiros-ir-notas-lancadas` e `#modal-terceiros-ir-recebimentos-mg`.
- `ravex_client.viagens_finalizadas_por_periodo` (importada e não usada) e `ravex_invalidar_token_cache` (nunca chamada).
- **Legado ainda exposto na interface:** "Importar planilha" do Painel grava a aba BASE em `produtos_bipados`, como se fossem bipagens, e o romaneio na tabela `romaneio`, que o resto do sistema não usa.
- **Parâmetro ignorado:** o `&aba=pendencia-recebimento` do Hub para Terceiros.

### 7.3 Pro — Endereçamento WMS e RFQ
- **Rotas `/api/wms` sem chamador:**
  - Paletes e putaway: GET/POST `/paletes`, POST `/putaway/sugerir`.
  - Painel: GET `/zoneamento` e GET `/sequencia-rota` (os dados chegam pelo `/painel`).
  - GET `/areas-especiais` (alias).
  - Etiquetas: GET `/etiqueta/zpl`, `/etiqueta/zebra` (legado), `/etiqueta/zebra/teste/zpl`, `/etiqueta/endereco/zpl`, `/etiqueta/enderecos/zpl`, `/etiqueta/endereco/csv`, `/etiqueta/enderecos/csv`, `/etiqueta/nf-itens`.
  - **Não existe impressão ZPL direta na interface atual.**
- **Exportação Excel inalcançável:** o parâmetro `formato=xlsx` das etiquetas nunca é enviado, então `wms_etiqueta_excel.py` e `data/wms/etiqueta_longarina_template.xlsx` não são usados pela interface.
- **Sub-ações sem interface:**
  - POST `/recebimentos` sem `acao`, com `conferir_palete` e com `iniciar_bipagem`;
  - `bip_etiqueta_palete` está listada (wms_enderecamento.py:57) mas não tem handler;
  - POST `/movimentacoes` sem `acao`;
  - `/inventarios` com `acao:'contar'` e os tipos `vazio_ocupado_*`;
  - `/paletes/controle?palete_id`;
  - **checklist de qualidade** (`wms_check_qualidade`): as perguntas vêm na API, mas a tela nunca as mostra e envia `respostas: []`;
  - `/painel?completo=1` nunca é enviado, por isso "Paletes fora" fica sempre 0.
- **Rotas `/api/rfq` sem chamador:** GET `/flags`, GET/POST `/events`, POST `/rfid/read`, POST `/carregamento/sequenciar`, GET `/kpis/wms` (placeholders), GET `/inventario/politica`, POST `/tpl/sla`. As tabelas `wms_usuario_deposito` e `rfq_epic_status` não são usadas.
- **Templates:**
  - `templates/wms/etiqueta_longarina_zebra.html`: só renderizado por `_pagina_zebra_longarina` (wms_enderecamento.py:10169), que nenhuma rota chama.
  - `templates/wms/etiqueta_tela_preview.css.html`: nenhum render nem include.
  - `templates/wms/etiquetas_produto_nf.html`: só por `/etiqueta/nf-itens`, chamada apenas por JS morto.
- **Kit Zebra legado:** `static/zebra/imprimir-zpl.js` só é carregado pelo template morto, e o kit `static/zebra/*` (.bat, .ps1, .zip, LEIA-ME) descreve uma etiqueta 60×40 mm e um botão que não existe mais.
- **Helpers Python não chamados:** `_redirect_etiqueta_zebra`, `_zpl_api_url_longarina`, `_zpl_api_url_palete`, `_pagina_zebra_longarina`.
- **Funções JS mortas:**
  - recebimento: `wmsCriarRecebimento` (script.js:10087), `wmsConferirPalete` (botão inexistente), `wmsImprimirEtiquetasNfTodos` e `wmsImprimirEtiquetaNfItem` (etiqueta de produto por NF), bind de `#btn-wms-novo-recebimento` (inexistente);
  - endereçamento: `loadWmsAreasEspeciais` e todo o renderizador 2D em canvas (`_wmsEndDraw*`, script.js:5514-5895) e `_wmsEndRenderPlantaRackSide`.
- **Sub-abas sem URL:** `?aba=mapa-3d` e `?aba=hub` caem no Painel (fora de `abasWms`, script.js:7013).
- **Telas que existem, mas são esqueleto (stub ou sem efeito):** Cross-dock (não grava nada), Portal do depositante (JSON vazio), Fatura 3PL (total digitado), QA Lote (não bloqueia), parâmetros RFQ além do modo de conferência, ASN sem itens, Ondas de picking sem execução.

### 7.4 Plus
- **Componentes e telas mortos:**
  - `components/CadastroVozPanel.tsx`: não importado por nenhum arquivo. Era a única tela para ligar o assistente de voz, cadastrar a voz individual (3 amostras), configurar a chave Gemini e listar vozes/comandos. Leva junto `hooks/useVoiceProfileEnrollment.ts`.
  - `components/IntroSplash.tsx` e `components/NfSidebar.tsx`: não importados.
  - `pages/SystemSelectorScreen.tsx`: importado em App.tsx:11, mas nunca renderizado. Com ele ficam mortos `handleSystemSelect` (único uso de `/api/sso/issue`) e `handleVoltarDoHub`.
  - `pages/SystemEntryScreen.tsx`, `components/CompanySplash.tsx` e `components/PortalLoadingOverlay.tsx`: inalcançáveis. As condições (`selectedSystemId` com `url`, `companyIntroDone=false`, `hubBusy=true`) nunca ocorrem. Com eles ficam sem uso `PortalBackButton` e `SystemProductMark`.
- **Voz e menu da conta:**
  - O assistente por palavra de ativação "ok estoque" está ligado, mas não pode ser ativado: depende de `localStorage ultrafrio-voice-prefs.enabled`.
  - Os itens "Configurar conta" e "Comando de voz" do menu da conta rolam até um elemento inexistente.
- **Estados e exports sem uso:**
  - estados gravados e nunca lidos em App.tsx: `isSuperUser`, `allowedSystemIds`, `hubErro`; `forceSystemsHub` é constante;
  - exports sem uso: `savePortalHierarquia`, `nextOrgChildType`, `PAINEL_GRAFICOS_FIXOS`, `CURRENT_SYSTEM_ID`;
  - a prop `onRemover` de `PainelGraficoCard` nunca é passada, então o botão "remover gráfico" fica morto.
- **Dados não persistidos:** o período de cobrança em massa do Financeiro não é gravado, e o `hubAgendamentoId` não é gravado.

### 7.5 Light
- **Páginas não importadas por nenhum arquivo** (grafo de imports a partir de `main.tsx`, conferido no bundle `static/wms-light/assets/index-3XgeBFaN.js`):
  - `pages/ContagemEstoque.tsx`, com 9.360 linhas;
  - `LoginScreen.tsx` (login/cadastro via `supabase.auth` e `/functions/v1/*`);
  - `PermissoesAcessoPage.tsx`;
  - `AcessoPendenteScreen.tsx`;
  - `SystemEntryScreen.tsx` e `SystemSelectorScreen.tsx`.
- **O que só existe no `ContagemEstoque.tsx` morto e se perderia:**
  - foto do produto pela câmera (`foto_base64`; a sincronização viva grava sempre `null`);
  - calculadora de quantidade com histórico por produto (`ChecklistCalculatorModal`);
  - contagem em formato checklist com "Finalizar só preenchidos" e "Finalizar pendentes com 0";
  - planilha de inventário por armazém (`InventarioPlanilhaTabela`, rodadas 1-4);
  - lista oficial do armazém lida da aba "Base Principal" do Google Sheets;
  - atualização automática de EAN/DUN após finalizar;
  - prévia do dia com editar, excluir e "apagar tudo";
  - presença por check-in (`contagem_diaria_presenca`);
  - tempo real por canais;
  - "Nova checklist em branco no mesmo dia";
  - rascunho no banco (`contagem_rascunho`).
- **Componentes usados só por código morto:**
  - `ChecklistCalculatorModal`, `inventario/InventarioPlanilhaTabela`, `inventario/inventarioPlanilhaArmazem`;
  - painéis antigos: `contagem/ContagemDiariaPainel`, `inventario/InventarioPainel`, `dashboard/WmsBarChart`;
  - marca e splash: `CompanySplash`, `OpeningSplash`, `BrandMark`, `PortalBackButton`, `SystemProductMark`.
- **Libs usadas só por código morto:**
  - permissões: `appPermissions`, `usuarioPermissoesStore` (`light_usuarios`);
  - portal e SSO: `consumePortalSso`, `portalGate`, `portalSso`, `systemPortal`, `splashSounds`;
  - contagem antiga: `offlineContagemSync`, `armazemBasePrincipalSheet`, `atualizarTodosOsProdutosEanDunAposFinalizacao`, `checklistFieldNavigation`, `datetime`, `inventarioPresenca`, `mergeContagemDiariaDoBanco`, `mergeInventarioDoBanco`;
  - tempo real: `subscribe*Realtime`. Por isso o `/sb/changes` nunca é chamado pelo Light;
  - painéis antigos: `painelContagemDiariaData`, `painelInventarioData`.
- **Trechos mortos em arquivos vivos:**
  - `RelatorioContagem.tsx` só é montado em modo exportação; ficam inalcançáveis o "Histórico de contagens" (`v_contagem_diaria_painel`), a edição/exclusão de linha e o `mode='dia'`;
  - funções de presença do dia em `contagemDiariaPresenca.ts`;
  - `conferentesStore.excluirConferente` e `ensureConferenteParaUsuario`.
- **Views sem navegação ou quebradas:**
  - `permissoes` não tem tela;
  - `contagemCaptura` e `inventarioCaptura` abertas pela URL ficam vazias, e abrir a captura não atualiza a URL.
- **Lacunas:**
  - a cascata de endereço da captura diária lê um localStorage que ninguém grava;
  - o KPI "Presença hoje" lê uma tabela que só o código morto alimenta;
  - o sino de notificações e "Minha conta" não têm ação;
  - `vite-plugin-pwa` está instalado, mas não configurado.
- **Tabelas liberadas no `/sb` e não usadas pelo Light vivo:** `contagem_ocupacao_avaria_camaras`, `sheet_outbox`, `sistema_protecao_dados`, `produtos`, `light_usuarios`.

---

## 8. Anexo: tabelas, endpoints e serviços externos

### 8.1 Tabelas por sistema
- **Pro operacional** (PostgreSQL da Azure, com espelho SQLite local):
  - expedição e bipagem: `produtos_bipados` (colunas `fluxo`, `disposicao_estoque`, `devolucao_nf_id`, `doca`), `romaneio_por_item`, `id_roteiros`, `ravex_importacoes`, `viagem_placa`, `viagem_motorista`, `viagem_responsaveis`, `viagem_periodo_bipagem`, `divergencia_motivo`, `devolucao_nota_fiscal`;
  - base de produtos: `excel_datasets`, `base_codigo_barras`;
  - pessoas e veículos: `colaboradores`, `motoristas`, `placas`;
  - terceiros: `terceiros_documentos`, `terceiros_documento_itens`, `terceiros_documento_eventos`;
  - legado e auditoria: `romaneio` (legado), `tabela_geral_dados`/`tabela_geral_snapshot` (auditoria);
  - acesso: `usuarios`.
- **Pro WMS:**
  - núcleo: `wms_camara`, `wms_localizacao`, `wms_zoneamento`, `wms_sequencia_rota`, `wms_produto_enderecamento`, `wms_palete`, `wms_palete_item`, `wms_palete_controle`, `wms_movimentacao`, `wms_recebimento`, `wms_recebimento_palete`, `wms_check_qualidade`, `wms_check_qualidade_resposta`, `wms_inventario`, `wms_inventario_linha`;
  - RFQ: `wms_empresa`, `wms_deposito`, `wms_usuario_deposito`, `wms_depositante`, `rfq_param_perfil`, `rfq_integration_event`, `wms_asn`, `wms_lote_qa`, `wms_picking_onda`, `yms_agendamento`, `yms_portaria_checkin`, `yms_patio_vaga`, `tpl_tarifa`, `tpl_fatura`, `tpl_sla_evento`, `wms_bobina`, `rfq_epic_status`.
- **Portal/administração:** `usuarios` e as tabelas de permissões, hierarquia, grupos, códigos de e-mail e tokens SSO criadas por `portal_permissoes.py`, `portal_hierarquia.py`, `portal_auth.py` e `sso_portal.py`.
- **Plus:**
  - NFs e estoque: `ultrafrio_notas_fiscais`, `ultrafrio_nf_itens`, `ultrafrio_enderecamentos`, `ultrafrio_movimentos`, `ultrafrio_notas_canceladas`, `ultrafrio_cadastro_remetentes`;
  - voz: `ultrafrio_voz_cadastros`;
  - financeiro: `ultrafrio_fin_tabelas`, `ultrafrio_fin_clientes`, `ultrafrio_fin_contratos`.
- **Light (código vivo):**
  - catálogo e pessoas: `"Todos os Produtos"`, `produto_listas`, `conferentes`;
  - contagem diária: `contagem_diaria_sessoes`, `contagem_diaria_captura_presenca`, `contagens_estoque`;
  - inventário: `inventario_sessoes`, `inventario_captura_presenca`, `contagens_inventario`, `inventario_planilha_linhas`;
  - endereços: `enderecamento_listas`;
  - câmaras: `contagem_temperatura_camaras`, `contagem_ocupacao_camaras`;
  - painel e exportação: `contagem_diaria_presenca` (só contagem), `v_contagem_diaria_itens_painel`.

### 8.2 Endpoints por sistema
- **Entrada/Admin:**
  - acesso: `/login`, `/`, `/entrada`, `/usuarios/novo`, `/config-portal`, `/api/login`, `/api/cadastrar`, `/api/usuarios`;
  - portal: `/api/portal/login`, `/api/portal/me`, `/api/portal/config/*`, `/api/portal/cadastro/*`, `/api/portal/senha/*`;
  - SSO: `/api/sso/issue`, `/api/sso/verify`, `/sso/entrar`;
  - infraestrutura: `/api/health`, `/supabase-config.json`, `/sw.js`, `/manifest.webmanifest`, `/sb/rest/v1/<tabela>`, `/sb/changes`.
- **Pro operacional:** 115 rotas em `app.py` (de `/api/eventos-stream` em diante), listadas nas seções 2.1 a 2.5. Os relatórios ficam em `/api/relatorios/excel/<12 nomes>` e `/api/terceiros/relatorios/excel/<22 nomes>`.
- **Pro WMS:** 33 caminhos `/api/wms/*` usados pela interface (de 45 declarados) e 21 caminhos `/api/rfq/*` usados (de 28 declarados).
- **Plus:** `/sb/rest/v1`, `/sb/changes`, `/supabase-config.json`, `/api/health`, `/api/portal/*`.
- **Light:** só `/sb/rest/v1`, mais os redirecionamentos `/entrada` e `/login?sair=1`.

### 8.3 Serviços externos
- **API Ravex** (`ravex_client.py`): importação de romaneios e NFs da viagem nas devoluções.
- **Meu Danfe** (`MEU_DANFE_API_KEY`): PDF da NF em Terceiros.
- **Resend/SMTP:** e-mail de consumível SP, hoje sem disparo.
- **Hub de agendamentos `dockhub-api.onrender.com`:** `/api/public/wms/previsoes?wms=pro|plus|light`.
- **Google Gemini:** IA do Plus.
- **Google Sheets (CSV público):** Estoque de Segurança e Shelf Life do Light.
- **CDNs:** Chart.js 4.4.1 e Three.js r128.
- **URL externa fixa no login interno do Plus:** `https://doca-livre-wms-pro.onrender.com/api/sso/verify`.


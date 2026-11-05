-- =============================================================================
-- MIGRAÇÃO UNIFICADA: WMS LIGHT + WMS PLUS + WMS PRO (Base Única no WMS Pro)
-- =============================================================================
-- Cria todas as tabelas, funções, triggers, índices, views e políticas RLS
-- dos módulos Light (Contagem, Inventário, Shelf-Life, Temperatura/Ocupação)
-- e Plus (Ultrafrio Câmaras, NF-e, Movimentos, Financeiro, Voz) no Supabase Pro.
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- =============================================================================
-- PARTE 1: MÓDULOS WMS LIGHT (Contagem, Inventário, Catálogo, Ambiental)
-- =============================================================================

CREATE SEQUENCE IF NOT EXISTS public."Todos os Produtos_id_seq";

CREATE TABLE IF NOT EXISTS public."Todos os Produtos" (
  id integer PRIMARY KEY DEFAULT nextval('public."Todos os Produtos_id_seq"'::regclass),
  codigo_interno text NOT NULL,
  descricao text NOT NULL,
  unidade text,
  unidade_medida text,
  ean text,
  dun text,
  foto_base64 text,
  ean_dun_alterado_em date,
  ean_alterado_em date,
  dun_alterado_em date,
  ean_alterado_em_hora timestamptz,
  ean_alterado_conferente text,
  dun_alterado_em_hora timestamptz,
  dun_alterado_conferente text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_todos_os_produtos_codigo_trim
  ON public."Todos os Produtos" USING btree (TRIM(BOTH FROM codigo_interno));
CREATE UNIQUE INDEX IF NOT EXISTS idx_todos_os_produtos_dun_unique
  ON public."Todos os Produtos" USING btree (dun)
  WHERE ((dun IS NOT NULL) AND (TRIM(BOTH FROM dun) <> ''::text));
CREATE UNIQUE INDEX IF NOT EXISTS idx_todos_os_produtos_ean_unique
  ON public."Todos os Produtos" USING btree (ean)
  WHERE ((ean IS NOT NULL) AND (TRIM(BOTH FROM ean) <> ''::text));

CREATE TABLE IF NOT EXISTS public.conferentes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nome text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.produtos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  codigo_interno text NOT NULL UNIQUE,
  descricao text NOT NULL,
  unidade_medida text,
  created_at timestamptz NOT NULL DEFAULT now(),
  data_fabricacao date,
  data_validade date,
  ean text,
  dun text
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_produtos_ean_unique
  ON public.produtos USING btree (ean) WHERE (ean IS NOT NULL);
CREATE UNIQUE INDEX IF NOT EXISTS idx_produtos_dun_unique
  ON public.produtos USING btree (dun) WHERE (dun IS NOT NULL);

CREATE TABLE IF NOT EXISTS public.contagens_estoque (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  data_hora_contagem timestamptz NOT NULL DEFAULT now(),
  produto_id uuid REFERENCES public.produtos(id) ON DELETE SET NULL,
  codigo_interno text NOT NULL,
  descricao text NOT NULL,
  unidade_medida text,
  quantidade_up numeric NOT NULL,
  lote text,
  observacao text,
  conferente_id uuid NOT NULL REFERENCES public.conferentes(id) ON DELETE RESTRICT,
  finalizacao_sessao_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  data_fabricacao date,
  data_validade date,
  ean text,
  dun text,
  up_adicional numeric,
  data_contagem date,
  contagem_rascunho boolean NOT NULL DEFAULT false,
  origem text DEFAULT 'contagem_diaria'::text,
  inventario_repeticao smallint,
  foto_base64 text,
  inventario_numero_contagem smallint,
  CONSTRAINT contagens_estoque_inventario_numero_contagem_chk
    CHECK ((inventario_numero_contagem IS NULL) OR ((inventario_numero_contagem >= 1) AND (inventario_numero_contagem <= 4)))
);

CREATE INDEX IF NOT EXISTS idx_contagens_estoque_conferente ON public.contagens_estoque USING btree (conferente_id);
CREATE INDEX IF NOT EXISTS idx_contagens_estoque_data ON public.contagens_estoque USING btree (data_hora_contagem);
CREATE INDEX IF NOT EXISTS idx_contagens_estoque_data_contagem ON public.contagens_estoque USING btree (data_contagem);
CREATE INDEX IF NOT EXISTS idx_contagens_estoque_finalizacao_sessao ON public.contagens_estoque USING btree (finalizacao_sessao_id) WHERE (finalizacao_sessao_id IS NOT NULL);
CREATE INDEX IF NOT EXISTS idx_contagens_estoque_produto ON public.contagens_estoque USING btree (produto_id);

CREATE TABLE IF NOT EXISTS public.contagens_inventario (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  data_hora_contagem timestamptz NOT NULL DEFAULT now(),
  data_contagem date,
  conferente_id uuid NOT NULL REFERENCES public.conferentes(id) ON DELETE RESTRICT,
  produto_id uuid REFERENCES public.produtos(id) ON DELETE SET NULL,
  codigo_interno text NOT NULL,
  descricao text NOT NULL,
  unidade_medida text,
  quantidade_up numeric NOT NULL,
  up_adicional numeric,
  lote text,
  observacao text,
  data_fabricacao date,
  data_validade date,
  ean text,
  dun text,
  foto_base64 text,
  inventario_repeticao smallint,
  inventario_numero_contagem smallint,
  created_at timestamptz NOT NULL DEFAULT now(),
  contagem_rascunho boolean NOT NULL DEFAULT false,
  finalizacao_sessao_id uuid,
  planilha_grupo_armazem smallint,
  planilha_ordem_na_aba integer,
  CONSTRAINT contagens_inventario_numero_contagem_chk
    CHECK ((inventario_numero_contagem IS NULL) OR ((inventario_numero_contagem >= 1) AND (inventario_numero_contagem <= 4))),
  CONSTRAINT contagens_inventario_repeticao_chk
    CHECK ((inventario_repeticao IS NULL) OR ((inventario_repeticao >= 1) AND (inventario_repeticao <= 3)))
);

CREATE INDEX IF NOT EXISTS idx_contagens_inventario_codigo ON public.contagens_inventario USING btree (codigo_interno);
CREATE INDEX IF NOT EXISTS idx_contagens_inventario_conferente ON public.contagens_inventario USING btree (conferente_id);
CREATE INDEX IF NOT EXISTS idx_contagens_inventario_data_contagem ON public.contagens_inventario USING btree (data_contagem);
CREATE INDEX IF NOT EXISTS idx_contagens_inventario_finalizacao_sessao ON public.contagens_inventario USING btree (finalizacao_sessao_id) WHERE (finalizacao_sessao_id IS NOT NULL);
CREATE INDEX IF NOT EXISTS idx_contagens_inventario_rascunho ON public.contagens_inventario USING btree (data_contagem, contagem_rascunho);

CREATE TABLE IF NOT EXISTS public.contagem_diaria_sessoes (
  id uuid PRIMARY KEY,
  numero integer NOT NULL,
  titulo text NOT NULL,
  local text NOT NULL DEFAULT 'ULTRAPAO GUARULHOS DISTRI'::text,
  data_contagem date NOT NULL,
  conferente_nome text,
  data_inicio timestamptz NOT NULL,
  data_fim timestamptz,
  status text NOT NULL CHECK (status = ANY (ARRAY['aberto'::text, 'fechado'::text])),
  iniciada boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  lista_produtos_id uuid,
  lista_produtos_nome text,
  linhas jsonb NOT NULL DEFAULT '[]'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_contagem_diaria_sessoes_numero ON public.contagem_diaria_sessoes USING btree (numero DESC);
CREATE INDEX IF NOT EXISTS idx_contagem_diaria_sessoes_status ON public.contagem_diaria_sessoes USING btree (status);
CREATE INDEX IF NOT EXISTS idx_contagem_diaria_sessoes_updated ON public.contagem_diaria_sessoes USING btree (updated_at DESC);

CREATE TABLE IF NOT EXISTS public.contagem_diaria_presenca (
  conferente_id uuid NOT NULL REFERENCES public.conferentes(id) ON DELETE CASCADE,
  data_contagem date NOT NULL,
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  linhas_com_qtd integer,
  linhas_total integer,
  camara integer,
  rua text,
  PRIMARY KEY (conferente_id, data_contagem)
);

CREATE INDEX IF NOT EXISTS idx_contagem_diaria_presenca_data ON public.contagem_diaria_presenca USING btree (data_contagem);

CREATE TABLE IF NOT EXISTS public.contagem_diaria_captura_presenca (
  contagem_id text NOT NULL,
  usuario_nome text NOT NULL,
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (contagem_id, usuario_nome)
);

CREATE INDEX IF NOT EXISTS idx_contagem_diaria_captura_presenca_contagem ON public.contagem_diaria_captura_presenca USING btree (contagem_id);

CREATE TABLE IF NOT EXISTS public.contagem_ocupacao_camaras (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  data_registro date NOT NULL,
  conferente_nome text NOT NULL,
  camara11_vazias integer NOT NULL CHECK (camara11_vazias >= 0),
  camara12_vazias integer NOT NULL CHECK (camara12_vazias >= 0),
  camara13_vazias integer NOT NULL CHECK (camara13_vazias >= 0),
  avaria_acrescimo_ocupacao integer NOT NULL DEFAULT 0 CHECK (avaria_acrescimo_ocupacao >= 0),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_contagem_ocupacao_camaras_data ON public.contagem_ocupacao_camaras USING btree (data_registro DESC, created_at DESC);

CREATE TABLE IF NOT EXISTS public.contagem_ocupacao_avaria_camaras (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  data_registro date NOT NULL,
  conferente_nome text NOT NULL,
  camara11_vazias integer NOT NULL CHECK (camara11_vazias >= 0),
  camara12_vazias integer NOT NULL CHECK (camara12_vazias >= 0),
  camara13_vazias integer NOT NULL CHECK (camara13_vazias >= 0),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_contagem_ocupacao_avaria_data ON public.contagem_ocupacao_avaria_camaras USING btree (data_registro DESC, created_at DESC);

CREATE TABLE IF NOT EXISTS public.contagem_temperatura_camaras (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  data_registro date NOT NULL,
  conferente_nome text NOT NULL,
  camara11_temp numeric NOT NULL,
  camara12_temp numeric NOT NULL,
  camara13_temp numeric NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_contagem_temperatura_camaras_data ON public.contagem_temperatura_camaras USING btree (data_registro DESC, created_at DESC);

CREATE TABLE IF NOT EXISTS public.enderecamento_listas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nome text NOT NULL,
  enderecos jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_enderecamento_listas_nome
  ON public.enderecamento_listas USING btree (lower(TRIM(BOTH FROM nome)));

CREATE TABLE IF NOT EXISTS public.produto_listas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nome text NOT NULL,
  produtos jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_produto_listas_nome
  ON public.produto_listas USING btree (lower(TRIM(BOTH FROM nome)));

CREATE TABLE IF NOT EXISTS public.inventario_sessoes (
  id uuid PRIMARY KEY,
  numero integer NOT NULL,
  titulo text NOT NULL,
  local text NOT NULL DEFAULT 'ULTRAPAO GUARULHOS DISTRI'::text,
  posicoes_nome text,
  posicoes_codigos jsonb,
  catalogo_produtos text DEFAULT 'ultrapao'::text,
  lista_enderecamento_id uuid,
  lista_enderecamento_nome text,
  lista_produtos_id uuid,
  lista_produtos_nome text,
  data_inicio timestamptz NOT NULL,
  data_fim timestamptz,
  status text NOT NULL CHECK (status = ANY (ARRAY['aberto'::text, 'fechado'::text])),
  linhas jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_inventario_sessoes_numero ON public.inventario_sessoes USING btree (numero DESC);
CREATE INDEX IF NOT EXISTS idx_inventario_sessoes_status ON public.inventario_sessoes USING btree (status);
CREATE INDEX IF NOT EXISTS idx_inventario_sessoes_updated ON public.inventario_sessoes USING btree (updated_at DESC);

CREATE TABLE IF NOT EXISTS public.inventario_planilha_linhas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  conferente_id uuid NOT NULL REFERENCES public.conferentes(id) ON DELETE RESTRICT,
  data_inventario date NOT NULL,
  grupo_armazem smallint NOT NULL CHECK ((grupo_armazem >= 1) AND (grupo_armazem <= 8)),
  rua text,
  posicao integer NOT NULL DEFAULT 1,
  nivel integer NOT NULL DEFAULT 1,
  numero_contagem smallint NOT NULL CHECK ((numero_contagem >= 1) AND (numero_contagem <= 8)),
  codigo_interno text NOT NULL,
  descricao text NOT NULL,
  inventario_repeticao smallint CHECK ((inventario_repeticao IS NULL) OR ((inventario_repeticao >= 1) AND (inventario_repeticao <= 3))),
  quantidade numeric,
  data_fabricacao date,
  data_validade date,
  lote text,
  up_quantidade numeric,
  observacao text,
  produto_id uuid REFERENCES public.produtos(id) ON DELETE SET NULL,
  contagens_estoque_id uuid REFERENCES public.contagens_estoque(id) ON DELETE CASCADE,
  contagens_inventario_id uuid REFERENCES public.contagens_inventario(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_inventario_planilha_data_grupo
  ON public.inventario_planilha_linhas USING btree (data_inventario, grupo_armazem);

CREATE TABLE IF NOT EXISTS public.inventario_captura_presenca (
  inventario_id text NOT NULL,
  usuario_nome text NOT NULL,
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (inventario_id, usuario_nome)
);

CREATE INDEX IF NOT EXISTS idx_inventario_captura_presenca_inv
  ON public.inventario_captura_presenca USING btree (inventario_id);

CREATE TABLE IF NOT EXISTS public.sheet_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  aba text NOT NULL DEFAULT 'CONTAGEM DE ESTOQUE FISICA'::text,
  codigo_interno text NOT NULL,
  descricao text NOT NULL,
  data_contagem date NOT NULL,
  event_type text NOT NULL CHECK (event_type = ANY (ARRAY['upsert'::text, 'clear_qty'::text])),
  quantidade_contada numeric,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'pending'::text CHECK (status = ANY (ARRAY['pending'::text, 'processing'::text, 'done'::text, 'failed'::text])),
  attempts integer NOT NULL DEFAULT 0,
  last_error text,
  locked_at timestamptz,
  processed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (aba, codigo_interno, descricao, data_contagem)
);

CREATE INDEX IF NOT EXISTS idx_sheet_outbox_pending ON public.sheet_outbox USING btree (status, created_at);

CREATE TABLE IF NOT EXISTS public.sistema_protecao_dados (
  id smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  ativa boolean NOT NULL DEFAULT true,
  atualizado_em timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.sistema_protecao_dados (id, ativa)
VALUES (1, true)
ON CONFLICT (id) DO NOTHING;

-- Histórico/perfil de usuários vindos do WMS Light
CREATE TABLE IF NOT EXISTS public.light_usuarios (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nome text NOT NULL DEFAULT ''::text,
  username text,
  senha text,
  ativo boolean NOT NULL DEFAULT true,
  acesso_autorizado boolean NOT NULL DEFAULT true,
  permissoes_views jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS light_usuarios_username_lower_unique
  ON public.light_usuarios USING btree (lower(username))
  WHERE ((username IS NOT NULL) AND (length(TRIM(BOTH FROM username)) > 0));

-- Funções e Triggers do Light
CREATE OR REPLACE FUNCTION public.protecao_dados_supabase_ativa()
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT COALESCE(
    (SELECT ativa FROM public.sistema_protecao_dados WHERE id = 1 LIMIT 1),
    true
  );
$$;

CREATE OR REPLACE FUNCTION public.set_contagens_data_contagem()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.data_contagem := timezone('America/Sao_Paulo', NEW.data_hora_contagem)::date;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_set_contagens_data_contagem ON public.contagens_estoque;
CREATE TRIGGER trg_set_contagens_data_contagem
BEFORE INSERT OR UPDATE ON public.contagens_estoque
FOR EACH ROW EXECUTE FUNCTION public.set_contagens_data_contagem();

CREATE OR REPLACE FUNCTION public.set_contagens_inventario_data_contagem()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.data_contagem := timezone('America/Sao_Paulo', NEW.data_hora_contagem)::date;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_set_contagens_inventario_data_contagem ON public.contagens_inventario;
CREATE TRIGGER trg_set_contagens_inventario_data_contagem
BEFORE INSERT OR UPDATE ON public.contagens_inventario
FOR EACH ROW EXECUTE FUNCTION public.set_contagens_inventario_data_contagem();

CREATE OR REPLACE FUNCTION public.enqueue_sheet_outbox_from_contagem()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET row_security TO 'off'
AS $$
DECLARE
  v_aba text := 'CONTAGEM DE ESTOQUE FISICA';
  v_codigo text;
  v_desc text;
  v_data_contagem date;
  v_sum numeric(18,3);
  v_event text;
  v_payload jsonb;
BEGIN
  IF (tg_op = 'DELETE') THEN
    IF (
      coalesce(old.origem, '') = 'inventario'
      OR old.inventario_repeticao IS NOT NULL
      OR old.inventario_numero_contagem IS NOT NULL
    ) THEN
      RETURN old;
    END IF;
    v_codigo := old.codigo_interno;
    v_desc := old.descricao;
    v_data_contagem := timezone('America/Sao_Paulo', old.data_hora_contagem)::date;
  ELSE
    IF (
      coalesce(new.origem, '') = 'inventario'
      OR new.inventario_repeticao IS NOT NULL
      OR new.inventario_numero_contagem IS NOT NULL
    ) THEN
      RETURN new;
    END IF;
    IF coalesce(new.contagem_rascunho, false) THEN
      RETURN new;
    END IF;
    v_codigo := new.codigo_interno;
    v_desc := new.descricao;
    v_data_contagem := timezone('America/Sao_Paulo', new.data_hora_contagem)::date;
  END IF;

  SELECT sum(c.quantidade_up)::numeric(18,3)
    INTO v_sum
    FROM public.contagens_estoque c
   WHERE c.codigo_interno = v_codigo
     AND c.descricao = v_desc
     AND timezone('America/Sao_Paulo', c.data_hora_contagem)::date = v_data_contagem
     AND coalesce(c.origem, '') <> 'inventario'
     AND c.inventario_repeticao IS NULL
     AND c.inventario_numero_contagem IS NULL
     AND coalesce(c.contagem_rascunho, false) = false;

  v_event := 'upsert';
  v_payload := jsonb_build_object(
    'codigo_interno', v_codigo,
    'descricao', v_desc,
    'data_contagem', v_data_contagem,
    'quantidade_contada', coalesce(v_sum, 0)
  );

  INSERT INTO public.sheet_outbox (
    aba, codigo_interno, descricao, data_contagem, event_type, quantidade_contada, payload, status
  )
  VALUES (
    v_aba, v_codigo, v_desc, v_data_contagem, v_event, coalesce(v_sum, 0), v_payload, 'pending'
  )
  ON CONFLICT (aba, codigo_interno, descricao, data_contagem)
  DO UPDATE SET
    event_type = excluded.event_type,
    quantidade_contada = excluded.quantidade_contada,
    payload = excluded.payload,
    status = 'pending',
    attempts = 0,
    last_error = null,
    locked_at = null,
    processed_at = null,
    updated_at = now();

  IF (tg_op = 'DELETE') THEN
    RETURN old;
  END IF;
  RETURN new;
END;
$$;

DROP TRIGGER IF EXISTS trg_sheet_outbox_contagens_insert ON public.contagens_estoque;
CREATE TRIGGER trg_sheet_outbox_contagens_insert
AFTER INSERT ON public.contagens_estoque
FOR EACH ROW EXECUTE FUNCTION public.enqueue_sheet_outbox_from_contagem();

DROP TRIGGER IF EXISTS trg_sheet_outbox_contagens_update ON public.contagens_estoque;
CREATE TRIGGER trg_sheet_outbox_contagens_update
AFTER UPDATE ON public.contagens_estoque
FOR EACH ROW EXECUTE FUNCTION public.enqueue_sheet_outbox_from_contagem();

DROP TRIGGER IF EXISTS trg_sheet_outbox_contagens_delete ON public.contagens_estoque;
CREATE TRIGGER trg_sheet_outbox_contagens_delete
AFTER DELETE ON public.contagens_estoque
FOR EACH ROW EXECUTE FUNCTION public.enqueue_sheet_outbox_from_contagem();

-- Views do Light
CREATE OR REPLACE VIEW public.v_contagem_diaria_painel AS
WITH primeira_por_linha AS (
  SELECT DISTINCT ON (ce.data_contagem, ce.codigo_interno)
    ce.data_contagem,
    ce.codigo_interno,
    ce.conferente_id,
    COALESCE(ce.created_at, ce.data_hora_contagem) AS ts
  FROM public.contagens_estoque ce
  WHERE ((ce.origem = 'contagem_diaria'::text) AND (COALESCE(ce.contagem_rascunho, false) = false) AND (ce.codigo_interno IS NOT NULL))
  ORDER BY ce.data_contagem, ce.codigo_interno, COALESCE(ce.created_at, ce.data_hora_contagem), ce.id
)
SELECT
  p.data_contagem,
  p.conferente_id,
  COALESCE(cf.nome, (p.conferente_id)::text) AS conferente_nome,
  count(*) AS itens_contados,
  min(p.ts) AS inicio,
  max(p.ts) AS fim
FROM primeira_por_linha p
LEFT JOIN public.conferentes cf ON (cf.id = p.conferente_id)
GROUP BY p.data_contagem, p.conferente_id, COALESCE(cf.nome, (p.conferente_id)::text);

CREATE OR REPLACE VIEW public.v_contagem_diaria_itens_painel AS
WITH primeira_por_codigo AS (
  SELECT DISTINCT ON (ce.data_contagem, ce.codigo_interno)
    ce.data_contagem,
    ce.codigo_interno,
    ce.descricao,
    ce.quantidade_up AS quantidade_contada,
    ce.conferente_id,
    COALESCE(ce.created_at, ce.data_hora_contagem) AS ts
  FROM public.contagens_estoque ce
  WHERE ((ce.origem = 'contagem_diaria'::text) AND (COALESCE(ce.contagem_rascunho, false) = false) AND (ce.codigo_interno IS NOT NULL))
  ORDER BY ce.data_contagem, ce.codigo_interno, COALESCE(ce.created_at, ce.data_hora_contagem), ce.id
)
SELECT
  p.data_contagem,
  COALESCE(cf.nome, (p.conferente_id)::text) AS conferente_nome,
  p.codigo_interno,
  p.descricao,
  p.quantidade_contada
FROM primeira_por_codigo p
LEFT JOIN public.conferentes cf ON (cf.id = p.conferente_id);

-- =============================================================================
-- PARTE 2: MÓDULOS WMS PLUS (Ultrafrio Câmaras, NF-e, Movimentos, Financeiro, Voz)
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.ultrafrio_notas_fiscais (
  id text PRIMARY KEY,
  numero text NOT NULL,
  serie text NOT NULL DEFAULT ''::text,
  chave text NOT NULL DEFAULT ''::text,
  emitente text NOT NULL DEFAULT ''::text,
  data_emissao text NOT NULL DEFAULT ''::text,
  status text NOT NULL DEFAULT 'em_andamento'::text CHECK (status = ANY (ARRAY['em_andamento'::text, 'concluida'::text])),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  peso_bruto numeric,
  peso_liquido numeric,
  valor_total_nota numeric,
  quantidade_volume text,
  data_armazenagem date,
  emitente_cnpj text
);

CREATE TABLE IF NOT EXISTS public.ultrafrio_nf_itens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nf_id text NOT NULL REFERENCES public.ultrafrio_notas_fiscais(id) ON DELETE CASCADE,
  item_index integer NOT NULL,
  codigo text NOT NULL DEFAULT ''::text,
  descricao text NOT NULL DEFAULT ''::text,
  quantidade numeric NOT NULL DEFAULT 0,
  unidade text NOT NULL DEFAULT ''::text,
  peso_bruto numeric,
  valor_unitario numeric,
  valor_total numeric,
  up text,
  lote text,
  data_fabricacao text,
  data_validade text,
  paletes integer,
  localizacao text NOT NULL DEFAULT 'armazem'::text,
  UNIQUE (nf_id, item_index)
);

CREATE INDEX IF NOT EXISTS idx_ultrafrio_nf_itens_nf ON public.ultrafrio_nf_itens USING btree (nf_id);

CREATE TABLE IF NOT EXISTS public.ultrafrio_enderecamentos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nf_id text NOT NULL REFERENCES public.ultrafrio_notas_fiscais(id) ON DELETE CASCADE,
  item_index integer NOT NULL,
  address_id text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ultrafrio_end_nf ON public.ultrafrio_enderecamentos USING btree (nf_id);
CREATE INDEX IF NOT EXISTS idx_ultrafrio_end_addr ON public.ultrafrio_enderecamentos USING btree (address_id);

CREATE OR REPLACE FUNCTION public.ultrafrio_touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_ultrafrio_nf_updated ON public.ultrafrio_notas_fiscais;
CREATE TRIGGER trg_ultrafrio_nf_updated
BEFORE UPDATE ON public.ultrafrio_notas_fiscais
FOR EACH ROW EXECUTE FUNCTION public.ultrafrio_touch_updated_at();

CREATE TABLE IF NOT EXISTS public.ultrafrio_movimentos (
  id text PRIMARY KEY,
  tipo text NOT NULL CHECK (tipo = ANY (ARRAY['entrada'::text, 'saida'::text, 'movimentacao'::text])),
  nf_id text REFERENCES public.ultrafrio_notas_fiscais(id) ON DELETE CASCADE,
  nf_numero text NOT NULL,
  emitente text NOT NULL DEFAULT ''::text,
  created_at timestamptz NOT NULL DEFAULT now(),
  payload jsonb NOT NULL DEFAULT '{"itens": []}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_ultrafrio_mov_nf ON public.ultrafrio_movimentos USING btree (nf_id);
CREATE INDEX IF NOT EXISTS idx_ultrafrio_mov_tipo ON public.ultrafrio_movimentos USING btree (tipo);

CREATE TABLE IF NOT EXISTS public.ultrafrio_notas_canceladas (
  id text PRIMARY KEY,
  numero text NOT NULL,
  serie text DEFAULT ''::text,
  chave text DEFAULT ''::text,
  emitente text DEFAULT ''::text,
  data_emissao text DEFAULT ''::text,
  created_at timestamptz NOT NULL DEFAULT now(),
  vinculo_nf_nova_id text,
  vinculo_nf_nova_numero text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_ultrafrio_canceladas_vinculo
  ON public.ultrafrio_notas_canceladas USING btree (vinculo_nf_nova_id);

CREATE TABLE IF NOT EXISTS public.ultrafrio_cadastro_remetentes (
  nome_key text PRIMARY KEY,
  nome text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ultrafrio_cadastro_remetentes_updated
  ON public.ultrafrio_cadastro_remetentes USING btree (updated_at DESC);

CREATE TABLE IF NOT EXISTS public.ultrafrio_fin_tabelas (
  id text PRIMARY KEY,
  nome text NOT NULL,
  custo_posicao_palete numeric NOT NULL DEFAULT 0,
  custo_por_kilo numeric NOT NULL DEFAULT 0,
  custo_por_palete numeric NOT NULL DEFAULT 0,
  custo_entrada numeric NOT NULL DEFAULT 0,
  custo_saida numeric NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.ultrafrio_fin_clientes (
  cnpj text PRIMARY KEY,
  razao_social text NOT NULL DEFAULT ''::text,
  origem text NOT NULL DEFAULT 'auto'::text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.ultrafrio_fin_contratos (
  id text PRIMARY KEY,
  cnpj text NOT NULL,
  razao_social text NOT NULL DEFAULT ''::text,
  tabela_id text,
  ciclo text NOT NULL DEFAULT 'mensal'::text,
  regra_tempo text NOT NULL DEFAULT 'proporcional'::text,
  cobrar_posicao_palete boolean NOT NULL DEFAULT false,
  cobrar_kilo boolean NOT NULL DEFAULT false,
  cobrar_palete boolean NOT NULL DEFAULT false,
  cobrar_entrada boolean NOT NULL DEFAULT false,
  cobrar_saida boolean NOT NULL DEFAULT false,
  kilo_por_dia boolean NOT NULL DEFAULT false,
  ativo boolean NOT NULL DEFAULT true,
  observacao text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ultrafrio_fin_contratos_cnpj_idx
  ON public.ultrafrio_fin_contratos USING btree (cnpj);

CREATE TABLE IF NOT EXISTS public.ultrafrio_voz_cadastros (
  id text PRIMARY KEY,
  name text NOT NULL,
  features jsonb NOT NULL,
  sample_count integer NOT NULL DEFAULT 3,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ultrafrio_voz_cadastros_updated
  ON public.ultrafrio_voz_cadastros USING btree (updated_at DESC);

-- =============================================================================
-- PARTE 3: RLS & PERMISSÕES PARA USO UNIFICADO (anon + authenticated + service_role)
-- =============================================================================

DO $$
DECLARE
  t text;
  tabelas text[] := ARRAY[
    'Todos os Produtos',
    'conferentes',
    'produtos',
    'contagens_estoque',
    'contagens_inventario',
    'contagem_diaria_sessoes',
    'contagem_diaria_presenca',
    'contagem_diaria_captura_presenca',
    'contagem_ocupacao_camaras',
    'contagem_ocupacao_avaria_camaras',
    'contagem_temperatura_camaras',
    'enderecamento_listas',
    'produto_listas',
    'inventario_sessoes',
    'inventario_planilha_linhas',
    'inventario_captura_presenca',
    'sheet_outbox',
    'sistema_protecao_dados',
    'light_usuarios',
    'ultrafrio_notas_fiscais',
    'ultrafrio_nf_itens',
    'ultrafrio_enderecamentos',
    'ultrafrio_movimentos',
    'ultrafrio_notas_canceladas',
    'ultrafrio_cadastro_remetentes',
    'ultrafrio_fin_tabelas',
    'ultrafrio_fin_clientes',
    'ultrafrio_fin_contratos',
    'ultrafrio_voz_cadastros'
  ];
BEGIN
  FOREACH t IN ARRAY tabelas LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY;', t);
    EXECUTE format('DROP POLICY IF EXISTS "wms_unificado_all" ON public.%I;', t);
    EXECUTE format(
      'CREATE POLICY "wms_unificado_all" ON public.%I FOR ALL TO anon, authenticated, service_role USING (true) WITH CHECK (true);',
      t
    );
    EXECUTE format('GRANT ALL ON TABLE public.%I TO anon, authenticated, service_role;', t);
  END LOOP;
END $$;

GRANT USAGE, SELECT ON SEQUENCE public."Todos os Produtos_id_seq" TO anon, authenticated, service_role;
GRANT SELECT ON public.v_contagem_diaria_painel TO anon, authenticated, service_role;
GRANT SELECT ON public.v_contagem_diaria_itens_painel TO anon, authenticated, service_role;

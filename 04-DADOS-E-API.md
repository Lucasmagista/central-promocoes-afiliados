# 04 — Modelo de dados e API inicial

## 1. Entidades

### `marketplace_connectors`
- `id` UUID
- `platform` enum: `mercadolivre`, `shopee`, `amazon`, `manual`
- `enabled` boolean
- `connection_status` enum: `unconfigured`, `ready`, `paused`, `error`
- `config_json` JSONB sem segredos
- `last_success_at`, `last_error_at`
- `created_at`, `updated_at`

Segredos devem vir do ambiente/secret store, nunca de `config_json`.

### `offers`
- `id` UUID
- `platform`
- `external_product_id` nullable
- `title`
- `canonical_url`
- `affiliate_url` nullable até validar
- `current_price` decimal(12,2)
- `previous_price` decimal(12,2) nullable
- `currency` default `BRL`
- `availability_status`
- `seller_name` nullable
- `category` nullable
- `image_url` nullable
- `coupon_code` nullable
- `source_name`
- `source_observed_at`
- `last_validated_at`
- `status`
- `is_simulated` boolean default false
- `validation_notes` JSONB
- `created_at`, `updated_at`

Restrições:
- preço não negativo;
- URLs limitadas a esquemas HTTP/HTTPS e domínios esperados quando aplicável;
- unicidade por plataforma + ID externo quando presente;
- guardar o horário da observação para identificar dados antigos.

### `price_observations`
- `id` UUID
- `offer_id` FK
- `observed_price` decimal(12,2)
- `observed_previous_price` nullable
- `currency`
- `source_name`
- `observed_at`
- `evidence_json` JSONB sem segredos

Esse histórico só é confiável a partir do momento em que o sistema coleta dados consistentes; não chamar de histórico completo se não houver cobertura.

### `destinations`
- `id` UUID
- `channel_type`: `telegram`, `whatsapp`
- `external_chat_id`
- `display_name`
- `enabled`
- `allowed_categories` JSONB
- `quiet_hours` JSONB
- `rate_limit_config` JSONB
- `created_at`, `updated_at`

Não registrar tokens dentro da tabela.

### `publications`
- `id` UUID
- `offer_id` FK
- `destination_id` FK
- `content_version`
- `rendered_text`
- `status`
- `idempotency_key` unique
- `external_message_id` nullable
- `attempt_count`
- `last_error_code` nullable
- `created_at`, `sent_at` nullable

### `collection_runs`
- `id` UUID
- `connector_id` FK
- `started_at`, `finished_at`
- `status`
- `items_seen`, `items_accepted`, `items_rejected`
- `error_summary` sanitizado

### `audit_events`
- `id` UUID
- `actor_type`: `system`, `admin`
- `action`
- `entity_type`, `entity_id`
- `metadata` JSONB sanitizado
- `created_at`

## 2. API inicial

Prefixo: `/api/v1`.

- `GET /health` — saúde da API.
- `GET /ready` — verifica dependências essenciais.
- `GET /offers` — lista com filtros de status, plataforma, categoria e período.
- `GET /offers/{offer_id}` — detalhe da oferta.
- `POST /offers/manual` — cadastra oferta manual para revisão; não deve aceitar qualquer URL e publicar automaticamente.
- `POST /offers/{offer_id}/approve` — aprova após revalidar.
- `POST /offers/{offer_id}/reject` — rejeita com motivo.
- `POST /offers/{offer_id}/preview` — retorna preview por destino.
- `POST /offers/{offer_id}/publish` — solicita publicação, com autenticação administrativa e idempotência.
- `GET /destinations` — lista destinos sem credenciais.
- `POST /destinations` — cria destino.
- `PATCH /destinations/{destination_id}` — altera configuração.
- `POST /connectors/{platform}/run` — aciona coleta protegida e com limite de frequência.
- `GET /runs` — histórico de coletas.
- `GET /publications` — histórico de envios.

## 3. Segurança da API

- Não expor endpoints administrativos publicamente sem autenticação.
- Se o serviço for apenas local/rede privada no MVP, ainda assim aplicar autenticação para ações mutáveis.
- Validar tamanho e tipo de todos os campos.
- Não aceitar URLs arbitrárias para o backend buscar; isso pode gerar SSRF.
- Aplicar allowlist de hosts para conectores.
- Rate limit em endpoints que disparam tarefas.
- CORS restrito a origens conhecidas quando houver painel.
- Registrar auditoria para aprovar, rejeitar, ativar conectores e publicar.

## 4. Exemplo de objeto de oferta

```json
{
  "platform": "manual",
  "external_product_id": null,
  "title": "Produto de demonstração",
  "canonical_url": "https://example.com/produto-demo",
  "affiliate_url": null,
  "current_price": "199.90",
  "previous_price": null,
  "currency": "BRL",
  "availability_status": "unknown",
  "source_name": "manual_test_fixture",
  "is_simulated": true,
  "status": "needs_review"
}
```

O domínio `example.com` e o preço são fictícios. Não usar este objeto para publicação real.

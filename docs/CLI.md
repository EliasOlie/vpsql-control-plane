# Manual Completo da CLI — `vpsql`

O `vpsql` é a ferramenta de linha de comando (CLI) oficial para gerenciar o plano de controle (Control Plane) do **VPSQL**. Ele permite provisionar bancos de dados PostgreSQL multi-tenant isolados, inspecionar schemas e tabelas em tempo real, executar queries SQL diretamente via proxy seguro, rotacionar e gerenciar roles com privilégios mínimos e monitorar as métricas de saúde da VPS.

---

## Sumário

1. [Instalação e PATH](#1-instalação-e-path)
2. [Hierarquia de Configuração e Endpoints](#2-hierarquia-de-configuração-e-endpoints)
3. [Flags Globais](#3-flags-globais)
4. [Referência Completa de Comandos](#4-referência-completa-de-comandos)
   - [vpsql auth](#vpsql-auth)
   - [vpsql db](#vpsql-db)
   - [vpsql redis](#vpsql-redis)
   - [vpsql storage (S3)](#vpsql-storage-s3)
   - [vpsql project](#vpsql-project)
   - [vpsql schema](#vpsql-schema)
   - [vpsql query](#vpsql-query)
   - [vpsql role](#vpsql-role)
   - [vpsql rotate (Motor de Rotação)](#vpsql-rotate)
   - [vpsql node](#vpsql-node)
5. [Automação e Scripts com JSON + JQ](#5-automação-e-scripts-com-json--jq)
6. [Troubleshooting & Dicas](#6-troubleshooting--dicas)

---

## 1. Instalação e PATH

A CLI é distribuída como um binário compilado em Go, sem dependências externas de runtime.

### Compilação a partir do código-fonte:

```bash
cd cli
go build -o ~/.local/bin/vpsql ./main.go
chmod +x ~/.local/bin/vpsql
```

### Garantindo o binário no `$PATH`

Para executar `vpsql` diretamente sem precisar de `./` ou do caminho absoluto, certifique-se de que o diretório `~/.local/bin` esteja no seu `$PATH`.

No **Zsh** (`~/.zshrc`) ou **Bash** (`~/.bashrc`):
```bash
export PATH="$HOME/.local/bin:$PATH"
```

Recarregue seu terminal:
```bash
source ~/.zshrc   # ou source ~/.bashrc
```

Verifique se a CLI está acessível:
```bash
vpsql --help
```

---

## 2. Hierarquia de Configuração e Endpoints

A CLI determina para qual servidor VPSQL se comunicar seguindo a seguinte ordem de prioridade (da mais alta para a mais baixa):

1. **Flag explícita na linha de comando:** `--endpoint https://sua-api.com`
2. **Variável de ambiente:** `VPSQL_ENDPOINT`
3. **Arquivo de configuração local:** `~/.vpsql/config.json`
4. **Padrão local:** `http://localhost:8080`

### Configuração via Arquivo Local (`~/.vpsql/config.json`)

Você pode fixar seu domínio padrão criando ou editando `~/.vpsql/config.json`:

```json
{
  "endpoint": "https://vpsql.example.com",
  "token": "seu_token_jwt_opcional"
}
```

### Configuração via Variáveis de Ambiente no Shell

Adicione no seu `~/.zshrc` ou `~/.bashrc`:

```bash
export VPSQL_ENDPOINT="https://vpsql.example.com"
export VPSQL_TOKEN="seu_token_opcional"
```

---

## 3. Flags Globais

Estas flags podem ser aplicadas em **qualquer** subcomando do `vpsql`:

| Flag | Descrição | Valor Padrão |
|---|---|---|
| `--endpoint string` | URL base da API do VPSQL Control Plane | `~/.vpsql/config.json` ou `http://localhost:8080` |
| `--token string` | Token Bearer para autenticação | `~/.vpsql/config.json` ou vazio |
| `-h, --help` | Exibe a mensagem de ajuda e opções do comando | — |

---

## 4. Referência Completa de Comandos

---

### `vpsql auth`

Gerenciamento de credenciais e status de autenticação.

#### `vpsql auth login`
Autentica na API do Control Plane e armazena o token JWT automaticamente em `~/.vpsql/config.json`.

```bash
vpsql auth login --email admin@vpsql.dev --password "senha123"
```

- **Flags opcionais:**
  - `--email`: E-mail de login.
  - `--password`: Senha.
  - `--endpoint`: Endereço da API.

#### `vpsql auth status`
Exibe o endpoint atualmente ativo e o usuário autenticado.

```bash
vpsql auth status
```

*Exemplo de saída:*
```text
Current Endpoint: https://vpsql.example.com
User:             admin@vpsql.dev
Token:            [configured]
```

---

### `vpsql db`

Gerenciamento do ciclo de vida dos bancos de dados (provisionamento, listagem, inspeção de URIs e exclusão).

#### `vpsql db ls` (Aliases: `list`)
Lista todos os bancos de dados criados na VPS com status, tamanho em disco, conexões ativas e role proprietária.

```bash
vpsql db ls
```

*Exemplo de saída:*
```text
DATABASE     STATUS    SIZE      CONNS   OWNER ROLE             CREATED
atlas_prod   running   7727 kB   0/100   app_atlas_prod_admin   15m ago
billing_api  running   8192 kB   2/100   app_billing_api_admin  2h ago
```

- **Flags:**
  - `--json`: Retorna a lista completa em formato JSON estruturado.

```bash
vpsql db ls --json
```

---

#### `vpsql db create <name>`
Provisiona um novo banco de dados transacionalmente na VPS, executando as seguintes ações de forma segura:
1. Cria a role de proprietário (`app_<name>_admin`) com senha de alta entropia.
2. Cria a role somente leitura (`app_<name>_readonly`) com senha de alta entropia.
3. Cria o database `app_<name>`.
4. Revoga privilégios do grupo público (`REVOKE ALL ON DATABASE ... FROM PUBLIC`).
5. Conecta no novo banco e configura `GRANT USAGE, SELECT` na schema `public` para a role read-only.
6. Instala as extensões solicitadas (como `uuid-ossp`, `pgcrypto`).
7. Retorna as 4 strings de conexão (Direta Admin, Direta Read-Only, PgBouncer Admin, PgBouncer Read-Only).

```bash
vpsql db create saas_core --project production --ext uuid-ossp,pgcrypto
```

- **Parâmetros:**
  - `<name>`: Nome identificador da aplicação/banco.
- **Flags:**
  - `--project string`: Tag ou grupo de projeto (padrão: `default`).
  - `--ext string`: Extensões separadas por vírgula (padrão: `uuid-ossp,pgcrypto`). Use `none` para desativar extensões automáticas.
  - `--json`: Retorna o payload completo de criação em JSON.

*Exemplo de saída:*
```text
Provisioning database 'saas_core' (project: production, extensions: [uuid-ossp pgcrypto])...

✓ Database provisioned successfully!
Database:       app_saas_core
Owner Role:     app_saas_core_admin
Read-Only Role: app_saas_core_readonly

Direct Admin Connection String:
  postgresql://app_saas_core_admin:CHANGE_ME@203.0.113.10:5434/app_saas_core?sslmode=disable

Direct Read-Only Connection String:
  postgresql://app_saas_core_readonly:CHANGE_ME@203.0.113.10:5434/app_saas_core?sslmode=disable

PgBouncer Pooler Admin Connection String:
  postgresql://app_saas_core_admin:CHANGE_ME@203.0.113.10:6432/app_saas_core?sslmode=disable

PgBouncer Pooler Read-Only Connection String:
  postgresql://app_saas_core_readonly:CHANGE_ME@203.0.113.10:6432/app_saas_core?sslmode=disable
```

---

#### `vpsql db get <id>`
Obtém os detalhes completos de um banco já provisionado, incluindo status atual e todas as URIs de conexão direta e via pooler.

```bash
vpsql db get atlas_prod
```

- **Flags:**
  - `--json`: Retorna os dados em JSON.

---

#### `vpsql db rm <id>` (Aliases: `drop`, `delete`)
Remove com segurança o banco de dados e suas roles associadas. O processo encerra forçadamente as conexões ativas antes de executar o drop.

```bash
# Solicita confirmação de segurança
vpsql db rm atlas_prod

# Exclusão direta sem confirmação interativa
vpsql db rm atlas_prod --force
# ou
vpsql db rm atlas_prod -f
```

- **Flags:**
  - `-f, --force`: Confirma a exclusão destrutiva do banco de dados e de seus dados permanentemente.

---

### `vpsql storage (S3)`

Gerenciamento de buckets de armazenamento estático compatíveis com S3 (AWS Signature Version 4) diretamente no volume mapeado (`/data/storage`).

#### `vpsql storage ls` (Aliases: `list`, `s3 ls`, `bucket ls`)
Lista todos os buckets provisionados com uso de disco e contagem de objetos:
```bash
vpsql storage ls
vpsql storage ls --project cozy-curses
vpsql storage ls --json
```

#### `vpsql storage create <name>`
Provisiona um novo bucket isolado com chaves de acesso AWS SigV4 geradas automaticamente:
```bash
vpsql storage create app-cozy-assets --project cozy-curses --public
```
- **Flags:**
  - `-p, --project string`: Associa o bucket a um grupo de projeto.
  - `--public`: Habilita leitura pública HTTP sem assinatura AWS (padrão: `true` para assets web).
  - `--json`: Retorna credenciais e snippet em formato JSON.

#### `vpsql storage info <name>` (Aliases: `get`)
Exibe o endpoint, chaves de acesso, status e snippets `.env`:
```bash
vpsql storage info app-cozy-assets
```

#### `vpsql storage upload <bucket> <file>`
Faz o upload rápido de um arquivo local para o bucket S3:
```bash
vpsql storage upload app-cozy-assets ./logo.png --key images/logo.png
```

#### `vpsql storage objects <bucket>` (Aliases: `files`)
Lista arquivos e pastas dentro de um bucket:
```bash
vpsql storage objects app-cozy-assets
vpsql storage objects app-cozy-assets --prefix images/
```

#### `vpsql storage presign <bucket> <key>`
Gera uma URL pré-assinada padrão AWS SigV4 com expiração temporária (para download ou upload seguro sem expor credenciais):
```bash
# Gerar URL pré-assinada para download (válida por 1 hora por padrão)
vpsql storage presign app-cozy-assets relatorios/financeiro.pdf

# Gerar URL pré-assinada para upload PUT temporário (15 minutos)
vpsql storage presign app-cozy-assets uploads/avatar.png --method PUT --expires 900
```

#### `vpsql storage rm <name>` (Aliases: `drop`, `delete`)
Exclui um bucket e todos os seus arquivos do volume de forma permanente:
```bash
vpsql storage rm app-cozy-assets --force
```

---

### `vpsql project`

Visão unificada multi-recursos (Multi-Tenant Hub) agrupando Bancos de Dados PostgreSQL, Caches Redis, Buckets S3 e Chaves de IA por projeto.

#### `vpsql project ls` (Aliases: `list`, `projects`, `workspace`)
```bash
vpsql project ls
vpsql project ls --json
```
Exibe o resumo consolidado de recursos e o detalhamento por projeto (ex: `cozy-curses`, `default`, `guerra-advocacia`).

---

### `vpsql schema`

Introspecção e auditoria da estrutura de tabelas e colunas diretamente do catálogo do PostgreSQL.

#### `vpsql schema pull <database>`
Analisa `information_schema` e `pg_catalog` do banco informado e exibe as tabelas, colunas, tipos de dados, nulabilidade e constraints detectadas (`PK` = Primary Key, `UNIQ` = Unique Constraint, `FK` = Foreign Key).

```bash
vpsql schema pull atlas_prod
```

*Exemplo de saída:*
```text
=== Schema for atlas_prod (public) ===

TABLE users (1 rows)
  COLUMN   TYPE   NULLABLE   FLAG
  id       uuid   NO         PK
  email    text   NO         UNIQ
  name     text   YES        
```

- **Flags:**
  - `--format table|json`: Alterna entre tabela formatada no terminal (padrão) e JSON bruto.

```bash
vpsql schema pull atlas_prod --format json
```

---

### `vpsql query`

Executa comandos SQL (DDL ou DML) diretamente no banco especificado através da rota de proxy seguro do Control Plane.

```bash
vpsql query <database> "<sql>"
```

#### Exemplos de uso:

**1. Criação de tabelas (DDL):**
```bash
vpsql query atlas_prod "
CREATE TABLE IF NOT EXISTS orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  amount NUMERIC(10,2) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);
"
```

*Saída:*
```text
Statement executed in 7.42 ms (0 rows affected)
```

**2. Inserção de dados:**
```bash
vpsql query atlas_prod "INSERT INTO orders (amount) VALUES (199.90) RETURNING *;"
```

**3. Consulta e visualização tabular:**
```bash
vpsql query atlas_prod "SELECT id, name, email FROM users;"
```

*Saída:*
```text
id                                     name    email
4423fa1b-0319-40f0-a8e9-92d85cc380f9   Elias   elias@vpsql.dev

(1 rows, 6.50 ms)
```

- **Flags:**
  - `--json`: Retorna colunas, linhas, contagem de registros e tempo de resposta em milissegundos em JSON:

```bash
vpsql query atlas_prod "SELECT * FROM users;" --json
```

---

### `vpsql role`

Visualização e criação de roles adicionais para acesso granular ao banco de dados.

#### `vpsql role ls`
Lista todas as roles de aplicação criadas no servidor, discriminando entre `owner` e `read-only`.

```bash
# Listar todas as roles do cluster
vpsql role ls

# Filtrar apenas as roles de um banco específico
vpsql role ls --db atlas_prod
```

- **Flags:**
  - `--db string`: Filtra os resultados pelo nome do banco.
  - `--json`: Retorna a lista em JSON.

#### `vpsql role create <role_name>`
Cria uma role customizada vinculada a um banco de dados:

```bash
# Criar role com permissão somente leitura (SELECT)
vpsql role create reporting_service --db atlas_prod --read-only

# Criar role com permissão completa (CRUD/DDL)
vpsql role create worker_service --db atlas_prod --read-only=false
```

- **Flags:**
  - `--db string` (**Obrigatório**): Banco de dados de destino.
  - `--read-only bool`: Se verdadeiro, restringe a role para leitura apenas (`default: true`).

#### `vpsql role rotate <role_name>`
Rotaciona a senha da role especificada no PostgreSQL, gera nova credencial de 24 caracteres e derruba sessões ativas existentes:

```bash
# Rotacionar role derrubando conexões ativas
vpsql role rotate app_atlas_prod_admin

# Manter conexões ativas durante a rotação
vpsql role rotate app_atlas_prod_admin --terminate-connections=false
```

- **Flags:**
  - `--terminate-connections bool`: Encerra sessões ativas via `pg_terminate_backend` (`default: true`).
  - `--json`: Retorna a nova credencial em formato JSON.

---

### `vpsql rotate`

Motor unificado de rotação de credenciais: suporte a rotações granulares por recurso ou rotacionamento em lote (bulk) de emergência.

#### `vpsql rotate all`
Rotaciona **todas as credenciais** (Bancos de dados, Redis, S3 e AI Gateway).

```bash
# Rotação global de emergência (todas as credenciais do cluster)
vpsql rotate all

# Rotação restrita a um workspace/projeto
vpsql rotate all --scope meu_projeto
```

- **Flags:**
  - `-s, --scope string`: Escopo da rotação (`all` ou nome do workspace/project group, `default: all`).
  - `--terminate-connections bool`: Derruba ativamente sessões com credenciais antigas (`default: true`).
  - `--json`: Retorna o resumo do rotacionamento em JSON.

#### Subcomandos Granulares de Rotação:
```bash
# Rotacionar banco de dados específico (admin, readonly ou all)
vpsql rotate db atlas_prod --role admin
vpsql rotate db atlas_prod --role all

# Rotacionar role PostgreSQL por nome
vpsql rotate role app_atlas_prod_admin

# Rotacionar namespace Redis (reseta senha ACL e desconecta clientes)
vpsql rotate redis cache_atlas

# Rotacionar Secret Access Key de bucket S3
vpsql rotate storage cdn-assets

# Rotacionar token virtual de IA
vpsql rotate ai key_live_xyz123
```

---

### `vpsql node`

Inspeção de métricas de host e parâmetros do motor PostgreSQL.

#### `vpsql node status`
Exibe a versão do PostgreSQL, uso total de disco, quantidade de conexões, p99 de latência, medidores de CPU/Memória/IOPS e os principais parâmetros do `postgresql.conf`.

```bash
vpsql node status
```

*Exemplo de saída:*
```text
Node Host:        vpsql.example.com
PostgreSQL:       pg16.14
Total Databases:  02
Connections:      6/100
Disk Usage:       29.7 MB
p99 Latency:      1.8 ms

=== Resource Meters ===
  CPU      28%    (load 1m 1.84 · 8 vCPU)
  Memory   45%    (7.2 / 16 GB · buffers 4 GB)
  Disk     12%    (29.7 MB / 320 GB NVMe)
  IOPS     940    (read 280 · write 660)

=== postgresql.conf ===
  ssl                = off
  wal_level          = replica
  work_mem           = 4MB
  max_connections    = 100
  shared_buffers     = 128MB
```

- **Flags:**
  - `--json`: Retorna as métricas e configurações em formato JSON.

---

## 5. Automação e Scripts com JSON + JQ

Todas as saídas estruturadas suportam a flag `--json`, facilitando integrações com scripts bash, esteiras de CI/CD ou deploys automatizados.

### Obter apenas a URL do PgBouncer para injetar em um `.env`:
```bash
PGBOUNCER_URL=$(vpsql db get atlas_prod --json | jq -r '.admin_pooler_uri')
echo "DATABASE_URL=$PGBOUNCER_URL" >> .env.production
```

### Listar nomes de todos os bancos com mais de 5 MB de tamanho:
```bash
vpsql db ls --json | jq -r '.[] | "\(.name): \(.size)"'
```

### Extrair a lista de colunas de uma tabela via schema pull:
```bash
vpsql schema pull atlas_prod --format json | jq '.tables[] | select(.name=="users") | .cols[].name'
```

---

## 6. Troubleshooting & Dicas

### Erro: `connection refused` ou `context deadline exceeded`
- Verifique se a sua VPS está acessível via internet e se o Traefik/Dokploy está roteando para a porta do container `api`:
  ```bash
  curl -sI https://vpsql.example.com/health
  ```
- O retorno esperado é `HTTP/2 200` com `server: VPSQL`.

### Erro: `database does not exist`
- Lembre-se de que você pode usar tanto o identificador amigável (`atlas_prod`) quanto o nome real no PostgreSQL (`app_atlas_prod`). O Control Plane resolve ambos automaticamente.

### Resetar credenciais ou mudar de endpoint:
- Basta editar o arquivo `~/.vpsql/config.json` ou sobrescrever com a variável de ambiente:
  ```bash
  export VPSQL_ENDPOINT="https://outro-cluster.vpsql.dev"
  ```

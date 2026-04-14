# 🏛️ Monitor Proposições ALMT — Assembleia Legislativa de Mato Grosso

Monitora automaticamente a API oficial da ALMT e envia email quando há proposições novas.
Roda **4x por dia** via GitHub Actions (8h, 12h, 17h e 21h, horário de Brasília).

---

## Como funciona

1. O GitHub Actions roda o script nos horários configurados
2. O script autentica via OAuth 2.0 na API da ALMT (`api.al.mt.gov.br`)
3. Busca proposições do ano corrente filtrando por `protocoloP.ano`
4. Compara com as proposições já registradas em `estado.json`
5. Se há proposições novas → envia email organizado por tipo
6. Salva o estado atualizado no repositório

---

## API utilizada

```
URL base:    https://api.al.mt.gov.br
OAuth:       POST /oauth/v2/token  (grant_type=password)
Proposições: GET  /api/v1/ssl/proposicao/
Docs:        https://api.al.mt.gov.br/api/v1/ssl/proposicao/documentation
```

Autenticação com credenciais institucionais fornecidas pela ALMT.
Token Bearer válido por 3600 segundos — obtido a cada execução.

---

## Estrutura do repositório

```
monitor-proposicoes-mt/
├── monitor.js                      # Script principal
├── package.json                    # Dependências (só nodemailer)
├── estado.json                     # Estado salvo automaticamente
├── README.md                       # Este arquivo
└── .github/
    └── workflows/
        └── monitor.yml             # Workflow do GitHub Actions
```

---

## Setup — Passo a Passo

### PARTE 1 — Preparar o Gmail

**1.1** Acesse [myaccount.google.com/security](https://myaccount.google.com/security)

**1.2** Certifique-se de que a **Verificação em duas etapas** está ativa.

**1.3** Busque por **"Senhas de app"** e clique.

**1.4** Digite o nome `monitor-mt` e clique em **Criar**.

**1.5** Copie a senha de **16 letras** — ela só aparece uma vez.

> Se já tem App Password de outro monitor, pode reutilizar.

---

### PARTE 2 — Criar o repositório no GitHub

**2.1** Acesse [github.com](https://github.com) → **+ → New repository**

**2.2** Preencha:
- **Repository name:** `monitor-proposicoes-mt`
- **Visibility:** Private

**2.3** Clique em **Create repository**

---

### PARTE 3 — Fazer upload dos arquivos

**3.1** Na página do repositório, clique em **"uploading an existing file"**

**3.2** Faça upload de:
```
monitor.js
package.json
README.md
```
Clique em **Commit changes**.

---

### PARTE 4 — Criar o workflow do GitHub Actions

**4.1** No repositório: **Add file → Create new file**

**4.2** No campo de nome, digite exatamente:
```
.github/workflows/monitor.yml
```

**4.3** Cole o conteúdo do arquivo `monitor.yml`. Clique em **Commit changes**.

---

### PARTE 5 — Configurar os Secrets

**Settings → Secrets and variables → Actions → New repository secret**

Crie os **7 secrets**:

| Name | Valor |
|------|-------|
| `EMAIL_REMETENTE` | seu Gmail |
| `EMAIL_SENHA` | senha de 16 letras do App Password (sem espaços) |
| `EMAIL_DESTINO` | email onde quer receber os alertas |
| `ALMT_CLIENT_ID` | client_id fornecido pela ALMT |
| `ALMT_CLIENT_SECRET` | client_secret fornecido pela ALMT |
| `ALMT_USERNAME` | usuário fornecido pela ALMT |
| `ALMT_PASSWORD` | senha fornecida pela ALMT |

---

### PARTE 6 — Testar

**6.1** **Actions → Monitor Proposições MT → Run workflow → Run workflow**

**6.2** Aguarde ~20 segundos e clique no run para ver o log.

**6.3** Resultado esperado:
```
🚀 Iniciando monitor ALMT...
🔑 Obtendo token OAuth...
✅ Token obtido (expira em 3600s)
🔍 Buscando proposições de 2026...
📊 N proposições recebidas
🆕 Proposições novas: N
✅ Email enviado com N proposições novas.
```

**6.4** Verifique a caixa de entrada (e o spam no primeiro email).

---

## Horários de execução

| Horário BRT | Cron UTC |
|-------------|----------|
| 08:00 | `0 11 * * *` |
| 12:00 | `0 15 * * *` |
| 17:00 | `0 20 * * *` |
| 21:00 | `0 0 * * *` |

---

## Resetar o estado

**1.** No repositório, edite `estado.json`

**2.** Substitua por:
```json
{"proposicoes_vistas":[],"ultima_execucao":""}
```

**3.** Commit → rode o workflow manualmente.

---

## Problemas comuns

| Erro | Causa | Solução |
|------|-------|---------|
| `Falha na autenticação OAuth: 401` | Credencial errada ou expirada | Verificar secrets `ALMT_*` |
| `0 proposições encontradas` | Filtro de ano sem resultado | Ver log completo — pode ser mudança no campo da API |
| `Authentication failed` (Gmail) | EMAIL_SENHA com espaços | Remover espaços ao colar |
| Workflow não aparece em Actions | Arquivo não está em `.github/workflows/` | Recriar com o caminho correto |

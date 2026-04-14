const fs = require('fs');
const nodemailer = require('nodemailer');

const EMAIL_DESTINO = process.env.EMAIL_DESTINO;
const EMAIL_REMETENTE = process.env.EMAIL_REMETENTE;
const EMAIL_SENHA = process.env.EMAIL_SENHA;
const ARQUIVO_ESTADO = 'estado.json';

const OAUTH_URL = 'https://api.al.mt.gov.br/oauth/v2/token';
const API_BASE  = 'https://api.al.mt.gov.br/api/v1/ssl';

const CLIENT_ID     = process.env.ALMT_CLIENT_ID;
const CLIENT_SECRET = process.env.ALMT_CLIENT_SECRET;
const ALMT_USERNAME = process.env.ALMT_USERNAME;
const ALMT_PASSWORD = process.env.ALMT_PASSWORD;

// ─── Estado ───────────────────────────────────────────────────────────────────

function carregarEstado() {
  if (fs.existsSync(ARQUIVO_ESTADO))
    return JSON.parse(fs.readFileSync(ARQUIVO_ESTADO, 'utf8'));
  return { proposicoes_vistas: [], ultima_execucao: '' };
}

function salvarEstado(estado) {
  fs.writeFileSync(ARQUIVO_ESTADO, JSON.stringify(estado, null, 2));
}

// ─── OAuth ────────────────────────────────────────────────────────────────────

async function obterToken() {
  console.log('🔑 Obtendo token OAuth...');

  const body = new URLSearchParams({
    grant_type:    'password',
    client_id:     CLIENT_ID,
    client_secret: CLIENT_SECRET,
    username:      ALMT_USERNAME,
    password:      ALMT_PASSWORD,
  });

  const response = await fetch(OAUTH_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Cache-Control': 'no-cache',
    },
    body: body.toString(),
  });

  if (!response.ok) {
    const texto = await response.text();
    throw new Error(`Falha na autenticação OAuth: ${response.status} — ${texto.substring(0, 200)}`);
  }

  const json = await response.json();
  const token = json.access_token;
  const tipo  = json.token_type
    ? json.token_type.charAt(0).toUpperCase() + json.token_type.slice(1)
    : 'Bearer';

  console.log(`✅ Token obtido (expira em ${json.expires_in}s)`);
  return `${tipo} ${token}`;
}

// ─── API ──────────────────────────────────────────────────────────────────────

async function buscarProposicoes(authHeader) {
  const ano = new Date().getFullYear();
  console.log(`🔍 Buscando proposições de ${ano}...`);

  const criterias = JSON.stringify([
    {
      field: 'protocoloP.ano',
      operator: 'equals',
      parameter: { type: 'integer', value: ano },
    },
  ]);

  const todas = [];
  let pagina = 1;

  while (true) {
    const url = `${API_BASE}/proposicao/?page=${pagina}&size=100&criterias=${encodeURIComponent(criterias)}`;
    if (pagina === 1) console.log(`   URL base: ${url}`);

    const response = await fetch(url, {
      method: 'GET',
      headers: { Authorization: authHeader, Accept: 'application/json' },
    });

    if (!response.ok) {
      const texto = await response.text();
      console.error(`❌ Erro na API (página ${pagina}): ${response.status} — ${texto.substring(0, 300)}`);
      break;
    }

    const json = await response.json();
    if (pagina === 1) console.log('📦 Amostra da resposta:', JSON.stringify(json).substring(0, 200));

    const lista =
      Array.isArray(json)          ? json :
      Array.isArray(json.entities) ? json.entities :
      Array.isArray(json.data)     ? json.data :
      Array.isArray(json.content)  ? json.content :
      Array.isArray(json.items)    ? json.items :
      [];

    todas.push(...lista);
    console.log(`📄 Página ${pagina}: ${lista.length} proposições (total acumulado: ${todas.length})`);

    const hasNext = json.pagination?.response?.has_next_page;
    if (!hasNext || lista.length === 0 || pagina >= 200) break;
    pagina++;
    await new Promise(r => setTimeout(r, 500));
  }

  console.log(`📊 Total recebido: ${todas.length} proposições`);
  return todas;
}

// ─── Normalização ─────────────────────────────────────────────────────────────

function normalizarProposicao(p) {
  // Campos mapeados com base na documentação da ALMT
  const id = p.id || p.cp?.id || String(p.cp?.codigo || '');

  const tipo =
    p.tipo?.descricao ||
    p.tipo?.sigla ||
    p.tipoDescricao ||
    p.tipoSigla ||
    '-';

  const numero =
    p.protocoloP?.proposicaoNum ||
    p.numero ||
    p.cp?.codigo ||
    '-';

  const ano =
    p.protocoloP?.ano ||
    p.ano ||
    '-';

  const autor =
    p.autor?.nome ||
    p.cadastroPolitico?.nome ||
    p.autorNome ||
    '-';

  const data =
    p.cp?.dataLeitura
      ? p.cp.dataLeitura.substring(0, 10)
      : p.dataLeitura
        ? p.dataLeitura.substring(0, 10)
        : '-';

  const ementa = (p.cp?.ementa || p.ementa || '-').substring(0, 200);

  return { id: String(id), tipo, numero: String(numero), ano: String(ano), autor, data, ementa };
}

// ─── Email ────────────────────────────────────────────────────────────────────

async function enviarEmail(novas) {
  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user: EMAIL_REMETENTE, pass: EMAIL_SENHA },
  });

  const porTipo = {};
  novas.forEach(p => {
    const tipo = p.tipo || 'OUTROS';
    if (!porTipo[tipo]) porTipo[tipo] = [];
    porTipo[tipo].push(p);
  });

  const linhas = Object.keys(porTipo).sort().map(tipo => {
    const header = `<tr><td colspan="5" style="padding:10px 8px 4px;background:#f0f4f8;font-weight:bold;color:#1a3a5c;font-size:13px;border-top:2px solid #1a3a5c">${tipo} — ${porTipo[tipo].length} proposição(ões)</td></tr>`;
    const rows = porTipo[tipo].map(p =>
      `<tr>
        <td style="padding:8px;border-bottom:1px solid #eee;color:#555;font-size:12px">${p.tipo}</td>
        <td style="padding:8px;border-bottom:1px solid #eee"><strong>${p.numero}/${p.ano}</strong></td>
        <td style="padding:8px;border-bottom:1px solid #eee;font-size:12px">${p.autor}</td>
        <td style="padding:8px;border-bottom:1px solid #eee;font-size:12px;white-space:nowrap">${p.data}</td>
        <td style="padding:8px;border-bottom:1px solid #eee;font-size:12px">${p.ementa}</td>
      </tr>`
    ).join('');
    return header + rows;
  }).join('');

  const html = `
    <div style="font-family:Arial,sans-serif;max-width:900px;margin:0 auto">
      <h2 style="color:#1a3a5c;border-bottom:2px solid #1a3a5c;padding-bottom:8px">
        🏛️ ALMT — ${novas.length} nova(s) proposição(ões)
      </h2>
      <p style="color:#666">Monitoramento automático — ${new Date().toLocaleString('pt-BR')}</p>
      <table style="width:100%;border-collapse:collapse;font-size:14px">
        <thead>
          <tr style="background:#1a3a5c;color:white">
            <th style="padding:10px;text-align:left">Tipo</th>
            <th style="padding:10px;text-align:left">Número/Ano</th>
            <th style="padding:10px;text-align:left">Autor</th>
            <th style="padding:10px;text-align:left">Data</th>
            <th style="padding:10px;text-align:left">Ementa</th>
          </tr>
        </thead>
        <tbody>${linhas}</tbody>
      </table>
      <p style="margin-top:20px;font-size:12px;color:#999">
        Acesse: <a href="https://www.al.mt.gov.br/proposicao">al.mt.gov.br/proposicao</a>
      </p>
    </div>
  `;

  await transporter.sendMail({
    from: `"Monitor ALMT" <${EMAIL_REMETENTE}>`,
    to: EMAIL_DESTINO,
    subject: `🏛️ ALMT: ${novas.length} nova(s) proposição(ões) — ${new Date().toLocaleDateString('pt-BR')}`,
    html,
  });

  console.log(`✅ Email enviado com ${novas.length} proposições novas.`);
}

// ─── Main ─────────────────────────────────────────────────────────────────────

(async () => {
  console.log('🚀 Iniciando monitor ALMT...');
  console.log(`⏰ ${new Date().toLocaleString('pt-BR')}`);

  const estado = carregarEstado();
  const idsVistos = new Set(estado.proposicoes_vistas.map(String));

  let authHeader;
  try {
    authHeader = await obterToken();
  } catch (err) {
    console.error(`❌ ${err.message}`);
    process.exit(1);
  }

  const raw = await buscarProposicoes(authHeader);

  if (raw.length === 0) {
    console.log('⚠️ Nenhuma proposição encontrada.');
    process.exit(0);
  }

  const proposicoes = raw.map(normalizarProposicao).filter(p => p.id && p.id !== '');
  console.log(`📊 Total normalizado: ${proposicoes.length}`);

  const novas = proposicoes.filter(p => !idsVistos.has(p.id));
  console.log(`🆕 Proposições novas: ${novas.length}`);

  if (novas.length > 0) {
    novas.sort((a, b) => {
      if (a.tipo < b.tipo) return -1;
      if (a.tipo > b.tipo) return 1;
      return (parseInt(b.numero) || 0) - (parseInt(a.numero) || 0);
    });
    await enviarEmail(novas);
    novas.forEach(p => idsVistos.add(p.id));
    estado.proposicoes_vistas = Array.from(idsVistos);
  } else {
    console.log('✅ Sem novidades. Nada a enviar.');
  }

  estado.ultima_execucao = new Date().toISOString();
  salvarEstado(estado);
})();

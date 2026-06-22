const fs = require('fs');
const nodemailer = require('nodemailer');

const EMAIL_DESTINO   = process.env.EMAIL_DESTINO;
const EMAIL_REMETENTE = process.env.EMAIL_REMETENTE;
const EMAIL_SENHA     = process.env.EMAIL_SENHA;
const ARQUIVO_ESTADO  = 'estado.json';

const OAUTH_URL = 'https://api.al.mt.gov.br/oauth/v2/token';
const API_BASE  = 'https://api.al.mt.gov.br/api/v1/ssl/proposicao/';

const CLIENT_ID     = process.env.ALMT_CLIENT_ID;
const CLIENT_SECRET = process.env.ALMT_CLIENT_SECRET;
const ALMT_USERNAME = process.env.ALMT_USERNAME;
const ALMT_PASSWORD = process.env.ALMT_PASSWORD;

// ─── Estado ───────────────────────────────────────────────────────────────────

function carregarEstado() {
  if (fs.existsSync(ARQUIVO_ESTADO))
    return JSON.parse(fs.readFileSync(ARQUIVO_ESTADO, 'utf8'));
  return { ultimo_id: 0, ultima_execucao: '' };
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
      'Content-Type':  'application/x-www-form-urlencoded',
      'Cache-Control': 'no-cache',
    },
    body: body.toString(),
  });

  if (!response.ok) {
    const texto = await response.text();
    throw new Error(`Falha na autenticação OAuth: ${response.status} — ${texto.substring(0, 200)}`);
  }

  const json = await response.json();
  const tipo  = json.token_type
    ? json.token_type.charAt(0).toUpperCase() + json.token_type.slice(1)
    : 'Bearer';

  console.log(`✅ Token obtido (expira em ${json.expires_in}s)`);
  return `${tipo} ${json.access_token}`;
}

// ─── API com cursor por ID ────────────────────────────────────────────────────

async function buscarProposicoes(authHeader, ultimoIdVisto) {
  const anoAtual = new Date().getFullYear();
  console.log(`🔍 Buscando proposições de ${anoAtual} com ID > ${ultimoIdVisto}...`);

  const todas = [];
  let cursorId = ultimoIdVisto;
  let pagina = 1;

  while (true) {
    const criterias = JSON.stringify([
      {
        field: 'protocoloP.ano',
        operator: 'greater-than-or-equals',
        parameter: { type: 'integer', value: anoAtual },
      },
      {
        field: 'cp.id',
        operator: 'greater-than',
        parameter: { type: 'integer', value: cursorId },
      },
    ]);

    const url = `${API_BASE}?criterias=${encodeURIComponent(criterias)}`;

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        Authorization: authHeader,
        Accept: 'application/json',
      },
    });

    if (!response.ok) {
      const texto = await response.text();
      console.error(`❌ Erro na API: ${response.status} — ${texto.substring(0, 200)}`);
      break;
    }

    const json = await response.json();
    const entidades = Array.isArray(json.entities) ? json.entities : [];

    if (entidades.length === 0) {
      console.log(`✅ Sem mais proposições após ID ${cursorId}.`);
      break;
    }

    todas.push(...entidades);

    const ultimoDaPagina = entidades[entidades.length - 1].id;
    console.log(`📄 Página ${pagina}: ${entidades.length} proposições (IDs ${entidades[0].id}–${ultimoDaPagina})`);

    cursorId = ultimoDaPagina;
    pagina++;

    await new Promise(r => setTimeout(r, 150));

    if (pagina > 200) {
      console.log('⚠️ Limite de 200 páginas atingido. Continuará na próxima execução.');
      break;
    }
  }

  console.log(`📊 Total encontrado: ${todas.length} proposições`);
  return todas;
}

// ─── Normalização ─────────────────────────────────────────────────────────────

function normalizarProposicao(p) {
  return {
    id:     String(p.id || ''),
    tipo:   p.tipo?.descricao || '-',
    numero: String(p.protocoloP?.proposicaoNum || '-'),
    ano:    String(p.protocoloP?.ano || '-'),
    autor:  p.autor?.nome || '-',
    data:   p.data_leitura?.date ? p.data_leitura.date.substring(0, 10) : '-',
    ementa: (p.ementa || '-'),
    url:    p.url || '',
  };
}

// ─── Email ────────────────────────────────────────────────────────────────────

function prioridadeTipoEmail(tipo) {
  const t = String(tipo || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .trim();

  if (/^(PL|PLO)(\b|$)/.test(t) || /^PROJETO DE LEI( ORDINARIA)?$/.test(t)) return 0;
  if (/^PLC(\b|$)/.test(t) || /^PROJETO DE LEI COMPLEMENTAR/.test(t)) return 1;
  if (/^PEC(\b|$)/.test(t) || /^(PROPOSTA|PROJETO) DE EMENDA (A )?CONSTITUCIONAL/.test(t)) return 2;
  return 10;
}

function compararTiposEmail(a, b) {
  const prioridadeA = prioridadeTipoEmail(a);
  const prioridadeB = prioridadeTipoEmail(b);
  if (prioridadeA !== prioridadeB) return prioridadeA - prioridadeB;
  return String(a || '').localeCompare(String(b || ''), 'pt-BR');
}


const CLIENTES_NOMES_PROPRIOS = [
  'FIRJAN', 'Red Bull', 'Sindicerv', 'Boticario',
  'Boticário', 'Grupo Boticario', 'Grupo Boticário', 'O Boticario',
  'O Boticário', 'Abrasel', 'Abrasel PB', 'Abrasel Paraíba',
  'ANBRASEL', 'Ambev', 'Heineken', 'Abralatas',
  'ABIR', 'Coca-Cola', 'Coca Cola', 'Coca-Cola Company',
  'Femsa', 'Solar', 'Grupo Simões', 'Grupo Simoes',
  'Andina', 'CVI', 'iFood', 'Zé Delivery',
  'Ze Delivery', 'Verde Brasil', 'JCRIG', 'Associação dos Cemitérios e Crematórios do Brasil',
  'Associacao dos Cemiterios e Crematorios do Brasil', 'Lalamove', 'Matrix', 'CVC',
  'Rei do Pitaco', 'Maersk', 'Mac Jee', 'Norte Energia',
  'Pacto Pela Fome', 'Sanofi', 'TikTok', 'Minalba',
  'Esmaltec', 'Nacional Gás', 'Nacional Gas', 'Syngenta',
  'Braskem', 'Ypê', 'Ype', 'VTal',
  'V.tal', 'Grupo EPR', 'EPR', 'Natural Energia',
  'DIAGEO', 'Alpargatas', 'Ternium', 'ABRADEE',
  'Eletrobras', 'Eletrobrás', 'MeetKai', 'IPQ',
  'Equatorial', 'EquatorialEnergia', 'Equatorial Energia', 'Equatorial Goiás',
  'Equatorial Goias', 'Equatorial Goiás Distribuidora de Energia', 'Equatorial Goias Distribuidora de Energia', 'CEA Equatorial',
  'CEA Equatorial Energia', 'Equtorial', 'Energisa', 'EnergisaLuz',
  'Neoenergia', 'ENEL', 'Ampla Energia', 'SABESP',
  'COMGAS', 'COMGÁS', 'AEGEA', 'Aegea Saneamento',
  'Águas de Teresina', 'Aguas de Teresina', 'Águas de Timon', 'Aguas de Timon',
  'Águas do Rio', 'Aguas do Rio', 'Águas do Rio 1', 'Águas do Rio 4',
  'Naturgy', 'Agenersa', 'Regenera', 'Comlurb',
  'Hekos', 'Orizon', 'Solvi', 'União Norte',
  'Uniao Norte', 'Vital', 'Eletromidia', 'Eletromídia',
  'AkzoNobel', 'Expedia', 'Hotels.com', 'Vrbo',
  'RTSC', 'Gramado Parks', 'Grupo Wish', 'Huawei',
  'Carrefour', 'Atacadão', 'Atacadao', 'Walmart',
  "Sam's Club", 'Sams Club', 'JBS', 'Friboi',
  'Seara', 'Swift', "Pilgrim's", 'Pilgrims',
  'Wild Fork', 'Ajinomoto', 'Vibra', 'Vibra Energia',
  'BR Distribuidora', 'Raízen', 'Raizen', 'Mindlab',
  'ABVTEX', 'Semove', 'Barcas', 'Seta',
  'Nova Infra', 'BRT'
];

function clientesCitadosNaProposicao(p) {
  const texto = [p.cliente, p.clientes, p.autor, p.autores, p.tipo, p.rotulo, p.titulo, p.identificacao, p.ementa]
    .filter(Boolean)
    .join(' ');
  const achados = [];
  for (const nome of CLIENTES_NOMES_PROPRIOS) {
    const escaped = nome.replace(/[.*+?^\${}()|[\]\\]/g, '\\$&');
    const re = new RegExp('(^|[^A-Za-zÀ-ÿ0-9])' + escaped + '([^A-Za-zÀ-ÿ0-9]|$)', 'i');
    if (re.test(texto) && !achados.some(a => a.toLowerCase() === nome.toLowerCase())) achados.push(nome);
  }
  return achados;
}

function anotarClientesCitados(proposicoes) {
  for (const p of proposicoes || []) {
    const clientes = clientesCitadosNaProposicao(p);
    p.clientesCitados = clientes;
    if (clientes.length && p.ementa && !String(p.ementa).includes('Cliente citado:')) {
      p.ementa = String(p.ementa).trim() + ' | Cliente citado: ' + clientes.join(', ');
    }
  }
}

function mlEscapeHtmlClienteDestaque(valor) {
  return String(valor ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function mlEscapeRegExpClienteDestaque(valor) {
  return String(valor).replace(/[.*+?^\${}()|[\]\\]/g, '\\$&');
}

function mlDestacarTermosClienteEmail(texto, clientes) {
  const nomes = Array.from(new Set([...(clientes || []), ...CLIENTES_NOMES_PROPRIOS]))
    .filter(Boolean)
    .sort((a, b) => b.length - a.length);
  if (!nomes.length) return mlEscapeHtmlClienteDestaque(texto);

  const regex = new RegExp('(^|[^A-Za-zÀ-ÿ0-9])(' + nomes.map(mlEscapeRegExpClienteDestaque).join('|') + ')(?=[^A-Za-zÀ-ÿ0-9]|$)', 'gi');
  return mlEscapeHtmlClienteDestaque(texto).replace(regex, (match, prefixo, termo) => {
    return prefixo + '<span style="background:#dbeafe;color:#1e3a8a;font-weight:700;border-radius:3px;padding:1px 3px">' + termo + '</span>';
  });
}

function renderizarEmentaCliente(p, renderBase) {
  const texto = String((p && p.ementa) || '-');
  const partes = texto.split(/\s+\|\s+Cliente citado:\s+/i);
  const ementa = renderBase
    ? renderBase(partes[0])
    : mlDestacarTermosClienteEmail(partes[0], p && p.clientesCitados);
  const clientes = partes.length > 1
    ? partes.slice(1).join(' | Cliente citado: ')
    : ((p && p.clientesCitados) || []).join(', ');

  if (!clientes) return ementa;
  return ementa + '<div style="margin-top:6px">' +
    '<span style="display:inline-block;background:#eef6ff;border:1px solid #bfdbfe;color:#1e3a8a;border-radius:999px;padding:3px 8px;font-size:11px;font-weight:700">' +
    'Cliente citado: ' + mlDestacarTermosClienteEmail(clientes, p && p.clientesCitados) +
    '</span></div>';
}

async function enviarEmail(novas) {
  anotarClientesCitados(novas);
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

  const avisoVolume = novas.length > 50
    ? `<div style="background:#fff3cd;border:1px solid #ffc107;padding:12px 16px;border-radius:4px;margin-bottom:16px;color:#856404;font-size:13px">
        ⚠️ <strong>Volume alto:</strong> ${novas.length} proposições novas nesta execução. Pode ser o primeiro run.
       </div>`
    : '';

  const linhas = Object.keys(porTipo).sort(compararTiposEmail).map(tipo => {
    const header = `<tr><td colspan="5" style="padding:10px 8px 4px;background:#f0f4f8;font-weight:bold;color:#1a3a5c;font-size:13px;border-top:2px solid #1a3a5c">${tipo} — ${porTipo[tipo].length} proposição(ões)</td></tr>`;
    const rows = porTipo[tipo].map(p => {
      const link = p.url
        ? `<a href="${p.url}" style="color:#1a3a5c;text-decoration:none" target="_blank">${p.numero}/${p.ano}</a>`
        : `${p.numero}/${p.ano}`;
      return `<tr>
        <td style="padding:8px;border-bottom:1px solid #eee;color:#555;font-size:12px">${p.tipo}</td>
        <td style="padding:8px;border-bottom:1px solid #eee"><strong>${link}</strong></td>
        <td style="padding:8px;border-bottom:1px solid #eee;font-size:12px">${p.autor}</td>
        <td style="padding:8px;border-bottom:1px solid #eee;font-size:12px;white-space:nowrap">${p.data}</td>
        <td style="padding:8px;border-bottom:1px solid #eee;font-size:12px">${renderizarEmentaCliente(p)}</td>
      </tr>`;
    }).join('');
    return header + rows;
  }).join('');

  const html = `
    <div style="font-family:Arial,sans-serif;max-width:900px;margin:0 auto">
      <h2 style="color:#1a3a5c;border-bottom:2px solid #1a3a5c;padding-bottom:8px">
        🏛️ ALMT — ${novas.length} nova(s) proposição(ões)
      </h2>
      <p style="color:#666">Monitoramento automático — ${new Date().toLocaleString('pt-BR')}</p>
      ${avisoVolume}
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
    subject: `🏛️ Mato Grosso: ${novas.length} nova(s) proposição(ões) — ${new Date().toLocaleDateString('pt-BR')}`,
    html,
  });

  console.log(`✅ Email enviado com ${novas.length} proposições novas.`);
}

// ─── Main ─────────────────────────────────────────────────────────────────────

(async () => {
  console.log('🚀 Iniciando monitor ALMT...');
  console.log(`⏰ ${new Date().toLocaleString('pt-BR')}`);

  const estado   = carregarEstado();
  const ultimoId = estado.ultimo_id || 0;

  let authHeader;
  try {
    authHeader = await obterToken();
  } catch (err) {
    console.error(`❌ ${err.message}`);
    process.exit(1);
  }

  const raw = await buscarProposicoes(authHeader, ultimoId);

  if (raw.length === 0) {
    console.log('✅ Sem novidades. Nada a enviar.');
    estado.ultima_execucao = new Date().toISOString();
    salvarEstado(estado);
    process.exit(0);
  }

  const novas = raw.map(normalizarProposicao).filter(p => p.id);
  console.log(`🆕 Proposições novas: ${novas.length}`);

  const maiorId = Math.max(...raw.map(p => Number(p.id)));

  novas.sort((a, b) => {
    if (a.tipo < b.tipo) return -1;
    if (a.tipo > b.tipo) return 1;
    return (parseInt(b.numero) || 0) - (parseInt(a.numero) || 0);
  });

  await enviarEmail(novas);

  estado.ultimo_id       = maiorId;
  estado.ultima_execucao = new Date().toISOString();
  salvarEstado(estado);
})();

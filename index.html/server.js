const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

// Máquina de Estados da Triagem (Por número de cliente)
const sessions = {};

const SUB_MENUS = {
  'DP': {
    sectorLabel: 'Departamento Pessoal',
    options: {
      '1': '1. Enviar dados para Admissão',
      '2': '2. Solicitar cálculo de Rescisão ou Férias',
      '3': '3. Dúvidas sobre Folha / Guias (FGTS/INSS)',
      '4': '4. Outros'
    }
  },
  'FISCAL': {
    sectorLabel: 'Fiscal / Tributário',
    options: {
      '1': '1. Emissão de Nota Fiscal',
      '2': '2. Guias de Impostos (DAS / DARF / ICMS)',
      '3': '3. Envio de XML / Arquivos Fiscais',
      '4': '4. Outros'
    }
  },
  'CONTABIL': {
    sectorLabel: 'Contábil',
    options: {
      '1': '1. Solicitar Balanço ou DRE',
      '2': '2. Envio de Extratos Bancários',
      '3': '3. Informe de Rendimentos',
      '4': '4. Outros'
    }
  },
  'SOCIETARIO': {
    sectorLabel: 'Societário / Legalização',
    options: {
      '1': '1. Abertura de Empresa',
      '2': '2. Alteração Contratual',
      '3': '3. Alvarás e Certidões Negativas',
      '4': '4. Outros'
    }
  },
  'FINANCEIRO': {
    sectorLabel: 'Financeiro Solare',
    options: {
      '1': '1. 2ª Via de Boleto de Honorários',
      '2': '2. Envio de Comprovante de Pagamento',
      '3': '3. Negociação / Contrato',
      '4': '4. Outros'
    }
  }
};

const client = new Client({
  authStrategy: new LocalAuth({ clientId: 'solare-main' }),
  puppeteer: { args: ['--no-sandbox', '--disable-setuid-sandbox'] }
});

client.on('qr', (qr) => {
  console.log('ESCANEIE O QR CODE ABAIXO COM O WHATSAPP DA SOLARE:');
  qrcode.generate(qr, { small: true });
  io.emit('qr', qr);
});

client.on('ready', () => {
  console.log('✅ WhatsApp da Solare Contabilidade conectado e pronto!');
  io.emit('ready', true);
});

client.on('message', async (msg) => {
  if (msg.from.includes('@g.us')) return; // Ignora grupos

  const from = msg.from;
  const text = msg.body.trim();

  if (!sessions[from]) {
    sessions[from] = { step: 1, cnpj: '', sectorKey: '', subOption: '' };
    await msg.reply(
      'Olá! Bem-vindo(a) ao atendimento digital da *Solare Contabilidade*.\n\n' +
      'Para iniciarmos, digite o *CNPJ ou CPF* da sua empresa:'
    );
    return;
  }

  const state = sessions[from];

  if (state.step === 1) {
    state.cnpj = text;
    state.step = 2;
    await msg.reply(
      'Perfeito! Sobre qual setor você precisa falar hoje? Digite o número:\n\n' +
      '1️⃣ *Departamento Pessoal* (Folha, Férias, Admissão, Rescisão)\n' +
      '2️⃣ *Fiscal / Tributário* (Notas Fiscais, DAS, DARF)\n' +
      '3️⃣ *Contábil* (Balanços, DRE, Informes)\n' +
      '4️⃣ *Societário* (Abertura, Alteração, Alvarás)\n' +
      '5️⃣ *Financeiro Solare* (Honorários, Boletos)'
    );
  } else if (state.step === 2) {
    const sectorMap = { '1': 'DP', '2': 'FISCAL', '3': 'CONTABIL', '4': 'SOCIETARIO', '5': 'FINANCEIRO' };
    const chosen = sectorMap[text];
    if (!chosen) {
      await msg.reply('⚠️ Opção inválida. Digite um número de 1 a 5:');
      return;
    }
    state.sectorKey = chosen;
    state.step = 3;
    const menu = SUB_MENUS[chosen];
    const optionsList = Object.values(menu.options).join('\n');
    await msg.reply(`Entendido! Qual é a sua demanda no setor *${menu.sectorLabel}*?\n\n${optionsList}`);
  } else if (state.step === 3) {
    const menu = SUB_MENUS[state.sectorKey];
    const subChosen = menu.options[text];
    if (!subChosen) {
      await msg.reply('⚠️ Digite uma opção válida de 1 a 4:');
      return;
    }
    state.subOption = subChosen;
    state.step = 4;
    await msg.reply(`Certo (${subChosen}).\n\nPor favor, descreva agora sua solicitação em uma única mensagem para direcionarmos ao colaborador responsável:`);
  } else if (state.step === 4) {
    const protocol = '#SOL-' + Math.floor(100000 + Math.random() * 900000);
    state.step = 5; // Em atendimento humano

    // Envia para o Painel Web em Tempo Real
    io.emit('new_ticket', {
      protocol,
      phone: from,
      cnpj: state.cnpj,
      sector: state.sectorKey,
      subDemand: state.subOption,
      initialMessage: text
    });

    await msg.reply(`✅ *Protocolo ${protocol} gerado!*\nSua demanda foi direcionada para o setor *${SUB_MENUS[state.sectorKey].sectorLabel}*. Em instantes nosso colaborador assumirá o atendimento.`);
  } else if (state.step === 5) {
    io.emit('client_message', { phone: from, text });
  }
});

// Disparo de mensagens do Colaborador no Site para o WhatsApp do Cliente
io.on('connection', (socket) => {
  socket.on('agent_reply', async ({ phone, agentName, sectorName, message }) => {
    const formatted = `*${agentName} - ${sectorName}:*\n${message}`;
    await client.sendMessage(phone, formatted);
  });
});

client.initialize();

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🚀 Solare Desk rodando em http://localhost:${PORT}`);
});

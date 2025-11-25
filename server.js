// server.js
// Webhook para WhatsApp Cloud API + alerta por palavra-chave (via Telegram)

const express = require('express');
const crypto = require('crypto');
const fs = require('fs-extra');
const fetch = require('node-fetch');
const path = require('path');

const app = express();
app.use(express.json({ limit: '10mb' }));

// ====== CONFIGURAÇÕES ======
const PORT = process.env.PORT || 10000;

// pasta onde as mensagens serão arquivadas
const ARCHIVE_DIR = path.join(__dirname, 'archive');

// Telegram (para receber alertas)
const TELEGRAM_TOKEN = process.env.TG_TOKEN;      // token do bot
const TELEGRAM_CHAT_ID = process.env.TG_CHAT_ID;  // seu chat id

// Token de verificação do webhook do Meta (mesmo que você configurar na Cloud API)
const VERIFY_TOKEN = process.env.VERIFY_TOKEN || 'lotus_verify_token';

// Palavras-chave para monitorar (personalizadas)
const KEYWORDS = [
  'roni',
  'thiago',
  'roni está disponível',
  'somente com o roni'
];

// ====== FUNÇÕES AUXILIARES ======

async function sendTelegram(text) {
  try {
    if (!TELEGRAM_TOKEN || !TELEGRAM_CHAT_ID) {
      console.log('Alerta (Telegram não configurado):', text);
      return;
    }

    const url = `https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`;
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: TELEGRAM_CHAT_ID,
        text,
        parse_mode: 'HTML'
      })
    });
  } catch (err) {
    console.error('Erro ao enviar alerta para Telegram:', err.message);
  }
}

async function saveArchive(id, payload) {
  await fs.ensureDir(ARCHIVE_DIR);
  const filePath = path.join(ARCHIVE_DIR, `${id}.json`);
  const body = JSON.stringify(payload, null, 2);
  await fs.writeFile(filePath, body);

  const sha = crypto.createHash('sha256').update(body).digest('hex');
  await fs.writeFile(filePath + '.sha256', sha);

  return { filePath, sha };
}

function checkKeywords(text) {
  if (!text) return [];
  const lower = text.toLowerCase();
  return KEYWORDS.filter(kw => lower.includes(kw.toLowerCase()));
}

// ====== ROTAS ======

// Rota simples só para testar se está no ar
app.get('/', (req, res) => {
  res.send('Webhook do WhatsApp Estúdio Lótus ativo.');
});

// GET /webhook -> usado pelo Meta para VERIFICAR o webhook na hora de conectar
app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === VERIFY_TOKEN) {
    console.log('Webhook verificado com sucesso.');
    return res.status(200).send(challenge);
  }

  console.log('Falha na verificação do webhook.');
  return res.sendStatus(403);
});

// POST /webhook -> aqui chegam as mensagens de verdade
app.post('/webhook', async (req, res) => {
  const body = req.body;

  try {
    let msgId = crypto.randomUUID();
    let messageObj = null;
    let from = 'desconhecido';
    let timestamp = '';
    let text = '';

    // Formato padrão da WhatsApp Cloud API
    if (body.entry && body.entry[0]?.changes && body.entry[0].changes[0]?.value) {
      const value = body.entry[0].changes[0].value;
      const messages = value.messages || [];
      if (messages.length > 0) {
        messageObj = messages[0];
        msgId = messageObj.id || msgId;
        from = messageObj.from || from;
        timestamp = messageObj.timestamp || '';
        if (messageObj.type === 'text' && messageObj.text?.body) {
          text = messageObj.text.body;
        }
      }
    }

    // Arquiva o payload inteiro
    const { filePath, sha } = await saveArchive(msgId, body);
    console.log('Mensagem arquivada:', msgId, filePath);

    // 1) Alerta por palavra-chave
    if (text) {
      const found = checkKeywords(text);
      if (found.length > 0) {
        const alertText =
          `🔔 Palavra-chave detectada\n` +
          `De: ${from}\n` +
          `ID: ${msgId}\n` +
          `Quando: ${timestamp}\n` +
          `Texto: "${text}"\n` +
          `Palavras: ${found.join(', ')}\n` +
          `Arquivo: ${filePath}\n` +
          `SHA256: ${sha}`;
        await sendTelegram(alertText);
      }
    }

    // 2) Tentativa simples de detectar "delete" no payload (depende do provedor)
    const jsonString = JSON.stringify(body).toLowerCase();
    if (jsonString.includes('delete') || jsonString.includes('deleted')) {
      const delText =
        `⚠️ Possível mensagem deletada\n` +
        `ID: ${msgId}\n` +
        `Arquivo: ${filePath}\n` +
        `SHA256: ${sha}`;
      await sendTelegram(delText);
    }

    res.sendStatus(200);
  } catch (err) {
    console.error('Erro ao processar webhook:', err);
    res.sendStatus(500);
  }
});

// ====== INÍCIO DO SERVIDOR ======
app.listen(PORT, () => {
  console.log(`Servidor do webhook rodando na porta ${PORT}`);
});

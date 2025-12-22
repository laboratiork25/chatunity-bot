process.env['NODE_TLS_REJECT_UNAUTHORIZED'] = '1';
import './config.js';
import { createRequire } from 'module';
import path, { join } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { platform } from 'process';
import fs, { readdirSync, statSync, unlinkSync, existsSync, mkdirSync, rmSync, watch } from 'fs';
import yargs from 'yargs';
import { spawn } from 'child_process';
import lodash from 'lodash';
import chalk from 'chalk';
import syntaxerror from 'syntax-error';
import { tmpdir } from 'os';
import { format } from 'util';
import pino from 'pino';
import { makeWASocket, protoType, serialize } from './lib/simple.js';
import { Low, JSONFile } from 'lowdb';
import readline from 'readline';
import NodeCache from 'node-cache';

const sessionFolder = path.join(process.cwd(), 'sessioni');
const tempDir = join(process.cwd(), 'temp');
const tmpDir = join(process.cwd(), 'tmp');

if (!existsSync(tempDir)) mkdirSync(tempDir, { recursive: true });
if (!existsSync(tmpDir)) mkdirSync(tmpDir, { recursive: true });

let stopped = 'open';
global.isLogoPrinted = false;
global.qrGenerated = false;
global.connectionMessagesPrinted = {};
global.conns = [];
global.handler = null; // ✅ IMPORTANTE: Inizializzato qui

// Timer
setInterval(async () => {
  if (stopped === 'close' || !global.conn?.user) return;
  clearSessionFolderSelective();
}, 30 * 60 * 1000);

function clearSessionFolderSelective(dir = sessionFolder) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
    return;
  }
  const entries = fs.readdirSync(dir);
  for (const entry of entries) {
    const fullPath = path.join(dir, entry);
    if (entry === 'creds.json') continue;
    const stat = fs.statSync(fullPath);
    if (stat.isDirectory()) {
      clearSessionFolderSelective(fullPath);
      fs.rmdirSync(fullPath);
    } else if (!entry.startsWith('pre-key')) {
      try { fs.unlinkSync(fullPath); } catch {}
    }
  }
}

// Baileys imports
const { useMultiFileAuthState, fetchLatestBaileysVersion, makeCacheableSignalKeyStore, Browsers, jidNormalizedUser, makeInMemoryStore, DisconnectReason } = await import('@chatunity/baileys');
const { chain } = lodash;
protoType();
serialize();

const PORT = process.env.PORT || 3000;
let methodCodeQR = process.argv.includes("qr");
let methodCode = process.argv.includes("code");
let MethodMobile = process.argv.includes("mobile");

function generateRandomCode(length = 8) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

// ✅ CONSOLE FILTER SEMPLIFICATO (dopo tutti gli import)
function safeConsoleFilter() {
  const filterStrings = [
    "Q2xvc2luZyBzdGFsZSBvcGVu","Q2xvc2luZyBvcGVuIHNlc3Npb24=",
    "RmFpbGVkIHRvIGRlY3J5cHQ=","U2Vzc2lvbiBlcnJvcg==","RXJyb3I6IEJhZCBNQUM=",
    "RGVjcnlwdGVkIG1lc3NhZ2U="
  ];
  
  ['log', 'warn', 'error'].forEach(method => {
    if (typeof console[method] === 'function') {
      const original = console[method];
      console[method] = (...args) => {
        if (args[0] && typeof args[0] === 'string' && 
            filterStrings.some(f => args[0].includes(atob(f)))) {
          args[0] = '[FILTRATO]';
        }
        original.apply(console, args);
      };
    }
  });
}

safeConsoleFilter();

global.__filename = (pathURL = import.meta.url, rmPrefix = platform !== 'win32') => 
  rmPrefix ? /file:\/\/\//.test(pathURL) ? fileURLToPath(pathURL) : pathURL : pathToFileURL(pathURL).toString();

global.__dirname = (pathURL) => path.dirname(global.__filename(pathURL, true));
global.__require = (dir = import.meta.url) => createRequire(dir);

global.opts = new Object(yargs(process.argv.slice(2)).exitProcess(false).parse());
global.prefix = new RegExp('^[' + (opts['prefix'] || '*/!#$%+£¢€¥^°=¶∆×÷π√✓©®&.\\-.@').replace(/[|\\{}()[\]^$+*.\-\^]/g, '\\$&') + ']');

global.db = new Low(/https?:\/\//.test(opts['db'] || '') ? new cloudDBAdapter(opts['db']) : new JSONFile('database.json'));
global.loadDatabase = async () => {
  if (global.db.data !== null) return global.db.data;
  global.db.READ = true;
  await global.db.read().catch(console.error);
  global.db.READ = false;
  global.db.data = {
    users: {}, chats: {}, stats: {}, msgs: {}, sticker: {}, settings: {},
    ...(global.db.data || {}),
  };
  global.db.chain = chain(global.db.data);
  return global.db.data;
};

await global.loadDatabase();

global.creds = 'creds.json';
global.authFile = 'sessioni';
global.authFileJB = 'chatunity-sub';

const { state, saveCreds } = await useMultiFileAuthState(global.authFile);
const msgRetryCounterCache = new NodeCache();
const msgRetryCounterMap = () => {};
const { version } = await fetchLatestBaileysVersion();

let rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const question = (text) => new Promise(resolve => {
  rl.question(text, answer => resolve(answer.trim()));
});

let opzione = '1';
if (!methodCodeQR && !methodCode && !fs.existsSync(`./${global.authFile}/creds.json`)) {
  const menu = `╭★────★────★────★
│ 1️⃣ QR Code
│ 2️⃣ Codice 8 caratteri
╰★────★────★────★`;
  do {
    opzione = await question(menu + '\nScelta: ');
  } while (!/^[1-2]$/.test(opzione));
}

const logger = pino({ level: 'silent' });
global.store = makeInMemoryStore({ logger });
global.jidCache = new NodeCache({ stdTTL: 600 });
global.groupCache = new NodeCache({ stdTTL: 300 });

const connectionOptions = {
  logger, printQRInTerminal: opzione === '1',
  mobile: MethodMobile,
  auth: { creds: state.creds, keys: makeCacheableSignalKeyStore(state.keys, logger) },
  browser: Browsers.windows('Chrome'),
  version,
  generateHighQualityLinkPreview: true,
  msgRetryCounterCache, msgRetryCounterMap
};

global.conn = makeWASocket(connectionOptions);
global.store.bind(global.conn.ev);

// ✅ HANDLER DEFINITO SEMPRE (fallback incluso)
global.reloadHandler = async (restart = false) => {
  console.log(chalk.yellow('🔄 Caricamento handler...'));
  
  try {
    if (fs.existsSync('./handler.js')) {
      const Handler = await import('./handler.js');
      global.handler = Handler.default || Handler;
      console.log(chalk.green('✅ Handler caricato da handler.js'));
    } else {
      console.log(chalk.yellow('⚠️ handler.js non trovato, uso handler minimale'));
      // ✅ FALLBACK HANDLER MINIMALE
      global.handler = {
        handler: async (m) => {
          if (!m.message) return;
          const text = m.text || '';
          if (text && text.startsWith('ping')) {
            await m.reply('Pong! ✅');
          } else if (text === '.menu') {
            await m.reply(`🔥 ChatUnity Bot attivo!
• ping - Test connessione
• .menu - Questo menu
• Prefix: ${global.prefix.source}`);
          }
        }
      };
    }
  } catch (e) {
    console.error(chalk.red('❌ Errore handler:', e.message);
    // ✅ Fallback sempre attivo
    global.handler = {
      handler: async (m) => {
        if (m.text === 'ping') await m.reply('Pong! Bot OK');
        if (m.text === '.menu') await m.reply('Bot attivo! Prova "ping"');
      }
    };
  }

  // ✅ BIND EVENTI SEMPRE
  if (global.conn && global.handler?.handler) {
    global.conn.ev.off('messages.upsert');
    global.conn.ev.on('messages.upsert', (...args) => {
      global.handler.handler(...args);
    });
    console.log(chalk.green('✅ Event listener messaggi attivi'));
  }

  if (restart && global.conn) {
    global.conn.ws?.close();
  }
  
  global.conn.isInit = true;
  return true;
};

// ✅ EVENTI BASE
global.conn.ev.on('creds.update', saveCreds);

async function connectionUpdate(update) {
  const { connection, lastDisconnect, qr } = update;
  global.stopped = connection;

  if (qr && opzione === '1') {
    console.log(chalk.bold.yellow('📱 SCANSIONA QR (60s)'));
    global.qrGenerated = true;
  }

  if (connection === 'open') {
    console.log(chalk.bold.green('✅ CONNESSO CON SUCCESSO!'));
    global.qrGenerated = false;
    
    if (!global.isLogoPrinted) {
      console.log(chalk.hex('#3b0d95')('🔥 CHATUNITY BOT ATTIVO'));
      global.isLogoPrinted = true;
    }
    
    // ✅ CARICA HANDLER ALLA CONNESSIONE
    await global.reloadHandler();
    console.log(chalk.green('🎉 Bot pronto! Prova: ping o .menu'));
  }

  if (connection === 'close') {
    const code = lastDisconnect?.error?.output?.statusCode;
    console.log(chalk.red(`❌ Disconnesso: ${code}`));
    if (code !== DisconnectReason.loggedOut) {
      setTimeout(() => global.reloadHandler(true), 3000);
    }
  }
}

global.conn.ev.on('connection.update', connectionUpdate);

// ✅ AVVIO IMMEDIATO
console.log(chalk.cyan('🚀 Avvio ChatUnity...'));
await global.reloadHandler();
console.log(chalk.green('✅ Inizializzazione completata!'));

// ✅ PLUGIN SYSTEM (opzionale)
if (fs.existsSync('./plugins/index')) {
  const pluginFolder = './plugins/index';
  global.plugins = {};
  
  async function loadPlugins() {
    for (const file of readdirSync(pluginFolder).filter(f => f.endsWith('.js'))) {
      try {
        const mod = await import(join(pluginFolder, file));
        global.plugins[file] = mod.default || mod;
        console.log(chalk.green(`✅ Plugin: ${file}`));
      } catch (e) {
        console.error(chalk.red(`❌ Plugin ${file}: ${e.message}`));
      }
    }
  }
  loadPlugins();
}

process.on('uncaughtException', console.error);

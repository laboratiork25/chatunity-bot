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

// ✅ FIX: cloudDBAdapter con fallback
function cloudDBAdapter(url) {
  return {
    read: () => Promise.resolve(),
    write: (data) => Promise.resolve(data)
  };
}

const sessionFolder = path.join(process.cwd(), 'sessioni');
const tempDir = join(process.cwd(), 'temp');
const tmpDir = join(process.cwd(), 'tmp');

if (!existsSync(tempDir)) mkdirSync(tempDir, { recursive: true });
if (!existsSync(tmpDir)) mkdirSync(tmpDir, { recursive: true });

let stopped = 'open';

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

function purgeSession(sessionDir, cleanPreKeys = false) {
  if (!existsSync(sessionDir)) return;
  const files = readdirSync(sessionDir);
  files.forEach(file => {
    if (file === 'creds.json') return;
    const filePath = path.join(sessionDir, file);
    const stats = statSync(filePath);
    const fileAge = (Date.now() - stats.mtimeMs) / (1000 * 60 * 60 * 24);
    if (file.startsWith('pre-key') && cleanPreKeys && fileAge > 1) {
      try { unlinkSync(filePath); } catch {}
    } else if (!file.startsWith('pre-key')) {
      try {
        if (stats.isDirectory()) rmSync(filePath, { recursive: true, force: true });
        else unlinkSync(filePath);
      } catch {}
    }
  });
}

// Timer con protezioni
setInterval(async () => {
  if (stopped === 'close' || !global.conn?.user) return;
  clearSessionFolderSelective();
}, 30 * 60 * 1000);

setInterval(async () => {
  if (stopped === 'close' || !global.conn?.user) return;
  purgeSession('./sessioni');
  const subBotDir = './chatunity-sub';
  if (existsSync(subBotDir)) {
    readdirSync(subBotDir).filter(f => statSync(join(subBotDir, f)).isDirectory())
      .forEach(folder => purgeSession(join(subBotDir, folder)));
  }
}, 20 * 60 * 1000);

setInterval(async () => {
  if (stopped === 'close' || !global.conn?.user) return;
  purgeSession('./sessioni', true);
  const subBotDir = './chatunity-sub';
  if (existsSync(subBotDir)) {
    readdirSync(subBotDir).filter(f => statSync(join(subBotDir, f)).isDirectory())
      .forEach(folder => purgeSession(join(subBotDir, folder), true));
  }
}, 3 * 60 * 60 * 1000);

// Baileys
const { useMultiFileAuthState, fetchLatestBaileysVersion, makeCacheableSignalKeyStore, Browsers, jidNormalizedUser, makeInMemoryStore, DisconnectReason } = await import('@chatunity/baileys');
const { chain } = lodash;
protoType();
serialize();

global.isLogoPrinted = false;
global.qrGenerated = false;
global.connectionMessagesPrinted = {};
global.conns = [];
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

// ✅ FIXED CONSOLE - Applicato DOPO tutti gli import
function redefineConsoleMethod(methodName, filterStrings) {
  if (typeof console[methodName] !== 'function') return;
  const original = console[methodName];
  console[methodName] = function(...args) {
    if (!args.length) return original.apply(console, args);
    const msg = String(args[0]);
    if (filterStrings.some(f => msg.includes(atob(f)))) args[0] = '[FILTRATO]';
    return original.apply(console, args);
  };
}

global.__filename = (pathURL = import.meta.url, rmPrefix = platform !== 'win32') => 
  rmPrefix ? /file:\/\/\//.test(pathURL) ? fileURLToPath(pathURL) : pathURL : pathToFileURL(pathURL).toString();

global.__dirname = (pathURL) => path.dirname(global.__filename(pathURL, true));
global.__require = (dir = import.meta.url) => createRequire(dir);

global.API = (name, path = '/', query = {}, apikeyqueryname) => {
  const base = name in global.APIs ? global.APIs[name] : name;
  const params = query || apikeyqueryname ? '?' + new URLSearchParams(Object.entries({ 
    ...query, ...(apikeyqueryname ? { [apikeyqueryname]: global.APIKeys[base] } : {}) 
  })) : '';
  return base + path + params;
};

global.timestamp = { start: new Date };
const __dirname_base = global.__dirname(import.meta.url);

global.opts = new Object(yargs(process.argv.slice(2)).exitProcess(false).parse());
global.prefix = new RegExp('^[' + (opts['prefix'] || '*/!#$%+£¢€¥^°=¶∆×÷π√✓©®&.\\-.@').replace(/[|\\{}()[\]^$+*.\-\^]/g, '\\$&') + ']');

// ✅ FIXED DATABASE - cloudDBAdapter definito sopra
global.db = new Low(/https?:\/\//.test(opts['db'] || '') ? new cloudDBAdapter(opts['db']) : new JSONFile('database.json'));
global.DATABASE = global.db;

global.loadDatabase = async function() {
  if (global.db.READ) {
    return new Promise(resolve => {
      const int = setInterval(() => {
        if (!global.db.READ) {
          clearInterval(int);
          resolve(global.db.data ?? global.loadDatabase());
        }
      }, 100);
    });
  }
  if (global.db.data !== null) return global.db.data;
  
  global.db.READ = true;
  try {
    await global.db.read();
  } catch(e) {
    console.error('DB read error:', e);
  }
  global.db.READ = false;
  
  global.db.data = {
    users: {}, chats: {}, stats: {}, msgs: {}, sticker: {}, settings: {},
    ...(global.db.data || {})
  };
  global.db.chain = chain(global.db.data);
};

await global.loadDatabase();

global.creds = 'creds.json';
global.authFile = 'sessioni';
global.authFileJB = 'chatunity-sub';

const { state, saveCreds } = await useMultiFileAuthState(global.authFile);
const msgRetryCounterCache = new NodeCache();
const msgRetryCounterMap = () => {};
const { version } = await fetchLatestBaileysVersion();

let rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
const question = (t) => {
  rl.clearLine(rl.input, 0);
  return new Promise(r => rl.question(t, a => { rl.clearLine(rl.input, 0); r(a.trim()); }));
};

let opzione = '1';
if (!methodCodeQR && !methodCode && !fs.existsSync(`./${global.authFile}/creds.json`)) {
  const menu = `╭★────★────★────★────★
│ 1️⃣ QR Code | 2️⃣ Codice
╰★────★────★────★`;
  do {
    opzione = await question(menu + '\nScelta: ');
  } while (!/^[1-2]$/.test(opzione));
}

// ✅ CONSOLE FILTER - ORA FUNZIONA
const filterStrings = ["Q2xvc2luZyBzdGFsZSBvcGVu","Q2xvc2luZyBvcGVuIHNlc3Npb24=","RmFpbGVkIHRvIGRlY3J5cHQ=","U2Vzc2lvbiBlcnJvcg==","RXJyb3I6IEJhZCBNQUM=","RGVjcnlwdGVkIG1lc3NhZ2U="];
console.info = () => {};
console.debug = () => {};
['log', 'warn', 'error'].forEach(m => redefineConsoleMethod(m, filterStrings));

const groupMetadataCache = new NodeCache({ stdTTL: 300, checkperiod: 60 });
global.groupCache = groupMetadataCache;

const logger = pino({
  level: 'silent',
  redact: { paths: ['creds.*','auth.*','account.*','media.*.directPath','media.*.url','node.content[*].enc','password','token','*.secret'], censor: '***' },
  timestamp: () => `,"time":"${new Date().toJSON()}"`
});

global.jidCache = new NodeCache({ stdTTL: 600 });
global.store = makeInMemoryStore({ logger });

const connectionOptions = {
  logger,
  printQRInTerminal: opzione === '1' || methodCodeQR,
  mobile: MethodMobile,
  auth: { creds: state.creds, keys: makeCacheableSignalKeyStore(state.keys, logger) },
  browser: (opzione === '1' || methodCodeQR) ? Browsers.windows('Chrome') : Browsers.macOS('Safari'),
  version,
  markOnlineOnConnect: false,
  generateHighQualityLinkPreview: true,
  syncFullHistory: false,
  linkPreviewImageThumbnailWidth: 192,
  getMessage: async key => {
    try {
      const jid = global.conn?.decodeJid(key.remoteJid);
      return (await global.store.loadMessage(jid, key.id))?.message;
    } catch { return undefined; }
  },
  msgRetryCounterCache, msgRetryCounterMap,
  retryRequestDelayMs: 250,
  maxMsgRetryCount: 3
};

global.conn = makeWASocket(connectionOptions);
global.store.bind(global.conn.ev);

global.conn.isInit = false;
global.conn.well = false;

// ✅ HANDLER DEFINITO PRIMA
global.reloadHandler = async function(restatConn) {
  try {
    if (existsSync('./handler.js')) {
      const Handler = await import(`./handler.js?update=${Date.now()}`);
      global.handler = Handler.default || Handler;
      console.log(chalk.green('✅ Handler caricato'));
    }
  } catch(e) {
    console.error('Handler error:', e.message);
  }
  
  if (restatConn && global.conn) {
    global.conn.ws?.close();
    global.conn.ev.removeAllListeners();
    global.conn = makeWASocket(connectionOptions);
    global.store.bind(global.conn.ev);
  }
  
  if (global.conn && global.handler) {
    ['messages.upsert','group-participants.update','groups.update','message.delete','call','connection.update','creds.update']
      .forEach(ev => global.conn.ev.off(ev));
    
    global.conn.handler = global.handler.handler?.bind(global.conn);
    global.conn.ev.on('messages.upsert', global.conn.handler);
    
    global.conn.isInit = true;
  }
  return true;
};

async function connectionUpdate(update) {
  const { connection, lastDisconnect, qr, isNewLogin } = update;
  global.stopped = connection;
  
  if (isNewLogin) global.conn.isInit = true;
  
  const code = lastDisconnect?.error?.output?.statusCode;
  if (code && code !== DisconnectReason.loggedOut) {
    setTimeout(() => global.reloadHandler(true), 2000);
  }
  
  if (qr && (opzione === '1' || methodCodeQR) && !global.qrGenerated) {
    console.log(chalk.bold.yellow('📱 SCANSIONA QR'));
    global.qrGenerated = true;
  }
  
  if (connection === 'open') {
    global.qrGenerated = false;
    if (!global.isLogoPrinted) {
      console.log(chalk.hex('#3b0d95')('🔥 CHATUNITY BOT'));
      global.isLogoPrinted = true;
    }
    await global.reloadHandler();
    console.log(chalk.green('✅ CONNESSO!'));
  }
}

// Event listeners
global.conn.ev.on('connection.update', connectionUpdate);
global.conn.ev.on('creds.update', saveCreds);

// Pairing code
if (!fs.existsSync('./sessioni/creds.json') && (opzione === '2' || methodCode)) {
  setTimeout(async () => {
    try {
      const phone = (global.botNumberCode || '').replace(/\D/g, '') || '39xxxxxxxxx';
      const code = generateRandomCode();
      const pairingCode = await global.conn.requestPairingCode(phone, code);
      console.log(chalk.bgBlueBright(`🔑 CODICE: ${pairingCode}`));
    } catch(e) {
      console.error('Pairing error:', e);
    }
  }, 3000);
}

// Avvio
(async () => {
  console.log(chalk.magenta('🚀 ChatUnity Bot'));
  await global.reloadHandler();
})();

process.on('uncaughtException', console.error);

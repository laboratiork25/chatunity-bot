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

if (!existsSync(tempDir)) {
  mkdirSync(tempDir, { recursive: true });
}
if (!existsSync(tmpDir)) {
  mkdirSync(tmpDir, { recursive: true });
}

let stopped = 'open';
global.isLogoPrinted = false;
global.qrGenerated = false;
global.connectionMessagesPrinted = {};
global.conns = [];

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
    } else {
      if (!entry.startsWith('pre-key')) {
        try {
          fs.unlinkSync(fullPath);
        } catch {}
      }
    }
  }
  console.log(`Cartella sessioni pulita (file non critici rimossi): ${new Date().toLocaleTimeString()}`);
}

function purgeSession(sessionDir, cleanPreKeys = false) {
  if (!existsSync(sessionDir)) return;
  const files = readdirSync(sessionDir);
  files.forEach(file => {
    if (file === 'creds.json') return;
    const filePath = path.join(sessionDir, file);
    const stats = statSync(filePath);
    const fileAge = (Date.now() - stats.mtimeMs) / (1000 * 60 * 60 * 24);
    if (file.startsWith('pre-key') && cleanPreKeys) {
      if (fileAge > 1) {
        try {
          unlinkSync(filePath);
        } catch {}
      }
    } else if (!file.startsWith('pre-key')) {
      try {
        if (stats.isDirectory()) {
          rmSync(filePath, { recursive: true, force: true });
        } else {
          unlinkSync(filePath);
        }
      } catch {}
    }
  });
}

// Timer inizializzati con protezioni
setInterval(async () => {
  if (stopped === 'close' || !global.conn || !global.conn.user) return;
  clearSessionFolderSelective();
}, 30 * 60 * 1000);

setInterval(async () => {
  if (stopped === 'close' || !global.conn || !global.conn.user) return;
  purgeSession(`./sessioni`);
  const subBotDir = `./${global?.authFileJB || 'chatunity-sub'}`;
  if (existsSync(subBotDir)) {
    const subBotFolders = readdirSync(subBotDir).filter(file => statSync(join(subBotDir, file)).isDirectory());
    subBotFolders.forEach(folder => purgeSession(join(subBotDir, folder)));
  }
}, 20 * 60 * 1000);

setInterval(async () => {
  if (stopped === 'close' || !global.conn || !global.conn.user) return;
  purgeSession(`./sessioni`, true);
  const subBotDir = `./${global?.authFileJB || 'chatunity-sub'}`;
  if (existsSync(subBotDir)) {
    const subBotFolders = readdirSync(subBotDir).filter(file => statSync(join(subBotDir, file)).isDirectory());
    subBotFolders.forEach(folder => purgeSession(join(subBotDir, folder), true));
  }
}, 3 * 60 * 60 * 1000);

// **IMPORT BAILEYS DOPO INIZIALIZZAZIONE GLOBALI**
const { useMultiFileAuthState, fetchLatestBaileysVersion, makeCacheableSignalKeyStore, Browsers, jidNormalizedUser, makeInMemoryStore, DisconnectReason } = await import('@chatunity/baileys');
const { chain } = lodash;
const PORT = process.env.PORT || process.env.SERVER_PORT || 3000;
protoType();
serialize();

let methodCodeQR = process.argv.includes("qr");
let methodCode = process.argv.includes("code");
let MethodMobile = process.argv.includes("mobile");
let phoneNumber = global?.botNumberCode;

function generateRandomCode(length = 8) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

// **FIX DEFINITIVO: FUNZIONE CONSOLE MODIFICATA**
function redefineConsoleMethod(methodName, filterStrings) {
  if (!console[methodName] || typeof console[methodName] !== 'function') return;
  
  const originalMethod = console[methodName];
  console[methodName] = function (...args) {
    if (args.length === 0) {
      return originalMethod.apply(console, args);
    }
    
    const message = String(args[0] || '');
    if (filterStrings.some(filterString => message.includes(atob(filterString)))) {
      args[0] = '[FILTRATO]';
    }
    return originalMethod.apply(console, args);
  };
}

global.__filename = function filename(pathURL = import.meta.url, rmPrefix = platform !== 'win32') {
  return rmPrefix ? /file:\/\/\//.test(pathURL) ? fileURLToPath(pathURL) : pathURL : pathToFileURL(pathURL).toString();
};

global.__dirname = function dirname(pathURL) {
  return path.dirname(global.__filename(pathURL, true));
};

global.__require = function require(dir = import.meta.url) {
  return createRequire(dir);
};

global.API = (name, path = '/', query = {}, apikeyqueryname) => {
  const base = name in global.APIs ? global.APIs[name] : name;
  const params = query || apikeyqueryname ? '?' + new URLSearchParams(Object.entries({ 
    ...query, 
    ...(apikeyqueryname ? { [apikeyqueryname]: global.APIKeys[name in global.APIs ? global.APIs[name] : name] } : {}) 
  })) : '';
  return base + path + params;
};

global.timestamp = { start: new Date };
const __dirname_base = global.__dirname(import.meta.url);

global.opts = new Object(yargs(process.argv.slice(2)).exitProcess(false).parse());
global.prefix = new RegExp('^[' + (opts['prefix'] || '*/!#$%+£¢€¥^°=¶∆×÷π√✓©®&.\\-.@').replace(/[|\\{}()[\]^$+*.\-\^]/g, '\\$&') + ']');

global.db = new Low(/https?:\/\//.test(opts['db'] || '') ? new cloudDBAdapter(opts['db']) : new JSONFile('database.json'));
global.DATABASE = global.db;

global.loadDatabase = async function loadDatabase() {
  if (global.db.READ) {
    return new Promise((resolve) => {
      const interval = setInterval(async () => {
        if (!global.db.READ) {
          clearInterval(interval);
          resolve(global.db.data == null ? await global.loadDatabase() : global.db.data);
        }
      }, 100);
    });
  }
  if (global.db.data !== null) return global.db.data;
  
  global.db.READ = true;
  try {
    await global.db.read();
  } catch (e) {
    console.error('Errore lettura DB:', e);
  }
  global.db.READ = false;
  
  global.db.data = {
    users: {},
    chats: {},
    stats: {},
    msgs: {},
    sticker: {},
    settings: {},
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
const msgRetryCounterMap = () => {};
const msgRetryCounterCache = new NodeCache();
const { version } = await fetchLatestBaileysVersion();

let rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  terminal: true,
});

const question = (text) => {
  rl.clearLine(rl.input, 0);
  return new Promise((resolve) => {
    rl.question(text, (answer) => {
      rl.clearLine(rl.input, 0);
      resolve(answer.trim());
    });
  });
};

let opzione;
if (!methodCodeQR && !methodCode && !fs.existsSync(`./${global.authFile}/creds.json`)) {
  do {
    const menu = `╭★────★────★────★────★────★
│      ꒰ ¡METODO DI COLLEGAMENTO! ꒱
│
│  👾  Opzione 1: Codice QR
│  ☁️  Opzione 2: Codice 8 caratteri
│
╰★────★────★────★────★
               ꒷꒦ ✦ ChatUnity ✦ ꒷꒦
╰♡꒷ ๑ ⋆˚₊⋆───ʚ˚ɞ───⋆˚₊⋆ ๑ ⪩﹐
`;
    opzione = await question(menu + '\nInserisci la tua scelta ---> ');
    if (!/^[1-2]$/.test(opzione)) {
      console.log('❌ Opzione non valida, inserisci 1 o 2');
    }
  } while ((opzione !== '1' && opzione !== '2') || fs.existsSync(`./${global.authFile}/creds.json`));
} else {
  opzione = '1';
}

// **APPLICAZIONE CONSOLE FILTER DOPO TUTTE LE DEFINIZIONI**
const filterStrings = [
  "Q2xvc2luZyBzdGFsZSBvcGVu",
  "Q2xvc2luZyBvcGVuIHNlc3Npb24=",
  "RmFpbGVkIHRvIGRlY3J5cHQ=",
  "U2Vzc2lvbiBlcnJvcg==",
  "RXJyb3I6IEJhZCBNQUM=",
  "RGVjcnlwdGVkIG1lc3NhZ2U="
];

console.info = () => {};
console.debug = () => {};
['log', 'warn', 'error'].forEach(methodName => redefineConsoleMethod(methodName, filterStrings));

const groupMetadataCache = new NodeCache({ stdTTL: 300, checkperiod: 60, maxKeys: 500 });
global.groupCache = groupMetadataCache;

const logger = pino({
  level: 'silent',
  redact: {
    paths: ['creds.*', 'auth.*', 'account.*', 'media.*.directPath', 'media.*.url', 'node.content[*].enc', 'password', 'token', '*.secret'],
    censor: '***'
  },
  timestamp: () => `,"time":"${new Date().toJSON()}"`
});

global.jidCache = new NodeCache({ stdTTL: 600, useClones: false, maxKeys: 1000 });
global.store = makeInMemoryStore({ logger });

const connectionOptions = {
  logger,
  printQRInTerminal: opzione === '1' || methodCodeQR,
  mobile: MethodMobile,
  auth: {
    creds: state.creds,
    keys: makeCacheableSignalKeyStore(state.keys, logger),
  },
  browser: (opzione === '1' || methodCodeQR) ? Browsers.windows('Chrome') : Browsers.macOS('Safari'),
  version,
  markOnlineOnConnect: false,
  generateHighQualityLinkPreview: true,
  syncFullHistory: false,
  linkPreviewImageThumbnailWidth: 192,
  getMessage: async (key) => {
    try {
      const jid = global.conn?.decodeJid(key.remoteJid);
      const msg = await global.store.loadMessage(jid, key.id);
      return msg?.message || undefined;
    } catch {
      return undefined;
    }
  },
  defaultQueryTimeoutMs: 60000,
  connectTimeoutMs: 60000,
  keepAliveIntervalMs: 30000,
  emitOwnEvents: true,
  fireInitQueries: true,
  msgRetryCounterCache,
  msgRetryCounterMap,
  retryRequestDelayMs: 250,
  maxMsgRetryCount: 3,
  shouldIgnoreJid: jid => false
};

global.conn = makeWASocket(connectionOptions);
global.store.bind(global.conn.ev);

global.conn.isInit = false;
global.conn.well = false;

// **HANDLER DEFINITO**
global.reloadHandler = async function (restatConn) {
  try {
    const Handler = await import(`./handler.js?update=${Date.now()}`).catch(console.error);
    if (Handler && Object.keys(Handler).length) {
      global.handler = Handler;
    }
  } catch (e) {
    console.error('Errore caricamento handler:', e);
  }
  
  if (restatConn && global.conn) {
    const oldChats = global.conn.chats;
    try {
      global.conn.ws?.close();
    } catch {}
    global.conn.ev.removeAllListeners();
    global.conn = makeWASocket(connectionOptions, { chats: oldChats });
    global.store.bind(global.conn.ev);
  }
  
  if (global.conn && !global.conn.isInit && global.handler) {
    // Rimuovi listener precedenti
    global.conn.ev.removeAllListeners('messages.upsert');
    global.conn.ev.removeAllListeners('group-participants.update');
    
    global.conn.handler = global.handler.handler?.bind(global.conn);
    global.conn.ev.on('messages.upsert', global.conn.handler);
    
    global.conn.isInit = true;
  }
  return true;
};

// Event listeners principali
global.conn.ev.on('connection.update', connectionUpdate);
global.conn.ev.on('creds.update', saveCreds);

async function connectionUpdate(update) {
  const { connection, lastDisconnect, isNewLogin, qr } = update;
  global.stopped = connection;
  
  if (isNewLogin) {
    global.conn.isInit = true;
    await global.reloadHandler();
  }
  
  const code = lastDisconnect?.error?.output?.statusCode;
  if (code && code !== DisconnectReason.loggedOut) {
    setTimeout(() => global.reloadHandler(true).catch(console.error), 1000);
  }
  
  if (qr && (opzione === '1' || methodCodeQR) && !global.qrGenerated) {
    console.log(chalk.bold.yellow('🔗 SCANSIONA IL QR (scade in 45s)'));
    global.qrGenerated = true;
  }

  if (connection === 'open') {
    global.qrGenerated = false;
    global.connectionMessagesPrinted = {};
    
    if (!global.isLogoPrinted) {
      console.log(chalk.hex('#3b0d95')('🟣 ChatUnity Bot Avviato!'));
      global.isLogoPrinted = true;
    }
    
    await global.reloadHandler();
  }
}

// **AVVIO FINALE**
(async () => {
  console.log(chalk.bold.magenta('🚀 Avvio ChatUnity Bot...'));
  
  if (!fs.existsSync(`./${global.authFile}/creds.json`)) {
    if (opzione === '2' || methodCode) {
      setTimeout(async () => {
        const addNumber = phoneNumber?.replace(/\D/g, '') || '39xxxxxxxxx';
        const randomCode = generateRandomCode();
        const code = await global.conn.requestPairingCode(addNumber, randomCode);
        console.log(chalk.bold.bgBlueBright(`🔑 CODICE: ${code?.match(/.{1,4}/g)?.join('-') || code}`));
      }, 2000);
    }
  }
  
  await global.reloadHandler();
  console.log(chalk.bold.green('✅ Bot pronto!'));
})();

// Plugin system semplificato
const pluginFolder = './plugins/index';
if (existsSync(pluginFolder)) {
  const pluginFilter = filename => /\.js$/.test(filename);
  global.plugins = {};

  async function filesInit() {
    for (const filename of readdirSync(pluginFolder).filter(pluginFilter)) {
      try {
        const file = join(pluginFolder, filename);
        const module = await import(fileURLToPath(pathToFileURL(file)));
        global.plugins[filename] = module.default || module;
      } catch (e) {
        console.error(`Plugin error ${filename}:`, e);
      }
    }
  }
  filesInit();
}

process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
});
process.on('unhandledRejection', (reason) => {
  console.error('Unhandled Rejection:', reason);
});

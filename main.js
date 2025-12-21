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

const sessionFolder = path.join(process.cwd(), global?.authFile || 'sessioni');
const tempDir = join(process.cwd(), 'temp');
const tmpDir = join(process.cwd(), 'tmp');

if (!existsSync(tempDir)) {
  mkdirSync(tempDir, { recursive: true });
}
if (!existsSync(tmpDir)) {
  mkdirSync(tmpDir, { recursive: true });
}

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

setInterval(async () => {
  if (stopped === 'close' || !global.conn || !global.conn.user) return;
  clearSessionFolderSelective();
}, 30 * 60 * 1000);

setInterval(async () => {
  if (stopped === 'close' || !global.conn || !global.conn.user) return;
  purgeSession('./sessioni');
  const subBotDir = `./${global.authFileJB}`;
  if (existsSync(subBotDir)) {
    const subBotFolders = readdirSync(subBotDir).filter(file => statSync(join(subBotDir, file)).isDirectory());
    subBotFolders.forEach(folder => purgeSession(join(subBotDir, folder)));
  }
}, 20 * 60 * 1000);

setInterval(async () => {
  if (stopped === 'close' || !global.conn || !global.conn.user) return;
  purgeSession(`./${global.authFile}`, true);
  const subBotDir = `./${global.authFileJB}`;
  if (existsSync(subBotDir)) {
    const subBotFolders = readdirSync(subBotDir).filter(file => statSync(join(subBotDir, file)).isDirectory());
    subBotFolders.forEach(folder => purgeSession(join(subBotDir, folder), true));
  }
}, 3 * 60 * 60 * 1000);

const baileys = await import('@chatunity/baileys');
const { useMultiFileAuthState, fetchLatestBaileysVersion, makeCacheableSignalKeyStore, Browsers, jidNormalizedUser, makeInMemoryStore, DisconnectReason } = baileys;
const { chain } = lodash;
const PORT = process.env.PORT || process.env.SERVER_PORT || 3000;

protoType();
serialize();

global.isLogoPrinted = false;
global.qrGenerated = false;
global.connectionMessagesPrinted = {};
let methodCodeQR = process.argv.includes("qr");
let methodCode = process.argv.includes("code");
let MethodMobile = process.argv.includes("mobile");
let phoneNumber = global.botNumberCode;

function generateRandomCode(length = 8) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

function redefineConsoleMethod(methodName, filterStrings) {
  const originalConsoleMethod = console[methodName];
  console[methodName] = function() {
    const message = arguments[0];
    if (typeof message === 'string' && filterStrings.some(filterString => message.includes(atob(filterString)))) {
      arguments[0] = "";
    }
    originalConsoleMethod.apply(console, arguments);
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

global.API = (name, path = '/', query = {}, apikeyqueryname) => (name in global.APIs ? global.APIs[name] : name) + path + (query || apikeyqueryname ? '?' + new URLSearchParams(Object.entries({ ...query, ...(apikeyqueryname ? { [apikeyqueryname]: global.APIKeys[name in global.APIs ? global.APIs[name] : name] } : {}) })) : '');

global.timestamp = { start: new Date };
const __dirname = global.__dirname(import.meta.url);

global.opts = new Object(yargs(process.argv.slice(2)).exitProcess(false).parse());
global.prefix = new RegExp('^[' + (opts['prefix'] || '*/!#$%+£¢€¥^°=¶∆×÷π√✓©®&.\\-.@').replace(/[|\\{}()[\]^$+*.\-\^]/g, '\\$&') + ']');

global.db = new Low(/https?:\/\//.test(opts['db'] || '') ? new cloudDBAdapter(opts['db']) : new JSONFile('database.json'));
global.DATABASE = global.db;

global.loadDatabase = async function loadDatabase() {
  if (global.db.READ) {
    return new Promise((resolve) => setInterval(async function() {
      if (!global.db.READ) {
        clearInterval(this);
        resolve(global.db.data == null ? global.loadDatabase() : global.db.data);
      }
    }, 1 * 1000));
  }
  if (global.db.data !== null) return;
  global.db.READ = true;
  await global.db.read().catch(console.error);
  global.db.READ = null;
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
};

await loadDatabase();

if (global.conns instanceof Array) {
  console.log('Connessioni già inizializzate...');
} else {
  global.conns = [];
}

global.creds = 'creds.json';
global.authFile = 'sessioni';
global.authFileJB = 'chatunity-sub';

const { state, saveCreds } = await useMultiFileAuthState(global.authFile);
const msgRetryCounterMap = (MessageRetryMap) => {};
const msgRetryCounterCache = new NodeCache();
const { version } = await fetchLatestBaileysVersion();

let rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  terminal: true,
});

const question = (t) => {
  rl.clearLine(rl.input, 0);
  return new Promise((resolver) => {
    rl.question(t, (r) => {
      rl.clearLine(rl.input, 0);
      resolver(r.trim());
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
      console.log('Opzione non valida, inserisci 1 o 2');
    }
  } while ((opzione !== '1' && opzione !== '2') || fs.existsSync(`./${global.authFile}/creds.json`));
}

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
    paths: [
      'creds.*',
      'auth.*',
      'account.*',
      'media.*.directPath',
      'media.*.url',
      'node.content[*].enc',
      'password',
      'token',
      '*.secret'
    ],
    censor: '***'
  },
  timestamp: () => `,"time":"${new Date().toJSON()}"`
});

global.jidCache = new NodeCache({ stdTTL: 600, useClones: false, maxKeys: 1000 });
global.store = makeInMemoryStore({ logger });

const connectionOptions = {
  logger: logger,
  printQRInTerminal: opzione === '1' || methodCodeQR,
  mobile: MethodMobile,
  auth: {
    creds: state.creds,
    keys: makeCacheableSignalKeyStore(state.keys, logger),
  },
  browser: opzione === '1' ? Browsers.windows('Chrome') : methodCodeQR ? Browsers.windows('Chrome') : Browsers.macOS('Safari'),
  version: version,
  markOnlineOnConnect: false,
  generateHighQualityLinkPreview: true,
  syncFullHistory: false,
  linkPreviewImageThumbnailWidth: 192,
  getMessage: async (key) => {
    try {
      const jid = global.conn?.decodeJid(key.remoteJid);
      const msg = await global.store.loadMessage(jid, key.id);
      return msg?.message || undefined;
    } catch (error) {
      return undefined;
    }
  },
  defaultQueryTimeoutMs: 60000,
  connectTimeoutMs: 60000,
  keepAliveIntervalMs: 30000,
  emitOwnEvents: true,
  fireInitQueries: true,
  transactionOpts: {
    maxCommitRetries: 10,
    delayBetweenTriesMs: 3000
  },
  cachedGroupMetadata: async (jid) => {
    const cached = global.groupCache.get(jid);
    if (cached) return cached;
    try {
      if (global.conn) {
        const metadata = await global.conn.groupMetadata(global.conn.decodeJid(jid));
        global.groupCache.set(jid, metadata);
        return metadata;
      }
    } catch (err) {
      return {};
    }
  },
  decodeJid: (jid) => {
    if (!jid) return jid;
    const cached = global.jidCache.get(jid);
    if (cached) return cached;

    let decoded = jid;
    if (/:\d+@/gi.test(jid)) {
      decoded = jidNormalizedUser(jid);
    }
    if (typeof decoded === 'object' && decoded.user && decoded.server) {
      decoded = `${decoded.user}@${decoded.server}`;
    }
    if (typeof decoded === 'string' && decoded.endsWith('@lid')) {
      decoded = decoded.replace('@lid', '@s.whatsapp.net');
    }

    global.jidCache.set(jid, decoded);
    return decoded;
  },
  msgRetryCounterCache,
  msgRetryCounterMap,
  retryRequestDelayMs: 250,
  maxMsgRetryCount: 3,
  shouldIgnoreJid: jid => false,
  patchMessageBeforeSending: (message) => {
    const requiresPatch = !!(
      message.buttonsMessage ||
      message.templateMessage ||
      message.listMessage
    );
    if (requiresPatch) {
      message = {
        viewOnceMessage: {
          message: {
            messageContextInfo: {
              deviceListMetadata: {},
              deviceListMetadataVersion: 2
            },
            ...message
          }
        }
      };
    }
    return message;
  }
};

global.conn = makeWASocket(connectionOptions);
global.store.bind(global.conn.ev);

// **reloadHandler DEFINITO PRIMA**
global.reloadHandler = async function(restatConn) {
  try {
    const Handler = await import(`./handler.js?update=${Date.now()}`).catch(console.error);
    if (Object.keys(Handler || {}).length) {
      global.handler = Handler;
    }
  } catch (e) {
    console.error(e);
  }
  
  if (restatConn && global.conn) {
    const oldChats = global.conn.chats;
    try {
      global.conn.ws.close();
    } catch {}
    global.conn.ev.removeAllListeners();
    global.conn = makeWASocket(connectionOptions, { chats: oldChats });
    global.store.bind(global.conn.ev);
    global.conn.isInit = true;
  }
  
  if (global.conn && !global.conn.isInit && global.handler) {
    global.conn.ev.off('messages.upsert', global.conn.handler);
    global.conn.ev.off('group-participants.update', global.conn.participantsUpdate);
    global.conn.ev.off('groups.update', global.conn.groupsUpdate);
    global.conn.ev.off('message.delete', global.conn.onDelete);
    global.conn.ev.off('call', global.conn.onCall);
    global.conn.ev.off('connection.update', global.conn.connectionUpdate);
    global.conn.ev.off('creds.update', global.conn.credsUpdate);

    global.conn.welcome = '@user benvenuto/a in @subject';
    global.conn.bye = '@user ha abbandonato il gruppo';
    global.conn.spromote = '@user è stato promosso ad amministratore';
    global.conn.sdemote = '@user non è più amministratore';
    global.conn.sIcon = 'immagine gruppo modificata';
    global.conn.sRevoke = 'link reimpostato, nuovo link: @revoke';

    global.conn.handler = global.handler.handler.bind(global.conn);
    global.conn.participantsUpdate = global.handler.participantsUpdate.bind(global.conn);
    global.conn.groupsUpdate = global.handler.groupsUpdate.bind(global.conn);
    global.conn.onDelete = global.handler.deleteUpdate.bind(global.conn);
    global.conn.onCall = global.handler.callUpdate.bind(global.conn);
    global.conn.connectionUpdate = connectionUpdate.bind(global.conn);
    global.conn.credsUpdate = saveCreds.bind(global.conn, true);

    global.conn.ev.on('messages.upsert', global.conn.handler);
    global.conn.ev.on('group-participants.update', global.conn.participantsUpdate);
    global.conn.ev.on('groups.update', global.conn.groupsUpdate);
    global.conn.ev.on('message.delete', global.conn.onDelete);
    global.conn.ev.on('call', global.conn.onCall);
    global.conn.ev.on('connection.update', global.conn.connectionUpdate);
    global.conn.ev.on('creds.update', global.conn.credsUpdate);
    global.conn.isInit = false;
  }
  return true;
};

global.conn.isInit = false;
global.conn.well = false;

if (!fs.existsSync(`./${global.authFile}/creds.json`)) {
  if (opzione === '2' || methodCode) {
    opzione = '2';
    if (!global.conn.authState.creds.registered) {
      let addNumber;
      if (phoneNumber) {
        addNumber = phoneNumber.replace(/[^0-9]/g, '');
      } else {
        phoneNumber = await question(chalk.bgBlack(chalk.bold.bgMagentaBright(`Inserisci il numero di WhatsApp.\n${chalk.bold.yellowBright("Esempio: +393471234567")}\n${chalk.bold.magenta('PS: è normale che appare il qrcode incollate comunque il numero')}`)));
        addNumber = phoneNumber.replace(/\D/g, '');
        if (!phoneNumber.startsWith('+')) phoneNumber = `+${phoneNumber}`;
        rl.close();
      }
      setTimeout(async () => {
        const randomCode = generateRandomCode();
        let codeBot = await global.conn.requestPairingCode(addNumber, randomCode);
        codeBot = codeBot?.match(/.{1,4}/g)?.join("-") || codeBot;
        console.log(chalk.bold.white(chalk.bgBlueBright('꒰🩸꒱ ◦•≫ CODICE DI COLLEGAMENTO:')), chalk.bold.white(chalk.white(codeBot)));
      }, 3000);
    }
  }
}

async function chatunityedition() {
  try {
    const mainChannelId = global.IdCanale?.[0] || '120363259442839354@newsletter';
    await global.conn.newsletterFollow(mainChannelId);
  } catch (error) {}
}

if (!opts['test']) {
  if (global.db) setInterval(async () => {
    if (global.db.data) await global.db.write();
    if (opts['autocleartmp'] && (global.support || {}).find) {
      const tmp = [tmpdir(), 'tmp', "chatunity-sub"];
      tmp.forEach(filename => spawn('find', [filename, '-amin', '2', '-type', 'f', '-delete']));
    }
  }, 30 * 1000);
}

if (opts['server']) (await import('./server.js')).default(global.conn, PORT);

async function connectionUpdate(update) {
  const { connection, lastDisconnect, isNewLogin, qr } = update;
  global.stopped = connection;
  if (isNewLogin) global.conn.isInit = true;
  const code = lastDisconnect?.error?.output?.statusCode || lastDisconnect?.error?.output?.payload?.statusCode;
  
  if (code && code !== DisconnectReason.loggedOut && typeof global.reloadHandler === 'function') {
    await global.reloadHandler(true).catch(console.error);
    global.timestamp.connect = new Date;
  }
  
  if (global.db.data == null) await loadDatabase();

  if (qr && (opzione === '1' || methodCodeQR) && !global.qrGenerated) {
    console.log(chalk.bold.yellow(`
┊ ┊ ┊ ┊‿ ˚➶ ｡˚   SCANSIONA IL CODICE QR
┊ ┊ ┊ ˚✧ Scade tra 45 secondi
┊ ˚➶ ｡˚ ☁︎ 
`));
    global.qrGenerated = true;
  }

  if (connection === 'open') {
    global.qrGenerated = false;
    global.connectionMessagesPrinted = {};
    if (!global.isLogoPrinted) {
      const chatunity = chalk.hex('#3b0d95')(`
 ██████╗██╗  ██╗ █████╗ ████████╗██╗   ██╗███╗   ██╗██╗████████╗██╗   ██╗
██╔════╝██║  ██║██╔══██╗╚══██╔══╝██║   ██║████╗  ██║██║╚══██╔══╝╚██╗ ██╔╝
██║     ███████║███████║   ██║   ██║   ██║██╔██╗ ██║██║   ██║    ╚████╔╝ 
██║     ██╔══██║██╔══██║   ██║   ██║   ██║██║╚██╗██║██║   ██║     ╚██╔╝  
╚██████╗██║  ██║██║  ██║   ██║   ╚██████╔╝██║ ╚████║██║   ██║      ██║   
 ╚═════╝╚═╝  ╚═╝╚═╝  ╚═╝   ╚═╝    ╚═════╝ ╚═╝  ╚═══╝╚═╝   ╚═╝      ╚═╝   
                                                                          `);
      console.log(chatunity);
      global.isLogoPrinted = true;
      await chatunityedition();
    }
    
    try {
      await global.conn.groupAcceptInvite('FjPBDj4sUgFLJfZiLwtTvk');
      console.log(chalk.bold.green('✅ Bot entrato nel gruppo supporto con successo - non abbandonare!'));
    } catch (error) {
      console.error(chalk.bold.red('❌ Errore nell\'accettare l\'invito del gruppo:'), error.message);
      if (error.data === 401) {
        console.error(chalk.bold.yellow('⚠️ Errore di autorizzazione: controlla le credenziali o la sessione'));
      }
    }
  }

  if (connection === 'close') {
    const reason = lastDisconnect?.error?.output?.statusCode || lastDisconnect?.error?.output?.payload?.statusCode;
    if (reason === DisconnectReason.badSession && !global.connectionMessagesPrinted.badSession) {
      console.log(chalk.bold.redBright(`\n⚠️❗ SESSIONE NON VALIDA, ELIMINA LA CARTELLA ${global.authFile} E SCANSIONA IL CODICE QR ⚠️`));
      global.connectionMessagesPrinted.badSession = true;
      if (typeof global.reloadHandler === 'function') {
        await global.reloadHandler(true).catch(console.error);
      }
    } else if (reason === DisconnectReason.connectionLost && !global.connectionMessagesPrinted.connectionLost) {
      console.log(chalk.bold.blueBright(`\n╭⭑⭒━━━✦❘༻ ⚠️  CONNESSIONE PERSA COL SERVER ༺❘✦━━━⭒⭑\n┃      🔄 RICONNESSIONE IN CORSO... \n╰⭑⭒━━━✦❘༻☾⋆₊✧ chatunity-bot ✧₊⁺⋆☽༺❘✦━━━⭒⭑`));
      global.connectionMessagesPrinted.connectionLost = true;
      if (typeof global.reloadHandler === 'function') {
        await global.reloadHandler(true).catch(console.error);
      }
    } else if (reason === DisconnectReason.connectionReplaced && !global.connectionMessagesPrinted.connectionReplaced) {
      console.log(chalk.bold.yellowBright(`╭⭑⭒━━━✦❘༻ ⚠️  CONNESSIONE SOSTITUITA ༺❘✦━━━⭒⭑\n┃  È stata aperta un'altra sessione, \n┃  chiudi prima quella attuale.\n╰⭑⭒━━━✦❘༻☾⋆⁺₊✧ chatunity-bot ✧₊⁺⋆☽༺❘✦━━━⭒⭑`));
      global.connectionMessagesPrinted.connectionReplaced = true;
    } else if (reason === DisconnectReason.loggedOut && !global.connectionMessagesPrinted.loggedOut) {
      console.log(chalk.bold.redBright(`\n⚠️ DISCONNESSO, ELIMINA LA CARTELLA ${global.authFile} E SCANSIONA IL CODICE QR ⚠️`));
      global.connectionMessagesPrinted.loggedOut = true;
      if (typeof global.reloadHandler === 'function') {
        await global.reloadHandler(true).catch(console.error);
      }
    } else if (reason === DisconnectReason.restartRequired && !global.connectionMessagesPrinted.restartRequired) {
      console.log(chalk.bold.magentaBright(`\n⭑⭒━━━✦❘༻ CONNESSO CON SUCCESSO  ༺❘✦━━━⭒⭑`));
      global.connectionMessagesPrinted.restartRequired = true;
      if (typeof global.reloadHandler === 'function') {
        await global.reloadHandler(true).catch(console.error);
      }
    } else if (reason === DisconnectReason.timedOut && !global.connectionMessagesPrinted.timedOut) {
      console.log(chalk.bold.yellowBright(`\n╭⭑⭒━━━✦❘༻ ⌛ TIMEOUT CONNESSIONE ༺❘✦━━━⭒⭑\n┃     🔄 RICONNESSIONE IN CORSO...\n╰⭑⭒━━━✦❘༻☾⋆⁺₊✧ chatunity-bot ✧₊⁺⋆☽༺❘✦━━━⭒⭑`));
      global.connectionMessagesPrinted.timedOut = true;
      if (typeof global.reloadHandler === 'function') {
        await global.reloadHandler(true).catch(console.error);
      }
    } else if (reason !== DisconnectReason.restartRequired && reason !== DisconnectReason.connectionClosed && !global.connectionMessagesPrinted.unknown) {
      console.log(chalk.bold.redBright(`\n⚠️❗ MOTIVO DISCONNESSIONE SCONOSCIUTO: ${reason || 'Non trovato'} >> ${connection || 'Non trovato'}`));
      global.connectionMessagesPrinted.unknown = true;
    }
  }
}

process.on('uncaughtException', console.error);

async function connectSubBots() {
  const subBotDirectory = './chatunity-sub';
  if (!existsSync(subBotDirectory)) {
    console.log(chalk.bold.magentaBright('non ci sono Sub-Bot collegati. Creazione directory...'));
    try {
      mkdirSync(subBotDirectory, { recursive: true });
      console.log(chalk.bold.green('✅ Directory chatunity-sub creata con successo.'));
    } catch (err) {
      console.log(chalk.bold.red('❌ Errore nella creazione della directory chatunity-sub:', err.message));
      return;
    }
    return;
  }

  try {
    const subBotFolders = readdirSync(subBotDirectory).filter(file =>
      statSync(join(subBotDirectory, file)).isDirectory()
    );

    if (subBotFolders.length === 0) {
      console.log(chalk.bold.magenta('Nessun subbot collegato'));
      return;
    }

    const botPromises = subBotFolders.map(async (folder) => {
      const subAuthFile = join(subBotDirectory, folder);
      if (existsSync(join(subAuthFile, 'creds.json'))) {
        try {
          const { state: subState, saveCreds: subSaveCreds } = await useMultiFileAuthState(subAuthFile);
          const subConn = makeWASocket({
            ...connectionOptions,
            auth: {
              creds: subState.creds,
              keys: makeCacheableSignalKeyStore(subState.keys, logger),
            },
          });

          subConn.ev.on('creds.update', subSaveCreds);
          subConn.ev.on('connection.update', connectionUpdate);
          return subConn;
        } catch (err) {
          console.log(chalk.bold.red(`❌ Errore nella connessione del Sub-Bot ${folder}:`, err.message));
          return null;
        }
      }
      return null;
    });

    const bots = await Promise.all(botPromises);
    global.conns = bots.filter(Boolean);

    if (global.conns.length > 0) {
      console.log(chalk.bold.magentaBright(`🌙 ${global.conns.length} Sub-Bot si sono connessi con successo.`));
    } else {
      console.log(chalk.bold.yellow('⚠️ Nessun Sub-Bot è riuscito a connettersi.'));
    }
  } catch (err) {
    console.log(chalk.bold.red('❌ Errore generale nella connessione dei Sub-Bot:', err.message));
  }
}

// Inizializzazione
(async () => {
  global.conns = [];
  try {
    global.conn.ev.on('connection.update', connectionUpdate);
    global.conn.ev.on('creds.update', saveCreds);
    
    console.log(chalk.bold.magenta(`
╭﹕₊˚ ★ ⁺˳ꕤ₊⁺・꒱
  ⋆  ︵︵ ★ ChatUnity connesso ★ ︵︵ ⋆
╰. ꒷꒦ ꒷꒦‧˚₊˚꒷꒦꒷‧˚₊˚꒷꒦꒷`));
    
    await connectSubBots();
    await global.reloadHandler();
  } catch (error) {
    console.error(chalk.bold.bgRedBright(`🥀 Errore nell'avvio del bot: `, error));
  }
})();

const pluginFolder = global.__dirname(join(__dirname, './plugins/index'));
const pluginFilter = (filename) => /\.js$/.test(filename);
global.plugins = {};

async function filesInit() {
  for (const filename of readdirSync(pluginFolder).filter(pluginFilter)) {
    try {
      const file = global.__filename(join(pluginFolder, filename));
      const module = await import(file);
      global.plugins[filename] = module.default || module;
    } catch (e) {
      if (global.conn?.logger) global.conn.logger.error(e);
      delete global.plugins[filename];
    }
  }
}

filesInit().then((_) => Object.keys(global.plugins)).catch(console.error);

global.reload = async (_ev, filename) => {
  if (pluginFilter(filename)) {
    const dir = global.__filename(join(pluginFolder, filename), true);
    if (filename in global.plugins) {
      if (existsSync(dir)) {
        if (global.conn?.logger) global.conn.logger.info(chalk.green(`✅ AGGIORNATO - '${filename}' CON SUCCESSO`));
      } else {
        if (global.conn?.logger) global.conn.logger.warn(`🗑️ FILE ELIMINATO: '${filename}'`);
        return delete global.plugins[filename];
      }
    } else {
      if (global.conn?.logger) global.conn.logger.info(`🆕 NUOVO PLUGIN RILEVATO: '${filename}'`);
    }
    
    const err = syntaxerror(fs.readFileSync(dir), filename, {
      sourceType: 'module',
      allowAwaitOutsideFunction: true,
    });
    
    if (err) {
      if (global.conn?.logger) global.conn.logger.error(`❌ ERRORE DI SINTASSI IN: '${filename}'\n${format(err)}`);
    } else {
      try {
        const module = await import(`${global.__filename(dir)}?update=${Date.now()}`);
        global.plugins[filename] = module.default || module;
      } catch (e) {
        if (global.conn?.logger) global.conn.logger.error(`⚠️ ERRORE NEL PLUGIN: '${filename}\n${format(e)}'`);
      } finally {
        global.plugins = Object.fromEntries(Object.entries(global.plugins).sort(([a], [b]) => a.localeCompare(b)));
      }
    }
  }
};

Object.freeze(global.reload);
const pluginWatcher = watch(pluginFolder, global.reload);
pluginWatcher.setMaxListeners(20);

async function _quickTest() {
  const test = await Promise.all([
    spawn('ffmpeg'),
    spawn('ffprobe'),
    spawn('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-filter_complex', 'color', '-frames:v', '1', '-f', 'webp', '-']),
    spawn('convert'),
    spawn('magick'),
    spawn('gm'),
    spawn('find', ['--version']),
  ].map((p) => {
    return Promise.race([
      new Promise((resolve) => {
        p.on('close', (code) => {
          resolve(code !== 127);
        });
      }),
      new Promise((resolve) => {
        p.on('error', (_) => resolve(false));
      })
    ]);
  }));
  
  const [ffmpeg, ffprobe, ffmpegWebp, convert, magick, gm, find] = test;
  global.support = { ffmpeg, ffprobe, ffmpegWebp, convert, magick, gm, find };
  Object.freeze(global.support);
}

function clearDirectory(dirPath) {
  if (!existsSync(dirPath)) {
    try {
      mkdirSync(dirPath, { recursive: true });
    } catch (e) {
      console.error(chalk.red(`Errore nella creazione della directory ${dirPath}:`, e));
    }
    return;
  }
  const filenames = readdirSync(dirPath);
  filenames.forEach(file => {
    const filePath = join(dirPath, file);
    try {
      const stats = statSync(filePath);
      if (stats.isFile()) {
        unlinkSync(filePath);
      } else if (stats.isDirectory()) {
        rmSync(filePath, { recursive: true, force: true });
      }
    } catch (e) {
      console.error(chalk.red(`Errore nella pulizia del file ${filePath}:`, e));
    }
  });
}

function ripristinaTimer(conn) {
  if (conn.timerReset) clearInterval(conn.timerReset);
  conn.timerReset = setInterval(async () => {
    if (stopped === 'close' || !conn || !conn.user) return;
    await clearDirectory(join(__dirname, 'tmp'));
    await clearDirectory(join(__dirname, 'temp'));
  }, 1000 * 60 * 30);
}

_quickTest().then(() => {
  if (global.conn?.logger) global.conn.logger.info(chalk.bold.bgBlueBright(``));
});

let filePath = fileURLToPath(import.meta.url);
const mainWatcher = watch(filePath, async () => {
  console.log(chalk.bold.bgBlueBright("Main Aggiornato"));
  await global.reloadHandler(true).catch(console.error);
});
mainWatcher.setMaxListeners(20);

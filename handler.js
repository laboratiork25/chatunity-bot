import { smsg } from './lib/simple.js'
import { format } from 'util'
import { fileURLToPath, pathToFileURL } from 'url'
import path, { join } from 'path'
import { unwatchFile, watchFile } from 'fs'
import chalk from 'chalk'

const isNumber = x => typeof x === 'number' && !isNaN(x)
const delay = ms => isNumber(ms) && new Promise(resolve => setTimeout(resolve, ms))

// ==================== CACHE GLOBALI ====================
if (!global.processedMessages) global.processedMessages = new Set()
if (!global.groupMetaCache) global.groupMetaCache = new Map()

const DUPLICATE_WINDOW = 3000
const GROUP_META_CACHE_TTL = 300000

// Auto-save database ogni 10 minuti
if (!global.dbSaveInterval) {
  global.dbSaveInterval = setInterval(() => {
    if (global.db?.write) global.db.write().catch(() => {})
  }, 10 * 60 * 1000)
}

// ==================== HANDLER PRINCIPALE ====================
export async function handler(chatUpdate) {
  this.msgqueque = this.msgqueque || []
  if (!chatUpdate) return
  
  this.pushMessage(chatUpdate.messages).catch(() => {})
  let m = chatUpdate.messages[chatUpdate.messages.length - 1]
  if (!m) return
  
  // Deduplica messaggi
  const msgId = m.key?.id
  if (!msgId) return
  if (global.processedMessages.has(msgId)) return
  global.processedMessages.add(msgId)
  setTimeout(() => global.processedMessages.delete(msgId), DUPLICATE_WINDOW)
  
  // Lazy load DB
  if (!global.db?.data) await global.loadDatabase()
  
  // Normalizza messaggio
  m = smsg(this, m) || m
  if (!m) return
  
  // Normalizza JID
  if (m.key) {
    m.key.remoteJid = this.decodeJid(m.key.remoteJid)
    if (m.key.participant) m.key.participant = this.decodeJid(m.key.participant)
  }
  if (!m.key?.remoteJid) return
  
  await processMessage.call(this, m, chatUpdate)
}

// ==================== PROCESS MESSAGE ====================
async function processMessage(m, chatUpdate) {
  const isOwner = (() => {
    try {
      if (!global.owner) global.owner = []
      const owners = [this.decodeJid(this.user.jid), ...global.owner.map(([num]) => num + '@s.whatsapp.net')]
      return owners.includes(m.sender) || m.fromMe
    } catch {
      return false
    }
  })()
  
  try {
    m.exp = 0
    
    // ==================== INIT DB ====================
    if (!global.db.data.users) global.db.data.users = {}
    if (!global.db.data.chats) global.db.data.chats = {}
    if (!global.db.data.stats) global.db.data.stats = {}
    if (!global.db.data.settings) global.db.data.settings = {}
    
    let user = global.db.data.users[m.sender]
    if (!user) {
      user = global.db.data.users[m.sender] = {
        name: m.name || m.pushName || 'User',
        banned: false,
        messages: 0
      }
    }
    
    let chat = global.db.data.chats[m.chat]
    if (!chat) {
      chat = global.db.data.chats[m.chat] = {
        name: m.isGroup ? await this.getName(m.chat) : m.name,
        isBanned: false,
        welcome: false,
        detect: false,
        sWelcome: '',
        sBye: '',
        sPromote: '',
        sDemote: '',
        antilink: false,
        antilink2: false,
        antispam: false,
        antimedia: false,
        antitoxic: false,
        warnings: {},
        antispamData: {},
        mediaWarnings: {}
      }
    }
    
    let settings = global.db.data.settings[this.user.jid]
    if (!settings) {
      settings = global.db.data.settings[this.user.jid] = {
        self: false,
        autoread: false
      }
    }
    
    if (global.opts?.['nyimak']) return
    if (!m.fromMe && global.opts?.['self']) return
    if (m.isBaileys) return
    
    if (typeof m.text !== 'string') m.text = ''
    
    const stats = global.db.data.stats
    let usedPrefix
    
    // ==================== GRUPPO METADATA (LOGICA VECCHIA FUNZIONANTE) ====================
    let groupMetadata = {}
    if (m.isGroup) {
      const cached = global.groupMetaCache.get(m.chat)
      if (cached && Date.now() - cached.timestamp < GROUP_META_CACHE_TTL) {
        groupMetadata = cached.data
      } else {
        try {
          groupMetadata = ((this.chats[m.chat] || {}).metadata || await this.groupMetadata(m.chat).catch(_ => null)) || {}
          global.groupMetaCache.set(m.chat, {
            data: groupMetadata,
            timestamp: Date.now()
          })
        } catch {
          groupMetadata = {}
        }
      }
    }
    
    const participants = (m.isGroup ? groupMetadata.participants : []) || []
    const normalizedParticipants = participants.map(u => {
      const normalizedId = this.decodeJid(u.id)
      return { ...u, id: normalizedId, jid: u.jid || normalizedId }
    })
    const user_participant = (m.isGroup ? normalizedParticipants.find(u => this.decodeJid(u.id) === m.sender) : {}) || {}
    const bot = (m.isGroup ? normalizedParticipants.find(u => this.decodeJid(u.id) == this.user.jid) : {}) || {}
    
    // Funzione isUserAdmin (ORIGINALE FUNZIONANTE)
    async function isUserAdmin(conn, chatId, senderId) {
      try {
        const decodedSender = conn.decodeJid(senderId)
        return groupMetadata?.participants?.some(p =>
          (conn.decodeJid(p.id) === decodedSender || p.jid === decodedSender) &&
          (p.admin === 'admin' || p.admin === 'superadmin')
        ) || false
      } catch {
        return false
      }
    }
    
    const isRAdmin = user_participant?.admin == 'superadmin' || false
    const isAdmin = m.isGroup ? await isUserAdmin(this, m.chat, m.sender) : false
    const isBotAdmin = m.isGroup ? await isUserAdmin(this, m.chat, this.user.jid) : false
    
    m.isAdmin = isAdmin
    m.isBotAdmin = isBotAdmin
    
    const ___dirname = path.join(path.dirname(fileURLToPath(import.meta.url)), './plugins')
    
    // ==================== PLUGIN.ALL ====================
    for (let name in global.plugins) {
      let plugin = global.plugins[name]
      if (!plugin || plugin.disabled) continue
      
      if (typeof plugin.all === 'function') {
        try {
          await plugin.all.call(this, m, {
            chatUpdate,
            __dirname: ___dirname,
            __filename: join(___dirname, name)
          })
        } catch (e) {
          console.error(`[plugin.all] ${name}:`, e)
        }
      }
    }
    
    // ==================== PLUGIN.BEFORE ====================
    for (let name in global.plugins) {
      let plugin = global.plugins[name]
      if (!plugin || plugin.disabled) continue
      
      if (typeof plugin.before === 'function') {
        try {
          const shouldContinue = await plugin.before.call(this, m, {
            conn: this,
            participants: normalizedParticipants,
            groupMetadata,
            user: user_participant,
            bot,
            isOwner,
            isAdmin,
            isBotAdmin,
            chatUpdate,
            __dirname: ___dirname,
            __filename: join(___dirname, name)
          })
          if (shouldContinue === false) return
        } catch (e) {
          console.error(`[plugin.before] ${name}:`, e)
        }
      }
    }
    
    // ==================== PLUGIN COMMANDS ====================
    for (let name in global.plugins) {
      let plugin = global.plugins[name]
      if (!plugin || plugin.disabled) continue
      if (typeof plugin !== 'function') continue
      
      const str2Regex = str => str.replace(/[|\\{}()[\]^$+*?.]/g, '\\$&')
      let _prefix = plugin.customPrefix || this.prefix || global.prefix
      
      let match = (_prefix instanceof RegExp ?
        [[_prefix.exec(m.text), _prefix]] :
        Array.isArray(_prefix) ?
          _prefix.map(p => {
            let re = p instanceof RegExp ? p : new RegExp(str2Regex(p))
            return [re.exec(m.text), re]
          }) :
          typeof _prefix === 'string' ?
            [[new RegExp(str2Regex(_prefix)).exec(m.text), new RegExp(str2Regex(_prefix))]] :
            [[[], new RegExp]]
      ).find(p => p[1])
      
      if (!match) continue
      
      usedPrefix = (match[0] || '')[0]
      if (!usedPrefix) continue
      
      let noPrefix = m.text.replace(usedPrefix, '')
      let [command, ...args] = noPrefix.trim().split` `.filter(v => v)
      args = args || []
      let _args = noPrefix.trim().split` `.slice(1)
      let text = _args.join` `
      command = (command || '').toLowerCase()
      
      let fail = plugin.fail || global.dfail
      let isAccept = plugin.command instanceof RegExp ?
        plugin.command.test(command) :
        Array.isArray(plugin.command) ?
          plugin.command.some(cmd => cmd instanceof RegExp ? cmd.test(command) : cmd === command) :
          typeof plugin.command === 'string' ?
            plugin.command === command :
            false
      
      if (!isAccept) continue
      
      m.plugin = name
      
      // Check ban
      if (chat?.isBanned && !isOwner) return
      if (user?.banned && !isOwner) return
      
      // Check permessi
      if (plugin.owner && !isOwner) {
        fail('owner', m, this)
        continue
      }
      if (plugin.group && !m.isGroup) {
        fail('group', m, this)
        continue
      }
      if (plugin.botAdmin && !isBotAdmin) {
        fail('botAdmin', m, this)
        continue
      }
      if (plugin.admin && !isAdmin && !isOwner) {
        fail('admin', m, this)
        continue
      }
      if (plugin.private && m.isGroup) {
        fail('private', m, this)
        continue
      }
      
      m.isCommand = true
      let xp = 'exp' in plugin ? parseInt(plugin.exp) : 0
      m.exp += xp
      
      let extra = {
        match,
        usedPrefix,
        noPrefix,
        _args,
        args,
        command,
        text,
        conn: this,
        normalizedParticipants,
        participants,
        groupMetadata,
        user: user_participant,
        bot,
        isOwner,
        isAdmin,
        isBotAdmin,
        chatUpdate,
        __dirname: ___dirname,
        __filename: join(___dirname, name)
      }
      
      try {
        await plugin.call(this, m, extra)
      } catch (e) {
        m.error = e
        console.error(`[plugin] ${name}:`, e)
        if (e) {
          let textErr = format(e)
          await m.reply(textErr).catch(() => {})
        }
      } finally {
        if (typeof plugin.after === 'function') {
          try {
            await plugin.after.call(this, m, extra)
          } catch (e) {
            console.error(`[plugin.after] ${name}:`, e)
          }
        }
      }
      break
    }
  } catch (e) {
    console.error('[handler]', e)
  } finally {
    // Update stats
    if (m?.sender) {
      let user = global.db.data.users[m.sender]
      if (user) {
        user.exp = (user.exp || 0) + m.exp
        user.messages = (user.messages || 0) + 1
      }
    }
    
    if (m?.plugin) {
      const now = Date.now()
      const stats = global.db.data.stats
      if (!stats[m.plugin]) {
        stats[m.plugin] = {
          total: 0,
          success: 0,
          last: 0,
          lastSuccess: 0
        }
      }
      const stat = stats[m.plugin]
      stat.total++
      stat.last = now
      if (!m.error) {
        stat.success++
        stat.lastSuccess = now
      }
    }
    
    // Print console
    try {
      if (!global.opts?.['noprint']) {
        await (await import('./lib/print.js')).default(m, this)
      }
    } catch (e) {}
    
    // Autoread
    if (global.opts?.['autoread']) {
      await this.readMessages([m.key]).catch(() => {})
    }
  }
}

// ==================== PARTICIPANTS UPDATE ====================
export async function participantsUpdate({ id, participants, action }) {
  if (global.opts?.['self']) return
  if (this.isInit) return
  if (!global.db?.data) await global.loadDatabase()
  
  let chat = global.db.data.chats[id] || {}
  let nomeDelBot = 'SafeGuard Bot'
  let jidCanale = '120363259442839354@newsletter'
  
  try {
    // Invalida cache gruppo
    global.groupMetaCache.delete(id)
    
    const groupMetadata = await this.groupMetadata(id).catch(() => null) || {}
    if (groupMetadata) {
      global.groupMetaCache.set(id, {
        data: groupMetadata,
        timestamp: Date.now()
      })
    }
    
    switch (action) {
      case 'add':
      case 'remove':
        if (chat.welcome) {
          for (let user of participants) {
            let pp = './media/menu/default.jpg'
            try {
              pp = await this.profilePictureUrl(user, 'image')
            } catch {}
            
            let apii = await this.getFile(pp).catch(() => ({ data: null }))
            let text = ''
            
            if (action === 'add') {
              text = (chat.sWelcome || '👋 Benvenuto/a, @user!')
                .replace('@subject', await this.getName(id).catch(() => 'Gruppo'))
                .replace('@desc', groupMetadata.desc?.toString() || 'Nessuna descrizione')
                .replace('@user', '@' + user.split('@')[0])
            } else {
              text = (chat.sBye || '👋 Addio, @user!')
                .replace('@user', '@' + user.split('@')[0])
            }
            
            await this.sendMessage(id, {
              text: text,
              contextInfo: {
                mentionedJid: [user],
                forwardingScore: 99,
                isForwarded: true,
                forwardedNewsletterMessageInfo: {
                  newsletterJid: jidCanale,
                  serverMessageId: '',
                  newsletterName: nomeDelBot
                },
                externalAdReply: {
                  title: action === 'add' ? '👋 Benvenuto' : '👋 Addio',
                  body: '',
                  previewType: 'PHOTO',
                  thumbnailUrl: '',
                  thumbnail: apii.data,
                  mediaType: 1,
                  renderLargerThumbnail: false
                }
              }
            }).catch(() => {})
          }
        }
        break
      
      case 'promote':
      case 'demote':
        if (chat.detect) {
          for (let user of participants) {
            let text = ''
            
            if (action === 'promote') {
              text = (chat.sPromote || '👑 @user è stato promosso ad amministratore')
                .replace('@user', '@' + user.split('@')[0])
            } else {
              text = (chat.sDemote || '📉 @user non è più amministratore')
                .replace('@user', '@' + user.split('@')[0])
            }
            
            if (text) {
              await this.sendMessage(id, {
                text: text,
                contextInfo: {
                  mentionedJid: [user]
                }
              }).catch(() => {})
            }
          }
          
          await delay(1000)
          global.groupMetaCache.delete(id)
        }
        break
    }
  } catch (e) {
    console.error('[participantsUpdate]', e)
  }
}

// ==================== GROUPS UPDATE ====================
export async function groupsUpdate(groupsUpdate) {
  if (global.opts?.['self']) return
  
  for (const groupUpdate of groupsUpdate) {
    const id = groupUpdate.id
    if (!id) continue
    
    let chats = global.db.data.chats[id] || {}
    let text = ''
    
    if (groupUpdate.icon) {
      text = (chats.sIcon || this.sIcon || '🖼️ Immagine gruppo modificata').replace('@icon', groupUpdate.icon)
    }
    if (groupUpdate.revoke) {
      text = (chats.sRevoke || this.sRevoke || '🔗 Link reimpostato\n\nNuovo link: @revoke').replace('@revoke', groupUpdate.revoke)
    }
    
    if (!text) continue
    
    await this.sendMessage(id, {
      text,
      mentions: this.parseMention(text)
    }).catch(() => {})
  }
}

// ==================== DFAIL ====================
global.dfail = (type, m, conn) => {
  const msg = {
    owner: 'ㅤㅤ⋆｡˚『 🛡️ ╭ `PERMESSO NEGATO` ╯ 』˚｡⋆\n\n『 ⚠️ 』Questo comando è riservato agli *owner* del bot\n\n> Solo i proprietari possono eseguire questa azione',
    admin: 'ㅤㅤ⋆｡˚『 👮 ╭ `PERMESSO NEGATO` ╯ 』˚｡⋆\n\n『 ⚠️ 』Questo comando è riservato agli *admin* del gruppo\n\n> Devi essere un amministratore per usare questo comando',
    botAdmin: 'ㅤㅤ⋆｡˚『 🤖 ╭ `BOT NON ADMIN` ╯ 』˚｡⋆\n\n『 ⚠️ 』Il bot deve essere *admin* per eseguire questo comando\n\n> Promuovi il bot ad amministratore per abilitare questa funzione',
    group: 'ㅤㅤ⋆｡˚『 👥 ╭ `SOLO GRUPPI` ╯ 』˚｡⋆\n\n『 ⚠️ 』Questo comando funziona solo nei gruppi\n\n> Usa questo comando in un gruppo WhatsApp',
    private: 'ㅤㅤ⋆｡˚『 📩 ╭ `SOLO PRIVATO` ╯ 』˚｡⋆\n\n『 ⚠️ 』Questo comando funziona solo in chat privata\n\n> Scrivimi in privato per usare questo comando'
  }[type]
  
  if (msg) conn.reply(m.chat, msg, m).catch(() => {})
}

// ==================== FILE WATCH ====================
const file = fileURLToPath(import.meta.url)
watchFile(file, async () => {
  unwatchFile(file)
  console.log(chalk.magenta("handler.js aggiornato"))
  import(pathToFileURL(file).href + `?update=${Date.now()}`).catch(console.error)
})
 

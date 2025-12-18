// Codice di owner-listagruppi.js

//Plugin fatto da Axtral_WiZaRd
function ensureDB() {
  if (!global.db) global.db = { data: { chats: {} } };
  if (!global.db.data.chats) global.db.data.chats = {};
}

let handler = async (m, { conn }) => {
  ensureDB();
  const delay = ms => new Promise(res => setTimeout(res, ms));

  const allGroups = await conn.groupFetchAllParticipating().catch(() => ({}));
  const groupsRaw = Object.values(allGroups || {}).filter(g => g.id.endsWith('@g.us'));
  const groups = groupsRaw.filter(g => {
    const meta = conn.chats[g.id]?.metadata || g.metadata || {};
    return !(meta.isCommunity || meta.announce || meta.read_only);
  });

  if (!groups.length) return m.reply('Non sono presente in nessun gruppo.');

  const output = [
    `𝐋𝐈𝐒𝐓𝐀 𝐃𝐄𝐈 𝐆𝐑𝐔𝐏𝐏𝐈 𝐃𝐈 ${await conn.getName(conn.user.jid)}`,
    '',
    `➣ 𝐓𝐨𝐭𝐚𝐥𝐞 𝐆𝐫𝐮𝐩𝐩𝐢: ${groups.length}`,
    '\n══════ ೋೋ══════\n'
  ];

  for (const [index, g] of groups.entries()) {
    const jid = g.id;
    const metadata = conn.chats[jid]?.metadata || g.metadata || {};
    const groupName = metadata.subject || 'Nome non disponibile';
    const membersCount = metadata.participants?.length || 0;

    if (!global.db.data.chats[jid]) global.db.data.chats[jid] = {};
    let link = global.db.data.chats[jid].groupInviteLink || 'Non disponibile';
    if (link === 'Non disponibile') {
      try {
        const code = await conn.groupInviteCode(jid);
        link = `https://chat.whatsapp.com/${code}`;
        global.db.data.chats[jid].groupInviteLink = link;
        await delay(300);
      } catch (e) {
        link = 'Non disponibile';
      }
    }

    output.push(
      `➣ 𝐆𝐑𝐔𝐏𝐏Ꮻ 𝐍𝐔𝐌𝚵𝐑Ꮻ: ${index + 1}`,
      `➣ 𝐆𝐑𝐔𝐏𝐏Ꮻ: ${groupName}`,
      `➣ 𝐌𝐄𝐌𝐁𝐑𝐈: ${membersCount}`,
      `➣ 𝕀𝐃: ${jid}`,
      `➣ 𝐋𝕀𝐍𝐊: ${link}`,
      '\n══════ ೋೋ══════\n'
    );
  }

  m.reply(output.join('\n'));
};

handler.command = /^(gruppi)$/i;
handler.owner = true;
export default handler;
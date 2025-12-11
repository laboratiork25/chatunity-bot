let linkRegex = /chat\.whatsapp\.com\/([0-9A-Za-z]{20,24})/i;

async function before(m, { conn }) {
    if (m.isGroup) return;
    if (!m.text) return;

    if (!linkRegex.test(m.text)) return;

    let match = m.text.match(linkRegex);
    let code = match ? match[1] : null;

    if (!code) {
        return m.reply(
            '『 ❌ 』 *Link non valido*\n\n' +
            '✅ Formato corretto: https://chat.whatsapp.com/xxxxxxxxx'
        );
    }

    let processingMsg = await m.reply(
        '🔄 Analizzando il gruppo...\n⏳ Controllo requisiti in corso...'
    );

    try {
        let groupInfo;
        try {
            groupInfo = await conn.groupGetInviteInfo(code);
        } catch (error) {
            return m.reply(
                '『 ❌ 』 *Errore nell\'ottenere informazioni sul gruppo*\n\n' +
                '💡 Possibili cause:\n' +
                '• Link scaduto o revocato\n' +
                '• Link non valido\n' +
                '• Mi avete rimosso > contattare owner'
            );
        }

        const MIN_MEMBERS = 50;

        if (groupInfo.size < MIN_MEMBERS) {
            return m.reply(
                `『 ❌ 』 *Gruppo troppo piccolo*\n\n` +
                `📊 *Membri attuali:* ${groupInfo.size}\n` +
                `📋 *Minimo richiesto:* ${MIN_MEMBERS} membri\n\n` +
                `💡 Torna quando il gruppo avrà più membri!`
            );
        }

        if (groupInfo.restrict) {
            return m.reply(
                '『 ❌ 』 *Accesso limitato*\n\n' +
                '🔒 Solo gli amministratori possono invitare membri in questo gruppo.\n' +
                '💡 Chiedi a un admin di aggiungermi manualmente.'
            );
        }

        try {
            let groupData = await conn.groupMetadata(groupInfo.id).catch(() => null);
            if (groupData) {
                return m.reply(
                    '『 ⚠ 』 *Sono già in questo gruppo!*\n\n' +
                    `📝 Nome: ${groupData.subject}\n` +
                    `👥 Membri: ${groupData.participants.length}`
                );
            }
        } catch (e) {}

        await conn.sendMessage(m.chat, {
            text: '✅ Requisiti soddisfatti!\n🚀 Ingresso nel gruppo in corso...',
            edit: processingMsg.key
        });

        let joinResult = await conn.groupAcceptInvite(code);

        let chats = global.db.data.chats[joinResult];
        if (!chats) global.db.data.chats[joinResult] = {};

        global.db.data.chats[joinResult].joinedBy = m.sender;
        global.db.data.chats[joinResult].joinedAt = Date.now();

        let successMessage =
            `✅ *Ingresso completato con successo!*\n\n` +
            `🏷 *Gruppo:* ${groupInfo.subject || 'Nome non disponibile'}\n` +
            `👥 *Membri:* ${groupInfo.size}\n` +
            `📅 *Data ingresso:* ${new Date().toLocaleString('it-IT')}\n\n` +
            `💡 *Per assistenza, contatta:* wa.me/393773842461`;

        await m.reply(successMessage);

        try {
            await new Promise(res => setTimeout(res, 2000));
            await conn.sendMessage(joinResult, {
                text:
                    `👋 *Ciao a tutti!*\n\n` +
                    `🤖 Sono ChatUnity Bot, felice di essere qui!\n\n` +
                    `💡 Per assistenza:\n` +
                    `📱 Contatta: wa.me/393773842461\n\n` +
                    `🚀 Buona giornata a tutti!`
            });
        } catch (welcomeError) {}

    } catch (error) {
        let errorMessage = '『 ❌ 』 *Errore durante l\'ingresso nel gruppo*\n\n';

        if (error.message.includes('forbidden')) {
            errorMessage += '🔒 Accesso negato. Il gruppo potrebbe avere limitazioni.';
        } else if (error.message.includes('not-found')) {
            errorMessage += '🔍 Gruppo non trovato. Il link potrebbe essere scaduto.';
        } else if (error.message.includes('conflict')) {
            errorMessage += '⚠ Sono già nel gruppo o c’è un conflitto.';
        } else {
            errorMessage +=
                `💡 Riprova tra qualche minuto o verifica il link.\n📋 Errore: ${error.message}`;
        }

        errorMessage += '\n\n📧 Se il problema persiste, contatta: wa.me/393773842461';

        return m.reply(errorMessage);
    }
}

export default {
    before
};
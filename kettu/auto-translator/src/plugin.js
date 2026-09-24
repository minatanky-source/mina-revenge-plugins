// SPDX-License-Identifier: GPL-3.0-only
const { createTranslator, canTranslate } = core;
const api = vendetta;
const storage = api.plugin.storage;
const defaults = { mode: 'gemini', inputLanguage: 'pt-BR', outputLanguage: 'en', offlineSource: 'en', ownLanguage: 'pt', incoming: true, outgoing: true, apiKey: '', offlineToken: '', model: 'gemini-3.5-flash-lite', freeTierConfirmed: false };
for (const key of Object.keys(defaults)) if (storage[key] === undefined) storage[key] = defaults[key];
const { React: R, ReactNative: RN, FluxDispatcher: bus } = api.metro.common;
const engine = createTranslator({ getConfig: () => storage, fetch: (...args) => fetch(...args) });
const entries = new Map(), pending = new Map(), timers = new Map();
const cleanup = [];
let messageStore, userStore, selectedStore, actions, active = false, epoch = 0, working = false, status = 'Iniciando…';
let lastToast = 0, appliedCount = 0, connected = false;
const FLAG = '__minaKettuTranslation';
const idOf = (channel, id) => channel + ':' + id;
function toast(message) {
    status = message;
    if (Date.now() - lastToast < 15000) return;
    lastToast = Date.now();
    try { api.ui.toasts.showToast(message); } catch (_) {}
}
function defer(key, fn, delay = 0) {
    if (!active || timers.has(key)) return;
    timers.set(key, setTimeout(() => { timers.delete(key); if (active) { try { fn(); } catch (_) { status = 'Não foi possível atualizar o chat.'; } } }, delay));
}
function list(collection) {
    if (Array.isArray(collection)) return collection;
    if (Array.isArray(collection?._array)) return collection._array;
    if (typeof collection?.toArray === 'function') return collection.toArray();
    if (typeof collection?.values === 'function') return Array.from(collection.values());
    return [];
}
function currentChannel() { return selectedStore?.getChannelId?.(); }
function original(message, channel) {
    const entry = entries.get(idOf(channel, message.id));
    return entry && message.content === entry.applied ? entry.original : message.content;
}
function contextFor(channel, excludeIds = []) {
    const excluded = new Set(excludeIds);
    return list(messageStore?.getMessages?.(channel)).filter(m => !excluded.has(m.id) && typeof m.content === 'string')
        .sort((a, b) => a.id.length - b.id.length || a.id.localeCompare(b.id)).slice(-3).map(m => original(m, channel));
}
function setLocal(entry, content) {
    const current = messageStore?.getMessage?.(entry.channel, entry.id);
    if (!current || (current.content !== entry.original && current.content !== entry.applied)) return;
    if (current.content === content) return;
    entry.applied = content === entry.original ? undefined : content;
    // Only the local Flux store changes. No Discord edit request is made.
    try { Promise.resolve(bus.dispatch({ type: 'MESSAGE_UPDATE', message: { id: entry.id, channel_id: entry.channel, content }, [FLAG]: true })).catch(() => { status = 'Falha ao mostrar tradução no chat.'; }); }
    catch (_) { status = 'Falha ao mostrar tradução no chat.'; }
}
function restoreAll() {
    for (const entry of entries.values()) if (entry.applied) setLocal(entry, entry.original);
}
function observe(message, channel) {
    if (!active || !storage.incoming || channel !== currentChannel() || !message || typeof message.content !== 'string') return;
    const self = userStore?.getCurrentUser?.()?.id;
    if (!self || !message.author?.id || message.author.id === self || !canTranslate(message.content) || message.content.length > 4000) return;
    const key = idOf(channel, message.id);
    let entry = entries.get(key);
    if (!entry || (message.content !== entry.original && message.content !== entry.applied)) {
        entry = { channel, id: message.id, original: message.content, done: false, retryAt: 0 };
        entries.set(key, entry);
    }
    while (entries.size > 300) {
        const oldest = entries.keys().next().value;
        const item = entries.get(oldest);
        if (item.applied) setLocal(item, item.original);
        entries.delete(oldest); pending.delete(oldest);
    }
    if (!entry.done && !entry.busy && entry.retryAt <= Date.now() && pending.size < 60) { pending.set(key, entry); defer('batch', pump, 600); }
}
function scanCurrent() {
    const channel = currentChannel();
    if (!channel) return;
    // Initial backlog is bounded; new messages are observed through Flux.
    for (const m of list(messageStore?.getMessages?.(channel)).slice(-24)) observe(m, channel);
}
async function pump() {
    if (working || !active || !storage.incoming) return;
    const generation = epoch, channel = currentChannel();
    const group = [];
    for (const [key, entry] of pending) {
        pending.delete(key);
        if (entry.channel !== channel || entry.done || entries.get(key) !== entry) continue;
        group.push(entry); entry.busy = true;
        if (group.length === 6) break;
    }
    if (!group.length) return;
    working = true;
    try {
        const result = await engine.translate(group.map(e => e.original), { target: storage.inputLanguage, source: storage.offlineSource, context: contextFor(channel, group.map(e => e.id)) });
        if (!active || generation !== epoch || !storage.incoming) return;
        group.forEach((entry, i) => {
            if (entries.get(idOf(entry.channel, entry.id)) !== entry) return;
            entry.done = true;
            if (currentChannel() === entry.channel) { setLocal(entry, result.texts[i]); appliedCount++; }
            else entry.done = false;
        });
        status = 'Recebidas: ' + (result.provider === 'offline' ? 'Offline · Google Tradutor' : 'Gemini');
    } catch (error) {
        if (active && generation === epoch) { group.forEach(e => { e.retryAt = Date.now() + 60000; }); toast(error.message); }
    } finally {
        group.forEach(e => { e.busy = false; }); working = false;
        if (active && pending.size) defer('batch', pump, 600);
    }
}
function reset() {
    epoch++; engine.reset(); pending.clear(); restoreAll(); entries.clear();
    if (active) defer('scan', scanCurrent);
}
function failSend(error, args, originalSend, generation) {
    const content = args[1]?.content || '';
    const buttons = [
        { text: 'Cancelar', style: 'cancel' },
        { text: 'Copiar original', onPress: () => api.metro.common.clipboard.setString(content) }
    ];
    // This is the only fallback that can send the untranslated original.
    buttons.push({ text: 'Enviar original', onPress: () => {
        if (!active || generation !== epoch) return;
        Promise.resolve(originalSend(...args)).catch(() => toast('O Discord não conseguiu enviar a mensagem.'));
    } });
    RN.Alert.alert('Mensagem não enviada', error.message + '\n\nVocê pode copiar seu texto ou enviar o original.', buttons, { cancelable: true });
}
function connect() {
    if (!active || connected) return;
    const findStore = name => { try { return api.metro.findByStoreName(name); } catch (_) { return undefined; } };
    messageStore = findStore('MessageStore'); userStore = findStore('UserStore'); selectedStore = findStore('SelectedChannelStore');
    actions = api.metro.findByProps('sendMessage', 'editMessage');
    if (!messageStore?.getMessages || !messageStore?.getMessage || !userStore?.getCurrentUser || !selectedStore?.getChannelId || !actions?.sendMessage || !bus?.subscribe) {
        status = 'Aguardando componentes do Discord…'; defer('connect', connect, 2000); return;
    }
    connected = true;
    cleanup.push(api.patcher.after('getMessages', messageStore, ([channel], result) => {
        if (channel === currentChannel()) defer('scan-get', () => { for (const m of list(result).slice(-24)) observe(m, channel); });
        return result;
    }));
    let outgoingQueue = Promise.resolve();
    cleanup.push(api.patcher.instead('sendMessage', actions, (args, originalSend) => {
        const text = args[1]?.content;
        if (!active || !storage.outgoing || !canTranslate(text)) return originalSend(...args);
        const snapshot = [...args]; snapshot[1] = { ...args[1] };
        const generation = epoch;
        const cfg = { target: storage.outputLanguage, source: storage.ownLanguage, context: contextFor(args[0]) };
        const job = outgoingQueue.catch(() => {}).then(async () => {
            if (!active || generation !== epoch) return;
            let result;
            try {
                result = await engine.translate([text], cfg);
                if (!active || generation !== epoch) return;
                // Preserve Discord's own limits; do not split/send multiple messages silently.
                if (result.texts[0].length > 2000 && result.texts[0].length > text.length) throw new Error('A tradução ficou maior que 2000 caracteres. Encurte a mensagem antes de enviar.');
            } catch (error) {
                if (active && generation === epoch) failSend(error, snapshot, originalSend, generation);
                return;
            }
            snapshot[1] = { ...snapshot[1], content: result.texts[0] };
            status = 'Enviadas: ' + (result.provider === 'offline' ? 'Offline · Google Tradutor' : 'Gemini');
            // Preserve result/errors from the real Discord send; never retry it here.
            return originalSend(...snapshot);
        });
        outgoingQueue = job.catch(() => {});
        return job;
    }));
    for (const type of ['MESSAGE_CREATE', 'MESSAGE_UPDATE', 'LOAD_MESSAGES_SUCCESS', 'CHANNEL_SELECT', 'CONNECTION_OPEN', 'MESSAGE_DELETE', 'MESSAGE_DELETE_BULK']) {
        const handler = payload => {
            if (!active || payload[FLAG]) return;
            if (type === 'MESSAGE_DELETE' || type === 'MESSAGE_DELETE_BULK') {
                const channel = payload.channelId || payload.channel_id;
                for (const id of payload.ids || [payload.id]) { const key = idOf(channel, id); entries.delete(key); pending.delete(key); }
            } else if (type === 'MESSAGE_CREATE' || type === 'MESSAGE_UPDATE') {
                const m = payload.message, channel = m?.channel_id || payload.channelId;
                if (m?.id && channel === currentChannel()) defer('message:' + idOf(channel, m.id), () => observe(messageStore.getMessage(channel, m.id), channel));
            } else defer('scan', scanCurrent);
        };
        bus.subscribe(type, handler); cleanup.push(() => bus.unsubscribe(type, handler));
    }
    status = 'Conectado ao Discord. Configure o tradutor.';
    defer('scan', scanCurrent);
}
function Settings() {
    const [revision, redraw] = R.useState(0);
    R.useEffect(() => { const timer = setInterval(() => redraw(n => n + 1), 1500); return () => clearInterval(timer); }, []);
    const colors = { text: '#f3f4f6', muted: '#b4b9c4', panel: '#24262e', bg: '#17181d', accent: '#9dbaff' };
    const h = R.createElement;
    const set = (key, value) => { storage[key] = value; reset(); redraw(n => n + 1); };
    const label = (text, muted = false) => h(RN.Text, { style: { color: muted ? colors.muted : colors.text, fontSize: muted ? 13 : 16, marginBottom: 8 } }, text);
    const button = (text, onPress, selected = false) => h(RN.Pressable, { key: text, onPress, accessibilityRole: 'button', style: { backgroundColor: selected ? '#34476f' : colors.panel, borderRadius: 8, padding: 13, marginBottom: 8 } }, label(text));
    const field = (title, key, secure = false) => h(RN.View, { key, style: { marginTop: 12 } }, label(title), h(RN.TextInput, {
        defaultValue: String(storage[key]), key: key + ':' + (secure ? 'secret' : storage[key]), secureTextEntry: secure, autoCapitalize: 'none', autoCorrect: false,
        placeholder: secure ? 'Cole aqui; não envie no chat' : '', placeholderTextColor: colors.muted,
        onEndEditing: event => { const value = event.nativeEvent.text.trim(); if (storage[key] !== value) set(key, value); },
        style: { backgroundColor: colors.panel, color: colors.text, borderRadius: 8, padding: 12 }, accessibilityLabel: title
    }));
    const toggle = (title, key) => h(RN.View, { key, style: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 12 } }, h(RN.Text, { style: { color: colors.text, flex: 1, paddingRight: 12 } }, title), h(RN.Switch, { value: Boolean(storage[key]), onValueChange: value => set(key, value), accessibilityLabel: title }));
    async function test(mode) {
        RN.Keyboard.dismiss();
        try {
            const result = await engine.translate(['hey, are you coming?'], { target: storage.inputLanguage, source: 'en', mode });
            RN.Alert.alert('Teste: ' + result.provider, result.texts[0]);
        } catch (error) { RN.Alert.alert('Teste falhou', error.message); }
    }
    return h(RN.ScrollView, { style: { backgroundColor: colors.bg }, contentContainerStyle: { padding: 18, paddingBottom: 48 }, keyboardShouldPersistTaps: 'handled' },
        label('Mina Translator · Kettu'), label(status, true),
        label('Modo de tradução'), ...[['gemini', 'Gemini'], ['offline', 'Offline · Google Tradutor'], ['auto', 'Automático · Gemini → Offline']].map(([value, title]) => button(title, () => set('mode', value), storage.mode === value)),
        toggle('Traduzir mensagens recebidas', 'incoming'), toggle('Traduzir minhas mensagens antes de enviar', 'outgoing'),
        field('Ler em (ex.: pt-BR)', 'inputLanguage'), field('Enviar em (ex.: en)', 'outputLanguage'),
        label('O idioma de envio vale para todas as conversas. Desative a saída automática ao conversar no seu idioma.', true),
        field('Chave do Gemini', 'apiKey', true),
        toggle('Minha chave usa um projeto Free Tier, sem faturamento', 'freeTierConfirmed'),
        label('Gemini recebe a mensagem e até 3 mensagens de contexto da mesma conversa. No plano gratuito, o Google pode usar esse conteúdo para melhorar produtos. O plugin não consegue verificar o faturamento da sua conta.', true),
        button('Criar chave gratuita', () => RN.Linking.openURL('https://aistudio.google.com/apikey')),
        field('Modelo Gemini', 'model'), button('Testar Gemini', () => test('gemini')),
        field('Código de conexão do Mina Offline', 'offlineToken', true),
        field('Idioma recebido no offline (ex.: en)', 'offlineSource'), field('Idioma que eu escrevo no offline (ex.: pt)', 'ownLanguage'),
        label('Abra o app Mina Offline, baixe os idiomas e toque em Iniciar. O offline traduz no aparelho, sem enviar o texto para o Gemini. É mais simples e pode errar gírias. O Discord ainda precisa de internet para receber e enviar mensagens.', true),
        button('Testar Offline', () => test('offline')),
        button('Tentar novamente / limpar traduções', () => { engine.retry(); reset(); }),
        button('Copiar diagnóstico', () => { api.metro.common.clipboard.setString(JSON.stringify({ version: '0.1.0', connected, mode: storage.mode, status, applied: appliedCount, requests: engine.stats }, null, 2)); toast('Diagnóstico copiado, sem chaves nem mensagens.'); }),
        label('Traduções na sessão: ' + appliedCount + ' · Pedidos Gemini: ' + engine.stats.cloud + ' · Offline: ' + engine.stats.offline, true),
        label('Offline: Powered by Google Translate. Versão inicial: precisa de teste no celular.', true)
    );
}
module.exports = {
    onLoad() { active = true; epoch++; connect(); },
    onUnload() {
        active = false; epoch++; engine.reset(); pending.clear();
        for (const timer of timers.values()) clearTimeout(timer); timers.clear();
        for (const fn of cleanup.splice(0).reverse()) { try { fn(); } catch (_) {} }
        restoreAll(); entries.clear(); connected = false;
    },
    settings: Settings
};

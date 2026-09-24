const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createTranslator, protect, restore, canTranslate } = require('../src/core');
const base = { mode: 'gemini', apiKey: 'test-only', freeTierConfirmed: true, model: 'gemini-3.5-flash-lite', offlineToken: 'local-test' };
function response(status, body) { return { ok: status === 200, status, json: async () => body }; }
function gemini(texts) { return response(200, { candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify({ translations: texts.map((text,id) => ({ id, text })) }) }] } }] }); }
function setup(fetch, config = {}) { return createTranslator({ getConfig: () => ({ ...base, ...config }), fetch, interval: 0, timeout: 100 }); }
test('protects mentions, code, dollars, links and repeated tokens', () => {
    const text = 'hey <@123> `x=$&` https://a.test/path?a=$1 @everyone <@123>';
    const saved = protect(text); assert.equal(restore(saved.prepared, saved), text);
    assert.throws(() => restore(saved.prepared + ' <@456>', saved));
    assert.throws(() => restore(saved.prepared.replace(saved.prefix + '0XZQ',''), saved));
    assert.throws(() => restore(saved.prepared + saved.prefix + '0XZQ', saved));
});
test('literal placeholder-like text cannot collide', () => {
    const text = 'QZXKEEP0XZQ QZXSAFEKEEP0XZQ <@123>';
    const saved = protect(text); assert.equal(restore(saved.prepared, saved), text);
    assert.equal(saved.prefix, 'QZXSAFESAFEKEEP');
});
test('skip messages made only of code, links or mentions', () => {
    assert.equal(canTranslate('`hello` <@123> https://a.test'), false);
    assert.equal(canTranslate('brb'), true); assert.equal(canTranslate('oi'), true);
});
test('Gemini keeps key out of URL and bounds contextual messages', async () => {
    const engine = setup(async (url, init) => {
        assert(!url.includes('test-only')); assert.equal(init.headers['x-goog-api-key'], 'test-only');
        const body = JSON.parse(init.body); const data = JSON.parse(body.contents[0].parts[0].text);
        assert.equal(data.context.length, 3); assert.equal(data.context[0].length, 600);
        return gemini(['já volto']);
    });
    assert.deepEqual(await engine.translate(['brb'], { target:'pt-BR', context:['old','x'.repeat(800),'hello','hi'] }), { provider:'gemini', texts:['já volto'] });
});
test('cache avoids an identical second request', async () => {
    let n=0; const engine=setup(async()=>{n++; return gemini(['oi']);});
    await engine.translate(['hi'],{target:'pt'}); await engine.translate(['hi'],{target:'pt'}); assert.equal(n,1);
});
test('offline never calls Google and uses fixed authenticated loopback', async () => {
    const engine=setup(async(url,init)=>{
        assert.equal(url,'http://127.0.0.1:17843/translate'); assert.equal(init.headers.Authorization,'Bearer local-test');
        assert.equal(JSON.parse(init.body).target,'pt'); assert(!init.headers['x-goog-api-key']);
        return response(200,{translations:['oi']});
    },{mode:'offline'});
    assert.equal((await engine.translate(['hi'],{target:'pt-BR'})).provider,'offline');
});
test('auto falls back on 429 and observes cloud cooldown', async () => {
    let cloud=0,local=0;
    const engine=setup(async url=>{ if(url.startsWith('https:')){cloud++; return response(429,{});} local++;return response(200,{translations:['olá']}); },{mode:'auto'});
    assert.equal((await engine.translate(['hi'],{target:'pt'})).provider,'offline');
    await engine.translate(['hello'],{target:'pt'});assert.equal(cloud,1);assert.equal(local,2);
});
test('explicit Gemini never silently falls back', async()=>{
    const engine=setup(async url=>{assert(url.startsWith('https:'));return response(429,{});});
    await assert.rejects(engine.translate(['hi'],{target:'pt'}), /Cota/);
});
test('auto does not route safety refusals or invalid keys into another provider', async()=>{
    let calls=0; const engine=setup(async()=>{calls++;return response(403,{});},{mode:'auto'});
    await assert.rejects(engine.translate(['hi'],{target:'pt'}), /inválido/); assert.equal(calls,1);
    const safety=setup(async()=>response(200,{candidates:[{finishReason:'SAFETY'}]}),{mode:'auto'});
    await assert.rejects(safety.translate(['hi'],{target:'pt'}),/completa/);
});
test('Gemini requires free-tier confirmation before making requests',async()=>{
    const engine=setup(async()=>assert.fail('network called'),{freeTierConfirmed:false});
    await assert.rejects(engine.translate(['hi'],{target:'pt'}),/Confirme/);
});
test('malformed, partial and duplicate batch replies are rejected',async()=>{
    const engine=setup(async()=>gemini(['oi']));
    await assert.rejects(engine.translate(['hi','bye'],{target:'pt'}),/incompleta/);
    const bad=setup(async()=>response(200,{candidates:[{finishReason:'STOP',content:{parts:[{text:'not-json'}]}}]}));
    await assert.rejects(bad.translate(['hi'],{target:'pt'}),/inválida/);
});
test('reset suppresses a result even if transport ignores cancellation',async()=>{
    let done; const engine=setup(()=>new Promise(resolve=>{done=resolve;}));
    const pending=engine.translate(['hi'],{target:'pt'});
    await new Promise(resolve=>setImmediate(resolve));engine.reset();done(gemini(['oi']));
    await assert.rejects(pending,/cancelada/);
});
test('request timeout covers stalled body parsing too',async()=>{
    const engine=setup(async()=>({ok:true,status:200,json:()=>new Promise(()=>{})}));
    await assert.rejects(engine.translate(['hi'],{target:'pt'}),/demorou/);
});
test('invalid model cannot redirect key to an external server',async()=>{
    const engine=setup(async()=>assert.fail('network called'),{model:'../../other?key=abc'});
    await assert.rejects(engine.translate(['hi'],{target:'pt'}),/modelo inválido/);
});

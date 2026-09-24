const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const coreSource = fs.readFileSync(require.resolve('../src/core'), 'utf8');
const pluginSource = fs.readFileSync(require.resolve('../src/plugin'), 'utf8');
const tick = (ms=15) => new Promise(resolve=>setTimeout(resolve,ms));
function harness(fetchOverride) {
    const messages=new Map(), sent=[], alerts=[], updates=[], subscriptions=new Map();
    const storage={mode:'offline',offlineToken:'local',incoming:true,outgoing:true,inputLanguage:'pt-BR',outputLanguage:'en',offlineSource:'en',ownLanguage:'pt'};
    const timers=new Set(); let selected='c1';
    const bus={
        subscribe(type,fn){if(!subscriptions.has(type))subscriptions.set(type,new Set());subscriptions.get(type).add(fn);},
        unsubscribe(type,fn){subscriptions.get(type)?.delete(fn);},
        dispatch(p){if(p.message){const key=p.message.channel_id+':'+p.message.id;messages.set(key,{...messages.get(key),...p.message});if(p.__minaKettuTranslation)updates.push(p.message.content);}for(const fn of subscriptions.get(p.type)||[])fn(p);return Promise.resolve();}
    };
    const store={getMessage:(c,id)=>messages.get(c+':'+id),getMessages:c=>Array.from(messages.values()).filter(m=>m.channel_id===c)};
    const actions={sendMessage(...args){sent.push(args);return Promise.resolve('sent');},editMessage(){}};
    const stores={MessageStore:store,UserStore:{getCurrentUser:()=>({id:'me'})},SelectedChannelStore:{getChannelId:()=>selected}};
    function patch(method,obj,fn,instead){const before=obj[method];obj[method]=function(...args){return instead?fn(args,before.bind(this)):fn(args,before.apply(this,args));};return()=>{obj[method]=before;};}
    const api={plugin:{storage},metro:{findByStoreName:n=>stores[n],findByProps:()=>actions,common:{React:{},ReactNative:{Alert:{alert:(...x)=>alerts.push(x)}},FluxDispatcher:bus,clipboard:{setString(){}}}},patcher:{after:(...args)=>patch(...args,false),instead:(...args)=>patch(...args,true)},ui:{toasts:{showToast(){}}}};
    let calls=0;
    const fetch=fetchOverride || (async(url,init)=>{calls++;return {ok:true,status:200,json:async()=>({translations:JSON.parse(init.body).texts.map(x=>'translated '+x)})};});
    const context={vendetta:api,fetch,AbortController,console,clearTimeout:id=>{clearTimeout(id);timers.delete(id);},setTimeout:(fn,ms)=>{const id=setTimeout(()=>{timers.delete(id);fn();},Math.min(ms,100));timers.add(id);return id;}};
    const source='const core=(()=>{const module={exports:{}};'+coreSource+';return module.exports;})();(()=>{const module={exports:{}};'+pluginSource+';return module.exports;})()';
    const plugin=vm.runInNewContext(source,context);
    function add(id,content,author='other',channel='c1'){messages.set(channel+':'+id,{id,channel_id:channel,content,author:{id:author}});}
    return{plugin,storage,messages,sent,alerts,updates,bus,actions,add,select:c=>{selected=c;bus.dispatch({type:'CHANNEL_SELECT'});},get calls(){return calls;},close(){plugin.onUnload();for(const timer of timers)clearTimeout(timer);}};
}
test('incoming translations are local, current-channel only, and restore on unload',async()=>{
    const h=harness();try{h.add('1','hello');h.add('2','my text','me');h.add('3','elsewhere','other','c2');h.plugin.onLoad();await tick(150);
    assert.equal(h.messages.get('c1:1').content,'translated hello');assert.equal(h.messages.get('c1:2').content,'my text');assert.equal(h.messages.get('c2:3').content,'elsewhere');assert.equal(h.sent.length,0);
    h.plugin.onUnload();assert.equal(h.messages.get('c1:1').content,'hello');}finally{h.close();}
});
test('outgoing preserves order, channel, reply, attachments and options',async()=>{
    const h=harness();try{h.plugin.onLoad();const reply={id:'reply'},options={nonce:'123'},attachments=[{id:'file'}];
    await Promise.all([h.actions.sendMessage('c1',{content:'oi',attachments},reply,options),h.actions.sendMessage('c1',{content:'tudo bem'},null,{nonce:'124'})]);
    assert.equal(h.sent.length,2);assert.equal(h.sent[0][1].content,'translated oi');assert.equal(h.sent[1][1].content,'translated tudo bem');assert.equal(h.sent[0][0],'c1');assert.equal(h.sent[0][1].attachments,attachments);assert.equal(h.sent[0][2],reply);assert.equal(h.sent[0][3],options);}finally{h.close();}
});
test('translation failure blocks send until explicit original-send button',async()=>{
    const h=harness(async()=>({ok:false,status:503,json:async()=>({})}));try{h.plugin.onLoad();await h.actions.sendMessage('c1',{content:'oi'});assert.equal(h.sent.length,0);assert.equal(h.alerts.length,1);h.alerts[0][2].find(x=>x.text==='Enviar original').onPress();await tick();assert.equal(h.sent.length,1);assert.equal(h.sent[0][1].content,'oi');}finally{h.close();}
});
test('unload cancels an in-flight outgoing translation without sending',async()=>{
    let release;const h=harness(()=>new Promise(resolve=>{release=resolve;}));try{h.plugin.onLoad();const job=h.actions.sendMessage('c1',{content:'oi'});await tick();h.plugin.onUnload();release({ok:true,status:200,json:async()=>({translations:['hi']})});await job;assert.equal(h.sent.length,0);}finally{h.close();}
});
test('server edit wins over late incoming translation',async()=>{
    let release;const h=harness(()=>new Promise(resolve=>{release=resolve;}));try{h.add('1','before');h.plugin.onLoad();await tick(115);await h.bus.dispatch({type:'MESSAGE_UPDATE',message:{id:'1',channel_id:'c1',content:'after edit'}});await tick();release({ok:true,status:200,json:async()=>({translations:['stale translation']})});await tick(20);assert.equal(h.messages.get('c1:1').content,'after edit');}finally{h.close();}
});

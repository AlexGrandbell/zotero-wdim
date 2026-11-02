const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const C = require('../src/core.js');

function fixture() {
  const annotations = [], saved = [], errors = [];
  const view = {
    _iframeWindow: { PDFViewerApplication: { pdfViewer: { _pages: [0,1].map(() => ({ viewport: { viewBox: [0,0,612,792] } })) } } },
    getAnnotationMeta: p => ({ sortIndex: `0000${p.pageIndex}|000000|00100`, pageLabel: String(p.pageIndex+1) })
  };
  const manager = {
    _annotations: annotations,
    addAnnotation: a => { const result = {...a, id: String(annotations.length+1)}; annotations.push(result); return result; }
  };
  const reader = { itemID: 1, _type:'pdf', _internalReader: { _primaryView: view, _lastView: view, _state: {}, _annotationManager: manager } };
  const attachment = { isEditable: () => true, getAnnotations: () => saved };
  const z = { Items: {get: () => attachment}, Reader: {_readers: [reader]}, logError:e=>errors.push(e), isMac:true };
  const sandbox = {WDIMCore:C, setInterval, clearInterval, setTimeout, clearTimeout};
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(require.resolve('../src/plugin.js'),'utf8'),sandbox);
  const plugin = new sandbox.WDIMPlugin(z,'file:///test/');
  const messages = [];
  plugin.toast = (_,s) => messages.push(s);
  plugin.burst = () => {};
  return {plugin,reader,view,manager,annotations,saved,z,attachment,errors,messages,sandbox};
}

const anchor = {pageIndex:0, rects:[[100,500,180,516]]};
test('selected text produces only a question mark in a native text annotation', () => {
  const f=fixture();
  const result=f.plugin.mark(f.reader,anchor,true);
  assert.equal(result.duplicate,false);
  assert.equal(f.annotations[0].comment,'?');
  assert.equal(f.annotations[0].type,'text');
  assert.equal(f.annotations[0].text,undefined);
  assert.equal(f.annotations[0].position.rects[0][0],184);
});
test('100 rapid commands at one location leave one annotation', () => {
  const f=fixture();
  for(let i=0;i<100;i++) f.plugin.mark(f.reader,anchor,true);
  assert.equal(f.annotations.length,1);
});
test('nearby click jitter merges, distinct paragraphs and pages do not', () => {
  const f=fixture();
  f.plugin.mark(f.reader,anchor);
  assert.equal(f.plugin.mark(f.reader,{pageIndex:0,rects:[[104,504,104,504]]}).duplicate,true);
  f.plugin.mark(f.reader,{pageIndex:0,rects:[[100,420,100,420]]});
  f.plugin.mark(f.reader,{...anchor,pageIndex:1});
  assert.equal(f.annotations.length,3);
});
test('deduplicates persisted native questions after restarting', () => {
  const f=fixture();
  f.annotations.push({type:'text',comment:'?',position:C.makePosition(anchor,[0,0,612,792],true),id:'SAVED'});
  assert.equal(f.plugin.mark(f.reader,anchor,true).duplicate,true);
  assert.equal(f.annotations.length,1);
});
test('deduplicates unsaved additions in a different reader window', () => {
  const f=fixture();
  f.z.Reader._readers.push({itemID:1,_internalReader:{_annotationManager:{_annotations:[{type:'text',comment:'?',id:'OTHER',position:C.makePosition(anchor,[0,0,612,792],true)}]}}});
  assert.equal(f.plugin.mark(f.reader,anchor,true).duplicate,true);
});
test('other documents and non-question annotations are not merged', () => {
  const f=fixture();
  f.annotations.push({type:'text',comment:'Important',position:C.makePosition(anchor,[0,0,612,792],true)});
  f.z.Reader._readers.push({itemID:2,_internalReader:{_annotationManager:{_annotations:[{type:'text',comment:'?',position:C.makePosition(anchor,[0,0,612,792],true)}]}}});
  assert.equal(f.plugin.mark(f.reader,anchor,true).duplicate,false);
});
test('a deleted question can be placed again', () => {
  const f=fixture(); f.plugin.mark(f.reader,anchor,true);
  f.annotations.length=0;
  assert.equal(f.plugin.mark(f.reader,anchor,true).duplicate,false);
  assert.equal(f.annotations.length,1);
});
test('read-only attachment and reader both reject writes', () => {
  const f=fixture(); f.attachment.isEditable=()=>false;
  assert.equal(f.plugin.mark(f.reader,anchor),null);
  f.attachment.isEditable=()=>true; f.reader._internalReader._state.readOnly=true;
  assert.equal(f.plugin.mark(f.reader,anchor),null);
  assert.equal(f.annotations.length,0);
});
test('two-page selection places the question on the final page', () => {
  const f=fixture();
  f.plugin.mark(f.reader,{...anchor,nextPageRects:[[40,710,95,726]]},true);
  assert.equal(f.annotations[0].position.pageIndex,1);
  assert.equal(f.annotations[0].pageLabel,'2');
});
test('page edges, rotated-view PDF bounds and negative page origins are respected', () => {
  for(const box of [[0,0,612,792],[0,0,792,612],[-50,-20,550,780]]) {
    for(const r of [[-900,-900,9999,9999],[0,0,1,1],[600,780,612,792]]) {
      const p=C.makePosition({pageIndex:0,rects:[r]},box,true).rects[0];
      assert.ok(p[0]>=box[0] && p[1]>=box[1] && p[2]<=box[2] && p[3]<=box[3]);
    }
  }
});
test('invalid PDF geometry fails without saving', () => {
  const f=fixture();
  assert.equal(f.plugin.perform(f.reader,()=>f.plugin.mark(f.reader,{pageIndex:4,rects:[[1,1,1,1]]})),null);
  assert.equal(f.annotations.length,0);
  assert.equal(f.errors.length,1);
  assert.throws(()=>C.makePosition({pageIndex:0,rects:[[NaN,0,0,0]]},[0,0,612,792]));
});
test('shortcut accepts physical Slash on macOS, never plain typing or extra modifiers', () => {
  const e={code:'Slash',metaKey:true};
  assert.equal(C.isShortcut(e),true);
  assert.equal(C.isShortcut({...e,metaKey:false}),false);
  assert.equal(C.isShortcut({...e,altKey:true}),false);
  assert.equal(C.isShortcut({...e,ctrlKey:true}),false);
  assert.equal(C.isShortcut({...e,shiftKey:true}),false);
  assert.equal(C.isShortcut({code:'Slash',ctrlKey:true},false),true);
});
test('holding shortcut does not re-arm or create duplicates; editable targets are ignored', () => {
  const f=fixture(), handlers={};
  const win={addEventListener:(name,fn)=>handlers[name]=fn,removeEventListener:()=>{}};
  f.plugin.bind(f.reader,win,null);
  let actions=0,prevented=0;
  f.plugin.activate=()=>actions++;
  const e={code:'Slash',metaKey:true,preventDefault:()=>prevented++,stopImmediatePropagation:()=>{}};
  handlers.keydown({...e,repeat:true});
  assert.equal(actions,0); assert.equal(prevented,1);
  handlers.keydown({...e,target:{closest:()=>({})}});
  assert.equal(actions,0);
  handlers.keydown(e); assert.equal(actions,1);
  f.plugin.stop();
});
test('shortcut with no selection arms once, Escape cancels without writing', () => {
  const f=fixture(), handlers={};
  const win={addEventListener:(name,fn)=>handlers[name]=fn,removeEventListener:()=>{}};
  f.plugin.bind(f.reader,win,null);
  f.plugin.activate(f.reader,false); f.plugin.activate(f.reader,false);
  assert.equal(f.plugin.state(f.reader).armed,true);
  handlers.keydown({key:'Escape'});
  assert.equal(f.plugin.state(f.reader).armed,false);
  assert.equal(f.annotations.length,0);
  f.plugin.stop();
});
test('disable unregisters callbacks, cancels polling and drops all reader references', () => {
  const f=fixture(); let removed=0,unregistered=0;
  f.plugin.events.push(['renderToolbar',()=>{}]);
  f.z.Reader.unregisterEventListener=()=>unregistered++;
  f.plugin.state(f.reader).bindings.set({}, {remove:()=>removed++});
  f.plugin.stop();
  assert.equal(f.plugin.readers.size,0); assert.equal(removed,1); assert.equal(unregistered,1);
});
test('startup never blocks Zotero initialization on the later UI-ready promise', async () => {
  const f=fixture(); let resolveReady,registered=0;
  f.z.uiReadyPromise=new Promise(resolve=>resolveReady=resolve);
  f.z.Reader.registerEventListener=()=>registered++;
  f.z.Reader.unregisterEventListener=()=>{};
  const outcome=await Promise.race([f.plugin.start().then(()=>true),new Promise(resolve=>setTimeout(()=>resolve(false),50))]);
  assert.equal(outcome,true); assert.equal(registered,2); assert.equal(f.plugin.timer,null);
  resolveReady(); await Promise.resolve(); f.plugin.stop();
});
test('passes cloned objects across the privileged-to-reader boundary', () => {
  const f=fixture(); let cloned=0;
  f.reader._iframeWindow={};
  f.sandbox.Components={utils:{cloneInto:value=>{cloned++;return JSON.parse(JSON.stringify(value));}}};
  f.plugin.mark(f.reader,anchor,true);
  assert.equal(cloned,2); assert.equal(f.annotations.length,1);
});
test('manifest declares HTTPS updates without credentials and only tested compatibility', () => {
  const manifest=JSON.parse(fs.readFileSync(require.resolve('../manifest.json'),'utf8'));
  const app=manifest.applications.zotero;
  const url=new URL(app.update_url);
  assert.equal(url.protocol,'https:');
  assert.ok(url.hostname); assert.equal(url.username,''); assert.equal(url.password,'');
  assert.equal(app.strict_max_version,'10.0.*');
});
test('closing a PDF cannot break disable cleanup through dead Firefox wrappers', () => {
  const f=fixture(),state=f.plugin.state(f.reader);
  const dead=new Proxy({}, {get(){throw new TypeError("can't access dead object");}});
  state.buttons.add(dead); state.docs.add(dead);
  let removed=0;state.bindings.set({}, {remove:()=>removed++});
  const node={remove(){throw new TypeError("can't access dead object");}};
  f.plugin.temporary(state,node,10000);
  assert.doesNotThrow(()=>f.plugin.stop());
  assert.equal(state.removers.size,0); assert.equal(state.buttons.size,0); assert.equal(removed,1);
});

function cursorFixture() {
  const f=fixture();
  function element(tag) {
    return {tag,children:[],dataset:{},style:{setProperty(name,value){this[name]=value;}},events:{},
      setAttribute(name,value){this[name]=value;},
      addEventListener(name,fn){this.events[name]=fn;},
      append(node){this.children.push(node);node.parent=this;},
      remove(){if(this.parent)this.parent.children=this.parent.children.filter(n=>n!==this);},
      querySelectorAll(tag){return this.children.filter(n=>n.tag===tag);}
    };
  }
  const hostDoc={body:element('body'),createElementNS:(_,tag)=>element(tag)};
  hostDoc.querySelector=selector=>hostDoc.body.children.find(n=>'.'+n.className===selector);
  const host={mozInnerScreenX:100,mozInnerScreenY:200,innerWidth:1200,innerHeight:900,document:hostDoc,
    matchMedia:()=>({matches:false})};
  const readerWin={top:host,mozInnerScreenX:260,mozInnerScreenY:300};
  const readerDoc={defaultView:readerWin,createElement:element};
  readerWin.document=readerDoc;
  f.reader._iframeWindow=readerWin;
  f.sandbox.Components={utils:{cloneInto:value=>JSON.parse(JSON.stringify(value))}};
  f.plugin.burst=f.sandbox.WDIMPlugin.prototype.burst;
  f.plugin.rememberPointer(f.reader,readerWin,{screenX:700,screenY:650});
  return {...f,host,hostDoc,readerWin,readerDoc,element};
}

test('PDF frame pointer coordinates convert to reader and native window without Retina scaling', () => {
  const f=cursorFixture();
  assert.deepEqual({...f.plugin.mousePoint(f.reader)},{x:440,y:350});
  assert.deepEqual({...f.plugin.mousePoint(f.reader,f.host)},{x:600,y:450});
  f.readerWin.mozInnerScreenX=320;
  assert.equal(f.plugin.mousePoint(f.reader).x,380);
  f.plugin.stop();
});
test('keyboard can locate a stationary cursor before any pointer event was observed', () => {
  const f=cursorFixture(); f.plugin.state(f.reader).pointerScreen=null;
  f.host.windowUtils={getLastOverWindowPointerLocationInCSSPixels(x,y){x.value=400;y.value=350;}};
  assert.deepEqual({...f.plugin.mousePoint(f.reader,f.host)},{x:400,y:350});
  f.plugin.stop();
});
test('seven questions render beside the cursor in the native window, including throttled dedup feedback', () => {
  const f=cursorFixture();
  f.plugin.burst(f.reader,false);
  const node=f.hostDoc.querySelector('.wdim-burst');
  assert.ok(node); assert.equal(node.querySelectorAll('span').length,7);
  assert.equal(node.style.left,'532px'); assert.equal(node.style.top,'397px');
  f.plugin.rememberPointer(f.reader,f.readerWin,{screenX:800,screenY:700});
  f.plugin.burst(f.reader,true);
  assert.equal(f.hostDoc.body.children.length,1);
  assert.equal(node.style.left,'632px'); assert.equal(node.style.top,'447px');
  f.plugin.stop(); assert.equal(f.hostDoc.body.children.length,0);
});
test('toolbar, text popup, page placement and duplicate mark all use the same cursor surface', () => {
  for(const route of ['toolbar','selection','page','duplicate']) {
    const f=cursorFixture();
    if(route==='toolbar' || route==='selection') {
      const b=f.plugin.button(f.reader,f.readerDoc,route==='toolbar'?'toolbar':'selection',route==='selection'?{position:anchor}:undefined);
      b.events.click({detail:1,screenX:700,screenY:650});
    } else {
      f.plugin.mark(f.reader,anchor);
      if(route==='duplicate')f.plugin.mark(f.reader,anchor);
    }
    const node=f.hostDoc.querySelector('.wdim-burst');
    assert.ok(node,route); assert.equal(node.style.left,'532px',route);
    f.plugin.stop();
  }
});
test('cursor at viewport edges fans the effect inward and reduced motion remains respected', () => {
  const f=cursorFixture();
  f.plugin.rememberPointer(f.reader,f.readerWin,{screenX:1295,screenY:205});
  f.plugin.burst(f.reader,false);
  const node=f.hostDoc.querySelector('.wdim-burst');
  assert.match(node.children[0].textContent,/wdim-pop/);
  assert.match(node.querySelectorAll('span')[0].style.cssText,/--x:-64px;--y:27px/);
  f.plugin.stop();
  f.host.matchMedia=()=>({matches:true});
  f.plugin.burst(f.reader,false);
  assert.equal(f.hostDoc.body.children.length,0);
  f.plugin.stop();
});
test('pointer movement listeners are removed together with shortcuts on disable', () => {
  const f=fixture(),handlers={},removed=[];
  const win={addEventListener:(n,fn)=>handlers[n]=fn,removeEventListener:n=>removed.push(n)};
  f.plugin.bind(f.reader,win,null);
  handlers.pointermove({screenX:450,screenY:550});
  assert.deepEqual({...f.plugin.state(f.reader).pointerScreen},{x:450,y:550});
  f.plugin.stop();
  assert.deepEqual(removed.sort(),['keydown','mousedown','mousemove','pointerdown','pointermove']);
});

test('a chrome cursor helper returning (0,0) never overrides actual PDF mouse coordinates', () => {
  const f=cursorFixture();
  f.host.windowUtils={getLastOverWindowPointerLocationInCSSPixels(x,y){x.value=0;y.value=0;}};
  assert.deepEqual({...f.plugin.mousePoint(f.reader,f.host)},{x:600,y:450});
  f.plugin.burst(f.reader,false);
  assert.equal(f.hostDoc.querySelector('.wdim-burst').style.left,'532px');
  f.plugin.stop();
});
test('a stale nonzero chrome helper never overrides newer mouse events either', () => {
  const f=cursorFixture();
  f.host.windowUtils={getLastOverWindowPointerLocationInCSSPixels(x,y){x.value=10;y.value=20;}};
  assert.deepEqual({...f.plugin.mousePoint(f.reader,f.host)},{x:600,y:450});
  f.plugin.stop();
});
test('missing mouse data does not invent an upper-left burst', () => {
  const f=cursorFixture(); f.plugin.state(f.reader).pointerScreen=null;
  f.host.windowUtils={getLastOverWindowPointerLocationInCSSPixels(x,y){x.value=0;y.value=0;}};
  assert.equal(f.plugin.mousePoint(f.reader,f.host),null);
  f.plugin.burst(f.reader,false);
  assert.equal(f.hostDoc.body.children.length,0);
  f.plugin.stop();
});
test('ordinary mousemove events update location, including native sidebar tracking', () => {
  const f=fixture(),handlers={};
  const win={addEventListener:(n,fn)=>handlers[n]=fn,removeEventListener:()=>{}};
  f.plugin.bind(f.reader,win,null,true);
  handlers.mousemove({screenX:850,screenY:650});
  assert.deepEqual({...f.plugin.state(f.reader).pointerScreen},{x:850,y:650});
  handlers.mousedown({screenX:900,screenY:700});
  assert.deepEqual({...f.plugin.state(f.reader).pointerScreen},{x:900,y:700});
  let activated=false; f.plugin.activate=()=>activated=true;
  handlers.keydown({code:'Slash',metaKey:true});
  assert.equal(activated,false);
  f.plugin.stop();
});

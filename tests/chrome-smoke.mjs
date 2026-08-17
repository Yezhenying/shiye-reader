// Run after starting Chrome with --remote-debugging-port=9225 and a fresh user-data-dir.
const endpoint = process.env.CDP_ENDPOINT || 'http://127.0.0.1:9225';
const appPort = process.env.APP_PORT || '4199';
const pages = await (await fetch(`${endpoint}/json/list`)).json();
const page = pages.find(item => item.type === 'page' && item.url.includes(`:${appPort}`));
if (!page) throw new Error(`No app page found on port ${appPort}`);
const socket = new WebSocket(page.webSocketDebuggerUrl);
let sequence = 0; const pending = new Map();
await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
socket.onmessage = event => {
  const message = JSON.parse(event.data); const callbacks = pending.get(message.id);
  if (!callbacks) return; pending.delete(message.id);
  message.error ? callbacks.reject(new Error(message.error.message)) : callbacks.resolve(message.result);
};
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++sequence; pending.set(id, { resolve, reject }); socket.send(JSON.stringify({ id, method, params }));
});
const evaluate = async expression => {
  const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
  return result.result.value;
};
const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
const waitFor = async (expression, label, timeout = 12000) => {
  const started = Date.now();
  while (Date.now() - started < timeout) { if (await evaluate(expression)) return; await sleep(200); }
  throw new Error(`Timed out waiting for ${label}`);
};
const selectText = text => evaluate(`(()=>{const root=document.querySelector('.reader-text');const source=root.textContent;const start=source.indexOf(${JSON.stringify(text)});const end=start+${text.length};const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT);let node,seen=0,startNode,startOffset,endNode,endOffset;while(node=walker.nextNode()){if(startNode===undefined&&seen+node.data.length>=start){startNode=node;startOffset=start-seen}if(seen+node.data.length>=end){endNode=node;endOffset=end-seen;break}seen+=node.data.length}const range=document.createRange();range.setStart(startNode,startOffset);range.setEnd(endNode,endOffset);getSelection().removeAllRanges();getSelection().addRange(range);document.querySelector('.reader-main').dispatchEvent(new MouseEvent('mouseup',{bubbles:true}));return getSelection().toString()})()`);

await waitFor(`document.body.innerText.includes('今天，读点什么？')`, 'dashboard');
await evaluate(`[...document.querySelectorAll('button')].find(button=>button.innerText.includes('导入'))?.click()`);
await waitFor(`!!document.querySelector('.import-modal input[type=file]')`, 'import picker');
const documentNode = (await send('DOM.getDocument')).root.nodeId;
const inputNode = (await send('DOM.querySelector', { nodeId: documentNode, selector: '.import-modal input[type=file]' })).nodeId;
const fixture = `${process.cwd()}\\tests\\fixtures\\smoke.txt`.replaceAll('/', '\\');
await send('DOM.setFileInputFiles', { nodeId: inputNode, files: [fixture] });
await waitFor(`document.body.innerText.includes('立即阅读')`, 'TXT commit');
await evaluate(`[...document.querySelectorAll('button')].find(button=>button.innerText.includes('立即阅读'))?.click()`);
await waitFor(`!!document.querySelector('.reader-text')`, 'reader');
const selected = await selectText('本地优先');
if (selected !== '本地优先') throw new Error(`Selection mismatch: ${selected}`);
await waitFor(`!!document.querySelector('[aria-label="保存杏黄划线"]')`, 'selection toolbar');
await evaluate(`document.querySelector('[aria-label="保存杏黄划线"]').click()`);
await waitFor(`!!document.querySelector('.reader-text mark')`, 'highlight persistence');
await selectText('深度笔记');
await waitFor(`[...document.querySelectorAll('.selection-toolbar button')].some(button=>button.innerText.includes('写笔记'))`, 'note action');
await evaluate(`[...document.querySelectorAll('.selection-toolbar button')].find(button=>button.innerText.includes('写笔记')).click()`);
await waitFor(`!!document.querySelector('.note-modal textarea')`, 'note dialog');
await evaluate(`(()=>{const element=document.querySelector('.note-modal textarea');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(element,'深度笔记：烟测记录');element.dispatchEvent(new Event('input',{bubbles:true}))})()`);
await evaluate(`[...document.querySelectorAll('.note-modal button')].find(button=>button.innerText.includes('保存'))?.click()`);
await waitFor(`!document.querySelector('.note-modal')`, 'note save');
await evaluate(`scrollTo(0,document.documentElement.scrollHeight);dispatchEvent(new Event('scroll'))`); await sleep(1500);
const before = await evaluate(`new Promise(resolve=>{const request=indexedDB.open('shiyue-reader');request.onsuccess=async()=>{const transaction=request.result.transaction(['books','highlights','notes','progress'],'readonly');const count=store=>new Promise(done=>{const query=transaction.objectStore(store).count();query.onsuccess=()=>done(query.result)});resolve({books:await count('books'),highlights:await count('highlights'),notes:await count('notes'),progress:await count('progress'),hash:location.hash})}})`);
await send('Page.reload', { ignoreCache: true }); await sleep(2500);
await waitFor(`!!document.querySelector('.reader-text mark')`, 'highlight after reload');
const after = await evaluate(`({title:document.title,highlight:document.querySelector('.reader-text mark')?.textContent,reader:!!document.querySelector('.reader-workspace'),hash:location.hash})`);
console.log(JSON.stringify({ before, after, selected }, null, 2)); socket.close();

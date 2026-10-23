import assert from 'node:assert/strict';
import { readFile, writeFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { chromium } from 'playwright';
import { unzipSync } from 'fflate';

// Mount production FlowOverlay with an isolated project. Cloud saving is disabled;
// graph persistence and undo use the real project-content store and history service.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const name = `.video-frames-smoke-${process.pid}`;
const files = [path.join(root, `${name}.html`), path.join(root, `${name}.tsx`)];
let server, browser;
try {
  await writeFile(files[0], `<div id="root"></div><script type="module" src="/${name}.tsx"></script>`);
  await writeFile(files[1], `
import React from 'react';
import { createRoot } from 'react-dom/client';
import FlowOverlay from './src/components/flow/FlowOverlay';
import { CanvasCommentsProvider } from './src/contexts/CanvasCommentsContext';
import { useUIStore } from './src/stores/uiStore';
import { useProjectContentStore } from './src/stores/projectContentStore';
import { createEmptyProjectContent } from './src/types/project';
import { historyService } from './src/services/historyService';
import { paperSaveService } from './src/services/paperSaveService';
import paper from 'paper';
import './src/i18n';
useUIStore.setState({flowUIEnabled:true});
window.projectContent=useProjectContentStore; window.historyService=historyService;
window.historyCommits=[];const originalCommit=historyService.commit.bind(historyService);historyService.commit=async(label)=>{window.historyCommits.push(label);return originalCommit(label)};
paperSaveService.saveImmediately=async()=>{};
paperSaveService.triggerAutoSave=()=>{};
const canvas=document.createElement('canvas');canvas.width=1700;canvas.height=1000;document.body.append(canvas);paper.setup(canvas);
const frames=Array.from({length:6},(_,i)=>({index:i+1,timestamp:i*2.125,imageUrl:'https://frame-fixture.test/original-'+(i+1)+'.png',thumbnailDataUrl:'https://frame-fixture.test/thumbnail-'+(i+1)+'.png'}));
const saved=JSON.parse(localStorage.getItem('video-frames-reload')||'null');
useProjectContentStore.getState().setProject('video-frames-browser-fixture');
useProjectContentStore.getState().hydrate(saved||{...createEmptyProjectContent(),flow:{nodes:[
 {id:'frames',type:'videoFrameExtract',position:{x:20,y:20},data:{frames,totalFrames:6,intervalSeconds:3,outputMode:'all',rangeStart:1,rangeEnd:6,selectedFrameIndex:1}},
 {id:'occupied',type:'image',position:{x:500,y:20},width:320,height:320,data:{imageUrl:frames[0].imageUrl,boxW:320,boxH:320,label:'Existing image'}}
],edges:[]}},1);
createRoot(document.getElementById('root')).render(<div style={{width:1700,height:1000,position:'relative'}}><CanvasCommentsProvider><FlowOverlay/></CanvasCommentsProvider></div>);
`);
  server = await createServer({ root, server: { host: '127.0.0.1', port: 0 } });
  await server.listen();
  const address = server.httpServer.address();
  const origin = `http://127.0.0.1:${address.port}`;
  browser = await chromium.launch({ headless: true, channel: 'chrome' });
  const page = await browser.newPage({ viewport: { width: 1700, height: 1000 }, acceptDownloads: true });
  const errors = [], downloads = [], unexpectedRequests = [];
  let failedFrame = null;
  page.on('pageerror', error => { errors.push(error.message); console.error('Browser error:', error.message); });
  page.on('download', download => downloads.push(download));
  // Real decodable PNGs, each with distinct bytes; thumbnails intentionally differ.
  const fixtures = await page.evaluate(() => Array.from({length:7},(_,i)=>{
    const c=document.createElement('canvas');c.width=64;c.height=48;
    const ctx=c.getContext('2d');const data=ctx.createImageData(64,48);
    for(let p=0;p<data.data.length;p+=4){data.data[p]=(p*17+i*43)%256;data.data[p+1]=(p*31+i*67)%256;data.data[p+2]=(p*7+i*11)%256;data.data[p+3]=255}
    ctx.putImageData(data,0,0);return c.toDataURL('image/png').split(',')[1];
  }));
  const bytes = fixtures.map(value => Buffer.from(value, 'base64'));
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    const referenced = url.searchParams.get('url') || url.href;
    const frame = referenced.match(/(?:original|thumbnail)-(\d+)\.png/);
    if (frame) {
      const index = Number(frame[1]);
      if (failedFrame === index && referenced.includes('original-')) return route.fulfill({ status: 503, body: 'Fixture image unavailable' });
      return route.fulfill({contentType:'image/png',headers:{'access-control-allow-origin':'*'},body:bytes[referenced.includes('thumbnail-')?6:index-1]});
    }
    if (url.pathname.includes('/api/')) return route.fulfill({json:{}});
    if (url.origin === origin) return route.continue();
    unexpectedRequests.push(url.origin+url.pathname);
    return route.abort();
  });
  const goto = async () => {
    await page.goto(`${origin}/${name}.html`);
    await page.waitForFunction(() => !!window.tanvaFlow?.rf?.getNode('frames'), null, {timeout:60000});
  };
  await goto();
  const source = page.locator('.react-flow__node[data-id="frames"]');
  const expand = () => source.getByRole('button', {name:/展开为 Image 节点|Expand as Image nodes/});
  const download = () => source.getByRole('button', {name:/下载.*ZIP|Download.*ZIP/});
  const graph = () => page.evaluate(() => window.projectContent.getState().content.flow);
  const exported = () => page.evaluate(() => window.tanvaFlow.rf.getNodes().filter(n => n.data.sourceVideoFrameNodeId === 'frames'));
  await expand().waitFor();

  const zipCheck = async indices => {
    const wait = page.waitForEvent('download');
    await download().click();
    const result = await wait;
    assert.match(result.suggestedFilename(),/\.zip$/);
    const archive = unzipSync(new Uint8Array(await readFile(await result.path())));
    assert.equal(Object.keys(archive).length, indices.length, 'ZIP must contain the entire current selection');
    for (const index of indices) {
      const expectedName = `frame_${String(index).padStart(4,'0')}_${Math.round((index-1)*2.125*1000)}ms.png`;
      assert.deepEqual(Buffer.from(archive[expectedName]),bytes[index-1],`Frame ${index} must retain original bytes, not preview bytes`);
    }
  };
  await zipCheck([1,2,3,4,5,6]);

  const expansionCheck = async indices => {
    const before = await graph();
    await page.evaluate(() => window.historyService.resetToCurrent('browser-before-expand'));
    const historyBefore = await page.evaluate(() => window.historyService.getDebugInfo().pastCount);
    const sourceBefore = await page.evaluate(() => JSON.stringify(window.tanvaFlow.rf.getNode('frames').data));
    await expand().click();
    await page.waitForFunction(count => window.tanvaFlow.rf.getNodes().filter(n=>n.data.sourceVideoFrameNodeId==='frames').length===count,indices.length);
    await page.waitForFunction(count => window.projectContent.getState().content.flow.nodes.filter(n=>n.data.sourceVideoFrameNodeId==='frames').length===count,indices.length);
    // Observe the settled graph, including Image ResizeObserver notifications.
    await page.waitForTimeout(350);
    await page.waitForFunction(count => window.historyService.getDebugInfo().pastCount===count+1,historyBefore,{timeout:3000}).catch(async error=>{
      console.error('History diagnostic:',await page.evaluate(()=>({info:window.historyService.getDebugInfo(),commits:window.historyCommits})));
      await page.evaluate(()=>window.historyService.undo());
      console.error('Image count after one undo:',(await exported()).length);
      throw error;
    });
    const nodes = await exported();
    assert.deepEqual(nodes.map(n=>n.data.frameIndex),indices);
    assert.equal(await page.evaluate(() => JSON.stringify(window.tanvaFlow.rf.getNode('frames').data)),sourceBefore,'Expansion must leave source frames/selection unchanged');
    const saved = await graph();
    assert.equal(saved.nodes.length,before.nodes.length+indices.length,'Store must persist the complete batch');
    assert.deepEqual(saved.edges,before.edges,'Images are independent snapshots');
    assert.doesNotMatch(JSON.stringify(saved),/(?:data:image|blob:|flow-asset:)/,'Design JSON must keep remote references');
    for(const node of nodes){
      assert.equal(node.type,'image');
      assert.equal(node.data.imageUrl,`https://frame-fixture.test/original-${node.data.frameIndex}.png`);
      assert.equal(node.data.frameTimestamp,(node.data.frameIndex-1)*2.125);
      assert.ok(node.selected);
      assert.ok(saved.nodes.some(n=>n.id===node.id && n.data.imageUrl===node.data.imageUrl));
    }
    const rects = await page.evaluate(() => window.tanvaFlow.rf.getNodes().map(node=>({id:node.id,...window.tanvaFlow.rf.getNodesBounds([node])})));
    for(const node of nodes){
      const a=rects.find(rect=>rect.id===node.id);
      for(const b of rects.filter(rect=>rect.id!==a.id)) assert.ok(!(a.x<b.x+b.width&&a.x+a.width>b.x&&a.y<b.y+b.height&&a.y+a.height>b.y),`Image ${a.id} must not overlap ${b.id}`);
    }
    await page.evaluate(() => window.historyService.undo());
    await page.waitForFunction(() => !window.tanvaFlow.rf.getNodes().some(n=>n.data.sourceVideoFrameNodeId==='frames'));
    assert.equal((await graph()).nodes.length,before.nodes.length,'One undo must remove the entire batch');
    await page.evaluate(() => window.historyService.redo());
    await page.waitForFunction(count => window.tanvaFlow.rf.getNodes().filter(n=>n.data.sourceVideoFrameNodeId==='frames').length===count,indices.length);
    assert.deepEqual((await exported()).map(n=>n.id),nodes.map(n=>n.id),'Redo must restore the same snapshots');
    await page.evaluate(() => window.historyService.undo());
    await page.waitForFunction(() => !window.tanvaFlow.rf.getNodes().some(n=>n.data.sourceVideoFrameNodeId==='frames'));
  };
  await expansionCheck([1,2,3,4,5,6]);
  console.log('PASS: all six frames expand through production FlowOverlay, persist as independent remote Image snapshots, avoid occupied nodes and undo/redo as one batch.');

  await source.getByRole('radio',{name:/范围|Range/}).check();
  await source.locator('input[type="number"]').nth(1).fill('2');
  await source.locator('input[type="number"]').nth(2).fill('5');
  await page.waitForFunction(() => window.tanvaFlow.rf.getNode('frames').data.rangeStart===2 && window.tanvaFlow.rf.getNode('frames').data.rangeEnd===5);
  await zipCheck([2,3,4,5]);
  await page.waitForTimeout(180);
  await expansionCheck([2,3,4,5]);
  await source.getByRole('radio',{name:/指定帧|Selected frame/}).check();
  await source.locator('input[type="number"]').nth(1).fill('6');
  await page.waitForFunction(() => window.tanvaFlow.rf.getNode('frames').data.selectedFrameIndex===6);
  await zipCheck([6]);
  await page.waitForTimeout(180);
  await expansionCheck([6]);
  console.log('PASS: UI range 2–5 and single frame 6 control both ZIP entries and expanded snapshots. ZIP entries match original image bytes exactly.');

  const countBeforeFailure=downloads.length;
  failedFrame=6;
  await download().click();
  await source.getByRole('alert').waitFor();
  await download().waitFor({state:'visible'});
  assert.equal(downloads.length,countBeforeFailure,'Failed fetch must not emit a partial or fake successful download');
  assert.match(await source.getByRole('alert').innerText(),/6/);
  failedFrame=null;
  await zipCheck([6]);
  assert.equal(await source.getByRole('alert').count(),0,'Retry must clear the previous error');
  await expand().click();
  await page.waitForFunction(() => window.projectContent.getState().content.flow.nodes.some(n=>n.data.sourceVideoFrameNodeId==='frames'));
  const beforeReload = await graph();
  await page.evaluate(() => localStorage.setItem('video-frames-reload',JSON.stringify(window.projectContent.getState().content)));
  await goto();
  const afterReload=await graph();
  assert.deepEqual(afterReload.nodes.map(n=>({id:n.id,type:n.type,position:n.position,imageUrl:n.data.imageUrl,frameIndex:n.data.frameIndex})),beforeReload.nodes.map(n=>({id:n.id,type:n.type,position:n.position,imageUrl:n.data.imageUrl,frameIndex:n.data.frameIndex})));
  assert.deepEqual(errors,[]);
  assert.deepEqual(unexpectedRequests,[],'Regression must not call external services');
  console.log('PASS: failed image fetch shows an error without a ZIP; retry works. Persisted project content rehydrates the same Image nodes after reload. No external services or real projects used.');
} finally {
  await browser?.close();
  await server?.close();
  await Promise.all(files.map(file => unlink(file).catch(()=>{})));
}

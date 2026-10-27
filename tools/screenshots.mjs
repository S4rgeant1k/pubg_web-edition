import puppeteer from 'puppeteer-core';
import chromiumPkg from '@sparticuz/chromium';
const chromium = chromiumPkg.default ?? chromiumPkg;
const browser = await puppeteer.launch({ executablePath: await chromium.executablePath(),
  args: [...chromium.args,'--no-sandbox','--enable-unsafe-swiftshader','--use-gl=angle','--use-angle=swiftshader'],
  defaultViewport:{width:1280,height:720,deviceScaleFactor:1} });
const page = await browser.newPage();
page.on('pageerror', e=>console.log('PAGEERR', e.message));
await page.goto('http://127.0.0.1:8000/', {waitUntil:'networkidle0'});
await new Promise(r=>setTimeout(r,1500));
await page.screenshot({path:'/home/user/pubg_web-edition/docs/menu.jpg', type:'jpeg', quality:82});
await page.click('#startBtn');
await new Promise(r=>setTimeout(r,2500));
await page.screenshot({path:'/home/user/pubg_web-edition/docs/plane.jpg', type:'jpeg', quality:82});
await page.evaluate(()=>{
  const g=window.__pubg,p=g.player,w=g.world;
  g.state='playing'; g.chuteMesh.visible=false; g.hud.el.bigText.classList.remove('show');
  const b=w.buildings[2];
  p.pos.set(b.x+30,0,b.z+34); p.pos.y=w.surfaceY(p.pos.x,p.pos.z);
  p.slots[0]={id:'m416',ammo:30}; p.slots[1]={id:'kar98',ammo:5};
  p.ammo['556']=120; p.ammo['762']=40; p.slotIndex=0; p._syncViewModel();
  p.armorLevel=2; p.armorHp=75; p.helmetLevel=1; p.helmetHp=40; p.heals.bandage=3; p.heals.firstaid=1;
  g.input.yaw=Math.atan2(-(b.x-p.pos.x),-(b.z-p.pos.z)); g.input.pitch=-0.02; g.input.locked=true;
  const bots=g.bots.bots.filter(z=>z.alive).slice(0,2);
  bots.forEach((bt,i)=>{ bt.pos.set(b.x+6+i*5,0,b.z+6); bt.pos.y=w.surfaceY(bt.pos.x,bt.pos.z); bt.state='roam'; bt.land(); });
  g.player.hp=86;
});
await new Promise(r=>setTimeout(r,1600));
await page.screenshot({path:'/home/user/pubg_web-edition/docs/game.jpg', type:'jpeg', quality:82});
await page.evaluate(()=>{ window.__pubg.input.aimDown=true; });
await new Promise(r=>setTimeout(r,1200));
await page.evaluate(()=>{ window.__pubg.input.aimDown=false; window.__pubg.hud.toggleFullmap(true); });
await new Promise(r=>setTimeout(r,900));
await page.screenshot({path:'/home/user/pubg_web-edition/docs/map.jpg', type:'jpeg', quality:82});
await browser.close();

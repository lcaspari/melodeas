const fs=require('fs');
const dsp=fs.readFileSync(__dirname+'/dsp.js','utf8').replace(/\nif\(typeof module[^\n]*\n?$/,'\n');
const lvl=fs.existsSync(__dirname+'/lvl.json')?fs.readFileSync(__dirname+'/lvl.json','utf8').trim().replace(/^\{|\}$/g,''):'';
const app=fs.readFileSync(__dirname+'/app.js','utf8').replace('/*__LVL__*/',()=>lvl);
const out=fs.readFileSync(__dirname+'/index.src.html','utf8').replace('/*__DSP__*/',()=>dsp).replace('/*__APP__*/',()=>app);
fs.writeFileSync(require('path').join(__dirname,'..','index.html'),out);
// syntax check of both script blocks
const scripts=[...out.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m=>m[1]);
scripts.forEach((s,i)=>{new Function(s);console.log('script',i,'parses,',s.length,'chars');});
console.log('index.html',out.length,'bytes');

// Structural alignment worker: runs TM-align (Zhang & Skolnick) compiled to WASM.
import createTmalign from './tmalign-wasm.js';

let inst = null, buf = "";

async function instance(){
  if(!inst){
    inst = await createTmalign({
      locateFile: () => new URL('./tmalign-wasm.wasm', import.meta.url).href,
      print: m => { buf += m + "\n"; },
      printErr: () => {},
      noExitRuntime: true
    });
  }
  return inst;
}

function parseOut(out){
  const m = out.match(/Aligned length=\s*(\d+),\s*RMSD=\s*([\d.]+)/);
  if(!m) return null;
  const tms = [...out.matchAll(/TM-score=\s*([\d.]+)/g)].map(x => parseFloat(x[1]));
  // chain 1 = mobile (the entry), chain 2 = reference (the anchor) -> use anchor-normalised score
  return { len: +m[1], rmsd: parseFloat(m[2]), tm: tms.length > 1 ? tms[1] : (tms[0] ?? 0) };
}

function parseMatrix(txt){
  const rows = txt.split('\n').slice(2,5).map(l => l.trim().split(/\s+/).slice(1).map(Number));
  if(rows.length < 3 || rows.some(r => r.length < 4 || r.some(isNaN))) return null;
  return { t: [rows[0][0], rows[1][0], rows[2][0]],
           u: [rows[0].slice(1), rows[1].slice(1), rows[2].slice(1)] };
}

self.onmessage = async ev => {
  const { key, mobile, ref } = ev.data;
  try {
    const I = await instance();
    buf = "";
    I.FS.writeFile('/mobile.pdb', mobile);
    I.FS.writeFile('/ref.pdb', ref);
    const code = I.callMain(['/mobile.pdb', '/ref.pdb', '-m', '/matrix.txt']);
    if(code !== 0) throw new Error('tmalign exit ' + code);
    const res = parseOut(buf);
    if(!res) throw new Error('could not parse output');
    const mx = parseMatrix(I.FS.readFile('/matrix.txt', { encoding: 'utf8' }));
    self.postMessage({ key, res: Object.assign(res, mx || {}) });
  } catch(err){
    self.postMessage({ key, err: String(err && err.message || err) });
  }
};

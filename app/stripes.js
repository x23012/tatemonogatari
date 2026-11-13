/* カードの帯の下にある線の本数を読む（ver17 のカードから）。
 * 左の帯に1〜3本、右の帯に1〜4本。帯の色（＝点数）と左右の本数の組み合わせで、カードが1枚に決まる。
 * 線は「濃い帯の中の明るい線」なので、照明の色かぶりがあっても本数は数えられる。
 * 位置は cards/<id>.jpg（印刷データの切り出し）の中の割合（0〜1）。 */
'use strict';

const Stripes = (() => {
  const SLOTS = [0.9636, 0.9248, 0.8860, 0.8470];   // 線の中心（下から）
  const BAND = { L: [0.035, 0.11, 3], R: [0.885, 0.955, 4] };
  const STRIPE_H = 0.023;                            // 線の高さ（カードに対して）
  const MIN_PX = 3;                                  // 線がこれより細く写っていたら読まない

  let codes = new Map([['warp', [1, 1]]]);
  /** list: [{id, stripes:[左,右]}] */
  function setCodes(list) {
    codes = new Map([['warp', [1, 1]]]);
    for (const c of list) if (Array.isArray(c.stripes)) codes.set(c.id, c.stripes);
  }
  const codeOf = id => codes.get(id);

  const lum = (r, g, b) => 0.299 * r + 0.587 * g + 0.114 * b;
  const t = [0, 0, 0];

  /* 帯の上で、v=0.72〜1.06 の明るさの並び（プロフィール）をとり、明るい山（線）を下から数える。
   * 見本との位置合わせが数%ずれていても数えられるように、決まった位置ではなく「山の並び」を見る */
  const V0 = 0.72, V1 = 1.06, DV = 0.002, PITCH = 0.0388;
  function profile(get, u0, u1) {
    const P = [];
    for (let v = V0; v <= V1 + 1e-9; v += DV) {
      let s = 0;
      for (let i = 0; i < 6; i++) { get(u0 + (i + 0.5) / 6 * (u1 - u0), v, t); s += lum(t[0], t[1], t[2]); }
      P.push(s / 6);
    }
    return P;
  }
  const q = (a, p) => { const b = a.slice().sort((x, y) => x - y); return b[Math.min(b.length - 1, Math.floor(p * b.length))]; };
  function readBand(get, [u0, u1, max]) {
    const P = profile(get, u0, u1), iv = v => Math.round((v - V0) / DV);
    const inner = P.slice(iv(0.74), iv(1.0));
    const base = q(inner, 0.3), high = q(inner, 0.93), contrast = high - base;
    if (contrast < 14) return { count: 0, conf: 0, contrast };
    const thr = base + contrast * 0.5;
    // 明るい山を切り出す
    const runs = [];
    let st = -1;
    for (let i = 0; i <= P.length; i++) {
      const on = i < P.length && P[i] > thr;
      if (on && st < 0) st = i;
      if (!on && st >= 0) {
        let peak = 0; for (let j = st; j < i; j++) peak = Math.max(peak, P[j]);
        runs.push({ c: V0 + ((st + i - 1) / 2) * DV, w: (i - st) * DV, peak, edge: st === 0 || i === P.length });
        st = -1;
      }
    }
    // 線らしい太さの山（カードの外＝机や白いふちの広い山はのぞく）
    const ok = runs.filter(r => !r.edge && r.w >= 0.008 && r.w <= 0.040);
    if (!ok.length) return { count: 0, conf: 0, contrast };
    // いちばん下の線（見本では 0.964）から、ほぼ同じ間かくで上へつながる山を数える
    ok.sort((a, b) => b.c - a.c);
    let bottom = ok.findIndex(r => r.c > 0.90 && r.c < 1.03);
    if (bottom < 0) return { count: 0, conf: 0, contrast };
    const chain = [ok[bottom]];
    for (let i = bottom + 1; i < ok.length && chain.length < 5; i++) {
      const gap = chain[chain.length - 1].c - ok[i].c;
      if (gap < PITCH * 0.65) continue;            // 近すぎる（ノイズ）
      if (gap > PITCH * 1.35) break;               // 離れている（文字など）
      chain.push(ok[i]);
    }
    const count = Math.min(chain.length, max);
    // 自信：はっきりした明暗、山の太さがそろっている、いちばん下の線が見本の位置に近い
    const widths = chain.slice(0, count).map(r => r.w), wm = widths.reduce((a, b) => a + b, 0) / widths.length;
    let conf = Math.min(1, (contrast - 14) / 30 + 0.4);
    if (widths.some(w => Math.abs(w - wm) > wm * 0.6)) conf *= 0.5;
    conf *= Math.max(0, 1 - Math.abs(chain[0].c - SLOTS[0]) / 0.06);
    if (chain.length > max) conf *= 0.4;
    return { count, conf: Math.max(0, Math.min(1, conf)), contrast };
  }

  /** get(u,v,out): カード座標の色。cardPx: カード1枚が写っている大きさ（px） */
  function read(get, cardPx) {
    if (cardPx * STRIPE_H < MIN_PX) return { L: 0, R: 0, conf: 0, quality: 0, small: true };
    const L = readBand(get, BAND.L), R = readBand(get, BAND.R);
    return { L: L.count, R: R.count, conf: Math.min(L.conf, R.conf), quality: Math.min(L.contrast, R.contrast) };
  }

  /** RGBA配列 px（N×N）をカード座標で読む関数にする */
  function getter(px, N) {
    return (u, v, out) => {
      let x = u * N - 0.5, y = v * N - 0.5;
      x = Math.max(0, Math.min(N - 1.001, x)); y = Math.max(0, Math.min(N - 1.001, y));
      const xi = x | 0, yi = y | 0, fx = x - xi, fy = y - yi;
      const i00 = (yi * N + xi) * 4, i10 = i00 + 4, i01 = i00 + N * 4, i11 = i01 + 4;
      for (let c = 0; c < 3; c++) out[c] = (px[i00 + c] * (1 - fx) + px[i10 + c] * fx) * (1 - fy) + (px[i01 + c] * (1 - fx) + px[i11 + c] * fx) * fy;
    };
  }

  /** 候補の並びを、線の本数で並べかえる。本数が合わない候補を後ろへ */
  function rerank(cands, st, weight = 1.5) {
    if (!st || !(st.conf > 0.25)) return cands;
    const out = cands.map(c => {
      const code = codeOf(c.id);
      if (!code) return c;
      const miss = (code[0] !== st.L) + (code[1] !== st.R);
      return { ...c, d: c.d + miss * weight * st.conf, stripeMiss: miss };
    });
    return out.sort((a, b) => a.d - b.d);
  }

  return { read, readBand, profile, getter, rerank, setCodes, codeOf, SLOTS, STRIPE_H, MIN_PX };
})();

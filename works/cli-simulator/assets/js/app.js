/* CLIシミュレーター（公開用デモ）— 画面。実運用版の画面構成・操作に合わせた軽量版 */
'use strict';
(function () {
  const SIM = window.SIM, LABS = window.LABS;
  const $ = (q, r = document) => r.querySelector(q);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const app = $('#app');
  const KIND_JA = { router: 'ルーター', switch: 'スイッチ', pc: '端末' };
  const TAG_FILTERS = ['ルーティング', 'スイッチング', 'セキュリティ', '管理・運用', 'OSPF'];

  /* ---- 成績（このブラウザだけに保存） ---- */
  const KEY = 'cli-sim-demo2-stats';
  let stats = {};
  try { stats = JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch (e) { stats = {}; }
  const record = (id, score) => {
    const x = stats[id] || { last: 0, best: 0, n: 0 };
    stats[id] = { last: score, best: Math.max(x.best, score), n: x.n + 1 };
    try { localStorage.setItem(KEY, JSON.stringify(stats)); } catch (e) { }
    return stats[id];
  };

  const st = { labId: LABS[0].id, answer: 'practice', minutes: 10, filter: '', q: '' };
  let view = null; // 現在の画面の後始末用
  const leave = () => { if (view && view.dispose) view.dispose(); view = null; };
  let toastT;
  const toast = msg => { let t = $('.toast'); if (!t) { t = document.createElement('div'); t.className = 'toast'; t.setAttribute('role', 'status'); document.body.appendChild(t); } t.textContent = msg; clearTimeout(toastT); toastT = setTimeout(() => t.remove(), 1800); };

  /* ================= 起動画面 ================= */
  function renderLaunch() {
    leave();
    const lab = LABS.find(l => l.id === st.labId);
    const q = st.q.trim().toLowerCase();
    const shown = LABS.filter(l => (!st.filter || l.tags.includes(st.filter)) && (!q || (l.title + l.tags.join(' ') + l.summary).toLowerCase().includes(q)));
    app.innerHTML = `
    <section class="launch">
      <div class="launch-card">
        <div class="col">
          <div class="eyebrow">CCNA CLI Simulator</div>
          <div class="lab-category">${esc(lab.section)} ${lab.no}</div>
          <h1>${esc(lab.title)}</h1>
          <p class="muted">TaskとConfigurationを切り替えながら、Cisco IOS風CLIで設定します。</p>
          <div class="demo-note"><span><b>公開用デモ</b>　実運用版の画面と操作を軽量に再現したものです。問題は練習問題3問を収録。<b>自由演習</b>では機器の配置・配線・CLI設定・通信確認ができます。</span></div>
          <section class="mode-picker" aria-labelledby="mt">
            <h2 id="mt">モードを選択</h2>
            <button type="button" class="mode-card" aria-pressed="true"><b>問題演習</b><span>練習問題から選んで解く（デモは3問）</span></button>
            <button type="button" class="mode-card free" id="freeBtn"><b>自由演習</b><span>機器を置く・配線する・CLIで設定する</span></button>
            <button type="button" class="mode-card" disabled><b>模試モード</b><span>本番想定問題からランダム出題・合計点で採点</span><span class="soon">実運用版のみ</span></button>
          </section>
        </div>
        <div class="col">
          <div><label class="label" for="q">問題を選択</label><input id="q" class="search" type="search" placeholder="テーマ・技術タグで検索" value="${esc(st.q)}"></div>
          <div class="filters">${TAG_FILTERS.map(t => `<button type="button" class="filter" data-tag="${esc(t)}" aria-pressed="${st.filter === t}">${esc(t)}</button>`).join('')}</div>
          <div class="lab-section-title">練習問題</div>
          <div class="lab-cards">${shown.map(l => {
            const x = stats[l.id];
            return `<button type="button" class="lab-card" data-lab="${l.id}" aria-pressed="${l.id === st.labId}">
              <span class="lab-card-head"><span>${esc(l.section)} ${l.no}</span><span>${esc(l.level)}</span></span>
              <span class="lab-card-title">${esc(l.title)}</span>
              <span class="tags">${l.tags.map(t => `<span class="tag">${esc(t)}</span>`).join('')}</span>
              <span class="lab-card-meta">${x ? `前回 ${x.last}% / Best ${x.best}% / ${x.n}回` : '未実施'}</span></button>`;
          }).join('') || '<p class="muted">該当する問題がありません。</p>'}</div>
          <div class="launch-grid">
            <div><span class="label">解答形式</span><div class="segmented" data-seg="answer"><button type="button" data-v="practice" aria-pressed="${st.answer === 'practice'}">練習モード</button><button type="button" data-v="exam" aria-pressed="${st.answer === 'exam'}">試験モード</button></div>
              <p class="choice-help">練習：進捗を確認可能 ／ 試験：解答中は進捗を非表示</p></div>
            <div><span class="label">制限時間</span><div class="segmented" data-seg="minutes"><button type="button" data-v="10" aria-pressed="${st.minutes === 10}">10分</button><button type="button" data-v="30" aria-pressed="${st.minutes === 30}">30分</button></div></div>
          </div>
          <button type="button" class="primary-btn start-btn" id="start">開始</button>
        </div>
      </div>
    </section>`;
    app.querySelectorAll('[data-lab]').forEach(b => b.onclick = () => { st.labId = b.dataset.lab; renderLaunch(); });
    app.querySelectorAll('[data-tag]').forEach(b => b.onclick = () => { st.filter = st.filter === b.dataset.tag ? '' : b.dataset.tag; renderLaunch(); });
    app.querySelectorAll('[data-seg]').forEach(g => g.querySelectorAll('button').forEach(b => b.onclick = () => { st[g.dataset.seg] = g.dataset.seg === 'minutes' ? +b.dataset.v : b.dataset.v; renderLaunch(); }));
    const qi = $('#q'); qi.oninput = () => { st.q = qi.value; const p = qi.selectionStart; renderLaunch(); const n = $('#q'); n.focus(); n.setSelectionRange(p, p); };
    $('#start').onclick = () => { location.hash = 'lab-' + st.labId.toLowerCase(); };
    $('#freeBtn').onclick = () => { location.hash = 'free'; };
    window.scrollTo(0, 0);
  }

  /* ================= 構成図（演習・自由演習で共用） ================= */
  const BOX = { router: [120, 52], switch: [128, 52], pc: [112, 52] };
  const COLOR = { router: ['#eaf2fd', '#3d6fa3'], switch: ['#eefaf3', '#2f8a5f'], pc: ['#fff6e5', '#c98a1c'] };
  function edgePoint(c, o, kind) { // ノード中心 c から o 方向へ、箱の縁の点
    const [w, h] = BOX[kind], dx = o[0] - c[0], dy = o[1] - c[1];
    const k = Math.min(Math.abs((w / 2 + 4) / (dx || 1e-6)), Math.abs((h / 2 + 4) / (dy || 1e-6)));
    return [c[0] + dx * k, c[1] + dy * k];
  }
  function drawTopo(host, s, pos, o) {
    const devs = Object.values(s.devices);
    const xs = devs.map(d => pos[d.name][0]), ys = devs.map(d => pos[d.name][1]);
    const vb = o.viewBox || [Math.min(...xs, 0) - 20, Math.min(...ys, 0) - 20, Math.max(...xs, 560) + 100, Math.max(...ys, 240) + 60];
    let L = '', N = '';
    s.links.forEach((l, i) => {
      const a = s.devices[l.a], b = s.devices[l.b];
      const pa = pos[l.a], pb = pos[l.b];
      const ea = edgePoint(pa, pb, a.kind), eb = edgePoint(pb, pa, b.kind);
      const ua = SIM.ifUp(s, a, l.ai), ub = SIM.ifUp(s, b, l.bi), up = ua && ub;
      const fl = o.flash && o.flash.links.has(i);
      const col = fl ? (o.flash.ok ? '#1f8a4c' : '#c0392b') : up ? '#2f8a5f' : '#9aa8b6';
      const mx = (ea[0] + eb[0]) / 2, my = (ea[1] + eb[1]) / 2;
      const lbl = (dev, n) => dev.kind === 'pc' ? 'Eth0' : SIM.shortIf(n);
      const at = (p, q, t) => [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t];
      const la = at(ea, eb, .2), lb = at(eb, ea, .2);
      L += `<g><line x1="${ea[0]}" y1="${ea[1]}" x2="${eb[0]}" y2="${eb[1]}" stroke="${col}" stroke-width="${fl ? 4.5 : 2.4}" ${up || fl ? '' : 'stroke-dasharray="6 5"'}/>
        <circle cx="${ea[0]}" cy="${ea[1]}" r="4" fill="${ua ? '#1f8a4c' : '#c0392b'}"/><circle cx="${eb[0]}" cy="${eb[1]}" r="4" fill="${ub ? '#1f8a4c' : '#c0392b'}"/>
        <text x="${la[0]}" y="${la[1] - 7}" class="port" text-anchor="middle">${lbl(a, l.ai)}</text><text x="${lb[0]}" y="${lb[1] - 7}" class="port" text-anchor="middle">${lbl(b, l.bi)}</text>
        <circle cx="${mx}" cy="${my}" r="11" fill="#fff" stroke="#9aa8b6"/><text x="${mx}" y="${my + 4}" text-anchor="middle" class="num">${i + 1}</text>
        ${l.label ? `<text x="${mx}" y="${my + 26}" text-anchor="middle" class="net">${esc(l.label)}</text>` : ''}</g>`;
    });
    for (const d of devs) {
      const [x, y] = pos[d.name], [w, h] = BOX[d.kind], [bg, bd] = COLOR[d.kind], sel = o.selected === d.name;
      const sub = d.kind === 'pc' ? (d.ifaces.eth0.ip || 'IP未設定') : d.hostname !== d.name ? d.hostname : '';
      N += `<g class="node" data-dev="${esc(d.name)}" transform="translate(${x - w / 2},${y - h / 2})" tabindex="0" role="button" aria-label="${esc(d.name)} を選択">
        ${sel ? `<rect x="-5" y="-5" width="${w + 10}" height="${h + 10}" rx="16" fill="none" stroke="#0c2f57" stroke-width="2" stroke-dasharray="4 3"/>` : ''}
        <rect class="box" width="${w}" height="${h}" rx="12" fill="${bg}" stroke="${bd}" stroke-width="1.6"/>
        <text x="12" y="17" class="kind">${KIND_JA[d.kind]}${d.label ? '・' + esc(d.label) : ''}</text>
        <text x="${w / 2}" y="38" text-anchor="middle" class="name">${esc(d.name)}</text>
        ${sub ? `<text x="${w / 2}" y="${h + 15}" text-anchor="middle" class="sub">${esc(sub)}</text>` : ''}</g>`;
    }
    host.innerHTML = `<svg viewBox="${vb.join(' ')}" role="img" aria-label="ネットワーク構成図"><style>
      .port{font:700 11px var(--mono);fill:#1f4058;paint-order:stroke;stroke:#fbfdff;stroke-width:4px}.num{font:700 11px var(--sans);fill:#334}
      .net{font:600 11px var(--mono);fill:#174b80;paint-order:stroke;stroke:#fbfdff;stroke-width:4px}.kind{font:600 10px var(--sans);fill:#667085}
      .name{font:800 16px var(--sans);fill:#162033}.sub{font:500 11px var(--mono);fill:#667085}</style>${L}${N}</svg>`;
    const svg = host.firstChild;
    host.querySelectorAll('.node').forEach(g => {
      const name = g.dataset.dev;
      g.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); o.onSelect && o.onSelect(name); } });
      g.addEventListener('pointerdown', e => {
        const start = { x: e.clientX, y: e.clientY }, p0 = [...pos[name]]; let moved = false;
        const m = svg.getScreenCTM(); const k = m ? 1 / m.a : 1;
        const mv = ev => {
          const dx = (ev.clientX - start.x) * k, dy = (ev.clientY - start.y) * k;
          if (!o.draggable || (!moved && Math.hypot(dx, dy) < 4)) return;
          moved = true; pos[name] = [Math.round(p0[0] + dx), Math.round(p0[1] + dy)];
          o.redraw && o.redraw();
        };
        const upF = () => { removeEventListener('pointermove', mv); removeEventListener('pointerup', upF); if (!moved) o.onSelect && o.onSelect(name); };
        addEventListener('pointermove', mv); addEventListener('pointerup', upF);
      });
    });
  }

  /* ================= CLI 端末（演習・自由演習で共用） ================= */
  function makeTerminal(root, s, opts) {
    const buf = {}, hidx = {};
    let cur = opts.device, size = 'm';
    root.innerHTML = `
      <div class="cli-tools"><span class="t">CLI</span><div class="segmented" role="group" aria-label="文字の大きさ"><button type="button" data-sz="s">小</button><button type="button" data-sz="m" aria-pressed="true">標準</button><button type="button" data-sz="l">大</button></div><button type="button" class="secondary-btn" data-k="cls">画面クリア</button></div>
      <div class="terminal" data-size="m">
        <div class="term-mode"><span class="dot"></span><span class="txt"><small>現在のモード</small><b class="mj"></b><span class="h"></span></span><span class="pr"></span></div>
        <div class="term-out" aria-live="polite"></div>
        <form class="term-in" autocomplete="off"><label class="pl"></label><input spellcheck="false" autocapitalize="off" autocomplete="off" aria-label="コマンド入力" placeholder="ここに直接入力"><button type="submit">Enter</button><button type="button" data-k="C">Ctrl+C</button></form>
      </div>
      <div class="keys"><button type="button" data-k="?">?</button><button type="button" data-k="Tab">Tab</button><button type="button" data-k="Up">↑</button><button type="button" data-k="Down">↓</button><button type="button" data-k="clr">Clear</button><button type="button" data-k="end">End</button><button type="button" data-k="exit">Exit</button></div>`;
    const out = $('.term-out', root), input = $('input', root), form = $('form', root);
    const push = (dev, text, cls) => {
      const b = buf[dev] || (buf[dev] = []);
      if (cls) b.push({ c: cls, t: text });
      else for (const line of String(text).split('\n')) b.push({ c: /^% |^\s*\^$|^Translating/.test(line) ? 'err' : /^%[A-Z]+-\d-/.test(line) ? 'log' : '', t: line });
      if (b.length > 1500) b.splice(0, b.length - 1500);
    };
    const greet = d => d.kind === 'pc'
      ? `${d.name} - コマンドプロンプト（簡易）\nipconfig / ping <IPアドレス> / cls が使えます\n`
      : `${opts.banner ? opts.banner + ' - ' : ''}Cisco IOS CLI\n`;
    const paint = () => {
      const d = s.devices[cur];
      if (!d) { out.innerHTML = '<span class="err">機器を選択してください</span>'; $('.mj', root).textContent = '機器を選択してください'; $('.h', root).textContent = ''; $('.pr', root).textContent = '—'; $('.pl', root).textContent = ''; return; }
      if (!buf[cur]) push(cur, greet(d));
      out.innerHTML = buf[cur].map(x => x.c ? `<span class="${x.c}">${esc(x.t)}</span>` : esc(x.t)).join('\n') + '\n<span class="echo">' + esc(SIM.prompt(d)) + '</span>';
      out.scrollTop = out.scrollHeight;
      const p = SIM.prompt(d);
      $('.mj', root).textContent = d.kind === 'pc' ? 'コマンドプロンプト' : d.pending ? '入力待ち' : SIM.MODE_JA[d.mode];
      $('.h', root).textContent = d.kind === 'pc' ? 'IP設定の確認と疎通確認ができます' : d.pending ? 'Enterで既定値を使います' : SIM.MODE_HINT[d.mode];
      $('.pr', root).textContent = p || '…'; $('.pl', root).textContent = p;
    };
    const run = raw => {
      const d = s.devices[cur]; if (!d) return;
      const b = buf[cur] || (buf[cur] = []);
      if (d.pending && b.length) b[b.length - 1].t += raw; else push(cur, SIM.prompt(d) + raw, 'echo');
      if (raw.trim()) d.hist.push(raw.trim());
      hidx[cur] = d.hist.length;
      if (d.kind === 'pc' && /^\s*cls\s*$/i.test(raw)) { buf[cur] = []; paint(); return; }
      const before = SIM.statusSnap(s); s.lastPing = null;
      const res = SIM.execLine(s, d, raw);
      if (res) {
        if (d.pending) { const ls = res.split('\n'); const last = ls.pop(); if (ls.length) push(cur, ls.join('\n')); push(cur, last, 'echo'); }
        else push(cur, res);
      }
      const ev = SIM.statusEvents(before, SIM.statusSnap(s));
      for (const [dev, lines] of Object.entries(ev)) push(dev, lines.join('\n'));
      paint(); opts.onChange && opts.onChange(s.lastPing);
    };
    const help = v => {
      const d = s.devices[cur]; if (!d) return;
      push(cur, SIM.prompt(d) + v + '?', 'echo');
      push(cur, d.kind === 'pc' ? SIM.execLine(s, d, 'help') : SIM.helpOrComplete(d, v));
      paint();
    };
    const ctrl = ch => {
      const d = s.devices[cur]; if (!d) return;
      push(cur, SIM.prompt(d) + input.value + '^' + ch, 'echo'); input.value = '';
      if (d.kind !== 'pc') { if (d.pending) d.pending = null; else if (d.mode !== 'user' && d.mode !== 'priv') { d.mode = 'priv'; d.ctx = null; push(cur, SIM.CONFIG_I); } }
      paint(); opts.onChange && opts.onChange();
    };
    const hist = dir => {
      const d = s.devices[cur]; if (!d) return;
      let i = hidx[cur] ?? d.hist.length; i = Math.max(0, Math.min(d.hist.length, i + dir)); hidx[cur] = i;
      input.value = d.hist[i] || ''; requestAnimationFrame(() => input.setSelectionRange(input.value.length, input.value.length));
    };
    form.onsubmit = e => { e.preventDefault(); const v = input.value; input.value = ''; run(v); };
    input.addEventListener('keydown', e => {
      if (e.key === 'Tab') { e.preventDefault(); const r = s.devices[cur] && SIM.helpOrComplete(s.devices[cur], input.value, true); if (r) input.value = r; }
      else if (e.key === 'ArrowUp') { e.preventDefault(); hist(-1); }
      else if (e.key === 'ArrowDown') { e.preventDefault(); hist(1); }
      else if (e.ctrlKey && /^[cC]$/.test(e.key) && !getSelection().toString()) { e.preventDefault(); ctrl('C'); }
      else if (e.ctrlKey && /^[zZ]$/.test(e.key)) { e.preventDefault(); ctrl('Z'); }
    });
    input.addEventListener('input', () => { if (input.value.includes('?')) { const v = input.value.replace(/\?/g, ''); input.value = v; help(v); } });
    root.addEventListener('click', e => {
      const sz = e.target.closest('[data-sz]');
      if (sz) { size = sz.dataset.sz; $('.terminal', root).dataset.size = size; root.querySelectorAll('[data-sz]').forEach(b => b.setAttribute('aria-pressed', b === sz)); return; }
      const k = e.target.closest('[data-k]'); if (!k) return;
      const key = k.dataset.k;
      if (key === '?') help(input.value);
      else if (key === 'Tab') { const r = s.devices[cur] && SIM.helpOrComplete(s.devices[cur], input.value, true); if (r) input.value = r; }
      else if (key === 'Up') hist(-1); else if (key === 'Down') hist(1);
      else if (key === 'C') ctrl('C');
      else if (key === 'cls') { buf[cur] = []; paint(); }
      else if (key === 'clr') input.value = '';
      else if (key === 'end') run('end');
      else if (key === 'exit') run('exit');
      input.focus();
    });
    out.addEventListener('click', () => { if (!getSelection().toString()) input.focus(); });
    paint();
    return {
      select(name) { cur = name; paint(); },
      get current() { return cur; },
      focus() { if (matchMedia('(pointer: fine)').matches) input.focus({ preventScroll: true }); },
      paint, push
    };
  }

  /* ================= 演習画面 ================= */
  function renderSim(id, keep) {
    leave();
    const lab = LABS.find(l => l.id === id);
    const s = SIM.newSession(lab);
    const devs = lab.devices.filter(d => d.kind !== 'pc' && d.cli !== false).map(d => d.name);
    const exam = keep ? keep.exam : st.answer === 'exam';
    const started = keep ? keep.started : Date.now();
    const deadline = keep ? keep.deadline : Date.now() + st.minutes * 60000;
    let flash = null, flashT, typed = 0, done = false, tab = 'topo';
    const px = Object.values(lab.pos).map(p => p[0]), py = Object.values(lab.pos).map(p => p[1]);
    const vb = [Math.min(...px) - 85, Math.min(...py) - 42, Math.max(...px) - Math.min(...px) + 170, Math.max(...py) - Math.min(...py) + 100];
    app.innerHTML = `
      <header class="sim-top">
        <button type="button" class="back-btn" id="back">‹ 問題一覧</button>
        <h2>${esc(lab.section)} ${lab.no}｜${esc(lab.title)} <span class="chip">${exam ? '試験' : '練習'}</span></h2>
        <div class="sim-clock" id="clock"><small>Remaining</small><b>--:--</b></div>
      </header>
      <div class="workspace">
        <div class="ref">
          <nav class="main-tabs" role="tablist"><button type="button" role="tab" data-tab="topo">Topology</button><button type="button" role="tab" data-tab="task">Task</button></nav>
          <section class="tab-panel" data-panel="topo"><div class="section-title">ネットワーク構成図</div><div class="topo-host" id="topo"></div>
            <div class="topo-legend"><span>━ 接続（緑：通信可能 ／ 灰の破線：停止中）</span><span>● 端の点：ポートの状態</span><span>数字＝接続番号</span></div>
            <div class="topo-note"><b>接続・条件</b>${esc(lab.note)}</div></section>
          <section class="tab-panel" data-panel="task"><div class="section-title">Task</div>
            <ol class="task-list">${lab.tasks.map((t, i) => `<li><b>T${i + 1}</b><span>${esc(t)}</span></li>`).join('')}</ol>
            <p class="task-rule">問題文が方式を指定しない限り、同じTask Intentを満たすCisco IOS上妥当な方法を正解として扱います。</p></section>
        </div>
        <div class="cli-col">
          <div class="cli-head">${devs.map(n => `<button type="button" class="dev-pill" data-dev="${n}" aria-selected="${n === devs[0]}">${n}</button>`).join('')}
            <span class="progress" id="prog"></span></div>
          <div id="term"></div>
        </div>
      </div>
      <footer class="actionbar"><button type="button" class="secondary-btn" id="reset">Reset</button><button type="button" class="primary-btn" id="submit">Submit</button></footer>`;
    const term = makeTerminal($('#term'), s, {
      device: devs[0], banner: `${lab.section} ${lab.no}`,
      onChange(ping) {
        typed++;
        if (ping && !ping.self) { flash = { ok: ping.ok, links: new Set(ping.links) }; clearTimeout(flashT); flashT = setTimeout(() => { flash = null; topo(); }, 2600); }
        topo(); prog();
      }
    });
    const topo = () => drawTopo($('#topo'), s, lab.pos, { selected: term.current, flash, onSelect: n => { if (devs.includes(n)) select(n); }, viewBox: vb });
    const prog = () => {
      const el = $('#prog'); if (!el) return;
      if (exam) { el.innerHTML = 'Progress <b>非表示</b>'; return; }
      const p = SIM.progress(s); el.innerHTML = `Progress <i><span style="width:${p}%"></span></i><b>${p}%</b>`;
    };
    const select = n => { term.select(n); app.querySelectorAll('[data-dev]').forEach(b => b.getAttribute && b.classList.contains('dev-pill') && b.setAttribute('aria-selected', b.dataset.dev === n)); topo(); term.focus(); };
    const setTab = t => { tab = t; app.querySelectorAll('[data-tab]').forEach(b => b.setAttribute('aria-selected', b.dataset.tab === t)); app.querySelectorAll('[data-panel]').forEach(p => p.hidden = p.dataset.panel !== t); };
    app.querySelectorAll('[data-tab]').forEach(b => b.onclick = () => setTab(b.dataset.tab));
    app.querySelectorAll('.dev-pill').forEach(b => b.onclick = () => select(b.dataset.dev));
    setTab('topo'); topo(); prog();
    const tick = () => {
      const left = deadline - Date.now(), t = Math.max(0, Math.round(left / 1000));
      const el = $('#clock'); if (!el) return;
      $('b', el).textContent = String(Math.floor(t / 60)).padStart(2, '0') + ':' + String(t % 60).padStart(2, '0');
      el.classList.toggle('warn', left <= 60000);
      if (left <= 0 && !done) submit(true);
    };
    const timer = setInterval(tick, 1000); tick();
    view = { dispose() { clearInterval(timer); clearTimeout(flashT); closeOverlay(); } };
    $('#back').onclick = () => typed ? confirmBox('問題一覧に戻りますか？', '入力した設定は破棄されます。', '戻る', goHome) : goHome();
    $('#reset').onclick = () => confirmBox('初期状態に戻しますか？', 'すべての機器の設定と画面表示を、開始時の状態に戻します（残り時間はそのまま）。', 'Reset', () => renderSim(id, { exam, started, deadline }));
    $('#submit').onclick = () => confirmBox('提出しますか？', '現在の設定状態で採点します。', '提出する', () => submit(false));
    term.focus();

    function submit(timeout) {
      done = true; clearInterval(timer);
      const g = SIM.grade(s), x = record(lab.id, g.score);
      const sec = Math.round((Date.now() - started) / 1000);
      const ans = Object.entries(lab.answer).map(([d, c]) => '! ---- ' + d + ' ----\n' + c.join('\n')).join('\n\n');
      openOverlay(`<div class="result" role="dialog" aria-modal="true" aria-labelledby="rt">
        ${timeout ? '<p class="chip" style="background:#fdecea;color:#7f1d1d;border-color:#f0c2bd;justify-self:start">時間切れのため自動で提出しました</p>' : ''}
        <div class="cat">${esc(lab.section)} ${lab.no}</div><h2 id="rt">${esc(lab.title)}</h2>
        <div class="score-row"><span>提出結果</span><b>Score ${g.score}%</b><span>経過時間 ${Math.floor(sec / 60)}分${sec % 60}秒 / 前回 ${x.last}% / Best ${x.best}% / ${x.n}回目</span></div>
        <ul class="checks">${g.checks.map(c => `<li class="${c.ok ? 'ok' : 'ng'}">${c.ok ? '✓' : '✕'} ${esc(c.label)}<em>${c.w}点</em></li>`).join('')}
          <li class="${g.saved.saved ? 'ok' : 'ng'}">${g.saved.saved ? '✓' : '✕'} 設定保存（startup-config）<em>未保存は最大99点</em></li></ul>
        <div class="result-actions">${timeout ? '' : '<button type="button" class="secondary-btn" id="fix">設定を修正する</button>'}<button type="button" class="secondary-btn" id="again">もう一度挑戦</button><button type="button" class="secondary-btn" id="list">問題一覧へ戻る</button><button type="button" class="primary-btn" id="exp" aria-expanded="false">解説・回答例を見る</button></div>
        <div class="explain" id="explain" hidden>
          <h3>この問題の要件</h3><ol>${lab.tasks.map(t => `<li>${esc(t)}</li>`).join('')}</ol>
          <h3>解き方の根拠</h3><p>${esc(lab.why)}</p>
          <h3>採点条件</h3><ul>${lab.checks.map(c => `<li><b>${esc(c.label)}</b>（${c.w}点）</li>`).join('')}</ul>
          <h3>確認方法</h3><ul>${lab.show.map(c => `<li><code>${esc(c)}</code></li>`).join('')}</ul>
          <h3>見落としやすい点</h3><p>${esc(lab.pitfall)}</p>
          <h3>回答例</h3><pre>${esc(ans)}</pre>
          <p class="muted" style="font-size:12.5px">write memory と copy running-config startup-config は、同じ保存の意図を満たします。</p>
        </div></div>`);
      const on = (i, f) => { const b = $('#' + i); if (b) b.onclick = f; };
      on('again', () => renderSim(id));
      on('list', goHome);
      on('exp', e => { const ex = $('#explain'); ex.hidden = !ex.hidden; e.currentTarget.setAttribute('aria-expanded', !ex.hidden); e.currentTarget.textContent = ex.hidden ? '解説・回答例を見る' : '解説を閉じる'; });
      if (!timeout) $('#fix').onclick = () => { closeOverlay(); done = false; const t2 = setInterval(tick, 1000); view = { dispose() { clearInterval(t2); clearTimeout(flashT); closeOverlay(); } }; tick(); term.focus(); };
    }
  }

  /* ================= 自由演習 ================= */
  function renderFree() {
    leave();
    const s = SIM.newSession(null), pos = {};
    let selected = null, flash = null, flashT;
    app.innerHTML = `
      <header class="sim-top"><button type="button" class="back-btn" id="back">‹ 問題一覧</button><h2>自由演習｜Dynamic Network Simulator</h2><div class="sim-clock"><small id="count"></small></div></header>
      <div class="free-body">
        <div class="free-guide"><h3>自由演習の使い方<small>設定は画面操作ではなくCLIから行います。</small></h3>
          <div class="steps"><div><i>1</i><span><b>機器を置く</b>種類を選んで「機器を追加」</span></div><div><i>2</i><span><b>ケーブルで接続</b>接続元と接続先の機器・ポートを選んで「ケーブルを接続」</span></div><div><i>3</i><span><b>CLIで設定</b>構成図の機器を選び、CLIへコマンドを入力</span></div></div></div>
        <div class="sample"><span><b>まず触ってみるなら：</b>ルーター2台・スイッチ1台・PC2台を配線済みの構成を用意します。</span><button type="button" class="primary-btn" id="sample">サンプル構成で始める</button></div>
        <div class="card builder">
          <div class="grp"><label><span class="label">追加する機器</span><select id="kind"><option value="router">ルーター</option><option value="switch">レイヤー2スイッチ</option><option value="pc">パソコン</option></select></label><button type="button" class="primary-btn" id="add">機器を追加</button></div>
          <span class="sep"></span>
          <div class="grp"><label><span class="label">接続元</span><select id="ad"></select></label><select id="ap" aria-label="接続元ポート"></select></div>
          <div class="grp"><label><span class="label">接続先</span><select id="bd"></select></label><select id="bp" aria-label="接続先ポート"></select></div>
          <button type="button" class="secondary-btn" id="link">ケーブルを接続</button>
        </div>
        <div class="free-grid">
          <div class="card"><div class="topo-tools"><span class="t">ネットワーク構成図</span><button type="button" class="secondary-btn" id="arrange">配置を整える</button></div>
            <div class="topo-host" id="topo"></div>
            <div class="topo-legend"><span>機器はドラッグで移動・クリックで選択</span><span>緑：通信可能 ／ 灰の破線：停止中</span></div>
            <ul class="conn-list" id="conns"></ul></div>
          <div class="cli-col"><div class="card dev-panel" id="devpanel"></div><div id="term"></div></div>
        </div>
      </div>`;
    const term = makeTerminal($('#term'), s, { device: null, onChange(ping) { if (ping && !ping.self) { flash = { ok: ping.ok, links: new Set(ping.links) }; clearTimeout(flashT); flashT = setTimeout(() => { flash = null; redraw(); }, 2600); } redraw(); panel(); } });
    view = { dispose() { clearTimeout(flashT); closeOverlay(); } };
    const opt = (list, v, ph) => `<option value="">${ph}</option>` + list.map(x => `<option value="${esc(x)}"${x === v ? ' selected' : ''}>${esc(x)}</option>`).join('');
    const selects = () => {
      const names = Object.keys(s.devices);
      for (const [d, p] of [['ad', 'ap'], ['bd', 'bp']]) {
        const dv = $('#' + d).value, pv = $('#' + p).value;
        $('#' + d).innerHTML = opt(names, dv, '機器を選択');
        const ports = names.includes($('#' + d).value) ? SIM.freePorts(s, $('#' + d).value) : [];
        $('#' + p).innerHTML = opt(ports, pv, 'ポートを選択');
      }
      $('#count').textContent = `機器 ${names.length}/32台・接続 ${s.links.length}/64本`;
    };
    ['ad', 'bd'].forEach(id => $('#' + id).onchange = selects);
    const redraw = () => {
      const host = $('#topo');
      if (!Object.keys(s.devices).length) { host.innerHTML = '<div class="empty" style="margin:16px">まだ機器がありません。「機器を追加」か「サンプル構成で始める」から始めてください。</div>'; }
      else drawTopo(host, s, pos, { selected, flash, draggable: true, redraw, onSelect: n => select(n), viewBox: [0, 0, 760, 400] });
      $('#conns').innerHTML = s.links.map((l, i) => `<li><i>${i + 1}</i><span><b>${esc(l.a)}</b> ${esc(l.ai)} ↔ <b>${esc(l.b)}</b> ${esc(l.bi)}<br><small>${SIM.ifUp(s, s.devices[l.a], l.ai) && SIM.ifUp(s, s.devices[l.b], l.bi) ? '稼働中' : '停止中（shutdown・未設定など）'}</small></span><button type="button" data-cut="${i}">切断</button></li>`).join('');
      $('#conns').querySelectorAll('[data-cut]').forEach(b => b.onclick = () => { SIM.disconnect(s, +b.dataset.cut); toast('切断しました'); redraw(); selects(); panel(); });
    };
    const panel = () => {
      const el = $('#devpanel'), d = selected && s.devices[selected];
      if (!d) { el.innerHTML = '<div class="empty">構成図の機器を選ぶと、ここに状態が表示され、下のCLIで設定できます。</div>'; return; }
      const ports = Object.keys(d.ifaces).filter(n => !d.ifaces[n].svi);
      el.innerHTML = `<div class="head"><b>${esc(d.name)}</b><span class="tag">${KIND_JA[d.kind]}</span><button type="button" class="secondary-btn" id="del">この機器を削除</button></div>
        <div class="tags">${ports.map(n => `<span class="tag" style="background:${SIM.ifUp(s, d, n) ? '#e5f5ec' : '#f1f3f6'};color:${SIM.ifUp(s, d, n) ? '#14532d' : '#667085'}">${d.kind === 'pc' ? 'Eth0' : SIM.shortIf(n)} ${SIM.ifUp(s, d, n) ? 'up' : 'down'}</span>`).join('')}</div>
        ${d.kind === 'pc' ? `<form class="pc-form" id="pcf"><label>IPアドレス<input name="ip" value="${esc(d.ifaces.eth0.ip || '')}" placeholder="192.168.1.10"></label><label>サブネットマスク<input name="mask" value="${esc(d.ifaces.eth0.mask || '')}" placeholder="255.255.255.0"></label><label>デフォルトGW<input name="gw" value="${esc(d.gw || '')}" placeholder="192.168.1.1"></label><button type="submit" class="secondary-btn">適用</button></form>` : ''}`;
      $('#del').onclick = () => confirmBox(`${d.name} を削除しますか？`, 'つながっているケーブルも外れます。', '削除', () => { SIM.removeDevice(s, d.name); delete pos[d.name]; selected = null; term.select(null); refresh(); });
      const f = $('#pcf');
      if (f) f.onsubmit = e => {
        e.preventDefault();
        const ip = f.ip.value.trim(), mask = f.mask.value.trim(), gw = f.gw.value.trim();
        if ((ip && !SIM.isIp(ip)) || (mask && !SIM.isIp(mask)) || (gw && !SIM.isIp(gw))) { toast('IPアドレスの形式が正しくありません'); return; }
        d.ifaces.eth0.ip = ip || null; d.ifaces.eth0.mask = mask || null; d.gw = gw || null;
        toast(`${d.name} のネットワーク設定を適用しました`); redraw(); panel();
      };
    };
    const select = n => { selected = n; term.select(n); redraw(); panel(); term.focus(); };
    const refresh = () => { selects(); redraw(); panel(); };
    const place = d => {
      const same = Object.values(s.devices).filter(x => x.kind === d.kind && x !== d).length;
      const row = { router: 70, switch: 200, pc: 330 }[d.kind];
      pos[d.name] = [100 + (same % 5) * 140, row];
    };
    const arrange = () => {
      for (const kind of ['router', 'switch', 'pc']) {
        const list = Object.values(s.devices).filter(d => d.kind === kind);
        list.forEach((d, i) => { pos[d.name] = [Math.round(380 + (i - (list.length - 1) / 2) * 170), { router: 70, switch: 200, pc: 330 }[kind]]; });
      }
    };
    $('#add').onclick = () => {
      if (Object.keys(s.devices).length >= 32) { toast('機器は32台までです'); return; }
      const d = SIM.addDevice(s, $('#kind').value); place(d); toast(`${d.name} を追加しました`); select(d.name); selects();
    };
    $('#link').onclick = () => {
      const a = $('#ad').value, ap = $('#ap').value, b = $('#bd').value, bp = $('#bp').value;
      if (!a || !ap || !b || !bp) { toast('接続元と接続先の機器・ポートを選んでください'); return; }
      const err = SIM.connect(s, a, ap, b, bp); if (err) { toast(err); return; }
      toast('接続しました'); $('#ap').value = ''; $('#bp').value = ''; refresh();
    };
    $('#arrange').onclick = () => { arrange(); redraw(); };
    $('#sample').onclick = () => {
      const go = () => {
        for (const n of Object.keys(s.devices)) SIM.removeDevice(s, n);
        for (const k of Object.keys(pos)) delete pos[k];
        for (const k of ['router', 'router', 'switch', 'pc', 'pc']) SIM.addDevice(s, k);
        const C = (a, ap, b, bp) => SIM.connect(s, a, SIM.canonIf(ap), b, bp === 'eth0' ? 'eth0' : SIM.canonIf(bp));
        C('R1', 'Gi0/1', 'R2', 'Gi0/1'); C('R1', 'Gi0/0', 'SW1', 'Gi0/1'); C('SW1', 'Fa0/1', 'PC1', 'eth0'); C('SW1', 'Fa0/2', 'PC2', 'eth0');
        Object.assign(s.devices.PC1.ifaces.eth0, { ip: '192.168.1.11', mask: '255.255.255.0' }); s.devices.PC1.gw = '192.168.1.1';
        Object.assign(s.devices.PC2.ifaces.eth0, { ip: '192.168.1.12', mask: '255.255.255.0' }); s.devices.PC2.gw = '192.168.1.1';
        pos.R2 = [200, 70]; pos.R1 = [520, 70]; pos.SW1 = [520, 200]; pos.PC1 = [420, 330]; pos.PC2 = [620, 330];
        selected = null; select('R1'); selects();
        term.push('R1', 'ヒント: enable → configure terminal → interface g0/0 → ip address 192.168.1.1 255.255.255.0 → no shutdown\n設定後、構成図で PC1 を選び ping 192.168.1.1 を試してください。', 'log'); term.paint();
        toast('サンプル構成を用意しました');
      };
      Object.keys(s.devices).length ? confirmBox('いまの構成を置き換えますか？', '現在の機器と設定は消えます。', '置き換える', go) : go();
    };
    $('#back').onclick = () => Object.keys(s.devices).length ? confirmBox('問題一覧に戻りますか？', '自由演習の構成は保存されません。', '戻る', goHome) : goHome();
    refresh();
    window.scrollTo(0, 0);
  }

  /* ---- ダイアログ ---- */
  let lastFocus = null;
  function openOverlay(html) {
    closeOverlay(); lastFocus = document.activeElement;
    const o = document.createElement('div'); o.className = 'overlay'; o.id = 'overlay'; o.innerHTML = html;
    document.body.appendChild(o);
    const f = o.querySelector('.primary-btn, button'); if (f) f.focus();
  }
  function closeOverlay() { const o = $('#overlay'); if (o) o.remove(); if (lastFocus && document.contains(lastFocus)) lastFocus.focus(); }
  function confirmBox(title, body, ok, fn) {
    openOverlay(`<div class="confirm" role="dialog" aria-modal="true"><h2 style="font-size:17px">${esc(title)}</h2><p class="muted">${esc(body)}</p><div class="row"><button type="button" class="secondary-btn" id="cx">キャンセル</button><button type="button" class="primary-btn" id="ok">${esc(ok)}</button></div></div>`);
    $('#cx').onclick = closeOverlay;
    $('#ok').onclick = () => { closeOverlay(); fn(); };
  }
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && $('#cx')) closeOverlay(); });

  /* ---- 画面の切り替え（#lab-orig-01 / #free / それ以外はトップ） ----
     公開先ではクエリ文字列が使えないため、URLのハッシュで画面を表す */
  const BASE_TITLE = document.title;
  function goHome() { if (location.hash) location.hash = ''; else route(); }
  function route() {
    const h = decodeURIComponent(location.hash.slice(1)).toLowerCase();
    const lab = h.startsWith('lab-') && LABS.find(l => l.id.toLowerCase() === h.slice(4));
    if (lab) { st.labId = lab.id; document.title = `${lab.title} | ${BASE_TITLE}`; renderSim(lab.id); }
    else if (h === 'free') { document.title = `自由演習 | ${BASE_TITLE}`; renderFree(); }
    else { document.title = BASE_TITLE; renderLaunch(); }
  }
  addEventListener('hashchange', route);
  route();
})();

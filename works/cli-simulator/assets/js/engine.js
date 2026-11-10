/* CLIシミュレーター（公開用デモ）— 軽量CLIエンジン
   公開用に新しく書いた軽量版。実運用版のエンジンは含まない。 */
'use strict';

/* ===== IPv4 / IPv6 ===== */
const IPRE = /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/;
const isIp = s => IPRE.test(s);
const ip2n = s => s.split('.').reduce((a, b) => ((a << 8) | Number(b)) >>> 0, 0);
const n2ip = n => [n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join('.');
const lenToMask = l => l === 0 ? 0 : (0xffffffff << (32 - l)) >>> 0;
function maskLen(m) { const n = ip2n(m); let l = 0; while (l < 32 && (n & (0x80000000 >>> l))) l++; return l; }
const isMask = s => isIp(s) && lenToMask(maskLen(s)) === ip2n(s);
const netOf = (ip, len) => n2ip((ip2n(ip) & lenToMask(len)) >>> 0);
const inNet = (ip, net, len) => ((ip2n(ip) & lenToMask(len)) >>> 0) === ((ip2n(net) & lenToMask(len)) >>> 0);

function expand6(a) {
  a = a.toLowerCase();
  if ((a.match(/::/g) || []).length > 1) return null;
  let [h, t] = a.includes('::') ? a.split('::') : [a, null];
  const hs = h ? h.split(':') : [], ts = t ? t.split(':') : [];
  const fill = t === null ? 0 : 8 - hs.length - ts.length;
  if (fill < 0) return null;
  const all = [...hs, ...Array(fill).fill('0'), ...ts];
  if (all.length !== 8 || !all.every(g => /^[0-9a-f]{1,4}$/.test(g))) return null;
  return all.map(g => g.padStart(4, '0')).join(':');
}
function isV6Prefix(s) {
  const m = String(s).match(/^([0-9a-f:]+)\/(\d{1,3})$/i);
  return !!(m && +m[2] <= 128 && expand6(m[1]));
}
const v6Eq = (a, b) => {
  const [x, xl] = a.split('/'), [y, yl] = b.split('/');
  return xl === yl && expand6(x) === expand6(y);
};

/* ===== Interfaces ===== */
const IFT = [['GigabitEthernet', 'Gi'], ['FastEthernet', 'Fa'], ['Ethernet', 'Et'], ['Serial', 'Se'], ['Vlan', 'Vl'], ['Loopback', 'Lo']];
function canonIf(tok) {
  const m = String(tok).match(/^([a-z]+)-?(\d+(?:\/\d+){0,2})$/i);
  if (!m) return null;
  const t = m[1].toLowerCase();
  const hit = IFT.filter(([f]) => f.toLowerCase().startsWith(t));
  return hit.length === 1 ? hit[0][0] + m[2] : null;
}
function shortIf(n) { for (const [f, s] of IFT) if (n.startsWith(f)) return s + n.slice(f.length); return n; }

/* ===== Devices ===== */
function makeDevice(spec) {
  const d = { name: spec.name, kind: spec.kind, hostname: spec.hostname || (spec.kind === 'switch' ? 'Switch' : 'Router'), mode: 'user', ctx: null, pending: null, ifaces: {}, hist: [], cli: spec.cli !== false, label: spec.label || '' };
  if (spec.kind === 'pc') {
    d.hostname = spec.name;
    d.ifaces.eth0 = { ip: spec.ip || null, mask: spec.mask || null, shut: false };
    d.gw = spec.gw || null;
    return d;
  }
  Object.assign(d, {
    routes: [], v6routing: false, ospf: {}, enableSecret: null, enablePass: null, domain: null, rsa: 0, sshVer: null,
    users: {}, pwEnc: false, noLookup: false, banner: null,
    lines: { con: { range: '0', login: null, pass: null, transport: null, sync: false, timeout: null }, vty: { range: '0 4', login: null, pass: null, transport: null, sync: false, timeout: null } },
    startup: null
  });
  for (const p of spec.ports) {
    const n = canonIf(p);
    d.ifaces[n] = spec.kind === 'router'
      ? { shut: true, ip: null, mask: null, v6: [], desc: '', ospf: null }
      : { shut: false, mode: 'dynamic', vlan: 1, native: 1, allowed: null, nonego: false, portfast: false, desc: '' };
  }
  if (spec.kind === 'switch') {
    d.vlans = { 1: 'default' };
    d.ifaces.Vlan1 = { svi: true, vlanId: 1, shut: true, ip: null, mask: null, desc: '' };
    d.gw = null;
  }
  return d;
}
const isSvi = d => !!(d.ctx && /^Vlan/.test(d.ctx.if));
const curIf = d => d.ifaces[d.ctx.if];

/* ===== Topology / L2 ===== */
function linkIndex(s, dev, ifn) { return s.links.findIndex(l => (l.a === dev && l.ai === ifn) || (l.b === dev && l.bi === ifn)); }
function peerOf(s, dev, ifn) {
  const i = linkIndex(s, dev, ifn); if (i < 0) return null;
  const l = s.links[i];
  return l.a === dev && l.ai === ifn ? { dev: l.b, if: l.bi, li: i } : { dev: l.a, if: l.ai, li: i };
}
function ifUp(s, d, n) {
  const i = d.ifaces[n]; if (!i || i.shut) return false;
  if (i.svi) return !!d.vlans[i.vlanId];
  if (i.loop) return true;
  const p = peerOf(s, d.name, n); if (!p) return false;
  return !s.devices[p.dev].ifaces[p.if].shut;
}
const allowedHas = (p, v) => p.allowed === null || p.allowed.includes(v);
const isTrunk = p => p.mode === 'trunk';

function l2reach(s, dn, ifn) {
  const res = [], seen = new Set(), q = [];
  const d = s.devices[dn], i = d.ifaces[ifn];
  if (!ifUp(s, d, ifn)) return res;
  if (i.svi) q.push({ sw: dn, vlan: i.vlanId, ingress: null, path: [] });
  else q.push({ from: { dev: dn, if: ifn }, tag: null, path: [] });
  while (q.length) {
    const st = q.shift();
    if (st.from) {
      const peer = peerOf(s, st.from.dev, st.from.if); if (!peer) continue;
      const pd = s.devices[peer.dev], pi = pd.ifaces[peer.if];
      if (pi.shut) continue;
      const path = [...st.path, peer.li];
      if (pd.kind !== 'switch') { res.push({ dev: peer.dev, if: peer.if, path }); continue; }
      let vlan;
      if (isTrunk(pi)) { vlan = st.tag == null ? pi.native : st.tag; if (!allowedHas(pi, vlan)) continue; }
      else { if (st.tag != null) continue; vlan = pi.vlan; }
      const key = peer.dev + '|' + vlan; if (seen.has(key)) continue; seen.add(key);
      q.push({ sw: peer.dev, vlan, ingress: peer.if, path });
    } else {
      const sd = s.devices[st.sw];
      if (!sd.vlans[st.vlan]) continue;
      seen.add(st.sw + '|' + st.vlan);
      for (const [pn, p] of Object.entries(sd.ifaces)) {
        if (pn === st.ingress) continue;
        if (p.svi) {
          if (p.vlanId === st.vlan && !p.shut && !(st.sw === dn && pn === ifn)) res.push({ dev: st.sw, if: pn, path: st.path });
          continue;
        }
        if (p.shut) continue;
        if (isTrunk(p)) { if (allowedHas(p, st.vlan)) q.push({ from: { dev: st.sw, if: pn }, tag: st.vlan === p.native ? null : st.vlan, path: st.path }); }
        else if (p.vlan === st.vlan) q.push({ from: { dev: st.sw, if: pn }, tag: null, path: st.path });
      }
    }
  }
  return res;
}

/* ===== OSPF ===== */
function ospfIfaces(s, d) {
  if (d.kind !== 'router') return [];
  const procs = Object.values(d.ospf); if (!procs.length) return [];
  const out = [];
  for (const [n, i] of Object.entries(d.ifaces)) {
    if (!i.ip || !ifUp(s, d, n)) continue;
    for (const pr of procs) {
      let area = null;
      if (i.ospf && i.ospf.pid === pr.pid) area = i.ospf.area;
      else for (const nw of pr.nets) {
        const wm = ip2n(nw.wild);
        if (((ip2n(i.ip) | wm) >>> 0) === ((ip2n(nw.ip) | wm) >>> 0)) { area = nw.area; break; }
      }
      if (area != null) { out.push({ if: n, ip: i.ip, mask: i.mask, area, pid: pr.pid, passive: pr.passive.includes(n) }); break; }
    }
  }
  return out;
}
function routerId(s, d) {
  const pr = Object.values(d.ospf)[0];
  if (pr && pr.rid) return pr.rid;
  const ips = Object.entries(d.ifaces).filter(([n, i]) => i.ip && ifUp(s, d, n));
  const lo = ips.filter(([n]) => n.startsWith('Loopback'));
  const pool = (lo.length ? lo : ips).map(([, i]) => i.ip).sort((a, b) => ip2n(b) - ip2n(a));
  return pool[0] || '0.0.0.0';
}
function ospfNeighbors(s, d) {
  const mine = ospfIfaces(s, d), out = [];
  const myRid = routerId(s, d);
  for (const oi of mine) {
    if (oi.passive) continue;
    for (const e of l2reach(s, d.name, oi.if)) {
      const pd = s.devices[e.dev]; if (pd.kind !== 'router') continue;
      const theirs = ospfIfaces(s, pd).find(x => x.if === e.if);
      if (!theirs || theirs.passive || theirs.area !== oi.area) continue;
      const len = maskLen(oi.mask);
      if (theirs.mask !== oi.mask || !inNet(theirs.ip, oi.ip, len)) continue;
      const rid = routerId(s, pd); if (rid === myRid) continue;
      out.push({ dev: e.dev, rid, ip: theirs.ip, localIf: oi.if });
    }
  }
  return out;
}
function ospfRoutes(s, d) {
  if (!Object.keys(d.ospf).length) return [];
  const conn = new Set(connected(s, d).map(c => c.net + '/' + c.len));
  const first = ospfNeighbors(s, d); if (!first.length) return [];
  const dist = { [d.name]: 0 }, via = {}, q = [];
  for (const n of first) if (!(n.dev in dist)) { dist[n.dev] = 1; via[n.dev] = n; q.push(n.dev); }
  while (q.length) {
    const cur = q.shift();
    for (const n of ospfNeighbors(s, s.devices[cur])) if (!(n.dev in dist)) { dist[n.dev] = dist[cur] + 1; via[n.dev] = via[cur]; q.push(n.dev); }
  }
  const best = {};
  for (const dev of Object.keys(dist)) {
    if (dev === d.name) continue;
    for (const oi of ospfIfaces(s, s.devices[dev])) {
      const len = maskLen(oi.mask), net = netOf(oi.ip, len), key = net + '/' + len;
      if (conn.has(key)) continue;
      const metric = dist[dev] + 1;
      if (!best[key] || best[key].metric > metric) best[key] = { code: 'O', net, len, ad: 110, metric, nh: via[dev].ip, iface: via[dev].localIf };
    }
  }
  return Object.values(best);
}

/* ===== Routing ===== */
function connected(s, d) {
  const out = [];
  for (const [n, i] of Object.entries(d.ifaces)) {
    if (!i.ip || !ifUp(s, d, n)) continue;
    const len = maskLen(i.mask);
    out.push({ net: netOf(i.ip, len), len, iface: n, ip: i.ip });
  }
  return out;
}
function routeTable(s, d) {
  const all = [];
  const conn = connected(s, d);
  for (const c of conn) {
    all.push({ code: 'C', net: c.net, len: c.len, ad: 0, metric: 0, iface: c.iface });
    if (d.kind !== 'pc') all.push({ code: 'L', net: c.ip, len: 32, ad: 0, metric: 0, iface: c.iface });
  }
  if (d.kind === 'pc' || d.kind === 'switch') {
    if (d.gw) { const c = conn.find(c => inNet(d.gw, c.net, c.len)); if (c) all.push({ code: 'S', net: '0.0.0.0', len: 0, ad: 1, metric: 0, nh: d.gw, iface: c.iface }); }
    return pick(all);
  }
  for (const r of d.routes) {
    const len = maskLen(r.mask), net = netOf(r.net, len);
    if (r.iface) { if (ifUp(s, d, r.iface)) all.push({ code: 'S', net, len, ad: r.ad, metric: 0, iface: r.iface, direct: true }); }
    else { const c = conn.find(c => inNet(r.nh, c.net, c.len)); if (c) all.push({ code: 'S', net, len, ad: r.ad, metric: 0, nh: r.nh, iface: c.iface }); }
  }
  all.push(...ospfRoutes(s, d));
  return pick(all);
}
function pick(all) {
  const by = {};
  for (const r of all) { const k = r.net + '/' + r.len + (r.code === 'L' ? 'L' : ''); if (!by[k] || by[k].ad > r.ad) by[k] = r; }
  return Object.values(by);
}
function lookup(s, d, dst) {
  let best = null;
  for (const r of routeTable(s, d)) {
    if (r.code === 'L') continue;
    if (inNet(dst, r.net, r.len) && (!best || r.len > best.len)) best = r;
  }
  return best;
}
const ownsIp = (s, d, ip) => Object.entries(d.ifaces).some(([n, i]) => i.ip === ip && ifUp(s, d, n));
function ownerOf(s, ip) { return Object.values(s.devices).find(d => Object.values(d.ifaces).some(i => i.ip === ip)); }

function trace(s, from, dst) {
  let cur = from; const links = [];
  for (let hop = 0; hop < 16; hop++) {
    const d = s.devices[cur];
    if (ownsIp(s, d, dst)) return { ok: true, links, dev: cur };
    const r = lookup(s, d, dst);
    if (!r) return { ok: false, links, dev: cur, reason: 'noroute' };
    const nh = r.nh || dst;
    const e = l2reach(s, cur, r.iface).find(e => s.devices[e.dev].ifaces[e.if].ip === nh);
    if (!e) return { ok: false, links, dev: cur, reason: 'arp' };
    links.push(...e.path); cur = e.dev;
  }
  return { ok: false, links, dev: cur, reason: 'ttl' };
}
function doPing(s, src, dst) {
  const d = s.devices[src];
  if (ownsIp(s, d, dst)) return { ok: true, links: [], self: true };
  const r = lookup(s, d, dst);
  if (!r) return { ok: false, links: [], reason: 'noroute', at: src };
  const srcIp = d.ifaces[r.iface].ip;
  const go = trace(s, src, dst);
  if (!go.ok) return { ok: false, links: go.links, reason: go.reason, at: go.dev };
  const back = trace(s, go.dev, srcIp);
  return { ok: back.ok, links: [...go.links, ...back.links], reason: back.reason, at: back.dev };
}

/* ===== Running-config ===== */
function fakeHash(str, n = 22) {
  const A = './0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
  let h = 2166136261, out = '';
  for (let k = 0; out.length < n; k++) {
    for (const c of str + k) h = Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0;
    out += A[h % 64];
  }
  return out;
}
const secretStr = v => '5 $1$' + fakeHash('s' + v, 4) + '$' + fakeHash(v);
const type7 = v => '7 ' + Array.from(fakeHash('p' + v, 12)).map(c => (c.charCodeAt(0) % 16).toString(16).toUpperCase()).join('');
function fmtVlans(list) {
  if (list === null) return 'all';
  if (!list.length) return 'none';
  const a = [...list].sort((x, y) => x - y), out = [];
  for (let i = 0; i < a.length; i++) {
    let j = i; while (j + 1 < a.length && a[j + 1] === a[j] + 1) j++;
    out.push(j > i + 1 ? a[i] + '-' + a[j] : j === i + 1 ? a[i] + ',' + a[j] : String(a[i])); i = j;
  }
  return out.join(',');
}
function parseVlist(s) {
  const out = new Set();
  for (const part of s.split(',')) {
    const [a, b] = part.split('-').map(Number);
    for (let v = a; v <= (b || a); v++) if (v >= 1 && v <= 4094) out.add(v);
  }
  return [...out].sort((x, y) => x - y);
}
function ifSort(a, b) { return a.localeCompare(b, 'en', { numeric: true }); }
function runningConfig(d) {
  if (d.kind === 'pc') return '';
  const L = ['!', 'version 15.9', 'service timestamps debug datetime msec', 'service timestamps log datetime msec'];
  L.push(d.pwEnc ? 'service password-encryption' : 'no service password-encryption', '!', 'hostname ' + d.hostname, '!');
  if (d.enableSecret) L.push('enable secret ' + secretStr(d.enableSecret));
  if (d.enablePass) L.push('enable password ' + (d.pwEnc ? type7(d.enablePass) : d.enablePass));
  if (d.enableSecret || d.enablePass) L.push('!');
  if (d.noLookup) L.push('no ip domain lookup');
  if (d.domain) L.push('ip domain name ' + d.domain);
  if (d.v6routing) L.push('ipv6 unicast-routing');
  if (d.noLookup || d.domain || d.v6routing) L.push('!');
  for (const [u, x] of Object.entries(d.users)) L.push('username ' + u + (x.priv != null ? ' privilege ' + x.priv : '') + (x.secret ? ' secret ' + secretStr(x.secret) : ' password ' + (d.pwEnc ? type7(x.pass) : '0 ' + x.pass)));
  if (Object.keys(d.users).length) L.push('!');
  if (d.kind === 'switch') L.push('spanning-tree mode pvst', 'spanning-tree extend system-id', '!');
  const names = Object.keys(d.ifaces).sort((a, b) => (a.startsWith('Vlan') - b.startsWith('Vlan')) || ifSort(a, b));
  for (const n of names) {
    const i = d.ifaces[n];
    L.push('interface ' + n);
    if (i.desc) L.push(' description ' + i.desc);
    if (d.kind === 'switch' && !i.svi) {
      if (i.vlan !== 1) L.push(' switchport access vlan ' + i.vlan);
      if (i.native !== 1) L.push(' switchport trunk native vlan ' + i.native);
      if (i.allowed !== null) L.push(' switchport trunk allowed vlan ' + fmtVlans(i.allowed));
      if (i.mode !== 'dynamic') L.push(' switchport mode ' + i.mode);
      if (i.nonego) L.push(' switchport nonegotiate');
      if (i.portfast) L.push(' spanning-tree portfast');
    } else {
      L.push(i.ip ? ' ip address ' + i.ip + ' ' + i.mask : ' no ip address');
      if (i.ospf) L.push(' ip ospf ' + i.ospf.pid + ' area ' + i.ospf.area);
      for (const v of (i.v6 || [])) L.push(' ipv6 address ' + v.toUpperCase());
    }
    if (i.shut) L.push(' shutdown');
    L.push('!');
  }
  for (const pr of Object.values(d.ospf)) {
    L.push('router ospf ' + pr.pid);
    if (pr.rid) L.push(' router-id ' + pr.rid);
    for (const p of pr.passive) L.push(' passive-interface ' + p);
    for (const nw of pr.nets) L.push(' network ' + nw.ip + ' ' + nw.wild + ' area ' + nw.area);
    L.push('!');
  }
  if (d.gw) L.push('ip default-gateway ' + d.gw);
  for (const r of d.routes) L.push('ip route ' + r.net + ' ' + r.mask + ' ' + (r.iface || r.nh) + (r.ad !== 1 ? ' ' + r.ad : ''));
  if (d.sshVer) L.push('ip ssh version ' + d.sshVer);
  L.push('!');
  if (d.banner) L.push('banner motd ' + d.banner, '!');
  for (const k of ['con', 'vty']) {
    const ln = d.lines[k];
    L.push('line ' + k + ' ' + ln.range);
    if (ln.timeout) L.push(' exec-timeout ' + ln.timeout);
    if (ln.pass) L.push(' password ' + (d.pwEnc ? type7(ln.pass) : ln.pass));
    if (ln.sync) L.push(' logging synchronous');
    if (ln.login === 'local') L.push(' login local'); else if (ln.login === 'line') L.push(' login');
    if (ln.transport) L.push(' transport input ' + ln.transport);
  }
  L.push('!', 'end');
  return L.join('\n');
}

/* ===== Command grammar ===== */
const PT = {
  ip: { v: t => isIp(t) ? t : null, h: 'A.B.C.D' },
  num: { v: t => /^\d+$/.test(t) ? t : null, h: '<0-4294967295>' },
  vlan: { v: t => /^\d+$/.test(t) && +t >= 1 && +t <= 4094 ? t : null, h: '<1-4094>  VLAN ID' },
  word: { v: t => t ? t : null, h: 'WORD' },
  line: { h: 'LINE' },
  if: { v: t => canonIf(t), h: 'Interface name (例: GigabitEthernet0/0)' },
  v6: { v: t => isV6Prefix(t) ? t : null, h: 'X:X:X:X::X/<0-128>  IPv6 prefix' },
  vlist: { v: t => /^\d+(-\d+)?(,\d+(-\d+)?)*$/.test(t) ? t : null, h: 'WORD  VLAN IDs of the allowed VLANs' }
};
const KH = {
  enable: 'Turn on privileged commands', disable: 'Turn off privileged commands', exit: 'Exit from the EXEC / current mode', logout: 'Exit from the EXEC',
  configure: 'Enter configuration mode', terminal: 'Configure from the terminal', ping: 'Send echo messages', show: 'Show running system information',
  copy: 'Copy from one file to another', 'running-config': 'Current operating configuration', 'startup-config': 'Contents of startup configuration',
  write: 'Write running configuration to memory', memory: 'Write to NV memory',
  ip: 'IP information / configuration', ipv6: 'IPv6 information / configuration', interface: 'Select an interface to configure', brief: 'Brief summary',
  route: 'IP routing table / Establish static routes', vlan: 'VLAN commands', interfaces: 'Interface status and configuration', trunk: 'Show interface trunk information',
  version: 'System hardware and software status', history: 'Display the session command history', ospf: 'OSPF information / Open Shortest Path First (OSPF)', neighbor: 'Neighbor list', ssh: 'Information on SSH / Configure ssh options',
  hostname: 'Set system\'s network name', router: 'Enable a routing process', 'unicast-routing': 'Enable unicast routing', no: 'Negate a command or set its defaults',
  secret: 'Assign the privileged level secret / Specify the secret for the user', password: 'Assign the privileged level password / Set a password',
  'domain-name': 'Define the default domain name', domain: 'IP DNS Resolver', name: 'Define the default domain name / Ascii name of the VLAN', 'domain-lookup': 'Enable IP Domain Name System hostname translation',
  crypto: 'Encryption module', key: 'Long term key operations', generate: 'Generate new keys', rsa: 'Generate RSA keys', modulus: 'Provide number of modulus bits on the command line', 'general-keys': 'Generate a general purpose RSA key pair', zeroize: 'Remove keys',
  username: 'Establish User Name Authentication', privilege: 'Set user privilege level', line: 'Configure a terminal line', vty: 'Virtual terminal', console: 'Primary terminal line',
  'default-gateway': 'Specify default gateway (if not routing IP)', service: 'Modify use of network based services', 'password-encryption': 'Encrypt system passwords',
  banner: 'Define a login banner', motd: 'Set Message of the Day banner', end: 'Exit to privileged EXEC mode', do: 'To run exec commands in config mode',
  address: 'Set the IP address of an interface / Configure IPv6 address on interface', shutdown: 'Shutdown the selected interface', description: 'Interface specific description',
  switchport: 'Set switching mode characteristics', mode: 'Set trunking mode of the interface', access: 'Set access mode characteristics of the interface',
  allowed: 'Set allowed VLAN characteristics when interface is in trunking mode', native: 'Set trunking native characteristics when interface is in trunking mode',
  add: 'add VLANs to the current list', remove: 'remove VLANs from the current list', all: 'all VLANs', none: 'no VLANs', nonegotiate: 'Device will not engage in negotiation protocol on this interface',
  'spanning-tree': 'Spanning Tree Subsystem', portfast: 'Portfast options for the interface', area: 'Set the OSPF area ID',
  'router-id': 'router-id for this OSPF process', network: 'Enable routing on an IP network', 'passive-interface': 'Suppress routing updates on an interface',
  login: 'Enable password checking', local: 'Local password checking', transport: 'Define transport protocols for line', input: 'Define which protocols to use when connecting to the terminal server',
  telnet: 'TCP/IP Telnet protocol', 'exec-timeout': 'Set the EXEC timeout', logging: 'Modify message logging facilities', synchronous: 'Synchronized message output'
};

const CMDS = [];
function C(modes, pat, fn, when) {
  const seq = pat.split(' ').map(x => x[0] === '<' ? { p: x.slice(1, -1) } : { k: x });
  for (const m of modes.split(' ')) CMDS.push({ mode: m, pat, seq, fn, when });
}
const isR = d => d.kind === 'router', isS = d => d.kind === 'switch';
const L3IF = d => d.kind === 'router' || isSvi(d);
const SWPORT = d => d.kind === 'switch' && !isSvi(d);
const R_IF = d => d.kind === 'router' && !isSvi(d);
const CFG = 'config if router line vlan';
const SUBMODES = ['if', 'router', 'line', 'vlan'];
const CONFIG_I = '%SYS-5-CONFIG_I: Configured from console by console';

function tokenize(line) {
  const out = []; const re = /\S+/g; let m;
  while ((m = re.exec(line))) out.push({ t: m[0], off: m.index });
  for (let i = 0; i < out.length - 1; i++) {
    const a = out[i].t, b = out[i + 1].t, prev = i > 0 ? out[i - 1].t.toLowerCase() : '';
    if (!/^[a-z]+$/i.test(a) || !/^\d+(\/\d+){0,2}$/.test(b)) continue;
    const ctx = b.includes('/') || (prev.length >= 3 && ('interface'.startsWith(prev) || 'passive-interface'.startsWith(prev)));
    if (ctx && canonIf(a + b)) { out[i] = { t: a + b, off: out[i].off }; out.splice(i + 1, 1); }
  }
  return out;
}
function walk(cmds, toks) {
  let cands = cmds.map(c => ({ c, args: [], done: false }));
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i].t, tl = t.toLowerCase(), next = [];
    for (const cd of cands) {
      if (cd.done) { next.push({ cd, how: 'pass' }); continue; }
      const sp = cd.c.seq[i]; if (!sp) continue;
      if (sp.k) {
        if (sp.k === tl) next.push({ cd, how: 'exact', kw: sp.k });
        else if (sp.k.startsWith(tl)) next.push({ cd, how: 'prefix', kw: sp.k });
      } else if (sp.p === 'line') {
        next.push({ cd: { ...cd, args: [...cd.args, toks.slice(i).map(x => x.t).join(' ')], done: true }, how: 'param' });
      } else {
        const v = PT[sp.p].v(t);
        if (v != null) next.push({ cd: { ...cd, args: [...cd.args, v] }, how: 'param' });
      }
    }
    let keep = next;
    if (next.some(n => n.how === 'exact')) keep = next.filter(n => n.how !== 'prefix');
    else {
      const kws = new Set(next.filter(n => n.how === 'prefix').map(n => n.kw));
      if (kws.size > 1) return { err: 'ambiguous', pos: i };
    }
    if (!keep.length) return { err: 'invalid', pos: i };
    cands = keep.map(n => n.cd);
  }
  return { cands };
}
function match(cmds, toks) {
  const w = walk(cmds, toks); if (w.err) return w;
  const done = w.cands.filter(cd => cd.done || cd.c.seq.length === toks.length);
  if (!done.length) return { err: 'incomplete' };
  return { cmd: done[0].c, args: done[0].args };
}
function cmdsFor(d) { return CMDS.filter(c => c.mode === d.mode && (!c.when || c.when(d))); }

function prompt(d) {
  if (d.kind === 'pc') return 'C:\\>';
  if (d.pending) return '';
  const h = d.hostname;
  return { user: h + '>', priv: h + '#', config: h + '(config)#', if: h + '(config-if)#', router: h + '(config-router)#', line: h + '(config-line)#', vlan: h + '(config-vlan)#' }[d.mode];
}
const MODE_JA = { user: 'ユーザーEXECモード', priv: '特権EXECモード', config: 'グローバルコンフィグレーションモード', if: 'インターフェイスコンフィグレーションモード', router: 'ルーターコンフィグレーションモード', line: 'ラインコンフィグレーションモード', vlan: 'VLANコンフィグレーションモード' };
const MODE_HINT = { user: '確認用コマンドを実行できます', priv: '設定の確認・保存ができます', config: '機器全体の設定を変更します', if: 'インターフェイスの設定を変更します', router: 'ルーティングプロトコルを設定します', line: 'VTY・コンソール回線を設定します', vlan: 'VLANの名前を設定します' };

function execLine(s, d, raw) {
  if (d.kind === 'pc') return pcExec(s, d, raw);
  if (d.pending) { const p = d.pending; d.pending = null; return p(raw.trim()) || ''; }
  const toks = tokenize(raw); if (!toks.length) return '';
  let r = match(cmdsFor(d), toks);
  if (r.err && SUBMODES.includes(d.mode)) {
    const keep = { mode: d.mode, ctx: d.ctx };
    d.mode = 'config'; d.ctx = null;
    const r2 = match(cmdsFor(d), toks);
    if (!r2.err) return r2.cmd.fn(d, r2.args, s) || '';
    d.mode = keep.mode; d.ctx = keep.ctx;
  }
  if (r.err) return errText(r, d, raw, toks);
  return r.cmd.fn(d, r.args, s) || '';
}
function errText(r, d, raw, toks) {
  if (r.err === 'incomplete') return '% Incomplete command.';
  if (r.err === 'ambiguous') return '% Ambiguous command:  "' + raw.trim() + '"';
  if (r.pos === 0 && (d.mode === 'user' || d.mode === 'priv')) return 'Translating "' + toks[0].t + '"\n% Unknown command or computer name, or unable to find computer address';
  return ' '.repeat(prompt(d).length + toks[r.pos].off) + '^\n% Invalid input detected at \'^\' marker.';
}

/* ? help / Tab completion */
function helpOrComplete(d, raw, completeOnly) {
  if (d.kind === 'pc' || d.pending) return completeOnly ? null : '';
  const endsSpace = /\s$/.test(raw) || raw === '';
  const toks = tokenize(raw);
  const partial = endsSpace ? '' : (toks.pop() || { t: '' }).t;
  const sources = [cmdsFor(d)];
  if (SUBMODES.includes(d.mode)) { const m = d.mode; d.mode = 'config'; sources.push(cmdsFor(d)); d.mode = m; }
  const opts = new Map(); let cr = false, okAny = false;
  for (const cmds of sources) {
    const w = walk(cmds, toks); if (w.err) continue; okAny = true;
    for (const cd of w.cands) {
      if (cd.done) continue;
      const sp = cd.c.seq[toks.length];
      if (!sp) { if (!partial) cr = true; continue; }
      if (sp.k) { if (sp.k.startsWith(partial.toLowerCase())) opts.set(sp.k, KH[sp.k] || ''); }
      else if (!partial) opts.set(PT[sp.p].h, '');
    }
    if (opts.size || cr) break;
  }
  if (completeOnly) {
    const kws = [...opts.keys()].filter(k => !/[ <A-Z]/.test(k));
    if (partial && kws.length === 1) return raw.slice(0, raw.length - partial.length) + kws[0] + ' ';
    return null;
  }
  if (!okAny || (!opts.size && !cr)) return '% Unrecognized command';
  if (partial) return [...opts.keys()].join('  ');
  const w = Math.max(...[...opts.keys()].map(k => k.length), 4) + 2;
  const lines = [...opts.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k, h]) => '  ' + k.padEnd(w) + h);
  if (cr) lines.push('  <cr>');
  return lines.join('\n');
}

/* ===== Commands: EXEC ===== */
C('user', 'enable', d => { d.mode = 'priv'; });
C('priv', 'disable', d => { d.mode = 'user'; });
for (const w of ['exit', 'logout']) C('user priv', w, d => { d.mode = 'user'; return '\n' + d.hostname + ' con0 is now available\n\nPress RETURN to get started.'; });
C('priv', 'configure terminal', d => { d.mode = 'config'; return 'Enter configuration commands, one per line.  End with CNTL/Z.'; });
C('user priv', 'ping <ip>', (d, [ip], s) => iosPing(s, d, ip));
function save(d) { d.startup = runningConfig(d); return 'Building configuration...\n[OK]'; }
C('priv', 'copy running-config startup-config', d => { d.pending = () => save(d); return 'Destination filename [startup-config]? '; });
C('priv', 'write memory', d => save(d));
C('priv', 'write', d => save(d));
C('priv', 'show running-config', d => { const t = runningConfig(d); return 'Building configuration...\n\nCurrent configuration : ' + t.length + ' bytes\n' + t; });
C('priv', 'show startup-config', d => d.startup ? 'Using ' + d.startup.length + ' out of 262144 bytes\n' + d.startup : 'startup-config is not present');
C('user priv', 'show ip interface brief', (d, a, s) => {
  const rows = [['Interface', 'IP-Address', 'OK?', 'Method', 'Status', 'Protocol']];
  for (const n of Object.keys(d.ifaces).sort((a, b) => (a.startsWith('Vlan') - b.startsWith('Vlan')) || ifSort(a, b))) {
    const i = d.ifaces[n], up = ifUp(s, d, n);
    rows.push([n, i.ip || 'unassigned', 'YES', i.ip ? 'manual' : 'unset', i.shut ? 'administratively down' : up ? 'up' : 'down', up ? 'up' : 'down']);
  }
  return rows.map(r => r[0].padEnd(23) + r[1].padEnd(16) + r[2].padEnd(4) + r[3].padEnd(7) + r[4].padEnd(22) + r[5]).join('\n');
});
C('user priv', 'show ip route', (d, a, s) => {
  const rt = routeTable(s, d).sort((x, y) => (ip2n(x.net) - ip2n(y.net)) || (x.len - y.len));
  const def = rt.find(r => r.len === 0);
  const head = 'Codes: L - local, C - connected, S - static, O - OSPF, * - candidate default\n\n' +
    'Gateway of last resort is ' + (def ? (def.nh || def.iface) + ' to network 0.0.0.0' : 'not set') + '\n';
  const body = rt.map(r => {
    const code = (r.code + (r.len === 0 ? '*' : '')).padEnd(9);
    if (r.code === 'C' || r.code === 'L' || r.direct) return code + r.net + '/' + r.len + ' is directly connected, ' + r.iface;
    if (r.code === 'O') return code + r.net + '/' + r.len + ' [110/' + r.metric + '] via ' + r.nh + ', 00:01:2' + r.metric + ', ' + r.iface;
    return code + r.net + '/' + r.len + ' [' + r.ad + '/0] via ' + r.nh;
  });
  return head + '\n' + body.join('\n');
}, isR);
C('user priv', 'show ipv6 interface brief', (d, a, s) => Object.keys(d.ifaces).sort(ifSort).map(n => {
  const i = d.ifaces[n], up = ifUp(s, d, n);
  const st = '[' + (i.shut ? 'administratively down/down' : up ? 'up/up' : 'down/down') + ']';
  const addrs = (i.v6 || []).length ? ['FE80::' + (n.length * 7 + 0x2a).toString(16).toUpperCase(), ...i.v6.map(v => v.split('/')[0].toUpperCase())] : ['unassigned'];
  return n.padEnd(23) + st + '\n' + addrs.map(x => '    ' + x).join('\n');
}).join('\n'), isR);
C('user priv', 'show vlan brief', d => {
  const head = 'VLAN Name                             Status    Ports\n---- -------------------------------- --------- -------------------------------';
  const ids = Object.keys(d.vlans).map(Number).sort((a, b) => a - b);
  const rows = ids.map(v => {
    const ports = Object.entries(d.ifaces).filter(([, p]) => !p.svi && !isTrunk(p) && p.vlan === v).map(([n]) => shortIf(n)).sort(ifSort);
    const chunks = []; for (let i = 0; i < ports.length; i += 4) chunks.push(ports.slice(i, i + 4).join(', '));
    const first = String(v).padEnd(5) + d.vlans[v].padEnd(33) + 'active    ' + (chunks[0] || '');
    return [first, ...chunks.slice(1).map(c => ' '.repeat(48) + c)].join('\n');
  });
  const tail = ['1002 fddi-default                     act/unsup ', '1003 token-ring-default               act/unsup ', '1004 fddinet-default                  act/unsup ', '1005 trnet-default                    act/unsup '];
  return head + '\n' + rows.join('\n') + '\n' + tail.join('\n');
}, isS);
C('user priv', 'show interfaces trunk', (d, a, s) => {
  const tr = Object.entries(d.ifaces).filter(([n, p]) => !p.svi && isTrunk(p) && ifUp(s, d, n)).sort(([a], [b]) => ifSort(a, b));
  if (!tr.length) return '';
  const active = p => (p.allowed === null ? Object.keys(d.vlans).map(Number) : p.allowed.filter(v => d.vlans[v])).filter(v => v < 1002);
  return 'Port        Mode             Encapsulation  Status        Native vlan\n' +
    tr.map(([n, p]) => shortIf(n).padEnd(12) + 'on'.padEnd(17) + '802.1q'.padEnd(15) + 'trunking'.padEnd(14) + p.native).join('\n') +
    '\n\nPort        Vlans allowed on trunk\n' + tr.map(([n, p]) => shortIf(n).padEnd(12) + (p.allowed === null ? '1-4094' : fmtVlans(p.allowed))).join('\n') +
    '\n\nPort        Vlans allowed and active in management domain\n' + tr.map(([n, p]) => shortIf(n).padEnd(12) + (fmtVlans(active(p)) || 'none')).join('\n');
}, isS);
C('user priv', 'show ip ospf neighbor', (d, a, s) => {
  const nb = ospfNeighbors(s, d); if (!nb.length) return '';
  const me = routerId(s, d);
  return '\nNeighbor ID     Pri   State           Dead Time   Address         Interface\n' +
    nb.map(n => n.rid.padEnd(16) + '1'.padEnd(6) + ('FULL/' + (ip2n(n.rid) > ip2n(me) ? 'DR' : 'BDR')).padEnd(16) + '00:00:3' + (n.rid.length % 10) + '    ' + n.ip.padEnd(16) + n.localIf).join('\n');
}, isR);
C('user priv', 'show ip protocols', d => {
  const ps = Object.values(d.ospf); if (!ps.length) return '';
  return ps.map(pr => '*** IP Routing is NSF aware ***\n\nRouting Protocol is "ospf ' + pr.pid + '"\n  Router ID ' + (pr.rid || '(未設定)') +
    '\n  Number of areas in this router is 1. 1 normal 0 stub 0 nssa\n  Routing for Networks:\n' + (pr.nets.map(n => '    ' + n.ip + ' ' + n.wild + ' area ' + n.area).join('\n') || '    (なし)') +
    (pr.passive.length ? '\n  Passive Interface(s):\n' + pr.passive.map(p => '    ' + p).join('\n') : '') + '\n  Distance: (default is 110)').join('\n\n');
}, isR);
C('user priv', 'show ip ssh', d => {
  if (!d.rsa) return 'SSH Disabled - version 1.99\n%Please create RSA keys to enable SSH (and of atleast 768 bits for SSH v2).';
  return 'SSH Enabled - version ' + (d.sshVer === '2' ? '2.0' : '1.99') + '\nAuthentication methods:publickey,keyboard-interactive,password\nAuthentication timeout: 120 secs; Authentication retries: 3';
}, isR);
C('user priv', 'show version', d => 'Cisco IOS Software [Simulated], ' + (isR(d) ? 'ISR4300' : 'C2960') + ' Software, Version 15.9\n' +
  'このデモ用に簡略化したシミュレーターです。\n\n' + d.hostname + ' uptime is 3 minutes\nSystem image file is "flash:sim.bin"');
C('user priv', 'show history', d => d.hist.slice(-10).map(x => '  ' + x).join('\n'));

/* ===== Commands: global config ===== */
C(CFG, 'end', d => { d.mode = 'priv'; d.ctx = null; return CONFIG_I; });
C('config', 'exit', d => { d.mode = 'priv'; return CONFIG_I; });
C('if router line vlan', 'exit', d => { d.mode = 'config'; d.ctx = null; });
C(CFG, 'do <line>', (d, [line], s) => {
  const m = d.mode, ctx = d.ctx; d.mode = 'priv';
  const out = execLine(s, d, line);
  d.mode = m; d.ctx = ctx; return out;
});
C('config', 'hostname <word>', (d, [h]) => { d.hostname = h; });
C('config', 'interface <if>', (d, [n]) => {
  if (!d.ifaces[n]) {
    if (isS(d) && /^Vlan\d+$/.test(n)) { const id = +n.slice(4); d.ifaces[n] = { svi: true, vlanId: id, shut: false, ip: null, mask: null, desc: '' }; }
    else if (isR(d) && /^Loopback\d+$/.test(n)) d.ifaces[n] = { shut: false, loop: true, ip: null, mask: null, v6: [], desc: '', ospf: null };
    else return '                    ^\n% Invalid input detected at \'^\' marker.';
  }
  d.mode = 'if'; d.ctx = { if: n };
});
function addRoute(d, net, mask, hop, ad) {
  if (!isMask(mask)) return '%Inconsistent address and mask';
  if (netOf(net, maskLen(mask)) !== net) return '%Inconsistent address and mask';
  const r = { net, mask, ad: ad == null ? 1 : +ad };
  if (isIp(hop)) r.nh = hop; else { if (!d.ifaces[hop]) return '% Invalid interface'; r.iface = hop; }
  d.routes = d.routes.filter(x => !(x.net === net && x.mask === mask && (x.nh || x.iface) === (r.nh || r.iface)));
  d.routes.push(r);
}
function delRoute(d, net, mask, hop) {
  const before = d.routes.length;
  d.routes = d.routes.filter(x => !(x.net === net && x.mask === mask && (!hop || (x.nh || x.iface) === hop)));
  if (before === d.routes.length) return '%No matching route to delete';
}
C('config', 'ip route <ip> <ip> <ip>', (d, [n, m, h]) => addRoute(d, n, m, h), isR);
C('config', 'ip route <ip> <ip> <ip> <num>', (d, [n, m, h, ad]) => addRoute(d, n, m, h, ad), isR);
C('config', 'ip route <ip> <ip> <if>', (d, [n, m, h]) => addRoute(d, n, m, h), isR);
C('config', 'ip route <ip> <ip> <if> <num>', (d, [n, m, h, ad]) => addRoute(d, n, m, h, ad), isR);
C('config', 'no ip route <ip> <ip>', (d, [n, m]) => delRoute(d, n, m), isR);
C('config', 'no ip route <ip> <ip> <ip>', (d, [n, m, h]) => delRoute(d, n, m, h), isR);
C('config', 'no ip route <ip> <ip> <ip> <num>', (d, [n, m, h]) => delRoute(d, n, m, h), isR);
C('config', 'no ip route <ip> <ip> <if>', (d, [n, m, h]) => delRoute(d, n, m, h), isR);
C('config', 'ipv6 unicast-routing', d => { d.v6routing = true; }, isR);
C('config', 'no ipv6 unicast-routing', d => { d.v6routing = false; }, isR);
C('config', 'router ospf <num>', (d, [pid]) => {
  if (+pid < 1 || +pid > 65535) return '% Invalid input detected';
  if (!d.ospf[pid]) d.ospf[pid] = { pid, rid: null, nets: [], passive: [] };
  d.mode = 'router'; d.ctx = { pid };
}, isR);
C('config', 'no router ospf <num>', (d, [pid]) => { delete d.ospf[pid]; for (const i of Object.values(d.ifaces)) if (i.ospf && i.ospf.pid === pid) i.ospf = null; }, isR);
C('config', 'enable secret <word>', (d, [v]) => { d.enableSecret = v; });
C('config', 'enable password <word>', (d, [v]) => { d.enablePass = v; });
C('config', 'no enable secret', d => { d.enableSecret = null; });
C('config', 'no enable password', d => { d.enablePass = null; });
C('config', 'ip domain-name <word>', (d, [v]) => { d.domain = v; });
C('config', 'ip domain name <word>', (d, [v]) => { d.domain = v; });
C('config', 'no ip domain-name', d => { d.domain = null; });
C('config', 'no ip domain-lookup', d => { d.noLookup = true; });
C('config', 'no ip domain lookup', d => { d.noLookup = true; });
C('config', 'ip domain-lookup', d => { d.noLookup = false; });
function genKeys(d, bits) {
  bits = +bits;
  if (bits < 360 || bits > 4096) return '% Key modulus size must be between 360 and 4096';
  const fresh = !d.rsa; d.rsa = bits;
  return '% The key modulus size is ' + bits + ' bits\n% Generating ' + bits + ' bit RSA keys, keys will be non-exportable...\n[OK] (elapsed time was 1 seconds)\n' + (fresh ? '\n%SSH-5-ENABLED: SSH 1.99 has been enabled' : '');
}
function keyPre(d) {
  if (d.hostname === 'Router' || d.hostname === 'Switch') return '% Please define a hostname other than ' + d.hostname + '.';
  if (!d.domain) return '% Please define a domain-name first.';
  return null;
}
const keyName = d => 'The name for the keys will be: ' + d.hostname + '.' + d.domain;
C('config', 'crypto key generate rsa', d => {
  const e = keyPre(d); if (e) return e;
  d.pending = v => genKeys(d, v === '' ? 512 : v);
  return keyName(d) + '\nChoose the size of the key modulus in the range of 360 to 4096 for your\n  General Purpose Keys. Choosing a key modulus greater than 512 may take\n  a few minutes.\n\nHow many bits in the modulus [512]: ';
}, isR);
for (const p of ['crypto key generate rsa modulus <num>', 'crypto key generate rsa general-keys modulus <num>'])
  C('config', p, (d, [b]) => { const e = keyPre(d); if (e) return e; return keyName(d) + '\n\n' + genKeys(d, b); }, isR);
C('config', 'crypto key zeroize rsa', d => { d.rsa = 0; d.sshVer = null; return '%SSH-5-DISABLED: SSH 1.99 has been disabled'; }, isR);
C('config', 'username <word> secret <word>', (d, [u, v]) => { d.users[u] = { secret: v, priv: d.users[u]?.priv ?? null }; });
C('config', 'username <word> password <word>', (d, [u, v]) => { d.users[u] = { pass: v, priv: d.users[u]?.priv ?? null }; });
C('config', 'username <word> privilege <num> secret <word>', (d, [u, p, v]) => { d.users[u] = { secret: v, priv: p }; });
C('config', 'no username <word>', (d, [u]) => { delete d.users[u]; });
C('config', 'ip ssh version <num>', (d, [v]) => {
  if (v !== '1' && v !== '2') return '% Invalid input detected';
  if (!d.rsa) return 'Please create RSA keys to enable SSH (and of atleast 768 bits for SSH v2).';
  if (v === '2' && d.rsa < 768) return 'Please create RSA keys (of atleast 768 bits size) to enable SSH v2.';
  d.sshVer = v;
}, isR);
C('config', 'line vty <num> <num>', (d, [a, b]) => { d.lines.vty.range = a + ' ' + b; d.mode = 'line'; d.ctx = { line: 'vty' }; });
C('config', 'line vty <num>', (d, [a]) => { d.mode = 'line'; d.ctx = { line: 'vty' }; });
C('config', 'line console <num>', d => { d.mode = 'line'; d.ctx = { line: 'con' }; });
C('config', 'vlan <vlan>', (d, [v]) => { if (!d.vlans[v]) d.vlans[v] = 'VLAN' + String(v).padStart(4, '0'); d.mode = 'vlan'; d.ctx = { vlan: +v }; }, isS);
C('config', 'no vlan <vlan>', (d, [v]) => { if (+v === 1) return '%Default VLAN 1 may not be deleted.'; delete d.vlans[v]; }, isS);
C('config', 'ip default-gateway <ip>', (d, [g]) => { d.gw = g; }, isS);
C('config', 'service password-encryption', d => { d.pwEnc = true; });
C('config', 'no service password-encryption', d => { d.pwEnc = false; });
C('config', 'banner motd <line>', (d, [t]) => { d.banner = t; });

/* ===== Commands: interface ===== */
C('if', 'ip address <ip> <ip>', (d, [ip, m], s) => {
  if (!isMask(m) || maskLen(m) === 0) return '% Bad mask /' + maskLen(m) + ' for address ' + ip;
  const len = maskLen(m);
  if (len < 31 && (ip === netOf(ip, len) || ip2n(ip) === (ip2n(netOf(ip, len)) | (~lenToMask(len) >>> 0)) >>> 0)) return '% Bad mask /' + len + ' for address ' + ip;
  for (const [n, i] of Object.entries(d.ifaces)) {
    if (n === d.ctx.if || !i.ip) continue;
    const l2 = Math.min(len, maskLen(i.mask));
    if (inNet(ip, i.ip, l2)) return '% ' + netOf(ip, len) + ' overlaps with ' + n;
  }
  Object.assign(curIf(d), { ip, mask: m });
}, L3IF);
C('if', 'no ip address', d => { Object.assign(curIf(d), { ip: null, mask: null }); }, L3IF);
C('if', 'ipv6 address <v6>', (d, [v]) => { const i = curIf(d); if (!i.v6.some(x => v6Eq(x, v))) i.v6.push(v); }, R_IF);
C('if', 'no ipv6 address <v6>', (d, [v]) => { const i = curIf(d); i.v6 = i.v6.filter(x => !v6Eq(x, v)); }, R_IF);
C('if', 'no ipv6 address', d => { curIf(d).v6 = []; }, R_IF);
C('if', 'ip ospf <num> area <num>', (d, [pid, area]) => {
  if (!d.ospf[pid]) d.ospf[pid] = { pid, rid: null, nets: [], passive: [] };
  curIf(d).ospf = { pid, area: String(+area) };
}, R_IF);
C('if', 'no ip ospf <num> area <num>', d => { curIf(d).ospf = null; }, R_IF);
C('if', 'shutdown', d => { curIf(d).shut = true; });
C('if', 'no shutdown', d => { curIf(d).shut = false; });
C('if', 'description <line>', (d, [t]) => { curIf(d).desc = t; });
C('if', 'no description', d => { curIf(d).desc = ''; });
C('if', 'switchport mode access', d => { curIf(d).mode = 'access'; }, SWPORT);
C('if', 'switchport mode trunk', d => { curIf(d).mode = 'trunk'; }, SWPORT);
C('if', 'switchport access vlan <vlan>', (d, [v]) => {
  curIf(d).vlan = +v;
  if (!d.vlans[v]) { d.vlans[v] = 'VLAN' + String(v).padStart(4, '0'); return '% Access VLAN does not exist. Creating vlan ' + v; }
}, SWPORT);
C('if', 'no switchport access vlan', d => { curIf(d).vlan = 1; }, SWPORT);
C('if', 'switchport trunk native vlan <vlan>', (d, [v]) => { curIf(d).native = +v; }, SWPORT);
C('if', 'switchport trunk allowed vlan <vlist>', (d, [l]) => { curIf(d).allowed = parseVlist(l); }, SWPORT);
C('if', 'switchport trunk allowed vlan add <vlist>', (d, [l]) => { const p = curIf(d); if (p.allowed !== null) p.allowed = parseVlist([...p.allowed, ...parseVlist(l)].join(',')); }, SWPORT);
C('if', 'switchport trunk allowed vlan remove <vlist>', (d, [l]) => {
  const p = curIf(d), rm = parseVlist(l);
  const base = p.allowed === null ? Array.from({ length: 4094 }, (_, i) => i + 1) : p.allowed;
  p.allowed = base.filter(v => !rm.includes(v));
}, SWPORT);
C('if', 'switchport trunk allowed vlan all', d => { curIf(d).allowed = null; }, SWPORT);
C('if', 'switchport trunk allowed vlan none', d => { curIf(d).allowed = []; }, SWPORT);
C('if', 'switchport nonegotiate', d => { if (curIf(d).mode === 'dynamic') return 'Command rejected: Conflict between \'nonegotiate\' and \'dynamic\' status.'; curIf(d).nonego = true; }, SWPORT);
C('if', 'spanning-tree portfast', d => { curIf(d).portfast = true; return '%Warning: portfast should only be enabled on ports connected to a single\n host. Connecting hubs, concentrators, switches, bridges, etc... to this\n interface  when portfast is enabled, can cause temporary bridging loops.\n Use with CAUTION'; }, SWPORT);

/* ===== Commands: router ospf ===== */
const proc = d => d.ospf[d.ctx.pid];
C('router', 'router-id <ip>', (d, [ip]) => { proc(d).rid = ip; });
C('router', 'no router-id', d => { proc(d).rid = null; });
C('router', 'network <ip> <ip> area <num>', (d, [ip, w, a]) => {
  const pr = proc(d); a = String(+a);
  if (!pr.nets.some(n => n.ip === ip && n.wild === w)) pr.nets.push({ ip, wild: w, area: a });
});
C('router', 'no network <ip> <ip> area <num>', (d, [ip, w]) => { const pr = proc(d); pr.nets = pr.nets.filter(n => !(n.ip === ip && n.wild === w)); });
C('router', 'passive-interface <if>', (d, [n]) => { if (!d.ifaces[n]) return '% Invalid interface'; const pr = proc(d); if (!pr.passive.includes(n)) pr.passive.push(n); });
C('router', 'no passive-interface <if>', (d, [n]) => { const pr = proc(d); pr.passive = pr.passive.filter(x => x !== n); });

/* ===== Commands: line ===== */
const ln = d => d.lines[d.ctx.line];
C('line', 'login local', d => { ln(d).login = 'local'; });
C('line', 'login', d => { ln(d).login = 'line'; if (!ln(d).pass) return '% Login disabled on line, until \'password\' is set'; });
C('line', 'no login', d => { ln(d).login = null; });
C('line', 'password <word>', (d, [p]) => { ln(d).pass = p; });
C('line', 'no password', d => { ln(d).pass = null; });
for (const t of ['ssh', 'telnet', 'all', 'none', 'ssh telnet', 'telnet ssh'])
  C('line', 'transport input ' + t, d => { ln(d).transport = t === 'telnet ssh' ? 'ssh telnet' : t; });
C('line', 'exec-timeout <num> <num>', (d, [m, sec]) => { ln(d).timeout = m + ' ' + sec; });
C('line', 'logging synchronous', d => { ln(d).sync = true; });

/* ===== Commands: vlan ===== */
C('vlan', 'name <word>', (d, [n]) => { d.vlans[d.ctx.vlan] = n; });

/* ===== ping output ===== */
function iosPing(s, d, ip) {
  const r = doPing(s, d.name, ip);
  s.lastPing = { src: d.name, dst: ip, ...r };
  const key = d.name + '>' + ip, first = !s.arp.has(key);
  let marks = '.....', rate = '0 percent (0/5)';
  if (r.ok) { s.arp.add(key); marks = first && !r.self ? '.!!!!' : '!!!!!'; rate = first && !r.self ? '80 percent (4/5), round-trip min/avg/max = 1/1/2 ms' : '100 percent (5/5), round-trip min/avg/max = 1/1/3 ms'; }
  else if (r.reason === 'noroute' && r.at === d.name) marks = 'UUUUU';
  return 'Type escape sequence to abort.\nSending 5, 100-byte ICMP Echos to ' + ip + ', timeout is 2 seconds:\n' + marks + '\nSuccess rate is ' + rate;
}
function pcExec(s, d, raw) {
  const t = raw.trim(); if (!t) return '';
  const [cmd, ...rest] = t.split(/\s+/); const c = cmd.toLowerCase();
  if (c === 'ipconfig') {
    const i = d.ifaces.eth0;
    return '\nEthernet adapter Ethernet0:\n\n   IPv4 Address. . . . . . . . . . . : ' + i.ip + '\n   Subnet Mask . . . . . . . . . . . : ' + i.mask + '\n   Default Gateway . . . . . . . . . : ' + (d.gw || '') + '\n';
  }
  if (c === 'ping') {
    const ip = rest.filter(x => !x.startsWith('-'))[0];
    if (!ip || !isIp(ip)) return 'Ping request could not find host ' + (ip || '') + '. Please check the name and try again.';
    const r = doPing(s, d.name, ip);
    s.lastPing = { src: d.name, dst: ip, ...r };
    const key = d.name + '>' + ip, first = !s.arp.has(key);
    if (r.ok) s.arp.add(key);
    const ttl = 128 - Math.max(0, Math.floor(r.links.length / 2) - 1);
    const lines = [0, 1, 2, 3].map(k => r.ok ? (first && k === 0 && !r.self ? 'Request timed out.' : 'Reply from ' + ip + ': bytes=32 time' + (r.self ? '<1' : '=' + (k + 1)) + 'ms TTL=' + (r.self ? 128 : ttl))
      : (r.reason === 'noroute' && r.at !== d.name ? 'Reply from ' + gwIp(s, r.at, d) + ': Destination host unreachable.' : 'Request timed out.'));
    const recv = lines.filter(x => x.startsWith('Reply from ' + ip)).length;
    return '\nPinging ' + ip + ' with 32 bytes of data:\n' + lines.join('\n') + '\n\nPing statistics for ' + ip + ':\n    Packets: Sent = 4, Received = ' + recv + ', Lost = ' + (4 - recv) + ' (' + (100 - recv * 25) + '% loss),';
  }
  if (c === 'help' || c === '?') return 'このデモのPCで使えるコマンド:\n  ipconfig        IP設定を表示\n  ping <IPアドレス>  疎通を確認\n  cls             画面をクリア';
  return '\'' + cmd + '\' is not recognized as an internal or external command,\noperable program or batch file.';
}
function gwIp(s, devName, pc) {
  const d = s.devices[devName];
  const c = connected(s, d).find(c => inNet(pc.ifaces.eth0.ip, c.net, c.len));
  return c ? c.ip : (pc.gw || '0.0.0.0');
}

/* ===== Status events (syslog) ===== */
function statusSnap(s) {
  const snap = { ifs: {}, nb: {} };
  for (const d of Object.values(s.devices)) {
    if (d.kind === 'pc') continue;
    for (const n of Object.keys(d.ifaces)) snap.ifs[d.name + '|' + n] = { up: ifUp(s, d, n), shut: d.ifaces[n].shut };
    if (d.kind === 'router') for (const nb of ospfNeighbors(s, d)) snap.nb[d.name + '|' + nb.rid + '|' + nb.localIf] = Object.values(d.ospf)[0]?.pid || '1';
  }
  return snap;
}
function statusEvents(before, after) {
  const ev = {};
  const push = (dev, t) => (ev[dev] = ev[dev] || []).push(t);
  for (const k of Object.keys(after.ifs)) {
    const a = before.ifs[k], b = after.ifs[k]; const [dev, n] = k.split('|');
    if (!a) continue;
    if (a.up !== b.up) {
      if (b.up) { if (!n.startsWith('Vlan')) push(dev, '%LINK-3-UPDOWN: Interface ' + n + ', changed state to up'); push(dev, '%LINEPROTO-5-UPDOWN: Line protocol on Interface ' + n + ', changed state to up'); }
      else {
        push(dev, b.shut ? '%LINK-5-CHANGED: Interface ' + n + ', changed state to administratively down' : '%LINK-3-UPDOWN: Interface ' + n + ', changed state to down');
        push(dev, '%LINEPROTO-5-UPDOWN: Line protocol on Interface ' + n + ', changed state to down');
      }
    }
  }
  for (const k of new Set([...Object.keys(before.nb), ...Object.keys(after.nb)])) {
    const [dev, rid, n] = k.split('|');
    if (!(k in before.nb)) push(dev, '%OSPF-5-ADJCHG: Process ' + after.nb[k] + ', Nbr ' + rid + ' on ' + n + ' from LOADING to FULL, Loading Done');
    else if (!(k in after.nb)) push(dev, '%OSPF-5-ADJCHG: Process ' + before.nb[k] + ', Nbr ' + rid + ' on ' + n + ' from FULL to DOWN, Neighbor Down: Interface down or detached');
  }
  return ev;
}

/* ===== Free mode helpers ===== */
const PORTS = {
  router: ['Gi0/0', 'Gi0/1', 'Gi0/2'],
  switch: ['Fa0/1', 'Fa0/2', 'Fa0/3', 'Fa0/4', 'Fa0/5', 'Fa0/6', 'Fa0/7', 'Fa0/8', 'Gi0/1', 'Gi0/2'],
  pc: ['eth0']
};
const PREFIX = { router: 'R', switch: 'SW', pc: 'PC' };
function addDevice(s, kind) {
  let n = 1; while (s.devices[PREFIX[kind] + n]) n++;
  const name = PREFIX[kind] + n;
  const d = makeDevice({ name, kind, ports: PORTS[kind], hostname: kind === 'pc' ? name : name });
  s.devices[name] = d; s.initial[name] = runningConfig(d);
  return d;
}
function removeDevice(s, name) {
  s.links = s.links.filter(l => l.a !== name && l.b !== name);
  delete s.devices[name]; delete s.initial[name];
}
function freePorts(s, name) {
  const d = s.devices[name]; if (!d) return [];
  return Object.entries(d.ifaces).filter(([n, i]) => !i.svi && !i.loop && linkIndex(s, name, n) < 0).map(([n]) => n);
}
function connect(s, a, ai, b, bi) {
  if (a === b) return '同じ機器どうしは接続できません';
  if (linkIndex(s, a, ai) >= 0 || linkIndex(s, b, bi) >= 0) return 'そのポートは使用中です';
  s.links.push({ a, ai, b, bi, label: '' }); return null;
}
function disconnect(s, i) { s.links.splice(i, 1); }

/* ===== Session ===== */
function newSession(lab) {
  const s = { lab, devices: {}, links: [], arp: new Set(), initial: {}, lastPing: null };
  if (!lab) return s;
  for (const spec of lab.devices) s.devices[spec.name] = makeDevice(spec);
  for (const [a, ai, b, bi, label] of lab.links) {
    const ca = s.devices[a].kind === 'pc' ? ai : canonIf(ai), cb = s.devices[b].kind === 'pc' ? bi : canonIf(bi);
    s.links.push({ a, ai: ca, b, bi: cb, label });
  }
  for (const [dn, lines] of Object.entries(lab.setup || {})) {
    const d = s.devices[dn]; d.mode = 'config';
    for (const l of lines) { const o = execLine(s, d, l); if (/^\s*\^|^% (Inv|Inc|Amb)/m.test(o)) console.warn('setup', dn, l, o); }
    d.mode = 'user'; d.ctx = null; d.pending = null;
  }
  for (const d of Object.values(s.devices)) {
    if (d.kind === 'pc') continue;
    s.initial[d.name] = runningConfig(d);
    d.startup = s.initial[d.name];
  }
  return s;
}

/* ===== Grading ===== */
function savedState(s) {
  const devs = Object.values(s.devices).filter(d => d.kind !== 'pc');
  const dirty = devs.filter(d => runningConfig(d) !== s.initial[d.name]);
  const unsaved = dirty.filter(d => d.startup !== runningConfig(d));
  return { dirty: dirty.length, unsaved: unsaved.map(d => d.name), saved: dirty.length > 0 && unsaved.length === 0 };
}
function grade(s) {
  const checks = s.lab.checks.map(c => { let ok = false; try { ok = !!c.f(s); } catch (e) { ok = false; } return { ...c, ok }; });
  let score = checks.reduce((n, c) => n + (c.ok ? c.w : 0), 0);
  const sv = savedState(s);
  if (!sv.saved) score = Math.min(score, 99);
  return { checks, score, saved: sv };
}
function progress(s) {
  const total = s.lab.checks.reduce((n, c) => n + c.w, 0);
  const got = s.lab.checks.reduce((n, c) => { let ok = false; try { ok = !!c.f(s); } catch (e) { } return n + (ok ? c.w : 0); }, 0);
  return Math.round(got / total * 100);
}

window.SIM = { newSession, execLine, helpOrComplete, prompt, MODE_JA, MODE_HINT, ifUp, addDevice, removeDevice, freePorts, connect, disconnect, runningConfig, statusSnap, statusEvents, grade, progress, savedState, doPing, canonIf, shortIf, ospfIfaces, ospfNeighbors, routerId, inNet, maskLen, v6Eq, isIp, SUBMODES, CONFIG_I };

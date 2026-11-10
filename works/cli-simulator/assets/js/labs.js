/* CLIシミュレーター（公開用デモ）— 収録問題（実運用版の練習問題から3問） */
'use strict';
(function () {
  const { canonIf, savedState } = window.SIM;
  const D = (s, n) => s.devices[n];
  const I = (s, n, i) => s.devices[n].ifaces[canonIf(i)];
  const saved = s => savedState(s).saved;
  const R = (name, ports, extra) => ({ name, kind: 'router', ports, hostname: name, ...extra });
  const SW = (name, ports) => ({ name, kind: 'switch', ports, hostname: name });
  const PC = (name, ip, mask, gw, label) => ({ name, kind: 'pc', ip, mask, gw, label });
  const ospf = (s, n, pid) => D(s, n).ospf[pid];
  const hasNet = (pr, ip, wild) => !!pr && pr.nets.some(x => x.ip === ip && x.wild === wild && x.area === '0');

  window.LABS = [
    {
      id: 'ORIG-01', section: '練習問題', no: 1, level: '中級', title: 'SSHによる安全なリモート管理', tags: ['セキュリティ', '管理・運用'],
      summary: 'Telnet を使わず、SSHv2 とローカル認証だけで管理アクセスできるようにする。',
      note: '管理アクセスはSSHのみ',
      devices: [PC('Admin', null, null, null, '管理端末'), R('R1', ['Gi0/0'])],
      links: [['Admin', 'eth0', 'R1', 'Gi0/0', '']],
      pos: { Admin: [150, 130], R1: [470, 130] },
      setup: {},
      tasks: [
        'R1のホスト名をEDGE1へ変更してください。',
        'ローカル管理者admin（特権15、secret C1scoLab!）を作成してください。',
        'ドメインlab.exampleと1024bit以上のRSA鍵を使用し、SSHv2だけでVTY 0〜4へローカル認証できるようにしてください。',
        '設定を不揮発性領域へ保存してください。'
      ],
      checks: [
        { label: 'Hostname', w: 15, f: s => D(s, 'R1').hostname === 'EDGE1' },
        { label: 'Local administrator', w: 20, f: s => { const u = D(s, 'R1').users.admin; return !!u && u.secret === 'C1scoLab!' && String(u.priv) === '15'; } },
        { label: 'SSH-only access', w: 50, f: s => { const d = D(s, 'R1'); return (d.domain || '').toLowerCase() === 'lab.example' && d.rsa >= 1024 && d.sshVer === '2' && d.lines.vty.login === 'local' && d.lines.vty.transport === 'ssh'; } },
        { label: 'Saved', w: 15, f: saved }
      ],
      show: ['show ip ssh', 'show running-config'],
      why: 'SSH管理には、ローカルユーザー・ドメイン名・RSA鍵・SSHバージョン・VTYの認証方式と許可する接続方式が関係します。SSHだけ許可する要件なら、Telnetを残さないことも確認します。',
      pitfall: '鍵生成の前提となるドメイン名の設定漏れ、VTYの login local 漏れ、transport input に Telnet を残すこと。',
      answer: { R1: ['enable', 'configure terminal', 'hostname EDGE1', 'username admin privilege 15 secret C1scoLab!', 'ip domain-name lab.example', 'crypto key generate rsa modulus 1024', 'ip ssh version 2', 'line vty 0 4', ' login local', ' transport input ssh', 'end', 'write memory'] }
    },
    {
      id: 'ORIG-03', section: '練習問題', no: 2, level: '初級', title: 'VLAN・アクセスポート', tags: ['スイッチング'],
      summary: '部署ごとのVLANを作成し、PCを接続したポートをそれぞれのVLANへ割り当てる。',
      note: 'VLAN 20 SALES / VLAN 30 SUPPORT',
      devices: [PC('PC-A', '192.168.20.11', '255.255.255.0'), SW('SW1', ['Fa0/1', 'Fa0/2', 'Fa0/3', 'Fa0/4']), PC('PC-B', '192.168.30.12', '255.255.255.0')],
      links: [['PC-A', 'eth0', 'SW1', 'Fa0/2', ''], ['SW1', 'Fa0/3', 'PC-B', 'eth0', '']],
      pos: { 'PC-A': [110, 130], SW1: [310, 130], 'PC-B': [510, 130] },
      setup: {},
      tasks: [
        'VLAN20をSALES、VLAN30をSUPPORTとして作成してください。',
        'Fa0/2をVLAN20、Fa0/3をVLAN30へ割り当ててください。'
      ],
      checks: [
        { label: 'VLAN database', w: 40, f: s => { const v = D(s, 'SW1').vlans; return v[20] === 'SALES' && v[30] === 'SUPPORT'; } },
        { label: 'Access assignments', w: 60, f: s => { const a = I(s, 'SW1', 'Fa0/2'), b = I(s, 'SW1', 'Fa0/3'); return a.mode !== 'trunk' && a.vlan === 20 && b.mode !== 'trunk' && b.vlan === 30; } }
      ],
      show: ['show vlan brief', 'show interfaces trunk'],
      why: 'VLANを作成する操作と、アクセスポートをそのVLANへ所属させる操作は別です。show vlan brief で、VLAN名とポートの所属を両方確認します。',
      pitfall: 'VLANだけ作ってポートを割り当てないこと、VLAN名の綴り違い。',
      answer: { SW1: ['enable', 'configure terminal', 'vlan 20', ' name SALES', 'vlan 30', ' name SUPPORT', 'interface fa0/2', ' switchport mode access', ' switchport access vlan 20', 'interface fa0/3', ' switchport mode access', ' switchport access vlan 30', 'end', 'write memory'] }
    },
    {
      id: 'ORIG-10', section: '練習問題', no: 3, level: '中級', title: 'OSPF 基本構築', tags: ['OSPF', 'ルーティング'],
      summary: 'OSPFのプロセスとルーターIDを決め、対象のネットワークだけを正確なワイルドカードで広告する。',
      note: 'Area 0 / process 20',
      devices: [R('R1', ['Gi0/0']), R('R2', ['Gi0/0'], { cli: false })],
      links: [['R1', 'Gi0/0', 'R2', 'Gi0/0', '10.10.12.0/30']],
      pos: { R1: [180, 130], R2: [460, 130] },
      setup: {
        R1: ['interface g0/0', 'ip address 10.10.12.1 255.255.255.252', 'no shutdown', 'interface loopback0', 'ip address 10.10.10.10 255.255.255.255', 'exit'],
        R2: ['interface g0/0', 'ip address 10.10.12.2 255.255.255.252', 'no shutdown', 'exit']
      },
      tasks: [
        'OSPF Process20を使用し、Router IDを10.10.10.10にしてください。',
        '10.10.12.0/30とLoopback0を正確なワイルドカードでArea0へ広告してください。'
      ],
      checks: [
        { label: 'Router ID', w: 30, f: s => (ospf(s, 'R1', '20') || {}).rid === '10.10.10.10' },
        { label: 'Transit network', w: 35, f: s => hasNet(ospf(s, 'R1', '20'), '10.10.12.0', '0.0.0.3') },
        { label: 'Loopback host', w: 35, f: s => hasNet(ospf(s, 'R1', '20'), '10.10.10.10', '0.0.0.0') }
      ],
      show: ['show ip protocols', 'show running-config'],
      why: 'OSPFでは、ルーターID・networkコマンドのワイルドカード・エリアが対象インターフェイスと一致して初めて広告されます。/30 のワイルドカードは 0.0.0.3、ホスト1台（/32）は 0.0.0.0 です。',
      pitfall: 'ワイルドカードをサブネットマスクと取り違えること、対象外のインターフェイスまで広告すること。',
      answer: { R1: ['enable', 'configure terminal', 'router ospf 20', ' router-id 10.10.10.10', ' network 10.10.12.0 0.0.0.3 area 0', ' network 10.10.10.10 0.0.0.0 area 0', 'end', 'write memory'] }
    }
  ];
})();

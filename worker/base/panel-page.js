export const PAGE = String.raw`<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <meta name="theme-color" content="#07111f" media="(prefers-color-scheme: dark)">
  <meta name="theme-color" content="#f4f7fb" media="(prefers-color-scheme: light)">
  <meta name="color-scheme" content="light dark">
  <meta name="mobile-web-app-capable" content="yes">
  <meta name="apple-mobile-web-app-capable" content="yes">
  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
  <meta name="apple-mobile-web-app-title" content="我的设备">
  <title>我的设备 · IMX6ULL</title>
  <style>
    :root {
      color-scheme: light;
      --bg: #f2f6fa;
      --bg-accent: rgba(13, 148, 136, .08);
      --surface: rgba(255, 255, 255, .88);
      --surface-solid: #ffffff;
      --surface-soft: #f7fafc;
      --text: #102236;
      --muted: #64748b;
      --faint: #94a3b8;
      --border: rgba(15, 23, 42, .09);
      --primary: #0f766e;
      --primary-bright: #14b8a6;
      --primary-soft: rgba(20, 184, 166, .12);
      --success: #16a34a;
      --danger: #dc2626;
      --shadow: 0 18px 45px rgba(15, 23, 42, .08);
      --shadow-soft: 0 8px 24px rgba(15, 23, 42, .06);
      --radius-lg: 24px;
      --radius-md: 18px;
      --header-bg: rgba(242, 246, 250, .78);
      --chart-grid: rgba(100, 116, 139, .18);
      --focus: rgba(20, 184, 166, .35);
    }
    [data-theme="dark"] {
      color-scheme: dark;
      --bg: #07111f;
      --bg-accent: rgba(45, 212, 191, .08);
      --surface: rgba(13, 28, 46, .86);
      --surface-solid: #0d1c2e;
      --surface-soft: #10243a;
      --text: #edf7fa;
      --muted: #9fb0c2;
      --faint: #718399;
      --border: rgba(148, 163, 184, .14);
      --primary: #2dd4bf;
      --primary-bright: #5eead4;
      --primary-soft: rgba(45, 212, 191, .12);
      --success: #4ade80;
      --danger: #fb7185;
      --shadow: 0 20px 55px rgba(0, 0, 0, .26);
      --shadow-soft: 0 10px 28px rgba(0, 0, 0, .18);
      --header-bg: rgba(7, 17, 31, .76);
      --chart-grid: rgba(148, 163, 184, .16);
      --focus: rgba(45, 212, 191, .36);
    }
    * { box-sizing: border-box; }
    html { min-height: 100%; background: var(--bg); }
    body {
      min-width: 320px;
      min-height: 100vh;
      min-height: 100dvh;
      margin: 0;
      overflow-x: hidden;
      background:
        radial-gradient(circle at 8% 2%, var(--bg-accent), transparent 28rem),
        radial-gradient(circle at 92% 24%, rgba(37, 99, 235, .06), transparent 32rem),
        var(--bg);
      color: var(--text);
      font-family: Inter, ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
      font-size: 15px;
      line-height: 1.5;
      -webkit-font-smoothing: antialiased;
      -webkit-tap-highlight-color: transparent;
    }
    button, input { font: inherit; }
    button { color: inherit; }
    button, [role="switch"] { touch-action: manipulation; }
    [hidden] { display: none !important; }
    :focus-visible { outline: 3px solid var(--focus); outline-offset: 3px; }
    .icon { width: 20px; height: 20px; flex: 0 0 auto; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; fill: none; }
    .login-view {
      display: grid;
      min-height: 100vh;
      min-height: 100dvh;
      place-items: center;
      padding: max(24px, env(safe-area-inset-top)) 20px max(24px, env(safe-area-inset-bottom));
    }
    .login-shell { width: min(100%, 420px); }
    .brand { display: flex; flex-direction: column; align-items: center; margin-bottom: 28px; text-align: center; }
    .brand-mark {
      display: grid; width: 66px; height: 66px; margin-bottom: 17px; place-items: center;
      border: 1px solid rgba(45, 212, 191, .25); border-radius: 20px;
      background: linear-gradient(145deg, #0d263a, #071322); color: #5eead4;
      box-shadow: 0 16px 40px rgba(15, 118, 110, .2);
    }
    .brand-mark .icon { width: 34px; height: 34px; stroke-width: 1.6; }
    .brand h1 { margin: 0; font-size: clamp(26px, 7vw, 34px); letter-spacing: -.035em; }
    .brand p { margin: 7px 0 0; color: var(--muted); font-size: 14px; letter-spacing: .06em; }
    .login-card {
      padding: 28px; border: 1px solid var(--border); border-radius: var(--radius-lg);
      background: var(--surface); box-shadow: var(--shadow); backdrop-filter: blur(20px);
    }
    .login-card h2 { margin: 0 0 6px; font-size: 20px; letter-spacing: -.02em; }
    .login-card > p { margin: 0 0 22px; color: var(--muted); font-size: 14px; }
    .field-label { display: block; margin: 0 0 8px; color: var(--muted); font-size: 13px; font-weight: 700; }
    .password-field { position: relative; }
    .password-field input {
      width: 100%; height: 52px; padding: 0 48px 0 15px; border: 1px solid var(--border); border-radius: 14px;
      outline: none; background: var(--surface-soft); color: var(--text);
    }
    .password-field input:focus { border-color: var(--primary-bright); box-shadow: 0 0 0 4px var(--primary-soft); }
    .password-toggle {
      position: absolute; top: 50%; right: 8px; display: grid; width: 38px; height: 38px; padding: 0;
      place-items: center; transform: translateY(-50%); border: 0; border-radius: 10px; background: transparent; color: var(--muted); cursor: pointer;
    }
    .login-error { min-height: 22px; margin: 9px 2px 3px; color: var(--danger); font-size: 13px; }
    .primary-btn {
      display: inline-flex; width: 100%; min-height: 50px; align-items: center; justify-content: center; gap: 9px;
      padding: 0 18px; border: 0; border-radius: 14px; background: linear-gradient(135deg, #0f766e, #0d9488);
      color: #fff; font-weight: 750; cursor: pointer; box-shadow: 0 10px 24px rgba(15, 118, 110, .22);
    }
    .primary-btn:disabled { cursor: wait; opacity: .68; }
    .login-hint { margin: 17px 0 0; color: var(--faint); font-size: 12px; text-align: center; }
    .dashboard { min-height: 100vh; min-height: 100dvh; padding-bottom: env(safe-area-inset-bottom); }
    .topbar {
      position: sticky; z-index: 20; top: 0; border-bottom: 1px solid var(--border);
      background: var(--header-bg); backdrop-filter: blur(18px) saturate(150%);
    }
    .topbar-inner {
      display: flex; width: min(100% - 32px, 1180px); min-height: 76px; margin: 0 auto;
      align-items: center; justify-content: space-between; gap: 18px; padding-top: env(safe-area-inset-top);
    }
    .title-block h1 { margin: 0; font-size: 22px; line-height: 1.2; letter-spacing: -.03em; }
    .device-line { display: flex; min-width: 0; align-items: center; gap: 7px; margin-top: 6px; color: var(--muted); font-size: 12px; }
    .status-dot { width: 8px; height: 8px; flex: 0 0 auto; border-radius: 999px; background: var(--faint); box-shadow: 0 0 0 4px rgba(148, 163, 184, .1); }
    .status-dot.online { background: var(--success); box-shadow: 0 0 0 4px rgba(34, 197, 94, .12); }
    .device-name { overflow: hidden; color: var(--text); font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-weight: 650; text-overflow: ellipsis; white-space: nowrap; }
    .top-actions { display: flex; align-items: center; gap: 8px; }
    .icon-btn {
      display: inline-flex; min-width: 42px; height: 42px; align-items: center; justify-content: center; gap: 7px;
      padding: 0 11px; border: 1px solid var(--border); border-radius: 13px; background: var(--surface);
      color: var(--muted); cursor: pointer; box-shadow: var(--shadow-soft);
    }
    .icon-btn span { font-size: 13px; font-weight: 700; }
    .content { width: min(100% - 32px, 1180px); margin: 0 auto; padding: 26px 0 18px; }
    .update-row { display: flex; align-items: center; justify-content: space-between; gap: 14px; margin-bottom: 12px; color: var(--muted); font-size: 12px; }
    .live-pill { display: inline-flex; align-items: center; gap: 7px; color: var(--primary); font-weight: 750; }
    .live-pill.idle { color: var(--muted); }
    .live-pulse { position: relative; width: 7px; height: 7px; border-radius: 999px; background: currentColor; }
    .live-pulse::after {
      position: absolute; inset: -4px; border: 1px solid currentColor; border-radius: inherit; content: ""; opacity: .25;
      animation: breathe 2s ease-in-out infinite;
    }
    .live-pill.idle .live-pulse::after { animation: none; }
    @keyframes breathe { 50% { transform: scale(1.35); opacity: 0; } }
    .metrics-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; }
    .card { border: 1px solid var(--border); border-radius: var(--radius-lg); background: var(--surface); box-shadow: var(--shadow-soft); backdrop-filter: blur(16px); }
    .metric-card { position: relative; min-height: 212px; overflow: hidden; padding: 22px; }
    .metric-card::after {
      position: absolute; right: -42px; bottom: -54px; width: 150px; height: 150px; border-radius: 50%;
      background: var(--metric-glow); content: ""; opacity: .7;
    }
    .metric-card.temperature { --metric-color: #f97316; --metric-glow: rgba(249, 115, 22, .12); }
    .metric-card.light { --metric-color: #ca8a04; --metric-glow: rgba(234, 179, 8, .16); }
    .card-kicker { display: flex; align-items: center; justify-content: space-between; gap: 12px; color: var(--muted); font-size: 14px; font-weight: 720; }
    .metric-icon { display: grid; width: 40px; height: 40px; place-items: center; border-radius: 13px; background: rgba(249, 115, 22, .12); color: var(--metric-color); }
    .metric-card.light .metric-icon { background: rgba(234, 179, 8, .16); }
    .metric-value-wrap { position: relative; z-index: 1; display: flex; align-items: baseline; gap: 7px; margin: 18px 0 7px; }
    .metric-value {
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      font-size: clamp(42px, 9vw, 62px); font-weight: 760; line-height: 1; letter-spacing: -.07em;
      font-variant-numeric: tabular-nums;
    }
    .metric-value.lit { color: var(--metric-color); }
    .metric-unit { color: var(--muted); font-size: 18px; font-weight: 700; }
    .metric-range { position: relative; z-index: 1; color: var(--muted); font-size: 12px; }
    .metric-range strong { color: var(--text); font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-weight: 650; }
    .section-card { margin-top: 16px; padding: 22px; }
    .section-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 18px; margin-bottom: 20px; }
    .section-title h2 { margin: 0; font-size: 18px; letter-spacing: -.025em; }
    .section-title p { margin: 4px 0 0; color: var(--muted); font-size: 12px; }
    .online-badge {
      display: inline-flex; flex: 0 0 auto; align-items: center; gap: 6px; padding: 6px 10px; border-radius: 999px;
      background: var(--primary-soft); color: var(--primary); font-size: 12px; font-weight: 750;
    }
    .online-badge.offline { background: rgba(148, 163, 184, .13); color: var(--muted); }
    .led-row {
      display: flex; min-height: 98px; align-items: center; justify-content: space-between; gap: 18px;
      padding: 17px; border: 1px solid var(--border); border-radius: var(--radius-md); background: var(--surface-soft);
    }
    .led-name { margin: 0; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 15px; font-weight: 750; }
    .led-state { min-height: 19px; margin: 4px 0 0; color: var(--muted); font-size: 12px; }
    .led-state.pending { color: var(--primary); }
    .led-state.error { color: var(--danger); }
    .switch {
      position: relative; width: 58px; height: 34px; flex: 0 0 auto; padding: 0; border: 0; border-radius: 999px;
      background: #cbd5e1; cursor: pointer; transition: background-color .22s ease;
    }
    [data-theme="dark"] .switch { background: #334155; }
    .switch::after {
      position: absolute; top: 4px; left: 4px; width: 26px; height: 26px; border-radius: 50%; background: #fff;
      box-shadow: 0 2px 7px rgba(15, 23, 42, .28); content: ""; transition: transform .22s cubic-bezier(.2, .8, .2, 1);
    }
    .switch[aria-checked="true"] { background: var(--primary-bright); }
    .switch[aria-checked="true"]::after { transform: translateX(24px); }
    .switch:disabled { cursor: not-allowed; opacity: .46; }
    .switch.sending:disabled { opacity: 1; cursor: wait; }
    .switch.sending::after { box-shadow: 0 0 0 3px var(--primary-soft), 0 2px 7px rgba(15, 23, 42, .25); animation: switch-wait .8s ease-in-out infinite alternate; }
    @keyframes switch-wait { to { transform: translateX(5px) scale(.88); } }
    .switch.sending[aria-checked="true"]::after { animation-name: switch-wait-on; }
    @keyframes switch-wait-on { to { transform: translateX(19px) scale(.88); } }
    .chart-wrap { position: relative; height: 320px; min-height: 240px; }
    .chart-empty {
      position: absolute; inset: 0; display: grid; place-items: center; margin: 0; color: var(--muted); font-size: 13px; text-align: center; padding: 16px;
    }
    .history-chart { display: block; width: 100%; height: 100%; }
    .chart-caption { margin: 10px 0 0; color: var(--muted); font-size: 12px; }
    .footer {
      display: flex; width: min(100% - 32px, 1180px); min-height: 58px; margin: 0 auto; align-items: center;
      justify-content: center; gap: 8px; color: var(--faint); font-size: 12px;
    }
    .connection-dot { width: 7px; height: 7px; border-radius: 50%; background: var(--faint); }
    .connection-dot.connected { background: var(--success); }
    .connection-dot.reconnecting { background: #f59e0b; animation: blink 1s steps(2, end) infinite; }
    @keyframes blink { 50% { opacity: .3; } }
    .toast-region {
      position: fixed; z-index: 50; right: max(16px, env(safe-area-inset-right)); bottom: max(16px, env(safe-area-inset-bottom));
      display: grid; width: min(360px, calc(100vw - 32px)); gap: 8px; pointer-events: none;
    }
    .toast {
      display: flex; align-items: flex-start; gap: 10px; padding: 13px 14px; border: 1px solid var(--border);
      border-radius: 14px; background: var(--surface-solid); box-shadow: var(--shadow); color: var(--text); font-size: 13px;
    }
    .toast.success .toast-mark { color: var(--success); }
    .toast.error .toast-mark { color: var(--danger); }
    @media (max-width: 760px) {
      .topbar-inner, .content, .footer { width: min(100% - 24px, 1180px); }
      .topbar-inner { min-height: 70px; }
      .action-label { display: none; }
      .metrics-grid { grid-template-columns: 1fr; gap: 12px; }
      .metric-card { min-height: 186px; padding: 19px; }
      .section-card { padding: 18px; }
      .led-row { min-height: 78px; }
      .chart-wrap { height: 260px; }
    }
    @media (max-width: 400px) {
      .title-block h1 { font-size: 20px; }
      .device-state-text { display: none; }
      .login-card { padding: 23px 20px; }
    }
    @media (prefers-reduced-motion: reduce) {
      *, *::before, *::after { animation-duration: .01ms !important; animation-iteration-count: 1 !important; transition-duration: .01ms !important; }
    }
  </style>
</head>
<body>
  <main id="loginView" class="login-view">
    <div class="login-shell">
      <div class="brand">
        <div class="brand-mark" aria-hidden="true">
          <svg class="icon" viewBox="0 0 24 24">
            <rect x="5" y="6" width="14" height="12" rx="2"></rect>
            <path d="M9 2v4m6-4v4M9 18v4m6-4v4M2 9h3m-3 6h3m14-6h3m-3 6h3"></path>
            <circle cx="12" cy="12" r="2.5"></circle>
          </svg>
        </div>
        <h1>IMX6ULL 控制面板</h1>
        <p>DEVICE CONTROL CENTER</p>
      </div>
      <form id="loginForm" class="login-card" novalidate>
        <h2>连接设备</h2>
        <p>输入实验站设备口令，查看芯片温度、光照并控制用户灯</p>
        <label class="field-label" for="token">设备口令</label>
        <div class="password-field">
          <input id="token" type="password" autocomplete="off" spellcheck="false" placeholder="请输入设备口令" aria-describedby="loginError loginHint">
          <button id="passwordToggle" class="password-toggle" type="button" aria-label="显示口令">
            <svg class="icon" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12Z"></path>
              <circle cx="12" cy="12" r="2.5"></circle>
            </svg>
          </button>
        </div>
        <p id="loginError" class="login-error" role="alert"></p>
        <button id="loginButton" class="primary-btn" type="submit">
          <span id="loginLabel">连接</span>
          <svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14m-5-5 5 5-5 5"></path></svg>
        </button>
        <p id="loginHint" class="login-hint">口令只留在本次浏览器会话里，退出或关闭页面后需要重新输入。</p>
      </form>
    </div>
  </main>

  <div id="dashboard" class="dashboard" hidden>
    <header class="topbar">
      <div class="topbar-inner">
        <div class="title-block">
          <h1>我的设备</h1>
          <div class="device-line">
            <span id="deviceDot" class="status-dot" aria-hidden="true"></span>
            <span class="device-name">imx6ull_temp_led_01</span>
            <span id="deviceState" class="device-state-text">尚未连接</span>
          </div>
        </div>
        <div class="top-actions">
          <button id="themeToggle" class="icon-btn" type="button" aria-label="切换深浅色">
            <svg id="themeIcon" class="icon" viewBox="0 0 24 24" aria-hidden="true"></svg>
            <span class="action-label">外观</span>
          </button>
          <button id="logoutButton" class="icon-btn" type="button" aria-label="退出">
            <svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M10 5H5v14h5m4-3 4-4-4-4m4 4H9"></path></svg>
            <span class="action-label">退出</span>
          </button>
        </div>
      </div>
    </header>
    <div class="content">
      <div class="update-row">
        <span id="livePill" class="live-pill idle"><span class="live-pulse"></span><span id="liveText">等待数据</span></span>
        <span>最后更新：<time id="lastUpdated">--</time></span>
      </div>
      <section class="metrics-grid" aria-label="实时数据">
        <article class="card metric-card temperature">
          <div class="card-kicker">
            <span>芯片温度</span>
            <span class="metric-icon" aria-hidden="true">
              <svg class="icon" viewBox="0 0 24 24"><path d="M14 14.8V5a4 4 0 0 0-8 0v9.8a6 6 0 1 0 8 0Z"></path><path d="M10 9v7"></path></svg>
            </span>
          </div>
          <div class="metric-value-wrap">
            <span id="tempValue" class="metric-value">—</span>
            <span class="metric-unit">℃</span>
          </div>
          <div class="metric-range">本次最高 <strong id="tempMax">—</strong> ℃ · 最低 <strong id="tempMin">—</strong> ℃</div>
        </article>
        <article class="card metric-card light">
          <div class="card-kicker">
            <span>光照</span>
            <span class="metric-icon" aria-hidden="true">
              <svg class="icon" viewBox="0 0 24 24"><circle cx="12" cy="12" r="4"></circle><path d="M12 2v2m0 16v2M2 12h2m16 0h2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4m0-14.2-1.4 1.4M6.3 17.7l-1.4 1.4"></path></svg>
            </span>
          </div>
          <div class="metric-value-wrap">
            <span id="luxValue" class="metric-value">—</span>
            <span class="metric-unit">lux</span>
          </div>
          <div class="metric-range">本次最高 <strong id="luxMax">—</strong> lux · 最低 <strong id="luxMin">—</strong> lux</div>
        </article>
      </section>
      <section class="card section-card" aria-labelledby="ledHeading">
        <div class="section-header">
          <div class="section-title">
            <h2 id="ledHeading">用户灯</h2>
            <p>点一下发送开或关，等板子回读后才算数。</p>
          </div>
          <span id="ledBadge" class="online-badge offline">尚未连接</span>
        </div>
        <div class="led-row">
          <div>
            <p class="led-name">sys-led</p>
            <p id="ledState" class="led-state">等待板子状态</p>
          </div>
          <button id="ledSwitch" class="switch" type="button" role="switch" aria-checked="false" aria-labelledby="ledHeading" disabled></button>
        </div>
      </section>
      <section class="card section-card" aria-labelledby="historyHeading">
        <div class="section-header">
          <div class="section-title">
            <h2 id="historyHeading">本次温度曲线</h2>
            <p>只画这次打开页面后收到的芯片温度</p>
          </div>
        </div>
        <div id="chartWrap" class="chart-wrap">
          <p id="chartEmpty" class="chart-empty">正在等待本次打开页面后的芯片温度采样</p>
          <canvas id="historyChart" class="history-chart" role="img" aria-label="本次打开页面的芯片温度折线"></canvas>
        </div>
        <p id="chartCaption" class="chart-caption">本次打开页面 · 0 个采样</p>
      </section>
    </div>
    <footer class="footer">
      <span id="connectionDot" class="connection-dot" aria-hidden="true"></span>
      <span id="connectionText">尚未连接</span>
    </footer>
  </div>
  <div id="toastRegion" class="toast-region" aria-live="polite"></div>
  <script>
'use strict';
var DEV = 'imx6ull_temp_led_01';
var TOKEN_KEY = 'imx6ull-mini-token';
var THEME_KEY = 'imx6ull-mini-theme';
var TOKEN_RE = /^[A-Za-z0-9_.~-]{32,512}$/;
var FRESH_MS = 7000;
var COMMAND_MS = 8000;
var GAP_MS = 12000;
var MAX_POINTS = 480;
var SUN = '<circle cx="12" cy="12" r="4"></circle><path d="M12 2v2m0 16v2M2 12h2m16 0h2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4m0-14.2-1.4 1.4M6.3 17.7l-1.4 1.4"></path>';
var MOON = '<path d="M21 14.5A8.5 8.5 0 1 1 9.5 3 7 7 0 0 0 21 14.5Z"></path>';
var socket = null;
var userStop = false;
var retryTimer = null;
var retryWait = 1000;
var heartbeat = null;
var lastPong = 0;
var pending = null;
var pendingTimer = null;
var online = false;
var lastAt = 0;
var lastTemp = null;
var lastLux = null;
var luxMin = null;
var luxMax = null;
var ledOn = null;
var ledMode = '';
var samples = [];
var tempMin = null;
var tempMax = null;
var secret = '';
var toastTimer = null;

function $(id) { return document.getElementById(id); }
function storageGet(store, key) {
  try { return store.getItem(key) || ''; } catch (err) { return ''; }
}
function storageSet(store, key, value) {
  try { store.setItem(key, value); } catch (err) {}
}
function storageRemove(store, key) {
  try { store.removeItem(key); } catch (err) {}
}
function clock(ms) {
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
  }).format(new Date(ms));
}
function toast(text, kind) {
  var region = $('toastRegion');
  region.textContent = '';
  var node = document.createElement('div');
  node.className = 'toast ' + (kind || '');
  var mark = document.createElement('span');
  mark.className = 'toast-mark';
  mark.textContent = '●';
  var body = document.createElement('span');
  body.textContent = text;
  node.appendChild(mark);
  node.appendChild(body);
  region.appendChild(node);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(function () { region.textContent = ''; }, 3600);
}
function freshNow() {
  return !!(online && socket && socket.readyState === 1 && lastAt && Date.now() - lastAt < FRESH_MS);
}
function setConnection(text, mode) {
  $('connectionText').textContent = text;
  $('deviceState').textContent = text;
  $('deviceDot').classList.toggle('online', mode === 'online');
  $('connectionDot').classList.toggle('connected', mode === 'online');
  $('connectionDot').classList.toggle('reconnecting', mode === 'wait');
  $('livePill').classList.toggle('idle', mode !== 'online');
  $('liveText').textContent = mode === 'online' ? '实时数据' : '等待数据';
}
function setBadge(text, on) {
  var badge = $('ledBadge');
  badge.textContent = text;
  badge.classList.toggle('offline', !on);
}
function renderTemp() {
  var live = freshNow() && typeof lastTemp === 'number';
  $('tempValue').textContent = live ? lastTemp.toFixed(1) : '—';
  $('tempMax').textContent = tempMax === null ? '—' : tempMax.toFixed(1);
  $('tempMin').textContent = tempMin === null ? '—' : tempMin.toFixed(1);
  $('lastUpdated').textContent = lastAt ? clock(lastAt) : '--';
  if (lastAt) $('lastUpdated').setAttribute('datetime', new Date(lastAt).toISOString());
}
function renderLux() {
  var live = freshNow() && typeof lastLux === 'number';
  $('luxValue').textContent = live ? lastLux.toFixed(1) : '—';
  $('luxMax').textContent = luxMax === null ? '—' : luxMax.toFixed(1);
  $('luxMin').textContent = luxMin === null ? '—' : luxMin.toFixed(1);
}
function renderLed() {
  var live = freshNow();
  var steady = live && ledMode === 'steady' && typeof ledOn === 'boolean';
  var sw = $('ledSwitch');
  sw.setAttribute('aria-checked', steady && ledOn === true ? 'true' : 'false');
  sw.disabled = !steady || !!pending;
  sw.classList.toggle('sending', !!pending);
  $('ledState').classList.toggle('pending', !!pending);
  $('ledState').classList.toggle('error', false);
  if (pending) $('ledState').textContent = '正在等待板子确认…';
  else if (steady) $('ledState').textContent = ledOn ? '当前为开' : '当前为关';
  else if (!live) $('ledState').textContent = online ? '数据已过期' : '等待状态';
  else if (ledMode === 'nonsteady') $('ledState').textContent = '非稳定模式，开关已停用';
  else $('ledState').textContent = '读取失败';
}
function clearLive(text, mode) {
  online = false;
  lastAt = 0;
  lastTemp = null;
  lastLux = null;
  ledOn = null;
  ledMode = '';
  setConnection(text, mode || 'off');
  setBadge('设备离线', false);
  renderTemp();
  renderLux();
  renderLed();
}
function failPending(message) {
  if (!pending) return;
  clearTimeout(pendingTimer);
  pending = null;
  renderLed();
  if (message) toast(message, 'error');
}
function showDashboard() {
  $('loginView').hidden = true;
  $('dashboard').hidden = false;
  requestAnimationFrame(drawChart);
}
function showLogin(error) {
  $('dashboard').hidden = true;
  $('loginView').hidden = false;
  $('loginError').textContent = error || '';
  $('loginButton').disabled = false;
  $('loginLabel').textContent = '连接';
}
function reasonText(reason) {
  if (reason === 'busy') return '上一条还在等板子确认。';
  if (reason === 'device_offline') return '设备离线。';
  if (reason === 'disconnected') return '连接已断开。';
  return '结果未知。';
}
function scheduleRetry() {
  if (userStop || !secret) return;
  setConnection('正在重新连接…', 'wait');
  setBadge('重新连接', false);
  renderLed();
  clearTimeout(retryTimer);
  var wait = retryWait;
  retryWait = Math.min(retryWait * 2, 15000);
  retryTimer = setTimeout(function () { connect(secret, true); }, wait);
}
function connect(token, isRetry) {
  secret = token;
  userStop = false;
  clearTimeout(retryTimer);
  if (heartbeat) clearInterval(heartbeat);
  failPending('连接已更换，未确认。');
  if (socket) {
    var old = socket;
    socket = null;
    old.onclose = null;
    old.onmessage = null;
    old.onerror = null;
    try { old.close(); } catch (err) {}
  }
  if (!isRetry) {
    samples = [];
    tempMin = null;
    tempMax = null;
    luxMin = null;
    luxMax = null;
  }
  online = false;
  lastAt = 0;
  lastTemp = null;
  lastLux = null;
  ledOn = null;
  ledMode = '';
  setConnection(isRetry ? '正在重新连接…' : '正在连接…', 'wait');
  setBadge('正在连接', false);
  renderTemp();
  renderLux();
  renderLed();
  drawChart();
  $('loginButton').disabled = true;
  $('loginLabel').textContent = '连接中';
  var scheme = location.protocol === 'https:' ? 'wss:' : 'ws:';
  var current = new WebSocket(scheme + '//' + location.host + '/mini/ws?kind=panel', ['codex-lab.v1', 'auth.' + token]);
  socket = current;
  var openedThis = false;
  current.onopen = function () {
    if (socket !== current) return;
    if (current.protocol !== 'codex-lab.v1') { current.close(); return; }
    openedThis = true;
    retryWait = 1000;
    storageSet(sessionStorage, TOKEN_KEY, token);
    $('token').value = '';
    showDashboard();
    setConnection('已连接，等待设备', 'wait');
    setBadge('等待设备', false);
    lastPong = Date.now();
    heartbeat = setInterval(function () {
      if (socket !== current) return;
      if (Date.now() - lastPong > 35000) { current.close(); return; }
      if (current.readyState === 1) current.send('ping');
    }, 15000);
  };
  current.onmessage = function (event) {
    if (socket !== current) return;
    if (event.data === 'pong') { lastPong = Date.now(); return; }
    var msg;
    try { msg = JSON.parse(event.data); } catch (err) { return; }
    if (!msg || msg.device_id !== DEV) return;
    if (msg.type === 'mini_status') {
      online = msg.online === true;
      if (!online) {
        clearLive('设备离线', 'off');
        failPending('设备离线，未确认。');
      } else if (!(lastAt && Date.now() - lastAt < FRESH_MS)) {
        setConnection('设备已连接，等待实时数据', 'wait');
        setBadge('等待数据', false);
        renderLed();
      } else {
        setConnection('设备在线', 'online');
        setBadge('设备在线', true);
        renderLed();
      }
    }
    if (msg.type === 'mini_state') {
      online = true;
      lastAt = Date.now();
      lastPong = lastAt;
      ledMode = msg.led_mode;
      ledOn = typeof msg.led_on === 'boolean' ? msg.led_on : null;
      if (typeof msg.temperature_c === 'number' && isFinite(msg.temperature_c)) {
        lastTemp = msg.temperature_c;
        if (tempMin === null || msg.temperature_c < tempMin) tempMin = msg.temperature_c;
        if (tempMax === null || msg.temperature_c > tempMax) tempMax = msg.temperature_c;
        var prev = samples.length ? samples[samples.length - 1] : null;
        if (!prev || lastAt - prev.t >= 1500) {
          samples.push({ t: lastAt, c: msg.temperature_c });
          if (samples.length > MAX_POINTS) samples.shift();
        }
      } else {
        lastTemp = null;
      }
      if (typeof msg.illuminance_lux === 'number' && isFinite(msg.illuminance_lux)) {
        lastLux = msg.illuminance_lux;
        if (luxMin === null || lastLux < luxMin) luxMin = lastLux;
        if (luxMax === null || lastLux > luxMax) luxMax = lastLux;
      } else {
        lastLux = null;
      }
      setConnection('设备在线', 'online');
      setBadge('设备在线', true);
      renderTemp();
      renderLux();
      renderLed();
      drawChart();
    }
    if (msg.type === 'mini_result' && pending && msg.request_id === pending.id) {
      var desired = pending.value;
      clearTimeout(pendingTimer);
      pending = null;
      if (typeof msg.led_on === 'boolean') ledOn = msg.led_on;
      renderLed();
      if (msg.ok === true && msg.led_on === desired) toast(desired ? '灯已打开。' : '灯已关闭。', 'success');
      else toast('未确认。' + reasonText(msg.reason), 'error');
    }
  };
  current.onerror = function () {
    if (socket === current && !openedThis) $('loginError').textContent = '没有连上。请检查口令和网络。';
  };
  current.onclose = function () {
    if (socket !== current) return;
    if (heartbeat) clearInterval(heartbeat);
    socket = null;
    online = false;
    failPending('连接已断开，未确认。');
    renderTemp();
    renderLed();
    if (userStop) return;
    if (!openedThis) {
      secret = '';
      storageRemove(sessionStorage, TOKEN_KEY);
      showLogin('没有连上。请检查口令和网络。');
      return;
    }
    showDashboard();
    scheduleRetry();
  };
}
function requestId() {
  var bytes = crypto.getRandomValues(new Uint8Array(16));
  var hex = '';
  for (var i = 0; i < bytes.length; i++) hex += bytes[i].toString(16).padStart(2, '0');
  return 'mini_' + hex;
}
function sendLed(value) {
  var steady = freshNow() && ledMode === 'steady' && typeof ledOn === 'boolean';
  if (!steady || pending || ledOn === value) return;
  var id = requestId();
  pending = { id: id, value: value };
  renderLed();
  socket.send(JSON.stringify({ type: 'mini_command', device_id: DEV, request_id: id, command: 'set_led', value: value }));
  pendingTimer = setTimeout(function () { failPending('操作超时，未确认。'); }, COMMAND_MS);
}
function drawChart() {
  var canvas = $('historyChart');
  var wrap = $('chartWrap');
  if (!canvas || $('dashboard').hidden) return;
  var width = wrap.clientWidth;
  var height = wrap.clientHeight;
  if (width < 20 || height < 20) return;
  var dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.floor(width * dpr);
  canvas.height = Math.floor(height * dpr);
  var ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);
  $('chartEmpty').hidden = samples.length > 0;
  $('chartCaption').textContent = '本次打开页面 · ' + samples.length + ' 个采样';
  if (!samples.length) return;
  var padL = 52;
  var padR = 14;
  var padT = 16;
  var padB = 28;
  var plotW = Math.max(1, width - padL - padR);
  var plotH = Math.max(1, height - padT - padB);
  var min = samples[0].c;
  var max = samples[0].c;
  for (var i = 1; i < samples.length; i++) {
    if (samples[i].c < min) min = samples[i].c;
    if (samples[i].c > max) max = samples[i].c;
  }
  var span = Math.max(2, max - min);
  var y0 = min - span * 0.2;
  var y1 = max + span * 0.2;
  var t0 = samples[0].t;
  var t1 = samples[samples.length - 1].t;
  if (t1 <= t0) t1 = t0 + 1000;
  function xOf(t) { return padL + (t - t0) / (t1 - t0) * plotW; }
  function yOf(c) { return padT + (y1 - c) / (y1 - y0) * plotH; }
  var muted = getComputedStyle(document.documentElement).getPropertyValue('--muted').trim() || '#64748b';
  var grid = getComputedStyle(document.documentElement).getPropertyValue('--chart-grid').trim() || 'rgba(100,116,139,.18)';
  ctx.font = '11px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
  ctx.lineWidth = 1;
  ctx.strokeStyle = grid;
  ctx.fillStyle = muted;
  for (var g = 0; g < 4; g++) {
    var value = y0 + (y1 - y0) * g / 3;
    var y = yOf(value);
    ctx.beginPath();
    ctx.moveTo(padL, y);
    ctx.lineTo(width - padR, y);
    ctx.stroke();
    ctx.fillText(value.toFixed(1), 6, y + 4);
  }
  var startLabel = clock(t0);
  var endLabel = clock(t1);
  ctx.fillText(startLabel, padL, height - 8);
  ctx.fillText(endLabel, Math.max(padL, width - padR - ctx.measureText(endLabel).width), height - 8);
  ctx.lineWidth = 2;
  ctx.strokeStyle = '#f97316';
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  var drawing = false;
  for (var p = 0; p < samples.length; p++) {
    var gap = p > 0 && samples[p].t - samples[p - 1].t > GAP_MS;
    if (!drawing || gap) {
      if (drawing) ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(xOf(samples[p].t), yOf(samples[p].c));
      drawing = true;
    } else {
      ctx.lineTo(xOf(samples[p].t), yOf(samples[p].c));
    }
  }
  if (drawing) ctx.stroke();
  var last = samples[samples.length - 1];
  ctx.fillStyle = '#f97316';
  ctx.beginPath();
  ctx.arc(xOf(last.t), yOf(last.c), 3.5, 0, Math.PI * 2);
  ctx.fill();
}
function applyTheme(theme) {
  if (theme === 'dark') document.documentElement.setAttribute('data-theme', 'dark');
  else document.documentElement.removeAttribute('data-theme');
  $('themeIcon').innerHTML = theme === 'dark' ? SUN : MOON;
  $('themeToggle').setAttribute('aria-label', theme === 'dark' ? '切换为浅色' : '切换为深色');
  storageSet(localStorage, THEME_KEY, theme);
  drawChart();
}
function logout() {
  userStop = true;
  secret = '';
  clearTimeout(retryTimer);
  storageRemove(sessionStorage, TOKEN_KEY);
  failPending('已退出，未确认。');
  if (heartbeat) clearInterval(heartbeat);
  if (socket) {
    var old = socket;
    socket = null;
    old.onclose = null;
    try { old.close(); } catch (err) {}
  }
  samples = [];
  tempMin = null;
  tempMax = null;
  clearLive('尚未连接', 'off');
  showLogin('');
}
$('themeToggle').onclick = function () {
  applyTheme(document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark');
};
$('logoutButton').onclick = logout;
$('passwordToggle').onclick = function () {
  var input = $('token');
  var show = input.type === 'password';
  input.type = show ? 'text' : 'password';
  this.setAttribute('aria-label', show ? '隐藏口令' : '显示口令');
};
$('loginForm').onsubmit = function (event) {
  event.preventDefault();
  var token = $('token').value.trim();
  if (!TOKEN_RE.test(token)) {
    $('loginError').textContent = '请填写完整设备口令。';
    return;
  }
  $('loginError').textContent = '';
  connect(token, false);
};
$('ledSwitch').onclick = function () {
  sendLed(this.getAttribute('aria-checked') !== 'true');
};
window.addEventListener('resize', drawChart);
if (window.ResizeObserver) new ResizeObserver(drawChart).observe($('chartWrap'));
setInterval(function () {
  if (!online || !lastAt || Date.now() - lastAt < FRESH_MS) return;
  setConnection('数据已过期', 'off');
  setBadge('等待更新', false);
  renderTemp();
  renderLed();
}, 500);
var savedTheme = storageGet(localStorage, THEME_KEY);
if (savedTheme !== 'dark' && savedTheme !== 'light') {
  savedTheme = window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}
applyTheme(savedTheme);
var savedToken = storageGet(sessionStorage, TOKEN_KEY);
if (TOKEN_RE.test(savedToken)) connect(savedToken, false);
window.addEventListener('pageshow', function (event) {
  if (!event.persisted || userStop) return;
  if (socket && socket.readyState === 1) return;
  var again = storageGet(sessionStorage, TOKEN_KEY);
  if (TOKEN_RE.test(again)) connect(again, true);
});
  </script>
</html>`;

/*!
 * Ion+ In-App Preloader Component
 * - Encapsulated Web Component via Shadow DOM (Mode: closed)
 * - Zero global style pollution, zero layout shift (CLS: 0.000)
 * - Deterministic entrance, glowing atom animation, and logo handoff
 * - Guaranteed exit within maxMs failsafe
 * - Dispatches 'ionpl:done' CustomEvent upon full dismissal
 */
(function () {
  'use strict';
  if (typeof window === 'undefined' || window.IonPreloader) return;

  var script = document.currentScript;
  // minMs / maxMs: loads for at least minMs before beginning ignite/handoff (default 5000ms, override via data-min/data-max)
  var cfg = {
    target: (script && script.dataset.target) || '',
    minMs: Number(script && script.dataset.min) || 5000,
    maxMs: Number(script && script.dataset.max) || 12000
  };
  var EXIT = 1700; // ignite (750ms) + handoff (950ms)
  var calm = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  var k = calm ? 0.25 : 1;

  var CSS = `
@font-face{font-family:'Geist';src:url('/static/fonts/Geist-Variable.woff2') format('woff2');font-weight:100 900;font-style:normal;font-display:swap}
:host{all:initial;position:fixed;inset:0;z-index:2147483000;display:block}
*{box-sizing:border-box}
.root{--blue:#2b6fe6;--cyan:#22d3ee;--teal:#3de0b8;position:absolute;inset:0;display:flex;flex-direction:column;
  align-items:center;justify-content:center;gap:24px;color:#eaf2ff;font-family:"Geist",system-ui,"Segoe UI",sans-serif}
.bg{position:absolute;inset:0;transition:opacity .8s ease;background:
  radial-gradient(60% 55% at 50% 48%,rgba(43,111,230,.38),transparent 70%),
  radial-gradient(40% 40% at 62% 56%,rgba(34,211,238,.18),transparent 70%),
  #050b1f}
.out .bg{opacity:0}
.atom{position:relative;width:180px;height:180px;display:grid;place-items:center}
.ring{position:absolute;inset:0;border:1px solid rgba(34,211,238,.34);border-radius:50%;
  transform:rotate(var(--a)) scaleY(.38);animation:fade .9s ease backwards;animation-delay:calc(var(--n)*.18s);
  transition:transform .55s cubic-bezier(.6,0,.9,.4),opacity .4s}
.ring i{position:absolute;inset:0;animation:orbit 1.8s linear infinite}
.ring:nth-child(2) i{animation-duration:2.3s}
.ring:nth-child(3) i{animation-duration:2.9s}
.ring i::after{content:"";position:absolute;top:-4px;left:50%;margin-left:-4px;width:8px;height:8px;border-radius:50%;
  background:var(--teal);box-shadow:0 0 12px 2px var(--cyan)}
.tile{position:relative;z-index:2;width:80px;height:80px;border-radius:22px;display:grid;place-items:center;
  background:linear-gradient(145deg,#fff,#cfe3ff);box-shadow:0 0 40px rgba(34,211,238,.45);
  transition:transform .85s cubic-bezier(.7,0,.2,1),opacity .25s ease}
.tile svg{width:60%;height:60%}
.pulse{position:absolute;width:80px;height:80px;border-radius:50%;border:2px solid var(--cyan);opacity:0}
.ignite .ring{transform:rotate(var(--a)) scaleY(.38) scale(.15);opacity:0}
.ignite .pulse{animation:pulse .9s ease-out}
.ignite .tile{animation:flash .6s ease}
.brand{display:flex;flex-direction:column;align-items:center;gap:3px;user-select:none;margin-top:-6px}
.out .brand{opacity:0;transition:opacity .35s ease}
.brand-eyebrow{font-size:10px;font-weight:600;letter-spacing:.22em;text-transform:uppercase;
  background:linear-gradient(90deg,#38bdf8 0%,#2dd4bf 100%);-webkit-background-clip:text;-webkit-text-fill-color:transparent;
  line-height:1;margin-bottom:2px}
.brand-title{font-size:24px;font-weight:700;letter-spacing:-.035em;line-height:1;display:inline-flex;align-items:baseline}
.brand-name{background:linear-gradient(180deg,#ffffff 0%,#cbd5e1 100%);-webkit-background-clip:text;-webkit-text-fill-color:transparent;
  filter:drop-shadow(0 2px 4px rgba(0,0,0,.45))}
.brand-plus{font-weight:600;font-size:20px;margin-left:1px;color:#38bdf8;transform:translateY(-3px);display:inline-block;
  text-shadow:0 0 12px rgba(56,189,248,.8),0 0 24px rgba(45,212,191,.45)}
.meta{display:flex;flex-direction:column;align-items:center;gap:12px}
.out .meta{opacity:0;transition:opacity .3s}
.bar{width:min(260px,70vw);height:6px;border-radius:99px;background:rgba(255,255,255,.12);overflow:hidden}
.bar b{display:block;height:100%;width:0;border-radius:inherit;transition:width .6s ease;
  background:linear-gradient(90deg,var(--blue),var(--cyan),var(--teal))}
.indet b{width:35%;transition:none;animation:sweep 1.2s ease-in-out infinite alternate}
.step{margin:0;font-size:13px;font-weight:500;letter-spacing:.02em;color:#9db2d6;min-height:1.4em;font-family:inherit}
@keyframes orbit{to{transform:rotate(360deg)}}
@keyframes fade{from{opacity:0}}
@keyframes pulse{from{opacity:.9;transform:scale(.6)}to{opacity:0;transform:scale(3.4)}}
@keyframes flash{50%{box-shadow:0 0 80px 16px rgba(61,224,184,.75)}}
@keyframes sweep{to{transform:translateX(185%)}}
@media (prefers-reduced-motion:reduce){.ring i{animation:none}.pulse{display:none}.indet b{animation:none}}
`;

  var HTML = `
<div class="root">
  <div class="bg"></div>
  <div class="atom">
    <span class="ring" style="--a:0deg;--n:0"><i></i></span>
    <span class="ring" style="--a:60deg;--n:1"><i></i></span>
    <span class="ring" style="--a:120deg;--n:2"><i></i></span>
    <span class="pulse"></span>
    <div class="tile">
      <svg viewBox="0 0 48 48" fill="none" stroke="#2b6fe6" stroke-width="2.2">
        <ellipse cx="24" cy="24" rx="19" ry="7.5"/>
        <ellipse cx="24" cy="24" rx="19" ry="7.5" transform="rotate(60 24 24)"/>
        <ellipse cx="24" cy="24" rx="19" ry="7.5" transform="rotate(120 24 24)"/>
        <circle cx="24" cy="24" r="3.4" fill="#2b6fe6" stroke="none"/>
      </svg>
    </div>
  </div>
  <div class="brand">
    <div class="brand-eyebrow">INTELLIGENCE AT THE CORE</div>
    <div class="brand-title">
      <span class="brand-name">Ion</span><span class="brand-plus">+</span>
    </div>
  </div>
  <div class="meta"><div class="bar indet"><b></b></div><p class="step" role="status"></p></div>
</div>`;

  var host, root, tile, bar, fill, stepEl, t0, finished = false;

  function start(opts) {
    if (host) return;
    if (opts) for (var key in opts) cfg[key] = opts[key];
    host = document.createElement('div');
    host.id = 'ion-preloader-host';
    var sh = host.attachShadow({ mode: 'closed' });
    sh.innerHTML = '<style>' + CSS + '</style>' + HTML;
    root = sh.querySelector('.root');
    tile = sh.querySelector('.tile');
    bar = sh.querySelector('.bar');
    fill = sh.querySelector('.bar b');
    stepEl = sh.querySelector('.step');
    (document.documentElement || document.body).appendChild(host);
    t0 = Date.now();
    setTimeout(finish, Math.max(0, cfg.maxMs - EXIT) * k); // hard cap: gone by maxMs even if finish() is never called
  }

  // Real progress only: call with a label and/or a 0..1 fraction.
  function step(label, fraction) {
    if (!root) return;
    if (label != null) stepEl.textContent = label;
    if (typeof fraction === 'number') {
      bar.classList.remove('indet');
      fill.style.width = Math.max(0, Math.min(1, fraction)) * 100 + '%';
    }
  }

  function finish(err) {
    if (!root || finished) return;
    finished = true;
    if (err) {
      if (stepEl) {
        stepEl.textContent = typeof err === 'string' ? err : (err.message || 'Initialization failed');
        stepEl.style.color = '#ef4444';
      }
      setTimeout(cleanup, 1200);
      return;
    }
    setTimeout(ignite, Math.max(0, cfg.minMs * k - (Date.now() - t0)));
  }

  function ignite() {
    bar.classList.remove('indet');
    fill.style.width = '100%';
    root.classList.add('ignite');
    setTimeout(handoff, 750 * k);
  }

  function handoff() {
    var tgt = cfg.target && document.querySelector(cfg.target);
    var s = tgt && tgt.getBoundingClientRect();
    if (s && s.width) {
      var t = tile.getBoundingClientRect();
      tile.style.transform = 'translate(' + (s.left + s.width / 2 - t.left - t.width / 2) + 'px,' +
        (s.top + s.height / 2 - t.top - t.height / 2) + 'px) scale(' + s.width / t.width + ')';
      setTimeout(function () { tile.style.opacity = '0'; }, 650 * k); // real logo underneath
    } else {
      tile.style.transform = 'scale(1.15)';
      tile.style.opacity = '0';
    }
    root.classList.add('out');
    setTimeout(cleanup, 950 * k);
  }

  function cleanup() {
    if (host && host.parentNode) {
      host.remove();
    }
    window.dispatchEvent(new CustomEvent('ionpl:done'));
  }

  window.IonPreloader = { start: start, step: step, finish: finish };
  if (!(script && script.hasAttribute('data-manual'))) {
    if (document.documentElement || document.body) {
      start();
    } else {
      document.addEventListener('DOMContentLoaded', function () { start(); });
    }
  }
})();

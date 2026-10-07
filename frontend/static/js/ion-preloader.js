/*!
 * Ion+ preloader: fully isolated.
 * - Lives in a Shadow DOM: its CSS cannot leak out, and your Tailwind/page CSS cannot leak in.
 * - No :root / html / body styles, no global CSS variables, no edits to your existing elements.
 * - Only one global: window.IonPreloader. Removes itself when finished.
 *
 * Usage:
 *   <script src="ion-preloader.js" data-target="#your-logo-selector"></script>
 *   IonPreloader.step('Opening history database', 0.5);   // optional, real progress only
 *   IonPreloader.finish();                                  // when the app is really ready
 *   window.addEventListener('ionpl:done', ...);             // fired after it is removed
 * Add data-manual to the script tag to call IonPreloader.start() yourself.
 */
(function () {
  'use strict';
  if (typeof window === 'undefined' || window.IonPreloader) return;

  var script = document.currentScript;
  var cfg = { target: (script && script.dataset.target) || '', minMs: 900, maxMs: 12000 };
  var calm = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  var k = calm ? 0.25 : 1;

  var CSS = `
:host{all:initial;position:fixed;inset:0;z-index:2147483000;display:block}
*{box-sizing:border-box}
.root{--blue:#2b6fe6;--cyan:#22d3ee;--teal:#3de0b8;position:absolute;inset:0;display:flex;flex-direction:column;
  align-items:center;justify-content:center;gap:30px;color:#eaf2ff;font-family:system-ui,"Segoe UI",sans-serif}
.bg{position:absolute;inset:0;transition:opacity .8s ease;background:
  repeating-linear-gradient(90deg,rgba(255,255,255,.04) 0 2px,transparent 2px 46px),
  linear-gradient(100deg,transparent 28%,rgba(43,111,230,.5) 52%,rgba(34,211,238,.42) 68%,rgba(61,224,184,.36) 84%,transparent 100%),
  linear-gradient(180deg,rgba(5,11,31,.35),rgba(5,11,31,.75)),#050b1f}
.out .bg{opacity:0}
.atom{position:relative;width:200px;height:200px;display:grid;place-items:center}
.ring{position:absolute;inset:0;border:1px solid rgba(34,211,238,.34);border-radius:50%;
  transform:rotate(var(--a)) scaleY(.38);animation:fade .9s ease backwards;animation-delay:calc(var(--n)*.18s);
  transition:transform .55s cubic-bezier(.6,0,.9,.4),opacity .4s}
.ring i{position:absolute;inset:0;animation:orbit 1.8s linear infinite}
.ring:nth-child(2) i{animation-duration:2.3s}
.ring:nth-child(3) i{animation-duration:2.9s}
.ring i::after{content:"";position:absolute;top:-4px;left:50%;margin-left:-4px;width:8px;height:8px;border-radius:50%;
  background:var(--teal);box-shadow:0 0 12px 2px var(--cyan)}
.tile{position:relative;z-index:2;width:84px;height:84px;border-radius:24px;display:grid;place-items:center;
  background:linear-gradient(145deg,#fff,#cfe3ff);box-shadow:0 0 40px rgba(34,211,238,.45);
  transition:transform .85s cubic-bezier(.7,0,.2,1),opacity .25s ease}
.tile svg{width:60%;height:60%}
.pulse{position:absolute;width:84px;height:84px;border-radius:50%;border:2px solid var(--cyan);opacity:0}
.ignite .ring{transform:rotate(var(--a)) scaleY(.38) scale(.15);opacity:0}
.ignite .pulse{animation:pulse .9s ease-out}
.ignite .tile{animation:flash .6s ease}
.meta{display:flex;flex-direction:column;align-items:center;gap:12px}
.out .meta{opacity:0;transition:opacity .3s}
.bar{width:min(260px,70vw);height:6px;border-radius:99px;background:rgba(255,255,255,.12);overflow:hidden}
.bar b{display:block;height:100%;width:0;border-radius:inherit;transition:width .6s ease;
  background:linear-gradient(90deg,var(--blue),var(--cyan),var(--teal))}
.indet b{width:35%;transition:none;animation:sweep 1.2s ease-in-out infinite alternate}
.step{margin:0;font-size:14px;color:#9db2d6;min-height:1.4em}
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
    setTimeout(finish, cfg.maxMs); // failsafe: never trap the user behind the loader
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

  function finish() {
    if (!root || finished) return;
    finished = true;
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
      setTimeout(function () { tile.style.opacity = '0'; }, 650 * k); // your real logo is already underneath
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

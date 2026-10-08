/*!
 * atlas-voice.js | Голосовий помічник Business Atlas на Vapi (ТЗ Олега від 07.10.2026, режим C, веб-дзвінок)
 * Куб і інтерфейс з прототипу 18.09.2026; розмова через Vapi Web SDK з публічним ключем.
 * Підключення:
 *   <script src="atlas-voice.js" data-public-key="..." data-assistant="..." defer></script>
 * Атрибути: data-public-key, data-assistant, data-position="right|left", data-demo="true|false".
 * Параметр сторінки ?demo=1: режим показу станів куба без дзвінка.
 */
(function () {
  'use strict';
  if (window.AtlasVoice && window.AtlasVoice.__atlas) return;

  // ------------------------------------------------------------------ налаштування
  var SCRIPT = document.currentScript || (function () {
    var list = document.getElementsByTagName('script');
    for (var i = list.length - 1; i >= 0; i--) {
      if (/atlas-voice[^\/]*\.js/.test(list[i].src || '')) return list[i];
    }
    return null;
  })();

  var SESSION_SEC = 300;
  var SDK_URL = 'https://cdn.jsdelivr.net/npm/@vapi-ai/web@2.7.1/+esm';

  var qs;
  try { qs = new URLSearchParams(location.search); } catch (e) { qs = { get: function () { return null; } }; }
  var ds = (SCRIPT && SCRIPT.dataset) || {};
  var isLocalHost = location.hostname === 'localhost' || location.hostname === '127.0.0.1';

  var CFG = {
    publicKey: ds.publicKey || '',
    assistant: ds.assistant || '',
    position: ds.position === 'left' ? 'left' : 'right',
    demo: ds.demo === 'true' || qs.get('demo') === '1',
    reduced: false
  };
  var mqReduce = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
  CFG.reduced = !!(mqReduce && mqReduce.matches);
  if (mqReduce) {
    var onMq = function () { CFG.reduced = mqReduce.matches; };
    if (mqReduce.addEventListener) mqReduce.addEventListener('change', onMq);
    else if (mqReduce.addListener) mqReduce.addListener(onMq);
  }

  var DEMO_Q = 'Чим ви займаєтесь?';
  var DEMO_A = 'Ми Бізнес Атлас: будуємо AI-агентів, автоматизацію процесів і CRM, щоб бізнес ріс без розширення команди. А я сам приклад голосового агента, якого ми робимо для клієнтів.';
  var DEMO_LISTEN = 'Скажіть, будь ласка, скільки коштує голосовий агент для клініки?';

  var STATES = ['idle', 'listening', 'thinking', 'speaking', 'error', 'ended'];
  var STATUS = {
    idle: 'Натисніть, щоб почати розмову',
    listening: 'Слухаю',
    thinking: 'Думаю',
    speaking: 'Говорю',
    error: 'Щось пішло не так. Спробуйте ще раз.',
    ended: 'Розмову завершено. Дякуємо!'
  };

  var MIC_MSG = {
    denied: 'Доступ до мікрофона заборонено. Дозвольте його в налаштуваннях браузера і спробуйте ще раз.',
    nomic: 'Мікрофон не знайдено. Підключіть мікрофон і спробуйте ще раз.',
    insecure: 'Мікрофон працює тільки на захищеному з\'єднанні (https).',
    unsupported: 'Цей браузер не підтримує голосову розмову. Спробуйте Chrome, Edge або Safari.',
    config: 'Помічник ще не налаштований на цьому сайті.'
  };

  // ------------------------------------------------------------------ стилі
  var CSS = [
    ':host{all:initial}',
    '*,*::before,*::after{box-sizing:border-box}',
    '.root{--bg:#07070F;--bg1:#0D0D1F;--card:#131328;--hover:#1A1A38;--border:rgba(139,92,246,0.2);--t1:#F0EEF8;--t2:#A09DC0;--t3:#5E5B7A;--p1:#7C3AED;--p2:#A78BFA;--pl:#C4B5FD;--o1:#EA580C;--o2:#F97A4C;',
    '--gp:linear-gradient(135deg,#7C3AED 0%,#A78BFA 100%);--go:linear-gradient(135deg,#EA580C 0%,#F97A4C 100%);',
    '--fb:"Inter",-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif;--fd:"Space Grotesk","Inter",-apple-system,"Segoe UI",Arial,sans-serif;',
    'font-family:var(--fb);color:var(--t1);font-size:14px;line-height:1.5;-webkit-font-smoothing:antialiased;-webkit-tap-highlight-color:transparent}',
    'button{font:inherit;color:inherit;border:0;background:none;padding:0;margin:0;cursor:pointer;-webkit-appearance:none;appearance:none}',
    'svg{display:block}',
    '.sr{position:absolute!important;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}',
    'button:focus-visible,a:focus-visible,input:focus-visible{outline:2px solid var(--pl);outline-offset:3px}',

    // кнопка-запуск
    '.launcher{position:fixed;bottom:calc(24px + env(safe-area-inset-bottom,0px));right:calc(24px + env(safe-area-inset-right,0px));width:68px;height:68px;border-radius:50%;z-index:2147483000;',
    'background:radial-gradient(circle at 50% 36%,#211a4a 0%,#100f26 58%,#07070F 100%);border:1px solid rgba(167,139,250,0.38);',
    'box-shadow:0 12px 30px -10px rgba(0,0,0,0.75),0 0 22px rgba(124,58,237,0.32);animation:avGlow 3.8s ease-in-out infinite;',
    'transition:transform .25s cubic-bezier(.22,1,.36,1),opacity .2s ease,visibility 0s}',
    '.left .launcher{right:auto;left:calc(24px + env(safe-area-inset-left,0px))}',
    '.launcher canvas{position:absolute;inset:0;width:100%;height:100%;border-radius:50%;display:block}',
    '.launcher:hover{transform:translateY(-2px) scale(1.05)}',
    '.launcher:active{transform:scale(.97)}',
    '.launcher.hide{opacity:0;transform:scale(.6);pointer-events:none;visibility:hidden;transition:transform .25s,opacity .2s,visibility 0s linear .25s}',
    '.badge{position:absolute;right:-4px;bottom:-4px;width:21px;height:21px;border-radius:50%;background:var(--go);display:flex;align-items:center;justify-content:center;color:#fff;border:2px solid #07070F;box-shadow:0 2px 10px rgba(234,88,12,.5)}',
    '.left .badge{right:auto;left:-3px}',
    '.badge svg{width:11px;height:11px}',
    '.tip{position:absolute;right:calc(100% + 14px);top:50%;transform:translate(8px,-50%);white-space:nowrap;background:#131328;border:1px solid var(--border);color:var(--t1);font-size:13px;font-weight:500;padding:9px 14px;border-radius:12px;opacity:0;pointer-events:none;transition:opacity .25s,transform .25s;box-shadow:0 10px 28px -8px rgba(0,0,0,.6)}',
    '.left .tip{right:auto;left:calc(100% + 14px);transform:translate(-8px,-50%)}',
    '.launcher:hover .tip,.launcher:focus-visible .tip,.launcher.tip-on .tip{opacity:1;transform:translate(0,-50%)}',
    '@keyframes avGlow{0%,100%{box-shadow:0 12px 30px -10px rgba(0,0,0,.75),0 0 16px rgba(124,58,237,.26)}50%{box-shadow:0 12px 30px -10px rgba(0,0,0,.75),0 0 34px rgba(139,92,246,.55)}}',

    // панель
    '.panel{position:fixed;right:calc(24px + env(safe-area-inset-right,0px));bottom:calc(24px + env(safe-area-inset-bottom,0px));width:388px;height:min(680px,calc(100vh - 48px));z-index:2147483001;display:flex;flex-direction:column;overflow-x:hidden;overflow-y:auto;overscroll-behavior:contain;scrollbar-width:thin;scrollbar-color:rgba(139,92,246,.35) transparent;',
    'background:radial-gradient(130% 62% at 50% 24%,rgba(124,58,237,.17) 0%,rgba(13,13,31,0) 62%),linear-gradient(180deg,#10102a 0%,#0B0B1B 55%,#09091a 100%);',
    'border:1px solid var(--border);border-radius:26px;box-shadow:0 34px 90px -24px rgba(0,0,0,.85),0 0 70px -24px rgba(124,58,237,.5),inset 0 1px 0 rgba(255,255,255,.04);',
    'opacity:0;visibility:hidden;transform:translateY(18px) scale(.96);transform-origin:bottom right;transition:opacity .22s ease,transform .32s cubic-bezier(.22,1,.36,1),visibility 0s linear .32s}',
    '.left .panel{right:auto;left:calc(24px + env(safe-area-inset-left,0px));transform-origin:bottom left}',
    '.panel.in{opacity:1;visibility:visible;transform:none;transition:opacity .22s ease,transform .32s cubic-bezier(.22,1,.36,1),visibility 0s}',
    '.panel::before{content:"";position:absolute;left:18%;right:18%;top:0;height:1px;background:linear-gradient(90deg,transparent,rgba(167,139,250,.7),transparent);pointer-events:none}',
    '.head{display:flex;align-items:center;gap:12px;padding:16px 14px 6px 18px;flex:0 0 auto}',
    '.mark{width:36px;height:36px;border-radius:11px;background:var(--gp);display:flex;align-items:center;justify-content:center;font-family:"Audiowide",var(--fd);font-size:12.5px;color:#fff;letter-spacing:.3px;box-shadow:0 6px 16px -4px rgba(124,58,237,.65);flex:0 0 auto}',
    '.ttl{flex:1;min-width:0}',
    '.name{font-family:var(--fd);font-weight:600;font-size:16px;letter-spacing:-.2px;line-height:1.2}',
    '.sub{font-size:12px;color:var(--t2);display:flex;align-items:center;gap:6px;margin-top:2px}',
    '.sdot{width:7px;height:7px;border-radius:50%;background:#8B5CF6;box-shadow:0 0 8px rgba(139,92,246,.8);flex:0 0 auto;transition:background .3s,box-shadow .3s}',
    '.root[data-state=listening] .sdot{background:#C4B5FD;box-shadow:0 0 10px #A78BFA;animation:avPulse 1.1s ease-in-out infinite}',
    '.root[data-state=thinking] .sdot{background:#A78BFA;animation:avBlink .7s steps(2) infinite}',
    '.root[data-state=speaking] .sdot{background:#F97A4C;box-shadow:0 0 10px rgba(249,122,76,.9);animation:avPulse .8s ease-in-out infinite}',
    '.root[data-state=error] .sdot{background:#F87171;box-shadow:0 0 8px rgba(248,113,113,.7)}',
    '.root[data-state=ended] .sdot{background:#5E5B7A;box-shadow:none}',
    '@keyframes avPulse{0%,100%{transform:scale(1)}50%{transform:scale(1.45)}}',
    '@keyframes avBlink{0%{opacity:1}100%{opacity:.35}}',
    '.close{width:36px;height:36px;border-radius:50%;display:flex;align-items:center;justify-content:center;color:var(--t2);background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08);transition:background .2s,color .2s}',
    '.close:hover{background:rgba(255,255,255,.09);color:var(--t1)}',
    '.endb{flex:0 0 auto;height:32px;padding:0 13px;border-radius:999px;font-size:12.5px;font-weight:600;color:#FDBA9A;background:rgba(234,88,12,.1);border:1px solid rgba(249,122,76,.38);transition:background .2s,color .2s}',
    '.endb:hover{background:rgba(234,88,12,.22);color:#fff}',
    '.endb[hidden]{display:none}',
    '.close svg,.kbd svg,.send svg{width:18px;height:18px}',

    '.stage{position:relative;flex:1 1 0;min-height:132px}',
    '.stage canvas{position:absolute;inset:0;width:100%;height:100%;display:block;cursor:default;-webkit-mask-image:linear-gradient(180deg,transparent 0,#000 12%,#000 90%,transparent 100%);mask-image:linear-gradient(180deg,transparent 0,#000 12%,#000 90%,transparent 100%)}',
    '.root[data-state=speaking] .stage canvas{cursor:pointer}',
    '.status{flex:0 0 auto;display:flex;align-items:center;justify-content:center;gap:8px;min-height:22px;padding:0 20px;font-size:13px;font-weight:500;color:var(--pl);text-align:center;letter-spacing:.1px}',
    '.root[data-state=error] .status{color:#FCA5A5}',
    '.root[data-state=ended] .status,.root[data-state=idle] .status{color:var(--t2)}',
    '.eq{display:none;align-items:flex-end;gap:2px;height:14px}',
    '.eq i{display:block;width:3px;border-radius:1.5px;background:currentColor;height:calc(6px + var(--lvl,0) * 7px);transition:height .08s}',
    '.eq i:nth-child(2){height:calc(9px + var(--lvl,0) * 5px)}',
    '.eq i:nth-child(3){height:calc(4px + var(--lvl,0) * 7px)}',
    '.root[data-state=listening] .eq,.root[data-state=speaking] .eq{display:flex}',
    '.dots{display:none}',
    '.root[data-state=thinking] .dots{display:inline-flex;gap:3px}',
    '.dots i{width:4px;height:4px;border-radius:50%;background:currentColor;animation:avDot 1s ease-in-out infinite}',
    '.dots i:nth-child(2){animation-delay:.15s}.dots i:nth-child(3){animation-delay:.3s}',
    '@keyframes avDot{0%,100%{opacity:.25;transform:translateY(0)}50%{opacity:1;transform:translateY(-3px)}}',

    // субтитри: рядок відвідувача закріплений угорі, відповідь прокручується під ним
    '.caps{flex:0 1 116px;min-height:64px;display:flex;flex-direction:column;padding:6px 24px 0;text-align:center}',
    '.cap-user{flex:0 0 auto;font-size:13px;color:var(--t2);line-height:1.45;margin-bottom:4px;display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;overflow:hidden}',
    '.cap-user:empty,.cap-bot:empty{display:none}',
    '.cap-user .who{color:#8E8AAF;font-weight:600;margin-right:4px}',
    '.cap-user.pending::after{content:"\\2026";color:#8E8AAF}',
    '.cap-scroll{flex:1 1 auto;min-height:0;overflow-y:auto;overscroll-behavior:contain;padding:1px 0 4px;scrollbar-width:thin;scrollbar-color:rgba(139,92,246,.35) transparent}',
    '.cap-scroll.fade{-webkit-mask-image:linear-gradient(180deg,transparent 0,#000 26px);mask-image:linear-gradient(180deg,transparent 0,#000 26px)}',
    '.cap-bot{font-size:15.5px;line-height:1.55;color:var(--t1);font-weight:450;text-wrap:pretty}',
    '.cap-bot.long{font-size:14.5px}',
    '.cap-bot.typing::after{content:"";display:inline-block;width:2px;height:1em;margin-left:2px;vertical-align:-2px;background:var(--pl);animation:avBlink .8s steps(2) infinite}',
    '.hint{font-size:13px;color:var(--t2);line-height:1.5;padding:0 6px}',

    '.notice{flex:0 0 auto;margin:6px 16px 0;padding:9px 12px;border-radius:12px;font-size:12.5px;line-height:1.45;color:#FDE2D6;background:rgba(234,88,12,.1);border:1px solid rgba(249,122,76,.3)}',
    '.notice[hidden]{display:none}',

    '.chips{flex:0 0 auto;display:flex;flex-wrap:wrap;justify-content:center;gap:6px;padding:8px 14px 2px}',
    '.chips .lbl{width:100%;text-align:center;font-size:10px;font-weight:600;letter-spacing:1.2px;text-transform:uppercase;color:#8E8AAF}',
    '.chip{font-size:12px;font-weight:500;padding:5px 11px;border-radius:999px;border:1px solid var(--border);background:rgba(139,92,246,.08);color:var(--pl);transition:background .2s,color .2s,border-color .2s}',
    '.chip:hover{background:rgba(139,92,246,.18)}',
    '.chip[aria-pressed=true]{background:var(--gp);color:#fff;border-color:transparent}',
    '.chip.auto{border-color:rgba(249,122,76,.45);color:#FDBA9A;background:rgba(234,88,12,.1)}',
    '.chip.auto[aria-pressed=true]{background:var(--go);color:#fff;border-color:transparent}',

    '.ctrls{flex:0 0 auto;display:grid;grid-template-columns:1fr auto 1fr;align-items:center;padding:10px 26px 4px}',
    '.kbd-slot{justify-self:start;width:48px;height:48px}',
    '.kbd{justify-self:start;width:48px;height:48px;border-radius:50%;display:flex;align-items:center;justify-content:center;color:var(--t2);background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.1);transition:background .2s,color .2s,border-color .2s}',
    '.kbd:hover{color:var(--t1);background:rgba(255,255,255,.08)}',
    '.kbd[aria-pressed=true]{color:#fff;background:rgba(124,58,237,.28);border-color:rgba(167,139,250,.6)}',
    '.main{position:relative;width:76px;height:76px;border-radius:50%;display:flex;align-items:center;justify-content:center;color:#fff;background:var(--gp);box-shadow:0 12px 30px -8px rgba(124,58,237,.75),inset 0 1px 0 rgba(255,255,255,.28);transition:transform .2s,background .3s,box-shadow .3s}',
    '.main:hover{transform:scale(1.04)}',
    '.main:active{transform:scale(.96)}',
    '.main svg{width:28px;height:28px;position:relative}',
    '.main::before{content:"";position:absolute;inset:-9px;border-radius:50%;border:2px solid rgba(167,139,250,.55);opacity:calc(.12 + var(--lvl,0) * .85);transform:scale(calc(1 + var(--lvl,0) * .3));transition:opacity .08s linear,transform .08s linear;pointer-events:none}',
    '.main[data-mode=stop]{background:radial-gradient(circle at 50% 35%,#20204a,#141430);box-shadow:0 12px 30px -10px rgba(0,0,0,.7),inset 0 0 0 1px rgba(167,139,250,.5)}',
    '.main[data-mode=stop] svg{color:var(--o2)}',
    '.main[data-mode=interrupt],.main[data-mode=retry]{background:var(--go);box-shadow:0 12px 30px -8px rgba(234,88,12,.65),inset 0 1px 0 rgba(255,255,255,.25)}',
    '.main[data-mode=interrupt]::before,.main[data-mode=retry]::before{border-color:rgba(249,122,76,.6)}',
    '.timer{justify-self:end;position:relative;width:52px;height:52px;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:600;color:var(--t2);font-variant-numeric:tabular-nums;letter-spacing:.2px}',
    '.timer svg{position:absolute;inset:0;width:100%;height:100%;transform:rotate(-90deg)}',
    '.timer .trk{fill:none;stroke:rgba(255,255,255,.08);stroke-width:2.5}',
    '.timer .prg{fill:none;stroke:#A78BFA;stroke-width:2.5;stroke-linecap:round;transition:stroke-dashoffset .3s linear,stroke .3s}',
    '.timer.off{color:var(--t3)}',
    '.timer.off .prg{stroke:rgba(167,139,250,.35)}',
    '.timer.low{color:var(--o2)}',
    '.timer.low .prg{stroke:#F97A4C}',
    '.tlabel{position:relative}',

    '.tform{flex:0 0 auto;display:flex;gap:8px;padding:8px 16px 2px}',
    '.tform[hidden]{display:none}',
    '.tform input{flex:1;min-width:0;height:44px;border-radius:14px;border:1px solid var(--border);background:#131328;color:var(--t1);padding:0 14px;font:inherit;font-size:16px;outline:none;transition:border-color .2s,box-shadow .2s}',
    '.tform input::placeholder{color:#8E8AAF}',
    '.tform input:focus{border-color:var(--p2);box-shadow:0 0 0 3px rgba(139,92,246,.2)}',
    '.send{width:44px;height:44px;border-radius:14px;flex:0 0 auto;display:flex;align-items:center;justify-content:center;color:#fff;background:var(--gp);box-shadow:0 6px 16px -6px rgba(124,58,237,.7);transition:opacity .2s}',
    '.send:disabled{opacity:.45;cursor:default}',
    '.foot{flex:0 0 auto;text-align:center;font-size:11.5px;color:var(--t2);padding:9px 12px 13px}',
    '.foot a{color:var(--pl);text-decoration:underline;text-underline-offset:2px;text-decoration-color:rgba(196,181,253,.4)}',
    '.foot a:hover{text-decoration-color:var(--pl)}',

    '@media (max-width:480px){',
    '.panel,.left .panel{top:0;left:0;right:0;bottom:0;width:100%;height:100%;border-radius:0;border:0;padding:env(safe-area-inset-top,0px) env(safe-area-inset-right,0px) env(safe-area-inset-bottom,0px) env(safe-area-inset-left,0px);transform-origin:bottom center}',
    '.launcher{width:62px;height:62px;right:calc(16px + env(safe-area-inset-right,0px));bottom:calc(16px + env(safe-area-inset-bottom,0px))}',
    '.left .launcher{left:calc(16px + env(safe-area-inset-left,0px))}',
    '.tip{display:none}',
    '.caps{flex-basis:150px}',
    '.ctrls{padding:10px 30px 6px}',
    '.close{width:44px;height:44px}',
    '.endb{height:40px;padding:0 15px}',
    '}',
    // низькі екрани (ноутбук з масштабом 125%, телефон горизонтально, відкрита клавіатура): середина стискається
    '@media (max-height:720px){.head{padding-top:12px}.stage{min-height:100px}.caps{flex-basis:104px;min-height:52px}.chips{padding-top:6px}.chips .lbl{display:none}.ctrls{padding:6px 26px 2px}.main{width:64px;height:64px}.kbd{width:44px;height:44px}.timer{width:48px;height:48px}.foot{padding:6px 12px 10px}}',
    '@media (max-height:470px){.stage{min-height:72px}.caps{flex-basis:78px;min-height:44px}.hint{font-size:12px}.main{width:56px;height:56px}.main svg{width:24px;height:24px}.chips{flex-wrap:nowrap;overflow-x:auto;justify-content:flex-start;scrollbar-width:none}.chip{flex:0 0 auto}}',
    '@media (prefers-reduced-motion:reduce){.launcher{animation:none}.root .sdot{animation:none!important}.panel,.panel.in,.launcher{transition:opacity .15s,visibility 0s}.dots i,.cap-bot.typing::after{animation:none}.main::before,.eq i{transition:none}}'
  ].join('\n');

  // ------------------------------------------------------------------ куб: 3D на Canvas 2D
  var POINTER = { x: 0, y: 0, has: false };
  window.addEventListener('pointermove', function (e) {
    POINTER.x = e.clientX; POINTER.y = e.clientY; POINTER.has = true;
  }, { passive: true });

  function mRx(a) { var c = Math.cos(a), s = Math.sin(a); return [1, 0, 0, 0, c, -s, 0, s, c]; }
  function mRy(a) { var c = Math.cos(a), s = Math.sin(a); return [c, 0, s, 0, 1, 0, -s, 0, c]; }
  function mRz(a) { var c = Math.cos(a), s = Math.sin(a); return [c, -s, 0, s, c, 0, 0, 0, 1]; }
  function mMul(A, B) {
    var r = new Array(9);
    for (var i = 0; i < 3; i++) {
      for (var j = 0; j < 3; j++) r[i * 3 + j] = A[i * 3] * B[j] + A[i * 3 + 1] * B[3 + j] + A[i * 3 + 2] * B[6 + j];
    }
    return r;
  }
  function mApply(M, x, y, z, out) {
    out[0] = M[0] * x + M[1] * y + M[2] * z;
    out[1] = M[3] * x + M[4] * y + M[5] * z;
    out[2] = M[6] * x + M[7] * y + M[8] * z;
    return out;
  }
  function mAxis(axis, a) { return axis === 0 ? mRx(a) : axis === 1 ? mRy(a) : mRz(a); }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function easeInOut(p) { return p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2; }
  function easeOut(p) { return 1 - Math.pow(1 - p, 3); }

  var FACES = [
    { n: [1, 0, 0], c: [1, 3, 7, 5] },
    { n: [-1, 0, 0], c: [0, 4, 6, 2] },
    { n: [0, 1, 0], c: [2, 6, 7, 3] },
    { n: [0, -1, 0], c: [0, 1, 5, 4] },
    { n: [0, 0, 1], c: [4, 5, 7, 6] },
    { n: [0, 0, -1], c: [0, 2, 3, 1] }
  ];
  var EDGES = [0, 1, 2, 3, 4, 5, 6, 7, 0, 2, 1, 3, 4, 6, 5, 7, 0, 4, 1, 5, 2, 6, 3, 7];
  var CORNERS = [];
  for (var cix = 0; cix < 8; cix++) CORNERS.push([(cix & 1) ? 1 : -1, (cix & 2) ? 1 : -1, (cix & 4) ? 1 : -1]);
  var TINTS = [0.9, -0.6, -0.2, 0.7, -0.9, 0.3, 0.6, -0.45];

  // світло з верхнього лівого переднього боку (камера дивиться вздовж +z)
  var LX = 0.4, LY = 0.75, LZ = -0.5;
  (function () { var l = Math.sqrt(LX * LX + LY * LY + LZ * LZ); LX /= l; LY /= l; LZ /= l; })();
  var HX = LX, HY = LY, HZ = LZ - 1;
  (function () { var l = Math.sqrt(HX * HX + HY * HY + HZ * HZ); HX /= l; HY /= l; HZ /= l; })();

  // кольори граней з логотипу бренду (#582187, #8c51c4, #c59ce6) і сайту (#7C3AED, #A78BFA)
  var C_DARK = [54, 18, 104], C_MID = [128, 70, 205], C_LIGHT = [204, 166, 248];
  var C_VIVID = [124, 58, 237], C_DEEP = [80, 30, 140];
  // тони логотипа, трохи світліші, бо грань скляна і лежить на темному тлі
  var T_LIGHT = [206, 170, 246], T_MID = [141, 86, 212], T_DARK = [96, 40, 156];

  function targetsFor(st, l, t) {
    var b;
    switch (st) {
      case 'listening': return { spin: 0.05, explode: 0.08 + l * 0.36, core: 0.55 + l * 0.5, glow: 0.74 + l * 0.5, ring: 0.35 + l * 0.55, scale: 1 + l * 0.07, focus: 1, dim: 0 };
      case 'thinking': return { spin: 0.7, explode: 0.1 + 0.03 * Math.sin(t * 5), core: 0.62 + 0.32 * (0.5 + 0.5 * Math.sin(t * 6.2)), glow: 0.92, ring: 1.25, scale: 0.97, focus: 0, dim: 0 };
      case 'speaking': return { spin: 0.04, explode: 0.05 + l * 0.42, core: 0.6 + l * 0.65, glow: 0.78 + l * 0.55, ring: 0.5 + l * 0.6, scale: 1 + l * 0.09, focus: 1, dim: 0 };
      case 'error': return { spin: 0.08, explode: 0.02, core: 0.12, glow: 0.3, ring: 0.08, scale: 0.94, focus: 0.4, dim: 1 };
      case 'ended': return { spin: 0.16, explode: 0.02, core: 0.3, glow: 0.45, ring: 0.18, scale: 0.97, focus: 0, dim: 0.3 };
      // нерухома поза логотипа для кнопки-запуску, коли анімація не потрібна
      case 'rest': return { spin: 0, explode: 0.012, core: 0.56, glow: 0.64, ring: 0.3, scale: 1, focus: 1, dim: 0 };
      default:
        b = Math.sin(t * 1.5);
        return { spin: 0.3, explode: 0.012 + 0.01 * b, core: 0.52 + 0.1 * b, glow: 0.6 + 0.12 * b, ring: 0.3, scale: 1 + 0.012 * b, focus: 0, dim: 0 };
    }
  }

  function createCube(canvas, opts) {
    var ctx = canvas.getContext('2d');
    var mini = !!opts.mini;
    var D = 6.2;
    var P = { spin: 0.3, explode: 0.9, core: 0.1, glow: 0.2, ring: 0.3, scale: 0.72, focus: 0, dim: 0 };
    var yaw = 0.95, pitch = 0.46, tiltX = 0, tiltY = 0;
    var t = Math.random() * 10, last = 0, prevState = '';
    var cubies = [];
    for (var i = 0; i < 8; i++) cubies.push({ p: CORNERS[i].slice(), tint: TINTS[i] });
    var turn = null, nextTurnAt = 0, lastAxis = -1;
    var ripples = [], lastRipple = 0, lvlAvg = 0;
    var ringPh = [0.4, 2.3];
    var RINGS = mini
      ? [{ R: 1.8, base: mMul(mRx(0.42), mRz(0.18)), n: 2, c: [249, 122, 76], sp: 1 },
         { R: 2.0, base: mMul(mRz(-1.05), mRx(0.3)), n: 1, c: [196, 181, 253], sp: -0.8 }]
      : [{ R: 2.05, base: mMul(mRx(0.36), mRz(0.2)), n: 3, c: [249, 122, 76], sp: 1 },
         { R: 2.42, base: mMul(mRz(-1.1), mRx(0.28)), n: 2, c: [196, 181, 253], sp: -0.8 }];
    var dustN = mini ? 6 : 25;
    var dust = [];
    for (var d = 0; d < dustN; d++) {
      dust.push({
        r: (mini ? 1.5 : 1.75) + Math.random() * (mini ? 0.9 : 1.75),
        th: Math.acos(2 * Math.random() - 1), ph: Math.random() * 6.283,
        sp: (0.04 + Math.random() * 0.1) * (Math.random() < 0.5 ? -1 : 1),
        tw: 0.6 + Math.random() * 1.8, tp: Math.random() * 6.283,
        sz: 0.5 + Math.random() * 1.1, o: Math.random() < 0.22
      });
    }
    var WV = new Float32Array(8 * 8 * 3), SV = new Float32Array(8 * 8 * 2);
    var RP = [new Float32Array(97 * 3), new Float32Array(97 * 3)];
    var tmp = [0, 0, 0], rgb = [0, 0, 0];
    var dimK = 0;
    var rectCache = null, rectAt = 0;

    function col(r, g, b, a) {
      if (dimK > 0.002) {
        var lum = r * 0.3 + g * 0.59 + b * 0.11, dd = dimK * 0.85, m = 1 - dimK * 0.42;
        r = (r + (lum - r) * dd) * m; g = (g + (lum - g) * dd) * m; b = (b + (lum - b) * dd) * m;
        a *= 1 - dimK * 0.35;
      }
      return 'rgba(' + (r < 0 ? 0 : r > 255 ? 255 : r | 0) + ',' + (g < 0 ? 0 : g > 255 ? 255 : g | 0) + ',' +
        (b < 0 ? 0 : b > 255 ? 255 : b | 0) + ',' + (a < 0 ? 0 : a > 1 ? 1 : a).toFixed(3) + ')';
    }
    // тон грані за її напрямком, як на логотипі: верх світлий, лівий бік темний, правий середній
    function tone(nx, ny, tint) {
      var wt = ny > 0 ? ny * ny * 1.6 : 0, wl = nx < 0 ? nx * nx : 0, wr = (nx > 0 ? nx * nx : 0) + 0.15;
      var s = wt + wl + wr;
      rgb[0] = (T_LIGHT[0] * wt + T_DARK[0] * wl + T_MID[0] * wr) / s;
      rgb[1] = (T_LIGHT[1] * wt + T_DARK[1] * wl + T_MID[1] * wr) / s;
      rgb[2] = (T_LIGHT[2] * wt + T_DARK[2] * wl + T_MID[2] * wr) / s;
      var T = tint > 0 ? C_VIVID : C_DEEP, w = Math.abs(tint) * 0.1;
      rgb[0] += (T[0] - rgb[0]) * w; rgb[1] += (T[1] - rgb[1]) * w; rgb[2] += (T[2] - rgb[2]) * w;
      return wt / s;
    }
    function shade(s, tint) {
      var A, B, k;
      if (s < 0.5) { A = C_DARK; B = C_MID; k = s * 2; } else { A = C_MID; B = C_LIGHT; k = (s - 0.5) * 2; }
      rgb[0] = A[0] + (B[0] - A[0]) * k; rgb[1] = A[1] + (B[1] - A[1]) * k; rgb[2] = A[2] + (B[2] - A[2]) * k;
      var T = tint > 0 ? C_VIVID : C_DEEP, w = Math.abs(tint) * 0.2;
      rgb[0] += (T[0] - rgb[0]) * w; rgb[1] += (T[1] - rgb[1]) * w; rgb[2] += (T[2] - rgb[2]) * w;
    }

    var api = {
      lastDraw: 0,
      burst: function (k) {
        if (k === undefined) { P.explode = 0.95; P.scale = 0.7; P.glow = 1.4; P.core = 0.1; return; }
        // легкий «відгук» на дотик: кубики на мить розходяться і світліють
        P.explode = Math.max(P.explode, k); P.glow = Math.max(P.glow, 1 + k); P.scale = Math.min(P.scale, 1 - k * 0.12);
      },
      render: render,
      info: function () { return { yaw: +yaw.toFixed(3), pitch: +pitch.toFixed(3), tiltX: +tiltX.toFixed(3), tiltY: +tiltY.toFixed(3), explode: +P.explode.toFixed(3), core: +P.core.toFixed(3), glow: +P.glow.toFixed(3), spin: +P.spin.toFixed(3), dim: +P.dim.toFixed(3), turning: !!turn }; },
      spawn: function (dir, str) { spawnRipple(performance.now(), dir, str); }
    };

    function spawnRipple(now, dir, str) {
      if (ripples.length > 9) ripples.shift();
      ripples.push({ t0: now, dir: dir, str: str });
    }

    function render(now, st, level) {
      api.lastDraw = now;
      var dt = last ? Math.min(0.06, (now - last) / 1000) : 0.016;
      last = now;
      var rm = CFG.reduced;
      var speedK = rm ? 0.4 : 1;
      t += dt * speedK;

      var cw = canvas.clientWidth, ch = canvas.clientHeight;
      if (!cw || !ch) return;
      var dpr = Math.min(2, window.devicePixelRatio || 1);
      var W = Math.round(cw * dpr), H = Math.round(ch * dpr);
      if (canvas.width !== W || canvas.height !== H) { canvas.width = W; canvas.height = H; }

      if (st !== prevState) {
        if (st === 'thinking') nextTurnAt = now + 220;
        prevState = st;
      }

      // параметри плавно тягнуться до цілей стану
      var l = level || 0;
      var T = targetsFor(st, l, t);
      var kf = 1 - Math.exp(-dt * 12), ks = 1 - Math.exp(-dt * 2.6);
      P.explode += (T.explode - P.explode) * kf;
      P.core += (T.core - P.core) * kf;
      P.glow += (T.glow - P.glow) * kf;
      P.scale += (T.scale - P.scale) * kf;
      P.spin += (T.spin - P.spin) * ks;
      P.ring += (T.ring - P.ring) * ks;
      P.focus += (T.focus - P.focus) * ks;
      P.dim += (T.dim - P.dim) * ks;
      dimK = P.dim;

      // обертання, погляд на людину, нахил за курсором.
      // Поза логотипа (ребро до глядача) повільна, повз фронтальну пласку позу куб проходить швидше,
      // тож у спокої він майже весь час схожий на куб бренду. Коли думає, обертання рівне.
      var phi = yaw - Math.PI / 4, s2 = Math.sin(2 * phi);
      var rateK = st === 'thinking' ? 1 : 0.3 + 1.4 * s2 * s2;
      yaw += P.spin * rateK * dt * speedK;
      if (P.focus > 0.01) {
        var tgt = Math.round((yaw - Math.PI / 4) / (Math.PI / 2)) * (Math.PI / 2) + Math.PI / 4;
        yaw += (tgt - yaw) * (1 - Math.exp(-dt * 3 * P.focus));
      }
      var pitchT = (0.56 + (rm ? 0 : 0.05 * Math.sin(t * 0.45))) * (1 - P.focus) + 0.62 * P.focus;
      pitch += (pitchT - pitch) * ks;
      var px = 0, py = 0;
      if (POINTER.has) {
        if (!rectCache || now - rectAt > 300) { rectCache = canvas.getBoundingClientRect(); rectAt = now; }
        var rc = rectCache;
        px = clamp((POINTER.x - (rc.left + rc.width / 2)) / (window.innerWidth * 0.5 || 1), -1, 1);
        py = clamp((POINTER.y - (rc.top + rc.height / 2)) / (window.innerHeight * 0.5 || 1), -1, 1);
      }
      var tk = 1 - Math.exp(-dt * 3);
      tiltX += (px * 0.22 - tiltX) * tk;
      tiltY += (py * 0.1 - tiltY) * tk;
      var roll = rm ? 0 : 0.035 * Math.sin(t * 0.37);
      var bob = (rm ? 0.015 : 0.075) * Math.sin(t * 1.15);

      var V = mMul(mRx(-(pitch - tiltY)), mRz(roll));
      var M = mMul(V, mRy(yaw - tiltX));

      // шари як у кубика Рубіка, тільки коли думає
      if (turn) {
        var tp = (now - turn.t0) / turn.dur;
        if (tp >= 1) {
          var R90 = mAxis(turn.axis, turn.dir * Math.PI / 2);
          for (var ci = 0; ci < 8; ci++) {
            var pp = cubies[ci].p;
            if (pp[turn.axis] === turn.layer) {
              mApply(R90, pp[0], pp[1], pp[2], tmp);
              pp[0] = Math.round(tmp[0]); pp[1] = Math.round(tmp[1]); pp[2] = Math.round(tmp[2]);
            }
          }
          turn = null;
          nextTurnAt = now + 90 + Math.random() * 260;
        } else {
          turn.angle = turn.dir * Math.PI / 2 * easeInOut(tp);
        }
      }
      if (!turn && st === 'thinking' && !rm && !mini && now >= nextTurnAt) {
        var ax = Math.floor(Math.random() * 3);
        if (ax === lastAxis) ax = (ax + 1 + Math.floor(Math.random() * 2)) % 3;
        lastAxis = ax;
        turn = { axis: ax, layer: Math.random() < 0.5 ? -1 : 1, dir: Math.random() < 0.5 ? -1 : 1, t0: now, dur: 350, angle: 0 };
      }

      // хвилі від піків звуку
      lvlAvg += (l - lvlAvg) * (1 - Math.exp(-dt * 4));
      if (!mini && (st === 'listening' || st === 'speaking')) {
        var gap = rm ? 650 : 230;
        if (l > 0.12 && l > lvlAvg + 0.06 && now - lastRipple > gap) {
          spawnRipple(now, st === 'listening' ? 'in' : 'out', Math.min(1, 0.4 + l));
          lastRipple = now;
        } else if (st === 'listening' && now - lastRipple > (rm ? 2600 : 1500)) {
          spawnRipple(now, 'in', 0.32);
          lastRipple = now;
        }
      }

      var unit = (mini ? Math.min(W, H) * 0.205 : Math.min(W * 0.165, H * 0.2)) * P.scale;
      var cx = W / 2, cy = H * (mini ? 0.5 : 0.47);
      var lw = clamp(unit / 80, 0.55, 1.5) * (mini ? 1 : dpr / 1.6 + 0.4);

      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalCompositeOperation = 'source-over';
      ctx.clearRect(0, 0, W, H);

      // ореол
      var hr = unit * (mini ? 2.6 : 3.4);
      var hg = ctx.createRadialGradient(cx, cy, 0, cx, cy, hr);
      hg.addColorStop(0, col(124, 58, 237, (mini ? 0.2 : 0.24) * P.glow));
      hg.addColorStop(0.4, col(124, 58, 237, (mini ? 0.08 : 0.1) * P.glow));
      hg.addColorStop(1, col(124, 58, 237, 0));
      ctx.fillStyle = hg;
      ctx.fillRect(0, 0, W, H);
      if (!mini) {
        var og = ctx.createRadialGradient(cx, cy, 0, cx, cy, unit * 1.9);
        og.addColorStop(0, col(249, 122, 76, 0.1 * P.core));
        og.addColorStop(1, col(249, 122, 76, 0));
        ctx.fillStyle = og;
        ctx.fillRect(0, 0, W, H);
      }

      // відблиск на «підлозі»
      if (!mini) {
        mApply(V, 0, -1.75, 0, tmp);
        var fk = unit * D / (D + tmp[2]);
        var fx = cx + tmp[0] * fk, fy = cy - tmp[1] * fk;
        var rx = unit * 1.4 * (1 - bob * 1.4), ry = rx * (0.16 + 0.22 * Math.sin(pitch));
        ctx.save();
        ctx.translate(fx, fy);
        ctx.scale(1, ry / rx);
        var sg = ctx.createRadialGradient(0, 0, 0, 0, 0, rx);
        sg.addColorStop(0, col(139, 92, 246, 0.34 * P.glow));
        sg.addColorStop(0.45, col(91, 33, 182, 0.16 * P.glow));
        sg.addColorStop(1, col(60, 20, 120, 0));
        ctx.fillStyle = sg;
        ctx.beginPath(); ctx.arc(0, 0, rx, 0, 6.2832); ctx.fill();
        ctx.restore();
      }

      // хвилі
      if (ripples.length) {
        ctx.globalCompositeOperation = 'lighter';
        var ccx = cx, ccy = cy - bob * unit;
        var life = rm ? 1800 : 1250;
        for (var r = ripples.length - 1; r >= 0; r--) {
          var rp = ripples[r], pr = (now - rp.t0) / life;
          if (pr >= 1) { ripples.splice(r, 1); continue; }
          // найбільша хвиля не виходить за край полотна, щоб не обрізалась прямою лінією
          var R0 = unit * 1.5, R1 = Math.max(R0 * 1.3, Math.min(unit * 3.2, ccy - 3 * lw, W / 2 - 3 * lw));
          var rad = rp.dir === 'out' ? R0 + (R1 - R0) * easeOut(pr) : R1 - (R1 - R0) * easeInOut(pr);
          var al = rp.str * Math.sin(Math.PI * pr) * 0.5;
          var rc0 = rp.dir === 'out' ? [249, 146, 106] : [180, 160, 255];
          ctx.lineWidth = 6 * lw;
          ctx.strokeStyle = col(rc0[0], rc0[1], rc0[2], al * 0.22);
          ctx.beginPath(); ctx.arc(ccx, ccy, rad, 0, 6.2832); ctx.stroke();
          ctx.lineWidth = (1 + 1.6 * rp.str) * lw;
          ctx.strokeStyle = col(rc0[0], rc0[1], rc0[2], al);
          ctx.beginPath(); ctx.arc(ccx, ccy, rad, 0, 6.2832); ctx.stroke();
        }
        ctx.globalCompositeOperation = 'source-over';
      }

      // орбіти: точки
      var ringVis = 0.55 + 0.45 * Math.min(1.3, P.glow);
      var ringMats = [];
      var NR = mini ? 48 : 96;
      for (var k = 0; k < RINGS.length; k++) {
        var rg = RINGS[k];
        ringPh[k] += dt * (0.45 + P.ring * 1.3) * rg.sp * speedK;
        var RMk = mMul(V, mMul(mRy(t * 0.06 * (k ? -1 : 1)), rg.base));
        ringMats.push(RMk);
        var arr = RP[k];
        for (var s = 0; s <= NR; s++) {
          var a = s / NR * 6.2832;
          mApply(RMk, rg.R * Math.cos(a), 0, rg.R * Math.sin(a), tmp);
          arr[s * 3] = tmp[0]; arr[s * 3 + 1] = tmp[1] + bob; arr[s * 3 + 2] = tmp[2];
        }
      }

      function proj(x, y, z) {
        var kk = unit * D / (D + z);
        tmp[0] = cx + x * kk; tmp[1] = cy - y * kk; tmp[2] = kk;
        return tmp;
      }

      function drawDust(back) {
        ctx.globalCompositeOperation = 'lighter';
        for (var q = 0; q < dust.length; q++) {
          var dd = dust[q];
          dd.ph += dd.sp * dt * (0.5 + P.ring * 0.5) * speedK;
          var sx = dd.r * Math.sin(dd.th), x = sx * Math.cos(dd.ph), y = dd.r * Math.cos(dd.th) * 0.72, z = sx * Math.sin(dd.ph);
          var o = mApply(V, x, y, z, rgb);
          var wz = o[2];
          if (back ? wz <= 0 : wz > 0) continue;
          var wx = o[0], wy = o[1];
          proj(wx, wy, wz);
          var tw = 0.5 + 0.5 * Math.sin(t * dd.tw * (rm ? 0.5 : 1) + dd.tp);
          var al = (0.1 + 0.62 * tw * tw * tw) * (0.55 + 0.45 * Math.min(1.2, P.glow)) * (back ? 0.6 : 1);
          var sz = dd.sz * dpr * (tmp[2] / unit) * (mini ? 0.55 : 1) * (0.8 + 0.4 * tw);
          ctx.fillStyle = dd.o ? col(253, 186, 154, al) : col(221, 214, 254, al);
          ctx.beginPath(); ctx.arc(tmp[0], tmp[1], Math.max(0.4, sz), 0, 6.2832); ctx.fill();
        }
        ctx.globalCompositeOperation = 'source-over';
      }

      function drawRings(back) {
        ctx.globalCompositeOperation = 'lighter';
        for (var k2 = 0; k2 < RINGS.length; k2++) {
          var rg2 = RINGS[k2], arr2 = RP[k2];
          var path = new Path2D(), prevAdded = false, any = false;
          for (var s2 = 0; s2 < NR; s2++) {
            var z0 = arr2[s2 * 3 + 2], z1 = arr2[s2 * 3 + 5], mz = (z0 + z1) * 0.5;
            if (back ? mz > 0 : mz <= 0) {
              if (!prevAdded) { proj(arr2[s2 * 3], arr2[s2 * 3 + 1], z0); path.moveTo(tmp[0], tmp[1]); }
              proj(arr2[s2 * 3 + 3], arr2[s2 * 3 + 4], z1); path.lineTo(tmp[0], tmp[1]);
              prevAdded = true; any = true;
            } else prevAdded = false;
          }
          var va = (back ? 0.42 : 1) * ringVis;
          if (any) {
            ctx.lineCap = 'round';
            ctx.lineWidth = (mini ? 2.2 : 5) * lw;
            ctx.strokeStyle = col(167, 139, 250, 0.07 * va);
            ctx.stroke(path);
            ctx.lineWidth = (mini ? 0.8 : 1.1) * lw;
            ctx.strokeStyle = col(196, 181, 253, (mini ? 0.42 : 0.4) * va);
            ctx.stroke(path);
          }
          // супутники
          var RMk2 = ringMats[k2], dir = rg2.sp > 0 ? 1 : -1;
          for (var j = 0; j < rg2.n; j++) {
            var an = ringPh[k2] + j * 6.2832 / rg2.n;
            mApply(RMk2, rg2.R * Math.cos(an), 0, rg2.R * Math.sin(an), tmp);
            var sx2 = tmp[0], sy2 = tmp[1] + bob, sz2 = tmp[2];
            if (back ? sz2 <= 0 : sz2 > 0) continue;
            if (!mini) {
              for (var q2 = 1; q2 <= 7; q2++) {
                var aq = an - q2 * 0.075 * dir;
                mApply(RMk2, rg2.R * Math.cos(aq), 0, rg2.R * Math.sin(aq), tmp);
                proj(tmp[0], tmp[1] + bob, tmp[2]);
                var tr = unit * 0.06 * (1 - q2 / 8) * (tmp[2] / unit);
                ctx.fillStyle = col(rg2.c[0], rg2.c[1], rg2.c[2], 0.32 * (1 - q2 / 8) * va);
                ctx.beginPath(); ctx.arc(tmp[0], tmp[1], Math.max(0.5, tr), 0, 6.2832); ctx.fill();
              }
            }
            proj(sx2, sy2, sz2);
            var rad2 = unit * (mini ? 0.14 : 0.075) * (tmp[2] / unit) * (1 + 0.25 * Math.min(1.3, P.glow));
            var X = tmp[0], Y = tmp[1];
            var gg = ctx.createRadialGradient(X, Y, 0, X, Y, rad2 * 3.2);
            gg.addColorStop(0, col(255, 246, 236, 0.95 * va));
            gg.addColorStop(0.22, col(rg2.c[0], rg2.c[1], rg2.c[2], 0.75 * va));
            gg.addColorStop(1, col(rg2.c[0], rg2.c[1], rg2.c[2], 0));
            ctx.fillStyle = gg;
            ctx.beginPath(); ctx.arc(X, Y, rad2 * 3.2, 0, 6.2832); ctx.fill();
          }
        }
        ctx.globalCompositeOperation = 'source-over';
      }

      drawDust(true);
      drawRings(true);

      // кубики: вершини, грані, сортування художника
      var o2 = 0.5 + P.explode * 0.55, hs = 0.478;
      var TM = turn ? mAxis(turn.axis, turn.angle) : null;
      var MT = TM ? mMul(M, TM) : null;
      var items = [];
      for (var c = 0; c < 8; c++) {
        var p = cubies[c].p;
        var Rm = (TM && p[turn.axis] === turn.layer) ? MT : M;
        var base = c * 24, pb = c * 16;
        for (var v = 0; v < 8; v++) {
          var cr = CORNERS[v];
          mApply(Rm, p[0] * o2 + cr[0] * hs, p[1] * o2 + cr[1] * hs, p[2] * o2 + cr[2] * hs, tmp);
          var wx2 = tmp[0], wy2 = tmp[1] + bob, wz2 = tmp[2];
          WV[base + v * 3] = wx2; WV[base + v * 3 + 1] = wy2; WV[base + v * 3 + 2] = wz2;
          var kk2 = unit * D / (D + wz2);
          SV[pb + v * 2] = cx + wx2 * kk2; SV[pb + v * 2 + 1] = cy - wy2 * kk2;
        }
        for (var f = 0; f < 6; f++) {
          var F = FACES[f], fn = F.n, c4 = F.c;
          mApply(Rm, fn[0], fn[1], fn[2], tmp);
          var nx = tmp[0], ny = tmp[1], nz = tmp[2];
          var xs = 0, ys = 0, zs = 0;
          for (var q3 = 0; q3 < 4; q3++) { var vi = base + c4[q3] * 3; xs += WV[vi]; ys += WV[vi + 1]; zs += WV[vi + 2]; }
          xs /= 4; ys /= 4; zs /= 4;
          items.push({
            z: zs, i: c, f: f, nx: nx, ny: ny, nz: nz,
            front: (xs * nx + ys * ny + (zs + D) * nz) < 0,
            inner: (fn[0] * p[0] + fn[1] * p[1] + fn[2] * p[2]) < 0
          });
        }
      }
      items.push({ z: 0.0001, core: true });
      items.sort(function (a1, b1) { return b1.z - a1.z; });

      var coreX = cx, coreY = cy - bob * unit * D / D;
      var coreR = unit * (0.55 + 0.42 * P.core) * (1 + P.explode * 0.35);
      var gl = Math.min(1.5, P.glow);
      for (var it = 0; it < items.length; it++) {
        var I = items[it];
        if (I.core) {
          var cg = ctx.createRadialGradient(coreX, coreY, 0, coreX, coreY, coreR);
          cg.addColorStop(0, col(255, 240, 224, 0.95 * Math.min(1, P.core)));
          cg.addColorStop(0.2, col(249, 122, 76, 0.85 * Math.min(1, P.core)));
          cg.addColorStop(0.55, col(234, 88, 12, 0.32 * Math.min(1, P.core)));
          cg.addColorStop(1, col(234, 88, 12, 0));
          ctx.fillStyle = cg;
          ctx.beginPath(); ctx.arc(coreX, coreY, coreR, 0, 6.2832); ctx.fill();
          continue;
        }
        var FF = FACES[I.f], cc = FF.c, pb2 = I.i * 16;
        var lam = I.nx * LX + I.ny * LY + I.nz * LZ; if (lam < 0) lam = 0;
        // зовнішні грані мають тони логотипа і щільніше скло, тож куб читається як куб бренду;
        // внутрішні і задні лишаються тьмяним склом
        var al2;
        if (I.front && !I.inner) {
          var topK = tone(I.nx, I.ny, cubies[I.i].tint);
          al2 = mini ? 0.62 + 0.25 * topK : 0.5 + 0.22 * topK + 0.05 * gl;
        } else {
          shade(0.2 + 0.8 * lam, cubies[I.i].tint);
          al2 = I.front ? (mini ? 0.4 + 0.35 * lam : 0.3 + 0.36 * lam + 0.08 * gl) : (mini ? 0.12 : 0.1);
        }
        if (I.inner) al2 *= 0.35;
        var spec = 0;
        if (I.front) { var hd = I.nx * HX + I.ny * HY + I.nz * HZ; if (hd > 0) spec = Math.pow(hd, 16); }
        ctx.beginPath();
        ctx.moveTo(SV[pb2 + cc[0] * 2], SV[pb2 + cc[0] * 2 + 1]);
        ctx.lineTo(SV[pb2 + cc[1] * 2], SV[pb2 + cc[1] * 2 + 1]);
        ctx.lineTo(SV[pb2 + cc[2] * 2], SV[pb2 + cc[2] * 2 + 1]);
        ctx.lineTo(SV[pb2 + cc[3] * 2], SV[pb2 + cc[3] * 2 + 1]);
        ctx.closePath();
        if (mini) {
          ctx.fillStyle = col(rgb[0], rgb[1], rgb[2], al2);
        } else {
          var lg = ctx.createLinearGradient(SV[pb2 + cc[0] * 2], SV[pb2 + cc[0] * 2 + 1], SV[pb2 + cc[2] * 2], SV[pb2 + cc[2] * 2 + 1]);
          var w = 0.04 + spec * 0.55;
          lg.addColorStop(0, col(rgb[0] + (255 - rgb[0]) * w, rgb[1] + (255 - rgb[1]) * w, rgb[2] + (255 - rgb[2]) * w, Math.min(1, al2 * 1.45 + spec * 0.25)));
          lg.addColorStop(1, col(rgb[0], rgb[1], rgb[2], al2 * 0.8));
          ctx.fillStyle = lg;
        }
        ctx.fill();
      }

      // світні ребра: широкий слабкий прохід і тонкий яскравий
      ctx.globalCompositeOperation = 'lighter';
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      // ребра трьох видів: контур великого куба, шви на його гранях, внутрішні і дальні
      var eOut = new Path2D(), eSeam = new Path2D(), eFar = new Path2D();
      for (var c2 = 0; c2 < 8; c2++) {
        var b2 = c2 * 24, p2 = c2 * 16, pc = cubies[c2].p;
        for (var e = 0; e < 24; e += 2) {
          var ea = EDGES[e], eb = EDGES[e + 1];
          var A0 = CORNERS[ea], B0 = CORNERS[eb], match = 0;
          for (var axq = 0; axq < 3; axq++) {
            if (A0[axq] !== B0[axq]) continue;
            if (A0[axq] === pc[axq]) match++;
          }
          var mzz = (WV[b2 + ea * 3 + 2] + WV[b2 + eb * 3 + 2]) * 0.5;
          var path2 = (match === 0 || mzz > 0.35) ? eFar : match === 2 ? eOut : eSeam;
          path2.moveTo(SV[p2 + ea * 2], SV[p2 + ea * 2 + 1]);
          path2.lineTo(SV[p2 + eb * 2], SV[p2 + eb * 2 + 1]);
        }
      }
      var g1 = Math.min(1, gl);
      ctx.lineWidth = (mini ? 2.4 : 6) * lw; ctx.strokeStyle = col(139, 92, 246, 0.035 * gl); ctx.stroke(eFar);
      ctx.lineWidth = (mini ? 0.6 : 0.9) * lw; ctx.strokeStyle = col(196, 181, 253, 0.2 * gl); ctx.stroke(eFar);
      ctx.lineWidth = (mini ? 1.6 : 3) * lw; ctx.strokeStyle = col(167, 139, 250, 0.07 * gl); ctx.stroke(eSeam);
      ctx.lineWidth = (mini ? 0.6 : 1) * lw; ctx.strokeStyle = col(221, 210, 255, 0.42 * g1); ctx.stroke(eSeam);
      ctx.lineWidth = (mini ? 4 : 10) * lw; ctx.strokeStyle = col(139, 92, 246, 0.085 * gl); ctx.stroke(eOut);
      ctx.lineWidth = (mini ? 1.8 : 3.6) * lw; ctx.strokeStyle = col(167, 139, 250, 0.18 * gl); ctx.stroke(eOut);
      ctx.lineWidth = (mini ? 1 : 1.35) * lw; ctx.strokeStyle = col(242, 238, 255, 0.92 * g1); ctx.stroke(eOut);

      // ядро світить крізь скло
      var bg2 = ctx.createRadialGradient(coreX, coreY, 0, coreX, coreY, coreR * 1.8);
      bg2.addColorStop(0, col(255, 196, 160, 0.55 * Math.min(1.2, P.core)));
      bg2.addColorStop(0.35, col(249, 122, 76, 0.22 * Math.min(1.2, P.core)));
      bg2.addColorStop(1, col(234, 88, 12, 0));
      ctx.fillStyle = bg2;
      ctx.beginPath(); ctx.arc(coreX, coreY, coreR * 1.8, 0, 6.2832); ctx.fill();
      var hc = Math.min(1.2, P.core), hr2 = coreR * 0.55;
      var bg3 = ctx.createRadialGradient(coreX, coreY, 0, coreX, coreY, hr2);
      bg3.addColorStop(0, col(255, 236, 214, 0.75 * hc));
      bg3.addColorStop(0.45, col(249, 122, 76, 0.35 * hc));
      bg3.addColorStop(1, col(234, 88, 12, 0));
      ctx.fillStyle = bg3;
      ctx.beginPath(); ctx.arc(coreX, coreY, hr2, 0, 6.2832); ctx.fill();
      ctx.globalCompositeOperation = 'source-over';

      drawRings(false);
      drawDust(false);
    }

    return api;
  }

  // ------------------------------------------------------------------ стан
  var S = {
    state: 'idle', open: false,
    sessionActive: false, connecting: false, gen: 0,
    speech: null, listenSim: null,
    botSpeaking: false, botLevel: 0, micLevel: 0,
    timerEnd: 0, timerId: 0,
    demoRun: null, level: 0, modeChangedAt: 0, lastMainClickAt: 0,
    launchAnimUntil: 0, launchRestUntil: 0, launchHover: false,
    vapi: null, sdkP: null, callId: null
  };
  var DBG = window.__atlasVoiceDebug = {
    state: 'idle', level: 0, lastError: null, callId: null, assistant: CFG.assistant, demo: CFG.demo
  };
  var UI = {};

  function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  // ------------------------------------------------------------------ імітація мовлення (тільки режим показу ?demo=1)
  var VOWELS = /[аеєиіїоуюяaeiouy]/gi;

  function buildSchedule(text, rate) {
    rate = rate || 4.5;
    var step = 1 / rate, syl = [], charT = new Float32Array(text.length + 1), t = 0.1;
    var re = /\S+/g, m, lastEnd = 0, i;
    while ((m = re.exec(text))) {
      var w = m[0], start = m.index;
      for (i = lastEnd; i < start; i++) charT[i] = t;
      var n = (w.match(VOWELS) || []).length || 1;
      for (var k = 0; k < n; k++) syl.push(t + k * step, step * 0.92, 0.55 + 0.45 * Math.random());
      var wd = n * step;
      for (var j = 0; j < w.length; j++) charT[start + j] = t + wd * (j / w.length);
      t += wd;
      var lc = w.charAt(w.length - 1);
      t += /[.!?…]/.test(lc) ? 0.42 : /[,;:]/.test(lc) ? 0.24 : 0.07;
      lastEnd = start + w.length;
    }
    for (i = lastEnd; i <= text.length; i++) charT[i] = t;
    return { syl: syl, charT: charT, total: t + 0.15, idx: 0, lastT: 0 };
  }

  function envAt(sc, tt) {
    if (tt < sc.lastT) sc.idx = 0;
    sc.lastT = tt;
    var s = sc.syl, v = 0;
    for (var i = sc.idx; i < s.length; i += 3) {
      var st = s[i];
      if (st > tt) break;
      var d = s[i + 1];
      if (tt < st + d) {
        var e = s[i + 2] * Math.pow(Math.sin(Math.PI * (tt - st) / d), 1.4);
        if (e > v) v = e;
      } else if (i === sc.idx) sc.idx = i + 3;
    }
    return v * (0.86 + 0.14 * Math.sin(tt * 37));
  }

  function charsAt(sc, tt) {
    var a = sc.charT, lo = 0, hi = a.length - 1;
    if (tt >= a[hi]) return a.length - 1;
    while (lo < hi) { var mid = (lo + hi) >> 1; if (a[mid] <= tt) lo = mid + 1; else hi = mid; }
    return lo;
  }

  function speak(o) {
    return new Promise(function (resolve) {
      finishSpeech('replaced');
      var text = o.text || '', who = o.who || 'bot';
      var sp = { text: text, who: who, sc: buildSchedule(text), resolve: resolve, done: false, loop: !!o.loop, shown: -1, tt: 0, looped: false, p0: performance.now() };
      S.speech = sp;
      setCaption(who, '', true);
      announce(who, text);
      setState(o.visual || (who === 'user' ? 'listening' : 'speaking'), o.status);
    });
  }

  function finishSpeech(reason, sp) {
    sp = sp || S.speech;
    if (!sp || sp.done) return;
    sp.done = true;
    if (S.speech === sp) S.speech = null;
    setCaption(sp.who, sp.text, false);
    sp.resolve(reason);
  }

  function updateSpeech(now) {
    var sp = S.speech;
    if (!sp) return;
    var tt = (now - sp.p0) / 1000;
    if (tt >= sp.sc.total) {
      if (sp.loop) { sp.p0 = now; sp.sc.idx = 0; tt = 0; sp.looped = true; }
      else { finishSpeech('ended', sp); return; }
    }
    sp.tt = tt;
    if (!sp.looped) {
      var n = charsAt(sp.sc, tt);
      if (n !== sp.shown) { sp.shown = n; setCaption(sp.who, sp.text.slice(0, n), n < sp.text.length); }
    }
  }

  function makeListenSim() {
    var sc = buildSchedule(DEMO_LISTEN), t0 = performance.now(), period = sc.total + 1.3;
    return function (now) {
      var tt = ((now - t0) / 1000) % period;
      return tt > sc.total ? 0 : envAt(sc, tt) * 0.85;
    };
  }

  // Рівень для куба: у розмові це рівні з Vapi (голос асистента і мікрофон), у показі імітація
  function currentLevel(now) {
    var sp = S.speech;
    if (sp) return envAt(sp.sc, sp.tt);
    if (S.listenSim && S.state === 'listening') return S.listenSim(now);
    if (S.sessionActive && S.state === 'speaking') return Math.pow(clamp(S.botLevel, 0, 1), 0.6);
    if (S.sessionActive && S.state === 'listening') return Math.pow(clamp(S.micLevel * 2.2, 0, 1), 0.6);
    return 0;
  }

  // ------------------------------------------------------------------ таймер
  // Межу 5 хв тримає сам Vapi (maxDurationSeconds 300); тут тільки показ і запасна зупинка
  function startTimer(sec) {
    S.timerEnd = Date.now() + sec * 1000;
    clearInterval(S.timerId);
    S.timerId = setInterval(tickTimer, 250);
    tickTimer();
  }
  function stopTimer() { clearInterval(S.timerId); S.timerId = 0; }
  function tickTimer() {
    var left = Math.max(0, Math.ceil((S.timerEnd - Date.now()) / 1000));
    renderTimer(left, true);
    if (S.sessionActive && Date.now() - S.timerEnd > 10000) stopCall();
  }

  // ------------------------------------------------------------------ Vapi
  // Збірка +esm на jsDelivr загортає клас двічі, тому шукаємо конструктор
  function pickVapi(mod) {
    if (typeof mod === 'function') return mod;
    if (mod && typeof mod.default === 'function') return mod.default;
    if (mod && mod.default && typeof mod.default.default === 'function') return mod.default.default;
    if (mod && typeof mod.Vapi === 'function') return mod.Vapi;
    return null;
  }

  function getVapi() {
    if (S.vapi) return Promise.resolve(S.vapi);
    if (!S.sdkP) {
      S.sdkP = import(SDK_URL).then(function (mod) {
        var V = pickVapi(mod);
        if (!V) throw new Error('sdk_bad');
        var v = new V(CFG.publicKey);
        bindVapi(v);
        S.vapi = v;
        return v;
      });
      S.sdkP.catch(function () { S.sdkP = null; });
    }
    return S.sdkP;
  }

  function bindVapi(v) {
    v.on('call-start', function () {
      S.connecting = false;
      if (!S.sessionActive) return;
      hideNotice();
      setState('listening');
    });
    v.on('call-end', function () {
      var was = S.sessionActive;
      endConversation();
      if (was && S.state !== 'error') setState('ended');
    });
    v.on('speech-start', function () {
      if (!S.sessionActive) return;
      S.botSpeaking = true;
      setState('speaking');
    });
    v.on('speech-end', function () {
      if (!S.sessionActive) return;
      S.botSpeaking = false; S.botLevel = 0;
      setState('listening');
    });
    v.on('volume-level', function (x) { S.botLevel = +x || 0; });
    v.on('local-volume-level', function (x) { S.micLevel = +x || 0; });
    v.on('message', function (m) {
      if (!m || !S.sessionActive) return;
      if (m.type === 'transcript' && m.transcript) {
        var who = m.role === 'user' ? 'user' : 'bot';
        var fin = m.transcriptType === 'final';
        if (who === 'user') {
          setCaption('user', m.transcript, false);
          if (!fin) UI.capUser.classList.add('pending');
        } else {
          if (fin) S.botFinal = (S.botFinal ? S.botFinal + ' ' : '') + m.transcript;
          setCaption('bot', fin ? S.botFinal : ((S.botFinal ? S.botFinal + ' ' : '') + m.transcript), !fin);
        }
        if (fin) announce(who, m.transcript);
      } else if (m.type === 'speech-update' && m.role === 'assistant' && m.status === 'started') {
        S.botFinal = '';
      }
    });
    v.on('error', function (e) {
      var msg = (e && (e.errorMsg || e.message || (e.error && e.error.message))) || 'unknown';
      DBG.lastError = 'vapi: ' + (typeof msg === 'string' ? msg : JSON.stringify(msg));
      var was = S.sessionActive;
      endConversation();
      if (was || S.connecting) failState(e);
    });
  }

  function failState(e) {
    S.connecting = false;
    var name = e && (e.name || (e.error && e.error.name) || '');
    var txt = String((e && (e.errorMsg || e.message)) || '');
    if (/NotAllowed|Permission|denied/i.test(name + ' ' + txt)) showNotice(MIC_MSG.denied);
    else if (/NotFound|no.*device/i.test(name + ' ' + txt)) showNotice(MIC_MSG.nomic);
    setState('error');
  }

  function micSupportProblem() {
    if (!window.isSecureContext && !isLocalHost) return 'insecure';
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return 'unsupported';
    return '';
  }

  function startCall() {
    stopDemo();
    hideNotice();
    if (!CFG.publicKey || !CFG.assistant) { DBG.lastError = 'config'; showNotice(MIC_MSG.config); setState('error'); return; }
    var problem = micSupportProblem();
    if (problem) { showNotice(MIC_MSG[problem]); setState('error'); return; }
    S.gen++;
    var gen = S.gen;
    S.sessionActive = true; S.connecting = true; S.botSpeaking = false; S.botLevel = 0; S.micLevel = 0; S.botFinal = '';
    clearCaptions();
    startTimer(SESSION_SEC);
    setState('thinking', 'З\'єдную');
    getVapi().then(function (v) {
      if (gen !== S.gen || !S.sessionActive) return;
      // Веб-дзвінок: переведення на телефон не робимо (ТЗ, режим C)
      return v.start(CFG.assistant, { variableValues: { transfer_allowed: 'ні' } }).then(function (call) {
        if (call && call.id) { S.callId = call.id; DBG.callId = call.id; }
        if (gen !== S.gen) { try { v.stop(); } catch (e) {} }
      });
    }).catch(function (e) {
      if (gen !== S.gen) return;
      DBG.lastError = 'start: ' + ((e && (e.errorMsg || e.message)) || 'failed');
      endConversation();
      failState(e);
    });
  }

  function stopCall() {
    var v = S.vapi;
    endConversation();
    if (v) { try { v.stop(); } catch (e) {} }
  }

  function endConversation() {
    if (!S.sessionActive) return;
    S.sessionActive = false; S.connecting = false; S.botSpeaking = false; S.botLevel = 0; S.micLevel = 0;
    S.gen++;
    stopTimer();
    renderTimer(Math.max(0, Math.ceil((S.timerEnd - Date.now()) / 1000)), false);
    updateControls();
  }

  window.addEventListener('pagehide', function () { if (S.sessionActive) stopCall(); });

  // ------------------------------------------------------------------ інтерфейс
  var ICON = {
    mic: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="3" width="6" height="11.5" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21M8.5 21h7"/></svg>',
    stop: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6.5" y="6.5" width="11" height="11" rx="2.6" fill="currentColor"/></svg>',
    skip: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6.2 5.6c0-.8.9-1.3 1.6-.8l8.2 5.9c.6.4.6 1.3 0 1.7l-8.2 5.9c-.7.5-1.6 0-1.6-.8z" fill="currentColor"/><rect x="16.6" y="5" width="2.9" height="14" rx="1.3" fill="currentColor"/></svg>',
    retry: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 12a8 8 0 1 1-2.35-5.65"/><path d="M20 4v5h-5"/></svg>',
    kbd: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2.5" y="6" width="19" height="12" rx="2.5"/><path d="M6.5 10h.01M10 10h.01M13.5 10h.01M17 10h.01M6.5 14h.01M17 14h.01M9.5 14h5"/></svg>',
    send: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h13M13 6l6 6-6 6"/></svg>',
    close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>',
    micSmall: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M6 11a6 6 0 0 0 12 0M12 17v3"/></svg>'
  };
  var MAIN_MODE = {
    start: { icon: ICON.mic, label: 'Почати розмову' },
    mic: { icon: ICON.mic, label: 'Говорити голосом' },
    stop: { icon: ICON.stop, label: 'Завершити розмову' },
    interrupt: { icon: ICON.skip, label: 'Перервати відповідь' },
    retry: { icon: ICON.retry, label: 'Спробувати ще раз' }
  };
  var DEMO_CHIPS = [['idle', 'Спокій'], ['listening', 'Слухає'], ['thinking', 'Думає'], ['speaking', 'Говорить'], ['error', 'Помилка'], ['auto', 'Автодемо']];
  var RING_LEN = 2 * Math.PI * 23;

  function buildUI() {
    var host = document.createElement('div');
    host.id = 'atlas-voice-root';
    host.setAttribute('data-atlas-voice', '');
    var root = host.attachShadow({ mode: 'open' });
    var chips = '';
    if (CFG.demo) {
      chips = '<div class="chips" role="group" aria-label="Режим показу"><span class="lbl">Режим показу</span>';
      for (var i = 0; i < DEMO_CHIPS.length; i++) {
        chips += '<button type="button" class="chip' + (DEMO_CHIPS[i][0] === 'auto' ? ' auto' : '') + '" data-chip="' + DEMO_CHIPS[i][0] + '" aria-pressed="false">' + DEMO_CHIPS[i][1] + '</button>';
      }
      chips += '</div>';
    }
    root.innerHTML =
      '<style>' + CSS + '</style>' +
      '<div class="root ' + CFG.position + '" data-state="idle">' +
        '<button type="button" class="launcher" aria-label="Поговорити з помічником Бізнес Атлас" aria-haspopup="dialog" aria-expanded="false">' +
          '<canvas aria-hidden="true"></canvas>' +
          '<span class="badge" aria-hidden="true">' + ICON.micSmall + '</span>' +
          '<span class="tip" aria-hidden="true">Поговоріть з нами голосом</span>' +
        '</button>' +
        '<section class="panel" role="dialog" aria-label="Голосовий помічник Бізнес Атлас" aria-hidden="true">' +
          '<div class="head">' +
            '<div class="mark" aria-hidden="true">BA²</div>' +
            '<div class="ttl"><div class="name">Бізнес Атлас</div><div class="sub"><span class="sdot" aria-hidden="true"></span>Голосовий помічник</div></div>' +
            '<button type="button" class="endb" hidden>Завершити</button>' +
            '<button type="button" class="close" aria-label="Закрити помічника">' + ICON.close + '</button>' +
          '</div>' +
          '<div class="stage"><canvas class="cube" aria-hidden="true"></canvas></div>' +
          '<div class="status" role="status" aria-live="polite"><span class="eq" aria-hidden="true"><i></i><i></i><i></i></span><span class="dots" aria-hidden="true"><i></i><i></i><i></i></span><span class="stext">' + STATUS.idle + '</span></div>' +
          '<div class="caps">' +
            '<div class="cap-user" aria-hidden="true"></div>' +
            '<div class="cap-scroll">' +
              '<p class="hint">Спитайте, чим ми займаємось, скільки коштує AI-агент або як записатися на безкоштовну консультацію.</p>' +
              '<div class="cap-bot" aria-hidden="true"></div>' +
            '</div>' +
            '<div class="sr live" aria-live="polite" aria-atomic="true"></div>' +
          '</div>' +
          '<div class="notice" role="alert" hidden></div>' +
          chips +
          '<div class="ctrls">' +
            '<span class="kbd-slot" aria-hidden="true"></span>' +
            '<button type="button" class="main" data-mode="start" aria-label="Почати розмову">' + ICON.mic + '</button>' +
            '<div class="timer off" role="timer" aria-label="Залишок часу розмови">' +
              '<svg viewBox="0 0 52 52" aria-hidden="true"><circle class="trk" cx="26" cy="26" r="23"/><circle class="prg" cx="26" cy="26" r="23" stroke-dasharray="' + RING_LEN.toFixed(2) + '" stroke-dashoffset="0"/></svg>' +
              '<span class="tlabel">5:00</span>' +
            '</div>' +
          '</div>' +
          '<div class="foot">AI-помічник. Розмову записуємо. <a href="https://businessatlas.space/privacy" target="_blank" rel="noopener">Політика конфіденційності</a></div>' +
        '</section>' +
      '</div>';
    (document.body || document.documentElement).appendChild(host);

    var q = function (s) { return root.querySelector(s); };
    UI.host = host; UI.shadow = root;
    UI.root = q('.root'); UI.launcher = q('.launcher'); UI.panel = q('.panel');
    UI.cubeCanvas = q('.stage canvas'); UI.launchCanvas = q('.launcher canvas');
    UI.status = q('.stext'); UI.caps = q('.caps'); UI.scroll = q('.cap-scroll'); UI.hint = q('.hint');
    UI.capUser = q('.cap-user'); UI.capBot = q('.cap-bot'); UI.live = q('.live');
    UI.notice = q('.notice'); UI.main = q('.main');
    UI.timer = q('.timer'); UI.tlabel = q('.tlabel'); UI.prg = q('.prg');
    UI.close = q('.close'); UI.endb = q('.endb'); UI.chips = root.querySelectorAll('.chip');

    UI.launcher.addEventListener('click', function () { open(); });
    UI.close.addEventListener('click', function () { close(); });
    UI.endb.addEventListener('click', function () {
      if (!S.sessionActive) return;
      stopCall();
      setState('ended');
      try { UI.main.focus({ preventScroll: true }); } catch (e) {}
    });
    UI.main.addEventListener('click', onMain);
    UI.cubeCanvas.addEventListener('click', onCubeTap);
    for (var c = 0; c < UI.chips.length; c++) {
      UI.chips[c].addEventListener('click', function (e) { demoChip(e.currentTarget.getAttribute('data-chip')); });
    }
    // прокрутка субтитрів колесом навіть якщо сторінка перехоплює колесо глобально
    UI.scroll.addEventListener('wheel', function (e) {
      if (UI.scroll.scrollHeight <= UI.scroll.clientHeight) return;
      UI.scroll.scrollTop += e.deltaY;
      e.preventDefault(); e.stopPropagation();
    }, { passive: false });
    UI.scroll.addEventListener('scroll', updateFade, { passive: true });
    document.addEventListener('keydown', onKey);
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden) startLoop();
    });
    // живий куб на кнопці-запуску тільки при наведенні чи фокусі, інакше нерухомий кадр
    var wake = function () { S.launchHover = true; startLoop(); };
    var sleep = function () { if (S.launchHover) { S.launchHover = false; S.launchRestUntil = performance.now() + 1400; startLoop(); } };
    UI.launcher.addEventListener('pointerenter', wake);
    UI.launcher.addEventListener('pointerleave', sleep);
    UI.launcher.addEventListener('focus', function () {
      var fv = true;
      try { fv = UI.launcher.matches(':focus-visible'); } catch (e) {}
      if (fv) wake();
    });
    UI.launcher.addEventListener('blur', sleep);
    window.addEventListener('resize', function () { if (!S.open) { S.launchRestUntil = performance.now() + 300; startLoop(); } });

    panelCube = createCube(UI.cubeCanvas, { mini: false });
    DBG.cube = function () { return panelCube.info(); };
    launchCube = createCube(UI.launchCanvas, { mini: true });
    updateControls();
    renderTimer(SESSION_SEC, false);
    var t0 = performance.now();
    S.launchAnimUntil = CFG.reduced ? 0 : t0 + 6000;
    S.launchRestUntil = (CFG.reduced ? t0 : S.launchAnimUntil) + 1400;

    // підказка біля кнопки один раз за відвідування, а не на кожній сторінці
    var tipSeen = false;
    try { tipSeen = sessionStorage.getItem('atlasVoiceTip') === '1'; } catch (e) {}
    if (!tipSeen) {
      setTimeout(function () {
        if (S.open) return;
        UI.launcher.classList.add('tip-on');
        try { sessionStorage.setItem('atlasVoiceTip', '1'); } catch (e) {}
        setTimeout(function () { UI.launcher.classList.remove('tip-on'); }, 5000);
      }, 1400);
    }
    startLoop();
  }

  function isFullScreen() {
    return !!(window.matchMedia && window.matchMedia('(max-width:480px)').matches);
  }

  function onKey(e) {
    if (!S.open) return;
    var inWidget = document.activeElement === UI.host;
    if (e.key === 'Escape' || e.key === 'Esc') {
      // під час розмови Esc закриває панель тільки з фокусом у віджеті (або на весь екран)
      if (S.sessionActive && !inWidget && !isFullScreen()) return;
      e.stopPropagation();
      close();
      return;
    }
    // на весь екран панель модальна: Tab ходить по колу всередині неї
    if (e.key === 'Tab' && isFullScreen()) {
      var list = [].filter.call(UI.panel.querySelectorAll('button,input,a[href]'), function (el) {
        return !el.disabled && !el.hidden && el.offsetParent !== null;
      });
      if (!list.length) return;
      var cur = inWidget ? UI.shadow.activeElement : null, i = list.indexOf(cur);
      if (i < 0) { e.preventDefault(); list[0].focus(); return; }
      if (e.shiftKey && i === 0) { e.preventDefault(); list[list.length - 1].focus(); }
      else if (!e.shiftKey && i === list.length - 1) { e.preventDefault(); list[0].focus(); }
    }
  }

  function updateFade() {
    if (!UI.scroll) return;
    UI.scroll.classList.toggle('fade', UI.scroll.scrollTop > 2);
  }

  var panelCube = null, launchCube = null;

  function setState(name, statusText) {
    if (STATES.indexOf(name) < 0) return;
    if (name !== 'listening' && !S.demoRun) S.listenSim = null;
    S.state = name;
    DBG.state = name;
    if (UI.root) UI.root.setAttribute('data-state', name);
    setStatus(statusText || STATUS[name]);
    updateControls();
  }

  function setStatus(text) { if (UI.status && UI.status.textContent !== text) UI.status.textContent = text; }

  function mainMode() {
    if (!S.sessionActive) return S.state === 'error' ? 'retry' : 'start';
    return 'stop';
  }

  function updateControls() {
    if (!UI.main) return;
    var m = mainMode();
    if (UI.main.getAttribute('data-mode') !== m || !UI.main.firstChild) {
      UI.main.setAttribute('data-mode', m);
      S.modeChangedAt = performance.now();
      UI.main.innerHTML = MAIN_MODE[m].icon;
      UI.main.setAttribute('aria-label', MAIN_MODE[m].label);
      UI.main.title = MAIN_MODE[m].label;
    }
    if (UI.endb) UI.endb.hidden = !S.sessionActive;
  }

  function renderTimer(left, active) {
    if (!UI.tlabel) return;
    var txt = Math.floor(left / 60) + ':' + ('0' + (left % 60)).slice(-2);
    if (UI.tlabel.textContent !== txt) UI.tlabel.textContent = txt;
    UI.prg.setAttribute('stroke-dashoffset', (RING_LEN * (1 - clamp(left / SESSION_SEC, 0, 1))).toFixed(2));
    UI.timer.classList.toggle('off', !active);
    UI.timer.classList.toggle('low', active && left <= 30);
    UI.timer.setAttribute('aria-label', 'Залишок часу розмови ' + txt);
  }

  function setCaption(who, text, typing) {
    if (!UI.capBot) return;
    var el = who === 'user' ? UI.capUser : UI.capBot;
    if (who === 'user') {
      el.classList.remove('pending');
      el.innerHTML = '';
      if (text) {
        var w = document.createElement('span');
        w.className = 'who'; w.textContent = 'Ви:';
        el.appendChild(w);
        el.appendChild(document.createTextNode(text));
      }
    } else {
      if (el.textContent !== text) el.textContent = text;
      // довга відповідь трохи дрібнішим шрифтом, щоб більше вміщалось без прокрутки
      if (typing || text) el.classList.toggle('long', ((S.speech && S.speech.text) || text).length > 200);
    }
    el.classList.toggle('typing', !!typing && who !== 'user');
    UI.hint.style.display = (UI.capUser.textContent || UI.capBot.textContent || typing) ? 'none' : '';
    if (who !== 'user') {
      if (typing) UI.scroll.scrollTop = UI.scroll.scrollHeight;
      else if (!text) UI.scroll.scrollTop = 0;
      updateFade();
    }
  }

  function setUserPending() {
    if (!UI.capUser) return;
    UI.capUser.innerHTML = '<span class="who">Ви:</span>';
    UI.capUser.classList.add('pending');
    UI.hint.style.display = 'none';
  }

  function announce(who, text) {
    if (!UI.live || !text) return;
    UI.live.textContent = (who === 'user' ? 'Ви: ' : 'Бізнес Атлас: ') + text;
  }

  function clearCaptions() {
    if (!UI.capBot) return;
    UI.capUser.innerHTML = ''; UI.capUser.classList.remove('pending');
    UI.capBot.textContent = ''; UI.capBot.classList.remove('typing'); UI.capBot.classList.remove('long');
    UI.live.textContent = '';
    UI.hint.style.display = '';
    UI.scroll.scrollTop = 0;
    updateFade();
  }

  function showNotice(text) { S.audioNotice = false; if (UI.notice) { UI.notice.textContent = text; UI.notice.hidden = false; } }
  function hideNotice() { S.audioNotice = false; if (UI.notice) { UI.notice.hidden = true; UI.notice.textContent = ''; } }

  function onMain(e) {
    // подвійний клік чи дотик: друге натискання ігноруємо, бо після першого кнопка вже змінила сенс
    if (e && e.detail > 1) return;
    var now = performance.now();
    if (now - S.lastMainClickAt < 600) return;
    S.lastMainClickAt = now;
    if (S.demoRun || S.speech) stopDemo();
    var m = mainMode();
    if (S.modeChangedAt && now - S.modeChangedAt < (m === 'start' ? 800 : 350)) return;
    if (m === 'start' || m === 'retry') { startCall(); return; }
    stopCall();
    setState('ended');
  }

  // Дотик до куба: тільки спалах, розмову не починає і не перебиває (перебивають голосом)
  function onCubeTap() {
    if (panelCube && !CFG.reduced && S.state !== 'thinking') panelCube.burst(0.35);
  }

  function open() {
    if (!UI.panel) return;
    if (S.open) return;
    S.open = true;
    UI.panel.classList.add('in');
    UI.panel.setAttribute('aria-hidden', 'false');
    UI.launcher.classList.add('hide');
    UI.launcher.classList.remove('tip-on');
    UI.launcher.setAttribute('aria-expanded', 'true');
    UI.panel.setAttribute('aria-modal', isFullScreen() ? 'true' : 'false');
    if (panelCube) panelCube.burst();
    startLoop();
    setTimeout(function () { try { UI.main.focus({ preventScroll: true }); } catch (e) {} }, 60);
  }

  function close() {
    if (!UI.panel || !S.open) return;
    stopDemo();
    if (S.sessionActive) stopCall();
    finishSpeech('stopped');
    S.open = false;
    UI.panel.classList.remove('in');
    UI.panel.setAttribute('aria-hidden', 'true');
    UI.launcher.classList.remove('hide');
    UI.launcher.setAttribute('aria-expanded', 'false');
    setState('idle');
    clearCaptions();
    hideNotice();
    renderTimer(SESSION_SEC, false);
    markChip(null);
    S.launchAnimUntil = performance.now() + 2500;
    S.launchRestUntil = S.launchAnimUntil + 1400;
    startLoop();
    try { UI.launcher.focus({ preventScroll: true }); } catch (e) {}
  }

  // ------------------------------------------------------------------ режим показу
  function markChip(name) {
    if (!UI.chips) return;
    for (var i = 0; i < UI.chips.length; i++) {
      UI.chips[i].setAttribute('aria-pressed', UI.chips[i].getAttribute('data-chip') === name ? 'true' : 'false');
    }
  }

  function stopDemo() {
    S.demoRun = null;
    if (S.speech) finishSpeech('stopped');
    S.listenSim = null;
    markChip(null);
  }

  function demoChip(name) {
    if (S.sessionActive) stopCall();
    stopDemo();
    hideNotice();
    markChip(name);
    switch (name) {
      case 'idle': clearCaptions(); setState('idle'); break;
      case 'listening': clearCaptions(); S.listenSim = makeListenSim(); setState('listening'); break;
      case 'thinking': setState('thinking'); break;
      case 'speaking': clearCaptions(); speak({ text: DEMO_A, simulate: true, loop: true }); break;
      case 'error': clearCaptions(); setState('error', 'Немає зв\'язку з сервером. Спробуйте ще раз.'); break;
      case 'auto': runAutoDemo(); break;
    }
    markChip(name);
  }

  function runAutoDemo() {
    var token = {};
    S.demoRun = token;
    function alive() { return S.demoRun === token; }
    clearCaptions();
    setState('idle', 'Автодемо: відвідувач ставить питання');
    wait(600).then(function () {
      if (!alive()) return;
      S.listenSim = null;
      return speak({ text: DEMO_Q, who: 'user', simulate: true, visual: 'listening' });
    }).then(function () {
      if (!alive()) return;
      setState('listening');
      return wait(900);
    }).then(function () {
      if (!alive()) return;
      setState('thinking');
      return wait(1500);
    }).then(function () {
      if (!alive()) return;
      return speak({ text: DEMO_A, simulate: true });
    }).then(function () {
      if (!alive()) return;
      S.demoRun = null;
      markChip(null);
      setState('idle', 'Автодемо завершено. Спробуйте самі');
    });
  }

  // ------------------------------------------------------------------ цикл малювання
  // Малюємо тільки коли панель відкрита і вкладка видима. Закрита панель: куб на кнопці живий кілька
  // секунд після завантаження, при наведенні чи фокусі, потім стає в позу логотипа і цикл зупиняється.
  var rafId = 0;
  function startLoop() { if (!rafId && !document.hidden) rafId = requestAnimationFrame(loop); }
  function loop() {
    rafId = 0;
    if (document.hidden) return;
    var now = performance.now();
    if (S.open) {
      updateSpeech(now);
      var raw = currentLevel(now);
      var dtl = S.__lt ? Math.min(0.1, (now - S.__lt) / 1000) : 0.016;
      S.__lt = now;
      S.level += (raw - S.level) * (1 - Math.exp(-dtl * (raw > S.level ? 28 : 7)));
      if (S.level < 0.001) S.level = 0;
      DBG.level = Math.round(S.level * 1000) / 1000;
      var lv = (S.state === 'listening' || S.state === 'speaking') ? S.level : 0;
      if (Math.abs((S.__cssLvl || 0) - lv) > 0.01) { S.__cssLvl = lv; UI.root.style.setProperty('--lvl', lv.toFixed(3)); }
      // не частіше ~60 кадрів на секунду навіть на екранах 120 Гц
      if (panelCube && now - panelCube.lastDraw >= 15) { panelCube.render(now, S.state, S.level); DBG.frames = (DBG.frames || 0) + 1; }
    } else {
      S.__lt = 0;
      var anim = !CFG.reduced && (S.launchHover || now < S.launchAnimUntil);
      var settling = now < S.launchRestUntil || !!(launchCube && !launchCube.lastDraw);
      if (!launchCube || (!anim && !settling)) { DBG.launcherIdle = true; return; }
      DBG.launcherIdle = false;
      if (launchCube && now - launchCube.lastDraw >= 1000 / 24 - 2) {
        launchCube.render(now, anim ? 'idle' : 'rest', 0);
        DBG.launchFrames = (DBG.launchFrames || 0) + 1;
      }
    }
    rafId = requestAnimationFrame(loop);
  }

  // ------------------------------------------------------------------ публічний API і запуск
  window.AtlasVoice = {
    __atlas: true,
    version: '0.3.0-vapi',
    open: open,
    close: close,
    setState: function (name) {
      if (STATES.indexOf(name) < 0) return false;
      stopDemo();
      setState(name);
      return true;
    },
    getState: function () { return S.state; }
  };

  function mount() {
    if (document.getElementById('atlas-voice-root')) return;
    buildUI();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount);
  else mount();
})();

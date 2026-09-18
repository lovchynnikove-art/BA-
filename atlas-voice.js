/*!
 * atlas-voice.js | Голосовий помічник Бізнес Атлас (прототип, 18.09.2026)
 * Один класичний скрипт: без модулів, без збірки, без бібліотек і без ключів.
 * Підключення:
 *   <script src="atlas-voice.js" data-endpoint="https://n8n.businessautomation.space/webhook" defer></script>
 * Атрибути: data-endpoint, data-position="right|left", data-demo="true|false".
 * Параметри сторінки: ?demo=1 (режим показу), ?test=1 (сесії test-...),
 *   ?endpoint=<url> (тільки на localhost і 127.0.0.1, для локальної заглушки).
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

  var DEFAULT_ENDPOINT = 'https://n8n.businessautomation.space/webhook';
  var SESSION_SEC = 300;
  var TURN_TIMEOUT_MS = 30000;

  var qs;
  try { qs = new URLSearchParams(location.search); } catch (e) { qs = { get: function () { return null; } }; }
  var ds = (SCRIPT && SCRIPT.dataset) || {};
  var isLocalHost = location.hostname === 'localhost' || location.hostname === '127.0.0.1';

  function cleanEndpoint(u) {
    try {
      var x = new URL(u, location.href);
      if (x.protocol !== 'https:' && x.protocol !== 'http:') return null;
      return x.href.replace(/\/+$/, '');
    } catch (e) { return null; }
  }

  var endpoint = cleanEndpoint(ds.endpoint || DEFAULT_ENDPOINT) || DEFAULT_ENDPOINT;
  if (isLocalHost && qs.get('endpoint')) {
    var ovr = cleanEndpoint(qs.get('endpoint'));
    if (ovr) endpoint = ovr;
  }

  var assetBase = '';
  try { assetBase = new URL('.', (SCRIPT && SCRIPT.src) || location.href).href; } catch (e) { assetBase = ''; }

  var CFG = {
    endpoint: endpoint,
    position: ds.position === 'left' ? 'left' : 'right',
    demo: ds.demo === 'true' || qs.get('demo') === '1',
    test: qs.get('test') === '1',
    assetBase: assetBase,
    reduced: false
  };
  var mqReduce = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
  CFG.reduced = !!(mqReduce && mqReduce.matches);
  if (mqReduce) {
    var onMq = function () { CFG.reduced = mqReduce.matches; };
    if (mqReduce.addEventListener) mqReduce.addEventListener('change', onMq);
    else if (mqReduce.addListener) mqReduce.addListener(onMq);
  }

  // Сталі фрази дослівно з backend/prompt_ba_pomichnyk.md, розділ PHRASES.
  var PHRASES = {
    greeting: 'Вітаю! Я голосовий помічник Бізнес Атлас на основі штучного інтелекту. Розмову записуємо, щоб передати ваш запит команді. Розкажіть, що хочете автоматизувати, або спитайте, чим ми займаємося.',
    limit: 'На жаль, час нашої розмови вичерпано. Якщо ви залишили контакти, команда зв\'яжеться з вами протягом години в робочий час, а якщо ні, залиште заявку на сайті. Дякую за розмову!',
    repeat: 'Вибачте, вас погано чути. Повторіть, будь ласка.',
    error: 'Вибачте, стався технічний збій. Спробуйте, будь ласка, ще раз за хвилину.'
  };

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
    denied: 'Доступ до мікрофона заборонено. Дозвольте його в налаштуваннях браузера або напишіть питання текстом нижче.',
    nomic: 'Мікрофон не знайдено. Напишіть питання текстом нижче.',
    busy: 'Мікрофон зайнятий іншою програмою. Закрийте її або напишіть питання текстом нижче.',
    insecure: 'Мікрофон працює тільки на захищеному з\'єднанні (https). Поки що напишіть питання текстом нижче.',
    unsupported: 'Цей браузер не вміє записувати голос. Напишіть питання текстом нижче.',
    other: 'Не вдалося увімкнути мікрофон. Напишіть питання текстом нижче.'
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
    sessionId: null, sessionActive: false, gen: 0, epoch: 0,
    turnsSent: 0, reported: false, history: [], pending: 0, turnCtls: [], limitDue: 0,
    connecting: false, micActive: false, fakeMic: false,
    micStream: null, micSource: null, micAnalyser: null, micRms: 0, vadTimer: 0,
    recorder: null, recMime: '', recStartedAt: 0,
    vad: { calibrating: false, samples: [], noise: 0.006, startThr: 0.02, endThr: 0.012, inSpeech: false, aboveSince: 0, belowSince: 0, speechStart: 0, lastVoice: 0, ending: false },
    speech: null, chain: Promise.resolve(), listenSim: null,
    timerEnd: 0, timerId: 0, lastErrorPhraseAt: 0,
    demoRun: null, level: 0, textOpen: false, retries: 0, modeChangedAt: 0, lastMainClickAt: 0,
    audioBlocked: false, audioNotice: false, acStuckSince: 0, lastResumeTry: 0, greetPending: false,
    launchAnimUntil: 0, launchRestUntil: 0, launchHover: false
  };
  var DBG = window.__atlasVoiceDebug = {
    state: 'idle', level: 0, lastError: null, sessionId: null, turns: 0,
    lastTiming: null, audioDecoded: 0, reportsSent: 0, endpoint: CFG.endpoint, demo: CFG.demo
  };
  var UI = {};

  function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  // ------------------------------------------------------------------ звук
  var AC = null, outAnalyser = null;
  var outBuf = null, micBuf = null;

  var AUDIO_NOTICE = 'Браузер призупинив звук. Торкніться куба, щоб його увімкнути.';

  // Safari має ще стан interrupted (дзвінок, інша програма), тому відновлюємо все, що не running
  function resumeAudio() {
    if (!AC || AC.state === 'running' || AC.state === 'closed' || !AC.resume) return;
    S.lastResumeTry = Date.now();
    try { var pr = AC.resume(); if (pr && pr.catch) pr.catch(function () {}); } catch (e) {}
  }

  function onAudioState() {
    if (!AC) return;
    if (AC.state === 'running') {
      S.audioBlocked = false; S.acStuckSince = 0;
      if (S.audioNotice) hideNotice();
    } else if (AC.state !== 'closed' && !document.hidden) resumeAudio();
  }

  function showAudioNotice() {
    if (S.audioNotice || !UI.notice || !UI.notice.hidden) return;
    showNotice(AUDIO_NOTICE);
    S.audioNotice = true;
  }

  // iPhone: без увімкненого мікрофона Web Audio слухається перемикача беззвучного режиму.
  // Тип сесії playback це знімає (Safari 16.4+); перед мікрофоном повертаємо auto.
  function setAudioSession(type) {
    try { var as = navigator.audioSession; if (as && as.type !== type) as.type = type; } catch (e) {}
  }

  function ensureAudio() {
    if (!AC) {
      var Ctor = window.AudioContext || window.webkitAudioContext;
      if (!Ctor) return null;
      try { AC = new Ctor(); } catch (e) { return null; }
      outAnalyser = AC.createAnalyser();
      outAnalyser.fftSize = 1024;
      outAnalyser.smoothingTimeConstant = 0.2;
      outAnalyser.connect(AC.destination);
      outBuf = new Float32Array(outAnalyser.fftSize);
      try { AC.onstatechange = onAudioState; } catch (e) {}
    }
    resumeAudio();
    return AC;
  }

  function rmsOf(an, buf) {
    if (!an) return 0;
    var sum = 0, i;
    if (an.getFloatTimeDomainData) {
      an.getFloatTimeDomainData(buf);
      for (i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
    } else {
      var bb = new Uint8Array(an.fftSize);
      an.getByteTimeDomainData(bb);
      for (i = 0; i < bb.length; i++) { var x = (bb[i] - 128) / 128; sum += x * x; }
      return Math.sqrt(sum / bb.length);
    }
    return Math.sqrt(sum / buf.length);
  }

  function decodeAudio(arrayBuf) {
    return new Promise(function (resolve, reject) {
      if (!AC) { reject(new Error('no_audio_context')); return; }
      var done = false;
      function ok(b) { if (!done) { done = true; DBG.audioDecoded++; resolve(b); } }
      function bad(e) { if (!done) { done = true; reject(e || new Error('decode_failed')); } }
      try {
        var p = AC.decodeAudioData(arrayBuf, ok, bad);
        if (p && p.then) p.then(ok, bad);
      } catch (e) { bad(e); }
    });
  }

  function b64ToArrayBuffer(b64) {
    var bin = atob(String(b64).replace(/^data:[^,]*,/, ''));
    var u = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    return u.buffer;
  }

  // ------------------------------------------------------------------ мережа
  // Таймер діє, доки не прочитано тіло відповіді (read), а не тільки заголовки.
  function fetchWithTimeout(url, opts, ms, ctl, read) {
    ctl = ctl || (window.AbortController ? new AbortController() : null);
    if (ctl) opts.signal = ctl.signal;
    var timer = setTimeout(function () { if (ctl) { ctl.__timeout = true; ctl.abort(); } }, ms || TURN_TIMEOUT_MS);
    return fetch(url, opts).then(function (r) { return read ? read(r) : r; }).then(function (v) { clearTimeout(timer); return v; }, function (e) {
      clearTimeout(timer);
      if (ctl && ctl.__timeout) { var te = new Error('timeout'); te.name = 'TimeoutError'; throw te; }
      throw e;
    });
  }

  function postJSON(path, body, ms, ctl) {
    return fetchWithTimeout(CFG.endpoint + path, {
      method: 'POST', mode: 'cors', credentials: 'omit',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    }, ms, ctl, function (r) {
      if (!r.ok) { var he = new Error('http_' + r.status); he.name = 'HttpError'; throw he; }
      return r.json();
    });
  }

  // ------------------------------------------------------------------ сталі фрази
  var phraseCache = {}, assetMissing = {};

  function fetchAssetPhrase(key) {
    if (assetMissing[key] || !CFG.assetBase) return Promise.reject(new Error('asset_missing'));
    return fetchWithTimeout(CFG.assetBase + 'assets/' + key + '.mp3', { method: 'GET', credentials: 'omit' }, 15000, null, function (r) {
        if (r.status !== 200) { assetMissing[key] = true; throw new Error('asset_' + r.status); }
        return r.arrayBuffer();
      })
      .then(decodeAudio)
      .then(function (buf) { return { text: PHRASES[key], buffer: buf }; });
  }

  function fetchApiPhrase(key) {
    return postJSON('/ba-pomichnyk-phrase', { key: key }, TURN_TIMEOUT_MS).then(function (j) {
      if (!j || !j.ok) throw new Error('phrase_' + ((j && j.error) || 'bad'));
      var text = j.text || PHRASES[key];
      if (!j.audio_base64) return { text: text, buffer: null };
      return decodeAudio(b64ToArrayBuffer(j.audio_base64)).then(function (buf) { return { text: text, buffer: buf }; });
    });
  }

  function getPhrase(key) {
    if (phraseCache[key]) return phraseCache[key];
    var p = fetchAssetPhrase(key)
      .catch(function () { return fetchApiPhrase(key); })
      .catch(function () { return { text: PHRASES[key], buffer: null, failed: true }; });
    phraseCache[key] = p;
    p.then(function (r) { if (r.failed) delete phraseCache[key]; });
    return p;
  }

  // ------------------------------------------------------------------ мовлення і субтитри
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
      var sp = { text: text, who: who, sc: buildSchedule(text), resolve: resolve, done: false, real: false, sim: false, loop: !!o.loop, shown: -1, tt: 0, looped: false, greeting: !!o.greeting };
      if (o.buffer && AC) {
        if (!S.micActive && !S.connecting) setAudioSession('playback');
        resumeAudio();
        var src = null;
        try { src = AC.createBufferSource(); src.buffer = o.buffer; src.connect(outAnalyser); } catch (e) { src = null; }
        if (src) {
          sp.src = src; sp.real = true; sp.dur = o.buffer.duration;
          sp.t0 = AC.currentTime + 0.05; sp.k = sp.sc.total / Math.max(0.2, sp.dur);
          src.onended = function () { finishSpeech('ended', sp); };
          try { src.start(sp.t0); } catch (e) { sp.real = false; }
          if (sp.real) {
            sp.guard = setTimeout(function () { finishSpeech('ended', sp); }, (sp.dur + 3) * 1000);
            setTimeout(function () {
              if (sp.done || AC.state === 'running') return;
              // звук заблоковано: показуємо текст повністю і підказку, наступний дотик відновить звук
              S.audioBlocked = true;
              showAudioNotice();
              finishSpeech('blocked', sp);
              announce(who, text);
            }, 1500);
          }
        }
      }
      if (!sp.real && o.simulate) { sp.sim = true; sp.p0 = performance.now(); sp.k = 1; }
      if (!sp.real && !sp.sim) { setCaption(who, text, false); announce(who, text); resolve('text'); return; }
      S.speech = sp;
      setCaption(who, '', true);
      // екранний диктор читає текст тільки без справжнього звуку, щоб не накладатись на голос
      if (!sp.real) announce(who, text);
      setState(o.visual || (who === 'user' ? 'listening' : 'speaking'), o.status);
    });
  }

  function finishSpeech(reason, sp) {
    sp = sp || S.speech;
    if (!sp || sp.done) return;
    sp.done = true;
    if (sp.guard) clearTimeout(sp.guard);
    if (sp.src) {
      sp.src.onended = null;
      try { sp.src.stop(); } catch (e) {}
      try { sp.src.disconnect(); } catch (e) {}
    }
    if (S.speech === sp) S.speech = null;
    setCaption(sp.who, sp.text, false);
    sp.resolve(reason);
  }

  function enqueueSpeak(o) {
    var ep = S.epoch;
    var p = S.chain.then(function () {
      if (ep !== S.epoch) { if (!o.quiet) setCaption(o.who || 'bot', o.text, false); return 'skipped'; }
      return speak(o);
    });
    S.chain = p.catch(function () {});
    return p;
  }

  // Перебити привітання: зупиняється тільки воно, відповідь на вже поставлене питання ще прозвучить.
  // Перебити відповідь: зупиняється вся черга мовлення.
  function interrupt() {
    if (!(S.speech && S.speech.greeting)) S.epoch++;
    finishSpeech('stopped');
  }

  function updateSpeech(now) {
    var sp = S.speech;
    if (!sp) return;
    var tt;
    if (sp.real) { tt = (AC.currentTime - sp.t0) * sp.k; if (tt < 0) tt = 0; }
    else {
      tt = (now - sp.p0) / 1000;
      if (tt >= sp.sc.total) {
        if (sp.loop) { sp.p0 = now; sp.sc.idx = 0; tt = 0; sp.looped = true; }
        else { finishSpeech('ended', sp); return; }
      }
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

  function currentLevel(now) {
    var sp = S.speech;
    if (sp) {
      if (sp.real) return Math.pow(clamp(rmsOf(outAnalyser, outBuf) / 0.16, 0, 1), 0.75);
      return envAt(sp.sc, sp.tt);
    }
    if (S.listenSim && S.state === 'listening') return S.listenSim(now);
    if (S.state === 'listening' && S.micAnalyser) return Math.pow(clamp((S.micRms - S.vad.noise) / 0.08, 0, 1), 0.6);
    return 0;
  }

  // ------------------------------------------------------------------ сесія, таймер, звіт
  function uuid() {
    try { if (window.crypto && crypto.randomUUID) return crypto.randomUUID(); } catch (e) {}
    var b = new Uint8Array(16), i;
    if (window.crypto && crypto.getRandomValues) crypto.getRandomValues(b);
    else for (i = 0; i < 16; i++) b[i] = Math.random() * 256 | 0;
    b[6] = (b[6] & 15) | 64; b[8] = (b[8] & 63) | 128;
    var h = [];
    for (i = 0; i < 16; i++) h.push((b[i] + 256).toString(16).slice(1));
    return h.slice(0, 4).join('') + '-' + h.slice(4, 6).join('') + '-' + h.slice(6, 8).join('') + '-' + h.slice(8, 10).join('') + '-' + h.slice(10).join('');
  }

  function newSession() {
    S.gen++; S.epoch++;
    S.sessionId = (CFG.test ? 'test-' : '') + uuid();
    S.sessionActive = true; S.turnsSent = 0; S.reported = false; S.history = [];
    S.pending = 0; S.lastErrorPhraseAt = 0; S.fakeMic = false; S.limitDue = 0; S.greetPending = false;
    S.chain = Promise.resolve();
    DBG.sessionId = S.sessionId; DBG.turns = 0; DBG.lastError = null; DBG.lastTiming = null;
    clearCaptions(); hideNotice();
    startTimer(SESSION_SEC);
    updateControls();
  }

  function pushHistory(role, text) {
    if (!text) return;
    S.history.push({ role: role, text: String(text).slice(0, 600) });
    if (S.history.length > 40) S.history.splice(0, S.history.length - 40);
  }

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
    if (left > 0 || !S.sessionActive) return;
    // репліка вже в роботі (оплачена) або відповідь звучить: даємо їй договорити, нових не починаємо,
    // але не довше 20 с
    if (S.pending > 0 || S.speech || S.vad.ending) {
      if (!S.limitDue) {
        S.limitDue = Date.now();
        if (S.state === 'listening') { discardRecorder(); S.listenSim = null; setState('thinking', 'Час розмови вичерпано'); }
        updateControls();
      } else if (Date.now() - S.limitDue > 20000) onLimit(null);
      return;
    }
    onLimit(null);
  }
  function syncTimer(sec) {
    if (typeof sec !== 'number' || !(sec >= 0)) return;
    var end = Date.now() + sec * 1000;
    if (end < S.timerEnd) S.timerEnd = end;
  }

  function reportUrl() { return CFG.endpoint + '/ba-pomichnyk-report'; }

  function sendReport(reason) {
    if (S.reported || !S.turnsSent || !S.sessionId) return;
    S.reported = true;
    var body = JSON.stringify({ session_id: S.sessionId, reason: reason });
    DBG.reportsSent++;
    try {
      fetch(reportUrl(), {
        method: 'POST', mode: 'cors', credentials: 'omit', keepalive: true,
        headers: { 'Content-Type': 'application/json' }, body: body
      }).then(function (r) {
        if (!r.ok) DBG.lastError = 'report: http_' + r.status;
      }, function (e) { DBG.lastError = 'report: ' + ((e && e.message) || 'network'); });
    } catch (e) { DBG.lastError = 'report: ' + e.message; }
  }

  window.addEventListener('pagehide', function (e) {
    if (S.sessionActive && S.turnsSent && !S.reported && navigator.sendBeacon) {
      try {
        var ok = navigator.sendBeacon(reportUrl(), new Blob([JSON.stringify({ session_id: S.sessionId, reason: 'closed' })], { type: 'text/plain' }));
        if (ok) { S.reported = true; DBG.reportsSent++; }
      } catch (e2) {}
    }
    // сторінка йде в кеш «назад-вперед» і може повернутись: розмову закінчуємо тут,
    // щоб після повернення не тривала сесія, звіт якої вже надіслано
    if (e && e.persisted && S.sessionActive) {
      endConversation('closed');
      setState('ended');
    }
  });

  function abortTurns() {
    var list = S.turnCtls;
    S.turnCtls = [];
    for (var i = 0; i < list.length; i++) { try { list[i].abort(); } catch (e) {} }
  }

  function endConversation(reason) {
    if (!S.sessionActive) return;
    S.sessionActive = false; S.connecting = false; S.limitDue = 0; S.greetPending = false;
    S.gen++; S.epoch++;
    stopTimer();
    abortTurns();
    S.pending = 0;
    stopMic();
    finishSpeech('stopped');
    S.fakeMic = false; S.listenSim = null;
    sendReport(reason);
    renderTimer(Math.max(0, Math.ceil((S.timerEnd - Date.now()) / 1000)), false);
    updateControls();
  }

  function onLimit(text) {
    if (!S.sessionActive) return;
    endConversation('limit');
    var gen = S.gen;
    getPhrase('limit').then(function (p) {
      if (gen !== S.gen) return;
      return speak({ text: text || p.text, buffer: p.buffer });
    }).then(function () {
      if (gen !== S.gen) return;
      setState('ended', 'Час розмови вичерпано');
    });
  }

  function settle(gen) {
    if (gen !== undefined && gen !== S.gen) return;
    if (!S.sessionActive || S.speech) return;
    if (S.pending > 0) { setState('thinking'); return; }
    if (S.greetPending) return;
    if (S.limitDue && !S.vad.ending) { onLimit(null); return; }
    if (S.state === 'error') return;
    if (S.micActive || S.fakeMic) { startListening(); return; }
    setState('idle', S.turnsSent ? 'Напишіть наступне питання' : 'Напишіть ваше питання');
  }

  // ------------------------------------------------------------------ мікрофон і визначення фрази
  function pickMime() {
    if (!window.MediaRecorder || !MediaRecorder.isTypeSupported) return '';
    var list = ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/mp4'];
    for (var i = 0; i < list.length; i++) { try { if (MediaRecorder.isTypeSupported(list[i])) return list[i]; } catch (e) {} }
    return '';
  }
  function baseMime(m) { return String(m || '').split(';')[0].trim(); }

  function micSupportProblem() {
    if (!window.isSecureContext) return 'insecure';
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || !window.MediaRecorder || !AC) return 'unsupported';
    return '';
  }

  function errKind(err) {
    var n = err && err.name;
    if (n === 'NotAllowedError' || n === 'SecurityError' || n === 'PermissionDeniedError') return 'denied';
    if (n === 'NotFoundError' || n === 'OverconstrainedError' || n === 'DevicesNotFoundError') return 'nomic';
    if (n === 'NotReadableError' || n === 'TrackStartError' || n === 'AbortError') return 'busy';
    return 'other';
  }

  function setThresholds(v) {
    v.noise = clamp(v.noise, 0.002, 0.05);
    v.startThr = Math.max(0.018, v.noise * 3.2);
    v.endThr = Math.max(0.011, v.noise * 2);
  }

  function setupMic(stream) {
    S.micStream = stream;
    S.micSource = AC.createMediaStreamSource(stream);
    S.micAnalyser = AC.createAnalyser();
    S.micAnalyser.fftSize = 1024;
    S.micAnalyser.smoothingTimeConstant = 0;
    S.micSource.connect(S.micAnalyser);
    micBuf = new Float32Array(S.micAnalyser.fftSize);
    S.micActive = true;
    S.recMime = pickMime();
    var v = S.vad;
    v.calibrating = true; v.samples = []; v.inSpeech = false; v.aboveSince = 0; v.ending = false;
    clearInterval(S.vadTimer);
    S.vadTimer = setInterval(vadTick, 20);
  }

  function finishCalibration() {
    var v = S.vad, s = v.samples;
    if (s.length) {
      var sum = 0;
      for (var i = 0; i < s.length; i++) sum += s[i];
      v.noise = sum / s.length;
    }
    v.calibrating = false; v.samples = [];
    setThresholds(v);
  }

  function stopMic() {
    clearInterval(S.vadTimer); S.vadTimer = 0;
    discardRecorder();
    if (S.micStream) S.micStream.getTracks().forEach(function (tr) { try { tr.stop(); } catch (e) {} });
    if (S.micSource) { try { S.micSource.disconnect(); } catch (e) {} }
    S.micStream = S.micSource = S.micAnalyser = null;
    S.micActive = false; S.micRms = 0;
  }

  function startRecorder() {
    if (!S.micStream) return false;
    var r;
    try {
      r = S.recMime ? new MediaRecorder(S.micStream, { mimeType: S.recMime, audioBitsPerSecond: 32000 }) : new MediaRecorder(S.micStream);
    } catch (e) {
      try { r = new MediaRecorder(S.micStream); } catch (e2) { r = null; }
    }
    if (!r) return false;
    var chunks = [];
    r.ondataavailable = function (e) { if (e.data && e.data.size) chunks.push(e.data); };
    r.__chunks = chunks;
    try { r.start(); } catch (e) { return false; }
    S.recorder = r;
    S.recStartedAt = performance.now();
    return true;
  }

  // запис не створюється: вимикаємо мікрофон і переходимо на текст, а не слухаємо вічно
  function recorderFailed() {
    var gen = S.gen;
    stopMic();
    updateControls();
    onMicFail('unsupported', gen);
  }

  function discardRecorder() {
    var r = S.recorder;
    S.recorder = null;
    if (!r) return;
    r.ondataavailable = null; r.onstop = null;
    try { if (r.state !== 'inactive') r.stop(); } catch (e) {}
  }

  function restartRecorder() { discardRecorder(); if (!startRecorder()) recorderFailed(); }

  function stopRecorder() {
    var r = S.recorder;
    S.recorder = null;
    if (!r) return Promise.resolve(null);
    return new Promise(function (res) {
      var done = false;
      function fin() {
        if (done) return;
        done = true;
        var ch = r.__chunks || [];
        res(ch.length ? new Blob(ch, { type: r.mimeType || S.recMime || 'audio/webm' }) : null);
      }
      r.onstop = fin;
      setTimeout(fin, 1500);
      try { if (r.state !== 'inactive') r.stop(); else fin(); } catch (e) { fin(); }
    });
  }

  function blobToB64(blob) {
    return new Promise(function (res, rej) {
      var fr = new FileReader();
      fr.onload = function () { res(String(fr.result).split(',')[1] || ''); };
      fr.onerror = function () { rej(fr.error); };
      fr.readAsDataURL(blob);
    });
  }

  function vadTick() {
    if (!S.micAnalyser) return;
    // контекст звуку не працює (iPhone після дзвінка чи перемикання програм): аналізатор мовчить,
    // пробуємо відновити, а якщо не виходить, просимо торкнутися куба
    if (AC && AC.state !== 'running') {
      var nowD = Date.now();
      if (!S.acStuckSince) S.acStuckSince = nowD;
      if (nowD - S.lastResumeTry > 1000 && !document.hidden) resumeAudio();
      if (nowD - S.acStuckSince > 1500 && S.state === 'listening') showAudioNotice();
      return;
    }
    S.acStuckSince = 0;
    var rms = rmsOf(S.micAnalyser, micBuf);
    S.micRms = rms;
    var v = S.vad, now = performance.now();
    if (v.calibrating) { v.samples.push(rms); return; }
    if (S.state !== 'listening' || !S.recorder || v.ending) { v.inSpeech = false; v.aboveSince = 0; return; }
    if (!v.inSpeech) {
      if (rms > v.startThr) {
        if (!v.aboveSince) v.aboveSince = now;
        v.belowSince = 0;
        if (now - v.aboveSince >= 120) { v.inSpeech = true; v.speechStart = v.aboveSince; v.lastVoice = now; }
      } else {
        if (v.aboveSince) {
          if (!v.belowSince) v.belowSince = now;
          if (now - v.belowSince > 80) { v.aboveSince = 0; v.belowSince = 0; }
        }
        if (rms < v.noise) v.noise += (rms - v.noise) * 0.05;
        else if (rms < v.noise * 1.8) v.noise += (rms - v.noise) * 0.01;
        setThresholds(v);
        // тиша перед фразою не довша за 2,5 с: запис перезапускається, поки людина мовчить
        if (!v.aboveSince && now - S.recStartedAt > 2500) restartRecorder();
      }
    } else {
      if (rms > v.endThr) v.lastVoice = now;
      var dur = v.lastVoice - v.speechStart;
      if (now - v.lastVoice >= 900) {
        v.inSpeech = false; v.aboveSince = 0;
        if (dur >= 400) endUtterance(); else restartRecorder();
      } else if (now - v.speechStart >= 15000 || now - S.recStartedAt >= 16500) {
        v.inSpeech = false; v.aboveSince = 0;
        endUtterance();
      }
    }
  }

  function endUtterance() {
    var gen = S.gen;
    S.vad.ending = true;
    var recP = stopRecorder();
    setState('thinking');
    setUserPending();
    recP.then(function (blob) {
      S.vad.ending = false;
      if (gen !== S.gen) return;
      if (!blob || blob.size < 600) { setCaption('user', '', false); settle(gen); return; }
      return blobToB64(blob).then(function (b64) {
        if (gen !== S.gen) return;
        sendTurn({ audio_base64: b64, audio_mime: baseMime(blob.type || S.recMime) || 'audio/webm' });
      });
    }).catch(function () {
      S.vad.ending = false;
      if (gen === S.gen) handleTurnError('record', 'Не вдалося записати фразу. Спробуйте ще раз.');
    });
  }

  function startListening() {
    if (!S.sessionActive || S.limitDue) return;
    if (S.fakeMic) {
      S.listenSim = S.listenSim || makeListenSim();
      setState('listening', 'Слухаю (рівень звуку імітується)');
      return;
    }
    if (!S.micActive) return;
    var v = S.vad;
    v.inSpeech = false; v.aboveSince = 0; v.belowSince = 0; v.ending = false;
    if (!S.recorder && !startRecorder()) { recorderFailed(); return; }
    setState('listening');
  }

  // ------------------------------------------------------------------ розмова
  // Привітання стає в загальну чергу мовлення першим, тож відповідь ніколи його не перебиває
  // і не звучить раніше. readyP: чекати, поки мікрофон налаштується (або не вдасться).
  function queueGreeting(greetP, readyP, gen) {
    var ep = S.epoch;
    S.greetPending = true;
    S.chain = S.chain.then(function () { return Promise.all([greetP, readyP]); }).then(function (r) {
      if (gen !== S.gen) return;
      var p = r[0];
      if (ep !== S.epoch) { setCaption('bot', p.text, false); return; }
      return speak({ text: p.text, buffer: p.buffer, greeting: true });
    }).catch(function () {}).then(function () {
      if (gen !== S.gen) return;
      S.greetPending = false;
      settle(gen);
    });
  }

  // Старт голосом. У вже відкритій текстовій розмові вмикає мікрофон без нової сесії і без привітання.
  function startVoice() {
    ensureAudio();
    stopDemo();
    var fresh = false;
    if (!S.sessionActive) { newSession(); fresh = true; }
    hideNotice();
    var gen = S.gen;
    var micReady = null, micDone = function () {};
    if (fresh) {
      pushHistory('assistant', PHRASES.greeting);
      micReady = new Promise(function (res) { micDone = res; setTimeout(res, 8000); });
      queueGreeting(getPhrase('greeting'), micReady, gen);
    }
    var problem = micSupportProblem();
    if (problem) { micDone(); onMicFail(problem, gen); return; }
    S.connecting = true;
    setAudioSession('auto');
    setState('idle', 'Підключаю мікрофон');
    navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } }).then(function (stream) {
      if (gen !== S.gen || !S.sessionActive) { stream.getTracks().forEach(function (tr) { tr.stop(); }); micDone(); return; }
      S.connecting = false;
      resumeAudio();
      try { setupMic(stream); } catch (e) {
        stream.getTracks().forEach(function (tr) { tr.stop(); });
        stopMic();
        micDone();
        onMicFail('unsupported', gen);
        return;
      }
      if (!S.speech && S.pending === 0) setState('idle', 'Налаштовую звук');
      else updateControls();
      wait(520).then(function () {
        finishCalibration();
        micDone();
        settle(gen);
      });
    }, function (err) {
      micDone();
      if (gen !== S.gen || !S.sessionActive) return;
      S.connecting = false;
      onMicFail(errKind(err), gen);
    });
  }

  function onMicFail(kind, gen) {
    S.connecting = false;
    DBG.lastError = 'mic: ' + kind;
    showNotice(MIC_MSG[kind] || MIC_MSG.other);
    openText(true);
    if (CFG.demo) S.fakeMic = true;
    if (gen === S.gen && S.sessionActive && !S.speech && S.pending === 0 && S.state !== 'error') {
      setState('idle', S.turnsSent ? 'Напишіть наступне питання' : 'Напишіть ваше питання');
    } else updateControls();
    settle(gen);
  }

  function isBusy() { return S.pending > 0 || S.vad.ending || !!S.limitDue; }

  function sendText(raw) {
    var text = String(raw || '').replace(/\s+/g, ' ').trim().slice(0, 500);
    if (!text) return false;
    // голосова фраза ще дописується або відповідь ще не прийшла: друга паралельна репліка не потрібна
    if (isBusy()) return false;
    ensureAudio();
    stopDemo();
    var fresh = false;
    if (!S.sessionActive) { newSession(); fresh = true; pushHistory('assistant', PHRASES.greeting); }
    hideNotice();
    if (!fresh && S.speech) interrupt();
    if (S.recorder) discardRecorder();
    setCaption('user', text, false);
    // привітання вантажиться паралельно із запитом і звучить першим, відповідь стає в чергу за ним
    if (fresh) queueGreeting(getPhrase('greeting'), null, S.gen);
    sendTurn({ text: text });
    return true;
  }

  function sendTurn(extra) {
    if (!S.sessionActive) return;
    var body = {
      session_id: S.sessionId,
      page: location.href,
      history: S.history.slice(-12).map(function (h) { return { role: h.role, text: h.text.slice(0, 600) }; }),
      // звук, який не буде зіграно, не озвучуємо (і не платимо за нього)
      no_audio: !AC || (S.audioBlocked && AC.state !== 'running')
    };
    if (extra.text) body.text = extra.text;
    else { body.audio_base64 = extra.audio_base64; body.audio_mime = extra.audio_mime; }
    S.pending++;
    S.turnsSent++;
    DBG.turns = S.turnsSent;
    if (!S.speech) setState('thinking');
    else updateControls();
    var gen = S.gen, t0 = performance.now();
    var ctl = window.AbortController ? new AbortController() : null;
    if (ctl) S.turnCtls.push(ctl);
    function dropCtl() { var i = S.turnCtls.indexOf(ctl); if (i >= 0) S.turnCtls.splice(i, 1); }
    postJSON('/ba-pomichnyk-turn', body, TURN_TIMEOUT_MS, ctl).then(function (res) {
      dropCtl();
      if (gen !== S.gen) return;
      S.pending = Math.max(0, S.pending - 1);
      updateControls();
      DBG.lastTiming = { client_ms: Math.round(performance.now() - t0), server: (res && res.timing_ms) || null };
      handleTurn(res, extra, gen);
    }, function (err) {
      dropCtl();
      if (gen !== S.gen) return;
      S.pending = Math.max(0, S.pending - 1);
      updateControls();
      var name = err && err.name;
      DBG.lastHttp = err && err.message;
      if (name === 'TimeoutError') handleTurnError('timeout', 'Сервер не відповів вчасно. Спробуйте ще раз.');
      else if (name === 'HttpError') handleTurnError(err.message, 'Помічник тимчасово недоступний. Спробуйте, будь ласка, пізніше.');
      else handleTurnError('network', 'Немає зв\'язку з сервером. Перевірте інтернет і спробуйте ще раз.');
    });
  }

  function handleTurn(res, extra, gen) {
    if (!res || typeof res !== 'object') { handleTurnError('bad_response', 'Сервер відповів незрозуміло. Спробуйте ще раз.'); return; }
    if (res.ok) {
      syncTimer(res.remaining_sec);
      var userText = res.user_text || extra.text || '';
      if (userText) { pushHistory('user', userText); setCaption('user', userText, false); }
      if (res.ended) { onLimit(res.reply_text || null); return; }
      var reply = String(res.reply_text || '');
      pushHistory('assistant', reply);
      if (res.audio_base64 && AC) {
        var buf;
        try { buf = b64ToArrayBuffer(res.audio_base64); } catch (e) { buf = null; }
        (buf ? decodeAudio(buf) : Promise.reject(new Error('bad_base64'))).then(function (ab) {
          if (gen !== S.gen) return;
          return enqueueSpeak({ text: reply, buffer: ab });
        }, function (e) {
          if (gen !== S.gen) return;
          DBG.lastError = 'decode: ' + ((e && e.message) || 'failed');
          return enqueueSpeak({ text: reply, buffer: null });
        }).then(function () { settle(gen); });
      } else {
        enqueueSpeak({ text: reply, buffer: null }).then(function () { settle(gen); });
      }
      return;
    }
    var code = res.error || 'upstream_error';
    if (code === 'empty_speech') {
      setCaption('user', '', false);
      getPhrase('repeat').then(function (p) {
        if (gen !== S.gen) return;
        return enqueueSpeak({ text: p.text, buffer: p.buffer });
      }).then(function () { settle(gen); });
      return;
    }
    if (code === 'limit_session') { onLimit(null); return; }
    if (code === 'limit_daily' || code === 'forbidden_origin') {
      DBG.lastError = code;
      var msg = res.message || (code === 'limit_daily' ? 'На сьогодні ліміт розмов вичерпано. Напишіть нам у Telegram або залиште заявку на сайті.' : 'Помічник недоступний на цьому сайті.');
      endConversation(code === 'limit_daily' ? 'limit' : 'closed');
      var g2 = S.gen;
      // повний текст у рамці повідомлення, у рядку стану коротко, щоб не дублювати
      var short = code === 'limit_daily' ? 'Ліміт розмов на сьогодні вичерпано' : 'Помічник тут недоступний';
      getPhrase('error').then(function (p) {
        if (g2 !== S.gen) return;
        return speak({ text: p.text, buffer: p.buffer, visual: 'error', status: short });
      }).then(function () { if (g2 === S.gen) setState('error', short); });
      showNotice(msg);
      return;
    }
    handleTurnError(code, res.message || 'Не вдалося отримати відповідь. Спробуйте ще раз.');
  }

  function handleTurnError(code, msg) {
    DBG.lastError = code + (msg ? ': ' + msg : '');
    if (S.recorder) discardRecorder();
    if (UI.capUser && UI.capUser.classList.contains('pending')) setCaption('user', '', false);
    var gen = S.gen, rc = S.retries;
    function show() { if (gen === S.gen && rc === S.retries && S.sessionActive && !S.speech) setState('error', msg); }
    // якщо ще звучить попередня фраза (наприклад привітання), стан помилки настає після неї
    if (!S.speech) show();
    var now = Date.now();
    if (now - S.lastErrorPhraseAt > 30000) {
      S.lastErrorPhraseAt = now;
      getPhrase('error').then(function (p) {
        if (gen !== S.gen || rc !== S.retries) return;
        return enqueueSpeak({ text: p.text, buffer: p.buffer, visual: 'error', status: msg, quiet: true });
      }).then(show, show);
    } else {
      S.chain = S.chain.then(show, show);
    }
  }

  function retry() {
    S.retries++;
    S.epoch++;
    finishSpeech('stopped');
    hideNotice();
    if (!S.sessionActive) { startVoice(); return; }
    if (S.micActive || S.fakeMic) startListening();
    else setState('idle', 'Напишіть питання ще раз');
  }

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
            '<button type="button" class="kbd" aria-label="Написати замість сказати" aria-pressed="false" aria-controls="av-tform">' + ICON.kbd + '</button>' +
            '<button type="button" class="main" data-mode="start" aria-label="Почати розмову">' + ICON.mic + '</button>' +
            '<div class="timer off" role="timer" aria-label="Залишок часу розмови">' +
              '<svg viewBox="0 0 52 52" aria-hidden="true"><circle class="trk" cx="26" cy="26" r="23"/><circle class="prg" cx="26" cy="26" r="23" stroke-dasharray="' + RING_LEN.toFixed(2) + '" stroke-dashoffset="0"/></svg>' +
              '<span class="tlabel">5:00</span>' +
            '</div>' +
          '</div>' +
          '<form class="tform" id="av-tform" hidden autocomplete="off">' +
            '<input type="text" maxlength="500" enterkeyhint="send" placeholder="Напишіть питання..." aria-label="Ваше повідомлення помічнику">' +
            '<button type="submit" class="send" aria-label="Надіслати повідомлення">' + ICON.send + '</button>' +
          '</form>' +
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
    UI.notice = q('.notice'); UI.main = q('.main'); UI.kbd = q('.kbd');
    UI.timer = q('.timer'); UI.tlabel = q('.tlabel'); UI.prg = q('.prg');
    UI.form = q('.tform'); UI.input = q('.tform input'); UI.send = q('.send');
    UI.close = q('.close'); UI.endb = q('.endb'); UI.chips = root.querySelectorAll('.chip');

    UI.launcher.addEventListener('click', function () { open(); });
    UI.close.addEventListener('click', function () { close(); });
    UI.endb.addEventListener('click', function () {
      if (!S.sessionActive) return;
      endConversation('user_end');
      setState('ended');
      try { UI.main.focus({ preventScroll: true }); } catch (e) {}
    });
    UI.main.addEventListener('click', onMain);
    UI.cubeCanvas.addEventListener('click', onCubeTap);
    UI.kbd.addEventListener('click', function () { ensureAudio(); openText(!S.textOpen); });
    UI.form.addEventListener('submit', function (e) {
      e.preventDefault();
      if (sendText(UI.input.value)) { UI.input.value = ''; try { UI.input.focus({ preventScroll: true }); } catch (e2) {} }
    });
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
      if (!document.hidden) { startLoop(); if (AC && S.sessionActive) resumeAudio(); }
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
      // Esc у полі з текстом спершу очищає поле
      if (inWidget && UI.shadow.activeElement === UI.input && UI.input.value) { UI.input.value = ''; e.stopPropagation(); return; }
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
    if (name !== 'listening') {
      if (S.recorder && !S.vad.ending) discardRecorder();
      if (!S.fakeMic) S.listenSim = null;
    }
    S.state = name;
    DBG.state = name;
    if (UI.root) UI.root.setAttribute('data-state', name);
    setStatus(statusText || STATUS[name]);
    updateControls();
  }

  function setStatus(text) { if (UI.status && UI.status.textContent !== text) UI.status.textContent = text; }

  function mainMode() {
    if (!S.sessionActive) return 'start';
    if (S.state === 'speaking') return 'interrupt';
    if (S.state === 'error') return 'retry';
    // текстова розмова без мікрофона: велика кнопка вмикає голос, а не завершує розмову
    if (!S.micActive && !S.fakeMic && !S.connecting && !S.limitDue && S.state === 'idle') return 'mic';
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
    if (UI.send) UI.send.disabled = isBusy();
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

  function openText(on) {
    S.textOpen = !!on;
    if (!UI.form) return;
    UI.form.hidden = !on;
    UI.kbd.setAttribute('aria-pressed', on ? 'true' : 'false');
    // на дуже низькому екрані панель прокручується: показуємо поле введення
    if (on && UI.panel.scrollHeight > UI.panel.clientHeight + 1) UI.panel.scrollTop = UI.panel.scrollHeight;
    if (on) { try { UI.input.focus({ preventScroll: true }); } catch (e) {} setTimeout(function () { try { if (S.textOpen) UI.input.focus({ preventScroll: true }); } catch (e) {} }, 40); }
  }

  function onMain(e) {
    ensureAudio();
    // подвійний клік чи дотик: друге натискання ігноруємо, бо після першого кнопка вже змінила сенс
    // (почати -> завершити, перервати -> завершити)
    if (e && e.detail > 1) return;
    var now = performance.now();
    if (now - S.lastMainClickAt < 600) return;
    S.lastMainClickAt = now;
    if (S.demoRun || (!S.sessionActive && S.speech && S.speech.sim)) stopDemo();
    var m = mainMode();
    // кнопка щойно змінила сенс під пальцем: не виконуємо нову дію випадково
    if (S.modeChangedAt && now - S.modeChangedAt < (m === 'start' ? 800 : 350)) return;
    if (m === 'start' || m === 'mic') { startVoice(); return; }
    if (m === 'interrupt') { interrupt(); return; }
    if (m === 'retry') { retry(); return; }
    // поки браузер питає дозвіл на мікрофон, «стоп» не спрацьовує (є кнопка «Завершити» вгорі)
    if (S.connecting) return;
    endConversation('user_end');
    setState('ended');
  }

  // Дотик до куба тільки перебиває відповідь (як у специфікації), розмову він не починає
  function onCubeTap() {
    ensureAudio();
    if (S.state === 'speaking' && S.sessionActive) { interrupt(); return; }
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
    if (S.sessionActive) endConversation('closed');
    // скасовуємо і ланцюжки, що вже йшли після кінця розмови (фраза ліміту чи помилки),
    // щоб вони не звучали за закритою панеллю, а панель відкривалась чистою
    S.gen++; S.epoch++;
    S.chain = Promise.resolve(); S.greetPending = false;
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
    if (S.speech && S.speech.sim) finishSpeech('stopped');
    if (!S.fakeMic) S.listenSim = null;
    markChip(null);
  }

  function demoChip(name) {
    if (S.sessionActive) { endConversation('user_end'); }
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
    version: '0.2.0',
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

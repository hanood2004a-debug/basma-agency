(function () {
  function init() {
    if (document.getElementById('basmaBgCanvas')) return;
    var canvas = document.createElement('canvas');
    canvas.id = 'basmaBgCanvas';
    canvas.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;z-index:-1;pointer-events:none;background:#0d1720';
    document.body.insertBefore(canvas, document.body.firstChild);

    var reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduceMotion) { canvas.style.display = 'none'; return; }

    var ctx = canvas.getContext('2d');
    var DPR = Math.min(window.devicePixelRatio || 1, 2);
    var W, H;
    var isMobile = window.innerWidth < 700;
    var GOLD = '201,169,141';
    var LINK_DIST = isMobile ? 200 : 280;

    function resize() {
      W = canvas.width = window.innerWidth * DPR;
      H = canvas.height = window.innerHeight * DPR;
      canvas.style.width = window.innerWidth + 'px';
      canvas.style.height = window.innerHeight + 'px';
    }
    window.addEventListener('resize', function () { resize(); layout(); });

    var prints = [];
    var COUNT_DESKTOP = 9, COUNT_MOBILE = 5;

    function makePrint(x, y) {
      var ringCount = 4 + Math.floor(Math.random() * 2);
      var baseR = (18 + Math.random() * 14) * DPR;
      return {
        x: x, y: y, baseR: baseR, rings: ringCount,
        angle: Math.random() * Math.PI * 2,
        spin: (Math.random() - 0.5) * 0.0016,
        drift: Math.random() * Math.PI * 2,
        driftSpeed: 0.0006 + Math.random() * 0.0004,
        vx: (Math.random() - 0.5) * 0.06 * DPR,
        vy: (Math.random() - 0.5) * 0.06 * DPR
      };
    }

    function layout() {
      prints = [];
      var count = isMobile ? COUNT_MOBILE : COUNT_DESKTOP;
      for (var i = 0; i < count; i++) prints.push(makePrint(Math.random() * W, Math.random() * H));
    }
    resize();
    layout();

    function drawPrint(p, t) {
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.angle + Math.sin(t * p.driftSpeed + p.drift) * 0.15);
      for (var r = 0; r < p.rings; r++) {
        var radius = p.baseR * (0.42 + r * 0.16);
        var gapStart = 0.9 + r * 0.35;
        var gapLen = 0.9;
        ctx.beginPath();
        ctx.arc(0, 0, radius, gapStart, gapStart + Math.PI * 2 - gapLen);
        ctx.strokeStyle = 'rgba(' + GOLD + ',' + (0.5 - r * 0.06) + ')';
        ctx.lineWidth = 1.3 * DPR;
        ctx.lineCap = 'round';
        ctx.stroke();
      }
      ctx.beginPath();
      ctx.arc(0, 0, 1.6 * DPR, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(' + GOLD + ',0.6)';
      ctx.fill();
      ctx.restore();
    }

    var pulse = null;
    function maybeStartPulse() {
      if (pulse || Math.random() > 0.01 || prints.length < 2) return;
      var a = prints[Math.floor(Math.random() * prints.length)];
      var candidates = prints.filter(function (p) {
        var d = Math.hypot(p.x - a.x, p.y - a.y);
        return d > 0 && d < LINK_DIST * DPR;
      });
      if (!candidates.length) return;
      var b = candidates[Math.floor(Math.random() * candidates.length)];
      pulse = { a: a, b: b, t: 0 };
    }

    var t = 0, rafId;
    function draw() {
      t++;
      ctx.clearRect(0, 0, W, H);
      for (var i = 0; i < prints.length; i++) {
        var p = prints[i];
        p.x += p.vx; p.y += p.vy;
        if (p.x < p.baseR || p.x > W - p.baseR) p.vx *= -1;
        if (p.y < p.baseR || p.y > H - p.baseR) p.vy *= -1;
      }
      for (var i = 0; i < prints.length; i++) {
        for (var j = i + 1; j < prints.length; j++) {
          var a = prints[i], b = prints[j];
          var d = Math.hypot(a.x - b.x, a.y - b.y);
          var maxD = LINK_DIST * DPR;
          if (d < maxD) {
            var alpha = (1 - d / maxD) * 0.14;
            ctx.beginPath();
            ctx.moveTo(a.x, a.y);
            ctx.lineTo(b.x, b.y);
            ctx.strokeStyle = 'rgba(' + GOLD + ',' + alpha + ')';
            ctx.lineWidth = 1;
            ctx.stroke();
          }
        }
      }
      for (var i = 0; i < prints.length; i++) drawPrint(prints[i], t);
      maybeStartPulse();
      if (pulse) {
        pulse.t += 0.015;
        if (pulse.t >= 1) { pulse = null; }
        else {
          var x = pulse.a.x + (pulse.b.x - pulse.a.x) * pulse.t;
          var y = pulse.a.y + (pulse.b.y - pulse.a.y) * pulse.t;
          ctx.beginPath();
          ctx.arc(x, y, 2.2 * DPR, 0, Math.PI * 2);
          ctx.fillStyle = 'rgba(' + GOLD + ',0.95)';
          ctx.shadowColor = 'rgba(' + GOLD + ',0.95)';
          ctx.shadowBlur = 9 * DPR;
          ctx.fill();
          ctx.shadowBlur = 0;
        }
      }
      rafId = requestAnimationFrame(draw);
    }

    document.addEventListener('visibilitychange', function () {
      if (document.hidden) { cancelAnimationFrame(rafId); }
      else { draw(); }
    });

    draw();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();

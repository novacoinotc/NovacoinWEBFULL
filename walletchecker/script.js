/* Wallet Checker — Radar scan animation + interactions */
document.addEventListener('DOMContentLoaded', () => {
    const nav = document.getElementById('nav');
    const toggle = document.getElementById('navToggle');
    const links = document.getElementById('navLinks');

    window.addEventListener('scroll', () => nav.classList.toggle('scrolled', window.scrollY > 50), { passive: true });
    toggle.addEventListener('click', () => {
        toggle.classList.toggle('open'); links.classList.toggle('open');
        document.body.style.overflow = links.classList.contains('open') ? 'hidden' : '';
    });
    links.querySelectorAll('.nav__link').forEach(l => l.addEventListener('click', () => {
        toggle.classList.remove('open'); links.classList.remove('open'); document.body.style.overflow = '';
    }));

    const obs = new IntersectionObserver(entries => {
        entries.forEach(e => { if (e.isIntersecting) { e.target.classList.add('v'); obs.unobserve(e.target); } });
    }, { threshold: 0.1, rootMargin: '0px 0px -30px 0px' });
    document.querySelectorAll('.anim').forEach(el => obs.observe(el));

    document.querySelectorAll('a[href^="#"]').forEach(a => {
        a.addEventListener('click', e => {
            const t = document.querySelector(a.getAttribute('href'));
            if (t) { e.preventDefault(); window.scrollTo({ top: t.offsetTop - 70, behavior: 'smooth' }); }
        });
    });

    // Hero canvas — radar scan with wallet nodes
    const canvas = document.getElementById('heroCanvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    let w, h, af, time = 0;
    const nodes = [];

    function resize() {
        w = canvas.width = canvas.offsetWidth;
        h = canvas.height = canvas.offsetHeight;
        nodes.length = 0;
        const n = Math.min(Math.floor((w * h) / 18000), 50);
        for (let i = 0; i < n; i++) {
            const cx = w / 2, cy = h / 2;
            const angle = Math.random() * Math.PI * 2;
            const dist = Math.random() * Math.min(w, h) * 0.45;
            nodes.push({
                x: cx + Math.cos(angle) * dist,
                y: cy + Math.sin(angle) * dist,
                r: Math.random() * 2 + 1,
                risk: Math.random(),
                scanned: false,
                scanTime: 0,
                drift: Math.random() * Math.PI * 2
            });
        }
    }

    function draw() {
        ctx.clearRect(0, 0, w, h);
        time += 0.008;

        const cx = w / 2, cy = h / 2;
        const maxR = Math.min(w, h) * 0.42;

        // Radar rings
        for (let i = 1; i <= 3; i++) {
            ctx.beginPath();
            ctx.arc(cx, cy, maxR * (i / 3), 0, Math.PI * 2);
            ctx.strokeStyle = `rgba(34, 197, 94, 0.04)`;
            ctx.lineWidth = 0.5;
            ctx.stroke();
        }

        // Radar sweep
        const sweepAngle = time * 0.8;
        const sweepGrad = ctx.createConicGradient(sweepAngle, cx, cy);
        sweepGrad.addColorStop(0, 'rgba(34, 197, 94, 0.08)');
        sweepGrad.addColorStop(0.08, 'rgba(34, 197, 94, 0.01)');
        sweepGrad.addColorStop(0.1, 'rgba(34, 197, 94, 0)');
        sweepGrad.addColorStop(1, 'rgba(34, 197, 94, 0)');

        ctx.beginPath();
        ctx.arc(cx, cy, maxR, 0, Math.PI * 2);
        ctx.fillStyle = sweepGrad;
        ctx.fill();

        // Sweep line
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(cx + Math.cos(sweepAngle) * maxR, cy + Math.sin(sweepAngle) * maxR);
        ctx.strokeStyle = 'rgba(34, 197, 94, 0.15)';
        ctx.lineWidth = 1;
        ctx.stroke();

        // Nodes
        nodes.forEach(n => {
            // Gentle drift
            n.x += Math.sin(time + n.drift) * 0.1;
            n.y += Math.cos(time * 0.7 + n.drift) * 0.1;

            // Check if sweep passes over node
            const dx = n.x - cx, dy = n.y - cy;
            const nodeAngle = Math.atan2(dy, dx);
            const normalSweep = ((sweepAngle % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
            const normalNode = ((nodeAngle % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
            const diff = Math.abs(normalSweep - normalNode);
            if (diff < 0.1 || diff > Math.PI * 2 - 0.1) {
                n.scanned = true;
                n.scanTime = time;
            }

            const timeSinceScan = time - n.scanTime;
            const scanFade = n.scanned ? Math.max(0, 1 - timeSinceScan * 0.3) : 0;

            // Node color based on risk
            let color;
            if (n.risk < 0.7) {
                color = `rgba(34, 197, 94, ${0.15 + scanFade * 0.5})`;
            } else if (n.risk < 0.9) {
                color = `rgba(250, 204, 21, ${0.15 + scanFade * 0.5})`;
            } else {
                color = `rgba(239, 68, 68, ${0.15 + scanFade * 0.5})`;
            }

            // Glow on scan
            if (scanFade > 0.1) {
                ctx.beginPath();
                ctx.arc(n.x, n.y, n.r + 6 * scanFade, 0, Math.PI * 2);
                ctx.fillStyle = color.replace(/[\d.]+\)$/, `${scanFade * 0.15})`);
                ctx.fill();
            }

            ctx.beginPath();
            ctx.arc(n.x, n.y, n.r, 0, Math.PI * 2);
            ctx.fillStyle = color;
            ctx.fill();

            // Connections between nearby nodes
            nodes.forEach(m => {
                if (m === n) return;
                const ddx = n.x - m.x, ddy = n.y - m.y;
                const d = Math.sqrt(ddx * ddx + ddy * ddy);
                if (d < 100) {
                    ctx.beginPath();
                    ctx.moveTo(n.x, n.y);
                    ctx.lineTo(m.x, m.y);
                    ctx.strokeStyle = `rgba(34, 197, 94, ${(1 - d / 100) * 0.04})`;
                    ctx.lineWidth = 0.5;
                    ctx.stroke();
                }
            });
        });

        af = requestAnimationFrame(draw);
    }

    resize(); draw();
    window.addEventListener('resize', resize);

    new IntersectionObserver(entries => {
        entries.forEach(e => { if (e.isIntersecting) { if (!af) draw(); } else { cancelAnimationFrame(af); af = null; } });
    }, { threshold: 0 }).observe(document.getElementById('hero'));
});

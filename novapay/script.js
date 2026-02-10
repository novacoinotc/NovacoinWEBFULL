/* NovaPay — QR scan animation + interactions */
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

    // Hero canvas — floating payment cards / QR patterns
    const canvas = document.getElementById('heroCanvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    let w, h, af, time = 0;
    const shapes = [];

    function resize() {
        w = canvas.width = canvas.offsetWidth;
        h = canvas.height = canvas.offsetHeight;
        shapes.length = 0;
        const n = Math.min(Math.floor((w * h) / 25000), 40);
        for (let i = 0; i < n; i++) {
            shapes.push({
                x: Math.random() * w,
                y: Math.random() * h,
                size: Math.random() * 20 + 10,
                speed: Math.random() * 0.3 + 0.1,
                angle: Math.random() * Math.PI * 2,
                rotSpeed: (Math.random() - 0.5) * 0.005,
                opacity: Math.random() * 0.08 + 0.02,
                type: Math.random() > 0.5 ? 'rect' : 'diamond'
            });
        }
    }

    function draw() {
        ctx.clearRect(0, 0, w, h);
        time += 0.01;

        shapes.forEach(s => {
            ctx.save();
            ctx.translate(s.x, s.y);
            ctx.rotate(s.angle);
            s.angle += s.rotSpeed;

            if (s.type === 'rect') {
                ctx.strokeStyle = `rgba(123, 47, 247, ${s.opacity})`;
                ctx.lineWidth = 0.8;
                ctx.strokeRect(-s.size/2, -s.size/2, s.size, s.size);
                // Inner pattern (QR-like)
                const inner = s.size * 0.3;
                ctx.fillStyle = `rgba(255, 47, 237, ${s.opacity * 0.5})`;
                ctx.fillRect(-inner/2, -inner/2, inner, inner);
            } else {
                ctx.beginPath();
                ctx.moveTo(0, -s.size/2);
                ctx.lineTo(s.size/2, 0);
                ctx.lineTo(0, s.size/2);
                ctx.lineTo(-s.size/2, 0);
                ctx.closePath();
                ctx.strokeStyle = `rgba(255, 47, 237, ${s.opacity})`;
                ctx.lineWidth = 0.8;
                ctx.stroke();
            }
            ctx.restore();

            // Float upward
            s.y -= s.speed;
            s.x += Math.sin(time + s.size) * 0.2;
            if (s.y < -s.size) { s.y = h + s.size; s.x = Math.random() * w; }
        });

        // Scan line effect
        const scanY = (Math.sin(time * 0.5) * 0.5 + 0.5) * h;
        const scanGrad = ctx.createLinearGradient(0, scanY - 30, 0, scanY + 30);
        scanGrad.addColorStop(0, 'rgba(123, 47, 247, 0)');
        scanGrad.addColorStop(0.5, 'rgba(123, 47, 247, 0.03)');
        scanGrad.addColorStop(1, 'rgba(123, 47, 247, 0)');
        ctx.fillStyle = scanGrad;
        ctx.fillRect(0, scanY - 30, w, 60);

        af = requestAnimationFrame(draw);
    }

    resize(); draw();
    window.addEventListener('resize', resize);

    new IntersectionObserver(entries => {
        entries.forEach(e => { if (e.isIntersecting) { if (!af) draw(); } else { cancelAnimationFrame(af); af = null; } });
    }, { threshold: 0 }).observe(document.getElementById('hero'));
});

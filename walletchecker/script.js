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

    // --- Web3 Animation Enhancements ---
    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    if (!prefersReducedMotion) {
        // Staggered card reveal
        document.querySelectorAll('.steps, .cap-grid, .who-grid').forEach(grid => {
            const gridObs = new IntersectionObserver(entries => {
                entries.forEach(e => {
                    if (e.isIntersecting) {
                        const cards = e.target.children;
                        Array.from(cards).forEach((card, i) => {
                            card.style.opacity = '0';
                            card.style.transform = 'translateY(30px)';
                            setTimeout(() => {
                                card.style.transition = 'opacity 0.6s ease, transform 0.6s ease';
                                card.style.opacity = '1';
                                card.style.transform = 'translateY(0)';
                            }, i * 120);
                        });
                        gridObs.unobserve(e.target);
                    }
                });
            }, { threshold: 0.15 });
            gridObs.observe(grid);
        });

        // Animated counters for stats
        document.querySelectorAll('.stats__num').forEach(el => {
            const countObs = new IntersectionObserver(entries => {
                entries.forEach(e => {
                    if (e.isIntersecting) {
                        const text = e.target.textContent;
                        const match = text.match(/([\d,]+)/);
                        if (match) {
                            const target = parseInt(match[1].replace(/,/g, ''));
                            const suffix = text.substring(text.indexOf(match[1]) + match[1].length);
                            const prefix = text.substring(0, text.indexOf(match[1]));
                            let current = 0;
                            const duration = 2000;
                            const step = target / (duration / 16);
                            const timer = setInterval(() => {
                                current += step;
                                if (current >= target) {
                                    current = target;
                                    clearInterval(timer);
                                }
                                e.target.textContent = prefix + Math.floor(current).toLocaleString() + suffix;
                            }, 16);
                        }
                        countObs.unobserve(e.target);
                    }
                });
            }, { threshold: 0.5 });
            countObs.observe(el);
        });

        // Parallax on hero orbs (desktop only)
        if (window.innerWidth > 768) {
            const orbs = document.querySelectorAll('.hero__orb--1, .hero__orb--2');
            if (orbs.length) {
                document.addEventListener('mousemove', e => {
                    const x = (e.clientX / window.innerWidth - 0.5) * 20;
                    const y = (e.clientY / window.innerHeight - 0.5) * 20;
                    orbs.forEach((orb, i) => {
                        const factor = i === 0 ? 1 : -0.7;
                        orb.style.transform = `translate(${x * factor}px, ${y * factor}px)`;
                    });
                }, { passive: true });
            }
        }
    }

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

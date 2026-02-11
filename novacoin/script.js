/* NovaCoin — Madre Site */
document.addEventListener('DOMContentLoaded', () => {
    const nav = document.getElementById('nav');
    const toggle = document.getElementById('navToggle');
    const links = document.getElementById('navLinks');

    window.addEventListener('scroll', () => {
        nav.classList.toggle('scrolled', window.scrollY > 50);
    }, { passive: true });

    toggle.addEventListener('click', () => {
        toggle.classList.toggle('open');
        links.classList.toggle('open');
        document.body.style.overflow = links.classList.contains('open') ? 'hidden' : '';
    });

    links.querySelectorAll('.nav__link').forEach(l => l.addEventListener('click', () => {
        toggle.classList.remove('open');
        links.classList.remove('open');
        document.body.style.overflow = '';
    }));

    // Scroll animations
    const obs = new IntersectionObserver(entries => {
        entries.forEach(e => { if (e.isIntersecting) { e.target.classList.add('v'); obs.unobserve(e.target); } });
    }, { threshold: 0.1, rootMargin: '0px 0px -30px 0px' });
    document.querySelectorAll('.anim').forEach(el => obs.observe(el));

    // --- Web3 Animation Enhancements ---
    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    if (!prefersReducedMotion) {
        // Staggered card reveal
        document.querySelectorAll('.prob-grid, .tools__grid, .why__grid').forEach(grid => {
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

    // Smooth scroll
    document.querySelectorAll('a[href^="#"]').forEach(a => {
        a.addEventListener('click', e => {
            const t = document.querySelector(a.getAttribute('href'));
            if (t) { e.preventDefault(); window.scrollTo({ top: t.offsetTop - 70, behavior: 'smooth' }); }
        });
    });

    // Hero particle network
    const canvas = document.getElementById('heroCanvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    let pts = [], w, h, af;

    function resize() {
        w = canvas.width = canvas.offsetWidth;
        h = canvas.height = canvas.offsetHeight;
        pts = [];
        const n = Math.min(Math.floor((w * h) / 20000), 70);
        for (let i = 0; i < n; i++) pts.push({ x: Math.random()*w, y: Math.random()*h, vx: (Math.random()-0.5)*0.25, vy: (Math.random()-0.5)*0.25, r: Math.random()*1.5+0.5, o: Math.random()*0.35+0.1 });
    }

    function draw() {
        ctx.clearRect(0, 0, w, h);
        for (let i = 0; i < pts.length; i++) {
            for (let j = i+1; j < pts.length; j++) {
                const dx = pts[i].x - pts[j].x, dy = pts[i].y - pts[j].y;
                const d = Math.sqrt(dx*dx + dy*dy);
                if (d < 140) {
                    ctx.beginPath();
                    ctx.strokeStyle = `rgba(0,212,255,${(1-d/140)*0.07})`;
                    ctx.lineWidth = 0.5;
                    ctx.moveTo(pts[i].x, pts[i].y);
                    ctx.lineTo(pts[j].x, pts[j].y);
                    ctx.stroke();
                }
            }
        }
        pts.forEach(p => {
            ctx.beginPath();
            ctx.arc(p.x, p.y, p.r, 0, Math.PI*2);
            ctx.fillStyle = `rgba(0,212,255,${p.o})`;
            ctx.fill();
            p.x += p.vx; p.y += p.vy;
            if (p.x < 0 || p.x > w) p.vx *= -1;
            if (p.y < 0 || p.y > h) p.vy *= -1;
        });
        af = requestAnimationFrame(draw);
    }

    resize(); draw();
    window.addEventListener('resize', resize);

    new IntersectionObserver(entries => {
        entries.forEach(e => { if (e.isIntersecting) { if (!af) draw(); } else { cancelAnimationFrame(af); af = null; } });
    }, { threshold: 0 }).observe(document.getElementById('hero'));
});

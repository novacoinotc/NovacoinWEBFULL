/* RFQ Exchange — Animated price chart + interactions */
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

    // Scroll animations
    const obs = new IntersectionObserver(entries => {
        entries.forEach(e => { if (e.isIntersecting) { e.target.classList.add('v'); obs.unobserve(e.target); } });
    }, { threshold: 0.1, rootMargin: '0px 0px -30px 0px' });
    document.querySelectorAll('.anim').forEach(el => obs.observe(el));

    // --- Web3 Animation Enhancements ---
    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    if (!prefersReducedMotion) {
        // Staggered card reveal
        document.querySelectorAll('.steps, .adv-grid, .pro-grid, .crypto-grid').forEach(grid => {
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

    // Hero canvas — animated price line chart
    const canvas = document.getElementById('heroCanvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    let w, h, af, time = 0;

    function resize() {
        w = canvas.width = canvas.offsetWidth;
        h = canvas.height = canvas.offsetHeight;
    }

    function draw() {
        ctx.clearRect(0, 0, w, h);
        time += 0.008;

        // Draw multiple flowing lines
        for (let line = 0; line < 3; line++) {
            const opacity = 0.06 - line * 0.015;
            const offset = line * 0.5;
            const yBase = h * (0.35 + line * 0.12);
            const amplitude = h * 0.1;

            ctx.beginPath();
            ctx.strokeStyle = line === 0
                ? `rgba(0, 212, 255, ${opacity})`
                : `rgba(0, 255, 136, ${opacity})`;
            ctx.lineWidth = line === 0 ? 1.5 : 1;

            for (let x = 0; x <= w; x += 2) {
                const t = (x / w) * 6 + time + offset;
                const y = yBase +
                    Math.sin(t) * amplitude * 0.6 +
                    Math.sin(t * 2.3 + 1) * amplitude * 0.3 +
                    Math.sin(t * 0.7 - 0.5) * amplitude * 0.4;
                if (x === 0) ctx.moveTo(x, y);
                else ctx.lineTo(x, y);
            }
            ctx.stroke();

            // Glow fill under first line
            if (line === 0) {
                ctx.lineTo(w, h);
                ctx.lineTo(0, h);
                ctx.closePath();
                const grad = ctx.createLinearGradient(0, yBase - amplitude, 0, h);
                grad.addColorStop(0, 'rgba(0, 212, 255, 0.03)');
                grad.addColorStop(1, 'rgba(0, 212, 255, 0)');
                ctx.fillStyle = grad;
                ctx.fill();
            }
        }

        // Floating dots
        for (let i = 0; i < 5; i++) {
            const x = ((time * 40 + i * 200) % (w + 100)) - 50;
            const yBase = h * 0.35;
            const t = (x / w) * 6 + time;
            const y = yBase + Math.sin(t) * h * 0.06 + Math.sin(t * 2.3 + 1) * h * 0.03;
            ctx.beginPath();
            ctx.arc(x, y, 2, 0, Math.PI * 2);
            ctx.fillStyle = 'rgba(0, 255, 136, 0.3)';
            ctx.fill();
        }

        af = requestAnimationFrame(draw);
    }

    resize(); draw();
    window.addEventListener('resize', resize);

    new IntersectionObserver(entries => {
        entries.forEach(e => { if (e.isIntersecting) { if (!af) draw(); } else { cancelAnimationFrame(af); af = null; } });
    }, { threshold: 0 }).observe(document.getElementById('hero'));
});

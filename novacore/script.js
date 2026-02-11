/* NOVACORE — Data flow animation + interactions */
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
        document.querySelectorAll('.cap-grid, .sec-grid, .cap-extras').forEach(grid => {
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

        // Animated counters for stat cards
        document.querySelectorAll('.stat-card__num').forEach(el => {
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

    // Hero canvas — data flow between nodes
    const canvas = document.getElementById('heroCanvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    let w, h, af, time = 0;
    const nodes = [];
    const packets = [];

    function resize() {
        w = canvas.width = canvas.offsetWidth;
        h = canvas.height = canvas.offsetHeight;
        nodes.length = 0;
        packets.length = 0;

        // Create grid of nodes
        const cols = Math.floor(w / 120);
        const rows = Math.floor(h / 120);
        for (let r = 0; r < rows; r++) {
            for (let c = 0; c < cols; c++) {
                nodes.push({
                    x: (c + 0.5) * (w / cols) + (Math.random() - 0.5) * 30,
                    y: (r + 0.5) * (h / rows) + (Math.random() - 0.5) * 30,
                    size: Math.random() * 2 + 1.5,
                    pulse: Math.random() * Math.PI * 2
                });
            }
        }
    }

    function spawnPacket() {
        if (nodes.length < 2 || packets.length > 15) return;
        const a = Math.floor(Math.random() * nodes.length);
        let b = Math.floor(Math.random() * nodes.length);
        while (b === a) b = Math.floor(Math.random() * nodes.length);
        const from = nodes[a], to = nodes[b];
        const dx = to.x - from.x, dy = to.y - from.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist > 300) return;
        packets.push({ from, to, progress: 0, speed: 0.005 + Math.random() * 0.008 });
    }

    function draw() {
        ctx.clearRect(0, 0, w, h);
        time += 0.01;

        // Occasionally spawn packets
        if (Math.random() < 0.04) spawnPacket();

        // Draw connections between close nodes
        for (let i = 0; i < nodes.length; i++) {
            for (let j = i + 1; j < nodes.length; j++) {
                const dx = nodes[i].x - nodes[j].x;
                const dy = nodes[i].y - nodes[j].y;
                const d = Math.sqrt(dx * dx + dy * dy);
                if (d < 180) {
                    ctx.beginPath();
                    ctx.strokeStyle = `rgba(255, 136, 0, ${(1 - d / 180) * 0.04})`;
                    ctx.lineWidth = 0.5;
                    ctx.moveTo(nodes[i].x, nodes[i].y);
                    ctx.lineTo(nodes[j].x, nodes[j].y);
                    ctx.stroke();
                }
            }
        }

        // Draw nodes
        nodes.forEach(n => {
            const pulseSize = Math.sin(time * 2 + n.pulse) * 0.5 + 0.5;
            ctx.beginPath();
            ctx.arc(n.x, n.y, n.size + pulseSize, 0, Math.PI * 2);
            ctx.fillStyle = `rgba(255, 136, 0, ${0.15 + pulseSize * 0.1})`;
            ctx.fill();
        });

        // Draw and update packets
        for (let i = packets.length - 1; i >= 0; i--) {
            const p = packets[i];
            p.progress += p.speed;

            if (p.progress >= 1) {
                packets.splice(i, 1);
                continue;
            }

            const x = p.from.x + (p.to.x - p.from.x) * p.progress;
            const y = p.from.y + (p.to.y - p.from.y) * p.progress;

            // Packet glow
            ctx.beginPath();
            ctx.arc(x, y, 3, 0, Math.PI * 2);
            ctx.fillStyle = `rgba(255, 136, 0, ${0.6 * (1 - Math.abs(p.progress - 0.5) * 2)})`;
            ctx.fill();

            // Trail
            const trail = 0.1;
            const tx = p.from.x + (p.to.x - p.from.x) * Math.max(0, p.progress - trail);
            const ty = p.from.y + (p.to.y - p.from.y) * Math.max(0, p.progress - trail);
            ctx.beginPath();
            ctx.moveTo(tx, ty);
            ctx.lineTo(x, y);
            ctx.strokeStyle = `rgba(255, 47, 95, 0.3)`;
            ctx.lineWidth = 1;
            ctx.stroke();
        }

        af = requestAnimationFrame(draw);
    }

    resize(); draw();
    window.addEventListener('resize', resize);

    new IntersectionObserver(entries => {
        entries.forEach(e => { if (e.isIntersecting) { if (!af) draw(); } else { cancelAnimationFrame(af); af = null; } });
    }, { threshold: 0 }).observe(document.getElementById('hero'));
});

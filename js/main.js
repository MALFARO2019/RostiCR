/* =====================================================
   ROSTI Costa Rica - JavaScript principal
   ===================================================== */

document.addEventListener('DOMContentLoaded', function () {

    /* ---- Toggle de menú móvil ---- */
    const toggle = document.querySelector('.menu-toggle');
    const navMenu = document.querySelector('.nav-menu');
    if (toggle && navMenu) {
        toggle.addEventListener('click', () => {
            navMenu.classList.toggle('open');
            const expanded = navMenu.classList.contains('open');
            toggle.setAttribute('aria-expanded', expanded);
        });
    }

    /* ---- Marcar enlace activo según ruta ---- */
    const path = window.location.pathname.split('/').pop() || 'index.html';
    document.querySelectorAll('.nav-menu a').forEach(link => {
        const href = link.getAttribute('href');
        if (href === path || (path === '' && href === 'index.html')) {
            link.classList.add('active');
        }
    });

    /* ---- Filtro de categorías de menú ---- */
    const categoryButtons = document.querySelectorAll('.category-btn');
    const menuItems = document.querySelectorAll('.menu-card');
    if (categoryButtons.length) {
        categoryButtons.forEach(btn => {
            btn.addEventListener('click', function () {
                const cat = this.dataset.category;
                categoryButtons.forEach(b => b.classList.remove('active'));
                this.classList.add('active');
                menuItems.forEach(item => {
                    if (cat === 'todos' || item.dataset.category === cat) {
                        item.style.display = '';
                    } else {
                        item.style.display = 'none';
                    }
                });
            });
        });
    }

    /* ---- Filtro de locales por provincia ---- */
    const provinceSelect = document.getElementById('province-filter');
    const localSearch = document.getElementById('local-search');
    const localCards = document.querySelectorAll('.local-card');

    function filterLocales() {
        const province = provinceSelect ? provinceSelect.value : 'todas';
        const term = localSearch ? localSearch.value.toLowerCase().trim() : '';
        let visibleCount = 0;
        localCards.forEach(card => {
            const cardProv = card.dataset.province;
            const cardText = card.textContent.toLowerCase();
            const matchProv = (province === 'todas' || cardProv === province);
            const matchTerm = (!term || cardText.includes(term));
            if (matchProv && matchTerm) {
                card.style.display = '';
                visibleCount++;
            } else {
                card.style.display = 'none';
            }
        });
        const empty = document.getElementById('empty-locales');
        if (empty) empty.style.display = visibleCount === 0 ? 'block' : 'none';
    }

    if (provinceSelect) provinceSelect.addEventListener('change', filterLocales);
    if (localSearch) localSearch.addEventListener('input', filterLocales);

    /* ---- Manejo del formulario de contacto ---- */
    const contactForm = document.getElementById('contact-form');
    if (contactForm) {
        contactForm.addEventListener('submit', function (e) {
            e.preventDefault();
            const successBox = document.getElementById('form-success');
            if (successBox) {
                successBox.style.display = 'block';
                successBox.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
            contactForm.reset();
        });
    }

    /* ---- Manejo del formulario de empleos ---- */
    const jobForm = document.getElementById('job-form');
    if (jobForm) {
        jobForm.addEventListener('submit', function (e) {
            e.preventDefault();
            const success = document.getElementById('job-success');
            if (success) {
                success.style.display = 'block';
                success.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
            jobForm.reset();
        });
    }

    /* ---- Animaciones al hacer scroll ---- */
    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.classList.add('fade-in');
                observer.unobserve(entry.target);
            }
        });
    }, { threshold: 0.12 });

    document.querySelectorAll('.menu-card, .local-card, .promo-card, .stat-box, .feature-item').forEach(el => {
        observer.observe(el);
    });

    /* ---- Año actual en footer ---- */
    const yearEl = document.getElementById('current-year');
    if (yearEl) yearEl.textContent = new Date().getFullYear();
});

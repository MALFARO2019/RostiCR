document.addEventListener('DOMContentLoaded', function () {
    const toggle = document.querySelector('.menu-toggle');
    const mobileMenu = document.getElementById('mobileMenu');
    if (toggle && mobileMenu) {
        toggle.addEventListener('click', () => {
            const isOpen = mobileMenu.classList.toggle('open');
            toggle.setAttribute('aria-expanded', isOpen);
        });
    }

    const yearEl = document.getElementById('current-year');
    if (yearEl) yearEl.textContent = new Date().getFullYear();

    iniciarCarrusel();
});

// Carrusel del banner principal.
//
// Las imágenes vienen escritas en el HTML (las pone el panel de administración,
// no se piden por fetch) porque la primera es la imagen LCP de la portada.
// Sin JS se ve solo esa primera, que es exactamente como funcionaba cuando el
// banner era una imagen sola; acá se agregan el cambio automático y los controles.
function iniciarCarrusel() {
    const slider = document.querySelector('.slider');
    if (!slider) return;

    const imgs = Array.from(slider.querySelectorAll('img'));
    if (imgs.length < 2) return;

    // El panel guarda el tiempo en data-intervalo. Se acota por las dudas: un
    // valor muy bajo marea y uno altísimo deja el carrusel parado.
    const segundos = Math.min(60, Math.max(3, Number(slider.dataset.intervalo) || 10));

    // Con prefers-reduced-motion el CSS deja el cambio en corte seco, sin
    // fundido. El carrusel sigue rotando: lo que molesta es la animación, no
    // que la promoción cambie. Para frenarlo del todo está el botón de pausa.

    let actual = 0;
    let timer = null;
    const pausas = new Set();

    slider.classList.add('con-js');
    slider.setAttribute('aria-roledescription', 'carrusel');
    imgs[0].classList.add('activa');
    imgs.forEach((img, i) => {
        img.setAttribute('aria-hidden', i === 0 ? 'false' : 'true');
    });

    // ---- controles ----

    const puntos = document.createElement('div');
    puntos.className = 'slider-puntos';
    imgs.forEach((img, i) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.setAttribute('aria-label', 'Ver imagen ' + (i + 1) + ' de ' + imgs.length);
        if (i === 0) b.classList.add('activo');
        b.addEventListener('click', () => irA(i, true));
        puntos.appendChild(b);
    });
    slider.appendChild(puntos);

    const flecha = (clase, etiqueta, signo, glifo) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'slider-flecha ' + clase;
        b.setAttribute('aria-label', etiqueta);
        b.textContent = glifo;
        b.addEventListener('click', () => irA(actual + signo, true));
        slider.appendChild(b);
        return b;
    };
    flecha('anterior', 'Imagen anterior', -1, '‹');
    flecha('siguiente', 'Imagen siguiente', 1, '›');

    // Contenido que cambia solo tiene que poder frenarse sin depender del
    // mouse (WCAG 2.2.2): con el teclado o en celular no hay "pasar por encima".
    const btnPausa = document.createElement('button');
    btnPausa.type = 'button';
    btnPausa.className = 'slider-pausa';
    btnPausa.addEventListener('click', () => {
        if (pausas.has('usuario')) reanudar('usuario');
        else pausar('usuario');
        pintarPausa();
    });
    slider.appendChild(btnPausa);

    function pintarPausa() {
        const detenido = pausas.has('usuario');
        btnPausa.textContent = detenido ? '▶' : '❚❚';
        btnPausa.setAttribute('aria-label', detenido ? 'Reanudar el carrusel' : 'Pausar el carrusel');
        btnPausa.setAttribute('aria-pressed', detenido ? 'true' : 'false');
        // Si lo pausaron, el botón queda visible para poder reanudarlo.
        slider.classList.toggle('pausado', detenido);
    }

    // ---- navegación ----

    function irA(indice, manual) {
        const siguiente = (indice + imgs.length) % imgs.length;
        if (siguiente === actual) return;

        imgs[actual].classList.remove('activa');
        imgs[actual].setAttribute('aria-hidden', 'true');
        puntos.children[actual].classList.remove('activo');

        actual = siguiente;

        imgs[actual].classList.add('activa');
        imgs[actual].setAttribute('aria-hidden', 'false');
        puntos.children[actual].classList.add('activo');

        // Tras un clic se reinicia la cuenta: si no, la imagen que acaban de
        // elegir podría cambiar sola un instante después.
        if (manual) reiniciar();
    }

    // ---- cambio automático ----

    function detener() {
        clearTimeout(timer);
        timer = null;
    }

    function arrancar() {
        if (timer || pausas.size) return;
        timer = setTimeout(function paso() {
            irA(actual + 1, false);
            timer = setTimeout(paso, segundos * 1000);
        }, segundos * 1000);
    }

    function reiniciar() {
        detener();
        arrancar();
    }

    const pausar = (motivo) => { pausas.add(motivo); detener(); };
    const reanudar = (motivo) => { pausas.delete(motivo); arrancar(); };

    // Mientras lo miran de cerca o lo están navegando con el teclado, no se mueve.
    slider.addEventListener('mouseenter', () => pausar('mouse'));
    slider.addEventListener('mouseleave', () => reanudar('mouse'));
    slider.addEventListener('focusin', () => pausar('foco'));
    slider.addEventListener('focusout', () => reanudar('foco'));

    // En otra pestaña no tiene sentido seguir gastando repintados.
    document.addEventListener('visibilitychange', () => {
        if (document.hidden) pausar('pestaña');
        else reanudar('pestaña');
    });

    // Lo mismo si el carrusel quedó fuera de pantalla al bajar.
    if ('IntersectionObserver' in window) {
        new IntersectionObserver((entradas) => {
            entradas.forEach((e) => {
                if (e.isIntersecting) reanudar('fuera');
                else pausar('fuera');
            });
        }, { threshold: 0.2 }).observe(slider);
    }

    // ---- teclado y deslizar ----

    slider.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowLeft') { e.preventDefault(); irA(actual - 1, true); }
        if (e.key === 'ArrowRight') { e.preventDefault(); irA(actual + 1, true); }
    });

    let xInicio = null;
    slider.addEventListener('touchstart', (e) => {
        xInicio = e.changedTouches[0].clientX;
    }, { passive: true });
    slider.addEventListener('touchend', (e) => {
        if (xInicio === null) return;
        const dx = e.changedTouches[0].clientX - xInicio;
        xInicio = null;
        if (Math.abs(dx) < 40) return;          // un toque, no un deslizamiento
        irA(actual + (dx < 0 ? 1 : -1), true);
    }, { passive: true });

    pintarPausa();
    arrancar();
}

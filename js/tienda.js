/* Tienda Rosti — página oculta mientras está en pruebas. Experiencia tipo UberEats / Justo:
 *  1. Ubicación: la del navegador (precisa, con permiso) o aproximada por IP. Con eso propone
 *     el local más cercano; se cambia cuando quiera.
 *  2. Cada local ve SU menú (/api/tienda/catalogo?local=…): un menú por local o por tipo de local
 *     (Ventanitas, Restaurantes…) con sus artículos y su tarifa. Al cambiar de local se recarga
 *     el menú y el pedido se ajusta (lo que no exista allá se quita, con aviso).
 *  3. Ficha del artículo con los MODIFICADORES de ICG: grupos obligatorios u opcionales, una o
 *     varias opciones, opciones que se repiten («2 acompañamientos»: puré y puré), opciones
 *     gratis por grupo y opciones ANIDADAS (una opción que abre sus propios grupos). Si falta
 *     algo obligatorio, «Agregar» lleva al grupo que falta.
 *  4. Pedido en cajón lateral + barra inferior; checkout en 3 pasos con autocompletado por
 *     teléfono o cédula; confirmación con seguimiento del estado y el link de pago de BAC.
 * La tienda manda CÓDIGOS (artículo, opciones y de qué opción cuelga cada una); los precios
 * los pone y valida el servidor. Mientras la tienda es privada, la clave viaja en el
 * fragmento de la URL (#clave) y se recuerda en la pestaña.
 */
(function () {
    'use strict';
    var API = '/api/tienda';
    var ACCESO = '';
    try {
        var h = (location.hash || '').replace(/^#/, '');
        if (h) { sessionStorage.setItem('rosti.tienda.acceso', h); history.replaceState(null, '', location.pathname + location.search); }
        ACCESO = sessionStorage.getItem('rosti.tienda.acceso') || '';
    } catch (e) { ACCESO = ''; }

    var fmt = function (n) { return '₡' + Math.round(Number(n) || 0).toLocaleString('es-CR'); };
    var $ = function (s, r) { return (r || document).querySelector(s); };
    var el = function (tag, cls, html) { var e = document.createElement(tag); if (cls) e.className = cls; if (html !== undefined) e.innerHTML = html; return e; };
    var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
    // Foto perezosa: sólo se baja cuando está por entrar a la pantalla. Si falla, queda el fondo gris.
    function foto(src, alt) { var i = document.createElement('img'); i.loading = 'lazy'; i.decoding = 'async'; i.alt = alt || ''; i.src = src; i.onerror = function () { i.remove(); }; return i; }
    function ls(k, v) { try { if (v === undefined) return localStorage.getItem(k); if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) { return null; } }
    function sesionToken() { return ls('rosti.sesion') || ''; }
    function api(path, opts) {
        opts = opts || {};
        var headers = { 'Content-Type': 'application/json' };
        if (ACCESO) headers['X-Tienda-Acceso'] = ACCESO;
        var tk = sesionToken(); if (tk) headers['Authorization'] = 'Bearer ' + tk;
        return fetch(API + path, { method: opts.method || 'GET', headers: headers, body: opts.body ? JSON.stringify(opts.body) : undefined })
            .then(function (r) { return r.json().catch(function () { return {}; }).then(function (d) { if (!r.ok) { var e = new Error(d.error || ('Error ' + r.status)); e.datos = d; throw e; } return d; }); });
    }
    var toastT = null;
    function toast(txt) { var t = $('#toast'); t.textContent = txt; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(function () { t.hidden = true; }, 2600); }

    // ── Capas (modales y cajón) ───────────────────────────────────────────────
    // En el teléfono:
    //  · El gesto «atrás» (deslizar desde el borde en iPhone, botón atrás en Android) cierra la capa de arriba
    //    en vez de sacar a la persona de la página: cada capa abierta empuja una entrada al historial.
    //  · iOS Safari ignora overflow:hidden en el body y el fondo se sigue moviendo debajo del modal: se fija el
    //    body con position:fixed y se devuelve al mismo scroll al cerrar.
    var MODALES = ['#ficha-modal', '#checkout-modal', '#conf-modal', '#locales-modal', '#asistente', '#cuenta-modal', '#carrito'];
    var pila = [];
    function visible(s) { return s === '#carrito' ? $('#carrito').classList.contains('abierto') : !$(s).hidden; }
    function mostrar(s, si) {
        if (s === '#carrito') { $('#carrito').classList.toggle('abierto', si); $('#carrito').setAttribute('aria-hidden', si ? 'false' : 'true'); $('#carrito-velo').hidden = !si; }
        else $(s).hidden = !si;
        if (!si && s === '#ficha-modal') ficha = null;
    }
    var fijado = null;
    function refrescarBloqueo() {
        var abierto = MODALES.some(visible);
        var b = document.body;
        if (abierto && fijado === null) {
            fijado = window.scrollY || 0;
            b.style.position = 'fixed'; b.style.top = -fijado + 'px'; b.style.left = '0'; b.style.right = '0'; b.style.width = '100%';
        } else if (!abierto && fijado !== null) {
            var y = fijado; fijado = null;
            b.style.position = b.style.top = b.style.left = b.style.right = b.style.width = '';
            window.scrollTo({ top: y, behavior: 'instant' });
        }
        b.classList.toggle('bloqueado', abierto);
        $('#barra-pedido').hidden = !(unidades() > 0) || abierto;
    }
    function abrir(s) {
        if (visible(s)) return;
        mostrar(s, true); pila.push(s);
        try { history.pushState({ capa: s }, ''); } catch (e) { /* sin historial: igual funciona */ }
        refrescarBloqueo();
    }
    function cerrar(s) {
        if (!visible(s)) return;
        if (pila[pila.length - 1] === s) { history.back(); return; }      // el popstate la cierra
        mostrar(s, false); pila = pila.filter(function (x) { return x !== s; }); refrescarBloqueo();
    }
    // Cerrar una capa y abrir otra en el mismo paso (sin carrera entre history.back y pushState).
    function cambiar(desde, hacia) {
        if (pila[pila.length - 1] === desde && visible(desde)) {
            mostrar(desde, false); mostrar(hacia, true); pila[pila.length - 1] = hacia;
            try { history.replaceState({ capa: hacia }, ''); } catch (e) { /* */ }
            refrescarBloqueo();
        } else { if (visible(desde)) { mostrar(desde, false); pila = pila.filter(function (x) { return x !== desde; }); } abrir(hacia); }
    }
    window.addEventListener('popstate', function () {
        var s = pila.pop();
        if (s) mostrar(s, false);
        refrescarBloqueo();
    });
    // Altura real de la barra superior (cambia con el notch y el tamaño de letra del iPhone): la usan las categorías pegajosas.
    function medirBarra() { var h = $('.tb').getBoundingClientRect().height; document.documentElement.style.setProperty('--tb-h', Math.round(h) + 'px'); }
    medirBarra(); window.addEventListener('resize', medirBarra); window.addEventListener('orientationchange', function () { setTimeout(medirBarra, 300); });

    // ── Estado ────────────────────────────────────────────────────────────────
    var catalogo = null;            // respuesta de /catalogo del local elegido
    var porCodigo = {};             // codigo → artículo del menú del local
    var locales = [];
    var localSel = ls('rosti.local') || null;
    var ubic = null;                // { lat, lng, precision: 'gps'|'ciudad' }
    var carrito = [];
    try { carrito = JSON.parse(ls('rosti.carrito.v3') || '[]') || []; } catch (e) { carrito = []; }
    var guardar = function () { ls('rosti.carrito.v3', JSON.stringify(carrito)); };
    var unit = function (i) { return i.precio + i.mods.reduce(function (s, m) { return s + (m.precio || 0); }, 0); };
    var total = function () { return carrito.reduce(function (s, i) { return s + unit(i) * i.cantidad; }, 0); };
    var unidades = function () { return carrito.reduce(function (s, i) { return s + i.cantidad; }, 0); };
    var enCarrito = function (cod) { return carrito.reduce(function (s, i) { return s + (i.codigo === cod ? i.cantidad : 0); }, 0); };
    var localObj = function () { return locales.filter(function (x) { return x.codigo === localSel; })[0] || null; };

    // ── Cuenta (JWT de la tienda) ─────────────────────────────────────────────
    var cuenta = null;
    function renderCuenta() {
        $('#cuenta-label').textContent = cuenta && cuenta.nombre ? 'Hola, ' + cuenta.nombre.split(' ')[0] : (cuenta ? 'Mi cuenta' : 'Entrar');
        var f = $('#form-pedido');
        if (cuenta && f) { if (!f.nombre.value && cuenta.nombre) f.nombre.value = cuenta.nombre; if (!f.telefono.value && cuenta.telefono) f.telefono.value = cuenta.telefono; if (!f.email.value && cuenta.email) f.email.value = cuenta.email; if (!f.cedula.value && cuenta.cedula) f.cedula.value = cuenta.cedula; }
    }
    function cargarCuenta() {
        if (!sesionToken()) { cuenta = null; renderCuenta(); return Promise.resolve(); }
        return api('/mi').then(function (d) { cuenta = d.cliente; renderCuenta(); }).catch(function () { ls('rosti.sesion', null); cuenta = null; renderCuenta(); });
    }
    function abrirCuenta() {
        $('#cuenta-msg').textContent = '';
        var logueado = !!cuenta;
        $('#cuenta-form-email').hidden = logueado; $('#cuenta-form-codigo').hidden = true; $('#cuenta-panel').hidden = !logueado;
        $('#cuenta-titulo').textContent = logueado ? 'Mi cuenta' : 'Entrar a Rosti';
        if (logueado) {
            $('#cuenta-nombre').textContent = cuenta.nombre || cuenta.email;
            $('#cuenta-datos').textContent = [cuenta.telefono, cuenta.email].filter(Boolean).join(' · ');
            var lp = $('#cuenta-pedidos'); lp.innerHTML = (cuenta.ultimosPedidos || []).length ? '<p><strong>Tus últimos pedidos</strong></p>' : '<p>Todavía no tenés pedidos.</p>';
            (cuenta.ultimosPedidos || []).forEach(function (p) { lp.innerHTML += '<div class="cuenta-pedido"><strong>' + esc(p.codigo) + '</strong> · ' + esc(p.local || p.codAlmacen) + ' · ' + fmt(p.total) + '<small>' + esc((p.lineas || []).map(function (l) { return l.cantidad + ' × ' + l.descripcion; }).join(', ')) + ' · ' + esc(p.estado) + '</small></div>'; });
        }
        abrir('#cuenta-modal');
    }
    $('#btn-cuenta').onclick = abrirCuenta;
    $('#cuenta-cerrar').onclick = function () { cerrar('#cuenta-modal'); };
    $('#cuenta-form-email').addEventListener('submit', function (e) {
        e.preventDefault(); var email = e.target.email.value.trim(); var msg = $('#cuenta-msg'); msg.textContent = 'Enviando…'; msg.className = 'form-msg';
        api('/cuenta/codigo', { method: 'POST', body: { email: email } }).then(function () { msg.textContent = ''; $('#cuenta-email').textContent = email; $('#cuenta-form-email').hidden = true; $('#cuenta-form-codigo').hidden = false; $('#cuenta-form-codigo').codigo.focus(); })
            .catch(function (err) { msg.textContent = err.message; msg.className = 'form-msg error'; });
    });
    $('#cuenta-form-codigo').addEventListener('submit', function (e) {
        e.preventDefault(); var msg = $('#cuenta-msg'); msg.textContent = 'Verificando…'; msg.className = 'form-msg';
        api('/cuenta/entrar', { method: 'POST', body: { email: $('#cuenta-email').textContent, codigo: e.target.codigo.value, nombre: e.target.nombre.value.trim() || undefined } })
            .then(function (d) { ls('rosti.sesion', d.token); return cargarCuenta(); }).then(function () { cerrar('#cuenta-modal'); toast('¡Listo! Entraste a tu cuenta.'); })
            .catch(function (err) { msg.textContent = err.message; msg.className = 'form-msg error'; });
    });
    $('#cuenta-salir').onclick = function () { ls('rosti.sesion', null); cuenta = null; renderCuenta(); cerrar('#cuenta-modal'); };

    // ── Locales y ubicación ───────────────────────────────────────────────────
    function cargarLocales(lat, lng) {
        var q = (lat != null && lng != null) ? ('?lat=' + lat + '&lng=' + lng) : '';
        return api('/locales' + q).then(function (d) { locales = d.locales || []; renderLocal(); renderLocales(); });
    }
    function pedirGps() {
        if (!navigator.geolocation) { toast('Tu navegador no comparte la ubicación'); return; }
        $('#ubic-estado').textContent = 'Buscando tu ubicación…';
        navigator.geolocation.getCurrentPosition(function (p) {
            ubic = { lat: p.coords.latitude, lng: p.coords.longitude, precision: 'gps' };
            cargarLocales(ubic.lat, ubic.lng).then(function () {
                if (locales.length && locales[0].km != null) { $('#ubic-estado').textContent = 'Locales ordenados por tu ubicación.'; if (!localSel || $('#locales-modal').hidden === false) elegirLocal(locales[0].codigo); }
            });
        }, function () { $('#ubic-estado').textContent = 'Sin permiso de ubicación: elegí el local a mano.'; }, { enableHighAccuracy: true, timeout: 8000, maximumAge: 300000 });
    }
    function ubicacionPorIp() {
        return api('/ubicacion').then(function (d) {
            if (d.ubicacion) {
                ubic = { lat: d.ubicacion.lat, lng: d.ubicacion.lng, precision: 'ciudad', ciudad: d.ubicacion.ciudad };
                return cargarLocales(ubic.lat, ubic.lng).then(function () {
                    // Por IP la ubicación es aproximada (ciudad): sólo se propone el local si queda razonablemente cerca.
                    var cerca = locales.length && locales[0].km != null && locales[0].km <= 40;
                    $('#ubic-estado').textContent = cerca ? 'Te ubicamos cerca de ' + (d.ubicacion.ciudad || 'tu zona') + '. ¿No es tu local? Tocá arriba para cambiarlo.' : 'Elegí el local donde vas a recoger.';
                    if (!localSel) { if (cerca) elegirLocal(locales[0].codigo, true); else abrir('#locales-modal'); }
                });
            }
            $('#ubic-estado').textContent = 'Elegí el local donde vas a recoger.';
            return cargarLocales().then(function () { if (!localSel) abrir('#locales-modal'); });
        }).catch(function () { return cargarLocales(); });
    }
    function elegirLocal(codigo, silencioso) {
        var cambio = codigo !== localSel;
        localSel = codigo; ls('rosti.local', codigo);
        renderLocal(); renderLocales(); cerrar('#locales-modal');
        if (cambio || !catalogo || catalogo.local !== codigo) cargarCatalogo().then(function () { if (cambio && !silencioso && localObj()) toast('Ahora pedís en ' + localObj().nombre); });
    }
    function renderLocal() {
        var l = localObj();
        $('#local-nombre').textContent = l ? l.nombre : 'Elegí tu local';
        $('#hero-local').textContent = l ? l.nombre : 'Costa Rica';
        var km = $('#chip-km'); km.hidden = !(l && l.km != null && l.km < 300); if (l && l.km != null) km.textContent = '📍 ' + l.km + ' km';
        $('#carrito-local').textContent = l ? 'Para recoger en ' + l.nombre : '';
        var b = $('#checkout-local');
        b.innerHTML = l ? '<span><strong>Rosti ' + esc(l.nombre) + '</strong><small>' + esc([l.km != null ? l.km + ' km' : null, l.zona].filter(Boolean).join(' · ')) + '</small></span><span class="cambiar">Cambiar</span>' : '<span><strong>Elegí el local</strong></span><span class="cambiar">Elegir</span>';
        $('#local').value = localSel || '';
    }
    function renderLocales() {
        var lista = $('#locales-lista'); lista.innerHTML = '';
        var q = ($('#locales-buscar').value || '').trim().toLowerCase();
        var hayKm = locales.some(function (x) { return x.km != null; });
        lista.appendChild(el('p', 'locales-hint', hayKm ? 'Del más cercano al más lejano. Podés elegir cualquiera.' : 'Todos los locales. Usá tu ubicación para ver los más cercanos.'));
        locales.filter(function (x) { return !q || (x.nombre + ' ' + (x.zona || '')).toLowerCase().indexOf(q) >= 0; }).forEach(function (x) {
            var it = el('button', 'local-item' + (x.codigo === localSel ? ' sel' : ''));
            it.type = 'button';
            it.innerHTML = '<span class="li-ico">📍</span><span class="li-txt"><strong>' + esc(x.nombre) + '</strong><small>' + esc(x.zona || '') + '</small></span>' + (x.km != null && x.km < 300 ? '<span class="li-km">' + x.km + ' km</span>' : '');
            it.onclick = function () { elegirLocal(x.codigo); };
            lista.appendChild(it);
        });
    }
    $('#local-btn').onclick = function () { renderLocales(); abrir('#locales-modal'); };
    $('#checkout-local').onclick = function () { renderLocales(); abrir('#locales-modal'); };
    $('#locales-cerrar').onclick = function () { cerrar('#locales-modal'); };
    $('#ubic-gps').onclick = pedirGps;
    $('#locales-buscar').addEventListener('input', renderLocales);

    // ── Menú del local ────────────────────────────────────────────────────────
    function cargarCatalogo() {
        return api('/catalogo' + (localSel ? '?local=' + encodeURIComponent(localSel) : '')).then(function (d) {
            catalogo = d; porCodigo = {};
            (d.familias || []).forEach(function (f) { f.articulos.forEach(function (a) { if (!porCodigo[a.codigo]) porCodigo[a.codigo] = a; }); });
            if (!locales.length && d.locales) { locales = d.locales; renderLocal(); }
            renderCatalogo(); reconciliar(); renderCarrito();
            $('#cargando').hidden = true;
            if (d.pagos && d.pagos.mensaje) { $('#pago-nota').textContent = d.pagos.mensaje; }
            inyectarJsonLd(d);
        });
    }
    function itemCard(a) {
        var card = el('article', 'item'); card.tabIndex = 0; card.setAttribute('role', 'button'); card.dataset.codigo = a.codigo;
        card.dataset.buscar = (a.nombre + ' ' + (a.descripcion || '')).toLowerCase();
        var txt = el('div', 'item-txt');
        txt.appendChild(el('h3', '', esc(a.nombre)));
        if (a.descripcion) txt.appendChild(el('p', '', esc(a.descripcion)));
        var obligatorios = (a.modificadores || []).filter(function (g) { return g.min > 0; }).length;
        txt.appendChild(el('div', 'item-precio', fmt(a.precio) + (a.destacado ? ' <span class="tag">Popular</span>' : '') + (obligatorios ? ' <span class="tag verde">Personalizable</span>' : '')));
        card.appendChild(txt);
        var img = el('div', 'item-img' + (a.imagenUrl ? '' : ' sin'), a.imagenUrl ? '' : '🍗');
        if (a.imagenUrl) img.appendChild(foto(a.imagenUrl, a.nombre));
        var mas = el('button', 'mas'); mas.type = 'button'; mas.setAttribute('aria-label', 'Agregar ' + a.nombre); mas.dataset.mas = a.codigo;
        mas.onclick = function (ev) { ev.stopPropagation(); agregarRapido(a); };
        img.appendChild(mas); card.appendChild(img);
        card.onclick = function () { abrirFicha(a); };
        card.onkeydown = function (ev) { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); abrirFicha(a); } };
        return card;
    }
    function renderCatalogo() {
        var tabs = $('#familias'), cont = $('#articulos');
        tabs.innerHTML = ''; cont.innerHTML = '';
        var fams = catalogo.familias || [];
        if (!fams.length) { cont.appendChild(el('p', 'vacio', 'Este local todavía no tiene artículos en línea. Probá con otro local.')); $('#destacados').hidden = true; return; }
        // Los más pedidos
        var dest = (catalogo.destacados || []).map(function (c) { return porCodigo[c]; }).filter(Boolean);
        var dl = $('#destacados-lista'); dl.innerHTML = '';
        dest.forEach(function (a) {
            var c = el('div', 'dest-card'); c.tabIndex = 0; c.setAttribute('role', 'button'); c.dataset.codigo = a.codigo;
            var im = el('div', 'dest-img'); if (a.imagenUrl) im.appendChild(foto(a.imagenUrl, a.nombre));
            var mas = el('button', 'mas'); mas.type = 'button'; mas.dataset.mas = a.codigo; mas.setAttribute('aria-label', 'Agregar ' + a.nombre);
            mas.onclick = function (ev) { ev.stopPropagation(); agregarRapido(a); };
            im.appendChild(mas); c.appendChild(im);
            c.appendChild(el('h3', '', esc(a.nombre))); c.appendChild(el('p', '', fmt(a.precio)));
            c.onclick = function () { abrirFicha(a); };
            dl.appendChild(c);
        });
        $('#destacados').hidden = !dest.length;
        fams.forEach(function (f, i) {
            var b = el('button', 'cat-tab' + (i === 0 ? ' activa' : ''), esc(f.nombre)); b.type = 'button'; b.dataset.fam = f.id;
            b.onclick = function () { var s = document.getElementById('fam-' + f.id); if (s) window.scrollTo({ top: s.getBoundingClientRect().top + window.scrollY - ($('.cats').getBoundingClientRect().bottom + 8), behavior: 'smooth' }); };
            tabs.appendChild(b);
            var sec = el('section', 'familia'); sec.id = 'fam-' + f.id; sec.dataset.fam = f.id;
            var head = el('div', 'familia-head');
            if (f.imagenUrl) { var im = el('img'); im.src = f.imagenUrl; im.alt = ''; im.loading = 'lazy'; head.appendChild(im); }
            head.appendChild(el('h2', '', esc(f.nombre) + (f.descripcion ? '<small>' + esc(f.descripcion) + '</small>' : '')));
            sec.appendChild(head);
            var grid = el('div', 'grid');
            f.articulos.forEach(function (a) { grid.appendChild(itemCard(a)); });
            sec.appendChild(grid); cont.appendChild(sec);
        });
        $('#pie-menu').textContent = (catalogo.menu && catalogo.menu.nombre ? 'Menú ' + catalogo.menu.nombre + ' · ' : '') + 'Precios en colones con IVA incluido.';
        espiarCategorias(); filtrar(); marcarEnCarrito();
    }
    // Categoría activa según el scroll (como las apps de delivery).
    var espia = null;
    function espiarCategorias() {
        if (espia) espia.disconnect();
        if (!('IntersectionObserver' in window)) return;
        espia = new IntersectionObserver(function (entradas) {
            entradas.forEach(function (e) {
                if (!e.isIntersecting) return;
                var id = e.target.dataset.fam;
                var tabs = $('#familias');
                document.querySelectorAll('.cat-tab').forEach(function (t) { var on = t.dataset.fam === id; t.classList.toggle('activa', on); if (on) tabs.scrollTo({ left: t.offsetLeft - tabs.clientWidth / 2 + t.clientWidth / 2, behavior: 'smooth' }); });
            });
        }, { rootMargin: '-' + Math.round($('.cats').getBoundingClientRect().bottom + 10) + 'px 0px -60% 0px' });
        document.querySelectorAll('.familia').forEach(function (s) { espia.observe(s); });
    }
    function filtrar() {
        var q = ($('#buscar').value || '').trim().toLowerCase();
        var hay = false;
        document.querySelectorAll('.familia').forEach(function (s) {
            var n = 0;
            s.querySelectorAll('.item').forEach(function (it) { var ok = !q || q.split(/\s+/).every(function (w) { return it.dataset.buscar.indexOf(w) >= 0; }); it.hidden = !ok; if (ok) n++; });
            s.hidden = !n; if (n) hay = true;
        });
        $('#destacados').hidden = !!q || !(catalogo && (catalogo.destacados || []).length);
        $('#sin-resultados').hidden = hay || !catalogo || !(catalogo.familias || []).length;
    }
    $('#buscar').addEventListener('input', filtrar);
    function marcarEnCarrito() {
        document.querySelectorAll('[data-mas]').forEach(function (b) { var n = enCarrito(Number(b.dataset.mas)); b.classList.toggle('en-carrito', n > 0); b.innerHTML = n > 0 ? '<span class="n">' + n + '</span>' : '+'; });
    }
    function agregarRapido(a) {
        var obligatorios = (a.modificadores || []).some(function (g) { return g.min > 0; });
        if (obligatorios || (a.modificadores || []).length) { abrirFicha(a); return; }
        agregarAlCarrito(a, [], '', 1);
    }

    // ── Ficha del artículo: modificadores de ICG ──────────────────────────────
    // sel[clave] = [códigos en el orden elegido]; clave = padre + '>' + grupo, y padre es
    // '' arriba o 'grupo:opción' de la opción de la que cuelga el grupo (lo que espera el servidor).
    var ficha = null;
    var clave = function (padre, g) { return (padre || '') + '>' + g.codigo; };
    function preseleccionar(grupos, padre) {
        (grupos || []).forEach(function (g) {
            var k = clave(padre, g);
            if (!ficha.sel[k]) ficha.sel[k] = g.opciones.filter(function (o) { return o.predeterminado; }).slice(0, g.max).map(function (o) { return o.codigo; });
            ficha.sel[k].forEach(function (cod) { var o = opcionDe(g, cod); if (o && o.modificadores) preseleccionar(o.modificadores, g.codigo + ':' + o.codigo); });
        });
    }
    function opcionDe(g, cod) { return g.opciones.filter(function (o) { return o.codigo === cod; })[0]; }
    function limpiarRama(grupos, padre) {
        (grupos || []).forEach(function (g) {
            var k = clave(padre, g);
            (ficha.sel[k] || []).forEach(function (cod) { var o = opcionDe(g, cod); if (o && o.modificadores) limpiarRama(o.modificadores, g.codigo + ':' + o.codigo); });
            delete ficha.sel[k];
        });
    }
    function unicos(arr) { return arr.filter(function (x, i) { return arr.indexOf(x) === i; }); }
    function grupoOk(g, padre) { var n = (ficha.sel[clave(padre, g)] || []).length; return n >= g.min && n <= g.max; }
    function primeraFalta(grupos, padre) {
        for (var i = 0; i < (grupos || []).length; i++) {
            var g = grupos[i];
            if (!grupoOk(g, padre)) return clave(padre, g);
            var sel = unicos(ficha.sel[clave(padre, g)] || []);
            for (var j = 0; j < sel.length; j++) { var o = opcionDe(g, sel[j]); if (o && o.modificadores) { var f = primeraFalta(o.modificadores, g.codigo + ':' + o.codigo); if (f) return f; } }
        }
        return null;
    }
    // Selección plana para el servidor y el carrito (mismo orden: el «gratis» va por orden).
    function aplanar(grupos, padre, padreNombre, out) {
        (grupos || []).forEach(function (g) {
            var sel = ficha.sel[clave(padre, g)] || [], vistos = {};
            sel.forEach(function (cod, i) {
                var o = opcionDe(g, cod); if (!o) return;
                var m = { grupo: g.codigo, grupoNombre: g.nombre, codigo: o.codigo, nombre: o.nombre, precio: i < g.gratis ? 0 : (o.precio || 0) };
                if (padre) { var p = padre.split(':'); m.padreGrupo = Number(p[0]); m.padreCodigo = Number(p[1]); m.padreNombre = padreNombre; }
                out.push(m);
                if (o.modificadores && !vistos[cod]) { vistos[cod] = 1; aplanar(o.modificadores, g.codigo + ':' + o.codigo, o.nombre, out); }
            });
        });
        return out;
    }
    function fichaUnit() { return ficha.art.precio + aplanar(ficha.art.modificadores, '', null, []).reduce(function (s, m) { return s + m.precio; }, 0); }
    function abrirFicha(a, editar, desde) {
        ficha = { art: a, sel: {}, cantidad: 1, editar: editar || null, abiertos: {} };
        if (editar) { ficha.sel = JSON.parse(JSON.stringify(editar.sel || {})); ficha.cantidad = editar.cantidad; }
        else preseleccionar(a.modificadores, '');
        $('#ficha-titulo').textContent = a.nombre;
        $('#ficha-precio').textContent = fmt(a.precio);
        $('#ficha-desc').textContent = a.descripcion || '';
        var w = $('#ficha-img-wrap'), im = $('#ficha-img');
        if (a.imagenUrl) { im.src = a.imagenUrl; im.alt = a.nombre; w.classList.remove('sin'); } else { im.removeAttribute('src'); w.classList.add('sin'); }
        $('#ficha-nota').value = editar ? (editar.nota || '') : '';
        renderFicha();
        if (desde) cambiar(desde, '#ficha-modal'); else abrir('#ficha-modal');
        $('#ficha-scroll').scrollTop = 0;
    }
    function reglaTexto(g) {
        var t = g.max === 1 ? 'Elegí 1' : (g.min === g.max ? 'Elegí ' + g.max : (g.min > 0 ? 'Elegí entre ' + g.min + ' y ' + g.max : 'Hasta ' + g.max));
        if (g.repetir) t += ' · podés repetir';
        if (g.gratis) t += ' · ' + (g.gratis === 1 ? 'la primera sin costo' : 'las primeras ' + g.gratis + ' sin costo');
        return t;
    }
    function renderGrupos(grupos, padre, cont) {
        (grupos || []).forEach(function (g) {
            var k = clave(padre, g), sel = ficha.sel[k] || (ficha.sel[k] = []);
            var box = el('div', 'grupo'); box.dataset.clave = k;
            var ok = grupoOk(g, padre);
            // Dentro de una opción, los grupos OPCIONALES (extras, bebidas…) van plegados hasta que se abren.
            if (padre && g.min === 0 && !sel.length && !ficha.abiertos[k]) {
                var pl = el('button', 'grupo-plegado', '<span><strong>' + esc(g.nombre) + '</strong><small>Opcional · ' + g.opciones.length + ' opciones</small></span><span class="ver">Ver opciones ▾</span>');
                pl.type = 'button'; pl.onclick = function () { ficha.abiertos[k] = true; renderFicha(); };
                box.appendChild(pl); cont.appendChild(box); return;
            }
            var badge = g.min > 0 ? (ok ? '<span class="badge-g listo">✓ Listo</span>' : '<span class="badge-g req">Obligatorio</span>') : '<span class="badge-g">Opcional</span>';
            box.appendChild(el('div', 'grupo-head', '<div><h4>' + esc(g.nombre) + '</h4><small>' + reglaTexto(g) + (g.max > 1 ? ' · ' + sel.length + '/' + g.max : '') + '</small></div>' + badge));
            g.opciones.forEach(function (o) {
                var n = sel.filter(function (c) { return c === o.codigo; }).length;
                var lleno = sel.length >= g.max;
                var repetible = g.repetir && !o.modificadores;
                var row = el('div', 'opcion' + (n ? ' on' : '') + (!n && lleno && g.max > 1 ? ' deshab' : ''));
                // ¿Esta opción sale gratis? (las primeras g.gratis elegidas del grupo)
                var primerIdx = sel.indexOf(o.codigo);
                var gratis = o.precio > 0 && g.gratis > 0 && (n ? primerIdx < g.gratis : sel.length < g.gratis);
                var precio = o.precio > 0 ? (gratis ? '<span class="op-precio"><s>+' + fmt(o.precio) + '</s><span class="gratis">Gratis</span></span>' : '<span class="op-precio">+' + fmt(o.precio) + '</span>') : '';
                var txt = '<div class="op-txt"><span class="op-nombre">' + esc(o.nombre) + '</span>' + precio + '</div>';
                if (repetible) {
                    row.innerHTML = txt;
                    var st = el('div', 'stepper chico');
                    var menos = el('button', '', '−'); menos.type = 'button'; menos.disabled = !n; menos.setAttribute('aria-label', 'Quitar ' + o.nombre);
                    var cant = el('span', '', String(n));
                    var mas = el('button', '', '+'); mas.type = 'button'; mas.disabled = lleno; mas.setAttribute('aria-label', 'Agregar ' + o.nombre);
                    menos.onclick = function (ev) { ev.stopPropagation(); var i = sel.lastIndexOf(o.codigo); if (i >= 0) sel.splice(i, 1); renderFicha(); };
                    mas.onclick = function (ev) { ev.stopPropagation(); if (sel.length < g.max) { sel.push(o.codigo); renderFicha(); } };
                    st.appendChild(menos); st.appendChild(cant); st.appendChild(mas); row.appendChild(st);
                    row.onclick = function () { if (!n && sel.length < g.max) { sel.push(o.codigo); renderFicha(); } };
                } else {
                    row.innerHTML = '<span class="marca ' + (g.max === 1 ? 'radio' : 'check') + '"></span>' + txt;
                    row.setAttribute('role', g.max === 1 ? 'radio' : 'checkbox'); row.setAttribute('aria-checked', n ? 'true' : 'false'); row.tabIndex = 0;
                    row.onclick = function () {
                        if (n) {
                            if (g.max === 1 && g.min >= 1) return;               // radio obligatorio: se cambia eligiendo otra
                            ficha.sel[k] = sel.filter(function (c) { return c !== o.codigo; });
                            if (o.modificadores) limpiarRama(o.modificadores, g.codigo + ':' + o.codigo);
                        } else if (g.max === 1) {
                            sel.forEach(function (c) { var v = opcionDe(g, c); if (v && v.modificadores) limpiarRama(v.modificadores, g.codigo + ':' + v.codigo); });
                            ficha.sel[k] = [o.codigo];
                            if (o.modificadores) preseleccionar(o.modificadores, g.codigo + ':' + o.codigo);
                        } else {
                            if (sel.length >= g.max) { toast('Máximo ' + g.max + ' en «' + g.nombre + '»'); return; }
                            sel.push(o.codigo);
                            if (o.modificadores) preseleccionar(o.modificadores, g.codigo + ':' + o.codigo);
                        }
                        renderFicha();
                    };
                    row.onkeydown = function (ev) { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); row.onclick(); } };
                }
                box.appendChild(row);
                // Opción elegida que abre sus propios grupos (modificador anidado de ICG)
                if (n && o.modificadores) {
                    var sub = el('div', 'sub-grupos');
                    renderGrupos(o.modificadores, g.codigo + ':' + o.codigo, sub);
                    box.appendChild(sub);
                }
            });
            cont.appendChild(box);
        });
    }
    function renderFicha() {
        var cont = $('#ficha-grupos'), y = $('#ficha-scroll').scrollTop;
        cont.innerHTML = '';
        renderGrupos(ficha.art.modificadores, '', cont);
        $('#ficha-scroll').scrollTop = y;
        $('#ficha-cant').textContent = ficha.cantidad;
        $('#ficha-menos').disabled = ficha.cantidad <= 1;
        $('#ficha-agregar').innerHTML = '<span>' + (ficha.editar ? 'Guardar cambios' : 'Agregar ' + ficha.cantidad + ' al pedido') + '</span><span>' + fmt(fichaUnit() * ficha.cantidad) + '</span>';
    }
    function agregarDesdeFicha() {
        var falta = primeraFalta(ficha.art.modificadores, '');
        if (falta) {
            var g = document.querySelector('.grupo[data-clave="' + falta.replace(/"/g, '') + '"]');
            if (g) { g.classList.add('falta', 'sacudir'); g.scrollIntoView({ behavior: 'smooth', block: 'start' }); setTimeout(function () { g.classList.remove('sacudir'); }, 450); }
            toast('Te falta elegir: ' + (g ? g.querySelector('h4').textContent : 'una opción'));
            return;
        }
        var mods = aplanar(ficha.art.modificadores, '', null, []);
        var nota = $('#ficha-nota').value.trim();
        if (ficha.editar) { var idx = carrito.indexOf(ficha.editar); if (idx >= 0) carrito.splice(idx, 1); }
        agregarAlCarrito(ficha.art, mods, nota, ficha.cantidad, JSON.parse(JSON.stringify(ficha.sel)));
        cerrar('#ficha-modal');
    }
    function agregarAlCarrito(a, mods, nota, cantidad, sel) {
        var key = a.codigo + '|' + mods.map(function (m) { return (m.padreGrupo ? m.padreGrupo + ':' + m.padreCodigo + '>' : '') + m.grupo + ':' + m.codigo; }).join(',') + '|' + nota;
        var ya = carrito.filter(function (i) { return i.key === key; })[0];
        if (ya) ya.cantidad += cantidad;
        else carrito.push({ key: key, codigo: a.codigo, nombre: a.nombre, img: a.imagenUrl || null, precio: a.precio, cantidad: cantidad, mods: mods, nota: nota, sel: sel || {} });
        guardar(); renderCarrito();
        var b = $('#btn-carrito'); b.classList.add('pulso'); setTimeout(function () { b.classList.remove('pulso'); }, 250);
        toast('Agregaste ' + cantidad + ' × ' + a.nombre);
    }
    // Al cambiar de local, el pedido se ajusta al menú del nuevo local.
    function reconciliar() {
        if (!carrito.length || !catalogo) return;
        var quitados = [], cambiados = 0;
        carrito = carrito.filter(function (i) {
            var a = porCodigo[i.codigo];
            if (!a) { quitados.push(i.nombre); return false; }
            if (a.precio !== i.precio) { i.precio = a.precio; cambiados++; }
            return true;
        });
        guardar();
        if (quitados.length) toast('No está en el menú de este local: ' + quitados.join(', '));
        else if (cambiados) toast('Actualizamos los precios al menú de este local');
    }

    // ── Pedido (cajón) ────────────────────────────────────────────────────────
    function detalleMods(i) {
        var partes = [];
        var cuenta = {};
        i.mods.forEach(function (m) { var k = (m.padreNombre || '') + '|' + m.nombre; cuenta[k] = (cuenta[k] || 0) + 1; });
        Object.keys(cuenta).forEach(function (k) { var p = k.split('|'); partes.push((p[0] ? '↳ ' : '') + esc(p[1]) + (cuenta[k] > 1 ? ' ×' + cuenta[k] : '')); });
        return partes.join(', ') + (i.nota ? (partes.length ? ' · ' : '') + '<em>«' + esc(i.nota) + '»</em>' : '');
    }
    function renderCarrito() {
        var n = unidades(), t = fmt(total());
        $('#carrito-n').textContent = n; $('#carrito-total').textContent = t; $('#resumen-total').textContent = t;
        $('#bp-n').textContent = n; $('#bp-total').textContent = t;
        $('#btn-carrito').classList.toggle('con-items', n > 0);
        var lista = $('#carrito-lista'); lista.innerHTML = '';
        if (!n) lista.appendChild(el('div', 'carrito-vacio', '<b>🛍️</b>Tu pedido está vacío.<br>Agregá algo rico del menú.'));
        carrito.forEach(function (i, idx) {
            var row = el('div', 'c-item');
            var im = el('div', 'c-img'); if (i.img) im.appendChild(foto(i.img, '')); row.appendChild(im);
            var info = el('div', '', '<div class="c-nombre">' + esc(i.nombre) + '</div><div class="c-det">' + (detalleMods(i) || fmt(i.precio) + ' c/u') + '</div>');
            if (i.mods.length && porCodigo[i.codigo]) { var ed = el('button', 'btn-link', 'Editar'); ed.type = 'button'; ed.style.cssText = 'border:0;background:none;padding:.3rem 0 0;color:#D47A22;font-weight:700;cursor:pointer;font:inherit;font-size:.82rem'; ed.onclick = function () { abrirFicha(porCodigo[i.codigo], i, '#carrito'); }; info.appendChild(ed); }
            row.appendChild(info);
            var acc = el('div', 'c-acc');
            acc.appendChild(el('div', 'c-importe', fmt(unit(i) * i.cantidad)));
            var st = el('div', 'stepper chico');
            var menos = el('button', '', i.cantidad === 1 ? '🗑' : '−'); menos.type = 'button'; menos.setAttribute('aria-label', 'Quitar uno');
            menos.onclick = function () { i.cantidad -= 1; if (i.cantidad <= 0) carrito.splice(idx, 1); guardar(); renderCarrito(); };
            var mas = el('button', '', '+'); mas.type = 'button'; mas.setAttribute('aria-label', 'Agregar uno');
            mas.onclick = function () { if (i.cantidad < 50) { i.cantidad += 1; guardar(); renderCarrito(); } };
            st.appendChild(menos); st.appendChild(el('span', '', String(i.cantidad))); st.appendChild(mas);
            acc.appendChild(st); row.appendChild(acc);
            lista.appendChild(row);
        });
        $('#btn-enviar').disabled = !n; $('#btn-pedir').disabled = !n;
        $('#resumen-lineas').innerHTML = carrito.map(function (i) { var d = detalleMods(i); return '<div><span>' + i.cantidad + ' × ' + esc(i.nombre) + (d ? '<small>' + d + '</small>' : '') + '</span><span>' + fmt(unit(i) * i.cantidad) + '</span></div>'; }).join('');
        marcarEnCarrito(); refrescarBloqueo();
    }
    function abrirCarrito(si) { if (si) abrir('#carrito'); else cerrar('#carrito'); }
    $('#btn-carrito').onclick = function () { abrirCarrito(true); };
    $('#barra-pedido').onclick = function () { abrirCarrito(true); };
    $('#carrito-cerrar').onclick = function () { abrirCarrito(false); };
    $('#carrito-velo').onclick = function () { abrirCarrito(false); };

    // ── Checkout ──────────────────────────────────────────────────────────────
    var autoTimer = null;
    function autocompletar(campo) {
        clearTimeout(autoTimer);
        autoTimer = setTimeout(function () {
            var f = $('#form-pedido'), tel = f.telefono.value.replace(/\D/g, ''), ced = f.cedula.value.replace(/\D/g, '');
            var q = campo === 'cedula' && ced.length >= 9 ? 'cedula=' + ced : (tel.length >= 8 ? 'telefono=' + tel : null);
            if (!q) return;
            api('/clientes/buscar?' + q).then(function (d) {
                if (!d.cliente) return;
                if (!f.nombre.value) f.nombre.value = d.cliente.nombre || '';
                if (!f.email.value && d.cliente.email) f.email.value = d.cliente.email;
                if (!f.cedula.value && d.cliente.cedula) f.cedula.value = d.cliente.cedula;
                if (!f.telefono.value && d.cliente.telefono) f.telefono.value = d.cliente.telefono;
                $('#form-msg').textContent = '¡Hola de nuevo' + (d.cliente.nombre ? ', ' + d.cliente.nombre.split(' ')[0] : '') + '! Completamos tus datos.'; $('#form-msg').className = 'form-msg ok';
            }).catch(function () { /* sin autocompletar */ });
        }, 400);
    }
    $('#btn-pedir').onclick = function () { renderLocal(); renderCuenta(); $('#form-msg').textContent = ''; cambiar('#carrito', '#checkout-modal'); };
    $('#checkout-cerrar').onclick = function () { cerrar('#checkout-modal'); };
    $('#form-pedido').telefono.addEventListener('input', function () { autocompletar('telefono'); });
    $('#form-pedido').cedula.addEventListener('input', function () { autocompletar('cedula'); });
    $('#form-pedido').addEventListener('submit', function (ev) {
        ev.preventDefault();
        var f = ev.target, msg = $('#form-msg');
        msg.textContent = ''; msg.className = 'form-msg';
        var nombre = f.nombre.value.trim(), tel = f.telefono.value.trim();
        if (!localSel) { msg.textContent = 'Elegí el local donde vas a recoger.'; msg.className = 'form-msg error'; return; }
        if (!nombre || !tel) { msg.textContent = 'Necesitamos tu nombre y un teléfono para avisarte.'; msg.className = 'form-msg error'; return; }
        var btn = $('#btn-enviar'); btn.disabled = true; btn.textContent = 'Enviando…';
        api('/pedidos', { method: 'POST', body: {
            codAlmacen: localSel, modalidad: 'recoger', origen: 'rosti.cr',
            cliente: { nombre: nombre, telefono: tel, email: f.email.value.trim() || undefined, cedula: f.cedula.value.trim() || undefined },
            notas: f.notas.value.trim() || undefined, claveIdempotencia: 'web-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8),
            lineas: carrito.map(function (i) { return { codigo: i.codigo, cantidad: i.cantidad, notas: i.nota || undefined, modificadores: i.mods.map(function (m) { return { grupo: m.grupo, codigo: m.codigo, padreGrupo: m.padreGrupo, padreCodigo: m.padreCodigo }; }) }; })
        } }).then(function (d) {
            carrito = []; guardar(); renderCarrito();
            $('#conf-codigo').textContent = d.pedido.codigo;
            $('#conf-total').textContent = fmt(d.pedido.total);
            $('#conf-local').textContent = 'Rosti ' + (d.pedido.local || localSel);
            $('#conf-msg').textContent = (d.pago && d.pago.mensaje) || '';
            pasos('pendiente_pago');
            cambiar('#checkout-modal', '#conf-modal');
            seguirPedido(d.pedido.codigo);
        }).catch(function (e) { msg.textContent = e.message || 'No se pudo enviar el pedido. Probá de nuevo.'; msg.className = 'form-msg error'; })
          .then(function () { btn.disabled = !unidades(); btn.textContent = 'Enviar pedido'; });
    });

    // ── Seguimiento: pago (BAC Compra Click lo pega Rosti) y estado ──────────
    var ORDEN = ['recibido', 'pago', 'cocina', 'listo'];
    function pasos(estado) {
        var actual = { pendiente_pago: 'pago', pagado: 'cocina', en_preparacion: 'cocina', listo: 'listo', entregado: null, en_camino: 'listo' }[estado];
        var ia = actual ? ORDEN.indexOf(actual) : ORDEN.length;
        document.querySelectorAll('#pasos-pedido li').forEach(function (li, i) { li.classList.toggle('hecho', i < ia || estado === 'entregado'); li.classList.toggle('actual', i === ia && estado !== 'entregado'); });
    }
    var pollPago = null;
    function seguirPedido(codigo) {
        clearInterval(pollPago);
        var a = $('#conf-pagar'), esp = $('#conf-espera');
        a.style.display = 'none'; esp.hidden = false;
        function mirar() {
            api('/pedidos/' + encodeURIComponent(codigo)).then(function (d) {
                var p = d.pedido; pasos(p.estado);
                if (p.estado === 'pendiente_pago') {
                    if (p.pago && p.pago.link) { a.href = p.pago.link; a.style.display = 'block'; esp.hidden = true; $('#conf-msg').textContent = p.pago.mensaje || ''; }
                } else {
                    a.style.display = 'none'; esp.hidden = true;
                    $('#conf-msg').textContent = { pagado: '¡Pago confirmado! El local ya está preparando tu pedido.', en_preparacion: 'Tu pedido se está preparando.', listo: '¡Tu pedido está listo! Te esperamos.', entregado: '¡Gracias por tu compra!', cancelado: 'El pedido se canceló.', vencido: 'El pedido venció sin pago.' }[p.estado] || p.estadoNombre || p.estado;
                    if (['entregado', 'cancelado', 'vencido'].indexOf(p.estado) >= 0) clearInterval(pollPago);
                }
            }).catch(function () { /* reintenta */ });
        }
        mirar(); pollPago = setInterval(mirar, 15000);
    }
    $('#conf-otro').onclick = function () { cerrar('#conf-modal'); window.scrollTo({ top: 0, behavior: 'smooth' }); };

    // ── Datos estructurados (schema.org) para Google / Gemini ─────────────────
    function inyectarJsonLd(d) {
        try {
            var viejo = document.getElementById('jsonld-tienda'); if (viejo) viejo.remove();
            var abs = function (u) { return u ? (u.indexOf('http') === 0 ? u : location.origin + u) : undefined; };
            var secciones = (d.familias || []).map(function (f) { return { '@type': 'MenuSection', name: f.nombre, hasMenuItem: f.articulos.map(function (a) { return { '@type': 'MenuItem', name: a.nombre, description: a.descripcion || undefined, image: abs(a.imagenUrl), offers: { '@type': 'Offer', price: a.precio, priceCurrency: 'CRC', availability: 'https://schema.org/InStock' } }; }) }; });
            var data = { '@context': 'https://schema.org', '@type': 'Restaurant', name: 'Rosti Costa Rica', url: location.origin + '/', telephone: '+506-2277-0800', servesCuisine: 'Pollo asado', priceRange: '₡₡', acceptsReservations: 'False',
                hasMenu: { '@type': 'Menu', name: 'Menú para recoger', hasMenuSection: secciones },
                potentialAction: { '@type': 'OrderAction', target: { '@type': 'EntryPoint', urlTemplate: location.origin + '/pedir.html', actionPlatform: ['http://schema.org/DesktopWebPlatform', 'http://schema.org/MobileWebPlatform'] }, deliveryMethod: 'http://purl.org/goodrelations/v1#DeliveryModePickUp' },
                department: (d.locales || []).map(function (l) { return { '@type': 'Restaurant', name: 'Rosti ' + l.nombre, address: l.zona ? { '@type': 'PostalAddress', addressLocality: l.zona, addressCountry: 'CR' } : undefined, geo: l.lat != null ? { '@type': 'GeoCoordinates', latitude: l.lat, longitude: l.lng } : undefined, telephone: l.telefono || undefined, hasMap: l.mapa || undefined }; }) };
            var s = document.createElement('script'); s.type = 'application/ld+json'; s.id = 'jsonld-tienda'; s.textContent = JSON.stringify(data); document.head.appendChild(s);
        } catch (e) { /* los datos estructurados son un extra */ }
    }

    // ── Asistente: la IA dentro de la tienda (POST /api/tienda/asistente) ─────
    var conv = [];
    var chat = $('#chat');
    function burbuja(cls, html) { var b = el('div', 'burbuja ' + cls, html); chat.appendChild(b); chat.scrollTop = chat.scrollHeight; return b; }
    function abrirAsistente() {
        abrir('#asistente');
        if (!conv.length) burbuja('bot', '¡Hola! Soy el asistente de Rosti. Dígame qué quiere comer y dónde lo recoge, y yo armo el pedido. Por ejemplo: «un medio pollo con papas para recoger en Heredia».');
        setTimeout(function () { $('#chat-input').focus(); }, 50);
    }
    function enviarChat(texto) {
        texto = String(texto || '').trim(); if (!texto) return;
        burbuja('yo', esc(texto)); conv.push({ rol: 'usuario', texto: texto });
        $('#chat-input').value = '';
        var p = burbuja('bot pensando', 'Un momento…');
        var btn = $('#chat-enviar'); btn.disabled = true;
        api('/asistente', { method: 'POST', body: { mensajes: conv.slice(-24), lat: ubic ? ubic.lat : undefined, lng: ubic ? ubic.lng : undefined, local: localSel || undefined } })
            .then(function (d) {
                p.className = 'burbuja bot'; p.innerHTML = esc(d.texto || '').replace(/\b(RP-[A-Z2-9]{5})\b/g, '<span class="codigo">$1</span>');
                conv.push({ rol: 'asistente', texto: d.texto || '' });
                if (d.pedido && d.pedido.codigo) { carrito = []; guardar(); renderCarrito(); }
            })
            .catch(function (e) { p.className = 'burbuja bot'; p.textContent = e.message || 'No pude responder. Pruebe de nuevo.'; })
            .then(function () { btn.disabled = false; chat.scrollTop = chat.scrollHeight; $('#chat-input').focus(); });
    }
    $('#btn-asistente').onclick = abrirAsistente;
    $('#asistente-cerrar').onclick = function () { cerrar('#asistente'); };
    $('#chat-form').addEventListener('submit', function (ev) { ev.preventDefault(); enviarChat($('#chat-input').value); });
    var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    var mic = $('#chat-mic');
    if (!SR) { mic.style.display = 'none'; }
    else {
        var rec = null;
        mic.onclick = function () {
            if (rec) { rec.stop(); return; }
            rec = new SR(); rec.lang = 'es-CR'; rec.interimResults = false; rec.maxAlternatives = 1;
            mic.classList.add('grabando');
            rec.onresult = function (e) { var t = e.results[0][0].transcript; $('#chat-input').value = t; enviarChat(t); };
            rec.onerror = function () { burbuja('bot', 'No le escuché bien. Pruebe de nuevo o escriba el pedido.'); };
            rec.onend = function () { mic.classList.remove('grabando'); rec = null; };
            rec.start();
        };
    }

    // ── Ficha: controles ──────────────────────────────────────────────────────
    $('#ficha-cerrar').onclick = function () { cerrar('#ficha-modal'); };
    $('#ficha-agregar').onclick = agregarDesdeFicha;
    $('#ficha-menos').onclick = function () { if (ficha && ficha.cantidad > 1) { ficha.cantidad--; renderFicha(); } };
    $('#ficha-mas').onclick = function () { if (ficha && ficha.cantidad < 50) { ficha.cantidad++; renderFicha(); } };
    MODALES.forEach(function (s) { if (s === '#carrito') return; $(s).addEventListener('click', function (e) { if (e.target === $(s) && s !== '#conf-modal') cerrar(s); }); });
    document.addEventListener('keydown', function (e) {
        if (e.key !== 'Escape') return;
        if (pila.length) cerrar(pila[pila.length - 1]);
    });

    // En el teléfono el teclado tapa el campo enfocado del checkout: se centra cuando el teclado terminó de subir.
    document.addEventListener('focusin', function (e) {
        if (!e.target.matches || !e.target.matches('.form input, .form textarea')) return;
        setTimeout(function () { try { e.target.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch (x) { /* */ } }, 350);
    });

    // ── Arranque ──────────────────────────────────────────────────────────────
    cargarCuenta();
    renderCarrito();
    cargarCatalogo().then(function () {
        if (catalogo.pagos && !catalogo.pagos.disponible) { var av = $('#aviso-pago'); av.hidden = false; av.textContent = catalogo.pagos.mensaje; }
        return ubicacionPorIp();
    }).catch(function (e) {
        $('#cargando').innerHTML = '<p class="vacio">' + esc(e.message === 'No disponible' ? 'Esta página es privada: abrila con el enlace completo que te dieron.' : (e.message || 'No se pudo cargar el menú.')) + '</p>';
    });
})();

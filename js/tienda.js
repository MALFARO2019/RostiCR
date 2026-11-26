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
    var MODALES = ['#ficha-modal', '#checkout-modal', '#conf-modal', '#locales-modal', '#asistente', '#cuenta-modal', '#reporte-modal', '#carrito'];
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
    // Horario del local elegido (viene del servidor: Horario de Locales). cerradoAhora() bloquea «Ir a pagar»;
    // «soloInforma» = el servidor avisa pero no rechaza (tienda en pruebas), entonces la página tampoco bloquea.
    var horarioSel = function () { var l = localObj(); return (l && l.horario) || null; };
    var cerradoAhora = function () { var h = horarioSel(); return !!(h && h.abierto === false && !h.soloInforma); };
    // Entrega a domicilio: modo del pedido, punto de entrega (GPS o dirección ubicada) y la cotización que guardó el servidor.
    var modo = 'recoger', punto = null, envio = null;
    var entregaDisponible = function () { var l = localObj(); return !!(l && l.entrega); };
    var envioVigente = function () { return !!(envio && envio.local === localSel && new Date(envio.expira).getTime() > Date.now() + 15000); };
    var txtCierre = function (h) { return h.cerradoHoy ? 'Cerrado hoy' : (h.abreALas ? 'Cerrado ahora · abre a las ' + h.abreALas : 'Ya cerró por hoy'); };

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
        var h = horarioSel(), ch = $('#chip-horario'), av = $('#aviso-horario'), cn = $('#carrito-horario');
        var cerr = !!(h && h.abierto === false);
        ch.hidden = !h || h.porConfirmar; ch.className = 'chip ' + (cerr ? 'cerrado' : 'abierto');
        if (h) ch.textContent = cerr ? '🔒 ' + txtCierre(h) : '🟢 Abierto · ' + (h.texto || '');
        av.hidden = !cerr; cn.hidden = !cerr;
        if (cerr) {
            av.innerHTML = '🔒 ' + esc(h.mensaje || 'Este local no está recibiendo pedidos en este momento.') + ' Podés ver el menú y armar tu pedido.<button type="button" id="aviso-horario-cambiar">Elegir otro local</button>';
            $('#aviso-horario-cambiar').onclick = function () { renderLocales(); abrir('#locales-modal'); };
            cn.textContent = (h.mensaje || 'Este local no está recibiendo pedidos en este momento.') + ' Elegí otro local o volvé más tarde.';
        }
        var b = $('#checkout-local');
        b.innerHTML = l ? '<span><strong>Rosti ' + esc(l.nombre) + '</strong><small>' + esc([l.km != null ? l.km + ' km' : null, l.zona].filter(Boolean).join(' · ')) + '</small></span><span class="cambiar">Cambiar</span>' : '<span><strong>Elegí el local</strong></span><span class="cambiar">Elegir</span>';
        $('#local').value = localSel || '';
        pintarEntrega();
    }
    function estadoEntrega(txt, clase) { var e = $('#entrega-estado'); e.textContent = txt || ''; e.className = 'entrega-estado' + (clase ? ' ' + clase : ''); }
    function pintarEntrega() {
        var hay = entregaDisponible();
        if (!hay) modo = 'recoger';
        if (envio && envio.local !== localSel) { envio = null; estadoEntrega(''); }     // el envío se calculó para otro local
        $('#modo-entrega').hidden = !hay; $('#entrega-bloque').hidden = modo !== 'entrega';
        $('#paso1-titulo').textContent = modo === 'entrega' ? '¿Adónde te lo llevamos?' : '¿Dónde lo recogés?';
        Array.prototype.forEach.call(document.querySelectorAll('#modo-entrega button'), function (b) { b.classList.toggle('sel', b.dataset.modo === modo); });
        pintarTotal();
    }
    function pintarTotal() {
        var conEnvio = modo === 'entrega' && envioVigente();
        $('#resumen-envio').hidden = !conEnvio;
        if (conEnvio) $('#resumen-envio-monto').textContent = fmt(envio.costo);
        $('#resumen-total').textContent = fmt(total() + (conEnvio ? envio.costo : 0));
        var b = $('#btn-enviar'); if (b) b.textContent = modo === 'entrega' && !conEnvio ? 'Calculá el envío para continuar' : 'Enviar pedido';
    }
    Array.prototype.forEach.call(document.querySelectorAll('#modo-entrega button'), function (b) { b.onclick = function () { modo = b.dataset.modo; pintarEntrega(); }; });
    $('#entrega-direccion').addEventListener('input', function () { if (punto && punto.fuente === 'texto') punto = null; envio = null; pintarTotal(); });
    $('#entrega-gps').onclick = function () {
        if (!navigator.geolocation) { estadoEntrega('Tu navegador no comparte la ubicación: escribí la dirección y tocá «Calcular envío».', 'error'); return; }
        estadoEntrega('Buscando tu ubicación…');
        navigator.geolocation.getCurrentPosition(function (p) {
            punto = { lat: p.coords.latitude, lng: p.coords.longitude, fuente: 'gps' }; envio = null;
            estadoEntrega('Listo: te lo llevamos donde estás ahora. Escribí las señas y tocá «Calcular envío».', 'ok'); pintarTotal();
        }, function () { estadoEntrega('No pudimos leer tu ubicación. Escribí la dirección con barrio y distrito.', 'error'); }, { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 });
    };
    function cotizarEnvio() {
        var dir = $('#entrega-direccion').value.trim(), senas = $('#entrega-senas').value.trim();
        if (dir.length < 8) { estadoEntrega('Escribí la dirección con barrio, distrito y cómo llegar.', 'error'); return Promise.resolve(null); }
        estadoEntrega('Calculando el envío…'); envio = null; pintarTotal();
        var ubicar = punto ? Promise.resolve(punto) : api('/entrega/ubicar?q=' + encodeURIComponent(dir.slice(0, 120))).then(function (d) {
            if (!d.ubicacion) { var e = new Error('No pudimos ubicar esa dirección. Tocá «Usar mi ubicación actual» si estás ahí, o agregá el barrio y el distrito.'); e.sinPunto = true; throw e; }
            punto = { lat: d.ubicacion.lat, lng: d.ubicacion.lng, fuente: 'texto', lugar: d.ubicacion.lugar }; return punto;
        });
        return ubicar.then(function (p) {
            return api('/entrega/cotizar', { method: 'POST', body: { codAlmacen: localSel, direccion: dir, notas: senas || undefined, lat: p.lat, lng: p.lng, subtotal: total() } });
        }).then(function (d) {
            envio = d.cotizacion; envio.local = localSel;
            estadoEntrega('Envío ' + fmt(envio.costo) + (envio.minutos ? ' · llega en unos ' + envio.minutos + ' min después de pagar' : '') + (punto && punto.fuente === 'texto' && punto.lugar ? ' · ubicado cerca de ' + String(punto.lugar).split(',').slice(0, 2).join(',') : ''), 'ok');
            pintarTotal(); return envio;
        }).catch(function (e) {
            if (e.datos && e.datos.codigo === 'local_cerrado') { var l = localObj(); if (l && e.datos.horario) l.horario = e.datos.horario; }
            estadoEntrega(e.message || 'No pudimos calcular el envío.', 'error'); pintarTotal(); return null;
        });
    }
    $('#entrega-cotizar').onclick = cotizarEnvio;
    function renderLocales() {
        var lista = $('#locales-lista'); lista.innerHTML = '';
        var q = ($('#locales-buscar').value || '').trim().toLowerCase();
        var hayKm = locales.some(function (x) { return x.km != null; });
        lista.appendChild(el('p', 'locales-hint', hayKm ? 'Del más cercano al más lejano. Podés elegir cualquiera.' : 'Todos los locales. Usá tu ubicación para ver los más cercanos.'));
        locales.filter(function (x) { return !q || (x.nombre + ' ' + (x.zona || '')).toLowerCase().indexOf(q) >= 0; }).forEach(function (x) {
            var it = el('button', 'local-item' + (x.codigo === localSel ? ' sel' : ''));
            it.type = 'button';
            it.innerHTML = '<span class="li-ico">📍</span><span class="li-txt"><strong>' + esc(x.nombre) + '</strong><small>' + esc(x.zona || '') + '</small>' + (x.horario && x.horario.abierto === false ? '<small class="li-hor c">' + esc(txtCierre(x.horario)) + '</small>' : (x.horario && !x.horario.porConfirmar ? '<small class="li-hor">Abierto · ' + esc(x.horario.texto || '') + '</small>' : '')) + '</span>' + (x.km != null && x.km < 300 ? '<span class="li-km">' + x.km + ' km</span>' : '');
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
            if (!locales.length && d.locales) { locales = d.locales; }
            // El estado de este momento del local elegido viene con su menú.
            var lh = localObj(); if (lh && d.horario) lh.horario = d.horario;
            renderLocal();
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
                // Miniatura de la opción (artículo con foto en ICG o en UberEats), como en las apps de delivery.
                var txt = (o.imagenUrl ? '<img class="op-foto" loading="lazy" decoding="async" alt="" src="' + esc(o.imagenUrl) + '" onerror="this.remove()">' : '') + '<div class="op-txt"><span class="op-nombre">' + esc(o.nombre) + '</span>' + precio + '</div>';
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
        $('#carrito-n').textContent = n; $('#carrito-total').textContent = t; pintarTotal();
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
    $('#btn-pedir').onclick = function () {
        // Con el local cerrado no se pasa a pagar: se ofrece elegir otro (el pedido armado se conserva).
        if (cerradoAhora()) { toast((horarioSel().mensaje || 'Este local está cerrado ahora.') + ' Elegí otro local.'); renderLocales(); cambiar('#carrito', '#locales-modal'); return; }
        renderLocal(); renderCuenta(); $('#form-msg').textContent = ''; cambiar('#carrito', '#checkout-modal');
    };
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
        // Factura electrónica a su nombre: cédula de 9 a 12 dígitos y el correo adonde llega.
        var ced = f.cedula.value.replace(/\D/g, '');
        if (ced && (ced.length < 9 || ced.length > 12)) { msg.textContent = 'Para la factura electrónica, la cédula debe tener entre 9 y 12 dígitos, sin guiones.'; msg.className = 'form-msg error'; f.cedula.focus(); return; }
        if (ced && !f.email.value.trim()) { msg.textContent = 'Para la factura electrónica necesitamos tu correo: ahí te llega.'; msg.className = 'form-msg error'; f.email.focus(); return; }
        var aDomicilio = modo === 'entrega' && entregaDisponible();
        if (aDomicilio && !envioVigente()) { msg.textContent = envio ? 'El precio del envío venció: tocá «Calcular envío» otra vez.' : 'Falta calcular el envío: escribí la dirección y tocá «Calcular envío».'; msg.className = 'form-msg error'; envio = null; pintarTotal(); return; }
        var btn = $('#btn-enviar'); btn.disabled = true; btn.textContent = 'Enviando…';
        api('/pedidos', { method: 'POST', body: {
            codAlmacen: localSel, modalidad: aDomicilio ? 'entrega' : 'recoger', cotizacionEntrega: aDomicilio ? envio.id : undefined, origen: 'rosti.cr',
            cliente: { nombre: nombre, telefono: tel, email: f.email.value.trim() || undefined, cedula: f.cedula.value.trim() || undefined },
            notas: f.notas.value.trim() || undefined, claveIdempotencia: 'web-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8),
            lineas: carrito.map(function (i) { return { codigo: i.codigo, cantidad: i.cantidad, notas: i.nota || undefined, modificadores: i.mods.map(function (m) { return { grupo: m.grupo, codigo: m.codigo, padreGrupo: m.padreGrupo, padreCodigo: m.padreCodigo }; }) }; })
        } }).then(function (d) {
            carrito = []; guardar(); renderCarrito();
            $('#conf-codigo').textContent = d.pedido.codigo;
            $('#conf-total').textContent = fmt(d.pedido.total);
            $('#conf-local').textContent = (d.pedido.modalidad === 'entrega' ? 'A domicilio desde Rosti ' : 'Rosti ') + (d.pedido.local || localSel);
            envio = null; punto = null; modo = 'recoger'; estadoEntrega(''); pintarEntrega();
            $('#conf-msg').textContent = (d.pago && d.pago.mensaje) || '';
            pasos('pendiente_pago');
            cambiar('#checkout-modal', '#conf-modal');
            seguirPedido(d.pedido.codigo);
        }).catch(function (e) {
            msg.textContent = e.message || 'No se pudo enviar el pedido. Probá de nuevo.'; msg.className = 'form-msg error';
            // El local cerró mientras armaba el pedido: se actualiza el aviso y puede cambiar de local sin perder el carrito.
            if (e.datos && /^entrega_/.test(e.datos.codigo || '')) { envio = null; estadoEntrega(e.message, 'error'); pintarTotal(); }
            if (e.datos && e.datos.codigo === 'local_cerrado') { var l = localObj(); if (l && e.datos.horario) l.horario = e.datos.horario; renderLocal(); msg.textContent += ' Tocá el local de arriba para elegir otro.'; }
        })
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
                // A domicilio: en qué va el repartidor y el enlace para seguirlo en el mapa.
                var ce = $('#conf-entrega'), en = p.modalidad === 'entrega' ? (p.entrega || {}) : null;
                ce.hidden = !(en && en.estado && p.estado !== 'pendiente_pago');
                if (!ce.hidden) ce.innerHTML = '🛵 ' + esc(en.estadoNombre || en.estado) + (en.repartidor ? ' · ' + esc(en.repartidor) : '') + (en.tracking ? ' · <a href="' + esc(en.tracking) + '" target="_blank" rel="noopener">Seguir en el mapa</a>' : '');
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
    // Un identificador por pestaña: el servidor guarda ahí el pedido en curso de FlamIA (el MCP lleva la sesión).
    var chatSig = '';
    var chatSesion = ''; try { chatSesion = sessionStorage.getItem('rosti.chat.sesion') || ''; } catch (e) { chatSesion = ''; }
    function chatId() { try { var v = sessionStorage.getItem('rosti.chat.id'); if (!v) { v = 'w' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10); sessionStorage.setItem('rosti.chat.id', v); } return v; } catch (e) { return 'w' + Math.random().toString(36).slice(2, 12); } }
    // Texto del chat → HTML seguro: se escapa todo y sólo se permiten **negrita**, el código del pedido y enlaces [texto](https://rosti.cr/…) de Rosti.
    function formatoChat(t) {
        t = String(t || '');
        var fmt = function (x) { return esc(x).replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>').replace(/\b(RP-[A-Z2-9]{5})\b/g, '<span class="codigo">$1</span>'); };
        var re = /\[([^\]\n]{1,60})\]\((https:\/\/(?:rosti\.cr|kpisrosti\.com)\/[^\s)]+)\)/g, html = '', ult = 0, m;
        while ((m = re.exec(t))) { html += fmt(t.slice(ult, m.index)) + '<a href="' + esc(m[2]) + '">' + esc(m[1]) + '</a>'; ult = m.index + m[0].length; }
        return html + fmt(t.slice(ult));
    }
    function burbuja(cls, html) { var b = el('div', 'burbuja ' + cls, html); chat.appendChild(b); chat.scrollTop = chat.scrollHeight; return b; }
    function abrirAsistente() {
        abrir('#asistente');
        if (!conv.length) burbuja('bot', '¡Hola! Soy FlamIA, la asistente de Rosti. Dígame qué quiere comer y dónde lo recoge, y yo armo el pedido. Por ejemplo: «un medio pollo con papas para recoger en Heredia».');
        setTimeout(function () { $('#chat-input').focus(); }, 50);
    }
    function enviarChat(texto) {
        texto = String(texto || '').trim(); if (!texto) return;
        burbuja('yo', esc(texto)); conv.push({ rol: 'usuario', texto: texto });
        $('#chat-input').value = '';
        var p = burbuja('bot pensando', 'Un momento…');
        var btn = $('#chat-enviar'); btn.disabled = true;
        api('/asistente', { method: 'POST', body: { mensajes: conv.slice(-24), chatId: chatId(), sesion: chatSesion || undefined, sig: chatSig || undefined, lat: ubic ? ubic.lat : undefined, lng: ubic ? ubic.lng : undefined, local: localSel || undefined } })
            .then(function (d) {
                p.className = 'burbuja bot'; p.innerHTML = formatoChat(d.texto || ''); if (d.sig !== undefined) chatSig = d.sig || ''; if (d.sesion) { chatSesion = d.sesion; try { sessionStorage.setItem('rosti.chat.sesion', d.sesion); } catch (e) { /* */ } }
                if (d.pedido && d.pedido.link && /^https:\/\/(rosti\.cr|kpisrosti\.com)\//.test(d.pedido.link)) { var a = el('a', 'btn-pagar'); a.href = d.pedido.link; a.textContent = 'Pagar con tarjeta'; p.appendChild(a); }
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

    // ── Enlaces directos: los usan el sitio, las IAs y WhatsApp ───────────────
    //   /pedir?local=S08         abre con ese local ya elegido
    //   /pedir?producto=847      abre la ficha de ese plato
    //   /pedir?q=<texto>         abre el asistente y le pasa lo que la persona ya dijo («2 platos surtidos para recoger en Heredia»)
    //   /pedir?ayuda=1           abre el asistente      ·      /pedir?cuenta=1   abre «Entrar»
    function enlaceDirecto() {
        var P; try { P = new URLSearchParams(location.search); } catch (e) { return; }
        var pl = String(P.get('local') || '').trim().toUpperCase(), pp = Number(P.get('producto')) || 0;
        var q = String(P.get('q') || '').trim().slice(0, 300), ayuda = P.get('ayuda'), cta = P.get('cuenta');
        if (!pl && !pp && !q && !ayuda && !cta) return;
        try { history.replaceState(null, '', location.pathname); } catch (e) { /* */ }
        var paso = Promise.resolve();
        if (pl && pl !== localSel && locales.some(function (l) { return l.codigo === pl; })) {
            localSel = pl; ls('rosti.local', pl); renderLocal(); renderLocales(); cerrar('#locales-modal');
            paso = cargarCatalogo();
        }
        return paso.then(function () {
            if (pp) {
                var art = null;
                ((catalogo && catalogo.familias) || []).forEach(function (f) { (f.articulos || []).forEach(function (x) { if (Number(x.codigo) === pp) art = x; }); });
                if (art) abrirFicha(art);
            } else if (q) { abrirAsistente(); enviarChat(q); }
            else if (ayuda) abrirAsistente();
            else if (cta && !cuenta) abrirCuenta();
        });
    }

    // ── Contenido editable: banner o carrusel, textos y aviso (Pedidos Externos › Contenido) ─────────────────────────────────────────
    // Todo es OPCIONAL: sin contenido publicado la página se ve como de fábrica. Los textos entran con textContent (nunca como HTML).
    var vistaBorrador = false;
    try { vistaBorrador = new URLSearchParams(location.search).get('contenido') === 'borrador'; } catch (e) { vistaBorrador = false; }
    var carruselT = null;
    function pintarBanners(c) {
        var host = $('#hero-img'), banners = (c.banners || []).filter(function (b) { return b && b.imagen; });
        clearInterval(carruselT);
        var viejo = host.querySelector('.hero-slides'); if (viejo) viejo.remove();
        if (!banners.length) return;
        var movil = window.matchMedia && window.matchMedia('(max-width: 640px)').matches;
        var caja = el('div', 'hero-slides'), slides = [], puntos = el('div', 'hero-puntos'), actual = 0;
        banners.forEach(function (b) {
            var img = (movil && b.imagenMovil) ? b.imagenMovil : b.imagen;
            var s = b.enlace ? el('a', 'hero-slide') : el('div', 'hero-slide');
            if (b.enlace) s.href = b.enlace;
            s.style.backgroundImage = 'url("' + String(img).replace(/"/g, '%22') + '")';
            if (b.titulo || b.texto || b.boton) {
                var t = el('div', 'hs-txt');
                if (b.titulo) { var h = el('h2'); h.textContent = b.titulo; t.appendChild(h); }
                if (b.texto) { var p = el('p'); p.textContent = b.texto; t.appendChild(p); }
                if (b.boton && b.enlace) { var bt = el('span', 'hs-btn'); bt.textContent = b.boton; t.appendChild(bt); }
                s.appendChild(t);
            }
            caja.appendChild(s); slides.push(s);
            var im = new Image(); im.onerror = function () { s.remove(); slides = slides.filter(function (x) { return x !== s; }); if (!slides.length) caja.remove(); }; im.src = img;
        });
        host.appendChild(caja);
        var mostrar = function (i) {
            if (!slides.length) return;
            actual = (i + slides.length) % slides.length;
            slides.forEach(function (s, k) { s.classList.toggle('activa', k === actual); });
            Array.prototype.forEach.call(puntos.children, function (d, k) { d.classList.toggle('activo', k === actual); });
        };
        var arrancar = function () {
            clearInterval(carruselT);
            if (banners.length > 1) carruselT = setInterval(function () { if (!document.hidden) mostrar(actual + 1); }, Math.max(3, Number(c.carruselSegundos) || 6) * 1000);
        };
        if (banners.length > 1) {
            banners.forEach(function (_b, k) { var d = el('button'); d.type = 'button'; d.setAttribute('aria-label', 'Imagen ' + (k + 1)); d.onclick = function () { mostrar(k); arrancar(); }; puntos.appendChild(d); });
            caja.appendChild(puntos);
        }
        mostrar(0); arrancar();
    }
    function aplicarContenido(c) {
        if (!c) return;
        var t = c.textos || {};
        if (t.lema) $('#chip-lema').textContent = t.lema;
        if (t.asistenteTitulo) $('#asist-titulo').textContent = t.asistenteTitulo;
        if (t.asistenteSub) $('#asist-sub').textContent = t.asistenteSub;
        var av = $('#aviso-general');
        if (c.aviso && c.aviso.texto) {
            var clave = 'rosti.aviso.' + c.aviso.texto.length + '.' + c.aviso.texto.slice(0, 24), cerrado = false;
            try { cerrado = sessionStorage.getItem(clave) === '1'; } catch (e) { cerrado = false; }
            if (!cerrado || c.borrador) {
                $('#aviso-general-txt').textContent = c.aviso.texto; av.className = 'aviso-general ' + (c.aviso.tipo || 'info'); av.hidden = false;
                $('#aviso-general-x').onclick = function () { av.hidden = true; try { sessionStorage.setItem(clave, '1'); } catch (e) { /* */ } };
            }
        } else av.hidden = true;
        pintarBanners(c);
        if (c.borrador && !$('.vista-previa-borrador')) { var v = el('div', 'vista-previa-borrador'); v.textContent = 'Vista previa del BORRADOR (no es lo publicado)'; document.body.appendChild(v); }
    }
    function cargarContenido() {
        return api('/contenido' + (vistaBorrador ? '?borrador=1' : '')).then(aplicarContenido).catch(function () { /* sin contenido: queda como de fábrica */ });
    }

    // ── Tienda de PRUEBAS: botón de salvavidas para reportar qué modificar (crea un caso de soporte) ────────────────────────────
    // Igual que el botón de soporte de KPIs: toma una FOTO de lo que se ve (dom-to-image-more, del DOM: no sale la barra del navegador ni los menús
    // nativos), deja MARCARLA (lápiz, círculo, flecha), aceptar imágenes PEGADAS (Ctrl+V) o adjuntadas, y manda el texto con el local y el carrito.
    // Sólo aparece con la clave privada y mientras el servidor dice que la tienda sigue privada (GET /modo); al abrirla al público desaparece.
    var MAX_CAPS = 3, MAX_BYTES_CAP = 2.2 * 1024 * 1024;
    var caps = [];            // [{ dataUrl }]  PNG ya reducido; las marcas se «queman» al cambiar de captura o al enviar
    var capActiva = -1, trazos = [], trazoEnCurso = null, herr = 'lapiz', colorMarca = '#ef4444', imgBase = null;
    var PNG_VACIO = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

    function cargarCapturador() {
        if (window.domtoimage) return Promise.resolve(window.domtoimage);
        return new Promise(function (ok, mal) {
            var s = document.createElement('script'); s.src = 'js/vendor/dom-to-image-more.min.js?v=1';
            s.onload = function () { window.domtoimage ? ok(window.domtoimage) : mal(new Error('sin capturador')); };
            s.onerror = function () { mal(new Error('no se pudo cargar el capturador')); };
            document.head.appendChild(s);
        });
    }
    /** Cualquier imagen (data URL o Blob) → PNG que cabe en el servidor (lado mayor 1600 px y menos de 2,2 MB; se achica hasta que entre). */
    function aPng(origen) {
        return new Promise(function (ok, mal) {
            var url = typeof origen === 'string' ? origen : URL.createObjectURL(origen), im = new Image();
            im.onload = function () {
                var lado = 1600;
                for (var i = 0; i < 5; i++) {
                    var k = Math.min(1, lado / Math.max(im.naturalWidth, im.naturalHeight)), c = document.createElement('canvas');
                    c.width = Math.max(1, Math.round(im.naturalWidth * k)); c.height = Math.max(1, Math.round(im.naturalHeight * k));
                    var g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.drawImage(im, 0, 0, c.width, c.height);
                    var d = c.toDataURL('image/png');
                    if (d.length * 0.75 <= MAX_BYTES_CAP) { if (typeof origen !== 'string') URL.revokeObjectURL(url); return ok(d); }
                    lado = Math.round(lado * 0.7);
                }
                mal(new Error('La imagen es demasiado grande'));
            };
            im.onerror = function () { mal(new Error('No se pudo leer la imagen')); };
            im.src = url;
        });
    }
    /** La foto de lo que se ve AHORA (se toma antes de abrir el formulario, para que el formulario no salga en ella). */
    function capturarPantalla() {
        return cargarCapturador().then(function (d) {
            var vw = Math.max(1, window.innerWidth), vh = Math.max(1, window.innerHeight), sx = window.scrollX || 0, sy = window.scrollY || 0;
            var escala = vw < 900 ? Math.min(2, Math.max(1, window.devicePixelRatio || 1)) : 1;
            return d.toPng(document.documentElement, {
                bgcolor: '#ffffff', width: vw, height: vh, scale: escala, imagePlaceholder: PNG_VACIO, cacheBust: false,
                style: { transform: 'translate(' + (-sx) + 'px, ' + (-sy) + 'px)', transformOrigin: 'top left' },
                filter: function (n) {
                    if (!n || n.nodeType !== 1) return true;
                    var t = n.tagName; if (t === 'SCRIPT' || t === 'NOSCRIPT' || t === 'IFRAME' || t === 'VIDEO') return false;
                    return !(n.id === 'reporte-modal' || n.id === 'toast' || (n.classList && n.classList.contains('vista-previa-borrador')));
                }
            });
        }).then(aPng);
    }

    // ── Lienzo de marcas ──
    function pintarLienzo() {
        var cv = $('#rep-canvas'); if (!imgBase) return;
        if (cv.width !== imgBase.naturalWidth || cv.height !== imgBase.naturalHeight) { cv.width = imgBase.naturalWidth; cv.height = imgBase.naturalHeight; }
        var g = cv.getContext('2d'); g.clearRect(0, 0, cv.width, cv.height); g.drawImage(imgBase, 0, 0);
        var grosor = Math.max(3, Math.round(cv.width / 260));
        (trazoEnCurso ? trazos.concat([trazoEnCurso]) : trazos).forEach(function (t) {
            g.strokeStyle = t.color; g.fillStyle = t.color; g.lineWidth = grosor; g.lineCap = 'round'; g.lineJoin = 'round'; g.beginPath();
            if (t.tipo === 'lapiz') { t.puntos.forEach(function (p, i) { i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y); }); if (t.puntos.length === 1) g.lineTo(t.puntos[0].x + .1, t.puntos[0].y); g.stroke(); }
            else if (t.tipo === 'circulo') { g.ellipse((t.a.x + t.b.x) / 2, (t.a.y + t.b.y) / 2, Math.abs(t.b.x - t.a.x) / 2 || 1, Math.abs(t.b.y - t.a.y) / 2 || 1, 0, 0, Math.PI * 2); g.stroke(); }
            else {
                var ang = Math.atan2(t.b.y - t.a.y, t.b.x - t.a.x), L = grosor * 5;
                g.moveTo(t.a.x, t.a.y); g.lineTo(t.b.x, t.b.y); g.stroke(); g.beginPath();
                g.moveTo(t.b.x, t.b.y); g.lineTo(t.b.x - L * Math.cos(ang - Math.PI / 6), t.b.y - L * Math.sin(ang - Math.PI / 6));
                g.lineTo(t.b.x - L * Math.cos(ang + Math.PI / 6), t.b.y - L * Math.sin(ang + Math.PI / 6)); g.closePath(); g.fill();
            }
        });
    }
    /** Quema las marcas en el PNG de la captura activa. */
    function aplanar() {
        if (capActiva < 0 || !trazos.length) return;
        try { caps[capActiva].dataUrl = $('#rep-canvas').toDataURL('image/png'); } catch (e) { /* queda sin marcas */ }
        trazos = [];
    }
    function activarCaptura(i) {
        aplanar(); capActiva = i; trazos = []; trazoEnCurso = null; imgBase = null;
        if (i < 0 || !caps[i]) { pintarMiniaturas(); return; }
        var im = new Image(); im.onload = function () { imgBase = im; pintarLienzo(); }; im.src = caps[i].dataUrl; pintarMiniaturas();
    }
    function pintarMiniaturas() {
        var ed = $('#reporte-editor'), box = $('#rep-minis'); box.innerHTML = '';
        ed.hidden = !caps.length;
        caps.forEach(function (c, i) {
            var b = el('button', 'rep-mini' + (i === capActiva ? ' activa' : '')); b.type = 'button'; b.setAttribute('aria-label', 'Captura ' + (i + 1));
            var im = el('img'); im.src = c.dataUrl; im.alt = ''; b.appendChild(im);
            var x = el('span', 'rep-mini-x', '×'); x.title = 'Quitar'; x.onclick = function (e) { e.stopPropagation(); caps.splice(i, 1); trazos = []; capActiva = -1; activarCaptura(Math.min(i, caps.length - 1)); };
            b.appendChild(x); b.onclick = function () { if (i !== capActiva) activarCaptura(i); }; box.appendChild(b);
        });
        $('#rep-otra').disabled = caps.length >= MAX_CAPS; $('#rep-adjuntar-lbl').classList.toggle('apagado', caps.length >= MAX_CAPS);
    }
    function agregarImagen(origen) {
        if (caps.length >= MAX_CAPS) { $('#reporte-msg').textContent = 'Máximo ' + MAX_CAPS + ' imágenes por reporte.'; return Promise.resolve(); }
        return aPng(origen).then(function (d) { aplanar(); caps.push({ dataUrl: d }); activarCaptura(caps.length - 1); $('#reporte-msg').textContent = ''; })
            .catch(function (e) { $('#reporte-msg').textContent = e.message || 'No se pudo usar esa imagen.'; });
    }
    function xy(e) { var cv = $('#rep-canvas'), r = cv.getBoundingClientRect(); return { x: (e.clientX - r.left) * (cv.width / Math.max(1, r.width)), y: (e.clientY - r.top) * (cv.height / Math.max(1, r.height)) }; }

    function abrirReporte() {
        var msg = $('#reporte-msg'); msg.textContent = '📷 Tomando la foto de la pantalla…';
        var n = ls('rosti.reporte.nombre'); if (n && !$('#reporte-form').nombre.value) $('#reporte-form').nombre.value = n;
        $('#reporte-form').hidden = false;
        var tomada = caps.length >= MAX_CAPS ? Promise.resolve() : capturarPantalla().then(function (d) { aplanar(); caps.push({ dataUrl: d }); }).catch(function () { return null; });
        return tomada.then(function () {
            abrir('#reporte-modal'); activarCaptura(caps.length ? caps.length - 1 : -1);
            msg.textContent = caps.length ? '' : 'No se pudo tomar la foto de la pantalla: puede pegar una imagen (Ctrl+V) o adjuntarla.';
        });
    }
    function iniciarReporte() {
        if (!ACCESO) return;
        api('/modo').then(function (d) { if (d && d.privada) $('#btn-reporte').hidden = false; }).catch(function () { /* */ });
        $('#btn-reporte').onclick = function () { $('#btn-reporte').disabled = true; abrirReporte().then(function () { $('#btn-reporte').disabled = false; }); };
        $('#reporte-cerrar').onclick = function () { cerrar('#reporte-modal'); };
        // Marcas
        var cv = $('#rep-canvas');
        cv.addEventListener('pointerdown', function (e) {
            if (!imgBase) return; e.preventDefault(); try { cv.setPointerCapture(e.pointerId); } catch (x) { /* */ }
            var p = xy(e); trazoEnCurso = herr === 'lapiz' ? { tipo: 'lapiz', color: colorMarca, puntos: [p] } : { tipo: herr, color: colorMarca, a: p, b: p }; pintarLienzo();
        });
        cv.addEventListener('pointermove', function (e) {
            if (!trazoEnCurso) return; e.preventDefault(); var p = xy(e);
            if (trazoEnCurso.tipo === 'lapiz') trazoEnCurso.puntos.push(p); else trazoEnCurso.b = p; pintarLienzo();
        });
        var fin = function (e) {
            if (!trazoEnCurso) return; e.preventDefault(); var t = trazoEnCurso; trazoEnCurso = null;
            var vale = t.tipo === 'lapiz' ? t.puntos.length >= 1 : Math.hypot(t.b.x - t.a.x, t.b.y - t.a.y) >= 6;
            if (vale) trazos.push(t); pintarLienzo();
        };
        cv.addEventListener('pointerup', fin); cv.addEventListener('pointercancel', fin);
        Array.prototype.forEach.call(document.querySelectorAll('[data-herr]'), function (b) {
            b.onclick = function () { herr = b.getAttribute('data-herr'); Array.prototype.forEach.call(document.querySelectorAll('[data-herr]'), function (x) { x.classList.toggle('activa', x === b); }); };
        });
        Array.prototype.forEach.call(document.querySelectorAll('[data-color]'), function (b) {
            b.style.background = b.getAttribute('data-color');
            b.onclick = function () { colorMarca = b.getAttribute('data-color'); Array.prototype.forEach.call(document.querySelectorAll('[data-color]'), function (x) { x.classList.toggle('activa', x === b); }); };
        });
        $('#rep-deshacer').onclick = function () { trazos.pop(); pintarLienzo(); };
        $('#rep-limpiar').onclick = function () { trazos = []; pintarLienzo(); };
        // Otra captura / pegar / adjuntar
        $('#rep-otra').onclick = function () {
            aplanar(); cerrar('#reporte-modal');
            setTimeout(function () { capturarPantalla().then(function (d) { caps.push({ dataUrl: d }); }).catch(function () { /* */ }).then(function () { abrir('#reporte-modal'); activarCaptura(caps.length - 1); }); }, 450);
        };
        $('#rep-adjuntar').onchange = function (e) { var f = e.target.files && e.target.files[0]; if (f) agregarImagen(f); e.target.value = ''; };
        document.addEventListener('paste', function (e) {
            if ($('#reporte-modal').hidden) return;
            var items = (e.clipboardData && e.clipboardData.items) || [];
            for (var i = 0; i < items.length; i++) if (items[i].type && items[i].type.indexOf('image/') === 0) { var f = items[i].getAsFile(); if (f) { e.preventDefault(); agregarImagen(f); } return; }
        });
        $('#reporte-form').onsubmit = function (ev) {
            ev.preventDefault();
            var f = ev.target, btn = f.querySelector('button[type=submit]'), msg = $('#reporte-msg');
            if (!f.mensaje.value.trim() && !caps.length) { msg.textContent = 'Cuéntenos qué hay que modificar o deje una captura.'; return; }
            aplanar();
            var l = localObj(), resumen = carrito.map(function (i) { return i.cantidad + '× ' + i.nombre; }).join(', ');
            btn.disabled = true; msg.textContent = 'Enviando…';
            ls('rosti.reporte.nombre', f.nombre.value.trim());
            api('/reporte', { method: 'POST', body: { nombre: f.nombre.value, mensaje: f.mensaje.value, capturas: caps.map(function (c) { return { dataUrl: c.dataUrl }; }), contexto: {
                local: l ? (l.nombre + ' (' + l.codigo + ')') : (localSel || ''), carrito: resumen, url: location.origin + location.pathname, version: 'tienda.js?v=24',
                dispositivo: (navigator.userAgent || '').slice(0, 280), pantalla: window.innerWidth + 'x' + window.innerHeight } } })
                .then(function (d) { f.mensaje.value = ''; caps = []; capActiva = -1; trazos = []; imgBase = null; pintarMiniaturas(); f.hidden = true; msg.textContent = '✅ Listo: quedó como el caso #' + d.caso + '. Gracias.'; })
                .catch(function (e) { msg.textContent = e.message || 'No se pudo enviar. Intente de nuevo.'; })
                .then(function () { btn.disabled = false; });
        };
    }

    // ── Arranque ──────────────────────────────────────────────────────────────
    cargarCuenta();
    cargarContenido(); iniciarReporte();
    renderCarrito();
    cargarCatalogo().then(function () {
        if (catalogo.pagos && !catalogo.pagos.disponible) { var av = $('#aviso-pago'); av.hidden = false; av.textContent = catalogo.pagos.mensaje; }
        return ubicacionPorIp();
    }).then(enlaceDirecto).catch(function (e) {
        $('#cargando').innerHTML = '<p class="vacio">' + esc(e.message === 'No disponible' ? 'Esta página es privada: abrila con el enlace completo que te dieron.' : (e.message || 'No se pudo cargar el menú.')) + '</p>';
    });
})();

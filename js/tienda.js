/* Tienda Rosti — página oculta mientras está en pruebas. Experiencia tipo Justo / UberEats:
 *  1. Ubicación: pide la del navegador (precisa, con permiso); si no, la aproxima por IP
 *     (ciudad). Con eso ordena los locales por cercanía y propone el más cercano.
 *  2. Menú por familias (pestañas pegajosas), tarjetas con foto y precio.
 *  3. Al tocar un artículo con modificadores se abre la ficha: grupos obligatorios u
 *     opcionales, una o varias opciones, con precio por opción; cantidad y nota.
 *  4. Carrito lateral con las opciones elegidas; checkout con autocompletado por teléfono
 *     o cédula (clientes que ya pidieron o están en el POS); cédula opcional para factura.
 * Habla con el API por el mismo origen (nginx: /api/tienda/ → KPIs Rosti). Mientras la
 * tienda es privada, la clave viaja en el fragmento de la URL (#clave) y se recuerda en la
 * pestaña. La tienda manda CÓDIGOS (artículo y opciones); los precios los pone el servidor.
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
    function api(path, opts) {
        opts = opts || {};
        var headers = { 'Content-Type': 'application/json' };
        if (ACCESO) headers['X-Tienda-Acceso'] = ACCESO;
        return fetch(API + path, { method: opts.method || 'GET', headers: headers, body: opts.body ? JSON.stringify(opts.body) : undefined })
            .then(function (r) { return r.json().catch(function () { return {}; }).then(function (d) { if (!r.ok) throw new Error(d.error || ('Error ' + r.status)); return d; }); });
    }

    // ── Estado ────────────────────────────────────────────────────────────────
    var catalogo = null;            // { familias, locales, pagos }
    var locales = [];               // con km si hay ubicación
    var localSel = null;            // código del local elegido
    var ubic = null;                // { lat, lng, precision: 'gps'|'ciudad' }
    var carrito = [];               // [{ key, codigo, nombre, precio, cantidad, mods:[{grupo,grupoNombre,codigo,nombre,precio}], nota }]
    try { carrito = JSON.parse(localStorage.getItem('rosti.carrito.v2') || '[]') || []; } catch (e) { carrito = []; }
    try { localSel = localStorage.getItem('rosti.local') || null; } catch (e) { /* */ }
    var guardar = function () { try { localStorage.setItem('rosti.carrito.v2', JSON.stringify(carrito)); } catch (e) { /* */ } };
    var unit = function (i) { return i.precio + i.mods.reduce(function (s, m) { return s + (m.precio || 0); }, 0); };
    var total = function () { return carrito.reduce(function (s, i) { return s + unit(i) * i.cantidad; }, 0); };
    var unidades = function () { return carrito.reduce(function (s, i) { return s + i.cantidad; }, 0); };

    // ── Ubicación y locales ───────────────────────────────────────────────────
    function cargarLocales(lat, lng) {
        var q = (lat != null && lng != null) ? ('?lat=' + lat + '&lng=' + lng) : '';
        return api('/locales' + q).then(function (d) { locales = d.locales || []; renderLocal(); });
    }
    function pedirGps() {
        if (!navigator.geolocation) return;
        $('#ubic-estado').textContent = 'Buscando tu ubicación…';
        navigator.geolocation.getCurrentPosition(function (p) {
            ubic = { lat: p.coords.latitude, lng: p.coords.longitude, precision: 'gps' };
            cargarLocales(ubic.lat, ubic.lng).then(function () {
                if (!localSel && locales.length && locales[0].km != null) elegirLocal(locales[0].codigo);
                $('#ubic-estado').textContent = 'Locales ordenados por tu ubicación';
            });
        }, function () { $('#ubic-estado').textContent = 'Sin permiso de ubicación: elegí el local a mano.'; if (!localSel) abrirLocales(); }, { enableHighAccuracy: true, timeout: 8000, maximumAge: 300000 });
    }
    function ubicacionPorIp() {
        return api('/ubicacion').then(function (d) {
            if (d.ubicacion) {
                ubic = { lat: d.ubicacion.lat, lng: d.ubicacion.lng, precision: 'ciudad', ciudad: d.ubicacion.ciudad };
                $('#ubic-estado').textContent = 'Te ubicamos cerca de ' + (d.ubicacion.ciudad || 'tu zona') + '. Para afinar, usá «Mi ubicación».';
                return cargarLocales(ubic.lat, ubic.lng).then(function () { if (!localSel) abrirLocales(); });
            }
            $('#ubic-estado').textContent = 'No pudimos ubicarte: elegí el local donde vas a recoger.';
            return cargarLocales().then(function () { if (!localSel) abrirLocales(); });
        }).catch(function () { return cargarLocales(); });
    }
    function elegirLocal(codigo) {
        localSel = codigo; try { localStorage.setItem('rosti.local', codigo); } catch (e) { /* */ }
        renderLocal(); cerrarLocales();
    }
    function renderLocal() {
        var l = locales.filter(function (x) { return x.codigo === localSel; })[0];
        $('#local-nombre').textContent = l ? l.nombre : 'Elegí tu local';
        $('#local-detalle').textContent = l ? ((l.km != null ? l.km + ' km · ' : '') + (l.zona || '')) : 'Recoger en el local';
        var lista = $('#locales-lista'); lista.innerHTML = '';
        var hayKm = locales.some(function (x) { return x.km != null; });
        lista.appendChild(el('p', 'locales-hint', hayKm ? 'Ordenados del más cercano al más lejano. Podés elegir cualquiera.' : 'Todos los locales, en orden alfabético. Tocá «Usar mi ubicación» para ver los más cercanos.'));
        locales.forEach(function (x) {
            var it = el('button', 'local-item' + (x.codigo === localSel ? ' sel' : ''));
            it.innerHTML = '<strong>' + esc(x.nombre) + '</strong><small>' + esc([x.km != null ? x.km + ' km' : null, x.zona].filter(Boolean).join(' · ')) + '</small>';
            it.onclick = function () { elegirLocal(x.codigo); };
            lista.appendChild(it);
        });
        var sel = $('#local'); if (sel) { sel.innerHTML = locales.map(function (x) { return '<option value="' + esc(x.codigo) + '"' + (x.codigo === localSel ? ' selected' : '') + '>' + esc(x.nombre) + (x.km != null ? ' (' + x.km + ' km)' : '') + '</option>'; }).join(''); }
    }
    function abrirLocales() { $('#locales-modal').hidden = false; document.body.classList.add('modal-abierto'); }
    function cerrarLocales() { $('#locales-modal').hidden = true; document.body.classList.remove('modal-abierto'); }

    // ── Menú ──────────────────────────────────────────────────────────────────
    function renderCatalogo() {
        var tabs = $('#familias'), cont = $('#articulos');
        tabs.innerHTML = ''; cont.innerHTML = '';
        if (!catalogo.familias.length) { cont.appendChild(el('p', 'tienda-vacio', 'El menú en línea todavía no tiene artículos publicados.')); return; }
        catalogo.familias.forEach(function (f, i) {
            var b = el('button', 'tienda-tab' + (i === 0 ? ' activa' : ''), esc(f.nombre));
            b.onclick = function () { document.querySelectorAll('.tienda-tab').forEach(function (x) { x.classList.remove('activa'); }); b.classList.add('activa'); var s = document.getElementById('fam-' + f.id); if (s) s.scrollIntoView({ behavior: 'smooth', block: 'start' }); };
            tabs.appendChild(b);
            var sec = el('section', 'tienda-familia'); sec.id = 'fam-' + f.id;
            var head = el('div', 'tienda-familia-head');
            if (f.imagenUrl) { var im = el('img'); im.src = f.imagenUrl; im.alt = ''; im.loading = 'lazy'; head.appendChild(im); }
            head.appendChild(el('h2', '', esc(f.nombre) + (f.descripcion ? '<small>' + esc(f.descripcion) + '</small>' : '')));
            sec.appendChild(head);
            var grid = el('div', 'tienda-grid');
            f.articulos.forEach(function (a) {
                var card = el('article', 'tienda-card'); card.tabIndex = 0;
                if (a.imagenUrl) { var img = el('img'); img.src = a.imagenUrl; img.alt = a.nombre; img.loading = 'lazy'; card.appendChild(img); }
                var body = el('div', 'tienda-card-body');
                body.appendChild(el('h3', '', esc(a.nombre)));
                if (a.descripcion) body.appendChild(el('p', '', esc(a.descripcion)));
                var foot = el('div', 'tienda-card-foot');
                foot.appendChild(el('span', 'tienda-precio', fmt(a.precio)));
                var btn = el('button', 'btn-agregar', a.modificadores && a.modificadores.length ? 'Elegir' : 'Agregar');
                btn.onclick = function (ev) { ev.stopPropagation(); abrirFicha(a); };
                foot.appendChild(btn);
                body.appendChild(foot); card.appendChild(body);
                card.onclick = function () { abrirFicha(a); };
                grid.appendChild(card);
            });
            sec.appendChild(grid); cont.appendChild(sec);
        });
    }

    // ── Ficha del artículo (modificadores, cantidad, nota) ────────────────────
    var ficha = null; // { art, sel: {grupo: [codigo,...]}, cantidad, nota }
    function abrirFicha(a) {
        ficha = { art: a, sel: {}, cantidad: 1, nota: '' };
        (a.modificadores || []).forEach(function (g) {
            ficha.sel[g.codigo] = g.opciones.filter(function (o) { return o.predeterminado; }).slice(0, g.max).map(function (o) { return o.codigo; });
        });
        var m = $('#ficha-modal');
        $('#ficha-titulo').textContent = a.nombre;
        $('#ficha-desc').textContent = a.descripcion || '';
        var im = $('#ficha-img'); if (a.imagenUrl) { im.src = a.imagenUrl; im.hidden = false; } else { im.hidden = true; }
        $('#ficha-nota').value = '';
        renderFicha();
        m.hidden = false; document.body.classList.add('modal-abierto');
    }
    function cerrarFicha() { $('#ficha-modal').hidden = true; document.body.classList.remove('modal-abierto'); ficha = null; }
    function fichaPrecio() {
        var a = ficha.art, extra = 0;
        (a.modificadores || []).forEach(function (g) {
            var sel = ficha.sel[g.codigo] || [];
            sel.forEach(function (cod, i) { var o = g.opciones.filter(function (x) { return x.codigo === cod; })[0]; if (o && i >= g.gratis) extra += o.precio || 0; });
        });
        return (a.precio + extra) * ficha.cantidad;
    }
    function fichaValida() {
        return (ficha.art.modificadores || []).every(function (g) { var n = (ficha.sel[g.codigo] || []).length; return n >= g.min && n <= g.max; });
    }
    function renderFicha() {
        var cont = $('#ficha-grupos'); cont.innerHTML = '';
        (ficha.art.modificadores || []).forEach(function (g) {
            var sel = ficha.sel[g.codigo] || [];
            var box = el('div', 'grupo');
            var req = g.min > 0 ? '<span class="req">Obligatorio</span>' : '<span class="opc">Opcional</span>';
            var regla = g.max === 1 ? 'Elegí 1' : (g.min === g.max ? 'Elegí ' + g.max : 'Hasta ' + g.max) + (g.gratis ? ' · ' + g.gratis + ' sin costo' : '');
            box.appendChild(el('div', 'grupo-head', '<h4>' + esc(g.nombre) + '</h4>' + req + '<small>' + regla + '</small>'));
            g.opciones.forEach(function (o) {
                var on = sel.indexOf(o.codigo) >= 0;
                var idx = sel.indexOf(o.codigo);
                var cobra = on ? idx >= g.gratis : sel.length >= g.gratis;
                var row = el('label', 'opcion' + (on ? ' on' : ''));
                row.innerHTML = '<input type="' + (g.max === 1 ? 'radio' : 'checkbox') + '" name="g' + g.codigo + '"' + (on ? ' checked' : '') + '> <span class="opcion-nombre">' + esc(o.nombre) + '</span><span class="opcion-precio">' + (o.precio && cobra ? '+' + fmt(o.precio) : (o.precio ? '<s>+' + fmt(o.precio) + '</s> gratis' : '')) + '</span>';
                row.querySelector('input').onchange = function (ev) {
                    if (g.max === 1) { ficha.sel[g.codigo] = [o.codigo]; }
                    else if (ev.target.checked) { if (sel.length >= g.max) { ev.target.checked = false; return; } ficha.sel[g.codigo] = sel.concat([o.codigo]); }
                    else { ficha.sel[g.codigo] = sel.filter(function (c) { return c !== o.codigo; }); }
                    renderFicha();
                };
                box.appendChild(row);
            });
            cont.appendChild(box);
        });
        $('#ficha-cant').textContent = ficha.cantidad;
        var ok = fichaValida();
        var b = $('#ficha-agregar'); b.disabled = !ok; b.textContent = (ok ? 'Agregar ' : 'Completá las opciones · ') + fmt(fichaPrecio());
    }
    function agregarDesdeFicha() {
        if (!fichaValida()) return;
        var a = ficha.art, mods = [];
        (a.modificadores || []).forEach(function (g) {
            (ficha.sel[g.codigo] || []).forEach(function (cod, i) { var o = g.opciones.filter(function (x) { return x.codigo === cod; })[0]; if (o) mods.push({ grupo: g.codigo, grupoNombre: g.nombre, codigo: o.codigo, nombre: o.nombre, precio: i < g.gratis ? 0 : (o.precio || 0) }); });
        });
        var nota = $('#ficha-nota').value.trim();
        var key = a.codigo + '|' + mods.map(function (m) { return m.grupo + ':' + m.codigo; }).join(',') + '|' + nota;
        var ya = carrito.filter(function (i) { return i.key === key; })[0];
        if (ya) ya.cantidad += ficha.cantidad; else carrito.push({ key: key, codigo: a.codigo, nombre: a.nombre, precio: a.precio, cantidad: ficha.cantidad, mods: mods, nota: nota });
        guardar(); renderCarrito(); cerrarFicha();
        var fab = $('#btn-carrito'); fab.classList.add('pulso'); setTimeout(function () { fab.classList.remove('pulso'); }, 600);
    }

    // ── Carrito ───────────────────────────────────────────────────────────────
    function renderCarrito() {
        var n = unidades(), t = fmt(total());
        $('#carrito-n').textContent = n; $('#carrito-total').textContent = t; $('#carrito-total-2').textContent = t; $('#resumen-total').textContent = t;
        $('#btn-carrito').classList.toggle('con-items', n > 0);
        var lista = $('#carrito-lista'); lista.innerHTML = '';
        if (!n) lista.appendChild(el('p', 'tienda-vacio', 'Tu pedido está vacío. Agregá algo rico.'));
        carrito.forEach(function (i, idx) {
            var row = el('div', 'carrito-item');
            var det = i.mods.map(function (m) { return esc(m.nombre) + (m.precio ? ' (+' + fmt(m.precio) + ')' : ''); }).join(', ') + (i.nota ? (i.mods.length ? ' · ' : '') + '<em>' + esc(i.nota) + '</em>' : '');
            row.appendChild(el('div', 'carrito-nombre', esc(i.nombre) + '<small>' + (det || fmt(i.precio) + ' c/u') + '</small>'));
            var ctl = el('div', 'carrito-ctl');
            var menos = el('button', '', '−'); menos.onclick = function () { i.cantidad -= 1; if (i.cantidad <= 0) carrito.splice(idx, 1); guardar(); renderCarrito(); };
            var mas = el('button', '', '+'); mas.onclick = function () { i.cantidad += 1; guardar(); renderCarrito(); };
            ctl.appendChild(menos); ctl.appendChild(el('span', '', String(i.cantidad))); ctl.appendChild(mas);
            row.appendChild(ctl);
            row.appendChild(el('div', 'carrito-importe', fmt(unit(i) * i.cantidad)));
            lista.appendChild(row);
        });
        $('#btn-enviar').disabled = !n; $('#btn-pedir').disabled = !n;
        var res = $('#resumen-lineas'); if (res) { res.innerHTML = carrito.map(function (i) { return '<div><span>' + i.cantidad + ' × ' + esc(i.nombre) + (i.mods.length ? ' <small>(' + esc(i.mods.map(function (m) { return m.nombre; }).join(', ')) + ')</small>' : '') + '</span><span>' + fmt(unit(i) * i.cantidad) + '</span></div>'; }).join(''); }
    }

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
    function enviar(ev) {
        ev.preventDefault();
        var f = ev.target, msg = $('#form-msg');
        msg.textContent = ''; msg.className = 'form-msg';
        var local = f.local.value || localSel, nombre = f.nombre.value.trim(), tel = f.telefono.value.trim();
        if (!local) { msg.textContent = 'Elegí el local donde vas a recoger.'; return; }
        if (!nombre || !tel) { msg.textContent = 'Necesitamos tu nombre y un teléfono para avisarte.'; return; }
        var btn = $('#btn-enviar'); btn.disabled = true; btn.textContent = 'Enviando…';
        var clave = 'web-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
        api('/pedidos', { method: 'POST', body: {
            codAlmacen: local, modalidad: 'recoger', origen: 'rosti.cr',
            cliente: { nombre: nombre, telefono: tel, email: f.email.value.trim() || undefined, cedula: f.cedula.value.trim() || undefined },
            notas: f.notas.value.trim() || undefined, claveIdempotencia: clave,
            lineas: carrito.map(function (i) { return { codigo: i.codigo, cantidad: i.cantidad, notas: i.nota || undefined, modificadores: i.mods.map(function (m) { return { grupo: m.grupo, codigo: m.codigo }; }) }; })
        } }).then(function (d) {
            carrito = []; guardar(); renderCarrito();
            $('#checkout').hidden = true;
            var ok = $('#confirmacion'); ok.hidden = false;
            $('#conf-codigo').textContent = d.pedido.codigo;
            $('#conf-total').textContent = fmt(d.pedido.total);
            $('#conf-local').textContent = d.pedido.local || local;
            $('#conf-msg').textContent = (d.pago && d.pago.mensaje) || '';
            ok.scrollIntoView({ behavior: 'smooth' });
        }).catch(function (e) { msg.textContent = e.message || 'No se pudo enviar el pedido. Probá de nuevo.'; msg.className = 'form-msg error'; })
          .then(function () { btn.disabled = false; btn.textContent = 'Enviar pedido'; });
    }

    // ── Arranque ──────────────────────────────────────────────────────────────
    function abrirCarrito(abrir) { $('#carrito').classList.toggle('abierto', abrir); document.body.classList.toggle('carrito-abierto', abrir); }
    $('#btn-carrito').onclick = function () { abrirCarrito(true); };
    $('#carrito-cerrar').onclick = function () { abrirCarrito(false); };
    $('#btn-pedir').onclick = function () { abrirCarrito(false); $('#checkout').hidden = false; $('#confirmacion').hidden = true; renderLocal(); $('#checkout').scrollIntoView({ behavior: 'smooth' }); };
    $('#form-pedido').addEventListener('submit', enviar);
    $('#form-pedido').telefono.addEventListener('input', function () { autocompletar('telefono'); });
    $('#form-pedido').cedula.addEventListener('input', function () { autocompletar('cedula'); });
    $('#conf-otro').onclick = function () { $('#confirmacion').hidden = true; window.scrollTo({ top: 0, behavior: 'smooth' }); };
    $('#local-btn').onclick = abrirLocales; $('#locales-cerrar').onclick = cerrarLocales; $('#ubic-gps').onclick = pedirGps;
    $('#ficha-cerrar').onclick = cerrarFicha; $('#ficha-agregar').onclick = agregarDesdeFicha;
    $('#ficha-menos').onclick = function () { if (ficha && ficha.cantidad > 1) { ficha.cantidad--; renderFicha(); } };
    $('#ficha-mas').onclick = function () { if (ficha && ficha.cantidad < 50) { ficha.cantidad++; renderFicha(); } };
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') { cerrarFicha(); cerrarLocales(); abrirCarrito(false); } });

    api('/catalogo').then(function (d) {
        catalogo = d; locales = d.locales || []; renderCatalogo(); renderCarrito(); renderLocal();
        $('#cargando').hidden = true;
        if (d.pagos && !d.pagos.disponible) { var av = $('#aviso-pago'); av.hidden = false; av.textContent = d.pagos.mensaje; }
        return ubicacionPorIp();
    }).catch(function (e) {
        $('#cargando').innerHTML = '<p class="tienda-vacio">' + esc(e.message === 'No disponible' ? 'Esta página es privada: abrila con el enlace completo que te dieron.' : (e.message || 'No se pudo cargar el menú.')) + '</p>';
    });
})();

/* Tienda Rosti — página oculta mientras está en pruebas.
 * Habla con el API del backend por el mismo origen (nginx: /api/tienda/ → KPIs Rosti).
 * Mientras la tienda es privada, cada petición lleva el header X-Tienda-Acceso con la
 * clave de acceso. La clave viaja en el FRAGMENTO de la URL (…/pedir-xxxx.html#clave):
 * el navegador no la manda al servidor al pedir la página, no queda en el HTML ni en
 * los logs, y se recuerda en la pestaña (sessionStorage). Cuando la tienda se abra al
 * público se quita TIENDA_PREVIEW_KEY del servidor y la página sigue igual.
 * La tienda manda CÓDIGOS de artículo y cantidades; los precios los pone el servidor.
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
    var catalogo = null;                 // { familias, locales, pagos }
    var carrito = {};                    // codigo → { codigo, nombre, precio, cantidad }
    try { carrito = JSON.parse(localStorage.getItem('rosti.carrito') || '{}') || {}; } catch (e) { carrito = {}; }
    var guardar = function () { try { localStorage.setItem('rosti.carrito', JSON.stringify(carrito)); } catch (e) { /* */ } };
    var items = function () { return Object.keys(carrito).map(function (k) { return carrito[k]; }); };
    var total = function () { return items().reduce(function (s, i) { return s + i.precio * i.cantidad; }, 0); };
    var unidades = function () { return items().reduce(function (s, i) { return s + i.cantidad; }, 0); };

    // ── Render ────────────────────────────────────────────────────────────────
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
                var card = el('article', 'tienda-card');
                if (a.imagenUrl) { var img = el('img'); img.src = a.imagenUrl; img.alt = a.nombre; img.loading = 'lazy'; card.appendChild(img); }
                var body = el('div', 'tienda-card-body');
                body.appendChild(el('h3', '', esc(a.nombre)));
                if (a.descripcion) body.appendChild(el('p', '', esc(a.descripcion)));
                var foot = el('div', 'tienda-card-foot');
                foot.appendChild(el('span', 'tienda-precio', fmt(a.precio)));
                var btn = el('button', 'btn-agregar', 'Agregar');
                btn.onclick = function () { agregar(a); btn.textContent = '¡Agregado!'; setTimeout(function () { btn.textContent = 'Agregar'; }, 900); };
                foot.appendChild(btn);
                body.appendChild(foot); card.appendChild(body); grid.appendChild(card);
            });
            sec.appendChild(grid); cont.appendChild(sec);
        });
        var sel = $('#local');
        sel.innerHTML = '<option value="">Elegí el local…</option>' + catalogo.locales.map(function (l) { return '<option value="' + esc(l.codigo) + '">' + esc(l.nombre) + '</option>'; }).join('');
        try { var ult = localStorage.getItem('rosti.local'); if (ult) sel.value = ult; } catch (e) { /* */ }
    }
    function agregar(a) {
        var it = carrito[a.codigo] || { codigo: a.codigo, nombre: a.nombre, precio: a.precio, cantidad: 0 };
        it.cantidad += 1; it.precio = a.precio; carrito[a.codigo] = it; guardar(); renderCarrito();
    }
    function cambiar(codigo, d) {
        var it = carrito[codigo]; if (!it) return;
        it.cantidad += d; if (it.cantidad <= 0) delete carrito[codigo]; guardar(); renderCarrito();
    }
    function renderCarrito() {
        var n = unidades(), t = fmt(total());
        $('#carrito-n').textContent = n;
        $('#carrito-total').textContent = t;
        $('#carrito-total-2').textContent = t;
        $('#resumen-total').textContent = t;
        $('#btn-carrito').classList.toggle('con-items', n > 0);
        var lista = $('#carrito-lista'); lista.innerHTML = '';
        if (!n) { lista.appendChild(el('p', 'tienda-vacio', 'Tu pedido está vacío. Agregá algo rico.')); }
        items().forEach(function (i) {
            var row = el('div', 'carrito-item');
            row.appendChild(el('div', 'carrito-nombre', esc(i.nombre) + '<small>' + fmt(i.precio) + ' c/u</small>'));
            var ctl = el('div', 'carrito-ctl');
            var menos = el('button', '', '−'); menos.onclick = function () { cambiar(i.codigo, -1); };
            var mas = el('button', '', '+'); mas.onclick = function () { cambiar(i.codigo, 1); };
            ctl.appendChild(menos); ctl.appendChild(el('span', '', String(i.cantidad))); ctl.appendChild(mas);
            row.appendChild(ctl);
            row.appendChild(el('div', 'carrito-importe', fmt(i.precio * i.cantidad)));
            lista.appendChild(row);
        });
        $('#btn-enviar').disabled = !n;
        $('#btn-pedir').disabled = !n;
    }

    // ── Envío ─────────────────────────────────────────────────────────────────
    function enviar(ev) {
        ev.preventDefault();
        var f = ev.target, msg = $('#form-msg');
        msg.textContent = ''; msg.className = 'form-msg';
        var local = f.local.value, nombre = f.nombre.value.trim(), tel = f.telefono.value.trim();
        if (!local) { msg.textContent = 'Elegí el local donde vas a recoger.'; return; }
        if (!nombre || !tel) { msg.textContent = 'Necesitamos tu nombre y un teléfono para avisarte.'; return; }
        try { localStorage.setItem('rosti.local', local); } catch (e) { /* */ }
        var btn = $('#btn-enviar'); btn.disabled = true; btn.textContent = 'Enviando…';
        var clave = 'web-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
        api('/pedidos', { method: 'POST', body: {
            codAlmacen: local, modalidad: 'recoger', origen: 'rosti.cr',
            cliente: { nombre: nombre, telefono: tel, email: f.email.value.trim() || undefined },
            notas: f.notas.value.trim() || undefined, claveIdempotencia: clave,
            lineas: items().map(function (i) { return { codigo: i.codigo, cantidad: i.cantidad }; })
        } }).then(function (d) {
            carrito = {}; guardar(); renderCarrito();
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
    $('#btn-pedir').onclick = function () { abrirCarrito(false); $('#checkout').hidden = false; $('#confirmacion').hidden = true; $('#checkout').scrollIntoView({ behavior: 'smooth' }); };
    $('#form-pedido').addEventListener('submit', enviar);
    $('#conf-otro').onclick = function () { $('#confirmacion').hidden = true; window.scrollTo({ top: 0, behavior: 'smooth' }); };

    api('/catalogo').then(function (d) {
        catalogo = d; renderCatalogo(); renderCarrito();
        $('#cargando').hidden = true;
        if (d.pagos && !d.pagos.disponible) { var av = $('#aviso-pago'); av.hidden = false; av.textContent = d.pagos.mensaje; }
    }).catch(function (e) {
        $('#cargando').innerHTML = '<p class="tienda-vacio">' + esc(e.message === 'No disponible' ? 'Esta página es privada: abrila con el enlace completo que te dieron.' : (e.message || 'No se pudo cargar el menú.')) + '</p>';
    });
})();

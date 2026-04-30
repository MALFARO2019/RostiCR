# Rosti Costa Rica - Sitio Web (Réplica)

Réplica visual del sitio www.rosti.cr, sin funcionalidad de eCommerce. Es 100% estático, sin paso de build.

## Identidad visual

- Navy `#264A6E` (primario), naranja `#F4811F` y rojo llama `#E53C24` (acentos)
- Tipografía: **Montserrat** (titulares) + **Open Sans** (cuerpo)
- Logo real: `images/banner_1.webp` (llama + wordmark "Rosti")
- Favicon: `images/logo.webp` (solo el icono de la llama)

## Estructura

```
RostiCR/
├── index.html               # Hero "¡Comé como te gusta!" + 18 categorías + sostenibilidad + DinoGira + servicios
├── menu.html                # Catálogo: 19 categorías reales (Promociones, Boquitas, Clásicos, Rosters, ...)
├── menu-restaurante.html    # Menú especial para consumo en local (Rosti Lunch, Happy Hour, ...)
├── reglamentos.html         # 8 reglamentos reales (Happy Hour, Rosti Lunch, Pet Friendly, Dino Fiestas, ...)
├── locales.html             # 13 sucursales reales con plus codes y horarios
├── promoviajera.html        # Página de la Promo Viajera (Salinitas)
├── css/styles.css           # Hoja de estilos
├── js/main.js               # Toggle de menú móvil + año del footer
├── images/                  # logo + banners + fondo Dino
├── web.config               # Azure App Service / IIS (HTTPS, compresión, cabeceras, .html sin extensión)
├── staticwebapp.config.json # Azure Static Web Apps (rewrites, headers)
├── sitemap.xml
├── robots.txt
└── README.md
```

## Probar localmente

```bash
# Python
python -m http.server 8080
# Node
npx serve .
# Azure Static Web Apps CLI
swa start .
```

Abrir http://localhost:8080 (o el puerto de SWA, que suele ser 4280).

> **Nota sobre caché:** los archivos `css/styles.css`, `js/main.js`, `images/banner_1.webp` y `images/logo.webp` se cargan con un query string (`?v=N`). Si hacés cambios, subí ese número en los HTMLs para forzar al navegador a descargar la versión nueva.

## Despliegue

El repositorio **no tiene GitHub Actions**: el despliegue es manual o lo hace un agente externo. Las dos plataformas soportadas son:

### A) Azure Static Web Apps

`staticwebapp.config.json` ya define:
- Rewrite de `/` → `/index.html`
- Fallback de 404 → `/index.html`
- `Cache-Control: no-cache, must-revalidate` (HTML siempre revalida; los assets versionados con `?v=N` siguen cacheándose en el navegador)

Conectarlo:

```bash
az staticwebapp create \
  --name rosti-cr \
  --resource-group <grupo> \
  --location "East US 2" \
  --source https://github.com/MALFARO2019/RostiCR \
  --branch main \
  --app-location "/" \
  --output-location ""
```

### B) Azure App Service (Windows / IIS)

`web.config` configura HTTPS forzado, compresión, cabeceras de seguridad, cache de estáticos (7 días) y URLs limpias (`/menu` → `/menu.html`).

Despliegue por ZIP:

```bash
zip -r site.zip . -x ".git/*"
az webapp deploy --resource-group <grupo> --name <app> --src-path site.zip
```

## Personalización rápida

Las variables de marca están en `css/styles.css`:

```css
:root {
    --navy: #264A6E;
    --navy-dark: #1B3653;
    --orange: #F4811F;
    --flame-red: #E53C24;
}
```

El contenido de cada página se edita directamente en su `.html`.

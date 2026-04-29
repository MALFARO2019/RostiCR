# Rosti Costa Rica - Sitio Web (Réplica)

Réplica funcional del sitio web de Rosti Costa Rica (rosti.cr), desarrollada como sitio estático listo para desplegarse en Azure. Mantiene la identidad de marca, navegación, contenido y experiencia de usuario, **excluyendo intencionalmente toda funcionalidad de eCommerce** (carrito, checkout, pagos, ordenamiento online).

## Tecnologías

- HTML5 semántico
- CSS3 (variables, grid, flexbox, responsive)
- JavaScript vanilla (sin frameworks ni dependencias)
- Font Awesome 6 (CDN)
- Google Fonts: Bebas Neue + Open Sans

Sin pasos de build: el sitio puede servirse directamente desde cualquier servidor de archivos estáticos.

## Estructura

```
RostiCR/
├── index.html              # Página principal (Hero, nosotros, menú destacado, promos, locales)
├── menu.html               # Catálogo del menú con filtro por categorías
├── locales.html            # Buscador de locales con filtros por provincia y nombre
├── promociones.html        # Promociones vigentes
├── nosotros.html           # Historia, misión, visión, valores y compromiso
├── empleos.html            # Vacantes y formulario de postulación
├── contacto.html           # Información de contacto y formulario
├── reglamentos.html        # Términos, condiciones y políticas
├── css/
│   └── styles.css          # Hoja de estilos principal
├── js/
│   └── main.js             # Interactividad: menú móvil, filtros, formularios
├── images/                 # SVGs e ilustraciones
├── web.config              # Configuración para Azure App Service (Windows / IIS)
├── staticwebapp.config.json # Configuración para Azure Static Web Apps
├── sitemap.xml
├── robots.txt
└── README.md
```

## Características funcionales

| Funcionalidad | Descripción |
|---|---|
| Navegación responsive | Menú hamburguesa para móvil, sticky header |
| Filtro de menú | Por categorías (clásicos, sopas, ensaladas, etc.) |
| Buscador de locales | Filtro por provincia + búsqueda por texto |
| Formulario de contacto | Validación HTML5 y feedback visual |
| Formulario de postulación | Empleos con datos completos |
| Animaciones al scroll | IntersectionObserver para fade-in |
| SEO | Meta tags, sitemap.xml, robots.txt, Open Graph implícito |
| Accesibilidad | Roles ARIA, etiquetas semánticas, contraste apropiado |

## Despliegue en Azure

### Opción A: Azure Static Web Apps (recomendada)

```bash
# Instalar Azure CLI si no lo tenés
az login

# Crear el static web app
az staticwebapp create \
  --name rosti-cr \
  --resource-group <tu-grupo> \
  --location "East US 2" \
  --source . \
  --branch main \
  --app-location "/" \
  --output-location ""
```

O conectalo directamente desde el portal de Azure:
1. Crear "Static Web App"
2. Conectar con el repositorio Git
3. Build details → "Custom"
4. App location: `/`
5. Output location: (vacío)

El archivo `staticwebapp.config.json` ya tiene la configuración de routing y headers.

### Opción B: Azure App Service (Windows / IIS)

1. Crear un App Service Plan (Windows).
2. Crear un Web App con runtime "Static HTML".
3. Subir los archivos por FTP, ZIP Deploy o GitHub Actions.

```bash
# Despliegue por ZIP
zip -r site.zip . -x "*.git*" -x "node_modules/*"
az webapp deploy --resource-group <tu-grupo> --name <tu-app> --src-path site.zip
```

El `web.config` ya configura:
- HTTPS forzado
- Compresión gzip
- Cabeceras de seguridad
- Cache de archivos estáticos
- URLs limpias (acceso a `/menu` redirige a `/menu.html`)

### Opción C: Azure Storage + CDN

1. Crear cuenta de Storage habilitando "Static website".
2. Subir el contenido al contenedor `$web`.
3. (Opcional) Asociar Azure CDN o Front Door para HTTPS y dominio personalizado.

```bash
az storage blob upload-batch \
  --account-name <tu-cuenta> \
  --destination '$web' \
  --source .
```

## Dominio personalizado

Para apuntar `rosti.cr` o subdominio al sitio:

1. En Azure (Static Web App / App Service / CDN), añadir el dominio personalizado.
2. Configurar el registro DNS:
   - `CNAME` → al hostname de Azure (Static Web Apps / App Service / CDN endpoint)
   - O `A` record → IP que indique Azure
3. Validar el certificado SSL (gratuito automático en Static Web Apps y App Service).

## Probar localmente

Cualquier servidor estático funciona:

```bash
# Python
python3 -m http.server 8080

# Node
npx serve .

# PHP
php -S localhost:8080
```

Luego abrí http://localhost:8080.

## Personalización

Toda la identidad visual está en variables CSS en `css/styles.css`:

```css
:root {
    --rosti-red: #B71C1C;
    --rosti-red-dark: #7F0000;
    --rosti-yellow: #F9A825;
    /* ... */
}
```

El contenido de menú, locales y promociones se edita directamente en cada archivo HTML.

## Notas

- Todas las imágenes son placeholders SVG. Reemplazalas por fotografías reales de los platillos antes de publicar.
- Los formularios actualmente son client-side (UI). Para hacerlos funcionales conviene integrar:
  - Azure Functions (HTTP trigger) + envío por SendGrid/Mailgun, o
  - Azure Logic Apps, o
  - Servicios como Formspree / Netlify Forms.
- La sección de eCommerce/pedidos no se incluye, según lo solicitado.

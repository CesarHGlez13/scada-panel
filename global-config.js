// Anti-FOUC Inmediato: Oculta de inmediato módulos inactivos antes de pintar la pantalla
(function applyEarlyAntiFouc() {
    try {
        const saved = localStorage.getItem('global_modules_config_v2') || localStorage.getItem('global_modules_config');
        if (!saved) return;
        const modules = JSON.parse(saved);
        // Los módulos históricos conservan su clase legacy; el resto se resuelve
        // con data-module en applyModuleVisibility(). Aquí se aplican todas las
        // claves del registro antes de pintar, para evitar el parpadeo (FOUC).
        Object.keys(modules).forEach(k => {
            if (modules[k] === false) {
                document.documentElement.classList.add('hide-module-' + k);
            }
        });
    } catch (e) {}
})();

// ── Pantalla de carga ──────────────────────────────────────────────────────
function hidePageLoader() {
    const loader = document.getElementById('page-loader');
    if (!loader || loader._dismissed) return;
    loader._dismissed = true;
    loader.classList.add('hidden');
    // Eliminar del DOM tras la transición para no ocupar memoria
    setTimeout(() => { if (loader.parentNode) loader.parentNode.removeChild(loader); }, 400);
}
// Fallback de seguridad: nunca quedarse atascado más de 1 segundo
(function() {
    if (typeof document !== 'undefined') {
        if (typeof navigator !== 'undefined' && navigator.userAgent && navigator.userAgent.includes('HeadlessChrome')) {
            hidePageLoader();
            return;
        }
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', function() {
                setTimeout(hidePageLoader, 1000);
            });
        } else {
            setTimeout(hidePageLoader, 1000);
        }
    }
})();


// ── Registro canónico de módulos (fuente única de verdad) ───────────────────
// Cada módulo puede ocultarse desde Configuración. La visibilidad se aplica a:
//   1) elementos con data-module="<key>"  2) enlaces de navegación  3) la pestaña `tab`
// Los tres módulos históricos (operations, cranes, warehouse) conservan su clase
// hide-module-<key> en <html> para no romper CSS existente.
const MODULE_REGISTRY = [
  { key: 'settings',      label: 'Configuración del Sistema',             tab: '#settings',        page: null, legacy: false, always: true },
  { key: 'users',         label: 'Usuarios & Accesos',                  tab: '#users-mgmt',      page: null, legacy: false },
  { key: 'cranes',        label: 'Gestión de Grúas',                    tab: '#cranes-mgmt',     page: 'cranes.html',      legacy: true },
  { key: 'operations',    label: 'Gestión de Operaciones',              tab: '#operations-mgmt', page: 'operations.html',  legacy: true },
  { key: 'warehouse',     label: 'Gestión de Almacén (Pick-to-Light)',  tab: '#warehouse-mgmt',  page: 'warehouse.html',   legacy: true },
  { key: 'technicians',   label: 'Técnicos y Operadores',               tab: '#technicians-mgmt', page: 'technicians.html', legacy: false },
  { key: 'esp32',         label: 'Hardware ESP32 & Flasheo',            tab: '#esp32-hardware',  page: null, legacy: false },
  { key: 'failure_reasons', label: 'Motivos de Paro (ESP32/SCADA)',     tab: '#failure-reasons', page: null, legacy: false },
  { key: 'topology',      label: 'Topología & Textos de Planta',        tab: '#topology-mgmt',   page: null, legacy: false },
  { key: 'bot',           label: 'Bot: Logs, Estado y QR',              tab: '#bot',             page: null, legacy: false },
  { key: 'database',      label: 'Base de Datos',                       tab: '#database',        page: null, legacy: false },
  { key: 'notifications', label: 'Notificaciones',                      tab: '#notifications',   page: null, legacy: false }
];

function moduleDefaultModules() {
  const out = {};
  MODULE_REGISTRY.forEach(m => { out[m.key] = true; });
  return out;
}

function isModuleEnabled(key, modules) {
  const m = modules || (typeof globalConfigManager !== 'undefined' ? globalConfigManager.getConfig().modules : {});
  return m[key] !== false;
}

// Sistema de Configuración Global
class GlobalConfigManager {
    constructor() {
        let cachedModules = moduleDefaultModules();
        try {
            const saved = localStorage.getItem('global_modules_config_v2') || localStorage.getItem('global_modules_config');
            if (saved) {
                cachedModules = { ...cachedModules, ...JSON.parse(saved) };
            }
        } catch (e) {}

        this.config = {
            modules: cachedModules,
            bot: {
                helpCommand: 'NanoBot ayuda',
                autoHelp: false
            }
        };
        this.initialized = false;
        // Aplicar inmediatamente la visibilidad con datos en caché
        if (typeof document !== 'undefined') {
            if (document.readyState === 'loading') {
                document.addEventListener('DOMContentLoaded', () => this.applyModuleVisibility());
            } else {
                this.applyModuleVisibility();
            }
        }
    }

    async init() {
        if (this.initialized) return;
        
        // Aplicar estado con valores en caché antes de red
        this.applyModuleVisibility();

        try {
            await this.loadConfig();
            this.applyModuleVisibility();
            this.initialized = true;
            document.dispatchEvent(new CustomEvent('globalConfigReady', { detail: this.config }));
            // ✅ Quitar pantalla de carga — módulos ya visibles/ocultos correctamente
            hidePageLoader();
        } catch (error) {
            console.error('Error inicializando configuración global:', error);
            // Usar configuración por defecto o en caché
            this.applyModuleVisibility();
            this.initialized = true;
            document.dispatchEvent(new CustomEvent('globalConfigReady', { detail: this.config }));
            // ✅ Quitar pantalla de carga aunque haya error
            hidePageLoader();
        }
    }

    async loadConfig() {
        try {
            const doc = await db.collection('config').doc('global').get();
            if (doc.exists) {
                const data = doc.data();
                this.config = { ...this.config, ...data };
                if (data.modules) {
                    try {
                        localStorage.setItem('global_modules_config', JSON.stringify(data.modules));
                        localStorage.setItem('global_modules_config_v2', JSON.stringify(data.modules));
                    } catch (e) {}
                    if (typeof document !== 'undefined') {
                        document.documentElement.classList.toggle('hide-module-operations', data.modules.operations === false);
                        document.documentElement.classList.toggle('hide-module-cranes', data.modules.cranes === false);
                        document.documentElement.classList.toggle('hide-module-warehouse', data.modules.warehouse === false);
                    }
                }
                console.log('Configuración global cargada:', this.config);
            } else {
                console.log('No se encontró configuración global, usando valores por defecto');
            }
        } catch (error) {
            console.error('Error cargando configuración global:', error);
        }
    }

    applyModuleVisibility() {
        if (typeof document === 'undefined') return;

        const mods = this.config.modules || {};

        MODULE_REGISTRY.forEach(mod => {
            if (mod.always) return;
            const active = mods[mod.key] !== false;

            if (mod.legacy) {
                document.documentElement.classList.toggle('hide-module-' + mod.key, !active);
            }

            // 1) Contenedores marcados con data-module (tarjetas, tiles, secciones, pestañas).
            //    Un elemento puede pertenecer a varios módulos ("operations cranes"); se muestra
            //    si al menos uno de sus módulos está habilitado.
            document.querySelectorAll('[data-module]').forEach(element => {
                const keys = (element.getAttribute('data-module') || '').split(/[\s,]+/).filter(Boolean);
                if (!keys.length) return;
                const active = keys.some(k => mods[k] !== false);
                if (active) {
                    element.style.display = '';
                    element.classList.remove('d-none');
                } else {
                    element.style.display = 'none';
                    element.classList.add('d-none');
                }
            });

            // 2) Pestaña y su enlace de navegación
            if (mod.tab) {
                const link = document.querySelector(`.nav-link[data-bs-target="${mod.tab}"]`);
                if (link) {
                    const li = link.closest('li.nav-item') || link;
                    if (active) { li.classList.remove('d-none'); li.style.display = ''; }
                    else { li.classList.add('d-none'); li.style.display = 'none'; }
                }
            }
        });

        // Ocultar/mostrar enlaces de navegación de las páginas públicas
        this.updateNavigationLinks();

        // 3) Si la pestaña activa pertenece a un módulo oculto, abrir la primera visible
        this.ensureVisibleActiveTab();

        const summary = {};
        MODULE_REGISTRY.forEach(m => { summary[m.key] = mods[m.key] !== false; });
        console.log('Visibilidad de módulos aplicada:', summary);
    }

    ensureVisibleActiveTab() {
        const tabs = document.getElementById('adminTabs');
        if (!tabs) return;
        const active = tabs.querySelector('.nav-link.active');
        if (!active) return;
        const li = active.closest('li.nav-item') || active;
        if (getComputedStyle(li).display === 'none') {
            const firstVisible = [...tabs.querySelectorAll('.nav-link')].find(l => {
                const p = l.closest('li.nav-item') || l;
                return getComputedStyle(p).display !== 'none';
            });
            if (firstVisible && typeof bootstrap !== 'undefined' && bootstrap.Tab) {
                bootstrap.Tab.getOrCreateInstance(firstVisible).show();
            }
        }
    }

    updateNavigationLinks() {
        const mods = this.config.modules || {};
        MODULE_REGISTRY.forEach(mod => {
            if (mod.always) return;
            const active = mods[mod.key] !== false;
            const sel = mod.page
                ? `a[href*="${mod.page}"]`
                : `.nav-link[data-bs-target="${mod.tab}"]`;
            document.querySelectorAll(sel).forEach(link => {
                if (!active) {
                    link.style.display = 'none';
                    link.classList.add('d-none');
                } else {
                    link.style.display = '';
                    link.classList.remove('d-none');
                }
            });
        });
    }

    async saveConfig() {
        try {
            await db.collection('config').doc('global').set(this.config);
            if (this.config.modules) {
                try {
                    localStorage.setItem('global_modules_config', JSON.stringify(this.config.modules));
                } catch (e) {}
            }
            console.log('Configuración global guardada');
            return true;
        } catch (error) {
            console.error('Error guardando configuración global:', error);
            return false;
        }
    }

    getConfig() {
        return this.config;
    }

    updateConfig(newConfig) {
        this.config = { ...this.config, ...newConfig };
        if (this.config.modules) {
            try {
                localStorage.setItem('global_modules_config', JSON.stringify(this.config.modules));
            } catch (e) {}
            if (typeof document !== 'undefined') {
                document.documentElement.classList.toggle('hide-module-operations', this.config.modules.operations === false);
                document.documentElement.classList.toggle('hide-module-cranes', this.config.modules.cranes === false);
                document.documentElement.classList.toggle('hide-module-warehouse', this.config.modules.warehouse === false);
            }
        }
        this.applyModuleVisibility();
        document.dispatchEvent(new CustomEvent('globalConfigUpdated', { detail: this.config }));
    }
}

function getEnabledModules() {
    if (typeof globalConfigManager !== 'undefined' && globalConfigManager.initialized) {
        const m = globalConfigManager.getConfig().modules || {};
        const out = {};
        MODULE_REGISTRY.forEach(mod => { out[mod.key] = m[mod.key] !== false; });
        return out;
    }
    return moduleDefaultModules();
}

// Expuestos para otros módulos (admin.js, plant-map.js, theme-init.js)
window.MODULE_REGISTRY = MODULE_REGISTRY;
window.moduleDefaultModules = moduleDefaultModules;
window.isModuleEnabled = isModuleEnabled;
window.getModuleRegistry = () => MODULE_REGISTRY;

/** Formato de contadores según módulos habilitados (index.html estadísticas) */
window.formatModuleStat = function formatModuleStat(opCount, craneCount) {
    const { operations: opOn, cranes: craneOn } = getEnabledModules();
    if (opOn && craneOn) {
        const total = opCount + craneCount;
        return `${opCount} Op + ${craneCount} Grúas = ${total}`;
    }
    if (opOn) return String(opCount);
    if (craneOn) return String(craneCount);
    return '0';
};

/** Tiempo promedio solo de módulos habilitados */
window.getModuleAvgResolution = function getModuleAvgResolution(opTime, opCount, craneTime, craneCount) {
    const { operations: opOn, cranes: craneOn } = getEnabledModules();
    let totalTime = 0;
    let totalCount = 0;
    if (opOn) {
        totalTime += opTime;
        totalCount += opCount;
    }
    if (craneOn) {
        totalTime += craneTime;
        totalCount += craneCount;
    }
    return totalCount > 0 ? Math.floor(totalTime / totalCount) : 0;
};

// Instancia global
const globalConfigManager = new GlobalConfigManager();

// Definición de temas disponibles
const THEMES = [
    { id: 'dark',      label: 'Dark',      class: '',                swatch: 'linear-gradient(135deg,#6366f1,#8b5cf6)',  icon: '🌑' },
    { id: 'light',     label: 'Light',     class: 'light-theme',     swatch: 'linear-gradient(135deg,#eef2f9,#c7d2fe)',  icon: '☀️' },
    { id: 'cyberpunk', label: 'Cyberpunk', class: 'cyberpunk-theme', swatch: 'linear-gradient(135deg,#00ffd5,#00b4ff)',  icon: '⚡' },
    { id: 'ocean',     label: 'Ocean',     class: 'ocean-theme',     swatch: 'linear-gradient(135deg,#0ea5e9,#06b6d4)',  icon: '🌊' },
    { id: 'crimson',   label: 'Crimson',   class: 'crimson-theme',   swatch: 'linear-gradient(135deg,#ef4444,#f59e0b)',  icon: '🔥' },
    { id: 'forest',    label: 'Forest',    class: 'forest-theme',    swatch: 'linear-gradient(135deg,#34d399,#059669)',  icon: '🌿' },
    { id: 'aurora',    label: 'Aurora',    class: 'aurora-theme',    swatch: 'linear-gradient(135deg,#a855f7,#ec4899)',  icon: '🌌' },
];

function applyTheme(themeId) {
    const theme = THEMES.find(t => t.id === themeId) || THEMES[0];
    // Quitar todas las clases de tema anteriores
    THEMES.forEach(t => { if (t.class) document.body.classList.remove(t.class); });
    // Aplicar clase del nuevo tema
    if (theme.class) document.body.classList.add(theme.class);
    // Guardar preferencia
    localStorage.setItem('theme', themeId);
    // Marcar opción activa en el panel
    document.querySelectorAll('.theme-option').forEach(el => {
        el.classList.toggle('active', el.dataset.themeId === themeId);
    });
    const btn = document.getElementById('theme-toggle-btn');
    if (btn) {
        btn.replaceChildren();
        const iconSpan = document.createElement('span');
        iconSpan.style.cssText = 'font-size:1.25rem;line-height:1';
        iconSpan.textContent = theme.icon;
        btn.appendChild(iconSpan);
    }
}

function setupDraggableButton(btn, onClick) {
    let isPointerDown = false;
    let isDragging = false;
    let startX = 0, startY = 0;
    let initialLeft = 0, initialTop = 0;
    let hasMoved = false;
    let suppressClickUntil = 0;

    const isMobile = window.innerWidth <= 991.98;
    const DRAG_THRESHOLD = isMobile ? 18 : 12;

    function getCoords(e) {
        if (e.touches && e.touches.length > 0) {
            return { x: e.touches[0].clientX, y: e.touches[0].clientY };
        }
        if (e.changedTouches && e.changedTouches.length > 0) {
            return { x: e.changedTouches[0].clientX, y: e.changedTouches[0].clientY };
        }
        return { x: e.clientX, y: e.clientY };
    }

    function onDown(e) {
        if (e.button !== undefined && e.button !== 0) return;
        const coords = getCoords(e);
        startX = coords.x;
        startY = coords.y;

        const rect = btn.getBoundingClientRect();
        initialLeft = rect.left;
        initialTop = rect.top;
        hasMoved = false;
        isDragging = false;
        isPointerDown = true;

        window.addEventListener('mousemove', onMove, { passive: false });
        window.addEventListener('touchmove', onMove, { passive: false });
        window.addEventListener('mouseup', onUp);
        window.addEventListener('touchend', onUp);
        window.addEventListener('touchcancel', onCancel);
    }

    function onMove(e) {
        if (!isPointerDown) return;
        const coords = getCoords(e);
        const dx = coords.x - startX;
        const dy = coords.y - startY;
        const dist = Math.hypot(dx, dy);

        if (dist > DRAG_THRESHOLD) {
            hasMoved = true;
            isDragging = true;
            if (e.cancelable) e.preventDefault();

            let newLeft = initialLeft + dx;
            let newTop = initialTop + dy;

            const maxLeft = window.innerWidth - btn.offsetWidth - 8;
            const maxTop = window.innerHeight - btn.offsetHeight - 8;
            newLeft = Math.max(8, Math.min(newLeft, maxLeft));
            newTop = Math.max(8, Math.min(newTop, maxTop));

            btn.classList.add('is-dragged');
            btn.style.setProperty('left', `${newLeft}px`, 'important');
            btn.style.setProperty('top', `${newTop}px`, 'important');
            btn.style.setProperty('right', 'auto', 'important');
            btn.style.setProperty('bottom', 'auto', 'important');
            btn.style.transition = 'none';
        }
    }

    function onUp(e) {
        if (!isPointerDown) return;
        isPointerDown = false;
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('touchmove', onMove);
        window.removeEventListener('mouseup', onUp);
        window.removeEventListener('touchend', onUp);
        window.removeEventListener('touchcancel', onCancel);

        btn.style.transition = '';

        if (!hasMoved) {
            suppressClickUntil = Date.now() + 600;
            if (e && e.cancelable && e.type === 'touchend') {
                try { e.preventDefault(); } catch(err) {}
            }
            if (typeof onClick === 'function') onClick();
        } else {
            try {
                const rect = btn.getBoundingClientRect();
                localStorage.setItem('theme_btn_left', Math.round(rect.left));
                localStorage.setItem('theme_btn_top', Math.round(rect.top));
            } catch(err) {}
            suppressClickUntil = Date.now() + 400;
            setTimeout(() => {
                hasMoved = false;
                isDragging = false;
            }, 120);
        }
    }

    function onCancel() {
        isPointerDown = false;
        isDragging = false;
        hasMoved = false;
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('touchmove', onMove);
        window.removeEventListener('mouseup', onUp);
        window.removeEventListener('touchend', onUp);
        window.removeEventListener('touchcancel', onCancel);
        btn.style.transition = '';
    }

    btn.addEventListener('mousedown', onDown);
    btn.addEventListener('touchstart', onDown, { passive: false });

    btn.addEventListener('click', (e) => {
        if (hasMoved || isDragging || Date.now() < suppressClickUntil) {
            e.preventDefault();
            e.stopPropagation();
            return;
        }
        suppressClickUntil = Date.now() + 500;
        if (typeof onClick === 'function') onClick();
    });
}

function addThemeToggle() {
    // Limpiar instancias previas
    const existingBtn = document.getElementById('theme-toggle-btn');
    if (existingBtn) existingBtn.remove();
    const existingPanel = document.getElementById('theme-picker-panel');
    if (existingPanel) existingPanel.remove();
    const existingBackdrop = document.getElementById('theme-picker-backdrop');
    if (existingBackdrop) existingBackdrop.remove();

    // --- Backdrop oscurecedor suave ---
    const backdrop = document.createElement('div');
    backdrop.id = 'theme-picker-backdrop';
    backdrop.className = 'theme-picker-backdrop';
    document.body.appendChild(backdrop);

    // --- Ventana Flotante Selector de Temas ---
    const win = document.createElement('div');
    win.id = 'theme-picker-panel';
    win.className = 'theme-floating-window';

    const header = document.createElement('div');
    header.className = 'theme-window-header';
    const title = document.createElement('div');
    title.className = 'theme-window-title';
    const titleIcon = document.createElement('i');
    titleIcon.className = 'bi bi-palette2';
    title.appendChild(titleIcon);
    const titleSpan = document.createElement('span');
    titleSpan.textContent = 'Selector de Tema';
    title.appendChild(titleSpan);
    header.appendChild(title);

    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'theme-window-close';
    closeBtn.id = 'theme-window-close-btn';
    closeBtn.setAttribute('aria-label', 'Cerrar ventana');
    const closeIcon = document.createElement('i');
    closeIcon.className = 'bi bi-x-lg';
    closeBtn.appendChild(closeIcon);
    header.appendChild(closeBtn);
    win.appendChild(header);

    const body = document.createElement('div');
    body.className = 'theme-window-body';
    const grid = document.createElement('div');
    grid.className = 'theme-options-grid';
    grid.id = 'theme-options-grid';
    body.appendChild(grid);
    win.appendChild(body);

    THEMES.forEach(theme => {
        const opt = document.createElement('div');
        opt.className = 'theme-option';
        opt.dataset.themeId = theme.id;

        const swatch = document.createElement('div');
        swatch.className = 'theme-swatch';
        swatch.style.background = theme.swatch;
        opt.appendChild(swatch);

        const info = document.createElement('div');
        info.className = 'theme-option-info';
        const label = document.createElement('span');
        label.className = 'theme-option-label';
        label.textContent = `${theme.icon} ${theme.label}`;
        info.appendChild(label);
        opt.appendChild(info);

        const checkIcon = document.createElement('i');
        checkIcon.className = 'bi bi-check-circle-fill theme-check-icon';
        opt.appendChild(checkIcon);

        opt.addEventListener('click', () => {
            applyTheme(theme.id);
        });
        grid.appendChild(opt);
    });
    document.body.appendChild(win);

    const btn = document.createElement('button');
    btn.id = 'theme-toggle-btn';
    btn.className = 'theme-toggle-btn';
    btn.setAttribute('aria-label', 'Cambiar tema');
    btn.setAttribute('title', 'Personalizar tema visual');

    // Restaurar posición personalizada si el usuario lo movió
    try {
        const savedL = localStorage.getItem('theme_btn_left');
        const savedT = localStorage.getItem('theme_btn_top');
        if (savedL !== null && savedT !== null) {
            const l = parseFloat(savedL);
            const t = parseFloat(savedT);
            if (!isNaN(l) && !isNaN(t) && l >= 0 && l < window.innerWidth - 30 && t >= 0 && t < window.innerHeight - 30) {
                btn.classList.add('is-dragged');
                btn.style.setProperty('left', `${l}px`, 'important');
                btn.style.setProperty('top', `${t}px`, 'important');
                btn.style.setProperty('right', 'auto', 'important');
                btn.style.setProperty('bottom', 'auto', 'important');
            }
        }
    } catch(err) {}

    let windowOpen = false;
    let lastOpenTime = 0;

    function positionThemeWindow() {
        if (window.innerWidth <= 991.98) {
            win.style.left = '';
            win.style.right = '';
            win.style.top = '';
            win.style.bottom = '';
            return;
        }

        const rect = btn.getBoundingClientRect();
        const winWidth = 320;
        const winHeight = win.offsetHeight || 420;
        const padding = 16;

        // Eje Horizontal: si el botón está a la izquierda, ventana anclada a la izquierda
        if (rect.left + rect.width / 2 < window.innerWidth / 2) {
            let leftPos = Math.max(padding, rect.left);
            if (leftPos + winWidth > window.innerWidth - padding) {
                leftPos = window.innerWidth - winWidth - padding;
            }
            win.style.left = `${leftPos}px`;
            win.style.right = 'auto';
        } else {
            let rightPos = Math.max(padding, window.innerWidth - rect.right);
            if (rightPos + winWidth > window.innerWidth - padding) {
                rightPos = window.innerWidth - winWidth - padding;
            }
            win.style.right = `${rightPos}px`;
            win.style.left = 'auto';
        }

        // Eje Vertical: preferir arriba del botón
        if (rect.top >= winHeight + 16) {
            win.style.bottom = `${window.innerHeight - rect.top + 12}px`;
            win.style.top = 'auto';
        } else if (window.innerHeight - rect.bottom >= winHeight + 16) {
            win.style.top = `${rect.bottom + 12}px`;
            win.style.bottom = 'auto';
        } else {
            const topPos = Math.max(padding, Math.min(window.innerHeight - winHeight - padding, rect.top - winHeight / 2));
            win.style.top = `${topPos}px`;
            win.style.bottom = 'auto';
        }
    }

    function openThemeWindow() {
        lastOpenTime = Date.now();
        positionThemeWindow();
        windowOpen = true;
        win.classList.add('open');
        backdrop.classList.add('open');
        btn.classList.add('active');
    }

    function closeThemeWindow() {
        windowOpen = false;
        win.classList.remove('open');
        backdrop.classList.remove('open');
        btn.classList.remove('active');
    }

    window.addEventListener('resize', () => {
        if (windowOpen) positionThemeWindow();
    });

    if (closeBtn) {
        closeBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            closeThemeWindow();
        });
    }

    backdrop.addEventListener('click', (e) => {
        // Si se abrió hace menos de 450ms, ignorar: es el click fantasma que Android envía tras touchend
        if (Date.now() - lastOpenTime < 450) return;
        if (windowOpen) closeThemeWindow();
    });

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && windowOpen) {
            closeThemeWindow();
        }
    });

    // Soporte para arrastrar y hacer clic con respuesta inmediata
    setupDraggableButton(btn, () => {
        if (windowOpen) closeThemeWindow();
        else openThemeWindow();
    });

    document.body.appendChild(btn);

    // Aplicar tema guardado (o dark por defecto)
    const savedTheme = localStorage.getItem('theme') || 'dark';
    applyTheme(savedTheme);
}

// Función para inicializar cuando el DOM esté listo
function animateStaticCards() {
    const cards = document.querySelectorAll('.card');
    cards.forEach((card, i) => {
        card.style.animationDelay = `${i * 80}ms`;
        card.classList.add('card-appear');
    });
}

function initGlobalConfig() {
    addThemeToggle();
    animateStaticCards();
    if (typeof db !== 'undefined') {
        globalConfigManager.init();
    } else {
        // Esperar a que Firebase esté disponible
        setTimeout(initGlobalConfig, 100);
    }
}

document.addEventListener('siteNavReady', () => {
    if (globalConfigManager.initialized) {
        globalConfigManager.applyModuleVisibility();
        globalConfigManager.updateNavigationLinks();
    }
});

// Inicializar cuando el DOM esté listo
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initGlobalConfig);
} else {
    initGlobalConfig();
}

// ── GESTIÓN GLOBAL DE TÉCNICO ACTIVO (ANDON 4.0) ───────────────────────────
window.getActiveTechnician = function(contextData = null) {
    if (contextData) {
        const fromContext = contextData.maintenanceByName || contextData.technician || contextData.assignedTechnician || contextData.resolvedBy;
        if (fromContext && typeof fromContext === 'string' && fromContext.trim() && fromContext !== 'admin' && fromContext !== 'Sistema Web' && fromContext !== '-') {
            return fromContext.trim();
        }
    }
    const fromSession = sessionStorage.getItem('active_technician_name') || sessionStorage.getItem('username');
    if (fromSession && fromSession !== 'admin' && fromSession !== 'Sistema Web') {
        return fromSession.trim();
    }
    const fromLocal = localStorage.getItem('active_technician_name') || localStorage.getItem('last_technician_name');
    if (fromLocal && fromLocal !== 'admin' && fromLocal !== 'Sistema Web') {
        return fromLocal.trim();
    }
    const fbUser = (typeof firebase !== 'undefined' && firebase.auth && firebase.auth().currentUser) ? firebase.auth().currentUser.displayName : null;
    if (fbUser && fbUser.trim()) {
        return fbUser.trim();
    }
    return '';
};

window.setActiveTechnician = function(name) {
    if (!name || typeof name !== 'string') return;
    const cleanName = name.trim();
    if (!cleanName || cleanName === 'admin' || cleanName === 'Sistema Web' || cleanName === '-') return;
    try {
        sessionStorage.setItem('active_technician_name', cleanName);
        localStorage.setItem('active_technician_name', cleanName);
        localStorage.setItem('last_technician_name', cleanName);
        if (!sessionStorage.getItem('username') || sessionStorage.getItem('username') === 'admin' || sessionStorage.getItem('username') === 'Sistema Web') {
            sessionStorage.setItem('username', cleanName);
        }
    } catch (e) {}
    if (typeof addUserName === 'function') {
        try { addUserName(cleanName); } catch (e) {}
    }
};

// ── SCADA TOPOLOGY & NOMENCLATURE MANAGER (ISA-101 / SCADA 4.0) ───────────
(function(window) {
    'use strict';

    const DEFAULT_AREAS = {
        area5: { label: 'Área 5 • Recepción & Materia Prima', code: '5' },
        area10: { label: 'Área 10 • Nave Norte (Mecanizado & Subensamble)', code: '10' },
        area20: { label: 'Área 20 • Nave Troncal Central (Línea Principal)', code: '20' },
        area30: { label: 'Área 30 • Nave Sur (Ensamble Final & Pruebas)', code: '30' },
        area35: { label: 'Área 35+ • Almacén Automatizado & Embarque', code: '35' }
    };

    const DEFAULT_OPERATIONS = {
        '5': 'Recepción de Materia Prima',
        '10.01': 'Corte y Cizallado',
        '10.02': 'Prensa Hidráulica',
        '10.03': 'Mecanizado CNC 1',
        '10.04': 'Mecanizado CNC 2',
        '10.05': 'Subensamble Estructural',
        '10.06': 'Subensamble Auxiliar',
        '10.07': 'Inspección Dimensional',
        '10.08': 'Lavado Industrial',
        '10.09': 'Kitting & Preparación',
        '10.10': 'Buffer Intermedio',
        '20.01': 'Montaje Chasis',
        '20.02': 'Soldadura Robótica 1',
        '20.03': 'Soldadura Robótica 2',
        '20.04': 'Inspección NDT',
        '20.05': 'Pintura & Fondo',
        '20.06': 'Horno de Secado',
        '20.07': 'Montaje Mecánico Principal',
        '20.08': 'Instalación Hidráulica',
        '20.09': 'Circuito Neumático',
        '20.10': 'Pre-cableado Troncal',
        '20.11': 'Torque Crítico',
        '20.12': 'Control de Calidad Troncal',
        '20.13': 'Transferencia a Línea Final',
        '30.01': 'Tableros de Potencia',
        '30.02': 'PLC & Control Automatizado',
        '30.03': 'Programación & I/O',
        '30.04': 'Calibración de Sensores',
        '30.05': 'Prueba Hi-Pot & Dieléctrica',
        '30.06': 'Prueba de Carga Estática',
        '30.07': 'Prueba Dinámica de Motores',
        '30.08': 'Seguridades & Paro E-Stop',
        '30.09': 'Auditoría Final QA',
        '30.10': 'Liberación y Embalaje',
        '35': 'Almacén Automatizado',
        '35.01': 'Silos & Picking',
        '35.02': 'Rampa de Embarque',
        '40': 'Inspección de Salida',
        '50': 'Consolidación de Carga',
        '65': 'Logística Inversa',
        '70': 'Patio de Maniobras'
    };

    class HermesTopologyManager {
        constructor() {
            this.areas = JSON.parse(JSON.stringify(DEFAULT_AREAS));
            this.operations = JSON.parse(JSON.stringify(DEFAULT_OPERATIONS));
            this.isListening = false;
            this.loadFromCache();
            this.initFirestore();
        }

        loadFromCache() {
            try {
                const cachedV2 = localStorage.getItem('hermes_plant_topology_config_v2');
                if (cachedV2) {
                    const parsed = JSON.parse(cachedV2);
                    if (parsed.areas) this.mergeAreas(parsed.areas);
                    if (parsed.operations) this.operations = { ...this.operations, ...parsed.operations };
                    return;
                }
                const legacy = localStorage.getItem('hermes_plant_topology_labels');
                if (legacy) {
                    const parsedLegacy = JSON.parse(legacy);
                    this.mergeAreas(parsedLegacy);
                }
            } catch (e) {
                console.warn('[HermesTopology] Error leyendo caché local:', e);
            }
        }

        saveToCache() {
            try {
                const payload = { areas: this.areas, operations: this.operations };
                localStorage.setItem('hermes_plant_topology_config_v2', JSON.stringify(payload));
                localStorage.setItem('hermes_plant_topology_labels', JSON.stringify(this.areas));
            } catch (e) {}
        }

        mergeAreas(sourceAreas) {
            if (!sourceAreas || typeof sourceAreas !== 'object') return;
            Object.keys(sourceAreas).forEach(k => {
                const normalized = k.toLowerCase().replace('plus', '');
                const targetKey = normalized.startsWith('area') ? normalized : `area${normalized}`;
                if (this.areas[targetKey] && sourceAreas[k] && sourceAreas[k].label) {
                    this.areas[targetKey].label = sourceAreas[k].label;
                }
            });
        }

        initFirestore() {
            if (this.isListening) return;
            const attachListener = () => {
                if (typeof firebase === 'undefined' || !firebase.firestore) {
                    setTimeout(attachListener, 300);
                    return;
                }
                try {
                    const dbInstance = firebase.firestore();
                    dbInstance.collection('config').doc('plant_topology_config').onSnapshot(doc => {
                        if (doc && doc.exists) {
                            const data = doc.data() || {};
                            let changed = false;

                            // Actualizar áreas
                            Object.keys(data).forEach(key => {
                                if (key === 'operations') {
                                    if (data.operations && typeof data.operations === 'object') {
                                        this.operations = { ...this.operations, ...data.operations };
                                        changed = true;
                                    }
                                } else if (this.areas[key] && data[key] && data[key].label) {
                                    if (this.areas[key].label !== data[key].label) {
                                        this.areas[key].label = data[key].label;
                                        changed = true;
                                    }
                                }
                            });

                            if (changed) {
                                this.saveToCache();
                                this.broadcastUpdate();
                            }
                        }
                    }, err => {
                        console.warn('[HermesTopology] Listener Firestore warning:', err.message);
                    });
                    this.isListening = true;
                } catch (e) {
                    setTimeout(attachListener, 1000);
                }
            };

            if (document.readyState === 'loading') {
                document.addEventListener('DOMContentLoaded', attachListener);
            } else {
                attachListener();
            }
        }

        broadcastUpdate() {
            window.dispatchEvent(new CustomEvent('plant_topology_updated', {
                detail: { areas: this.areas, operations: this.operations }
            }));
        }

        normalizeAreaKey(keyOrCode) {
            if (!keyOrCode) return 'area5';
            let str = String(keyOrCode).trim().toLowerCase();
            str = str.replace('plus', '');
            if (!str.startsWith('area')) str = 'area' + str;
            return str;
        }

        getAreaLabel(keyOrCode) {
            const key = this.normalizeAreaKey(keyOrCode);
            if (this.areas[key] && this.areas[key].label) {
                return this.areas[key].label;
            }
            if (key === 'area35') return this.areas.area35 ? this.areas.area35.label : 'Área 35+ • Almacén Automatizado & Embarque';
            const num = key.replace('area', '');
            return `Área ${num}`;
        }

        getAreaShortLabel(keyOrCode) {
            const full = this.getAreaLabel(keyOrCode);
            if (full.includes('•')) {
                return full.split('•')[1].trim();
            }
            return full;
        }

        getOperationName(opId) {
            if (!opId) return '';
            const cleanId = String(opId).trim();
            return this.operations[cleanId] || '';
        }

        getOperationFullTitle(opId) {
            const name = this.getOperationName(opId);
            return name ? `Op ${opId} • ${name}` : `Operación ${opId}`;
        }

        getAreasMap() {
            return { ...this.areas };
        }

        getOperationsMap() {
            return { ...this.operations };
        }

        openEditModal(activeTab = 'areas') {
            let modalEl = document.getElementById('modalEditPlantAreas');
            if (!modalEl) {
                modalEl = document.createElement('div');
                modalEl.id = 'modalEditPlantAreas';
                modalEl.className = 'modal fade';
                modalEl.setAttribute('tabindex', '-1');
                document.body.appendChild(modalEl);
            }

            const areasRows = Object.entries(this.areas).map(([key, bay]) => {
                return `
                    <div class="mb-3">
                        <label class="form-label text-info font-mono small mb-1 fw-bold">
                            <i class="bi bi-geo-alt-fill me-1"></i> ${key.toUpperCase()} (Código ${bay.code})
                        </label>
                        <div class="input-group input-group-sm">
                            <span class="input-group-text bg-dark border-secondary text-secondary font-mono">${bay.code}</span>
                            <input type="text" class="form-control bg-dark border-secondary text-white font-mono" id="editArea_${key}" value="${bay.label.replace(/"/g, '&quot;')}" placeholder="Nombre de nave o área (ej. Área 5 • Recepción & Materia Prima)...">
                        </div>
                    </div>
                `;
            }).join('');

            const sortedOps = Object.keys(this.operations).sort((a, b) => {
                const parseNum = s => parseFloat(s) || 999;
                return parseNum(a) - parseNum(b);
            });

            const opsRows = sortedOps.map(opId => {
                const opName = this.operations[opId] || '';
                const mainArea = opId.split('.')[0];
                return `
                    <div class="mb-2 scada-modal-op-item" data-op-id="${opId}" data-search="${opId.toLowerCase()} ${opName.toLowerCase()}">
                        <div class="input-group input-group-sm">
                            <span class="input-group-text bg-dark border-secondary text-info font-mono fw-bold" style="width:72px;">Op ${opId}</span>
                            <input type="text" class="form-control bg-dark border-secondary text-white font-mono" id="editOp_${opId.replace('.', '_')}" value="${opName.replace(/"/g, '&quot;')}" placeholder="Nombre descriptivo de la estación...">
                        </div>
                    </div>
                `;
            }).join('');

            modalEl.innerHTML = `
                <div class="modal-dialog modal-dialog-centered modal-lg">
                    <div class="modal-content bg-dark border border-secondary border-opacity-50 text-white shadow-lg">
                        <div class="modal-header border-bottom border-secondary border-opacity-25 py-3">
                            <div class="d-flex align-items-center gap-2">
                                <i class="bi bi-pencil-square text-info fs-5"></i>
                                <div>
                                    <h5 class="modal-title mb-0 fw-bold" style="font-size:1.05rem;">Personalizar Nombres y Textos de Planta</h5>
                                    <small class="text-secondary font-mono">Modifica la denominación de naves, áreas y estaciones de trabajo</small>
                                </div>
                            </div>
                            <button type="button" class="btn-close btn-close-white" data-bs-dismiss="modal" aria-label="Cerrar"></button>
                        </div>
                        <div class="modal-body p-4">
                            <div class="alert alert-info bg-dark bg-opacity-75 border-info border-opacity-25 text-white small mb-3">
                                <i class="bi bi-info-circle-fill text-info me-2"></i>
                                Los textos son <strong>completamente editables</strong> (ej. <em>Recepción de Materia Prima</em>, <em>Nave Norte</em>, etc.). Se sincronizan en tiempo real vía Firestore con todos los monitores y Smart TVs.
                            </div>

                            <!-- Pestañas de Navegación -->
                            <ul class="nav nav-tabs border-secondary border-opacity-25 mb-3" role="tablist">
                                <li class="nav-item" role="presentation">
                                    <button class="nav-link ${activeTab === 'areas' ? 'active' : ''} text-white font-mono small" id="tab-top-areas" data-bs-toggle="tab" data-bs-target="#panel-top-areas" type="button" role="tab">
                                        <i class="bi bi-diagram-3-fill me-1 text-info"></i> Naves & Áreas (${Object.keys(this.areas).length})
                                    </button>
                                </li>
                                <li class="nav-item" role="presentation">
                                    <button class="nav-link ${activeTab === 'ops' ? 'active' : ''} text-white font-mono small" id="tab-top-ops" data-bs-toggle="tab" data-bs-target="#panel-top-ops" type="button" role="tab">
                                        <i class="bi bi-gear-wide-connected me-1 text-warning"></i> Estaciones & Operaciones (${sortedOps.length})
                                    </button>
                                </li>
                            </ul>

                            <div class="tab-content">
                                <!-- Panel Áreas -->
                                <div class="tab-pane fade ${activeTab === 'areas' ? 'show active' : ''}" id="panel-top-areas" role="tabpanel">
                                    <form id="formEditHermesAreas">
                                        ${areasRows}
                                    </form>
                                </div>

                                <!-- Panel Operaciones -->
                                <div class="tab-pane fade ${activeTab === 'ops' ? 'show active' : ''}" id="panel-top-ops" role="tabpanel">
                                    <div class="mb-3">
                                        <div class="input-group input-group-sm">
                                            <span class="input-group-text bg-dark border-secondary text-secondary"><i class="bi bi-search"></i></span>
                                            <input type="text" class="form-control bg-dark border-secondary text-white font-mono" id="modalOpsFilterInput" placeholder="🔍 Filtrar estaciones (ej. 5, 10.01, mecanizado, materia prima)...">
                                        </div>
                                    </div>
                                    <div class="scada-modal-ops-scroll" id="modalOpsListContainer">
                                        ${opsRows}
                                    </div>
                                </div>
                            </div>
                        </div>
                        <div class="modal-footer border-top border-secondary border-opacity-25 d-flex justify-content-between">
                            <button type="button" class="btn btn-outline-warning btn-sm font-mono" onclick="window.HermesTopology.resetDefaults()">
                                <i class="bi bi-arrow-counterclockwise"></i> Valores por Defecto
                            </button>
                            <div class="d-flex gap-2">
                                <button type="button" class="btn btn-secondary btn-sm font-mono" data-bs-dismiss="modal">
                                    Cancelar
                                </button>
                                <button type="button" class="btn btn-primary btn-sm font-mono fw-bold" id="btnSaveHermesTopology" onclick="window.HermesTopology.saveFromModal()">
                                    <i class="bi bi-check-circle-fill"></i> Guardar Cambios
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            `;

            // Enlazar filtro dinámico de operaciones
            const searchInput = modalEl.querySelector('#modalOpsFilterInput');
            if (searchInput) {
                searchInput.addEventListener('input', (e) => {
                    const q = e.target.value.toLowerCase().trim();
                    const items = modalEl.querySelectorAll('.scada-modal-op-item');
                    items.forEach(it => {
                        const searchTarget = it.getAttribute('data-search') || '';
                        it.style.display = (!q || searchTarget.includes(q)) ? '' : 'none';
                    });
                });
            }

            const bsModal = bootstrap.Modal.getOrCreateInstance(modalEl);
            bsModal.show();
            if (window.IndustrialAudio && window.IndustrialAudio.playClick) {
                window.IndustrialAudio.playClick();
            }
        }

        async saveFromModal() {
            const btn = document.getElementById('btnSaveHermesTopology');
            if (btn) {
                btn.disabled = true;
                btn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span> Guardando...';
            }

            const payloadAreas = {};
            Object.keys(this.areas).forEach(key => {
                const input = document.getElementById(`editArea_${key}`);
                if (input && input.value.trim()) {
                    this.areas[key].label = input.value.trim();
                    payloadAreas[key] = { label: input.value.trim(), code: this.areas[key].code };
                }
            });

            const payloadOps = {};
            Object.keys(this.operations).forEach(opId => {
                const input = document.getElementById(`editOp_${opId.replace('.', '_')}`);
                if (input && input.value.trim()) {
                    this.operations[opId] = input.value.trim();
                    payloadOps[opId] = input.value.trim();
                }
            });

            this.saveToCache();

            try {
                if (typeof firebase !== 'undefined' && firebase.firestore) {
                    const dbInstance = firebase.firestore();
                    await dbInstance.collection('config').doc('plant_topology_config').set({
                        ...payloadAreas,
                        operations: payloadOps
                    }, { merge: true });
                }
            } catch (err) {
                console.error('[HermesTopology] Error persistiendo a Firestore:', err);
            }

            this.broadcastUpdate();

            const modalEl = document.getElementById('modalEditPlantAreas');
            if (modalEl) {
                const bsModal = bootstrap.Modal.getInstance(modalEl);
                if (bsModal) bsModal.hide();
            }

            if (window.IndustrialAudio && window.IndustrialAudio.playResolveSuccess) {
                window.IndustrialAudio.playResolveSuccess();
            }

            if (typeof showAlert === 'function') {
                showAlert('Textos y nomenclatura de planta guardados exitosamente.', 'success');
            }
        }

        resetDefaults() {
            Object.keys(DEFAULT_AREAS).forEach(key => {
                const input = document.getElementById(`editArea_${key}`);
                if (input) input.value = DEFAULT_AREAS[key].label;
            });
            Object.keys(DEFAULT_OPERATIONS).forEach(opId => {
                const input = document.getElementById(`editOp_${opId.replace('.', '_')}`);
                if (input) input.value = DEFAULT_OPERATIONS[opId];
            });
            if (window.IndustrialAudio && window.IndustrialAudio.playClick) {
                window.IndustrialAudio.playClick();
            }
        }
    }

    window.HermesTopology = new HermesTopologyManager();
})(window);



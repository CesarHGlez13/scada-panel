(function () {
    'use strict';

    const CRANE_SVG = `<svg class="nav-svg-icon" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M6 7l2.5-4.5L11 7"/><path d="M8.5 2.5L2 7"/><path d="M8.5 2.5L16 7"/><path d="M1.5 7h21" stroke-width="1.8"/><rect x="2" y="7" width="3" height="3" rx="0.5" fill="currentColor" stroke="none"/><rect x="11" y="8" width="2" height="2.2" rx="0.3" fill="currentColor" opacity="0.4" stroke="currentColor" stroke-width="0.8"/><path d="M7 7v13.5"/><path d="M10 7v13.5"/><path d="M7 10.5h3"/><path d="M7 14h3"/><path d="M7 17.5h3"/><path d="M5.5 20.5h6" stroke-width="1.8"/><path d="M17.5 7v7" stroke-dasharray="1.5 1"/><path d="M16.5 14h2" stroke-width="1.8"/><path d="M17.5 14.8c0 0.8 0.8 0.8 0.8 0.2"/><rect x="14.5" y="16.5" width="6" height="2" rx="0.4" fill="currentColor" stroke="none"/></svg>`;

    const NAV_ITEMS = [
        { id: 'home', href: 'index.html', icon: 'bi-house-door-fill', label: 'Inicio', match: ['index.html', '/'] },
        { id: 'ops', href: 'operations.html', icon: 'bi-gear-wide-connected', label: 'Operaciones', module: 'operations', match: ['operations.html'] },
        { id: 'cranes', href: 'cranes.html', svgIcon: CRANE_SVG, label: 'Grúas', module: 'cranes', match: ['cranes.html'] },
        { id: 'warehouse', href: 'warehouse.html', icon: 'bi-box-seam', label: 'Almacén', module: 'warehouse', match: ['warehouse.html'] },
        { id: 'more', href: 'mobile.html', icon: 'bi-grid', label: 'Más', match: ['mobile.html'] }
    ];

    function isMobileViewport() {
        return window.matchMedia('(max-width: 991.98px)').matches;
    }

    function getCurrentPage() {
        const path = window.location.pathname.split('/').pop() || 'index.html';
        if (path === '' || path === '/') return 'index.html';
        return path;
    }

    function isActive(item, page) {
        if (item.id === 'home' && (page === 'index.html' || page === '')) return true;
        if (item.id === 'ops' && page === 'operations.html') return true;
        if (item.id === 'more' && page === 'mobile.html') return true;
        return item.match.some(m => page === m || page.endsWith(m));
    }

    function bindNavEvents(nav) {
        const page = getCurrentPage();
        nav.querySelectorAll('.mobile-nav-item').forEach(a => {
            const href = a.getAttribute('href');
            if (isActive({ id: a.getAttribute('data-id') || '', href: href, match: [href] }, page)) {
                a.classList.add('active');
            }
            if (a._hasNavClick) return;
            a._hasNavClick = true;

            a.addEventListener('click', (e) => {
                triggerHaptic(14);
                if (href && !a.classList.contains('active')) {
                    e.preventDefault();
                    // Inmediatamente cambiar píldora activa sin parpadeo
                    nav.querySelectorAll('.mobile-nav-item').forEach(el => el.classList.remove('active'));
                    a.classList.add('active');
                    // Iniciar transición suave sólo en el contenido
                    document.body.classList.add('page-transitioning');
                    window.location.href = href;
                }
            });
        });
    }

    function buildNav() {
        let nav = document.getElementById('mobileBottomNav');
        if (nav) {
            bindNavEvents(nav);
            return;
        }

        const page = getCurrentPage();
        nav = document.createElement('nav');
        nav.id = 'mobileBottomNav';
        nav.className = 'mobile-bottom-nav d-lg-none';
        nav.setAttribute('aria-label', 'Navegación móvil');

        const inner = document.createElement('div');
        inner.className = 'mobile-bottom-nav-inner';

        const modules = (typeof getEnabledModules === 'function') ? getEnabledModules() : { operations: true, cranes: true };

        NAV_ITEMS.forEach(item => {
            if (item.id === 'ops' && !modules.operations) return;
            if (item.id === 'cranes' && !modules.cranes) return;
            if (item.id === 'warehouse' && !modules.warehouse) return;

            const a = document.createElement('a');
            a.href = item.href;
            a.setAttribute('data-id', item.id);
            a.className = 'mobile-nav-item' + (isActive(item, page) ? ' active' : '');
            if (item.id === 'ops') a.setAttribute('data-module', 'operations');
            if (item.id === 'cranes') a.setAttribute('data-module', 'cranes');
            if (item.svgIcon) {
                const svgDoc = new DOMParser().parseFromString(item.svgIcon, 'image/svg+xml');
                const svgNode = document.importNode(svgDoc.documentElement, true);
                a.appendChild(svgNode);
            } else if (item.icon) {
                const iconEl = document.createElement('i');
                iconEl.className = `bi ${item.icon}`;
                a.appendChild(iconEl);
            }
            const labelSpan = document.createElement('span');
            labelSpan.textContent = item.label;
            a.appendChild(labelSpan);

            inner.appendChild(a);
        });

        nav.appendChild(inner);
        document.body.appendChild(nav);
        bindNavEvents(nav);
    }

    function updateBodyClass() {
        if (isMobileViewport()) {
            document.body.classList.add('has-mobile-nav');
            buildNav();
        } else {
            document.body.classList.remove('has-mobile-nav');
        }
    }

    function enhanceModalsAndTablesForMobile() {
        // 1. Modales pantalla completa en móvil (excepto diálogos centrados o login)
        document.querySelectorAll('.modal-dialog').forEach(dialog => {
            if (dialog.closest('#inventoryLoginModal') || dialog.classList.contains('modal-dialog-centered')) {
                return;
            }
            if (!dialog.classList.contains('modal-fullscreen-sm-down')) {
                dialog.classList.add('modal-fullscreen-sm-down');
            }
            if (isMobileViewport() && dialog.style.maxWidth && dialog.style.maxWidth.includes('vw')) {
                dialog.style.maxWidth = '';
            }
        });

        // 2. Tablas: aplicar clase mejorada e indicador de desplazamiento táctil
        if (isMobileViewport()) {
            // Eliminar hints duplicados si existen dentro del mismo modal o sección
            document.querySelectorAll('.modal-body, .card-body').forEach(parent => {
                const hints = parent.querySelectorAll('.mobile-scroll-hint');
                if (hints.length > 1) {
                    for (let i = 1; i < hints.length; i++) {
                        hints[i].remove();
                    }
                }
            });

            document.querySelectorAll('.table-responsive').forEach(container => {
                const table = container.querySelector('table');
                if (!table) return;

                if (!table.classList.contains('mobile-enhanced-table')) {
                    table.classList.add('mobile-enhanced-table');
                }

                // Si ya existe un hint en el contenedor padre o antes, no duplicar
                const parent = container.parentElement;
                if (parent && parent.querySelector('.mobile-scroll-hint')) return;

                const prev = container.previousElementSibling;
                if (!prev || !prev.classList.contains('mobile-scroll-hint')) {
                    const hint = document.createElement('div');
                    hint.className = 'mobile-scroll-hint d-md-none';
                    const hintIcon = document.createElement('i');
                    hintIcon.className = 'bi bi-arrow-left-right';
                    hint.appendChild(hintIcon);
                    hint.appendChild(document.createTextNode(' Desliza horizontalmente la tabla para ver todas las columnas →'));
                    container.parentNode.insertBefore(hint, container);
                }
            });
        }
    }

    document.addEventListener('DOMContentLoaded', () => {
        updateBodyClass();
        enhanceModalsAndTablesForMobile();
    });

    document.addEventListener('shown.bs.modal', () => {
        enhanceModalsAndTablesForMobile();
    });

    function syncModuleVisibility(nav) {
        if (!nav) return;
        const modules = (typeof getEnabledModules === 'function') ? getEnabledModules() : { operations: true, cranes: true, warehouse: true };
        const opsItem = nav.querySelector('[data-module="operations"]');
        if (opsItem) opsItem.style.display = modules.operations === false ? 'none' : '';
        const cranesItem = nav.querySelector('[data-module="cranes"]');
        if (cranesItem) cranesItem.style.display = modules.cranes === false ? 'none' : '';
        const whItem = nav.querySelector('[data-module="warehouse"]');
        if (whItem) whItem.style.display = modules.warehouse === false ? 'none' : '';
    }

    document.addEventListener('globalConfigReady', () => {
        const nav = document.getElementById('mobileBottomNav');
        if (nav) syncModuleVisibility(nav);
        else updateBodyClass();
        enhanceModalsAndTablesForMobile();
    });

    document.addEventListener('globalConfigUpdated', () => {
        const nav = document.getElementById('mobileBottomNav');
        if (nav) syncModuleVisibility(nav);
        else updateBodyClass();
        enhanceModalsAndTablesForMobile();
    });

    // Feedback Háptico Suave (Exclusivo App Nativa Android / Capacitor)
    function triggerHaptic(ms = 12) {
        try {
            if (window.Capacitor?.isNativePlatform?.() && window.Capacitor?.Plugins?.Haptics) {
                window.Capacitor.Plugins.Haptics.impact({ style: 'LIGHT' });
            }
        } catch (e) {}
    }

    // Efecto Onda de Cristal Líquido (Liquid Touch Ripple)
    function createLiquidRipple(e, target) {
        const rect = target.getBoundingClientRect();
        const circle = document.createElement('span');
        const diameter = Math.max(rect.width, rect.height);
        const radius = diameter / 2;

        const clientX = (e.touches && e.touches[0]) ? e.touches[0].clientX : e.clientX;
        const clientY = (e.touches && e.touches[0]) ? e.touches[0].clientY : e.clientY;

        circle.style.width = circle.style.height = `${diameter}px`;
        circle.style.left = `${(clientX || (rect.left + radius)) - rect.left - radius}px`;
        circle.style.top = `${(clientY || (rect.top + radius)) - rect.top - radius}px`;
        circle.classList.add('touch-ripple-effect');

        const existing = target.querySelector('.touch-ripple-effect');
        if (existing) existing.remove();

        target.appendChild(circle);
        setTimeout(() => circle.remove(), 620);
    }

    // Listener global para interactividad táctil
    document.addEventListener('pointerdown', (e) => {
        const target = e.target.closest('.btn, .mobile-nav-item, .mobile-hub-tile, .stat-card, .card-action, .theme-toggle-btn');
        if (target) {
            triggerHaptic(10);
            createLiquidRipple(e, target);
        }
    }, { passive: true });

    // Android hardware back button handler
    function setupAndroidBackButton() {
        if (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.App) {
            window.Capacitor.Plugins.App.addListener('backButton', () => {
                const openModal = document.querySelector('.modal.show');
                if (openModal) {
                    const modalInstance = typeof bootstrap !== 'undefined' && bootstrap.Modal.getInstance(openModal);
                    if (modalInstance) {
                        modalInstance.hide();
                        return;
                    }
                }
                const currentPage = getCurrentPage();
                if (currentPage !== 'index.html' && currentPage !== '') {
                    window.location.href = 'index.html';
                } else {
                    window.Capacitor.Plugins.App.exitApp();
                }
            });
        }
    }

    function initMobileNav() {
        updateBodyClass();
        enhanceModalsAndTablesForMobile();
    }

    window.addEventListener('resize', () => {
        updateBodyClass();
        enhanceModalsAndTablesForMobile();
    });

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initMobileNav);
    } else {
        initMobileNav();
    }

    setupAndroidBackButton();
})();

(function () {
    'use strict';

    // ── RUTAS PÚBLICAS (Exclusivas de las páginas de showcase: guia.html y sistema-andon.html) ──
    const PUBLIC_LINKS = [
        { id: 'guia', href: 'guia.html', label: 'Guía Cinemática' },
        { id: 'andon-system', href: 'sistema-andon.html', label: 'Sistema Andon 4.0' }
    ];

    // ── RUTAS DEL SISTEMA SCADA (Para todas las páginas operativas de planta) ──
    const SCADA_LINKS = [
        { id: 'dashboard', href: 'index.html', label: 'Dashboard' },
        { id: 'operations', href: 'operations.html', label: 'Operaciones', module: 'operations' },
        { id: 'cranes', href: 'cranes.html', label: 'Grúas', module: 'cranes' },
        { id: 'warehouse', href: 'warehouse.html', label: 'Almacén', module: 'warehouse' },
        { id: 'inventory', href: 'inventory.html', label: 'Inventario', module: 'warehouse' },
        { id: 'analysis', href: 'AnalisisDetallado.html?v=1.2', label: 'Análisis' },
        { id: 'andon-tv', href: 'andon-tv.html', label: 'Andon TV' },
        { id: 'guia', href: 'guia.html', label: 'Guía' },
        { id: 'andon-system', href: 'sistema-andon.html', label: 'Andon 4.0' }
    ];

    const ADMIN_LINKS = [
        { id: 'admin', href: 'admin.html', label: 'Panel de Control' },
        { id: 'technicians', href: 'admin.html#technicians-mgmt', label: 'Gestión de Técnicos' },
        { id: 'users', href: 'admin.html#users-mgmt', label: 'Gestión de Usuarios' },
        { id: 'emulator', href: 'hardware-simulator.html', label: 'Simulador Hardware' }
    ];

    function isCurrentPagePublic() {
        const rawPath = (window.location.pathname || '').toLowerCase();
        const file = rawPath.split('/').pop() || '';
        return file === 'sistema-andon.html' || file === 'guia.html';
    }

    function isUserAuthenticated() {
        return !!(window.ScadaAuth && typeof window.ScadaAuth.isAuthenticated === 'function' && window.ScadaAuth.isAuthenticated());
    }

    function isUserAdmin() {
        return !!(window.ScadaAuth && typeof window.ScadaAuth.isAdmin === 'function' && window.ScadaAuth.isAdmin());
    }

    function renderSiteNav() {
        const nav = document.getElementById('siteNavbar');
        if (!nav) return;

        const active = nav.dataset.active || '';
        const isPublicPage = isCurrentPagePublic();
        const isAuth = isUserAuthenticated();
        const isAdmin = isUserAdmin();

        // Estilo exacto original Apple de 54px glassmorphism (cero saltos entre vistas)
        nav.className = 'guia-navbar';
        nav.replaceChildren();

        const container = document.createElement('div');
        container.className = 'container-fluid d-flex align-items-center justify-content-between px-2 px-md-4';

        // 1. BRAND IZQUIERDO (SCADA PRO)
        const brandA = document.createElement('a');
        brandA.className = 'guia-nav-brand';
        brandA.href = 'index.html';
        brandA.innerHTML = `
            <i class="bi bi-speedometer2 text-primary"></i>
            <span class="brand-text">Monitor de Operaciones <span class="badge bg-primary text-white ms-1">SCADA PRO</span></span>
        `;
        container.appendChild(brandA);

        // 2. NAVEGACIÓN CENTRAL
        const linksNav = document.createElement('nav');
        linksNav.className = 'guia-nav-links d-none d-lg-flex';

        if (isPublicPage) {
            // Páginas públicas (guia.html / sistema-andon.html)
            PUBLIC_LINKS.forEach((link) => {
                const isActive = active === link.id;
                const a = document.createElement('a');
                a.className = `guia-nav-link${isActive ? ' active' : ''}`;
                a.href = link.href;
                a.textContent = link.label;
                linksNav.appendChild(a);
            });
        } else {
            // Páginas SCADA de Operación de Planta
            SCADA_LINKS.forEach((link) => {
                const isActive = active === link.id;
                const a = document.createElement('a');
                a.className = `guia-nav-link${isActive ? ' active' : ''}`;
                a.href = link.href;
                if (link.module) a.setAttribute('data-module', link.module);
                a.textContent = link.label;
                linksNav.appendChild(a);
            });

            // Menú de Admin
            const adminDropdown = document.createElement('div');
            adminDropdown.className = 'dropdown d-inline-block';
            adminDropdown.innerHTML = `
                <a class="guia-nav-link dropdown-toggle text-warning" href="#" role="button" data-bs-toggle="dropdown" aria-expanded="false">
                    Admin
                </a>
                <ul class="dropdown-menu dropdown-menu-dark shadow-lg" style="background: rgba(14,20,36,0.96); border: 1px solid rgba(255,255,255,0.12); border-radius: 12px; font-size: 0.82rem;">
                    ${ADMIN_LINKS.map(l => `<li><a class="dropdown-item py-2" href="${l.href}">${l.label}</a></li>`).join('')}
                </ul>
            `;
            linksNav.appendChild(adminDropdown);
        }

        container.appendChild(linksNav);

        // 3. SECCIÓN DERECHA
        const rightDiv = document.createElement('div');
        rightDiv.id = 'siteNavbarRight';
        rightDiv.className = 'd-flex align-items-center gap-2';

        if (isPublicPage) {
            // En páginas públicas: Botón de acción hacia el SCADA
            const ctaBtn = document.createElement('a');
            ctaBtn.className = 'guia-nav-btn';
            ctaBtn.href = 'index.html';
            ctaBtn.innerHTML = isAuth 
                ? '<span>Ir al SCADA Vivo</span> <i class="bi bi-speedometer2 ms-1"></i>' 
                : '<span>Ir al Sistema</span> <i class="bi bi-arrow-right ms-1"></i>';
            ctaBtn.onclick = (e) => {
                if (!isAuth && window.ScadaAuth && typeof window.ScadaAuth.openAuthModal === 'function') {
                    e.preventDefault();
                    window.ScadaAuth.openAuthModal('login');
                }
            };
            rightDiv.appendChild(ctaBtn);
        } else {
            // En páginas operativas SCADA:
            // Botón de Búsqueda Universal / Command Palette (Ctrl+K)
            const searchBtn = document.createElement('button');
            searchBtn.type = 'button';
            searchBtn.className = 'btn btn-outline-secondary btn-sm d-flex align-items-center gap-1 text-white border-0';
            searchBtn.style.cssText = 'background: rgba(255,255,255,0.06); padding: 5px 10px; border-radius: 980px; font-size: 0.8rem;';
            searchBtn.innerHTML = '<i class="bi bi-search text-info"></i> <span class="d-none d-md-inline text-muted" style="font-size:0.7rem;"><kbd style="background:transparent;color:#94a3b8;">Ctrl+K</kbd></span>';
            searchBtn.title = 'Búsqueda Global y Comandos Rápidos (Ctrl+K)';
            searchBtn.onclick = () => { if (window.openCommandPalette) window.openCommandPalette(); };
            rightDiv.appendChild(searchBtn);

            // Botón de Reporte de Entrega de Guardia
            const handoverBtn = document.createElement('button');
            handoverBtn.type = 'button';
            handoverBtn.className = 'btn btn-outline-info btn-sm d-flex align-items-center gap-1';
            handoverBtn.style.cssText = 'padding: 5px 12px; border-radius: 980px; font-size: 0.8rem; font-weight: 600;';
            handoverBtn.innerHTML = '<i class="bi bi-clipboard-data"></i> <span class="d-none d-sm-inline">Entrega Guardia</span>';
            handoverBtn.title = 'Generar Reporte de Entrega de Guardia';
            handoverBtn.onclick = () => { if (window.openShiftHandoverModal) window.openShiftHandoverModal(); };
            rightDiv.appendChild(handoverBtn);

            // Si ScadaAuth ya tiene sesión resuelta, actualizar indicador
            if (window.ScadaAuth && typeof window.ScadaAuth.updateNavbarIndicator === 'function') {
                window.ScadaAuth.updateNavbarIndicator();
            }
        }

        container.appendChild(rightDiv);
        nav.appendChild(container);

        document.dispatchEvent(new CustomEvent('siteNavReady'));
    }

    window.renderSiteNav = renderSiteNav;

    // Reactividad ante login/logout o carga de ScadaAuth
    document.addEventListener('scadaAuthChanged', renderSiteNav);

    if (document.getElementById('siteNavbar')) {
        renderSiteNav();
    } else if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', renderSiteNav);
    } else {
        renderSiteNav();
    }
})();

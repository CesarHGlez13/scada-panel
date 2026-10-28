/**
 * QUICK UNIVERSAL SEARCH & COMMAND PALETTE (CTRL + K)
 * Operations Monitor Industrial SCADA
 * 
 * Búsqueda instantánea de grúas, estaciones, refacciones de inventario,
 * técnicos de guardia y comandos rápidos de sala de control.
 */

(function () {
  'use strict';

  let paletteModal = null;
  let cachedSearchData = null;
  let activeIndex = 0;

  // Acciones fijas de sala de control
  const STATIC_ACTIONS = [
    { title: 'Personalizar Nombres y Textos de Planta (Topología SCADA)', category: 'Configuración', icon: 'bi-pencil-square', action: () => { window.HermesTopology && window.HermesTopology.openEditModal(); } },
    { title: 'Generar Reporte de Entrega de Guardia (Handover)', category: 'Acción Rápida', icon: 'bi-clipboard-data-fill', action: () => { window.openShiftHandoverModal && window.openShiftHandoverModal(); } },
    { title: 'Configurar Alerta y Vibración Háptica de Técnico', category: 'Acción Rápida', icon: 'bi-bell-fill', action: () => { window.openTechAlertsModal && window.openTechAlertsModal(); } },
    { title: 'Ver Análisis Detallado (MTTR, Telemetría y Eficiencia)', category: 'Navegación', icon: 'bi-graph-up', href: 'AnalisisDetallado.html' },
    { title: 'Gestión de Grúas e Iluminación SCADA', category: 'Navegación', icon: 'bi-tools', href: 'cranes.html' },
    { title: 'Monitoreo de Operaciones y Paros de Línea', category: 'Navegación', icon: 'bi-gear-wide-connected', href: 'operations.html' },
    { title: 'Almacén Pick-to-Light y Picking', category: 'Navegación', icon: 'bi-box-seam', href: 'warehouse.html' },
    { title: 'Sistema de Inventario de Refacciones', category: 'Navegación', icon: 'bi-boxes', href: 'inventory.html' },
    { title: 'Emulador de Hardware (ESP32 / SCADA)', category: 'Herramientas', icon: 'bi-cpu', href: 'hardware-simulator.html' },
    { title: 'Panel de Administración y Rotación Inteligente', category: 'Administración', icon: 'bi-shield-lock', href: 'admin.html#technicians-mgmt' }
  ];

  async function loadSearchIndex() {
    if (cachedSearchData) return cachedSearchData;
    const items = [...STATIC_ACTIONS];

    if (typeof db !== 'undefined' && db) {
      try {
        // Cargar grúas
        const cranes = [
          { id: '10A', area: 'Área 10' }, { id: '10B', area: 'Área 10' }, { id: '10C', area: 'Área 10' }, { id: '10D', area: 'Área 10' },
          { id: '20A', area: 'Área 20' }, { id: '20B', area: 'Área 20' }, { id: '20C', area: 'Área 20' }, { id: '20D', area: 'Área 20' }, { id: '20E', area: 'Área 20' }, { id: '20F', area: 'Área 20' },
          { id: '30A', area: 'Área 30' }, { id: '30B', area: 'Área 30' }, { id: '30C', area: 'Área 30' }, { id: '30D', area: 'Área 30' }
        ];
        cranes.forEach(c => {
          items.push({
            title: `Grúa ${c.id} (${c.area})`,
            category: 'Grúas',
            icon: 'bi-truck',
            href: `cranes.html#${c.id}`
          });
        });

        // Cargar refacciones de inventario
        try {
          const invSnap = await db.collection('inventory').limit(60).get();
          invSnap.forEach(doc => {
            const d = doc.data();
            const name = d.name || d.description || doc.id;
            const stock = d.stock ?? d.quantity ?? 0;
            items.push({
              title: `${name} [Stock: ${stock}]`,
              category: 'Inventario / Refacciones',
              icon: 'bi-box-seam',
              href: `inventory.html?item=${doc.id}`
            });
          });
        } catch (e) {}

        // Cargar técnicos de config/technicians
        try {
          const techDoc = await db.collection('config').doc('technicians').get();
          if (techDoc.exists && typeof window.parseRosterFromDoc === 'function') {
            const roster = window.parseRosterFromDoc(techDoc.data());
            roster.forEach(t => {
              items.push({
                title: `${t.name} (Técnico · Área ${t.area} · Jornada ${t.shift})`,
                category: 'Personal / Guardia',
                icon: 'bi-person-badge',
                href: 'admin.html#technicians-mgmt'
              });
            });
          }
        } catch (e) {}

        // Cargar estaciones y operaciones desde HermesTopology
        if (window.HermesTopology && typeof window.HermesTopology.getOperationsMap === 'function') {
          const opsMap = window.HermesTopology.getOperationsMap();
          Object.entries(opsMap).forEach(([opId, opName]) => {
            items.push({
              title: `Operación ${opId} • ${opName}`,
              category: 'Operaciones',
              icon: 'bi-gear-wide-connected',
              href: 'operations.html'
            });
          });
        }
      } catch (err) {
        console.warn('[CommandPalette] Error construyendo índice:', err.message);
      }
    }

    cachedSearchData = items;
    return items;
  }

  function createPaletteModal() {
    let el = document.getElementById('scadaCommandPaletteModal');
    if (!el) {
      el = document.createElement('div');
      el.id = 'scadaCommandPaletteModal';
      el.style.cssText = `
        position: fixed;
        top: 0; left: 0; width: 100%; height: 100%;
        background: rgba(0, 0, 0, 0.75);
        backdrop-filter: blur(14px);
        z-index: 10090;
        display: none;
        align-items: flex-start;
        justify-content: center;
        padding-top: 10vh;
      `;

      el.innerHTML = `
        <div style="background: #0f172a; border: 1px solid rgba(255,255,255,0.2); border-radius: 20px; width: 92%; max-width: 620px; box-shadow: 0 25px 60px rgba(0,0,0,0.9); overflow: hidden; display: flex; flex-direction: column;">
          
          <div style="padding: 16px 20px; border-bottom: 1px solid rgba(255,255,255,0.1); display: flex; align-items: center; gap: 12px;">
            <i class="bi bi-search text-info" style="font-size: 1.25rem;"></i>
            <input type="text" id="paletteSearchInput" placeholder="Buscar grúa, estación, refacción, técnico o acción... (Esc para salir)" 
              style="background: transparent; border: none; color: #fff; font-size: 1.05rem; width: 100%; outline: none;" autocomplete="off">
            <span class="badge bg-secondary font-monospace" style="font-size: 0.7rem;">ESC</span>
          </div>

          <div id="paletteResultsList" style="max-height: 50vh; overflow-y: auto; padding: 10px 8px;">
            <!-- Resultados -->
          </div>

          <div style="padding: 10px 18px; border-top: 1px solid rgba(255,255,255,0.08); background: rgba(0,0,0,0.3); display: flex; justify-content: space-between; font-size: 0.72rem; color: #64748b;">
            <span><kbd style="background:#1e293b; color:#94a3b8; border:1px solid #334155;">↑</kbd> <kbd style="background:#1e293b; color:#94a3b8; border:1px solid #334155;">↓</kbd> Navegar</span>
            <span><kbd style="background:#1e293b; color:#94a3b8; border:1px solid #334155;">ENTER</kbd> Seleccionar</span>
            <span><kbd style="background:#1e293b; color:#94a3b8; border:1px solid #334155;">CTRL + K</kbd> Abrir / Cerrar</span>
          </div>

        </div>
      `;

      el.addEventListener('click', (e) => {
        if (e.target === el) closeCommandPalette();
      });

      document.body.appendChild(el);

      const input = el.querySelector('#paletteSearchInput');
      input.addEventListener('input', () => filterAndRenderResults(input.value));
      input.addEventListener('keydown', handleKeyNavigation);
    }
    return el;
  }

  let filteredItems = [];

  function filterAndRenderResults(query = '') {
    const listEl = document.getElementById('paletteResultsList');
    if (!listEl || !cachedSearchData) return;

    const q = query.toLowerCase().trim();
    filteredItems = q === '' 
      ? cachedSearchData.slice(0, 10)
      : cachedSearchData.filter(item => 
          item.title.toLowerCase().includes(q) || 
          item.category.toLowerCase().includes(q)
        ).slice(0, 15);

    activeIndex = 0;

    if (filteredItems.length === 0) {
      listEl.innerHTML = `<div class="p-4 text-center text-muted small">No se encontraron resultados para "<b>${escapeHtml(query)}</b>"</div>`;
      return;
    }

    listEl.innerHTML = filteredItems.map((item, idx) => `
      <div class="palette-item p-2 px-3 rounded-3 d-flex align-items-center justify-content-between mb-1" data-index="${idx}"
        style="cursor: pointer; transition: background 0.15s ease; ${idx === 0 ? 'background: rgba(56, 189, 248, 0.15); border-left: 3px solid #38bdf8;' : 'border-left: 3px solid transparent;'}"
        onclick="window.executePaletteIndex(${idx})">
        <div class="d-flex align-items-center gap-3">
          <i class="bi ${item.icon} text-info" style="font-size: 1.15rem;"></i>
          <div>
            <div class="text-white small fw-semibold">${escapeHtml(item.title)}</div>
            <div class="text-muted" style="font-size: 0.7rem;">${escapeHtml(item.category)}</div>
          </div>
        </div>
        <i class="bi bi-arrow-return-left text-muted small"></i>
      </div>
    `).join('');
  }

  function handleKeyNavigation(e) {
    const listEl = document.getElementById('paletteResultsList');
    if (!listEl || filteredItems.length === 0) return;

    const items = listEl.querySelectorAll('.palette-item');

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      activeIndex = (activeIndex + 1) % filteredItems.length;
      updateActiveHighlight(items);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      activeIndex = (activeIndex - 1 + filteredItems.length) % filteredItems.length;
      updateActiveHighlight(items);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      executePaletteIndex(activeIndex);
    } else if (e.key === 'Escape') {
      closeCommandPalette();
    }
  }

  function updateActiveHighlight(items) {
    items.forEach((item, idx) => {
      if (idx === activeIndex) {
        item.style.background = 'rgba(56, 189, 248, 0.15)';
        item.style.borderLeft = '3px solid #38bdf8';
        item.scrollIntoView({ block: 'nearest' });
      } else {
        item.style.background = 'transparent';
        item.style.borderLeft = '3px solid transparent';
      }
    });
  }

  function executePaletteIndex(index) {
    const item = filteredItems[index];
    if (!item) return;

    closeCommandPalette();
    if (typeof item.action === 'function') {
      item.action();
    } else if (item.href) {
      window.location.href = item.href;
    }
  }

  async function openCommandPalette() {
    const modal = createPaletteModal();
    modal.style.display = 'flex';
    const input = modal.querySelector('#paletteSearchInput');
    input.value = '';
    await loadSearchIndex();
    filterAndRenderResults('');
    setTimeout(() => input.focus(), 50);
  }

  function closeCommandPalette() {
    const modal = document.getElementById('scadaCommandPaletteModal');
    if (modal) modal.style.display = 'none';
  }

  window.executePaletteIndex = executePaletteIndex;
  window.openCommandPalette = openCommandPalette;
  window.closeCommandPalette = closeCommandPalette;

  // Atajo global Ctrl+K / Cmd+K
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'K')) {
      e.preventDefault();
      const modal = document.getElementById('scadaCommandPaletteModal');
      if (modal && modal.style.display === 'flex') {
        closeCommandPalette();
      } else {
        openCommandPalette();
      }
    }
  });

  function escapeHtml(str) {
    if (!str) return '';
    return String(str).replace(/[&<>"']/g, m => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[m]));
  }

})();

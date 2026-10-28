// 🛡️ HELPER DE SEGURIDAD DOM SEGURO (Elimina DOM XSS)
function setSafeDOM(element, htmlString) {
    if (!element) return;
    if (!htmlString) {
        element.replaceChildren();
        return;
    }
    const range = document.createRange();
    range.selectNodeContents(element);
    const fragment = range.createContextualFragment(htmlString);
    fragment.querySelectorAll('script, iframe, object, embed').forEach(el => el.remove());
    fragment.querySelectorAll('*').forEach(el => {
        for (let i = el.attributes.length - 1; i >= 0; i--) {
            const attr = el.attributes[i];
            if (attr && attr.name && attr.name.toLowerCase().startsWith('on')) {
                el.removeAttribute(attr.name);
            }
        }
    });
    element.replaceChildren(fragment);
}

/**
 * SISTEMA DE INVENTARIO Y CATÁLOGO MAESTRO INDUSTRIAL (SCADA PRO)
 * Integrado con Pick-to-Light IoT, Balizas LED WS2812B, ESP32 y WhatsApp Bot
 * Versión 3.0
 */

// Variables globales del sistema
let inventoryItems = [];
let categories = [];
let areas = [];
let qrScanner = null;
let quickScanner = null;
let librariesLoaded = false;
let activePicksMap = new Map();
let activePicksUnsubscribe = null;
let inventoryUnsubscribe = null;
let selectedItemIds = new Set();
let onlyLowStockFilterActive = false;
let onlyActivePicksFilterActive = false;
let cachedMovements = null;
let movementsBarChart = null;
let movementSummaryChart = null;
let lowStockChart = null;

// Verificar que las librerías esenciales estén cargadas
function checkLibrariesLoaded() {
    const essentialLibraries = {
        'Bootstrap': typeof bootstrap !== 'undefined',
        'Firebase': typeof firebase !== 'undefined'
    };
    
    const essentialLoaded = Object.values(essentialLibraries).every(loaded => loaded);
    
    if (essentialLoaded) {
        librariesLoaded = true;
        initializeInventory();
    } else {
        setTimeout(checkLibrariesLoaded, 100);
    }
}

// Ocultar pantalla de carga SCADA Pro
function hidePageLoader() {
    const pl = document.getElementById('page-loader');
    if (pl && !pl.classList.contains('pl-hidden')) {
        pl.classList.add('pl-hidden');
        setTimeout(() => {
            if (pl.parentNode) pl.style.display = 'none';
        }, 500);
    }
}

// Inicializar sistema de inventario
function initializeInventory() {
    if (!checkInventoryAuth()) {
        hidePageLoader();
        return;
    }
    
    loadCategories();
    loadAreas();
    initInventoryRealtimeListener();
    initActivePicksListener();
    setupEventListeners();
    setupBatchActionListeners();
    setupQRStudioListeners();
    startNotificationCheck();
}

// Inicializar cuando el DOM esté listo
document.addEventListener('DOMContentLoaded', function() {
    checkLibrariesLoaded();
    
    window.addEventListener('beforeunload', () => {
        if (inventoryUnsubscribe) inventoryUnsubscribe();
        if (activePicksUnsubscribe) activePicksUnsubscribe();
        stopNotificationCheck();
    });
});

// Listener en tiempo real para el inventario completo
function initInventoryRealtimeListener() {
    if (inventoryUnsubscribe) inventoryUnsubscribe();
    if (typeof db === 'undefined' || !db) return;

    inventoryUnsubscribe = db.collection('inventory').onSnapshot(snapshot => {
        inventoryItems = [];
        snapshot.forEach(doc => {
            const data = doc.data();
            data.id = doc.id;
            inventoryItems.push(data);
        });

        // Ordenar alfabéticamente por código / nombre por defecto
        inventoryItems.sort((a, b) => (a.code || '').localeCompare(b.code || ''));

        populateRackFilterOptions();
        filterItems();
        updateStatistics();
        loadInventoryCharts();
        hidePageLoader();
    }, error => {
        console.error('Error en listener de inventario:', error);
        showAlert('Error al conectar con la base de datos de inventario: ' + error.message, 'danger');
        hidePageLoader();
    });
}

// Configurar event listeners principales
let inventoryListenersBound = false;
function setupEventListeners() {
    if (inventoryListenersBound) return;
    inventoryListenersBound = true;

    const addItemForm = document.getElementById('addItemForm');
    const addCategoryForm = document.getElementById('addCategoryForm');
    const addAreaForm = document.getElementById('addAreaForm');
    const editItemForm = document.getElementById('editItemForm');
    const movementForm = document.getElementById('movementForm');
    
    if (addItemForm) addItemForm.addEventListener('submit', addNewItem);
    if (addCategoryForm) addCategoryForm.addEventListener('submit', addNewCategory);
    if (addAreaForm) addAreaForm.addEventListener('submit', addNewArea);
    if (editItemForm) editItemForm.addEventListener('submit', saveEditedItem);
    if (movementForm) movementForm.addEventListener('submit', addMovement);
    
    // Filtros de búsqueda
    const searchInput = document.getElementById('searchInput');
    const categoryFilter = document.getElementById('categoryFilter');
    const statusFilter = document.getElementById('statusFilter');
    const areaFilter = document.getElementById('areaFilter');
    const rackFilter = document.getElementById('rackFilter');
    
    if (searchInput) searchInput.addEventListener('input', filterItems);
    if (categoryFilter) categoryFilter.addEventListener('change', filterItems);
    if (statusFilter) statusFilter.addEventListener('change', filterItems);
    if (areaFilter) areaFilter.addEventListener('change', filterItems);
    if (rackFilter) rackFilter.addEventListener('change', filterItems);

    // Botones de filtro rápido
    const quickLowStockBtn = document.getElementById('quickLowStockBtn');
    if (quickLowStockBtn) {
        quickLowStockBtn.addEventListener('click', () => {
            onlyLowStockFilterActive = !onlyLowStockFilterActive;
            quickLowStockBtn.classList.toggle('btn-warning', onlyLowStockFilterActive);
            quickLowStockBtn.classList.toggle('btn-outline-warning', !onlyLowStockFilterActive);
            filterItems();
        });
    }

    const quickActivePicksFilterBtn = document.getElementById('quickActivePicksFilterBtn');
    if (quickActivePicksFilterBtn) {
        quickActivePicksFilterBtn.addEventListener('click', () => {
            onlyActivePicksFilterActive = !onlyActivePicksFilterActive;
            quickActivePicksFilterBtn.classList.toggle('btn-info', onlyActivePicksFilterActive);
            quickActivePicksFilterBtn.classList.toggle('btn-outline-info', !onlyActivePicksFilterActive);
            filterItems();
        });
    }

    const clearFiltersBtn = document.getElementById('clearFiltersBtn');
    if (clearFiltersBtn) {
        clearFiltersBtn.addEventListener('click', () => {
            if (searchInput) searchInput.value = '';
            if (categoryFilter) categoryFilter.value = '';
            if (statusFilter) statusFilter.value = '';
            if (areaFilter) areaFilter.value = '';
            if (rackFilter) rackFilter.value = '';
            onlyLowStockFilterActive = false;
            onlyActivePicksFilterActive = false;
            if (quickLowStockBtn) {
                quickLowStockBtn.classList.remove('btn-warning');
                quickLowStockBtn.classList.add('btn-outline-warning');
            }
            if (quickActivePicksFilterBtn) {
                quickActivePicksFilterBtn.classList.remove('btn-info');
                quickActivePicksFilterBtn.classList.add('btn-outline-info');
            }
            filterItems();
        });
    }

    // Botón de alternar analítica y gráficos
    const toggleChartsBtn = document.getElementById('toggleChartsBtn');
    const chartsCollapse = document.getElementById('inventoryChartsCollapse');
    if (toggleChartsBtn && chartsCollapse) {
        const bsCollapse = new bootstrap.Collapse(chartsCollapse, { toggle: false });
        toggleChartsBtn.addEventListener('click', (e) => {
            e.preventDefault();
            bsCollapse.toggle();
        });

        chartsCollapse.addEventListener('show.bs.collapse', () => {
            const txt = document.getElementById('toggleChartsBtnText');
            if (txt) txt.textContent = 'Ocultar Métricas y Gráficos';
            loadInventoryCharts(true);
        });
        chartsCollapse.addEventListener('hide.bs.collapse', () => {
            const txt = document.getElementById('toggleChartsBtnText');
            if (txt) txt.textContent = 'Ver Métricas y Gráficos';
        });
    }

    const quickEntryBtn = document.getElementById('quickEntryBtn');
    if (quickEntryBtn) {
        quickEntryBtn.addEventListener('click', openQuickEntryModal);
    }
    
    // Escáneres
    const scanQRBtn = document.getElementById('scanQRBtn');
    const quickScanBtn = document.getElementById('quickScanBtn');
    if (scanQRBtn) scanQRBtn.addEventListener('click', () => {
        const modal = new bootstrap.Modal(document.getElementById('qrScannerModal'));
        modal.show();
        openQRScanner();
    });
    if (quickScanBtn) quickScanBtn.addEventListener('click', () => {
        const modal = new bootstrap.Modal(document.getElementById('quickScanModal'));
        modal.show();
        openQuickScan();
    });

    // Checkbox Maestro Seleccionar Todo
    const selectAllCb = document.getElementById('selectAll');
    if (selectAllCb) {
        selectAllCb.addEventListener('change', function() {
            const cbs = document.querySelectorAll('.item-checkbox');
            cbs.forEach(cb => {
                cb.checked = selectAllCb.checked;
                const id = cb.getAttribute('data-id');
                if (id) {
                    if (selectAllCb.checked) selectedItemIds.add(id);
                    else selectedItemIds.delete(id);
                }
            });
            updateBatchActionBar();
        });
    }

    // Modal de Escáner Limpieza al cerrar
    const qrScannerModal = document.getElementById('qrScannerModal');
    if (qrScannerModal) {
        qrScannerModal.addEventListener('hidden.bs.modal', () => {
            if (qrScanner) {
                try { qrScanner.clear(); } catch(e) {}
                qrScanner = null;
            }
        });
    }

    const quickScanModal = document.getElementById('quickScanModal');
    if (quickScanModal) {
        quickScanModal.addEventListener('hidden.bs.modal', () => {
            if (quickScanner) {
                try { quickScanner.clear(); } catch(e) {}
                quickScanner = null;
            }
        });
    }

    // Formulario de Movimiento: calcular vista previa en vivo
    const movementType = document.getElementById('movementType');
    const movementQuantity = document.getElementById('movementQuantity');
    if (movementType) movementType.addEventListener('change', updateMovementPreview);
    if (movementQuantity) movementQuantity.addEventListener('input', updateMovementPreview);

    initializeColorPicker();
    setupAreaCheckboxes();
}

// Configurar acciones en lote (Batch Actions)
function setupBatchActionListeners() {
    const batchClearBtn = document.getElementById('batchClearBtn');
    const batchPrintQRBtn = document.getElementById('batchPrintQRBtn');
    const batchLightUpBtn = document.getElementById('batchLightUpBtn');
    const tablePrintSelectedBtn = document.getElementById('tablePrintSelectedBtn');
    const tablePrintAllBtn = document.getElementById('tablePrintAllBtn');
    const openQRStudioBtn = document.getElementById('openQRStudioBtn');

    if (batchClearBtn) {
        batchClearBtn.addEventListener('click', () => {
            selectedItemIds.clear();
            const cbs = document.querySelectorAll('.item-checkbox');
            cbs.forEach(cb => cb.checked = false);
            const selectAllCb = document.getElementById('selectAll');
            if (selectAllCb) selectAllCb.checked = false;
            updateBatchActionBar();
        });
    }

    if (batchPrintQRBtn) {
        batchPrintQRBtn.addEventListener('click', () => openQRLabelStudio('selected'));
    }
    if (tablePrintSelectedBtn) {
        tablePrintSelectedBtn.addEventListener('click', () => openQRLabelStudio('selected'));
    }
    if (tablePrintAllBtn) {
        tablePrintAllBtn.addEventListener('click', () => openQRLabelStudio('all'));
    }
    if (openQRStudioBtn) {
        openQRStudioBtn.addEventListener('click', () => openQRLabelStudio(selectedItemIds.size > 0 ? 'selected' : 'all'));
    }

    if (batchLightUpBtn) {
        batchLightUpBtn.addEventListener('click', async () => {
            if (selectedItemIds.size === 0) return;
            let count = 0;
            for (const id of selectedItemIds) {
                if (typeof window.triggerPickToLight === 'function') {
                    await window.triggerPickToLight(id, false);
                } else if (typeof window.toggleBinLight === 'function') {
                    await window.toggleBinLight(id, false);
                }
                count++;
            }
            showAlert(`💡 ${count} artículos iluminados en Almacén IoT`, 'info');
        });
    }
}

// Actualizar barra de acciones en lote
function updateBatchActionBar() {
    const bar = document.getElementById('batchActionBar');
    const countEl = document.getElementById('batchSelectedCount');
    if (!bar || !countEl) return;

    const count = selectedItemIds.size;
    countEl.textContent = count;
    bar.style.display = count > 0 ? 'flex' : 'none';

    const selectAllCb = document.getElementById('selectAll');
    const allVisible = document.querySelectorAll('.item-checkbox');
    if (selectAllCb && allVisible.length > 0) {
        selectAllCb.checked = count === allVisible.length;
    }
}

// Poblar selector de Racks dinámicamente según ubicaciones reales
function populateRackFilterOptions() {
    const rackFilter = document.getElementById('rackFilter');
    if (!rackFilter) return;

    const currentVal = rackFilter.value;
    const racks = new Set();
    inventoryItems.forEach(item => {
        if (item.rack) racks.add(item.rack.trim());
        else if (item.location && item.location.includes('Rack')) {
            const match = item.location.match(/Rack\s+[A-Za-z0-9]+/i);
            if (match) racks.add(match[0].trim());
        }
    });

    const sortedRacks = Array.from(racks).sort();
    setSafeDOM(rackFilter, '<option value="">Todos los Racks</option>');
    sortedRacks.forEach(r => {
        const opt = document.createElement('option');
        opt.value = r;
        opt.textContent = r;
        if (r === currentVal) opt.selected = true;
        rackFilter.appendChild(opt);
    });
}

// Filtrar elementos de la tabla
function filterItems() {
    const categoryFilter = document.getElementById('categoryFilter')?.value || '';
    const areaFilter = document.getElementById('areaFilter')?.value || '';
    const statusFilter = document.getElementById('statusFilter')?.value || '';
    const rackFilter = document.getElementById('rackFilter')?.value || '';
    const searchTerm = (document.getElementById('searchInput')?.value || '').toLowerCase().trim();
    
    let filteredItems = inventoryItems.filter(item => {
        const matchesCategory = !categoryFilter || item.category === categoryFilter;
        
        const itemAreas = item.areas || (item.area ? [item.area] : []);
        const matchesArea = !areaFilter || itemAreas.includes(areaFilter) || itemAreas.includes(String(areaFilter));
        
        let matchesStatus = true;
        if (statusFilter === 'active') {
            matchesStatus = (item.stock || 0) > (item.minStock || 0);
        } else if (statusFilter === 'low') {
            matchesStatus = (item.stock || 0) > 0 && (item.stock || 0) <= (item.minStock || 0);
        } else if (statusFilter === 'empty') {
            matchesStatus = (item.stock || 0) <= 0;
        }

        if (onlyLowStockFilterActive) {
            if ((item.stock || 0) > (item.minStock || 0)) matchesStatus = false;
        }

        if (onlyActivePicksFilterActive) {
            if (!activePicksMap.has(item.id)) matchesStatus = false;
        }

        let matchesRack = true;
        if (rackFilter) {
            const loc = (item.rack || item.location || '').toLowerCase();
            matchesRack = loc.includes(rackFilter.toLowerCase());
        }

        const matchesSearch = !searchTerm || 
            (item.name || '').toLowerCase().includes(searchTerm) ||
            (item.code || '').toLowerCase().includes(searchTerm) ||
            (item.location || '').toLowerCase().includes(searchTerm) ||
            (item.rack || '').toLowerCase().includes(searchTerm) ||
            (item.bin || '').toLowerCase().includes(searchTerm) ||
            (item.supplier || '').toLowerCase().includes(searchTerm) ||
            (item.description && item.description.toLowerCase().includes(searchTerm));
        
        return matchesCategory && matchesArea && matchesSearch && matchesStatus && matchesRack;
    });
    
    renderFilteredTable(filteredItems);
}

// Renderizar tabla filtrada
function renderFilteredTable(items) {
    const tbody = document.getElementById('inventoryTableBody');
    const countBadge = document.getElementById('visibleItemsCount');
    if (!tbody) return;
    
    tbody.replaceChildren();
    if (countBadge) countBadge.textContent = `${items.length} registro(s)`;
    
    if (items.length === 0) {
        renderInventoryEmptyState(tbody);
        return;
    }
    
    items.forEach(item => tbody.appendChild(buildInventoryRow(item)));
}

// Construir fila de tabla SCADA Pro
function buildInventoryRow(item) {
    const categoryColor = getCategoryColor(item.category);
    const isCustomColor = categoryColor.startsWith('#');
    const row = document.createElement('tr');
    
    const stock = Number(item.stock) || 0;
    const minStock = Number(item.minStock) || 0;
    const isLow = stock <= minStock && stock > 0;
    const isEmpty = stock <= 0;
    
    if (isEmpty) row.classList.add('table-danger');
    else if (isLow) row.classList.add('table-warning');

    const activePick = activePicksMap.get(item.id);
    const locLabel = item.location || (item.rack ? `${item.rack} - ${item.bin || ''}`.trim() : '');

    // Barra de nivel de stock
    const maxReference = Math.max(minStock * 2, 20);
    const pct = Math.min(100, Math.round((stock / maxReference) * 100));
    const barColor = isEmpty ? '#ef4444' : isLow ? '#f59e0b' : '#10b981';

    const isChecked = selectedItemIds.has(item.id);

    setSafeDOM(row, `
        <td style="text-align: center;">
            <input type="checkbox" class="form-check-input item-checkbox" data-id="${item.id}" ${isChecked ? 'checked' : ''}>
        </td>
        <td style="text-align: center;">
            <button class="qr-thumb-btn" onclick="showQRModal('${item.id}')" title="Ver código QR y ficha de impresión">
                <i class="bi bi-qr-code"></i>
            </button>
        </td>
        <td>
            <span class="badge bg-dark border border-secondary text-info font-monospace" style="font-size: 0.8rem;">
                ${escapeHtml(item.code || 'S/C')}
            </span>
        </td>
        <td>
            <div class="fw-bold text-white text-truncate" style="max-width: 280px;" title="${escapeHtml(item.name)}">
                ${escapeHtml(item.name || 'Sin nombre')}
            </div>
            <div class="d-flex align-items-center gap-1 mt-1 flex-wrap">
                <span class="badge ${getCategoryBadgeClass(item.category)}" ${isCustomColor ? `style="background-color: ${categoryColor} !important; color: white;"` : ''}>
                    ${escapeHtml(getCategoryName(item.category))}
                </span>
                ${item.supplier ? `<span class="text-muted small" style="font-size: 0.75rem;">• ${escapeHtml(item.supplier)}</span>` : ''}
            </div>
        </td>
        <td>
            <div class="d-flex flex-wrap gap-1">
                ${formatAreasCompact(item.areas || item.area)}
            </div>
        </td>
        <td>
            <div class="d-flex align-items-center gap-1 flex-wrap">
                <span class="badge ${locLabel ? 'bg-dark border border-secondary text-info' : 'bg-secondary bg-opacity-25 text-muted'}" style="font-size: 0.75rem;" title="${escapeHtml(locLabel || 'Sin ubicación')}">
                    <i class="bi bi-geo-alt"></i> ${escapeHtml(locLabel || 'Sin Ubicación')}
                </span>
                ${activePick
                    ? `<button class="btn btn-sm btn-success py-0 px-2 fw-bold text-white shadow-sm" onclick="toggleBinLight('${item.id}')" title="Baliza encendida para saber dónde colocar stock. Clic para apagar"><span class="pick-led-dot pick-led-dot--lit me-1"></span> Encendida <i class="bi bi-x-circle ms-1"></i></button>`
                    : `<button class="btn btn-sm btn-outline-info py-0 px-2" onclick="toggleBinLight('${item.id}')" title="Encender baliza LED para saber dónde colocar o guardar el stock"><i class="bi bi-lightbulb me-1"></i> Ubicar</button>`
                }
            </div>
        </td>
        <td style="text-align: center;">
            <div class="stock-controls">
                <button class="btn btn-outline-danger btn-adj" onclick="quickStockAdjust('${item.id}', -1)" title="Restar 1">−</button>
                <span class="stock-value ${isEmpty ? 'text-danger' : isLow ? 'text-warning' : 'text-success'}">${stock}</span>
                <button class="btn btn-outline-success btn-adj" onclick="quickStockAdjust('${item.id}', 1)" title="Sumar 1">+</button>
            </div>
            <div class="stock-bar-wrap mx-auto" style="max-width: 90px;" title="${stock} / mín ${minStock}">
                <div class="stock-bar-fill" style="width: ${pct}%; background-color: ${barColor};"></div>
            </div>
            <div class="text-muted small" style="font-size: 0.7rem;">mín: ${minStock}</div>
        </td>
        <td style="text-align: center;">
            <span class="badge ${getStatusClass(stock, minStock)}" style="font-size: 0.72rem;">
                ${getStatusIcon(stock, minStock)} ${getStatusText(stock, minStock)}
            </span>
        </td>
        <td>
            <span class="text-muted small" style="font-size: 0.75rem;">
                ${item.lastMovement ? formatDate(item.lastMovement) : '—'}
            </span>
        </td>
        <td style="text-align: end;">
            <div class="btn-group btn-group-sm">
                <button class="btn btn-outline-info" onclick="showItemDetails('${item.id}')" title="Ficha técnica e historial"><i class="bi bi-eye"></i></button>
                <button class="btn btn-outline-success" onclick="openMovementModal('${item.id}', 'entrada')" title="Registrar Entrada"><i class="bi bi-box-arrow-in-down"></i></button>
                <button class="btn btn-outline-warning" onclick="openMovementModal('${item.id}', 'salida')" title="Registrar Salida"><i class="bi bi-box-arrow-up"></i></button>
                <button class="btn btn-outline-secondary" onclick="editItem('${item.id}')" title="Editar"><i class="bi bi-pencil"></i></button>
                <button class="btn btn-outline-danger" onclick="deleteItem('${item.id}')" title="Eliminar"><i class="bi bi-trash"></i></button>
            </div>
        </td>
    `);

    // Vincular evento de selección individual
    const cb = row.querySelector('.item-checkbox');
    if (cb) {
        cb.addEventListener('change', (e) => {
            if (e.target.checked) selectedItemIds.add(item.id);
            else selectedItemIds.delete(item.id);
            updateBatchActionBar();
        });
    }

    return row;
}

function escapeHtml(text) {
      if (!text) return '';
      return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
    }

function renderInventoryEmptyState(tbody) {
    setSafeDOM(tbody, `
        <tr>
            <td colspan="10" class="text-center py-5">
                <div class="text-muted">
                    <i class="bi bi-boxes d-block mb-3 fs-1 opacity-25"></i>
                    <h5 class="text-white">No se encontraron artículos</h5>
                    <p class="small mb-3">No hay componentes que coincidan con los filtros seleccionados o el catálogo está vacío.</p>
                    <button class="btn btn-primary btn-sm" data-bs-toggle="modal" data-bs-target="#addItemModal">
                        <i class="bi bi-plus-lg me-1"></i> Registrar Primer Artículo
                    </button>
                </div>
            </td>
        </tr>
    `);
}

// Renderizar tabla completa
function renderInventoryTable() {
    filterItems();
}

// Formatear áreas compactas
function formatAreasCompact(areas) {
    if (!areas) return '<span class="text-muted small">—</span>';
    const arr = Array.isArray(areas) ? areas : [areas];
    if (arr.length === 0) return '<span class="text-muted small">—</span>';
    return arr.map(a => `<span class="area-compact-pill">A${escapeHtml(String(a).replace(/^area\s*/i, ''))}</span>`).join('');
}

// Actualizar estadísticas KPI
function updateStatistics() {
    const totalItems = inventoryItems.length;
    const activeItems = inventoryItems.filter(item => (item.stock || 0) > 0).length;
    const lowStockItems = inventoryItems.filter(item => (item.stock || 0) <= (item.minStock || 0)).length;
    const totalValue = inventoryItems.reduce((sum, item) => sum + ((Number(item.price) || 0) * (Number(item.stock) || 0)), 0);
    
    const totalEl = document.getElementById('totalItems');
    const activeEl = document.getElementById('activeItems');
    const lowEl = document.getElementById('lowStockItems');
    const valEl = document.getElementById('totalValue');
    const kpiLowCard = document.getElementById('kpiLowStockCard');

    if (totalEl) totalEl.textContent = totalItems;
    if (activeEl) activeEl.textContent = activeItems;
    if (lowEl) lowEl.textContent = lowStockItems;
    if (valEl) valEl.textContent = `$${totalValue.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

    if (kpiLowCard) {
        if (lowStockItems > 0) {
            kpiLowCard.style.boxShadow = '0 0 15px rgba(245, 158, 11, 0.2)';
        } else {
            kpiLowCard.style.boxShadow = 'none';
        }
    }
}

// ==========================================================================
// IOT SMART WAREHOUSE & PICK-TO-LIGHT CLIENT SYSTEM
// ==========================================================================
function initActivePicksListener() {
    if (activePicksUnsubscribe) activePicksUnsubscribe();
    if (typeof db === 'undefined' || !db) return;

    activePicksUnsubscribe = db.collection('active_picks').where('status', '==', 'active').onSnapshot(snap => {
        activePicksMap.clear();
        snap.forEach(doc => {
            const data = doc.data();
            data.id = doc.id;
            activePicksMap.set(data.itemId, data);
        });

        // Actualizar contadores
        const headerBadge = document.getElementById('activePicksHeaderBadge');
        const headerCount = document.getElementById('activePicksHeaderCount');
        const kpiActive = document.getElementById('kpiActivePicksCount');
        const kpiDot = document.getElementById('kpiPickLedDot');

        const activeCount = activePicksMap.size;
        if (headerBadge) headerBadge.style.display = activeCount > 0 ? 'inline-flex' : 'none';
        if (headerCount) headerCount.textContent = activeCount;
        if (kpiActive) kpiActive.textContent = activeCount;
        if (kpiDot) kpiDot.style.display = activeCount > 0 ? 'inline-block' : 'none';

        renderActivePicksFloatingBanner();
        filterItems();
    }, err => {
        console.warn('Aviso escuchando active_picks:', err.message);
    });
}

function renderActivePicksFloatingBanner() {
    const banner = document.getElementById('activePicksContainer');
    const badge = document.getElementById('activePicksBadgeCount');
    const list = document.getElementById('activePicksList');
    if (!banner || !list) return;

    if (activePicksMap.size === 0) {
        banner.style.display = 'none';
        list.replaceChildren();
        return;
    }

    banner.style.display = 'block';
    if (badge) badge.textContent = `${activePicksMap.size} encendida(s)`;
    list.replaceChildren();

    activePicksMap.forEach((pick, itemId) => {
        const row = document.createElement('div');
        row.className = 'd-flex justify-content-between align-items-center p-2 rounded bg-black border border-info border-opacity-50';
        setSafeDOM(row, `
            <div class="me-2 text-truncate" style="max-width: 190px;">
                <div class="fw-bold small text-info text-truncate">
                    <span class="pick-led-dot pick-led-dot--lit me-1"></span> ${escapeHtml(pick.itemName || pick.itemCode)}
                </div>
                <div class="text-muted small" style="font-size:0.75rem;">
                    📍 ${escapeHtml(pick.location || 'Rack Almacén')}
                </div>
            </div>
            <button class="btn btn-outline-danger btn-sm py-0 px-2 fw-semibold" onclick="toggleBinLight('${itemId}')" title="Apagar baliza LED">
                <i class="bi bi-x-circle me-1"></i> Apagar
            </button>
        `);
        list.appendChild(row);
    });
}

// ==========================================================================
// ASISTENTE DE LOCALIZACIÓN FÍSICA Y PUT-TO-LIGHT (DÓNDE COLOCAR EL STOCK)
// ==========================================================================
window.toggleBinLight = async function(itemId) {
    const item = inventoryItems.find(i => i.id === itemId);
    if (!item) return;

    const existingPick = activePicksMap.get(item.id);
    const loc = item.location || (item.rack ? `${item.rack} - ${item.bin || 'Gaveta 01'}` : 'Rack A - Gaveta 01');

    if (existingPick) {
        // Si ya está encendida, apagar la baliza
        try {
            await db.collection('active_picks').doc(existingPick.id).delete();
            showAlert(`💡 Baliza apagada para "${item.name}" en ${loc}`, 'info');
        } catch(e) {
            console.error('Error apagando baliza:', e);
            showAlert('Error al apagar baliza: ' + e.message, 'danger');
        }
    } else {
        // Encender baliza para saber dónde colocar o guardar el stock (Put-to-Light)
        try {
            await db.collection('active_picks').add({
                itemId: item.id,
                itemCode: item.code || 'S/C',
                itemName: item.name || 'Componente',
                location: loc,
                rack: item.rack || 'Rack A',
                bin: item.bin || 'Gaveta 01',
                warehouseBinId: item.warehouseBinId || item.bin || 'A-101',
                esp32Id: item.esp32Id || 'ESP32-RACK-A',
                ledIndex: item.ledIndex !== undefined ? item.ledIndex : 0,
                ledCount: 4,
                status: 'active',
                mode: 'put_to_light', // Modo localización / colocación de stock
                color: '#10B981', // Verde de colocación / ubicación
                requestedBy: 'Localizador de Inventario',
                requesterName: sessionStorage.getItem('username') || 'Operador',
                requestedQty: 0, // No es orden de retiro
                source: 'inventory_locator',
                createdAt: firebase.firestore.FieldValue.serverTimestamp()
            });
            showAlert(`💡 Baliza encendida en ${loc}. Te indica dónde colocar o guardar "${item.name}".`, 'success');
        } catch (err) {
            console.error('Error al encender baliza:', err);
            showAlert('No se pudo encender la señal LED: ' + err.message, 'danger');
        }
    }
};

window.triggerPickToLight = window.toggleBinLight;

// ==========================================================================
// AJUSTES RÁPIDOS DE STOCK CON ACTUALIZACIÓN OPTIMISTA
// ==========================================================================
async function quickStockAdjust(itemId, delta) {
    const item = inventoryItems.find(i => i.id === itemId);
    if (!item) return;

    const type = delta > 0 ? 'entrada' : 'salida';
    const quantity = Math.abs(delta);
    const currentStock = Number(item.stock) || 0;

    if (type === 'salida' && currentStock < quantity) {
        showAlert('Stock insuficiente para descontar', 'warning');
        return;
    }

    const newStock = Math.max(0, currentStock + delta);
    
    // Actualización optimista en memoria para que no haya retraso visual
    item.stock = newStock;
    item.lastMovement = new Date();
    updateStatistics();
    filterItems();

    try {
        await db.collection('inventory').doc(itemId).update({
            stock: newStock,
            lastMovement: new Date()
        });

        await db.collection('inventory_movements').add({
            itemId: item.id,
            itemCode: item.code || 'S/C',
            itemName: item.name || 'Componente',
            type: type,
            quantity: quantity,
            reasonType: type === 'entrada' ? 'Reabastecimiento (+)' : 'Retiro Rápido (-)',
            description: `Ajuste táctico ${delta > 0 ? '+' : ''}${delta} pza(s) desde panel SCADA`,
            timestamp: new Date(),
            responsible: sessionStorage.getItem('username') || 'Operador SCADA',
            previousStock: currentStock,
            newStock: newStock
        });

        invalidateMovementsCache();
    } catch (error) {
        console.error('Error en ajuste de stock:', error);
        showAlert('Error al guardar ajuste de stock en la nube: ' + error.message, 'danger');
    }
}

// Abrir modal de movimiento
function openMovementModal(itemId, presetType = '') {
    const item = inventoryItems.find(i => i.id === itemId);
    if (!item) return;

    const picker = document.getElementById('movementItemPicker');
    const info = document.getElementById('movementItemInfo');
    if (picker) picker.style.display = 'none';
    if (info) info.style.display = 'flex';

    document.getElementById('movementItemId').value = item.id;
    document.getElementById('movementItemName').textContent = item.name;
    document.getElementById('movementItemCode').textContent = item.code;
    document.getElementById('movementItemStock').textContent = item.stock;

    const locEl = document.getElementById('movementItemLocation');
    const loc = item.location || (item.rack ? `${item.rack} - ${item.bin || 'Gaveta 01'}` : 'Sin Ubicación');
    if (locEl) locEl.textContent = loc;

    const locateBtn = document.getElementById('movementLocateBtn');
    if (locateBtn) {
        const isLit = activePicksMap.has(item.id);
        locateBtn.className = isLit ? 'btn btn-success btn-sm py-0 px-2 fw-bold text-white shadow-sm' : 'btn btn-outline-info btn-sm py-0 px-2';
        setSafeDOM(locateBtn, isLit 
            ? '<span class="pick-led-dot pick-led-dot--lit me-1"></span> Encendida (Apagar)' 
            : '<i class="bi bi-lightbulb me-1"></i> Iluminar para Guardar');
    }

    if (presetType) {
        document.getElementById('movementType').value = presetType;
    } else {
        document.getElementById('movementType').value = 'entrada';
    }

    document.getElementById('movementQuantity').value = '1';
    document.getElementById('movementReasonType').value = presetType === 'salida' ? 'Mantenimiento' : 'Compra';
    document.getElementById('movementDescription').value = '';
    const responsibleEl = document.getElementById('movementResponsible');
    if (responsibleEl) responsibleEl.value = sessionStorage.getItem('username') || '';

    updateMovementPreview();

    const modal = new bootstrap.Modal(document.getElementById('movementModal'));
    modal.show();
}

function openQuickEntryModal() {
    if (inventoryItems.length === 0) {
        showAlert('Primero registra artículos en el inventario', 'warning');
        const addModal = new bootstrap.Modal(document.getElementById('addItemModal'));
        addModal.show();
        return;
    }

    const picker = document.getElementById('movementItemPicker');
    const info = document.getElementById('movementItemInfo');
    const select = document.getElementById('movementItemSelect');
    if (!picker || !select) return;

    setSafeDOM(select, '<option value="">-- Seleccionar artículo --</option>');
    inventoryItems.forEach(item => {
        const opt = document.createElement('option');
        opt.value = item.id;
        opt.textContent = `${item.code} — ${item.name} (stock: ${item.stock})`;
        select.appendChild(opt);
    });

    picker.style.display = 'block';
    if (info) info.style.display = 'none';
    document.getElementById('movementItemId').value = '';
    document.getElementById('movementType').value = 'entrada';
    document.getElementById('movementQuantity').value = '1';
    document.getElementById('movementReasonType').value = 'Compra';
    document.getElementById('movementDescription').value = '';
    const responsible = document.getElementById('movementResponsible');
    if (responsible) responsible.value = sessionStorage.getItem('username') || '';

    select.onchange = function() {
        if (this.value) {
            const itm = inventoryItems.find(i => i.id === this.value);
            if (itm) {
                document.getElementById('movementItemId').value = itm.id;
                document.getElementById('movementItemName').textContent = itm.name;
                document.getElementById('movementItemCode').textContent = itm.code;
                document.getElementById('movementItemStock').textContent = itm.stock;

                const locEl = document.getElementById('movementItemLocation');
                const loc = itm.location || (itm.rack ? `${itm.rack} - ${itm.bin || 'Gaveta 01'}` : 'Sin Ubicación');
                if (locEl) locEl.textContent = loc;

                const locateBtn = document.getElementById('movementLocateBtn');
                if (locateBtn) {
                    const isLit = activePicksMap.has(itm.id);
                    locateBtn.className = isLit ? 'btn btn-success btn-sm py-0 px-2 fw-bold text-white shadow-sm' : 'btn btn-outline-info btn-sm py-0 px-2';
                    setSafeDOM(locateBtn, isLit 
                        ? '<span class="pick-led-dot pick-led-dot--lit me-1"></span> Encendida (Apagar)' 
                        : '<i class="bi bi-lightbulb me-1"></i> Iluminar para Guardar');
                }

                if (info) info.style.display = 'flex';
                updateMovementPreview();
            }
        }
    };

    updateMovementPreview();
    const modal = new bootstrap.Modal(document.getElementById('movementModal'));
    modal.show();
}

function updateMovementPreview() {
    const itemId = document.getElementById('movementItemId')?.value;
    const type = document.getElementById('movementType')?.value;
    const quantity = parseInt(document.getElementById('movementQuantity')?.value, 10) || 0;
    const previewText = document.getElementById('movementPreviewText');
    if (!previewText) return;

    if (!itemId) {
        previewText.textContent = 'Selecciona un artículo para ver la proyección de stock';
        return;
    }

    const item = inventoryItems.find(i => i.id === itemId);
    if (!item) return;

    const currentStock = Number(item.stock) || 0;
    let projectedStock = currentStock;

    if (type === 'entrada') projectedStock = currentStock + quantity;
    else if (type === 'salida') projectedStock = Math.max(0, currentStock - quantity);
    else if (type === 'ajuste') projectedStock = quantity;

    setSafeDOM(previewText, `Stock Proyectado: <strong>${currentStock}</strong> → <span class="badge ${projectedStock <= (item.minStock || 0) ? 'bg-warning text-dark' : 'bg-success'} fs-6">${projectedStock}</span> (${type === 'salida' ? '-' : type === 'entrada' ? '+' : '='}${quantity})`);
}

async function addMovement(event) {
    event.preventDefault();
    
    const itemId = document.getElementById('movementItemId').value;
    const type = document.getElementById('movementType').value;
    const quantity = parseInt(document.getElementById('movementQuantity').value, 10);
    const reasonType = document.getElementById('movementReasonType').value;
    const description = document.getElementById('movementDescription').value.trim();
    const responsibleEl = document.getElementById('movementResponsible');
    const responsible = responsibleEl ? responsibleEl.value.trim() : (sessionStorage.getItem('username') || 'Operador');
    
    if (!itemId || !type || isNaN(quantity) || quantity <= 0) {
        showAlert('Ingresa una cantidad válida mayor a cero', 'warning');
        return;
    }

    if (!reasonType) {
        showAlert('Selecciona el motivo del movimiento', 'warning');
        return;
    }
    
    const item = inventoryItems.find(i => i.id === itemId);
    if (!item) {
        showAlert('Artículo no encontrado', 'danger');
        return;
    }
    
    let newStock;
    if (type === 'entrada') {
        newStock = (Number(item.stock) || 0) + quantity;
    } else if (type === 'salida') {
        if ((Number(item.stock) || 0) < quantity) {
            showAlert('Stock insuficiente para esta salida', 'warning');
            return;
        }
        newStock = (Number(item.stock) || 0) - quantity;
    } else if (type === 'ajuste') {
        newStock = quantity;
    }
    
    try {
        const movementData = {
            itemId: itemId,
            itemCode: item.code || 'S/C',
            itemName: item.name || 'Componente',
            type: type,
            quantity: quantity,
            reasonType: reasonType,
            description: description,
            timestamp: new Date(),
            responsible: responsible || 'Operador',
            previousStock: item.stock,
            newStock: newStock
        };
        
        await db.collection('inventory').doc(itemId).update({
            stock: newStock,
            lastMovement: new Date()
        });
        
        await db.collection('inventory_movements').add(movementData);
        invalidateMovementsCache();
        
        const modal = bootstrap.Modal.getInstance(document.getElementById('movementModal'));
        if (modal) modal.hide();
        
        showAlert(`✅ Movimiento registrado exitosamente. Stock: ${item.stock} → ${newStock}`, 'success');
    } catch (error) {
        console.error('Error registrando movimiento:', error);
        showAlert('Error al guardar movimiento: ' + error.message, 'danger');
    }
}

// ==========================================================================
// REGISTRO Y EDICIÓN DE ARTÍCULOS
// ==========================================================================
async function addNewItem(event) {
    event.preventDefault();
    
    const code = document.getElementById('itemCode').value.trim();
    const name = document.getElementById('itemName').value.trim();
    const category = document.getElementById('itemCategory').value;
    const aplicaA = document.getElementById('itemAplicaA').value;
    const stock = parseInt(document.getElementById('itemStock').value, 10) || 0;
    const minStock = parseInt(document.getElementById('itemMinStock').value, 10) || 0;
    const price = parseFloat(document.getElementById('itemPrice').value) || 0;
    const description = document.getElementById('itemDescription').value.trim();
    
    const selectedAreas = [];
    const areaCheckboxes = ['area5', 'area10', 'area20', 'area30', 'area35'];
    areaCheckboxes.forEach(areaId => {
        const checkbox = document.getElementById(areaId);
        if (checkbox && checkbox.checked) selectedAreas.push(checkbox.value);
    });
    
    if (!code || !name || !category) {
        showAlert('Código, nombre y categoría son campos obligatorios', 'warning');
        return;
    }
    
    if (selectedAreas.length === 0) {
        showAlert('Debes marcar al menos un área compatible', 'warning');
        return;
    }
    
    const existingItem = inventoryItems.find(item => item.code && item.code.toLowerCase() === code.toLowerCase());
    if (existingItem) {
        showAlert('Ya existe un componente con este código SKU', 'warning');
        return;
    }
    
    try {
        const rack = (document.getElementById('itemRack')?.value || '').trim();
        const bin = (document.getElementById('itemBin')?.value || '').trim();
        let location = (document.getElementById('itemLocation')?.value || '').trim();
        if (!location && (rack || bin)) {
            location = [rack, bin].filter(Boolean).join(' - ');
        }

        const ledIndex = parseInt(document.getElementById('itemLedIndex')?.value, 10);
        const gpioPin = parseInt(document.getElementById('itemGpioPin')?.value, 10);
        const esp32Id = (document.getElementById('itemEsp32Id')?.value || '').trim() || 'ESP32-RACK-A';

        const itemData = {
            code: code,
            name: name,
            category: category,
            areas: selectedAreas,
            aplicaA: aplicaA,
            stock: stock,
            minStock: minStock,
            price: price,
            supplier: (document.getElementById('itemSupplier')?.value || '').trim(),
            description: description,
            rack: rack,
            bin: bin,
            location: location,
            warehouseBinId: bin || 'BIN-01',
            ledIndex: isNaN(ledIndex) ? 0 : ledIndex,
            gpioPin: isNaN(gpioPin) ? null : gpioPin,
            esp32Id: esp32Id,
            createdAt: new Date(),
            lastMovement: stock > 0 ? new Date() : null
        };
        
        await db.collection('inventory').add(itemData);
        
        const modal = bootstrap.Modal.getInstance(document.getElementById('addItemModal'));
        if (modal) modal.hide();
        document.getElementById('addItemForm').reset();
        clearAreaCheckboxes();
        
        showAlert(`Artículo "${name}" agregado al inventario`, 'success');
    } catch (error) {
        console.error('Error agregando elemento:', error);
        showAlert('Error al guardar el nuevo artículo: ' + error.message, 'danger');
    }
}

function editItem(itemId) {
    const item = inventoryItems.find(i => i.id === itemId);
    if (!item) return;

    document.getElementById('editItemId').value = item.id;
    document.getElementById('editItemCode').value = item.code || '';
    document.getElementById('editItemName').value = item.name || '';
    document.getElementById('editItemCategory').value = item.category || '';
    document.getElementById('editItemAplicaA').value = item.aplicaA || 'ambos';
    document.getElementById('editItemMinStock').value = item.minStock || 0;
    document.getElementById('editItemPrice').value = item.price || 0;
    document.getElementById('editItemSupplier').value = item.supplier || '';
    document.getElementById('editItemDescription').value = item.description || '';
    document.getElementById('editItemRack').value = item.rack || '';
    document.getElementById('editItemBin').value = item.bin || '';
    document.getElementById('editItemLocation').value = item.location || '';
    document.getElementById('editItemLedIndex').value = item.ledIndex !== undefined ? item.ledIndex : '';
    document.getElementById('editItemGpioPin').value = (item.gpioPin !== undefined && item.gpioPin !== null) ? item.gpioPin : '';
    document.getElementById('editItemEsp32Id').value = item.esp32Id || 'ESP32-RACK-A';

    const modal = new bootstrap.Modal(document.getElementById('editItemModal'));
    modal.show();
}

async function saveEditedItem(event) {
    event.preventDefault();
    const itemId = document.getElementById('editItemId').value;
    const name = document.getElementById('editItemName').value.trim();
    const category = document.getElementById('editItemCategory').value;
    const aplicaA = document.getElementById('editItemAplicaA').value;
    const minStock = parseInt(document.getElementById('editItemMinStock').value, 10) || 0;
    const price = parseFloat(document.getElementById('editItemPrice').value) || 0;
    const supplier = document.getElementById('editItemSupplier').value.trim();
    const description = document.getElementById('editItemDescription').value.trim();

    const rack = (document.getElementById('editItemRack')?.value || '').trim();
    const bin = (document.getElementById('editItemBin')?.value || '').trim();
    let location = (document.getElementById('editItemLocation')?.value || '').trim();
    if (!location && (rack || bin)) {
        location = [rack, bin].filter(Boolean).join(' - ');
    }
    const ledIndex = parseInt(document.getElementById('editItemLedIndex')?.value, 10);
    const gpioPin = parseInt(document.getElementById('editItemGpioPin')?.value, 10);
    const esp32Id = (document.getElementById('editItemEsp32Id')?.value || '').trim() || 'ESP32-RACK-A';

    if (!name || !category) {
        showAlert('Nombre y categoría son obligatorios', 'warning');
        return;
    }

    try {
        await db.collection('inventory').doc(itemId).update({
            name, category, aplicaA, minStock, price, supplier, description,
            rack, bin, location,
            warehouseBinId: bin || 'BIN-01',
            ledIndex: isNaN(ledIndex) ? 0 : ledIndex,
            gpioPin: isNaN(gpioPin) ? null : gpioPin,
            esp32Id,
            updatedAt: new Date()
        });
        const modal = bootstrap.Modal.getInstance(document.getElementById('editItemModal'));
        if (modal) modal.hide();
        showAlert('Artículo actualizado correctamente', 'success');
    } catch (error) {
        console.error('Error actualizando artículo:', error);
        showAlert('Error al guardar cambios: ' + error.message, 'danger');
    }
}

function deleteItem(itemId) {
    const item = inventoryItems.find(i => i.id === itemId);
    const name = item ? item.name : 'este artículo';
    if (confirm(`¿Estás seguro de que deseas eliminar permanentemente "${name}" del catálogo?`)) {
        db.collection('inventory').doc(itemId).delete()
            .then(() => {
                showAlert('Artículo eliminado exitosamente', 'success');
            })
            .catch(error => {
                console.error('Error eliminando elemento:', error);
                showAlert('Error eliminando elemento: ' + error.message, 'danger');
            });
    }
}

// ==========================================================================
// FICHA TÉCNICA E HISTORIAL EN TIEMPO REAL (SIN ERRORES DE ÍNDICE)
// ==========================================================================
async function showItemDetails(itemId) {
    const item = inventoryItems.find(item => item.id === itemId);
    if (!item) return;
    
    const contentElement = document.getElementById('itemDetailsContent');
    if (!contentElement) return;

    const loc = item.location || (item.rack ? `${item.rack} - ${item.bin || ''}`.trim() : 'Sin ubicación asignada');
    const activePick = activePicksMap.get(item.id);

    setSafeDOM(contentElement, `
        <div class="row g-4">
            <div class="col-md-6 border-end border-secondary border-opacity-25 pe-md-4">
                <div class="d-flex align-items-center justify-content-between mb-3">
                    <span class="badge bg-dark border border-secondary text-info font-monospace fs-6">${escapeHtml(item.code || 'S/C')}</span>
                    <span class="badge ${getCategoryBadgeClass(item.category)}">${escapeHtml(getCategoryName(item.category))}</span>
                </div>
                <h4 class="text-white fw-bold mb-2">${escapeHtml(item.name)}</h4>
                <p class="text-muted small">${escapeHtml(item.description || 'Sin notas técnicas registradas.')}</p>

                <div class="p-3 rounded-3 mb-3" style="background: rgba(15, 23, 42, 0.7); border: 1px solid rgba(255, 255, 255, 0.08);">
                    <div class="row g-2 small text-muted">
                        <div class="col-6">Stock Actual: <strong class="text-white font-monospace fs-6">${item.stock || 0}</strong></div>
                        <div class="col-6">Stock Mínimo: <strong class="text-warning font-monospace">${item.minStock || 0}</strong></div>
                        <div class="col-6">Precio: <strong class="text-success font-monospace">$${Number(item.price || 0).toFixed(2)}</strong></div>
                        <div class="col-6">Proveedor: <strong class="text-white">${escapeHtml(item.supplier || 'N/A')}</strong></div>
                    </div>
                </div>

                <div class="p-3 rounded-3" style="background: rgba(14, 165, 233, 0.08); border: 1px solid rgba(14, 165, 233, 0.3);">
                    <div class="d-flex justify-content-between align-items-center mb-2">
                        <strong class="text-info small"><i class="bi bi-geo-alt-fill me-1"></i> Ubicación en Estantería (Put-to-Light)</strong>
                        ${activePick
                            ? `<button class="btn btn-sm btn-success py-0 px-2 fw-bold text-white shadow-sm" onclick="toggleBinLight('${item.id}')"><span class="pick-led-dot pick-led-dot--lit me-1"></span> Encendida (Apagar)</button>`
                            : `<button class="btn btn-sm btn-outline-info py-0 px-2" onclick="toggleBinLight('${item.id}')"><i class="bi bi-lightbulb me-1"></i> Ubicar Gaveta</button>`
                        }
                    </div>
                    <div class="small text-white">📍 <strong>${escapeHtml(loc)}</strong></div>
                    <div class="text-muted small font-monospace mt-1" style="font-size: 0.75rem;">
                        LED WS2812: #${item.ledIndex !== undefined ? item.ledIndex : 0} | ESP32: ${escapeHtml(item.esp32Id || 'ESP32-RACK-A')}
                    </div>
                </div>
            </div>
            <div class="col-md-6 ps-md-4">
                <h6 class="text-white fw-bold mb-3 d-flex align-items-center gap-2">
                    <i class="bi bi-clock-history text-primary"></i> Movimientos Recientes
                </h6>
                <div id="itemMovementsList" style="max-height: 380px; overflow-y: auto;">
                    <div class="text-center py-4">
                        <div class="spinner-border spinner-border-sm text-info" role="status"></div>
                        <div class="text-muted small mt-2">Consultando trazabilidad...</div>
                    </div>
                </div>
            </div>
        </div>
    `);

    const modal = new bootstrap.Modal(document.getElementById('itemDetailsModal'));
    modal.show();

    loadItemMovements(itemId);
}

// Cargar movimientos ordenados en memoria para garantizar CERO errores de índice Firestore
async function loadItemMovements(itemId) {
    const listEl = document.getElementById('itemMovementsList');
    if (!listEl) return;

    try {
        const snapshot = await db.collection('inventory_movements')
            .where('itemId', '==', itemId)
            .limit(50)
            .get();

        if (snapshot.empty) {
            setSafeDOM(listEl, '<div class="text-muted small text-center py-4">No hay movimientos registrados para este artículo.</div>');
            return;
        }

        const movements = [];
        snapshot.forEach(doc => movements.push({ id: doc.id, ...doc.data() }));

        movements.sort((a, b) => {
            const timeA = a.timestamp?.toDate ? a.timestamp.toDate().getTime() : new Date(a.timestamp || 0).getTime();
            const timeB = b.timestamp?.toDate ? b.timestamp.toDate().getTime() : new Date(b.timestamp || 0).getTime();
            return timeB - timeA;
        });

        const recent = movements.slice(0, 15);
        setSafeDOM(listEl, `
            <div class="d-flex flex-column gap-2">
                ${recent.map(m => {
                    const isEntry = m.type === 'entrada';
                    const isAdjustment = m.type === 'ajuste';
                    const badgeClass = isEntry ? 'bg-success' : isAdjustment ? 'bg-warning text-dark' : 'bg-danger';
                    const sign = isEntry ? '+' : isAdjustment ? '=' : '-';
                    return `
                        <div class="p-2 rounded" style="background: rgba(15, 23, 42, 0.6); border: 1px solid rgba(255, 255, 255, 0.05);">
                            <div class="d-flex justify-content-between align-items-center">
                                <span class="badge ${badgeClass} font-monospace">${sign}${m.quantity || 1}</span>
                                <span class="text-muted small" style="font-size: 0.72rem;">${formatDate(m.timestamp)}</span>
                            </div>
                            <div class="small text-white mt-1 fw-semibold">${escapeHtml(m.reasonType || m.description || 'Movimiento')}</div>
                            <div class="text-muted small" style="font-size: 0.7rem;">Resp: ${escapeHtml(m.responsible || 'Operador')} ${m.newStock !== undefined ? `· Stock final: ${m.newStock}` : ''}</div>
                        </div>
                    `;
                }).join('')}
            </div>
        `);
    } catch (err) {
        console.error('Error cargando movimientos:', err);
        setSafeDOM(listEl, `<div class="text-danger small py-3">Error consultando historial: ${escapeHtml(err.message)}</div>`);
    }
}

// ==========================================================================
// ESTUDIO DE ETIQUETAS QR & IMPRESIÓN INDUSTRIAL DE ALTA DEFINICIÓN
// ==========================================================================
let currentStudioScope = 'selected';
let currentStudioFormat = 'thermal';

function setupQRStudioListeners() {
    const scopeSelect = document.getElementById('qrStudioScopeSelect');
    const formatSelect = document.getElementById('qrStudioFormatSelect');
    const printBtn = document.getElementById('executePrintLabelsBtn');
    const printSingleQRBtn = document.getElementById('printSingleQRBtn');

    if (scopeSelect) {
        scopeSelect.addEventListener('change', () => {
            currentStudioScope = scopeSelect.value;
            renderQRStudioPreview();
        });
    }

    if (formatSelect) {
        formatSelect.addEventListener('change', () => {
            currentStudioFormat = formatSelect.value;
            renderQRStudioPreview();
        });
    }

    if (printBtn) {
        printBtn.addEventListener('click', executePrintLabels);
    }

    if (printSingleQRBtn) {
        printSingleQRBtn.addEventListener('click', () => {
            const code = document.getElementById('qrModalLabel')?.getAttribute('data-active-id');
            if (code) {
                selectedItemIds.clear();
                selectedItemIds.add(code);
                const qrModal = bootstrap.Modal.getInstance(document.getElementById('qrModal'));
                if (qrModal) qrModal.hide();
                openQRLabelStudio('selected');
            }
        });
    }
}

function openQRLabelStudio(scope = 'selected') {
    currentStudioScope = scope;
    const scopeSelect = document.getElementById('qrStudioScopeSelect');
    if (scopeSelect) scopeSelect.value = scope;

    renderQRStudioPreview();

    const modal = new bootstrap.Modal(document.getElementById('qrLabelStudioModal'));
    modal.show();
}

function getItemsForStudio() {
    if (currentStudioScope === 'all') {
        return inventoryItems;
    }
    const items = inventoryItems.filter(i => selectedItemIds.has(i.id));
    return items.length > 0 ? items : inventoryItems.slice(0, 5);
}

function renderQRStudioPreview() {
    const grid = document.getElementById('qrLabelsPreviewGrid');
    const countBadge = document.getElementById('qrPreviewItemCount');
    if (!grid) return;

    grid.replaceChildren();
    const items = getItemsForStudio();
    if (countBadge) countBadge.textContent = `${items.length} etiqueta(s)`;

    if (items.length === 0) {
        setSafeDOM(grid, '<div class="text-muted text-center py-4">No hay artículos seleccionados para generar etiquetas.</div>');
        return;
    }

    items.forEach((item, idx) => {
        const col = document.createElement('div');
        col.className = currentStudioFormat === 'sheet' ? 'col-12' : currentStudioFormat === 'compact' ? 'col-md-3 col-sm-4 col-6' : 'col-md-4 col-sm-6 col-12';
        
        const loc = item.location || (item.rack ? `${item.rack} - ${item.bin || ''}`.trim() : 'Almacén Central');
        const qrId = `qr-preview-tag-${idx}`;

        setSafeDOM(col, `
            <div class="qr-label-card p-3 rounded d-flex gap-3 align-items-center" style="box-shadow: 0 4px 14px rgba(0,0,0,0.3); background-color: #ffffff !important; color: #0f172a !important; border: 2px solid #0f172a !important;">
                <div id="${qrId}" style="min-width: 90px; height: 90px; display: flex; align-items: center; justify-content: center; background: #ffffff;"></div>
                <div class="flex-grow-1 overflow-hidden" style="line-height: 1.25; color: #0f172a !important;">
                    <div class="fw-bold font-monospace text-uppercase" style="font-size: 0.85rem; color: #0284c7 !important;">${escapeHtml(item.code || 'S/C')}</div>
                    <div class="fw-bold text-truncate" style="font-size: 0.9rem; color: #0f172a !important;" title="${escapeHtml(item.name)}">${escapeHtml(item.name)}</div>
                    <div class="small mt-1" style="font-size: 0.74rem; color: #334155 !important;">📍 ${escapeHtml(loc)}</div>
                    <div class="small font-monospace" style="font-size: 0.68rem; color: #64748b !important;">Stock: ${item.stock || 0} | SCADA PRO</div>
                </div>
            </div>
        `);
        grid.appendChild(col);

        // Generar QR en el contenedor
        setTimeout(() => {
            const container = document.getElementById(qrId);
            if (container && typeof QRCode !== 'undefined') {
                container.replaceChildren();
                new QRCode(container, {
                    text: item.code || item.id,
                    width: 80,
                    height: 80,
                    colorDark: '#000000',
                    colorLight: '#ffffff',
                    correctLevel: QRCode.CorrectLevel.M
                });
            }
        }, 50);
    });
}

function executePrintLabels() {
    const items = getItemsForStudio();
    if (items.length === 0) {
        showAlert('No hay etiquetas para imprimir', 'warning');
        return;
    }

    const printArea = document.getElementById('printArea');
    if (!printArea) return;

    setSafeDOM(printArea, `
        <div style="font-family: Arial, sans-serif; padding: 10px;">
            <div style="display: flex; flex-wrap: wrap; gap: 12px;">
                ${items.map((item, idx) => {
                    const loc = item.location || (item.rack ? `${item.rack} - ${item.bin || ''}`.trim() : 'Almacén Central');
                    return `
                        <div class="qr-label-card" style="width: 280px; padding: 10px; border: 2px solid #000; border-radius: 6px; display: flex; gap: 10px; align-items: center; background: #fff; color: #000;">
                            <div id="print-qr-target-${idx}" style="width: 80px; height: 80px;"></div>
                            <div style="overflow: hidden; line-height: 1.25;">
                                <div style="font-weight: 700; font-family: monospace; font-size: 13px;">${escapeHtml(item.code || 'S/C')}</div>
                                <div style="font-weight: 700; font-size: 13px; max-width: 170px; word-break: break-word;">${escapeHtml(item.name)}</div>
                                <div style="font-size: 11px; margin-top: 3px;">📍 ${escapeHtml(loc)}</div>
                                <div style="font-size: 10px; color: #555; margin-top: 2px;">SCADA PRO · ${new Date().toLocaleDateString('es-MX')}</div>
                            </div>
                        </div>
                    `;
                }).join('')}
            </div>
        </div>
    `);

    // Renderizar los códigos QR
    items.forEach((item, idx) => {
        const el = document.getElementById(`print-qr-target-${idx}`);
        if (el && typeof QRCode !== 'undefined') {
            new QRCode(el, {
                text: item.code || item.id,
                width: 76,
                height: 76,
                colorDark: '#000000',
                colorLight: '#ffffff',
                correctLevel: QRCode.CorrectLevel.M
            });
        }
    });

    // Pequeño delay para permitir que el canvas QR se termine de dibujar
    setTimeout(() => {
        window.print();
    }, 400);
}

// Modal individual de QR
window.showQRModal = function(itemId) {
    const item = inventoryItems.find(i => i.id === itemId || i.code === itemId);
    if (!item) return;

    const container = document.getElementById('qrModalContainer');
    const info = document.getElementById('qrModalInfo');
    const labelTitle = document.getElementById('qrModalLabel');
    if (!container) return;

    if (labelTitle) labelTitle.setAttribute('data-active-id', item.id);
    container.replaceChildren();
    
    if (typeof QRCode !== 'undefined') {
        new QRCode(container, {
            text: item.code || item.id,
            width: 220,
            height: 220,
            colorDark: '#000000',
            colorLight: '#ffffff',
            correctLevel: QRCode.CorrectLevel.H
        });
    }

    if (info) {
        setSafeDOM(info, `
            <div class="font-monospace text-info fs-5 fw-bold">${escapeHtml(item.code || 'S/C')}</div>
            <div class="fw-bold text-white fs-6 mt-1">${escapeHtml(item.name)}</div>
            <div class="text-muted small mt-1">📍 ${escapeHtml(item.location || (item.rack ? `${item.rack} - ${item.bin||''}` : 'Sin ubicación asignada'))}</div>
        `);
    }

    const modal = new bootstrap.Modal(document.getElementById('qrModal'));
    modal.show();
};

// ==========================================================================
// ESCÁNERES QR DE CÁMARA
// ==========================================================================
function openQRScanner() {
    const container = document.getElementById('qr-reader');
    if (!container || typeof Html5QrcodeScanner === 'undefined') return;

    if (qrScanner) {
        try { qrScanner.clear(); } catch(e) {}
    }

    try {
        qrScanner = new Html5QrcodeScanner("qr-reader", { fps: 10, qrbox: { width: 250, height: 250 } }, false);
        qrScanner.render(onScanSuccess, () => {});
    } catch(err) {
        console.error('Error iniciando escáner:', err);
    }
}

function onScanSuccess(decodedText) {
    const item = inventoryItems.find(i => i.id === decodedText || (i.code && i.code.toLowerCase() === decodedText.toLowerCase()));
    if (item) {
        const modal = bootstrap.Modal.getInstance(document.getElementById('qrScannerModal'));
        if (modal) modal.hide();
        if (qrScanner) {
            qrScanner.clear();
            qrScanner = null;
        }
        showItemDetails(item.id);
        showAlert(`Artículo detectado: "${item.name}"`, 'success');
    } else {
        showAlert('Código escaneado no encontrado en el inventario: ' + decodedText, 'warning');
    }
}

function openQuickScan() {
    const container = document.getElementById('quick-qr-reader');
    if (!container || typeof Html5QrcodeScanner === 'undefined') return;

    if (quickScanner) {
        try { quickScanner.clear(); } catch(e) {}
    }

    try {
        quickScanner = new Html5QrcodeScanner("quick-qr-reader", { fps: 10, qrbox: { width: 220, height: 220 } }, false);
        quickScanner.render(onQuickScanSuccess, () => {});
    } catch(err) {
        console.error('Error iniciando escáner rápido:', err);
    }
}

function onQuickScanSuccess(decodedText) {
    const item = inventoryItems.find(i => i.id === decodedText || (i.code && i.code.toLowerCase() === decodedText.toLowerCase()));
    if (item) {
        const modal = bootstrap.Modal.getInstance(document.getElementById('quickScanModal'));
        if (modal) modal.hide();
        if (quickScanner) {
            quickScanner.clear();
            quickScanner = null;
        }
        openMovementModal(item.id, 'entrada');
        showAlert(`Artículo detectado: "${item.name}"`, 'success');
    } else {
        showAlert('Código no encontrado en el catálogo: ' + decodedText, 'warning');
    }
}

// ==========================================================================
// GESTIÓN DE CATEGORÍAS Y ÁREAS
// ==========================================================================
async function loadCategories() {
    try {
        const snapshot = await db.collection('inventory_categories').get();
        categories = [];
        snapshot.forEach(doc => categories.push({ id: doc.id, ...doc.data() }));

        if (categories.length === 0) {
            await createDefaultCategories();
        }

        updateCategorySelects();
        renderCategoriesList();
    } catch (error) {
        console.error('Error cargando categorías:', error);
    }
}

async function loadAreas() {
    try {
        const snapshot = await db.collection('inventory_areas').get();
        areas = [];
        snapshot.forEach(doc => areas.push({ id: doc.id, ...doc.data() }));

        if (areas.length === 0) {
            await createDefaultAreas();
        }

        renderAreasList();
    } catch (error) {
        console.error('Error cargando áreas:', error);
    }
}

async function createDefaultCategories() {
    const defaults = [
        { name: 'Sensores', color: 'primary', description: 'Sensores inductivos, ópticos, encoders' },
        { name: 'Refacciones', color: 'success', description: 'Componentes mecánicos, rodamientos' },
        { name: 'Levas', color: 'warning', description: 'Levas mecánicas y sincronizadores' },
        { name: 'Herramientas', color: 'info', description: 'Instrumental y herramientas de mano' },
        { name: 'Consumibles', color: 'secondary', description: 'Tornillería, cables, grasa' }
    ];
    for (const cat of defaults) {
        await db.collection('inventory_categories').add(cat);
    }
    const snap = await db.collection('inventory_categories').get();
    categories = [];
    snap.forEach(d => categories.push({ id: d.id, ...d.data() }));
}

async function createDefaultAreas() {
    const defaults = [
        { name: 'Área 5', code: '5', description: 'Área 5' },
        { name: 'Área 10', code: '10', description: 'Área 10' },
        { name: 'Área 20', code: '20', description: 'Área 20' },
        { name: 'Área 30', code: '30', description: 'Área 30' },
        { name: 'Área 35+', code: '35', description: 'Área 35+' }
    ];
    for (const a of defaults) {
        await db.collection('inventory_areas').add(a);
    }
    const snap = await db.collection('inventory_areas').get();
    areas = [];
    snap.forEach(d => areas.push({ id: d.id, ...d.data() }));
}

function updateCategorySelects() {
    const selects = ['categoryFilter', 'itemCategory', 'editItemCategory'];
    selects.forEach(id => {
        const sel = document.getElementById(id);
        if (!sel) return;
        const cur = sel.value;
        setSafeDOM(sel, id === 'categoryFilter' ? '<option value="">Todas las categorías</option>' : '<option value="">Seleccionar categoría</option>');
        categories.forEach(c => {
            const opt = document.createElement('option');
            opt.value = c.name;
            opt.textContent = c.name;
            if (c.name === cur) opt.selected = true;
            sel.appendChild(opt);
        });
    });
}

function renderCategoriesList() {
    const list = document.getElementById('categoriesList');
    if (!list) return;
    list.replaceChildren();
    categories.forEach(c => {
        const item = document.createElement('div');
        item.className = 'list-group-item bg-dark border-secondary border-opacity-50 text-white d-flex justify-content-between align-items-center mb-1 rounded';
        const color = getCategoryColor(c.name);
        const isCustom = color.startsWith('#');
        setSafeDOM(item, `
            <div>
                <span class="badge ${getCategoryBadgeClass(c.name)}" ${isCustom ? `style="background-color: ${color} !important;"` : ''}>${escapeHtml(c.name)}</span>
                <span class="text-muted small ms-2">${escapeHtml(c.description || '')}</span>
            </div>
            <button class="btn btn-outline-danger btn-sm py-0 px-2" onclick="deleteCategory('${c.id}')"><i class="bi bi-trash"></i></button>
        `);
        list.appendChild(item);
    });
}

async function addNewCategory(event) {
    event.preventDefault();
    const name = document.getElementById('newCategoryName')?.value.trim();
    let color = document.getElementById('newCategoryColor')?.value || 'primary';
    const desc = document.getElementById('newCategoryDescription')?.value.trim() || '';

    if (color === 'custom') {
        color = document.getElementById('customColorInput')?.value || '#007bff';
    }

    if (!name) return;
    try {
        await db.collection('inventory_categories').add({ name, color, description: desc });
        document.getElementById('addCategoryForm')?.reset();
        await loadCategories();
        showAlert(`Categoría "${name}" creada`, 'success');
    } catch(e) {
        showAlert('Error al crear categoría: ' + e.message, 'danger');
    }
}

async function deleteCategory(id) {
    if (confirm('¿Eliminar esta categoría?')) {
        await db.collection('inventory_categories').doc(id).delete();
        await loadCategories();
    }
}

function renderAreasList() {
    const list = document.getElementById('areasList');
    if (!list) return;
    list.replaceChildren();
    areas.forEach(a => {
        const item = document.createElement('div');
        item.className = 'list-group-item bg-dark border-secondary border-opacity-50 text-white d-flex justify-content-between align-items-center mb-1 rounded';
        setSafeDOM(item, `
            <div>
                <strong class="text-info">${escapeHtml(a.name)}</strong> <span class="badge bg-secondary">Código ${escapeHtml(a.code)}</span>
                <span class="text-muted small ms-2">${escapeHtml(a.description || '')}</span>
            </div>
            <button class="btn btn-outline-danger btn-sm py-0 px-2" onclick="deleteArea('${a.id}')"><i class="bi bi-trash"></i></button>
        `);
        list.appendChild(item);
    });
}

async function addNewArea(event) {
    event.preventDefault();
    const name = document.getElementById('newAreaName')?.value.trim();
    const code = document.getElementById('newAreaCode')?.value.trim();
    const desc = document.getElementById('newAreaDescription')?.value.trim() || '';

    if (!name || !code) return;
    try {
        await db.collection('inventory_areas').add({ name, code, description: desc });
        document.getElementById('addAreaForm')?.reset();
        await loadAreas();
        showAlert(`Área "${name}" creada`, 'success');
    } catch(e) {
        showAlert('Error al crear área: ' + e.message, 'danger');
    }
}

async function deleteArea(id) {
    if (confirm('¿Eliminar esta área?')) {
        await db.collection('inventory_areas').doc(id).delete();
        await loadAreas();
    }
}

function setupAreaCheckboxes() {
    const selectAll = document.getElementById('selectAllAreas');
    const areaCbs = ['area5', 'area10', 'area20', 'area30', 'area35'];
    
    if (selectAll) {
        selectAll.addEventListener('change', () => {
            areaCbs.forEach(id => {
                const el = document.getElementById(id);
                if (el) el.checked = selectAll.checked;
            });
            updateSelectedAreasDisplay();
        });
    }

    areaCbs.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.addEventListener('change', updateSelectedAreasDisplay);
    });
}

function updateSelectedAreasDisplay() {
    const areaCbs = ['area5', 'area10', 'area20', 'area30', 'area35'];
    const selected = [];
    areaCbs.forEach(id => {
        const el = document.getElementById(id);
        if (el && el.checked) selected.push(el.nextElementSibling?.textContent || el.value);
    });
    const disp = document.getElementById('selectedAreasDisplay');
    if (disp) disp.textContent = selected.length > 0 ? selected.join(', ') : 'Ninguna';
}

function clearAreaCheckboxes() {
    const areaCbs = ['area5', 'area10', 'area20', 'area30', 'area35', 'selectAllAreas'];
    areaCbs.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.checked = false;
    });
    updateSelectedAreasDisplay();
}

function initializeColorPicker() {
    const sel = document.getElementById('newCategoryColor');
    const cont = document.getElementById('colorPickerContainer');
    if (sel && cont) {
        sel.addEventListener('change', () => {
            cont.style.display = sel.value === 'custom' ? 'block' : 'none';
        });
    }
}

// ==========================================================================
// GRÁFICOS Y ANALÍTICA DE INVENTARIO
// ==========================================================================
function invalidateMovementsCache() {
    cachedMovements = null;
}

function parseMovementTimestamp(ts) {
    if (!ts) return null;
    if (typeof ts.toDate === 'function') return ts.toDate();
    const d = new Date(ts);
    return isNaN(d.getTime()) ? null : d;
}

function destroyChart(chart) {
    if (chart) chart.destroy();
}

function getChartDayBuckets(days) {
    const buckets = [];
    const today = new Date();
    today.setHours(23, 59, 59, 999);
    for (let i = days - 1; i >= 0; i--) {
        const d = new Date(today);
        d.setDate(d.getDate() - i);
        d.setHours(0, 0, 0, 0);
        const end = new Date(d);
        end.setHours(23, 59, 59, 999);
        const label = d.toLocaleDateString('es-MX', { day: '2-digit', month: 'short' });
        buckets.push({ label, start: d, end, entrada: 0, salida: 0 });
    }
    return buckets;
}

function aggregateMovementsByDay(movements, days) {
    const buckets = getChartDayBuckets(days);
    const rangeStart = buckets[0]?.start;
    if (!rangeStart) return buckets;

    movements.forEach(m => {
        const date = parseMovementTimestamp(m.timestamp);
        if (!date || date < rangeStart) return;
        const bucket = buckets.find(b => date >= b.start && date <= b.end);
        if (!bucket) return;
        const qty = Number(m.quantity) || 0;
        if (qty <= 0) return;

        const type = (m.type || '').toLowerCase();
        if (type === 'entrada') bucket.entrada += qty;
        else if (type === 'salida') bucket.salida += qty;
    });
    return buckets;
}

async function loadInventoryCharts(forceReload = false) {
    if (sessionStorage.getItem('inventoryAuthenticated') !== 'true') return;
    if (typeof Chart === 'undefined') return;

    try {
        if (forceReload || !cachedMovements) {
            const days = parseInt(document.getElementById('chartPeriodSelect')?.value || '30', 10);
            const cutoffDate = new Date();
            cutoffDate.setDate(cutoffDate.getDate() - (days + 2));
            
            let snapshot;
            try {
                snapshot = await db.collection('inventory_movements')
                    .where('timestamp', '>=', cutoffDate)
                    .limit(300)
                    .get();
            } catch (queryErr) {
                // Fallback si no hay índice compuesto en timestamp
                snapshot = await db.collection('inventory_movements')
                    .limit(300)
                    .get();
            }
            cachedMovements = [];
            snapshot.forEach(doc => cachedMovements.push({ id: doc.id, ...doc.data() }));
        }
        const days = parseInt(document.getElementById('chartPeriodSelect')?.value || '30', 10);
        renderInventoryCharts(cachedMovements, inventoryItems, days);
    } catch (error) {
        console.error('Error cargando gráficos de inventario:', error);
    }
}

function renderInventoryCharts(movements, items, days) {
    if (typeof Chart === 'undefined') return;
    Chart.defaults.color = '#94a3b8';
    Chart.defaults.borderColor = 'rgba(255, 255, 255, 0.06)';

    const buckets = aggregateMovementsByDay(movements, days);
    const labels = buckets.map(b => b.label);
    const entradas = buckets.map(b => b.entrada);
    const salidas = buckets.map(b => b.salida);
    const totalEntrada = entradas.reduce((s, v) => s + v, 0);
    const totalSalida = salidas.reduce((s, v) => s + v, 0);

    destroyChart(movementsBarChart);
    const barCtx = document.getElementById('movementsBarChart');
    if (barCtx) {
        movementsBarChart = new Chart(barCtx, {
            type: 'bar',
            data: {
                labels,
                datasets: [
                    { label: 'Entradas', data: entradas, backgroundColor: 'rgba(16, 185, 129, 0.8)', borderRadius: 4 },
                    { label: 'Salidas', data: salidas, backgroundColor: 'rgba(239, 68, 68, 0.8)', borderRadius: 4 }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { position: 'top' } },
                scales: {
                    x: { grid: { color: 'rgba(255,255,255,0.04)' } },
                    y: { beginAtZero: true, ticks: { stepSize: 1 }, grid: { color: 'rgba(255,255,255,0.04)' } }
                }
            }
        });
    }

    destroyChart(movementSummaryChart);
    const pieCtx = document.getElementById('movementSummaryChart');
    if (pieCtx) {
        const hasData = totalEntrada > 0 || totalSalida > 0;
        movementSummaryChart = new Chart(pieCtx, {
            type: 'doughnut',
            data: {
                labels: hasData ? ['Entradas', 'Salidas'] : ['Sin movimientos'],
                datasets: [{
                    data: hasData ? [totalEntrada, totalSalida] : [1],
                    backgroundColor: hasData
                        ? ['rgba(16, 185, 129, 0.85)', 'rgba(239, 68, 68, 0.85)']
                        : ['rgba(100, 116, 139, 0.4)']
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { position: 'bottom' } }
            }
        });
    }

    const lowStockItems = items
        .filter(i => (Number(i.stock) || 0) <= (Number(i.minStock) || 0))
        .sort((a, b) => (Number(a.stock) || 0) - (Number(b.stock) || 0))
        .slice(0, 10);

    destroyChart(lowStockChart);
    const lowCtx = document.getElementById('lowStockChart');
    if (lowCtx) {
        if (lowStockItems.length === 0) {
            lowStockChart = new Chart(lowCtx, {
                type: 'bar',
                data: {
                    labels: ['Sin alertas'],
                    datasets: [{ label: 'Stock', data: [0], backgroundColor: 'rgba(16, 185, 129, 0.5)' }]
                },
                options: {
                    indexAxis: 'y',
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: { legend: { display: false } },
                    scales: { x: { beginAtZero: true } }
                }
            });
        } else {
            lowStockChart = new Chart(lowCtx, {
                type: 'bar',
                data: {
                    labels: lowStockItems.map(i => {
                        const name = i.name || i.code || 'Item';
                        return name.length > 18 ? name.slice(0, 16) + '…' : name;
                    }),
                    datasets: [
                        { label: 'Stock Actual', data: lowStockItems.map(i => Number(i.stock) || 0), backgroundColor: 'rgba(239, 68, 68, 0.8)', borderRadius: 4 },
                        { label: 'Stock Mínimo', data: lowStockItems.map(i => Number(i.minStock) || 0), backgroundColor: 'rgba(245, 158, 11, 0.4)', borderRadius: 4 }
                    ]
                },
                options: {
                    indexAxis: 'y',
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: { legend: { position: 'top' } },
                    scales: { x: { beginAtZero: true } }
                }
            });
        }
    }
}

window.refreshInventoryCharts = function() {
    invalidateMovementsCache();
    loadInventoryCharts(true);
};

// ==========================================================================
// AUTORIZACIÓN DE SOLICITUDES DE REFACCIÓN
// ==========================================================================
let refactionRequests = [];

async function fetchRefactionRequests() {
    try {
        refactionRequests = typeof window.fetchAllRefactionRequests === 'function' ? await window.fetchAllRefactionRequests() : [];
        renderRefactionRequestsTable();
        updateRefactionRequestsStats();
    } catch (error) {
        console.error('Error cargando solicitudes:', error);
    }
}

async function loadRefactionRequests() {
    await fetchRefactionRequests();
}

function updateRefactionRequestsStats() {
    const pending = refactionRequests.filter(r => r.status === 'pending').length;
    const now = new Date();
    const approvedToday = refactionRequests.filter(r => {
        if (r.status !== 'approved' || !r.approvedAt) return false;
        const d = r.approvedAt.toDate ? r.approvedAt.toDate() : new Date(r.approvedAt);
        return d.toDateString() === now.toDateString();
    }).length;

    const pEl = document.getElementById('pendingRequestsCount');
    const aEl = document.getElementById('approvedTodayCount');
    const bEl = document.getElementById('pendingRequestsBadge');

    if (pEl) pEl.textContent = pending;
    if (aEl) aEl.textContent = approvedToday;
    if (bEl) {
        bEl.textContent = pending;
        bEl.style.display = pending > 0 ? 'inline' : 'none';
    }
}

function renderRefactionRequestsTable() {
    const tbody = document.getElementById('refactionRequestsTableBody');
    if (!tbody) return;
    tbody.replaceChildren();

    if (refactionRequests.length === 0) {
        setSafeDOM(tbody, '<tr><td colspan="9" class="text-center text-muted py-4">No hay solicitudes registradas</td></tr>');
        return;
    }

    refactionRequests.forEach(req => {
        const tr = document.createElement('tr');
        const isPending = req.status === 'pending';
        setSafeDOM(tr, `
            <td class="small">${formatDate(req.createdAt)}</td>
            <td class="small fw-bold text-white">${escapeHtml(req.equipmentName || req.equipmentId || 'General')}</td>
            <td class="small">${escapeHtml(req.category || 'Refacción')}</td>
            <td class="small text-info fw-bold">${escapeHtml(req.refactionName || req.refactionId)}</td>
            <td class="small text-center font-monospace">${req.quantity || 1}</td>
            <td class="small text-truncate" style="max-width: 140px;">${escapeHtml(req.reason || req.description || 'Falla')}</td>
            <td class="small text-muted">${escapeHtml(req.requesterName || req.technician || 'Técnico')}</td>
            <td class="small">
                <span class="badge ${isPending ? 'bg-warning text-dark' : req.status === 'approved' ? 'bg-success' : 'bg-danger'}">
                    ${isPending ? 'Pendiente' : req.status === 'approved' ? 'Autorizado' : 'Rechazado'}
                </span>
            </td>
            <td style="text-align: end;">
                ${isPending ? `
                    <button class="btn btn-sm btn-success py-0 px-2" onclick="approveRequest('${req.id}')" title="Autorizar"><i class="bi bi-check"></i></button>
                    <button class="btn btn-sm btn-danger py-0 px-2" onclick="rejectRequest('${req.id}')" title="Rechazar"><i class="bi bi-x"></i></button>
                ` : `
                    <span class="text-muted small">Procesado</span>
                `}
            </td>
        `);
        tbody.appendChild(tr);
    });
}

async function approveRequest(requestId) {
    if (!confirm('¿Autorizar esta solicitud de refacción y descontar de inventario?')) return;
    try {
        const req = refactionRequests.find(r => r.id === requestId);
        if (!req) return;

        // Descontar inventario si existe artículo coincidente
        const itm = inventoryItems.find(i => i.id === req.refactionId || (i.code && i.code === req.refactionId) || (i.name && i.name.toLowerCase() === (req.refactionName || '').toLowerCase()));
        if (itm) {
            const qty = Number(req.quantity) || 1;
            const newStock = Math.max(0, (Number(itm.stock) || 0) - qty);
            await db.collection('inventory').doc(itm.id).update({
                stock: newStock,
                lastMovement: new Date()
            });
            await db.collection('inventory_movements').add({
                itemId: itm.id,
                itemCode: itm.code || 'S/C',
                itemName: itm.name || req.refactionName,
                type: 'salida',
                quantity: qty,
                reasonType: 'Solicitud Autorizada',
                description: `OT / Refacción: ${req.reason || ''} (Solicitó: ${req.requesterName || 'Técnico'})`,
                timestamp: new Date(),
                responsible: sessionStorage.getItem('username') || 'Admin Inventario',
                previousStock: itm.stock,
                newStock: newStock
            });
        }

        await db.collection('refaction_requests').doc(requestId).update({
            status: 'approved',
            approvedAt: firebase.firestore.FieldValue.serverTimestamp(),
            approvedBy: sessionStorage.getItem('username') || 'Admin Inventario'
        });

        showAlert('Solicitud autorizada exitosamente', 'success');
        await fetchRefactionRequests();
    } catch(err) {
        showAlert('Error al autorizar solicitud: ' + err.message, 'danger');
    }
}

async function rejectRequest(requestId) {
    if (!confirm('¿Rechazar esta solicitud de refacción?')) return;
    try {
        await db.collection('refaction_requests').doc(requestId).update({
            status: 'rejected',
            rejectedAt: firebase.firestore.FieldValue.serverTimestamp(),
            rejectedBy: sessionStorage.getItem('username') || 'Admin Inventario'
        });
        showAlert('Solicitud rechazada', 'info');
        await fetchRefactionRequests();
    } catch(err) {
        showAlert('Error al rechazar solicitud: ' + err.message, 'danger');
    }
}

function startNotificationCheck() {
    if (window.notificationUnsubscribe) return;
    try {
        window.notificationUnsubscribe = db.collection('refaction_requests')
            .where('status', '==', 'pending')
            .onSnapshot(snap => {
                const count = snap.size;
                const badge = document.getElementById('pendingRequestsBadge');
                if (badge) {
                    badge.textContent = count;
                    badge.style.display = count > 0 ? 'inline' : 'none';
                }
                const cnt = document.getElementById('pendingRequestsCount');
                if (cnt) cnt.textContent = count;
            }, () => {});
    } catch(e) {}
}

function stopNotificationCheck() {
    if (window.notificationUnsubscribe) {
        window.notificationUnsubscribe();
        window.notificationUnsubscribe = null;
    }
}

function exportRefactionRequestsReport() {
    const csv = [
        ['Fecha', 'Equipo', 'Categoria', 'Refaccion', 'Cantidad', 'Motivo', 'Solicitante', 'Estado'].join(',')
    ];
    refactionRequests.forEach(r => {
        csv.push([
            `"${formatDate(r.createdAt)}"`,
            `"${r.equipmentName || ''}"`,
            `"${r.category || ''}"`,
            `"${r.refactionName || ''}"`,
            r.quantity || 1,
            `"${(r.reason || '').replace(/"/g, '""')}"`,
            `"${r.requesterName || ''}"`,
            `"${r.status || ''}"`
        ].join(','));
    });
    const blob = new Blob([csv.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `reporte_solicitudes_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
}

// ==========================================================================
// EXPORTACIÓN / IMPORTACIÓN DE CONFIGURACIÓN
// ==========================================================================
function exportInventoryConfig() {
    const config = {
        categories: categories,
        items: inventoryItems,
        exportDate: new Date().toISOString(),
        version: '3.0'
    };
    const blob = new Blob([JSON.stringify(config, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `catalogo_inventario_${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    showAlert('Catálogo de inventario exportado en JSON', 'success');
}

function importInventoryConfig() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = async function(event) {
        const file = event.target.files[0];
        if (!file) return;
        try {
            const text = await file.text();
            const config = JSON.parse(text);
            if (confirm(`¿Deseas importar ${config.items?.length || 0} artículos al catálogo?`)) {
                let imported = 0;
                for (const item of (config.items || [])) {
                    const existing = inventoryItems.find(i => i.code === item.code);
                    if (!existing) {
                        const { id, ...data } = item;
                        await db.collection('inventory').add(data);
                        imported++;
                    }
                }
                showAlert(`Importados ${imported} artículos nuevos`, 'success');
            }
        } catch(e) {
            showAlert('Error importando archivo JSON: ' + e.message, 'danger');
        }
    };
    input.click();
}

// ==========================================================================
// AUTENTICACIÓN DEL PORTAL DE INVENTARIO
// ==========================================================================
function checkInventoryAuth() {
    const isAuth = sessionStorage.getItem('inventoryAuthenticated') === 'true';
    if (isAuth) {
        showInventoryAuthenticatedUi();
        return true;
    }
    const main = document.getElementById('mainContent');
    if (main) main.style.display = 'none';
    showInventoryLoginModal();
    return false;
}

function showInventoryAuthenticatedUi() {
    const main = document.getElementById('mainContent');
    if (main) main.style.display = 'block';
    const logoutBtn = document.getElementById('inventoryLogoutBtn');
    if (logoutBtn) logoutBtn.style.display = 'block';
}

function showInventoryLoginModal() {
    let loginModal = document.getElementById('inventoryLoginModal');
    if (!loginModal) {
        const modalHTML = `
            <div class="modal fade" id="inventoryLoginModal" data-bs-backdrop="static" data-bs-keyboard="false" tabindex="-1">
                <div class="modal-dialog modal-dialog-centered">
                    <div class="modal-content" style="background: #0d1117; border: 1px solid rgba(56, 189, 248, 0.25); box-shadow: 0 24px 64px rgba(0,0,0,0.85);">
                        <div class="modal-header text-white d-flex justify-content-between align-items-center" style="background: rgba(15, 23, 42, 0.95); border-bottom: 1px solid rgba(255,255,255,0.08);">
                            <h5 class="modal-title mb-0" style="font-weight: 700; font-size: 1rem;"><i class="bi bi-shield-lock text-info me-2"></i>Acceso al Catálogo de Inventario</h5>
                            <a href="index.html" class="btn btn-sm btn-outline-light" style="border-radius: 8px; font-weight: 500; font-size: 0.78rem;">
                                <i class="bi bi-arrow-left"></i> Monitor
                            </a>
                        </div>
                        <div class="modal-body p-4">
                            <p class="text-muted small mb-3">Ingresa credenciales autorizadas para gestionar el inventario maestro de refacciones industriales.</p>
                            <form id="inventoryLoginForm">
                                <div class="mb-3">
                                    <label for="inventoryUsername" class="form-label small text-uppercase fw-bold text-muted">Usuario</label>
                                    <input type="text" class="form-control search-box-pro" id="inventoryUsername" placeholder="Usuario autorizado" required>
                                </div>
                                <div class="mb-3">
                                    <label for="inventoryPassword" class="form-label small text-uppercase fw-bold text-muted">Contraseña</label>
                                    <input type="password" class="form-control search-box-pro" id="inventoryPassword" placeholder="••••••••" required>
                                </div>
                                <div class="alert alert-danger py-2 small" id="inventoryLoginError" style="display: none;">
                                    <i class="bi bi-exclamation-octagon me-1"></i> Credenciales no válidas
                                </div>
                                <div class="d-grid gap-2 mt-4">
                                    <button type="submit" class="btn btn-primary fw-semibold">
                                        <i class="bi bi-unlock-fill me-1"></i> Desbloquear Inventario
                                    </button>
                                </div>
                            </form>
                        </div>
                    </div>
                </div>
            </div>
        `;
        document.body.insertAdjacentHTML('beforeend', modalHTML);

        document.getElementById('inventoryLoginForm')?.addEventListener('submit', async (e) => {
            e.preventDefault();
            const username = (document.getElementById('inventoryUsername')?.value || '').trim();
            const password = (document.getElementById('inventoryPassword')?.value || '').trim();
            
            try {
                const hash = await window.sha256Hex(`${username}:${password}:operations-monitor-2026-salt`);
                
                if (hash === 'a157f1732cb467ca299f45db9706d4ef0cc10f42dbbb9978a6e6cacdc6b999a1') {
                    sessionStorage.setItem('inventoryAuthenticated', 'true');
                    sessionStorage.setItem('username', username);
                    bootstrap.Modal.getInstance(document.getElementById('inventoryLoginModal')).hide();
                    showInventoryAuthenticatedUi();
                    loadCategories();
                    loadAreas();
                    initInventoryRealtimeListener();
                    initActivePicksListener();
                    setupEventListeners();
                    showAlert('Sesión iniciada correctamente', 'success');
                    return;
                }
            } catch (err) {
                console.error('Error durante autenticación:', err);
            }
            
            document.getElementById('inventoryLoginError').style.display = 'block';
            document.getElementById('inventoryPassword').value = '';
        });
    }

    const modal = new bootstrap.Modal(document.getElementById('inventoryLoginModal'));
    modal.show();
}

window.logoutInventory = function() {
    sessionStorage.removeItem('inventoryAuthenticated');
    window.location.href = 'index.html';
};

// ==========================================================================
// FUNCIONES AUXILIARES DE ESTILO Y PRESENTACIÓN
// ==========================================================================
function getCategoryName(category) {
    const cat = categories.find(c => c.name === category);
    return cat ? cat.name : category || 'General';
}

function getCategoryColor(category) {
    const cat = categories.find(c => c.name === category);
    return cat ? cat.color : 'secondary';
}

function getCategoryBadgeClass(category) {
    const color = getCategoryColor(category);
    if (color && !color.startsWith('#')) return `bg-${color}`;
    return 'bg-secondary';
}

function getStatusClass(stock, minStock) {
    if (stock <= 0) return 'bg-danger text-white';
    if (stock <= (minStock || 0)) return 'bg-warning text-dark';
    return 'bg-success text-white';
}

function getStatusIcon(stock, minStock) {
    if (stock <= 0) return '✕';
    if (stock <= (minStock || 0)) return '⚠';
    return '✓';
}

function getStatusText(stock, minStock) {
    if (stock <= 0) return 'Agotado';
    if (stock <= (minStock || 0)) return 'Bajo Stock';
    return 'En Stock';
}

function formatDate(timestamp) {
    if (!timestamp) return '—';
    const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
    if (isNaN(date.getTime())) return '—';
    return date.toLocaleDateString('es-MX', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    });
}

function showAlert(message, type = 'info') {
    const alertDiv = document.createElement('div');
    alertDiv.className = `alert alert-${type} alert-dismissible fade show shadow-lg position-fixed top-0 start-50 translate-middle-x mt-3`;
    alertDiv.style.zIndex = '9999';
    alertDiv.style.maxWidth = '90%';
    setSafeDOM(alertDiv, `
        <div class="d-flex align-items-center gap-2">
            <span>${message}</span>
            <button type="button" class="btn-close" data-bs-dismiss="alert"></button>
        </div>
    `);
    document.body.appendChild(alertDiv);
    setTimeout(() => { if (alertDiv.parentNode) alertDiv.remove(); }, 4000);
}

// Exponer funciones necesarias a window para llamadas inline en HTML
window.editItem = editItem;
window.deleteItem = deleteItem;
window.showItemDetails = showItemDetails;
window.openMovementModal = openMovementModal;
window.quickStockAdjust = quickStockAdjust;
window.exportInventoryConfig = exportInventoryConfig;
window.importInventoryConfig = importInventoryConfig;
window.openQRLabelStudio = openQRLabelStudio;
window.executePrintLabels = executePrintLabels;
window.loadRefactionRequests = loadRefactionRequests;
window.approveRequest = approveRequest;
window.rejectRequest = rejectRequest;
window.exportRefactionRequestsReport = exportRefactionRequestsReport;
window.deleteCategory = deleteCategory;
window.deleteArea = deleteArea;
window.addNewCategory = addNewCategory;
window.addNewArea = addNewArea;
window.updateMovementPreview = updateMovementPreview;
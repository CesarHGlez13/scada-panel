// 🛡️ HELPER DE SEGURIDAD DOM SEGURO (Elimina DOM XSS)
if (!window.setSafeDOM) window.setSafeDOM = function setSafeDOM(element, htmlString) {
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
};

/**
 * ============================================================================
 * MONITOR INDUSTRIAL SCADA - GESTIÓN DE ALMACÉN PICK-TO-LIGHT (OPERATIVO)
 * ============================================================================
 * Módulo de planta y visualización operativa de estanterías, gavetas y refacciones.
 * Conectado en tiempo real con Firestore, Tiras LED ESP32 y WhatsApp Bot.
 */

(function () {
    'use strict';

    let dbInstance = null;
    let warehouseConfig = null;
    let allWhHardwareConfig = {};
    let inventoryItemsMap = new Map();
    let activePicksMap = new Map();
    let activePicksByBinMap = new Map();
    let selectedRackFilter = 'all';
    let searchQuery = '';
    let currentView = 'grid';

    let configUnsubscribe = null;
    let hardwareUnsubscribe = null;
    let inventoryUnsubscribe = null;
    let activePicksUnsubscribe = null;

    let userNames = [];

    function escapeHtml(text) {
      if (!text) return '';
      return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
    }

    function loadUserNames() {
        try {
            const saved = localStorage.getItem('userNames');
            if (saved) {
                userNames = JSON.parse(saved);
                updateUserNamesDatalist();
            }
        } catch (e) {
            console.warn('Error cargando userNames:', e);
        }
    }

    function saveUserName(name) {
        if (name && !userNames.includes(name)) {
            userNames.push(name);
            try {
                localStorage.setItem('userNames', JSON.stringify(userNames));
            } catch (e) {}
            updateUserNamesDatalist();
        }
    }

    function updateUserNamesDatalist() {
        const datalists = [document.getElementById('whUserNamesList')];
        datalists.forEach(dl => {
            if (!dl) return;
            dl.replaceChildren();
            userNames.forEach(u => {
                const opt = document.createElement('option');
                opt.value = u;
                dl.appendChild(opt);
            });
        });
    }

    // Inicializar Conexión Firestore
    function getDb() {
        if (!dbInstance && typeof firebase !== 'undefined' && firebase.firestore) {
            dbInstance = firebase.firestore();
        }
        return dbInstance;
    }

    // Inicialización del Módulo
    function initWarehouseModule() {
        const db = getDb();
        if (!db) {
            console.warn("Firestore aún no está disponible, reintentando...");
            setTimeout(initWarehouseModule, 300);
            return;
        }

        loadUserNames();
        setupViewToggles();
        setupSearchControls();
        setupModalForms();

        const btnRefresh = document.getElementById('whBtnRefresh');
        if (btnRefresh) {
            btnRefresh.addEventListener('click', () => {
                btnRefresh.classList.add('animate-spin');
                renderWarehouseCards();
                updateTodayPicksCount();
                setTimeout(() => btnRefresh.classList.remove('animate-spin'), 600);
            });
        }

        // 1. Escuchar Configuración de Racks
        if (configUnsubscribe) configUnsubscribe();
        configUnsubscribe = db.collection('config').doc('warehouse_config').onSnapshot(doc => {
            if (doc.exists) {
                warehouseConfig = doc.data() || {};
            } else {
                warehouseConfig = {
                    _order: ['rack_a', 'rack_b', 'gavetero_1'],
                    rack_a: { name: 'Rack A (Mecánica)', bins: [] },
                    rack_b: { name: 'Rack B (Eléctrica)', bins: [] },
                    gavetero_1: { name: 'Gavetero Tornillos', bins: [] }
                };
            }
            renderRackFilterButtons();
            renderWarehouseCards();
            updateTodayPicksCount();
            if (typeof hidePageLoader === 'function') hidePageLoader();
        }, err => console.error("Error escuchando warehouse_config:", err));

        // 2. Escuchar Hardware ESP32
        if (hardwareUnsubscribe) hardwareUnsubscribe();
        hardwareUnsubscribe = db.collection('config').doc('warehouse_hardware').onSnapshot(doc => {
            if (doc.exists) {
                allWhHardwareConfig = doc.data() || {};
                renderWarehouseCards();
            }
        }, err => console.warn("Aviso escuchando warehouse_hardware:", err));

        // 3. Escuchar Catálogo de Inventario
        if (inventoryUnsubscribe) inventoryUnsubscribe();
        inventoryUnsubscribe = db.collection('inventory').onSnapshot(snap => {
            inventoryItemsMap.clear();
            snap.forEach(doc => {
                const data = doc.data();
                data.id = doc.id;
                inventoryItemsMap.set(doc.id, data);
                if (data.code) inventoryItemsMap.set(String(data.code).toLowerCase(), data);
            });
            renderWarehouseCards();
        }, err => console.error("Error escuchando inventory:", err));

        // 4. Escuchar Picks Activos (Luz encendida)
        if (activePicksUnsubscribe) activePicksUnsubscribe();
        activePicksUnsubscribe = db.collection('active_picks').where('status', '==', 'active').onSnapshot(snap => {
            activePicksMap.clear();
            activePicksByBinMap.clear();

            snap.forEach(doc => {
                const data = doc.data();
                data.id = doc.id;
                if (data.itemId) activePicksMap.set(data.itemId, data);
                if (data.warehouseBinId) {
                    activePicksByBinMap.set(data.warehouseBinId, data);
                    activePicksMap.set(data.warehouseBinId, data);
                }
                if (data.itemCode) activePicksMap.set(String(data.itemCode).toLowerCase(), data);
            });

            const activePicksCountEl = document.getElementById('activeWhPicksCount');
            if (activePicksCountEl) {
                activePicksCountEl.textContent = snap.size;
            }

            renderRackFilterButtons();
            renderWarehouseCards();
        }, err => console.error("Error escuchando active_picks:", err));

        updateTodayPicksCount();
    }

    // Contar picks completados hoy
    async function updateTodayPicksCount() {
        const db = getDb();
        if (!db) return;
        try {
            const startOfToday = new Date();
            startOfToday.setHours(0, 0, 0, 0);

            const snap = await db.collection('active_picks')
                .where('status', '==', 'picked')
                .limit(100)
                .get();

            const resolvedTodayEl = document.getElementById('resolvedWhPicksToday');
            if (resolvedTodayEl) {
                resolvedTodayEl.textContent = snap.size;
            }
        } catch (e) {
            console.warn("Aviso contando picks completados:", e.message);
        }
    }

    // Configurar Toggles de Vista (Grid / Lista)
    function setupViewToggles() {
        const btnGrid = document.getElementById('view-grid');
        const btnList = document.getElementById('view-list');
        if (btnGrid && btnList) {
            btnGrid.addEventListener('click', () => {
                currentView = 'grid';
                btnGrid.classList.add('active');
                btnList.classList.remove('active');
                renderWarehouseCards();
            });
            btnList.addEventListener('click', () => {
                currentView = 'list';
                btnList.classList.add('active');
                btnGrid.classList.remove('active');
                renderWarehouseCards();
            });
        }
    }

    // Configurar Controles de Búsqueda
    function setupSearchControls() {
        const searchInput = document.getElementById('whSearchInput');
        const clearBtn = document.getElementById('whClearSearchBtn');

        if (searchInput) {
            searchInput.addEventListener('input', (e) => {
                searchQuery = (e.target.value || '').trim().toLowerCase();
                renderWarehouseCards();
            });
        }

        if (clearBtn && searchInput) {
            clearBtn.addEventListener('click', () => {
                searchInput.value = '';
                searchQuery = '';
                renderWarehouseCards();
                searchInput.focus();
            });
        }
    }

    // Renderizar Botones de Filtro por Rack
    function renderRackFilterButtons() {
        const filterGroup = document.getElementById('wh-racks-filter-group');
        if (!filterGroup || !warehouseConfig) return;

        const allRackKeys = Object.keys(warehouseConfig).filter(k => k !== '_order' && typeof warehouseConfig[k] === 'object');
        const orderedKeys = warehouseConfig._order
            ? warehouseConfig._order.filter(k => allRackKeys.includes(k))
            : [...allRackKeys];
        allRackKeys.forEach(k => { if (!orderedKeys.includes(k)) orderedKeys.push(k); });

        filterGroup.replaceChildren();

        // Botón "Todos"
        const allBtn = document.createElement('button');
        allBtn.className = `btn btn-outline-primary btn-sm ${selectedRackFilter === 'all' ? 'active' : ''}`;
        allBtn.dataset.rack = 'all';
        setSafeDOM(allBtn, `<i class="bi bi-grid-fill"></i> Todos`);
        allBtn.addEventListener('click', () => {
            selectedRackFilter = 'all';
            updateActiveFilterBtn(filterGroup, allBtn);
            renderWarehouseCards();
        });
        filterGroup.appendChild(allBtn);

        // Botones dinámicos por Rack
        orderedKeys.forEach(rackKey => {
            const rack = warehouseConfig[rackKey];
            const rackName = rack?.name || rackKey.replace('rack_', 'Rack ');
            const bins = rack?.bins || [];

            // Contar si hay picks activos en este rack
            const activeInRack = bins.filter(b => activePicksByBinMap.has(b.binId) || (b.itemId && activePicksMap.has(b.itemId))).length;

            const btn = document.createElement('button');
            btn.className = `btn btn-outline-primary btn-sm ${selectedRackFilter === rackKey ? 'active' : ''}`;
            btn.dataset.rack = rackKey;
            setSafeDOM(btn, `
                <i class="bi bi-box-seam"></i> ${escapeHtml(rackName)}
                <span class="badge ${selectedRackFilter === rackKey ? 'bg-white text-dark' : 'bg-secondary'} ms-1">${bins.length}</span>
                ${activeInRack > 0 ? `<span class="badge bg-warning text-dark ms-1 animate-pulse"><i class="bi bi-lightbulb-fill"></i> ${activeInRack}</span>` : ''}
            `);
            btn.addEventListener('click', () => {
                selectedRackFilter = rackKey;
                updateActiveFilterBtn(filterGroup, btn);
                renderWarehouseCards();
            });
            filterGroup.appendChild(btn);
        });

        // Actualizar Badge de Racks Totales
        const totalRacksBadge = document.getElementById('whTotalRacksBadge');
        if (totalRacksBadge) {
            totalRacksBadge.textContent = `${orderedKeys.length} Racks`;
        }
    }

    function updateActiveFilterBtn(group, activeBtn) {
        group.querySelectorAll('button').forEach(b => b.classList.remove('active'));
        activeBtn.classList.add('active');
        const badge = document.getElementById('activeRackTitleBadge');
        if (badge) {
            badge.textContent = activeBtn.innerText.trim();
        }
    }

    // Renderizar Tarjetas de Gavetas / Artículos
    function renderWarehouseCards() {
        const container = document.getElementById('warehouse-container');
        if (!container || !warehouseConfig) return;

        const allRackKeys = Object.keys(warehouseConfig).filter(k => k !== '_order' && typeof warehouseConfig[k] === 'object');
        const orderedKeys = warehouseConfig._order
            ? warehouseConfig._order.filter(k => allRackKeys.includes(k))
            : [...allRackKeys];
        allRackKeys.forEach(k => { if (!orderedKeys.includes(k)) orderedKeys.push(k); });

        // Recolectar todas las gavetas según filtro de Rack
        let flatBins = [];
        orderedKeys.forEach(rackKey => {
            if (selectedRackFilter !== 'all' && selectedRackFilter !== rackKey) return;
            const rack = warehouseConfig[rackKey];
            const rackName = rack?.name || rackKey.replace('rack_', 'Rack ');
            const hw = allWhHardwareConfig[rackKey] || { esp32Id: `ESP32-${rackKey.toUpperCase()}`, ledsPerBin: 4, dataPin: 5 };
            const bins = rack?.bins || [];

            bins.forEach((b, idx) => {
                flatBins.push({
                    ...b,
                    rackKey: rackKey,
                    rackName: rackName,
                    hw: hw,
                    binIndex: idx
                });
            });
        });

        // Aplicar Filtro de Búsqueda
        if (searchQuery) {
            flatBins = flatBins.filter(b => {
                const binId = (b.binId || '').toLowerCase();
                const binName = (b.name || '').toLowerCase();
                const rackName = (b.rackName || '').toLowerCase();
                let itemName = '';
                let itemCode = '';
                let itemCat = '';

                if (b.itemId && inventoryItemsMap.has(b.itemId)) {
                    const it = inventoryItemsMap.get(b.itemId);
                    itemName = (it.name || '').toLowerCase();
                    itemCode = (it.code || '').toLowerCase();
                    itemCat = (it.category || '').toLowerCase();
                }

                return binId.includes(searchQuery) ||
                       binName.includes(searchQuery) ||
                       rackName.includes(searchQuery) ||
                       itemName.includes(searchQuery) ||
                       itemCode.includes(searchQuery) ||
                       itemCat.includes(searchQuery);
            });
        }

        // Actualizar contador filtrado
        const badgeCount = document.getElementById('whFilteredCountBadge');
        if (badgeCount) {
            badgeCount.textContent = `Mostrando ${flatBins.length} gavetas`;
        }

        // Actualizar total general de bins
        let totalGeneral = 0;
        orderedKeys.forEach(k => { totalGeneral += (warehouseConfig[k]?.bins || []).length; });
        const totalBinsEl = document.getElementById('totalWhBinsCount');
        if (totalBinsEl) totalBinsEl.textContent = totalGeneral;

        container.replaceChildren();

        if (flatBins.length === 0) {
            setSafeDOM(container, `
                <div class="col-12 text-center py-5">
                    <i class="bi bi-inboxes text-muted" style="font-size: 3rem;"></i>
                    <h5 class="text-muted mt-3">No se encontraron gavetas ni refacciones</h5>
                    <p class="text-muted small">Intenta con otro término de búsqueda o selecciona otro rack.</p>
                </div>
            `);
            return;
        }

        flatBins.forEach(bin => {
            const cardEl = createWarehouseBinCard(bin);
            container.appendChild(cardEl);
        });
    }

    // Crear Tarjeta de Gaveta Individual
    function createWarehouseBinCard(bin) {
        const col = document.createElement('div');
        col.className = currentView === 'list' ? 'col-12' : 'col-12 col-md-6 col-lg-4';

        // Comprobar si hay un pick activo para esta gaveta o artículo
        const activePick = activePicksByBinMap.get(bin.binId) || (bin.itemId && activePicksMap.get(bin.itemId)) || null;
        const isLit = !!activePick;

        // Comprobar datos del artículo en inventario
        const item = bin.itemId && inventoryItemsMap.has(bin.itemId) ? inventoryItemsMap.get(bin.itemId) : null;
        const currentStock = item ? (item.stock !== undefined ? item.stock : 0) : null;
        const minStock = item ? (item.minStock || 0) : 0;
        const isLowStock = item && currentStock <= minStock;

        // Estado visual Andon
        let statusBadge = '<span class="badge bg-success"><i class="bi bi-check-circle-fill"></i> Disponible</span>';
        let cardBorderClass = 'border-success operational';

        const isPutToLight = activePick && (activePick.mode === 'put_to_light' || activePick.source === 'inventory_locator');

        if (isLit) {
            if (isPutToLight) {
                statusBadge = '<span class="badge bg-success text-white animate-pulse"><i class="bi bi-box-arrow-in-down-fill"></i> Baliza / Guardar</span>';
                cardBorderClass = 'border-success operational animate-pulse-border';
            } else {
                statusBadge = '<span class="badge bg-warning text-dark animate-pulse"><i class="bi bi-lightbulb-fill"></i> Recolección Activa</span>';
                cardBorderClass = 'border-cyan failure animate-pulse-border';
            }
        } else if (isLowStock) {
            statusBadge = '<span class="badge bg-danger"><i class="bi bi-exclamation-triangle-fill"></i> Stock Bajo</span>';
            cardBorderClass = 'border-warning maintenance';
        }

        const ledsPerBin = bin.hw.ledsPerBin || 4;
        const startLed = bin.ledIndex !== undefined ? bin.ledIndex : bin.binIndex * ledsPerBin;
        const endLed = startLed + ledsPerBin - 1;

        // Indicadores LED virtuales
        let virtualLedsHtml = '';
        for (let l = 0; l < ledsPerBin; l++) {
            virtualLedsHtml += `<span class="pick-led-dot ${isLit ? 'pick-led-dot--active' : ''}"></span>`;
        }

        const card = document.createElement('div');
        card.className = `card h-100 ${cardBorderClass}`;
        card.style.background = isLit 
            ? 'linear-gradient(180deg, rgba(6, 182, 212, 0.12) 0%, rgba(11, 15, 25, 0.95) 100%)' 
            : 'rgba(255, 255, 255, 0.02)';
        card.style.border = isLit 
            ? '1px solid rgba(6, 182, 212, 0.8) !important' 
            : '1px solid rgba(255, 255, 255, 0.08) !important';

        setSafeDOM(card, `
            <div class="card-header py-2 d-flex justify-content-between align-items-center" style="background: ${isLit ? 'rgba(6, 182, 212, 0.15)' : 'rgba(255, 255, 255, 0.03)'}; border-bottom: 1px solid ${isLit ? 'rgba(6, 182, 212, 0.3)' : 'rgba(255, 255, 255, 0.08)'};">
                <div class="d-flex align-items-center gap-2">
                    <strong class="text-white fs-6"><i class="bi bi-inbox-fill text-info"></i> ${escapeHtml(bin.binId)}</strong>
                    <span class="badge bg-dark border border-secondary text-light">${escapeHtml(bin.rackName)}</span>
                </div>
                ${statusBadge}
            </div>
            <div class="card-body d-flex flex-column p-3">
                <!-- Nombre y Descripción de la Gaveta -->
                <div class="d-flex justify-content-between align-items-start mb-2">
                    <div>
                        <h6 class="card-title text-white fw-bold mb-0">${escapeHtml(bin.name || 'Gaveta ' + bin.binId)}</h6>
                        <small class="text-muted"><i class="bi bi-geo-alt"></i> ${escapeHtml(bin.location || bin.rackName + ' - Gaveta ' + bin.binId)}</small>
                    </div>
                    ${bin.gpioPin ? `<span class="badge bg-dark border border-secondary text-info font-monospace">Pin ${bin.gpioPin}</span>` : ''}
                </div>

                <!-- Datos de la Refacción Vinculada -->
                <div class="p-2 rounded-3 mb-3 flex-grow-1" style="background: rgba(0, 0, 0, 0.25); border: 1px solid rgba(255, 255, 255, 0.05);">
                    ${item ? `
                        <div class="d-flex justify-content-between align-items-center mb-1">
                            <span class="badge bg-primary text-truncate" style="max-width: 140px;">${escapeHtml(item.category || 'Refacción')}</span>
                            <span class="small font-monospace text-muted">Cód: ${escapeHtml(item.code || '—')}</span>
                        </div>
                        <div class="fw-bold text-white fs-6 text-truncate" title="${escapeHtml(item.name)}">${escapeHtml(item.name)}</div>
                        <div class="d-flex justify-content-between align-items-center mt-2 pt-2 border-top border-secondary border-opacity-25">
                            <div>
                                <small class="text-muted d-block" style="font-size:0.75rem;">Stock disponible</small>
                                <span class="fw-bold fs-6 ${isLowStock ? 'text-danger' : 'text-success'}">
                                    ${currentStock} <small class="text-muted fw-normal">pzas</small>
                                </span>
                                ${isLowStock ? `<span class="badge bg-danger ms-1" style="font-size:0.7rem;">mín: ${minStock}</span>` : ''}
                            </div>
                            <div class="text-end">
                                <small class="text-muted d-block" style="font-size:0.75rem;">Controlador ESP32</small>
                                <span class="badge bg-dark text-info border border-secondary" style="font-size:0.72rem;">${bin.hw.esp32Id || 'ESP32'}</span>
                            </div>
                        </div>
                    ` : `
                        <div class="text-center py-2 text-muted">
                            <i class="bi bi-tag opacity-50"></i>
                            <div class="small">Sin refacción asignada del catálogo</div>
                            <small class="text-info" style="font-size: 0.72rem;">Configurable en Panel Admin</small>
                        </div>
                    `}
                </div>

                <!-- Tira Virtual de LEDs y Telemetría -->
                <div class="d-flex justify-content-between align-items-center mb-3 px-1">
                    <div class="d-flex align-items-center gap-1">
                        ${virtualLedsHtml}
                        <span class="small font-monospace text-muted ms-1" style="font-size: 0.72rem;">LEDs ${startLed}-${endLed}</span>
                    </div>
                    ${isLit && activePick?.requesterName ? `
                        <span class="badge bg-warning text-dark text-truncate" style="max-width: 150px;" title="Solicitó: ${escapeHtml(activePick.requesterName)}">
                            <i class="bi bi-person-fill"></i> ${escapeHtml(activePick.requesterName)}
                        </span>
                    ` : ''}
                </div>

                <!-- Botones de Acción Operativa -->
                <div class="d-flex gap-2 mt-auto">
                    ${isLit ? (
                        isPutToLight ? `
                        <button class="btn btn-success fw-bold text-white flex-grow-1" onclick="window.warehouseModule.cancelActiveLight('${bin.binId}', '${activePick ? activePick.id : ''}')" title="Apagar baliza de colocación (no descuenta stock)">
                            <span class="pick-led-dot pick-led-dot--lit me-1"></span> Encendida (Apagar)
                        </button>
                        ` : `
                        <button class="btn btn-warning fw-bold text-dark flex-grow-1 animate-pulse" onclick="window.warehouseModule.openConfirmPickModal('${bin.binId}', '${bin.itemId || ''}')">
                            <i class="bi bi-box-seam me-1"></i> Recoger
                        </button>
                        <button class="btn btn-outline-danger btn-sm" onclick="window.warehouseModule.cancelActiveLight('${bin.binId}', '${activePick ? activePick.id : ''}')" title="Apagar luz sin descontar stock">
                            <i class="bi bi-x-circle"></i>
                        </button>
                        `
                    ) : `
                        <button class="btn btn-outline-info flex-grow-1" onclick="window.warehouseModule.openTriggerPickModal('${bin.binId}', '${bin.itemId || ''}', '${bin.rackKey}')" ${!item ? 'disabled' : ''}>
                            <i class="bi bi-lightbulb"></i> Buscar / Iluminar
                        </button>
                    `}
                    <button class="btn btn-outline-secondary btn-sm" onclick="window.warehouseModule.openWhItemHistoryModal('${bin.binId}', '${bin.itemId || ''}', '${escapeHtml(bin.name || bin.binId)}')" ${!bin.itemId ? 'disabled' : ''} title="Ver historial de movimientos">
                        <i class="bi bi-clock-history"></i>
                    </button>
                </div>
            </div>
        `);

        col.appendChild(card);
        return col;
    }

    // Modal para Solicitar / Iluminar Gaveta (Pick-to-Light)
    function openTriggerPickModal(binId, itemId, rackKey) {
        const modalEl = document.getElementById('whTriggerPickModal');
        if (!modalEl) return;

        const rack = warehouseConfig && warehouseConfig[rackKey] ? warehouseConfig[rackKey] : null;
        const bin = rack?.bins?.find(b => b.binId === binId);
        const item = itemId && inventoryItemsMap.has(itemId) ? inventoryItemsMap.get(itemId) : null;

        document.getElementById('modalPickBinId').value = binId;
        document.getElementById('modalPickItemId').value = itemId || '';
        document.getElementById('modalPickRackKey').value = rackKey || '';

        document.getElementById('modalPickBinLabel').textContent = `Gaveta ${binId}`;
        document.getElementById('modalPickRackLabel').textContent = rack?.name || rackKey;
        document.getElementById('modalPickItemName').textContent = item ? item.name : 'Gaveta ' + binId;
        document.getElementById('modalPickItemCode').textContent = item ? `Código: ${item.code}` : 'Sin código';
        document.getElementById('modalPickCurrentStock').textContent = item ? `${item.stock} pzas` : '—';
        document.getElementById('modalPickLocationText').textContent = (item && item.warehouseLocation) ? item.warehouseLocation : `${rack?.name || rackKey} - Gaveta ${binId}`;

        // Prellenar nombre del usuario si existe
        const requesterInput = document.getElementById('whRequesterName');
        if (requesterInput) {
            requesterInput.value = sessionStorage.getItem('username') || (userNames.length > 0 ? userNames[0] : '');
        }

        document.getElementById('whRequestedQty').value = 1;
        document.getElementById('whRequestNotes').value = '';

        bootstrap.Modal.getOrCreateInstance(modalEl).show();
    }

    // Enviar Solicitud de Iluminación a Firestore
    async function handleTriggerPickSubmit(e) {
        e.preventDefault();
        const db = getDb();
        if (!db) return;

        const binId = document.getElementById('modalPickBinId').value;
        const itemId = document.getElementById('modalPickItemId').value;
        const rackKey = document.getElementById('modalPickRackKey').value;
        const requester = document.getElementById('whRequesterName').value.trim();
        const qty = parseInt(document.getElementById('whRequestedQty').value, 10) || 1;
        const notes = document.getElementById('whRequestNotes').value.trim();

        if (!requester) {
            alert("Por favor indica el nombre de quien solicita.");
            return;
        }

        saveUserName(requester);

        const item = itemId && inventoryItemsMap.has(itemId) ? inventoryItemsMap.get(itemId) : null;
        const rack = warehouseConfig && warehouseConfig[rackKey] ? warehouseConfig[rackKey] : null;
        const bin = rack?.bins?.find(b => b.binId === binId);
        const hw = allWhHardwareConfig[rackKey] || {};

        try {
            await db.collection('active_picks').add({
                itemId: itemId || '',
                itemCode: item ? item.code : '',
                itemName: item ? item.name : `Gaveta ${binId}`,
                location: `${rack?.name || rackKey} - Gaveta ${binId}`,
                warehouseBinId: binId,
                rackKey: rackKey,
                esp32Id: hw.esp32Id || `ESP32-${rackKey.toUpperCase()}`,
                ledIndex: bin?.ledIndex !== undefined ? bin.ledIndex : 0,
                ledCount: hw.ledsPerBin || 4,
                requestedBy: requester,
                requesterName: requester,
                requestedQty: qty,
                notes: notes,
                status: 'active',
                color: hw.searchColor || '#00E5FF',
                source: 'web_warehouse',
                createdAt: firebase.firestore.FieldValue.serverTimestamp()
            });

            const modalEl = document.getElementById('whTriggerPickModal');
            if (modalEl) bootstrap.Modal.getOrCreateInstance(modalEl).hide();

            console.log(`💡 Pick activado en gaveta ${binId} para ${item?.name || binId}`);
        } catch (err) {
            console.error("Error activando Pick-to-Light:", err);
            alert("Error al activar señal luminosa: " + err.message);
        }
    }

    // Modal para Confirmar Recolección (Recoger)
    function openConfirmPickModal(binId, itemId) {
        const modalEl = document.getElementById('whConfirmPickModal');
        if (!modalEl) return;

        const activePick = activePicksByBinMap.get(binId) || (itemId && activePicksMap.get(itemId)) || null;
        const item = itemId && inventoryItemsMap.has(itemId) ? inventoryItemsMap.get(itemId) : null;

        document.getElementById('modalConfirmPickId').value = activePick ? activePick.id : '';
        document.getElementById('modalConfirmItemId').value = itemId || (activePick ? activePick.itemId : '');
        document.getElementById('modalConfirmBinId').value = binId;

        document.getElementById('modalConfirmBinLabel').textContent = `Gaveta ${binId}`;
        document.getElementById('modalConfirmItemName').textContent = (activePick && activePick.itemName) ? activePick.itemName : (item ? item.name : 'Gaveta ' + binId);
        document.getElementById('modalConfirmItemCode').textContent = item ? `Código: ${item.code}` : (activePick ? `Código: ${activePick.itemCode || '—'}` : '—');
        document.getElementById('modalConfirmCurrentStock').textContent = item ? `${item.stock} pzas` : '—';
        document.getElementById('modalConfirmRequester').textContent = (activePick && activePick.requesterName) ? activePick.requesterName : 'Operador';

        document.getElementById('whPickedQty').value = activePick ? (activePick.requestedQty || 1) : 1;

        const pickedByInput = document.getElementById('whPickedBy');
        if (pickedByInput) {
            pickedByInput.value = sessionStorage.getItem('username') || (activePick ? activePick.requesterName : '') || (userNames.length > 0 ? userNames[0] : '');
        }

        const btnCancelLight = document.getElementById('btnCancelActiveLight');
        if (btnCancelLight) {
            btnCancelLight.onclick = () => {
                cancelActiveLight(binId, activePick ? activePick.id : '');
                bootstrap.Modal.getOrCreateInstance(modalEl).hide();
            };
        }

        bootstrap.Modal.getOrCreateInstance(modalEl).show();
    }

    // Confirmar Recogida y Descontar Stock
    async function handleConfirmPickSubmit(e) {
        e.preventDefault();
        const db = getDb();
        if (!db) return;

        const pickId = document.getElementById('modalConfirmPickId').value;
        const itemId = document.getElementById('modalConfirmItemId').value;
        const binId = document.getElementById('modalConfirmBinId').value;
        const qty = parseInt(document.getElementById('whPickedQty').value, 10) || 1;
        const pickedBy = document.getElementById('whPickedBy').value.trim();

        if (!pickedBy) {
            alert("Por favor indica el nombre de quien recoge.");
            return;
        }

        saveUserName(pickedBy);

        try {
            let itemData = null;
            if (itemId) {
                const itemRef = db.collection('inventory').doc(itemId);
                const itemDoc = await itemRef.get();
                if (itemDoc.exists) {
                    itemData = itemDoc.data();
                    const currentStock = itemData.stock !== undefined ? itemData.stock : 0;
                    const newStock = Math.max(0, currentStock - qty);

                    // 1. Descontar stock
                    await itemRef.update({
                        stock: newStock,
                        lastMovement: firebase.firestore.FieldValue.serverTimestamp()
                    });

                    // 2. Registrar movimiento de auditoría
                    await db.collection('inventory_movements').add({
                        itemId: itemId,
                        itemCode: itemData.code || '',
                        itemName: itemData.name || '',
                        type: 'salida',
                        quantity: qty,
                        reasonType: 'Pick-to-Light: Recogida en Almacén',
                        description: `Recolección de ${qty} unidad(es) de Gaveta ${binId} confirmada por ${pickedBy}`,
                        responsible: pickedBy,
                        timestamp: firebase.firestore.FieldValue.serverTimestamp(),
                        previousStock: currentStock,
                        newStock: newStock
                    });
                }
            }

            // 3. Actualizar pick a 'picked'
            if (pickId) {
                await db.collection('active_picks').doc(pickId).update({
                    status: 'picked',
                    pickedAt: firebase.firestore.FieldValue.serverTimestamp(),
                    pickedBy: pickedBy,
                    pickedQty: qty
                });
            } else {
                // Si se confirmó manualmente sin pick previo
                await db.collection('active_picks').add({
                    itemId: itemId || '',
                    itemCode: itemData ? itemData.code : '',
                    itemName: itemData ? itemData.name : `Gaveta ${binId}`,
                    warehouseBinId: binId,
                    status: 'picked',
                    requestedBy: pickedBy,
                    requesterName: pickedBy,
                    pickedBy: pickedBy,
                    pickedQty: qty,
                    pickedAt: firebase.firestore.FieldValue.serverTimestamp()
                });
            }

            const modalEl = document.getElementById('whConfirmPickModal');
            if (modalEl) bootstrap.Modal.getOrCreateInstance(modalEl).hide();

            updateTodayPicksCount();
            console.log(`✅ Recolección confirmada: ${qty} pzas de ${binId} por ${pickedBy}`);
        } catch (err) {
            console.error("Error confirmando recolección:", err);
            alert("Error al registrar recolección: " + err.message);
        }
    }

    // Cancelar luz sin descontar stock
    async function cancelActiveLight(binId, pickId) {
        const db = getDb();
        if (!db) return;
        try {
            if (pickId) {
                await db.collection('active_picks').doc(pickId).update({
                    status: 'cancelled',
                    cancelledAt: firebase.firestore.FieldValue.serverTimestamp()
                });
            } else {
                const snap = await db.collection('active_picks')
                    .where('warehouseBinId', '==', binId)
                    .where('status', '==', 'active')
                    .get();
                const batch = db.batch();
                snap.forEach(d => batch.update(d.ref, { status: 'cancelled' }));
                await batch.commit();
            }
            console.log(`Luz de gaveta ${binId} apagada.`);
        } catch (e) {
            console.error("Error cancelando luz:", e);
        }
    }

    // Modal de Historial de Movimientos de la Gaveta
    async function openWhItemHistoryModal(binId, itemId, binName) {
        const modalEl = document.getElementById('whHistoryModal');
        const tbody = document.getElementById('whHistoryTableBody');
        const titleEl = document.getElementById('historyModalItemTitle');
        const subtitleEl = document.getElementById('historyModalBinSubtitle');
        const stockBadge = document.getElementById('historyModalStockBadge');
        if (!modalEl || !tbody) return;

        const item = itemId && inventoryItemsMap.has(itemId) ? inventoryItemsMap.get(itemId) : null;
        titleEl.textContent = item ? `${item.name} (${item.code})` : binName;
        subtitleEl.textContent = `Ubicación: Gaveta ${binId}`;
        stockBadge.textContent = item ? `Stock actual: ${item.stock} pzas` : '—';

        setSafeDOM(tbody, '<tr><td colspan="6" class="text-center py-3 text-muted"><span class="spinner-border spinner-border-sm me-2"></span>Cargando historial de movimientos...</td></tr>');
        bootstrap.Modal.getOrCreateInstance(modalEl).show();

        const db = getDb();
        if (!db || !itemId) {
            setSafeDOM(tbody, '<tr><td colspan="6" class="text-center py-3 text-muted">No hay movimientos registrados para este artículo.</td></tr>');
            return;
        }

        try {
            // Consulta directa por itemId sin forzar índice compuesto en Firestore
            const snap = await db.collection('inventory_movements')
                .where('itemId', '==', itemId)
                .limit(50)
                .get();

            if (snap.empty) {
                setSafeDOM(tbody, '<tr><td colspan="6" class="text-center py-3 text-muted">Sin movimientos registrados aún para esta refacción.</td></tr>');
                return;
            }

            const movements = [];
            snap.forEach(doc => {
                const m = doc.data();
                m.id = doc.id;
                movements.push(m);
            });

            // Ordenar en memoria de forma inmediata por fecha más reciente
            movements.sort((a, b) => {
                const getMs = (val) => {
                    if (!val) return 0;
                    if (typeof val.toDate === 'function') return val.toDate().getTime();
                    if (typeof val.seconds === 'number') return val.seconds * 1000;
                    if (val instanceof Date) return val.getTime();
                    const parsed = Date.parse(val);
                    return isNaN(parsed) ? 0 : parsed;
                };
                return getMs(b.timestamp) - getMs(a.timestamp);
            });

            tbody.replaceChildren();
            movements.slice(0, 25).forEach(m => {
                const d = m.timestamp ? (typeof m.timestamp.toDate === 'function' ? m.timestamp.toDate() : new Date(m.timestamp)) : new Date();
                const dateStr = d.toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
                const isSalida = m.type === 'salida';

                const tr = document.createElement('tr');
                setSafeDOM(tr, `
                    <td class="small font-monospace text-muted">${dateStr}</td>
                    <td>
                        <span class="badge ${isSalida ? 'bg-danger bg-opacity-75' : 'bg-success bg-opacity-75'}">
                            ${isSalida ? '<i class="bi bi-box-arrow-up"></i> Salida' : '<i class="bi bi-box-arrow-in-down"></i> Entrada'}
                        </span>
                    </td>
                    <td class="fw-bold ${isSalida ? 'text-danger' : 'text-success'}">${isSalida ? '−' : '+'}${m.quantity || 1}</td>
                    <td class="small text-white">${escapeHtml(m.responsible || '—')}</td>
                    <td class="small text-muted">${escapeHtml(m.reasonType || m.description || 'Movimiento')}</td>
                    <td class="small font-monospace text-info">${m.newStock !== undefined ? m.newStock + ' pzas' : '—'}</td>
                `);
                tbody.appendChild(tr);
            });
        } catch (err) {
            console.error("Error consultando historial de inventario:", err);
            setSafeDOM(tbody, `<tr><td colspan="6" class="text-center py-3 text-danger">Error consultando historial: ${escapeHtml(err.message)}</td></tr>`);
        }
    }

    function setupModalForms() {
        const triggerForm = document.getElementById('whTriggerPickForm');
        if (triggerForm) triggerForm.addEventListener('submit', handleTriggerPickSubmit);

        const confirmForm = document.getElementById('whConfirmPickForm');
        if (confirmForm) confirmForm.addEventListener('submit', handleConfirmPickSubmit);
    }

    // Exponer métodos para llamadas directas onclick
    window.warehouseModule = {
        openTriggerPickModal,
        openConfirmPickModal,
        cancelActiveLight,
        openWhItemHistoryModal,
        renderWarehouseCards
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initWarehouseModule);
    } else {
        initWarehouseModule();
    }
})();

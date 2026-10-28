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

// --- SISTEMA DE JORNADAS ---
// SHIFTS y funciones de jornada están definidas en app.js:
// - getCurrentShift()
// - getCurrentShiftTimeRange()
// - getShiftForDate()
// - getShiftCollectionName()

// --- SISTEMA DE NOMBRES DE USUARIO ---
let userNames = [];

function loadUserNames() {
    try {
        const saved = localStorage.getItem('userNames');
        if (saved) {
            userNames = JSON.parse(saved);
            updateUserNamesList();
        }
    } catch (e) {
        console.warn('Error cargando userNames:', e);
    }
}

function saveUserNames() {
    try {
        localStorage.setItem('userNames', JSON.stringify(userNames));
    } catch (e) {}
}

function addUserName(name) {
    if (name && !userNames.includes(name)) {
        userNames.push(name);
        saveUserNames();
        updateUserNamesList();
    }
}

function updateUserNamesList() {
    const datalist = document.getElementById('userNamesList');
    if (datalist) {
        datalist.replaceChildren();
        userNames.forEach(name => {
            const option = document.createElement('option');
            option.value = name;
            datalist.appendChild(option);
        });
    }
}

// --- LÓGICA DE SOLICITUD DE REFACCIÓN ---
let refactionItems = [];
let refactionCategories = [];

async function loadRefactionData() {
    try {
        const loadFn = window.loadRefactionInventoryItems || (typeof loadRefactionInventoryItems === 'function' ? loadRefactionInventoryItems : null);
        if (typeof loadFn === 'function') {
            refactionItems = await loadFn('operation');
            refactionCategories = [...new Set(refactionItems.map(item => item.category).filter(Boolean))];
            console.log('Datos de refacciones cargados:', {
                items: refactionItems.length,
                categories: refactionCategories.length
            });
        }
    } catch (error) {
        console.error('Error cargando datos de refacciones:', error);
    }
}

function openRefactionRequestModal(operationId) {
    console.log('openRefactionRequestModal llamada con ID:', operationId);

    const operationIdInput = document.getElementById('refactionOperationId');
    const categorySelect = document.getElementById('refactionCategory');
    const itemSelect = document.getElementById('refactionItem');
    const modalElement = document.getElementById('refactionRequestModal');

    if (!operationIdInput || !categorySelect || !itemSelect || !modalElement) {
        console.error('Elementos del modal no encontrados:', {
            operationIdInput: !!operationIdInput,
            categorySelect: !!categorySelect,
            itemSelect: !!itemSelect,
            modalElement: !!modalElement
        });
        return;
    }

    operationIdInput.value = operationId;
    setSafeDOM(categorySelect, '<option value="">Seleccionar categoría</option>');
    setSafeDOM(itemSelect, '<option value="">Seleccionar refacción</option>');

    if (refactionCategories.length === 0) {
        const opt = document.createElement('option');
        opt.value = '';
        opt.textContent = 'No hay categorías disponibles';
        categorySelect.appendChild(opt);
    } else {
        refactionCategories.forEach(cat => {
            const opt = document.createElement('option');
            opt.value = cat;
            opt.textContent = cat;
            categorySelect.appendChild(opt);
        });
    }

    categorySelect.onchange = () => {
        setSafeDOM(itemSelect, '<option value="">Seleccionar refacción</option>');
        const filteredItems = refactionItems.filter(i => i.category === categorySelect.value);
        filteredItems.forEach(item => {
            const opt = document.createElement('option');
            opt.value = item.id;
            opt.textContent = item.name + ' (Stock: ' + item.stock + ')';
            itemSelect.appendChild(opt);
        });
    };

    const modal = bootstrap.Modal.getOrCreateInstance(modalElement);
    modal.show();
}

window.openRefactionRequestModal = openRefactionRequestModal;

function parseOpDateMs(val) {
    if (!val) return null;
    if (typeof val.toDate === 'function') return val.toDate().getTime();
    if (typeof val.seconds === 'number') return val.seconds * 1000;
    if (val instanceof Date) return val.getTime();
    if (typeof val === 'number') return val;
    if (typeof val === 'string') {
        const ms = Date.parse(val);
        if (!isNaN(ms)) return ms;
    }
    return null;
}

function getOperationFailureStartMs(data) {
    if (!data || typeof data !== 'object') return null;
    return parseOpDateMs(data.reportedAt)
        || parseOpDateMs(data.createdAt)
        || parseOpDateMs(data.timestamp);
}

document.addEventListener('DOMContentLoaded', async () => {
    await loadRefactionData();

    const refactionForm = document.getElementById('refactionRequestForm');
    if (refactionForm) {
        refactionForm.addEventListener('submit', async function(e) {
            e.preventDefault();

            const operationId = document.getElementById('refactionOperationId').value;
            const category = document.getElementById('refactionCategory').value;
            const itemId = document.getElementById('refactionItem').value;
            const quantity = parseInt(document.getElementById('refactionQuantity').value, 10);
            const reason = document.getElementById('refactionReason').value.trim();

            if (!operationId || !category || !itemId || !quantity || !reason) {
                alert('Completa todos los campos (incluye operación y refacción)');
                return;
            }

            try {
                const item = refactionItems.find(i => i.id === itemId);
                const submitFn = window.submitRefactionRequest || (typeof submitRefactionRequest === 'function' ? submitRefactionRequest : null);
                if (!submitFn) throw new Error('El sistema de refacciones no está inicializado.');
                const requestId = await submitFn({
                    operationId,
                    category,
                    itemId,
                    itemName: item ? item.name : '',
                    quantity,
                    reason,
                    requestedBy: sessionStorage.getItem('username') || localStorage.getItem('lastUsername') || 'Operaciones',
                    type: 'operation'
                });

                bootstrap.Modal.getOrCreateInstance(document.getElementById('refactionRequestModal')).hide();
                refactionForm.reset();
                showAlert(`Solicitud #${requestId.slice(0, 6)} enviada. Revisa en Inventario → Solicitudes.`, 'success');
            } catch (error) {
                console.error('Error enviando solicitud:', error);
                alert('Error al enviar la solicitud: ' + (error.message || error));
            }
        });
    }

    // --- CONFIGURACIÓN Y REFERENCIAS DEL DOM ---
    let OPERATIONS_CONFIG = {
        _order: ['area5', 'area10', 'area20', 'area30', 'area35plus'],
        area5: ['5'],
        area10: ['10.01', '10.02', '10.03', '10.04', '10.05', '10.06', '10.07', '10.08', '10.09', '10.10'],
        area20: ['20.01', '20.02', '20.03', '20.04', '20.05', '20.06', '20.07', '20.08', '20.09', '20.10', '20.11', '20.12', '20.13'],
        area30: ['30.01', '30.02', '30.03', '30.04', '30.05', '30.06', '30.07', '30.08', '30.09', '30.10'],
        area35plus: ['35', '40', '50', '65', '70']
    };

    let operationsContainer;
    let reportModal;
    let resolveModal;
    let isSubmitting = false;
    let activeOperations = new Map();
    let currentAreaFilter = 'all';
    let currentView = 'grid';

    // --- FUNCIONES DE UTILIDAD ---
    function formatTime(seconds) {
        if (isNaN(seconds) || seconds < 0) return '00:00:00';
        const hours = Math.floor(seconds / 3600);
        const minutes = Math.floor((seconds % 3600) / 60);
        const secs = Math.floor(seconds % 60);
        return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
    }

    function escapeHtml(str) {
        if (!str) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function showAlert(message, type = 'success') {
        const alertContainer = document.querySelector('#mainContent .container') || document.querySelector('.container');
        const alertDiv = document.createElement('div');
        alertDiv.className = `alert alert-${type} alert-dismissible fade show mt-3`;
        setSafeDOM(alertDiv, `${escapeHtml(message)}<button type="button" class="btn-close" data-bs-dismiss="alert"></button>`);
        if (alertContainer) {
            alertContainer.prepend(alertDiv);
            setTimeout(() => { if (alertDiv.parentNode) alertDiv.remove(); }, 5000);
        } else {
            alert(message);
        }
    }

    function getAreaFromOperationId(operationId) {
        const mainArea = String(operationId).split('.')[0];
        if (['35', '40', '50', '65', '70'].includes(mainArea) || parseInt(mainArea, 10) >= 35) return '35plus';
        return mainArea;
    }

    function showNotification(message, type = 'info') {
        const alertContainer = document.querySelector('#mainContent .container') || document.querySelector('.container');
        const notification = document.createElement('div');
        notification.className = `alert alert-${type === 'success' ? 'success' : (type === 'error' || type === 'danger') ? 'danger' : type === 'warning' ? 'warning' : 'info'} alert-dismissible fade show mt-3`;
        setSafeDOM(notification, `
            ${escapeHtml(message)}
            <button type="button" class="btn-close" data-bs-dismiss="alert"></button>
        `);
        if (alertContainer) {
            alertContainer.prepend(notification);
        } else {
            document.body.appendChild(notification);
        }
        setTimeout(() => {
            if (notification.parentNode) {
                notification.remove();
            }
        }, 5000);
    }

    function refreshOpsAvgResolutionDisplay() {
        const cache = window._opsStatsLive;
        if (!cache) return 0;

        const now = Date.now();
        let totalSeconds = cache.resolvedSeconds || 0;
        let count = cache.resolvedCount || 0;

        (cache.activeStarts || []).forEach(startMs => {
            if (startMs && now > startMs) {
                totalSeconds += (now - startMs) / 1000;
                count++;
            }
        });

        const avg = count > 0 ? Math.floor(totalSeconds / count) : 0;
        const avgResolutionTime = document.getElementById('avgResolutionTime');
        if (avgResolutionTime) avgResolutionTime.textContent = formatTime(avg);
        return avg;
    }

    // --- FUNCIÓN updateStatistics ---
    async function updateStatistics() {
        try {
            const activeFailuresCount = document.getElementById('activeFailuresCount');
            if (activeFailuresCount) activeFailuresCount.textContent = activeOperations.size;

            const activeStarts = [];
            activeOperations.forEach(data => {
                const startMs = getOperationFailureStartMs(data);
                if (startMs) activeStarts.push(startMs);
            });

            const today = (typeof window.getChihuahuaTime === 'function') ? window.getChihuahuaTime() : new Date();
            today.setHours(0, 0, 0, 0);
            const dateStr = (typeof window.getChihuahuaDateString === 'function')
                ? window.getChihuahuaDateString()
                : today.toISOString().split('T')[0];

            let resolvedSeconds = 0;
            let resolvedCount = 0;
            const seenRecords = new Set();

            const processDoc = (data, docId) => {
                if (data.status && data.status !== 'resolved') return;
                const endMs = parseOpDateMs(data.resolvedAt);
                const startMs = getOperationFailureStartMs(data);
                const opKey = data.operationId || data.id || docId;
                const dedupKey = `${opKey}_${endMs ? Math.floor(endMs / 1000) : docId}`;
                if (seenRecords.has(dedupKey)) return;
                seenRecords.add(dedupKey);

                resolvedCount++;
                if (startMs && endMs && endMs >= startMs) {
                    resolvedSeconds += (endMs - startMs) / 1000;
                } else if (typeof data.totalTime === 'number') {
                    resolvedSeconds += data.totalTime;
                }
            };

            // 1. Consultar colecciones por jornada de hoy
            for (const shiftKey of ['A', 'B', 'C', 'D']) {
                const colName = `operations_history_${dateStr}_Jornada${shiftKey}`;
                try {
                    const snap = await db.collection(colName).get();
                    snap.forEach(doc => processDoc(doc.data(), doc.id));
                } catch (e) {}
            }

            // 2. Consultar colección general operations_history (sin índice compuesto)
            try {
                const snap = await db.collection('operations_history')
                    .where('resolvedAt', '>=', firebase.firestore.Timestamp.fromDate(today))
                    .get();
                snap.forEach(doc => processDoc(doc.data(), doc.id));
            } catch (e) {
                console.warn('Aviso consultando operations_history:', e.message);
            }

            const resolvedTodayCount = document.getElementById('resolvedTodayCount');
            if (resolvedTodayCount) resolvedTodayCount.textContent = resolvedCount;

            window._opsStatsLive = {
                resolvedSeconds,
                resolvedCount,
                activeStarts
            };

            refreshOpsAvgResolutionDisplay();
        } catch (err) {
            console.error('Error en updateStatistics de operaciones:', err);
        }
    }

    // --- LÓGICA DE RENDERIZADO ---
    function createOperationCard(operationId, status, data) {
        const col = document.createElement('div');
        col.className = currentView === 'list' ? 'col-12 mb-3' : 'col-12 col-md-6 col-lg-4 mb-4';
        col.dataset.area = getAreaFromOperationId(operationId);

        const card = document.createElement('div');
        const isFailed = (status === 'active');
        const startTime = isFailed ? getOperationFailureStartMs(data) : null;
        const elapsedSec = (isFailed && startTime) ? Math.floor((Date.now() - startTime) / 1000) : 0;

        let badgeClass = 'bg-success';
        let statusLabel = 'Operativa';
        let cardExtraClass = '';

        if (isFailed) {
            if (elapsedSec >= 900) {
                badgeClass = 'badge-critical-andon';
                statusLabel = '🚨 CRÍTICO N3 (>15m)';
                cardExtraClass = 'late-escalated critical-escalated';
            } else if (elapsedSec >= 300) {
                badgeClass = 'badge-late-andon';
                statusLabel = '⚠️ TARDE N2 (>5m)';
                cardExtraClass = 'late-escalated';
            } else {
                badgeClass = 'bg-danger';
                statusLabel = 'Falla N1';
            }
        }

        card.className = `card operation-card scada-faceplate-card h-100 ${isFailed ? 'border-danger failure' : 'border-success operational'} ${cardExtraClass}`;

        const cardBody = document.createElement('div');
        cardBody.className = 'card-body d-flex flex-column';

        const title = document.createElement('h5');
        title.className = 'card-title d-flex justify-content-between align-items-center mb-2';

        const opName = (window.HermesTopology && window.HermesTopology.getOperationName) 
            ? window.HermesTopology.getOperationName(operationId) 
            : '';

        setSafeDOM(title, `
            <div class="d-flex flex-column text-truncate me-2">
                <span class="scada-faceplate-title">Operación ${operationId}</span>
                ${opName ? `<span class="scada-op-subtitle text-info font-mono fw-normal" style="font-size:0.75rem;"><i class="bi bi-tag-fill me-1"></i>${escapeHtml(opName)}</span>` : ''}
            </div>
            <span class="badge ${badgeClass}">
                ${statusLabel}
            </span>
        `);

        const description = document.createElement('p');
        description.className = 'card-text flex-grow-1 text-wrap';
        description.style.fontSize = '0.88rem';
        description.style.color = '#cbd5e1';
        description.textContent = data.description || (status === 'active' ? 'En falla' : (opName || 'Operativa'));

        const timerDiv = document.createElement('div');
        if (isFailed && startTime) {
            timerDiv.className = 'timer text-danger fw-bold font-mono';
            timerDiv.dataset.start = startTime;
            timerDiv.textContent = formatTime(elapsedSec);
        }

        // SLA Progress Bar
        const slaTrack = document.createElement('div');
        if (isFailed) {
            slaTrack.className = 'scada-sla-track mt-2';
            slaTrack.title = 'Progreso de atención SLA (Meta < 5m)';
            const pct = elapsedSec >= 300 ? 100 : Math.min(100, Math.max(5, Math.round((elapsedSec / 300) * 100)));
            const strobe = elapsedSec >= 300 ? 'strobe' : '';
            setSafeDOM(slaTrack, `<div class="scada-sla-progress ${strobe}" style="width: ${pct}%;"></div>`);
        }

        // Technician Context Chip
        const techName = data.assignedTo || data.reportedBy || data.technicianName || null;
        const techChip = document.createElement('div');
        if (isFailed && techName) {
            techChip.className = 'scada-tech-chip assigned mt-2';
            techChip.title = 'Personal asignado a la atención';
            setSafeDOM(techChip, `
                <span class="scada-tech-avatar">${techName.charAt(0)}</span>
                <span><strong>Técnico:</strong> ${techName}</span>
            `);
        }

        // Botones de acción en SCADA 2-Column Grid
        const actions = document.createElement('div');
        actions.className = 'scada-actions-grid';

        if (status === 'operational') {
            const reportBtn = document.createElement('button');
            reportBtn.type = 'button';
            reportBtn.className = 'btn btn-warning btn-full';
            setSafeDOM(reportBtn, '<i class="bi bi-exclamation-triangle"></i> Reportar Falla');
            reportBtn.onclick = () => showReportModal(operationId);
            actions.appendChild(reportBtn);

            const historyBtn = document.createElement('button');
            historyBtn.type = 'button';
            historyBtn.className = 'btn btn-outline-info btn-full';
            setSafeDOM(historyBtn, '<i class="bi bi-clock-history"></i> Historial');
            historyBtn.onclick = () => {
                if (typeof window.showOperationDetails === 'function') {
                    window.showOperationDetails({ id: operationId, status, ...data });
                } else {
                    console.error('showOperationDetails no está disponible');
                    showNotification('Error: Función de historial no disponible', 'danger');
                }
            };
            actions.appendChild(historyBtn);
        } else {
            const resolveBtn = document.createElement('button');
            resolveBtn.type = 'button';
            resolveBtn.className = 'btn btn-success fw-bold';
            setSafeDOM(resolveBtn, '<i class="bi bi-check-circle"></i> Resolver');
            resolveBtn.onclick = () => showResolveModal(operationId);
            actions.appendChild(resolveBtn);

            const refactionBtn = document.createElement('button');
            refactionBtn.type = 'button';
            refactionBtn.className = 'btn btn-outline-warning';
            setSafeDOM(refactionBtn, '<i class="bi bi-tools"></i> Refacción');
            refactionBtn.onclick = () => openRefactionRequestModal(operationId);
            actions.appendChild(refactionBtn);

            const historyBtn = document.createElement('button');
            historyBtn.type = 'button';
            historyBtn.className = 'btn btn-info btn-full';
            setSafeDOM(historyBtn, '<i class="bi bi-clock-history"></i> Historial');
            historyBtn.onclick = () => {
                if (typeof window.showOperationDetails === 'function') {
                    window.showOperationDetails({ id: operationId, status, ...data });
                } else {
                    console.error('showOperationDetails no está disponible');
                    showNotification('Error: Función de historial no disponible', 'danger');
                }
            };
            actions.appendChild(historyBtn);
        }

        cardBody.appendChild(title);
        cardBody.appendChild(description);
        cardBody.appendChild(timerDiv);
        if (isFailed) cardBody.appendChild(slaTrack);
        if (isFailed && techName) cardBody.appendChild(techChip);
        cardBody.appendChild(actions);
        card.appendChild(cardBody);
        col.appendChild(card);

        return col;
    }

    function renderOperations() {
        if (!operationsContainer) {
            console.error('El contenedor de operaciones no existe');
            return;
        }

        operationsContainer.replaceChildren();
        operationsContainer.className = `operations-container ${currentView}-view`;

        // El adapter inyecta `key` al desempaquetar un documento config, así que hay que
        // excluirlo (y validar que el valor sea lista) para no tratarlo como área: eso hacía
        // fallar `areaOps.forEach` y el listener reportaba "Error escuchando operaciones".
        const allAreaKeys = Object.keys(OPERATIONS_CONFIG)
            .filter(k => k !== '_order' && k !== 'key' && Array.isArray(OPERATIONS_CONFIG[k]));
        const orderedKeys = OPERATIONS_CONFIG._order
            ? OPERATIONS_CONFIG._order.filter(k => allAreaKeys.includes(k))
            : allAreaKeys;
        allAreaKeys.forEach(k => { if (!orderedKeys.includes(k)) orderedKeys.push(k); });

        orderedKeys.forEach(areaKey => {
            const filterKey = areaKey.replace(/^area/, '');
            if (currentAreaFilter === 'all' || currentAreaFilter === filterKey) {
                const areaLabel = (window.HermesTopology && window.HermesTopology.getAreaLabel)
                    ? window.HermesTopology.getAreaLabel(areaKey)
                    : areaKey.replace(/^area/, 'Área ').replace('plus', '+');
                const areaOps = OPERATIONS_CONFIG[areaKey] || [];

                const sectionWrapper = document.createElement('div');
                sectionWrapper.className = 'operations-section mb-4';
                setSafeDOM(sectionWrapper, `<h4 class="operations-section-title"><i class="bi bi-geo-alt-fill text-info me-1"></i>${areaLabel}</h4>`);

                const row = document.createElement('div');
                row.className = 'row';

                areaOps.forEach(opId => {
                    const data = activeOperations.get(opId) || {};
                    const status = activeOperations.has(opId) ? 'active' : 'operational';
                    row.appendChild(createOperationCard(opId, status, data));
                });

                sectionWrapper.appendChild(row);
                operationsContainer.appendChild(sectionWrapper);
            }
        });
    }

    // --- LÓGICA DE FIRESTORE ---
    function listenToOperations() {
        db.collection('operations').where('status', '==', 'active').onSnapshot(snapshot => {
            activeOperations.clear();
            snapshot.forEach(doc => {
                const data = doc.data();
                const operationKey = data.operationId || data.id || doc.id;
                activeOperations.set(operationKey, data);
            });
            renderOperations();
            updateStatistics();
        }, error => {
            console.error("Error escuchando operaciones:", error);
            showNotification("Error de conexión en tiempo real.", "danger");
        });
    }

    async function reportFailure(operationId, description, reportedBy = null) {
        if (!operationId || !description) {
            showNotification('ID de operación y descripción son requeridos.', 'danger');
            return;
        }

        const finalReportedBy = reportedBy || sessionStorage.getItem('username') || 'Sistema Web';
        const area = getAreaFromOperationId(operationId);
        const db = firebase.firestore();

        const existingByOpId = await db.collection('operations')
            .where('operationId', '==', operationId)
            .where('status', '==', 'active')
            .get();

        const existingById = existingByOpId.empty
            ? await db.collection('operations')
                .where('id', '==', operationId)
                .where('status', '==', 'active')
                .get()
            : existingByOpId;

        if (!existingById.empty) {
            throw new Error('Esta operación ya tiene una falla activa reportada.');
        }

        const now = firebase.firestore.Timestamp.now();
        const batch = db.batch();
        const opRef = db.collection('operations').doc();
        const notificationRef = db.collection('notifications').doc();

        batch.set(opRef, {
            id: operationId,
            operationId: operationId,
            description: description,
            reportedBy: finalReportedBy,
            status: 'active',
            area: area,
            source: 'web',
            reportedAt: now,
            createdAt: now,
            timestamp: now
        });

        batch.set(notificationRef, {
            id: notificationRef.id,
            type: 'operation_failure',
            operationId: operationId,
            description: description,
            reportedBy: finalReportedBy,
            area: area,
            status: 'pending',
            source: 'web',
            createdAt: new Date().toISOString(),
            message: `🚨 *FALLA OPERACIÓN (WEB)* 🚨\n\n*ID:* ${operationId}\n*Desc:* ${description}\n*Reporta:* ${finalReportedBy}`
        });

        await batch.commit();
        showNotification('✅ La falla ha sido reportada exitosamente.', 'success');
    }

    async function resolveFailure(operationId, resolution, resolvedByParam = null) {
        if (!operationId || !resolution) {
            showNotification('ID de operación y resolución son requeridos.', 'danger');
            return;
        }
        const resolvedBy = resolvedByParam || sessionStorage.getItem('username') || 'Sistema Web';
        const db = firebase.firestore();

        try {
            let snapshot = await db.collection('operations')
                .where('id', '==', operationId)
                .where('status', '==', 'active')
                .get();

            if (snapshot.empty) {
                snapshot = await db.collection('operations')
                    .where('operationId', '==', operationId)
                    .where('status', '==', 'active')
                    .get();
            }

            if (snapshot.empty) {
                throw new Error('No se encontró una falla activa para esta operación.');
            }

            const operationDoc = snapshot.docs[0];
            const operationData = operationDoc.data();

            const currentShift = getCurrentShift();
            const collectionName = getShiftCollectionName(new Date(), currentShift);

            const startMs = getOperationFailureStartMs(operationData) || Date.now();
            const totalTime = Math.max(0, Math.floor((Date.now() - startMs) / 1000));
            const startTimestamp = operationData.timestamp || operationData.createdAt || operationData.reportedAt || firebase.firestore.Timestamp.fromMillis(startMs);
            const resolvedTimestamp = firebase.firestore.FieldValue.serverTimestamp();

            const historyPayload = {
                id: operationId,
                operationId: operationId,
                description: operationData.description || 'Sin descripción',
                reportedBy: operationData.reportedBy || 'Sistema',
                resolvedBy: resolvedBy,
                timestamp: startTimestamp,
                reportedAt: operationData.reportedAt || startTimestamp,
                createdAt: operationData.createdAt || startTimestamp,
                resolvedAt: resolvedTimestamp,
                resolution: resolution,
                totalTime: totalTime,
                status: 'resolved',
                area: operationData.area || getAreaFromOperationId(operationId),
                shift: currentShift.name,
                source: 'web'
            };

            const batch = db.batch();

            // 1. Agregar al historial de la jornada actual
            const shiftHistoryRef = db.collection(collectionName).doc();
            batch.set(shiftHistoryRef, historyPayload);

            // 2. Agregar también a operations_history general para estadísticas y reportes Excel
            const globalHistoryRef = db.collection('operations_history').doc(shiftHistoryRef.id);
            batch.set(globalHistoryRef, historyPayload);

            // 3. Eliminar todos los documentos activos duplicados de esta operación
            snapshot.docs.forEach(doc => batch.delete(doc.ref));

            // 4. Crear notificación para WhatsApp
            const notificationRef = db.collection('notifications').doc();
            batch.set(notificationRef, {
                type: 'operation_resolved',
                status: 'pending',
                operationId: operationId,
                description: operationData.description || '',
                resolution: resolution,
                resolvedBy: resolvedBy,
                area: operationData.area || getAreaFromOperationId(operationId),
                source: 'web',
                createdAt: new Date().toISOString()
            });

            await batch.commit();

            showNotification(`✅ Falla resuelta exitosamente ✅<br><br><strong>Operación:</strong> ${operationId}<br><strong>Resuelto por:</strong> ${resolvedBy}<br><strong>Solución:</strong> ${resolution}<br><strong>Jornada:</strong> ${currentShift.name}`, 'success');
        } catch (error) {
            console.error('Error resolviendo operación:', error);
            throw error;
        }
    }

    function showReportModal(operationId) {
        document.getElementById('operationId').value = operationId;
        document.getElementById('failureDescription').value = '';
        const reportedByInput = document.getElementById('reportedBy');
        if (reportedByInput && !reportedByInput.value) {
            const activeUser = (window.getActiveTechnician ? window.getActiveTechnician() : '') || '';
            if (activeUser) reportedByInput.value = activeUser;
        }
        reportModal.show();
    }

    function showResolveModal(operationId) {
        document.getElementById('resolveOperationId').value = operationId;
        document.getElementById('resolution').value = '';
        const pickerSec = document.getElementById('refactionPickerSection');
        if (pickerSec) pickerSec.classList.add('d-none');
        const selectedParts = document.getElementById('selectedPartsContainer');
        if (selectedParts) selectedParts.replaceChildren();

        const resolvedByInput = document.getElementById('resolvedBy');
        if (resolvedByInput) {
            const opData = (typeof activeOperations !== 'undefined' && activeOperations && activeOperations.get(operationId)) || {};
            const assignedTech = (window.getActiveTechnician ? window.getActiveTechnician(opData) : '') || '';
            if (assignedTech) {
                resolvedByInput.value = assignedTech;
            }
        }
        resolveModal.show();
    }

    // --- MANEJADORES DE EVENTOS ---
    document.getElementById('reportForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        if (isSubmitting) return;
        isSubmitting = true;

        const operationId = document.getElementById('operationId').value;
        const description = document.getElementById('failureDescription').value.trim();
        const reportedBy = document.getElementById('reportedBy').value.trim();
        const submitButton = document.getElementById('submitReport');

        if (!reportedBy || !description) {
            showNotification('Por favor, ingresa tu nombre y la descripción antes de reportar.', 'warning');
            isSubmitting = false;
            return;
        }

        submitButton.disabled = true;
        setSafeDOM(submitButton, '<span class="spinner-border spinner-border-sm"></span> Reportando...');

        try {
            addUserName(reportedBy);
            if (window.setActiveTechnician) {
                window.setActiveTechnician(reportedBy);
            }
            await reportFailure(operationId, description, reportedBy);
            reportModal.hide();
            e.target.reset();
        } catch (err) {
            showNotification(err.message, 'danger');
        } finally {
            isSubmitting = false;
            submitButton.disabled = false;
            setSafeDOM(submitButton, 'Reportar');
        }
    });

    document.getElementById('resolveForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        if (isSubmitting) return;
        isSubmitting = true;

        const operationId = document.getElementById('resolveOperationId').value;
        const resolution = document.getElementById('resolution').value.trim();
        const resolvedByInput = document.getElementById('resolvedBy');
        const resolvedBy = resolvedByInput ? resolvedByInput.value.trim() : '';
        const submitButton = document.getElementById('submitResolution');

        if (!operationId || !resolution || !resolvedBy) {
            showNotification('Por favor, ingresa tu nombre y la solución antes de resolver.', 'warning');
            isSubmitting = false;
            return;
        }

        submitButton.disabled = true;
        setSafeDOM(submitButton, '<span class="spinner-border spinner-border-sm"></span> Resolviendo...');

        try {
            addUserName(resolvedBy);
            if (window.setActiveTechnician) {
                window.setActiveTechnician(resolvedBy);
            }

            let finalResolution = resolution;
            if (typeof window.executeAtomicPartsDeduction === 'function') {
                try {
                    const partsNote = await window.executeAtomicPartsDeduction('Operación', operationId, resolvedBy);
                    if (partsNote) {
                        finalResolution += partsNote;
                    }
                } catch (partErr) {
                    console.warn('[Refactions] Error deduciendo refacción:', partErr);
                }
            }

            await resolveFailure(operationId, finalResolution, resolvedBy);
            resolveModal.hide();
            e.target.reset();
        } catch (err) {
            showNotification(err.message, 'danger');
        } finally {
            isSubmitting = false;
            submitButton.disabled = false;
            setSafeDOM(submitButton, 'Resolver');
        }
    });

    function setActiveOpFilterBtn(activeId) {
        document.querySelectorAll('#operations-filter-btn-group .btn, .scada-area-filter-group .btn').forEach(btn => {
            btn.classList.toggle('active', btn.id === activeId);
        });
    }

    const filterAllBtn = document.getElementById('filterAll');
    if (filterAllBtn) {
        filterAllBtn.addEventListener('click', () => {
            currentAreaFilter = 'all';
            setActiveOpFilterBtn('filterAll');
            renderOperations();
        });
    }

    ['5', '10', '20', '30', '35'].forEach(area => {
        const btn = document.getElementById(`filter${area}`);
        if (btn) {
            btn.addEventListener('click', () => {
                currentAreaFilter = area === '35' ? '35plus' : area;
                setActiveOpFilterBtn(`filter${area}`);
                renderOperations();
            });
        }
    });

    // Botones de vista Grid / Lista
    const viewGridBtn = document.getElementById('view-grid');
    const viewListBtn = document.getElementById('view-list');
    if (viewGridBtn && viewListBtn) {
        viewGridBtn.addEventListener('click', () => {
            currentView = 'grid';
            viewGridBtn.classList.add('active');
            viewListBtn.classList.remove('active');
            renderOperations();
        });
        viewListBtn.addEventListener('click', () => {
            currentView = 'list';
            viewListBtn.classList.add('active');
            viewGridBtn.classList.remove('active');
            renderOperations();
        });
    }

    setInterval(() => {
        document.querySelectorAll('.timer').forEach(timer => {
            const start = parseInt(timer.dataset.start, 10);
            if (isNaN(start)) return;
            const seconds = Math.floor((Date.now() - start) / 1000);
            timer.textContent = formatTime(seconds);

            const cardEl = timer.closest('.operation-card');
            if (cardEl) {
                const badgeEl = cardEl.querySelector('.badge');
                const timeBar = cardEl.querySelector('.scada-sla-progress');

                if (seconds >= 900) { // Nivel 3 Crítico (>15 min)
                    if (!cardEl.classList.contains('critical-escalated')) cardEl.classList.add('critical-escalated');
                    if (!cardEl.classList.contains('late-escalated')) cardEl.classList.add('late-escalated');
                    if (badgeEl && !badgeEl.classList.contains('badge-critical-andon')) {
                        badgeEl.className = 'badge badge-critical-andon';
                        badgeEl.textContent = '🚨 CRÍTICO N3 (>15m)';
                    }
                    if (timeBar) {
                        timeBar.style.width = '100%';
                        timeBar.classList.add('strobe');
                    }
                } else if (seconds >= 300) { // Nivel 2 Supervisor (>5 min)
                    if (cardEl.classList.contains('critical-escalated')) cardEl.classList.remove('critical-escalated');
                    if (!cardEl.classList.contains('late-escalated')) cardEl.classList.add('late-escalated');
                    if (badgeEl && !badgeEl.classList.contains('badge-late-andon')) {
                        badgeEl.className = 'badge badge-late-andon';
                        badgeEl.textContent = '⚠️ TARDE N2 (>5m)';
                    }
                    if (timeBar) {
                        timeBar.style.width = '100%';
                        timeBar.classList.add('strobe');
                    }
                } else {
                    if (cardEl.classList.contains('late-escalated')) cardEl.classList.remove('late-escalated');
                    if (cardEl.classList.contains('critical-escalated')) cardEl.classList.remove('critical-escalated');
                    if (badgeEl && (badgeEl.classList.contains('badge-late-andon') || badgeEl.classList.contains('badge-critical-andon'))) {
                        badgeEl.className = 'badge bg-danger';
                        badgeEl.textContent = 'Falla N1';
                    }
                    if (timeBar) {
                        const pct = Math.min(100, Math.max(5, Math.round((seconds / 300) * 100)));
                        timeBar.style.width = `${pct}%`;
                        timeBar.classList.remove('strobe');
                    }
                }
            }
        });
        if (window._opsStatsLive) refreshOpsAvgResolutionDisplay();
    }, 1000);

    operationsContainer = document.getElementById('operations-container');
    reportModal = bootstrap.Modal.getOrCreateInstance(document.getElementById('reportModal'));
    resolveModal = bootstrap.Modal.getOrCreateInstance(document.getElementById('resolveModal'));

    listenToOperations();

    db.collection('config').doc('operations_config').onSnapshot(doc => {
        if (doc.exists) {
            OPERATIONS_CONFIG = doc.data();
            renderOperations();
        }
    }, error => {
        console.warn('No se pudo cargar config/operations_config, usando default:', error.message);
    });

    updateStatistics();
    setInterval(updateStatistics, 300000);

    const submitReportBtn = document.getElementById('submitReport');
    if (submitReportBtn) {
        submitReportBtn.addEventListener('click', () => {
            document.getElementById('reportForm').requestSubmit();
        });
    }

    // Cargar catálogo unificado de motivos de paro (SCADA / ESP32)
    function listenToFailureReasons() {
        const container = document.getElementById('quickReasonsContainer');
        if (!container) return;
        db.collection('config').doc('failure_reasons').onSnapshot(doc => {
            const reasons = (doc.exists && Array.isArray(doc.data().reasons)) 
                ? doc.data().reasons 
                : ["1. Leva rota", "2. Fuga neumática", "3. Tornillería floja", "4. Componente roto", "5. Falla sensor"];
            
            container.replaceChildren();
            reasons.forEach(r => {
                const btn = document.createElement('button');
                btn.type = 'button';
                btn.className = 'btn btn-sm btn-outline-info text-truncate py-0 px-2';
                btn.style.fontSize = '0.78rem';
                btn.textContent = r;
                btn.onclick = () => window.applyQuickReason(r);
                container.appendChild(btn);
            });
        }, err => console.warn('Aviso escuchando failure_reasons en operaciones:', err.message));
    }

    window.applyQuickReason = function(reasonText) {
        const descEl = document.getElementById('failureDescription');
        if (!descEl) return;
        descEl.value = reasonText;
        descEl.focus();
    };

    listenToFailureReasons();
    loadUserNames();

    window.addEventListener('plant_topology_updated', () => {
        renderOperations();
    });
});


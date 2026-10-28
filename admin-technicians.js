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
 * Panel de técnicos y operadores en admin.html
 * Guarda en config/technicians y config/operators para que el bot notifique por WhatsApp.
 */
(function initAdminTechniciansPanel() {
    'use strict';

    const root = document.getElementById('technicians-mgmt');
    if (!root) return;

    let dynamicAreas = [];
    const SHIFT_NAMES = {
        a: 'Jornada A',
        b: 'Jornada B',
        c: 'Jornada C',
        d: 'Jornada D'
    };

    let selectedShift = 'a';
    let selectedOperatorShift = 'a';
    let loadingPromise = null;

    function shiftLetter(shift) {
        return String(shift || 'a').toLowerCase();
    }

    function shiftLabel(shift) {
        const s = shiftLetter(shift);
        return SHIFT_NAMES[s] || `Jornada ${s.toUpperCase()}`;
    }

    function readShiftData(areaData, shift) {
        if (!areaData || typeof areaData !== 'object') return null;
        const s = shiftLetter(shift);
        const letter = s.toUpperCase();
        const fullName = shiftLabel(s);
        const raw = areaData[fullName] ?? areaData[letter] ?? areaData[s];
        if (!raw) return null;
        if (Array.isArray(raw)) {
            return {
                technicians: raw.map((phone) => ({ name: '', phone: String(phone) })),
                numbers: raw.map((phone) => String(phone))
            };
        }
        if (raw.numbers || raw.technicians) return raw;
        return null;
    }

    function writeShiftData(areaData, shift, payload) {
        const letter = shiftLetter(shift).toUpperCase();
        const fullName = shiftLabel(shift);
        areaData[letter] = payload;
        areaData[fullName] = payload;
    }

    function getFirestoreDb() {
        if (typeof db !== 'undefined' && db) return db;
        if (typeof window !== 'undefined' && window.db) return window.db;
        return null;
    }

    function buildDynamicAreas(opsConfig) {
        const allKeys = Object.keys(opsConfig).filter(k => k !== '_order');
        const orderedKeys = (opsConfig._order || []).filter(k => allKeys.includes(k));
        allKeys.forEach(k => { if (!orderedKeys.includes(k)) orderedKeys.push(k); });

        const areas = [];
        orderedKeys.forEach(key => {
            const ops = opsConfig[key] || [];
            // Los flags de configuración (autoEscalate, notifyShiftLeaders, ...) conviven en este
            // documento con las áreas; no son listas de operaciones y no deben procesarse como tal.
            if (!Array.isArray(ops)) return; // dentro de forEach: return equivale a continue
            let label = '';
            let dbKey = 'TECH_' + key.toUpperCase();
            
            if (key === 'area5') {
                label = 'Área 5';
            } else if (key === 'area10') {
                label = 'Área 10';
            } else if (key === 'area20') {
                label = 'Área 20';
                dbKey = 'TECH_20';
            } else if (key === 'area30') {
                label = 'Área 30';
                dbKey = 'TECH_30';
            } else if (key === 'area35plus') {
                label = `Áreas Múltiples (${ops.join(', ')})`;
                dbKey = 'TECH_35_MULTI';
            } else {
                const num = key.replace('area', '');
                label = `Área ${num.toUpperCase()}`;
            }

            const desc = ops.length > 0 
                ? `Técnicos para operaciones: ${ops.join(', ')}`
                : `Técnicos para el área ${label}`;

            areas.push({
                id: `tech_${key}`,
                dbKey: dbKey,
                legacyKey: getLegacyKey(key),
                label: label,
                desc: desc
            });
        });

        areas.push({
            id: 'tech_default',
            dbKey: 'TECH_DEFAULT',
            legacyKey: 'TECH_DEFAULT',
            label: 'Números por Defecto',
            desc: 'Técnicos para cualquier otra operación no asignada'
        });

        return areas;
    }

    function getLegacyKey(key) {
        if (key === 'area5' || key === 'area10') return 'TECH_5_10';
        if (key === 'area20') return 'TECH_20';
        if (key === 'area30') return 'TECH_30';
        if (key === 'area35plus') return 'TECH_35_MULTI';
        return null;
    }

    function generateShiftAreasHTML(shift, areas) {
        let html = '';
        areas.forEach(area => {
            const targetId = `${area.id}_${shiftLetter(shift)}`;
            html += `
                <div class="mb-4">
                    <label class="form-label">${escapeHtml(area.label)}</label>
                    <div id="${targetId}_container"></div>
                    <button type="button" class="btn btn-outline-primary btn-sm add-number" data-target="${targetId}">
                        <i class="bi bi-plus-circle"></i> Agregar técnico
                    </button>
                    <small class="text-muted d-block">${escapeHtml(area.desc)}</small>
                </div>
            `;
        });
        return html;
    }

    async function loadOperationsConfigForTechs() {
        const firestore = getFirestoreDb();
        if (!firestore) return;
        
        try {
            // Verificar si el módulo de operaciones está habilitado en la configuración global
            let operationsModuleEnabled = true;
            try {
                const globalDoc = await firestore.collection('config').doc('global').get();
                if (globalDoc.exists) {
                    const globalData = globalDoc.data();
                    if (globalData.modules && globalData.modules.operations === false) {
                        operationsModuleEnabled = false;
                    }
                }
            } catch (e) {
                // Si falla, asumir que operaciones está activo
                console.warn('No se pudo leer config global, asumiendo operaciones habilitado');
            }

            if (!operationsModuleEnabled) {
                // Solo módulo de grúas: leer áreas desde cranes_config y crear sección por área
                const legacyFallbackMap = {
                    'area10': 'TECH_5_10',
                    'area20': 'TECH_20',
                    'area30': 'TECH_30',
                };

                try {
                    const cranesDoc = await firestore.collection('config').doc('cranes_config').get();
                    const cranesConfig = cranesDoc.exists ? cranesDoc.data() : {};
                    const craneAreaKeys = Object.keys(cranesConfig).filter(k => k !== '_order' && k.startsWith('area'));
                    const orderedCraneKeys = (cranesConfig._order || []).filter(k => craneAreaKeys.includes(k));
                    craneAreaKeys.forEach(k => { if (!orderedCraneKeys.includes(k)) orderedCraneKeys.push(k); });

                    if (orderedCraneKeys.length > 0) {
                        dynamicAreas = orderedCraneKeys.map(key => {
                            const num = key.replace('area', '');
                            const cranes = cranesConfig[key] || [];
                            return {
                                id: `tech_crane_${num}`,
                                dbKey: `TECH_CRANE${num.toUpperCase()}`,
                                legacyKey: legacyFallbackMap[key] || null,
                                label: `Área ${num} (Grúas)`,
                                desc: cranes.length > 0
                                    ? `Técnicos para grúas: ${cranes.join(', ')}`
                                    : `Técnicos para grúas del Área ${num}`
                            };
                        });
                        // Sección por defecto al final
                        dynamicAreas.push({
                            id: 'tech_crane_default',
                            dbKey: 'TECH_DEFAULT',
                            legacyKey: null,
                            label: 'Números por Defecto (Grúas)',
                            desc: 'Técnicos para grúas sin área asignada'
                        });
                    } else {
                        // Sin áreas configuradas aún, mostrar sección genérica
                        dynamicAreas = [{
                            id: 'tech_default',
                            dbKey: 'TECH_5_10',
                            legacyKey: 'TECH_5_10',
                            label: 'Números de Técnicos (Grúas)',
                            desc: 'Técnicos que reciben notificaciones cuando se reporta una falla en una grúa'
                        }];
                    }
                } catch (e) {
                    console.warn('Error leyendo cranes_config para técnicos:', e);
                    dynamicAreas = [{
                        id: 'tech_default',
                        dbKey: 'TECH_5_10',
                        legacyKey: 'TECH_5_10',
                        label: 'Números de Técnicos (Grúas)',
                        desc: 'Técnicos que reciben notificaciones cuando se reporta una falla en una grúa'
                    }];
                }
            } else {
                const doc = await firestore.collection('config').doc('operations_config').get();
                const opsConfig = doc.exists ? doc.data() : {};
                dynamicAreas = buildDynamicAreas(opsConfig);
            }
            
            ['a', 'b', 'c', 'd'].forEach(shift => {
                const container = root.querySelector(`#tech-dynamic-container-${shift}`);
                if (container) {
                    setSafeDOM(container, generateShiftAreasHTML(shift, dynamicAreas));
                }
            });
        } catch (error) {
            console.error('Error cargando config de operaciones para técnicos:', error);
            showPanelAlert('Error cargando la configuración de áreas', 'danger');
        }
    }

    function showPanelAlert(message, type = 'success') {
        const alertsHost = root.querySelector('#techniciansAlerts');
        if (!alertsHost) {
            alert(message);
            return;
        }
        const alertDiv = document.createElement('div');
        alertDiv.className = `alert alert-${type} alert-dismissible fade show`;
        setSafeDOM(alertDiv, `${message}<button type="button" class="btn-close" data-bs-dismiss="alert"></button>`);
        alertsHost.appendChild(alertDiv);
        setTimeout(() => alertDiv.remove(), 6000);
    }

    function validatePhoneNumber(number) {
        const cleanNumber = String(number).replace(/[^\d]/g, '');
        return /^\d{10}$/.test(cleanNumber);
    }

    function formatPhoneNumber(number) {
        const cleanNumber = String(number).replace(/[^\d]/g, '');
        if (cleanNumber.startsWith('521')) return cleanNumber;
        if (cleanNumber.length === 10) return `521${cleanNumber}`;
        return cleanNumber;
    }

    function escapeHtml(value) {
        return String(value || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    async function ensurePanelLoaded() {
        if (root.dataset.loaded === '1') return;
        if (!loadingPromise) {
            loadingPromise = fetch('admin-technicians-panel.html?v=2.4')
                .then((res) => {
                    if (!res.ok) throw new Error(`HTTP ${res.status}`);
                    return res.text();
                })
                .then((html) => {
                    setSafeDOM(root, html);
                    root.dataset.loaded = '1';
                })
                .catch((error) => {
                    console.error('Error cargando panel de técnicos:', error);
                    setSafeDOM(root, '<div class="alert alert-danger">No se pudo cargar el panel de técnicos y operadores.</div>');
                    loadingPromise = null;
                });
        }
        await loadingPromise;
    }

    function getActiveShiftFromTabs(tabListSelector) {
        const active = root.querySelector(`${tabListSelector} .nav-link.active`);
        if (!active) return null;
        const id = active.id || '';
        if (id.includes('-a') || id === 'tab-a' || id === 'op-tab-a') return 'a';
        if (id.includes('-b') || id === 'tab-b' || id === 'op-tab-b') return 'b';
        if (id.includes('-c') || id === 'tab-c' || id === 'op-tab-c') return 'c';
        if (id.includes('-d') || id === 'tab-d' || id === 'op-tab-d') return 'd';
        return null;
    }

    function addNumberField(targetId) {
        const container = root.querySelector(`#${targetId}_container`);
        if (!container) return;

        const newField = document.createElement('div');
        newField.className = 'card mb-2';
        setSafeDOM(newField, `
            <div class="card-body p-3">
                <div class="row g-2">
                    <div class="col-md-4">
                        <label class="form-label small">Nombre del Técnico</label>
                        <input type="text" class="form-control tech-name-input" name="${targetId}_names[]" placeholder="Ej: Juan Pérez" maxlength="50">
                    </div>
                    <div class="col-md-6">
                        <label class="form-label small">Número de Teléfono</label>
                        <div class="input-group">
                            <span class="input-group-text">+521</span>
                            <input type="tel" class="form-control tech-input" name="${targetId}[]" pattern="[0-9]{10}" maxlength="10" placeholder="10 dígitos">
                        </div>
                    </div>
                    <div class="col-md-2 d-flex align-items-end">
                        <button type="button" class="btn btn-outline-danger remove-number w-100"><i class="bi bi-trash"></i></button>
                    </div>
                </div>
            </div>`);
        newField.querySelector('.remove-number').addEventListener('click', () => {
            newField.remove();
            updateRemoveButtons(targetId);
        });
        container.appendChild(newField);
        updateRemoveButtons(targetId);
    }

    function updateRemoveButtons(targetId) {
        const container = root.querySelector(`#${targetId}_container`);
        if (!container) return;
        const removeButtons = container.querySelectorAll('.remove-number');
        removeButtons.forEach((btn) => {
            btn.style.display = removeButtons.length > 1 ? '' : 'none';
        });
    }

    function renderTechnicianFields(targetId, technicianData) {
        const container = root.querySelector(`#${targetId}_container`);
        if (!container) return;
        container.replaceChildren();

        const list = [];
        if (Array.isArray(technicianData)) {
            technicianData.forEach((number) => list.push({ name: '', phone: number }));
        } else if (technicianData && Array.isArray(technicianData.technicians)) {
            technicianData.technicians.forEach((tech) => list.push(tech));
        } else if (technicianData && Array.isArray(technicianData.numbers)) {
            technicianData.numbers.forEach((phone, idx) => {
                const tech = technicianData.technicians && technicianData.technicians[idx];
                list.push(tech || { name: '', phone });
            });
        }

        list.forEach((tech) => {
            const displayNumber = tech.phone ? String(tech.phone).replace(/^521/, '') : '';
            const field = document.createElement('div');
            field.className = 'card mb-2';
            setSafeDOM(field, `
                <div class="card-body p-3">
                    <div class="row g-2">
                        <div class="col-md-4">
                            <label class="form-label small">Nombre del Técnico</label>
                            <input type="text" class="form-control tech-name-input" name="${targetId}_names[]" maxlength="50" value="${escapeHtml(tech.name)}">
                        </div>
                        <div class="col-md-6">
                            <label class="form-label small">Número de Teléfono</label>
                            <div class="input-group">
                                <span class="input-group-text">+521</span>
                                <input type="tel" class="form-control tech-input" name="${targetId}[]" pattern="[0-9]{10}" maxlength="10" value="${escapeHtml(displayNumber)}">
                            </div>
                        </div>
                        <div class="col-md-2 d-flex align-items-end">
                            <button type="button" class="btn btn-outline-danger remove-number w-100"><i class="bi bi-trash"></i></button>
                        </div>
                    </div>
                </div>`);
            field.querySelector('.remove-number').addEventListener('click', () => {
                field.remove();
                updateRemoveButtons(targetId);
            });
            container.appendChild(field);
        });

        if (container.children.length === 0) addNumberField(targetId);
        updateRemoveButtons(targetId);
    }

    function readLegacyFlatKey(data, areaKey, shift) {
        const letter = shiftLetter(shift).toUpperCase();
        const flat = data[`${areaKey}.${letter}`];
        if (!flat) return null;
        return readShiftData({ [letter]: flat }, shift);
    }

    async function loadCurrentNumbersForShift(shift) {
        const firestore = getFirestoreDb();
        if (!firestore) {
            showPanelAlert('Firebase no está disponible. Recarga la página.', 'danger');
            return;
        }

        try {
            const doc = await firestore.collection('config').doc('technicians').get();
            const data = doc.exists ? doc.data() : {};

            dynamicAreas.forEach((area) => {
                const targetId = `${area.id}_${shiftLetter(shift)}`;
                
                // Intentar leer con dbKey del área dinámica
                let technicianData = readShiftData(data[area.dbKey], shift);
                
                // Si no hay datos y tiene legacyKey, usar la legacyKey como fallback
                if (!technicianData && area.legacyKey) {
                    technicianData = 
                        readShiftData(data[area.legacyKey], shift) ||
                        readLegacyFlatKey(data, area.legacyKey, shift);
                }

                // Si todavía no hay datos, probar lista adicional de fallbackKeys
                if (!technicianData && area.fallbackKeys) {
                    for (const fbKey of area.fallbackKeys) {
                        technicianData = 
                            readShiftData(data[fbKey], shift) ||
                            readLegacyFlatKey(data, fbKey, shift);
                        if (technicianData) break;
                    }
                }
                
                renderTechnicianFields(targetId, technicianData);
            });
        } catch (error) {
            console.error('Error cargando técnicos:', error);
            showPanelAlert('Error cargando los números de técnicos', 'danger');
        }
    }

    function addOperatorField(targetId) {
        const container = root.querySelector(`#${targetId}_container`);
        if (!container) return;

        const newField = document.createElement('div');
        newField.className = 'card mb-2';
        setSafeDOM(newField, `
            <div class="card-body p-3">
                <div class="row g-2">
                    <div class="col-md-4">
                        <label class="form-label small">Nombre del Operador</label>
                        <input type="text" class="form-control operator-name-input" name="${targetId}_names[]" maxlength="50" required>
                    </div>
                    <div class="col-md-6">
                        <label class="form-label small">Número de Teléfono</label>
                        <div class="input-group">
                            <span class="input-group-text">+521</span>
                            <input type="tel" class="form-control operator-input" name="${targetId}[]" pattern="[0-9]{10}" maxlength="10" required>
                        </div>
                    </div>
                    <div class="col-md-2 d-flex align-items-end">
                        <button type="button" class="btn btn-outline-danger remove-operator w-100"><i class="bi bi-trash"></i></button>
                    </div>
                </div>
            </div>`);
        newField.querySelector('.remove-operator').addEventListener('click', () => {
            newField.remove();
            updateOperatorRemoveButtons(targetId);
        });
        container.appendChild(newField);
        updateOperatorRemoveButtons(targetId);
    }

    function updateOperatorRemoveButtons(targetId) {
        const container = root.querySelector(`#${targetId}_container`);
        if (!container) return;
        const removeButtons = container.querySelectorAll('.remove-operator');
        removeButtons.forEach((btn) => {
            btn.style.display = removeButtons.length > 1 ? '' : 'none';
        });
    }

    async function loadCurrentOperatorsForShift(shift) {
        const firestore = getFirestoreDb();
        if (!firestore) return;

        try {
            const doc = await firestore.collection('config').doc('operators').get();
            const data = doc.exists ? doc.data() : {};
            const shiftKey = shiftLetter(shift).toUpperCase();
            const targetId = `operators_${shiftLetter(shift)}`;
            const container = root.querySelector(`#${targetId}_container`);
            if (!container) return;
            container.replaceChildren();

            const operatorData = data[shiftKey] || data[shiftLabel(shift)];
            if (Array.isArray(operatorData)) {
                operatorData.forEach((operator) => {
                    const displayNumber = operator.phone ? String(operator.phone).replace(/^521/, '') : '';
                    const field = document.createElement('div');
                    field.className = 'card mb-2';
                    setSafeDOM(field, `
                        <div class="card-body p-3">
                            <div class="row g-2">
                                <div class="col-md-4">
                                    <label class="form-label small">Nombre del Operador</label>
                                    <input type="text" class="form-control operator-name-input" name="${targetId}_names[]" value="${escapeHtml(operator.name)}" required>
                                </div>
                                <div class="col-md-6">
                                    <label class="form-label small">Número de Teléfono</label>
                                    <div class="input-group">
                                        <span class="input-group-text">+521</span>
                                        <input type="tel" class="form-control operator-input" name="${targetId}[]" value="${escapeHtml(displayNumber)}" required>
                                    </div>
                                </div>
                                <div class="col-md-2 d-flex align-items-end">
                                    <button type="button" class="btn btn-outline-danger remove-operator w-100"><i class="bi bi-trash"></i></button>
                                </div>
                            </div>
                        </div>`);
                    field.querySelector('.remove-operator').addEventListener('click', () => {
                        field.remove();
                        updateOperatorRemoveButtons(targetId);
                    });
                    container.appendChild(field);
                });
            }

            if (container.children.length === 0) addOperatorField(targetId);
            updateOperatorRemoveButtons(targetId);
        } catch (error) {
            console.error('Error cargando operadores:', error);
            showPanelAlert('Error cargando los operadores', 'danger');
        }
    }

    async function saveTechnicians() {
        const firestore = getFirestoreDb();
        if (!firestore) {
            showPanelAlert('Firebase no está disponible. Recarga la página.', 'danger');
            return;
        }

        const techForm = root.querySelector('#techForm');
        if (!techForm) {
            showPanelAlert('Formulario de técnicos no encontrado.', 'danger');
            return;
        }

        const activeShift = getActiveShiftFromTabs('#jornadaTabs') || selectedShift;
        selectedShift = activeShift;
        const applyToAllShifts = Boolean(root.querySelector('#applyTechToAllShifts')?.checked);

        try {
            const formData = new FormData(techForm);
            let hasErrors = false;
            let savedAreas = 0;

            const doc = await firestore.collection('config').doc('technicians').get();
            const currentData = doc.exists ? doc.data() : {};
            const shiftPayloads = {};

            dynamicAreas.forEach((area) => {
                const targetId = `${area.id}_${shiftLetter(activeShift)}`;
                const numbers = formData.getAll(`${targetId}[]`);
                const names = formData.getAll(`${targetId}_names[]`);
                const technicians = [];
                const validNumbers = [];

                for (let i = 0; i < numbers.length; i++) {
                    const number = numbers[i] ? String(numbers[i]).trim() : '';
                    const name = names[i] ? String(names[i]).trim() : '';
                    if (!number) continue;

                    if (!validatePhoneNumber(number)) {
                        showPanelAlert(`Número inválido en ${area.label} (${shiftLabel(activeShift)}): debe tener 10 dígitos.`, 'danger');
                        hasErrors = true;
                        continue;
                    }

                    const formattedNumber = formatPhoneNumber(number);
                    validNumbers.push(formattedNumber);
                    technicians.push({
                        name: name || `Técnico ${formattedNumber.slice(-4)}`,
                        phone: formattedNumber
                    });
                }

                shiftPayloads[area.id] = { technicians, numbers: validNumbers };
                if (validNumbers.length > 0) {
                    savedAreas++;
                }
            });

            if (hasErrors) return;

            if (savedAreas === 0) {
                showPanelAlert('Agrega al menos un número de técnico antes de guardar.', 'warning');
                return;
            }

            const shiftsToWrite = applyToAllShifts ? ['a', 'b', 'c', 'd'] : [activeShift];
            shiftsToWrite.forEach((shift) => {
                dynamicAreas.forEach((area) => {
                    const payload = shiftPayloads[area.id];
                    if (!payload || payload.numbers.length === 0) return;

                    if (!currentData[area.dbKey]) currentData[area.dbKey] = {};
                    writeShiftData(currentData[area.dbKey], shift, payload);
                });
            });

            // Eliminar llaves planas incorrectas legadas (ej. con puntos)
            Object.keys(currentData).forEach((docKey) => {
                if (docKey.includes('.')) delete currentData[docKey];
            });

            await firestore.collection('config').doc('technicians').set(currentData);
            const scopeLabel = applyToAllShifts ? 'todas las jornadas' : shiftLabel(activeShift);
            showPanelAlert(`Técnicos guardados para ${scopeLabel}. El bot notificará a esos números cuando haya una falla.`, 'success');
            await loadCurrentNumbersForShift(activeShift);
        } catch (error) {
            console.error('Error guardando técnicos:', error);
            showPanelAlert(`Error guardando técnicos: ${error.message}`, 'danger');
        }
    }

    async function saveOperators() {
        const firestore = getFirestoreDb();
        if (!firestore) {
            showPanelAlert('Firebase no está disponible. Recarga la página.', 'danger');
            return;
        }

        const operatorsForm = root.querySelector('#operatorsForm');
        if (!operatorsForm) {
            showPanelAlert('Formulario de operadores no encontrado.', 'danger');
            return;
        }

        const activeShift = getActiveShiftFromTabs('#operatorsJornadaTabs') || selectedOperatorShift;
        selectedOperatorShift = activeShift;

        try {
            const formData = new FormData(operatorsForm);
            const targetId = `operators_${shiftLetter(activeShift)}`;
            const numbers = formData.getAll(`${targetId}[]`);
            const names = formData.getAll(`${targetId}_names[]`);
            const operators = [];
            let hasErrors = false;

            for (let i = 0; i < numbers.length; i++) {
                const number = numbers[i] ? String(numbers[i]).trim() : '';
                const name = names[i] ? String(names[i]).trim() : '';
                if (!number && !name) continue;
                if (!number || !name) {
                    showPanelAlert('Cada operador necesita nombre y número de 10 dígitos.', 'warning');
                    hasErrors = true;
                    continue;
                }

                if (!validatePhoneNumber(number)) {
                    showPanelAlert(`Número inválido en ${shiftLabel(activeShift)}.`, 'danger');
                    hasErrors = true;
                    continue;
                }

                operators.push({ name, phone: formatPhoneNumber(number) });
            }

            if (hasErrors) return;
            if (operators.length === 0) {
                showPanelAlert(`Agrega al menos un operador válido (${shiftLabel(activeShift)}).`, 'warning');
                return;
            }

            const doc = await firestore.collection('config').doc('operators').get();
            const currentData = doc.exists ? doc.data() : {};
            const letter = shiftLetter(activeShift).toUpperCase();
            currentData[letter] = operators;
            currentData[shiftLabel(activeShift)] = operators;

            await firestore.collection('config').doc('operators').set(currentData, { merge: true });
            showPanelAlert(`Operadores guardados para ${shiftLabel(activeShift)}.`, 'success');
            await loadCurrentOperatorsForShift(activeShift);
        } catch (error) {
            console.error('Error guardando operadores:', error);
            showPanelAlert(`Error guardando operadores: ${error.message}`, 'danger');
        }
    }

    // ==========================================
    // GESTIÓN Y ROTACIÓN DE JORNADAS
    // ==========================================
    const DEFAULT_ROTATION_CONFIG = {
        scheme: 'habitual',
        customMapping: { A: 'D', B: 'C', C: 'B', D: 'A' },
        frequency: '30',
        customDays: 30,
        nextDate: '',
        autoEnabled: false,
        notifyMode: 'group',
        groupJid: '',
        customNote: '',
        lastRotationAt: null,
        exceptions: []
    };

    let activeRotationExceptions = [];
    let cachedStaffList = [];

    /**
     * Resuelve el destino final de una persona considerando la rotación general
     * y las permutas/excepciones activas.
     */
    function resolveStaffDestination(personPhone, personRole, sourceShift, mapping, exceptions) {
        let targetShift = mapping[sourceShift] || sourceShift;
        let badge = null;

        if (!Array.isArray(exceptions) || exceptions.length === 0) {
            return { targetShift, badge };
        }

        for (const exc of exceptions) {
            const isP1 = (exc.person1 && String(exc.person1.phone) === String(personPhone) && exc.person1.role === personRole);
            const isP2 = (exc.person2 && String(exc.person2.phone) === String(personPhone) && exc.person2.role === personRole);

            if (isP1) {
                if (exc.type === 'no_rotate') {
                    return {
                        targetShift: sourceShift,
                        badge: { text: '📌 Fijo (No rota)', class: 'bg-info bg-opacity-25 text-info border border-info border-opacity-50' },
                        exception: exc
                    };
                }
                if (exc.type === 'reassign' && exc.targetShift) {
                    return {
                        targetShift: exc.targetShift,
                        badge: { text: `➡️ Reasignado a Jornada ${exc.targetShift}`, class: 'bg-primary bg-opacity-25 text-primary border border-primary border-opacity-50' },
                        exception: exc
                    };
                }
                if (exc.type === 'swap' && exc.person2) {
                    const p2Source = exc.person2.currentShift || 'A';
                    const p2Target = mapping[p2Source] || p2Source;
                    return {
                        targetShift: p2Target,
                        badge: { text: `🔄 Permuta con ${exc.person2.name || 'compañero'}`, class: 'bg-warning bg-opacity-25 text-warning border border-warning border-opacity-50' },
                        exception: exc
                    };
                }
            }

            if (isP2 && exc.type === 'swap' && exc.person1) {
                const p1Source = exc.person1.currentShift || 'A';
                const p1Target = mapping[p1Source] || p1Source;
                return {
                    targetShift: p1Target,
                    badge: { text: `🔄 Permuta con ${exc.person1.name || 'compañero'}`, class: 'bg-warning bg-opacity-25 text-warning border border-warning border-opacity-50' },
                    exception: exc
                };
            }
        }

        return { targetShift, badge };
    }

    /**
     * Renderiza la tabla de permutas y excepciones configuradas.
     */
    function renderRotationExceptionsList() {
        const container = root.querySelector('#rotationExceptionsListContainer');
        if (!container) return;

        if (!activeRotationExceptions || activeRotationExceptions.length === 0) {
            setSafeDOM(container, `
                <div class="text-center text-muted py-3 small">
                    <i class="bi bi-info-circle me-1"></i> No hay permutas ni excepciones registradas. Todo el personal rotará normalmente según el esquema general.
                </div>
            `);
            return;
        }

        let rowsHtml = '';
        activeRotationExceptions.forEach((exc) => {
            let typeBadge = '';
            let actionText = '';
            const p1 = exc.person1 || {};
            const p2 = exc.person2 || {};
            const roleLabel = p1.role === 'operator' ? 'Operador' : 'Técnico';

            if (exc.type === 'no_rotate') {
                typeBadge = '<span class="badge bg-info bg-opacity-25 text-info border border-info border-opacity-50"><i class="bi bi-pin-angle-fill me-1"></i> No Rota</span>';
                actionText = `Se mantiene fijo en <strong>Jornada ${p1.currentShift}</strong>`;
            } else if (exc.type === 'swap') {
                typeBadge = '<span class="badge bg-warning bg-opacity-25 text-warning border border-warning border-opacity-50"><i class="bi bi-arrow-left-right me-1"></i> Permuta</span>';
                const roleLabel2 = p2.role === 'operator' ? 'Operador' : 'Técnico';
                actionText = `Intercambia con <strong>${escapeHtml(p2.name || 'Compañero')}</strong> (${roleLabel2}, Jornada ${p2.currentShift})`;
            } else if (exc.type === 'reassign') {
                typeBadge = '<span class="badge bg-primary bg-opacity-25 text-primary border border-primary border-opacity-50"><i class="bi bi-arrow-right-circle me-1"></i> Reasignación</span>';
                actionText = `Pasa directo a <strong>Jornada ${exc.targetShift}</strong>`;
            }

            const durationBadge = exc.duration === 'permanent'
                ? '<span class="badge bg-secondary">Permanente</span>'
                : '<span class="badge bg-primary">Próxima rotación</span>';

            const reasonText = exc.reason ? `<div class="small text-muted fst-italic">"${escapeHtml(exc.reason)}"</div>` : '';

            rowsHtml += `
                <tr>
                    <td class="align-middle">${typeBadge}</td>
                    <td class="align-middle">
                        <div class="fw-semibold text-body">${escapeHtml(p1.name || 'Sin nombre')}</div>
                        <div class="small text-muted">${roleLabel} • Jornada actual: <strong>${p1.currentShift}</strong>${p1.area ? ' (' + escapeHtml(p1.area) + ')' : ''}</div>
                    </td>
                    <td class="align-middle">
                        <div>${actionText}</div>
                        ${reasonText}
                    </td>
                    <td class="align-middle text-center">${durationBadge}</td>
                    <td class="align-middle text-end">
                        <button type="button" class="btn btn-sm btn-outline-danger btn-delete-exception" data-id="${exc.id}" title="Eliminar permuta">
                            <i class="bi bi-trash"></i>
                        </button>
                    </td>
                </tr>
            `;
        });

        setSafeDOM(container, `
            <div class="table-responsive">
                <table class="table table-sm table-hover align-middle mb-0">
                    <thead class="table-light">
                        <tr class="small text-muted">
                            <th>Tipo</th>
                            <th>Persona Afectada</th>
                            <th>Regla / Reemplazo</th>
                            <th class="text-center">Vigencia</th>
                            <th class="text-end">Acción</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${rowsHtml}
                    </tbody>
                </table>
            </div>
        `);

        container.querySelectorAll('.btn-delete-exception').forEach((btn) => {
            btn.addEventListener('click', async () => {
                const id = btn.getAttribute('data-id');
                await deleteRotationException(id);
            });
        });
    }

    /**
     * Carga todo el personal de Firebase y llena los selects del modal de excepciones.
     */
    async function loadAllStaffList() {
        const firestore = getFirestoreDb();
        if (!firestore) return [];

        try {
            const [techDoc, opDoc] = await Promise.all([
                firestore.collection('config').doc('technicians').get(),
                firestore.collection('config').doc('operators').get()
            ]);

            const techData = techDoc.exists ? techDoc.data() : {};
            const opData = opDoc.exists ? opDoc.data() : {};
            const staff = [];
            const shifts = ['A', 'B', 'C', 'D'];

            shifts.forEach((s) => {
                // Operadores
                const ops = opData[s] || opData[`Jornada ${s}`] || [];
                if (Array.isArray(ops)) {
                    ops.forEach((o) => {
                        if (o && (o.phone || o.name)) {
                            staff.push({
                                role: 'operator',
                                phone: String(o.phone || ''),
                                name: o.name || 'Operador',
                                currentShift: s,
                                area: '',
                                areaKey: ''
                            });
                        }
                    });
                }

                // Técnicos por área
                dynamicAreas.forEach((area) => {
                    const areaObj = techData[area.dbKey];
                    const shiftObj = readShiftData(areaObj, s);
                    if (shiftObj && Array.isArray(shiftObj.technicians)) {
                        shiftObj.technicians.forEach((t) => {
                            if (t && t.phone) {
                                staff.push({
                                    role: 'technician',
                                    phone: String(t.phone),
                                    name: t.name || 'Técnico',
                                    currentShift: s,
                                    area: area.label,
                                    areaKey: area.dbKey
                                });
                            }
                        });
                    }
                });
            });

            cachedStaffList = staff;
            return staff;
        } catch (err) {
            console.error('Error cargando personal para permutas:', err);
            return [];
        }
    }

    function populateStaffSelect(selectEl, roleFilter, excludePhone = null) {
        if (!selectEl) return;
        setSafeDOM(selectEl, '<option value="">-- Seleccionar trabajador --</option>');

        const filtered = cachedStaffList.filter((p) => {
            if (roleFilter && p.role !== roleFilter) return false;
            if (excludePhone && String(p.phone) === String(excludePhone)) return false;
            return true;
        });

        const shifts = ['A', 'B', 'C', 'D'];
        shifts.forEach((s) => {
            const shiftPersons = filtered.filter(p => p.currentShift === s);
            if (shiftPersons.length > 0) {
                const headerOpt = document.createElement('option');
                headerOpt.disabled = true;
                headerOpt.textContent = `── Jornada ${s} (${s === 'A' || s === 'B' ? 'Día' : 'Noche'}) ──`;
                headerOpt.style.backgroundColor = '#1e293b';
                headerOpt.style.color = '#38bdf8';
                headerOpt.style.fontWeight = 'bold';
                selectEl.appendChild(headerOpt);

                shiftPersons.forEach((p) => {
                    const opt = document.createElement('option');
                    opt.value = p.phone;
                    opt.textContent = `   ${p.name} (Jornada ${p.currentShift}${p.area ? ' - ' + p.area : ''})`;
                    opt.dataset.role = p.role;
                    opt.dataset.name = p.name;
                    opt.dataset.shift = p.currentShift;
                    opt.dataset.area = p.area || '';
                    opt.dataset.areaKey = p.areaKey || '';
                    opt.style.backgroundColor = '#0b0f19';
                    opt.style.color = '#f8fafc';
                    selectEl.appendChild(opt);
                });
            }
        });
    }

    async function openAddExceptionModal() {
        await loadAllStaffList();
        const role1 = root.querySelector('#exceptionRole1')?.value || 'technician';
        const role2 = root.querySelector('#exceptionRole2')?.value || 'technician';
        const select1 = root.querySelector('#exceptionPerson1');
        const select2 = root.querySelector('#exceptionPerson2');

        populateStaffSelect(select1, role1);
        populateStaffSelect(select2, role2);

        const form = root.querySelector('#addExceptionForm');
        if (form) form.reset();

        const typeSelect = root.querySelector('#exceptionTypeSelect');
        if (typeSelect) typeSelect.value = 'no_rotate';

        const swapBlock = root.querySelector('#swapTargetBlock');
        const reassignBlock = root.querySelector('#reassignTargetBlock');
        if (swapBlock) swapBlock.style.display = 'none';
        if (reassignBlock) reassignBlock.style.display = 'none';

        const modalEl = document.getElementById('addExceptionModal');
        if (modalEl) {
            bootstrap.Modal.getOrCreateInstance(modalEl).show();
        }
    }

    async function saveNewException() {
        const type = root.querySelector('#exceptionTypeSelect')?.value || 'no_rotate';
        const duration = root.querySelector('#exceptionDurationSelect')?.value || 'temporary';
        const reason = root.querySelector('#exceptionReason')?.value?.trim() || '';

        const select1 = root.querySelector('#exceptionPerson1');
        const selectedOpt1 = select1?.selectedOptions[0];
        if (!selectedOpt1 || !selectedOpt1.value) {
            showPanelAlert('Por favor selecciona al trabajador principal afectado.', 'warning');
            return;
        }

        const person1 = {
            role: selectedOpt1.dataset.role,
            phone: selectedOpt1.value,
            name: selectedOpt1.dataset.name,
            currentShift: selectedOpt1.dataset.shift,
            area: selectedOpt1.dataset.area,
            areaKey: selectedOpt1.dataset.areaKey
        };

        let person2 = null;
        let targetShift = null;

        if (type === 'swap') {
            const select2 = root.querySelector('#exceptionPerson2');
            const selectedOpt2 = select2?.selectedOptions[0];
            if (!selectedOpt2 || !selectedOpt2.value) {
                showPanelAlert('Para una permuta directa, debes seleccionar al segundo compañero que intercambiará turno.', 'warning');
                return;
            }
            if (selectedOpt1.value === selectedOpt2.value) {
                showPanelAlert('No puedes permutar a una persona consigo misma.', 'warning');
                return;
            }
            person2 = {
                role: selectedOpt2.dataset.role,
                phone: selectedOpt2.value,
                name: selectedOpt2.dataset.name,
                currentShift: selectedOpt2.dataset.shift,
                area: selectedOpt2.dataset.area,
                areaKey: selectedOpt2.dataset.areaKey
            };
        } else if (type === 'reassign') {
            targetShift = root.querySelector('#exceptionTargetShift')?.value || 'A';
        }

        const newException = {
            id: 'exc_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
            type,
            duration,
            reason,
            createdAt: new Date().toISOString(),
            person1,
            person2,
            targetShift
        };

        activeRotationExceptions.push(newException);

        const firestore = getFirestoreDb();
        if (firestore) {
            try {
                await firestore.collection('config').doc('shift_rotation').set({
                    exceptions: activeRotationExceptions
                }, { merge: true });
            } catch (err) {
                console.error('Error guardando excepción en Firestore:', err);
            }
        }

        const modalEl = document.getElementById('addExceptionModal');
        if (modalEl) {
            bootstrap.Modal.getInstance(modalEl)?.hide();
        }

        showPanelAlert('Permuta o excepción registrada con éxito.', 'success');
        renderRotationExceptionsList();
        renderRotationPreview();
    }

    async function deleteRotationException(id) {
        activeRotationExceptions = activeRotationExceptions.filter(e => e.id !== id);

        const firestore = getFirestoreDb();
        if (firestore) {
            try {
                await firestore.collection('config').doc('shift_rotation').set({
                    exceptions: activeRotationExceptions
                }, { merge: true });
            } catch (err) {
                console.error('Error eliminando excepción en Firestore:', err);
            }
        }

        showPanelAlert('Permuta eliminada.', 'info');
        renderRotationExceptionsList();
        renderRotationPreview();
    }

    function getRotationMapping(scheme, customMapping) {
        if (scheme === 'habitual') {
            // Rotación habitual:
            // Jornada C intercambia con Jornada B (C va a B, B va a C)
            // Jornada A intercambia con Jornada D (A va a D, D va a A)
            return { A: 'D', B: 'C', C: 'B', D: 'A' };
        }
        if (scheme === 'semestral') {
            // Inversión vertical de turnos (cada 6 meses): A⇄C, B⇄D
            return { A: 'C', B: 'D', C: 'A', D: 'B' };
        }
        return customMapping || { A: 'D', B: 'C', C: 'B', D: 'A' };
    }

    function getSchemeDescriptionText(scheme) {
        if (scheme === 'habitual') {
            return 'Rotación habitual: Jornada C intercambia con B (C⇄B) y Jornada A intercambia con D (A⇄D).';
        }
        if (scheme === 'semestral') {
            return 'Inversión vertical de turnos cada 6 meses: Jornada A intercambia con C (A⇄C) y Jornada B intercambia con D (B⇄D).';
        }
        return 'Matriz manual configurada por el usuario para determinar la rotación de cada jornada.';
    }

    function detectSchemeFromMatrix(mapping) {
        const m = mapping || {
            A: root.querySelector('#matrix_target_a')?.value || 'D',
            B: root.querySelector('#matrix_target_b')?.value || 'C',
            C: root.querySelector('#matrix_target_c')?.value || 'B',
            D: root.querySelector('#matrix_target_d')?.value || 'A'
        };

        if (m.A === 'D' && m.B === 'C' && m.C === 'B' && m.D === 'A') {
            return 'habitual';
        }
        if (m.A === 'C' && m.B === 'D' && m.C === 'A' && m.D === 'B') {
            return 'semestral';
        }
        return 'custom';
    }

    function updateSchemeUI(scheme) {
        const badge = root.querySelector('#currentSchemeBadge');
        const desc = root.querySelector('#rotationSchemeDescription');
        const btnHab = root.querySelector('#btnPresetHabitual');
        const btnSem = root.querySelector('#btnPresetSemestral');
        const btnCus = root.querySelector('#btnPresetCustom');

        if (btnHab) btnHab.classList.toggle('active', scheme === 'habitual');
        if (btnSem) btnSem.classList.toggle('active', scheme === 'semestral');
        if (btnCus) btnCus.classList.toggle('active', scheme === 'custom');

        if (badge) {
            if (scheme === 'habitual') {
                badge.textContent = 'Habitual (C⇄B, A⇄D)';
                badge.className = 'badge bg-primary';
            } else if (scheme === 'semestral') {
                badge.textContent = 'Semestral (A⇄C, B⇄D)';
                badge.className = 'badge bg-info text-dark';
            } else {
                badge.textContent = 'Manual / Personalizado';
                badge.className = 'badge bg-secondary';
            }
        }

        if (desc) {
            desc.textContent = getSchemeDescriptionText(scheme);
        }
    }

    function applyPresetScheme(scheme) {
        let mapping;
        if (scheme === 'habitual') {
            mapping = { A: 'D', B: 'C', C: 'B', D: 'A' };
        } else if (scheme === 'semestral') {
            mapping = { A: 'C', B: 'D', C: 'A', D: 'B' };
        }

        if (mapping) {
            ['a', 'b', 'c', 'd'].forEach((s) => {
                const el = root.querySelector(`#matrix_target_${s}`);
                if (el) el.value = mapping[s.toUpperCase()];
            });
        }
        updateSchemeUI(scheme);
        renderRotationPreview();
    }

    async function loadRotationConfig() {
        const firestore = getFirestoreDb();
        if (!firestore) return;

        try {
            const doc = await firestore.collection('config').doc('shift_rotation').get();
            let config = DEFAULT_ROTATION_CONFIG;
            if (doc.exists) {
                config = { ...DEFAULT_ROTATION_CONFIG, ...doc.data() };
            }

            const mapping = config.mapping || config.customMapping || { A: 'D', B: 'C', C: 'B', D: 'A' };
            ['a', 'b', 'c', 'd'].forEach((s) => {
                const el = root.querySelector(`#matrix_target_${s}`);
                if (el && mapping[s.toUpperCase()]) {
                    el.value = mapping[s.toUpperCase()];
                }
            });

            const currentScheme = config.scheme || detectSchemeFromMatrix(mapping);
            updateSchemeUI(currentScheme);

            const freqSelect = root.querySelector('#rotationFrequencySelect');
            const customDaysCol = root.querySelector('#customDaysCol');
            const customDaysInput = root.querySelector('#rotationCustomDays');
            if (freqSelect) {
                freqSelect.value = config.frequency || '30';
                if (customDaysCol) {
                    customDaysCol.style.display = config.frequency === 'custom' ? '' : 'none';
                }
            }
            if (customDaysInput) customDaysInput.value = config.customDays || 30;

            const nextDateInput = root.querySelector('#rotationNextDate');
            if (nextDateInput && config.nextDate) {
                nextDateInput.value = config.nextDate;
            }

            const autoEnabled = root.querySelector('#rotationAutoEnabled');
            if (autoEnabled) autoEnabled.checked = Boolean(config.autoEnabled);

            const notifyModeRadios = root.querySelectorAll('input[name="rotationNotifyMode"]');
            notifyModeRadios.forEach((r) => {
                r.checked = (r.value === (config.notifyMode || 'group'));
            });

            const groupJid = root.querySelector('#rotationGroupJid');
            if (groupJid) groupJid.value = config.groupJid || '';

            const customNote = root.querySelector('#rotationCustomNote');
            if (customNote) customNote.value = config.customNote || '';

            const lastBadge = root.querySelector('#lastRotationBadge');
            if (lastBadge) {
                if (config.lastRotationAt) {
                    const d = new Date(config.lastRotationAt);
                    lastBadge.textContent = `Última rotación: ${d.toLocaleDateString()} ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
                    lastBadge.className = 'badge bg-success';
                } else {
                    lastBadge.textContent = 'Última rotación: Nunca';
                    lastBadge.className = 'badge bg-secondary';
                }
            }

            activeRotationExceptions = Array.isArray(config.exceptions) ? config.exceptions : [];
            renderRotationExceptionsList();

            await renderRotationPreview();
        } catch (error) {
            console.error('Error cargando configuración de rotación:', error);
        }
    }

    function getRotationFormData() {
        const mapping = {
            A: root.querySelector('#matrix_target_a')?.value || 'D',
            B: root.querySelector('#matrix_target_b')?.value || 'C',
            C: root.querySelector('#matrix_target_c')?.value || 'B',
            D: root.querySelector('#matrix_target_d')?.value || 'A'
        };
        const scheme = detectSchemeFromMatrix(mapping);
        const frequency = root.querySelector('#rotationFrequencySelect')?.value || '30';
        const customDays = parseInt(root.querySelector('#rotationCustomDays')?.value || '30', 10);
        const nextDate = root.querySelector('#rotationNextDate')?.value || '';
        const autoEnabled = Boolean(root.querySelector('#rotationAutoEnabled')?.checked);
        const notifyMode = root.querySelector('input[name="rotationNotifyMode"]:checked')?.value || 'group';
        const groupJid = root.querySelector('#rotationGroupJid')?.value?.trim() || '';
        const customNote = root.querySelector('#rotationCustomNote')?.value?.trim() || '';

        return {
            scheme,
            customMapping: mapping,
            mapping,
            frequency,
            customDays,
            nextDate,
            autoEnabled,
            notifyMode,
            groupJid,
            customNote
        };
    }

    async function saveRotationConfig(showSuccessAlert = true) {
        const firestore = getFirestoreDb();
        if (!firestore) {
            showPanelAlert('Firebase no está disponible.', 'danger');
            return;
        }

        const btn = root.querySelector('#saveRotationConfigBtn');
        if (btn) {
            btn.disabled = true;
            setSafeDOM(btn, '<span class="spinner-border spinner-border-sm me-1"></span> Guardando...');
        }

        try {
            const data = getRotationFormData();
            await firestore.collection('config').doc('shift_rotation').set(data, { merge: true });
            if (showSuccessAlert) {
                showPanelAlert('Configuración de rotación guardada correctamente.', 'success');
            }
            if (btn) {
                setSafeDOM(btn, '<i class="bi bi-check-circle-fill me-1"></i> ¡Guardado!');
                setTimeout(() => {
                    btn.disabled = false;
                    setSafeDOM(btn, '<i class="bi bi-save"></i> Guardar Configuración');
                }, 2000);
            }
        } catch (error) {
            console.error('Error guardando configuración de rotación:', error);
            showPanelAlert(`Error guardando configuración: ${error.message}`, 'danger');
            if (btn) {
                btn.disabled = false;
                setSafeDOM(btn, '<i class="bi bi-save"></i> Guardar Configuración');
            }
        }
    }

    async function renderRotationPreview() {
        const firestore = getFirestoreDb();
        const container = root.querySelector('#rotationPreviewCards');
        if (!firestore || !container) return;

        setSafeDOM(container, `
            <div class="col-12 text-center text-muted py-4">
                <div class="spinner-border spinner-border-sm text-primary" role="status"></div>
                <span class="ms-2">Calculando distribución antes vs después...</span>
            </div>
        `);

        try {
            const [techDoc, opDoc] = await Promise.all([
                firestore.collection('config').doc('technicians').get(),
                firestore.collection('config').doc('operators').get()
            ]);

            const techData = techDoc.exists ? techDoc.data() : {};
            const opData = opDoc.exists ? opDoc.data() : {};
            const formData = getRotationFormData();
            const mapping = formData.mapping;
            const scheme = formData.scheme;

            // Invertir el mapeo: para cada jornada destino T, ¿cuál es la jornada de origen S?
            const sourceFor = {};
            ['A', 'B', 'C', 'D'].forEach((s) => {
                const target = mapping[s];
                sourceFor[target] = s;
            });

            // Recopilar técnicos y operadores actuales por jornada
            const currentStaffByShift = {
                A: { techs: [], ops: [] },
                B: { techs: [], ops: [] },
                C: { techs: [], ops: [] },
                D: { techs: [], ops: [] }
            };

            const shifts = ['A', 'B', 'C', 'D'];

            shifts.forEach((s) => {
                // Operadores
                const ops = opData[s] || opData[`Jornada ${s}`] || [];
                if (Array.isArray(ops)) {
                    currentStaffByShift[s].ops = ops;
                }

                // Técnicos a través de todas las áreas
                const techMap = new Map();
                dynamicAreas.forEach((area) => {
                    const areaObj = techData[area.dbKey];
                    const shiftObj = readShiftData(areaObj, s);
                    if (shiftObj && Array.isArray(shiftObj.technicians)) {
                        shiftObj.technicians.forEach((t) => {
                            if (t && t.phone) {
                                techMap.set(t.phone, { name: t.name || 'Técnico', phone: t.phone, area: area.label });
                            }
                        });
                    }
                });
                currentStaffByShift[s].techs = Array.from(techMap.values());
            });

            // Distribuir el personal entrante considerando rotación general y permutas/excepciones
            const incomingStaffByShift = {
                A: { techs: [], ops: [] },
                B: { techs: [], ops: [] },
                C: { techs: [], ops: [] },
                D: { techs: [], ops: [] }
            };

            shifts.forEach((s) => {
                // Técnicos
                currentStaffByShift[s].techs.forEach((t) => {
                    const dest = resolveStaffDestination(t.phone, 'technician', s, mapping, activeRotationExceptions);
                    const target = dest.targetShift || 'A';
                    if (incomingStaffByShift[target]) {
                        incomingStaffByShift[target].techs.push({
                            ...t,
                            sourceShift: s,
                            badge: dest.badge
                        });
                    }
                });

                // Operadores
                currentStaffByShift[s].ops.forEach((o) => {
                    const dest = resolveStaffDestination(o.phone, 'operator', s, mapping, activeRotationExceptions);
                    const target = dest.targetShift || 'A';
                    if (incomingStaffByShift[target]) {
                        incomingStaffByShift[target].ops.push({
                            ...o,
                            sourceShift: s,
                            badge: dest.badge
                        });
                    }
                });
            });

            // Generar HTML de las 4 tarjetas (A, B, C, D)
            let html = '';
            shifts.forEach((shift) => {
                const isDay = (shift === 'A' || shift === 'B');
                const badgeColor = isDay ? 'bg-warning text-dark' : 'bg-primary';
                const icon = isDay ? 'bi-sun-fill' : 'bi-moon-stars-fill';
                const sourceShift = sourceFor[shift] || '?';
                const currentStaff = currentStaffByShift[shift];
                const incomingStaff = incomingStaffByShift[shift];

                // Verificar si en este turno hay personas con permutas
                const hasExceptions = incomingStaff.techs.some(t => t.badge) || incomingStaff.ops.some(o => o.badge);

                html += `
                    <div class="col-md-6 col-xl-3">
                        <div class="card h-100 border shadow-sm">
                            <div class="card-header d-flex justify-content-between align-items-center py-2 bg-transparent border-bottom">
                                <span class="fw-bold"><i class="bi ${icon} me-1 ${isDay ? 'text-warning' : 'text-info'}"></i> Jornada ${shift}</span>
                                <span class="badge ${badgeColor}">${isDay ? 'Día (6am-6pm)' : 'Noche (6pm-6am)'}</span>
                            </div>
                            <div class="card-body p-3">
                                <!-- ANTES -->
                                <div class="mb-3 pb-2 border-bottom border-opacity-25">
                                    <div class="d-flex justify-content-between align-items-center mb-1">
                                        <span class="badge bg-secondary bg-opacity-25 text-body border border-secondary border-opacity-25">Estado Actual</span>
                                        <small class="text-muted">Pasa a <strong class="text-primary">Jornada ${mapping[shift]}</strong></small>
                                    </div>
                                    <div class="small text-muted mb-1">
                                        🔧 Técnicos (${currentStaff.techs.length}): 
                                        <span class="text-body fw-medium">${currentStaff.techs.map(t => escapeHtml(t.name)).join(', ') || '<em class="text-muted">Ninguno</em>'}</span>
                                    </div>
                                    <div class="small text-muted">
                                        👤 Operadores (${currentStaff.ops.length}): 
                                        <span class="text-body fw-medium">${currentStaff.ops.map(o => escapeHtml(o.name)).join(', ') || '<em class="text-muted">Ninguno</em>'}</span>
                                    </div>
                                </div>

                                <!-- DESPUÉS -->
                                <div>
                                    <div class="d-flex justify-content-between align-items-center mb-1">
                                        <span class="badge bg-success bg-opacity-75 text-white">Tras Rotación</span>
                                        <small class="text-success fw-bold">
                                            ${hasExceptions ? '<i class="bi bi-arrow-left-right text-warning me-1"></i>Con permutas' : '<i class="bi bi-arrow-right-short"></i>Recibe a Jornada ' + sourceShift}
                                        </small>
                                    </div>
                                    <div class="small text-muted mb-1">
                                        🔧 Nuevos Técnicos (${incomingStaff.techs.length}): 
                                        <div class="text-body fw-semibold mt-1">
                                            ${incomingStaff.techs.map(t => {
                                                const b = t.badge ? `<span class="badge ${t.badge.class} ms-1 py-0 px-1" style="font-size:0.68rem;">${t.badge.text}</span>` : '';
                                                return `<span class="d-inline-block me-2">${escapeHtml(t.name)}${b}</span>`;
                                            }).join('') || '<em class="text-muted fw-normal">Vacío</em>'}
                                        </div>
                                    </div>
                                    <div class="small text-muted">
                                        👤 Nuevos Operadores (${incomingStaff.ops.length}): 
                                        <div class="text-body fw-semibold mt-1">
                                            ${incomingStaff.ops.map(o => {
                                                const b = o.badge ? `<span class="badge ${o.badge.class} ms-1 py-0 px-1" style="font-size:0.68rem;">${o.badge.text}</span>` : '';
                                                return `<span class="d-inline-block me-2">${escapeHtml(o.name)}${b}</span>`;
                                            }).join('') || '<em class="text-muted fw-normal">Vacío</em>'}
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                `;
            });

            setSafeDOM(container, html);
        } catch (error) {
            console.error('Error renderizando previsualización:', error);
            setSafeDOM(container, `<div class="col-12 text-danger">Error generando previsualización: ${error.message}</div>`);
        }
    }

    function openRotationModal() {
        const formData = getRotationFormData();
        const mapping = formData.mapping;
        const scheme = formData.scheme;

        // Validar colisiones (ej. que dos jornadas no vayan a la misma)
        const targets = Object.values(mapping);
        const uniqueTargets = new Set(targets);
        if (uniqueTargets.size < 4) {
            showPanelAlert('Error en la matriz: Dos o más jornadas tienen asignada la misma jornada de destino. Cada jornada debe ir a un destino distinto.', 'danger');
            return;
        }

        const summaryList = root.querySelector('#rotationModalSummaryList');
        if (summaryList) {
            let excHtml = '';
            if (activeRotationExceptions.length > 0) {
                const excItems = activeRotationExceptions.map(exc => {
                    if (exc.type === 'no_rotate') {
                        return `<li><strong>${escapeHtml(exc.person1?.name || '')}</strong> se mantiene en Jornada ${exc.person1?.currentShift} (No rota)</li>`;
                    }
                    if (exc.type === 'swap') {
                        return `<li><strong>${escapeHtml(exc.person1?.name || '')}</strong> permuta turno con <strong>${escapeHtml(exc.person2?.name || '')}</strong></li>`;
                    }
                    if (exc.type === 'reassign') {
                        return `<li><strong>${escapeHtml(exc.person1?.name || '')}</strong> pasa a Jornada ${exc.targetShift}</li>`;
                    }
                    return '';
                }).join('');

                excHtml = `
                    <li class="list-group-item list-group-item-warning">
                        <div class="fw-bold"><i class="bi bi-arrow-left-right me-1"></i> Permutas y Excepciones aplicadas (${activeRotationExceptions.length}):</div>
                        <ul class="mb-0 ps-3 small mt-1">
                            ${excItems}
                        </ul>
                    </li>
                `;
            }

            setSafeDOM(summaryList, `
                <li class="list-group-item d-flex justify-content-between align-items-center">
                    <span>Personal general de <strong>Jornada A</strong></span>
                    <span><i class="bi bi-arrow-right text-muted mx-2"></i> Pasará a <span class="badge bg-primary">Jornada ${mapping.A}</span></span>
                </li>
                <li class="list-group-item d-flex justify-content-between align-items-center">
                    <span>Personal general de <strong>Jornada B</strong></span>
                    <span><i class="bi bi-arrow-right text-muted mx-2"></i> Pasará a <span class="badge bg-primary">Jornada ${mapping.B}</span></span>
                </li>
                <li class="list-group-item d-flex justify-content-between align-items-center">
                    <span>Personal general de <strong>Jornada C</strong></span>
                    <span><i class="bi bi-arrow-right text-muted mx-2"></i> Pasará a <span class="badge bg-primary">Jornada ${mapping.C}</span></span>
                </li>
                <li class="list-group-item d-flex justify-content-between align-items-center">
                    <span>Personal general de <strong>Jornada D</strong></span>
                    <span><i class="bi bi-arrow-right text-muted mx-2"></i> Pasará a <span class="badge bg-primary">Jornada ${mapping.D}</span></span>
                </li>
                ${excHtml}
            `);
        }

        const notifyMode = root.querySelector('input[name="rotationNotifyMode"]:checked')?.value || 'group';
        const notifySummary = root.querySelector('#rotationModalNotifySummary');
        if (notifySummary) {
            if (notifyMode === 'group') {
                setSafeDOM(notifySummary, '<span class="text-success"><i class="bi bi-megaphone-fill me-1"></i> Anuncio general al Grupo de WhatsApp (Recomendado, 0% riesgo)</span>');
            } else if (notifyMode === 'direct') {
                setSafeDOM(notifySummary, '<span class="text-warning"><i class="bi bi-person-fill me-1"></i> Mensajes individuales con retraso anti-spam (6-10s entre envíos)</span>');
            } else {
                setSafeDOM(notifySummary, '<span class="text-muted"><i class="bi bi-bell-slash me-1"></i> Modo silencioso (sin avisos de WhatsApp)</span>');
            }
        }

        const confirmInput = root.querySelector('#rotationConfirmInput');
        const confirmBtn = root.querySelector('#btnConfirmExecuteRotation');
        if (confirmInput) confirmInput.value = '';
        if (confirmBtn) confirmBtn.disabled = true;

        const modalEl = document.getElementById('confirmRotationModal');
        if (modalEl) {
            const modal = bootstrap.Modal.getOrCreateInstance(modalEl);
            modal.show();
        }
    }

    async function executeShiftRotation() {
        const firestore = getFirestoreDb();
        if (!firestore) {
            showPanelAlert('Firebase no está disponible.', 'danger');
            return;
        }

        const confirmBtn = root.querySelector('#btnConfirmExecuteRotation');
        if (confirmBtn) {
            confirmBtn.disabled = true;
            setSafeDOM(confirmBtn, '<span class="spinner-border spinner-border-sm me-2"></span>Rotando datos...');
        }

        try {
            const formData = getRotationFormData();
            const mapping = getRotationMapping(formData.scheme, formData.customMapping);

            // 1. Obtener documentos actuales
            const [techDoc, opDoc] = await Promise.all([
                firestore.collection('config').doc('technicians').get(),
                firestore.collection('config').doc('operators').get()
            ]);

            const currentTech = techDoc.exists ? techDoc.data() : {};
            const currentOp = opDoc.exists ? opDoc.data() : {};

            // 2. Rotar Técnicos respetando excepciones individuales
            const newTech = {};
            const shifts = ['A', 'B', 'C', 'D'];

            Object.keys(currentTech).forEach((areaKey) => {
                if (areaKey.includes('.')) return; // Ignorar claves legadas
                const areaData = currentTech[areaKey];
                if (!areaData || typeof areaData !== 'object') {
                    newTech[areaKey] = areaData;
                    return;
                }

                // Extraer los técnicos actuales de cada jornada en esta área
                const oldShiftData = {};
                shifts.forEach((s) => {
                    oldShiftData[s] = readShiftData(areaData, s);
                });

                // Reubicar cada técnico en su nueva jornada según rotación y excepciones
                const newAreaShifts = {
                    A: { technicians: [] },
                    B: { technicians: [] },
                    C: { technicians: [] },
                    D: { technicians: [] }
                };

                shifts.forEach((sourceShift) => {
                    const shiftObj = oldShiftData[sourceShift];
                    const list = (shiftObj && Array.isArray(shiftObj.technicians)) ? shiftObj.technicians : [];
                    list.forEach((tech) => {
                        const dest = resolveStaffDestination(tech.phone, 'technician', sourceShift, mapping, activeRotationExceptions);
                        const target = dest.targetShift || 'A';
                        if (newAreaShifts[target]) {
                            newAreaShifts[target].technicians.push(tech);
                        }
                    });
                });

                const newAreaData = {};
                shifts.forEach((s) => {
                    writeShiftData(newAreaData, s, newAreaShifts[s]);
                });

                newTech[areaKey] = newAreaData;
            });

            // 3. Rotar Operadores respetando excepciones individuales
            const newOp = { A: [], B: [], C: [], D: [] };
            const oldOpData = {};
            shifts.forEach((s) => {
                oldOpData[s] = currentOp[s] || currentOp[`Jornada ${s}`] || [];
            });

            shifts.forEach((sourceShift) => {
                const list = oldOpData[sourceShift] || [];
                list.forEach((op) => {
                    const dest = resolveStaffDestination(op.phone, 'operator', sourceShift, mapping, activeRotationExceptions);
                    const target = dest.targetShift || 'A';
                    if (newOp[target]) {
                        newOp[target].push(op);
                    }
                });
            });

            shifts.forEach((s) => {
                newOp[`Jornada ${s}`] = newOp[s];
            });

            // 4. Guardar en Firestore atómicamente
            await Promise.all([
                firestore.collection('config').doc('technicians').set(newTech),
                firestore.collection('config').doc('operators').set(newOp)
            ]);

            // 5. Calcular nueva fecha programada
            const now = new Date();
            let daysToAdd = 30;
            if (formData.frequency === '15') daysToAdd = 15;
            else if (formData.frequency === '30') daysToAdd = 30;
            else if (formData.frequency === '60') daysToAdd = 60;
            else if (formData.frequency === '180') daysToAdd = 180;
            else if (formData.frequency === 'custom' && formData.customDays > 0) daysToAdd = formData.customDays;

            const nextDateObj = new Date(now.getTime() + daysToAdd * 24 * 60 * 60 * 1000);
            const nextDateStr = nextDateObj.toISOString().split('T')[0];

            // 6. Filtrar excepciones temporales (solo quedan las permanentes tras la rotación)
            const remainingExceptions = activeRotationExceptions.filter(e => e.duration === 'permanent');
            const appliedExceptionsCopy = [...activeRotationExceptions];
            activeRotationExceptions = remainingExceptions;

            // 7. Actualizar config/shift_rotation con timestamp y agregar a historial
            const rotationHistoryEntry = {
                executedAt: now.toISOString(),
                scheme: formData.scheme,
                mapping: mapping,
                notifyMode: formData.notifyMode,
                appliedExceptions: appliedExceptionsCopy,
                executedBy: 'admin_panel'
            };

            const rotationDocRef = firestore.collection('config').doc('shift_rotation');
            await rotationDocRef.set({
                ...formData,
                nextDate: nextDateStr,
                lastRotationAt: now.toISOString(),
                exceptions: remainingExceptions,
                history: (typeof firebase !== 'undefined' && firebase.firestore?.FieldValue?.arrayUnion)
                    ? firebase.firestore.FieldValue.arrayUnion(rotationHistoryEntry)
                    : [rotationHistoryEntry]
            }, { merge: true });

            // 8. Enviar comando al bot para notificar por WhatsApp
            if (formData.notifyMode !== 'silent') {
                await firestore.collection('config').doc('bot_commands').set({
                    command: 'notify_rotation',
                    scheme: formData.scheme,
                    mapping: mapping,
                    notifyMode: formData.notifyMode,
                    groupJid: formData.groupJid || null,
                    customNote: formData.customNote || '',
                    appliedExceptions: appliedExceptionsCopy.map(e => ({
                        type: e.type,
                        name1: e.person1?.name || '',
                        name2: e.person2?.name || '',
                        shift: e.person1?.currentShift || '',
                        target: e.targetShift || ''
                    })),
                    executedAt: now.toISOString(),
                    processed: false
                });
            }

            // 9. Cerrar modal y refrescar la vista
            const modalEl = document.getElementById('confirmRotationModal');
            if (modalEl) {
                const modal = bootstrap.Modal.getInstance(modalEl);
                if (modal) modal.hide();
            }

            showPanelAlert('¡Rotación de jornadas ejecutada con éxito! Se han actualizado técnicos y operadores en todas las áreas respetando las permutas configuradas.', 'success');

            // Recargar datos y previsualización
            await loadRotationConfig();
            await loadCurrentNumbersForShift(selectedShift);
            await loadCurrentOperatorsForShift(selectedOperatorShift);

        } catch (error) {
            console.error('Error al ejecutar rotación:', error);
            showPanelAlert(`Error al ejecutar rotación: ${error.message}`, 'danger');
        } finally {
            if (confirmBtn) {
                confirmBtn.disabled = false;
                setSafeDOM(confirmBtn, '<i class="bi bi-arrow-repeat"></i> Sí, Ejecutar Rotación');
            }
        }
    }

    function bindPanelEvents() {
        if (root.dataset.eventsBound === '1') return;
        root.dataset.eventsBound = '1';

        root.addEventListener('click', (e) => {
            const addTechBtn = e.target.closest('.add-number');
            if (addTechBtn && root.contains(addTechBtn)) {
                e.preventDefault();
                addNumberField(addTechBtn.dataset.target);
                return;
            }

            const addOpBtn = e.target.closest('.add-operator');
            if (addOpBtn && root.contains(addOpBtn)) {
                e.preventDefault();
                addOperatorField(addOpBtn.dataset.target);
                return;
            }

            if (e.target.closest('#refreshRotationPreviewBtn')) {
                e.preventDefault();
                renderRotationPreview();
                return;
            }

            if (e.target.closest('#saveRotationConfigBtn')) {
                e.preventDefault();
                saveRotationConfig(true);
                return;
            }

            if (e.target.closest('#btnPresetHabitual')) {
                e.preventDefault();
                applyPresetScheme('habitual');
                return;
            }

            if (e.target.closest('#btnPresetSemestral')) {
                e.preventDefault();
                applyPresetScheme('semestral');
                return;
            }

            if (e.target.closest('#btnPresetCustom')) {
                e.preventDefault();
                updateSchemeUI('custom');
                return;
            }

            if (e.target.closest('#btnOpenRotateModal')) {
                e.preventDefault();
                openRotationModal();
                return;
            }

            if (e.target.closest('#btnConfirmExecuteRotation')) {
                e.preventDefault();
                executeShiftRotation();
                return;
            }

            if (e.target.closest('#btnOpenAddExceptionModal')) {
                e.preventDefault();
                openAddExceptionModal();
                return;
            }

            if (e.target.closest('#btnSaveNewException')) {
                e.preventDefault();
                saveNewException();
                return;
            }
        });

        const excModalEl = document.getElementById('addExceptionModal');
        if (excModalEl) {
            excModalEl.addEventListener('change', (e) => {
                if (e.target.id === 'exceptionTypeSelect') {
                    const val = e.target.value;
                    const swapBlock = excModalEl.querySelector('#swapTargetBlock');
                    const reassignBlock = excModalEl.querySelector('#reassignTargetBlock');
                    if (swapBlock) swapBlock.style.display = (val === 'swap' ? '' : 'none');
                    if (reassignBlock) reassignBlock.style.display = (val === 'reassign' ? '' : 'none');
                }
                if (e.target.id === 'exceptionRole1') {
                    populateStaffSelect(excModalEl.querySelector('#exceptionPerson1'), e.target.value);
                }
                if (e.target.id === 'exceptionRole2') {
                    populateStaffSelect(excModalEl.querySelector('#exceptionPerson2'), e.target.value);
                }
            });

            const saveBtn = excModalEl.querySelector('#btnSaveNewException');
            if (saveBtn) {
                saveBtn.addEventListener('click', (e) => {
                    e.preventDefault();
                    saveNewException();
                });
            }
        }

        root.addEventListener('input', (e) => {
            if (e.target.id === 'rotationConfirmInput') {
                const val = e.target.value.trim().toUpperCase();
                const btn = root.querySelector('#btnConfirmExecuteRotation');
                if (btn) btn.disabled = (val !== 'ROTAR');
            }
        });

        root.addEventListener('change', (e) => {
            if (e.target.id === 'rotationFrequencySelect') {
                const customDaysCol = root.querySelector('#customDaysCol');
                if (customDaysCol) {
                    customDaysCol.style.display = e.target.value === 'custom' ? '' : 'none';
                }
                const now = new Date();
                let days = parseInt(e.target.value, 10);
                if (isNaN(days)) {
                    days = parseInt(root.querySelector('#rotationCustomDays')?.value || '30', 10);
                }
                const nextDateObj = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
                const nextInput = root.querySelector('#rotationNextDate');
                if (nextInput) nextInput.value = nextDateObj.toISOString().split('T')[0];
            }

            if (e.target.id === 'rotationCustomDays') {
                const days = parseInt(e.target.value || '30', 10);
                const now = new Date();
                const nextDateObj = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
                const nextInput = root.querySelector('#rotationNextDate');
                if (nextInput) nextInput.value = nextDateObj.toISOString().split('T')[0];
            }

            if (e.target.id.startsWith('matrix_target_')) {
                const mapping = getRotationFormData().mapping;
                const scheme = detectSchemeFromMatrix(mapping);
                updateSchemeUI(scheme);
                renderRotationPreview();
            }
        });

        root.addEventListener('submit', (e) => {
            if (e.target.id === 'techForm') {
                e.preventDefault();
                saveTechnicians();
            }
            if (e.target.id === 'operatorsForm') {
                e.preventDefault();
                saveOperators();
            }
            if (e.target.id === 'rotationConfigForm') {
                e.preventDefault();
                saveRotationConfig(true);
            }
        });

        root.addEventListener('shown.bs.tab', (e) => {
            const tab = e.target;
            if (!root.contains(tab)) return;

            if (tab.closest('#jornadaTabs')) {
                const shift = getActiveShiftFromTabs('#jornadaTabs') || 'a';
                selectedShift = shift;
                loadCurrentNumbersForShift(shift);
            }
            if (tab.closest('#operatorsJornadaTabs')) {
                const shift = getActiveShiftFromTabs('#operatorsJornadaTabs') || 'a';
                selectedOperatorShift = shift;
                loadCurrentOperatorsForShift(shift);
            }
            if (tab.id === 'operators-tab') {
                loadCurrentOperatorsForShift(selectedOperatorShift);
            }
            if (tab.id === 'rotation-tab') {
                loadRotationConfig();
            }
        });
    }

    async function activatePanel() {
        bindPanelEvents();
        await ensurePanelLoaded();
        await loadOperationsConfigForTechs();
        await loadCurrentNumbersForShift(selectedShift);
        await loadRotationConfig();
    }

    window.initAdminTechniciansPanel = activatePanel;

    bindPanelEvents();

    const adminTab = document.getElementById('technicians-mgmt-tab');
    if (adminTab) {
        adminTab.addEventListener('shown.bs.tab', () => activatePanel());
    }

    if (location.hash === '#technicians-mgmt' || location.hash === '#technicians') {
        document.addEventListener('DOMContentLoaded', () => {
            const tab = document.getElementById('technicians-mgmt-tab');
            if (tab) bootstrap.Tab.getOrCreateInstance(tab).show();
        });
    }
})();

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
// Usar las mismas jornadas que app.js
const SHIFTS = {
    A: {
        name: 'Jornada A',
        description: 'Domingo 6 AM → Martes 6 PM (3 días)',
        days: [0, 1, 2], // Domingo a Martes
        startHour: 6,    // 6 AM
        endHour: 18,     // 6 PM
        isNightShift: false
    },
    B: {
        name: 'Jornada B',
        description: 'Miércoles 6 AM → Sábado 6 PM (4 días)',
        days: [3, 4, 5, 6], // Miércoles a Sábado
        startHour: 6,       // 6 AM
        endHour: 18,        // 6 PM
        isNightShift: false
    },
    C: {
        name: 'Jornada C',
        description: 'Domingo 6 PM → Martes 6 AM (3 días)',
        days: [0, 1, 2], // Domingo a Martes
        startHour: 18,   // 6 PM
        endHour: 6,      // 6 AM (siguiente día)
        isNightShift: true
    },
    D: {
        name: 'Jornada D',
        description: 'Miércoles 6 PM → Domingo 6 AM (4 días)',
        days: [3, 4, 5, 6, 0], // Miércoles a Domingo (incluye domingo temprano)
        startHour: 18,         // 6 PM
        endHour: 6,            // 6 AM (siguiente día)
        isNightShift: true
    }
};

// Función para obtener la hora actual en zona horaria Chihuahua (UTC-6)
function getChihuahuaTime() {
    const now = new Date();
    const chihuahuaTime = new Date(now.getTime() - (6 * 60 * 60 * 1000)); // UTC-6
    return chihuahuaTime;
}

// Función para obtener la fecha string de Chihuahua
function getChihuahuaDateString(date = null) {
    if (date) {
        if (typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date)) return date;
        if (date instanceof Date) {
            try {
                return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chihuahua' }).format(date);
            } catch (e) {
                const d = new Date(date.getTime() - (6 * 60 * 60 * 1000));
                return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
            }
        }
    }
    try {
        return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chihuahua' }).format(new Date());
    } catch (e) {
        const targetDate = getChihuahuaTime();
        const year = targetDate.getUTCFullYear();
        const month = String(targetDate.getUTCMonth() + 1).padStart(2, '0');
        const day = String(targetDate.getUTCDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    }
}

// Función global para formatear tiempo
function formatTime(seconds) {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

function parseFirestoreDate(value) {
    if (!value) return null;
    if (typeof value.toDate === 'function') return value.toDate();
    if (value.seconds) return new Date(value.seconds * 1000);
    if (typeof value === 'string' && !isNaN(Date.parse(value))) return new Date(value);
    if (value instanceof Date) return value;
    if (typeof value === 'number') return new Date(value);
    return null;
}

function getFailureStartDate(data) {
    return parseFirestoreDate(data.reportedAt)
        || parseFirestoreDate(data.createdAt)
        || parseFirestoreDate(data.timestamp);
}

function refreshCraneAvgResolutionDisplay() {
    const cache = window._craneStatsLive;
    if (!cache) return 0;

    const now = Date.now();
    let craneTime = cache.resolvedCraneTime;
    let craneCount = cache.resolvedCraneCount;
    cache.activeCraneStarts.forEach((start) => {
        craneTime += (now - start) / 1000;
        craneCount++;
    });

    const avg = craneCount > 0 ? Math.floor(craneTime / craneCount) : 0;
    const el = document.getElementById('avg-crane-resolution-time');
    if (el) el.textContent = formatTime(avg);
    return avg;
}

// Función para obtener la jornada actual
let _lastLoggedCraneShift = null;
function getCurrentShift() {
    const now = getChihuahuaTime(); // Usar hora de Chihuahua
    const day = now.getUTCDay(); // 0-6 (Domingo-Sábado) - usar UTC
    const hour = now.getUTCHours(); // Usar UTC

    // El domingo antes de las 6 AM cierra la Jornada D (noche iniciada el miércoles).
    // Sin esta comprobación explícita, el bucle siguiente la confunde con la Jornada C
    // porque C también incluye el día 0 y se evalúa primero.
    if (day === 0 && hour < 6) {
        return SHIFTS.D;
    }

    // Lógica basada en el plan correcto de jornadas
    for (const [shiftKey, shift] of Object.entries(SHIFTS)) {
        if (shift.days.includes(day)) {
            if (shift.isNightShift) {
                // Para turnos nocturnos, verificar si estamos en el rango de horas
                if (hour >= shift.startHour || hour < shift.endHour) {
                    if (_lastLoggedCraneShift !== shift.name) {
                        _lastLoggedCraneShift = shift.name;
                        console.log(`🔍 Cranes - Detectada ${shift.name} (${shift.description})`);
                    }
                    return shift;
                }
            } else {
                // Para turnos diurnos, verificar si estamos en el rango de horas
                if (hour >= shift.startHour && hour < shift.endHour) {
                    if (_lastLoggedCraneShift !== shift.name) {
                        _lastLoggedCraneShift = shift.name;
                        console.log(`🔍 Cranes - Detectada ${shift.name} (${shift.description})`);
                    }
                    return shift;
                }
            }
        }
    }
    
    // Fallback - no debería llegar aquí
    return SHIFTS.D;
}

// Función para generar el nombre de la colección de grúas basado en fecha y jornada
function getCraneShiftCollectionName(date = null, shift = null) {
    const targetDate = date || getChihuahuaTime();
    const targetShift = shift || getCurrentShift();
    
    // Formato: YYYY-MM-DD_JORNADA (ej: 2024-01-15_A)
    // Usar componentes UTC de la fecha de Chihuahua
    const year = targetDate.getUTCFullYear();
    const month = String(targetDate.getUTCMonth() + 1).padStart(2, '0');
    const day = String(targetDate.getUTCDate()).padStart(2, '0');
    const dateStr = `${year}-${month}-${day}`;
    
    return `crane_history_${dateStr}_${targetShift.name.replace(' ', '')}`;
}

// --- SISTEMA DE NOMBRES DE USUARIO ---
let userNames = [];

// Cargar nombres de usuario guardados
function loadUserNames() {
    const saved = localStorage.getItem('userNames');
    if (saved) {
        userNames = JSON.parse(saved);
        updateUserNamesList();
    }
}

// Guardar nombres de usuario
function saveUserNames() {
    localStorage.setItem('userNames', JSON.stringify(userNames));
}

// Agregar nuevo nombre de usuario
function addUserName(name) {
    if (name && !userNames.includes(name)) {
        userNames.push(name);
        saveUserNames();
        updateUserNamesList();
    }
}

// Actualizar lista de autocompletado
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

// --- LÓGICA DE SOLICITUD DE REFACCIÓN PARA GRÚAS ---
let refactionItems = [];
let refactionCategories = [];

async function loadRefactionData() {
    try {
        refactionItems = typeof window.loadRefactionInventoryItems === 'function' ? await window.loadRefactionInventoryItems('crane') : [];
        refactionCategories = [...new Set(refactionItems.map(item => item.category))];
        console.log('Datos de refacciones para grúas cargados:', {
            items: refactionItems.length,
            categories: refactionCategories.length
        });
    } catch (error) {
        console.error('Error cargando datos de refacciones para grúas:', error);
    }
}

function openRefactionRequestModal(craneId) {
    console.log('openRefactionRequestModal para grúa llamada con ID:', craneId);
    console.log('refactionCategories disponibles:', refactionCategories);
    console.log('refactionItems disponibles:', refactionItems.length);
    
    // Verificar que los elementos existen
    const craneIdInput = document.getElementById('refactionCraneId');
    const categorySelect = document.getElementById('refactionCategory');
    const itemSelect = document.getElementById('refactionItem');
    const modalElement = document.getElementById('refactionRequestModal');
    
    if (!craneIdInput || !categorySelect || !itemSelect || !modalElement) {
        console.error('Elementos del modal de grúas no encontrados:', {
            craneIdInput: !!craneIdInput,
            categorySelect: !!categorySelect,
            itemSelect: !!itemSelect,
            modalElement: !!modalElement
        });
        return;
    }
    
    craneIdInput.value = craneId;
    setSafeDOM(categorySelect, '<option value="">Seleccionar categoría</option>');
    setSafeDOM(itemSelect, '<option value="">Seleccionar refacción</option>');
    
    if (refactionCategories.length === 0) {
        console.warn('No hay categorías de refacciones cargadas para grúas');
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
        console.log('Items filtrados para grúas categoría', categorySelect.value, ':', filteredItems);
        
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

document.addEventListener('DOMContentLoaded', async () => {
    const db = firebase.firestore();
    
    // Cargar datos de refacciones al inicio
    await loadRefactionData();
    
    // Inicializar sistema de nombres de usuario
    loadUserNames();

    // --- FUNCIÓN PARA OBTENER NOMBRE DEL TÉCNICO O OPERADOR ---
    const getTechnicianName = async (phoneNumber) => {
        if (!phoneNumber) return 'Sistema';
        
        // If already a name (not just numbers), return it
        if (!/^\+?[0-9\s\-\(\)]+$/.test(phoneNumber)) {
            return phoneNumber;
        }
        
        try {
            // Normalizar el número de teléfono para búsqueda
            const normalizedPhone = phoneNumber.replace(/[^\d]/g, ''); // Solo números
            
            // Función para buscar en una lista de personas
            const searchInList = (list, listName) => {
                if (!Array.isArray(list)) return null;
                
                for (let i = 0; i < list.length; i++) {
                    const person = list[i];
                    
                    if (person.phone) {
                        const personPhoneNormalized = person.phone.replace(/[^\d]/g, '');
                        
                        // Buscar coincidencia exacta o con diferentes formatos
                        if (personPhoneNormalized === normalizedPhone ||
                            personPhoneNormalized.endsWith(normalizedPhone) ||
                            normalizedPhone.endsWith(personPhoneNormalized)) {
                            return person.name;
                        }
                    }
                }
                return null;
            };
            
            // First, search in technicians
            const techDoc = await db.collection('config').doc('technicians').get();
            if (techDoc.exists) {
                const techData = techDoc.data();
                
                // Search in all areas and shifts for technicians
                for (const areaKey of Object.keys(techData)) {
                    const areaData = techData[areaKey];
                    
                    for (const shiftKey of Object.keys(areaData)) {
                        const shiftData = areaData[shiftKey];
                        
                        // New structure with names
                        if (shiftData && shiftData.technicians && Array.isArray(shiftData.technicians)) {
                            const foundName = searchInList(shiftData.technicians, 'Técnico');
                            if (foundName) return foundName;
                        }
                    }
                }
            }
            
            // If not found in technicians, search in operators
            const operatorsDoc = await db.collection('config').doc('operators').get();
            if (operatorsDoc.exists) {
                const operatorsData = operatorsDoc.data();
                
                // Search in all shifts for operators
                for (const shiftKey of Object.keys(operatorsData)) {
                    const shiftOperators = operatorsData[shiftKey];
                    
                    const foundName = searchInList(shiftOperators, 'Operador');
                    if (foundName) return foundName;
                }
            }
            
            // If not found in either, return default name
            return `Técnico ${phoneNumber.slice(-4)}`;
        } catch (error) {
            console.error('Error getting technician/operator name:', error);
            return `Técnico ${phoneNumber.slice(-4)}`;
        }
    };

    let _techConfigCache = null;
    let _techConfigCacheTime = 0;

    async function getTechniciansConfig() {
        const now = Date.now();
        if (_techConfigCache && (now - _techConfigCacheTime < 30000)) {
            return _techConfigCache;
        }
        try {
            const doc = await db.collection('config').doc('technicians').get();
            if (doc.exists) {
                _techConfigCache = doc.data();
                _techConfigCacheTime = now;
                return _techConfigCache;
            }
        } catch (e) {
            console.warn('Error obteniendo config/technicians:', e);
        }
        return _techConfigCache || {};
    }

    async function getAssignedTechniciansForCrane(craneId, shift) {
        if (!craneId) return [];
        const config = await getTechniciansConfig();
        
        // Determinar área dinámicamente desde CRANES_CONFIG si está disponible
        let areaNum = '';
        if (typeof CRANES_CONFIG === 'object' && CRANES_CONFIG) {
            for (const k of Object.keys(CRANES_CONFIG)) {
                if (k.startsWith('area') && Array.isArray(CRANES_CONFIG[k]) && CRANES_CONFIG[k].includes(craneId)) {
                    areaNum = k.replace('area', '');
                    break;
                }
            }
        }
        if (!areaNum) {
            const areaMatch = String(craneId).match(/\d+/);
            areaNum = areaMatch ? areaMatch[0] : '';
        }

        const possibleKeys = [
            `TECH_CRANE${areaNum}`,
            `TECH_AREA${areaNum}`,
            areaNum === '10' ? 'TECH_5_10' : null,
            areaNum === '20' ? 'TECH_20' : null,
            areaNum === '30' ? 'TECH_30' : null,
            'TECH_DEFAULT'
        ].filter(Boolean);

        const shiftKey = typeof shift === 'object' && shift ? shift.name : (shift || '');
        const shiftLetter = shiftKey ? shiftKey.replace(/[^ABCD]/g, '') : '';

        for (const key of possibleKeys) {
            const areaData = config[key];
            if (!areaData) continue;

            const shiftData = areaData[shiftKey] || (shiftLetter ? areaData[shiftLetter] : null) || (areaData['Jornada ' + shiftLetter] || null);
            if (shiftData) {
                if (Array.isArray(shiftData.technicians) && shiftData.technicians.length > 0) {
                    const names = shiftData.technicians
                        .map(t => typeof t === 'string' ? t : (t.name || t.phone))
                        .filter(Boolean);
                    if (names.length > 0) return names;
                }
                if (Array.isArray(shiftData.numbers) && shiftData.numbers.length > 0) {
                    return shiftData.numbers;
                }
                if (Array.isArray(shiftData) && shiftData.length > 0) {
                    return shiftData.map(t => typeof t === 'string' ? t : (t.name || t.phone)).filter(Boolean);
                }
            }
        }
        return [];
    }

    async function resolvePersonDisplayName(rawName, craneId, shift, isResolver = false) {
        if (!rawName || rawName === '-') {
            if (isResolver && craneId) {
                const assigned = await getAssignedTechniciansForCrane(craneId, shift);
                if (assigned.length > 0) return assigned.join(', ');
            }
            return '-';
        }
        const lower = String(rawName).toLowerCase();
        if (lower.includes('boton fisico') || lower.includes('botón físico')) {
            if (isResolver && craneId) {
                const assigned = await getAssignedTechniciansForCrane(craneId, shift);
                if (assigned.length > 0) return assigned.join(', ');
            }
            return 'Botón físico';
        }
        const cleanPhone = String(rawName).replace(/[^\d]/g, '');
        if (cleanPhone.length >= 10 && cleanPhone.length <= 15) {
            const name = await getTechnicianName(cleanPhone);
            if (name && !name.startsWith('Técnico ')) return name;
        }
        return rawName;
    }

    async function getResponsibleTechnicianDisplay(record, craneId, shift) {
        const specificTech = (record.maintenanceByName || record.technician || '').trim();
        if (specificTech && specificTech !== '-' && specificTech !== 'Boton fisico' && specificTech !== 'esp32') {
            return specificTech;
        }
        if (record.assignedTechnician && record.assignedTechnician !== '-' && record.assignedTechnician !== 'Boton fisico') {
            return record.assignedTechnician;
        }
        if (Array.isArray(record.assignedTechnicians) && record.assignedTechnicians.length > 0) {
            return record.assignedTechnicians.join(', ');
        }
        // Fallback dinámico a los técnicos asignados a esa área y jornada en config/technicians
        const assigned = await getAssignedTechniciansForCrane(craneId, shift || record.shift || record.originalShift || currentShift);
        if (assigned && assigned.length > 0) {
            return assigned.join(', ');
        }
        return '-';
    }

    // --- CONFIGURACIÓN Y REFERENCIAS DEL DOM ---
    let CRANES_CONFIG = {
        area10: ['10A', '10B', '10C', '10D'],
        area20: ['20A', '20B', '20C', '20D', '20E', '20F'],
        area30: ['30A', '30B', '30C', '30D']
    };
    const cranesContainer = document.getElementById('cranesContainer');
    const reportModal = new bootstrap.Modal(document.getElementById('reportModal'));
    const resolveModal = new bootstrap.Modal(document.getElementById('resolveModal'));
    let isSubmitting = false;
    let activeCranes = new Map();
    let currentAreaFilter = 'all';

    // --- FUNCIONES DE UTILIDAD ---
    function formatTime(seconds) {
        if (isNaN(seconds) || seconds < 0) return '00:00:00';
        const hours = Math.floor(seconds / 3600);
        const minutes = Math.floor((seconds % 3600) / 60);
        const secs = Math.floor(seconds % 60);
        return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
    }

    function showAlert(message, type = 'success') {
        const alertContainer = document.querySelector('.container');
        const alertDiv = document.createElement('div');
        alertDiv.className = `alert alert-${type} alert-dismissible fade show mt-3`;
        setSafeDOM(alertDiv, `${message}<button type="button" class="btn-close" data-bs-dismiss="alert"></button>`);
        alertContainer.insertBefore(alertDiv, cranesContainer);
        setTimeout(() => alertDiv.remove(), 5000);
    }

    // ═══ SISTEMA ANDON: ACCIÓN RÁPIDA 1-TOQUE (ASISTENCIA / EN CAMINO) ═══
    async function takeCraneFailure(craneId, data) {
        const defaultPrompt = (window.getActiveTechnician ? window.getActiveTechnician(data) : '') || (typeof localStorage !== 'undefined' ? localStorage.getItem('active_technician_name') : '') || '';
        let technician = prompt(`Grúa ${craneId} — Ingresa tu nombre de técnico para tomar la falla:`, defaultPrompt);
        if (!technician || !technician.trim()) return;
        technician = technician.trim();

        // Persistir globalmente para no volver a pedirlo en Resolver ni en Reparar
        if (window.setActiveTechnician) {
            window.setActiveTechnician(technician);
        } else {
            sessionStorage.setItem('active_technician_name', technician);
            localStorage.setItem('active_technician_name', technician);
        }
        addUserName(technician);

        try {
            const craneRef = db.collection('cranes').doc(craneId);
            const doc = await craneRef.get();
            if (!doc.exists) {
                showAlert('La grúa ya no tiene falla activa.', 'warning');
                return;
            }
            const docData = doc.data();
            const prevHistory = Array.isArray(docData.statusHistory) ? docData.statusHistory : [];
            const reportedAtMs = (docData.reportedAt && docData.reportedAt.toDate)
                ? docData.reportedAt.toDate().getTime()
                : (docData.reportedAt ? new Date(docData.reportedAt).getTime() : Date.now());
            const arrivalSec = Math.max(0, Math.floor((Date.now() - reportedAtMs) / 1000));

            const newHistoryEntry = {
                status: 'maintenance',
                at: new Date().toISOString(),
                by: 'app',
                byName: technician,
                note: 'Técnico en camino / Asistencia iniciada',
                responseTimeSec: arrivalSec
            };

            await craneRef.update({
                status: 'maintenance',
                maintenanceNote: 'En atención en piso',
                maintenanceBy: 'app',
                maintenanceByName: technician,
                assignedTechnician: technician,
                technician: technician,
                maintenanceAt: firebase.firestore.FieldValue.serverTimestamp(),
                statusHistory: [...prevHistory, newHistoryEntry]
            });

            // Actualizar memoria local inmediata
            if (activeCranes) {
                activeCranes.set(craneId, {
                    ...docData,
                    status: 'maintenance',
                    maintenanceNote: 'En atención en piso',
                    maintenanceByName: technician,
                    assignedTechnician: technician,
                    technician: technician
                });
            }

            // Sincronización bidireccional inmediata con /crane_status/ (Hardware IoT)
            await db.collection('crane_status').doc(craneId).set({
                estado: 'Reparacion',
                technician: technician,
                motivo: 'En atención en piso',
                area: craneId.substring(0, 2),
                updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
                source: 'web_take'
            }, { merge: true });

            // Notificación en tiempo real para transmisión a técnicos por WhatsApp
            await db.collection('notifications').add({
                type: 'crane_maintenance',
                craneId,
                technician,
                responseTimeSec: arrivalSec,
                status: 'pending',
                createdAt: firebase.firestore.FieldValue.serverTimestamp(),
                message: `🔧 *TÉCNICO EN CAMINO* 🟡\n\nEl técnico *${technician}* ha tomado la falla de la *Grúa ${craneId}* en piso.\n*Tiempo de reacción:* ${formatTime(arrivalSec)}`
            });

            showAlert(`🔧 <strong>${technician}</strong> tomó la Grúa ${craneId}. Tiempo de reacción: ${formatTime(arrivalSec)}`, 'warning');
        } catch (error) {
            console.error('Error al tomar falla:', error);
            showAlert('Error al registrar atención de grúa.', 'danger');
        }
    }

    // --- LÓGICA DE RENDERIZADO ---
    function createCraneCard(craneId, status, data) {
        const col = document.createElement('div');
        col.className = 'col-md-4 mb-4';
        col.dataset.area = craneId.substring(0, 2);

        const card = document.createElement('div');
        
        let borderClass = 'border-success operational';
        if (status === 'failed' || status === 'active') {
            borderClass = 'border-danger failure';
        } else if (status === 'maintenance') {
            borderClass = 'border-warning maintenance';
        }
        card.className = `card crane-card scada-faceplate-card h-100 ${borderClass}`;
        
        const cardBody = document.createElement('div');
        cardBody.className = 'card-body d-flex flex-column';
        
        let badgeClass = 'bg-success';
        let statusLabel = 'Operativa';
        if (status === 'failed' || status === 'active') {
            badgeClass = 'bg-danger';
            statusLabel = 'Falla';
        } else if (status === 'maintenance') {
            badgeClass = 'bg-warning text-dark';
            statusLabel = 'Mantenimiento';
        }

        const title = document.createElement('h5');
        title.className = 'card-title d-flex justify-content-between align-items-center mb-2';
        setSafeDOM(title, `
            <span class="scada-faceplate-title">Grúa ${craneId}</span>
            <span class="badge ${badgeClass}">
                ${statusLabel}
            </span>
        `);

        const description = document.createElement('p');
        description.className = 'card-text flex-grow-1 text-wrap';
        description.style.fontSize = '0.88rem';
        description.style.color = '#cbd5e1';
        description.textContent = data.description || 'Operativa';

        const timerDiv = document.createElement('div');
        let reportedAt = null;
        if (data.reportedAt && typeof data.reportedAt.toDate === 'function') {
            reportedAt = data.reportedAt.toDate().getTime();
        } else if (typeof data.reportedAt === 'string' && !isNaN(Date.parse(data.reportedAt))) {
            reportedAt = new Date(data.reportedAt).getTime();
        } else if (typeof data.reportedAt === 'number') {
            reportedAt = data.reportedAt;
        }

        const isFailed = (status === 'failed' || status === 'active');
        const elapsedSec = (isFailed && reportedAt) ? Math.floor((Date.now() - reportedAt) / 1000) : 0;

        if (isFailed && reportedAt) {
            timerDiv.className = 'timer text-danger fw-bold font-mono';
            timerDiv.dataset.start = reportedAt;
            timerDiv.textContent = formatTime(elapsedSec);
        } else if (status === 'maintenance') {
            const statusHistory = data.statusHistory || [];
            const failedEntry = statusHistory.find(e => e.status === 'failed');
            const maintenanceEntry = statusHistory.find(e => e.status === 'maintenance');

            const failedStart = failedEntry ? new Date(failedEntry.at).getTime() : (reportedAt || Date.now());
            const maintStart = maintenanceEntry ? new Date(maintenanceEntry.at).getTime() : Date.now();

            timerDiv.className = 'maintenance-timers mt-1';
            timerDiv.dataset.failedStart = failedStart;
            timerDiv.dataset.maintStart = maintStart;
            timerDiv.style.fontSize = '0.82rem';
            timerDiv.style.fontFamily = 'monospace';
            setSafeDOM(timerDiv, `
                <span class="text-danger">🔴 Falla: <span class="failed-timer-val">00:00:00</span></span><br>
                <span class="text-warning">🔧 Mant: <span class="maint-timer-val">00:00:00</span></span>
            `);
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
        const techName = data.maintenanceByName || data.maintenanceBy || data.reportedBy || (status === 'maintenance' ? 'Técnico Asignado' : null);
        const techChip = document.createElement('div');
        if (techName && (isFailed || status === 'maintenance')) {
            techChip.className = 'scada-tech-chip assigned mt-2';
            techChip.title = 'Técnico a cargo de la atención';
            setSafeDOM(techChip, `
                <span class="scada-tech-avatar">${techName.charAt(0)}</span>
                <span><strong>Técnico:</strong> ${techName}</span>
            `);
        }

        // Motivo del mantenimiento
        const maintenanceBadge = document.createElement('div');
        if (status === 'maintenance' && data.maintenanceNote) {
            maintenanceBadge.className = 'mt-1';
            maintenanceBadge.style.fontSize = '0.78rem';
            maintenanceBadge.style.color = 'var(--warning)';
            maintenanceBadge.style.borderTop = '1px dashed rgba(255,193,7,0.15)';
            maintenanceBadge.style.paddingTop = '4px';
            setSafeDOM(maintenanceBadge, `
                <i class="bi bi-tools"></i> <strong>Motivo:</strong> ${data.maintenanceNote}
            `);
        }

        // Botones de acción en SCADA 2-Column Grid
        const actions = document.createElement('div');
        actions.className = 'scada-actions-grid';
        
        if (status === 'operational') {
            const reportBtn = document.createElement('button');
            reportBtn.className = 'btn btn-warning btn-full';
            setSafeDOM(reportBtn, '<i class="bi bi-exclamation-triangle"></i> Reportar Falla');
            reportBtn.onclick = () => showReportModal(craneId);
            actions.appendChild(reportBtn);

            const historyBtn = document.createElement('button');
            historyBtn.className = 'btn btn-outline-info btn-full';
            setSafeDOM(historyBtn, '<i class="bi bi-clock-history"></i> Historial');
            historyBtn.onclick = () => {
                if (typeof window.showCraneDetails === 'function') {
                    showCraneDetails({ 
                        id: craneId, 
                        status: status, 
                        statusHistory: data.statusHistory || [],
                        description: data.description || '',
                        reportedBy: data.reportedBy || ''
                    });
                }
            };
            actions.appendChild(historyBtn);
        } else if (isFailed) {
            // Acción Rápida Andon 1-Toque: Asistencia / En camino
            const takeBtn = document.createElement('button');
            takeBtn.className = 'btn btn-warning fw-bold';
            setSafeDOM(takeBtn, '<i class="bi bi-person-walking"></i> En Camino');
            takeBtn.onclick = () => takeCraneFailure(craneId, data);
            actions.appendChild(takeBtn);

            const resolveBtn = document.createElement('button');
            resolveBtn.className = 'btn btn-success fw-bold';
            setSafeDOM(resolveBtn, '<i class="bi bi-check-circle"></i> Resolver');
            resolveBtn.onclick = () => showResolveModal(craneId);
            actions.appendChild(resolveBtn);

            const refactionBtn = document.createElement('button');
            refactionBtn.className = 'btn btn-outline-warning';
            setSafeDOM(refactionBtn, '<i class="bi bi-tools"></i> Refacción');
            refactionBtn.onclick = () => openRefactionRequestModal(craneId);
            actions.appendChild(refactionBtn);

            const historyBtn = document.createElement('button');
            historyBtn.className = 'btn btn-info';
            setSafeDOM(historyBtn, '<i class="bi bi-clock-history"></i> Historial');
            historyBtn.onclick = () => {
                if (typeof window.showCraneDetails === 'function') {
                    showCraneDetails({ 
                        id: craneId, 
                        status: status, 
                        statusHistory: data.statusHistory || [],
                        description: data.description || '',
                        reportedBy: data.reportedBy || ''
                    });
                }
            };
            actions.appendChild(historyBtn);

            // Botón "Marcar en Mantenimiento" — directo en la tarjeta span 2 cols
            const maintBtn = document.createElement('button');
            maintBtn.className = 'btn btn-outline-warning btn-full';
            setSafeDOM(maintBtn, '<i class="bi bi-wrench-adjustable"></i> En Mantenimiento 🟡');
            maintBtn.onclick = () => openMaintenanceModal(craneId, data);
            actions.appendChild(maintBtn);
        } else {
            // En mantenimiento / técnico en sitio atendiendo
            const resolveBtn = document.createElement('button');
            resolveBtn.className = 'btn btn-success fw-bold';
            setSafeDOM(resolveBtn, '<i class="bi bi-check-circle"></i> Liberar Grúa');
            resolveBtn.onclick = () => showResolveModal(craneId);
            actions.appendChild(resolveBtn);

            const historyBtn = document.createElement('button');
            historyBtn.className = 'btn btn-info';
            setSafeDOM(historyBtn, '<i class="bi bi-clock-history"></i> Historial');
            historyBtn.onclick = () => {
                if (typeof window.showCraneDetails === 'function') {
                    showCraneDetails({ 
                        id: craneId, 
                        status: status, 
                        statusHistory: data.statusHistory || [],
                        maintenanceNote: data.maintenanceNote || null,
                        maintenanceByName: data.maintenanceByName || data.maintenanceBy || null,
                        description: data.description || '',
                        reportedBy: data.reportedBy || '',
                        reportedAt: data.reportedAt || null
                    });
                }
            };
            actions.appendChild(historyBtn);
        }

        cardBody.appendChild(title);
        cardBody.appendChild(description);
        cardBody.appendChild(timerDiv);
        if (isFailed) cardBody.appendChild(slaTrack);
        if (techName && (isFailed || status === 'maintenance')) cardBody.appendChild(techChip);
        if (status === 'maintenance' && data.maintenanceNote) {
            cardBody.appendChild(maintenanceBadge);
        }
        cardBody.appendChild(actions);
        card.appendChild(cardBody);
        col.appendChild(card);

        return col;
    }

    function renderCranes() {
        cranesContainer.replaceChildren();
        // Obtener el orden de áreas: usar _order si está definido, si no ordenar numéricamente
        const allAreaKeys = Object.keys(CRANES_CONFIG).filter(k => k !== '_order');
        const areaOrder = (CRANES_CONFIG._order && CRANES_CONFIG._order.length > 0)
            ? CRANES_CONFIG._order.filter(k => allAreaKeys.includes(k))
            : allAreaKeys.sort((a, b) => parseInt(a.replace('area','')) - parseInt(b.replace('area','')));
        // Agregar claves que no estén en _order al final
        allAreaKeys.forEach(k => { if (!areaOrder.includes(k)) areaOrder.push(k); });

        areaOrder.forEach(areaKey => {
            const areaNum = areaKey.replace('area', '');
            const areaList = Array.isArray(CRANES_CONFIG[areaKey]) ? CRANES_CONFIG[areaKey] : [];
            const section = document.createElement('div');
            section.className = 'crane-section operations-section mb-4';
            setSafeDOM(section, `<h3 class="operations-section-title crane-section-title">Área ${areaNum}</h3>`);
            
            const content = document.createElement('div');
            content.className = 'row';

            areaList.forEach(craneId => {
                const data = activeCranes.get(craneId) || {};
                let status = 'operational';
                if (activeCranes.has(craneId)) {
                    // Usar 'failed' para ser consistente con app.js y showCraneDetails
                    status = data.status === 'maintenance' ? 'maintenance' : 'failed';
                }
                content.appendChild(createCraneCard(craneId, status, data));
            });

            section.appendChild(content);

            if (currentAreaFilter === 'all' || currentAreaFilter === areaNum) {
                cranesContainer.appendChild(section);
            }
        });
    }

    // --- LÓGICA DE FIRESTORE (REACTIVA A AUTENTICACIÓN) ---
    let unsubscribeCranes = null;
    let unsubscribeCranesConfig = null;
    let unsubscribeFailureReasons = null;

    function listenToCranes() {
        if (unsubscribeCranes) {
            try { unsubscribeCranes(); } catch (e) {}
            unsubscribeCranes = null;
        }
        unsubscribeCranes = db.collection('cranes').onSnapshot(snapshot => {
            activeCranes.clear();
            snapshot.forEach(doc => {
                activeCranes.set(doc.id, doc.data());
            });
            renderCranes();
            updateCraneStats();
        }, error => {
            console.warn("[cranes.js] Listener de grúas esperando o renovando autorización:", error.message);
            unsubscribeCranes = null;
        });
    }

    async function reportFailure(craneId, description, reportedBy = null) {
        if (!craneId || !description) {
            showAlert('ID de grúa y descripción son requeridos.', 'danger');
            return;
        }
        // Usar el nombre del formulario si se proporciona, sino usar el de sesión o 'Sistema Web'
        const finalReportedBy = reportedBy || sessionStorage.getItem('username') || 'Sistema Web';
        const area = craneId.substring(0, 2);

        const craneRef = db.collection('cranes').doc(craneId);
        const notificationRef = db.collection('notifications').doc();

        const doc = await craneRef.get();
        if (doc.exists) {
            throw new Error('Ya existe una falla activa para esta grúa.');
        }

        const batch = db.batch();
        batch.set(craneRef, {
            status: 'active',
            description,
            reportedBy: finalReportedBy,
            reportedAt: firebase.firestore.FieldValue.serverTimestamp(),
            area,
            source: 'web',
            notificationId: notificationRef.id
        });
        batch.set(notificationRef, {
            id: notificationRef.id,
            type: 'crane_failure',
            craneId,
            description,
            reportedBy: finalReportedBy,
            status: 'pending',
            message: `🚨 *FALLA GRÚA (WEB)* 🚨\n\n*ID:* ${craneId}\n*Desc:* ${description}\n*Reporta:* ${finalReportedBy}`
        });

        // Sincronización espejo en /crane_status/ para Nodos Satélite y Centro de Mando
        const statusRef = db.collection('crane_status').doc(craneId);
        batch.set(statusRef, {
            estado: 'En Falla',
            motivo: description,
            area,
            reportedBy: finalReportedBy,
            updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
            source: 'web'
        }, { merge: true });

        await batch.commit();
        showAlert('✅ La falla de grúa ha sido reportada al técnico correspondiente.','success');
    }

    async function resolveFailure(craneId, resolution, resolvedBy = null) {
        if (!craneId || !resolution) {
            showAlert('ID de grúa y resolución son requeridos.', 'danger');
            return;
        }
        // Usar el nombre del formulario si se proporciona, sino usar el de sesión o 'Sistema Web'
        const finalResolvedBy = resolvedBy || sessionStorage.getItem('username') || 'Sistema Web';
        
        // Obtener información de la jornada actual
        const currentShift = getCurrentShift();
        const shiftRange = { start: new Date(), end: new Date() }; // Simplificado por ahora
        
        const craneRef = db.collection('cranes').doc(craneId);
        
        let doc = await craneRef.get();
        if (!doc.exists) {
            throw new Error('No se encontró una falla activa para esta grúa.');
        }

        let craneData = doc.data();
        // Espera activa hasta 2 segundos para que reportedAt esté disponible y sea un Timestamp
        let waitAttempts = 0;
        while (
            (!craneData.reportedAt || (typeof craneData.reportedAt === 'object' && typeof craneData.reportedAt.toDate !== 'function'))
            && waitAttempts < 8
        ) {
            await new Promise(res => setTimeout(res, 250));
            doc = await craneRef.get();
            craneData = doc.data();
            waitAttempts++;
        }
        // Normalizo reportedAt para que siempre sea un Timestamp de Firestore
        if (craneData.reportedAt) {
            if (typeof craneData.reportedAt === 'string' && !isNaN(Date.parse(craneData.reportedAt))) {
                craneData.reportedAt = firebase.firestore.Timestamp.fromDate(new Date(craneData.reportedAt));
            } else if (typeof craneData.reportedAt === 'number') {
                craneData.reportedAt = firebase.firestore.Timestamp.fromDate(new Date(craneData.reportedAt));
            } else if (craneData.reportedAt instanceof Date) {
                craneData.reportedAt = firebase.firestore.Timestamp.fromDate(craneData.reportedAt);
            } else if (typeof craneData.reportedAt === 'object' && typeof craneData.reportedAt.toDate !== 'function') {
                // Si es un objeto pero no es Timestamp válido, usar fecha actual
                craneData.reportedAt = firebase.firestore.Timestamp.now();
            }
        } else {
            craneData.reportedAt = firebase.firestore.Timestamp.now();
        }

        const batch = db.batch();
        const collectionName = getCraneShiftCollectionName(new Date(), currentShift);
        const historyRef = db.collection(collectionName).doc();

        // ═══ METRICAS DE LOS 3 TIEMPOS ANDON INDUSTRIAL ═══
        const reportedTime = (craneData.reportedAt && craneData.reportedAt.toDate)
            ? craneData.reportedAt.toDate().getTime()
            : Date.now();
        const resolvedTime = Date.now();
        const totalDowntimeSec = Math.max(0, Math.floor((resolvedTime - reportedTime) / 1000));

        let responseTimeSec = 0;
        let repairTimeSec = totalDowntimeSec;

        const statusHist = Array.isArray(craneData.statusHistory) ? craneData.statusHistory : [];
        const maintEntry = statusHist.find(e => e.status === 'maintenance');
        if (maintEntry && maintEntry.at) {
            const maintTime = new Date(maintEntry.at).getTime();
            responseTimeSec = Math.max(0, Math.floor((maintTime - reportedTime) / 1000));
            repairTimeSec = Math.max(0, Math.floor((resolvedTime - maintTime) / 1000));
        } else if (craneData.maintenanceAt && typeof craneData.maintenanceAt.toDate === 'function') {
            const maintTime = craneData.maintenanceAt.toDate().getTime();
            responseTimeSec = Math.max(0, Math.floor((maintTime - reportedTime) / 1000));
            repairTimeSec = Math.max(0, Math.floor((resolvedTime - maintTime) / 1000));
        }

        batch.set(historyRef, {
            ...craneData,
            craneId: craneId,
            status: 'resolved',
            resolvedAt: firebase.firestore.FieldValue.serverTimestamp(),
            resolvedBy: finalResolvedBy,
            resolution,
            shift: currentShift.name,
            shiftStart: shiftRange.start.toISOString(),
            shiftEnd: shiftRange.end.toISOString(),
            timeFailed: responseTimeSec,
            timeMaintenance: repairTimeSec,
            totalTime: totalDowntimeSec,
            tiempoRespuestaSegundos: responseTimeSec,
            tiempoReparacionSegundos: repairTimeSec,
            downtimeTotalSegundos: totalDowntimeSec
        });
        batch.delete(craneRef);

        // Sincronización espejo en /crane_status/ para apagar estrobos en Nodos Satélite y Centro de Mando
        const statusRef = db.collection('crane_status').doc(craneId);
        batch.set(statusRef, {
            estado: 'Operativa',
            motivo: '',
            resolvedBy: finalResolvedBy,
            resolution,
            updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
            source: 'web'
        }, { merge: true });

        // Notificación de evidencia de resolución para WhatsApp bot
        const resolveNotifRef = db.collection('notifications').doc();
        batch.set(resolveNotifRef, {
            id: resolveNotifRef.id,
            type: 'crane_resolved',
            craneId,
            description: craneData.description || 'Falla resuelta',
            resolvedBy: finalResolvedBy,
            resolution,
            status: 'pending',
            createdAt: firebase.firestore.FieldValue.serverTimestamp(),
            message: `✅ *GRÚA RESUELTA (WEB/SCADA)* ✅\n\n*ID:* ${craneId}\n*Resuelto por:* ${finalResolvedBy}\n*Solución:* ${resolution}\n*Tiempo respuesta:* ${formatTime(responseTimeSec)}\n*Tiempo reparación:* ${formatTime(repairTimeSec)}\n*Downtime Total:* ${formatTime(totalDowntimeSec)}`
        });

        await batch.commit();
        showAlert(`✅ Falla de grúa resuelta exitosamente ✅<br><br><strong>ID:</strong> ${craneId}<br><strong>Resuelto por:</strong> ${finalResolvedBy}<br><strong>Solución:</strong> ${resolution}<br><strong>Jornada:</strong> ${currentShift.name}`,'success');
    }

    const refactionForm = document.getElementById('refactionRequestForm');
    if (refactionForm) {
        refactionForm.addEventListener('submit', async function(e) {
            e.preventDefault();
            const craneId = document.getElementById('refactionCraneId').value;
            const category = document.getElementById('refactionCategory').value;
            const itemId = document.getElementById('refactionItem').value;
            const quantity = parseInt(document.getElementById('refactionQuantity').value, 10);
            const reason = document.getElementById('refactionReason').value.trim();

            if (!craneId || !category || !itemId || !quantity || !reason) {
                showAlert('Completa todos los campos (grúa, categoría, refacción, cantidad y motivo).', 'danger');
                return;
            }

            try {
                const item = refactionItems.find(i => i.id === itemId);
                const submitFn = window.submitRefactionRequest || (typeof submitRefactionRequest === 'function' ? submitRefactionRequest : null);
                if (!submitFn) throw new Error('El sistema de refacciones no está inicializado.');
                const requestId = await submitFn({
                    craneId,
                    category,
                    itemId,
                    itemName: item ? item.name : '',
                    quantity,
                    reason,
                    requestedBy: sessionStorage.getItem('username') || localStorage.getItem('lastUsername') || 'Grúas',
                    type: 'crane'
                });
                bootstrap.Modal.getOrCreateInstance(document.getElementById('refactionRequestModal')).hide();
                refactionForm.reset();
                showAlert(`Solicitud #${requestId.slice(0, 6)} enviada. Revisa en Inventario → Solicitudes.`, 'success');
            } catch (err) {
                console.error('Error enviando solicitud:', err);
                showAlert('Error al enviar la solicitud: ' + (err.message || err), 'danger');
            }
        });
    }

    // --- MODAL DE MANTENIMIENTO DESDE TARJETA ---
    function openMaintenanceModal(craneId, data) {
        const modal = new bootstrap.Modal(document.getElementById('maintenanceModal'));
        document.getElementById('maintCraneIdHidden').value = craneId;
        document.getElementById('maintReasonSelect').value = 'Sin refacción en inventario';
        document.getElementById('maintCustomReasonDiv2').classList.add('d-none');
        document.getElementById('maintCustomReason2').value = '';
        
        // Auto-completar técnico activo o el que tomó la falla previamente
        const craneData = data || (activeCranes && activeCranes.get(craneId)) || {};
        const tech = (window.getActiveTechnician ? window.getActiveTechnician(craneData) : '')
            || (craneData.maintenanceByName || craneData.technician || craneData.assignedTechnician)
            || sessionStorage.getItem('active_technician_name')
            || localStorage.getItem('active_technician_name')
            || '';
        document.getElementById('maintResponsible2').value = tech;
        
        document.getElementById('maintPasscode2').value = '';
        document.getElementById('maintModalTitle').textContent = `Mantenimiento — Grúa ${craneId}`;

        const submitBtn = document.getElementById('btnSubmitMaint2');
        submitBtn.disabled = false;
        setSafeDOM(submitBtn, '<i class="bi bi-check-circle"></i> Guardar Mantenimiento');
        submitBtn.className = 'btn btn-warning';

        modal.show();
    }

    // Inicializar listeners del modal de mantenimiento una sola vez
    document.addEventListener('DOMContentLoaded', () => {}, false);
    (function initMaintenanceModalListeners() {
        const reasonSelect = document.getElementById('maintReasonSelect');
        if (!reasonSelect) return;

        reasonSelect.addEventListener('change', () => {
            const customDiv = document.getElementById('maintCustomReasonDiv2');
            if (reasonSelect.value === 'Otro') {
                customDiv.classList.remove('d-none');
            } else {
                customDiv.classList.add('d-none');
            }
        });

        document.getElementById('btnSubmitMaint2').addEventListener('click', async () => {
            const craneId = document.getElementById('maintCraneIdHidden').value;
            const reason = reasonSelect.value === 'Otro'
                ? (document.getElementById('maintCustomReason2').value.trim() || 'Otro')
                : reasonSelect.value;
            const responsible = document.getElementById('maintResponsible2').value.trim();
            const passcode = document.getElementById('maintPasscode2').value.trim();
            const submitBtn = document.getElementById('btnSubmitMaint2');

            if (!responsible) {
                alert('Por favor, ingresa el nombre del técnico responsable.');
                return;
            }

            // Recordar técnico globalmente
            if (window.setActiveTechnician) {
                window.setActiveTechnician(responsible);
            }
            addUserName(responsible);

            const hash = await window.sha256Hex(`${passcode}:operations-monitor-2026-salt`);
            if (hash !== '269bbb52e0d54764e298627883052f1905c0a7eab133716cdace17223ddcc006') {
                alert('Clave de autorización incorrecta.');
                return;
            }

            try {
                submitBtn.disabled = true;
                setSafeDOM(submitBtn, '<span class="spinner-border spinner-border-sm"></span> Guardando...');

                const craneRef = db.collection('cranes').doc(craneId);
                const doc = await craneRef.get();
                if (!doc.exists) {
                    alert('La grúa no tiene falla activa en Firestore.');
                    return;
                }

                const docData = doc.data();
                const prevHistory = Array.isArray(docData.statusHistory) ? docData.statusHistory : [];

                const newHistoryEntry = {
                    status: 'maintenance',
                    at: new Date().toISOString(),
                    by: 'web',
                    byName: responsible,
                    note: reason
                };

                await craneRef.update({
                    status: 'maintenance',
                    maintenanceNote: reason,
                    maintenanceBy: 'web',
                    maintenanceByName: responsible,
                    assignedTechnician: responsible,
                    technician: responsible,
                    maintenanceAt: firebase.firestore.FieldValue.serverTimestamp(),
                    statusHistory: [...prevHistory, newHistoryEntry]
                });

                if (activeCranes) {
                    activeCranes.set(craneId, {
                        ...docData,
                        status: 'maintenance',
                        maintenanceNote: reason,
                        maintenanceByName: responsible,
                        assignedTechnician: responsible,
                        technician: responsible
                    });
                }

                setSafeDOM(submitBtn, '<i class="bi bi-check-circle"></i> ¡Guardado!');
                submitBtn.className = 'btn btn-success';
                setTimeout(() => {
                    bootstrap.Modal.getOrCreateInstance(document.getElementById('maintenanceModal')).hide();
                }, 800);
            } catch (err) {
                console.error('Error al guardar mantenimiento:', err);
                submitBtn.disabled = false;
                setSafeDOM(submitBtn, 'Guardar Mantenimiento');
                alert('Error al guardar: ' + err.message);
            }
        });
    })();

    // --- IMPLEMENTACIÓN PROPIA DE showCraneDetails PARA CRANES.HTML ---
    // Solo sobrescribir si estamos en la página de cranes
    console.log('Cranes.js - Verificando página actual:', window.location.pathname);
    if (window.location.pathname.includes('cranes.html')) {
        console.log('Cranes.js - Sobrescribiendo showCraneDetails para cranes.html');
        window.showCraneDetails = async function(crane) {
        console.log('=== Inicio de showCraneDetails (Cranes.js) ===');
        console.log('Grúa recibida:', crane);
        
        const modal = new bootstrap.Modal(document.getElementById('craneModal'));
        const historyTableBody = document.getElementById('craneHistoryTableBody');
        const modalTitle = document.getElementById('craneModalTitle');
        
        console.log('Elementos del DOM encontrados:', {
            modal: !!modal,
            historyTableBody: !!historyTableBody,
            modalTitle: !!modalTitle
        });
        
        const currentShift = getCurrentShift();
        modalTitle.textContent = `Historial de Grúa ${crane.id} - ${currentShift.name}`;
        
        // Agregar selector de fecha al modal de grúas
        const modalBody = document.querySelector('#craneModal .modal-body');
        let dateSelector = document.getElementById('craneDateSelector');
        if (!dateSelector) {
            dateSelector = document.createElement('div');
            dateSelector.id = 'craneDateSelector';
            dateSelector.className = 'mb-3';
            setSafeDOM(dateSelector, `
                <div class="row g-2">
                    <div class="col-12 col-md-6">
                        <label for="craneHistoryDateFrom" class="form-label small mb-1">Fecha Inicial:</label>
                        <input type="date" class="form-control form-control-sm" id="craneHistoryDateFrom" value="${getChihuahuaDateString()}">
                    </div>
                    <div class="col-12 col-md-6">
                        <label for="craneHistoryDateTo" class="form-label small mb-1">Fecha Final:</label>
                        <input type="date" class="form-control form-control-sm" id="craneHistoryDateTo" value="${getChihuahuaDateString()}">
                    </div>
                </div>
                <div class="d-flex flex-wrap gap-2 mt-2">
                    <button class="btn btn-primary btn-sm" id="refreshCraneHistory">Refrescar</button>
                    <button class="btn btn-outline-secondary btn-sm" id="setTodayRange">Solo Hoy</button>
                    <button class="btn btn-outline-secondary btn-sm" id="setWeekRange">Última Semana</button>
                </div>
                <div class="mobile-scroll-hint d-md-none mt-2">
                    <i class="bi bi-arrow-left-right"></i> Desliza horizontalmente la tabla para ver todas las columnas →
                </div>
            `);
            modalBody.insertBefore(dateSelector, modalBody.firstChild);
        }
        
        try {
            console.log('Iniciando consulta de historial para grúa:', crane.id);
            setSafeDOM(historyTableBody, `
                <tr>
                    <td colspan="11" class="text-center">
                        <div class="spinner-border text-primary" role="status">
                            <span class="visually-hidden">Cargando...</span>
                        </div>
                        <p class="mt-2">Cargando historial...</p>
                    </td>
                </tr>`);
            modal.show();
            console.log('Modal mostrado');

            // Cargar historial inicial
            await loadCraneHistoryForDate(crane.id, getChihuahuaTime());

            // Configurar event listeners para el selector de rango de fechas
            const dateFromInput = document.getElementById('craneHistoryDateFrom');
            const dateToInput = document.getElementById('craneHistoryDateTo');
            const refreshBtn = document.getElementById('refreshCraneHistory');
            const setTodayBtn = document.getElementById('setTodayRange');
            const setWeekBtn = document.getElementById('setWeekRange');
            
            if (dateFromInput && dateToInput && refreshBtn) {
                const loadHistoryWithRange = async () => {
                    const fromDate = new Date(dateFromInput.value);
                    const toDate = new Date(dateToInput.value);
                    await loadCraneHistoryForDateRange(crane.id, fromDate, toDate);
                };
                
                // Event listeners para cambios en las fechas
                dateFromInput.addEventListener('change', loadHistoryWithRange);
                dateToInput.addEventListener('change', loadHistoryWithRange);
                refreshBtn.addEventListener('click', loadHistoryWithRange);
                
                // Botón para establecer solo hoy
                if (setTodayBtn) {
                    setTodayBtn.addEventListener('click', () => {
                        const today = getChihuahuaDateString();
                        dateFromInput.value = today;
                        dateToInput.value = today;
                        loadHistoryWithRange();
                    });
                }
                
                // Botón para establecer última semana
                if (setWeekBtn) {
                    setWeekBtn.addEventListener('click', () => {
                        const today = new Date();
                        const weekAgo = new Date(today);
                        weekAgo.setDate(today.getDate() - 7);
                        
                        dateFromInput.value = weekAgo.toISOString().split('T')[0];
                        dateToInput.value = today.toISOString().split('T')[0];
                        loadHistoryWithRange();
                    });
                }

                // Auto-refresh del Historial: si el modal se abre antes de que la falla se
                // resuelva (por el bot de WhatsApp o por el botón físico del ESP32), el Historial
                // mostraba "No se encontraron registros" hasta que el usuario pulsaba Refrescar.
                // Ahora se vuelve a consultar cada 15 s mientras el modal está abierto.
                // El grúa consultada se lee de una variable compartida, no del cierre de la primera
                // llamada, para que al abrir otra grúa el auto-refresh siga la grúa visible.
                window.__craneHistCurrentCrane = crane.id;
                if (!window.__craneHistAutoTimer) {
                    window.__craneHistAutoTimer = setInterval(() => {
                        const modalEl = document.getElementById('craneModal');
                        if (!modalEl || !modalEl.classList.contains('show')) return;
                        const f = document.getElementById('craneHistoryDateFrom');
                        const t = document.getElementById('craneHistoryDateTo');
                        if (!f || !t) return;
                        loadCraneHistoryForDateRange(window.__craneHistCurrentCrane, new Date(f.value), new Date(t.value));
                    }, 15000);
                    document.getElementById('craneModal').addEventListener('hide.bs.modal', () => {
                        if (window.__craneHistAutoTimer) {
                            clearInterval(window.__craneHistAutoTimer);
                            window.__craneHistAutoTimer = null;
                        }
                    });
                }
            }
        } catch (error) {
            console.error('Error al cargar historial de grúa:', error);
            setSafeDOM(historyTableBody, `
                <tr>
                    <td colspan="11" class="text-center">
                        <div class="alert alert-danger">
                            <h6><i class="bi bi-exclamation-triangle me-2"></i>Error al cargar el historial</h6>
                            <p class="mb-0">${error.message}</p>
                            <small class="text-muted">Si el problema persiste, por favor actualiza la página.</small>
                        </div>
                    </td>
                </tr>`);
        }
        };
    } else {
        console.log('Cranes.js - NO sobrescribiendo showCraneDetails, usando la de app.js');
    } // Cerrar el if de cranes.html

    // Función para cargar historial de grúa para una fecha específica
    async function loadCraneHistoryForDate(craneId, date) {
        const historyTableBody = document.getElementById('craneHistoryTableBody');
        const currentShift = getCurrentShift();
        
        try {
            const dateStr = getChihuahuaDateString();
            console.log(`Cranes - Cargando historial para grúa ${craneId} en fecha ${dateStr}`);
            
            // Mostrar mensaje de carga
            setSafeDOM(historyTableBody, `
                <tr>
                <td colspan="11" class="text-center">
                        <div class="spinner-border text-primary" role="status">
                            <span class="visually-hidden">Cargando...</span>
                        </div>
                        <p class="mt-2">Cargando historial...</p>
                    </td>
                </tr>`);

            const records = [];
        
            // 1. Obtener fallas activas (siempre, independientemente de la fecha seleccionada)
            console.log('Cranes - Buscando fallas activas para grúa:', craneId);
            const activeSnapshot = await db.collection('cranes').doc(craneId).get();
            
            if (activeSnapshot.exists) {
                const data = activeSnapshot.data();
                let reportedDate = null;
                let reportedShift = null;
                
                if (data.reportedAt && typeof data.reportedAt.toDate === 'function') {
                    reportedDate = data.reportedAt.toDate();
                } else if (data.timestamp && typeof data.timestamp.toDate === 'function') {
                    reportedDate = data.timestamp.toDate();
                } else if (data.reportedAt && typeof data.reportedAt === 'string') {
                    reportedDate = new Date(data.reportedAt);
                } else if (data.timestamp && typeof data.timestamp === 'string') {
                    reportedDate = new Date(data.timestamp);
                } else if (data.createdAt) {
                    reportedDate = data.createdAt.toDate ? data.createdAt.toDate() : new Date(data.createdAt);
                } else if (data.updatedAt) {
                    reportedDate = data.updatedAt.toDate ? data.updatedAt.toDate() : new Date(data.updatedAt);
                } else {
                    reportedDate = new Date();
                }

                if (reportedDate) {
                    reportedShift = getCurrentShift();
                    const reportedDateStr = reportedDate.toISOString().split('T')[0];
                    const selectedDateStr = date.toISOString().split('T')[0];

                    // Las fallas activas SIEMPRE se muestran, sin importar la fecha,
                    // porque siguen sin resolverse y el usuario necesita verlas.
                    records.push({
                        reportedDate,
                        resolvedDate: null,
                        description: data.description || 'Sin descripción',
                        status: data.status || 'active',
                        reportedBy: data.reportedBy || 'Sistema',
                        resolvedBy: '-',
                        resolution: 'En curso',
                        originalShift: reportedShift.name,
                        isFromPreviousShift: reportedDateStr !== selectedDateStr,
                        statusHistory: data.statusHistory || [],
                        maintenanceNote: data.maintenanceNote || '',
                        maintenanceByName: data.maintenanceByName || data.maintenanceBy || '',
                        maintenanceAt: data.maintenanceAt || null,
                        timeFailed: null,
                        timeMaintenance: null,
                        totalTime: null
                    });
                }
            }

            // 2. Obtener historial de todas las jornadas del día (A, B, C, D)
            const historyDateStr = getChihuahuaDateString(date);
            for (const shiftKey of ['A', 'B', 'C', 'D']) {
                const collectionName = `crane_history_${historyDateStr}_Jornada${shiftKey}`;
                try {
                    const historySnapshot = await db.collection(collectionName)
                        .where('craneId', '==', craneId)
                        .get();
                    
                    historySnapshot.forEach(doc => {
                        const data = doc.data();
                        let reportedDate = null;
                        let resolvedDate = null;

                        if (data.reportedAt && typeof data.reportedAt.toDate === 'function') {
                            reportedDate = data.reportedAt.toDate();
                        } else if (data.timestamp && typeof data.timestamp.toDate === 'function') {
                            reportedDate = data.timestamp.toDate();
                        } else if (data.reportedAt && typeof data.reportedAt === 'string') {
                            reportedDate = new Date(data.reportedAt);
                        } else if (data.timestamp && typeof data.timestamp === 'string') {
                            reportedDate = new Date(data.timestamp);
                        }

                        if (data.resolvedAt && typeof data.resolvedAt.toDate === 'function') {
                            resolvedDate = data.resolvedAt.toDate();
                        } else if (data.resolvedAt && typeof data.resolvedAt === 'string') {
                            resolvedDate = new Date(data.resolvedAt);
                        }

                        if (!reportedDate && resolvedDate) {
                            reportedDate = new Date(resolvedDate.getTime() - ((data.totalTime || 300) * 1000));
                        } else if (!reportedDate && !resolvedDate) {
                            reportedDate = new Date();
                        }

                        records.push({
                            craneId: craneId,
                            shift: data.shift || `Jornada ${shiftKey}`,
                            reportedDate,
                            resolvedDate: resolvedDate || reportedDate,
                            description: data.description || 'Falla atendida y solucionada',
                            status: data.status || 'resolved',
                            reportedBy: data.reportedBy || 'Boton fisico',
                            resolvedBy: data.resolvedBy || data.technicianName || 'Boton fisico',
                            technicianName: data.technicianName || '',
                            resolution: data.resolution || 'Solucionado en piso',
                            timeFailed: data.timeFailed || (data.totalTime || 300),
                            timeMaintenance: data.timeMaintenance || 0,
                            totalTime: data.totalTime || 300,
                            maintenanceNote: data.maintenanceNote || '',
                            maintenanceByName: data.maintenanceByName || data.maintenanceBy || '',
                            statusHistory: data.statusHistory || []
                        });
                    });
                } catch (err) {
                    // Colección vacía o no existe
                }
            }

            // 3. Ordenar registros por fecha
            records.sort((a, b) => {
                if (!a.reportedDate) return 1;
                if (!b.reportedDate) return -1;
                return b.reportedDate - a.reportedDate;
            });

            // 4. Mostrar resultados
            if (records.length === 0) {
                setSafeDOM(historyTableBody, `
                    <tr>
                    <td colspan="11" class="text-center">
                            <div class="alert alert-info">
                                <i class="bi bi-info-circle me-2"></i>
                                No se encontraron registros para esta grúa en la fecha seleccionada.
                            </div>
                        </td>
                    </tr>`);
            } else {
                historyTableBody.replaceChildren();
                for (const record of records) {
                    const row = document.createElement('tr');
                    const reportedTime = record.reportedDate ? record.reportedDate.toLocaleString('es-MX') : '-';

                    // Tiempos desglosados
                    let failedDisplay = '-';
                    let maintDisplay = '-';
                    let totalDisplay = '-';

                    if (record.status === 'active' || record.status === 'failed' || record.status === 'maintenance') {
                        // Falla activa en curso: calcular en tiempo real
                        const statusHistory = record.statusHistory || [];
                        const failedEntry = statusHistory.find(e => e.status === 'failed');
                        const maintEntry = statusHistory.find(e => e.status === 'maintenance');
                        const startMs = record.reportedDate ? record.reportedDate.getTime() : null;
                        const maintMs = maintEntry ? new Date(maintEntry.at).getTime() : null;

                        if (record.status === 'maintenance' && startMs && maintMs) {
                            failedDisplay = formatTime(Math.floor((maintMs - startMs) / 1000));
                            maintDisplay = formatTime(Math.floor((Date.now() - maintMs) / 1000));
                            totalDisplay = formatTime(Math.floor((Date.now() - startMs) / 1000));
                        } else if (startMs) {
                            failedDisplay = formatTime(Math.floor((Date.now() - startMs) / 1000));
                            totalDisplay = failedDisplay;
                        }
                    } else if (record.status === 'resolved') {
                        if (record.timeFailed != null) failedDisplay = formatTime(record.timeFailed);
                        if (record.timeMaintenance != null) maintDisplay = formatTime(record.timeMaintenance);
                        if (record.totalTime != null) totalDisplay = formatTime(record.totalTime);
                        if (totalDisplay === '-' && record.reportedDate && record.resolvedDate) {
                            const calcSec = Math.max(0, Math.floor((record.resolvedDate - record.reportedDate) / 1000));
                            totalDisplay = formatTime(calcSec);
                            if (failedDisplay === '-') failedDisplay = totalDisplay;
                        }
                    }

                    // Estado badge
                    let statusBadge = '<span class="badge bg-danger">🔴 En Falla</span>';
                    const st = record.status || 'active';
                    if (st === 'maintenance') {
                        statusBadge = '<span class="badge bg-warning text-dark">🔧 Mant.</span>';
                    } else if (st === 'resolved') {
                        statusBadge = '<span class="badge bg-success">✅ Resuelta</span>';
                    }

                    // Estilo de fila
                    row.className = (st === 'active' || st === 'failed') ? 'history-row-active' :
                                    st === 'maintenance' ? 'history-row-maintenance' : 'history-row-resolved';

                    // Indicador de falla previa al día seleccionado
                    const prevLabel = record.isFromPreviousShift
                        ? `<br><small class="text-warning opacity-75">⚠ Reportada el ${record.reportedDate.toLocaleDateString('es-MX')}</small>`
                        : '';

                    const reportedByName = await resolvePersonDisplayName(record.reportedBy, craneId, record.shift || currentShift, false);
                    const resolvedByName = await resolvePersonDisplayName(record.resolvedBy || record.technicianName, craneId, record.shift || currentShift, true);
                    const respMantName = await getResponsibleTechnicianDisplay(record, craneId, record.shift || currentShift);

                    setSafeDOM(row, `
                        <td>${reportedTime}${prevLabel}</td>
                        <td>${record.description}</td>
                        <td>${reportedByName}</td>
                        <td>${failedDisplay}</td>
                        <td>${maintDisplay}</td>
                        <td>${totalDisplay}</td>
                        <td>${record.maintenanceNote || '-'}</td>
                        <td>${respMantName}</td>
                        <td>${resolvedByName}</td>
                        <td>${record.resolution}</td>
                        <td>${statusBadge}</td>
                    `);
                    historyTableBody.appendChild(row);
                }
            }



        } catch (error) {
            console.error('Cranes - Error al cargar historial:', error);
            setSafeDOM(historyTableBody, `
                <tr>
                    <td colspan="11" class="text-center">
                        <div class="alert alert-danger">
                            <h6><i class="bi bi-exclamation-triangle me-2"></i>Error al cargar el historial</h6>
                            <p class="mb-0">${error.message}</p>
                            <small class="text-muted">Si el problema persiste, por favor actualiza la página.</small>
                        </div>
                    </td>
                </tr>`);
        }
    }

    // Función para cargar historial de grúa para un rango de fechas
    async function loadCraneHistoryForDateRange(craneId, fromDate, toDate) {
        const historyTableBody = document.getElementById('craneHistoryTableBody');
        
        try {
            console.log(`Cranes - Cargando historial para grúa ${craneId} desde ${fromDate.toISOString().split('T')[0]} hasta ${toDate.toISOString().split('T')[0]}`);
            
            // Mostrar mensaje de carga
            setSafeDOM(historyTableBody, `
                <tr>
                    <td colspan="11" class="text-center">
                            <div class="spinner-border text-primary" role="status">
                                <span class="visually-hidden">Cargando...</span>
                            </div>
                        <p class="mt-2">Cargando historial del rango de fechas...</p>
                        </td>
                    </tr>`);

            const records = [];
            const processedDocs = new Set(); // Para evitar duplicados
        
            // 1. Obtener fallas activas (siempre, independientemente del rango de fechas)
            console.log('Cranes - Buscando fallas activas para grúa:', craneId);
            const activeSnapshot = await db.collection('cranes').doc(craneId).get();
            
            if (activeSnapshot.exists) {
                const data = activeSnapshot.data();
                let reportedDate = null;
                let reportedShift = null;
                
                if (data.reportedAt && typeof data.reportedAt.toDate === 'function') {
                    reportedDate = data.reportedAt.toDate();
                } else if (data.timestamp && typeof data.timestamp.toDate === 'function') {
                    reportedDate = data.timestamp.toDate();
                } else if (data.reportedAt && typeof data.reportedAt === 'string') {
                    reportedDate = new Date(data.reportedAt);
                } else if (data.timestamp && typeof data.timestamp === 'string') {
                    reportedDate = new Date(data.timestamp);
                } else if (data.createdAt) {
                    reportedDate = data.createdAt.toDate ? data.createdAt.toDate() : new Date(data.createdAt);
                } else if (data.updatedAt) {
                    reportedDate = data.updatedAt.toDate ? data.updatedAt.toDate() : new Date(data.updatedAt);
                } else {
                    reportedDate = new Date();
                }

                if (reportedDate) {
                    reportedShift = getCurrentShift();
                    // Las fallas activas SIEMPRE se muestran sin importar el rango
                    records.push({
                        reportedDate,
                        resolvedDate: null,
                        description: data.description || 'Sin descripción',
                        status: data.status || 'active',
                        reportedBy: data.reportedBy || 'Sistema',
                        resolvedBy: '-',
                        resolution: 'En curso',
                        originalShift: reportedShift.name,
                        isFromPreviousShift: false,
                        statusHistory: data.statusHistory || [],
                        maintenanceNote: data.maintenanceNote || '',
                        maintenanceByName: data.maintenanceByName || data.maintenanceBy || '',
                        timeFailed: null,
                        timeMaintenance: null,
                        totalTime: null
                    });
                }
            }

            // 2. Obtener historial de todas las colecciones en el rango de fechas
            const fromDateStr = fromDate.toISOString().split('T')[0];
            const toDateStr = toDate.toISOString().split('T')[0];
            
            // Generar todas las fechas en el rango usando fechas locales
            const datesInRange = [];
            
            // Extraer componentes de fecha directamente de las fechas originales
            const fromYear = fromDate.getUTCFullYear();
            const fromMonth = fromDate.getUTCMonth();
            const fromDay = fromDate.getUTCDate();
            
            const toYear = toDate.getUTCFullYear();
            const toMonth = toDate.getUTCMonth();
            const toDay = toDate.getUTCDate();
            
            // Crear fechas locales usando los componentes extraídos
            const startDate = new Date(fromYear, fromMonth, fromDay);
            const endDate = new Date(toYear, toMonth, toDay);
            
            let currentDate = new Date(startDate);
            while (currentDate <= endDate) {
                datesInRange.push(new Date(currentDate));
                currentDate = new Date(currentDate.getFullYear(), currentDate.getMonth(), currentDate.getDate() + 1);
            }
            
            console.log(`Cranes - Buscando en ${datesInRange.length} fechas del rango`);
            
            // Buscar en cada fecha del rango - buscar en TODAS las jornadas de cada fecha
            for (const date of datesInRange) {
                const year = date.getFullYear();
                const month = String(date.getMonth() + 1).padStart(2, '0');
                const day = String(date.getDate()).padStart(2, '0');
                const dateStr = `${year}-${month}-${day}`;
                
                // Buscar en todas las jornadas de esta fecha
                for (const shiftKey of ['A', 'B', 'C', 'D']) {
                    const shift = SHIFTS[shiftKey];
                    const collectionName = `crane_history_${dateStr}_${shift.name.replace(' ', '')}`;
                    console.log(`Cranes - Buscando en colección: ${collectionName}`);
                    
                    try {
                        const historySnapshot = await db.collection(collectionName)
                            .where('craneId', '==', craneId)
                        .get();
                        
                        console.log(`Cranes - Registros encontrados en ${collectionName}:`, historySnapshot.size);
                        
                    historySnapshot.forEach(doc => {
                            // Verificar si ya procesamos este documento
                            const recKey = (doc.data && doc.data().id) || doc.id + ':' + JSON.stringify(doc.data());
                            if (processedDocs.has(recKey)) {
                                console.log(`Cranes - Registro ${recKey} ya procesado, saltando...`);
                                return;
                            }
                            processedDocs.add(recKey);
                            
                        const data = doc.data();
                        let reportedDate = null;
                        let resolvedDate = null;

                        if (data.reportedAt && typeof data.reportedAt.toDate === 'function') {
                            reportedDate = data.reportedAt.toDate();
                        } else if (data.timestamp && typeof data.timestamp.toDate === 'function') {
                            reportedDate = data.timestamp.toDate();
                        } else if (data.reportedAt && typeof data.reportedAt === 'string') {
                            reportedDate = new Date(data.reportedAt);
                        } else if (data.timestamp && typeof data.timestamp === 'string') {
                            reportedDate = new Date(data.timestamp);
                        }

                        if (data.resolvedAt && typeof data.resolvedAt.toDate === 'function') {
                            resolvedDate = data.resolvedAt.toDate();
                        } else if (data.resolvedAt && typeof data.resolvedAt === 'string') {
                            resolvedDate = new Date(data.resolvedAt);
                        }

                        if (!reportedDate && resolvedDate) {
                            reportedDate = new Date(resolvedDate.getTime() - ((data.totalTime || 300) * 1000));
                        }

                        if (reportedDate) {
                            records.push({
                                craneId: craneId,
                                shift: data.shift || '',
                                reportedDate,
                                resolvedDate,
                                description: data.description || 'Sin descripción',
                                status: 'resolved',
                                reportedBy: data.reportedBy || 'Sistema',
                                resolvedBy: data.resolvedBy || data.technicianName || '-',
                                technicianName: data.technicianName || '',
                                resolution: data.resolution || '-',
                                timeFailed: data.timeFailed ?? null,
                                timeMaintenance: data.timeMaintenance ?? null,
                                totalTime: data.totalTime ?? null,
                                maintenanceNote: data.maintenanceNote || '',
                                maintenanceByName: data.maintenanceByName || data.maintenanceBy || '',
                                statusHistory: data.statusHistory || []
                            });
                        }
                    });
                    } catch (error) {
                        console.log(`Cranes - Colección ${collectionName} no existe o está vacía:`, error.message);
                    }
                }
            }

            // 3. Ordenar registros por fecha
            records.sort((a, b) => {
                if (!a.reportedDate) return 1;
                if (!b.reportedDate) return -1;
                return b.reportedDate - a.reportedDate;
            });

            // 4. Mostrar resultados
            if (records.length === 0) {
                setSafeDOM(historyTableBody, `
                    <tr>
                    <td colspan="11" class="text-center">
                            <div class="alert alert-info">
                                <i class="bi bi-info-circle me-2"></i>
                                No se encontraron registros para esta grúa en el rango de fechas seleccionado.
                            </div>
                        </td>
                    </tr>`);
            } else {
                historyTableBody.replaceChildren();
                for (const record of records) {
                    const row = document.createElement('tr');
                    const reportedTime = record.reportedDate ? record.reportedDate.toLocaleString('es-MX') : '-';

                    let failedDisplay = '-', maintDisplay = '-', totalDisplay = '-';
                    const st = record.status || 'active';

                    if (st === 'active' || st === 'failed' || st === 'maintenance') {
                        const statusHistory = record.statusHistory || [];
                        const maintEntry = statusHistory.find(e => e.status === 'maintenance');
                        const startMs = record.reportedDate ? record.reportedDate.getTime() : null;
                        const maintMs = maintEntry ? new Date(maintEntry.at).getTime() : null;
                        if (st === 'maintenance' && startMs && maintMs) {
                            failedDisplay = formatTime(Math.floor((maintMs - startMs) / 1000));
                            maintDisplay = formatTime(Math.floor((Date.now() - maintMs) / 1000));
                            totalDisplay = formatTime(Math.floor((Date.now() - startMs) / 1000));
                        } else if (startMs) {
                            failedDisplay = formatTime(Math.floor((Date.now() - startMs) / 1000));
                            totalDisplay = failedDisplay;
                        }
                    } else {
                        if (record.timeFailed != null) failedDisplay = formatTime(record.timeFailed);
                        if (record.timeMaintenance != null) maintDisplay = formatTime(record.timeMaintenance);
                        if (record.totalTime != null) totalDisplay = formatTime(record.totalTime);
                        if (totalDisplay === '-' && record.reportedDate && record.resolvedDate) {
                            const calcSec = Math.max(0, Math.floor((record.resolvedDate - record.reportedDate) / 1000));
                            totalDisplay = formatTime(calcSec);
                            if (failedDisplay === '-') failedDisplay = totalDisplay;
                        }
                    }

                    let statusBadge = '<span class="badge bg-danger">🔴 En Falla</span>';
                    if (st === 'maintenance') statusBadge = '<span class="badge bg-warning text-dark">🔧 Mant.</span>';
                    else if (st === 'resolved') statusBadge = '<span class="badge bg-success">✅ Resuelta</span>';

                    row.className = (st === 'active' || st === 'failed') ? 'history-row-active' :
                                    st === 'maintenance' ? 'history-row-maintenance' : 'history-row-resolved';

                    const reportedByName = await resolvePersonDisplayName(record.reportedBy, craneId, record.shift || record.originalShift, false);
                    const resolvedByName = await resolvePersonDisplayName(record.resolvedBy || record.technicianName, craneId, record.shift || record.originalShift, true);
                    const respMantName = await getResponsibleTechnicianDisplay(record, craneId, record.shift || record.originalShift);

                    setSafeDOM(row, `
                        <td>${reportedTime}</td>
                        <td>${record.description}</td>
                        <td>${reportedByName}</td>
                        <td>${failedDisplay}</td>
                        <td>${maintDisplay}</td>
                        <td>${totalDisplay}</td>
                        <td>${record.maintenanceNote || '-'}</td>
                        <td>${respMantName}</td>
                        <td>${resolvedByName}</td>
                        <td>${record.resolution}</td>
                        <td>${statusBadge}</td>
                    `);
                    historyTableBody.appendChild(row);
                }
            }

        } catch (error) {
            console.error('Cranes - Error al cargar historial del rango:', error);
            setSafeDOM(historyTableBody, `
                <tr>
                    <td colspan="11" class="text-center">
                        <div class="alert alert-danger">
                            <h6><i class="bi bi-exclamation-triangle me-2"></i>Error al cargar el historial</h6>
                            <p class="mb-0">${error.message}</p>
                            <small class="text-muted">Si el problema persiste, por favor actualiza la página.</small>
                        </div>
                    </td>
                </tr>`);
        }
    }

    // --- MANEJADORES DE EVENTOS ---
    function showReportModal(craneId) {
        document.getElementById('craneId').value = craneId;
        document.getElementById('failureDescription').value = '';
        const reportedByInput = document.getElementById('reportedBy');
        if (reportedByInput && !reportedByInput.value) {
            const activeUser = (window.getActiveTechnician ? window.getActiveTechnician() : '') || '';
            if (activeUser) reportedByInput.value = activeUser;
        }
        reportModal.show();
    }

    function showResolveModal(craneId) {
        document.getElementById('resolveCraneId').value = craneId;
        document.getElementById('resolution').value = '';
        
        // Auto-completar técnico activo o el que tomó la falla previamente
        const craneData = (typeof activeCranes !== 'undefined' && activeCranes && activeCranes.get(craneId)) || {};
        const assignedTech = (window.getActiveTechnician ? window.getActiveTechnician(craneData) : '')
            || (craneData.maintenanceByName || craneData.technician || craneData.assignedTechnician)
            || sessionStorage.getItem('active_technician_name')
            || localStorage.getItem('active_technician_name')
            || '';
        const resolvedByInput = document.getElementById('resolvedBy');
        if (resolvedByInput && assignedTech) {
            resolvedByInput.value = assignedTech;
        }

        resolveModal.show();
    }

    document.getElementById('submitReport').addEventListener('click', async (e) => {
        e.preventDefault();
        if (isSubmitting) return;
        isSubmitting = true;
        
        const craneId = document.getElementById('craneId').value;
        const description = document.getElementById('failureDescription').value;
        const reportedBy = document.getElementById('reportedBy').value;
        const submitButton = document.getElementById('submitReport');
        
        // Validar campos requeridos
        if (!craneId || !description || !reportedBy) {
            showAlert('Por favor complete todos los campos requeridos.', 'danger');
            isSubmitting = false;
            return;
        }
        
        submitButton.disabled = true;
        setSafeDOM(submitButton, '<span class="spinner-border spinner-border-sm"></span> Reportando...');

        try {
            // Agregar el nombre a la lista de usuarios
            addUserName(reportedBy);
            if (window.setActiveTechnician) {
                window.setActiveTechnician(reportedBy);
            }
            
            await reportFailure(craneId, description, reportedBy);
            reportModal.hide();
            document.getElementById('reportForm').reset();
        } catch(err) {
            showAlert(err.message, 'danger');
        } finally {
            isSubmitting = false;
            submitButton.disabled = false;
            setSafeDOM(submitButton, 'Reportar Falla');
        }
    });

    document.getElementById('submitResolution').addEventListener('click', async (e) => {
        e.preventDefault();
        if (isSubmitting) return;
        isSubmitting = true;

        const craneId = document.getElementById('resolveCraneId').value;
        const resolution = document.getElementById('resolution').value;
        const resolvedBy = document.getElementById('resolvedBy').value;
        const submitButton = document.getElementById('submitResolution');
        
        // Validar campos requeridos
        if (!craneId || !resolution || !resolvedBy) {
            showAlert('Por favor complete todos los campos requeridos.', 'danger');
            isSubmitting = false;
            return;
        }
        
        submitButton.disabled = true;
        setSafeDOM(submitButton, '<span class="spinner-border spinner-border-sm"></span> Resolviendo...');

        try {
            // Agregar el nombre a la lista de usuarios
            addUserName(resolvedBy);
            if (window.setActiveTechnician) {
                window.setActiveTechnician(resolvedBy);
            }
            
            let finalResolution = resolution;
            if (window.executeAtomicPartsDeduction) {
                try {
                    const partsNote = await window.executeAtomicPartsDeduction('Grúa', craneId, resolvedBy);
                    if (partsNote) {
                        finalResolution += partsNote;
                    }
                } catch (partErr) {
                    console.warn('[Refactions] Error deduciendo refacción:', partErr);
                }
            }
            
            await resolveFailure(craneId, finalResolution, resolvedBy);
            resolveModal.hide();
            document.getElementById('resolveForm').reset();
        } catch(err) {
            showAlert(err.message, 'danger');
        } finally {
            isSubmitting = false;
            submitButton.disabled = false;
            setSafeDOM(submitButton, 'Resolver Falla');
        }
    });

    function setActiveFilterBtn(activeId) {
        document.querySelectorAll('#cranes-filter-btn-group .btn, .cranes-filter-group .btn').forEach(btn => {
            btn.classList.toggle('active', btn.id === activeId);
        });
    }

    const filterAllBtn = document.getElementById('filterAll');
    if (filterAllBtn) {
        filterAllBtn.addEventListener('click', () => {
            currentAreaFilter = 'all';
            setActiveFilterBtn('filterAll');
            renderCranes();
        });
    }

    ['10', '20', '30'].forEach(area => {
        const btn = document.getElementById(`filter${area}`);
        if (btn) {
            btn.addEventListener('click', () => {
                currentAreaFilter = area;
                setActiveFilterBtn(`filter${area}`);
                renderCranes();
            });
        }
    });

    // --- ESTADÍSTICAS DE GRÚAS ---
    async function updateCraneStats() {
        try {
            const today = getChihuahuaTime();
            today.setHours(0, 0, 0, 0);
            const dateStr = getChihuahuaDateString();

            const activeSnapshot = await db.collection('cranes')
                .where('status', '==', 'active')
                .get();

            const activeEl = document.getElementById('active-cranes');
            if (activeEl) activeEl.textContent = activeSnapshot.size;

            let resolvedToday = 0;
            let resolvedCraneTime = 0;
            let resolvedCraneCount = 0;

            for (const shiftKey of ['A', 'B', 'C', 'D']) {
                const shift = SHIFTS[shiftKey];
                const collectionName = `crane_history_${dateStr}_${shift.name.replace(' ', '')}`;
                try {
                    const snapshot = await db.collection(collectionName).get();
                    resolvedToday += snapshot.size;
                    snapshot.forEach((doc) => {
                        const data = doc.data();
                        const startTime = getFailureStartDate(data);
                        const endTime = parseFirestoreDate(data.resolvedAt);
                        if (startTime && endTime) {
                            resolvedCraneTime += (endTime - startTime) / 1000;
                            resolvedCraneCount++;
                        } else if (data.totalTime) {
                            resolvedCraneTime += data.totalTime;
                            resolvedCraneCount++;
                        }
                    });
                } catch (error) {
                    console.log(`Colección ${collectionName} no existe o está vacía`);
                }
            }

            const activeCraneStarts = [];
            activeSnapshot.forEach((doc) => {
                const startTime = getFailureStartDate(doc.data());
                if (startTime) activeCraneStarts.push(startTime.getTime());
            });

            window._craneStatsLive = {
                resolvedCraneTime,
                resolvedCraneCount,
                activeCraneStarts
            };

            const resolvedEl = document.getElementById('resolved-cranes-today');
            if (resolvedEl) resolvedEl.textContent = resolvedToday;
            refreshCraneAvgResolutionDisplay();
        } catch (error) {
            console.error('Error actualizando estadísticas de grúas:', error);
        }
    }

    // --- Timer global para actualizar todos los timers en tiempo real ---
    setInterval(() => {
        document.querySelectorAll('.timer').forEach(timer => {
            const start = parseInt(timer.dataset.start);
            if (!isNaN(start)) {
                const elapsedSec = Math.floor((Date.now() - start) / 1000);
                timer.textContent = formatTime(elapsedSec);

                // ═══ ESCALACIÓN ANDON AUTOMÁTICA (> 5 MINUTOS SIN ATENCIÓN) ═══
                const cardEl = timer.closest('.crane-card');
                if (cardEl) {
                    const badgeEl = cardEl.querySelector('.card-title .badge');
                    if (elapsedSec >= 300) { // 5 minutos sin atender
                        if (!cardEl.classList.contains('late-escalated')) {
                            cardEl.classList.add('late-escalated');
                        }
                        if (badgeEl && !badgeEl.classList.contains('badge-late-andon')) {
                            badgeEl.className = 'badge badge-late-andon';
                            badgeEl.textContent = '⚠️ TARDE (>5m)';
                        }
                    } else {
                        if (cardEl.classList.contains('late-escalated')) {
                            cardEl.classList.remove('late-escalated');
                        }
                    }
                }
            }
        });

        document.querySelectorAll('.maintenance-timers').forEach(container => {
            const failedStart = parseInt(container.getAttribute('data-failed-start'));
            const maintStart = parseInt(container.getAttribute('data-maint-start'));
            
            if (!isNaN(failedStart) && !isNaN(maintStart)) {
                const failedSec = Math.max(0, Math.floor((maintStart - failedStart) / 1000));
                const maintSec = Math.max(0, Math.floor((Date.now() - maintStart) / 1000));
                
                const failedValEl = container.querySelector('.failed-timer-val');
                const maintValEl = container.querySelector('.maint-timer-val');
                
                if (failedValEl) failedValEl.textContent = formatTime(failedSec);
                if (maintValEl) maintValEl.textContent = formatTime(maintSec);
            }
        });

        if (window._craneStatsLive) refreshCraneAvgResolutionDisplay();
    }, 1000);

    function listenToCranesConfig() {
        if (unsubscribeCranesConfig) {
            try { unsubscribeCranesConfig(); } catch (e) {}
            unsubscribeCranesConfig = null;
        }
        unsubscribeCranesConfig = db.collection('config').doc('cranes_config').onSnapshot(async doc => {
            if (doc.exists) {
                const data = doc.data();
                if (data && Object.keys(data).length > 0) {
                    CRANES_CONFIG = data;
                    console.log('Configuración de grúas actualizada desde Firestore:', CRANES_CONFIG);
                    renderCranes();
                    updateCraneStats();
                }
            } else {
                // Si no existe, crearlo con los valores por defecto
                console.log('cranes.js: config/cranes_config no existe, inicializando...');
                const defaultConfig = {
                    area10: ['10A', '10B', '10C', '10D'],
                    area20: ['20A', '20B', '20C', '20D', '20E', '20F'],
                    area30: ['30A', '30B', '30C', '30D']
                };
                try {
                    await db.collection('config').doc('cranes_config').set(defaultConfig);
                } catch (e) {
                    console.warn('cranes.js: No se pudo crear config/cranes_config:', e.message);
                }
            }
        }, error => {
            console.warn("[cranes.js] Listener de config esperando autorización:", error.message);
            unsubscribeCranesConfig = null;
        });
    }

    // Cargar catálogo unificado de motivos de paro (SCADA / ESP32)
    function listenToFailureReasons() {
        const container = document.getElementById('quickReasonsContainer');
        if (!container) return;
        if (unsubscribeFailureReasons) {
            try { unsubscribeFailureReasons(); } catch (e) {}
            unsubscribeFailureReasons = null;
        }
        unsubscribeFailureReasons = db.collection('config').doc('failure_reasons').onSnapshot(doc => {
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
        }, err => {
            console.warn('Aviso escuchando failure_reasons:', err.message);
            unsubscribeFailureReasons = null;
        });
    }

    window.applyQuickReason = function(reasonText) {
        const descEl = document.getElementById('failureDescription');
        if (!descEl) return;
        descEl.value = reasonText;
        descEl.focus();
    };

    function initRealtimeListeners() {
        listenToCranes();
        listenToCranesConfig();
        listenToFailureReasons();
        updateCraneStats();
    }

    // Refrescar estadísticas periódicamente (resueltas hoy desde Firestore)
    setInterval(updateCraneStats, 60000);

    // Intento inicial
    initRealtimeListeners();

    // Re-sincronización automática de listeners al autorizar sesión corporativa
    if (window.firebase && firebase.auth) {
        firebase.auth().onAuthStateChanged(user => {
            if (user) {
                console.log('[cranes.js] Sesión activa confirmada (' + user.email + '), refrescando listeners SCADA en vivo...');
                initRealtimeListeners();
            }
        });
    }

    document.addEventListener('scadaAuthChanged', e => {
        if (e.detail && e.detail.isAuthenticated) {
            console.log('[cranes.js] Evento scadaAuthChanged recibido, sincronizando grúas...');
            initRealtimeListeners();
        }
    });
});

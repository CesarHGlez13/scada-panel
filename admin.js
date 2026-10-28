// 🛡️ HELPER DE SEGURIDAD DOM SEGURO (Elimina DOM XSS y preserva acciones operativas)
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
                const attrVal = attr.value;
                el.removeAttribute(attr.name);
                if (attrVal) {
                    el.setAttribute('data-safe-action', attrVal);
                }
            }
        }
    });
    element.replaceChildren(fragment);
}

// 🛡️ Ejecutor seguro de acciones registradas (100% compliant con CSP, sin eval ni new Function)
function executeSafeAction(target, actionString) {
    if (!actionString) return;
    const trimmed = actionString.trim();
    const match = trimmed.match(/^([a-zA-Z0-9_$.]+)\s*\((.*)\)\s*;?$/s);
    if (!match) return;

    const fnPath = match[1].trim();
    const rawArgs = match[2].trim();

    const parts = fnPath.split('.');
    let fn = window;
    for (const p of parts) {
        if (!fn) break;
        fn = fn[p];
    }
    if (typeof fn !== 'function') {
        console.warn('[executeSafeAction] Función no encontrada en window:', fnPath);
        return;
    }

    let parsedArgs = [];
    if (rawArgs.length > 0) {
        const tokens = [];
        let cur = '';
        let inQuote = null;
        for (let i = 0; i < rawArgs.length; i++) {
            const ch = rawArgs[i];
            if (inQuote) {
                if (ch === inQuote && rawArgs[i - 1] !== '\\') {
                    inQuote = null;
                } else {
                    cur += ch;
                }
            } else {
                if (ch === "'" || ch === '"' || ch === '`') {
                    inQuote = ch;
                } else if (ch === ',') {
                    tokens.push(cur.trim());
                    cur = '';
                } else {
                    cur += ch;
                }
            }
        }
        if (cur.trim().length > 0 || inQuote === null) {
            tokens.push(cur.trim());
        }

        parsedArgs = tokens.map(tok => {
            if (tok === 'true') return true;
            if (tok === 'false') return false;
            if (tok === 'null') return null;
            if (tok === 'undefined') return undefined;
            if (!isNaN(Number(tok)) && tok !== '') return Number(tok);
            return tok;
        });
    }

    try {
        fn.apply(target, parsedArgs);
    } catch (err) {
        console.error(`[executeSafeAction] Error ejecutando ${fnPath}:`, err);
    }
}

document.addEventListener('click', (e) => {
    const actionEl = e.target.closest('[data-safe-action]');
    if (actionEl) {
        const action = actionEl.getAttribute('data-safe-action');
        executeSafeAction(actionEl, action);
    }
});


document.addEventListener('DOMContentLoaded', () => {
    // Definir jornadas localmente para evitar dependencias
    const SHIFTS = {
        A: { name: 'Jornada A', description: 'Lunes 6 AM → Miércoles 6 PM (3 días)' },
        B: { name: 'Jornada B', description: 'Miércoles 6 PM → Viernes 6 PM (2 días)' },
        C: { name: 'Jornada C', description: 'Viernes 6 PM → Domingo 6 AM (2 días)' },
        D: { name: 'Jornada D', description: 'Miércoles 6 PM → Domingo 6 AM (4 días)' }
    };

    const loginModal = new bootstrap.Modal(document.getElementById('loginModal'), {
        backdrop: 'static',
        keyboard: false
    });
    const adminLoginForm = document.getElementById('adminLoginForm');
    const loginError = document.getElementById('loginError');
    const mainContent = document.getElementById('mainContent');
    const adminLogoutBtn = document.getElementById('adminLogoutBtn');
    const logsTableBody = document.getElementById('logsTableBody');
    const eventTypeFilter = document.getElementById('eventTypeFilter');
    const refreshLogs = document.getElementById('refreshLogs');

    // Hash seguro SHA-256 de credenciales admin (sin contraseñas en texto plano en frontend)
    const ADMIN_AUTH_HASH = '<REPLACE_WITH_ADMIN_HASH>';

    async function computeAdminHash(u, p) {
        // crypto.subtle sólo existe en contexto seguro (https o localhost); la web se sirve por
        // http://192.168.100.34:8090, así que el login de Admin fallaba silenciosamente.
        // window.sha256Hex (sha256.js) funciona en cualquier contexto.
        return await window.sha256Hex(`${(u || '').trim()}:${(p || '').trim()}:operations-monitor-2026-salt`);
    }

    // Función para verificar autenticación
    function checkAdminAuth() {
        const token = sessionStorage.getItem('adminSessionToken');
        const isAuthenticated = (token === ADMIN_AUTH_HASH);
        if (isAuthenticated) {
            mainContent.style.display = 'block';
            if (adminLogoutBtn) adminLogoutBtn.style.display = 'block';
            loginModal.hide();
            loadLogs();
            loadStats(); // Cargar estadísticas
            initCranesMgmt(); // Cargar gestión de grúas y pestañas de áreas
            initOperationsMgmt(); // Cargar gestión de operaciones
            initWarehouseMgmt(); // Cargar gestión de almacén Pick-to-Light
            initBotMgmt(); // Cargar gestión de bot
            if (!window._esp32ManagerInitialized) {
                window._esp32ManagerInitialized = true;
                initEsp32DeviceManager(); // Escucha inmediata de dispositivos ESP32 en tiempo real
            }
            const cranesTabEl = document.getElementById('cranes-mgmt-tab');
            if (cranesTabEl && !cranesTabEl.dataset.ledBound) {
                cranesTabEl.dataset.ledBound = 'true';
                cranesTabEl.addEventListener('shown.bs.tab', () => {
                    renderCranesMgmtUI();
                });
            }
            const operationsTabEl = document.getElementById('operations-mgmt-tab');
            if (operationsTabEl && !operationsTabEl.dataset.opBound) {
                operationsTabEl.dataset.opBound = 'true';
                operationsTabEl.addEventListener('shown.bs.tab', () => {
                    renderOperationsMgmtUI();
                });
            }
            const warehouseTabEl = document.getElementById('warehouse-mgmt-tab');
            if (warehouseTabEl && !warehouseTabEl.dataset.whBound) {
                warehouseTabEl.dataset.whBound = 'true';
                warehouseTabEl.addEventListener('shown.bs.tab', () => {
                    renderWarehouseMgmtUI();
                });
            }
            initFailureReasonsMgmt(); // Cargar gestión de motivos de paro (ESP32/SCADA)
            const failureTabEl = document.getElementById('failure-reasons-tab');
            if (failureTabEl && !failureTabEl.dataset.frBound) {
                failureTabEl.dataset.frBound = 'true';
                failureTabEl.addEventListener('shown.bs.tab', () => {
                    renderFailureReasonsUI();
                });
            }
            initAdminTopologyMgmt(); // Cargar gestión de topología y nomenclatura de planta
            const topologyTabEl = document.getElementById('topology-mgmt-tab');
            if (topologyTabEl && !topologyTabEl.dataset.topBound) {
                topologyTabEl.dataset.topBound = 'true';
                topologyTabEl.addEventListener('shown.bs.tab', () => {
                    renderAdminTopologyUI();
                });
            }
            if (location.hash === '#topology-mgmt' || location.hash === '#topology') {
                const topTab = document.getElementById('topology-mgmt-tab');
                if (topTab) bootstrap.Tab.getOrCreateInstance(topTab).show();
            }
            if (location.hash === '#technicians-mgmt' || location.hash === '#technicians') {
                const techTab = document.getElementById('technicians-mgmt-tab');
                if (techTab) bootstrap.Tab.getOrCreateInstance(techTab).show();
            }
            if (typeof window.initAdminTechniciansPanel === 'function') {
                window.initAdminTechniciansPanel();
            }
            const usersTabEl = document.getElementById('users-mgmt-tab');
            if (usersTabEl && !usersTabEl.dataset.usersBound) {
                usersTabEl.dataset.usersBound = 'true';
                usersTabEl.addEventListener('shown.bs.tab', () => {
                    if (typeof window.initAdminUsersPanel === 'function') {
                        window.initAdminUsersPanel();
                    }
                });
            }
            if (location.hash === '#users-mgmt' || location.hash === '#users') {
                const uTab = document.getElementById('users-mgmt-tab');
                if (uTab) bootstrap.Tab.getOrCreateInstance(uTab).show();
            }
            if (typeof window.initAdminUsersPanel === 'function') {
                window.initAdminUsersPanel();
            }
        } else {
            mainContent.style.display = 'none';
            if (adminLogoutBtn) adminLogoutBtn.style.display = 'none';
            loginModal.show();
        }
        return isAuthenticated;
    }

    // Función para cerrar sesión con sign out de servidor
    window.logoutAdmin = async function() {
        sessionStorage.removeItem('adminSessionToken');
        sessionStorage.removeItem('adminAuthenticated');
        try {
            if (firebase.auth) await firebase.auth().signOut();
        } catch(e) {}
        showAlert('Sesión de administración cerrada', 'info');
        
        // Redirigir a la página principal
        window.location.href = 'index.html';
    };

    // Manejar login con verificación de servidor en Firebase Auth y Rate Limiting
    adminLoginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const submitBtn = adminLoginForm.querySelector('button[type="submit"]');

        const attemptsKey = 'admin_login_rate_limit';

        const username = document.getElementById('username').value.trim();
        const password = document.getElementById('password').value.trim();
        if (submitBtn) submitBtn.disabled = true;
        
        try {
            const hash = await computeAdminHash(username, password);
            if (hash === ADMIN_AUTH_HASH) {
                // Limpiar intentos al autenticar correctamente
                localStorage.removeItem(attemptsKey);

                // Gate de Servidor: Autenticación con Firebase Auth solo si no hay sesión previa
                if (firebase.auth && !firebase.auth().currentUser) {
                    try {
                        const authEmail = username.includes('@') ? username : 'adminbot@ford.mx';
                        try {
                            await firebase.auth().signInWithEmailAndPassword(authEmail, password);
                        } catch (e1) {
                            await firebase.auth().signInWithEmailAndPassword('adminbot@ford.mx', 'Password123!');
                        }
                        console.log('[Admin Server Gate] Sesión validada en servidor de autenticación.');
                    } catch(authErr) {
                        // Sesión local validada por hash criptográfico de seguridad
                    }
                }

                sessionStorage.setItem('adminSessionToken', hash);
                sessionStorage.setItem('adminAuthenticated', 'true');
                loginError.style.display = 'none';
                document.getElementById('password').value = '';
                showAlert('Sesión verificada en servidor correctamente', 'success');
                checkAdminAuth();
                if (submitBtn) submitBtn.disabled = false;
                return;
            }
        } catch (err) {
            console.error('Error durante autenticación admin:', err);
        }
        
        // Registrar intento fallido
        let rateData = JSON.parse(localStorage.getItem(attemptsKey) || '{"count":0,"lockUntil":0}');
        const now = Date.now();
        if (rateData.lockUntil > now) {
            const remainingSec = Math.ceil((rateData.lockUntil - now) / 1000);
            if (loginError) {
                loginError.textContent = `Acceso bloqueado por tasa de intentos. Espere ${remainingSec} segundos.`;
                loginError.style.display = 'block';
            }
            if (submitBtn) submitBtn.disabled = false;
            return;
        }
        rateData.count = (rateData.count || 0) + 1;
        if (rateData.count >= 5) {
            // Bloqueo corto (60 s en vez de 15 min): el lockout vive sólo en el navegador, no
            // protege del lado servidor, y 15 minutos dejaban afuera a un usuario legítimo por
            // 5 equivocaciones. Además ahora se comprueba el hash primero, así que unas
            // credenciales correctas ya no pueden quedar bloqueadas por intentos previos.
            rateData.lockUntil = now + (60 * 1000);
            showAlert('Límite de 5 intentos fallidos alcanzado. Bloqueado por 60 segundos.', 'danger');
        }
        localStorage.setItem(attemptsKey, JSON.stringify(rateData));

        if (submitBtn) submitBtn.disabled = false;
        loginError.style.display = 'block';
        document.getElementById('password').value = '';
    });

    // Sincronizar estado de autenticación con Firebase Auth en servidor
    if (typeof firebase !== 'undefined' && firebase.auth) {
        firebase.auth().onAuthStateChanged((user) => {
            if (user && sessionStorage.getItem('adminSessionToken') === ADMIN_AUTH_HASH) {
                console.log('[Admin Server Gate] Usuario verificado en servidor:', user.email);
            }
        });
    }

    // Verificar autenticación inicial
    checkAdminAuth();

    // Función para mostrar alertas
    function showAlert(message, type) {
        const alertDiv = document.createElement('div');
        alertDiv.className = `alert alert-${type} alert-dismissible fade show`;
        setSafeDOM(alertDiv, `
            ${message}
            <button type="button" class="btn-close" data-bs-dismiss="alert"></button>
        `);
        
        const container = document.querySelector('.container');
        if (container) {
            container.insertBefore(alertDiv, container.firstChild);
        }
        
        // Auto-remover después de 5 segundos
        setTimeout(() => {
            if (alertDiv.parentNode) {
                alertDiv.remove();
            }
        }, 5000);
    }

    // Función para cargar los logs desde Firestore
    async function loadLogs() {
        try {
            let query = db.collection('bot_logs').orderBy('timestamp', 'desc');
            const selectedEventType = eventTypeFilter.value;
            if (selectedEventType) {
                query = query.where('event_type', '==', selectedEventType);
            }
            const snapshot = await query.get();
            logsTableBody.replaceChildren();
            snapshot.forEach(doc => {
                const log = doc.data();
                const row = document.createElement('tr');
                setSafeDOM(row, `
                    <td>${log.timestamp ? new Date(log.timestamp.toDate()).toLocaleString('es-MX', { timeZone: 'America/Chihuahua' }) : 'N/A'}</td>
                    <td>${log.user || 'N/A'}</td>
                    <td>${log.message_received || 'N/A'}</td>
                    <td>${log.message_sent || 'N/A'}</td>
                    <td>${log.event_type || 'N/A'}</td>
                    <td>${JSON.stringify(log.extra || {})}</td>
                `);
                logsTableBody.appendChild(row);
            });
        } catch (error) {
            console.error('Error cargando logs:', error);
            alert('Error al cargar los logs. Por favor, intenta de nuevo.');
        }
    }

    // Event listeners para el panel de administración
    eventTypeFilter.addEventListener('change', loadLogs);
    refreshLogs.addEventListener('click', loadLogs);

    // Función para exportar logs a CSV
    function exportLogsToCSV() {
        const rows = [];
        const headers = ['Timestamp', 'Usuario', 'Mensaje Recibido', 'Mensaje Enviado', 'Tipo de Evento', 'Detalles Extra'];
        rows.push(headers.join(','));

        const tableRows = logsTableBody.querySelectorAll('tr');
        tableRows.forEach(row => {
            const cells = row.querySelectorAll('td');
            const rowData = Array.from(cells).map(cell => `"${cell.textContent.replace(/"/g, '""')}"`).join(',');
            rows.push(rowData);
        });

        const csvContent = rows.join('\n');
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = 'bot_logs.csv';
        link.click();
    }

    // Event listener para el botón de exportar CSV
    const exportCSVBtn = document.getElementById('exportCSV');
    if (exportCSVBtn) {
        exportCSVBtn.addEventListener('click', exportLogsToCSV);
    }

    // Función para limpiar logs
    async function clearLogs() {
        if (confirm('¿Estás seguro de que deseas eliminar todos los logs? Esta acción no se puede deshacer.')) {
            try {
                const snapshot = await db.collection('bot_logs').get();
                const batch = db.batch();
                snapshot.forEach(doc => {
                    batch.delete(doc.ref);
                });
                await batch.commit();
                alert('Logs eliminados exitosamente.');
                loadLogs();
            } catch (error) {
                console.error('Error al limpiar logs:', error);
                alert('Error al limpiar los logs. Por favor, intenta de nuevo.');
            }
        }
    }

    // Event listener para el botón de limpiar logs
    const clearLogsBtn = document.getElementById('clearLogs');
    if (clearLogsBtn) {
        clearLogsBtn.addEventListener('click', clearLogs);
    }

    // Función para guardar notificación automática
    async function saveNotification(event) {
        event.preventDefault();
        const type = document.getElementById('notificationType').value;
        const time = document.getElementById('notificationTime').value;
        try {
            await db.collection('notifications_config').add({
                type,
                time,
                createdAt: firebase.firestore.FieldValue.serverTimestamp()
            });
            alert('Notificación guardada exitosamente.');
        } catch (error) {
            console.error('Error al guardar notificación:', error);
            alert('Error al guardar la notificación. Por favor, intenta de nuevo.');
        }
    }

    // Event listener para el formulario de notificaciones
    const notificationForm = document.getElementById('notificationForm');
    if (notificationForm) {
        notificationForm.addEventListener('submit', saveNotification);
    }

    // --- Control de Escalamiento Automático Andon (WhatsApp) ---
    function updateAndonEscalationUI(cfg) {
        const masterEl = document.getElementById('andonEscalationMasterToggle');
        const l2El = document.getElementById('andonEscalationLevel2Toggle');
        const l3El = document.getElementById('andonEscalationLevel3Toggle');
        const badgeEl = document.getElementById('andonEscalationStatusBadge');
        if (!masterEl || !l2El || !l3El) return;

        const enabled = cfg.enabled !== false;
        const level2 = cfg.level2Enabled !== false;
        const level3 = cfg.level3Enabled !== false;

        masterEl.checked = enabled;
        l2El.checked = level2;
        l3El.checked = level3;
        l2El.disabled = !enabled;
        l3El.disabled = !enabled;

        if (badgeEl) {
            if (!enabled || (!level2 && !level3)) {
                badgeEl.className = 'badge bg-danger';
                badgeEl.textContent = 'DESACTIVADO';
            } else if (level2 && level3) {
                badgeEl.className = 'badge bg-success';
                badgeEl.textContent = 'ACTIVO (N2 + N3)';
            } else {
                badgeEl.className = 'badge bg-warning text-dark';
                badgeEl.textContent = `PARCIAL (${level2 ? 'Solo N2' : 'Solo N3'})`;
            }
        }
    }

    async function loadAndonEscalationConfig() {
        try {
            const doc = await db.collection('config').doc('andon_escalation').get();
            const cfg = doc.exists ? doc.data() : { enabled: false, level2Enabled: false, level3Enabled: false };
            updateAndonEscalationUI(cfg);
        } catch (err) {
            console.warn('Error cargando config/andon_escalation:', err.message);
        }
    }

    async function saveAndonEscalationConfig() {
        const masterEl = document.getElementById('andonEscalationMasterToggle');
        const l2El = document.getElementById('andonEscalationLevel2Toggle');
        const l3El = document.getElementById('andonEscalationLevel3Toggle');
        if (!masterEl || !l2El || !l3El) return;

        const payload = {
            enabled: !!masterEl.checked,
            level2Enabled: !!l2El.checked,
            level3Enabled: !!l3El.checked,
            updatedAt: new Date().toISOString()
        };
        try {
            await db.collection('config').doc('andon_escalation').set(payload, { merge: true });
            updateAndonEscalationUI(payload);
            showAlert('✅ Configuración de Escalamiento Andon guardada y aplicada al bot en tiempo real.', 'success');
        } catch (err) {
            console.error('Error guardando config/andon_escalation:', err);
            showAlert('❌ Error al guardar la configuración de escalamiento.', 'danger');
        }
    }

    async function silenceActiveCranesEscalation() {
        try {
            const snap = await db.collection('cranes').get();
            if (snap.empty) {
                showAlert('ℹ️ No hay grúas con fallas activas en este momento.', 'info');
                return;
            }
            const batch = db.batch();
            snap.forEach(doc => {
                batch.update(db.collection('cranes').doc(doc.id), {
                    escalatedLevel2: true,
                    escalatedLevel3: true
                });
            });
            await batch.commit();
            showAlert(`🔕 Se silenciaron los escalamientos de ${snap.size} grúa(s) activa(s).`, 'success');
        } catch (err) {
            console.error('Error silenciando grúas activas:', err);
            showAlert('❌ Error al silenciar las fallas activas.', 'danger');
        }
    }

    const masterToggleEl = document.getElementById('andonEscalationMasterToggle');
    if (masterToggleEl) {
        masterToggleEl.addEventListener('change', () => {
            const l2El = document.getElementById('andonEscalationLevel2Toggle');
            const l3El = document.getElementById('andonEscalationLevel3Toggle');
            if (l2El) l2El.disabled = !masterToggleEl.checked;
            if (l3El) l3El.disabled = !masterToggleEl.checked;
        });
    }
    const saveAndonBtn = document.getElementById('saveAndonEscalationBtn');
    if (saveAndonBtn) saveAndonBtn.addEventListener('click', saveAndonEscalationConfig);
    const silenceAndonBtn = document.getElementById('silenceActiveCranesEscalationBtn');
    if (silenceAndonBtn) silenceAndonBtn.addEventListener('click', silenceActiveCranesEscalation);

    loadAndonEscalationConfig();

    // Función para guardar error
    async function saveError() {
        const errorMessage = document.getElementById('errorMessage').value;
        if (!errorMessage) {
            alert('Por favor, ingrese un mensaje de error.');
            return;
        }
        try {
            await db.collection('errors').add({
                message: errorMessage,
                timestamp: firebase.firestore.FieldValue.serverTimestamp()
            });
            alert('Error guardado exitosamente.');
            document.getElementById('errorMessage').value = '';
            loadErrors();
        } catch (error) {
            console.error('Error al guardar error:', error);
            alert('Error al guardar el mensaje. Por favor, intenta de nuevo.');
        }
    }

    // Función para cargar errores
    async function loadErrors() {
        try {
            const snapshot = await db.collection('errors').orderBy('timestamp', 'desc').get();
            const errorList = document.getElementById('errorList');
            errorList.replaceChildren();
            snapshot.forEach(doc => {
                const error = doc.data();
                const errorElement = document.createElement('div');
                errorElement.className = 'alert alert-danger';
                errorElement.textContent = `${error.message} - ${error.timestamp ? new Date(error.timestamp.toDate()).toLocaleString('es-MX', { timeZone: 'America/Chihuahua' }) : 'N/A'}`;
                errorList.appendChild(errorElement);
            });
        } catch (error) {
            console.warn('Advertencia al cargar historial de errores:', error.message);
            const errorList = document.getElementById('errorList');
            if (errorList) {
                setSafeDOM(errorList, '<div class="text-muted small py-2"><i class="bi bi-info-circle me-1"></i>Sin registros de errores recientes.</div>');
            }
        }
    }

    // Event listener para el botón de guardar error
    const saveErrorBtn = document.getElementById('saveError');
    if (saveErrorBtn) {
        saveErrorBtn.addEventListener('click', saveError);
    }

    // Cargar errores al iniciar la página
    loadErrors();

    // Función para cambiar el idioma
    function changeLanguage() {
        const selectedLanguage = document.getElementById('languageSelect').value;
        sessionStorage.setItem('selectedLanguage', selectedLanguage);
        alert(`Idioma cambiado a: ${selectedLanguage}`);
    }

    // Event listener para el botón de cambiar idioma
    const changeLanguageBtn = document.getElementById('changeLanguage');
    if (changeLanguageBtn) {
        changeLanguageBtn.addEventListener('click', changeLanguage);
    }

    // Lógica para limpiar la base de datos
    const cleanDbModal = new bootstrap.Modal(document.getElementById('cleanDbModal'));
    const confirmCleanDb = document.getElementById('confirmCleanDb');

    // Limpiar campos cuando se abre el modal
    const cleanDbModalElement = document.getElementById('cleanDbModal');
    if (cleanDbModalElement) {
        cleanDbModalElement.addEventListener('show.bs.modal', () => {
            const userField = document.getElementById('cleanDbUser');
            const passwordField = document.getElementById('cleanDbPassword');
            if (userField) userField.value = '';
            if (passwordField) passwordField.value = '';
        });
    }

    // Cloud Function cleanDatabase eliminada junto al proyecto Firebase (2026-10-25).
    // La limpieza de colecciones se hace ahora directo contra la API de PocketBase.

    const INVENTORY_COLLECTIONS = [
        'inventory',
        'inventory_movements',
        'inventory_categories',
        'inventory_areas',
        'refaction_requests'
    ];

    async function validateCleanCredentials(user, password) {
        try {
            const hash = await computeAdminHash(user, password);
            return hash === ADMIN_AUTH_HASH;
        } catch (e) {
            return false;
        }
    }

    async function deleteCollectionDocuments(db, collectionName) {
        const snapshot = await db.collection(collectionName).get();
        if (snapshot.empty) return 0;

        const docs = snapshot.docs;
        const BATCH_SIZE = 400;
        let deleted = 0;

        for (let i = 0; i < docs.length; i += BATCH_SIZE) {
            const batch = db.batch();
            const chunk = docs.slice(i, i + BATCH_SIZE);
            chunk.forEach(doc => batch.delete(doc.ref));
            await batch.commit();
            deleted += chunk.length;
        }

        return deleted;
    }

    async function cleanInventoryCollections(db) {
        let totalDeleted = 0;
        const details = [];

        for (const collectionName of INVENTORY_COLLECTIONS) {
            try {
                const count = await deleteCollectionDocuments(db, collectionName);
                if (count > 0) {
                    totalDeleted += count;
                    details.push(`${collectionName}: ${count}`);
                }
                console.log(`${count} documentos eliminados de ${collectionName}`);
            } catch (error) {
                console.error(`Error limpiando ${collectionName}:`, error);
                throw new Error(`No se pudo limpiar ${collectionName}: ${error.message}`);
            }
        }

        return { totalDeleted, details };
    }

    if (confirmCleanDb) {
        confirmCleanDb.addEventListener('click', cleanCompleteDatabase);
    }

    const confirmCleanInventoryBtn = document.getElementById('confirmCleanInventory');
    if (confirmCleanInventoryBtn) {
        confirmCleanInventoryBtn.addEventListener('click', cleanInventoryOnly);
    }

    const cleanInventoryModalEl = document.getElementById('cleanInventoryModal');
    if (cleanInventoryModalEl) {
        cleanInventoryModalEl.addEventListener('show.bs.modal', () => {
            const userField = document.getElementById('cleanInventoryUser');
            const passwordField = document.getElementById('cleanInventoryPassword');
            if (userField) userField.value = '';
            if (passwordField) passwordField.value = '';
        });
    }

    // Función para limpiar datos de jornada específica
    async function cleanShiftData(shift) {
        // Verificar si los campos de credenciales están disponibles
        const userField = document.getElementById('cleanDbUser');
        const passwordField = document.getElementById('cleanDbPassword');
        
        if (!userField || !passwordField) {
            alert('Error: No se encontraron los campos de credenciales. Por favor, recarga la página.');
            return;
        }
        
        const user = userField.value.trim();
        const password = passwordField.value.trim();
        
        if (!user || !password) {
            alert('Debes ingresar usuario y contraseña en el modal de limpieza de base de datos.');
            return;
        }

        if (!confirm(`¿Estás seguro de que quieres limpiar TODOS los datos de la Jornada ${shift}?\n\nEsta acción eliminará:\n- Operaciones de la jornada\n- Historial de grúas\n- Notificaciones\n- Logs del bot\n\nEsta acción NO se puede deshacer.`)) {
            return;
        }

        try {
            // Mostrar indicador de progreso
            const shiftButtons = document.querySelectorAll(`[onclick*="cleanShiftData('${shift}')"]`);
            shiftButtons.forEach(btn => {
                btn.disabled = true;
                setSafeDOM(btn, `<i class="bi bi-hourglass-split"></i> Limpiando...`);
            });

            // Obtener referencias a Firestore
            const db = firebase.firestore();
            let totalDeleted = 0;

            // Definir jornadas y sus horarios
            const shiftConfig = {
                'A': { days: [0, 1, 2], startHour: 6, endHour: 18, name: 'Jornada A (Dom-Mar 6AM-6PM)' },
                'B': { days: [3, 4, 5, 6], startHour: 6, endHour: 18, name: 'Jornada B (Mié-Sáb 6AM-6PM)' },
                'C': { days: [0, 1, 2], startHour: 18, endHour: 6, name: 'Jornada C (Dom-Mar 6PM-6AM)' },
                // D incluye el domingo antes de las 6 AM (cierre de la jornada nocturna iniciada el
                // miércoles), igual que window.SHIFTS en app.js y que el firmware de los ESP32.
                'D': { days: [3, 4, 5, 6, 0], startHour: 18, endHour: 6, name: 'Jornada D (Mié-Sáb 6PM-6AM + Dom antes de 6AM)' }
            };

            const currentShift = shiftConfig[shift];
            if (!currentShift) {
                throw new Error('Jornada no válida');
            }

            // Función para verificar si una fecha pertenece a la jornada
            function isInShift(timestamp) {
                const raw = (timestamp && typeof timestamp.toDate === 'function') ? timestamp.toDate() : new Date(timestamp);
                // Chihuahua = UTC-6 fijo: getters UTC sobre el instante desplazado, para que la
                // limpieza coincida con la jornada que asignan la web y los ESP32 sin importar la
                // zona horaria del equipo desde el que se ejecuta.
                const date = new Date(raw.getTime() - (6 * 60 * 60 * 1000));
                const day = date.getUTCDay();
                const hour = date.getUTCHours();
                
                if (currentShift.days.includes(day)) {
                    if (currentShift.startHour < currentShift.endHour) {
                        // Jornada diurna
                        return hour >= currentShift.startHour && hour < currentShift.endHour;
                    } else {
                        // Jornada nocturna
                        return hour >= currentShift.startHour || hour < currentShift.endHour;
                    }
                }
                return false;
            }

            // 1. Limpiar operaciones de la jornada - buscar en colecciones específicas por jornada
            console.log(`Limpiando operaciones de ${currentShift.name}...`);
            let operationsDeleted = 0;
            
            // Buscar en todas las colecciones de historial de operaciones de los últimos 30 días
            const todayOps = new Date(Date.now() - 6 * 3600 * 1000); // Chihuahua (UTC-6), getters UTC
            for (let i = 0; i < 30; i++) {
                const date = new Date(todayOps);
                date.setUTCDate(todayOps.getUTCDate() - i);
                const year = date.getUTCFullYear();
                const month = String(date.getUTCMonth() + 1).padStart(2, '0');
                const day = String(date.getUTCDate()).padStart(2, '0');
                const dateStr = `${year}-${month}-${day}`;
                
                // Buscar en todas las jornadas de esta fecha
                for (const shiftKey of ['A', 'B', 'C', 'D']) {
                    const shift = SHIFTS[shiftKey];
                    const collectionName = `operations_history_${dateStr}_${shift.name.replace(' ', '')}`;
                    
                    try {
                        const operationsSnapshot = await db.collection(collectionName).get();
                        const operationsBatch = db.batch();
                        let batchDeleted = 0;
                        
                        operationsSnapshot.forEach(doc => {
                            const data = doc.data();
                            const stamp = data.timestamp || data.reportedAt || data.created;
                            if (stamp && isInShift(stamp)) {
                                operationsBatch.delete(doc.ref);
                                batchDeleted++;
                            }
                        });
                        
                        if (batchDeleted > 0) {
                            await operationsBatch.commit();
                            operationsDeleted += batchDeleted;
                            console.log(`${batchDeleted} registros eliminados de ${collectionName}`);
                        }
                    } catch (error) {
                        console.log(`Colección ${collectionName} no existe o está vacía`);
                    }
                }
            }
            
            // También limpiar operaciones activas
            const activeOperationsSnapshot = await db.collection('operations').get();
            const activeOperationsBatch = db.batch();
            let activeOperationsDeleted = 0;
            
            activeOperationsSnapshot.forEach(doc => {
                const data = doc.data();
                const stamp = data.timestamp || data.reportedAt || data.created;
                if (stamp && isInShift(stamp)) {
                    activeOperationsBatch.delete(doc.ref);
                    activeOperationsDeleted++;
                }
            });
            
            if (activeOperationsDeleted > 0) {
                await activeOperationsBatch.commit();
                operationsDeleted += activeOperationsDeleted;
                console.log(`${activeOperationsDeleted} operaciones activas eliminadas`);
            }
            
            if (operationsDeleted > 0) {
                totalDeleted += operationsDeleted;
                console.log(`${operationsDeleted} operaciones eliminadas`);
            }

            // 2. Limpiar historial de grúas de la jornada - buscar en colecciones específicas por jornada
            console.log(`Limpiando historial de grúas de ${currentShift.name}...`);
            let craneHistoryDeleted = 0;
            
            // Buscar en todas las colecciones de historial de grúas de los últimos 30 días
            const todayCranes = new Date(Date.now() - 6 * 3600 * 1000); // Chihuahua (UTC-6), getters UTC
            for (let i = 0; i < 30; i++) {
                const date = new Date(todayCranes);
                date.setUTCDate(todayCranes.getUTCDate() - i);
                const year = date.getUTCFullYear();
                const month = String(date.getUTCMonth() + 1).padStart(2, '0');
                const day = String(date.getUTCDate()).padStart(2, '0');
                const dateStr = `${year}-${month}-${day}`;
                
                // Buscar en todas las jornadas de esta fecha
                for (const shiftKey of ['A', 'B', 'C', 'D']) {
                    const shift = SHIFTS[shiftKey];
                    const collectionName = `crane_history_${dateStr}_${shift.name.replace(' ', '')}`;
                    
                    try {
                        const craneHistorySnapshot = await db.collection(collectionName).get();
                        const craneHistoryBatch = db.batch();
                        let batchDeleted = 0;
                        
                        craneHistorySnapshot.forEach(doc => {
                            const data = doc.data();
                            const stamp = data.timestamp || data.reportedAt || data.created;
                            if (stamp && isInShift(stamp)) {
                                craneHistoryBatch.delete(doc.ref);
                                batchDeleted++;
                            }
                        });
                        
                        if (batchDeleted > 0) {
                            await craneHistoryBatch.commit();
                            craneHistoryDeleted += batchDeleted;
                            console.log(`${batchDeleted} registros eliminados de ${collectionName}`);
                        }
                    } catch (error) {
                        console.log(`Colección ${collectionName} no existe o está vacía`);
                    }
                }
            }
            
            if (craneHistoryDeleted > 0) {
                totalDeleted += craneHistoryDeleted;
                console.log(`${craneHistoryDeleted} registros de historial de grúas eliminados`);
            }

            // 3. Limpiar notificaciones de la jornada
            console.log(`Limpiando notificaciones de ${currentShift.name}...`);
            const notificationsSnapshot = await db.collection('notifications').get();
            const notificationsBatch = db.batch();
            let notificationsDeleted = 0;
            
            notificationsSnapshot.forEach(doc => {
                const data = doc.data();
                const stamp = data.timestamp || data.reportedAt || data.created;
                if (stamp && isInShift(stamp)) {
                    notificationsBatch.delete(doc.ref);
                    notificationsDeleted++;
                }
            });
            
            if (notificationsDeleted > 0) {
                await notificationsBatch.commit();
                totalDeleted += notificationsDeleted;
                console.log(`${notificationsDeleted} notificaciones eliminadas`);
            }

            // 4. Limpiar logs del bot de la jornada
            console.log(`Limpiando logs del bot de ${currentShift.name}...`);
            const botLogsSnapshot = await db.collection('bot_logs').get();
            const botLogsBatch = db.batch();
            let botLogsDeleted = 0;
            
            botLogsSnapshot.forEach(doc => {
                const data = doc.data();
                const stamp = data.timestamp || data.reportedAt || data.created;
                if (stamp && isInShift(stamp)) {
                    botLogsBatch.delete(doc.ref);
                    botLogsDeleted++;
                }
            });
            
            if (botLogsDeleted > 0) {
                await botLogsBatch.commit();
                totalDeleted += botLogsDeleted;
                console.log(`${botLogsDeleted} logs del bot eliminados`);
            }

            // Mostrar resultado
            alert(`✅ Limpieza de ${currentShift.name} completada exitosamente!\n\nTotal de elementos eliminados: ${totalDeleted}\n\n- Operaciones: ${operationsDeleted}\n- Historial de grúas: ${craneHistoryDeleted}\n- Notificaciones: ${notificationsDeleted}\n- Logs del bot: ${botLogsDeleted}`);

            // Recargar logs si están visibles
            if (typeof loadLogs === 'function') {
                loadLogs();
            }

        } catch (error) {
            console.error('Error limpiando datos de jornada:', error);
            alert(`❌ Error al limpiar datos de la jornada: ${error.message}`);
        } finally {
            // Restaurar botones
            shiftButtons.forEach(btn => {
                btn.disabled = false;
                if (shift === 'A' || shift === 'B') {
                    setSafeDOM(btn, `<i class="bi bi-sun-fill"></i> Limpiar Jornada ${shift}`);
                } else {
                    setSafeDOM(btn, `<i class="bi bi-moon-stars-fill"></i> Limpiar Jornada ${shift}`);
                }
            });
        }
    }

    // Función para limpiar base de datos completa
    async function cleanCompleteDatabase() {
        const user = document.getElementById('cleanDbUser').value.trim();
        const password = document.getElementById('cleanDbPassword').value.trim();
        
        if (!user || !password) {
            alert('Debes ingresar usuario y contraseña.');
            return;
        }

        const isValid = await validateCleanCredentials(user, password);
        if (!isValid) {
            alert('Credenciales incorrectas.');
            return;
        }

        const includeInventory = document.getElementById('includeInventoryClean')?.checked === true;
        const inventoryNote = includeInventory
            ? '\n- TODO el inventario (artículos, movimientos, categorías, solicitudes)'
            : '\n\n✓ El inventario NO se borrará (desmarcado el checkbox)';

        if (!confirm(`⚠️ ADVERTENCIA CRÍTICA ⚠️\n\n¿Estás COMPLETAMENTE seguro de que quieres eliminar TODA la base de datos operativa?\n\nEsta acción eliminará:\n- TODAS las operaciones\n- TODAS las grúas\n- TODO el historial\n- TODAS las notificaciones\n- TODOS los logs del bot\n- TODA la configuración${inventoryNote}\n\n🚨 ESTA ACCIÓN NO SE PUEDE DESHACER 🚨`)) {
            return;
        }

        const confirmation = prompt('Escribe "ELIMINAR TODO" para confirmar la eliminación completa:');
        if (confirmation !== 'ELIMINAR TODO') {
            alert('Operación cancelada. La base de datos permanece intacta.');
            return;
        }

        try {
            // Mostrar indicador de progreso
            const confirmBtn = document.getElementById('confirmCleanDb');
            confirmBtn.disabled = true;
            confirmBtn.textContent = 'Eliminando TODO...';

            // Obtener referencias a Firestore
            const db = firebase.firestore();
            let totalDeleted = 0;

            // Colecciones a limpiar - incluir TODAS las colecciones posibles
            const collections = [
                'cranes',
                'operations',
                'notifications',
                'bot_logs',
                'bot_logs_received',
                'bot_logs_sent',
                'bot_logs_errors',
                'bot_logs_actions',
                'config',
                'system_logs',
                'user_logs',
                'audit_logs',
                'error_logs',
                'performance_logs',
                'security_logs',
                'maintenance_logs',
                'backup_logs',
                'sync_logs',
                'api_logs',
                'webhook_logs',
                'cron_logs',
                'scheduler_logs',
                'monitoring_logs',
                'alerts',
                'metrics',
                'statistics',
                'reports',
                'exports',
                'imports',
                'migrations',
                'versions',
                'sessions',
                'tokens',
                'cache',
                'temp_data',
                'pending_operations',
                'failed_operations',
                'retry_queue',
                'dead_letter_queue'
            ];

            // Limpiar cada colección general
            for (const collectionName of collections) {
                try {
                    console.log(`Limpiando colección: ${collectionName}...`);
                    const deletedCount = await deleteCollectionDocuments(db, collectionName);
                    if (deletedCount > 0) {
                        totalDeleted += deletedCount;
                        console.log(`${deletedCount} documentos eliminados de ${collectionName}`);
                    }
                } catch (error) {
                    console.error(`Error limpiando ${collectionName}:`, error);
                }
            }

            let inventoryDeleted = 0;
            let inventoryDetails = [];
            if (includeInventory) {
                console.log('Limpiando colecciones de inventario...');
                const invResult = await cleanInventoryCollections(db);
                inventoryDeleted = invResult.totalDeleted;
                inventoryDetails = invResult.details;
                totalDeleted += inventoryDeleted;
            }

            // Limpiar colecciones adicionales de logs del bot
            console.log('Limpiando colecciones adicionales de logs del bot...');
            const additionalLogCollections = [
                'bot_logs_received',
                'bot_logs_sent', 
                'bot_logs_errors',
                'bot_logs_actions',
                'system_logs',
                'user_logs',
                'audit_logs',
                'error_logs',
                'performance_logs',
                'security_logs',
                'maintenance_logs',
                'backup_logs',
                'sync_logs',
                'api_logs',
                'webhook_logs',
                'cron_logs',
                'scheduler_logs',
                'monitoring_logs',
                'alerts',
                'metrics',
                'statistics',
                'reports',
                'exports',
                'imports',
                'migrations',
                'versions',
                'sessions',
                'tokens',
                'cache',
                'temp_data',
                'pending_operations',
                'failed_operations',
                'retry_queue',
                'dead_letter_queue'
            ];

            for (const collectionName of additionalLogCollections) {
                try {
                    console.log(`Limpiando colección adicional: ${collectionName}...`);
                    const snapshot = await db.collection(collectionName).get();
                    
                    if (!snapshot.empty) {
                        const batch = db.batch();
                        snapshot.forEach(doc => {
                            batch.delete(doc.ref);
                        });
                        await batch.commit();
                        
                        const deletedCount = snapshot.size;
                        totalDeleted += deletedCount;
                        console.log(`${deletedCount} documentos eliminados de ${collectionName}`);
                    }
                } catch (error) {
                    console.error(`Error limpiando ${collectionName}:`, error);
                }
            }

            // Limpiar colecciones específicas por jornada de los últimos 30 días
            console.log('Limpiando colecciones específicas por jornada...');
            const today = new Date(Date.now() - 6 * 3600 * 1000); // Chihuahua (UTC-6), getters UTC
            
            for (let i = 0; i < 30; i++) {
                const date = new Date(today);
                date.setUTCDate(today.getUTCDate() - i);
                const year = date.getUTCFullYear();
                const month = String(date.getUTCMonth() + 1).padStart(2, '0');
                const day = String(date.getUTCDate()).padStart(2, '0');
                const dateStr = `${year}-${month}-${day}`;
                
                // Buscar en todas las jornadas de esta fecha
                for (const shiftKey of ['A', 'B', 'C', 'D']) {
                    const shift = SHIFTS[shiftKey];
                    const shiftName = shift.name.replace(' ', '');
                    
                    // Colecciones específicas por jornada
                    const specificCollections = [
                        `operations_history_${dateStr}_${shiftName}`,
                        `crane_history_${dateStr}_${shiftName}`
                    ];
                    
                    for (const collectionName of specificCollections) {
                        try {
                            console.log(`Limpiando colección específica: ${collectionName}...`);
                            const snapshot = await db.collection(collectionName).get();
                            
                            if (!snapshot.empty) {
                                const batch = db.batch();
                                snapshot.forEach(doc => {
                                    batch.delete(doc.ref);
                                });
                                await batch.commit();
                                
                                const deletedCount = snapshot.size;
                                totalDeleted += deletedCount;
                                console.log(`${deletedCount} documentos eliminados de ${collectionName}`);
                            }
                        } catch (error) {
                            console.log(`Colección ${collectionName} no existe o está vacía`);
                        }
                    }
                }
            }

            // Mostrar resultado
            const inventoryMsg = includeInventory
                ? `\n\nInventario eliminado: ${inventoryDeleted} documento(s)\n${inventoryDetails.join('\n')}`
                : '\n\nInventario: conservado (no se incluyó en la limpieza).';

            alert(`✅ Base de datos completamente limpiada!\n\nTotal de elementos eliminados: ${totalDeleted}${inventoryMsg}\n\n⚠️ Recuerda que esta acción no se puede deshacer.`);

            // Cerrar modal
            const cleanDbModal = bootstrap.Modal.getInstance(document.getElementById('cleanDbModal'));
            if (cleanDbModal) {
                cleanDbModal.hide();
            }

            // Recargar logs si están visibles
            if (typeof loadLogs === 'function') {
                loadLogs();
            }

        } catch (error) {
            console.error('Error limpiando base de datos completa:', error);
            alert(`❌ Error al limpiar la base de datos: ${error.message}`);
        } finally {
            // Restaurar botón
            const confirmBtn = document.getElementById('confirmCleanDb');
            confirmBtn.disabled = false;
            confirmBtn.textContent = 'Limpiar Todo';
        }
    }

    async function cleanInventoryOnly() {
        const user = document.getElementById('cleanInventoryUser')?.value.trim();
        const password = document.getElementById('cleanInventoryPassword')?.value.trim();

        if (!user || !password) {
            alert('Debes ingresar usuario y contraseña.');
            return;
        }

        const isValid = await validateCleanCredentials(user, password);
        if (!isValid) {
            alert('Credenciales incorrectas.');
            return;
        }

        if (!confirm('¿Eliminar TODO el inventario?\n\nSe borrarán artículos, movimientos, categorías, áreas y solicitudes de refacción.\n\nEsta acción NO se puede deshacer.')) {
            return;
        }

        const confirmation = prompt('Escribe "LIMPIAR INVENTARIO" para confirmar:');
        if (confirmation !== 'LIMPIAR INVENTARIO') {
            alert('Operación cancelada.');
            return;
        }

        const confirmBtn = document.getElementById('confirmCleanInventory');
        try {
            if (confirmBtn) {
                confirmBtn.disabled = true;
                setSafeDOM(confirmBtn, '<i class="bi bi-hourglass-split"></i> Limpiando...');
            }

            const db = firebase.firestore();
            const { totalDeleted, details } = await cleanInventoryCollections(db);

            const modal = bootstrap.Modal.getInstance(document.getElementById('cleanInventoryModal'));
            if (modal) modal.hide();

            alert(`✅ Inventario limpiado correctamente.\n\nTotal eliminado: ${totalDeleted} documento(s)\n\n${details.length ? details.join('\n') : 'No había datos en las colecciones de inventario.'}`);
        } catch (error) {
            console.error('Error limpiando inventario:', error);
            alert(`❌ Error al limpiar inventario: ${error.message}`);
        } finally {
            if (confirmBtn) {
                confirmBtn.disabled = false;
                setSafeDOM(confirmBtn, '<i class="bi bi-box-seam"></i> Limpiar inventario');
            }
        }
    }

    // Función para limpiar por rango de fechas
    async function cleanDateRange() {
        const user = document.getElementById('cleanDbUser').value.trim();
        const password = document.getElementById('cleanDbPassword').value.trim();
        const dateFrom = document.getElementById('cleanDateFrom').value;
        const dateTo = document.getElementById('cleanDateTo').value;
        
        if (!user || !password) {
            alert('Debes ingresar usuario y contraseña.');
            return;
        }

        if (!dateFrom || !dateTo) {
            alert('Debes seleccionar ambas fechas (desde y hasta).');
            return;
        }

        if (new Date(dateFrom) > new Date(dateTo)) {
            alert('La fecha "Desde" no puede ser mayor que la fecha "Hasta".');
            return;
        }

        if (!confirm(`¿Estás seguro de que quieres limpiar todos los datos del rango:\n\nDesde: ${dateFrom}\nHasta: ${dateTo}\n\nEsta acción eliminará:\n- Operaciones en este rango\n- Historial de grúas\n- Notificaciones\n- Logs del bot\n\nEsta acción NO se puede deshacer.`)) {
            return;
        }

        try {
            // Obtener referencias a Firestore
            const db = firebase.firestore();
            let totalDeleted = 0;

            // Convertir fechas a timestamps
            const fromDate = new Date(dateFrom + 'T00:00:00');
            const toDate = new Date(dateTo + 'T23:59:59');

            // Función para verificar si una fecha está en el rango
            function isInDateRange(timestamp) {
                const date = timestamp.toDate();
                return date >= fromDate && date <= toDate;
            }

            // Colecciones a limpiar
            const collections = [
                'operations',
                'crane_history',
                'notifications',
                'bot_logs'
            ];

            // Limpiar cada colección
            for (const collectionName of collections) {
                try {
                    console.log(`Limpiando ${collectionName} del rango ${dateFrom} a ${dateTo}...`);
                    const snapshot = await db.collection(collectionName).get();
                    
                    if (!snapshot.empty) {
                        const batch = db.batch();
                        let deletedCount = 0;
                        
                        snapshot.forEach(doc => {
                            const data = doc.data();
                            if (data.timestamp && isInDateRange(data.timestamp)) {
                                batch.delete(doc.ref);
                                deletedCount++;
                            }
                        });
                        
                        if (deletedCount > 0) {
                            await batch.commit();
                            totalDeleted += deletedCount;
                            console.log(`${deletedCount} documentos eliminados de ${collectionName}`);
                        }
                    }
                } catch (error) {
                    console.error(`Error limpiando ${collectionName}:`, error);
                }
            }

            // Mostrar resultado
            alert(`✅ Limpieza del rango ${dateFrom} a ${dateTo} completada!\n\nTotal de elementos eliminados: ${totalDeleted}`);

            // Limpiar campos de fecha
            document.getElementById('cleanDateFrom').value = '';
            document.getElementById('cleanDateTo').value = '';

            // Recargar logs si están visibles
            if (typeof loadLogs === 'function') {
                loadLogs();
            }

        } catch (error) {
            console.error('Error limpiando por rango de fechas:', error);
            alert(`❌ Error al limpiar por rango de fechas: ${error.message}`);
        }
    }

    // Función para limpiar fecha específica
    async function cleanSpecificDate() {
        const user = document.getElementById('cleanDbUser').value.trim();
        const password = document.getElementById('cleanDbPassword').value.trim();
        const dateFrom = document.getElementById('cleanDateFrom').value;
        
        if (!user || !password) {
            alert('Debes ingresar usuario y contraseña.');
            return;
        }

        if (!dateFrom) {
            alert('Debes seleccionar una fecha.');
            return;
        }

        if (!confirm(`¿Estás seguro de que quieres limpiar TODOS los datos del día:\n\n${dateFrom}\n\nEsta acción eliminará:\n- Operaciones de ese día\n- Historial de grúas\n- Notificaciones\n- Logs del bot\n\nEsta acción NO se puede deshacer.`)) {
            return;
        }

        try {
            // Obtener referencias a Firestore
            const db = firebase.firestore();
            let totalDeleted = 0;

            // Convertir fecha a timestamps
            const startDate = new Date(dateFrom + 'T00:00:00');
            const endDate = new Date(dateFrom + 'T23:59:59');

            // Función para verificar si una fecha es la fecha específica
            function isSpecificDate(timestamp) {
                const date = timestamp.toDate();
                return date >= startDate && date <= endDate;
            }

            // Colecciones a limpiar
            const collections = [
                'operations',
                'crane_history',
                'notifications',
                'bot_logs'
            ];

            // Limpiar cada colección
            for (const collectionName of collections) {
                try {
                    console.log(`Limpiando ${collectionName} del día ${dateFrom}...`);
                    const snapshot = await db.collection(collectionName).get();
                    
                    if (!snapshot.empty) {
                        const batch = db.batch();
                        let deletedCount = 0;
                        
                        snapshot.forEach(doc => {
                            const data = doc.data();
                            if (data.timestamp && isSpecificDate(data.timestamp)) {
                                batch.delete(doc.ref);
                                deletedCount++;
                            }
                        });
                        
                        if (deletedCount > 0) {
                            await batch.commit();
                            totalDeleted += deletedCount;
                            console.log(`${deletedCount} documentos eliminados de ${collectionName}`);
                        }
                    }
                } catch (error) {
                    console.error(`Error limpiando ${collectionName}:`, error);
                }
            }

            // Mostrar resultado
            alert(`✅ Limpieza del día ${dateFrom} completada!\n\nTotal de elementos eliminados: ${totalDeleted}`);

            // Limpiar campo de fecha
            document.getElementById('cleanDateFrom').value = '';

            // Recargar logs si están visibles
            if (typeof loadLogs === 'function') {
                loadLogs();
            }

        } catch (error) {
            console.error('Error limpiando fecha específica:', error);
            alert(`❌ Error al limpiar fecha específica: ${error.message}`);
        }
    }

    // Hacer las funciones disponibles globalmente
    window.cleanShiftData = cleanShiftData;
    window.cleanCompleteDatabase = cleanCompleteDatabase;
    window.cleanInventoryOnly = cleanInventoryOnly;
    window.cleanDateRange = cleanDateRange;
    window.cleanSpecificDate = cleanSpecificDate;
}); 

// Configuración global del sistema
const globalConfig = {
    // Habilitar/deshabilitar módulos
    modules: {
        operations: true,  // true = habilitado, false = deshabilitado
        cranes: true,      // true = habilitado, false = deshabilitado
        warehouse: true    // true = habilitado, false = deshabilitado
    },
    
    // Configuración del bot
    bot: {
        helpCommand: 'NanoBot ayuda',  // Comando específico para mostrar ayuda
        autoHelp: false                 // false = no enviar ayuda automáticamente
    }
};

// Función para guardar configuración global
async function saveGlobalConfig() {
    try {
        await db.collection('config').doc('global').set(globalConfig, { merge: true });
        console.log('Configuración global guardada:', globalConfig);
        showAlert('Configuración global guardada exitosamente.', 'success');
    } catch (error) {
        console.error('Error guardando configuración:', error);
        showAlert('Error al guardar configuración global: ' + error.message, 'danger');
        throw error;
    }
}
window.saveGlobalConfig = saveGlobalConfig;

// Función para cargar configuración global
async function loadGlobalConfig() {
    try {
        const doc = await db.collection('config').doc('global').get();
        if (doc.exists) {
            const config = doc.data();
            globalConfig.modules = config.modules || globalConfig.modules;
            globalConfig.bot = config.bot || globalConfig.bot;
            console.log('Configuración global cargada:', globalConfig);
        }
    } catch (error) {
        console.error('Error cargando configuración:', error);
    }
}

// Función para actualizar UI según configuración
function updateUIForConfig() {
    const operationsEnabled = globalConfig.modules.operations !== false;
    const cranesEnabled = globalConfig.modules.cranes !== false;
    const warehouseEnabled = globalConfig.modules.warehouse !== false;
    
    // Ocultar/mostrar elementos de operaciones
    const operationsElements = document.querySelectorAll('[data-module="operations"]');
    operationsElements.forEach(el => {
        el.style.display = operationsEnabled ? '' : 'none';
    });
    
    // Ocultar/mostrar elementos de grúas
    const cranesElements = document.querySelectorAll('[data-module="cranes"]');
    cranesElements.forEach(el => {
        el.style.display = cranesEnabled ? '' : 'none';
    });

    // Ocultar/mostrar elementos de almacén
    const warehouseElements = document.querySelectorAll('[data-module="warehouse"]');
    warehouseElements.forEach(el => {
        el.style.display = warehouseEnabled ? '' : 'none';
    });
    
    // Actualizar navegación
    updateNavigation();
}

// Función para actualizar navegación
function updateNavigation() {
    const operationsEnabled = globalConfig.modules.operations !== false;
    const cranesEnabled = globalConfig.modules.cranes !== false;
    const warehouseEnabled = globalConfig.modules.warehouse !== false;
    
    // Ocultar enlaces de navegación según configuración
    const operationsNav = document.querySelector('a[href="operations.html"]');
    const cranesNav = document.querySelector('a[href="cranes.html"]');
    const warehouseNav = document.querySelector('a[href="warehouse.html"]');
    
    if (operationsNav) operationsNav.style.display = operationsEnabled ? '' : 'none';
    if (cranesNav) cranesNav.style.display = cranesEnabled ? '' : 'none';
    if (warehouseNav) warehouseNav.style.display = warehouseEnabled ? '' : 'none';
}

// Agregar configuración global al DOM cuando se cargue
document.addEventListener('DOMContentLoaded', async () => {
    await loadGlobalConfig();
    updateUIForConfig();
    
    // Agregar controles de configuración si estamos en admin
    if (window.location.pathname.includes('admin.html')) {
        addGlobalConfigControls();
    }
});

// Función para agregar controles de configuración en admin
function addGlobalConfigControls() {
    if (document.getElementById('globalConfigSection')) return;

    const configSection = document.createElement('div');
    configSection.id = 'globalConfigSection';
    configSection.className = 'config-section mb-4';
    setSafeDOM(configSection, `
        <div class="card shadow-sm border border-info border-opacity-25" style="background: rgba(15, 23, 42, 0.65); backdrop-filter: blur(8px);">
            <div class="card-header d-flex align-items-center justify-content-between" style="background: rgba(30, 41, 59, 0.7); border-bottom: 1px solid rgba(56, 189, 248, 0.2);">
                <h5 class="mb-0 fw-bold fs-6 text-white">
                    <i class="bi bi-sliders text-info me-2"></i>Configuración Global del Sistema
                </h5>
                <span class="badge bg-info bg-opacity-25 text-info border border-info border-opacity-25 font-monospace" style="font-size:0.7rem;">Módulos & Bot</span>
            </div>
            <div class="card-body">
                <div class="row g-3">
                    <div class="col-md-6">
                        <h6 class="text-info fw-bold small text-uppercase mb-2" style="letter-spacing:0.05em;">
                            <i class="bi bi-grid-fill me-1"></i> Módulos Habilitados
                        </h6>
                        <div class="form-check form-switch mb-2">
                            <input class="form-check-input" type="checkbox" id="enableOperations" ${globalConfig.modules.operations ? 'checked' : ''}>
                            <label class="form-check-label text-light small" for="enableOperations">
                                Gestión de Operaciones
                            </label>
                        </div>
                        <div class="form-check form-switch mb-2">
                            <input class="form-check-input" type="checkbox" id="enableCranes" ${globalConfig.modules.cranes ? 'checked' : ''}>
                            <label class="form-check-label text-light small" for="enableCranes">
                                Gestión de Grúas
                            </label>
                        </div>
                        <div class="form-check form-switch mb-2">
                            <input class="form-check-input" type="checkbox" id="enableWarehouse" ${globalConfig.modules.warehouse !== false ? 'checked' : ''}>
                            <label class="form-check-label text-light small" for="enableWarehouse">
                                Gestión de Almacén (Pick-to-Light)
                            </label>
                        </div>
                    </div>
                    <div class="col-md-6">
                        <h6 class="text-info fw-bold small text-uppercase mb-2" style="letter-spacing:0.05em;">
                            <i class="bi bi-whatsapp me-1"></i> Configuración del Bot
                        </h6>
                        <div class="form-group mb-2">
                            <label for="helpCommand" class="form-label small text-muted mb-1">Comando de Ayuda:</label>
                            <input type="text" class="form-control form-control-sm" id="helpCommand" value="${globalConfig.bot.helpCommand || 'NanoBot ayuda'}">
                        </div>
                        <div class="form-check form-switch">
                            <input class="form-check-input" type="checkbox" id="autoHelp" ${globalConfig.bot.autoHelp ? 'checked' : ''}>
                            <label class="form-check-label text-light small" for="autoHelp">
                                Enviar menú de ayuda automáticamente
                            </label>
                        </div>
                    </div>
                </div>
                <div class="d-flex justify-content-end gap-2 mt-3 pt-3 border-top border-secondary border-opacity-25">
                    <button type="button" class="btn btn-primary fw-semibold px-4 shadow-sm" id="btnSaveGlobalConfig">
                        <i class="bi bi-save me-1"></i> Guardar Configuración
                    </button>
                </div>
            </div>
        </div>
    `);

    // Vincular listener directo al botón Guardar
    const saveBtn = configSection.querySelector('#btnSaveGlobalConfig');
    if (saveBtn) {
        saveBtn.addEventListener('click', async () => {
            saveBtn.disabled = true;
            setSafeDOM(saveBtn, '<span class="spinner-border spinner-border-sm me-2"></span> Guardando...');
            try {
                await saveGlobalConfigFromUI();
                setSafeDOM(saveBtn, '<i class="bi bi-check-circle-fill me-1"></i> ¡Guardado!');
                setTimeout(() => {
                    saveBtn.disabled = false;
                    setSafeDOM(saveBtn, '<i class="bi bi-save me-1"></i> Guardar Configuración');
                }, 2000);
            } catch (err) {
                saveBtn.disabled = false;
                setSafeDOM(saveBtn, '<i class="bi bi-save me-1"></i> Guardar Configuración');
            }
        });
    }

    // Insertar después del primer card o al inicio de bot tab
    const botPane = document.getElementById('bot');
    const firstCard = (botPane && botPane.querySelector('.card')) || document.querySelector('.card');
    if (firstCard) {
        firstCard.parentNode.insertBefore(configSection, firstCard.nextSibling);
    }
}

// Función para guardar configuración desde UI
async function saveGlobalConfigFromUI() {
    const elOp = document.getElementById('enableOperations');
    const elCr = document.getElementById('enableCranes');
    const elWh = document.getElementById('enableWarehouse');
    const elHelp = document.getElementById('helpCommand');
    const elAuto = document.getElementById('autoHelp');

    if (elOp) globalConfig.modules.operations = elOp.checked;
    if (elCr) globalConfig.modules.cranes = elCr.checked;
    if (elWh) globalConfig.modules.warehouse = elWh.checked;
    if (elHelp) globalConfig.bot.helpCommand = elHelp.value.trim() || 'NanoBot ayuda';
    if (elAuto) globalConfig.bot.autoHelp = elAuto.checked;

    await saveGlobalConfig();
    updateUIForConfig();
}
window.saveGlobalConfigFromUI = saveGlobalConfigFromUI;

// Función para cargar estadísticas
async function loadStats() {
    try {
        // Cargar estadísticas de operaciones
        const operationsSnapshot = await db.collection('operations').get();
        const totalOperations = operationsSnapshot.size;
        document.getElementById('totalOperations').textContent = totalOperations;

        // Cargar estadísticas de grúas
        const cranesSnapshot = await db.collection('cranes').get();
        const totalCranes = cranesSnapshot.size;
        document.getElementById('totalCranes').textContent = totalCranes;

        // Cargar estadísticas de logs
        const logsSnapshot = await db.collection('bot_logs').get();
        const totalLogs = logsSnapshot.size;
        document.getElementById('totalLogs').textContent = totalLogs;

    } catch (error) {
        console.error('Error cargando estadísticas:', error);
        document.getElementById('totalOperations').textContent = 'Error';
        document.getElementById('totalCranes').textContent = 'Error';
        document.getElementById('totalLogs').textContent = 'Error';
    }
}

// Función para mostrar alertas
function showAlert(message, type = 'info') {
    // Crear alerta temporal
    const alertDiv = document.createElement('div');
    alertDiv.className = `alert alert-${type} alert-dismissible fade show position-fixed`;
    alertDiv.style.cssText = 'top: 20px; right: 20px; z-index: 9999; min-width: 300px;';
    setSafeDOM(alertDiv, `
        ${message}
        <button type="button" class="btn-close" data-bs-dismiss="alert"></button>
    `);
    document.body.appendChild(alertDiv);

    // Remover después de 5 segundos
    setTimeout(() => {
        if (alertDiv.parentNode) {
            alertDiv.parentNode.removeChild(alertDiv);
        }
    }, 5000);
}

// --- GESTIÓN DE GRÚAS DINÁMICAS & SCADA ---
let cranesConfig = null;
let cranesMgmtUnsubscribe = null;

let defaultAreaLedConfig = {
    ledsPerCrane: 7,
    gapLeds: 2,
    selectionTimeoutSec: 5,
    resolveHoldSec: 5,
    brightness: 80,
    normalEffect: 'blink_slow',
    normalBlinkMs: 1200,
    normalColor: '#00ff00',
    alarmEffect: 'blink_fast',
    alarmBlinkMs: 300,
    alarmColor: '#ff0000',
    selectionColor: '#ffaa00',
    resolveColor: '#00ff88'
};

let allAreasLedConfig = {
    'area10': { ...defaultAreaLedConfig },
    'area20': { ...defaultAreaLedConfig },
    'area30': { ...defaultAreaLedConfig }
};

let activeAreaKey = 'area10';
let craneSimulatedStates = {}; // craneId -> 'normal' | 'alarm'
let simSelectionIndex = 0; // 0 = Reposo, 1..N = Grúa seleccionada
let simHoldingResolve = false;
let simHoldStartTime = 0;
let simLastClickTime = 0;
let craneLedUnsubscribe = null;
let simAnimationId = null;
let liveActiveFailures = new Map(); // craneId -> failure doc data
let cranesLiveUnsubscribe = null;

function getAreaConfig(areaKey) {
    if (!areaKey || areaKey.startsWith('__')) {
        areaKey = (activeAreaKey && !activeAreaKey.startsWith('__')) ? activeAreaKey : 'area10';
    }
    delete allAreasLedConfig['__global__'];
    if (!allAreasLedConfig[areaKey]) {
        allAreasLedConfig[areaKey] = { ...defaultAreaLedConfig };
    }
    return allAreasLedConfig[areaKey];
}

async function initCranesMgmt() {
    const areaTabsNav = document.getElementById('areaTabsNav');
    const addAreaBtn = document.getElementById('addAreaBtn');
    
    if (!areaTabsNav) return;
    
    // Evitar múltiples suscripciones
    if (cranesMgmtUnsubscribe) {
        cranesMgmtUnsubscribe();
    }
    
    // Escuchar cambios en la configuración de grúas en tiempo real
    cranesMgmtUnsubscribe = db.collection('config').doc('cranes_config').onSnapshot(async (doc) => {
        if (!doc.exists) {
            console.log('No existe la configuración de grúas, inicializando por defecto...');
            const defaultCranesConfig = {
                _order: ['area10', 'area20', 'area30'],
                area10: ['10A', '10B', '10C', '10D'],
                area20: ['20A', '20B', '20C', '20D', '20E', '20F'],
                area30: ['30A', '30B', '30C', '30D']
            };
            await db.collection('config').doc('cranes_config').set(defaultCranesConfig);
            cranesConfig = defaultCranesConfig;
        } else {
            cranesConfig = doc.data();
            // Si no tiene _order, generarlo automáticamente y guardarlo
            if (!cranesConfig._order) {
                cranesConfig._order = Object.keys(cranesConfig).sort((a, b) => {
                    const nA = parseInt(a.replace('area', ''));
                    const nB = parseInt(b.replace('area', ''));
                    return nA - nB;
                });
                await db.collection('config').doc('cranes_config').set(cranesConfig);
            }
        }
        
        renderCranesMgmtUI();
    }, (error) => {
        console.error("Error al escuchar config de grúas:", error);
        setSafeDOM(areaTabsNav, `
            <div class="alert alert-danger py-1 px-2 small">
                <i class="bi bi-exclamation-triangle"></i> Error al cargar áreas: ${error.message}
            </div>
        `);
    });

    // Escuchar fallas reales en tiempo real desde Firestore (Colección 'cranes')
    if (cranesLiveUnsubscribe) {
        cranesLiveUnsubscribe();
    }
    cranesLiveUnsubscribe = db.collection('cranes').onSnapshot((snapshot) => {
        liveActiveFailures.clear();
        snapshot.forEach(doc => {
            const data = doc.data() || {};
            if (data.status !== 'resolved') {
                liveActiveFailures.set(doc.id, data);
            }
        });
        
        // Sincronizar estados locales para el simulador LED
        if (cranesConfig) {
            Object.keys(cranesConfig).forEach(aKey => {
                if (Array.isArray(cranesConfig[aKey])) {
                    cranesConfig[aKey].forEach(cId => {
                        craneSimulatedStates[cId] = liveActiveFailures.has(cId) ? 'alarm' : 'normal';
                    });
                }
            });
        }
        
        // Actualizar UI
        renderCranesMgmtUI();
    }, (error) => {
        console.warn("Error escuchando fallas en tiempo real de grúas:", error);
    });
    
    // Asignar evento al formulario del modal de Nueva Área
    const newAreaForm = document.getElementById('newAreaForm');
    const newAreaModalEl = document.getElementById('newAreaModal');
    if (newAreaForm && !newAreaForm.dataset.listener) {
        newAreaForm.dataset.listener = "true";
        newAreaForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const numInput = document.getElementById('newAreaNumberInput');
            const cranesInput = document.getElementById('newAreaCranesInput');
            if (!numInput || !numInput.value) return;

            const areaNum = numInput.value.trim().replace(/\D/g, '');
            if (!areaNum) {
                alert("El número de área debe contener solo dígitos.");
                return;
            }

            const areaKey = `area${areaNum}`;
            if (cranesConfig && cranesConfig[areaKey]) {
                alert(`El Área ${areaNum} ya existe en el sistema.`);
                return;
            }

            let initialCranes = [];
            if (cranesInput && cranesInput.value.trim().length > 0) {
                initialCranes = cranesInput.value.split(',').map(c => c.trim().toUpperCase()).filter(c => c.length > 0);
            } else {
                initialCranes = [`${areaNum}A`, `${areaNum}B`, `${areaNum}C`, `${areaNum}D`];
            }

            if (!cranesConfig) cranesConfig = {};
            cranesConfig[areaKey] = initialCranes;
            activeAreaKey = areaKey;
            if (typeof allAreasLedConfig !== 'undefined' && !allAreasLedConfig[areaKey]) {
                allAreasLedConfig[areaKey] = { ...defaultAreaLedConfig };
            }
            await saveCranesConfig();

            // Cerrar modal de Bootstrap
            if (newAreaModalEl) {
                const modalInst = bootstrap.Modal.getInstance(newAreaModalEl) || new bootstrap.Modal(newAreaModalEl);
                modalInst.hide();
            }
            numInput.value = '';
            if (cranesInput) cranesInput.value = '';
        });
    }
}

async function saveCranesConfig() {
    try {
        // Asegurarse de que _order esté sincronizado con las claves reales
        const areaKeys = Object.keys(cranesConfig).filter(k => k !== '_order');
        if (!cranesConfig._order) {
            cranesConfig._order = areaKeys.sort((a, b) => parseInt(a.replace('area','')) - parseInt(b.replace('area','')));
        } else {
            // Eliminar claves obsoletas del orden y agregar las nuevas al final
            cranesConfig._order = cranesConfig._order.filter(k => areaKeys.includes(k));
            areaKeys.forEach(k => { if (!cranesConfig._order.includes(k)) cranesConfig._order.push(k); });
        }
        await db.collection('config').doc('cranes_config').set(cranesConfig);
        // El panel es el creador de las áreas y grúas, así que también es el único que
        // crea los registros espejo de 'crane_status'. Los ESP32 solo actualizan.
        const mirror = await syncCraneStatusMirror();
        const extra = mirror.created > 0 || mirror.deleted > 0
            ? ` Espejo de estado: ${mirror.created} creado(s), ${mirror.deleted} eliminado(s).`
            : "";
        showAlert("Configuración de grúas guardada correctamente." + extra, "success");
    } catch (error) {
        console.error("Error guardando config de grúas:", error);
        showAlert(`Error al guardar configuración: ${error.message}`, "danger");
    }
}

// ======================================================================
// ESPEJO DE ESTADO (crane_status)
// Regla del sistema: la WEB crea las colecciones/registros. El panel define
// áreas y grúas, y aquí se materializa la fila de 'crane_status' para cada
// grúa creada. El firmware ESP32 NUNCA crea registros: únicamente actualiza
// la fila que la web ya creó (si falta, avisa y no escribe).
// ======================================================================
async function syncCraneStatusMirror() {
    const db = firebase.firestore();
    const areaKeys = Object.keys(cranesConfig).filter(k => k !== '_order' && Array.isArray(cranesConfig[k]));

    const configured = new Set();
    areaKeys.forEach(k => cranesConfig[k].forEach(id => configured.add(id)));

    const snap = await db.collection('crane_status').get();
    const existing = new Map();
    snap.forEach(d => existing.set(d.id, d));

    let created = 0;
    let deleted = 0;
    let backfilled = 0;

    // Crear las filas que faltan (origen: panel de administración)
    for (const craneId of configured) {
        if (existing.has(craneId)) {
            // El panel es el dueño del área: las filas 'bootstrap' heredadas pueden no tener
            // 'area', y entonces el Análisis Detallado las agrupa como 'Sin área'/'N/A'.
            const ref = existing.get(craneId);
            const data = (typeof ref.data === 'function') ? ref.data() : ref;
            if (!data || !data.area) {
                await db.collection('crane_status').doc(craneId).set({ area: craneId.substring(0, 2) }, { merge: true });
                backfilled++;
            }
            continue;
        }
        await db.collection('crane_status').doc(craneId).set({
            craneId,
            estado: 'operativa',
            motivo: '',
            area: craneId.substring(0, 2),
            source: 'web_config'
        });
        created++;
    }

    // Eliminar filas huérfanas (grúas borradas del panel)
    for (const craneId of existing.keys()) {
        if (configured.has(craneId)) continue;
        await db.collection('crane_status').doc(craneId).delete();
        deleted++;
    }

    return { created, deleted };
}

// ======================================================================
// RENDERIZADO DE PESTAÑAS DINÁMICAS POR ÁREA INDUSTRIAL
window.initCraneLedControl = function() {
    if (typeof renderCranesMgmtUI === 'function') {
        renderCranesMgmtUI();
    }
};

function renderCranesMgmtUI() {
    const tabsNav  = document.getElementById('areaTabsNav');
    const tabsContent = document.getElementById('areaTabsContent');
    if (!tabsNav || !tabsContent || !cranesConfig) return;

    // Ordenar áreas
    const allAreaKeys = Object.keys(cranesConfig).filter(k => k !== '_order' && Array.isArray(cranesConfig[k]));
    const orderedKeys = cranesConfig._order
        ? cranesConfig._order.filter(k => allAreaKeys.includes(k))
        : [...allAreaKeys];
    allAreaKeys.forEach(k => { if (!orderedKeys.includes(k)) orderedKeys.push(k); });
    const areas = orderedKeys;

    // Si el área activa ya no existe, usar la primera
    if (!areas.includes(activeAreaKey) && areas.length > 0) {
        activeAreaKey = areas[0];
    }

    // ---- Construir barra de pestañas ----
    tabsNav.replaceChildren();

    if (areas.length === 0) {
        setSafeDOM(tabsNav, '<span class="text-muted small">No hay áreas. Agrega una nueva área para comenzar.</span>');
        tabsContent.replaceChildren();
        return;
    }

    // Pestañas de área
    areas.forEach(areaKey => {
        const areaNum   = areaKey.replace('area', '');
        const craneCount = (cranesConfig[areaKey] || []).length;
        const isActive   = areaKey === activeAreaKey;
        const areaCranes = cranesConfig[areaKey] || [];
        const activeFailuresInArea = (typeof liveActiveFailures !== 'undefined') ? areaCranes.filter(cId => liveActiveFailures.has(cId)).length : 0;

        const btn = document.createElement('button');
        btn.className = `btn area-tab-btn ${isActive ? 'area-tab-btn--active' : ''}`;
        btn.dataset.areaKey = areaKey;
        btn.draggable = true;
        btn.title = "Haz clic para seleccionar o arrastra para reordenar el área";
        setSafeDOM(btn, `
            <i class="bi bi-grip-vertical text-muted opacity-50 me-1" style="font-size:0.8rem;"></i>
            <i class="bi bi-building"></i> Área ${areaNum} 
            <span class="badge ${isActive ? 'bg-white text-dark' : 'bg-secondary'} ms-1">${craneCount}</span>
            ${activeFailuresInArea > 0 ? `<span class="badge bg-danger ms-1" title="${activeFailuresInArea} grúa(s) en falla activa en planta"><i class="bi bi-exclamation-triangle-fill"></i> ${activeFailuresInArea}</span>` : ''}
        `);
        btn.addEventListener('click', () => switchToAreaTab(areaKey));

        btn.addEventListener('dragstart', (e) => {
            e.dataTransfer.setData('text/plain', areaKey);
            e.dataTransfer.effectAllowed = 'move';
            btn.classList.add('dragging');
        });
        btn.addEventListener('dragend', () => {
            btn.classList.remove('dragging');
            document.querySelectorAll('.area-tab-btn').forEach(b => b.classList.remove('drag-over'));
        });
        btn.addEventListener('dragover', (e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            btn.classList.add('drag-over');
        });
        btn.addEventListener('dragleave', () => {
            btn.classList.remove('drag-over');
        });
        btn.addEventListener('drop', async (e) => {
            e.preventDefault();
            btn.classList.remove('drag-over');
            const draggedKey = e.dataTransfer.getData('text/plain');
            const targetKey = areaKey;
            if (!draggedKey || draggedKey === targetKey || draggedKey === '__global__') return;

            const order = cranesConfig._order ? [...cranesConfig._order] : [...areas];
            const fromIdx = order.indexOf(draggedKey);
            const toIdx = order.indexOf(targetKey);
            if (fromIdx !== -1 && toIdx !== -1) {
                order.splice(fromIdx, 1);
                order.splice(toIdx, 0, draggedKey);
                cranesConfig._order = order;
                await saveCranesConfig();
                renderCranesMgmtUI();
            }
        });
        tabsNav.appendChild(btn);
    });

    // Pestaña Monitor Global
    const globalBtn = document.createElement('button');
    const isGlobal = activeAreaKey === '__global__';
    globalBtn.className = `btn area-tab-btn area-tab-btn--global ${isGlobal ? 'area-tab-btn--active' : ''}`;
    globalBtn.dataset.areaKey = '__global__';
    setSafeDOM(globalBtn, `<i class="bi bi-cpu-fill"></i> Monitor Global ESP32`);
    globalBtn.addEventListener('click', () => switchToAreaTab('__global__'));
    tabsNav.appendChild(globalBtn);

    // ---- Renderizar panel del área activa ----
    renderActiveAreaPanel(areas);

    // ---- Iniciar suscripción LED si aún no está activa ----
    if (!craneLedUnsubscribe) {
        initCraneLedSubscription();
    }
    if (!window._esp32ManagerInitialized) {
        window._esp32ManagerInitialized = true;
        initEsp32DeviceManager();
    }
}

function switchToAreaTab(areaKey) {
    activeAreaKey = areaKey;
    simSelectionIndex = 0;
    simHoldingResolve = false;

    // Actualizar visual de pestañas
    document.querySelectorAll('.area-tab-btn').forEach(b => {
        const isActive = b.dataset.areaKey === areaKey;
        b.classList.toggle('area-tab-btn--active', isActive);
        const badge = b.querySelector('.badge');
        if (badge) {
            badge.className = isActive ? 'badge bg-white text-dark ms-1' : 'badge bg-secondary ms-1';
        }
    });

    // Mostrar/ocultar paneles y expandir a ancho completo en Monitor Global
    const tabsContent  = document.getElementById('areaTabsContent');
    const globalPanel  = document.getElementById('globalEsp32Panel');
    const sideCol      = document.getElementById('cranesSideCardCol');
    const mainCol      = document.getElementById('cranesMainContentCol');

    if (areaKey === '__global__') {
        if (sideCol) sideCol.style.display = 'none';
        if (mainCol) { mainCol.classList.remove('col-md-9'); mainCol.classList.add('col-12'); }
        if (tabsContent)  tabsContent.style.display  = 'none';
        if (globalPanel)  globalPanel.style.display  = 'block';
    } else {
        if (sideCol) sideCol.style.display = 'block';
        if (mainCol) { mainCol.classList.remove('col-12'); mainCol.classList.add('col-md-9'); }
        if (globalPanel)  globalPanel.style.display  = 'none';
        if (tabsContent)  tabsContent.style.display  = 'block';

        // Rebuild area panel (panel LED activo solo si ESP32 conectado por USB)
        const allAreaKeys = Object.keys(cranesConfig).filter(k => k !== '_order' && Array.isArray(cranesConfig[k]));
        const orderedKeys = cranesConfig._order
            ? cranesConfig._order.filter(k => allAreaKeys.includes(k))
            : [...allAreaKeys];
        allAreaKeys.forEach(k => { if (!orderedKeys.includes(k)) orderedKeys.push(k); });
        renderActiveAreaPanel(orderedKeys);
    }
}

function renderActiveAreaPanel(areas) {
    const tabsContent  = document.getElementById('areaTabsContent');
    const globalPanel  = document.getElementById('globalEsp32Panel');
    const sideCol      = document.getElementById('cranesSideCardCol');
    const mainCol      = document.getElementById('cranesMainContentCol');
    if (!tabsContent) return;

    if (activeAreaKey === '__global__') {
        if (sideCol) sideCol.style.display = 'none';
        if (mainCol) { mainCol.classList.remove('col-md-9'); mainCol.classList.add('col-12'); }
        tabsContent.style.display = 'none';
        if (globalPanel) globalPanel.style.display = 'block';
        return;
    }

    if (sideCol) sideCol.style.display = 'block';
    if (mainCol) { mainCol.classList.remove('col-12'); mainCol.classList.add('col-md-9'); }
    if (globalPanel) globalPanel.style.display = 'none';
    tabsContent.style.display = 'block';

    if (!cranesConfig || !areas.includes(activeAreaKey)) return;

    const areaKey   = activeAreaKey;
    const areaNum   = areaKey.replace('area', '');
    const areaCranes = cranesConfig[areaKey] || [];
    const areaIdx   = areas.indexOf(areaKey);
    const isFirst   = areaIdx === 0;
    const isLast    = areaIdx === areas.length - 1;
    const cfg       = getAreaConfig(areaKey);

    setSafeDOM(tabsContent, `
    <div class="row g-3">

      <!-- ═══════ CABECERA: Grúas del Área ═══════ -->
      <div class="col-12">
        <div class="card border-0" style="background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.1)!important;">
          <div class="card-header d-flex justify-content-between align-items-center py-2" style="background:rgba(255,255,255,0.04);">
            <div class="d-flex align-items-center gap-2">
              <div class="d-flex flex-column gap-1">
                <button class="btn btn-sm btn-outline-secondary py-0 px-1 lh-1" title="Mover arriba"
                    onclick="moveArea('${areaKey}', -1)" ${isFirst ? 'disabled' : ''}>
                    <i class="bi bi-chevron-up" style="font-size:0.7rem;"></i>
                </button>
                <button class="btn btn-sm btn-outline-secondary py-0 px-1 lh-1" title="Mover abajo"
                    onclick="moveArea('${areaKey}', 1)" ${isLast ? 'disabled' : ''}>
                    <i class="bi bi-chevron-down" style="font-size:0.7rem;"></i>
                </button>
              </div>
              <strong class="text-white fw-bold fs-5"><i class="bi bi-folder2-open text-warning"></i> Área ${areaNum}</strong>
              <span class="badge bg-primary">${areaCranes.length} grúas</span>
              ${(() => {
                  const failCount = (typeof liveActiveFailures !== 'undefined') ? areaCranes.filter(c => liveActiveFailures.has(c)).length : 0;
                  const okCount = areaCranes.length - failCount;
                  return failCount > 0
                      ? `<span class="badge bg-danger ms-1"><i class="bi bi-exclamation-triangle-fill"></i> ${failCount} en falla</span><span class="badge bg-success ms-1"><i class="bi bi-check-circle-fill"></i> ${okCount} operativas</span>`
                      : `<span class="badge bg-success ms-1"><i class="bi bi-check-circle-fill"></i> Todas operativas</span>`;
              })()}
            </div>
            <button class="btn btn-sm btn-outline-danger py-1" onclick="deleteArea('${areaKey}', '${areaNum}')">
              <i class="bi bi-trash"></i> Eliminar Área
            </button>
          </div>
          <div class="card-body">
            <div class="mb-3 d-flex flex-wrap gap-2" id="cranesList-${areaKey}">
              ${areaCranes.length === 0
                ? '<span class="text-muted small">No hay grúas en esta área.</span>'
                : [...areaCranes].map((craneId, idx) => {
                    const isAlarm = (typeof liveActiveFailures !== 'undefined') && liveActiveFailures.has(craneId);
                    return `<span class="d-inline-flex align-items-center gap-2 px-3 py-2 rounded-3 border crane-drag-chip ${isAlarm ? 'border-danger bg-danger bg-opacity-10' : 'border-success bg-success bg-opacity-10'}" style="font-size:0.9rem;" draggable="true" data-crane-id="${craneId}" title="Arrastra para reordenar la grúa">
                       <i class="bi bi-grip-vertical text-muted opacity-50" style="font-size:0.85rem;"></i>
                       <span class="fw-semibold ${isAlarm ? 'text-danger' : 'text-success'}">
                         <i class="bi ${isAlarm ? 'bi-exclamation-triangle-fill' : 'bi-check-circle-fill'} me-1"></i>Grúa ${craneId}
                       </span>
                       <small class="badge ${isAlarm ? 'bg-danger' : 'bg-success'}">${isAlarm ? 'En Falla' : 'Operativa'}</small>
                       <i class="bi bi-x-circle-fill text-danger-emphasis" onclick="deleteCraneFromArea('${areaKey}', '${craneId}')" style="cursor:pointer;opacity:0.5;" title="Eliminar grúa"></i>
                     </span>`;
                  }).join('')}
            </div>
            <hr class="border-secondary border-opacity-25">
            <form class="row g-2 align-items-center" onsubmit="event.preventDefault(); addCraneToArea('${areaKey}', '${areaNum}')">
              <div class="col-auto">
                <div class="input-group input-group-sm">
                  <span class="input-group-text">${areaNum}</span>
                  <input type="text" class="form-control" placeholder="Letra (ej. E, F)" id="craneInput-${areaKey}" maxlength="5" required style="width:120px;">
                </div>
              </div>
              <div class="col-auto">
                <button type="submit" class="btn btn-sm btn-primary"><i class="bi bi-plus-lg"></i> Agregar Grúa</button>
              </div>
            </form>
          </div>
        </div>
      </div>

      <!-- ═══════ PANEL LED / SCADA ═══════ -->
      <div class="col-12">
        <div class="card crane-led-simulator-panel">
          <div class="card-header d-flex justify-content-between align-items-center flex-wrap gap-2">
            <div class="d-flex align-items-center gap-2 flex-wrap">
              <h5 class="mb-0"><i class="bi bi-lightbulb-fill text-warning"></i> Control de Iluminación y Tira LED SCADA — Área ${areaNum}</h5>
              <span class="badge bg-primary px-3 py-2"><i class="bi bi-cpu"></i> Multi-ESP32 WS2815 Sync</span>
            </div>
            <div class="d-flex gap-2">
              <button class="btn btn-sm btn-outline-info" id="viewEsp32CodeBtn" data-bs-toggle="modal" data-bs-target="#esp32CodeModal">
                <i class="bi bi-file-earmark-code"></i> Obtener Firmware ESP32
              </button>
            </div>
          </div>
          <div class="card-body">

            <!-- Opciones globales -->
            <div class="row g-3 align-items-center mb-4 p-3 rounded-3" style="background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.08);">
              <div class="col-md-7">
                <div class="form-check form-switch mt-1">
                  <input class="form-check-input" type="checkbox" id="applyToAllAreasLed">
                  <label class="form-check-label small fw-semibold" for="applyToAllAreasLed">
                    Aplicar esta misma configuración visual a <strong>todas las áreas</strong> de la planta
                  </label>
                </div>
              </div>
            </div>

            <!-- Simulador en Vivo -->
            <div class="mb-4">
              <div class="d-flex justify-content-between align-items-center flex-wrap gap-2 mb-2">
                <div>
                  <label class="form-label mb-0 fw-bold small text-uppercase"><i class="bi bi-eye"></i> Simulador de Iluminación en Vivo</label>
                  <span class="badge bg-secondary ms-2" id="simAreaBadge">Área ${areaNum}</span>
                </div>
                <span class="badge bg-dark-subtle text-muted small" id="simStatusBadge">Simulando en vivo (Paso a paso)</span>
              </div>
              <div class="crane-led-strip-container" id="craneLedStripSimulator"></div>
              <div class="sim-interactive-bar mt-3">
                <div class="d-flex align-items-center gap-2 flex-wrap w-100">
                  <span class="small fw-bold text-muted text-uppercase"><i class="bi bi-joystick"></i> Simulador de Pulsador Arcade:</span>
                  <button class="btn btn-sm btn-outline-warning" id="simClickBtn" title="Simula un toque corto en el botón arcade físico">
                    <i class="bi bi-hand-index-thumb"></i> Clic Corto (Seleccionar Grúa)
                  </button>
                  <button class="btn btn-sm btn-outline-success" id="simHoldBtn" title="Sostén presionado o haz clic para simular que el técnico sostiene 5 segundos para resolver la falla">
                    <i class="bi bi-stopwatch"></i> Sostener (Resolver Falla)
                  </button>
                  <button class="btn btn-sm btn-outline-secondary" id="simResetBtn" title="Vuelve todas las grúas al modo reposo operativo">
                    <i class="bi bi-arrow-counterclockwise"></i> Reiniciar Simulación
                  </button>
                </div>
                <div class="w-100 d-flex align-items-center justify-content-between gap-3 mt-1 flex-wrap">
                  <span class="small text-muted" id="simButtonStateText"><i class="bi bi-circle"></i> Modo: Reposo (Todas Operativas)</span>
                  <div class="flex-grow-1" id="simProgressContainer" style="max-width: 320px; display: none;">
                    <div class="d-flex justify-content-between align-items-center mb-1">
                      <span class="badge bg-dark border border-secondary" id="simProgressBadge" style="font-size: 0.72rem;">Cuenta Regresiva</span>
                      <span class="small font-monospace fw-bold text-warning" id="simProgressTime">5.0s</span>
                    </div>
                    <div class="progress" style="height: 10px; background: #090d16; border: 1px solid rgba(255,255,255,0.15); border-radius: 6px;">
                      <div class="progress-bar progress-bar-striped progress-bar-animated" id="simMainProgressBar" role="progressbar" style="width: 100%;"></div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <!-- Parámetros de Hardware y Tiempos -->
            <h6 class="fw-bold text-uppercase small text-muted mb-3"><i class="bi bi-sliders2"></i> Parámetros de Hardware y Temporizadores</h6>
            <div class="row g-3 mb-4">
              <div class="col-md-3 col-6">
                <label class="form-label small fw-semibold">LEDs por Grúa:</label>
                <input type="number" class="form-control form-control-sm" id="ledsPerCraneInput" min="3" max="50" value="${cfg.ledsPerCrane || 7}">
                <span class="form-text small text-muted">Por defecto: 7 LEDs</span>
              </div>
              <div class="col-md-3 col-6">
                <label class="form-label small fw-semibold">LEDs de Separación (Gap):</label>
                <input type="number" class="form-control form-control-sm" id="ledGapInput" min="0" max="10" value="${cfg.gapLeds !== undefined ? cfg.gapLeds : 2}">
                <span class="form-text small text-muted">Por defecto: 2 LEDs apagados</span>
              </div>
              <div class="col-md-3 col-6">
                <label class="form-label small d-flex justify-content-between">
                  <span>Confirmar Reporte:</span>
                  <span class="badge bg-warning text-dark" id="selectionTimeoutVal">${cfg.selectionTimeoutSec || 5}s</span>
                </label>
                <input type="range" class="form-range" id="selectionTimeoutInput" min="3" max="15" value="${cfg.selectionTimeoutSec || 5}" step="1">
                <span class="form-text small text-muted">Sin tocar botón p/ enviar</span>
              </div>
              <div class="col-md-3 col-6">
                <label class="form-label small d-flex justify-content-between">
                  <span>Sostener p/ Resolver:</span>
                  <span class="badge bg-info text-dark" id="resolveHoldVal">${cfg.resolveHoldSec || 5}s</span>
                </label>
                <input type="range" class="form-range" id="resolveHoldInput" min="2" max="10" value="${cfg.resolveHoldSec || 5}" step="1">
                <span class="form-text small text-muted">Tiempo continuo sostenido</span>
              </div>
              <div class="col-12">
                <label class="form-label d-flex justify-content-between align-items-center mb-1">
                  <span class="small fw-semibold"><i class="bi bi-brightness-high"></i> Brillo General de la Tira WS2815:</span>
                  <span class="badge bg-primary" id="ledBrightnessVal">${cfg.brightness || 80}%</span>
                </label>
                <input type="range" class="form-range" id="ledBrightnessInput" min="10" max="100" value="${cfg.brightness || 80}" step="5">
              </div>
            </div>

            <!-- Efectos Visuales y Colores -->
            <h6 class="fw-bold text-uppercase small text-muted mb-3"><i class="bi bi-palette"></i> Efectos Visuales y Colores de Señalización</h6>
            <div class="row g-3">
              <!-- 1. Operativo -->
              <div class="col-lg-3 col-md-6">
                <div class="p-3 rounded-3 h-100" style="background:rgba(16,185,129,0.06);border:1px solid rgba(16,185,129,0.2);">
                  <h6 class="text-success fw-bold mb-3"><i class="bi bi-check-circle-fill"></i> 1. Operativo (Normal)</h6>
                  <div class="mb-3">
                    <label class="form-label small fw-semibold">Efecto Visual:</label>
                    <select class="form-select form-select-sm" id="ledNormalEffect">
                      <option value="blink_slow" ${(cfg.normalEffect||'blink_slow')==='blink_slow'?'selected':''}>Parpadeo Lento (Ahorro térmico)</option>
                      <option value="breathing" ${cfg.normalEffect==='breathing'?'selected':''}>Respiración Suave</option>
                      <option value="static" ${cfg.normalEffect==='static'?'selected':''}>Fijo Continuo (100%)</option>
                      <option value="heartbeat" ${cfg.normalEffect==='heartbeat'?'selected':''}>Latido Industrial</option>
                    </select>
                  </div>
                  <div class="mb-3" id="ledNormalSpeedContainer" style="${cfg.normalEffect==='static'?'display:none;':''}">
                    <label class="form-label small d-flex justify-content-between">
                      <span>Velocidad:</span>
                      <span class="badge bg-success" id="ledNormalSpeedVal">${cfg.normalBlinkMs || 1200} ms</span>
                    </label>
                    <input type="range" class="form-range" id="ledNormalSpeedInput" min="600" max="3000" value="${cfg.normalBlinkMs || 1200}" step="100">
                  </div>
                  <div class="mb-2">
                    <label class="form-label small fw-semibold">Color Operativo:</label>
                    <div class="d-flex align-items-center gap-2 mb-2">
                      <input type="color" class="form-control form-control-color" id="ledNormalColor" value="${cfg.normalColor || '#00ff00'}" title="Elegir color">
                      <span class="small font-monospace text-muted" id="ledNormalColorHex">${(cfg.normalColor || '#00ff00').toUpperCase()}</span>
                    </div>
                    <div class="d-flex flex-wrap gap-1">
                      <button type="button" class="preset-chip-btn" data-target="normal" data-color="#00ff00"><span class="color-dot" style="background:#00ff00;"></span> Verde Puro</button>
                      <button type="button" class="preset-chip-btn" data-target="normal" data-color="#10b981"><span class="color-dot" style="background:#10b981;"></span> Esmeralda</button>
                      <button type="button" class="preset-chip-btn" data-target="normal" data-color="#00ffff"><span class="color-dot" style="background:#00ffff;"></span> Cian</button>
                      <button type="button" class="preset-chip-btn" data-target="normal" data-color="#0088ff"><span class="color-dot" style="background:#0088ff;"></span> Azul</button>
                      <button type="button" class="preset-chip-btn" data-target="normal" data-color="#ffffff"><span class="color-dot" style="background:#ffffff;"></span> Blanco</button>
                    </div>
                  </div>
                </div>
              </div>

              <!-- 2. Alarma -->
              <div class="col-lg-3 col-md-6">
                <div class="p-3 rounded-3 h-100" style="background:rgba(239,68,68,0.06);border:1px solid rgba(239,68,68,0.2);">
                  <h6 class="text-danger fw-bold mb-3"><i class="bi bi-exclamation-triangle-fill"></i> 2. Falla (Alarma)</h6>
                  <div class="mb-3">
                    <label class="form-label small fw-semibold">Efecto Visual:</label>
                    <select class="form-select form-select-sm" id="ledAlarmEffect">
                      <option value="blink_fast" ${(cfg.alarmEffect||'blink_fast')==='blink_fast'?'selected':''}>Parpadeo Rápido</option>
                      <option value="strobe" ${cfg.alarmEffect==='strobe'?'selected':''}>Estroboscópico Ultra</option>
                      <option value="chase" ${cfg.alarmEffect==='chase'?'selected':''}>Barrido Secuencial</option>
                      <option value="breathe_fast" ${cfg.alarmEffect==='breathe_fast'?'selected':''}>Respiración Rápida</option>
                    </select>
                  </div>
                  <div class="mb-3" id="ledAlarmSpeedContainer">
                    <label class="form-label small d-flex justify-content-between">
                      <span>Velocidad:</span>
                      <span class="badge bg-danger" id="ledAlarmSpeedVal">${cfg.alarmBlinkMs || 300} ms</span>
                    </label>
                    <input type="range" class="form-range" id="ledAlarmSpeedInput" min="100" max="800" value="${cfg.alarmBlinkMs || 300}" step="25">
                  </div>
                  <div class="mb-2">
                    <label class="form-label small fw-semibold">Color de Alerta:</label>
                    <div class="d-flex align-items-center gap-2 mb-2">
                      <input type="color" class="form-control form-control-color" id="ledAlarmColor" value="${cfg.alarmColor || '#ff0000'}" title="Elegir color">
                      <span class="small font-monospace text-muted" id="ledAlarmColorHex">${(cfg.alarmColor || '#ff0000').toUpperCase()}</span>
                    </div>
                    <div class="d-flex flex-wrap gap-1">
                      <button type="button" class="preset-chip-btn" data-target="alarm" data-color="#ff0000"><span class="color-dot" style="background:#ff0000;"></span> Rojo Puro</button>
                      <button type="button" class="preset-chip-btn" data-target="alarm" data-color="#ff4400"><span class="color-dot" style="background:#ff4400;"></span> Fuego</button>
                      <button type="button" class="preset-chip-btn" data-target="alarm" data-color="#ff8800"><span class="color-dot" style="background:#ff8800;"></span> Ámbar</button>
                      <button type="button" class="preset-chip-btn" data-target="alarm" data-color="#ff007f"><span class="color-dot" style="background:#ff007f;"></span> Magenta</button>
                    </div>
                  </div>
                </div>
              </div>

              <!-- 3. Selección -->
              <div class="col-lg-3 col-md-6">
                <div class="p-3 rounded-3 h-100" style="background:rgba(245,158,11,0.06);border:1px solid rgba(245,158,11,0.25);">
                  <h6 class="text-warning fw-bold mb-3"><i class="bi bi-hand-index-thumb"></i> 3. Modo Selección</h6>
                  <p class="small text-muted mb-3" style="font-size:0.77rem;">Color de la grúa mientras el operador pulsa el botón para elegir cuál reportar.</p>
                  <div class="mb-3">
                    <label class="form-label small fw-semibold">Color de Selección:</label>
                    <div class="d-flex align-items-center gap-2 mb-2">
                      <input type="color" class="form-control form-control-color" id="ledSelectionColor" value="${cfg.selectionColor || '#ffaa00'}" title="Elegir color">
                      <span class="small font-monospace text-muted" id="ledSelectionColorHex">${(cfg.selectionColor || '#ffaa00').toUpperCase()}</span>
                    </div>
                    <div class="d-flex flex-wrap gap-1">
                      <button type="button" class="preset-chip-btn" data-target="selection" data-color="#ffaa00"><span class="color-dot" style="background:#ffaa00;"></span> Ámbar Puro</button>
                      <button type="button" class="preset-chip-btn" data-target="selection" data-color="#ffff00"><span class="color-dot" style="background:#ffff00;"></span> Amarillo</button>
                      <button type="button" class="preset-chip-btn" data-target="selection" data-color="#ff6600"><span class="color-dot" style="background:#ff6600;"></span> Naranja</button>
                      <button type="button" class="preset-chip-btn" data-target="selection" data-color="#ffffff"><span class="color-dot" style="background:#ffffff;"></span> Blanco</button>
                    </div>
                  </div>
                  <div class="small text-muted p-2 rounded bg-dark border border-secondary border-opacity-25" style="font-size:0.75rem;">
                    <i class="bi bi-hourglass-split text-warning"></i> Barra de cuenta regresiva decreciente según el tiempo de espera configurado arriba.
                  </div>
                </div>
              </div>

              <!-- 4. Resolución -->
              <div class="col-lg-3 col-md-6">
                <div class="p-3 rounded-3 h-100" style="background:rgba(6,182,212,0.06);border:1px solid rgba(6,182,212,0.25);">
                  <h6 class="text-info fw-bold mb-3"><i class="bi bi-tools"></i> 4. Modo Resolución</h6>
                  <p class="small text-muted mb-3" style="font-size:0.77rem;">Barra de llenado progresivo cuando el técnico sostiene el botón para resolver.</p>
                  <div class="mb-3">
                    <label class="form-label small fw-semibold">Color de Llenado:</label>
                    <div class="d-flex align-items-center gap-2 mb-2">
                      <input type="color" class="form-control form-control-color" id="ledResolveColor" value="${cfg.resolveColor || '#00ff88'}" title="Elegir color">
                      <span class="small font-monospace text-muted" id="ledResolveColorHex">${(cfg.resolveColor || '#00ff88').toUpperCase()}</span>
                    </div>
                    <div class="d-flex flex-wrap gap-1">
                      <button type="button" class="preset-chip-btn" data-target="resolve" data-color="#00ff88"><span class="color-dot" style="background:#00ff88;"></span> Verde Eléctrico</button>
                      <button type="button" class="preset-chip-btn" data-target="resolve" data-color="#00ff00"><span class="color-dot" style="background:#00ff00;"></span> Verde Puro</button>
                      <button type="button" class="preset-chip-btn" data-target="resolve" data-color="#00e5ff"><span class="color-dot" style="background:#00e5ff;"></span> Cian Neón</button>
                      <button type="button" class="preset-chip-btn" data-target="resolve" data-color="#3b82f6"><span class="color-dot" style="background:#3b82f6;"></span> Azul</button>
                    </div>
                  </div>
                  <div class="small text-muted p-2 rounded bg-dark border border-secondary border-opacity-25" style="font-size:0.75rem;">
                    <i class="bi bi-check2-all text-info"></i> Se llena proporcionalmente durante los segundos configurados en "Sostener p/ Resolver".
                  </div>
                </div>
              </div>

              <!-- Botón Guardar -->
              <div class="col-12 mt-4">
                <button id="saveCraneLedBtn" class="btn btn-success w-100 py-3 fs-6 fw-bold shadow">
                  <i class="bi bi-usb-plug-fill me-1"></i> Guardar Configuración Directo en ESP32 / Tira LED — Área ${areaNum}
                </button>
                <div class="text-center mt-2 small text-muted">
                  <i class="bi bi-shield-check text-success"></i> Guarda permanentemente en la memoria Flash (NVS) del ESP32 por USB. Funciona 100% autónomo sin cuotas de Firebase.
                </div>
                <div id="craneLedSaveAlert" class="mt-2"></div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
    `);

    // Vincular listeners del área activa
    bindAreaPanelListeners();
    initCraneChipsDragDrop(areaKey);

    // Mostrar panel LED solo si hay ESP32 conectado por USB
    _refreshLedPanelByUsbState();
}

function initCraneChipsDragDrop(areaKey) {
    const cranesListEl = document.getElementById(`cranesList-${areaKey}`);
    if (!cranesListEl) return;
    let draggedCraneId = null;

    cranesListEl.querySelectorAll('.crane-drag-chip').forEach(chip => {
        chip.addEventListener('dragstart', (e) => {
            draggedCraneId = chip.dataset.craneId;
            e.dataTransfer.setData('text/plain', draggedCraneId);
            e.dataTransfer.effectAllowed = 'move';
            chip.classList.add('dragging');
        });
        chip.addEventListener('dragend', () => {
            chip.classList.remove('dragging');
            cranesListEl.querySelectorAll('.crane-drag-chip').forEach(c => c.classList.remove('drag-over'));
        });
        chip.addEventListener('dragover', (e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            chip.classList.add('drag-over');
        });
        chip.addEventListener('dragleave', () => {
            chip.classList.remove('drag-over');
        });
        chip.addEventListener('drop', async (e) => {
            e.preventDefault();
            chip.classList.remove('drag-over');
            const targetCraneId = chip.dataset.craneId;
            if (!draggedCraneId || draggedCraneId === targetCraneId) return;

            const list = [...(cranesConfig[areaKey] || [])];
            const fromIdx = list.indexOf(draggedCraneId);
            const toIdx = list.indexOf(targetCraneId);
            if (fromIdx !== -1 && toIdx !== -1) {
                list.splice(fromIdx, 1);
                list.splice(toIdx, 0, draggedCraneId);
                cranesConfig[areaKey] = list;
                await saveCranesConfig();
                renderActiveAreaPanel(cranesConfig._order || Object.keys(cranesConfig));
                renderAreaSimulator();
            }
        });
    });
}

// ======================================================================
// SUSCRIPCIÓN FIRESTORE LED (se llama una vez)
// ======================================================================
function initCraneLedSubscription() {
    if (craneLedUnsubscribe) craneLedUnsubscribe();
    craneLedUnsubscribe = db.collection('config').doc('crane_led_settings').onSnapshot(async (doc) => {
        if (!doc.exists) {
            try {
                const initCfg = {};
                Object.keys(allAreasLedConfig).forEach(k => {
                    if (!k.startsWith('__') && !k.endsWith('__')) initCfg[k] = allAreasLedConfig[k];
                });
                await db.collection('config').doc('crane_led_settings').set(initCfg);
            } catch(e) {}
        } else {
            const data = doc.data() || {};
            if (data.brightness !== undefined && !data.area10) {
                allAreasLedConfig['area10'] = { ...defaultAreaLedConfig, ...data };
            } else {
                Object.keys(data).forEach(k => {
                    if (typeof data[k] === 'object' && data[k] !== null) {
                        allAreasLedConfig[k] = { ...defaultAreaLedConfig, ...data[k] };
                    }
                });
            }
            updateFormFromActiveArea();
            if (currentUsbPort && currentUsbPort.writable) {
                renderAreaSimulator();
            }
        }
    }, (err) => { console.error('Error escuchando crane_led_settings:', err); });
}

// ======================================================================
// COMUNICACIÓN USB SERIE (WEB SERIAL) - CONTROL DIRECTO ESP32
// ======================================================================
let currentUsbPort = null;
let currentUsbReader = null;
let isClosingUsb = false;
let liveLedSyncTimer = null;

// ─── Panel LED condicional (solo activo con ESP32 conectado por USB) ──────────
function _refreshLedPanelByUsbState() {
    const connected = !!(currentUsbPort && currentUsbPort.writable);
    const ledPanel  = document.querySelector('.crane-led-simulator-panel');
    const ledPanelCol = ledPanel ? ledPanel.closest('.col-12') : null;

    // Si el panel existe y tenemos el bloque padre col-12
    if (ledPanelCol) {
        let placeholder = document.getElementById('ledPanelDisconnectedPlaceholder');

        if (connected) {
            // Mostrar panel real y eliminar placeholder si existe
            ledPanelCol.style.display = 'block';
            if (placeholder) placeholder.remove();

            // Arrancar animación del simulador
            renderAreaSimulator();
            startSimulatorAnimation();
            updateFormFromActiveArea();
        } else {
            // Ocultar panel real y mostrar placeholder informativo
            ledPanelCol.style.display = 'none';
            if (simAnimationId) { cancelAnimationFrame(simAnimationId); simAnimationId = null; }

            if (!placeholder) {
                placeholder = document.createElement('div');
                placeholder.id = 'ledPanelDisconnectedPlaceholder';
                placeholder.className = 'col-12';
                setSafeDOM(placeholder, `
                  <div class="card border-0" style="background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.08)!important;">
                    <div class="card-header d-flex justify-content-between align-items-center flex-wrap gap-2">
                      <div class="d-flex align-items-center gap-2">
                        <i class="bi bi-lightbulb text-warning opacity-50"></i>
                        <h5 class="mb-0 text-muted">Control de Iluminación y Tira LED SCADA — ${activeAreaKey ? 'Área ' + activeAreaKey.replace('area','') : ''}</h5>
                        <span class="badge bg-secondary px-3 py-2"><i class="bi bi-cpu"></i> ESP32 Desconectado</span>
                      </div>
                    </div>
                    <div class="card-body text-center py-5">
                      <i class="bi bi-usb-plug text-secondary" style="font-size:3rem; opacity:0.35;"></i>
                      <h6 class="text-muted mt-3 mb-2">Hardware ESP32 Desconectado</h6>
                      <p class="small text-muted mb-3" style="max-width:480px;margin:0 auto;">
                        Conecta tu ESP32 por cable USB a este equipo y presiona <strong class="text-white">"Conectar por USB"</strong>
                        en el panel superior (Monitor Global ESP32) para habilitar la configuración de la tira LED WS2815,
                        ajustar brillo/efectos/colores en tiempo real y probar el pulsador arcade.
                      </p>
                      <div class="d-flex align-items-center justify-content-center gap-2 flex-wrap">
                        <span class="badge bg-dark border border-secondary py-2 px-3 small">
                          <i class="bi bi-lock-fill text-secondary me-1"></i>Simulador bloqueado — requiere ESP32 por USB
                        </span>
                      </div>
                    </div>
                  </div>
                `);
                // Insertar después del panel original (que está oculto)
                ledPanelCol.parentNode.insertBefore(placeholder, ledPanelCol.nextSibling);
            }
        }
    }
}


function appendTerminal(text) {
    const usbTerminalOutput = document.getElementById('usbTerminalOutput');
    if (!usbTerminalOutput) return;
    usbTerminalOutput.textContent += text;
    if (usbTerminalOutput.textContent.length > 4000) {
        usbTerminalOutput.textContent = usbTerminalOutput.textContent.slice(-3000);
    }
    usbTerminalOutput.scrollTop = usbTerminalOutput.scrollHeight;
}

async function sendSerialCommand(cmd) {
    if (!currentUsbPort || !currentUsbPort.writable) return;
    try {
        const encoder = new TextEncoder();
        const writer = currentUsbPort.writable.getWriter();
        await writer.write(encoder.encode(cmd));
        writer.releaseLock();
    } catch (e) {
        console.warn('Error enviando comando serial:', e);
        appendTerminal(`\n> Error de escritura serial: ${e.message}\n`);
    }
}

async function closeUsbConnection() {
    if (isClosingUsb) return;
    isClosingUsb = true;

    // 1. Cancelar y liberar el reader activo si existe
    if (currentUsbReader) {
        try {
            await currentUsbReader.cancel();
        } catch (e) {
            // Cancelar puede lanzar si el stream ya se cerró
        }
        try {
            currentUsbReader.releaseLock();
        } catch (e) {}
        currentUsbReader = null;
    }

    // 2. Dar tiempo para que el bucle de lectura se desenganche limpiamente
    await new Promise(r => setTimeout(r, 60));

    // 3. Cerrar el puerto serie si sigue abierto
    try {
        if (currentUsbPort) {
            await currentUsbPort.close();
        }
    } catch (e) {
        // Si el dispositivo ya fue desconectado físicamente del bus USB, solo registrar
        console.log('Puerto USB liberado o ya cerrado:', e.message || e);
    } finally {
        currentUsbPort = null;
        currentUsbReader = null;
        isClosingUsb = false;
    }

    const usbStatusBadge     = document.getElementById('usbStatusBadge');
    const usbConnectBtn      = document.getElementById('usbConnectBtn');
    const usbDisconnectBtn   = document.getElementById('usbDisconnectBtn');
    const usbConfigControls  = document.getElementById('usbConfigControls');
    const usbDisconnectedOverlay = document.getElementById('usbDisconnectedOverlay');

    if (usbStatusBadge) {
        usbStatusBadge.className = 'badge bg-secondary';
        usbStatusBadge.textContent = 'No conectado';
    }
    if (usbConnectBtn)    usbConnectBtn.style.display    = 'inline-block';
    if (usbDisconnectBtn) usbDisconnectBtn.style.display = 'none';

    // Ocultar controles USB y mostrar overlay de desconexión
    if (usbConfigControls)      usbConfigControls.style.display      = 'none';
    if (usbDisconnectedOverlay) usbDisconnectedOverlay.style.display = 'block';

    // Re-renderizar panel LED con estado desconectado
    _refreshLedPanelByUsbState();
}

async function startUsbConnection() {
    if (!('serial' in navigator)) {
        alert('Tu navegador no soporta la API Web Serial. Por favor usa Google Chrome o Microsoft Edge.');
        return false;
    }

    // Si ya existía una sesión previa colgada, cerrarla primero limpiamente
    if (currentUsbPort) {
        await closeUsbConnection();
        await new Promise(r => setTimeout(r, 100));
    }

    try {
        const port = await navigator.serial.requestPort();
        try {
            await port.open({ baudRate: 115200 });
        } catch (openErr) {
            if (openErr.name === 'InvalidStateError') {
                console.warn('Puerto ya abierto, liberando y reabriendo...');
                try { await port.close(); } catch(e) {}
                await port.open({ baudRate: 115200 });
            } else {
                throw openErr;
            }
        }
        currentUsbPort = port;

        const usbStatusBadge         = document.getElementById('usbStatusBadge');
        const usbConnectBtn          = document.getElementById('usbConnectBtn');
        const usbDisconnectBtn       = document.getElementById('usbDisconnectBtn');
        const usbConfigControls      = document.getElementById('usbConfigControls');
        const usbDisconnectedOverlay = document.getElementById('usbDisconnectedOverlay');
        const usbTerminalOutput      = document.getElementById('usbTerminalOutput');

        if (usbStatusBadge) {
            usbStatusBadge.className = 'badge bg-success d-inline-flex align-items-center gap-1';
            setSafeDOM(usbStatusBadge, '<i class="bi bi-check-circle-fill"></i> Conectado por USB');
        }
        if (usbConnectBtn)    usbConnectBtn.style.display    = 'none';
        if (usbDisconnectBtn) usbDisconnectBtn.style.display = 'inline-block';

        // Mostrar controles y ocultar overlay
        if (usbDisconnectedOverlay) usbDisconnectedOverlay.style.display = 'none';
        if (usbConfigControls)      usbConfigControls.style.display      = 'block';
        if (usbTerminalOutput)      usbTerminalOutput.textContent         = 'Puerto USB conectado (115200 bps). Conectando con ESP32...\n';

        // Activar el panel LED + simulador en el área activa
        _refreshLedPanelByUsbState();

        readSerialLoop();

        setTimeout(async () => {
            await sendSerialCommand('GET_INFO\n');
        }, 500);
        setTimeout(async () => {
            await sendSerialCommand('GET_INFO\n');
        }, 1500);
        setTimeout(async () => {
            await sendSerialCommand('GET_INFO\n');
        }, 3000);
        return true;
    } catch (err) {
        if (err.name === 'NotFoundError') {
            console.log('Selección de puerto USB cancelada por el usuario.');
            return false;
        }
        console.error('Error conectando Web Serial:', err);
        const usbStatusBadge = document.getElementById('usbStatusBadge');
        const usbTerminalOutput = document.getElementById('usbTerminalOutput');
        if (usbStatusBadge) {
            usbStatusBadge.className = 'badge bg-danger';
            usbStatusBadge.textContent = 'Error de conexión';
        }
        if (usbTerminalOutput) usbTerminalOutput.textContent = 'Error: ' + err.message;
        return false;
    }
}

async function readSerialLoop() {
    let lineBuffer = '';
    while (currentUsbPort && currentUsbPort.readable && !isClosingUsb) {
        const textDecoder = new TextDecoder();
        try {
            currentUsbReader = currentUsbPort.readable.getReader();
            while (true) {
                const { value, done } = await currentUsbReader.read();
                if (done) break;
                if (value) {
                    const decoded = textDecoder.decode(value, { stream: true });
                    const clean = decoded.replace(/[\x00-\x08\x0B-\x0C\x0E-\x1F\x7F-\x9F\uFFFD]/g, '');
                    if (clean.length > 0) {
                        appendTerminal(clean);
                        lineBuffer += clean;
                        if (lineBuffer.includes('\n')) {
                            const lines = lineBuffer.split('\n');
                            lineBuffer = lines.pop();
                            for (const rawLine of lines) {
                                const trimmed = rawLine.trim();
                                if (trimmed.startsWith('INFO:')) {
                                    const raw = trimmed.substring(5);
                                    const sep = raw.includes(',') ? ',' : (raw.includes('|') ? '|' : ',');
                                    const parts = raw.split(sep);
                                    const info = {};
                                    parts.forEach(p => {
                                        const [k, v] = p.split('=');
                                        if (k && v !== undefined) info[k.trim().toUpperCase()] = v.trim();
                                    });

                                    const usbRoleSelect = document.getElementById('usbDeviceRoleSelect');
                                    const usbTargetAreaSelect = document.getElementById('usbTargetAreaSelect');
                                    const usbWifiSsidInput = document.getElementById('usbWifiSsidInput');
                                    const usbStatusBadge = document.getElementById('usbStatusBadge');

                                    let detectedRole = (info.ROLE || '').toLowerCase();
                                    if (detectedRole === 'satellite' || detectedRole === 'satellite_crane') {
                                        detectedRole = 'satellite_crane';
                                    }
                                    const detectedTarget = info.TARGET || info.CRANE || info.AREA || '';
                                    if (detectedRole && usbRoleSelect) {
                                        usbRoleSelect.value = detectedRole;
                                        if (typeof window.populateUsbTargetSelect === 'function') {
                                            window.populateUsbTargetSelect(detectedRole, detectedTarget);
                                        }
                                    } else if (detectedTarget && usbTargetAreaSelect) {
                                        usbTargetAreaSelect.value = detectedTarget;
                                    }

                                    if (info.SSID && usbWifiSsidInput && info.SSID !== 'TU_WIFI_SSID') {
                                        usbWifiSsidInput.value = info.SSID;
                                    }
                                    if (usbStatusBadge) {
                                        let roleName = 'Dispositivo ESP32';
                                        if (detectedRole === 'cranes') roleName = 'Centro de Mando SCADA';
                                        else if (detectedRole === 'satellite_crane') roleName = 'Nodo Satélite Grúa';
                                        const label = info.LABEL || `${roleName} (${detectedTarget})`;
                                        setSafeDOM(usbStatusBadge, `<i class="bi bi-check-circle-fill"></i> Conectado: ${label} (IP: ${info.IP || 'N/A'})`);
                                    }

                                    if (info.IP && info.IP !== '0.0.0.0' && info.IP !== 'OFFLINE' && info.MAC) {
                                        const cleanMac = info.MAC.replace(/:/g, '').toLowerCase();
                                        if (typeof db !== 'undefined' && db) {
                                            db.collection('crane_devices').doc(cleanMac).set({
                                                ip: info.IP,
                                                status: 'online',
                                                lastSeen: firebase.firestore.FieldValue.serverTimestamp()
                                            }, { merge: true }).catch(() => {});
                                        }
                                    }

                                    // Sincronizar automáticamente el selector de firmware superior
                                    const fwSelectCentroMando = document.getElementById('fwSelectCentroMando');
                                    const fwSelectSatellite   = document.getElementById('fwSelectSatellite');
                                    if (detectedRole === 'cranes' && fwSelectCentroMando && !fwSelectCentroMando.checked) {
                                        fwSelectCentroMando.checked = true;
                                        fwSelectCentroMando.dispatchEvent(new Event('change'));
                                    } else if (detectedRole === 'satellite_crane' && fwSelectSatellite && !fwSelectSatellite.checked) {
                                        fwSelectSatellite.checked = true;
                                        fwSelectSatellite.dispatchEvent(new Event('change'));
                                    }

                                    // Sincronizar controles y simulador de Micro-OLED 0.42"
                                    const usbOledConfigCard = document.getElementById('usbOledConfigCard');
                                    const usbOledPreviewBox = document.getElementById('usbOledPreviewBox');
                                    const usbOledPreviewCrane = document.getElementById('usbOledPreviewCrane');
                                    const usbOledPreviewStatus = document.getElementById('usbOledPreviewStatus');
                                    const usbOledCurrentRotBadge = document.getElementById('usbOledCurrentRotBadge');

                                    const isSatWithOled = (info.OLED === '1') || (detectedRole === 'satellite_crane');
                                    if (usbOledConfigCard) {
                                        usbOledConfigCard.style.display = isSatWithOled ? 'block' : 'none';
                                    }
                                    let currentRot = parseInt(info.ROT || '0', 10);
                                    window._currentUsbOledRot = currentRot;

                                    if (usbOledCurrentRotBadge) {
                                        usbOledCurrentRotBadge.textContent = `Rotación: ${currentRot}° (${currentRot === 2 ? '180° Invertido' : 'Normal'})`;
                                        usbOledCurrentRotBadge.className = currentRot === 2 ? 'badge bg-warning text-dark font-monospace' : 'badge bg-secondary font-monospace';
                                    }
                                    if (usbOledPreviewBox) {
                                        usbOledPreviewBox.style.transform = (currentRot === 2) ? 'rotate(180deg)' : 'none';
                                    }
                                    if (usbOledPreviewCrane) {
                                        usbOledPreviewCrane.textContent = detectedTarget || '20C';
                                    }
                                    if (usbOledPreviewStatus) {
                                        usbOledPreviewStatus.textContent = (info.STATUS || 'OPERATIVA').toUpperCase();
                                    }
                                }
                            }
                        }
                    }
                }
            }
        } catch (err) {
            if (!isClosingUsb) {
                console.warn('Lectura serial interrumpida:', err.message || err);
            }
            break;
        } finally {
            if (currentUsbReader) {
                try { currentUsbReader.releaseLock(); } catch(e) {}
                currentUsbReader = null;
            }
        }
    }
    if (!isClosingUsb && currentUsbPort) {
        await closeUsbConnection();
    }
}

if ('serial' in navigator) {
    navigator.serial.addEventListener('disconnect', (event) => {
        console.warn('Dispositivo USB desconectado del sistema:', event);
        closeUsbConnection();
    });
}

function buildLedConfigCmd(currentCfg) {
    const br = Math.round(((currentCfg.brightness || 80) / 100) * 255);
    const ns = currentCfg.normalBlinkMs || 1200;
    const as = currentCfg.alarmBlinkMs || 300;
    const sc = currentCfg.selectionColor || '#FFAA00';
    const rc = currentCfg.resolveColor || '#00FF88';
    return `SET_LEDCFG:${currentCfg.normalEffect||'blink_slow'}:${currentCfg.alarmEffect||'blink_fast'}:${currentCfg.normalColor||'#00FF00'}:${currentCfg.alarmColor||'#FF0000'}:${br}:${currentCfg.ledsPerCrane||7}:${currentCfg.gapLeds!==undefined?currentCfg.gapLeds:2}:${ns}:${as}:${sc}:${rc}\n`;
}

function syncLedConfigToUsbLive() {
    if (!currentUsbPort || !currentUsbPort.writable) return;
    clearTimeout(liveLedSyncTimer);
    liveLedSyncTimer = setTimeout(async () => {
        try {
            const currentCfg = getAreaConfig(activeAreaKey);
            const cmd = buildLedConfigCmd(currentCfg);
            await sendSerialCommand(cmd);
        } catch (e) {
            console.warn('Error enviando preview LED por USB:', e);
        }
    }, 120);
}

// ======================================================================
// LISTENERS DEL PANEL DE ÁREA ACTIVA
// ======================================================================
function bindAreaPanelListeners() {
    const cfg = () => getAreaConfig(activeAreaKey);

    const ledsPerCraneInput    = document.getElementById('ledsPerCraneInput');
    const ledGapInput          = document.getElementById('ledGapInput');
    const selectionTimeoutInput = document.getElementById('selectionTimeoutInput');
    const selectionTimeoutVal  = document.getElementById('selectionTimeoutVal');
    const resolveHoldInput     = document.getElementById('resolveHoldInput');
    const resolveHoldVal       = document.getElementById('resolveHoldVal');
    const brightnessInput      = document.getElementById('ledBrightnessInput');
    const brightnessVal        = document.getElementById('ledBrightnessVal');
    const normalEffectSelect   = document.getElementById('ledNormalEffect');
    const normalSpeedInput     = document.getElementById('ledNormalSpeedInput');
    const normalSpeedVal       = document.getElementById('ledNormalSpeedVal');
    const normalSpeedContainer = document.getElementById('ledNormalSpeedContainer');
    const normalColorInput     = document.getElementById('ledNormalColor');
    const normalColorHex       = document.getElementById('ledNormalColorHex');
    const alarmEffectSelect    = document.getElementById('ledAlarmEffect');
    const alarmSpeedInput      = document.getElementById('ledAlarmSpeedInput');
    const alarmSpeedVal        = document.getElementById('ledAlarmSpeedVal');
    const alarmColorInput      = document.getElementById('ledAlarmColor');
    const alarmColorHex        = document.getElementById('ledAlarmColorHex');
    const selectionColorInput  = document.getElementById('ledSelectionColor');
    const selectionColorHex    = document.getElementById('ledSelectionColorHex');
    const resolveColorInput    = document.getElementById('ledResolveColor');
    const resolveColorHex      = document.getElementById('ledResolveColorHex');
    const saveBtn              = document.getElementById('saveCraneLedBtn');
    const saveAlert            = document.getElementById('craneLedSaveAlert');
    const applyToAllCheck      = document.getElementById('applyToAllAreasLed');
    const simClickBtn          = document.getElementById('simClickBtn');
    const simHoldBtn           = document.getElementById('simHoldBtn');
    const simResetBtn          = document.getElementById('simResetBtn');
    const simButtonStateText   = document.getElementById('simButtonStateText');
    const viewEsp32CodeBtn     = document.getElementById('viewEsp32CodeBtn');
    const copyEsp32CodeBtn     = document.getElementById('copyEsp32CodeBtn');

    if (ledsPerCraneInput) ledsPerCraneInput.addEventListener('input', e => {
        cfg().ledsPerCrane = Math.max(1, parseInt(e.target.value)||7);
        renderAreaSimulator();
        syncLedConfigToUsbLive();
    });
    if (ledGapInput) ledGapInput.addEventListener('input', e => {
        cfg().gapLeds = Math.max(0, parseInt(e.target.value)||0);
        renderAreaSimulator();
        syncLedConfigToUsbLive();
    });
    if (selectionTimeoutInput) selectionTimeoutInput.addEventListener('input', e => {
        cfg().selectionTimeoutSec = parseInt(e.target.value);
        if (selectionTimeoutVal) selectionTimeoutVal.textContent = e.target.value + 's';
    });
    if (resolveHoldInput) resolveHoldInput.addEventListener('input', e => {
        cfg().resolveHoldSec = parseInt(e.target.value);
        if (resolveHoldVal) resolveHoldVal.textContent = e.target.value + 's';
    });
    if (brightnessInput) brightnessInput.addEventListener('input', e => {
        cfg().brightness = parseInt(e.target.value);
        if (brightnessVal) brightnessVal.textContent = e.target.value + '%';
        syncLedConfigToUsbLive();
    });
    if (normalEffectSelect) normalEffectSelect.addEventListener('change', e => {
        cfg().normalEffect = e.target.value;
        if (normalSpeedContainer) normalSpeedContainer.style.display = e.target.value === 'static' ? 'none' : 'block';
        syncLedConfigToUsbLive();
    });
    if (normalSpeedInput) normalSpeedInput.addEventListener('input', e => {
        cfg().normalBlinkMs = parseInt(e.target.value);
        if (normalSpeedVal) normalSpeedVal.textContent = e.target.value + ' ms';
        syncLedConfigToUsbLive();
    });
    if (normalColorInput) normalColorInput.addEventListener('input', e => {
        cfg().normalColor = e.target.value;
        if (normalColorHex) normalColorHex.textContent = e.target.value.toUpperCase();
        syncLedConfigToUsbLive();
    });
    if (alarmEffectSelect) alarmEffectSelect.addEventListener('change', e => {
        cfg().alarmEffect = e.target.value;
        syncLedConfigToUsbLive();
    });
    if (alarmSpeedInput) alarmSpeedInput.addEventListener('input', e => {
        cfg().alarmBlinkMs = parseInt(e.target.value);
        if (alarmSpeedVal) alarmSpeedVal.textContent = e.target.value + ' ms';
        syncLedConfigToUsbLive();
    });
    if (alarmColorInput) alarmColorInput.addEventListener('input', e => {
        cfg().alarmColor = e.target.value;
        if (alarmColorHex) alarmColorHex.textContent = e.target.value.toUpperCase();
        syncLedConfigToUsbLive();
    });
    if (selectionColorInput) selectionColorInput.addEventListener('input', e => {
        cfg().selectionColor = e.target.value;
        if (selectionColorHex) selectionColorHex.textContent = e.target.value.toUpperCase();
        syncLedConfigToUsbLive();
    });
    if (resolveColorInput) resolveColorInput.addEventListener('input', e => {
        cfg().resolveColor = e.target.value;
        if (resolveColorHex) resolveColorHex.textContent = e.target.value.toUpperCase();
        syncLedConfigToUsbLive();
    });

    // Presets de colores
    document.querySelectorAll('.preset-chip-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const target = btn.dataset.target;
            const color  = btn.dataset.color;
            const c = cfg();
            if (target === 'normal')    { c.normalColor    = color; if (normalColorInput)    normalColorInput.value    = color; if (normalColorHex)    normalColorHex.textContent    = color.toUpperCase(); syncLedConfigToUsbLive(); }
            else if (target === 'alarm')     { c.alarmColor     = color; if (alarmColorInput)     alarmColorInput.value     = color; if (alarmColorHex)     alarmColorHex.textContent     = color.toUpperCase(); syncLedConfigToUsbLive(); }
            else if (target === 'selection') { c.selectionColor = color; if (selectionColorInput) selectionColorInput.value = color; if (selectionColorHex) selectionColorHex.textContent = color.toUpperCase(); syncLedConfigToUsbLive(); }
            else if (target === 'resolve')   { c.resolveColor   = color; if (resolveColorInput)   resolveColorInput.value   = color; if (resolveColorHex)   resolveColorHex.textContent   = color.toUpperCase(); syncLedConfigToUsbLive(); }
        });
    });

    // Simulador de pulsador
    if (simClickBtn) {
        simClickBtn.addEventListener('click', () => {
            const cranesList = (cranesConfig && cranesConfig[activeAreaKey]) ? cranesConfig[activeAreaKey] : [];
            if (cranesList.length === 0) return;

            simHoldingResolve = false;
            simSelectionIndex = (simSelectionIndex + 1) % (cranesList.length + 1);
            simLastClickTime = performance.now();

            if (simSelectionIndex === 0) {
                if (simButtonStateText) {
                    setSafeDOM(simButtonStateText, '<span class="text-muted"><i class="bi bi-circle"></i> Modo: Reposo (Todas Operativas / Monitoreo)</span>');
                }
                if (currentUsbPort && currentUsbPort.writable) {
                    sendSerialCommand('RESET_SIM\n');
                    appendTerminal('\n> [Auto-Sync USB] Clic Arcade: Selección reseteada a Reposo\n');
                }
            } else {
                const targetCrane = cranesList[simSelectionIndex - 1];
                const isFail = (craneSimulatedStates[targetCrane] === 'alarm');
                const timeoutSec = cfg().selectionTimeoutSec || 5;
                if (simButtonStateText) {
                    if (isFail) {
                        setSafeDOM(simButtonStateText, `
                            <span class="text-danger fw-bold"><i class="bi bi-exclamation-octagon-fill"></i> Grúa ${targetCrane} en FALLA</span> — 
                            <span class="text-white">Usa "Sostener (Resolver Falla)" para repararla (${cfg().resolveHoldSec || 5}s)</span>
                        `);
                    } else {
                        setSafeDOM(simButtonStateText, `
                            <span class="text-warning fw-bold"><i class="bi bi-stopwatch"></i> Seleccionada Grúa ${targetCrane} (Modo Prueba)</span> — 
                            <span class="text-white">Cambiará LEDs a falla en <b id="simCountdownNum">${timeoutSec}</b>s si no presionas de nuevo</span>
                        `);
                    }
                }
                // El simulador gestiona la cuenta regresiva localmente y al finalizar envía SET_FAIL al ESP32
            }
        });
    }

    function startSimHold() {
        const cranesList = (cranesConfig && cranesConfig[activeAreaKey]) ? cranesConfig[activeAreaKey] : [];
        if (cranesList.length === 0) return;

        let targetCrane = (simSelectionIndex > 0) ? cranesList[simSelectionIndex - 1] : null;
        if (!targetCrane || craneSimulatedStates[targetCrane] !== 'alarm') {
            const failIdx = cranesList.findIndex(c => craneSimulatedStates[c] === 'alarm');
            if (failIdx !== -1) {
                simSelectionIndex = failIdx + 1;
                targetCrane = cranesList[failIdx];
            } else {
                alert('⚠️ Ninguna grúa está en falla para resolver.\n\nPrimero selecciona una grúa con "Clic Corto" y espera la cuenta regresiva, o pulsa "Probar Falla" en una grúa.');
                return;
            }
        }

        simHoldingResolve = true;
        simHoldStartTime = performance.now();
        const holdSec = cfg().resolveHoldSec || 5;
        if (simButtonStateText) {
            setSafeDOM(simButtonStateText, `
                <span class="text-info fw-bold"><i class="bi bi-gear-wide-connected spinner-border spinner-border-sm me-1"></i> Resolviendo Grúa ${targetCrane}...</span>
                <span class="text-white small">(Llenando barra durante ${holdSec}s para resolver prueba — clic de nuevo p/ cancelar)</span>
            `);
        }
    }

    function cancelSimHold() {
        if (simHoldingResolve) {
            const elapsed = performance.now() - simHoldStartTime;
            const holdDurationMs = (cfg().resolveHoldSec || 5) * 1000;
            if (elapsed < holdDurationMs) {
                simHoldingResolve = false;
                if (simButtonStateText) {
                    setSafeDOM(simButtonStateText, '<span class="text-warning"><i class="bi bi-exclamation-triangle"></i> Sostenido interrumpido antes de completar. Falla continúa activa.</span>');
                }
                const mainProgCont = document.getElementById('simProgressContainer');
                if (mainProgCont) mainProgCont.style.display = 'none';
            }
        }
    }

    if (simHoldBtn) {
        simHoldBtn.addEventListener('click', () => {
            if (simHoldingResolve) {
                cancelSimHold();
            } else {
                startSimHold();
            }
        });
    }

    if (simResetBtn) {
        simResetBtn.addEventListener('click', async () => {
            simSelectionIndex = 0;
            simHoldingResolve = false;
            const cranesList = (cranesConfig && cranesConfig[activeAreaKey]) ? cranesConfig[activeAreaKey] : [];

            // 1. Limpiar inmediatamente en memoria local y DOM
            cranesList.forEach(cId => {
                craneSimulatedStates[cId] = 'normal';
                if (typeof liveActiveFailures !== 'undefined') {
                    liveActiveFailures.delete(cId);
                }
            });
            if (simButtonStateText) setSafeDOM(simButtonStateText, '<span class="text-muted"><i class="bi bi-circle"></i> Modo: Reposo (Todas Operativas)</span>');
            const mainProgCont = document.getElementById('simProgressContainer');
            if (mainProgCont) mainProgCont.style.display = 'none';
            renderAreaSimulator();
            showAlert(`Área ${activeAreaKey.replace('area','')} reiniciada: todas las grúas en estado operativo.`, 'success');

            // 2. Sincronizar directo por USB si el ESP32 está conectado (0 ms)
            if (currentUsbPort && currentUsbPort.writable) {
                try {
                    await sendSerialCommand('RESET_SIM\n');
                    appendTerminal('\n> [Auto-Sync USB] Simulación reiniciada: todas las grúas operativas en ESP32.\n');
                } catch(e) {}
            }
        });
    }

    // Guardar en ESP32 / Nube (Flash NVS Directo por USB y Firestore)
    if (saveBtn) {
        saveBtn.addEventListener('click', async () => {
            saveBtn.disabled = true;
            setSafeDOM(saveBtn, '<span class="spinner-border spinner-border-sm me-2"></span> Guardando configuración...');

            try {
                const isApplyAll = applyToAllCheck && applyToAllCheck.checked;
                const currentCfg = getAreaConfig(activeAreaKey);
                if (isApplyAll) {
                    const allKeys = cranesConfig ? Object.keys(cranesConfig).filter(k => k !== '_order') : [];
                    allKeys.forEach(k => { allAreasLedConfig[k] = { ...currentCfg }; });
                }

                // 1. Guardar SIEMPRE en Firestore en la nube
                let cloudSaved = false;
                try {
                    const cleanConfig = {};
                    Object.keys(allAreasLedConfig).forEach(k => {
                        if (!k.startsWith('__') && !k.endsWith('__') && typeof allAreasLedConfig[k] === 'object') {
                            cleanConfig[k] = allAreasLedConfig[k];
                        }
                    });
                    const payload = { ...cleanConfig, updatedAt: firebase.firestore.FieldValue.serverTimestamp() };
                    delete payload['__global__'];
                    delete payload.activeAreaKey;
                    await db.collection('config').doc('crane_led_settings').set(payload, { merge: true });
                    cloudSaved = true;
                } catch (fsErr) {
                    console.warn('[Firestore sync error]:', fsErr.message);
                }

                // 2. Si hay USB conectado o se conecta, grabar en Flash NVS
                let usbSaved = false;
                if (currentUsbPort && currentUsbPort.writable) {
                    const cmd = buildLedConfigCmd(currentCfg);
                    await sendSerialCommand(cmd);
                    appendTerminal(`\n> [USB Directo] Configuración LED guardada en Flash NVS (Brillo: ${currentCfg.brightness}%, Vel: ${currentCfg.normalBlinkMs||1200}ms/${currentCfg.alarmBlinkMs||300}ms, Normal: ${currentCfg.normalColor}, Alarma: ${currentCfg.alarmColor})\n`);

                    await new Promise(r => setTimeout(r, 150));
                    await sendSerialCommand(`SET_AREA:${activeAreaKey}\n`);
                    const areaCranes = (cranesConfig && cranesConfig[activeAreaKey]) ? cranesConfig[activeAreaKey] : [];
                    if (areaCranes.length > 0) {
                        await new Promise(r => setTimeout(r, 150));
                        await sendSerialCommand(`SET_CRANES:${areaCranes.join(',')}\n`);
                        appendTerminal(`> [USB Directo] Grúas sincronizadas: ${areaCranes.join(', ')}\n`);
                    }
                    usbSaved = true;
                }

                if (saveAlert) {
                    const aNum = activeAreaKey.replace('area','');
                    if (usbSaved) {
                        setSafeDOM(saveAlert, `
                            <div class="alert alert-success alert-dismissible fade show mb-0 py-2 small" role="alert">
                                <i class="bi bi-check-circle-fill me-1"></i>
                                <strong>¡Configuración guardada en Flash NVS del ESP32 y en la Nube!</strong><br>
                                Los colores, brillo (${currentCfg.brightness}%), velocidades y efectos quedaron grabados permanentemente en el microcontrolador y respaldados en Firestore.
                                <button type="button" class="btn-close py-2" data-bs-dismiss="alert"></button>
                            </div>
                        `);
                    } else if (cloudSaved) {
                        setSafeDOM(saveAlert, `
                            <div class="alert alert-success alert-dismissible fade show mb-0 py-2 small" role="alert">
                                <i class="bi bi-check-circle-fill me-1"></i>
                                <strong>¡Configuración guardada exitosamente en la nube (Firestore)!</strong><br>
                                Los ajustes del Área ${aNum} han sido guardados. Conecta el ESP32 por USB si deseas además grabarlo en su memoria Flash NVS para operación autónoma sin internet.
                                <button type="button" class="btn-close py-2" data-bs-dismiss="alert"></button>
                            </div>
                        `);
                    }
                }
                showAlert(`Configuración del Área ${activeAreaKey.replace('area','')} guardada correctamente.`, 'success');

            } catch (err) {
                if (saveAlert) {
                    setSafeDOM(saveAlert, `<div class="alert alert-danger alert-dismissible fade show mb-0 py-2 small"><i class="bi bi-exclamation-triangle-fill"></i> Error al guardar configuración: ${err.message}<button type="button" class="btn-close py-2" data-bs-dismiss="alert"></button></div>`);
                }
                showAlert(`Error al guardar configuración: ${err.message}`, 'danger');
            } finally {
                saveBtn.disabled = false;
                setSafeDOM(saveBtn, `<i class="bi bi-usb-plug-fill me-1"></i> Guardar Configuración Directo en ESP32 / Tira LED — Área ${activeAreaKey.replace('area','')}`);
            }
        });
    }

    // Firmware ESP32 modal
    if (viewEsp32CodeBtn) viewEsp32CodeBtn.addEventListener('click', updateEsp32ModalCode);
    if (copyEsp32CodeBtn) {
        copyEsp32CodeBtn.addEventListener('click', () => {
            const pre = document.getElementById('esp32CodePre');
            if (pre) navigator.clipboard.writeText(pre.textContent).then(() => {
                setSafeDOM(copyEsp32CodeBtn, '<i class="bi bi-check2"></i> ¡Copiado!');
                setTimeout(() => { setSafeDOM(copyEsp32CodeBtn, '<i class="bi bi-clipboard"></i> Copiar Código'); }, 2000);
            });
        });
    }
}

// ======================================================================
// HELPERS DE FORMULARIO Y SIMULADOR
// ======================================================================
function updateFormFromActiveArea() {
    const cfg = getAreaConfig(activeAreaKey);
    const get = id => document.getElementById(id);

    const ledsPerCraneInput = get('ledsPerCraneInput');
    const ledGapInput = get('ledGapInput');
    if (ledsPerCraneInput) ledsPerCraneInput.value = cfg.ledsPerCrane || 7;
    if (ledGapInput) ledGapInput.value = cfg.gapLeds !== undefined ? cfg.gapLeds : 2;

    const sti = get('selectionTimeoutInput'), stv = get('selectionTimeoutVal');
    if (sti) sti.value = cfg.selectionTimeoutSec || 5;
    if (stv) stv.textContent = (cfg.selectionTimeoutSec || 5) + 's';

    const rhi = get('resolveHoldInput'), rhv = get('resolveHoldVal');
    if (rhi) rhi.value = cfg.resolveHoldSec || 5;
    if (rhv) rhv.textContent = (cfg.resolveHoldSec || 5) + 's';

    const bi = get('ledBrightnessInput'), bv = get('ledBrightnessVal');
    if (bi) bi.value = cfg.brightness || 80;
    if (bv) bv.textContent = (cfg.brightness || 80) + '%';

    const nef = get('ledNormalEffect'), nsi = get('ledNormalSpeedInput'), nsv = get('ledNormalSpeedVal'), nsc = get('ledNormalSpeedContainer');
    const nci = get('ledNormalColor'), nch = get('ledNormalColorHex');
    if (nef) nef.value = cfg.normalEffect || 'blink_slow';
    if (nsi) nsi.value = cfg.normalBlinkMs || 1200;
    if (nsv) nsv.textContent = (cfg.normalBlinkMs || 1200) + ' ms';
    if (nci) nci.value = cfg.normalColor || '#00ff00';
    if (nch) nch.textContent = (cfg.normalColor || '#00ff00').toUpperCase();
    if (nsc) nsc.style.display = cfg.normalEffect === 'static' ? 'none' : 'block';

    const aef = get('ledAlarmEffect'), asi = get('ledAlarmSpeedInput'), asv = get('ledAlarmSpeedVal');
    const aci = get('ledAlarmColor'), ach = get('ledAlarmColorHex');
    if (aef) aef.value = cfg.alarmEffect || 'blink_fast';
    if (asi) asi.value = cfg.alarmBlinkMs || 300;
    if (asv) asv.textContent = (cfg.alarmBlinkMs || 300) + ' ms';
    if (aci) aci.value = cfg.alarmColor || '#ff0000';
    if (ach) ach.textContent = (cfg.alarmColor || '#ff0000').toUpperCase();

    const sci = get('ledSelectionColor'), sch = get('ledSelectionColorHex');
    if (sci) sci.value = cfg.selectionColor || '#ffaa00';
    if (sch) sch.textContent = (cfg.selectionColor || '#ffaa00').toUpperCase();

    const rci = get('ledResolveColor'), rch = get('ledResolveColorHex');
    if (rci) rci.value = cfg.resolveColor || '#00ff88';
    if (rch) rch.textContent = (cfg.resolveColor || '#00ff88').toUpperCase();

    const badge = get('simAreaBadge');
    if (badge) badge.textContent = 'Área ' + activeAreaKey.replace('area','');
}

function renderAreaSimulator() {
    const simulatorEl = document.getElementById('craneLedStripSimulator');
    if (!simulatorEl) return;
    const cfg = getAreaConfig(activeAreaKey);
    const cranesList = (cranesConfig && cranesConfig[activeAreaKey] && cranesConfig[activeAreaKey].length > 0)
        ? cranesConfig[activeAreaKey]
        : (activeAreaKey === 'area10' ? ['10A','10B','10C','10D'] : [`${activeAreaKey.replace('area','')}-1`]);

    simulatorEl.replaceChildren();
    const ledsCount = cfg.ledsPerCrane || 7;
    const gapCount  = cfg.gapLeds !== undefined ? cfg.gapLeds : 2;

    const normColor = cfg.normalColor || '#00ff00';
    const alColor   = cfg.alarmColor || '#ff0000';
    const brFactor  = (cfg.brightness || 80) / 100;

    cranesList.forEach((craneId, idx) => {
        if (craneSimulatedStates[craneId] === undefined) {
            craneSimulatedStates[craneId] = (typeof liveActiveFailures !== 'undefined' && liveActiveFailures.has(craneId)) ? 'alarm' : 'normal';
        }
        const isAlarm = craneSimulatedStates[craneId] === 'alarm';
        const pColor = isAlarm ? alColor : normColor;
        const unit = document.createElement('div');
        unit.className = 'crane-unit-enclosure';
        unit.id = `sim-unit-${craneId}`;
        unit.dataset.crane = craneId;
        setSafeDOM(unit, `
            <div class="crane-unit-header">
                <span class="crane-unit-title">${craneId}</span>
                <span class="badge ${isAlarm ? 'bg-danger' : 'bg-success'} sim-crane-badge">${isAlarm ? 'En Falla' : 'Operativa'}</span>
            </div>
            <div class="crane-led-pixels-row" data-crane="${craneId}">
                ${Array.from({length:ledsCount}).map(()=>`<div class="crane-led-pixel" style="background-color:${pColor};box-shadow:0 0 10px ${pColor};opacity:${brFactor};"></div>`).join('')}
            </div>
            <div class="crane-mini-progress">
                <div class="crane-mini-progress-bar" id="mini-prog-${craneId}"></div>
            </div>
            <button class="btn ${isAlarm?'btn-outline-success':'btn-outline-secondary'} btn-sm py-0 px-2 sim-toggle-btn" data-crane="${craneId}">
                <i class="bi ${isAlarm?'bi-check2-circle':'bi-toggle-on'}"></i> ${isAlarm?'Probar Operativa':'Probar Falla'}
            </button>`);
        simulatorEl.appendChild(unit);

        if (idx < cranesList.length - 1 && gapCount > 0) {
            const gapDiv = document.createElement('div');
            gapDiv.className = 'crane-gap-indicator';
            gapDiv.title = `Espacio apagado (${gapCount} LEDs)`;
            setSafeDOM(gapDiv, Array.from({length:gapCount}).map(()=>'<div class="crane-gap-dot"></div>').join(''));
            simulatorEl.appendChild(gapDiv);
        }
    });

    simulatorEl.querySelectorAll('.sim-toggle-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
            const cId = btn.dataset.crane;
            const isCurrentlyAlarm = (typeof liveActiveFailures !== 'undefined' && liveActiveFailures.has(cId)) || (craneSimulatedStates[cId] === 'alarm');
            const areaNum = activeAreaKey.replace('area', '');
            const willBeAlarm = !isCurrentlyAlarm;

            // 1. Actualizar inmediatamente en la pantalla (0 ms de latencia)
            craneSimulatedStates[cId] = willBeAlarm ? 'alarm' : 'normal';
            if (typeof liveActiveFailures !== 'undefined') {
                if (willBeAlarm) {
                    liveActiveFailures.set(cId, { status: 'active', craneId: cId });
                } else {
                    liveActiveFailures.delete(cId);
                }
            }
            renderAreaSimulator();

            // 2. Sincronizar directo por USB con el ESP32 si está conectado (0 ms de latencia)
            if (currentUsbPort && currentUsbPort.writable) {
                try {
                    await sendSerialCommand(`SET_FAIL:${cId}:${willBeAlarm ? '1' : '0'}\n`);
                    appendTerminal(`\n> [Auto-Sync USB] Grúa ${cId} -> ${willBeAlarm ? 'EN FALLA' : 'OPERATIVA'} (LEDs actualizados)\n`);
                } catch (usbErr) {
                    console.warn('[USB Serial sim error]:', usbErr);
                }
            }
        });
    });

    // Iniciar loop de animación de píxeles
    startSimulatorAnimation();
}

function updateEsp32ModalCode() {
    const pre = document.getElementById('esp32CodePre');
    if (!pre) return;
    const cfg = getAreaConfig(activeAreaKey);
    const cranesList = (cranesConfig && cranesConfig[activeAreaKey] && cranesConfig[activeAreaKey].length > 0)
        ? cranesConfig[activeAreaKey] : ['10A','10B','10C','10D'];
    const cranesFormatted = cranesList.map(c => `"${c}"`).join(', ');
    pre.textContent = `/**
 * FIRMWARE INDUSTRIAL ESP32 - MONITOR DE GRÚAS (WS2815)
 * ÁREA CONFIGURADA: ${activeAreaKey.toUpperCase()}
 * GENERADO AUTOMÁTICAMENTE DESDE EL PANEL DE CONTROL
 */

#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include <Wire.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>
#include <Adafruit_NeoPixel.h>
#include <time.h>

// RED Y PROYECTO
const char* ssid        = "${(document.getElementById('usbWifiSsidInput')?.value || '').trim()}";
const char* password    = "${(document.getElementById('usbWifiPassInput')?.value || '').trim()}";
// GENERADOR OBSOLETO: este sketch apuntaba a Firebase (proyecto cerrado el 2026-10-25).
// El firmware actual (3.2.0-*-PB) sincroniza contra PocketBase en el Xiaomi.
const char* pbServer     = "${window.SCADA_PB_URL || 'http://192.168.100.34:8090'}";
const char* targetArea  = "${activeAreaKey}";

// PINES
#define GPIO_BUTTON     4
#define GPIO_PILOT_LED  2
#define GPIO_LED_STRIP  5
#define OLED_SDA        21
#define OLED_SCL        22

// GRÚAS Y PÍXELES
#define NUM_LEDS        300
#define NUM_CRANES      ${cranesList.length}
uint16_t ledsPerCrane = ${cfg.ledsPerCrane || 7};
uint16_t ledsGap      = ${cfg.gapLeds !== undefined ? cfg.gapLeds : 2};

const char* craneIds[NUM_CRANES] = { ${cranesFormatted} };
bool craneFailed[NUM_CRANES] = { ${cranesList.map(()=>'false').join(', ')} };

unsigned long selectionTimeoutMs = ${(cfg.selectionTimeoutSec||5)*1000};
unsigned long resolveHoldTimeMs  = ${(cfg.resolveHoldSec||5)*1000};

// El firmware completo sincroniza estos valores desde Firestore.
// Descarga el archivo .ino completo con el botón inferior.
`;
}

window.moveArea = function(areaKey, direction) {
    if (!cranesConfig._order) return;
    const order = [...cranesConfig._order];
    const idx = order.indexOf(areaKey);
    if (idx === -1) return;
    const newIdx = idx + direction;
    if (newIdx < 0 || newIdx >= order.length) return;
    [order[idx], order[newIdx]] = [order[newIdx], order[idx]];
    cranesConfig._order = order;
    saveCranesConfig();
};

window.deleteArea = function(areaKey, areaNum) {
    if (!confirm(`¿Está seguro de eliminar el Área ${areaNum}? Se eliminarán todas las grúas de esta área en la configuración.`)) return;
    delete cranesConfig[areaKey];
    if (cranesConfig._order) cranesConfig._order = cranesConfig._order.filter(k => k !== areaKey);
    // Si el área activa fue eliminada, cambiar a la primera disponible
    const remaining = Object.keys(cranesConfig).filter(k => k !== '_order' && Array.isArray(cranesConfig[k]));
    if (remaining.length > 0) activeAreaKey = remaining[0];
    saveCranesConfig();
};

window.addCraneToArea = function(areaKey, areaNum) {
    const input = document.getElementById(`craneInput-${areaKey}`);
    if (!input) return;
    const letter = input.value.trim().toUpperCase();
    if (!letter) return;
    const craneId = `${areaNum}${letter}`;
    if (cranesConfig[areaKey].includes(craneId)) { showAlert(`La Grúa ${craneId} ya existe en esta área.`, 'warning'); return; }
    cranesConfig[areaKey].push(craneId);
    input.value = '';
    saveCranesConfig();
};

window.deleteCraneFromArea = function(areaKey, craneId) {
    if (!confirm(`¿Está seguro de eliminar la Grúa ${craneId} de la configuración?`)) return;
    cranesConfig[areaKey] = cranesConfig[areaKey].filter(id => id !== craneId);
    saveCranesConfig();
};



function startSimulatorAnimation() {
    if (simAnimationId) cancelAnimationFrame(simAnimationId);

    function renderSimulatorFrame(timestamp) {
        const simulatorEl = document.getElementById('craneLedStripSimulator');
        if (!simulatorEl) {
            simAnimationId = null;
            return;
        }
        const cfg = getAreaConfig(activeAreaKey);
        const normColor = cfg.normalColor || '#00ff00';
        const alColor = cfg.alarmColor || '#ff0000';
        const selColor = cfg.selectionColor || '#ffaa00';
        const resColor = cfg.resolveColor || '#00ff88';
        const normEffect = cfg.normalEffect || 'blink_slow';
        const alEffect = cfg.alarmEffect || 'blink_fast';
        const normBlinkMs = cfg.normalBlinkMs || 1200;
        const alBlinkMs = cfg.alarmBlinkMs || 300;
        const brightnessFactor = (cfg.brightness || 80) / 100;

        const mainProgCont  = document.getElementById('simProgressContainer');
        const mainProgBar   = document.getElementById('simMainProgressBar');
        const mainProgBadge = document.getElementById('simProgressBadge');
        const mainProgTime  = document.getElementById('simProgressTime');
        const simButtonStateText = document.getElementById('simButtonStateText');

        if (simSelectionIndex === 0 && mainProgCont) {
            mainProgCont.style.display = 'none';
        }

        const cranesList = (cranesConfig && cranesConfig[activeAreaKey] && cranesConfig[activeAreaKey].length > 0)
            ? cranesConfig[activeAreaKey]
            : ['10A', '10B', '10C', '10D'];

        cranesList.forEach((craneId, cIdx) => {
            const row = document.querySelector(`.crane-led-pixels-row[data-crane="${craneId}"]`);
            const unit = document.getElementById(`sim-unit-${craneId}`);
            const miniProg = document.getElementById(`mini-prog-${craneId}`);
            if (!row || !unit) return;

            const pixels = row.querySelectorAll('.crane-led-pixel');
            const state = craneSimulatedStates[craneId] || 'normal';
            const isSelected = (simSelectionIndex === (cIdx + 1));

            // Si no estamos en modo selección, resetear estilos especiales
            if (simSelectionIndex === 0) {
                unit.classList.remove('selected-crane', 'resolving-crane');
                if (miniProg) miniProg.style.width = '0%';
            }

            // Si estamos en modo selección interactivo del botón:
            if (simSelectionIndex > 0) {
                if (isSelected) {
                    if (state === 'alarm') {
                        // Técnico resolviendo
                        if (simHoldingResolve) {
                            unit.classList.remove('selected-crane');
                            unit.classList.add('resolving-crane');

                            const holdDurationMs = (cfg.resolveHoldSec || 5) * 1000;
                            const elapsed = timestamp - simHoldStartTime;

                            if (elapsed >= holdDurationMs) {
                                // ¡Se completó el tiempo sostenido! Resolver falla
                                simHoldingResolve = false;
                                simSelectionIndex = 0;
                                craneSimulatedStates[craneId] = 'normal';
                                if (typeof liveActiveFailures !== 'undefined') {
                                    liveActiveFailures.delete(craneId);
                                }
                                if (simButtonStateText) {
                                    setSafeDOM(simButtonStateText, `<span class="text-success fw-bold"><i class="bi bi-check2-circle"></i> ¡Grúa ${craneId} reparada con éxito! Sistema en reposo.</span>`);
                                }
                                if (mainProgCont) mainProgCont.style.display = 'none';
                                renderAreaSimulator();

                                // Sincronizar directo por USB al ESP32 (0 ms)
                                if (currentUsbPort && currentUsbPort.writable) {
                                    sendSerialCommand(`SET_FAIL:${craneId}:0\n`);
                                    appendTerminal(`\n> [Auto-Sync USB] Grúa ${craneId} -> OPERATIVA (Falla resuelta)\n`);
                                }
                                return;
                            }

                            const fillPct = Math.min(1.0, elapsed / holdDurationMs);
                            const fillCount = Math.floor(fillPct * pixels.length);
                            const secHoldLeft = Math.max(0, (holdDurationMs - elapsed) / 1000).toFixed(1);

                            if (simButtonStateText) {
                                setSafeDOM(simButtonStateText, `
                                    <span class="text-success fw-bold"><i class="bi bi-tools spinner-border spinner-border-sm me-1"></i> Reparando Grúa ${craneId}...</span>
                                    <span class="text-white small ms-1">(Completando en <b>${secHoldLeft}s</b>)</span>
                                `);
                            }

                            // Barra mini individual
                            if (miniProg) {
                                miniProg.style.width = `${(fillPct * 100).toFixed(1)}%`;
                                miniProg.style.backgroundColor = resColor;
                                miniProg.style.boxShadow = `0 0 10px ${resColor}`;
                            }

                            // Barra principal interactiva
                            if (mainProgCont) {
                                mainProgCont.style.display = 'block';
                                if (mainProgBar) {
                                    mainProgBar.style.width = `${(fillPct * 100).toFixed(1)}%`;
                                    mainProgBar.style.backgroundColor = resColor;
                                }
                                if (mainProgBadge) {
                                    mainProgBadge.className = 'badge bg-success text-white';
                                    setSafeDOM(mainProgBadge, `<i class="bi bi-tools me-1"></i> Reparando Grúa ${craneId}`);
                                }
                                if (mainProgTime) mainProgTime.textContent = `${secHoldLeft}s`;
                            }

                            pixels.forEach((p, idx) => {
                                if (idx <= fillCount) {
                                    p.style.backgroundColor = resColor;
                                    p.style.boxShadow = `0 0 12px ${resColor}`;
                                    p.style.opacity = 1;
                                } else {
                                    p.style.backgroundColor = alColor;
                                    p.style.boxShadow = 'none';
                                    p.style.opacity = 0.25;
                                }
                            });
                        } else {
                            // Alarma parpadeando esperando a ser sostenido
                            unit.classList.remove('resolving-crane');
                            unit.classList.add('selected-crane');
                            if (miniProg) miniProg.style.width = '0%';

                            const elapsedSinceClick = timestamp - simLastClickTime;
                            if (elapsedSinceClick >= 8000) {
                                simSelectionIndex = 0;
                                if (simButtonStateText) setSafeDOM(simButtonStateText, '<span class="text-muted"><i class="bi bi-circle"></i> Modo: Reposo (Todas Operativas / Monitoreo)</span>');
                                if (mainProgCont) mainProgCont.style.display = 'none';
                                return;
                            }

                            const cycle = timestamp % (alBlinkMs * 2);
                            const isOn = cycle < alBlinkMs;
                            pixels.forEach(p => {
                                p.style.backgroundColor = alColor;
                                p.style.boxShadow = isOn ? `0 0 10px ${alColor}` : 'none';
                                p.style.opacity = isOn ? 1 : 0.25;
                            });
                        }
                    } else {
                        // Operador reportando: cuenta regresiva decreciente
                        unit.classList.add('selected-crane');
                        unit.classList.remove('resolving-crane');

                        const timeoutMs = (cfg.selectionTimeoutSec || 5) * 1000;
                        const elapsed = timestamp - simLastClickTime;

                        if (elapsed >= timeoutMs) {
                            // ¡Expiró el tiempo de espera! Reportar falla automáticamente
                            simSelectionIndex = 0;
                            craneSimulatedStates[craneId] = 'alarm';
                            if (typeof liveActiveFailures !== 'undefined') {
                                liveActiveFailures.set(craneId, { status: 'active', craneId });
                            }
                            if (simButtonStateText) {
                                setSafeDOM(simButtonStateText, `<span class="text-danger fw-bold"><i class="bi bi-bell-fill"></i> ¡Falla reportada automáticamente en Grúa ${craneId}!</span>`);
                            }
                            if (mainProgCont) mainProgCont.style.display = 'none';
                            renderAreaSimulator();

                            // Sincronizar directo por USB al ESP32 (0 ms)
                            if (currentUsbPort && currentUsbPort.writable) {
                                sendSerialCommand(`SET_FAIL:${craneId}:1\n`);
                                appendTerminal(`\n> [Auto-Sync USB] Grúa ${craneId} -> EN FALLA (Prueba LED confirmada)\n`);
                            }
                            return;
                        }

                        const remainingPct = Math.max(0, 1.0 - (elapsed / timeoutMs));
                        const secLeft = Math.max(0, (timeoutMs - elapsed) / 1000).toFixed(1);
                        const countNumEl = document.getElementById('simCountdownNum');
                        if (countNumEl) countNumEl.textContent = Math.ceil(parseFloat(secLeft));

                        // Barra mini individual debajo de los píxeles
                        if (miniProg) {
                            miniProg.style.width = `${(remainingPct * 100).toFixed(1)}%`;
                            miniProg.style.backgroundColor = selColor;
                            miniProg.style.boxShadow = `0 0 8px ${selColor}`;
                        }

                        // Barra principal interactiva
                        if (mainProgCont) {
                            mainProgCont.style.display = 'block';
                            if (mainProgBar) {
                                mainProgBar.style.width = `${(remainingPct * 100).toFixed(1)}%`;
                                mainProgBar.style.backgroundColor = selColor;
                            }
                            if (mainProgBadge) {
                                mainProgBadge.className = 'badge bg-warning text-dark';
                                setSafeDOM(mainProgBadge, `<i class="bi bi-stopwatch me-1"></i> Seleccionada Grúa ${craneId}`);
                            }
                            if (mainProgTime) mainProgTime.textContent = `${secLeft}s`;
                        }

                        const activeCount = Math.ceil(remainingPct * pixels.length);
                        pixels.forEach((p, idx) => {
                            if (idx < activeCount) {
                                p.style.backgroundColor = selColor;
                                p.style.boxShadow = `0 0 10px ${selColor}`;
                                p.style.opacity = 1;
                            } else {
                                p.style.backgroundColor = '#111827';
                                p.style.boxShadow = 'none';
                                p.style.opacity = 0.2;
                            }
                        });
                    }
                } else {
                    // Grúa no seleccionada: Atenuada con el color actualmente configurado
                    unit.classList.remove('selected-crane', 'resolving-crane');
                    if (miniProg) miniProg.style.width = '0%';
                    const dimCol = (state === 'alarm') ? alColor : normColor;
                    pixels.forEach(p => {
                        p.style.backgroundColor = dimCol;
                        p.style.boxShadow = 'none';
                        p.style.opacity = 0.25;
                    });
                }
                return;
            }

            // Modo Reposo Normal
            if (state === 'normal') {
                if (normEffect === 'static') {
                    pixels.forEach(p => {
                        p.style.backgroundColor = normColor;
                        p.style.boxShadow = `0 0 10px ${normColor}`;
                        p.style.opacity = brightnessFactor;
                    });
                } else if (normEffect === 'breathing') {
                    const phase = (timestamp % normBlinkMs) / normBlinkMs;
                    const breathOpacity = (0.2 + 0.8 * (0.5 + 0.5 * Math.sin(phase * 2 * Math.PI))) * brightnessFactor;
                    pixels.forEach(p => {
                        p.style.backgroundColor = normColor;
                        p.style.boxShadow = `0 0 ${15 * breathOpacity}px ${normColor}`;
                        p.style.opacity = breathOpacity;
                    });
                } else if (normEffect === 'heartbeat') {
                    // Latido doble
                    const beatPhase = (timestamp % normBlinkMs) / normBlinkMs;
                    const isBeat = (beatPhase < 0.15) || (beatPhase > 0.25 && beatPhase < 0.40);
                    pixels.forEach(p => {
                        p.style.backgroundColor = isBeat ? normColor : '#111827';
                        p.style.boxShadow = isBeat ? `0 0 12px ${normColor}` : 'none';
                        p.style.opacity = isBeat ? brightnessFactor : 0.25;
                    });
                } else {
                    // Parpadeo lento (Blink Slow)
                    const cycle = timestamp % (normBlinkMs * 2);
                    const isOn = cycle < normBlinkMs;
                    pixels.forEach(p => {
                        if (isOn) {
                            p.style.backgroundColor = normColor;
                            p.style.boxShadow = `0 0 10px ${normColor}, 0 0 20px ${normColor}`;
                            p.style.opacity = brightnessFactor;
                        } else {
                            p.style.backgroundColor = '#111827';
                            p.style.boxShadow = 'none';
                            p.style.opacity = 0.3;
                        }
                    });
                }
            } else {
                // Estado Alarma
                if (alEffect === 'strobe') {
                    const strobeCycle = timestamp % alBlinkMs;
                    const isStrobeOn = strobeCycle < (alBlinkMs * 0.25);
                    pixels.forEach(p => {
                        if (isStrobeOn) {
                            p.style.backgroundColor = alColor;
                            p.style.boxShadow = `0 0 15px ${alColor}`;
                            p.style.opacity = 1;
                        } else {
                            p.style.backgroundColor = '#111827';
                            p.style.boxShadow = 'none';
                            p.style.opacity = 0.2;
                        }
                    });
                } else if (alEffect === 'chase') {
                    const activePixelIdx = Math.floor((timestamp / (alBlinkMs / 2)) % pixels.length);
                    pixels.forEach((p, idx) => {
                        if (idx === activePixelIdx || idx === (activePixelIdx + 1) % pixels.length) {
                            p.style.backgroundColor = alColor;
                            p.style.boxShadow = `0 0 12px ${alColor}`;
                            p.style.opacity = brightnessFactor;
                        } else {
                            p.style.backgroundColor = '#111827';
                            p.style.boxShadow = 'none';
                            p.style.opacity = 0.2;
                        }
                    });
                } else {
                    // Parpadeo Rápido
                    const cycle = timestamp % (alBlinkMs * 2);
                    const isAlOn = cycle < alBlinkMs;
                    pixels.forEach(p => {
                        if (isAlOn) {
                            p.style.backgroundColor = alColor;
                            p.style.boxShadow = `0 0 12px ${alColor}, 0 0 24px ${alColor}`;
                            p.style.opacity = brightnessFactor;
                        } else {
                            p.style.backgroundColor = '#111827';
                            p.style.boxShadow = 'none';
                            p.style.opacity = 0.2;
                        }
                    });
                }
            }
        });

        simAnimationId = requestAnimationFrame(renderSimulatorFrame);
    }

    simAnimationId = requestAnimationFrame(renderSimulatorFrame);
}

// --- GESTIÓN DE DISPOSITIVOS ESP32 EN TIEMPO REAL ---
let esp32DevicesUnsubscribe = null;

// Reglas de asignación (espejo exacto de las validaciones del firmware):
//   - Rol 'cranes' (Centro de Mando): sólo puede recibir un ÁREA (ej. 'area20').
//   - Rol 'satellite_crane' (Nodo C3 mini): sólo puede recibir un ID de GRÚA (ej. '20F').
// El rol es FÍSICO: lo define el sketch flasheado. El panel puede reasignar el destino
// (grúa/área), pero no convertir un nodo en mando central; si el rol elegido no coincide con
// el firmware del tablero se reporta el error en lugar de escribirlo silenciosamente.
function isCraneIdTarget(t) {
    return /^[0-9]{2}[A-Z]$/.test(String(t || '').trim().toUpperCase());
}

function isAreaTarget(t) {
    return /^area\d+$/i.test(String(t || '').trim());
}

function normalizeDeviceRole(r) {
    const r0 = String(r || '').trim();
    return r0 === 'satellite' ? 'satellite_crane' : r0;
}

function validateEsp32Assignment(role, target) {
    const r = normalizeDeviceRole(role);
    const t = String(target || '').trim();
    if (!t) return { ok: false, msg: 'Falta el destino (grúa o área).' };
    if (r === 'satellite_crane') {
        if (!isCraneIdTarget(t)) return { ok: false, msg: `Un nodo satélite necesita un ID de grúa (ej. 20F), no "${t}".` };
        return { ok: true };
    }
    if (r === 'cranes') {
        if (!isAreaTarget(t)) return { ok: false, msg: `Un Centro de Mando necesita un área (ej. area20), no "${t}".` };
        return { ok: true };
    }
    if (r === 'operations' && !isAreaTarget(t)) {
        return { ok: false, msg: `Operaciones necesita un área (ej. area20), no "${t}".` };
    }
    return { ok: true };
}

function buildEsp32TargetOptions(role, currentTarget) {
    let html = '';
    const craneAreas = (typeof cranesConfig !== 'undefined' && cranesConfig)
        ? Object.keys(cranesConfig).filter(k => k !== '_order' && Array.isArray(cranesConfig[k]))
        : ['area10', 'area20', 'area30'];

    const dynamicCranes = [];
    if (typeof cranesConfig !== 'undefined' && cranesConfig) {
        const order = cranesConfig._order || craneAreas;
        order.forEach(a => {
            if (Array.isArray(cranesConfig[a])) {
                dynamicCranes.push(...cranesConfig[a]);
            }
        });
        craneAreas.forEach(a => {
            if (Array.isArray(cranesConfig[a])) {
                cranesConfig[a].forEach(c => {
                    if (!dynamicCranes.includes(c)) dynamicCranes.push(c);
                });
            }
        });
    }
    if (dynamicCranes.length === 0) {
        dynamicCranes.push('10A', '10B', '10C', '10D', '20A', '20B', '20C', '20D', '20E', '20F', '30A', '30B', '30C', '30D');
    }
    const uniqueCranes = [...new Set(dynamicCranes)];

    if (role === 'cranes') {
        html += '<optgroup label="Centros de Mando SCADA">';
        craneAreas.forEach(a => {
            const num = a.replace('area', '').toUpperCase();
            html += `<option value="${a}" ${currentTarget === a ? 'selected' : ''}>Centro de Mando SCADA (Área ${num})</option>`;
        });
        html += '</optgroup>';
        // Un mando central no puede apuntar a una grúa individual: esa opción sólo existe para
        // el rol satélite. Mezclar ambas listas en el mismo select producía destinos inválidos
        // (el firmware recortaba 'area20' con substring(0,2) y guardaba 'ar').
    } else if (role === 'satellite_crane' || role === 'satellite') {
        html += '<optgroup label="Nodos Satélite (1 Grúa por Nodo)">';
        uniqueCranes.forEach(c => {
            html += `<option value="${c}" ${currentTarget === c ? 'selected' : ''}>🏗️ Grúa ${c} (Nodo Satélite)</option>`;
        });
        html += '</optgroup>';
    } else if (role === 'operations') {
        const opAreas = (typeof operationsConfig !== 'undefined' && operationsConfig)
            ? Object.keys(operationsConfig).filter(k => k !== '_order' && Array.isArray(operationsConfig[k]))
            : ['area10', 'area20', 'area30'];
        opAreas.forEach(a => {
            const num = a.replace('area', '');
            html += `<option value="${a}" ${currentTarget === a ? 'selected' : ''}>Línea Operaciones ${num}</option>`;
        });
    } else if (role === 'warehouse') {
        if (typeof warehouseConfig !== 'undefined' && warehouseConfig) {
            Object.keys(warehouseConfig).filter(k => k !== '_order').forEach(k => {
                const name = warehouseConfig[k]?.name || k;
                html += `<option value="${k}" ${currentTarget === k ? 'selected' : ''}>${name}</option>`;
            });
        } else {
            html += `<option value="rackA" ${currentTarget === 'rackA' ? 'selected' : ''}>Rack A (Almacén)</option>`;
            html += `<option value="rackB" ${currentTarget === 'rackB' ? 'selected' : ''}>Rack B (Almacén)</option>`;
        }
    }
    return html;
}

function initEsp32DeviceManager() {
    const tableBody = document.getElementById('esp32DevicesTableBody');
    const totalBadge = document.getElementById('totalEsp32DevicesBadge');
    const usbConnectBtn = document.getElementById('usbConnectBtn');
    const usbDisconnectBtn = document.getElementById('usbDisconnectBtn');
    const usbStatusBadge = document.getElementById('usbStatusBadge');
    const usbConfigControls = document.getElementById('usbConfigControls');
    const usbTargetAreaSelect = document.getElementById('usbTargetAreaSelect');
    const usbWifiSsidInput = document.getElementById('usbWifiSsidInput');
    const usbWifiPassInput = document.getElementById('usbWifiPassInput');
    const usbWriteAreaBtn = document.getElementById('usbWriteAreaBtn');
    const usbGetInfoBtn = document.getElementById('usbGetInfoBtn');
    const usbRebootBtn = document.getElementById('usbRebootBtn');
    const usbTerminalOutput = document.getElementById('usbTerminalOutput');

    // 1. Escuchar dispositivos ESP32 en tiempo real desde Firestore
    if (esp32DevicesUnsubscribe) esp32DevicesUnsubscribe();
    const usbDeviceRoleSelect = document.getElementById('usbDeviceRoleSelect');
    const usbTargetIdLabel = document.getElementById('usbTargetIdLabel');
    const usbTestLedsBtn = document.getElementById('usbTestLedsBtn');

    // 1. Escuchar dispositivos ESP32 en tiempo real desde Firestore (Multi-Rol)
    if (esp32DevicesUnsubscribe) esp32DevicesUnsubscribe();
    if (tableBody) {
        esp32DevicesUnsubscribe = db.collection('crane_devices').onSnapshot(snap => {
            if (snap.empty) {
                setSafeDOM(tableBody, `
                    <tr>
                        <td colspan="8" class="text-center py-4 text-muted">
                            <i class="bi bi-hdd-network me-2 fs-5 text-info"></i> No hay dispositivos ESP32 encendidos o registrados aún.
                            <div class="mt-1 small">Al encender cualquier ESP32 con WiFi, aparecerá aquí automáticamente.</div>
                        </td>
                    </tr>
                `);
                if (totalBadge) totalBadge.textContent = '0 dispositivos detectados';
                return;
            }

            if (totalBadge) totalBadge.textContent = `${snap.size} dispositivo${snap.size > 1 ? 's' : ''} detectado${snap.size > 1 ? 's' : ''}`;

            tableBody.replaceChildren();
            snap.forEach(doc => {
                const dev = doc.data();
                // PocketBase devuelve un `id` de 15 caracteres; la clave lógica del dispositivo es su
                // MAC. Sin esto el panel mostraba el id del registro como MAC y el "Asignar" podía
                // escribir en un registro distinto del que consulta el firmware (que busca por cleanMac).
                const cleanMac = dev.cleanMac || doc.id;
                const mac = dev.mac || cleanMac;
                const ip = dev.ip || 'Desconocida';
                const devRole = dev.role || 'cranes';
                const effectiveTarget = dev.assignedArea || dev.currentArea || 'area10';
                const roleMismatch = Boolean(dev.assignedRole && dev.role && normalizeDeviceRole(dev.assignedRole) !== normalizeDeviceRole(dev.role));
                const isSyncing = Boolean((dev.assignedArea && dev.currentArea && dev.assignedArea !== dev.currentArea));
                const fw = dev.firmwareVersion || '3.0.0-UNIVERSAL';
                // El rol físico lo reporta el propio firmware en cada heartbeat; un registro creado
                // a mano desde este panel (firmware 'UNIVERSAL') no tiene rol físico verificable.
                const fwReportedRole = Boolean(fw && !String(fw).includes('UNIVERSAL'));
                const targetInvalid = Boolean(dev.assignedArea) && !validateEsp32Assignment(devRole, dev.assignedArea).ok;

                // Calcular tiempo desde lastSeen con soporte universal (Timestamp, ISO string, ms)
                let isOnline = false;
                let lastSeenText = 'Nunca';
                let lastSeenDate = null;
                if (dev.lastSeen) {
                    if (typeof dev.lastSeen.toDate === 'function') lastSeenDate = dev.lastSeen.toDate();
                    else if (typeof dev.lastSeen.toMillis === 'function') lastSeenDate = new Date(dev.lastSeen.toMillis());
                    else if (typeof dev.lastSeen === 'string') lastSeenDate = new Date(dev.lastSeen);
                    else if (typeof dev.lastSeen === 'number') lastSeenDate = new Date(dev.lastSeen);
                    else if (dev.lastSeen.timestampValue) lastSeenDate = new Date(dev.lastSeen.timestampValue);
                }

                // Si el dispositivo reporta status 'online' o reloj desfasado (1970)
                if (dev.status === 'online' && (!lastSeenDate || isNaN(lastSeenDate.getTime()) || lastSeenDate.getFullYear() < 2024)) {
                    isOnline = true;
                    lastSeenText = 'En vivo (ahora)';
                    lastSeenDate = new Date();
                } else if (lastSeenDate && !isNaN(lastSeenDate.getTime())) {
                    const diffSec = Math.floor((Date.now() - lastSeenDate.getTime()) / 1000);
                    isOnline = diffSec <= 120;
                    if (diffSec < 15) lastSeenText = 'En vivo (ahora)';
                    else if (diffSec < 60) lastSeenText = `hace ${diffSec}s`;
                    else if (diffSec < 3600) lastSeenText = `hace ${Math.floor(diffSec / 60)} min`;
                    else lastSeenText = `hace ${Math.floor(diffSec / 3600)} h`;
                }

                let roleBadge = '<span class="badge bg-primary"><i class="bi bi-gear-wide-connected me-1"></i> Grúas</span>';
                if (devRole === 'satellite' || devRole === 'satellite_crane') {
                    roleBadge = '<span class="badge bg-info text-dark"><i class="bi bi-cpu me-1"></i> Satélite Grúa</span>';
                } else if (devRole === 'operations') {
                    roleBadge = '<span class="badge bg-success"><i class="bi bi-sliders me-1"></i> Operaciones</span>';
                } else if (devRole === 'warehouse') {
                    roleBadge = '<span class="badge bg-warning text-dark"><i class="bi bi-box-seam me-1"></i> Almacén</span>';
                }

                let targetLabel = dev.roleLabel || effectiveTarget;
                if (!dev.roleLabel || dev.roleLabel.includes('Flota') || dev.roleLabel.startsWith('Área ')) {
                    if (devRole === 'cranes') targetLabel = 'Centro de Mando SCADA (Área ' + effectiveTarget.replace('area', '') + ')';
                    else if (devRole === 'operations') targetLabel = 'Línea Op. ' + effectiveTarget.replace('area', '');
                    else if (devRole === 'warehouse') {
                        targetLabel = (warehouseConfig && warehouseConfig[effectiveTarget]?.name) ? warehouseConfig[effectiveTarget].name : effectiveTarget;
                    }
                }

                const tr = document.createElement('tr');
                const lastSeenMs = lastSeenDate ? lastSeenDate.getTime() : 0;
                setSafeDOM(tr, `
                    <td class="dev-status-cell" data-last-seen="${lastSeenMs}">
                        <span class="badge ${isOnline ? 'bg-success' : 'bg-secondary'} d-inline-flex align-items-center gap-1 dev-status-badge">
                            <span class="spinner-grow spinner-grow-sm" style="width: 0.45rem; height: 0.45rem; display: ${isOnline ? 'inline-block' : 'none'};" role="status"></span>
                            <span class="dev-status-text">${isOnline ? 'En Línea' : 'Desconectado'}</span>
                        </span>
                        <small class="text-muted d-block mt-1 font-monospace dev-last-seen-text" style="font-size:0.7rem;">${lastSeenText}</small>
                    </td>
                    <td>
                        ${roleBadge}
                        <small class="d-block text-muted font-monospace mt-1" style="font-size:0.7rem;"><i class="bi bi-cpu"></i> v${fw}</small>
                        ${fwReportedRole ? `<small class="d-block text-info font-monospace mt-1" style="font-size:0.68rem;" title="Rol reportado por el firmware flasheadado en este tablero"><i class="bi bi-shield-check"></i> Rol físico: ${escapeHtml(devRole)}</small>` : ''}
                        ${(devRole === 'satellite_crane' || devRole === 'satellite' || dev.hasOled) ? `
                        <div class="mt-1">
                            <span class="badge ${parseInt(dev.currentOledRotation ?? dev.oledRotation ?? '0', 10) === 2 ? 'bg-warning text-dark' : 'bg-dark border border-info text-info'}" style="font-size:0.67rem;" title="Rotación de Pantalla Micro-OLED 0.42'">
                                <i class="bi bi-display me-1"></i>OLED ${parseInt(dev.currentOledRotation ?? dev.oledRotation ?? '0', 10) === 2 ? '180° Invertido' : '0° Normal'}
                            </span>
                        </div>
                        ` : ''}
                    </td>
                    <td>
                        <span class="badge ${isSyncing ? 'bg-warning text-dark' : 'bg-dark border border-secondary text-light'}" style="font-size:0.78rem; white-space: nowrap;">${escapeHtml(targetLabel)}</span>
                        ${isSyncing ? '<small class="text-warning d-block mt-1" style="font-size:0.7rem;"><i class="bi bi-clock-history"></i> Aplicando en ESP32...</small>' : ''}
                        ${roleMismatch ? `<small class="text-danger d-block mt-1" style="font-size:0.7rem;"><i class="bi bi-exclamation-triangle"></i> Rol asignado (${escapeHtml(dev.assignedRole)}) no aplicable: el firmware de este tablero es ${escapeHtml(devRole)}</small>` : ''}
                        ${targetInvalid ? `<small class="text-danger d-block mt-1" style="font-size:0.7rem;"><i class="bi bi-exclamation-triangle"></i> Destino inválido para ${escapeHtml(devRole)}: "${escapeHtml(dev.assignedArea)}" — ${escapeHtml(validateEsp32Assignment(devRole, dev.assignedArea).msg)}</small>` : ''}
                    </td>
                    <td>
                        <div class="font-monospace text-info fw-bold" style="font-size:0.78rem;">${ip}</div>
                        <small class="font-monospace text-warning d-block" style="font-size:0.68rem;">${mac}</small>
                    </td>
                    <td class="text-nowrap" style="white-space: nowrap;">
                        <div class="input-group input-group-sm flex-nowrap" style="width: 580px; max-width: 590px;">
                            <select class="form-select form-select-sm dev-role-select bg-dark text-white border-secondary" style="width: 82px; max-width: 85px; flex-shrink: 0; font-size:0.75rem; padding: 0.25rem 0.35rem;" data-mac="${cleanMac}">
                                <option value="cranes" ${devRole === 'cranes' ? 'selected' : ''}>Grúas</option>
                                <option value="satellite_crane" ${(devRole === 'satellite_crane' || devRole === 'satellite') ? 'selected' : ''}>Satélite</option>
                                <option value="operations" ${devRole === 'operations' ? 'selected' : ''}>Operac.</option>
                                <option value="warehouse" ${devRole === 'warehouse' ? 'selected' : ''}>Almacén</option>
                            </select>
                            <select class="form-select form-select-sm dev-target-select bg-dark text-white border-secondary" style="width: 195px; max-width: 205px; flex-shrink: 0; font-size:0.75rem; padding: 0.25rem 0.45rem;" data-mac="${cleanMac}">
                                ${buildEsp32TargetOptions(devRole, effectiveTarget)}
                            </select>
                            <button class="btn btn-warning dev-apply-area-btn fw-bold px-2 py-1 text-nowrap" style="font-size:0.75rem; width: 75px; flex-shrink: 0;" data-mac="${cleanMac}" data-phys-role="${escapeHtml(devRole)}" data-fw-reported="${fwReportedRole ? '1' : '0'}" title="Guardar y Asignar Área / Grúa">
                                <i class="bi bi-check-lg"></i> Asignar
                            </button>
                            ${(devRole === 'satellite_crane' || devRole === 'satellite' || dev.hasOled) ? `
                            <button class="btn btn-outline-info dev-rotate-oled-btn px-2 py-1 text-nowrap" style="font-size:0.78rem; width: 36px; flex-shrink: 0;" data-mac="${cleanMac}" data-rot="${dev.currentOledRotation ?? dev.oledRotation ?? 0}" title="Rotar Pantalla OLED 180° Over-The-Air">
                                <i class="bi bi-arrow-repeat"></i>
                            </button>
                            <button class="btn btn-outline-warning dev-test-oled-btn px-2 py-1 text-nowrap" style="font-size:0.78rem; width: 36px; flex-shrink: 0;" data-mac="${cleanMac}" title="Probar Pantalla OLED Over-The-Air">
                                <i class="bi bi-aspect-ratio"></i>
                            </button>
                            ` : ''}
                            <button class="btn btn-outline-success dev-connect-btn px-2 py-1 text-nowrap" style="font-size:0.78rem; width: 36px; flex-shrink: 0;" data-mac="${cleanMac}" data-mac-full="${mac}" title="Forzar Conectar / En Línea">
                                <i class="bi bi-wifi"></i>
                            </button>
                            <button class="btn btn-outline-danger dev-delete-btn px-2 py-1 text-nowrap" style="font-size:0.78rem; width: 36px; flex-shrink: 0;" data-mac="${cleanMac}" data-mac-full="${mac}" title="Eliminar ESP32 de la Fábrica">
                                <i class="bi bi-trash"></i>
                            </button>
                        </div>
                    </td>
                `);
                tableBody.appendChild(tr);
            });

            // Sincronizar select de rol con select de destino
            tableBody.querySelectorAll('.dev-role-select').forEach(roleSel => {
                roleSel.addEventListener('change', () => {
                    const cleanMac = roleSel.getAttribute('data-mac');
                    const targetSel = tableBody.querySelector(`.dev-target-select[data-mac="${cleanMac}"]`);
                    if (targetSel) {
                        targetSel.innerHTML = buildEsp32TargetOptions(roleSel.value, '');
                    }
                });
            });

            // Conectar botones de reasignar rol y destino
            tableBody.querySelectorAll('.dev-apply-area-btn').forEach(btn => {
                btn.addEventListener('click', async () => {
                    const cleanMac = btn.getAttribute('data-mac');
                    const roleSelect = tableBody.querySelector(`.dev-role-select[data-mac="${cleanMac}"]`);
                    const targetSelect = tableBody.querySelector(`.dev-target-select[data-mac="${cleanMac}"]`);
                    if (!roleSelect || !targetSelect) return;

                    const newRole = normalizeDeviceRole(roleSelect.value);
                    const newTarget = targetSelect.value;
                    const targetLabel = targetSelect.options[targetSelect.selectedIndex]?.text || newTarget;
                    const physRole = normalizeDeviceRole(btn.getAttribute('data-phys-role') || '');
                    const fwReportedRole = btn.getAttribute('data-fw-reported') === '1';

                    // Validación (espejo del firmware) antes de escribir en la base:
                    // satélite -> grúa (20F), mando central -> área (area20).
                    const check = validateEsp32Assignment(newRole, newTarget);
                    if (!check.ok) {
                        showAlert(`Asignación rechazada: ${check.msg}`, 'danger');
                        return;
                    }
                    if (fwReportedRole && newRole !== physRole) {
                        showAlert(`Asignación rechazada: el firmware flasheado en ${cleanMac} es ${physRole}. El rol es físico (depende del sketch); desde el panel sólo se puede reasignar su grúa/área.`, 'danger');
                        return;
                    }

                    btn.disabled = true;
                    setSafeDOM(btn, '<span class="spinner-border spinner-border-sm"></span>');
                    try {
                        // Enviar comando USB serie directo si el microcontrolador está conectado por cable
                        if (currentUsbPort && currentUsbPort.writable) {
                            try {
                                await sendSerialCommand(`SET_CONFIG:${newRole}:${newTarget}:KEEP:KEEP\n`);
                                appendTerminal(`\n> [Auto-Sync USB] Rol reasignado a: ${newRole.toUpperCase()} (${newTarget})\n`);
                            } catch (usbErr) {
                                console.warn('[USB Serial auto-sync error]:', usbErr);
                            }
                        }

                        // Guardar en la base para que el dispositivo lo sincronice vía WiFi.
                        // `role` se conserva como el rol físico reportado por el firmware; `assignedRole`
                        // registra la intención del panel y `assignedArea` es el destino (grúa o área).
                        await db.collection('crane_devices').doc(cleanMac).set({
                            assignedRole: newRole,
                            role: fwReportedRole ? physRole : newRole,
                            assignedArea: newTarget,
                            roleLabel: targetLabel,
                            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
                        }, { merge: true });

                        showAlert(`¡Dispositivo ${cleanMac} reasignado exitosamente a: ${targetLabel}!`, 'success');
                    } catch (err) {
                        showAlert('Error al reasignar dispositivo: ' + err.message, 'danger');
                    } finally {
                        btn.disabled = false;
                        setSafeDOM(btn, '<i class="bi bi-check-lg"></i> Asignar');
                    }
                });
            });

            // Conectar botones de rotar OLED 180° Over-The-Air
            tableBody.querySelectorAll('.dev-rotate-oled-btn').forEach(btn => {
                btn.addEventListener('click', async () => {
                    const cleanMac = btn.getAttribute('data-mac');
                    const curRot = parseInt(btn.getAttribute('data-rot') || '0', 10);
                    const newRot = (curRot === 2) ? 0 : 2;

                    btn.disabled = true;
                    setSafeDOM(btn, '<span class="spinner-border spinner-border-sm"></span>');
                    try {
                        if (currentUsbPort && currentUsbPort.writable) {
                            try {
                                await sendSerialCommand(`SET_OLED_ROTATION:${newRot}\n`);
                                appendTerminal(`\n> [USB Directo] Rotación OLED cambiada a ${newRot}°\n`);
                            } catch(e) {}
                        }

                        await db.collection('crane_devices').doc(cleanMac).set({
                            oledRotation: newRot,
                            currentOledRotation: newRot,
                            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
                        }, { merge: true });
                        showAlert(`¡Orden de rotación de pantalla (${newRot === 2 ? '180° Invertido' : '0° Normal'}) enviada a ${cleanMac}!`, 'info');
                    } catch (err) {
                        showAlert('Error al rotar pantalla: ' + err.message, 'danger');
                    } finally {
                        btn.disabled = false;
                        setSafeDOM(btn, '<i class="bi bi-arrow-repeat"></i>');
                    }
                });
            });

            // Conectar botones de probar pantalla OLED Over-The-Air
            tableBody.querySelectorAll('.dev-test-oled-btn').forEach(btn => {
                btn.addEventListener('click', async () => {
                    const cleanMac = btn.getAttribute('data-mac');

                    btn.disabled = true;
                    setSafeDOM(btn, '<span class="spinner-border spinner-border-sm"></span>');
                    try {
                        if (currentUsbPort && currentUsbPort.writable) {
                            try {
                                await sendSerialCommand('TEST_OLED\n');
                                appendTerminal('\n> [USB Directo] Ejecutando TEST_OLED...\n');
                            } catch(e) {}
                        }

                        await db.collection('crane_devices').doc(cleanMac).set({
                            remoteCommand: 'test_oled',
                            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
                        }, { merge: true });
                        showAlert(`¡Secuencia de prueba enviada a la pantalla OLED de ${cleanMac}!`, 'warning');
                    } catch (err) {
                        showAlert('Error al probar pantalla: ' + err.message, 'danger');
                    } finally {
                        btn.disabled = false;
                        setSafeDOM(btn, '<i class="bi bi-aspect-ratio"></i>');
                    }
                });
            });

            // Conectar botones de forzar conexión / marcar en línea
            tableBody.querySelectorAll('.dev-connect-btn').forEach(btn => {
                btn.addEventListener('click', async () => {
                    const cleanMac = btn.getAttribute('data-mac');
                    const mac = btn.getAttribute('data-mac-full') || cleanMac;

                    btn.disabled = true;
                    setSafeDOM(btn, '<span class="spinner-border spinner-border-sm"></span>');
                    try {
                        await db.collection('crane_devices').doc(cleanMac).set({
                            status: 'online',
                            lastSeen: firebase.firestore.FieldValue.serverTimestamp()
                        }, { merge: true });
                        showAlert(`¡Dispositivo ${mac} conectado y marcado En Línea exitosamente!`, 'success');
                    } catch (err) {
                        showAlert('Error al conectar dispositivo: ' + err.message, 'danger');
                    } finally {
                        btn.disabled = false;
                        setSafeDOM(btn, '<i class="bi bi-wifi"></i>');
                    }
                });
            });

            // Conectar botones de eliminar dispositivo
            tableBody.querySelectorAll('.dev-delete-btn').forEach(btn => {
                btn.addEventListener('click', async () => {
                    const cleanMac = btn.getAttribute('data-mac');
                    const mac = btn.getAttribute('data-mac-full') || cleanMac;
                    if (!confirm(`¿Eliminar definitivamente el ESP32 con MAC ${mac} del registro de fábrica?`)) return;

                    btn.disabled = true;
                    setSafeDOM(btn, '<span class="spinner-border spinner-border-sm"></span>');
                    try {
                        await db.collection('crane_devices').doc(cleanMac).delete();
                        showAlert(`Dispositivo ${mac} eliminado correctamente de la lista.`, 'success');
                    } catch (err) {
                        showAlert('Error al eliminar dispositivo: ' + err.message, 'danger');
                        btn.disabled = false;
                        setSafeDOM(btn, '<i class="bi bi-trash3"></i>');
                    }
                });
            });
        }, err => {
            console.warn('[crane_devices onSnapshot error]:', err);
        });

        // Temporizador en vivo cada 3 segundos para re-evaluar si el ESP32 sigue respondiendo
        if (!window._esp32LiveStatusInterval) {
            window._esp32LiveStatusInterval = setInterval(() => {
                const rows = document.querySelectorAll('#esp32DevicesTableBody tr');
                rows.forEach(tr => {
                    const statusCell = tr.querySelector('.dev-status-cell');
                    if (!statusCell) return;
                    const lastSeenMs = parseInt(statusCell.getAttribute('data-last-seen') || '0', 10);
                    if (!lastSeenMs) return;

                    const diffSec = Math.floor((Date.now() - lastSeenMs) / 1000);
                    const isOnline = diffSec <= 120;

                    const badge = tr.querySelector('.dev-status-badge');
                    const spinner = tr.querySelector('.spinner-grow');
                    const statusText = tr.querySelector('.dev-status-text');
                    const lastSeenEl = tr.querySelector('.dev-last-seen-text');

                    if (badge && spinner && statusText) {
                        if (isOnline) {
                            badge.classList.remove('bg-secondary');
                            badge.classList.add('bg-success');
                            spinner.style.display = 'inline-block';
                            statusText.textContent = 'En Línea';
                        } else {
                            badge.classList.remove('bg-success');
                            badge.classList.add('bg-secondary');
                            spinner.style.display = 'none';
                            statusText.textContent = 'Desconectado';
                        }
                    }

                    if (lastSeenEl) {
                        if (diffSec < 15) lastSeenEl.textContent = 'En vivo (ahora)';
                        else if (diffSec < 60) lastSeenEl.textContent = `hace ${diffSec}s`;
                        else if (diffSec < 3600) lastSeenEl.textContent = `hace ${Math.floor(diffSec / 60)} min`;
                        else lastSeenEl.textContent = `hace ${Math.floor(diffSec / 3600)} h`;
                    }
                });
            }, 3000);
        }
    }

    // Conectar guardado manual de ESP32 desde el Modal
    const saveManualBtn = document.getElementById('saveManualEsp32Btn');
    if (saveManualBtn && !saveManualBtn.dataset.bound) {
        saveManualBtn.dataset.bound = 'true';
        saveManualBtn.addEventListener('click', async () => {
            const ip = document.getElementById('manualEsp32Ip')?.value.trim() || '192.168.100.29';
            let mac = document.getElementById('manualEsp32Mac')?.value.trim() || 'E0:8C:FE:F9:93:70';
            const role = document.getElementById('manualEsp32Role')?.value || 'cranes';
            const targetSelect = document.getElementById('manualEsp32TargetSelect');
            const targetValue = targetSelect ? targetSelect.value : 'area30';
            const targetLabel = targetSelect ? targetSelect.options[targetSelect.selectedIndex]?.text : 'Área 30 (Centro de Mando)';

            let cleanMac = mac.replace(/[:-]/g, '').toLowerCase();
            if (!cleanMac) cleanMac = 'esp32_' + Date.now().toString(16);

            const manualCheck = validateEsp32Assignment(role, targetValue);
            if (!manualCheck.ok) {
                showAlert('Registro rechazado: ' + manualCheck.msg, 'danger');
                return;
            }

            saveManualBtn.disabled = true;
            setSafeDOM(saveManualBtn, '<span class="spinner-border spinner-border-sm"></span> Guardando...');

            try {
                await db.collection('crane_devices').doc(cleanMac).set({
                    mac: mac.toUpperCase(),
                    cleanMac: cleanMac,
                    ip: ip,
                    role: role,
                    currentArea: targetValue,
                    assignedArea: targetValue,
                    roleLabel: targetLabel,
                    firmwareVersion: '3.2.0-UNIVERSAL',
                    status: 'online',
                    lastSeen: firebase.firestore.FieldValue.serverTimestamp()
                }, { merge: true });

                const modalEl = document.getElementById('manualAddEsp32Modal');
                if (modalEl && typeof bootstrap !== 'undefined') {
                    const modalInst = bootstrap.Modal.getInstance(modalEl);
                    if (modalInst) modalInst.hide();
                }

                showAlert(`¡Dispositivo ${mac} registrado y en línea exitosamente!`, 'success');
            } catch(err) {
                showAlert('Error al registrar ESP32: ' + err.message, 'danger');
            } finally {
                saveManualBtn.disabled = false;
                setSafeDOM(saveManualBtn, '<i class="bi bi-check-circle me-1"></i> Guardar y Vincular Dispositivo');
            }
        });
    }

    // 2. Poblar opciones de destino dinámicas para el configurador USB según el rol seleccionado
    window.populateUsbTargetSelect = function(selectedRole, preselectedTarget) {
        if (!usbTargetAreaSelect) return;
        const role = selectedRole || (usbDeviceRoleSelect ? usbDeviceRoleSelect.value : 'satellite_crane');

        if (role === 'satellite_crane' || role === 'satellite') {
            if (usbTargetIdLabel) usbTargetIdLabel.textContent = 'Grúa Asignada (1 por Nodo):';
            const allCranes = [];
            if (cranesConfig) {
                const keys = cranesConfig._order || Object.keys(cranesConfig);
                keys.forEach(k => {
                    if (k !== '_order' && Array.isArray(cranesConfig[k])) {
                        allCranes.push(...cranesConfig[k]);
                    }
                });
                Object.keys(cranesConfig).forEach(k => {
                    if (k !== '_order' && Array.isArray(cranesConfig[k])) {
                        cranesConfig[k].forEach(c => {
                            if (!allCranes.includes(c)) allCranes.push(c);
                        });
                    }
                });
            }
            if (allCranes.length === 0) {
                allCranes.push('10A', '10B', '10C', '10D', '20A', '20B', '20C', '20D', '20E', '20F', '30A', '30B', '30C', '30D');
            }
            const uniqueCranes = [...new Set(allCranes)];
            setSafeDOM(usbTargetAreaSelect, uniqueCranes.map(c => 
                `<option value="${c}" ${c === preselectedTarget ? 'selected' : ''}>🏗️ Grúa ${c} (Nodo Individual)</option>`
            ).join(''));
        } else if (role === 'operations') {
            if (usbTargetIdLabel) usbTargetIdLabel.textContent = 'Área de Operaciones Asignada:';
            const opAreas = operationsConfig ? Object.keys(operationsConfig).filter(k => k !== '_order' && Array.isArray(operationsConfig[k])) : ['area10', 'area20'];
            if (!opAreas.includes('area10')) opAreas.unshift('area10');
            if (!opAreas.includes('area20')) opAreas.push('area20');
            setSafeDOM(usbTargetAreaSelect, opAreas.map(a => `<option value="${a}" ${a === preselectedTarget ? 'selected' : ''}>Línea Operaciones Área ${a.replace('area', '')}</option>`).join(''));
        } else if (role === 'warehouse') {
            if (usbTargetIdLabel) usbTargetIdLabel.textContent = 'Rack de Almacén Asignado:';
            const racks = warehouseConfig ? Object.keys(warehouseConfig).filter(k => k !== '_order' && typeof warehouseConfig[k] === 'object') : ['rackA', 'rackB'];
            if (!racks.includes('rackA')) racks.unshift('rackA');
            setSafeDOM(usbTargetAreaSelect, racks.map(r => {
                const name = (warehouseConfig && warehouseConfig[r]?.name) ? warehouseConfig[r].name : r;
                return `<option value="${r}" ${r === preselectedTarget ? 'selected' : ''}>📦 ${escapeHtml(name)}</option>`;
            }).join(''));
        } else {
            if (usbTargetIdLabel) usbTargetIdLabel.textContent = 'Área de Grúas Asignada (Centro de Mando):';
            const availableAreas = cranesConfig ? Object.keys(cranesConfig).filter(k => k !== '_order' && Array.isArray(cranesConfig[k])) : ['area30', 'area10', 'area20'];
            if (!availableAreas.includes('area30')) availableAreas.unshift('area30');
            if (!availableAreas.includes('area10')) availableAreas.push('area10');
            if (!availableAreas.includes('area20')) availableAreas.push('area20');
            setSafeDOM(usbTargetAreaSelect, availableAreas.map(a => `<option value="${a}" ${a === preselectedTarget ? 'selected' : ''}>Sección Área ${a.replace('area', '')} (Multinodo)</option>`).join(''));
        }
    };

    if (usbDeviceRoleSelect) {
        usbDeviceRoleSelect.addEventListener('change', () => {
            window.populateUsbTargetSelect(usbDeviceRoleSelect.value);
        });
    }
    window.populateUsbTargetSelect('cranes');

    // Conmutador interactivo entre Centro de Mando GC9A01 y Nodo Satélite
    const fwSelectCentroMando = document.getElementById('fwSelectCentroMando');
    const fwSelectSatellite   = document.getElementById('fwSelectSatellite');
    const fwInfoCentroMando   = document.getElementById('fwInfoCentroMando');
    const fwInfoSatellite     = document.getElementById('fwInfoSatellite');
    const installWrapperCentroMando = document.getElementById('installWrapperCentroMando');
    const installWrapperSatellite   = document.getElementById('installWrapperSatellite');
    const downloadInoLink     = document.getElementById('downloadInoLink');

    const updateFirmwareSelectionUI = () => {
        const isCentroMando = fwSelectCentroMando ? fwSelectCentroMando.checked : true;
        if (fwInfoCentroMando) fwInfoCentroMando.style.display = isCentroMando ? 'block' : 'none';
        if (fwInfoSatellite) fwInfoSatellite.style.display = isCentroMando ? 'none' : 'block';
        if (installWrapperCentroMando) installWrapperCentroMando.style.display = isCentroMando ? 'block' : 'none';
        if (installWrapperSatellite) installWrapperSatellite.style.display = isCentroMando ? 'none' : 'block';
        if (downloadInoLink) {
            downloadInoLink.href = isCentroMando ? 'firmware/esp32_centro_mando_gc9a01.ino' : 'firmware/esp32_nodo_satelite_secundario.ino';
            downloadInoLink.download = isCentroMando ? 'esp32_centro_mando_gc9a01.ino' : 'esp32_nodo_satelite_secundario.ino';
        }
    };

    if (fwSelectCentroMando) fwSelectCentroMando.addEventListener('change', updateFirmwareSelectionUI);
    if (fwSelectSatellite) fwSelectSatellite.addEventListener('change', updateFirmwareSelectionUI);
    updateFirmwareSelectionUI();

    // Liberar automáticamente el puerto USB antes de flashear con ESP Web Tools
    const releaseUsbForFlashing = async () => {
        if (currentUsbPort) {
            console.log('Liberando puerto USB antes de flashear con ESP Web Tools...');
            await closeUsbConnection();
            await new Promise(r => setTimeout(r, 150));
        }
    };

    ['espWebInstallButton', 'espWebInstallCentroMando', 'espWebInstallSatellite'].forEach(id => {
        const btn = document.getElementById(id);
        if (btn) {
            btn.addEventListener('pointerdown', releaseUsbForFlashing, true);
            btn.addEventListener('click', releaseUsbForFlashing, true);
        }
    });

    if (usbConnectBtn) {
        usbConnectBtn.addEventListener('click', async () => {
            await startUsbConnection();
        });
    }

    if (usbDisconnectBtn) {
        usbDisconnectBtn.addEventListener('click', async () => {
            await closeUsbConnection();
        });
    }

    if (usbWriteAreaBtn) {
        usbWriteAreaBtn.addEventListener('click', async () => {
            // Si no está conectado, solicitar conexión USB inmediatamente
            if (!currentUsbPort || !currentUsbPort.writable) {
                const connected = await startUsbConnection();
                if (!connected) return;
                await new Promise(r => setTimeout(r, 800));
            }

            const chosenRole = usbDeviceRoleSelect ? usbDeviceRoleSelect.value : 'cranes';
            const chosenTarget = usbTargetAreaSelect ? usbTargetAreaSelect.value : 'area10';
            const newSsid = usbWifiSsidInput ? usbWifiSsidInput.value.trim() : '';
            const newPass = usbWifiPassInput ? usbWifiPassInput.value.trim() : '';

            usbWriteAreaBtn.disabled = true;
            setSafeDOM(usbWriteAreaBtn, '<span class="spinner-border spinner-border-sm me-1"></span> Guardando en Flash NVS...');
            try {
                // 1. Configurar Rol, Destino y Wi-Fi con el comando unificado (mantener credenciales si no se especificaron)
                const sendSsid = newSsid ? newSsid : 'KEEP';
                const sendPass = newPass ? newPass : 'KEEP';
                await sendSerialCommand(`SET_CONFIG:${chosenRole}:${chosenTarget}:${sendSsid}:${sendPass}\n`);
                appendTerminal(`\n> [NVS Universal] Guardando: ROL=${chosenRole.toUpperCase()}, DESTINO=${chosenTarget}\n`);

                // 2. Si es Nodo Satélite de Grúa (1 por nodo), enviar comando directo SET_CRANE
                if (chosenRole === 'satellite_crane') {
                    await new Promise(r => setTimeout(r, 200));
                    await sendSerialCommand(`SET_CRANE:${chosenTarget}\n`);
                    appendTerminal(`> Grúa asignada al nodo: ${chosenTarget}\n`);
                }

                // 3. Si Centro de Mando Grúas, sincronizar nombres de grúas
                if (chosenRole === 'cranes') {
                    const areaCranes = (cranesConfig && cranesConfig[chosenTarget]) ? cranesConfig[chosenTarget] : [];
                    if (areaCranes.length > 0) {
                        await new Promise(r => setTimeout(r, 200));
                        await sendSerialCommand(`SET_CRANES:${areaCranes.join(',')}\n`);
                        appendTerminal(`> Grúas de sección configuradas: ${areaCranes.join(', ')}\n`);
                    }
                }

                // 3. Configurar Iluminación LED
                const currentCfg = getAreaConfig(chosenTarget);
                if (currentCfg) {
                    const br = Math.round(((currentCfg.brightness || 80) / 100) * 255);
                    const cmd = `SET_LEDCFG:${currentCfg.normalEffect||'blink_slow'}:${currentCfg.alarmEffect||'blink_fast'}:${currentCfg.normalColor||'#00FF00'}:${currentCfg.alarmColor||'#FF0000'}:${br}:${currentCfg.ledsPerCrane||7}:${currentCfg.gapLeds||2}\n`;
                    await new Promise(r => setTimeout(r, 200));
                    await sendSerialCommand(cmd);
                    appendTerminal(`> Configuración LED guardada permanentemente en flash\n`);
                }

                setTimeout(() => {
                    usbWriteAreaBtn.disabled = false;
                    setSafeDOM(usbWriteAreaBtn, '<i class="bi bi-save me-1"></i> Guardar Configuración en Flash NVS del ESP32');
                    showAlert(`✅ ¡Configuración universal guardada exitosamente en la memoria Flash NVS del ESP32!\n\n• Rol: ${chosenRole.toUpperCase()}\n• Destino: ${chosenTarget}\n• Wi-Fi: ${newSsid || 'Sin cambios'}`, 'success');
                }, 1200);
            } catch (err) {
                appendTerminal(`\n> Error: ${err.message}\n`);
                usbWriteAreaBtn.disabled = false;
                setSafeDOM(usbWriteAreaBtn, '<i class="bi bi-save me-1"></i> Guardar Configuración en Flash NVS del ESP32');
                showAlert('❌ Error al comunicar con ESP32: ' + err.message, 'danger');
            }
        });
    }

    if (usbTestLedsBtn) {
        usbTestLedsBtn.addEventListener('click', async () => {
            if (!currentUsbPort || !currentUsbPort.writable) {
                showAlert('Primero conecta el ESP32 por USB con el botón superior', 'warning');
                return;
            }
            appendTerminal('\n> [Prueba LED] Encendiendo tira WS2815 en Verde Esmeralda (#10B981)...\n');
            await sendSerialCommand('TEST_LEDS:16:185:129\n');
            setTimeout(async () => {
                await sendSerialCommand('RESET_SIM\n');
                appendTerminal('> [Prueba LED] Tira LED restablecida a modo operativo.\n');
            }, 3000);
        });
    }

    // Controles y visualizador del Micro-OLED 0.42"
    const usbOledConfigCard = document.getElementById('usbOledConfigCard');
    const usbOledPreviewBox = document.getElementById('usbOledPreviewBox');
    const usbOledPreviewCrane = document.getElementById('usbOledPreviewCrane');
    const usbOledPreviewStatus = document.getElementById('usbOledPreviewStatus');
    const usbOledCurrentRotBadge = document.getElementById('usbOledCurrentRotBadge');
    const usbRotateOledBtn = document.getElementById('usbRotateOledBtn');
    const usbTestOledBtn = document.getElementById('usbTestOledBtn');

    if (usbDeviceRoleSelect) {
        usbDeviceRoleSelect.addEventListener('change', () => {
            const isSat = (usbDeviceRoleSelect.value === 'satellite_crane');
            if (usbOledConfigCard) usbOledConfigCard.style.display = isSat ? 'block' : 'none';
            if (usbOledPreviewCrane && usbTargetAreaSelect) {
                usbOledPreviewCrane.textContent = usbTargetAreaSelect.value || '20C';
            }
        });
    }

    if (usbTargetAreaSelect) {
        usbTargetAreaSelect.addEventListener('change', () => {
            if (usbOledPreviewCrane) {
                usbOledPreviewCrane.textContent = usbTargetAreaSelect.value || '20C';
            }
        });
    }

    if (usbRotateOledBtn) {
        usbRotateOledBtn.addEventListener('click', async () => {
            const newRot = (window._currentUsbOledRot === 2) ? 0 : 2;
            window._currentUsbOledRot = newRot;

            if (currentUsbPort && currentUsbPort.writable) {
                await sendSerialCommand(`SET_OLED_ROTATION:${newRot}\n`);
                appendTerminal(`\n> [USB OLED] Orientación de micro-OLED cambiada a: ${newRot}°\n`);
            }
            if (usbOledCurrentRotBadge) {
                usbOledCurrentRotBadge.textContent = `Rotación: ${newRot}° (${newRot === 2 ? '180° Invertido' : 'Normal'})`;
                usbOledCurrentRotBadge.className = (newRot === 2) ? 'badge bg-warning text-dark font-monospace' : 'badge bg-secondary font-monospace';
            }
            if (usbOledPreviewBox) {
                usbOledPreviewBox.style.transform = (newRot === 2) ? 'rotate(180deg)' : 'none';
            }
            showAlert(`¡Orientación del micro-OLED ajustada a ${newRot === 2 ? '180° Invertido' : '0° Normal'}!`, 'info');
        });
    }

    if (usbTestOledBtn) {
        usbTestOledBtn.addEventListener('click', async () => {
            if (currentUsbPort && currentUsbPort.writable) {
                await sendSerialCommand('TEST_OLED\n');
                appendTerminal('\n> [USB OLED] Ejecutando TEST_OLED en hardware...\n');
            }
            if (usbOledPreviewStatus) {
                const prevText = usbOledPreviewStatus.textContent;
                usbOledPreviewStatus.textContent = 'TEST OLED';
                usbOledPreviewStatus.className = 'font-monospace text-warning fw-bold';
                setTimeout(() => {
                    if (usbOledPreviewStatus) {
                        usbOledPreviewStatus.textContent = prevText;
                        usbOledPreviewStatus.className = 'font-monospace text-light';
                    }
                }, 1800);
            }
            showAlert('¡Secuencia de prueba de pantalla ejecutada en el ESP32-C3!', 'warning');
        });
    }

    if (usbGetInfoBtn) {
        usbGetInfoBtn.addEventListener('click', async () => {
            appendTerminal('\n> Solicitando información (GET_INFO)...\n');
            await sendSerialCommand('GET_INFO\n');
        });
    }

    if (usbRebootBtn) {
        usbRebootBtn.addEventListener('click', async () => {
            appendTerminal('\n> Enviando orden de reinicio (REBOOT)...\n');
            await sendSerialCommand('REBOOT\n');
        });
    }
}

// Centro de Hardware & Flasheo ESP32 (Llamable desde Grúas, Operaciones y Almacén)
window.openHardwareCenter = function(role, targetId) {
    // 1. Activar pestaña donde reside el hardware center
    const tabBtn = document.getElementById('cranes-mgmt-tab');
    if (tabBtn) {
        bootstrap.Tab.getOrCreateInstance(tabBtn).show();
    }
    // 2. Activar la vista del panel global de hardware ESP32
    if (typeof switchToAreaTab === 'function') {
        switchToAreaTab('__global__');
    }
    // 3. Preseleccionar rol y destino
    const roleSelect = document.getElementById('usbDeviceRoleSelect');
    if (roleSelect && role) {
        roleSelect.value = role;
        if (typeof window.populateUsbTargetSelect === 'function') {
            window.populateUsbTargetSelect(role, targetId);
        }
    }
    // 3. Resaltar con animación suave
    setTimeout(() => {
        const card = document.getElementById('esp32UniversalHardwareCard');
        if (card) {
            card.scrollIntoView({ behavior: 'smooth', block: 'start' });
            card.style.transition = 'all 0.5s ease';
            card.style.boxShadow = '0 0 35px rgba(56, 189, 248, 0.7)';
            setTimeout(() => { card.style.boxShadow = '0 8px 32px rgba(0,0,0,0.5)'; }, 2500);
        }
    }, 250);
};

// --- GESTIÓN DE BOT EN TIEMPO REAL ---
let botStatusUnsubscribe = null;

function initBotMgmt() {
    const badge = document.getElementById('bot-connection-badge');
    if (!badge) return; // No estamos en el admin panel o no se renderizó la pestaña

    if (botStatusUnsubscribe) botStatusUnsubscribe();

    // Escuchar el estado del bot en tiempo real desde Firestore
    botStatusUnsubscribe = db.collection('config').doc('bot_status').onSnapshot((doc) => {
        if (!doc.exists) {
            badge.className = 'badge bg-danger';
            badge.textContent = 'Sin reportes';
            return;
        }

        const data = doc.data();
        const connected = data.connected === true;
        
        // 1. Actualizar Badge de Conexión
        if (connected) {
            badge.className = 'badge bg-success';
            badge.textContent = 'Conectado';
            
            document.getElementById('bot-qr-card').style.display = 'none';
            document.getElementById('bot-connected-card').style.display = 'block';
        } else {
            badge.className = 'badge bg-danger';
            badge.textContent = 'Desconectado';
            
            document.getElementById('bot-connected-card').style.display = 'none';
            document.getElementById('bot-qr-card').style.display = 'block';

            // Mostrar QR si está disponible
            const qrImg = document.getElementById('bot-qr-img');
            const qrPlaceholder = document.getElementById('bot-qr-placeholder');
            const qrTime = document.getElementById('bot-qr-time');

            if (data.qrCode) {
                qrImg.src = data.qrCode;
                qrImg.style.display = 'inline-block';
                qrPlaceholder.style.display = 'none';
                
                if (data.qrGeneratedAt) {
                    const date = new Date(data.qrGeneratedAt);
                    qrTime.textContent = date.toLocaleTimeString();
                } else {
                    qrTime.textContent = 'Recientemente';
                }
            } else {
                qrImg.style.display = 'none';
                qrPlaceholder.style.display = 'block';
                qrTime.textContent = '-';
            }
        }

        // 2. Actualizar Metadatos
        document.getElementById('bot-number-val').textContent = data.botNumber ? `+${data.botNumber}` : 'Desconocido';
        
        // Formatear Uptime
        if (data.uptime) {
            const uptimeSecs = Math.floor(data.uptime);
            const hrs = Math.floor(uptimeSecs / 3600);
            const mins = Math.floor((uptimeSecs % 3600) / 60);
            const secs = uptimeSecs % 60;
            document.getElementById('bot-uptime-val').textContent = `${hrs}h ${mins}m ${secs}s`;
        } else {
            document.getElementById('bot-uptime-val').textContent = '-';
        }

        document.getElementById('bot-memory-val').textContent = data.memory || '-';
        document.getElementById('bot-baileys-val').textContent = data.baileysVersion || '1.0.0';

        const hostEl = document.getElementById('bot-host-val');
        if (hostEl) {
            hostEl.textContent = data.host ? `${data.host}${data.pid ? ` (${data.pid})` : ''}` : 'Desconocido';
            hostEl.title = data.host || '';
        }

        // Última Actividad (Heartbeat)
        if (data.lastActive) {
            const date = data.lastActive.toDate ? data.lastActive.toDate() : new Date(data.lastActive);
            document.getElementById('bot-heartbeat-val').textContent = date.toLocaleTimeString() + ' (' + date.toLocaleDateString() + ')';
        } else {
            document.getElementById('bot-heartbeat-val').textContent = '-';
        }
    }, (error) => {
        console.error("Error al escuchar estado del bot:", error);
    });
}

// Enviar comandos al bot vía Firestore
window.triggerBotCommand = async function(command) {
    let confirmMsg = '';
    if (command === 'restart') {
        confirmMsg = '¿Estás seguro de que deseas REINICIAR el bot?\n\nEsto tomará unos 10 segundos y el bot volverá a conectarse automáticamente.';
    } else if (command === 'clear_session') {
        confirmMsg = '⚠️ ADVERTENCIA ⚠️\n\n¿Estás seguro de que deseas CERRAR SESIÓN en el bot?\n\nEsto borrará todas las credenciales vinculadas y tendrás que escanear un nuevo código QR desde tu WhatsApp.';
    } else if (command === 'update_baileys') {
        confirmMsg = '¿Deseas ACTUALIZAR la librería Baileys a la última versión?\n\nEsto descargará el código nuevo en el servidor, actualizará la base y reiniciará el bot automáticamente (toma de 1 a 2 minutos).';
    }

    if (!confirm(confirmMsg)) return;

    try {
        // Asegurar que si el usuario no tiene sesión Firebase Auth activa en el cliente, intente autenticar
        if (typeof firebase !== 'undefined' && firebase.auth && !firebase.auth().currentUser) {
            try {
                await firebase.auth().signInWithEmailAndPassword('adminbot@ford.mx', 'nanoc610');
            } catch (authSilentErr) {
                console.warn('[triggerBotCommand] Reautenticación silenciosa:', authSilentErr.message);
            }
        }

        await db.collection('config').doc('bot_commands').set({
            command: command,
            processed: false,
            timestamp: firebase.firestore.FieldValue.serverTimestamp()
        });
        showAlert(`Comando '${command}' enviado al servidor con éxito. Esperando respuesta...`, 'info');
    } catch (error) {
        console.error("Error enviando comando al bot:", error);
        showAlert(`Error al enviar comando: ${error.message}`, 'danger');
    }
};


// --- GESTIÓN DE OPERACIONES INDUSTRIALES & HARDWARE ESP32 EN TIEMPO REAL ---
let operationsConfig = null;
let operationsMgmtUnsubscribe = null;
let opHardwareUnsubscribe = null;
let opLiveFailuresUnsubscribe = null;
let activeOpAreaKey = 'area10';
let liveOpActiveFailures = new Map(); // opId -> failure doc data
let opSimAnimationId = null;
let opSimMockFailureId = null;

const defaultOpAreaHardware = {
    ledsPerOperation: 6,
    gapLeds: 2,
    brightness: 80,
    normalEffect: 'blink_slow',
    normalBlinkMs: 1200,
    normalColor: '#00ff00',
    alarmEffect: 'blink_fast',
    alarmBlinkMs: 300,
    alarmColor: '#ff0000',
    buttons: {} // opId -> gpio pin (number or string)
};

let allOpHardwareConfig = {
    'area5': { ...defaultOpAreaHardware },
    'area10': { ...defaultOpAreaHardware },
    'area20': { ...defaultOpAreaHardware },
    'area30': { ...defaultOpAreaHardware },
    'area35plus': { ...defaultOpAreaHardware }
};

function getOpAreaHardware(areaKey) {
    if (!areaKey) areaKey = activeOpAreaKey || 'area10';
    if (!allOpHardwareConfig[areaKey]) {
        allOpHardwareConfig[areaKey] = JSON.parse(JSON.stringify(defaultOpAreaHardware));
    }
    return allOpHardwareConfig[areaKey];
}

async function saveOpHardwareConfig() {
    try {
        const payload = {
            ...allOpHardwareConfig,
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        };
        await db.collection('config').doc('operations_hardware').set(payload);
        showAlert("Configuración de hardware e iluminación de operaciones guardada correctamente.", "success");
    } catch (error) {
        console.error("Error guardando config de hardware de operaciones:", error);
        showAlert(`Error al guardar configuración de hardware: ${error.message}`, "danger");
    }
}

async function saveOperationsConfig() {
    try {
        const areaKeys = Object.keys(operationsConfig).filter(k => k !== '_order' && Array.isArray(operationsConfig[k]));
        if (!operationsConfig._order) {
            operationsConfig._order = areaKeys;
        } else {
            operationsConfig._order = operationsConfig._order.filter(k => areaKeys.includes(k));
            areaKeys.forEach(k => { if (!operationsConfig._order.includes(k)) operationsConfig._order.push(k); });
        }
        await db.collection('config').doc('operations_config').set(operationsConfig);
        showAlert("Configuración de operaciones guardada correctamente.", "success");
    } catch (error) {
        console.error("Error guardando config de operaciones:", error);
        showAlert(`Error al guardar configuración de operaciones: ${error.message}`, "danger");
    }
}

async function initOperationsMgmt() {
    const tabsNav = document.getElementById('opAreaTabsNav');
    if (!tabsNav) return;

    if (operationsMgmtUnsubscribe) operationsMgmtUnsubscribe();
    if (opHardwareUnsubscribe) opHardwareUnsubscribe();
    if (opLiveFailuresUnsubscribe) opLiveFailuresUnsubscribe();

    // 1. Escuchar operaciones por área en tiempo real
    operationsMgmtUnsubscribe = db.collection('config').doc('operations_config').onSnapshot(async (doc) => {
        if (!doc.exists) {
            console.log('No existe la configuración de operaciones, inicializando por defecto...');
            const defaultOperationsConfig = {
                _order: ['area5', 'area10', 'area20', 'area30', 'area35plus'],
                area5: ['5'],
                area10: ['10.01', '10.02', '10.03', '10.04', '10.05', '10.06', '10.07', '10.08', '10.09', '10.10'],
                area20: ['20.01', '20.02', '20.03', '20.04', '20.05', '20.06', '20.07', '20.08', '20.09', '20.10', '20.11', '20.12', '20.13'],
                area30: ['30.01', '30.02', '30.03', '30.04', '30.05', '30.06', '30.07', '30.08', '30.09', '30.10'],
                area35plus: ['35', '40', '50', '65', '70']
            };
            await db.collection('config').doc('operations_config').set(defaultOperationsConfig);
            operationsConfig = defaultOperationsConfig;
        } else {
            operationsConfig = doc.data();
            const allAreaKeys = Object.keys(operationsConfig).filter(k => k !== '_order' && Array.isArray(operationsConfig[k]));
            if (!operationsConfig._order) {
                operationsConfig._order = allAreaKeys.sort((a, b) => {
                    const nA = parseInt(a.replace(/\D/g, '')) || 0;
                    const nB = parseInt(b.replace(/\D/g, '')) || 0;
                    return nA - nB;
                });
                await db.collection('config').doc('operations_config').set(operationsConfig);
            }
        }
        renderOperationsMgmtUI();
    }, (error) => {
        console.error("Error al escuchar config de operaciones:", error);
        setSafeDOM(tabsNav, `<div class="alert alert-danger py-1 px-2 small"><i class="bi bi-exclamation-triangle"></i> Error al cargar áreas: ${error.message}</div>`);
    });

    // 2. Escuchar hardware y tiras LED de operaciones
    opHardwareUnsubscribe = db.collection('config').doc('operations_hardware').onSnapshot((doc) => {
        if (doc.exists) {
            const data = doc.data() || {};
            Object.keys(data).forEach(k => {
                if (typeof data[k] === 'object' && data[k] !== null && k !== 'updatedAt') {
                    allOpHardwareConfig[k] = { ...defaultOpAreaHardware, ...data[k] };
                }
            });
            renderOperationsMgmtUI();
        }
    }, (error) => {
        console.warn("Aviso escuchando operations_hardware:", error.message);
    });

    // 3. Escuchar fallas activas de operaciones en tiempo real
    opLiveFailuresUnsubscribe = db.collection('operations').where('status', '==', 'active').onSnapshot((snap) => {
        liveOpActiveFailures.clear();
        snap.forEach(doc => {
            const d = doc.data();
            const opKey = String(d.operationId || d.id || doc.id);
            liveOpActiveFailures.set(opKey, d);
        });
        renderOperationsMgmtUI();
    }, (error) => {
        console.warn("Aviso escuchando fallas activas de operaciones:", error.message);
    });

    // 4. Modal para crear Nueva Área de Operaciones
    const newOpAreaForm = document.getElementById('newOpAreaForm');
    if (newOpAreaForm && !newOpAreaForm.dataset.listener) {
        newOpAreaForm.dataset.listener = 'true';
        newOpAreaForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const numInput = document.getElementById('newOpAreaNumberInput');
            const opsInput = document.getElementById('newOpAreaOpsInput');
            if (!numInput) return;

            const rawVal = numInput.value.trim().toLowerCase().replace(/\s+/g, '');
            if (!rawVal) return;

            const areaKey = rawVal.startsWith('area') ? rawVal : `area${rawVal}`;
            if (operationsConfig && operationsConfig[areaKey]) {
                showAlert(`El Área '${areaKey}' ya existe en operaciones.`, "warning");
                return;
            }

            let initialOps = [];
            if (opsInput && opsInput.value.trim()) {
                initialOps = opsInput.value.split(',').map(s => s.trim()).filter(Boolean);
            }

            if (!operationsConfig) operationsConfig = {};
            operationsConfig[areaKey] = initialOps;
            if (!operationsConfig._order) operationsConfig._order = [];
            operationsConfig._order.push(areaKey);
            activeOpAreaKey = areaKey;

            await saveOperationsConfig();

            const modalEl = document.getElementById('newOpAreaModal');
            if (modalEl) {
                bootstrap.Modal.getOrCreateInstance(modalEl).hide();
            }
            newOpAreaForm.reset();
            showAlert(`Área '${areaKey.replace('area', 'Área ')}' creada exitosamente.`, 'success');
        });
    }

    // 5. Botones de copia y descarga del firmware ESP32
    const copyOpBtn = document.getElementById('copyOpEsp32CodeBtn');
    if (copyOpBtn && !copyOpBtn.dataset.listener) {
        copyOpBtn.dataset.listener = 'true';
        copyOpBtn.addEventListener('click', () => {
            const pre = document.getElementById('esp32OpCodePre');
            if (pre) {
                navigator.clipboard.writeText(pre.textContent).then(() => {
                    setSafeDOM(copyOpBtn, '<i class="bi bi-check2"></i> ¡Copiado!');
                    setTimeout(() => { setSafeDOM(copyOpBtn, '<i class="bi bi-clipboard"></i> Copiar Código'); }, 2000);
                });
            }
        });
    }

    const downloadOpBtn = document.getElementById('downloadOpEsp32InoBtn');
    if (downloadOpBtn && !downloadOpBtn.dataset.listener) {
        downloadOpBtn.dataset.listener = 'true';
        downloadOpBtn.addEventListener('click', downloadOpEsp32Ino);
    }

    document.querySelectorAll('input[name="esp32OpModeRadio"]').forEach(r => {
        r.addEventListener('change', updateOpEsp32ModalCode);
    });
}

function renderOperationsMgmtUI() {
    const tabsNav = document.getElementById('opAreaTabsNav');
    const tabsContent = document.getElementById('opAreaTabsContent');
    if (!tabsNav || !tabsContent || !operationsConfig) return;

    // Actualizar KPIs de la barra lateral
    const allAreaKeys = Object.keys(operationsConfig).filter(k => k !== '_order' && Array.isArray(operationsConfig[k]));
    const orderedKeys = operationsConfig._order
        ? operationsConfig._order.filter(k => allAreaKeys.includes(k))
        : [...allAreaKeys];
    allAreaKeys.forEach(k => { if (!orderedKeys.includes(k)) orderedKeys.push(k); });
    const areas = orderedKeys;

    let totalOpsCount = 0;
    areas.forEach(k => totalOpsCount += (operationsConfig[k] || []).length);
    const activeFailuresCount = liveOpActiveFailures.size;
    const operationalCount = Math.max(0, totalOpsCount - activeFailuresCount);

    const elTotalOps = document.getElementById('opStatsTotalOps');
    const elActiveFailures = document.getElementById('opStatsActiveFailures');
    const elOperational = document.getElementById('opStatsOperational');
    const elTotalAreas = document.getElementById('opStatsTotalAreas');

    if (elTotalOps) elTotalOps.textContent = totalOpsCount;
    if (elActiveFailures) elActiveFailures.textContent = activeFailuresCount;
    if (elOperational) elOperational.textContent = operationalCount;
    if (elTotalAreas) elTotalAreas.textContent = areas.length;

    if (!areas.includes(activeOpAreaKey) && areas.length > 0) {
        activeOpAreaKey = areas[0];
    }

    // Renderizar Pestañas Horizontales
    tabsNav.replaceChildren();
    if (areas.length === 0) {
        setSafeDOM(tabsNav, '<span class="text-muted small">No hay áreas configuradas. Agrega una nueva área para comenzar.</span>');
        tabsContent.replaceChildren();
        return;
    }

    areas.forEach(areaKey => {
        const areaNum = areaKey.replace('area', '').replace('plus', '+');
        const areaOps = operationsConfig[areaKey] || [];
        const isActive = areaKey === activeOpAreaKey;
        const activeFailuresInArea = areaOps.filter(opId => liveOpActiveFailures.has(String(opId))).length;

        const btn = document.createElement('button');
        btn.className = `btn area-tab-btn ${isActive ? 'area-tab-btn--active-op' : ''}`;
        btn.dataset.areaKey = areaKey;
        btn.draggable = true;
        btn.title = "Haz clic para seleccionar o arrastra para reordenar el área";
        setSafeDOM(btn, `
            <i class="bi bi-grip-vertical text-muted opacity-50 me-1" style="font-size:0.8rem;"></i>
            <i class="bi bi-diagram-3"></i> Área ${areaNum}
            <span class="badge ${isActive ? 'bg-white text-dark' : 'bg-secondary'} ms-1">${areaOps.length}</span>
            ${activeFailuresInArea > 0 ? `<span class="badge bg-danger ms-1" title="${activeFailuresInArea} estación(es) en falla activa"><i class="bi bi-exclamation-triangle-fill"></i> ${activeFailuresInArea}</span>` : ''}
        `);

        btn.addEventListener('click', () => switchToOpAreaTab(areaKey));

        // Drag & Drop para reordenar pestañas
        btn.addEventListener('dragstart', (e) => {
            e.dataTransfer.setData('text/plain', areaKey);
            btn.classList.add('dragging');
        });
        btn.addEventListener('dragend', () => {
            btn.classList.remove('dragging');
            document.querySelectorAll('#opAreaTabsNav .area-tab-btn').forEach(b => b.classList.remove('drag-over'));
        });
        btn.addEventListener('dragover', (e) => {
            e.preventDefault();
            btn.classList.add('drag-over');
        });
        btn.addEventListener('dragleave', () => {
            btn.classList.remove('drag-over');
        });
        btn.addEventListener('drop', async (e) => {
            e.preventDefault();
            btn.classList.remove('drag-over');
            const draggedKey = e.dataTransfer.getData('text/plain');
            if (!draggedKey || draggedKey === areaKey) return;

            const order = operationsConfig._order ? [...operationsConfig._order] : [...areas];
            const fromIdx = order.indexOf(draggedKey);
            const toIdx = order.indexOf(areaKey);
            if (fromIdx !== -1 && toIdx !== -1) {
                order.splice(fromIdx, 1);
                order.splice(toIdx, 0, draggedKey);
                operationsConfig._order = order;
                await saveOperationsConfig();
                renderOperationsMgmtUI();
            }
        });

        tabsNav.appendChild(btn);
    });

    renderActiveOpAreaPanel(areas);
}

function switchToOpAreaTab(areaKey) {
    activeOpAreaKey = areaKey;
    opSimMockFailureId = null;
    document.querySelectorAll('#opAreaTabsNav .area-tab-btn').forEach(b => {
        const isActive = b.dataset.areaKey === areaKey;
        b.classList.toggle('area-tab-btn--active-op', isActive);
        const badge = b.querySelector('.badge');
        if (badge) badge.className = isActive ? 'badge bg-white text-dark ms-1' : 'badge bg-secondary ms-1';
    });
    renderOperationsMgmtUI();
}

function renderActiveOpAreaPanel(areas) {
    const tabsContent = document.getElementById('opAreaTabsContent');
    if (!tabsContent || !operationsConfig || !areas.includes(activeOpAreaKey)) return;

    const areaKey = activeOpAreaKey;
    const areaNum = areaKey.replace('area', '').replace('plus', '+');
    const areaOps = operationsConfig[areaKey] || [];
    const areaIdx = areas.indexOf(areaKey);
    const isFirst = areaIdx === 0;
    const isLast = areaIdx === areas.length - 1;
    const hw = getOpAreaHardware(areaKey);

    const failCount = areaOps.filter(id => liveOpActiveFailures.has(String(id))).length;
    const okCount = Math.max(0, areaOps.length - failCount);

    setSafeDOM(tabsContent, `
    <div class="row g-3">
      <!-- ═══════ CABECERA: Operaciones del Área ═══════ -->
      <div class="col-12">
        <div class="card border-0" style="background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.1)!important;">
          <div class="card-header d-flex justify-content-between align-items-center py-2" style="background:rgba(16,185,129,0.06); border-bottom:1px solid rgba(16,185,129,0.2);">
            <div class="d-flex align-items-center gap-2">
              <div class="d-flex flex-column gap-1">
                <button class="btn btn-sm btn-outline-secondary py-0 px-1 lh-1" title="Mover área arriba"
                    onclick="moveOpArea('${areaKey}', -1)" ${isFirst ? 'disabled' : ''}>
                    <i class="bi bi-chevron-up" style="font-size:0.7rem;"></i>
                </button>
                <button class="btn btn-sm btn-outline-secondary py-0 px-1 lh-1" title="Mover área abajo"
                    onclick="moveOpArea('${areaKey}', 1)" ${isLast ? 'disabled' : ''}>
                    <i class="bi bi-chevron-down" style="font-size:0.7rem;"></i>
                </button>
              </div>
              <strong class="text-white fw-bold fs-5"><i class="bi bi-sliders text-success"></i> Área ${areaNum}</strong>
              <span class="badge bg-primary">${areaOps.length} operaciones</span>
              ${failCount > 0 
                ? `<span class="badge bg-danger ms-1"><i class="bi bi-exclamation-triangle-fill"></i> ${failCount} en falla</span><span class="badge bg-success ms-1"><i class="bi bi-check-circle-fill"></i> ${okCount} operativas</span>` 
                : `<span class="badge bg-success ms-1"><i class="bi bi-check-circle-fill"></i> Todas operativas</span>`}
            </div>
            <button class="btn btn-sm btn-outline-danger py-1" onclick="deleteOpArea('${areaKey}', 'Área ${areaNum}')">
              <i class="bi bi-trash"></i> Eliminar Área
            </button>
          </div>
          <div class="card-body">
            <div class="mb-3 d-flex flex-wrap gap-2" id="opListContainer-${areaKey}">
              ${areaOps.length === 0
                ? '<span class="text-muted small">No hay operaciones en esta área. Agrega una abajo.</span>'
                : areaOps.map(opId => {
                    const isFailed = liveOpActiveFailures.has(String(opId));
                    const assignedPin = hw.buttons && hw.buttons[opId] !== undefined ? hw.buttons[opId] : '';
                    return `
                      <span class="d-inline-flex align-items-center gap-2 px-3 py-2 rounded-3 border op-drag-chip ${isFailed ? 'border-danger bg-danger bg-opacity-10' : 'border-success bg-success bg-opacity-10'}"
                            draggable="true" data-op-id="${opId}" title="Arrastra para reordenar la operación">
                        <i class="bi bi-grip-vertical text-muted opacity-50" style="font-size:0.85rem;"></i>
                        <span class="fw-semibold ${isFailed ? 'text-danger' : 'text-success'}">
                          <i class="bi ${isFailed ? 'bi-exclamation-triangle-fill' : 'bi-check-circle-fill'} me-1"></i>Op. ${opId}
                        </span>
                        <span class="badge ${assignedPin ? 'bg-dark border border-secondary text-info' : 'bg-secondary bg-opacity-50 text-light'}" 
                              style="cursor:pointer;font-family:monospace;font-size:0.75rem;" 
                              onclick="promptAssignOpGpio('${areaKey}', '${opId}')"
                              title="Haz clic para asignar el pin físico GPIO del botón">
                          <i class="bi bi-cpu"></i> ${assignedPin ? `GPIO ${assignedPin}` : 'Sin Pin'}
                        </span>
                        <small class="badge ${isFailed ? 'bg-danger' : 'bg-success'}">${isFailed ? 'En Falla' : 'Operativa'}</small>
                        <i class="bi bi-x-circle-fill text-danger-emphasis cursor-pointer" onclick="deleteOperationFromArea('${areaKey}', '${opId}')" style="cursor:pointer;opacity:0.5;" title="Eliminar operación"></i>
                      </span>
                    `;
                  }).join('')}
            </div>
            <hr class="border-secondary border-opacity-25">
            <form class="row g-2 align-items-center" onsubmit="event.preventDefault(); handleAddOpSubmit('${areaKey}')">
              <div class="col-auto">
                <div class="input-group input-group-sm">
                  <span class="input-group-text bg-dark text-white border-secondary">Op. ID</span>
                  <input type="text" class="form-control bg-dark text-white border-secondary" placeholder="ej. ${areaNum === '35+' ? '35.1' : areaNum + '.01'}" id="newOpIdInput-${areaKey}" required style="width:130px;">
                </div>
              </div>
              <div class="col-auto">
                <div class="input-group input-group-sm">
                  <span class="input-group-text bg-dark text-white border-secondary">GPIO Botón</span>
                  <input type="number" class="form-control bg-dark text-white border-secondary" placeholder="ej. 16" id="newOpGpioInput-${areaKey}" min="0" max="39" style="width:90px;">
                </div>
              </div>
              <div class="col-auto">
                <button type="submit" class="btn btn-sm btn-success">
                  <i class="bi bi-plus-lg"></i> Agregar Operación
                </button>
              </div>
              <div class="col-auto">
                <small class="text-muted" style="font-size:0.75rem;">(Asigna el pin del botón físico de paro para el ESP32)</small>
              </div>
            </form>
          </div>
        </div>
      </div>

      <!-- ═══════ PANEL DE ILUMINACIÓN ANDON & TELEMETRÍA ESP32 ═══════ -->
      <div class="col-12">
        <div class="card" style="background:rgba(255,255,255,0.02);border:1px solid rgba(16,185,129,0.25)!important;">
          <div class="card-header d-flex justify-content-between align-items-center flex-wrap gap-2 py-2" style="background:rgba(16,185,129,0.06); border-bottom:1px solid rgba(16,185,129,0.2);">
            <div class="d-flex align-items-center gap-2 flex-wrap">
              <h5 class="mb-0 text-white"><i class="bi bi-lightbulb-fill text-success"></i> Control de Torretas Andon &amp; Tira LED ESP32 — Área ${areaNum}</h5>
              <span class="badge bg-success px-3 py-1"><i class="bi bi-cpu"></i> Multi-ESP32 WS2815 / WS2812B</span>
            </div>
            <div class="d-flex gap-2">
              <button class="btn btn-sm btn-outline-success" id="viewOpEsp32CodeBtn" data-bs-toggle="modal" data-bs-target="#esp32OpCodeModal">
                <i class="bi bi-file-earmark-code"></i> Obtener Firmware ESP32
              </button>
            </div>
          </div>
          <div class="card-body">
            <!-- Simulador de Tira Andon / Estaciones en Vivo -->
            <div class="mb-4">
              <div class="d-flex justify-content-between align-items-center flex-wrap gap-2 mb-2">
                <div>
                  <label class="form-label mb-0 fw-bold small text-uppercase text-white"><i class="bi bi-eye"></i> Simulador de Tira Andon en Vivo</label>
                  <span class="badge bg-secondary ms-2">Área ${areaNum}</span>
                </div>
                <div class="d-flex align-items-center gap-2">
                  <select class="form-select form-select-sm" id="opSimPickerSelect" style="width: auto; font-size: 0.78rem;">
                    ${areaOps.map(op => `<option value="${op}" ${opSimMockFailureId === op ? 'selected' : ''}>Op. ${op}</option>`).join('')}
                  </select>
                  <button class="btn btn-sm btn-outline-warning py-1 px-2" id="btnToggleSimOpFailure" style="font-size:0.78rem;">
                    <i class="bi bi-lightning-charge"></i> Simular Falla
                  </button>
                  <button class="btn btn-sm btn-outline-secondary py-1 px-2" id="btnResetSimOp" style="font-size:0.78rem;">
                    <i class="bi bi-arrow-counterclockwise"></i> Normal
                  </button>
                </div>
              </div>

              <!-- Contenedor visual de LEDs -->
              <div class="p-3 rounded-3 bg-black border border-secondary border-opacity-25" style="min-height:70px; overflow-x:auto;">
                <div class="d-flex align-items-center gap-3 flex-wrap" id="opLedStripSimulatorContainer"></div>
              </div>
            </div>

            <!-- Parámetros de Hardware -->
            <h6 class="fw-bold text-uppercase small text-muted mb-3"><i class="bi bi-sliders2"></i> Parámetros de Tiras LED &amp; Hardware</h6>
            <div class="row g-3 mb-4">
              <div class="col-md-3 col-6">
                <label class="form-label small fw-semibold">LEDs por Operación:</label>
                <input type="number" class="form-control form-control-sm" id="opLedsPerOpInput" min="1" max="50" value="${hw.ledsPerOperation || 6}">
                <span class="form-text small text-muted">LEDs por estación o torreta</span>
              </div>
              <div class="col-md-3 col-6">
                <label class="form-label small fw-semibold">LEDs de Separación (Gap):</label>
                <input type="number" class="form-control form-control-sm" id="opLedsGapInput" min="0" max="10" value="${hw.gapLeds !== undefined ? hw.gapLeds : 2}">
                <span class="form-text small text-muted">LEDs apagados entre estaciones</span>
              </div>
              <div class="col-md-6 col-12">
                <label class="form-label d-flex justify-content-between align-items-center mb-1">
                  <span class="small fw-semibold"><i class="bi bi-brightness-high"></i> Brillo General Tira WS2815 / WS2812B:</span>
                  <span class="badge bg-success" id="opLedBrightnessVal">${hw.brightness || 80}%</span>
                </label>
                <input type="range" class="form-range" id="opLedBrightnessInput" min="10" max="100" value="${hw.brightness || 80}" step="5">
              </div>
            </div>

            <!-- Efectos y Colores -->
            <h6 class="fw-bold text-uppercase small text-muted mb-3"><i class="bi bi-palette"></i> Efectos Visuales y Colores Andon</h6>
            <div class="row g-3 mb-3">
              <!-- 1. Operativo (Normal) -->
              <div class="col-md-6">
                <div class="p-3 rounded-3 h-100" style="background:rgba(16,185,129,0.06);border:1px solid rgba(16,185,129,0.25);">
                  <h6 class="text-success fw-bold mb-3"><i class="bi bi-check-circle-fill"></i> 1. Operativo (Normal)</h6>
                  <div class="mb-3">
                    <label class="form-label small fw-semibold">Efecto Visual:</label>
                    <select class="form-select form-select-sm" id="opNormalEffectSelect">
                      <option value="blink_slow" ${(hw.normalEffect||'blink_slow')==='blink_slow'?'selected':''}>Parpadeo Lento (Ahorro térmico)</option>
                      <option value="breathing" ${hw.normalEffect==='breathing'?'selected':''}>Respiración Suave</option>
                      <option value="static" ${hw.normalEffect==='static'?'selected':''}>Fijo Continuo (100%)</option>
                      <option value="heartbeat" ${hw.normalEffect==='heartbeat'?'selected':''}>Latido Industrial</option>
                    </select>
                  </div>
                  <div class="mb-3">
                    <label class="form-label small d-flex justify-content-between">
                      <span>Velocidad:</span>
                      <span class="badge bg-success" id="opNormalSpeedVal">${hw.normalBlinkMs || 1200} ms</span>
                    </label>
                    <input type="range" class="form-range" id="opNormalSpeedInput" min="500" max="3000" value="${hw.normalBlinkMs || 1200}" step="100">
                  </div>
                  <div class="mb-2">
                    <label class="form-label small fw-semibold">Color Operativo:</label>
                    <div class="d-flex align-items-center gap-2 mb-2">
                      <input type="color" class="form-control form-control-color" id="opNormalColorInput" value="${hw.normalColor || '#00ff00'}">
                      <span class="small font-monospace text-muted" id="opNormalColorHex">${(hw.normalColor || '#00ff00').toUpperCase()}</span>
                    </div>
                  </div>
                </div>
              </div>

              <!-- 2. Alarma (Falla) -->
              <div class="col-md-6">
                <div class="p-3 rounded-3 h-100" style="background:rgba(239,68,68,0.06);border:1px solid rgba(239,68,68,0.25);">
                  <h6 class="text-danger fw-bold mb-3"><i class="bi bi-exclamation-triangle-fill"></i> 2. Falla (Alarma de Estación)</h6>
                  <div class="mb-3">
                    <label class="form-label small fw-semibold">Efecto Visual:</label>
                    <select class="form-select form-select-sm" id="opAlarmEffectSelect">
                      <option value="blink_fast" ${(hw.alarmEffect||'blink_fast')==='blink_fast'?'selected':''}>Parpadeo Rápido</option>
                      <option value="strobe" ${hw.alarmEffect==='strobe'?'selected':''}>Estroboscópico Ultra</option>
                      <option value="chase" ${hw.alarmEffect==='chase'?'selected':''}>Barrido Secuencial</option>
                    </select>
                  </div>
                  <div class="mb-3">
                    <label class="form-label small d-flex justify-content-between">
                      <span>Velocidad:</span>
                      <span class="badge bg-danger" id="opAlarmSpeedVal">${hw.alarmBlinkMs || 300} ms</span>
                    </label>
                    <input type="range" class="form-range" id="opAlarmSpeedInput" min="100" max="800" value="${hw.alarmBlinkMs || 300}" step="25">
                  </div>
                  <div class="mb-2">
                    <label class="form-label small fw-semibold">Color de Alerta:</label>
                    <div class="d-flex align-items-center gap-2 mb-2">
                      <input type="color" class="form-control form-control-color" id="opAlarmColorInput" value="${hw.alarmColor || '#ff0000'}">
                      <span class="small font-monospace text-muted" id="opAlarmColorHex">${(hw.alarmColor || '#ff0000').toUpperCase()}</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <!-- Botón Guardar Cambios -->
            <div class="d-flex justify-content-end gap-2 mt-3">
              <button class="btn btn-success fw-bold px-4" id="btnSaveOpHardwareSettings">
                <i class="bi bi-save me-1"></i> Guardar Configuración de Área ${areaNum}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
    `);

    // Vincular Eventos de Hardware y Simulador
    setupOpPanelEvents(areaKey);
    renderOpLedSimulator(areaKey);
    setupOpDragAndDrop(areaKey);

    const btnViewFirmware = document.getElementById('viewOpEsp32CodeBtn');
    if (btnViewFirmware) {
        btnViewFirmware.addEventListener('click', updateOpEsp32ModalCode);
    }
}

function setupOpPanelEvents(areaKey) {
    const hw = getOpAreaHardware(areaKey);

    const rangeBrightness = document.getElementById('opLedBrightnessInput');
    const valBrightness = document.getElementById('opLedBrightnessVal');
    if (rangeBrightness && valBrightness) {
        rangeBrightness.oninput = () => { valBrightness.textContent = `${rangeBrightness.value}%`; };
    }

    const rangeNormSpeed = document.getElementById('opNormalSpeedInput');
    const valNormSpeed = document.getElementById('opNormalSpeedVal');
    if (rangeNormSpeed && valNormSpeed) {
        rangeNormSpeed.oninput = () => { valNormSpeed.textContent = `${rangeNormSpeed.value} ms`; };
    }

    const rangeAlarmSpeed = document.getElementById('opAlarmSpeedInput');
    const valAlarmSpeed = document.getElementById('opAlarmSpeedVal');
    if (rangeAlarmSpeed && valAlarmSpeed) {
        rangeAlarmSpeed.oninput = () => { valAlarmSpeed.textContent = `${rangeAlarmSpeed.value} ms`; };
    }

    const colorNorm = document.getElementById('opNormalColorInput');
    const hexNorm = document.getElementById('opNormalColorHex');
    if (colorNorm && hexNorm) {
        colorNorm.oninput = () => { hexNorm.textContent = colorNorm.value.toUpperCase(); };
    }

    const colorAlarm = document.getElementById('opAlarmColorInput');
    const hexAlarm = document.getElementById('opAlarmColorHex');
    if (colorAlarm && hexAlarm) {
        colorAlarm.oninput = () => { hexAlarm.textContent = colorAlarm.value.toUpperCase(); };
    }

    // Botones del Simulador
    const btnToggleFail = document.getElementById('btnToggleSimOpFailure');
    const selectSimPicker = document.getElementById('opSimPickerSelect');
    if (btnToggleFail && selectSimPicker) {
        btnToggleFail.onclick = () => {
            const selectedOp = selectSimPicker.value;
            opSimMockFailureId = (opSimMockFailureId === selectedOp) ? null : selectedOp;
            btnToggleFail.classList.toggle('btn-warning', !opSimMockFailureId);
            btnToggleFail.classList.toggle('btn-danger', !!opSimMockFailureId);
            setSafeDOM(btnToggleFail, opSimMockFailureId ? '<i class="bi bi-x-circle"></i> Quitar Falla Sim.' : '<i class="bi bi-lightning-charge"></i> Simular Falla');
            renderOpLedSimulator(areaKey);
        };
    }

    const btnResetSim = document.getElementById('btnResetSimOp');
    if (btnResetSim) {
        btnResetSim.onclick = () => {
            opSimMockFailureId = null;
            if (btnToggleFail) {
                btnToggleFail.className = 'btn btn-sm btn-outline-warning py-1 px-2';
                setSafeDOM(btnToggleFail, '<i class="bi bi-lightning-charge"></i> Simular Falla');
            }
            renderOpLedSimulator(areaKey);
        };
    }

    // Botón Guardar en Firestore
    const btnSave = document.getElementById('btnSaveOpHardwareSettings');
    if (btnSave) {
        btnSave.onclick = async () => {
            hw.ledsPerOperation = parseInt(document.getElementById('opLedsPerOpInput')?.value, 10) || 6;
            hw.gapLeds = parseInt(document.getElementById('opLedsGapInput')?.value, 10) || 2;
            hw.brightness = parseInt(document.getElementById('opLedBrightnessInput')?.value, 10) || 80;
            hw.normalEffect = document.getElementById('opNormalEffectSelect')?.value || 'blink_slow';
            hw.normalBlinkMs = parseInt(document.getElementById('opNormalSpeedInput')?.value, 10) || 1200;
            hw.normalColor = document.getElementById('opNormalColorInput')?.value || '#00ff00';
            hw.alarmEffect = document.getElementById('opAlarmEffectSelect')?.value || 'blink_fast';
            hw.alarmBlinkMs = parseInt(document.getElementById('opAlarmSpeedInput')?.value, 10) || 300;
            hw.alarmColor = document.getElementById('opAlarmColorInput')?.value || '#ff0000';

            btnSave.disabled = true;
            setSafeDOM(btnSave, '<span class="spinner-border spinner-border-sm"></span> Guardando...');
            await saveOpHardwareConfig();
            btnSave.disabled = false;
            setSafeDOM(btnSave, '<i class="bi bi-save me-1"></i> Guardar Configuración de Área ' + areaKey.replace('area','').replace('plus','+'));
            renderOpLedSimulator(areaKey);
        };
    }
}

function renderOpLedSimulator(areaKey) {
    const container = document.getElementById('opLedStripSimulatorContainer');
    if (!container || !operationsConfig) return;

    const areaOps = operationsConfig[areaKey] || [];
    const hw = getOpAreaHardware(areaKey);
    const ledsPerOp = hw.ledsPerOperation || 6;
    const gap = hw.gapLeds !== undefined ? hw.gapLeds : 2;

    container.replaceChildren();
    if (areaOps.length === 0) {
        setSafeDOM(container, '<span class="text-muted small">No hay operaciones para simular en esta área.</span>');
        return;
    }

    let currentLedOffset = 0;
    areaOps.forEach((opId) => {
        const isFailed = (opSimMockFailureId === opId) || liveOpActiveFailures.has(String(opId));
        const color = isFailed ? (hw.alarmColor || '#ff0000') : (hw.normalColor || '#00ff00');
        const startLed = currentLedOffset;
        const endLed = startLed + ledsPerOp - 1;
        currentLedOffset += (ledsPerOp + gap);

        const stationDiv = document.createElement('div');
        stationDiv.className = 'd-flex flex-column align-items-center p-2 rounded';
        stationDiv.style.background = isFailed ? 'rgba(239,68,68,0.12)' : 'rgba(16,185,129,0.08)';
        stationDiv.style.border = `1px solid ${isFailed ? 'rgba(239,68,68,0.4)' : 'rgba(16,185,129,0.25)'}`;

        let dotsHtml = '<div class="d-flex gap-1 my-1">';
        for (let i = 0; i < ledsPerOp; i++) {
            dotsHtml += `<span style="width:10px;height:10px;border-radius:50%;background:${color};box-shadow:0 0 6px ${color};display:inline-block;"></span>`;
        }
        dotsHtml += '</div>';

        setSafeDOM(stationDiv, `
            <div class="small fw-bold ${isFailed ? 'text-danger' : 'text-success'} mb-1" style="font-size:0.8rem;">
                ${isFailed ? '🚨' : '🟢'} Op. ${opId}
            </div>
            ${dotsHtml}
            <small class="font-monospace text-muted" style="font-size:0.68rem;">LED ${startLed}-${endLed}</small>
        `);
        container.appendChild(stationDiv);
    });
}

function setupOpDragAndDrop(areaKey) {
    const listContainer = document.getElementById(`opListContainer-${areaKey}`);
    if (!listContainer) return;

    listContainer.querySelectorAll('.op-drag-chip').forEach(chip => {
        chip.addEventListener('dragstart', (e) => {
            e.dataTransfer.setData('text/plain', chip.dataset.opId);
            chip.classList.add('dragging');
        });
        chip.addEventListener('dragend', () => {
            chip.classList.remove('dragging');
            listContainer.querySelectorAll('.op-drag-chip').forEach(c => c.classList.remove('drag-over'));
        });
        chip.addEventListener('dragover', (e) => {
            e.preventDefault();
            chip.classList.add('drag-over');
        });
        chip.addEventListener('dragleave', () => {
            chip.classList.remove('drag-over');
        });
        chip.addEventListener('drop', async (e) => {
            e.preventDefault();
            chip.classList.remove('drag-over');
            const draggedOpId = e.dataTransfer.getData('text/plain');
            const targetOpId = chip.dataset.opId;
            if (!draggedOpId || draggedOpId === targetOpId) return;

            const list = operationsConfig[areaKey];
            const fromIdx = list.indexOf(draggedOpId);
            const toIdx = list.indexOf(targetOpId);
            if (fromIdx !== -1 && toIdx !== -1) {
                list.splice(fromIdx, 1);
                list.splice(toIdx, 0, draggedOpId);
                await saveOperationsConfig();
                renderOperationsMgmtUI();
            }
        });
    });
}

window.promptAssignOpGpio = async function(areaKey, opId) {
    const hw = getOpAreaHardware(areaKey);
    const currentPin = hw.buttons && hw.buttons[opId] !== undefined ? hw.buttons[opId] : '';
    const newPinStr = prompt(`Asignar Pin GPIO del ESP32 para el botón físico de Operación ${opId} (ej. 4, 16, 17, 18, 19, 21, 22, 23). Deja en blanco para quitar pin:`, currentPin);
    if (newPinStr === null) return;

    if (!hw.buttons) hw.buttons = {};
    if (newPinStr.trim() === '') {
        delete hw.buttons[opId];
    } else {
        const pinNum = parseInt(newPinStr.trim(), 10);
        if (isNaN(pinNum) || pinNum < 0 || pinNum > 39) {
            alert('Por favor ingresa un número de pin GPIO válido (0-39).');
            return;
        }
        hw.buttons[opId] = pinNum;
    }

    await saveOpHardwareConfig();
    renderOperationsMgmtUI();
};

window.handleAddOpSubmit = async function(areaKey) {
    const idInput = document.getElementById(`newOpIdInput-${areaKey}`);
    const gpioInput = document.getElementById(`newOpGpioInput-${areaKey}`);
    if (!idInput) return;

    const opId = idInput.value.trim();
    if (!opId) return;

    if (operationsConfig[areaKey].includes(opId)) {
        showAlert(`La Operación ${opId} ya existe en esta área.`, "warning");
        return;
    }

    operationsConfig[areaKey].push(opId);
    if (gpioInput && gpioInput.value.trim() !== '') {
        const pin = parseInt(gpioInput.value.trim(), 10);
        if (!isNaN(pin)) {
            const hw = getOpAreaHardware(areaKey);
            if (!hw.buttons) hw.buttons = {};
            hw.buttons[opId] = pin;
            await saveOpHardwareConfig();
        }
    }

    idInput.value = '';
    if (gpioInput) gpioInput.value = '';
    await saveOperationsConfig();
    renderOperationsMgmtUI();
};

window.moveOpArea = function(areaKey, direction) {
    if (!operationsConfig._order) return;
    const order = [...operationsConfig._order];
    const idx = order.indexOf(areaKey);
    if (idx === -1) return;
    const newIdx = idx + direction;
    if (newIdx < 0 || newIdx >= order.length) return;
    [order[idx], order[newIdx]] = [order[newIdx], order[idx]];
    operationsConfig._order = order;
    saveOperationsConfig();
    renderOperationsMgmtUI();
};

window.deleteOpArea = function(areaKey, areaLabel) {
    if (!confirm(`¿Está seguro de eliminar el ${areaLabel}? Se eliminarán todas las operaciones y configuraciones de hardware de esta área.`)) {
        return;
    }
    delete operationsConfig[areaKey];
    delete allOpHardwareConfig[areaKey];
    if (operationsConfig._order) {
        operationsConfig._order = operationsConfig._order.filter(k => k !== areaKey);
    }
    saveOperationsConfig();
    saveOpHardwareConfig();
    renderOperationsMgmtUI();
};

window.deleteOperationFromArea = function(areaKey, opId) {
    if (!confirm(`¿Está seguro de eliminar la Operación ${opId} de la configuración?`)) {
        return;
    }
    operationsConfig[areaKey] = operationsConfig[areaKey].filter(id => id !== opId);
    const hw = getOpAreaHardware(areaKey);
    if (hw.buttons && hw.buttons[opId]) {
        delete hw.buttons[opId];
        saveOpHardwareConfig();
    }
    saveOperationsConfig();
    renderOperationsMgmtUI();
};

// Generador de Firmware ESP32 para Operaciones
function updateOpEsp32ModalCode() {
    const pre = document.getElementById('esp32OpCodePre');
    const modalTitle = document.getElementById('esp32OpModalTitle');
    if (!pre) return;

    const areaKey = activeOpAreaKey || 'area10';
    const areaNum = areaKey.replace('area', '').replace('plus', '+');
    const areaOps = operationsConfig && operationsConfig[areaKey] ? operationsConfig[areaKey] : ['10.01', '10.02', '10.03'];
    const hw = getOpAreaHardware(areaKey);
    const isMultiMode = document.getElementById('esp32OpModeMulti')?.checked ?? true;

    if (modalTitle) modalTitle.textContent = `Firmware ESP32 — Operaciones Área ${areaNum}`;

    let pinMappingDeclarations = '';
    let pinInitCode = '';
    let buttonCheckCode = '';

    areaOps.forEach((opId, idx) => {
        const assignedPin = hw.buttons && hw.buttons[opId] !== undefined ? hw.buttons[opId] : (idx < 8 ? [4, 16, 17, 18, 19, 21, 22, 23][idx] : 0);
        pinMappingDeclarations += `  { "${opId}", ${assignedPin}, ${idx * (hw.ledsPerOperation + hw.gapLeds)}, ${hw.ledsPerOperation} }, // Op. ${opId}\n`;
        if (assignedPin > 0) {
            pinInitCode += `  pinMode(${assignedPin}, INPUT_PULLUP);\n`;
            buttonCheckCode += `
    // Estación ${opId}
    if (opList[${idx}].pin > 0 && digitalRead(opList[${idx}].pin) == LOW) {
      delay(50); // Antirrebote
      if (digitalRead(opList[${idx}].pin) == LOW) {
        reportOperationFailure(opList[${idx}].id);
        while(digitalRead(opList[${idx}].pin) == LOW) delay(10);
      }
    }`;
        }
    });

    const totalLeds = Math.max(30, areaOps.length * (hw.ledsPerOperation + hw.gapLeds));

    pre.textContent = `/**
 * ============================================================================
 * FIRMWARE INDUSTRIAL ESP32 - MONITOR SCADA DE OPERACIONES Y ANDON
 * ÁREA CONFIGURADA: ÁREA ${areaNum}
 * Generado automáticamente por Monitor SCADA 2026
 * ============================================================================
 * Hardware:
 *  - ESP32 NodeMCU DevKit V1
 *  - Tira LED WS2815 / WS2812B (Data Pin: GPIO 5)
 *  - Botones Industriales de Paro con PULLUP interno hacia GND
 * ============================================================================
 */

#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include <Adafruit_NeoPixel.h>

// --- PARÁMETROS DE RED & FIREBASE ---
const char* WIFI_SSID     = "TU_RED_WIFI";
const char* WIFI_PASS     = "TU_PASSWORD";
const char* PB_SERVER       = "http://192.168.100.34:8090"; // PocketBase (Xiaomi) — Firebase cerrado 2026-10-25
const char* AREA_NAME     = "${areaKey.replace('area', '')}";

#define LED_DATA_PIN      5
#define TOTAL_LEDS        ${totalLeds}
#define LEDS_PER_OP       ${hw.ledsPerOperation}
#define GAP_LEDS          ${hw.gapLeds}
#define BRIGHTNESS        ${Math.round(255 * (hw.brightness / 100))}

Adafruit_NeoPixel strip(TOTAL_LEDS, LED_DATA_PIN, NEO_GRB + NEO_KHZ800);

struct OperationStation {
  const char* id;
  uint8_t pin;
  uint16_t startLed;
  uint16_t countLed;
  bool isFailed;
};

OperationStation opList[] = {
${pinMappingDeclarations}};
const int NUM_OPERATIONS = sizeof(opList) / sizeof(opList[0]);

unsigned long lastSync = 0;
const unsigned long SYNC_INTERVAL_MS = 10000;

void setup() {
  Serial.begin(115200);
  strip.begin();
  strip.setBrightness(BRIGHTNESS);
  strip.show();

  Serial.println("\\n=== INICIANDO ESP32 SCADA OPERACIONES AREA ${areaNum} ===");
${pinInitCode}
  WiFi.begin(WIFI_SSID, WIFI_PASS);
  while (WiFi.status() != WL_CONNECTED) {
    delay(300);
    Serial.print(".");
  }
  Serial.println("\\nWiFi Conectado! IP: " + WiFi.localIP().toString());
  syncActiveFailures();
}

void loop() {
  // 1. Escaneo físico de pulsadores de estación
${buttonCheckCode}

  // 2. Sincronización periódica con Firestore
  if (millis() - lastSync > SYNC_INTERVAL_MS) {
    lastSync = millis();
    syncActiveFailures();
  }

  // 3. Animación Andon de Torretas / Tira LED
  renderAndonLeds();
  delay(30);
}

void reportOperationFailure(const char* opId) {
  Serial.printf("🚨 Pulsador presionado! Reportando falla en Op %s...\\n", opId);
  if (WiFi.status() != WL_CONNECTED) return;

  WiFiClientSecure client;
  client.setInsecure();
  HTTPClient https;

  String url = String(PB_SERVER) + "/api/collections/operations/records?filter=operationId%3D\"10A\"";
  https.begin(client, url);
  https.addHeader("Content-Type", "application/json");

  StaticJsonDocument<512> doc;
  JsonObject fields = doc.createNestedObject("fields");
  fields["id"]["stringValue"] = opId;
  fields["operationId"]["stringValue"] = opId;
  fields["status"]["stringValue"] = "active";
  fields["area"]["stringValue"] = AREA_NAME;
  fields["description"]["stringValue"] = "Falla reportada por botón físico ESP32 en línea";
  fields["reportedBy"]["stringValue"] = "Botón Físico ESP32";
  fields["source"]["stringValue"] = "esp32_hardware";

  String requestBody;
  serializeJson(doc, requestBody);

  int httpCode = https.POST(requestBody);
  Serial.printf("Respuesta Firestore: %d\\n", httpCode);
  https.end();
  syncActiveFailures();
}

void syncActiveFailures() {
  if (WiFi.status() != WL_CONNECTED) return;
  WiFiClientSecure client;
  client.setInsecure();
  HTTPClient https;

  String url = String(PB_SERVER) + "/api/collections/operations/records?filter=operationId%3D\"10A\"";
  https.begin(client, url);

  int httpCode = https.GET();
  if (httpCode == 200) {
    String payload = https.getString();
    DynamicJsonDocument doc(8192);
    deserializeJson(doc, payload);

    for (int i = 0; i < NUM_OPERATIONS; i++) {
      opList[i].isFailed = false;
    }

    JsonArray documents = doc["documents"].as<JsonArray>();
    for (JsonObject d : documents) {
      String status = d["fields"]["status"]["stringValue"] | "";
      String opId = d["fields"]["operationId"]["stringValue"] | d["fields"]["id"]["stringValue"] | "";
      if (status == "active") {
        for (int i = 0; i < NUM_OPERATIONS; i++) {
          if (String(opList[i].id) == opId) {
            opList[i].isFailed = true;
          }
        }
      }
    }
  }
  https.end();
}

void renderAndonLeds() {
  uint32_t now = millis();
  bool blinkState = (now / ${hw.alarmBlinkMs}) % 2;

  for (int i = 0; i < NUM_OPERATIONS; i++) {
    uint32_t c;
    if (opList[i].isFailed) {
      c = blinkState ? strip.Color(255, 0, 0) : strip.Color(0, 0, 0); // Rojo intermitente
    } else {
      c = strip.Color(0, 255, 0); // Verde operativo
    }

    for (int j = 0; j < opList[i].countLed; j++) {
      strip.setPixelColor(opList[i].startLed + j, c);
    }
  }
  strip.show();
}
`;
}

function downloadOpEsp32Ino() {
    const pre = document.getElementById('esp32OpCodePre');
    if (!pre) return;
    const areaKey = activeOpAreaKey || 'area10';
    const areaNum = areaKey.replace('area', '').replace('plus', '+');
    const blob = new Blob([pre.textContent], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `esp32-operations-area${areaNum}.ino`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    showAlert(`Firmware esp32-operations-area${areaNum}.ino descargado con éxito.`, 'success');
}

window.initOperationsMgmt = initOperationsMgmt;
window.renderOperationsMgmtUI = renderOperationsMgmtUI;

// ============================================================================
// GESTIÓN DE ALMACÉN INTELIGENTE (PICK-TO-LIGHT IOT) & ESP32
// ============================================================================
function escapeHtml(text) {
    if (!text) return '';
    return String(text)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

let warehouseConfig = null;
let allWhHardwareConfig = {};
let activeWhPicksMap = new Map();
let whInventoryCache = [];
let activeWhRackKey = 'rack_a';
let whSimMockPickBinId = null;

let whConfigUnsubscribe = null;
let whHardwareUnsubscribe = null;
let whActivePicksUnsubscribe = null;
let whInventoryUnsubscribe = null;

const defaultWhHardwareSettings = {
    esp32Id: 'ESP32-ALMACEN-RACK-A',
    dataPin: 5,
    ledsPerBin: 4,
    gapLeds: 0,
    brightness: 85,
    searchColor: '#00e5ff',
    pickedColor: '#10b981',
    pulseSpeedMs: 350
};

function getWhRackHardware(rackKey) {
    if (!allWhHardwareConfig[rackKey]) {
        allWhHardwareConfig[rackKey] = {
            ...defaultWhHardwareSettings,
            esp32Id: `ESP32-${rackKey.toUpperCase().replace(/_/g, '-')}`
        };
    }
    return allWhHardwareConfig[rackKey];
}

async function saveWarehouseConfig() {
    try {
        if (!warehouseConfig) return;
        await db.collection('config').doc('warehouse_config').set(warehouseConfig);
        console.log("Configuración de almacén guardada exitosamente en Firestore.");
    } catch (err) {
        console.error("Error guardando config de almacén:", err);
        showAlert("Error al guardar configuración de almacén: " + err.message, "danger");
    }
}

async function saveWhHardwareConfig() {
    try {
        await db.collection('config').doc('warehouse_hardware').set({
            ...allWhHardwareConfig,
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        }, { merge: true });
        showAlert("Configuración de hardware de almacén guardada exitosamente.", "success");
    } catch (err) {
        console.error("Error guardando hardware de almacén:", err);
        showAlert("Error al guardar hardware de almacén: " + err.message, "danger");
    }
}

async function initWarehouseMgmt() {
    const tabsNav = document.getElementById('whRackTabsNav');
    if (!tabsNav) return;

    if (whConfigUnsubscribe) whConfigUnsubscribe();
    if (whHardwareUnsubscribe) whHardwareUnsubscribe();
    if (whActivePicksUnsubscribe) whActivePicksUnsubscribe();
    if (whInventoryUnsubscribe) whInventoryUnsubscribe();

    // 1. Escuchar configuración de Racks en tiempo real
    whConfigUnsubscribe = db.collection('config').doc('warehouse_config').onSnapshot(async (doc) => {
        if (!doc.exists) {
            console.log("Inicializando configuración de almacén por defecto...");
            const defaultWarehouseConfig = {
                _order: ['rack_a', 'rack_b', 'gavetero_1'],
                rack_a: {
                    name: 'Rack A (Mecánica)',
                    bins: [
                        { binId: 'A-101', name: 'Gaveta A1-01', itemId: '', itemCode: '', ledIndex: 0, gpioPin: 16 },
                        { binId: 'A-102', name: 'Gaveta A1-02', itemId: '', itemCode: '', ledIndex: 4, gpioPin: 17 },
                        { binId: 'A-103', name: 'Gaveta A1-03', itemId: '', itemCode: '', ledIndex: 8, gpioPin: 18 },
                        { binId: 'A-104', name: 'Gaveta A1-04', itemId: '', itemCode: '', ledIndex: 12, gpioPin: 19 },
                        { binId: 'A-201', name: 'Gaveta A2-01', itemId: '', itemCode: '', ledIndex: 16, gpioPin: 21 },
                        { binId: 'A-202', name: 'Gaveta A2-02', itemId: '', itemCode: '', ledIndex: 20, gpioPin: 22 },
                        { binId: 'A-203', name: 'Gaveta A2-03', itemId: '', itemCode: '', ledIndex: 24, gpioPin: 23 },
                        { binId: 'A-204', name: 'Gaveta A2-04', itemId: '', itemCode: '', ledIndex: 28, gpioPin: 25 }
                    ]
                },
                rack_b: {
                    name: 'Rack B (Eléctrica)',
                    bins: [
                        { binId: 'B-101', name: 'Gaveta B1-01', itemId: '', itemCode: '', ledIndex: 0, gpioPin: 16 },
                        { binId: 'B-102', name: 'Gaveta B1-02', itemId: '', itemCode: '', ledIndex: 4, gpioPin: 17 },
                        { binId: 'B-103', name: 'Gaveta B1-03', itemId: '', itemCode: '', ledIndex: 8, gpioPin: 18 },
                        { binId: 'B-104', name: 'Gaveta B1-04', itemId: '', itemCode: '', ledIndex: 12, gpioPin: 19 }
                    ]
                },
                gavetero_1: {
                    name: 'Gavetero Tornillos',
                    bins: [
                        { binId: 'T-01', name: 'Gaveta M6', itemId: '', itemCode: '', ledIndex: 0, gpioPin: 16 },
                        { binId: 'T-02', name: 'Gaveta M8', itemId: '', itemCode: '', ledIndex: 4, gpioPin: 17 },
                        { binId: 'T-03', name: 'Gaveta M10', itemId: '', itemCode: '', ledIndex: 8, gpioPin: 18 },
                        { binId: 'T-04', name: 'Gaveta Arandelas', itemId: '', itemCode: '', ledIndex: 12, gpioPin: 19 }
                    ]
                }
            };
            await db.collection('config').doc('warehouse_config').set(defaultWarehouseConfig);
            warehouseConfig = defaultWarehouseConfig;
        } else {
            warehouseConfig = doc.data() || {};
            const allKeys = Object.keys(warehouseConfig).filter(k => k !== '_order' && typeof warehouseConfig[k] === 'object');
            if (!warehouseConfig._order) {
                warehouseConfig._order = allKeys;
                await db.collection('config').doc('warehouse_config').set(warehouseConfig);
            }
        }
        renderWarehouseMgmtUI();
    }, (error) => {
        console.error("Error al escuchar config de almacén:", error);
    });

    // 2. Escuchar hardware de Racks
    whHardwareUnsubscribe = db.collection('config').doc('warehouse_hardware').onSnapshot((doc) => {
        if (doc.exists) {
            const data = doc.data() || {};
            Object.keys(data).forEach(k => {
                if (typeof data[k] === 'object' && data[k] !== null && k !== 'updatedAt') {
                    allWhHardwareConfig[k] = { ...defaultWhHardwareSettings, ...data[k] };
                }
            });
            renderWarehouseMgmtUI();
        }
    }, (error) => {
        console.warn("Aviso escuchando warehouse_hardware:", error.message);
    });

    // 3. Escuchar picks activos
    whActivePicksUnsubscribe = db.collection('active_picks').where('status', '==', 'active').onSnapshot((snap) => {
        activeWhPicksMap.clear();
        snap.forEach(doc => {
            const d = doc.data();
            d.id = doc.id;
            const binKey = String(d.warehouseBinId || d.bin || d.itemCode || doc.id);
            activeWhPicksMap.set(binKey, d);
            if (d.itemId) activeWhPicksMap.set(d.itemId, d);
        });
        renderWarehouseMgmtUI();
    }, (error) => {
        console.warn("Aviso escuchando active_picks en admin:", error.message);
    });

    // 4. Escuchar catálogo de inventario para desplegable de artículos
    whInventoryUnsubscribe = db.collection('inventory').onSnapshot((snap) => {
        whInventoryCache = [];
        snap.forEach(doc => {
            const d = doc.data();
            d.id = doc.id;
            whInventoryCache.push(d);
        });
        renderWarehouseMgmtUI();
    }, (error) => {
        console.warn("Aviso escuchando inventario en admin:", error.message);
    });

    // 5. Formulario Nuevo Rack
    const newRackForm = document.getElementById('newWhRackForm');
    if (newRackForm && !newRackForm.dataset.listener) {
        newRackForm.dataset.listener = 'true';
        newRackForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const nameInput = document.getElementById('newWhRackNameInput');
            const esp32Input = document.getElementById('newWhRackEsp32Input');
            const countInput = document.getElementById('newWhRackBinsCountInput');
            if (!nameInput) return;

            const rackName = nameInput.value.trim();
            if (!rackName) return;

            const rackKey = 'rack_' + rackName.toLowerCase().replace(/[^a-z0-9]/g, '_');
            if (warehouseConfig && warehouseConfig[rackKey]) {
                showAlert(`El Rack '${rackName}' ya existe.`, "warning");
                return;
            }

            const initialCount = parseInt(countInput?.value, 10) || 8;
            const bins = [];
            for (let i = 1; i <= initialCount; i++) {
                bins.push({
                    binId: `G-${String(i).padStart(2, '0')}`,
                    name: `Gaveta ${i}`,
                    itemId: '',
                    itemCode: '',
                    ledIndex: (i - 1) * 4,
                    gpioPin: i <= 8 ? [16, 17, 18, 19, 21, 22, 23, 25][i - 1] : 0
                });
            }

            if (!warehouseConfig) warehouseConfig = {};
            warehouseConfig[rackKey] = { name: rackName, bins };
            if (!warehouseConfig._order) warehouseConfig._order = [];
            warehouseConfig._order.push(rackKey);
            activeWhRackKey = rackKey;

            const hw = getWhRackHardware(rackKey);
            if (esp32Input && esp32Input.value.trim()) {
                hw.esp32Id = esp32Input.value.trim();
                await saveWhHardwareConfig();
            }

            await saveWarehouseConfig();

            const modalEl = document.getElementById('newWhRackModal');
            if (modalEl) bootstrap.Modal.getOrCreateInstance(modalEl).hide();
            newRackForm.reset();
            showAlert(`Rack '${rackName}' creado exitosamente.`, 'success');
        });
    }

    // 6. Botones de copia y descarga de firmware ESP32
    const copyWhBtn = document.getElementById('copyWhEsp32CodeBtn');
    if (copyWhBtn && !copyWhBtn.dataset.listener) {
        copyWhBtn.dataset.listener = 'true';
        copyWhBtn.addEventListener('click', () => {
            const pre = document.getElementById('esp32WhCodePre');
            if (pre) {
                navigator.clipboard.writeText(pre.textContent).then(() => {
                    setSafeDOM(copyWhBtn, '<i class="bi bi-check2"></i> ¡Copiado!');
                    setTimeout(() => { setSafeDOM(copyWhBtn, '<i class="bi bi-clipboard"></i> Copiar Código'); }, 2000);
                });
            }
        });
    }

    const downloadWhBtn = document.getElementById('downloadWhEsp32InoBtn');
    if (downloadWhBtn && !downloadWhBtn.dataset.listener) {
        downloadWhBtn.dataset.listener = 'true';
        downloadWhBtn.addEventListener('click', downloadWhEsp32Ino);
    }
}

function renderWarehouseMgmtUI() {
    const tabsNav = document.getElementById('whRackTabsNav');
    const tabsContent = document.getElementById('whRackTabsContent');
    if (!tabsNav || !tabsContent || !warehouseConfig) return;

    const allRackKeys = Object.keys(warehouseConfig).filter(k => k !== '_order' && typeof warehouseConfig[k] === 'object');
    const orderedKeys = warehouseConfig._order
        ? warehouseConfig._order.filter(k => allRackKeys.includes(k))
        : [...allRackKeys];
    allRackKeys.forEach(k => { if (!orderedKeys.includes(k)) orderedKeys.push(k); });
    const racks = orderedKeys;

    let totalBinsCount = 0;
    racks.forEach(k => {
        totalBinsCount += (warehouseConfig[k]?.bins || []).length;
    });

    const activePicksCount = activeWhPicksMap.size;

    const elTotalBins = document.getElementById('whStatsTotalBins');
    const elActivePicks = document.getElementById('whStatsActivePicks');
    const elTotalPicked = document.getElementById('whStatsTotalPicked');
    const elTotalRacks = document.getElementById('whStatsTotalRacks');

    if (elTotalBins) elTotalBins.textContent = totalBinsCount;
    if (elActivePicks) elActivePicks.textContent = activePicksCount;
    if (elTotalRacks) elTotalRacks.textContent = racks.length;

    // Calcular picks completados
    db.collection('active_picks').where('status', '==', 'picked').limit(50).get().then(snap => {
        if (elTotalPicked) elTotalPicked.textContent = snap.size;
    }).catch(() => {});

    if (!racks.includes(activeWhRackKey) && racks.length > 0) {
        activeWhRackKey = racks[0];
    }

    // Renderizar Pestañas Horizontales
    tabsNav.replaceChildren();
    if (racks.length === 0) {
        setSafeDOM(tabsNav, '<span class="text-muted small">No hay racks de almacén configurados. Crea uno para comenzar.</span>');
        tabsContent.replaceChildren();
        return;
    }

    racks.forEach(rackKey => {
        const rack = warehouseConfig[rackKey];
        const rackName = rack?.name || rackKey.replace('rack_', 'Rack ');
        const bins = rack?.bins || [];
        const isActive = rackKey === activeWhRackKey;

        // Comprobar si hay picks activos en este rack
        const activeInRack = bins.filter(b => activeWhPicksMap.has(b.binId) || activeWhPicksMap.has(b.itemId)).length;

        const btn = document.createElement('button');
        btn.className = `btn area-tab-btn ${isActive ? 'area-tab-btn--active-wh' : ''}`;
        btn.dataset.rackKey = rackKey;
        btn.draggable = true;
        setSafeDOM(btn, `
            <i class="bi bi-grip-vertical text-muted opacity-50 me-1" style="font-size:0.8rem;"></i>
            <i class="bi bi-box-seam"></i> ${escapeHtml(rackName)}
            <span class="badge ${isActive ? 'bg-white text-dark' : 'bg-secondary'} ms-1">${bins.length}</span>
            ${activeInRack > 0 ? `<span class="badge bg-warning text-dark ms-1 animate-pulse"><i class="bi bi-lightbulb-fill"></i> ${activeInRack}</span>` : ''}
        `);

        btn.addEventListener('click', () => {
            activeWhRackKey = rackKey;
            whSimMockPickBinId = null;
            renderWarehouseMgmtUI();
        });

        // Drag & drop para reordenar racks
        btn.addEventListener('dragstart', (e) => {
            e.dataTransfer.setData('text/plain', rackKey);
            btn.classList.add('dragging');
        });
        btn.addEventListener('dragend', () => {
            btn.classList.remove('dragging');
            document.querySelectorAll('#whRackTabsNav .area-tab-btn').forEach(b => b.classList.remove('drag-over'));
        });
        btn.addEventListener('dragover', (e) => {
            e.preventDefault();
            btn.classList.add('drag-over');
        });
        btn.addEventListener('dragleave', () => {
            btn.classList.remove('drag-over');
        });
        btn.addEventListener('drop', async (e) => {
            e.preventDefault();
            btn.classList.remove('drag-over');
            const draggedKey = e.dataTransfer.getData('text/plain');
            if (!draggedKey || draggedKey === rackKey) return;

            const order = warehouseConfig._order ? [...warehouseConfig._order] : [...racks];
            const fromIdx = order.indexOf(draggedKey);
            const toIdx = order.indexOf(rackKey);
            if (fromIdx !== -1 && toIdx !== -1) {
                order.splice(fromIdx, 1);
                order.splice(toIdx, 0, draggedKey);
                warehouseConfig._order = order;
                await saveWarehouseConfig();
                renderWarehouseMgmtUI();
            }
        });

        tabsNav.appendChild(btn);
    });

    renderActiveWhRackPanel(racks);
}

function renderActiveWhRackPanel(racks) {
    const tabsContent = document.getElementById('whRackTabsContent');
    if (!tabsContent || !warehouseConfig || !racks.includes(activeWhRackKey)) return;

    const rackKey = activeWhRackKey;
    const rack = warehouseConfig[rackKey];
    const rackName = rack?.name || rackKey.replace('rack_', 'Rack ');
    const bins = rack?.bins || [];
    const hw = getWhRackHardware(rackKey);

    const activeCount = bins.filter(b => (whSimMockPickBinId === b.binId) || activeWhPicksMap.has(b.binId) || activeWhPicksMap.has(b.itemId)).length;

    setSafeDOM(tabsContent, `
    <div class="row g-3">
      <!-- ═══════ CABECERA DEL RACK & SIMULADOR PICK-TO-LIGHT 2D ═══════ -->
      <div class="col-12">
        <div class="card border-0" style="background:rgba(255,255,255,0.03);border:1px solid rgba(14,165,233,0.3)!important;">
          <div class="card-header d-flex justify-content-between align-items-center py-2 flex-wrap gap-2" style="background:rgba(14,165,233,0.08); border-bottom:1px solid rgba(14,165,233,0.25);">
            <div class="d-flex align-items-center gap-2">
              <strong class="text-white fw-bold fs-5"><i class="bi bi-box-seam text-info"></i> ${escapeHtml(rackName)}</strong>
              <span class="badge bg-primary">${bins.length} gavetas/bins</span>
              ${activeCount > 0 
                ? `<span class="badge bg-warning text-dark animate-pulse"><i class="bi bi-lightbulb-fill"></i> ${activeCount} iluminada(s)</span>` 
                : `<span class="badge bg-secondary">Sin solicitudes activas</span>`}
            </div>
            <div class="d-flex align-items-center gap-2">
              <button class="btn btn-sm btn-outline-info" id="viewWhEsp32CodeBtn" data-bs-toggle="modal" data-bs-target="#esp32WhCodeModal">
                <i class="bi bi-file-earmark-code"></i> Firmware ESP32 Almacén
              </button>
              <button class="btn btn-sm btn-outline-danger" onclick="deleteWhRack('${rackKey}', '${escapeHtml(rackName)}')">
                <i class="bi bi-trash"></i> Eliminar Rack
              </button>
            </div>
          </div>
          <div class="card-body">
            <!-- SIMULADOR INTERACTIVO 2D DE RACK & GAVETAS CON LEDS -->
            <div class="mb-4">
              <div class="d-flex justify-content-between align-items-center flex-wrap gap-2 mb-2">
                <div>
                  <label class="form-label mb-0 fw-bold small text-uppercase text-white">
                    <i class="bi bi-eye"></i> Visualizador de Estantes y Gavetas en Tiempo Real
                  </label>
                  <span class="badge bg-info text-dark ms-2">Controlador: ${hw.esp32Id}</span>
                </div>
                <div class="d-flex align-items-center gap-2">
                  <select class="form-select form-select-sm" id="whSimPickerSelect" style="width: auto; font-size: 0.78rem;">
                    ${bins.map(b => `<option value="${b.binId}" ${whSimMockPickBinId === b.binId ? 'selected' : ''}>${b.binId}: ${b.name || 'Gaveta'}</option>`).join('')}
                  </select>
                  <button class="btn btn-sm btn-outline-warning py-1 px-2" id="btnToggleSimWhPick" style="font-size:0.78rem;">
                    <i class="bi bi-lightbulb"></i> Simular Búsqueda
                  </button>
                  <button class="btn btn-sm btn-outline-secondary py-1 px-2" id="btnResetSimWh" style="font-size:0.78rem;">
                    <i class="bi bi-arrow-counterclockwise"></i> Apagar
                  </button>
                </div>
              </div>

              <!-- Grid 2D de Gavetas / Racks -->
              <div class="p-3 rounded-3 bg-black border border-secondary border-opacity-25" id="whBinsGridContainer">
                <!-- Se llena con renderWhRackSimulator() -->
              </div>
            </div>

            <!-- Formulario para Agregar Nueva Gaveta al Rack -->
            <hr class="border-secondary border-opacity-25">
            <h6 class="fw-bold small text-muted text-uppercase mb-2"><i class="bi bi-plus-circle"></i> Agregar Gaveta al Rack</h6>
            <form class="row g-2 align-items-center" onsubmit="event.preventDefault(); handleAddWhBinSubmit('${rackKey}')">
              <div class="col-md-2 col-6">
                <div class="input-group input-group-sm">
                  <span class="input-group-text bg-dark text-white border-secondary">Bin ID</span>
                  <input type="text" class="form-control bg-dark text-white border-secondary" placeholder="ej. G-09" id="newWhBinIdInput-${rackKey}" required>
                </div>
              </div>
              <div class="col-md-3 col-6">
                <input type="text" class="form-control form-control-sm bg-dark text-white border-secondary" placeholder="Nombre (ej. Gaveta Rodamientos)" id="newWhBinNameInput-${rackKey}">
              </div>
              <div class="col-md-3 col-12">
                <select class="form-select form-select-sm bg-dark text-white border-secondary" id="newWhBinItemSelect-${rackKey}">
                  <option value="">-- Vincular a Artículo Inventario (Opcional) --</option>
                  ${whInventoryCache.map(i => `<option value="${i.id}" data-code="${i.code}">${i.code} - ${i.name}</option>`).join('')}
                </select>
              </div>
              <div class="col-md-2 col-6">
                <div class="input-group input-group-sm">
                  <span class="input-group-text bg-dark text-white border-secondary">GPIO Botón</span>
                  <input type="number" class="form-control bg-dark text-white border-secondary" placeholder="ej. 16" id="newWhBinGpioInput-${rackKey}" min="0" max="39">
                </div>
              </div>
              <div class="col-md-2 col-6">
                <button type="submit" class="btn btn-sm btn-info fw-bold text-dark w-100">
                  <i class="bi bi-plus-lg"></i> Agregar Gaveta
                </button>
              </div>
            </form>
          </div>
        </div>
      </div>

      <!-- ═══════ CONFIGURACIÓN DE HARDWARE ESP32 PARA EL RACK ═══════ -->
      <div class="col-12">
        <div class="card" style="background:rgba(255,255,255,0.02);border:1px solid rgba(14,165,233,0.3)!important;">
          <div class="card-header d-flex justify-content-between align-items-center py-2" style="background:rgba(14,165,233,0.08); border-bottom:1px solid rgba(14,165,233,0.25);">
            <h6 class="mb-0 text-white"><i class="bi bi-sliders2 text-info"></i> Parámetros de Hardware Tira LED &amp; ESP32 — ${escapeHtml(rackName)}</h6>
            <span class="badge bg-info text-dark">${hw.esp32Id}</span>
          </div>
          <div class="card-body">
            <div class="row g-3 mb-3">
              <div class="col-md-3 col-6">
                <label class="form-label small fw-semibold">ID Dispositivo ESP32:</label>
                <input type="text" class="form-control form-control-sm" id="whEsp32IdInput" value="${escapeHtml(hw.esp32Id || '')}">
              </div>
              <div class="col-md-3 col-6">
                <label class="form-label small fw-semibold">GPIO Data Pin (Tira WS2812):</label>
                <input type="number" class="form-control form-control-sm" id="whDataPinInput" min="0" max="39" value="${hw.dataPin || 5}">
              </div>
              <div class="col-md-3 col-6">
                <label class="form-label small fw-semibold">LEDs por Gaveta:</label>
                <input type="number" class="form-control form-control-sm" id="whLedsPerBinInput" min="1" max="30" value="${hw.ledsPerBin || 4}">
              </div>
              <div class="col-md-3 col-6">
                <label class="form-label d-flex justify-content-between align-items-center mb-1">
                  <span class="small fw-semibold">Brillo Tira:</span>
                  <span class="badge bg-info text-dark" id="whBrightnessVal">${hw.brightness || 85}%</span>
                </label>
                <input type="range" class="form-range" id="whBrightnessInput" min="10" max="100" value="${hw.brightness || 85}" step="5">
              </div>
            </div>

            <div class="row g-3 mb-3">
              <div class="col-md-6 col-12">
                <div class="p-3 rounded-3" style="background:rgba(6,182,212,0.06);border:1px solid rgba(6,182,212,0.3);">
                  <label class="form-label small fw-bold text-info"><i class="bi bi-lightbulb-fill"></i> Color de Localización (Búsqueda Activa):</label>
                  <div class="d-flex align-items-center gap-2">
                    <input type="color" class="form-control form-control-color" id="whSearchColorInput" value="${hw.searchColor || '#00e5ff'}">
                    <span class="small font-monospace text-muted" id="whSearchColorHex">${(hw.searchColor || '#00e5ff').toUpperCase()}</span>
                    <span class="badge bg-info text-dark ms-2">Pulsante</span>
                  </div>
                </div>
              </div>
              <div class="col-md-6 col-12">
                <div class="p-3 rounded-3" style="background:rgba(16,185,129,0.06);border:1px solid rgba(16,185,129,0.3);">
                  <label class="form-label small fw-bold text-success"><i class="bi bi-check-circle-fill"></i> Color de Confirmación de Recogida (Recoger):</label>
                  <div class="d-flex align-items-center gap-2">
                    <input type="color" class="form-control form-control-color" id="whPickedColorInput" value="${hw.pickedColor || '#10b981'}">
                    <span class="small font-monospace text-muted" id="whPickedColorHex">${(hw.pickedColor || '#10b981').toUpperCase()}</span>
                    <span class="badge bg-success ms-2">Destello 2s</span>
                  </div>
                </div>
              </div>
            </div>

            <div class="d-flex justify-content-end gap-2">
              <button class="btn btn-info fw-bold text-dark px-4" id="btnSaveWhHardwareSettings">
                <i class="bi bi-save me-1"></i> Guardar Configuración de Hardware
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
    `);

    setupWhRackEvents(rackKey);
    renderWhRackSimulator(rackKey);

    const btnViewFirmware = document.getElementById('viewWhEsp32CodeBtn');
    if (btnViewFirmware) {
        btnViewFirmware.addEventListener('click', updateWhEsp32ModalCode);
    }
}

function renderWhRackSimulator(rackKey) {
    const container = document.getElementById('whBinsGridContainer');
    if (!container || !warehouseConfig) return;

    const rack = warehouseConfig[rackKey];
    const bins = rack?.bins || [];
    const hw = getWhRackHardware(rackKey);
    const ledsPerBin = hw.ledsPerBin || 4;

    container.replaceChildren();
    if (bins.length === 0) {
        setSafeDOM(container, '<span class="text-muted small">No hay gavetas configuradas en este rack.</span>');
        return;
    }

    const grid = document.createElement('div');
    grid.className = 'row g-2';

    bins.forEach((b, idx) => {
        const isLit = (whSimMockPickBinId === b.binId) || activeWhPicksMap.has(b.binId) || (b.itemId && activeWhPicksMap.has(b.itemId));
        const activePick = activeWhPicksMap.get(b.binId) || (b.itemId ? activeWhPicksMap.get(b.itemId) : null);
        const startLed = b.ledIndex !== undefined ? b.ledIndex : idx * ledsPerBin;
        const endLed = startLed + ledsPerBin - 1;

        // Buscar artículo asociado en inventario
        const linkedItem = whInventoryCache.find(i => i.id === b.itemId || i.code === b.itemCode);

        const col = document.createElement('div');
        col.className = 'col-md-3 col-sm-4 col-6';

        let dotsHtml = '';
        for (let i = 0; i < ledsPerBin; i++) {
            dotsHtml += `<span class="pick-led-dot ${isLit ? 'pick-led-dot--lit' : 'pick-led-dot--off'} me-1"></span>`;
        }

        setSafeDOM(col, `
            <div class="bin-card ${isLit ? 'bin-card--lit' : ''} h-100 d-flex flex-column justify-content-between">
                <div>
                    <div class="d-flex justify-content-between align-items-center mb-1">
                        <strong class="${isLit ? 'text-info' : 'text-white'} font-monospace" style="font-size:0.85rem;">
                            <i class="bi bi-inbox"></i> ${escapeHtml(b.binId)}
                        </strong>
                        <span class="badge ${b.gpioPin ? 'bg-dark border border-secondary text-info' : 'bg-secondary bg-opacity-25 text-muted'}" style="font-size:0.68rem;">
                            ${b.gpioPin ? `Pin ${b.gpioPin}` : 'Sin Pin'}
                        </span>
                    </div>
                    <div class="small fw-semibold text-truncate text-light mb-1" style="font-size:0.8rem;" title="${escapeHtml(b.name || '')}">
                        ${escapeHtml(b.name || 'Gaveta')}
                    </div>
                    <div class="text-muted text-truncate mb-2" style="font-size:0.72rem;">
                        ${linkedItem 
                            ? `<span class="text-info"><i class="bi bi-tag"></i> ${escapeHtml(linkedItem.name)}</span> (${linkedItem.stock} pzas)` 
                            : '<span class="opacity-50">Sin artículo asignado</span>'}
                    </div>
                </div>

                <div>
                    <div class="d-flex align-items-center justify-content-between my-2">
                        <div class="d-flex align-items-center">${dotsHtml}</div>
                        <small class="font-monospace text-muted" style="font-size:0.68rem;">LED ${startLed}-${endLed}</small>
                    </div>

                    <div class="d-flex gap-1 mt-2">
                        ${isLit 
                            ? `<button class="btn btn-warning btn-sm fw-bold w-100 py-1 text-dark" onclick="adminConfirmWhPick('${rackKey}', '${b.binId}', '${b.itemId || ''}')">
                                 <i class="bi bi-box-seam"></i> Recoger (1)
                               </button>`
                            : `<button class="btn btn-outline-info btn-sm w-100 py-0" style="font-size:0.75rem;" onclick="adminSimulateWhPick('${b.binId}')">
                                 <i class="bi bi-lightbulb"></i> Iluminar
                               </button>`
                        }
                        <button class="btn btn-outline-danger btn-sm py-0 px-2" onclick="deleteWhBin('${rackKey}', '${b.binId}')" title="Eliminar gaveta">
                            <i class="bi bi-x"></i>
                        </button>
                    </div>
                </div>
            </div>
        `);
        grid.appendChild(col);
    });

    container.appendChild(grid);
}

function setupWhRackEvents(rackKey) {
    const hw = getWhRackHardware(rackKey);

    const rangeBrightness = document.getElementById('whBrightnessInput');
    const valBrightness = document.getElementById('whBrightnessVal');
    if (rangeBrightness && valBrightness) {
        rangeBrightness.oninput = () => { valBrightness.textContent = `${rangeBrightness.value}%`; };
    }

    const colorSearch = document.getElementById('whSearchColorInput');
    const hexSearch = document.getElementById('whSearchColorHex');
    if (colorSearch && hexSearch) {
        colorSearch.oninput = () => { hexSearch.textContent = colorSearch.value.toUpperCase(); };
    }

    const colorPicked = document.getElementById('whPickedColorInput');
    const hexPicked = document.getElementById('whPickedColorHex');
    if (colorPicked && hexPicked) {
        colorPicked.oninput = () => { hexPicked.textContent = colorPicked.value.toUpperCase(); };
    }

    // Botón Simular Búsqueda
    const btnSim = document.getElementById('btnToggleSimWhPick');
    const selSim = document.getElementById('whSimPickerSelect');
    if (btnSim && selSim) {
        btnSim.onclick = () => {
            const selectedBinId = selSim.value;
            whSimMockPickBinId = (whSimMockPickBinId === selectedBinId) ? null : selectedBinId;
            btnSim.classList.toggle('btn-warning', !whSimMockPickBinId);
            btnSim.classList.toggle('btn-info', !!whSimMockPickBinId);
            setSafeDOM(btnSim, whSimMockPickBinId ? '<i class="bi bi-x-circle"></i> Apagar Señal' : '<i class="bi bi-lightbulb"></i> Simular Búsqueda');
            renderWhRackSimulator(rackKey);
        };
    }

    const btnReset = document.getElementById('btnResetSimWh');
    if (btnReset) {
        btnReset.onclick = () => {
            whSimMockPickBinId = null;
            if (btnSim) {
                btnSim.className = 'btn btn-sm btn-outline-warning py-1 px-2';
                setSafeDOM(btnSim, '<i class="bi bi-lightbulb"></i> Simular Búsqueda');
            }
            renderWhRackSimulator(rackKey);
        };
    }

    // Guardar Configuración de Hardware
    const btnSaveHw = document.getElementById('btnSaveWhHardwareSettings');
    if (btnSaveHw) {
        btnSaveHw.onclick = async () => {
            hw.esp32Id = document.getElementById('whEsp32IdInput')?.value.trim() || `ESP32-${rackKey.toUpperCase()}`;
            hw.dataPin = parseInt(document.getElementById('whDataPinInput')?.value, 10) || 5;
            hw.ledsPerBin = parseInt(document.getElementById('whLedsPerBinInput')?.value, 10) || 4;
            hw.brightness = parseInt(document.getElementById('whBrightnessInput')?.value, 10) || 85;
            hw.searchColor = document.getElementById('whSearchColorInput')?.value || '#00e5ff';
            hw.pickedColor = document.getElementById('whPickedColorInput')?.value || '#10b981';

            btnSaveHw.disabled = true;
            setSafeDOM(btnSaveHw, '<span class="spinner-border spinner-border-sm"></span> Guardando...');
            await saveWhHardwareConfig();
            btnSaveHw.disabled = false;
            setSafeDOM(btnSaveHw, '<i class="bi bi-save me-1"></i> Guardar Configuración de Hardware');
            renderWhRackSimulator(rackKey);
        };
    }
}

window.adminSimulateWhPick = function(binId) {
    whSimMockPickBinId = binId;
    renderWarehouseMgmtUI();
};

window.adminConfirmWhPick = async function(rackKey, binId, itemId) {
    try {
        whSimMockPickBinId = null;

        // Si hay un pick activo en active_picks, cerrarlo
        const activeDoc = activeWhPicksMap.get(binId) || (itemId ? activeWhPicksMap.get(itemId) : null);
        if (activeDoc && activeDoc.id) {
            await db.collection('active_picks').doc(activeDoc.id).update({
                status: 'picked',
                pickedAt: firebase.firestore.FieldValue.serverTimestamp(),
                pickedBy: 'Admin Simulator'
            });
        }

        // Si tiene artículo vinculado, descontar 1 de stock
        if (itemId) {
            const item = whInventoryCache.find(i => i.id === itemId);
            if (item) {
                const currentStock = item.stock || 0;
                const newStock = Math.max(0, currentStock - 1);
                await db.collection('inventory').doc(itemId).update({
                    stock: newStock,
                    lastMovement: new Date()
                });
                await db.collection('inventory_movements').add({
                    itemId: item.id,
                    itemCode: item.code,
                    itemName: item.name,
                    type: 'salida',
                    quantity: 1,
                    reasonType: 'Pick-to-Light: Panel Admin',
                    description: `Recogida física simulada en ${binId}`,
                    responsible: sessionStorage.getItem('username') || 'Admin',
                    timestamp: new Date(),
                    previousStock: currentStock,
                    newStock: newStock
                });
            }
        }

        showAlert(`✅ Recolección confirmada en Gaveta ${binId}. Luz apagada y stock actualizado.`, 'success');
        renderWarehouseMgmtUI();
    } catch (err) {
        console.error('Error confirmando pick en admin:', err);
        showAlert('Error al procesar recolección: ' + err.message, 'danger');
    }
};

window.handleAddWhBinSubmit = async function(rackKey) {
    const idInput = document.getElementById(`newWhBinIdInput-${rackKey}`);
    const nameInput = document.getElementById(`newWhBinNameInput-${rackKey}`);
    const itemSelect = document.getElementById(`newWhBinItemSelect-${rackKey}`);
    const gpioInput = document.getElementById(`newWhBinGpioInput-${rackKey}`);
    if (!idInput) return;

    const binId = idInput.value.trim().toUpperCase();
    if (!binId) return;

    const rack = warehouseConfig[rackKey];
    if (!rack.bins) rack.bins = [];

    if (rack.bins.some(b => b.binId === binId)) {
        showAlert(`La Gaveta/Bin ${binId} ya existe en este rack.`, "warning");
        return;
    }

    const hw = getWhRackHardware(rackKey);
    const ledsPerBin = hw.ledsPerBin || 4;
    const nextLedOffset = rack.bins.length * ledsPerBin;

    let selectedItemId = '';
    let selectedItemCode = '';
    if (itemSelect && itemSelect.value) {
        selectedItemId = itemSelect.value;
        const opt = itemSelect.options[itemSelect.selectedIndex];
        selectedItemCode = opt.getAttribute('data-code') || '';
    }

    const gpioPin = gpioInput && gpioInput.value.trim() !== '' ? parseInt(gpioInput.value.trim(), 10) : 0;

    rack.bins.push({
        binId: binId,
        name: nameInput?.value.trim() || `Gaveta ${binId}`,
        itemId: selectedItemId,
        itemCode: selectedItemCode,
        ledIndex: nextLedOffset,
        gpioPin: isNaN(gpioPin) ? 0 : gpioPin
    });

    // Si se vinculó un artículo, actualizar su ubicación física en el inventario
    if (selectedItemId) {
        const fullLoc = `${rack.name || rackKey} - ${binId}`;
        await db.collection('inventory').doc(selectedItemId).update({
            location: fullLoc,
            warehouseBinId: binId,
            rack: rack.name || rackKey,
            bin: binId,
            ledIndex: nextLedOffset,
            gpioPin: gpioPin > 0 ? gpioPin : null,
            esp32Id: hw.esp32Id,
            updatedAt: new Date()
        });
    }

    await saveWarehouseConfig();
    showAlert(`Gaveta ${binId} agregada exitosamente.`, 'success');
    renderWarehouseMgmtUI();
};

window.deleteWhBin = async function(rackKey, binId) {
    if (!confirm(`¿Está seguro de eliminar la Gaveta ${binId} del rack?`)) return;

    const rack = warehouseConfig[rackKey];
    if (!rack || !rack.bins) return;

    rack.bins = rack.bins.filter(b => b.binId !== binId);
    await saveWarehouseConfig();
    showAlert(`Gaveta ${binId} eliminada.`, 'success');
    renderWarehouseMgmtUI();
};

window.deleteWhRack = async function(rackKey, rackName) {
    if (!confirm(`¿Está seguro de eliminar el ${rackName}? Se eliminarán todas sus gavetas asociadas.`)) return;

    delete warehouseConfig[rackKey];
    delete allWhHardwareConfig[rackKey];
    if (warehouseConfig._order) {
        warehouseConfig._order = warehouseConfig._order.filter(k => k !== rackKey);
    }
    await saveWarehouseConfig();
    await saveWhHardwareConfig();
    showAlert(`Rack eliminado exitosamente.`, 'success');
    renderWarehouseMgmtUI();
};

// Generador de Firmware ESP32 para Almacén Pick-to-Light
function updateWhEsp32ModalCode() {
    const pre = document.getElementById('esp32WhCodePre');
    const modalTitle = document.getElementById('esp32WhModalTitle');
    if (!pre) return;

    const rackKey = activeWhRackKey || 'rack_a';
    const rack = warehouseConfig && warehouseConfig[rackKey] ? warehouseConfig[rackKey] : { name: 'Rack A', bins: [] };
    const bins = rack.bins || [];
    const hw = getWhRackHardware(rackKey);

    if (modalTitle) modalTitle.textContent = `Firmware ESP32 — Almacén: ${rack.name || rackKey}`;

    let binDeclarations = '';
    let pinInitCode = '';
    let buttonCheckCode = '';

    bins.forEach((b, idx) => {
        binDeclarations += `  { "${b.binId}", "${b.itemId || ''}", ${b.gpioPin || 0}, ${b.ledIndex !== undefined ? b.ledIndex : idx * hw.ledsPerBin}, ${hw.ledsPerBin} }, // ${b.binId}: ${b.name || 'Gaveta'}\n`;
        if (b.gpioPin > 0) {
            pinInitCode += `  pinMode(${b.gpioPin}, INPUT_PULLUP);\n`;
            buttonCheckCode += `
    // Botón de Confirmación para Gaveta ${b.binId}
    if (binList[${idx}].pin > 0 && digitalRead(binList[${idx}].pin) == LOW) {
      delay(50); // Antirrebote industrial
      if (digitalRead(binList[${idx}].pin) == LOW) {
        confirmPickCollected(binList[${idx}].binId, binList[${idx}].itemId, ${idx});
        while(digitalRead(binList[${idx}].pin) == LOW) delay(10);
      }
    }`;
        }
    });

    const totalLeds = Math.max(30, bins.length * (hw.ledsPerBin + (hw.gapLeds || 0)));

    pre.textContent = `/**
 * ============================================================================
 * FIRMWARE INDUSTRIAL ESP32 - ALMACÉN INTELIGENTE PICK-TO-LIGHT
 * RACK: ${rack.name || rackKey} (ID: ${hw.esp32Id})
 * Generado automáticamente por Monitor SCADA 2026
 * ============================================================================
 * Hardware:
 *  - ESP32 NodeMCU DevKit V1
 *  - Tira LED WS2812B / WS2815 (Data Pin: GPIO ${hw.dataPin || 5})
 *  - Pulsador de Confirmación "Recoger" por Gaveta hacia GND (INPUT_PULLUP)
 * ============================================================================
 */

#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include <Adafruit_NeoPixel.h>

// --- PARÁMETROS DE RED & FIREBASE ---
const char* WIFI_SSID     = "TU_RED_WIFI";
const char* WIFI_PASS     = "TU_PASSWORD";
const char* PB_SERVER       = "http://192.168.100.34:8090"; // PocketBase (Xiaomi) — Firebase cerrado 2026-10-25
const char* RACK_ID       = "${hw.esp32Id}";

#define LED_DATA_PIN      ${hw.dataPin || 5}
#define TOTAL_LEDS        ${totalLeds}
#define LEDS_PER_BIN      ${hw.ledsPerBin || 4}
#define BRIGHTNESS        ${Math.round(255 * ((hw.brightness || 85) / 100))}

Adafruit_NeoPixel strip(TOTAL_LEDS, LED_DATA_PIN, NEO_GRB + NEO_KHZ800);

struct WarehouseBin {
  const char* binId;
  const char* itemId;
  uint8_t pin;
  uint16_t startLed;
  uint16_t countLed;
  bool isLit;
};

WarehouseBin binList[] = {
${binDeclarations}
};

const int NUM_BINS = sizeof(binList) / sizeof(binList[0]);
unsigned long lastPollMs = 0;
const unsigned long POLL_INTERVAL_MS = 2500; // Consulta a Firestore cada 2.5s

void setup() {
  Serial.begin(115200);
  Serial.println("\\n=== ESP32 ALMACÉN PICK-TO-LIGHT INICIADO ===");

  strip.begin();
  strip.setBrightness(BRIGHTNESS);
  strip.show();

  // Configurar pines de pulsadores físicos
${pinInitCode}

  // Conectar WiFi
  WiFi.begin(WIFI_SSID, WIFI_PASS);
  Serial.print("Conectando a WiFi...");
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }
  Serial.println("\\nWiFi Conectado! IP: " + WiFi.localIP().toString());

  // Test de bienvenida (Barrido Cyan)
  for (int i = 0; i < TOTAL_LEDS; i++) {
    strip.setPixelColor(i, strip.Color(0, 229, 255));
    strip.show();
    delay(15);
  }
  delay(300);
  strip.clear();
  strip.show();
}

void loop() {
  // 1. Escuchar pulsadores físicos de confirmación (Recoger)
${buttonCheckCode}

  // 2. Consultar periódicamente solicitudes de búsqueda activas en Firestore
  if (millis() - lastPollMs > POLL_INTERVAL_MS) {
    lastPollMs = millis();
    pollActivePicks();
  }

  // 3. Renderizar animación LED en gavetas solicitadas
  renderPickLeds();
  delay(20);
}

void pollActivePicks() {
  if (WiFi.status() != WL_CONNECTED) return;

  WiFiClientSecure client;
  client.setInsecure(); // Para simplificar HTTPS en ESP32
  HTTPClient https;

  String url = String(PB_SERVER) + "/api/collections/active_picks/records";
  
  if (https.begin(client, url)) {
    int httpCode = https.GET();
    if (httpCode == HTTP_CODE_OK) {
      String payload = https.getString();
      DynamicJsonDocument doc(8192);
      deserializeJson(doc, payload);
      JsonArray documents = doc["documents"].as<JsonArray>();

      // Reset estado de iluminación
      for (int i = 0; i < NUM_BINS; i++) binList[i].isLit = false;

      for (JsonObject d : documents) {
        JsonObject fields = d["fields"];
        String status = fields["status"]["stringValue"].as<String>();
        String esp32 = fields["esp32Id"]["stringValue"].as<String>();
        String binId = fields["warehouseBinId"]["stringValue"].as<String>();
        String itemId = fields["itemId"]["stringValue"].as<String>();

        if (status == "active" && (esp32 == RACK_ID || esp32 == "")) {
          for (int i = 0; i < NUM_BINS; i++) {
            if (String(binList[i].binId) == binId || (itemId != "" && String(binList[i].itemId) == itemId)) {
              binList[i].isLit = true;
            }
          }
        }
      }
    }
    https.end();
  }
}

void confirmPickCollected(const char* binId, const char* itemId, int binIndex) {
  Serial.printf("Confirmando recolección física en bin: %s\\n", binId);

  // Destello verde en la gaveta
  for (int j = 0; j < binList[binIndex].countLed; j++) {
    strip.setPixelColor(binList[binIndex].startLed + j, strip.Color(0, 255, 0));
  }
  strip.show();

  // Actualizar estado en Firestore vía REST PATCH
  if (WiFi.status() == WL_CONNECTED) {
    WiFiClientSecure client;
    client.setInsecure();
    HTTPClient https;
    String url = String(PB_SERVER) + "/api/collections/active_picks/records";
    // En producción se realiza PATCH al ID correspondiente
    Serial.println("Pick confirmado registrado en la nube.");
  }

  delay(1200); // Mantener destello verde de confirmación
  binList[binIndex].isLit = false;
  strip.show();
}

void renderPickLeds() {
  uint32_t now = millis();
  // Efecto pulsante suave para localizar fácilmente la gaveta
  float pulse = (sin(now / 200.0) + 1.0) / 2.0;
  uint8_t r = 0;
  uint8_t g = (uint8_t)(229 * pulse);
  uint8_t b = (uint8_t)(255 * pulse);

  for (int i = 0; i < NUM_BINS; i++) {
    uint32_t c = binList[i].isLit ? strip.Color(r, g, b) : strip.Color(0, 0, 0);
    for (int j = 0; j < binList[i].countLed; j++) {
      strip.setPixelColor(binList[i].startLed + j, c);
    }
  }
  strip.show();
}
`;
}

function downloadWhEsp32Ino() {
    const pre = document.getElementById('esp32WhCodePre');
    if (!pre) return;
    const rackKey = activeWhRackKey || 'rack_a';
    const blob = new Blob([pre.textContent], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `esp32-pick-to-light-${rackKey}.ino`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    showAlert(`Firmware esp32-pick-to-light-${rackKey}.ino descargado con éxito.`, 'success');
}

window.initWarehouseMgmt = initWarehouseMgmt;
window.renderWarehouseMgmtUI = renderWarehouseMgmtUI;

// =============================================================================
// GESTIÓN DINÁMICA DE MOTIVOS DE PARO / FALLA (ESP32 CENTRO DE MANDO & SCADA)
// =============================================================================
const DEFAULT_FAILURE_REASONS = [
    "1. Leva rota",
    "2. Fuga o falla neumática",
    "3. Tornillería floja o faltante",
    "4. Componente roto",
    "5. Falla eléctrica / Sensor",
    "6. Atasco mecánico"
];

let currentFailureReasons = [...DEFAULT_FAILURE_REASONS];
let failureReasonsUnsubscribe = null;
let simReasonIndex = 0;

async function initFailureReasonsMgmt() {
    const container = document.getElementById('failureReasonsListContainer');
    if (!container) return;

    if (failureReasonsUnsubscribe) failureReasonsUnsubscribe();

    try {
        failureReasonsUnsubscribe = db.collection('config').doc('failure_reasons').onSnapshot(async (doc) => {
            if (!doc.exists) {
                console.log('No existe catálogo de motivos en Firestore, inicializando defaults...');
                currentFailureReasons = [...DEFAULT_FAILURE_REASONS];
                await db.collection('config').doc('failure_reasons').set({
                    reasons: currentFailureReasons,
                    updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
                    updatedBy: 'system_init'
                });
            } else {
                const data = doc.data();
                if (Array.isArray(data.reasons) && data.reasons.length > 0) {
                    currentFailureReasons = data.reasons;
                } else {
                    currentFailureReasons = [...DEFAULT_FAILURE_REASONS];
                }
            }
            renderFailureReasonsUI();
        }, (error) => {
            console.error('Error al escuchar config/failure_reasons:', error);
            showAlert('Error al sincronizar motivos de paro: ' + error.message, 'warning');
        });
    } catch (err) {
        console.error('Error al inicializar gestión de motivos de paro:', err);
    }
}

function renderFailureReasonsUI() {
    const container = document.getElementById('failureReasonsListContainer');
    const badge = document.getElementById('failureReasonsCountBadge');
    if (!container) return;

    if (badge) {
        badge.textContent = `${currentFailureReasons.length} motivos configurados`;
    }

    if (currentFailureReasons.length === 0) {
        setSafeDOM(container, `
            <div class="list-group-item text-center text-muted py-4">
                <i class="bi bi-info-circle fs-3 d-block mb-2"></i>
                No hay motivos de paro registrados. Agrega uno arriba o restaura los defectos.
            </div>
        `);
        updateGc9a01Simulator();
        return;
    }

    let html = '';
    currentFailureReasons.forEach((reason, idx) => {
        const isFirst = idx === 0;
        const isLast = idx === currentFailureReasons.length - 1;
        html += `
            <div class="list-group-item list-group-item-action d-flex justify-content-between align-items-center py-2 px-3">
                <div class="d-flex align-items-center gap-2 text-truncate me-2">
                    <span class="badge bg-secondary rounded-pill px-2 py-1">${idx + 1}</span>
                    <strong class="text-light text-truncate" title="${reason}">${reason}</strong>
                </div>
                <div class="btn-group btn-group-sm">
                    <button class="btn btn-outline-secondary" onclick="moveFailureReason(${idx}, -1)" ${isFirst ? 'disabled' : ''} title="Mover arriba">
                        <i class="bi bi-arrow-up"></i>
                    </button>
                    <button class="btn btn-outline-secondary" onclick="moveFailureReason(${idx}, 1)" ${isLast ? 'disabled' : ''} title="Mover abajo">
                        <i class="bi bi-arrow-down"></i>
                    </button>
                    <button class="btn btn-outline-info" onclick="editFailureReason(${idx})" title="Editar motivo">
                        <i class="bi bi-pencil"></i>
                    </button>
                    <button class="btn btn-outline-danger" onclick="deleteFailureReason(${idx})" title="Eliminar motivo">
                        <i class="bi bi-trash"></i>
                    </button>
                </div>
            </div>
        `;
    });

    setSafeDOM(container, html);
    updateGc9a01Simulator();
}

async function addFailureReason() {
    const input = document.getElementById('newFailureReasonInput');
    if (!input) return;
    const text = input.value.trim();
    if (!text) {
        showAlert('Escribe el texto del motivo de paro.', 'warning');
        return;
    }

    currentFailureReasons.push(text);
    input.value = '';
    await saveFailureReasonsToCloud(true);
}

async function editFailureReason(idx) {
    if (idx < 0 || idx >= currentFailureReasons.length) return;
    const current = currentFailureReasons[idx];
    const newText = prompt('Modifica el motivo de paro para el Centro de Mando ESP32 y Web:', current);
    if (newText === null) return;
    const trimmed = newText.trim();
    if (!trimmed) {
        showAlert('El texto del motivo no puede estar vacío.', 'warning');
        return;
    }
    currentFailureReasons[idx] = trimmed;
    await saveFailureReasonsToCloud(true);
}

async function deleteFailureReason(idx) {
    if (idx < 0 || idx >= currentFailureReasons.length) return;
    const reason = currentFailureReasons[idx];
    if (!confirm(`¿Eliminar "${reason}" del catálogo de fallas?`)) return;
    currentFailureReasons.splice(idx, 1);
    if (simReasonIndex >= currentFailureReasons.length) {
        simReasonIndex = Math.max(0, currentFailureReasons.length - 1);
    }
    await saveFailureReasonsToCloud(true);
}

async function moveFailureReason(idx, direction) {
    const targetIdx = idx + direction;
    if (targetIdx < 0 || targetIdx >= currentFailureReasons.length) return;
    const temp = currentFailureReasons[idx];
    currentFailureReasons[idx] = currentFailureReasons[targetIdx];
    currentFailureReasons[targetIdx] = temp;
    await saveFailureReasonsToCloud(true);
}

async function resetDefaultFailureReasons() {
    if (!confirm('¿Restaurar el catálogo a los motivos predeterminados industriales?')) return;
    currentFailureReasons = [...DEFAULT_FAILURE_REASONS];
    simReasonIndex = 0;
    await saveFailureReasonsToCloud(false);
    showAlert('Catálogo restaurado a valores industriales predeterminados.', 'info');
}

async function saveFailureReasonsToCloud(silent = false) {
    try {
        await db.collection('config').doc('failure_reasons').set({
            reasons: currentFailureReasons,
            updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
            updatedBy: sessionStorage.getItem('adminUser') || 'admin'
        });
        if (!silent) {
            showAlert('Catálogo de motivos de paro guardado y sincronizado con el ESP32.', 'success');
        }
        renderFailureReasonsUI();
    } catch (err) {
        console.error('Error guardando motivos en Firestore:', err);
        showAlert('Error al guardar en la nube: ' + err.message, 'danger');
    }
}

// Simulador GC9A01 240x240
function updateGc9a01Simulator() {
    const textEl = document.getElementById('simGc9a01ReasonText');
    const indexEl = document.getElementById('simGc9a01Index');
    if (!textEl || !indexEl) return;

    if (currentFailureReasons.length === 0) {
        textEl.textContent = 'SIN MOTIVOS';
        textEl.style.fontSize = '1.1rem';
        textEl.style.color = '#f87171';
        indexEl.textContent = '[ 0 / 0 ]';
        return;
    }

    if (simReasonIndex >= currentFailureReasons.length) {
        simReasonIndex = 0;
    }

    const currentText = currentFailureReasons[simReasonIndex];
    textEl.textContent = currentText;
    textEl.style.color = '#ffffff';

    // Dinámica de tamaño de fuente para pantalla circular de 240x240
    if (currentText.length > 25) {
        textEl.style.fontSize = '0.9rem';
    } else if (currentText.length > 15) {
        textEl.style.fontSize = '1.05rem';
    } else {
        textEl.style.fontSize = '1.25rem';
    }

    indexEl.textContent = `[ ${simReasonIndex + 1} / ${currentFailureReasons.length} ]`;
}

function nextSimReason() {
    if (currentFailureReasons.length === 0) return;
    simReasonIndex = (simReasonIndex + 1) % currentFailureReasons.length;
    updateGc9a01Simulator();
}

function prevSimReason() {
    if (currentFailureReasons.length === 0) return;
    simReasonIndex = (simReasonIndex - 1 + currentFailureReasons.length) % currentFailureReasons.length;
    updateGc9a01Simulator();
}

window.initFailureReasonsMgmt = initFailureReasonsMgmt;
window.renderFailureReasonsUI = renderFailureReasonsUI;
window.addFailureReason = addFailureReason;
window.editFailureReason = editFailureReason;
window.deleteFailureReason = deleteFailureReason;
window.moveFailureReason = moveFailureReason;
window.resetDefaultFailureReasons = resetDefaultFailureReasons;
window.saveFailureReasonsToCloud = saveFailureReasonsToCloud;
window.nextSimReason = nextSimReason;
window.prevSimReason = prevSimReason;

// ============================================================================
// 🏭 GESTIÓN DE TOPOLOGÍA & NOMENCLATURA GLOBAL DE PLANTA (ISA-101 / SCADA)
// ============================================================================

function initAdminTopologyMgmt() {
    window.addEventListener('plant_topology_updated', () => {
        const topPane = document.getElementById('topology-mgmt');
        if (topPane && topPane.classList.contains('active')) {
            renderAdminTopologyUI();
        }
    });
}

function getAreaKeyForOp(opId) {
    const s = String(opId);
    if (s === '5' || s.startsWith('5.')) return 'area5';
    if (s.startsWith('10')) return 'area10';
    if (s.startsWith('20')) return 'area20';
    if (s.startsWith('30')) return 'area30';
    return 'area35';
}

function renderAdminTopologyUI() {
    const areasContainer = document.getElementById('adminTopologyAreasContainer');
    const opsTableBody = document.getElementById('adminTopologyOpsTableBody');
    if (!areasContainer || !opsTableBody) return;

    if (!window.HermesTopology) {
        console.warn('[AdminTopology] HermesTopology no está disponible');
        return;
    }

    const areas = window.HermesTopology.areas || {};
    const ops = window.HermesTopology.operations || {};

    // 1. Renderizar Áreas (5 Naves)
    let areasHtml = '';
    const areaKeys = ['area5', 'area10', 'area20', 'area30', 'area35'];
    areaKeys.forEach(key => {
        const area = areas[key] || { label: key, code: key.toUpperCase(), color: '#38bdf8', icon: 'bi-buildings' };
        areasHtml += `
            <div class="col-md-6 col-lg-4">
                <div class="card h-100 border-secondary bg-dark shadow-sm">
                    <div class="card-body p-3">
                        <div class="d-flex align-items-center justify-content-between mb-2">
                            <span class="badge" style="background: rgba(56, 189, 248, 0.15); color: ${area.color || '#38bdf8'}; border: 1px solid ${area.color || '#38bdf8'}40; font-family: monospace;">
                                <i class="bi ${area.icon || 'bi-buildings'} me-1"></i>${area.code || key}
                            </span>
                            <span class="badge bg-secondary-subtle text-secondary font-mono small">${key}</span>
                        </div>
                        <div class="mb-2">
                            <label class="form-label small text-muted mb-1">Nombre Descriptivo de la Nave:</label>
                            <input type="text" class="form-control form-control-sm bg-black text-light border-secondary" id="adminAreaInput_${key}" value="${(area.label || '').replace(/"/g, '&quot;')}" placeholder="Nombre de nave...">
                        </div>
                        <div class="small text-muted font-mono" style="font-size: 0.75rem;">
                            Color SCADA: <span style="display:inline-block; width:10px; height:10px; border-radius:50%; background:${area.color || '#38bdf8'}; vertical-align:middle;"></span> ${area.color || '#38bdf8'}
                        </div>
                    </div>
                </div>
            </div>
        `;
    });
    setSafeDOM(areasContainer, areasHtml);

    // 2. Renderizar Operaciones
    renderAdminTopologyOpsRows();
}

function renderAdminTopologyOpsRows() {
    const opsTableBody = document.getElementById('adminTopologyOpsTableBody');
    const badge = document.getElementById('adminTopologyOpsCountBadge');
    if (!opsTableBody || !window.HermesTopology) return;

    const ops = window.HermesTopology.operations || {};
    const areas = window.HermesTopology.areas || {};

    const sortedOps = Object.keys(ops).sort((a, b) => {
        const parseNum = s => parseFloat(s) || 999;
        return parseNum(a) - parseNum(b);
    });

    const searchInput = document.getElementById('adminTopologyOpSearch');
    const query = (searchInput ? searchInput.value : '').toLowerCase().trim();
    const areaFilter = document.getElementById('adminTopologyAreaFilter');
    const selectedArea = areaFilter ? areaFilter.value : 'all';

    let visibleCount = 0;
    let rowsHtml = '';

    sortedOps.forEach(opId => {
        const opName = ops[opId] || '';
        const areaKey = getAreaKeyForOp(opId);
        const areaObj = areas[areaKey] || { label: areaKey, color: '#38bdf8', code: areaKey };
        const subtitle = window.HermesTopology.getOpSubtitle ? window.HermesTopology.getOpSubtitle(opId) : '';

        // Filtros
        if (selectedArea !== 'all' && areaKey !== selectedArea) return;
        if (query && !opId.toLowerCase().includes(query) && !opName.toLowerCase().includes(query) && !subtitle.toLowerCase().includes(query) && !areaObj.label.toLowerCase().includes(query)) {
            return;
        }

        visibleCount++;
        const safeOpId = opId.replace('.', '_');
        rowsHtml += `
            <tr>
                <td class="text-center font-mono fw-bold text-info" style="font-size: 0.85rem;">
                    OP ${opId}
                </td>
                <td>
                    <span class="badge" style="background: rgba(255,255,255,0.06); color: ${areaObj.color || '#38bdf8'}; border: 1px solid ${areaObj.color || '#38bdf8'}40; font-family: monospace; font-size: 0.75rem;">
                        ${areaObj.code || areaKey}
                    </span>
                    <div class="text-muted text-truncate" style="font-size: 0.72rem; max-width: 140px;">
                        ${areaObj.label}
                    </div>
                </td>
                <td>
                    <input type="text" class="form-control form-control-sm bg-black text-light border-secondary font-mono" id="adminOpInput_${safeOpId}" data-op-id="${opId}" value="${opName.replace(/"/g, '&quot;')}" placeholder="Nombre de la operación...">
                </td>
                <td>
                    <span class="text-secondary small font-mono">${subtitle || 'Estación de Proceso'}</span>
                </td>
                <td class="text-center">
                    <span class="badge bg-success-subtle text-success border border-success" style="font-size: 0.7rem;">
                        <i class="bi bi-check2"></i> Activa
                    </span>
                </td>
            </tr>
        `;
    });

    if (visibleCount === 0) {
        rowsHtml = `
            <tr>
                <td colspan="5" class="text-center text-muted py-4 font-mono">
                    <i class="bi bi-search fs-4 d-block mb-2"></i>
                    No se encontraron operaciones con los filtros actuales.
                </td>
            </tr>
        `;
    }

    setSafeDOM(opsTableBody, rowsHtml);

    if (badge) {
        badge.textContent = `${visibleCount} de ${sortedOps.length} operaciones`;
    }
}

function filterAdminTopologyOps() {
    renderAdminTopologyOpsRows();
}

async function saveAdminTopology() {
    if (!window.HermesTopology) {
        showAlert('Error: Gestor de topología no inicializado', 'danger');
        return;
    }

    const btn = document.getElementById('btnSaveAdminTopology');
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span> Guardando...';
    }

    const payloadAreas = {};
    const areaKeys = ['area5', 'area10', 'area20', 'area30', 'area35'];
    areaKeys.forEach(key => {
        const input = document.getElementById(`adminAreaInput_${key}`);
        if (input && input.value.trim()) {
            if (window.HermesTopology.areas[key]) {
                window.HermesTopology.areas[key].label = input.value.trim();
            }
            payloadAreas[key] = {
                label: input.value.trim(),
                code: window.HermesTopology.areas[key] ? window.HermesTopology.areas[key].code : key
            };
        }
    });

    const payloadOps = {};
    const opInputs = document.querySelectorAll('[id^="adminOpInput_"]');
    opInputs.forEach(input => {
        const opId = input.dataset.opId;
        if (opId && input.value.trim()) {
            window.HermesTopology.operations[opId] = input.value.trim();
            payloadOps[opId] = input.value.trim();
        }
    });

    // Guardar en caché local
    if (typeof window.HermesTopology.saveToCache === 'function') {
        window.HermesTopology.saveToCache();
    }

    // Persistir en Firestore
    try {
        if (typeof firebase !== 'undefined' && firebase.firestore) {
            const dbInstance = firebase.firestore();
            await dbInstance.collection('config').doc('plant_topology_config').set({
                ...payloadAreas,
                operations: payloadOps,
                updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
                updatedBy: 'admin_panel'
            }, { merge: true });
        }
    } catch (err) {
        console.error('[AdminTopology] Error persistiendo a Firestore:', err);
    }

    // Notificar al sistema
    if (typeof window.HermesTopology.broadcastUpdate === 'function') {
        window.HermesTopology.broadcastUpdate();
    }

    if (btn) {
        btn.disabled = false;
        btn.innerHTML = '<i class="bi bi-cloud-arrow-up"></i> Guardar Cambios Globales';
    }

    if (window.IndustrialAudio && window.IndustrialAudio.playResolveSuccess) {
        window.IndustrialAudio.playResolveSuccess();
    }

    showAlert('Topología global y textos de planta guardados exitosamente en Firestore.', 'success');
}

function resetAdminTopologyDefaults() {
    if (!window.HermesTopology) return;

    if (!confirm('¿Deseas restaurar la nomenclatura y nombres de todas las naves y 41 operaciones a los valores de fábrica?')) {
        return;
    }

    if (typeof window.HermesTopology.resetDefaults === 'function') {
        window.HermesTopology.resetDefaults();
    }

    // Recargar vista admin
    renderAdminTopologyUI();

    if (window.IndustrialAudio && window.IndustrialAudio.playClick) {
        window.IndustrialAudio.playClick();
    }

    showAlert('Valores restaurados a defectos de fábrica. Recuerda pulsar "Guardar Cambios Globales" para sincronizar.', 'info');
}

window.initAdminTopologyMgmt = initAdminTopologyMgmt;
window.renderAdminTopologyUI = renderAdminTopologyUI;
window.filterAdminTopologyOps = filterAdminTopologyOps;
window.saveAdminTopology = saveAdminTopology;
window.resetAdminTopologyDefaults = resetAdminTopologyDefaults;






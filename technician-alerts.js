/**
 * TECHNICIAN ALERTS & SELECTIVE VIBRATION SYSTEM
 * Operations Monitor Industrial SCADA
 * 
 * Integrado con el Sistema de Rotación de Jornadas Inteligente del Panel de Administración (config/shift_rotation).
 * Permite a cada técnico vincular su perfil con el Roster Oficial de Planta o configurarlo manualmente,
 * filtrando en tiempo real las fallas de grúas y operaciones por área y jornada de guardia,
 * disparando vibración háptica de hardware (Capacitor Native) y sirena SCADA.
 */

(function () {
    const STORAGE_KEY = 'operations_tech_alert_config';
    let audioCtx = null;
    let knownFailureIds = new Set();
    let cachedRoster = [];
    let cachedRotationConfig = null;

    // Configuración por defecto
    const defaultConfig = {
        name: 'Técnico',
        phone: '',
        role: 'technician', // 'technician' | 'supervisor'
        areas: ['10', '20', '30', '5'],
        shift: 'actual', // 'actual' | 'A' | 'B' | 'C' | 'D' | 'todas'
        autoSyncRotation: true, // Sincronización automática con la rotación inteligente de admin
        vibrate: true,
        sound: true,
        enabled: true
    };

    // Obtener configuración guardada o defecto
    function getTechConfig() {
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            if (raw) return { ...defaultConfig, ...JSON.parse(raw) };
        } catch (e) {
            console.warn('[TechAlerts] Error leyendo configuración:', e);
        }
        return { ...defaultConfig };
    }

    // Guardar configuración
    function saveTechConfig(cfg) {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(cfg));
            updateBadgeUI();
            // Notificar a Firestore si está disponible (registro de técnico en turno)
            if (typeof db !== 'undefined' && db && cfg.name) {
                const docId = cfg.name.toLowerCase().replace(/[^a-z0-9]/g, '_') || 'current_tech';
                db.collection('technician_active_shifts').doc(docId).set({
                    name: cfg.name,
                    phone: cfg.phone || '',
                    role: cfg.role,
                    areas: cfg.areas,
                    shift: cfg.shift,
                    autoSyncRotation: cfg.autoSyncRotation !== false,
                    lastActive: firebase.firestore.FieldValue.serverTimestamp(),
                    userAgent: navigator.userAgent
                }, { merge: true }).catch(err => console.debug('[TechAlerts] Sync remoto opcional:', err.message));
            }
        } catch (e) {
            console.error('[TechAlerts] Error guardando config:', e);
        }
    }

    // ==========================================
    // SISTEMA DE ROTACIÓN INTELIGENTE DE JORNADAS (ADMIN SYNC)
    // ==========================================

    // Parsear el roster oficial desde config/technicians de Firestore
    function parseRosterFromDoc(techData) {
        const staff = [];
        const shifts = ['A', 'B', 'C', 'D'];
        if (!techData || typeof techData !== 'object') return staff;

        const areaKeys = Object.keys(techData);
        areaKeys.forEach(key => {
            let areaCode = '10';
            let areaLabel = 'Área 10';
            if (key.includes('20')) { areaCode = '20'; areaLabel = 'Área 20'; }
            else if (key.includes('30')) { areaCode = '30'; areaLabel = 'Área 30'; }
            else if (key.includes('5')) { areaCode = '5'; areaLabel = 'Área 5'; }

            const areaObj = techData[key];
            if (areaObj && typeof areaObj === 'object') {
                shifts.forEach(s => {
                    const sObj = areaObj[s] || areaObj[`Jornada ${s}`] || areaObj[s.toLowerCase()];
                    if (sObj) {
                        const techList = sObj.technicians || (Array.isArray(sObj) ? sObj : []);
                        techList.forEach(t => {
                            const name = typeof t === 'string' ? t : (t.name || '');
                            const phone = typeof t === 'string' ? '' : (t.phone || '');
                            if (name || phone) {
                                staff.push({
                                    name: name || `Técnico (${phone})`,
                                    phone: String(phone || '').replace(/^521/, ''),
                                    area: areaCode,
                                    areaLabel: areaLabel,
                                    shift: s,
                                    areaKey: key
                                });
                            }
                        });
                    }
                });
            }
        });
        return staff;
    }

    // Calcular destino de rotación inteligente según el esquema activo en Admin y permutas
    function calculateRotatedShift(currentShift, rotationCfg, personPhone) {
        if (!rotationCfg) return currentShift;
        const mapping = rotationCfg.customMapping || (
            rotationCfg.scheme === 'semestral'
                ? { A: 'C', B: 'D', C: 'A', D: 'B' }
                : { A: 'D', B: 'C', C: 'B', D: 'A' }
        );

        let targetShift = mapping[currentShift] || currentShift;

        // Comprobar permutas y excepciones activas de administración
        if (Array.isArray(rotationCfg.exceptions)) {
            for (const exc of rotationCfg.exceptions) {
                const isP1 = (exc.person1 && String(exc.person1.phone).replace(/^521/, '') === String(personPhone).replace(/^521/, ''));
                if (isP1) {
                    if (exc.type === 'no_rotate') return currentShift;
                    if (exc.type === 'reassign' && exc.targetShift) return exc.targetShift;
                    if (exc.type === 'swap' && exc.person2) {
                        const p2Source = exc.person2.currentShift || 'A';
                        return mapping[p2Source] || p2Source;
                    }
                }
            }
        }
        return targetShift;
    }

    // Inicializar oyente en tiempo real para cambios en la rotación de administración
    function initRotationListener() {
        if (typeof db === 'undefined' || !db) return;

        // 1. Escuchar config/technicians para rotaciones automáticas
        try {
            db.collection('config').doc('technicians').onSnapshot(doc => {
                if (!doc.exists) return;
                const techData = doc.data();
                cachedRoster = parseRosterFromDoc(techData);

                const cfg = getTechConfig();
                if (cfg.autoSyncRotation && cfg.name && cfg.role !== 'supervisor') {
                    const match = cachedRoster.find(t => 
                        (cfg.phone && t.phone && t.phone === cfg.phone) ||
                        (t.name.trim().toLowerCase() === cfg.name.trim().toLowerCase())
                    );
                    if (match) {
                        const changedShift = cfg.shift !== match.shift;
                        const changedArea = !cfg.areas.includes(match.area);
                        if (changedShift || changedArea) {
                            console.log(`[TechAlerts] 🔄 Rotación Inteligente detectada para ${cfg.name}: Nueva Jornada ${match.shift}, Área ${match.area}`);
                            cfg.shift = match.shift;
                            if (!cfg.areas.includes(match.area)) cfg.areas = [match.area];
                            saveTechConfig(cfg);
                            updateBadgeUI();
                            showRotationToast(cfg.name, match.shift, match.area);
                        }
                    }
                }
            }, err => console.warn('[TechAlerts] Error listener technicians:', err.message));
        } catch (e) {
            console.error('[TechAlerts] Error inicializando listener technicians:', e);
        }

        // 2. Escuchar config/shift_rotation para conocer esquema y fecha programada
        try {
            db.collection('config').doc('shift_rotation').onSnapshot(doc => {
                if (doc.exists) {
                    cachedRotationConfig = doc.data();
                }
            }, err => console.warn('[TechAlerts] Error listener shift_rotation:', err.message));
        } catch (e) {
            console.error('[TechAlerts] Error inicializando listener shift_rotation:', e);
        }
    }

    // Notificación en pantalla cuando la rotación inteligente se ejecuta
    function showRotationToast(techName, newShift, newArea) {
        const toast = document.createElement('div');
        toast.style.cssText = `
            position: fixed;
            bottom: 82px;
            left: 50%;
            transform: translateX(-50%);
            background: rgba(15, 23, 42, 0.95);
            border: 1px solid #38bdf8;
            border-radius: 14px;
            padding: 12px 18px;
            color: #fff;
            box-shadow: 0 10px 30px rgba(0,0,0,0.8), 0 0 15px rgba(56, 189, 248, 0.35);
            z-index: 10060;
            font-size: 0.85rem;
            display: flex;
            align-items: center;
            gap: 12px;
            backdrop-filter: blur(12px);
            animation: fadeInToast 0.3s ease;
        `;
        toast.innerHTML = `
            <span style="font-size: 1.5rem;">🔄</span>
            <div>
                <div style="font-weight: 700; color: #38bdf8;">Rotación de Jornadas Aplicada</div>
                <div style="font-size: 0.74rem; color: #cbd5e1;">${escapeHtml(techName)} asignado a Jornada ${newShift} · Área ${newArea}</div>
            </div>
        `;
        document.body.appendChild(toast);
        setTimeout(() => toast.remove(), 7000);
    }

    // ==========================================
    // SONIDO Y VIBRACIÓN HÁPTICA MULTI-CAPA
    // ==========================================

    // Generador de sonido SCADA vía Web Audio API
    function playScadaAlarm() {
        try {
            if (!audioCtx) {
                const AudioCtxClass = window.AudioContext || window.webkitAudioContext;
                if (AudioCtxClass) audioCtx = new AudioCtxClass();
            }
            if (audioCtx && audioCtx.state === 'suspended') {
                audioCtx.resume();
            }
            if (!audioCtx) return;

            const now = audioCtx.currentTime;
            const osc = audioCtx.createOscillator();
            const gain = audioCtx.createGain();

            osc.type = 'sawtooth';
            // Tono industrial bitonal: 880Hz -> 1174Hz (A5 -> D6) repetido 3 veces
            osc.frequency.setValueAtTime(880, now);
            osc.frequency.setValueAtTime(1174, now + 0.15);
            osc.frequency.setValueAtTime(880, now + 0.30);
            osc.frequency.setValueAtTime(1174, now + 0.45);
            osc.frequency.setValueAtTime(880, now + 0.60);
            osc.frequency.setValueAtTime(1174, now + 0.75);

            gain.gain.setValueAtTime(0.001, now);
            gain.gain.exponentialRampToValueAtTime(0.3, now + 0.05);
            gain.gain.exponentialRampToValueAtTime(0.3, now + 0.85);
            gain.gain.exponentialRampToValueAtTime(0.001, now + 1.0);

            osc.connect(gain);
            gain.connect(audioCtx.destination);

            osc.start(now);
            osc.stop(now + 1.05);
        } catch (e) {
            console.warn('[TechAlerts] Audio no disponible:', e);
        }
    }

    // Patrón de vibración háptica industrial (SOLO para App Móvil Nativa Android / Capacitor)
    async function triggerHapticVibrate() {
        if (!window.Capacitor?.isNativePlatform?.()) return;
        try {
            const haptics = window.Capacitor?.Plugins?.Haptics;
            if (haptics) {
                if (typeof haptics.vibrate === 'function') {
                    await haptics.vibrate({ duration: 800 });
                } else if (typeof haptics.impact === 'function') {
                    await haptics.impact({ style: 'HEAVY' });
                }
                
                setTimeout(async () => {
                    try {
                        if (typeof haptics.vibrate === 'function') {
                            await haptics.vibrate({ duration: 1000 });
                        } else if (typeof haptics.notification === 'function') {
                            await haptics.notification({ type: 'ERROR' });
                        }
                    } catch (e) {}
                }, 1000);
            }
        } catch (e) {}
    }

    // ==========================================
    // RÚTEO Y FILTRADO POR ÁREA Y JORNADA
    // ==========================================

    // Extraer área normalizada ("10", "20", "30", "5") de una grúa u operación
    function normalizeArea(rawArea, itemId) {
        let str = String(rawArea || itemId || '').toLowerCase().trim();
        if (str.includes('10')) return '10';
        if (str.includes('20')) return '20';
        if (str.includes('30')) return '30';
        if (str.includes('5') || str.includes('op')) return '5';
        return 'general';
    }

    // Verificar si el técnico debe recibir alerta para esta área
    function isAreaAssigned(areaCode, cfg) {
        if (!cfg.enabled) return false;
        if (cfg.role === 'supervisor') return true; // Supervisor recibe todas las áreas
        return Array.isArray(cfg.areas) && cfg.areas.includes(areaCode);
    }

    // Detección de la jornada actual industrial (A, B, C, D) basada en AnalisisDetallado / app.js
    function getCurrentShiftInfo() {
        if (typeof window.getCurrentShift === 'function') {
            try {
                const s = window.getCurrentShift();
                if (s && s.name) {
                    const letter = s.name.replace(/[^ABCD]/g, '') || 'A';
                    return { letter, name: s.name, description: s.description || '' };
                }
            } catch (e) {}
        }
        // Fallback robusto con horario Chihuahua UTC-6 (getters UTC sobre el instante
        // desplazado: no depende de la zona horaria del dispositivo).
        const now = (typeof window.getChihuahuaTime === 'function')
            ? window.getChihuahuaTime()
            : new Date(Date.now() - 6 * 3600 * 1000);
        const day = now.getUTCDay();
        const hour = now.getUTCHours();
        if (hour >= 6 && hour < 18) {
            return [0, 1, 2].includes(day)
                ? { letter: 'A', name: 'Jornada A', description: 'Domingo 6 AM → Martes 6 PM (3 días)' }
                : { letter: 'B', name: 'Jornada B', description: 'Miércoles 6 AM → Sábado 6 PM (4 días)' };
        } else {
            if (day === 0 && hour < 6) {
                return { letter: 'D', name: 'Jornada D', description: 'Miércoles 6 PM → Domingo 6 AM (4 noches)' };
            }
            return [0, 1, 2].includes(day)
                ? { letter: 'C', name: 'Jornada C', description: 'Domingo 6 PM → Miércoles 6 AM (3 noches)' }
                : { letter: 'D', name: 'Jornada D', description: 'Miércoles 6 PM → Domingo 6 AM (4 noches)' };
        }
    }

    // Verificar si la jornada del incidente coincide con el turno configurado por el técnico
    function isShiftAssigned(cfg) {
        if (!cfg.shift || cfg.shift === 'todas' || cfg.shift === 'actual') return true;
        const current = getCurrentShiftInfo();
        return cfg.shift === current.letter;
    }

    // Despachar alerta háptica y sonora si corresponde
    function dispatchAlert(incident) {
        const cfg = getTechConfig();
        const areaCode = normalizeArea(incident.area, incident.id || incident.craneId || incident.operationId);

        // Validar filtro de área
        if (!isAreaAssigned(areaCode, cfg)) {
            console.log(`[TechAlerts] Falla en Área ${areaCode} omitida (No asignada al técnico ${cfg.name})`);
            return;
        }

        // Validar filtro de jornada industrial
        if (!isShiftAssigned(cfg)) {
            const current = getCurrentShiftInfo();
            console.log(`[TechAlerts] Falla en Área ${areaCode} omitida: Técnico asignado a Jornada ${cfg.shift}, pero en planta está activa la ${current.name}`);
            return;
        }

        console.log(`[TechAlerts] 🚨 ¡ALERTA DISPARADA para ${cfg.name}! Área ${areaCode}:`, incident);

        if (cfg.vibrate) {
            triggerHapticVibrate();
        }
        if (cfg.sound) {
            playScadaAlarm();
        }

        showFloatingBanner(incident, areaCode);
    }

    // Banner visual flotante de alerta
    function showFloatingBanner(incident, areaCode) {
        let banner = document.getElementById('scadaEmergencyBanner');
        if (!banner) {
            banner = document.createElement('div');
            banner.id = 'scadaEmergencyBanner';
            banner.style.cssText = `
                position: fixed;
                bottom: 24px;
                right: 24px;
                z-index: 100050;
                width: calc(100% - 48px);
                max-width: 420px;
                background: linear-gradient(135deg, rgba(185, 28, 28, 0.95), rgba(127, 29, 29, 0.98));
                border: 1px solid rgba(248, 113, 113, 0.6);
                border-left: 5px solid #ef4444;
                border-radius: 14px;
                overflow: hidden;
                color: #ffffff;
                box-shadow: 0 16px 40px rgba(0, 0, 0, 0.6), 0 0 20px rgba(239, 68, 68, 0.45);
                padding: 14px 16px 16px 16px;
                display: flex;
                flex-direction: column;
                gap: 10px;
                backdrop-filter: blur(16px);
                -webkit-backdrop-filter: blur(16px);
                animation: scadaSlideInAlert 0.35s cubic-bezier(0.16, 1, 0.3, 1), scadaPulseGlow 2s infinite alternate;
                transition: opacity 0.4s ease, transform 0.4s ease;
            `;
            document.body.appendChild(banner);

            const style = document.createElement('style');
            style.innerHTML = `
                @keyframes scadaSlideInAlert {
                    from { transform: translateY(30px); opacity: 0; }
                    to { transform: translateY(0); opacity: 1; }
                }
                @keyframes scadaPulseGlow {
                    from { box-shadow: 0 16px 40px rgba(0, 0, 0, 0.6), 0 0 15px rgba(239, 68, 68, 0.35); }
                    to { box-shadow: 0 16px 40px rgba(0, 0, 0, 0.6), 0 0 30px rgba(239, 68, 68, 0.75); }
                }
                @keyframes scadaAlertProgressShrink {
                    from { width: 100%; }
                    to { width: 0%; }
                }
            `;
            document.head.appendChild(style);
        }

        const name = incident.craneId || incident.operationId || incident.id || 'Equipo';
        const type = incident.operationId ? 'Paro de Operación' : 'Falla de Grúa';
        const notes = incident.description || incident.notes || 'Falla reportada en tiempo real';

        banner.innerHTML = `
            <div style="display: flex; align-items: center; justify-content: space-between;">
                <div style="display: flex; align-items: center; gap: 8px;">
                    <span style="font-size: 1.5rem;">🚨</span>
                    <div>
                        <div style="font-weight: 800; font-size: 0.95rem; text-transform: uppercase; letter-spacing: 0.5px;">
                            ${type}: ${name}
                        </div>
                        <div style="font-size: 0.75rem; color: #fecaca;">
                            Área ${areaCode} · Alerta asignada a tu turno
                        </div>
                    </div>
                </div>
                <button type="button" onclick="window.silenceTechAlert()" 
                    style="background: transparent; border: none; color: #ffffff; font-size: 1.2rem; cursor: pointer; padding: 4px;">✕</button>
            </div>
            <div style="font-size: 0.82rem; color: #fee2e2; background: rgba(0,0,0,0.25); padding: 6px 10px; border-radius: 8px;">
                ${notes}
            </div>
            <div style="display: flex; gap: 8px; justify-content: flex-end;">
                <button type="button" onclick="window.silenceTechAlert()" 
                    style="background: rgba(255,255,255,0.2); border: 1px solid rgba(255,255,255,0.3); color: #fff; border-radius: 8px; padding: 6px 12px; font-size: 0.8rem; font-weight: 600; cursor: pointer;">
                    Silenciar
                </button>
                <a href="${incident.operationId ? 'operations.html' : 'cranes.html'}" 
                    style="background: #ffffff; color: #b91c1c; border-radius: 8px; padding: 6px 14px; font-size: 0.8rem; font-weight: 700; text-decoration: none; display: flex; align-items: center; gap: 4px;">
                    Atender Equipo →
                </a>
            </div>
            <div style="position: absolute; bottom: 0; left: 0; height: 3px; background: rgba(255,255,255,0.45); width: 100%; animation: scadaAlertProgressShrink 60s linear forwards;"></div>
        `;

        if (window._techAlertAutoDismissTimer) {
            clearTimeout(window._techAlertAutoDismissTimer);
            window._techAlertAutoDismissTimer = null;
        }

        banner.style.opacity = '1';
        banner.style.transform = 'translateY(0)';
        banner.style.display = 'flex';

        // Desaparición automática tras 1 minuto (60 segundos)
        window._techAlertAutoDismissTimer = setTimeout(() => {
            if (banner && banner.style.display !== 'none') {
                banner.style.opacity = '0';
                banner.style.transform = 'translateY(20px)';
                setTimeout(() => {
                    banner.style.display = 'none';
                    banner.style.opacity = '1';
                    banner.style.transform = 'translateY(0)';
                }, 400);
            }
        }, 60000);
    }

    window.silenceTechAlert = function () {
        if (window._techAlertAutoDismissTimer) {
            clearTimeout(window._techAlertAutoDismissTimer);
            window._techAlertAutoDismissTimer = null;
        }
        const b = document.getElementById('scadaEmergencyBanner');
        if (b) {
            b.style.display = 'none';
            b.style.opacity = '1';
            b.style.transform = 'translateY(0)';
        }
    };

    // Actualizar badge en la interfaz
    function updateBadgeUI() {
        const cfg = getTechConfig();
        const badge = document.getElementById('techAlertsBadge');
        const current = getCurrentShiftInfo();
        if (badge) {
            if (!cfg.enabled) {
                badge.textContent = 'Desactivado';
                badge.style.color = '#94a3b8';
            } else if (cfg.role === 'supervisor') {
                badge.textContent = `Supervisor · ${current.name}`;
                badge.style.color = '#38bdf8';
            } else {
                const shiftLabel = cfg.shift === 'todas' ? '24/7' : cfg.shift === 'actual' ? `Auto (${current.letter})` : `J-${cfg.shift}`;
                const autoIcon = cfg.autoSyncRotation ? '🔄 ' : '';
                badge.textContent = `${autoIcon}Áreas: ${cfg.areas.join(',')} · ${shiftLabel}`;
                badge.style.color = '#4ade80';
            }
        }
    }

    // ==========================================
    // MODAL DE CONFIGURACIÓN & ROTACIÓN INTELIGENTE
    // ==========================================

    window.openTechAlertsModal = async function () {
        let modalEl = document.getElementById('techAlertsConfigModal');
        if (!modalEl) {
            modalEl = document.createElement('div');
            modalEl.id = 'techAlertsConfigModal';
            modalEl.className = 'modal fade';
            modalEl.tabIndex = -1;
            modalEl.setAttribute('aria-hidden', 'true');
            document.body.appendChild(modalEl);
        }

        const cfg = getTechConfig();
        const current = getCurrentShiftInfo();

        // Cargar roster de Firestore si aún no está en caché
        if (cachedRoster.length === 0 && typeof db !== 'undefined' && db) {
            try {
                const [techDoc, rotDoc] = await Promise.all([
                    db.collection('config').doc('technicians').get(),
                    db.collection('config').doc('shift_rotation').get()
                ]);
                if (techDoc.exists) cachedRoster = parseRosterFromDoc(techDoc.data());
                if (rotDoc.exists) cachedRotationConfig = rotDoc.data();
            } catch (err) {
                console.warn('[TechAlerts] Error cargando roster para modal:', err.message);
            }
        }

        // Construir opciones del selector de roster
        let rosterOptions = '';
        if (cachedRoster.length > 0) {
            // Ordenar por área y jornada
            const sorted = [...cachedRoster].sort((a, b) => a.area.localeCompare(b.area) || a.shift.localeCompare(b.shift));
            rosterOptions = sorted.map(t => {
                const isSelected = (cfg.phone && t.phone === cfg.phone) || (t.name === cfg.name);
                return `<option value="${escapeHtml(t.phone || t.name)}" data-name="${escapeHtml(t.name)}" data-phone="${escapeHtml(t.phone)}" data-area="${t.area}" data-shift="${t.shift}" ${isSelected ? 'selected' : ''}>
                    ${escapeHtml(t.name)} · Área ${t.area} · Jornada ${t.shift}
                </option>`;
            }).join('');
        }

        // Datos de la rotación inteligente para previsualización
        const rotCfg = cachedRotationConfig || { scheme: 'habitual', nextDate: '' };
        const schemeName = rotCfg.scheme === 'semestral' ? 'Semestral (A⇄C, B⇄D)' : 'Habitual (C⇄B, A⇄D)';
        const rotatedShift = calculateRotatedShift(cfg.shift === 'actual' ? current.letter : cfg.shift, rotCfg, cfg.phone);

        const isArea10 = cfg.areas.includes('10');
        const isArea20 = cfg.areas.includes('20');
        const isArea30 = cfg.areas.includes('30');
        const isArea5  = cfg.areas.includes('5');

        modalEl.innerHTML = `
            <div class="modal-dialog modal-dialog-centered">
                <div class="modal-content" style="background: #0f172a; border: 1px solid rgba(255,255,255,0.15); border-radius: 20px; color: #f8fafc; box-shadow: 0 20px 50px rgba(0,0,0,0.8);">
                    <div class="modal-header" style="border-bottom: 1px solid rgba(255,255,255,0.1); padding: 18px 24px;">
                        <h5 class="modal-title" style="font-weight: 700; display: flex; align-items: center; gap: 8px;">
                            <span style="color: #ef4444; font-size: 1.3rem;">🔔</span> Perfil de Alertas y Vibración
                        </h5>
                        <button type="button" class="btn-close btn-close-white" data-bs-dismiss="modal" aria-label="Close"></button>
                    </div>
                    <div class="modal-body" style="padding: 22px 24px;">

                        <!-- Selector Inteligente de Roster Oficial de Administración -->
                        <div class="mb-3">
                            <label class="form-label small text-info fw-semibold mb-1 d-flex justify-content-between align-items-center">
                                <span><i class="bi bi-people-fill"></i> Seleccionar del Roster de Administración</span>
                                <span class="badge bg-info bg-opacity-25 text-info border border-info border-opacity-50" style="font-size: 0.68rem;">Rotación Inteligente</span>
                            </label>
                            <select id="techRosterSelect" class="form-select" onchange="window.onTechRosterSelected(this.value)"
                                style="background: rgba(15,23,42,0.9); border: 1px solid rgba(56, 189, 248, 0.4); color: #fff; border-radius: 10px; font-size: 0.88rem; padding: 10px;">
                                <option value="">-- Elige tu nombre para sincronización automática --</option>
                                ${rosterOptions}
                                <option value="__manual__">⚙️ Ingresar manualmente / Modo personalizado</option>
                            </select>
                            <div style="font-size: 0.72rem; color: #94a3b8; margin-top: 4px;">
                                Al elegir tu nombre, la app se sincroniza automáticamente con el rol de administración.
                            </div>
                        </div>

                        <!-- Tarjeta de Estado de Rotación Inteligente -->
                        <div id="techRotationInfoCard" class="card p-3 mb-3" style="background: rgba(56, 189, 248, 0.08); border: 1px solid rgba(56, 189, 248, 0.25); border-radius: 14px;">
                            <div class="d-flex justify-content-between align-items-center mb-1">
                                <span class="small fw-bold text-info"><i class="bi bi-arrow-repeat"></i> Rotación Inteligente Activa</span>
                                <span class="badge bg-info text-dark" style="font-size: 0.68rem; font-weight: 700;">${schemeName}</span>
                            </div>
                            <div class="small text-white mt-1">
                                Jornada asignada: <b>Jornada ${cfg.shift === 'actual' ? current.letter : cfg.shift}</b>
                                <span class="text-info mx-1">→</span>
                                Próxima jornada al rotar: <b class="text-warning">Jornada ${rotatedShift}</b>
                            </div>
                            <div class="small text-muted mt-1" style="font-size: 0.73rem;">
                                <i class="bi bi-calendar-event"></i> Siguiente rotación programada: <b>${rotCfg.nextDate || 'Programada por bot'}</b>
                            </div>
                            <div class="form-check form-switch mt-2 pt-1 border-top border-secondary border-opacity-25">
                                <input class="form-check-input" type="checkbox" id="techAutoSyncRotation" ${cfg.autoSyncRotation !== false ? 'checked' : ''}>
                                <label class="form-check-label small text-white" for="techAutoSyncRotation" style="font-size: 0.78rem;">
                                    Rotar automáticamente mi turno cuando administración ejecute la rotación
                                </label>
                            </div>
                        </div>

                        <div class="mb-3">
                            <label class="form-label small text-muted fw-semibold mb-1">Nombre del Técnico</label>
                            <input type="text" id="techNameInput" class="form-control" value="${escapeHtml(cfg.name)}" 
                                style="background: rgba(15,23,42,0.8); border: 1px solid rgba(255,255,255,0.15); color: #fff; border-radius: 10px;">
                            <input type="hidden" id="techPhoneInput" value="${escapeHtml(cfg.phone || '')}">
                        </div>

                        <div class="mb-3">
                            <label class="form-label small text-muted fw-semibold mb-1">Rol Operativo</label>
                            <select id="techRoleSelect" class="form-select" onchange="window.toggleTechAreaCheckboxes(this.value)"
                                style="background: rgba(15,23,42,0.8); border: 1px solid rgba(255,255,255,0.15); color: #fff; border-radius: 10px;">
                                <option value="technician" ${cfg.role === 'technician' ? 'selected' : ''}>Técnico Especialista de Área</option>
                                <option value="supervisor" ${cfg.role === 'supervisor' ? 'selected' : ''}>Supervisor General (Todas las Áreas)</option>
                            </select>
                        </div>

                        <div id="techAreaCheckboxesGroup" class="mb-3" style="${cfg.role === 'supervisor' ? 'display: none;' : ''}">
                            <label class="form-label small text-muted fw-semibold mb-2">Áreas Asignadas a tu Guardia</label>
                            <div class="d-flex flex-column gap-2" style="background: rgba(255,255,255,0.03); padding: 12px; border-radius: 12px; border: 1px solid rgba(255,255,255,0.06);">
                                <div class="form-check">
                                    <input class="form-check-input" type="checkbox" id="areaCheck10" value="10" ${isArea10 ? 'checked' : ''}>
                                    <label class="form-check-label text-white small" for="areaCheck10">
                                        <b>Área 10</b> <span class="text-muted">(Grúas 10A, 10B, 10C, 10D)</span>
                                    </label>
                                </div>
                                <div class="form-check">
                                    <input class="form-check-input" type="checkbox" id="areaCheck20" value="20" ${isArea20 ? 'checked' : ''}>
                                    <label class="form-check-label text-white small" for="areaCheck20">
                                        <b>Área 20</b> <span class="text-muted">(Grúas 20A a 20F)</span>
                                    </label>
                                </div>
                                <div class="form-check">
                                    <input class="form-check-input" type="checkbox" id="areaCheck30" value="30" ${isArea30 ? 'checked' : ''}>
                                    <label class="form-check-label text-white small" for="areaCheck30">
                                        <b>Área 30</b> <span class="text-muted">(Grúas 30A a 30D)</span>
                                    </label>
                                </div>
                                <div class="form-check">
                                    <input class="form-check-input" type="checkbox" id="areaCheck5" value="5" ${isArea5 ? 'checked' : ''}>
                                    <label class="form-check-label text-white small" for="areaCheck5">
                                        <b>Área 5</b> <span class="text-muted">(Operaciones y Paros de Estación)</span>
                                    </label>
                                </div>
                            </div>
                        </div>

                        <!-- Selector Completo de las 4 Jornadas de Análisis Detallado -->
                        <div class="mb-3">
                            <label class="form-label small text-muted fw-semibold mb-1 d-flex justify-content-between align-items-center">
                                <span>Jornada / Turno Operativo</span>
                                <span class="badge bg-primary text-white" style="font-size: 0.72rem; font-weight: 700;">En curso: ${current.name}</span>
                            </label>
                            <select id="techShiftSelect" class="form-select"
                                style="background: rgba(15,23,42,0.8); border: 1px solid rgba(255,255,255,0.15); color: #fff; border-radius: 10px; font-size: 0.88rem; padding: 10px;">
                                <option value="actual" ${cfg.shift === 'actual' ? 'selected' : ''}>⚡ Jornada Actual (Detectar automáticamente en tiempo real)</option>
                                <option value="A" ${cfg.shift === 'A' ? 'selected' : ''}>Jornada A (Día: Dom – Mar | 6:00 AM – 6:00 PM)</option>
                                <option value="B" ${cfg.shift === 'B' ? 'selected' : ''}>Jornada B (Día: Mié – Sáb | 6:00 AM – 6:00 PM)</option>
                                <option value="C" ${cfg.shift === 'C' ? 'selected' : ''}>Jornada C (Noche: Dom – Mar | 6:00 PM – 6:00 AM)</option>
                                <option value="D" ${cfg.shift === 'D' ? 'selected' : ''}>Jornada D (Noche: Mié – Dom | 6:00 PM – 6:00 AM)</option>
                                <option value="todas" ${cfg.shift === 'todas' ? 'selected' : ''}>Todas las Jornadas (Monitoreo continuo 24/7)</option>
                            </select>
                        </div>

                        <div class="d-flex justify-content-between align-items-center p-2 mb-3 rounded" style="background: rgba(255,255,255,0.03);">
                            <span class="small text-white"><i class="bi bi-bell-fill text-danger me-2"></i>Recepción de Alertas</span>
                            <div class="form-check form-switch m-0">
                                <input class="form-check-input" type="checkbox" id="techAlertsToggle" ${cfg.enabled ? 'checked' : ''}>
                            </div>
                        </div>

                        <div class="d-flex justify-content-between align-items-center p-2 mb-3 rounded" style="background: rgba(255,255,255,0.03);">
                            <span class="small text-white"><i class="bi bi-phone-vibrate text-primary me-2"></i>Vibración Háptica</span>
                            <div class="form-check form-switch m-0">
                                <input class="form-check-input" type="checkbox" id="techVibrateToggle" ${cfg.vibrate ? 'checked' : ''}>
                            </div>
                        </div>

                        <div class="d-flex justify-content-between align-items-center p-2 mb-3 rounded" style="background: rgba(255,255,255,0.03);">
                            <span class="small text-white"><i class="bi bi-volume-up text-warning me-2"></i>Sirena SCADA</span>
                            <div class="form-check form-switch m-0">
                                <input class="form-check-input" type="checkbox" id="techSoundToggle" ${cfg.sound ? 'checked' : ''}>
                            </div>
                        </div>

                        <div class="d-grid mt-3">
                            <button type="button" class="btn btn-outline-warning btn-sm" onclick="window.testTechAlertSimulation()">
                                ⚡ Probar Alerta y Vibración en mi Teléfono
                            </button>
                        </div>
                    </div>
                    <div class="modal-footer" style="border-top: 1px solid rgba(255,255,255,0.1); padding: 14px 24px;">
                        <button type="button" class="btn btn-secondary btn-sm" data-bs-dismiss="modal">Cancelar</button>
                        <button type="button" class="btn btn-primary btn-sm px-4 fw-bold" onclick="window.saveTechAlertsFromModal()">
                            Guardar Preferencias
                        </button>
                    </div>
                </div>
            </div>
        `;

        const modal = new bootstrap.Modal(modalEl);
        modal.show();
    };

    // Al seleccionar un técnico del roster oficial
    window.onTechRosterSelected = function (val) {
        if (!val || val === '__manual__') return;
        const select = document.getElementById('techRosterSelect');
        const opt = select.options[select.selectedIndex];
        if (!opt) return;

        const name = opt.getAttribute('data-name');
        const phone = opt.getAttribute('data-phone');
        const area = opt.getAttribute('data-area');
        const shift = opt.getAttribute('data-shift');

        if (name) {
            const nameInp = document.getElementById('techNameInput');
            if (nameInp) nameInp.value = name;
        }
        if (phone) {
            const phoneInp = document.getElementById('techPhoneInput');
            if (phoneInp) phoneInp.value = phone;
        }
        if (shift) {
            const shiftSel = document.getElementById('techShiftSelect');
            if (shiftSel) shiftSel.value = shift;
        }

        // Marcar área asignada
        ['10', '20', '30', '5'].forEach(a => {
            const chk = document.getElementById('areaCheck' + a);
            if (chk) chk.checked = (a === area);
        });

        // Asegurar que el rol sea técnico
        const roleSel = document.getElementById('techRoleSelect');
        if (roleSel) {
            roleSel.value = 'technician';
            window.toggleTechAreaCheckboxes('technician');
        }

        // Activar autoSync
        const autoSync = document.getElementById('techAutoSyncRotation');
        if (autoSync) autoSync.checked = true;

        // Actualizar previsualización de rotación en vivo
        const rotCfg = cachedRotationConfig || { scheme: 'habitual' };
        const rotatedShift = calculateRotatedShift(shift, rotCfg, phone);
        const card = document.getElementById('techRotationInfoCard');
        if (card) {
            const current = getCurrentShiftInfo();
            const schemeName = rotCfg.scheme === 'semestral' ? 'Semestral (A⇄C, B⇄D)' : 'Habitual (C⇄B, A⇄D)';
            card.innerHTML = `
                <div class="d-flex justify-content-between align-items-center mb-1">
                    <span class="small fw-bold text-info"><i class="bi bi-arrow-repeat"></i> Rotación Inteligente Activa</span>
                    <span class="badge bg-info text-dark" style="font-size: 0.68rem; font-weight: 700;">${schemeName}</span>
                </div>
                <div class="small text-white mt-1">
                    Jornada asignada: <b>Jornada ${shift}</b>
                    <span class="text-info mx-1">→</span>
                    Próxima jornada al rotar: <b class="text-warning">Jornada ${rotatedShift}</b>
                </div>
                <div class="small text-muted mt-1" style="font-size: 0.73rem;">
                    <i class="bi bi-calendar-event"></i> Siguiente rotación programada: <b>${rotCfg.nextDate || 'Programada por bot'}</b>
                </div>
                <div class="form-check form-switch mt-2 pt-1 border-top border-secondary border-opacity-25">
                    <input class="form-check-input" type="checkbox" id="techAutoSyncRotation" checked>
                    <label class="form-check-label small text-white" for="techAutoSyncRotation" style="font-size: 0.78rem;">
                        Rotar automáticamente mi turno cuando administración ejecute la rotación
                    </label>
                </div>
            `;
        }
    };

    window.toggleTechAreaCheckboxes = function (role) {
        const group = document.getElementById('techAreaCheckboxesGroup');
        if (group) {
            group.style.display = (role === 'supervisor') ? 'none' : 'block';
        }
    };

    window.saveTechAlertsFromModal = function () {
        const name = (document.getElementById('techNameInput')?.value || '').trim() || 'Técnico';
        const phone = (document.getElementById('techPhoneInput')?.value || '').trim();
        const role = document.getElementById('techRoleSelect')?.value || 'technician';
        const shift = document.getElementById('techShiftSelect')?.value || 'actual';
        const autoSyncRotation = document.getElementById('techAutoSyncRotation')?.checked ?? true;
        const enabled = document.getElementById('techAlertsToggle')?.checked ?? true;
        const vibrate = document.getElementById('techVibrateToggle')?.checked ?? true;
        const sound = document.getElementById('techSoundToggle')?.checked ?? true;

        const areas = [];
        if (document.getElementById('areaCheck10')?.checked) areas.push('10');
        if (document.getElementById('areaCheck20')?.checked) areas.push('20');
        if (document.getElementById('areaCheck30')?.checked) areas.push('30');
        if (document.getElementById('areaCheck5')?.checked)  areas.push('5');

        saveTechConfig({
            name,
            phone,
            role,
            areas,
            shift,
            autoSyncRotation,
            enabled,
            vibrate,
            sound
        });

        const modalEl = document.getElementById('techAlertsConfigModal');
        if (modalEl) {
            const modal = bootstrap.Modal.getInstance(modalEl);
            if (modal) modal.hide();
        }

        // Feedback háptico (Solo App Nativa)
        try {
            if (window.Capacitor?.isNativePlatform?.() && window.Capacitor?.Plugins?.Haptics) {
                window.Capacitor.Plugins.Haptics.impact({ style: 'LIGHT' });
            }
        } catch (e) {}

        alert('Configuración guardada. Vinculado a la Rotación Inteligente.');
    };

    window.testTechAlertSimulation = async function () {
        if (!audioCtx) {
            const AudioCtxClass = window.AudioContext || window.webkitAudioContext;
            if (AudioCtxClass) audioCtx = new AudioCtxClass();
        }
        if (audioCtx && audioCtx.state === 'suspended') {
            audioCtx.resume();
        }

        await triggerHapticVibrate();
        playScadaAlarm();
        showFloatingBanner({
            craneId: '10A (Simulación)',
            area: 'area10',
            description: 'Prueba de alerta háptica y sirena SCADA para el técnico'
        }, '10');
    };

    function escapeHtml(str) {
        if (!str) return '';
        return String(str).replace(/[&<>"']/g, m => ({
            '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
        }[m]));
    }

    // ==========================================
    // ESCUCHA EN TIEMPO REAL CON FIRESTORE
    // ==========================================

    function initFirestoreFailureListeners() {
        if (typeof db === 'undefined' || !db) {
            setTimeout(initFirestoreFailureListeners, 800);
            return;
        }

        let cranesInit = false;
        let opsInit = false;

        // Escuchar rotación y roster de administración
        initRotationListener();

        // 1. Escuchar fallas de grúas
        try {
            db.collection('cranes').onSnapshot(snapshot => {
                if (!cranesInit) {
                    snapshot.forEach(doc => knownFailureIds.add(doc.id));
                    cranesInit = true;
                    return;
                }

                snapshot.docChanges().forEach(change => {
                    if (change.type === 'added' || change.type === 'modified') {
                        const data = change.doc.data();
                        const id = change.doc.id;
                        const status = String(data.status || '').toLowerCase();

                        if (status === 'failure' || status === 'active' || !data.status) {
                            if (!knownFailureIds.has(id)) {
                                knownFailureIds.add(id);
                                dispatchAlert({ id, craneId: id, ...data });
                            }
                        } else {
                            knownFailureIds.delete(id);
                        }
                    } else if (change.type === 'removed') {
                        knownFailureIds.delete(change.doc.id);
                    }
                });
            }, err => console.warn('[TechAlerts] Error listener grúas:', err.message));
        } catch (e) {
            console.error('[TechAlerts] Error inicializando listener grúas:', e);
        }

        // 2. Escuchar paros de estación / operaciones
        try {
            db.collection('operations').onSnapshot(snapshot => {
                if (!opsInit) {
                    snapshot.forEach(doc => knownFailureIds.add('op_' + doc.id));
                    opsInit = true;
                    return;
                }

                snapshot.docChanges().forEach(change => {
                    const id = 'op_' + change.doc.id;
                    if (change.type === 'added' || change.type === 'modified') {
                        const data = change.doc.data();
                        const status = String(data.status || '').toLowerCase();

                        if (status === 'failure' || status === 'active' || !data.status) {
                            if (!knownFailureIds.has(id)) {
                                knownFailureIds.add(id);
                                dispatchAlert({ id, operationId: change.doc.id, ...data });
                            }
                        } else {
                            knownFailureIds.delete(id);
                        }
                    } else if (change.type === 'removed') {
                        knownFailureIds.delete(id);
                    }
                });
            }, err => console.warn('[TechAlerts] Error listener operaciones:', err.message));
        } catch (e) {
            console.error('[TechAlerts] Error inicializando listener operaciones:', e);
        }
    }

    // Inicialización al cargar el DOM
    document.addEventListener('DOMContentLoaded', () => {
        updateBadgeUI();
        initFirestoreFailureListeners();
    });

})();

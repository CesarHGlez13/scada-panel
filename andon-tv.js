(function () {
      'use strict';

      // PocketBase — instancia compartida con scada-config.js / pocketbase-adapter.js
      const pb = window.scadaPb || null;

      let alarmAudioCtx = null;
      let alarmTone = localStorage.getItem('tv_andon_alarm_tone') || 'sirena';
      let prevFailuresCount = 0;
      let wakeLockInstance = null;

      // Almacenes en memoria para grúas y operaciones
      const cranesData = new Map();
      const operationsData = new Map();

      // Configuración de Grúas dinámica sincronizada con PocketBase (config collection)
      let CRANES_BY_AREA = {
        '10': ['10A', '10B', '10C', '10D'],
        '20': ['20A', '20B', '20C', '20D', '20E', '20F'],
        '30': ['30A', '30B', '30C', '30D']
      };

      // ─── Auto-login con cuenta andon_tv (read-only) ───────────────────────────
      // La TV no tiene sesión de usuario interactiva. Se autentica automáticamente
      // con la cuenta dedicada de solo lectura para poder suscribirse al realtime.
      async function ensureTvAuth() {
        if (!pb) return;
        try {
          if (pb.authStore && pb.authStore.isValid) return; // ya autenticado
          await pb.collection('users').authWithPassword(
            'andon_tv@scada.local',
            '<REPLACE_WITH_TV_PASSWORD>'
          );
          console.log('[AndonTV] Autenticado como andon_tv@scada.local');
        } catch (e) {
          console.warn('[AndonTV] Auto-login TV falló:', e.message);
          // Reintentar en 15s
          setTimeout(ensureTvAuth, 15000);
        }
      }

      // Inicializar WakeLock para evitar suspensión en Smart TV
      async function activateWakeLock() {
        try {
          if ('wakeLock' in navigator) {
            wakeLockInstance = await navigator.wakeLock.request('screen');
            wakeLockInstance.addEventListener('release', () => {
              wakeLockInstance = null;
            });
            console.log('✅ Screen WakeLock activo en Smart TV');
          }
        } catch (e) {
          console.log('WakeLock no disponible o bloqueado:', e.message);
        }
      }

      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible' && !wakeLockInstance) {
          activateWakeLock();
        }
      });

      // Síntesis WebAudio Industrial
      function playTone(type = alarmTone) {
        if (type === 'silencio') return;
        try {
          const ctx = alarmAudioCtx || new (window.AudioContext || window.webkitAudioContext)();
          alarmAudioCtx = ctx;
          if (ctx.state === 'suspended') ctx.resume();

          const now = ctx.currentTime;
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.connect(gain);
          gain.connect(ctx.destination);

          if (type === 'sirena') {
            osc.type = 'sawtooth';
            osc.frequency.setValueAtTime(450, now);
            osc.frequency.linearRampToValueAtTime(880, now + 0.35);
            osc.frequency.linearRampToValueAtTime(450, now + 0.7);
            gain.gain.setValueAtTime(0.3, now);
            gain.gain.exponentialRampToValueAtTime(0.01, now + 0.7);
            osc.start(now);
            osc.stop(now + 0.75);
          } else if (type === 'campana') {
            osc.type = 'sine';
            osc.frequency.setValueAtTime(1200, now);
            gain.gain.setValueAtTime(0.4, now);
            gain.gain.exponentialRampToValueAtTime(0.001, now + 1.2);
            osc.start(now);
            osc.stop(now + 1.25);
          } else {
            // Pitido
            osc.type = 'square';
            osc.frequency.setValueAtTime(950, now);
            gain.gain.setValueAtTime(0.25, now);
            gain.gain.exponentialRampToValueAtTime(0.01, now + 0.25);
            osc.start(now);
            osc.stop(now + 0.3);
          }
        } catch (e) {
          console.error('Error generando tono de alarma:', e);
        }
      }

      function formatTime(seconds) {
        if (!seconds || isNaN(seconds) || seconds < 0) return '00:00:00';
        const h = Math.floor(seconds / 3600);
        const m = Math.floor((seconds % 3600) / 60);
        const s = Math.floor(seconds % 60);
        return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
      }

      // Reloj Monospace Chihuahua & Fecha
      function updateLiveClock() {
        const now = (typeof window.getChihuahuaTime === 'function') ? window.getChihuahuaTime() : new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Chihuahua' }));
        const clockEl = document.getElementById('tvLiveClock');
        if (clockEl) {
          clockEl.textContent = now.toLocaleTimeString('es-MX', { hour12: false });
        }
        const dateEl = document.getElementById('tvLiveDate');
        if (dateEl) {
          const options = { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' };
          dateEl.textContent = now.toLocaleDateString('es-MX', options).toUpperCase();
        }
      }

      // Telemetría de Turno
      function updateShiftTelemetry() {
        let hour = 0, m = 0, s = 0, day = 0;
        try {
          const parts = new Intl.DateTimeFormat('en-US', {
            timeZone: 'America/Chihuahua',
            weekday: 'short',
            hour: 'numeric',
            minute: 'numeric',
            second: 'numeric',
            hour12: false
          }).formatToParts(new Date());
          hour = parseInt(parts.find(p => p.type === 'hour').value, 10);
          if (hour === 24) hour = 0;
          m = parseInt(parts.find(p => p.type === 'minute').value, 10);
          s = parseInt(parts.find(p => p.type === 'second').value, 10);
          const chih = new Date(Date.now() - 6 * 3600 * 1000); // instante desplazado: getters UTC = Chihuahua
          day = chih.getUTCDay();
        } catch (e) {
          const chih = new Date(Date.now() - 6 * 3600 * 1000);
          day = chih.getUTCDay();
          hour = chih.getUTCHours();
          m = chih.getUTCMinutes();
          s = chih.getUTCSeconds();
        }

        let shiftLetter = 'A';
        let isNight = false;
        let shiftType = 'TURNO MATUTINO';
        let elapsedSec = 0;

        if (hour >= 6 && hour < 18) {
          isNight = false;
          shiftType = 'TURNO MATUTINO';
          shiftLetter = [0, 1, 2].includes(day) ? 'A' : 'B';
          elapsedSec = (hour - 6) * 3600 + m * 60 + s;
        } else {
          isNight = true;
          shiftType = 'TURNO NOCTURNO';
          if (day === 0 && hour < 6) shiftLetter = 'D';
          else if ([0, 1, 2].includes(day)) shiftLetter = 'C';
          else shiftLetter = 'D';
          elapsedSec = (hour >= 18 ? (hour - 18) : (hour + 6)) * 3600 + m * 60 + s;
        }

        const totalSec = 12 * 3600;
        const pct = Math.min(100, Math.max(0, (elapsedSec / totalSec) * 100));
        const remSec = Math.max(0, totalSec - elapsedSec);

        const elH = Math.floor(elapsedSec / 3600);
        const elM = Math.floor((elapsedSec % 3600) / 60);
        const remH = Math.floor(remSec / 3600);
        const remM = Math.floor((remSec % 3600) / 60);

        const badgeEl = document.getElementById('tvShiftBadge');
        if (badgeEl) badgeEl.textContent = `JORNADA ${shiftLetter}`;

        const nameEl = document.getElementById('tvShiftName');
        if (nameEl) nameEl.textContent = shiftType;

        const progEl = document.getElementById('tvShiftProgress');
        if (progEl) progEl.style.width = `${pct.toFixed(1)}%`;

        const elEl = document.getElementById('tvShiftElapsed');
        if (elEl) elEl.textContent = `Transcurrido: ${elH}h ${elM}m (${pct.toFixed(0)}%)`;

        const remEl = document.getElementById('tvShiftRemaining');
        if (remEl) remEl.textContent = `Resta: ${remH}h ${remM}m`;
      }

      // Render de Tarjetas en Pantalla
      function renderDashboard() {
        const container = document.getElementById('tvMainContainer');
        if (!container) return;

        let totalEquip = 0;
        let opCount = 0;
        let failCount = 0;
        let maintCount = 0;
        let lateCount = 0;
        let hasCritical = false;
        const escalationList = [];

        let html = '';

        // Agrupar por áreas
        Object.keys(CRANES_BY_AREA).forEach(areaKey => {
          const craneIds = CRANES_BY_AREA[areaKey];
          let areaHtml = '';
          let areaFail = 0;

          craneIds.forEach(id => {
            totalEquip++;
            const crane = cranesData.get(id) || { id, status: 'operational', description: 'Operativa', area: areaKey };

            const isFail = crane.status === 'failed' || crane.status === 'active';
            const isMaint = crane.status === 'maintenance';
            const isOp = !isFail && !isMaint;

            if (isOp) opCount++;
            if (isMaint) maintCount++;
            if (isFail) {
              failCount++;
              areaFail++;
            }

            const startTime = crane.timerStart || (isFail ? Date.now() : null);
            const elapsed = startTime ? Math.floor((Date.now() - startTime) / 1000) : 0;

            let cardClass = 'tv-card ';
            let badgeClass = 'tv-status-badge ';
            let badgeText = 'OPERATIVA';
            let timerHtml = '';
            let timeBarHtml = '';

            if (isOp) {
              cardClass += 'operational';
              badgeClass += 'tv-badge-ok';
              badgeText = '🟢 OPERATIVA';
            } else if (isMaint) {
              cardClass += 'maintenance';
              badgeClass += 'tv-badge-maint';
              badgeText = '🔧 REPARACIÓN';

              const failedStart = crane.failedStart || startTime;
              const maintStart = crane.maintStart || Date.now();
              const failedSec = Math.max(0, Math.floor((maintStart - failedStart) / 1000));
              const maintSec = Math.max(0, Math.floor((Date.now() - maintStart) / 1000));
              const totalSec = failedSec + maintSec;

              timerHtml = `
                <div class="tv-3timers-box font-mono">
                  <div class="text-danger">🔴 T1 Llegada: ${formatTime(failedSec)}</div>
                  <div class="text-warning">🔧 T2 Trabajo: ${formatTime(maintSec)}</div>
                  <div class="text-info fw-bold">📊 T3 Total: ${formatTime(totalSec)}</div>
                </div>
              `;
            } else if (isFail) {
              cardClass += 'failure';

              if (elapsed >= 900) {
                hasCritical = true;
                lateCount++;
                escalationList.push(`Grúa ${id} (+${formatTime(elapsed)} N3 CRÍTICO)`);
                cardClass += ' critical-escalated';
                badgeClass += 'tv-badge-critical';
                badgeText = '🚨 CRÍTICO N3 (>15m)';
              } else if (elapsed >= 300) {
                lateCount++;
                escalationList.push(`Grúa ${id} (+${formatTime(elapsed)} N2 TARDE)`);
                cardClass += ' late-escalated';
                badgeClass += 'tv-badge-late';
                badgeText = '⚠️ TARDE N2 (>5m)';
              } else {
                badgeClass += 'tv-badge-fail';
                badgeText = '🚨 FALLA N1';
              }

              timerHtml = `<div class="tv-giant-timer font-mono" data-start="${startTime}">${formatTime(elapsed)}</div>`;

              const pct = elapsed >= 300 ? 100 : Math.min(100, Math.round((elapsed / 300) * 100));
              const strobeClass = elapsed >= 300 ? 'strobe' : '';
              timeBarHtml = `
                <div class="tv-time-bar-wrap" title="Progreso de atención SLA (Meta < 5m)">
                  <div class="tv-time-bar ${strobeClass}" style="width: ${pct}%;"></div>
                </div>
              `;
            }

            const techName = crane.maintenanceByName || crane.maintenanceBy || crane.reportedBy;
            const techHtml = (techName && (isFail || isMaint)) ? `
              <div class="scada-tech-chip assigned mt-2" style="font-size:0.75rem; padding:3px 8px; display:inline-flex; align-items:center; gap:6px;">
                <span class="scada-tech-avatar" style="width:16px; height:16px; font-size:0.6rem;">${techName.charAt(0)}</span>
                <span>Técnico: <strong>${techName}</strong></span>
              </div>` : '';

            areaHtml += `
              <div class="${cardClass}" data-id="${id}">
                <div class="tv-card-header">
                  <span class="tv-equip-id font-heading">Grúa ${id}</span>
                  <span class="${badgeClass} font-mono">${badgeText}</span>
                </div>
                ${timerHtml}
                ${timeBarHtml}
                <div class="tv-desc-text font-mono">${crane.description || 'Operativa'}</div>
                ${techHtml}
              </div>
            `;
          });

          const tvAreaTitle = (window.HermesTopology && window.HermesTopology.getAreaLabel) 
              ? window.HermesTopology.getAreaLabel(areaKey) 
              : `Área ${areaKey}`;

          html += `
            <section class="tv-area-section">
              <div class="tv-area-header">
                <h3 class="tv-area-title font-heading">
                  <i class="bi bi-geo-alt-fill text-info"></i> ${tvAreaTitle}
                </h3>
                <span class="tv-area-pill-stats font-mono">
                  ${craneIds.length} Grúas ${areaFail > 0 ? `• <span class="text-danger fw-bold">🚨 ${areaFail} En Falla</span>` : '• <span class="text-success">🟢 100% OK</span>'}
                </span>
              </div>
              <div class="tv-grid">
                ${areaHtml}
              </div>
            </section>
          `;
        });

        container.innerHTML = html;

        // Actualizar KPIs de la cabecera
        const availPct = totalEquip > 0 ? Math.max(0, Math.min(100, Math.round(((totalEquip - failCount) / totalEquip) * 100))) : 100;
        const oeeEl = document.getElementById('tvKpiOee');
        if (oeeEl) oeeEl.textContent = `${availPct}%`;

        // Actualizar Arco del Radial Gauge
        const radialArc = document.getElementById('tvRadialGaugeArc');
        if (radialArc) {
          const offset = Math.max(0, Math.min(120, 120 - (availPct / 100) * 120));
          radialArc.style.strokeDashoffset = offset;
          if (availPct >= 95) radialArc.style.stroke = '#10b981';
          else if (availPct >= 80) radialArc.style.stroke = '#f59e0b';
          else radialArc.style.stroke = '#ef4444';
        }

        const opEl = document.getElementById('tvKpiOperational');
        if (opEl) opEl.textContent = opCount;

        const failEl = document.getElementById('tvKpiFailures');
        if (failEl) failEl.textContent = failCount;

        const lateEl = document.getElementById('tvKpiLate');
        if (lateEl) lateEl.textContent = lateCount;

        const maintEl = document.getElementById('tvKpiMaint');
        if (maintEl) maintEl.textContent = maintCount;

        // Actualizar Ticker Marquee con Paros Escalados
        const tickerInner = document.getElementById('tvTickerInner');
        if (tickerInner) {
          if (escalationList.length > 0) {
            tickerInner.innerHTML = `<span style="color:#ef4444; font-weight:800;">🚨 [PARO ESCALADO ACTIVO] ${escalationList.join(' • ')} — ASISTENCIA INMEDIATA REQUERIDA • REPORTANDO A GERENCIA Y CONTROL CENTRAL</span>`;
          } else {
            tickerInner.innerHTML = `⚡ SCADA ANDON 4.0 ACTIVO • MONITOREO DE PLANTA EN TIEMPO REAL • REACCIÓN TÉCNICA META SLA &lt; 5 MINUTOS • ESCALAMIENTO N1 &gt; N2 SUPERVISOR &gt; N3 GERENCIA • ENTREGA DE GUARDIA AUTOMÁTICA`;
          }
        }

        // Alarma Sonora en nueva falla
        if (failCount > prevFailuresCount && prevFailuresCount !== 0) {
          playTone();
        }
        prevFailuresCount = failCount;

        // Semáforo Beacon
        const beacon = document.getElementById('tvGlobalBeacon');
        const subtext = document.getElementById('tvStatusSubtext');
        if (beacon && subtext) {
          if (hasCritical) {
            beacon.className = 'tv-online-beacon danger';
            subtext.innerHTML = '<span class="text-danger fw-bold">🚨 ALERTA CRÍTICA NIVEL 3 ESCALADA A GERENCIA</span>';
          } else if (lateCount > 0) {
            beacon.className = 'tv-online-beacon danger';
            subtext.innerHTML = '<span class="text-warning fw-bold">⚠️ ALERTA TARDE (>5m) ESCALADA A SUPERVISOR</span>';
          } else if (failCount > 0) {
            beacon.className = 'tv-online-beacon warning';
            subtext.innerHTML = '<span class="text-warning fw-bold">⚠️ ATENCIÓN REQUERIDA • PARO EN PLANTA</span>';
          } else {
            beacon.className = 'tv-online-beacon';
            subtext.innerHTML = '<i class="bi bi-shield-check text-success"></i> SISTEMA SCADA INDUSTRIAL • CERO PÉRDIDA DE PAQUETES';
          }
        }

        // Sincronizar con el Digital Twin de Planta y el motor de topología
        try {
          window.dispatchEvent(new CustomEvent('andonstate', {
            detail: {
              cranes: Array.from(cranesData.values()),
              operations: Array.from(operationsData.values()),
              updatedAt: Date.now()
            }
          }));
        } catch (e) {}
      }

      // ─── Listeners PocketBase Realtime ────────────────────────────────────────
      // Reemplazo de los onSnapshot de Firestore por suscripciones SSE de PocketBase.
      // PocketBase realtime requiere autenticación para colecciones auth_required.
      function initFirestoreListeners() {
        if (!pb) {
          console.warn('[AndonTV] PocketBase no disponible. Los datos no se actualizarán en tiempo real.');
          return;
        }

        // 1. Escucha en tiempo real de 'cranes' (notificaciones activas)
        pb.collection('cranes').subscribe('*', ({ action, record }) => {
          const id = record.id;
          if (action === 'delete') {
            cranesData.delete(id);
          } else {
            const timerStart = record.reportedAt
              ? new Date(record.reportedAt).getTime()
              : Date.now();
            cranesData.set(id, {
              id,
              status: record.status || 'failed',
              description: record.description || 'Falla reportada',
              timerStart,
              statusHistory: record.statusHistory || []
            });
          }
          renderDashboard();
        }).catch(err => console.error('[AndonTV] Error suscribiendo cranes:', err));

        // Carga inicial de cranes
        pb.collection('cranes').getList(1, 200).then(res => {
          res.items.forEach(record => {
            const timerStart = record.reportedAt
              ? new Date(record.reportedAt).getTime()
              : Date.now();
            cranesData.set(record.id, {
              id: record.id,
              status: record.status || 'failed',
              description: record.description || 'Falla reportada',
              timerStart,
              statusHistory: record.statusHistory || []
            });
          });
          renderDashboard();
        }).catch(err => console.warn('[AndonTV] Error cargando cranes inicial:', err));

        // 2. Escucha en tiempo real de 'crane_status'
        pb.collection('crane_status').subscribe('*', ({ action, record }) => {
          const id = record.id;
          const est = (record.estado || '').toLowerCase();
          if (action === 'delete' || est.includes('operat')) {
            cranesData.delete(id);
          } else if (est.includes('repar') || est.includes('manten')) {
            const prev = cranesData.get(id) || {};
            cranesData.set(id, {
              ...prev,
              id,
              status: 'maintenance',
              description: record.motivo || prev.description || 'En reparación técnica',
              maintStart: Date.now()
            });
          }
          renderDashboard();
        }).catch(err => console.error('[AndonTV] Error suscribiendo crane_status:', err));

        // Carga inicial de crane_status
        pb.collection('crane_status').getList(1, 200).then(res => {
          res.items.forEach(record => {
            const est = (record.estado || '').toLowerCase();
            if (est.includes('repar') || est.includes('manten')) {
              const prev = cranesData.get(record.id) || {};
              cranesData.set(record.id, {
                ...prev,
                id: record.id,
                status: 'maintenance',
                description: record.motivo || 'En reparación técnica',
                maintStart: Date.now()
              });
            }
          });
          renderDashboard();
        }).catch(err => console.warn('[AndonTV] Error cargando crane_status inicial:', err));

        // 3. Escucha en tiempo real de configuración de grúas (config collection)
        pb.collection('config').subscribe('*', ({ action, record }) => {
          if (action === 'delete' || record.key !== 'cranes_config') return;
          _applyCranesConfig(record);
        }).catch(err => console.warn('[AndonTV] Error suscribiendo config:', err));

        // Carga inicial de config/cranes_config
        pb.collection('config').getFirstListItem('key="cranes_config"').then(record => {
          _applyCranesConfig(record);
        }).catch(err => console.warn('[AndonTV] Error cargando cranes_config:', err));
      }

      function _applyCranesConfig(record) {
        try {
          const data = typeof record.value === 'string' ? JSON.parse(record.value) : (record.value || record);
          const newMap = {};
          const order = data._order || Object.keys(data).filter(k => k !== '_order');
          order.forEach(k => {
            if (k !== '_order' && Array.isArray(data[k]) && data[k].length > 0) {
              const code = k.replace(/\D/g, '');
              newMap[code || k] = data[k];
            }
          });
          if (Object.keys(newMap).length > 0) {
            CRANES_BY_AREA = newMap;
            renderDashboard();
          }
        } catch (e) {
          console.warn('[AndonTV] Error procesando cranes_config:', e.message);
        }
      }

      // Intervalo de 1 segundo para timers y reloj
      setInterval(() => {
        updateLiveClock();
        updateShiftTelemetry();

        // Actualizar cronómetros visibles en tiempo real
        document.querySelectorAll('.tv-giant-timer').forEach(el => {
          const start = parseInt(el.getAttribute('data-start'));
          if (!isNaN(start)) {
            const sec = Math.floor((Date.now() - start) / 1000);
            el.textContent = formatTime(sec);
          }
        });
      }, 1000);

      // Botón Pantalla Completa
      window.toggleTvFullscreen = function () {
        if (!document.fullscreenElement) {
          document.documentElement.requestFullscreen().catch(err => {
            console.log('Error solicitando pantalla completa:', err);
          });
        } else {
          if (document.exitFullscreen) document.exitFullscreen();
        }
      };

      // Alternar Topología Digital Twin de Planta en Smart TV
      window.toggleTvPlantMap = function () {
        const wrap = document.getElementById('tvPlantMapWrapper');
        const btn = document.getElementById('tvToggleMapBtn');
        if (!wrap) return;
        const isHidden = (wrap.style.display === 'none' || !wrap.style.display);
        wrap.style.display = isHidden ? 'block' : 'none';
        if (btn) btn.classList.toggle('active', isHidden);
        if (isHidden && window.PlantMapEngine) {
          window.PlantMapEngine.init('scada-plant-map-container');
          window.PlantMapEngine.setViewMode('split');
          window.PlantMapEngine.syncState();
          wrap.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
        if (window.IndustrialAudio) window.IndustrialAudio.playClick();
      };

      // Selector y prueba de sonido
      document.getElementById('tvAlarmSelect').addEventListener('change', (e) => {
        alarmTone = e.target.value;
        localStorage.setItem('tv_andon_alarm_tone', alarmTone);
        if (alarmTone !== 'silencio') playTone(alarmTone);
      });

      document.getElementById('tvTestAudioBtn').addEventListener('click', () => {
        playTone(alarmTone === 'silencio' ? 'sirena' : alarmTone);
      });

      window.updateTvVoiceBtnUI = function () {
        const btn = document.getElementById('tvToggleVoiceBtn');
        if (!btn || !window.IndustrialAudio) return;
        const active = window.IndustrialAudio.isVoiceActive();
        btn.classList.toggle('active', active);
        btn.innerHTML = active
          ? '<i class="bi bi-megaphone-fill text-warning"></i> Voz'
          : '<i class="bi bi-mic-mute-fill text-secondary"></i> Mudo';
      };

      let listenersInitialized = false;

      // Inicialización
      async function initApp() {
        updateLiveClock();
        updateShiftTelemetry();
        activateWakeLock();
        renderDashboard();
        window.updateTvVoiceBtnUI();

        // La TV es un cliente anónimo: necesita sesión para leer colecciones auth_required.
        // Se autentica sola con la cuenta dedicada de solo lectura.
        await ensureTvAuth();

        if (!listenersInitialized) {
          listenersInitialized = true;
          initFirestoreListeners();
        }
      }

      // Ejecutar de inmediato y sincronizar con DOM
      updateLiveClock();
      updateShiftTelemetry();

      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initApp);
      } else {
        initApp();
      }

      window.addEventListener('plant_topology_updated', () => {
        renderDashboard();
      });
    })();
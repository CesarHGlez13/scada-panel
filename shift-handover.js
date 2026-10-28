/**
 * SHIFT HANDOVER REPORT (ENTREGA DE GUARDIA AUTOMÁTICA CON GRÁFICOS EJECUTIVOS HD)
 * Operations Monitor Industrial SCADA
 * 
 * Compila en 1 clic el reporte ejecutivo de fin de turno (12 horas)
 * para la guardia saliente y entrante (Jornadas A, B, C, D).
 * Métricas OEE reales, telemetría de fallas en curso, gráficos de alta definición
 * renderizados nativamente en Canvas con soporte de exportación a PDF oficial y WhatsApp.
 */

(function () {
  'use strict';

  // Almacén de instancias de gráficos para evitar fugas de memoria
  let handoverCharts = {
    availability: null,
    downtime: null,
    timeline: null,
    subsystems: null
  };

  function destroyExistingCharts() {
    Object.keys(handoverCharts).forEach((k) => {
      if (handoverCharts[k]) {
        try { handoverCharts[k].destroy(); } catch (e) {}
        handoverCharts[k] = null;
      }
    });
  }

  // Carga dinámica de Chart.js si no estuviese presente
  async function ensureChartJsLoaded() {
    if (typeof Chart !== 'undefined') return true;
    return new Promise((resolve) => {
      const existing = document.querySelector('script[src*="chart"]');
      if (existing && typeof Chart === 'undefined') {
        existing.addEventListener('load', () => resolve(true));
        existing.addEventListener('error', () => resolve(false));
        return;
      }
      const script = document.createElement('script');
      script.src = 'https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js';
      script.onload = () => resolve(true);
      script.onerror = () => resolve(false);
      document.head.appendChild(script);
    });
  }

  function formatDurationMinutes(seconds) {
    if (!seconds || seconds <= 0) return '0m';
    const mins = Math.round(seconds / 60);
    if (mins < 60) return `${mins} min`;
    const hrs = Math.floor(mins / 60);
    const rem = mins % 60;
    if (hrs >= 24) {
      const days = Math.floor(hrs / 24);
      const remHrs = hrs % 24;
      return `${days}d ${remHrs}h ${rem}m`;
    }
    return `${hrs}h ${rem}m`;
  }

  function getChihuahuaNow() {
    if (typeof window.getChihuahuaTime === 'function') return window.getChihuahuaTime();
    return new Date();
  }

  function getShiftLetter(shiftObj) {
    if (!shiftObj) return 'A';
    const name = shiftObj.name || '';
    const match = name.match(/[ABCD]/i);
    return match ? match[0].toUpperCase() : 'A';
  }

  // Extractor robusto de fecha de inicio de evento industrial
  function extractEventStartTime(d) {
    if (!d) return null;
    // 1. Prioridad: reportedAt (formato estándar de grúas)
    if (d.reportedAt) {
      if (typeof d.reportedAt.toDate === 'function') return d.reportedAt.toDate();
      if (typeof d.reportedAt === 'number') return new Date(d.reportedAt);
      if (!isNaN(Date.parse(d.reportedAt))) return new Date(d.reportedAt);
    }
    // 2. timerStartTime (operaciones en línea)
    if (d.timerStartTime) {
      if (typeof d.timerStartTime === 'number') return new Date(d.timerStartTime);
      if (!isNaN(Date.parse(d.timerStartTime))) return new Date(d.timerStartTime);
    }
    // 3. statusHistory
    if (Array.isArray(d.statusHistory) && d.statusHistory.length > 0) {
      const failedEntry = d.statusHistory.find(e => e.status === 'failed' || e.status === 'active' || e.status === 'falla');
      if (failedEntry && failedEntry.at) {
        const dt = new Date(failedEntry.at);
        if (!isNaN(dt.getTime())) return dt;
      }
      const lastEntry = d.statusHistory[d.statusHistory.length - 1];
      if (lastEntry && lastEntry.at) {
        const dt = new Date(lastEntry.at);
        if (!isNaN(dt.getTime())) return dt;
      }
    }
    // 4. Fallbacks secundarios
    const fallback = d.timestamp || d.createdAt || d.updatedAt || d.date;
    if (fallback) {
      if (typeof fallback.toDate === 'function') return fallback.toDate();
      if (typeof fallback === 'number') return new Date(fallback);
      if (!isNaN(Date.parse(fallback))) return new Date(fallback);
    }
    return null;
  }

  // Clasificador heurístico industrial de subsistemas de falla
  function classifySubsystem(desc) {
    const text = String(desc || '').toLowerCase();
    if (text.includes('fuga') || text.includes('neumat') || text.includes('neumát') || text.includes('aire') || text.includes('presion') || text.includes('presión') || text.includes('valvula') || text.includes('válvula') || text.includes('manguera') || text.includes('piston')) {
      return 'Neumático / Línea de Aire';
    }
    if (text.includes('polipasto') || text.includes('izaje') || text.includes('gancho') || text.includes('cable') || text.includes('freno de carga') || text.includes('tambor')) {
      return 'Izaje / Polipasto';
    }
    if (text.includes('carro') || text.includes('traslacion') || text.includes('traslación') || text.includes('puente') || text.includes('riel') || text.includes('rueda') || text.includes('chumacera') || text.includes('tester')) {
      return 'Traslación / Carro';
    }
    if (text.includes('motor') || text.includes('variador') || text.includes('inversor') || text.includes('termico') || text.includes('térmico') || text.includes('fusible') || text.includes('fase') || text.includes('electr')) {
      return 'Sistema Eléctrico';
    }
    if (text.includes('boton') || text.includes('botonera') || text.includes('control') || text.includes('esp32') || text.includes('scada') || text.includes('wifi') || text.includes('sensor') || text.includes('limite') || text.includes('límite')) {
      return 'Control / Sensores';
    }
    if (text.includes('leva') || text.includes('engrane') || text.includes('cadena') || text.includes('rodamiento') || text.includes('balero') || text.includes('mecanic') || text.includes('mecánic') || text.includes('desgaste') || text.includes('rot')) {
      return 'Mecánico / Transmisión';
    }
    return 'Operación / Paro en Línea';
  }

  async function generateShiftHandoverData() {
    const now = getChihuahuaNow();
    let currentShift = { name: 'Jornada Actual', letter: 'A', startHour: 6, endHour: 18, description: 'Turno continuo de 12 horas' };

    if (typeof window.getCurrentShift === 'function') {
      const s = window.getCurrentShift();
      if (s) {
        const letter = getShiftLetter(s);
        currentShift = { ...s, letter };
      }
    }

    // Calcular inicio y avance de la jornada actual de 12 horas
    const isNightShift = (currentShift.startHour >= 18 || currentShift.startHour < 6);
    const shiftStart = new Date(now);
    if (isNightShift) {
      // getChihuahuaNow() es el instante desplazado -6h: sus getters UTC son la hora real de
      // Chihuahua. Usar getters locales sumaba el desfase dos veces y adelantaba la jornada
      // cuando el dispositivo no está en zona UTC.
      if (now.getUTCHours() < 6) {
        shiftStart.setUTCDate(shiftStart.getUTCDate() - 1);
      }
      shiftStart.setUTCHours(18, 0, 0, 0);
    } else {
      shiftStart.setUTCHours(6, 0, 0, 0);
    }

    // Minutos transcurridos en el turno actual (1 a 720 min)
    const shiftProgressMinutes = Math.max(1, Math.min(720, Math.floor((now.getTime() - shiftStart.getTime()) / 60000)));

    let activeFailures = [];
    let resolvedFailures = [];
    let refactionsRaw = [];
    let totalCranesCount = 18;
    let totalOpsCount = 6;

    if (typeof db !== 'undefined' && db) {
      try {
        // 1. Obtener equipos y fallas activas
        const [cranesSnap, opsSnap] = await Promise.all([
          db.collection('cranes').get().catch(() => ({ size: 18, forEach: () => {} })),
          db.collection('operations').get().catch(() => ({ size: 6, forEach: () => {} }))
        ]);

        if (cranesSnap && cranesSnap.size) totalCranesCount = cranesSnap.size;
        if (opsSnap && opsSnap.size) totalOpsCount = opsSnap.size;

        cranesSnap.forEach(doc => {
          const d = doc.data();
          const st = String(d.status || '').toLowerCase();
          if (st === 'failure' || st === 'failed' || st === 'active' || st === 'falla' || st === 'mantenimiento') {
            const startDate = extractEventStartTime(d) || new Date(now.getTime() - (15 * 60000));
            const elapsedSec = Math.max(60, Math.floor((now.getTime() - startDate.getTime()) / 1000));

            // Tiempo muerto atribuible a ESTA jornada de 12h
            const effectiveStartInShift = Math.max(shiftStart.getTime(), startDate.getTime());
            const shiftDowntimeSec = Math.max(60, Math.floor((now.getTime() - effectiveStartInShift) / 1000));

            activeFailures.push({
              id: doc.id,
              type: 'Grúa',
              area: d.area || 'Área Principal',
              reason: d.description || d.reason || 'Falla activa en equipo',
              reportedAtDate: startDate,
              elapsedSeconds: elapsedSec,
              shiftDowntimeSeconds: shiftDowntimeSec,
              subsystem: classifySubsystem(d.description || d.reason)
            });
          }
        });

        opsSnap.forEach(doc => {
          const d = doc.data();
          const st = String(d.status || '').toLowerCase();
          if (st === 'failure' || st === 'failed' || st === 'active' || st === 'falla' || st === 'mantenimiento') {
            const startDate = extractEventStartTime(d) || new Date(now.getTime() - (15 * 60000));
            const elapsedSec = Math.max(60, Math.floor((now.getTime() - startDate.getTime()) / 1000));

            const effectiveStartInShift = Math.max(shiftStart.getTime(), startDate.getTime());
            const shiftDowntimeSec = Math.max(60, Math.floor((now.getTime() - effectiveStartInShift) / 1000));

            activeFailures.push({
              id: doc.id,
              type: 'Operación',
              area: d.area || 'Línea de Operación',
              reason: d.description || d.reason || 'Paro de estación en línea',
              reportedAtDate: startDate,
              elapsedSeconds: elapsedSec,
              shiftDowntimeSeconds: shiftDowntimeSec,
              subsystem: classifySubsystem(d.description || d.reason)
            });
          }
        });

        // 2. Obtener historial resuelto en esta jornada
        const dateStr = typeof window.getChihuahuaDateString === 'function'
          ? window.getChihuahuaDateString(now)
          : now.toISOString().split('T')[0];

        const historyCollCranes = `crane_history_${dateStr}_Jornada${currentShift.letter}`;
        const historyCollOps = `operations_history_${dateStr}_Jornada${currentShift.letter}`;

        const [histCranesSnap, histOpsSnap] = await Promise.all([
          db.collection(historyCollCranes).limit(50).get().catch(() => ({ forEach: () => {} })),
          db.collection(historyCollOps).limit(50).get().catch(() => ({ forEach: () => {} }))
        ]);

        histCranesSnap.forEach(doc => {
          const d = doc.data();
          const dt = extractEventStartTime(d);
          resolvedFailures.push({
            id: d.craneId || doc.id,
            type: 'Grúa',
            area: d.area || 'Área Principal',
            downtimeSeconds: d.downtimeSeconds || d.durationSeconds || (d.downtimeMinutes ? d.downtimeMinutes * 60 : 600),
            technician: d.resolvedBy || d.technician || 'Técnico de Guardia',
            reason: d.description || d.reason || 'Falla resuelta',
            timestamp: dt,
            subsystem: classifySubsystem(d.description || d.reason)
          });
        });

        histOpsSnap.forEach(doc => {
          const d = doc.data();
          const dt = extractEventStartTime(d);
          resolvedFailures.push({
            id: d.id || d.operationId || doc.id,
            type: 'Operación',
            area: d.area || 'Línea de Operación',
            downtimeSeconds: d.downtimeSeconds || d.durationSeconds || (d.downtimeMinutes ? d.downtimeMinutes * 60 : 600),
            technician: d.resolvedBy || d.technician || 'Técnico de Guardia',
            reason: d.description || d.reason || 'Paro de línea resuelto',
            timestamp: dt,
            subsystem: classifySubsystem(d.description || d.reason)
          });
        });

        // 3. Refacciones usadas hoy
        try {
          const refSnap = await db.collection('inventory_movements')
            .where('type', '==', 'salida')
            .limit(30)
            .get();
          refSnap.forEach(doc => {
            const d = doc.data();
            refactionsRaw.push({
              item: d.itemName || d.description || 'Refacción',
              quantity: d.quantity || 1,
              usedFor: d.reasonType || d.craneId || 'Mantenimiento'
            });
          });
        } catch (e) {}

      } catch (err) {
        console.error('[Handover] Error extrayendo telemetría:', err);
      }
    }

    // Consolidación profesional de refacciones (agrupar piezas idénticas)
    const refactionsConsolidated = {};
    refactionsRaw.forEach(r => {
      const key = (r.item || 'Refacción').trim();
      if (!refactionsConsolidated[key]) {
        refactionsConsolidated[key] = { name: key, count: 0, channels: [] };
      }
      refactionsConsolidated[key].count += (r.quantity || 1);
      const ch = (r.usedFor || 'Mantenimiento').trim();
      if (!refactionsConsolidated[key].channels.includes(ch)) {
        refactionsConsolidated[key].channels.push(ch);
      }
    });
    const refactionsSummaryList = Object.values(refactionsConsolidated);

    // CALCULO OEE REAL Y MATEMÁTICAMENTE COHERENTE DE LA GUARDIA
    const totalEquipos = Math.max(1, totalCranesCount + totalOpsCount);
    const totalShiftCapacityMinutes = totalEquipos * shiftProgressMinutes;

    let shiftDowntimeSec = resolvedFailures.reduce((acc, curr) => acc + (curr.downtimeSeconds || 0), 0);
    activeFailures.forEach(f => {
      shiftDowntimeSec += (f.shiftDowntimeSeconds || 0);
    });

    const shiftDowntimeMinutes = Math.round(shiftDowntimeSec / 60);
    const availabilityPctNum = Math.max(0, Math.min(100, ((totalShiftCapacityMinutes - shiftDowntimeMinutes) / totalShiftCapacityMinutes) * 100));
    const availabilityPct = availabilityPctNum.toFixed(1);

    const totalParos = activeFailures.length + resolvedFailures.length;
    const avgMTTRSec = resolvedFailures.length > 0 ? Math.round(shiftDowntimeSec / (resolvedFailures.length || 1)) : 0;

    // Desglose de Downtime por Equipo (Top Impacto)
    const equipmentImpactMap = {};
    activeFailures.forEach(f => {
      const cleanName = `${f.type === 'Grúa' ? 'Grúa ' : ''}${f.id.replace(/^grua[_-]?/i, '')}`;
      const mins = Math.max(1, Math.round((f.shiftDowntimeSeconds || 600) / 60));
      equipmentImpactMap[cleanName] = (equipmentImpactMap[cleanName] || 0) + mins;
    });
    resolvedFailures.forEach(r => {
      const cleanName = `${r.type === 'Grúa' ? 'Grúa ' : ''}${r.id.replace(/^grua[_-]?/i, '')}`;
      const mins = Math.max(1, Math.round((r.downtimeSeconds || 600) / 60));
      equipmentImpactMap[cleanName] = (equipmentImpactMap[cleanName] || 0) + mins;
    });

    // Desglose de subsistemas
    const subsystemMap = {
      'Mecánico / Transmisión': 0,
      'Neumático / Línea de Aire': 0,
      'Izaje / Polipasto': 0,
      'Traslación / Carro': 0,
      'Sistema Eléctrico': 0,
      'Control / Sensores': 0
    };
    [...activeFailures, ...resolvedFailures].forEach(ev => {
      const sub = ev.subsystem || 'Mecánico / Transmisión';
      subsystemMap[sub] = (subsystemMap[sub] || 0) + 1;
    });

    // Cronología real del turno de 12 horas
    const timelineLabels = [];
    const timelineCounts = new Array(12).fill(0);
    const baseStartHour = isNightShift ? 18 : 6;
    for (let i = 0; i < 12; i++) {
      const h = (baseStartHour + i) % 24;
      timelineLabels.push(h < 10 ? `0${h}:00` : `${h}:00`);
    }

    [...activeFailures, ...resolvedFailures].forEach(ev => {
      const evDate = ev.reportedAtDate || ev.timestamp;
      if (evDate && !isNaN(evDate.getTime())) {
        // Hora de Chihuahua del evento (UTC-6, sin horario de verano), independientemente
        // de la zona horaria del dispositivo.
        const h = (evDate.getUTCHours() - 6 + 24) % 24;
        let idx = -1;
        if (isNightShift) {
          if (h >= 18) idx = h - 18;
          else if (h < 6) idx = h + 6;
        } else {
          if (h >= 6 && h < 18) idx = h - 6;
        }
        if (idx >= 0 && idx < 12) {
          timelineCounts[idx] += 1;
        } else {
          // Si ocurrió antes del turno pero sigue activa, registrarla al arranque de guardia
          timelineCounts[0] += 1;
        }
      } else {
        timelineCounts[0] += 1;
      }
    });

    return {
      shift: currentShift,
      dateFormatted: now.toLocaleDateString('es-MX', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }),
      timeFormatted: now.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' }),
      activeFailures,
      resolvedFailures,
      refactionsSummaryList,
      totalParos,
      totalEquipos,
      shiftProgressMinutes,
      totalDowntime: formatDurationMinutes(shiftDowntimeSec),
      mttrFormatted: formatDurationMinutes(avgMTTRSec),
      availabilityPct,
      equipmentImpactMap,
      subsystemMap,
      timelineLabels,
      timelineCounts
    };
  }

  // Renderizado de Gráficos con Chart.js con soporte dual (Pantalla y Canvas para Impresión)
  function renderExecutiveCharts(data) {
    destroyExistingCharts();

    const chartFont = "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
    const availVal = parseFloat(data.availabilityPct);
    const downtimeVal = Math.max(0, (100 - availVal)).toFixed(1);

    // 1. GRÁFICO 1: GAUGE DE DISPONIBILIDAD (Con Texto Central Dibujado Directamente en Canvas)
    const availCanvas = document.getElementById('handoverAvailabilityChart');
    if (availCanvas) {
      const centerPlugin = {
        id: 'centerTextPlugin',
        afterDraw: function (chart) {
          const { ctx, chartArea: { top, bottom, left, right } } = chart;
          ctx.save();
          const centerX = (left + right) / 2;
          const centerY = (top + bottom) / 2 + 10;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          
          ctx.font = '800 24px ' + chartFont;
          ctx.fillStyle = availVal >= 90 ? '#10b981' : (availVal >= 75 ? '#f59e0b' : '#ef4444');
          ctx.fillText(`${availVal}%`, centerX, centerY - 8);

          ctx.font = '700 9px ' + chartFont;
          ctx.fillStyle = '#94a3b8';
          ctx.fillText('DISPONIBILIDAD', centerX, centerY + 14);
          ctx.restore();
        }
      };

      handoverCharts.availability = new Chart(availCanvas, {
        type: 'doughnut',
        data: {
          labels: ['Operatividad Real', 'Tiempo en Falla'],
          datasets: [{
            data: [availVal, parseFloat(downtimeVal)],
            backgroundColor: [
              availVal >= 90 ? '#10b981' : (availVal >= 75 ? '#f59e0b' : '#ef4444'),
              'rgba(239, 68, 68, 0.35)'
            ],
            borderColor: ['#0f172a', '#0f172a'],
            borderWidth: 2,
            hoverOffset: 4
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          circumference: 250,
          rotation: -125,
          cutout: '74%',
          plugins: {
            legend: {
              display: true,
              position: 'bottom',
              labels: {
                color: '#cbd5e1',
                font: { family: chartFont, size: 10, weight: '600' },
                boxWidth: 10,
                padding: 10
              }
            }
          }
        },
        plugins: [centerPlugin]
      });
    }

    // 2. GRÁFICO 2: TOP EQUIPOS CON MAYOR DOWNTIME (Barras Horizontales con Texto de Alto Contraste)
    const downtimeCanvas = document.getElementById('handoverDowntimeBarChart');
    if (downtimeCanvas) {
      const entries = Object.entries(data.equipmentImpactMap).sort((a, b) => b[1] - a[1]).slice(0, 5);
      let labels = entries.map(e => e[0]);
      let values = entries.map(e => e[1]);

      if (labels.length === 0) {
        labels = ['Flota Completa (18 Grúas)'];
        values = [0];
      }

      handoverCharts.downtime = new Chart(downtimeCanvas, {
        type: 'bar',
        data: {
          labels: labels,
          datasets: [{
            label: 'Minutos de Paro',
            data: values,
            backgroundColor: values.map(v => v > 60 ? 'rgba(239, 68, 68, 0.9)' : 'rgba(56, 189, 248, 0.9)'),
            borderColor: values.map(v => v > 60 ? '#ef4444' : '#38bdf8'),
            borderWidth: 1,
            borderRadius: 6
          }]
        },
        options: {
          indexAxis: 'y',
          responsive: true,
          maintainAspectRatio: false,
          scales: {
            x: {
              grid: { color: 'rgba(255, 255, 255, 0.08)' },
              ticks: { color: '#cbd5e1', font: { family: chartFont, size: 10, weight: '600' } }
            },
            y: {
              grid: { display: false },
              ticks: { color: '#f8fafc', font: { family: chartFont, size: 11, weight: '700' } }
            }
          },
          plugins: {
            legend: { display: false },
            tooltip: {
              callbacks: {
                label: function (ctx) {
                  return ` Paro en turno: ${ctx.raw} min`;
                }
              }
            }
          }
        }
      });
    }

    // 3. GRÁFICO 3: CRONOLOGÍA HORARIA REAL DE INCIDENTES (12 HORAS)
    const timelineCanvas = document.getElementById('handoverTimelineChart');
    if (timelineCanvas) {
      const ctx = timelineCanvas.getContext('2d');
      const gradient = ctx.createLinearGradient(0, 0, 0, 180);
      gradient.addColorStop(0, 'rgba(56, 189, 248, 0.5)');
      gradient.addColorStop(1, 'rgba(56, 189, 248, 0.0)');

      handoverCharts.timeline = new Chart(timelineCanvas, {
        type: 'line',
        data: {
          labels: data.timelineLabels,
          datasets: [{
            label: 'Incidentes Activos / Reportados',
            data: data.timelineCounts,
            borderColor: '#38bdf8',
            backgroundColor: gradient,
            fill: true,
            tension: 0.35,
            pointBackgroundColor: '#0284c7',
            pointBorderColor: '#38bdf8',
            pointBorderWidth: 2,
            pointRadius: 4
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          scales: {
            x: {
              grid: { color: 'rgba(255, 255, 255, 0.08)' },
              ticks: { color: '#cbd5e1', font: { family: chartFont, size: 9, weight: '600' } }
            },
            y: {
              beginAtZero: true,
              ticks: { stepSize: 1, color: '#cbd5e1', font: { family: chartFont, size: 10 } },
              grid: { color: 'rgba(255, 255, 255, 0.08)' }
            }
          },
          plugins: {
            legend: { display: false }
          }
        }
      });
    }

    // 4. GRÁFICO 4: DISTRIBUCIÓN POR SUBSISTEMAS INDUSTRIALES
    const subCanvas = document.getElementById('handoverSubsystemChart');
    if (subCanvas) {
      const subEntries = Object.entries(data.subsystemMap).filter(e => e[1] > 0);
      let subLabels = subEntries.map(e => e[0]);
      let subValues = subEntries.map(e => e[1]);

      if (subLabels.length === 0) {
        subLabels = ['Sin incidentes'];
        subValues = [1];
      }

      handoverCharts.subsystems = new Chart(subCanvas, {
        type: 'doughnut',
        data: {
          labels: subLabels,
          datasets: [{
            data: subValues,
            backgroundColor: [
              '#38bdf8', // Cian
              '#34d399', // Esmeralda
              '#a855f7', // Púrpura
              '#f59e0b', // Ámbar
              '#f43f5e', // Rosa/Rojo
              '#64748b'  // Slate
            ],
            borderColor: '#0f172a',
            borderWidth: 2
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          cutout: '60%',
          plugins: {
            legend: {
              display: true,
              position: 'right',
              labels: {
                color: '#cbd5e1',
                font: { family: chartFont, size: 9, weight: '600' },
                boxWidth: 8,
                padding: 6
              }
            }
          }
        }
      });
    }
  }

  // Hash de credenciales administrativas (coherente con admin.js)
  const ADMIN_AUTH_HASH = '<REPLACE_WITH_ADMIN_HASH>';

  async function computeAdminHash(u, p) {
    // window.sha256Hex funciona también sobre http:// en la LAN (crypto.subtle exige contexto
    // seguro https/localhost).
    return await window.sha256Hex(`${(u || '').trim()}:${(p || '').trim()}:operations-monitor-2026-salt`);
  }

  function isAdminAuthenticated() {
    return sessionStorage.getItem('adminAuthenticated') === 'true' ||
           sessionStorage.getItem('adminSessionToken') === ADMIN_AUTH_HASH;
  }

  function promptAdminAuthModal(onSuccess) {
    let authModalEl = document.getElementById('handoverAuthModal');
    if (!authModalEl) {
      authModalEl = document.createElement('div');
      authModalEl.id = 'handoverAuthModal';
      authModalEl.className = 'modal fade';
      authModalEl.tabIndex = -1;
      authModalEl.setAttribute('aria-hidden', 'true');
      document.body.appendChild(authModalEl);
    }

    authModalEl.innerHTML = `
      <div class="modal-dialog modal-dialog-centered" style="max-width: 440px;">
        <div class="modal-content" style="background: #0f172a; border: 1px solid rgba(239, 68, 68, 0.4); border-radius: 20px; color: #fff; box-shadow: 0 25px 60px rgba(0,0,0,0.95);">
          <div class="modal-header border-0 pb-0 pt-4 px-4 d-flex justify-content-between align-items-center">
            <div class="d-flex align-items-center gap-2">
              <span style="background: rgba(239, 68, 68, 0.15); color: #ef4444; width: 40px; height: 40px; border-radius: 12px; display: flex; align-items: center; justify-content: center; font-size: 1.25rem;">
                <i class="bi bi-shield-lock-fill"></i>
              </span>
              <div>
                <h6 class="modal-title fw-bold text-white mb-0">Control de Supervisión</h6>
                <div class="text-muted" style="font-size: 0.72rem;">Entrega Oficial de Guardia SCADA</div>
              </div>
            </div>
            <button type="button" class="btn-close btn-close-white" data-bs-dismiss="modal"></button>
          </div>
          <div class="modal-body px-4 py-3">
            <p class="text-secondary small mb-3">
              Por protocolo de auditoría e integridad de planta, la emisión del cierre de turno está restringida a <b>Supervisores de Turno</b> y <b>Administradores</b>.
            </p>
            <div id="handoverAuthError" class="alert alert-danger py-2 small d-none" style="background: rgba(239, 68, 68, 0.15); border: 1px solid #ef4444; color: #fca5a5;"></div>
            <form id="handoverAuthForm">
              <div class="mb-3">
                <label class="form-label text-white small fw-bold mb-1">Usuario de Supervisor / Admin</label>
                <div class="input-group input-group-sm">
                  <span class="input-group-text bg-dark border-secondary text-secondary"><i class="bi bi-person-fill"></i></span>
                  <input type="text" class="form-control bg-dark text-white border-secondary" id="handoverUser" placeholder="admin" required autofocus autocomplete="username">
                </div>
              </div>
              <div class="mb-3">
                <label class="form-label text-white small fw-bold mb-1">Contraseña</label>
                <div class="input-group input-group-sm">
                  <span class="input-group-text bg-dark border-secondary text-secondary"><i class="bi bi-key-fill"></i></span>
                  <input type="password" class="form-control bg-dark text-white border-secondary" id="handoverPass" placeholder="••••••••" required autocomplete="current-password">
                </div>
              </div>
              <div class="d-grid mt-4">
                <button type="submit" class="btn btn-info fw-bold py-2" id="handoverLoginBtn">
                  <i class="bi bi-unlock-fill me-1"></i> Autorizar y Abrir Reporte
                </button>
              </div>
            </form>
          </div>
        </div>
      </div>
    `;

    const bsModal = new bootstrap.Modal(authModalEl);
    bsModal.show();

    const form = document.getElementById('handoverAuthForm');
    const errBox = document.getElementById('handoverAuthError');
    const btn = document.getElementById('handoverLoginBtn');

    form.onsubmit = async (e) => {
      e.preventDefault();
      errBox.classList.add('d-none');
      btn.disabled = true;
      btn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span> Validando credenciales...';

      const u = document.getElementById('handoverUser').value;
      const p = document.getElementById('handoverPass').value;
      const hash = await computeAdminHash(u, p);

      if (hash === ADMIN_AUTH_HASH) {
        sessionStorage.setItem('adminSessionToken', hash);
        sessionStorage.setItem('adminAuthenticated', 'true');
        sessionStorage.setItem('adminUser', u);
        bsModal.hide();
        setTimeout(() => {
          if (typeof onSuccess === 'function') onSuccess();
        }, 300);
      } else {
        btn.disabled = false;
        btn.innerHTML = '<i class="bi bi-unlock-fill me-1"></i> Autorizar y Abrir Reporte';
        errBox.textContent = 'Credenciales no autorizadas. Solo supervisores o administradores pueden emitir el cierre de turno.';
        errBox.classList.remove('d-none');
      }
    };
  }

  // Apertura del Modal y Renderizado (Protegido por Rol)
  window.openShiftHandoverModal = async function () {
    if (!isAdminAuthenticated()) {
      promptAdminAuthModal(() => {
        window.openShiftHandoverModal();
      });
      return;
    }

    await ensureChartJsLoaded();

    let modalEl = document.getElementById('scadaHandoverModal');
    if (!modalEl) {
      modalEl = document.createElement('div');
      modalEl.id = 'scadaHandoverModal';
      modalEl.className = 'modal fade';
      modalEl.tabIndex = -1;
      modalEl.setAttribute('aria-hidden', 'true');
      document.body.appendChild(modalEl);
    }

    modalEl.innerHTML = `
      <div class="modal-dialog modal-xl modal-dialog-centered">
        <div class="modal-content" style="background: #0b0f19; border: 1px solid rgba(56, 189, 248, 0.3); border-radius: 24px; color: #fff; box-shadow: 0 30px 80px rgba(0,0,0,0.95);">
          <div class="modal-body text-center p-5">
            <div class="spinner-border text-info" style="width: 3.5rem; height: 3.5rem;" role="status"></div>
            <h5 class="fw-bold mt-4 text-white">Generando Reporte Ejecutivo de Turno (12h)</h5>
            <div class="text-muted small">Calculando OEE real, telemetría de grúas y curvas cronológicas...</div>
          </div>
        </div>
      </div>
    `;

    const bsModal = new bootstrap.Modal(modalEl);
    bsModal.show();

    const data = await generateShiftHandoverData();

    modalEl.innerHTML = `
      <div class="modal-dialog modal-xl modal-dialog-centered modal-dialog-scrollable">
        <div class="modal-content" style="background: #0b1120; border: 1px solid rgba(56, 189, 248, 0.25); border-radius: 24px; color: #f8fafc; box-shadow: 0 30px 80px rgba(0,0,0,0.95);">
          
          <!-- ENCABEZADO EJECUTIVO -->
          <div class="modal-header d-flex justify-content-between align-items-center" style="background: linear-gradient(180deg, rgba(30, 41, 59, 0.7) 0%, rgba(15, 23, 42, 0.8) 100%); border-bottom: 1px solid rgba(255,255,255,0.1); padding: 20px 28px;">
            <div class="d-flex align-items-center gap-3">
              <div style="width: 48px; height: 48px; border-radius: 14px; background: rgba(56, 189, 248, 0.15); border: 1px solid rgba(56, 189, 248, 0.4); display: flex; align-items: center; justify-content: center; font-size: 1.6rem; color: #38bdf8;">
                📋
              </div>
              <div>
                <h5 class="modal-title fw-bold m-0 text-white d-flex align-items-center gap-2">
                  Reporte Ejecutivo de Entrega de Guardia
                  <span class="badge" style="background: rgba(56, 189, 248, 0.2); border: 1px solid rgba(56, 189, 248, 0.4); color: #38bdf8; font-size: 0.75rem;">12 HORAS CONTINUO</span>
                </h5>
                <div class="small text-muted mt-1">
                  ${data.dateFormatted} · <b>${data.shift.name}</b> · Generado a las ${data.timeFormatted} (Chihuahua UTC-6)
                </div>
              </div>
            </div>
            <button type="button" class="btn-close btn-close-white" data-bs-dismiss="modal" aria-label="Close"></button>
          </div>

          <!-- CUERPO PRINCIPAL -->
          <div class="modal-body p-4" id="printableHandoverReport" style="background: #0b1120;">
            
            <!-- TARJETAS DE KPIS PRINCIPALES -->
            <div class="row g-3 mb-4">
              <div class="col-6 col-lg-3">
                <div class="p-3 rounded-4 h-100" style="background: rgba(16, 185, 129, 0.08); border: 1px solid rgba(16, 185, 129, 0.3);">
                  <div class="d-flex justify-content-between align-items-center">
                    <span class="text-success small fw-semibold">Disponibilidad Planta</span>
                    <i class="bi bi-shield-check text-success fs-5"></i>
                  </div>
                  <div class="fs-2 fw-bold text-success mt-1">${data.availabilityPct}%</div>
                  <div class="text-muted" style="font-size: 0.72rem;">OEE operativo de la guardia</div>
                </div>
              </div>

              <div class="col-6 col-lg-3">
                <div class="p-3 rounded-4 h-100" style="background: rgba(239, 68, 68, 0.08); border: 1px solid rgba(239, 68, 68, 0.3);">
                  <div class="d-flex justify-content-between align-items-center">
                    <span class="text-danger small fw-semibold">Fallas Abiertas a Entregar</span>
                    <i class="bi bi-exclamation-triangle-fill text-danger fs-5"></i>
                  </div>
                  <div class="fs-2 fw-bold text-danger mt-1">${data.activeFailures.length}</div>
                  <div class="text-muted" style="font-size: 0.72rem;">Recibe la guardia entrante</div>
                </div>
              </div>

              <div class="col-6 col-lg-3">
                <div class="p-3 rounded-4 h-100" style="background: rgba(56, 189, 248, 0.08); border: 1px solid rgba(56, 189, 248, 0.3);">
                  <div class="d-flex justify-content-between align-items-center">
                    <span class="text-info small fw-semibold">Tiempo Muerto en Guardia</span>
                    <i class="bi bi-clock-history text-info fs-5"></i>
                  </div>
                  <div class="fs-2 fw-bold text-info mt-1">${data.totalDowntime}</div>
                  <div class="text-muted" style="font-size: 0.72rem;">${data.totalParos} eventos acumulados</div>
                </div>
              </div>

              <div class="col-6 col-lg-3">
                <div class="p-3 rounded-4 h-100" style="background: rgba(168, 85, 247, 0.08); border: 1px solid rgba(168, 85, 247, 0.3);">
                  <div class="d-flex justify-content-between align-items-center">
                    <span class="small fw-semibold" style="color: #c084fc;">MTTR Promedio</span>
                    <i class="bi bi-tools fs-5" style="color: #c084fc;"></i>
                  </div>
                  <div class="fs-2 fw-bold mt-1" style="color: #c084fc;">${data.mttrFormatted}</div>
                  <div class="text-muted" style="font-size: 0.72rem;">Tiempo medio de reparación</div>
                </div>
              </div>
            </div>

            <!-- ══════ BLOQUE DE GRÁFICOS EJECUTIVOS ══════ -->
            <div class="mb-4">
              <div class="d-flex align-items-center justify-content-between mb-3">
                <h6 class="fw-bold m-0 text-white d-flex align-items-center gap-2">
                  <i class="bi bi-bar-chart-fill text-info"></i> Telemetría y Análisis Gráfico del Turno
                </h6>
                <span class="badge bg-dark border border-secondary text-muted" style="font-size: 0.7rem;">CHART.JS HD</span>
              </div>

              <div class="row g-3">
                <!-- Gráfico 1: Gauge de Disponibilidad -->
                <div class="col-12 col-md-5">
                  <div class="p-3 rounded-4 h-100" style="background: rgba(15, 23, 42, 0.7); border: 1px solid rgba(255,255,255,0.1);">
                    <div class="fw-semibold text-white small mb-2 d-flex justify-content-between">
                      <span>Disponibilidad de Planta</span>
                      <span class="text-success fw-bold">${data.availabilityPct}%</span>
                    </div>
                    <div style="position: relative; height: 210px; width: 100%;">
                      <canvas id="handoverAvailabilityChart"></canvas>
                    </div>
                  </div>
                </div>

                <!-- Gráfico 2: Top Equipos con Mayor Downtime -->
                <div class="col-12 col-md-7">
                  <div class="p-3 rounded-4 h-100" style="background: rgba(15, 23, 42, 0.7); border: 1px solid rgba(255,255,255,0.1);">
                    <div class="fw-semibold text-white small mb-2 d-flex justify-content-between">
                      <span>Top Equipos con Mayor Downtime</span>
                      <span class="text-info small">Minutos de Paro</span>
                    </div>
                    <div style="height: 210px; width: 100%;">
                      <canvas id="handoverDowntimeBarChart"></canvas>
                    </div>
                  </div>
                </div>

                <!-- Gráfico 3: Cronología Horaria de Incidentes -->
                <div class="col-12 col-md-7">
                  <div class="p-3 rounded-4 h-100" style="background: rgba(15, 23, 42, 0.7); border: 1px solid rgba(255,255,255,0.1);">
                    <div class="fw-semibold text-white small mb-2 d-flex justify-content-between">
                      <span>Cronología de Incidentes en 12h</span>
                      <span class="text-muted small">Evolución hora por hora</span>
                    </div>
                    <div style="height: 190px; width: 100%;">
                      <canvas id="handoverTimelineChart"></canvas>
                    </div>
                  </div>
                </div>

                <!-- Gráfico 4: Desglose por Subsistemas -->
                <div class="col-12 col-md-5">
                  <div class="p-3 rounded-4 h-100" style="background: rgba(15, 23, 42, 0.7); border: 1px solid rgba(255,255,255,0.1);">
                    <div class="fw-semibold text-white small mb-2">
                      <span>Distribución por Subsistemas</span>
                    </div>
                    <div style="height: 190px; width: 100%;">
                      <canvas id="handoverSubsystemChart"></canvas>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <!-- SECCIÓN 1: FALLAS ABIERTAS ENTREGADAS A LA GUARDIA ENTRANTE -->
            <div class="mb-4">
              <div class="d-flex align-items-center justify-content-between mb-2">
                <h6 class="fw-bold text-danger m-0 d-flex align-items-center gap-2">
                  <i class="bi bi-exclamation-octagon-fill"></i> 1. Fallas Pendientes que Recibe la Siguiente Guardia (${data.activeFailures.length})
                </h6>
                ${data.activeFailures.length > 0 ? `<span class="badge bg-danger">ATENCIÓN INMEDIATA</span>` : ''}
              </div>

              ${data.activeFailures.length === 0 ? `
                <div class="p-3 rounded-4 text-success small d-flex align-items-center gap-3" style="background: rgba(16, 185, 129, 0.1); border: 1px solid rgba(16, 185, 129, 0.3);">
                  <i class="bi bi-check-circle-fill fs-3 text-success"></i>
                  <div>
                    <div class="fw-bold">Guardia 100% Limpia</div>
                    <div class="text-muted">No se entregan averías abiertas. Toda la flota queda operativa.</div>
                  </div>
                </div>
              ` : `
                <div class="table-responsive rounded-4" style="border: 1px solid rgba(239, 68, 68, 0.25); background: rgba(15, 23, 42, 0.4);">
                  <table class="table table-dark table-sm align-middle m-0" style="background: transparent;">
                    <thead>
                      <tr class="text-muted small" style="border-bottom: 1px solid rgba(255,255,255,0.1);">
                        <th class="ps-3 py-2">Equipo</th>
                        <th>Área</th>
                        <th>Subsistema</th>
                        <th>Diagnóstico Preliminar</th>
                        <th>Tiempo Activa</th>
                        <th class="pe-3">Estado</th>
                      </tr>
                    </thead>
                    <tbody>
                      ${data.activeFailures.map(f => `
                        <tr>
                          <td class="ps-3 fw-bold text-white">${escapeHtml(f.id)} (${f.type})</td>
                          <td><span class="text-light">${escapeHtml(f.area)}</span></td>
                          <td><span class="badge" style="background: rgba(56, 189, 248, 0.15); color: #38bdf8;">${escapeHtml(f.subsystem)}</span></td>
                          <td class="text-warning small">${escapeHtml(f.reason)}</td>
                          <td class="font-monospace text-info small fw-bold">${formatDurationMinutes(f.elapsedSeconds)}</td>
                          <td class="pe-3"><span class="badge bg-danger">ABIERTA</span></td>
                        </tr>
                      `).join('')}
                    </tbody>
                  </table>
                </div>
              `}
            </div>

            <!-- SECCIÓN 2: PAROS RESUELTOS EN EL TURNO -->
            <div class="mb-4">
              <h6 class="fw-bold text-success mb-2 d-flex align-items-center gap-2">
                <i class="bi bi-check-circle-fill"></i> 2. Paros Atendidos y Resueltos en Este Turno (${data.resolvedFailures.length})
              </h6>

              ${data.resolvedFailures.length === 0 ? `
                <div class="p-3 rounded-4 text-muted small" style="background: rgba(255,255,255,0.02); border: 1px solid rgba(255,255,255,0.06);">
                  Sin eventos de mantenimiento correctivo cerrados durante las 12 horas.
                </div>
              ` : `
                <div class="table-responsive rounded-4" style="border: 1px solid rgba(255,255,255,0.08); background: rgba(15, 23, 42, 0.4);">
                  <table class="table table-dark table-sm align-middle m-0" style="background: transparent;">
                    <thead>
                      <tr class="text-muted small" style="border-bottom: 1px solid rgba(255,255,255,0.1);">
                        <th class="ps-3 py-2">Equipo</th>
                        <th>Área</th>
                        <th>Duración</th>
                        <th>Técnico que Atendió</th>
                        <th>Subsistema</th>
                        <th class="pe-3">Causa / Acción Correctiva</th>
                      </tr>
                    </thead>
                    <tbody>
                      ${data.resolvedFailures.map(r => `
                        <tr>
                          <td class="ps-3 fw-bold text-white">${escapeHtml(r.id)}</td>
                          <td><span class="text-light small">${escapeHtml(r.area)}</span></td>
                          <td class="font-monospace text-info small fw-bold">${formatDurationMinutes(r.downtimeSeconds)}</td>
                          <td class="small text-white">${escapeHtml(r.technician)}</td>
                          <td><span class="badge" style="background: rgba(168, 85, 247, 0.15); color: #c084fc;">${escapeHtml(r.subsystem)}</span></td>
                          <td class="pe-3 text-muted small">${escapeHtml(r.reason)}</td>
                        </tr>
                      `).join('')}
                    </tbody>
                  </table>
                </div>
              `}
            </div>

            <!-- SECCIÓN 3: REFACCIONES CONSOLIDADAS -->
            ${data.refactionsSummaryList.length > 0 ? `
              <div class="mb-4">
                <h6 class="fw-bold text-info mb-2 d-flex align-items-center gap-2">
                  <i class="bi bi-box-seam"></i> 3. Refacciones y Materiales Descontados de Almacén (${data.refactionsSummaryList.length})
                </h6>
                <div class="d-flex flex-wrap gap-2 p-3 rounded-4" style="background: rgba(15, 23, 42, 0.4); border: 1px solid rgba(255,255,255,0.08);">
                  ${data.refactionsSummaryList.map(rf => `
                    <div class="badge bg-dark border border-secondary text-white p-2 d-flex align-items-center gap-2">
                      <span class="badge bg-info text-dark fw-bold fs-6">${rf.count}x</span>
                      <span class="fw-bold">${escapeHtml(rf.name)}</span>
                      <span class="text-muted small">(${escapeHtml(rf.channels.join(' · '))})</span>
                    </div>
                  `).join('')}
                </div>
              </div>
            ` : ''}

            <!-- RECUADRO DE FIRMAS -->
            <div class="p-3 rounded-4 mt-4" style="background: rgba(255,255,255,0.02); border: 1px solid rgba(255,255,255,0.08);">
              <div class="row text-center gy-4 pt-2">
                <div class="col-6">
                  <div style="border-top: 1px dashed rgba(255,255,255,0.3); width: 85%; margin: 25px auto 0; padding-top: 8px;">
                    <div class="fw-bold small text-white">Supervisor Saliente (${data.shift.name})</div>
                    <div class="text-muted" style="font-size: 0.7rem;">Firma y Matrícula</div>
                  </div>
                </div>
                <div class="col-6">
                  <div style="border-top: 1px dashed rgba(255,255,255,0.3); width: 85%; margin: 25px auto 0; padding-top: 8px;">
                    <div class="fw-bold small text-white">Supervisor Entrante</div>
                    <div class="text-muted" style="font-size: 0.7rem;">Firma de Aceptación</div>
                  </div>
                </div>
              </div>
            </div>

          </div>

          <!-- FOOTER Y BOTONES -->
          <div class="modal-footer d-flex justify-content-between align-items-center" style="background: rgba(15, 23, 42, 0.8); border-top: 1px solid rgba(255,255,255,0.1); padding: 16px 28px;">
            <div class="small text-muted d-none d-md-block">
              Operations Monitor SCADA Industrial · Protocolo de Entrega de Guardia
            </div>
            <div class="d-flex gap-2 w-100 w-md-auto justify-content-end">
              <button type="button" class="btn btn-outline-info btn-sm d-flex align-items-center gap-2 px-3" onclick="window.copyHandoverToClipboard()">
                <i class="bi bi-whatsapp fs-6"></i> Copiar para WhatsApp
              </button>
              <button type="button" class="btn btn-primary btn-sm px-4 fw-bold d-flex align-items-center gap-2" style="background: #0284c7; border-color: #38bdf8;" onclick="window.printHandoverReport()">
                <i class="bi bi-printer fs-6"></i> Imprimir Reporte / PDF
              </button>
            </div>
          </div>

        </div>
      </div>
    `;

    window._currentHandoverData = data;

    setTimeout(() => {
      renderExecutiveCharts(data);
    }, 120);
  };

  // Copiar resumen en formato WhatsApp profesional
  window.copyHandoverToClipboard = function () {
    const d = window._currentHandoverData;
    if (!d) return;

    let text = `📋 *REPORTE OFICIAL DE ENTREGA DE GUARDIA - OPERATIONS MONITOR*\n`;
    text += `📅 *Fecha:* ${d.dateFormatted}\n`;
    text += `⏰ *Jornada:* ${d.shift.name} · ${d.timeFormatted} (Chihuahua UTC-6)\n`;
    text += `━━━━━━━━━━━━━━━━━━━━━\n`;
    text += `📊 *INDICADORES SCADA DE LA GUARDIA (12H):*\n`;
    text += `• 🟢 *Disponibilidad de Planta:* ${d.availabilityPct}%\n`;
    text += `• ⏱️ *Tiempo Muerto en Guardia:* ${d.totalDowntime}\n`;
    text += `• 🛠️ *Eventos Totales:* ${d.totalParos} (Resueltos: ${d.resolvedFailures.length} | Abiertos: ${d.activeFailures.length})\n`;
    text += `• ⚡ *MTTR Promedio:* ${d.mttrFormatted}\n`;
    text += `━━━━━━━━━━━━━━━━━━━━━\n\n`;

    if (d.activeFailures.length > 0) {
      text += `🚨 *FALLAS PENDIENTES ENTREGADAS AL RELEVO (${d.activeFailures.length}):*\n`;
      d.activeFailures.forEach(f => {
        text += `⚠️ *${f.id}* (${f.type} · ${f.area}) [${f.subsystem}]: ${f.reason} (Activa hace ${formatDurationMinutes(f.elapsedSeconds)})\n`;
      });
      text += `\n`;
    } else {
      text += `✅ *GUARDIA LIMPIA:* No se entregan fallas abiertas; flota 100% en servicio.\n\n`;
    }

    if (d.resolvedFailures.length > 0) {
      text += `🛠️ *PAROS ATENDIDOS EN EL TURNO (${d.resolvedFailures.length}):*\n`;
      d.resolvedFailures.slice(0, 6).forEach(r => {
        text += `• ${r.id} (${formatDurationMinutes(r.downtimeSeconds)}) - ${r.subsystem} | Resp: ${r.technician}\n`;
      });
      if (d.resolvedFailures.length > 6) {
        text += `• ... y ${d.resolvedFailures.length - 6} eventos más en el registro web.\n`;
      }
      text += `\n`;
    }

    if (d.refactionsSummaryList.length > 0) {
      text += `📦 *REFACCIONES DESCONTADAS DE ALMACÉN:*\n`;
      d.refactionsSummaryList.forEach(rf => {
        text += `• ${rf.count}x ${rf.name} (${rf.channels.join(', ')})\n`;
      });
    }

    navigator.clipboard.writeText(text).then(() => {
      alert('¡Reporte de Entrega de Guardia copiado al portapapeles! Listo para enviar a WhatsApp o Telegram.');
    }).catch(() => {
      prompt('Copia manualmente este reporte:', text);
    });
  };

  // Impresión y exportación limpia a PDF con gráficos en alta definición
  window.printHandoverReport = function () {
    const d = window._currentHandoverData;
    if (!d) return;

    // Convertir gráficos a Base64
    const chart1Img = handoverCharts.availability ? handoverCharts.availability.toBase64Image('image/png', 1) : '';
    const chart2Img = handoverCharts.downtime ? handoverCharts.downtime.toBase64Image('image/png', 1) : '';
    const chart3Img = handoverCharts.timeline ? handoverCharts.timeline.toBase64Image('image/png', 1) : '';
    const chart4Img = handoverCharts.subsystems ? handoverCharts.subsystems.toBase64Image('image/png', 1) : '';

    const win = window.open('', '_blank');
    win.document.write(`
      <!DOCTYPE html>
      <html lang="es">
        <head>
          <meta charset="utf-8">
          <title>Reporte_Oficial_Entrega_Guardia_${d.shift.name.replace(/\\s+/g, '_')}_${d.dateFormatted.replace(/\\s+/g, '_')}</title>
          <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet">
          <style>
            @page { size: A4 portrait; margin: 10mm; }
            body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; color: #0f172a; background: #fff; padding: 10px; }
            .report-card { border: 1px solid #cbd5e1; border-radius: 8px; padding: 10px; margin-bottom: 10px; background: #f8fafc; }
            .kpi-box { border: 1px solid #cbd5e1; border-radius: 8px; padding: 8px; text-align: center; background: #fff; }
            .kpi-val { font-size: 18px; font-weight: 800; }
            table { width: 100%; border-collapse: collapse; font-size: 11px; margin-top: 6px; }
            th { background: #e2e8f0; border-bottom: 2px solid #475569; padding: 6px 8px; text-align: left; font-weight: 700; color: #1e293b; }
            td { border-bottom: 1px solid #e2e8f0; padding: 5px 8px; }
            .badge-sub { background: #e0f2fe; color: #0369a1; padding: 2px 6px; border-radius: 4px; font-weight: 700; font-size: 9px; }
            .dark-chart-container { background: #0b1120; border-radius: 8px; padding: 8px; text-align: center; border: 1px solid #1e293b; height: 100%; }
            .dark-chart-title { color: #94a3b8; font-size: 10px; font-weight: 700; margin-bottom: 4px; text-transform: uppercase; }
            .chart-img { max-width: 100%; height: auto; display: block; margin: 0 auto; }
            @media print { .no-print { display: none; } }
          </style>
        </head>
        <body>
          <div class="d-flex justify-content-between align-items-center mb-2 pb-2 border-bottom border-2 border-dark">
            <div>
              <h3 class="fw-bold mb-0 text-dark">OPERATIONS MONITOR SCADA INDUSTRIAL</h3>
              <div class="text-muted small">Reporte Ejecutivo Oficial de Entrega de Guardia (12 Horas Continuo)</div>
            </div>
            <div class="text-end">
              <div class="fw-bold">${d.dateFormatted}</div>
              <div class="badge bg-dark text-white px-3 py-1 fs-6">${d.shift.name}</div>
              <div class="small text-muted mt-1">Generado: ${d.timeFormatted} (UTC-6)</div>
            </div>
          </div>

          <!-- TABLA DE KPIS COHERENTES -->
          <div class="row g-2 mb-2">
            <div class="col-3">
              <div class="kpi-box">
                <div class="small text-muted fw-bold">Disponibilidad Planta</div>
                <div class="kpi-val" style="color: ${parseFloat(d.availabilityPct) >= 90 ? '#16a34a' : (parseFloat(d.availabilityPct) >= 75 ? '#d97706' : '#dc2626')};">${d.availabilityPct}%</div>
              </div>
            </div>
            <div class="col-3">
              <div class="kpi-box">
                <div class="small text-muted fw-bold">Fallas Abiertas</div>
                <div class="kpi-val text-danger">${d.activeFailures.length}</div>
              </div>
            </div>
            <div class="col-3">
              <div class="kpi-box">
                <div class="small text-muted fw-bold">Tiempo Muerto en Turno</div>
                <div class="kpi-val text-primary">${d.totalDowntime}</div>
              </div>
            </div>
            <div class="col-3">
              <div class="kpi-box">
                <div class="small text-muted fw-bold">MTTR Promedio</div>
                <div class="kpi-val text-dark">${d.mttrFormatted}</div>
              </div>
            </div>
          </div>

          <!-- GRÁFICOS EJECUTIVOS EN ALTA RESOLUCIÓN Y MÁXIMO CONTRASTE -->
          <div class="report-card">
            <div class="fw-bold text-dark small mb-2 border-bottom pb-1">ANÁLISIS GRÁFICO DE TELEMETRÍA DE TURNO</div>
            <div class="row g-2 align-items-center">
              <div class="col-6">
                <div class="dark-chart-container">
                  <div class="dark-chart-title">Disponibilidad de Planta</div>
                  ${chart1Img ? `<img src="${chart1Img}" class="chart-img" style="max-height: 145px;" />` : ''}
                </div>
              </div>
              <div class="col-6">
                <div class="dark-chart-container">
                  <div class="dark-chart-title">Top Equipos con Mayor Downtime (min)</div>
                  ${chart2Img ? `<img src="${chart2Img}" class="chart-img" style="max-height: 145px;" />` : ''}
                </div>
              </div>
              <div class="col-7 mt-2">
                <div class="dark-chart-container">
                  <div class="dark-chart-title">Cronología de Incidentes en 12h</div>
                  ${chart3Img ? `<img src="${chart3Img}" class="chart-img" style="max-height: 125px;" />` : ''}
                </div>
              </div>
              <div class="col-5 mt-2">
                <div class="dark-chart-container">
                  <div class="dark-chart-title">Distribución por Subsistemas</div>
                  ${chart4Img ? `<img src="${chart4Img}" class="chart-img" style="max-height: 125px;" />` : ''}
                </div>
              </div>
            </div>
          </div>

          <!-- TABLA DE FALLAS ABIERTAS CON TIEMPO REAL -->
          <div class="report-card">
            <div class="fw-bold text-danger small mb-1 border-bottom pb-1">1. FALLAS PENDIENTES ENTREGADAS AL TURNO ENTRANTE (${d.activeFailures.length})</div>
            ${d.activeFailures.length === 0 ? `
              <div class="text-success small py-1">✓ Guardia limpia. No se entregan averías abiertas; todos los equipos están operativos.</div>
            ` : `
              <table>
                <thead>
                  <tr>
                    <th>Equipo</th>
                    <th>Área</th>
                    <th>Subsistema</th>
                    <th>Diagnóstico Preliminar</th>
                    <th>Tiempo Activa</th>
                    <th>Estado</th>
                  </tr>
                </thead>
                <tbody>
                  ${d.activeFailures.map(f => `
                    <tr>
                      <td class="fw-bold">${escapeHtml(f.id)} (${f.type})</td>
                      <td>${escapeHtml(f.area)}</td>
                      <td><span class="badge-sub">${escapeHtml(f.subsystem)}</span></td>
                      <td>${escapeHtml(f.reason)}</td>
                      <td class="fw-bold text-danger">${formatDurationMinutes(f.elapsedSeconds)}</td>
                      <td class="text-danger fw-bold">ABIERTA</td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>
            `}
          </div>

          <!-- TABLA DE PAROS RESUELTOS -->
          <div class="report-card">
            <div class="fw-bold text-success small mb-1 border-bottom pb-1">2. PAROS ATENDIDOS Y RESUELTOS EN ESTE TURNO (${d.resolvedFailures.length})</div>
            ${d.resolvedFailures.length === 0 ? `
              <div class="text-muted small py-1">Sin averías resueltas en este turno.</div>
            ` : `
              <table>
                <thead>
                  <tr>
                    <th>Equipo</th>
                    <th>Área</th>
                    <th>Duración Paro</th>
                    <th>Técnico que Atendió</th>
                    <th>Subsistema</th>
                    <th>Causa / Acción Correctiva</th>
                  </tr>
                </thead>
                <tbody>
                  ${d.resolvedFailures.slice(0, 10).map(r => `
                    <tr>
                      <td class="fw-bold">${escapeHtml(r.id)}</td>
                      <td>${escapeHtml(r.area)}</td>
                      <td class="fw-bold">${formatDurationMinutes(r.downtimeSeconds)}</td>
                      <td>${escapeHtml(r.technician)}</td>
                      <td><span class="badge-sub">${escapeHtml(r.subsystem)}</span></td>
                      <td>${escapeHtml(r.reason)}</td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>
            `}
          </div>

          <!-- REFACCIONES CONSOLIDADAS -->
          ${d.refactionsSummaryList.length > 0 ? `
            <div class="report-card">
              <div class="fw-bold text-primary small mb-1 border-bottom pb-1">3. REFACCIONES Y MATERIALES UTILIZADOS (${d.refactionsSummaryList.length})</div>
              <div class="d-flex flex-wrap gap-2 pt-1">
                ${d.refactionsSummaryList.map(rf => `
                  <div style="background: #e2e8f0; padding: 4px 10px; border-radius: 6px; font-size: 10px; border: 1px solid #cbd5e1;">
                    <b style="color: #0284c7;">${rf.count}x</b> <b>${escapeHtml(rf.name)}</b> <span class="text-muted">(${escapeHtml(rf.channels.join(' · '))})</span>
                  </div>
                `).join('')}
              </div>
            </div>
          ` : ''}

          <!-- SECCIÓN DE FIRMAS -->
          <div class="row mt-4 pt-3 text-center">
            <div class="col-6">
              <div style="border-top: 1px solid #334155; width: 80%; margin: 0 auto; padding-top: 6px;">
                <b class="small">Supervisor Saliente (${d.shift.name})</b>
                <div class="text-muted" style="font-size: 9px;">Firma y Matrícula</div>
              </div>
            </div>
            <div class="col-6">
              <div style="border-top: 1px solid #334155; width: 80%; margin: 0 auto; padding-top: 6px;">
                <b class="small">Supervisor Entrante</b>
                <div class="text-muted" style="font-size: 9px;">Firma de Conformidad</div>
              </div>
            </div>
          </div>

          <div class="text-center mt-3 text-muted" style="font-size: 8px;">
            Documento generado automáticamente por SCADA Operations Monitor · Sistema de Gestión de Operaciones
          </div>

          <script>
            window.onload = function() {
              setTimeout(function() { window.print(); }, 400);
            };
          </script>
        </body>
      </html>
    `);
    win.document.close();
  };

  function escapeHtml(str) {
    if (!str) return '';
    return String(str).replace(/[&<>"']/g, m => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[m]));
  }

})();

// 🛡️ HELPER DE SEGURIDAD DOM SEGURO (Elimina DOM XSS y reemplaza DOM)
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

// === FUNCIÓN PARA ZONA HORARIA CHIHUAHUA VÍA API ===
let chihuahuaTimeCache = null;
let lastApiCall = 0;
const CACHE_DURATION = 60000; // 1 minuto de caché

window.getChihuahuaTime = function() {
    // UTC-6: restar 6 horas al tiempo UTC
    const now = new Date();
    return new Date(now.getTime() - (6 * 60 * 60 * 1000));
};

window.getChihuahuaDateString = function(date = null) {
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
        const targetDate = window.getChihuahuaTime();
        const year = targetDate.getUTCFullYear();
        const month = String(targetDate.getUTCMonth() + 1).padStart(2, '0');
        const day = String(targetDate.getUTCDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    }
};

// Definición de jornadas (GLOBAL) - Todas de 12 horas
window.SHIFTS = {
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

// Función para obtener la jornada actual (GLOBAL)
window.getCurrentShift = function() {
  // getChihuahuaTime() devuelve el instante desplazado -6h, así que los getters UTC de ese
  // objeto son exactamente el día y la hora de Chihuahua, sin depender de la zona horaria
  // del dispositivo (un teléfono en otra zona reportaba la jornada equivocada).
  const now = window.getChihuahuaTime();
  const day = now.getUTCDay(); // 0-6 (Domingo-Sábado)
  const hour = now.getUTCHours();

  // console.log(`🔍 getCurrentShift - Fecha actual: ${now.toISOString()}, Día: ${day}, Hora: ${hour}`);

  // Lógica simplificada: determinar jornada basada en día y hora
  if (hour >= 6 && hour < 18) {
    // Turnos diurnos (6 AM - 6 PM)
    if ([0, 1, 2].includes(day)) {
      return window.SHIFTS.A;
    } else {
      return window.SHIFTS.B;
    }
  } else {
    // Turnos nocturnos (6 PM - 6 AM)
    if (day === 0 && hour < 6) {
      // Domingo temprano (antes de 6 AM) pertenece a la jornada D
      // Jornada D detectada
      return window.SHIFTS.D;
    } else if ([0, 1, 2].includes(day)) {
      // Jornada C detectada
      return window.SHIFTS.C;
    } else {
      // Jornada D detectada
      return window.SHIFTS.D;
    }
  }
};

// Función para obtener el rango de tiempo de la jornada actual (GLOBAL)
window.getCurrentShiftTimeRange = function() {
  const currentShift = window.getCurrentShift();
  const now = window.getChihuahuaTime();

  // getChihuahuaTime() es el instante desplazado -6h: sus getters UTC son el reloj de
  // Chihuahua. Construir el rango con getters/setters UTC mantiene el instante correcto
  // cuando el equipo no está en zona UTC-6.
  const start = new Date(now);
  start.setUTCHours(currentShift.startHour, 0, 0, 0);

  const end = new Date(now);

  // Para turnos nocturnos, el fin es al día siguiente
  if (currentShift.startHour >= 18) {
    end.setUTCDate(end.getUTCDate() + 1);
  }
  end.setUTCHours(currentShift.endHour, 0, 0, 0);

  return { start, end };
};

// Función para obtener la jornada de una fecha específica (GLOBAL)
window.getShiftForDate = function(date) {
  const targetDate = new Date(new Date(date).getTime() - 6 * 3600 * 1000); // Chihuahua (UTC-6), getters UTC
  const targetDay = targetDate.getUTCDay(); // 0-6 (Domingo-Sábado)
  const targetHour = targetDate.getUTCHours();

  // Lógica simplificada: determinar jornada basada en día y hora
  if (targetHour >= 6 && targetHour < 18) {
    // Turnos diurnos (6 AM - 6 PM)
    if ([0, 1, 2].includes(targetDay)) {
      return window.SHIFTS.A;
    } else {
      return window.SHIFTS.B;
    }
  } else {
    // Turnos nocturnos (6 PM - 6 AM)
    if (targetDay === 0 && targetHour < 6) {
      // Domingo temprano (antes de 6 AM) pertenece a la jornada D
      return window.SHIFTS.D;
    } else if ([0, 1, 2].includes(targetDay)) {
      return window.SHIFTS.C;
    } else {
      return window.SHIFTS.D;
    }
  }
};

// Función específica para AnalisisDetallado.html que maneja filtros de jornada (GLOBAL)
window.getShiftTimeRangeForAnalysis = function(jornada = 'actual') {
  const now = window.getChihuahuaTime();
  let shift;
  
  if (jornada === 'actual') {
    shift = window.getCurrentShift();
  } else if (["A","B","C","D"].includes(jornada)) {
    shift = window.SHIFTS[jornada];
        } else {
    // Para 'todas' o cualquier otro valor, usar rango completo
    return { 
      start: new Date(2000, 0, 1), 
      end: new Date(2100, 0, 1) 
    };
  }
  
  let start = new Date(now);
  let end = new Date(now);
  
  start.setUTCHours(shift.startHour, 0, 0, 0);
  
  // Si es turno nocturno y estamos después de medianoche
  if (shift.startHour > shift.endHour && now.getUTCHours() < 12) {
    // Para jornadas nocturnas, calcular cuántos días retroceder
    const daysToSubtract = shift.name === 'Jornada D' ? 4 : 1; // Jornada D dura 4 días
    start.setUTCDate(start.getUTCDate() - daysToSubtract);
  }
  
  // Para turnos nocturnos, el fin es al día siguiente
  if (shift.startHour > shift.endHour) {
    end.setUTCDate(end.getUTCDate() + 1);
  }
  end.setUTCHours(shift.endHour, 0, 0, 0);
  
  return { start, end };
};

// Función de prueba para verificar fechas y jornadas
window.debugDateTime = function() {
    const now = new Date();
    const chihuahuaTime = window.getChihuahuaTime();
    const currentShift = window.getCurrentShift();
    const dateStr = window.getChihuahuaDateString();
    
    // Fechas y jornadas procesadas
    console.log('Fecha local:', now.toISOString());
    console.log('Fecha Chihuahua:', chihuahuaTime.toISOString());
    console.log('Fecha string:', dateStr);
    console.log('Jornada actual:', currentShift.name);
    console.log('Colección esperada:', `crane_history_${dateStr}_${currentShift.name.replace(' ', '')}`);
    
    return {
        localDate: now.toISOString(),
        chihuahuaDate: chihuahuaTime.toISOString(),
        dateString: dateStr,
        currentShift: currentShift.name,
        expectedCollection: `crane_history_${dateStr}_${currentShift.name.replace(' ', '')}`
    };
};

// Función para buscar registros de grúa en todas las fechas posibles
window.searchCraneHistoryEverywhere = async function(craneId) {
    console.log(`🔍 BUSCANDO HISTORIAL DE GRÚA ${craneId} EN TODAS LAS FECHAS POSIBLES...`);
    
    const db = firebase.firestore();
    const results = [];
    
    // Buscar en los últimos 7 días usando fecha de Chihuahua
    const today = window.getChihuahuaTime();
    for (let i = 0; i < 7; i++) {
        const date = new Date(today);
        date.setDate(today.getDate() - i);
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        const dateStr = `${year}-${month}-${day}`;
        
        // Buscar en todas las jornadas de esta fecha
        for (const shiftKey of ['A', 'B', 'C', 'D']) {
            const shift = window.SHIFTS[shiftKey];
            const collectionName = `crane_history_${dateStr}_${shift.name.replace(' ', '')}`;
            
            try {
                const snapshot = await db.collection(collectionName)
                    .where('craneId', '==', craneId)
                    .get();
                
                if (!snapshot.empty) {
                    console.log(`✅ ENCONTRADOS ${snapshot.size} registros en ${collectionName}`);
                    snapshot.forEach(doc => {
                        const data = doc.data();
                        results.push({
                            collection: collectionName,
                            data: data,
                            id: doc.id
                        });
                    });
                } else {
                    console.log(`❌ 0 registros en ${collectionName}`);
                }
    } catch (error) {
                console.log(`⚠️ Error en ${collectionName}:`, error.message);
            }
        }
    }
    
    console.log(`📊 TOTAL DE REGISTROS ENCONTRADOS: ${results.length}`);
    return results;
};

// Función de prueba para verificar jornadas (GLOBAL)
window.testShiftLogic = function(dateString = null) {
  const testDate = dateString ? new Date(dateString) : window.getChihuahuaTime();
  const day = testDate.getDay();
  const hour = testDate.getHours();
  const dayNames = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
  
  console.log(`🧪 PRUEBA DE LÓGICA DE JORNADAS`);
  console.log(`📅 Fecha: ${testDate.toISOString()}`);
  console.log(`📅 Día: ${dayNames[day]} (${day})`);
  console.log(`⏰ Hora: ${hour}:00`);
  
  // Lógica simplificada: determinar jornada basada en día y hora
  let shift;
  if (hour >= 6 && hour < 18) {
    // Turnos diurnos (6 AM - 6 PM)
    if ([0, 1, 2].includes(day)) {
      shift = window.SHIFTS.A;
    } else {
      shift = window.SHIFTS.B;
            }
        } else {
    // Turnos nocturnos (6 PM - 6 AM)
    if (day === 0 && hour < 6) {
      // Domingo temprano (antes de 6 AM) pertenece a la jornada D
      shift = window.SHIFTS.D;
    } else if ([0, 1, 2].includes(day)) {
      shift = window.SHIFTS.C;
    } else {
      shift = window.SHIFTS.D;
    }
  }
  
  console.log(`🎯 Jornada detectada: ${shift.name}`);
  console.log(`📝 Descripción: ${shift.description}`);
  console.log(`⏰ Horario: ${shift.startHour}:00 - ${shift.endHour}:00 (${shift.isNightShift ? 'Nocturno' : 'Diurno'})`);
  console.log(`📅 Días: ${shift.days.map(d => dayNames[d]).join(', ')}`);
  console.log(`⏱️ Duración: 12 horas por día`);
  
  return shift;
};

document.addEventListener('DOMContentLoaded', () => {
  // Referencias a elementos del DOM
  const operationsGrid = document.getElementById('operations-grid');
  const statusFilter = document.getElementById('status-filter');
  const areaFilter = document.getElementById('area-filter');
  const viewGridBtn = document.getElementById('view-grid');
  const viewListBtn = document.getElementById('view-list');
  const activeFailuresCount = document.getElementById('active-failures');
  const avgResolutionTime = document.getElementById('avg-resolution-time');
  const resolvedTodayCount = document.getElementById('resolved-today');
  const cranesGrid = document.getElementById('cranes-grid') || document.getElementById('cranesContainer');
  
  // Estado global
  let operations = new Map();
  let cranes = new Map();

  // === PUENTE DE ESTADO PARA ANDÓN TV v2 ===
  // Antes window.__global__ nunca existía: el HUD del Andón mostraba métricas en 0.
  function publishAndonState() {
    try {
      window.__global__ = {
        version: 'andon-bridge-2.0',
        shift: (typeof window.getCurrentShift === 'function') ? window.getCurrentShift() : null,
        operations: Array.from(operations.values()),
        cranes: Array.from(cranes.values()),
        stats: window._dashboardStatsLive || null,
        config: (OPERATIONS_CONFIG && typeof OPERATIONS_CONFIG === 'object') ? {
          order: ['area5', 'area35plus', 'area10', 'area20', 'area30'],
          groups: OPERATIONS_CONFIG,
        } : null,
        updatedAt: Date.now(),
      };
      window.dispatchEvent(new CustomEvent('andonstate', { detail: window.__global__ }));
    } catch (e) { /* el puente nunca bloquea el render */ }
  }

  let currentView = 'grid';
  let currentFilters = {
      status: 'all',
      area: 'all',
      craneStatus: 'all',
      craneArea: 'all'
  };

  // Configuración de grúas por área
  let CRANES_CONFIG = {
      area10: ['10A', '10B', '10C', '10D'],
      area20: ['20A', '20B', '20C', '20D', '20E', '20F'],
      area30: ['30A', '30B', '30C', '30D']
  };

  // Configuración de operaciones cargada dinámicamente desde Firestore (config/operations_config)
  let OPERATIONS_CONFIG = {
      _order: ['area5', 'area10', 'area20', 'area30', 'area35plus'],
      area5: ['5'],
      area10: ['10.01', '10.02', '10.03', '10.04', '10.05', '10.06', '10.07', '10.08', '10.09', '10.10'],
      area20: ['20.01', '20.02', '20.03', '20.04', '20.05', '20.06', '20.07', '20.08', '20.09', '20.10', '20.11', '20.12', '20.13'],
      area30: ['30.01', '30.02', '30.03', '30.04', '30.05', '30.06', '30.07', '30.08', '30.09', '30.10'],
      area35plus: ['35', '40', '50', '65', '70']
  };

  // Usar la referencia global a Firestore definida en scada-config.js
  const db = firebase.firestore();
  


  // Inicializa operaciones leyendo dinámicamente de config/operations_config en Firestore
  async function initializeDefaultOperations() {
      try {
          // Cargar configuración de operaciones desde Firestore
          const configDoc = await db.collection('config').doc('operations_config').get();
          if (configDoc.exists) {
              OPERATIONS_CONFIG = configDoc.data();
              console.log('✅ OPERATIONS_CONFIG cargada desde Firestore:', Object.keys(OPERATIONS_CONFIG));
          } else {
              console.warn('⚠️ config/operations_config no encontrada, usando valores por defecto');
          }
      } catch (err) {
          console.warn('⚠️ Error cargando operations_config, usando valores por defecto:', err.message);
      }

      // Obtener todas las fallas activas de Firestore
      let activeFailures = new Map();
      try {
          const activeFailuresSnapshot = await db.collection('operations')
              .where('status', '==', 'active')
              .get();
          activeFailuresSnapshot.forEach(doc => {
              const data = doc.data();
              activeFailures.set(data.operationId || data.id, data);
          });
      } catch (err) {
          console.warn('⚠️ Error cargando fallas activas:', err.message);
      }

      // Construir la lista plana de IDs desde OPERATIONS_CONFIG
      const allOpIds = Object.keys(OPERATIONS_CONFIG)
          .filter(k => k !== '_order' && Array.isArray(OPERATIONS_CONFIG[k]))
          .flatMap(areaKey => OPERATIONS_CONFIG[areaKey]);

      // Inicializar el Map de operaciones
      allOpIds.forEach(opId => {
          const activeFailure = activeFailures.get(opId);
          if (activeFailure) {
              let timestamp;
              if (activeFailure.timestamp && typeof activeFailure.timestamp.toDate === 'function') {
                  timestamp = activeFailure.timestamp.toDate();
              } else if (typeof activeFailure.timestamp === 'string') {
                  timestamp = new Date(activeFailure.timestamp);
              } else {
                  timestamp = new Date();
              }
              console.log('🔧 Inicializando operación activa:', opId);
              operations.set(opId, {
                  id: opId,
                  status: 'active',
                  description: activeFailure.description || 'En falla',
                  timestamp: timestamp,
                  createdAt: activeFailure.createdAt,
                  reportedBy: activeFailure.reportedBy || 'Sistema',
                  assignedTo: activeFailure.assignedTo || getTechnicianNumber(opId)
              });
          } else {
              operations.set(opId, {
                  id: opId,
                  status: 'operational',
                  description: 'Operativa',
                  timestamp: new Date(),
                  reportedBy: 'Sistema',
                  assignedTo: getTechnicianNumber(opId)
              });
          }
      });

      renderOperations();
      updateStatistics();

      // Suscribirse a cambios futuros en operations_config para actualizar en tiempo real
      db.collection('config').doc('operations_config').onSnapshot(doc => {
          if (doc.exists) {
              OPERATIONS_CONFIG = doc.data();
              console.log('🔄 OPERATIONS_CONFIG actualizada dinámicamente en app.js');
              renderOperations();
          }
      }, err => {
          console.warn('Error en suscripción operations_config:', err.message);
      });
  }
  
  function getAreaFromOperationId(opId) {
      if (!opId) return '0';
      const str = String(opId).trim();
      const match = str.match(/^(\d+)/);
      if (!match) return str.split('.')[0] || '0';
      const mainOp = parseInt(match[1], 10);
      if (isNaN(mainOp)) return '0';
      if (mainOp >= 35) return '35';
      return mainOp.toString();
  }
  
  function getTechnicianNumber(operationId) {
      if (!operationId) return 'TECH_DEFAULT';
      const str = String(operationId).trim();
      const mainOp = parseInt(str, 10);
      const subOp = str.includes('.') ? parseInt(str.split('.')[1], 10) : 0;
      
      if (mainOp === 5 || (mainOp === 10 && subOp >= 1 && subOp <= 10)) {
          return 'TECH_5_10';
      }
      if (mainOp === 20 && subOp >= 1 && subOp <= 13) {
          return 'TECH_20';
      }
      if (mainOp === 30 && subOp >= 1 && subOp <= 10) {
          return 'TECH_30';
      }
      if (mainOp === 35 || mainOp === 40 || mainOp === 50 || mainOp === 65 || mainOp === 70) {
          return 'TECH_35_MULTI';
      }
      return 'TECH_DEFAULT';
  }
  

  
  async function updateStatistics() {
      try {
          if (typeof globalConfigManager !== 'undefined' && !globalConfigManager.initialized) {
              await globalConfigManager.init();
          }

          // Actualizando estadísticas
            // Obtener la fecha de inicio de hoy (00:00:00) en zona horaria Chihuahua
            const today = window.getChihuahuaTime();
          today.setHours(0, 0, 0, 0);

            // Obtener la fecha de fin de hoy (23:59:59) en zona horaria Chihuahua
            const endOfDay = window.getChihuahuaTime();
          endOfDay.setHours(23, 59, 59, 999);

          // Fechas para consultas calculadas

          // Consultar fallas activas de operaciones
          const activeOpSnapshot = await db.collection('operations')
              .where('status', '==', 'active')
              .get();
          
          // Consultar fallas activas de grúas
          const activeCraneSnapshot = await db.collection('cranes')
              .where('status', '==', 'active')
              .get();
              
          // Consultar fallas resueltas de operaciones hoy
          const resolvedOpSnapshot = await db.collection('operations_history')
              .where('status', '==', 'resolved')
              .where('resolvedAt', '>=', firebase.firestore.Timestamp.fromDate(today))
              .get();
          
          // Calcular tiempo de resolución para operaciones resueltas hoy
          let resolvedOpTime = 0;
          let resolvedOpCount = 0;
          resolvedOpSnapshot.forEach(doc => {
              const data = doc.data();
              const startTime = getFailureStartDate(data);
              const endTime = parseFirestoreDate(data.resolvedAt);
              if (startTime && endTime) {
                  resolvedOpTime += (endTime - startTime) / 1000;
                  resolvedOpCount++;
              }
          });

          const activeOpStarts = [];
          activeOpSnapshot.forEach(doc => {
              const startTime = getFailureStartDate(doc.data());
              if (startTime) activeOpStarts.push(startTime.getTime());
          });

          // Consultar fallas resueltas de grúas hoy - buscar en todas las jornadas
          let resolvedCraneTodayCount = 0;
          let resolvedCraneTime = 0;
          let resolvedCraneCount = 0;
          const currentShift = window.getCurrentShift();
          const dateStr = window.getChihuahuaDateString();
          
          // Buscar en todas las jornadas del día actual
          for (const shiftKey of ['A', 'B', 'C', 'D']) {
            const shift = window.SHIFTS[shiftKey];
            const collectionName = `crane_history_${dateStr}_${shift.name.replace(' ', '')}`;
            try {
              const snapshot = await db.collection(collectionName).get();
              resolvedCraneTodayCount += snapshot.size;
              snapshot.forEach(doc => {
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
          activeCraneSnapshot.forEach(doc => {
              const startTime = getFailureStartDate(doc.data());
              if (startTime) activeCraneStarts.push(startTime.getTime());
          });

          window._dashboardStatsLive = {
              resolvedOpTime,
              resolvedOpCount,
              resolvedCraneTime,
              resolvedCraneCount,
              activeOpStarts,
              activeCraneStarts
          };

          publishAndonState();

          const avgTime = refreshAvgResolutionDisplay();

          // Actualizar la UI - página principal
          const activeFailuresElement = document.getElementById('active-failures');
          const avgResolutionTimeElement = document.getElementById('avg-resolution-time');
          const resolvedTodayElement = document.getElementById('resolved-today');

          if (activeFailuresElement) {
              activeFailuresElement.textContent = typeof window.formatModuleStat === 'function'
                  ? window.formatModuleStat(activeOpSnapshot.size, activeCraneSnapshot.size)
                  : String(activeOpSnapshot.size + activeCraneSnapshot.size);
          }
          if (avgResolutionTimeElement) {
              avgResolutionTimeElement.textContent = formatTime(avgTime);
          }
          if (resolvedTodayElement) {
              resolvedTodayElement.textContent = typeof window.formatModuleStat === 'function'
                  ? window.formatModuleStat(resolvedOpSnapshot.size, resolvedCraneTodayCount)
                  : String(resolvedOpSnapshot.size + resolvedCraneTodayCount);
          }

          if (activeFailuresElement && avgResolutionTimeElement && resolvedTodayElement) {
              try {
                  sessionStorage.setItem('cached_dashboard_stats', JSON.stringify({
                      failures: activeFailuresElement.textContent,
                      avg: avgResolutionTimeElement.textContent,
                      resolved: resolvedTodayElement.textContent
                  }));
              } catch(e) {}
          }

          // Métricas OEE de Disponibilidad y Cumplimiento de SLA (<5m)
          const totalFailuresNow = activeOpSnapshot.size + activeCraneSnapshot.size;
          const totalEquipmentEstimate = 50; // Operaciones + Grúas activas en planta
          const oeePct = Math.max(0, Math.min(100, Math.round(((totalEquipmentEstimate - totalFailuresNow) / totalEquipmentEstimate) * 100)));

          const plantOeeEl = document.getElementById('plant-oee-pct');
          if (plantOeeEl) plantOeeEl.textContent = `${oeePct}%`;

          const heroOeeEl = document.getElementById('plant-hero-oee');
          if (heroOeeEl) heroOeeEl.textContent = `${oeePct}%`;

          const slaRateEl = document.getElementById('sla-compliance-rate');
          if (slaRateEl) {
              const slaPct = avgTime <= 300 ? 100 : Math.max(70, Math.round((300 / Math.max(1, avgTime)) * 100));
              slaRateEl.textContent = `${slaPct}%`;
          }

          const heroActiveEl = document.getElementById('plant-hero-active');
          if (heroActiveEl) heroActiveEl.textContent = totalFailuresNow;

          if (typeof updateShiftTelemetryDisplay === 'function') {
              updateShiftTelemetryDisplay();
          }

          // Actualizar la UI - página de grúas
          const activeCranesElement = document.getElementById('active-cranes');
          const avgCraneResolutionTimeElement = document.getElementById('avg-crane-resolution-time');
          const resolvedCranesTodayElement = document.getElementById('resolved-cranes-today');

          if (activeCranesElement) {
              activeCranesElement.textContent = activeCraneSnapshot.size;
          }
          if (avgCraneResolutionTimeElement) {
              const avgCraneTime = refreshAvgResolutionDisplay(true);
              avgCraneResolutionTimeElement.textContent = formatTime(avgCraneTime);
          }
          if (resolvedCranesTodayElement) {
              resolvedCranesTodayElement.textContent = resolvedCraneTodayCount;
          }

      } catch (error) {
          console.error('Error actualizando estadísticas:', error);
      }
  }

  window.updateDashboardStatistics = updateStatistics;
  document.addEventListener('globalConfigReady', () => updateStatistics());
  document.addEventListener('globalConfigUpdated', () => updateStatistics());

  function refreshAvgResolutionDisplay(cranesOnly = false) {
      const cache = window._dashboardStatsLive;
      if (!cache) return 0;

      const now = Date.now();
      let opTime = cache.resolvedOpTime;
      let opCount = cache.resolvedOpCount;
      cache.activeOpStarts.forEach((start) => {
          opTime += (now - start) / 1000;
          opCount++;
      });

      let craneTime = cache.resolvedCraneTime;
      let craneCount = cache.resolvedCraneCount;
      cache.activeCraneStarts.forEach((start) => {
          craneTime += (now - start) / 1000;
          craneCount++;
      });

      if (cranesOnly) {
          return craneCount > 0 ? Math.floor(craneTime / craneCount) : 0;
      }

      const avg = typeof window.getModuleAvgResolution === 'function'
          ? window.getModuleAvgResolution(opTime, opCount, craneTime, craneCount)
          : (opCount + craneCount > 0 ? Math.floor((opTime + craneTime) / (opCount + craneCount)) : 0);

      const avgEl = document.getElementById('avg-resolution-time');
      if (avgEl) avgEl.textContent = formatTime(avg);
      return avg;
  }
  
  function createOperationCard(op, index) {
      console.log('=== CREANDO TARJETA OPERACIÓN ===');
      console.log('Operación:', op.id, 'Status:', op.status);

      const col = document.createElement('div');
      col.className = 'col-12 col-md-6 col-lg-4 mb-4';

      const card = document.createElement('div');
      card.className = `operation-card ${op.status === 'active' ? 'failure' : 'operational'}`;
      card.setAttribute('data-id', op.id);
      card.setAttribute('data-area', getAreaFromOperationId(op.id));
      card.setAttribute('data-status', op.status);
      
      // Stagger entrance animation
      const delay = (index || 0) * 60;
      card.style.animationDelay = `${delay}ms`;
      card.classList.add('op-card-appear');
      
      // Usar la MISMA lógica exitosa que operations.html
      let timerStartTime = null;
      if (op.status === 'active') {
          console.log('⏰ Procesando cronómetro para operación activa:', op.id);
          console.log('Campos disponibles:', Object.keys(op));
          console.log('Datos completos de la operación:', op);
          console.log('createdAt:', op.createdAt, typeof op.createdAt);
          console.log('timestamp:', op.timestamp, typeof op.timestamp);

          // COPIAR EXACTAMENTE la lógica de operations.html que SÍ funciona
          if (op.createdAt && typeof op.createdAt.toDate === 'function') {
              timerStartTime = op.createdAt.toDate().getTime();
              console.log('✅ Cronómetro iniciado con createdAt:', new Date(timerStartTime).toLocaleString('es-MX'));
          } else if (op.timestamp && typeof op.timestamp.toDate === 'function') {
              timerStartTime = op.timestamp.toDate().getTime();
              console.log('✅ Cronómetro iniciado con timestamp:', new Date(timerStartTime).toLocaleString('es-MX'));
          } else if (op.createdAt && typeof op.createdAt === 'string') {
              timerStartTime = new Date(op.createdAt).getTime();
              console.log('✅ Cronómetro iniciado con createdAt (string):', new Date(timerStartTime).toLocaleString('es-MX'));
          } else if (op.timestamp && typeof op.timestamp === 'string') {
              timerStartTime = new Date(op.timestamp).getTime();
              console.log('✅ Cronómetro iniciado con timestamp (string):', new Date(timerStartTime).toLocaleString('es-MX'));
          } else {
              console.log('❌ No se pudo iniciar cronómetro. Campos disponibles:', Object.keys(op));
          }
      }

      const timer = timerStartTime
          ? `<div class="timer text-danger font-mono" data-start="${timerStartTime}">${formatTime(Math.floor((Date.now() - timerStartTime) / 1000))}</div>`
          : '';

      const isFailed = op.status === 'active';
      const elapsedSec = (isFailed && timerStartTime) ? Math.floor((Date.now() - timerStartTime) / 1000) : 0;
      let badgeClass = 'bg-success';
      let badgeText = 'Operativa';
      let cardExtraClass = '';
      let timeBarPct = 0;
      let timeBarStrobe = '';

      if (isFailed) {
          if (elapsedSec >= 900) {
              badgeClass = 'badge-critical-andon';
              badgeText = '🚨 CRÍTICO N3 (>15m)';
              cardExtraClass = 'late-escalated critical-escalated';
              timeBarPct = 100;
              timeBarStrobe = 'strobe';
          } else if (elapsedSec >= 300) {
              badgeClass = 'badge-late-andon';
              badgeText = '⚠️ TARDE N2 (>5m)';
              cardExtraClass = 'late-escalated';
              timeBarPct = 100;
              timeBarStrobe = 'strobe';
          } else {
              badgeClass = 'bg-danger';
              badgeText = 'Falla N1';
              cardExtraClass = '';
              timeBarPct = Math.min(100, Math.max(5, Math.round((elapsedSec / 300) * 100)));
          }
      }

      if (cardExtraClass) {
          card.className += ` ${cardExtraClass}`;
      }
      card.classList.add('scada-faceplate-card');

      const timeBarHtml = isFailed ? `
        <div class="scada-sla-track mt-2" title="Progreso de atención SLA (Meta < 5m)">
          <div class="scada-sla-progress ${timeBarStrobe}" style="width: ${timeBarPct}%;"></div>
        </div>` : '';

      const techName = op.assignedTo || op.reportedBy || op.technicianName || null;
      const techChipHtml = (isFailed && techName) ? `
        <div class="scada-tech-chip assigned mt-2" title="Personal asignado a la atención">
            <span class="scada-tech-avatar">${techName.charAt(0)}</span>
            <span><strong>Técnico:</strong> ${techName}</span>
        </div>` : '';

      setSafeDOM(card, `
          <div class="d-flex justify-content-between align-items-center">
              <div class="d-flex align-items-center gap-2">
                  <strong class="scada-faceplate-title">${op.id}</strong>
                  <span class="badge ${badgeClass}">${badgeText}</span>
              </div>
              <span class="status-dot ${isFailed ? 'failure' : 'operational'}"></span>
          </div>
          ${timer}
          ${timeBarHtml}
          <div class="mt-2 text-wrap" style="word-break: break-word; font-size:0.88rem; color:#cbd5e1;">${op.description || 'Operativa'}</div>
          ${techChipHtml}
      `);

      card.addEventListener('click', () => {
          console.log('Click en operación:', op.id);
          showOperationDetails(op);
      });
      col.appendChild(card);
      return col;
  }


  function renderOperations() {
      // Verificar que el elemento existe antes de usarlo
      if (!operationsGrid) {
          // operationsGrid no existe en esta página
          return;
      }
      // Limpiar el contenedor
      operationsGrid.replaceChildren();
      operationsGrid.className = 'operations-grid';

      // Construir secciones dinámicamente desde OPERATIONS_CONFIG
      // (se excluye `key`, que el adapter inyecta al desempaquetar el documento config, y se
      // valida que el valor sea lista: de otro modo una clave no-área rompe el render.)
      const allAreaKeys = Object.keys(OPERATIONS_CONFIG)
          .filter(k => k !== '_order' && k !== 'key' && Array.isArray(OPERATIONS_CONFIG[k]));
      const orderedKeys = OPERATIONS_CONFIG._order
          ? OPERATIONS_CONFIG._order.filter(k => allAreaKeys.includes(k))
          : allAreaKeys;
      allAreaKeys.forEach(k => { if (!orderedKeys.includes(k)) orderedKeys.push(k); });

      orderedKeys.forEach(areaKey => {
          // sectionKey: fragmento tras 'area', ej: '10', '35plus' -> '35'
          const sectionKey = areaKey.replace(/^area/, '').replace('plus', '');
          const sectionLabel = areaKey.replace(/^area/, 'Área ').replace('plus', '+');
          // El doc config/operations_config puede traer flags (autoEscalate, notifyShiftLeaders)
          // además de los mapas de área; sólo los valores que son arrays son secciones.
          const areaOps = Array.isArray(OPERATIONS_CONFIG[areaKey]) ? OPERATIONS_CONFIG[areaKey] : [];

          const sectionOperations = areaOps
              .filter(id => operations.has(id))
              .map(id => operations.get(id));

          if (sectionOperations.length > 0) {
              const section = document.createElement('div');
              section.className = 'operations-section';
              section.setAttribute('data-area', sectionKey);

              const titleElement = document.createElement('h3');
              titleElement.className = 'operations-section-title';
              titleElement.textContent = sectionLabel;
              section.appendChild(titleElement);

              const row = document.createElement('div');
              row.className = 'row';

              let cardIndex = 0;
              sectionOperations.forEach(op => {
                  const cardCol = createOperationCard(op, cardIndex++);
                  row.appendChild(cardCol);
              });

              section.appendChild(row);
              operationsGrid.appendChild(section);
          }
      });

      // Aplicar filtros actuales
      filterOperations();

      publishAndonState();
  }
  

  
  function filterOperations() {
      const sections = document.querySelectorAll('.operations-section');
      
      sections.forEach(section => {
          const cards = section.querySelectorAll('.operation-card');
          let visibleCards = 0;
          const sectionArea = section.getAttribute('data-area');
          
          // Determinar si la sección debe mostrarse basado en el filtro de área
          const matchesAreaFilter = currentFilters.area === 'all' || 
              (currentFilters.area === '35' && sectionArea === '35') ||
              (currentFilters.area === sectionArea);

          if (matchesAreaFilter) {
              cards.forEach(card => {
                  const status = card.getAttribute('data-status');
                  
                  const matchesStatus = currentFilters.status === 'all' || 
                      (currentFilters.status === 'active' && status === 'active') ||
                      (currentFilters.status === 'operational' && status === 'operational');
                  
                  const isVisible = matchesStatus;
                  card.style.display = isVisible ? '' : 'none';
                  if (isVisible) visibleCards++;
              });
          }
          
          // Mostrar u ocultar la sección completa
          section.style.display = (matchesAreaFilter && visibleCards > 0) ? '' : 'none';
      });
  }
  
  function updateView() {
      operationsGrid.className = `operations-container ${currentView}-view`;
      filterOperations();
  }
  
  // Event Listeners
  if (statusFilter) {
      statusFilter.addEventListener('change', (e) => {
          currentFilters.status = e.target.value;
          filterOperations();
      });
  }
  
  if (areaFilter) {
      areaFilter.addEventListener('change', (e) => {
          currentFilters.area = e.target.value;
          filterOperations();
      });
  }
  
  if (viewGridBtn) {
      viewGridBtn.addEventListener('click', () => {
          currentView = 'grid';
          viewGridBtn.classList.add('active');
          if (viewListBtn) viewListBtn.classList.remove('active');
          if (operationsGrid) operationsGrid.className = 'operations-container grid-view';
      });
  }
  
  if (viewListBtn) {
      viewListBtn.addEventListener('click', () => {
          currentView = 'list';
          viewListBtn.classList.add('active');
          if (viewGridBtn) viewGridBtn.classList.remove('active');
          if (operationsGrid) operationsGrid.className = 'operations-container list-view';
      });
  }
  
  // ═══ TELEMETRÍA DE TURNO ACTIVO (12 HORAS) Y ENTREGA DE GUARDIA ═══
  function updateShiftTelemetryDisplay() {
      if (typeof window.getCurrentShift !== 'function') return;
      let currentShift = null;
      try {
          currentShift = window.getCurrentShift();
      } catch (e) {
          return;
      }

      let h = 0, m = 0, s = 0;
      try {
          const parts = new Intl.DateTimeFormat('en-US', {
              timeZone: 'America/Chihuahua',
              hour: 'numeric',
              minute: 'numeric',
              second: 'numeric',
              hour12: false
          }).formatToParts(new Date());
          h = parseInt(parts.find(p => p.type === 'hour').value, 10);
          if (h === 24) h = 0;
          m = parseInt(parts.find(p => p.type === 'minute').value, 10);
          s = parseInt(parts.find(p => p.type === 'second').value, 10);
      } catch (e) {
          const now = new Date();
          h = now.getHours();
          m = now.getMinutes();
          s = now.getSeconds();
      }

      let elapsedSec = 0;
      let shiftType = 'Turno Diurno';
      let scheduleStr = '06:00 → 18:00 (12 hrs)';

      if (currentShift && currentShift.isNightShift) {
          shiftType = 'Turno Nocturno';
          scheduleStr = '18:00 → 06:00 (12 hrs)';
          elapsedSec = (h >= 18 ? (h - 18) : (h + 6)) * 3600 + m * 60 + s;
      } else {
          shiftType = 'Turno Matutino';
          scheduleStr = '06:00 → 18:00 (12 hrs)';
          elapsedSec = (h >= 6 && h < 18) ? ((h - 6) * 3600 + m * 60 + s) : 0;
      }

      const totalShiftSec = 12 * 3600;
      const progressPct = Math.min(100, Math.max(0, (elapsedSec / totalShiftSec) * 100));
      const remainingSec = Math.max(0, totalShiftSec - elapsedSec);

      const elH = Math.floor(elapsedSec / 3600);
      const elM = Math.floor((elapsedSec % 3600) / 60);
      const remH = Math.floor(remainingSec / 3600);
      const remM = Math.floor((remainingSec % 3600) / 60);

      const shiftName = currentShift ? currentShift.name : 'Jornada Actual';

      const badgeEl = document.getElementById('shift-badge-pill');
      if (badgeEl) badgeEl.textContent = shiftName;

      const typePill = document.getElementById('shift-type-pill');
      if (typePill) typePill.textContent = shiftType;

      const nameText = document.getElementById('shift-name-text');
      if (nameText) nameText.textContent = shiftType;

      const schedText = document.getElementById('shift-schedule-text');
      if (schedText) schedText.textContent = scheduleStr;

      const progressBar = document.getElementById('shift-progress-bar');
      if (progressBar) {
          progressBar.style.width = `${progressPct.toFixed(1)}%`;
          progressBar.setAttribute('aria-valuenow', progressPct.toFixed(1));
      }

      const elText = document.getElementById('shift-elapsed-text');
      if (elText) elText.textContent = `Transcurrido: ${elH}h ${elM}m (${progressPct.toFixed(0)}%)`;

      const remText = document.getElementById('shift-remaining-text');
      if (remText) remText.textContent = `Resta: ${remH}h ${remM}m`;

      const heroBadge = document.getElementById('plant-hero-shift-badge');
      if (heroBadge) heroBadge.textContent = shiftName.toUpperCase();

      const heroName = document.getElementById('plant-hero-shift-name');
      if (heroName) heroName.textContent = shiftType.toUpperCase();
  }
  window.updateShiftTelemetryDisplay = updateShiftTelemetryDisplay;
  try { updateShiftTelemetryDisplay(); } catch (e) {}

  // ═══ BUCLE MAESTRO DE TELEMETRÍA EN TIEMPO REAL (1 SEGUNDO) ═══
  setInterval(() => {
      let lateCount = 0;
      let activeFailures = 0;
      let maintCount = 0;
      let hasCritical = false;

      // 1. Cronómetros y Escalamiento Automático de Fallas Activas (N1 > N2 > N3)
      const criticalItems = [];
      const lateItems = [];

      document.querySelectorAll('.timer').forEach(timer => {
          const startTime = parseInt(timer.getAttribute('data-start'));
          if (isNaN(startTime)) return;
          const seconds = Math.floor((Date.now() - startTime) / 1000);
          timer.textContent = formatTime(seconds);
          activeFailures++;

          const cardEl = timer.closest('.operation-card, .crane-card');
          if (cardEl) {
              const badgeEl = cardEl.querySelector('.badge');
              const timeBar = cardEl.querySelector('.scada-time-bar, .scada-sla-progress');
              const equipId = cardEl.getAttribute('data-id') || (cardEl.querySelector('strong') ? cardEl.querySelector('strong').textContent.trim() : 'Equipo');

              if (seconds >= 900) { // Nivel 3 Crítico (>15 min)
                  hasCritical = true;
                  lateCount++;
                  criticalItems.push(`${equipId} (+${formatTime(seconds)})`);
                  if (!cardEl.classList.contains('critical-escalated')) {
                      cardEl.classList.add('critical-escalated');
                  }
                  if (!cardEl.classList.contains('late-escalated')) {
                      cardEl.classList.add('late-escalated');
                  }
                  if (badgeEl && !badgeEl.classList.contains('badge-critical-andon')) {
                      badgeEl.className = 'badge badge-critical-andon';
                      badgeEl.textContent = '🚨 CRÍTICO N3 (>15m)';
                  }
                  if (timeBar) {
                      timeBar.style.width = '100%';
                      timeBar.classList.add('strobe');
                  }
              } else if (seconds >= 300) { // Nivel 2 Supervisor (>5 min)
                  lateCount++;
                  lateItems.push(`${equipId} (+${formatTime(seconds)})`);
                  if (cardEl.classList.contains('critical-escalated')) {
                      cardEl.classList.remove('critical-escalated');
                  }
                  if (!cardEl.classList.contains('late-escalated')) {
                      cardEl.classList.add('late-escalated');
                  }
                  if (badgeEl && !badgeEl.classList.contains('badge-late-andon')) {
                      badgeEl.className = 'badge badge-late-andon';
                      badgeEl.textContent = '⚠️ TARDE N2 (>5m)';
                  }
                  if (timeBar) {
                      timeBar.style.width = '100%';
                      timeBar.classList.add('strobe');
                  }
              } else {
                  if (cardEl.classList.contains('late-escalated')) {
                      cardEl.classList.remove('late-escalated');
                  }
                  if (cardEl.classList.contains('critical-escalated')) {
                      cardEl.classList.remove('critical-escalated');
                  }
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

      // 2. Cronómetros de Mantenimiento con 3 Tiempos Andon (T1 Reacción, T2 Reparación, T3 Total)
      document.querySelectorAll('.maintenance-timers').forEach(container => {
          maintCount++;
          const failedStart = parseInt(container.getAttribute('data-failed-start'));
          const maintStart = parseInt(container.getAttribute('data-maint-start'));
          
          if (!isNaN(failedStart) && !isNaN(maintStart)) {
              const failedSec = Math.max(0, Math.floor((maintStart - failedStart) / 1000));
              const maintSec = Math.max(0, Math.floor((Date.now() - maintStart) / 1000));
              const totalSec = failedSec + maintSec;
              
              const failedValEl = container.querySelector('.failed-timer-val');
              const maintValEl = container.querySelector('.maint-timer-val');
              const totalValEl = container.querySelector('.total-timer-val');
              
              if (failedValEl) failedValEl.textContent = formatTime(failedSec);
              if (maintValEl) maintValEl.textContent = formatTime(maintSec);
              if (totalValEl) totalValEl.textContent = formatTime(totalSec);
          }
      });

      // 3. Sincronizar Contadores en Sidebar y Hero Banner
      const lateCounterEl = document.getElementById('late-failures-count');
      if (lateCounterEl) lateCounterEl.textContent = lateCount;

      const heroLateEl = document.getElementById('plant-hero-late');
      if (heroLateEl) heroLateEl.textContent = lateCount;

      const heroActiveEl = document.getElementById('plant-hero-active');
      if (heroActiveEl) heroActiveEl.textContent = activeFailures;

      const maintCounterEl = document.getElementById('maint-cranes-count');
      if (maintCounterEl) maintCounterEl.textContent = maintCount;

      const heroMaintEl = document.getElementById('plant-hero-maint');
      if (heroMaintEl) heroMaintEl.textContent = maintCount;

      // 4. Semáforo Hero Beacon & Título de Planta
      const heroBeacon = document.getElementById('plant-hero-beacon');
      const heroTitle = document.getElementById('plant-hero-status-title');
      if (heroBeacon && heroTitle) {
          if (hasCritical) {
              heroBeacon.className = 'scada-beacon-dot danger';
              heroTitle.textContent = `🚨 PARO CRÍTICO NIVEL 3 (${activeFailures} EN FALLA)`;
          } else if (lateCount > 0) {
              heroBeacon.className = 'scada-beacon-dot danger';
              heroTitle.textContent = `⚠️ ALERTA ESCALADA TARDE (>5m) - ${lateCount} PAROS`;
          } else if (activeFailures > 0) {
              heroBeacon.className = 'scada-beacon-dot warning';
              heroTitle.textContent = `⚠️ ATENCIÓN REQUERIDA (${activeFailures} EN FALLA)`;
          } else if (maintCount > 0) {
              heroBeacon.className = 'scada-beacon-dot warning';
              heroTitle.textContent = `🔧 TRABAJO TÉCNICO EN CURSO (${maintCount} EQUIPOS)`;
          } else {
              heroBeacon.className = 'scada-beacon-dot';
              heroTitle.textContent = 'PLANTA 100% OPERATIVA';
          }
      }

      // 5. Gauge Radial Hero de Disponibilidad SCADA
      const plantOeeEl = document.getElementById('plant-oee-pct');
      const oeeVal = plantOeeEl ? parseInt(plantOeeEl.textContent) || 100 : 100;
      const gaugePctEl = document.getElementById('plant-radial-gauge-pct');
      const gaugeArcEl = document.getElementById('plant-radial-gauge-arc');
      if (gaugePctEl && gaugeArcEl) {
          gaugePctEl.textContent = `${oeeVal}%`;
          const offset = Math.max(0, Math.min(120, 120 - (oeeVal / 100) * 120));
          gaugeArcEl.style.strokeDashoffset = offset;
          if (oeeVal >= 95) {
              gaugeArcEl.style.stroke = '#10b981';
              gaugePctEl.className = 'scada-radial-gauge-val text-success';
          } else if (oeeVal >= 80) {
              gaugeArcEl.style.stroke = '#f59e0b';
              gaugePctEl.className = 'scada-radial-gauge-val text-warning';
          } else {
              gaugeArcEl.style.stroke = '#ef4444';
              gaugePctEl.className = 'scada-radial-gauge-val text-danger';
          }
      }

      // 6. Live Escalation Marquee Banner
      const bannerEl = document.getElementById('scada-live-escalation-banner');
      const tagEl = document.getElementById('scada-escalation-tag');
      const scrollEl = document.getElementById('scada-escalation-scroll');
      if (bannerEl && tagEl && scrollEl) {
          if (hasCritical) {
              bannerEl.className = 'scada-escalation-banner has-critical';
              tagEl.className = 'scada-escalation-tag critical';
              tagEl.textContent = '🚨 CRÍTICO N3';
              scrollEl.textContent = `🚨 [ESCALACIÓN CRÍTICA NIVEL 3] ${criticalItems.join(' • ')} — ASISTENCIA INMEDIATA REQUERIDA • NOTIFICANDO A SUPERVISIÓN Y GERENCIA`;
          } else if (lateCount > 0) {
              bannerEl.className = 'scada-escalation-banner has-late';
              tagEl.className = 'scada-escalation-tag late';
              tagEl.textContent = '⚠️ TARDE N2';
              scrollEl.textContent = `⚠️ [ATENCIÓN TARDE >5m] ${lateItems.join(' • ')} — TIEMPO DE RESPUESTA EXCEDIDO • ASISTENCIA TÉCNICA URGENTE`;
          } else if (maintCount > 0) {
              bannerEl.className = 'scada-escalation-banner';
              tagEl.className = 'scada-escalation-tag late';
              tagEl.textContent = '🔧 MANTENIMIENTO';
              scrollEl.textContent = `🔧 [TRABAJO TÉCNICO ACTIVO] ${maintCount} equipos en reparación • Monitoreo SCADA en tiempo real`;
          } else {
              bannerEl.className = 'scada-escalation-banner';
              tagEl.className = 'scada-escalation-tag normal';
              tagEl.innerHTML = '<span class="scada-beacon-dot"></span> NORMAL';
              scrollEl.textContent = '● SISTEMA NORMALIZADO • TODOS LOS SISTEMAS OPERATIVOS • SLA COMPLIANCE 100% • TELEMETRÍA EN LÍNEA';
          }
      }

      // 7. Progreso del Turno de 12 Horas
      updateShiftTelemetryDisplay();

      if (window._dashboardStatsLive) refreshAvgResolutionDisplay();
  }, 1000);















  // Función para cargar historial de operación para una fecha específica
  async function loadOperationHistoryForDate(operationId, date) {
    // Detectar automáticamente el ID correcto según la página
    const historyTableBody = document.getElementById('operationHistoryTableBody') || document.getElementById('historyTableBody');
    const currentShift = window.getCurrentShift();
    
    if (!historyTableBody) {
      console.error('No se encontró el elemento de tabla de historial');
      return;
    }
    
    try {
      console.log(`Cargando historial para operación ${operationId} en fecha ${date.toISOString().split('T')[0]}`);
          
          // Mostrar mensaje de carga
          setSafeDOM(historyTableBody, `
              <tr>
                  <td colspan="7" class="text-center">
                      <div class="spinner-border text-primary" role="status">
                          <span class="visually-hidden">Cargando...</span>
                      </div>
                      <p class="mt-2">Cargando historial...</p>
                  </td>
              </tr>`);

          const records = [];
          
      // 1. Obtener fallas activas (siempre, independientemente de la fecha seleccionada)
      console.log('Buscando fallas activas para operación:', operationId);
          const activeSnapshot = await db.collection('operations')
          .where('id', '==', operationId)
              .where('status', '==', 'active')
              .get();
          
          activeSnapshot.forEach(doc => {
              const data = doc.data();
              let reportedDate = null;
          let reportedShift = null;
          
              if (data.createdAt && typeof data.createdAt.toDate === 'function') {
                  reportedDate = data.createdAt.toDate();
              } else if (data.timestamp && typeof data.timestamp.toDate === 'function') {
                  reportedDate = data.timestamp.toDate();
          } else if (data.createdAt && typeof data.createdAt === 'string') {
                  reportedDate = new Date(data.createdAt);
          } else if (data.timestamp && typeof data.timestamp === 'string') {
                  reportedDate = new Date(data.timestamp);
              }

              if (reportedDate) {
              // Determinar en qué jornada se reportó originalmente
              reportedShift = getShiftForDate(reportedDate);
              
              // Las fallas ACTIVAS siempre se muestran sin importar la jornada o el día.
              const today = window.getChihuahuaDateString();
              const selectedDate = date.toISOString().split('T')[0];
              const reportedDateStr = reportedDate.toISOString().split('T')[0];

              records.push({
                  reportedDate,
                  resolvedDate: null,
                  description: data.description || 'Sin descripción',
                  status: 'active',
                  reportedBy: data.reportedBy || 'Sistema',
                  resolvedBy: '-',
                  resolution: 'En curso',
                  originalShift: reportedShift?.name || '',
                  isFromPreviousShift: reportedDateStr !== selectedDate
              });
          }
      });

       // 2. Obtener historial de la colección específica de la jornada
       const collectionName = getShiftCollectionName(date);
       console.log(`Buscando en colección: ${collectionName}`);
       
       try {
         const historySnapshot = await db.collection(collectionName)
             .where('operationId', '==', operationId)
                  .get();
         
         console.log(`Registros encontrados en ${collectionName}:`, historySnapshot.size);
          
          historySnapshot.forEach(doc => {
              const data = doc.data();
              let reportedDate = null;
              let resolvedDate = null;

              if (data.timestamp && typeof data.timestamp.toDate === 'function') {
                  reportedDate = data.timestamp.toDate();
             } else if (data.timestamp && typeof data.timestamp === 'string') {
                 reportedDate = new Date(data.timestamp);
              }

              if (data.resolvedAt && typeof data.resolvedAt.toDate === 'function') {
                  resolvedDate = data.resolvedAt.toDate();
             } else if (data.resolvedAt && typeof data.resolvedAt === 'string') {
                 resolvedDate = new Date(data.resolvedAt);
              }

              if (reportedDate) {
                  records.push({
                      reportedDate,
                      resolvedDate,
                      description: data.description || 'Sin descripción',
                      status: 'resolved',
                      reportedBy: data.reportedBy || 'Sistema',
                      resolvedBy: data.resolvedBy || '-',
                      resolution: data.resolution || '-'
                  });
              }
          });
       } catch (error) {
         console.log(`Colección ${collectionName} no existe o está vacía:`, error.message);
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
                      <td colspan="7" class="text-center">
                          <div class="alert alert-info">
                              <i class="bi bi-info-circle me-2"></i>
                          No se encontraron registros de fallas para esta operación en la fecha seleccionada
                          </div>
                      </td>
                  </tr>`);
              return;
          }

          historyTableBody.replaceChildren();
          
      // Procesar registros de forma asíncrona
          for (const record of records) {
              try {
              // Validar que el record tenga los datos necesarios
              if (!record.reportedDate || !record.description) {
                  console.warn('Registro incompleto, saltando:', record);
                  continue;
              }

                  const failureTime = record.resolvedDate ? 
                      Math.floor((record.resolvedDate - record.reportedDate) / 1000) : 
                      (record.status === 'active' ? Math.floor((Date.now() - record.reportedDate.getTime()) / 1000) : 0);

                  const reportedByName = await getTechnicianName(record.reportedBy);
                  const resolvedByName = record.resolvedBy !== '-' ? await getTechnicianName(record.resolvedBy) : '-';

                  const row = document.createElement('tr');
                  row.className = (record.status === 'active' || record.status === 'failed') ? 'history-row-active' : (record.status === 'maintenance' ? 'history-row-maintenance' : 'history-row-resolved');
          
              // Agregar indicador visual para fallas de jornadas anteriores
              let descriptionText = record.description || 'Sin descripción';
              if (record.isFromPreviousShift) {
                  descriptionText = `🔄 ${descriptionText} (de ${record.originalShift})`;
                  row.classList.add('history-row-prev-shift');
              }
              
                  setSafeDOM(row, `
                      <td>${record.reportedDate.toLocaleString('es-MX')}</td>
                  <td>${descriptionText}</td>
                      <td>${reportedByName}</td>
                      <td>${resolvedByName}</td>
                  <td>${record.resolution || '-'}</td>
                      <td>${formatTime(failureTime)}</td>
                      <td>${record.resolvedDate ? record.resolvedDate.toLocaleString('es-MX') : 'En curso'}</td>
                  `);
                  historyTableBody.appendChild(row);
              } catch (e) {
                  console.error('Error creando fila:', e);
              }
          }
          
      console.log(`Historial cargado: ${records.length} registros`);

      } catch (error) {
      console.error('Error cargando historial:', error);
          setSafeDOM(historyTableBody, `
              <tr>
                  <td colspan="7" class="text-center">
                      <div class="alert alert-danger">
                          <h6><i class="bi bi-exclamation-triangle me-2"></i>Error al cargar el historial</h6>
                          <p class="mb-0">${error.message}</p>
                      </div>
                  </td>
              </tr>`);
      }
  }
  


  // Función para escuchar cambios en las operaciones
  function listenToOperations() {
      // Iniciando escucha de operaciones
      
      // Escuchar cambios en tiempo real para todas las operaciones
      db.collection('operations')
          .onSnapshot((snapshot) => {
              handleOperationsSnapshot(snapshot);
              updateStatistics(); // Actualizar estadísticas cada vez que hay cambios
          }, (error) => {
              console.error('Error en la escucha de operaciones:', error);
          });
  }

  function handleOperationsSnapshot(snapshot) {
      const activeOperations = new Set();
      snapshot.forEach(doc => {
          const operationData = doc.data();
          // Asegurarse de que solo las fallas activas se procesen aquí
          if (operationData.status === 'active') {
              const operationId = operationData.operationId || operationData.id;
              activeOperations.add(operationId);

              // Los datos de WhatsApp usan 'createdAt' como Firestore Timestamp
              console.log('=== PROCESANDO OPERACIÓN DESDE FIREBASE ===');
              console.log('ID:', operationId);
              console.log('createdAt raw:', operationData.createdAt);
              console.log('createdAt type:', typeof operationData.createdAt);

              let timestamp;
              if (operationData.createdAt && typeof operationData.createdAt.toDate === 'function') {
                  timestamp = operationData.createdAt.toDate();
                  console.log('✅ Usando createdAt de Firebase para', operationId, ':', timestamp.toLocaleString('es-MX'));
              } else if (operationData.createdAt && operationData.createdAt.seconds) {
                  // Firestore Timestamp como objeto plano
                  timestamp = new Date(operationData.createdAt.seconds * 1000);
                  console.log('✅ Usando createdAt (seconds) para', operationId, ':', timestamp.toLocaleString('es-MX'));
              } else if (operationData.timestamp && typeof operationData.timestamp.toDate === 'function') {
                  timestamp = operationData.timestamp.toDate();
                  console.log('✅ Usando timestamp de Firebase para', operationId, ':', timestamp.toLocaleString('es-MX'));
              } else if (operationData.createdAt && typeof operationData.createdAt === 'string') {
                  timestamp = new Date(operationData.createdAt);
                  console.log('✅ Usando createdAt (string) para', operationId, ':', timestamp.toLocaleString('es-MX'));
              } else if (typeof operationData.timestamp === 'string') {
                  timestamp = new Date(operationData.timestamp);
                  console.log('✅ Usando timestamp (string) para', operationId, ':', timestamp.toLocaleString('es-MX'));
              } else {
                  timestamp = new Date();
                  console.log('⚠️ Usando fecha actual para', operationId, '(no se encontró fecha válida)');
                  console.log('Campos disponibles:', Object.keys(operationData));
              }
              operations.set(operationId, {
                  id: operationId,
                  status: 'active',
                  description: operationData.description,
                  timestamp: timestamp,
                  createdAt: operationData.createdAt, // Preservar el createdAt original de Firebase
                  reportedBy: operationData.reportedBy,
                  assignedTo: operationData.assignedTo,
                  shift: operationData.shift
              });

              console.log('✅ Operación guardada en Map con createdAt:', operationData.createdAt);
          }
      });

      // Marcar como operativas las que ya no están activas
      operations.forEach((op, opId) => {
          if (!activeOperations.has(opId)) {
              operations.set(opId, {
                  ...op,
                  status: 'operational',
                  description: 'Operativa',
                  timestamp: null
              });
          }
      });

      renderOperations();
  }

  // Función para mostrar notificaciones
  function showNotification(message, type = 'info') {
      // Crear elemento de notificación
      const notification = document.createElement('div');
      notification.className = `alert alert-${type === 'success' ? 'success' : type === 'error' ? 'danger' : 'info'} alert-dismissible fade show position-fixed`;
      notification.style.cssText = 'top: 20px; right: 20px; z-index: 9999; min-width: 300px;';
      setSafeDOM(notification, `
          ${message}
          <button type="button" class="btn-close" data-bs-dismiss="alert"></button>
      `);
      
      document.body.appendChild(notification);
      
      // Remover automáticamente después de 5 segundos
      setTimeout(() => {
          if (notification.parentNode) {
              notification.remove();
          }
      }, 5000);
  }

  // Función para inicializar las grúas por defecto
  function initializeDefaultCranes() {
      // Inicializando grúas
      
      // Crear todas las grúas configuradas
      Object.values(CRANES_CONFIG).flat().forEach(craneId => {
          cranes.set(craneId, {
              id: craneId,
              status: 'operational',
              description: 'Operativa',
              area: craneId.substring(0, 2)
          });
      });

      // Grúas inicializadas
      renderCranes();
  }

  function createCraneCard(crane) {
      const col = document.createElement('div');
      col.className = 'col-12 col-md-6 col-lg-4 mb-4';

      const card = document.createElement('div');
      const statusClass = crane.status === 'failed' ? 'failure' : crane.status === 'maintenance' ? 'maintenance' : 'operational';
      card.className = `operation-card ${statusClass}`;
      card.setAttribute('data-id', crane.id);
      card.setAttribute('data-area', crane.area);
      
      // Para grúas con fallas o en mantenimiento, usar reportedAt o timestamp
      let timerValue = null;
      if (crane.status === 'failed' || crane.status === 'maintenance') {
          if (crane.reportedAt && typeof crane.reportedAt.toDate === 'function') {
              timerValue = crane.reportedAt.toDate().getTime();
              console.log('✅ Cronómetro de grúa usando reportedAt:', new Date(timerValue).toLocaleString('es-MX'));
          } else if (crane.reportedAt && crane.reportedAt.seconds) {
              timerValue = crane.reportedAt.seconds * 1000;
              console.log('✅ Cronómetro de grúa usando reportedAt (seconds):', new Date(timerValue).toLocaleString('es-MX'));
          } else if (crane.timestamp && typeof crane.timestamp === 'number') {
              timerValue = crane.timestamp;
              console.log('✅ Cronómetro de grúa usando timestamp (number):', new Date(timerValue).toLocaleString('es-MX'));
          } else if (crane.timestamp && typeof crane.timestamp.toDate === 'function') {
              timerValue = crane.timestamp.toDate().getTime();
              console.log('✅ Cronómetro de grúa usando timestamp (Firestore):', new Date(timerValue).toLocaleString('es-MX'));
          } else if (crane.createdAt && typeof crane.createdAt.toDate === 'function') {
              timerValue = crane.createdAt.toDate().getTime();
              console.log('✅ Cronómetro de grúa usando createdAt:', new Date(timerValue).toLocaleString('es-MX'));
          } else if (crane.reportedAt && typeof crane.reportedAt === 'string') {
              timerValue = new Date(crane.reportedAt).getTime();
          } else if (crane.createdAt && typeof crane.createdAt === 'string') {
              timerValue = new Date(crane.createdAt).getTime();
          } else if (crane.timestamp && typeof crane.timestamp === 'string') {
              timerValue = new Date(crane.timestamp).getTime();
          } else {
              console.log('❌ No se encontró fecha para cronómetro de grúa. Campos:', Object.keys(crane));
          }
      }

      const isFailed = crane.status === 'failed';
      const isMaint = crane.status === 'maintenance';
      const elapsedSec = (isFailed && timerValue) ? Math.floor((Date.now() - timerValue) / 1000) : 0;
      let badgeClass = 'bg-success';
      let badgeText = 'Operativa';
      let cardExtraClass = '';
      let timeBarPct = 0;
      let timeBarStrobe = '';

      if (isFailed) {
          if (elapsedSec >= 900) {
              badgeClass = 'badge-critical-andon';
              badgeText = '🚨 CRÍTICO N3 (>15m)';
              cardExtraClass = 'late-escalated critical-escalated';
              timeBarPct = 100;
              timeBarStrobe = 'strobe';
          } else if (elapsedSec >= 300) {
              badgeClass = 'badge-late-andon';
              badgeText = '⚠️ TARDE N2 (>5m)';
              cardExtraClass = 'late-escalated';
              timeBarPct = 100;
              timeBarStrobe = 'strobe';
          } else {
              badgeClass = 'bg-danger';
              badgeText = 'Falla N1';
              cardExtraClass = '';
              timeBarPct = Math.min(100, Math.max(5, Math.round((elapsedSec / 300) * 100)));
          }
      } else if (isMaint) {
          badgeClass = 'bg-warning text-dark';
          badgeText = 'En Reparación';
      }

      if (cardExtraClass) {
          card.className += ` ${cardExtraClass}`;
      }
      card.classList.add('scada-faceplate-card');

      let timer = '';
      if (isFailed && timerValue) {
          timer = `<div class="timer font-mono text-danger" data-start="${timerValue}">${formatTime(Math.floor((Date.now() - timerValue) / 1000))}</div>`;
      } else if (isMaint) {
          const statusHistory = crane.statusHistory || [];
          const failedEntry = statusHistory.find(e => e.status === 'failed');
          const maintenanceEntry = statusHistory.find(e => e.status === 'maintenance');

          const failedStart = failedEntry ? new Date(failedEntry.at).getTime() : (timerValue || Date.now());
          const maintStart = maintenanceEntry ? new Date(maintenanceEntry.at).getTime() : Date.now();

          timer = `
              <div class="mt-1 maintenance-timers" data-failed-start="${failedStart}" data-maint-start="${maintStart}" style="font-size:0.82rem; font-family: monospace;">
                  <span class="text-danger">🔴 T1 Llegada: <span class="failed-timer-val">00:00:00</span></span><br>
                  <span class="text-warning">🔧 T2 Trabajo: <span class="maint-timer-val">00:00:00</span></span><br>
                  <span class="text-info">📊 T3 Total: <span class="total-timer-val">00:00:00</span></span>
              </div>
          `;
      }
      
      const techName = crane.maintenanceByName || crane.maintenanceBy || (isMaint ? 'Técnico Asignado' : null);
      const techChipHtml = techName ? `
        <div class="scada-tech-chip assigned mt-2" title="Técnico a cargo de la atención">
          <span class="scada-tech-avatar">${techName.charAt(0)}</span>
          <span><strong>Técnico:</strong> ${techName}</span>
        </div>` : '';

      const maintenanceBadge = isMaint && crane.maintenanceNote
          ? `<div class="mt-1" style="font-size:0.78rem;color:var(--warning); border-top: 1px dashed rgba(255,193,7,0.15); padding-top:4px;">
                <i class="bi bi-tools"></i> <strong>Motivo:</strong> ${crane.maintenanceNote}
             </div>`
          : '';

      const timeBarHtml = isFailed ? `
        <div class="scada-sla-track mt-2" title="Progreso de atención SLA (Meta < 5m)">
          <div class="scada-sla-progress ${timeBarStrobe}" style="width: ${timeBarPct}%;"></div>
        </div>` : '';

      setSafeDOM(card, `
          <div class="d-flex justify-content-between align-items-center">
              <div class="d-flex align-items-center gap-2">
                  <strong class="scada-faceplate-title">Grúa ${crane.id}</strong>
                  <span class="badge ${badgeClass}">${badgeText}</span>
              </div>
              <span class="status-dot ${statusClass}"></span>
          </div>
          ${timer}
          ${timeBarHtml}
          <div class="mt-2 text-wrap" style="font-size:0.88rem; color:#cbd5e1;">${crane.description || 'Operativa'}</div>
          ${techChipHtml}
          ${maintenanceBadge}
      `);
      
      card.addEventListener('click', () => {
          console.log('Click en grúa:', crane.id);
          showCraneDetails(crane);
      });
      
      col.appendChild(card);
      return col;
  }

  let latestCranesSnapshot = null;

  function renderCranes() {
      // Renderizando grúas
      if (!cranesGrid) {
          // cranesGrid no existe en esta página
          return;
      }
      cranesGrid.replaceChildren();
      
      const filterArea = currentFilters.craneArea || 'all';
      const filterStatus = currentFilters.craneStatus || 'all';
      
      // Obtener el orden de áreas: usar _order si está definido, si no ordenar numéricamente
      const allAreaKeys = Object.keys(CRANES_CONFIG).filter(k => k !== '_order');
      const areaOrder = (CRANES_CONFIG._order && CRANES_CONFIG._order.length > 0)
          ? CRANES_CONFIG._order.filter(k => allAreaKeys.includes(k))
          : allAreaKeys.sort((a, b) => parseInt(a.replace('area','')) - parseInt(b.replace('area','')));
      // Incluir claves que no estén en _order al final
      allAreaKeys.forEach(k => { if (!areaOrder.includes(k)) areaOrder.push(k); });

      // Construir secciones en el orden correcto
      const sections = new Map();
      areaOrder.forEach(areaKey => {
          const areaNum = areaKey.replace('area', '');
          const areaLabel = (window.HermesTopology && window.HermesTopology.getAreaLabel)
              ? window.HermesTopology.getAreaLabel(areaKey)
              : `Área ${areaNum}`;
          sections.set(areaNum, {
              title: areaLabel,
              cranes: Array.isArray(CRANES_CONFIG[areaKey]) ? CRANES_CONFIG[areaKey] : []
          });
      });

      sections.forEach(({ title, cranes: areaCranes }, sectionKey) => {
          if (filterArea === 'all' || filterArea === sectionKey) {
              // Filtrar grúas según el estado seleccionado
              const filteredCranes = areaCranes.map(craneId => {
                  return cranes.get(craneId) || {
                      id: craneId,
                      status: 'operational',
                      description: 'Operativa',
                      area: sectionKey
                  };
              }).filter(crane => {
                  if (filterStatus === 'all') return true;
                  if (filterStatus === 'active') return crane.status === 'failed';
                  if (filterStatus === 'maintenance') return crane.status === 'maintenance';
                  if (filterStatus === 'operational') return crane.status === 'operational';
                  return true;
              });

              if (filteredCranes.length > 0) {
                  const section = document.createElement('div');
                  section.className = 'operations-section mb-3';
                  setSafeDOM(section, `<h4 class="operations-section-title">${title}</h4>`);
                  
                  // Crear contenedor .row para las tarjetas
                  const row = document.createElement('div');
                  row.className = 'row';

                  filteredCranes.forEach(crane => {
                      row.appendChild(createCraneCard(crane));
                  });
                  
                  section.appendChild(row);
                  cranesGrid.appendChild(section);
              }
          }
      });

      if (filterArea === 'all' && filterStatus === 'all' && cranesGrid.children.length > 0) {
          try {
              // cached_cranes_html
          } catch (e) {}
      }

      publishAndonState();
  }

  function processCranesSnapshot(snapshot) {
      if (!snapshot) return;
      
      // Limpiar el mapa y pre-cargar todas las grúas de la configuración como operativas
      cranes.clear();
      const areaEntries = Object.entries(CRANES_CONFIG).filter(([k]) => k !== '_order');
      areaEntries.forEach(([, craneLists]) => {
          (Array.isArray(craneLists) ? craneLists : []).forEach(craneId => {
              cranes.set(craneId, {
                  id: craneId,
                  status: 'operational',
                  description: 'Operativa',
                  area: craneId.replace(/[a-zA-Z]/g, '')
              });
          });
      });

      // Procesar fallas activas
      snapshot.forEach(doc => {
          const craneId = doc.id;
          const craneData = doc.data();

          let ts = null;
          if (craneData.reportedAt && typeof craneData.reportedAt.toDate === 'function') {
              ts = craneData.reportedAt.toDate().getTime();
          } else if (typeof craneData.reportedAt === 'string') {
              ts = new Date(craneData.reportedAt).getTime();
          } else if (typeof craneData.reportedAt === 'number') {
              ts = craneData.reportedAt;
          }
          
          // Normalizar status: 'active' legacy → 'failed'; 'maintenance' permanece igual
          const craneStatus = craneData.status === 'maintenance' ? 'maintenance' : 'failed';
          cranes.set(craneId, {
              id: craneId,
              status: craneStatus,
              description: craneData.description,
              maintenanceNote: craneData.maintenanceNote || null,
              maintenanceByName: craneData.maintenanceByName || craneData.maintenanceBy || null,
              timestamp: ts,
              reportedAt: craneData.reportedAt || null,
              area: craneId.replace(/[a-zA-Z]/g, ''),
              reportedBy: craneData.reportedBy,
              statusHistory: craneData.statusHistory || []
          });
      });

      renderCranes();
      updateStatistics();
  }

  function listenToCranes() {
      // Iniciando escucha de grúas
      db.collection('cranes').onSnapshot(snapshot => {
          latestCranesSnapshot = snapshot;
          processCranesSnapshot(snapshot);
      });
  }

  function updateCraneFiltersUI() {
      const select = document.getElementById('crane-area-filter');
      const btnGroup = document.getElementById('cranes-filter-btn-group');
      
      const allAreaKeys = Object.keys(CRANES_CONFIG).filter(k => k !== '_order');
      const areaOrder = (CRANES_CONFIG._order && CRANES_CONFIG._order.length > 0)
          ? CRANES_CONFIG._order.filter(k => allAreaKeys.includes(k))
          : allAreaKeys.sort((a, b) => parseInt(a.replace('area','')) - parseInt(b.replace('area','')));
      allAreaKeys.forEach(k => { if (!areaOrder.includes(k)) areaOrder.push(k); });

      // 1. Actualizar el Select
      if (select) {
          const currentValue = select.value || 'all';
          setSafeDOM(select, '<option value="all">Todas</option>');
          areaOrder.forEach(areaKey => {
              const areaNum = areaKey.replace('area', '');
              const option = document.createElement('option');
              option.value = areaNum;
              option.textContent = (window.HermesTopology && window.HermesTopology.getAreaLabel)
                  ? window.HermesTopology.getAreaLabel(areaKey)
                  : `Área ${areaNum}`;
              select.appendChild(option);
          });
          select.value = currentValue;
          currentFilters.craneArea = select.value;
      }

      // 2. Actualizar los Botones del Header
      if (btnGroup) {
          btnGroup.replaceChildren();
          
          // Botón "Todas"
          const allBtn = document.createElement('button');
          allBtn.className = `btn btn-outline-primary btn-sm ${currentFilters.craneArea === 'all' ? 'active' : ''}`;
          allBtn.id = 'cranes-all';
          allBtn.textContent = 'Todas';
          allBtn.addEventListener('click', () => {
              document.querySelectorAll('#cranes-filter-btn-group .btn').forEach(b => b.classList.remove('active'));
              allBtn.classList.add('active');
              currentFilters.craneArea = 'all';
              if (select) select.value = 'all';
              renderCranes();
          });
          btnGroup.appendChild(allBtn);

          // Botones para cada área
          areaOrder.forEach(areaKey => {
              const areaNum = areaKey.replace('area', '');
              const btn = document.createElement('button');
              btn.className = `btn btn-outline-primary btn-sm ${currentFilters.craneArea === areaNum ? 'active' : ''}`;
              btn.id = `cranes-${areaNum}`;
              btn.textContent = `Área ${areaNum}`;
              const fullLabel = (window.HermesTopology && window.HermesTopology.getAreaLabel)
                  ? window.HermesTopology.getAreaLabel(areaKey)
                  : `Área ${areaNum}`;
              btn.title = fullLabel;
              btn.addEventListener('click', () => {
                  document.querySelectorAll('#cranes-filter-btn-group .btn').forEach(b => b.classList.remove('active'));
                  btn.classList.add('active');
                  currentFilters.craneArea = areaNum;
                  if (select) select.value = areaNum;
                  renderCranes();
              });
              btnGroup.appendChild(btn);
          });
      }
  }

  function listenToCranesConfig() {
      db.collection('config').doc('cranes_config').onSnapshot(async doc => {
          if (doc.exists) {
              const data = doc.data();
              if (data && Object.keys(data).length > 0) {
                  CRANES_CONFIG = data;
                  console.log('Configuración de grúas actualizada en app.js:', CRANES_CONFIG);
              }
          } else {
              console.log('config/cranes_config no existe, inicializando...');
              const defaultConfig = {
                  area10: ['10A', '10B', '10C', '10D'],
                  area20: ['20A', '20B', '20C', '20D', '20E', '20F'],
                  area30: ['30A', '30B', '30C', '30D']
              };
              try {
                  await db.collection('config').doc('cranes_config').set(defaultConfig);
              } catch (e) {
                  console.warn('No se pudo crear config/cranes_config:', e.message);
              }
              return;
          }

          // Actualizar la interfaz de filtros
          updateCraneFiltersUI();

          // Re-renderizar con la nueva configuración
          if (latestCranesSnapshot) {
              processCranesSnapshot(latestCranesSnapshot);
          } else {
              initializeDefaultCranes();
          }
      }, error => {
          console.error("Error escuchando configuración de grúas en app.js:", error);
      });
  }

  // Event listeners para filtros de grúas (sidebar)
  const craneStatusFilter = document.getElementById('crane-status-filter');
  if (craneStatusFilter) {
      craneStatusFilter.addEventListener('change', (e) => {
          currentFilters.craneStatus = e.target.value;
          renderCranes();
      });
  }

  const craneAreaFilter = document.getElementById('crane-area-filter');
  if (craneAreaFilter) {
      craneAreaFilter.addEventListener('change', (e) => {
          currentFilters.craneArea = e.target.value;
          renderCranes();
          
          // Sincronizar botones del header
          const selectVal = e.target.value;
          document.querySelectorAll('#cranes-filter-btn-group .btn').forEach(b => {
              if (b.id === `cranes-${selectVal}`) {
                  b.classList.add('active');
              } else if (selectVal === 'all' && b.id === 'cranes-all') {
                  b.classList.add('active');
              } else {
                  b.classList.remove('active');
              }
          });
      });
  }

  // Iniciando aplicación si estamos en la página del Dashboard (Index)
  const isIndexPage = !!document.getElementById('operations-grid');
  if (isIndexPage) {
      console.log('Inicializando lógica del Dashboard (index)...');
      initializeDefaultOperations();
      initializeDefaultCranes();
      listenToOperations();
      listenToCranes();
      listenToCranesConfig();
      updateStatistics();
      
      // Renderizar grúas inicialmente
      renderCranes();

      // Event listener para el botón Reportar Falla
      const submitReportBtn = document.getElementById('submitReport');
      if (submitReportBtn && document.getElementById('operationId')) {
        submitReportBtn.addEventListener('click', async () => {
          const operationId = document.getElementById('operationId')?.value;
          const description = document.getElementById('failureDescription')?.value;
          if (!operationId || !description) {
            alert('Por favor, completa la descripción de la falla.');
            return;
          }
          try {
            await reportFailure(operationId, description);
            const reportModal = bootstrap.Modal.getOrCreateInstance(document.getElementById('reportModal'));
            reportModal.hide();
            document.getElementById('failureDescription').value = '';
            alert('Falla reportada exitosamente.');
          } catch (error) {
            alert('Error al reportar la falla: ' + error.message);
          }
        });
      }

      // Event listener para el botón Resolver Falla
      const submitResolutionBtn = document.getElementById('submitResolution');
      if (submitResolutionBtn && document.getElementById('resolveOperationId')) {
        submitResolutionBtn.addEventListener('click', async () => {
          const operationId = document.getElementById('resolveOperationId')?.value;
          const resolution = document.getElementById('resolution')?.value;
          if (!operationId || !resolution) {
            alert('Por favor, completa la descripción de la solución.');
            return;
          }
          try {
            let finalResolution = resolution;
            if (window.executeAtomicPartsDeduction) {
              try {
                const partsNote = await window.executeAtomicPartsDeduction('Operación', operationId, 'Operador');
                if (partsNote) {
                  finalResolution += partsNote;
                }
              } catch (partErr) {
                console.warn('[Refactions] Error deduciendo refacción:', partErr);
              }
            }

            await resolveFailure(operationId, finalResolution);
            const resolveModal = bootstrap.Modal.getOrCreateInstance(document.getElementById('resolveModal'));
            resolveModal.hide();
            document.getElementById('resolution').value = '';
            alert('Falla resuelta exitosamente.');
          } catch (error) {
            alert('Error al resolver la falla: ' + error.message);
          }
        });
      }
  }

  function showResolveModal(operationId) {
    const input = document.getElementById('resolveOperationId');
    if (input) input.value = operationId;
    const resolvedByInput = document.getElementById('resolvedBy');
    if (resolvedByInput && window.getActiveTechnician) {
      const assignedTech = window.getActiveTechnician();
      if (assignedTech) resolvedByInput.value = assignedTech;
    }
    const modal = new bootstrap.Modal(document.getElementById('resolveModal'));
    modal.show();
  }
});

// Función para cargar historial de grúa para una fecha específica
async function loadCraneHistoryForDate(craneId, date) {
    const historyTableBody = document.getElementById('craneHistoryTableBody');
    const currentShift = window.getCurrentShift();
    
    if (!historyTableBody) {
      console.error('No se encontró el elemento de tabla de historial de grúas');
      return;
    }
  
    try {
        const dateStr = window.getChihuahuaDateString();
        console.log(`Cargando historial para grúa ${craneId} en fecha ${dateStr}`);
        
        // Mostrar mensaje de carga
        setSafeDOM(historyTableBody, `
            <tr>
                <td colspan="7" class="text-center">
                    <div class="spinner-border text-primary" role="status">
                        <span class="visually-hidden">Cargando...</span>
                    </div>
                    <p class="mt-2">Cargando historial...</p>
                </td>
            </tr>`);
        const records = [];
        
        // 1. Obtener fallas activas (siempre, independientemente de la fecha seleccionada)
        console.log('Buscando fallas activas para grúa:', craneId);
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
            }

            if (reportedDate) {
                reportedShift = getShiftForDate(reportedDate);
                const today = window.getChihuahuaDateString();
                const selectedDate = date.toISOString().split('T')[0];
                const reportedDateStr = reportedDate.toISOString().split('T')[0];
                
                records.push({
                    reportedDate,
                    resolvedDate: null,
                    description: data.description || 'Sin descripción',
                    status: data.status || 'active',
                    reportedBy: data.reportedBy || 'Sistema',
                    resolvedBy: '-',
                    resolution: 'En curso',
                    originalShift: reportedShift?.name || '',
                    isFromPreviousShift: reportedDateStr !== selectedDate,
                    statusHistory: data.statusHistory || [],
                    maintenanceNote: data.maintenanceNote || '',
                    maintenanceByName: data.maintenanceByName || data.maintenanceBy || '',
                    maintenanceAt: data.maintenanceAt || null
                });
            }
        }

        // 2. Obtener historial de todas las jornadas del día (A, B, C, D)
        const historyDateStr = window.getChihuahuaDateString ? window.getChihuahuaDateString(date) : date.toISOString().split('T')[0];
        const processedDocIds = new Set();
        for (const shiftKey of ['A', 'B', 'C', 'D']) {
            const collectionName = `crane_history_${historyDateStr}_Jornada${shiftKey}`;
            try {
                const historySnapshot = await db.collection(collectionName)
                    .where('craneId', '==', craneId)
                    .get();
                
                historySnapshot.forEach(doc => {
                    const recKey2 = (doc.data && doc.data().id) || doc.id + ':' + JSON.stringify(doc.data());
                    if (processedDocIds.has(recKey2)) return;
                    processedDocIds.add(recKey2);

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

        records.sort((a, b) => {
            if (!a.reportedDate) return 1;
            if (!b.reportedDate) return -1;
            return b.reportedDate - a.reportedDate;
        });

        await renderCraneHistoryTable(records, historyTableBody);
        console.log(`Historial de grúa cargado: ${records.length} registros`);
        
    } catch (error) {
        console.error('Error cargando historial de grúa:', error);
        if (historyTableBody) {
            setSafeDOM(historyTableBody, `
                <tr>
                    <td colspan="11" class="text-center">
                        <div class="alert alert-danger">
                            <h6><i class="bi bi-exclamation-triangle me-2"></i>Error al cargar el historial</h6>
                            <p class="mb-0">${error.message}</p>
                        </div>
                    </td>
                </tr>`);
        }
    }
}

// Función para cargar historial de grúa para un rango de fechas
async function loadCraneHistoryForDateRange(craneId, fromDate, toDate) {
  const historyTableBody = document.getElementById('craneHistoryTableBody');
  
  try {
    console.log(`Cargando historial para grúa ${craneId} desde ${fromDate.toISOString().split('T')[0]} hasta ${toDate.toISOString().split('T')[0]}`);
    
    // Mostrar mensaje de carga
    setSafeDOM(historyTableBody, `
        <tr>
            <td colspan="7" class="text-center">
                    <div class="spinner-border text-primary" role="status">
                        <span class="visually-hidden">Cargando...</span>
                    </div>
                <p class="mt-2">Cargando historial del rango de fechas...</p>
                </td>
            </tr>`);

        const records = [];
        const processedDocs = new Set(); // Para evitar duplicados
    
    // 1. Obtener fallas activas (siempre, independientemente del rango de fechas)
    console.log('Buscando fallas activas para grúa:', craneId);
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
            }

            if (reportedDate) {
          // Determinar en qué jornada se reportó originalmente
          reportedShift = getShiftForDate(reportedDate);
          
          // Solo mostrar si la falla fue reportada dentro del rango de fechas
          const reportedDateStr = reportedDate.toISOString().split('T')[0];
          const fromDateStr = fromDate.toISOString().split('T')[0];
          const toDateStr = toDate.toISOString().split('T')[0];
          
          if (reportedDateStr >= fromDateStr && reportedDateStr <= toDateStr) {
                records.push({
                    reportedDate,
                    resolvedDate: null,
                    description: data.description || 'Sin descripción',
                    status: data.status || 'active',
                    reportedBy: data.reportedBy || 'Sistema',
                    resolvedBy: '-',
                    resolution: 'En curso',
                    originalShift: reportedShift?.name || '',
                    isFromPreviousShift: false,
                    statusHistory: data.statusHistory || [],
                    maintenanceNote: data.maintenanceNote || '',
                    maintenanceByName: data.maintenanceByName || data.maintenanceBy || '',
                    maintenanceAt: data.maintenanceAt || null
                });
            }
        }
    }

    // 2. Obtener historial de todas las colecciones en el rango de fechas
    const fromDateStr = window.getChihuahuaDateString ? window.getChihuahuaDateString(fromDate) : fromDate.toISOString().split('T')[0];
    const toDateStr = window.getChihuahuaDateString ? window.getChihuahuaDateString(toDate) : toDate.toISOString().split('T')[0];
    
    const datesInRange = [];
    let cur = new Date(fromDateStr + 'T12:00:00Z');
    const end = new Date(toDateStr + 'T12:00:00Z');
    while (cur <= end) {
        datesInRange.push(cur.toISOString().split('T')[0]);
        cur.setUTCDate(cur.getUTCDate() + 1);
    }
    
    console.log(`Buscando en ${datesInRange.length} fechas del rango:`, datesInRange);
    
    for (const dateStr of datesInRange) {
        for (const shiftKey of ['A', 'B', 'C', 'D']) {
            const collectionName = `crane_history_${dateStr}_Jornada${shiftKey}`;
            try {
                const historySnapshot = await db.collection(collectionName)
                    .where('craneId', '==', craneId)
                    .get();
                
                historySnapshot.forEach(doc => {
                    // El id lógico del adapter es el craneId, no el id del registro: usarlo como
                    // clave de deduplicación ocultaba las fallas posteriores de la misma grúa.
                    const recKey3 = (doc.data && doc.data().id) || doc.id + ':' + JSON.stringify(doc.data());
                    if (processedDocs.has(recKey3)) return;
                    processedDocs.add(recKey3);
                    
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
            } catch (error) {
                // Colección vacía o no existe
            }
        }
    }

    records.sort((a, b) => {
        if (!a.reportedDate) return 1;
        if (!b.reportedDate) return -1;
        return b.reportedDate - a.reportedDate;
    });

    await renderCraneHistoryTable(records, historyTableBody);
    console.log(`Historial de grúa cargado: ${records.length} registros en el rango de fechas`);
    
  } catch (error) {
    console.error('Error cargando historial de grúa:', error);
    if (historyTableBody) {
        setSafeDOM(historyTableBody, `
            <tr>
                <td colspan="11" class="text-center">
                    <div class="alert alert-danger">
                        <h6><i class="bi bi-exclamation-triangle me-2"></i>Error al cargar el historial</h6>
                        <p class="mb-0">${error.message}</p>
                    </div>
                </td>
            </tr>`);
    }
  }
}

// Helper para extraer fecha Date de un campo Firestore Timestamp / String / Date
function parseHistoryDateField(val) {
  if (!val) return null;
  if (typeof val.toDate === 'function') return val.toDate();
  if (val instanceof Date) return isNaN(val.getTime()) ? null : val;
  if (typeof val === 'string' || typeof val === 'number') {
    const d = new Date(val);
    return isNaN(d.getTime()) ? null : d;
  }
  return null;
}

// Helper para formatear Date a YYYY-MM-DD local
function toLocalDateStr(date) {
  if (!date || !(date instanceof Date) || isNaN(date.getTime())) {
    return window.getChihuahuaDateString ? window.getChihuahuaDateString() : new Date().toISOString().split('T')[0];
  }
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

// Función para cargar historial de operación para un rango de fechas
async function loadOperationHistoryForDateRange(operationId, fromDate, toDate) {
  const historyTableBody = document.getElementById('operationHistoryTableBody') || document.getElementById('historyTableBody');
  if (!historyTableBody) return;

  try {
    const fromDateStr = toLocalDateStr(fromDate);
    const toDateStr = toLocalDateStr(toDate);
    console.log(`Cargando historial para operación ${operationId} desde ${fromDateStr} hasta ${toDateStr}`);

    setSafeDOM(historyTableBody, `
        <tr>
            <td colspan="7" class="text-center py-4">
                <div class="spinner-border text-primary" role="status">
                    <span class="visually-hidden">Cargando...</span>
                </div>
                <p class="mt-2 mb-0 text-muted">Cargando historial del rango de fechas...</p>
            </td>
        </tr>`);

    const records = [];
    const seenKeys = new Set();

    const addRecordIfUnique = (rec) => {
      const repTs = rec.reportedDate ? Math.floor(rec.reportedDate.getTime() / 1000) : 0;
      const key = `${rec.status}|${repTs}|${rec.description}`;
      if (!seenKeys.has(key)) {
        seenKeys.add(key);
        records.push(rec);
      }
    };

    // 1. Obtener fallas activas de esta operación
    try {
      const activeSnapshot = await db.collection('operations')
        .where('status', '==', 'active')
        .get();

      activeSnapshot.forEach(doc => {
        const data = doc.data();
        const docOpId = String(data.id || data.operationId || doc.id);
        if (docOpId !== String(operationId)) return;

        const reportedDate = parseHistoryDateField(data.createdAt) || parseHistoryDateField(data.timestamp) || new Date();
        const reportedShift = window.getShiftForDate ? window.getShiftForDate(reportedDate) : { name: '-' };
        const reportedDateStr = toLocalDateStr(reportedDate);

        addRecordIfUnique({
          reportedDate,
          resolvedDate: null,
          description: data.description || 'Sin descripción',
          status: 'active',
          reportedBy: data.reportedBy || 'Sistema',
          resolvedBy: '-',
          resolution: 'En curso',
          originalShift: reportedShift.name,
          isFromPreviousShift: reportedDateStr < fromDateStr
        });
      });
    } catch (activeErr) {
      console.warn('Error consultando fallas activas de operación:', activeErr);
    }

    // 2. Consultar colección global operations_history para esta operación
    try {
      const globalSnap = await db.collection('operations_history')
        .where('operationId', '==', String(operationId))
        .get();

      globalSnap.forEach(doc => {
        const data = doc.data();
        const reportedDate = parseHistoryDateField(data.reportedAt) || parseHistoryDateField(data.timestamp) || parseHistoryDateField(data.createdAt);
        const resolvedDate = parseHistoryDateField(data.resolvedAt);
        const refDate = reportedDate || resolvedDate;
        if (!refDate) return;

        const refDateStr = toLocalDateStr(refDate);
        if (refDateStr >= fromDateStr && refDateStr <= toDateStr) {
          addRecordIfUnique({
            reportedDate: refDate,
            resolvedDate,
            description: data.description || 'Sin descripción',
            status: 'resolved',
            reportedBy: data.reportedBy || 'Sistema',
            resolvedBy: data.resolvedBy || '-',
            resolution: data.resolution || '-'
          });
        }
      });
    } catch (globalErr) {
      console.warn('Aviso consultando operations_history global:', globalErr.message);
    }

    // 3. Consultar colecciones por jornada dentro del rango de fechas (máximo 14 días para evitar exceso de lecturas)
    const datesInRange = [];
    const cursor = new Date(fromDateStr + 'T12:00:00');
    const endCursor = new Date(toDateStr + 'T12:00:00');
    while (cursor <= endCursor && datesInRange.length <= 14) {
      datesInRange.push(toLocalDateStr(cursor));
      cursor.setDate(cursor.getDate() + 1);
    }

    const shifts = ['JornadaA', 'JornadaB', 'JornadaC', 'JornadaD'];
    const shiftPromises = [];
    for (const dStr of datesInRange) {
      for (const sName of shifts) {
        const colName = `operations_history_${dStr}_${sName}`;
        shiftPromises.push(
          db.collection(colName)
            .where('operationId', '==', String(operationId))
            .get()
            .catch(() => null)
        );
      }
    }

    const shiftSnapshots = await Promise.all(shiftPromises);
    shiftSnapshots.forEach(snap => {
      if (!snap || snap.empty) return;
      snap.forEach(doc => {
        const data = doc.data();
        const reportedDate = parseHistoryDateField(data.reportedAt) || parseHistoryDateField(data.timestamp) || parseHistoryDateField(data.createdAt);
        const resolvedDate = parseHistoryDateField(data.resolvedAt);
        const refDate = reportedDate || resolvedDate;
        if (!refDate) return;

        addRecordIfUnique({
          reportedDate: refDate,
          resolvedDate,
          description: data.description || 'Sin descripción',
          status: 'resolved',
          reportedBy: data.reportedBy || 'Sistema',
          resolvedBy: data.resolvedBy || '-',
          resolution: data.resolution || '-'
        });
      });
    });

    // 4. Ordenar registros por fecha descendente (activas primero)
    records.sort((a, b) => {
      if (a.status === 'active' && b.status !== 'active') return -1;
      if (a.status !== 'active' && b.status === 'active') return 1;
      if (!a.reportedDate) return 1;
      if (!b.reportedDate) return -1;
      return b.reportedDate - a.reportedDate;
    });

    // 5. Mostrar resultados
    if (records.length === 0) {
      setSafeDOM(historyTableBody, `
          <tr>
              <td colspan="7" class="text-center py-4">
                  <div class="alert alert-info mb-0">
                      <i class="bi bi-info-circle me-2"></i>
                      No se encontraron registros de fallas para la Operación ${operationId} en el rango seleccionado (${fromDateStr} a ${toDateStr})
                  </div>
              </td>
          </tr>`);
      return;
    }

    historyTableBody.replaceChildren();

    for (const record of records) {
      try {
        const failureTime = record.resolvedDate
          ? Math.max(0, Math.floor((record.resolvedDate - record.reportedDate) / 1000))
          : (record.status === 'active' ? Math.max(0, Math.floor((Date.now() - record.reportedDate.getTime()) / 1000)) : 0);

        const reportedByName = await getTechnicianName(record.reportedBy);
        const resolvedByName = record.resolvedBy !== '-' ? await getTechnicianName(record.resolvedBy) : '-';

        const row = document.createElement('tr');
        row.className = (record.status === 'active' || record.status === 'failed')
          ? 'history-row-active'
          : (record.status === 'maintenance' ? 'history-row-maintenance' : 'history-row-resolved');

        let descriptionText = record.description || 'Sin descripción';
        if (record.isFromPreviousShift) {
          descriptionText = `🔄 ${descriptionText} (de ${record.originalShift})`;
          row.classList.add('history-row-prev-shift');
        }

        const statusCell = record.resolvedDate
          ? `<span class="badge bg-success me-1">Resuelta</span> <small>${record.resolvedDate.toLocaleString('es-MX')}</small>`
          : `<span class="badge bg-danger">🔴 En curso</span>`;

        setSafeDOM(row, `
            <td>${record.reportedDate.toLocaleString('es-MX')}</td>
            <td>${descriptionText}</td>
            <td>${reportedByName}</td>
            <td>${resolvedByName}</td>
            <td>${record.resolution || '-'}</td>
            <td>${formatTime(failureTime)}</td>
            <td>${statusCell}</td>
        `);
        historyTableBody.appendChild(row);
      } catch (e) {
        console.error('Error creando fila de historial de operación:', e);
      }
    }
  } catch (error) {
    console.error('Error cargando historial de operación por rango:', error);
    setSafeDOM(historyTableBody, `
        <tr>
            <td colspan="7" class="text-center py-4">
                <div class="alert alert-danger mb-0">
                    <h6><i class="bi bi-exclamation-triangle me-2"></i>Error al cargar el historial</h6>
                    <p class="mb-0">${error.message}</p>
                </div>
            </td>
        </tr>`);
  }
}

// Función para cargar historial de operación para una fecha específica (VERSIÓN UNIFICADA)
async function loadOperationHistoryForDate(operationId, date) {
  const targetDate = date instanceof Date ? date : window.getChihuahuaTime();
  return loadOperationHistoryForDateRange(operationId, targetDate, targetDate);
}

// Función para mostrar detalles e historial de una operación
async function showOperationDetails(op) {
  console.log('=== Inicio de showOperationDetails ===', op);

  const modalEl = document.getElementById('operationModal');
  if (!modalEl) {
    console.error('No se encontró #operationModal en el DOM');
    return;
  }

  const modal = bootstrap.Modal.getOrCreateInstance(modalEl);
  const historyTableBody = document.getElementById('operationHistoryTableBody') || document.getElementById('historyTableBody');
  const modalTitle = document.getElementById('operationModalTitle');

  const currentShift = window.getCurrentShift ? window.getCurrentShift() : { name: 'Actual' };
  if (modalTitle) {
    modalTitle.textContent = `Operación ${op.id}${op.name ? ' (' + op.name + ')' : ''} - Historial ${currentShift.name}`;
  }

  const modalBody = modalEl.querySelector('.modal-body');
  const todayStr = window.getChihuahuaDateString ? window.getChihuahuaDateString() : toLocalDateStr(new Date());

  // Reemplazar selector de fecha siempre para vincular listeners limpios al op.id actual
  const existingSelector = document.getElementById('operationDateSelector');
  if (existingSelector) {
    existingSelector.remove();
  }

  const dateSelector = document.createElement('div');
  dateSelector.id = 'operationDateSelector';
  dateSelector.className = 'mb-3';
  setSafeDOM(dateSelector, `
      <div class="row g-2">
          <div class="col-12 col-md-6">
              <label for="operationHistoryDateFrom" class="form-label small mb-1">Fecha Inicial:</label>
              <input type="date" class="form-control form-control-sm" id="operationHistoryDateFrom" value="${todayStr}">
          </div>
          <div class="col-12 col-md-6">
              <label for="operationHistoryDateTo" class="form-label small mb-1">Fecha Final:</label>
              <input type="date" class="form-control form-control-sm" id="operationHistoryDateTo" value="${todayStr}">
          </div>
      </div>
      <div class="d-flex flex-wrap gap-2 mt-2">
          <button class="btn btn-outline-secondary btn-sm" type="button" id="refreshOperationHistory">
              <i class="bi bi-arrow-clockwise"></i> Actualizar
          </button>
          <button class="btn btn-outline-info btn-sm" type="button" id="setTodayRangeOp">
              <i class="bi bi-calendar-day"></i> Solo Hoy
          </button>
          <button class="btn btn-outline-warning btn-sm" type="button" id="setWeekRangeOp">
              <i class="bi bi-calendar-week"></i> Última Semana
          </button>
      </div>
      <div class="mobile-scroll-hint d-md-none mt-2">
          <i class="bi bi-arrow-left-right"></i> Desliza horizontalmente la tabla para ver todas las columnas →
      </div>
  `);

  if (modalBody) {
    modalBody.insertBefore(dateSelector, modalBody.firstChild);
  }

  try {
    if (historyTableBody) {
      setSafeDOM(historyTableBody, `
          <tr>
              <td colspan="7" class="text-center py-4">
                  <div class="spinner-border text-primary" role="status">
                      <span class="visually-hidden">Cargando...</span>
                  </div>
                  <p class="mt-2 mb-0 text-muted">Cargando historial...</p>
              </td>
          </tr>`);
    }

    modal.show();

    const dateFromInput = document.getElementById('operationHistoryDateFrom');
    const dateToInput = document.getElementById('operationHistoryDateTo');
    const refreshBtn = document.getElementById('refreshOperationHistory');
    const setTodayBtn = document.getElementById('setTodayRangeOp');
    const setWeekBtn = document.getElementById('setWeekRangeOp');

    const loadHistoryWithRange = async () => {
      const fromVal = dateFromInput && dateFromInput.value ? new Date(dateFromInput.value + 'T12:00:00') : window.getChihuahuaTime();
      const toVal = dateToInput && dateToInput.value ? new Date(dateToInput.value + 'T12:00:00') : window.getChihuahuaTime();
      await loadOperationHistoryForDateRange(op.id, fromVal, toVal);
    };

    if (dateFromInput && dateToInput && refreshBtn) {
      dateFromInput.addEventListener('change', loadHistoryWithRange);
      dateToInput.addEventListener('change', loadHistoryWithRange);
      refreshBtn.addEventListener('click', loadHistoryWithRange);

      if (setTodayBtn) {
        setTodayBtn.addEventListener('click', () => {
          const today = window.getChihuahuaDateString ? window.getChihuahuaDateString() : toLocalDateStr(new Date());
          dateFromInput.value = today;
          dateToInput.value = today;
          loadHistoryWithRange();
        });
      }

      if (setWeekBtn) {
        setWeekBtn.addEventListener('click', () => {
          const today = window.getChihuahuaTime ? window.getChihuahuaTime() : new Date();
          const weekAgo = new Date(today);
          weekAgo.setDate(today.getDate() - 7);
          dateFromInput.value = toLocalDateStr(weekAgo);
          dateToInput.value = toLocalDateStr(today);
          loadHistoryWithRange();
        });
      }
    }

    await loadOperationHistoryForDate(op.id, window.getChihuahuaTime ? window.getChihuahuaTime() : new Date());
  } catch (error) {
    console.error('Error al cargar historial de operación:', error);
    if (historyTableBody) {
      setSafeDOM(historyTableBody, `
          <tr>
              <td colspan="7" class="text-center py-4">
                  <div class="alert alert-danger mb-0">
                      <h6><i class="bi bi-exclamation-triangle me-2"></i>Error al cargar el historial</h6>
                      <p class="mb-0">${error.message}</p>
                  </div>
              </td>
          </tr>`);
    }
  }
}
window.showOperationDetails = showOperationDetails;
window.loadOperationHistoryForDate = loadOperationHistoryForDate;
window.loadOperationHistoryForDateRange = loadOperationHistoryForDateRange;



// Función para generar el nombre de la colección basado en fecha y jornada
function getShiftCollectionName(date = null, shift = null) {
  const targetDate = date || window.getChihuahuaTime();
  const targetShift = shift || window.getCurrentShift();
  
  // Formato: YYYY-MM-DD_JORNADA (ej: 2024-01-15_A)
  // Usar fecha local en lugar de UTC
  const year = targetDate.getFullYear();
  const month = String(targetDate.getMonth() + 1).padStart(2, '0');
  const day = String(targetDate.getDate()).padStart(2, '0');
  const dateStr = `${year}-${month}-${day}`;
  
  return `operations_history_${dateStr}_${targetShift.name.replace(' ', '')}`;
}

// Función para generar el nombre de la colección de grúas basado en fecha y jornada
function getCraneShiftCollectionName(date = null, shift = null) {
  const targetDate = date || window.getChihuahuaTime();
  const targetShift = shift || window.getCurrentShift();
  
  // Formato: YYYY-MM-DD_JORNADA (ej: 2024-01-15_A)
  // Usar fecha local en lugar de UTC
  const year = targetDate.getFullYear();
  const month = String(targetDate.getMonth() + 1).padStart(2, '0');
  const day = String(targetDate.getDate()).padStart(2, '0');
  const dateStr = `${year}-${month}-${day}`;
  
  return `crane_history_${dateStr}_${targetShift.name.replace(' ', '')}`;
}

  // Reportar falla mediante backend para unificar flujo y permisos
  async function reportFailure(operationId, description) {
    const reportedBy = sessionStorage.getItem('username') || 'Sistema Web';
    const area = getAreaFromOperationId(operationId);
    const payload = {
      type: 'operation_failure',
      operationId,
      description,
      reportedBy,
      area,
      source: 'web'
    };
    const resp = await fetch('/processNotification', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(text || 'Error enviando notificación');
    }
    return await resp.json();
  }

// Función para resolver falla directamente en Firestore
async function resolveFailure(operationId, resolution) {
  const resolvedBy = sessionStorage.getItem('username') || 'Sistema Web';
  const db = firebase.firestore();
  
  try {
    console.log(`Resolviendo operación ${operationId} con resolución: ${resolution}`);
    
    // Obtener la operación activa
    const operationRef = db.collection('operations').doc(operationId);
    const operationDoc = await operationRef.get();
    
    if (!operationDoc.exists) {
      throw new Error('Operación no encontrada');
    }
    
    const operationData = operationDoc.data();
    console.log('Datos de la operación encontrada:', operationData);
    
    // Obtener jornada actual
    const currentShift = window.getCurrentShift();
    console.log('Jornada actual:', currentShift.name);
    
    // Generar nombre de colección específica por jornada
    const collectionName = getShiftCollectionName(window.getChihuahuaTime(), currentShift);
    console.log(`Guardando en colección: ${collectionName}`);
    
    // Crear batch para operación atómica
    const batch = db.batch();
    
    // Agregar al historial
    const historyRef = db.collection(collectionName).doc();
    batch.set(historyRef, {
      operationId: operationId,
      description: operationData.description,
      reportedBy: operationData.reportedBy,
      resolvedBy: resolvedBy,
      timestamp: operationData.timestamp || operationData.createdAt || firebase.firestore.FieldValue.serverTimestamp(),
      resolvedAt: firebase.firestore.FieldValue.serverTimestamp(),
      resolution: resolution,
      status: 'resolved',
      area: operationData.area,
      shift: currentShift.name,
      source: 'web'
    });
    
    // Eliminar de operaciones activas
    batch.delete(operationRef);
    
    // Ejecutar batch
    await batch.commit();
    
    console.log('Operación resuelta exitosamente');
    return { success: true, message: 'Operación resuelta exitosamente' };
    
  } catch (error) {
    console.error('Error resolviendo operación:', error);
    throw error;
  }
}

let _appTechConfigCache = null;
let _appTechConfigCacheTime = 0;

async function getAppTechniciansConfig() {
    const now = Date.now();
    if (_appTechConfigCache && (now - _appTechConfigCacheTime < 30000)) {
        return _appTechConfigCache;
    }
    try {
        const doc = await db.collection('config').doc('technicians').get();
        if (doc.exists) {
            _appTechConfigCache = doc.data();
            _appTechConfigCacheTime = now;
            return _appTechConfigCache;
        }
    } catch (e) {
        console.warn('Error fetching config/technicians in app.js:', e);
    }
    return _appTechConfigCache || {};
}

async function getAssignedTechniciansForCraneApp(craneId, shift) {
    if (!craneId) return [];
    const config = await getAppTechniciansConfig();

    // Determinar área dinámicamente desde CRANES_CONFIG si existe
    let areaNum = '';
    const cranesCfg = (typeof window !== 'undefined' && window.CRANES_CONFIG) ? window.CRANES_CONFIG : (typeof CRANES_CONFIG !== 'undefined' ? CRANES_CONFIG : null);
    if (cranesCfg && typeof cranesCfg === 'object') {
        for (const k of Object.keys(cranesCfg)) {
            if (k.startsWith('area') && Array.isArray(cranesCfg[k]) && cranesCfg[k].includes(craneId)) {
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

async function resolvePersonDisplayNameApp(rawName, craneId, shift, isResolver = false) {
    if (!rawName || rawName === '-') {
        if (isResolver && craneId) {
            const assigned = await getAssignedTechniciansForCraneApp(craneId, shift);
            if (assigned.length > 0) return assigned.join(', ');
        }
        return '-';
    }
    const lower = String(rawName).toLowerCase();
    if (lower.includes('boton fisico') || lower.includes('botón físico')) {
        if (isResolver && craneId) {
            const assigned = await getAssignedTechniciansForCraneApp(craneId, shift);
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

async function renderCraneHistoryTable(records, historyTableBody) {
    if (records.length === 0) {
        setSafeDOM(historyTableBody, `
            <tr>
                <td colspan="11" class="text-center">
                    <div class="alert alert-info">
                        <i class="bi bi-info-circle me-2"></i>
                        No se encontraron registros de fallas para esta grúa en la fecha seleccionada
                    </div>
                </td>
            </tr>`);
        return;
    }

    historyTableBody.replaceChildren();

    for (const record of records) {
        try {
            if (!record.reportedDate) record.reportedDate = new Date();
            if (!record.description) record.description = 'Falla atendida y solucionada';

            let timeFailed = 0;
            let timeMaintenance = 0;
            let totalTime = 0;

            if (record.status === 'resolved') {
                timeFailed = record.timeFailed || 0;
                timeMaintenance = record.timeMaintenance || 0;
                totalTime = record.totalTime || 0;
                if (!totalTime && !timeFailed && record.reportedDate && record.resolvedDate) {
                    totalTime = Math.floor((record.resolvedDate - record.reportedDate) / 1000);
                    timeFailed = totalTime;
                }
            } else {
                const nowMs = Date.now();
                const statusHistory = record.statusHistory || [];
                const failedEntry = statusHistory.find(e => e.status === 'failed');
                const maintenanceEntry = statusHistory.find(e => e.status === 'maintenance');

                const failedStart = failedEntry ? new Date(failedEntry.at).getTime() : record.reportedDate.getTime();

                if (record.status === 'maintenance' || maintenanceEntry) {
                    const maintStart = maintenanceEntry ? new Date(maintenanceEntry.at).getTime() : (record.maintenanceAt ? new Date(record.maintenanceAt).getTime() : nowMs);
                    timeFailed = Math.max(0, Math.floor((maintStart - failedStart) / 1000));
                    timeMaintenance = Math.max(0, Math.floor((nowMs - maintStart) / 1000));
                } else {
                    timeFailed = Math.max(0, Math.floor((nowMs - failedStart) / 1000));
                    timeMaintenance = 0;
                }
                totalTime = timeFailed + timeMaintenance;
            }

            const currentShift = window.getCurrentShift ? window.getCurrentShift() : { name: '' };
            const reportedByName = await resolvePersonDisplayNameApp(record.reportedBy, record.craneId, record.originalShift || currentShift, false);
            const resolvedByName = await resolvePersonDisplayNameApp(record.resolvedBy || record.technicianName, record.craneId, record.originalShift || currentShift, true);

            const row = document.createElement('tr');
            
            // Determinar clases y textos de estado
            let statusBadge = '';
            if (record.status === 'resolved') {
                statusBadge = '<span class="badge bg-success">Resuelta</span>';
                row.className = 'history-row-resolved';
            } else if (record.status === 'maintenance') {
                statusBadge = '<span class="badge bg-warning text-dark">🔧 Mantenimiento</span>';
                row.className = 'history-row-maintenance';
            } else {
                statusBadge = '<span class="badge bg-danger">🔴 Activa</span>';
                row.className = 'history-row-active';
            }

            let descriptionText = record.description || 'Sin descripción';
            if (record.isFromPreviousShift) {
                descriptionText = `🔄 ${descriptionText} (de ${record.originalShift})`;
            }

            setSafeDOM(row, `
                <td>${record.reportedDate.toLocaleString('es-MX')}</td>
                <td>${descriptionText}</td>
                <td>${reportedByName}</td>
                <td>${timeFailed > 0 ? formatTime(timeFailed) : '—'}</td>
                <td>${timeMaintenance > 0 ? formatTime(timeMaintenance) : '—'}</td>
                <td>${formatTime(totalTime)}</td>
                <td>${record.maintenanceNote || '—'}</td>
                <td>${record.maintenanceByName || '—'}</td>
                <td>${resolvedByName}</td>
                <td>${record.resolution || '—'}</td>
                <td>${statusBadge}</td>
            `);
            historyTableBody.appendChild(row);
        } catch (e) {
            console.error('Error creando fila:', e);
        }
    }
}

// Mover la función showCraneDetails aquí, fuera del bloque DOMContentLoaded
async function showCraneDetails(crane) {
    console.log('=== Inicio de showCraneDetails ===');
    console.log('Grúa recibida:', crane);
    const modal = bootstrap.Modal.getOrCreateInstance(document.getElementById('craneModal'));
    const historyTableBody = document.getElementById('craneHistoryTableBody');
    const modalTitle = document.getElementById('craneModalTitle');
    console.log('Elementos del DOM encontrados:', {
        modal: !!modal,
        historyTableBody: !!historyTableBody,
        modalTitle: !!modalTitle
    });
    const currentShift = window.getCurrentShift();
    modalTitle.textContent = `Historial de Grúa ${crane.id} - ${currentShift.name}`;

    // --- Botón "Marcar en Mantenimiento" en el footer ---
    // Solo mostrar si la grúa está en falla activa (status='failed')
    const modalFooter = document.querySelector('#craneModal .modal-footer');
    // Eliminar botón previo si existe (para que no se duplique)
    const oldBtn = document.getElementById('btnMarkMaintenance');
    if (oldBtn) oldBtn.remove();

    // Solo en cranes.html se permiten acciones de gestión.
    // index.html y demás páginas son solo visualización.
    const pathname = window.location.pathname;
    const href = window.location.href;
    const isManagementPage = pathname.endsWith('/cranes.html')
        || pathname === '/cranes.html'
        || href.includes('/cranes.html')
        || pathname === '/' && document.title.includes('Grúas'); // fallback

    if (isManagementPage && (crane.status === 'failed' || crane.status === 'active')) {
        const maintenanceBtn = document.createElement('button');
        maintenanceBtn.id = 'btnMarkMaintenance';
        maintenanceBtn.type = 'button';
        maintenanceBtn.className = 'btn btn-warning';
        setSafeDOM(maintenanceBtn, '<i class="bi bi-tools"></i> Marcar en Mantenimiento 🟡');
        
        maintenanceBtn.addEventListener('click', () => {
            // Reemplazar o expandir el footer con el formulario de mantenimiento
            const originalFooterNodes = Array.from(modalFooter.childNodes).map(n => n.cloneNode(true));
            
            setSafeDOM(modalFooter, `
                <div class="w-100 p-3 text-start border-top border-secondary-subtle" id="maintenanceForm" style="background: rgba(255,193,7,0.05); border-radius: 8px;">
                    <h6 class="text-warning mb-3"><i class="bi bi-tools"></i> Registrar Cambio a Mantenimiento</h6>
                    
                    <div class="mb-3">
                        <label class="form-label text-warning-emphasis fw-semibold">Motivo de Mantenimiento:</label>
                        <select class="form-select" id="maintReason" style="background: var(--card-bg); color: var(--text-color); border-color: rgba(255,255,255,0.15);">
                            <option value="Sin refacción en inventario">Sin refacción en inventario</option>
                            <option value="Mantenimiento mayor programado">Mantenimiento mayor programado</option>
                            <option value="Esperando proveedor externo">Esperando proveedor externo</option>
                            <option value="Daño estructural">Daño estructural</option>
                            <option value="Otro">Otro (especificar abajo)</option>
                        </select>
                    </div>
                    
                    <div class="mb-3 d-none" id="maintCustomReasonDiv">
                        <label class="form-label text-warning-emphasis fw-semibold">Especificar motivo:</label>
                        <input type="text" class="form-control" id="maintCustomReason" placeholder="Describe la razón..." style="background: var(--card-bg); color: var(--text-color); border-color: rgba(255,255,255,0.15);">
                    </div>
                    
                    <div class="mb-2">
                        <label class="form-label text-warning-emphasis fw-semibold">Técnico Responsable:</label>
                        <input type="text" class="form-control" id="maintResponsible" placeholder="Ingresa tu nombre..." value="${(window.getActiveTechnician ? window.getActiveTechnician(crane) : '') || (firebase.auth().currentUser?.displayName || '')}" style="background: var(--card-bg); color: var(--text-color); border-color: rgba(255,255,255,0.15);">
                    </div>
                    
                    <div class="mb-3">
                        <label class="form-label text-warning-emphasis fw-semibold">Clave de Autorización (requerido):</label>
                        <input type="password" class="form-control" id="maintPasscode" placeholder="Ingresa clave de autorización..." style="background: var(--card-bg); color: var(--text-color); border-color: rgba(255,255,255,0.15);">
                    </div>
                    
                    <div class="d-flex justify-content-end gap-2">
                        <button type="button" class="btn btn-secondary btn-sm" id="btnCancelMaint">Cancelar</button>
                        <button type="button" class="btn btn-warning btn-sm" id="btnSubmitMaint">Guardar Mantenimiento</button>
                    </div>
                </div>
            `);
            
            const maintReason = document.getElementById('maintReason');
            const maintCustomReasonDiv = document.getElementById('maintCustomReasonDiv');
            const maintCustomReason = document.getElementById('maintCustomReason');
            
            maintReason.addEventListener('change', () => {
                if (maintReason.value === 'Otro') {
                    maintCustomReasonDiv.classList.remove('d-none');
                } else {
                    maintCustomReasonDiv.classList.add('d-none');
                }
            });
            
            document.getElementById('btnCancelMaint').addEventListener('click', () => {
                // Restaurar el modal original recargándolo
                showCraneDetails(crane);
            });
            
            document.getElementById('btnSubmitMaint').addEventListener('click', async () => {
                const reason = maintReason.value === 'Otro' ? (maintCustomReason.value.trim() || 'Otro') : maintReason.value;
                const responsible = document.getElementById('maintResponsible').value.trim();
                const passcode = document.getElementById('maintPasscode').value.trim();
                const btnSubmit = document.getElementById('btnSubmitMaint');
                
                if (!responsible) {
                    alert('Por favor, ingresa el nombre del técnico responsable.');
                    return;
                }

                if (window.setActiveTechnician) {
                    window.setActiveTechnician(responsible);
                }

                const hash = await window.sha256Hex(`${passcode}:operations-monitor-2026-salt`);
                if (hash !== '269bbb52e0d54764e298627883052f1905c0a7eab133716cdace17223ddcc006') {
                    alert('Clave de autorización incorrecta.');
                    return;
                }
                
                try {
                    btnSubmit.disabled = true;
                    setSafeDOM(btnSubmit, '<span class="spinner-border spinner-border-sm"></span> Guardando...');
                    
                    const craneRef = db.collection('cranes').doc(crane.id);
                    const doc = await craneRef.get();
                    if (!doc.exists) {
                        alert('La grúa no tiene falla activa.');
                        showCraneDetails(crane);
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
                        maintenanceAt: firebase.firestore.FieldValue.serverTimestamp(),
                        statusHistory: [...prevHistory, newHistoryEntry]
                    });

                    // Sincronización espejo en /crane_status/ para Nodos Satélite y Centro de Mando
                    await db.collection('crane_status').doc(crane.id).set({
                        estado: 'Reparacion',
                        technician: responsible,
                        motivo: reason,
                        updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
                        source: 'web'
                    }, { merge: true });

                    // Notificación en tiempo real para WhatsApp
                    await db.collection('notifications').add({
                        type: 'crane_maintenance',
                        craneId: crane.id,
                        technician: responsible,
                        status: 'pending',
                        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
                        message: `🔧 *EN MANTENIMIENTO* 🟡\n\nLa grúa *${crane.id}* ha sido puesta en mantenimiento por *${responsible}*.\n*Motivo:* ${reason}`
                    }).catch(() => {});
                    
                    setSafeDOM(btnSubmit, '<i class="bi bi-check-circle"></i> ¡Guardado!');
                    btnSubmit.className = 'btn btn-success btn-sm';
                    setTimeout(() => {
                        bootstrap.Modal.getOrCreateInstance(document.getElementById('craneModal')).hide();
                    }, 800);
                } catch (err) {
                    console.error('Error al guardar mantenimiento:', err);
                    btnSubmit.disabled = false;
                    setSafeDOM(btnSubmit, 'Guardar Mantenimiento');
                    alert('Error al guardar: ' + err.message);
                }
            });
        });
        
        modalFooter.insertBefore(maintenanceBtn, modalFooter.firstChild);
    } else if (isManagementPage && crane.status === 'maintenance') {
        const infoBadge = document.createElement('span');
        infoBadge.id = 'btnMarkMaintenance';
        infoBadge.className = 'badge bg-warning text-dark fs-6 me-auto';
        setSafeDOM(infoBadge, '🔧 Ya en Mantenimiento');
        modalFooter.insertBefore(infoBadge, modalFooter.firstChild);
    }

    // Agregar selector de fecha al modal de grúas (recreándolo para limpiar listeners previos)
    const modalBody = document.querySelector('#craneModal .modal-body');
    const oldDateSelector = document.getElementById('craneDateSelector');
    if (oldDateSelector) oldDateSelector.remove();

    const dateSelector = document.createElement('div');
    dateSelector.id = 'craneDateSelector';
    dateSelector.className = 'mb-3';
    setSafeDOM(dateSelector, `
        <div class="row g-2">
            <div class="col-12 col-md-6">
                <label for="craneHistoryDateFrom" class="form-label small mb-1">Fecha Inicial:</label>
                <input type="date" class="form-control form-control-sm" id="craneHistoryDateFrom" value="${window.getChihuahuaDateString()}">
            </div>
            <div class="col-12 col-md-6">
                <label for="craneHistoryDateTo" class="form-label small mb-1">Fecha Final:</label>
                <input type="date" class="form-control form-control-sm" id="craneHistoryDateTo" value="${window.getChihuahuaDateString()}">
            </div>
        </div>
        <div class="d-flex flex-wrap gap-2 mt-2">
            <button class="btn btn-outline-secondary btn-sm" type="button" id="refreshCraneHistory">
                <i class="bi bi-arrow-clockwise"></i> Actualizar
            </button>
            <button class="btn btn-outline-info btn-sm" type="button" id="setTodayRange">
                <i class="bi bi-calendar-day"></i> Solo Hoy
            </button>
            <button class="btn btn-outline-warning btn-sm" type="button" id="setWeekRange">
                <i class="bi bi-calendar-week"></i> Última Semana
            </button>
        </div>
        <div class="mobile-scroll-hint d-md-none mt-2">
            <i class="bi bi-arrow-left-right"></i> Desliza horizontalmente la tabla para ver todas las columnas →
        </div>
    `);
    modalBody.insertBefore(dateSelector, modalBody.firstChild);
    
    try {
        console.log('Iniciando consulta de historial para grúa:', crane.id);
        setSafeDOM(historyTableBody, `
            <tr>
                <td colspan="7" class="text-center">
                    <div class="spinner-border text-primary" role="status">
                        <span class="visually-hidden">Cargando...</span>
                    </div>
                    <p class="mt-2">Cargando historial...</p>
                </td>
            </tr>`);
        modal.show();
        console.log('Modal mostrado');

        // Cargar historial inicial
        await loadCraneHistoryForDate(crane.id, window.getChihuahuaTime());

        // Configurar event listeners para el selector de rango de fechas
        const dateFromInput = document.getElementById('craneHistoryDateFrom');
        const dateToInput = document.getElementById('craneHistoryDateTo');
        const refreshBtn = document.getElementById('refreshCraneHistory');
        const setTodayBtn = document.getElementById('setTodayRange');
        const setWeekBtn = document.getElementById('setWeekRange');
        
        if (dateFromInput && dateToInput && refreshBtn) {
            // Función para cargar historial con rango de fechas
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
                    const today = window.getChihuahuaDateString();
                    dateFromInput.value = today;
                    dateToInput.value = today;
                    // Para "Solo Hoy", usar loadCraneHistoryForDate para aprovechar la lógica de jornadas nocturnas
                    const todayDate = new Date(today);
                    loadCraneHistoryForDate(crane.id, todayDate);
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
        }
    } catch (error) {
        console.error('Error al cargar historial de grúa:', error);
        setSafeDOM(historyTableBody, `
            <tr>
                <td colspan="7" class="text-center">
                    <div class="alert alert-danger">
                        <h6><i class="bi bi-exclamation-triangle me-2"></i>Error al cargar el historial</h6>
                        <p class="mb-0">${error.message}</p>
                        <small class="text-muted">Si el problema persiste, por favor actualiza la página.</small>
                    </div>
                </td>
            </tr>`);
    }
}
// Función para configurar actualizaciones en tiempo real de nombres
function setupRealTimeNameUpdates() {
    console.log('Configurando actualizaciones en tiempo real de nombres...');
    
    // Listener para cambios en técnicos
    const db = firebase.firestore();
    db.collection('config').doc('technicians').onSnapshot((doc) => {
        if (doc.exists) {
            console.log('Datos de técnicos actualizados, refrescando nombres...');
            updateTechnicianNamesInTable();
        }
    });
    
    // Listener para cambios en operadores
    db.collection('config').doc('operators').onSnapshot((doc) => {
        if (doc.exists) {
            console.log('Datos de operadores actualizados, refrescando nombres...');
            updateTechnicianNamesInTable();
        }
    });
}

// Función para actualizar los nombres en la tabla actual
async function updateTechnicianNamesInTable() {
    const nameCells = document.querySelectorAll('.technician-name');
    console.log(`Actualizando ${nameCells.length} nombres en la tabla...`);
    
    for (const cell of nameCells) {
        const phoneNumber = cell.getAttribute('data-phone');
        if (phoneNumber && phoneNumber !== 'Sistema' && phoneNumber !== '-') {
            try {
                const newName = await getTechnicianName(phoneNumber);
                if (newName !== cell.textContent) {
                    console.log(`Actualizando nombre: ${cell.textContent} -> ${newName} para ${phoneNumber}`);
                    cell.textContent = newName;
                }
            } catch (error) {
                console.error('Error actualizando nombre:', error);
            }
        }
    }
}

window.showCraneDetails = showCraneDetails;
window.showOperationDetails = showOperationDetails;

// Función global para obtener nombre del técnico o operador
window.getTechnicianName = async (phoneNumber) => {
    if (!phoneNumber) return 'Sistema';
    
    // If already a name (not just numbers), return it
    if (!/^\+?[0-9\s\-\(\)]+$/.test(phoneNumber)) {
        return phoneNumber;
    }
    
    try {
        const db = firebase.firestore();
        console.log(`🔍 Buscando nombre para número: "${phoneNumber}"`);
        console.log(`🔍 Tipo de dato: ${typeof phoneNumber}`);
        console.log(`🔍 Longitud: ${phoneNumber.length}`);
        console.log(`🔍 Caracteres: ${phoneNumber.split('').map(c => c.charCodeAt(0)).join(',')}`);
        
        // Normalizar el número de teléfono para búsqueda
        const normalizedPhone = phoneNumber.replace(/[^\d]/g, ''); // Solo números
        console.log(`📱 Número normalizado: "${normalizedPhone}"`);
        console.log(`📱 Longitud normalizada: ${normalizedPhone.length}`);
        
        // Función para buscar en una lista de personas
        const searchInList = (list, listName) => {
            if (!Array.isArray(list)) return null;
            
            console.log(`📋 Buscando en lista de ${listName} (${list.length} elementos):`);
            for (let i = 0; i < list.length; i++) {
                const person = list[i];
                console.log(`  [${i}] Persona:`, person);
                
                if (person.phone) {
                    const personPhoneNormalized = person.phone.replace(/[^\d]/g, '');
                    console.log(`🔎 Comparando "${normalizedPhone}" con "${personPhoneNormalized}" (${person.name || 'sin nombre'})`);
                    
                    // Buscar coincidencia exacta o con diferentes formatos
                    if (personPhoneNormalized === normalizedPhone || 
                        personPhoneNormalized.endsWith(normalizedPhone) ||
                        normalizedPhone.endsWith(personPhoneNormalized)) {
                        console.log(`✅ ${listName} encontrado: ${person.name} para ${phoneNumber}`);
                        return person.name;
                    }
                } else {
                    console.log(`  [${i}] Sin teléfono:`, person);
                }
            }
            return null;
        };
        
        // First, search in technicians
        const techDoc = await db.collection('config').doc('technicians').get();
        if (techDoc.exists) {
            const techData = techDoc.data();
            console.log('👨‍🔧 Datos de técnicos encontrados:', Object.keys(techData));
            
            // Search in all areas and shifts for technicians
            for (const areaKey of Object.keys(techData)) {
                const areaData = techData[areaKey];
                console.log(`🏭 Buscando en área: ${areaKey}`);
                
                for (const shiftKey of Object.keys(areaData)) {
                    const shiftData = areaData[shiftKey];
                    console.log(`⏰ Buscando en jornada: ${shiftKey}`);
                    
                    // New structure with names
                    if (shiftData && shiftData.technicians && Array.isArray(shiftData.technicians)) {
                        const foundName = searchInList(shiftData.technicians, 'Técnico');
                        if (foundName) return foundName;
                    }
                }
            }
        } else {
            console.log('❌ No se encontró documento de técnicos');
        }
        
        // If not found in technicians, search in operators
        const operatorsDoc = await db.collection('config').doc('operators').get();
        if (operatorsDoc.exists) {
            const operatorsData = operatorsDoc.data();
            console.log('👨‍💼 Datos de operadores encontrados:', Object.keys(operatorsData));
            
            // Search in all shifts for operators
            for (const shiftKey of Object.keys(operatorsData)) {
                const shiftOperators = operatorsData[shiftKey];
                console.log(`⏰ Buscando operadores en jornada: ${shiftKey}`);
                
                const foundName = searchInList(shiftOperators, 'Operador');
                if (foundName) return foundName;
            }
        } else {
            console.log('❌ No se encontró documento de operadores');
        }
        
        // If not found in either, return default name
        console.log(`⚠️ No se encontró nombre para "${phoneNumber}", usando nombre por defecto`);
        return `Técnico ${phoneNumber.slice(-4)}`;
    } catch (error) {
        console.error('❌ Error getting technician/operator name:', error);
        return `Técnico ${phoneNumber.slice(-4)}`;
    }
};

window.addEventListener('plant_topology_updated', () => {
    if (typeof renderCranes === 'function') renderCranes();
    if (typeof updateCraneFiltersUI === 'function') updateCraneFiltersUI();
});




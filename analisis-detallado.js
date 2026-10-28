/**
 * MÓDULO SCADA: ANÁLISIS DETALLADO EJECUTIVO
 */

      window.addEventListener("load", function () {
        if (typeof Chart !== "undefined") {
          Chart.defaults.color = "#94a3b8";
          Chart.defaults.borderColor = "rgba(255, 255, 255, 0.06)";
          Chart.defaults.font.family = "'Inter', -apple-system, BlinkMacSystemFont, sans-serif";
        }
      });

      // --- Configuración de jornadas ---
      // SHIFTS y funciones de jornadas ya están disponibles desde app.js
      // getCurrentShift() y getShiftTimeRangeForAnalysis() son funciones globales
      // getShiftTimeRangeForAnalysis() maneja filtros específicos para análisis

      // --- Firestore ---
      let allData = [];
      let filteredData = [];

      // --- Referencias globales a elementos de filtro ---
      let areaFilter = null;
      let tipoFilter = null;
      let jornadaFilter = null;
      let comparisonFilter = null;
      let dateFromFilter = null;
      let dateToFilter = null;
      let mejorasBtn = null;
      let aiAssistantBtn = null;

      // --- Inicialización cuando el DOM esté listo ---
      document.addEventListener("DOMContentLoaded", function () {
        // --- Filtros ---
        areaFilter = document.getElementById("areaFilter");
        tipoFilter = document.getElementById("tipoFilter");
        jornadaFilter = document.getElementById("jornadaFilter");
        comparisonFilter = document.getElementById("comparisonFilter");
        mejorasBtn = document.getElementById("mejorasBtn");
        aiAssistantBtn = document.getElementById("aiAssistantBtn");
        dateFromFilter = document.getElementById("dateFromFilter");
        dateToFilter = document.getElementById("dateToFilter");
        const setTodayRangeBtn = document.getElementById("setTodayRangeBtn");
        const setWeekRangeBtn = document.getElementById("setWeekRangeBtn");
        const setMonthRangeBtn = document.getElementById("setMonthRangeBtn");

        areaFilter.addEventListener("change", updateDashboard);
        tipoFilter.addEventListener("change", updateDashboard);
        jornadaFilter.addEventListener("change", updateJornadaAndDashboard);
        comparisonFilter.addEventListener("change", updateDashboard);
        dateFromFilter.addEventListener("change", updateDashboard);
        dateToFilter.addEventListener("change", updateDashboard);
        mejorasBtn.addEventListener("click", mostrarSugerenciasMejora);
        aiAssistantBtn.addEventListener("click", abrirAsistenteIA);

        // Botones de acceso rápido para fechas
        setTodayRangeBtn.addEventListener("click", () => {
          const today = window.getChihuahuaDateString();
          dateFromFilter.value = today;
          dateToFilter.value = today;
          updateDashboard();
        });

        setWeekRangeBtn.addEventListener("click", () => {
          const today = window.getChihuahuaTime();
          const weekAgo = new Date(today);
          weekAgo.setDate(today.getDate() - 7);

          dateFromFilter.value = window.getChihuahuaDateString(weekAgo);
          dateToFilter.value = window.getChihuahuaDateString(today);
          updateDashboard();
        });

        setMonthRangeBtn.addEventListener("click", () => {
          const today = window.getChihuahuaTime();
          const monthAgo = new Date(today);
          monthAgo.setMonth(today.getMonth() - 1);

          dateFromFilter.value = window.getChihuahuaDateString(monthAgo);
          dateToFilter.value = window.getChihuahuaDateString(today);
          updateDashboard();
        });

        // --- Aplicar configuración global ---
        applyGlobalConfig();

        // --- Listener para cambios en configuración global ---
        if (typeof globalConfigManager !== "undefined") {
          // Escuchar cambios en la configuración global solo una vez
          let lastConfig = null;
          setInterval(() => {
            if (globalConfigManager.initialized) {
              const currentConfig = globalConfigManager.getConfig();
              // Solo actualizar si la configuración cambió
              if (
                JSON.stringify(currentConfig) !== JSON.stringify(lastConfig)
              ) {
                lastConfig = currentConfig;
                updateModuleVisibility();
              }
            }
          }, 5000); // Verificar cada 5 segundos
        }

        // --- Inicializar fechas por defecto ---
        const today = window.getChihuahuaDateString();
        dateFromFilter.value = today;
        dateToFilter.value = today;

        // --- Cargar datos en tiempo real ---
        fetchData();
      });

      // --- Función para aplicar configuración global ---
      function applyGlobalConfig() {
        // Esperar a que la configuración global esté disponible
        if (
          typeof globalConfigManager !== "undefined" &&
          globalConfigManager.initialized
        ) {
          updateModuleVisibility();
        } else {
          // Reintentar después de un breve delay
          setTimeout(applyGlobalConfig, 500);
        }
      }

      // --- Función para actualizar visibilidad de módulos ---
      function updateModuleVisibility() {
        if (typeof globalConfigManager === "undefined") return;

        const config = globalConfigManager.getConfig();

        // Ocultar/mostrar secciones de operaciones
        const operationsElements = document.querySelectorAll(
          '[data-module="operations"]',
        );
        operationsElements.forEach((element) => {
          if (config.modules.operations) {
            element.style.display = "";
            element.classList.remove("d-none");
          } else {
            element.style.display = "none";
            element.classList.add("d-none");
          }
        });

        // Ocultar/mostrar secciones de grúas
        const cranesElements = document.querySelectorAll(
          '[data-module="cranes"]',
        );
        cranesElements.forEach((element) => {
          if (config.modules.cranes) {
            element.style.display = "";
            element.classList.remove("d-none");
          } else {
            element.style.display = "none";
            element.classList.add("d-none");
          }
        });

        // Actualizar filtros según módulos disponibles
        updateFiltersBasedOnModules(config);

        // Mostrar/ocultar mensaje de no módulos
        const noModulesMessage = document.getElementById("noModulesMessage");
        if (noModulesMessage) {
          if (!config.modules.operations && !config.modules.cranes) {
            noModulesMessage.style.display = "block";
          } else {
            noModulesMessage.style.display = "none";
          }
        }

        // Visibilidad de módulos aplicada
      }

      // --- Función para actualizar filtros según módulos disponibles ---
      function updateFiltersBasedOnModules(config) {
        const tipoFilter = document.getElementById("tipoFilter");
        if (!tipoFilter) return;

        // Limpiar opciones existentes
        tipoFilter.innerHTML = '<option value="all">Todos</option>';

        // Agregar opciones según módulos disponibles
        if (config.modules.operations) {
          const option = document.createElement("option");
          option.value = "operacion";
          option.textContent = "Operaciones";
          tipoFilter.appendChild(option);
        }

        if (config.modules.cranes) {
          const option = document.createElement("option");
          option.value = "grua";
          option.textContent = "Grúas";
          tipoFilter.appendChild(option);
        }

        // Si solo hay un módulo disponible, seleccionarlo automáticamente
        if (config.modules.operations && !config.modules.cranes) {
          tipoFilter.value = "operacion";
        } else if (config.modules.cranes && !config.modules.operations) {
          tipoFilter.value = "grua";
        }

        // Actualizar dashboard con los nuevos filtros
        updateDashboard();
      }

      // --- Cargar datos en tiempo real ---
      function fetchData() {
        // Iniciando carga de datos

        // Función para cargar datos optimizada
        async function loadCurrentShiftData() {
          const allOperations = [];
          const allCranes = [];
          const refactionsList = [];

          try {
            // Cargar solicitudes de refacciones de Firestore
            try {
              const refSnap = await db.collection("refaction_requests").get();
              refSnap.forEach(doc => {
                refactionsList.push({ id: doc.id, ...doc.data() });
              });
            } catch (err) {
              console.warn("No se pudieron cargar refacciones:", err);
            }
            const today = window.getChihuahuaTime();
            const currentShift = window.getCurrentShift();

            if (!currentShift) {
              console.error("❌ No se pudo determinar la jornada actual");
              return { operations: [], cranes: [] };
            }

            const year = today.getUTCFullYear();
            const month = String(today.getUTCMonth() + 1).padStart(2, "0");
            const day = String(today.getUTCDate()).padStart(2, "0");
            const dateStr = `${year}-${month}-${day}`;

            // Cargando jornada actual

            // Optimización: Solo buscar en fechas necesarias
            const shiftKey = currentShift.name.replace("Jornada ", "");
            let datesToSearch = [dateStr];

            // Para jornadas nocturnas, buscar en fechas anteriores
            if (currentShift.isNightShift) {
              const dates = [];
              for (let i = 0; i < 4; i++) {
                const date = new Date(today);
                date.setUTCDate(today.getUTCDate() - i);
                const year = date.getUTCFullYear();
                const month = String(date.getUTCMonth() + 1).padStart(2, "0");
                const day = String(date.getUTCDate()).padStart(2, "0");
                dates.push(`${year}-${month}-${day}`);
              }
              datesToSearch = dates;
            }

            // Buscar en todas las fechas necesarias
            for (const searchDate of datesToSearch) {
              const operationsCollection = `operations_history_${searchDate}_Jornada${shiftKey}`;
              const cranesCollection = `crane_history_${searchDate}_Jornada${shiftKey}`;

              try {
                // Cargar operaciones
                const opsSnapshot = await db
                  .collection(operationsCollection)
                  .get();
                opsSnapshot.forEach((doc) => {
                  const data = doc.data();
                  if (data) {
                    const normTime = data.timestamp || data.reportedAt || data.timerStartTime || data.createdAt;
                    allOperations.push({
                      ...data,
                      id: doc.id || data.id || data.operationId,
                      docId: doc.id,
                      operationId: data.id || data.operationId || doc.id,
                      timestamp: normTime,
                      tipo: "operacion",
                      Estado:
                        data.status === "resolved" ? "Resuelta" : "En Falla",
                      jornada: currentShift.name,
                      fecha: searchDate,
                    });
                  }
                });

                // Cargar grúas
                const cranesSnapshot = await db
                  .collection(cranesCollection)
                  .get();
                cranesSnapshot.forEach((doc) => {
                  const data = doc.data();
                  if (data) {
                    const normTime = data.reportedAt || data.timerStartTime || data.timestamp || data.createdAt;
                    allCranes.push({
                      ...data,
                      id: doc.id || data.craneId,
                      docId: doc.id,
                      craneId: data.craneId || doc.id,
                      timestamp: normTime,
                      tipo: "grua",
                      Estado:
                        data.status === "resolved" ? "Resuelta" : "En Falla",
                      jornada: currentShift.name,
                      fecha: searchDate,
                    });
                  }
                });
              } catch (error) {
                // Colección no existe, continuar
              }
            }

            // Cargar fallas activas del día actual
            const activeOpsSnapshot = await db
              .collection("operations")
              .where("status", "==", "active")
              .get();
            const activeCranesSnapshot = await db
              .collection("cranes")
              .where("status", "in", ["active", "failed", "maintenance"])
              .get();

            activeOpsSnapshot.forEach((doc) => {
              const data = doc.data();
              if (data) {
                const normTime = data.timerStartTime || data.reportedAt || data.timestamp || data.createdAt;
                allOperations.push({
                  ...data,
                  id: doc.id || data.id || data.operationId,
                  docId: doc.id,
                  operationId: data.id || data.operationId || doc.id,
                  timestamp: normTime,
                  tipo: "operacion",
                  Estado: "ACTIVA",
                  jornada: "Actual",
                  fecha: window.getChihuahuaDateString(),
                });
              }
            });

            activeCranesSnapshot.forEach((doc) => {
              const data = doc.data();
              if (data) {
                const normTime = data.reportedAt || data.timerStartTime || data.timestamp || data.createdAt;
                allCranes.push({
                  ...data,
                  id: doc.id || data.craneId,
                  docId: doc.id,
                  craneId: data.craneId || doc.id,
                  timestamp: normTime,
                  tipo: "grua",
                  Estado: "ACTIVA",
                  jornada: "Actual",
                  fecha: window.getChihuahuaDateString(),
                });
              }
            });

            // Unir y estructurar datos: preservar cada evento histórico y consolidar activos
            const all = [...allOperations, ...allCranes];
            const unique = {};
            all.forEach((item) => {
              // Si es activa, clave única por equipo activo; si es histórica, clave única por documento/evento
              const id = item.Estado === "ACTIVA"
                ? `active_${item.tipo}_${item.craneId || item.operationId || item.id}`
                : `hist_${item.docId || item.id || (item.tipo + '_' + (item.craneId || item.operationId) + '_' + (item.fecha || '') + '_' + Math.random())}`;

              if (!unique[id] || item.Estado === "ACTIVA") {
                // Asociar refacciones que pertenecen a este intervalo de tiempo de falla
                const startMs = item.timestamp || item.reportedAt || item.createdAt;
                const endMs = item.resolvedAt || new Date().toISOString();
                
                const startMsTime = startMs ? (startMs.toDate ? startMs.toDate().getTime() : new Date(startMs).getTime()) : 0;
                const endMsTime = endMs ? (endMs.toDate ? endMs.toDate().getTime() : new Date(endMs).getTime()) : Date.now();

                const refaccionesAsociadas = refactionsList.filter(r => {
                  const matchesId = (item.craneId && r.craneId === item.craneId) || (item.operationId && r.operationId === item.operationId);
                  if (!matchesId) return false;
                  
                  const refTime = r.createdAt?.toDate ? r.createdAt.toDate().getTime() : (r.createdAtMs || 0);
                  // Rango de holgura: 2 horas antes del reporte y hasta 1 hora después de resuelta
                  return refTime >= (startMsTime - 7200000) && refTime <= (endMsTime + 3600000);
                });

                item.refacciones = refaccionesAsociadas;
                unique[id] = item;
              }
            });

            allData = Object.values(unique);
            // Datos cargados
            updateDashboard();

            // Inicializar filtro de tendencias después de cargar datos
            setTimeout(() => {
              initializeTendenciasFilter();
            }, 2000);
          } catch (error) {
            console.error("Error cargando datos:", error);
            allData = [];
            updateDashboard();
          }
        }

        // Cargar datos OPTIMIZADO
        loadCurrentShiftData().catch((error) => {
          console.error("📊 Error cargando datos:", error);
        });

        // CORRECCIÓN CRÍTICA: Agregar listeners en tiempo real para detectar resoluciones
        function setupRealtimeListeners() {
          // Configurando listeners en tiempo real

          // Listener para operaciones activas
          db.collection("operations")
            .where("status", "==", "active")
            .onSnapshot((snapshot) => {
              // Cambio detectado en operaciones

              // Recargar datos cuando hay cambios
              loadCurrentShiftData().catch((error) => {
                console.error(
                  "📊 Error recargando datos después de cambio:",
                  error,
                );
              });
            });

          // Listener para grúas activas
          db.collection("cranes")
            .where("status", "in", ["active", "failed", "maintenance"])
            .onSnapshot((snapshot) => {
              // Cambio detectado en grúas

              // Recargar datos cuando hay cambios
              loadCurrentShiftData().catch((error) => {
                console.error(
                  "📊 Error recargando datos después de cambio:",
                  error,
                );
              });
            });

          // Listeners configurados
        }

        // Configurar listeners en tiempo real
        setupRealtimeListeners();

        // Inicializar filtros automáticamente
        updateJornadaAndDashboard();
      }

      // --- Función para actualizar jornada y filtros automáticamente ---
      function updateJornadaAndDashboard() {
        const jornada = jornadaFilter.value;
        const today = window.getChihuahuaTime();

        // Limpiar filtros de fecha primero
        dateFromFilter.value = "";
        dateToFilter.value = "";

        if (jornada === "actual") {
          // Para jornada actual, usar la jornada actual
          const currentShift = window.getCurrentShift();
          if (currentShift && currentShift.isNightShift) {
            // Jornada nocturna: desde el día anterior 6 PM hasta hoy antes de 6 AM
            const yesterday = new Date(today);
            yesterday.setUTCDate(today.getUTCDate() - 1);

            const yearFrom = yesterday.getUTCFullYear();
            const monthFrom = String(yesterday.getUTCMonth() + 1).padStart(
              2,
              "0",
            );
            const dayFrom = String(yesterday.getUTCDate()).padStart(2, "0");
            dateFromFilter.value = `${yearFrom}-${monthFrom}-${dayFrom}`;

            const yearTo = today.getUTCFullYear();
            const monthTo = String(today.getUTCMonth() + 1).padStart(2, "0");
            const dayTo = String(today.getUTCDate()).padStart(2, "0");
            dateToFilter.value = `${yearTo}-${monthTo}-${dayTo}`;

            // Jornada nocturna configurada
          }
        } else if (jornada === "C" || jornada === "D") {
          // Jornadas nocturnas específicas: desde el día anterior 6 PM hasta hoy antes de 6 AM
          const yesterday = new Date(today);
          yesterday.setUTCDate(today.getUTCDate() - 1);

          const yearFrom = yesterday.getUTCFullYear();
          const monthFrom = String(yesterday.getUTCMonth() + 1).padStart(
            2,
            "0",
          );
          const dayFrom = String(yesterday.getUTCDate()).padStart(2, "0");
          dateFromFilter.value = `${yearFrom}-${monthFrom}-${dayFrom}`;

          const yearTo = today.getUTCFullYear();
          const monthTo = String(today.getUTCMonth() + 1).padStart(2, "0");
          const dayTo = String(today.getUTCDate()).padStart(2, "0");
          dateToFilter.value = `${yearTo}-${monthTo}-${dayTo}`;

          // Jornada nocturna configurada
        } else if (jornada === "A" || jornada === "B") {
          // Jornadas diurnas: solo el día actual
          const year = today.getUTCFullYear();
          const month = String(today.getUTCMonth() + 1).padStart(2, "0");
          const day = String(today.getUTCDate()).padStart(2, "0");
          const todayStr = `${year}-${month}-${day}`;

          dateFromFilter.value = todayStr;
          dateToFilter.value = todayStr;

          console.log(`☀️ Jornada diurna ${jornada}: ${todayStr}`);
        } else if (jornada === "todas") {
          // Todas las jornadas: limpiar filtros de fecha
          dateFromFilter.value = "";
          dateToFilter.value = "";
          console.log("📅 Todas las jornadas: sin filtro de fecha");
        }

        // Actualizar el dashboard con los nuevos filtros
        updateDashboard();
      }

      // --- Dashboard principal ---
      function updateDashboard() {
        // Verificar que las funciones globales estén disponibles
        if (typeof window.getCurrentShift !== "function") {
          console.error("ERROR: window.getCurrentShift no está disponible");
          return;
        }
        if (typeof window.getShiftForDate !== "function") {
          console.error("ERROR: window.getShiftForDate no está disponible");
          return;
        }
        if (!window.SHIFTS) {
          console.error("ERROR: window.SHIFTS no está disponible");
          return;
        }

        // Iniciando actualización del dashboard

        // Verificar configuración global
        let globalConfig = null;
        if (
          typeof globalConfigManager !== "undefined" &&
          globalConfigManager.initialized
        ) {
          globalConfig = globalConfigManager.getConfig();
        }

        // Filtros
        const area = areaFilter.value;
        const tipo = tipoFilter.value;
        const jornada = jornadaFilter.value;
        const comparison = comparisonFilter.value;
        const dateFrom = dateFromFilter.value;
        const dateTo = dateToFilter.value;

        // Lógica simplificada para filtros
        let start, end;

        if (jornada === "todas") {
          // Modo "Todas las jornadas"
          if (dateFrom && dateTo) {
            start = new Date(dateFrom + "T00:00:00");
            end = new Date(dateTo + "T23:59:59");
          } else {
            start = new Date(2000, 0, 1);
            end = new Date(2100, 0, 1);
          }
        } else if (dateFrom && dateTo && jornada !== "actual") {
          // Modo "Fechas personalizadas"
          start = new Date(dateFrom + "T00:00:00");
          end = new Date(dateTo + "T23:59:59");
        } else {
          // Jornada actual o específica
          let targetShift;
          if (jornada === "actual") {
            targetShift = window.getCurrentShift();
          } else {
            targetShift = window.SHIFTS[jornada];
          }

          // Obtener rango de la jornada
          const shiftRange = window.getShiftTimeRangeForAnalysis(
            jornada === "actual" ? "actual" : jornada,
          );
          start = shiftRange.start;
          end = shiftRange.end;
        }

        // Filtros y configuración aplicados

        // Logs simplificados para filtrado
        const currentShift = window.getCurrentShift
          ? window.getCurrentShift()
          : null;

        filteredData = allData
          .filter((item) => {
            // Verificar si el módulo está habilitado
            if (globalConfig) {
              if (item.tipo === "operacion" && !globalConfig.modules.operations)
                return false;
              if (item.tipo === "grua" && !globalConfig.modules.cranes)
                return false;
            }

            // Área
            if (area !== "all") {
              const itemArea = (
                item.area ||
                item.craneId ||
                item.operationId ||
                item.id
              )
                .toString()
                .substring(0, 2);
              if (itemArea !== area) return false;
            }

            // Tipo
            if (tipo !== "all" && item.tipo !== tipo) return false;

            // Filtro de fecha/jornada
            let ts = item.timestamp || item.ri || item.reportedAt;
            if (ts && ts.toDate) ts = ts.toDate();
            else if (typeof ts === "string") ts = new Date(ts);
            else if (ts && ts.seconds) ts = new Date(ts.seconds * 1000);
            else ts = null;

            // CORRECCIÓN INDUSTRIAL: Si una falla sigue ACTIVA (no resuelta) en planta ahora mismo,
            // siempre debe contabilizarse en la jornada "Actual" o cuando se inició antes del fin del rango
            const isCurrentlyActive =
              (item.Estado === "ACTIVA" ||
                item.status === "failed" ||
                item.status === "active" ||
                item.status === "maintenance") &&
              !item.resolvedAt;
            if (isCurrentlyActive && (jornada === "actual" || jornada === "todas" || !ts || ts <= end)) {
              return true;
            }

            if (ts) {
              // SOLUCIÓN DEFINITIVA: Filtro simplificado
              if (jornada === "todas") {
                // Solo filtrar por fecha para "todas"
                if (ts < start || ts > end) {
                  return false;
                }
              } else {
                // Para cualquier jornada específica (actual, A, B, C, D)
                // 1. Verificar que esté en el rango de fecha (día completo)
                if (ts < start || ts > end) {
                  return false;
                }

                // 2. Verificar que pertenezca a la jornada correcta
                const timestampShift = window.getShiftForDate(ts);
                let targetShift;

                if (jornada === "actual") {
                  targetShift = window.getCurrentShift();
                } else {
                  targetShift = window.SHIFTS[jornada];
                }

                if (timestampShift.name !== targetShift.name) {
                  return false;
                }
              }
            }

            return true;
          })
          .map((item) => {
            // Preservar y normalizar timestamps en los datos filtrados
            const normalizedItem = { ...item };

            // Normalizar timestamp
            if (item.timestamp || item.ri || item.reportedAt) {
              let ts = item.timestamp || item.ri || item.reportedAt;
              if (ts && ts.toDate) ts = ts.toDate();
              else if (typeof ts === "string") ts = new Date(ts);
              else if (ts && ts.seconds) ts = new Date(ts.seconds * 1000);
              normalizedItem.timestamp = ts;
              normalizedItem.ri = ts; // Mantener ambos campos
              normalizedItem.reportedAt = ts; // Mantener también reportedAt
            }

            // Normalizar resolvedAt
            if (item.resolvedAt) {
              let resolved = item.resolvedAt;
              if (resolved && resolved.toDate) resolved = resolved.toDate();
              else if (typeof resolved === "string")
                resolved = new Date(resolved);
              else if (resolved && resolved.seconds)
                resolved = new Date(resolved.seconds * 1000);
              normalizedItem.resolvedAt = resolved;
            }

            return normalizedItem;
          });

        // Datos filtrados procesados

        // Timestamps procesados

        renderKPIs();
        renderCharts();
        renderComparisonChart();
        renderTable();
      }

      // --- KPIs ---
      function renderKPIs() {
        const kpiCards = document.getElementById("kpiCards");

        // Obtener configuración global para filtrar por módulos habilitados
        const config = globalConfigManager
          ? globalConfigManager.getConfig()
          : { modules: { operations: true, cranes: true } };

        // Usar filteredData para KPIs (datos ya filtrados por jornada/fecha)
        const total = filteredData.filter((d) => {
          const esOperacion = d.tipo === "operacion";
          const esGrua = d.tipo === "grua";
          const moduloHabilitado =
            (esOperacion && config.modules.operations) ||
            (esGrua && config.modules.cranes);
          return moduloHabilitado;
        }).length;

        const activas = filteredData.filter((d) => {
          let estado = (d.Estado || d.status || "")
            .toString()
            .trim()
            .toLowerCase();
          const esActiva =
            estado === "activa" || estado === "en falla" || estado === "active" || estado === "failed" || estado === "maintenance";

          const esOperacion = d.tipo === "operacion";
          const esGrua = d.tipo === "grua";
          const moduloHabilitado =
            (esOperacion && config.modules.operations) ||
            (esGrua && config.modules.cranes);

          return esActiva && moduloHabilitado;
        }).length;

        const resueltas = filteredData.filter((d) => {
          let estado = (d.Estado || d.status || "")
            .toString()
            .trim()
            .toLowerCase();
          const esResuelta =
            estado === "resuelta" ||
            estado === "resuelto" ||
            estado === "resolved";

          const esOperacion = d.tipo === "operacion";
          const esGrua = d.tipo === "grua";
          const moduloHabilitado =
            (esOperacion && config.modules.operations) ||
            (esGrua && config.modules.cranes);

          return esResuelta && moduloHabilitado;
        }).length;

        // KPIs calculados
        const mttrDataList = filteredData
          .filter((d) => {
            const esOperacion = d.tipo === "operacion";
            const esGrua = d.tipo === "grua";
            const moduloHabilitado =
              (esOperacion && config.modules.operations) ||
              (esGrua && config.modules.cranes);
            const start = d.timestamp || d.reportedAt || d.timerStartTime || d.createdAt;
            return d.resolvedAt && start && moduloHabilitado;
          })
          .map((d) => {
            let start = d.timestamp || d.reportedAt || d.timerStartTime || d.createdAt;
            let end = d.resolvedAt;
            if (start && start.toDate) start = start.toDate();
            else if (typeof start === "string") start = new Date(start);
            else if (start && start.seconds)
              start = new Date(start.seconds * 1000);
            if (end && end.toDate) end = end.toDate();
            else if (typeof end === "string") end = new Date(end);
            else if (end && end.seconds) end = new Date(end.seconds * 1000);
            return Math.max(0, (end - start) / 1000);
          });

        const tiempoPromedioSeg = promedio(mttrDataList);

        // Cálculo de Disponibilidad OEE de Flota coherente con Shift Handover
        const nowMs = Date.now();
        let totalDowntimeSec = 0;
        filteredData.forEach((d) => {
          let start = d.timestamp || d.reportedAt || d.timerStartTime || d.createdAt;
          if (start && start.toDate) start = start.toDate();
          else if (typeof start === "string") start = new Date(start);
          else if (start && start.seconds) start = new Date(start.seconds * 1000);

          let end = d.resolvedAt;
          if (end && end.toDate) end = end.toDate();
          else if (typeof end === "string") end = new Date(end);
          else if (end && end.seconds) end = new Date(end.seconds * 1000);

          if (start instanceof Date && !isNaN(start.getTime())) {
            const endMs = (end instanceof Date && !isNaN(end.getTime())) ? end.getTime() : nowMs;
            const diffSec = Math.max(0, Math.floor((endMs - start.getTime()) / 1000));
            // Tope por jornada para evitar distorsiones históricas multianuales en OEE de turno
            totalDowntimeSec += Math.min(diffSec, 12 * 3600);
          }
        });

        // Capacidad flota: 24 equipos continuos (12h de turno)
        const totalFleetCapacitySec = 24 * 12 * 3600;
        const oeeAvailabilityPct = Math.max(0, Math.min(100, ((totalFleetCapacitySec - totalDowntimeSec) / totalFleetCapacitySec) * 100)).toFixed(1);
        const oeeColor = parseFloat(oeeAvailabilityPct) >= 90 ? '#10b981' : (parseFloat(oeeAvailabilityPct) >= 75 ? '#f59e0b' : '#ef4444');

        kpiCards.innerHTML = `
        <div class="kpi-card kpi-total">
          <div class="kpi-title"><span>Total de Incidencias</span> <i class="bi bi-layers text-info"></i></div>
          <div class="kpi-value">${total}</div>
        </div>
        <div class="kpi-card kpi-active">
          <div class="kpi-title"><span>Fallas Activas en Planta</span> <span class="scada-led led-red"></span></div>
          <div class="kpi-value text-danger">${activas}</div>
        </div>
        <div class="kpi-card kpi-resolved">
          <div class="kpi-title"><span>Fallas Resueltas</span> <span class="scada-led led-green"></span></div>
          <div class="kpi-value text-success">${resueltas}</div>
        </div>
        <div class="kpi-card kpi-mttr">
          <div class="kpi-title"><span>MTTR (Tiempo Promedio)</span> <i class="bi bi-stopwatch text-warning"></i></div>
          <div class="kpi-value">${formateaTiempo(tiempoPromedioSeg)}</div>
        </div>
        <div class="kpi-card kpi-oee">
          <div class="kpi-title"><span>Disponibilidad Flota (OEE)</span> <i class="bi bi-shield-check" style="color: ${oeeColor};"></i></div>
          <div class="kpi-value" style="color: ${oeeColor};">${oeeAvailabilityPct}%</div>
        </div>
      `;
      }
      function promedio(arr) {
        if (!arr.length) return 0;
        return Math.round(arr.reduce((a, b) => a + b, 0) / arr.length);
      }
      function formateaTiempo(segundos) {
        if (isNaN(segundos) || segundos < 0) return "-";
        if (segundos < 60) return `${segundos}s`;
        const m = Math.floor(segundos / 60);
        const s = Math.round(segundos % 60);
        if (m < 60) return `${m}m ${s}s`;
        const h = Math.floor(m / 60);
        const mm = m % 60;
        return `${h}h ${mm}m ${s}s`;
      }

      // --- Gráficos ---
      let tendenciasChart,
        estadoChart,
        areaChart,
        tiempoResolucionChart,
        tiempoParadaChart,
        jornadaChart,
        topFallasChart,
        topOpsChart,
        topCranesChart,
        comparisonChart,
        patronesChart,
        comparisonJornadasChart;
      function renderCharts() {
        // Renderizando gráficos

        // 1. Gráfico de Tendencias Temporales
        renderTendenciasChart();

        // 2. Gráfico de Distribución por Estado
        renderEstadoChart();

        // 3. Gráfico de Fallas por Área
        renderAreaChart();

        // 4. Gráfico de Tiempos de Resolución
        renderTiempoResolucionChart();

        // 5. Gráfico de Tiempo de Parada por Máquina
        renderTiempoParadaChart();

        // 6. Gráfico de Eficiencia por Jornada
        renderJornadaChart();

        // 7. Top 10 Fallas Más Recurrentes
        renderTopFallasChart();

        // 8. Top 5 Operaciones
        renderTopOpsChart();

        // 9. Top 5 Grúas
        renderTopCranesChart();

        // 10. Gráfico de Comparación Operaciones vs Grúas
        renderComparisonChart();

        // 11. Gráfico de Patrones de Fallas
        renderPatronesChart();
      }

      // 1. Gráfico de Tendencias Temporales
      // IMPORTANTE: Este gráfico usa allData para mostrar tendencias a lo largo de varios días
      // porque necesita acceder a todos los datos históricos para mostrar la evolución temporal
      function renderTendenciasChart() {
        // Determinar el rango de fechas basado en los filtros aplicados
        let startDate, endDate;
        const today = window.getChihuahuaTime();

        // PRIORIDAD: Si hay filtro específico de tendencias activo, usar ese
        if (tendenciasFilterActive && tendenciasDateFrom && tendenciasDateTo) {
          startDate = new Date(tendenciasDateFrom);
          endDate = new Date(tendenciasDateTo);
          // Usando filtro específico de tendencias
        }
        // Si no hay filtro específico, usar los filtros generales
        else if (
          dateFromFilter &&
          dateFromFilter.value &&
          dateToFilter &&
          dateToFilter.value
        ) {
          // Si hay filtros de fecha específicos, usar esos
          startDate = new Date(dateFromFilter.value);
          endDate = new Date(dateToFilter.value);

          // Si es un solo día, extender a 7 días para mostrar tendencias
          const diffTime = Math.abs(endDate - startDate);
          const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
          if (diffDays === 0) {
            // Es un solo día, mostrar 7 días centrados en esa fecha
            startDate.setDate(startDate.getDate() - 3);
            endDate.setDate(endDate.getDate() + 3);
          }
        } else if (
          jornadaFilter &&
          jornadaFilter.value &&
          jornadaFilter.value !== "todas"
        ) {
          // Si hay una jornada específica seleccionada, mostrar los últimos 14 días para contexto
          startDate = new Date(today);
          startDate.setDate(startDate.getDate() - 13);
          endDate = new Date(today);
        } else {
          // Por defecto, usar los últimos 14 días para mejor visualización de tendencias
          startDate = new Date(today);
          startDate.setDate(startDate.getDate() - 13);
          endDate = new Date(today);
        }

        // Generar días en el rango
        const daysInRange = [];

        // Generar días en el rango
        if (tendenciasFilterActive && tendenciasDateFrom && tendenciasDateTo) {
          // Si hay filtro específico activo, usar las fechas exactas del filtro
          const currentDate = new Date(tendenciasDateFrom);
          const finalDate = new Date(tendenciasDateTo);
          finalDate.setHours(23, 59, 59, 999);

          while (currentDate <= finalDate) {
            daysInRange.push(currentDate.toISOString().split("T")[0]);
            currentDate.setDate(currentDate.getDate() + 1);
          }
        } else {
          // Si no hay filtro específico, generar semana completa de lunes a domingo centrada
          const monday = new Date(startDate);
          const dayOfWeek = startDate.getDay();
          // Calcular días hasta el lunes: si es domingo (0), retroceder 6 días; si no, retroceder (dayOfWeek - 1) días
          const daysToMonday = dayOfWeek === 0 ? -6 : -(dayOfWeek - 1);
          monday.setDate(startDate.getDate() + daysToMonday);

          // Generar exactamente 7 días (lunes a domingo)
          for (let i = 0; i < 7; i++) {
            const currentDay = new Date(monday);
            currentDay.setDate(monday.getDate() + i);
            daysInRange.push(currentDay.toISOString().split("T")[0]);
          }
        }

        // Log removido para limpiar consola

        // Obtener configuración global para filtrar por módulos habilitados
        const config = globalConfigManager
          ? globalConfigManager.getConfig()
          : { modules: { operations: true, cranes: true } };

        // Debug: Verificar filteredData
        // Logs removidos para limpiar consola

        // Debug: Verificar fallas activas en allData (todos los datos para tendencias)
        const fallasActivasAllData = allData.filter((d) => {
          let estado = (d.Estado || d.status || "")
            .toString()
            .trim()
            .toLowerCase();
          const esActiva =
            estado === "activa" || estado === "en falla" || estado === "active" || estado === "failed" || estado === "maintenance";

          // Solo considerar módulos habilitados
          const esOperacion = d.tipo === "operacion";
          const esGrua = d.tipo === "grua";
          const moduloHabilitado =
            (esOperacion && config.modules.operations) ||
            (esGrua && config.modules.cranes);

          return esActiva && moduloHabilitado;
        });
        // Logs removidos para limpiar consola

        // Debug: Verificar fechas de las fallas activas
        // Log removido para limpiar consola

        const tendenciasData = daysInRange.map((date) => {
          const dayStart = new Date(date + "T00:00:00");
          const dayEnd = new Date(date + "T23:59:59");

          // Log removido para limpiar consola

          // Usar allData para mostrar fallas del día (necesario para tendencias a lo largo de varios días)
          const fallasDelDia = allData.filter((d) => {
            // Solo considerar módulos habilitados
            const esOperacion = d.tipo === "operacion";
            const esGrua = d.tipo === "grua";
            const moduloHabilitado =
              (esOperacion && config.modules.operations) ||
              (esGrua && config.modules.cranes);

            if (!moduloHabilitado) {
              return false;
            }

            let timestamp = d.timestamp;
            if (timestamp && timestamp.toDate) timestamp = timestamp.toDate();
            else if (typeof timestamp === "string")
              timestamp = new Date(timestamp);
            else if (timestamp && timestamp.seconds)
              timestamp = new Date(timestamp.seconds * 1000);

            if (!timestamp) {
              // Para fallas sin timestamp, usar reportedAt o createdAt como fallback
              const fallbackTimestamp =
                d.reportedAt || d.createdAt || d.timestamp;
              if (!fallbackTimestamp) {
                return false;
              }
              timestamp = fallbackTimestamp;
            }

            // Asegurar que timestamp sea un objeto Date válido
            if (timestamp && timestamp.toDate) {
              timestamp = timestamp.toDate();
            } else if (timestamp && timestamp.seconds) {
              timestamp = new Date(timestamp.seconds * 1000);
            } else if (timestamp && !(timestamp instanceof Date)) {
              timestamp = new Date(timestamp);
            }

            // Verificar que el timestamp sea válido
            if (
              !timestamp ||
              !(timestamp instanceof Date) ||
              isNaN(timestamp)
            ) {
              return false;
            }

            const isInRange = timestamp >= dayStart && timestamp <= dayEnd;

            return isInRange;
          });

          const activas = fallasDelDia.filter((d) => {
            let estado = (d.Estado || d.status || "")
              .toString()
              .trim()
              .toLowerCase();
            const isActiva =
              estado === "activa" ||
              estado === "en falla" ||
              estado === "active" ||
              estado === "failed" ||
              estado === "maintenance";

            // Una falla es activa solo si NO tiene resolvedAt
            const tieneResolucion = d.resolvedAt && d.resolvedAt.toDate;
            const esRealmenteActiva = isActiva && !tieneResolucion;

            // Falla procesada

            return esRealmenteActiva;
          }).length;

          const resueltas = fallasDelDia.filter((d) => {
            let estado = (d.Estado || d.status || "")
              .toString()
              .trim()
              .toLowerCase();
            const isResuelta =
              estado === "resuelta" ||
              estado === "resuelto" ||
              estado === "resolved";

            // Una falla es resuelta si tiene resolvedAt O si el estado es resuelto
            const tieneResolucion = d.resolvedAt && d.resolvedAt.toDate;
            const esRealmenteResuelta = isResuelta || tieneResolucion;

            // Falla resuelta procesada

            return esRealmenteResuelta;
          }).length;

          // Resumen diario procesado

          return {
            date: date,
            total: fallasDelDia.length,
            activas: activas,
            resueltas: resueltas,
          };
        });

        renderOrUpdateChart(
          "tendenciasChart",
          tendenciasChart,
          {
            type: "line",
            data: {
              labels: daysInRange.map((date) =>
                new Date(date).toLocaleDateString("es-MX", {
                  weekday: "short",
                  month: "short",
                  day: "numeric",
                }),
              ),
              datasets: [
                {
                  label: "Total Fallas",
                  data: tendenciasData.map((d) => d.total),
                  borderColor: "rgb(75, 192, 192)",
                  backgroundColor: "rgba(75, 192, 192, 0.2)",
                  tension: 0.4,
                  fill: true,
                },
                {
                  label: "Fallas Activas",
                  data: tendenciasData.map((d) => d.activas),
                  borderColor: "rgb(255, 99, 132)",
                  backgroundColor: "rgba(255, 99, 132, 0.2)",
                  tension: 0.4,
                },
                {
                  label: "Fallas Resueltas",
                  data: tendenciasData.map((d) => d.resueltas),
                  borderColor: "rgb(54, 162, 235)",
                  backgroundColor: "rgba(54, 162, 235, 0.2)",
                  tension: 0.4,
                },
              ],
            },
            options: {
              responsive: true,
              plugins: {
                legend: {
                  position: "top",
                },
                title: {
                  display: true,
                  text: (() => {
                    if (
                      tendenciasFilterActive &&
                      tendenciasDateFrom &&
                      tendenciasDateTo
                    ) {
                      // Si hay filtro específico, mostrar las fechas exactas del filtro
                      const filterStartDate = new Date(tendenciasDateFrom);
                      const filterEndDate = new Date(tendenciasDateTo);
                      return `Tendencias de Fallas - ${filterStartDate.toLocaleDateString("es-MX")} a ${filterEndDate.toLocaleDateString("es-MX")} (Filtro Específico)`;
                    } else {
                      // Si no hay filtro, mostrar la semana completa centrada
                      const monday = new Date(daysInRange[0]);
                      const sunday = new Date(daysInRange[6]);
                      return `Tendencias de Fallas - ${monday.toLocaleDateString("es-MX")} a ${sunday.toLocaleDateString("es-MX")} (Semana Completa)`;
                    }
                  })(),
                },
              },
              scales: {
                y: {
                  beginAtZero: true,
                  ticks: {
                    stepSize: 1,
                  },
                },
              },
            },
          },
          (c) => (tendenciasChart = c),
        );
      }

      // 2. Gráfico de Distribución por Estado
      function renderEstadoChart() {
        const estadoLabels = ["Activa", "Resuelta"];
        const estadoCounts = [0, 0];

        filteredData.forEach((d) => {
          let estado = (d.Estado || d.status || "")
            .toString()
            .trim()
            .toLowerCase();
          if (
            estado === "activa" ||
            estado === "en falla" ||
            estado === "active" ||
            estado === "failed" ||
            estado === "maintenance"
          ) {
            estadoCounts[0]++;
          } else if (
            estado === "resuelta" ||
            estado === "resuelto" ||
            estado === "resolved"
          ) {
            estadoCounts[1]++;
          }
        });

        const totalEstados = estadoCounts.reduce((a, b) => a + b, 0);
        const estadoChartMsg = document.getElementById("estadoChartMsg");
        if (totalEstados === 0) {
          estadoChartMsg.textContent = "No hay datos para mostrar.";
        } else {
          estadoChartMsg.textContent = "";
        }

        renderOrUpdateChart(
          "estadoChart",
          estadoChart,
          {
            type: "doughnut",
            data: {
              labels: estadoLabels,
              datasets: [
                {
                  data: estadoCounts,
                  backgroundColor: ["#ff6b6b", "#51cf66"],
                  borderWidth: 2,
                  borderColor: "#fff",
                },
              ],
            },
            options: {
              plugins: {
                legend: {
                  position: "bottom",
                },
                tooltip: {
                  callbacks: {
                    label: function (context) {
                      const label = context.label || "";
                      const value = context.parsed;
                      const total = context.dataset.data.reduce(
                        (a, b) => a + b,
                        0,
                      );
                      const percentage = ((value / total) * 100).toFixed(1);
                      return `${label}: ${value} (${percentage}%)`;
                    },
                  },
                },
              },
              onClick: (event, elements) => {
                if (elements.length > 0) {
                  const index = elements[0].index;
                  const estado = estadoLabels[index];
                  const count = estadoCounts[index];
                  mostrarDetallesEstado(estado, count, filteredData);
                }
              },
            },
          },
          (c) => (estadoChart = c),
        );
      }

      // 3. Gráfico de Fallas por Área
      function renderAreaChart() {
        const areasData = {};

        filteredData.forEach((d) => {
          const area = d.area || d.Área || "Sin área";
          if (!areasData[area]) {
            areasData[area] = { total: 0, activas: 0, resueltas: 0 };
          }
          areasData[area].total++;
          if (d.Estado === "ACTIVA") areasData[area].activas++;
          else if (d.Estado === "Resuelta") areasData[area].resueltas++;
        });

        const sortedAreas = Object.entries(areasData)
          .sort(([, a], [, b]) => b.total - a.total)
          .slice(0, 10);

        renderOrUpdateChart(
          "areaChart",
          areaChart,
          {
            type: "bar",
            data: {
              labels: sortedAreas.map(([area]) => `Área ${area}`),
              datasets: [
                {
                  label: "Activas",
                  data: sortedAreas.map(([, data]) => data.activas),
                  backgroundColor: "rgba(255, 99, 132, 0.8)",
                },
                {
                  label: "Resueltas",
                  data: sortedAreas.map(([, data]) => data.resueltas),
                  backgroundColor: "rgba(54, 162, 235, 0.8)",
                },
              ],
            },
            options: {
              responsive: true,
              plugins: {
                legend: {
                  position: "top",
                },
              },
              scales: {
                x: {
                  stacked: true,
                },
                y: {
                  stacked: true,
                  beginAtZero: true,
                },
              },
            },
          },
          (c) => (areaChart = c),
        );
      }

      // 4. Gráfico de Tiempos de Resolución
      function renderTiempoResolucionChart() {
        const tiemposResueltos = filteredData.filter((d) => {
          // Verificar si es una falla resuelta
          const isResolved =
            d.Estado === "resuelta" ||
            d.status === "resuelta" ||
            d.resolvedAt ||
            d.resolved;
          const hasTimestamp = d.timestamp || d.ri;
          // Falla procesada
          return isResolved && hasTimestamp;
        });

        const tiemposConDetalles = tiemposResueltos.map((d) => {
          let start = d.timestamp || d.ri;
          let end = d.resolvedAt || d.resolved;
          if (start && start.toDate) start = start.toDate();
          else if (typeof start === "string") start = new Date(start);
          else if (start && start.seconds)
            start = new Date(start.seconds * 1000);
          if (end && end.toDate) end = end.toDate();
          else if (typeof end === "string") end = new Date(end);
          else if (end && end.seconds) end = new Date(end.seconds * 1000);

          const tiempoSegundos = (end - start) / 1000;

          return {
            tiempo: tiempoSegundos,
            datos: d,
            start: start,
            end: end,
          };
        });

        // Categorizar tiempos
        const categorias = {
          "0-1h": tiemposConDetalles.filter((t) => t.tiempo <= 3600),
          "1-4h": tiemposConDetalles.filter(
            (t) => t.tiempo > 3600 && t.tiempo <= 14400,
          ),
          "4-8h": tiemposConDetalles.filter(
            (t) => t.tiempo > 14400 && t.tiempo <= 28800,
          ),
          "8-24h": tiemposConDetalles.filter(
            (t) => t.tiempo > 28800 && t.tiempo <= 86400,
          ),
          ">24h": tiemposConDetalles.filter((t) => t.tiempo > 86400),
        };

        renderOrUpdateChart(
          "tiempoResolucionChart",
          tiempoResolucionChart,
          {
            type: "pie",
            data: {
              labels: Object.keys(categorias),
              datasets: [
                {
                  data: Object.values(categorias).map((cat) => cat.length),
                  backgroundColor: [
                    "#51cf66", // Verde para rápido
                    "#ffd43b", // Amarillo
                    "#ff8cc8", // Rosa
                    "#ff6b6b", // Rojo
                    "#868e96", // Gris para muy lento
                  ],
                },
              ],
            },
            options: {
              plugins: {
                legend: {
                  position: "bottom",
                },
              },
              onClick: (event, elements) => {
                if (elements.length > 0) {
                  const index = elements[0].index;
                  const categoria = Object.keys(categorias)[index];
                  const fallas = categorias[categoria];
                  mostrarDetallesTiempoResolucion(categoria, fallas);
                }
              },
            },
          },
          (c) => (tiempoResolucionChart = c),
        );
      }

      // 5. Gráfico de Tiempo de Parada por Máquina
      // IMPORTANTE: Este gráfico muestra TODAS las fallas activas independientemente de la jornada
      // porque las fallas activas deben mantenerse visibles en todas las jornadas
      function renderTiempoParadaChart() {
        // Actualizar título dinámico según filtros
        const config = globalConfigManager
          ? globalConfigManager.getConfig()
          : { modules: { operations: true, cranes: true } };
        const titleElement = document.getElementById("tiempoParadaChartTitle");

        if (config.modules.operations && config.modules.cranes) {
          titleElement.textContent = "⏰ Máquinas con Mayor Tiempo de Parada";
        } else if (config.modules.operations && !config.modules.cranes) {
          titleElement.textContent =
            "⏰ Operaciones con Mayor Tiempo de Parada";
        } else if (!config.modules.operations && config.modules.cranes) {
          titleElement.textContent = "⏰ Grúas con Mayor Tiempo de Falla";
        } else {
          titleElement.textContent = "⏰ Máquinas con Mayor Tiempo de Parada";
        }

        // Obtener máquinas activas (tanto operaciones como grúas)
        // IMPORTANTE: Para fallas activas, usar allData para mostrar TODAS las fallas activas
        // independientemente de la jornada seleccionada, porque las fallas activas deben
        // mantenerse visibles en todas las jornadas hasta que se resuelvan
        // Buscando fallas activas

        const maquinasActivas = allData.filter((d) => {
          const esOperacion = d.tipo === "operacion";
          const esGrua = d.tipo === "grua";
          const moduloHabilitado =
            (esOperacion && config.modules.operations) ||
            (esGrua && config.modules.cranes);

          if (!moduloHabilitado) return false;

          // Solo fallas activas
          let estado = (d.Estado || d.status || "")
            .toString()
            .trim()
            .toLowerCase();
          const isActiva =
            estado === "activa" || estado === "en falla" || estado === "active" || estado === "failed" || estado === "maintenance";
          const tieneResolucion = d.resolvedAt && d.resolvedAt.toDate;
          return isActiva && !tieneResolucion;
        });

        // Fallas activas procesadas

        // Calcular tiempo de parada para cada máquina
        const tiemposParada = maquinasActivas
          .map((d) => {
            // Obtener timestamp de inicio (usar fallback)
            let timestamp = d.timestamp || d.reportedAt || d.createdAt;

            // Convertir timestamp a Date
            if (timestamp && timestamp.toDate) {
              timestamp = timestamp.toDate();
            } else if (timestamp && timestamp.seconds) {
              timestamp = new Date(timestamp.seconds * 1000);
            } else if (timestamp && !(timestamp instanceof Date)) {
              timestamp = new Date(timestamp);
            }

            if (
              !timestamp ||
              !(timestamp instanceof Date) ||
              isNaN(timestamp)
            ) {
              return null;
            }

            const ahora = window.getChihuahuaTime();
            const tiempoParadaSegundos = Math.max(
              0,
              (ahora - timestamp) / 1000,
            );
            const tiempoParadaHoras = tiempoParadaSegundos / 3600;

            // Tiempo de parada calculado

            return {
              id: d.operationId || d.craneId || d.id || "N/A",
              descripcion: d.description || d.Descripción || "Sin descripción",
              tipo: d.tipo === "operacion" ? "Operación" : "Grúa",
              area: d.area || d.Área || "N/A",
              tiempoSegundos: tiempoParadaSegundos,
              tiempoHoras: tiempoParadaHoras,
              datos: d,
            };
          })
          .filter((item) => item !== null);

        // Ordenar por tiempo de parada (mayor a menor) y tomar los primeros 10
        const topMaquinas = tiemposParada
          .sort((a, b) => b.tiempoHoras - a.tiempoHoras)
          .slice(0, 10);

        if (topMaquinas.length === 0) {
          // Mostrar gráfico vacío si no hay máquinas activas
          renderOrUpdateChart(
            "tiempoParadaChart",
            tiempoParadaChart,
            {
              type: "bar",
              data: {
                labels: ["Sin datos"],
                datasets: [
                  {
                    label: "Tiempo de Parada (horas)",
                    data: [0],
                    backgroundColor: "rgba(128, 128, 128, 0.3)",
                    borderColor: "rgba(128, 128, 128, 0.8)",
                    borderWidth: 1,
                  },
                ],
              },
              options: {
                responsive: true,
                plugins: {
                  legend: {
                    position: "top",
                  },
                  title: {
                    display: true,
                    text: `No hay ${
                      config.modules.operations && config.modules.cranes
                        ? "máquinas"
                        : config.modules.operations
                          ? "operaciones"
                          : "grúas"
                    } con fallas activas`,
                  },
                },
                scales: {
                  y: {
                    beginAtZero: true,
                    title: {
                      display: true,
                      text: "Horas",
                    },
                  },
                },
              },
            },
            (c) => (tiempoParadaChart = c),
          );
          return;
        }

        // Generar colores según el tiempo de parada (más sensible y distintivos)
        const colores = topMaquinas.map((item) => {
          const minutos = item.tiempoSegundos / 60;
          if (minutos >= 60) return "rgba(139, 0, 0, 0.9)"; // Rojo intenso (dark red) para +1h
          if (minutos >= 30) return "rgba(255, 0, 0, 0.8)"; // Rojo puro para +30min
          if (minutos >= 10) return "rgba(255, 140, 0, 0.8)"; // Naranja para +10min
          if (minutos >= 5) return "rgba(255, 215, 0, 0.8)"; // Amarillo dorado para +5min
          return "rgba(0, 128, 0, 0.8)"; // Verde para <5min
        });

        // Colores y datos procesados

        renderOrUpdateChart(
          "tiempoParadaChart",
          tiempoParadaChart,
          {
            type: "bar",
            data: {
              labels: topMaquinas.map((item) => `${item.tipo} ${item.id}`),
              datasets: [
                {
                  label: "Tiempo de Parada (horas)",
                  data: topMaquinas.map((item) => item.tiempoHoras.toFixed(1)),
                  backgroundColor: colores,
                  borderColor: colores.map((color) =>
                    color.replace("0.8", "1"),
                  ),
                  borderWidth: 1,
                },
              ],
            },
            options: {
              responsive: true,
              plugins: {
                legend: {
                  position: "top",
                },
                title: {
                  display: true,
                  text: titleElement.textContent.replace("⏰ ", ""),
                },
                tooltip: {
                  callbacks: {
                    afterLabel: function (context) {
                      const item = topMaquinas[context.dataIndex];
                      return [
                        `Área: ${item.area}`,
                        `Descripción: ${item.descripcion}`,
                        `Tiempo: ${formateaTiempo(item.tiempoSegundos)}`,
                      ];
                    },
                  },
                },
              },
              scales: {
                y: {
                  beginAtZero: true,
                  title: {
                    display: true,
                    text: "Horas",
                  },
                },
                x: {
                  ticks: {
                    maxRotation: 45,
                    minRotation: 45,
                  },
                },
              },
              onClick: (event, elements) => {
                if (elements.length > 0) {
                  const index = elements[0].index;
                  const maquina = topMaquinas[index];
                  mostrarDetallesParada(maquina);
                }
              },
            },
          },
          (c) => (tiempoParadaChart = c),
        );
      }

      // Función para obtener nombre del técnico o operador desde el número
      const getTechnicianName = async (phoneNumber) => {
        if (!phoneNumber) return "Sistema";

        // Si ya es un nombre (no solo números), devolverlo
        if (!/^\+?[0-9\s\-\(\)]+$/.test(phoneNumber)) {
          return phoneNumber;
        }

        try {
          // Normalizar el número de teléfono para búsqueda
          const normalizedPhone = phoneNumber.replace(/[^\d]/g, ""); // Solo números

          // Función para buscar en una lista de personas
          const searchInList = (list, listName) => {
            if (!Array.isArray(list)) return null;

            for (let i = 0; i < list.length; i++) {
              const person = list[i];

              if (person.phone) {
                const personPhoneNormalized = person.phone.replace(
                  /[^\d]/g,
                  "",
                );

                // Buscar coincidencia exacta o con diferentes formatos
                if (
                  personPhoneNormalized === normalizedPhone ||
                  personPhoneNormalized.endsWith(normalizedPhone) ||
                  normalizedPhone.endsWith(personPhoneNormalized)
                ) {
                  return person.name;
                }
              }
            }
            return null;
          };

          // Primero, buscar en técnicos
          const techDoc = await db
            .collection("config")
            .doc("technicians")
            .get();
          if (techDoc.exists) {
            const techData = techDoc.data();

            // Buscar en todas las áreas y turnos para técnicos
            for (const areaKey of Object.keys(techData)) {
              const areaData = techData[areaKey];

              for (const shiftKey of Object.keys(areaData)) {
                const shiftData = areaData[shiftKey];

                // Nueva estructura con nombres
                if (
                  shiftData &&
                  shiftData.technicians &&
                  Array.isArray(shiftData.technicians)
                ) {
                  const foundName = searchInList(
                    shiftData.technicians,
                    "Técnico",
                  );
                  if (foundName) return foundName;
                }
              }
            }
          }

          // Si no se encuentra en técnicos, buscar en operadores
          const operatorsDoc = await db
            .collection("config")
            .doc("operators")
            .get();
          if (operatorsDoc.exists) {
            const operatorsData = operatorsDoc.data();

            // Buscar en todos los turnos para operadores
            for (const shiftKey of Object.keys(operatorsData)) {
              const shiftOperators = operatorsData[shiftKey];

              const foundName = searchInList(shiftOperators, "Operador");
              if (foundName) return foundName;
            }
          }

          // Si no se encuentra en ninguno, devolver nombre por defecto
          return `Técnico ${phoneNumber.slice(-4)}`;
        } catch (error) {
          console.error("Error getting technician/operator name:", error);
          return `Técnico ${phoneNumber.slice(-4)}`;
        }
      };

      // Función para mostrar detalles de máquina con tiempo de parada
      async function mostrarDetallesParada(maquina) {
        const modal = new bootstrap.Modal(
          document.getElementById("detallesModal"),
        );
        const title = document.getElementById("detallesModalTitle");
        const body = document.getElementById("detallesModalBody");

        title.textContent = `Detalles - ${maquina.tipo} ${maquina.id}`;

        // Obtener nombres de reportado por y resuelto por
        const reportedByName = await getTechnicianName(
          maquina.datos.reportedBy || maquina.datos.reportadoPor || "Sistema",
        );
        const resolvedByName = maquina.datos.resolvedBy
          ? await getTechnicianName(maquina.datos.resolvedBy)
          : null;

        const html = `
        <div class="row mb-3">
          <div class="col-md-6">
            <h6>Información de la Máquina</h6>
            <p><strong>ID:</strong> ${maquina.id}</p>
            <p><strong>Tipo:</strong> ${maquina.tipo}</p>
            <p><strong>Área:</strong> ${maquina.area}</p>
          </div>
          <div class="col-md-6">
            <h6>Tiempo de Parada</h6>
            <p><strong>Tiempo Total:</strong> <span class="badge bg-danger">${formateaTiempo(maquina.tiempoSegundos)}</span></p>
            <p><strong>Horas:</strong> ${maquina.tiempoHoras.toFixed(1)} h</p>
            <p><strong>Estado:</strong> <span class="badge bg-danger">Falla Activa</span></p>
          </div>
        </div>
        <div class="mb-3">
          <h6>Descripción de la Falla</h6>
          <p class="alert alert-warning">${maquina.descripcion}</p>
        </div>
        <div class="row">
          <div class="col-md-6">
            <h6>Información del Reporte</h6>
            <p><strong>Reportado por:</strong> ${reportedByName}</p>
            <p><strong>Fecha del Reporte:</strong> ${formatFecha(maquina.datos.timestamp || maquina.datos.reportedAt || maquina.datos.createdAt)}</p>
            ${resolvedByName ? `<p><strong>Resuelto por:</strong> ${resolvedByName}</p>` : ""}
          </div>
          <div class="col-md-6">
            <h6>Prioridad de Atención</h6>
            <p><strong>Nivel:</strong> 
              ${
                maquina.tiempoSegundos >= 3600
                  ? '<span class="badge bg-danger">CRÍTICO</span>'
                  : maquina.tiempoSegundos >= 1800
                    ? '<span class="badge bg-warning">ALTO</span>'
                    : maquina.tiempoSegundos >= 600
                      ? '<span class="badge bg-info">MEDIO</span>'
                      : maquina.tiempoSegundos >= 300
                        ? '<span class="badge bg-warning">BAJO</span>'
                        : '<span class="badge bg-success">NORMAL</span>'
              }
            </p>
            <p><strong>Recomendación:</strong> 
              ${
                maquina.tiempoSegundos >= 3600
                  ? "Atención inmediata requerida"
                  : maquina.tiempoSegundos >= 1800
                    ? "Programar reparación urgente"
                    : maquina.tiempoSegundos >= 600
                      ? "Programar reparación pronto"
                      : maquina.tiempoSegundos >= 300
                        ? "Monitorear de cerca"
                        : "Situación normal"
              }
            </p>
          </div>
        </div>
      `;

        body.innerHTML = html;
        modal.show();
      }

      // 6. Gráfico de Eficiencia por Jornada
      function renderJornadaChart() {
        // Renderizando gráfico de jornadas

        const jornadas = ["A", "B", "C", "D"];
        const jornadaData = jornadas.map((jornada) => {
          // Calcular el rango de tiempo para cada jornada específica
          const now = window.getChihuahuaTime();
          let start, end;

          if (jornada === "A") {
            // Jornada A: Lunes-Miércoles 6:00-18:00
            start = new Date(now);
            start.setHours(6, 0, 0, 0);
            end = new Date(now);
            end.setHours(18, 0, 0, 0);
          } else if (jornada === "B") {
            // Jornada B: Jueves-Domingo 6:00-18:00
            start = new Date(now);
            start.setHours(6, 0, 0, 0);
            end = new Date(now);
            end.setHours(18, 0, 0, 0);
          } else if (jornada === "C") {
            // Jornada C: Lunes-Miércoles 18:00-6:00
            start = new Date(now);
            start.setHours(18, 0, 0, 0);
            end = new Date(now);
            end.setDate(end.getDate() + 1);
            end.setHours(6, 0, 0, 0);
          } else if (jornada === "D") {
            // Jornada D: Jueves-Domingo 18:00-6:00
            start = new Date(now);
            start.setHours(18, 0, 0, 0);
            end = new Date(now);
            end.setDate(end.getDate() + 1);
            end.setHours(6, 0, 0, 0);
          }

          // Usar filteredData para obtener las fallas filtradas por el usuario
          const fallasJornada = filteredData.filter((d) => {
            let timestamp = d.timestamp || d.ri;
            if (timestamp && timestamp.toDate) timestamp = timestamp.toDate();
            else if (typeof timestamp === "string")
              timestamp = new Date(timestamp);
            else if (timestamp && timestamp.seconds)
              timestamp = new Date(timestamp.seconds * 1000);

            if (!timestamp) return false;

            // Verificar si la falla ocurrió en esta jornada
            const fallaHora = timestamp.getHours();
            const fallaDia = timestamp.getDay();

            if (jornada === "A" || jornada === "C") {
              // Lunes(1), Martes(2), Miércoles(3)
              if (![1, 2, 3].includes(fallaDia)) return false;
            } else if (jornada === "B" || jornada === "D") {
              // Jueves(4), Viernes(5), Sábado(6), Domingo(0)
              if (![0, 4, 5, 6].includes(fallaDia)) return false;
            }

            if (jornada === "A" || jornada === "B") {
              // Jornadas diurnas: 6:00-18:00
              return fallaHora >= 6 && fallaHora < 18;
            } else if (jornada === "C" || jornada === "D") {
              // Jornadas nocturnas: 18:00-6:00
              return fallaHora >= 18 || fallaHora < 6;
            }

            return false;
          });

          const resueltas = fallasJornada.filter((d) => {
            let estado = (d.Estado || d.status || "")
              .toString()
              .trim()
              .toLowerCase();
            return (
              estado === "resuelta" ||
              estado === "resuelto" ||
              estado === "resolved"
            );
          }).length;
          const total = fallasJornada.length;
          const eficiencia = total > 0 ? (resueltas / total) * 100 : 0;

          // Jornada procesada

          return {
            jornada,
            total,
            resueltas,
            eficiencia: Math.round(eficiencia),
          };
        });

        renderOrUpdateChart(
          "jornadaChart",
          jornadaChart,
          {
            type: "bar",
            data: {
              labels: jornadas.map((j) => `Jornada ${j}`),
              datasets: [
                {
                  label: "Total Fallas",
                  data: jornadaData.map((d) => d.total),
                  backgroundColor: "rgba(54, 162, 235, 0.8)",
                },
                {
                  label: "Eficiencia (%)",
                  data: jornadaData.map((d) => d.eficiencia),
                  backgroundColor: "rgba(75, 192, 192, 0.8)",
                  yAxisID: "y1",
                },
              ],
            },
            options: {
              responsive: true,
              plugins: {
                legend: {
                  position: "top",
                },
              },
              scales: {
                y: {
                  type: "linear",
                  display: true,
                  position: "left",
                  beginAtZero: true,
                },
                y1: {
                  type: "linear",
                  display: true,
                  position: "right",
                  beginAtZero: true,
                  max: 100,
                  grid: {
                    drawOnChartArea: false,
                  },
                },
              },
            },
          },
          (c) => (jornadaChart = c),
        );
      }

      // 6. Top 10 Fallas Más Recurrentes
      function renderTopFallasChart() {
        const topFallas = topByKey(
          filteredData,
          (d) => d.description || d.Descripción,
          10,
        );

        renderOrUpdateChart(
          "topFallasChart",
          topFallasChart,
          {
            type: "bar",
            data: {
              labels: topFallas.map((item) =>
                item.key.length > 30
                  ? item.key.substring(0, 30) + "..."
                  : item.key,
              ),
              datasets: [
                {
                  label: "Ocurrencias",
                  data: topFallas.map((item) => item.count),
                  backgroundColor: "rgba(255, 159, 64, 0.8)",
                  borderColor: "rgba(255, 159, 64, 1)",
                  borderWidth: 1,
                },
              ],
            },
            options: {
              indexAxis: "y",
              responsive: true,
              plugins: {
                legend: {
                  display: false,
                },
              },
              scales: {
                x: {
                  beginAtZero: true,
                },
              },
              onClick: (event, elements) => {
                if (elements.length > 0) {
                  const index = elements[0].index;
                  const falla = topFallas[index].key;
                  const count = topFallas[index].count;
                  mostrarDetallesFalla(falla, count, filteredData);
                }
              },
            },
          },
          (c) => (topFallasChart = c),
        );
      }

      // 7. Top 5 Operaciones
      function renderTopOpsChart() {
        const operacionesData = filteredData.filter(
          (d) => d.tipo === "operacion",
        );
        const topOps = topByKey(
          operacionesData,
          (d) => d.operationId || d.id,
          5,
        );
        const topOpsLabels = topOps.map((item) => item.key);
        const topOpsCounts = topOps.map((item) => item.count);

        renderOrUpdateChart(
          "topOpsChart",
          topOpsChart,
          {
            type: "bar",
            data: {
              labels: topOpsLabels.length > 0 ? topOpsLabels : ["Sin datos"],
              datasets: [
                {
                  label: "Fallas",
                  data: topOpsCounts.length > 0 ? topOpsCounts : [0],
                  backgroundColor: "#3498db",
                  borderColor: "#2980b9",
                  borderWidth: 1,
                },
              ],
            },
            options: {
              responsive: true,
              maintainAspectRatio: false,
              plugins: {
                legend: { display: false },
                tooltip: {
                  callbacks: {
                    label: function (context) {
                      return `Fallas: ${context.parsed.y}`;
                    },
                  },
                },
              },
              scales: {
                y: {
                  beginAtZero: true,
                  ticks: {
                    stepSize: 1,
                  },
                },
              },
              onClick: (event, elements) => {
                if (elements.length > 0) {
                  const index = elements[0].index;
                  const operacion = topOpsLabels[index];
                  const count = topOpsCounts[index];
                  mostrarDetallesOperacion(operacion, count, filteredData);
                }
              },
            },
          },
          (c) => (topOpsChart = c),
        );
      }

      // 8. Top 5 Grúas
      function renderTopCranesChart() {
        const gruasData = filteredData.filter((d) => d.tipo === "grua");
        const topCranes = topByKey(gruasData, (d) => d.craneId || d.id, 5);
        const topCranesLabels = topCranes.map((item) => item.key);
        const topCranesCounts = topCranes.map((item) => item.count);

        renderOrUpdateChart(
          "topCranesChart",
          topCranesChart,
          {
            type: "bar",
            data: {
              labels:
                topCranesLabels.length > 0 ? topCranesLabels : ["Sin datos"],
              datasets: [
                {
                  label: "Fallas",
                  data: topCranesCounts.length > 0 ? topCranesCounts : [0],
                  backgroundColor: "#e67e22",
                  borderColor: "#d35400",
                  borderWidth: 1,
                },
              ],
            },
            options: {
              responsive: true,
              maintainAspectRatio: false,
              plugins: {
                legend: { display: false },
                title: {
                  display: true,
                  text: "Top 5 Grúas con Más Fallas Registradas",
                },
                tooltip: {
                  callbacks: {
                    label: function (context) {
                      return `Fallas: ${context.parsed.y}`;
                    },
                  },
                },
              },
              scales: {
                y: {
                  beginAtZero: true,
                  ticks: {
                    stepSize: 1,
                  },
                },
              },
              onClick: (event, elements) => {
                if (elements.length > 0) {
                  const index = elements[0].index;
                  const grua = topCranesLabels[index];
                  const count = topCranesCounts[index];
                  mostrarDetallesGrua(grua, count, filteredData);
                }
              },
            },
          },
          (c) => (topCranesChart = c),
        );
      }

      // 9. Gráfico de Comparación Operaciones vs Grúas
      function renderComparisonChart() {
        const operaciones = filteredData.filter((d) => d.tipo === "operacion");
        const gruas = filteredData.filter((d) => d.tipo === "grua");

        const comparisonData = {
          operaciones: {
            total: operaciones.length,
            activas: operaciones.filter((d) => d.Estado === "ACTIVA").length,
            resueltas: operaciones.filter((d) => d.Estado === "Resuelta")
              .length,
          },
          gruas: {
            total: gruas.length,
            activas: gruas.filter((d) => d.Estado === "ACTIVA").length,
            resueltas: gruas.filter((d) => d.Estado === "Resuelta").length,
          },
        };

        renderOrUpdateChart(
          "comparisonChart",
          comparisonChart,
          {
            type: "bar",
            data: {
              labels: ["Operaciones", "Grúas"],
              datasets: [
                {
                  label: "Total",
                  data: [
                    comparisonData.operaciones.total,
                    comparisonData.gruas.total,
                  ],
                  backgroundColor: "rgba(54, 162, 235, 0.8)",
                },
                {
                  label: "Activas",
                  data: [
                    comparisonData.operaciones.activas,
                    comparisonData.gruas.activas,
                  ],
                  backgroundColor: "rgba(255, 99, 132, 0.8)",
                },
                {
                  label: "Resueltas",
                  data: [
                    comparisonData.operaciones.resueltas,
                    comparisonData.gruas.resueltas,
                  ],
                  backgroundColor: "rgba(75, 192, 192, 0.8)",
                },
              ],
            },
            options: {
              responsive: true,
              plugins: {
                legend: {
                  position: "top",
                },
              },
              scales: {
                y: {
                  beginAtZero: true,
                },
              },
            },
          },
          (c) => (comparisonChart = c),
        );
      }

      // 10. Gráfico de Patrones de Fallas
      function renderPatronesChart() {
        // Renderizando gráfico de patrones

        const horas = Array.from({ length: 24 }, (_, i) => i);
        const patronesData = horas.map((hora) => {
          const fallasHora = filteredData.filter((d) => {
            let timestamp = d.timestamp || d.ri;
            if (timestamp && timestamp.toDate) timestamp = timestamp.toDate();
            else if (typeof timestamp === "string")
              timestamp = new Date(timestamp);
            else if (timestamp && timestamp.seconds)
              timestamp = new Date(timestamp.seconds * 1000);

            const matches = timestamp && timestamp.getHours() === hora;
            if (matches) {
              // Falla encontrada en hora
            }
            // Debug de hora específica removido
            return matches;
          });

          // Fallas por hora procesadas
          return fallasHora.length;
        });

        // Patrones procesados

        renderOrUpdateChart(
          "patronesChart",
          patronesChart,
          {
            type: "line",
            data: {
              labels: horas.map((h) => `${h}:00`),
              datasets: [
                {
                  label: "Fallas por Hora",
                  data: patronesData,
                  borderColor: "rgb(255, 99, 132)",
                  backgroundColor: "rgba(255, 99, 132, 0.2)",
                  tension: 0.4,
                  fill: true,
                },
              ],
            },
            options: {
              responsive: true,
              plugins: {
                legend: {
                  display: false,
                },
              },
              scales: {
                y: {
                  beginAtZero: true,
                },
              },
            },
          },
          (c) => (patronesChart = c),
        );
      }
      function topByKey(arr, keyFn, topN) {
        // Logs removidos para limpiar consola

        if (!arr || arr.length === 0) {
          return [];
        }

        const counts = {};
        arr.forEach((d, index) => {
          const key = typeof keyFn === "function" ? keyFn(d) : d[keyFn];
          // Log removido
          if (!key || key === "undefined" || key === "null") {
            return;
          }
          counts[key] = (counts[key] || 0) + 1;
        });

        // Log removido
        const result = Object.entries(counts)
          .map(([key, count]) => ({ key, count }))
          .sort((a, b) => b.count - a.count)
          .slice(0, topN);

        // Log removido
        return result;
      }
      function renderOrUpdateChart(id, chart, config, setChart) {
        try {
          const canvas = document.getElementById(id);
          if (!canvas) {
            console.error(`renderOrUpdateChart - Canvas ${id} no encontrado`);
            return;
          }

          const ctx = canvas.getContext("2d");
          if (!ctx) {
            console.error(
              `renderOrUpdateChart - No se pudo obtener contexto 2D para ${id}`,
            );
            return;
          }

          // Si el chart ya existe, actualizar datos en lugar de recrear
          if (chart) {
            // Actualizar datos manteniendo la estructura completa
            chart.data = config.data;
            chart.options = {
              ...chart.options,
              ...config.options,
            };

            // Aplicar colores para gráficos de barras
            if (config.data.datasets && config.type === "bar") {
              config.data.datasets.forEach((dataset, index) => {
                if (chart.data.datasets[index]) {
                  chart.data.datasets[index].backgroundColor =
                    dataset.backgroundColor;
                  chart.data.datasets[index].borderColor = dataset.borderColor;
                  chart.data.datasets[index].borderWidth = dataset.borderWidth;
                }
              });
            }

            chart.update("none"); // Sin animación para evitar bucles
            return;
          }

          // Solo crear nuevo chart si no existe
          const newChart = new Chart(ctx, {
            ...config,
            options: {
              ...config.options,
              animation: {
                duration: 1000, // Animación inicial de 1 segundo
                easing: "easeInOutQuart",
              },
              responsive: true,
              maintainAspectRatio: false,
            },
          });
          setChart(newChart);
          // Chart creado exitosamente
        } catch (error) {
          console.error(
            `renderOrUpdateChart - Error creando chart ${id}:`,
            error,
          );
        }
      }
      function renderTable() {
        const tbody = document.querySelector("#tablaFallas tbody");
        tbody.innerHTML = "";
        // Ordenar por área (numérico), luego tipo, luego estado
        const sorted = [...filteredData].sort((a, b) => {
          const areaA = parseInt(a.area || a.Área || "0");
          const areaB = parseInt(b.area || b.Área || "0");
          if (areaA !== areaB) return areaA - areaB;
          if ((a.tipo || "") < (b.tipo || "")) return -1;
          if ((a.tipo || "") > (b.tipo || "")) return 1;
          const ordenEstado = {
            activa: 0,
            "en falla": 1,
            active: 0,
            resuelta: 2,
            resuelto: 2,
            resolved: 2,
          };
          const estadoA = (a.Estado || "").toString().trim().toLowerCase();
          const estadoB = (b.Estado || "").toString().trim().toLowerCase();
          return (ordenEstado[estadoA] ?? 99) - (ordenEstado[estadoB] ?? 99);
        });
        // Renderizar filas con separador de área
        let lastArea = null;
        sorted.forEach((d) => {
          const area = d.area || d.Área || "";
          if (area !== lastArea) {
            const sep = document.createElement("tr");
            sep.innerHTML = `<td colspan="12" style="background:rgba(56, 189, 248, 0.1) !important;font-weight:700;color:#38bdf8 !important;text-align:left;padding:8px 12px;font-family:'JetBrains Mono',monospace;letter-spacing:0.05em;">ÁREA ${area}</td>`;
            tbody.appendChild(sep);
            lastArea = area;
          }

          // Cómputo de tiempos desglosados
          let failedDisplay = "-";
          let maintDisplay = "-";
          let totalDisplay = "-";
          const st = (d.status || d.Estado || "").toString().trim().toLowerCase();

          if (st === "resolved" || st === "resuelta" || st === "resuelto") {
            const tf = d.timeFailed != null ? d.timeFailed : (d.time_failed != null ? d.time_failed : null);
            const tm = d.timeMaintenance != null ? d.timeMaintenance : (d.time_maintenance != null ? d.time_maintenance : null);
            const tt = d.totalTime != null ? d.totalTime : (d.total_time != null ? d.total_time : null);
            
            if (tf != null) failedDisplay = formateaTiempo(tf);
            if (tm != null) maintDisplay = formateaTiempo(tm);
            if (tt != null) totalDisplay = formateaTiempo(tt);

            // Fallback si no hay desgloses guardados
            if (totalDisplay === "-" && d.timestamp && d.resolvedAt) {
              const startMs = d.timestamp.toDate ? d.timestamp.toDate().getTime() : new Date(d.timestamp).getTime();
              const endMs = d.resolvedAt.toDate ? d.resolvedAt.toDate().getTime() : new Date(d.resolvedAt).getTime();
              const diffSec = Math.max(0, Math.round((endMs - startMs) / 1000));
              failedDisplay = formateaTiempo(diffSec);
              totalDisplay = failedDisplay;
            }
          } else {
            // Falla en curso (activa o en mantenimiento)
            const statusHistory = d.statusHistory || [];
            const failedEntry = statusHistory.find(e => e.status === 'failed');
            const maintEntry = statusHistory.find(e => e.status === 'maintenance');
            const startMs = d.reportedAt ? (d.reportedAt.toDate ? d.reportedAt.toDate().getTime() : new Date(d.reportedAt).getTime())
                            : (d.timestamp ? (d.timestamp.toDate ? d.timestamp.toDate().getTime() : new Date(d.timestamp).getTime()) : null);
            const maintMs = maintEntry ? new Date(maintEntry.at).getTime() : null;

            if ((st === 'maintenance' || d.status === 'maintenance') && startMs && maintMs) {
              failedDisplay = formateaTiempo(Math.max(0, Math.round((maintMs - startMs) / 1000)));
              maintDisplay = formateaTiempo(Math.max(0, Math.round((Date.now() - maintMs) / 1000)));
              totalDisplay = formateaTiempo(Math.max(0, Math.round((Date.now() - startMs) / 1000)));
            } else if (startMs) {
              failedDisplay = formateaTiempo(Math.max(0, Math.round((Date.now() - startMs) / 1000)));
              totalDisplay = failedDisplay;
            }
          }

          // Información de mantenimiento
          const maintNote = d.maintenanceNote || "";
          const maintBy = d.maintenanceByName || d.maintenanceBy || "";
          const maintInfo = maintNote 
            ? `<div><span class="badge bg-warning text-dark">${maintNote}</span><br><small class="text-muted">Resp: ${maintBy}</small></div>`
            : "-";

          // Solicitudes de refacciones asociadas
          const refacciones = d.refacciones || [];
          const refaccionesInfo = refacciones.length > 0
            ? refacciones.map(r => {
                const badge = r.status === 'pending' 
                  ? '<span class="badge bg-warning text-dark">Pendiente</span>' 
                  : '<span class="badge bg-success">Entregado</span>';
                return `<div class="mb-1 text-nowrap"><small>📦 ${r.itemName || r.itemId} (Cant: ${r.quantity})</small> ${badge}</div>`;
              }).join("")
            : "-";

          const isAct = st === "activa" || st === "active" || st === "failed" || st === "en falla";
          const statusBadge = isAct
            ? `<span class="badge bg-danger bg-opacity-25 text-danger border border-danger d-inline-flex align-items-center gap-1"><span class="scada-led led-red" style="width:6px;height:6px;"></span> ACTIVA</span>`
            : `<span class="badge bg-success bg-opacity-25 text-success border border-success d-inline-flex align-items-center gap-1"><span class="scada-led led-green" style="width:6px;height:6px;"></span> RESUELTA</span>`;

          const tr = document.createElement("tr");
          tr.innerHTML = `
            <td class="scada-mono fw-bold text-light">${d.operationId || d.craneId || d.id || ""}</td>
            <td class="scada-mono">${area}</td>
            <td>${d.tipo === "operacion" ? "Operación" : "Grúa"}</td>
            <td>${statusBadge}</td>
            <td>${d.description || d.Descripción || ""}</td>
            <td class="scada-mono">${formatFecha(d.timestamp)}</td>
            <td class="scada-mono">${formatFecha(d.resolvedAt) || "-"}</td>
            <td class="scada-mono text-danger fw-semibold">${failedDisplay}</td>
            <td class="scada-mono text-warning">${maintDisplay}</td>
            <td class="scada-mono fw-bold text-light">${totalDisplay}</td>
            <td>${maintInfo}</td>
            <td>${refaccionesInfo}</td>
          `;
          tbody.appendChild(tr);
        });
      }
      function formatFecha(f) {
        if (!f) return "";

        // Debug logging
        // Formateando fecha

        let date;
        if (f.toDate) {
          date = f.toDate();
        } else if (typeof f === "string") {
          date = new Date(f);
        } else if (f.seconds) {
          date = new Date(f.seconds * 1000);
        } else if (f instanceof Date) {
          date = f;
        } else {
          // Formato desconocido
          return "";
        }

        if (!(date instanceof Date) || isNaN(date)) {
          // Fecha inválida
          return "";
        }

        return date.toLocaleString("es-MX", {
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
          hour: "2-digit",
          minute: "2-digit",
        });
      }
      function calculaTiempoFalla(d) {
        try {
          let start = d.timestamp || d.reportedAt || d.createdAt;
          let end = d.resolvedAt;

          // Convertir start a Date
          if (start && start.toDate) {
            start = start.toDate();
          } else if (typeof start === "string") {
            start = new Date(start);
          } else if (start && start.seconds) {
            start = new Date(start.seconds * 1000);
          } else if (!start) {
            return "Sin fecha de inicio";
          }

          // Convertir end a Date
          if (d.Estado === "Resuelta" && end) {
            if (end && end.toDate) {
              end = end.toDate();
            } else if (typeof end === "string") {
              end = new Date(end);
            } else if (end && end.seconds) {
              end = new Date(end.seconds * 1000);
            }
          } else {
            end = window.getChihuahuaTime(); // Para fallas activas, usar fecha actual
          }

          // Validar fechas
          if (!(start instanceof Date) || isNaN(start)) {
            return "Fecha de inicio inválida";
          }
          if (!(end instanceof Date) || isNaN(end)) {
            return "Fecha de fin inválida";
          }

          const segundos = Math.max(0, Math.round((end - start) / 1000));
          return formateaTiempo(segundos);
        } catch (error) {
          console.error("Error en calculaTiempoFalla:", error);
          return "Error en cálculo";
        }
      }

      // --- Funciones para mostrar detalles específicos ---
      async function mostrarDetallesEstado(estado, count, data) {
        // Filtrar items que coincidan con el estado, considerando diferentes formatos
        const items = data.filter((d) => {
          let itemEstado = (d.Estado || d.status || "").toString().trim();
          let estadoComparar = estado.toString().trim();

          // Normalizar estados para comparación
          if (estadoComparar === "Activa") {
            return (
              itemEstado === "ACTIVA" ||
              itemEstado.toLowerCase() === "activa" ||
              itemEstado.toLowerCase() === "en falla" ||
              itemEstado.toLowerCase() === "active" ||
              itemEstado.toLowerCase() === "failed" ||
              itemEstado.toLowerCase() === "maintenance"
            );
          } else if (estadoComparar === "Resuelta") {
            return (
              itemEstado === "Resuelta" ||
              itemEstado.toLowerCase() === "resuelta" ||
              itemEstado.toLowerCase() === "resuelto" ||
              itemEstado.toLowerCase() === "resolved"
            );
          }
          return itemEstado === estadoComparar;
        });

        const modal = new bootstrap.Modal(
          document.getElementById("detallesModal"),
        );
        const title = document.getElementById("detallesModalTitle");
        const body = document.getElementById("detallesModalBody");

        title.textContent = `Detalles - Estado: ${estado} (${count} fallas)`;

        let html = `
        <div class="row mb-3">
          <div class="col-md-6">
            <h6>Resumen</h6>
            <p><strong>Estado:</strong> ${estado}</p>
            <p><strong>Total de fallas:</strong> ${count}</p>
            <p><strong>Porcentaje del total:</strong> ${((count / data.length) * 100).toFixed(1)}%</p>
          </div>
          <div class="col-md-6">
            <h6>Distribución por tipo</h6>
            <p><strong>Operaciones:</strong> ${items.filter((d) => d.tipo === "operacion").length}</p>
            <p><strong>Grúas:</strong> ${items.filter((d) => d.tipo === "grua").length}</p>
          </div>
        </div>
        <h6>Fallas específicas:</h6>
        <div class="table-responsive">
          <table class="table table-sm">
            <thead>
              <tr><th>ID</th><th>Área</th><th>Tipo</th><th>Descripción</th><th>Fecha Reporte</th><th>Reportado por</th><th>Fecha Resolución</th><th>Resuelto por</th><th>Tiempo</th></tr>
            </thead>
            <tbody>
      `;

        // Obtener nombres de técnicos para todos los items
        const itemsWithNames = await Promise.all(
          items.map(async (item) => {
            const reportero = await getTechnicianName(
              item.reportedBy || item.reportadoPor || "Sistema",
            );
            const resolvedor =
              item.resolvedBy || item.resueltoPor
                ? await getTechnicianName(item.resolvedBy || item.resueltoPor)
                : item.resolvedAt
                  ? "Técnico"
                  : "";

            return {
              ...item,
              reportero,
              resolvedor,
            };
          }),
        );

        itemsWithNames.forEach((item) => {
          // Obtener timestamp de reporte con mejor manejo de errores
          const timestampReporte =
            item.timestamp || item.reportedAt || item.createdAt;
          let fechaReporte = "N/A";
          if (timestampReporte) {
            try {
              fechaReporte = formatFecha(timestampReporte);
            } catch (error) {
              console.error("Error formateando fecha de reporte:", error);
              fechaReporte = "Error en fecha";
            }
          }

          // Obtener fecha de resolución con mejor manejo de errores
          let fechaResolucion = "N/A";
          if (item.resolvedAt) {
            try {
              fechaResolucion = formatFecha(item.resolvedAt);
            } catch (error) {
              console.error("Error formateando fecha de resolución:", error);
              fechaResolucion = "Error en fecha";
            }
          }

          // Calcular tiempo de falla con mejor manejo de errores
          let tiempoFalla = "N/A";
          try {
            tiempoFalla = calculaTiempoFalla(item);
          } catch (error) {
            console.error("Error calculando tiempo de falla:", error);
            tiempoFalla = "Error en cálculo";
          }

          html += `
          <tr>
            <td>${item.operationId || item.craneId || item.id || "N/A"}</td>
            <td>${item.area || item.Área || "N/A"}</td>
            <td>${item.tipo === "operacion" ? "Operación" : "Grúa"}</td>
            <td>${item.description || item.Descripción || "Sin descripción"}</td>
            <td>${fechaReporte}</td>
            <td>${item.reportero}</td>
            <td>${fechaResolucion}</td>
            <td>${item.resolvedor}</td>
            <td>${tiempoFalla}</td>
          </tr>
        `;
        });

        html += `
            </tbody>
          </table>
        </div>
      `;

        body.innerHTML = html;
        modal.show();
      }

      async function mostrarDetallesTiempoResolucion(categoria, fallas) {
        const modal = new bootstrap.Modal(
          document.getElementById("detallesModal"),
        );
        const title = document.getElementById("detallesModalTitle");
        const body = document.getElementById("detallesModalBody");

        title.textContent = `Detalles - Tiempo de Resolución: ${categoria} (${fallas.length} fallas)`;

        let html = `
        <div class="row mb-3">
          <div class="col-md-6">
            <h6>Resumen</h6>
            <p><strong>Categoría:</strong> ${categoria}</p>
            <p><strong>Total de fallas:</strong> ${fallas.length}</p>
            <p><strong>Porcentaje del total:</strong> ${((fallas.length / filteredData.filter((d) => d.resolvedAt && d.timestamp).length) * 100).toFixed(1)}%</p>
          </div>
          <div class="col-md-6">
            <h6>Estadísticas</h6>
            <p><strong>Tiempo promedio:</strong> ${formatearTiempo(fallas.reduce((sum, f) => sum + f.tiempo, 0) / fallas.length)}</p>
            <p><strong>Tiempo mínimo:</strong> ${formatearTiempo(Math.min(...fallas.map((f) => f.tiempo)))}</p>
            <p><strong>Tiempo máximo:</strong> ${formatearTiempo(Math.max(...fallas.map((f) => f.tiempo)))}</p>
          </div>
        </div>
        <h6>Fallas específicas:</h6>
        <div class="table-responsive">
          <table class="table table-sm">
            <thead>
              <tr><th>ID</th><th>Área</th><th>Tipo</th><th>Descripción</th><th>Fecha Reporte</th><th>Reportado por</th><th>Fecha Resolución</th><th>Resuelto por</th><th>Tiempo Total</th></tr>
            </thead>
            <tbody>
      `;

        // Ordenar por tiempo de resolución (más rápido primero)
        fallas.sort((a, b) => a.tiempo - b.tiempo);

        // Obtener nombres de técnicos para todas las fallas
        const fallasWithNames = await Promise.all(
          fallas.map(async (falla) => {
            const d = falla.datos;
            const reportero = await getTechnicianName(
              d.reportedBy || d.reportadoPor || "Sistema",
            );
            const resolvedor = await getTechnicianName(
              d.resolvedBy || d.resueltoPor || "Técnico",
            );

            return {
              ...falla,
              reportero,
              resolvedor,
            };
          }),
        );

        fallasWithNames.forEach((falla) => {
          const d = falla.datos;

          // Obtener fechas con mejor manejo de errores
          let fechaInicio = "N/A";
          let fechaFin = "N/A";
          let tiempoFormateado = "N/A";

          try {
            fechaInicio = formatFecha(falla.start);
          } catch (error) {
            console.error("Error formateando fecha de inicio:", error);
            fechaInicio = "Error en fecha";
          }

          try {
            fechaFin = formatFecha(falla.end);
          } catch (error) {
            console.error("Error formateando fecha de fin:", error);
            fechaFin = "Error en fecha";
          }

          try {
            tiempoFormateado = formatearTiempo(falla.tiempo);
          } catch (error) {
            console.error("Error formateando tiempo:", error);
            tiempoFormateado = "Error en tiempo";
          }

          html += `
          <tr>
            <td>${d.operationId || d.craneId || d.id || "N/A"}</td>
            <td>${d.area || d.Área || "N/A"}</td>
            <td>${d.tipo === "operacion" ? "Operación" : "Grúa"}</td>
            <td>${d.description || d.Descripción || "Sin descripción"}</td>
            <td>${fechaInicio}</td>
            <td>${falla.reportero}</td>
            <td>${fechaFin}</td>
            <td>${falla.resolvedor}</td>
            <td><strong>${tiempoFormateado}</strong></td>
          </tr>
        `;
        });

        html += `
            </tbody>
          </table>
        </div>
      `;

        body.innerHTML = html;
        modal.show();
      }

      function formatearTiempo(segundos) {
        if (segundos < 60) return `${Math.round(segundos)}s`;
        if (segundos < 3600) return `${Math.round(segundos / 60)}m`;
        if (segundos < 86400)
          return `${Math.round(segundos / 3600)}h ${Math.round((segundos % 3600) / 60)}m`;
        return `${Math.round(segundos / 86400)}d ${Math.round((segundos % 86400) / 3600)}h`;
      }

      function mostrarDetallesOperacion(operacion, count, data) {
        const items = data.filter(
          (d) =>
            d.tipo === "operacion" && (d.operationId || d.id) === operacion,
        );
        const modal = new bootstrap.Modal(
          document.getElementById("detallesModal"),
        );
        const title = document.getElementById("detallesModalTitle");
        const body = document.getElementById("detallesModalBody");

        title.textContent = `Detalles - Operación: ${operacion} (${count} fallas)`;

        let html = `
        <div class="row mb-3">
          <div class="col-md-6">
            <h6>Resumen de la operación</h6>
            <p><strong>ID:</strong> ${operacion}</p>
            <p><strong>Total de fallas:</strong> ${count}</p>
            <p><strong>Área:</strong> ${items[0]?.area || "N/A"}</p>
          </div>
          <div class="col-md-6">
            <h6>Estados</h6>
            <p><strong>Activas:</strong> ${items.filter((d) => d.Estado === "ACTIVA").length}</p>
            <p><strong>Resueltas:</strong> ${items.filter((d) => d.Estado === "Resuelta").length}</p>
          </div>
        </div>
        <h6>Historial de fallas:</h6>
        <div class="table-responsive">
          <table class="table table-sm">
            <thead>
              <tr><th>Estado</th><th>Descripción</th><th>Fecha Inicio</th><th>Fecha Resolución</th><th>Tiempo</th></tr>
            </thead>
            <tbody>
      `;

        items.forEach((item) => {
          html += `
          <tr>
            <td><span class="badge ${item.Estado === "ACTIVA" ? "bg-danger" : "bg-success"}">${item.Estado}</span></td>
            <td>${item.description || item.Descripción || "Sin descripción"}</td>
            <td>${formatFecha(item.timestamp)}</td>
            <td>${formatFecha(item.resolvedAt)}</td>
            <td>${calculaTiempoFalla(item)}</td>
          </tr>
        `;
        });

        html += `
            </tbody>
          </table>
        </div>
      `;

        body.innerHTML = html;
        modal.show();
      }

      async function mostrarDetallesGrua(grua, count, data) {
        const items = data.filter(
          (d) => d.tipo === "grua" && (d.craneId || d.id) === grua,
        );
        const modal = new bootstrap.Modal(
          document.getElementById("detallesModal"),
        );
        const title = document.getElementById("detallesModalTitle");
        const body = document.getElementById("detallesModalBody");

        title.textContent = `Detalles - Grúa: ${grua} (${count} fallas)`;

        let html = `
        <div class="row mb-3">
          <div class="col-md-6">
            <h6>Resumen de la grúa</h6>
            <p><strong>ID:</strong> ${grua}</p>
            <p><strong>Total de fallas:</strong> ${count}</p>
            <p><strong>Área:</strong> ${items[0]?.area || "N/A"}</p>
          </div>
          <div class="col-md-6">
            <h6>Estados</h6>
            <p><strong>Activas:</strong> ${items.filter((d) => d.Estado === "ACTIVA").length}</p>
            <p><strong>Resueltas:</strong> ${items.filter((d) => d.Estado === "Resuelta").length}</p>
          </div>
        </div>
        <h6>Historial de fallas:</h6>
        <div class="table-responsive">
          <table class="table table-sm">
            <thead>
              <tr><th>Estado</th><th>Descripción</th><th>Fecha Inicio</th><th>Reportado por</th><th>Fecha Resolución</th><th>Resuelto por</th><th>Tiempo</th></tr>
            </thead>
            <tbody>
      `;

        // Obtener nombres de técnicos para todos los items
        const itemsWithNames = await Promise.all(
          items.map(async (item) => {
            const reportero = await getTechnicianName(
              item.reportedBy || item.reportadoPor || "Sistema",
            );
            const resolvedor =
              item.resolvedBy || item.resueltoPor
                ? await getTechnicianName(item.resolvedBy || item.resueltoPor)
                : item.resolvedAt
                  ? "Técnico"
                  : "";

            return {
              ...item,
              reportero,
              resolvedor,
            };
          }),
        );

        itemsWithNames.forEach((item) => {
          // Obtener timestamp de inicio con mejor manejo de errores
          let timestampInicio =
            item.timestamp || item.reportedAt || item.createdAt;
          let fechaInicio = "N/A";
          if (timestampInicio) {
            try {
              fechaInicio = formatFecha(timestampInicio);
            } catch (error) {
              console.error("Error formateando fecha de inicio:", error);
              fechaInicio = "Error en fecha";
            }
          }

          // Obtener fecha de resolución con mejor manejo de errores
          let fechaResolucion = "N/A";
          if (item.resolvedAt) {
            try {
              fechaResolucion = formatFecha(item.resolvedAt);
            } catch (error) {
              console.error("Error formateando fecha de resolución:", error);
              fechaResolucion = "Error en fecha";
            }
          }

          // Calcular tiempo de falla con mejor manejo de errores
          let tiempoFalla = "N/A";
          try {
            tiempoFalla = calculaTiempoFalla(item);
          } catch (error) {
            console.error("Error calculando tiempo de falla:", error);
            tiempoFalla = "Error en cálculo";
          }

          html += `
          <tr>
            <td><span class="badge ${item.Estado === "ACTIVA" ? "bg-danger" : "bg-success"}">${item.Estado}</span></td>
            <td>${item.description || item.Descripción || "Sin descripción"}</td>
            <td>${fechaInicio}</td>
            <td>${item.reportero}</td>
            <td>${fechaResolucion}</td>
            <td>${item.resolvedor}</td>
            <td>${tiempoFalla}</td>
          </tr>
        `;
        });

        html += `
            </tbody>
          </table>
        </div>
      `;

        body.innerHTML = html;
        modal.show();
      }

      function mostrarDetallesFalla(falla, count, data) {
        const items = data.filter(
          (d) => (d.description || d.Descripción) === falla,
        );
        const modal = new bootstrap.Modal(
          document.getElementById("detallesModal"),
        );
        const title = document.getElementById("detallesModalTitle");
        const body = document.getElementById("detallesModalBody");

        title.textContent = `Detalles - Falla: "${falla}" (${count} ocurrencias)`;

        let html = `
        <div class="row mb-3">
          <div class="col-md-6">
            <h6>Resumen de la falla</h6>
            <p><strong>Descripción:</strong> ${falla}</p>
            <p><strong>Total de ocurrencias:</strong> ${count}</p>
            <p><strong>Porcentaje del total:</strong> ${((count / data.length) * 100).toFixed(1)}%</p>
          </div>
          <div class="col-md-6">
            <h6>Distribución</h6>
            <p><strong>Operaciones:</strong> ${items.filter((d) => d.tipo === "operacion").length}</p>
            <p><strong>Grúas:</strong> ${items.filter((d) => d.tipo === "grua").length}</p>
            <p><strong>Activas:</strong> ${items.filter((d) => d.Estado === "ACTIVA").length}</p>
          </div>
        </div>
        <h6>Ocurrencias específicas:</h6>
        <div class="table-responsive">
          <table class="table table-sm">
            <thead>
              <tr><th>ID</th><th>Área</th><th>Tipo</th><th>Estado</th><th>Fecha</th></tr>
            </thead>
            <tbody>
      `;

        items.forEach((item) => {
          html += `
          <tr>
            <td>${item.operationId || item.craneId || item.id || "N/A"}</td>
            <td>${item.area || item.Área || "N/A"}</td>
            <td>${item.tipo === "operacion" ? "Operación" : "Grúa"}</td>
            <td><span class="badge ${item.Estado === "ACTIVA" ? "bg-danger" : "bg-success"}">${item.Estado}</span></td>
            <td>${formatFecha(item.timestamp)}</td>
          </tr>
        `;
        });

        html += `
            </tbody>
          </table>
        </div>
      `;

        body.innerHTML = html;
        modal.show();
      }

      function mostrarDetallesTiempo(tipo, tiempo, data) {
        const items = data.filter((d) => {
          if (tipo === "Operaciones") return d.tipo === "operacion";
          if (tipo === "Grúas") return d.tipo === "grua";
          return false;
        });

        const modal = new bootstrap.Modal(
          document.getElementById("detallesModal"),
        );
        const title = document.getElementById("detallesModalTitle");
        const body = document.getElementById("detallesModalBody");

        title.textContent = `Detalles - Tiempo Promedio: ${tipo}`;

        let html = `
        <div class="row mb-3">
          <div class="col-md-6">
            <h6>Resumen de tiempos</h6>
            <p><strong>Tipo:</strong> ${tipo}</p>
            <p><strong>Tiempo promedio:</strong> ${formateaTiempo(tiempo)}</p>
            <p><strong>Total de fallas:</strong> ${items.length}</p>
          </div>
          <div class="col-md-6">
            <h6>Estadísticas</h6>
            <p><strong>Fallas resueltas:</strong> ${items.filter((d) => d.Estado === "Resuelta").length}</p>
            <p><strong>Fallas activas:</strong> ${items.filter((d) => d.Estado === "ACTIVA").length}</p>
          </div>
        </div>
        <h6>Fallas con tiempos de resolución:</h6>
        <div class="table-responsive">
          <table class="table table-sm">
            <thead>
              <tr><th>ID</th><th>Descripción</th><th>Estado</th><th>Tiempo de Resolución</th></tr>
            </thead>
            <tbody>
      `;

        const itemsResueltos = items.filter(
          (d) => d.Estado === "Resuelta" && d.resolvedAt,
        );
        itemsResueltos.forEach((item) => {
          html += `
          <tr>
            <td>${item.operationId || item.craneId || item.id}</td>
            <td>${item.description || item.Descripción || "Sin descripción"}</td>
            <td><span class="badge bg-success">Resuelta</span></td>
            <td>${calculaTiempoFalla(item)}</td>
          </tr>
        `;
        });

        html += `
            </tbody>
          </table>
        </div>
      `;

        body.innerHTML = html;
        modal.show();
      }

      // --- Función de comparación entre jornadas ---
      function renderComparisonChart() {
        const comparison = comparisonFilter.value;
        const comparisonSection = document.getElementById("comparisonSection");

        if (comparison === "none") {
          comparisonSection.style.display = "none";
          return;
        }

        comparisonSection.style.display = "block";

        // Obtener datos de la jornada actual
        const jornadaActual = (jornadaFilter ? jornadaFilter.value : "actual") || "actual";
        const getRangeFn = window.getShiftTimeRangeForAnalysis || (typeof getShiftTimeRangeForAnalysis === 'function' ? getShiftTimeRangeForAnalysis : () => ({ start: new Date(), end: new Date() }));
        const { start: startActual, end: endActual } = getRangeFn(jornadaActual);
        const { start: startComparison, end: endComparison } = getRangeFn(comparison);

        const dataActual = filteredData.filter((item) => {
          let ts = item.timestamp;
          if (ts && ts.toDate) ts = ts.toDate();
          else if (typeof ts === "string") ts = new Date(ts);
          else if (ts && ts.seconds) ts = new Date(ts.seconds * 1000);
          else ts = null;
          return ts && ts >= startActual && ts <= endActual;
        });

        const dataComparison = allData.filter((item) => {
          // Usar allData para comparación (datos completos)
          let ts = item.timestamp;
          if (ts && ts.toDate) ts = ts.toDate();
          else if (typeof ts === "string") ts = new Date(ts);
          else if (ts && ts.seconds) ts = new Date(ts.seconds * 1000);
          else ts = null;
          return ts && ts >= startComparison && ts <= endComparison;
        });

        // Calcular métricas para comparación
        const metrics = [
          "Total Fallas",
          "Fallas Activas",
          "Fallas Resueltas",
          "Tiempo Promedio (min)",
        ];
        const actualMetrics = [
          dataActual.length,
          dataActual.filter((d) => d.Estado === "ACTIVA").length,
          dataActual.filter((d) => d.Estado === "Resuelta").length,
          Math.round(
            promedio(
              dataActual
                .filter((d) => d.resolvedAt && d.timestamp)
                .map((d) => {
                  let start = d.timestamp;
                  let end = d.resolvedAt;
                  if (start && start.toDate) start = start.toDate();
                  else if (typeof start === "string") start = new Date(start);
                  else if (start && start.seconds)
                    start = new Date(start.seconds * 1000);
                  if (end && end.toDate) end = end.toDate();
                  else if (typeof end === "string") end = new Date(end);
                  else if (end && end.seconds)
                    end = new Date(end.seconds * 1000);
                  return (end - start) / 60000; // Convertir a minutos
                }),
            ),
          ),
        ];

        const comparisonMetrics = [
          dataComparison.length,
          dataComparison.filter((d) => d.Estado === "ACTIVA").length,
          dataComparison.filter((d) => d.Estado === "Resuelta").length,
          Math.round(
            promedio(
              dataComparison
                .filter((d) => d.resolvedAt && d.timestamp)
                .map((d) => {
                  let start = d.timestamp;
                  let end = d.resolvedAt;
                  if (start && start.toDate) start = start.toDate();
                  else if (typeof start === "string") start = new Date(start);
                  else if (start && start.seconds)
                    start = new Date(start.seconds * 1000);
                  if (end && end.toDate) end = end.toDate();
                  else if (typeof end === "string") end = new Date(end);
                  else if (end && end.seconds)
                    end = new Date(end.seconds * 1000);
                  return (end - start) / 60000; // Convertir a minutos
                }),
            ),
          ),
        ];

        renderOrUpdateChart(
          "comparisonChart",
          comparisonChart,
          {
            type: "bar",
            data: {
              labels: metrics,
              datasets: [
                {
                  label: `Jornada ${jornadaActual === "actual" ? window.getCurrentShift().name : jornadaActual}`,
                  data: actualMetrics,
                  backgroundColor: "#3498db",
                  borderColor: "#2980b9",
                  borderWidth: 1,
                },
                {
                  label: `Jornada ${comparison}`,
                  data: comparisonMetrics,
                  backgroundColor: "#e67e22",
                  borderColor: "#d35400",
                  borderWidth: 1,
                },
              ],
            },
            options: {
              responsive: true,
              maintainAspectRatio: false,
              plugins: {
                legend: { position: "top" },
                tooltip: {
                  callbacks: {
                    label: function (context) {
                      if (context.datasetIndex === 0) {
                        return `${context.dataset.label}: ${context.parsed.y}`;
                      } else {
                        return `${context.dataset.label}: ${context.parsed.y}`;
                      }
                    },
                  },
                },
              },
              scales: {
                y: {
                  beginAtZero: true,
                },
              },
            },
          },
          (c) => (comparisonChart = c),
        );
      }

      // --- Función para mostrar sugerencias de mejora ---
      function mostrarSugerenciasMejora() {
        const modal = new bootstrap.Modal(
          document.getElementById("detallesModal"),
        );
        const title = document.getElementById("detallesModalTitle");
        const body = document.getElementById("detallesModalBody");

        title.textContent = "Sugerencias de Mejora - Análisis de Datos";

        // Analizar datos para generar sugerencias
        const totalFallas = filteredData.length;
        const fallasActivas = filteredData.filter(
          (d) => d.Estado === "ACTIVA",
        ).length;
        const fallasResueltas = filteredData.filter(
          (d) => d.Estado === "Resuelta",
        ).length;
        const tiempoPromedio = promedio(
          filteredData
            .filter((d) => d.resolvedAt && d.timestamp)
            .map((d) => {
              let start = d.timestamp;
              let end = d.resolvedAt;
              if (start && start.toDate) start = start.toDate();
              else if (typeof start === "string") start = new Date(start);
              else if (start && start.seconds)
                start = new Date(start.seconds * 1000);
              if (end && end.toDate) end = end.toDate();
              else if (typeof end === "string") end = new Date(end);
              else if (end && end.seconds) end = new Date(end.seconds * 1000);
              return (end - start) / 1000;
            }),
        );

        // Top fallas más recurrentes
        const topFallas = topByKey(
          filteredData,
          (d) => d.description || d.Descripción,
          3,
        );

        // Top áreas con más problemas
        const topAreas = topByKey(filteredData, (d) => d.area || "N/A", 3);

        let html = `
        <div class="row mb-4">
          <div class="col-md-6">
            <h6>📊 Resumen Actual</h6>
            <p><strong>Total de fallas:</strong> ${totalFallas}</p>
            <p><strong>Fallas activas:</strong> ${fallasActivas}</p>
            <p><strong>Fallas resueltas:</strong> ${fallasResueltas}</p>
            <p><strong>Tiempo promedio de resolución:</strong> ${formateaTiempo(tiempoPromedio)}</p>
          </div>
          <div class="col-md-6">
            <h6>🎯 Indicadores de Rendimiento</h6>
            <p><strong>Tasa de resolución:</strong> ${totalFallas > 0 ? ((fallasResueltas / totalFallas) * 100).toFixed(1) : 0}%</p>
            <p><strong>Fallas pendientes:</strong> ${fallasActivas}</p>
            <p><strong>Eficiencia:</strong> ${tiempoPromedio < 3600 ? "Buena" : tiempoPromedio < 7200 ? "Regular" : "Necesita mejora"}</p>
          </div>
        </div>
        
        <div class="row mb-4">
          <div class="col-md-6">
            <h6>🔧 Principales Fallas Recurrentes</h6>
            <ul class="list-group">
      `;

        topFallas.forEach((falla, index) => {
          html += `
          <li class="list-group-item d-flex justify-content-between align-items-center">
            ${falla.key}
            <span class="badge bg-primary rounded-pill">${falla.count}</span>
          </li>
        `;
        });

        html += `
            </ul>
          </div>
          <div class="col-md-6">
            <h6>🏭 Áreas con Más Problemas</h6>
            <ul class="list-group">
      `;

        topAreas.forEach((area, index) => {
          html += `
          <li class="list-group-item d-flex justify-content-between align-items-center">
            Área ${area.key}
            <span class="badge bg-warning rounded-pill">${area.count}</span>
          </li>
        `;
        });

        html += `
            </ul>
          </div>
        </div>
        
        <div class="row">
          <div class="col-12">
            <h6>💡 Sugerencias de Mejora</h6>
            <div class="alert alert-info">
              <h6>🚨 Acciones Inmediatas:</h6>
              <ul>
                ${fallasActivas > 0 ? `<li><strong>Atender ${fallasActivas} fallas activas</strong> - Priorizar resolución inmediata</li>` : ""}
                ${tiempoPromedio > 3600 ? `<li><strong>Optimizar tiempos de respuesta</strong> - Actual promedio: ${formateaTiempo(tiempoPromedio)}</li>` : ""}
                ${topFallas.length > 0 ? `<li><strong>Investigar falla recurrente:</strong> "${topFallas[0].key}" (${topFallas[0].count} veces)</li>` : ""}
              </ul>
            </div>
            
            <div class="alert alert-warning">
              <h6>📈 Mejoras a Mediano Plazo:</h6>
              <ul>
                <li><strong>Implementar mantenimiento preventivo</strong> en áreas con más fallas</li>
                <li><strong>Capacitar personal</strong> en resolución de fallas recurrentes</li>
                <li><strong>Establecer KPIs</strong> de tiempo de resolución por área</li>
                <li><strong>Revisar procedimientos</strong> de reporte y escalación</li>
              </ul>
            </div>
            
            <div class="alert alert-success">
              <h6>🎯 Objetivos de Mejora:</h6>
              <ul>
                <li><strong>Reducir tiempo promedio</strong> de resolución a menos de 1 hora</li>
                <li><strong>Mantener tasa de resolución</strong> por encima del 90%</li>
                <li><strong>Minimizar fallas recurrentes</strong> implementando soluciones permanentes</li>
                <li><strong>Mejorar comunicación</strong> entre áreas para resolución rápida</li>
              </ul>
            </div>
          </div>
        </div>
      `;

        body.innerHTML = html;
        modal.show();
      }

      // --- Asistente ---
      function abrirAsistenteIA() {
        const modal = new bootstrap.Modal(
          document.getElementById("aiAssistantModal"),
        );
        const chatMessages = document.getElementById("chatMessages");

        // Obtener configuración actual para personalizar el mensaje
        const config = globalConfigManager
          ? globalConfigManager.getConfig()
          : { modules: { operations: true, cranes: true } };

        let tipoEquipo = "equipos industriales";
        let iconosEspecificos = "";

        if (config.modules.operations && config.modules.cranes) {
          tipoEquipo = "operaciones y grúas";
          iconosEspecificos = `
          <li>🏭 Análisis de operaciones industriales</li>
          <li>🏗️ Diagnóstico de grúas y equipos de elevación</li>
        `;
        } else if (config.modules.operations && !config.modules.cranes) {
          tipoEquipo = "operaciones industriales";
          iconosEspecificos = `
          <li>🏭 Análisis de operaciones industriales</li>
          <li>⚙️ Optimización de procesos de producción</li>
        `;
        } else if (!config.modules.operations && config.modules.cranes) {
          tipoEquipo = "grúas y equipos de elevación";
          iconosEspecificos = `
          <li>🏗️ Diagnóstico de grúas y equipos de elevación</li>
          <li>🔧 Mantenimiento de sistemas de elevación</li>
        `;
        }

        // Mensaje de bienvenida personalizado
        chatMessages.innerHTML = `
        <div class="d-flex mb-3">
          <div class="flex-shrink-0">
            <div class="bg-info text-white rounded-circle d-flex align-items-center justify-content-center" style="width: 40px; height: 40px;">
              <i class="bi bi-robot"></i>
            </div>
          </div>
          <div class="flex-grow-1 ms-3">
            <div class="bg-light rounded p-3">
              <strong>Asistente:</strong><br>
              ¡Hola! Soy tu asistente especializado en ${tipoEquipo}. Puedo ayudarte con:
              <ul class="mb-0 mt-2">
                ${iconosEspecificos}
                <li>🔍 Análisis de patrones de fallas</li>
                <li>🔧 Recomendaciones de mantenimiento</li>
                <li>📈 Optimización de productividad</li>
                <li>🚨 Identificación de prioridades</li>
                <li>📊 Insights basados en datos</li>
              </ul>
              ¿En qué puedo ayudarte hoy?
            </div>
          </div>
        </div>
      `;

        modal.show();

        // Configurar eventos
        document.getElementById("sendMessageBtn").onclick = enviarMensaje;
        document
          .getElementById("userInput")
          .addEventListener("keypress", function (e) {
            if (e.key === "Enter") {
              enviarMensaje();
            }
          });
      }

      function askAI(pregunta) {
        document.getElementById("userInput").value = pregunta;
        enviarMensaje();
      }

      function enviarMensaje() {
        const userInput = document.getElementById("userInput");
        const pregunta = userInput.value.trim();

        if (!pregunta) return;

        // Agregar mensaje del usuario
        agregarMensajeUsuario(pregunta);
        userInput.value = "";

        // Procesar con IA
        setTimeout(() => {
          const respuesta = procesarPreguntaIA(pregunta);
          agregarMensajeIA(respuesta);
        }, 1000);
      }

      function agregarMensajeUsuario(mensaje) {
        const chatMessages = document.getElementById("chatMessages");
        chatMessages.innerHTML += `
        <div class="d-flex mb-3 justify-content-end">
          <div class="flex-grow-1 me-3 text-end">
            <div class="bg-primary text-white rounded p-3" style="max-width: 80%; display: inline-block;">
              <strong>Tú:</strong><br>
              ${mensaje}
            </div>
          </div>
          <div class="flex-shrink-0">
            <div class="bg-primary text-white rounded-circle d-flex align-items-center justify-content-center" style="width: 40px; height: 40px;">
              <i class="bi bi-person"></i>
            </div>
          </div>
        </div>
      `;
        scrollToBottom();
      }

      function agregarMensajeIA(mensaje) {
        const chatMessages = document.getElementById("chatMessages");
        chatMessages.innerHTML += `
        <div class="d-flex mb-3">
          <div class="flex-shrink-0">
            <div class="bg-info text-white rounded-circle d-flex align-items-center justify-content-center" style="width: 40px; height: 40px;">
              <i class="bi bi-robot"></i>
            </div>
          </div>
          <div class="flex-grow-1 ms-3">
            <div class="bg-light rounded p-3">
              <strong>Asistente:</strong><br>
              ${mensaje}
            </div>
          </div>
        </div>
      `;
        scrollToBottom();
      }

      function scrollToBottom() {
        const chatContainer = document.getElementById("chatContainer");
        chatContainer.scrollTop = chatContainer.scrollHeight;
      }

      function procesarPreguntaIA(pregunta) {
        const preguntaLower = pregunta.toLowerCase();

        // Análisis de datos actuales
        const totalFallas = filteredData.length;
        const fallasActivas = filteredData.filter(
          (d) => d.Estado === "ACTIVA",
        ).length;
        const fallasResueltas = filteredData.filter(
          (d) => d.Estado === "Resuelta",
        ).length;
        const topFallas = topByKey(
          filteredData,
          (d) => d.description || d.Descripción,
          3,
        );
        const topAreas = topByKey(filteredData, (d) => d.area || "N/A", 3);

        // Análisis de área específica
        if (preguntaLower.includes("área") || preguntaLower.includes("area")) {
          const areaMatch =
            pregunta.match(/área\s*(\d+)/i) || pregunta.match(/area\s*(\d+)/i);
          if (areaMatch) {
            const area = areaMatch[1];
            const fallasArea = filteredData.filter((d) =>
              (d.area || "").toString().includes(area),
            );
            const activasArea = fallasArea.filter(
              (d) => d.Estado === "ACTIVA",
            ).length;
            let equipo = "";
            let recomendaciones = "";
            let problemasTipicos = "";
            if (["10", "20", "30"].includes(area)) {
              equipo = "Grúas Neumáticas para Carga de Piezas";
              problemasTipicos = `
              <ul>
                <li>🔧 Fallas en sistema de freno neumático</li>
                <li>⚡ Problemas en tornillos y mecanismos de elevación</li>
                <li>💨 Fugas en sistema neumático</li>
                <li>🛡️ Desgaste en guardas de protección</li>
                <li>🔄 Fallas en bandas de giro</li>
                <li>⚖️ Problemas en compensación/nivelación neumática</li>
              </ul>
            `;
              recomendaciones = `
              <ul>
                <li>✅ Revisar presión del sistema neumático diariamente</li>
                <li>✅ Verificar estado de frenos neumáticos semanalmente</li>
                <li>✅ Lubricar tornillos y mecanismos según manual</li>
                <li>✅ Inspeccionar guardas y bandas de giro mensualmente</li>
                <li>✅ Calibrar sistema de nivelación neumática cada mes</li>
                <li>✅ Verificar conexiones neumáticas y válvulas</li>
              </ul>
            `;
            }
            return `
            <strong>Análisis del Área ${area}:</strong><br><br>
            ${equipo ? `<strong>Equipo principal:</strong> ${equipo}<br><br>` : ""}
            📊 <strong>Total de fallas:</strong> ${fallasArea.length}<br>
            🚨 <strong>Fallas activas:</strong> ${activasArea}<br>
            ✅ <strong>Fallas resueltas:</strong> ${fallasArea.filter((d) => d.Estado === "Resuelta").length}<br><br>
            ${equipo ? `<strong>Problemas típicos en ${equipo}:</strong>${problemasTipicos}` : ""}
            <strong>Principales problemas:</strong><br>
            ${topByKey(fallasArea, (d) => d.description || d.Descripción, 2)
              .map((f) => `• ${f.key} (${f.count} veces)`)
              .join("<br>")}<br><br>
            ${equipo ? `<strong>Recomendaciones para ${equipo}:</strong>${recomendaciones}` : ""}
            <strong>Recomendaciones generales:</strong><br>
            • Revisar equipos con fallas recurrentes<br>
            • Implementar mantenimiento preventivo<br>
            • Capacitar operadores en procedimientos
          `;
          }
        }

        // Grúas Neumáticas: Si la pregunta es sobre mantenimiento, productividad o fallas en áreas 10, 20, 30
        if (
          (preguntaLower.includes("grua") ||
            preguntaLower.includes("neumatic") ||
            preguntaLower.includes("carga") ||
            preguntaLower.match(/área\s*(10|20|30)/) ||
            preguntaLower.match(/area\s*(10|20|30)/)) &&
          (preguntaLower.includes("mantenimiento") ||
            preguntaLower.includes("productividad") ||
            preguntaLower.includes("falla") ||
            preguntaLower.includes("problema"))
        ) {
          return `
          <strong>🔧 Recomendaciones Especializadas para Grúas Neumáticas:</strong><br><br>
          <strong>Problemas típicos:</strong>
          <ul>
            <li>Fallas en sistema de freno neumático</li>
            <li>Problemas en tornillos y mecanismos de elevación</li>
            <li>Fugas en sistema neumático</li>
            <li>Desgaste en guardas de protección</li>
            <li>Fallas en bandas de giro</li>
            <li>Problemas en compensación/nivelación neumática</li>
          </ul>
          <strong>Mejores prácticas de mantenimiento:</strong>
          <ul>
            <li>Revisar presión del sistema neumático diariamente</li>
            <li>Verificar estado de frenos neumáticos semanalmente</li>
            <li>Lubricar tornillos y mecanismos según manual</li>
            <li>Inspeccionar guardas y bandas de giro mensualmente</li>
            <li>Calibrar sistema de nivelación neumática cada mes</li>
            <li>Verificar conexiones neumáticas y válvulas</li>
          </ul>
          <strong>Optimización de productividad:</strong>
          <ul>
            <li>Implementar checklist de inicio de turno para operadores</li>
            <li>Capacitar al personal en operación segura de grúas</li>
            <li>Monitorear tiempos de carga y descarga de piezas</li>
            <li>Registrar y analizar fallas frecuentes para acciones preventivas</li>
            <li>Verificar alineación y nivelación de grúas regularmente</li>
          </ul>
        `;
        }

        // Mantenimiento preventivo
        if (
          preguntaLower.includes("mantenimiento") ||
          preguntaLower.includes("preventivo")
        ) {
          return `
          <strong>🔧 Plan de Mantenimiento Preventivo:</strong><br><br>
          <strong>Equipos prioritarios:</strong><br>
          ${topFallas.map((f) => `• ${f.key} - Revisar cada 2 semanas`).join("<br>")}<br><br>
          
          <strong>Áreas de atención:</strong><br>
          ${topAreas.map((a) => `• Área ${a.key} - Inspección semanal`).join("<br>")}<br><br>
          
          <strong>Checklist recomendado:</strong><br>
          • Verificar lubricación de equipos<br>
          • Revisar tensiones de bandas<br>
          • Limpiar filtros y conductos<br>
          • Calibrar sensores críticos<br>
          • Documentar hallazgos
        `;
        }

        // Productividad
        if (
          preguntaLower.includes("productividad") ||
          preguntaLower.includes("mejorar")
        ) {
          return `
          <strong>📈 Estrategias para Mejorar Productividad:</strong><br><br>
          
          <strong>Análisis actual:</strong><br>
          • Total fallas: ${totalFallas}<br>
          • Fallas activas: ${fallasActivas}<br>
          • Tasa de resolución: ${totalFallas > 0 ? ((fallasResueltas / totalFallas) * 100).toFixed(1) : 0}%<br><br>
          
          <strong>Acciones inmediatas:</strong><br>
          • Resolver ${fallasActivas} fallas activas<br>
          • Implementar checklist de inicio de turno<br>
          • Establecer KPIs de tiempo de respuesta<br><br>
          
          <strong>Mejoras a mediano plazo:</strong><br>
          • Automatizar reportes de fallas<br>
          • Crear base de datos de soluciones<br>
          • Implementar sistema de alertas tempranas
        `;
        }

        // Prioridades urgentes
        if (
          preguntaLower.includes("urgente") ||
          preguntaLower.includes("inmediata") ||
          preguntaLower.includes("atención")
        ) {
          return `
          <strong>🚨 Prioridades Urgentes:</strong><br><br>
          
          <strong>Fallas activas críticas:</strong><br>
          ${filteredData
            .filter((d) => d.Estado === "ACTIVA")
            .map(
              (f) =>
                `• ${f.operationId || f.craneId || f.id} - ${f.description || f.Descripción || "Sin descripción"}`,
            )
            .join("<br>")}<br><br>
          
          <strong>Equipos con más fallas recurrentes:</strong><br>
          ${topFallas.map((f) => `• ${f.key} (${f.count} ocurrencias)`).join("<br>")}<br><br>
          
          <strong>Plan de acción:</strong><br>
          1. Atender fallas activas inmediatamente<br>
          2. Investigar causas raíz de fallas recurrentes<br>
          3. Implementar soluciones permanentes<br>
          4. Documentar lecciones aprendidas
        `;
        }

        // Patrones de fallas
        if (
          preguntaLower.includes("patrón") ||
          preguntaLower.includes("patrones")
        ) {
          return `
          <strong>📊 Análisis de Patrones de Fallas:</strong><br><br>
          
          <strong>Fallas más recurrentes:</strong><br>
          ${topFallas.map((f) => `• ${f.key} (${f.count} veces)`).join("<br>")}<br><br>
          
          <strong>Áreas problemáticas:</strong><br>
          ${topAreas.map((a) => `• Área ${a.key} (${a.count} fallas)`).join("<br>")}<br><br>
          
          <strong>Patrones identificados:</strong><br>
          • Fallas relacionadas con mantenimiento preventivo<br>
          • Problemas de operación en áreas específicas<br>
          • Tendencias temporales en ciertos equipos<br><br>
          
          <strong>Recomendaciones:</strong><br>
          • Implementar mantenimiento predictivo<br>
          • Mejorar procedimientos operativos<br>
          • Capacitar personal en áreas críticas
        `;
        }

        // Reducción de paros
        if (
          preguntaLower.includes("paro") ||
          preguntaLower.includes("paros") ||
          preguntaLower.includes("tiempo")
        ) {
          return `
          <strong>⏱️ Estrategias para Reducir Tiempos de Paro:</strong><br><br>
          
          <strong>Análisis actual:</strong><br>
          • Fallas activas: ${fallasActivas}<br>
          • Tiempo promedio de resolución: ${formateaTiempo(
            promedio(
              filteredData
                .filter((d) => d.resolvedAt && d.timestamp)
                .map((d) => {
                  let start = d.timestamp;
                  let end = d.resolvedAt;
                  if (start && start.toDate) start = start.toDate();
                  else if (typeof start === "string") start = new Date(start);
                  else if (start && start.seconds)
                    start = new Date(start.seconds * 1000);
                  if (end && end.toDate) end = end.toDate();
                  else if (typeof end === "string") end = new Date(end);
                  else if (end && end.seconds)
                    end = new Date(end.seconds * 1000);
                  return (end - start) / 1000;
                }),
            ),
          )}<br><br>
          
          <strong>Acciones inmediatas:</strong><br>
          • Establecer protocolos de respuesta rápida<br>
          • Crear equipos de respuesta 24/7<br>
          • Implementar sistema de escalación<br><br>
          
          <strong>Mejoras a largo plazo:</strong><br>
          • Automatizar detección de fallas<br>
          • Implementar mantenimiento predictivo<br>
          • Mejorar inventario de repuestos
        `;
        }

        // Respuesta general
        return `
        <strong>🤖 Análisis General del Sistema:</strong><br><br>
        
        <strong>Estado actual:</strong><br>
        • Total de fallas: ${totalFallas}<br>
        • Fallas activas: ${fallasActivas}<br>
        • Fallas resueltas: ${fallasResueltas}<br><br>
        
        <strong>Principales problemas:</strong><br>
        ${topFallas.map((f) => `• ${f.key} (${f.count} veces)`).join("<br>")}<br><br>
        
        <strong>Áreas críticas:</strong><br>
        ${topAreas.map((a) => `• Área ${a.key} (${a.count} fallas)`).join("<br>")}<br><br>
        
        <strong>Recomendaciones generales:</strong><br>
        • Implementar mantenimiento preventivo<br>
        • Mejorar procedimientos operativos<br>
        • Capacitar personal técnico<br>
        • Establecer KPIs de rendimiento
      `;
      }

      // Exportar tabla a CSV
      document.getElementById("exportTableBtn").onclick = function () {
        let csv =
          "ID,Área,Tipo,Estado,Descripción,Fecha Inicio,Fecha Resolución,⏱ Falla Activa,🔧 Mantenimiento,⏱ Tiempo Total,Motivo/Técnico Mant.,Refacciones (Inventario)\n";
        const sorted = [...filteredData].sort((a, b) => {
          const areaA = parseInt(a.area || a.Área || "0");
          const areaB = parseInt(b.area || b.Área || "0");
          if (areaA !== areaB) return areaA - areaB;
          if ((a.tipo || "") < (b.tipo || "")) return -1;
          if ((a.tipo || "") > (b.tipo || "")) return 1;
          const ordenEstado = {
            activa: 0,
            "en falla": 1,
            active: 0,
            resuelta: 2,
            resuelto: 2,
            resolved: 2,
          };
          const estadoA = (a.Estado || "").toString().trim().toLowerCase();
          const estadoB = (b.Estado || "").toString().trim().toLowerCase();
          return (ordenEstado[estadoA] ?? 99) - (ordenEstado[estadoB] ?? 99);
        });
        let lastArea = null;
        sorted.forEach((d) => {
          const area = d.area || d.Área || "";
          if (area !== lastArea) {
            csv += `"","Área ${area}",,,,,,,,,,,\n`;
            lastArea = area;
          }

          // Cómputo de tiempos desglosados para CSV
          let failedDisplay = "-";
          let maintDisplay = "-";
          let totalDisplay = "-";
          const st = (d.status || d.Estado || "").toString().trim().toLowerCase();

          if (st === "resolved" || st === "resuelta" || st === "resuelto" || st === "resolved") {
            const tf = d.timeFailed != null ? d.timeFailed : (d.time_failed != null ? d.time_failed : null);
            const tm = d.timeMaintenance != null ? d.timeMaintenance : (d.time_maintenance != null ? d.time_maintenance : null);
            const tt = d.totalTime != null ? d.totalTime : (d.total_time != null ? d.total_time : null);
            
            if (tf != null) failedDisplay = formateaTiempo(tf);
            if (tm != null) maintDisplay = formateaTiempo(tm);
            if (tt != null) totalDisplay = formateaTiempo(tt);

            if (totalDisplay === "-" && d.timestamp && d.resolvedAt) {
              const startMs = d.timestamp.toDate ? d.timestamp.toDate().getTime() : new Date(d.timestamp).getTime();
              const endMs = d.resolvedAt.toDate ? d.resolvedAt.toDate().getTime() : new Date(d.resolvedAt).getTime();
              const diffSec = Math.max(0, Math.round((endMs - startMs) / 1000));
              failedDisplay = formateaTiempo(diffSec);
              totalDisplay = failedDisplay;
            }
          } else {
            const statusHistory = d.statusHistory || [];
            const maintEntry = statusHistory.find(e => e.status === 'maintenance');
            const startMs = d.reportedAt ? (d.reportedAt.toDate ? d.reportedAt.toDate().getTime() : new Date(d.reportedAt).getTime())
                            : (d.timestamp ? (d.timestamp.toDate ? d.timestamp.toDate().getTime() : new Date(d.timestamp).getTime()) : null);
            const maintMs = maintEntry ? new Date(maintEntry.at).getTime() : null;

            if ((st === 'maintenance' || d.status === 'maintenance') && startMs && maintMs) {
              failedDisplay = formateaTiempo(Math.max(0, Math.round((maintMs - startMs) / 1000)));
              maintDisplay = formateaTiempo(Math.max(0, Math.round((Date.now() - maintMs) / 1000)));
              totalDisplay = formateaTiempo(Math.max(0, Math.round((Date.now() - startMs) / 1000)));
            } else if (startMs) {
              failedDisplay = formateaTiempo(Math.max(0, Math.round((Date.now() - startMs) / 1000)));
              totalDisplay = failedDisplay;
            }
          }

          // Mantenimiento notas
          const maintNote = d.maintenanceNote || "";
          const maintBy = d.maintenanceByName || d.maintenanceBy || "";
          const maintText = maintNote ? `${maintNote} (Resp: ${maintBy})` : "-";

          // Refacciones
          const refacciones = d.refacciones || [];
          const refText = refacciones.length > 0
            ? refacciones.map(r => `${r.itemName || r.itemId} (x${r.quantity}) [${r.status === 'pending' ? 'Pendiente' : 'Entregado'}]`).join(" | ")
            : "-";

          const row = [
            d.operationId || d.craneId || d.id || "",
            area,
            d.tipo === "operacion" ? "Operación" : "Grúa",
            d.Estado || d.status || "",
            (d.description || d.Descripción || "").replace(/\n/g, " ").replace(/,/g, " "),
            formatFecha(d.timestamp),
            formatFecha(d.resolvedAt),
            failedDisplay,
            maintDisplay,
            totalDisplay,
            maintText,
            refText
          ];
          csv += row.map((v) => '"' + v + '"').join(",") + "\n";
        });
        const blob = new Blob([csv], { type: "text/csv" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = "fallas_filtradas.csv";
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      };
      // Mejorar visual de encabezados
      document.querySelectorAll("#tablaFallas th").forEach((th) => {
        th.style.position = "sticky";
        th.style.top = "0";
        th.style.zIndex = "2";
      });

      // --- Funciones para el filtro específico del gráfico de tendencias ---

      // Variables globales para el filtro de tendencias
      let tendenciasDateFrom = null;
      let tendenciasDateTo = null;
      let tendenciasFilterActive = false;

      // Función para inicializar el filtro de tendencias con la semana actual (lunes a domingo)
      function initializeTendenciasFilter() {
        try {
          const today = window.getChihuahuaTime();
          const dateFromInput = document.getElementById("tendenciasDateFrom");
          const dateToInput = document.getElementById("tendenciasDateTo");

          if (!dateFromInput || !dateToInput) {
            console.error(
              "❌ Elementos del filtro de tendencias no encontrados",
            );
            return;
          }

          // Calcular el lunes de la semana actual
          const monday = new Date(today);
          const dayOfWeek = today.getDay(); // 0 = domingo, 1 = lunes, ..., 6 = sábado
          // Calcular días hasta el lunes: si es domingo (0), retroceder 6 días; si no, retroceder (dayOfWeek - 1) días
          const daysToMonday = dayOfWeek === 0 ? -6 : -(dayOfWeek - 1);
          monday.setDate(today.getDate() + daysToMonday);

          // Calcular el domingo de la semana actual
          const sunday = new Date(monday);
          sunday.setDate(monday.getDate() + 6);

          // Establecer las fechas en los inputs
          const mondayStr = window.getChihuahuaDateString(monday);
          const sundayStr = window.getChihuahuaDateString(sunday);

          dateFromInput.value = mondayStr;
          dateToInput.value = sundayStr;

          // Aplicar el filtro automáticamente
          applyTendenciasFilter();

          // Filtro inicializado
        } catch (error) {
          console.error("❌ Error inicializando filtro de tendencias:", error);
        }
      }

      // Función para establecer rangos rápidos
      function setTendenciasRange(range) {
        const today = window.getChihuahuaTime();
        const dateFromInput = document.getElementById("tendenciasDateFrom");
        const dateToInput = document.getElementById("tendenciasDateTo");

        switch (range) {
          case "today":
            const todayStr = window.getChihuahuaDateString();
            dateFromInput.value = todayStr;
            dateToInput.value = todayStr;
            break;
          case "week":
            // Usar semana actual de lunes a domingo
            const monday = new Date(today);
            const dayOfWeek = today.getDay();
            // Calcular días hasta el lunes: si es domingo (0), retroceder 6 días; si no, retroceder (dayOfWeek - 1) días
            const daysToMonday = dayOfWeek === 0 ? -6 : -(dayOfWeek - 1);
            monday.setDate(today.getDate() + daysToMonday);

            const sunday = new Date(monday);
            sunday.setDate(monday.getDate() + 6);

            dateFromInput.value = window.getChihuahuaDateString(monday);
            dateToInput.value = window.getChihuahuaDateString(sunday);
            break;
          case "month":
            const monthAgo = new Date(today);
            monthAgo.setMonth(monthAgo.getMonth() - 1);
            dateFromInput.value = window.getChihuahuaDateString(monthAgo);
            dateToInput.value = window.getChihuahuaDateString(today);
            break;
        }

        // Aplicar el filtro automáticamente
        applyTendenciasFilter();
      }

      // Función para aplicar el filtro de tendencias
      function applyTendenciasFilter() {
        const dateFromInput = document.getElementById("tendenciasDateFrom");
        const dateToInput = document.getElementById("tendenciasDateTo");

        if (dateFromInput.value && dateToInput.value) {
          tendenciasDateFrom = dateFromInput.value;
          tendenciasDateTo = dateToInput.value;
          tendenciasFilterActive = true;

          // Filtro aplicado

          // Actualizar solo el gráfico de tendencias
          renderTendenciasChart();

          // Mostrar indicador visual
          const filterContainer = document.querySelector(
            ".tendencias-filter-container",
          );
          filterContainer.classList.add("filter-active");

          // Agregar indicador de filtro activo
          let indicator = filterContainer.querySelector(".filter-indicator");
          if (!indicator) {
            indicator = document.createElement("div");
            indicator.className = "filter-indicator";
            indicator.innerHTML =
              '<i class="bi bi-funnel-fill"></i> Filtro Activo';
            indicator.style.cssText =
              "position: absolute; top: 5px; right: 10px; background: #28a745; color: white; padding: 2px 8px; border-radius: 12px; font-size: 0.8rem;";
            filterContainer.style.position = "relative";
            filterContainer.appendChild(indicator);
          }
        } else {
          alert("Por favor selecciona ambas fechas (inicial y final)");
        }
      }

      // Función para resetear el filtro de tendencias
      function resetTendenciasFilter() {
        const dateFromInput = document.getElementById("tendenciasDateFrom");
        const dateToInput = document.getElementById("tendenciasDateTo");

        // Limpiar inputs
        dateFromInput.value = "";
        dateToInput.value = "";

        // Resetear variables
        tendenciasDateFrom = null;
        tendenciasDateTo = null;
        tendenciasFilterActive = false;

        // Filtro reseteado

        // Actualizar solo el gráfico de tendencias
        renderTendenciasChart();

        // Restaurar estilo visual
        const filterContainer = document.querySelector(
          ".tendencias-filter-container",
        );
        filterContainer.classList.remove("filter-active");

        // Remover indicador de filtro activo
        const indicator = filterContainer.querySelector(".filter-indicator");
        if (indicator) {
          indicator.remove();
        }
      }

      // Función duplicada eliminada - usar la versión mejorada más arriba

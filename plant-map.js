/**
 * ============================================================================
 * SCADA PRO 4.0 - DIGITAL TWIN PLANT TOPOLOGY & RUNWAY MAP (ISA-101 / OpenBridge)
 * Topología interactiva de naves industriales, grúas viajeras y líneas de ensamble
 * Desarrollado para Cesar • Sincronización en tiempo real con Firestore
 * ============================================================================
 */

(function (window) {
  'use strict';

  // Configuración base de pistas de rodadura y naves industriales (Valores de Fábrica Realistas)
  const DEFAULT_PLANT_TOPOLOGY_CONFIG = {
    area5: {
      label: 'Área 5 • Recepción & Materia Prima',
      code: '5',
      cranes: [],
      operations: ['5']
    },
    area10: {
      label: 'Área 10 • Nave Norte (Mecanizado & Subensamble)',
      code: '10',
      cranes: ['10A', '10B', '10C', '10D'],
      operations: ['10.01', '10.02', '10.03', '10.04', '10.05', '10.06', '10.07', '10.08', '10.09', '10.10']
    },
    area20: {
      label: 'Área 20 • Nave Troncal Central (Línea Principal)',
      code: '20',
      cranes: ['20A', '20B', '20C', '20D', '20E', '20F'],
      operations: ['20.01', '20.02', '20.03', '20.04', '20.05', '20.06', '20.07', '20.08', '20.09', '20.10', '20.11', '20.12', '20.13']
    },
    area30: {
      label: 'Área 30 • Nave Sur (Ensamble Final & Pruebas)',
      code: '30',
      cranes: ['30A', '30B', '30C', '30D'],
      operations: ['30.01', '30.02', '30.03', '30.04', '30.05', '30.06', '30.07', '30.08', '30.09', '30.10']
    },
    area35: {
      label: 'Área 35+ • Almacén Automatizado & Embarque',
      code: '35',
      cranes: [],
      operations: ['35', '40', '50', '65', '70']
    }
  };

  // Estados mutables dinámicos sincronizados con Firestore / Admin / localStorage
  let cranesConfigState = null;
  let opsConfigState = null;
  let topologyLabelsState = {};

  try {
    const savedCranes = localStorage.getItem('hermes_cranes_config');
    if (savedCranes) cranesConfigState = JSON.parse(savedCranes);
  } catch (e) {}
  try {
    const savedOps = localStorage.getItem('hermes_operations_config');
    if (savedOps) opsConfigState = JSON.parse(savedOps);
  } catch (e) {}
  try {
    const savedLabels = localStorage.getItem('hermes_plant_topology_labels');
    if (savedLabels) topologyLabelsState = JSON.parse(savedLabels);
  } catch (e) {}

  const PLANT_TOPOLOGY_CONFIG = {};

  function normalizeAreaKey(k) {
    if (!k || k === '_order') return null;
    let str = String(k).trim().toLowerCase();
    if (str === 'area35plus' || str === '35plus' || str === 'area35' || str === '35') {
      return 'area35';
    }
    if (!str.startsWith('area')) {
      str = 'area' + str;
    }
    return str;
  }

  function rebuildTopology() {
    const areaKeysSet = new Set();

    // 1. Áreas configuradas en Admin (Grúas)
    if (cranesConfigState && typeof cranesConfigState === 'object') {
      Object.keys(cranesConfigState).forEach(k => {
        if (k !== '_order' && Array.isArray(cranesConfigState[k])) {
          const norm = normalizeAreaKey(k);
          if (norm) areaKeysSet.add(norm);
        }
      });
    }

    // 2. Áreas configuradas en Admin (Operaciones)
    if (opsConfigState && typeof opsConfigState === 'object') {
      Object.keys(opsConfigState).forEach(k => {
        if (k !== '_order' && Array.isArray(opsConfigState[k])) {
          const norm = normalizeAreaKey(k);
          if (norm) areaKeysSet.add(norm);
        }
      });
    }

    // 3. Fallback a áreas base por defecto si no hay nada en Firestore / caché aún
    if (areaKeysSet.size === 0) {
      Object.keys(DEFAULT_PLANT_TOPOLOGY_CONFIG).forEach(k => areaKeysSet.add(k));
    }

    // 4. Ordenar naturalmente por número de nave/área (5, 10, 20, 30, 35, ...)
    const sortedKeys = Array.from(areaKeysSet).sort((a, b) => {
      const numA = parseInt(a.replace(/\D/g, ''), 10) || 0;
      const numB = parseInt(b.replace(/\D/g, ''), 10) || 0;
      return numA - numB;
    });

    // Vaciar objeto actual manteniendo la referencia
    Object.keys(PLANT_TOPOLOGY_CONFIG).forEach(k => delete PLANT_TOPOLOGY_CONFIG[k]);

    sortedKeys.forEach(areaKey => {
      const code = areaKey.replace('area', '');

      // Grúas de esta área (desde Admin Firestore config)
      let cranes = [];
      if (cranesConfigState) {
        if (Array.isArray(cranesConfigState[areaKey])) {
          cranes = cranesConfigState[areaKey];
        } else if (Array.isArray(cranesConfigState[code])) {
          cranes = cranesConfigState[code];
        }
      } else if (DEFAULT_PLANT_TOPOLOGY_CONFIG[areaKey]) {
        cranes = DEFAULT_PLANT_TOPOLOGY_CONFIG[areaKey].cranes || [];
      }

      // Operaciones de esta área (desde Admin Firestore config)
      let operations = [];
      if (opsConfigState) {
        if (Array.isArray(opsConfigState[areaKey])) {
          operations = opsConfigState[areaKey];
        } else if (areaKey === 'area35' && Array.isArray(opsConfigState['area35plus'])) {
          operations = opsConfigState['area35plus'];
        } else if (Array.isArray(opsConfigState[code])) {
          operations = opsConfigState[code];
        }
      } else if (DEFAULT_PLANT_TOPOLOGY_CONFIG[areaKey]) {
        operations = DEFAULT_PLANT_TOPOLOGY_CONFIG[areaKey].operations || [];
      }

      // Nombre / etiqueta del área
      let label = '';
      if (window.HermesTopology && typeof window.HermesTopology.getAreaLabel === 'function') {
        label = window.HermesTopology.getAreaLabel(areaKey);
      }
      if (!label && topologyLabelsState && topologyLabelsState[areaKey] && topologyLabelsState[areaKey].label) {
        label = topologyLabelsState[areaKey].label;
      }
      if (!label && DEFAULT_PLANT_TOPOLOGY_CONFIG[areaKey]) {
        label = DEFAULT_PLANT_TOPOLOGY_CONFIG[areaKey].label;
      }
      if (!label) {
        label = areaKey === 'area35' ? 'Área 35+ • Almacén Automatizado & Embarque' : `Área ${code}`;
      }

      PLANT_TOPOLOGY_CONFIG[areaKey] = {
        label,
        code,
        cranes: Array.isArray(cranes) ? [...cranes] : [],
        operations: Array.isArray(operations) ? [...operations] : []
      };
    });
  }

  // Inicializar topología inmediata
  rebuildTopology();

  const isTvPage = typeof window !== 'undefined' && window.location.pathname.includes('andon-tv');
  let currentMapMode = isTvPage ? 'split' : (localStorage.getItem('hermes_plant_map_mode') || 'split'); // 'map', 'grid', 'split'
  let cachedCranesState = new Map();
  let cachedOpsState = new Map();
  let firstOutId = null;
  let predictiveWarningIds = new Set();

  class PlantMapEngine {
    constructor() {
      this.container = null;
      this.isInitialized = false;
      this._observersInitialized = false;
    }

    isOperationsActive() {
      if (typeof document !== 'undefined' && document.documentElement.classList.contains('hide-module-operations')) {
        return false;
      }
      try {
        const saved = localStorage.getItem('global_modules_config_v2') || localStorage.getItem('global_modules_config');
        if (saved) {
          const m = JSON.parse(saved);
          if (m.operations === false) return false;
        }
      } catch (e) {}
      if (window.globalConfigManager && window.globalConfigManager.config && window.globalConfigManager.config.modules) {
        return window.globalConfigManager.config.modules.operations !== false;
      }
      return true;
    }

    isCranesActive() {
      if (typeof document !== 'undefined' && document.documentElement.classList.contains('hide-module-cranes')) {
        return false;
      }
      try {
        const saved = localStorage.getItem('global_modules_config_v2') || localStorage.getItem('global_modules_config');
        if (saved) {
          const m = JSON.parse(saved);
          if (m.cranes === false) return false;
        }
      } catch (e) {}
      if (window.globalConfigManager && window.globalConfigManager.config && window.globalConfigManager.config.modules) {
        return window.globalConfigManager.config.modules.cranes !== false;
      }
      return true;
    }

    init(containerId = 'scada-plant-map-container') {
      this.container = document.getElementById(containerId);
      if (!this.container) return;

      this.renderFrame();
      this.applyViewMode(currentMapMode);
      this.initFirestoreListener();
      this.initModuleObservers();
      this.isInitialized = true;
      this.syncState();
    }

    initModuleObservers() {
      if (this._observersInitialized) return;
      this._observersInitialized = true;

      document.addEventListener('globalConfigReady', () => {
        if (this.isInitialized) {
          this.renderBays();
          this.syncState();
        }
      });

      try {
        const classObserver = new MutationObserver((mutations) => {
          for (const m of mutations) {
            if (m.type === 'attributes' && m.attributeName === 'class') {
              if (this.isInitialized) {
                this.renderBays();
                this.syncState();
              }
              break;
            }
          }
        });
        classObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
      } catch (e) {}
    }

    renderFrame() {
      if (!this.container) return;

      this.container.innerHTML = `
        <div class="scada-plant-map-card mb-4" id="scadaPlantMapCard">
          <div class="scada-plant-map-header d-flex flex-wrap justify-content-between align-items-center gap-2 p-3">
            <div class="d-flex align-items-center gap-2">
              <span class="scada-beacon-dot"></span>
              <h5 class="mb-0 fw-bold text-white d-flex align-items-center gap-2" style="font-size:0.95rem;">
                <i class="bi bi-diagram-3-fill text-info"></i> Topología Digital Twin • Pistas de Rodadura
              </h5>
              <span class="badge bg-dark border border-secondary text-info font-mono" style="font-size:0.7rem;">ISA-101 2.5D</span>
            </div>

            <!-- Controles de Modo de Vista -->
            <div class="d-flex align-items-center gap-2">
              <div class="btn-group btn-group-sm scada-viewmode-switch" role="group">
                <button type="button" class="btn btn-outline-secondary ${currentMapMode === 'split' ? 'active' : ''}" data-mode="split" title="Vista Dividida: Mapa + Faceplates">
                  <i class="bi bi-layout-split"></i> Híbrido
                </button>
                <button type="button" class="btn btn-outline-secondary ${currentMapMode === 'map' ? 'active' : ''}" data-mode="map" title="Vista Expandida del Mapa de Planta">
                  <i class="bi bi-map-fill"></i> Solo Mapa
                </button>
                <button type="button" class="btn btn-outline-secondary ${currentMapMode === 'grid' ? 'active' : ''}" data-mode="grid" title="Vista de Tarjetas Faceplate">
                  <i class="bi bi-grid-fill"></i> Faceplates
                </button>
              </div>

              <!-- Botón de Mute de Audio Industrial -->
              <button type="button" class="btn btn-sm btn-outline-secondary scada-sound-toggle-btn" onclick="if(window.IndustrialAudio) window.IndustrialAudio.toggleMute();" title="Sonido Industrial (WebAudio)">
                <i class="bi bi-volume-up-fill"></i>
              </button>
              <!-- Botón de Megafonía / Voz Industrial -->
              <button type="button" class="btn btn-sm btn-outline-secondary scada-voice-toggle-btn" onclick="if(window.IndustrialAudio) window.IndustrialAudio.toggleVoice();" title="Megafonía / Voz Industrial (TTS es-MX)">
                <i class="bi bi-megaphone-fill"></i>
              </button>
              <!-- Botón de Editar Nombres de Áreas -->
              <button type="button" class="btn btn-sm btn-outline-secondary scada-edit-areas-btn" onclick="if(window.PlantMapEngine) window.PlantMapEngine.openEditAreasModal();" title="Personalizar Nombres y Textos de Áreas de Planta">
                <i class="bi bi-pencil-square"></i>
              </button>
            </div>
          </div>

          <!-- Banner First-Out / Falla Raíz (ISA-18.2) -->
          <div id="firstOutBannerContainer" class="px-3 pt-2" style="display:none;"></div>

          <!-- Lienzo SVG Interactivo del Piso de Planta -->
          <div class="scada-plant-map-canvas-wrap p-3">
            <div class="scada-plant-map-svg-container" id="plantMapBaysContainer">
              <!-- Bahías renderizadas dinámicamente -->
            </div>
          </div>

          <!-- Leyenda de Estados SCADA -->
          <div class="scada-plant-map-legend d-flex flex-wrap align-items-center justify-content-between p-2 px-3">
            <div class="d-flex flex-wrap align-items-center gap-3 font-mono" style="font-size:0.75rem;">
              <span class="d-flex align-items-center gap-1 text-success">
                <span class="scada-legend-dot op"></span> Operativa
              </span>
              <span class="d-flex align-items-center gap-1 text-warning">
                <span class="scada-legend-dot maint"></span> En Reparación
              </span>
              <span class="d-flex align-items-center gap-1 text-danger">
                <span class="scada-legend-dot fail"></span> Paro Activo
              </span>
              <span class="d-flex align-items-center gap-1 text-warning">
                <span class="badge badge-first-out-mini">⚡ FIRST-OUT</span> Falla Raíz
              </span>
            </div>
            <div class="text-secondary font-mono small d-none d-md-block" style="font-size:0.72rem;">
              <i class="bi bi-mouse"></i> Click en cualquier equipo para inspección inmediata
            </div>
          </div>
        </div>
      `;

      // Enlazar eventos de botones de modo de vista
      this.container.querySelectorAll('.scada-viewmode-switch button').forEach(btn => {
        btn.addEventListener('click', () => {
          const mode = btn.getAttribute('data-mode');
          this.setViewMode(mode);
        });
      });

      this.renderBays();
    }

    setViewMode(mode) {
      currentMapMode = mode;
      localStorage.setItem('hermes_plant_map_mode', mode);

      if (this.container) {
        this.container.querySelectorAll('.scada-viewmode-switch button').forEach(b => {
          b.classList.toggle('active', b.getAttribute('data-mode') === mode);
        });
      }

      this.applyViewMode(mode);
      if (window.IndustrialAudio) window.IndustrialAudio.playClick();
    }

    applyViewMode(mode) {
      const mapCard = document.getElementById('scadaPlantMapCard');
      const opsCard = document.querySelector('[data-module="operations"]');
      const cranesCard = document.querySelector('[data-module="cranes"]');
      const tvMain = document.getElementById('tvMainContainer');

      if (!mapCard) return;

      const opsActive = this.isOperationsActive();
      const cranesActive = this.isCranesActive();

      if (mode === 'grid') {
        mapCard.classList.add('collapsed-view');
        const canvas = mapCard.querySelector('.scada-plant-map-canvas-wrap');
        if (canvas) canvas.style.display = 'none';
        if (opsCard) opsCard.style.display = opsActive ? '' : 'none';
        if (cranesCard) cranesCard.style.display = cranesActive ? '' : 'none';
        if (tvMain) tvMain.style.display = '';
      } else if (mode === 'map') {
        mapCard.classList.remove('collapsed-view');
        const canvas = mapCard.querySelector('.scada-plant-map-canvas-wrap');
        if (canvas) canvas.style.display = 'block';
        if (opsCard) opsCard.style.display = 'none';
        if (cranesCard) cranesCard.style.display = 'none';
        if (tvMain) tvMain.style.display = 'none';
      } else { // 'split'
        mapCard.classList.remove('collapsed-view');
        const canvas = mapCard.querySelector('.scada-plant-map-canvas-wrap');
        if (canvas) canvas.style.display = 'block';
        if (opsCard) opsCard.style.display = opsActive ? '' : 'none';
        if (cranesCard) cranesCard.style.display = cranesActive ? '' : 'none';
        if (tvMain) tvMain.style.display = '';
      }
    }

    renderBays() {
      const baysContainer = document.getElementById('plantMapBaysContainer');
      if (!baysContainer) return;

      const opsActive = this.isOperationsActive();
      const cranesActive = this.isCranesActive();

      const mapCard = document.getElementById('scadaPlantMapCard');
      if (mapCard) {
        if (!opsActive && !cranesActive) {
          mapCard.style.display = 'none';
          return;
        } else {
          mapCard.style.display = '';
        }
      }

      let html = '';
      let renderedBaysCount = 0;

      Object.keys(PLANT_TOPOLOGY_CONFIG).forEach(bayKey => {
        const bay = PLANT_TOPOLOGY_CONFIG[bayKey];

        const hasVisibleCranes = cranesActive && Array.isArray(bay.cranes) && bay.cranes.length > 0;
        const hasVisibleOps = opsActive && Array.isArray(bay.operations) && bay.operations.length > 0;

        // Si esta área no tiene grúas visibles NI operaciones visibles, NO se renderiza la bahía
        if (!hasVisibleCranes && !hasVisibleOps) {
          return;
        }

        renderedBaysCount++;

        // Generar nodos de grúas en la pista de rodadura (solo si grúas está activo y existen grúas)
        let cranesHtml = '';
        if (hasVisibleCranes) {
          bay.cranes.forEach(craneId => {
            cranesHtml += `
              <div class="scada-runway-crane-node operational" id="map-crane-${craneId}" data-crane-id="${craneId}" title="Grúa ${craneId} • Click para ver faceplate">
                <div class="crane-node-endtruck top"></div>
                <div class="crane-node-bridge">
                  <div class="crane-node-trolley">
                    <div class="crane-node-beacon"></div>
                  </div>
                </div>
                <div class="crane-node-endtruck bottom"></div>
                <div class="crane-node-tag font-mono">
                  <span class="crane-node-id">${craneId}</span>
                  <span class="crane-first-out-pill">⚡ FO</span>
                </div>
              </div>
            `;
          });
        }

        // Generar nodos de operaciones a lo largo de la línea (solo si operaciones está activo y existen operaciones)
        let opsHtml = '';
        if (hasVisibleOps) {
          bay.operations.forEach(opId => {
            const opName = (window.HermesTopology && window.HermesTopology.getOperationName) ? window.HermesTopology.getOperationName(opId) : '';
            const opTooltip = opName ? `Operación ${opId} • ${opName}` : `Operación ${opId}`;
            opsHtml += `
              <div class="scada-runway-op-node operational" id="map-op-${opId.replace('.', '_')}" data-op-id="${opId}" title="${opTooltip}">
                <span class="op-node-dot"></span>
                <span class="op-node-lbl font-mono">${opId}</span>
              </div>
            `;
          });
        }

        const bayTitle = (window.HermesTopology && window.HermesTopology.getAreaLabel) ? window.HermesTopology.getAreaLabel(bayKey) : bay.label;

        html += `
          <div class="scada-plant-bay" id="bay-section-${bay.code}">
            <div class="scada-plant-bay-header d-flex justify-content-between align-items-center">
              <span class="bay-title"><i class="bi bi-geo-alt-fill text-info me-1"></i> ${bayTitle}</span>
              <span class="bay-status-badge font-mono" id="bay-badge-${bay.code}">NORMAL</span>
            </div>

            <!-- Pista de Rodadura de Grúas Viajeras -->
            ${hasVisibleCranes && cranesHtml ? `
            <div class="scada-runway-track-wrap" data-module="cranes">
              <div class="scada-runway-rail top"></div>
              <div class="scada-runway-cranes-lane">
                ${cranesHtml}
              </div>
              <div class="scada-runway-rail bottom"></div>
            </div>` : ''}

            <!-- Estaciones de Trabajo / Línea de Operaciones -->
            ${hasVisibleOps && opsHtml ? `
              <div class="scada-bay-ops-track mt-2" data-module="operations">
                <div class="scada-bay-ops-line">
                  ${opsHtml}
                </div>
              </div>` : ''}
          </div>
        `;
      });

      if (renderedBaysCount === 0 && mapCard) {
        mapCard.style.display = 'none';
        return;
      }

      baysContainer.innerHTML = html;

      // Enlazar clics interactivos a los nodos
      baysContainer.querySelectorAll('.scada-runway-crane-node').forEach(node => {
        node.addEventListener('click', () => {
          const craneId = node.getAttribute('data-crane-id');
          this.handleCraneClick(craneId);
        });
      });

      baysContainer.querySelectorAll('.scada-runway-op-node').forEach(node => {
        node.addEventListener('click', () => {
          const opId = node.getAttribute('data-op-id');
          this.handleOpClick(opId);
        });
      });
    }

    handleCraneClick(craneId) {
      if (window.IndustrialAudio) window.IndustrialAudio.playClick();
      // Buscar la tarjeta en el DOM y hacer scroll suave hasta ella
      const card = document.querySelector(`.operation-card[data-id="${craneId}"], .crane-card[data-id="${craneId}"]`);
      if (card) {
        card.scrollIntoView({ behavior: 'smooth', block: 'center' });
        card.classList.add('scada-faceplate-highlight');
        setTimeout(() => card.classList.remove('scada-faceplate-highlight'), 2500);
      } else if (typeof window.showCraneDetails === 'function') {
        const craneData = cachedCranesState.get(craneId) || { id: craneId, status: 'operational' };
        window.showCraneDetails(craneData);
      }
    }

    handleOpClick(opId) {
      if (window.IndustrialAudio) window.IndustrialAudio.playClick();
      const card = document.querySelector(`.operation-card[data-id="${opId}"]`);
      if (card) {
        card.scrollIntoView({ behavior: 'smooth', block: 'center' });
        card.classList.add('scada-faceplate-highlight');
        setTimeout(() => card.classList.remove('scada-faceplate-highlight'), 2500);
      } else if (typeof window.showOperationDetails === 'function') {
        const opData = cachedOpsState.get(opId) || { id: opId, status: 'operational' };
        window.showOperationDetails(opData);
      }
    }

    // Sincronización en tiempo real desde Firestore
    updateCrane(craneId, status, data = {}) {
      cachedCranesState.set(craneId, { id: craneId, status, ...data });
      this.syncState();
    }

    updateOperation(opId, status, data = {}) {
      cachedOpsState.set(opId, { id: opId, status, ...data });
      this.syncState();
    }

    setPredictiveWarnings(craneIds) {
      predictiveWarningIds = new Set(craneIds || []);
      this.syncState();
    }

    initFirestoreListener() {
      if (typeof firebase === 'undefined' || !firebase.firestore) return;
      try {
        const db = firebase.firestore();

        // 1. Escuchar etiquetas y nombres de bahías
        db.collection('config').doc('plant_topology_config').onSnapshot(doc => {
          if (doc && doc.exists) {
            topologyLabelsState = doc.data() || {};
            try {
              localStorage.setItem('hermes_plant_topology_labels', JSON.stringify(topologyLabelsState));
            } catch (e) {}
            rebuildTopology();
            if (this.isInitialized) {
              this.renderBays();
              this.syncState();
            }
          }
        }, err => {
          console.warn('[PlantMap] Error al escuchar plant_topology_config:', err.message);
        });

        // 2. Escuchar visibilidad global de módulos en tiempo real (doc 'global')
        db.collection('config').doc('global').onSnapshot(doc => {
          if (doc && doc.exists) {
            const data = doc.data();
            if (data && data.modules) {
              const opActive = data.modules.operations !== false;
              const craneActive = data.modules.cranes !== false;
              document.documentElement.classList.toggle('hide-module-operations', !opActive);
              document.documentElement.classList.toggle('hide-module-cranes', !craneActive);
              try {
                localStorage.setItem('global_modules_config_v2', JSON.stringify(data.modules));
              } catch (e) {}
              if (this.isInitialized) {
                this.renderBays();
                this.syncState();
              }
            }
          }
        }, err => {
          console.warn('[PlantMap] Error al escuchar config/global:', err.message);
        });

        // 3. Escuchar grúas por área en tiempo real desde Admin (doc 'cranes_config')
        db.collection('config').doc('cranes_config').onSnapshot(doc => {
          if (doc && doc.exists) {
            cranesConfigState = doc.data() || {};
            try {
              localStorage.setItem('hermes_cranes_config', JSON.stringify(cranesConfigState));
            } catch (e) {}
            rebuildTopology();
            if (this.isInitialized) {
              this.renderBays();
              this.syncState();
            }
          }
        }, err => {
          console.warn('[PlantMap] Error al escuchar cranes_config:', err.message);
        });

        // 4. Escuchar operaciones por área en tiempo real desde Admin (doc 'operations_config')
        db.collection('config').doc('operations_config').onSnapshot(doc => {
          if (doc && doc.exists) {
            opsConfigState = doc.data() || {};
            try {
              localStorage.setItem('hermes_operations_config', JSON.stringify(opsConfigState));
            } catch (e) {}
            rebuildTopology();
            if (this.isInitialized) {
              this.renderBays();
              this.syncState();
            }
          }
        }, err => {
          console.warn('[PlantMap] Error al escuchar operations_config:', err.message);
        });
      } catch (e) {}
    }

    openEditAreasModal() {
      if (window.HermesTopology && window.HermesTopology.openEditModal) {
        window.HermesTopology.openEditModal('areas');
        return;
      }
    }


    syncState() {
      if (!this.container || !this.isInitialized) return;

      const opsActive = this.isOperationsActive();
      const cranesActive = this.isCranesActive();

      let earliestTime = Infinity;
      let earliestEquipId = null;
      let earliestEquipType = null;
      let totalFailures = 0;

      // 1. Evaluar todas las grúas
      cachedCranesState.forEach((crane, craneId) => {
        const node = document.getElementById(`map-crane-${craneId}`);
        if (!node) return;

        const isFail = crane.status === 'failed' || crane.status === 'active';
        const isMaint = crane.status === 'maintenance';

        node.classList.remove('operational', 'maintenance', 'failure', 'late-escalated', 'first-out', 'predictive-risk');

        if (isFail) {
          totalFailures++;
          node.classList.add('failure');

          // Cálculo de tiempo de falla para First-Out
          let startTime = 0;
          if (crane.reportedAt && crane.reportedAt.toDate) startTime = crane.reportedAt.toDate().getTime();
          else if (crane.reportedAt && crane.reportedAt.seconds) startTime = crane.reportedAt.seconds * 1000;
          else if (typeof crane.reportedAt === 'number') startTime = crane.reportedAt;
          else if (crane.timestamp) startTime = crane.timestamp;

          if (startTime && startTime < earliestTime) {
            earliestTime = startTime;
            earliestEquipId = `Grúa ${craneId}`;
            earliestEquipType = 'crane';
          }
        } else if (isMaint) {
          node.classList.add('maintenance');
        } else {
          node.classList.add('operational');
        }

        // Riesgo predictivo recurrente
        if (predictiveWarningIds.has(craneId)) {
          node.classList.add('predictive-risk');
          node.title = `Grúa ${craneId}: Alerta Preventiva SCADA (Fallas recurrentes en 72h)`;
        }
      });

      // 2. Evaluar todas las operaciones
      cachedOpsState.forEach((op, opId) => {
        const safeId = opId.replace('.', '_');
        const node = document.getElementById(`map-op-${safeId}`);
        if (!node) return;

        const isFail = op.status === 'active';
        node.classList.remove('operational', 'failure');

        if (isFail) {
          totalFailures++;
          node.classList.add('failure');

          let startTime = 0;
          if (op.createdAt && op.createdAt.toDate) startTime = op.createdAt.toDate().getTime();
          else if (op.timestamp && op.timestamp.toDate) startTime = op.timestamp.toDate().getTime();
          else if (typeof op.timestamp === 'number') startTime = op.timestamp;

          if (startTime && startTime < earliestTime) {
            earliestTime = startTime;
            earliestEquipId = `Operación ${opId}`;
            earliestEquipType = 'operation';
          }
        } else {
          node.classList.add('operational');
        }
      });

      // 3. Resolver ISA-18.2 First-Out Bottleneck
      firstOutId = (totalFailures > 1 && earliestEquipId) ? earliestEquipId : null;
      this.updateFirstOutUI(firstOutId, earliestTime, totalFailures);

      // Resaltar nodo First-Out en el mapa
      if (firstOutId && earliestEquipType === 'crane') {
        const rawId = firstOutId.replace('Grúa ', '');
        const node = document.getElementById(`map-crane-${rawId}`);
        if (node) node.classList.add('first-out');
      }

      // Actualizar badges por bahía
      Object.keys(PLANT_TOPOLOGY_CONFIG).forEach(bayKey => {
        const bay = PLANT_TOPOLOGY_CONFIG[bayKey];
        const badge = document.getElementById(`bay-badge-${bay.code}`);
        if (!badge) return;

        let bayFails = 0;
        let bayMaint = 0;

        if (cranesActive && Array.isArray(bay.cranes)) {
          bay.cranes.forEach(cId => {
            const c = cachedCranesState.get(cId);
            if (c) {
              if (c.status === 'failed' || c.status === 'active') bayFails++;
              if (c.status === 'maintenance') bayMaint++;
            }
          });
        }

        if (opsActive && Array.isArray(bay.operations)) {
          bay.operations.forEach(opId => {
            const op = cachedOpsState.get(opId);
            if (op && (op.status === 'active' || op.status === 'failed')) {
              bayFails++;
            }
          });
        }

        const baySection = document.getElementById(`bay-section-${bay.code}`);
        const trackWrap = baySection ? baySection.querySelector('.scada-runway-track-wrap') : null;

        if (trackWrap) {
          if (bayFails > 0 || bayMaint > 0) {
            trackWrap.classList.add('runway-lockout');
          } else {
            trackWrap.classList.remove('runway-lockout');
          }
        }

        if (bayFails > 0) {
          badge.className = 'bay-status-badge font-mono danger';
          const lockoutText = (bay.cranes && bay.cranes.length > 0 && cranesActive) ? ' <span class="runway-lockout-badge ms-1">BLOQUEO PISTA</span>' : '';
          badge.innerHTML = `🚨 ${bayFails} PARO(S)${lockoutText}`;
        } else if (bayMaint > 0) {
          badge.className = 'bay-status-badge font-mono warning';
          const lockoutText = (bay.cranes && bay.cranes.length > 0 && cranesActive) ? ' <span class="runway-lockout-badge ms-1">BLOQUEO PISTA</span>' : '';
          badge.innerHTML = `🔧 ${bayMaint} EN REPARACIÓN${lockoutText}`;
        } else {
          badge.className = 'bay-status-badge font-mono';
          badge.textContent = '🟢 NORMAL';
        }
      });
    }

    updateFirstOutUI(firstOut, startTime, totalFailures) {
      const banner = document.getElementById('firstOutBannerContainer');
      if (!banner) return;

      if (firstOut && totalFailures > 1) {
        const elapsedSec = Math.floor((Date.now() - startTime) / 1000);
        const min = Math.floor(elapsedSec / 60);
        banner.style.display = 'block';
        banner.innerHTML = `
          <div class="scada-first-out-alert d-flex flex-wrap align-items-center justify-content-between p-2 px-3">
            <div class="d-flex align-items-center gap-2">
              <span class="scada-first-out-icon">⚡</span>
              <div>
                <strong class="text-white font-mono" style="font-size:0.85rem;">ISA-18.2 FALLA RAÍZ (FIRST-OUT): ${firstOut}</strong>
                <div class="text-secondary" style="font-size:0.75rem;">
                  Primer paro registrado hace ${min} min. Priorizar este punto para eliminar el cuello de botella en cascada.
                </div>
              </div>
            </div>
            <span class="badge bg-danger font-mono fw-bold">CUELLO DE BOTELLA RAÍZ</span>
          </div>
        `;
      } else {
        banner.style.display = 'none';
        banner.innerHTML = '';
      }
    }
  }

  window.PlantMapEngine = new PlantMapEngine();

  // Escuchar el evento andonstate despachado por app.js / andon-tv.js
  window.addEventListener('andonstate', (e) => {
    if (!e.detail) return;
    if (Array.isArray(e.detail.cranes)) {
      e.detail.cranes.forEach(c => {
        cachedCranesState.set(c.id, c);
      });
    }
    if (Array.isArray(e.detail.operations)) {
      e.detail.operations.forEach(op => {
        cachedOpsState.set(op.id, op);
      });
    }
    if (window.PlantMapEngine && window.PlantMapEngine.isInitialized) {
      window.PlantMapEngine.syncState();
    }
  });

  // Escuchar actualización de textos y nomenclatura de planta
  window.addEventListener('plant_topology_updated', (e) => {
    if (e.detail && e.detail.areas) {
      topologyLabelsState = { ...topologyLabelsState, ...e.detail.areas };
      rebuildTopology();
    }
    if (window.PlantMapEngine && window.PlantMapEngine.isInitialized) {
      window.PlantMapEngine.renderBays();
      window.PlantMapEngine.syncState();
    }
  });

  document.addEventListener('DOMContentLoaded', () => {
    window.PlantMapEngine.init('scada-plant-map-container');
  });

})(window);

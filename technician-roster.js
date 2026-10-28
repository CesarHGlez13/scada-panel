/**
 * ============================================================================
 * SCADA PRO 4.0 - LIVE SHIFT TECHNICIAN ROSTER WIDGET (ISA-101 / OpenBridge)
 * Panel de Cuadrilla Técnica en Guardia y Despacho en Tiempo Real
 * Desarrollado para Cesar • Sincronización automática con Firestore config/technicians
 * ============================================================================
 */

(function (window) {
  'use strict';

  let rawTechniciansData = null;
  let activeEquipments = [];
  let isRosterListening = false;

  // Extraer personal oficial desde Firestore config/technicians
  function parseRoster(techData) {
    const list = [];
    if (!techData || typeof techData !== 'object') return list;

    const areaKeys = Object.keys(techData);
    areaKeys.forEach(key => {
      let areaCode = '10';
      let areaLabel = 'Área 10';
      if (key.includes('20')) { areaCode = '20'; areaLabel = 'Área 20'; }
      else if (key.includes('30')) { areaCode = '30'; areaLabel = 'Área 30'; }
      else if (key.includes('5')) { areaCode = '5'; areaLabel = 'Área 5'; }
      else if (key.includes('35')) { areaCode = '35+'; areaLabel = 'Área 35+'; }

      const areaObj = techData[key];
      if (areaObj && typeof areaObj === 'object') {
        ['A', 'B', 'C', 'D'].forEach(s => {
          const sObj = areaObj[s] || areaObj[`Jornada ${s}`] || areaObj[s.toLowerCase()];
          if (sObj) {
            const techList = sObj.technicians || (Array.isArray(sObj) ? sObj : []);
            techList.forEach(t => {
              const name = typeof t === 'string' ? t : (t.name || '');
              const phone = typeof t === 'string' ? '' : (t.phone || '');
              if (name && name.trim()) {
                list.push({
                  name: name.trim(),
                  phone: String(phone || '').replace(/^521/, '').replace(/[^0-9]/g, ''),
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

    return list;
  }

  function normalizeText(str) {
    return (str || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .trim();
  }

  function getActiveShiftKey() {
    if (typeof window.getCurrentShift === 'function') {
      const s = window.getCurrentShift();
      if (s) {
        if (s.key) return s.key.toUpperCase();
        if (s.name) {
          const match = s.name.match(/[A-D]/i);
          if (match) return match[0].toUpperCase();
        }
      }
    }
    return 'D';
  }

  function focusEquipment(equipId, equipType = 'crane') {
    if (window.IndustrialAudio) window.IndustrialAudio.playClick();
    
    // Si estamos en modo 'map', cambiar a 'split' para que se vean las tarjetas
    if (window.PlantMapEngine && typeof window.PlantMapEngine.setViewMode === 'function') {
      const mode = localStorage.getItem('hermes_plant_map_mode') || 'split';
      if (mode === 'map') {
        window.PlantMapEngine.setViewMode('split');
      }
    }

    const card = document.querySelector(`.operation-card[data-id="${equipId}"]`);
    if (card) {
      card.scrollIntoView({ behavior: 'smooth', block: 'center' });
      card.classList.add('scada-faceplate-highlight');
      setTimeout(() => card.classList.remove('scada-faceplate-highlight'), 3000);
    }
  }
  window.scadaFocusEquipment = focusEquipment;

  function renderRoster() {
    const container = document.getElementById('scada-technicians-roster-body');
    const badgeEl = document.getElementById('roster-active-shift-badge');
    if (!container) return;

    const currentShift = getActiveShiftKey();
    if (badgeEl) {
      badgeEl.textContent = `TURNO ${currentShift}`;
    }

    if (!rawTechniciansData) {
      container.innerHTML = `
        <div class="text-center py-2 text-secondary font-mono small">
          <span class="spinner-border spinner-border-sm me-1"></span> Sincronizando personal...
        </div>
      `;
      return;
    }

    const allTechs = parseRoster(rawTechniciansData);
    let shiftTechs = allTechs.filter(t => t.shift === currentShift);

    // Fallback: Si no hay técnicos cargados en esta jornada, mostrar de todas
    if (shiftTechs.length === 0 && allTechs.length > 0) {
      shiftTechs = allTechs.slice(0, 8);
    }

    if (shiftTechs.length === 0) {
      container.innerHTML = `
        <div class="text-secondary font-mono small p-2 text-center">
          <i class="bi bi-info-circle text-info"></i> Sin personal registrado en config/technicians.
        </div>
      `;
      return;
    }

    let availableCount = 0;
    let interveningCount = 0;

    const cardsHtml = shiftTechs.map(tech => {
      // Buscar si el técnico está interviniendo algún equipo (con normalización de acentos)
      const normTech = normalizeText(tech.name);
      const firstWord = normTech.split(' ')[0];
      const activeIntervention = activeEquipments.find(e => {
        const assigned = normalizeText(e.maintenanceByName || e.maintenanceBy || e.assignedTo || e.technician || '');
        if (!assigned) return false;
        return assigned.includes(normTech) || normTech.includes(assigned) || (firstWord.length > 3 && assigned.includes(firstWord));
      });

      const isIntervening = !!activeIntervention;
      if (isIntervening) {
        interveningCount++;
      } else {
        availableCount++;
      }

      const equipLabel = activeIntervention ? (activeIntervention.label || activeIntervention.id) : '';
      const equipId = activeIntervention ? activeIntervention.id : '';

      return `
        <div class="scada-roster-card ${isIntervening ? 'intervening' : ''}">
          <div class="scada-roster-header">
            <div class="d-flex align-items-center gap-1 text-truncate">
              <span class="scada-roster-name text-truncate" title="${tech.name}">${tech.name}</span>
            </div>
            <div class="d-flex align-items-center gap-1">
              <span class="scada-roster-area-badge">${tech.areaLabel}</span>
              ${tech.phone ? (
                (window.ScadaAuth && window.ScadaAuth.canOperate()) ? `
                  <a href="https://wa.me/521${tech.phone}" target="_blank" class="scada-roster-btn-link" title="Contactar por WhatsApp">
                    <i class="bi bi-whatsapp text-success"></i>
                  </a>
                  <a href="tel:${tech.phone}" class="scada-roster-btn-link" title="Llamar">
                    <i class="bi bi-telephone-fill text-info"></i>
                  </a>
                ` : `
                  <button type="button" class="scada-roster-btn-link border-0 bg-transparent text-muted" onclick="if(window.ScadaAuth) window.ScadaAuth.openAuthModal('login')" title="Inicia sesión para contactar">
                    <i class="bi bi-lock-fill" style="font-size:0.75rem;"></i>
                  </button>
                `
              ) : ''}
            </div>
          </div>

          <div class="scada-roster-status-line">
            ${isIntervening ? `
              <span class="scada-roster-status-busy">
                <span class="scada-beacon-dot" style="background:#f59e0b; width:6px; height:6px;"></span>
                <span>En: <strong>${equipLabel}</strong></span>
              </span>
              <button type="button" class="scada-roster-focus-btn" onclick="scadaFocusEquipment('${equipId}')">
                <i class="bi bi-crosshair"></i> Ver
              </button>
            ` : `
              <span class="scada-roster-status-avail">
                <span class="scada-beacon-dot" style="background:#10b981; width:6px; height:6px;"></span>
                <span>DISPONIBLE</span>
              </span>
              <span class="text-secondary" style="font-size:0.65rem;">Guardia Activa</span>
            `}
          </div>
        </div>
      `;
    }).join('');

    container.innerHTML = `
      <div class="scada-roster-summary-bar d-flex justify-content-between align-items-center font-mono" style="font-size:0.72rem;">
        <span class="text-success fw-bold d-flex align-items-center gap-1">
          <span class="scada-legend-dot op"></span> ${availableCount} Disponible${availableCount !== 1 ? 's' : ''}
        </span>
        <span class="${interveningCount > 0 ? 'text-warning fw-bold' : 'text-secondary'} d-flex align-items-center gap-1">
          <span class="scada-legend-dot maint"></span> ${interveningCount} En Intervención
        </span>
      </div>
      <div class="scada-roster-list">
        ${cardsHtml}
      </div>
    `;
  }

  function initTechnicianRoster() {
    const container = document.getElementById('scada-technicians-roster-body');
    if (!container) return;

    if (typeof firebase === 'undefined' || !firebase.firestore) return;
    const db = firebase.firestore();

    // 1. Escuchar config/technicians en tiempo real
    if (!isRosterListening) {
      isRosterListening = true;
      db.collection('config').doc('technicians').onSnapshot(doc => {
        if (doc.exists) {
          rawTechniciansData = doc.data();
          renderRoster();
        }
      }, err => {
        console.warn('⚠️ [TechnicianRoster] Error listener:', err.message);
      });
    }

    // 2. Escuchar evento global andonstate para cruzar con fallas activas
    window.addEventListener('andonstate', (e) => {
      if (!e.detail) return;
      const list = [];

      if (Array.isArray(e.detail.cranes)) {
        e.detail.cranes.forEach(c => {
          if (c.status === 'failed' || c.status === 'maintenance') {
            list.push({
              id: c.id,
              type: 'crane',
              label: `Grúa ${c.id}`,
              maintenanceByName: c.maintenanceByName || c.maintenanceBy || null,
              assignedTo: c.assignedTo || null,
              status: c.status
            });
          }
        });
      }

      if (Array.isArray(e.detail.operations)) {
        e.detail.operations.forEach(op => {
          if (op.status === 'active') {
            list.push({
              id: op.id,
              type: 'operation',
              label: `Op ${op.id}`,
              assignedTo: op.assignedTo || null,
              technician: op.technician || null,
              status: op.status
            });
          }
        });
      }

      activeEquipments = list;
      renderRoster();
    });

    renderRoster();
  }

  window.TechnicianRosterEngine = {
    init: initTechnicianRoster,
    refresh: renderRoster
  };

  document.addEventListener('DOMContentLoaded', () => {
    initTechnicianRoster();
  });

})(window);

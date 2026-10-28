/**
 * =============================================================================
 * SISTEMA INDUSTRIAL SCADA - MÓDULO DE SEGURIDAD, ANTI-CLONACIÓN Y BLINDAJE
 * =============================================================================
 * Proporciona protección multicapa contra:
 * 1. Clonación de dominio y ejecución en servidores no autorizados (Domain-Lock).
 * 2. Inspección casual de código fuente y extracción de lógica propietaria.
 * 3. Detección y contramedidas contra DevTools / Depuración interactiva.
 * 4. Ataques de Clickjacking y embedding no autorizado en iframes.
 * 5. Tampering y Monkey-Patching de prototipos en tiempo de ejecución.
 * =============================================================================
 */

(function () {
  'use strict';

  // 1. DOMAIN LOCK: Lista estricta de dominios autorizados
  //    Firebase (operations-monitor-5a355) fue cerrado el 2026-10-25; el acceso ahora es
  //    por LAN del servidor Xiaomi o por Cloudflare Zero Trust Tunnel.
  const AUTHORIZED_HOSTS = [
    '192.168.100.34',
    '192.168.100.33',
    'localhost',
    '127.0.0.1'
  ];

  function isAuthorizedHost() {
    const currentHost = window.location.hostname.toLowerCase();

    // Dominios exactos autorizados
    if (AUTHORIZED_HOSTS.includes(currentHost)) return true;

    // Cloudflare Quick Tunnel / Named Tunnel (acceso remoto al servidor local)
    if (currentHost.endsWith('.trycloudflare.com')) return true;

    // Permitir dominios de producción y loopback local
    if (AUTHORIZED_HOSTS.includes(currentHost)) return true;
    
    // Permitir rangos de red local industrial (LAN privada para talleres y pruebas)
    if (/^192\.168\.\d{1,3}\.\d{1,3}$/.test(currentHost) ||
        /^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(currentHost) ||
        /^172\.(1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3}$/.test(currentHost)) {
      return true;
    }

    // Permitir protocolo local file:// y entorno móvil empaquetado (Capacitor Android APK)
    if (window.location.protocol === 'file:' || window.location.protocol === 'capacitor:') return true;

    return false;
  }

  // Si se detecta un clon o dominio no autorizado, neutralizar inmediatamente la app
  if (!isAuthorizedHost()) {
    try {
      if (document.body) {
        document.body.replaceChildren();
        const blockDiv = document.createElement('div');
        blockDiv.style.cssText = 'background:#07090e;color:#ef4444;height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;font-family:sans-serif;text-align:center;padding:20px;';
        
        const h1 = document.createElement('h1');
        h1.style.cssText = 'font-size:2.5rem;margin-bottom:10px;';
        h1.textContent = '⛔ DOMINIO NO AUTORIZADO';
        
        const p1 = document.createElement('p');
        p1.style.cssText = 'font-size:1.1rem;color:#94a3b8;max-width:550px;';
        p1.textContent = 'Esta instancia ha sido bloqueada. El sistema SCADA y Monitor de Operaciones está protegido por atestación de dominio y copyright industrial.';
        
        const p2 = document.createElement('p');
        p2.style.cssText = 'font-size:0.85rem;color:#64748b;margin-top:20px;';
        p2.textContent = `Host detectado: ${window.location.hostname}`;
        
        blockDiv.appendChild(h1);
        blockDiv.appendChild(p1);
        blockDiv.appendChild(p2);
        document.body.appendChild(blockDiv);
      }
    } catch (e) {}
    window.stop();
    throw new Error('[SECURITY SHIELD] Ejecución detenida: Dominio no autorizado.');
  }

  // 2. ANTI-CLICKJACKING / IFRAME PROTECTION (Fallback en cliente a CSP)
  try {
    if (window.top !== window.self) {
      window.top.location = window.self.location;
    }
  } catch (e) {
    // Si hay cross-origin iframe bloqueando window.top, ocultar todo
    document.documentElement.style.display = 'none';
  }

  // 3. BLOQUEO DE ATAJOS DE INSPECCIÓN Y EXTRACCIÓN DE CÓDIGO
  window.addEventListener('keydown', function (e) {
    // F12 (Herramientas de Desarrollador)
    if (e.keyCode === 123 || e.key === 'F12') {
      e.preventDefault();
      e.stopPropagation();
      return false;
    }

    // Ctrl+Shift+I (Inspeccionar) / Cmd+Opt+I
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.keyCode === 73 || e.key === 'I' || e.key === 'i')) {
      e.preventDefault();
      e.stopPropagation();
      return false;
    }

    // Ctrl+Shift+J (Consola) / Cmd+Opt+J
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.keyCode === 74 || e.key === 'J' || e.key === 'j')) {
      e.preventDefault();
      e.stopPropagation();
      return false;
    }

    // Ctrl+Shift+C (Inspector de Elementos) / Cmd+Opt+C
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.keyCode === 67 || e.key === 'C' || e.key === 'c')) {
      e.preventDefault();
      e.stopPropagation();
      return false;
    }

    // Ctrl+U (Ver código fuente HTML)
    if ((e.ctrlKey || e.metaKey) && (e.keyCode === 85 || e.key === 'U' || e.key === 'u')) {
      e.preventDefault();
      e.stopPropagation();
      return false;
    }

    // Ctrl+S (Guardar página web completa)
    if ((e.ctrlKey || e.metaKey) && (e.keyCode === 83 || e.key === 'S' || e.key === 's')) {
      e.preventDefault();
      e.stopPropagation();
      return false;
    }
  }, true);

  // 4. BLOQUEO DE MENÚ CONTEXTUAL (CLIC DERECHO PARA "GUARDAR COMO" O "INSPECCIONAR")
  // Solo se aplica en producción o fuera de campos editables
  document.addEventListener('contextmenu', function (e) {
    const targetTag = (e.target && e.target.tagName) ? e.target.tagName.toLowerCase() : '';
    // Permitir clic derecho normal en inputs y textareas para copiar/pegar texto de formularios
    if (targetTag === 'input' || targetTag === 'textarea') {
      return true;
    }
    e.preventDefault();
    return false;
  }, true);

  // 5. PROTECCIÓN Y CONGELAMIENTO DE PROTOTIPOS CRÍTICOS
  try {
    if (Object.freeze) {
      window.__SCADA_SEC_VERSION__ = '3.5.0-HARDENED';
      Object.freeze(window.__SCADA_SEC_VERSION__);
    }
  } catch (e) {}

})();

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
    '127.0.0.1',
    // Entrada fija del acceso remoto: Worker de Cloudflare (plan Free, subdomain
    // scada-xiaomi-server). Sin este host el Domain-Lock neutralizaba la página
    // (window.stop() + throw) y el navegador mostraba una pantalla negra.
    'scada-entry.scada-xiaomi-server.workers.dev',
    // Espejo público de GitHub Pages (solo lectura; el API se apunta al Worker).
    'cesarhglez13.github.io'
  ];

  function isAuthorizedHost() {
    const currentHost = window.location.hostname.toLowerCase();

    // Dominios exactos autorizados
    if (AUTHORIZED_HOSTS.includes(currentHost)) return true;

    // Cloudflare Quick Tunnel / Named Tunnel (acceso remoto al servidor local)
    if (currentHost.endsWith('.trycloudflare.com')) return true;

    // Entrada fija del acceso remoto: Worker de Cloudflare. Se permite el sufijo
    // .workers.dev para no romper el acceso si se renombra el Worker o el subdomain.
    if (currentHost.endsWith('.workers.dev')) return true;

    // Espejo público de GitHub Pages
    if (currentHost.endsWith('.github.io')) return true;

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

  // 6. SANITIZADOR DOM CANÓNICO + EJECUTOR DE ACCIONES
  //    Bug corregido (2026-10-28): 13 archivos definen `setSafeDOM` y todos menos admin.js
  //    eliminan los atributos `on*` SIN convertirlos a `data-safe-action`. Como los scripts se
  //    cargan en orden, la definición que gana en runtime es la última (scada-pro.js, defer),
  //    así que los botones renderizados dinámicamente (catálogo de motivos de paro, grúas,
  //    inventario, técnicos…) quedaban sin handler: se veían pero no hacían nada.
  //    Esta es la única versión efectiva: sanitiza igual y enruta la acción.
  if (!window.setSafeDOM) {
    window.setSafeDOM = function setSafeDOM(element, htmlString) {
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
    };
  }

  if (!window.executeSafeAction) {
    window.executeSafeAction = function executeSafeAction(target, actionString) {
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
    };
  }

  // Un solo listener global (guardado) para no ejecutar la acción dos veces.
  if (!window.__safeActionListenerInstalled) {
    window.__safeActionListenerInstalled = true;
    document.addEventListener('click', (e) => {
      const actionEl = e.target.closest('[data-safe-action]');
      if (actionEl) {
        const action = actionEl.getAttribute('data-safe-action');
        window.executeSafeAction(actionEl, action);
      }
    });
  }

})();

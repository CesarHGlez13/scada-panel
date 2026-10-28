/**
 * ============================================================================
 * SCADA PRO — SISTEMA DE AUTENTICACIÓN, REGISTRO Y CONTROL DE ACCESOS (RBAC)
 * ============================================================================
 * Arquitectura de Identidad Industrial de Misión Crítica.
 * - Registro con auto-aprobación pendiente (status: 'pending').
 * - Control de acceso por roles: admin, supervisor, tecnico, viewer, tv.
 * - Enmascaramiento de números telefónicos y datos sensibles para no autorizados.
 * - Puerta de enlace segura conectada a Firebase Authentication y Firestore.
 * Desarrollado para Cesar • Operations Monitor SCADA PRO
 * ============================================================================
 */

(function () {
  'use strict';

  // Objeto Global de Autenticación
  const ScadaAuth = {
    user: null,
    profile: null,
    isReady: false,
    subscribers: [],

    // Permisos y Roles
    isAuthenticated: function () {
      return !!this.user && !!this.profile && this.profile.status === 'active';
    },

    isAdmin: function () {
      return this.isAuthenticated() && this.profile.role === 'admin';
    },

    isSupervisor: function () {
      return this.isAuthenticated() && (this.profile.role === 'admin' || this.profile.role === 'supervisor');
    },

    isTechnician: function () {
      return this.isAuthenticated() && (this.profile.role === 'admin' || this.profile.role === 'supervisor' || this.profile.role === 'tecnico');
    },

    canOperate: function () {
      return this.isTechnician();
    },

    getRole: function () {
      return this.profile ? (this.profile.role || 'viewer') : 'invitado';
    },

    getUserName: function () {
      if (!this.profile) return 'Invitado';
      return this.profile.displayName || (this.user ? this.user.email.split('@')[0] : 'Usuario');
    },

    // Enmascaramiento seguro de teléfonos
    maskPhone: function (phoneStr) {
      if (!phoneStr) return '-';
      const clean = String(phoneStr).trim();
      // Si el usuario puede operar (técnico, supervisor, admin), ve el número real
      if (this.canOperate()) {
        return clean;
      }
      // Si no está autenticado o es viewer, se enmascara por protección de privacidad industrial
      if (clean.length >= 7) {
        const start = clean.slice(0, 3);
        const end = clean.slice(-2);
        return `${start} ••• ••${end}`;
      }
      return '••••••••';
    },

    // Suscripción a cambios de sesión
    onAuthChanged: function (callback) {
      if (typeof callback === 'function') {
        this.subscribers.push(callback);
        if (this.isReady) {
          try { callback(this.getState()); } catch (e) { console.error(e); }
        }
      }
    },

    getState: function () {
      return {
        isAuthenticated: this.isAuthenticated(),
        user: this.user,
        profile: this.profile,
        role: this.getRole(),
        isAdmin: this.isAdmin(),
        canOperate: this.canOperate()
      };
    },

    notifySubscribers: function () {
      const state = this.getState();
      this.subscribers.forEach(cb => {
        try { cb(state); } catch (e) { console.error(e); }
      });
      document.dispatchEvent(new CustomEvent('scadaAuthChanged', { detail: state }));
      this.updateNavbarIndicator();
      this.updateAccessGate();
    },

    // Inicio de Sesión
    login: async function (identifier, password) {
      if (!window.firebase || !firebase.auth) {
        throw new Error('Servicio de autenticación no disponible');
      }

      try {
        if (firebase.auth().setPersistence) {
          await firebase.auth().setPersistence(firebase.auth.Auth.Persistence.LOCAL);
        }
      } catch (pErr) {
        console.warn('[ScadaAuth] Error configurando persistencia LOCAL:', pErr);
      }

      let email = String(identifier || '').trim();
      if (!email.includes('@')) {
        email = `${email}@ford.mx`;
      }

      const cred = await firebase.auth().signInWithEmailAndPassword(email, password);
      const user = cred.user;

      // Consultar perfil en Firestore
      const userDocRef = firebase.firestore().collection('users').doc(user.uid);
      const docSnap = await userDocRef.get();

      let profileData = null;
      if (!docSnap.exists) {
        // Inicializar perfil si es un admin conocido o usuario existente de Firebase Auth
        const isMasterAdmin = (email.toLowerCase() === 'adminbot@ford.mx' || email.toLowerCase() === 'admin@ford.mx');
        profileData = {
          email: user.email,
          displayName: user.displayName || user.email.split('@')[0],
          role: isMasterAdmin ? 'admin' : 'viewer',
          status: isMasterAdmin ? 'active' : 'pending',
          createdAt: firebase.firestore.FieldValue.serverTimestamp(),
          lastLoginAt: firebase.firestore.FieldValue.serverTimestamp()
        };
        try {
          await userDocRef.set(profileData);
        } catch (setErr) {
          console.warn('[ScadaAuth] Error al inicializar perfil:', setErr.message);
        }
      } else {
        profileData = docSnap.data();
      }

      // Validar estado de la cuenta
      if (profileData.status === 'pending') {
        await firebase.auth().signOut();
        throw new Error('CUENTA_PENDIENTE: Tu cuenta fue creada pero requiere autorización por el Administrador (Cesar). Por favor contacta al administrador para habilitar tu acceso.');
      }

      if (profileData.status === 'disabled') {
        await firebase.auth().signOut();
        throw new Error('CUENTA_SUSPENDIDA: Tu acceso ha sido desactivado por el Administrador. Contacta a supervisión de planta.');
      }

      // Actualizar último login
      try {
        await userDocRef.update({
          lastLoginAt: firebase.firestore.FieldValue.serverTimestamp()
        });
      } catch (e) {}

      this.user = user;
      this.profile = profileData;
      this.notifySubscribers();
      return { user, profile: profileData };
    },

    // Registro de Nuevo Usuario
    register: async function ({ email, password, displayName, requestedArea, requestedRole, requestNote }) {
      if (!window.firebase || !firebase.auth) {
        throw new Error('Servicio de autenticación no disponible');
      }

      const cleanEmail = String(email || '').trim().toLowerCase();
      if (!cleanEmail || !cleanEmail.includes('@')) {
        throw new Error('Ingresa un correo electrónico válido');
      }

      if (!password || password.length < 6) {
        throw new Error('La contraseña debe tener al menos 6 caracteres');
      }

      // Crear usuario en Firebase Auth
      const cred = await firebase.auth().createUserWithEmailAndPassword(cleanEmail, password);
      const user = cred.user;

      // Actualizar display name en Auth
      if (displayName) {
        try {
          await user.updateProfile({ displayName: displayName.trim() });
        } catch (e) {}
      }

      // Guardar perfil en colección 'users' con status PENDIENTE
      const profileData = {
        email: cleanEmail,
        displayName: (displayName || cleanEmail.split('@')[0]).trim(),
        role: 'viewer', // Rol inicial seguro hasta aprobación
        status: 'pending', // Requiere aprobación del Administrador
        requestedArea: requestedArea || 'General',
        requestNote: (requestNote || '').trim(),
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
      };

      await firebase.firestore().collection('users').doc(user.uid).set(profileData);

      // Desconectar inmediatamente para que no tenga sesión activa sin aprobación
      await firebase.auth().signOut();
      this.user = null;
      this.profile = null;
      this.notifySubscribers();

      return {
        success: true,
        message: 'Solicitud de acceso enviada correctamente. Tu cuenta está en espera de aprobación por el Administrador.'
      };
    },

    // Cierre de Sesión
    logout: async function () {
      if (window.firebase && firebase.auth) {
        await firebase.auth().signOut();
      }
      sessionStorage.removeItem('adminSessionToken');
      sessionStorage.removeItem('adminAuthenticated');
      this.user = null;
      this.profile = null;
      this.notifySubscribers();

      // Si estaba en admin.html, redirigir a index
      if (window.location.pathname.includes('admin.html')) {
        window.location.href = 'index.html';
      }
    },

    // Abrir Modal de Autenticación
    openAuthModal: function (tab = 'login') {
      const modalEl = document.getElementById('scadaAuthModal');
      if (!modalEl) {
        this.injectAuthModal();
      }
      const bsModal = bootstrap.Modal.getOrCreateInstance(document.getElementById('scadaAuthModal'));
      
      const tabLoginBtn = document.getElementById('scadaAuthTabLoginBtn');
      const tabRegisterBtn = document.getElementById('scadaAuthTabRegisterBtn');
      if (tab === 'register' && tabRegisterBtn) {
        bootstrap.Tab.getOrCreateInstance(tabRegisterBtn).show();
      } else if (tabLoginBtn) {
        bootstrap.Tab.getOrCreateInstance(tabLoginBtn).show();
      }

      bsModal.show();
    },

    // Actualizar indicador en Navbar
    updateNavbarIndicator: function () {
      const rightSlot = document.getElementById('siteNavbarRight');
      if (!rightSlot) return;

      let authPill = document.getElementById('scadaNavbarAuthPill');
      if (!authPill) {
        authPill = document.createElement('div');
        authPill.id = 'scadaNavbarAuthPill';
        authPill.className = 'd-flex align-items-center';
        rightSlot.prepend(authPill);
      }

      if (this.isAuthenticated()) {
        const roleBadgeClass = this.isAdmin() 
          ? 'bg-danger text-white' 
          : (this.isSupervisor() ? 'bg-warning text-dark' : 'bg-primary text-white');
        
        authPill.innerHTML = `
          <div class="dropdown">
            <button class="btn btn-sm btn-outline-light dropdown-toggle d-flex align-items-center gap-1 font-mono py-1 px-2" 
                    type="button" id="scadaUserDropdownBtn" data-bs-toggle="dropdown" aria-expanded="false"
                    style="border-color: rgba(56, 189, 248, 0.4); background: rgba(15, 23, 42, 0.7); font-size: 0.78rem;">
              <i class="bi bi-person-check-fill text-info"></i>
              <span class="d-none d-sm-inline fw-semibold">${this.getUserName()}</span>
              <span class="badge ${roleBadgeClass} font-mono ms-1" style="font-size: 0.65rem;">${this.getRole()}</span>
            </button>
            <ul class="dropdown-menu dropdown-menu-dark dropdown-menu-end shadow-lg" aria-labelledby="scadaUserDropdownBtn" style="min-width: 230px; border: 1px solid rgba(56, 189, 248, 0.3);">
              <li class="px-3 py-2 border-bottom border-secondary border-opacity-25">
                <div class="fw-bold text-white small">${this.getUserName()}</div>
                <div class="text-muted font-mono" style="font-size: 0.7rem;">${this.user.email}</div>
                <div class="mt-1"><span class="badge ${roleBadgeClass}">Rol: ${this.getRole().toUpperCase()}</span></div>
              </li>
              ${this.isAdmin() ? `
                <li>
                  <a class="dropdown-item py-2" href="admin.html#users-mgmt">
                    <i class="bi bi-people-fill text-warning me-2"></i>Gestión de Usuarios
                  </a>
                </li>
                <li>
                  <a class="dropdown-item py-2" href="admin.html">
                    <i class="bi bi-sliders text-info me-2"></i>Panel de Administración
                  </a>
                </li>
              ` : ''}
              <li><hr class="dropdown-divider my-1"></li>
              <li>
                <button class="dropdown-item py-2 text-danger" onclick="window.ScadaAuth.logout()">
                  <i class="bi bi-box-arrow-right me-2"></i>Cerrar Sesión
                </button>
              </li>
            </ul>
          </div>
        `;
      } else {
        authPill.innerHTML = `
          <button class="btn btn-sm btn-primary d-flex align-items-center gap-1 font-mono py-1 px-2"
                  onclick="window.ScadaAuth.openAuthModal('login')"
                  style="font-size: 0.78rem; background: linear-gradient(135deg, #0284c7, #2563eb); border: 1px solid rgba(56, 189, 248, 0.4);">
            <i class="bi bi-shield-lock-fill"></i>
            <span class="d-none d-sm-inline">Ingresar / Registro</span>
          </button>
        `;
      }
    },

    // Páginas exentas de control de acceso (Públicas según especificación de Cesar)
    isPublicPage: function () {
      const path = (window.location.pathname || '').toLowerCase();
      return path.includes('sistema-andon.html') || path.includes('guia.html');
    },

    // Bloqueo visual industrial si la página no es pública y el usuario no está activo
    updateAccessGate: function () {
      if (this.isPublicPage()) return;

      let gate = document.getElementById('scadaAuthRequiredGate');

      if (!this.isAuthenticated()) {
        if (!gate) {
          gate = document.createElement('div');
          gate.id = 'scadaAuthRequiredGate';
          gate.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            width: 100vw;
            height: 100vh;
            background: rgba(7, 9, 14, 0.94);
            backdrop-filter: blur(16px);
            -webkit-backdrop-filter: blur(16px);
            z-index: 1040;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 20px;
          `;
          gate.innerHTML = `
            <div class="card p-4 p-md-5 text-center shadow-lg border-0" style="max-width: 480px; width: 100%; background: #0e121b; border: 1px solid rgba(56, 189, 248, 0.25) !important; border-radius: 16px; box-shadow: 0 25px 60px rgba(0,0,0,0.8) !important;">
              <div class="mb-3 d-inline-flex align-items-center justify-content-center mx-auto" style="width: 64px; height: 64px; border-radius: 50%; background: rgba(56, 189, 248, 0.1); border: 1px solid rgba(56, 189, 248, 0.3);">
                <i class="bi bi-shield-lock-fill text-warning fs-2"></i>
              </div>
              <h4 class="text-white fw-bold mb-1 font-heading" style="letter-spacing: -0.01em;">SCADA PRO • Acceso Restringido</h4>
              <p class="text-secondary small font-mono mb-4" style="line-height: 1.5;">
                Inicia sesión con tu cuenta corporativa para consultar el estado de grúas, estaciones y telemetría operativa en vivo.
              </p>
              <div class="d-grid gap-2 mb-4">
                <button class="btn btn-primary btn-lg fw-bold font-mono py-2" onclick="window.ScadaAuth.openAuthModal('login')" style="background: linear-gradient(135deg, #0284c7, #2563eb); border: none; font-size: 0.95rem;">
                  <i class="bi bi-box-arrow-in-right me-2"></i> Iniciar Sesión Corporativa
                </button>
                <button class="btn btn-outline-info font-mono py-2" onclick="window.ScadaAuth.openAuthModal('register')" style="font-size: 0.9rem;">
                  <i class="bi bi-person-plus me-2"></i> Solicitar Registro de Personal
                </button>
              </div>
              <div class="border-top border-secondary border-opacity-25 pt-3">
                <div class="text-muted small font-mono mb-2">Vistas Públicas de Demostración:</div>
                <div class="d-flex justify-content-center gap-2 flex-wrap">
                  <a href="sistema-andon.html" class="btn btn-sm btn-outline-warning font-mono">
                    <i class="bi bi-stars me-1"></i> Sistema Andon 4.0
                  </a>
                  <a href="guia.html" class="btn btn-sm btn-outline-light font-mono">
                    <i class="bi bi-compass me-1"></i> Guía Interactiva
                  </a>
                </div>
              </div>
            </div>
          `;
          document.body.appendChild(gate);
        }
      } else {
        if (gate) {
          gate.style.opacity = '0';
          gate.style.transition = 'opacity 0.3s ease';
          setTimeout(() => gate.remove(), 300);
        }
      }
    },

    // Inyectar el Modal Universal en el DOM
    injectAuthModal: function () {
      if (document.getElementById('scadaAuthModal')) return;

      const modalHtml = `
      <div class="modal fade" id="scadaAuthModal" tabindex="-1" aria-labelledby="scadaAuthModalLabel" aria-hidden="true" data-bs-backdrop="static">
        <div class="modal-dialog modal-dialog-centered">
          <div class="modal-content" style="background: #0d1117; border: 1px solid rgba(56, 189, 248, 0.3); box-shadow: 0 25px 60px rgba(0,0,0,0.85); color: #e2e8f0;">
            
            <div class="modal-header border-bottom border-secondary border-opacity-25 pb-2">
              <div class="d-flex align-items-center gap-2">
                <div class="p-2 rounded-circle" style="background: rgba(56, 189, 248, 0.15); border: 1px solid rgba(56, 189, 248, 0.3);">
                  <i class="bi bi-shield-lock text-cyan fs-5"></i>
                </div>
                <div>
                  <h5 class="modal-title fs-6 fw-bold text-white mb-0" id="scadaAuthModalLabel">Control de Acceso SCADA</h5>
                  <div class="text-muted font-mono" style="font-size: 0.7rem;">Autenticación Segura & Registro de Personal</div>
                </div>
              </div>
              <button type="button" class="btn-close btn-close-white" data-bs-dismiss="modal" aria-label="Cerrar"></button>
            </div>

            <div class="modal-body p-4">
              <!-- Navegación entre Pestañas: Login / Registro -->
              <ul class="nav nav-pills nav-fill mb-3 p-1 rounded-3" style="background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.08);" role="tablist">
                <li class="nav-item" role="presentation">
                  <button class="nav-link active font-mono py-2" id="scadaAuthTabLoginBtn" data-bs-toggle="pill" data-bs-target="#scadaAuthTabLogin" type="button" role="tab" style="font-size: 0.8rem;">
                    <i class="bi bi-box-arrow-in-right me-1"></i> Iniciar Sesión
                  </button>
                </li>
                <li class="nav-item" role="presentation">
                  <button class="nav-link font-mono py-2" id="scadaAuthTabRegisterBtn" data-bs-toggle="pill" data-bs-target="#scadaAuthTabRegister" type="button" role="tab" style="font-size: 0.8rem;">
                    <i class="bi bi-person-plus me-1"></i> Solicitar Registro
                  </button>
                </li>
              </ul>

              <!-- Alerta de Respuesta del Modal -->
              <div id="scadaAuthAlert" class="alert py-2 px-3 small font-mono" style="display: none; border-radius: 8px;"></div>

              <div class="tab-content">
                <!-- FORMULARIO 1: LOGIN -->
                <div class="tab-pane fade show active" id="scadaAuthTabLogin" role="tabpanel">
                  <form id="scadaLoginForm" autocomplete="on">
                    <div class="mb-3">
                      <label class="form-label small text-muted font-mono mb-1">Usuario o Correo Electrónico</label>
                      <div class="input-group">
                        <span class="input-group-text bg-dark border-secondary border-opacity-50 text-muted"><i class="bi bi-person"></i></span>
                        <input type="text" class="form-control bg-dark text-white border-secondary border-opacity-50 font-mono" id="scadaLoginEmail" placeholder="adminbot@ford.mx o usuario" required autocomplete="username">
                      </div>
                    </div>
                    <div class="mb-3">
                      <label class="form-label small text-muted font-mono mb-1">Contraseña</label>
                      <div class="input-group">
                        <span class="input-group-text bg-dark border-secondary border-opacity-50 text-muted"><i class="bi bi-key"></i></span>
                        <input type="password" class="form-control bg-dark text-white border-secondary border-opacity-50" id="scadaLoginPassword" placeholder="••••••••" required autocomplete="current-password">
                      </div>
                    </div>
                    <div class="d-grid mt-4">
                      <button type="submit" class="btn btn-primary fw-bold font-mono py-2" id="scadaLoginSubmitBtn" style="background: linear-gradient(135deg, #0284c7, #2563eb); border: none;">
                        <i class="bi bi-shield-check me-1"></i> Ingresar de Forma Segura
                      </button>
                    </div>
                  </form>
                </div>

                <!-- FORMULARIO 2: REGISTRO -->
                <div class="tab-pane fade" id="scadaAuthTabRegister" role="tabpanel">
                  <form id="scadaRegisterForm" autocomplete="off">
                    <p class="text-muted small mb-3" style="font-size: 0.78rem;">
                      <i class="bi bi-info-circle text-info me-1"></i> Por seguridad de planta, cada registro queda en estado <strong class="text-warning">Pendiente</strong> hasta que sea aprobado por el Administrador (Cesar).
                    </p>
                    <div class="mb-2">
                      <label class="form-label small text-muted font-mono mb-1">Nombre Completo</label>
                      <input type="text" class="form-control form-control-sm bg-dark text-white border-secondary border-opacity-50" id="scadaRegName" placeholder="Ing. Juan Pérez" required>
                    </div>
                    <div class="mb-2">
                      <label class="form-label small text-muted font-mono mb-1">Correo Electrónico Corporativo</label>
                      <input type="email" class="form-control form-control-sm bg-dark text-white border-secondary border-opacity-50 font-mono" id="scadaRegEmail" placeholder="jperez@empresa.com" required>
                    </div>
                    <div class="row g-2 mb-2">
                      <div class="col-6">
                        <label class="form-label small text-muted font-mono mb-1">Contraseña</label>
                        <input type="password" class="form-control form-control-sm bg-dark text-white border-secondary border-opacity-50" id="scadaRegPassword" placeholder="Mínimo 6 caracteres" minlength="6" required>
                      </div>
                      <div class="col-6">
                        <label class="form-label small text-muted font-mono mb-1">Área / Nave</label>
                        <select class="form-select form-select-sm bg-dark text-white border-secondary border-opacity-50 font-mono" id="scadaRegArea">
                          <option value="Mantenimiento Grúas">Mantenimiento Grúas</option>
                          <option value="Operaciones Planta">Operaciones Planta</option>
                          <option value="Nave Norte">Nave Norte</option>
                          <option value="Nave Sur">Nave Sur</option>
                          <option value="Almacén Refacciones">Almacén Refacciones</option>
                          <option value="Supervisión Turno">Supervisión Turno</option>
                        </select>
                      </div>
                    </div>
                    <div class="mb-3">
                      <label class="form-label small text-muted font-mono mb-1">Rol Solicitado</label>
                      <select class="form-select form-select-sm bg-dark text-white border-secondary border-opacity-50 font-mono" id="scadaRegRole">
                        <option value="tecnico">Técnico de Mantenimiento</option>
                        <option value="supervisor">Supervisor de Operación</option>
                        <option value="viewer">Operador / Visualizador</option>
                      </select>
                    </div>
                    <div class="d-grid mt-3">
                      <button type="submit" class="btn btn-success fw-bold font-mono py-2" id="scadaRegSubmitBtn" style="background: linear-gradient(135deg, #059669, #10b981); border: none;">
                        <i class="bi bi-send-check me-1"></i> Enviar Solicitud de Registro
                      </button>
                    </div>
                  </form>
                </div>
              </div>

            </div>
          </div>
        </div>
      </div>`;

      const div = document.createElement('div');
      div.innerHTML = modalHtml;
      document.body.appendChild(div.firstElementChild);

      this.bindModalEvents();
    },

    // Enlazar eventos del modal
    bindModalEvents: function () {
      const alertBox = document.getElementById('scadaAuthAlert');
      const formatAuthError = (err) => {
        if (!err) return 'Error en las credenciales proporcionadas.';
        let msg = typeof err === 'string' ? err : (err.message || '');
        
        // Extraer mensaje limpio si Firebase devuelve JSON crudo de identitytoolkit
        if (msg.includes('INVALID_LOGIN_CREDENTIALS') || (err.code && err.code.includes('invalid-credential'))) {
          return 'Usuario o contraseña incorrectos. Por favor verifica tus credenciales.';
        }
        if (msg.includes('user-not-found')) {
          return 'No existe una cuenta registrada con este usuario o correo.';
        }
        if (msg.includes('wrong-password')) {
          return 'Contraseña incorrecta. Por favor verifica tu clave de acceso.';
        }
        if (msg.includes('too-many-requests')) {
          return 'Demasiados intentos fallidos. El acceso ha sido bloqueado temporalmente por seguridad.';
        }
        if (msg.startsWith('{') && msg.includes('"error"')) {
          try {
            const parsed = JSON.parse(msg);
            if (parsed.error && parsed.error.message) {
              const code = parsed.error.message;
              if (code === 'INVALID_LOGIN_CREDENTIALS') return 'Usuario o contraseña incorrectos.';
              return code;
            }
          } catch (_) {}
        }
        return msg;
      };

      const showMsg = (msg, type = 'danger') => {
        if (!alertBox) return;
        alertBox.className = `alert alert-${type} py-2 px-3 small font-mono`;
        alertBox.textContent = msg;
        alertBox.style.display = 'block';
      };
      const hideMsg = () => {
        if (alertBox) alertBox.style.display = 'none';
      };

      // Formulario Login
      const loginForm = document.getElementById('scadaLoginForm');
      if (loginForm) {
        loginForm.addEventListener('submit', async (e) => {
          e.preventDefault();
          hideMsg();
          const btn = document.getElementById('scadaLoginSubmitBtn');
          const email = document.getElementById('scadaLoginEmail').value;
          const pass = document.getElementById('scadaLoginPassword').value;

          btn.disabled = true;
          btn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span> Verificando...';

          try {
            await ScadaAuth.login(email, pass);
            showMsg('¡Sesión iniciada con éxito! Accediendo...', 'success');
            setTimeout(() => {
              const modalEl = document.getElementById('scadaAuthModal');
              const bsModal = bootstrap.Modal.getInstance(modalEl);
              if (bsModal) bsModal.hide();
              window.location.reload();
            }, 600);
          } catch (err) {
            btn.disabled = false;
            btn.innerHTML = '<i class="bi bi-shield-check me-1"></i> Ingresar de Forma Segura';
            showMsg(formatAuthError(err), 'danger');
          }
        });
      }

      // Formulario Registro
      const regForm = document.getElementById('scadaRegisterForm');
      if (regForm) {
        regForm.addEventListener('submit', async (e) => {
          e.preventDefault();
          hideMsg();
          const btn = document.getElementById('scadaRegSubmitBtn');
          const name = document.getElementById('scadaRegName').value;
          const email = document.getElementById('scadaRegEmail').value;
          const pass = document.getElementById('scadaRegPassword').value;
          const area = document.getElementById('scadaRegArea').value;
          const role = document.getElementById('scadaRegRole').value;

          btn.disabled = true;
          btn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span> Registrando...';

          try {
            const res = await ScadaAuth.register({
              displayName: name,
              email: email,
              password: pass,
              requestedArea: area,
              requestedRole: role
            });
            showMsg(`✅ ${res.message}`, 'success');
            regForm.reset();
            btn.disabled = false;
            btn.innerHTML = '<i class="bi bi-send-check me-1"></i> Enviar Solicitud de Registro';
          } catch (err) {
            btn.disabled = false;
            btn.innerHTML = '<i class="bi bi-send-check me-1"></i> Enviar Solicitud de Registro';
            showMsg(formatAuthError(err), 'danger');
          }
        });
      }
    },

    // Inicialización del sistema al cargar
    init: function () {
      if (!window.firebase || !firebase.auth) {
        console.warn('[ScadaAuth] Firebase Auth SDK no encontrado');
        return;
      }

      this.injectAuthModal();

      firebase.auth().onAuthStateChanged(async (user) => {
        if (user) {
          try {
            const docSnap = await firebase.firestore().collection('users').doc(user.uid).get();
            if (docSnap.exists) {
              const profile = docSnap.data();
              if (profile.status === 'active') {
                this.user = user;
                this.profile = profile;
                console.log(`[ScadaAuth] Sesión verificada: ${user.email} (${profile.role})`);
              } else {
                console.warn(`[ScadaAuth] Usuario con estado no activo: ${profile.status}`);
                await firebase.auth().signOut();
                this.user = null;
                this.profile = null;
              }
            } else {
              // Si es adminbot@ford.mx inicializar perfil de admin activo
              if (user.email === 'adminbot@ford.mx' || user.email === 'admin@ford.mx') {
                const adminProfile = {
                  email: user.email,
                  displayName: 'Administrador Cesar',
                  role: 'admin',
                  status: 'active',
                  createdAt: firebase.firestore.FieldValue.serverTimestamp()
                };
                await firebase.firestore().collection('users').doc(user.uid).set(adminProfile);
                this.user = user;
                this.profile = adminProfile;
              } else {
                await firebase.auth().signOut();
                this.user = null;
                this.profile = null;
              }
            }
          } catch (err) {
            console.error('[ScadaAuth] Error verificando perfil de usuario:', err);
          }
        } else {
          this.user = null;
          this.profile = null;
        }

        this.isReady = true;
        this.notifySubscribers();
      });

      document.addEventListener('siteNavReady', () => {
        this.updateNavbarIndicator();
      });
    }
  };

  window.ScadaAuth = ScadaAuth;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => ScadaAuth.init());
  } else {
    ScadaAuth.init();
  }
})();

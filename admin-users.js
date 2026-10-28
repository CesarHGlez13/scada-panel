/**
 * ============================================================================
 * ADMIN SCADA PRO — GESTIÓN CENTRALIZADA DE USUARIOS, ROLES Y ACCESOS
 * ============================================================================
 * Permite al Administrador (Cesar) autorizar solicitudes de registro,
 * asignar roles (admin, supervisor, tecnico, viewer), activar/suspender
 * cuentas y dar de alta personal directamente desde la consola web.
 * ============================================================================
 */

(function () {
  'use strict';

  let usersList = [];
  let unsubscribeUsers = null;
  let activeFilter = 'all';

  function initAdminUsersPanel() {
    const container = document.getElementById('users-mgmt');
    if (!container) return;

    renderUsersPanelSkeleton();
    listenUsersCollection();
  }

  function renderUsersPanelSkeleton() {
    const container = document.getElementById('users-mgmt');
    if (!container) return;

    container.innerHTML = `
      <div class="row g-3 mb-4">
        <!-- KPI 1: Total Usuarios -->
        <div class="col-sm-6 col-xl-3">
          <div class="card bg-dark border-secondary border-opacity-25 shadow-sm h-100">
            <div class="card-body p-3 d-flex align-items-center justify-content-between">
              <div>
                <span class="text-muted font-mono small text-uppercase" style="font-size: 0.72rem;">Total Registrados</span>
                <div class="fs-3 fw-bold text-white font-mono mt-1" id="kpiTotalUsers">-</div>
              </div>
              <div class="p-3 rounded-circle" style="background: rgba(56, 189, 248, 0.12); color: #38bdf8;">
                <i class="bi bi-people-fill fs-4"></i>
              </div>
            </div>
          </div>
        </div>

        <!-- KPI 2: Activos -->
        <div class="col-sm-6 col-xl-3">
          <div class="card bg-dark border-secondary border-opacity-25 shadow-sm h-100">
            <div class="card-body p-3 d-flex align-items-center justify-content-between">
              <div>
                <span class="text-muted font-mono small text-uppercase" style="font-size: 0.72rem;">Usuarios Activos</span>
                <div class="fs-3 fw-bold text-success font-mono mt-1" id="kpiActiveUsers">-</div>
              </div>
              <div class="p-3 rounded-circle" style="background: rgba(16, 185, 129, 0.12); color: #10b981;">
                <i class="bi bi-shield-check fs-4"></i>
              </div>
            </div>
          </div>
        </div>

        <!-- KPI 3: Pendientes -->
        <div class="col-sm-6 col-xl-3">
          <div class="card bg-dark border-secondary border-opacity-25 shadow-sm h-100">
            <div class="card-body p-3 d-flex align-items-center justify-content-between">
              <div>
                <span class="text-muted font-mono small text-uppercase" style="font-size: 0.72rem;">Pendientes de Aprobación</span>
                <div class="fs-3 fw-bold text-warning font-mono mt-1" id="kpiPendingUsers">-</div>
              </div>
              <div class="p-3 rounded-circle" style="background: rgba(245, 158, 11, 0.12); color: #f59e0b;">
                <i class="bi bi-clock-history fs-4"></i>
              </div>
            </div>
          </div>
        </div>

        <!-- KPI 4: Administradores -->
        <div class="col-sm-6 col-xl-3">
          <div class="card bg-dark border-secondary border-opacity-25 shadow-sm h-100">
            <div class="card-body p-3 d-flex align-items-center justify-content-between">
              <div>
                <span class="text-muted font-mono small text-uppercase" style="font-size: 0.72rem;">Supervisores y Admins</span>
                <div class="fs-3 fw-bold text-info font-mono mt-1" id="kpiAdminUsers">-</div>
              </div>
              <div class="p-3 rounded-circle" style="background: rgba(99, 102, 241, 0.12); color: #6366f1;">
                <i class="bi bi-shield-lock-fill fs-4"></i>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Barra de Herramientas y Filtros -->
      <div class="card bg-dark border-secondary border-opacity-25 shadow-sm mb-4">
        <div class="card-body p-3">
          <div class="d-flex flex-column flex-md-row justify-content-between align-items-md-center gap-3">
            <div class="d-flex align-items-center gap-2 flex-wrap">
              <span class="text-muted small font-mono me-1"><i class="bi bi-funnel"></i> Filtrar:</span>
              <button type="button" class="btn btn-sm btn-outline-light active font-mono user-filter-btn" data-filter="all">Todos</button>
              <button type="button" class="btn btn-sm btn-outline-warning font-mono user-filter-btn position-relative" data-filter="pending">
                Pendientes <span class="badge bg-warning text-dark ms-1" id="pendingFilterBadge" style="display:none;">0</span>
              </button>
              <button type="button" class="btn btn-sm btn-outline-success font-mono user-filter-btn" data-filter="active">Activos</button>
              <button type="button" class="btn btn-sm btn-outline-danger font-mono user-filter-btn" data-filter="disabled">Suspendidos</button>
            </div>

            <div class="d-flex align-items-center gap-2">
              <button type="button" class="btn btn-sm btn-primary font-mono fw-bold" onclick="window.openCreateUserModal()">
                <i class="bi bi-person-plus-fill me-1"></i> + Alta Directa de Usuario
              </button>
              <button type="button" class="btn btn-sm btn-outline-secondary font-mono" onclick="window.refreshAdminUsers()">
                <i class="bi bi-arrow-clockwise"></i>
              </button>
            </div>
          </div>
        </div>
      </div>

      <!-- Tabla de Usuarios Registrados -->
      <div class="card bg-dark border-secondary border-opacity-25 shadow-sm">
        <div class="card-header bg-dark border-secondary border-opacity-25 d-flex justify-content-between align-items-center py-3">
          <h5 class="mb-0 fs-6 fw-bold text-white">
            <i class="bi bi-person-lines-fill text-info me-2"></i>Catálogo de Usuarios y Permisos SCADA
          </h5>
          <span class="badge bg-secondary font-mono" id="usersCountBadge">0 usuarios</span>
        </div>
        <div class="table-responsive">
          <table class="table table-dark table-hover align-middle mb-0 font-mono" style="font-size: 0.82rem;">
            <thead class="table-dark" style="border-bottom: 2px solid rgba(255,255,255,0.1);">
              <tr>
                <th style="min-width: 220px;">Usuario / Operador</th>
                <th>Rol SCADA</th>
                <th>Estado</th>
                <th>Área de Planta</th>
                <th>Fecha de Registro</th>
                <th class="text-end" style="min-width: 180px;">Acciones de Control</th>
              </tr>
            </thead>
            <tbody id="adminUsersTableBody">
              <tr>
                <td colspan="6" class="text-center py-4 text-muted">
                  <span class="spinner-border spinner-border-sm me-2"></span> Cargando catálogo de usuarios...
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <!-- Modal de Creación Directa de Usuario -->
      <div class="modal fade" id="adminCreateUserModal" tabindex="-1" aria-hidden="true">
        <div class="modal-dialog modal-dialog-centered">
          <div class="modal-content" style="background: #0f172a; border: 1px solid rgba(56, 189, 248, 0.3); color: #e2e8f0;">
            <div class="modal-header border-bottom border-secondary border-opacity-25">
              <h5 class="modal-title fs-6 fw-bold text-white">
                <i class="bi bi-person-plus text-info me-2"></i>Alta Directa de Usuario SCADA
              </h5>
              <button type="button" class="btn-close btn-close-white" data-bs-dismiss="modal"></button>
            </div>
            <div class="modal-body p-4">
              <form id="adminCreateUserForm">
                <div class="mb-3">
                  <label class="form-label small text-muted font-mono mb-1">Nombre Completo</label>
                  <input type="text" class="form-control form-control-sm bg-dark text-white border-secondary border-opacity-50" id="adminNewUserName" placeholder="Ing. Carlos Mendoza" required>
                </div>
                <div class="mb-3">
                  <label class="form-label small text-muted font-mono mb-1">Correo Electrónico</label>
                  <input type="email" class="form-control form-control-sm bg-dark text-white border-secondary border-opacity-50 font-mono" id="adminNewUserEmail" placeholder="cmendoza@ford.mx" required>
                </div>
                <div class="mb-3">
                  <label class="form-label small text-muted font-mono mb-1">Contraseña Inicial</label>
                  <input type="password" class="form-control form-control-sm bg-dark text-white border-secondary border-opacity-50" id="adminNewUserPassword" placeholder="Mínimo 6 caracteres" minlength="6" required>
                </div>
                <div class="row g-2 mb-3">
                  <div class="col-6">
                    <label class="form-label small text-muted font-mono mb-1">Área Asignada</label>
                    <input type="text" class="form-control form-control-sm bg-dark text-white border-secondary border-opacity-50 font-mono" id="adminNewUserArea" value="Mantenimiento Grúas" required>
                  </div>
                  <div class="col-6">
                    <label class="form-label small text-muted font-mono mb-1">Rol de Acceso</label>
                    <select class="form-select form-select-sm bg-dark text-white border-secondary border-opacity-50 font-mono" id="adminNewUserRole">
                      <option value="tecnico">Técnico</option>
                      <option value="supervisor">Supervisor</option>
                      <option value="viewer">Visualizador</option>
                      <option value="admin">Administrador</option>
                    </select>
                  </div>
                </div>
                <div class="alert alert-danger py-2 px-3 small font-mono" id="adminCreateUserError" style="display:none;"></div>
                <div class="d-grid mt-4">
                  <button type="submit" class="btn btn-primary fw-bold font-mono py-2" id="adminCreateUserSubmitBtn">
                    <i class="bi bi-check2-circle me-1"></i> Crear y Habilitar Acceso
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      </div>
    `;

    bindFilterEvents();
    bindCreateUserForm();
  }

  function listenUsersCollection() {
    if (!window.firebase || !firebase.firestore) return;

    if (unsubscribeUsers) {
      unsubscribeUsers();
    }

    const tbody = document.getElementById('adminUsersTableBody');
    if (!tbody) return;

    unsubscribeUsers = firebase.firestore().collection('users')
      .onSnapshot((snapshot) => {
        usersList = [];
        snapshot.forEach(doc => {
          usersList.push({ id: doc.id, ...doc.data() });
        });

        // Ordenar: primero pendientes, luego por fecha
        usersList.sort((a, b) => {
          if (a.status === 'pending' && b.status !== 'pending') return -1;
          if (a.status !== 'pending' && b.status === 'pending') return 1;
          const timeA = a.createdAt ? (a.createdAt.toMillis ? a.createdAt.toMillis() : a.createdAt._seconds * 1000) : 0;
          const timeB = b.createdAt ? (b.createdAt.toMillis ? b.createdAt.toMillis() : b.createdAt._seconds * 1000) : 0;
          return timeB - timeA;
        });

        updateKpis();
        renderUsersTable();
      }, (err) => {
        console.error('[AdminUsers] Error al escuchar usuarios:', err);
        if (tbody) {
          tbody.innerHTML = `<tr><td colspan="6" class="text-center py-4 text-danger"><i class="bi bi-exclamation-triangle me-2"></i>Error al leer usuarios: ${err.message}</td></tr>`;
        }
      });
  }

  function updateKpis() {
    const total = usersList.length;
    const active = usersList.filter(u => u.status === 'active').length;
    const pending = usersList.filter(u => u.status === 'pending').length;
    const admins = usersList.filter(u => u.role === 'admin' || u.role === 'supervisor').length;

    const elTotal = document.getElementById('kpiTotalUsers');
    const elActive = document.getElementById('kpiActiveUsers');
    const elPending = document.getElementById('kpiPendingUsers');
    const elAdmin = document.getElementById('kpiAdminUsers');
    const badge = document.getElementById('pendingFilterBadge');

    if (elTotal) elTotal.textContent = total;
    if (elActive) elActive.textContent = active;
    if (elPending) elPending.textContent = pending;
    if (elAdmin) elAdmin.textContent = admins;

    if (badge) {
      if (pending > 0) {
        badge.textContent = pending;
        badge.style.display = 'inline-block';
      } else {
        badge.style.display = 'none';
      }
    }
  }

  function renderUsersTable() {
    const tbody = document.getElementById('adminUsersTableBody');
    const countBadge = document.getElementById('usersCountBadge');
    if (!tbody) return;

    let filtered = usersList;
    if (activeFilter !== 'all') {
      filtered = usersList.filter(u => u.status === activeFilter);
    }

    if (countBadge) {
      countBadge.textContent = `${filtered.length} ${filtered.length === 1 ? 'usuario' : 'usuarios'}`;
    }

    if (filtered.length === 0) {
      tbody.innerHTML = `<tr><td colspan="6" class="text-center py-4 text-muted"><i class="bi bi-inbox me-2"></i>No hay usuarios en la categoría seleccionada (${activeFilter}).</td></tr>`;
      return;
    }

    tbody.innerHTML = filtered.map(u => {
      const isPending = u.status === 'pending';
      const isActive = u.status === 'active';
      const isDisabled = u.status === 'disabled';

      let statusBadge = '';
      if (isPending) {
        statusBadge = `<span class="badge bg-warning text-dark border border-warning"><i class="bi bi-hourglass-split"></i> Pendiente</span>`;
      } else if (isActive) {
        statusBadge = `<span class="badge bg-success-subtle text-success border border-success"><i class="bi bi-check-circle"></i> Activo</span>`;
      } else {
        statusBadge = `<span class="badge bg-danger-subtle text-danger border border-danger"><i class="bi bi-slash-circle"></i> Suspendido</span>`;
      }

      let dateFormatted = '-';
      if (u.createdAt) {
        const d = u.createdAt.toDate ? u.createdAt.toDate() : new Date((u.createdAt._seconds || 0) * 1000);
        dateFormatted = d.toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
      }

      const roleBadgeClasses = {
        admin: 'bg-danger text-white',
        supervisor: 'bg-warning text-dark',
        tecnico: 'bg-primary text-white',
        viewer: 'bg-secondary text-white'
      };

      const roleClass = roleBadgeClasses[u.role] || 'bg-secondary text-white';

      return `
        <tr class="${isPending ? 'table-warning bg-opacity-10' : ''}">
          <td>
            <div class="d-flex align-items-center gap-2">
              <div class="rounded-circle p-2 d-flex align-items-center justify-content-center" style="width: 34px; height: 34px; background: rgba(56, 189, 248, 0.15); color: #38bdf8; font-weight: bold;">
                ${(u.displayName || u.email || 'U').charAt(0).toUpperCase()}
              </div>
              <div>
                <div class="fw-bold text-white">${u.displayName || 'Sin Nombre'}</div>
                <div class="text-muted small">${u.email}</div>
              </div>
            </div>
          </td>
          <td>
            <select class="form-select form-select-sm bg-dark text-white border-secondary border-opacity-50 font-mono py-0 px-2"
                    onchange="window.changeAdminUserRole('${u.id}', this.value)" style="font-size: 0.75rem; width: auto;">
              <option value="tecnico" ${u.role === 'tecnico' || u.role === 'technician' ? 'selected' : ''}>Técnico</option>
              <option value="supervisor" ${u.role === 'supervisor' ? 'selected' : ''}>Supervisor</option>
              <option value="viewer" ${u.role === 'viewer' ? 'selected' : ''}>Visualizador</option>
              <option value="admin" ${u.role === 'admin' ? 'selected' : ''}>Administrador</option>
            </select>
          </td>
          <td>${statusBadge}</td>
          <td><span class="text-light">${u.requestedArea || u.area || 'Planta'}</span></td>
          <td class="text-muted small">${dateFormatted}</td>
          <td class="text-end">
            <div class="btn-group btn-group-sm">
              ${isPending ? `
                <button type="button" class="btn btn-success font-mono btn-sm px-2" onclick="window.approveAdminUser('${u.id}', '${u.requestedRole || 'tecnico'}')" title="Aprobar Acceso">
                  <i class="bi bi-check-lg"></i> Aprobar
                </button>
              ` : ''}
              ${isActive ? `
                <button type="button" class="btn btn-outline-warning font-mono btn-sm px-2" onclick="window.toggleAdminUserStatus('${u.id}', 'disabled')" title="Suspender Cuenta">
                  <i class="bi bi-pause-fill"></i> Suspender
                </button>
              ` : ''}
              ${isDisabled ? `
                <button type="button" class="btn btn-outline-success font-mono btn-sm px-2" onclick="window.toggleAdminUserStatus('${u.id}', 'active')" title="Reactivar Cuenta">
                  <i class="bi bi-play-fill"></i> Reactivar
                </button>
              ` : ''}
              <button type="button" class="btn btn-outline-danger font-mono btn-sm px-2" onclick="window.deleteAdminUser('${u.id}', '${u.email}')" title="Eliminar Registro">
                <i class="bi bi-trash"></i>
              </button>
            </div>
          </td>
        </tr>
      `;
    }).join('');
  }

  function bindFilterEvents() {
    const filterBtns = document.querySelectorAll('.user-filter-btn');
    filterBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        filterBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        activeFilter = btn.dataset.filter || 'all';
        renderUsersTable();
      });
    });
  }

  function bindCreateUserForm() {
    const form = document.getElementById('adminCreateUserForm');
    if (!form) return;

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const errBox = document.getElementById('adminCreateUserError');
      const submitBtn = document.getElementById('adminCreateUserSubmitBtn');

      if (errBox) errBox.style.display = 'none';
      submitBtn.disabled = true;
      submitBtn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span> Creando...';

      const name = document.getElementById('adminNewUserName').value.trim();
      const email = document.getElementById('adminNewUserEmail').value.trim().toLowerCase();
      const pass = document.getElementById('adminNewUserPassword').value;
      const area = document.getElementById('adminNewUserArea').value.trim();
      const role = document.getElementById('adminNewUserRole').value;

      try {
        // Para crear un usuario secundario sin desloguear al admin actual, usamos una app secundaria temporal de Firebase
        let secondaryApp = null;
        try {
          secondaryApp = firebase.app('AdminUserCreator');
        } catch (e) {
          secondaryApp = firebase.initializeApp(firebaseConfig, 'AdminUserCreator');
        }

        const cred = await secondaryApp.auth().createUserWithEmailAndPassword(email, pass);
        const newUid = cred.user.uid;

        // Escribir perfil en Firestore de la app principal
        await firebase.firestore().collection('users').doc(newUid).set({
          displayName: name,
          email: email,
          role: role,
          status: 'active', // Directamente activo porque lo crea el Administrador
          area: area,
          requestedArea: area,
          createdAt: firebase.firestore.FieldValue.serverTimestamp(),
          createdBy: firebase.auth().currentUser ? firebase.auth().currentUser.email : 'admin'
        });

        // Desconectar app secundaria para limpiar memoria
        await secondaryApp.auth().signOut();

        const modalEl = document.getElementById('adminCreateUserModal');
        const modal = bootstrap.Modal.getInstance(modalEl);
        if (modal) modal.hide();
        form.reset();
        alert(`✅ Usuario ${email} creado y activado exitosamente con rol ${role.toUpperCase()}.`);
      } catch (err) {
        if (errBox) {
          errBox.textContent = `Error: ${err.message}`;
          errBox.style.display = 'block';
        }
      } finally {
        submitBtn.disabled = false;
        submitBtn.innerHTML = '<i class="bi bi-check2-circle me-1"></i> Crear y Habilitar Acceso';
      }
    });
  }

  // Métodos expuestos a la ventana para eventos inline
  window.openCreateUserModal = function () {
    const modal = bootstrap.Modal.getOrCreateInstance(document.getElementById('adminCreateUserModal'));
    modal.show();
  };

  window.refreshAdminUsers = function () {
    listenUsersCollection();
  };

  window.approveAdminUser = async function (uid, defaultRole = 'tecnico') {
    if (!confirm(`¿Confirmas la APROBACIÓN de acceso para este usuario con rol ${defaultRole.toUpperCase()}?`)) return;
    try {
      await firebase.firestore().collection('users').doc(uid).update({
        status: 'active',
        role: defaultRole,
        approvedAt: firebase.firestore.FieldValue.serverTimestamp(),
        approvedBy: firebase.auth().currentUser ? firebase.auth().currentUser.email : 'admin'
      });
    } catch (err) {
      alert(`Error al aprobar usuario: ${err.message}`);
    }
  };

  window.changeAdminUserRole = async function (uid, newRole) {
    try {
      await firebase.firestore().collection('users').doc(uid).update({
        role: newRole,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      });
      console.log(`[AdminUsers] Rol actualizado para ${uid} -> ${newRole}`);
    } catch (err) {
      alert(`Error al cambiar rol: ${err.message}`);
    }
  };

  window.toggleAdminUserStatus = async function (uid, newStatus) {
    const actionText = newStatus === 'active' ? 'REACTIVAR' : 'SUSPENDER';
    if (!confirm(`¿Deseas ${actionText} el acceso para este usuario?`)) return;
    try {
      await firebase.firestore().collection('users').doc(uid).update({
        status: newStatus,
        statusUpdatedAt: firebase.firestore.FieldValue.serverTimestamp()
      });
    } catch (err) {
      alert(`Error al cambiar estado: ${err.message}`);
    }
  };

  window.deleteAdminUser = async function (uid, email) {
    if (!confirm(`¿Estás SEGURO de eliminar el perfil de ${email}?\nEsta acción no se puede deshacer.`)) return;
    try {
      await firebase.firestore().collection('users').doc(uid).delete();
    } catch (err) {
      alert(`Error al eliminar usuario: ${err.message}`);
    }
  };

  window.initAdminUsersPanel = initAdminUsersPanel;

  // Enlazar al abrir la pestaña en admin.html
  document.addEventListener('DOMContentLoaded', () => {
    const usersTab = document.getElementById('users-mgmt-tab');
    if (usersTab) {
      usersTab.addEventListener('shown.bs.tab', () => {
        initAdminUsersPanel();
      });
    }
    if (location.hash === '#users-mgmt' || location.hash === '#users') {
      if (usersTab) bootstrap.Tab.getOrCreateInstance(usersTab).show();
    }
  });

})();

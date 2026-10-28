/**
 * PocketBase to Firestore Compatibility Adapter
 * SCADA Siderúrgico 4.0 - Misión Crítica
 * 
 * Permite que todo el frontend (admin.js, cranes.js, andon-tv.js, plant-map.js, etc.)
 * funcione nativamente contra el servidor autónomo PocketBase (Xiaomi Mi 11 Lite)
 * sin requerir cambios en la lógica de negocio ni dependencias externas de Google Cloud.
 */

(function (window) {
  'use strict';

  // En Cloudflare Quick Tunnel (.trycloudflare.com), las conexiones EventSource (SSE)
  // son cortadas por el proxy de Cloudflare tras ~15s y lanzan:
  // "Uncaught (in promise) ClientResponseError 0: EventSource connect took too long".
  // Por eso, cuando la página corre sobre túnel remoto usamos polling HTTP silencioso (cada 6s)
  // igual que en pocketbase-backend-adapter.js, y en LAN local usamos SSE nativo con fallback.
  const IS_TUNNEL_HOST = (
    typeof window !== 'undefined' &&
    window.location &&
    window.location.hostname &&
    !window.location.hostname.startsWith('192.168.') &&
    !window.location.hostname.startsWith('10.') &&
    !window.location.hostname.startsWith('172.') &&
    window.location.hostname !== 'localhost' &&
    window.location.hostname !== '127.0.0.1'
  );
  const POLLING_INTERVAL_MS = 6000;
  const DEFAULT_PB_URL = window.SCADA_PB_URL || 'http://192.168.100.34:8090';

  function genPbId() {
    const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
    let out = '';
    for (let i = 0; i < 15; i++) {
      out += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return out;
  }

  // Firestore entrega los campos de fecha como objetos Timestamp con .toDate(); PocketBase
  // devuelve strings ISO. El frontend usa `.toDate()` en más de 100 sitios, así que se envuelve
  // el valor en un Timestamp compatible (toString/toJSON devuelven el ISO original para que el
  // texto plano siga funcionando).
  const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/;

  // Cache de esquema por colección (ver PBCollectionReference._filterFor). Se persiste en
  // localStorage para que el 400 de la sonda ocurra una sola vez (en la primera carga) y no
  // en cada página. localStorage está disponible en todos los navegadores objetivo; si no
  // lo está, se usa solo la memoria.
  const SCHEMA_CACHE_KEY = 'pb_schema_cache';
  let SCOPE_SCHEMA_CACHE = {};
  try {
    SCOPE_SCHEMA_CACHE = JSON.parse(localStorage.getItem(SCHEMA_CACHE_KEY) || '{}') || {};
  } catch (e) {
    SCOPE_SCHEMA_CACHE = {};
  }
  function rememberSchema(collectionName, mode) {
    SCOPE_SCHEMA_CACHE[collectionName] = mode;
    try { localStorage.setItem(SCHEMA_CACHE_KEY, JSON.stringify(SCOPE_SCHEMA_CACHE)); } catch (e) { /* sin persistencia */ }
  }

  function wrapTimestamps(data) {
    if (!data || typeof data !== 'object') return data;
    const out = Array.isArray(data) ? [] : {};
    for (const [k, v] of Object.entries(data)) {
      if (typeof v === 'string' && ISO_DATE_RE.test(v)) {
        const d = new Date(v);
        if (!isNaN(d.getTime())) {
          out[k] = {
            seconds: Math.floor(d.getTime() / 1000),
            nanoseconds: 0,
            toDate: () => d,
            toMillis: () => d.getTime(),
            toString: () => v,
            toJSON: () => v,
            valueOf: () => v
          };
          continue;
        }
      }
      out[k] = Array.isArray(v) ? wrapTimestamps(v) : v;
    }
    return out;
  }

  function formatData(rec, collectionName) {
    if (!rec) return {};
    // Si es un documento config con { key, value }, desempaquetar value
    if (collectionName === 'config' && rec.key && rec.value !== undefined) {
      if (Array.isArray(rec.value)) {
        return wrapTimestamps({ reasons: rec.value, value: rec.value, key: rec.key });
      }
      if (typeof rec.value === 'object' && rec.value !== null) {
        return wrapTimestamps({ ...rec.value, key: rec.key });
      }
      return wrapTimestamps({ value: rec.value, key: rec.key });
    }
    const data = { ...rec };
    delete data.collectionId;
    delete data.collectionName;
    // Alias de compatibilidad: el frontend (cranes.js, analisis-detallado.js, app.js) lee los
    // campos 'reportedDate'/'resolvedDate' que Firebase usaba. PocketBase los almacena como
    // 'reportedAt'/'resolvedAt', y sin este alias el Historial de Grúas mostraba '-' para los
    // eventos reportados por botón desde los ESP32 (no encontraba el inicio de la falla).
    if (data.reportedAt && !data.reportedDate) data.reportedDate = data.reportedAt;
    if (data.resolvedAt && !data.resolvedDate) data.resolvedDate = data.resolvedAt;
    return wrapTimestamps(data);
  }

  class PocketBaseFirestoreAdapter {
    constructor(baseUrl = DEFAULT_PB_URL) {
      this.baseUrl = baseUrl;
      // Comparte la instancia de PocketBase creada por scada-config.js para que
      // la sesión real (window.scadaPb) se use en todas las llamadas de datos.
      // Sin esto, las API rules que exigen autenticación rechazarían el frontend.
      this.pb = (window.scadaPb && window.scadaPb.baseUrl === baseUrl)
        ? window.scadaPb
        : new PocketBase(baseUrl);
      this.pb.autoCancellation(false); // Evitar cancelación automática de peticiones simultáneas
      this._subscribers = new Map(); // Para rastrear suscripciones SSE
      console.log(`[PocketBase-Adapter] Inicializado contra ${baseUrl}`);
    }

    collection(name) {
      const normalized = name === 'logs' ? 'bot_logs' : (name === '_test_connection' ? 'config' : name);
      const scope = this._scopeFor(normalized);
      return new PBCollectionReference(this, scope ? scope.base : normalized, [], [], 500, scope);
    }

    // El frontend usa colecciones dinámicas por día y jornada (Firebase las creaba solos):
    // `crane_history_2026-10-25_JornadaA`. En PocketBase una colección debe existir, así que
    // esas rutas se resuelven contra la colección real 'crane_history' filtrando por
    // day/shift, y al escribir se inyectan esos dos campos.
    // El mismo patrón aplica a `operations_history_<fecha>_<jornada>`; ahí el filtro de jornada
    // solo se puede aplicar si la colección tiene el campo 'shift' (operations_history no lo
    // tenía, así que se filtra por fecha sobre reportedAt). Los registros del día se escriben
    // con day/shift porque el adapter inyecta ambos campos.
    _scopeFor(name) {
      const m = /^(crane_history|operations_history)_(\d{4}-\d{2}-\d{2})_(.+)$/.exec(name);
      if (!m) return null;
      return { logicalName: name, base: m[1], day: m[2], shift: m[3] };
    }

    doc(path) {
      const parts = path.split('/');
      if (parts.length !== 2) throw new Error(`Ruta de documento inválida: ${path}`);
      return this.collection(parts[0]).doc(parts[1]);
    }

    batch() {
      return new PBBatch(this);
    }

    // Helper para transformar fechas o serverTimestamp
    // (acepta `existing` para resolver increment/arrayUnion/arrayRemove, que en Firebase
    //  se resuelven contra el documento actual; sin el registro previo serían un marker).
    _processData(data, existing = null) {
      if (!data || typeof data !== 'object') return data;
      const clean = Array.isArray(data) ? [] : {};
      for (const [k, v] of Object.entries(data)) {
        if (v && typeof v === 'object' && v._method === 'serverTimestamp') {
          clean[k] = new Date().toISOString();
        } else if (v && typeof v === 'object' && v._method === 'increment') {
          const base = existing && typeof existing[k] === 'number' ? existing[k] : 0;
          clean[k] = base + (Number(v.value) || 0);
        } else if (v && typeof v === 'object' && v._method === 'arrayUnion') {
          const base = existing && Array.isArray(existing[k]) ? existing[k] : [];
          clean[k] = Array.from(new Set([...base, ...(v.value || [])]));
        } else if (v && typeof v === 'object' && v._method === 'arrayRemove') {
          const base = existing && Array.isArray(existing[k]) ? existing[k] : [];
          const drop = new Set(v.value || []);
          clean[k] = base.filter((x) => !drop.has(x));
        } else if (v instanceof Date) {
          clean[k] = v.toISOString();
        } else if (v && typeof v === 'object' && typeof v.toDate === 'function') {
          clean[k] = v.toDate().toISOString();
        } else if (v && typeof v === 'object' && v._method === 'delete') {
          // Omitir campo eliminado
        } else if (v && typeof v === 'object') {
          clean[k] = this._processData(v);
        } else {
          clean[k] = v;
        }
      }
      return clean;
    }
  }

  const COLLECTION_KEY_FIELDS = {
    crane_status: ['craneId'],
    cranes: ['craneId'],
    operations: ['operationId'],
    config: ['key'],
    inventory: ['partNumber', 'id'],
    inventory_categories: ['name', 'id'],
    inventory_areas: ['name', 'id'],
    active_picks: ['pickId', 'rack', 'id'],
    crane_devices: ['cleanMac', 'mac', 'id'],
    shift_handovers: ['id']
  };

  // Simulación de DocumentReference
  class PBDocumentReference {
    constructor(adapter, collectionName, id, scope = null) {
      this.adapter = adapter;
      this.collectionName = collectionName;
      this.id = id;
      this.scope = scope;
      this._cachedRecordId = null;
      this._isNewAutoId = false;
    }

    // Localiza el registro en PocketBase por id o por clave lógica (craneId, key, etc.)
    async _resolveRecord() {
      const pb = this.adapter.pb;
      if (this._cachedRecordId) {
        try {
          const list = await pb.collection(this.collectionName).getList(1, 1, {
            filter: `id='${this._cachedRecordId}'`
          });
          if (list.items.length > 0) return list.items[0];
        } catch (e) {}
      }
      // Si el ref acaba de generarse con .doc() sin argumentos, aún no existe en BD:
      // retornar null directo evita cualquier petición de red innecesaria.
      if (this._isNewAutoId) {
        return null;
      }

      // 1. Si id parece un ID nativo de PocketBase (15 caracteres alfanuméricos), buscar con getList
      //    (getList nunca genera errores HTTP 404 en la consola de Chrome cuando no existe).
      if (/^[a-z0-9]{15}$/.test(this.id)) {
        try {
          const list = await pb.collection(this.collectionName).getList(1, 1, {
            filter: `id='${this.id}'`
          });
          if (list.items.length > 0) {
            this._cachedRecordId = list.items[0].id;
            return list.items[0];
          }
        } catch (e) {}
      }

      // 2. Buscar por clave lógica de la colección
      const keys = COLLECTION_KEY_FIELDS[this.collectionName] || ['id'];
      const scopeFilter = this.scope ? `day='${this.scope.day}' && shift='${this.scope.shift}'` : null;
      for (const k of keys) {
        try {
          const list = await pb.collection(this.collectionName).getList(1, 1, {
            // Comillas simples: en el filtro de PocketBase las dobles identifican nombres
            // de campo, así que `"${this.id}"` se interpreta como una columna y falla.
            filter: [`${k}='${String(this.id).replace(/'/g, "\\'")}'`, scopeFilter]
              .filter(Boolean).join(' && ')
          });
          if (list.items.length > 0) {
            this._cachedRecordId = list.items[0].id;
            return list.items[0];
          }
        } catch (searchErr) {}
      }

      return null;
    }

    async get() {
      try {
        const rec = await this._resolveRecord();
        if (!rec) {
          return new PBDocumentSnapshot(this.id, null, false);
        }
        return new PBDocumentSnapshot(this.id, this._formatData(rec), true, rec);
      } catch (err) {
        return new PBDocumentSnapshot(this.id, null, false);
      }
    }

    async set(data, options = {}) {
      const pb = this.adapter.pb;
      const existing = await this._resolveRecord();
      const cleanData = this.adapter._processData(data, existing);

      let payload = { ...cleanData };

      // Colecciones dinámicas (crane_history_<fecha>_<jornada>): el día/jornada se guardan
      // como campos, porque en PocketBase no se pueden crear colecciones por nombre.
      if (this.scope) {
        payload = { ...payload, day: this.scope.day, shift: this.scope.shift };
      }

      // Si es la colección config y viene como objeto arbitrario, mapear a { key, value }
      if (this.collectionName === 'config') {
        payload = {
          key: this.id,
          value: cleanData
        };
      } else {
        // Asegurar ID lógico en campos estándar
        if (!payload.craneId && ['cranes', 'crane_status'].includes(this.collectionName)) payload.craneId = this.id;
        if (!payload.operationId && this.collectionName === 'operations') payload.operationId = this.id;
        // PocketBase exige que `id` sea exactamente 15 caracteres [a-z0-9]{15}.
        // Si el frontend pasa `id: "10.01"` o un ID corto, se mueve a `legacyId` para evitar HTTP 400.
        if (payload.id !== undefined && !/^[a-z0-9]{15}$/.test(String(payload.id))) {
          if (!payload.legacyId) payload.legacyId = String(payload.id);
          delete payload.id;
        }
      }

      if (existing) {
        const targetId = existing.id;
        if (options.merge) {
          let merged = payload;
          if (this.collectionName === 'config') {
            merged = { key: this.id, value: { ...(existing.value || {}), ...(cleanData || {}) } };
          }
          delete merged.id;
          await pb.collection(this.collectionName).update(targetId, merged);
        } else {
          delete payload.id;
          await pb.collection(this.collectionName).update(targetId, payload);
        }
      } else {
        // Crear nuevo registro
        if (this.collectionName !== 'config' && !payload.id && /^[a-z0-9]{15}$/.test(String(this.id))) {
          payload.id = this.id;
        }
        try {
          const rec = await pb.collection(this.collectionName).create(payload);
          this._cachedRecordId = rec.id;
          this._isNewAutoId = false;
        } catch (createErr) {
          console.warn(`[PocketBase-Adapter] Error al crear en ${this.collectionName}:`, createErr.message);
          throw createErr;
        }
      }
    }

    async update(data) {
      return this.set(data, { merge: true });
    }

    async delete() {
      const pb = this.adapter.pb;
      const existing = await this._resolveRecord();
      if (existing) {
        await pb.collection(this.collectionName).delete(existing.id);
        this._cachedRecordId = null;
      }
    }

    onSnapshot(onNext, onError) {
      let isUnsubscribed = false;
      let pollTimer = null;
      let unsubscribePromise = null;

      // 1. Emisión inicial inmediata
      this.get().then(snap => {
        if (!isUnsubscribed && typeof onNext === 'function') {
          onNext(snap);
        }
      }).catch(err => {
        if (!isUnsubscribed && typeof onError === 'function') onError(err);
      });

      const startPolling = () => {
        if (pollTimer || isUnsubscribed) return;
        pollTimer = setInterval(async () => {
          if (isUnsubscribed) { clearInterval(pollTimer); return; }
          try {
            const snap = await this.get();
            if (!isUnsubscribed && typeof onNext === 'function') onNext(snap);
          } catch (e) {}
        }, POLLING_INTERVAL_MS);
      };

      // 2. Suscripción en tiempo real: Polling en túnel Cloudflare, SSE con catch en LAN
      if (IS_TUNNEL_HOST) {
        startPolling();
      } else {
        const pb = this.adapter.pb;
        unsubscribePromise = pb.collection(this.collectionName).subscribe('*', (e) => {
          if (isUnsubscribed) return;
          const rec = e.record;
          const matches = (rec.id === this.id || rec.craneId === this.id || rec.operationId === this.id || rec.key === this.id);
          if (matches) {
            if (e.action === 'delete') {
              onNext(new PBDocumentSnapshot(this.id, null, false));
            } else {
              onNext(new PBDocumentSnapshot(this.id, this._formatData(rec), true, rec));
            }
          }
        }).catch(() => {
          startPolling();
        });
      }

      return () => {
        isUnsubscribed = true;
        if (pollTimer) clearInterval(pollTimer);
        if (unsubscribePromise && typeof unsubscribePromise.then === 'function') {
          unsubscribePromise.then(unsub => {
            if (typeof unsub === 'function') unsub();
          }).catch(() => {});
        }
      };
    }

    // Firestore entrega los campos de fecha como objetos Timestamp con .toDate(); PocketBase
    // devuelve strings ISO. El frontend usa `.toDate()` en más de 100 sitios, así que se
    // envuelve el valor en un Timestamp compatible (toString/toJSON devuelven el ISO original
    // para que el texto plano siga funcionando).
    _wrapTimestamps(data) {
      return wrapTimestamps(data);
    }

    _formatData(rec) {
      return formatData(rec, this.collectionName);
    }
  }

  // Simulación de DocumentSnapshot
  class PBDocumentSnapshot {
    constructor(id, data, exists = true, rawRecord = null) {
      this.id = id;
      this._data = data || {};
      this.exists = exists;
      this._raw = rawRecord;
    }

    data() {
      return this._data;
    }

    get(field) {
      return this._data[field];
    }
  }

  // Simulación de Query / CollectionReference
  class PBCollectionReference {
    constructor(adapter, collectionName, filters = [], sorts = [], limitCount = 500, scope = null) {
      this.adapter = adapter;
      this.collectionName = collectionName;
      this._filters = filters;
      this._sorts = sorts;
      this._limit = limitCount;
      this.scope = scope;
    }

    doc(id) {
      const docId = id || genPbId();
      const ref = new PBDocumentReference(this.adapter, this.collectionName, docId, this.scope);
      ref._isNewAutoId = !id;
      return ref;
    }

    where(field, op, val) {
      // Literales: en PocketBase las comillas dobles identifican NOMBRES de campo, así que
      // los valores de texto van con comillas simples (`type='x'`). Con dobles la expresión
      // se lee como comparación entre columnas y devuelve 0 registros o 400 al combinar sort.
      const lit = (v) => {
        if (v instanceof Date) return `'${v.toISOString()}'`;
        if (v && typeof v === 'object' && typeof v.toDate === 'function') {
          return `'${v.toDate().toISOString()}'`; // firebase.firestore.Timestamp
        }
        if (typeof v === 'string') return `'${v.replace(/'/g, "\\'")}'`;
        if (typeof v === 'boolean') return v ? 'true' : 'false';
        if (v === null) return 'null';
        return v;
      };

      let newFilter;
      if (op === 'in' && Array.isArray(val)) {
        newFilter = `(${val.map((v) => `${field}=${lit(v)}`).join(' || ')})`;
      } else if (op === 'array-contains' || op === 'arrayContains') {
        newFilter = `${field}~${lit(val)}`;
      } else {
        let pbOp = '=';
        if (op === '==') pbOp = '=';
        else if (op === '!=') pbOp = '!=';
        else if (op === '>') pbOp = '>';
        else if (op === '>=') pbOp = '>=';
        else if (op === '<') pbOp = '<';
        else if (op === '<=') pbOp = '<=';
        newFilter = `${field}${pbOp}${lit(val)}`;
      }
      return new PBCollectionReference(
        this.adapter,
        this.collectionName,
        [...this._filters, newFilter],
        this._sorts,
        this._limit,
        this.scope
      );
    }

    orderBy(field, direction = 'asc') {
      const prefix = direction.toLowerCase() === 'desc' ? '-' : '+';
      return new PBCollectionReference(
        this.adapter,
        this.collectionName,
        this._filters,
        [...this._sorts, `${prefix}${field}`],
        this._limit,
        this.scope
      );
    }

    limit(n) {
      return new PBCollectionReference(
        this.adapter,
        this.collectionName,
        this._filters,
        this._sorts,
        n,
        this.scope
      );
    }

    async add(data) {
      const pb = this.adapter.pb;
      const cleanData = this.adapter._processData(data);
      const payload = this.scope ? { ...cleanData, day: this.scope.day, shift: this.scope.shift } : { ...cleanData };
      if (payload.id !== undefined && !/^[a-z0-9]{15}$/.test(String(payload.id))) {
        if (!payload.legacyId) payload.legacyId = String(payload.id);
        delete payload.id;
      }
      const rec = await pb.collection(this.collectionName).create(payload);
      return new PBDocumentReference(this.adapter, this.collectionName, rec.id, this.scope);
    }

    // Filtro para las colecciones dinámicas. `full` usa day/shift; si la colección real no
    // tiene esos campos (operations_history no los tenía) PocketBase responde 400 y se
    // reintenta filtrando solo la fecha sobre reportedAt. El resultado se cachea por colección
    // para no repetir el 400 en cada carga de la página.
    // Cache de esquema por colección: la primera vez que una colección dinámica responde 400
    // (porque no tiene los campos day/shift) se recuerda y las consultas siguientes usan el
    // filtro por fecha sin intentar el filtro completo, así se evita repetir el 400 en cada
    // carga de la página.
    _filterFor() {
      const mode = SCOPE_SCHEMA_CACHE[this.collectionName];
      if (mode === 'date') return this._scopeFilter(false);
      return this._scopeFilter(true);
    }

    _scopeFilter(full = true) {
      if (!this.scope) return null;
      if (full) return `day='${this.scope.day}' && shift='${this.scope.shift}'`;
      const next = new Date(`${this.scope.day}T00:00:00`);
      next.setDate(next.getDate() + 1);
      const d1 = next.toISOString().slice(0, 10);
      return `reportedAt>='${this.scope.day} 00:00:00' && reportedAt<'${d1} 00:00:00'`;
    }

    _mapItems(res) {
      return res.items.map((rec) => {
        const docId = rec.cleanMac || rec.craneId || rec.operationId || rec.key || rec.id;
        const data = formatData(rec, this.collectionName);
        return new PBDocumentSnapshot(docId, data, true, rec);
      });
    }

    async get() {
      const pb = this.adapter.pb;
      const options = {
        perPage: this._limit || 500
      };
      const filters = [...this._filters];
      const scopeFilter = this._filterFor();
      if (scopeFilter) filters.push(scopeFilter);
      if (filters.length > 0) {
        options.filter = filters.join(' && ');
      }
      if (this._sorts.length > 0) {
        options.sort = this._sorts.join(',');
      }

      try {
        const res = await pb.collection(this.collectionName).getList(1, options.perPage, options);
        if (this.scope && options.filter && options.filter.includes('shift=')) {
          rememberSchema(this.collectionName, 'full');
        }
        return new PBQuerySnapshot(this._mapItems(res));
      } catch (err) {
        if (this.scope && err.status === 400) {
          rememberSchema(this.collectionName, 'date');
          const altFilters = [...this._filters, this._scopeFilter(false)].filter(Boolean);
          const altOptions = { perPage: options.perPage, filter: altFilters.join(' && ') };
          if (this._sorts.length > 0) altOptions.sort = this._sorts.join(',');
          try {
            const res = await pb.collection(this.collectionName).getList(1, altOptions.perPage, altOptions);
            return new PBQuerySnapshot(this._mapItems(res));
          } catch (fallbackErr) {
            console.warn(`[PocketBase-Adapter] Error al listar ${this.collectionName} (fallback fecha):`, fallbackErr.message);
            return new PBQuerySnapshot([]);
          }
        }
        console.warn(`[PocketBase-Adapter] Error al listar ${this.collectionName}:`, err.message);
        return new PBQuerySnapshot([]);
      }
    }

    onSnapshot(onNext, onError) {
      let isUnsubscribed = false;
      let prevSnap = null;
      let pollTimer = null;
      let unsubscribePromise = null;

      // Emisión inicial
      this.get().then(snap => {
        if (!isUnsubscribed && typeof onNext === 'function') {
          snap._prev = null;
          prevSnap = snap;
          onNext(snap);
        }
      }).catch(err => {
        if (!isUnsubscribed && typeof onError === 'function') onError(err);
      });

      const refreshSnapshot = async () => {
        if (isUnsubscribed) return;
        try {
          const freshSnap = await this.get();
          freshSnap._prev = prevSnap;
          prevSnap = freshSnap;
          if (!isUnsubscribed && typeof onNext === 'function') {
            onNext(freshSnap);
          }
        } catch (e) {}
      };

      const startPolling = () => {
        if (pollTimer || isUnsubscribed) return;
        pollTimer = setInterval(refreshSnapshot, POLLING_INTERVAL_MS);
      };

      // Suscripción en tiempo real: Polling en túnel Cloudflare, SSE con catch en LAN
      if (IS_TUNNEL_HOST) {
        startPolling();
      } else {
        const pb = this.adapter.pb;
        unsubscribePromise = pb.collection(this.collectionName).subscribe('*', refreshSnapshot).catch(() => {
          startPolling();
        });
      }

      return () => {
        isUnsubscribed = true;
        if (pollTimer) clearInterval(pollTimer);
        if (unsubscribePromise && typeof unsubscribePromise.then === 'function') {
          unsubscribePromise.then(unsub => {
            if (typeof unsub === 'function') unsub();
          }).catch(() => {});
        }
      };
    }
  }

  // Simulación de QuerySnapshot
  class PBQuerySnapshot {
    constructor(docs = []) {
      this.docs = docs;
      this.empty = docs.length === 0;
      this.size = docs.length;
      this._prev = null;
    }

    // docChanges() al estilo Firebase. El adapter no guarda estado propio, así que onSnapshot
    // le asigna _prev con el snapshot anterior; sin anterior cada documento se reporta como
    // 'added'. Los consumidores (technician-alerts.js) leen change.type y change.doc.data().
    docChanges() {
      if (!this._prev) {
        return this.docs.map((doc) => ({ id: doc.id, doc, type: 'added' }));
      }
      const before = new Map(this._prev.docs.map((d) => [d.id, d]));
      const after = new Set(this.docs.map((d) => d.id));
      const changes = this.docs.map((doc) => ({
        id: doc.id, doc, type: before.has(doc.id) ? 'modified' : 'added'
      }));
      for (const doc of this._prev.docs) {
        if (!after.has(doc.id)) changes.push({ id: doc.id, doc, type: 'removed' });
      }
      return changes;
    }

    forEach(callback) {
      this.docs.forEach(callback);
    }
  }

  // Simulación de Batch
  class PBBatch {
    constructor(adapter) {
      this.adapter = adapter;
      this._ops = [];
    }

    set(docRef, data, options = {}) {
      this._ops.push(() => docRef.set(data, options));
      return this;
    }

    update(docRef, data) {
      this._ops.push(() => docRef.update(data));
      return this;
    }

    delete(docRef) {
      this._ops.push(() => docRef.delete());
      return this;
    }

    async commit() {
      for (const op of this._ops) {
        await op();
      }
    }
  }

  // Inicialización Global y reemplazo de db
  window.PocketBaseFirestoreAdapter = PocketBaseFirestoreAdapter;

  // Emulación de FieldValue y Timestamp compatibles con Firebase SDK
  window.firebase = window.firebase || {};
  window.firebase.firestore = function () {
    return window.db;
  };
  window.firebase.firestore.FieldValue = {
    serverTimestamp: () => ({ _method: 'serverTimestamp' }),
    delete: () => ({ _method: 'delete' }),
    increment: (n) => ({ _method: 'increment', value: n }),
    arrayUnion: (...items) => ({ _method: 'arrayUnion', value: items }),
    arrayRemove: (...items) => ({ _method: 'arrayRemove', value: items })
  };
  window.firebase.firestore.Timestamp = {
    now: () => ({
      toDate: () => new Date(),
      toMillis: () => Date.now(),
      seconds: Math.floor(Date.now() / 1000)
    }),
    fromDate: (d) => ({
      toDate: () => d,
      toMillis: () => d.getTime(),
      seconds: Math.floor(d.getTime() / 1000)
    }),
    fromMillis: (ms) => {
      const d = new Date(ms);
      return {
        toDate: () => d,
        toMillis: () => d.getTime(),
        seconds: Math.floor(d.getTime() / 1000)
      };
    }
  };

  // Instanciar por defecto en window.db
  const pbAdapterInstance = new PocketBaseFirestoreAdapter(DEFAULT_PB_URL);
  window.db = pbAdapterInstance;
  window.scadaDb = pbAdapterInstance;

  // ── Endpoint /processNotification ────────────────────────────────────────────
  // En Firebase esto era la Cloud Function homónima (borrada en la migración), por eso
  // app.js la seguía llamando y ahora devolvía 404: reportar una falla desde la web no
  // creaba nada. PocketBase no ejecuta JS en el servidor, así que el equivalente local
  // se implementa aquí, replicando lo que hacía la función:
  //   1) crear/actualizar la operación activa (colección 'operations')
  //   2) crear la notificación 'pending' que el bot de WhatsApp consume
  // El fetch original se conserva para todas las demás rutas.
  const nativeFetch = typeof window.fetch === 'function' ? window.fetch.bind(window) : null;

  async function processNotificationHandler(payload) {
    const pb = pbAdapterInstance.pb;
    const operationId = payload.operationId || '';
    const description = payload.description || '';
    const reportedBy = payload.reportedBy || 'Sistema Web';
    const area = payload.area || '';
    const source = payload.source || 'web';
    const nowISO = new Date().toISOString();

    let operation = null;
    if (operationId) {
      try {
        const list = await pb.collection('operations').getList(1, 1, {
          filter: `operationId='${operationId}'`
        });
        const body = {
          operationId, status: 'active', description, reportedBy, area, source,
          reportedAt: nowISO
        };
        operation = list.items.length > 0
          ? await pb.collection('operations').update(list.items[0].id, body)
          : await pb.collection('operations').create(body);
      } catch (e) {
        console.error('[processNotification] error creando la operación:', e.message);
      }
    }

    const notification = await pb.collection('notifications').create({
      type: payload.type || 'operation_failure',
      operationId, description, reportedBy, area, source,
      status: 'pending',
      message: `⚠️ *FALLA REPORTADA*\n\nOperación: *${operationId}*\nÁrea: ${area}\nDescripción: ${description}\nReportado por: ${reportedBy}`,
      createdAt: nowISO
    });

    return { operationId, notificationId: notification.id, operation, notification };
  }

  window.fetch = async function (input, init) {
    const url = typeof input === 'string' ? input : (input && input.url) || '';
    if (!/\/processNotification(\?|$)/.test(url)) {
      return nativeFetch ? nativeFetch(input, init) : fetch(input, init);
    }
    let payload = {};
    try {
      payload = init && init.body ? JSON.parse(init.body) : {};
    } catch (e) {
      return new Response(JSON.stringify({ ok: false, error: 'body JSON inválido' }), {
        status: 400, headers: { 'Content-Type': 'application/json' }
      });
    }
    try {
      const result = await processNotificationHandler(payload);
      return new Response(JSON.stringify({ ok: true, ...result }), {
        status: 200, headers: { 'Content-Type': 'application/json' }
      });
    } catch (e) {
      return new Response(JSON.stringify({ ok: false, error: e.message }), {
        status: 500, headers: { 'Content-Type': 'application/json' }
      });
    }
  };

  console.log('✅ [SCADA] Adaptador PocketBase-Firestore activado transparentemente en window.db');
})(window);

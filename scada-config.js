// ============================================================================
// SERVIDOR SCADA AUTÓNOMO SIDERÚRGICO 4.0 - XIAOMI MI 11 LITE
// Adaptador Universal PocketBase & Cloudflare Zero Trust (Firebase en Pausa)
// ============================================================================

(function(window) {
    'use strict';

    // Endpoints del Servidor Autónomo Xiaomi Mi 11 Lite
    const LOCAL_IP = '192.168.100.34';
    const LOCAL_PORT = '8090';

    // Detección automática inteligente: LAN directa vs Acceso Remoto por Túnel
    const isLocalNetwork = (
        typeof window !== 'undefined' && (
            window.location.hostname === LOCAL_IP ||
            window.location.hostname === 'localhost' ||
            window.location.hostname === '127.0.0.1' ||
            window.location.hostname.startsWith('192.168.') ||
            window.location.hostname.startsWith('10.') ||
            window.location.hostname.startsWith('172.16.')
        )
    );

    // Acceso remoto o LAN servida desde el propio PocketBase: se usa el ORIGEN que sirvió
    // la página siempre que sea HTTP/HTTPS en el puerto 8090 o túnel Cloudflare, evitando
    // depender de una IP LAN fija si el DHCP cambia o de un hostname de túnel caducado.
    // URL FIJA garantizada: Worker de Cloudflare (plan Free, sin dominio) que proxyea al
    // Quick Tunnel. El hostname del Quick Tunnel cambia en cada reinicio, pero este origen
    // nunca cambia, así que enlazar el panel a esta URL es lo estable. El bloque de
    // autocomcorrección sigue vivo para el caso de abrir el panel por un hostname viejo.
    const FIXED_ENTRY_URL = 'https://scada-entry.scada-xiaomi-server.workers.dev';
    const FALLBACK_TUNNEL_URL = FIXED_ENTRY_URL;
    const servedOrigin = (typeof window !== 'undefined' && window.location &&
        /^https?:$/.test(window.location.protocol)) ? window.location.origin : null;
    const CF_TUNNEL_URL = servedOrigin || FALLBACK_TUNNEL_URL;

    const onPages = typeof window !== 'undefined' && window.location &&
        /github\.io$/.test(window.location.hostname);
    const SCADA_SERVER_URL = (onPages || !servedOrigin)
        ? FIXED_ENTRY_URL
        : ((window.location.port === LOCAL_PORT || !isLocalNetwork)
            ? servedOrigin
            : (isLocalNetwork ? `http://${LOCAL_IP}:${LOCAL_PORT}` : CF_TUNNEL_URL));
    window.SCADA_PB_URL = SCADA_SERVER_URL;
    console.log(`[SCADA Servidor Local] PocketBase activo en ${SCADA_SERVER_URL} (Red: ${isLocalNetwork ? 'LAN Industrial Directa' : 'Cloudflare Zero Trust'}) - Firebase PAUSADO`);

    // Autocorrección solo cuando se usó el fallback: si el panel se abrió por un hostname de
    // túnel caducado, tunnel_url.json (mantenido por el discovery) restaura el destino correcto.
    if (SCADA_SERVER_URL === FALLBACK_TUNNEL_URL) {
        try {
            fetch('./tunnel_url.json', { cache: 'no-store' })
                .then(function (r) { return r.ok ? r.json() : null; })
                .then(function (d) {
                    if (d && d.tunnelUrl) {
                        window.SCADA_PB_URL = d.tunnelUrl;
                        console.log(`[SCADA Servidor Local] fallback corregido por tunnel_url.json: ${d.tunnelUrl}`);
                    }
                })
                .catch(function () { /* sin red o sin archivo: se mantiene el fallback */ });
        } catch (e) { /* entorno sin fetch */ }
    }

    // Mocks seguros para App Check y Storage compatibles con el código existente
    window.firebase = window.firebase || {};
    window.firebase.app = () => ({ name: '[DEFAULT]', options: {} });
    window.firebase.initializeApp = () => window.firebase.app();
    window.firebase.appCheck = () => ({
        activate: () => console.log('[SCADA Security] Zero Trust Shield activo (PocketBase Nativo)'),
        getToken: async () => ({ token: 'scada_local_token' })
    });

    // ------------------------------------------------------------------
    // AUTENTICACIÓN REAL (v4.1): antes this mock devolvía siempre un
    // usuario 'scada_admin', o sea el login estaba bypassed y cualquier
    // visitante pasaba. Ahora delega en PocketBase (colección 'users',
    // type=auth) y la sesión se persiste en localStorage (clave pb_auth),
    // así el adapter comparte la misma identidad y las API rules aplican.
    // ------------------------------------------------------------------
    const pb = (typeof PocketBase === 'function') ? new PocketBase(SCADA_SERVER_URL) : null;
    if (pb) pb.autoCancellation(false);
    window.scadaPb = pb;

    // PocketBase JS SDK 0.19+ expone `pb.authStore`; el alias `pb.auth` ya no existe, por lo
    // que `pb.auth.onChange` lanzaba TypeError y el portal de login nunca completaba el flujo.
    // Además authWithPassword() responde `{ record, token }`, no el record suelto.
    const store = pb ? (pb.authStore || pb.auth) : null;

    function asUser(input) {
        if (!input) return null;
        const record = (input.record && typeof input.record === 'object') ? input.record : input;
        if (!record || (!record.id && !record.email)) return null;
        return {
            uid: record.id,
            email: record.email || null,
            displayName: record.name || record.displayName || (record.email || '').split('@')[0],
            role: record.role || null,
            status: record.status || null
        };
    }

    window.firebase.auth = () => ({
        // auth-system.js usa firebase.auth().Auth.Persistence.LOCAL
        Auth: { Persistence: { LOCAL: 'local', SESSION: 'session', NONE: 'none' } },
        get currentUser() { return (store && store.isValid) ? asUser(store.record) : null; },
        setPersistence: async () => {},   // PocketBase ya persiste en localStorage (authStore)
        onAuthStateChanged: (cb) => {
            if (!store) { setTimeout(() => cb(null), 10); return () => {}; }
            // Firma del SDK: listener(token, record). Se registra una sola vez por callback.
            if (!store._scadaListeners) store._scadaListeners = new Map();
            if (!store._scadaListeners.has(cb)) {
                const off = store.onChange((token, record) => cb(asUser(record)));
                store._scadaListeners.set(cb, typeof off === 'function' ? off : null);
            }
            setTimeout(() => cb(asUser(store.record)), 10);
            return () => {
                const off = store._scadaListeners && store._scadaListeners.get(cb);
                if (typeof off === 'function') off();
                if (store._scadaListeners) store._scadaListeners.delete(cb);
            };
        },
        signInWithEmailAndPassword: async (email, password) => {
            if (!pb) throw new Error('PocketBase no disponible');
            const res = await pb.collection('users').authWithPassword(email, password);
            return { user: asUser(res.record || res), token: res.token || null };
        },
        createUserWithEmailAndPassword: async (email, password, extra = {}) => {
            if (!pb) throw new Error('PocketBase no disponible');
            const record = await pb.collection('users').create({
                email,
                password,
                passwordConfirm: password,
                name: extra.displayName || (email || '').split('@')[0],
                role: extra.role || 'viewer',
                status: extra.status || 'pending'
            });
            return { user: asUser(record) };
        },
        signOut: async () => { if (store && typeof store.clear === 'function') store.clear(); }
    });
    window.firebase.storage = () => ({
        ref: () => ({
            put: async () => ({ ref: { getDownloadURL: async () => '' } }),
            getDownloadURL: async () => ''
        })
    });
})(typeof window !== 'undefined' ? window : this);

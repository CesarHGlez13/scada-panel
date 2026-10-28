// Sistema unificado de solicitudes de refacción
(function () {
    'use strict';

    function getDb() {
        const firestore = window.db || (typeof db !== 'undefined' ? db : null);
        if (!firestore) {
            throw new Error('Firestore no está inicializado');
        }
        return firestore;
    }

    async function submitRefactionRequest(data) {
        const firestore = getDb();
        if (!data.itemId || !data.category || !data.quantity || !data.reason) {
            throw new Error('Faltan campos obligatorios');
        }
        if (!data.operationId && !data.craneId) {
            throw new Error('No se identificó la operación o grúa');
        }

        const payload = {
            operationId: data.operationId || null,
            craneId: data.craneId || null,
            category: data.category,
            itemId: data.itemId,
            itemName: data.itemName || '',
            quantity: data.quantity,
            reason: data.reason,
            requestedBy: data.requestedBy || 'Sistema',
            type: data.type || (data.craneId ? 'crane' : 'operation'),
            status: 'pending',
            createdAt: firebase.firestore.Timestamp.now(),
            createdAtMs: Date.now()
        };

        const docRef = await firestore.collection('refaction_requests').add(payload);
        console.log('[Refacciones] Solicitud creada:', docRef.id, payload);

        // Si es una solicitud para grúa, cambiar su estado a "mantenimiento" en el dashboard
        if (payload.craneId) {
            try {
                const craneRef = firestore.collection('cranes').doc(payload.craneId);
                const craneDoc = await craneRef.get();
                if (craneDoc.exists) {
                    await craneRef.update({
                        status: 'maintenance',
                        maintenanceNote: `Refacción solicitada: ${payload.itemName || payload.itemId}`,
                        maintenanceAt: firebase.firestore.Timestamp.now(),
                        refactionRequestId: docRef.id
                    });
                    console.log('[Refacciones] Estado de grúa cambiado a mantenimiento:', payload.craneId);
                }
            } catch (err) {
                console.warn('[Refacciones] No se pudo actualizar estado de grúa:', err.message);
            }
        }

        return docRef.id;
    }

    async function fetchAllRefactionRequests() {
        const firestore = getDb();
        const snapshot = await firestore.collection('refaction_requests').get();
        const list = [];
        snapshot.forEach(doc => list.push({ id: doc.id, ...doc.data() }));
        list.sort((a, b) => {
            const ta = a.createdAt?.toDate ? a.createdAt.toDate().getTime() : (a.createdAtMs || 0);
            const tb = b.createdAt?.toDate ? b.createdAt.toDate().getTime() : (b.createdAtMs || 0);
            return tb - ta;
        });
        console.log('[Refacciones] Solicitudes cargadas:', list.length);
        return list;
    }

    async function loadRefactionInventoryItems(filterType) {
        const firestore = getDb();
        let snapshot;
        try {
            const filters = filterType === 'crane'
                ? ['grua', 'ambos']
                : ['operacion', 'ambos'];
            snapshot = await firestore.collection('inventory').where('aplicaA', 'in', filters).get();
        } catch (e) {
            console.warn('[Refacciones] Cargando inventario completo:', e.message);
            snapshot = await firestore.collection('inventory').get();
        }
        const items = [];
        snapshot.forEach(doc => {
            const data = doc.data();
            const aplicaA = data.aplicaA || 'ambos';
            const ok = filterType === 'crane'
                ? (aplicaA === 'grua' || aplicaA === 'ambos')
                : (aplicaA === 'operacion' || aplicaA === 'ambos');
            if (ok) items.push({ id: doc.id, ...data });
        });
        return items;
    }

    window.submitRefactionRequest = submitRefactionRequest;
    window.fetchAllRefactionRequests = fetchAllRefactionRequests;
    window.loadRefactionInventoryItems = loadRefactionInventoryItems;
})();

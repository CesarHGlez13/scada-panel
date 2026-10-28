(async function loadMobileStats() {
    try {
        const modules = (typeof getEnabledModules === 'function') ? getEnabledModules() : { operations: true, cranes: true };

        const opsPromise = modules.operations
            ? db.collection('operations').where('status', '==', 'active').get()
            : Promise.resolve({ size: 0 });
        const cranesPromise = modules.cranes
            ? db.collection('cranes').get()
            : Promise.resolve({ forEach: () => {} });
        const refPromise = db.collection('refaction_requests').where('status', '==', 'pending').get();

        const [opsSnap, cranesSnap, refSnap] = await Promise.all([
            opsPromise,
            cranesPromise,
            refPromise
        ]);

        const opsEl = document.getElementById('mobileActiveOps');
        if (opsEl) opsEl.textContent = opsSnap.size;

        let activeCranesCount = 0;
        if (cranesSnap && cranesSnap.forEach) {
            cranesSnap.forEach(doc => {
                const st = doc.data().status;
                if (st === 'failed' || st === 'maintenance' || st === 'active') {
                    activeCranesCount++;
                }
            });
        }
        const cranesEl = document.getElementById('mobileActiveCranes');
        if (cranesEl) cranesEl.textContent = activeCranesCount;

        const refEl = document.getElementById('mobilePendingRefactions');
        if (refEl) refEl.textContent = refSnap ? refSnap.size : 0;

        const today = new Date();
        today.setHours(0, 0, 0, 0);
        let resolvedToday = 0;

        try {
            const historySnap = await db.collection('operations_history').get();
            historySnap.forEach(doc => {
                const d = doc.data();
                if (d.resolvedAt && d.resolvedAt.toDate && d.resolvedAt.toDate() >= today) {
                    resolvedToday++;
                }
            });
        } catch (e) {}

        try {
            const pad = n => String(n).padStart(2, '0');
            const dateStr = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`;
            const cranePromises = ['A', 'B', 'C', 'D'].map(s =>
                db.collection(`crane_history_${dateStr}_Jornada${s}`).get().catch(() => ({ size: 0 }))
            );
            const craneSnaps = await Promise.all(cranePromises);
            craneSnaps.forEach(snap => { resolvedToday += (snap.size || 0); });
        } catch (e) {}

        const resEl = document.getElementById('mobileResolvedToday');
        if (resEl) resEl.textContent = resolvedToday;
    } catch (err) {
        console.error('Error cargando estadísticas móviles:', err);
    }
})();

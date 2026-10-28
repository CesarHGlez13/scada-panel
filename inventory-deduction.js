/**
 * ============================================================================
 * INVENTORY ATOMIC DEDUCTION ENGINE (Sprint 3 SCADA Pro)
 * Desarrollado para Cesar • Sistema de Control Operativo
 * ============================================================================
 */

(function () {
  'use strict';

  window.selectedPartsToDeduct = [];

  function getDb() {
    return window.db || (typeof firebase !== 'undefined' ? firebase.firestore() : null);
  }

  // Cargar lista de refacciones con stock > 0
  window.loadAvailableRefactionsForPicker = async function (selectElementId = 'partsPickerSelect') {
    const select = document.getElementById(selectElementId);
    if (!select) return;

    try {
      const db = getDb();
      if (!db) return;

      select.replaceChildren();
      const defaultOpt = document.createElement('option');
      defaultOpt.value = '';
      defaultOpt.textContent = 'Seleccione una refacción del almacén...';
      select.appendChild(defaultOpt);

      const snapshot = await db.collection('inventory').get();

      snapshot.forEach((doc) => {
        const item = doc.data();
        const stock = Number(item.stock) || 0;
        if (stock > 0) {
          const opt = document.createElement('option');
          opt.value = doc.id;
          opt.textContent = `${item.name} (${item.code || 'S/C'}) • Stock: ${stock}`;
          opt.dataset.name = item.name;
          opt.dataset.code = item.code || '';
          opt.dataset.stock = stock;
          select.appendChild(opt);
        }
      });
    } catch (err) {
      console.warn('[Refactions] No se pudo cargar inventario para el selector:', err);
    }
  };

  // Agregar pieza seleccionada a la lista
  window.addPartToResolution = function () {
    const select = document.getElementById('partsPickerSelect');
    const qtyInput = document.getElementById('partsPickerQty');
    const container = document.getElementById('selectedPartsContainer');
    if (!select || !qtyInput || !container) return;

    const itemId = select.value;
    if (!itemId) return;

    const opt = select.selectedOptions[0];
    const name = opt.dataset.name;
    const code = opt.dataset.code;
    const availableStock = Number(opt.dataset.stock) || 0;
    const qty = parseInt(qtyInput.value, 10) || 1;

    if (qty > availableStock) {
      alert(`Stock insuficiente: Solo hay ${availableStock} unidades disponibles de "${name}".`);
      return;
    }

    // Verificar si ya existe en la lista
    const existingIndex = window.selectedPartsToDeduct.findIndex((p) => p.itemId === itemId);
    if (existingIndex >= 0) {
      const newTotal = window.selectedPartsToDeduct[existingIndex].quantity + qty;
      if (newTotal > availableStock) {
        alert(`Stock insuficiente: El total agregado (${newTotal}) supera el stock (${availableStock}).`);
        return;
      }
      window.selectedPartsToDeduct[existingIndex].quantity = newTotal;
    } else {
      window.selectedPartsToDeduct.push({
        itemId,
        name,
        code,
        quantity: qty
      });
    }

    // Reset campos
    select.value = '';
    qtyInput.value = '1';
    renderSelectedPartsChips();
  };

  function removePartFromResolution(index) {
    window.selectedPartsToDeduct.splice(index, 1);
    renderSelectedPartsChips();
  }
  window.removePartFromResolution = removePartFromResolution;

  function renderSelectedPartsChips() {
    const container = document.getElementById('selectedPartsContainer');
    if (!container) return;

    container.replaceChildren();
    window.selectedPartsToDeduct.forEach((p, idx) => {
      const chip = document.createElement('span');
      chip.className = 'badge bg-secondary d-inline-flex align-items-center gap-1 p-2 font-monospace';
      chip.style.fontSize = '0.8rem';

      const icon = document.createElement('i');
      icon.className = 'bi bi-box-seam text-warning';
      chip.appendChild(icon);

      const span = document.createElement('span');
      span.textContent = `${p.name} x${p.quantity}`;
      chip.appendChild(span);

      const closeBtn = document.createElement('button');
      closeBtn.type = 'button';
      closeBtn.className = 'btn-close btn-close-white btn-sm ms-1';
      closeBtn.style.fontSize = '0.6rem';
      closeBtn.addEventListener('click', () => removePartFromResolution(idx));
      chip.appendChild(closeBtn);

      container.appendChild(chip);
    });
  }

  // Deducción atómica en Firestore al cerrar orden
  window.executeAtomicPartsDeduction = async function (orderType, orderId, responsibleName) {
    if (!window.selectedPartsToDeduct.length) return '';

    const db = getDb();
    if (!db) return '';

    const deductedSummaries = [];

    for (const part of window.selectedPartsToDeduct) {
      const itemRef = db.collection('inventory').doc(part.itemId);

      await db.runTransaction(async (transaction) => {
        const itemDoc = await transaction.get(itemRef);
        if (!itemDoc.exists) {
          throw new Error(`Artículo ${part.name} no encontrado en almacén`);
        }

        const currentStock = Number(itemDoc.data().stock) || 0;
        if (currentStock < part.quantity) {
          throw new Error(`Stock insuficiente para ${part.name}: disponible ${currentStock}, requerido ${part.quantity}`);
        }

        const newStock = currentStock - part.quantity;
        transaction.update(itemRef, {
          stock: newStock,
          lastMovement: firebase.firestore.Timestamp.now()
        });
      });

      // Registrar movimiento de salida
      await db.collection('inventory_movements').add({
        itemId: part.itemId,
        itemCode: part.code,
        itemName: part.name,
        type: 'salida',
        quantity: part.quantity,
        reasonType: 'Reparación de Falla',
        description: `Deducción automática por cierre de orden [${orderType}: ${orderId}]. Técnico: ${responsibleName}`,
        createdAt: firebase.firestore.Timestamp.now()
      });

      deductedSummaries.push(`${part.quantity}x ${part.name} (${part.code || 'S/C'})`);
    }

    const summaryText = ` [Refacciones: ${deductedSummaries.join(', ')}]`;
    window.selectedPartsToDeduct = [];
    renderSelectedPartsChips();
    return summaryText;
  };

  // Enganche automático al abrir el modal de resolver
  document.addEventListener('DOMContentLoaded', () => {
    const resolveModalEl = document.getElementById('resolveModal');
    if (resolveModalEl) {
      resolveModalEl.addEventListener('show.bs.modal', () => {
        window.selectedPartsToDeduct = [];
        renderSelectedPartsChips();
        window.loadAvailableRefactionsForPicker();
      });
    }
  });
})();

// =============================================================================
// GASTROTIME - CONTROL SEMANAL (ADMIN), HORAS, TRABAJADORES Y AJUSTES
// =============================================================================

// --- GESTIÓN DEL PIN DE ADMINISTRADOR ---

function requestAdminAccess() {
  if (!activeRestaurant) return;

  const modal = document.getElementById('pin-modal');
  const title = document.getElementById('pin-modal-title');
  const desc = document.getElementById('pin-modal-desc');
  const btn = document.getElementById('pin-submit-btn');
  const input = document.getElementById('pin-input');
  const errorEl = document.getElementById('pin-error');

  input.value = '';
  errorEl.classList.add('hidden');

  const hasMasterPin = typeof MASTER_ADMIN_PIN === 'string' && MASTER_ADMIN_PIN.trim().length === 4;
  if (!activeRestaurant.adminPin && !hasMasterPin) {
    pinModalMode = 'create';
    title.textContent = 'Crea tu PIN de Administrador';
    desc.textContent = 'Elige un PIN de 4 dígitos para proteger el Control Semanal.';
    btn.textContent = 'Guardar PIN';
  } else {
    pinModalMode = 'verify';
    title.textContent = 'Control Semanal Protegido';
    desc.textContent = 'Introduce tu PIN de 4 dígitos para acceder.';
    btn.textContent = 'Entrar';
  }

  modal.classList.remove('hidden');
  lockBodyScroll();
  setTimeout(() => input.focus(), 50);
}

function openChangePinModal() {
  pinModalMode = 'change';
  document.getElementById('pin-modal-title').textContent = 'Cambiar PIN de Administrador';
  document.getElementById('pin-modal-desc').textContent = 'Introduce el nuevo PIN de 4 dígitos.';
  document.getElementById('pin-submit-btn').textContent = 'Actualizar PIN';
  document.getElementById('pin-input').value = '';
  document.getElementById('pin-error').classList.add('hidden');
  document.getElementById('pin-modal').classList.remove('hidden');
  lockBodyScroll();
  setTimeout(() => document.getElementById('pin-input').focus(), 50);
}

function closePinModal() {
  document.getElementById('pin-modal').classList.add('hidden');
  unlockBodyScroll();
  pendingActionAfterPin = null;
}

function handlePinAutoInput(inputEl) {
  const pin = inputEl.value.trim();
  if (pin.length === 4) {
    processPinValidation(pin, inputEl);
  }
}

async function processPinValidation(pin, inputEl) {
  const errorEl = document.getElementById('pin-error');
  if (!/^\d{4}$/.test(pin)) {
    if (errorEl) {
      errorEl.textContent = 'El PIN debe tener exactamente 4 números.';
      errorEl.classList.remove('hidden');
    }
    return;
  }

  if (pinModalMode === 'create') {
    activeRestaurant.adminPin = pin;
    await dbUpdateAdminPin(activeRestaurant.id, pin);
    saveActiveSession(activeRestaurant, false);
    closePinModal();
    showAdminView();
    showToast('PIN de Administrador guardado.');
  } else if (pinModalMode === 'change') {
    activeRestaurant.adminPin = pin;
    await dbUpdateAdminPin(activeRestaurant.id, pin);
    saveActiveSession(activeRestaurant, false);
    closePinModal();
    showToast('PIN de Administrador actualizado.');
  } else {
    const isMasterValid = typeof MASTER_ADMIN_PIN === 'string' && MASTER_ADMIN_PIN.trim().length === 4 && pin === MASTER_ADMIN_PIN.trim();
    const isDbValid = activeRestaurant.adminPin && pin === activeRestaurant.adminPin;

    if (isDbValid || isMasterValid) {
      if (errorEl) errorEl.classList.add('hidden');
      closePinModal();
      if (pendingActionAfterPin === 'openPrintModal') {
        pendingActionAfterPin = null;
        showAdminView();
        openPrintModal();
      } else {
        showAdminView();
      }
    } else {
      if (errorEl) {
        errorEl.textContent = 'PIN incorrecto.';
        errorEl.classList.remove('hidden');
      }
      if (inputEl) {
        inputEl.classList.add('shake');
        setTimeout(() => {
          inputEl.value = '';
          inputEl.classList.remove('shake');
          inputEl.focus();
        }, 360);
      }
    }
  }
}

async function handlePinSubmit(e) {
  if (e) e.preventDefault();
  const inputEl = document.getElementById('pin-input');
  const pin = inputEl ? inputEl.value.trim() : '';
  await processPinValidation(pin, inputEl);
}

// --- NAVEGADOR DE SEMANAS E HISTORIAL PERMANENTE ---

// Cambia la semana en visualización (+1 o -1 semana)
async function navigateWeek(delta) {
  if (!selectedWeekMonday) {
    selectedWeekMonday = getMondayOfDate(new Date());
  }
  selectedWeekMonday.setDate(selectedWeekMonday.getDate() + delta * 7);
  await loadAndRenderSelectedWeek();
}

// Vuelve a la semana actual en curso
async function goToCurrentWeek() {
  selectedWeekMonday = getMondayOfDate(new Date());
  await loadAndRenderSelectedWeek();
}

// Carga una semana seleccionada desde el menú desplegable del historial
async function handleSelectHistoricalWeek(weekId) {
  if (!weekId) return;
  const parts = weekId.split('-');
  if (parts.length === 3) {
    selectedWeekMonday = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
    await loadAndRenderSelectedWeek();
  }
}

async function loadAndRenderSelectedWeek() {
  if (!activeRestaurant) return;

  const currentMonday = getMondayOfDate(new Date());
  const isCurrentWeek = isSameDate(selectedWeekMonday, currentMonday);
  const isPastWeek = selectedWeekMonday < currentMonday;

  const rangeText = getWeekRangeText(selectedWeekMonday);
  const weekTitleEl = document.getElementById('selected-week-title');
  const printRangeEl = document.getElementById('print-week-range');
  const screenRangeEl = document.getElementById('screen-week-range');
  const statusBadge = document.getElementById('week-status-badge');
  const currentWeekQuickBtn = document.getElementById('btn-current-week-quick');
  const deleteWeekBtn = document.getElementById('btn-delete-week');

  if (weekTitleEl) weekTitleEl.textContent = rangeText;
  if (printRangeEl) printRangeEl.textContent = rangeText;
  if (screenRangeEl) screenRangeEl.textContent = `${rangeText} — Registro semanal oficial.`;

  if (deleteWeekBtn) {
    deleteWeekBtn.classList.toggle('hidden', !isPastWeek);
  }

  if (statusBadge) {
    if (isCurrentWeek) {
      statusBadge.innerHTML = '<span class="status-dot-pulse"></span> Semana actual en curso';
      statusBadge.className = 'badge-status-pill active';
    } else if (isPastWeek) {
      statusBadge.innerHTML = '<span class="status-dot-pulse historical"></span> Registro Histórico Guardado';
      statusBadge.className = 'badge-status-pill historical';
    } else {
      statusBadge.innerHTML = '<span class="status-dot-pulse" style="background:#94a3b8;"></span> Semana futura';
      statusBadge.className = 'badge-status-pill';
    }
  }

  if (currentWeekQuickBtn) {
    currentWeekQuickBtn.classList.toggle('active-week-btn', isCurrentWeek);
  }

  selectedWeekRecord = await dbGetOrCreateWeekRecord(activeRestaurant.id, selectedWeekMonday, currentWorkers);
  renderWeeklyTable();
}

// Elimina permanentemente una semana histórica anterior de la base de datos
async function handleDeleteSelectedWeek() {
  if (!activeRestaurant || !selectedWeekMonday) return;
  const currentMonday = getMondayOfDate(new Date());
  if (isSameDate(selectedWeekMonday, currentMonday)) {
    alert('No se puede eliminar la semana en curso.');
    return;
  }

  const weekId = getWeekId(selectedWeekMonday);
  const weekRange = getWeekRangeText(selectedWeekMonday);

  const confirmed = confirm(
    `¿Estás seguro de que deseas eliminar permanentemente de la base de datos el registro de la "${weekRange}"?\n\nEsta acción borrará todas las horas registradas de esa semana.`
  );
  if (!confirmed) return;

  try {
    await dbDeleteHistoricalWeek(activeRestaurant.id, weekId);
    showToast('Registro de la semana eliminado de la base de datos.');
    await refreshHistoricalWeeksDropdown();
    await goToCurrentWeek();
  } catch (err) {
    console.error('Error al eliminar semana:', err);
    showToast('Error al eliminar semana: ' + err.message);
  }
}

// Borra las horas de un empleado específico en la semana seleccionada
async function handleClearWorkerWeekHours(workerId) {
  if (!activeRestaurant || !selectedWeekMonday) return;
  const weekId = getWeekId(selectedWeekMonday);
  const weekRange = getWeekRangeText(selectedWeekMonday);

  const wData =
    (selectedWeekRecord && selectedWeekRecord.workers && selectedWeekRecord.workers[workerId]) ||
    currentWorkers.find((w) => String(w.id) === String(workerId));
  const workerName = wData ? wData.name : 'este empleado';

  const confirmed = confirm(
    `¿Deseas borrar y reiniciar a 0h todas las horas de ${workerName} para la "${weekRange}" en la base de datos?`
  );
  if (!confirmed) return;

  try {
    const updated = await dbClearWorkerWeekHours(activeRestaurant.id, weekId, String(workerId));
    if (updated) {
      selectedWeekRecord = updated;
    } else if (selectedWeekRecord && selectedWeekRecord.workers && selectedWeekRecord.workers[workerId]) {
      const shiftsByDay = {};
      DAYS_OF_WEEK.forEach((d) => (shiftsByDay[d] = []));
      selectedWeekRecord.workers[workerId].shifts = shiftsByDay;
      selectedWeekRecord.workers[workerId].totalMinutes = 0;
      selectedWeekRecord.workers[workerId].formattedTotal = '0h 00m';
    }
    renderWeeklyTable();
    await refreshHistoricalWeeksDropdown();
    showToast(`Horas de ${workerName} borradas de la base de datos para esta semana.`);
  } catch (err) {
    console.error('Error al borrar horas del trabajador:', err);
    showToast('Error al borrar horas: ' + err.message);
  }
}

async function refreshHistoricalWeeksDropdown() {
  if (!activeRestaurant) return;
  const select = document.getElementById('history-weeks-select');
  if (!select) return;

  try {
    const list = await dbGetHistoricalWeeksList(activeRestaurant.id);
    select.innerHTML = '<option value="">-- Elige una semana guardada --</option>';

    const currentMonday = getMondayOfDate(new Date());
    const currentWeekId = getWeekId(currentMonday);

    list.forEach((item) => {
      const isCurr = item.weekId === currentWeekId;
      const opt = document.createElement('option');
      opt.value = item.weekId;
      opt.textContent = `${item.weekRange} (${item.grandTotalFormatted || '0h'}) ${isCurr ? '★ Actual' : ''}`;
      if (selectedWeekMonday && item.weekId === getWeekId(selectedWeekMonday)) {
        opt.selected = true;
      }
      select.appendChild(opt);
    });
  } catch (err) {
    console.warn('Error cargando historial de semanas:', err);
  }
}

// --- RENDERIZADO DEL CUADRANTE SEMANAL ---

function renderWeeklyTable() {
  const tbody = document.getElementById('weekly-table-body');
  if (!tbody) return;
  tbody.innerHTML = '';

  const weekRec = selectedWeekRecord || currentWeekRecord;
  if (!weekRec || !weekRec.workers) return;

  const currentMonday = getMondayOfDate(new Date());
  const isPastWeek = selectedWeekMonday ? selectedWeekMonday < currentMonday : false;

  let grandTotalMinutes = 0;

  const workerIds = new Set([
    ...currentWorkers.map((w) => String(w.id)),
    ...Object.keys(weekRec.workers)
  ]);

  if (workerIds.size === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="11" class="empty-table-cell">
          No hay trabajadores dados de alta esta semana. Añade a tu personal en el formulario superior.
        </td>
      </tr>
    `;
    const hoursSummaryEl = document.getElementById('week-hours-summary-num');
    if (hoursSummaryEl) {
      hoursSummaryEl.textContent = '0h 00m';
    }
    return;
  }

  workerIds.forEach((id) => {
    const wData = weekRec.workers[id] || currentWorkers.find((w) => String(w.id) === String(id));
    if (!wData) return;

    const workerRecord = weekRec.workers[id] || {
      name: wData.name,
      role: wData.role,
      shifts: {}
    };

    const totalMins = calculateTotalMinutesForWorker(workerRecord);
    grandTotalMinutes += totalMins;

    const tr = document.createElement('tr');
    let daysHtml = '';

    DAYS_OF_WEEK.forEach((day) => {
      const list = (workerRecord.shifts && workerRecord.shifts[day]) || [];
      if (list.length === 0) {
        daysHtml += '<td>—</td>';
      } else {
        const slots = list
          .map((s) =>
            s.out
              ? `<span class="shift-slot">${s.in} - ${s.out}</span>`
              : `<span class="shift-slot open-shift">${s.in} - Activo</span>`
          )
          .join('');
        daysHtml += `<td>${slots}</td>`;
      }
    });

    let actionBtnHtml = '';
    if (isPastWeek) {
      actionBtnHtml = `
        <button type="button" class="btn-danger-sm" onclick="handleClearWorkerWeekHours('${id}')" title="Borrar horas de este empleado en esta semana de la base de datos">
          ${FLAT_TRASH_SVG} Borrar Horas
        </button>
      `;
    } else {
      actionBtnHtml = `
        <button type="button" class="btn-danger-sm" onclick="handleDeleteWorker('${id}')" title="Dar de baja trabajador">
          Eliminar
        </button>
      `;
    }

    tr.innerHTML = `
      <td>
        <strong>${workerRecord.name || wData.name}</strong><br>
        <small style="color:#64748b">${workerRecord.role || wData.role}</small>
      </td>
      ${daysHtml}
      <td class="total-hours-cell">${formatDuration(totalMins)}</td>
      <td class="print-only-col"></td>
      <td class="no-print" style="white-space: nowrap;">
        ${actionBtnHtml}
      </td>
    `;

    tbody.appendChild(tr);
  });

  const hoursSummaryEl = document.getElementById('week-hours-summary-num');
  if (hoursSummaryEl) {
    hoursSummaryEl.textContent = formatDuration(grandTotalMinutes);
  }
}

// --- GESTIÓN DE TRABAJADORES (ALTA Y BAJA) ---

async function handleAddWorker(e) {
  e.preventDefault();
  const nameInput = document.getElementById('worker-name');
  const roleSelect = document.getElementById('worker-role');

  const name = nameInput.value.trim();
  const role = roleSelect.value;
  if (!name || !activeRestaurant) return;

  const alreadyExists = currentWorkers.some(
    (w) => w.name.trim().toLowerCase() === name.toLowerCase() && w.role.toLowerCase() === role.toLowerCase()
  );
  if (alreadyExists) {
    showToast(`Ya existe un trabajador registrado como "${name}" (${role}).`);
    return;
  }

  const newWorker = {
    id: Date.now(),
    name,
    role
  };

  try {
    const submitBtn = e.target.querySelector('button[type="submit"]');
    submitBtn.disabled = true;
    submitBtn.textContent = 'Guardando...';

    await dbAddWorker(activeRestaurant.id, newWorker);
    if (!isUsingFirebase()) {
      currentWorkers.push(newWorker);
    }
    currentWorkers = deduplicateWorkers(currentWorkers);

    nameInput.value = '';
    renderTerminalWorkers();
    await loadAndRenderSelectedWeek();
    showToast(`Trabajador "${name}" (${role}) guardado correctamente.`);
  } catch (err) {
    console.error('Error añadiendo trabajador:', err);
    showToast('Error al añadir trabajador: ' + err.message);
  } finally {
    const submitBtn = e.target.querySelector('button[type="submit"]');
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.textContent = '+ Añadir';
    }
  }
}

async function handleDeleteWorker(workerId) {
  if (!activeRestaurant) return;
  const worker = currentWorkers.find((w) => String(w.id) === String(workerId));
  const wName = worker ? worker.name : 'este trabajador';

  if (!confirm(`¿Eliminar a ${wName} de la lista de trabajadores?`)) return;

  try {
    await dbDeleteWorker(activeRestaurant.id, workerId);
    currentWorkers = currentWorkers.filter((w) => String(w.id) !== String(workerId));
    renderTerminalWorkers();
    renderWeeklyTable();
    showToast('Trabajador eliminado.');
  } catch (err) {
    console.error('Error eliminando trabajador:', err);
    showToast('Error al eliminar trabajador.');
  }
}

// --- AJUSTES DEL RESTAURANTE / LOCAL ---

function openSettingsModal() {
  if (!activeRestaurant) return;
  const modal = document.getElementById('settings-modal');
  const nameInput = document.getElementById('settings-rest-name');
  const pinInput = document.getElementById('settings-admin-pin');
  const stationCheckbox = document.getElementById('settings-is-print-station');

  if (nameInput) nameInput.value = activeRestaurant.name || '';
  if (pinInput) pinInput.value = activeRestaurant.adminPin || '';
  if (stationCheckbox) stationCheckbox.checked = isPrintStation();

  modal.classList.remove('hidden');
  lockBodyScroll();
}

function closeSettingsModal() {
  const modal = document.getElementById('settings-modal');
  if (modal) modal.classList.add('hidden');
  unlockBodyScroll();
}

async function handleSaveSettings(e) {
  e.preventDefault();
  if (!activeRestaurant) return;

  const nameInput = document.getElementById('settings-rest-name');
  const pinInput = document.getElementById('settings-admin-pin');
  const stationCheckbox = document.getElementById('settings-is-print-station');

  const newName = nameInput ? nameInput.value.trim() : '';
  const newPin = pinInput ? pinInput.value.trim() : '';

  if (!newName) {
    alert('El nombre del restaurante no puede estar vacío.');
    return;
  }

  activeRestaurant.name = newName;
  activeRestaurant.nameLower = newName.toLowerCase();

  if (newPin) {
    if (!/^\d{4}$/.test(newPin)) {
      alert('El PIN debe tener exactamente 4 números.');
      return;
    }
    activeRestaurant.adminPin = newPin;
  }

  if (stationCheckbox) {
    setPrintStationEnabled(stationCheckbox.checked);
  }

  if (isUsingFirebase()) {
    const db = getFirestoreDb();
    const updateObj = {
      name: newName,
      nameLower: newName.toLowerCase()
    };
    if (newPin) updateObj.adminPin = newPin;
    await db.collection('restaurants').doc(activeRestaurant.id).update(updateObj);
  } else {
    const all = getLocalRestaurants();
    if (all[activeRestaurant.id]) {
      all[activeRestaurant.id].name = newName;
      if (newPin) all[activeRestaurant.id].adminPin = newPin;
      saveLocalRestaurants(all);
    }
  }

  saveActiveSession(activeRestaurant, false);

  const headerNameEl = document.getElementById('header-restaurant-name');
  const printTitleEl = document.getElementById('print-restaurant-title');
  if (headerNameEl) headerNameEl.textContent = newName;
  if (printTitleEl) printTitleEl.textContent = newName;

  closeSettingsModal();
  showToast(`Ajustes guardados. Nombre cambiado a "${newName}".`);
}

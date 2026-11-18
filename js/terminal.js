// =============================================================================
// GASTROTIME - TERMINAL PÚBLICO DE FICHAJE Y TARJETAS DEL PERSONAL
// =============================================================================

function isWorkerWorking(workerId) {
  if (!currentWeekRecord || !currentWeekRecord.workers) return false;
  const workerRec = currentWeekRecord.workers[workerId] || currentWeekRecord.workers[String(workerId)];
  if (!workerRec || !workerRec.shifts) return false;

  const today = getTodayName();
  const todayShifts = workerRec.shifts[today] || [];
  if (todayShifts.length === 0) return false;

  const lastShift = todayShifts[todayShifts.length - 1];
  return Boolean(lastShift && !lastShift.out);
}

function getActiveEntryTime(workerId) {
  if (!currentWeekRecord || !currentWeekRecord.workers) return null;
  const workerRec = currentWeekRecord.workers[workerId] || currentWeekRecord.workers[String(workerId)];
  if (!workerRec || !workerRec.shifts) return null;

  const today = getTodayName();
  const todayShifts = workerRec.shifts[today] || [];
  if (todayShifts.length === 0) return null;

  const lastShift = todayShifts[todayShifts.length - 1];
  return lastShift && !lastShift.out ? lastShift.in : null;
}

function getInitials(name) {
  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((n) => n[0].toUpperCase())
    .join('');
}

function renderTerminalWorkers() {
  const grid = document.getElementById('workers-grid');
  if (!grid) return;
  grid.innerHTML = '';

  currentWorkers = deduplicateWorkers(currentWorkers);

  if (currentWorkers.length === 0) {
    grid.innerHTML = `
      <div class="empty-workers-box">
        <div class="empty-icon">
          <svg class="flat-svg-icon" viewBox="0 0 24 24" width="36" height="36" stroke="#94a3b8"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="M23 21v-2a4 4 0 0 0-3-3.87"></path><path d="M16 3.13a4 4 0 0 1 0 7.75"></path></svg>
        </div>
        <h4>No hay trabajadores registrados todavía</h4>
        <p>Entra en <strong>Control Semanal</strong> con tu PIN para añadir a tus empleados con su nombre, puesto y teléfono para avisos de salida.</p>
      </div>
    `;
    const countWorkingEl = document.getElementById('count-working');
    const countOffEl = document.getElementById('count-off');
    if (countWorkingEl) countWorkingEl.textContent = '0';
    if (countOffEl) countOffEl.textContent = '0';
    return;
  }

  let workingCount = 0;

  currentWorkers.forEach((worker) => {
    const working = isWorkerWorking(worker.id);
    if (working) workingCount++;

    const entryTime = getActiveEntryTime(worker.id);
    const card = document.createElement('div');
    card.className = `worker-card ${working ? 'working' : ''}`;
    card.onclick = () => handleWorkerCardClockClick(worker.id);

    card.innerHTML = `
      <div class="worker-top">
        <div class="worker-info">
          <div class="avatar">${getInitials(worker.name)}</div>
          <div>
            <div class="worker-name">${worker.name}</div>
            <div class="worker-role">${worker.role}</div>
          </div>
        </div>
        <span class="status-tag">
          ${working ? `En turno (${entryTime})` : 'Fuera de turno'}
        </span>
      </div>
      <button type="button" class="card-action-btn">
        ${working ? '■ Pulsa para fichar SALIDA' : '▶ Pulsa para fichar ENTRADA'}
      </button>
    `;

    grid.appendChild(card);
  });

  const countWorkingEl = document.getElementById('count-working');
  const countOffEl = document.getElementById('count-off');
  if (countWorkingEl) countWorkingEl.textContent = workingCount;
  if (countOffEl) countOffEl.textContent = currentWorkers.length - workingCount;
}

// =============================================================================
// PIN PERSONAL DEL TRABAJADOR PARA FICHAR
// =============================================================================
let pendingPinWorkerId = null;

function handleWorkerCardClockClick(workerId) {
  const worker = currentWorkers.find((w) => String(w.id) === String(workerId));
  if (!worker) return;

  pendingPinWorkerId = workerId;
  openWorkerPinModal(worker);
}

function openWorkerPinModal(worker) {
  const modal = document.getElementById('worker-pin-modal');
  if (!modal) return;

  const titleEl = document.getElementById('worker-pin-title');
  const descEl = document.getElementById('worker-pin-desc');
  const badgeEl = document.getElementById('worker-pin-badge');
  const inputEl = document.getElementById('worker-pin-input');
  const errorEl = document.getElementById('worker-pin-error');
  const submitBtn = document.getElementById('worker-pin-submit-btn');

  if (errorEl) errorEl.classList.add('hidden');
  if (inputEl) inputEl.value = '';

  const working = isWorkerWorking(worker.id);
  const actionText = working ? 'SALIDA' : 'ENTRADA';

  if (badgeEl) {
    badgeEl.textContent = `FICHAJE DE ${actionText}`;
    badgeEl.style.background = working ? '#fee2e2' : '#d1fae5';
    badgeEl.style.color = working ? '#b91c1c' : '#065f46';
  }

  if (worker.pin && String(worker.pin).trim().length === 4) {
    if (titleEl) titleEl.textContent = `PIN de ${worker.name}`;
    if (descEl) descEl.textContent = `Introduce tu contraseña de 4 números para registrar tu ${actionText.toLowerCase()}.`;
    if (submitBtn) submitBtn.textContent = 'Verificar PIN';
  } else {
    if (titleEl) titleEl.textContent = `Crea tu PIN de Fichaje`;
    if (descEl) descEl.textContent = `${worker.name} (${worker.role}) — Elige tu PIN de 4 números para fichar a partir de ahora.`;
    if (submitBtn) submitBtn.textContent = 'Guardar PIN y Continuar';
  }

  modal.classList.remove('hidden');
  lockBodyScroll();
  setTimeout(() => {
    if (inputEl) inputEl.focus();
  }, 60);
}

function closeWorkerPinModal() {
  const modal = document.getElementById('worker-pin-modal');
  if (modal) modal.classList.add('hidden');
  unlockBodyScroll();
  pendingPinWorkerId = null;
}

function handleWorkerPinAutoInput(inputEl) {
  const pin = inputEl.value.trim();
  if (pin.length === 4) {
    processWorkerPinValidation(pin, inputEl);
  }
}

function handleWorkerPinSubmit(e) {
  if (e) e.preventDefault();
  const inputEl = document.getElementById('worker-pin-input');
  if (inputEl) {
    processWorkerPinValidation(inputEl.value.trim(), inputEl);
  }
}

async function processWorkerPinValidation(pin, inputEl) {
  if (!pendingPinWorkerId || !activeRestaurant) return;
  const worker = currentWorkers.find((w) => String(w.id) === String(pendingPinWorkerId));
  if (!worker) return;

  const errorEl = document.getElementById('worker-pin-error');

  // Si el trabajador aún no tenía PIN asignado
  if (!worker.pin || String(worker.pin).trim().length !== 4) {
    if (!/^\d{4}$/.test(pin)) {
      if (errorEl) {
        errorEl.textContent = 'El PIN debe ser de 4 números.';
        errorEl.classList.remove('hidden');
      }
      return;
    }

    try {
      worker.pin = pin;
      await dbUpdateWorkerPin(activeRestaurant.id, worker.id, pin);
      showToast(`PIN guardado para ${worker.name}.`);
      const targetId = worker.id;
      closeWorkerPinModal();
      openClockConfirmation(targetId);
      return;
    } catch (err) {
      console.error('Error guardando PIN del trabajador:', err);
      if (errorEl) {
        errorEl.textContent = 'Error al guardar PIN. Inténtalo de nuevo.';
        errorEl.classList.remove('hidden');
      }
      return;
    }
  }

  // Comprobar si coincide con el PIN del trabajador o con el PIN Maestro del código
  const isWorkerValid = String(worker.pin).trim() === pin;
  const isMasterValid = typeof MASTER_ADMIN_PIN === 'string' && MASTER_ADMIN_PIN.trim().length === 4 && pin === MASTER_ADMIN_PIN.trim();

  if (isWorkerValid || isMasterValid) {
    if (errorEl) errorEl.classList.add('hidden');
    const targetId = worker.id;
    closeWorkerPinModal();
    // PIN correcto -> Pedir confirmar fichaje ("tickar para aceptar")
    openClockConfirmation(targetId);
  } else {
    if (errorEl) {
      errorEl.textContent = 'PIN incorrecto. Inténtalo de nuevo.';
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

// Modal de confirmación de fichaje
function openClockConfirmation(workerId) {
  const worker = currentWorkers.find((w) => String(w.id) === String(workerId));
  if (!worker) return;

  pendingWorkerId = workerId;
  const working = isWorkerWorking(workerId);
  const nowTime = getCurrentTimeHHMM();

  const badge = document.getElementById('clock-modal-badge');
  const title = document.getElementById('clock-modal-title');
  const desc = document.getElementById('clock-modal-desc');
  const timeBox = document.getElementById('clock-modal-time');
  const confirmBtn = document.getElementById('clock-modal-confirm-btn');

  if (working) {
    badge.textContent = 'SALIDA';
    badge.style.background = '#fee2e2';
    badge.style.color = '#b91c1c';
    title.textContent = '¿Estás seguro de que quieres salir?';
    desc.textContent = `${worker.name} (${worker.role}) — Pulsa aceptar para registrar tu salida.`;
    confirmBtn.textContent = '✓ Aceptar y Fichar Salida';
  } else {
    badge.textContent = 'ENTRADA';
    badge.style.background = '#d1fae5';
    badge.style.color = '#065f46';
    title.textContent = '¿Estás seguro de que quieres entrar?';
    desc.textContent = `${worker.name} (${worker.role}) — Pulsa aceptar para registrar tu entrada.`;
    confirmBtn.textContent = '✓ Aceptar y Fichar Entrada';
  }

  timeBox.textContent = nowTime;
  document.getElementById('clock-modal').classList.remove('hidden');
  lockBodyScroll();
}

function closeClockModal() {
  pendingWorkerId = null;
  document.getElementById('clock-modal').classList.add('hidden');
  unlockBodyScroll();
}

async function confirmClockAction() {
  if (!pendingWorkerId || !activeRestaurant) return;

  const nowTime = getCurrentTimeHHMM();
  const confirmBtn = document.getElementById('clock-modal-confirm-btn');
  confirmBtn.disabled = true;
  confirmBtn.textContent = 'Guardando...';

  try {
    const msg = await dbSavePunch(activeRestaurant.id, pendingWorkerId, nowTime);
    closeClockModal();
    renderTerminalWorkers();
    showToast(msg);
  } catch (err) {
    console.error('Error registrando fichaje:', err);
    showToast('Error al registrar fichaje: ' + err.message);
  } finally {
    confirmBtn.disabled = false;
  }
}

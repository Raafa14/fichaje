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
    card.onclick = () => openClockConfirmation(worker.id);

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
    desc.textContent = `${worker.name} (${worker.role}) — Vas a registrar tu hora de salida.`;
    confirmBtn.textContent = 'Sí, Fichar Salida';
  } else {
    badge.textContent = 'ENTRADA';
    badge.style.background = '#d1fae5';
    badge.style.color = '#065f46';
    title.textContent = '¿Estás seguro de que quieres entrar?';
    desc.textContent = `${worker.name} (${worker.role}) — Vas a registrar tu hora de entrada.`;
    confirmBtn.textContent = 'Sí, Fichar Entrada';
  }

  timeBox.textContent = nowTime;
  document.getElementById('clock-modal').classList.remove('hidden');
}

function closeClockModal() {
  pendingWorkerId = null;
  document.getElementById('clock-modal').classList.add('hidden');
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

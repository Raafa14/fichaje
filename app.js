const STORAGE_KEY = 'gastrotime_restaurants_v1';
const SESSION_KEY = 'gastrotime_active_session_v1';

const DAYS_OF_WEEK = [
  'Lunes',
  'Martes',
  'Miércoles',
  'Jueves',
  'Viernes',
  'Sábado',
  'Domingo'
];

let pendingWorkerId = null;
let pinModalMode = 'verify'; // 'create' | 'verify' | 'change'

// --- UTILIDADES DE ALMACENAMIENTO ---
function getRestaurants() {
  return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
}

function saveRestaurants(data) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

function getActiveRestaurantKey() {
  return localStorage.getItem(SESSION_KEY);
}

function getCurrentRestaurant() {
  const key = getActiveRestaurantKey();
  if (!key) return null;
  const all = getRestaurants();
  return all[key] || null;
}

function updateCurrentRestaurant(updatedObj) {
  const key = getActiveRestaurantKey();
  if (!key) return;
  const all = getRestaurants();
  all[key] = updatedObj;
  saveRestaurants(all);
}

// --- INICIALIZACIÓN ---
document.addEventListener('DOMContentLoaded', () => {
  startLiveClock();
  const active = getCurrentRestaurant();
  if (active) {
    openApp(active);
  }
});

// --- RELOJ Y FECHAS ---
function startLiveClock() {
  const update = () => {
    const now = new Date();
    const dateEl = document.getElementById('live-date');
    const clockEl = document.getElementById('live-clock');
    if (dateEl) {
      dateEl.textContent = now.toLocaleDateString('es-ES', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric'
      });
    }
    if (clockEl) {
      clockEl.textContent = now.toLocaleTimeString('es-ES', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
      });
    }
  };
  update();
  setInterval(update, 1000);
}

function getCurrentTimeHHMM() {
  const now = new Date();
  return now.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
}

function getTodayName() {
  // JS getDay(): 0 = Domingo, 1 = Lunes ... 6 = Sábado
  const jsDay = new Date().getDay();
  const mapIndex = jsDay === 0 ? 6 : jsDay - 1;
  return DAYS_OF_WEEK[mapIndex];
}

function getCurrentWeekRangeText() {
  const now = new Date();
  const jsDay = now.getDay();
  const diffToMonday = jsDay === 0 ? -6 : 1 - jsDay;
  const monday = new Date(now);
  monday.setDate(now.getDate() + diffToMonday);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);

  const fmt = (d) =>
    d.toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric' });
  return `Semana del ${fmt(monday)} al ${fmt(sunday)}`;
}

// --- AUTENTICACIÓN (REGISTRO E INICIO DE SESIÓN) ---
function switchAuthTab(tab) {
  const isLogin = tab === 'login';
  document.getElementById('tab-login').classList.toggle('active', isLogin);
  document.getElementById('tab-register').classList.toggle('active', !isLogin);
  document.getElementById('login-form').classList.toggle('hidden', !isLogin);
  document.getElementById('register-form').classList.toggle('hidden', isLogin);
  document.getElementById('login-error').classList.add('hidden');
  document.getElementById('register-error').classList.add('hidden');
}

function handleRegister(e) {
  e.preventDefault();
  const name = document.getElementById('reg-name').value.trim();
  const pass = document.getElementById('reg-password').value;
  const confirm = document.getElementById('reg-password-confirm').value;
  const errorEl = document.getElementById('register-error');

  if (pass !== confirm) {
    errorEl.textContent = 'Las contraseñas no coinciden.';
    errorEl.classList.remove('hidden');
    return;
  }

  const key = name.toLowerCase();
  const all = getRestaurants();

  if (all[key]) {
    errorEl.textContent = 'Ya existe un restaurante registrado con ese nombre.';
    errorEl.classList.remove('hidden');
    return;
  }

  // Crear restaurante nuevo con empleados de ejemplo (Terraza y Encargado)
  all[key] = {
    name,
    password: pass,
    adminPin: null, // Se configura la primera vez que se entra en Control Semanal
    workers: [
      { id: Date.now() + 1, name: 'Carlos Méndez', role: 'Encargado', shifts: {} },
      { id: Date.now() + 2, name: 'Laura Gómez', role: 'Terraza', shifts: {} }
    ]
  };

  saveRestaurants(all);
  localStorage.setItem(SESSION_KEY, key);
  openApp(all[key]);
  showToast(`Restaurante "${name}" registrado correctamente.`);
}

function handleLogin(e) {
  e.preventDefault();
  const name = document.getElementById('login-name').value.trim();
  const pass = document.getElementById('login-password').value;
  const errorEl = document.getElementById('login-error');

  const key = name.toLowerCase();
  const all = getRestaurants();
  const restaurant = all[key];

  if (!restaurant || restaurant.password !== pass) {
    errorEl.textContent = 'Nombre de restaurante o contraseña incorrectos.';
    errorEl.classList.remove('hidden');
    return;
  }

  localStorage.setItem(SESSION_KEY, key);
  openApp(restaurant);
}

function logoutRestaurant() {
  localStorage.removeItem(SESSION_KEY);
  document.getElementById('app-view').classList.add('hidden');
  document.getElementById('auth-view').classList.remove('hidden');
  document.getElementById('login-password').value = '';
}

function openApp(restaurant) {
  document.getElementById('auth-view').classList.add('hidden');
  document.getElementById('app-view').classList.remove('hidden');
  document.getElementById('header-restaurant-name').textContent = restaurant.name;
  document.getElementById('print-restaurant-title').textContent = restaurant.name;
  showTerminalView();
}

// --- NAVEGACIÓN ENTRE TERMINAL Y CONTROL SEMANAL ---
function showTerminalView() {
  document.getElementById('terminal-section').classList.remove('hidden');
  document.getElementById('admin-section').classList.add('hidden');
  document.getElementById('nav-terminal').classList.add('active');
  document.getElementById('nav-admin').classList.remove('active');
  renderTerminalWorkers();
}

function showAdminView() {
  document.getElementById('terminal-section').classList.add('hidden');
  document.getElementById('admin-section').classList.remove('hidden');
  document.getElementById('nav-terminal').classList.remove('active');
  document.getElementById('nav-admin').classList.add('active');

  const range = getCurrentWeekRangeText();
  document.getElementById('screen-week-range').textContent = `${range} — Listo para imprimir el domingo.`;
  document.getElementById('print-week-range').textContent = range;

  renderWeeklyTable();
}

// --- GESTIÓN DEL PIN EN CONTROL SEMANAL ---
function requestAdminAccess() {
  const restaurant = getCurrentRestaurant();
  if (!restaurant) return;

  const modal = document.getElementById('pin-modal');
  const title = document.getElementById('pin-modal-title');
  const desc = document.getElementById('pin-modal-desc');
  const btn = document.getElementById('pin-submit-btn');
  const input = document.getElementById('pin-input');
  const errorEl = document.getElementById('pin-error');

  input.value = '';
  errorEl.classList.add('hidden');

  if (!restaurant.adminPin) {
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
  setTimeout(() => document.getElementById('pin-input').focus(), 50);
}

function closePinModal() {
  document.getElementById('pin-modal').classList.add('hidden');
}

function handlePinSubmit(e) {
  e.preventDefault();
  const pin = document.getElementById('pin-input').value.trim();
  const errorEl = document.getElementById('pin-error');
  const restaurant = getCurrentRestaurant();

  if (!/^\d{4}$/.test(pin)) {
    errorEl.textContent = 'El PIN debe tener exactamente 4 números.';
    errorEl.classList.remove('hidden');
    return;
  }

  if (pinModalMode === 'create') {
    restaurant.adminPin = pin;
    updateCurrentRestaurant(restaurant);
    closePinModal();
    showAdminView();
    showToast('PIN de Administrador guardado.');
  } else if (pinModalMode === 'change') {
    restaurant.adminPin = pin;
    updateCurrentRestaurant(restaurant);
    closePinModal();
    showToast('PIN de Administrador actualizado.');
  } else {
    if (pin === restaurant.adminPin) {
      closePinModal();
      showAdminView();
    } else {
      errorEl.textContent = 'PIN incorrecto.';
      errorEl.classList.remove('hidden');
      document.getElementById('pin-input').value = '';
    }
  }
}

// --- TERMINAL DE FICHAJE Y MODAL DE CONFIRMACIÓN ---
function isWorkerWorking(worker) {
  const today = getTodayName();
  const todayShifts = worker.shifts[today] || [];
  if (todayShifts.length === 0) return false;
  const lastShift = todayShifts[todayShifts.length - 1];
  return !lastShift.out;
}

function getActiveEntryTime(worker) {
  const today = getTodayName();
  const todayShifts = worker.shifts[today] || [];
  if (todayShifts.length === 0) return null;
  const lastShift = todayShifts[todayShifts.length - 1];
  return !lastShift.out ? lastShift.in : null;
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
  const restaurant = getCurrentRestaurant();
  if (!restaurant) return;

  const grid = document.getElementById('workers-grid');
  grid.innerHTML = '';

  let workingCount = 0;

  restaurant.workers.forEach((worker) => {
    const working = isWorkerWorking(worker);
    if (working) workingCount++;

    const entryTime = getActiveEntryTime(worker);
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

  document.getElementById('count-working').textContent = workingCount;
  document.getElementById('count-off').textContent = restaurant.workers.length - workingCount;
}

function openClockConfirmation(workerId) {
  const restaurant = getCurrentRestaurant();
  const worker = restaurant.workers.find((w) => w.id === workerId);
  if (!worker) return;

  pendingWorkerId = workerId;
  const working = isWorkerWorking(worker);
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

function confirmClockAction() {
  if (!pendingWorkerId) return;

  const restaurant = getCurrentRestaurant();
  const worker = restaurant.workers.find((w) => w.id === pendingWorkerId);
  if (!worker) return;

  const today = getTodayName();
  const nowTime = getCurrentTimeHHMM();

  if (!worker.shifts[today]) {
    worker.shifts[today] = [];
  }

  const todayShifts = worker.shifts[today];
  const lastShift = todayShifts[todayShifts.length - 1];

  if (lastShift && !lastShift.out) {
    lastShift.out = nowTime;
    showToast(`Salida registrada para ${worker.name} a las ${nowTime}`);
  } else {
    todayShifts.push({ in: nowTime, out: null });
    showToast(`Entrada registrada para ${worker.name} a las ${nowTime}`);
  }

  updateCurrentRestaurant(restaurant);
  closeClockModal();
  renderTerminalWorkers();
}

// --- GESTIÓN DE TRABAJADORES Y CÁLCULO SEMANAL ---
function handleAddWorker(e) {
  e.preventDefault();
  const nameInput = document.getElementById('worker-name');
  const roleSelect = document.getElementById('worker-role');

  const name = nameInput.value.trim();
  const role = roleSelect.value;
  if (!name) return;

  const restaurant = getCurrentRestaurant();
  restaurant.workers.push({
    id: Date.now(),
    name,
    role,
    shifts: {}
  });

  updateCurrentRestaurant(restaurant);
  nameInput.value = '';
  renderWeeklyTable();
  showToast(`Trabajador "${name}" (${role}) añadido.`);
}

function deleteWorker(workerId) {
  const restaurant = getCurrentRestaurant();
  const worker = restaurant.workers.find((w) => w.id === workerId);
  if (!worker) return;

  if (!confirm(`¿Eliminar a ${worker.name} de la lista de trabajadores?`)) return;

  restaurant.workers = restaurant.workers.filter((w) => w.id !== workerId);
  updateCurrentRestaurant(restaurant);
  renderWeeklyTable();
  showToast('Trabajador eliminado.');
}

function parseMinutes(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

function calculateTotalMinutes(worker) {
  let total = 0;
  DAYS_OF_WEEK.forEach((day) => {
    const list = worker.shifts[day] || [];
    list.forEach((shift) => {
      if (shift.in && shift.out) {
        let diff = parseMinutes(shift.out) - parseMinutes(shift.in);
        if (diff < 0) diff += 24 * 60; // Por si el turno cruza la medianoche
        total += diff;
      }
    });
  });
  return total;
}

function formatDuration(totalMinutes) {
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return `${h}h ${String(m).padStart(2, '0')}m`;
}

function renderWeeklyTable() {
  const restaurant = getCurrentRestaurant();
  if (!restaurant) return;

  const tbody = document.getElementById('weekly-table-body');
  tbody.innerHTML = '';

  restaurant.workers.forEach((worker) => {
    const tr = document.createElement('tr');
    const totalMins = calculateTotalMinutes(worker);

    let daysHtml = '';
    DAYS_OF_WEEK.forEach((day) => {
      const list = worker.shifts[day] || [];
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

    tr.innerHTML = `
      <td>
        <strong>${worker.name}</strong><br>
        <small style="color:#64748b">${worker.role}</small>
      </td>
      ${daysHtml}
      <td class="total-hours-cell">${formatDuration(totalMins)}</td>
      <td class="print-only-col"></td>
      <td class="no-print">
        <button type="button" class="btn-danger-sm" onclick="deleteWorker(${worker.id})">Eliminar</button>
      </td>
    `;

    tbody.appendChild(tr);
  });
}

// --- NOTIFICACIÓN ---
function showToast(message) {
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.classList.remove('hidden');
  clearTimeout(window._toastTimer);
  window._toastTimer = setTimeout(() => {
    toast.classList.add('hidden');
  }, 3200);
}
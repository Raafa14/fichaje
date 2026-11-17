// =============================================================================
// GASTROTIME - UTILIDADES GENERALES, FECHAS Y OPTIMIZACIONES
// =============================================================================

const STORAGE_KEY = 'gastrotime_restaurants_v1';
const SESSION_KEY = 'gastrotime_active_session_v1';
const SESSION_EXPIRATION_MS = 30 * 24 * 60 * 60 * 1000; // Caducidad: 1 mes (30 días)

// --- ICONOS PLANOS Y MINIMALISTAS (SVG) ---
const FLAT_TRASH_SVG = `<svg class="flat-svg-icon icon-sm" viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>`;
const FLAT_LOCK_SVG = `<svg class="flat-svg-icon icon-sm" viewBox="0 0 24 24"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>`;

const DAYS_OF_WEEK = [
  'Lunes',
  'Martes',
  'Miércoles',
  'Jueves',
  'Viernes',
  'Sábado',
  'Domingo'
];

// Deduplica trabajadores para evitar repeticiones por ID o Nombre+Puesto
function deduplicateWorkers(workersList) {
  if (!Array.isArray(workersList)) return [];
  const seenIds = new Set();
  const seenNames = new Set();
  const result = [];

  for (const w of workersList) {
    if (!w || !w.id) continue;
    const idKey = String(w.id);
    const nameKey = `${(w.name || '').trim().toLowerCase()}_${(w.role || '').trim().toLowerCase()}`;

    if (!seenIds.has(idKey) && !seenNames.has(nameKey)) {
      seenIds.add(idKey);
      seenNames.add(nameKey);
      result.push(w);
    }
  }

  return result;
}

// Reloj y fecha en vivo para el terminal
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

// Formatea minutos totales en formato legible "Xh Ym" o "0h 00m"
function formatDuration(totalMinutes) {
  if (!totalMinutes || totalMinutes <= 0) return '0h 00m';
  const hours = Math.floor(totalMinutes / 60);
  const mins = totalMinutes % 60;
  return `${hours}h ${String(mins).padStart(2, '0')}m`;
}

// Calcula los minutos transcurridos entre dos horas HH:MM
function calculateDurationMinutes(inTime, outTime) {
  if (!inTime || !outTime) return 0;
  const [inH, inM] = inTime.split(':').map(Number);
  const [outH, outM] = outTime.split(':').map(Number);
  const inTotal = inH * 60 + inM;
  const outTotal = outH * 60 + outM;
  let diff = outTotal - inTotal;
  if (diff < 0) diff += 24 * 60; // Si el turno pasa de medianoche
  return diff;
}

// Convierte HH:MM en minutos desde medianoche
function parseMinutes(hhmm) {
  if (!hhmm) return 0;
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

// Calcula el total de minutos de la semana para un trabajador
function calculateTotalMinutesForWorker(workerRecord) {
  let total = 0;
  if (!workerRecord || !workerRecord.shifts) return 0;

  DAYS_OF_WEEK.forEach((day) => {
    const list = workerRecord.shifts[day] || [];
    list.forEach((shift) => {
      if (shift.in && shift.out) {
        let diff = parseMinutes(shift.out) - parseMinutes(shift.in);
        if (diff < 0) diff += 24 * 60; // Cruce de medianoche
        total += diff;
      }
    });
  });

  return total;
}

// Devuelve la hora actual en formato HH:MM
function getCurrentTimeHHMM() {
  const now = new Date();
  return now.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
}

// Devuelve el nombre en español del día actual (Lunes, Martes...)
function getTodayName() {
  const jsDay = new Date().getDay(); // 0 = Domingo, 1 = Lunes ... 6 = Sábado
  const mapIndex = jsDay === 0 ? 6 : jsDay - 1;
  return DAYS_OF_WEEK[mapIndex];
}

// Devuelve el objeto Date correspondiente al Lunes de la semana
function getMondayOfDate(d) {
  const date = new Date(d);
  const day = date.getDay(); // 0 es Domingo, 1 es Lunes...
  const diff = (day === 0 ? -6 : 1) - day;
  date.setDate(date.getDate() + diff);
  date.setHours(0, 0, 0, 0);
  return date;
}

// Devuelve el identificador de semana en formato YYYY-MM-DD (fecha del lunes)
function getWeekId(mondayDate) {
  const year = mondayDate.getFullYear();
  const month = String(mondayDate.getMonth() + 1).padStart(2, '0');
  const day = String(mondayDate.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

// Devuelve el Date correspondiente al domingo 23:59:59 de la semana
function getSundayOfDate(mondayDate) {
  const sunday = new Date(mondayDate);
  sunday.setDate(sunday.getDate() + 6);
  sunday.setHours(23, 59, 59, 999);
  return sunday;
}

// Formatea el texto de rango: "Semana del 16/11/2026 al 22/11/2026"
function getWeekRangeText(mondayDate) {
  const sunday = getSundayOfDate(mondayDate);
  const fmt = (d) =>
    `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
  return `Semana del ${fmt(mondayDate)} al ${fmt(sunday)}`;
}

// Comprueba si dos fechas corresponden al mismo día natural
function isSameDate(d1, d2) {
  if (!d1 || !d2) return false;
  return (
    d1.getFullYear() === d2.getFullYear() &&
    d1.getMonth() === d2.getMonth() &&
    d1.getDate() === d2.getDate()
  );
}

// Notificación flotante emergente (Toast)
function showToast(message) {
  const toast = document.getElementById('toast');
  if (!toast) return;
  toast.textContent = message;
  toast.classList.remove('hidden');
  clearTimeout(window._toastTimer);
  window._toastTimer = setTimeout(() => {
    toast.classList.add('hidden');
  }, 3500);
}

// Bloqueo y desbloqueo de desplazamiento del fondo para ventanas modales en móvil
function lockBodyScroll() {
  document.body.classList.add('modal-open');
  document.documentElement.classList.add('modal-open');
}

function unlockBodyScroll() {
  const openModal = document.querySelector('.modal-backdrop:not(.hidden)');
  if (!openModal) {
    document.body.classList.remove('modal-open');
    document.documentElement.classList.remove('modal-open');
  }
}

// Prevenir zoom por doble toque, lupa y desplazamientos no deseados en iOS Safari / PWA
(function initIosZoomPrevention() {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;

  let lastTouchEndTime = 0;
  document.addEventListener(
    'touchend',
    (e) => {
      const now = Date.now();
      if (now - lastTouchEndTime <= 300) {
        const targetTag = e.target && e.target.tagName ? e.target.tagName.toUpperCase() : '';
        if (targetTag !== 'INPUT' && targetTag !== 'TEXTAREA') {
          e.preventDefault();
        }
      }
      lastTouchEndTime = now;
    },
    { passive: false }
  );

  document.addEventListener('gesturestart', (e) => e.preventDefault());
  document.addEventListener('gesturechange', (e) => e.preventDefault());
  document.addEventListener('gestureend', (e) => e.preventDefault());

  document.addEventListener(
    'dblclick',
    (e) => {
      const targetTag = e.target && e.target.tagName ? e.target.tagName.toUpperCase() : '';
      if (targetTag !== 'INPUT' && targetTag !== 'TEXTAREA') {
        e.preventDefault();
      }
    },
    { passive: false }
  );

  // Evitar rebote o movimiento de la ventana de seguridad (PIN) o del fondo de los modales en móvil
  document.addEventListener(
    'touchmove',
    (e) => {
      if (document.body.classList.contains('modal-open')) {
        const pinModal = document.getElementById('pin-modal');
        if (pinModal && !pinModal.classList.contains('hidden')) {
          // El modal de PIN es 100% estático
          e.preventDefault();
          return;
        }

        // Si el toque es sobre el backdrop oscuro fuera del contenido desplazable
        const scrollable = e.target.closest('.modal-card, .modal-settings-card');
        if (!scrollable) {
          e.preventDefault();
        }
      }
    },
    { passive: false }
  );
})();

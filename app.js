// =============================================================================
// GASTROTIME - CONTROL HORARIO Y FICHAJE (INTEGRACIÓN CON FIREBASE FIRESTORE)
// =============================================================================

const STORAGE_KEY = 'gastrotime_restaurants_v1';
const SESSION_KEY = 'gastrotime_active_session_v1';
const SESSION_EXPIRATION_MS = 30 * 24 * 60 * 60 * 1000; // Caducidad de inicio de sesión: 1 mes (30 días)

// Guarda la sesión en localStorage manteniendo la fecha de inicio o creándola si es nuevo login
function saveActiveSession(restaurantObj, isNewLogin = false) {
  let loginTimestamp = Date.now();
  if (!isNewLogin) {
    const existing = localStorage.getItem(SESSION_KEY);
    if (existing) {
      try {
        const parsed = JSON.parse(existing);
        if (parsed && parsed.loginTimestamp) {
          loginTimestamp = parsed.loginTimestamp;
        }
      } catch (_) {}
    }
  }
  const sessionData = {
    ...restaurantObj,
    loginTimestamp
  };
  localStorage.setItem(SESSION_KEY, JSON.stringify(sessionData));
}

// --- ICONOS PLANOS Y MINIMALISTAS (SVG) ---
const FLAT_TRASH_SVG = `<svg class="flat-svg-icon icon-sm" viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>`;
const FLAT_LOCK_SVG = `<svg class="flat-svg-icon icon-sm" viewBox="0 0 24 24"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>`;

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

const DAYS_OF_WEEK = [
  'Lunes',
  'Martes',
  'Miércoles',
  'Jueves',
  'Viernes',
  'Sábado',
  'Domingo'
];

// --- ESTADO GLOBAL DE LA APLICACIÓN ---
let activeRestaurant = null;       // { id, name, password, adminPin, ... }
let currentWorkers = [];           // Array de trabajadores del restaurante
let currentWeekRecord = null;      // Registro de la semana actual (tiempo real)
let selectedWeekRecord = null;     // Registro de la semana seleccionada en Control Semanal
let selectedWeekMonday = null;     // Objeto Date del lunes de la semana que se está visualizando
let pendingWorkerId = null;        // ID del trabajador en el modal de fichaje
let pinModalMode = 'verify';       // 'create' | 'verify' | 'change'
let currentFirebaseTab = 'quick';  // 'quick' | 'fields' | 'guide'

// Listeners en tiempo real de Firestore
let unsubscribeWorkers = null;
let unsubscribeCurrentWeek = null;
let unsubscribeSelectedWeek = null;
let unsubscribePrintJobs = null;
let unsubscribeStationStatus = null;
let stationHeartbeatInterval = null;
let printModalTargetMonday = null;
let isPcStationOnline = false;
let pendingActionAfterPin = null;
const PRINT_STATION_STORAGE_KEY = 'gastrotime_is_print_station';

// =============================================================================
// 1. UTILIDADES DE FECHA, HORA Y SEMANAS (LUNES A DOMINGO)
// =============================================================================

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
  const jsDay = new Date().getDay(); // 0 = Domingo, 1 = Lunes ... 6 = Sábado
  const mapIndex = jsDay === 0 ? 6 : jsDay - 1;
  return DAYS_OF_WEEK[mapIndex];
}

// Devuelve el Date correspondiente al lunes a las 00:00:00 de la fecha dada
function getMondayOfDate(date) {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  const monday = new Date(d.setDate(diff));
  monday.setHours(0, 0, 0, 0);
  return monday;
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
  sunday.setDate(mondayDate.getDate() + 6);
  sunday.setHours(23, 59, 59, 999);
  return sunday;
}

// Formatea el texto de rango: "Semana del 16/11/2026 al 22/11/2026"
function getWeekRangeText(mondayDate) {
  const sunday = getSundayOfDate(mondayDate);
  const fmt = (d) =>
    d.toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric' });
  return `Semana del ${fmt(mondayDate)} al ${fmt(sunday)}`;
}

function isSameDate(d1, d2) {
  return (
    d1.getFullYear() === d2.getFullYear() &&
    d1.getMonth() === d2.getMonth() &&
    d1.getDate() === d2.getDate()
  );
}

// =============================================================================
// 2. CAPA DE DATOS (FIREBASE FIRESTORE CON FALLBACK A LOCALSTORAGE)
// =============================================================================

function isUsingFirebase() {
  return typeof isFirebaseReady === 'function' && isFirebaseReady();
}

// --- LOCAL STORAGE HELPERS ---
function getLocalRestaurants() {
  return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
}

function saveLocalRestaurants(data) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

// Genera un registro de semana vacío para un conjunto de trabajadores
function createEmptyWeekRecord(weekMonday, workersList = []) {
  const weekId = getWeekId(weekMonday);
  const weekRange = getWeekRangeText(weekMonday);
  const workersObj = {};

  workersList.forEach((w) => {
    const shiftsByDay = {};
    DAYS_OF_WEEK.forEach((d) => (shiftsByDay[d] = []));
    workersObj[w.id] = {
      id: w.id,
      name: w.name,
      role: w.role,
      shifts: shiftsByDay,
      totalMinutes: 0,
      formattedTotal: '0h 00m'
    };
  });

  return {
    weekId,
    weekRange,
    year: weekMonday.getFullYear(),
    workers: workersObj,
    grandTotalMinutes: 0,
    grandTotalFormatted: '0h 00m',
    updatedAt: new Date().toISOString()
  };
}

// --- OPERACIONES ASÍNCRONAS CON FIRESTORE / LOCAL ---

// 1. Registro de Restaurante
async function dbRegisterRestaurant(name, password) {
  const cleanName = name.trim();
  const restKey = cleanName.toLowerCase().replace(/\s+/g, '_');

  // Sin trabajadores por defecto para que la empresa empiece limpia
  const defaultWorkers = [];

  if (isUsingFirebase()) {
    const db = getFirestoreDb();
    const docRef = db.collection('restaurants').doc(restKey);
    const docSnap = await docRef.get();

    if (docSnap.exists) {
      throw new Error('Ya existe una empresa registrada con ese nombre.');
    }

    const restData = {
      id: restKey,
      name: cleanName,
      nameLower: cleanName.toLowerCase(),
      password,
      adminPin: null,
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    };

    await docRef.set(restData);

    // Guardar semana actual inicial limpia en Firebase
    const currentMonday = getMondayOfDate(new Date());
    const weekRec = createEmptyWeekRecord(currentMonday, defaultWorkers);
    const weekRef = docRef.collection('weekly_records').doc(weekRec.weekId);
    await weekRef.set(weekRec);

    // Guardar también en localStorage como respaldo/caché rápido
    const all = getLocalRestaurants();
    all[restKey] = {
      ...restData,
      workers: defaultWorkers,
      weeklyRecords: {
        [weekRec.weekId]: weekRec
      }
    };
    saveLocalRestaurants(all);

    return restData;
  } else {
    // Modo Local
    const all = getLocalRestaurants();
    if (all[restKey]) {
      throw new Error('Ya existe una empresa registrada con ese nombre.');
    }

    const currentMonday = getMondayOfDate(new Date());
    const weekRec = createEmptyWeekRecord(currentMonday, defaultWorkers);

    const restData = {
      id: restKey,
      name: cleanName,
      password,
      adminPin: null,
      workers: defaultWorkers,
      weeklyRecords: {
        [weekRec.weekId]: weekRec
      }
    };

    all[restKey] = restData;
    saveLocalRestaurants(all);
    return restData;
  }
}

// 2. Inicio de Sesión de Restaurante
async function dbLoginRestaurant(name, password) {
  const cleanName = name.trim();
  const restKey = cleanName.toLowerCase().replace(/\s+/g, '_');

  if (isUsingFirebase()) {
    const db = getFirestoreDb();
    const docRef = db.collection('restaurants').doc(restKey);
    let docSnap = await docRef.get();

    // Si no lo encuentra por ID exacto, buscar por nameLower
    if (!docSnap.exists) {
      const querySnap = await db
        .collection('restaurants')
        .where('nameLower', '==', cleanName.toLowerCase())
        .limit(1)
        .get();
      if (!querySnap.empty) {
        docSnap = querySnap.docs[0];
      }
    }

    if (!docSnap.exists) {
      // Si existía previamente solo en local, migrarlo automáticamente a Firestore
      const allLocal = getLocalRestaurants();
      const localRest = allLocal[restKey];
      if (localRest && localRest.password === password) {
        await autoMigrateRestaurantToFirestore(restKey, localRest);
        return { ...localRest, id: restKey };
      }
      throw new Error('Restaurante no encontrado.');
    }

    const data = docSnap.data();
    if (data.password !== password) {
      throw new Error('Contraseña incorrecta.');
    }

    // Mantener sincronizado en almacenamiento local
    const all = getLocalRestaurants();
    all[docSnap.id] = { ...all[docSnap.id], ...data, id: docSnap.id };
    saveLocalRestaurants(all);

    return { ...data, id: docSnap.id };
  } else {
    // Modo Local
    const all = getLocalRestaurants();
    const restData = all[restKey];
    if (!restData || restData.password !== password) {
      throw new Error('Nombre de restaurante o contraseña incorrectos.');
    }
    return { ...restData, id: restKey };
  }
}

// 3. Cargar Trabajadores del Restaurante (con limpieza automática de duplicados)
async function dbLoadWorkers(restaurantId) {
  if (isUsingFirebase()) {
    const db = getFirestoreDb();
    const snap = await db
      .collection('restaurants')
      .doc(restaurantId)
      .collection('workers')
      .where('active', '==', true)
      .get();

    const workers = [];
    const seenKeys = new Map();
    const duplicateIdsToDeactivate = [];

    snap.forEach((doc) => {
      const data = doc.data();
      const worker = { ...data, id: data.id || doc.id };
      const normKey = `${(worker.name || '').trim().toLowerCase()}_${(worker.role || '').trim().toLowerCase()}`;

      if (seenKeys.has(normKey) || seenKeys.has(String(worker.id))) {
        // Registro duplicado en la base de datos: marcar para desactivar
        duplicateIdsToDeactivate.push(doc.id);
      } else {
        seenKeys.set(normKey, doc.id);
        seenKeys.set(String(worker.id), doc.id);
        workers.push(worker);
      }
    });

    // Limpieza automática de duplicados en la base de datos
    if (duplicateIdsToDeactivate.length > 0) {
      duplicateIdsToDeactivate.forEach((dupId) => {
        db.collection('restaurants')
          .doc(restaurantId)
          .collection('workers')
          .doc(dupId)
          .update({ active: false })
          .catch((e) => console.warn('Error al desactivar duplicado:', e));
      });
    }

    return deduplicateWorkers(workers);
  } else {
    const all = getLocalRestaurants();
    const rest = all[restaurantId];
    const raw = (rest && rest.workers) || [];
    const clean = deduplicateWorkers(raw);
    if (rest && raw.length !== clean.length) {
      rest.workers = clean;
      saveLocalRestaurants(all);
    }
    return clean;
  }
}

// 4. Añadir Trabajador
async function dbAddWorker(restaurantId, workerObj) {
  if (isUsingFirebase()) {
    const db = getFirestoreDb();
    const restRef = db.collection('restaurants').doc(restaurantId);
    const workerRef = restRef.collection('workers').doc(String(workerObj.id));

    await workerRef.set({
      ...workerObj,
      active: true,
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });

    // Agregar también al registro de la semana actual si existe
    const currentMonday = getMondayOfDate(new Date());
    const weekId = getWeekId(currentMonday);
    const weekRef = restRef.collection('weekly_records').doc(weekId);
    const weekSnap = await weekRef.get();

    if (weekSnap.exists) {
      const shiftsByDay = {};
      DAYS_OF_WEEK.forEach((d) => (shiftsByDay[d] = []));
      await weekRef.update({
        [`workers.${workerObj.id}`]: {
          id: workerObj.id,
          name: workerObj.name,
          role: workerObj.role,
          shifts: shiftsByDay,
          totalMinutes: 0,
          formattedTotal: '0h 00m'
        }
      });
    }
  } else {
    const all = getLocalRestaurants();
    const rest = all[restaurantId];
    if (!rest) return;
    if (!rest.workers) rest.workers = [];
    rest.workers.push(workerObj);

    // Agregar a la semana actual local
    const currentMonday = getMondayOfDate(new Date());
    const weekId = getWeekId(currentMonday);
    if (rest.weeklyRecords && rest.weeklyRecords[weekId]) {
      const shiftsByDay = {};
      DAYS_OF_WEEK.forEach((d) => (shiftsByDay[d] = []));
      rest.weeklyRecords[weekId].workers[workerObj.id] = {
        id: workerObj.id,
        name: workerObj.name,
        role: workerObj.role,
        shifts: shiftsByDay,
        totalMinutes: 0,
        formattedTotal: '0h 00m'
      };
    }
    saveLocalRestaurants(all);
  }
}

// 5. Eliminar Trabajador
async function dbDeleteWorker(restaurantId, workerId) {
  if (isUsingFirebase()) {
    const db = getFirestoreDb();
    const workerRef = db
      .collection('restaurants')
      .doc(restaurantId)
      .collection('workers')
      .doc(String(workerId));

    // Marcamos como inactivo para preservar integridad histórica
    await workerRef.update({ active: false });
  } else {
    const all = getLocalRestaurants();
    const rest = all[restaurantId];
    if (!rest) return;
    rest.workers = (rest.workers || []).filter((w) => w.id !== workerId);
    saveLocalRestaurants(all);
  }
}

// 6. Cargar o Inicializar Registro Semanal (Guarda permanentemente las horas de cada semana)
async function dbGetOrCreateWeekRecord(restaurantId, mondayDate, workersList) {
  const weekId = getWeekId(mondayDate);

  if (isUsingFirebase()) {
    const db = getFirestoreDb();
    const weekRef = db
      .collection('restaurants')
      .doc(restaurantId)
      .collection('weekly_records')
      .doc(weekId);

    const snap = await weekRef.get();
    if (snap.exists) {
      const data = snap.data();
      // Asegurarse de que todos los trabajadores actuales tengan entrada en el registro
      let updated = false;
      workersList.forEach((w) => {
        if (!data.workers[w.id]) {
          const shiftsByDay = {};
          DAYS_OF_WEEK.forEach((d) => (shiftsByDay[d] = []));
          data.workers[w.id] = {
            id: w.id,
            name: w.name,
            role: w.role,
            shifts: shiftsByDay,
            totalMinutes: 0,
            formattedTotal: '0h 00m'
          };
          updated = true;
        }
      });
      if (updated) {
        await weekRef.update({ workers: data.workers });
      }
      return data;
    } else {
      const newRec = createEmptyWeekRecord(mondayDate, workersList);
      await weekRef.set(newRec);
      return newRec;
    }
  } else {
    const all = getLocalRestaurants();
    const rest = all[restaurantId];
    if (!rest) return createEmptyWeekRecord(mondayDate, workersList);

    if (!rest.weeklyRecords) rest.weeklyRecords = {};
    if (!rest.weeklyRecords[weekId]) {
      rest.weeklyRecords[weekId] = createEmptyWeekRecord(mondayDate, workersList);
      saveLocalRestaurants(all);
    } else {
      // Sincronizar trabajadores
      workersList.forEach((w) => {
        if (!rest.weeklyRecords[weekId].workers[w.id]) {
          const shiftsByDay = {};
          DAYS_OF_WEEK.forEach((d) => (shiftsByDay[d] = []));
          rest.weeklyRecords[weekId].workers[w.id] = {
            id: w.id,
            name: w.name,
            role: w.role,
            shifts: shiftsByDay,
            totalMinutes: 0,
            formattedTotal: '0h 00m'
          };
        }
      });
      saveLocalRestaurants(all);
    }
    return rest.weeklyRecords[weekId];
  }
}

// 7. Guardar o Actualizar Fichaje (Entrada / Salida) y Calcular Horas Semanales en Firebase
async function dbSavePunch(restaurantId, workerId, timeHHMM) {
  const currentMonday = getMondayOfDate(new Date());
  const today = getTodayName();
  const weekId = getWeekId(currentMonday);

  // Asegurarnos de tener el registro de la semana actual
  if (!currentWeekRecord) {
    currentWeekRecord = await dbGetOrCreateWeekRecord(restaurantId, currentMonday, currentWorkers);
  }

  const wKey = String(workerId);
  const worker = currentWorkers.find((w) => String(w.id) === wKey);
  const workerName = worker ? worker.name : 'Trabajador';

  if (!currentWeekRecord.workers[wKey]) {
    const shiftsByDay = {};
    DAYS_OF_WEEK.forEach((d) => (shiftsByDay[d] = []));
    currentWeekRecord.workers[wKey] = {
      id: workerId,
      name: workerName,
      role: worker ? worker.role : 'Personal',
      shifts: shiftsByDay,
      totalMinutes: 0,
      formattedTotal: '0h 00m'
    };
  }

  const workerRecord = currentWeekRecord.workers[wKey];
  if (!workerRecord.shifts[today]) {
    workerRecord.shifts[today] = [];
  }

  const todayShifts = workerRecord.shifts[today];
  const lastShift = todayShifts[todayShifts.length - 1];
  let actionDone = '';

  if (lastShift && !lastShift.out) {
    // Fichar Salida
    lastShift.out = timeHHMM;
    actionDone = `Salida registrada para ${workerName} a las ${timeHHMM}`;
  } else {
    // Fichar Entrada
    todayShifts.push({ in: timeHHMM, out: null });
    actionDone = `Entrada registrada para ${workerName} a las ${timeHHMM}`;
  }

  // Recalcular horas semanales acumuladas para este empleado
  workerRecord.totalMinutes = calculateTotalMinutesForWorker(workerRecord);
  workerRecord.formattedTotal = formatDuration(workerRecord.totalMinutes);

  // Recalcular horas globales de toda la plantilla para esta semana
  let grandTotal = 0;
  Object.values(currentWeekRecord.workers).forEach((w) => {
    grandTotal += w.totalMinutes || 0;
  });
  currentWeekRecord.grandTotalMinutes = grandTotal;
  currentWeekRecord.grandTotalFormatted = formatDuration(grandTotal);
  currentWeekRecord.updatedAt = new Date().toISOString();

  // Guardar en Firestore o LocalStorage
  if (isUsingFirebase()) {
    const db = getFirestoreDb();
    const weekRef = db
      .collection('restaurants')
      .doc(restaurantId)
      .collection('weekly_records')
      .doc(weekId);

    await weekRef.set(currentWeekRecord, { merge: true });
  } else {
    const all = getLocalRestaurants();
    const rest = all[restaurantId];
    if (rest) {
      if (!rest.weeklyRecords) rest.weeklyRecords = {};
      rest.weeklyRecords[weekId] = currentWeekRecord;
      saveLocalRestaurants(all);
    }
  }

  return actionDone;
}

// 8. Obtener Lista de Todas las Semanas Guardadas (para el selector de historial)
async function dbGetHistoricalWeeksList(restaurantId) {
  if (isUsingFirebase()) {
    const db = getFirestoreDb();
    const snap = await db
      .collection('restaurants')
      .doc(restaurantId)
      .collection('weekly_records')
      .get();

    const list = [];
    snap.forEach((doc) => {
      const data = doc.data();
      list.push({
        weekId: doc.id,
        weekRange: data.weekRange || doc.id,
        grandTotalFormatted: data.grandTotalFormatted || '0h 00m'
      });
    });
    // Ordenar descendente (las más recientes primero)
    list.sort((a, b) => b.weekId.localeCompare(a.weekId));
    return list;
  } else {
    const all = getLocalRestaurants();
    const rest = all[restaurantId];
    if (!rest || !rest.weeklyRecords) return [];

    const list = Object.keys(rest.weeklyRecords).map((wId) => {
      const rec = rest.weeklyRecords[wId];
      return {
        weekId: wId,
        weekRange: rec.weekRange || wId,
        grandTotalFormatted: rec.grandTotalFormatted || '0h 00m'
      };
    });
    list.sort((a, b) => b.weekId.localeCompare(a.weekId));
    return list;
  }
}

// 9. Actualizar PIN del Administrador
async function dbUpdateAdminPin(restaurantId, newPin) {
  if (isUsingFirebase()) {
    const db = getFirestoreDb();
    await db.collection('restaurants').doc(restaurantId).update({ adminPin: newPin });
  } else {
    const all = getLocalRestaurants();
    if (all[restaurantId]) {
      all[restaurantId].adminPin = newPin;
      saveLocalRestaurants(all);
    }
  }
}

// 10. Auto-migración transparente a Firebase si existían datos locales previos
async function autoMigrateRestaurantToFirestore(restKey, localRest) {
  try {
    const db = getFirestoreDb();
    if (!db) return;
    const restRef = db.collection('restaurants').doc(restKey);

    await restRef.set(
      {
        id: restKey,
        name: localRest.name,
        nameLower: (localRest.name || restKey).toLowerCase(),
        password: localRest.password,
        adminPin: localRest.adminPin || null,
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
      },
      { merge: true }
    );

    // Subir trabajadores
    if (localRest.workers && Array.isArray(localRest.workers)) {
      for (const w of localRest.workers) {
        await restRef.collection('workers').doc(String(w.id)).set(
          {
            ...w,
            active: true
          },
          { merge: true }
        );
      }
    }

    // Subir registros de semanas históricas
    if (localRest.weeklyRecords) {
      for (const wId of Object.keys(localRest.weeklyRecords)) {
        const wRec = localRest.weeklyRecords[wId];
        await restRef.collection('weekly_records').doc(wId).set(wRec, { merge: true });
      }
    }

    console.log(`✅ Restaurante "${localRest.name}" sincronizado con Firebase Firestore.`);
  } catch (err) {
    console.warn('Advertencia al auto-migrar restaurante a Firebase:', err);
  }
}

// 11. Eliminar permanentemente el registro de una semana histórica de la base de datos
async function dbDeleteHistoricalWeek(restaurantId, weekId) {
  if (isUsingFirebase()) {
    const db = getFirestoreDb();
    await db
      .collection('restaurants')
      .doc(restaurantId)
      .collection('weekly_records')
      .doc(weekId)
      .delete();
  }

  // Eliminar también del almacenamiento local
  const all = getLocalRestaurants();
  if (all[restaurantId] && all[restaurantId].weeklyRecords) {
    delete all[restaurantId].weeklyRecords[weekId];
    saveLocalRestaurants(all);
  }
}

// 12. Borrar las horas registradas de un empleado en una semana concreta de la base de datos
async function dbClearWorkerWeekHours(restaurantId, weekId, workerId) {
  const shiftsByDay = {};
  DAYS_OF_WEEK.forEach((d) => (shiftsByDay[d] = []));

  if (isUsingFirebase()) {
    const db = getFirestoreDb();
    const weekRef = db
      .collection('restaurants')
      .doc(restaurantId)
      .collection('weekly_records')
      .doc(weekId);

    const snap = await weekRef.get();
    if (snap.exists) {
      const data = snap.data();
      if (data.workers && data.workers[workerId]) {
        data.workers[workerId].shifts = shiftsByDay;
        data.workers[workerId].totalMinutes = 0;
        data.workers[workerId].formattedTotal = '0h 00m';

        // Recalcular gran total de la semana
        let grandTotal = 0;
        Object.values(data.workers).forEach((w) => {
          grandTotal += w.totalMinutes || 0;
        });
        data.grandTotalMinutes = grandTotal;
        data.grandTotalFormatted = formatDuration(grandTotal);
        data.updatedAt = new Date().toISOString();

        await weekRef.set(data, { merge: true });
        return data;
      }
    }
  }

  // Actualizar copia local
  const all = getLocalRestaurants();
  if (all[restaurantId] && all[restaurantId].weeklyRecords && all[restaurantId].weeklyRecords[weekId]) {
    const wRec = all[restaurantId].weeklyRecords[weekId];
    if (wRec.workers && wRec.workers[workerId]) {
      wRec.workers[workerId].shifts = shiftsByDay;
      wRec.workers[workerId].totalMinutes = 0;
      wRec.workers[workerId].formattedTotal = '0h 00m';

      let grandTotal = 0;
      Object.values(wRec.workers).forEach((w) => {
        grandTotal += w.totalMinutes || 0;
      });
      wRec.grandTotalMinutes = grandTotal;
      wRec.grandTotalFormatted = formatDuration(grandTotal);
      saveLocalRestaurants(all);
      return wRec;
    }
  }
  return null;
}

// =============================================================================
// 3. LISTENERS EN TIEMPO REAL (SINCRONIZACIÓN AUTOMÁTICA EN FIRESTORE)
// =============================================================================

function setupFirestoreListeners(restaurantId) {
  teardownFirestoreListeners();

  if (!isUsingFirebase()) return;
  const db = getFirestoreDb();

  // 1. Escuchar lista de trabajadores
  unsubscribeWorkers = db
    .collection('restaurants')
    .doc(restaurantId)
    .collection('workers')
    .where('active', '==', true)
    .onSnapshot(
      (snapshot) => {
        const updated = [];
        snapshot.forEach((doc) => updated.push({ ...doc.data(), id: doc.data().id || doc.id }));
        currentWorkers = deduplicateWorkers(updated);
        renderTerminalWorkers();
        if (!document.getElementById('admin-section').classList.contains('hidden')) {
          renderWeeklyTable();
        }
      },
      (err) => console.warn('Error escuchando trabajadores:', err)
    );

  // 2. Escuchar la semana actual (para actualizar al instante el estado del terminal)
  const currentMonday = getMondayOfDate(new Date());
  const currentWeekId = getWeekId(currentMonday);

  unsubscribeCurrentWeek = db
    .collection('restaurants')
    .doc(restaurantId)
    .collection('weekly_records')
    .doc(currentWeekId)
    .onSnapshot(
      (doc) => {
        if (doc.exists) {
          currentWeekRecord = doc.data();
          renderTerminalWorkers();
          if (
            selectedWeekMonday &&
            isSameDate(selectedWeekMonday, currentMonday) &&
            !document.getElementById('admin-section').classList.contains('hidden')
          ) {
            selectedWeekRecord = currentWeekRecord;
            renderWeeklyTable();
          }
        }
      },
      (err) => console.warn('Error escuchando semana actual:', err)
    );

  // 3. Estación de Impresión (PC)
  if (isPrintStation()) {
    startPrintStationService(restaurantId);
  }

  // 4. Escuchar estado de conexión de la estación de impresión (para móviles)
  listenPrintStationStatus(restaurantId);
}

function teardownFirestoreListeners() {
  if (unsubscribeWorkers) {
    unsubscribeWorkers();
    unsubscribeWorkers = null;
  }
  if (unsubscribeCurrentWeek) {
    unsubscribeCurrentWeek();
    unsubscribeCurrentWeek = null;
  }
  if (unsubscribeSelectedWeek) {
    unsubscribeSelectedWeek();
    unsubscribeSelectedWeek = null;
  }
  stopPrintStationService();
  if (unsubscribeStationStatus) {
    unsubscribeStationStatus();
    unsubscribeStationStatus = null;
  }
}

// =============================================================================
// 4. INICIALIZACIÓN DE LA APLICACIÓN
// =============================================================================

document.addEventListener('DOMContentLoaded', async () => {
  startLiveClock();

  // Restaurar sesión activa si existe y no ha expirado (1 mes de validez)
  const savedSession = localStorage.getItem(SESSION_KEY);
  if (savedSession) {
    try {
      const parsed = JSON.parse(savedSession);
      const now = Date.now();

      // Comprobar expiración tras 1 mes (30 días)
      if (parsed.loginTimestamp && (now - parsed.loginTimestamp > SESSION_EXPIRATION_MS)) {
        console.info('Sesión caducada tras 1 mes de inactividad.');
        localStorage.removeItem(SESSION_KEY);
        showToast('Tu sesión ha expirado tras 1 mes. Por favor, inicia sesión de nuevo.');
        return;
      }

      // Si no tenía timestamp previo, inicializarlo con la fecha actual
      if (!parsed.loginTimestamp) {
        parsed.loginTimestamp = now;
        localStorage.setItem(SESSION_KEY, JSON.stringify(parsed));
      }

      if (parsed && parsed.id) {
        await restoreSession(parsed);
      }
    } catch (e) {
      console.warn('Error restaurando sesión:', e);
      localStorage.removeItem(SESSION_KEY);
    }
  }
});

async function restoreSession(sessionObj) {
  try {
    activeRestaurant = sessionObj;

    // Sincronizar datos frescos desde Firestore si está disponible
    if (isUsingFirebase()) {
      const db = getFirestoreDb();
      if (db) {
        try {
          const docSnap = await db.collection('restaurants').doc(activeRestaurant.id).get();
          if (docSnap.exists) {
            activeRestaurant = { ...activeRestaurant, ...docSnap.data(), id: docSnap.id };
            saveActiveSession(activeRestaurant, false);
          } else {
            const allLocal = getLocalRestaurants();
            if (allLocal[activeRestaurant.id]) {
              await autoMigrateRestaurantToFirestore(activeRestaurant.id, allLocal[activeRestaurant.id]);
            }
          }
        } catch (dbErr) {
          console.warn('Sincronización inicial con Firestore:', dbErr);
        }
      }
    }

    currentWorkers = await dbLoadWorkers(activeRestaurant.id);
    const currentMonday = getMondayOfDate(new Date());
    currentWeekRecord = await dbGetOrCreateWeekRecord(activeRestaurant.id, currentMonday, currentWorkers);

    openAppView(activeRestaurant);
    setupFirestoreListeners(activeRestaurant.id);
  } catch (err) {
    console.warn('No se pudo restaurar sesión activa:', err);
    localStorage.removeItem(SESSION_KEY);
  }
}

// =============================================================================
// 5. AUTENTICACIÓN (REGISTRO E INICIO DE SESIÓN)
// =============================================================================

function switchAuthTab(tab) {
  const isLogin = tab === 'login';
  document.getElementById('tab-login').classList.toggle('active', isLogin);
  document.getElementById('tab-register').classList.toggle('active', !isLogin);
  document.getElementById('login-form').classList.toggle('hidden', !isLogin);
  document.getElementById('register-form').classList.toggle('hidden', isLogin);
  document.getElementById('login-error').classList.add('hidden');
  document.getElementById('register-error').classList.add('hidden');
}

async function handleRegister(e) {
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

  try {
    errorEl.classList.add('hidden');
    const submitBtn = e.target.querySelector('button[type="submit"]');
    submitBtn.disabled = true;
    submitBtn.textContent = 'Registrando empresa...';

    const restaurant = await dbRegisterRestaurant(name, pass);
    activeRestaurant = restaurant;
    currentWorkers = await dbLoadWorkers(activeRestaurant.id);
    const currentMonday = getMondayOfDate(new Date());
    currentWeekRecord = await dbGetOrCreateWeekRecord(activeRestaurant.id, currentMonday, currentWorkers);

    // Guardar sesión activa con vigencia de 1 mes
    saveActiveSession(activeRestaurant, true);
    openAppView(activeRestaurant);
    setupFirestoreListeners(activeRestaurant.id);

    showToast(`Empresa "${name}" registrada con éxito.`);
  } catch (err) {
    errorEl.textContent = err.message || 'Error al registrar el restaurante.';
    errorEl.classList.remove('hidden');
  } finally {
    const submitBtn = e.target.querySelector('button[type="submit"]');
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Registrar y Abrir Local';
    }
  }
}

async function handleLogin(e) {
  e.preventDefault();
  const name = document.getElementById('login-name').value.trim();
  const pass = document.getElementById('login-password').value;
  const errorEl = document.getElementById('login-error');

  try {
    errorEl.classList.add('hidden');
    const submitBtn = e.target.querySelector('button[type="submit"]');
    submitBtn.disabled = true;
    submitBtn.textContent = 'Iniciando sesión...';

    const restaurant = await dbLoginRestaurant(name, pass);
    activeRestaurant = restaurant;
    currentWorkers = await dbLoadWorkers(activeRestaurant.id);
    const currentMonday = getMondayOfDate(new Date());
    currentWeekRecord = await dbGetOrCreateWeekRecord(activeRestaurant.id, currentMonday, currentWorkers);

    // Guardar sesión activa con vigencia de 1 mes
    saveActiveSession(activeRestaurant, true);
    openAppView(activeRestaurant);
    setupFirestoreListeners(activeRestaurant.id);

    showToast(`Bienvenido al terminal de ${activeRestaurant.name}`);
  } catch (err) {
    errorEl.textContent = err.message || 'Error al iniciar sesión.';
    errorEl.classList.remove('hidden');
  } finally {
    const submitBtn = e.target.querySelector('button[type="submit"]');
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Entrar al Terminal';
    }
  }
}

function logoutRestaurant() {
  teardownFirestoreListeners();
  localStorage.removeItem(SESSION_KEY);
  activeRestaurant = null;
  currentWorkers = [];
  currentWeekRecord = null;
  selectedWeekRecord = null;

  document.getElementById('app-view').classList.add('hidden');
  document.getElementById('auth-view').classList.remove('hidden');
  document.getElementById('login-password').value = '';
}

function openAppView(restaurant) {
  document.getElementById('auth-view').classList.add('hidden');
  document.getElementById('app-view').classList.remove('hidden');
  document.getElementById('header-restaurant-name').textContent = restaurant.name;
  document.getElementById('print-restaurant-title').textContent = restaurant.name;
  showTerminalView();
}

// =============================================================================
// 6. NAVEGACIÓN ENTRE TERMINAL Y CONTROL SEMANAL
// =============================================================================

function showTerminalView() {
  document.getElementById('terminal-section').classList.remove('hidden');
  document.getElementById('admin-section').classList.add('hidden');
  document.getElementById('nav-terminal').classList.add('active');
  document.getElementById('nav-admin').classList.remove('active');
  renderTerminalWorkers();
}

async function showAdminView() {
  document.getElementById('terminal-section').classList.add('hidden');
  document.getElementById('admin-section').classList.remove('hidden');
  document.getElementById('nav-terminal').classList.remove('active');
  document.getElementById('nav-admin').classList.add('active');

  // Inicializar semana seleccionada a la semana actual
  if (!selectedWeekMonday) {
    selectedWeekMonday = getMondayOfDate(new Date());
  }

  await loadAndRenderSelectedWeek();
  await refreshHistoricalWeeksDropdown();
}

// =============================================================================
// 7. TERMINAL DE FICHAJE Y TARJETAS DEL PERSONAL
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

  // Asegurar que la lista en memoria no tenga duplicados
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

// =============================================================================
// 8. MODAL DE CONFIRMACIÓN DE FICHAJE
// =============================================================================

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

// =============================================================================
// 9. GESTIÓN DEL PIN ADMIN (PROTECCIÓN DE CONTROL SEMANAL)
// =============================================================================

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

  if (!activeRestaurant.adminPin) {
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
    if (pin === activeRestaurant.adminPin) {
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

// =============================================================================
// 10. CONTROL SEMANAL: NAVEGADOR DE SEMANAS E HISTORIAL PERMANENTE
// =============================================================================

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

  // Actualizar títulos e insignias
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

  // El botón de borrar la semana de la base de datos solo se muestra en semanas pasadas
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

  // Cargar registro de la semana desde Firebase
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

// Borra las horas de un empleado específico en la semana seleccionada en la base de datos
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

// =============================================================================
// 11. CÁLCULO DE HORAS Y RENDERIZADO DEL CUADRANTE SEMANAL
// =============================================================================

function parseMinutes(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

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

function formatDuration(totalMinutes) {
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return `${h}h ${String(m).padStart(2, '0')}m`;
}

function renderWeeklyTable() {
  const tbody = document.getElementById('weekly-table-body');
  if (!tbody) return;
  tbody.innerHTML = '';

  const weekRec = selectedWeekRecord || currentWeekRecord;
  if (!weekRec || !weekRec.workers) return;

  const currentMonday = getMondayOfDate(new Date());
  const isPastWeek = selectedWeekMonday ? selectedWeekMonday < currentMonday : false;

  let grandTotalMinutes = 0;

  // Mostramos todos los trabajadores activos + cualquier trabajador que haya registrado horas en esta semana
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

  // Actualizar el resumen global de horas acumuladas de la semana
  const hoursSummaryEl = document.getElementById('week-hours-summary-num');
  if (hoursSummaryEl) {
    hoursSummaryEl.textContent = formatDuration(grandTotalMinutes);
  }
}

// =============================================================================
// 12. GESTIÓN DE TRABAJADORES (AÑADIR Y ELIMINAR)
// =============================================================================

async function handleAddWorker(e) {
  e.preventDefault();
  const nameInput = document.getElementById('worker-name');
  const roleSelect = document.getElementById('worker-role');

  const name = nameInput.value.trim();
  const role = roleSelect.value;
  if (!name || !activeRestaurant) return;

  // Evitar añadir trabajadores duplicados con el mismo nombre y puesto
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

// =============================================================================
// 13. MODAL Y CONFIGURACIÓN DE FIREBASE
// =============================================================================

// =============================================================================
// 14. NOTIFICACIONES FLOTANTES (TOAST)
// =============================================================================

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

// =============================================================================
// 15. AJUSTES DEL RESTAURANTE / LOCAL (CAMBIAR NOMBRE Y SEGURIDAD)
// =============================================================================

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
}

function closeSettingsModal() {
  const modal = document.getElementById('settings-modal');
  if (modal) modal.classList.add('hidden');
}

async function handleSaveSettings(e) {
  e.preventDefault();
  if (!activeRestaurant) return;

  const nameInput = document.getElementById('settings-rest-name');
  const pinInput = document.getElementById('settings-admin-pin');
  const stationCheckbox = document.getElementById('settings-is-print-station');

  const newName = nameInput.value.trim();
  const newPin = pinInput.value.trim();

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

  // Guardar cambios en Firestore o LocalStorage
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

  // Actualizar sesión activa manteniendo expiración
  saveActiveSession(activeRestaurant, false);

  // Actualizar DOM en la cabecera y en el informe imprimible
  const headerNameEl = document.getElementById('header-restaurant-name');
  const printTitleEl = document.getElementById('print-restaurant-title');
  if (headerNameEl) headerNameEl.textContent = newName;
  if (printTitleEl) printTitleEl.textContent = newName;

  closeSettingsModal();
  showToast(`Ajustes guardados. Nombre cambiado a "${newName}".`);
}

// Sincronizar siempre el nombre del restaurante antes de imprimir
window.addEventListener('beforeprint', () => {
  if (activeRestaurant) {
    const printTitle = document.getElementById('print-restaurant-title');
    if (printTitle) printTitle.textContent = activeRestaurant.name;
  }
});

// =============================================================================
// 16. SISTEMA DE IMPRESIÓN REMOTA (MÓVIL A PC) Y ESTACIÓN DE IMPRESIÓN
// =============================================================================

// Comprueba si este dispositivo actúa como Estación Receptora de Impresión
function isPrintStation() {
  const stored = localStorage.getItem(PRINT_STATION_STORAGE_KEY);
  if (stored !== null) {
    return stored === 'true';
  }
  // Auto-detección: En pantallas de ordenador (>= 900px y sin pantalla táctil exclusiva), activo por defecto
  const isDesktop = window.innerWidth >= 900 && !('ontouchstart' in window);
  return isDesktop;
}

// Activa o desactiva este dispositivo como estación de impresión
function setPrintStationEnabled(enabled) {
  localStorage.setItem(PRINT_STATION_STORAGE_KEY, enabled ? 'true' : 'false');
  if (activeRestaurant) {
    if (enabled) {
      startPrintStationService(activeRestaurant.id);
      showToast('🖥️ Este dispositivo está activo como Estación Receptora de Impresión.');
    } else {
      stopPrintStationService();
      showToast('Modo estación receptora desactivado en este dispositivo.');
    }
  }
}

// Inicia el servicio en segundo plano en el PC para recibir órdenes de impresión del móvil
function startPrintStationService(restaurantId) {
  stopPrintStationService();
  if (!isUsingFirebase()) return;
  const db = getFirestoreDb();

  // 1. Heartbeat de presencia: los móviles sabrán que este PC está encendido y con la app abierta
  const stationRef = db
    .collection('restaurants')
    .doc(restaurantId)
    .collection('meta')
    .doc('print_station');

  const pulseHeartbeat = async () => {
    try {
      await stationRef.set({
        online: true,
        lastSeen: Date.now(),
        stationName: 'PC de Local / Impresora',
        platform: navigator.platform || 'Desktop'
      }, { merge: true });
    } catch (e) {
      console.warn('Heartbeat de estación de impresión:', e);
    }
  };

  pulseHeartbeat();
  stationHeartbeatInterval = setInterval(pulseHeartbeat, 25000);

  // Al cerrar la pestaña o el navegador, avisar que está desconectado
  window.addEventListener('beforeunload', () => {
    try {
      stationRef.set({ online: false, lastSeen: Date.now() }, { merge: true });
    } catch (_) {}
  });

  // 2. Escuchar la cola de trabajos de impresión pendientes en Firestore
  const startupThreshold = Date.now() - 300000; // Descartar órdenes de más de 5 minutos
  unsubscribePrintJobs = db
    .collection('restaurants')
    .doc(restaurantId)
    .collection('print_jobs')
    .where('status', '==', 'pending')
    .onSnapshot(async (snapshot) => {
      for (const doc of snapshot.docs) {
        const job = doc.data();

        // Si la orden ya es muy vieja, descartarla
        if (job.requestedAtMs && job.requestedAtMs < startupThreshold) {
          doc.ref.update({ status: 'expired' }).catch(() => {});
          continue;
        }

        // Reclamar inmediatamente la orden para evitar duplicidades
        try {
          await doc.ref.update({
            status: 'processing',
            pickedUpAt: Date.now(),
            processor: 'PC'
          });

          await executeRemotePrintJob(job.weekId, job.weekRangeText);

          await doc.ref.update({
            status: 'completed',
            completedAt: Date.now()
          });
        } catch (err) {
          console.error('Error al procesar orden de impresión remota:', err);
          doc.ref.update({ status: 'error', errorMessage: String(err) }).catch(() => {});
        }
      }
    }, (err) => console.warn('Error escuchando cola de impresión:', err));
}

// Detiene el servicio de estación de impresión
function stopPrintStationService() {
  if (stationHeartbeatInterval) {
    clearInterval(stationHeartbeatInterval);
    stationHeartbeatInterval = null;
  }
  if (unsubscribePrintJobs) {
    unsubscribePrintJobs();
    unsubscribePrintJobs = null;
  }
  if (isUsingFirebase() && activeRestaurant) {
    try {
      const db = getFirestoreDb();
      db.collection('restaurants')
        .doc(activeRestaurant.id)
        .collection('meta')
        .doc('print_station')
        .set({ online: false, lastSeen: Date.now() }, { merge: true })
        .catch(() => {});
    } catch (_) {}
  }
}

// Escucha en tiempo real el estado del PC para informar en el móvil
function listenPrintStationStatus(restaurantId) {
  if (unsubscribeStationStatus) {
    unsubscribeStationStatus();
    unsubscribeStationStatus = null;
  }
  if (!isUsingFirebase()) return;

  const db = getFirestoreDb();
  unsubscribeStationStatus = db
    .collection('restaurants')
    .doc(restaurantId)
    .collection('meta')
    .doc('print_station')
    .onSnapshot((doc) => {
      if (doc.exists) {
        const data = doc.data();
        const now = Date.now();
        isPcStationOnline = Boolean(data.online && data.lastSeen && (now - data.lastSeen < 75000));
      } else {
        isPcStationOnline = false;
      }
      updatePcStatusInModal();
    }, (err) => console.warn('Error escuchando presencia de estación PC:', err));
}

// Ejecuta la orden en el PC: carga la semana solicitada, renderiza la tabla y llama a window.print()
async function executeRemotePrintJob(weekId, weekRangeText) {
  if (!activeRestaurant) return;

  showToast(`🖨️ Petición recibida desde el móvil: ${weekRangeText || weekId}. Imprimiendo...`);

  let mondayDate;
  if (weekId) {
    const parts = weekId.split('-');
    if (parts.length === 3) {
      mondayDate = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
    }
  }
  if (!mondayDate) {
    mondayDate = getMondayOfDate(new Date());
  }

  // Cargar registro de la semana solicitada
  const weekRec = await dbGetOrCreateWeekRecord(activeRestaurant.id, mondayDate, currentWorkers);

  // Guardar estado previo para no perturbar lo que el usuario esté viendo en pantalla
  const prevMonday = selectedWeekMonday;
  const prevRecord = selectedWeekRecord;

  // Cargar datos en la zona imprimible
  selectedWeekMonday = mondayDate;
  selectedWeekRecord = weekRec;

  const rangeText = getWeekRangeText(mondayDate);
  const printRangeEl = document.getElementById('print-week-range');
  const printTitleEl = document.getElementById('print-restaurant-title');
  if (printRangeEl) printRangeEl.textContent = rangeText;
  if (printTitleEl) printTitleEl.textContent = activeRestaurant.name;

  // Renderizar la tabla con las horas de esa semana
  renderWeeklyTable();

  // Pequeña pausa para asegurar renderizado en el DOM
  await new Promise((res) => setTimeout(res, 350));

  try {
    window.focus();
    window.print();
  } catch (err) {
    console.warn('Aviso en ejecución de impresión remota:', err);
  }

  // Si el usuario en el PC estaba viendo otra semana en pantalla, restaurarla
  if (prevMonday && !isSameDate(prevMonday, mondayDate)) {
    selectedWeekMonday = prevMonday;
    selectedWeekRecord = prevRecord;
    const prevRange = getWeekRangeText(prevMonday);
    if (printRangeEl) printRangeEl.textContent = prevRange;
    renderWeeklyTable();
  }
}

// Abre el modal de impresión con selector de semana y estado del PC
async function openPrintModal(weekMonday = null) {
  if (!activeRestaurant) return;
  const modal = document.getElementById('print-modal');
  if (!modal) return;

  const currentMonday = getMondayOfDate(new Date());
  printModalTargetMonday = weekMonday || selectedWeekMonday || currentMonday;

  updatePrintModalUI();
  modal.classList.remove('hidden');

  await populatePrintModalWeeksSelector();
}

function closePrintModal() {
  const modal = document.getElementById('print-modal');
  if (modal) modal.classList.add('hidden');
}

function updatePrintModalUI() {
  const rangeEl = document.getElementById('print-modal-range');
  if (rangeEl && printModalTargetMonday) {
    rangeEl.textContent = getWeekRangeText(printModalTargetMonday);
  }
  updatePcStatusInModal();
}

function updatePcStatusInModal() {
  const dotEl = document.getElementById('pc-status-dot');
  const titleEl = document.getElementById('pc-status-title');
  const descEl = document.getElementById('pc-status-desc');
  if (!dotEl || !titleEl || !descEl) return;

  if (isPcStationOnline) {
    dotEl.className = 'status-indicator-dot dot-online';
    titleEl.textContent = '🟢 PC del local Conectado y Listo';
    descEl.textContent = 'La aplicación está abierta en el ordenador. Listo para sacar las hojas.';
  } else {
    dotEl.className = 'status-indicator-dot dot-offline';
    titleEl.textContent = '🟡 PC del local no detectado';
    descEl.textContent = 'Abre la app en el PC del local. Si envías la orden ahora, se imprimirá en cuanto se abra.';
  }
}

async function populatePrintModalWeeksSelector() {
  const selectEl = document.getElementById('print-modal-week-select');
  if (!selectEl || !activeRestaurant) return;

  selectEl.innerHTML = '<option value="">Cargando semanas...</option>';

  const currentMonday = getMondayOfDate(new Date());
  const currentWeekId = getWeekId(currentMonday);
  const currentRangeText = getWeekRangeText(currentMonday);

  const historicalList = await dbGetHistoricalWeeksList(activeRestaurant.id);

  selectEl.innerHTML = '';

  // 1. Semana actual
  const currOption = document.createElement('option');
  currOption.value = currentWeekId;
  currOption.textContent = `● Semana actual en curso (${currentRangeText})`;
  selectEl.appendChild(currOption);

  // 2. Semanas históricas
  historicalList.forEach((item) => {
    if (item.weekId !== currentWeekId) {
      const opt = document.createElement('option');
      opt.value = item.weekId;
      opt.textContent = `${item.weekRange} (Total: ${item.grandTotalFormatted || '0h'})`;
      selectEl.appendChild(opt);
    }
  });

  const targetId = getWeekId(printModalTargetMonday);
  selectEl.value = targetId;
}

function handlePrintModalWeekChange(val) {
  if (!val) return;
  const parts = val.split('-');
  if (parts.length === 3) {
    printModalTargetMonday = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
    updatePrintModalUI();
  }
}

// Acción al pulsar "Imprimir en PC" desde la barra superior
function handleTopbarPrintClick() {
  if (!activeRestaurant) return;
  const adminSection = document.getElementById('admin-section');
  const isAdminVisible = adminSection && !adminSection.classList.contains('hidden');

  if (isAdminVisible) {
    openPrintModal();
  } else {
    // Si la pantalla de administración está bloqueada con PIN, pedirlo antes para proteger datos
    if (activeRestaurant.adminPin) {
      pendingActionAfterPin = 'openPrintModal';
      requestAdminAccess();
    } else {
      openPrintModal();
    }
  }
}

// Acción del botón "Mandar a la Impresora del PC" dentro del modal
async function executeRemotePrintFromModal() {
  const targetMonday = printModalTargetMonday || selectedWeekMonday || getMondayOfDate(new Date());
  closePrintModal();
  await requestRemotePrint(targetMonday);
}

// Acción del botón "Imprimir o PDF en este dispositivo" dentro del modal
async function executeLocalPrintFromModal() {
  const targetMonday = printModalTargetMonday || selectedWeekMonday || getMondayOfDate(new Date());
  closePrintModal();

  if (!selectedWeekMonday || !isSameDate(selectedWeekMonday, targetMonday)) {
    selectedWeekMonday = targetMonday;
    await loadAndRenderSelectedWeek();
  }

  const printTitle = document.getElementById('print-restaurant-title');
  if (printTitle && activeRestaurant) {
    printTitle.textContent = activeRestaurant.name;
  }

  window.print();
}

// Envía una orden de impresión a la cola de Firebase Firestore
async function requestRemotePrint(mondayDate) {
  if (!activeRestaurant) return;
  const targetMonday = mondayDate || selectedWeekMonday || getMondayOfDate(new Date());
  const weekId = getWeekId(targetMonday);
  const weekRangeText = getWeekRangeText(targetMonday);

  if (!isUsingFirebase()) {
    showToast('⚠️ Base de datos en la nube no conectada. Abriendo impresión en este equipo...');
    window.print();
    return;
  }

  showToast(`📤 Enviando orden de impresión de "${weekRangeText}" al PC...`);

  try {
    const db = getFirestoreDb();
    const docRef = await db
      .collection('restaurants')
      .doc(activeRestaurant.id)
      .collection('print_jobs')
      .add({
        weekId: weekId,
        weekRangeText: weekRangeText,
        status: 'pending',
        requestedAt: firebase.firestore.FieldValue.serverTimestamp(),
        requestedAtMs: Date.now(),
        requestedBy: /Mobi|Android/i.test(navigator.userAgent) ? 'Móvil' : 'Web'
      });

    // Escuchar el progreso del trabajo de impresión en tiempo real
    let finished = false;
    const unsub = docRef.onSnapshot((doc) => {
      if (!doc.exists) return;
      const data = doc.data();
      if (data.status === 'processing') {
        showToast(`🖨️ ¡Orden recibida por el PC! Enviando a la impresora...`);
      } else if (data.status === 'completed') {
        finished = true;
        showToast(`🎉 ¡Impresión completada con éxito en el PC! (${weekRangeText})`);
        unsub();
      }
    });

    // Cancelar escucha de cortesía tras 35 segundos
    setTimeout(() => {
      if (!finished) unsub();
    }, 35000);

  } catch (error) {
    console.error('Error enviando trabajo de impresión:', error);
    showToast('❌ Error al enviar la orden al PC. Verifica tu conexión.');
  }
}

// =============================================================================
// 17. PREVENCIÓN DE ZOOM Y LUPA EN IOS / IPHONE (SAFARI & PWA STANDALONE)
// =============================================================================
(function initIosZoomPrevention() {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;

  // Prevenir zoom por doble toque rápido en iOS Safari
  let lastTouchEndTime = 0;
  document.addEventListener('touchend', (e) => {
    const now = Date.now();
    if (now - lastTouchEndTime <= 300) {
      const targetTag = (e.target && e.target.tagName) ? e.target.tagName.toUpperCase() : '';
      if (targetTag !== 'INPUT' && targetTag !== 'TEXTAREA') {
        e.preventDefault();
      }
    }
    lastTouchEndTime = now;
  }, { passive: false });

  // Prevenir gestos multitáctiles de pellizco (zoom)
  document.addEventListener('gesturestart', (e) => e.preventDefault());
  document.addEventListener('gesturechange', (e) => e.preventDefault());
  document.addEventListener('gestureend', (e) => e.preventDefault());

  // Prevenir doble click estándar que invoca lupa
  document.addEventListener('dblclick', (e) => {
    const targetTag = (e.target && e.target.tagName) ? e.target.tagName.toUpperCase() : '';
    if (targetTag !== 'INPUT' && targetTag !== 'TEXTAREA') {
      e.preventDefault();
    }
  }, { passive: false });
})();



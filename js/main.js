// =============================================================================
// GASTROTIME - ORQUESTACIÓN PRINCIPAL, VISTAS Y LISTENERS EN TIEMPO REAL
// =============================================================================

/**
 * Muestra la vista del Terminal de Fichaje y oculta el Panel de Control.
 */
function showTerminalView() {
  document.getElementById('terminal-section').classList.remove('hidden');
  document.getElementById('admin-section').classList.add('hidden');
  document.getElementById('nav-terminal').classList.add('active');
  document.getElementById('nav-admin').classList.remove('active');
  renderTerminalWorkers();
}

/**
 * Muestra el Panel de Control Semanal y oculta el Terminal de Fichaje.
 */
async function showAdminView() {
  document.getElementById('terminal-section').classList.add('hidden');
  document.getElementById('admin-section').classList.remove('hidden');
  document.getElementById('nav-terminal').classList.remove('active');
  document.getElementById('nav-admin').classList.add('active');

  // Inicializar semana seleccionada a la semana actual si no está definida
  if (!selectedWeekMonday) {
    selectedWeekMonday = getMondayOfDate(new Date());
  }

  await loadAndRenderSelectedWeek();
  await refreshHistoricalWeeksDropdown();
}

/**
 * Configura los observadores en tiempo real (onSnapshot) de Firestore.
 * Sincroniza al instante trabajadores, fichajes semanales y estación de impresión.
 * @param {string} restaurantId 
 */
function setupFirestoreListeners(restaurantId) {
  teardownFirestoreListeners();

  if (!isUsingFirebase()) return;
  const db = getFirestoreDb();

  // 1. Escuchar lista de trabajadores activos
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

/**
 * Cancela todas las suscripciones activas a Firestore para evitar fugas de memoria.
 */
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

/**
 * Inicialización de la aplicación al cargar el DOM.
 */
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

/**
 * Restaura la sesión del restaurante, cargando datos de Firestore o LocalStorage.
 * @param {Object} sessionObj 
 */
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

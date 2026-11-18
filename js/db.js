// =============================================================================
// GASTROTIME - CAPA DE DATOS (FIREBASE FIRESTORE CON FALLBACK A LOCALSTORAGE)
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

    const all = getLocalRestaurants();
    all[docSnap.id] = { ...all[docSnap.id], ...data, id: docSnap.id };
    saveLocalRestaurants(all);

    return { ...data, id: docSnap.id };
  } else {
    const all = getLocalRestaurants();
    const restData = all[restKey];
    if (!restData || restData.password !== password) {
      throw new Error('Nombre de restaurante o contraseña incorrectos.');
    }
    return { ...restData, id: restKey };
  }
}

// 3. Cargar Trabajadores del Restaurante (con deduplicación)
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
        duplicateIdsToDeactivate.push(doc.id);
      } else {
        seenKeys.set(normKey, doc.id);
        seenKeys.set(String(worker.id), doc.id);
        workers.push(worker);
      }
    });

    if (duplicateIdsToDeactivate.length > 0) {
      duplicateIdsToDeactivate.forEach((dupId) => {
        db.collection('restaurants')
          .doc(restaurantId)
          .collection('workers')
          .doc(dupId)
          .update({ active: false })
          .catch((e) => console.warn('Error desactivando duplicado:', e));
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

// 5. Eliminar Trabajador (definitiva y permanentemente)
async function dbDeleteWorker(restaurantId, workerId) {
  if (isUsingFirebase()) {
    const db = getFirestoreDb();
    const restRef = db.collection('restaurants').doc(restaurantId);

    // 1. Eliminar permanentemente de la subcolección de trabajadores
    try {
      await restRef.collection('workers').doc(String(workerId)).delete();
    } catch (e) {
      console.warn('Error borrando documento del trabajador en workers:', e);
    }

    // 2. Eliminar al trabajador de los registros semanales actuales
    try {
      const currentMonday = getMondayOfDate(new Date());
      const currentWeekId = getWeekId(currentMonday);
      const weekRef = restRef.collection('weekly_records').doc(currentWeekId);
      const snap = await weekRef.get();
      if (snap.exists) {
        await weekRef.update({
          [`workers.${workerId}`]: firebase.firestore.FieldValue.delete()
        });
      }

      // Si hay una semana seleccionada diferente a la actual
      if (typeof selectedWeekMonday !== 'undefined' && selectedWeekMonday) {
        const selWeekId = getWeekId(selectedWeekMonday);
        if (selWeekId !== currentWeekId) {
          const selRef = restRef.collection('weekly_records').doc(selWeekId);
          const selSnap = await selRef.get();
          if (selSnap.exists) {
            await selRef.update({
              [`workers.${workerId}`]: firebase.firestore.FieldValue.delete()
            });
          }
        }
      }
    } catch (weekErr) {
      console.warn('Error eliminando trabajador del registro semanal:', weekErr);
    }
  } else {
    const all = getLocalRestaurants();
    const rest = all[restaurantId];
    if (!rest) return;
    rest.workers = (rest.workers || []).filter((w) => String(w.id) !== String(workerId));

    if (rest.weeklyRecords) {
      Object.keys(rest.weeklyRecords).forEach((wId) => {
        if (rest.weeklyRecords[wId].workers) {
          delete rest.weeklyRecords[wId].workers[workerId];
          delete rest.weeklyRecords[wId].workers[String(workerId)];
        }
      });
    }
    saveLocalRestaurants(all);
  }
}

// 5B. Actualizar PIN personal del Trabajador
async function dbUpdateWorkerPin(restaurantId, workerId, newPin) {
  if (isUsingFirebase()) {
    const db = getFirestoreDb();
    await db
      .collection('restaurants')
      .doc(restaurantId)
      .collection('workers')
      .doc(String(workerId))
      .update({ pin: String(newPin).trim() });
  } else {
    const all = getLocalRestaurants();
    const rest = all[restaurantId];
    if (rest && rest.workers) {
      const w = rest.workers.find((x) => String(x.id) === String(workerId));
      if (w) w.pin = String(newPin).trim();
      saveLocalRestaurants(all);
    }
  }
}

// 6. Cargar o Inicializar Registro Semanal
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

// 7. Guardar o Actualizar Fichaje (Entrada / Salida) y Calcular Horas Semanales
async function dbSavePunch(restaurantId, workerId, timeHHMM) {
  const currentMonday = getMondayOfDate(new Date());
  const today = getTodayName();
  const weekId = getWeekId(currentMonday);

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
    lastShift.out = timeHHMM;
    actionDone = `Salida registrada para ${workerName} a las ${timeHHMM}`;
  } else {
    todayShifts.push({ in: timeHHMM, out: null });
    actionDone = `Entrada registrada para ${workerName} a las ${timeHHMM}`;
  }

  workerRecord.totalMinutes = calculateTotalMinutesForWorker(workerRecord);
  workerRecord.formattedTotal = formatDuration(workerRecord.totalMinutes);

  let grandTotal = 0;
  Object.values(currentWeekRecord.workers).forEach((w) => {
    grandTotal += w.totalMinutes || 0;
  });
  currentWeekRecord.grandTotalMinutes = grandTotal;
  currentWeekRecord.grandTotalFormatted = formatDuration(grandTotal);
  currentWeekRecord.updatedAt = new Date().toISOString();

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

// 8. Obtener Lista de Todas las Semanas Guardadas
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

    if (localRest.weeklyRecords) {
      for (const wId of Object.keys(localRest.weeklyRecords)) {
        const wRec = localRest.weeklyRecords[wId];
        await restRef.collection('weekly_records').doc(wId).set(wRec, { merge: true });
      }
    }

    console.log(`✅ Restaurante "${localRest.name}" sincronizado con Firebase.`);
  } catch (err) {
    console.warn('Aviso en migración a Firebase:', err);
  }
}

// 11. Eliminar permanentemente una semana histórica
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

  const all = getLocalRestaurants();
  if (all[restaurantId] && all[restaurantId].weeklyRecords) {
    delete all[restaurantId].weeklyRecords[weekId];
    saveLocalRestaurants(all);
  }
}

// 12. Borrar las horas registradas de un empleado en una semana concreta
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

// 13. Borrar todas las horas del cuadrante de una semana completa
async function dbClearAllWeekHours(restaurantId, weekId) {
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
      if (data.workers) {
        Object.keys(data.workers).forEach((wId) => {
          data.workers[wId].shifts = shiftsByDay;
          data.workers[wId].totalMinutes = 0;
          data.workers[wId].formattedTotal = '0h 00m';
        });
      }
      data.grandTotalMinutes = 0;
      data.grandTotalFormatted = '0h 00m';
      data.updatedAt = new Date().toISOString();

      await weekRef.set(data, { merge: true });
      return data;
    }
  }

  const all = getLocalRestaurants();
  if (all[restaurantId] && all[restaurantId].weeklyRecords && all[restaurantId].weeklyRecords[weekId]) {
    const wRec = all[restaurantId].weeklyRecords[weekId];
    if (wRec.workers) {
      Object.keys(wRec.workers).forEach((wId) => {
        wRec.workers[wId].shifts = shiftsByDay;
        wRec.workers[wId].totalMinutes = 0;
        wRec.workers[wId].formattedTotal = '0h 00m';
      });
    }
    wRec.grandTotalMinutes = 0;
    wRec.grandTotalFormatted = '0h 00m';
    saveLocalRestaurants(all);
    return wRec;
  }
  return null;
}

// 14. Obtener Cuadrante Diario de Zonas
async function dbGetDailyZones(restaurantId, dateKey) {
  if (isUsingFirebase()) {
    const db = getFirestoreDb();
    const doc = await db
      .collection('restaurants')
      .doc(restaurantId)
      .collection('daily_zones')
      .doc(dateKey)
      .get();
    if (doc.exists) return doc.data();
  }

  const all = getLocalRestaurants();
  const rest = all[restaurantId];
  if (rest && rest.dailyZones && rest.dailyZones[dateKey]) {
    return rest.dailyZones[dateKey];
  }
  return null;
}

// 15. Guardar Cuadrante Diario de Zonas
async function dbSaveDailyZones(restaurantId, dateKey, data) {
  if (isUsingFirebase()) {
    const db = getFirestoreDb();
    await db
      .collection('restaurants')
      .doc(restaurantId)
      .collection('daily_zones')
      .doc(dateKey)
      .set(
        {
          ...data,
          updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        },
        { merge: true }
      );
  }

  const all = getLocalRestaurants();
  const rest = all[restaurantId];
  if (rest) {
    if (!rest.dailyZones) rest.dailyZones = {};
    rest.dailyZones[dateKey] = data;
    saveLocalRestaurants(all);
  }
}

// 16. Obtener Plantilla Predeterminada de Cuadrante de Zonas
async function dbGetDefaultZones(restaurantId) {
  if (isUsingFirebase()) {
    const db = getFirestoreDb();
    const doc = await db
      .collection('restaurants')
      .doc(restaurantId)
      .collection('settings')
      .doc('default_zones')
      .get();
    if (doc.exists) return doc.data();
  }

  const all = getLocalRestaurants();
  const rest = all[restaurantId];
  if (rest && rest.defaultZones) {
    return rest.defaultZones;
  }
  return null;
}

// 17. Guardar Plantilla Predeterminada de Cuadrante de Zonas
async function dbSaveDefaultZones(restaurantId, data) {
  if (isUsingFirebase()) {
    const db = getFirestoreDb();
    await db
      .collection('restaurants')
      .doc(restaurantId)
      .collection('settings')
      .doc('default_zones')
      .set(
        {
          ...data,
          updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        },
        { merge: true }
      );
  }

  const all = getLocalRestaurants();
  const rest = all[restaurantId];
  if (rest) {
    rest.defaultZones = data;
    saveLocalRestaurants(all);
  }
}

// 18. Obtener Lista de Plantillas con Nombre para Cuadrante de Zonas
async function dbGetNamedTemplates(restaurantId) {
  if (isUsingFirebase()) {
    const db = getFirestoreDb();
    const snap = await db
      .collection('restaurants')
      .doc(restaurantId)
      .collection('named_templates')
      .get();
    const list = [];
    snap.forEach((doc) => {
      list.push({ id: doc.id, ...doc.data() });
    });
    list.sort((a, b) => (a.name || a.id).localeCompare(b.name || b.id));
    return list;
  }

  const all = getLocalRestaurants();
  const rest = all[restaurantId];
  if (rest && rest.namedTemplates) {
    const list = Object.keys(rest.namedTemplates).map((k) => rest.namedTemplates[k]);
    list.sort((a, b) => (a.name || a.id).localeCompare(b.name || b.id));
    return list;
  }
  return [];
}

// 19. Guardar Plantilla con Nombre
async function dbSaveNamedTemplate(restaurantId, templateName, templateData) {
  const normKey = templateName.trim();
  const docData = {
    id: normKey,
    name: normKey,
    ...templateData,
    updatedAt: new Date().toISOString()
  };

  if (isUsingFirebase()) {
    const db = getFirestoreDb();
    await db
      .collection('restaurants')
      .doc(restaurantId)
      .collection('named_templates')
      .doc(normKey)
      .set(docData, { merge: true });
  }

  const all = getLocalRestaurants();
  const rest = all[restaurantId];
  if (rest) {
    if (!rest.namedTemplates) rest.namedTemplates = {};
    rest.namedTemplates[normKey] = docData;
    saveLocalRestaurants(all);
  }
  return docData;
}

// 20. Eliminar Plantilla con Nombre
async function dbDeleteNamedTemplate(restaurantId, templateName) {
  const normKey = templateName.trim();
  if (isUsingFirebase()) {
    const db = getFirestoreDb();
    await db
      .collection('restaurants')
      .doc(restaurantId)
      .collection('named_templates')
      .doc(normKey)
      .delete();
  }

  const all = getLocalRestaurants();
  const rest = all[restaurantId];
  if (rest && rest.namedTemplates) {
    delete rest.namedTemplates[normKey];
    saveLocalRestaurants(all);
  }
}

// =============================================================================
// GASTROTIME - SISTEMA DE IMPRESIÓN REMOTA (MÓVIL A PC) Y ESTACIÓN DE IMPRESIÓN
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
      await stationRef.set(
        {
          online: true,
          lastSeen: Date.now(),
          stationName: 'PC de Local / Impresora',
          platform: navigator.platform || 'Desktop'
        },
        { merge: true }
      );
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
    .onSnapshot(
      async (snapshot) => {
        for (const doc of snapshot.docs) {
          const job = doc.data();

          if (job.requestedAtMs && job.requestedAtMs < startupThreshold) {
            doc.ref.update({ status: 'expired' }).catch(() => {});
            continue;
          }

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
      },
      (err) => console.warn('Error escuchando cola de impresión:', err)
    );
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
    .onSnapshot(
      (doc) => {
        if (doc.exists) {
          const data = doc.data();
          const now = Date.now();
          isPcStationOnline = Boolean(data.online && data.lastSeen && now - data.lastSeen < 75000);
        } else {
          isPcStationOnline = false;
        }
        updatePcStatusInModal();
      },
      (err) => console.warn('Error escuchando presencia de estación PC:', err)
    );
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

  const weekRec = await dbGetOrCreateWeekRecord(activeRestaurant.id, mondayDate, currentWorkers);

  const prevMonday = selectedWeekMonday;
  const prevRecord = selectedWeekRecord;

  selectedWeekMonday = mondayDate;
  selectedWeekRecord = weekRec;

  const rangeText = getWeekRangeText(mondayDate);
  const printRangeEl = document.getElementById('print-week-range');
  const printTitleEl = document.getElementById('print-restaurant-title');
  if (printRangeEl) printRangeEl.textContent = rangeText;
  if (printTitleEl) printTitleEl.textContent = activeRestaurant.name;

  renderWeeklyTable();

  await new Promise((res) => setTimeout(res, 350));

  try {
    window.focus();
    window.print();
  } catch (err) {
    console.warn('Aviso en ejecución de impresión remota:', err);
  }

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
  lockBodyScroll();

  await populatePrintModalWeeksSelector();
}

function closePrintModal() {
  const modal = document.getElementById('print-modal');
  if (modal) modal.classList.add('hidden');
  unlockBodyScroll();
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

  const currOption = document.createElement('option');
  currOption.value = currentWeekId;
  currOption.textContent = `● Semana actual en curso (${currentRangeText})`;
  selectEl.appendChild(currOption);

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

    setTimeout(() => {
      if (!finished) unsub();
    }, 35000);
  } catch (error) {
    console.error('Error enviando trabajo de impresión:', error);
    showToast('❌ Error al enviar la orden al PC. Verifica tu conexión.');
  }
}

// Sincronizar siempre el nombre del restaurante antes de imprimir
window.addEventListener('beforeprint', () => {
  if (activeRestaurant) {
    const printTitle = document.getElementById('print-restaurant-title');
    if (printTitle) printTitle.textContent = activeRestaurant.name;
  }
});

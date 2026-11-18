// =============================================================================
// GASTROTIME - CUADRANTE DIARIO DE ZONAS, TURNOS Y EXPORTACIÓN A WHATSAPP (PDF)
// =============================================================================

// Estructura de las 3 Zonas del restaurante
const ZONES_CONFIG = [
  {
    id: 'terraza',
    name: 'Zona Terraza',
    icon: '🌿',
    positions: [
      { id: 'terraza', name: 'Terraza (Mesa)' },
      { id: 'barraTerraza', name: 'Barra Terraza' }
    ]
  },
  {
    id: 'salon',
    name: 'Zona Salón',
    icon: '🍽️',
    positions: [
      { id: 'salon', name: 'Salón (Mesa)' },
      { id: 'barraSalon', name: 'Barra Salón' }
    ]
  },
  {
    id: 'calle',
    name: 'Zona Calle',
    icon: '🚶‍♂️',
    positions: [
      { id: 'calle', name: 'Calle' }
    ]
  }
];

// Presets de horarios habituales de hostelería
const TIME_PRESETS_MEDIODIA = ['12:00 a 18:00', '13:00 a 17:00', '12:30 a 17:30', '11:30 a 16:30'];
const TIME_PRESETS_NOCHE = ['20:00 a 00:30', '20:30 a 01:00', '19:30 a 00:00', '21:00 a 01:30'];

let selectedZonesDate = new Date();
let activeZonesShift = 'mediodia'; // 'mediodia' | 'noche' | 'preview'
let currentZonesData = null;

// Inicializa o devuelve una estructura vacía para la fecha
function createEmptyZonesData(dateStr) {
  return {
    date: dateStr,
    mediodia: {
      terraza: [],
      barraTerraza: [],
      salon: [],
      barraSalon: [],
      calle: []
    },
    noche: {
      terraza: [],
      barraTerraza: [],
      salon: [],
      barraSalon: [],
      calle: []
    }
  };
}

// Formatea fecha a YYYY-MM-DD
function formatZonesDateKey(d) {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

// Formatea fecha legible en español (ej: "Miércoles, 18 de Noviembre de 2026")
function formatZonesDateTitle(d) {
  const days = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
  const months = [
    'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
    'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'
  ];
  return `${days[d.getDay()]}, ${d.getDate()} de ${months[d.getMonth()]} de ${d.getFullYear()}`;
}

// Abre el modal de cuadrante de zonas
async function openZonesModal() {
  const modal = document.getElementById('zones-modal');
  if (!modal) return;

  const dateInput = document.getElementById('zones-date-input');
  if (dateInput) {
    dateInput.value = formatZonesDateKey(selectedZonesDate);
  }

  modal.classList.remove('hidden');
  lockBodyScroll();

  await loadZonesForCurrentDate();
}

function closeZonesModal() {
  const modal = document.getElementById('zones-modal');
  if (modal) modal.classList.add('hidden');
  unlockBodyScroll();
}

// Navegación de días en el cuadrante de zonas
async function navigateZonesDate(delta) {
  selectedZonesDate.setDate(selectedZonesDate.getDate() + delta);
  const dateInput = document.getElementById('zones-date-input');
  if (dateInput) {
    dateInput.value = formatZonesDateKey(selectedZonesDate);
  }
  await loadZonesForCurrentDate();
}

async function handleZonesDateChange(val) {
  if (!val) return;
  const parts = val.split('-');
  if (parts.length === 3) {
    selectedZonesDate = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
    await loadZonesForCurrentDate();
  }
}

async function goToZonesToday() {
  selectedZonesDate = new Date();
  const dateInput = document.getElementById('zones-date-input');
  if (dateInput) {
    dateInput.value = formatZonesDateKey(selectedZonesDate);
  }
  await loadZonesForCurrentDate();
}

// Cambia de pestaña interna (Mediodía / Noche / Vista Previa)
function switchZonesShift(shift) {
  activeZonesShift = shift;

  const btnMediodia = document.getElementById('tab-zones-mediodia');
  const btnNoche = document.getElementById('tab-zones-noche');
  const btnPreview = document.getElementById('tab-zones-preview');

  if (btnMediodia) btnMediodia.classList.toggle('active', shift === 'mediodia');
  if (btnNoche) btnNoche.classList.toggle('active', shift === 'noche');
  if (btnPreview) btnPreview.classList.toggle('active', shift === 'preview');

  const editorContainer = document.getElementById('zones-editor-container');
  const previewContainer = document.getElementById('zones-preview-wrapper');

  if (shift === 'preview') {
    if (editorContainer) editorContainer.classList.add('hidden');
    if (previewContainer) previewContainer.classList.remove('hidden');
    renderZonesPreviewSheet();
  } else {
    if (editorContainer) editorContainer.classList.remove('hidden');
    if (previewContainer) previewContainer.classList.add('hidden');
    renderZonesEditor();
  }
}

// Carga los datos de la fecha desde Firestore / LocalStorage
async function loadZonesForCurrentDate() {
  if (!activeRestaurant) return;
  const dateKey = formatZonesDateKey(selectedZonesDate);
  const titleEl = document.getElementById('zones-display-date');
  if (titleEl) {
    titleEl.textContent = formatZonesDateTitle(selectedZonesDate);
  }

  try {
    currentZonesData = await dbGetDailyZones(activeRestaurant.id, dateKey);
    if (!currentZonesData) {
      currentZonesData = createEmptyZonesData(dateKey);
    }
  } catch (err) {
    console.warn('Error al cargar cuadrante de zonas:', err);
    currentZonesData = createEmptyZonesData(dateKey);
  }

  if (activeZonesShift === 'preview') {
    renderZonesPreviewSheet();
  } else {
    renderZonesEditor();
  }
}

// Renderiza el editor interactivo de puestos
function renderZonesEditor() {
  const container = document.getElementById('zones-editor-container');
  if (!container || !currentZonesData) return;

  const shiftData = currentZonesData[activeZonesShift] || {};
  const isMediodia = activeZonesShift === 'mediodia';
  const defaultHours = isMediodia ? 'De 12:00 a 18:00' : 'De 20:00 a 00:30';
  const presets = isMediodia ? TIME_PRESETS_MEDIODIA : TIME_PRESETS_NOCHE;

  let html = `
    <div class="zones-shift-banner ${isMediodia ? 'shift-mediodia' : 'shift-noche'}">
      <div class="shift-banner-title">
        <span>${isMediodia ? '☀️' : '🌙'}</span>
        <strong>Turno de ${isMediodia ? 'Mediodía (Comida)' : 'Noche (Cena)'}</strong>
      </div>
      <p class="shift-banner-desc">
        Asigna el personal que cubrirá Terraza, Salón y Calle para este turno.
      </p>
    </div>
    <div class="zones-grid-layout">
  `;

  ZONES_CONFIG.forEach((zone) => {
    html += `
      <div class="zone-column-card">
        <div class="zone-card-header">
          <span class="zone-header-icon">${zone.icon}</span>
          <div class="zone-header-info">
            <h4>${zone.name}</h4>
            <small>${zone.positions.length > 1 ? 'Mesa y Barra' : 'Exterior'}</small>
          </div>
        </div>
        <div class="zone-positions-list">
    `;

    zone.positions.forEach((pos) => {
      const list = shiftData[pos.id] || [];

      html += `
        <div class="position-block">
          <div class="position-header">
            <span class="position-title">${pos.name}</span>
            <button type="button" class="btn-add-worker-pos" onclick="handleAddWorkerToZone('${activeZonesShift}', '${pos.id}')" title="Añadir trabajador a ${pos.name}">
              + Asignar Camarero/a
            </button>
          </div>
          <div class="position-workers-list">
      `;

      if (list.length === 0) {
        html += `
          <div class="empty-pos-slot">
            <span>Sin personal asignado</span>
          </div>
        `;
      } else {
        list.forEach((worker, index) => {
          html += `
            <div class="worker-assignment-row">
              <div class="worker-select-wrap">
                <select class="input-worker-select" onchange="handleUpdateWorkerAssignment('${activeZonesShift}', '${pos.id}', ${index}, 'name', this.value)">
                  <option value="">-- Elige trabajador --</option>
                  ${(currentWorkers || []).map((w) => `<option value="${w.name}" ${worker.name === w.name ? 'selected' : ''}>${w.name} (${w.role})</option>`).join('')}
                  <option value="__custom__" ${worker.isCustom ? 'selected' : ''}>+ Escribir otro nombre...</option>
                </select>
                ${worker.isCustom ? `
                  <input type="text" class="input-worker-custom" placeholder="Nombre del trabajador/extra" value="${worker.name || ''}" onchange="handleUpdateWorkerAssignment('${activeZonesShift}', '${pos.id}', ${index}, 'customName', this.value)">
                ` : ''}
              </div>
              <div class="worker-hours-wrap">
                <input type="text" class="input-worker-hours" placeholder="${defaultHours}" value="${worker.hours || ''}" onchange="handleUpdateWorkerAssignment('${activeZonesShift}', '${pos.id}', ${index}, 'hours', this.value)">
                <div class="quick-presets-chips">
                  ${presets.map((p) => `
                    <button type="button" class="preset-chip" onclick="handleApplyTimePreset('${activeZonesShift}', '${pos.id}', ${index}, '${p}')">${p.replace('De ', '')}</button>
                  `).join('')}
                </div>
              </div>
              <button type="button" class="btn-remove-assignment" onclick="handleRemoveWorkerFromZone('${activeZonesShift}', '${pos.id}', ${index})" title="Quitar asignación">
                ✕
              </button>
            </div>
          `;
        });
      }

      html += `
          </div>
        </div>
      `;
    });

    html += `
        </div>
      </div>
    `;
  });

  html += `</div>`;
  container.innerHTML = html;
}

// Añade un nuevo slot de trabajador a una posición
async function handleAddWorkerToZone(shift, posId) {
  if (!currentZonesData || !currentZonesData[shift]) return;
  if (!currentZonesData[shift][posId]) {
    currentZonesData[shift][posId] = [];
  }

  const defaultHours = shift === 'mediodia' ? 'De 12:00 a 18:00' : 'De 20:00 a 00:30';

  // Si hay trabajadores no asignados aún en este turno, sugerir el primero
  const assignedInShift = new Set();
  Object.values(currentZonesData[shift]).forEach((arr) => {
    (arr || []).forEach((item) => {
      if (item && item.name) assignedInShift.add(item.name.trim().toLowerCase());
    });
  });

  const availableWorker = (currentWorkers || []).find((w) => !assignedInShift.has(w.name.trim().toLowerCase()));
  const initialName = availableWorker ? availableWorker.name : ((currentWorkers && currentWorkers[0]) ? currentWorkers[0].name : '');

  currentZonesData[shift][posId].push({
    name: initialName,
    hours: defaultHours,
    isCustom: false
  });

  renderZonesEditor();
  await autoSaveCurrentZonesData();
}

// Modifica la asignación de un trabajador
async function handleUpdateWorkerAssignment(shift, posId, index, field, value) {
  if (!currentZonesData || !currentZonesData[shift] || !currentZonesData[shift][posId]) return;
  const item = currentZonesData[shift][posId][index];
  if (!item) return;

  if (field === 'name') {
    if (value === '__custom__') {
      item.isCustom = true;
      item.name = '';
    } else {
      item.isCustom = false;
      item.name = value;
    }
  } else if (field === 'customName') {
    item.name = value.trim();
  } else if (field === 'hours') {
    item.hours = value.trim();
  }

  renderZonesEditor();
  await autoSaveCurrentZonesData();
}

// Aplica preset rápido de hora
async function handleApplyTimePreset(shift, posId, index, preset) {
  if (!currentZonesData || !currentZonesData[shift] || !currentZonesData[shift][posId]) return;
  const item = currentZonesData[shift][posId][index];
  if (!item) return;

  item.hours = preset;
  renderZonesEditor();
  await autoSaveCurrentZonesData();
}

// Quita un trabajador de la posición
async function handleRemoveWorkerFromZone(shift, posId, index) {
  if (!currentZonesData || !currentZonesData[shift] || !currentZonesData[shift][posId]) return;
  currentZonesData[shift][posId].splice(index, 1);
  renderZonesEditor();
  await autoSaveCurrentZonesData();
}

// Guardado automático del cuadrante del día
async function autoSaveCurrentZonesData() {
  if (!activeRestaurant || !currentZonesData) return;
  try {
    const dateKey = formatZonesDateKey(selectedZonesDate);
    await dbSaveDailyZones(activeRestaurant.id, dateKey, currentZonesData);
  } catch (err) {
    console.warn('Error guardando cuadrante:', err);
  }
}

// Guarda la configuración actual como plantilla predeterminada
async function handleSaveAsDefaultZones() {
  if (!activeRestaurant || !currentZonesData) return;

  const confirmed = confirm(
    '¿Deseas guardar la distribución y horarios actuales como TU PLANTILLA PREDETERMINADA?\n\nPodrás cargarla en cualquier día con un solo clic.'
  );
  if (!confirmed) return;

  try {
    await dbSaveDefaultZones(activeRestaurant.id, currentZonesData);
    showToast('Plantilla predeterminada guardada correctamente.');
  } catch (err) {
    console.error('Error guardando plantilla predeterminada:', err);
    showToast('Error al guardar plantilla: ' + err.message);
  }
}

// Carga la plantilla predeterminada en el día actual
async function handleLoadDefaultZones() {
  if (!activeRestaurant) return;

  const confirmed = confirm(
    '¿Deseas cargar la plantilla predeterminada en este día?\n\nEsto rellenará los puestos y horarios con tu cuadrante habitual.'
  );
  if (!confirmed) return;

  try {
    const defaultData = await dbGetDefaultZones(activeRestaurant.id);
    if (!defaultData) {
      alert('Aún no has guardado ninguna plantilla predeterminada. Configura un día y pulsa "💾 Guardar como Predeterminado".');
      return;
    }

    const dateKey = formatZonesDateKey(selectedZonesDate);
    currentZonesData = JSON.parse(JSON.stringify(defaultData));
    currentZonesData.date = dateKey;

    await autoSaveCurrentZonesData();
    switchZonesShift(activeZonesShift);
    showToast('Plantilla predeterminada cargada con éxito.');
  } catch (err) {
    console.error('Error cargando plantilla predeterminada:', err);
    showToast('Error al cargar plantilla: ' + err.message);
  }
}

// =============================================================================
// RENDERIZADO DEL CUADRANTE MINIMALISTA (ESTILO EXACTO A LA FOTO, ELEGANTE)
// =============================================================================

function renderZonesPreviewSheet() {
  const container = document.getElementById('zones-printable-sheet');
  if (!container || !currentZonesData) return;

  const restName = activeRestaurant ? activeRestaurant.name : 'Restaurante';
  const dateStr = formatZonesDateTitle(selectedZonesDate);

  const med = currentZonesData.mediodia || {};
  const noc = currentZonesData.noche || {};

  // Formato similar al boceto original pero con diseño limpio y minimalista
  container.innerHTML = `
    <div class="minimal-sheet-container">
      <div class="minimal-sheet-header">
        <div class="minimal-header-left">
          <div class="minimal-brand-tag">GASTROTIME • CUADRANTE DE ZONAS</div>
          <h2 class="minimal-rest-title">${restName}</h2>
          <p class="minimal-date-subtitle">${dateStr}</p>
        </div>
        <div class="minimal-header-legend">
          <span class="legend-badge">🌿 Terraza & Barra</span>
          <span class="legend-badge">🍽️ Salón & Barra</span>
          <span class="legend-badge">🚶‍♂️ Calle</span>
        </div>
      </div>

      <!-- TURNO MEDIODÍA -->
      <div class="minimal-shift-block">
        <div class="minimal-shift-heading">
          <span class="shift-icon-dot sun-dot"></span>
          <h3>TURNO MEDIO DÍA</h3>
          <span class="shift-time-tag">Comidas</span>
        </div>
        ${buildMinimalShiftTableHtml(med)}
      </div>

      <!-- TURNO NOCHE -->
      <div class="minimal-shift-block">
        <div class="minimal-shift-heading">
          <span class="shift-icon-dot moon-dot"></span>
          <h3>TURNO NOCHE</h3>
          <span class="shift-time-tag">Cenas</span>
        </div>
        ${buildMinimalShiftTableHtml(noc)}
      </div>

      <div class="minimal-sheet-footer">
        <span>GastroTime Control Horario • Cuadrante generado el ${new Date().toLocaleDateString('es-ES')} a las ${new Date().toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}</span>
      </div>
    </div>
  `;
}

// Construye la tabla minimalista de 3 columnas (Terraza, Salón, Calle) similar al boceto
function buildMinimalShiftTableHtml(shiftObj) {
  const tMesa = shiftObj.terraza || [];
  const tBarra = shiftObj.barraTerraza || [];
  const sMesa = shiftObj.salon || [];
  const sBarra = shiftObj.barraSalon || [];
  const calle = shiftObj.calle || [];

  return `
    <div class="minimal-zones-table">
      <!-- Fila Superior: Terraza (Mesa), Salón (Mesa) y Calle -->
      <div class="minimal-table-row">
        <!-- Columna 1: Terraza -->
        <div class="minimal-col col-terraza">
          <div class="col-head">
            <span class="pos-name">Terraza</span>
            <span class="pos-sub">Hora</span>
          </div>
          <div class="col-body">
            ${renderWorkersLinesHtml(tMesa)}
          </div>
        </div>

        <!-- Columna 2: Salón -->
        <div class="minimal-col col-salon">
          <div class="col-head">
            <span class="pos-name">Salón</span>
            <span class="pos-sub">Hora</span>
          </div>
          <div class="col-body">
            ${renderWorkersLinesHtml(sMesa)}
          </div>
        </div>

        <!-- Columna 3: Calle (Abarca lateralmente) -->
        <div class="minimal-col col-calle">
          <div class="col-head col-head-calle">
            <span class="pos-name">Calle</span>
            <span class="pos-sub">Hora</span>
          </div>
          <div class="col-body col-body-calle">
            ${renderWorkersLinesHtml(calle)}
          </div>
        </div>
      </div>

      <!-- Fila Inferior: Barra Terraza y Barra Salón -->
      <div class="minimal-table-row row-barras">
        <div class="minimal-col col-terraza col-barra">
          <div class="col-head">
            <span class="pos-name">Barra Terraza</span>
            <span class="pos-sub">Hora</span>
          </div>
          <div class="col-body">
            ${renderWorkersLinesHtml(tBarra)}
          </div>
        </div>

        <div class="minimal-col col-salon col-barra">
          <div class="col-head">
            <span class="pos-name">Barra Salón</span>
            <span class="pos-sub">Hora</span>
          </div>
          <div class="col-body">
            ${renderWorkersLinesHtml(sBarra)}
          </div>
        </div>
      </div>
    </div>
  `;
}

function renderWorkersLinesHtml(workersList) {
  if (!workersList || workersList.length === 0) {
    return `<div class="empty-line">—</div>`;
  }
  return workersList
    .map((w) => `
      <div class="worker-line">
        <strong class="worker-line-name">${w.name || 'Sin asignar'}</strong>
        <span class="worker-line-hours">${w.hours || 'Horario a concretar'}</span>
      </div>
    `)
    .join('');
}

// Genera texto resumen para WhatsApp
function generateWhatsappText() {
  if (!currentZonesData) return '';
  const restName = activeRestaurant ? activeRestaurant.name : 'Restaurante';
  const dateStr = formatZonesDateTitle(selectedZonesDate);

  let text = `📋 *CUADRANTE DE PUESTOS Y TURNOS*\n`;
  text += `🏨 *${restName}*\n`;
  text += `📅 ${dateStr}\n\n`;

  const formatList = (arr) => {
    if (!arr || arr.length === 0) return '  _(Sin asignar)_';
    return arr.map((w) => `  • *${w.name}*: ${w.hours}`).join('\n');
  };

  // Mediodía
  text += `☀️ *--- TURNO MEDIO DÍA ---*\n`;
  text += `🌿 *Terraza:*\n${formatList(currentZonesData.mediodia.terraza)}\n`;
  text += `🍹 *Barra Terraza:*\n${formatList(currentZonesData.mediodia.barraTerraza)}\n`;
  text += `🍽️ *Salón:*\n${formatList(currentZonesData.mediodia.salon)}\n`;
  text += `🍸 *Barra Salón:*\n${formatList(currentZonesData.mediodia.barraSalon)}\n`;
  text += `🚶‍♂️ *Calle:*\n${formatList(currentZonesData.mediodia.calle)}\n\n`;

  // Noche
  text += `🌙 *--- TURNO NOCHE ---*\n`;
  text += `🌿 *Terraza:*\n${formatList(currentZonesData.noche.terraza)}\n`;
  text += `🍹 *Barra Terraza:*\n${formatList(currentZonesData.noche.barraTerraza)}\n`;
  text += `🍽️ *Salón:*\n${formatList(currentZonesData.noche.salon)}\n`;
  text += `🍸 *Barra Salón:*\n${formatList(currentZonesData.noche.barraSalon)}\n`;
  text += `🚶‍♂️ *Calle:*\n${formatList(currentZonesData.noche.calle)}\n\n`;

  text += `_Generado con GastroTime_`;
  return text;
}

// =============================================================================
// EXPORTACIÓN A PDF Y ENVÍO A WHATSAPP
// =============================================================================

async function handleExportZonesPdfAndShare() {
  // Asegurar que la vista previa esté actualizada en el DOM
  renderZonesPreviewSheet();

  const element = document.getElementById('zones-printable-sheet');
  if (!element) return;

  const dateKey = formatZonesDateKey(selectedZonesDate);
  const restNameSlug = (activeRestaurant ? activeRestaurant.name : 'Restaurante')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '_');
  const filename = `Cuadrante_${restNameSlug}_${dateKey}.pdf`;

  const statusText = document.getElementById('zones-share-status');
  if (statusText) {
    statusText.textContent = 'Generando PDF...';
    statusText.classList.remove('hidden');
  }

  // Comprobar si html2pdf está disponible
  if (typeof html2pdf === 'undefined') {
    // Si no está disponible la librería CDN, descargar vía diálogo nativo e invocar WhatsApp
    window.print();
    const waText = encodeURIComponent(generateWhatsappText());
    window.open(`https://api.whatsapp.com/send?text=${waText}`, '_blank');
    if (statusText) statusText.classList.add('hidden');
    return;
  }

  const opt = {
    margin: [6, 6, 6, 6],
    filename: filename,
    image: { type: 'jpeg', quality: 0.98 },
    html2canvas: { scale: 2, useCORS: true, backgroundColor: '#ffffff' },
    jsPDF: { unit: 'mm', format: 'a4', orientation: 'landscape' }
  };

  try {
    const worker = html2pdf().set(opt).from(element);

    // Obtener blob del PDF
    const pdfBlob = await worker.outputPdf('blob');
    const pdfFile = new File([pdfBlob], filename, { type: 'application/pdf' });

    if (statusText) statusText.textContent = 'Abriendo WhatsApp...';

    // Comprobar si el navegador admite compartir archivos directamente a WhatsApp (móviles)
    if (navigator.canShare && navigator.canShare({ files: [pdfFile] })) {
      await navigator.share({
        files: [pdfFile],
        title: `Cuadrante de Zonas - ${formatZonesDateTitle(selectedZonesDate)}`,
        text: generateWhatsappText()
      });
      showToast('Cuadrante enviado a WhatsApp.');
    } else {
      // En PC o navegadores sin Web Share: Descargar el archivo PDF automáticamente
      const downloadUrl = URL.createObjectURL(pdfBlob);
      const a = document.createElement('a');
      a.href = downloadUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(downloadUrl);

      // Y abrir WhatsApp con el texto y aviso
      const waText = encodeURIComponent(generateWhatsappText());
      window.open(`https://api.whatsapp.com/send?text=${waText}`, '_blank');
      showToast('PDF descargado. Se ha abierto WhatsApp para enviarlo al grupo.');
    }
  } catch (err) {
    console.error('Error generando o compartiendo PDF:', err);
    // Fallback directo a WhatsApp
    const waText = encodeURIComponent(generateWhatsappText());
    window.open(`https://api.whatsapp.com/send?text=${waText}`, '_blank');
    showToast('Se ha abierto WhatsApp con el cuadrante.');
  } finally {
    if (statusText) statusText.classList.add('hidden');
  }
}

// Descarga directa del PDF
async function handleDownloadZonesPdf() {
  renderZonesPreviewSheet();
  const element = document.getElementById('zones-printable-sheet');
  if (!element) return;

  const dateKey = formatZonesDateKey(selectedZonesDate);
  const restNameSlug = (activeRestaurant ? activeRestaurant.name : 'Restaurante')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '_');
  const filename = `Cuadrante_${restNameSlug}_${dateKey}.pdf`;

  if (typeof html2pdf === 'undefined') {
    window.print();
    return;
  }

  const opt = {
    margin: [6, 6, 6, 6],
    filename: filename,
    image: { type: 'jpeg', quality: 0.98 },
    html2canvas: { scale: 2, useCORS: true, backgroundColor: '#ffffff' },
    jsPDF: { unit: 'mm', format: 'a4', orientation: 'landscape' }
  };

  try {
    await html2pdf().set(opt).from(element).save();
    showToast('PDF del cuadrante descargado.');
  } catch (err) {
    console.error('Error al descargar PDF:', err);
    window.print();
  }
}

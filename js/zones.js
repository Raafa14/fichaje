// =============================================================================
// GASTROTIME - CUADRANTE DIARIO DE ZONAS, TURNOS Y EXPORTACIÓN A WHATSAPP (PDF)
// =============================================================================

// Zonas y Puestos disponibles
const AVAILABLE_ZONES = [
  { id: 'terraza', name: 'Terraza (Mesa)', group: 'Terraza', icon: '🌿' },
  { id: 'barraTerraza', name: 'Barra Terraza', group: 'Terraza', icon: '🍹' },
  { id: 'salon', name: 'Salón (Mesa)', group: 'Salón', icon: '🍽️' },
  { id: 'barraSalon', name: 'Barra Salón', group: 'Salón', icon: '🍸' },
  { id: 'calle', name: 'Calle', group: 'Calle', icon: '🚶‍♂️' }
];

// Presets de horarios habituales
const TIME_PRESETS_SEGUIDO = [
  '12:00 a 18:00',
  '13:00 a 17:00',
  '14:00 a 00:00',
  '19:00 a 01:00',
  '20:00 a 00:30',
  '20:30 a 01:30'
];

const TIME_PRESETS_PARTIDO = {
  mediodia: ['13:00 a 16:30', '12:30 a 16:30', '13:00 a 17:00'],
  noche: ['20:00 a 00:30', '20:30 a 01:00', '19:30 a 00:00']
};

let selectedZonesDate = new Date();
let activeZonesView = 'editor'; // 'editor' | 'preview'
let currentDailyAssignments = [];
let savedNamedTemplates = [];

// Formatea fecha a YYYY-MM-DD
function formatZonesDateKey(d) {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

// Formatea fecha legible (ej: "Miércoles, 18 de Noviembre de 2026")
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

  await refreshTemplatesDropdown();
  await loadZonesForCurrentDate();
}

function closeZonesModal() {
  const modal = document.getElementById('zones-modal');
  if (!modal) return;
  modal.classList.add('hidden');
  unlockBodyScroll();
}

// Navegación de días
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

// Alterna entre la vista de edición única y la vista previa minimalista
function switchZonesMainTab(tab) {
  activeZonesView = tab;

  const btnEditor = document.getElementById('tab-zones-editor');
  const btnPreview = document.getElementById('tab-zones-preview');
  const editorPane = document.getElementById('zones-editor-pane');
  const previewPane = document.getElementById('zones-preview-wrapper');

  if (btnEditor) btnEditor.classList.toggle('active', tab === 'editor');
  if (btnPreview) btnPreview.classList.toggle('active', tab === 'preview');

  if (tab === 'preview') {
    if (editorPane) editorPane.classList.add('hidden');
    if (previewPane) previewPane.classList.remove('hidden');
    renderZonesPreviewSheet();
  } else {
    if (editorPane) editorPane.classList.remove('hidden');
    if (previewPane) previewPane.classList.add('hidden');
    renderUnifiedZonesEditor();
  }
}

// =============================================================================
// LÓGICA AUTOMÁTICA DE CLASIFICACIÓN DE TURNOS (MEDIODÍA Y NOCHE)
// =============================================================================

function classifyAssignmentToShifts(assign) {
  const result = {
    mediodia: null,
    noche: null,
    summaryBadge: ''
  };

  if (!assign || !assign.workerName) return result;

  const zone = assign.zone || 'terraza';

  if (assign.shiftType === 'partido') {
    const hMed = assign.hoursMediodia || '13:00 a 16:30';
    const hNoc = assign.hoursNoche || '20:00 a 00:30';

    result.mediodia = {
      name: assign.workerName,
      zone: zone,
      hours: hMed
    };
    result.noche = {
      name: assign.workerName,
      zone: assign.zoneNoche || zone,
      hours: hNoc
    };
    result.summaryBadge = '☀️ Medio Día y 🌙 Noche (Turno Partido)';
    return result;
  }

  // Turno Seguido: analizamos hora de inicio y fin
  const hoursStr = (assign.hours || '14:00 a 00:00').trim();
  const match = hoursStr.match(/(\d{1,2})[:.](\d{2}).*?(\d{1,2})[:.](\d{2})/);

  if (!match) {
    result.mediodia = { name: assign.workerName, zone: zone, hours: hoursStr };
    result.summaryBadge = '☀️ Medio Día';
    return result;
  }

  const startHour = parseInt(match[1], 10);
  const startMin = parseInt(match[2], 10);
  let endHour = parseInt(match[3], 10);
  const endMin = parseInt(match[4], 10);

  // Si termina de madrugada (00:00, 01:00, 02:00...), sumamos 24 horas
  const effectiveEndHour = endHour < startHour ? endHour + 24 : endHour;

  // Umbral de cambio de turno: 19:00
  if (startHour < 19) {
    result.mediodia = {
      name: assign.workerName,
      zone: zone,
      hours: hoursStr
    };

    // ¿Llega hasta la noche? (pasa de las 19:30 o 20:00, ej: 14:00 a 00:00)
    if (effectiveEndHour >= 20 || (effectiveEndHour === 19 && endMin >= 30)) {
      result.noche = {
        name: assign.workerName,
        zone: zone,
        hours: hoursStr
      };
      result.summaryBadge = '☀️ Medio Día y 🌙 Noche (Turno Seguido)';
    } else {
      result.summaryBadge = '☀️ Solo Medio Día';
    }
  } else {
    result.noche = {
      name: assign.workerName,
      zone: zone,
      hours: hoursStr
    };
    result.summaryBadge = '🌙 Solo Noche';
  }

  return result;
}

// Carga las asignaciones de la fecha seleccionada
async function loadZonesForCurrentDate() {
  if (!activeRestaurant) return;
  const dateKey = formatZonesDateKey(selectedZonesDate);
  const titleEl = document.getElementById('zones-display-date');
  if (titleEl) {
    titleEl.textContent = formatZonesDateTitle(selectedZonesDate);
  }

  try {
    const rawData = await dbGetDailyZones(activeRestaurant.id, dateKey);
    if (rawData && Array.isArray(rawData.assignments)) {
      currentDailyAssignments = rawData.assignments;
    } else if (rawData && (rawData.mediodia || rawData.noche)) {
      currentDailyAssignments = migrateOldFormatToAssignments(rawData);
    } else {
      currentDailyAssignments = createDefaultInitialAssignments();
    }
  } catch (err) {
    console.warn('Error al cargar cuadrante de zonas:', err);
    currentDailyAssignments = createDefaultInitialAssignments();
  }

  if (activeZonesView === 'preview') {
    renderZonesPreviewSheet();
  } else {
    renderUnifiedZonesEditor();
  }
}

function createDefaultInitialAssignments() {
  if (!currentWorkers || currentWorkers.length === 0) return [];
  return [
    {
      id: 'a_' + Date.now(),
      workerName: currentWorkers[0].name,
      zone: 'terraza',
      shiftType: 'seguido',
      hours: '14:00 a 00:00'
    }
  ];
}

function migrateOldFormatToAssignments(oldData) {
  const list = [];
  const addFromShift = (shiftObj) => {
    if (!shiftObj) return;
    Object.keys(shiftObj).forEach((posId) => {
      (shiftObj[posId] || []).forEach((w) => {
        if (!w || !w.name) return;
        list.push({
          id: 'a_' + Math.random().toString(36).substr(2, 9),
          workerName: w.name,
          zone: posId,
          shiftType: 'seguido',
          hours: w.hours || '12:00 a 18:00'
        });
      });
    });
  };
  addFromShift(oldData.mediodia);
  addFromShift(oldData.noche);
  return list;
}

// =============================================================================
// RENDERIZADO DEL EDITOR UNIFICADO (1 SOLO APARTADO SIMPLE Y DIRECTO)
// =============================================================================

function renderUnifiedZonesEditor() {
  const container = document.getElementById('zones-editor-pane');
  if (!container) return;

  const totalWorkers = currentDailyAssignments.length;

  let html = `
    <div class="unified-editor-header">
      <div class="editor-header-info">
        <h4>Lista de Camareros y Horarios del Día</h4>
        <p>Elige al camarero, su zona y su horario (seguido o partido). El sistema lo colocará <strong>automáticamente en Mediodía y Noche</strong>.</p>
      </div>
      <button type="button" class="btn btn-accent btn-sm" onclick="handleAddNewAssignmentRow()">
        + Añadir Camarero al Cuadrante
      </button>
    </div>

    <div class="assignments-cards-list" id="assignments-cards-list">
  `;

  if (totalWorkers === 0) {
    html += `
      <div class="empty-assignments-notice">
        <p>No hay camareros asignados en este día todavía.</p>
        <button type="button" class="btn btn-outline btn-sm" onclick="handleAddNewAssignmentRow()">
          + Añadir Primer Camarero
        </button>
      </div>
    `;
  } else {
    currentDailyAssignments.forEach((assign, index) => {
      const isPartido = assign.shiftType === 'partido';
      const classified = classifyAssignmentToShifts(assign);

      html += `
        <div class="assignment-card-item">
          <div class="assignment-card-top">
            <span class="assignment-number-badge">#${index + 1}</span>
            
            <!-- Selector de Camarero -->
            <div class="field-item worker-field">
              <label>Camarero/a:</label>
              <select class="input-select-worker" onchange="handleAssignmentChange(${index}, 'workerName', this.value)">
                <option value="">-- Seleccionar camarero --</option>
                ${(currentWorkers || []).map((w) => `<option value="${w.name}" ${assign.workerName === w.name ? 'selected' : ''}>${w.name} (${w.role})</option>`).join('')}
                <option value="__custom__" ${assign.isCustom ? 'selected' : ''}>+ Escribir otro nombre...</option>
              </select>
              ${assign.isCustom ? `
                <input type="text" class="input-worker-custom" placeholder="Nombre del trabajador/extra" value="${assign.workerName || ''}" onchange="handleAssignmentChange(${index}, 'customWorkerName', this.value)">
              ` : ''}
            </div>

            <!-- Selector de Zona (Salon, Terraza, Calle) -->
            <div class="field-item zone-field">
              <label>Zona / Puesto:</label>
              <select class="input-select-zone" onchange="handleAssignmentChange(${index}, 'zone', this.value)">
                ${AVAILABLE_ZONES.map((z) => `<option value="${z.id}" ${assign.zone === z.id ? 'selected' : ''}>${z.icon} ${z.name}</option>`).join('')}
              </select>
            </div>

            <!-- Tipo de Turno (Seguido / Partido) -->
            <div class="field-item shift-type-field">
              <label>Tipo de Turno:</label>
              <div class="shift-type-pills">
                <button type="button" class="type-pill ${!isPartido ? 'active' : ''}" onclick="handleAssignmentChange(${index}, 'shiftType', 'seguido')">
                  Turno Seguido
                </button>
                <button type="button" class="type-pill ${isPartido ? 'active' : ''}" onclick="handleAssignmentChange(${index}, 'shiftType', 'partido')">
                  Turno Partido
                </button>
              </div>
            </div>

            <!-- Botón Eliminar fila -->
            <button type="button" class="btn-remove-card" onclick="handleRemoveAssignmentRow(${index})" title="Quitar este camarero del cuadrante">
              ✕
            </button>
          </div>

          <!-- Bloque de Horarios -->
          <div class="assignment-hours-block">
      `;

      if (!isPartido) {
        html += `
          <div class="hours-row-seguido">
            <div class="hours-input-wrap">
              <label>Horario completo (ej: 14:00 a 00:00 o 12:00 a 18:00):</label>
              <input type="text" class="input-hours" placeholder="Ej: 14:00 a 00:00" value="${assign.hours || ''}" onchange="handleAssignmentChange(${index}, 'hours', this.value)">
            </div>
            <div class="hours-quick-presets">
              <span>Atajos de 1 clic:</span>
              ${TIME_PRESETS_SEGUIDO.map((p) => `
                <button type="button" class="btn-preset-chip" onclick="handleApplyHoursPreset(${index}, 'hours', '${p}')">${p}</button>
              `).join('')}
            </div>
          </div>
        `;
      } else {
        html += `
          <div class="hours-row-partido">
            <div class="partido-col">
              <label>☀️ Horario Mediodía (Comida):</label>
              <input type="text" class="input-hours" placeholder="13:00 a 16:30" value="${assign.hoursMediodia || '13:00 a 16:30'}" onchange="handleAssignmentChange(${index}, 'hoursMediodia', this.value)">
              <div class="hours-quick-presets">
                ${TIME_PRESETS_PARTIDO.mediodia.map((p) => `
                  <button type="button" class="btn-preset-chip" onclick="handleApplyHoursPreset(${index}, 'hoursMediodia', '${p}')">${p}</button>
                `).join('')}
              </div>
            </div>
            <div class="partido-col">
              <label>🌙 Horario Noche (Cena):</label>
              <input type="text" class="input-hours" placeholder="20:00 a 00:30" value="${assign.hoursNoche || '20:00 a 00:30'}" onchange="handleAssignmentChange(${index}, 'hoursNoche', this.value)">
              <div class="hours-quick-presets">
                ${TIME_PRESETS_PARTIDO.noche.map((p) => `
                  <button type="button" class="btn-preset-chip" onclick="handleApplyHoursPreset(${index}, 'hoursNoche', '${p}')">${p}</button>
                `).join('')}
              </div>
            </div>
          </div>
        `;
      }

      html += `
            <!-- Indicador automático de reparto -->
            <div class="auto-classification-tag">
              <span class="tag-icon">⚡</span>
              <span>Distribución en el cuadrante:</span>
              <strong>${classified.summaryBadge}</strong>
            </div>
          </div>
        </div>
      `;
    });
  }

  html += `
    </div>
    <div class="unified-editor-bottom">
      <button type="button" class="btn btn-outline btn-full-add" onclick="handleAddNewAssignmentRow()">
        + Añadir Otro Camarero al Cuadrante
      </button>
    </div>
  `;

  container.innerHTML = html;
}

// Añade una nueva fila al cuadrante
async function handleAddNewAssignmentRow() {
  const availableWorker = (currentWorkers || []).find(
    (w) => !currentDailyAssignments.some((a) => a.workerName === w.name)
  );
  const defaultName = availableWorker ? availableWorker.name : ((currentWorkers && currentWorkers[0]) ? currentWorkers[0].name : '');

  currentDailyAssignments.push({
    id: 'a_' + Date.now(),
    workerName: defaultName,
    zone: 'terraza',
    shiftType: 'seguido',
    hours: '14:00 a 00:00',
    hoursMediodia: '13:00 a 16:30',
    hoursNoche: '20:00 a 00:30'
  });

  renderUnifiedZonesEditor();
  await autoSaveCurrentDailyAssignments();
}

// Modifica campos de una asignación
async function handleAssignmentChange(index, field, value) {
  const item = currentDailyAssignments[index];
  if (!item) return;

  if (field === 'workerName') {
    if (value === '__custom__') {
      item.isCustom = true;
      item.workerName = '';
    } else {
      item.isCustom = false;
      item.workerName = value;
    }
  } else if (field === 'customWorkerName') {
    item.workerName = value.trim();
  } else if (field === 'zone') {
    item.zone = value;
  } else if (field === 'shiftType') {
    item.shiftType = value;
    if (value === 'partido') {
      if (!item.hoursMediodia) item.hoursMediodia = '13:00 a 16:30';
      if (!item.hoursNoche) item.hoursNoche = '20:00 a 00:30';
    } else {
      if (!item.hours) item.hours = '14:00 a 00:00';
    }
  } else if (field === 'hours') {
    item.hours = value.trim();
  } else if (field === 'hoursMediodia') {
    item.hoursMediodia = value.trim();
  } else if (field === 'hoursNoche') {
    item.hoursNoche = value.trim();
  }

  renderUnifiedZonesEditor();
  await autoSaveCurrentDailyAssignments();
}

// Aplica preset rápido de horas
async function handleApplyHoursPreset(index, field, preset) {
  const item = currentDailyAssignments[index];
  if (!item) return;
  item[field] = preset;
  renderUnifiedZonesEditor();
  await autoSaveCurrentDailyAssignments();
}

// Elimina una fila del cuadrante
async function handleRemoveAssignmentRow(index) {
  currentDailyAssignments.splice(index, 1);
  renderUnifiedZonesEditor();
  await autoSaveCurrentDailyAssignments();
}

// Guardado automático en Firebase / LocalStorage
async function autoSaveCurrentDailyAssignments() {
  if (!activeRestaurant) return;
  try {
    const dateKey = formatZonesDateKey(selectedZonesDate);
    await dbSaveDailyZones(activeRestaurant.id, dateKey, {
      date: dateKey,
      assignments: currentDailyAssignments
    });
  } catch (err) {
    console.warn('Error al autoguardar cuadrante:', err);
  }
}

// =============================================================================
// GESTIÓN DE PLANTILLAS CON NOMBRE (GUARDAR Y CARGAR POR NOMBRE)
// =============================================================================

// Refresca el desplegable de plantillas guardadas con su nombre
async function refreshTemplatesDropdown() {
  if (!activeRestaurant) return;
  const select = document.getElementById('zones-named-template-select');
  if (!select) return;

  try {
    savedNamedTemplates = await dbGetNamedTemplates(activeRestaurant.id);
    select.innerHTML = '<option value="">-- Elige una plantilla guardada --</option>';

    savedNamedTemplates.forEach((tpl) => {
      const count = (tpl.assignments || []).length;
      const opt = document.createElement('option');
      opt.value = tpl.id || tpl.name;
      opt.textContent = `📋 ${tpl.name} (${count} camareros)`;
      select.appendChild(opt);
    });
  } catch (err) {
    console.warn('Error cargando plantillas con nombre:', err);
  }
}

// Guarda el cuadrante actual con un nombre de plantilla
async function handleSaveNamedTemplate() {
  if (!activeRestaurant) return;
  if (currentDailyAssignments.length === 0) {
    alert('Añade al menos un camarero al cuadrante antes de guardarlo como plantilla.');
    return;
  }

  const templateName = prompt(
    'Introduce un nombre para guardar esta plantilla:\n\nEjemplos: "Fin de Semana", "Lunes a Jueves", "Viernes Noche", "Plantilla Verano"...'
  );
  if (!templateName || !templateName.trim()) return;

  try {
    await dbSaveNamedTemplate(activeRestaurant.id, templateName.trim(), {
      name: templateName.trim(),
      assignments: currentDailyAssignments
    });
    await refreshTemplatesDropdown();

    const select = document.getElementById('zones-named-template-select');
    if (select) select.value = templateName.trim();

    showToast(`Plantilla "${templateName.trim()}" guardada con éxito.`);
  } catch (err) {
    console.error('Error guardando plantilla con nombre:', err);
    showToast('Error al guardar plantilla: ' + err.message);
  }
}

// Carga la plantilla seleccionada en el desplegable
async function handleLoadSelectedNamedTemplate() {
  const select = document.getElementById('zones-named-template-select');
  if (!select || !select.value) {
    alert('Por favor, selecciona una plantilla del desplegable para cargar.');
    return;
  }

  const tplName = select.value;
  const tpl = savedNamedTemplates.find((t) => (t.id === tplName || t.name === tplName));
  if (!tpl) return;

  const confirmed = confirm(
    `¿Deseas cargar la plantilla "${tpl.name}" en el día de hoy?\n\nEsto rellenará el cuadrante con los ${tpl.assignments.length} camareros guardados.`
  );
  if (!confirmed) return;

  currentDailyAssignments = JSON.parse(JSON.stringify(tpl.assignments || []));
  await autoSaveCurrentDailyAssignments();
  renderUnifiedZonesEditor();
  showToast(`Plantilla "${tpl.name}" cargada correctamente.`);
}

// Elimina la plantilla seleccionada
async function handleDeleteSelectedNamedTemplate() {
  const select = document.getElementById('zones-named-template-select');
  if (!select || !select.value) {
    alert('Selecciona la plantilla que deseas eliminar en el desplegable.');
    return;
  }

  const tplName = select.value;
  const confirmed = confirm(`¿Estás seguro de que deseas eliminar permanentemente la plantilla "${tplName}"?`);
  if (!confirmed) return;

  try {
    await dbDeleteNamedTemplate(activeRestaurant.id, tplName);
    await refreshTemplatesDropdown();
    showToast(`Plantilla "${tplName}" eliminada.`);
  } catch (err) {
    console.error('Error eliminando plantilla:', err);
    showToast('Error al eliminar plantilla: ' + err.message);
  }
}

// =============================================================================
// RENDERIZADO DE LA HOJA MINIMALISTA (ESTILO EXACTO A LA FOTO PARA PDF Y WHATSAPP)
// =============================================================================

function renderZonesPreviewSheet() {
  const container = document.getElementById('zones-printable-sheet');
  if (!container) return;

  const restName = activeRestaurant ? activeRestaurant.name : 'Restaurante';
  const dateStr = formatZonesDateTitle(selectedZonesDate);

  // Clasificar cada camarero automáticamente a Mediodía y Noche
  const mediodiaShift = {
    terraza: [],
    barraTerraza: [],
    salon: [],
    barraSalon: [],
    calle: []
  };

  const nocheShift = {
    terraza: [],
    barraTerraza: [],
    salon: [],
    barraSalon: [],
    calle: []
  };

  currentDailyAssignments.forEach((assign) => {
    const classified = classifyAssignmentToShifts(assign);

    if (classified.mediodia) {
      const z = classified.mediodia.zone || 'terraza';
      if (!mediodiaShift[z]) mediodiaShift[z] = [];
      mediodiaShift[z].push(classified.mediodia);
    }

    if (classified.noche) {
      const z = classified.noche.zone || 'terraza';
      if (!nocheShift[z]) nocheShift[z] = [];
      nocheShift[z].push(classified.noche);
    }
  });

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
          <span class="legend-badge legend-calle">🚶‍♂️ Calle</span>
        </div>
      </div>

      <!-- TURNO MEDIO DÍA -->
      <div class="minimal-shift-block">
        <div class="minimal-shift-heading">
          <span class="shift-icon-dot sun-dot"></span>
          <h3>**Medio Dia**</h3>
          <span class="shift-time-tag">Comidas (hasta las 19:00 / 20:00)</span>
        </div>
        ${buildMinimalShiftTableHtml(mediodiaShift)}
      </div>

      <!-- TURNO NOCHE -->
      <div class="minimal-shift-block">
        <div class="minimal-shift-heading">
          <span class="shift-icon-dot moon-dot"></span>
          <h3>**Noche**</h3>
          <span class="shift-time-tag">Cenas (desde las 19:00 / 20:00)</span>
        </div>
        ${buildMinimalShiftTableHtml(nocheShift)}
      </div>

      <div class="minimal-sheet-footer">
        <span>GastroTime Control Horario • Cuadrante generado el ${new Date().toLocaleDateString('es-ES')} a las ${new Date().toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}</span>
      </div>
    </div>
  `;
}

// Construye la tabla minimalista exacta a la foto: Terraza | Salon | Calle lateral
function buildMinimalShiftTableHtml(shiftObj) {
  const tMesa = shiftObj.terraza || [];
  const tBarra = shiftObj.barraTerraza || [];
  const sMesa = shiftObj.salon || [];
  const sBarra = shiftObj.barraSalon || [];
  const calle = shiftObj.calle || [];

  return `
    <div class="minimal-zones-table">
      <!-- Fila 1: Terraza (Mesa), Salón (Mesa) y Columna Calle lateral -->
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
            <span class="pos-name">Salon</span>
            <span class="pos-sub">Hora</span>
          </div>
          <div class="col-body">
            ${renderWorkersLinesHtml(sMesa)}
          </div>
        </div>

        <!-- Columna 3: Calle (Abarca lateralmente como en el recuadro rojo de la foto) -->
        <div class="minimal-col col-calle col-calle-span2">
          <div class="col-head col-head-calle">
            <span class="pos-name">Calle</span>
            <span class="pos-sub">Hora</span>
          </div>
          <div class="col-body col-body-calle">
            ${renderWorkersLinesHtml(calle)}
          </div>
        </div>
      </div>

      <!-- Fila 2: Barra Terraza y Barra Salón -->
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
            <span class="pos-name">Barra Salon</span>
            <span class="pos-sub">Hora</span>
          </div>
          <div class="col-body">
            ${renderWorkersLinesHtml(sBarra)}
          </div>
        </div>

        <!-- Columna 3: Continuación lateral Calle -->
        <div class="minimal-col col-calle col-calle-continuation">
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
        <span class="worker-line-hours">${w.hours || 'Horario'}</span>
      </div>
    `)
    .join('');
}

// Genera texto resumen para WhatsApp
function generateWhatsappText() {
  const restName = activeRestaurant ? activeRestaurant.name : 'Restaurante';
  const dateStr = formatZonesDateTitle(selectedZonesDate);

  const mediodiaShift = { terraza: [], barraTerraza: [], salon: [], barraSalon: [], calle: [] };
  const nocheShift = { terraza: [], barraTerraza: [], salon: [], barraSalon: [], calle: [] };

  currentDailyAssignments.forEach((assign) => {
    const classified = classifyAssignmentToShifts(assign);
    if (classified.mediodia) {
      const z = classified.mediodia.zone || 'terraza';
      if (!mediodiaShift[z]) mediodiaShift[z] = [];
      mediodiaShift[z].push(classified.mediodia);
    }
    if (classified.noche) {
      const z = classified.noche.zone || 'terraza';
      if (!nocheShift[z]) nocheShift[z] = [];
      nocheShift[z].push(classified.noche);
    }
  });

  const formatList = (arr) => {
    if (!arr || arr.length === 0) return '  _(Sin asignar)_';
    return arr.map((w) => `  • *${w.name}*: ${w.hours}`).join('\n');
  };

  let text = `📋 *CUADRANTE DE ZONAS Y PUESTOS*\n`;
  text += `🏨 *${restName}*\n`;
  text += `📅 ${dateStr}\n\n`;

  // Mediodía
  text += `☀️ *--- TURNO MEDIO DÍA ---*\n`;
  text += `🌿 *Terraza:*\n${formatList(mediodiaShift.terraza)}\n`;
  text += `🍹 *Barra Terraza:*\n${formatList(mediodiaShift.barraTerraza)}\n`;
  text += `🍽️ *Salón:*\n${formatList(mediodiaShift.salon)}\n`;
  text += `🍸 *Barra Salón:*\n${formatList(mediodiaShift.barraSalon)}\n`;
  text += `🚶‍♂️ *Calle:*\n${formatList(mediodiaShift.calle)}\n\n`;

  // Noche
  text += `🌙 *--- TURNO NOCHE ---*\n`;
  text += `🌿 *Terraza:*\n${formatList(nocheShift.terraza)}\n`;
  text += `🍹 *Barra Terraza:*\n${formatList(nocheShift.barraTerraza)}\n`;
  text += `🍽️ *Salón:*\n${formatList(nocheShift.salon)}\n`;
  text += `🍸 *Barra Salón:*\n${formatList(nocheShift.barraSalon)}\n`;
  text += `🚶‍♂️ *Calle:*\n${formatList(nocheShift.calle)}\n\n`;

  text += `_GastroTime Control Horario_`;
  return text;
}

// =============================================================================
// EXPORTACIÓN A PDF Y ENVÍO DIRECTO A WHATSAPP
// =============================================================================

async function handleExportZonesPdfAndShare() {
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
    statusText.textContent = 'Generando PDF minimalista...';
    statusText.classList.remove('hidden');
  }

  if (typeof html2pdf === 'undefined') {
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
    const pdfBlob = await worker.outputPdf('blob');
    const pdfFile = new File([pdfBlob], filename, { type: 'application/pdf' });

    if (statusText) statusText.textContent = 'Abriendo WhatsApp para enviar PDF al grupo...';

    if (navigator.canShare && navigator.canShare({ files: [pdfFile] })) {
      await navigator.share({
        files: [pdfFile],
        title: `Cuadrante de Zonas - ${formatZonesDateTitle(selectedZonesDate)}`,
        text: generateWhatsappText()
      });
      showToast('Cuadrante enviado a WhatsApp.');
    } else {
      const downloadUrl = URL.createObjectURL(pdfBlob);
      const a = document.createElement('a');
      a.href = downloadUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(downloadUrl);

      const waText = encodeURIComponent(generateWhatsappText());
      window.open(`https://api.whatsapp.com/send?text=${waText}`, '_blank');
      showToast('PDF descargado. Se ha abierto WhatsApp para enviarlo al grupo.');
    }
  } catch (err) {
    console.error('Error generando o compartiendo PDF:', err);
    const waText = encodeURIComponent(generateWhatsappText());
    window.open(`https://api.whatsapp.com/send?text=${waText}`, '_blank');
    showToast('Se ha abierto WhatsApp con el cuadrante.');
  } finally {
    if (statusText) statusText.classList.add('hidden');
  }
}

// Descarga directa del archivo PDF
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

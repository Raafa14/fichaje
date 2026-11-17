// =============================================================================
// GASTROTIME - ESTADO GLOBAL DE LA APLICACIÓN
// =============================================================================

let activeRestaurant = null;       // { id, name, password, adminPin, ... }
let currentWorkers = [];           // Array de trabajadores del restaurante
let currentWeekRecord = null;      // Registro de la semana actual (tiempo real)
let selectedWeekRecord = null;     // Registro de la semana seleccionada en Control Semanal
let selectedWeekMonday = null;     // Objeto Date del lunes de la semana visualizada
let pendingWorkerId = null;        // ID del trabajador en el modal de fichaje
let pinModalMode = 'verify';       // 'create' | 'verify' | 'change'
let pendingActionAfterPin = null;  // Acción a ejecutar tras validar PIN

// Listeners en tiempo real de Firestore
let unsubscribeWorkers = null;
let unsubscribeCurrentWeek = null;
let unsubscribeSelectedWeek = null;
let unsubscribePrintJobs = null;
let unsubscribeStationStatus = null;
let stationHeartbeatInterval = null;

// Parámetros de Impresión Remota
let printModalTargetMonday = null;
let isPcStationOnline = false;
const PRINT_STATION_STORAGE_KEY = 'gastrotime_is_print_station';

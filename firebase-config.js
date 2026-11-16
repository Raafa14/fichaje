// =============================================================================
// GASTROTIME - CONFIGURACIÓN DE FIREBASE (CLOUD FIRESTORE)
// =============================================================================
// Puedes pegar tus credenciales aquí directamente o configurarlas desde la
// propia aplicación web pulsando en el botón "Configurar Firebase".
// =============================================================================

const DEFAULT_FIREBASE_CONFIG = {
  apiKey: "AIzaSyDxHcT5BTC82QLDaqNTTmXmxQHjiPPOEvk",
  authDomain: "fichajes-emi.firebaseapp.com",
  projectId: "fichajes-emi",
  storageBucket: "fichajes-emi.firebasestorage.app",
  messagingSenderId: "625754905076",
  appId: "1:625754905076:web:5a618bd8612797d60641a1",
  measurementId: "G-R8PRVP2H80"
};

const FIREBASE_CONFIG_STORAGE_KEY = 'gastrotime_firebase_custom_config_v1';

// Obtiene la configuración activa (desde localStorage si se configuró en pantalla, o el objeto por defecto)
function getActiveFirebaseConfig() {
  const custom = localStorage.getItem(FIREBASE_CONFIG_STORAGE_KEY);
  if (custom) {
    try {
      const parsed = JSON.parse(custom);
      if (parsed && parsed.projectId && parsed.projectId !== 'TU_PROJECT_ID') {
        return parsed;
      }
    } catch (e) {
      console.warn('Error al parsear configuración guardada de Firebase:', e);
    }
  }
  return DEFAULT_FIREBASE_CONFIG;
}

let firebaseAppInstance = null;
let firestoreDbInstance = null;
let isFirebaseConnected = false;

// Inicializa Firebase SDK
function initFirebaseApp() {
  if (typeof firebase === 'undefined') {
    console.warn('Firebase SDK no encontrado. Asegúrate de tener conexión a Internet para cargar los scripts de Firebase CDN.');
    isFirebaseConnected = false;
    return null;
  }

  const config = getActiveFirebaseConfig();

  // Comprobar si todavía tiene los valores por defecto sin configurar
  if (!config.projectId || config.projectId === 'TU_PROJECT_ID' || !config.apiKey || config.apiKey === 'TU_API_KEY') {
    console.info('ℹ️ Firebase aún no ha sido configurado con credenciales reales. Funcionando en Modo Local (localStorage).');
    isFirebaseConnected = false;
    return null;
  }

  try {
    if (!firebase.apps.length) {
      firebaseAppInstance = firebase.initializeApp(config);
    } else {
      firebaseAppInstance = firebase.app();
    }
    firestoreDbInstance = firebase.firestore();
    isFirebaseConnected = true;
    console.log('✅ Firebase Firestore conectado con éxito. Proyecto:', config.projectId);
    return firestoreDbInstance;
  } catch (error) {
    console.error('❌ Error al inicializar Firebase Firestore:', error);
    isFirebaseConnected = false;
    return null;
  }
}

// Devuelve la instancia de Firestore o null si no está conectado
function getFirestoreDb() {
  if (!firestoreDbInstance) {
    initFirebaseApp();
  }
  return firestoreDbInstance;
}

// Comprueba si Firebase está listo y configurado con credenciales válidas
function isFirebaseReady() {
  const config = getActiveFirebaseConfig();
  return Boolean(
    typeof firebase !== 'undefined' &&
    config.projectId &&
    config.projectId !== 'TU_PROJECT_ID' &&
    config.apiKey &&
    config.apiKey !== 'TU_API_KEY' &&
    firestoreDbInstance
  );
}

// Guarda una nueva configuración de Firebase desde el modal web
function saveFirebaseConfigToStorage(configObj) {
  localStorage.setItem(FIREBASE_CONFIG_STORAGE_KEY, JSON.stringify(configObj));
  // Reiniciar instancia
  if (typeof firebase !== 'undefined' && firebase.apps.length) {
    // Si ya había una app, no se puede reinicializar sin recargar la página o crear app secundaria
    // Recargar o reinicializar:
  }
  return initFirebaseApp();
}

// Elimina la configuración personalizada para volver a la del archivo o local
function clearFirebaseConfigFromStorage() {
  localStorage.removeItem(FIREBASE_CONFIG_STORAGE_KEY);
}

// Intentar inicializar de inmediato al cargar el script
try {
  initFirebaseApp();
} catch (e) {
  console.warn('Inicio diferido de Firebase:', e);
}

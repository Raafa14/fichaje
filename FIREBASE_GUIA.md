# 🚀 Guía de Conexión de GastroTime con Google Firebase (Firestore)

Esta guía te explica cómo conectar el sistema de fichaje **GastroTime** a una base de datos gratuita en la nube de **Google Firebase (Cloud Firestore)**.

Al conectarlo, conseguirás:
1. **Registro permanente de la empresa y acceso seguro.**
2. **Base de datos de empleados** sincronizada en tiempo real entre múltiples dispositivos (móviles, tablets, ordenadores).
3. **Registro histórico de horas semanales guardado para siempre**, con cálculo automático de horas de cada trabajador semana a semana y hojas de firma imprimibles para el domingo o inspecciones.

---

## 📋 Paso 1: Crear un proyecto en Google Firebase (100% Gratis)

1. Ve a [console.firebase.google.com](https://console.firebase.google.com/) e inicia sesión con tu cuenta de Google.
2. Pulsa en **"Crear un proyecto"** (o "Añadir proyecto").
3. Escribe el nombre de tu proyecto (por ejemplo: `gastrotime-fichaje`).
4. Google Analytics es opcional (puedes desactivarlo o dejarlo activado) y pulsa **"Crear proyecto"**.

---

## 🗄️ Paso 2: Activar Cloud Firestore (Tu Base de Datos)

1. En el panel izquierdo de Firebase, ve a **Compilación** > **Firestore Database**.
2. Haz clic en el botón **"Crear base de datos"**.
3. En la pantalla de reglas de seguridad, selecciona **"Iniciar en modo de prueba"** (esto permite leer y escribir fichajes).
4. Elige una ubicación cercana para el servidor (por ejemplo, `eur3 (europe-west)` si estás en España/Europa).
5. Pulsa **"Habilitar"**.

---

## 🔑 Paso 3: Obtener tus Credenciales de Firebase

1. En la parte superior izquierda de la consola de Firebase, haz clic en el icono del engranaje **⚙️ (Configuración del proyecto)**.
2. Baja hasta la sección **"Tus apps"**.
3. Haz clic en el icono web **`</>`** (plataforma web).
4. Escribe un apodo para la app (por ejemplo `GastroTime Web`) y pulsa **"Registrar app"**.
5. Verás un bloque de código como este:

```javascript
const firebaseConfig = {
  apiKey: "AIzaSyBxxxxxx...",
  authDomain: "tu-proyecto.firebaseapp.com",
  projectId: "tu-proyecto-id",
  storageBucket: "tu-proyecto.appspot.com",
  messagingSenderId: "123456789...",
  appId: "1:123456789:web:abcdef..."
};
```

---

## ⚙️ Paso 4: Conectar GastroTime

Tienes **2 formas muy sencillas** de conectarlo:

### Opción A (La más cómoda: Directamente desde la web):
1. Abre tu aplicación `index.html` en el navegador.
2. Haz clic en el botón **"Configurar Firebase"** (arriba a la derecha o en la tarjeta de acceso).
3. Pega el bloque de código copiado en la pestaña **"Pegar Configuración"**.
4. Pulsa **"💾 Guardar y Conectar"**. La página se recargará y verás el punto verde **🟢 Firebase Conectado (Nube)**.

### Opción B (En el archivo `firebase-config.js`):
1. Abre el archivo `firebase-config.js` en tu editor de código.
2. Reemplaza los valores de `DEFAULT_FIREBASE_CONFIG` con tus credenciales:
```javascript
const DEFAULT_FIREBASE_CONFIG = {
  apiKey: "AIzaSyBxxxxxx...",
  authDomain: "tu-proyecto.firebaseapp.com",
  projectId: "tu-proyecto-id",
  storageBucket: "tu-proyecto.appspot.com",
  messagingSenderId: "123456789...",
  appId: "1:123456789:web:abcdef..."
};
```
3. Guarda el archivo y listo.

---

## 📂 ¿Cómo se guardan los datos en Firebase?

La base de datos queda organizada de manera profesional en Cloud Firestore:

1. **`restaurants` (Colección de Empresas):**
   - Cada empresa tiene su documento con `name`, `password`, `adminPin` y fecha de creación.
2. **`restaurants/{id}/workers` (Colección de Empleados):**
   - Guarda los trabajadores dados de alta (`name`, `role: 'Terraza' | 'Encargado'`, `active: true`).
3. **`restaurants/{id}/weekly_records` (Colección de Semanas e Historial de Horas):**
   - Cada documento representa una semana completa (ejemplo: documento `2026-11-16` para la semana del 16 al 22 de noviembre).
   - Guarda todos los turnos fichados (Lunes a Domingo) de cada trabajador: `in` y `out`.
   - **Calcula y almacena el total semanal de horas echadas de cada trabajador** (`totalMinutes` y `formattedTotal`: ej. `38h 30m`), así como el acumulado de toda la plantilla.
   - En la sección **"Control Semanal (Admin)"** dispones de un **navegador de semanas** y un **menú desplegable de historial** para consultar e imprimir semanas pasadas en cualquier momento.

---

## 🛡️ Reglas de Seguridad recomendadas para Firestore

En la consola de Firebase > **Firestore Database** > pestaña **Reglas**, puedes asegurar el acceso con esta regla:

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /{document=**} {
      allow read, write: if true;
    }
  }
}
```

¡Todo listo! Tus empresas, empleados y registros semanales de horas quedarán permanentemente guardados en la nube.

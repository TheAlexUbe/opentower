# Análisis del motor de simulación de Towerline

Documento de ingeniería inversa estática sobre el bundle público de Towerline
(`index-DO7CXU6j.js`, 2,5 MB). El objetivo era entender las mecánicas para
construir una alternativa libre, **sin copiar código, arte, textos ni datos
propietarios**.

## Método y evidencia

- Descarga directa de los assets públicos: `index-DO7CXU6j.js`, chunks
  (`Dashboard`, `Landing`, `AcademyHome`, `Join`, `scenarios`, `api`, `P50View`,
  `SelfTestPage`) y CSS.
- Análisis estático del bundle minificado con extracción de tablas, literales y
  máquinas de estado (sin ejecutar el código de la aplicación).
- Observación de red y UI con REA y Craft Anything (para el contexto de
  producto, no para el motor).
- El bundle principal no pudo analizarse semánticamente con REA (agotó heap),
  por lo que esta parte se basa en inspección textual dirigida.

## 1. Bucle y arquitectura

El motor es una **máquina de estados determinista** con un reloj propio (`t`) y
un `tick(dt)` que:

1. avanza el tiempo y el generador de tráfico,
2. actualiza cada aeronave según su fase,
3. detecta conflictos (pista, tierra, estela),
4. genera llamadas de radio pendientes,
5. evalúa el final del turno.

El render corre por `requestAnimationFrame`, pero la física no depende del
frame: se integra con pasos fijos. Esto permite acelerar el tiempo sin romper
la simulación.

## 2. Modelo de aeronave

Cada tipo es una ficha de prestaciones con estos campos (observados en la tabla
de tipos):

| Campo | Significado |
|---|---|
| `code`, `name` | tipo ICAO y nombre |
| `category` | `piston`, `turboprop`, `jet`, `heli` |
| `wake` | estela: L / M / H / (super) |
| `taxiSpeed` | velocidad de rodaje |
| `rotateSpeed` | velocidad de rotación |
| `climbSpeed`, `climbFpm` | ascenso |
| `patternSpeed`, `finalSpeed`, `cruiseSpeed` | velocidades por fase |
| `descentFpm` | régimen de descenso |
| `accel`, `decel` | aceleración/frenada |

La tabla incluye desde C172/SR22/PA34 hasta B738/A320, B77W y A388. Hay una
segunda tabla de **longitud física** por tipo (C172 ≈ 27 ft, B738 ≈ 129 ft,
A388 ≈ 239 ft) que se usa para espaciado y geometría de calle de rodaje.

En el módulo de aproximación (TRACON) cada aeronave lleva además un subestado
`p50`: reglas VFR/IFR, propietario del sector, código squawk asignado y
propuesto, flight following, transpondedor (`mode`, `code`, `identUntil`),
handoff y alertas de seguridad.

## 3. Aeropuerto y rodaje

El aeropuerto se construye con una clase que genera:

- **pista**: nodos de umbral y una cadena de nodos a lo largo de la pista;
- **conectores** (calles de salida/entrada) con un desplazamiento lateral;
- **nodos de taxi** en una calle paralela y **conectores** hacia la pista;
- una `chain(...)` que ordena los nodos de pista y permite calcular distancias
  a lo largo de la misma.

La posición en tierra se modela con una coordenada **`s` a lo largo del eje de
pista** más un desplazamiento lateral. Esa representación hace triviales el
cálculo de "antes/después del punto de espera", la salida por una calle
concreta y el orden de las aeronaves en la pista. El campo `surfaceHalf` (en
millas náuticas) define el semiancho de la superficie.

Las instrucciones de tierra no mueven la aeronave directamente: cambian su
**ruta** (lista de nodos) y su estado. El movimiento sigue la ruta con
aceleración/frenada y se detiene en el punto de espera.

## 4. Fases y vuelo

Fases observadas en el motor: `parked`, `airborne`, `holding`, además de las
fases internas de UI (`count`, `playing`, `writing`, `voicing`, `done`). El
motor de aproximación genera tramos de patrón (viento cruzado, viento en cola,
base, final) con puntos de referencia y altitudes calculadas a partir de la
elevación del campo.

Para la aproximación final se usa una senda de descenso de ~3° (unos 318 ft por
milla náutica) hasta el umbral, y el aterrizaje se resuelve al llegar a la zona
de toma.

## 5. Instrucciones (intenciones)

El parser de fraseología no ejecuta texto libre: clasifica la transmisión en una
**intención** y el `dispatch` aplica sus efectos. Intenciones identificadas:

`hold_short`, `cross_runway`, `line_up_wait`, `takeoff`, `cancel_takeoff`,
`continue_taxi`, `hold_position`, `assign_runway`, `remain_side`,
`offer_runway`, `contact`, `handoff`, `accept_handoff`, `point_out`,
`approve_point_out`, `deny_point_out`, `radar_contact`, `ident`, `traffic`,
`safety_alert`, `unable_service`, `go_ahead`, `acknowledge`, `say_again`.

Cada intención produce:

- una **frase ATC** normalizada,
- una **lectura de vuelta** del piloto,
- y efectos sobre el estado (ruta, clearance, frecuencia, código, altitud).

La fraseología es la estándar de la aviación (no es material propietario). El
motor también genera llamadas iniciales de piloto: "listo para rodar", "en
corto de pista", "inbound para aterrizar", "pista despejada, taxi a la rampa".

## 6. Puntuación

La nota final se compone de tres bloques de **40 / 30 / 30**:

- **Safety (40)**: resta por incursión de pista, conflicto aéreo, estela,
  desviación, baja altitud, conflicto de rodaje y alerta sin resolver.
- **Communication (30)**: crédito por tiempo de respuesta (máximo con ≤20 s,
  decayendo hasta ~0,3 a los 120 s), menos errores de autorización y handoffs
  tardíos.
- **Traffic (30)**: proporción de aeronaves atendidas frente a las que quedan
  esperando o se van al aire, con penalización por salidas retenidas >2 min.

La calificación va de A+ (≥97) a F (<60). El motor guarda un `scorecard` con
las notas explicadas y las incidencias, que es lo que se muestra en el debrief.

## 7. Voz e IA (contexto)

- STT: Web Speech del navegador o **Deepgram** por WebSocket con un token
  temporal del servidor.
- TTS: **ElevenLabs** a través del backend.
- Pilotos IA: **Claude**, con prompt en servidor; el cliente envía transcripción,
  frecuencia, pista, briefing del aeropuerto, candidatos y radio reciente.
- Sin IA, un **parser local** resuelve la fraseología estándar en el navegador.

OpenTower no usa IA ni voz en nube: implementa un parser determinista y un
"cerebro" de piloto local. La única llamada externa es la observación
meteorológica de KPHX (NWS), con viento simulado como respaldo.

## 8. Datos

- Navdata **FAA CIFP** (SIDs/STARs, fixes, ciclo AIRAC) embebida.
- **METAR** real vía `/api/metar` para viento, altímetro y pista activa.
- Cartas seccionales **VFR de ArcGIS** para el radar TRACON.

## 9. Qué reimplementa OpenTower

| Pieza de Towerline | OpenTower |
|---|---|
| Bucle determinista con `tick` | Sí, propio |
| Tabla de prestaciones por tipo | Sí, datos públicos típicos |
| Grafo de pista/calle de rodaje | Sí, aeropuerto ficticio (KXCM) |
| Punto de espera y rutas | Sí |
| Parser de intenciones | Sí, subconjunto (taxi, hold, line up, takeoff, land, go around…) |
| Puntuación 40/30/30 | Sí, variante propia |
| Estela, incursiones, conflictos | Sí, versión simplificada |
| Tráfico y llamadas de piloto | Sí, generador local con semilla |
| Cruce de segunda pista | Sí, pista 12/30 inactiva + ramal norte |
| 8 aeropuertos + TRACON | No: un campo + modo Approach simplificado |
| Meteorología real | Sí, observación KPHX (NWS) |
| Voz | Sí, Web Speech local (sin nube) |
| IA/Claude, Deepgram, ElevenLabs | No: 100 % local |
| Cuentas, pagos, nube | No: sin cuenta ni backend |

## 10. Límites del análisis

- El bundle está minificado y sin source maps: los nombres de funciones no son
  los originales.
- No se ejecutó el código de Towerline para medir el motor; las conclusiones son
  estáticas.
- No se copiaron tablas de datos, geometrías de aeropuertos, textos de UI ni
  arte. La geometría de KXCM y los textos de OpenTower son originales.

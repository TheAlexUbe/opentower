# OpenTower — reglas para agentes

OpenTower es un simulador ATC gratuito, original y open source. Mantén ese carácter.

## Reglas del proyecto

- Módulos ES nativos, sin build, sin dependencias de runtime y sin backend.
- Conserva el determinismo por semilla, la fraseología existente y el diseño visual.
- No copies Towerline ni ningún producto ATC comercial: código, datos y assets originales.
- Escapa siempre el HTML dinámico con `esc()` en `src/main.js`.
- La radio admite inglés y español; el parser acepta ambos y las respuestas salen en el idioma de radio seleccionado.
- Ejecuta `npm test` y `node --check` sobre cada JS modificado antes de dar por terminado un cambio.
- Si cambias assets del shell PWA, sube la versión de `CACHE` en `sw.js`.
- No commitees `graphify-out/` ni `node_modules/`.

## Ralph RLM

- La configuración vive en `.opencode/ralph.json`; `verify.command` (`npm test`) es la condición de parada del loop.
- El proveedor se inicia con `opencode-ralph-rlm serve --worktree .` o automáticamente al abrir OpenCode. Después selecciona `ralph-rlm/supervisor`.
- La memoria del loop vive en `.ralph-rlm/plans/<name>/`: `PLAN.md`, `RLM_INSTRUCTIONS.md`, `CURRENT_STATE.md`, `PREVIOUS_STATE.md`, `AGENT_CONTEXT_FOR_NEXT_RALPH.md`, `NOTES_AND_LEARNINGS.md`, `SUPERVISOR_LOG.md` y `CONVERSATION.md`.
- Planifica con el supervisor (o la skill `interview-and-create-plan`) antes de `start_loop`, para que `PLAN.md` tenga un objetivo y una definición de hecho reales.
- Las reglas estáticas van en este archivo; la estrategia de cada intento va en `PLAN.md` y `RLM_INSTRUCTIONS.md`.
- No uses herramientas legacy v0.1 como `ralph_spawn_worker` ni `ralph_create_supervisor_session`.

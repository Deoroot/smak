# NPC de la ciudad RP: evaluación y diseño (documento vivo)

Se actualiza a medida que avanzamos. Cada decisión lleva su fecha; lo que aún no está probado en el juego lo dice.
La sección **Incongruencias y preguntas abiertas** es para anotar lo que no cuadra, en cuanto aparezca.

Mapa: `smak_rp_byz01` (H9, Xash3D FWGS, The Specialists). Plugin: `levels/rp/plugin/smak_rp.sma`. Contrato
mapa ↔ plugin: `levels/rp/CONTRACT.md`.

## Decisiones

| Fecha | Decisión |
| --- | --- |
| 2026-11-04 | Misiones al estilo GTA: un NPC da la misión y la party se teletransporta a donde se juega. El plugin lo escribimos nosotros; el líder de H9 puede cambiarlo. |
| 2026-11-05 | Los NPC no son los de Master Sword: son personas con **mejoras cibernéticas**, con más movilidad. |
| 2026-11-05 | La tabla de roles de abajo es la **versión inicial**. |
| 2026-11-05 | Opción A (monstruos de HL) **descartada**: probado en H9 con `smak_rp_monsters`, no aparece ninguno. |
| 2026-11-05 | Habrá **dinero** y **personajes guardados en el servidor**, como en MSC: un sistema "pseudo-MSC" para TS (diseño pendiente). Los **papeles** para cruzar los controles: idea interesante, sin decidir. |
| 2026-11-05 | NPC fase 1 (`smak_npc`) **probada en H9**: caminan en tiempo real, con colisión y por la ciudad. |
| 2026-11-05 | Los mapas RP se compilan en **BSP2** (SDHLT de 2cwldys, `-engine xash -format bsp2`). |

## 1. Tecnología

### Las opciones

| | Qué es | A favor | En contra |
| --- | --- | --- | --- |
| A | Monstruos de Half-Life en el servidor de TS | IA hecha: andar, puertas, huir, luchar, `scripted_sequence` | **Descartada** (2026-11-05, probado en H9): el `mp.dll` de TS nombra esas clases, pero no las exporta (las 190 que exporta no incluyen ningún `monster_*` vivo, ni `scripted_sequence`, ni `info_node`); el juego las descarta sin avisar. Falta confirmarlo en el juego con `smak_rp_monsters` |
| B | Bots RCBot (`tsrp_roambots`) | Usan las acrobacias y armas de TS de verdad | Cada uno ocupa un hueco de los 32 jugadores (2 reservados); necesitan rutas `.rcw`, que aún no generamos; su vida es pasear |
| **C** | **NPC propios del plugin**: una entidad con modelo de jugador y un "cerebro" en AMXX | Control total: horario, trabajo, diálogo, reputación; no ocupan huecos | Hay que escribir la navegación y el comportamiento |
| D | Código en el DLL del juego (C++) | Lo más potente y rápido | Mucho más trabajo; toca el núcleo de H9 (decisión del líder) |

**Elección: C**, con B para los bots que ya existen. A queda descartada salvo que la prueba en el juego diga lo contrario.

### Por qué C encaja

- **La movilidad cibernética ya está en los modelos.** Los modelos de jugador de TS traen 171 animaciones (medido en
  `models/player/proletarian`): andar, correr y agacharse; rodadas (`roll_*`), deslizamientos (`slide_*`), saltos
  en plancha (`dive_*`), ruedas (`wheel_*`, `lowwheel_*`), trepar pared (`walljump_climb`, `walljump_end`),
  supersalto (`superjump_land`, `morfy_jump`), `bullettime`, kung-fu y patadas, cuchillo y katana. Un NPC
  aumentado combina una de ellas con un impulso de velocidad: esquiva rodando, trepa un muro, cae de un salto enorme.
- **SMAK conoce el mapa entero:** cada calle, puerta, escalera, escalera de mano y sala. El JSON puede llevar un
  **grafo de caminos**, y el NPC va de nodo en nodo sin "descubrir" el mapa. El mismo grafo da las rutas `.rcw` de
  los bots de H9.
- **Los modelos de H9 ya cuentan facciones:** MSR (el régimen), insurgentes (`ins_*`), proletarios
  (`proletarian*`), droides y mechs (`msrdroid_bot`, `insdroid_bot`, `mech_msr_bot`, `mech_ins_bot`), `ed209_ts`,
  la República (`repu*`), XCCP. **El lore no está escrito en H9:** lo confirma el líder.

### Lo que falta

- **Animaciones de vida cotidiana:** sentarse, trabajar en un mostrador, barrer, hablar con gestos. No están en
  los modelos. SMAK puede añadirlas **al final** de una copia del modelo (nunca reordenar las del juego), y esa
  copia, con nombre nuevo, la carga nuestro plugin; ningún archivo del juego se reemplaza.

### Límites

| Límite | Valor | Qué implica |
| --- | --- | --- |
| Envío de entidades de reTS | se corta en el índice 2048 | el mapa ya usa ~1.340 entidades: **30–50 NPC a la vez**, más los jugadores y lo que suelten |
| CPU de AMXX | un cerebro que piensa 5–10 veces por segundo | los NPC lejos de todo jugador "duermen" |
| Combate | que disparen, se cubran y esquiven bien | la parte cara: va al final |
| Coordenadas en mensajes del plugin | ±4.096 | un mensaje que lleve una posición lejana se rompe; las entidades llegan a ±32.768 |

## 2. La vida de los NPC (versión inicial, 2026-11-05)

Un reloj de juego, por ejemplo 1 día = 48 min reales, con turnos de día y de noche. Los lugares de trabajo y las
casas salen del JSON del mapa (`places` y `properties`).

| Rol | Día | Noche | Con los jugadores |
| --- | --- | --- | --- |
| Tendero, camarero, médico, mecánico | abre su local | cierra y va a su casa | comprar, curar; el mecánico **instala mejoras cibernéticas** |
| Obrero proletario | de casa al taller o la fábrica | al bar, luego a casa | charla, rumores (pistas de misiones) |
| Patrulla MSR (humanos y droides) | rondas; controles en los checkpoints | más patrullas; toque de queda | pide identificación; si eres "buscado", te persigue y te lleva a las celdas de la Nexus |
| Contrabandistas (alcantarillado) | duermen en la bodega | mercado negro | implantes ilegales, misiones, soborno |
| Mendigos, adictos | alcantarillado, callejones | lo mismo | información a cambio de dinero |

**Reacciones comunes:** un ciudadano huye si hay tiros; un testigo denuncia; las agresiones suben tu nivel de
"buscado" y la MSR responde.

**Misiones:** las dan estos personajes (el contrabandista, el mecánico, un oficial MSR corrupto...), no NPC sueltos.

## 3. Las misiones con teletransporte

- **Espacio:** sobra. La ciudad ocupa ~3.000 × 3.500 unidades; H9 admite ±32.768.
- **Presupuesto:** con BSP2 (2026-11-05) dejan de mandar los vértices y las caras. El mapa, compilado en BSP2:
  - 50.619 vértices de 524.288;
  - 33.847 caras de 262.144;
  - 312 modelos de brush de 2.048.

  Lo que sigue mandando son las entidades a la vez (el corte de reTS en 2048), el tiempo de compilación y de carga,
  y el **PHS** (las notas de H9: por encima de ~25.000 hojas el servidor tarda en cargar o apaga el PHS).
- **Dos tipos de escenario**, compatibles entre sí:
  - **Aparte**: un sitio sellado lejos de la ciudad (como el patio del mapa de prueba `smak_rp_mtest`).
  - **En la ciudad**: un sector que ya existe (la bodega, la cisterna, un almacén, la azotea de la Nexus) se cierra
    mientras dura la misión y la party se teletransporta allí.

## 4. Orden de trabajo

1. Pruebas baratas en el juego:
   - lo ya copiado (misiones, interruptores, cárcel, alcantarillado);
   - los monstruos de HL en `smak_rp_monsters` (opción A; `levels/rp/monster-map.mjs`): se espera una sala vacía;
   - un NPC propio haciendo una voltereta y trepando una pared.
2. ~~Grafo de caminos en el JSON; de él, las rutas `.rcw` de los bots de H9.~~ Hecho el 2026-11-05 (`levels/rp/paths.mjs`; `paths` en CONTRACT.md): 645 nodos, 694 enlaces, una sola pieza; `.rcw` de 170 puntos (calles, controles y la escalera al alcantarillado). Falta probarlo en el juego.
3. NPC propios, fase 1: reloj y horarios, ciudadanos y tenderos, huida, diálogo.
4. Fase 2: patrulla MSR con "buscado" y cárcel; mecánico de implantes; contrabandistas.
5. Misiones en la ciudad, y escenarios aparte.

## 5. Sistema pseudo-MSC (diseño, borrador)

Estado: **borrador del 2026-11-05, nada escrito ni probado en el juego.** Lo que no se ha podido comprobar va marcado
con **[sin verificar]**. Pedido de la persona: "un sistema pseudo msc pero para ts", con "dinero y una forma de guardar
personajes como en msc, por servidor", y "papeles" como idea para el RP.

### 5.1 Qué hace fuerte a MSC (y qué copiamos)

Visto en disco, en la carpeta del proyecto MSC de la persona: los scripts del juego están en
`MSCScripts/scripts/` (2.884 archivos `.script`, por zonas y tipos: `NPCs/`, `monsters/`, `a3/`, `belmont/`...),
`docs/XP_SYSTEM.md` (tubería de experiencia y curva de nivel), `MasterSwordRebirth/` (el motor, C++ y AngelScript) y
`nexus2/` (servidor central, en Go). Leídos para esto: `scripts/belmont/bartender.script`, `scripts/a3/merc1.script`,
la lista de eventos de `scripts/NPCs/*` y `docs/XP_SYSTEM.md`. No he leído el código de guardado de `nexus2`: que MSC guarda
personajes en un servidor central es lo que dice el propio `XP_SYSTEM.md` (secciones "Central Server" y "nexus2") y el
conocimiento general; el detalle **[sin verificar]**.

| Rasgo de MSC | Cómo se ve en los scripts | Qué hacemos en TS |
| --- | --- | --- |
| Un script por NPC, con **eventos** | bloques `{ game_spawn }`, `{ game_menu_getoptions }`, `{ game_struck }`, `{ game_death }`, `{ game_heardsound }`, `{ game_recvoffer_gold }`, `{ game_playerused }` | Un JSON por NPC con reglas "cuando X, si Y, haz Z" (5.4) |
| **Diálogo por palabras clave** | `catchspeech say_hi hi hello hail`; el NPC contesta con `saytext` y encadena líneas con `callevent 3.0 say_hi2` | `on_say`: palabras clave en el chat cerca del NPC; líneas encadenadas con retardo |
| **Variables y banderas** | `setvard QUESTS_ACTIVE 1`, `setvard NO_JOB 0`: el NPC cambia según lo que pasó | Banderas por personaje y globales del servidor (5.4) |
| **Herencia** | `#include monsters/base_npc`, `base_chat`, `base_civilian`: cien NPC comparten una base | `"extends": "tendero"` en el JSON |
| **Tiendas y pagos** | `menuitem.register` con `type payment`, `data 'gold:16'`; `game_recvoffer_gold` | Menú de tienda y pago, con la moneda nuestra (5.5) |
| **Misiones, rumores, trabajos** | banderas y objetos por NPC (`item_bar_coffer`, `NO_JOB`, `NO_RUMOR`) | Misiones encadenadas por banderas (5.4) |
| **Habilidades que suben con el uso** | `XP_SYSTEM.md`: experiencia repartida por daño y por habilidad; curva `1.248^nivel * 4 * nivel`; tope de nivel | Pocas habilidades (5.6); la curva se puede copiar |
| **Inventario** | `$item_exists(jugador, item_...)` | Objetos del plugin (5.8) |
| **Personajes guardados** | servidor central `nexus2` | Guardado local por servidor (5.6); sin servidor central |

No se copia el lenguaje de scripts de MSC. Nuestra capa son **datos** (JSON), no código, para que SMAK la compruebe
antes de copiarla.

### 5.2 Qué hay en el servidor de H9 (medido en `C:/Juegos/H9XASH/ts/addons/amxmodx/`)

| Dato | Lo encontrado |
| --- | --- |
| Módulos presentes (`modules/`) | `nvault`, `sqlite`, `mysql`, `json`, `easy_http`, `sockets`, `regex`, `geoip`, `fakemeta`, `engine`, `fun`, `hamsandwich`, `tsfun`, `tsx` |
| Módulos listados (`configs/modules.ini`) | solo `tsx`, `tsfun`, `hamsandwich`. AMXX carga los demás cuando un plugin los pide con `#include`; `smak_rp` ya usa `json` y `fakemeta` sin estar listados, así que probablemente es así **[sin verificar para `sqlite` y `nvault`]** |
| Plugins (`configs/plugins.ini`) | los de AMXX base (admin, menús, estadísticas), más `ts_matchmode`, `ts_advertise`, `ts_uplink`, `ts_survival`, `ts_mechwarrior`, `smak_rp`, `smak_npc` |
| Datos guardados | `data/vault/` solo tiene `tsm_advertise.vault` (10 bytes); `data/tsstats.dat` (estadísticas de TS). **Nadie guarda dinero ni personajes.** |
| SQL | `configs/sql.cfg` apunta a `127.0.0.1`, usuario `root`: parece la plantilla por defecto; **[sin verificar]** que haya un MySQL. SQLite no necesita servidor |
| Dinero de TS | `include/tsfun.inc` tiene `ts_getusercash` y `ts_setusercash`. `ts_matchmode.sma` (`hold_cash`, cvar `tsm_nocash 1`) **mantiene el dinero de TS en 0** y solo lo presta mientras compra armas. El registro `logs/error_20261026.log` dice `Native set_user_cash is not supported by this reTS` y un error de ejecución en `ts_setusercash`. **No usamos el dinero de TS**: otro plugin lo vigila y puede no funcionar. El nuestro vive en el personaje y se muestra por menú o HUD |
| Código fuente disponible | `scripting/` tiene los `.sma` de `ts_*` y `amxxpc.exe`: se puede leer cómo lo hace H9 y compilar sin nada más |

Del mismo `ts_matchmode`: reconoce un mapa RP por su nombre (`roleplay_map()`, línea ~3603) y en él no fuerza el modo de
partida. El equipo de armas sigue siendo el de TS: **las armas de TS son fijas**, no se crean armas nuevas.

### 5.3 Arquitectura

| Plugin | Papel | Estado |
| --- | --- | --- |
| `smak_rp.amxx` | misiones, party, arenas | existe |
| `smak_npc.amxx` | NPC: reloj, rutas, huida, charla básica | existe (fase 1) |
| **`smak_core.amxx`** | **nuevo**: personaje, dinero, objetos, habilidades, implantes, guardado, "buscado"; exporta **natives** a los otros | por escribir |
| **`smak_script.amxx`** | **nuevo**: lee los JSON de guion (NPC, misión, tienda), dispara eventos, ejecuta acciones; usa `smak_core` y `smak_npc` | por escribir |

Separar `smak_core` de `smak_script` permite probar el dinero y el guardado sin guiones. `smak_rp` y `smak_npc` dejan de
decidir recompensas y respuestas: preguntan a `smak_core`/`smak_script` (`smak_rp` pasa de dar frags a llamar a un native
tipo `smak_give_money`). Los plugins se hablan por natives, no por cvars.

**Archivos de datos**, en `addons/amxmodx/configs/smak_rp/` junto a `<mapa>.rp.json`:

```
configs/smak_rp/
  smak_rp_byz01.rp.json          el mapa (ya existe)
  rules.json                     moneda, precios base, curva de habilidades, sueldos
  items.json                     objetos: implantes, llaves, papeles, documentos
  npc/<id>.json                  un guion por NPC (puede "extender" otro)
  quest/<id>.json                una misión o cadena
  shop/<id>.json                 una tienda
```

**Qué comprueba SMAK antes de copiar** (un `smak check rp` nuevo, con sus casos rotos en `test/broken/rp.mjs`, como pide
AGENTS.md para todo comprobador nuevo):

| Comprobación | Ejemplo de fallo |
| --- | --- |
| JSON bien formado y `format: "smak-rp-script/1"` | falta un campo, tipo equivocado |
| Cada `npc`, `place`, `property`, `arena` y `mission` nombrados existen en `<mapa>.rp.json` | el guion habla de `bar_keeper` y el mapa no lo tiene |
| Cada objeto, tienda y misión nombrados existen en su archivo | `give_item implant_legs2` sin definir |
| Cada acción y condición es de la lista cerrada (5.4) | acción `teleport_all` inventada |
| Sin ciclos de `extends`; sin eventos que se llamen entre sí sin fin | NPC A llama a B y B a A |
| Dinero: ningún camino crea más de lo que `rules.json` permite por hora (aviso) | recompensa de 1.000.000 |
| Límites de interfaz (5.9): cada `say` cabe en un mensaje (≈ 190 bytes), ≤ 7 opciones por menú | frase demasiado larga |
| Tiendas: precio de compra del jugador ≤ precio de venta del jugador (si no, se fabrica dinero) | el tendero compra a 500 y vende a 100 |
| Cupos: guiones de NPC ≤ cupo de `smak_npc_max`; objetos y misiones dentro de los topes de 5.10 | 60 guiones y cupo de 24 |

La comprobación de lo que pasa en el juego va en las fases de 5.11.

### 5.4 Modelo de eventos, condiciones y acciones

**Eventos** (lo que despierta un guion):

| Evento | Cuándo | Equivalente en MSC |
| --- | --- | --- |
| `on_use` | un jugador usa al NPC (tecla de uso) | `game_playerused`, `game_menu_getoptions` |
| `on_say` | un jugador dice una palabra clave a menos de N unidades del NPC | `catchspeech` |
| `on_hour` | el reloj del juego llega a una hora o cambia el turno | horario de `base_npc` |
| `on_hurt` | el NPC recibe daño o se oyen disparos cerca | `game_struck`, `game_heardsound` |
| `on_see` | un jugador entra en su campo de visión (con condición, p. ej. buscado) | `SEE_PLAYER_NOW` |
| `on_enter` | un jugador entra en un `place` del JSON del mapa | zona de disparo |
| `on_pay` | un jugador le ofrece dinero (menú) | `game_recvoffer_gold` |
| `on_mission_end` | una misión de `smak_rp` termina (hecha, fallida o abandonada) | final de misión |
| `on_connect`, `on_death` | el jugador entra o muere | eventos de jugador |

**Condiciones** (lista cerrada; todas deben cumplirse): `money >= n`, `has_item id [n]`, `flag id` / `not flag id`,
`var id op n`, `skill id >= nivel`, `implant id`, `wanted >= n`, `faction id`, `hour between a b`, `quest id estado`,
`rep facción >= n`, `party_size >= n`, `random p`.

**Acciones** (lista cerrada): `say`, `say_to_party`, `give_money` / `take_money`, `give_item` / `take_item`,
`set_flag` / `clear_flag`, `set_var` / `add_var`, `give_xp habilidad n`, `start_mission id`, `open_shop id`,
`open_menu` (opciones que lanzan otros eventos), `set_wanted n`, `add_rep facción n`, `install_implant id`,
`teleport place`, `play_anim`, `call evento` (con retardo), `fail`.

Forma de un guion (ejemplo para ver el tamaño; no es código del plugin):

```json
{
  "format": "smak-rp-script/1",
  "id": "mechanic_01", "extends": "mechanic",
  "events": [
    { "on": "say", "words": ["implante", "mejora"], "if": ["not flag:mech_met"],
      "do": [ {"say": "Pasa, pero aquí no se fía."}, {"set_flag": "mech_met"} ] },
    { "on": "use", "do": [ {"open_menu": ["comprar", "instalar", "hablar"]} ] }
  ]
}
```

El plugin lo carga una vez al empezar el mapa a tablas de AMXX; un evento solo recorre una lista corta. No se analiza
JSON mientras se juega.

### 5.5 Dinero

| Punto | Propuesta |
| --- | --- |
| Nombre | **"créditos"** (provisional; lo decide el líder y el lore) |
| Dónde vive | en el personaje (5.6), **no** en `ts_setusercash` (5.2) |
| Cómo se ve | `say /dinero`, una línea de HUD al cambiar, y el menú `/yo` |
| Fuentes | recompensas de misión; sueldos por oficio (cada hora de juego); venta de objetos; botín de atracos (con "buscado"); servicios cobrados a NPC |
| Sumideros | tiendas; instalar implantes; sobornar a un MSR (baja "buscado"); multa en el control; cuidado médico; **impuesto de muerte** (se pierde un %; lo del banco se salva) |
| Equilibrio | `rules.json` pone un techo de ingreso por hora de juego; el comprobador avisa de lo que lo supera |
| Misiones | hoy `done.reward` del contrato solo lleva `frags`; se añade `reward.money` (campo opcional de `smak-rp/1`, o `smak-rp/2`: pregunta abierta). `frags` se mantiene. Cada miembro de la party cobra su parte |
| Trampas a vigilar | duplicar dinero con tiendas (lo comprueba SMAK); pasar dinero entre jugadores: permitido con tope y anotado en el libro de movimientos |

### 5.6 Personaje guardado

**Qué se guarda**

| Grupo | Campos |
| --- | --- |
| Identidad | nombre del personaje, modelo elegido (de la lista permitida), facción, fecha de creación |
| Cuenta | dinero, banco (a salvo del impuesto de muerte), "buscado", reputación por facción |
| Habilidades | nivel y experiencia de cada una (abajo) |
| Objetos | lista `(id, cantidad)`; implantes instalados; papeles |
| Estado | banderas de misión y diálogo, misiones activas y terminadas; posición solo por seguridad (no se restaura en el aire) |
| Meta | versión del formato, última conexión, contador de escrituras |

**Habilidades** (propuesta mínima, inspirada en MSC; suben **con el uso**, con la curva de `XP_SYSTEM.md` y un tope):
`puntería` (daño con armas de fuego), `agilidad` (acrobacias hechas), `vigor` (daño recibido y sobrevivido), `labia`
(tratos y sobornos), `sigilo` (pasar desapercibido ante una patrulla). TS ya tiene estadísticas propias
(`data/tsstats.dat`): no las tocamos.

**Cuándo se guarda:** al crear el personaje; al cambiar el dinero (con retardo de ≤ 5 s para agrupar); al terminar o
fallar una misión; al instalar o perder un implante; al desconectar (`client_disconnected`); cada 2 minutos si hay
cambios pendientes; y al cambiar de mapa (`plugin_end`). **Cuándo se carga:** al validar la identidad (5.7).

**Almacenamiento: `nvault` o `sqlite`**

| | nvault | sqlite |
| --- | --- | --- |
| Estructura | clave → texto | tablas, consultas, transacciones |
| Módulo | presente | presente |
| Escritura de varios campos a la vez | no: todo en una cadena | sí (transacción) |
| Consultar ("quién tiene más", "borrar inactivos") | no | sí |
| Copia de seguridad | copiar un `.vault` | copiar un `.sq3` |
| Riesgo | límite de tamaño de valor, formato propio que mantener | que el módulo cargue bien en Xash **[sin verificar]** |

**Propuesta: SQLite**, con tablas `character`, `item`, `skill`, `flag` y `ledger` (libro de movimientos de dinero: muy
útil para depurar trampas). Plan B si `sqlite` falla en Xash: `nvault`, con el personaje serializado en una cadena por
jugador (y el libro en un archivo de texto aparte). **Se decide con una prueba en el juego** (fase 0): abrir, escribir,
leer, cerrar.

**Por servidor:** el personaje es del servidor donde se creó (como pidió la persona); la base está en
`addons/amxmodx/data/smak_rp/`. Moverlo a otro servidor exigiría exportar e importar un archivo: **no se diseña ahora.**

**Copia de seguridad:** al cargar el mapa se copia la base a `data/smak_rp/backup/<fecha>.sq3` (se conservan las últimas
7), y un comando de administrador `smak_char_export <id>` escribe el personaje en JSON legible. Toda escritura va a un
`.tmp` y se renombra, para que un corte no deje el archivo a medias. **[sin verificar]** que AMXX pueda renombrar y copiar
archivos en ese servidor (`rename_file`, `file_exists` existen en AMXX).

### 5.7 Identidad del jugador bajo Xash

Lo medido en `logs/*.log`:

| Visto en el registro | Qué significa |
| --- | --- |
| `<ID_LOOPBACK>` (más de 110 veces) | servidor "escucha" local: **todos los jugadores locales comparten ese ID**; no sirve de clave |
| `<STEAM_0:1:33635060>` (22 veces, 2026-10-15) | un ID con forma de Steam; es de la persona (2cwldys). El cliente de H9 produce IDs con esa forma |
| `<STEAM_ID_LAN>` (8 veces) | ID genérico: **todos los que lo tengan serían el mismo** |

`C:/Juegos/H9XASH/h9_userid.ps1` crea un id aleatorio por instalación (`user_id.ini`), que el motor "salpimenta" (hash con
sal) **por servidor de destino** antes de enviarlo, según el comentario del propio script. `docs\CUSTOM_XASH_USERID.txt`,
que el script cita, no está en esa instalación: **no he podido leer la especificación.** Consecuencias **[sin verificar]**:
el ID sería estable para el mismo jugador en el mismo servidor (justo lo que queremos, "por servidor"), pero **cambia si
regenera su id** (`h9_regenerate_userid.bat`) o reinstala, y un cliente que no sea H9 puede mandar `STEAM_ID_LAN` o
`VALVE_ID_LAN`. En `scripting/` hay un `DownloadsTSMdocsuserid_exampleh9id_example.amxx` (binario, sin código) que sugiere
que el líder expone el ID por algún plugin: **preguntar.**

| Opción | Cómo funciona | A favor | En contra |
| --- | --- | --- | --- |
| **A. ID de autenticación** | `get_user_authid` es la clave del personaje | cero fricción | se pierde el personaje si el ID cambia; `ID_LOOPBACK` y `STEAM_ID_LAN` chocan |
| **B. `/registrar` y `/entrar`** | nombre y clave; el servidor guarda un hash con sal | independiente del ID; recuperable | la clave no puede ir por el chat (la ven todos y queda en el registro): se usa una orden de consola, `smak_login`; algo de fricción |
| **C. A y B** | el ID reconoce al jugador y la clave sirve para **vincular un ID nuevo** al personaje | cómodo y recuperable | más código |
| **D. Cuenta del líder de H9** | si H9 ya tiene cuentas | sin fricción | **[sin verificar]** que exista y que un plugin la pueda leer |

**Propuesta: C**, empezando por **A sola** (fase 1), rechazando `ID_LOOPBACK`, `STEAM_ID_LAN` y vacíos: esos juegan como
"invitado", sin guardar. B se añade después (fase 9). Una clave nunca se guarda en claro ni se escribe en ningún registro.

### 5.8 Objetos, papeles e implantes

**Objetos del plugin.** Las armas de TS son fijas; lo nuevo son objetos **de datos**:

| Tipo | Ejemplos | Qué hace |
| --- | --- | --- |
| Implante | piernas de resorte, equilibrio, malla subdérmica, ojos térmicos | efectos pasivos (tabla siguiente) |
| Llave | llave de un piso (`properties`), tarjeta de acceso | abre puertas con nombre al usarlas, si el mapa lo permite |
| Papel | identificación, pase de control, orden de captura, recibo | condición para pasar un control o tratar con un MSR |
| Documento | nota, plano, carta | texto que se lee; pista de misión |
| Consumible | botiquín, estimulante, droga | efecto temporal |

Un objeto es una entrada de `items.json` (id, nombre, tipo, precio, efecto). El inventario tiene un máximo de huecos
(p. ej. 20). Como no hay una interfaz propia (5.9), se abre con `/inventario` y se elige con números.

**Implantes como bonificaciones.** Cómo los aplicaría un plugin:

| Efecto | Mecanismo | Estado |
| --- | --- | --- |
| Velocidad | `pev_maxspeed` o `set_user_maxspeed` (módulo `fun`), al aparecer y en `PlayerPreThink` | **[sin verificar]** que TS no la fije cada fotograma; habría que leer `ts_survival` y `ts_mechwarrior` |
| Salto | `pev_gravity` o `set_user_gravity` | **[sin verificar]** |
| Vida máxima | `set_user_health` y `pev_max_health` al aparecer | **[sin verificar]** |
| Armadura | `set_user_armor` (`fun`) | **[sin verificar]** |
| Reducción de daño | `Ham_TakeDamage` previo con multiplicador (`hamsandwich` está activo) | probable |
| Acrobacias | TS ya las tiene (rodar, plancha, deslizarse, supersalto); un implante podría **darlas o quitarlas** y bajar el daño de caída | **[sin verificar]** que TS las exponga a plugins |
| Efectos de pantalla | `ScreenFade` con `message_begin` | **[sin verificar]** en Xash |

Cada implante cuesta "carga cibernética" (hay un tope): limita las mejoras y da RP (psicosis, el mecánico, implantes
ilegales que suben "buscado"). Los implantes se **reaplican al aparecer** y al cargar el personaje, no una sola vez.

**Papeles y controles (opcional).** Idea de la persona, "interesante para RP". Cómo funcionaría:

| Elemento | Diseño |
| --- | --- |
| El control | cada `gate` de las murallas ya está en el JSON del mapa; lo vigila un MSR NPC |
| Con papeles válidos | al acercarse, el MSR mira la ficha: con `pase` y sin "buscado", abre; si no, dice su frase y no abre |
| Sin papeles | **sobornar** (dinero; si falla, sube "buscado"), **colarse** (alcantarillado, tapa, rejilla: ya están en el grafo) o **forjar** (un contrabandista vende un pase falso con riesgo de que lo detecten) |
| Ciudadanos NPC | con `smak_npc_gates 1` pasan; con papeles, cada ciudadano **tiene** los de su oficio y barrio, y sus horarios usan los controles como un jugador |
| Cómo se aplica | sin tocar el mapa: el plugin bloquea el uso de la puerta del control (`Ham_Use` previo) hasta que el MSR NPC la libera. **[sin verificar]** si hay otra forma de abrirla (disparo, explosión) |
| Opcional | `rules.json` lleva `"papers": false` y todo funciona sin él |

### 5.9 Límites de interfaz

| Cosa | Límite o hecho | Consecuencia |
| --- | --- | --- |
| Menús | `menu_create` / `show_menu`: 7 opciones por página más "atrás/siguiente/salir"; el cliente puede cerrarlos | tiendas con páginas; el comprobador avisa de más de 7 opciones |
| HUD | `set_hudmessage` + `show_hudmessage`, pocos canales, texto corto | un renglón de estado (dinero, buscado) que se actualiza al cambiar, no cada fotograma. **[sin verificar]** cuántos canales respeta el cliente de H9 |
| Mensajes de chat | `client_print` tiene límite por mensaje (≈ 190 bytes) | frases cortas; el comprobador las mide |
| MOTD | `show_motd` sirve para textos largos (cartas, planos, el inventario) | **[sin verificar]** que el cliente de H9 pinte HTML |
| Interfaz propia (VGUI) | **no hay**: no tocamos el cliente | todo por menús, chat y HUD |
| Coordenadas en mensajes | ±4.096 | ver 1 · Límites |
| Entrada de texto | solo por chat o consola (`say /x`, `smak_login clave`) | las palabras clave de `on_say` vienen del chat |
| Idiomas | `smak_npc_lang` ya existe (0 inglés, 1 español) | los textos del JSON llevan `{"en": "...", "es": "..."}` |

### 5.10 Rendimiento y entidades

| Recurso | Cifra | Plan |
| --- | --- | --- |
| Corte de entidades enviadas (reTS) | 2.048 | mapa ≈ **1.470** + NPC (≈ 24, hasta 40) + 32 jugadores ≈ 1.540-1.560, más lo que suelten: **margen ≈ 450** |
| Objetos soltados al suelo | cada uno es una entidad | no se materializan: el botín va directo al inventario; lo que suelte un jugador, con tope y caducidad corta (30 s) |
| Entidades nuevas del sistema | ninguna aparte de los NPC | `on_enter` se calcula por distancia, sin `trigger_*` nuevos |
| CPU | AMXX corre en un solo hilo | cola de eventos con máximo por fotograma; `on_say` busca en una tabla |
| Escrituras a disco | no cada fotograma | agrupar (≤ 5 s) y usar transacciones |
| Memoria de AMXX | tablas de tamaño fijo | topes en `rules.json`: 64 NPC con guion, 128 objetos, 32 misiones |

### 5.11 Plan de construcción, por fases (cada una se prueba en el juego)

| Fase | Qué se hace | Cómo se prueba en el juego |
| --- | --- | --- |
| 0 | **Preguntas al líder** (abajo) y una prueba mínima: ¿abren `sqlite` y `nvault`? ¿qué IDs llegan? ¿se fijan velocidad, gravedad, vida y armadura? | un plugin de ~40 líneas que escribe y lee en ambos, imprime `get_user_authid` y fija `maxspeed`/`gravity`; mirar el registro |
| 1 | `smak_core`: personaje con identidad por ID (A), dinero, `/dinero`, `/yo`, guardado y carga | ganar créditos por consola de admin, salir y volver: el dinero sigue; cortar la conexión a la fuerza: no se pierde nada |
| 2 | Recompensas de `smak_rp` en dinero (`reward.money`) | terminar una misión de `smak_rp_mtest` y cobrar; abandonar y no cobrar |
| 3 | `smak_script`: eventos `on_use`, `on_say`, `on_hour`; acciones `say`, `give_money`, `set_flag`, `open_menu`; `smak check rp` con sus casos rotos | hablar con un tendero, decir una palabra y ver la respuesta; un JSON roto no se carga y el registro dice por qué |
| 4 | Tiendas y objetos: `items.json`, `shop/`, `/inventario`; documentos y llaves | comprar, vender, no poder sin dinero, qué pasa con los objetos al morir |
| 5 | Implantes: mecánico, instalación, reaplicar al aparecer y al cargar; carga cibernética | instalar, morir, reaparecer con el efecto; cambiar de mapa y volver |
| 6 | Habilidades que suben con el uso; `give_xp` | disparar, subir de nivel, ver el aviso; guardado |
| 7 | "Buscado" y reputación; reacción de la MSR; multas y sobornos | agredir a un ciudadano, ser buscado, pagar una multa |
| 8 | **Opcional:** papeles y controles | pasar un control con y sin papel; soborno; colarse por el alcantarillado; ciudadanos con papel |
| 9 | Identidad con clave (B y C): `smak_register`, `smak_login`, vincular un ID nuevo; copias de seguridad y `smak_char_export` | cambiar `user_id.ini`, entrar y recuperar el personaje con la clave |
| 10 | Misiones encadenadas con banderas y rumores; `on_mission_end` | una cadena de tres misiones con un NPC que cambia lo que dice |

### 5.12 Supuestos sin verificar (resumen)

- Que `sqlite` y `nvault` carguen en el servidor de H9 (los `.dll` están, no hay prueba de que funcionen en Xash).
- Que el cliente de H9 mande un ID estable por servidor, y cómo lo "salpimenta" (falta `CUSTOM_XASH_USERID.txt`).
- Que `ts_setusercash` no sirve (el registro de errores del 2026-10-26 lo sugiere).
- Que velocidad, gravedad, vida y armadura se puedan fijar sin que TS las pise cada fotograma.
- Qué canales de HUD y qué longitud de mensaje respeta el cliente de H9; si el MOTD pinta HTML.
- Que la puerta de un control se pueda bloquear desde el plugin sin que haya otra forma de abrirla.
- Que el módulo `json` aguante guiones del tamaño previsto (el de `smak_rp` ya funciona con el JSON del mapa).
- Cómo guarda MSC sus personajes por dentro (`nexus2`): no lo he leído.

## Incongruencias y preguntas abiertas

- **El lore:** ¿qué facciones hay y cómo se llaman? ¿Qué mejoras cibernéticas existen y quién las vende? (El líder.)
- **El dinero:** H9 no tiene dinero propio en modo RP; el plugin paga en frags. Comprar, curar o sobornar necesita
  una moneda: ¿la ponemos nosotros o la tiene otro plugin del servidor?
- **Los bots de H9:** `tsrp_roambots` no tiene su código en la carpeta del juego (solo el `.amxx`), y sin rutas
  `.rcw` sus bots probablemente no caminan bien en nuestro mapa. ¿Siguen haciendo falta junto a nuestros NPC?
- **Día y noche:** el mapa no cambia de luz. ¿El reloj del juego es solo de horarios, o hay que oscurecer el cielo
  (estilos de luz: quedan 8 de los 32 conmutables)?
- **Los `func_wall` grandes:** el compilador nuevo avisa de 28 `func_wall` que tocan más de 48 hojas (uno, toda la
  ciudad). El motor los envía siempre en vez de recortarlos por visibilidad: cuesta rendimiento, no se ve mal.
  Partirlos por zonas. **Hecho** (2026-11-05): ninguno pasa de 48 hojas; +132 entidades (1.470).

- **Los bots y las puertas:** el `.rcw` deja fuera las puertas con nombre, la tapa de la alcantarilla, la rejilla y la trampilla, porque leyendo su código RCBot no las abre (sin probar). Los interiores quedan fuera de su ruta.
- **Pasillos de 42 unidades:** los rellanos de bar, t2 y t3 dejan pasar al jugador (32) con poco margen. Si los NPC o los jugadores se atascan, hay que ensanchar las piezas.
- **smak_npc, fase 1 (2026-11-05, sin probar en el juego):** plugin nuevo `plugin/smak_npc.sma`; `npc-sim.mjs` comprueba el JSON del mapa sin el juego (24 NPC: 5 tenderos, camarero, médico, mecánico, 6 obreros, 10 ciudadanos; 54 rutas, todas por `walk`, `stair` y puertas simples).
- **Los controles dividen la ciudad:** sin pasar por las puertas `gate` (los controles de las murallas), los pisos de Mese y Nexus no llegan al bar, a la clínica ni al taller del mercado. Hoy los 6 ciudadanos de Mese pasan la tarde en sus calles, y los tenderos de Mese solo van de su casa a su tienda. Es lo que pedía el encargo (los NPC no usan `gate`); `smak_npc_gates 1` los deja pasar. ¿Los ciudadanos necesitan papeles? Eso es lore: lo decide el líder.
- **Rutas largas:** de un piso de Mese a su tienda hay 1.900-2.300 unidades de camino (el piso se entra por la escalera de atrás); a 100 u/s son 20 s. Si es demasiado, acercar la escalera a la tienda en las piezas, o subir `smak_npc_walk`.
- **Modelos:** el encargo nombraba `fem_nh*`; en `models/player/` solo existen las variantes (`fem_nh_dust`, `_mud`...), no `fem_nh` a secas. Se usan `proletarian`, `proletarian_dirty`, `proletarian_healthy`, `prole_fem`, `prole_bfem` e `ins_medic` (las 171 animaciones son las mismas en todos).
- **Animación de una entidad que no es jugador:** el cliente solo separa piernas y torso en los jugadores (`gaitsequence`). Un NPC reproduce una sola secuencia de cuerpo entero (`walk2`, `run2`, `standard_idle`, `roll_f`...). Las de arma (`idle_twohanded`...) llevan 2 mezclas y probablemente se verían a medias. Sin probar.
- **Puertas:** los pisos y los controles son `func_door_rotating` que se abren con `use` (`spawnflags` 272, `wait` 4). El NPC las abre con `DLLFunc_Use`; si el servidor tiene un plugin de llaves que bloquea el uso, hay que ver si también bloquea a los NPC.
- **Movimiento:** cerca de un jugador, `WalkMove` con `MOVETYPE_STEP` (colisión del mundo, escalones de 18); lejos, un paso por segundo siguiendo la ruta, sin colisión (los enlaces ya tienen el suelo comprobado). Si un NPC se atasca más de 1,5 s da un empujón corto, y a los 6 s se coloca en el nodo, salvo que haya un jugador a menos de 56 unidades. Nada de esto está probado.
- **Disparos:** se oyen por `FM_PlaybackEvent` (el evento de arma del jugador) y por `Ham_TakeDamage` del jugador. Si TS lanza el disparo por otro camino, el NPC no huirá; `smak_npc_scare` sirve para probar el resto.
- **Sin nodos de HL:** TS tampoco crea `info_node`, así que no hay grafo de nodos del motor. El grafo de caminos
  tiene que ser nuestro (en el JSON del mapa), y la navegación de los NPC la hace el plugin.

- **Pseudo-MSC, identidad (5.7):** ¿qué ID de jugador ve de verdad el servidor de H9: estable por servidor, o cambia al regenerar `user_id.ini`? ¿Existe una cuenta de H9 que un plugin pueda leer? ¿Qué es `h9id_example.amxx` en `scripting/`? Falta `docs/CUSTOM_XASH_USERID.txt`.
- **Pseudo-MSC, almacenamiento (5.6):** ¿cargan `sqlite` y `nvault` en el servidor de H9? ¿Hay un MySQL en `127.0.0.1` o `sql.cfg` es la plantilla? ¿Los personajes son por servidor y no hace falta moverlos entre servidores?
- **Pseudo-MSC, dinero (5.5):** nombre de la moneda ("créditos" es provisional) y cifras de sueldos, precios y multas. ¿Se ignora `ts_setusercash`, o el líder prefiere mostrar el dinero de TS? `ts_matchmode` lo mantiene en 0 (`tsm_nocash 1`).
- **Pseudo-MSC, implantes (5.8):** ¿qué natives de TS (`tsx`, `tsfun`) fijan velocidad, gravedad, vida o acrobacias, y qué pisan `ts_survival` y `ts_mechwarrior`? ¿Qué implantes existen en el lore?
- **Pseudo-MSC, papeles (5.8):** ¿se hace? Lo decide la persona. Si se hace: ¿los ciudadanos NPC los llevan, y se bloquea la puerta del control por plugin?
- **Pseudo-MSC, interfaz (5.9):** canales de HUD, longitud de mensaje y HTML en el MOTD en el cliente de H9. Sin esto, tiendas e inventario son solo menús.
- **Pseudo-MSC, contrato (5.5):** `reward.money` en el JSON del mapa: ¿campo opcional de `smak-rp/1` o `smak-rp/2`? ¿Dónde viven `rules.json`, `items.json`, `npc/`, `quest/` y `shop/` en el repositorio (¿`levels/rp/script/`?)?
- **Pseudo-MSC, migración (5.3):** hoy `smak_rp` paga frags y `smak_npc` dice líneas fijas; ¿se migran de una vez a `smak_core`/`smak_script` o con un interruptor (`smak_core_enable`)?

- **Pseudo-MSC, fase 1 (2026-11-05, sin probar en el juego):** `smak_core.sma` guarda el personaje en `data/sqlite3/smak_rp.sq3` (una tabla `characters` con `extra` JSON libre y `schema_version`; no las cinco tablas de 5.6: `item`, `skill`, `flag` y `ledger` llegan en sus fases, y el libro de movimientos es por ahora el archivo `logs/smak_money.log`). La clave es `auth:<authid>`.
- **Desconexión:** el registro de AMXX dice que `client_disconnected` está desactivado; el plugin usa `FM_ClientDisconnect` (fakemeta) y también `client_disconnected`, con la misma función idempotente, más un barrido de 60 s. **Sin verificar** que `FM_ClientDisconnect` se dispare en Xash/reTS: si ninguno lo hace, el barrido solo ve el hueco si `is_user_connected` lo marca libre, y se perdería hasta 60 s de cambios y de tiempo jugado.
- **Invitados:** quien llega con ID compartido (`STEAM_ID_LAN`...) juega como invitado, con el dinero inicial cada sesión y sin guardar. `smak_char_loaded` es verdadero también para ellos (`smak_char_guest` los distingue). ¿Debe una recompensa de misión pagarse a un invitado? Hoy sí, y se pierde al salir.
- **Dinero entero de 32 bits:** tope de 1.000.000.000; un ingreso que lo pasaría se rechaza. `/me` sin texto lo toma `smak_core` (con texto se deja a otros plugins de chat).
- **Guardado y mapa:** `plugin_end` guarda de forma síncrona mientras puede haber consultas en hilo pendientes; **sin verificar** que SQLite no responda "database is locked" en ese cruce (el aviso queda en el registro y en `smak_money.log`).

## Cambios de este documento

- 2026-11-05: `smak_rp` ya no engancha `FM_KeyValue` (se caía en Xash); los rompibles van en el JSON. `smak_npc` corregido: movimiento suave, sin saltos a la vista, sin atravesar puertas, con colisión.

- 2026-11-05: primera versión (evaluación, roles iniciales, BSP2).
- 2026-11-05: grafo de caminos y `.rcw` hechos; `func_wall` partidos.
- 2026-11-05: la opción A, casi descartada: TS no exporta los monstruos de HL ni `info_node`.
- 2026-11-05: fase 1 de los NPC propios (`smak_npc.sma`, `npc-sim.mjs`, `test/162-npc-sim.mjs`): reloj de 48 min, roles por tipo de lugar, rutas A* por el grafo, huida con acrobacia, diálogo por rol y hora. Compilado, sin probar en el juego.
- 2026-11-05: sección 5, sistema pseudo-MSC (borrador de diseño, sin código ni pruebas): plugins `smak_core` y `smak_script`, guiones JSON, dinero, personaje guardado, identidad, objetos e implantes, papeles opcionales, fases de construcción.
- 2026-11-05: fase 1 del sistema pseudo-MSC: `plugin/smak_core.sma`, `plugin/include/smak_core.inc` y `test-core-sql.mjs`; sección en `README.md`. Compilado, sin probar en el juego.
- 2026-11-05: fase 2: `reward.money` es campo opcional de `smak-rp/1` (no hace falta `smak-rp/2`); cada miembro de la party que sigue en la misión cobra la cantidad completa. Compilado, sin probar en el juego.
- 2026-11-05: fase 3: `plugin/smak_script.sma`, `script.mjs` (`checkScript`, `checkRp`, `smak check rp`), `scripts/smak_rp_mtest.script.json`, `test/163-rp-script.mjs` y sus casos rotos. `smak_npc` exporta `smak_npc_hour`. Compilado, sin probar en el juego.
- 2026-11-05: fase 4: `plugin/smak_items.sma`, `include/smak_items.inc`, `items.mjs` (con la trampa de comprar y revender), `items/`, `test-items-sql.mjs`, `test/164-rp-items.mjs`. Al morir se conserva todo por defecto. `ts_giveweapon` sin probar en este reTS. Compilado, sin probar en el juego.
- 2026-11-05: fase 6: `plugin/smak_skills.sma`, `include/smak_skills.inc`, `test-skills-sql.mjs`. Cuatro habilidades por `Ham_TakeDamage` entre jugadores con topes; solo resistencia tiene efecto (vida). Compilado, sin probar en el juego.

## Stable ids (smak_npc_find)

Every generated person has an id that depends only on the rp.json and the cvars (no random call decides it) and is also the
entity's targetname: a keeper is `<role>_<place id>` (`shopkeeper_ms1_shop`, `barman_bar_bar`, `medic_clinic_clinic`,
`mechanic_works_workshop`), workers are `worker_01`.., citizens `citizen_01`.. in the order they are made, guards `guard_01`.. (made last, so the others keep their ids). `smak_npc.inc` has
the natives `smak_npc_find(id)`, `smak_npc_id(ent, id, len)`, `smak_npc_name(id, name, len)`, `smak_npc_count()`; the log says
`[smak_npc] ids: ...` once at load. `smak_script` rules bind to them with `"npc": "<id>"` (after rp.json's own npcs; smak_npc.amxx
must be listed before smak_script.amxx). Offline: `npcIds(rp)` in `npc-sim.mjs`; `smak check rp <script> --rp <rp.json>` accepts
those ids (or `--npcs id,id,...`).

## Guards (smak_npc, 2026-11-06, compiled, not tried in the game)

The regime's patrol: `guard_01..guard_NN` (cvar `smak_guard_count`, default 4, at most 8), made after the civilians and out of the same
40-entity cap. They hunt players who are wanted (`smak_law` level 1-5) by stars, GTA style, and never touch anyone else.

**Where they stand.** Posts and spawns are read from the rp.json, never hard-coded: the nodes of `places` whose kind contains
`police` or `guard` (or is `post` or `booking`); if there are none, the nodes of properties of kind `police`; then, always, both
sides of every checkpoint gate. Guards start at waypoint `k mod n`. With none of these in the graph there are no guards (WARN offline).
Model: the first of `msrdroid_bot`, `merc`, `agent` the game has (all have the same sequences), else a civilian's.

**What they may walk through.** Patrol: streets, shops, public halls, police rooms and every checkpoint gate (always, whatever
`smak_npc_gates` says); no homes. A hunt: everywhere, through the doors that are not locked. At 3 stars also through locked ones
(they are breached). Locks come from `smak_doors` (`smak_door_locked`, cached and refreshed 16 doors every half second, and read fresh at
the door); police and jail doors never count as locked for a guard. Without `smak_doors` every door counts as unlocked.

**States** (`g_gm`; the walking itself is the civilians' code, A* over the same graph, `ST_WALK`):

| State | When | What it does |
| --- | --- | --- |
| patrol | no target | walks waypoint to waypoint (posts 8-18 s, gates 3-7 s, turns to look about); a locked door on the way is left out of the plan |
| watch | 1 star, this guard sees him | follows at `smak_npc_walk`, keeps 180 u away, shouts "Alto" every 10 s; if he stands still `smak_guard_stop_sec` (2 s) it walks up and arrests; 6 s (`smak_guard_lose1`) without sight ends it |
| chase | 2+ stars | runs at `smak_npc_run` straight at him when in sight, within 450 u, same floor and the hull is clear; otherwise by the graph, planned again every 0.7 s from the node ahead (it does not turn back); goes to the last known place when sight is lost. The guard who sees calls the others within `smak_guard_call` (2000 u); at 3 stars everybody is called, and the place where the level became 3 is told to all |
| search | sight lost and the last known place (or the nearest node it can reach) reached | visits random nodes within `smak_guard_search_radius` (600 u) of it for `smak_guard_search_sec` (25 s, twice that at 3 stars), 1.5-3.5 s at each, looking about. Sees him again: chase. Time out: patrol, and if no guard is left on him he drops a level (`smak_law_lower`, never below 1; `smak_guard_escape`, at most once per 60 s) |
| breach | 3 stars, a locked door on the way | stands at the door `smak_npc_breach_sec` (5 s), tells the player "Los guardias fuerzan la puerta (n s)" every second (and anyone within 350 u), optional sound `smak_guard_knock`, then `smak_door_breach(door, guard entity)` and on. Below 3 stars the door is left out of the route: the guard goes to the nearest node it can reach and searches around there |
| arrest | within `smak_guard_arrest_range` (80 u), seen | stands and holds him: after `smak_guard_arrest_sec` (3 s) `smak_law_arrest` (fine taken, level cleared). The timer resets while the target fires (a weapon event in the last 1.5 s), and at 1 star while he moves faster than 150 u/s. From 2 stars his horizontal speed is also scaled by `smak_guard_grab_scale` (0.4) each 0.1 s while held (`smak_guard_grab`) |

A shot heard from a player at 2+ stars sends the guards within `smak_npc_hear` to the place (chase). Sight: eye to eye traceline,
range `smak_guard_range` (900 u at 1 star, +25 % per star), view cone `smak_guard_fov` (140 degrees), no cone needed inside
`smak_guard_close` (150 u). Looked for every 0.25 s per guard, only while somebody is wanted. A player inside a mission arena
(`smak_rp_in_arena`) is never a target. The wanted player sees "Un guardia te vigila..." / "Te buscan..." / "Te persiguen!" (HUD).

**Decisions.** (1) *No damage.* A guard arrests and slows; it does not shoot or hit. Reason: TS damage from a non-player entity
is untried, a hostile NPC that can kill makes the arrest meaningless (a death already costs the fine), and the law system punishes
players for killing, not NPCs for killing players. The hook is `guard_look`/`arrest_step` if the leader wants damage later.
(2) *Arrest does not teleport to a cell.* `smak_law_arrest` takes the fine and clears the level; jail is not built yet. (3) Guards
are made last and the civilian cap drops by their count, so civilians keep their ids and places. (4) The faster drop of a level when
they lose him is `smak_law_lower(id, levels, min_level, reason)`, a new native of smak_law (the deployed `smak_law.amxx` must be rebuilt with
it, or the call is a runtime error); it never reaches 0.

**Doors.** `open_door` now uses a leaf only while it is where it stood at map start (shut): a toggle door (wait -1) closes at a second
use, so a leaf that is open or moving is left alone. A guard never opens a locked door by its own use (smak_doors lets non-player use
pass): it breaches, or goes round.

**Cvars.** `smak_guard_enable 1, _count 4, _range 900, _fov 140, _close 150, _jog 150, _lose1 6, _call 2000, _breach 1, _arrest_range 80,
_arrest_sec 3, _stop_sec 2, _grab 1, _grab_scale 0.4, _search_sec 25, _search_radius 600, _replan 0.7, _escape 1, _escape_cd 60, _debug 0,
_knock ""`, and `smak_npc_breach_sec 5`. `smak_guard_debug 1` logs every change of mode. Admin: `say /guardias` and the console command
`smak_guards` (RCON): each guard's mode, target, level, time since it saw him, position, waypoint.

**Offline.** `node levels/rp/npc-sim.mjs <map>.rp.json` prints the guards' waypoints (and where they came from), a full patrol round
per guard (units and seconds at `smak_npc_walk`) and the share of walkable nodes they reach: on patrol, in a hunt with every home door
locked, and with breach; it fails when a waypoint cannot be reached from another and warns when a breach still leaves nodes out.
On the 2026-11-06 build of smak_rp_byz01: 4 guards, 8 waypoints (nexus_booking and nexus_guard posts, the 3 gates' 6 sides), patrol
reaches 76 %, a hunt against locked homes 77 %, a breach 100 % but for 3 nodes (the cellar and the sewer).

**Only the game can say.** Speeds against a TS player (`smak_npc_run` 220 against a TS run of ~250 and its dives and rolls); whether
the eye-to-eye trace sees as a player does (glass, props, crouching); that `smak_door_breach`'s `by` may be an NPC entity; door
waits and the 5 s breach in front of a real door; guards stuck on the 42-unit landings (they use the civilians' unstick: slide when
unseen, another way when seen); the velocity scaling of a held player (TS may rebuild it each frame, and implants' maxspeed may fight
it); that a locked door seen from outside keeps the chase from looping (the guard searches around the nearest reachable node).

## Test checklist (Spanish, with smak_wanted)

1. `smak_guards` en la consola del servidor: 4 guardias, puestos y puertas de control, sin errores en el log `[smak_guard]`.
2. `smak_guard_debug 1`. Ve a la calle cerca de un guardia, `smak_wanted <tu nombre> 1`: el guardia te ve (HUD "Un guardia te vigila..."), te sigue andando y grita "Alto". Quedate quieto 3 s: se acerca y te arresta (multa cobrada, nivel 0).
3. Igual a 1 estrella pero corre lejos y escondete 6 s tras una esquina: deja de seguirte y vuelve a patrullar.
4. `smak_wanted <tu nombre> 2`: el guardia que te ve corre hacia ti y avisa a los demas (a menos de 2000 unidades). Al llegar te frena y te arresta a los 3 s; si disparas, el contador se reinicia.
5. A 2 estrellas, rompe la linea de vision y escondete. Ves "Te buscan...": van al ultimo sitio, rebuscan por los nodos cercanos 25 s y vuelven. Si ninguno te ve, bajas un nivel ("despistaste a los guardias"); nunca baja a 0 asi.
6. `smak_wanted <tu nombre> 3`: todos los guardias van al punto donde subiste a 3. Entra en una casa y cierrala con llave (smak_doors): el guardia espera 5 s ante la puerta ("Los guardias fuerzan la puerta") y la abre. Con `smak_wanted <tu nombre> 2` la misma puerta cerrada los detiene: la rodean y buscan fuera.
7. Pasa por los controles (puertas gate) con un guardia detras: las abre siempre. Un guardia no abre una puerta que ya esta abierta ni cierra las de tipo toggle.
8. Con un amigo no buscado delante de un guardia: no le pasa nada. Dentro de una arena de mision (smak_rp) con `smak_wanted 3`: no te persiguen.
9. `say /guardias` como admin: lista modo, objetivo, nivel y posicion de cada guardia. `smak_guard_count 0` y cambia de mapa: sin guardias.

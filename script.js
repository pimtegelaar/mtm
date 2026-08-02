  "use strict";

  function showLoadError() {
    document.getElementById("loading").style.display = "none";
    document.getElementById("hud").style.display = "none";
    document.getElementById("error-box").style.display = "grid";
  }

  function loadThreeBackup() {
    const backup = document.createElement("script");
    backup.src = "https://unpkg.com/three@0.152.2/build/three.min.js";
    backup.onload = bootGame;
    backup.onerror = showLoadError;
    document.head.appendChild(backup);
  }

  function bootGame() {
    if (!window.THREE || window.__monsterTruckMathStarted) return;
    window.__monsterTruckMathStarted = true;

    const canvas = document.getElementById("game-canvas");
    const loading = document.getElementById("loading");
    const equationEl = document.getElementById("equation");
    const feedbackEl = document.getElementById("feedback");
    const scoreEl = document.getElementById("score");
    const streakEl = document.getElementById("streak");
    const celebrationEl = document.getElementById("celebration");
    const stuntCaptionEl = document.getElementById("stunt-caption");
    const stuntStreakEl = document.getElementById("stunt-streak");
    const modeButtons = Array.from(document.querySelectorAll(".mode-button"));
    const answerButtons = [document.getElementById("answer-0"), document.getElementById("answer-1")];
    const soundButton = document.getElementById("sound-button");
    const fullscreenButton = document.getElementById("fullscreen-button");
    const restartButton = document.getElementById("restart-button");

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x8ed8ff);
    scene.fog = new THREE.Fog(0x9bdcff, 50, 110);

    const camera = new THREE.PerspectiveCamera(42, innerWidth / innerHeight, 0.1, 170);
    camera.position.set(11, 11, 16);
    camera.lookAt(0, 1.5, 0);

    let renderer;
    try {
      renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
    } catch (error) {
      console.error(error);
      showLoadError();
      return;
    }

    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.setSize(innerWidth, innerHeight, false);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.1;

    const hemi = new THREE.HemisphereLight(0xeaf8ff, 0xa46939, 2.15);
    scene.add(hemi);

    const sun = new THREE.DirectionalLight(0xfff1ce, 3.4);
    sun.position.set(-8, 16, 10);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1536, 1536);
    sun.shadow.camera.left = -18;
    sun.shadow.camera.right = 18;
    sun.shadow.camera.top = 18;
    sun.shadow.camera.bottom = -18;
    sun.shadow.camera.near = 1;
    sun.shadow.camera.far = 42;
    scene.add(sun);

    const arena = new THREE.Group();
    scene.add(arena);

    // Table-top ramps: a sloped front, a flat deck, then a sheer drop facing the other ramp.
    const STUNT_RAMP_Z = -9.2;
    const RAMP_INNER_X = 5.0;      // |x| of each deck's inner (launch/landing) edge
    const RAMP_DECK_LENGTH = 1.4;
    const RAMP_SLOPE_RUN = 5.0;
    const RAMP_WIDTH = 3.2;
    const RAMP_LAUNCH_HEIGHT = 1.9;
    const RAMP_TILT = Math.atan(RAMP_LAUNCH_HEIGHT / RAMP_SLOPE_RUN);
    const RAMP_SLOPE_START_X = RAMP_INNER_X + RAMP_DECK_LENGTH;           // |x| where the slope tops out
    const RAMP_FOOT_X = RAMP_SLOPE_START_X + RAMP_SLOPE_RUN;              // |x| where the slope meets the ground
    const STUNT_APEX_HEIGHT = 9.2;  // bezier control height for the jump arc

    const dirtMaterial = new THREE.MeshStandardMaterial({ color: 0xb87843, roughness: 1 });
    const ground = new THREE.Mesh(new THREE.CylinderGeometry(15, 15.8, 0.65, 72), dirtMaterial);
    ground.position.y = -0.35;
    ground.receiveShadow = true;
    arena.add(ground);

    const innerGround = new THREE.Mesh(
      new THREE.CylinderGeometry(12.7, 13.1, 0.12, 72),
      new THREE.MeshStandardMaterial({ color: 0xd99a56, roughness: 1 })
    );
    innerGround.position.y = 0.02;
    innerGround.receiveShadow = true;
    arena.add(innerGround);

    let crowdUpdate = null;   // set by createDecorations(); animates the stadium audience
    let crowdCheer = 0;       // 0 = calm sway, 1 = arms up and jumping; decays over time

    createTrackRing();
    createDecorations();

    const trucks = [];
    const activeAnimations = [];
    const dustPuffs = [];
    const confettiPieces = [];
    const activeStunts = [];
    const palette = [0xf04452, 0x2f88ff, 0xffbd2e, 0x39c87c, 0x9a63ff, 0xff6b2c, 0x00b8b0];

    function makeGridSlots(columns, rows, spacingX, spacingZ) {
      const slots = [];
      for (let row = 0; row < rows; row++) {
        for (let column = 0; column < columns; column++) {
          slots.push(new THREE.Vector3(
            (column - (columns - 1) / 2) * spacingX,
            0,
            (row - (rows - 1) / 2) * spacingZ
          ));
        }
      }
      // Fill from the centre outward so partially filled large fleets still look balanced.
      return slots.sort((a, b) => {
        const distanceDifference = a.lengthSq() - b.lengthSq();
        if (Math.abs(distanceDifference) > 0.001) return distanceDifference;
        if (a.z !== b.z) return a.z - b.z;
        return a.x - b.x;
      });
    }

    const EASY_PARKING_SLOTS = [
      new THREE.Vector3(-2.48, 0, 1.82),
      new THREE.Vector3( 2.48, 0, 1.82),
      new THREE.Vector3( 0.00, 0, -2.70),
      new THREE.Vector3(-4.79, 0, -2.70),
      new THREE.Vector3( 4.79, 0, -2.70)
    ];
    const HARD_PARKING_SLOTS = makeGridSlots(5, 4, 2.99, 2.33);
    const LARGE_PARKING_SLOTS = makeGridSlots(10, 5, 2.29, 1.89);
    const MODE_FLEET_CONFIG = {
      easy: { slots: EASY_PARKING_SLOTS, scale: 0.86, clearance: 2.85, maximum: 5 },
      hard: { slots: HARD_PARKING_SLOTS, scale: 0.68, clearance: 1.58, maximum: 20 },
      tens: { slots: LARGE_PARKING_SLOTS, scale: 0.49, clearance: 1.08, maximum: 50 },
      multiply: { slots: LARGE_PARKING_SLOTS, scale: 0.49, clearance: 1.08, maximum: 50 }
    };
    let PARKING_SLOTS = EASY_PARKING_SLOTS;
    let TRUCK_CLEARANCE = MODE_FLEET_CONFIG.easy.clearance;

    const MODE_INFO = {
      easy: {
        label: "Easy",
        tip: "Easy mode: additions drive in and subtractions drive away. Drag to rotate • scroll or pinch to zoom.",
        intro: "Easy mode — count the monster trucks!"
      },
      hard: {
        label: "Hard",
        tip: "Hard mode: the visible fleet and every answer can go up to 20. Drag to rotate • scroll or pinch to zoom.",
        intro: "Hard mode — numbers up to 20!"
      },
      tens: {
        label: "10×",
        tip: "10× mode: every number is literal — 50 means 50 visible trucks. Drag to rotate • scroll or pinch to zoom.",
        intro: "10× mode — count every truck, one by one!"
      },
      multiply: {
        label: "Multiply",
        tip: "Multiply mode: the correct product appears as a literal fleet of trucks. Drag to rotate • scroll or pinch to zoom.",
        intro: "Multiply mode — build multiplication power!"
      }
    };

    let gameMode = "easy";
    let currentQuestion = null;
    let score = 0;
    let streak = 0;
    let acceptingAnswer = false;
    let soundEnabled = true;
    let audioContext = null;
    let engineNoiseBuffer = null;
    const activeEngineVoices = new Set();
    let lastTime = performance.now();
    let elapsed = 0;
    let roundToken = 0;

    // Lightweight orbit controls kept inside this single-file game.
    // One pointer rotates, the mouse wheel zooms, and two touch pointers pinch-zoom.
    const orbitTarget = new THREE.Vector3(0, 1.35, 0);
    const orbitPointers = new Map();
    let orbitYaw = 0;
    let orbitPitch = 0.55;
    let orbitDistance = 22;
    let orbitPinchDistance = 0;
    let orbitInitialized = false;

    function orbitLimits() {
      if (gameMode === "easy") return { min: 7.5, max: 48 };
      if (gameMode === "hard") return { min: 10, max: 65 };
      return { min: 13, max: 85 };
    }

    function clampOrbit() {
      const limits = orbitLimits();
      orbitPitch = THREE.MathUtils.clamp(orbitPitch, 0.16, 1.38);
      orbitDistance = THREE.MathUtils.clamp(orbitDistance, limits.min, limits.max);
    }

    function syncOrbitFromCamera() {
      const offset = camera.position.clone().sub(orbitTarget);
      orbitDistance = Math.max(0.001, offset.length());
      orbitYaw = Math.atan2(offset.x, offset.z);
      orbitPitch = Math.asin(THREE.MathUtils.clamp(offset.y / orbitDistance, -1, 1));
      clampOrbit();
      orbitInitialized = true;
    }

    function applyOrbitCamera() {
      clampOrbit();
      const horizontalDistance = Math.cos(orbitPitch) * orbitDistance;
      camera.position.set(
        orbitTarget.x + Math.sin(orbitYaw) * horizontalDistance,
        orbitTarget.y + Math.sin(orbitPitch) * orbitDistance,
        orbitTarget.z + Math.cos(orbitYaw) * horizontalDistance
      );
      camera.lookAt(orbitTarget);

      // Keep the arena visible when the player zooms far out.
      scene.fog.near = Math.max(50, orbitDistance * 1.1);
      scene.fog.far = Math.max(110, orbitDistance * 3.3);
    }

    function pointerSeparation() {
      const points = Array.from(orbitPointers.values());
      if (points.length < 2) return 0;
      return Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y);
    }

    function beginCameraPointer(event) {
      if (event.pointerType === "mouse" && event.button !== 0) return;
      event.preventDefault();
      canvas.setPointerCapture?.(event.pointerId);
      orbitPointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (orbitPointers.size >= 2) orbitPinchDistance = pointerSeparation();
      canvas.classList.add("camera-dragging");
    }

    function moveCameraPointer(event) {
      const previous = orbitPointers.get(event.pointerId);
      if (!previous) return;
      event.preventDefault();

      if (orbitPointers.size === 1) {
        const deltaX = event.clientX - previous.x;
        const deltaY = event.clientY - previous.y;
        orbitYaw -= deltaX * 0.0062;
        orbitPitch += deltaY * 0.0052;
      }

      orbitPointers.set(event.pointerId, { x: event.clientX, y: event.clientY });

      if (orbitPointers.size >= 2) {
        const separation = pointerSeparation();
        if (orbitPinchDistance > 0 && separation > 0) {
          orbitDistance *= orbitPinchDistance / separation;
        }
        orbitPinchDistance = separation;
      }
      clampOrbit();
    }

    function endCameraPointer(event) {
      if (!orbitPointers.has(event.pointerId)) return;
      event.preventDefault();
      orbitPointers.delete(event.pointerId);
      orbitPinchDistance = orbitPointers.size >= 2 ? pointerSeparation() : 0;
      if (orbitPointers.size === 0) canvas.classList.remove("camera-dragging");
      try { canvas.releasePointerCapture?.(event.pointerId); } catch (_) {}
    }

    function zoomCamera(event) {
      event.preventDefault();
      const delta = event.deltaMode === 1 ? event.deltaY * 16 : event.deltaMode === 2 ? event.deltaY * innerHeight : event.deltaY;
      orbitDistance *= Math.exp(delta * 0.00125);
      clampOrbit();
    }

    function createTrackRing() {
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(10.9, 0.13, 8, 80),
        new THREE.MeshStandardMaterial({ color: 0xf9e4a3, roughness: 0.85 })
      );
      ring.rotation.x = Math.PI / 2;
      ring.position.y = 0.14;
      ring.receiveShadow = true;
      arena.add(ring);

      const stripeMaterial = new THREE.MeshStandardMaterial({ color: 0xfff2c4, roughness: 0.9 });
      for (let i = 0; i < 28; i++) {
        const a = (i / 28) * Math.PI * 2;
        const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.04, 0.9), stripeMaterial);
        stripe.position.set(Math.cos(a) * 10.9, 0.17, Math.sin(a) * 10.9);
        stripe.rotation.y = -a;
        stripe.receiveShadow = true;
        arena.add(stripe);
      }
    }

    // Ring of stepped stands packed with an instanced audience. Returns a per-frame update function.
    function createStadiumAudience() {
      const INNER = 19, TIER_DEPTH = 1.2, TIER_RISE = 0.8, TIERS = 6;
      const OUTER = INNER + TIERS * TIER_DEPTH;

      // Paved apron between the dirt arena and the stands.
      const apron = new THREE.Mesh(
        new THREE.RingGeometry(14.5, INNER + 0.2, 96),
        new THREE.MeshStandardMaterial({ color: 0x8a5a33, roughness: 1 })
      );
      apron.rotation.x = -Math.PI / 2;
      apron.position.y = -0.05;
      apron.receiveShadow = true;
      scene.add(apron);

      // Stepped concrete stands, lathed from a single stair-step profile.
      const profile = [new THREE.Vector2(INNER, -0.05)];
      for (let k = 0; k < TIERS; k++) {
        profile.push(
          new THREE.Vector2(INNER + k * TIER_DEPTH, (k + 1) * TIER_RISE),
          new THREE.Vector2(INNER + (k + 1) * TIER_DEPTH, (k + 1) * TIER_RISE)
        );
      }
      profile.push(new THREE.Vector2(OUTER, -0.05));
      const stands = new THREE.Mesh(
        new THREE.LatheGeometry(profile, 96),
        new THREE.MeshStandardMaterial({ color: 0x9aa3b0, roughness: 0.95, flatShading: true, side: THREE.DoubleSide })
      );
      stands.receiveShadow = true;
      scene.add(stands);

      // Colourful advertising board and rail along the front of the stands.
      const board = new THREE.Mesh(
        new THREE.CylinderGeometry(INNER - 0.1, INNER - 0.1, 0.7, 96, 1, true),
        new THREE.MeshStandardMaterial({ color: 0x2f88ff, roughness: 0.6, side: THREE.DoubleSide })
      );
      board.position.y = 0.3;
      scene.add(board);
      const rail = new THREE.Mesh(
        new THREE.TorusGeometry(INNER - 0.1, 0.06, 6, 96),
        new THREE.MeshStandardMaterial({ color: 0xf9e4a3, roughness: 0.6 })
      );
      rail.rotation.x = Math.PI / 2;
      rail.position.y = 0.66;
      scene.add(rail);

      // Place spectators on every tread (small deterministic RNG keeps the crowd stable between reloads).
      let seed = 20240607;
      const rand = () => {
        seed = (seed * 1664525 + 1013904223) >>> 0;
        return seed / 4294967296;
      };
      const people = [];
      for (let k = 0; k < TIERS; k++) {
        const radius = INNER + (k + 0.5) * TIER_DEPTH;
        const count = Math.floor((Math.PI * 2 * radius) / 0.72);
        for (let i = 0; i < count; i++) {
          if (rand() < 0.08) continue; // the odd empty seat
          const angle = ((i + rand() * 0.4) / count) * Math.PI * 2;
          people.push({
            x: Math.cos(angle) * radius,
            y: (k + 1) * TIER_RISE,
            z: Math.sin(angle) * radius,
            yaw: Math.atan2(-Math.cos(angle), -Math.sin(angle)), // face the arena
            phase: rand() * Math.PI * 2,
            speed: 3 + rand() * 3,
            scale: 0.88 + rand() * 0.26
          });
        }
      }

      const total = people.length;
      const shirtColors = [0xf04452, 0x2f88ff, 0xffbd2e, 0x39c87c, 0x9a63ff, 0xff6b2c, 0x00b8b0, 0xffffff, 0x17263c];
      const skinColors = [0xf5cfa6, 0xe3a878, 0xc68642, 0x8d5524, 0x5c3a21];

      const bodyGeometry = new THREE.BoxGeometry(0.42, 0.5, 0.28);
      bodyGeometry.translate(0, 0.25, 0);
      const headGeometry = new THREE.SphereGeometry(0.17, 10, 8);
      headGeometry.translate(0, 0.69, 0);
      const armGeometry = new THREE.BoxGeometry(0.1, 0.4, 0.1);
      armGeometry.translate(0, 0.2, 0); // pivots at the shoulder

      const bodies = new THREE.InstancedMesh(bodyGeometry, new THREE.MeshStandardMaterial({ roughness: 0.8 }), total);
      const heads = new THREE.InstancedMesh(headGeometry, new THREE.MeshStandardMaterial({ roughness: 0.7 }), total);
      const arms = new THREE.InstancedMesh(armGeometry, new THREE.MeshStandardMaterial({ roughness: 0.7 }), total * 2);
      const color = new THREE.Color();
      people.forEach((person, i) => {
        person.skin = skinColors[Math.floor(rand() * skinColors.length)];
        bodies.setColorAt(i, color.setHex(shirtColors[Math.floor(rand() * shirtColors.length)]));
        heads.setColorAt(i, color.setHex(person.skin));
        arms.setColorAt(i * 2, color.setHex(person.skin));
        arms.setColorAt(i * 2 + 1, color.setHex(person.skin));
      });
      [bodies, heads, arms].forEach((mesh) => {
        mesh.instanceColor.needsUpdate = true;
        mesh.frustumCulled = false;
        scene.add(mesh);
      });

      const personMatrix = new THREE.Matrix4();
      const armMatrix = new THREE.Matrix4();
      const finalMatrix = new THREE.Matrix4();
      const dummy = new THREE.Object3D();
      const scaleVector = new THREE.Vector3();

      return function updateCrowd(time, cheer) {
        const hop = 0.03 + cheer * 0.3;
        const raise = Math.min(1, cheer * 1.4);
        for (let i = 0; i < total; i++) {
          const person = people[i];
          const bounce = Math.abs(Math.sin(time * person.speed * (1 + cheer) + person.phase)) * hop;
          dummy.position.set(person.x, person.y + bounce, person.z);
          dummy.rotation.set(0, person.yaw, 0);
          scaleVector.setScalar(person.scale);
          dummy.scale.copy(scaleVector);
          dummy.updateMatrix();
          personMatrix.copy(dummy.matrix);
          bodies.setMatrixAt(i, personMatrix);
          heads.setMatrixAt(i, personMatrix);

          // Arms hang at the sides and swing up overhead when the crowd cheers.
          const sweep = Math.PI + 0.2 + raise * (Math.PI - 0.55) + Math.sin(time * 9 + person.phase) * 0.18 * raise;
          [-1, 1].forEach((side, s) => {
            dummy.position.set(side * 0.26, 0.45, 0);
            dummy.rotation.set(0, 0, side * sweep);
            dummy.scale.set(1, 1, 1);
            dummy.updateMatrix();
            armMatrix.copy(dummy.matrix);
            finalMatrix.multiplyMatrices(personMatrix, armMatrix);
            arms.setMatrixAt(i * 2 + s, finalMatrix);
          });
        }
        bodies.instanceMatrix.needsUpdate = true;
        heads.instanceMatrix.needsUpdate = true;
        arms.instanceMatrix.needsUpdate = true;
      };
    }

    function createDecorations() {
      crowdUpdate = createStadiumAudience();

      for (let i = 0; i < 14; i++) {
        const a = (i / 14) * Math.PI * 2 + 0.18;
        const cone = new THREE.Group();
        const base = new THREE.Mesh(
          new THREE.CylinderGeometry(0.34, 0.46, 0.12, 12),
          new THREE.MeshStandardMaterial({ color: 0xfff3d8, roughness: 0.8 })
        );
        const top = new THREE.Mesh(
          new THREE.ConeGeometry(0.25, 0.72, 12),
          new THREE.MeshStandardMaterial({ color: i % 2 ? 0xff6b37 : 0xffd43d, roughness: 0.75 })
        );
        base.position.y = 0.09;
        top.position.y = 0.48;
        base.castShadow = top.castShadow = true;
        cone.add(base, top);
        cone.position.set(Math.cos(a) * 12.2, 0.05, Math.sin(a) * 12.2);
        arena.add(cone);
      }

      [-1, 1].forEach((side) => arena.add(createArenaRamp(side)));

      // Permanent row of car wrecks between the two ramps.
      const wreckColors = [0x3f7fd1, 0xd8483c, 0xe2b83a, 0x58b36a];
      const wreckSpacing = 2.4;
      const wreckCount = 4;
      for (let i = 0; i < wreckCount; i++) {
        const car = createWreckCar(wreckColors[i % wreckColors.length], i % 3);
        car.position.set((i - (wreckCount - 1) / 2) * wreckSpacing, 0.06, STUNT_RAMP_Z);
        car.rotation.y = (i % 2 ? 1 : -1) * 0.07;
        arena.add(car);
      }

      const flagColors = [0xf24450, 0xffd339, 0x3d8ef7, 0x4dd18a];
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
        const pole = new THREE.Mesh(
          new THREE.CylinderGeometry(0.05, 0.07, 3.4, 8),
          new THREE.MeshStandardMaterial({ color: 0xe9edf2, metalness: 0.45, roughness: 0.55 })
        );
        pole.position.set(Math.cos(a) * 14, 1.7, Math.sin(a) * 14);
        pole.castShadow = true;
        arena.add(pole);

        const flag = new THREE.Mesh(
          new THREE.PlaneGeometry(1.1, 0.65),
          new THREE.MeshStandardMaterial({ color: flagColors[i % flagColors.length], side: THREE.DoubleSide, roughness: 0.7 })
        );
        flag.position.copy(pole.position);
        flag.position.y += 1.25;
        flag.rotation.y = -a + Math.PI / 2;
        flag.translateX(0.55);
        arena.add(flag);
      }
    }

    function makeBox(size, material, position, parent, bevelLikeScale) {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(size[0], size[1], size[2]), material);
      mesh.position.set(position[0], position[1], position[2]);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      if (bevelLikeScale) mesh.scale.set(1, bevelLikeScale, 1);
      parent.add(mesh);
      return mesh;
    }

    function makeTube(start, end, radius, material, parent, radialSegments = 8) {
      const a = new THREE.Vector3(start[0], start[1], start[2]);
      const b = new THREE.Vector3(end[0], end[1], end[2]);
      const direction = new THREE.Vector3().subVectors(b, a);
      const tube = new THREE.Mesh(
        new THREE.CylinderGeometry(radius, radius, direction.length(), radialSegments),
        material
      );
      tube.position.copy(a).add(b).multiplyScalar(0.5);
      tube.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.clone().normalize());
      tube.castShadow = true;
      tube.receiveShadow = true;
      parent.add(tube);
      return tube;
    }

    function makeWedge(length, height, width, frontHeight, material, position, parent) {
      const halfL = length / 2;
      const halfW = width / 2;
      const vertices = new Float32Array([
        -halfL, 0, -halfW,   halfL, 0, -halfW,   halfL, 0, halfW,   -halfL, 0, halfW,
        -halfL, height, -halfW,   halfL, frontHeight, -halfW,   halfL, frontHeight, halfW,   -halfL, height, halfW
      ]);
      const indices = [
        0, 1, 2, 0, 2, 3,
        4, 6, 5, 4, 7, 6,
        0, 4, 5, 0, 5, 1,
        1, 5, 6, 1, 6, 2,
        2, 6, 7, 2, 7, 3,
        3, 7, 4, 3, 4, 0
      ];
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute("position", new THREE.BufferAttribute(vertices, 3));
      geometry.setIndex(indices);
      geometry.computeVertexNormals();
      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.set(position[0], position[1], position[2]);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      parent.add(mesh);
      return mesh;
    }

    // Builds one stadium ramp. Local +x points away from the arena centre; the deck's
    // inner edge sits at x = 0 and the group is then moved/rotated into place.
    function createArenaRamp(side) {
      const ramp = new THREE.Group();
      const H = RAMP_LAUNCH_HEIGHT;
      const W = RAMP_WIDTH;
      const dirt = new THREE.MeshStandardMaterial({ color: 0x9a6a3e, roughness: 1, flatShading: true });

      makeWedge(RAMP_SLOPE_RUN, H, W, 0.04, dirt, [RAMP_DECK_LENGTH + RAMP_SLOPE_RUN / 2, 0, 0], ramp);
      makeBox([RAMP_DECK_LENGTH, H, W], dirt, [RAMP_DECK_LENGTH / 2, H / 2, 0], ramp);

      ramp.position.set(side * RAMP_INNER_X, 0.06, STUNT_RAMP_Z);
      ramp.rotation.y = side > 0 ? 0 : Math.PI;
      return ramp;
    }

    // A crushed, rusty car wreck for the monster truck to fly over. Local +x is the nose.
    function createWreckCar(color, variant) {
      const car = new THREE.Group();
      const body = new THREE.Group();
      car.add(body);
      const paint = new THREE.MeshStandardMaterial({ color, roughness: 0.55, metalness: 0.35 });
      const rust = new THREE.MeshStandardMaterial({ color: 0x7a4a2c, roughness: 0.9 });
      const glass = new THREE.MeshStandardMaterial({ color: 0x1b2a35, roughness: 0.2, metalness: 0.3 });
      const tireMat = new THREE.MeshStandardMaterial({ color: 0x121317, roughness: 1 });

      makeBox([2.3, 0.5, 1.2], paint, [0, 0.55, 0], body);
      const hood = makeBox([0.8, 0.14, 1.12], paint, [0.75, 0.86, 0], body);
      hood.rotation.z = -0.16 + variant * 0.06;
      const trunk = makeBox([0.55, 0.12, 1.1], rust, [-0.95, 0.85, 0], body);
      trunk.rotation.z = 0.12;
      const cabin = makeBox([1.05, 0.34, 1.08], paint, [-0.2, 0.98, 0], body); // flattened, crushed roof
      cabin.rotation.z = (variant % 2 ? 0.07 : -0.05);
      cabin.rotation.x = (variant % 2 ? -0.06 : 0.05);
      [-1, 1].forEach((z) => makeBox([0.8, 0.2, 0.03], glass, [-0.2, 1.0, z * 0.55], body));
      makeBox([0.04, 0.2, 0.9], glass, [0.28, 1.0, 0], body).rotation.z = 0.5;
      makeBox([0.12, 0.2, 1.24], rust, [1.18, 0.5, 0], body); // bumpers
      makeBox([0.12, 0.2, 1.24], rust, [-1.18, 0.5, 0], body);

      [[0.8, 0.62], [0.8, -0.62], [-0.8, 0.62], [-0.8, -0.62]].forEach(([x, z], i) => {
        if ((i + variant) % 4 === 3) return; // one wheel missing
        const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.24, 14), tireMat);
        wheel.rotation.x = Math.PI / 2 + ((i + variant) % 3 === 0 ? 0.25 : 0);
        wheel.position.set(x, 0.3, z);
        wheel.castShadow = true;
        body.add(wheel);
      });

      if (variant === 1) { // flipped onto its roof
        body.rotation.z = Math.PI;
        body.position.y = 1.35;
      } else if (variant === 2) { // resting on its side
        body.rotation.x = 1.25;
        body.position.set(0, 0.62, 0.1);
      }
      car.traverse((child) => {
        if (child.isMesh) {
          child.castShadow = true;
          child.receiveShadow = true;
        }
      });
      return car;
    }

    function makeTruckMaterials(color, index) {
      const baseColor = new THREE.Color(color);
      const paint = new THREE.MeshStandardMaterial({ color: baseColor, roughness: 0.3, metalness: 0.34 });
      const darkPaint = new THREE.MeshStandardMaterial({ color: baseColor.clone().multiplyScalar(0.45), roughness: 0.48, metalness: 0.2 });
      const accentColor = new THREE.Color().setHSL((baseColor.getHSL({ h: 0, s: 0, l: 0 }).h + 0.46) % 1, 0.82, 0.58);
      const accent = new THREE.MeshStandardMaterial({ color: accentColor, roughness: 0.38, metalness: 0.28 });
      const tireMat = new THREE.MeshStandardMaterial({ color: 0x111319, roughness: 0.98, metalness: 0.02 });
      const treadMat = new THREE.MeshStandardMaterial({ color: 0x090b0f, roughness: 1 });
      const frameMat = new THREE.MeshStandardMaterial({ color: index % 2 ? 0x4de17f : 0xb8c4ce, roughness: 0.38, metalness: 0.72 });
      const metal = new THREE.MeshStandardMaterial({ color: 0xc8d1d8, roughness: 0.26, metalness: 0.86 });
      const darkMetal = new THREE.MeshStandardMaterial({ color: 0x303944, roughness: 0.42, metalness: 0.75 });
      const glass = new THREE.MeshStandardMaterial({ color: 0x5eb9df, roughness: 0.12, metalness: 0.18 });
      const light = new THREE.MeshStandardMaterial({ color: 0xfff3aa, emissive: 0xffb42c, emissiveIntensity: 1.7, roughness: 0.26 });
      const redLight = new THREE.MeshStandardMaterial({ color: 0xff4148, emissive: 0xa50008, emissiveIntensity: 1.2, roughness: 0.3 });
      const springMat = new THREE.MeshStandardMaterial({ color: 0xffd52f, roughness: 0.35, metalness: 0.6 });
      const white = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.42, metalness: 0.08 });
      const cabGlass = new THREE.MeshStandardMaterial({ color: 0x8fd0ea, roughness: 0.1, metalness: 0.1, transparent: true, opacity: 0.5, depthWrite: false });
      const interior = new THREE.MeshStandardMaterial({ color: 0x23272e, roughness: 0.8 });
      const helmetMat = new THREE.MeshStandardMaterial({ color: 0xf4f4f4, roughness: 0.3 });
      tireMat.side = THREE.DoubleSide;
      return { paint, darkPaint, accent, tireMat, treadMat, frameMat, metal, darkMetal, glass, light, redLight, springMat, white, cabGlass, interior, helmetMat };
    }

    // Builds the full truck once per variant; it is then baked into shared merged geometry.
    function buildTruckSource(index, M) {
      const suspension = new THREE.Group();

      const { paint, darkPaint, accent, tireMat, treadMat, frameMat, metal, darkMetal, glass, light, redLight, springMat, white, cabGlass, interior, helmetMat } = M;

      // Proportions follow a real stadium monster truck: huge tires, a pickup body perched
      // high on a tube chassis, solid axles, and tall coilover shocks.
      suspension.scale.setScalar(0.88);

      const wheelRadius = 0.95;
      const wheelWidth = 0.78;
      const wheelY = wheelRadius;
      const wheelX = 1.3;
      const wheelZ = 1.15;
      const wheels = [];
      const chassisY = 1.25;

      function createWheel(x, z) {
        const wheel = new THREE.Group();
        wheel.position.set(x, wheelY, z);

        // Tire carcass: a lathed profile with a flat tread face and bulging sidewalls.
        tireMat.side = THREE.DoubleSide;
        const hw = wheelWidth / 2;
        const profile = [
          [0.46, -hw + 0.01], [0.6, -hw], [0.78, -hw + 0.02], [0.9, -hw + 0.07],
          [0.945, -hw + 0.16], [wheelRadius, -hw + 0.24], [wheelRadius, hw - 0.24],
          [0.945, hw - 0.16], [0.9, hw - 0.07], [0.78, hw - 0.02], [0.6, hw], [0.46, hw - 0.01]
        ].map(([r, y]) => new THREE.Vector2(r, y));
        const tire = new THREE.Mesh(new THREE.LatheGeometry(profile, 40), tireMat);
        tire.rotation.x = Math.PI / 2;
        wheel.add(tire);

        // Raised concentric ribs on both sidewalls.
        [-1, 1].forEach((side) => {
          [[0.58, 0.035], [0.72, 0.025], [0.85, 0.03]].forEach(([radius, tube]) => {
            const ring = new THREE.Mesh(new THREE.TorusGeometry(radius, tube, 4, 28), treadMat);
            ring.position.z = side * (hw + 0.005 - (radius > 0.8 ? 0.04 : 0));
            wheel.add(ring);
          });
        });

        // Deep staggered chevron lugs across the tread, plus shoulder lugs that wrap the sidewall.
        const lugCount = 22;
        const lugMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(0.28, 0.16, 0.3), treadMat, lugCount * 4);
        const lugDummy = new THREE.Object3D();
        let lugIndex = 0;
        for (let i = 0; i < lugCount; i++) {
          const angle = (i / lugCount) * Math.PI * 2;
          const stagger = (Math.PI * 2 / lugCount) * 0.5;
          [-1, 1].forEach((side) => {
            // Tread-face lug, angled into a chevron.
            const a1 = angle + (side > 0 ? stagger : 0);
            lugDummy.position.set(Math.cos(a1) * (wheelRadius + 0.05), Math.sin(a1) * (wheelRadius + 0.05), side * 0.17);
            lugDummy.rotation.set(0, side * 0.4, a1);
            lugDummy.scale.set(1, 1, 1);
            lugDummy.updateMatrix();
            lugMesh.setMatrixAt(lugIndex++, lugDummy.matrix);

            // Shoulder lug.
            const a2 = angle + (side > 0 ? 0 : stagger);
            lugDummy.position.set(Math.cos(a2) * (wheelRadius - 0.04), Math.sin(a2) * (wheelRadius - 0.04), side * (hw - 0.08));
            lugDummy.rotation.set(0, 0, a2);
            lugDummy.scale.set(0.8, 0.9, 0.55);
            lugDummy.updateMatrix();
            lugMesh.setMatrixAt(lugIndex++, lugDummy.matrix);
          });
        }
        lugMesh.instanceMatrix.needsUpdate = true;
        wheel.add(lugMesh);

        // Silver beadlock rim with a ring of bolts and a dark hub.
        const boltPerSide = 16;
        const bolts = new THREE.InstancedMesh(new THREE.SphereGeometry(0.03, 5, 3), springMat, boltPerSide * 2);
        const boltDummy = new THREE.Object3D();
        let boltIndex = 0;
        [-1, 1].forEach((side) => {
          const rim = new THREE.Mesh(new THREE.CylinderGeometry(0.52, 0.52, 0.05, 32), metal);
          rim.rotation.x = Math.PI / 2;
          rim.position.z = side * (hw + 0.01);
          wheel.add(rim);

          const lip = new THREE.Mesh(new THREE.TorusGeometry(0.52, 0.04, 5, 28), metal);
          lip.position.z = side * (hw + 0.03);
          wheel.add(lip);

          const dish = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.05, 24), white);
          dish.rotation.x = Math.PI / 2;
          dish.position.z = side * (hw + 0.04);
          wheel.add(dish);

          const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 0.08, 18), darkMetal);
          hub.rotation.x = Math.PI / 2;
          hub.position.z = side * (hw + 0.07);
          wheel.add(hub);

          for (let bolt = 0; bolt < boltPerSide; bolt++) {
            const a = bolt / boltPerSide * Math.PI * 2;
            boltDummy.position.set(Math.cos(a) * 0.46, Math.sin(a) * 0.46, side * (hw + 0.045));
            boltDummy.rotation.set(0, 0, 0);
            boltDummy.updateMatrix();
            bolts.setMatrixAt(boltIndex++, boltDummy.matrix);
          }
        });
        bolts.instanceMatrix.needsUpdate = true;
        wheel.add(bolts);
        suspension.add(wheel);
        wheels.push(wheel);
        return wheel;
      }

      // Tube chassis with upswept front and rear rails.
      [-0.45, 0.45].forEach((z) => {
        makeTube([-1.7, chassisY, z], [1.7, chassisY, z], 0.09, frameMat, suspension);
        makeTube([1.7, chassisY, z], [2.1, chassisY + 0.2, z], 0.08, frameMat, suspension);
        makeTube([-1.7, chassisY, z], [-2.05, chassisY + 0.2, z], 0.08, frameMat, suspension);
      });
      [-1.3, -0.4, 0.5, 1.3].forEach((x) => {
        makeTube([x, chassisY, -0.45], [x, chassisY, 0.45], 0.07, frameMat, suspension);
      });

      [-wheelX, wheelX].forEach((x) => {
        [-wheelZ, wheelZ].forEach((z) => createWheel(x, z));

        // Solid axle with a pumpkin differential.
        makeTube([x, wheelY, -wheelZ], [x, wheelY, wheelZ], 0.12, darkMetal, suspension, 12);
        const differential = new THREE.Mesh(new THREE.SphereGeometry(0.24, 14, 10), darkMetal);
        differential.position.set(x, wheelY, 0);
        suspension.add(differential);

        [-1, 1].forEach((side) => {
          // Four-link bars to the chassis.
          makeTube([x, wheelY + 0.05, side * 0.4], [x * 0.55, chassisY, side * 0.45], 0.05, frameMat, suspension);
          makeTube([x, wheelY + 0.3, side * 0.15], [x * 0.5, chassisY + 0.05, side * 0.2], 0.045, darkMetal, suspension);

          // Tall coilover shock with visible coils.
          const bottom = [x, wheelY + 0.1, side * 0.7];
          const top = [x * 0.82, 2.05, side * 0.7];
          makeTube(bottom, top, 0.06, darkMetal, suspension, 10);
          for (let ring = 0; ring < 7; ring++) {
            const p = 0.12 + ring * 0.12;
            const coil = new THREE.Mesh(new THREE.TorusGeometry(0.12, 0.022, 4, 10), springMat);
            coil.rotation.x = Math.PI / 2;
            coil.position.set(
              bottom[0] + (top[0] - bottom[0]) * p,
              bottom[1] + (top[1] - bottom[1]) * p,
              bottom[2]
            );
            suspension.add(coil);
          }
        });
      });

      // Pickup body, mounted high so the tires tower beside it.
      makeBox([3.6, 0.2, 1.2], darkPaint, [0, 1.5, 0], suspension);                        // underbody
      makeBox([1.15, 0.75, 1.3], paint, [0.075, 1.925, 0], suspension);                    // lower cab
      makeWedge(1.3, 0.75, 1.3, 0.5, paint, [1.15, 1.55, 0], suspension);                  // sloped hood
      makeBox([0.5, 0.14, 0.6], darkPaint, [1.2, 2.2, 0], suspension);                     // hood scoop
      makeBox([1.3, 0.12, 1.3], darkPaint, [-1.15, 1.61, 0], suspension);                  // bed floor
      [-1, 1].forEach((side) => {
        makeBox([1.3, 0.55, 0.08], paint, [-1.15, 1.945, side * 0.61], suspension);        // bed walls
      });
      makeBox([0.08, 0.55, 1.3], paint, [-1.8, 1.945, 0], suspension);                     // tailgate

      // Glass cab with a driver inside.
      makeBox([0.85, 0.55, 1.18], cabGlass, [0, 2.575, 0], suspension);
      makeBox([0.95, 0.07, 1.24], paint, [-0.02, 2.88, 0], suspension);                    // roof
      [-1, 1].forEach((side) => {
        makeTube([0.4, 2.3, side * 0.58], [0.28, 2.85, side * 0.58], 0.04, paint, suspension);
        makeTube([-0.42, 2.3, side * 0.58], [-0.42, 2.85, side * 0.58], 0.04, paint, suspension);
      });
      makeBox([0.35, 0.45, 0.55], interior, [-0.2, 2.5, 0.0], suspension);                 // seat
      const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.17, 14, 10), helmetMat);
      helmet.position.set(-0.05, 2.62, 0.3);
      suspension.add(helmet);

      // Grille, headlights, tail lights, tubular bumpers.
      makeBox([0.06, 0.4, 1.15], darkMetal, [1.82, 1.78, 0], suspension);
      [-0.45, 0.45].forEach((z) => {
        const lamp = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.07, 18), light);
        lamp.rotation.z = Math.PI / 2;
        lamp.position.set(1.84, 1.9, z);
        suspension.add(lamp);

        const tail = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.06, 14), redLight);
        tail.rotation.z = Math.PI / 2;
        tail.position.set(-1.84, 1.95, z);
        suspension.add(tail);
      });
      makeTube([2.12, 1.45, -0.7], [2.12, 1.45, 0.7], 0.08, frameMat, suspension);
      makeTube([-2.07, 1.45, -0.7], [-2.07, 1.45, 0.7], 0.08, frameMat, suspension);
      [-1, 1].forEach((side) => {
        makeTube([2.1, 1.45, side * 0.7], [1.75, 1.3, side * 0.45], 0.06, frameMat, suspension);
        makeTube([-2.05, 1.45, side * 0.7], [-1.7, 1.3, side * 0.45], 0.06, frameMat, suspension);
      });

      // Side graphic and number badge.
      [-1, 1].forEach((side) => {
        const slash = makeBox([2.4, 0.13, 0.02], accent, [-0.3, 1.7, side * 0.655], suspension);
        slash.rotation.z = 0.03;
      });

      // Three silhouette variants.
      const style = index % 3;
      if (style === 0) {
        // Toothy hood edge and a dorsal fin on the bed.
        [-1, 1].forEach((side) => {
          for (let k = 0; k < 6; k++) {
            const tooth = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.22, 6), white);
            tooth.rotation.z = Math.PI;
            tooth.position.set(0.7 + k * 0.2, 1.46, side * 0.66);
            suspension.add(tooth);
          }
        });
        const fin = new THREE.Mesh(new THREE.ConeGeometry(0.25, 0.8, 4), accent);
        fin.scale.set(0.25, 1, 1.4);
        fin.position.set(-1.2, 2.6, 0);
        suspension.add(fin);
      } else if (style === 1) {
        // Chrome exhaust stacks behind the cab.
        [-1, 1].forEach((side) => {
          makeTube([-0.68, 2.2, side * 0.42], [-0.68, 3.35, side * 0.42], 0.075, metal, suspension, 10);
          const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.075, 0.12, 10), metal);
          cap.position.set(-0.68, 3.38, side * 0.42);
          suspension.add(cap);
        });
      } else {
        // Rear wing and roof light bar.
        [-1, 1].forEach((side) => makeTube([-1.7, 2.2, side * 0.5], [-1.7, 2.8, side * 0.5], 0.05, frameMat, suspension));
        makeBox([0.55, 0.06, 1.5], accent, [-1.7, 2.82, 0], suspension);
        makeBox([0.14, 0.1, 0.9], light, [0.05, 2.98, 0], suspension);
      }

      return { suspension, wheels };
    }

    // ---- Shared, baked truck geometry --------------------------------------------------
    // Every truck of the same variant shares the same merged geometry and (per colour) the same
    // materials, so a truck costs ~35 draw calls instead of ~300 separate meshes.
    function mergeBakedGeometries(list) {
      let total = 0;
      list.forEach((g) => { total += g.attributes.position.count; });
      const position = new Float32Array(total * 3);
      const normal = new Float32Array(total * 3);
      const uv = new Float32Array(total * 2);
      let offset = 0;
      list.forEach((g) => {
        position.set(g.attributes.position.array, offset * 3);
        normal.set(g.attributes.normal.array, offset * 3);
        uv.set(g.attributes.uv.array, offset * 2);
        offset += g.attributes.position.count;
        g.dispose();
      });
      const merged = new THREE.BufferGeometry();
      merged.setAttribute("position", new THREE.BufferAttribute(position, 3));
      merged.setAttribute("normal", new THREE.BufferAttribute(normal, 3));
      merged.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
      merged.computeBoundingSphere();
      merged.computeBoundingBox();
      return merged;
    }

    // Bakes every mesh under `root` (instanced meshes expanded) into one geometry per material role,
    // expressed in `root` local space.
    function bakeGroup(root, roleByMaterial, skip) {
      root.updateMatrixWorld(true);
      const inverse = root.matrixWorld.clone().invert();
      const lists = new Map();
      const rel = new THREE.Matrix4();
      const instanceMatrix = new THREE.Matrix4();
      const combined = new THREE.Matrix4();

      const visit = (object) => {
        if (skip && skip(object)) return;
        if (object.isMesh && roleByMaterial.has(object.material)) {
          const role = roleByMaterial.get(object.material);
          if (!lists.has(role)) lists.set(role, []);
          const list = lists.get(role);
          const base = object.geometry.index ? object.geometry.toNonIndexed() : object.geometry.clone();
          if (!base.attributes.normal) base.computeVertexNormals();
          if (!base.attributes.uv) {
            base.setAttribute("uv", new THREE.BufferAttribute(new Float32Array(base.attributes.position.count * 2), 2));
          }
          rel.multiplyMatrices(inverse, object.matrixWorld);
          if (object.isInstancedMesh) {
            for (let i = 0; i < object.count; i++) {
              object.getMatrixAt(i, instanceMatrix);
              combined.multiplyMatrices(rel, instanceMatrix);
              list.push(base.clone().applyMatrix4(combined));
            }
            base.dispose();
          } else {
            list.push(base.applyMatrix4(rel));
          }
        }
        object.children.forEach(visit);
      };
      visit(root);
      return Array.from(lists, ([role, geometries]) => ({ role, geometry: mergeBakedGeometries(geometries) }));
    }

    const truckPrototypes = new Map();
    function getTruckPrototype(index) {
      const key = index % 6; // style (index % 3) and frame colour (index % 2) repeat every 6
      if (truckPrototypes.has(key)) return truckPrototypes.get(key);

      const M = makeTruckMaterials(0xffffff, key);
      const source = buildTruckSource(key, M);
      const roleByMaterial = new Map(Object.entries(M).map(([role, material]) => [material, role]));
      const wheelSet = new Set(source.wheels);
      source.suspension.updateMatrixWorld(true);

      const prototype = {
        bodyParts: bakeGroup(source.suspension, roleByMaterial, (object) => wheelSet.has(object)),
        wheelParts: bakeGroup(source.wheels[0], roleByMaterial, null),
        wheelPositions: source.wheels.map((wheel) => wheel.position.clone())
      };

      // Release the throwaway source meshes and materials; only the baked geometry lives on.
      source.suspension.traverse((child) => {
        if (child.geometry) child.geometry.dispose();
      });
      Object.values(M).forEach((material) => material.dispose());
      truckPrototypes.set(key, prototype);
      return prototype;
    }

    const truckMaterialCache = new Map();
    function getTruckMaterials(color, index) {
      const key = `${color}-${index % 2}`;
      if (!truckMaterialCache.has(key)) truckMaterialCache.set(key, makeTruckMaterials(color, index));
      return truckMaterialCache.get(key);
    }

    const badgeGeometry = new THREE.CircleGeometry(0.26, 28);
    const badgeMaterialCache = new Map();
    function getBadgeMaterial(number) {
      if (badgeMaterialCache.has(number)) return badgeMaterialCache.get(number);
      const numberCanvas = document.createElement("canvas");
      numberCanvas.width = 128;
      numberCanvas.height = 128;
      const context = numberCanvas.getContext("2d");
      context.fillStyle = "#ffffff";
      context.beginPath();
      context.arc(64, 64, 53, 0, Math.PI * 2);
      context.fill();
      context.lineWidth = 10;
      context.strokeStyle = "#17263c";
      context.stroke();
      context.fillStyle = "#17263c";
      context.font = "900 68px Arial";
      context.textAlign = "center";
      context.textBaseline = "middle";
      context.fillText(String(number), 64, 68);
      const texture = new THREE.CanvasTexture(numberCanvas);
      texture.colorSpace = THREE.SRGBColorSpace;
      const material = new THREE.MeshBasicMaterial({ map: texture, transparent: true, side: THREE.DoubleSide });
      badgeMaterialCache.set(number, material);
      return material;
    }

    function createMonsterTruck(color, index) {
      const prototype = getTruckPrototype(index);
      const M = getTruckMaterials(color, index);
      const truck = new THREE.Group();
      const suspension = new THREE.Group();
      suspension.scale.setScalar(0.88);
      truck.add(suspension);

      const addParts = (parent, parts) => {
        parts.forEach(({ role, geometry }) => {
          const mesh = new THREE.Mesh(geometry, M[role]);
          mesh.castShadow = true;
          mesh.receiveShadow = true;
          parent.add(mesh);
        });
      };
      addParts(suspension, prototype.bodyParts);

      const wheels = prototype.wheelPositions.map((position) => {
        const wheel = new THREE.Group();
        wheel.position.copy(position);
        addParts(wheel, prototype.wheelParts);
        suspension.add(wheel);
        return wheel;
      });

      const badgeMaterial = getBadgeMaterial((index % 9) + 1);
      [-1, 1].forEach((side) => {
        const badge = new THREE.Mesh(badgeGeometry, badgeMaterial);
        badge.position.set(0.05, 2.0, side * 0.662);
        badge.rotation.y = side < 0 ? Math.PI : 0;
        suspension.add(badge);
      });

      truck.scale.setScalar(0.86);
      truck.userData = {
        wheels,
        suspension,
        speed: 0,
        bobSeed: Math.random() * Math.PI * 2,
        leaving: false,
        entering: false,
        parked: true,
        slotIndex: -1
      };
      return truck;
    }

    function createTruckForCurrentMode(color, index) {
      const profile = MODE_FLEET_CONFIG[gameMode];
      const truck = createMonsterTruck(color, index);
      truck.scale.setScalar(profile.scale);
      return truck;
    }

    function fleetPositions(count) {
      return PARKING_SLOTS.slice(0, count).map((position) => position.clone());
    }

    function buildMotionPath(points) {
      const lengths = [];
      let totalLength = 0;
      for (let i = 0; i < points.length - 1; i++) {
        const length = points[i].distanceTo(points[i + 1]);
        lengths.push(length);
        totalLength += length;
      }
      return { points, lengths, totalLength };
    }

    function sampleMotionPath(path, progress) {
      const distance = THREE.MathUtils.clamp(progress, 0, 1) * path.totalLength;
      let travelled = 0;
      for (let i = 0; i < path.lengths.length; i++) {
        const segmentLength = path.lengths[i];
        if (distance <= travelled + segmentLength || i === path.lengths.length - 1) {
          const segmentProgress = segmentLength > 0 ? (distance - travelled) / segmentLength : 0;
          const from = path.points[i];
          const to = path.points[i + 1];
          return {
            position: new THREE.Vector3().lerpVectors(from, to, THREE.MathUtils.clamp(segmentProgress, 0, 1)),
            direction: new THREE.Vector3().subVectors(to, from).normalize()
          };
        }
        travelled += segmentLength;
      }
      return {
        position: path.points[path.points.length - 1].clone(),
        direction: new THREE.Vector3(1, 0, 0)
      };
    }

    function headingForDirection(direction) {
      return Math.atan2(-direction.z, direction.x);
    }

    function lerpAngle(from, to, amount) {
      const difference = Math.atan2(Math.sin(to - from), Math.cos(to - from));
      return from + difference * amount;
    }

    function routeClearsParkedTrucks(path, movingTruck) {
      const samples = Math.max(24, Math.ceil(path.totalLength / 0.28));
      for (let i = 0; i <= samples; i++) {
        const point = sampleMotionPath(path, i / samples).position;
        for (const other of trucks) {
          if (other === movingTruck || other.userData.leaving || other.userData.entering) continue;
          const dx = point.x - other.position.x;
          const dz = point.z - other.position.z;
          if (Math.hypot(dx, dz) < TRUCK_CLEARANCE) return false;
        }
      }
      return true;
    }

    function translatedFormationPath(target, direction, entering) {
      const perpendicular = new THREE.Vector3(-direction.z, 0, direction.x);
      const offsets = [
        direction.clone().multiplyScalar(23),
        direction.clone().multiplyScalar(14).add(perpendicular.clone().multiplyScalar(3.4)),
        direction.clone().multiplyScalar(6.5).add(perpendicular.clone().multiplyScalar(2.4)),
        new THREE.Vector3(0, 0, 0)
      ];
      const points = offsets.map((offset) => target.clone().add(offset));
      if (!entering) points.reverse();
      return buildMotionPath(points);
    }

    function createEntryPath(target, slotIndex, routeDirection) {
      const direction = routeDirection || new THREE.Vector3(1, 0, 0);
      return translatedFormationPath(target, direction, true);
    }

    function createExitPath(target, slotIndex, routeDirection) {
      const direction = routeDirection || new THREE.Vector3(1, 0, 0);
      return translatedFormationPath(target, direction, false);
    }

    function minimumPathClearance(paths, ignoredTrucks) {
      let minimum = Infinity;
      const samples = 54;
      for (const path of paths) {
        for (let i = 0; i <= samples; i++) {
          const point = sampleMotionPath(path, i / samples).position;
          for (const other of trucks) {
            if (ignoredTrucks && ignoredTrucks.has(other)) continue;
            if (other.userData.leaving || other.userData.entering) continue;
            minimum = Math.min(minimum, Math.hypot(point.x - other.position.x, point.z - other.position.z));
          }
        }
      }
      return minimum;
    }

    function chooseFormationDirection(targets, entering, ignoredTrucks = new Set()) {
      let bestDirection = new THREE.Vector3(1, 0, 0);
      let bestClearance = -Infinity;
      // Every moving truck receives the same translated path shape. That means the
      // whole convoy keeps its parking-grid spacing throughout the simultaneous move.
      for (let candidate = 0; candidate < 32; candidate++) {
        const angle = candidate / 32 * Math.PI * 2 + 0.17;
        const direction = new THREE.Vector3(Math.cos(angle), 0, Math.sin(angle));
        const paths = targets.map((target) => translatedFormationPath(target, direction, entering));
        const clearance = minimumPathClearance(paths, ignoredTrucks);
        if (clearance > bestClearance) {
          bestClearance = clearance;
          bestDirection = direction;
        }
      }
      return bestDirection;
    }

    function simultaneousRoutesClear(paths, clearance = TRUCK_CLEARANCE) {
      const samples = 90;
      for (let a = 0; a < paths.length; a++) {
        for (let b = a + 1; b < paths.length; b++) {
          for (let i = 0; i <= samples; i++) {
            const progress = i / samples;
            const pointA = sampleMotionPath(paths[a], progress).position;
            const pointB = sampleMotionPath(paths[b], progress).position;
            if (Math.hypot(pointA.x - pointB.x, pointA.z - pointB.z) < clearance) return false;
          }
        }
      }
      return true;
    }

    function findFreeParkingSlot() {
      const occupied = new Set(
        trucks
          .filter((truck) => !truck.userData.leaving)
          .map((truck) => truck.userData.slotIndex)
      );
      for (let i = 0; i < PARKING_SLOTS.length; i++) {
        if (!occupied.has(i)) return i;
      }
      return -1;
    }

    function addTruck(animateIn, onComplete, animationOptions = {}) {
      const slotIndex = Number.isInteger(animationOptions.slotIndex)
        ? animationOptions.slotIndex
        : findFreeParkingSlot();
      if (slotIndex < 0) {
        console.warn("No free parking bay is available for another truck.");
        if (typeof onComplete === "function") onComplete();
        return null;
      }
      const truck = createTruckForCurrentMode(palette[slotIndex % palette.length], slotIndex + score);
      const target = PARKING_SLOTS[slotIndex].clone();
      truck.userData.slotIndex = slotIndex;
      scene.add(truck);
      trucks.push(truck);

      if (animateIn) {
        const path = createEntryPath(target, slotIndex, animationOptions.routeDirection);
        truck.position.copy(path.points[0]);
        truck.rotation.y = headingForDirection(sampleMotionPath(path, 0).direction);
        truck.userData.entering = true;
        truck.userData.parked = false;
        truck.userData.speed = 7.5;

        if (!routeClearsParkedTrucks(path, truck)) {
          console.warn("A truck route did not pass the clearance check.");
        }

        truck.userData.currentPath = path;
        activeAnimations.push({
          type: "enter",
          truck,
          path,
          start: animationOptions.startTime ?? performance.now(),
          duration: animationOptions.duration ?? 1650,
          startRotation: truck.rotation.y,
          finalRotation: 0,
          onComplete
        });
      } else {
        truck.position.copy(target);
        truck.rotation.y = 0;
      }
      return truck;
    }

    function arrangeFleet() {
      // Keep each surviving truck in its existing bay. Empty bays remain open
      // for the next arriving truck instead of making the fleet teleport or cross paths.
      const claimed = new Set();
      trucks.forEach((truck) => {
        if (truck.userData.leaving || truck.userData.entering) return;
        let slotIndex = truck.userData.slotIndex;
        if (slotIndex < 0 || slotIndex >= PARKING_SLOTS.length || claimed.has(slotIndex)) {
          slotIndex = PARKING_SLOTS.findIndex((_, index) => !claimed.has(index));
          truck.userData.slotIndex = slotIndex;
        }
        claimed.add(slotIndex);
        truck.position.copy(PARKING_SLOTS[slotIndex]);
        truck.rotation.y = 0;
        truck.userData.speed = 0;
        truck.userData.parked = true;
      });
    }

    function initializeFleet(count) {
      while (trucks.length) {
        const truck = trucks.pop();
        scene.remove(truck);
      }
      activeAnimations.length = 0;
      for (let i = 0; i < count; i++) addTruck(false);
      arrangeFleet();
    }

    function makeWrongAnswer(correct, question) {
      let candidates;
      if (question.mode === "multiply") {
        candidates = [
          correct + question.x,
          correct - question.x,
          correct + question.y,
          correct - question.y,
          question.x + question.y
        ];
      } else if (question.mode === "tens") {
        candidates = [correct - 20, correct - 10, correct + 10, correct + 20];
      } else if (question.mode === "hard") {
        candidates = [correct - 5, correct - 3, correct - 2, correct - 1, correct + 1, correct + 2, correct + 3, correct + 5];
      } else {
        candidates = [correct - 2, correct - 1, correct + 1, correct + 2];
      }

      const maximum = question.mode === "hard" ? 20 : (question.mode === "tens" || question.mode === "multiply") ? 50 : Infinity;
      candidates = candidates.filter((value) => Number.isFinite(value) && value >= 0 && value <= maximum && value !== correct);
      return candidates.length ? candidates[Math.floor(Math.random() * candidates.length)] : Math.max(0, correct - 1);
    }

    function makeQuestion() {
      let x = trucks.length;
      let y;
      let operation;
      let correct;
      let displayX = x;
      let displayY;
      let movement;
      let movementAmount;
      let prompt;

      if (gameMode === "easy") {
        if (x <= 2) operation = "+";
        else if (x >= 5) operation = "−";
        else operation = Math.random() < 0.5 ? "+" : "−";
        y = operation === "+"
          ? randomInt(1, Math.min(3, 5 - x))
          : randomInt(1, Math.min(3, x - 2));
        correct = operation === "+" ? x + y : x - y;
        movement = operation === "+" ? "add" : "subtract";
        movementAmount = y;
        displayY = y;
        prompt = operation === "+"
          ? `How many after ${y} more drive in?`
          : `How many after ${y} drive away?`;
      } else if (gameMode === "hard") {
        if (x <= 2) operation = "+";
        else if (x >= 20) operation = "−";
        else operation = Math.random() < 0.52 ? "+" : "−";
        y = operation === "+"
          ? randomInt(1, Math.min(8, 20 - x))
          : randomInt(1, Math.min(8, x - 1));
        correct = operation === "+" ? x + y : x - y;
        movement = operation === "+" ? "add" : "subtract";
        movementAmount = y;
        displayY = y;
        prompt = `Count the ${x} visible trucks, then solve the challenge up to 20.`;
      } else if (gameMode === "tens") {
        // Unlike the earlier version, these are literal quantities: x trucks means x.
        if (x <= 20) operation = "+";
        else if (x >= 50) operation = "−";
        else operation = Math.random() < 0.5 ? "+" : "−";
        const availableTens = operation === "+" ? (50 - x) / 10 : (x - 20) / 10;
        y = randomInt(1, Math.min(3, availableTens)) * 10;
        correct = operation === "+" ? x + y : x - y;
        movement = operation === "+" ? "add" : "subtract";
        movementAmount = y;
        displayY = y;
        prompt = `${x} means exactly ${x} monster trucks. Count the full fleet!`;
      } else {
        // Keep products at 50 or below so every answer can be shown literally.
        if (x < 2 || x > 10) {
          initializeFleet(randomInt(2, 10));
          x = trucks.length;
          displayX = x;
        }
        const maxFactor = Math.max(2, Math.min(10, Math.floor(50 / x)));
        y = randomInt(2, maxFactor);
        operation = "×";
        correct = x * y;
        displayY = y;
        movement = "multiplyBuild";
        movementAmount = correct - x;
        prompt = `There are ${x} trucks now. Build ${y} equal groups to show ${correct}.`;
      }

      const question = { mode: gameMode, x, y, displayX, displayY, operation, correct, movement, movementAmount };
      const wrong = makeWrongAnswer(correct, question);
      const values = Math.random() < 0.5 ? [correct, wrong] : [wrong, correct];
      question.values = values;

      currentQuestion = question;
      equationEl.textContent = `${displayX} ${operation} ${displayY} = ?`;
      feedbackEl.textContent = prompt;
      answerButtons.forEach((button, index) => {
        button.querySelector(".answer-value").textContent = values[index];
        button.dataset.value = values[index];
        button.classList.remove("correct", "wrong");
        button.disabled = false;
      });
      acceptingAnswer = true;
    }

    function handleAnswer(index) {
      if (!acceptingAnswer || !currentQuestion) return;
      ensureAudio();
      const button = answerButtons[index];
      const selected = Number(button.dataset.value);

      if (selected !== currentQuestion.correct) {
        streak = 0;
        streakEl.textContent = streak;
        feedbackEl.textContent = currentQuestion.mode === "easy" || currentQuestion.mode === "tens"
          ? "Not quite — count the trucks and try again!"
          : "Not quite — check the calculation and try again!";
        button.classList.remove("wrong");
        void button.offsetWidth;
        button.classList.add("wrong");
        playWrongSound();
        setTimeout(() => button.classList.remove("wrong"), 500);
        return;
      }

      acceptingAnswer = false;
      answerButtons.forEach((answer) => answer.disabled = true);
      button.classList.add("correct");
      score += 10 + streak * 2;
      streak += 1;
      scoreEl.textContent = score;
      streakEl.textContent = streak;
      if (currentQuestion.movement === "add") {
        feedbackEl.textContent = `Correct! ${currentQuestion.movementAmount} trucks are driving in together!`;
      } else if (currentQuestion.movement === "subtract") {
        feedbackEl.textContent = `Correct! ${currentQuestion.movementAmount} trucks are driving away together!`;
      } else {
        feedbackEl.textContent = `Correct! Building a literal fleet of ${currentQuestion.correct} trucks!`;
      }
      showCelebration();
      playCorrectSound();
      burstConfetti();
      const stuntStreak = (streak > 0 && streak % 5 === 0) ? streak : null;

      if (currentQuestion.movement === "add") {
        animateAddition(currentQuestion.movementAmount, () => {
          if (stuntStreak) triggerStreakStunt(stuntStreak);
          makeQuestion();
        });
      } else if (currentQuestion.movement === "subtract") {
        animateSubtraction(currentQuestion.movementAmount, () => {
          if (stuntStreak) triggerStreakStunt(stuntStreak);
          makeQuestion();
        });
      } else {
        animateAddition(currentQuestion.movementAmount, () => {
          if (stuntStreak) triggerStreakStunt(stuntStreak);
          feedbackEl.textContent = `${currentQuestion.correct} means ${currentQuestion.correct} visible monster trucks!`;
          window.setTimeout(prepareNextMultiplyRound, 1250);
        });
      }
    }

    function animateAddition(amount, afterComplete) {
      const token = ++roundToken;
      const batchStart = performance.now() + 90;
      const duration = amount > 12 ? 2200 : 1750;
      let completed = 0;
      const arrivingTrucks = [];
      const occupiedSlots = new Set(trucks.filter((truck) => !truck.userData.leaving).map((truck) => truck.userData.slotIndex));
      const selectedSlots = PARKING_SLOTS
        .map((_, index) => index)
        .filter((index) => !occupiedSlots.has(index))
        .slice(0, amount);
      const routeDirection = chooseFormationDirection(selectedSlots.map((index) => PARKING_SLOTS[index]), true);

      for (let i = 0; i < selectedSlots.length; i++) {
        const truck = addTruck(true, () => {
          if (token !== roundToken) return;
          completed += 1;
          if (completed === arrivingTrucks.length) {
            arrangeFleet();
            setTimeout(() => {
              if (token !== roundToken) return;
              if (typeof afterComplete === "function") afterComplete();
              else makeQuestion();
            }, 360);
          }
        }, { startTime: batchStart, duration, slotIndex: selectedSlots[i], routeDirection });

        if (truck) arrivingTrucks.push(truck);
      }

      if (!arrivingTrucks.length) {
        if (typeof afterComplete === "function") afterComplete();
        else makeQuestion();
        return;
      }

      const routes = arrivingTrucks.map((truck) => truck.userData.currentPath);
      if (!simultaneousRoutesClear(routes)) {
        console.warn("The arriving convoy routes did not pass the moving-clearance check.");
      }
      playConvoyEngineSounds(arrivingTrucks, "arrive", batchStart, duration);
    }

    function animateSubtraction(amount, afterComplete) {
      const token = ++roundToken;

      // Fisher-Yates shuffle gives every currently parked truck an equal chance
      // to leave, including the two trucks in the front row.
      const candidates = trucks.filter((truck) => truck.userData.parked && !truck.userData.leaving);
      for (let i = candidates.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
      }
      const leavingTrucks = candidates.slice(0, amount);
      const batchStart = performance.now() + 90;
      const duration = amount > 12 ? 2200 : 1750;
      let completed = 0;
      const leavingSet = new Set(leavingTrucks);
      const routeDirection = chooseFormationDirection(leavingTrucks.map((truck) => truck.position.clone()), false, leavingSet);

      // Mark the complete convoy before building routes. Each selected truck then
      // launches on the same frame while retaining its own dedicated corridor.
      leavingTrucks.forEach((truck) => {
        truck.userData.leaving = true;
        truck.userData.parked = false;
        truck.userData.currentPath = createExitPath(truck.position.clone(), truck.userData.slotIndex, routeDirection);
      });

      const routes = leavingTrucks.map((truck) => truck.userData.currentPath);
      if (!simultaneousRoutesClear(routes)) {
        console.warn("The departing convoy routes did not pass the moving-clearance check.");
      }

      playConvoyEngineSounds(leavingTrucks, "leave", batchStart, duration);
      leavingTrucks.forEach((truck) => {
        const path = truck.userData.currentPath;
        if (!routeClearsParkedTrucks(path, truck)) {
          console.warn("A truck route did not pass the parked-truck clearance check.");
        }

        activeAnimations.push({
          type: "leave",
          truck,
          path,
          start: batchStart,
          duration,
          startRotation: truck.rotation.y,
          onComplete: () => {
            if (token !== roundToken) return;
            const truckIndex = trucks.indexOf(truck);
            if (truckIndex >= 0) trucks.splice(truckIndex, 1);
            scene.remove(truck);
            completed += 1;

            if (completed === leavingTrucks.length) {
              arrangeFleet();
              setTimeout(() => {
                if (token !== roundToken) return;
                if (typeof afterComplete === "function") afterComplete();
                else makeQuestion();
              }, 360);
            }
          }
        });
      });
    }

    function prepareNextMultiplyRound() {
      if (gameMode !== "multiply") return;
      const nextCount = randomInt(2, 10);
      const difference = nextCount - trucks.length;
      feedbackEl.textContent = `Great fleet! Now forming ${nextCount} trucks for the next multiplication.`;
      if (difference > 0) {
        animateAddition(difference, makeQuestion);
      } else if (difference < 0) {
        animateSubtraction(-difference, makeQuestion);
      } else {
        makeQuestion();
      }
    }

    function animateRevCelebration() {
      const token = ++roundToken;
      const convoy = trucks.filter((truck) => truck.userData.parked && !truck.userData.leaving && !truck.userData.entering);
      const batchStart = performance.now() + 80;
      const duration = 1100;

      convoy.forEach((truck, index) => {
        truck.userData.revUntil = batchStart + duration;
        truck.userData.revSeed = index * 0.8 + Math.random();
      });
      playConvoyEngineSounds(convoy, "leave", batchStart, duration);

      setTimeout(() => {
        if (token !== roundToken) return;
        convoy.forEach((truck) => {
          truck.userData.revUntil = 0;
          truck.userData.speed = 0;
        });
        makeQuestion();
      }, duration + 360);
    }

    function updateAnimations(now) {
      for (let i = activeAnimations.length - 1; i >= 0; i--) {
        const animation = activeAnimations[i];
        if (now < animation.start) continue;

        const raw = Math.min(1, (now - animation.start) / animation.duration);
        const truck = animation.truck;

        if (animation.type === "leave") {
          const turnFraction = 0.12;
          const firstDirection = sampleMotionPath(animation.path, 0).direction;
          const firstHeading = headingForDirection(firstDirection);

          if (raw < turnFraction) {
            const turnProgress = easeInOutCubic(raw / turnFraction);
            truck.position.copy(animation.path.points[0]);
            truck.rotation.y = lerpAngle(animation.startRotation, firstHeading, turnProgress);
            truck.userData.speed = 0.8;
          } else {
            const movementProgress = easeInOutCubic((raw - turnFraction) / (1 - turnFraction));
            const sample = sampleMotionPath(animation.path, movementProgress);
            truck.position.copy(sample.position);
            truck.rotation.y = lerpAngle(truck.rotation.y, headingForDirection(sample.direction), 0.2);
            truck.userData.speed = 1.2 + 8.8 * movementProgress;
            if (Math.random() < Math.min(0.2, 2.8 / Math.max(1, trucks.length))) spawnDust(truck.position);
          }
        } else if (animation.type === "enter") {
          const parkFraction = 0.14;
          const movementEnd = 1 - parkFraction;

          if (raw < movementEnd) {
            const movementProgress = easeInOutCubic(raw / movementEnd);
            const sample = sampleMotionPath(animation.path, movementProgress);
            truck.position.copy(sample.position);
            truck.rotation.y = lerpAngle(truck.rotation.y, headingForDirection(sample.direction), 0.2);
            truck.userData.speed = 7.5 * (1 - movementProgress) + 0.7;
            if (Math.random() < Math.min(0.18, 2.8 / Math.max(1, trucks.length))) spawnDust(truck.position);
          } else {
            const parkProgress = easeInOutCubic((raw - movementEnd) / parkFraction);
            truck.position.copy(animation.path.points[animation.path.points.length - 1]);
            truck.rotation.y = lerpAngle(truck.rotation.y, animation.finalRotation, 0.18 + parkProgress * 0.35);
            truck.userData.speed = 0.7 * (1 - parkProgress);
          }
        }

        if (raw >= 1) {
          truck.position.copy(animation.path.points[animation.path.points.length - 1]);
          truck.userData.speed = 0;
          if (animation.type === "enter") {
            truck.userData.entering = false;
            truck.userData.parked = true;
            truck.rotation.y = animation.finalRotation;
          }
          truck.userData.currentPath = null;

          const onComplete = animation.onComplete;
          activeAnimations.splice(i, 1);
          if (typeof onComplete === "function") onComplete();
        }
      }
    }

    function spawnDust(position) {
      const puff = new THREE.Mesh(
        new THREE.SphereGeometry(0.18 + Math.random() * 0.18, 8, 6),
        new THREE.MeshBasicMaterial({ color: 0xd7aa72, transparent: true, opacity: 0.36, depthWrite: false })
      );
      puff.position.copy(position);
      puff.position.x += (Math.random() - 0.5) * 1.4;
      puff.position.z += (Math.random() - 0.5) * 1.4;
      puff.position.y = 0.18 + Math.random() * 0.25;
      scene.add(puff);
      dustPuffs.push({ mesh: puff, life: 0, maxLife: 0.75 + Math.random() * 0.45 });
    }

    function updateDust(delta) {
      for (let i = dustPuffs.length - 1; i >= 0; i--) {
        const puff = dustPuffs[i];
        puff.life += delta;
        const t = puff.life / puff.maxLife;
        puff.mesh.position.y += delta * 0.7;
        puff.mesh.scale.setScalar(1 + t * 2.4);
        puff.mesh.material.opacity = Math.max(0, 0.38 * (1 - t));
        if (t >= 1) {
          scene.remove(puff.mesh);
          puff.mesh.geometry.dispose();
          puff.mesh.material.dispose();
          dustPuffs.splice(i, 1);
        }
      }
    }

    function burstConfetti() {
      const colors = [0xff4057, 0xffd23f, 0x35c984, 0x3b8cff, 0x9a62ff];
      for (let i = 0; i < 42; i++) {
        const material = new THREE.MeshBasicMaterial({ color: colors[i % colors.length], side: THREE.DoubleSide });
        const piece = new THREE.Mesh(new THREE.PlaneGeometry(0.13, 0.25), material);
        piece.position.set((Math.random() - 0.5) * 6, 6 + Math.random() * 2, (Math.random() - 0.5) * 4);
        piece.rotation.set(Math.random() * 6, Math.random() * 6, Math.random() * 6);
        scene.add(piece);
        confettiPieces.push({
          mesh: piece,
          velocity: new THREE.Vector3((Math.random() - 0.5) * 5, 2 + Math.random() * 4, (Math.random() - 0.5) * 3),
          spin: new THREE.Vector3(Math.random() * 7, Math.random() * 7, Math.random() * 7),
          life: 0,
          maxLife: 1.8 + Math.random() * 0.8
        });
      }
    }

    function updateConfetti(delta) {
      for (let i = confettiPieces.length - 1; i >= 0; i--) {
        const piece = confettiPieces[i];
        piece.life += delta;
        piece.velocity.y -= 8.2 * delta;
        piece.mesh.position.addScaledVector(piece.velocity, delta);
        piece.mesh.rotation.x += piece.spin.x * delta;
        piece.mesh.rotation.y += piece.spin.y * delta;
        piece.mesh.rotation.z += piece.spin.z * delta;
        if (piece.life > piece.maxLife || piece.mesh.position.y < -0.1) {
          scene.remove(piece.mesh);
          piece.mesh.geometry.dispose();
          piece.mesh.material.dispose();
          confettiPieces.splice(i, 1);
        }
      }
    }

    function showCelebration() {
      crowdCheer = 1.6; // audience goes wild (stays at full cheer for ~1.5s, then calms down)
      const messages = ["ROAR-SOME!", "MATH POWER!", "CRUSHED IT!", "GREAT COUNTING!"];
      celebrationEl.textContent = messages[Math.floor(Math.random() * messages.length)];
      celebrationEl.classList.remove("show");
      void celebrationEl.offsetWidth;
      celebrationEl.classList.add("show");
    }

    // Truck geometry and materials are shared between trucks, so nothing is disposed here.
    function disposeTruckMesh() {}

    function triggerStreakStunt(streakCount) {
      crowdCheer = 2.5;
      stuntStreakEl.textContent = streakCount;
      stuntCaptionEl.classList.remove("show");
      void stuntCaptionEl.offsetWidth;
      stuntCaptionEl.classList.add("show");
      setTimeout(() => {
        playStuntSound();
        spawnStuntTruck();
      }, 700);
    }

    function spawnStuntTruck() {
      // The truck climbs one ramp, flies over the permanent wrecks, lands on the far deck and drives off.
      const dir = Math.random() < 0.5 ? 1 : -1;   // +1 = left to right
      const faceY = dir > 0 ? 0 : Math.PI;

      const startX = -dir * 13.4;
      const launchX = -dir * RAMP_INNER_X;
      const landX = dir * RAMP_INNER_X;
      const exitX = dir * 13.2;

      const truck = createMonsterTruck(0xff5a3c, 999);
      truck.scale.setScalar(1);
      truck.position.set(startX, 0, STUNT_RAMP_Z);
      truck.rotation.set(0, faceY, 0);
      scene.add(truck);

      const now = performance.now();
      const approachDuration = 800;
      const airDuration = 1050;
      const exitDuration = 1000;

      activeStunts.push({
        truck,
        dir,
        startX,
        launchX,
        landX,
        exitX,
        start: now,
        approachEnd: now + approachDuration,
        airEnd: now + approachDuration + airDuration,
        exitEnd: now + approachDuration + airDuration + exitDuration
      });
    }

    // Height of the driving surface at a given |x|: ground, then slope, then flat deck.
    function rampSurfaceHeight(ax) {
      if (ax >= RAMP_FOOT_X) return 0;
      if (ax >= RAMP_SLOPE_START_X) return RAMP_LAUNCH_HEIGHT * (RAMP_FOOT_X - ax) / RAMP_SLOPE_RUN;
      if (ax >= RAMP_INNER_X) return RAMP_LAUNCH_HEIGHT;
      return 0;
    }

    function smoothstep01(t) {
      const c = THREE.MathUtils.clamp(t, 0, 1);
      return c * c * (3 - 2 * c);
    }

    function updateStunts(now) {
      for (let i = activeStunts.length - 1; i >= 0; i--) {
        const stunt = activeStunts[i];
        const truck = stunt.truck;
        if (now < stunt.start) continue;

        if (now <= stunt.approachEnd) {
          const t = (now - stunt.start) / (stunt.approachEnd - stunt.start);
          truck.position.x = THREE.MathUtils.lerp(stunt.startX, stunt.launchX, t);
          const ax = Math.abs(truck.position.x);
          truck.position.y = rampSurfaceHeight(ax);
          const onSlope = ax < RAMP_FOOT_X + 0.4 && ax > RAMP_SLOPE_START_X - 0.2;
          truck.rotation.z += ((onSlope ? RAMP_TILT : 0) - truck.rotation.z) * 0.2;
          if (Math.random() < 0.3 && ax > RAMP_FOOT_X - 1) spawnDust(new THREE.Vector3(truck.position.x, 0, truck.position.z));
        } else if (now <= stunt.airEnd) {
          const t = (now - stunt.approachEnd) / (stunt.airEnd - stunt.approachEnd);
          const inv = 1 - t;
          truck.position.x = THREE.MathUtils.lerp(stunt.launchX, stunt.landX, t);
          truck.position.y = (inv * inv + t * t) * RAMP_LAUNCH_HEIGHT + 2 * inv * t * STUNT_APEX_HEIGHT;
          // Back flip: wait until clear of the deck, finish before touching down.
          truck.rotation.z = Math.PI * 2 * smoothstep01((t - 0.1) / 0.78);
          if (t > 0.92 && Math.random() < 0.6) spawnDust(new THREE.Vector3(truck.position.x, 0, truck.position.z));
        } else if (now <= stunt.exitEnd) {
          const raw = (now - stunt.airEnd) / (stunt.exitEnd - stunt.airEnd);
          const t = raw * (1.5 - 0.5 * raw);
          if (truck.rotation.z > 1) truck.rotation.z = 0;
          truck.position.x = THREE.MathUtils.lerp(stunt.landX, stunt.exitX, t);
          const ax = Math.abs(truck.position.x);
          truck.position.y = rampSurfaceHeight(ax);
          const onSlope = ax > RAMP_SLOPE_START_X - 0.2 && ax < RAMP_FOOT_X + 0.1;
          truck.rotation.z += ((onSlope ? -RAMP_TILT : 0) - truck.rotation.z) * 0.2;
          if (Math.random() < 0.3 && ax > RAMP_FOOT_X - 1) spawnDust(new THREE.Vector3(truck.position.x, 0, truck.position.z));
        } else {
          scene.remove(truck);
          disposeTruckMesh(truck);
          activeStunts.splice(i, 1);
        }
      }
    }

    function playStuntSound() {
      tone(220, 0.14, "sawtooth", 0.07, 0);
      tone(180, 0.14, "sawtooth", 0.07, 0.16);
      tone(140, 0.14, "sawtooth", 0.07, 0.32);
      tone(660, 0.4, "triangle", 0.09, 0.55);
    }

    function ensureAudio() {
      if (!soundEnabled) return null;
      if (!audioContext) {
        const AudioContextClass = window.AudioContext || window.webkitAudioContext;
        if (!AudioContextClass) return null;
        audioContext = new AudioContextClass();
      }
      if (audioContext.state === "suspended") audioContext.resume();
      return audioContext;
    }

    function tone(frequency, duration, type, volume, startDelay) {
      const context = ensureAudio();
      if (!context || !soundEnabled) return;
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      const start = context.currentTime + (startDelay || 0);
      oscillator.type = type || "sine";
      oscillator.frequency.setValueAtTime(frequency, start);
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(volume || 0.08, start + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
      oscillator.connect(gain).connect(context.destination);
      oscillator.start(start);
      oscillator.stop(start + duration + 0.03);
    }

    function playCorrectSound() {
      tone(392, 0.22, "triangle", 0.09, 0);
      tone(523, 0.25, "triangle", 0.09, 0.12);
      tone(659, 0.34, "triangle", 0.1, 0.24);
    }

    function playWrongSound() {
      tone(180, 0.18, "square", 0.045, 0);
      tone(145, 0.24, "square", 0.04, 0.13);
    }

    function getEngineNoiseBuffer(context) {
      if (engineNoiseBuffer && engineNoiseBuffer.sampleRate === context.sampleRate) return engineNoiseBuffer;
      const length = context.sampleRate * 2;
      const buffer = context.createBuffer(1, length, context.sampleRate);
      const channel = buffer.getChannelData(0);
      let previous = 0;
      for (let i = 0; i < length; i++) {
        // Brown-ish noise creates a low, uneven exhaust texture without audio files.
        const white = Math.random() * 2 - 1;
        previous = (previous + 0.035 * white) / 1.035;
        channel[i] = previous * 3.2;
      }
      engineNoiseBuffer = buffer;
      return buffer;
    }

    function stopAllEngineSounds(fadeSeconds = 0.06) {
      if (!audioContext) return;
      const now = audioContext.currentTime;
      activeEngineVoices.forEach((voice) => {
        try {
          voice.output.gain.cancelScheduledValues(now);
          voice.output.gain.setValueAtTime(Math.max(0.0001, voice.output.gain.value), now);
          voice.output.gain.exponentialRampToValueAtTime(0.0001, now + fadeSeconds);
          voice.sources.forEach((source) => {
            try { source.stop(now + fadeSeconds + 0.04); } catch (error) { /* already stopped */ }
          });
        } catch (error) { /* audio node was already released */ }
      });
      activeEngineVoices.clear();
    }

    function playTruckEngine(truck, mode, startDelay, duration, index, total) {
      const context = ensureAudio();
      if (!context || !soundEnabled) return;

      const start = context.currentTime + Math.max(0, startDelay);
      const end = start + Math.max(0.55, duration);
      const seed = (truck.userData.slotIndex + 1) * 0.73 + index * 0.41;
      const variation = (Math.sin(seed * 8.17) + 1) * 0.5;
      const voiceLevel = 0.12 / Math.sqrt(Math.max(1, total));

      const output = context.createGain();
      const engineFilter = context.createBiquadFilter();
      const compressor = context.createDynamicsCompressor();
      engineFilter.type = "lowpass";
      engineFilter.Q.value = 1.1;
      engineFilter.frequency.setValueAtTime(mode === "leave" ? 520 : 760, start);
      engineFilter.frequency.linearRampToValueAtTime(mode === "leave" ? 1050 : 430, end);
      compressor.threshold.value = -22;
      compressor.knee.value = 18;
      compressor.ratio.value = 5;
      compressor.attack.value = 0.006;
      compressor.release.value = 0.16;

      let destination = context.destination;
      let panner = null;
      if (typeof context.createStereoPanner === "function") {
        panner = context.createStereoPanner();
        const slotX = PARKING_SLOTS[truck.userData.slotIndex]?.x ?? truck.position.x;
        panner.pan.value = THREE.MathUtils.clamp(slotX / 7, -0.72, 0.72);
        output.connect(engineFilter).connect(compressor).connect(panner).connect(destination);
      } else {
        output.connect(engineFilter).connect(compressor).connect(destination);
      }

      const sub = context.createOscillator();
      const growl = context.createOscillator();
      const combustion = context.createOscillator();
      const lfo = context.createOscillator();
      const lfoDepth = context.createGain();
      const subGain = context.createGain();
      const growlGain = context.createGain();
      const combustionGain = context.createGain();

      sub.type = "sine";
      growl.type = "sawtooth";
      combustion.type = "square";
      lfo.type = "sine";
      lfo.frequency.value = 8.2 + variation * 3.6;
      lfoDepth.gain.value = 2.4 + variation * 1.5;
      lfo.connect(lfoDepth);
      lfoDepth.connect(growl.frequency);
      lfoDepth.connect(combustion.frequency);

      subGain.gain.value = 0.82;
      growlGain.gain.value = 0.32;
      combustionGain.gain.value = 0.065;
      sub.connect(subGain).connect(output);
      growl.connect(growlGain).connect(output);
      combustion.connect(combustionGain).connect(output);

      const idle = 31 + variation * 5;
      const cruise = 52 + variation * 7;
      const fullRev = 82 + variation * 10;
      const schedulePitch = (oscillator, multiplier) => {
        if (mode === "leave") {
          oscillator.frequency.setValueAtTime(idle * multiplier, start);
          oscillator.frequency.setValueAtTime((idle + 2) * multiplier, start + duration * 0.10);
          oscillator.frequency.exponentialRampToValueAtTime(cruise * multiplier, start + duration * 0.38);
          oscillator.frequency.exponentialRampToValueAtTime(fullRev * multiplier, start + duration * 0.78);
          oscillator.frequency.exponentialRampToValueAtTime((fullRev * 0.91) * multiplier, end);
        } else {
          oscillator.frequency.setValueAtTime(fullRev * multiplier, start);
          oscillator.frequency.exponentialRampToValueAtTime((fullRev * 0.82) * multiplier, start + duration * 0.30);
          oscillator.frequency.exponentialRampToValueAtTime(cruise * multiplier, start + duration * 0.68);
          oscillator.frequency.exponentialRampToValueAtTime(idle * multiplier, end);
        }
      };
      schedulePitch(sub, 1);
      schedulePitch(growl, 2);
      schedulePitch(combustion, 4);

      const exhaust = context.createBufferSource();
      const exhaustFilter = context.createBiquadFilter();
      const exhaustGain = context.createGain();
      exhaust.buffer = getEngineNoiseBuffer(context);
      exhaust.loop = true;
      exhaustFilter.type = "bandpass";
      exhaustFilter.Q.value = 0.8;
      exhaustFilter.frequency.setValueAtTime(mode === "leave" ? 105 : 170, start);
      exhaustFilter.frequency.exponentialRampToValueAtTime(mode === "leave" ? 245 : 95, end);
      exhaustGain.gain.value = 0.19;
      exhaust.connect(exhaustFilter).connect(exhaustGain).connect(output);

      output.gain.setValueAtTime(0.0001, start);
      output.gain.exponentialRampToValueAtTime(voiceLevel, start + 0.07);
      if (mode === "leave") {
        output.gain.linearRampToValueAtTime(voiceLevel * 1.08, start + duration * 0.72);
      } else {
        output.gain.linearRampToValueAtTime(voiceLevel * 0.72, start + duration * 0.78);
      }
      output.gain.exponentialRampToValueAtTime(0.0001, end + 0.08);

      const sources = [sub, growl, combustion, lfo, exhaust];
      const voice = { output, sources };
      activeEngineVoices.add(voice);
      sources.forEach((source) => source.start(start));
      sources.forEach((source) => source.stop(end + 0.12));

      // A pair of short low-frequency exhaust thumps makes the launch/parking feel heavier.
      const thumpAt = mode === "leave" ? start + 0.13 : end - 0.28;
      [0, 0.095].forEach((offset, thumpIndex) => {
        const thump = context.createOscillator();
        const thumpGain = context.createGain();
        thump.type = "sine";
        thump.frequency.setValueAtTime(62 - thumpIndex * 8 + variation * 4, thumpAt + offset);
        thump.frequency.exponentialRampToValueAtTime(33, thumpAt + offset + 0.11);
        thumpGain.gain.setValueAtTime(0.0001, thumpAt + offset);
        thumpGain.gain.exponentialRampToValueAtTime(voiceLevel * 0.72, thumpAt + offset + 0.012);
        thumpGain.gain.exponentialRampToValueAtTime(0.0001, thumpAt + offset + 0.13);
        thump.connect(thumpGain).connect(engineFilter);
        thump.start(thumpAt + offset);
        thump.stop(thumpAt + offset + 0.15);
        sources.push(thump);
      });

      window.setTimeout(() => activeEngineVoices.delete(voice), (startDelay + duration + 0.35) * 1000);
    }

    function playConvoyEngineSounds(convoy, mode, batchStart, durationMs) {
      if (!convoy.length || !soundEnabled) return;
      const delay = Math.max(0, (batchStart - performance.now()) / 1000);
      const duration = durationMs / 1000;
      const maximumVoices = 12;
      const audibleConvoy = convoy.length <= maximumVoices
        ? convoy
        : Array.from({ length: maximumVoices }, (_, index) => convoy[Math.floor(index * convoy.length / maximumVoices)]);
      audibleConvoy.forEach((truck, index) => {
        playTruckEngine(truck, mode, delay, duration, index, audibleConvoy.length);
      });
    }

    function updateTrucks(delta, time) {
      const now = performance.now();
      trucks.forEach((truck, index) => {
        const data = truck.userData;
        const revving = Boolean(data.revUntil && now < data.revUntil);
        const revPulse = revving ? 4.8 + Math.sin(time * 16 + (data.revSeed || index)) * 1.2 : 0;
        const effectiveSpeed = Math.max(data.speed, revPulse);

        data.wheels.forEach((wheel) => {
          wheel.rotation.z -= delta * (effectiveSpeed * 2.5 + 0.2);
        });
        const idle = data.parked ? Math.sin(time * 2.2 + data.bobSeed) * 0.025 : 0;
        const driveBounce = effectiveSpeed > 0.4 ? Math.abs(Math.sin(time * 9 + index)) * Math.min(0.13, effectiveSpeed * 0.017) : 0;
        data.suspension.position.y = idle + driveBounce;
        data.suspension.rotation.z = effectiveSpeed > 0.4 ? Math.sin(time * 6 + index) * 0.016 : 0;

        if (revving && Math.random() < Math.min(0.04, 0.24 / Math.max(1, trucks.length))) spawnDust(truck.position);
      });
    }

    function animate(now) {
      const delta = Math.min(0.033, (now - lastTime) / 1000);
      lastTime = now;
      elapsed += delta;

      updateAnimations(now);
      updateStunts(now);
      updateTrucks(delta, elapsed);
      updateDust(delta);
      updateConfetti(delta);
      crowdCheer = Math.max(0, crowdCheer - delta * 0.4);
      if (crowdUpdate) crowdUpdate(elapsed, Math.min(1, crowdCheer));

      applyOrbitCamera();
      renderer.render(scene, camera);
      requestAnimationFrame(animate);
    }

    function startingFleetCount(mode) {
      if (mode === "easy") return randomInt(2, 5);
      if (mode === "hard") return randomInt(2, 20);
      if (mode === "tens") return randomInt(2, 5) * 10;
      return randomInt(2, 10);
    }

    function applyFleetProfile(mode) {
      const profile = MODE_FLEET_CONFIG[mode];
      PARKING_SLOTS = profile.slots;
      TRUCK_CLEARANCE = profile.clearance;
      camera.fov = mode === "easy" ? 42 : mode === "hard" ? 46 : 49;
      camera.updateProjectionMatrix();
    }

    function updateCameraPlacement(resetOrbit = false) {
      const narrow = innerWidth < 650;
      if (resetOrbit || !orbitInitialized) {
        if (gameMode === "easy") {
          camera.position.set(narrow ? 10.5 : 11, narrow ? 12.5 : 11, narrow ? 18.5 : 16);
        } else if (gameMode === "hard") {
          camera.position.set(narrow ? 12.5 : 13.5, narrow ? 16.5 : 14.5, narrow ? 23.5 : 21.5);
        } else {
          camera.position.set(narrow ? 14.5 : 15.5, narrow ? 20.5 : 18.0, narrow ? 27.5 : 24.5);
        }
        syncOrbitFromCamera();
      } else {
        clampOrbit();
        applyOrbitCamera();
      }
    }

    function resize() {
      camera.aspect = innerWidth / innerHeight;
      applyFleetProfile(gameMode);
      updateCameraPlacement(false);
      renderer.setPixelRatio(Math.min(devicePixelRatio, gameMode === "easy" ? 2 : 1.6));
      renderer.setSize(innerWidth, innerHeight, false);
    }

    function setGameMode(mode) {
      if (!MODE_INFO[mode] || mode === gameMode) return;
      stopAllEngineSounds();
      roundToken += 1;
      gameMode = mode;
      acceptingAnswer = false;
      score = 0;
      streak = 0;
      scoreEl.textContent = score;
      streakEl.textContent = streak;

      modeButtons.forEach((button) => {
        const active = button.dataset.mode === gameMode;
        button.setAttribute("aria-pressed", String(active));
      });
      applyFleetProfile(gameMode);
      updateCameraPlacement(true);

      initializeFleet(startingFleetCount(gameMode));
      feedbackEl.textContent = MODE_INFO[gameMode].intro;
      makeQuestion();
      tone(390, 0.12, "triangle", 0.06, 0);
      tone(560, 0.18, "triangle", 0.06, 0.1);
    }

    function restartGame() {
      stopAllEngineSounds();
      roundToken += 1;
      score = 0;
      streak = 0;
      scoreEl.textContent = score;
      streakEl.textContent = streak;
      acceptingAnswer = false;
      applyFleetProfile(gameMode);
      initializeFleet(startingFleetCount(gameMode));
      feedbackEl.textContent = `${MODE_INFO[gameMode].label} mode restarted!`;
      makeQuestion();
      tone(330, 0.18, "triangle", 0.07, 0);
      tone(440, 0.24, "triangle", 0.07, 0.12);
    }

    function randomInt(min, max) {
      return Math.floor(Math.random() * (max - min + 1)) + min;
    }

    function easeInOutCubic(t) {
      return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
    }

    modeButtons.forEach((button) => {
      button.addEventListener("click", () => {
        ensureAudio();
        setGameMode(button.dataset.mode);
      });
    });

    answerButtons.forEach((button, index) => {
      button.addEventListener("click", () => handleAnswer(index));
    });

    canvas.addEventListener("pointerdown", beginCameraPointer, { passive: false });
    canvas.addEventListener("pointermove", moveCameraPointer, { passive: false });
    canvas.addEventListener("pointerup", endCameraPointer, { passive: false });
    canvas.addEventListener("pointercancel", endCameraPointer, { passive: false });
    canvas.addEventListener("lostpointercapture", endCameraPointer, { passive: false });
    canvas.addEventListener("wheel", zoomCamera, { passive: false });

    window.addEventListener("keydown", (event) => {
      if (event.key === "1") handleAnswer(0);
      if (event.key === "2") handleAnswer(1);
      const key = event.key.toLowerCase();
      if (key === "e") setGameMode("easy");
      if (key === "h") setGameMode("hard");
      if (key === "t") setGameMode("tens");
      if (key === "m") setGameMode("multiply");
      if (key === "r") restartGame();
    });

    soundButton.addEventListener("click", () => {
      soundEnabled = !soundEnabled;
      soundButton.textContent = soundEnabled ? "🔊" : "🔇";
      soundButton.setAttribute("aria-label", soundEnabled ? "Mute sound" : "Turn on sound");
      if (soundEnabled) {
        tone(520, 0.14, "sine", 0.06, 0);
      } else {
        stopAllEngineSounds();
      }
    });

    function updateFullscreenButton() {
      const isFullscreen = Boolean(document.fullscreenElement);
      fullscreenButton.textContent = isFullscreen ? "🗗" : "⛶";
      fullscreenButton.setAttribute("aria-label", isFullscreen ? "Exit full screen" : "Enter full screen");
      fullscreenButton.setAttribute("aria-pressed", String(isFullscreen));
    }

    if (document.fullscreenEnabled === false) {
      fullscreenButton.disabled = true;
      fullscreenButton.title = "Full screen not supported";
    } else {
      fullscreenButton.addEventListener("click", () => {
        if (document.fullscreenElement) {
          document.exitFullscreen();
        } else {
          document.documentElement.requestFullscreen().catch(() => {});
        }
      });
      document.addEventListener("fullscreenchange", updateFullscreenButton);
    }

    restartButton.addEventListener("click", restartGame);
    window.addEventListener("resize", resize);

    modeButtons.forEach((button) => button.setAttribute("aria-pressed", String(button.dataset.mode === gameMode)));
    applyFleetProfile(gameMode);
    initializeFleet(startingFleetCount(gameMode));
    makeQuestion();
    resize();
    requestAnimationFrame(animate);

    loading.style.opacity = "0";
    setTimeout(() => loading.remove(), 320);
  }

import * as THREE from '../vendor/three/three.module.min.js';
import { mount as mountCinema } from '../selected/discs.js';
import { createCinemaTitle } from './cinema-title.js';
import { createVinylMaterial } from './vinyl-material.js';
import { createVinylWater } from './vinyl-water.js';
import { createWaterTexture } from './vinyl-water-texture.js';
import { drawVinylPrint } from './vinyl-label.js';

const GRAVITY = 7.8; // World units are record radii.
const cap = (v, limit) => Math.max(-limit, Math.min(limit, v));

function createVinylEdition({ scene, ring, ownGeometry, ownMaterial, ownTexture, createCanvas, canvasTexture, requestFrame }) {
  const bore = .033;
  const printRadius = Math.sqrt(.80);
  const printPixels = Math.min(window.innerWidth, window.innerHeight) * printRadius * Math.min(window.devicePixelRatio || 1, 2);
  const printSize = Math.min(1536, Math.max(512, Math.ceil(printPixels / 256) * 256));
  const bodyGeometry = ring(bore, 1);
  // A pressed lip has a rounded cross section. Its changing silhouette remains
  // visible even when the face goes edge-on during a flip.
  const rimGeometry = ownGeometry(new THREE.LatheGeometry([
    new THREE.Vector2(.983, -.012), new THREE.Vector2(.987, -.018),
    new THREE.Vector2(.993, -.018), new THREE.Vector2(.998, -.013),
    new THREE.Vector2(1, -.005), new THREE.Vector2(1, .005),
    new THREE.Vector2(.998, .013), new THREE.Vector2(.993, .018),
    new THREE.Vector2(.987, .018), new THREE.Vector2(.983, .012),
  ], 192));
  const boreGeometry = ownGeometry(new THREE.LatheGeometry([
    new THREE.Vector2(bore + .004, .014), new THREE.Vector2(bore, .009),
    new THREE.Vector2(bore, -.009), new THREE.Vector2(bore + .004, -.014),
  ], 64));
  const edgeMaterial = ownMaterial(new THREE.MeshStandardMaterial({
    color: 0x464641, roughness: .23, metalness: 0, side: THREE.DoubleSide,
    transparent: true, opacity: .70,
  }));
  edgeMaterial.forceSinglePass = true;
  const floorPatch = ownGeometry(new THREE.PlaneGeometry(1, 1));
  const shadowCanvas = createCanvas(128);
  const ctx = shadowCanvas.getContext('2d');
  // A narrow contact darkening and a softer cast shadow from the studio light.
  // The texture is shared by all eight floor patches.
  for (const [x, y, w, h, alpha] of [[73, 68, 53, 47, .16], [54, 56, 23, 17, .27]]) {
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(w, h);
    const falloff = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
    falloff.addColorStop(0, `rgba(30,34,33,${alpha})`);
    falloff.addColorStop(.45, `rgba(30,34,33,${alpha * .52})`);
    falloff.addColorStop(1, 'rgba(30,34,33,0)');
    ctx.fillStyle = falloff;
    ctx.fillRect(-1, -1, 2, 2);
    ctx.restore();
  }
  const shadowTexture = canvasTexture(shadowCanvas);
  // All records share one neutral pressing. Only the original film still
  // and the moving oil field vary from one record to the next.
  const surfaceReady = { value: 0 };
  const surfaceTexel = { value: new THREE.Vector2(1, 1) };
  const surfaceTexture = ownTexture(new THREE.TextureLoader().load(
    new URL('./materials/smoked-vinyl.webp', import.meta.url).href,
    texture => {
      surfaceTexel.value.set(1 / texture.image.width, 1 / texture.image.height);
      surfaceReady.value = 1;
      requestFrame();
    },
  ));
  surfaceTexture.colorSpace = THREE.SRGBColorSpace;
  surfaceTexture.anisotropy = 4;
  const center = new THREE.Vector3();
  const normal = new THREE.Vector3();
  const orientation = new THREE.Quaternion();
  const inverse = new THREE.Quaternion();
  const delta = new THREE.Quaternion();
  const gravity = new THREE.Vector3();
  const velocity = new THREE.Vector3();
  const acceleration = new THREE.Vector3();
  const omega = new THREE.Vector3();

  return (entry, index) => {
    const group = new THREE.Group();
    const water = createVinylWater({ seed: index + 1 });
    const field = createWaterTexture();
    field.update(water);
    ownTexture(field.texture);
    const canvas = createCanvas(printSize);
    const printTexture = canvasTexture(canvas);
    const material = ownMaterial(createVinylMaterial(index, field.texture, printTexture, printRadius, surfaceTexture));
    material.uniforms.uHasSurface = surfaceReady;
    material.uniforms.uSurfaceTexel = surfaceTexel;
    const body = new THREE.Mesh(bodyGeometry, material);
    const rim = new THREE.Mesh(rimGeometry, edgeMaterial);
    const spindle = new THREE.Mesh(boreGeometry, edgeMaterial);
    rim.rotation.x = spindle.rotation.x = Math.PI / 2;
    group.add(body, rim, spindle);
    const shadow = new THREE.Mesh(floorPatch, ownMaterial(new THREE.MeshBasicMaterial({
      map: shadowTexture, transparent: true, depthWrite: false, toneMapped: false,
    })));
    shadow.rotation.x = -Math.PI / 2;
    shadow.renderOrder = -2;
    shadow.visible = false;
    scene.add(shadow);

    const previousCenter = new THREE.Vector3();
    const previousOrientation = new THREE.Quaternion();
    const previousVelocity = new THREE.Vector3();
    const previousOmega = new THREE.Vector3();
    let initialized = false;
    let movingWater = false;
    let previousReduced = false;
    let accumulated = 0;
    let fieldTime = 0;

    return {
      group, front: body,
      placeShadow(onRail) {
        shadow.visible = onRail && group.visible;
        if (!shadow.visible) return;
        group.getWorldPosition(center);
        group.getWorldQuaternion(orientation);
        normal.set(0, 0, 1).applyQuaternion(orientation);
        const radius = group.scale.x;
        const clearance = 1 - Math.sqrt(Math.max(0, 1 - normal.y * normal.y));
        shadow.position.set(center.x + .04 * radius, center.y - radius, center.z - .05 * radius);
        shadow.scale.set((1.12 + clearance) * radius, (.82 + clearance) * radius, 1);
        shadow.material.opacity = .9 / (1 + clearance * 8);
      },
      drawPhoto(photo) {
        if (!photo) return;
        drawVinylPrint(canvas, photo, entry);
        printTexture.needsUpdate = true;
        material.uniforms.uPrintReady.value = 1;
      },
      updateLiquid(dt, reduced, primary, nearby) {
        if (!group.visible || !nearby) {
          initialized = false;
          return false;
        }
        group.getWorldPosition(center);
        group.getWorldQuaternion(orientation);
        inverse.copy(orientation).invert();
        gravity.set(0, -GRAVITY, 0).applyQuaternion(inverse);
        const displacement = center.distanceTo(previousCenter);
        const turn = orientation.angleTo(previousOrientation);

        // A filter change can teleport the carousel. A hidden disc or a jump
        // in the view is not a physical strike against the water chamber.
        if (!initialized || displacement > .85 || reduced !== previousReduced || reduced) {
          if (!initialized || !reduced || reduced !== previousReduced || turn > .001) {
            water.reset(-gravity.x, -gravity.y);
            field.update(water);
          }
          previousCenter.copy(center);
          previousOrientation.copy(orientation);
          previousVelocity.set(0, 0, 0);
          previousOmega.set(0, 0, 0);
          movingWater = false;
          accumulated = fieldTime = 0;
          initialized = true;
          previousReduced = reduced;
          return false;
        }

        accumulated += dt;
        // Sample the neighbouring chambers less often than the held record.
        if (!primary && accumulated < 1 / 30) return movingWater;
        const elapsed = Math.min(accumulated, .05);
        accumulated = 0;
        // The thin chamber responds to a finite, damped transfer of hand/rail
        // acceleration. An instantaneous UI snap must not become a liquid blast.
        const smoothing = 1 - Math.exp(-10 * elapsed);
        velocity.subVectors(center, previousCenter).divideScalar(elapsed);
        velocity.lerp(previousVelocity, 1 - smoothing);
        acceleration.subVectors(velocity, previousVelocity).divideScalar(elapsed).applyQuaternion(inverse);
        previousVelocity.copy(velocity);

        // The shortest rotation between poses gives the chamber's angular
        // velocity in its own plane, including the fixed-pivot yaw/pitch motion.
        delta.copy(previousOrientation).invert().multiply(orientation);
        if (delta.w < 0) delta.set(-delta.x, -delta.y, -delta.z, -delta.w);
        omega.set(delta.x, delta.y, delta.z);
        const axisLength = omega.length();
        if (axisLength > .000001) omega.multiplyScalar(2 * Math.atan2(axisLength, delta.w) / (axisLength * elapsed));
        else omega.set(0, 0, 0);
        // Viscous oil follows more of the chamber's turn before draining back;
        // bounded entrainment keeps a normal constrained flip visibly active.
        omega.clampLength(0, 6).lerp(previousOmega, 1 - smoothing);
        const alphaZ = cap((omega.z - previousOmega.z) / elapsed, 10);
        previousOmega.copy(omega);
        previousCenter.copy(center);
        previousOrientation.copy(orientation);
        if (turn > .00065 || displacement > .0004) movingWater = true;
        if (!movingWater) return false;
        const advanced = water.step(elapsed, gravity.x - cap(acceleration.x, 6.5), gravity.y - cap(acceleration.y, 6.5),
          alphaZ, omega.z, omega.x, omega.y);
        fieldTime += elapsed;
        if ((advanced || field.active) && (primary || fieldTime >= 1 / 25 || water.sleeping)) {
          field.update(water, fieldTime, gravity.x, gravity.y);
          fieldTime = 0;
        }
        // A film can briefly finish draining after bulk sleep. Its activity is
        // derived from actual deposited oil and ends, never from an idle loop.
        movingWater = !water.sleeping || Boolean(field.active);
        return movingWater;
      },
    };
  };
}

export function mount(host, options) {
  return mountCinema(host, { ...options, createVinylEdition, createCinemaTitle });
}

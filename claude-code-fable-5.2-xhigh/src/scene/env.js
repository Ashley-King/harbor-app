import * as THREE from 'three';
import { sunPosition, moonPosition, dayState } from '../astro.js';
import { clamp, smoothstep, D2R } from '../util.js';

const col = (r, g, b) => new THREE.Color().setRGB(r, g, b);
const WARM = col(1.0, 0.6, 0.32);
const WHITE = col(1.0, 0.97, 0.92);
const MOON = col(0.62, 0.74, 1.0);

/** Compass azimuth and altitude (radians) to a scene direction pointing at the body. */
function skyDir(azimuth, altitude, out) {
  const c = Math.cos(altitude);
  return out.set(Math.sin(azimuth) * c, Math.sin(altitude), -Math.cos(azimuth) * c);
}

/**
 * Time of day: decides day or night (from Charleston's real sunrise and sunset, or
 * the manual choice), places the sun and moon where they really are, and owns the
 * lights and the shader values every part of the scene shares.
 */
export class Env {
  constructor(stage) {
    this.stage = stage;
    this.mode = 'auto';
    this.night = 1; // night is the default look until the first update says otherwise
    this.isNight = true;
    this.state = dayState(Date.now());
    this.uniforms = {
      uTime: { value: 0 },
      uNight: { value: 1 },
      uSunDir: { value: new THREE.Vector3(0.4, 0.7, 0.5).normalize() },
      uSunColor: { value: WHITE.clone() },
      uMoonDir: { value: new THREE.Vector3(-0.3, 0.8, 0.4).normalize() },
      uMoonColor: { value: MOON.clone().multiplyScalar(0.5) },
      uSkyColor: { value: col(0.42, 0.6, 0.85) },
      uDayGain: { value: col(1, 1, 1) },
      uMoonAmbient: { value: 0.06 },
      uBackdrop: { value: col(0.004, 0.009, 0.016) },
      uLightMap: { value: null },
      uPixel: { value: 1 }, // metres per device pixel
    };
    this.sun = new THREE.DirectionalLight(0xffffff, 2.5);
    this.sun.castShadow = true;
    const maxTex = stage.renderer.capabilities.maxTextureSize;
    const size = maxTex >= 8192 && (navigator.hardwareConcurrency || 4) >= 8 ? 4096 : 2048;
    this.sun.shadow.mapSize.set(size, size);
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.6;
    this.hemi = new THREE.HemisphereLight(0xbcd4ff, 0x4a4f48, 0.8);
    stage.scene.add(this.sun, this.sun.target, this.hemi);

    this.shadowPlane = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2),
      new THREE.ShadowMaterial({ color: 0x00060c, opacity: 0.4, depthWrite: false }),
    );
    this.shadowPlane.receiveShadow = true;
    this.shadowPlane.renderOrder = 5;
    this.shadowPlane.position.y = 0.06;
    stage.scene.add(this.shadowPlane);
    this._dir = new THREE.Vector3();
  }

  setMode(mode) {
    this.mode = mode;
    this._fast = true;
  }

  update(nowMs, dt, seconds) {
    const u = this.uniforms;
    u.uTime.value = seconds;
    this.state = dayState(nowMs);
    const wantNight = this.mode === 'auto' ? this.state.isNight : this.mode === 'night';
    if (wantNight !== this.isNight) {
      this.isNight = wantNight;
      this.onChange?.(wantNight);
    }
    // The automatic switch at sunrise and sunset takes about 20 seconds, like a dimmer.
    const rate = this._fast ? 1 / 1.6 : 1 / 20;
    const target = wantNight ? 1 : 0;
    this.night = clamp(this.night + Math.sign(target - this.night) * dt * rate, 0, 1);
    if (this.night === target) this._fast = false;
    const n = this.night * this.night * (3 - 2 * this.night);
    u.uNight.value = n;

    // ---- sun: the real one when it is up, otherwise a mid-morning stand-in for manual day mode
    const sp = sunPosition(nowMs);
    let az = sp.azimuth;
    let alt = sp.altitude;
    if (alt < 4 * D2R) {
      az = 135 * D2R;
      alt = 46 * D2R;
    }
    const altDeg = alt / D2R;
    skyDir(az, Math.max(alt, 13 * D2R), u.uSunDir.value);
    const warm = smoothstep(3, 26, altDeg);
    u.uSunColor.value.copy(WARM).lerp(WHITE, warm);
    const gain = 0.66 + 0.34 * smoothstep(2, 24, altDeg);
    u.uDayGain.value.setRGB(gain, gain * (0.9 + 0.1 * warm), gain * (0.78 + 0.22 * warm));
    u.uSkyColor.value.setRGB(0.34 + 0.2 * (1 - warm), 0.5, 0.74).multiplyScalar(0.55 + 0.45 * warm);

    // ---- moon
    const mp = moonPosition(nowMs);
    const moonUp = smoothstep(0, 25, mp.altitude / D2R);
    skyDir(mp.azimuth, Math.max(mp.altitude, 20 * D2R), u.uMoonDir.value);
    const moonLight = moonUp * mp.fraction;
    u.uMoonColor.value.copy(MOON).multiplyScalar(0.25 + 0.75 * moonLight);
    u.uMoonAmbient.value = 0.05 + 0.05 * moonLight;
    this.moon = { ...mp, light: moonLight };

    // ---- lights on the 3D models: sun by day, a faint moon by night
    const dir = this._dir.copy(u.uSunDir.value).lerp(u.uMoonDir.value, n).normalize();
    const c = this.stage.center;
    const rect = this.stage.viewRect();
    const half = Math.max(rect.east - rect.west, rect.north - rect.south) / 2 + 260;
    this.sun.target.position.set(c.x, 0, -c.y);
    this.sun.position.set(c.x + dir.x * 4000, dir.y * 4000, -c.y + dir.z * 4000);
    this.sun.color.copy(u.uSunColor.value).lerp(MOON, n);
    this.sun.intensity = (1.25 + 1.35 * smoothstep(4, 30, altDeg)) * (1 - n) + (0.1 + 0.22 * moonLight) * n;
    this.hemi.intensity = (0.62 + 0.3 * warm) * (1 - n) + 0.11 * n;
    this.hemi.color.setRGB(0.74 + 0.2 * (1 - warm), 0.83, 1.0).lerp(col(0.5, 0.62, 1.0), n);
    this.hemi.groundColor.setRGB(0.3, 0.34, 0.33).lerp(col(0.12, 0.14, 0.2), n);
    const cam = this.sun.shadow.camera;
    if (Math.abs(cam.right - half) > half * 0.02) {
      cam.left = -half;
      cam.right = half;
      cam.top = half;
      cam.bottom = -half;
      cam.near = 500;
      cam.far = 9000;
      cam.updateProjectionMatrix();
    }
    this.sun.castShadow = n < 0.9;
    this.sun.shadow.normalBias = clamp(((half * 2) / this.sun.shadow.mapSize.x) * 1.6, 0.25, 6);
    this.shadowPlane.material.opacity = 0.42 * (1 - n) * (0.55 + 0.45 * warm);
    this.shadowPlane.visible = n < 0.9;
    this.shadowPlane.position.set(c.x, 0.06, -c.y);
    this.shadowPlane.scale.set(half * 2.2, 1, half * 2.2);
    u.uPixel.value = this.stage.mpp / this.stage.dpr;
  }
}

import { useEffect, useRef } from "react";
import * as THREE from "three";
import { createShip, disposeGroup, setShipNight } from "./models.js";
export default function VesselPreview({ vessel, night }) {
  const host = useRef(null);
  useEffect(() => {
    if (
      !host.current ||
      !vessel.length ||
      !vessel.beam ||
      vessel.dimensionsSuspect
    )
      return;
    let renderer;
    try {
      renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
    } catch {
      return;
    }
    const el = host.current,
      w = el.clientWidth,
      h = 140;
    renderer.setSize(w, h);
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    el.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    scene.add(new THREE.AmbientLight("#d6e5ea", 2.5));
    const sun = new THREE.DirectionalLight("#fff3d1", 4);
    sun.position.set(-100, 100, 300);
    scene.add(sun);
    const group = createShip(vessel);
    setShipNight(group, night);
    group.rotation.z = -Math.PI * 0.5 + 0.1;
    scene.add(group);
    const L = vessel.length;
    const camera = new THREE.OrthographicCamera(
      -L * 0.62,
      L * 0.62,
      (L * 0.62 * h) / w,
      (-L * 0.62 * h) / w,
      1,
      5000,
    );
    camera.position.set(0, -L * 0.2, L * 2);
    camera.lookAt(0, 0, 0);
    renderer.render(scene, camera);
    return () => {
      disposeGroup(group);
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, [vessel.id, vessel.model, vessel.length, vessel.beam, night]);
  return (
    <div
      className="vessel-preview"
      ref={host}
      aria-label="Illustrative vessel model"
    >
      <span>ILLUSTRATIVE MODEL · AIS DIMENSIONS</span>
      {(!vessel.length || !vessel.beam || vessel.dimensionsSuspect) && (
        <p>
          {vessel.dimensionsSuspect
            ? "Unreliable AIS dimensions"
            : "Dimensions unknown"}
        </p>
      )}
    </div>
  );
}

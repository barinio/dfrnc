import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

export class ThreeScene {
  constructor(canvasId) {
    this.canvas = document.getElementById(canvasId);
    if (!this.canvas) throw new Error(`Canvas not found: ${canvasId}`);
    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      alpha: true,
      antialias: true,
    });
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.renderer.setSize(window.innerWidth, window.innerHeight);

    this.scene = new THREE.Scene();

    this.camera = new THREE.PerspectiveCamera(
      60,
      window.innerWidth / window.innerHeight,
      0.1,
      100
    );
    this.camera.position.set(0, 0, 8);

    // Lights — ambient + directional for glass chromatics
    const ambient = new THREE.AmbientLight(0xffffff, 0.4);
    const directional = new THREE.DirectionalLight(0xffffff, 2.5);
    directional.position.set(3, 5, 3);
    this.scene.add(ambient, directional);

    this.model = null;
    this._animFrameId = null;

    window.addEventListener('resize', () => this._onResize());
  }

  // Preload GLB — call this during Lottie phase so it's ready immediately
  loadModel(path) {
    return new Promise((resolve, reject) => {
      const loader = new GLTFLoader();
      loader.load(
        path,
        (gltf) => {
          this.model = gltf.scene;
          this.model.visible = false;
          // Scale to fit nicely in scene
          const box = new THREE.Box3().setFromObject(this.model);
          const size = box.getSize(new THREE.Vector3());
          const maxDim = Math.max(size.x, size.y, size.z);
          const scale = 1.5 / maxDim;
          this.model.scale.setScalar(scale);
          this.scene.add(this.model);
          resolve(this.model);
        },
        undefined,
        reject
      );
    });
  }

  // Calculate world-space viewport bounds at z=0 plane
  getViewportBounds() {
    const dist = this.camera.position.z;
    const vFov = (this.camera.fov * Math.PI) / 180;
    const height = 2 * Math.tan(vFov / 2) * dist;
    const width = height * this.camera.aspect;
    return { width, height };
  }

  showModel() {
    if (this.model) this.model.visible = true;
    this.canvas.style.opacity = '1';
    this._startRenderLoop();
  }

  hideModel() {
    if (this.model) this.model.visible = false;
  }

  _startRenderLoop() {
    const tick = () => {
      this._animFrameId = requestAnimationFrame(tick);
      this.renderer.render(this.scene, this.camera);
    };
    tick();
  }

  stopRenderLoop() {
    if (this._animFrameId) cancelAnimationFrame(this._animFrameId);
  }

  _onResize() {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }
}

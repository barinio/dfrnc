import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

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
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.4;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    this.scene = new THREE.Scene();

    // Environment map — provides reflections for the glass material
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();

    this.camera = new THREE.PerspectiveCamera(
      60,
      window.innerWidth / window.innerHeight,
      0.1,
      100
    );
    this.camera.position.set(0, 0, 8);

    // Low ambient — environment handles most illumination
    const ambient = new THREE.AmbientLight(0xffffff, 0.05);
    // Cool blue key light
    const key = new THREE.PointLight(0x4488ff, 8, 25);
    key.position.set(-4, 3, 6);
    // Warm white fill
    const fill = new THREE.PointLight(0xffeedd, 4, 20);
    fill.position.set(5, -2, 4);
    // Purple rim
    const rim = new THREE.PointLight(0x8833ff, 5, 18);
    rim.position.set(0, 5, -4);
    this.scene.add(ambient, key, fill, rim);

    this.model = null;
    this._animFrameId = null;

    window.addEventListener('resize', () => this._onResize());
  }

  // Preload GLB — call this during Lottie phase so it's ready immediately
  loadModel(path) {
    return new Promise((resolve, reject) => {
      const dracoLoader = new DRACOLoader();
      dracoLoader.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.6/');
      const loader = new GLTFLoader();
      loader.setDRACOLoader(dracoLoader);
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
          this._applyGlassMaterial();
          this.scene.add(this.model);
          resolve(this.model);
        },
        undefined,
        reject
      );
    });
  }

  _applyGlassMaterial() {
    const mat = new THREE.MeshPhysicalMaterial({
      color: new THREE.Color(0x050510),
      metalness: 1.0,
      roughness: 0.08,
      iridescence: 1.0,
      iridescenceIOR: 2.0,
      iridescenceThicknessRange: [100, 800],
      envMapIntensity: 3.0,
      side: THREE.DoubleSide,
    });
    this.model.traverse((child) => {
      if (child.isMesh) child.material = mat;
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

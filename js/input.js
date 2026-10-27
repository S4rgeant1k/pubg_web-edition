// Ввод: клавиатура, мышь, pointer lock, чувствительность, отдача камеры.

const BINDINGS = {
  forward: ['KeyW', 'ArrowUp'],
  back: ['KeyS', 'ArrowDown'],
  left: ['KeyA', 'ArrowLeft'],
  right: ['KeyD', 'ArrowRight'],
  jump: ['Space'],
  sprint: ['ShiftLeft', 'ShiftRight'],
  crouch: ['ControlLeft', 'KeyC'],
  reload: ['KeyR'],
  heal: ['KeyH'],
  slot1: ['Digit1'],
  slot2: ['Digit2'],
  interact: ['KeyF'],
  map: ['KeyM'],
  inventory: ['Tab'],
};

export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.yaw = 0;
    this.pitch = 0;
    this.move = { x: 0, z: 0 };
    this.sensitivity = 1;
    this.locked = false;
    this.wasMouseDown = false;
    this.mouseDown = false;
    this.aimDown = false;
    this.keys = new Set();
    this.pressedSet = new Set();
    this.onLockChange = null;
    this.onKey = null;

    this._bind();
  }

  _bind() {
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Tab') e.preventDefault();
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
      if (e.repeat) return;
      this.keys.add(e.code);
      this.pressedSet.add(e.code);
      this.onKey?.(e.code, e);
    });
    window.addEventListener('keyup', (e) => {
      this.keys.delete(e.code);
    });
    window.addEventListener('blur', () => {
      this.keys.clear();
      this.mouseDown = false;
      this.aimDown = false;
    });

    this.canvas.addEventListener('mousedown', (e) => {
      if (e.button === 0) { this.mouseDown = true; this.wasMouseDown = true; }
      if (e.button === 2) this.aimDown = true;
    });
    window.addEventListener('mouseup', (e) => {
      if (e.button === 0) this.mouseDown = false;
      if (e.button === 2) this.aimDown = false;
    });
    window.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      const s = 0.0022 * this.sensitivity;
      this.yaw -= e.movementX * s;
      this.pitch -= e.movementY * s;
      this.pitch = Math.max(-1.5, Math.min(1.5, this.pitch));
    });
    window.addEventListener('wheel', (e) => {
      if (this.locked && this.onWheel) this.onWheel(Math.sign(e.deltaY));
    }, { passive: true });

    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === this.canvas;
      if (!this.locked) { this.mouseDown = false; this.aimDown = false; }
      this.onLockChange?.(this.locked);
    });
  }

  requestLock() {
    if (document.pointerLockElement !== this.canvas) {
      const p = this.canvas.requestPointerLock?.({ unadjustedMovement: true });
      if (p && p.catch) p.catch(() => this.canvas.requestPointerLock());
    }
  }

  exitLock() {
    if (document.pointerLockElement) document.exitPointerLock();
  }

  down(action) {
    if (action === 'fire') return this.mouseDown && this.locked;
    if (action === 'aim') return this.aimDown && this.locked;
    const keys = BINDINGS[action];
    if (!keys) return false;
    for (const k of keys) if (this.keys.has(k)) return true;
    return false;
  }

  pressed(action) {
    const keys = BINDINGS[action];
    if (!keys) return false;
    for (const k of keys) {
      if (this.pressedSet.has(k)) { this.pressedSet.delete(k); return true; }
    }
    return false;
  }

  addRecoil(pitch, yaw) {
    this.pitch = Math.min(1.5, this.pitch + pitch);
    this.yaw += yaw;
  }

  endFrame() {
    this.pressedSet.clear();
    const f = this.down('forward') ? 1 : 0;
    const b = this.down('back') ? 1 : 0;
    const l = this.down('left') ? 1 : 0;
    const r = this.down('right') ? 1 : 0;
    this.move.z = f - b;
    this.move.x = r - l;
    const len = Math.hypot(this.move.x, this.move.z);
    if (len > 1) { this.move.x /= len; this.move.z /= len; }
  }
}

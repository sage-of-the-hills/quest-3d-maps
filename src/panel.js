// A small control panel drawn on a canvas, shown inside VR / AR.
// Point at a button with a controller (or your hand) and press the trigger / pinch.

import * as THREE from 'three';

export class Panel {
  constructor({ width = 0.62, height = 0.225, px = 1024 } = {}) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = px;
    this.canvas.height = Math.round((px * height) / width);
    this.ctx = this.canvas.getContext('2d');
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(width, height),
      new THREE.MeshBasicMaterial({ map: this.texture, transparent: true, side: THREE.DoubleSide })
    );
    this.mesh.name = 'panel';
    this.buttons = [];
    this.title = '';
    this.status = '';
    this.hovered = new Set();
  }

  setButtons(buttons) {
    this.buttons = buttons; // [{id, label, row, active}]
    this.layout();
    this.draw();
  }

  setText(title, status) {
    this.title = title;
    this.status = status;
    this.draw();
  }

  layout() {
    const W = this.canvas.width;
    const pad = 24;
    const rows = {};
    this.buttons.forEach((b) => (rows[b.row] ||= []).push(b));
    const rowY = { 0: 104, 1: 104 + 96 + 16 };
    for (const [r, list] of Object.entries(rows)) {
      const bw = (W - pad * (list.length + 1)) / list.length;
      list.forEach((b, i) => Object.assign(b, { x: pad + i * (bw + pad), y: rowY[r], w: bw, h: 88 }));
    }
  }

  draw() {
    const { ctx, canvas } = this;
    const W = canvas.width, H = canvas.height;
    ctx.clearRect(0, 0, W, H);
    roundRect(ctx, 4, 4, W - 8, H - 8, 36);
    ctx.fillStyle = 'rgba(16, 22, 34, 0.88)';
    ctx.fill();

    ctx.fillStyle = '#ffffff';
    ctx.font = '600 44px system-ui, sans-serif';
    ctx.textBaseline = 'middle';
    ctx.fillText(this.title, 28, 52);
    ctx.fillStyle = '#9fb3c8';
    ctx.font = '32px system-ui, sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText(this.status, W - 28, 52);
    ctx.textAlign = 'left';

    for (const b of this.buttons) {
      roundRect(ctx, b.x, b.y, b.w, b.h, 22);
      ctx.fillStyle = b.active ? '#3d7eff' : this.hovered.has(b.id) ? '#3a4a63' : '#26324a';
      ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.font = '600 36px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(b.label, b.x + b.w / 2, b.y + b.h / 2 + 2);
      ctx.textAlign = 'left';
    }

    ctx.fillStyle = '#7d8ea3';
    ctx.font = '22px system-ui, sans-serif';
    ctx.fillText('Map data © OpenStreetMap contributors', 28, H - 26);
    this.texture.needsUpdate = true;
  }

  // uv from a raycast hit → button id (or null)
  buttonAt(uv) {
    const x = uv.x * this.canvas.width;
    const y = (1 - uv.y) * this.canvas.height;
    const b = this.buttons.find((b) => x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h);
    return b ? b.id : null;
  }

  setHovered(ids) {
    const changed = ids.size !== this.hovered.size || [...ids].some((i) => !this.hovered.has(i));
    if (changed) {
      this.hovered = ids;
      this.draw();
    }
  }
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

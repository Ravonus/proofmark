/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-return */
/**
 * Vitest global setup — polyfill browser APIs that pdfjs-dist expects
 * but are unavailable in Node.
 */

if (typeof globalThis.DOMMatrix === "undefined") {
  globalThis.DOMMatrix = class DOMMatrix {
    a = 1;
    b = 0;
    c = 0;
    d = 1;
    e = 0;
    f = 0;
    m11 = 1;
    m12 = 0;
    m13 = 0;
    m14 = 0;
    m21 = 0;
    m22 = 1;
    m23 = 0;
    m24 = 0;
    m31 = 0;
    m32 = 0;
    m33 = 1;
    m34 = 0;
    m41 = 0;
    m42 = 0;
    m43 = 0;
    m44 = 1;
    is2D = true;
    isIdentity = true;
    constructor(_init?: string | number[]) {
      /* stub */
    }
    inverse() {
      return new DOMMatrix();
    }
    multiply() {
      return new DOMMatrix();
    }
    translate() {
      return new DOMMatrix();
    }
    scale() {
      return new DOMMatrix();
    }
    rotate() {
      return new DOMMatrix();
    }
    transformPoint(p: any) {
      return p;
    }
    toFloat32Array() {
      return new Float32Array(16);
    }
    toFloat64Array() {
      return new Float64Array(16);
    }
    toString() {
      return "matrix(1, 0, 0, 1, 0, 0)";
    }
    static fromMatrix() {
      return new DOMMatrix();
    }
    static fromFloat32Array() {
      return new DOMMatrix();
    }
    static fromFloat64Array() {
      return new DOMMatrix();
    }
  } as any;
}

if (typeof globalThis.Path2D === "undefined") {
  globalThis.Path2D = class Path2D {
    constructor(_path?: string | Path2D) {
      /* stub */
    }
    addPath() {
      /* stub */
    }
    closePath() {
      /* stub */
    }
    moveTo() {
      /* stub */
    }
    lineTo() {
      /* stub */
    }
    bezierCurveTo() {
      /* stub */
    }
    quadraticCurveTo() {
      /* stub */
    }
    arc() {
      /* stub */
    }
    arcTo() {
      /* stub */
    }
    ellipse() {
      /* stub */
    }
    rect() {
      /* stub */
    }
  } as any;
}

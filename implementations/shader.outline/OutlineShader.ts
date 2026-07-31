// @archigraph renderer.outline-shader
// Sobel-based edge detection post-processing shader

import * as THREE from 'three';

const outlineVertexShader = /* glsl */ `
varying vec2 vUv;

void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const outlineFragmentShader = /* glsl */ `
uniform sampler2D tDepth;
uniform sampler2D tDiffuse;
uniform vec2 resolution;
uniform float cameraNear;
uniform float cameraFar;
uniform vec3 outlineColor;
uniform float threshold;
uniform float lineWidth;

varying vec2 vUv;

float readDepth(sampler2D depthSampler, vec2 coord) {
  float fragCoordZ = texture2D(depthSampler, coord).x;
  float viewZ = perspectiveDepthToViewZ(fragCoordZ, cameraNear, cameraFar);
  return viewZToOrthographicDepth(viewZ, cameraNear, cameraFar);
}

void main() {
  vec2 texel = vec2(lineWidth / resolution.x, lineWidth / resolution.y);

  // Sample depth in a 3x3 kernel
  float d00 = readDepth(tDepth, vUv + texel * vec2(-1.0, -1.0));
  float d01 = readDepth(tDepth, vUv + texel * vec2( 0.0, -1.0));
  float d02 = readDepth(tDepth, vUv + texel * vec2( 1.0, -1.0));
  float d10 = readDepth(tDepth, vUv + texel * vec2(-1.0,  0.0));
  float d12 = readDepth(tDepth, vUv + texel * vec2( 1.0,  0.0));
  float d20 = readDepth(tDepth, vUv + texel * vec2(-1.0,  1.0));
  float d21 = readDepth(tDepth, vUv + texel * vec2( 0.0,  1.0));
  float d22 = readDepth(tDepth, vUv + texel * vec2( 1.0,  1.0));

  // Sobel operators
  float sobelX = d00 + 2.0 * d10 + d20 - d02 - 2.0 * d12 - d22;
  float sobelY = d00 + 2.0 * d01 + d02 - d20 - 2.0 * d21 - d22;

  float edge = sqrt(sobelX * sobelX + sobelY * sobelY);

  vec4 color = texture2D(tDiffuse, vUv);

  if (edge > threshold) {
    color.rgb = mix(color.rgb, outlineColor, smoothstep(threshold, threshold * 2.0, edge));
  }

  gl_FragColor = color;
}
`;

export interface OutlineShaderUniforms {
  tDepth: { value: THREE.Texture | null };
  tDiffuse: { value: THREE.Texture | null };
  resolution: { value: THREE.Vector2 };
  cameraNear: { value: number };
  cameraFar: { value: number };
  outlineColor: { value: THREE.Vector3 };
  threshold: { value: number };
  lineWidth: { value: number };
}

export function createOutlineShaderMaterial(options?: {
  outlineColor?: THREE.Vector3;
  threshold?: number;
  lineWidth?: number;
}): THREE.ShaderMaterial {
  const uniforms: Record<string, THREE.IUniform> = {
    tDepth: { value: null },
    tDiffuse: { value: null },
    resolution: { value: new THREE.Vector2(1, 1) },
    cameraNear: { value: 0.1 },
    cameraFar: { value: 1000 },
    outlineColor: { value: options?.outlineColor ?? new THREE.Vector3(0.0, 0.0, 0.0) },
    threshold: { value: options?.threshold ?? 0.002 },
    lineWidth: { value: options?.lineWidth ?? 1.0 },
  };

  return new THREE.ShaderMaterial({
    uniforms,
    vertexShader: outlineVertexShader,
    fragmentShader: outlineFragmentShader,
    depthWrite: false,
    depthTest: false,
  });
}

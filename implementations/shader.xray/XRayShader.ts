// @archigraph renderer.xray-shader
// X-ray transparency shader showing internal geometry

import * as THREE from 'three';

const xrayVertexShader = /* glsl */ `
varying vec3 vNormal;
varying vec3 vViewPosition;

void main() {
  vNormal = normalize(normalMatrix * normal);
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  vViewPosition = -mvPosition.xyz;
  gl_Position = projectionMatrix * mvPosition;
}
`;

const xrayFragmentShader = /* glsl */ `
uniform vec3 baseColor;
uniform float baseOpacity;
uniform float edgeFalloff;
uniform float fresnelBias;
uniform float fresnelScale;
uniform float fresnelPower;

varying vec3 vNormal;
varying vec3 vViewPosition;

void main() {
  vec3 viewDir = normalize(vViewPosition);
  float dotProduct = abs(dot(viewDir, vNormal));

  // Fresnel-based opacity: edges are more opaque, center is more transparent
  float fresnel = fresnelBias + fresnelScale * pow(1.0 - dotProduct, fresnelPower);
  fresnel = clamp(fresnel, 0.0, 1.0);

  // Edge darkening for better visibility of geometry silhouettes
  float edgeFactor = pow(1.0 - dotProduct, edgeFalloff);
  vec3 color = mix(baseColor, baseColor * 0.5, edgeFactor);

  float alpha = mix(baseOpacity * 0.1, baseOpacity, fresnel);

  gl_FragColor = vec4(color, alpha);
}
`;

const xrayWireframeFragmentShader = /* glsl */ `
uniform vec3 wireColor;
uniform float wireOpacity;

void main() {
  gl_FragColor = vec4(wireColor, wireOpacity);
}
`;

/**
 * Creates an X-ray shader material that shows internal geometry
 * with fresnel-based transparency (edges more visible, flat faces transparent).
 */
export function createXRayMaterial(options?: {
  color?: THREE.Color;
  opacity?: number;
  edgeFalloff?: number;
}): THREE.ShaderMaterial {
  const color = options?.color ?? new THREE.Color(0.6, 0.7, 0.9);

  return new THREE.ShaderMaterial({
    uniforms: {
      baseColor: { value: new THREE.Vector3(color.r, color.g, color.b) },
      baseOpacity: { value: options?.opacity ?? 0.3 },
      edgeFalloff: { value: options?.edgeFalloff ?? 2.0 },
      fresnelBias: { value: 0.1 },
      fresnelScale: { value: 1.0 },
      fresnelPower: { value: 2.0 },
    },
    vertexShader: xrayVertexShader,
    fragmentShader: xrayFragmentShader,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    side: THREE.DoubleSide,
    blending: THREE.NormalBlending,
  });
}

/**
 * Creates a simple X-ray material using Three.js built-in MeshBasicMaterial.
 * Simpler fallback without custom shaders.
 */
export function createXRayBasicMaterial(options?: {
  color?: number;
  opacity?: number;
}): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({
    color: options?.color ?? 0x99aacc,
    transparent: true,
    opacity: options?.opacity ?? 0.3,
    depthWrite: false,
    side: THREE.DoubleSide,
    wireframe: false,
  });
}

/**
 * Creates a wireframe overlay material for X-ray mode.
 * Renders edges on top of the transparent faces.
 */
export function createXRayWireframeMaterial(options?: {
  color?: number;
  opacity?: number;
}): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      wireColor: { value: new THREE.Vector3(0.3, 0.4, 0.6) },
      wireOpacity: { value: options?.opacity ?? 0.5 },
    },
    vertexShader: xrayVertexShader,
    fragmentShader: xrayWireframeFragmentShader,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    wireframe: true,
  });
}

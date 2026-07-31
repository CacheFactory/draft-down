// @archigraph renderer.selection-shader
// Stencil-based selection highlight shader

import * as THREE from 'three';

const selectionVertexShader = /* glsl */ `
uniform float outlineThickness;

void main() {
  vec3 norm = normalize(normalMatrix * normal);
  vec4 pos = modelViewMatrix * vec4(position, 1.0);

  // Push vertices outward along normal for outline effect
  pos.xyz += norm * outlineThickness;

  gl_Position = projectionMatrix * pos;
}
`;

const selectionFragmentShader = /* glsl */ `
uniform vec3 outlineColor;
uniform float opacity;

void main() {
  gl_FragColor = vec4(outlineColor, opacity);
}
`;

const selectionOverlayVertexShader = /* glsl */ `
varying vec3 vNormal;
varying vec3 vViewPosition;

void main() {
  vNormal = normalize(normalMatrix * normal);
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  vViewPosition = -mvPosition.xyz;
  gl_Position = projectionMatrix * mvPosition;
}
`;

const selectionOverlayFragmentShader = /* glsl */ `
uniform vec3 overlayColor;
uniform float opacity;
uniform float fresnelPower;

varying vec3 vNormal;
varying vec3 vViewPosition;

void main() {
  vec3 viewDir = normalize(vViewPosition);
  float fresnel = pow(1.0 - abs(dot(viewDir, vNormal)), fresnelPower);
  float alpha = mix(opacity * 0.3, opacity, fresnel);
  gl_FragColor = vec4(overlayColor, alpha);
}
`;

export const SELECTION_COLOR = new THREE.Vector3(0.2, 0.5, 1.0); // bright blue
export const PRE_SELECTION_COLOR = new THREE.Vector3(0.27, 0.53, 1.0); // blue

/**
 * Creates a stencil-based outline material for selected objects.
 * Render the object once normally, then render again with this material
 * at a slightly larger scale using the stencil buffer.
 */
export function createSelectionOutlineMaterial(options?: {
  color?: THREE.Vector3;
  thickness?: number;
  opacity?: number;
}): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      outlineColor: { value: options?.color ?? SELECTION_COLOR.clone() },
      outlineThickness: { value: options?.thickness ?? 0.03 },
      opacity: { value: options?.opacity ?? 1.0 },
    },
    vertexShader: selectionVertexShader,
    fragmentShader: selectionFragmentShader,
    side: THREE.BackSide,
    depthTest: true,
    depthWrite: false,
    transparent: true,
  });
}

/**
 * Creates a color overlay material for selected objects.
 * Applied as a second pass with additive blending.
 */
export function createSelectionOverlayMaterial(options?: {
  color?: THREE.Vector3;
  opacity?: number;
  fresnelPower?: number;
}): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      overlayColor: { value: options?.color ?? SELECTION_COLOR.clone() },
      opacity: { value: options?.opacity ?? 0.4 },
      fresnelPower: { value: options?.fresnelPower ?? 2.0 },
    },
    vertexShader: selectionOverlayVertexShader,
    fragmentShader: selectionOverlayFragmentShader,
    transparent: true,
    depthTest: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
}

/**
 * Creates a pre-selection (hover) highlight material.
 * Thinner outline with orange color.
 */
export function createPreSelectionMaterial(): THREE.ShaderMaterial {
  return createSelectionOutlineMaterial({
    color: PRE_SELECTION_COLOR.clone(),
    thickness: 0.02,
    opacity: 0.8,
  });
}

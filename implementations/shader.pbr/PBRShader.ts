// @archigraph renderer.pbr-shader
// PBR material factory using Three.js MeshStandardMaterial

import * as THREE from 'three';
import { MaterialDef, Color } from '../../src/core/types';

const textureLoader = new THREE.TextureLoader();
const textureCache = new Map<string, THREE.Texture>();

function colorToThreeColor(color: Color): THREE.Color {
  return new THREE.Color(color.r, color.g, color.b);
}

function loadTexture(path: string): THREE.Texture {
  const cached = textureCache.get(path);
  if (cached) return cached;

  const texture = textureLoader.load(path);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  textureCache.set(path, texture);
  return texture;
}

/**
 * Creates a Three.js MeshStandardMaterial from a MaterialDef.
 * Handles albedo color, roughness, metalness, and texture maps.
 */
export function createPBRMaterial(materialDef: MaterialDef): THREE.MeshStandardMaterial {
  const params: THREE.MeshStandardMaterialParameters = {
    color: colorToThreeColor(materialDef.color),
    roughness: materialDef.roughness,
    metalness: materialDef.metalness,
    transparent: materialDef.opacity < 1.0,
    opacity: materialDef.opacity,
    side: THREE.DoubleSide,
  };

  if (materialDef.albedoMap) {
    params.map = loadTexture(materialDef.albedoMap);
  }

  if (materialDef.normalMap) {
    const normalTex = loadTexture(materialDef.normalMap);
    normalTex.colorSpace = THREE.LinearSRGBColorSpace;
    params.normalMap = normalTex;
    params.normalScale = new THREE.Vector2(1, 1);
  }

  if (materialDef.roughnessMap) {
    const roughTex = loadTexture(materialDef.roughnessMap);
    roughTex.colorSpace = THREE.LinearSRGBColorSpace;
    params.roughnessMap = roughTex;
  }

  if (materialDef.metalnessMap) {
    const metalTex = loadTexture(materialDef.metalnessMap);
    metalTex.colorSpace = THREE.LinearSRGBColorSpace;
    params.metalnessMap = metalTex;
  }

  const material = new THREE.MeshStandardMaterial(params);
  material.name = materialDef.name;
  material.userData.materialDefId = materialDef.id;

  return material;
}

/**
 * Updates an existing MeshStandardMaterial with changes from a MaterialDef.
 */
export function updatePBRMaterial(
  material: THREE.MeshStandardMaterial,
  materialDef: MaterialDef,
): void {
  material.color.copy(colorToThreeColor(materialDef.color));
  material.roughness = materialDef.roughness;
  material.metalness = materialDef.metalness;
  material.opacity = materialDef.opacity;
  material.transparent = materialDef.opacity < 1.0;
  material.name = materialDef.name;

  if (materialDef.albedoMap) {
    material.map = loadTexture(materialDef.albedoMap);
  } else {
    material.map = null;
  }

  if (materialDef.normalMap) {
    const normalTex = loadTexture(materialDef.normalMap);
    normalTex.colorSpace = THREE.LinearSRGBColorSpace;
    material.normalMap = normalTex;
  } else {
    material.normalMap = null;
  }

  if (materialDef.roughnessMap) {
    const roughTex = loadTexture(materialDef.roughnessMap);
    roughTex.colorSpace = THREE.LinearSRGBColorSpace;
    material.roughnessMap = roughTex;
  } else {
    material.roughnessMap = null;
  }

  if (materialDef.metalnessMap) {
    const metalTex = loadTexture(materialDef.metalnessMap);
    metalTex.colorSpace = THREE.LinearSRGBColorSpace;
    material.metalnessMap = metalTex;
  } else {
    material.metalnessMap = null;
  }

  material.needsUpdate = true;
}

/**
 * Creates a default PBR material (light gray, non-metallic).
 */
export function createDefaultPBRMaterial(): THREE.MeshStandardMaterial {
  return createPBRMaterial({
    id: 'default',
    name: 'Default',
    color: { r: 0.85, g: 0.85, b: 0.85 },
    opacity: 1.0,
    roughness: 0.7,
    metalness: 0.0,
  });
}

/**
 * Disposes of all cached textures. Call on application shutdown.
 */
export function disposeTextureCache(): void {
  textureCache.forEach((texture) => texture.dispose());
  textureCache.clear();
}

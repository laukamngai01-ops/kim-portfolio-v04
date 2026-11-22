import * as THREE from '../vendor/three/three.module.min.js';

// Independently authored live-fluid optics over an original photographic surface plate.
// The particle field determines occupancy only, never a painted water height.
// Optical depths are Beer-Lambert coefficients for one nominal chamber depth.
const dyes = [
  [2.50, .95, .88], // petrol
  [.52, 1.12, 2.35], // amber
  [.90, 2.05, 1.80], // garnet
  [1.05, .88, 2.00], // olive
  [1.45, 1.70, .95], // violet
  [1.95, 1.25, .92], // slate
];

const vertexShader = /* glsl */`
  varying vec2 vDisc;
  varying vec3 vNormal;
  varying vec3 vViewPosition;
  varying vec3 vTangent;
  varying vec3 vBitangent;
  void main() {
    vDisc = position.xy;
    vec4 positionView = modelViewMatrix * vec4(position, 1.0);
    vViewPosition = -positionView.xyz;
    vNormal = normalize(normalMatrix * normal);
    vTangent = normalize(mat3(modelViewMatrix) * vec3(1.0, 0.0, 0.0));
    vBitangent = normalize(mat3(modelViewMatrix) * vec3(0.0, 1.0, 0.0));
    gl_Position = projectionMatrix * positionView;
  }
`;

const fragmentShader = /* glsl */`
  uniform sampler2D uWaterField;
  uniform sampler2D uPrint;
  uniform sampler2D uSurface;
  uniform vec2 uFieldTexel;
  uniform vec2 uSurfaceTexel;
  uniform float uDensityScale;
  uniform float uHasWater;
  uniform float uHasSurface;
  uniform float uPrintReady;
  uniform float uPrintRadius;
  uniform float uPrintFeather;
  uniform vec3 uAbsorption;
  uniform vec3 uStudioBacking;
  varying vec2 vDisc;
  varying vec3 vNormal;
  varying vec3 vViewPosition;
  varying vec3 vTangent;
  varying vec3 vBitangent;

  const float PI = 3.141592653589793;
  const float SURFACE_DENSITY = .18;
  float sq(float x) { return x * x; }
  float plateLuma(vec3 color) { return dot(color, vec3(.2126, .7152, .0722)); }
  float fresnel(float cosine, float ior) {
    float f0 = sq((ior - 1.0) / (ior + 1.0));
    return f0 + (1.0 - f0) * pow(clamp(1.0 - cosine, 0.0, 1.0), 5.0);
  }
  float field(vec2 uv) {
    return texture2D(uWaterField, clamp(uv, vec2(0.0), vec2(1.0))).r * uDensityScale;
  }
  // Restrained view-dependent light supplements the photographed surface.
  // No radial spokes are drawn: both broad sheen and track irregularity come
  // from the original surface plate when available.
  vec3 studio(vec3 direction) {
    vec3 d = normalize(direction);
    float window = exp(-sq((d.x + .48) / .075) - sq((d.y - .55) / .60));
    float flag = exp(-sq((d.x - .4) / .18) - sq((d.y + .2) / .80));
    return vec3(.24, .255, .27) * (1.0 - flag * .7) + vec3(1.0, .98, .94) * window * .7;
  }
  vec3 surfaceAt(vec2 uv) {
    return texture2D(uSurface, clamp(uv, vec2(0.0), vec2(1.0))).rgb;
  }

  void main() {
    vec2 p = vDisc, uv = p * .5 + .5;
    float radius = length(p);
    float aa = max(fwidth(radius), .0003);
    float pixel = max(length(fwidth(p)), .0007);
    float coverage = (1.0 - smoothstep(1.0 - aa, 1.0, radius))
      * smoothstep(.033, .033 + aa, radius);
    if (coverage < .025) discard;
    vec3 V = normalize(vViewPosition);
    vec3 T = normalize(vTangent), B = normalize(vBitangent);
    vec3 N = normalize(vNormal) * (gl_FrontFacing ? 1.0 : -1.0);
    vec2 radial2 = p / max(radius, .001);
    vec3 radial = normalize(T * radial2.x + B * radial2.y);

    float density = 0.0;
    float depositedFilm = 0.0;
    vec2 gradient = vec2(0.0);
    if (uHasWater > .5) {
      density = field(uv);
      depositedFilm = texture2D(uWaterField, uv).b * .05;
      gradient = vec2(field(uv + vec2(uFieldTexel.x, 0.0)) - field(uv - vec2(uFieldTexel.x, 0.0)),
                      field(uv + vec2(0.0, uFieldTexel.y)) - field(uv - vec2(0.0, uFieldTexel.y)))
        / (uFieldTexel * 4.0);
    }
    float gradientLength = length(gradient);
    vec2 inward = gradient / max(gradientLength, .001);
    float distanceInside = (density - SURFACE_DENSITY) / max(gradientLength, .6);
    float liquidAA = max(fwidth(density) * .5, .009);
    float chamber = (1.0 - smoothstep(.95 - aa, .95 + aa, radius))
      * smoothstep(.055 - aa, .055 + aa, radius);
    float wet = smoothstep(SURFACE_DENSITY - liquidAA, SURFACE_DENSITY + liquidAA, density) * chamber;

    // The fallback is deliberately quiet. It is never a second system of
    // synthetic rings over the photographed plate. Variable pitch/runout is
    // only retained for loading failure, without broad illustrated spokes.
    float trackPhase = radius * PI * 227.0 + sin(radius * 31.0) * 2.3 + sin(radius * 83.0) * .45;
    float trackAA = 1.0 - smoothstep(1.0, 3.4, fwidth(trackPhase));
    float fallbackGroove = cos(trackPhase) * trackAA;
    vec3 plate = vec3(.24, .25, .25) * (1.0 + fallbackGroove * .035);
    vec3 softPlate = plate;
    vec2 plateSlope = vec2(0.0);
    if (uHasSurface > .5) {
      vec3 fixedPlate = surfaceAt(uv);
      vec3 fixedBroad = texture2D(uSurface, uv, 3.5).rgb;
      // Broad photographic reflection follows the studio half-vector, while
      // scratches and fine groove detail stay tied to the actual pressing.
      // Rotate only at the same radius, preserving all radial track spacing.
      vec3 halfVector = normalize(V + normalize(vec3(-.48, .78, .88)));
      vec2 lightPlane = vec2(dot(halfVector, T), dot(halfVector, B));
      float lightLength = length(lightPlane);
      vec2 stableDirection = mix(vec2(-.7071, .7071), lightPlane / max(lightLength, .0001), smoothstep(.045, .13, lightLength));
      if (dot(stableDirection, stableDirection) < .000001) stableDirection = vec2(-.7071, .7071);
      float reflectionAngle = 2.35619449 - atan(stableDirection.y, stableDirection.x);
      float cs = cos(reflectionAngle), sn = sin(reflectionAngle);
      vec2 reflectionUV = vec2(p.x * cs - p.y * sn, p.x * sn + p.y * cs) * .5 + .5;
      softPlate = texture2D(uSurface, reflectionUV, 3.5).rgb;
      vec3 fixedMicrodetail = clamp(fixedPlate / max(fixedBroad, vec3(.035)), vec3(.55), vec3(1.7));
      plate = softPlate * fixedMicrodetail;
      plateSlope = vec2(plateLuma(surfaceAt(uv + vec2(uSurfaceTexel.x, 0.0))) - plateLuma(surfaceAt(uv - vec2(uSurfaceTexel.x, 0.0))),
                        plateLuma(surfaceAt(uv + vec2(0.0, uSurfaceTexel.y))) - plateLuma(surfaceAt(uv - vec2(0.0, uSurfaceTexel.y))));
    }
    float detail = clamp(plateLuma(plate - softPlate), -.10, .10);
    float outerBevel = smoothstep(.977, .999, radius);
    float innerBevel = 1.0 - smoothstep(.034, .047, radius);
    vec3 sheetNormal = normalize(N - T * plateSlope.x * .35 - B * plateSlope.y * .35
      + radial * (outerBevel * .31 - innerBevel * .22));
    float facing = clamp(dot(sheetNormal, V), .025, 1.0);
    float surfaceF = fresnel(facing, 1.54);
    vec3 movingReflection = studio(reflect(-V, sheetNormal)) * surfaceF * .22;

    // Reconstruct a transmission plate against this neutral studio, retaining
    // the photographed smoke, fine variable grooves, wear and bevel glints.
    // Its gray photographic backdrop is NOT pasted behind the user's work.
    vec3 plateTransmission = mix(vec3(.71), clamp(plate / max(uStudioBacking, vec3(.01)), vec3(.025), vec3(.96)), .90);
    vec3 photographedGlint = max(plate - softPlate, vec3(0.0)) * .48
      + plate * smoothstep(.27, .62, plateLuma(plate)) * .14;
    float opticalPath = 1.0 / sqrt(max(.1, 1.0 - (1.0 - facing * facing) / sq(1.46)));
    // The thicker dyed oil keeps its hue in a nearly constant-depth cavity.
    // Only the real meniscus tapers; no pool-centre fog or fake distance depth.
    float edgeTaper = mix(.78, 1.0, smoothstep(0.0, max(.009, pixel), distanceInside));
    vec3 oilTransmission = exp(-uAbsorption * opticalPath * .78 * edgeTaper);
    vec3 transmission = plateTransmission * mix(vec3(1.0), oilTransmission, wet);
    // Film exists only where the actual moving bulk has recently touched.
    // It is at most 5% of cavity depth, with no additional shape/highlight.
    transmission *= exp(-uAbsorption * depositedFilm * (1.0 - wet));
    vec3 reflection = photographedGlint + movingReflection;

    // The live density gradient provides the optical normal of the curved
    // oil-air boundary. Reflection and absorption remain a narrow real edge.
    float edgeWidth = max(.0028, pixel * .56);
    float lip = exp(-sq(distanceInside / edgeWidth)) * chamber;
    float meniscusAngle = clamp(.55 - distanceInside / max(.014, pixel * 1.7), .0, 1.0) * 1.42;
    vec3 edgeNormal = normalize(N * cos(meniscusAngle) - (T * inward.x + B * inward.y) * sin(meniscusAngle));
    float edgeF = fresnel(abs(dot(edgeNormal, V)), 1.46);
    reflection += studio(reflect(-V, edgeNormal)) * edgeF * lip * .65;
    float innerLip = exp(-sq((distanceInside - max(.0045, pixel * .8)) / max(.002, pixel * .52))) * wet;
    transmission *= 1.0 - innerLip * .46;
    // A very thin refracted glint sits inside the oily lip, independent of any
    // arbitrary surface height or procedural bubble placement.
    float glint = exp(-sq((distanceInside - max(.007, pixel * 1.35)) / max(.0014, pixel * .4))) * wet;
    reflection += vec3(.10, .11, .11) * glint * max(.05, dot(-inward, normalize(vec2(-.55, .83))));
    transmission *= 1.0 - outerBevel * .12;

    // A front-only feathered print occupies ~80% of the annulus by weighted
    // alpha area. UVs extend through the complete feather band, avoiding the
    // clamped edge streaks of sampling past a small circular image texture.
    float printMask = 0.0;
    vec3 printColor = vec3(0.0);
    float printOuter = uPrintRadius + uPrintFeather;
    if (gl_FrontFacing && uPrintReady > .5 && radius < printOuter) {
      printColor = texture2D(uPrint, clamp(p / printOuter * .5 + .5, vec2(0.0), vec2(1.0))).rgb;
      printMask = 1.0 - smoothstep(uPrintRadius - uPrintFeather, printOuter, radius);
    }
    vec3 chassis = uStudioBacking * transmission + reflection;
    // The photograph remains an opaque pigment beneath restrained surface
    // detail. There is no milky white backing, and no artwork on the reverse.
    vec3 ink = printColor * (.978 + detail * .15)
      + photographedGlint * .075 + movingReflection * .35;
    vec3 result = mix(chassis, ink, printMask);
    vec3 outputColor = linearToOutputTexel(vec4(max(result, vec3(0.0)), 1.0)).rgb;
    vec3 backingOutput = linearToOutputTexel(vec4(uStudioBacking, 1.0)).rgb;
    float alpha = clamp(1.0 - min(transmission.r, min(transmission.g, transmission.b)), .16, .985);
    alpha = mix(alpha, 1.0, printMask);
    // Neutral-studio transmission approximation; scalar alpha is compensated
    // in output space instead of blending gray paint over white a second time.
    vec3 source = (outputColor - backingOutput * (1.0 - alpha)) / max(alpha, .001);
    gl_FragColor = vec4(clamp(source, vec3(0.0), vec3(1.0)), alpha * coverage);
  }
`;

export function createVinylMaterial(index = 0, waterTexture = null, printTexture = null, printRadius = Math.sqrt(.8), surfaceTexture = null) {
  const ordinal = Number.isFinite(Number(index)) ? Math.trunc(Number(index)) : 0;
  const palette = ((ordinal % dyes.length) + dyes.length) % dyes.length;
  const material = new THREE.ShaderMaterial({
    name: `Liquid vinyl / photographic pressing ${palette + 1}`,
    uniforms: {
      uWaterField: { value: waterTexture },
      uFieldTexel: { value: new THREE.Vector2(1 / (waterTexture?.image?.width || 128), 1 / (waterTexture?.image?.height || 128)) },
      uDensityScale: { value: waterTexture?.userData.waterField?.densityScale || 1.6 },
      uHasWater: { value: waterTexture ? 1 : 0 },
      uPrint: { value: printTexture },
      uSurface: { value: surfaceTexture },
      uHasSurface: { value: surfaceTexture?.image ? 1 : 0 },
      uSurfaceTexel: { value: new THREE.Vector2(1 / (surfaceTexture?.image?.width || 1240), 1 / (surfaceTexture?.image?.height || 1240)) },
      uPrintReady: { value: 0 },
      uPrintRadius: { value: Math.max(.05, Math.min(.94, printRadius)) },
      uPrintFeather: { value: Math.min(.075, .995 - Math.max(.05, Math.min(.94, printRadius))) },
      uAbsorption: { value: new THREE.Vector3(...dyes[palette]) },
      uStudioBacking: { value: new THREE.Color('#f1f1ef') },
    },
    vertexShader, fragmentShader,
    side: THREE.DoubleSide,
    transparent: true,
    depthTest: true,
    depthWrite: true,
    blending: THREE.NormalBlending,
    premultipliedAlpha: false,
    // The photo must not receive a second ACES exposure pass. The analytic
    // studio is specified in linear scene values and encoded exactly once.
    toneMapped: false,
  });
  material.forceSinglePass = true;
  material.userData.liquidVinyl = {
    palette, surfaceDensity: .18, nominalWaterIOR: 1.333, nominalPVCIOR: 1.54,
    opticalModel: 'photographic smoke/track plate; live density-derived oil; narrow meniscus optics; no scene-ray tracing',
    printWeightedArea: 'R squared + feather squared / 5; default approx 80.1 percent',
    coordinates: 'local XY [-1,1] to UV [0,1]; water shape only from R particle field',
  };
  return material;
}

import {
  Canvas,
  Fill,
  ImageShader,
  Shader,
  Skia,
  SkImage,
} from "@shopify/react-native-skia";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { StyleSheet, useWindowDimensions, View } from "react-native";
import {
  Easing,
  useDerivedValue,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";

// ============================================
// ANIMATION CONSTANTS
// ============================================

const ANIMATION_CONFIG = {
  DURATION_MS: 1000,
  TIME_SCALE: 22.0,
  MAX_TIME: 250.0,
  WIND_SPEED: 12,
  VERTICAL_SPREAD: 60.0,
  TURBULENCE: 35.0,
  BURST_STRENGTH: 45.0,
  FLOAT_AMPLITUDE: 25.0,
  REVERSE_WIND_MULTIPLIER: 6.0,
  LIFETIME_MIN: 180.0,
  LIFETIME_RANGE: 100.0,
  FADE_START: 0.92,
  DRIFT_X: 3.5,
  DRIFT_Y: 2.5,
} as const;

// ============================================
// BALANCED SHADER (quality + performance)
// - SEARCH_RAD = 6 (169 iterations - 14x faster than original 2401)
// - Full visual effects with sin/cos
// - Bounded canvas for fewer pixels
// ============================================

const DUST_SHADER = `
uniform shader image;
uniform float time;
uniform float2 imageSize;
uniform float2 imageOffset;
uniform float2 canvasOffset;
uniform float particleSize;
uniform float seed;
uniform int isCircle;

uniform float timeScale;
uniform float maxTime;
uniform float windSpeed;
uniform float verticalSpread;
uniform float turbulence;
uniform float burstStrength;
uniform float floatAmp;
uniform float reverseWindMult;
uniform float lifetimeMin;
uniform float lifetimeRange;
uniform float fadeStart;
uniform float driftX;
uniform float driftY;

// Larger search radius to prevent particle clipping
// 25x25 = 625 iterations - needed for particles that spread far
const int SEARCH_RAD = 4;

float hash(float2 p) {
  return fract(sin(dot(p, float2(127.1, 311.7))) * 43758.5);
}

half4 main(float2 fragCoord) {
  float2 screenCoord = fragCoord + canvasOffset;
  
  float t = time * timeScale;
  if (t > maxTime) return half4(0.0);
  
  float reverseWindX = reverseWindMult * t;
  float2 baseImgPos = screenCoord + float2(reverseWindX, 0.0) - imageOffset;
  
  float halfSize = particleSize * 0.5;
  float halfSizeSq = halfSize * halfSize;
  float invPS = 1.0 / particleSize;
  
  for (int i = -SEARCH_RAD; i <= SEARCH_RAD; i++) {
    for (int j = -SEARCH_RAD; j <= SEARCH_RAD; j++) {
      float2 imgLocalPos = baseImgPos + float2(float(i), float(j)) * particleSize;
      
      if (imgLocalPos.x < 0.0 || imgLocalPos.x >= imageSize.x ||
          imgLocalPos.y < 0.0 || imgLocalPos.y >= imageSize.y) continue;
      
      float2 cellId = floor(imgLocalPos * invPS);
      float2 cellCenter = cellId * particleSize + halfSize;
      
      float h = hash(cellId + seed);
      float rnd1 = h;
      float rnd2 = fract(h * 7.243);
      float rnd3 = fract(h * 13.759);
      
      float maxLife = lifetimeMin + rnd1 * lifetimeRange;
      float lifeRatio = t / maxLife;
      if (lifeRatio >= 1.0) continue;
      
      float startEase = min(lifeRatio * 10.0, 1.0);
      
      // Wind
      float windX = -windSpeed * t * (0.7 + rnd1 * 0.6);
      float verticalDir = rnd2 * 2.0 - 1.0;
      float windY = verticalDir * verticalSpread * t * (0.5 + rnd3 * 0.5);
      
      // Turbulence (single sin/cos pair)
      float turbPhase = t * 0.07 + rnd3 * 20.0;
      float turbX = sin(turbPhase) * turbulence * rnd1;
      float turbY = cos(turbPhase) * turbulence * rnd2;
      
      // Burst
      float burstAngle = rnd3 * 6.283;
      float burstDecay = 1.0 / (1.0 + lifeRatio * 5.0);
      float burstX = cos(burstAngle) * burstStrength * burstDecay;
      float burstY = sin(burstAngle) * burstStrength * burstDecay;
      
      // Float motion
      float floatPhase = t * 0.05 + rnd1 * 10.0;
      float floatX = sin(floatPhase) * floatAmp * 0.5;
      float floatY = cos(floatPhase * 0.7) * floatAmp;
      
      // Drift
      float driftDirX = (rnd1 - 0.5) * 2.0;
      float driftDirY = (rnd2 - 0.5) * 2.0;
      float tSq = t * t * 0.01;
      float continuousDriftX = driftDirX * driftX * tSq;
      float continuousDriftY = driftDirY * driftY * tSq;
      
      float2 movement = float2(
        windX + turbX + burstX + floatX + continuousDriftX,
        windY + turbY + burstY + floatY + continuousDriftY
      ) * startEase;
      
      float2 particlePos = imageOffset + cellCenter + movement;
      float2 diff = screenCoord - particlePos;
      
      bool inside = isCircle == 1 
        ? dot(diff, diff) <= halfSizeSq
        : abs(diff.x) <= halfSize && abs(diff.y) <= halfSize;
      
      if (inside) {
        float alpha = lifeRatio > fadeStart 
          ? 1.0 - (lifeRatio - fadeStart) / (1.0 - fadeStart)
          : 1.0;
        alpha = alpha * alpha;
        
        if (alpha > 0.01) {
          half4 color = image.eval(cellCenter);
          if (color.a > 0.1) {
            return half4(color.rgb, color.a * alpha);
          }
        }
      }
    }
  }
  
  return half4(0.0);
}
`;

// ============================================
// COMPONENT
// ============================================

interface DustSnapGLProps {
  imageUri: string;
  imageLayout: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  pieceSize: number;
  particleShape: "circle" | "square";
  isSnapped: boolean;
  onAnimationComplete?: () => void;
}

export const DustSnapGL: React.FC<DustSnapGLProps> = ({
  imageUri,
  imageLayout,
  pieceSize,
  particleShape,
  isSnapped,
  onAnimationComplete,
}) => {
  const { width: screenWidth, height: screenHeight } = useWindowDimensions();
  const [image, setImage] = useState<SkImage | null>(null);
  const [isAnimating, setIsAnimating] = useState(false);

  const animationTime = useSharedValue(0);
  // Use shared values instead of refs to avoid Reanimated warnings
  const seedValue = useSharedValue(Math.random() * 1000);
  const layoutWidth = useSharedValue(imageLayout.width);
  const layoutHeight = useSharedValue(imageLayout.height);
  const layoutX = useSharedValue(imageLayout.x);
  const layoutY = useSharedValue(imageLayout.y);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    layoutWidth.value = imageLayout.width;
    layoutHeight.value = imageLayout.height;
    layoutX.value = imageLayout.x;
    layoutY.value = imageLayout.y;
  }, [imageLayout, layoutWidth, layoutHeight, layoutX, layoutY]);

  useEffect(() => {
    if (isSnapped) {
      seedValue.value = Math.random() * 1000;
    }
  }, [isSnapped, seedValue]);

  const shaderEffect = useMemo(() => {
    try {
      return Skia.RuntimeEffect.Make(DUST_SHADER);
    } catch (error) {
      console.error("Shader compile error:", error);
      return null;
    }
  }, []);

  useEffect(() => {
    let isMounted = true;

    const loadImage = async () => {
      if (!imageUri) return;
      try {
        const data = await Skia.Data.fromURI(imageUri);
        if (isMounted && data) {
          const loadedImage = Skia.Image.MakeImageFromEncoded(data);
          if (loadedImage) setImage(loadedImage);
        }
      } catch (error) {
        console.warn("Failed to load image:", error);
      }
    };

    loadImage();
    return () => {
      isMounted = false;
    };
  }, [imageUri]);

  useEffect(() => {
    if (isSnapped && image && shaderEffect && imageLayout.width > 0) {
      setIsAnimating(true);
      animationTime.value = 0;

      const duration = ANIMATION_CONFIG.DURATION_MS;
      animationTime.value = withTiming(duration / 1000, {
        duration: duration,
        easing: Easing.linear,
      });

      timeoutRef.current = setTimeout(() => {
        onAnimationComplete?.();
      }, duration + 100);
    } else if (!isSnapped) {
      setIsAnimating(false);
      animationTime.value = 0;
    }

    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, [
    isSnapped,
    image,
    shaderEffect,
    imageLayout.width,
    onAnimationComplete,
    animationTime,
  ]);

  // Full screen canvas - particles can flow anywhere
  const canvasBounds = useMemo(
    () => ({
      x: 0,
      y: 0,
      width: screenWidth,
      height: screenHeight,
    }),
    [screenWidth, screenHeight]
  );

  const uniforms = useDerivedValue(() => {
    "worklet";
    return {
      time: animationTime.value,
      imageSize: [layoutWidth.value, layoutHeight.value] as const,
      imageOffset: [layoutX.value, layoutY.value] as const,
      canvasOffset: [canvasBounds.x, canvasBounds.y] as const,
      particleSize: pieceSize,
      seed: seedValue.value,
      isCircle: particleShape === "circle" ? 1 : 0,
      timeScale: ANIMATION_CONFIG.TIME_SCALE,
      maxTime: ANIMATION_CONFIG.MAX_TIME,
      windSpeed: ANIMATION_CONFIG.WIND_SPEED,
      verticalSpread: ANIMATION_CONFIG.VERTICAL_SPREAD,
      turbulence: ANIMATION_CONFIG.TURBULENCE,
      burstStrength: ANIMATION_CONFIG.BURST_STRENGTH,
      floatAmp: ANIMATION_CONFIG.FLOAT_AMPLITUDE,
      reverseWindMult: ANIMATION_CONFIG.REVERSE_WIND_MULTIPLIER,
      lifetimeMin: ANIMATION_CONFIG.LIFETIME_MIN,
      lifetimeRange: ANIMATION_CONFIG.LIFETIME_RANGE,
      fadeStart: ANIMATION_CONFIG.FADE_START,
      driftX: ANIMATION_CONFIG.DRIFT_X,
      driftY: ANIMATION_CONFIG.DRIFT_Y,
    };
  });

  if (!isSnapped || !isAnimating || !image || !shaderEffect) {
    return null;
  }

  return (
    <View style={styles.container} pointerEvents="none">
      <Canvas
        style={{
          position: "absolute",
          left: canvasBounds.x,
          top: canvasBounds.y,
          width: canvasBounds.width,
          height: canvasBounds.height,
        }}
      >
        <Fill>
          <Shader source={shaderEffect} uniforms={uniforms}>
            <ImageShader
              image={image}
              fit="fill"
              width={imageLayout.width}
              height={imageLayout.height}
            />
          </Shader>
        </Fill>
      </Canvas>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 9999,
  },
});

export default DustSnapGL;

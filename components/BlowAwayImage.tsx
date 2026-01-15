import {
  Canvas,
  Fill,
  ImageShader,
  Shader,
  Skia,
  Image as SkiaImage,
  SkImage,
} from "@shopify/react-native-skia";
import React, { useEffect, useMemo, useState } from "react";
import { StyleSheet, useWindowDimensions, View } from "react-native";
import {
  Easing,
  useDerivedValue,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";

interface BlowAwayImageProps {
  imageUri: string;
  trigger: boolean;
  particleSize?: number;
  duration?: number;
  onComplete?: () => void;
  width: number;
  height: number;
}

// Full screen dust shader - particles flow across entire screen
// Uses reverse lookup: for each pixel, find which source particle lands here
const DUST_SNAP_SHADER = `
uniform shader image;
uniform float time;
uniform float2 imageSize;      // Original image dimensions
uniform float2 imageOffset;    // Image position on screen
uniform float2 canvasSize;     // Full canvas/screen size
uniform float particleSize;
uniform float seed;

float hash(float2 p) {
  float3 p3 = fract(float3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

half4 main(float2 fragCoord) {
  float t = time * 60.0; // Convert to frames
  
  // Early exit if animation complete
  if (t > 180.0) {
    return half4(0.0);
  }
  
  // Reverse wind to find estimated source position
  float reverseWindX = 12.0 * t + (t * t * 0.02);
  float reverseWindY = 1.5 * t;
  
  // Estimate source position in canvas coords
  float2 estimatedSource = fragCoord + float2(reverseWindX, reverseWindY);
  
  // Convert to image-local coords
  float2 baseImgPos = estimatedSource - imageOffset;
  
  // Fixed loop bounds (SkSL requires constant bounds)
  // Search ±8 cells in X, ±5 cells in Y for performance
  const float MAX_SEARCH_X = 8.0;
  const float MAX_SEARCH_Y = 5.0;
  
  for (float i = -MAX_SEARCH_X; i <= MAX_SEARCH_X; i += 1.0) {
    for (float j = -MAX_SEARCH_Y; j <= MAX_SEARCH_Y; j += 1.0) {
      float2 imgLocalPos = baseImgPos + float2(i, j) * particleSize;
      
      // Skip if outside image bounds
      if (imgLocalPos.x < 0.0 || imgLocalPos.x >= imageSize.x ||
          imgLocalPos.y < 0.0 || imgLocalPos.y >= imageSize.y) {
        continue;
      }
      
      // Get cell ID in image space
      float2 cellId = floor(imgLocalPos / particleSize);
      float2 cellCenter = cellId * particleSize + particleSize * 0.5;
      
      // Random seed for this cell
      float rndSeed = hash(cellId + seed);
      
      // Lifetime (60-120 frames)
      float maxLife = 60.0 + rndSeed * 60.0;
      float lifeRatio = t / maxLife;
      
      // Skip dead particles
      if (lifeRatio >= 1.0) continue;
      
      // Calculate displacement for this specific particle
      float windSpeed = 10.0 + rndSeed * 4.0;
      float windX = -windSpeed * t - (t * t * 0.02);
      
      float wave = sin(t * 0.12 + rndSeed * 15.0) * 6.0;
      float lift = (-1.0 + (rndSeed - 0.5) * 2.5) * t;
      float windY = lift + wave;
      
      // Where is this particle NOW (in canvas coordinates)
      float2 particlePos = imageOffset + cellCenter + float2(windX, windY);
      
      // Check if fragCoord is inside this particle (simple square, no rotation/scale)
      float halfSize = particleSize * 0.5;
      float2 diff = fragCoord - particlePos;
      
      if (abs(diff.x) <= halfSize && abs(diff.y) <= halfSize) {
        // Calculate alpha fade
        float alpha = 1.0;
        if (lifeRatio > 0.3) {
          alpha = pow(1.0 - (lifeRatio - 0.3) / 0.7, 1.5);
        }
        
        if (alpha > 0.01) {
          // Sample color from original image position
          half4 color = image.eval(cellCenter);
          return half4(color.rgb, color.a * alpha);
        }
      }
    }
  }
  
  return half4(0.0);
}
`;

export const BlowAwayImage: React.FC<BlowAwayImageProps> = ({
  imageUri,
  trigger,
  particleSize = 4,
  duration = 2000,
  onComplete,
  width,
  height,
}) => {
  const { width: screenWidth, height: screenHeight } = useWindowDimensions();
  const [image, setImage] = useState<SkImage | null>(null);
  const [isAnimating, setIsAnimating] = useState(false);
  const containerRef = React.useRef<View>(null);

  const animationTime = useSharedValue(0);
  const imageOffsetX = useSharedValue(0);
  const imageOffsetY = useSharedValue(0);
  const seed = useMemo(() => Math.random() * 1000, []);

  // Measure actual position on screen
  const measurePosition = () => {
    containerRef.current?.measureInWindow((x, y) => {
      imageOffsetX.value = x;
      imageOffsetY.value = y;
    });
  };

  const shaderEffect = useMemo(() => {
    return Skia.RuntimeEffect.Make(DUST_SNAP_SHADER);
  }, []);

  useEffect(() => {
    let isMounted = true;
    const loadImage = async () => {
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
    if (trigger && image && shaderEffect) {
      // Measure position right before starting animation
      containerRef.current?.measureInWindow((x, y) => {
        imageOffsetX.value = x;
        imageOffsetY.value = y;

        // Start animation after position is captured
        setIsAnimating(true);
        animationTime.value = 0;

        animationTime.value = withTiming(3.0, {
          duration: duration,
          easing: Easing.linear,
        });
      });

      const timeout = setTimeout(() => {
        onComplete?.();
      }, duration + 100);

      return () => clearTimeout(timeout);
    }
  }, [
    trigger,
    image,
    shaderEffect,
    duration,
    onComplete,
    animationTime,
    imageOffsetX,
    imageOffsetY,
  ]);

  const uniforms = useDerivedValue(() => {
    "worklet";
    return {
      time: animationTime.value,
      imageSize: [width, height],
      imageOffset: [imageOffsetX.value, imageOffsetY.value],
      canvasSize: [screenWidth, screenHeight],
      particleSize: Math.max(2, particleSize),
      seed: seed,
    };
  });

  if (!image || !shaderEffect) {
    return <View style={[styles.container, { width, height }]} />;
  }

  // When animating, render full screen canvas
  if (isAnimating) {
    return (
      <View style={[styles.fullScreenContainer]}>
        <Canvas style={{ width: screenWidth, height: screenHeight }}>
          <Fill>
            <Shader source={shaderEffect} uniforms={uniforms}>
              <ImageShader
                image={image}
                fit="cover"
                width={width}
                height={height}
              />
            </Shader>
          </Fill>
        </Canvas>
      </View>
    );
  }

  // Static image display
  return (
    <View
      ref={containerRef}
      style={[styles.container, { width, height }]}
      onLayout={measurePosition}
    >
      <Canvas style={{ width, height }}>
        <SkiaImage
          image={image}
          x={0}
          y={0}
          width={width}
          height={height}
          fit="cover"
        />
      </Canvas>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    position: "relative",
    overflow: "visible",
  },
  fullScreenContainer: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 1000,
    pointerEvents: "none",
  },
});

export default BlowAwayImage;

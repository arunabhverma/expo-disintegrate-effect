import { useTheme } from "@react-navigation/native";
import * as Haptics from "expo-haptics";
import { Image } from "expo-image";
import * as ImagePicker from "expo-image-picker";

import { PressableScale } from "@/components/pressable-scale";
import React, { useCallback, useMemo, useRef, useState } from "react";
import { Platform, StyleSheet, Text, View } from "react-native";
import Animated, {
  LinearTransition,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { scheduleOnRN } from "react-native-worklets";
import { DustSnapGL } from "../components/DustSnapGL";

const mass = 1;
const damping = 25;
const stiffness = 180;

export default function DustSnapApp() {
  const { colors } = useTheme();

  const [imageUri, setImageUri] = useState<string | null>(null);
  const [fakeImage, setFakeImage] = useState<string | null>(null);
  const [imageAspectRatio, setImageAspectRatio] = useState(1);
  const [isSnapped, setIsSnapped] = useState(false);
  const [imageLayout, setImageLayout] = useState({
    x: 0,
    y: 0,
    width: 0,
    height: 0,
  });

  const imageContainerRef = useRef<View>(null);
  const imageOpacity = useSharedValue(1);
  const { top } = useSafeAreaInsets();
  const androidTop = Platform.OS === "android" ? top : 0;

  const measureImage = useCallback(() => {
    return new Promise<void>((resolve) => {
      if (imageContainerRef.current) {
        imageContainerRef.current.measureInWindow((x, y, width, height) => {
          setImageLayout({
            x: x,
            y: y + androidTop,
            width: width,
            height: height,
          });
          resolve();
        });
      } else {
        resolve();
      }
    });
  }, []);

  const selectImage = useCallback(async () => {
    let result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      allowsEditing: false,
      quality: 1,
    });

    if (!result.canceled) {
      setImageUri(result.assets[0].uri);
      setFakeImage(result.assets[0].uri);
      setImageAspectRatio(result.assets[0].width / result.assets[0].height);
      measureImage();
    }
  }, []);

  const deleteImage = useCallback(() => {
    setImageUri(null);
    imageOpacity.value = 1;
  }, [imageOpacity]);

  const handleDelete = useCallback(async () => {
    if (!fakeImage || isSnapped) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    await measureImage();
    setTimeout(() => {
      setIsSnapped(true);
      imageOpacity.value = withTiming(0, { duration: 150 }, (finished) => {
        if (finished) {
          scheduleOnRN(deleteImage);
        }
      });
    }, 16);
  }, [fakeImage, isSnapped, measureImage, imageOpacity, deleteImage]);

  const handleAnimationComplete = useCallback(() => {
    setIsSnapped(false);
    setImageAspectRatio(1);
    setImageLayout({ x: 0, y: 0, width: 0, height: 0 });
    setFakeImage(null);
  }, [setImageAspectRatio, setImageLayout, setFakeImage]);

  const animatedImageStyle = useAnimatedStyle(() => ({
    opacity: imageOpacity.value,
  }));

  const themedStyles = useMemo(
    () => ({
      safeArea: {
        backgroundColor: colors.background,
      },
      removeButton: {
        backgroundColor: colors.background + "E6",
        borderColor: colors.border,
      },
      closeLine: {
        backgroundColor: colors.text + "80",
      },
      snapButton: {
        backgroundColor: colors.primary,
        shadowColor: colors.primary,
      },
      snapButtonDisabled: {
        backgroundColor: colors.border,
      },
      snapButtonText: {
        color: colors.card,
      },
      snapButtonTextDisabled: {
        color: colors.text + "80",
      },
      wandStick: {
        backgroundColor: colors.card,
      },
      wandStar: {
        backgroundColor: colors.card,
      },
    }),
    [colors]
  );

  return (
    <View style={[styles.safeArea, themedStyles.safeArea]}>
      {/* <View
        style={{
          position: "absolute",
          top: 0,
          left: "50%",
          right: 0,
          bottom: 0,
          borderLeftWidth: 1,
          borderLeftColor: "red",
        }}
      /> */}
      <Animated.View
        style={styles.container}
        layout={LinearTransition.springify()
          .mass(mass)
          .damping(damping)
          .stiffness(stiffness)}
      >
        {Boolean(imageUri) && (
          <Animated.View
            layout={LinearTransition.springify()
              .mass(mass)
              .damping(damping)
              .stiffness(stiffness)}
            style={styles.imageContainer}
          >
            <View
              ref={imageContainerRef}
              style={[styles.imageWrapper]}
              onLayout={() => measureImage()}
            >
              <Animated.View style={[styles.imageInner, animatedImageStyle]}>
                <Image
                  source={imageUri}
                  recyclingKey={imageUri}
                  cachePolicy="memory-disk"
                  contentFit="cover"
                  transition={0}
                  style={[
                    styles.previewImage,
                    {
                      aspectRatio: imageAspectRatio,
                      maxWidth: 300,
                      maxHeight: 300,
                    },
                  ]}
                />
              </Animated.View>
            </View>
          </Animated.View>
        )}
        <Animated.View
          style={{ marginTop: 20 }}
          layout={LinearTransition.springify()
            .mass(mass)
            .damping(damping)
            .stiffness(stiffness)}
        >
          {!Boolean(imageUri) && (
            <Animated.View
              layout={LinearTransition.springify()
                .mass(mass)
                .damping(damping)
                .stiffness(stiffness)}
            >
              <PressableScale onPress={selectImage} style={styles.button}>
                <Text style={[styles.buttonText, { color: colors.text }]}>
                  Select Image
                </Text>
              </PressableScale>
            </Animated.View>
          )}
          {Boolean(imageUri) && (
            <Animated.View
              layout={LinearTransition.springify()
                .mass(mass)
                .damping(damping)
                .stiffness(stiffness)}
            >
              <PressableScale style={styles.button} onPress={handleDelete}>
                <Text
                  style={[styles.buttonText, { color: colors.notification }]}
                >
                  Delete
                </Text>
              </PressableScale>
            </Animated.View>
          )}
        </Animated.View>
      </Animated.View>
      {fakeImage && isSnapped && (
        <DustSnapGL
          imageUri={fakeImage}
          imageLayout={imageLayout}
          pieceSize={3}
          particleShape="circle"
          isSnapped={isSnapped}
          onAnimationComplete={handleAnimationComplete}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  container: {
    flex: 1,
    padding: 16,
    justifyContent: "center",
  },
  content: {
    padding: 24,
    gap: 24,
  },
  imageContainer: {
    borderRadius: 20,
  },
  imageWrapper: {
    alignSelf: "center",
    borderRadius: 12,
  },
  imageInner: {
    width: "100%",
  },
  previewImage: {
    width: "100%",
    borderRadius: 12,
  },
  removeButton: {
    position: "absolute",
    top: 16,
    right: 16,
    width: 36,
    height: 36,
    borderRadius: 10,
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 1,
  },
  closeContainer: {
    width: 14,
    height: 14,
    justifyContent: "center",
    alignItems: "center",
  },
  closeLine: {
    position: "absolute",
    width: 14,
    height: 2,
    borderRadius: 1,
  },
  snapButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    paddingVertical: 18,
    borderRadius: 16,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.4,
    shadowRadius: 12,
    elevation: 8,
  },
  snapButtonDisabled: {
    shadowOpacity: 0,
    elevation: 0,
  },
  snapButtonText: {
    fontSize: 16,
    fontWeight: "700",
  },
  wandContainer: {
    width: 20,
    height: 20,
    justifyContent: "center",
    alignItems: "center",
  },
  wandStick: {
    width: 14,
    height: 3,
    borderRadius: 1.5,
    transform: [{ rotate: "-45deg" }],
  },
  wandStar: {
    position: "absolute",
    top: 2,
    right: 2,
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  button: {
    alignSelf: "center",
    borderRadius: 16,
    paddingVertical: 8,
    paddingHorizontal: 25,
    justifyContent: "center",
    alignItems: "center",
  },
  buttonText: {
    fontSize: 16,
    fontWeight: "500",
  },
});

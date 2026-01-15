import {
  Camera,
  DefaultLight,
  FilamentScene,
  FilamentView,
  Model,
} from "react-native-filament";

// Sample 3D model from Khronos glTF sample models
const DUCK_MODEL_URL =
  "https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Models/main/2.0/Duck/glTF-Binary/Duck.glb";

export const Cylinder = () => {
  return (
    <FilamentScene>
      <FilamentView style={{ flex: 1 }}>
        <Camera />
        <DefaultLight />

        {/* 3D Model */}
        <Model
          source={{ uri: DUCK_MODEL_URL }}
          transformToUnitCube
          translate={[0, 0, -3]}
        />
      </FilamentView>
    </FilamentScene>
  );
};

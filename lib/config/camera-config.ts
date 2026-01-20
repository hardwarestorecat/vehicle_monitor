export interface CameraConfig {
  cameraId: string;
  location: string;
  crossStreet: string;
  direction: string;
  rtspUrl?: string; // Will be used when cameras are deployed
}

/**
 * Camera configuration mapping
 * Add your cameras here with their location details
 */
export const CAMERA_CONFIGS: { [cameraId: string]: CameraConfig } = {
  camera1: {
    cameraId: 'camera1',
    location: 'Front Gate',
    crossStreet: 'Main St & 1st Ave',
    direction: 'Northbound',
  },
  camera2: {
    cameraId: 'camera2',
    location: 'Back Exit',
    crossStreet: 'Oak St & 3rd Ave',
    direction: 'Southbound',
  },
  // Add more cameras as needed
  // camera3: {
  //   cameraId: 'camera3',
  //   location: 'Side Entrance',
  //   crossStreet: 'Elm St & 5th Ave',
  //   direction: 'Eastbound',
  // },
};

/**
 * Get camera configuration by ID
 */
export function getCameraConfig(cameraId: string): CameraConfig {
  return (
    CAMERA_CONFIGS[cameraId] || {
      cameraId: cameraId || 'unknown',
      location: 'Unknown Location',
      crossStreet: 'Unknown Cross Street',
      direction: 'Unknown Direction',
    }
  );
}

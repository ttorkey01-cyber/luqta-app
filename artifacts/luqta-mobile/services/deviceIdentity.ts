import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import {
  registerHuntDevice,
  setAuthTokenGetter,
  type DeviceRegistrationRequestPlatform,
} from '@workspace/api-client-react';

// Keep existing web sessions intact; native SecureStore keys cannot contain
// "@" or "/", unlike AsyncStorage keys.
const TOKEN_KEY =
  Platform.OS === 'web' ? '@luqta/hunt-device-token' : 'luqta.hunt-device-token';
const DEVICE_ID_KEY =
  Platform.OS === 'web' ? '@luqta/hunt-device-id' : 'luqta.hunt-device-id';
let token: string | null | undefined;
let registration: Promise<string> | null = null;

async function read(key: string): Promise<string | null> {
  if (Platform.OS === 'web') return AsyncStorage.getItem(key);
  return SecureStore.getItemAsync(key);
}

async function write(key: string, value: string): Promise<void> {
  if (Platform.OS === 'web') {
    await AsyncStorage.setItem(key, value);
  } else {
    await SecureStore.setItemAsync(key, value);
  }
}

export function devicePlatform(): DeviceRegistrationRequestPlatform {
  return Platform.OS === 'ios' ? 'ios' : Platform.OS === 'android' ? 'android' : 'web';
}

export async function getDeviceAccessToken(): Promise<string | null> {
  if (token !== undefined) return token;
  token = await read(TOKEN_KEY);
  return token;
}

export async function ensureDeviceIdentity(): Promise<string> {
  const existing = await getDeviceAccessToken();
  if (existing) return existing;
  if (!registration) {
    registration = (async () => {
      const session = await registerHuntDevice({ platform: devicePlatform() });
      await write(TOKEN_KEY, session.accessToken);
      await write(DEVICE_ID_KEY, session.deviceId);
      token = session.accessToken;
      return session.accessToken;
    })().finally(() => {
      registration = null;
    });
  }
  return registration;
}

setAuthTokenGetter(() => getDeviceAccessToken());

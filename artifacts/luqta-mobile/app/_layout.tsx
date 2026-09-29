import React, { useEffect } from 'react';
import { AppState, I18nManager, Platform } from 'react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { KeyboardProvider } from 'react-native-keyboard-controller';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
  useFonts,
} from '@expo-google-fonts/inter';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { createAudioPlayer } from 'expo-audio';
import { AppProvider } from '@/context/AppContext';
import { setBaseUrl } from '@workspace/api-client-react';
import Constants, { AppOwnership } from 'expo-constants';
import { useRouter } from 'expo-router';
import { resolveMobileApiBaseUrl } from '@/services/apiHost';
import { createStartupSonicLogoController } from '@/services/startupSonicLogo';

SplashScreen.preventAutoHideAsync();
I18nManager.allowRTL(true);
I18nManager.forceRTL(true);
const apiBaseUrl = resolveMobileApiBaseUrl(
  __DEV__,
  process.env.EXPO_PUBLIC_DOMAIN,
);
if (!__DEV__ && !apiBaseUrl) {
  throw new Error('Production API host is required');
}
setBaseUrl(apiBaseUrl);

const queryClient = new QueryClient();
const startupSound = createStartupSonicLogoController(
  () => createAudioPlayer(require('../assets/audio/LUQTA_Sonic_Logo_v4___Future_Luxury.mp3')),
);

function RootLayoutNav() {
  const router = useRouter();

  useEffect(() => {
    if (Platform.OS === 'web' || Constants.appOwnership === AppOwnership.Expo) {
      return;
    }

    let active = true;
    let removeSubscription: (() => void) | undefined;
    void import('expo-notifications')
      .then((Notifications) => {
        if (!active) return;
        const subscription = Notifications.addNotificationResponseReceivedListener((response) => {
          const data = response.notification.request.content.data as { huntId?: string; query?: string } | undefined;
          if (data?.query) {
            router.push({ pathname: '/results', params: { query: data.query } });
          } else if (data?.huntId) {
            router.push({ pathname: '/hunt', params: { id: data.huntId } });
          }
        });
        removeSubscription = () => subscription.remove();
      })
      .catch((error) => {
        console.warn('Notification response handling is unavailable', error);
      });

    return () => {
      active = false;
      removeSubscription?.();
    };
  }, [router]);

  return (
    <Stack screenOptions={{ headerShown: false, animation: 'fade' }}>
      <Stack.Screen name="(tabs)" />
      <Stack.Screen name="camera" options={{ animation: 'slide_from_bottom' }} />
      <Stack.Screen name="results" options={{ animation: 'slide_from_right' }} />
      <Stack.Screen name="categories" options={{ animation: 'slide_from_right' }} />
      <Stack.Screen name="product/[id]" options={{ animation: 'slide_from_right' }} />
    </Stack>
  );
}

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
  });

  useEffect(() => {
    if (Platform.OS === 'web') return;
    // This root effect runs while the native logo splash waits for fonts. It
    // never waits for the audio, and the process-scoped controller cannot replay.
    startupSound.start(AppState.currentState !== 'background');
    const stateSubscription = AppState.addEventListener('change', (state) => {
      if (state === 'background') startupSound.stop();
    });
    return () => {
      stateSubscription.remove();
      startupSound.stop();
    };
  }, []);

  useEffect(() => {
    if (!fontsLoaded && !fontError) return;
    let active = true;
    void (async () => {
      // Cached fonts may resolve before audio loads. Wait only briefly for its
      // first play event so startup stays responsive even if audio is unavailable.
      if (Platform.OS !== 'web') await startupSound.waitForStart(300);
      if (active) await SplashScreen.hideAsync();
    })().catch(() => { /* A sound or splash error must not block app setup. */ });
    return () => { active = false; };
  }, [fontsLoaded, fontError]);

  if (!fontsLoaded && !fontError) return null;

  return (
    <SafeAreaProvider>
      <ErrorBoundary>
        <QueryClientProvider client={queryClient}>
          <GestureHandlerRootView style={{ flex: 1 }}>
            <KeyboardProvider>
              <AppProvider>
                <RootLayoutNav />
              </AppProvider>
            </KeyboardProvider>
          </GestureHandlerRootView>
        </QueryClientProvider>
      </ErrorBoundary>
    </SafeAreaProvider>
  );
}

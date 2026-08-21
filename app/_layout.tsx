import React, { useEffect } from 'react';
import { Stack, router, useSegments } from 'expo-router';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { StatusBar } from 'expo-status-bar';
import { View, ActivityIndicator } from 'react-native';
import { useFonts, Inter_400Regular, Inter_600SemiBold, Inter_700Bold } from '@expo-google-fonts/inter';
import { AuthProvider, useAuth } from '../src/hooks/useAuth';
import { ArtistsProvider } from '../src/hooks/useArtists';
import { registerForPushNotifications, savePushToken } from '../src/lib/notifications';

function Loading() {
  return (
    <View style={{ flex: 1, backgroundColor: '#000', alignItems: 'center', justifyContent: 'center' }}>
      <ActivityIndicator color="#6C63FF" />
    </View>
  );
}

function AuthGate({ children }: { children: React.ReactNode }) {
  const { user, profile, loading } = useAuth();
  const segments = useSegments();

  useEffect(() => {
    if (loading) return;
    const inAuthGroup = segments[0] === '(auth)';
    const onOnboarding = inAuthGroup && segments[1] === 'onboarding';
    const onSplash = (segments as string[]).length === 0; // the index/splash route

    if (!user) {
      if (!inAuthGroup) router.replace('/(auth)/login');
      return;
    }

    // Wait for the profile before deciding — redirecting on a null profile would
    // bounce people out of onboarding mid-flow.
    if (!profile) return;

    // Onboarding is mandatory for every account, however it was created. Signing
    // up through Last.fm or Spotify used to drop straight into the app, so those
    // users never set a name, username or home city.
    const needsOnboarding =
      !profile.full_name?.trim() ||
      !profile.username?.trim() ||
      (profile.home_cities?.length ?? 0) === 0;

    if (needsOnboarding) {
      if (!onOnboarding) router.replace('/(auth)/onboarding');
      return;
    }

    if (onSplash || inAuthGroup) {
      // Move fully set-up users off the splash and auth screens into the app,
      // but leave them alone on other valid routes (tabs, /account, etc.).
      router.replace('/(tabs)/feed');
    }
  }, [user, profile, loading, segments]);

  // Register for push notifications once the user is known.
  useEffect(() => {
    if (user) {
      registerForPushNotifications().then((token) => {
        if (token) savePushToken(user.id, token);
      });
    }
  }, [user]);

  if (loading) return <Loading />;

  return <>{children}</>;
}

export default function RootLayout() {
  const [fontsLoaded] = useFonts({
    Inter_400Regular,
    Inter_600SemiBold,
    Inter_700Bold,
  });

  if (!fontsLoaded) return <Loading />;

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <StatusBar style="light" />
      <AuthProvider>
        <ArtistsProvider>
          <AuthGate>
            <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: '#000' } }}>
              <Stack.Screen name="index" />
              <Stack.Screen name="(auth)" />
              <Stack.Screen name="(tabs)" />
              <Stack.Screen name="account" options={{ presentation: 'card' }} />
              <Stack.Screen name="settings" options={{ presentation: 'card' }} />
            </Stack>
          </AuthGate>
        </ArtistsProvider>
      </AuthProvider>
    </GestureHandlerRootView>
  );
}

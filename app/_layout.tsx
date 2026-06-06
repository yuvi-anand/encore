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
  const { user, loading } = useAuth();
  const segments = useSegments();

  useEffect(() => {
    if (loading) return;
    const inAuthGroup = segments[0] === '(auth)';
    const inTabsGroup = segments[0] === '(tabs)';
    const onOnboarding = segments[0] === '(auth)' && segments[1] === 'onboarding';

    if (!user && !inAuthGroup) {
      router.replace('/(auth)/login');
    } else if (user && !inTabsGroup && !onOnboarding) {
      // Logged-in users belong in the tabs (unless mid-onboarding). This also
      // moves them off the index/splash route once auth resolves.
      router.replace('/(tabs)/feed');
    }
  }, [user, loading, segments]);

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
            </Stack>
          </AuthGate>
        </ArtistsProvider>
      </AuthProvider>
    </GestureHandlerRootView>
  );
}

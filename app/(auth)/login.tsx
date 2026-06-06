import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { router } from 'expo-router';
import { useAuth } from '../../src/hooks/useAuth';

const COLORS = {
  bg: '#000',
  card: '#111',
  text: '#fff',
  muted: '#888',
  accent: '#6C63FF',
  spotify: '#1DB954',
  border: '#222',
  inputBg: '#111',
};

export default function LoginScreen() {
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [spotifyLoading, setSpotifyLoading] = useState(false);

  const { signIn, signUp, signInWithSpotify } = useAuth();

  const handleSpotify = async () => {
    setSpotifyLoading(true);
    const error = await signInWithSpotify();
    setSpotifyLoading(false);
    if (error) {
      Alert.alert('Spotify sign-in failed', error.message);
    }
    // On success the auth gate redirects automatically.
  };

  const handleSubmit = async () => {
    if (!email || !password) {
      Alert.alert('Error', 'Please enter your email and password.');
      return;
    }
    setLoading(true);
    const error = mode === 'signin'
      ? await signIn(email, password)
      : await signUp(email, password);

    setLoading(false);
    if (error) {
      Alert.alert('Error', error.message);
    } else if (mode === 'signup') {
      router.replace('/(auth)/onboarding');
    } else {
      router.replace('/(tabs)/feed');
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.header}>
          <Text style={styles.wordmark}>encore</Text>
          <Text style={styles.subtitle}>
            {mode === 'signin' ? 'Welcome back.' : 'Join Encore.'}
          </Text>
        </View>

        <View style={styles.form}>
          <TextInput
            style={styles.input}
            placeholder="Email"
            placeholderTextColor={COLORS.muted}
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            keyboardType="email-address"
            autoCorrect={false}
            returnKeyType="next"
          />
          <TextInput
            style={styles.input}
            placeholder="Password"
            placeholderTextColor={COLORS.muted}
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            returnKeyType="done"
            onSubmitEditing={handleSubmit}
          />

          <TouchableOpacity
            style={styles.primaryButton}
            onPress={handleSubmit}
            disabled={loading}
          >
            {loading ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.primaryButtonText}>
                {mode === 'signin' ? 'Sign In' : 'Create Account'}
              </Text>
            )}
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.toggleButton}
            onPress={() => setMode(mode === 'signin' ? 'signup' : 'signin')}
          >
            <Text style={styles.toggleText}>
              {mode === 'signin'
                ? "Don't have an account? Create one"
                : 'Already have an account? Sign in'}
            </Text>
          </TouchableOpacity>

          <View style={styles.divider}>
            <View style={styles.dividerLine} />
            <Text style={styles.dividerText}>or</Text>
            <View style={styles.dividerLine} />
          </View>

          <TouchableOpacity
            style={styles.spotifyButton}
            onPress={handleSpotify}
            disabled={spotifyLoading}
          >
            {spotifyLoading ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.spotifyButtonText}>Continue with Spotify</Text>
            )}
          </TouchableOpacity>
        </View>

        <Text style={styles.legal}>
          By continuing, you agree to our Terms of Service and Privacy Policy.
        </Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.bg,
  },
  scroll: {
    flexGrow: 1,
    paddingHorizontal: 24,
    paddingTop: 100,
    paddingBottom: 40,
  },
  header: {
    marginBottom: 48,
  },
  wordmark: {
    color: COLORS.text,
    fontSize: 42,
    fontFamily: 'Inter_700Bold',
    letterSpacing: -2,
    marginBottom: 8,
  },
  subtitle: {
    color: COLORS.muted,
    fontSize: 18,
    fontFamily: 'Inter_400Regular',
  },
  form: {
    gap: 12,
  },
  input: {
    backgroundColor: COLORS.inputBg,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 15,
    color: COLORS.text,
    fontSize: 16,
    fontFamily: 'Inter_400Regular',
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  primaryButton: {
    backgroundColor: COLORS.accent,
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: 4,
  },
  primaryButtonText: {
    color: COLORS.text,
    fontSize: 16,
    fontFamily: 'Inter_700Bold',
  },
  toggleButton: {
    alignItems: 'center',
    paddingVertical: 8,
  },
  toggleText: {
    color: COLORS.muted,
    fontSize: 14,
    fontFamily: 'Inter_400Regular',
  },
  divider: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginVertical: 8,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: COLORS.border,
  },
  dividerText: {
    color: COLORS.muted,
    fontSize: 13,
    fontFamily: 'Inter_400Regular',
  },
  spotifyButton: {
    backgroundColor: COLORS.spotify,
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
  },
  spotifyButtonText: {
    color: COLORS.text,
    fontSize: 16,
    fontFamily: 'Inter_700Bold',
  },
  legal: {
    color: '#444',
    fontSize: 12,
    fontFamily: 'Inter_400Regular',
    textAlign: 'center',
    marginTop: 32,
    lineHeight: 18,
  },
});

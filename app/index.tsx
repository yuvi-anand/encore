import React, { useEffect, useRef } from 'react';
import { View, Text, StyleSheet, Animated } from 'react-native';

// The AuthGate in _layout.tsx handles redirecting to the right place once
// auth state resolves. This screen is just the branded splash shown briefly.
export default function SplashScreen() {
  const opacity = useRef(new Animated.Value(0)).current;
  const scale = useRef(new Animated.Value(0.85)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(opacity, {
        toValue: 1,
        duration: 600,
        useNativeDriver: true,
      }),
      Animated.spring(scale, {
        toValue: 1,
        tension: 80,
        friction: 8,
        useNativeDriver: true,
      }),
    ]).start();
  }, [opacity, scale]);

  return (
    <View style={styles.container}>
      <Animated.View style={{ opacity, transform: [{ scale }] }}>
        <Text style={styles.wordmark}>encore</Text>
        <Text style={styles.tagline}>Never miss a show.</Text>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
    alignItems: 'center',
    justifyContent: 'center',
  },
  wordmark: {
    color: '#fff',
    fontSize: 48,
    fontFamily: 'Inter_700Bold',
    letterSpacing: -2,
    textAlign: 'center',
  },
  tagline: {
    color: '#6C63FF',
    fontSize: 16,
    fontFamily: 'Inter_400Regular',
    textAlign: 'center',
    marginTop: 8,
    letterSpacing: 0.5,
  },
});

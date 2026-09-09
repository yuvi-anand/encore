import React, { useEffect, useRef } from 'react';
import { View, Text, StyleSheet, Animated } from 'react-native';

/**
 * The branded launch screen. Shown while fonts and the session are still
 * resolving — startup used to sit on a bare spinner for that whole window.
 *
 * `fontWeight` is set alongside `fontFamily` on purpose: this renders before
 * Inter has finished loading, and without it the system fallback came up thin
 * and then visibly snapped to bold.
 */
export function SplashView() {
  const opacity = useRef(new Animated.Value(0)).current;
  const scale = useRef(new Animated.Value(0.85)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(opacity, { toValue: 1, duration: 400, useNativeDriver: true }),
      Animated.spring(scale, { toValue: 1, tension: 80, friction: 8, useNativeDriver: true }),
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
    fontWeight: '700',
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

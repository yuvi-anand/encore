import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { HomeCity } from '../types';

interface CityChipProps {
  city: HomeCity;
  onRemove: () => void;
}

const COLORS = {
  bg: '#1a1a1a',
  text: '#fff',
  muted: '#888',
  accent: '#6C63FF',
  removeText: '#555',
};

export function CityChip({ city, onRemove }: CityChipProps) {
  const label = city.state
    ? `${city.city}, ${city.state}`
    : city.city;

  return (
    <View style={styles.chip}>
      <Text style={styles.label}>{label}</Text>
      <TouchableOpacity
        onPress={onRemove}
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        style={styles.removeButton}
      >
        <Text style={styles.removeText}>x</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.bg,
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderWidth: 1,
    borderColor: '#2a2a2a',
    gap: 6,
    alignSelf: 'flex-start',
  },
  label: {
    color: COLORS.text,
    fontSize: 13,
    fontWeight: '500',
  },
  removeButton: {
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: '#333',
    alignItems: 'center',
    justifyContent: 'center',
  },
  removeText: {
    color: COLORS.muted,
    fontSize: 10,
    fontWeight: '700',
    lineHeight: 13,
  },
});

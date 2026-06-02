import React from 'react';
import {
  ScrollView,
  TouchableOpacity,
  Text,
  StyleSheet,
  View,
} from 'react-native';
import { ALL_GENRES, Genre } from '../types';

interface GenreFilterProps {
  selected: Genre | null;
  onSelect: (genre: Genre | null) => void;
}

const COLORS = {
  bg: '#111',
  bgActive: '#6C63FF',
  text: '#888',
  textActive: '#fff',
  border: '#222',
};

export function GenreFilter({ selected, onSelect }: GenreFilterProps) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.container}
    >
      <TouchableOpacity
        style={[styles.pill, selected === null && styles.pillActive]}
        onPress={() => onSelect(null)}
      >
        <Text style={[styles.pillText, selected === null && styles.pillTextActive]}>All</Text>
      </TouchableOpacity>
      {ALL_GENRES.map((genre) => (
        <TouchableOpacity
          key={genre}
          style={[styles.pill, selected === genre && styles.pillActive]}
          onPress={() => onSelect(genre === selected ? null : genre)}
        >
          <Text style={[styles.pillText, selected === genre && styles.pillTextActive]}>
            {genre}
          </Text>
        </TouchableOpacity>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    gap: 8,
    flexDirection: 'row',
  },
  pill: {
    backgroundColor: '#111',
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderWidth: 1,
    borderColor: '#222',
  },
  pillActive: {
    backgroundColor: COLORS.bgActive,
    borderColor: COLORS.bgActive,
  },
  pillText: {
    color: COLORS.text,
    fontSize: 13,
    fontWeight: '500',
  },
  pillTextActive: {
    color: COLORS.textActive,
    fontWeight: '600',
  },
});

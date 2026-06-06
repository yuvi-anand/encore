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
  /** Ordered list of genres to display. Defaults to all genres. */
  genres?: Genre[];
}

const COLORS = {
  bg: '#111',
  bgActive: '#6C63FF',
  text: '#888',
  textActive: '#fff',
  border: '#222',
};

export function GenreFilter({ selected, onSelect, genres = ALL_GENRES }: GenreFilterProps) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={styles.scroll}
      contentContainerStyle={styles.container}
    >
      <TouchableOpacity
        style={[styles.pill, selected === null && styles.pillActive]}
        onPress={() => onSelect(null)}
      >
        <Text style={[styles.pillText, selected === null && styles.pillTextActive]}>All</Text>
      </TouchableOpacity>
      {genres.map((genre) => (
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
  scroll: {
    flexGrow: 0,
    maxHeight: 50,
  },
  container: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    gap: 8,
    flexDirection: 'row',
    alignItems: 'center',
  },
  pill: {
    backgroundColor: '#111',
    borderRadius: 20,
    paddingHorizontal: 16,
    height: 34,
    justifyContent: 'center',
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
    lineHeight: 16,
    fontFamily: 'Inter_600SemiBold',
  },
  pillTextActive: {
    color: COLORS.textActive,
  },
});

import React, { useState, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { useArtists } from '../../src/hooks/useArtists';
import { ArtistCard } from '../../src/components/ArtistCard';
import { GenreFilter } from '../../src/components/GenreFilter';
import { Genre, ALL_GENRES, artistMatchesGenre, genreCounts } from '../../src/types';

const COLORS = {
  bg: '#000',
  text: '#fff',
  muted: '#888',
  accent: '#6C63FF',
};

export default function ArtistsScreen() {
  const { userArtists, removeArtist, loading } = useArtists();
  const [selectedGenre, setSelectedGenre] = useState<Genre | null>(null);

  const filtered = useMemo(() => {
    if (!selectedGenre) return userArtists;
    return userArtists.filter((ua) => artistMatchesGenre(ua.artist?.genres, selectedGenre));
  }, [userArtists, selectedGenre]);

  // Only show genres the user actually has artists in, ordered by count desc
  // (most-listened genre first).
  const orderedGenres = useMemo(() => {
    const counts = genreCounts(userArtists.map((ua) => ua.artist?.genres));
    return ALL_GENRES.filter((g) => counts[g] > 0).sort((a, b) => counts[b] - counts[a]);
  }, [userArtists]);

  const handleRemove = (artistId: string, artistName: string) => {
    Alert.alert(
      'Remove Artist',
      `Remove ${artistName} from your list?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: () => removeArtist(artistId),
        },
      ]
    );
  };

  const pairs = useMemo(() => {
    const rows = [];
    for (let i = 0; i < filtered.length; i += 2) {
      rows.push(filtered.slice(i, i + 2));
    }
    return rows;
  }, [filtered]);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.title}>My Artists</Text>
        <View style={styles.countBadge}>
          <Text style={styles.countText}>{userArtists.length}</Text>
        </View>
      </View>

      <GenreFilter selected={selectedGenre} onSelect={setSelectedGenre} genres={orderedGenres} />

      <FlatList
        data={pairs}
        keyExtractor={(_, i) => String(i)}
        renderItem={({ item: row }) => (
          <View style={styles.row}>
            {row.map((ua) => (
              <View key={ua.artist_id} style={styles.cell}>
                <ArtistCard
                  artist={ua.artist}
                  size="md"
                  sourceBadge={ua.source}
                  onRemove={() => handleRemove(ua.artist_id, ua.artist.name)}
                />
              </View>
            ))}
            {row.length === 1 && <View style={styles.cell} />}
          </View>
        )}
        style={styles.flex}
        contentContainerStyle={styles.list}
        showsVerticalScrollIndicator={false}
        ListEmptyComponent={
          loading ? null : (
            <View style={styles.empty}>
              <Text style={styles.emptyTitle}>No artists yet</Text>
              <Text style={styles.emptySubtitle}>
                Tap the + button to discover and add artists.
              </Text>
            </View>
          )
        }
      />

      <TouchableOpacity
        style={styles.fab}
        onPress={() => router.push('/(tabs)/discover')}
      >
        <Feather name="plus" size={26} color="#fff" />
      </TouchableOpacity>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 12,
    gap: 10,
  },
  title: {
    color: COLORS.text,
    fontSize: 28,
    fontFamily: 'Inter_700Bold',
    flex: 1,
  },
  countBadge: {
    backgroundColor: '#6C63FF',
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 4,
    minWidth: 30,
    alignItems: 'center',
  },
  countText: {
    color: '#fff',
    fontSize: 14,
    fontFamily: 'Inter_700Bold',
  },
  flex: {
    flex: 1,
  },
  list: {
    padding: 12,
    paddingBottom: 80,
  },
  row: {
    flexDirection: 'row',
    marginBottom: 0,
  },
  cell: {
    flex: 1,
  },
  empty: {
    alignItems: 'center',
    paddingTop: 80,
    paddingHorizontal: 32,
  },
  emptyTitle: {
    color: COLORS.text,
    fontSize: 20,
    fontFamily: 'Inter_700Bold',
    marginBottom: 8,
  },
  emptySubtitle: {
    color: COLORS.muted,
    fontSize: 15,
    fontFamily: 'Inter_400Regular',
    textAlign: 'center',
    lineHeight: 22,
  },
  fab: {
    position: 'absolute',
    bottom: 24,
    right: 24,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#6C63FF',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#6C63FF',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 8,
    elevation: 8,
  },
});

import React, { useState, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TextInput,
  ActivityIndicator,
  TouchableOpacity,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useAuth } from '../../src/hooks/useAuth';
import { useArtists } from '../../src/hooks/useArtists';
import { ArtistCard } from '../../src/components/ArtistCard';
import { GenreFilter } from '../../src/components/GenreFilter';
import { searchArtists as searchBandsintown } from '../../src/lib/bandsintown';
import { Artist, Genre } from '../../src/types';

const COLORS = {
  bg: '#000',
  text: '#fff',
  muted: '#888',
  accent: '#6C63FF',
  inputBg: '#111',
  border: '#222',
};

let searchTimeout: ReturnType<typeof setTimeout>;

export default function DiscoverScreen() {
  const { user } = useAuth();
  const { userArtists, addArtist } = useArtists(user?.id);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Partial<Artist>[]>([]);
  const [searching, setSearching] = useState(false);
  const [selectedGenre, setSelectedGenre] = useState<Genre | null>(null);

  const followingIds = useMemo(
    () => new Set(userArtists.map((ua) => ua.artist?.bandsintown_id).filter(Boolean) as string[]),
    [userArtists]
  );

  const handleSearch = useCallback((text: string) => {
    setQuery(text);
    clearTimeout(searchTimeout);
    if (!text.trim()) {
      setResults([]);
      return;
    }
    searchTimeout = setTimeout(async () => {
      setSearching(true);
      const res = await searchBandsintown(text.trim());
      setResults(res);
      setSearching(false);
    }, 500);
  }, []);

  const handleAdd = async (artist: Partial<Artist>) => {
    await addArtist(artist, 'manual');
  };

  const pairs: Partial<Artist>[][] = useMemo(() => {
    const src = results;
    const rows: Partial<Artist>[][] = [];
    for (let i = 0; i < src.length; i += 2) {
      rows.push(src.slice(i, i + 2));
    }
    return rows;
  }, [results]);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.title}>Discover</Text>
      </View>

      <View style={styles.searchBar}>
        <Feather name="search" size={18} color={COLORS.muted} style={styles.searchIcon} />
        <TextInput
          style={styles.searchInput}
          placeholder="Search artists..."
          placeholderTextColor={COLORS.muted}
          value={query}
          onChangeText={handleSearch}
          returnKeyType="search"
          autoCorrect={false}
          autoCapitalize="none"
        />
        {query.length > 0 && (
          <TouchableOpacity onPress={() => { setQuery(''); setResults([]); }}>
            <Feather name="x" size={18} color={COLORS.muted} />
          </TouchableOpacity>
        )}
      </View>

      <GenreFilter selected={selectedGenre} onSelect={setSelectedGenre} />

      {searching && (
        <View style={styles.loadingRow}>
          <ActivityIndicator color={COLORS.accent} />
        </View>
      )}

      {!searching && results.length === 0 && query.length > 0 && (
        <View style={styles.empty}>
          <Text style={styles.emptyText}>No artists found for "{query}"</Text>
        </View>
      )}

      {!searching && results.length === 0 && query.length === 0 && (
        <View style={styles.empty}>
          <Text style={styles.emptyText}>Search for an artist to get started.</Text>
        </View>
      )}

      <FlatList
        data={pairs}
        keyExtractor={(_, i) => String(i)}
        renderItem={({ item: row }) => (
          <View style={styles.row}>
            {row.map((a, i) => {
              const key = a.bandsintown_id ?? a.spotify_id ?? a.name ?? String(i);
              const isFollowing = followingIds.has(a.bandsintown_id ?? '');
              return (
                <View key={key} style={styles.cell}>
                  <ArtistCard
                    artist={{
                      id: key,
                      name: a.name ?? '',
                      bandsintown_id: a.bandsintown_id ?? null,
                      ticketmaster_id: null,
                      spotify_id: null,
                      apple_music_id: null,
                      genres: a.genres ?? [],
                      image_url: a.image_url ?? null,
                      thumb_url: a.thumb_url ?? null,
                      created_at: '',
                    }}
                    isFollowing={isFollowing}
                    onAdd={() => handleAdd(a)}
                    size="md"
                  />
                </View>
              );
            })}
            {row.length === 1 && <View style={styles.cell} />}
          </View>
        )}
        contentContainerStyle={styles.list}
        showsVerticalScrollIndicator={false}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.bg,
  },
  header: {
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 12,
  },
  title: {
    color: COLORS.text,
    fontSize: 28,
    fontFamily: 'Inter_700Bold',
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.inputBg,
    marginHorizontal: 16,
    borderRadius: 12,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
    marginBottom: 4,
  },
  searchIcon: {
    marginRight: 8,
  },
  searchInput: {
    flex: 1,
    color: COLORS.text,
    fontSize: 15,
    fontFamily: 'Inter_400Regular',
    paddingVertical: 13,
  },
  loadingRow: {
    paddingVertical: 20,
    alignItems: 'center',
  },
  list: {
    padding: 12,
    paddingBottom: 40,
  },
  row: {
    flexDirection: 'row',
  },
  cell: {
    flex: 1,
  },
  empty: {
    alignItems: 'center',
    paddingTop: 60,
    paddingHorizontal: 32,
  },
  emptyText: {
    color: COLORS.muted,
    fontSize: 15,
    fontFamily: 'Inter_400Regular',
    textAlign: 'center',
  },
});

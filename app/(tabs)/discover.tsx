import React, { useState, useCallback, useMemo, useRef, useEffect } from 'react';
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
import { supabase } from '../../src/lib/supabase';
import { ArtistCard } from '../../src/components/ArtistCard';
import { GenreFilter } from '../../src/components/GenreFilter';
import { searchArtists as searchSpotify, getSuggestedArtists } from '../../src/lib/spotify';
import { searchAttractions } from '../../src/lib/ticketmaster';
import { Artist, Genre, artistMatchesGenre } from '../../src/types';

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
  const { profile } = useAuth();
  const { userArtists, addArtist } = useArtists();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Partial<Artist>[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchedQuery, setSearchedQuery] = useState('');
  const [adding, setAdding] = useState<Set<string>>(new Set());
  const [selectedGenre, setSelectedGenre] = useState<Genre | null>(null);
  const [suggestions, setSuggestions] = useState<Partial<Artist>[]>([]);
  const [genreArtists, setGenreArtists] = useState<Record<string, Partial<Artist>[]>>({});
  const [loadingGenre, setLoadingGenre] = useState(false);
  // Monotonic id so a slow earlier response can't overwrite a newer query's.
  const reqId = useRef(0);

  // Load "Suggested for you" from Spotify once we have a token.
  useEffect(() => {
    const token = profile?.spotify_token;
    if (!token) return;
    let active = true;
    getSuggestedArtists(token).then((res) => {
      if (active) setSuggestions(res);
    });
    return () => {
      active = false;
    };
  }, [profile?.spotify_token]);

  // Load top artists for a genre when its tab is tapped — straight from the DB
  // (server-seeded), so NO Spotify call and no rate limit. Cached per genre.
  useEffect(() => {
    if (!selectedGenre || genreArtists[selectedGenre]) return;
    let active = true;
    setLoadingGenre(true);
    supabase
      .from('genre_artists')
      .select('spotify_id, name, image_url, thumb_url, genres')
      .eq('genre', selectedGenre)
      .order('rank', { ascending: true })
      .then(({ data }) => {
        if (!active) return;
        const rows = (data ?? []).map((a: any) => ({
          spotify_id: a.spotify_id,
          name: a.name,
          image_url: a.image_url,
          thumb_url: a.thumb_url,
          genres: a.genres ?? [],
          bandsintown_id: null,
          ticketmaster_id: null,
          apple_music_id: null,
        })) as Partial<Artist>[];
        setGenreArtists((prev) => ({ ...prev, [selectedGenre]: rows }));
        setLoadingGenre(false);
      });
    return () => {
      active = false;
    };
  }, [selectedGenre]);

  // Track which artists are already followed by name (covers all sources).
  const followingNames = useMemo(
    () =>
      new Set(
        userArtists
          .map((ua) => ua.artist?.name?.toLowerCase())
          .filter(Boolean) as string[]
      ),
    [userArtists]
  );

  const handleSearch = useCallback((text: string) => {
    setQuery(text);
    clearTimeout(searchTimeout);
    const trimmed = text.trim();
    if (!trimmed) {
      reqId.current += 1; // cancel any in-flight search
      setResults([]);
      setSearching(false);
      setSearchedQuery('');
      return;
    }
    // Show the spinner immediately (keep old results visible underneath) so it
    // never flashes "no results" while you're still typing.
    setSearching(true);
    const myId = ++reqId.current;
    searchTimeout = setTimeout(async () => {
      const token = profile?.spotify_token;
      const [sp, tm] = await Promise.all([
        token ? searchSpotify(trimmed, token) : Promise.resolve([]),
        searchAttractions(trimmed),
      ]);
      if (myId !== reqId.current) return; // a newer keystroke superseded this
      // Spotify results win on name collisions (better metadata).
      const merged: Partial<Artist>[] = [];
      const seen = new Set<string>();
      for (const a of [...sp, ...tm]) {
        const key = a.name?.toLowerCase() ?? '';
        if (!key || seen.has(key)) continue;
        seen.add(key);
        merged.push(a);
      }
      setResults(merged);
      setSearchedQuery(trimmed);
      setSearching(false);
    }, 200);
  }, [profile?.spotify_token]);

  const handleAdd = async (artist: Partial<Artist>) => {
    const key = artist.name?.toLowerCase() ?? '';
    setAdding((prev) => new Set(prev).add(key));
    await addArtist(artist, 'manual');
    setAdding((prev) => {
      const next = new Set(prev);
      next.delete(key);
      return next;
    });
  };

  const hasQuery = query.trim().length > 0;

  // Suggestions, minus artists already followed.
  const suggestionsFiltered = useMemo(
    () => suggestions.filter((a) => !followingNames.has(a.name?.toLowerCase() ?? '')),
    [suggestions, followingNames]
  );

  const pairs: Partial<Artist>[][] = useMemo(() => {
    let src: Partial<Artist>[];
    if (hasQuery) {
      // Searching: optionally narrow results by the selected genre.
      src = selectedGenre
        ? results.filter((a) => artistMatchesGenre(a.genres, selectedGenre))
        : results;
    } else if (selectedGenre) {
      // Genre tab: top artists in that genre, minus ones already followed.
      src = (genreArtists[selectedGenre] ?? []).filter(
        (a) => !followingNames.has(a.name?.toLowerCase() ?? '')
      );
    } else {
      // "All": personalized suggestions.
      src = suggestionsFiltered;
    }
    const rows: Partial<Artist>[][] = [];
    for (let i = 0; i < src.length; i += 2) {
      rows.push(src.slice(i, i + 2));
    }
    return rows;
  }, [hasQuery, results, suggestionsFiltered, selectedGenre, genreArtists, followingNames]);

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
        {searching && <ActivityIndicator color={COLORS.muted} size="small" style={styles.searchIcon} />}
        {query.length > 0 && (
          <TouchableOpacity onPress={() => handleSearch('')}>
            <Feather name="x" size={18} color={COLORS.muted} />
          </TouchableOpacity>
        )}
      </View>

      <GenreFilter selected={selectedGenre} onSelect={setSelectedGenre} />

      {/* Only show "no results" once a search for the CURRENT text has finished. */}
      {!searching && results.length === 0 && hasQuery && searchedQuery === query.trim() && (
        <View style={styles.empty}>
          <Text style={styles.emptyText}>No artists found for "{query.trim()}"</Text>
        </View>
      )}

      {/* Section header when idle. */}
      {!hasQuery && (
        <Text style={styles.sectionTitle}>
          {selectedGenre ? `Top ${selectedGenre} artists` : 'Suggested for you'}
        </Text>
      )}

      {!hasQuery && selectedGenre && loadingGenre && !genreArtists[selectedGenre] && (
        <View style={styles.loadingRow}>
          <ActivityIndicator color={COLORS.accent} />
        </View>
      )}

      {!hasQuery && !selectedGenre && suggestionsFiltered.length === 0 && (
        <View style={styles.empty}>
          <Text style={styles.emptyText}>
            {profile?.spotify_token
              ? 'Search for an artist to get started.'
              : 'Connect Spotify or search to find artists.'}
          </Text>
        </View>
      )}

      <FlatList
        data={pairs}
        keyExtractor={(_, i) => String(i)}
        renderItem={({ item: row }) => (
          <View style={styles.row}>
            {row.map((a, i) => {
              const key = a.bandsintown_id ?? a.ticketmaster_id ?? a.name ?? String(i);
              const nameKey = a.name?.toLowerCase() ?? '';
              const isFollowing = followingNames.has(nameKey) || adding.has(nameKey);
              return (
                <View key={key} style={styles.cell}>
                  <ArtistCard
                    artist={{
                      id: key,
                      name: a.name ?? '',
                      bandsintown_id: a.bandsintown_id ?? null,
                      ticketmaster_id: a.ticketmaster_id ?? null,
                      spotify_id: a.spotify_id ?? null,
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
        keyboardDismissMode="on-drag"
        keyboardShouldPersistTaps="handled"
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
  sectionTitle: {
    color: COLORS.text,
    fontSize: 16,
    fontFamily: 'Inter_600SemiBold',
    paddingHorizontal: 16,
    paddingTop: 4,
    paddingBottom: 4,
  },
});

import React from 'react';
import {
  View,
  Text,
  Image,
  TouchableOpacity,
  StyleSheet,
} from 'react-native';
import { Artist } from '../types';

interface ArtistCardProps {
  artist: Artist;
  onPress?: () => void;
  onRemove?: () => void;
  size?: 'sm' | 'md';
  sourceBadge?: 'spotify' | 'apple_music' | 'manual' | null;
  isFollowing?: boolean;
  onAdd?: () => void;
}

const COLORS = {
  bg: '#111',
  text: '#fff',
  accent: '#6C63FF',
  muted: '#888',
  spotify: '#1DB954',
  chip: '#222',
};

export function ArtistCard({
  artist,
  onPress,
  onRemove,
  size = 'md',
  sourceBadge,
  isFollowing,
  onAdd,
}: ArtistCardProps) {
  const imageSize = size === 'sm' ? 56 : 80;

  return (
    <TouchableOpacity
      style={styles.card}
      onPress={onPress}
      onLongPress={onRemove}
      activeOpacity={0.8}
    >
      {artist.image_url ? (
        <Image
          source={{ uri: artist.image_url }}
          style={[styles.image, { width: imageSize, height: imageSize, borderRadius: imageSize / 2 }]}
        />
      ) : (
        <View
          style={[
            styles.imagePlaceholder,
            { width: imageSize, height: imageSize, borderRadius: imageSize / 2 },
          ]}
        >
          <Text style={styles.imagePlaceholderText}>
            {artist.name.charAt(0).toUpperCase()}
          </Text>
        </View>
      )}

      <Text style={styles.name} numberOfLines={2}>
        {artist.name}
      </Text>

      {artist.genres.length > 0 && (
        <View style={styles.genres}>
          {artist.genres.slice(0, 2).map((g) => (
            <View key={g} style={styles.genreChip}>
              <Text style={styles.genreText}>{g}</Text>
            </View>
          ))}
        </View>
      )}

      {sourceBadge && (
        <View style={[styles.sourceBadge, sourceBadge === 'spotify' && styles.sourceBadgeSpotify]}>
          <Text style={styles.sourceBadgeText}>
            {sourceBadge === 'spotify' ? 'SP' : sourceBadge === 'apple_music' ? 'AM' : 'M'}
          </Text>
        </View>
      )}

      {onAdd !== undefined && (
        <TouchableOpacity
          style={[styles.addButton, isFollowing && styles.addButtonActive]}
          onPress={onAdd}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Text style={styles.addButtonText}>{isFollowing ? '✓' : '+'}</Text>
        </TouchableOpacity>
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: COLORS.bg,
    borderRadius: 14,
    padding: 12,
    alignItems: 'center',
    flex: 1,
    margin: 4,
    minWidth: 0,
  },
  image: {
    marginBottom: 8,
  },
  imagePlaceholder: {
    backgroundColor: '#222',
    marginBottom: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  imagePlaceholderText: {
    color: COLORS.text,
    fontSize: 24,
    fontWeight: '700',
  },
  name: {
    color: COLORS.text,
    fontSize: 13,
    fontWeight: '600',
    textAlign: 'center',
    marginBottom: 6,
  },
  genres: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 4,
  },
  genreChip: {
    backgroundColor: COLORS.chip,
    borderRadius: 20,
    paddingHorizontal: 7,
    paddingVertical: 2,
  },
  genreText: {
    color: COLORS.muted,
    fontSize: 10,
  },
  sourceBadge: {
    position: 'absolute',
    top: 8,
    right: 8,
    backgroundColor: '#333',
    borderRadius: 4,
    paddingHorizontal: 4,
    paddingVertical: 2,
  },
  sourceBadgeSpotify: {
    backgroundColor: COLORS.spotify,
  },
  sourceBadgeText: {
    color: COLORS.text,
    fontSize: 9,
    fontWeight: '700',
  },
  addButton: {
    position: 'absolute',
    bottom: 8,
    right: 8,
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: COLORS.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addButtonActive: {
    backgroundColor: '#333',
  },
  addButtonText: {
    color: COLORS.text,
    fontSize: 14,
    fontWeight: '700',
    lineHeight: 18,
  },
});

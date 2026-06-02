import React from 'react';
import {
  View,
  Text,
  Image,
  TouchableOpacity,
  StyleSheet,
  Linking,
} from 'react-native';
import { Event, Artist } from '../types';

interface EventCardProps {
  event: Event & { artist?: Artist };
  artistImageUrl?: string;
}

const COLORS = {
  bg: '#111',
  text: '#fff',
  muted: '#888',
  accent: '#6C63FF',
  border: '#222',
};

function formatEventDate(dateString: string): string {
  const date = new Date(dateString);
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const day = days[date.getDay()];
  const month = months[date.getMonth()];
  const dateNum = date.getDate();
  const hours = date.getHours();
  const minutes = date.getMinutes().toString().padStart(2, '0');
  const ampm = hours >= 12 ? 'PM' : 'AM';
  const hour12 = hours % 12 || 12;
  return `${day} ${month} ${dateNum} · ${hour12}:${minutes} ${ampm}`;
}

export function EventCard({ event, artistImageUrl }: EventCardProps) {
  const artist = event.artist;
  const imageUrl = artistImageUrl ?? artist?.image_url ?? null;

  const handleTickets = () => {
    if (event.ticket_url) {
      Linking.openURL(event.ticket_url);
    }
  };

  const location = [event.venue_city, event.venue_state ?? event.venue_country]
    .filter(Boolean)
    .join(', ');

  return (
    <View style={styles.card}>
      <View style={styles.row}>
        {imageUrl ? (
          <Image source={{ uri: imageUrl }} style={styles.image} />
        ) : (
          <View style={[styles.image, styles.imagePlaceholder]}>
            <Text style={styles.placeholderText}>
              {(artist?.name ?? '?').charAt(0).toUpperCase()}
            </Text>
          </View>
        )}

        <View style={styles.info}>
          {artist?.name && (
            <Text style={styles.artistName} numberOfLines={1}>
              {artist.name}
            </Text>
          )}
          {event.venue_name && (
            <Text style={styles.venueName} numberOfLines={1}>
              {event.venue_name}
            </Text>
          )}
          {location && (
            <Text style={styles.location} numberOfLines={1}>
              {location}
            </Text>
          )}
          <Text style={styles.date}>{formatEventDate(event.event_date)}</Text>
        </View>

        {event.ticket_url && (
          <TouchableOpacity style={styles.ticketButton} onPress={handleTickets}>
            <Text style={styles.ticketButtonText}>Tickets</Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: COLORS.bg,
    borderRadius: 14,
    padding: 14,
    marginVertical: 5,
    marginHorizontal: 16,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  image: {
    width: 54,
    height: 54,
    borderRadius: 10,
    flexShrink: 0,
  },
  imagePlaceholder: {
    backgroundColor: '#222',
    alignItems: 'center',
    justifyContent: 'center',
  },
  placeholderText: {
    color: COLORS.text,
    fontSize: 20,
    fontWeight: '700',
  },
  info: {
    flex: 1,
    gap: 2,
  },
  artistName: {
    color: COLORS.text,
    fontSize: 15,
    fontWeight: '700',
  },
  venueName: {
    color: COLORS.text,
    fontSize: 13,
    fontWeight: '400',
  },
  location: {
    color: COLORS.muted,
    fontSize: 12,
  },
  date: {
    color: COLORS.accent,
    fontSize: 12,
    fontWeight: '600',
    marginTop: 2,
  },
  ticketButton: {
    backgroundColor: COLORS.accent,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    alignSelf: 'center',
  },
  ticketButtonText: {
    color: COLORS.text,
    fontSize: 12,
    fontWeight: '700',
  },
});

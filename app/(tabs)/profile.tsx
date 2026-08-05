import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { useAuth } from '../../src/hooks/useAuth';
import { useArtists } from '../../src/hooks/useArtists';

const COLORS = {
  bg: '#000',
  card: '#111',
  text: '#fff',
  muted: '#888',
  accent: '#6C63FF',
  border: '#1a1a1a',
  chip: '#1a1a1a',
};

function StatCard({ value, label }: { value: string | number; label: string }) {
  return (
    <View style={styles.statCard}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

export default function ProfileScreen() {
  const { user, profile } = useAuth();
  const { userArtists } = useArtists();

  const displayName = profile?.username || user?.email?.split('@')[0] || 'You';
  const initial = displayName.charAt(0).toUpperCase();

  const memberSince = profile?.created_at
    ? new Date(profile.created_at).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
    : null;

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
        {/* Header */}
        <View style={styles.headerRow}>
          <Text style={styles.title}>Profile</Text>
          <TouchableOpacity
            onPress={() => router.push('/settings')}
            hitSlop={12}
            style={styles.gearBtn}
            accessibilityLabel="Settings"
          >
            <Feather name="settings" size={22} color={COLORS.text} />
          </TouchableOpacity>
        </View>

        {/* Identity */}
        <View style={styles.identity}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{initial}</Text>
          </View>
          <Text style={styles.name} numberOfLines={1}>{displayName}</Text>
          {user?.email ? <Text style={styles.email} numberOfLines={1}>{user.email}</Text> : null}
          {memberSince ? <Text style={styles.since}>Member since {memberSince}</Text> : null}
        </View>

        {/* Stats */}
        <View style={styles.statsRow}>
          <StatCard value={userArtists.length} label="Artists" />
          <StatCard value={0} label="Shows seen" />
          <StatCard value={0} label="Badges" />
        </View>

        {/* Concerts (foundation for tracking) */}
        <Text style={styles.sectionHeader}>Your Concerts</Text>
        <View style={styles.emptyCard}>
          <Feather name="calendar" size={24} color={COLORS.muted} />
          <Text style={styles.emptyTitle}>No shows tracked yet</Text>
          <Text style={styles.emptyBody}>
            Mark concerts you attend to build your history and earn badges. Coming soon.
          </Text>
        </View>

        {/* Badges (foundation) */}
        <Text style={styles.sectionHeader}>Badges</Text>
        <View style={styles.badgeRow}>
          {['First Show', '5 Shows', 'Superfan', 'Explorer'].map((label) => (
            <View key={label} style={styles.badge}>
              <View style={styles.badgeCircle}>
                <Feather name="lock" size={16} color={COLORS.muted} />
              </View>
              <Text style={styles.badgeLabel} numberOfLines={1}>{label}</Text>
            </View>
          ))}
        </View>
        <Text style={styles.footnote}>Badges unlock as you track the shows you go to.</Text>

        <View style={{ height: 40 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg },
  scroll: { paddingHorizontal: 16 },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 12,
    paddingBottom: 8,
    paddingHorizontal: 4,
  },
  title: { color: COLORS.text, fontSize: 28, fontFamily: 'Inter_700Bold' },
  gearBtn: { padding: 4 },
  identity: { alignItems: 'center', paddingVertical: 20 },
  avatar: {
    width: 84,
    height: 84,
    borderRadius: 42,
    backgroundColor: COLORS.accent,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  avatarText: { color: '#fff', fontSize: 34, fontFamily: 'Inter_700Bold' },
  name: { color: COLORS.text, fontSize: 20, fontFamily: 'Inter_700Bold' },
  email: { color: COLORS.muted, fontSize: 14, fontFamily: 'Inter_400Regular', marginTop: 2 },
  since: { color: '#555', fontSize: 12, fontFamily: 'Inter_400Regular', marginTop: 6 },
  statsRow: { flexDirection: 'row', gap: 10, marginTop: 8, marginBottom: 8 },
  statCard: {
    flex: 1,
    backgroundColor: COLORS.card,
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
  },
  statValue: { color: COLORS.text, fontSize: 24, fontFamily: 'Inter_700Bold' },
  statLabel: { color: COLORS.muted, fontSize: 12, fontFamily: 'Inter_400Regular', marginTop: 4 },
  sectionHeader: {
    color: COLORS.muted,
    fontSize: 12,
    fontFamily: 'Inter_600SemiBold',
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginTop: 24,
    marginBottom: 8,
    paddingHorizontal: 4,
  },
  emptyCard: {
    backgroundColor: COLORS.card,
    borderRadius: 14,
    padding: 24,
    alignItems: 'center',
    gap: 8,
  },
  emptyTitle: { color: COLORS.text, fontSize: 16, fontFamily: 'Inter_600SemiBold' },
  emptyBody: {
    color: COLORS.muted,
    fontSize: 13,
    fontFamily: 'Inter_400Regular',
    textAlign: 'center',
    lineHeight: 19,
  },
  badgeRow: { flexDirection: 'row', gap: 10 },
  badge: { flex: 1, alignItems: 'center', gap: 6 },
  badgeCircle: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: COLORS.chip,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#222',
  },
  badgeLabel: { color: COLORS.muted, fontSize: 11, fontFamily: 'Inter_400Regular' },
  footnote: {
    color: '#555',
    fontSize: 12,
    fontFamily: 'Inter_400Regular',
    marginTop: 12,
    paddingHorizontal: 4,
  },
});

import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { useAuth } from '../src/hooks/useAuth';

const COLORS = {
  bg: '#000',
  section: '#111',
  text: '#fff',
  muted: '#888',
  accent: '#6C63FF',
  border: '#1a1a1a',
  destructive: '#FF453A',
};

export default function AccountScreen() {
  const { user, signOut, deleteAccount } = useAuth();
  const [busy, setBusy] = useState(false);

  const handleSignOut = () => {
    Alert.alert('Sign Out', 'Are you sure you want to sign out?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Sign Out',
        style: 'destructive',
        onPress: async () => {
          setBusy(true);
          await signOut();
          // Auth gate redirects to login automatically.
        },
      },
    ]);
  };

  const handleDelete = () => {
    Alert.alert(
      'Delete Account',
      'This permanently deletes your account, your artists, and all your data. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            // Second confirmation for a destructive, irreversible action.
            Alert.alert('Are you sure?', 'There is no way to recover your account.', [
              { text: 'Cancel', style: 'cancel' },
              {
                text: 'Delete forever',
                style: 'destructive',
                onPress: async () => {
                  setBusy(true);
                  const err = await deleteAccount();
                  setBusy(false);
                  if (err) {
                    Alert.alert('Could not delete account', err.message);
                  }
                  // On success the auth gate redirects to login.
                },
              },
            ]);
          },
        },
      ]
    );
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={12} style={styles.backBtn}>
          <Feather name="chevron-left" size={26} color={COLORS.text} />
        </TouchableOpacity>
        <Text style={styles.title}>Account</Text>
      </View>

      <View style={styles.body}>
        <Text style={styles.sectionHeader}>SIGNED IN AS</Text>
        <View style={styles.section}>
          <View style={styles.row}>
            <Text style={styles.rowLabel}>Email</Text>
            <Text style={styles.email} numberOfLines={1}>{user?.email ?? '—'}</Text>
          </View>
        </View>

        <View style={styles.section}>
          <TouchableOpacity style={styles.actionRow} onPress={handleSignOut} disabled={busy}>
            <Text style={styles.signOut}>Sign Out</Text>
          </TouchableOpacity>
        </View>

        <Text style={styles.sectionHeader}>DANGER ZONE</Text>
        <View style={styles.section}>
          <TouchableOpacity style={styles.actionRow} onPress={handleDelete} disabled={busy}>
            {busy ? (
              <ActivityIndicator color={COLORS.destructive} size="small" />
            ) : (
              <Text style={styles.delete}>Delete Account</Text>
            )}
          </TouchableOpacity>
        </View>
        <Text style={styles.note}>
          Deleting your account removes your profile, followed artists, and all associated data
          permanently.
        </Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingTop: 8,
    paddingBottom: 12,
  },
  backBtn: { padding: 4, marginRight: 4 },
  title: { color: COLORS.text, fontSize: 22, fontFamily: 'Inter_700Bold' },
  body: { paddingHorizontal: 16 },
  sectionHeader: {
    color: COLORS.muted,
    fontSize: 12,
    fontFamily: 'Inter_600SemiBold',
    letterSpacing: 1,
    marginTop: 24,
    marginBottom: 8,
    paddingHorizontal: 4,
  },
  section: {
    backgroundColor: COLORS.section,
    borderRadius: 14,
    paddingHorizontal: 14,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 16,
  },
  rowLabel: { color: COLORS.text, fontSize: 15, fontFamily: 'Inter_400Regular' },
  email: { color: COLORS.muted, fontSize: 14, fontFamily: 'Inter_400Regular', maxWidth: 220 },
  actionRow: { paddingVertical: 16, alignItems: 'center' },
  signOut: { color: COLORS.text, fontSize: 16, fontFamily: 'Inter_600SemiBold' },
  delete: { color: COLORS.destructive, fontSize: 16, fontFamily: 'Inter_600SemiBold' },
  note: {
    color: '#555',
    fontSize: 12,
    fontFamily: 'Inter_400Regular',
    lineHeight: 18,
    marginTop: 10,
    paddingHorizontal: 4,
  },
});

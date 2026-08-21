import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { Session, User, AuthError } from '@supabase/supabase-js';
import * as WebBrowser from 'expo-web-browser';
import * as AuthSession from 'expo-auth-session';
import { supabase } from '../lib/supabase';
import { authenticateLastfm } from '../lib/lastfm';
import { Profile } from '../types';

interface AuthContextValue {
  user: User | null;
  session: Session | null;
  profile: Profile | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<AuthError | null>;
  signUp: (email: string, password: string) => Promise<AuthError | null>;
  signInWithSpotify: () => Promise<AuthError | { message: string } | null>;
  signInWithLastfm: () => Promise<{ message: string } | null>;
  signOut: () => Promise<void>;
  deleteAccount: () => Promise<{ message: string } | null>;
  updateProfile: (updates: Partial<Profile>) => Promise<void>;
  refetchProfile: () => void;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

async function ensureProfile(userId: string): Promise<Profile | null> {
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .maybeSingle();

  if (error) {
    console.error('fetchProfile error:', error);
    return null;
  }

  // Create a profile row if one doesn't exist yet.
  if (!data) {
    const { data: created, error: insertError } = await supabase
      .from('profiles')
      .insert({ id: userId, home_cities: [], notification_radius_miles: 50 })
      .select()
      .single();
    if (insertError) {
      console.error('createProfile error:', insertError);
      return null;
    }
    return created as Profile;
  }

  return data as Profile;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [session, setSession] = useState<Session | null>(null);

  useEffect(() => {
    let mounted = true;

    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!mounted) return;
      setSession(session);
      setUser(session?.user ?? null);
      if (session?.user) {
        const p = await ensureProfile(session.user.id);
        if (mounted) setProfile(p);
      }
      if (mounted) setLoading(false);
    });

    const { data: listener } = supabase.auth.onAuthStateChange(async (_event, session) => {
      if (!mounted) return;
      setSession(session);
      setUser(session?.user ?? null);
      if (session?.user) {
        const p = await ensureProfile(session.user.id);
        if (mounted) setProfile(p);
      } else {
        setProfile(null);
      }
    });

    return () => {
      mounted = false;
      listener.subscription.unsubscribe();
    };
  }, []);

  const signIn = useCallback(async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return error;
  }, []);

  const signUp = useCallback(async (email: string, password: string) => {
    const { error } = await supabase.auth.signUp({ email, password });
    // Profile creation is handled by ensureProfile via onAuthStateChange.
    return error;
  }, []);

  const signInWithSpotify = useCallback(async () => {
    const redirectTo = AuthSession.makeRedirectUri({ scheme: 'encore', path: 'auth/callback' });

    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: 'spotify',
      options: {
        redirectTo,
        skipBrowserRedirect: true,
        scopes:
          'user-top-read user-follow-read user-read-email user-library-read user-read-recently-played playlist-read-private playlist-read-collaborative',
      },
    });
    if (error) return error;
    if (!data?.url) return { message: 'Could not start Spotify sign-in.' };

    const result = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);
    if (result.type !== 'success' || !result.url) {
      return result.type === 'cancel' || result.type === 'dismiss'
        ? null
        : { message: 'Spotify sign-in was cancelled.' };
    }

    // The redirect carries an auth code we exchange for a Supabase session.
    // Parsed by hand because React Native's URL doesn't reliably expose
    // searchParams for custom-scheme URLs (encore://...).
    const codeMatch = result.url.match(/[?&]code=([^&#]+)/);
    const code = codeMatch ? decodeURIComponent(codeMatch[1]) : null;
    if (!code) return { message: 'No authorization code returned from Spotify.' };

    const { data: sessionData, error: exchangeError } =
      await supabase.auth.exchangeCodeForSession(code);
    if (exchangeError) return exchangeError;

    // Stash the Spotify tokens so we can import + later re-sync the library.
    const providerToken = sessionData.session?.provider_token;
    const providerRefresh = (sessionData.session as any)?.provider_refresh_token;
    if (providerToken && sessionData.session?.user) {
      await supabase
        .from('profiles')
        .update({ spotify_token: providerToken, spotify_refresh_token: providerRefresh ?? null })
        .eq('id', sessionData.session.user.id);
      // Reflect the tokens in local state immediately so Settings shows the
      // connection and the background library import (which keys off
      // profile.spotify_token) fires now instead of waiting for an app restart.
      const refreshed = await ensureProfile(sessionData.session.user.id);
      if (refreshed) setProfile(refreshed);
    }
    return null;
  }, []);

  const signInWithLastfm = useCallback(async (): Promise<{ message: string } | null> => {
    // Last.fm isn't an OAuth provider, so mint an instant guest (anonymous)
    // account, then link the Last.fm username. Feels like "continue with Last.fm".
    const { data: anon, error: anonErr } = await supabase.auth.signInAnonymously();
    if (anonErr || !anon?.user) {
      return {
        message:
          'Guest sign-in isn’t enabled yet. Enable anonymous sign-ins in Supabase → Authentication.',
      };
    }
    const auth = await authenticateLastfm();
    if (!auth.ok) {
      // Don't leave an empty guest account behind if it didn't complete.
      await supabase.auth.signOut();
      return { message: auth.cancelled ? 'cancelled' : auth.message };
    }
    const username = auth.username;
    await ensureProfile(anon.user.id);
    await supabase.from('profiles').update({ lastfm_username: username }).eq('id', anon.user.id);
    // Refresh local profile so the background Last.fm import (keyed on
    // profile.lastfm_username) fires immediately.
    const refreshed = await ensureProfile(anon.user.id);
    if (refreshed) setProfile(refreshed);
    return null;
  }, []);

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
  }, []);

  const deleteAccount = useCallback(async () => {
    // delete_account() is a SECURITY DEFINER function that removes the user's
    // profile (cascading their data) and their auth row.
    const { error } = await supabase.rpc('delete_account');
    if (error) {
      console.error('deleteAccount error:', error);
      return { message: error.message };
    }
    await supabase.auth.signOut();
    return null;
  }, []);

  const updateProfile = useCallback(
    async (updates: Partial<Profile>) => {
      if (!user) return;
      const { data, error } = await supabase
        .from('profiles')
        .update(updates)
        .eq('id', user.id)
        .select()
        .single();
      if (!error && data) {
        setProfile(data as Profile);
      } else if (error) {
        console.error('updateProfile error:', error);
      }
    },
    [user]
  );

  const refetchProfile = useCallback(() => {
    if (user) ensureProfile(user.id).then(setProfile);
  }, [user]);

  const value: AuthContextValue = {
    user,
    session,
    profile,
    loading,
    signIn,
    signUp,
    signInWithSpotify,
    signInWithLastfm,
    signOut,
    deleteAccount,
    updateProfile,
    refetchProfile,
  };

  return React.createElement(AuthContext.Provider, { value }, children);
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return ctx;
}

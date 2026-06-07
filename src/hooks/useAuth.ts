import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { Session, User, AuthError } from '@supabase/supabase-js';
import * as WebBrowser from 'expo-web-browser';
import * as AuthSession from 'expo-auth-session';
import { supabase } from '../lib/supabase';
import { Profile } from '../types';

interface AuthContextValue {
  user: User | null;
  session: Session | null;
  profile: Profile | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<AuthError | null>;
  signUp: (email: string, password: string) => Promise<AuthError | null>;
  signInWithSpotify: () => Promise<AuthError | { message: string } | null>;
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
    const url = new URL(result.url);
    const code = url.searchParams.get('code');
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
    }
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

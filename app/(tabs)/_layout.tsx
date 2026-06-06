import React from 'react';
import { Tabs } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { View, StyleSheet } from 'react-native';

const COLORS = {
  bg: '#000',
  border: '#111',
  active: '#fff',
  inactive: '#444',
  accent: '#6C63FF',
};

function TabBarIcon({ name, color, focused }: { name: React.ComponentProps<typeof Feather>['name']; color: string; focused: boolean }) {
  return (
    <View style={styles.iconWrapper}>
      <Feather name={name} size={22} color={color} />
      {focused && <View style={styles.dot} />}
    </View>
  );
}

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarStyle: styles.tabBar,
        tabBarActiveTintColor: COLORS.active,
        tabBarInactiveTintColor: COLORS.inactive,
        tabBarLabelStyle: styles.tabLabel,
        tabBarShowLabel: true,
      }}
    >
      <Tabs.Screen
        name="feed"
        options={{
          title: 'Feed',
          tabBarIcon: ({ color, focused }) => (
            <TabBarIcon name="calendar" color={color} focused={focused} />
          ),
        }}
      />
      <Tabs.Screen
        name="artists"
        options={{
          title: 'Artists',
          tabBarIcon: ({ color, focused }) => (
            <TabBarIcon name="music" color={color} focused={focused} />
          ),
        }}
      />
      <Tabs.Screen
        name="touring"
        options={{
          title: 'Touring',
          tabBarIcon: ({ color, focused }) => (
            <TabBarIcon name="map-pin" color={color} focused={focused} />
          ),
        }}
      />
      <Tabs.Screen
        name="discover"
        options={{
          title: 'Discover',
          tabBarIcon: ({ color, focused }) => (
            <TabBarIcon name="search" color={color} focused={focused} />
          ),
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: 'Settings',
          tabBarIcon: ({ color, focused }) => (
            <TabBarIcon name="settings" color={color} focused={focused} />
          ),
        }}
      />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  tabBar: {
    backgroundColor: COLORS.bg,
    borderTopColor: COLORS.border,
    borderTopWidth: 1,
    paddingTop: 6,
    height: 80,
    paddingBottom: 16,
  },
  tabLabel: {
    fontSize: 11,
    fontFamily: 'Inter_600SemiBold',
    marginTop: 2,
  },
  iconWrapper: {
    alignItems: 'center',
    justifyContent: 'center',
    height: 28,
  },
  dot: {
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#6C63FF',
    position: 'absolute',
    bottom: -4,
  },
});

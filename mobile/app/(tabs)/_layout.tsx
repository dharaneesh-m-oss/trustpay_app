/**
 * Tab navigation with the floating glass bar.
 *
 * The default Expo tab bar is replaced by `GlassTabBar` (adapted from
 * mymiamo/yellow-rattlesnake-26): a translucent blurred pill floating above the
 * content rather than a bar welded to the bottom edge.
 *
 * Because it floats, the screens beneath it must reserve room — see
 * `TAB_BAR_CLEARANCE`, which every tab screen adds to its bottom padding so the
 * last row is never trapped under the bar.
 */

import { Tabs, usePathname, useRouter } from 'expo-router';
import React from 'react';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { GlassTabBar } from '@/components/uiverse';
import { useNotifications } from '@/lib/queries';

/** Height of the floating bar plus its margin. Screens pad by this. */
export const TAB_BAR_CLEARANCE = 96;

const TABS = [
  { key: 'home', label: 'Home', glyph: '⌂' },
  { key: 'projects', label: 'Projects', glyph: '◫' },
  { key: 'wallet', label: 'Wallet', glyph: '₹' },
  { key: 'activity', label: 'Activity', glyph: '◔' },
  { key: 'profile', label: 'Profile', glyph: '◍' },
];

export default function TabsLayout() {
  const router = useRouter();
  const pathname = usePathname();
  const insets = useSafeAreaInsets();
  const { data } = useNotifications();

  const activeKey =
    TABS.find((tab) => pathname.includes(tab.key))?.key ?? 'home';

  return (
    <>
      <Tabs
        screenOptions={{
          headerShown: false,
          // The real bar is rendered below; this one is hidden rather than
          // removed so Expo Router still owns the navigation state.
          tabBarStyle: { display: 'none' },
        }}
      >
        <Tabs.Screen name="home" />
        <Tabs.Screen name="projects" />
        <Tabs.Screen name="wallet" />
        <Tabs.Screen name="activity" />
        <Tabs.Screen name="profile" />
      </Tabs>

      <GlassTabBar
        items={TABS.map((tab) =>
          tab.key === 'activity'
            ? { ...tab, badge: data?.unread ?? 0 }
            : tab,
        )}
        activeKey={activeKey}
        onSelect={(key) => router.push(`/(tabs)/${key}` as never)}
        bottomInset={insets.bottom}
      />
    </>
  );
}
